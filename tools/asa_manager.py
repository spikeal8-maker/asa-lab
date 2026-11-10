#!/usr/bin/env python3
"""One operator entry point for portable installation and weekly maintenance."""

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import stat
import sys
import uuid
from contextlib import nullcontext

from deployment.backup import export_backup, recovery_configuration, restore_check
from deployment.contracts import DEFAULT_WINDOW, REPOSITORY, Blocked, atomic_json, attest_editor_env, exact_origin, in_window, require, verify_backup, verify_embedded_entry_http
from deployment.releases import apply_release_environment, assert_ci, discover_release, fetch_images, validate_deployment_digest, validate_resolved_images
from deployment.paths import atomic_json as private_atomic_json, plain_paths
from deployment import releases as release_transport
from deployment.system import Installation, operation_lock, run
from deployment.collector import prepare as prepare_collector, reconcile as reconcile_collector, status as collector_status, select_root_mode
from deployment.contracts import proxy_provenance_diagnostic
from deployment.resources import check_resources
from deployment.search_secret import InvalidSearchSecret
from deployment.fresh_install import fresh_options, assert_clean_install_destination, provision_private_network_overlay
from deployment.repair_plan import diagnose as diagnose_recovery
from deployment.import_preflight import validate_import_archive
from deployment.import_target_plan import plan_transfer
from deployment import application_rollback


def clean_checkout(install):
    require(not install.git("status", "--porcelain"), "DIRTY", "The checkout contains local changes.", "Commit or preserve the changes; never reset/clean them automatically.")
    require(install.git("remote", "get-url", "origin").removesuffix(".git") in (
        f"https://github.com/{REPOSITORY}", f"git@github.com:{REPOSITORY}"), "ORIGIN", "Unexpected Git repository.")


def doctor(install, existing=True):
    run(["docker", "version", "--format", "{{.Server.Version}}"], capture=True)
    run(["docker", "compose", "version"], capture=True)
    records = install.identity(existing=existing)
    check_resources(install, records)
    free = shutil.disk_usage(install.root).free
    print(f"INSTALLATION root={install.root} project={install.project} profile={install.profile}")
    print(f"DISK checkout_free_gib={free / 1024**3:.1f}; Docker data disk must also have space for images, objects and restore")
    collection = collector_status(install)
    print(f"COLLECTOR {collection['state']}: {collection['detail']}")
    print('CLIENT_PROVENANCE ' + json.dumps(proxy_provenance_diagnostic(install.env), sort_keys=True))
    require(free >= 2 * 1024**3, "SPACE", "Less than 2 GiB free beside the checkout.")
    if existing:
        ready = install.readiness()
        print(f"READY revision={ready['revision']} schema={ready['schema']}")
    return records


def backup_directory(install, *, create=False):
    backup = Path(install.settings.get("backupDirectory", str(install.root / "backups")))
    require(backup.is_absolute(), "BACKUP_PATH", "Backup directory must be absolute.")
    for component in (backup, *backup.parents):
        try:
            metadata = component.lstat()
        except FileNotFoundError:
            continue
        require(not component.is_symlink() and not getattr(metadata, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0),
                "BACKUP_PATH", "Backup directory must not traverse symlinks or reparse points.")
    # Expand Windows 8.3 aliases without treating them as symlink traversal.
    backup = backup.resolve()
    if not backup.exists():
        require(backup.parent.is_dir(), "BACKUP_DIRECTORY", "Backup parent directory must already exist.")
        if create:
            backup.mkdir(mode=0o700)
    if backup.exists():
        require(backup.is_dir(), "BACKUP_DIRECTORY", "Backup path is not a directory.")
        if os.name != 'nt':
            require(backup.stat().st_uid == os.getuid() and backup.stat().st_mode & 0o077 == 0,
                    "BACKUP_PERMISSIONS", "Backup directory must belong to the operator and have mode 0700.")
    return backup


def save_settings(install, enabled=False):
    previous = install.settings
    backup = backup_directory(install, create=True)
    private_atomic_json(install.state / "installation.json", {
        **previous, "format": "asa-installation-v1", "profile": install.profile,
        "project": install.project, "automaticUpdates": enabled,
        "window": previous.get("window", DEFAULT_WINDOW),
        "backupDirectory": str(backup),
        "instanceId": previous.get("instanceId") or uuid.uuid4().hex,
    })


def first_environment(root, profile, *, project="asa-lab-dev", web_port=4610, blocks_port=4613):
    spec = fresh_options(project, web_port, blocks_port)
    require(not (root / ".env").exists(), "ENV_EXISTS", "Private configuration already exists.", "Review it explicitly before the first installation; do not regenerate secrets.")
    admin, app = secrets.token_hex(24), secrets.token_hex(24)
    values = {"COMPOSE_PROJECT_NAME": spec["project"], "ASA_IMAGE_TAG": "local",
              "POSTGRES_DB": "asalab", "POSTGRES_USER": "asalab_admin", "POSTGRES_PASSWORD": admin,
              "ASA_APP_DB_PASSWORD": app,
              "MIGRATION_DATABASE_URL": f"postgres://asalab_admin:{admin}@postgres:5432/asalab",
              "MIGRATION_EXPECT_DATABASE": "asalab", "MIGRATION_CONFIRM": "APPLY:asalab",
              "APP_DATABASE_URL": f"postgres://asalab_app:{app}@postgres:5432/asalab",
              "CLASSROOM_CODE_SECRET": secrets.token_hex(32),
              "ASA_STUDENT_CODE_PROTECTION_MODE": "compat",
              "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON": json.dumps({"initial-v1": base64.b64encode(secrets.token_bytes(32)).decode()}, separators=(",", ":")),
              "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID": "initial-v1",
              "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON": json.dumps({"initial-v1": base64.b64encode(secrets.token_bytes(32)).decode()}, separators=(",", ":")),
              "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID": "initial-v1",
              "ASA_SETTINGS_ENCRYPTION_KEY": secrets.token_hex(32),
              "ASA_BLOCKS_RUNTIME_SIGNING_KEY": secrets.token_hex(32),
              "ASA_SEARCH_SECRET": secrets.token_hex(32),
              "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000", "ASA_OBJECT_STORAGE_REGION": "us-east-1",
              "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks", "ASA_OBJECT_STORAGE_ACCESS_KEY": secrets.token_hex(16),
              "ASA_OBJECT_STORAGE_SECRET_KEY": secrets.token_hex(32), "ASA_OBJECT_STORAGE_FORCE_PATH_STYLE": "true",
              "ASA_WEB_PORT": str(spec["web"]), "ASA_API_PORT": str(spec["api"]),
              "ASA_BLOCKS_PORT": str(spec["blocks"]),
              "ASA_BLOCKS_PARENT_ORIGIN": spec["origin"], "ASA_BLOCKS_RUNTIME_ORIGIN": spec["origin"],
              "ASA_UPDATE_ENTRY_ORIGIN": spec["origin"],
              "ASA_SEED_DEV": "true" if profile == "dev" else "false",
              "ASA_SEED_WORKSPACE": "school-1580", "ASA_SEED_TEACHER_EMAIL": "teacher@school-1580.local",
              "ASA_SEED_TEACHER_PASSWORD": secrets.token_hex(24)}
    descriptor = os.open(root / ".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write("# Private installation settings. Never commit or upload unencrypted.\n")
        stream.write("".join(f"{key}={value}\n" for key, value in values.items()))


def pending_selection(install):
    path = install.state / 'release-selection.json'
    plain_paths(install.root, ('.asa/release-selection.json',))
    if not path.exists():
        return None
    require(path.is_file() and path.stat().st_size <= 4096, 'RELEASE_SELECTION_PENDING', 'Invalid pending release selection.')
    saved = json.loads(path.read_text(encoding='utf-8'))
    require(isinstance(saved, dict) and set(saved) == {'format', 'deploymentDigest', 'releaseSha256'}
            and saved['format'] == 'asa-release-selection-v1', 'RELEASE_SELECTION_PENDING', 'Invalid pending release selection.')
    validate_deployment_digest(saved['deploymentDigest'])
    import re
    require(isinstance(saved['releaseSha256'], str) and re.fullmatch(r'[a-f0-9]{64}', saved['releaseSha256']),
            'RELEASE_SELECTION_PENDING', 'Invalid pending manifest fingerprint.')
    return saved


def selection_record(digest, release):
    return {'format': 'asa-release-selection-v1', 'deploymentDigest': validate_deployment_digest(digest),
            'releaseSha256': hashlib.sha256(json.dumps(release, sort_keys=True, separators=(',', ':'),
                                                     allow_nan=False).encode()).hexdigest()}


def resolve_selection(install, digest):
    if digest is not None:
        validate_deployment_digest(digest)
    pending = pending_selection(install)
    if pending is not None:
        require(digest is None or digest == pending['deploymentDigest'],
                'RELEASE_SELECTION_PENDING', 'A different immutable release continuation is pending.')
        digest = pending['deploymentDigest']
    if digest is not None:
        require(discover_release is release_transport.discover_release, 'RELEASE_SELECTOR_TRANSPORT',
                'Explicit CLI selection cannot be combined with an externally pinned discovery adapter.',
                'Use the canonical selector-aware CLI with the same digest; do not discard either selection.')
    return digest, pending


def sync_selection(install):
    # Persist the directory entry before Git can switch to a different manager.
    # Windows retains atomic replacement/file flush; power-loss qualification
    # of its filesystem remains separate from process-restart continuation.
    if os.name != 'nt':
        for path in (install.state, install.root):
            descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)


def finish_selection(install, digest, release):
    pending = pending_selection(install) if digest is not None else None
    if pending is not None:
        require(pending == selection_record(digest, release), 'RELEASE_SELECTION_PENDING',
                'Continuation selection changed; refusing to discard it.')
        (install.state / 'release-selection.json').unlink()
        sync_selection(install)


def selected_source(install, release, *, existing, deployment_digest=None):
    clean_checkout(install)
    install.git("fetch", "origin", "main:refs/remotes/origin/main")
    revision = release["revision"]
    # A release must be in canonical main history; registry contents cannot choose arbitrary code.
    install.git("merge-base", "--is-ancestor", revision, "origin/main")
    current = install.git("rev-parse", "HEAD")
    if current != revision:
        if existing:
            runtime = install.readiness()
            running = runtime["revision"]
            install.git("merge-base", "--is-ancestor", running, revision)
            atomic_json(install.state / "runtime-configuration.json", recovery_configuration(install, runtime))
        changed_tools = install.git("diff", "--name-only", current, revision, "--", "tools/asa_manager.py", "tools/deployment")
        if changed_tools and deployment_digest is not None:
            saved = selection_record(deployment_digest, release)
            prior = pending_selection(install)
            require(prior is None or prior == saved, 'RELEASE_SELECTION_PENDING', 'Pending selection differs; refusing to replace it.')
            private_atomic_json(install.state / 'release-selection.json', saved)
            sync_selection(install)
        install.git("switch", "--detach", revision)
        if changed_tools:
            raise Blocked("RETRY_NEW_MANAGER", "The selected release includes a new manager; its code is now checked out.",
                          "Run the same command again. Containers and data have not been changed.")


def verify_running_release(install, release):
    records = install.identity()
    for name, expected in release['images'].items():
        require(records.get(name, {}).get('image') == expected, 'IMAGE_DRIFT',
                f'Running {name} differs from the pinned release.')
    verify_embedded_entry_http(install.env['ASA_UPDATE_ENTRY_ORIGIN'], release['revision'])


def update(install, *, check=False, scheduled=False, fresh=False, deployment_digest=None,
           require_application_rollback=False, operator=False):
    require(not require_application_rollback or not (fresh or scheduled),
            'ROLLBACK_ARGUMENT', 'Application return preparation belongs only to a manual existing P0 update.')
    application_rollback.guard_update(install)
    if scheduled:
        require(install.settings.get("automaticUpdates") is True, "SCHEDULE_DISABLED", "Automatic updates are disabled.")
        if not in_window(install.settings.get("window", DEFAULT_WINDOW)):
            print("SKIP outside the maintenance window; no fetch, backup or restart")
            return
    require(not (install.state / "maintenance.json").exists(), "MAINTENANCE", "Unfinished backup/switch needs inspection.")
    require(not (install.state / "failed-switch.json").exists(), "FAILED_SWITCH", "A prior service switch failed.",
            "Inspect logs and readiness, repair the cause, then explicitly acknowledge the failure.")
    deployment_digest, pending = resolve_selection(install, deployment_digest)
    doctor(install, existing=not fresh)
    clean_checkout(install)
    backup_directory(install)
    attest_editor_env(install.env.get('ASA_UPDATE_ENTRY_ORIGIN'),
                      install.env.get('ASA_BLOCKS_PARENT_ORIGIN'),
                      install.env.get('ASA_BLOCKS_RUNTIME_ORIGIN'), install.profile)
    release = discover_release(deployment_digest) if deployment_digest is not None else discover_release()
    if pending is not None:
        require(selection_record(deployment_digest, release) == pending, 'RELEASE_SELECTION_MISMATCH',
                'The rediscovered immutable manifest differs from the pending selection.')
    before = None if fresh else install.readiness()
    if operator:
        print(f"Установлено: {before['revision'][:8]}, схема базы {before['schema']}.", flush=True)
        print(f"Проверяем выпуск {release['revision'][:8]}, схема базы {release['schema']}.", flush=True)
    if before:
        require(int(release['schema']) >= int(before['schema']), 'RELEASE_DOWNGRADE',
                'Published release schema is older than the running database; refusing downgrade.')
    installed_path = install.state / "installed-release.json"
    installed = json.loads(installed_path.read_text(encoding="utf-8")) if installed_path.exists() else None
    same_release = bool(before and before['revision'] == release['revision'] and installed == release)
    if operator and same_release:
        verify_running_release(install, release)
        if not check:
            finish_selection(install, deployment_digest, release)
        print('Этот выпуск уже установлен и отвечает. Обновление не требуется.')
        return
    # An already accepted, identical release needs no new GitHub CI query for a
    # no-op update. The local release identity, images and entry are still checked
    # below. All real updates, checks, rollback preparation and collector repairs
    # continue to require fresh CI evidence.
    verified_no_change = bool(same_release and not check and not require_application_rollback
                              and collector_status(install)['state'] == 'running')
    if verified_no_change:
        # No maintenance or collector preparation on this path: it only attests
        # the already running release and records an idempotent no-change result.
        records = install.identity()
        for name, expected in release['images'].items():
            require(records.get(name, {}).get('image') == expected, 'IMAGE_DRIFT',
                    f'Running {name} differs from the pinned release.')
        verify_embedded_entry_http(install.env['ASA_UPDATE_ENTRY_ORIGIN'], release['revision'])
        print("NO_CHANGE the verified release is already running; no backup or restart")
        print('USER_FLOW NOT_RUN: login, editor save and reopen require browser acceptance')
        from deployment.operational import append_safely, from_manager_receipt, stamp
        append_safely(install.root, from_manager_receipt({'status':'success', 'at':stamp(),
            'trigger':'automatic' if scheduled else 'manual', 'phase':'verify_entry',
            'selected':release, 'previous':before}))
        finish_selection(install, deployment_digest, release)
        return
    assert_ci(release)
    if before and release['revision'] != before['revision']:
        install.git('fetch', 'origin', 'main:refs/remotes/origin/main')
        install.git('merge-base', '--is-ancestor', before['revision'], release['revision'])
    if same_release:
        records = install.identity()
        for name, expected in release['images'].items():
            require(records.get(name, {}).get('image') == expected, 'IMAGE_DRIFT', f'Running {name} differs from the pinned release.')
        verify_embedded_entry_http(install.env['ASA_UPDATE_ENTRY_ORIGIN'], release['revision'])
    if check:
        if require_application_rollback:
            require(not same_release, 'ROLLBACK_NO_SWITCH', 'The reversible update must select the declared next P0 release.')
            fetch_images(release)
            application_rollback.prepare_candidate(install, release, deployment_digest)
            print('APPLICATION_RETURN_PREFLIGHT pass; a new verified backup and durable operation capsule are still required at update')
        print(f"{'NO_CHANGE' if same_release else 'AVAILABLE'} revision={release['revision']} schema={release['schema']}; read-only check, no installation changes")
        if os.name != 'nt' and not install.env.get('ASA_LOG_READER_GID'):
            print('COLLECTOR_PLAN diagnostic reader group must be prepared during an authorized update')
        if operator:
            print('Обновление доступно. Проверка выпуска и возврата пройдена. Для установки выполните asa update.')
        return
    preparation = {'readerGroupChanged': False}
    if same_release:
        preparation = prepare_collector(install)
        install = Installation(install.root, install.profile)
    if same_release and not preparation['readerGroupChanged']:
        print("NO_CHANGE the verified release is already running; no backup or restart")
        print('USER_FLOW NOT_RUN: login, editor save and reopen require browser acceptance')
        reconcile_collector(install)
        # A real verified no-change update has an outcome too. Do not replace
        # its original switch/backup receipt or manufacture a backup.
        from deployment.operational import append_safely, from_manager_receipt, stamp
        append_safely(install.root, from_manager_receipt({'status':'success', 'at':stamp(),
            'trigger':'automatic' if scheduled else 'manual', 'phase':'verify_entry',
            'selected':release, 'previous':before}))
        finish_selection(install, deployment_digest, release)
        return
    fetch_images(release)
    rollback_candidate = None
    if require_application_rollback:
        require(not same_release, 'ROLLBACK_NO_SWITCH', 'The reversible update must select the declared next P0 release.')
        rollback_candidate = application_rollback.prepare_candidate(install, release, deployment_digest)
    if deployment_digest is None:
        selected_source(install, release, existing=not fresh)
    else:
        selected_source(install, release, existing=not fresh, deployment_digest=deployment_digest)
    install = Installation(install.root, install.profile)
    selected_preparation = prepare_collector(install)
    preparation['readerGroupChanged'] = preparation['readerGroupChanged'] or selected_preparation['readerGroupChanged']
    install = Installation(install.root, install.profile)
    for key in ("ASA_BLOCKS_PARENT_ORIGIN", "ASA_BLOCKS_RUNTIME_ORIGIN"):
        if key in install.env:
            exact_origin(install.env[key])
    # Backup and its finally/readiness path still belong to the installed
    # runtime. Target-only images (for example a newly introduced search
    # service) must not become requirements of the previous application.
    backup_install = None if fresh else Installation(install.root, install.profile)
    apply_release_environment(install, release)
    validate_resolved_images(install, release)
    check_resources(install, install.identity(existing=not fresh))
    # Download support images while the previous application remains available.
    if not require_application_rollback:
        install.compose("pull", "postgres", "minio-init")
    if scheduled:
        # Reserve fifteen minutes before starting any downtime. Downloading late
        # in the window is harmless; database work is never forcibly killed at 05:00.
        require(in_window(install.settings["window"], reserve_minutes=15), "WINDOW_CLOSED", "Insufficient time left to start maintenance.", "Wait for the next permitted window.")
    backup = None
    if not fresh:
        if not require_application_rollback:
            install.compose("run", "--rm", "--no-deps", "--entrypoint", "node", "migration", "tools/migrate.mjs", "--plan")
        backup = export_backup(backup_install, trigger='automatic' if scheduled else 'manual')
        if scheduled:
            require(in_window(install.settings["window"], reserve_minutes=10), "WINDOW_CLOSED", "Backup completed too late to start the update.", "The existing version was restarted; retry next window.")
    if "search" in release["images"]:
        # Authorized mutation only, after the old private.env has been backed up.
        # Existing keys are never rotated, including during a routine update.
        from deployment.search_secret import ensure_secret
        ensure_secret(install.root / ".env")
        from deployment.contracts import read_env
        install.env.update(read_env(install.root / ".env"))
        install.process_env["ASA_SEARCH_SECRET"] = install.env["ASA_SEARCH_SECRET"]
    # The receipt captures the actual running version, not the checkout revision.
    operation = {"phase": "switch", "previous": before, "selected": release, "backup": str(backup) if backup else None,
                 "diagnosticReaderGroupChanged": preparation['readerGroupChanged']}
    if deployment_digest is not None:
        operation['deploymentDigest'] = deployment_digest
    rollback_journal = None
    if rollback_candidate is not None:
        rollback_journal = application_rollback.begin(install, rollback_candidate, backup, operation)
    atomic_json(install.state / "maintenance.json", operation)
    try:
        if rollback_journal is not None:
            application_rollback.switch_forward(install, rollback_journal)
        else:
            if not fresh:
                install.compose("stop", "web", "api", "scratch")
            install.compose("up", "-d", "--no-build")
        install.wait_ready(release["revision"], release["schema"])
        operation["phase"] = "verify_entry"
        atomic_json(install.state / "maintenance.json", operation)
        verify_embedded_entry_http(install.env['ASA_UPDATE_ENTRY_ORIGIN'], release['revision'])
        install.identity()
        atomic_json(install.state / "installed-release.json", release)
        save_settings(install, install.settings.get("automaticUpdates", False))
        install.receipt({"status": "success", "trigger": "automatic" if scheduled else "manual", "entryOrigin": install.env['ASA_UPDATE_ENTRY_ORIGIN'],
                         "entryHttp": "pass", "userFlow": "not_run", **operation})
        if rollback_journal is not None:
            application_rollback.forward_accepted(install, rollback_journal)
        (install.state / "maintenance.json").unlink()
        finish_selection(install, deployment_digest, release)
        print(f"UPDATED {release['revision']} schema={release['schema']}")
        if operator:
            print(f"ASA Lab обновлён до {release['revision'][:8]} и отвечает. Схема базы {release['schema']}.")
        print('USER_FLOW NOT_RUN: login, editor save and reopen require browser acceptance')
    except BaseException:
        atomic_json(install.state / "failed-switch.json", operation)
        install.receipt({"status": "failed_switch", "trigger": "automatic" if scheduled else "manual", **operation, "automaticDatabaseRestore": False})
        raise
    # Application acceptance and diagnostic runner maintenance are independent.
    if rollback_journal is None:
        reconcile_collector(install)


def run_operator(install, action, deployment_digest):
    digest, _ = resolve_selection(install, deployment_digest)
    if digest is None:
        digest = release_transport.published_deployment_digest()
    for attempt in range(2):
        try:
            return update(install, check=action == 'check', deployment_digest=digest,
                          require_application_rollback=True, operator=True)
        except Blocked as error:
            if action != 'update' or attempt or error.code != 'RETRY_NEW_MANAGER':
                raise
            pending = pending_selection(install)
            require(pending is not None and pending['deploymentDigest'] == digest,
                    'RELEASE_SELECTION_PENDING', 'The saved release does not match the running update.')
            # The approved external manager remains loaded. Only the installation checkout changed.
            print('Исходники выпуска подготовлены. Продолжаем установку того же выпуска.', flush=True)
            install = Installation(install.root, install.profile)


def operator_failure(code):
    if code in ('ROLLBACK_PENDING', 'MAINTENANCE', 'FAILED_SWITCH'):
        return 'Предыдущая операция ещё не завершена. Сначала проверьте план возврата или восстановления.'
    if code in ('ROLLBACK_RUNTIME', 'ROLLBACK_QUALIFICATION', 'ROLLBACK_PAIR', 'ROLLBACK_SELECTION'):
        return 'Для этой пары версий пока не подтверждён штатный возврат. Установка остановлена.'
    if code == 'ROLLBACK_EXTERNAL_TOOLS':
        return 'Нужен отдельный проверенный каталог инструментов обновления. Обратитесь к администратору.'
    if code.startswith('CI_'):
        return 'Не удалось подтвердить проверки этого выпуска на GitHub. Установка остановлена.'
    if code == 'LOCKED':
        return 'Другая операция обслуживания уже выполняется.'
    return 'Операция остановлена. Код и технические подробности приведены ниже.'


def main(argv=None):
    if sys.version_info < (3, 11):
        print("Python 3.11 or newer is required.", file=sys.stderr)
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("doctor", "configure", "install", "check", "update", "backup", "verify-backup", "restore-check", "repair-plan", "import-preflight", "import-target-plan", "acknowledge", "rollback-plan", "rollback"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--profile", choices=("dev", "production", "staging", "base"))
    parser.add_argument("--scheduled", action="store_true")
    parser.add_argument("--deployment-digest", help="Exact canonical deployment OCI sha256 digest; install/check/update only")
    parser.add_argument("--require-application-rollback", action="store_true",
                        help="Fail closed unless the declared P0 application return can be armed; manual check/update only")
    parser.add_argument("--operator", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--enable-auto-update", action="store_true")
    parser.add_argument("--collector-mode", choices=('system-root',), help="Explicit root-operated Linux diagnostic runner; never grants another user Docker access")
    parser.add_argument("--collector-reader-gid", type=int, help="Nonzero API read-only diagnostic group for explicit system-root mode")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--database")
    parser.add_argument("--install-project", help="Unique Compose project for first installation only")
    parser.add_argument("--install-web-port", type=int, help="Fresh localhost Web port")
    parser.add_argument("--install-blocks-port", type=int, help="Fresh localhost Scratch port")
    parser.add_argument("--install-network-cidrs", help="Opt-in private Docker-only database, application, scratch network CIDRs")
    args = parser.parse_args(argv)
    try:
        if args.operator:
            require(args.action in ('check', 'update') and not args.scheduled and args.profile == 'production'
                    and not args.enable_auto_update and args.collector_mode is None,
                    'OPERATOR_ARGUMENT', 'The operator flow is only for manual check and update on production.')
            args.require_application_rollback = True
        require(not args.require_application_rollback or args.action in ('check', 'update') and not args.scheduled,
                'ROLLBACK_ARGUMENT', '--require-application-rollback belongs only to manual check/update.')
        if args.action in ('rollback-plan', 'rollback') or args.require_application_rollback:
            require(not args.scheduled and not args.enable_auto_update and args.collector_mode is None,
                    'ROLLBACK_ARGUMENT', 'Application return is manual and cannot change automatic updates or collector configuration.')
            original_arguments = argv if argv is not None else sys.argv[1:]
            require(any(value == '--root' or str(value).startswith('--root=') for value in original_arguments),
                    'ROLLBACK_ROOT', 'Specify the existing installation with --root from the pinned separate tools checkout.')
            plain_paths(args.root, ('.asa/operation.lock', '.asa/application-rollback.json'))
        require(args.deployment_digest is None or args.action in ('install', 'check', 'update'),
                'RELEASE_SELECTOR', '--deployment-digest belongs only to install/check/update.')
        if args.deployment_digest is not None:
            validate_deployment_digest(args.deployment_digest)
        require((args.collector_mode is None) == (args.collector_reader_gid is None), 'COLLECTOR_ARGUMENT',
                '--collector-mode and --collector-reader-gid must be selected together.')
        require(args.collector_mode is None or args.action in ('install', 'update'), 'COLLECTOR_ARGUMENT',
                'Collector mode selection belongs only to an authorized install/update action.')
        if args.action == "verify-backup":
            require(args.backup, "ARGUMENT", "--backup is required.")
            manifest = verify_backup(args.backup)
            print(f"BACKUP_VERIFIED revision={manifest['runtime']['revision']} files={len(manifest['files'])}")
            return 0
        if args.action == "import-preflight":
            require(args.backup, "ARGUMENT", "--backup is required for read-only full archive verification.")
            print("IMPORT_PREFLIGHT " + json.dumps(validate_import_archive(args.backup), sort_keys=True))
            return 0
        if args.action == "import-target-plan":
            original_arguments = argv if argv is not None else sys.argv[1:]
            require(any(value == "--root" or str(value).startswith("--root=")
                        for value in original_arguments), "IMPORT_TARGET_ROOT_REQUIRED",
                    "Specify the new destination directory explicitly with --root; defaults are forbidden.")
            require(args.backup and args.profile and args.install_project
                    and args.install_web_port is not None and args.install_blocks_port is not None,
                    "ARGUMENT",
                    "Read-only target plan requires --backup, --profile, --install-project, --install-web-port and --install-blocks-port.")
            report = plan_transfer(args.backup, args.root, profile=args.profile,
                                   project=args.install_project,
                                   web_port=args.install_web_port,
                                   blocks_port=args.install_blocks_port)
            print("IMPORT_TARGET_PLAN " + json.dumps(report, sort_keys=True))
            return 0
        install = Installation(args.root, args.profile)
        if args.operator:
            require(install.settings.get('profile') == 'production', 'OPERATOR_INSTALLATION',
                    'The operator flow requires an existing installation with the production profile.')
        if args.action in ('rollback-plan', 'rollback') or args.require_application_rollback:
            application_rollback.attest_private_state(install)
        if args.action in ('install', 'check', 'update'):
            args.deployment_digest, _ = resolve_selection(install, args.deployment_digest)
        with nullcontext() if args.action in ('doctor', 'check', 'repair-plan', 'rollback-plan') else operation_lock(install.root):
            if args.action in ('install', 'check', 'update'):
                args.deployment_digest, _ = resolve_selection(install, args.deployment_digest)
            if args.action == "doctor":
                doctor(install)
            elif args.action == "repair-plan":
                # Strictly observational: no write lock, backup/restore, daemon
                # command or acknowledgement of the unfinished transaction.
                return diagnose_recovery(install)
            elif args.action in ('rollback-plan', 'rollback'):
                application_rollback.rollback(install, check=args.action == 'rollback-plan')
            elif args.action == "configure":
                doctor(install)
                save_settings(install, args.enable_auto_update)
                print("CONFIGURED window=Sunday 03:00-05:00 Moscow; install the OS scheduler separately")
            elif args.action == "install":
                if not install.env:
                    spec = fresh_options(args.install_project or "asa-lab-dev",
                                         args.install_web_port if args.install_web_port is not None else 4610,
                                         args.install_blocks_port if args.install_blocks_port is not None else 4613)
                    clean_checkout(install)
                    assert_clean_install_destination(install.root, spec)
                    if args.install_network_cidrs:
                        provision_private_network_overlay(install.root, args.install_network_cidrs)
                    first_environment(install.root, install.profile, project=spec["project"],
                                      web_port=spec["web"], blocks_port=spec["blocks"])
                    install = Installation(install.root, install.profile)
                else:
                    require(args.install_network_cidrs is None, "FRESH_NETWORK_EXISTS",
                            "An existing private environment cannot change its Docker network CIDRs.")
                    require(args.install_project is None or args.install_project == install.project,
                            "FRESH_PROJECT", "Selected project differs from existing private .env.")
                    require(args.install_web_port is None or str(args.install_web_port) == install.env.get("ASA_WEB_PORT"),
                            "FRESH_PORT", "Selected Web port differs from saved private .env.")
                    require(args.install_blocks_port is None or str(args.install_blocks_port) == install.env.get("ASA_BLOCKS_PORT"),
                            "FRESH_PORT", "Selected Scratch port differs from saved private .env.")
                require(not install.identity(existing=False), "ALREADY_INSTALLED",
                        "An ASA installation already exists. Use update for this canonical directory.")
                if args.collector_mode:
                    select_root_mode(install, args.collector_reader_gid)
                    install = Installation(install.root, install.profile)
                update(install, fresh=True, **({'deployment_digest': args.deployment_digest} if args.deployment_digest is not None else {}))
            elif args.action in ("check", "update"):
                if args.collector_mode:
                    select_root_mode(install, args.collector_reader_gid)
                    install = Installation(install.root, install.profile)
                if args.operator:
                    run_operator(install, args.action, args.deployment_digest)
                else:
                    update(install, check=args.action == "check", scheduled=args.scheduled,
                           **({'require_application_rollback': True} if args.require_application_rollback else {}),
                           **({'deployment_digest': args.deployment_digest} if args.deployment_digest is not None else {}))
            elif args.action == "backup":
                export_backup(install, args.output)
            elif args.action == "restore-check":
                require(args.backup and args.database, "ARGUMENT", "--backup and a new --database ending in _test are required.")
                restore_check(install, args.backup, args.database)
            elif args.action == "acknowledge":
                application_rollback.guard_acknowledge(install)
                doctor(install)
                pending = install.state / "maintenance.json"
                if pending.exists():
                    operation = json.loads(pending.read_text(encoding="utf-8"))
                    ready = install.readiness()
                    allowed = [value for value in (operation.get("previous"), operation.get("selected")) if value]
                    require(operation.get("phase") in ("switch", "verify_entry") and any(ready["revision"] == value.get("revision") for value in allowed),
                            "MAINTENANCE", "Unfinished backup or unexpected runtime still needs operator recovery.")
                    pending.rename(install.state / ("reviewed-" + dt.datetime.now().strftime("%Y%m%d%H%M%S") + ".json"))
                marker = install.state / "failed-switch.json"
                if marker.exists():
                    marker.rename(install.state / ("acknowledged-" + dt.datetime.now().strftime("%Y%m%d%H%M%S") + ".json"))
        return 0
    except (Blocked, OSError, ValueError, KeyError) as exc:
        code = (exc.code if isinstance(exc, Blocked) else
                "SEARCH_SECRET_INVALID" if isinstance(exc, InvalidSearchSecret) else "IO_OR_CONFIGURATION")
        action = exc.action if isinstance(exc, Blocked) else "Inspect the configuration and completed stages; do not discard data."
        if args.operator:
            print(operator_failure(code), file=sys.stderr)
        print(f"BLOCKED {code}: {exc}\nSAFE_ACTION: {action}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
