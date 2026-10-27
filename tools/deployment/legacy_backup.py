"""Explicit recovery sets for an attested legacy review installation.

This module is deliberately not a fallback for the ordinary backup command.
The caller supplies a plan attested by LegacyInstallation and owns the operation
lock. Runtime inputs are copied before any source switch; Web provenance remains
unknown when the old server did not publish metadata.
"""

import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import tempfile
import time
import uuid

from .backup import db_command, privileges, restore_check, upload_dump
from .contracts import Blocked, file_hash, inventory_files, require, safe_member, verify_backup
from .paths import atomic_json, plain_paths
from .system import run


WRITERS = ("web", "api", "scratch", "minio")
SERVICES = {"postgres", "migration", "minio", "minio-init", "api", "web", "scratch", "search"}
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}")
CONTAINER_ID = re.compile(r"[0-9a-f]{64}")
BACKUP_KIND = "asa-legacy-review-backup-v1"


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def _plain(root, names=()):
    try:
        plain_paths(root, names)
    except (OSError, ValueError) as exc:
        raise Blocked("LEGACY_BACKUP_PATH", "Recovery paths must not traverse links or redirected files.",
                      "Choose an ordinary private directory; do not change the live installation.") from exc


def _check_private(path):
    """Read existing permissions only; never adjust Windows ACL or host settings."""
    _plain(path)
    require(path.is_dir(), "LEGACY_BACKUP_PATH", "Recovery directory is absent.")
    if os.name != "nt":
        info = path.stat()
        require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0,
                "LEGACY_BACKUP_PERMISSIONS", "Recovery directory must be owned by the operator with mode 0700.")
        return
    # Translate trustees to SIDs to avoid language-dependent icacls output.
    literal = str(path).replace("'", "''")
    script = (
        "$ErrorActionPreference='Stop'; "
        f"$recoveryAcl=Get-Acl -LiteralPath '{literal}'; "
        "$recoverySid=[System.Security.Principal.SecurityIdentifier]; "
        "$recoveryOwner=$recoveryAcl.GetOwner($recoverySid).Value; "
        "$recoveryUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; "
        "$recoveryAllow=@($recoveryAcl.Access | Where-Object {$_.AccessControlType -eq 'Allow'} | "
        "ForEach-Object {$_.IdentityReference.Translate($recoverySid).Value}); "
        "@{owner=$recoveryOwner;user=$recoveryUser;allow=$recoveryAllow}|ConvertTo-Json -Compress"
    )
    acl = json.loads(run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture=True))
    allowed = {acl.get("user"), "S-1-5-18", "S-1-5-32-544"}
    require(isinstance(acl.get("user"), str) and acl.get("owner") in allowed
            and isinstance(acl.get("allow"), list) and set(acl["allow"]) <= allowed,
            "LEGACY_BACKUP_PERMISSIONS", "Recovery directory grants access outside the operator, SYSTEM and Administrators.",
            "Use an existing private backup directory; this command does not change ACLs.")


def _destination(install, destination):
    parent = Path(destination)
    require(parent.is_absolute(), "LEGACY_BACKUP_PATH", "An absolute private recovery directory is required.")
    _plain(parent)
    parent = parent.resolve()
    require(not parent.is_relative_to(install.root.resolve()), "LEGACY_BACKUP_PATH",
            "Legacy recovery must be outside the source-mounted installation.")
    if not parent.exists():
        _check_private(parent.parent)
        parent.mkdir(mode=0o700)
    _check_private(parent)
    return parent


def _snapshot_contract(install, snapshot):
    require(snapshot.get("root") == str(install.root) and snapshot.get("project") == install.project
            and snapshot.get("profile") == install.profile,
            "LEGACY_BACKUP_IDENTITY", "Recovery plan belongs to another installation.")
    records = snapshot.get("containers", {})
    require(isinstance(records, dict) and set(records) == SERVICES,
            "LEGACY_BACKUP_IDENTITY", "Recovery needs the complete attested service set.")
    for record in records.values():
        require(CONTAINER_ID.fullmatch(record.get("id", "")) and IMAGE_ID.fullmatch(record.get("imageId", "")),
                "LEGACY_BACKUP_IDENTITY", "Recovery needs exact container and image IDs.")
    require(records["postgres"].get("running") is True and records["minio"].get("running") is True,
            "LEGACY_BACKUP_SERVICES", "The source PostgreSQL and MinIO must be running before recovery preparation.")
    require(all(not records[name].get("running") for name in ("migration", "minio-init")),
            "LEGACY_BACKUP_WRITER", "A migration or initialization writer is active.", "Wait for its completion and build a new plan.")
    inputs = snapshot.get("inputs", {})
    files = snapshot.get("files", [])
    require(isinstance(inputs, dict) and isinstance(files, list) and files
            and {".env", *files} <= set(inputs),
            "LEGACY_BACKUP_INPUTS", "The snapshot must cover private configuration and every Compose file.")
    runtime = snapshot.get("runtime", {})
    api = runtime.get("api", {})
    require(runtime.get("kind") == "legacy-review" and re.fullmatch(r"[0-9a-f]{40}", api.get("revision", ""))
            and type(api.get("schema")) is int and api["schema"] > 0,
            "LEGACY_BACKUP_RUNTIME", "Legacy API revision and schema need an observed receipt.")
    for relative, expected in inputs.items():
        safe_member(install.root, relative)
        require(isinstance(expected, dict) and type(expected.get("bytes")) is int and expected["bytes"] >= 0
                and re.fullmatch(r"[0-9a-f]{64}", expected.get("sha256", "")),
                "LEGACY_BACKUP_INPUTS", "Invalid runtime input inventory.")
    return records


def _check_inputs(root, inputs):
    for relative, expected in inputs.items():
        _plain(root, (relative,))
        path = safe_member(root, relative)
        require(path.is_file() and path.stat().st_size == expected["bytes"] and file_hash(path) == expected["sha256"],
                "LEGACY_BACKUP_DRIFT", "Source input bytes changed after planning.", "Preserve the new work and create a new plan.")


def _whole_inventory(root):
    """Unlike a backup inventory, include a legitimate object named manifest.json."""
    result = {}
    _plain(root)
    for path in sorted(Path(root).rglob("*")):
        relative = path.relative_to(root).as_posix()
        _plain(root, (relative,))
        if path.is_file():
            result[relative] = {"bytes": path.stat().st_size, "sha256": file_hash(path)}
    return result


def _space_budget(install, records, inputs, parent):
    image_ids = sorted({record["imageId"] for record in records.values()})
    sizes = run(["docker", "image", "inspect", "--format", "{{.Size}}", *image_ids], capture=True).splitlines()
    require(len(sizes) == len(image_ids) and all(re.fullmatch(r"[0-9]+", value) for value in sizes),
            "LEGACY_BACKUP_SPACE", "Cannot measure the preserved image set.")
    runtime_sizes = run(["docker", "inspect", "--size", "--format", "{{.SizeRootFs}}",
                         records["api"]["id"], records["web"]["id"]], capture=True).splitlines()
    require(len(runtime_sizes) == 2 and all(re.fullmatch(r"[0-9]+", value) for value in runtime_sizes),
            "LEGACY_BACKUP_SPACE", "Cannot measure the writable legacy runtime filesystems.")
    db_bytes = db_command(install,
        'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"', capture=True)
    object_size = run(["docker", "exec", records["minio"]["id"], "du", "-sk", "/data"], capture=True).split()
    docker_free = run(["docker", "exec", records["postgres"]["id"], "df", "-Pk", "/var/lib/postgresql/data"], capture=True).splitlines()
    require(re.fullmatch(r"[0-9]+", db_bytes) and object_size and re.fullmatch(r"[0-9]+", object_size[0])
            and len(docker_free) >= 2 and len(docker_free[-1].split()) >= 4
            and re.fullmatch(r"[0-9]+", docker_free[-1].split()[3]),
            "LEGACY_BACKUP_SPACE", "Cannot measure recovery storage requirements.")
    database_bytes, object_bytes = int(db_bytes), int(object_size[0]) * 1024
    # Object restore uses a private tar and read-back; DB restore is on Docker's
    # data filesystem. Conservative image sizes intentionally over-count layers.
    required_host = sum(map(int, sizes)) + 2 * sum(map(int, runtime_sizes)) + 2 * sum(item["bytes"] for item in inputs.values()) + 3 * object_bytes + 2 * database_bytes + 256 * 1024**2
    required_docker = 2 * database_bytes + 2 * object_bytes + 256 * 1024**2
    require(shutil.disk_usage(parent).free >= required_host
            and int(docker_free[-1].split()[3]) * 1024 >= required_docker,
            "LEGACY_BACKUP_SPACE", "Insufficient space for complete recovery and isolated restore verification.",
            "Provide space without deleting source data, prior backups or other projects.")
    return {"requiredHostBytes": required_host, "requiredDockerBytes": required_docker}


def verify_image_archive(path, expected_ids):
    """Read Docker save manifests/configs without loading or extracting layers."""
    _plain(Path(path))
    try:
        return _verify_image_archive(path, expected_ids)
    except (tarfile.TarError, EOFError, json.JSONDecodeError) as exc:
        raise Blocked("LEGACY_BACKUP_IMAGES", "The preserved image archive is damaged.", "Keep the old installation and create a new complete backup.") from exc


def _verify_image_archive(path, expected_ids):
    expected_ids = set(expected_ids)
    require(expected_ids and all(IMAGE_ID.fullmatch(value) for value in expected_ids),
            "LEGACY_BACKUP_IMAGES", "The saved image set needs immutable IDs.")
    with tarfile.open(path, "r:*") as archive:
        members = {}
        for item in archive:
            value = PurePosixPath(item.name)
            require(item.name and not value.is_absolute() and ".." not in value.parts
                    and "\\" not in item.name and ":" not in item.name
                    and not item.issym() and not item.islnk()
                    and (item.isfile() or item.isdir()) and item.name not in members,
                    "LEGACY_BACKUP_IMAGES", "Saved image archive has unsafe or duplicate members.")
            members[item.name] = item
        manifest = members.get("manifest.json")
        require(manifest and manifest.isfile() and manifest.size <= 1024 * 1024,
                "LEGACY_BACKUP_IMAGES", "Saved image archive has no bounded Docker manifest.")
        with archive.extractfile(manifest) as stream:
            payload = json.load(stream)
        require(isinstance(payload, list) and payload, "LEGACY_BACKUP_IMAGES", "Saved image manifest is empty.")
        found, verified_layers = set(), {}
        for record in payload:
            require(isinstance(record, dict), "LEGACY_BACKUP_IMAGES", "Invalid saved image manifest entry.")
            config = members.get(record.get("Config", ""))
            require(config and config.isfile() and config.size <= 16 * 1024**2
                    and isinstance(record.get("Layers"), list) and record["Layers"],
                    "LEGACY_BACKUP_IMAGES", "Saved image configuration or layers are absent.")
            require(all(name in members and members[name].isfile() for name in record["Layers"]),
                    "LEGACY_BACKUP_IMAGES", "Saved image archive is missing a layer.")
            with archive.extractfile(config) as stream:
                content = stream.read()
            found.add("sha256:" + hashlib.sha256(content).hexdigest())
            configuration = json.loads(content)
            differences = configuration.get("rootfs", {}).get("diff_ids", [])
            require(configuration.get("rootfs", {}).get("type") == "layers" and isinstance(differences, list)
                    and len(differences) == len(record["Layers"])
                    and all(isinstance(value, str) and IMAGE_ID.fullmatch(value) for value in differences),
                    "LEGACY_BACKUP_IMAGES", "Saved image layers are not tied to the immutable configuration.")
            for name, expected in zip(record["Layers"], differences):
                if name not in verified_layers:
                    with archive.extractfile(members[name]) as stream:
                        signature = stream.read(2)
                        stream.seek(0)
                        layer = gzip.GzipFile(fileobj=stream) if signature == b"\x1f\x8b" else stream
                        digest = hashlib.sha256()
                        for chunk in iter(lambda: layer.read(1024 * 1024), b""):
                            digest.update(chunk)
                        verified_layers[name] = "sha256:" + digest.hexdigest()
                require(verified_layers[name] == expected, "LEGACY_BACKUP_IMAGES", "Saved layer bytes differ from their immutable image configuration.")
        require(found == expected_ids, "LEGACY_BACKUP_IMAGES", "Saved image IDs differ from the running legacy installation.")
    return sorted(found)


def _copy_inputs(install, snapshot, partial):
    mapping = {}
    for relative, expected in snapshot["inputs"].items():
        source = safe_member(install.root, relative)
        _plain(install.root, (relative,))
        member = ("private.env" if relative == ".env" else
                  "configuration/" + relative if relative in snapshot["files"] else "runtime-inputs/" + relative)
        target = safe_member(partial, member)
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        shutil.copyfile(source, target)
        os.chmod(target, 0o600)
        require(target.stat().st_size == expected["bytes"] and file_hash(target) == expected["sha256"],
                "LEGACY_BACKUP_DRIFT", "Copied source input differs from the plan.")
        mapping[relative] = member
    return mapping


def verify_runtime_archive(path):
    """Inspect a Docker rootfs export without extracting its absolute symlinks.

    Review compilation may write outside the binds. Save those bytes as well as
    the original image and mounted inputs; no Docker commit/label replacement is
    used. Rootfs links belong inside a container and are never extracted on host.
    """
    _plain(Path(path))
    names, regular, size = set(), 0, 0
    try:
        with tarfile.open(path, "r:*") as archive:
            for member in archive:
                value = PurePosixPath(member.name)
                require(member.name and not value.is_absolute() and ".." not in value.parts
                        and "\\" not in member.name and "\x00" not in member.name
                        and member.name not in names,
                        "LEGACY_BACKUP_FILESYSTEM", "Invalid legacy runtime archive member.")
                names.add(member.name)
                if member.isfile():
                    regular += 1
                    size += member.size
        require(regular > 0, "LEGACY_BACKUP_FILESYSTEM", "Legacy runtime filesystem export is empty.")
    except (tarfile.TarError, EOFError) as exc:
        raise Blocked("LEGACY_BACKUP_FILESYSTEM", "Legacy runtime filesystem export is damaged.",
                      "Keep the source installation and create a new complete backup.") from exc
    return {"entries": len(names), "regularFiles": regular, "unpackedBytes": size}


def _container_running(ids):
    value = run(["docker", "inspect", "--format", '{{.Id}} {{.State.Running}}', *ids], capture=True)
    observed = dict(line.split() for line in value.splitlines())
    require(set(observed) == set(ids) and all(observed[item] == "true" for item in ids),
            "LEGACY_BACKUP_RESUME", "A preserved legacy writer did not resume.")


def _same_runtime(left, right):
    return (left.get("api", {}).get("revision") == right.get("api", {}).get("revision")
            and left.get("api", {}).get("schema") == right.get("api", {}).get("schema")
            and left.get("web", {}).get("revision") == right.get("web", {}).get("revision")
            and left.get("web", {}).get("status") == right.get("web", {}).get("status"))


def _wait_legacy(install, snapshot):
    deadline = time.monotonic() + 60
    while True:
        try:
            require(_same_runtime(install.legacy_readiness(snapshot["entryOrigin"]), snapshot["runtime"]),
                    "LEGACY_BACKUP_RESUME", "Resumed legacy runtime differs from the source observation.")
            return
        except (Blocked, OSError, ValueError):
            require(time.monotonic() < deadline, "LEGACY_BACKUP_RESUME", "The original legacy runtime did not recover.")
            time.sleep(1)


def export_legacy_backup(install, snapshot, destination, *, revalidate, leave_stopped=False):
    """Create a full private recovery set without checking out or editing sources.

    revalidate(allow_stopped=...) must attest identity, inputs, Git and authors
    again. A failure retains an incomplete directory and a maintenance receipt.
    The caller holds operation_lock across this function and the later switch.
    """
    records = _snapshot_contract(install, snapshot)
    require(not (install.state / "maintenance.json").exists(), "MAINTENANCE", "An unfinished operation requires recovery first.")
    parent = _destination(install, destination)
    revalidate(allow_stopped=False)
    _check_inputs(install.root, snapshot["inputs"])
    budget = _space_budget(install, records, snapshot["inputs"], parent)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex
    partial, final = parent / (stamp + ".incomplete"), parent / stamp
    partial.mkdir(mode=0o700)
    running = [records[name]["id"] for name in WRITERS if records[name]["running"]]
    operation = {"format": "asa-legacy-backup-operation-v1", "phase": "prepared", "at": _now(),
                 "snapshotSha256": _fingerprint(snapshot), "partial": str(partial), "backup": None,
                 "resumeContainerIds": running, "space": budget, "sourceSchema": snapshot["runtime"]["api"]["schema"]}
    marker = install.state / "maintenance.json"
    atomic_json(marker, operation)
    stopped, completed, failure = False, False, None
    try:
        # Revalidate at the last boundary before any downtime.
        revalidate(allow_stopped=False)
        operation["phase"] = "stopping_writers"
        atomic_json(marker, operation)
        stopped = True  # A partially successful docker stop also needs recovery.
        if running:
            run(["docker", "stop", *running], capture=True)
        revalidate(allow_stopped=True)
        operation["phase"] = "copying"
        atomic_json(marker, operation)
        schema = db_command(install,
            'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COALESCE(max(version::integer),0) FROM schema_migrations"', capture=True)
        require(schema == str(snapshot["runtime"]["api"]["schema"]), "LEGACY_BACKUP_SCHEMA", "Database schema changed after planning.")
        with (partial / "database.dump").open("wb") as stream:
            db_command(install, 'pg_dump --format=custom -U "$POSTGRES_USER" -d "$POSTGRES_DB"', output=stream)
        require((partial / "database.dump").stat().st_size > 0, "LEGACY_BACKUP_DATABASE", "Database dump is empty.")
        with (partial / "globals.sql").open("wb") as stream:
            db_command(install, 'pg_dumpall --globals-only --no-role-passwords -U "$POSTGRES_USER"', output=stream)
        acl = privileges(install)
        objects = partial / "objects"
        objects.mkdir(mode=0o700)
        run(["docker", "cp", f"{records['minio']['id']}:/data/.", str(objects)], capture=True)
        object_inventory = _whole_inventory(objects)
        mapping = _copy_inputs(install, snapshot, partial)
        atomic_json(partial / "configuration" / "legacy-snapshot.json", snapshot)
        # Runtime inspect includes private environment: it is stored only inside
        # the private recovery directory and is never printed in diagnostics.
        inspected = json.loads(run(["docker", "inspect", *[record["id"] for record in records.values()]], capture=True))
        require({row["Id"]: row["Image"] for row in inspected} == {row["id"]: row["imageId"] for row in records.values()},
                "LEGACY_BACKUP_IMAGES", "The runtime image set changed during backup.")
        atomic_json(partial / "configuration" / "container-inspect.json", inspected)
        filesystems = {}
        (partial / "runtime-filesystems").mkdir(mode=0o700)
        for name in ("api", "web"):
            member = f"runtime-filesystems/{name}.tar"
            exported = partial / member
            run(["docker", "export", "--output", str(exported), records[name]["id"]], capture=True)
            os.chmod(exported, 0o600)
            filesystems[name] = {"file": member, "containerId": records[name]["id"], "imageId": records[name]["imageId"],
                                 **verify_runtime_archive(exported)}
        image_ids = sorted({record["imageId"] for record in records.values()})
        archive = partial / "runtime-images.tar"
        run(["docker", "image", "save", "--output", str(archive), *image_ids], capture=True)
        os.chmod(archive, 0o600)
        verify_image_archive(archive, image_ids)
        remote = f"/tmp/asa-legacy-verify-{uuid.uuid4().hex}.dump"
        try:
            upload_dump(install, partial / "database.dump", remote)
            install.compose("exec", "-T", "postgres", "pg_restore", "--list", remote, capture=True)
        finally:
            install.compose("exec", "-T", "postgres", "rm", "-f", remote, capture=True)
        revalidate(allow_stopped=True)
        _check_inputs(install.root, snapshot["inputs"])
        runtime = {**snapshot["runtime"], "revision": snapshot["runtime"]["api"]["revision"],
                   "schema": snapshot["runtime"]["api"]["schema"], "revisionScope": "api-only"}
        manifest = {"format": "asa-backup-v1", "complete": True, "createdAt": _now(), "runtime": runtime,
                    "project": install.project, "profile": install.profile, "postgresImage": records["postgres"]["image"],
                    "images": {name: {"reference": record["image"], "imageId": record["imageId"]} for name, record in records.items()},
                    "applicationPrivileges": acl, "legacy": {"format": BACKUP_KIND, "snapshotSha256": _fingerprint(snapshot),
                        "inputs": mapping, "objectFiles": object_inventory, "imageIds": image_ids, "runtimeFilesystems": filesystems,
                        "restoreVerified": False, "webRevision": snapshot["runtime"].get("web", {}).get("revision")},
                    "files": inventory_files(partial)}
        atomic_json(partial / "manifest.json", manifest)
        verify_legacy_backup(partial, _allow_incomplete=True)
        partial.rename(final)
        completed = True
        operation.update(phase="legacy_backed_up", backup=str(final), backupManifestSha256=file_hash(final / "manifest.json"))
        atomic_json(marker, operation)
    except BaseException as exc:
        failure = exc
        operation.update(phase="legacy_backup_failed", failureCode=exc.code if isinstance(exc, Blocked) else type(exc).__name__)
        # A failed validation/publication never leaves an apparently usable
        # partial set. Its directory is also rejected by the public verifier.
        manifest_path = partial / "manifest.json"
        if manifest_path.exists():
            try:
                incomplete_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                incomplete_manifest["complete"] = False
                atomic_json(manifest_path, incomplete_manifest)
            except (OSError, ValueError):
                operation["incompleteManifestRepair"] = "failed_directory_remains_incomplete"
        atomic_json(marker, operation)
    finally:
        if stopped and (failure is not None or not leave_stopped):
            try:
                # Never resume an old application after an unplanned source or
                # schema change, even while recovering from a failed copy.
                revalidate(allow_stopped=True)
                schema = db_command(install,
                    'psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT COALESCE(max(version::integer),0) FROM schema_migrations"', capture=True)
                require(schema == str(operation["sourceSchema"]), "LEGACY_BACKUP_SCHEMA", "Old services cannot resume on a changed schema.")
                if running:
                    run(["docker", "start", *running], capture=True)
                    _container_running(running)
                _wait_legacy(install, snapshot)
                operation["resumeStatus"] = "verified"
                if completed and failure is None:
                    marker.unlink()
                else:
                    atomic_json(marker, operation)
            except BaseException as exc:
                operation.update(resumeStatus="needs_recovery", resumeFailureCode=exc.code if isinstance(exc, Blocked) else type(exc).__name__)
                atomic_json(marker, operation)
                if failure is None:
                    failure = exc
    if failure is not None:
        raise failure
    print(f"LEGACY_BACKUP verified: {final}; isolated restore still required", flush=True)
    return final


def verify_legacy_backup(backup, *, _allow_incomplete=False):
    _plain(Path(backup))
    backup = Path(backup).resolve()
    require(_allow_incomplete or not backup.name.endswith(".incomplete"), "LEGACY_BACKUP_INCOMPLETE", "An incomplete recovery directory cannot be applied.")
    _plain(backup)
    manifest = verify_backup(backup)
    legacy = manifest.get("legacy", {})
    require(legacy.get("format") == BACKUP_KIND and manifest.get("runtime", {}).get("kind") == "legacy-review"
            and manifest["runtime"].get("revisionScope") == "api-only",
            "LEGACY_BACKUP", "Not an explicit legacy recovery set.")
    snapshot = json.loads((backup / "configuration" / "legacy-snapshot.json").read_text(encoding="utf-8"))
    require(_fingerprint(snapshot) == legacy.get("snapshotSha256") and snapshot.get("project") == manifest.get("project"),
            "LEGACY_BACKUP", "Recovery snapshot differs from its manifest.")
    require(set(legacy.get("inputs", {})) == set(snapshot.get("inputs", {})),
            "LEGACY_BACKUP_INPUTS", "Recovery set does not cover every planned input.")
    for relative, member in legacy["inputs"].items():
        expected_member = ("private.env" if relative == ".env" else
                           "configuration/" + relative if relative in snapshot.get("files", []) else "runtime-inputs/" + relative)
        require(member == expected_member, "LEGACY_BACKUP_INPUTS", "Recovered input paths differ from the supported layout.")
        expected = snapshot["inputs"][relative]
        actual = safe_member(backup, member)
        require(actual.is_file() and actual.stat().st_size == expected["bytes"] and file_hash(actual) == expected["sha256"],
                "LEGACY_BACKUP_INPUTS", "A recovered input differs from the plan.")
    require(_whole_inventory(backup / "objects") == legacy.get("objectFiles"),
            "LEGACY_BACKUP_OBJECTS", "Object inventory differs from the recovery manifest.")
    records = snapshot.get("containers", {})
    expected_images = sorted({record["imageId"] for record in records.values()})
    require(legacy.get("imageIds") == expected_images and manifest.get("runtime", {}).get("api") == snapshot.get("runtime", {}).get("api")
            and manifest.get("runtime", {}).get("web") == snapshot.get("runtime", {}).get("web"),
            "LEGACY_BACKUP_IMAGES", "Recovery provenance differs from the observed legacy runtime.")
    inspected = json.loads((backup / "configuration" / "container-inspect.json").read_text(encoding="utf-8"))
    require({record["Id"]: record["Image"] for record in inspected} == {record["id"]: record["imageId"] for record in records.values()},
            "LEGACY_BACKUP_IMAGES", "Preserved containers differ from their attested image IDs.")
    filesystems = legacy.get("runtimeFilesystems", {})
    require(set(filesystems) == {"api", "web"}, "LEGACY_BACKUP_FILESYSTEM", "Both writable legacy runtime filesystems must be preserved.")
    for name, saved in filesystems.items():
        require(saved.get("file") == f"runtime-filesystems/{name}.tar" and saved.get("containerId") == records[name]["id"]
                and saved.get("imageId") == records[name]["imageId"], "LEGACY_BACKUP_FILESYSTEM", "Runtime filesystem provenance changed.")
        archive_summary = verify_runtime_archive(backup / saved["file"])
        require(all(saved.get(key) == value for key, value in archive_summary.items()),
                "LEGACY_BACKUP_FILESYSTEM", "Runtime filesystem archive differs from its receipt.")
    verify_image_archive(backup / "runtime-images.tar", legacy.get("imageIds", []))
    return manifest, snapshot


class _RestoreInstallation:
    """Delegate the standard restore helper only to the attested PostgreSQL."""
    def __init__(self, install, snapshot):
        self._install, self._snapshot, self.env = install, snapshot, install.env

    def identity(self):
        self._install.revalidate(self._snapshot, allow_stopped=True)
        return self._install.identity()

    def compose(self, *args, **kwargs):
        require(len(args) >= 4 and args[:2] == ("exec", "-T"), "LEGACY_RESTORE_COMMAND", "Restore adapter only permits PostgreSQL exec.")
        offset = 2
        while offset < len(args) and args[offset] == "-e":
            offset += 2
        require(offset < len(args) and args[offset] == "postgres", "LEGACY_RESTORE_COMMAND", "Restore cannot target another service.")
        return self._install.compose(*args, **kwargs)


def _owned_sandbox(container, volume, token):
    if container:
        data = json.loads(run(["docker", "inspect", container], capture=True))[0]
        labels = data.get("Config", {}).get("Labels") or {}
        require(data.get("Id") == container and labels.get("asa.legacy.restore") == token
                and labels.get("asa.operation") == "legacy-restore-check", "LEGACY_RESTORE_OWNERSHIP", "Restore container ownership changed.")
    if volume:
        data = json.loads(run(["docker", "volume", "inspect", volume], capture=True))[0]
        labels = data.get("Labels") or {}
        require(data.get("Name") == volume and labels.get("asa.legacy.restore") == token
                and labels.get("asa.operation") == "legacy-restore-check", "LEGACY_RESTORE_OWNERSHIP", "Restore volume ownership changed.")


def _cleanup_sandbox(name, token, image):
    """Find only this operation's labelled objects, including a lost create reply."""
    filters = ["--filter", "label=asa.legacy.restore=" + token, "--filter", "label=asa.operation=legacy-restore-check"]
    containers = run(["docker", "ps", "-aq", "--no-trunc", *filters], capture=True).split()
    volumes = run(["docker", "volume", "ls", "-q", *filters], capture=True).split()
    require(len(containers) <= 1 and (not volumes or volumes == [name]),
            "LEGACY_RESTORE_OWNERSHIP", "Restore cleanup found an unexpected labelled object set.")
    if containers:
        container = containers[0]
        require(CONTAINER_ID.fullmatch(container), "LEGACY_RESTORE_OWNERSHIP", "Invalid restore container ID.")
        data = json.loads(run(["docker", "inspect", container], capture=True))[0]
        require(data.get("Name") == "/" + name and data.get("Image") == image,
                "LEGACY_RESTORE_OWNERSHIP", "Restore container name or image changed.")
        _owned_sandbox(container, volumes[0] if volumes else None, token)
        run(["docker", "rm", "--force", container], capture=True)
    elif volumes:
        _owned_sandbox(None, volumes[0], token)
    if volumes:
        run(["docker", "volume", "rm", volumes[0]], capture=True)
    require(not run(["docker", "ps", "-aq", "--no-trunc", *filters], capture=True)
            and not run(["docker", "volume", "ls", "-q", *filters], capture=True),
            "LEGACY_RESTORE_OWNERSHIP", "Isolated restore objects remain after cleanup.")


def _minio_ready(container):
    command = ('mc alias set recovered http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; '
               'mc ready recovered >/dev/null 2>&1; mc ls --json recovered')
    deadline = time.monotonic() + 45
    while True:
        try:
            value = run(["docker", "exec", container, "/bin/sh", "-eu", "-c", command], capture=True)
            rows = [json.loads(line) for line in value.splitlines() if line.strip()]
            require(all(row.get("status") == "success" for row in rows), "LEGACY_RESTORE_OBJECTS", "Restored object storage is unreadable.")
            return {"readable": True, "bucketCount": len(rows)}
        except (Blocked, ValueError):
            require(time.monotonic() < deadline, "LEGACY_RESTORE_OBJECTS", "Restored MinIO did not become readable.")
            time.sleep(1)


def _restore_objects(backup, snapshot, manifest, temporary, receipt, persist):
    token = uuid.uuid4().hex
    volume = "asa-legacy-restore-" + token
    name = volume
    container = None
    image = snapshot["containers"]["minio"]["imageId"]
    require(IMAGE_ID.fullmatch(image), "LEGACY_RESTORE_IMAGES", "MinIO restore requires the exact old image ID.")
    # Keys remain in a private env file, never in command-line arguments.
    from .contracts import read_env
    env = read_env(backup / "private.env")
    credentials = temporary / "object-restore.env"
    values = {"MINIO_ROOT_USER": env.get("ASA_OBJECT_STORAGE_ACCESS_KEY", ""),
              "MINIO_ROOT_PASSWORD": env.get("ASA_OBJECT_STORAGE_SECRET_KEY", ""), "MC_CONFIG_DIR": "/tmp/.mc"}
    require(all(value and "\n" not in value and "\r" not in value for value in values.values()),
            "LEGACY_RESTORE_CONFIGURATION", "MinIO recovery credentials are unavailable.")
    fd = os.open(credentials, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write("".join(f"{key}={value}\n" for key, value in values.items()))
    receipt["sandbox"] = {"token": token, "volume": volume, "containerName": name, "containerId": None, "cleanup": "pending"}
    persist()
    primary = None
    try:
        result = run(["docker", "volume", "create", "--label", "asa.operation=legacy-restore-check", "--label", "asa.legacy.restore=" + token, volume], capture=True)
        require(result == volume, "LEGACY_RESTORE_OWNERSHIP", "Unexpected isolated volume identity.")
        _owned_sandbox(None, volume, token)
        created = run(["docker", "create", "--name", name, "--network", "none", "--label", "asa.operation=legacy-restore-check",
                         "--label", "asa.legacy.restore=" + token, "--mount", f"type=volume,source={volume},target=/data",
                         "--env-file", str(credentials), "--user", "1000:1000", image,
                         "server", "/data", "--address", "127.0.0.1:9000", "--console-address", "127.0.0.1:9001"], capture=True)
        require(CONTAINER_ID.fullmatch(created), "LEGACY_RESTORE_OWNERSHIP", "Unexpected isolated container identity.")
        container = created
        receipt["sandbox"]["containerId"] = container
        persist()
        _owned_sandbox(container, volume, token)
        archive = temporary / "objects.tar"
        def owner(member):
            require(member.isfile() or member.isdir(), "LEGACY_RESTORE_OBJECTS", "Object recovery cannot contain links or special files.")
            member.uid = member.gid = 1000
            member.uname = member.gname = ""
            return member
        with tarfile.open(archive, "w") as stream:
            stream.add(backup / "objects", arcname=".", filter=owner)
        with archive.open("rb") as stream:
            run(["docker", "cp", "-a", "-", f"{container}:/data"], input_file=stream, capture=True)
        recovered = temporary / "readback"
        recovered.mkdir(mode=0o700)
        run(["docker", "cp", f"{container}:/data/.", str(recovered)], capture=True)
        require(_whole_inventory(recovered) == manifest["legacy"]["objectFiles"],
                "LEGACY_RESTORE_OBJECTS", "Restored physical object bytes differ from the complete backup.")
        run(["docker", "start", container], capture=True)
        health = _minio_ready(container)
        receipt["objectRecovery"] = {"status": "verified", "imageId": image, "files": len(manifest["legacy"]["objectFiles"]),
                                     "inventorySha256": _fingerprint(manifest["legacy"]["objectFiles"]), **health}
    except BaseException as exc:
        primary = exc
        raise
    finally:
        try:
            _cleanup_sandbox(name, token, image)
            receipt["sandbox"]["cleanup"] = "verified"
        except BaseException:
            receipt["sandbox"]["cleanup"] = "needs_recovery"
            persist()
            if primary is None:
                raise
        persist()


def verify_legacy_restore(install, backup, database, *, object_sandbox):
    """Restore into a new *_test DB and a labelled temporary object container.

    The test database remains for the caller's forward-migration rehearsal.
    Transition writers must remain quiescent after export(leave_stopped=True).
    No live database or object volume is restored, and no port is published.
    """
    require(object_sandbox is True, "LEGACY_RESTORE_AUTHORIZATION", "Isolated object restore requires explicit authorization.")
    require(isinstance(database, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,50}_test", database)
            and database != install.env.get("POSTGRES_DB"), "RESTORE_TARGET", "Recovery verification needs a new *_test database.")
    _plain(Path(backup))
    backup = Path(backup).resolve()
    _check_private(backup)
    manifest, snapshot = verify_legacy_backup(backup)
    _snapshot_contract(install, snapshot)
    install.revalidate(snapshot, allow_stopped=True)
    path = backup.parent / (backup.name + ".restore-" + uuid.uuid4().hex + ".json")
    require(not path.exists(), "LEGACY_RESTORE_RECEIPT", "Restore receipt already exists.")
    receipt = {"format": "asa-legacy-restore-v1", "status": "started", "startedAt": _now(),
               "backup": str(backup), "backupManifestSha256": file_hash(backup / "manifest.json"),
               "snapshotSha256": manifest["legacy"]["snapshotSha256"], "database": database,
               "databaseRecovery": "not_run", "objectRecovery": {"status": "not_run"}}
    def persist():
        atomic_json(path, receipt)
    persist()
    try:
        restore_check(_RestoreInstallation(install, snapshot), backup, database)
        receipt["databaseRecovery"] = "verified_acl_rls"
        persist()
        with tempfile.TemporaryDirectory(prefix=".asa-legacy-restore-", dir=backup.parent) as directory:
            temporary = Path(directory)
            _check_private(temporary)
            _restore_objects(backup, snapshot, manifest, temporary, receipt, persist)
        # This also proves that the temporary sandbox did not replace a live
        # store or remain among the neighbouring projects.
        install.revalidate(snapshot, allow_stopped=True)
        verify_legacy_backup(backup)
        receipt.update(status="verified", completedAt=_now(), liveRestore=False)
        persist()
    except BaseException as exc:
        receipt.update(status="failed", failedAt=_now(), failureCode=exc.code if isinstance(exc, Blocked) else type(exc).__name__)
        persist()
        raise
    return {**receipt, "receipt": str(path), "receiptSha256": file_hash(path)}
