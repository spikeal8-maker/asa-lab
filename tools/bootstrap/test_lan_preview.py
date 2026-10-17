#!/usr/bin/env python3
"""No-root contract tests for ASA Lab LAN-only ingress helper."""
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "lan-preview-ubuntu.py"
if not SOURCE.is_file():
    SOURCE = HERE / "lan-preview-ubuntu.py"
spec = importlib.util.spec_from_file_location("lanpreview", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class IngressSafety(unittest.TestCase):
    def test_private_lan(self):
        self.assertEqual(str(mod.validate_address("192.168.1.115", "192.168.1.0/24", "eno1")[0]),
                         "192.168.1.115")

    def test_reject_public(self):
        with self.assertRaises(mod.Blocked):
            mod.validate_address("8.8.8.8", "8.8.0.0/16", "eno1")

    def test_reject_entire_private_ten_network(self):
        with self.assertRaises(mod.Blocked):
            mod.validate_address("10.1.2.3", "10.0.0.0/8", "eno1")

    def test_reject_mismatched_net(self):
        with self.assertRaises(mod.Blocked):
            mod.validate_address("192.168.1.115", "192.168.2.0/24", "eno1")

    def test_reject_multicast(self):
        with self.assertRaises(mod.Blocked):
            mod.validate_address("239.1.2.3", "239.1.0.0/16", "eno1")

    def test_reject_vpn_interface(self):
        with self.assertRaises(mod.Blocked):
            mod.validate_address("192.168.1.115", "192.168.1.0/24", "tailscale0")

    def test_reject_docker_bridge(self):
        with self.assertRaises(mod.Blocked):
            mod.validate_address("192.168.1.115", "192.168.1.0/24", "br-example")

    def test_no_wildcard_bind(self):
        value = mod.socket_unit("192.168.1.115")
        self.assertIn("ListenStream=192.168.1.115:4610", value)
        self.assertNotIn("ListenStream=0.0.0.0", value)

    def test_existing_service_is_unprivileged(self):
        value = mod.service_unit()
        for word in ("DynamicUser=yes", "NoNewPrivileges=yes", "ProtectHome=yes",
                     "ProtectSystem=strict", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6"):
            self.assertIn(word, value)

    def test_proxy_stays_local(self):
        self.assertIn("127.0.0.1:4610", mod.service_unit())

    def test_no_docker_changes(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertNotIn("docker compose up", source)
        self.assertNotIn("docker run", source)
        self.assertNotIn("systemctl restart docker", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)