#!/usr/bin/env python3
"""Verify the newest ASA Lab Yandex archive and stream its decrypted tar over SSH.

The age identity stays on Windows. The SSH host key must already be trusted.
The destination is a private staging directory; no live database is replaced.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import ipaddress
import re
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("asa_prepare_age", HERE / "prepare-age-backup.py")
assert spec and spec.loader
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def validate_remote(user: str, host: str, directory: str):
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", user):
        raise ValueError("Invalid SSH user")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host):
            raise ValueError("Invalid SSH host")
    target = PurePosixPath(directory)
    if (not target.is_absolute() or ".." in target.parts
            or not re.fullmatch(r"/srv/[A-Za-z0-9_/-]{1,180}", str(target))):
        raise ValueError("Staging directory must be an absolute, private /srv/... path")
    return target


def command_base(args):
    ssh = shutil.which("ssh")
    if not ssh or not args.ssh_key.is_file():
        raise FileNotFoundError("OpenSSH client or configured private SSH key missing")
    return [ssh, "-T", "-i", str(args.ssh_key), "-p", str(args.port),
            "-o", "BatchMode=yes", "-o", "PasswordAuthentication=no",
            "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
            f"{args.user}@{args.host}"]


def remote_run(base, command: str) -> str:
    proc = subprocess.run([*base, command], text=True, capture_output=True, timeout=35)
    if proc.returncode:
        raise RuntimeError("SSH operation failed: "+proc.stderr.strip()[:150])
    return proc.stdout.strip()


def transfer(args):
    directory = validate_remote(args.user, args.host, args.remote_dir)
    source = (args.archive or prepare.find_latest(
        args.yandex_folder or prepare.yandex_sync_directory())).resolve()
    verification = prepare.verify_or_extract(argparse.Namespace(
        archive=source, yandex_folder=args.yandex_folder,
        age=args.age, identity=args.identity, extract=False, output=None))
    snapshot = verification["snapshot"]
    if not re.fullmatch(r"\d{8}T\d{6}Z-[0-9a-f]{8}", str(snapshot)):
        raise ValueError("Invalid verified snapshot identifier")
    ssh = command_base(args)
    if remote_run(ssh, "hostname") != args.expected_hostname:
        raise ValueError("Wrong target server")
    if remote_run(ssh, f"test -d {directory} && test -w {directory} && stat -c %a {directory}") != "700":
        raise ValueError("Staging directory must already exist, be writable and have mode 0700")
    final = f"{directory}/{snapshot}.tar"
    temp = f"{final}.partial-{secrets.token_hex(8)}"
    remote_run(ssh, f"test ! -e {final} && test ! -e {temp}")
    print("BEGIN_AGE_OVER_SSH", flush=True)
    age = subprocess.Popen([str(args.age), "-d", "-i", str(args.identity), str(source)],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1048576)
    upload = subprocess.Popen([*ssh, f"umask 077; set -C; cat > {temp}"],
                              stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE, bufsize=1048576)
    digest = hashlib.sha256()
    size = 0
    try:
        while True:
            buf = age.stdout.read(1048576)
            if not buf:
                break
            digest.update(buf)
            size += len(buf)
            upload.stdin.write(buf)
        upload.stdin.close()
        age.stdout.close()
        age_rc = age.wait(timeout=90)
        ssh_rc = upload.wait(timeout=90)
        if age_rc or ssh_rc or size == 0:
            raise RuntimeError(f"Transfer process failed: age={age_rc} ssh={ssh_rc}")
        sha = remote_run(ssh, f"sha256sum {temp}").split()[0]
        if sha != digest.hexdigest():
            raise RuntimeError("Transferred tar does not match local SHA256")
        remote_run(ssh, f"test ! -e {final} && mv --no-clobber {temp} {final} && chmod 600 {final}")
        if remote_run(ssh, f"sha256sum {final}").split()[0] != digest.hexdigest():
            raise RuntimeError("Final tar checksum differs")
        print("TRANSFERRED_VERIFIED_BYTES", size)
        print("STAGED_ON_PRIVATE_SERVER", final)
        print("AGE_KEY_REMAINS_ON_WINDOWS; ACTIVE_DATABASE_UNCHANGED")
        return 0
    except BaseException:
        if age.poll() is None:
            age.kill()
        if upload.poll() is None:
            upload.kill()
        try:
            age.wait(timeout=5)
            upload.wait(timeout=5)
        except Exception:
            pass
        try:
            remote_run(ssh, f"rm -f {temp}")
        except Exception:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--expected-hostname", required=True)
    parser.add_argument("--ssh-key", required=True, type=Path)
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--remote-dir", default="/srv/asa-test-restore")
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--yandex-folder", type=Path)
    parser.add_argument("--age", type=Path, default=prepare.AGE_DEFAULT)
    parser.add_argument("--identity", type=Path, default=prepare.IDENTITY_DEFAULT)
    args = parser.parse_args()
    try:
        return transfer(args)
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print("BLOCKED:", error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
