#!/usr/bin/env python3
"""Guarded, test-only ASA Lab Docker source update and Yandex snapshot restore.

Manual and MCP callers run the SAME CLI. No GitHub Actions runner or credentials
are required on the server. This deliberately does NOT manufacture a published
release or modify .asa/installed-release.json.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deployment.contracts import verify_backup

HEX_SHA = re.compile(r"^[a-f0-9]{40}$")
SAFE_DB = re.compile(r"^[a-z][a-z0-9_]{0,55}_test$")
SERVICES = ("api", "web", "scratch", "minio")
HEALTH_SERVICES = ("postgres", "minio", "api", "scratch", "web")
SECRET_KEYS = ("ASA_SETTINGS_ENCRYPTION_KEY", "CLASSROOM_CODE_SECRET",
               "ASA_BLOCKS_RUNTIME_SIGNING_KEY", "ASA_OBJECT_STORAGE_ACCESS_KEY",
               "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_OBJECT_STORAGE_BUCKET")
KEY_FAMILIES = ("ASA_STUDENT_CODE_ENCRYPTION", "ASA_STUDENT_CODE_LOOKUP")


class Blocked(RuntimeError):
    pass


def demand(value: bool, message: str) -> None:
    if not value:
        raise Blocked(message)


def audit(event: str, **details: object) -> None:
    safe = {k: v for k, v in details.items() if k not in {"password", "secret", "token", "env"}}
    print(json.dumps({"event": event, **safe}, ensure_ascii=False, sort_keys=True), flush=True)


def run(*argv: str, cwd: Path | None = None, stdin=None, stdout=None,
        timeout: int = 120, log: Path | None = None) -> str:
    kw = {"cwd": cwd, "stdin": stdin, "timeout": timeout, "check": False}
    if log:
        with log.open("ab") as out:
            p = subprocess.run(argv, stdout=out, stderr=subprocess.STDOUT, **kw)
        if p.returncode:
            raise Blocked(f"Command failed ({p.returncode}); see private build log: {log.name}")
        return ""
    if stdout is not None:
        p = subprocess.run(argv, stdout=stdout, stderr=subprocess.PIPE, **kw)
        if p.returncode:
            raise Blocked(f"Command failed ({p.returncode}): {argv[0]} {argv[1] if len(argv)>1 else ''}")
        return ""
    p = subprocess.run(argv, capture_output=True, text=True, **kw)
    if p.returncode:
        # Never log arguments: URL-like values can embed secrets.
        raise Blocked(f"Command failed ({p.returncode}): {argv[0]}; output: {p.stderr[-500:]}")
    return p.stdout.strip()


def operator(root: Path) -> str:
    return pwd.getpwuid(root.stat().st_uid).pw_name


def git(root: Path, *args: str) -> str:
    return run("runuser", "-u", operator(root), "--", "git", "-C", str(root), *args)


def compose(root: Path, source: Path | None = None, overlay: Path | None = None) -> list[str]:
    base = ["docker", "compose", "--project-directory", str(root)]
    if overlay:
        base.extend(["--env-file", str(root / ".env"), "--env-file", str(overlay)])
    base.extend(["-f", str((source or root) / "compose.yaml"),
                 "-f", str((source or root) / "compose.production.yaml")])
    return base


def docker(root: Path, *args: str, source: Path | None = None,
           overlay: Path | None = None, **kwargs) -> str:
    return run(*compose(root, source, overlay), *args, **kwargs)


def env_read(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text("utf-8").splitlines():
        if not raw or raw.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", raw)
        if match is None:
            raise Blocked(f"Unsupported private environment entry in {path.name}")
        key, value = match.groups()
        demand(key not in values, f"Duplicate environment entry: {key}")
        value = value.strip()
        if len(value) > 1 and value[0] in "'\"" and value[-1] == value[0]:
            value = value[1:-1]
        values[key] = value
    return values


def env_replace(original: Path, overrides: dict[str, str], target: Path) -> None:
    content = original.read_text("utf-8")
    for key, value in overrides.items():
        demand(re.fullmatch(r"[A-Z][A-Z0-9_]*", key) is not None, "Invalid environment key")
        demand("\n" not in value and "'" not in value and "\r" not in value,
               f"Unsafe environment value format for {key}")
        pat = re.compile(r"(?m)^" + re.escape(key) + r"=.*$")
        demand(len(pat.findall(content)) == 1, f"Missing or duplicated environment key: {key}")
        content = pat.sub(lambda _: f"{key}='{value}'", content)
    atomic_text(target, content, 0o600)


def atomic_text(path: Path, value: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex[:8] + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temp, mode)
    os.replace(temp, path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def merge_student_keys(current: dict[str, str], archived: dict[str, str]) -> dict[str, str]:
    for key in SECRET_KEYS:
        demand(bool(current.get(key)) and current.get(key) == archived.get(key),
               f"Protected secret differs: {key}")
    demand(current.get("POSTGRES_DB") == archived.get("POSTGRES_DB") == "asalab",
           "Database identity differs")
    demand(current.get("COMPOSE_PROJECT_NAME") == archived.get("COMPOSE_PROJECT_NAME"),
           "Compose project identity differs")
    output: dict[str, str] = {}
    for family in KEY_FAMILIES:
        field = family + "_KEYS_JSON"
        a, b = json.loads(current[field]), json.loads(archived[field])
        demand(isinstance(a, dict) and isinstance(b, dict) and bool(a) and bool(b),
               f"Invalid {family} keyrings")
        for key, value in b.items():
            demand(key not in a or a[key] == value, f"Conflicting {family} key id")
        merged = {**a, **b}
        demand(current[family + "_ACTIVE_KEY_ID"] in merged, f"Current {family} active key absent")
        demand(archived[family + "_ACTIVE_KEY_ID"] in merged, f"Archived {family} active key absent")
        output[field] = json.dumps(merged, separators=(",", ":"))
    return output


def extract_snapshot(archive: Path, identity: Path | None, destination: Path,
                     expected_sha256: str | None) -> Path:
    demand(archive.is_file(), "Snapshot archive not found")
    if expected_sha256:
        demand(re.fullmatch(r"[a-f0-9]{64}", expected_sha256) is not None,
               "Expected archive checksum must be SHA256")
        demand(sha256(archive) == expected_sha256, "Encrypted snapshot SHA256 mismatch")
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    tar_path = archive
    if archive.suffix == ".age":
        demand(identity is not None and identity.is_file(), "Private age identity file required")
        tar_path = destination / "archive.tar"
        run("age", "-d", "-i", str(identity), "-o", str(tar_path), str(archive), timeout=900)
        os.chmod(tar_path, 0o600)
    demand(tarfile.is_tarfile(tar_path), "Snapshot is not a tar archive")
    with tarfile.open(tar_path, "r:") as tar:
        members = tar.getmembers()
        demand(bool(members), "Empty archive")
        tops = {x.name.split("/")[0] for x in members}
        demand(len(tops) == 1, "Archive has multiple top-level directories")
        for m in members:
            components = m.name.split("/")
            demand(not m.name.startswith("/") and ".." not in components
                   and (m.isfile() or m.isdir()), "Unsafe archive member")
        name = next(iter(tops))
        tar.extractall(destination, filter="data")
    snapshot = destination / name
    manifest = verify_backup(snapshot)
    demand(manifest.get("complete") is True, "Incomplete source snapshot")
    return snapshot


def inspected_source(root: Path, sha: str) -> Path:
    demand(HEX_SHA.fullmatch(sha) is not None, "Pin a complete 40-character main SHA")
    git(root, "fetch", "--no-tags", "origin", "main")
    git(root, "merge-base", "--is-ancestor", sha, "origin/main")
    directory = root.parent / (root.name + "-source-build") / sha
    directory.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chown(directory.parent, root.stat().st_uid, root.stat().st_gid)
    if not directory.exists():
        run("runuser", "-u", operator(root), "--", "sh", "-c",
            'umask 022; git -C "$1" worktree add --detach "$2" "$3"',
            "git-worktree", str(root), str(directory), sha, timeout=120)
    demand(git(directory, "rev-parse", "HEAD") == sha, "Source worktree revision mismatch")
    demand(not git(directory, "status", "--porcelain"), "Source worktree is dirty")
    for path in ("infra/scratch-editor/host/index.html", "docker/web/Caddyfile"):
        demand(bool((directory / path).stat().st_mode & 0o004),
               f"World-readable build asset missing: {path}")
    return directory


def image_overrides(sha: str, schema: int) -> dict[str, str]:
    short = sha[:12]
    return {"ASA_BUILD_REVISION": sha, "ASA_EXPECTED_SCHEMA_VERSION": str(schema),
            "ASA_IMAGE_TAG": "git-" + short,
            **{f"ASA_{name.upper()}_IMAGE": f"asa-lab-{name}:git-{short}" for name in SERVICES}}


def checked_root(root: Path, expected_origin: str) -> dict[str, str]:
    root = root.resolve()
    demand(os.geteuid() == 0, "Deployment needs root privileges to preserve existing Docker volumes")
    demand((root / "compose.yaml").is_file() and (root / "compose.production.yaml").is_file(),
           "Existing Compose root required")
    values = env_read(root / ".env")
    origin = values.get("ASA_UPDATE_ENTRY_ORIGIN", "")
    host = urllib.parse.urlsplit(origin).hostname or ""
    demand(origin == expected_origin and host.startswith("test."),
           "Only the explicitly attested existing HTTPS test origin can be updated")
    demand(not (root / ".asa/maintenance.json").exists(), "Unfinished ASA maintenance operation")
    demand(not (root / ".asa/failed-switch.json").exists(), "Unacknowledged failed ASA switch")
    settings = json.loads((root / ".asa/installation.json").read_text("utf-8"))
    demand(settings["profile"] == "production", "Expected existing production Compose profile")
    demand(not git(root, "status", "--porcelain"), "Existing checkout has uncommitted changes")
    demand(shutil.disk_usage(root).free >= 6 * 1024**3,
           "At least 6 GiB free disk space required before source build and restore")
    expected_project = values["COMPOSE_PROJECT_NAME"]
    for service in ("postgres", "minio", "api", "web", "scratch"):
        cid = docker(root, "ps", "-q", service)
        demand(bool(cid), f"Existing service missing: {service}")
        meta = json.loads(run("docker", "inspect", cid))[0]
        labels = meta["Config"].get("Labels") or {}
        demand(labels.get("com.docker.compose.project") == expected_project
               and labels.get("com.docker.compose.project.working_dir") == str(root),
               f"Foreign or duplicated Compose installation: {service}")
        demand(meta["State"].get("Running") is True, f"Existing service not running: {service}")
    return values


def verify_images(sha: str) -> None:
    for service in SERVICES:
        tag = f"asa-lab-{service}:git-{sha[:12]}"
        run("docker", "image", "inspect", tag)
        if service != "minio":
            revision = run("docker", "image", "inspect", tag, "--format",
                           '{{index .Config.Labels "org.opencontainers.image.revision"}}')
            demand(revision == sha, f"Built {service} revision mismatch")
    for tag, path in (("scratch", "/usr/share/nginx/html/index.html"),
                      ("web", "/etc/caddy/Caddyfile")):
        mode = run("docker", "run", "--rm", "--network", "none", "--entrypoint",
                   "stat", f"asa-lab-{tag}:git-{sha[:12]}", "-c", "%a", path)
        demand(int(mode, 8) & 0o004 != 0, f"{tag} is unreadable to the container user")


def database_query(root: Path, sql: str) -> str:
    cmd = [*compose(root), "exec", "-T", "postgres", "sh", "-c",
           'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres']
    done = subprocess.run(cmd, input=sql, text=True, capture_output=True, timeout=120)
    demand(done.returncode == 0, "PostgreSQL administrative query failed")
    return done.stdout.strip()


def db_names(root: Path) -> set[str]:
    result = database_query(root, "SELECT datname FROM pg_database;\n")
    return set(result.splitlines())


def create_stage_db(root: Path, source: Path, overlay: Path, name: str, dump: Path,
                    base: dict[str, str], job: Path) -> None:
    demand(SAFE_DB.fullmatch(name) is not None, "Invalid isolated restore database")
    demand(name not in db_names(root), "Isolated restore database already exists")
    database_query(root, f"CREATE DATABASE {name};\n")
    with dump.open("rb") as stream:
        run(*compose(root), "exec", "-T", "postgres", "sh", "-c",
            f'pg_restore --exit-on-error --single-transaction --no-owner -U "$POSTGRES_USER" -d {name}',
            stdin=stream, timeout=900, log=job / "restore.log")
    db_url = urllib.parse.urlsplit(base["MIGRATION_DATABASE_URL"])
    demand(db_url.path == "/" + base["POSTGRES_DB"], "Migration source URL target differs")
    app_url = urllib.parse.urlsplit(base["APP_DATABASE_URL"])
    demand(app_url.path == "/" + base["POSTGRES_DB"], "App source URL target differs")
    def replace_path(url):
        return urllib.parse.urlunsplit((url.scheme, url.netloc, "/" + name, url.query, url.fragment))
    stage = job / "migration.env"
    stage.write_text(overlay.read_text() + "\n" +
                     f"MIGRATION_DATABASE_URL='{replace_path(db_url)}'\n"
                     f"MIGRATION_EXPECT_DATABASE='{name}'\n"
                     f"MIGRATION_CONFIRM='APPLY:{name}'\n"
                     f"APP_DATABASE_URL='{replace_path(app_url)}'\n", encoding="utf-8")
    os.chmod(stage, 0o600)
    docker(root, "run", "--rm", "--no-deps", "migration", source=source,
           overlay=stage, timeout=1200, log=job / "migration.log")
    result = docker(root, "run", "--rm", "--no-deps", "--entrypoint", "node",
                    "migration", "tools/migrate.mjs", "--plan",
                    source=source, overlay=stage, timeout=240)
    demand("Planned 0 pending migration(s)" in result, "Migration rehearsal incomplete")
    audit("migration_rehearsed", database=name)


def minio_mount(root: Path) -> Path:
    env = env_read(root / ".env")
    name = env["COMPOSE_PROJECT_NAME"] + "_blocks-object-data"
    data = run("docker", "volume", "inspect", name, "--format", "{{.Mountpoint}}")
    path = Path(data).resolve()
    demand(path.name == "_data" and path.parent.name == name,
           "Unexpected current MinIO volume path")
    demand((path / ".minio.sys").is_dir(), "MinIO volume identity missing")
    return path


def stage_objects(root: Path, snapshot: Path, ident: str) -> Path:
    volume = f"asa-refresh-{ident}-staged"
    run("docker", "volume", "create", volume)
    path = Path(run("docker", "volume", "inspect", volume, "--format", "{{.Mountpoint}}"))
    demand(path.name == "_data" and path.parent.name == volume, "Unexpected staged volume path")
    run("rsync", "-a", str(snapshot / "objects") + "/", str(path) + "/", timeout=600)
    manifest = json.loads((snapshot / "manifest.json").read_text("utf-8"))
    paths = [name for name in manifest["files"] if name.startswith("objects/")]
    for full in paths:
        relative = full.removeprefix("objects/")
        target = path / relative
        demand(target.is_file(), "Staged object missing")
        record = manifest["files"][full]
        digest = record["sha256"] if isinstance(record, dict) else record
        demand(sha256(target) == digest, "Staged object checksum mismatch")
    audit("minio_snapshot_verified", objects=len(paths), volume=volume)
    return path


def database_counts(root: Path, name: str) -> list[str]:
    demand(re.fullmatch(r"[a-z][a-z0-9_]{0,62}", name) is not None, "Invalid database name")
    result = docker(root, "exec", "-T", "postgres", "sh", "-c",
                    f'''psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d {name} -c "select (select count(*) from public.accounts), (select count(*) from public.classrooms), (select count(*) from public.projects), (select max(version) from public.schema_migrations);"''')
    return result.strip().split("|")


def health_check(root: Path, source: Path, overlay: Path, sha: str,
                 origin: str) -> None:
    for service in HEALTH_SERVICES:
        cid = docker(root, "ps", "-q", service, source=source, overlay=overlay)
        demand(bool(cid), f"New {service} container absent")
        for _ in range(75):
            state = json.loads(run("docker", "inspect", cid))[0]["State"]
            health = (state.get("Health") or {}).get("Status", state.get("Status"))
            if health == "healthy":
                break
            time.sleep(2)
        else:
            raise Blocked(f"New {service} failed health gate")
        if service in ("api", "scratch", "web"):
            revision = run("docker", "inspect", cid, "--format",
                           '{{index .Config.Labels "org.opencontainers.image.revision"}}')
            demand(revision == sha, f"{service} runtime SHA drift")
    port = int(env_read(root / ".env").get("ASA_WEB_PORT", "4610"))
    for address in (f"http://127.0.0.1:{port}/", origin.rstrip("/") + "/"):
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    address, headers={"User-Agent": "ASA-test-refresh-operator"}), timeout=20) as res:
                demand(res.status == 200, "Unexpected portal status")
        except Exception as error:
            raise Blocked(f"Portal acceptance failed: {type(error).__name__}") from error
    audit("technical_acceptance_passed", revision=sha, user_browser_flow="NOT_RUN")


def previous_data_volume(root: Path, ident: str, active: Path) -> Path:
    name = f"asa-refresh-{ident}-previous"
    run("docker", "volume", "create", name)
    path = Path(run("docker", "volume", "inspect", name, "--format", "{{.Mountpoint}}"))
    demand(path.name == "_data" and path.parent.name == name, "Previous MinIO volume identity drift")
    run("rsync", "-a", str(active) + "/", str(path) + "/", timeout=900)
    demand((path / ".minio.sys").is_dir(), "Rollback MinIO volume incomplete")
    return path


def require_test(root: Path, expected_origin: str) -> dict[str, str]:
    demand(expected_origin.startswith("https://"), "HTTPS test origin required")
    return checked_root(root, expected_origin)


def apply(args) -> None:
    root = args.root.resolve()
    base = require_test(root, args.origin)
    demand(HEX_SHA.fullmatch(args.sha) is not None, "Pin exact source SHA")
    demand(args.ack_test_only is True, "Specify --ack-test-only for the existing test installation")
    demand(args.mode in ("preserve", "restore"), "Invalid data mode")
    demand(bool(args.archive) == (args.mode == "restore"),
           "Provide exactly one source snapshot in restore mode")
    demand(args.mode == "preserve" or args.confirm_replace_data,
           "Restore replaces the current data; explicitly pass --confirm-replace-data")
    demand(args.mode != "restore" or bool(args.archive_sha256),
           "Restore requires the exact encrypted archive SHA256 reported by cloud transfer")
    snapshot_digest = sha256(args.archive) if args.archive else None
    ident = uuid.uuid4().hex[:12]
    state_root = root / ".asa" / "test-refresh"
    state_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state_root, 0o700)
    with (state_root / "lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Blocked("Another test refresh operation owns this installation") from exc
        job = state_root / ident
        job.mkdir(mode=0o700)
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: (_ for _ in ()).throw(Blocked("Interrupted; rollback requested")))
        log = job / "build.log"
        source_head = git(root, "rev-parse", "HEAD")
        for earlier in state_root.glob("*/status.json"):
            info = json.loads(earlier.read_text("utf-8"))
            if (info.get("phase") == "complete" and info.get("sha") == args.sha
                    and info.get("archive_sha256") == snapshot_digest and source_head == args.sha):
                audit("no_change", revision=args.sha, snapshot_sha256=snapshot_digest)
                return
        if args.mode == "preserve" and source_head == args.sha:
            audit("no_change", revision=args.sha)
            return
        original_env = root / ".env"
        original_env_stat = original_env.stat()
        initial_env_digest = sha256(original_env)
        env_backup = job / "previous.env"
        old_db = f"asa_previous_{ident}"
        stage_db = f"asa_refresh_{ident}_test"
        stage_volume: Path | None = None
        old_volume: Path | None = None
        db_phase = 0
        objects_changed = False
        env_changed = False
        git_changed = False
        stopped = False
        source = None
        overlay = job / "candidate.env"
        backup_dump = job / "previous.dump"
        live_objects = minio_mount(root)
        receipt = job / "status.json"

        def checkpoint(phase: str, **other) -> None:
            atomic_text(receipt, json.dumps({"phase": phase, "job": ident, "mode": args.mode,
                                              "sha": args.sha, "old_sha": source_head,
                                              "old_database": old_db,
                                              "backup_dump": str(backup_dump),
                                              "archive_sha256": snapshot_digest,
                                              "previous_object_volume": f"asa-refresh-{ident}-previous",
                                              **other}, indent=2) + "\n")
            audit("phase", stage=phase, job=ident)

        try:
            checkpoint("preflight")
            source = inspected_source(root, args.sha)
            schema = max(int(p.name[:4]) for p in (source / "migrations").glob("[0-9]*_*.sql"))
            if args.mode == "restore":
                checkpoint("decrypt_and_verify")
                snapshot = extract_snapshot(args.archive, args.identity, job / "source", args.archive_sha256)
                archived = env_read(snapshot / "private.env")
                merged = merge_student_keys(base, archived)
            else:
                snapshot = None
                merged = {}
            settings = image_overrides(args.sha, schema)
            env_replace(original_env, {**settings, **merged}, overlay)
            os.chown(overlay, original_env_stat.st_uid, original_env_stat.st_gid)
            checkpoint("image_build")
            if not args.reuse_images:
                docker(root, "build", *SERVICES, source=source, overlay=overlay,
                       timeout=5400, log=log)
            verify_images(args.sha)
            if snapshot:
                checkpoint("isolated_restore")
                create_stage_db(root, source, overlay, stage_db, snapshot / "database.dump", base, job)
                stage_volume = stage_objects(root, snapshot, ident)
                audit("candidate_counts", accounts_classes_projects_schema=database_counts(root, stage_db))
            demand(sha256(original_env) == initial_env_digest,
                   "Private environment changed during staging; abort before cutover")
            checkpoint("freeze_and_full_backup")
            docker(root, "stop", "web", "api", "scratch", "minio", timeout=180)
            stopped = True
            with backup_dump.open("wb") as dump:
                docker(root, "exec", "-T", "postgres", "sh", "-c",
                       'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                       stdout=dump, timeout=900)
            os.chmod(backup_dump, 0o600)
            demand(backup_dump.stat().st_size > 0, "Pre-switch PostgreSQL backup empty")
            with backup_dump.open("rb") as stream:
                run(*compose(root), "exec", "-T", "postgres", "pg_restore", "--list",
                    stdin=stream, timeout=120, log=job / "backup-check.log")
            shutil.copy2(original_env, env_backup)
            os.chown(env_backup, original_env_stat.st_uid, original_env_stat.st_gid)
            os.chmod(env_backup, 0o600)
            old_volume = previous_data_volume(root, ident, live_objects)
            audit("rollback_snapshot_sealed", backup=str(backup_dump),
                  previous_minio=f"asa-refresh-{ident}-previous")
            if args.mode == "preserve":
                checkpoint("stage_preserved_data")
                create_stage_db(root, source, overlay, stage_db, backup_dump, base, job)
                staged_name = f"asa-refresh-{ident}-staged"
                run("docker", "volume", "create", staged_name)
                stage_volume = Path(run("docker", "volume", "inspect", staged_name,
                                        "--format", "{{.Mountpoint}}"))
                demand(stage_volume.name == "_data" and stage_volume.parent.name == staged_name,
                       "Unexpected preserve-stage volume")
                run("rsync", "-a", str(old_volume) + "/", str(stage_volume) + "/", timeout=900)
            demand(stage_volume is not None and (stage_volume / ".minio.sys").is_dir(),
                   "Candidate MinIO missing")
            demand(old_db not in db_names(root) and stage_db in db_names(root),
                   "Restore database name collision")
            checkpoint("switching", rollback_complete=False)
            objects_changed = True  # must precede rsync: a partial copy is a mutation
            run("rsync", "-a", "--delete", str(stage_volume) + "/", str(live_objects) + "/", timeout=900)
            database_query(root, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                         f"WHERE datname IN ('asalab','{stage_db}') AND pid<>pg_backend_pid();\n")
            database_query(root, f"ALTER DATABASE asalab RENAME TO {old_db};\n")
            db_phase = 1
            database_query(root, f"ALTER DATABASE {stage_db} RENAME TO asalab;\n")
            db_phase = 2
            checkpoint("starting_new", rollback_complete=False)
            docker(root, "up", "-d", "--no-build", source=source, overlay=overlay, timeout=330,
                   log=job / "switch.log")
            health_check(root, source, overlay, args.sha, args.origin)
            migrated = database_counts(root, "asalab")
            demand(migrated[-1] == f"{schema:04d}", "Restored database schema differs")
            checkpoint("persisting", candidate_counts=migrated)
            os.replace(overlay, original_env)
            env_changed = True
            git(root, "switch", "--detach", args.sha)
            git_changed = True
            docker(root, "config", "--quiet")
            checkpoint("complete", candidate_counts=migrated,
                       user_browser_flow="NOT_RUN", previous_data_retained=True)
            audit("refresh_complete", revision=args.sha, schema=schema,
                  accounts_classes_projects_schema=migrated,
                  rollback_database=old_db, backup=str(backup_dump))
        except Exception:
            checkpoint("failed", rollback_required=(objects_changed or db_phase > 0))
            if stopped:
                audit("automatic_rollback_started", job=ident)
                try:
                    docker(root, "stop", "web", "api", "scratch", "minio", timeout=180)
                    if db_phase == 2:
                        database_query(root, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                                       f"WHERE datname IN ('asalab','{old_db}') AND pid<>pg_backend_pid();\n")
                        database_query(root, f"ALTER DATABASE asalab RENAME TO {stage_db};\n")
                        database_query(root, f"ALTER DATABASE {old_db} RENAME TO asalab;\n")
                    elif db_phase == 1:
                        database_query(root, f"ALTER DATABASE {old_db} RENAME TO asalab;\n")
                    if objects_changed and old_volume:
                        run("rsync", "-a", "--delete", str(old_volume) + "/",
                            str(live_objects) + "/", timeout=900)
                    if env_changed:
                        shutil.copy2(env_backup, original_env)
                    if git_changed:
                        git(root, "switch", "--detach", source_head)
                    docker(root, "up", "-d", "--no-build", timeout=330,
                           log=job / "rollback.log")
                    checkpoint("failed_rolled_back")
                    audit("automatic_rollback_passed", job=ident)
                except Exception as rollback_error:
                    checkpoint("manual_recovery_required")
                    audit("automatic_rollback_FAILED", job=ident,
                          exception_type=type(rollback_error).__name__)
            raise


def status(args) -> None:
    root = args.root.resolve()
    value = env_read(root / ".env")
    data = {"git_head": git(root, "rev-parse", "HEAD"),
            "expected_schema": value.get("ASA_EXPECTED_SCHEMA_VERSION"),
            "services": {}, "recorded_jobs": []}
    for service in HEALTH_SERVICES:
        cid = docker(root, "ps", "-q", service)
        if cid:
            detail = json.loads(run("docker", "inspect", cid))[0]
            data["services"][service] = {
                "health": (detail["State"].get("Health") or {}).get("Status"),
                "image": detail["Config"]["Image"],
                "revision": (detail["Config"].get("Labels") or {}).get("org.opencontainers.image.revision"),
            }
    state_dir = root / ".asa" / "test-refresh"
    if state_dir.is_dir():
        for receipt in sorted(state_dir.glob("*/status.json"))[-5:]:
            data["recorded_jobs"].append(json.loads(receipt.read_text("utf-8")))
    print(json.dumps(data, ensure_ascii=False, indent=2))


def plan(args) -> None:
    root = args.root.resolve()
    data = env_read(root / ".env")
    demand(HEX_SHA.fullmatch(args.sha) is not None, "Full Git SHA required")
    host = urllib.parse.urlsplit(args.origin).hostname or ""
    demand(data.get("ASA_UPDATE_ENTRY_ORIGIN") == args.origin and host.startswith("test."),
           "Specified test origin differs from installation")
    if args.mode == "restore":
        demand(args.archive and args.archive.is_file(), "Archive file required")
        demand(bool(args.archive_sha256), "Archive SHA256 required")
        digest = sha256(args.archive)
        if args.archive_sha256:
            demand(digest == args.archive_sha256, "Archive digest mismatch")
    else:
        demand(not args.archive, "Preserve mode does not accept an archive")
        digest = None
    print(json.dumps({"action": "plan", "mode": args.mode, "revision": args.sha,
                      "currently_installed": git(root, "rev-parse", "HEAD"),
                      "origin": args.origin, "archive_sha256": digest,
                      "will_backup": True, "will_stage_database": True,
                      "will_verify_minio": True, "will_promote_data": True,
                      "will_keep_previous_database_and_objects": True,
                      "browser_acceptance": "separate",
                      "changed": False}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "apply", "status"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--sha", default="")
    parser.add_argument("--mode", choices=("preserve", "restore"), default="preserve")
    parser.add_argument("--origin", default="")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--archive-sha256")
    parser.add_argument("--identity", type=Path, help="Existing private age identity FILE path; never key material")
    parser.add_argument("--ack-test-only", action="store_true")
    parser.add_argument("--confirm-replace-data", action="store_true")
    parser.add_argument("--reuse-images", action="store_true",
                        help="Use cached exact-SHA images only; verification is still mandatory")
    args = parser.parse_args()
    try:
        if args.action == "status":
            status(args)
        elif args.action == "plan":
            plan(args)
        else:
            apply(args)
    except (Blocked, OSError, subprocess.TimeoutExpired, ValueError) as exc:
        audit("blocked_or_failed", category=type(exc).__name__, message=str(exc)[:700])
        raise SystemExit(78)


if __name__ == "__main__":
    main()
