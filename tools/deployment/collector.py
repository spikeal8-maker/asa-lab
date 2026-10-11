"""Own-installation diagnostic runner lifecycle; never elevates privileges."""

import argparse
import datetime as dt
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
import xml.etree.ElementTree as ET

from .contracts import Blocked, atomic_json, require
from .system import Installation

NS = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}
WINDOWS = os.name == 'nt'


def command(args, *, allow_missing=False):
    value = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=30,
                           creationflags=0x08000000 if os.name == "nt" else 0)
    if value.returncode and not allow_missing:
        raise Blocked("COLLECTOR_RUNNER", f"Diagnostic runner command failed: {Path(str(args[0])).name}",
                      "Inspect the runner permissions; no automatic elevation is performed.")
    return value.stdout.strip(), value.returncode


def digest(root):
    value = hashlib.sha256()
    for name in ("collect_logs.py", "collect-windows-logs.ps1"):
        path = root / "tools" / name
        value.update(name.encode()); value.update(path.read_bytes())
    return value.hexdigest()


def source_revision(root):
    # git must resolve the selected installation, not the invoking checkout.
    result = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=5,
                            creationflags=0x08000000 if WINDOWS else 0)
    revision = result.stdout.strip()
    return revision if result.returncode == 0 and re.fullmatch(r'[a-f0-9]{40}', revision) else None


def read_json(path, default=None):
    if not path.exists(): return default
    require(path.stat().st_size <= 1024**2, 'COLLECTOR_CONFIG', 'Diagnostic metadata exceeds 1 MiB.')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    require(isinstance(value, dict), 'COLLECTOR_CONFIG', 'Diagnostic metadata must be an object.')
    return value


def safe_paths(install):
    for name in ('.asa', '.asa/diagnostics', '.asa/diagnostics/store', '.asa/diagnostics/private',
                 '.asa/installation.json', '.asa/log-collector.json', '.asa/collector-runner.json', '.env'):
        path = install.root / name
        require(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)(),
                'COLLECTOR_PATH', 'Diagnostic installation paths must not redirect outside the installation.')


def validate_config(install):
    config = read_json(install.state / "log-collector.json", {})
    require(type(config.get('version', 1)) is int and config.get("version", 1) == 1, "COLLECTOR_CONFIG", "Unsupported collector configuration version.")
    require(config.get("project", install.project) == install.project, "COLLECTOR_PROJECT", "Collector project differs from the canonical installation.")
    for key, low, high in (("retentionDays", 1, 365), ("maxBytes", 16 * 1024**2, 10 * 1024**3), ("intervalSeconds", 10, 300)):
        require(key not in config or type(config[key]) is int and low <= config[key] <= high,
                "COLLECTOR_CONFIG", f"Invalid collector setting: {key}.")
    require(isinstance(config.get("fileSources", []), list), "COLLECTOR_CONFIG", "fileSources must be a list.")
    for item in config.get("fileSources", []):
        require(isinstance(item, dict) and isinstance(item.get("source"), str) and
                re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", item["source"]) and
                isinstance(item.get("path"), str) and Path(item["path"]).is_absolute(),
                "COLLECTOR_CONFIG", "File sources require a bounded name and an absolute path.")
    return config


def linux_operator():
    import pwd
    name = os.environ.get("SUDO_USER") if os.geteuid() == 0 else getpass.getuser()
    require(bool(name) and name != "root", "COLLECTOR_OPERATOR", "A nonroot Docker operator is required.",
            "Run as the Docker operator, or set SUDO_USER explicitly when already root; no sudo is run automatically.")
    operator = pwd.getpwnam(name)
    require(operator.pw_uid != 0 and operator.pw_gid != 0, "COLLECTOR_OPERATOR", "Collector operator and reader group must be nonzero.")
    return operator


def prepare(install):
    """Run only inside an authorized install/up/update, before the Compose switch."""
    safe_paths(install)
    records = install.identity(existing=False)
    require(install.profile != "test", "COLLECTOR_PROFILE", "Persistent host collection is not installed for ephemeral tests.")
    previous = install.settings
    require(not previous.get("project") or previous["project"] == install.project,
            "COLLECTOR_PROJECT", "Installation metadata project mismatch.")
    validate_config(install)
    install.state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not (install.state / "installation.json").exists():
        atomic_json(install.state / "installation.json", {"format": "asa-installation-v1", "profile": install.profile, "project": install.project})
    config_path = install.state / "log-collector.json"
    if not config_path.exists():
        sources = []
        backup_logs = install.root.parent / "operations" / "backup-logs"
        if backup_logs.is_dir(): sources.append({"source": "backup", "path": str(backup_logs)})
        if WINDOWS:
            discovered = json.loads(ps_scheduler(install, 'discover', {'name': 'ASA-Lab-Logs-' + install.project}))
            if isinstance(discovered, list):
                for item in discovered:
                    if isinstance(item, dict) and item.get('source') == 'tunnel' and isinstance(item.get('path'), str) and Path(item['path']).is_absolute(): sources.append(item)
        atomic_json(config_path, {"version": 1, "project": install.project, "retentionDays": 30,
                                 "maxBytes": 1024**3, "intervalSeconds": 20, "fileSources": sources})
    base = install.state / "diagnostics"
    store, private = base / "store", base / "private"
    new_directories = [path for path in (base, store, private) if not path.exists()]
    for path in (base, store, private): path.mkdir(parents=True, exist_ok=True)
    changed = False
    if not WINDOWS:
        operator = linux_operator()
        configured = install.env.get("ASA_LOG_READER_GID")
        require(configured is None or configured.isdecimal() and int(configured) == operator.pw_gid,
                "COLLECTOR_READER_GROUP", "Reader GID must be the nonzero primary group of the Docker operator.")
        gid = int(configured) if configured else operator.pw_gid
        if records.get('api'):
            actual_groups, code = command(['docker', 'exec', records['api']['id'], 'id', '-G'], allow_missing=True)
            changed = bool(code or str(gid) not in actual_groups.split())
        if not configured:
            with (install.root / ".env").open("a", encoding="utf-8") as stream:
                stream.write(f"\n# Host diagnostic read-only mount reader group.\nASA_LOG_READER_GID={gid}\n")
            changed = True
        for path in new_directories:
            info = path.stat()
            require(os.geteuid() == 0 or info.st_uid == operator.pw_uid, "COLLECTOR_STORE_OWNER", "Diagnostic directories belong to another user.")
            if os.geteuid() == 0: os.chown(path, operator.pw_uid, gid)
            elif info.st_gid != gid: os.chown(path, -1, gid)
            os.chmod(path, 0o2750 if path == store else 0o700 if path == private else 0o750)
        if os.geteuid() == 0:
            os.chown(install.state, operator.pw_uid, operator.pw_gid)
            for path in (install.state / 'installation.json', config_path):
                os.chown(path, operator.pw_uid, operator.pw_gid)
    return {"readerGroupChanged": changed}


def finalize_permissions(install):
    if WINDOWS: return
    safe_paths(install)
    operator = linux_operator(); gid = int(install.env['ASA_LOG_READER_GID'])
    require(gid == operator.pw_gid and gid > 0, 'COLLECTOR_READER_GROUP', 'Persisted reader group differs from operator primary group.')
    groups = install.compose('exec', '-T', 'api', 'id', '-G', capture=True).split()
    require(str(gid) in groups, 'COLLECTOR_READER_GROUP', 'Do not migrate existing log access before API has the new group.')
    base = install.state / 'diagnostics'; store, private = base / 'store', base / 'private'
    paths = [(base, 0o750), (store, 0o2750), (private, 0o700)]
    for path in store.iterdir():
        recognized = path.name in ('catalog.json', 'collector-health.json', 'collector-process.json') or re.fullmatch(r'seg-\d{16}-\d{16}\.jsonl(?:\.gz)?', path.name)
        if recognized and path.is_file() and not path.is_symlink(): paths.append((path, 0o640))
    for path, mode in paths:
        info = path.stat()
        require(info.st_uid == operator.pw_uid or os.geteuid() == 0 and info.st_uid == 0,
                'COLLECTOR_STORE_OWNER', 'Diagnostic publications belong to another user.')
        if os.geteuid() == 0: os.chown(path, operator.pw_uid, gid)
        elif info.st_gid != gid: os.chown(path, -1, gid)
        os.chmod(path, mode)
    if os.geteuid() == 0:
        for name in ('installation.json', 'log-collector.json'):
            path = install.state / name
            require(path.stat().st_uid in (0, operator.pw_uid), 'COLLECTOR_STORE_OWNER', 'Diagnostic configuration belongs to another user.')
            os.chown(path, operator.pw_uid, gid)


def runner_identity(install):
    persisted = read_json(install.state / "collector-runner.json", {})
    require(not persisted or persisted.get("root") == str(install.root) and persisted.get("project") == install.project,
            "COLLECTOR_RUNNER_IDENTITY", "Runner registration belongs to another installation.")
    if WINDOWS:
        owner = command(["whoami"])[0]
        sid = command(['powershell.exe', '-NoProfile', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'])[0]
        mode, name = "windows-task", "ASA-Lab-Logs-" + install.project
    else:
        operator = linux_operator()
        owner = operator.pw_name
        mode = persisted.get("mode", "system" if os.geteuid() == 0 else "user")
        require(mode in ("user", "system"), "COLLECTOR_RUNNER_MODE", "Unknown collector runner mode.")
        require(mode != "system" or os.geteuid() == 0, "COLLECTOR_RUNNER_PERMISSION", "The existing system runner needs administrator maintenance.",
                "Run the authorized update with existing administrator privileges; automatic sudo is disabled.")
        name = persisted.get("name", "asa-log-collector-" + install.project + ".service")
        require(name in ("asa-log-collector-" + install.project + ".service", "asa-log-collector.service"),
                "COLLECTOR_RUNNER_IDENTITY", "Unexpected collector unit name.")
        if not persisted and Path("/etc/systemd/system/asa-log-collector.service").exists():
            mode, name = "system", "asa-log-collector.service"
        require(mode != 'user' or os.geteuid() == operator.pw_uid, 'COLLECTOR_RUNNER_OWNER',
                'Maintain the existing user service as its nonroot owner; root user services are not substituted.')
    require(not persisted.get("owner") or persisted["owner"].lower() == owner.lower(),
            "COLLECTOR_RUNNER_OWNER", "Runner operator differs from its registered owner.")
    result = dict(version=1, root=str(install.root), project=install.project, owner=owner, mode=mode,
                  name=name, scriptDigest=digest(install.root), revision=source_revision(install.root))
    if WINDOWS: result['ownerSid'] = sid
    return result


def windows_xml(identity, python):
    def escape(value):
        from xml.sax.saxutils import escape as xml_escape
        return xml_escape(str(value))
    root, owner = identity["root"], escape(identity["owner"])
    arguments = escape(f'"{Path(root) / "tools" / "collect_logs.py"}" --root "{root}"')
    return f'''<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{owner}</UserId></LogonTrigger><CalendarTrigger><Repetition><Interval>PT5M</Interval><Duration>P1D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
<Principals><Principal id="Author"><UserId>{owner}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>{escape(python)}</Command><Arguments>{arguments}</Arguments><WorkingDirectory>{escape(root)}</WorkingDirectory></Exec></Actions></Task>'''


def verify_windows_task(xml, identity, resolved_sid=None):
    task = ET.fromstring(xml)
    actions = task.findall("t:Actions/t:Exec", NS)
    require(len(actions) == 1 and len(list(task.find('t:Actions', NS))) == 1 and len(task.findall('t:Principals/t:Principal', NS)) == 1,
            "COLLECTOR_RUNNER_IDENTITY", "Unexpected task actions or principals.")
    action = actions[0]
    root = identity["root"]
    principal = task.findtext('t:Principals/t:Principal/t:UserId', namespaces=NS) or ''
    require(action.findtext("t:WorkingDirectory", namespaces=NS) == root and
            action.findtext("t:Arguments", namespaces=NS) == f'"{Path(root) / "tools" / "collect_logs.py"}" --root "{root}"' and
            os.path.normcase(action.findtext("t:Command", namespaces=NS) or '') in
                {os.path.normcase(str(Path(sys.executable))), os.path.normcase(str(Path(sys.executable).with_name('pythonw.exe')))} and
            principal and (principal.lower() in
                {identity["owner"].lower(), identity.get('ownerSid', '').lower()} or
                bool(identity.get('ownerSid')) and resolved_sid == identity['ownerSid']) and
            task.findtext("t:Principals/t:Principal/t:LogonType", namespaces=NS) == "InteractiveToken" and
            task.findtext("t:Principals/t:Principal/t:RunLevel", namespaces=NS) == "LeastPrivilege",
            "COLLECTOR_RUNNER_IDENTITY", "Existing task is not this installation's least-privilege collector.")


def ps_scheduler(install, action, identity, xml=None):
    args = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
            install.root / "tools" / "collector-scheduler.ps1", "-Action", action, "-Name", identity["name"]]
    if xml: args += ["-XmlPath", xml]
    return command(args)[0]


def verify_systemd_unit(text, identity, python):
    allowed = {'Unit': {'Description', 'After'}, 'Service': {'User', 'WorkingDirectory', 'ExecStart', 'Restart', 'RestartSec', 'NoNewPrivileges', 'UMask'},
               'Install': {'WantedBy'}}
    section, values = None, {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(('#', ';')): continue
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
            require(section in allowed, 'COLLECTOR_RUNNER_IDENTITY', 'Unexpected unit section.')
            continue
        key, separator, value = line.partition('=')
        require(separator and section in allowed and key in allowed[section] and (section, key) not in values,
                'COLLECTOR_RUNNER_IDENTITY', 'Unexpected or repeated collector service directive.')
        values[section, key] = value
    expected = f'"{python}" "{Path(identity["root"]) / "tools" / "collect_logs.py"}" --root "{identity["root"]}"'
    require(values.get(('Service', 'ExecStart')) == expected and
            values.get(('Service', 'WorkingDirectory')) == f'"{identity["root"]}"' and
            values.get(('Service', 'User')) == (identity['owner'] if identity['mode'] == 'system' else None) and
            values.get(('Service', 'NoNewPrivileges')) == 'true',
            'COLLECTOR_RUNNER_IDENTITY', 'Existing service is not this installation\'s unprivileged collector.')


def reconcile_runner(install, identity, restart):
    if identity["mode"] == "windows-task":
        existing = json.loads(ps_scheduler(install, "query", identity))
        if existing.get("xml"): verify_windows_task(existing["xml"], identity, existing.get('principalSid'))
        python = Path(sys.executable).with_name("pythonw.exe")
        if not python.exists(): python = Path(sys.executable)
        if not existing.get("xml") or restart:
            if existing.get("xml"): ps_scheduler(install, "stop", identity)
            xml = install.state / "diagnostics" / "private" / "collector-task.xml"
            xml.write_text(windows_xml(identity, python), encoding="utf-16")
            try: ps_scheduler(install, "register", identity, xml)
            finally: xml.unlink(missing_ok=True)
        ps_scheduler(install, "start", identity)
        return "Requires the logged-in Docker Desktop operator session"
    system = identity["mode"] == "system"
    require(not system or os.geteuid() == 0, "COLLECTOR_RUNNER_PERMISSION", "System runner maintenance requires existing root privileges.")
    directory = Path("/etc/systemd/system") if system else Path.home() / ".config" / "systemd" / "user"
    path = directory / identity["name"]
    python, root = sys.executable, identity["root"]
    require(not any(c in python + root for c in ('\n', '\r', '"', '%')), "COLLECTOR_RUNNER_PATH", "Unsupported systemd path characters.")
    exec_line = f'ExecStart="{python}" "{Path(root) / "tools" / "collect_logs.py"}" --root "{root}"'
    require(not path.is_symlink(), 'COLLECTOR_RUNNER_IDENTITY', 'Collector service unit must not be a symlink.')
    if path.exists(): verify_systemd_unit(path.read_text(), identity, python)
    if path.exists():
        require(path.stat().st_uid == (0 if system else os.geteuid()), 'COLLECTOR_RUNNER_OWNER', 'Service file belongs to another operator.')
    owner_line = f'User={identity["owner"]}\n' if system else ""
    unit = ("[Unit]\nDescription=ASA Lab diagnostic collector\nAfter=network.target\n[Service]\n" + owner_line +
            f'WorkingDirectory="{root}"\n{exec_line}\nRestart=always\nRestartSec=20\nNoNewPrivileges=true\nUMask=0077\n' +
            "[Install]\nWantedBy=" + ("multi-user.target\n" if system else "default.target\n"))
    ctl = ["systemctl"] + ([] if system else ["--user"])
    # Validate the user manager exists before writing a unit file.
    command(ctl + ["show-environment"])
    properties = ['FragmentPath', 'DropInPaths', 'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'EnvironmentFiles', 'LoadState', 'Transient', 'ExecStart']
    raw, code = command(ctl + ['show', identity['name'], *['--property=' + key for key in properties]], allow_missing=True)
    effective = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
    require(not effective.get('FragmentPath') or effective['FragmentPath'] == str(path),
            'COLLECTOR_RUNNER_IDENTITY', 'Service is loaded from another unit path.')
    require(not any(effective.get(key) for key in properties[1:7]), 'COLLECTOR_RUNNER_IDENTITY',
            'Collector service has unexpected drop-ins or additional effective commands.')
    require(effective.get('Transient') != 'yes' and (effective.get('FragmentPath') or effective.get('LoadState') in (None, 'not-found')),
            'COLLECTOR_RUNNER_IDENTITY', 'A transient or unowned service already uses the collector unit name.')
    if effective.get('ExecStart'):
        executable = re.search(r'path=([^;]+?)\s*;', effective['ExecStart'])
        require(executable and executable[1] == python, 'COLLECTOR_RUNNER_IDENTITY', 'Effective service interpreter differs.')
    require(not code or not path.exists(), 'COLLECTOR_RUNNER_IDENTITY', 'Cannot verify the existing service.')
    directory.mkdir(parents=True, exist_ok=True)
    changed = not path.exists() or path.read_text() != unit
    if changed:
        temporary = path.with_suffix(".tmp"); temporary.write_text(unit); os.replace(temporary, path)
    command(ctl + ["daemon-reload"])
    command(ctl + ["enable", identity["name"]])
    command(ctl + ["restart" if restart or changed else "start", identity["name"]])
    return "System service" if system else "User service; autonomous boot requires pre-existing user lingering"


def status(install):
    """Pure observation: does not create directories, locks, files or services."""
    identity = read_json(install.state / "collector-runner.json", {})
    process = read_json(install.state / "diagnostics" / "store" / "collector-process.json", {})
    health = read_json(install.state / "diagnostics" / "store" / "collector-health.json", {})
    expected = digest(install.root)
    fresh = False
    try:
        age = time.time() - dt.datetime.fromisoformat(process["checkedAt"].replace("Z", "+00:00")).timestamp()
        fresh = (0 <= age < 90 and process.get('root') == str(install.root) and process.get('project') == install.project
                 and type(process.get('pid')) is int and process['pid'] > 0 and bool(re.fullmatch(r'[a-f0-9]{32}', process.get('nonce', ''))))
    except (KeyError, ValueError, TypeError): pass
    return {"state": "running" if fresh and process.get("scriptDigest") == expected else "unavailable" if not identity else "stale",
            "process": process, "cycle": health, "mode": identity.get("mode"), "scriptDigest": expected,
            "detail": "Process identity is separate from cycle success and individual source coverage"}


def reader_probe(install):
    if WINDOWS: return
    gid = install.env.get("ASA_LOG_READER_GID", "")
    groups = install.compose("exec", "-T", "api", "id", "-G", capture=True).split()
    require(gid and gid in groups, "COLLECTOR_READER_GROUP", "API does not have the persisted diagnostic reader group.")
    fd, name = tempfile.mkstemp(prefix='.reader-probe-', dir=install.state / 'diagnostics/store')
    sentinel = Path(name)
    with os.fdopen(fd, 'w') as stream: stream.write('asa-log-reader-v1')
    os.chmod(sentinel, 0o640)
    try:
        observed = install.compose("exec", "-T", "api", "node", "-e",
                                 "process.stdout.write(require('node:fs').readFileSync(process.argv[1],'utf8'))",
                                 '/var/lib/asa-logs/' + sentinel.name, capture=True)
        require(observed == "asa-log-reader-v1", "COLLECTOR_READER_PERMISSION", "API cannot read diagnostic publications.")
    finally: sentinel.unlink(missing_ok=True)


@contextmanager
def runner_lock(install):
    stream = (install.state / 'diagnostics/private/runner-maintenance.lock').open('a+b')
    try:
        try:
            if WINDOWS:
                import msvcrt
                stream.seek(0, os.SEEK_END)
                if not stream.tell(): stream.write(b'0'); stream.flush()
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise Blocked('COLLECTOR_LOCKED', 'Another collector reconciliation is active.', 'Wait for it to finish; no task/service was changed.') from exc
        yield
    finally: stream.close()


def reconcile(install, *, wait_seconds=30):
    try:
        safe_paths(install)
        with runner_lock(install): return _reconcile(install, wait_seconds=wait_seconds)
    except (Blocked, OSError) as exc:
        result = {'state': 'degraded', 'code': getattr(exc, 'code', 'COLLECTOR_IO'), 'detail': str(exc)[:500]}
        print(f"COLLECTOR degraded: {result['detail']}")
        return result


def _reconcile(install, *, wait_seconds=30):
    """Post-readiness best effort. Never turn a ready application into failed_switch."""
    try:
        safe_paths(install)
        install.identity()
        validate_config(install)
        finalize_permissions(install)
        reader_probe(install)
        identity = runner_identity(install)
        previous = read_json(install.state / "collector-runner.json", {})
        before = status(install)
        restart = previous != identity or before["state"] != "running"
        old_nonce = before["process"].get("nonce")
        detail = reconcile_runner(install, identity, restart)
        atomic_json(install.state / "collector-runner.json", identity)
        if not WINDOWS and os.geteuid() == 0:
            operator = linux_operator(); os.chown(install.state / 'collector-runner.json', operator.pw_uid, operator.pw_gid)
        deadline = time.monotonic() + wait_seconds
        while True:
            observed = status(install)
            if observed["state"] == "running" and (not restart or observed["process"].get("nonce") != old_nonce): break
            require(time.monotonic() < deadline, "COLLECTOR_START", "Runner has not published fresh process identity.",
                    "Inspect the owned runner; historical catalog freshness does not prove it is running.")
            time.sleep(0.25)
        result = {"state": "running", "detail": detail, "process": observed["process"], "cycle": observed["cycle"]}
    except (Blocked, OSError, ValueError, KeyError, TypeError, ET.ParseError, subprocess.SubprocessError) as exc:
        # Keep all existing configuration and history. App switch receipts remain independent.
        result = {"state": "degraded", "code": getattr(exc, "code", "COLLECTOR_IO"),
                  "detail": str(exc)[:500], "action": getattr(exc, "action", "Inspect collector configuration, permissions and the owned runner.")}
    try:
        safe_paths(install)
        atomic_json(install.state / "collector-operation.json", {"at": dt.datetime.now(dt.timezone.utc).isoformat(), **result})
        if not WINDOWS and os.geteuid() == 0:
            operator = linux_operator(); os.chown(install.state / 'collector-operation.json', operator.pw_uid, operator.pw_gid)
    except (OSError, Blocked):
        result = {**result, 'state': 'degraded', 'receiptWritten': False}
    print(f"COLLECTOR {result['state']}: {result['detail']}")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "reconcile", "status"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--profile", choices=("base", "dev", "production", "staging"))
    args = parser.parse_args(argv)
    try:
        install = Installation(args.root, args.profile)
        if args.action == "status": result = status(install)
        elif args.action == "prepare": result = prepare(install)
        else: result = reconcile(install)
    except (Blocked, OSError, ValueError, KeyError) as exc:
        result = {'state': 'degraded', 'code': getattr(exc, 'code', 'COLLECTOR_CONFIGURATION'), 'detail': str(exc)[:500]}
    print(json.dumps(result))
    return 0 if result.get("state") != "degraded" else 2


if __name__ == "__main__":
    raise SystemExit(main())
