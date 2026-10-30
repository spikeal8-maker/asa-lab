"""Consistent PostgreSQL + MinIO export; verification never restores the live DB."""

import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import stat
import time
import uuid

from .contracts import atomic_json, inventory_files, require, verify_backup, verify_embedded_entry_http
from .system import run
from .paths import atomic_json as private_json, plain_paths

PRIVILEGES_SQL = """
SELECT COALESCE(json_agg(x ORDER BY x.relation), '[]'::json) FROM (
  SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS relation,
    has_table_privilege('asalab_app', c.oid, 'SELECT') AS sel,
    has_table_privilege('asalab_app', c.oid, 'INSERT') AS ins,
    has_table_privilege('asalab_app', c.oid, 'UPDATE') AS upd,
    has_table_privilege('asalab_app', c.oid, 'DELETE') AS del,
    c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
) x
"""


def db_command(install, command, *, database=None, **kwargs):
    args = ["exec", "-T"]
    if database:
        args += ["-e", f"RESTORE_DATABASE={database}"]
    return install.compose(*args, "postgres", "sh", "-eu", "-c", command, **kwargs)


def upload_dump(install, local, remote, *, timeout=None):
    # docker cp creates root-owned files in sticky /tmp. Stream through the
    # PostgreSQL user instead, preserving binary bytes and private permissions.
    with Path(local).open("rb") as source:
        install.compose("exec", "-T", "postgres", "sh", "-eu", "-c",
                        'umask 077; cat > "$1"', "asa-dump-copy", remote,
                        input_file=source, capture=True, **({"timeout": timeout} if timeout else {}))


def privileges(install, database=None, *, timeout=None):
    args = ["exec", "-T"]
    if database:
        args += ["-e", f"RESTORE_DATABASE={database}"]
    args += ["-e", f"CHECK_SQL={PRIVILEGES_SQL}", "postgres", "sh", "-eu", "-c",
             'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${RESTORE_DATABASE:-$POSTGRES_DB}" -c "$CHECK_SQL"']
    return json.loads(install.compose(*args, capture=True, **({"timeout": timeout} if timeout else {})))


def freeze_remaining(deadline):
    if deadline is None:
        return {}
    remaining = deadline - time.monotonic()
    require(remaining > 0, "BACKUP_FREEZE_TIMEOUT", "Истёк срок запрета записи.",
            "Проверьте восстановление прежних сервисов и повторите операцию с достаточным окном.")
    return {"timeout": max(0.1, remaining)}


def _sync_directory(path, deadline=None):
    freeze_remaining(deadline)
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                         | getattr(os, "O_NOFOLLOW", 0))
    try:
        require(stat.S_ISDIR(os.fstat(descriptor).st_mode), "BACKUP_PATH", "Backup directory changed during publication.")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    freeze_remaining(deadline)


def ensure_backup_durable(path, deadline=None):
    """Flush a verified snapshot and its entry, retaining the original freeze budget.

    Also used when adopting an existing final directory after an interrupted
    publication: a readable manifest alone does not prove successful fsync.
    """
    path = Path(path)
    plain_paths(path, ())
    require(path.is_dir(), "BACKUP_PATH", "Backup directory is missing.")

    def walk_error(error):
        raise error

    for directory, directories, files in os.walk(path, topdown=False, followlinks=False, onerror=walk_error):
        freeze_remaining(deadline)
        directory = Path(directory)
        plain_paths(directory, directories + files)
        for name in files:
            freeze_remaining(deadline)
            # NONBLOCK avoids opening an unexpected FIFO indefinitely. On Windows
            # FlushFileBuffers requires a writable handle; directory fsync is POSIX-only.
            flags = (os.O_RDWR if os.name == "nt" else os.O_RDONLY)
            flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
            descriptor = os.open(directory / name, flags)
            try:
                require(stat.S_ISREG(os.fstat(descriptor).st_mode), "BACKUP_PATH", "Backup member is not a regular file.")
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            freeze_remaining(deadline)
        _sync_directory(directory, deadline)
    _sync_directory(path.parent, deadline)
    # The storage directory can be created for the first backup in this same
    # operation; its own entry must survive alongside the snapshot entry.
    _sync_directory(path.parent.parent, deadline)


def freeze_boot_id():
    path = Path("/proc/sys/kernel/random/boot_id")
    require(path.is_file(), "BACKUP_BOOT_ID", "Нельзя подтвердить непрерывность запрета записи на этом хосте.")
    return path.read_text(encoding="ascii").strip()


def managed_writers(install, records, config, *, timeout=30):
    """Inventory every container, including unlabelled foreign volume consumers."""
    ids = run(["docker", "ps", "-aq"], capture=True, timeout=timeout).split()
    template = '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}'
    all_records = [json.loads(line) for line in run(
        ["docker", "inspect", "--format", template, *ids], capture=True, timeout=timeout).splitlines()] if ids else []
    sources = {m.get("Name") or m.get("Source") for name in ("postgres", "minio")
               for m in records.get(name, {}).get("mounts", []) if m.get("Destination") in ("/data", "/var/lib/postgresql/data")}
    sources.discard(None)
    require(len(sources) == 2, "BACKUP_DATA_IDENTITY", "Не подтверждены оба хранилища установки.")
    expected_files = [str((install.root / name).resolve()) for name in install.files]
    selected = {}
    for record in all_records:
        labels = record.get("labels") or {}
        own = labels.get("com.docker.compose.project") == install.project
        shared = any((m.get("Name") or m.get("Source")) in sources for m in record.get("mounts", []))
        require(own or not shared, "BACKUP_SHARED_VOLUME", "Данные установки подключены к постороннему контейнеру.",
                "Разберите совместное использование хранилища до резервирования.")
        if not own:
            continue
        name = labels.get("com.docker.compose.service")
        root = labels.get("com.docker.compose.project.working_dir", "")
        files = [str(Path(f).resolve()) for f in labels.get("com.docker.compose.project.config_files", "").split(",") if f]
        require(root and Path(root).resolve() == install.root and files == expected_files,
                "BACKUP_WRITER_IDENTITY", "Происхождение одного из контейнеров установки не подтверждено.")
        require(name in config["services"] and name not in selected,
                "BACKUP_UNKNOWN_WRITER", "Обнаружен неизвестный или дублирующий сервис установки.")
        require(not (record["running"] and (name in ("migration", "minio-init")
                    or str(labels.get("com.docker.compose.oneoff", "false")).lower() == "true")),
                "BACKUP_ACTIVE_JOB", "В установке выполняется одноразовая задача или миграция.",
                "Дождитесь завершения задачи и повторите резервирование.")
        selected[name] = {"id": record["id"], "running": record["running"]}
    require(all(selected.get(name, {}).get("id") == record["id"] for name, record in records.items()),
            "BACKUP_WRITER_RACE", "Контейнеры изменились во время инвентаризации.")
    return selected


def backup_hold(install, operation_id):
    path = install.state / "maintenance.json"
    plain_paths(install.state, ("maintenance.json",))
    require(path.is_file(), "BACKUP_HOLD_MISSING", "Журнал запрета записи отсутствует.")
    value = json.loads(path.read_text(encoding="utf-8"))
    require(value.get("format") == "asa-backup-hold-v1" and value.get("operationId") == operation_id
            and value.get("phase") in ("backup", "backup-held") and value.get("canonicalRoot") == str(install.root)
            and value.get("composeProject") == install.project,
            "BACKUP_HOLD_IDENTITY", "Журнал принадлежит другой операции.")
    ids = list(value["containers"].values())
    if ids:
        states = run(["docker", "inspect", "--format", '{{.Id}} {{.State.Running}}', *ids], capture=True, timeout=30)
        actual = dict(line.split() for line in states.splitlines())
        require(set(actual) == set(ids), "BACKUP_HOLD_IDENTITY", "Контейнер запрета записи исчез.")
        require(all(actual[ident] == "false" for ident in ids), "BACKUP_WRITERS_RESUMED",
                "Запись была возобновлена после снимка; этот снимок не подтверждает состояние перед переключением.")
    return value


def consume_backup_hold(install, operation_id):
    """Validate the hold before replacing its receipt with the switch journal."""
    value = backup_hold(install, operation_id)
    require(value.get("bootId") == freeze_boot_id(), "BACKUP_FREEZE_INTERRUPTED",
            "После снимка сервер перезагружался; непрерывный запрет записи не подтверждён.")
    require(dt.datetime.now(dt.timezone.utc).timestamp() < value["deadlineEpoch"]
            and time.monotonic() < value["deadlineMonotonic"],
            "BACKUP_FREEZE_TIMEOUT", "Истёк срок запрета записи до переключения.")
    return value


def _wait_resumed_writers(ids, timeout=90):
    """Verify every captured writer, including services outside core readiness."""
    if not ids:
        return
    deadline = time.monotonic() + timeout
    template = ('{"id":{{json .Id}},"running":{{json .State.Running}},'
                '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"none"{{end}}}')
    while True:
        remaining = deadline - time.monotonic()
        require(remaining > 0, "BACKUP_RESUME_TIMEOUT", "Не все исходные сервисы стали готовы после резервирования.",
                "Проверьте сохранённый журнал и состояние исходных контейнеров; они не пересоздавались.")
        records = [json.loads(line) for line in run(
            ["docker", "inspect", "--format", template, *ids], capture=True, timeout=min(30, remaining)).splitlines()]
        require(len(records) == len(ids) and {record.get("id") for record in records} == set(ids),
                "BACKUP_RESUME_IDENTITY", "Один из исходных контейнеров исчез во время восстановления.")
        require(all(record.get("running") is True for record in records), "BACKUP_RESUME_WRITERS",
                "Один из исходных сервисов остановился после запуска; восстановление не подтверждено.")
        require(all(record.get("health") in ("none", "healthy", "starting") for record in records),
                "BACKUP_RESUME_HEALTH", "Проверка здоровья одного из исходных сервисов завершилась неуспешно.")
        remaining = deadline - time.monotonic()
        require(remaining > 0, "BACKUP_RESUME_TIMEOUT", "Истёк срок проверки исходных сервисов после резервирования.")
        if all(record["health"] in ("none", "healthy") for record in records):
            return
        time.sleep(min(1, remaining))


def resume_backup_writers(install, operation_id):
    """Start the exact containers stopped by this operation; no up/build/repair."""
    path = install.state / "maintenance.json"
    plain_paths(install.state, ("maintenance.json",))
    require(path.is_file(), "BACKUP_HOLD_MISSING", "Журнал исходного состояния отсутствует.")
    value = json.loads(path.read_text(encoding="utf-8"))
    require(value.get("format") == "asa-backup-hold-v1" and value.get("operationId") == operation_id
            and value.get("canonicalRoot") == str(install.root) and value.get("composeProject") == install.project,
            "BACKUP_HOLD_IDENTITY", "Журнал принадлежит другой операции.")
    ids = list(value["containers"].values())
    if ids:
        run(["docker", "start", *ids], capture=True, timeout=90)
    previous = value["runtime"]
    install.wait_ready(previous["revision"], previous["schema"])
    _wait_resumed_writers(ids)
    entry_origin = install.env.get("ASA_UPDATE_ENTRY_ORIGIN")
    public_entry_verified = False
    if entry_origin:
        verify_embedded_entry_http(entry_origin, previous["revision"])
        public_entry_verified = True
    path.unlink()
    _sync_directory(path.parent)
    return {"status": "OK", "resumedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "previousRuntimeVerified": True, "publicEntryVerified": public_entry_verified,
            "services": list(value["containers"])}


def recovery_configuration(install, runtime):
    saved = install.state / "runtime-configuration.json"
    if saved.exists():
        snapshot = json.loads(saved.read_text(encoding="utf-8"))
        if snapshot.get("revision") == runtime["revision"]:
            return snapshot
    files = {}
    for file in install.files:
        if (install.root / ".git").exists() and install.git("ls-files", "--", file):
            files[file] = install.git("show", f"{runtime['revision']}:{file}") + "\n"
        else:
            # Private transport overlays are not in Git; CI uses an isolated
            # directory with Compose copied from the exact build source.
            files[file] = (install.root / file).read_text(encoding="utf-8")
    installed = install.state / "installed-release.json"
    return {"revision": runtime["revision"], "files": files,
            "installedRelease": json.loads(installed.read_text(encoding="utf-8")) if installed.exists() else None}


def attest_backup_mounts(root, config):
    known_data = {("postgres", "/var/lib/postgresql/data"), ("minio", "/data")}
    external_diagnostics = False
    expected_store = (Path(root) / ".asa" / "diagnostics" / "store").resolve()
    for name, service in config["services"].items():
        for mount in service.get("volumes", []):
            if (name == "api" and mount.get("type") == "volume"
                    and mount.get("target") == "/var/lib/asa-application-logs"
                    and service.get("environment", {}).get("ASA_APPLICATION_LOG_STORE") == "/var/lib/asa-application-logs"):
                # Bounded diagnostic evidence is independent of application-data
                # recovery, like the host-owned store below. Preserve its volume
                # in place; backups do not claim to export diagnostic history.
                external_diagnostics = True
                continue
            if (name == "api" and mount.get("type") == "bind"
                    and mount.get("target") == "/var/lib/asa-logs"
                    and mount.get("read_only") is True
                    and isinstance(mount.get("source"), str)
                    and Path(mount["source"]).resolve() == expected_store
                    and service.get("environment", {}).get("ASA_LOG_STORE") == "/var/lib/asa-logs"):
                # Host-owned diagnostics are independent of application recovery.
                # This exact read-only mount is preserved in place, never restored.
                external_diagnostics = True
                continue
            require(mount.get("type") == "volume" and (name, mount.get("target")) in known_data,
                    "BACKUP_MOUNTS", "Additional persistent mounts need an explicit export adapter.",
                    "Inventory custom volumes and transport config files before claiming a complete export.")
    return external_diagnostics


def export_backup(install, destination=None, *, snapshot_id=None, installation_id=None,
                  operation_id=None, hold_writers=False, freeze_timeout_seconds=900):
    managed = installation_id is not None
    require(not hold_writers or managed, "BACKUP_IDENTITY", "Удержание записи требует идентичности установки и операции.")
    if managed:
        require(isinstance(installation_id, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", installation_id),
                "BACKUP_IDENTITY", "Некорректный installation ID.")
        require(isinstance(operation_id, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}", operation_id),
                "BACKUP_IDENTITY", "Некорректный operation ID.")
        require(isinstance(snapshot_id, str) and re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8,32}", snapshot_id),
                "BACKUP_IDENTITY", "Некорректный snapshot ID.")
        require(type(freeze_timeout_seconds) is int and 30 <= freeze_timeout_seconds <= 7200,
                "BACKUP_FREEZE_TIMEOUT", "Время запрета записи должно быть от 30 до 7200 секунд.")
        plain_paths(install.root, (".env", ".asa/installation.json", ".asa/maintenance.json", ".asa/setup.json"))
    records = install.identity()
    require("minio" in records and records["postgres"]["running"], "BACKUP_SERVICES", "PostgreSQL and local MinIO are required for a complete export.")
    require(install.env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000",
            "BACKUP_STORAGE", "External object storage needs an explicit export adapter; refusing an incomplete backup.")
    require(not (install.state / "maintenance.json").exists(), "MAINTENANCE", "An unfinished maintenance operation needs review first.")
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    external_diagnostics = attest_backup_mounts(install.root, config)
    runtime = install.readiness()
    recovery = recovery_configuration(install, runtime)
    stamp = snapshot_id if managed else dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    parent = Path(destination or install.settings.get("backupDirectory") or install.root / "backups").resolve()
    if managed:
        plain_paths(Path(destination or install.settings.get("backupDirectory") or install.root / "backups"), ())
    parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if managed and os.name != "nt":
        require(parent.stat().st_uid == os.geteuid() and parent.stat().st_mode & 0o077 == 0,
                "BACKUP_PRIVATE_DIRECTORY", "Каталог полного снимка должен принадлежать оператору и иметь права 0700.")
    partial = parent / (stamp + ".incomplete")
    final = parent / stamp
    require(not final.exists(), "BACKUP_SNAPSHOT_EXISTS", "Снимок с этим ID уже существует.")
    # Windows ACLs are inherited from the private operator directory. An export
    # contains secrets and must be encrypted before placement in a cloud folder.
    running = [name for name in ("web", "api", "scratch", "minio") if name in records and records[name]["running"]]
    deadline = None
    hold = None
    hold_recorded = False
    promoted = False
    completed = False
    if managed:
        selected = managed_writers(install, records, config)
        running = [name for name, record in selected.items() if name != "postgres" and record["running"]]
        deadline = time.monotonic() + freeze_timeout_seconds
        hold = {"format": "asa-backup-hold-v1", "operationId": operation_id,
                "installationId": installation_id, "snapshotId": stamp, "phase": "backup",
                "canonicalRoot": str(install.root), "composeProject": install.project,
                "resumeServices": running, "partial": str(partial), "runtime": runtime,
                "deadlineEpoch": dt.datetime.now(dt.timezone.utc).timestamp() + freeze_timeout_seconds,
                "deadlineMonotonic": deadline, "bootId": freeze_boot_id(),
                "containers": {name: selected[name]["id"] for name in running}}
        partial.mkdir(mode=0o700)
    else:
        partial.mkdir(mode=0o700)
        atomic_json(install.state / "maintenance.json", {"phase": "backup", "resumeServices": running, "partial": str(partial)})
    try:
        if managed:
            freeze_remaining(deadline)
            private_json(install.state / "maintenance.json", hold)
            hold_recorded = True
            # Recovery intent must survive a crash before the first writer stops.
            _sync_directory(install.state, deadline)
            _sync_directory(install.state.parent, deadline)
        if running:
            print("BACKUP stopping writers for a consistent database/object snapshot", flush=True)
            install.compose("stop", *running, **freeze_remaining(deadline))
        if managed:
            backup_hold(install, operation_id)
            # Roles and password hashes are cluster-wide. An idle admin in
            # another database can change them, so all existing client sessions
            # count as possible writers; background PostgreSQL workers do not.
            active = db_command(install, 'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type=\'client backend\'"', capture=True, **freeze_remaining(deadline))
            require(active.strip() == "0", "BACKUP_EXTERNAL_WRITERS", "После остановки сервисов остались внешние подключения к БД.",
                    "Определите внешних писателей и включите их остановку в процедуру обслуживания.")
        with (partial / "database.dump").open("wb") as stream:
            db_command(install, 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"', output=stream, **freeze_remaining(deadline))
        require((partial / "database.dump").stat().st_size > 0, "BACKUP", "Database dump is empty.")
        with (partial / "globals.sql").open("wb") as stream:
            command = 'pg_dumpall --globals-only -U "$POSTGRES_USER"' if managed else 'pg_dumpall --globals-only --no-role-passwords -U "$POSTGRES_USER"'
            db_command(install, command, output=stream, **freeze_remaining(deadline))
        acl = privileges(install, **freeze_remaining(deadline))
        objects = partial / "objects"
        objects.mkdir()
        run(["docker", "cp", f"{records['minio']['id']}:/data/.", str(objects)], capture=True, **freeze_remaining(deadline))
        shutil.copyfile(install.root / ".env", partial / "private.env")
        os.chmod(partial / "private.env", 0o600)
        config_dir = partial / "configuration"
        config_dir.mkdir()
        for file, content in recovery["files"].items():
            require(file in install.files, "BACKUP_CONFIGURATION", "Unexpected recovery configuration path.")
            (config_dir / file).write_text(content, encoding="utf-8")
        atomic_json(config_dir / "runtime-configuration.json", recovery)
        if recovery["installedRelease"]:
            atomic_json(config_dir / "installed-release.json", recovery["installedRelease"])
        if install.settings:
            atomic_json(config_dir / "installation.json", install.settings)
        if managed and (install.state / "setup.json").is_file():
            shutil.copyfile(install.state / "setup.json", config_dir / "setup.json")
            os.chmod(config_dir / "setup.json", 0o600)
        images = {}
        for name, record in records.items():
            images[name] = {"reference": record["image"], "imageId": run(["docker", "inspect", "--format", "{{.Image}}", record["id"]], capture=True, **freeze_remaining(deadline))}
        # Verify actual pg_restore readability, not only the file size.
        remote = f"/tmp/asa-verify-{uuid.uuid4().hex}.dump"
        try:
            upload_dump(install, partial / "database.dump", remote, **freeze_remaining(deadline))
            install.compose("exec", "-T", "postgres", "pg_restore", "--list", remote, capture=True, **freeze_remaining(deadline))
        finally:
            install.compose("exec", "-T", "postgres", "rm", "-f", remote, capture=True, **({"timeout": 30} if managed else {}))
        manifest = {"format": "asa-backup-v1", "complete": True, "createdAt": stamp,
                    "runtime": runtime, "project": install.project, "profile": install.profile,
                    "postgresImage": records["postgres"]["image"], "images": images,
                    "applicationPrivileges": acl, "files": inventory_files(partial)}
        if managed:
            manifest.update(installationId=installation_id, operationId=operation_id, snapshotId=stamp,
                            snapshotAt=dt.datetime.now(dt.timezone.utc).isoformat(), roleCredentialsIncluded=True,
                            dataIdentity={name: [{"name": m.get("Name"), "type": m.get("Type"), "target": m.get("Destination")}
                                                for m in records[name].get("mounts", [])]
                                          for name in ("postgres", "minio")})
        if external_diagnostics:
            manifest["externalDiagnostics"] = {"included": False, "preservedInPlace": True,
                                               "export": "Admin > Logs > Download ZIP"}
        atomic_json(partial / "manifest.json", manifest)
        verify_backup(partial)
        if managed:
            ensure_backup_durable(partial, deadline)
        freeze_remaining(deadline)
        partial.rename(final)
        promoted = True
        if managed:
            _sync_directory(parent, deadline)
        if managed and hold_writers:
            hold.update(phase="backup-held", snapshotPath=str(final), snapshotAt=manifest["snapshotAt"])
            private_json(install.state / "maintenance.json", hold)
            _sync_directory(install.state, deadline)
        completed = True
        print(f"BACKUP verified: {final}", flush=True)
        return final
    finally:
        # start preserves the exact existing images/configuration; never up/build.
        if managed:
            try:
                if promoted and not completed:
                    # Failed publication must not look complete to a subsequent
                    # caller. If this rename also fails, the adoption path must
                    # run ensure_backup_durable before accepting the final path.
                    final.rename(partial)
                    _sync_directory(parent)
            finally:
                if hold_recorded and not (completed and hold_writers):
                    resume_backup_writers(install, operation_id)
        elif running:
            install.compose("start", *running)
        if not managed:
            install.wait_ready(runtime["revision"], runtime["schema"])
            (install.state / "maintenance.json").unlink()


def restore_check(install, backup, database):
    require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,50}_test", database),
            "RESTORE_TARGET", "Restore target must be a safe name ending in _test.")
    require(database != install.env.get("POSTGRES_DB"), "RESTORE_TARGET", "Live database cannot be a restore-test target.")
    records = install.identity()
    manifest = verify_backup(backup)
    # Never drop an existing database, even one named *_test.
    query = "SELECT 1 FROM pg_database WHERE datname = :'target'"
    exists = install.compose("exec", "-T", "postgres", "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-v", f"target={database}",
                             "-U", install.env["POSTGRES_USER"], "-d", install.env["POSTGRES_DB"], input_data=query + ";\n", capture=True)
    require(not exists, "RESTORE_EXISTS", "Restore-test database already exists.", "Choose a new *_test database; no database is deleted automatically.")
    remote = f"/tmp/asa-restore-{uuid.uuid4().hex}.dump"
    try:
        upload_dump(install, Path(backup).resolve() / "database.dump", remote)
        install.compose("exec", "-T", "postgres", "pg_restore", "--list", remote, capture=True)
        db_command(install, 'createdb -U "$POSTGRES_USER" "$RESTORE_DATABASE"', database=database)
        # Keep ACLs; target admin owns restored objects. Missing referenced roles
        # fail closed instead of silently weakening RLS or creating superusers.
        install.compose("exec", "-T", "postgres", "pg_restore", "--exit-on-error", "--single-transaction", "--no-owner",
                        "-U", install.env["POSTGRES_USER"], "-d", database, remote)
        db_command(install, 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" -c "SELECT count(*) FROM schema_migrations"', database=database)
        require(privileges(install, database) == manifest["applicationPrivileges"],
                "RESTORE_PRIVILEGES", "Restored application table privileges/RLS differ from the source.")
        print(f"RESTORE_CHECK verified database and object checksums: {database}; application journeys still require acceptance.")
    finally:
        install.compose("exec", "-T", "postgres", "rm", "-f", remote, capture=True)
