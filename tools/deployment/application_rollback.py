"""One declared P0 application return, retaining the live database and objects.

This is deliberately not a schema-based downgrade facility. The normal manager
forward ancestry checks remain independent. A return needs the last operation's
durable capsule, the exact previous release, and every recorded data identity.
"""

import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

from . import releases
from .contracts import (REGISTRY, REPOSITORY, Blocked, require, validate_release,
                        verify_backup, verify_embedded_entry_http)
from .paths import atomic_json, plain_paths
from .system import Installation, run


PREVIOUS = "98d7fbb42ae9e53113cb45ada4b4301334de9c27"
PRODUCT = "d0bf7cbeb129ff991272f006fc379ee004cb00f8"
BASELINE = "76d0610285831a99b7801478e03418ff5800bf73"
POLICY = "asa-p0-98d7-d0bf-application-return-v1"
SCHEMA = 304
JOURNAL = "application-rollback.json"
FORMAT = "asa-application-rollback-v1"
MAX_BACKUP_AGE = 6 * 60 * 60
TOOL_PATHS = ("tools/asa_manager.py", "tools/deployment")
QUALIFIED_CHANGES = frozenset((
    "tools/asa_manager.py", "tools/deployment/application_rollback.py",
    "tools/deployment/test_application_rollback.py",
    "tools/deployment/ci_application_rollback.py",
    ".github/workflows/application-rollback.yml",
    "docs/deployment/PORTABLE_OPERATIONS.md",
    "docs/deployment/APPLICATION_ROLLBACK.md",
))
BASELINE_DOCS = frozenset((
    "docs/execution/current.yaml",
    "docs/product/electronics/tasks/TASK-ELECTRONICS-ROBOTICS-PORTAL-001.md",
    "docs/product/robotics/PORTAL_INTEGRATION_PLAN.md",
))
MINIO_BINARIES = {
    "/usr/local/bin/minio": "fa42dfb43019e71731c10d70cc24057f6af63f22d76c4722614056514739fc97",
    "/usr/local/bin/mc": "9a9e7d32c175f2804d6880d5ad3623097ea439f0e0304aa6039874d0f0c493d8",
}
PREVIOUS_IMAGES = dict(zip(("api", "web", "scratch", "minio", "search"), (
    "1ef02b3f8ac91c1c20cfdf9d6c5668b5effc74b37d19e4bc46c552785e4265cf",
    "7fe353e9bb47e2448edb33265fd8c177bac821cfb57e73012d40930341a27ead",
    "b6fa92367e1090a891beeee61dca77d2cd8655723a7e36c2d2f3b30aa2888ef4",
    "b92bfffe5a40c7fe3b7a119d040ad70b172f76d8b93b97b3834c7d4318953207",
    "51eb776ba19249dda0c3218856a170ee511d6d113e383c2c85ecfeabbd8e7c90",
)))
PRODUCT_IMAGES = dict(zip(("api", "web", "scratch", "minio", "search"), (
    "df26ba32fc663c9800150d0961e2feca04022793f878eb3d8cbe5cf5f6eb5032",
    "f9c0e1351a1478c1f5bc512f23d04112bd3fc0bda4f1f8e539414ee3d59232a0",
    "89f5b7abb7861ba02aa3d5719e593c85988a82c0f12f6e3705fe46d29216cdb5",
    "321c9235305a9d9797e3891033f5739b556459fc4d9df8c7de612cd7cef5270a",
    "c595272a5b6e3f55f8800e5bbc5e6c079101bf23f2e126e50ed4650291c7a9b1",
)))
PHASES = frozenset(("prepared", "forward_stop", "forward_support", "forward_api",
                    "forward_web", "forward_verify", "forward_accepted",
                    "rollback_stop", "rollback_source", "rollback_support",
                    "rollback_api", "rollback_web", "rollback_verify", "rolled_back"))
TERMINAL = ("forward_accepted", "rolled_back")
SHA = re.compile(r"[a-f0-9]{64}")
WRITE_RIGHTS = 0x500D0156  # GenericAll/Write, data/EA/attributes, delete, DACL/owner.
WINDOWS_ACL_QUERY = r"""
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$sidType = [System.Security.Principal.SecurityIdentifier]
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rows = @(foreach ($path in (ConvertFrom-Json $env:ASA_RETURN_ACL_PATHS)) {
  $acl = Get-Acl -LiteralPath $path
  $rules = @($acl.GetAccessRules($true, $true, $sidType) | ForEach-Object {
    @{ sid=$_.IdentityReference.Value; kind=$_.AccessControlType.ToString(); rights=[long]$_.FileSystemRights;
       inheritOnly=(($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) }
  })
  @{ path=$path; owner=$acl.GetOwner($sidType).Value; rules=$rules }
})
@{ current=$current; rows=$rows } | ConvertTo-Json -Depth 6 -Compress
"""


def validate_windows_acls(payload, paths):
    """Effective inherited/explicit allow ACEs; never localized account names."""
    require(isinstance(payload, dict) and isinstance(payload.get("current"), str)
            and re.fullmatch(r"S-1-[0-9-]+", payload["current"])
            and isinstance(payload.get("rows"), list) and len(payload["rows"]) == len(paths),
            "ROLLBACK_STATE_ACL", "Cannot attest Windows state ownership and DACLs.")
    trusted = {payload["current"], "S-1-5-18", "S-1-5-32-544"}
    for record, (path, private) in zip(payload["rows"], paths):
        require(isinstance(record, dict) and record.get("path") == str(path) and record.get("owner") in trusted
                and isinstance(record.get("rules"), list) and 0 < len(record["rules"]) <= 512,
                "ROLLBACK_STATE_ACL", "Windows state owner or access rules are untrusted.")
        for rule in record["rules"]:
            require(isinstance(rule, dict) and rule.get("kind") in ("Allow", "Deny")
                    and isinstance(rule.get("sid"), str) and type(rule.get("rights")) is int
                    and type(rule.get("inheritOnly")) is bool,
                    "ROLLBACK_STATE_ACL", "Unknown Windows access rule; refusing the operation.")
            if rule["kind"] == "Deny" or rule["sid"] in trusted or (rule["sid"] == "S-1-3-0" and rule["inheritOnly"]):
                continue
            rights = rule["rights"] & 0xFFFFFFFF
            require(not (rights & (0xFFEFFFFF if private else WRITE_RIGHTS)), "ROLLBACK_STATE_ACL",
                    "Canonical inputs permit foreign writes or private return state permits foreign access.",
                    "Have the operator prepare the existing source directory for trusted writes and .asa for private access; no ACL is changed automatically.")


def attest_access(paths):
    paths = [(Path(path), private) for path, private in paths]
    for path, private in paths:
        plain_paths(path.parent, (path.name,))
    paths = [(path, private) for path, private in paths if path.exists()]
    if os.name == "nt":
        payload = json.loads(run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL_QUERY],
                                 env={**os.environ, "ASA_RETURN_ACL_PATHS": json.dumps([str(path) for path, private in paths])}, capture=True))
        validate_windows_acls(payload, paths)
        return
    trusted = {os.getuid(), 0}
    if os.geteuid() == 0 and os.environ.get("SUDO_USER"):
        import pwd
        trusted.add(pwd.getpwnam(os.environ["SUDO_USER"]).pw_uid)
    for path, private in paths:
        metadata = path.stat()
        require(metadata.st_uid in trusted and not metadata.st_mode & (0o077 if private else 0o022),
                "ROLLBACK_STATE_PERMISSIONS", "Canonical inputs or private return state have unsafe owner/mode.",
                "The operator must own or trust the source owner; protect .asa with 0700 and capsules with 0600. No chmod/chown is automatic.")


def attest_private_state(install):
    names = ("operation.lock", "installed-release.json", "installation.json", "last-operation.json",
             "maintenance.json", "failed-switch.json", "release-selection.json", "runtime-configuration.json")
    attest_access([(install.root, False), (install.root / ".git", False), (install.root / ".env", False),
                   *((install.root / name, False) for name in install.files), (install.state, True),
                   (install.state / JOURNAL, True), (install.state / "application-rollback-history", True),
                   *((install.state / name, False) for name in (*names, *(name + ".tmp" for name in names)))])


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def file_digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _read(path, *, optional=False):
    path = Path(path)
    plain_paths(path.parent, (path.name,))
    if optional and not path.exists():
        return None
    require(path.is_file() and path.stat().st_size <= 256 * 1024,
            "ROLLBACK_RECORD", "Missing or oversized application return record.")
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), "ROLLBACK_RECORD", "Malformed application return record.")
    return value


def _sync(path):
    # Atomic replacement + file fsync on both hosts; directory fsync on POSIX.
    # Windows process interruption is tested separately from power loss.
    if os.name != "nt":
        descriptor = os.open(Path(path), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _write(path, value):
    plain_paths(Path(path).parent, (Path(path).name,))
    atomic_json(path, value)
    _sync(Path(path).parent)


def _git(root, *args):
    return run(["git", *args], cwd=root, capture=True)


def _clean(root):
    require(Path(_git(root, "rev-parse", "--show-toplevel")).resolve() == Path(root).resolve(),
            "ROLLBACK_GIT_ROOT", "The named installation/tools directory must itself be the Git checkout root.")
    require(not _git(root, "status", "--porcelain"), "ROLLBACK_DIRTY",
            "The installation or approved tools checkout contains local changes.")
    require(_git(root, "remote", "get-url", "origin").removesuffix(".git") in
            (f"https://github.com/{REPOSITORY}", f"git@github.com:{REPOSITORY}"),
            "ROLLBACK_ORIGIN", "Application return requires the canonical repository.")


def _pinned_images(release, expected):
    require(release["images"] == {name: f"{REGISTRY}/{name}@sha256:{sha}"
                                  for name, sha in expected.items()},
            "ROLLBACK_PAIR", "The declared release has different immutable images.")


def validate_pair(install, previous, selected):
    """The declaration is a reviewed release pair, never an arbitrary older SHA."""
    validate_release(previous)
    validate_release(selected)
    require(previous["revision"] == PREVIOUS and previous["schema"] == selected["schema"] == SCHEMA
            and set(previous["images"]) == set(selected["images"]) == set(PREVIOUS_IMAGES),
            "ROLLBACK_PAIR", "Only the declared P0 release pair with schema 304 is supported.")
    _pinned_images(previous, PREVIOUS_IMAGES)
    target = selected["revision"]
    if target == PRODUCT:
        _pinned_images(selected, PRODUCT_IMAGES)
    else:
        install.git("merge-base", "--is-ancestor", BASELINE, target)
        changed = set(install.git("diff", "--name-only", PRODUCT, target).splitlines())
        require(changed <= QUALIFIED_CHANGES | BASELINE_DOCS, "ROLLBACK_PRODUCT",
                "The release changes product, dependencies or unqualified delivery inputs.")
        require(not install.git("diff", "--name-only", BASELINE, target, "--", *sorted(BASELINE_DOCS)),
                "ROLLBACK_PRODUCT", "The qualified documentation baseline changed.")
    install.git("merge-base", "--is-ancestor", PREVIOUS, target)
    install.git("merge-base", "--is-ancestor", target, "origin/main")
    sources = {}
    for path in ("migrations", "tools/migrate.mjs", "infra/minio/Dockerfile",
                 "compose.yaml", *(name for name in install.files if name != "compose.yaml"
                                    and install.git("ls-files", "--", name))):
        old = install.git("rev-parse", f"{PREVIOUS}:{path}")
        new = install.git("rev-parse", f"{target}:{path}")
        require(old == new, "ROLLBACK_DATA_FORMAT", "Migration, object runtime or Compose source changed.")
        sources[path] = old
    return sources


def tool_identity(install):
    root = Path(__file__).resolve().parents[2]
    require(not root.is_relative_to(install.root) and not install.root.is_relative_to(root),
            "ROLLBACK_EXTERNAL_TOOLS", "Run the approved pinned tools from a separate checkout with --root.")
    plain_paths(root, TOOL_PATHS)
    attest_access([(root, False), (root / ".git", False), *((root / name, False) for name in TOOL_PATHS)])
    _clean(root)
    revision = _git(root, "rev-parse", "HEAD")
    _git(root, "merge-base", "--is-ancestor", revision, "origin/main")
    listing = _git(root, "ls-tree", "--full-tree", "-r", revision, "--", *TOOL_PATHS)
    tracked = {}
    for line in listing.splitlines():
        metadata, separator, name = line.partition("\t")
        fields = metadata.split()
        require(separator and len(fields) == 3 and fields[0] in ("100644", "100755")
                and fields[1] == "blob" and re.fullmatch(r"[a-f0-9]{40}", fields[2])
                and name not in tracked and (name == "tools/asa_manager.py" or name.startswith("tools/deployment/")),
                "ROLLBACK_TOOLING", "Incomplete or redirected tracked tools tree.")
        plain_paths(root, (name,))
        data = (root / name).read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        require(actual == fields[2], "ROLLBACK_TOOLING", "Actual shipped tooling bytes differ from their pinned Git blobs.")
        tracked[name] = fields[2]
    require({"tools/asa_manager.py", *(f"tools/deployment/{name}.py" for name in
            ("application_rollback", "contracts", "system", "paths", "releases", "backup", "collector"))} <= tracked.keys(),
            "ROLLBACK_TOOLING", "The external checkout does not contain the complete tracked manager tooling.")
    return {"root": str(root), "revision": revision,
            "treeSha256": digest(tracked),
            "host": sys.platform, "pythonMajorMinor": list(sys.version_info[:2])}


def _ci_identity(release):
    releases.assert_ci(release)
    publication = releases._ci_get(f"/{release['publicationRunId']}")
    general = releases._latest_general(release["revision"])
    return {"publicationRunId": publication["id"], "publicationAttempt": publication["run_attempt"],
            "generalRunId": general["id"], "generalAttempt": general["run_attempt"],
            "revision": release["revision"]}


def _tool_ci(tool, production, deployment_digest):
    releases.assert_general_ci(tool["revision"])
    general = releases._latest_general(tool["revision"])
    result = {"generalRunId": general["id"], "generalAttempt": general["run_attempt"],
              "revision": tool["revision"], "nativeQualification": "isolated_fixture_only"}
    if production:
        candidates = [item for item in releases._ci_pages(
            f"?head_sha={tool['revision']}&branch=main", "workflow_runs")
            if item.get("path") == ".github/workflows/application-rollback.yml"
            and item.get("head_sha") == tool["revision"] and item.get("head_branch") == "main"
            and item.get("event") == "workflow_dispatch"
            and item.get("display_title") == f"P0 return {deployment_digest}"]
        require(candidates and all(type(item.get("run_number")) is int for item in candidates),
                "ROLLBACK_QUALIFICATION", "The exact tools revision needs completed native P0 return qualification.")
        latest = max(candidates, key=lambda item: item["run_number"])
        releases._successful_jobs(latest, ("contracts (ubuntu-latest)", "contracts (windows-latest)",
                                           "native official images"))
        result["nativeQualification"] = {"runId": latest["id"], "attempt": latest["run_attempt"],
                                         "platform": "linux/amd64", "windowsDocker": "separate_operator_evidence"}
    return result


def image_identity(reference, revision=None):
    record = json.loads(run(["docker", "image", "inspect", "--format",
        '{"id":{{json .Id}},"digests":{{json .RepoDigests}},"os":{{json .Os}},'
        '"architecture":{{json .Architecture}},"labels":{{json .Config.Labels}}}', reference], capture=True))
    require(reference in (record.get("digests") or []) and
            re.fullmatch(r"sha256:[a-f0-9]{64}", record.get("id", "")) and
            record.get("os") == "linux" and record.get("architecture") == "amd64",
            "ROLLBACK_IMAGE", "A pinned Linux amd64 image is absent or its digest identity differs.")
    if revision is not None:
        require((record.get("labels") or {}).get("org.opencontainers.image.revision") == revision,
                "ROLLBACK_IMAGE", "Image provenance differs from the selected source.")
    return record["id"]


def minio_binaries(image_id):
    # Execute only immutable, already inspected official image bytes, without
    # network, credentials, host mounts, application data or privilege.
    output = run(["docker", "run", "--rm", "--network", "none", "--read-only",
                  "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                  "--entrypoint", "sha256sum", image_id, *MINIO_BINARIES], capture=True)
    observed = {}
    for line in output.splitlines():
        fields = line.split()
        require(len(fields) == 2 and SHA.fullmatch(fields[0]) and fields[1] not in observed,
                "ROLLBACK_OBJECT_RUNTIME", "Cannot attest actual MinIO and mc binary bytes.")
        observed[fields[1]] = fields[0]
    require(observed == MINIO_BINARIES, "ROLLBACK_OBJECT_RUNTIME",
            "Actual MinIO or mc bytes differ from the declared compatible runtime.")
    return observed


def _images(previous, selected):
    result = {}
    for side, release in (("previous", previous), ("selected", selected)):
        result[side] = {name: image_identity(reference, None if name == "minio" else release["revision"])
                        for name, reference in release["images"].items()}
    binaries = {side: minio_binaries(images["minio"]) for side, images in result.items()}
    return {"ids": result, "objectBinaries": binaries}


def normalized_config(config, previous, selected):
    result = copy.deepcopy(config)
    for name, service in result["services"].items():
        image_service = "api" if name == "migration" else "minio" if name == "minio-init" else name
        if image_service in previous["images"]:
            require(service.get("image") in (previous["images"][image_service], selected["images"][image_service]),
                    "ROLLBACK_CONFIG", "Compose contains an unqualified image override.")
            service["image"] = "qualified-" + image_service
        arguments = service.get("build", {}).get("args", {})
        if "ASA_BUILD_REVISION" in arguments:
            require(arguments["ASA_BUILD_REVISION"] in (previous["revision"], selected["revision"]),
                    "ROLLBACK_CONFIG", "Compose build provenance changed.")
            arguments["ASA_BUILD_REVISION"] = "qualified-revision"
    return digest(result)


def _history(install):
    query = "SELECT COALESCE(json_agg(x ORDER BY x.version),'[]'::json) FROM (SELECT version,checksum FROM schema_migrations) x"
    output = install.compose("exec", "-T", "-e", "ASA_ROLLBACK_QUERY=" + query, "postgres", "sh", "-eu", "-c",
                             'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$ASA_ROLLBACK_QUERY"', capture=True)
    rows = json.loads(output)
    require(isinstance(rows, list) and 0 < len(rows) <= 10000 and
            all(isinstance(row, dict) and set(row) == {"version", "checksum"}
                and isinstance(row["version"], str) and re.fullmatch(r"[0-9]+", row["version"])
                and isinstance(row["checksum"], str) and SHA.fullmatch(row["checksum"]) for row in rows)
            and len({row["version"] for row in rows}) == len(rows)
            and max(int(row["version"]) for row in rows) == SCHEMA,
            "ROLLBACK_SCHEMA", "Live migration history is not the declared complete P0 schema.")
    return digest(rows)


def _snapshot(install, previous, selected, *, images, partial=False):
    attest_private_state(install)
    _clean(install.root)
    require(install.git("rev-parse", "HEAD") in (previous["revision"], selected["revision"]),
            "ROLLBACK_SOURCE", "Canonical checkout is neither member of this operation's release pair.")
    require(install.settings.get("automaticUpdates") is False and
            isinstance(install.settings.get("instanceId"), str) and bool(install.settings["instanceId"]),
            "ROLLBACK_AUTOMATIC", "Application return requires a configured instance with automatic updates disabled.")
    require(install.env.get("ASA_OBJECT_STORAGE_ENDPOINT") == "http://minio:9000"
            and bool(install.env.get("ASA_SEARCH_SECRET")), "ROLLBACK_CONFIG",
            "Existing local object storage and unchanged configured search secret are required.")
    names = (".env", ".asa/installation.json", *install.files)
    plain_paths(install.root, names)
    require(_read(install.state / "installation.json") == install.settings, "ROLLBACK_CONFIG",
            "Saved installation settings changed after they were loaded.")
    records = install.identity()
    require(records["postgres"]["running"] and (partial or set(records) == {"postgres", *previous["images"]}),
            "ROLLBACK_RUNTIME", "The canonical PostgreSQL or complete previous runtime is unavailable.")
    for name, record in records.items():
        if name == "postgres":
            continue
        sides = [side for side, release in (("previous", previous), ("selected", selected))
                 if record["image"] == release["images"][name]]
        require(sides and (partial or "previous" in sides), "ROLLBACK_RUNTIME",
                "A service is outside the exact operation's previous/selected image set.")
        actual = run(["docker", "inspect", "--format", "{{.Image}}", record["id"]], capture=True)
        require(any(actual == images["ids"][side][name] for side in sides), "ROLLBACK_IMAGE",
                "A service's actual image bytes differ from the pinned operation.")
    config = json.loads(install.compose("config", "--format", "json", capture=True))
    volumes = {}
    for key, item in sorted(config.get("volumes", {}).items()):
        require(isinstance(item.get("name"), str) and item["name"], "ROLLBACK_VOLUME", "A volume lacks canonical identity.")
        observed = json.loads(run(["docker", "volume", "inspect", item["name"]], capture=True))
        require(isinstance(observed, list) and len(observed) == 1 and observed[0].get("Name") == item["name"],
                "ROLLBACK_VOLUME", "A recorded application volume is missing.")
        volumes[key] = {"name": item["name"], "identitySha256": digest(observed[0])}
    postgres = records["postgres"]
    return {"root": str(install.root), "profile": install.profile, "project": install.project,
            "instanceId": install.settings["instanceId"], "settingsSha256": digest(install.settings),
            "envSha256": file_digest(install.root / ".env"),
            "composeFiles": {name: file_digest(install.root / name) for name in install.files},
            "resolvedConfigSha256": normalized_config(config, previous, selected), "volumes": volumes,
            "postgres": {"containerId": postgres["id"], "reference": postgres["image"],
                         "imageId": run(["docker", "inspect", "--format", "{{.Image}}", postgres["id"]], capture=True)},
            "migrationHistorySha256": _history(install)}


def prepare_candidate(install, selected, deployment_digest):
    require(deployment_digest is not None, "ROLLBACK_SELECTION", "Select an immutable deployment digest for a reversible P0 update.")
    releases.validate_deployment_digest(deployment_digest)
    previous = validate_release(_read(install.state / "installed-release.json"))
    require(install.readiness(previous["revision"], previous["schema"]) ==
            {"revision": PREVIOUS, "schema": SCHEMA}, "ROLLBACK_RUNTIME", "Previous P0 runtime is not ready.")
    sources = validate_pair(install, previous, selected)
    tool = tool_identity(install)
    ci = {"previous": _ci_identity(previous), "selected": _ci_identity(selected),
          "tools": _tool_ci(tool, install.profile in ("production", "staging"), deployment_digest)}
    images = _images(previous, selected)
    binding = _snapshot(install, previous, selected, images=images)
    # Use the shipped plan validator, including its explicit historical
    # checksum compatibility rules. --plan starts a read-only transaction;
    # neither this command nor return applies migrations.
    install.compose("run", "--rm", "--no-deps", "--pull", "never", "--entrypoint", "node",
                    "migration", "tools/migrate.mjs", "--plan")
    return {"policy": POLICY, "previous": previous, "selected": selected,
            "deploymentDigest": deployment_digest, "sources": sources, "tooling": tool,
            "ci": ci, "images": images, "binding": binding}


def _backup(install, path, candidate, *, at=None):
    path = Path(path)
    require(path.is_absolute(), "ROLLBACK_BACKUP", "Application return needs an absolute verified backup path.")
    plain_paths(path, ("manifest.json", "private.env", "configuration/installed-release.json"))
    attest_access([(path, True), (path / "private.env", True), (path / "manifest.json", False)])
    before = file_digest(path / "manifest.json")
    manifest = verify_backup(path)
    plain_paths(path, tuple(manifest["files"]))
    require(before == file_digest(path / "manifest.json"), "ROLLBACK_BACKUP", "Backup manifest changed during verification.")
    previous = candidate["previous"]
    require(manifest["runtime"] == {"revision": previous["revision"], "schema": previous["schema"]}
            and manifest["project"] == install.project and manifest["profile"] == install.profile
            and manifest["postgresImage"] == candidate["binding"]["postgres"]["reference"]
            and _read(path / "configuration/installed-release.json") == previous
            and file_digest(path / "private.env") == candidate["binding"]["envSha256"],
            "ROLLBACK_BACKUP", "Backup lineage or private configuration differs from this operation.")
    require(_read(path / "configuration/installation.json") == install.settings,
            "ROLLBACK_BACKUP", "Backup installation settings differ from the preserved instance.")
    for name, expected in candidate["binding"]["composeFiles"].items():
        live = install.root / name
        # Canonical backup's text writer uses the native newline on Windows.
        # Only CRLF/LF representation is normalized here; the live raw hash and
        # full backup inventory remain exact and independently enforced.
        require(file_digest(live) == expected and
                (path / "configuration" / name).read_bytes().replace(b"\r\n", b"\n")
                == live.read_bytes().replace(b"\r\n", b"\n"),
                "ROLLBACK_BACKUP", "Backup Compose configuration differs from the preserved installation.")
    for name, reference in previous["images"].items():
        require(manifest["images"].get(name) == {"reference": reference, "imageId": candidate["images"]["ids"]["previous"][name]},
                "ROLLBACK_BACKUP", "Backup image provenance differs from the previous runtime.")
    require(manifest["images"].get("postgres") == {
        "reference": candidate["binding"]["postgres"]["reference"],
        "imageId": candidate["binding"]["postgres"]["imageId"]},
        "ROLLBACK_BACKUP", "Backup PostgreSQL engine bytes differ from the preserved container.")
    created = dt.datetime.strptime(manifest["createdAt"][:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    observed = dt.datetime.fromisoformat(at) if at else dt.datetime.now(dt.timezone.utc)
    require(0 <= (observed - created).total_seconds() <= MAX_BACKUP_AGE, "ROLLBACK_BACKUP_AGE",
            "A verified backup from the preceding six hours is required at the switch.")
    return {"path": str(path), "manifestSha256": before, "createdAt": manifest["createdAt"]}


def _link(journal):
    return {"operationId": journal["id"], "eligibilitySha256": journal["eligibilitySha256"]}


def _advance(install, journal, phase):
    require(phase in PHASES and len(journal["events"]) < 128, "ROLLBACK_PHASE", "Unsupported or exhausted recovery journal.")
    sequence = journal["sequence"] + 1
    event = {"sequence": sequence, "phase": phase, "at": stamp(),
             "previousSha256": digest(journal["events"][-1]) if journal["events"] else journal["eligibilitySha256"]}
    journal.update(phase=phase, sequence=sequence, events=[*journal["events"], event])
    _write(install.state / JOURNAL, journal)


def load_journal(install, *, optional=False):
    journal = _read(install.state / JOURNAL, optional=optional)
    if journal is None:
        return None
    require(set(journal) == {"format", "id", "createdAt", "eligibility", "eligibilitySha256", "phase", "sequence", "events"}
            and journal["format"] == FORMAT and isinstance(journal["id"], str)
            and re.fullmatch(r"[a-f0-9]{32}", journal["id"])
            and isinstance(journal["phase"], str) and journal["phase"] in PHASES and type(journal["sequence"]) is int
            and isinstance(journal["events"], list) and 1 <= len(journal["events"]) <= 128
            and journal["sequence"] == len(journal["events"])
            and digest(journal["eligibility"]) == journal["eligibilitySha256"],
            "ROLLBACK_JOURNAL", "Application return journal is malformed or changed.")
    prior = journal["eligibilitySha256"]
    for sequence, event in enumerate(journal["events"], 1):
        require(isinstance(event, dict) and set(event) == {"sequence", "phase", "at", "previousSha256"}
                and event["sequence"] == sequence and isinstance(event["phase"], str)
                and event["phase"] in PHASES and event["previousSha256"] == prior,
                "ROLLBACK_JOURNAL", "Application return write-ahead history is incomplete.")
        prior = digest(event)
    require(journal["events"][-1]["phase"] == journal["phase"], "ROLLBACK_JOURNAL", "Journal phase differs from its history.")
    return journal


def guard_update(install):
    journal = load_journal(install, optional=True)
    if journal is not None:
        require(journal["phase"] in TERMINAL or journal["phase"] == "prepared" and
                not (install.state / "maintenance.json").exists() and
                not (install.state / "failed-switch.json").exists(),
                "ROLLBACK_PENDING", "An application return operation is unfinished.",
                "Use rollback-plan and rollback from the pinned external tools; do not acknowledge or start another update.")


def guard_acknowledge(install):
    journal = load_journal(install, optional=True)
    require(journal is None or journal["phase"] in TERMINAL, "ROLLBACK_PENDING",
            "A linked application return cannot be discarded with acknowledge.",
            "Inspect rollback-plan and resume the guarded rollback command.")


def begin(install, candidate, backup, operation):
    require(candidate["policy"] == POLICY and
            tool_identity(install) == candidate["tooling"] and
            validate_pair(install, candidate["previous"], candidate["selected"]) == candidate["sources"] and
            _snapshot(install, candidate["previous"], candidate["selected"], images=candidate["images"]) == candidate["binding"],
            "ROLLBACK_DRIFT", "Eligibility changed before the application switch.")
    guard_update(install)
    prior = load_journal(install, optional=True)
    if prior is not None:
        archive = _history_directory(install, prior["id"]) / JOURNAL
        plain_paths(install.root, (str(archive.relative_to(install.root)),))
        require(not archive.exists() or _read(archive) == prior, "ROLLBACK_HISTORY", "Archived capsule differs.")
        _write(archive, prior)
    previous_receipt = _read(install.state / "last-operation.json", optional=True)
    eligibility = {**candidate, "backup": _backup(install, backup, candidate),
                   "previousReceiptSha256": digest(previous_receipt)}
    journal = {"format": FORMAT, "id": uuid.uuid4().hex, "createdAt": stamp(),
               "eligibility": eligibility, "eligibilitySha256": digest(eligibility),
               "phase": "prepared", "sequence": 0, "events": []}
    _advance(install, journal, "prepared")
    operation["applicationRollback"] = _link(journal)
    return journal


def _api_ready(install, release):
    script = """const [revision,schema]=process.argv.slice(1);fetch('http://127.0.0.1:4611/health/ready').then(async r=>{const v=await r.json();if(!r.ok||v.status!=='ready'||v.deployment.revision!==revision||v.deployment.schemaVersion!==Number(schema)||v.deployment.expectedSchemaVersion!==Number(schema)||v.deployment.synchronized!==true)process.exit(1)}).catch(()=>process.exit(1));"""
    deadline = time.monotonic() + 180
    while True:
        try:
            install.compose("exec", "-T", "api", "node", "-e", script, release["revision"], str(release["schema"]), capture=True)
            return
        except Blocked:
            require(time.monotonic() < deadline, "ROLLBACK_API", "API did not become ready before Web start.")
            time.sleep(2)


def _start_services(install, journal, release, direction):
    for stage, services in (("support", ("minio", "search", "scratch")), ("api", ("api",)), ("web", ("web",))):
        _advance(install, journal, direction + "_" + stage)
        install.compose("up", "-d", "--no-build", "--no-deps", "--pull", "never", "--wait", "--wait-timeout", "180", *services)
        if stage == "api":
            _api_ready(install, release)
    _advance(install, journal, direction + "_verify")


def switch_forward(install, journal):
    # The existing operational publisher accepts completed success/failure
    # receipts only. Pending intent is a private linked state record, never a
    # fabricated successful operational event.
    _write(install.state / "last-operation.json", {"at": stamp(), "status": "switching", "phase": "switch",
        "selected": journal["eligibility"]["selected"], "previous": journal["eligibility"]["previous"],
        "applicationRollback": _link(journal)})
    _advance(install, journal, "forward_stop")
    install.compose("stop", "web", "api", "scratch", "search")
    _start_services(install, journal, journal["eligibility"]["selected"], "forward")


def forward_accepted(install, journal):
    candidate = journal["eligibility"]
    require(_snapshot(install, candidate["previous"], candidate["selected"], images=candidate["images"], partial=True)
            == candidate["binding"], "ROLLBACK_DRIFT", "Data or private configuration changed during the application switch.")
    _exact_side(install, candidate, "selected")
    _advance(install, journal, "forward_accepted")


def _exact_side(install, candidate, side):
    release = candidate[side]
    require(install.git("rev-parse", "HEAD") == release["revision"] and
            _read(install.state / "installed-release.json") == release,
            "ROLLBACK_COMPLETE_DRIFT", "The completed operation's exact source or installed manifest changed.")
    records = install.identity()
    require(set(records) == {"postgres", *release["images"]} and
            all(records[name]["image"] == reference and records[name]["running"]
                and run(["docker", "inspect", "--format", "{{.Image}}", records[name]["id"]], capture=True)
                == candidate["images"]["ids"][side][name]
                for name, reference in release["images"].items()),
            "ROLLBACK_COMPLETE_DRIFT", "The completed operation no longer has every exact pinned running image.")


def _linked_records(install, journal):
    link = _link(journal)
    receipt = _read(install.state / "last-operation.json", optional=True)
    markers = {name: _read(install.state / name, optional=True)
               for name in ("maintenance.json", "failed-switch.json")}
    require(all(value is None or value.get("applicationRollback") == link for value in markers.values()),
            "ROLLBACK_OPERATION", "An unrelated or backup operation owns a recovery marker.")
    linked = isinstance(receipt, dict) and receipt.get("applicationRollback") == link
    interrupted_arm = (any(markers.values()) and digest(receipt) == journal["eligibility"]["previousReceiptSha256"]
                       and journal["phase"] == "prepared")
    require(linked or interrupted_arm, "ROLLBACK_OPERATION",
            "The capsule is not linked to the installation's last update operation.")
    return markers


def inspect(install):
    journal = load_journal(install)
    candidate = journal["eligibility"]
    require(set(candidate) == {"policy", "previous", "selected", "deploymentDigest", "sources", "tooling",
                               "ci", "images", "binding", "backup", "previousReceiptSha256"}
            and candidate["policy"] == POLICY, "ROLLBACK_JOURNAL", "Unknown application compatibility declaration.")
    _linked_records(install, journal)
    require(tool_identity(install) == candidate["tooling"], "ROLLBACK_TOOLING",
            "Resume with the exact external tools checkout and interpreter family used to arm this operation.")
    require(validate_pair(install, candidate["previous"], candidate["selected"]) == candidate["sources"],
            "ROLLBACK_SOURCE", "The source compatibility identities changed.")
    installed = validate_release(_read(install.state / "installed-release.json"))
    require(installed in (candidate["previous"], candidate["selected"]), "ROLLBACK_INSTALLED", "An unrelated release is installed.")
    require(_images(candidate["previous"], candidate["selected"]) == candidate["images"],
            "ROLLBACK_IMAGE", "Local immutable image identities changed.")
    require(_snapshot(install, candidate["previous"], candidate["selected"], images=candidate["images"], partial=True)
            == candidate["binding"], "ROLLBACK_DRIFT", "Configuration, PostgreSQL, schema or volume identity changed.")
    require(_backup(install, candidate["backup"]["path"], candidate, at=journal["createdAt"]) == candidate["backup"],
            "ROLLBACK_BACKUP", "The operation's verified backup changed.")
    pending = _read(install.state / "release-selection.json", optional=True)
    if pending is not None:
        require(pending == {"format": "asa-release-selection-v1", "deploymentDigest": candidate["deploymentDigest"],
                            "releaseSha256": digest(candidate["selected"])}, "ROLLBACK_SELECTION",
                "A different immutable release selection is pending.")
    return journal


def _rollback_marker(install, journal):
    _write(install.state / "maintenance.json", {"phase": "application_rollback", "applicationRollback": _link(journal),
                                               "selected": journal["eligibility"]["selected"],
                                               "previous": journal["eligibility"]["previous"]})


def _archive_markers(install, journal):
    markers = _linked_records(install, journal)
    names = [name for name, value in markers.items() if value is not None]
    if (install.state / "release-selection.json").exists():
        names.append("release-selection.json")
    directory = _history_directory(install, journal["id"])
    for name in names:
        source, target = install.state / name, directory / name
        plain_paths(install.root, (str(source.relative_to(install.root)), str(target.relative_to(install.root))))
        require(not target.exists() or target.read_bytes() == source.read_bytes(), "ROLLBACK_HISTORY", "Recovery history already contains different evidence.")
        os.replace(source, target)
        _sync(directory)
        _sync(install.state)


def _history_directory(install, operation_id):
    directory = install.state / "application-rollback-history"
    plain_paths(install.root, (str((directory / operation_id).relative_to(install.root)),))
    # pathlib parents=True applies mode only to the leaf. Create and attest
    # both private levels explicitly; never chmod an existing history path.
    directory.mkdir(exist_ok=True, mode=0o700)
    attest_access([(directory, True)])
    directory = directory / operation_id
    directory.mkdir(exist_ok=True, mode=0o700)
    attest_access([(directory, True)])
    return directory


def rollback(install, *, check=False):
    journal = inspect(install)
    candidate, previous = journal["eligibility"], journal["eligibility"]["previous"]
    print(f"APPLICATION_RETURN operation={journal['id']} phase={journal['phase']} previous={previous['revision']} selected={candidate['selected']['revision']} schema={SCHEMA}")
    if check:
        if journal["phase"] == "rolled_back":
            _exact_side(install, candidate, "previous")
        print("APPLICATION_RETURN_ELIGIBLE live database and object volumes are retained; no runtime mutation")
        return journal
    if journal["phase"] == "rolled_back":
        _exact_side(install, candidate, "previous")
        install.wait_ready(previous["revision"], previous["schema"])
        verify_embedded_entry_http(install.env["ASA_UPDATE_ENTRY_ORIGIN"], previous["revision"])
        _archive_markers(install, journal)
        print("APPLICATION_RETURN_ALREADY_COMPLETE")
        return journal
    _rollback_marker(install, journal)
    _advance(install, journal, "rollback_stop")
    install.compose("stop", "web", "api", "scratch", "search", "minio")
    _advance(install, journal, "rollback_source")
    _clean(install.root)
    if install.git("rev-parse", "HEAD") != previous["revision"]:
        # This dedicated pair guard does not change selected_source's ancestry
        # rule. The executable/imports remain in the pinned external checkout.
        install.git("switch", "--detach", previous["revision"])
    install = Installation(install.root, install.profile)
    releases.apply_release_environment(install, previous)
    config = releases.validate_resolved_images(install, previous)
    require(normalized_config(config, previous, candidate["selected"]) == candidate["binding"]["resolvedConfigSha256"],
            "ROLLBACK_CONFIG", "Previous resolved configuration differs from the armed operation.")
    _start_services(install, journal, previous, "rollback")
    install.wait_ready(previous["revision"], previous["schema"])
    verify_embedded_entry_http(install.env["ASA_UPDATE_ENTRY_ORIGIN"], previous["revision"])
    require(_snapshot(install, previous, candidate["selected"], images=candidate["images"]) == candidate["binding"],
            "ROLLBACK_DRIFT", "Post-return runtime or data identity differs.")
    _write(install.state / "installed-release.json", previous)
    _exact_side(install, candidate, "previous")
    install.receipt({"status": "success", "phase": "verify_entry", "action": "rollback", "selected": previous,
                     "previous": candidate["selected"], "rollbackOf": candidate["selected"]["revision"],
                     "backup": candidate["backup"]["path"], "applicationRollback": _link(journal),
                     "entryHttp": "pass", "userFlow": "not_run", "automaticDatabaseRestore": False,
                     "liveDataPreserved": True, "automaticUpdates": False})
    _sync(install.state)
    _advance(install, journal, "rolled_back")
    _archive_markers(install, journal)
    print(f"APPLICATION_RETURN_COMPLETE revision={previous['revision']} schema={SCHEMA}; live database and objects retained")
    return journal
