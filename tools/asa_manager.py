#!/usr/bin/env python3
"""One operator entry point for portable installation and weekly maintenance."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import secrets
import shutil
import sys

from deployment.backup import export_backup, recovery_configuration, restore_check
from deployment.contracts import DEFAULT_WINDOW, REPOSITORY, Blocked, atomic_json, exact_origin, in_window, require, verify_backup
from deployment.releases import apply_release_environment, assert_ci, discover_release, fetch_images, validate_resolved_images
from deployment.system import Installation, operation_lock, run


def clean_checkout(install):
    require(not install.git("status", "--porcelain"), "DIRTY", "The checkout contains local changes.", "Commit or preserve the changes; never reset/clean them automatically.")
    require(install.git("remote", "get-url", "origin").removesuffix(".git") in (
        f"https://github.com/{REPOSITORY}", f"git@github.com:{REPOSITORY}"), "ORIGIN", "Unexpected Git repository.")


def doctor(install, existing=True):
    run(["docker", "version", "--format", "{{.Server.Version}}"], capture=True)
    run(["docker", "compose", "version"], capture=True)
    records = install.identity(existing=existing)
    free = shutil.disk_usage(install.root).free
    print(f"INSTALLATION root={install.root} project={install.project} profile={install.profile}")
    print(f"DISK checkout_free_gib={free / 1024**3:.1f}; Docker data disk must also have space for images, objects and restore")
    require(free >= 2 * 1024**3, "SPACE", "Less than 2 GiB free beside the checkout.")
    if existing:
        ready = install.readiness()
        print(f"READY revision={ready['revision']} schema={ready['schema']}")
    return records


def save_settings(install, enabled=False):
    previous = install.settings
    atomic_json(install.state / "installation.json", {
        **previous, "format": "asa-installation-v1", "profile": install.profile,
        "project": install.project, "automaticUpdates": enabled,
        "window": previous.get("window", DEFAULT_WINDOW),
        "backupDirectory": previous.get("backupDirectory", str(install.root / "backups")),
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
              "ASA_SETTINGS_ENCRYPTION_KEY": secrets.token_hex(32),
              "ASA_BLOCKS_RUNTIME_SIGNING_KEY": secrets.token_hex(32),
              "ASA_OBJECT_STORAGE_ENDPOINT": "http://minio:9000", "ASA_OBJECT_STORAGE_REGION": "us-east-1",
              "ASA_OBJECT_STORAGE_BUCKET": "asa-blocks", "ASA_OBJECT_STORAGE_ACCESS_KEY": secrets.token_hex(16),
              "ASA_OBJECT_STORAGE_SECRET_KEY": secrets.token_hex(32), "ASA_OBJECT_STORAGE_FORCE_PATH_STYLE": "true",
              "ASA_WEB_PORT": "4610", "ASA_API_PORT": "4611", "ASA_BLOCKS_PORT": "4613",
              "ASA_BLOCKS_PARENT_ORIGIN": "http://127.0.0.1:4610", "ASA_BLOCKS_RUNTIME_ORIGIN": "http://localhost:4613",
              "ASA_PUBLIC_WEB_ORIGINS": "http://127.0.0.1:4610",
              "ASA_SEED_DEV": "true" if profile == "dev" else "false",
              "ASA_SEED_WORKSPACE": "school-1580", "ASA_SEED_TEACHER_EMAIL": "teacher@school-1580.local",
              "ASA_SEED_TEACHER_PASSWORD": secrets.token_hex(24)}
    descriptor = os.open(root / ".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write("# Private installation settings. Never commit or upload unencrypted.\n")
        stream.write("".join(f"{key}={value}\n" for key, value in values.items()))


def selected_source(install, release, *, existing):
    clean_checkout(install)
    install.git("fetch", "origin", "main")
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
    release = discover_release()
    assert_ci(release)
    before = None if fresh else install.readiness()
    installed_path = install.state / "installed-release.json"
    installed = json.loads(installed_path.read_text(encoding="utf-8")) if installed_path.exists() else None
    if before and before["revision"] == release["revision"] and installed == release:
        records = install.identity()
        for name, expected in release["images"].items():
            require(records.get(name, {}).get("image") == expected, "IMAGE_DRIFT", f"Running {name} differs from the pinned release.")
        print("NO_CHANGE the verified release is already running; no backup or restart")
        return
    if check:
        print(f"AVAILABLE revision={release['revision']} schema={release['schema']}; no installation changes")
        return
    fetch_images(release)
    selected_source(install, release, existing=not fresh)
    install = Installation(install.root, install.profile)
    for key in ("ASA_BLOCKS_PARENT_ORIGIN", "ASA_BLOCKS_RUNTIME_ORIGIN"):
        if key in install.env:
            exact_origin(install.env[key])
    apply_release_environment(install, release)
    validate_resolved_images(install, release)
    install.identity(existing=not fresh)
    # Download support images while the previous application remains available.
    install.compose("pull", "postgres", "minio-init")
    if scheduled:
        # Reserve fifteen minutes before starting any downtime. Downloading late
        # in the window is harmless; database work is never forcibly killed at 05:00.
        require(in_window(install.settings["window"], reserve_minutes=15), "WINDOW_CLOSED", "Insufficient time left to start maintenance.", "Wait for the next permitted window.")
    backup = None
    if not fresh:
        install.compose("run", "--rm", "--no-deps", "--entrypoint", "node", "migration", "tools/migrate.mjs", "--plan")
        backup = export_backup(install)
        if scheduled:
            require(in_window(install.settings["window"], reserve_minutes=10), "WINDOW_CLOSED", "Backup completed too late to start the update.", "The existing version was restarted; retry next window.")
    # The receipt captures the actual running version, not the checkout revision.
    operation = {"phase": "switch", "previous": before, "selected": release, "backup": str(backup) if backup else None}
    atomic_json(install.state / "maintenance.json", operation)
    try:
        if not fresh:
            install.compose("stop", "web", "api", "scratch")
        install.compose("up", "-d", "--no-build")
        install.wait_ready(release["revision"], release["schema"])
        install.identity()
        atomic_json(install.state / "installed-release.json", release)
        save_settings(install, install.settings.get("automaticUpdates", False))
        install.receipt({"status": "success", **operation})
        (install.state / "maintenance.json").unlink()
        print(f"UPDATED {release['revision']} schema={release['schema']}")
    except BaseException:
        atomic_json(install.state / "failed-switch.json", operation)
        install.receipt({"status": "failed_switch", **operation, "automaticDatabaseRestore": False})
        raise


def main(argv=None):
    if sys.version_info < (3, 11):
        print("Python 3.11 or newer is required.", file=sys.stderr)
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("doctor", "configure", "install", "check", "update", "backup", "verify-backup", "restore-check", "acknowledge"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--profile", choices=("dev", "production", "staging", "base"))
    parser.add_argument("--scheduled", action="store_true")
    parser.add_argument("--enable-auto-update", action="store_true")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--database")
    args = parser.parse_args(argv)
    try:
        if args.action == "verify-backup":
            require(args.backup, "ARGUMENT", "--backup is required.")
            manifest = verify_backup(args.backup)
            print(f"BACKUP_VERIFIED revision={manifest['runtime']['revision']} files={len(manifest['files'])}")
            return 0
        install = Installation(args.root, args.profile)
        with operation_lock(install.root):
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
                    require(operation.get("phase") == "switch" and any(ready["revision"] == value.get("revision") for value in allowed),
                            "MAINTENANCE", "Unfinished backup or unexpected runtime still needs operator recovery.")
                    pending.rename(install.state / ("reviewed-" + dt.datetime.now().strftime("%Y%m%d%H%M%S") + ".json"))
                marker = install.state / "failed-switch.json"
                if marker.exists():
                    marker.rename(install.state / ("acknowledged-" + dt.datetime.now().strftime("%Y%m%d%H%M%S") + ".json"))
        return 0
    except (Blocked, OSError, ValueError, KeyError) as exc:
        code = exc.code if isinstance(exc, Blocked) else "IO_OR_CONFIGURATION"
        action = exc.action if isinstance(exc, Blocked) else "Inspect the configuration and completed stages; do not discard data."
        print(f"BLOCKED {code}: {exc}\nSAFE_ACTION: {action}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
