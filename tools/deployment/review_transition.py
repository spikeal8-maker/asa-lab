"""One-time, fail-closed move from the known source-mounted review to a fresh release namespace.

This entry point is deliberately separate from ordinary install/update.  It never
repairs the old migration ledger or selects another Compose project/volume.
"""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .backup import db_command, export_backup
from .contracts import (REGISTRY, Blocked, atomic_json, attest_editor_env, file_hash,
                        require, validate_release, verify_backup, verify_embedded_entry_http)
from .paths import atomic_bytes, plain_paths
from .releases import (apply_release_environment, assert_ci,
                       fetch_images, validate_resolved_images)
from .system import Installation, operation_lock, run


REVIEW_FILE = ".asa/local-review/compose.review.yaml"
APPROVED_OVERLAY_SHA256 = "64e872c816738c9c5cba928269e99f9485477bd905b10083fcfab042cc87d0f0"
APPROVED_OLD_REVISION = "2d6394a299418b8ada6a77b0a17748b946cf4ace"
APPROVED_REVIEW_IMAGE = "asa-lab-dev-workspace:ai-review-2d6394a2"
APPROVED_RELEASE_REVISION = "0027b5c1e75d151ebde1c2df734d87eb795b25e3"
APPROVED_RELEASE_DIGEST = "sha256:ed6b87bca8957f3f74a30ffbd2422f1ac6e442206fe76bb15211723a08c537e6"
REVIEW_BINDS = (
    ("api", "/workspace/apps/api/src", "apps/api/src"),
    ("api", "/workspace/packages/contracts/dist", "packages/contracts/dist"),
    ("api", "/workspace/.asa/local-review", ".asa/local-review"),
    ("web", "/workspace/apps/web/src", "apps/web/src"),
    ("web", "/workspace/.asa/local-review", ".asa/local-review"),
)
SOURCE_TREES = ("apps/api/src", "apps/web/src", "packages/contracts/dist", ".asa/local-review")
PHASE_FILE = "review-fresh-operation.json"
OLD_SERVICES = ("postgres", "minio", "search", "scratch", "api", "web")
NAMESPACE_NAME = re.compile(r"[a-z][a-z0-9_]{2,47}\Z")
BUCKET_NAME = re.compile(r"[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]\Z")
PRESERVED_API_KEYS = ("ASA_SETTINGS_ENCRYPTION_KEY", "CLASSROOM_CODE_SECRET",
                      "ASA_STUDENT_CODE_PROTECTION_MODE", "ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON",
                      "ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID", "ASA_STUDENT_CODE_LOOKUP_KEYS_JSON",
                      "ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID", "ASA_BLOCKS_RUNTIME_SIGNING_KEY",
                      "ASA_BLOCKS_RUNTIME_ORIGIN", "ASA_OBJECT_STORAGE_ENDPOINT",
                      "ASA_OBJECT_STORAGE_REGION", "ASA_OBJECT_STORAGE_ACCESS_KEY",
                      "ASA_OBJECT_STORAGE_SECRET_KEY", "ASA_OBJECT_STORAGE_FORCE_PATH_STYLE")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=True).encode()).hexdigest()


def private_destination(root, path):
    root, path = Path(root).resolve(), Path(path).resolve()
    plain_paths(path.parent, (path.name,))
    require(not path.is_relative_to(root) and not root.is_relative_to(path),
            "REVIEW_OUTPUT", "Transition evidence must be outside the installation.")
    require(path.parent.is_dir() and not path.exists(), "REVIEW_OUTPUT",
            "Choose a new path under an existing private directory; no evidence is overwritten.")
    if os.name == "nt":
        require(path.is_relative_to(Path.home().resolve()), "REVIEW_OUTPUT",
                "Private transition evidence must stay inside the operator profile.")
        script = ('$acl=Get-Acl -LiteralPath $env:ASA_REVIEW_PRIVATE_PARENT; '
                  '$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; '
                  '$owner=([Security.Principal.NTAccount]$acl.Owner).Translate([Security.Principal.SecurityIdentifier]).Value; '
                  'if($owner -ne $me){exit 2}; '
                  '$allowed=@($me,"S-1-5-18","S-1-5-32-544"); '
                  'foreach($entry in $acl.Access){ '
                  '$sid=$entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; '
                  'if($sid -notin $allowed -and $entry.AccessControlType -eq "Allow"){exit 3}}')
        result = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                                env={**os.environ, "ASA_REVIEW_PRIVATE_PARENT": str(path.parent)},
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        require(result.returncode == 0, "REVIEW_OUTPUT",
                "Private evidence parent ACL permits another owner or broad read/write access.")
    else:
        stat = path.parent.stat()
        require(stat.st_uid == os.getuid() and stat.st_mode & 0o077 == 0,
                "REVIEW_OUTPUT", "Private evidence parent must be owned by the operator with mode 0700.")
    return path


def validate_names(old_database, old_bucket, database, bucket):
    require(isinstance(database, str) and NAMESPACE_NAME.fullmatch(database)
            and database not in (old_database, "postgres", "template0", "template1")
            and not database.endswith("_test"), "REVIEW_DATABASE",
            "A new unique permanent database name is required.")
    require(isinstance(bucket, str) and BUCKET_NAME.fullmatch(bucket)
            and bucket != old_bucket and ".." not in bucket and not bucket.startswith("xn--"),
            "REVIEW_BUCKET", "A new unique private object bucket is required.")


def replacement_env(raw, old, database, bucket):
    """Change namespace selectors only; keep every existing secret and key byte."""
    expected = {"POSTGRES_DB": database,
                "MIGRATION_EXPECT_DATABASE": database,
                "MIGRATION_CONFIRM": "APPLY:" + database,
                "ASA_OBJECT_STORAGE_BUCKET": bucket}
    for key in ("APP_DATABASE_URL", "MIGRATION_DATABASE_URL"):
        parsed = urlsplit(old[key])
        require(parsed.scheme in ("postgres", "postgresql") and parsed.hostname == "postgres"
                and parsed.path == "/" + old["POSTGRES_DB"] and not parsed.query and not parsed.fragment,
                "REVIEW_DATABASE", f"Existing {key} does not target the old local database.")
        expected[key] = urlunsplit((parsed.scheme, parsed.netloc, "/" + database, "", ""))
    text = raw.decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines(keepends=True)
    seen = set()
    for index, line in enumerate(lines):
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*?)(\r?\n)?$", line)
        if not match or match[1] not in expected:
            continue
        require(match[1] not in seen, "REVIEW_ENV", "Duplicate namespace selector in private .env.")
        require(match[2] == old[match[1]], "REVIEW_ENV",
                "A private namespace selector differs from the attested old environment.")
        seen.add(match[1])
        lines[index] = match[1] + "=" + expected[match[1]] + (match[3] or "")
    require(seen == set(expected), "REVIEW_ENV", "Private .env lacks required namespace selectors.")
    result = "".join(lines).encode("utf-8")
    require(result != raw and newline.encode() in result, "REVIEW_ENV", "Namespace selectors did not change.")
    return result


class ReviewInstallation(Installation):
    """Only the observed dev review overlay; ordinary Installation stays strict."""

    def __init__(self, root):
        super().__init__(root, "dev")
        require(not (self.state / "installed-release.json").exists(), "REVIEW_MODE",
                "The installation is already managed by published releases.")
        require(self.project == "asa-lab-dev" and self.env.get("ASA_WEB_PORT", "4610") == "4610"
                and self.env.get("ASA_API_PORT", "4611") == "4611"
                and self.env.get("ASA_BLOCKS_PORT", "4613") == "4613", "REVIEW_PORTS",
                "The review transition accepts only the known local project and ports.")
        self.files.append(REVIEW_FILE)
        self.compose_args += ["-f", str(self.root / REVIEW_FILE)]

    def readiness(self, revision=None, schema=None):
        with urlopen("http://127.0.0.1:4610/health/ready", timeout=10) as response:
            ready = json.load(response)
        deployment = ready.get("deployment") or {}
        actual = deployment.get("revision")
        require(ready.get("status") == "ready" and deployment.get("synchronized") is True
                and re.fullmatch(r"[0-9a-f]{40}", actual or "")
                and (revision is None or actual == revision)
                and deployment.get("schemaVersion") == deployment.get("expectedSchemaVersion")
                and (schema is None or deployment.get("schemaVersion") == schema), "REVIEW_HEALTH",
                "Old API readiness/revision/schema is inconsistent.")
        scratch = self.compose("exec", "-T", "scratch", "wget", "-qO-",
                               "http://127.0.0.1:8080/asa-commit.txt", capture=True)
        require(scratch == actual, "REVIEW_HEALTH", "Old Scratch revision differs from API.")
        # Vite serves index HTML at build-metadata.json. Never claim Web revision from it.
        with urlopen("http://127.0.0.1:4610/build-metadata.json", timeout=10) as response:
            metadata = response.read(1024).decode("utf-8", "replace")
        require(metadata.lstrip().lower().startswith("<!doctype html>"), "REVIEW_WEB",
                "The old Web is not the known source-mounted Vite review.")
        return {"revision": actual, "schema": deployment["schemaVersion"],
                "webMetadata": "unverified-vite-html"}


def _git(root, *args, binary=False):
    result = subprocess.run(["git", *args], cwd=root, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})
    require(result.returncode == 0, "REVIEW_GIT", "Cannot inspect the canonical Git checkout.")
    return result.stdout if binary else result.stdout.decode("utf-8").strip()


def wip_snapshot(root):
    root = Path(root)
    status = _git(root, "status", "--porcelain=v1", "--untracked-files=all", "-z", binary=True)
    require(not _git(root, "diff", "--cached", "--name-only"), "REVIEW_INDEX",
            "The canonical index contains staged work; preserve it separately first.")
    entries = [item.decode("utf-8") for item in status.split(b"\0") if item]
    files = {}
    for item in entries:
        require(item[:2] == "??" or item[:2] in (" M", "M "), "REVIEW_WIP",
                "Renames, deletions and unusual Git status need a separate preservation plan.")
        relative = item[3:].replace("\\", "/")
        require(".." not in Path(relative).parts, "REVIEW_WIP", "Unsafe dirty path.")
        path = root / relative
        require(path.is_file() and not path.is_symlink(), "REVIEW_WIP", "Dirty file is missing or redirected.")
        files[relative] = {"status": item[:2], "sha256": file_hash(path), "bytes": path.stat().st_size}
    return {"head": _git(root, "rev-parse", "HEAD"),
            "branch": _git(root, "branch", "--show-current"), "files": files,
            "statusSha256": hashlib.sha256(status).hexdigest()}


def tree_fingerprint(root, relative):
    root = Path(root)
    directory = root / relative
    require(directory.is_dir() and not directory.is_symlink(), "REVIEW_SOURCE",
            "A required mounted source directory is missing or redirected.")
    members = []
    for path in sorted(directory.rglob("*")):
        require(not path.is_symlink(), "REVIEW_SOURCE", "Mounted source contains a redirected path.")
        if path.is_file():
            members.append((path.relative_to(directory).as_posix(), path.stat().st_size, file_hash(path)))
    return {"files": len(members), "sha256": digest(members)}


def _psql(install, sql, *, database=None):
    args = ["exec", "-T"]
    if database:
        args += ["-e", f"RESTORE_DATABASE={database}"]
    args += ["postgres", "sh", "-eu", "-c",
             'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" '
             '-d "${RESTORE_DATABASE:-$POSTGRES_DB}" -c "$1"', "review-psql", sql]
    return install.compose(*args, capture=True)


def database_names(install):
    return _psql(install, "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname").splitlines()


def table_counts(install, database):
    names = _psql(install, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
                  database=database).splitlines()
    require(all(re.fullmatch(r"[a-z][a-z0-9_]*", name) for name in names), "REVIEW_DATABASE",
            "A source table name needs an explicit count adapter.")
    if not names:
        return {}
    sql = " UNION ALL ".join(f"SELECT '{name}', count(*) FROM \"{name}\"" for name in names)
    rows = _psql(install, sql, database=database).splitlines()
    counts = {}
    for row in rows:
        name, count = row.split("|", 1)
        require(name in names and count.isdigit(), "REVIEW_DATABASE", "Invalid table count response.")
        counts[name] = int(count)
    require(set(counts) == set(names), "REVIEW_DATABASE", "Incomplete source table inventory.")
    return counts


def schema_hash(install, database):
    output = install.compose("exec", "-T", "-e", f"RESTORE_DATABASE={database}",
                             "postgres", "sh", "-eu", "-c",
                             'pg_dump --schema-only --no-owner --no-privileges -U "$POSTGRES_USER" '
                             '-d "$RESTORE_DATABASE"', capture=True)
    require(output, "REVIEW_DATABASE", "Cannot fingerprint the old schema.")
    # pg_dump 17 can emit a fresh psql restrict token on every invocation.
    stable = "\n".join(line for line in output.splitlines()
                       if not line.startswith(("\\restrict ", "\\unrestrict ")))
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


def bucket_names(install):
    """Use the already-running MinIO's credentials in-container; never print them."""
    record = install.identity()["minio"]
    script = ('export MC_CONFIG_DIR=/tmp/.mc; '
              'mc alias set review http://127.0.0.1:9000 "$MINIO_ROOT_USER" '
              '"$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; '
              'mc ready review >/dev/null; mc ls --json review')
    output = run(["docker", "exec", record["id"], "sh", "-eu", "-c", script], capture=True)
    names = []
    for line in output.splitlines():
        item = json.loads(line)
        require(item.get("status") == "success" and item.get("type") == "folder",
                "REVIEW_BUCKET", "Cannot inventory the existing object buckets.")
        names.append(item["key"].rstrip("/"))
    return sorted(names)


def review_snapshot(install, *, overlay_sha256, database, bucket, expected_old_revision):
    require(install.profile == "dev" and install.project == "asa-lab-dev", "REVIEW_IDENTITY",
            "Only the existing local dev review can be transitioned.")
    attest_editor_env(install.env.get("ASA_UPDATE_ENTRY_ORIGIN"),
                      install.env.get("ASA_BLOCKS_PARENT_ORIGIN"),
                      install.env.get("ASA_BLOCKS_RUNTIME_ORIGIN"), install.profile)
    require(install.env["ASA_UPDATE_ENTRY_ORIGIN"] == "http://127.0.0.1:4610",
            "REVIEW_ORIGIN", "The owner entry must remain on the known local origin.")
    require(overlay_sha256 == APPROVED_OVERLAY_SHA256
            and expected_old_revision == APPROVED_OLD_REVISION
            and file_hash(install.root / REVIEW_FILE) == overlay_sha256, "REVIEW_OVERLAY",
            "The private overlay differs from the approved exact bytes.")
    validate_names(install.env["POSTGRES_DB"], install.env["ASA_OBJECT_STORAGE_BUCKET"],
                   database, bucket)
    records = install.identity()
    require(set(records) == set(OLD_SERVICES) and all(item["running"] for item in records.values()),
            "REVIEW_IDENTITY", "Exactly the six known ASA services must be running.")
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    for service, destination, name in (("postgres", "/var/lib/postgresql/data", "asa-lab-dev_postgres-data"),
                                       ("minio", "/data", "asa-lab-dev_blocks-object-data"),
                                       ("api", "/var/lib/asa-application-logs", "asa-lab-dev_application-logs")):
        mounted = [mount for mount in records[service]["mounts"]
                   if mount.get("Destination") == destination]
        require(len(mounted) == 1 and mounted[0].get("Type") == "volume"
                and mounted[0].get("Name") == name, "REVIEW_VOLUME",
                f"The {service} volume differs from the known canonical storage.")
    api_env = install.container_environment(records["api"])
    postgres_env = install.container_environment(records["postgres"])
    minio_env = install.container_environment(records["minio"])
    for key in ("APP_DATABASE_URL", "ASA_OBJECT_STORAGE_BUCKET", *PRESERVED_API_KEYS):
        resolved = config["services"]["api"]["environment"].get(key)
        require(resolved is not None and api_env.get(key) == resolved
                and (key not in install.env or resolved == install.env[key]), "REVIEW_ENV",
                f"Running API {key} differs from the resolved old configuration.")
    require(postgres_env.get("POSTGRES_DB") == install.env["POSTGRES_DB"]
            and postgres_env.get("POSTGRES_USER") == install.env["POSTGRES_USER"]
            and postgres_env.get("POSTGRES_PASSWORD") == install.env["POSTGRES_PASSWORD"]
            and minio_env.get("MINIO_ROOT_USER") == install.env["ASA_OBJECT_STORAGE_ACCESS_KEY"]
            and minio_env.get("MINIO_ROOT_PASSWORD") == install.env["ASA_OBJECT_STORAGE_SECRET_KEY"],
            "REVIEW_ENV", "Running database or object-store credentials/namespace differ.")
    for service, key in (("scratch", "ASA_BLOCKS_PARENT_ORIGIN"),
                         ("web", "ASA_BLOCKS_RUNTIME_ORIGIN"), ("search", "ASA_SEARCH_SECRET")):
        resolved = config["services"][service]["environment"].get(key)
        require(resolved is not None
                and install.container_environment(records[service]).get(key) == resolved
                and (key not in install.env or resolved == install.env[key]), "REVIEW_ENV",
                f"Running {service} {key} differs from the resolved old configuration.")
    require(set(config["services"]) == {"postgres", "migration", "minio", "minio-init",
                                         "api", "web", "scratch", "search"},
            "REVIEW_SERVICES", "The old review Compose service set differs.")
    require(config["services"]["api"]["image"] == config["services"]["web"]["image"]
            == APPROVED_REVIEW_IMAGE
            and config["services"]["postgres"]["image"] == "postgres:17.7-bookworm",
            "REVIEW_IMAGE", "The old review images or PostgreSQL engine differ.")
    require(config["services"]["api"].get("entrypoint") ==
            ["/bin/sh", "/workspace/.asa/local-review/api-watch.sh"]
            and config["services"]["web"].get("entrypoint") ==
            ["node", "/workspace/node_modules/vite/bin/vite.js", "--config",
             "/workspace/.asa/local-review/vite.config.mts"], "REVIEW_ENTRYPOINT",
            "The old review entrypoints differ from the approved watcher and Vite.")
    for service, target, source in REVIEW_BINDS:
        matches = [mount for mount in config["services"][service].get("volumes", [])
                   if mount.get("target") == target]
        require(len(matches) == 1 and matches[0].get("type") == "bind"
                and matches[0].get("read_only") is True
                and Path(matches[0].get("source", "")).resolve() == (install.root / source).resolve(),
                "REVIEW_MOUNT", "Review source mount differs from the exact read-only contract.")
    expected_ports = {"web": ("4610", "8080"), "api": ("4611", "4611"),
                      "scratch": ("4613", "8080")}
    for service, (published, target) in expected_ports.items():
        ports = config["services"][service].get("ports", [])
        require(len(ports) == 1 and str(ports[0].get("published")) == published
                and str(ports[0].get("target")) == target
                and ports[0].get("host_ip") == "127.0.0.1",
                "REVIEW_PORTS", f"{service} does not use its known loopback port.")
    selected_ids = {record["id"] for record in records.values()}
    data_volumes = {mount["Name"] for service in ("postgres", "minio", "api")
                    for mount in records[service]["mounts"] if mount["Type"] == "volume"}
    for record in install.containers():
        if record["id"] not in selected_ids:
            require(not any(mount["Type"] == "volume" and mount.get("Name") in data_volumes
                            for mount in record["mounts"]), "REVIEW_VOLUME",
                    "Another container mounts an ASA data/log volume.")
    runtime = install.readiness()
    require(runtime["revision"] == expected_old_revision, "REVIEW_REVISION",
            "The running old revision differs from the approved review baseline.")
    names, buckets = database_names(install), bucket_names(install)
    require(database not in names and bucket not in buckets
            and install.env["POSTGRES_DB"] in names and install.env["ASA_OBJECT_STORAGE_BUCKET"] in buckets,
            "REVIEW_NAMESPACE", "The old namespace is absent or a new namespace already exists.")
    wip = wip_snapshot(install.root)
    require(wip["branch"] and wip["files"], "REVIEW_WIP",
            "The source-mounted review checkout has unexpected Git state.")
    sources = {relative: tree_fingerprint(install.root, relative)
               for relative in SOURCE_TREES if relative != ".asa/local-review"}
    source_metadata = {name: file_hash(install.root / ".asa/local-review" / name)
                       for name in ("api-watch.sh", "vite.config.mts", "compose.review.yaml")}
    selected = {service: {"id": item["id"], "image": item["image"],
                          "imageId": run(["docker", "inspect", "--format", "{{.Image}}", item["id"]], capture=True),
                          "mounts": item["mounts"],
                          "envSha256": digest(install.container_environment(item))}
                for service, item in records.items()}
    return {"root": str(install.root), "project": install.project,
            "files": install.files, "overlaySha256": overlay_sha256,
            "envSha256": file_hash(install.root / ".env"), "old": runtime,
            "oldDatabase": install.env["POSTGRES_DB"], "oldBucket": install.env["ASA_OBJECT_STORAGE_BUCKET"],
            "databaseNames": names, "bucketNames": buckets,
            "oldTableCounts": table_counts(install, install.env["POSTGRES_DB"]),
            "oldSchemaSha256": schema_hash(install, install.env["POSTGRES_DB"]),
            "newDatabase": database, "newBucket": bucket,
            "wip": wip, "sourceTrees": sources, "sourceMetadata": source_metadata,
            "containers": selected}


def pinned_release():
    """Extract only the approved immutable published deployment artifact."""
    reference = f"{REGISTRY}/deployment@{APPROVED_RELEASE_DIGEST}"
    run(["docker", "pull", reference])
    container = run(["docker", "create", "--network", "none", reference, "/not-executed"], capture=True)
    try:
        with tempfile.TemporaryDirectory(prefix="asa-review-release-") as folder:
            file = Path(folder) / "release.json"
            run(["docker", "cp", f"{container}:/release.json", str(file)], capture=True)
            require(file.stat().st_size < 65536, "REVIEW_RELEASE", "Oversized release manifest.")
            release = validate_release(json.loads(file.read_text(encoding="utf-8")))
            require(release["revision"] == APPROVED_RELEASE_REVISION,
                    "REVIEW_RELEASE", "Pinned release artifact is not the approved revision.")
            return release
    finally:
        run(["docker", "rm", container], capture=True)


def selected_release(install, revision):
    require(revision == APPROVED_RELEASE_REVISION, "REVIEW_RELEASE",
            "This one-time transition requires the approved exact release SHA.")
    release = pinned_release()
    require(release["revision"] == revision, "REVIEW_RELEASE",
            "Stable moved; the explicitly selected release was not returned.")
    assert_ci(release)
    install.git("fetch", "origin", "main:refs/remotes/origin/main")
    install.git("merge-base", "--is-ancestor", revision, "origin/main")
    require(install.git("remote", "get-url", "origin").removesuffix(".git") in
            ("https://github.com/spikeal8-maker/asa-lab", "git@github.com:spikeal8-maker/asa-lab"),
            "REVIEW_REPOSITORY", "The operational checkout has an unexpected origin.")
    return release


def verify_manager_source(reviewed_tool_sha):
    """Pin the executing tool to the operator-attested SHA and exact CI."""
    source = Path(__file__).resolve().parents[2]
    require(not _git(source, "status", "--porcelain"), "REVIEW_TOOL",
            "The transition manager source checkout must be clean.")
    revision = _git(source, "rev-parse", "HEAD")
    require(reviewed_tool_sha == revision, "REVIEW_TOOL",
            "Executing manager source differs from the operator-attested reviewed SHA.")
    require(_git(source, "remote", "get-url", "origin").removesuffix(".git") in
            ("https://github.com/spikeal8-maker/asa-lab", "git@github.com:spikeal8-maker/asa-lab"),
            "REVIEW_TOOL", "Manager source origin is not the approved repository.")
    published = _git(source, "ls-remote", "origin", "refs/heads/codex/local-clean-transition-20261030")
    require(published.split("\t", 1)[0] == revision, "REVIEW_TOOL",
            "The reviewed manager SHA is not the published transition branch head.")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "asa-review-fresh"}
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    base = "https://api.github.com/repos/spikeal8-maker/asa-lab/"
    def read(path):
        try:
            with urlopen(Request(base + path, headers=headers), timeout=30) as response:
                return json.load(response)
        except (OSError, ValueError, KeyError) as exc:
            raise Blocked("REVIEW_TOOL_CI", "Cannot verify reviewed manager source.") from exc
    runs = read(f"actions/runs?head_sha={revision}&per_page=100").get("workflow_runs", [])
    for name, path in (("ASA Lab Governance and Code Gates", ".github/workflows/spec-validation.yml"),
                       ("ASA Review Fresh Transition", ".github/workflows/review-fresh-transition.yml")):
        matching = [item for item in runs if item.get("name") == name
                    and item.get("head_sha") == revision and item.get("path") == path]
        require(matching and sorted(matching, key=lambda item: (item.get("run_number", 0),
                 item.get("run_attempt", 0)))[-1].get("conclusion") == "success",
                "REVIEW_TOOL_CI", f"Required exact-SHA manager check is not green: {name}.")
    return revision


def create_plan(root, *, release_sha, old_revision, overlay_sha256, database, bucket, output):
    install = ReviewInstallation(root)
    require(install.files == ["compose.yaml", "compose.dev.yaml", REVIEW_FILE],
            "REVIEW_FILES", "Unexpected old Compose file set.")
    require(not (install.state / PHASE_FILE).exists() and not (install.state / "maintenance.json").exists(),
            "REVIEW_MAINTENANCE", "An earlier operation needs inspection.")
    target = private_destination(install.root, output)
    snapshot = review_snapshot(install, overlay_sha256=overlay_sha256, database=database,
                               bucket=bucket, expected_old_revision=old_revision)
    release = selected_release(install, release_sha)
    require(release["schema"] > snapshot["old"]["schema"], "REVIEW_SCHEMA",
            "The published release must advance the old schema in a new database.")
    # A fresh namespace must not change the engine or any established host port.
    require(snapshot["containers"]["postgres"]["image"] == "postgres:17.7-bookworm",
            "REVIEW_ENGINE", "PostgreSQL engine change requires a separate operation.")
    plan = {"format": "asa-review-fresh-plan-v1", "snapshot": snapshot, "release": release,
            "createdUtc": dt.datetime.now(dt.timezone.utc).isoformat()}
    plan["sha256"] = digest(plan)
    atomic_json(target, plan)
    print(f"REVIEW_FRESH_PLAN path={target} sha256={plan['sha256']} "
          f"old={old_revision} selected={release_sha} new_database={database} new_bucket={bucket}")
    return plan


def _copy_tree_exact(source, destination):
    require(source.is_dir() and not source.is_symlink(), "REVIEW_SOURCE",
            "Source-mounted directory is missing or redirected.")
    for path in source.rglob("*"):
        require(not path.is_symlink(), "REVIEW_SOURCE", "Source-mounted directory contains a redirected path.")
    shutil.copytree(source, destination, symlinks=False)
    return tree_fingerprint(destination.parent, destination.name)


def archive_source_and_wip(install, destination, expected):
    """Preserve the whole tracked tree and every current dirty/untracked input."""
    destination = Path(destination)
    destination.mkdir(mode=0o700)
    before = wip_snapshot(install.root)
    require(before == expected["wip"], "REVIEW_WIP_DRIFT", "Canonical WIP changed after the reviewed plan.")
    source_tar = destination / "tracked-head.tar"
    with source_tar.open("wb") as stream:
        result = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=install.root,
                                stdout=stream, stderr=subprocess.PIPE)
    require(result.returncode == 0 and source_tar.stat().st_size > 0,
            "REVIEW_SOURCE", "Cannot archive the old tracked source tree.")
    with tarfile.open(source_tar) as archive:
        require(len(archive.getmembers()) > 0, "REVIEW_SOURCE", "Tracked source archive is empty.")
    bundle = destination / "repository.bundle"
    run(["git", "bundle", "create", str(bundle), "--all"], cwd=install.root, capture=True)
    run(["git", "bundle", "verify", str(bundle)], cwd=install.root, capture=True)
    dirty = destination / "dirty"
    dirty.mkdir()
    for relative, item in before["files"].items():
        source = install.root / relative
        target = dirty / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        require(file_hash(target) == item["sha256"], "REVIEW_WIP_DRIFT",
                "A dirty file changed during preservation.")
    tracked = [name for name, item in before["files"].items() if item["status"] != "??"]
    patch = _git(install.root, "diff", "--binary", "--no-ext-diff", "--", *tracked, binary=True)
    (destination / "tracked-wip.patch").write_bytes(patch)
    mounts = destination / "mounted-source"
    for relative in SOURCE_TREES:
        target = mounts / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        fingerprint = _copy_tree_exact(install.root / relative, target)
        if relative in expected["sourceTrees"]:
            require(fingerprint == expected["sourceTrees"][relative],
                    "REVIEW_SOURCE_DRIFT", "Mounted source changed during preservation.")
    require(wip_snapshot(install.root) == before, "REVIEW_WIP_DRIFT",
            "Canonical WIP changed during source preservation.")
    archive_manifest = {"format": "asa-review-source-v1", "head": before["head"],
                        "branch": before["branch"], "wip": before,
                        "files": {path.relative_to(destination).as_posix(): file_hash(path)
                                  for path in destination.rglob("*") if path.is_file()}}
    atomic_json(destination / "manifest.json", archive_manifest)
    verify_source_archive(destination)
    return archive_manifest


def verify_source_archive(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("format") == "asa-review-source-v1" and manifest.get("files"),
            "REVIEW_SOURCE", "Incomplete old source archive.")
    for relative, checksum in manifest["files"].items():
        path = directory / relative
        require(path.is_file() and not path.is_symlink() and file_hash(path) == checksum,
                "REVIEW_SOURCE", "Old source archive does not verify.")
    return manifest


def _read_plan(path):
    path = Path(path).resolve()
    plain_paths(path.parent, (path.name,))
    plan = json.loads(path.read_text(encoding="utf-8"))
    require(plan.get("format") == "asa-review-fresh-plan-v1"
            and plan.get("sha256") == digest({key: value for key, value in plan.items() if key != "sha256"}),
            "REVIEW_PLAN", "Private transition plan is incomplete or changed.")
    return plan


def _journal(install, value):
    atomic_json(install.state / PHASE_FILE,
                {**value, "updatedUtc": dt.datetime.now(dt.timezone.utc).isoformat()})


def _source_archive_record(directory):
    verify_source_archive(directory)
    return {"path": str(directory), "manifestSha256": file_hash(directory / "manifest.json")}


def archive_old_runtime(records, directory):
    """Keep exact old container writable files and images outside the live root."""
    directory = Path(directory)
    directory.mkdir(mode=0o700)
    entries = {}
    for service in OLD_SERVICES:
        target = directory / (service + ".container.tar")
        with target.open("wb") as stream:
            run(["docker", "export", records[service]["id"]], output=stream)
        require(target.stat().st_size > 0, "REVIEW_RUNTIME", "Old container archive is empty.")
        entries[target.name] = file_hash(target)
    images = sorted({record["imageId"] for record in records.values()})
    image_target = directory / "old-images.tar"
    with image_target.open("wb") as stream:
        run(["docker", "image", "save", *images], output=stream)
    require(image_target.stat().st_size > 0, "REVIEW_RUNTIME", "Old image archive is empty.")
    entries[image_target.name] = file_hash(image_target)
    atomic_json(directory / "manifest.json", {"format": "asa-old-runtime-v1", "files": entries,
                                          "images": images})
    for name, checksum in entries.items():
        require(file_hash(directory / name) == checksum, "REVIEW_RUNTIME",
                "Old runtime archive verification failed.")
    return {"path": str(directory), "manifestSha256": file_hash(directory / "manifest.json")}


def _database_absent(install, database):
    require(database not in database_names(install), "REVIEW_DATABASE",
            "The selected fresh database now exists; no existing database is reused.")


def attest_blank_database(install, database):
    require(not table_counts(install, database), "REVIEW_DATABASE",
            "The newly created database is not blank.")


def _preserve_untracked_and_stash(install, source_directory, expected):
    require(wip_snapshot(install.root) == expected, "REVIEW_WIP_DRIFT",
            "Canonical WIP changed after full backup; old sources remain available.")
    tracked = [name for name, value in expected["files"].items() if value["status"] != "??"]
    untracked = [name for name, value in expected["files"].items() if value["status"] == "??"]
    stash = None
    if tracked:
        install.git("stash", "push", "-m", "review-fresh-preserved-" + expected["head"][:12],
                    "--", *tracked)
        stash = install.git("rev-parse", "stash@{0}")
        require(re.fullmatch(r"[0-9a-f]{40}", stash), "REVIEW_WIP", "Tracked stash was not recorded.")
    moved = {}
    for relative in untracked:
        source = install.root / relative
        target = source_directory / "untracked-moved" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        require(source.is_file() and not target.exists()
                and file_hash(source) == expected["files"][relative]["sha256"],
                "REVIEW_WIP_DRIFT", "An untracked file changed before preservation move.")
        shutil.move(str(source), str(target))
        require(file_hash(target) == expected["files"][relative]["sha256"],
                "REVIEW_WIP", "An untracked preserved file differs after move.")
        moved[relative] = str(target)
    require(not install.git("status", "--porcelain"), "REVIEW_WIP",
            "Operational checkout is still dirty; source switching is forbidden.")
    return {"stash": stash, "untrackedMoved": moved}


def _old_object_fingerprint(directory, bucket):
    root = Path(directory) / "objects" / bucket
    require(root.is_dir(), "REVIEW_OBJECTS", "Old bucket is absent from the full object export.")
    return tree_fingerprint(root.parent, root.name)


def _verify_old_objects_preserved(target, old_bucket, fingerprint):
    records = target.identity()
    minio = records["minio"]
    from tempfile import TemporaryDirectory
    with TemporaryDirectory(prefix="asa-old-objects-") as folder:
        destination = Path(folder) / old_bucket
        run(["docker", "cp", f"{minio['id']}:/data/{old_bucket}", str(destination)], capture=True)
        require(tree_fingerprint(destination.parent, destination.name) == fingerprint,
                "REVIEW_OBJECTS", "Old bucket bytes changed during transition.")


def _verify_old_database_preserved(target, old, counts, names, old_schema_sha256):
    current = database_names(target)
    require(set(names).issubset(current), "REVIEW_DATABASE",
            "A pre-existing database disappeared during transition.")
    require(table_counts(target, old) == counts, "REVIEW_DATABASE",
            "Old database table counts changed during transition.")
    require(schema_hash(target, old) == old_schema_sha256, "REVIEW_DATABASE",
            "Old database schema changed during transition.")


def _ensure_new_bucket_absent(install, bucket):
    require(bucket not in bucket_names(install), "REVIEW_BUCKET",
            "The selected fresh bucket now exists; no existing bucket is reused.")


def apply_plan(root, *, plan_path, output, reviewed_tool_sha):
    """Apply exactly one reviewed plan; any interrupted phase needs manual audit."""
    plan = _read_plan(plan_path)
    manager_sha = verify_manager_source(reviewed_tool_sha)
    old = ReviewInstallation(root)
    output = private_destination(old.root, output)
    require(Path(plan_path).resolve() != output, "REVIEW_OUTPUT", "Plan and backup paths must differ.")
    with operation_lock(old.root):
        require(not (old.state / PHASE_FILE).exists() and not (old.state / "maintenance.json").exists(),
                "REVIEW_MAINTENANCE", "An earlier transition or backup needs inspection.")
        expected = plan["snapshot"]
        require(str(old.root) == expected["root"], "REVIEW_ROOT", "Plan belongs to another installation.")
        current = review_snapshot(old, overlay_sha256=expected["overlaySha256"],
                                  database=expected["newDatabase"], bucket=expected["newBucket"],
                                  expected_old_revision=expected["old"]["revision"])
        require(current == expected, "REVIEW_DRIFT", "Old installation changed after the locked plan.")
        old_resolved = json.loads(old.compose("config", "--format", "json", capture=True))
        release = selected_release(old, plan["release"]["revision"])
        require(release == plan["release"], "REVIEW_RELEASE", "Published release manifest changed.")
        # Pull immutable application images before interrupting any old writer.
        fetch_images(release)
        output.mkdir(mode=0o700)
        private_destination(old.root, output / ".acl-attestation")
        journal = {"format": "asa-review-fresh-operation-v1", "planSha256": plan["sha256"],
                   "managerRevision": manager_sha, "operatorAttestedReviewedSha": reviewed_tool_sha,
                   "independentReviewOperatorAttested": True,
                   "old": expected["old"], "selected": release, "output": str(output),
                   "phase": "preserving_source", "automaticDatabaseRestore": False}
        _journal(old, journal)
        source_directory = output / "old-source"
        source_mutated = False
        try:
            archive_source_and_wip(old, source_directory, expected)
            journal["source"] = _source_archive_record(source_directory)
            journal["phase"] = "backing_up_old_data"
            _journal(old, journal)
            backup = export_backup(old, output / "full-old-data",
                                   readonly_bind_allowlist=REVIEW_BINDS,
                                   live_files=True, hold_writers=True)
            verify_backup(backup)
            journal["backup"] = str(backup)
            journal["backupManifestSha256"] = file_hash(backup / "manifest.json")
            journal["oldObjectFingerprint"] = _old_object_fingerprint(backup, expected["oldBucket"])
            journal["runtimeArchive"] = archive_old_runtime(expected["containers"], output / "old-runtime")
            journal["phase"] = "old_backup_verified_writers_paused"
            _journal(old, journal)
            require(wip_snapshot(old.root) == expected["wip"], "REVIEW_WIP_DRIFT",
                    "WIP changed while the old data backup was made.")
            require(table_counts(old, expected["oldDatabase"]) == expected["oldTableCounts"],
                    "REVIEW_DATABASE", "Old database changed between plan and writer pause.")
            require(schema_hash(old, expected["oldDatabase"]) == expected["oldSchemaSha256"],
                    "REVIEW_DATABASE", "Old schema changed between plan and writer pause.")
            _database_absent(old, expected["newDatabase"])
            # MinIO is resumed alone to serve the official new-bucket initializer.
            old.compose("start", "minio")
            _ensure_new_bucket_absent(old, expected["newBucket"])
            old.compose("stop", "search")
            journal["phase"] = "switching_source"
            _journal(old, journal)
            source_mutated = True
            journal["wipPreservation"] = _preserve_untracked_and_stash(old, source_directory, expected["wip"])
            _journal(old, journal)
            old.git("switch", "--detach", release["revision"])
            require(old.git("rev-parse", expected["wip"]["branch"]) == expected["wip"]["head"],
                    "REVIEW_GIT", "The old source branch ref changed during detach.")
            raw_env = (old.root / ".env").read_bytes()
            require(hashlib.sha256(raw_env).hexdigest() == expected["envSha256"],
                    "REVIEW_ENV", "Private configuration changed after full backup.")
            replacement = replacement_env(raw_env, old.env, expected["newDatabase"], expected["newBucket"])
            atomic_bytes(old.root / ".env", replacement, mode=0o600)
            journal["phase"] = "new_namespace_pending"
            _journal(old, journal)
            target = Installation(old.root, "dev")
            require(target.files == ["compose.yaml", "compose.dev.yaml"]
                    and target.project == expected["project"], "REVIEW_IDENTITY",
                    "The target must use only the ordinary dev Compose files in the same project.")
            apply_release_environment(target, release)
            resolved = validate_resolved_images(target, release)
            for key in PRESERVED_API_KEYS:
                require(resolved["services"]["api"]["environment"].get(key)
                        == old_resolved["services"]["api"]["environment"].get(key),
                        "REVIEW_ENV", f"Target API {key} differs from the preserved private configuration.")
            require(resolved["services"]["scratch"]["environment"].get("ASA_BLOCKS_PARENT_ORIGIN")
                    == old_resolved["services"]["scratch"]["environment"].get("ASA_BLOCKS_PARENT_ORIGIN")
                    and resolved["services"]["web"]["environment"].get("ASA_BLOCKS_RUNTIME_ORIGIN")
                    == old_resolved["services"]["web"]["environment"].get("ASA_BLOCKS_RUNTIME_ORIGIN")
                    and resolved["services"]["search"]["environment"].get("ASA_SEARCH_SECRET")
                    == old_resolved["services"]["search"]["environment"].get("ASA_SEARCH_SECRET")
                    and resolved["services"]["postgres"]["environment"].get("POSTGRES_PASSWORD")
                    == old_resolved["services"]["postgres"]["environment"].get("POSTGRES_PASSWORD")
                    and resolved["services"]["minio"]["environment"].get("MINIO_ROOT_PASSWORD")
                    == old_resolved["services"]["minio"]["environment"].get("MINIO_ROOT_PASSWORD"), "REVIEW_ENV",
                    "Target editor/database/object-store values differ from preserved configuration.")
            # The old PostgreSQL container is still attached to the same volume.
            _database_absent(old, expected["newDatabase"])
            db_command(old, 'createdb -U "$POSTGRES_USER" "$RESTORE_DATABASE"',
                       database=expected["newDatabase"])
            attest_blank_database(old, expected["newDatabase"])
            journal["phase"] = "new_database_created"
            _journal(old, journal)
            target.compose("run", "--rm", "--no-deps", "minio-init")
            require(expected["newBucket"] in bucket_names(old), "REVIEW_BUCKET",
                    "Official MinIO initialization did not create the fresh bucket.")
            journal["phase"] = "new_bucket_created"
            _journal(old, journal)
            # Recreate PostgreSQL too: its old three-file label must become the
            # ordinary two-file label while retaining its exact named volume.
            target.compose("up", "-d", "--no-build", "--force-recreate")
            journal["phase"] = "verifying_new_release"
            _journal(old, journal)
            target.wait_ready(release["revision"], release["schema"])
            target.identity()
            _verify_old_database_preserved(target, expected["oldDatabase"],
                                           expected["oldTableCounts"], expected["databaseNames"],
                                           expected["oldSchemaSha256"])
            _verify_old_objects_preserved(target, expected["oldBucket"],
                                          journal["oldObjectFingerprint"])
            verify_embedded_entry_http(target.env["ASA_UPDATE_ENTRY_ORIGIN"], release["revision"])
            atomic_json(target.state / "installed-release.json", release)
            journal["phase"] = "complete"
            journal["userFlow"] = "not_run"
            _journal(target, journal)
            target.receipt({"status": "success", "oldDatabasePreserved": True,
                            "oldBucketPreserved": True, "newDatabase": expected["newDatabase"],
                            "newBucket": expected["newBucket"], "backup": str(backup),
                            "selected": release, "userFlow": "not_run"})
            print(f"REVIEW_FRESH_UPDATED revision={release['revision']} schema={release['schema']} "
                  f"backup={backup} old_database_preserved=true old_bucket_preserved=true "
                  "user_flow=not_run")
        except BaseException:
            journal["failedPhase"] = journal["phase"]
            journal["phase"] = "failed"
            if not source_mutated and journal.get("backup"):
                # No namespace/source mutation occurred. Exact old containers
                # can be restarted without a Compose up or any database restore.
                try:
                    old.compose("start", "minio", "scratch", "api", "web", "search")
                    old.wait_ready(expected["old"]["revision"], expected["old"]["schema"])
                    journal["oldServicesResumed"] = True
                except BaseException:
                    journal["oldServicesResumed"] = False
            _journal(old, journal)
            # Never restore a database or restart mixed-source writers here.
            raise


def operation_status(root):
    path = Path(root).resolve() / ".asa" / PHASE_FILE
    if not path.exists():
        print("REVIEW_FRESH_STATUS none")
        return
    operation = json.loads(path.read_text(encoding="utf-8"))
    print(f"REVIEW_FRESH_STATUS phase={operation.get('phase')} "
          f"failed_phase={operation.get('failedPhase', 'none')} "
          f"selected={operation.get('selected', {}).get('revision', 'unknown')}")
