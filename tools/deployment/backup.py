"""Consistent PostgreSQL + MinIO export; verification never restores the live DB."""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import uuid
import time

from .contracts import Blocked, atomic_json, backup_path, inventory_files, require, verify_backup
from .restore_toc import plan_restore_toc
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


def write_recovery_compose_files(config_dir, recovery, allowed):
    """Include the private nested Compose overlay in the full backup.

    Paths are from Installation.files, never from a user-supplied backup
    manifest. Explicitly reject path traversal before creating directories.
    """
    config_dir = Path(config_dir)
    require(config_dir.is_dir() and not config_dir.is_symlink()
            and not (getattr(config_dir.lstat(), "st_file_attributes", 0)
                     & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
            "BACKUP_CONFIGURATION", "Recovery configuration root must be a real directory.")
    for file, content in recovery["files"].items():
        require(file in allowed and isinstance(content, str), "BACKUP_CONFIGURATION",
                "Unexpected recovery configuration path or content.")
        relative = Path(file)
        require(not relative.is_absolute() and ".." not in relative.parts
                and bool(relative.parts), "BACKUP_CONFIGURATION",
                "Recovery Compose configuration must stay inside the private backup.")
        parent = config_dir
        for part in relative.parts[:-1]:
            parent = parent / part
            if not parent.exists() and not parent.is_symlink():
                parent.mkdir(mode=0o700)
            require(parent.is_dir() and not parent.is_symlink()
                    and not (getattr(parent.lstat(), "st_file_attributes", 0)
                             & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
                    "BACKUP_CONFIGURATION", "Recovery path must not traverse a symlink or junction.")
        target = parent / relative.name
        require(not target.exists() and not target.is_symlink(),
                "BACKUP_CONFIGURATION", "Recovery file already exists; never overwrite a file or symlink.")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(target, flags, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(content)


def export_backup(install, destination=None, *, trigger='manual'):
    from .operational import append_safely, stamp
    started = time.monotonic()
    event = {'version': 1, 'operation': 'backup', 'producer': 'manager', 'trigger': trigger, 'phase': 'backup'}
    try:
        final = _export_backup(install, destination)
    except BaseException:
        append_safely(install.root, {**event, 'at': stamp(), 'status': 'failed', 'durationMs': round((time.monotonic()-started)*1000)})
        raise
    summary = {}
    try:
        manifest = final/'manifest.json'
        with manifest.open('rb') as stream: summary['manifestSha256'] = hashlib.file_digest(stream,'sha256').hexdigest()
        if manifest.stat().st_size <= 1024**2:
            files = json.loads(manifest.read_text(encoding='utf-8'))['files']
            if all(type(item.get('bytes')) is int and item['bytes'] >= 0 for item in files.values()):
                summary['verifiedPayloadBytes'] = sum(item['bytes'] for item in files.values())
    except (OSError, ValueError, KeyError, TypeError):
        pass  # Backup verification already passed; unknown optional counts stay absent.
    append_safely(install.root, {**event, **summary, 'at': stamp(), 'status': 'succeeded', 'durationMs': round((time.monotonic()-started)*1000)})
    return final


OBJECT_REFERENCES = {
    "blocks_blobs": "SELECT json_build_array(object_key,size_bytes) FROM public.blocks_blobs",
    "learning_file_versions": """
        SELECT json_build_array('learning/answers/v1/tenants/' || tenant_id ||
          '/attempts/' || attempt_id || '/' || sha256,size_bytes)
        FROM public.learning_file_versions""",
    "ai_attachment_uploads": """
        SELECT json_build_array('ai/private/v1/owners/' || owner_principal_id ||
          '/uploads/' || upload_id || '/' || sha256,size_bytes)
        FROM public.ai_attachment_uploads WHERE state IN ('ready','bound')""",
    "ai_image_jobs": """
        SELECT json_build_array('ai/private/v1/owners/' || owner_principal_id ||
          '/generated/' || request_id || '/' || sha256,size_bytes)
        FROM public.ai_image_jobs
        WHERE state='complete' AND NOT cancel_requested AND deleted_at IS NULL""",
}


def snapshot_database(install, target):
    # Both the reference query and pg_dump must see the same PostgreSQL snapshot.
    script = r"""
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SELECT pg_export_snapshot() AS backup_snapshot
\gset
\setenv ASA_BACKUP_SNAPSHOT :backup_snapshot
"""
    for table, query in OBJECT_REFERENCES.items():
        script += (f"SELECT to_regclass('public.{table}') IS NOT NULL AS present\n"
                   "\\gset\n\\if :present\n" + query.strip() + ";\n\\endif\n")
    script += r"""
\! pg_dump --format=custom --lock-wait-timeout=10s --snapshot="$ASA_BACKUP_SNAPSHOT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$ASA_BACKUP_DUMP"
\if :SHELL_ERROR
SELECT 1/0;
\endif
COMMIT;
"""
    remote = "/tmp/asa-backup-" + uuid.uuid4().hex + ".dump"
    try:
        refs = db_command(
            install, f"umask 077; export ASA_BACKUP_DUMP={remote}; "
            'psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -',
            input_data=script, capture=True,
        )
        db_command(install, f"pg_restore --list {remote}", capture=True)
        with target.open("wb") as stream:
            db_command(install, f"cat {remote}", output=stream)
    finally:
        db_command(install, f"rm -f {remote}", capture=True)
    require(target.stat().st_size > 0, "BACKUP_DATABASE", "Database dump is empty.")
    return [json.loads(row) for row in refs.splitlines()]


def object_inventory(output):
    items = {}
    for line in output.splitlines():
        row = json.loads(line)
        key = row.get("key")
        require(row.get("status") == "success" and isinstance(key, str) and key
                and key not in items and type(row.get("size")) is int
                and row["size"] >= 0 and isinstance(row.get("etag"), str) and row["etag"]
                and isinstance(row.get("lastModified"), str) and row["lastModified"],
                "BACKUP_STORAGE_LIST", "MinIO returned an incomplete or ambiguous object list.")
        items[key] = (row["size"], row["etag"], row["lastModified"])
    return items


def verify_object_metadata(mc, source, target, keys):
    def metadata(bucket, batch):
        output = mc("stat", "--no-list", *(f"{bucket}/{key}" for key in batch))
        rows = [json.loads(line) for line in output.splitlines()]
        require(len(rows) == len(batch) and all(row.get("status") == "success" for row in rows),
                "BACKUP_STORAGE_METADATA", "Could not verify MinIO object metadata.")
        return [
            {key.lower(): value for key, value in row.get("metadata", {}).items()
             if key.lower() in ("content-type", "cache-control")
             or key.lower().startswith("x-amz-meta-") and key.lower() != "x-amz-meta-mc-attrs"}
            for row in rows
        ]

    for offset in range(0, len(keys), 24):
        batch = keys[offset:offset + 24]
        require(metadata(source, batch) == metadata(target, batch),
                "BACKUP_STORAGE_METADATA", "Staged MinIO metadata differs from the source.")


def copy_online_objects(install, record, partial):
    # Never copy the running MinIO filesystem. Materialize S3 objects into a
    # disposable copy of the same server so existing raw-volume restore works.
    cid = record["id"]
    image = run(["docker", "inspect", "--format", "{{.Image}}", cid], capture=True)
    networks = json.loads(run(["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", cid], capture=True))
    require(len(networks) == 1, "BACKUP_STORAGE_NETWORK", "Expected one managed MinIO network.")
    network, endpoint = next(iter(networks.items()))
    require("minio" in (endpoint.get("Aliases") or []), "BACKUP_STORAGE_NETWORK", "MinIO service alias is missing.")
    bucket = install.env.get("ASA_OBJECT_STORAGE_BUCKET", "asa-blocks")
    require(re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket),
            "BACKUP_STORAGE_BUCKET", "Invalid managed MinIO bucket name.")
    env = dict(os.environ)
    env.update(MINIO_ROOT_USER=install.env.get("ASA_OBJECT_STORAGE_ACCESS_KEY", ""),
               MINIO_ROOT_PASSWORD=install.env.get("ASA_OBJECT_STORAGE_SECRET_KEY", ""))
    require(all(env[name] for name in ("MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD")),
            "BACKUP_STORAGE_CREDENTIALS", "Managed MinIO credentials are missing.")
    source = f"source/{bucket}"
    target = f"snapshot/{bucket}"
    for attempt in range(2):
        name = "asa-backup-" + uuid.uuid4().hex
        # No host ports and no Compose labels. Docker owns the anonymous scratch
        # volume, removed only with this container by ID.
        stage = run(["docker", "run", "-d", "--name", name, "--network", network,
                     "--label", "asa.backup.stage=true", "--read-only", "--tmpfs",
                     "/tmp:uid=1000,gid=1000,mode=0700,size=64m", "--mount",
                     "type=volume,destination=/data", "--user", "1000:1000",
                     "--cap-drop=ALL", "--security-opt=no-new-privileges",
                     "-e", "MINIO_ROOT_USER", "-e", "MINIO_ROOT_PASSWORD",
                     image, "server", "/data"], env=env, capture=True)
        require(re.fullmatch(r"[a-f0-9]{64}", stage), "BACKUP_STORAGE_STAGE", "Invalid staging container identity.")
        before = None
        try:
            def mc(*args):
                return run(["docker", "exec", stage, "mc", "--json", *args], capture=True)

            run(["docker", "exec", stage, "sh", "-ec", """
                for i in $(seq 1 30); do
                    if curl -fs http://127.0.0.1:9000/minio/health/ready >/dev/null; then break; fi
                    sleep 1
                done
                mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
                mc alias set snapshot http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
            """], capture=True)
            buckets = [json.loads(row) for row in mc("ls", "source").splitlines()]
            require(len(buckets) == 1 and buckets[0].get("status") == "success"
                    and buckets[0].get("key") == bucket + "/",
                    "BACKUP_STORAGE_BUCKET", "Online backup requires exactly the managed application bucket.")
            version = json.loads(mc("version", "info", source))
            require(version.get("status") == "success" and version.get("versioning", {}).get("status") == "",
                    "BACKUP_STORAGE_VERSIONING", "Versioned buckets need a version-aware backup adapter.")
            policy = json.loads(mc("anonymous", "get", source))
            require(policy.get("status") == "success" and policy.get("permission") == "private",
                    "BACKUP_STORAGE_POLICY", "Expected the managed private bucket policy.")
            before = object_inventory(mc("ls", "--recursive", source))
            # Both copies may reside on one filesystem. Leave headroom for
            # MinIO metadata and concurrent application writes.
            needed = 2 * sum(value[0] for value in before.values()) + 128 * 1024**2 + 16_384 * len(before)
            df = run(["docker", "exec", stage, "df", "-Pk", "/data"], capture=True)
            require(int(df.splitlines()[-1].split()[3]) * 1024 >= needed
                    and shutil.disk_usage(partial).free >= needed,
                    "BACKUP_STORAGE_SPACE", "Insufficient free space for a temporary object copy and archive.")
            references = snapshot_database(install, partial / "database.dump")
            mc("mb", target)
            if before:
                mc("cp", "--recursive", "--preserve", source + "/", target + "/")
            after = object_inventory(mc("ls", "--recursive", source))
            staged = object_inventory(mc("ls", "--recursive", target))
            require(before == after, "BACKUP_STORAGE_DRIFT", "MinIO changed during export.")
            require(set(before) == set(staged), "BACKUP_STORAGE_VERIFY", "Staged object inventory differs from the source.")
            require(all(staged[key][0] == value[0] and ("-" in value[1] or staged[key][1] == value[1])
                        for key, value in before.items()), "BACKUP_STORAGE_VERIFY", "Staged object bytes do not match the source inventory.")
            require(all(key in staged and staged[key][0] == size for key, size in references),
                    "BACKUP_STORAGE_REFERENCES", "The staged copy is missing an object referenced by the database snapshot.")
            for key, (_, etag, _) in before.items():
                if "-" in etag:
                    # Multipart ETags depend on part boundaries, not only bytes.
                    def digest(bucket):
                        return run(["docker", "exec", stage, "sh", "-ec",
                                    'set -o pipefail; mc cat "$1" | sha256sum',
                                    "asa-backup", f"{bucket}/{key}"], capture=True).split()[0]
                    require(digest(source) == digest(target), "BACKUP_STORAGE_VERIFY",
                            "A staged multipart object differs from the source.")
            verify_object_metadata(mc, source, target,
                                   sorted(key for key in before if key.startswith("ai/private/v1/owners/")))
            require(before == object_inventory(mc("ls", "--recursive", source)),
                    "BACKUP_STORAGE_DRIFT", "MinIO changed during verification.")
            run(["docker", "stop", stage], capture=True)
            objects = partial / "objects"
            objects.mkdir()
            run(["docker", "cp", f"{stage}:/data/.", str(objects)], capture=True)
            return
        except Blocked as problem:
            retryable = ("COMMAND", "BACKUP_STORAGE_VERIFY", "BACKUP_STORAGE_REFERENCES", "BACKUP_STORAGE_METADATA")
            if attempt == 0 and (problem.code == "BACKUP_STORAGE_DRIFT" or (
                problem.code in retryable and before is not None
                and before != object_inventory(mc("ls", "--recursive", source))
            )):
                print("BACKUP MinIO changed during export; retrying without interrupting the site.", flush=True)
                continue
            raise
        finally:
            run(["docker", "rm", "-f", "-v", stage], capture=True)


def _export_backup(install, destination=None):
    records = install.identity()
    require(all(records.get(name, {}).get("running") for name in ("postgres", "minio")),
            "BACKUP_SERVICES", "Running PostgreSQL and local MinIO are required for a complete export.")
    require(install.env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000",
            "BACKUP_STORAGE", "External object storage needs an explicit export adapter; refusing an incomplete backup.")
    require(not (install.state / "maintenance.json").exists(), "MAINTENANCE", "An unfinished maintenance operation needs review first.")
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    external_diagnostics = attest_backup_mounts(install.root, config)
    runtime = install.readiness()
    recovery = recovery_configuration(install, runtime)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    parent = backup_path(destination or install.settings.get("backupDirectory") or install.root / "backups")
    parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    partial = parent / (stamp + ".incomplete")
    final = parent / stamp
    partial.mkdir(mode=0o700)
    # Windows ACLs are inherited from the private operator directory. An export
    # contains secrets and must be encrypted before placement in a cloud folder.
    try:
        print("BACKUP exporting PostgreSQL and MinIO while the site remains online", flush=True)
        copy_online_objects(install, records["minio"], partial)
        with (partial / "globals.sql").open("wb") as stream:
            db_command(install, 'pg_dumpall --globals-only --no-role-passwords -U "$POSTGRES_USER"', output=stream)
        acl = privileges(install)
        shutil.copyfile(install.root / ".env", partial / "private.env")
        os.chmod(partial / "private.env", 0o600)
        config_dir = partial / "configuration"
        config_dir.mkdir()
        write_recovery_compose_files(config_dir, recovery, install.files)
        atomic_json(config_dir / "runtime-configuration.json", recovery)
        if recovery["installedRelease"]:
            atomic_json(config_dir / "installed-release.json", recovery["installedRelease"])
        if install.settings:
            atomic_json(config_dir / "installation.json", install.settings)
        images = {}
        for name, record in records.items():
            images[name] = {"reference": record["image"], "imageId": run(["docker", "inspect", "--format", "{{.Image}}", record["id"]], capture=True)}
        require(install.identity() == records, "BACKUP_RUNTIME_CHANGED", "Installation changed during the backup.")
        install.wait_ready(runtime["revision"], runtime["schema"])
        manifest = {"format": "asa-backup-v1", "captureMode": "online-postgres-minio",
                    "complete": True, "createdAt": stamp,
                    "runtime": runtime, "project": install.project, "profile": install.profile,
                    "postgresImage": records["postgres"]["image"], "images": images,
                    "applicationPrivileges": acl, "files": inventory_files(partial)}
        if external_diagnostics:
            manifest["externalDiagnostics"] = {"included": False, "preservedInPlace": True,
                                               "export": "Admin > Logs > Download ZIP"}
        atomic_json(partial / "manifest.json", manifest)
        verify_backup(partial)
        partial.rename(final)
        print(f"BACKUP verified: {final}", flush=True)
        return final
    except BaseException:
        # This private directory was created by this invocation. Completed
        # archives are never removed, including on an interrupted export.
        shutil.rmtree(partial, ignore_errors=True)
        raise


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
    remote_toc = remote + ".list"
    try:
        upload_dump(install, backup_path(backup) / "database.dump", remote)
        toc = install.compose("exec", "-T", "postgres", "pg_restore", "--list", remote, capture=True)
        plan = plan_restore_toc(toc)
        # Both files are private, seekable PostgreSQL-owned files. Never stream
        # an archive into pg_restore when its data order needs random access.
        install.compose("exec", "-T", "postgres", "sh", "-eu", "-c",
                        'umask 077; cat > "$1"', "asa-restore-plan", remote_toc,
                        input_data=plan, capture=True)
        db_command(install, 'createdb -U "$POSTGRES_USER" "$RESTORE_DATABASE"', database=database)
        # Keep ACLs; target admin owns restored objects. Missing referenced roles
        # fail closed instead of silently weakening RLS or creating superusers.
        install.compose("exec", "-T", "postgres", "pg_restore", "--exit-on-error", "--single-transaction", "--no-owner",
                        "--use-list", remote_toc, "-U", install.env["POSTGRES_USER"], "-d", database, remote)
        db_command(install, 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$RESTORE_DATABASE" -c "SELECT count(*) FROM schema_migrations"', database=database)
        require(privileges(install, database) == manifest["applicationPrivileges"],
                "RESTORE_PRIVILEGES", "Restored application table privileges/RLS differ from the source.")
        print(f"RESTORE_CHECK verified database and object checksums: {database}; application journeys still require acceptance.")
    finally:
        install.compose("exec", "-T", "postgres", "rm", "-f", remote, remote_toc, capture=True)
