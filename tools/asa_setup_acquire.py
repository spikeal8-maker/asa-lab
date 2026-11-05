#!/usr/bin/env python3
"""Acquire one published, attested ASA Setup revision without running the installer.

Authenticate this standalone release asset with GitHub CLI before running it as
an ordinary sudo-capable administrator. Never invoke an operator-writable copy
with sudo. Downloaded bundle code runs only after verification of a root-owned
snapshot against the exact repository, workflow, main ref and source revision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

REPOSITORY = "spikeal8-maker/asa-lab"
SIGNER_WORKFLOW = REPOSITORY + "/.github/workflows/setup-release.yml"
SOURCE_REF = "refs/heads/main"
BASE = Path("/opt/asa-setup")
MAX_BYTES = 32 * 1024 * 1024

# These are fixed stdlib operations supplied by the already authenticated helper,
# not a downloaded or operator-writable Python file passed to sudo. Snapshotting
# reads stdin, so root never opens an operator-selected download source path.
ROOT_COMMON = r'''
import hashlib, io, json, os, re, stat, sys, tarfile, tempfile
from pathlib import Path
BASE = Path('/opt/asa-setup')
MAX_BYTES = 32 * 1024 * 1024

def require(value, code):
    if not value:
        raise ValueError(code)

def trusted_directory(path):
    for ancestor in (path, *path.parents):
        metadata = ancestor.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0
                and metadata.st_mode & 0o022 == 0, 'ACQUIRE_UNSAFE_DIRECTORY')

def secure_read(path):
    trusted_directory(path.parent)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0
                and metadata.st_nlink == 1 and metadata.st_mode & 0o222 == 0,
                'ACQUIRE_UNSAFE_ARCHIVE')
        require(metadata.st_size <= MAX_BYTES, 'ACQUIRE_SIZE')
        data = stream.read(MAX_BYTES + 1)
        require(0 < len(data) <= MAX_BYTES, 'ACQUIRE_SIZE')
        return data

def snapshot(revision, data):
    require(os.geteuid() == 0, 'ACQUIRE_ROOT_REQUIRED')
    require(re.fullmatch(r'[a-f0-9]{40}', revision), 'ACQUIRE_REVISION')
    require(0 < len(data) <= MAX_BYTES, 'ACQUIRE_SIZE')
    trusted_directory(BASE.parent)
    try:
        BASE.mkdir(mode=0o755)
        BASE.chmod(0o755)
    except FileExistsError:
        pass
    trusted_directory(BASE)
    incoming = Path(tempfile.mkdtemp(prefix='acquire-', dir=BASE))
    incoming.chmod(0o755)
    archive = incoming / ('asa-setup-' + revision + '.tar.gz')
    descriptor = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), 0o444)
    incoming.chmod(0o555)
    require(secure_read(archive) == data, 'ACQUIRE_SNAPSHOT_CHANGED')
    return {'archive': str(archive), 'sha256': hashlib.sha256(data).hexdigest()}

def stage(archive_name, revision, expected_digest):
    require(os.geteuid() == 0, 'ACQUIRE_ROOT_REQUIRED')
    require(re.fullmatch(r'[a-f0-9]{40}', revision), 'ACQUIRE_REVISION')
    require(re.fullmatch(r'[a-f0-9]{64}', expected_digest), 'ACQUIRE_DIGEST')
    archive = Path(archive_name)
    require(archive.parent.parent == BASE
            and re.fullmatch(r'acquire-[a-z0-9_]{8}', archive.parent.name)
            and archive.name == 'asa-setup-' + revision + '.tar.gz', 'ACQUIRE_ARCHIVE_PATH')
    data = secure_read(archive)
    require(hashlib.sha256(data).hexdigest() == expected_digest, 'ACQUIRE_SNAPSHOT_CHANGED')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as package:
        members = [entry for entry in package.getmembers()
                   if entry.name == 'tools/deployment/setup_bundle.py']
        require(len(members) == 1 and members[0].isfile()
                and not members[0].pax_headers and 0 < members[0].size <= 4 * 1024 * 1024,
                'ACQUIRE_PACKAGER')
        stream = package.extractfile(members[0])
        require(stream is not None, 'ACQUIRE_PACKAGER')
        payload = stream.read(4 * 1024 * 1024 + 1)
        require(len(payload) == members[0].size, 'ACQUIRE_PACKAGER')
    # The parent has authenticated these protected bytes with gh before this
    # operation. The bundled packager then validates every path/hash/type and
    # refuses to overwrite any different or incomplete existing destination.
    namespace = {'__name__': 'asa_verified_setup_bundle', '__file__': str(archive)}
    exec(compile(payload, str(archive) + ':setup_bundle.py', 'exec'), namespace)
    destination = BASE / revision
    namespace['stage_archive'](archive, destination, revision=revision, sha256=expected_digest)
    return {'destination': str(destination), 'revision': revision, 'provenanceVerified': True}
'''
ROOT_RESULT = r'''
try:
    print(json.dumps(OPERATION))
except (ValueError, OSError, KeyError, tarfile.TarError) as error:
    code = str(error) if isinstance(error, ValueError) else 'ACQUIRE_PROTECTED_STAGE_FAILED'
    print(json.dumps({'code': code}), file=sys.stderr)
    raise SystemExit(2)
'''
ROOT_SNAPSHOT = ROOT_COMMON + ROOT_RESULT.replace(
    "OPERATION", "snapshot(sys.argv[1], sys.stdin.buffer.read(MAX_BYTES + 1))")
ROOT_STAGE = ROOT_COMMON + ROOT_RESULT.replace("OPERATION", "stage(*sys.argv[1:])")


class AcquisitionError(ValueError):
    """A failed boundary with an actionable, non-secret diagnostic code."""


def require(condition, code):
    if not condition:
        raise AcquisitionError(code)


def trusted_program(name):
    """Resolve once and execute only a system-owned program from safe parents."""
    discovered = shutil.which(name)
    require(discovered is not None, "ACQUIRE_PREREQUISITE_" + name.upper())
    path = Path(discovered).resolve(strict=True)
    for parent in path.parents:
        metadata = parent.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0
                and metadata.st_mode & 0o022 == 0, "ACQUIRE_UNTRUSTED_PROGRAM")
    metadata = path.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0
            and metadata.st_mode & 0o022 == 0, "ACQUIRE_UNTRUSTED_PROGRAM")
    return str(path)


def read_download(path):
    """Read unprivileged, with bounded memory and no symlink/hard-link inputs."""
    for ancestor in (path, *path.parents):
        require(not ancestor.is_symlink(), "ACQUIRE_DOWNLOAD_LINK")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1,
                "ACQUIRE_DOWNLOAD_FILE")
        require(metadata.st_size <= MAX_BYTES, "ACQUIRE_SIZE")
        data = stream.read(MAX_BYTES + 1)
        require(0 < len(data) <= MAX_BYTES, "ACQUIRE_SIZE")
        return data


def verify_command(gh, archive, revision):
    return [gh, "attestation", "verify", str(archive),
            "--repo", REPOSITORY, "--signer-workflow", SIGNER_WORKFLOW,
            "--source-ref", SOURCE_REF, "--source-digest", revision,
            "--deny-self-hosted-runners"]


def run(command, *, data=None):
    environment = dict(os.environ, GH_HOST="github.com")
    return subprocess.run(command, input=data, check=True, capture_output=True,
                          env=environment).stdout


def root_step(command, *, data=None):
    try:
        return json.loads(run(command, data=data))
    except subprocess.CalledProcessError as error:
        try:
            code = json.loads(error.stderr or b"{}").get("code", "")
        except (ValueError, AttributeError):
            code = ""
        if not isinstance(code, str) or not re.fullmatch(r"(?:ACQUIRE|BUNDLE)_[A-Z0-9_]+", code):
            code = "ACQUIRE_PROTECTED_STAGE_FAILED"
        raise AcquisitionError(code) from error


def acquire(revision):
    require(os.name == "posix" and sys.version_info >= (3, 11), "ACQUIRE_PLATFORM")
    require(os.geteuid() != 0, "ACQUIRE_RUN_AS_ADMIN_WITHOUT_SUDO")
    require(re.fullmatch(r"[a-f0-9]{40}", revision), "ACQUIRE_REVISION")
    gh = trusted_program("gh")
    sudo = trusted_program("sudo")
    python = trusted_program("/usr/bin/python3")
    with tempfile.TemporaryDirectory(prefix="asa-setup-download-") as directory:
        download = Path(directory) / f"asa-setup-{revision}.tar.gz"
        try:
            run([gh, "release", "download", "setup-" + revision, "--repo", REPOSITORY,
                 "--pattern", download.name, "--dir", directory])
        except subprocess.CalledProcessError as error:
            raise AcquisitionError("ACQUIRE_PUBLISHED_RELEASE_REQUIRED") from error
        data = read_download(download)
        # No downloaded program has run; sudo only stores a bounded byte string.
        snapshot = root_step([sudo, python, "-I", "-c", ROOT_SNAPSHOT, revision], data=data)
        archive = Path(snapshot["archive"])
        digest = hashlib.sha256(data).hexdigest()
        require(snapshot["sha256"] == digest and archive.parent.parent == BASE
                and re.fullmatch(r"acquire-[a-z0-9_]{8}", archive.parent.name)
                and archive.name == download.name, "ACQUIRE_SNAPSHOT_RESPONSE")
        try:
            run(verify_command(gh, archive, revision))
        except subprocess.CalledProcessError as error:
            raise AcquisitionError("ACQUIRE_ATTESTATION_REJECTED") from error
        # This is the first operation allowed to execute code from the archive.
        result = root_step([sudo, python, "-I", "-c", ROOT_STAGE, str(archive), revision, digest])
        require(result == {"destination": str(BASE / revision), "revision": revision,
                           "provenanceVerified": True}, "ACQUIRE_STAGE_RESPONSE")
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="Approved published setup release: full 40-character SHA")
    args = parser.parse_args(argv)
    try:
        result = acquire(args.revision)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, AcquisitionError) else "ACQUIRE_FAILED"
        print(json.dumps({"status": "BLOCKED", "code": code,
                          "action": "Check the published release/attestation, trusted gh/Python/sudo, protected /opt/asa-setup parents and existing target. Existing packages were not overwritten; no installer was started."}),
              file=sys.stderr)
        return 2
    print("Verified setup package: " + result["destination"])
    print("cd " + result["destination"])
    print("sudo bash ./asa-setup.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
