"""Transactional, opt-in ASA Lab upgrade: stage a new database, preserve the old one.

The existing deployment's project/volume identity remains authoritative.
No platform or database is implicitly guessed from a port number.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

from .backup import export_backup, restore_check
from .contracts import Blocked, atomic_json, require, verify_backup, verify_embedded_entry_http
from .system import Installation, run


SERVICES = ("web", "api", "scratch", "minio", "search")
PHASES = frozenset({
    "INITIALIZED", "FREEZE_STARTED", "WRITERS_STOPPED", "BACKUP_VERIFIED",
    "SHADOW_DATABASE_READY", "MIGRATED", "ROLLBACK_OBJECTS_SAVED",
    "CANDIDATE_OBJECTS_SAVED", "OBJECT_SWITCH_STARTED", "OBJECT_SWITCHED",
    "DB_SWITCH_STARTED", "OLD_DB_RENAMED", "NEW_DB_PROMOTED",
    "CANDIDATE_STARTED", "VERIFYING", "ACCEPTED_READ_ONLY", "SUCCEEDED",
    "ROLLBACK_STARTED",
    "ROLLED_BACK", "RECOVERY_REQUIRED",
})
MARKER = "atomic-active.json"
PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def atomic_eligibility(install):
    """Fail before Docker pulls or a Git checkout switch on an unsafe host."""
    require(install.profile == "production", "ATOMIC_PROFILE",
            "The atomic updater requires an established production-profile installation.")
    require(install.env.get("ASA_ATOMIC_WRITE_FENCE") == "isolated-test",
            "ATOMIC_FENCE", "Atomic update is restricted to a fenced disposable test ingress.",
            "Do not set the flag on public D2R2/FRP or school installations.")
    entry = install.env.get("ASA_UPDATE_ENTRY_ORIGIN", "")
    require(entry.startswith("http://127.0.0.1:") or entry.startswith("http://localhost:"),
            "ATOMIC_INGRESS", "A public entry origin is not isolated.")
    state = install.root / ".asa"
    require(not (state / MARKER).exists()
            and not (state / "maintenance.json").exists()
            and not (state / "failed-switch.json").exists(),
            "ATOMIC_PENDING", "Existing maintenance/recovery markers prohibit a new update.")
    require((state / "installed-release.json").is_file(),
            "ATOMIC_RELEASE", "No pinned existing release is available.")
    return True


def _safe_identifier(value):
    require(bool(re.fullmatch(r"[a-z][a-z0-9_]{1,62}", value)),
            "ATOMIC_NAME", "Unsafe generated PostgreSQL identifier.")
    return value


def _sql(install, query, *, database="postgres"):
    # SQL text never includes owner secrets. Names are generated/validated here.
    return install.compose("exec", "-T", "postgres", "psql",
                           "-XAt", "-v", "ON_ERROR_STOP=1", "-U",
                           install.env["POSTGRES_USER"], "-d", database,
                           "-c", query, capture=True)


def _db_names(install, names):
    validated = [_safe_identifier(name) for name in names]
    values = ",".join("'" + name + "'" for name in validated)
    result = _sql(install, "SELECT datname FROM pg_database WHERE datname IN (" +
                  values + ") ORDER BY datname")
    return set(result.splitlines())


def _conn_count(install, names):
    validated = [_safe_identifier(name) for name in names]
    values = ",".join("'" + name + "'" for name in validated)
    return int(_sql(install, "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname IN (" + values + ") AND pid <> pg_backend_pid()"))


def _db_schema(install, database):
    database = _safe_identifier(database)
    return int(_sql(install, "SELECT max(version) FROM public.schema_migrations",
                    database=database))


def _db_counts(install, database):
    database = _safe_identifier(database)
    return json.loads(_sql(install, """SELECT json_build_object(
        'accounts',(SELECT count(*) FROM public.accounts),
        'classrooms',(SELECT count(*) FROM public.classrooms),
        'seats',(SELECT count(*) FROM public.classroom_student_seats),
        'projects',(SELECT count(*) FROM public.projects))""", database=database))


def _docker_bytes(argv, *, environment=None, timeout=240):
    try:
        proc = subprocess.run(["docker", *map(str, argv)], env=environment,
                              capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("ATOMIC_DOCKER", "Scoped Docker operation unavailable or timed out.",
                      "Inspect the private transaction journal before repeating.") from exc
    require(proc.returncode == 0, "ATOMIC_DOCKER",
            "Scoped Docker operation failed; exit=" + str(proc.returncode),
            "Do not remove volumes or force-reset PostgreSQL to retry.")
    return proc.stdout


def _volume_hashes(volume, postgres_image):
    # Docker 'run --mount type=volume' creates an absent volume implicitly.
    # Inspect first so a lost rollback volume is never silently replaced.
    _docker_bytes(["volume", "inspect", volume], timeout=20)
    data = _docker_bytes(["run", "--rm", "--network", "none", "--user", "0:0",
         "--mount", f"type=volume,source={volume},target=/data,readonly",
         "--entrypoint", "sh", postgres_image, "-eu", "-c",
         "find /data -type f -print0 | sort -z | xargs -0 -r sha256sum -z"])
    hashes = {}
    for line in data.split(b"\x00"):
        if line:
            digest, file = line.split(b"  ", 1)
            relative = file.decode("utf-8").removeprefix("/data/")
            require(relative and not relative.startswith("/") and ".." not in relative.split("/"),
                    "ATOMIC_PATH", "Unexpected object-storage path.")
            hashes[relative] = digest.decode("ascii")
    return hashes


def _bucket(hashes, bucket):
    prefix = bucket.rstrip("/") + "/"
    return {file: digest for file, digest in hashes.items() if file.startswith(prefix)}


def _s3_count(install):
    bucket = install.env["ASA_OBJECT_STORAGE_BUCKET"]
    result = install.compose("exec", "-T", "minio", "sh", "-eu", "-c",
        'MC_CONFIG_DIR=/tmp/.mc; export MC_CONFIG_DIR; '
        'mc alias set verify http://127.0.0.1:9000 '
        '"$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; '
        'mc ls --recursive "verify/$1" | wc -l',
        "asa-s3-probe", bucket, capture=True)
    count = int(result.strip())
    require(count >= 0, "ATOMIC_S3", "Invalid object storage listing.")
    return count


def _copy_volume(source, destination, postgres_image, *, replace=False):
    # Pre-existing destination MUST be explicitly attested before invocation.
    require(source != destination, "ATOMIC_VOLUME", "Source and target volume are identical.")
    _docker_bytes(["volume", "inspect", source], timeout=20)
    _docker_bytes(["volume", "inspect", destination], timeout=20)
    operation = ('find /to -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; '
                 if replace else
                 'test -z "$(find /to -mindepth 1 -maxdepth 1 -print -quit)"; ')
    script = "set -eu; " + operation + "cp -a /from/. /to/; chown -R 1000:1000 /to"
    _docker_bytes(["run", "--rm", "--network", "none", "--user", "0:0",
        "--mount", f"type=volume,source={source},target=/from,readonly",
        "--mount", f"type=volume,source={destination},target=/to",
        "--entrypoint", "sh", postgres_image, "-eu", "-c", script])


def _volume(install, records, service):
    destination = "/data" if service == "minio" else "/var/lib/postgresql/data"
    mounts = [m for m in records[service].get("mounts", [])
              if m.get("Destination") == destination and m.get("Type") == "volume"]
    require(len(mounts) == 1, "ATOMIC_VOLUME",
            f"{service} has no unique persistent Docker volume.")
    volume = mounts[0]["Name"]
    desc = json.loads(run(["docker", "volume", "inspect", volume], capture=True))
    labels = desc[0].get("Labels") or {}
    require(labels.get("com.docker.compose.project") == install.project,
            "ATOMIC_VOLUME", "Volume belongs to a different Compose project.")
    return volume



class AtomicSession:
    """A single guarded attempt with an fsync'ed private phase journal."""

    def __init__(self, install, release, previous, *, nonce=None):
        self.install = install
        self.root = install.root
        self.state = self.root / ".asa"
        self.release = release
        self.previous = previous
        self.nonce = nonce or uuid.uuid4().hex[:12]
        require(bool(re.fullmatch("[a-f0-9]{12}", self.nonce)),
                "ATOMIC_ID", "Invalid transaction nonce.")
        self.directory = self.state / "atomic" / self.nonce
        self.marker = self.state / MARKER
        self.data = {
            "format": "asa-atomic-update-v1",
            "nonce": self.nonce,
            "project": install.project,
            "profile": install.profile,
            "root": str(self.root),
            "source": previous,
            "selected": release,
            "oldDb": install.env["POSTGRES_DB"],
            "stageDb": f"asa_txn_{self.nonce}_test",
            "previousDb": f"asa_previous_{self.nonce}",
            "failedDb": f"asa_failed_{self.nonce}",
            "oldVolume": None,
            "rollbackVolume": install.project + "_asa_rollback_" + self.nonce,
            "candidateVolume": install.project + "_asa_candidate_" + self.nonce,
            "phase": "INITIALIZED",
            "backup": None,
            "timings": {},
        }
        for field in ("oldDb", "stageDb", "previousDb", "failedDb"):
            _safe_identifier(self.data[field])
        require(PROJECT_RE.fullmatch(install.project), "ATOMIC_PROJECT",
                "Unexpected Docker Compose project.")
        self.postgres_image = None
        self.old_hashes = None

    def phase(self, phase, **fields):
        require(phase in PHASES, "ATOMIC_PHASE", "Unsupported atomic stage.")
        self.data.update(fields)
        self.data["phase"] = phase
        self.data["at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        atomic_json(self.marker, self.data)
        atomic_json(self.directory / "journal.json", self.data)
        print(f"ATOMIC phase={phase}", flush=True)

    def begin(self):
        require(not self.marker.exists(), "ATOMIC_PENDING",
                "A prior atomic attempt still has an active journal.",
                "Use atomic-status and guarded atomic-recover; never retry apply blindly.")
        require(not self.directory.exists(), "ATOMIC_DIRECTORY",
                "Transaction directory already exists.")
        atomic_parent = self.directory.parent
        private_env = self.root / ".env"
        for path in (self.state, atomic_parent, private_env):
            if path.exists():
                metadata = path.lstat()
                require(not path.is_symlink() and not (
                    getattr(metadata, "st_file_attributes", 0)
                    & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
                    "ATOMIC_PATH", "Private transaction path traverses a reparse point.",
                    "Use a regular operator-owned directory, not a symlink.")
        require(private_env.is_file(), "ATOMIC_ENV", "Private environment file is missing.")
        require(self.install.profile == "production", "ATOMIC_PROFILE",
                "The transactional updater currently requires the production profile.",
                "Do not migrate a development/legacy installation.")
        installed = self.state / "installed-release.json"
        require(installed.is_file(), "ATOMIC_RELEASE",
                "This installation has no verified pinned release.")
        old = json.loads(installed.read_text(encoding="utf-8"))
        require(old["revision"] == self.previous["revision"]
                and int(old["schema"]) == int(self.previous["schema"]),
                "ATOMIC_RELEASE", "Installed release does not match the running source.")
        require(int(self.release["schema"]) >= int(self.previous["schema"]),
                "ATOMIC_DOWNGRADE", "Refusing a database schema downgrade.")
        require(self.release["revision"] != self.previous["revision"],
                "ATOMIC_NO_CHANGE", "A verified release is already installed.")
        require(not (self.state / "failed-switch.json").exists()
                and not (self.state / "maintenance.json").exists(),
                "ATOMIC_PENDING", "A prior maintenance operation requires recovery.")
        # Only a localhost test ingress is supported until access gating is
        # independently attested. A public origin must not be briefly writeable
        # during the pre-acceptance candidate health checks.
        origin = self.install.env.get("ASA_UPDATE_ENTRY_ORIGIN", "")
        require(origin.startswith("http://127.0.0.1:") or
                origin.startswith("http://localhost:"),
                "ATOMIC_INGRESS", "Public ingress requires an independently verified write gate.",
                "Do not perform a public production cutover using this provisional adapter.")
        # Loopback alone is not isolation: a tunnel/FRP reverse proxy may
        # still forward visitors to 127.0.0.1. Explicitly gate the experimental
        # adapter until an operator has fenced the entire external write path.
        require(self.install.env.get("ASA_ATOMIC_WRITE_FENCE") == "isolated-test",
                "ATOMIC_FENCE", "No approved isolation/write fence for atomic trial.",
                "Use only a disposable, isolated QA ingress; never infer safety from 127.0.0.1.")
        require(self.install.env.get("ASA_SEED_DEV") == "false",
                "ATOMIC_SEED", "Production profile may not run development seeding.")
        require("search" not in self.release["images"]
                or bool(self.install.env.get("ASA_SEARCH_SECRET")),
                "ATOMIC_SEARCH_SECRET", "Target search needs a saved private signing key.",
                "Prepare the key using the guarded configuration path before atomic update.")
        records = self.install.identity()
        for name, expected in old["images"].items():
            require(records.get(name, {}).get("image") == expected,
                    "ATOMIC_IMAGE_DRIFT", "Running previous service differs from pinned " + name,
                    "Do not attempt reversible update from an unverified old image.")
        self.data["oldImages"] = {
            name: records[name]["image"] for name in old["images"]
        }
        self.data["oldVolume"] = _volume(self.install, records, "minio")
        self.postgres_image = records["postgres"]["image"]
        self.data["postgresImage"] = self.postgres_image
        require(records["postgres"]["running"], "ATOMIC_POSTGRES",
                "Canonical PostgreSQL is not running.")
        require(_db_names(self.install, (self.data["stageDb"], self.data["previousDb"],
                                        self.data["failedDb"])) == set(),
                "ATOMIC_DATABASE", "Atomic shadow/rollback DB name already exists.")
        for key in ("rollbackVolume", "candidateVolume"):
            proc = subprocess.run(["docker", "volume", "inspect", self.data[key]],
                                  capture_output=True, timeout=15)
            require(proc.returncode != 0, "ATOMIC_VOLUME",
                    "An atomic candidate/rollback volume already exists.")
        self.directory.mkdir(mode=0o700, parents=True)
        saved_env = self.directory / "old.private.env"
        saved_env.write_bytes((self.root / ".env").read_bytes())
        os.chmod(saved_env, 0o600)
        self.data["envSha256"] = hashlib.sha256(saved_env.read_bytes()).hexdigest()
        atomic_json(self.directory / "installed-release.json", old)
        self.data["oldImageIds"] = {
            name: record["id"] for name, record in records.items()
            if name in ("postgres", "api", "web", "scratch", "minio", "search")
        }
        self.data["oldCounts"] = _db_counts(self.install, self.data["oldDb"])
        self.data["oldSchema"] = _db_schema(self.install, self.data["oldDb"])
        self.data["oldS3Objects"] = _s3_count(self.install)
        self.phase("INITIALIZED")

    def freeze(self):
        self.phase("FREEZE_STARTED")
        running = set(self.data["oldImageIds"])
        services = tuple(s for s in SERVICES if s in running)
        if services:
            self.install.compose("stop", *services, capture=True)
        self.phase("WRITERS_STOPPED")
        require(_conn_count(self.install, (self.data["oldDb"],)) == 0,
                "ATOMIC_WRITERS", "Application database still has active sessions.")
        require(_db_schema(self.install, self.data["oldDb"]) == self.data["oldSchema"]
                and _db_counts(self.install, self.data["oldDb"]) == self.data["oldCounts"],
                "ATOMIC_DRIFT", "Database changed before the consistent snapshot.")

    def frozen_backup(self):
        destination = self.directory / "backup"
        backup = export_backup(self.install, destination,
                               resume_services=False, frozen_runtime=self.previous)
        manifest = verify_backup(backup)
        require(manifest["runtime"]["revision"] == self.previous["revision"],
                "ATOMIC_BACKUP", "Backup identifies another runtime.")
        self.data["backup"] = str(backup)
        self.phase("BACKUP_VERIFIED")
        return manifest

    def stage_db(self, target_install):
        backup = Path(self.data["backup"])
        restore_check(self.install, backup, self.data["stageDb"])
        self.phase("SHADOW_DATABASE_READY")
        before = self.data["oldCounts"]
        require(_db_counts(self.install, self.data["stageDb"]) == before,
                "ATOMIC_RESTORE", "Restored candidate population differs from the frozen source.")
        # The image is pinned to the already CI-approved exact target digest.
        parsed = urlsplit(target_install.env["MIGRATION_DATABASE_URL"])
        require(parsed.scheme in ("postgres", "postgresql") and parsed.path,
                "ATOMIC_DATABASE_URL", "Missing attested PostgreSQL migration URL.")
        candidate_url = urlunsplit(parsed._replace(path="/" + self.data["stageDb"]))
        target_install.process_env.update({
            "MIGRATION_DATABASE_URL": candidate_url,
            "MIGRATION_EXPECT_DATABASE": self.data["stageDb"],
            "MIGRATION_CONFIRM": "APPLY:" + self.data["stageDb"],
        })
        args = ("run", "--rm", "--no-deps", "-e", "MIGRATION_DATABASE_URL",
                "-e", "MIGRATION_EXPECT_DATABASE", "-e", "MIGRATION_CONFIRM",
                "--entrypoint", "node", "migration", "tools/migrate.mjs")
        target_install.compose(*args, "--plan", capture=True)
        target_install.compose(*args, "--apply", capture=True)
        target_install.compose(*args, "--plan", capture=True)
        require(_db_schema(self.install, self.data["stageDb"]) == self.release["schema"],
                "ATOMIC_MIGRATION", "Shadow schema does not match the target release.")
        require(_db_counts(self.install, self.data["stageDb"]) == before,
                "ATOMIC_MIGRATION", "Shadow migration altered protected population counts.")
        # Lock the runtime role to read-only during candidate Web checks.
        app_role = _safe_identifier(urlsplit(self.install.env["APP_DATABASE_URL"]).username or "")
        self.data["appRole"] = app_role
        _sql(self.install, "ALTER ROLE " + app_role + " IN DATABASE " +
             _safe_identifier(self.data["stageDb"]) +
             " SET default_transaction_read_only TO on")
        self.phase("MIGRATED")

    def app_role_readonly(self):
        role = _safe_identifier(self.data["appRole"])
        database = _safe_identifier(self.data["oldDb"])
        query = ("SELECT EXISTS(SELECT 1 FROM pg_db_role_setting s "
                 "JOIN pg_roles r ON r.oid=s.setrole "
                 "JOIN pg_database d ON d.oid=s.setdatabase "
                 "WHERE r.rolname='" + role + "' AND d.datname='" + database + "' "
                 "AND 'default_transaction_read_only=on'=ANY(s.setconfig))")
        return _sql(self.install, query) == "t"

    def stage_objects(self):
        original = self.data["oldVolume"]
        original_hashes = _volume_hashes(original, self.postgres_image)
        atomic_json(self.directory / "old-object-hashes.private.json", original_hashes)
        self.old_hashes = original_hashes
        self.data["oldBucketFiles"] = len(_bucket(original_hashes, self.install.env["ASA_OBJECT_STORAGE_BUCKET"]))
        for name, phase in (("rollbackVolume", "ROLLBACK_OBJECTS_SAVED"),
                            ("candidateVolume", "CANDIDATE_OBJECTS_SAVED")):
            dest = self.data[name]
            created = run(["docker", "volume", "create", "--label",
                           "asa.atomic.project=" + self.install.project, "--label",
                           "asa.atomic.nonce=" + self.nonce, dest], capture=True)
            require(created == dest, "ATOMIC_VOLUME", "Unexpected scoped Docker volume.")
            _copy_volume(original, dest, self.postgres_image)
            require(_volume_hashes(dest, self.postgres_image) == original_hashes,
                    "ATOMIC_VOLUME", "Staged object hashes differ from frozen source.")
            self.phase(phase)



    def promote(self, target_install):
        previous_db = self.data["oldDb"]
        stage_db = self.data["stageDb"]
        prior_db = self.data["previousDb"]
        require(_db_names(self.install, (previous_db, stage_db, prior_db))
                == {previous_db, stage_db}, "ATOMIC_DATABASE",
                "Candidate/previous PostgreSQL names are no longer unique.")
        require(_conn_count(self.install, (previous_db, stage_db)) == 0,
                "ATOMIC_WRITERS", "Active database sessions exist at cutover.")
        require(_db_counts(self.install, previous_db) == self.data["oldCounts"],
                "ATOMIC_DRIFT", "Source database changed during staging.")
        self.phase("OBJECT_SWITCH_STARTED")
        _copy_volume(self.data["candidateVolume"], self.data["oldVolume"],
                     self.postgres_image, replace=True)
        candidate_hashes = _volume_hashes(self.data["candidateVolume"], self.postgres_image)
        require(_volume_hashes(self.data["oldVolume"], self.postgres_image) == candidate_hashes,
                "ATOMIC_OBJECTS", "Object-store content was not copied completely.")
        self.phase("OBJECT_SWITCHED")
        self.phase("DB_SWITCH_STARTED")
        _sql(self.install, "ALTER DATABASE " + _safe_identifier(previous_db) +
             " RENAME TO " + _safe_identifier(prior_db))
        self.phase("OLD_DB_RENAMED")
        _sql(self.install, "ALTER DATABASE " + _safe_identifier(stage_db) +
             " RENAME TO " + _safe_identifier(previous_db))
        self.phase("NEW_DB_PROMOTED")
        require(_db_names(self.install, (previous_db, stage_db, prior_db))
                == {previous_db, prior_db}, "ATOMIC_DATABASE",
                "PostgreSQL cutover names did not reconcile.")
        require(_db_schema(self.install, previous_db) == self.release["schema"],
                "ATOMIC_DATABASE", "Promoted database schema is not the selected release.")

    def verify_candidate_without_ingress(self, target_install):
        # Do not start public Caddy while internal health probes can still fail.
        # 'up' on these services honors depends_on migration/API requirements.
        require(self.app_role_readonly(), "ATOMIC_WRITE_GATE",
                "Candidate app role must remain read-only before starting services.")
        self.phase("CANDIDATE_STARTED")
        target_install.compose("up", "-d", "--no-build", "--wait",
                               "--wait-timeout", "180",
                               "postgres", "minio", "search", "scratch", "api", capture=True)
        require(_db_schema(self.install, self.data["oldDb"]) == self.release["schema"],
                "ATOMIC_HEALTH", "Target schema changed unexpectedly.")
        require(self.app_role_readonly(), "ATOMIC_WRITE_GATE",
                "Candidate runtime lost its database write gate.")
        current = _volume_hashes(self.data["oldVolume"], self.postgres_image)
        staged = _volume_hashes(self.data["candidateVolume"], self.postgres_image)
        bucket = self.install.env["ASA_OBJECT_STORAGE_BUCKET"]
        require(_bucket(current, bucket) == _bucket(staged, bucket),
                "ATOMIC_OBJECTS", "Published MinIO user bucket differs from staged data.")
        # MinIO can regenerate .minio.sys metadata on start. Verify the S3 path,
        # not unstable internal file hash equality.
        count = _s3_count(target_install)
        require(count == self.data["oldS3Objects"],
                "ATOMIC_S3", "S3 object population changed during the frozen upgrade.")
        self.data["s3ObjectCount"] = count

    def expose_and_accept(self, target_install):
        require(self.app_role_readonly(), "ATOMIC_WRITE_GATE",
                "Candidate database is not read-only for the app role.")
        self.phase("VERIFYING")
        target_install.compose("up", "-d", "--no-build", "--wait",
                               "--wait-timeout", "180", "web", capture=True)
        target_install.wait_ready(self.release["revision"], self.release["schema"])
        verify_embedded_entry_http(self.install.env["ASA_UPDATE_ENTRY_ORIGIN"],
                                   self.release["revision"])
        # No longer permit fully automatic rollback: public ingress has been
        # exposed and users may have written records. Preserve old version but
        # never overwrite an accepted/newly writable candidate implicitly.
        require(_db_schema(self.install, self.data["oldDb"]) == self.release["schema"],
                "ATOMIC_HEALTH", "Production database schema drifted.")
        self.phase("ACCEPTED_READ_ONLY")
        atomic_json(self.state / "installed-release.json", self.release)
        # After acceptance, never roll back automatically: opening writes is
        # itself the commit boundary. Existing API sessions may remain read-only,
        # so recreate API against the reset role configuration.
        _sql(self.install, "ALTER ROLE " + _safe_identifier(self.data["appRole"]) +
             " IN DATABASE " + _safe_identifier(self.data["oldDb"]) +
             " RESET default_transaction_read_only")
        target_install.compose("up", "-d", "--no-build", "--no-deps",
                               "--force-recreate", "api", capture=True)
        target_install.wait_ready(self.release["revision"], self.release["schema"])
        self.phase("SUCCEEDED")
        self.install.receipt({
            "status": "success", "phase": "atomic", "source": self.previous,
            "selected": self.release, "backup": self.data["backup"],
            "s3Objects": self.data["s3ObjectCount"], "userFlow": "not_run",
        })
        self.archive_finished()
        print(f"UPDATED_ATOMIC {self.release['revision']} schema={self.release['schema']}",
              flush=True)

    def rollback_before_ingress(self):
        """Automatic before ingress; after exposure a separate reconciliation is mandatory."""
        if self.data["phase"] in ("ACCEPTED_READ_ONLY", "SUCCEEDED") or (
                self.data["phase"] == "VERIFYING" and not self.app_role_readonly()):
            raise Blocked("ATOMIC_RECOVERY_REQUIRED",
                          "Candidate ingress was exposed; new writes must be reconciled.",
                          "Preserve both databases, private config, object volumes and the journal.")
        self.phase("ROLLBACK_STARTED")
        self.install.compose("stop", *(s for s in SERVICES
                                      if s in self.data.get("oldImageIds", {}) or s == "search"),
                             capture=True)
        old = self.data["oldDb"]
        prior = self.data["previousDb"]
        failed = self.data["failedDb"]
        candidate = self.data["stageDb"]
        current = _db_names(self.install, (old, prior, failed, candidate))
        if prior in current:
            if old in current:
                require(failed not in current, "ATOMIC_RECOVERY",
                        "Failed-candidate database name already exists.")
                _sql(self.install, f"ALTER DATABASE {_safe_identifier(old)} "
                    f"RENAME TO {_safe_identifier(failed)}")
            _sql(self.install, f"ALTER DATABASE {_safe_identifier(prior)} "
                 f"RENAME TO {_safe_identifier(old)}")
        else:
            require(old in current, "ATOMIC_RECOVERY",
                    "No verified prior application database exists.")
            require(_db_schema(self.install, old) == self.data["oldSchema"]
                    and _db_counts(self.install, old) == self.data["oldCounts"],
                    "ATOMIC_RECOVERY", "Active database is not the prior snapshot.")
        old_hash_path = self.directory / "old-object-hashes.private.json"
        if old_hash_path.exists():
            old_hashes = json.loads(old_hash_path.read_text(encoding="utf-8"))
            actual = _volume_hashes(self.data["oldVolume"], self.postgres_image)
            if actual != old_hashes:
                rollback_volume = self.data["rollbackVolume"]
                require(_volume_hashes(rollback_volume, self.postgres_image) == old_hashes,
                        "ATOMIC_RECOVERY", "Rollback MinIO volume differs from frozen source.")
                _copy_volume(rollback_volume, self.data["oldVolume"],
                             self.postgres_image, replace=True)
                require(_volume_hashes(self.data["oldVolume"], self.postgres_image)
                        == old_hashes, "ATOMIC_RECOVERY",
                        "Previous MinIO volume was not restored.")
        previous_env = self.directory / "old.private.env"
        require(previous_env.is_file() and
                hashlib.sha256(previous_env.read_bytes()).hexdigest()
                == self.data["envSha256"], "ATOMIC_RECOVERY",
                "Previous private configuration is unavailable.")
        backup_env_tmp = self.root / ".env.asa-atomic-recover.tmp"
        if backup_env_tmp.exists():
            require(backup_env_tmp.read_bytes() == previous_env.read_bytes(),
                    "ATOMIC_RECOVERY", "Pending recovery config differs from saved baseline.")
        else:
            backup_env_tmp.write_bytes(previous_env.read_bytes())
        os.replace(backup_env_tmp, self.root / ".env")
        # An older checkout may not understand atomic-active.json. Set its
        # established legacy guard BEFORE switching source code back, so a
        # power interruption never permits a blind in-place retry.
        legacy_guard = self.state / "failed-switch.json"
        guard_data = {"phase": "atomic_rollback", "nonce": self.nonce,
                      "previous": self.previous, "selected": self.release}
        if legacy_guard.exists():
            require(json.loads(legacy_guard.read_text(encoding="utf-8")) == guard_data,
                    "ATOMIC_RECOVERY", "An unrelated failed-switch marker exists.",
                    "Do not overwrite foreign maintenance state.")
        else:
            atomic_json(legacy_guard, guard_data)
        # The operating checkout may have been advanced before staging. Do not
        # run new-version compose against a previous database.
        old_revision = self.previous["revision"]
        require(not run(["git", "status", "--porcelain"], cwd=self.root, capture=True),
                "ATOMIC_WIP", "New local source changes appeared during maintenance.",
                "Preserve these edits and recover from a separate checked-out manager.")
        run(["git", "switch", "--detach", old_revision], cwd=self.root, capture=True)
        atomic_json(self.state / "installed-release.json",
                    json.loads((self.directory / "installed-release.json").read_text(encoding="utf-8")))
        old_install = Installation(self.root, self.install.profile)
        old_install.compose("up", "-d", "--no-build", capture=True)
        old_install.wait_ready(old_revision, self.data["oldSchema"])
        require(_db_counts(old_install, old) == self.data["oldCounts"],
                "ATOMIC_RECOVERY", "Old records do not match frozen pre-update data.")
        self.phase("ROLLED_BACK")
        old_install.receipt({"status": "rolled_back", "source": self.previous,
                             "selected": self.release, "backup": self.data["backup"]})
        legacy_guard.unlink()
        self.archive_finished()
        print("ROLLED_BACK previous ASA Lab data and application verified", flush=True)

    def archive_finished(self):
        require(self.data["phase"] in ("SUCCEEDED", "ROLLED_BACK"),
                "ATOMIC_PHASE", "Cannot archive an incomplete or failed update.")
        atomic_json(self.directory / "receipt.json", self.data)
        self.marker.unlink()

    def record_elapsed(self, step, started):
        elapsed = round(time.monotonic() - started, 2)
        self.data.setdefault("timings", {})[step] = elapsed
        if self.marker.exists():
            atomic_json(self.marker, self.data)
            atomic_json(self.directory / "journal.json", self.data)
        elif (self.directory / "receipt.json").exists():
            atomic_json(self.directory / "receipt.json", self.data)
        print(f"ATOMIC_STEP {step} seconds={elapsed:.2f}", flush=True)

    def run(self, target_install):
        steps = (
            ("preflight", self.begin),
            ("write_freeze", self.freeze),
            ("full_backup", self.frozen_backup),
            ("shadow_migration", lambda: self.stage_db(target_install)),
            ("object_snapshots", self.stage_objects),
            ("cutover", lambda: self.promote(target_install)),
            ("internal_health", lambda: self.verify_candidate_without_ingress(target_install)),
            ("acceptance", lambda: self.expose_and_accept(target_install)),
        )
        try:
            for name, stage in steps:
                started = time.monotonic()
                stage()
                self.record_elapsed(name, started)
        except BaseException as failure:
            failed_phase = self.data["phase"]
            if self.marker.exists() and failed_phase not in ("SUCCEEDED", "ROLLED_BACK"):
                try:
                    self.rollback_before_ingress()
                except BaseException as rollback_error:
                    unsafe = failed_phase in ("ACCEPTED_READ_ONLY", "SUCCEEDED") or (
                        failed_phase == "VERIFYING" and self.data["phase"] != "ROLLBACK_STARTED")
                    self.phase("RECOVERY_REQUIRED", reason=type(rollback_error).__name__,
                               possibleNewWrites=unsafe)
                    raise Blocked("ATOMIC_RECOVERY_REQUIRED",
                                  "Atomic upgrade failed and recovery needs independent review.",
                                  "Do not rerun install/update or delete volumes. Inspect atomic-status.") from failure
            raise



def atomic_status(root):
    """Read-only, fail-closed status of one unfinished transaction."""
    root = Path(root).resolve()
    marker = root / ".asa" / MARKER
    if not marker.exists():
        return None
    require(marker.is_file() and not marker.is_symlink(),
            "ATOMIC_JOURNAL", "Atomic marker is not a regular file.")
    try:
        state = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Blocked("ATOMIC_JOURNAL", "Atomic marker cannot be parsed.",
                      "Do not retry updates; inspect the existing marker.") from exc
    require(state.get("format") == "asa-atomic-update-v1"
            and state.get("root") == str(root)
            and state.get("phase") in PHASES
            and bool(re.fullmatch("[a-f0-9]{12}", state.get("nonce", ""))),
            "ATOMIC_JOURNAL", "Atomic journal identity or phase is invalid.")
    return state


def atomic_recover(root):
    """Recover ONLY pre-acceptance failure; never overwrite accepted user writes."""
    state = atomic_status(root)
    require(state is not None, "ATOMIC_NO_RECOVERY",
            "No interrupted atomic transaction exists.")
    require(state["phase"] not in ("SUCCEEDED", "ACCEPTED_READ_ONLY")
            and state.get("possibleNewWrites") is not True,
            "ATOMIC_ACCEPTED", "Candidate may have accepted new user writes.",
            "Do not roll back automatically. Reconcile both databases and objects first.")
    require(state.get("profile") == "production", "ATOMIC_PROFILE",
            "Unexpected recovery profile.")
    install = Installation(root, state["profile"])
    require(install.project == state["project"], "ATOMIC_PROJECT",
            "Current Compose project differs from the transaction journal.")
    nonce = state["nonce"]
    expected_names = {
        "oldDb": install.env["POSTGRES_DB"],
        "stageDb": f"asa_txn_{nonce}_test",
        "previousDb": f"asa_previous_{nonce}",
        "failedDb": f"asa_failed_{nonce}",
        "rollbackVolume": install.project + "_asa_rollback_" + nonce,
        "candidateVolume": install.project + "_asa_candidate_" + nonce,
    }
    for key, expected in expected_names.items():
        require(state.get(key) == expected, "ATOMIC_JOURNAL",
                "Recorded PostgreSQL/MinIO identity differs from the generated names.",
                "Never rename another database or attach an unknown volume.")
    baseline = install.identity()
    actual_vol = _volume(install, baseline, "minio")
    require(state.get("oldVolume") == actual_vol, "ATOMIC_VOLUME",
            "Live MinIO volume differs from the prior recorded volume.")
    marker = Path(root) / ".asa" / MARKER
    nonce = state["nonce"]
    txn = AtomicSession(install, state["selected"], state["source"], nonce=nonce)
    txn.data = state
    txn.postgres_image = state.get("postgresImage")
    require(txn.postgres_image == baseline["postgres"]["image"],
            "ATOMIC_ENGINE", "PostgreSQL engine image changed during interrupted cutover.")
    data_dir = txn.directory
    require(data_dir.is_dir() and not data_dir.is_symlink(),
            "ATOMIC_JOURNAL", "Atomic recovery directory missing.")
    old_release = json.loads((data_dir / "installed-release.json").read_text(encoding="utf-8"))
    require(old_release["revision"] == state["source"]["revision"],
            "ATOMIC_RELEASE", "Previous pinned release is not verified.")
    old_env = data_dir / "old.private.env"
    require(old_env.is_file() and not old_env.is_symlink()
            and hashlib.sha256(old_env.read_bytes()).hexdigest() == state["envSha256"],
            "ATOMIC_ENV", "Previous private configuration is invalid.")
    backup_path = state.get("backup")
    if backup_path:
        manifest = verify_backup(backup_path)
        require(manifest["runtime"]["revision"] == state["source"]["revision"]
                and int(manifest["runtime"]["schema"]) == state["source"]["schema"],
                "ATOMIC_BACKUP", "Previous recovery backup does not match the journal.")
    # Never reconstruct missing rollback volume from a name alone. If objects
    # were changed, validate existing volume ownership + saved hashes.
    hash_path = data_dir / "old-object-hashes.private.json"
    if hash_path.exists():
        saved = json.loads(hash_path.read_text(encoding="utf-8"))
        current = _volume_hashes(actual_vol, txn.postgres_image)
        if current != saved:
            rollback = state["rollbackVolume"]
            rows = json.loads(run(["docker", "volume", "inspect", rollback],
                                  capture=True))
            labels = rows[0].get("Labels") or {}
            require(labels.get("asa.atomic.project") == install.project
                    and labels.get("asa.atomic.nonce") == nonce,
                    "ATOMIC_VOLUME", "Rollback volume ownership cannot be attested.")
            require(_volume_hashes(rollback, txn.postgres_image) == saved,
                    "ATOMIC_VOLUME", "Rollback volume has changed.")
    if state["phase"] == "VERIFYING":
        require(txn.app_role_readonly(), "ATOMIC_WRITE_GATE",
                "The candidate is exposed and its database is no longer read-only.",
                "Do not revert data that users may have changed.")
    txn.rollback_before_ingress()
    require(not marker.exists(), "ATOMIC_RECOVERY",
            "Recovery marker remains after rollback verification.")
    return "ROLLED_BACK"
