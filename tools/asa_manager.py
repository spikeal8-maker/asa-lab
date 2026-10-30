#!/usr/bin/env python3
"""One operator entry point for portable installation and weekly maintenance."""

import argparse
import base64
import datetime as dt
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
from deployment.releases import apply_release_environment, assert_ci, discover_release, fetch_images, validate_resolved_images
from deployment.system import Installation, operation_lock, run
from deployment.collector import prepare as prepare_collector, reconcile as reconcile_collector, status as collector_status
from deployment.contracts import proxy_provenance_diagnostic
from deployment.resources import check_resources
from deployment.search_secret import InvalidSearchSecret


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
    atomic_json(install.state / "installation.json", {
        **previous, "format": "asa-installation-v1", "profile": install.profile,
        "project": install.project, "automaticUpdates": enabled,
        "window": previous.get("window", DEFAULT_WINDOW),
        "backupDirectory": str(backup),
        "instanceId": previous.get("instanceId") or uuid.uuid4().hex,
    })


def first_environment(root, profile):
    require(not (root / ".env").exists(), "ENV_EXISTS", "Private configuration already exists.", "Review it explicitly before the first installation; do not regenerate secrets.")
    admin, app = secrets.token_hex(24), secrets.token_hex(24)
    values = {"COMPOSE_PROJECT_NAME": "asa-lab-dev", "ASA_IMAGE_TAG": "local",
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
              "ASA_WEB_PORT": "4610", "ASA_API_PORT": "4611", "ASA_BLOCKS_PORT": "4613",
              "ASA_BLOCKS_PARENT_ORIGIN": "http://127.0.0.1:4610", "ASA_BLOCKS_RUNTIME_ORIGIN": "http://127.0.0.1:4610",
              "ASA_UPDATE_ENTRY_ORIGIN": "http://127.0.0.1:4610",
              "ASA_SEED_DEV": "true" if profile == "dev" else "false",
              "ASA_SEED_WORKSPACE": "school-1580", "ASA_SEED_TEACHER_EMAIL": "teacher@school-1580.local",
              "ASA_SEED_TEACHER_PASSWORD": secrets.token_hex(24)}
    descriptor = os.open(root / ".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write("# Private installation settings. Never commit or upload unencrypted.\n")
        stream.write("".join(f"{key}={value}\n" for key, value in values.items()))


def selected_source(install, release, *, existing):
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
        install.git("switch", "--detach", revision)
        if changed_tools:
            raise Blocked("RETRY_NEW_MANAGER", "The selected release includes a new manager; its code is now checked out.",
                          "Run the same command again. Containers and data have not been changed.")


def update(install, *, check=False, scheduled=False, fresh=False):
    if scheduled:
        require(install.settings.get("automaticUpdates") is True, "SCHEDULE_DISABLED", "Automatic updates are disabled.")
        if not in_window(install.settings.get("window", DEFAULT_WINDOW)):
            print("SKIP outside the maintenance window; no fetch, backup or restart")
            return
    require(not (install.state / "maintenance.json").exists(), "MAINTENANCE", "Unfinished backup/switch needs inspection.")
    require(not (install.state / "failed-switch.json").exists(), "FAILED_SWITCH", "A prior service switch failed.",
            "Inspect logs and readiness, repair the cause, then explicitly acknowledge the failure.")
    doctor(install, existing=not fresh)
    clean_checkout(install)
    backup_directory(install)
    attest_editor_env(install.env.get('ASA_UPDATE_ENTRY_ORIGIN'),
                      install.env.get('ASA_BLOCKS_PARENT_ORIGIN'),
                      install.env.get('ASA_BLOCKS_RUNTIME_ORIGIN'), install.profile)
    release = discover_release()
    assert_ci(release)
    before = None if fresh else install.readiness()
    if before:
        require(int(release['schema']) >= int(before['schema']), 'RELEASE_DOWNGRADE',
                'Published release schema is older than the running database; refusing downgrade.')
        if release['revision'] != before['revision']:
            install.git('fetch', 'origin', 'main:refs/remotes/origin/main')
            install.git('merge-base', '--is-ancestor', before['revision'], release['revision'])
    installed_path = install.state / "installed-release.json"
    installed = json.loads(installed_path.read_text(encoding="utf-8")) if installed_path.exists() else None
    same_release = bool(before and before['revision'] == release['revision'] and installed == release)
    if same_release:
        records = install.identity()
        for name, expected in release['images'].items():
            require(records.get(name, {}).get('image') == expected, 'IMAGE_DRIFT', f'Running {name} differs from the pinned release.')
        verify_embedded_entry_http(install.env['ASA_UPDATE_ENTRY_ORIGIN'], release['revision'])
    if check:
        print(f"{'NO_CHANGE' if same_release else 'AVAILABLE'} revision={release['revision']} schema={release['schema']}; read-only check, no installation changes")
        if os.name != 'nt' and not install.env.get('ASA_LOG_READER_GID'):
            print('COLLECTOR_PLAN diagnostic reader group must be prepared during an authorized update')
        return
    preparation = {'readerGroupChanged': False}
    if same_release:
        preparation = prepare_collector(install)
        install = Installation(install.root, install.profile)
    if same_release and not preparation['readerGroupChanged']:
        print("NO_CHANGE the verified release is already running; no backup or restart")
        print('USER_FLOW NOT_RUN: login, editor save and reopen require browser acceptance')
        reconcile_collector(install)
        return
    fetch_images(release)
    selected_source(install, release, existing=not fresh)
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
    install.compose("pull", "postgres", "minio-init")
    if scheduled:
        # Reserve fifteen minutes before starting any downtime. Downloading late
        # in the window is harmless; database work is never forcibly killed at 05:00.
        require(in_window(install.settings["window"], reserve_minutes=15), "WINDOW_CLOSED", "Insufficient time left to start maintenance.", "Wait for the next permitted window.")
    backup = None
    if not fresh:
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "node", "migration", "tools/migrate.mjs", "--plan")
        backup = export_backup(backup_install)
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
    atomic_json(install.state / "maintenance.json", operation)
    try:
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
        install.receipt({"status": "success", "entryOrigin": install.env['ASA_UPDATE_ENTRY_ORIGIN'],
                         "entryHttp": "pass", "userFlow": "not_run", **operation})
        (install.state / "maintenance.json").unlink()
        print(f"UPDATED {release['revision']} schema={release['schema']}")
        print('USER_FLOW NOT_RUN: login, editor save and reopen require browser acceptance')
    except BaseException:
        atomic_json(install.state / "failed-switch.json", operation)
        install.receipt({"status": "failed_switch", **operation, "automaticDatabaseRestore": False})
        raise
    # Application acceptance and diagnostic runner maintenance are independent.
    reconcile_collector(install)


def main(argv=None):
    if sys.version_info < (3, 11):
        print("Python 3.11 or newer is required.", file=sys.stderr)
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("doctor", "configure", "install", "check", "update", "backup", "verify-backup", "restore-check", "acknowledge",
                                           "review-fresh-plan", "review-fresh-apply", "review-fresh-status"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--profile", choices=("dev", "production", "staging", "base"))
    parser.add_argument("--scheduled", action="store_true")
    parser.add_argument("--enable-auto-update", action="store_true")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--database")
    parser.add_argument("--release", help="Exact published product SHA for the one-time review transition")
    parser.add_argument("--old-revision", help="Exact observed old review runtime SHA")
    parser.add_argument("--overlay-sha256", help="Approved private review overlay digest")
    parser.add_argument("--new-database", help="Unique empty database in the existing PostgreSQL volume")
    parser.add_argument("--new-bucket", help="Unique empty bucket in the existing MinIO volume")
    parser.add_argument("--plan", type=Path, help="Private exact review-fresh plan for apply")
    parser.add_argument("--review-url", help="Independent exact-SHA GitHub review for review-fresh-apply")
    args = parser.parse_args(argv)
    try:
        if args.action.startswith("review-fresh-"):
            from deployment.review_transition import apply_plan, create_plan, operation_status
            require(args.profile == "dev", "REVIEW_PROFILE", "The one-time local review transition requires --profile dev.")
            if args.action == "review-fresh-status":
                operation_status(args.root)
            elif args.action == "review-fresh-plan":
                require(all((args.release, args.old_revision, args.overlay_sha256,
                             args.new_database, args.new_bucket, args.output)), "ARGUMENT",
                        "Plan requires exact release/old revision/overlay digest, new namespace names and private output.")
                create_plan(args.root, release_sha=args.release, old_revision=args.old_revision,
                            overlay_sha256=args.overlay_sha256, database=args.new_database,
                            bucket=args.new_bucket, output=args.output)
            else:
                require(args.plan and args.output and args.review_url, "ARGUMENT", "Apply requires --plan, --review-url and a new private --output directory.")
                apply_plan(args.root, plan_path=args.plan, output=args.output, review_url=args.review_url)
            return 0
        if args.action == "verify-backup":
            require(args.backup, "ARGUMENT", "--backup is required.")
            manifest = verify_backup(args.backup)
            print(f"BACKUP_VERIFIED revision={manifest['runtime']['revision']} files={len(manifest['files'])}")
            return 0
        install = Installation(args.root, args.profile)
        with nullcontext() if args.action in ('doctor', 'check') else operation_lock(install.root):
            if args.action == "doctor":
                doctor(install)
            elif args.action == "configure":
                doctor(install)
                save_settings(install, args.enable_auto_update)
                print("CONFIGURED window=Sunday 03:00-05:00 Moscow; install the OS scheduler separately")
            elif args.action == "install":
                require(not install.identity(existing=False), "ALREADY_INSTALLED", "Use update for the existing installation.")
                if not install.env:
                    first_environment(install.root, install.profile)
                update(Installation(install.root, install.profile), fresh=True)
            elif args.action in ("check", "update"):
                update(install, check=args.action == "check", scheduled=args.scheduled)
            elif args.action == "backup":
                export_backup(install, args.output)
            elif args.action == "restore-check":
                require(args.backup and args.database, "ARGUMENT", "--backup and a new --database ending in _test are required.")
                restore_check(install, args.backup, args.database)
            elif args.action == "acknowledge":
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
        print(f"BLOCKED {code}: {exc}\nSAFE_ACTION: {action}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
