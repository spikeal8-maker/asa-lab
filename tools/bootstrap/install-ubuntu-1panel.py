#!/usr/bin/env python3
"""ASA Lab: reproducible Ubuntu/1Panel OSS bootstrap and recovery checks.

Tested target: Ubuntu 24.04.4 / Docker 29.6.2 / 1Panel OSS 2.3.2.
This tool NEVER deletes an existing ASA database and NEVER imports a backup into
an active database. Live-data cutover requires a separate verified procedure.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REPO = "https://github.com/spikeal8-maker/asa-lab.git"
PANEL_VER = "v2.3.2"
PANEL_ARCHIVE_NAME = f"1panel-{PANEL_VER}-linux-amd64.tar.gz"
PANEL_SHA256 = "f1265a4fadeaab3d7066dd71e3c6904ac54bb687baab1b205a23c369abb61cac"
PANEL_URL = f"https://resource.1panel.pro/v2/stable/{PANEL_VER}/release/{PANEL_ARCHIVE_NAME}"
LOG_DIR = Path("/var/log/asa-server-rebuild")
LOCK_FILE = Path("/var/lock/asa-server-rebuild.lock")


class Blocked(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Blocked(message)


def run(*parts: str, check=True, as_user: str | None = None, capture=False, cwd: Path | None = None):
    argv = [str(p) for p in parts]
    if as_user and os.geteuid() == 0:
        argv = ["runuser", "-u", as_user, "--", *argv]
    response = subprocess.run(argv, check=False, cwd=cwd, text=True,
                              stdout=subprocess.PIPE if capture else None,
                              stderr=subprocess.PIPE if capture else None)
    if check and response.returncode:
        reason = response.stderr.strip()[:400] if capture and response.stderr else ""
        raise Blocked(f"Command failed [{response.returncode}]: {argv[0]} {argv[1] if len(argv)>1 else ''} {reason}")
    return response.stdout.strip() if capture else response.returncode


def record(event: str, **data) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    report = LOG_DIR / "events.jsonl"
    with report.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"when": dt.datetime.now(dt.timezone.utc).isoformat(),
                                 "event": event, **data}, ensure_ascii=False) + "\n")
    os.chmod(report, 0o600)
    print(f"[{event}] {json.dumps(data, ensure_ascii=False)}", flush=True)


@contextmanager
def exclusive():
    with LOCK_FILE.open("a+b") as stream:
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise Blocked("Another ASA setup/recovery process is already running") from exc
        yield


def preflight(args):
    require(sys.platform == "linux", "Ubuntu Linux is required")
    require(os.geteuid() == 0, "Run with sudo/root; the script handles the operator account")
    require(Path("/etc/os-release").exists(), "Cannot identify operating system")
    distro = Path("/etc/os-release").read_text()
    require('ID=ubuntu' in distro and 'VERSION_ID="24.04"' in distro, "Supported: Ubuntu 24.04 LTS")
    require(run("uname", "-m", capture=True) == "x86_64", "A 64-bit x86 host is required")
    try:
        pwd.getpwnam(args.operator)
    except KeyError as exc:
        raise Blocked(f"Operator account {args.operator!r} does not exist") from exc
    require(shutil.disk_usage("/").free > 16 * 1024**3, "Need >=16 GiB free disk for image and backups")
    packages=[]
    if shutil.which("git") is None: packages.append("git")
    if shutil.which("curl") is None: packages.append("curl")
    if shutil.which("ufw") is None: packages.append("ufw")
    if shutil.which("docker") is None:
        packages.extend(["docker.io", "docker-compose-v2"])
    if packages:
        record("INSTALL_BASE_DEPENDENCIES", packages=packages)
        run("apt-get", "update")
        run("apt-get", "install", "-y", "--no-install-recommends", *packages)
        if "docker.io" in packages:
            run("usermod", "-aG", "docker", args.operator)
    if run("docker", "compose", "version", check=False, capture=False) != 0:
        # Do not modify an existing Docker installation without an explicit operator fix.
        raise Blocked("Existing Docker lacks Compose v2; configure Compose without replacing Docker")
    run("systemctl", "enable", "--now", "docker")
    require(run("docker", "info", check=False, capture=False) == 0, "Docker daemon is not running")
    require(run("docker", "info", as_user=args.operator, check=False) == 0,
            "Operator must have Docker access (group docker); log in again after adding the group")
    record("PREFLIGHT_PASS", user=args.operator, root=str(args.root), profile=args.profile)


def download_verified_panel(target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == PANEL_SHA256:
        record("PANEL_PACKAGE_REUSED", path=str(target))
        return
    tmp = target.with_suffix(".part")
    if tmp.exists():
        tmp.unlink()
    # Bounded download. Do not run partially downloaded installers.
    try:
        run("curl", "--proto", "=https", "--tlsv1.2", "--fail", "--location",
            "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "150",
            "--speed-time", "20", "--speed-limit", "1024", "-o", str(tmp), PANEL_URL)
    except Blocked as exc:
        raise Blocked("Official 1Panel download failed. Transfer the official archive "
                      f"{PANEL_ARCHIVE_NAME} from a trusted workstation to {target} and retry; "
                      "it will still be SHA-256 verified") from exc
    require(hashlib.sha256(tmp.read_bytes()).hexdigest() == PANEL_SHA256,
            "1Panel official archive SHA-256 mismatch")
    tmp.replace(target)
    os.chmod(target, 0o600)
    record("PANEL_PACKAGE_VERIFIED", sha256=PANEL_SHA256)


def panel_present():
    return shutil.which("1pctl") is not None and Path("/opt/1panel/db/agent.db").exists()


def panel_install(args):
    if panel_present():
        record("PANEL_ALREADY_INSTALLED", version=run("1pctl", "version", capture=True)[-160:])
        return
    require(args.panel_port not in (22, 80, 443, 4610, 4611, 4613), "Panel port conflicts with reserved ASA ports")
    require(not Path("/opt/1panel").exists(), "A partial 1Panel installation exists; inspect it first")
    path = Path("/var/cache/asa-server-rebuild") / PANEL_ARCHIVE_NAME
    if args.panel_archive is not None:
        media = args.panel_archive.resolve()
        require(media.is_file() and media.stat().st_size > 60_000_000,
                "Offline 1Panel installation media missing or incomplete")
        require(hashlib.sha256(media.read_bytes()).hexdigest() == PANEL_SHA256,
                "Offline 1Panel archive does not match official pinned SHA-256")
        path.parent.mkdir(parents=True, exist_ok=True)
        if media != path:
            shutil.copyfile(media, path)
            os.chmod(path, 0o600)
        record("OFFLINE_PANEL_MEDIA_VERIFIED", sha256=PANEL_SHA256)
    download_verified_panel(path)
    with tempfile.TemporaryDirectory(prefix="asa-1panel-") as tmpstr:
        temp = Path(tmpstr)
        with tarfile.open(path, "r:gz") as tar:
            for entry in tar.getmembers():
                normalized = (temp / entry.name).resolve()
                require(normalized.is_relative_to(temp) and not entry.issym() and not entry.islnk(),
                        "Invalid path/link in installer archive")
            tar.extractall(temp, filter="data")
        installer = temp / PANEL_ARCHIVE_NAME.removesuffix(".tar.gz") / "install.sh"
        require(installer.is_file(), "Installer script missing from verified archive")
        (installer.parent / ".selected_edition").write_text("intl\n", encoding="ascii")
        install_log = LOG_DIR / "1panel-install.log"
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ)
        secure_username = "asaadmin"
        secure_password = secrets.token_hex(14)
        secure_entrance = "access_" + secrets.token_hex(10)
        credentials = LOG_DIR / "1panel-initial-credentials.env"
        with credentials.open("x", encoding="utf-8") as stream:
            os.chmod(credentials, 0o600)
            stream.write(f"PANEL_USERNAME={secure_username}\nPANEL_PASSWORD={secure_password}\nPANEL_ENTRANCE={secure_entrance}\nPANEL_PORT={args.panel_port}\n")
        env.update(PANEL_NON_INTERACTIVE="true", PANEL_LANG="ru", PANEL_INSTALL_DIR="/opt", PANEL_PORT=str(args.panel_port),
                   PANEL_ENTRANCE=secure_entrance, PANEL_USERNAME=secure_username, PANEL_PASSWORD=secure_password,
                   PANEL_INSTALL_DOCKER="n", PANEL_CONFIGURE_ACCELERATOR="n",
                   PANEL_REPLACE_DAEMON_JSON="n")
        with install_log.open("w", encoding="utf-8") as output:
            os.chmod(install_log, 0o600)
            result = subprocess.run(["bash", str(installer), "--non-interactive"],
                                    cwd=installer.parent, env=env, stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.STDOUT, check=False)
        require(result.returncode == 0 and panel_present(),
                f"1Panel installer failed. Read root-only {install_log}")
    record("PANEL_INSTALLED", version=PANEL_VER, port=args.panel_port,
           root_only_credentials="/var/log/asa-server-rebuild/1panel-initial-credentials.env")


def assert_subnet_for_host(subnet: str) -> None:
    network = ipaddress.ip_network(subnet, strict=False)
    require(network.version == 4 and network.prefixlen >= 16,
            "Explicit restricted IPv4 admin CIDR required; never use 0.0.0.0/0")
    original = os.environ.get("SSH_CONNECTION", "").split()
    if original and original[0] != "127.0.0.1":
        remote_ip = ipaddress.ip_address(original[0])
        require(remote_ip in network or remote_ip.is_loopback,
                "Current SSH client is outside --admin-cidr; refusing to risk lockout")
    # If launched on a local console, explicitly supplied --admin-cidr is the
    # owner's decision. Remote access through tailscale0 gets its own interface rule.



def harden_panel_firewall(args):
    require(panel_present(), "1Panel is not installed")
    require(shutil.which("ufw") is not None, "UFW required for this hardening profile")
    assert_subnet_for_host(args.admin_cidr)
    dbfile = Path("/opt/1panel/db/agent.db")
    backup_dir = Path("/var/backups/asa-panel-firewall")
    backup_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_dir / f"agent-before-{stamp}.db"
    with sqlite3.connect(dbfile, timeout=10) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    os.chmod(backup, 0o600)
    expected = [
        {"port": str(args.panel_port), "protocol": "tcp", "type": "panel", "sources": [args.admin_cidr]},
        {"port": "22", "protocol": "tcp", "type": "ssh", "sources": [args.admin_cidr]},
    ]
    with sqlite3.connect(dbfile, timeout=10) as db:
        row = db.execute("SELECT value FROM settings WHERE key = ?", ("FirewallPortWhiteList",)).fetchone()
        require(row is not None, "1Panel firewall whitelist setting missing")
        previous = json.loads(row[0])
        require(all(x.get("port") in ("80", "443", "22", str(args.panel_port)) for x in previous),
                "Existing panel firewall has custom ports; cannot automatically replace it")
        # Never discard broad 80/443 rules if they belong to an existing website.
        listeners = run("ss", "-ltn", capture=True)
        require(not any(re.search(r":(?:80|443)\s", line) for line in listeners.splitlines()),
                "Ports 80/443 have active listeners; review public services before hardening")
        value = json.dumps(expected, separators=(",", ":"))
        if previous != expected:
            db.execute("UPDATE settings SET value = ? WHERE key = ?", (value, "FirewallPortWhiteList"))
    run("ufw", "allow", "from", args.admin_cidr, "to", "any", "port", str(args.panel_port), "proto", "tcp")
    run("ufw", "allow", "from", args.admin_cidr, "to", "any", "port", "22", "proto", "tcp")
    # Restrict tunnel access to the Tailscale interface, never to the public WAN.
    for allowed_port in (str(args.panel_port), "22"):
        run("ufw", "allow", "in", "on", "tailscale0", "to", "any", "port", allowed_port, "proto", "tcp")
    # 1Panel may have created unrestricted accept rules. Delete those by exact syntax.
    for port, proto in (("80", "tcp"), ("443", "tcp"), ("443", "udp"),
                        (str(args.panel_port), "tcp"), ("22", "tcp")):
        run("ufw", "--force", "delete", "allow", f"{port}/{proto}", check=False)
    status_before = run("ufw", "status", capture=True)
    if "inactive" in status_before.lower() or "неактив" in status_before.lower():
        # Preconditions above prove current SSH source is in the allowed admin subnet.
        run("ufw", "--force", "enable")
    run("systemctl", "restart", "1panel-agent")
    # A permissive default incoming policy would defeat the scoped ALLOW rules.
    details = run("ufw", "status", "verbose", capture=True)
    if "Default: allow (incoming)" in details or "По умолчанию: разрешать (входящие)" in details:
        raise Blocked("UFW default incoming policy is ALLOW; manual firewall review required")
    text = run("ufw", "status", capture=True)
    for line in text.splitlines():
        line = line.strip()
        if "ALLOW" in line and ("22/tcp" in line or f"{args.panel_port}/tcp" in line):
            require(args.admin_cidr in line or "tailscale0" in line,
                    "Unrestricted administrative firewall rule returned after restart")
    record("FIREWALL_HARDENED", admin_cidr=args.admin_cidr, backup=str(backup))


def source_install(args):
    path = args.root.resolve()
    if not (path / ".git").exists():
        require(not path.exists() or not any(path.iterdir()),
                "A nonempty directory exists at the target; refusing to overwrite")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            path.rmdir()
        run("git", "clone", "--depth", "1", "--single-branch", "--branch", "main", REPO, str(path))
        owner = pwd.getpwnam(args.operator)
        run("chown", "-R", f"{owner.pw_uid}:{owner.pw_gid}", str(path))
    require((path / "tools/asa_manager.py").exists(), "ASA manager missing")
    if not (path / ".asa/installed-release.json").is_file():
        require(not (path / ".env").exists(),
                "An unconfirmed .env exists without installed release; inspect recovery before re-installing")
    # The pinned stable release may precede this bootstrap commit and the
    # canonical manager intentionally detaches the operational checkout.
    # Preserve this recovery launcher OUTSIDE replaceable source files first.
    persistent = Path("/var/lib/asa-server-rebuild")
    persistent.mkdir(mode=0o755, parents=True, exist_ok=True)
    for filename in ("install-ubuntu-1panel.py", "prepare-age-backup.py", "transfer-backup-ssh.py", "restore-verified-backup.py"):
        source = Path(__file__).resolve().parent / filename
        if source.is_file():
            target = persistent / filename
            if source.resolve() != target.resolve():
                shutil.copyfile(source, target)
                os.chmod(target, 0o755)
    record("BOOTSTRAP_PERSISTED", directory=str(persistent))
    if (path / ".asa/installed-release.json").is_file():
        record("ASA_ALREADY_INSTALLED", root=str(path))
        doctor(args)
        return
    require(not (path / ".asa/maintenance.json").exists(), "An incomplete deployment already exists")
    run("python3", "tools/asa_manager.py", "install", "--profile", args.profile,
        as_user=args.operator, cwd=path)
    record("ASA_INSTALLED", root=str(path), profile=args.profile)
    doctor(args)


def doctor(args):
    path = args.root.resolve()
    require((path / ".asa/installed-release.json").is_file(),
            "No installed release marker. Complete the installation first")
    run("python3", "tools/asa_manager.py", "doctor", "--profile", args.profile,
        as_user=args.operator, cwd=path)
    envpath=path/".env"
    port=4610
    if envpath.is_file():
        for line in envpath.read_text(encoding="utf-8").splitlines():
            if line.startswith("ASA_WEB_PORT="):
                port=int(line.partition("=")[2])
    require(1<=port<=65535,"Invalid ASA_WEB_PORT")
    origin=f"http://127.0.0.1:{port}"
    ready = json.loads(urllib.request.urlopen(origin+"/health/ready", timeout=8).read())
    meta = json.loads(urllib.request.urlopen(origin+"/build-metadata.json", timeout=8).read())
    deploy = ready.get("deployment", {})
    require(ready.get("status") == "ready" and deploy.get("revision") == meta.get("revision")
            and deploy.get("synchronized") is True
            and deploy.get("schemaVersion") == deploy.get("expectedSchemaVersion"),
            "Web/API version and schema mismatch")
    with urllib.request.urlopen(origin+"/internal/blocks/healthz", timeout=8) as response:
        require(response.status == 200, "Scratch proxy unhealthy")
    record("ASA_HEALTHY", revision=deploy.get("revision"), schema=deploy.get("schemaVersion"))


def verify_backup(args):
    require(args.backup_dir is not None and args.backup_dir.is_dir(),
            "Use --backup-dir with an extracted ASA backup directory")
    run("python3", "tools/asa_manager.py", "verify-backup", "--backup", str(args.backup_dir.resolve()),
        as_user=args.operator, cwd=args.root.resolve())
    record("EXTERNAL_BACKUP_VERIFIED", backup_dir=str(args.backup_dir.resolve()))


def test_restore(args):
    verify_backup(args)
    require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,50}_test", args.database),
            "A disposable database name ending _test is required")
    run("python3", "tools/asa_manager.py", "restore-check", "--profile", args.profile,
        "--backup", str(args.backup_dir.resolve()), "--database", args.database,
        as_user=args.operator, cwd=args.root.resolve())
    record("RESTORE_CHECK_PASSED", test_database=args.database)


def full_backup(args):
    doctor(args)
    dest = args.root.resolve() / "backups"
    run("python3", "tools/asa_manager.py", "backup", "--profile", args.profile,
        "--output", str(dest), as_user=args.operator, cwd=args.root.resolve())
    record("BACKUP_COMPLETED", directory=str(dest))


def update(args):
    path = args.root.resolve()
    doctor(args)
    run("python3", "tools/asa_manager.py", "check", "--profile", args.profile,
        as_user=args.operator, cwd=path)
    run("python3", "tools/asa_manager.py", "update", "--profile", args.profile,
        as_user=args.operator, cwd=path)
    doctor(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "panel", "harden-panel", "doctor", "backup", "verify-backup", "restore-check", "update"))
    parser.add_argument("--root", type=Path, default=Path("/srv/asa-lab-test"))
    parser.add_argument("--operator", default=os.environ.get("SUDO_USER") or "admins")
    parser.add_argument("--profile", choices=("staging", "production", "dev"), default="staging")
    parser.add_argument("--panel-port", type=int, default=19192)
    parser.add_argument("--panel-archive", type=Path, help="Trusted offline 1Panel tar.gz; pinned SHA-256 required")
    parser.add_argument("--admin-cidr", required=False,
                        help="Required for install/panel/harden-panel: CIDR containing your SSH client, e.g. 192.168.1.0/24 or public-IP/32")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--database", default="asalab_rehearsal_test")
    parser.add_argument("--restore-backup", type=Path, help="Verified extracted snapshot for full install+restore")
    parser.add_argument("--target-hostname", help="Required exact host name for full recovery")
    parser.add_argument("--restore-snapshot", help="Required exact backup snapshot ID for full recovery")
    args = parser.parse_args()
    try:
        with exclusive():
            if args.action in ("install", "panel", "harden-panel"):
                require(bool(args.admin_cidr),
                        "--admin-cidr is required; do not guess your SSH/admin network")
                preflight(args)
                if args.action in ("install", "panel"):
                    panel_install(args)
                    # Reconcile persistent 1Panel whitelist on every invocation.
                    # A pre-existing panel must not silently bypass LAN-only access.
                    harden_panel_firewall(args)
                if args.action == "harden-panel":
                    harden_panel_firewall(args)
                if args.action == "install":
                    source_install(args)
                    if args.restore_backup is not None:
                        require(bool(args.target_hostname) and bool(args.restore_snapshot),
                                "--target-hostname and --restore-snapshot must accompany --restore-backup")
                        script = Path(__file__).resolve().parent / "restore-verified-backup.py"
                        if not script.is_file():
                            script = Path("/var/lib/asa-server-rebuild/restore-verified-backup.py")
                        require(script.is_file(), "Recovery helper missing; do not leave an untracked partial restore")
                        run("python3", str(script), "--root", str(args.root.resolve()),
                            "--backup", str(args.restore_backup.resolve()), "--profile", args.profile,
                            "--hostname", args.target_hostname, "--apply",
                            "--confirm", "RESTORE:" + args.restore_snapshot)
                        doctor(args)
            else:
                require(os.geteuid() == 0, "Run with sudo/root")
                if args.action == "doctor": doctor(args)
                elif args.action == "backup": full_backup(args)
                elif args.action == "verify-backup": verify_backup(args)
                elif args.action == "restore-check": test_restore(args)
                elif args.action == "update": update(args)
        return 0
    except (Blocked, OSError, ValueError, sqlite3.Error) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())