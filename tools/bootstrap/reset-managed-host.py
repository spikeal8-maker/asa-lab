#!/usr/bin/env python3
"""Wipe ONLY an explicitly identified ASA/1Panel test installation on Ubuntu.

Keeps Ubuntu, SSH, Tailscale, systemd, networking, local users and off-host
backups. Intended solely to rehearse a true blank-app rebuild.
"""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys

EXPECTED_ROOT = Path("/srv/asa-lab-test")
ARCHIVE = Path("/srv/asa-test-restore/asa-lab-20261016T231505Z-7b457013.tar.age")
FILES_TO_REMOVE = (
    Path("/etc/systemd/system/asa-lab-lan-4610.socket"),
    Path("/etc/systemd/system/asa-lab-lan-4610.service"),
    Path("/home/admins/.config/systemd/user/asa-log-collector-asa-lab-dev.service"),
)
DIRS_TO_REMOVE = (
    Path("/srv/asa-lab-test"),
    Path("/srv/asa-test-restore"),
    Path("/var/backups/asa-preclean-20261017"),
    Path("/var/backups/asa-test-cutover-20261017"),
    Path("/var/backups/asa-panel-firewall"),
    Path("/var/cache/asa-panel-installer"),
    Path("/var/cache/asa-server-rebuild"),
    Path("/var/log/asa-server-rebuild"),
    Path("/var/lib/asa-server-rebuild"),
    Path("/root/asa-panel"),
    Path("/var/lib/docker"),
    Path("/var/lib/containerd"),
    Path("/etc/docker"),
)
DOCKER_PKGS = (
    "docker-ce", "docker-ce-cli", "docker-buildx-plugin",
    "docker-compose-plugin", "containerd.io",
)

class Refused(Exception):
    pass

def require(value, reason):
    if not value:
        raise Refused(reason)

def run(*args, input_text=None, timeout=140, check=True):
    result = subprocess.run(args, input=input_text, text=True, capture_output=True,
                            timeout=timeout, check=False, env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"})
    if check and result.returncode:
        raise Refused(f"{args[0]} failed ({result.returncode}): {result.stderr[-350:]}")
    return result

def allowlist_matches(text, pattern, label):
    for name in text.splitlines():
        name = name.strip()
        require(not name or bool(re.fullmatch(pattern, name)),
                f"Unrelated {label} detected: {name}; refusing whole-host clean")

def verify(args):
    require(sys.platform == "linux" and os.geteuid() == 0, "Ubuntu root required")
    require(socket.gethostname() == args.hostname, "Host identity mismatch")
    require(Path("/etc/os-release").read_text().find("VERSION_ID=\"24.04\"") >= 0,
            "Expected Ubuntu 24.04")
    require(args.hostname != "leticia" and args.hostname != "desktop-i07qije",
            "Protected host")
    require(Path("/usr/sbin/sshd").exists(), "SSH must be preserved")
    require(run("systemctl", "is-active", "ssh").stdout.strip() == "active",
            "SSH is not active")
    require(run("systemctl", "is-active", "tailscaled").stdout.strip() == "active",
            "Tailscale is not active")
    require(run("systemctl", "is-active", "ufw").stdout.strip() == "active",
            "UFW is not active")
    require(EXPECTED_ROOT.is_dir() and not EXPECTED_ROOT.is_symlink(),
            "Exact ASA worktree not present")
    require(ARCHIVE.is_file() and not ARCHIVE.is_symlink(),
            "Verified encrypted backup is not on this host")
    require(re.fullmatch(r"[a-f0-9]{64}", args.snapshot_sha256 or ""),
            "Require exact off-host backup SHA256")
    digest = hashlib.file_digest(ARCHIVE.open("rb"), "sha256").hexdigest()
    require(digest == args.snapshot_sha256, "Snapshot checksum differs")
    require(args.offhost_copy_verified,
            "Check the same archive and age identity on Windows/Yandex Disk first")
    require(run("docker", "compose", "ls", "--format", "json").returncode == 0,
            "Docker Compose must be inspectable before removal")
    allowlist_matches(run("docker", "ps", "-a", "--format", "{{.Names}}").stdout,
                      r"asa-lab-dev-[a-z0-9-]+", "container")
    allowlist_matches(run("docker", "volume", "ls", "--format", "{{.Name}}").stdout,
                      r"(asa-lab-dev_[a-z0-9_-]+|asa-minio-restore-candidate-[a-z0-9_-]+)",
                      "Docker volume")
    require(Path("/opt/1panel").exists() and Path("/usr/local/bin/1pctl").is_file(),
            "Expected managed 1Panel installation")
    return digest

def remove_path(path):
    require(path.is_absolute() and not path.is_symlink(), f"Unsafe path: {path}")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()

def execute(args):
    require(args.confirm == f"ERASE:{args.hostname}", "Explicit ERASE:hostname attestation required")
    print("ERASE_SCOPE: ASA Lab, all its data/backup directories, Docker Engine and 1Panel.", flush=True)
    print("PRESERVE_SCOPE: Ubuntu, SSH, Tailscale, systemd, UFW default policy and other users.", flush=True)
    print("STOP_ASA_USER_COLLECTOR", flush=True)
    uid = run("id", "-u", "admins").stdout.strip()
    run("runuser", "-u", "admins", "--", "env", f"XDG_RUNTIME_DIR=/run/user/{uid}",
        "systemctl", "--user", "disable", "--now", "asa-log-collector-asa-lab-dev.service",
        check=False)
    run("systemctl", "disable", "--now", "asa-lab-lan-4610.socket", check=False)
    run("systemctl", "stop", "asa-lab-lan-4610.service", check=False)
    for path in FILES_TO_REMOVE:
        if path.exists(): remove_path(path)
    run("systemctl", "daemon-reload")
    print("STOP_AND_DELETE_ALL_ASA_CONTAINERS_AND_VOLUMES", flush=True)
    sys.path.insert(0, str(EXPECTED_ROOT / "tools"))
    from deployment.system import Installation
    app = Installation(EXPECTED_ROOT, "staging")
    app.identity()
    app.compose("down", "--volumes", "--remove-orphans")
    extra = run("docker", "volume", "ls", "--format", "{{.Name}}").stdout.splitlines()
    for volume in extra:
        if volume.startswith("asa-minio-restore-candidate-"):
            run("docker", "volume", "rm", volume)
    run("docker", "system", "prune", "-a", "--volumes", "-f")
    require(not run("docker", "ps", "-aq").stdout.strip(), "Containers remain")
    require(not run("docker", "volume", "ls", "-q").stdout.strip(), "Docker volumes remain")
    print("UNINSTALL_1PANEL_USING_OFFICIAL_CLI", flush=True)
    uninstall = run("/usr/local/bin/1pctl", "uninstall", input_text="y\ny\n", timeout=140)
    require(not Path("/opt/1panel").exists(), "1Panel data remained after uninstall")
    print("REMOVE_APPLICATION_FIREWALL_EXCEPT_SSH", flush=True)
    cidr = "192.168.1.0/24"
    run("ufw", "--force", "delete", "allow", "in", "on", "eno1",
        "from", cidr, "to", "192.168.1.115", "port", "4610", "proto", "tcp", check=False)
    run("ufw", "--force", "delete", "allow", "from", cidr, "to", "any",
        "port", "19192", "proto", "tcp", check=False)
    run("ufw", "--force", "delete", "allow", "in", "on", "tailscale0",
        "to", "any", "port", "19192", "proto", "tcp", check=False)
    print("PURGE_DOCKER_PACKAGES", flush=True)
    run("apt-get", "-y", "purge", *DOCKER_PKGS, timeout=140)
    run("systemctl", "daemon-reload")
    print("REMOVE_ONLY_EXPLICIT_APP_PATHS", flush=True)
    for path in DIRS_TO_REMOVE:
        if path.exists(): remove_path(path)
    run("loginctl", "disable-linger", "admins", check=False)
    for path in (Path("/etc/apt/sources.list.d/docker.sources"),
                 Path("/etc/apt/keyrings/docker.asc")):
        if path.is_file(): path.unlink()
    require(run("systemctl", "is-active", "ssh").stdout.strip() == "active",
            "SSH became inactive")
    require(run("systemctl", "is-active", "tailscaled").stdout.strip() == "active",
            "Tailscale became inactive")
    require(run("systemctl", "is-active", "ufw").stdout.strip() == "active",
            "UFW became inactive")
    require(not EXPECTED_ROOT.exists() and not Path("/opt/1panel").exists(),
            "Some application state still exists")
    require(not Path("/var/lib/docker").exists(), "Docker state remains")
    print("CLEAN_UBUNTU_APPLICATION_BASELINE_PASS", flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--hostname", required=True)
    p.add_argument("--snapshot-sha256", required=True)
    p.add_argument("--offhost-copy-verified", action="store_true")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--confirm")
    a = p.parse_args()
    try:
        digest = verify(a)
        print("PREFLIGHT_PASS hostname="+a.hostname+" offhost_backup_sha256="+digest, flush=True)
        if a.execute: execute(a)
        else: print("DRY_RUN_PASS: no files/services were changed.", flush=True)
        return 0
    except (Refused, OSError, subprocess.TimeoutExpired, ValueError) as e:
        print("BLOCKED:", str(e), file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
