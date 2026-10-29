"""Build and inspect the attested, immutable ASA setup package.

This module verifies package structure and pinned source bytes. Authenticating the
download itself is a separate mandatory `gh attestation verify` step, before any
downloaded code is executed with privileges. A SHA256 file is not provenance.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import urllib.request
import uuid

REPOSITORY = "spikeal8-maker/asa-lab"
WORKFLOW = ".github/workflows/setup-release.yml"
OPS_REPOSITORY = "spikeal8-maker/Server-setings"
OPS_REVISION = "88f3f76144d8b499fe70a3c9beccba16c80e0856"
FORMAT = "asa-setup-bundle-v1"
MANIFEST = "setup-bundle.json"
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_PACKAGE_BYTES = 32 * 1024 * 1024
REQUIRED = {"asa-setup.sh", "tools/asa_setup.py", "tools/asa_setup_launcher.py",
            "tools/asa_manager.py", "tools/deployment/__init__.py"}


def ensure(condition, code):
    if not condition:
        raise ValueError(code)


def safe_name(value):
    ensure(isinstance(value, str) and value and "\\" not in value
           and re.fullmatch(r"[A-Za-z0-9_./-]+", value), "BUNDLE_PATH")
    path = PurePosixPath(value)
    ensure(not path.is_absolute() and all(p not in ("", ".", "..") for p in value.split("/"))
           and str(path) == value, "BUNDLE_PATH")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def plain_bytes(path, limit=MAX_FILE_BYTES):
    """Read one descriptor; no check-then-reopen and no symbolic/hard links."""
    path = Path(path)
    for ancestor in (path, *path.parents):
        metadata = ancestor.lstat()
        ensure(not stat.S_ISLNK(metadata.st_mode), "BUNDLE_LINK")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        ensure(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1, "BUNDLE_FILE")
        ensure(metadata.st_size <= limit, "BUNDLE_SIZE")
        data = stream.read(limit + 1)
        ensure(len(data) <= limit, "BUNDLE_SIZE")
        return data


def ops_files(root, ops_root=None):
    pin = json.loads(plain_bytes(Path(root) / "tools/deployment/setup_ops_manifest.json"))
    ensure(pin.get("repository") == OPS_REPOSITORY and pin.get("revision") == OPS_REVISION,
           "BUNDLE_OPS_PROVENANCE")
    rows = pin.get("files")
    ensure(isinstance(rows, list) and len(rows) == 3, "BUNDLE_OPS_FILES")
    result = {}
    expected = {"scripts/asa_ops/browser_acceptance.py", "scripts/asa_ops/acceptance_fixture.py",
                "scripts/cloud_storage.py"}
    ensure({row.get("path") for row in rows} == expected, "BUNDLE_OPS_FILES")
    for row in rows:
        source = safe_name(row["path"])
        target = safe_name(row["packagedPath"])
        ensure(target.startswith("tools/deployment/ops/") and target not in result, "BUNDLE_OPS_PATH")
        ensure(re.fullmatch(r"[a-f0-9]{64}", row.get("sha256", "")), "BUNDLE_OPS_HASH")
        if ops_root is not None:
            data = plain_bytes(Path(ops_root) / source)
        else:
            url = f"https://raw.githubusercontent.com/{OPS_REPOSITORY}/{OPS_REVISION}/{source}"
            request = urllib.request.Request(url, headers={"User-Agent": "asa-setup-bundle"})
            with urllib.request.urlopen(request, timeout=30) as response:
                ensure(response.geturl() == url, "BUNDLE_OPS_REDIRECT")
                data = response.read(MAX_FILE_BYTES + 1)
                ensure(len(data) <= MAX_FILE_BYTES, "BUNDLE_SIZE")
        ensure(digest(data) == row["sha256"], "BUNDLE_OPS_HASH")
        result[target] = data
    return result


def collect_files(root, ops_root=None):
    root = Path(root)
    paths = sorted(REQUIRED | {"tools/log_collector.py", "tools/owner-admin.py", "tools/platform-admin.mjs",
                               "tools/deployment/setup_ops_manifest.json"})
    deployment = root / "tools/deployment"
    paths += [str(p.relative_to(root)).replace(os.sep, "/")
              for p in sorted(deployment.glob("*.py"))
              if not p.name.startswith(("test_", "ci_"))]
    files = {safe_name(path): plain_bytes(root / path) for path in sorted(set(paths))}
    for name, data in ops_files(root, ops_root).items():
        ensure(name not in files, "BUNDLE_DUPLICATE")
        files[name] = data
    ensure(sum(map(len, files.values())) <= MAX_PACKAGE_BYTES, "BUNDLE_SIZE")
    return files


def make_archive(files, revision):
    ensure(isinstance(revision, str) and re.fullmatch(r"[a-f0-9]{40}", revision), "BUNDLE_REVISION")
    ensure(REQUIRED <= set(files) and MANIFEST not in files, "BUNDLE_REQUIRED_FILES")
    for name, data in files.items():
        safe_name(name)
        ensure(isinstance(data, bytes) and len(data) <= MAX_FILE_BYTES, "BUNDLE_SIZE")
    ensure(sum(map(len, files.values())) <= MAX_PACKAGE_BYTES, "BUNDLE_SIZE")
    manifest = {"format": FORMAT, "revision": revision, "opsRevision": OPS_REVISION,
                "origin": {"repository": REPOSITORY, "workflow": WORKFLOW},
                "files": {name: digest(data) for name, data in sorted(files.items())}}
    content = {**files, MANIFEST: (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()}
    memory = io.BytesIO()
    with gzip.GzipFile(fileobj=memory, filename="", mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, data in sorted(content.items()):
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = 0o755 if name.endswith(".sh") else 0o644
                member.uid = member.gid = member.mtime = 0
                archive.addfile(member, io.BytesIO(data))
    return memory.getvalue(), manifest


def attest_source(root, files, revision):
    """A revision label must describe the bytes actually placed in the package."""
    for name, data in files.items():
        if name.startswith("tools/deployment/ops/"):
            continue  # Separately pinned and hashed Server-setings inputs.
        source = subprocess.run(["git", "show", revision + ":" + safe_name(name)],
                                cwd=root, check=True, capture_output=True).stdout
        ensure(source == data, "BUNDLE_SOURCE_DRIFT")


def inspect_archive(data, *, revision=None, sha256=None):
    ensure(isinstance(data, bytes) and len(data) <= MAX_PACKAGE_BYTES, "BUNDLE_SIZE")
    if sha256 is not None:
        ensure(re.fullmatch(r"[a-f0-9]{64}", sha256) and digest(data) == sha256, "BUNDLE_DIGEST")
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            name = safe_name(member.name)
            ensure(len(files) < 1024 and name not in files, "BUNDLE_DUPLICATE")
            ensure(member.isfile() and not member.issym() and not member.islnk()
                   and member.mode in (0o644, 0o755) and not member.pax_headers,
                   "BUNDLE_MEMBER_TYPE")
            ensure(0 <= member.size <= MAX_FILE_BYTES, "BUNDLE_SIZE")
            total += member.size
            ensure(total <= MAX_PACKAGE_BYTES, "BUNDLE_SIZE")
            source = archive.extractfile(member)
            ensure(source is not None, "BUNDLE_MEMBER_TYPE")
            payload = source.read(MAX_FILE_BYTES + 1)
            ensure(len(payload) == member.size, "BUNDLE_SIZE")
            files[name] = payload
    ensure(MANIFEST in files, "BUNDLE_MANIFEST")
    manifest = json.loads(files.pop(MANIFEST))
    ensure(set(manifest) == {"format", "revision", "opsRevision", "origin", "files"}
           and manifest["format"] == FORMAT
           and manifest["opsRevision"] == OPS_REVISION
           and manifest["origin"] == {"repository": REPOSITORY, "workflow": WORKFLOW}, "BUNDLE_PROVENANCE")
    ensure(isinstance(manifest["revision"], str)
           and re.fullmatch(r"[a-f0-9]{40}", manifest["revision"]), "BUNDLE_REVISION")
    ensure(revision is None or manifest["revision"] == revision, "BUNDLE_REVISION")
    ensure(isinstance(manifest["files"], dict) and set(manifest["files"]) == set(files)
           and REQUIRED <= set(files), "BUNDLE_REQUIRED_FILES")
    ensure(all(digest(data) == manifest["files"][name] for name, data in files.items()), "BUNDLE_HASH")
    return manifest, files


def stage_archive(archive, destination, *, revision, sha256):
    """Stage already attestation-verified bytes; this does not authenticate them.

    A failed/interrupted target is deliberately retained as an incomplete package.
    Reuse requires verifying every byte, so a partial extraction cannot execute.
    """
    data = plain_bytes(archive, MAX_PACKAGE_BYTES)
    manifest, files = inspect_archive(data, revision=revision, sha256=sha256)
    destination = Path(destination)
    ensure(destination.is_absolute() and destination.name == revision, "BUNDLE_DESTINATION")
    parent = destination.parent
    for directory in (parent, *parent.parents):
        metadata = directory.lstat()
        ensure(stat.S_ISDIR(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode)
               and (os.name == "nt" or metadata.st_uid == os.geteuid()
                    and metadata.st_mode & 0o022 == 0), "BUNDLE_PARENT")
    if destination.exists():
        ensure(destination.is_dir() and not destination.is_symlink(), "BUNDLE_DESTINATION")
        for path in (destination, *destination.rglob("*")):
            metadata = path.lstat()
            ensure(not stat.S_ISLNK(metadata.st_mode)
                   and (os.name == "nt" or metadata.st_uid == os.geteuid()
                        and metadata.st_mode & 0o022 == 0), "BUNDLE_EXISTING_PERMISSIONS")
        expected = set(files) | {MANIFEST}
        actual = {str(path.relative_to(destination)).replace(os.sep, "/")
                  for path in destination.rglob("*") if not path.is_dir()}
        ensure(actual == expected, "BUNDLE_INCOMPLETE")
        for name, payload in files.items():
            ensure(plain_bytes(destination / name) == payload, "BUNDLE_EXISTING_MISMATCH")
        ensure(json.loads(plain_bytes(destination / MANIFEST)) == manifest, "BUNDLE_EXISTING_MISMATCH")
        return destination
    destination.mkdir(mode=0o755)
    destination.chmod(0o755)
    for name, payload in sorted(files.items()):
        target = destination / name
        ancestor = destination
        for part in PurePosixPath(name).parts[:-1]:
            ancestor = ancestor / part
            if not ancestor.exists():
                ancestor.mkdir(mode=0o755)
                ancestor.chmod(0o755)
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                             0o755 if name.endswith(".sh") else 0o644)
        with os.fdopen(descriptor, "wb") as stream:
            if os.name != "nt":
                os.fchmod(stream.fileno(), 0o755 if name.endswith(".sh") else 0o644)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    encoded = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
    descriptor = os.open(destination / MANIFEST, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "wb") as stream:
        if os.name != "nt":
            os.fchmod(stream.fileno(), 0o644)
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("build", "inspect", "stage"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--ops-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--sha256")
    args = parser.parse_args(argv)
    try:
        ensure(re.fullmatch(r"[a-f0-9]{40}", args.revision), "BUNDLE_REVISION")
        if args.action == "build":
            ensure(args.output is not None, "BUNDLE_OUTPUT")
            current = subprocess.run(["git", "rev-parse", "HEAD"], cwd=args.root, check=True,
                                     capture_output=True, text=True).stdout.strip()
            ensure(current == args.revision, "BUNDLE_SOURCE_REVISION")
            files = collect_files(args.root, args.ops_root)
            attest_source(args.root, files, args.revision)
            data, manifest = make_archive(files, args.revision)
            inspect_archive(data, revision=args.revision)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            ensure(not args.output.exists(), "BUNDLE_OUTPUT_EXISTS")
            temporary = args.output.with_name(args.output.name + ".partial-" + uuid.uuid4().hex)
            temporary.write_bytes(data)
            os.link(temporary, args.output)
            temporary.unlink()
            print(json.dumps({"format": FORMAT, "revision": args.revision,
                              "sha256": digest(data), "files": len(manifest["files"]),
                              "artifact": str(args.output), "attested": False}))
        else:
            ensure(args.archive is not None, "BUNDLE_ARCHIVE")
            if args.action == "stage":
                ensure(args.destination is not None and args.sha256, "BUNDLE_STAGE_ARGUMENTS")
                stage_archive(args.archive, args.destination, revision=args.revision, sha256=args.sha256)
            manifest, _ = inspect_archive(plain_bytes(args.archive, MAX_PACKAGE_BYTES),
                                          revision=args.revision, sha256=args.sha256)
            print(json.dumps({"format": FORMAT, "revision": manifest["revision"],
                              "files": len(manifest["files"]), "integrityVerified": True,
                              "provenanceVerified": False}))
        return 0
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, tarfile.TarError):
        print(json.dumps({"status": "BLOCKED", "code": "SETUP_BUNDLE_REJECTED",
                          "action": "Use the complete artifact and verify its GitHub attestation before privileged execution."}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
