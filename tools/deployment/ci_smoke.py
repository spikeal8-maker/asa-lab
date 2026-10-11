"""Disposable Linux CI only: boot prebuilt images, export, restore and check login."""

import http.client
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import subprocess
import tarfile
import time
import urllib.request
import getpass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asa_manager import first_environment
from deployment.backup import export_backup, restore_check
from deployment.contracts import require, verify_backup
from deployment.releases import apply_release_environment, validate_resolved_images
from deployment.system import Installation, run
from deployment.collector import reader_probe, verify_effective_exec, verify_effective_empty
from deployment.ci_collector_cleanup import cleanup_collector, finish_cleanup

require(os.environ.get("GITHUB_ACTIONS") == "true", "CI_ONLY", "This test is only allowed in an isolated GitHub runner.")
release = json.loads(Path(sys.argv[1]).read_text())
source = Path.cwd()
with tempfile.TemporaryDirectory(prefix="asa-delivery-") as directory:
    root = Path(directory)
    # Own the host diagnostic path before Docker mounts it; otherwise Docker
    # creates root-owned parents that the runner cannot clean up afterwards.
    (root / ".asa" / "diagnostics" / "store").mkdir(parents=True)
    for file in ("compose.yaml", "compose.dev.yaml"):
        shutil.copyfile(source / file, root / file)
    (root / 'tools').mkdir()
    for file in ('collect_logs.py', 'collect-windows-logs.ps1', 'collector-scheduler.ps1', 'log_collector.py'):
        shutil.copyfile(source / 'tools' / file, root / 'tools' / file)
    shutil.copytree(source / 'tools/deployment', root / 'tools/deployment', ignore=shutil.ignore_patterns('__pycache__'))
    first_environment(root, "dev")
    env = root / ".env"
    env.write_text(env.read_text().replace("COMPOSE_PROJECT_NAME=asa-lab-dev", "COMPOSE_PROJECT_NAME=asa-lab-ci-delivery"))
    install = Installation(root, "dev")
    # Existing sudo permission is a property of the disposable GitHub runner,
    # not an automatic privilege elevation performed by the product manager.
    operator = getpass.getuser()
    collector_cli = ['sudo', '-n', 'env', 'SUDO_USER=' + operator, 'PYTHONDONTWRITEBYTECODE=1', sys.executable, str(root / 'tools/log_collector.py')]
    run(collector_cli + ['prepare', '--root', str(root), '--profile', 'dev'])
    install = Installation(root, 'dev')
    apply_release_environment(install, release)
    validate_resolved_images(install, release)
    try:
        install.compose("up", "-d", "--no-build")
        install.wait_ready(release["revision"], release["schema"])
        # Test actual systemd registration, process identity and non-1000 host
        # reader group before the later intentional restored-test DB override.
        run(collector_cli + ['reconcile', '--root', str(root), '--profile', 'dev'])
        verify_effective_exec({'mode': 'system', 'name': 'asa-log-collector-asa-lab-ci-delivery.service', 'root': str(root)}, sys.executable)
        # Read-only typed-property proof on the actually registered owned unit;
        # no foreign service or extra registration is used by this fixture.
        verify_effective_empty({'mode': 'system', 'name': 'asa-log-collector-asa-lab-ci-delivery.service'})
        reader_probe(install)
        deadline = time.monotonic() + 240
        while True:
            health_path = root / '.asa/diagnostics/store/collector-health.json'
            catalog_path = root / '.asa/diagnostics/store/catalog.json'
            if health_path.exists() and catalog_path.exists():
                health = json.loads(health_path.read_text()); catalog = json.loads(catalog_path.read_text())
                if health.get('state') == 'ok' and catalog.get('segments'): break
            require(time.monotonic() < deadline, 'COLLECTOR_SMOKE', 'Collector did not finish a cycle in the disposable runner.')
            time.sleep(1)
        installed_process = json.loads((root / '.asa/diagnostics/store/collector-process.json').read_text())
        require(installed_process['project'] == install.project and installed_process['root'] == str(root), 'COLLECTOR_SMOKE', 'Running collector belongs to another installation.')
        require(any(s['source'] == 'linux:journal' and s['state'] in ('ok', 'pending', 'unavailable') for s in catalog['sources']),
                'COLLECTOR_SMOKE', 'Linux journal access was not honestly classified.')
        read_catalog = install.compose('exec', '-T', 'api', 'node', '-e',
            "const c=JSON.parse(require('node:fs').readFileSync('/var/lib/asa-logs/catalog.json','utf8'));process.stdout.write(String(c.version))", capture=True)
        require(read_catalog == '1', 'COLLECTOR_SMOKE', 'The restricted API cannot read the actual catalog.')
        # An unchanged reconcile must preserve process identity and existing history.
        nonce = installed_process['nonce']; retained = {item['file']: item['sha256'] for item in catalog['segments']}
        run(collector_cli + ['reconcile', '--root', str(root), '--profile', 'dev'])
        observed = json.loads((root / '.asa/diagnostics/store/collector-process.json').read_text())
        require(observed['nonce'] == nonce, 'COLLECTOR_SMOKE', 'Idempotent reconcile restarted the healthy owned runner.')
        require(all((root / '.asa/diagnostics/store' / file).exists() for file in retained), 'COLLECTOR_SMOKE', 'Reconcile removed retained history.')
        print('COLLECTOR_SMOKE PASS: actual typed systemd executable/argv, process, scoped cycle, Linux access classification, supplemental reader GID, actual API catalog open, idempotent reconcile')
        # Real object-storage write through the S3 client, not a fake volume file.
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                        'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY"; printf "synthetic-project-media" | mc pipe "local/$ASA_OBJECT_STORAGE_BUCKET/delivery-fixture.txt"')
        backup = export_backup(install)
        manifest = verify_backup(backup)
        require(any(name.startswith("objects/") for name in manifest["files"]), "SMOKE", "Object storage was not exported.")
        # Delete the synthetic object through S3, then recover it from the actual
        # exported bytes into the same disposable CI MinIO volume.
        mc_prefix = 'mc alias set local http://minio:9000 "$ASA_OBJECT_STORAGE_ACCESS_KEY" "$ASA_OBJECT_STORAGE_SECRET_KEY" >/dev/null; '
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                        mc_prefix + 'mc rm "local/$ASA_OBJECT_STORAGE_BUCKET/delivery-fixture.txt"')
        install.compose("stop", "minio")
        archive = root / "restore-objects.tar"
        def owner(member):
            member.uid = member.gid = 1000
            member.uname = member.gname = ""
            return member
        with tarfile.open(archive, "w") as output:
            output.add(backup / "objects", arcname=".", filter=owner)
        records = install.identity()
        with archive.open("rb") as input_stream:
            result = subprocess.run(["docker", "cp", "-a", "-", f"{records['minio']['id']}:/data"], stdin=input_stream)
        require(result.returncode == 0, "SMOKE", "Object restore failed.")
        # Container start is asynchronous; mc alias set probes the endpoint.
        # Wait for the service healthcheck before verifying restored objects.
        install.compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "minio")
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "/bin/sh", "minio-init", "-eu", "-c",
                        mc_prefix + 'mc ready local; test "$(mc cat "local/$ASA_OBJECT_STORAGE_BUCKET/delivery-fixture.txt")" = synthetic-project-media')
        restore_check(install, backup, "asalab_delivery_restore_test")
        # Point only this disposable CI API at the restored database. This verifies
        # auth under the application's real restricted database role, not the admin.
        install.process_env["APP_DATABASE_URL"] = install.env["APP_DATABASE_URL"].rsplit("/", 1)[0] + "/asalab_delivery_restore_test"
        install.compose("up", "-d", "--no-build", "--no-deps", "api")
        install.wait_ready(release["revision"], release["schema"])
        body = json.dumps({"workspace": install.env["ASA_SEED_WORKSPACE"], "email": install.env["ASA_SEED_TEACHER_EMAIL"], "password": install.env["ASA_SEED_TEACHER_PASSWORD"]}).encode()
        request = urllib.request.Request("http://127.0.0.1:4610/api/auth/login", data=body,
                                         headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:4610"})
        with urllib.request.urlopen(request, timeout=15) as response:
            require(response.status in (200, 201), "SMOKE", "Login against the restored database failed.")
        # Prove provenance through the real pinned Caddy/API images, not a mock
        # parser. Only this disposable installation's ingress policy is changed.
        def login_provenance(forwarded, expected):
            request = urllib.request.Request('http://127.0.0.1:4610/api/auth/login', data=body,
                headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:4610',
                         'X-Forwarded-For': forwarded, 'CF-Connecting-IP': '192.0.2.99'})
            with urllib.request.urlopen(request, timeout=15) as response:
                require(response.status in (200, 201), 'CLIENT_PROVENANCE', 'Synthetic login failed.')
                response.read()
            observed = install.compose('exec', '-T', 'postgres', 'psql', '-U', install.env['POSTGRES_USER'],
                '-d', 'asalab_delivery_restore_test', '-At', '-c',
                "SELECT COALESCE(host(ip_address),'unknown') || '|' || network_kind FROM product_analytics_events WHERE event_type='auth.login' ORDER BY occurred_at DESC,id DESC LIMIT 1", capture=True)
            require(observed == expected, 'CLIENT_PROVENANCE', 'Stored visitor provenance differs from the validated ingress chain.')

        # No trusted public ingress by default: forged headers must not turn a
        # Docker gateway into a visitor, nor inject an arbitrary external IP.
        login_provenance('198.51.100.23', 'unknown|proxy')
        # records was fully attested before the intentional restored-test DB
        # override. Web was not recreated; a fresh identity() here must reject
        # that API/migration target mismatch, as it would in production.
        web = records['web']['id']
        gateways = run(['docker', 'inspect', '--format', '{{range .NetworkSettings.Networks}}{{println .Gateway}}{{end}}', web], capture=True).split()
        require(bool(gateways), 'CLIENT_PROVENANCE', 'Disposable ingress gateway is missing.')
        previous_ingress = install.process_env.get('ASA_INGRESS_TRUSTED_PROXY_CIDRS')
        try:
            install.process_env['ASA_INGRESS_TRUSTED_PROXY_CIDRS'] = ' '.join(f'{address}/32' for address in gateways)
            install.compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'web')
            login_provenance('192.0.2.200, 198.51.100.23', '198.51.100.23|public')
            login_provenance('192.0.2.200, 192.168.20.7', '192.168.20.7|local_network')
        finally:
            if previous_ingress is None:
                install.process_env.pop('ASA_INGRESS_TRUSTED_PROXY_CIDRS', None)
            else:
                install.process_env['ASA_INGRESS_TRUSTED_PROXY_CIDRS'] = previous_ingress
            install.compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'web')
        print('CLIENT_PROVENANCE PASS: default spoof rejection, explicit ingress, rightmost visitor, private visitor, stored NULL for unknown')
        with urllib.request.urlopen("http://127.0.0.1:4610/runtime-config.js") as response:
            require(b"http://127.0.0.1:4610" in response.read(), "SMOKE", "ASA origin configuration is missing.")
        with urllib.request.urlopen("http://127.0.0.1:4610/internal/blocks/") as response:
            require(b'./vendor/scratch/scratch-gui-standalone.js' in response.read(), "SMOKE", "Embedded editor route is missing.")
            require(response.headers.get("X-Frame-Options") != "DENY", "SMOKE", "Embedded editor framing is denied.")
        alias = http.client.HTTPConnection("127.0.0.1", 4610, timeout=10)
        try:
            alias.request("GET", "/internal/blocks/?asaStatus=parent", headers={"Host": "www.asa-lab.ru"})
            response = alias.getresponse()
            require(response.status == 308 and response.getheader("Location") ==
                    "https://asa-lab.ru/internal/blocks/?asaStatus=parent", "SMOKE", "Public alias must preserve the canonical editor entry.")
            response.read()
        finally:
            alias.close()
        with urllib.request.urlopen("http://localhost:4613/") as response:
            require(b'content="http://127.0.0.1:4610"' in response.read(), "SMOKE", "Scratch parent configuration is missing.")
        # Exercise the real shipped Caddy configuration, including paths that
        # never reach API diagnostics. Prove that query/headers/body stay private.
        canary = 'private-access-log-canary-984271'
        for path in ('/assets/missing-diagnostics-fixture.js', '/api/diagnostics/not-found'):
            request = urllib.request.Request('http://127.0.0.1:4610' + path + '?token=' + canary,
                data=canary.encode() if path.startswith('/api/') else None,
                headers={'Authorization':'Bearer '+canary, 'Cookie':'session='+canary, 'Content-Type':'text/plain',
                         'Origin':'http://127.0.0.1:4610'})
            try:
                with urllib.request.urlopen(request, timeout=15) as response: response.read()
            except urllib.error.HTTPError as failure:
                require(failure.code == 404, 'ACCESS_LOG', 'Expected a synthetic missing resource.')
                failure.close()
        invitation = '/api/classroom-teacher-invitations/' + canary
        try:
            with urllib.request.urlopen('http://127.0.0.1:4610' + invitation, timeout=15) as response: response.read()
        except urllib.error.HTTPError as failure:
            require(failure.code in (400, 401, 403, 404), 'ACCESS_LOG', 'Expected an invalid synthetic invitation.')
            failure.close()
        # A failed upstream uses the separate runtime error logger. Exercise it
        # in this disposable stack as well as the access logger's 404 path.
        install.compose('stop', 'api')
        try:
            for path in ('/api/diagnostics/offline', invitation):
                request = urllib.request.Request('http://127.0.0.1:4610' + path + '?token=' + canary,
                    headers={'Authorization':'Bearer '+canary, 'Cookie':'session='+canary})
                try:
                    with urllib.request.urlopen(request, timeout=15) as response: response.read()
                except urllib.error.HTTPError as failure:
                    require(failure.code == 502, 'ACCESS_LOG', 'Expected a synthetic upstream outage.')
                    failure.close()
        finally:
            install.compose('up', '-d', '--no-build', 'api')
            install.wait_ready(release['revision'], release['schema'])
        access = []
        for attempt in range(10):
            raw = install.compose('logs', '--no-color', '--no-log-prefix', 'web', capture=True)
            require(canary not in raw, 'ACCESS_LOG_PRIVACY', 'A private request value entered the web log.')
            access = []
            for line in raw.splitlines():
                try: item = json.loads(line)
                except ValueError: continue
                if item.get('kind') == 'http_response': access.append(item)
            if all(any(e.get('path') == path for e in access) for path in ('/assets/missing-diagnostics-fixture.js', '/api/diagnostics/not-found')): break
            time.sleep(0.2)
        for path in ('/assets/missing-diagnostics-fixture.js', '/api/diagnostics/not-found'):
            matches = [e for e in access if e.get('path') == path]
            require(matches and matches[-1].get('status') == 404 and matches[-1].get('revision') == release['revision'], 'ACCESS_LOG', 'Web access evidence is missing or has the wrong identity.')
            require(matches[-1].get('method') == ('POST' if path.startswith('/api/') else 'GET'), 'ACCESS_LOG', 'Web request method evidence is missing.')
            require('request' not in matches[-1] and 'resp_headers' not in matches[-1], 'ACCESS_LOG_PRIVACY', 'Private header containers were retained.')
            if path.startswith('/api/'):
                require(bool(matches[-1].get('requestId')), 'ACCESS_LOG', 'API response correlation is missing from the web log.')
        require(any(e.get('path') == '/api/classroom-teacher-invitations/[redacted]' for e in access), 'ACCESS_LOG_PRIVACY', 'Invitation path redaction is missing.')
        require(any(e.get('path') == '/api/classroom-teacher-invitations/[redacted]' and e.get('status') == 502 for e in access), 'ACCESS_LOG_PRIVACY', 'Invitation outage path redaction is missing.')
        require(any(e.get('path') == '/api/diagnostics/offline' and e.get('status') == 502 for e in access), 'ACCESS_LOG', 'Upstream outage evidence is missing.')
        require(any(e.get('path') == '/internal/blocks/' and e.get('status') == 200 for e in access), 'ACCESS_LOG', 'The original embedded editor path was lost after rewriting.')
        print("PORTABLE_SMOKE PASS: prebuilt boot, complete backup, ACL/RLS restore, restricted-role login, origins, private web access logs")
    finally:
        primary_error = sys.exc_info()[1]
        def check_tools_owner():
            # Root helper imports must not leave a root-owned __pycache__ that
            # prevents the ordinary runner from removing its own temp tree.
            for path in [root / 'tools', *(root / 'tools').rglob('*')]:
                require(path.lstat().st_uid == os.getuid(), 'COLLECTOR_CLEANUP_OWNERSHIP',
                        f'Collector CI tool path has a foreign owner: {path.relative_to(root)}')
            print('COLLECTOR_CLEANUP PASS: copied tools/cache remain owned by the disposable runner')
        finish_cleanup([
            lambda: cleanup_collector(root, operator, sys.executable),
            check_tools_owner,
            # Only this explicitly disposable CI project. No host/developer volumes.
            lambda: install.compose('down', '--volumes'),
        ], primary_error)
