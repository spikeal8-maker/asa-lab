"""Fail-closed preflight for a new, isolated Windows/Linux ASA Lab installation.

No implicit Docker project, port, volume or private-config takeover.
Preflight is read-only and must complete BEFORE first_environment writes keys.
"""
import os
from pathlib import Path
import re
import socket
import stat

from .contracts import Blocked, require
from .system import run

PROJECT_RE = re.compile(r"[a-z0-9][a-z0-9_-]{2,62}\Z")


def fresh_options(project, web_port, blocks_port):
    require(isinstance(project, str) and bool(PROJECT_RE.fullmatch(project)),
            "FRESH_PROJECT", "New installation must use an explicit safe Compose project name.")
    # Keep each fresh ASA stack in its own project, not a reserved system one.
    require(project.startswith("asa-lab-"), "FRESH_PROJECT",
            "Fresh installation Compose project must begin with asa-lab-.")
    require(type(web_port) is int and 1024 <= web_port <= 65532,
            "FRESH_PORT", "Web port must be an unprivileged TCP port from 1024 to 65532.")
    require(type(blocks_port) is int and 1024 <= blocks_port <= 65535
            and blocks_port not in (web_port, web_port + 1),
            "FRESH_PORT", "Scratch port must differ from the Web and API ports.")
    return {"project": project, "web": web_port,
            "api": web_port + 1, "blocks": blocks_port,
            "origin": f"http://127.0.0.1:{web_port}"}


def check_reserved_port(port):
    """A bounded listener preflight, never a port-forwarding or firewall change."""
    family = socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as exc:
            raise Blocked("FRESH_PORT_IN_USE",
                          f"Port {port} is already reserved on loopback.",
                          "Choose unused ports. Never stop an existing ASA application to free them.") from exc


def assert_clean_install_destination(root, spec):
    """No other ASA project or even orphan volumes may be silently adopted."""
    root = Path(root).resolve()
    require(root.is_dir() and (root / ".git").exists(),
            "FRESH_ROOT", "Fresh installation requires a checked-out, authorized ASA repository.")
    for name in (".env",):
        require(not (root / name).exists(), "FRESH_ENV",
                "A private configuration is already present in this directory.",
                "Use an existing-installation workflow or inspect an interrupted first install.")
    for marker in ("installed-release.json", "installation.json",
                   "maintenance.json", "failed-switch.json", "atomic-active.json",
                   "last-operation.json"):
        require(not (root / ".asa" / marker).exists(),
                "FRESH_STATE", "This directory contains existing installation or maintenance state.",
                "Do not reset, overwrite or reuse the state of another deployment.")
    for directory in (root, root / ".asa"):
        if directory.exists():
            attrs = directory.lstat()
            require(not directory.is_symlink() and not (
                getattr(attrs, "st_file_attributes", 0)
                & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)),
                "FRESH_PATH", "Installation path cannot traverse a reparse point.")
    project = spec["project"]
    containers = run(["docker", "ps", "-aq", "--filter",
                      "label=com.docker.compose.project=" + project], capture=True)
    require(not containers, "FRESH_PROJECT_EXISTS",
            "The selected Docker Compose project already has containers.",
            "Choose a different unique project; never delete another ASA installation.")
    volumes = run(["docker", "volume", "ls", "-q", "--filter",
                   "label=com.docker.compose.project=" + project], capture=True)
    require(not volumes, "FRESH_VOLUME_EXISTS",
            "The selected Docker Compose project already has persistent volumes.",
            "Old volumes may contain school data; choose a new project instead.")
    # Unlabeled orphan volumes with the expected prefix are also forbidden.
    # Do not let Compose adopt a leftover postgres-data volume accidentally.
    orphan_volumes = run(["docker", "volume", "ls", "-q", "--filter",
                          "name=" + project + "_"], capture=True)
    require(not orphan_volumes, "FRESH_VOLUME_EXISTS",
            "This project prefix already has volumes, even if labels are missing.",
            "Inspect orphan volumes; never delete or silently reuse them.")
    networks = run(["docker", "network", "ls", "-q", "--filter",
                    "label=com.docker.compose.project=" + project], capture=True)
    require(not networks, "FRESH_NETWORK_EXISTS",
            "The selected Compose project already has a network.",
            "Choose a fresh project name; never attach a new school DB to foreign networks.")
    for port in (spec["web"], spec["api"], spec["blocks"]):
        check_reserved_port(port)
    return True
