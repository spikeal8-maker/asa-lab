"""Consistent PostgreSQL + MinIO export; verification never restores the live DB."""

import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import uuid

from .contracts import atomic_json, inventory_files, require, verify_backup
from .system import run

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


def upload_dump(install, local, remote):
    # docker cp creates root-owned files in sticky /tmp. Stream through the
    # PostgreSQL user instead, preserving binary bytes and private permissions.
    with Path(local).open("rb") as source:
        install.compose("exec", "-T", "postgres", "sh", "-eu", "-c",
                        'umask 077; cat > "$1"', "asa-dump-copy", remote,
                        input_file=source, capture=True)


def privileges(install, database=None):
    args = ["exec", "-T"]
    if database:
        args += ["-e", f"RESTORE_DATABASE={database}"]
    args += ["-e", f"CHECK_SQL={PRIVILEGES_SQL}", "postgres", "sh", "-eu", "-c",
             'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${RESTORE_DATABASE:-$POSTGRES_DB}" -c "$CHECK_SQL"']
    return json.loads(install.compose(*args, capture=True))


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


def export_backup(install, destination=None):
    records = install.identity()
    require("minio" in records and records["postgres"]["running"], "BACKUP_SERVICES", "PostgreSQL and local MinIO are required for a complete export.")
    require(install.env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000",
            "BACKUP_STORAGE", "External object storage needs an explicit export adapter; refusing an incomplete backup.")
    require(not (install.state / "maintenance.json").exists(), "MAINTENANCE", "An unfinished maintenance operation needs review first.")
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    known_data = {("postgres", "/var/lib/postgresql/data"), ("minio", "/data")}
    for name, service in config["services"].items():
        for mount in service.get("volumes", []):
            require(mount.get("type") == "volume" and (name, mount.get("target")) in known_data,
                    "BACKUP_MOUNTS", "Additional persistent mounts need an explicit export adapter.",
                    "Inventory custom volumes and transport config files before claiming a complete export.")
    runtime = install.readiness()
    recovery = recovery_configuration(install, runtime)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    parent = Path(destination or install.settings.get("backupDirectory") or install.root / "backups").resolve()
    parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    partial = parent / (stamp + ".incomplete")
    final = parent / stamp
    partial.mkdir(mode=0o700)
    # Windows ACLs are inherited from the private operator directory. An export
    # contains secrets and must be encrypted before placement in a cloud folder.
    running = [name for name in ("web", "api", "scratch", "minio") if name in records and records[name]["running"]]
    atomic_json(install.state / "maintenance.json", {"phase": "backup", "resumeServices": running, "partial": str(partial)})
    try:
        if running:
            print("BACKUP stopping writers for a consistent database/object snapshot", flush=True)
            install.compose("stop", *running)
        with (partial / "database.dump").open("wb") as stream:
            db_command(install, 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"', output=stream)
        require((partial / "database.dump").stat().st_size > 0, "BACKUP", "Database dump is empty.")
        with (partial / "globals.sql").open("wb") as stream:
            db_command(install, 'pg_dumpall --globals-only --no-role-passwords -U "$POSTGRES_USER"', output=stream)
        acl = privileges(install)
        objects = partial / "objects"
        objects.mkdir()
        run(["docker", "cp", f"{records['minio']['id']}:/data/.", str(objects)], capture=True)
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
        images = {}
        for name, record in records.items():
            images[name] = {"reference": record["image"], "imageId": run(["docker", "inspect", "--format", "{{.Image}}", record["id"]], capture=True)}
        # Verify actual pg_restore readability, not only the file size.
        remote = f"/tmp/asa-verify-{uuid.uuid4().hex}.dump"
        try:
            upload_dump(install, partial / "database.dump", remote)
            install.compose("exec", "-T", "postgres", "pg_restore", "--list", remote, capture=True)
        finally:
            install.compose("exec", "-T", "postgres", "rm", "-f", remote, capture=True)
        manifest = {"format": "asa-backup-v1", "complete": True, "createdAt": stamp,
                    "runtime": runtime, "project": install.project, "profile": install.profile,
                    "postgresImage": records["postgres"]["image"], "images": images,
                    "applicationPrivileges": acl, "files": inventory_files(partial)}
        atomic_json(partial / "manifest.json", manifest)
        verify_backup(partial)
        partial.rename(final)
        print(f"BACKUP verified: {final}", flush=True)
        return final
    finally:
        # start preserves the exact existing images/configuration; never up/build.
        if running:
            install.compose("start", *running)
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
