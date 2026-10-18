#!/usr/bin/env python3
"""Expose an existing loopback-only ASA Lab Web through a LAN-only socket.

This is an HTTP *preview*, not a public/production ingress. The service forwards
TCP without modifying Docker or the ASA origin/security configuration.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
from urllib.request import urlopen

SOCKET_PATH = Path("/etc/systemd/system/asa-lab-lan-4610.socket")
SERVICE_PATH = Path("/etc/systemd/system/asa-lab-lan-4610.service")
UNIT = "asa-lab-lan-4610.socket"
PROXY_BINARY = "/usr/lib/systemd/systemd-socket-proxyd"
PORT = 4610


class Blocked(Exception):
    """Fail closed; never replace an unfamiliar systemd configuration."""


def require(value: bool, message: str) -> None:
    if not value:
        raise Blocked(message)


def validate_address(ip: str, cidr: str, interface: str):
    try:
        address = ipaddress.IPv4Address(ip)
        network = ipaddress.IPv4Network(cidr, strict=True)
    except (ipaddress.AddressValueError, ipaddress.NetmaskValueError, ValueError) as exc:
        raise Blocked(f"Invalid IPv4/CIDR: {exc}") from exc
    require(address.is_private and not address.is_loopback and not address.is_link_local,
            "A private LAN IPv4 address is required")
    require(network.is_private and network.prefixlen >= 16 and address in network,
            "Choose an explicit private administration LAN, no broader than /16")
    require(bool(re.fullmatch(r"[A-Za-z0-9_.-]{1,15}", interface)),
            "Invalid network interface")
    require(not interface.startswith(("docker", "br-", "veth", "tail", "tun", "wg", "lo")),
            "Do not publish the LAN preview through a virtual/VPN interface")
    return address, network


def socket_unit(ip: str) -> str:
    return "\n".join((
        "[Unit]",
        "Description=ASA Lab LAN-only HTTP socket (no Internet binding)",
        "After=network-online.target",
        "Wants=network-online.target",
        "[Socket]",
        f"ListenStream={ip}:{PORT}",
        "FreeBind=yes",
        "NoDelay=yes",
        "[Install]",
        "WantedBy=sockets.target",
        "",
    ))


def service_unit() -> str:
    return "\n".join((
        "[Unit]",
        "Description=ASA Lab LAN proxy to loopback-only Docker Web",
        "Requires=asa-lab-lan-4610.socket",
        "After=asa-lab-lan-4610.socket",
        "[Service]",
        f"ExecStart={PROXY_BINARY} 127.0.0.1:{PORT}",
        "DynamicUser=yes",
        "NoNewPrivileges=yes",
        "PrivateTmp=yes",
        "ProtectSystem=strict",
        "ProtectHome=yes",
        "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
        "CapabilityBoundingSet=",
        "Restart=on-failure",
        "RestartSec=2s",
        "",
    ))


def command(*args: str, capture: bool = False, env=None) -> str:
    run = subprocess.run(list(args), check=False, text=True, capture_output=capture, env=env)
    if run.returncode:
        raise Blocked(f"Command failed: {args[0]} {args[1] if len(args) > 1 else ''}")
    return run.stdout.strip() if capture else ""


def validate_profile(profile: str, acknowledge_production: bool) -> None:
    require(profile in ("staging", "dev") or (profile == "production" and acknowledge_production),
            "Production HTTP preview requires --ack-production-http-preview; "
            "use HTTPS for login and private student data")


def assert_baseline(root: Path, ip: str, interface: str, acknowledge_production: bool = False) -> None:
    require(sys.platform.startswith("linux"), "Linux is required")
    require(os.geteuid() == 0, "Run as root (sudo)")
    require(root.joinpath(".asa/installation.json").is_file(), "ASA installation state not found")
    settings = json.loads(root.joinpath(".asa/installation.json").read_text(encoding="utf-8"))
    validate_profile(settings.get("profile"), acknowledge_production)
    require(Path(PROXY_BINARY).is_file(), "systemd-socket-proxyd not installed")
    addresses = command("ip", "-4", "-o", "addr", "show", "dev", interface, capture=True)
    require(any(line.split()[3].split("/")[0] == ip for line in addresses.splitlines()),
            "The requested IPv4 address does not belong to the selected interface")
    firewall_env = dict(os.environ, LC_ALL="C", LANG="C")
    ufw = command("ufw", "status", "verbose", capture=True, env=firewall_env)
    require("Status: active" in ufw and "deny (incoming)" in ufw,
            "UFW must be active with deny-by-default inbound policy")
    with urlopen(f"http://127.0.0.1:{PORT}/health/ready", timeout=6) as response:
        data = json.load(response)
    require(data.get("status") == "ready", "Existing local ASA Lab is not ready")


def assert_units_match(ip: str) -> bool:
    expected = {SOCKET_PATH: socket_unit(ip), SERVICE_PATH: service_unit()}
    existing = [f for f in expected if f.exists()]
    if not existing:
        return False
    require(len(existing) == len(expected), "Only one of the ingress units exists")
    for path, content in expected.items():
        require(path.is_file() and path.read_text(encoding="utf-8") == content,
                f"Unexpected existing unit {path}: refusing overwrite")
    return True


def check_site(ip: str) -> None:
    with urlopen(f"http://{ip}:{PORT}/health/ready", timeout=8) as response:
        require(response.status == 200 and json.load(response).get("status") == "ready",
                "LAN ingress did not serve a ready ASA Lab")


def install(root: Path, ip: str, cidr: str, interface: str, acknowledge_production: bool = False) -> None:
    validate_address(ip, cidr, interface)
    assert_baseline(root, ip, interface, acknowledge_production)
    found = assert_units_match(ip)
    if not found:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((ip, PORT))
            except OSError as exc:
                raise Blocked(f"LAN listener already in use: {ip}:{PORT}") from exc
        for path, content in ((SOCKET_PATH, socket_unit(ip)), (SERVICE_PATH, service_unit())):
            path.write_text(content, encoding="utf-8")
            path.chmod(0o644)
    command("systemctl", "daemon-reload")
    command("systemd-analyze", "verify", str(SOCKET_PATH), str(SERVICE_PATH))
    command("ufw", "allow", "in", "on", interface, "from", cidr, "to", ip,
            "port", str(PORT), "proto", "tcp", "comment", "ASA Lab LAN only - HTTP preview")
    command("systemctl", "enable", "--now", UNIT)
    require(command("systemctl", "is-active", UNIT, capture=True) == "active",
            "LAN ingress socket not active")
    check_site(ip)
    print(f"LAN_PREVIEW_READY http://{ip}:{PORT}/")
    print("SECURITY: HTTP LAN preview only; no real passwords, no public forwarding.")
    print("SCRATCH: full editor save/restore requires a matching HTTPS portal origin.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "check"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--lan-ip", required=True)
    parser.add_argument("--cidr", required=True)
    parser.add_argument("--interface", required=True)
    parser.add_argument("--ack-production-http-preview", action="store_true",
                        help="Explicit production LAN HTTP viewing only; credentials require HTTPS")
    opts = parser.parse_args()
    try:
        validate_address(opts.lan_ip, opts.cidr, opts.interface)
        assert_baseline(opts.root.resolve(), opts.lan_ip, opts.interface,
                        opts.ack_production_http_preview)
        if opts.action == "install":
            install(opts.root.resolve(), opts.lan_ip, opts.cidr, opts.interface,
                    opts.ack_production_http_preview)
        else:
            require(assert_units_match(opts.lan_ip), "LAN ingress not installed")
            require(command("systemctl", "is-active", UNIT, capture=True) == "active",
                    "LAN ingress socket inactive")
            check_site(opts.lan_ip)
            print(f"LAN_PREVIEW_PASS http://{opts.lan_ip}:{PORT}/")
        return 0
    except (Blocked, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())