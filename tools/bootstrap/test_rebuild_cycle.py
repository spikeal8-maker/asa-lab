#!/usr/bin/env python3
"""Offline guard-rail regression tests for clean reset and data restore."""
from pathlib import Path
import importlib.util
import unittest

BASE=Path(__file__).resolve().parent
def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,BASE/filename)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

clean=load("cleanhost","reset-managed-host.py")
restore=load("restorehost","restore-verified-backup.py")
class HostResetSafety(unittest.TestCase):
    def test_unrelated_container_is_blocked(self):
        with self.assertRaises(clean.Refused):
            clean.allowlist_matches("asa-lab-dev-web-1\nother-workload\n",r"asa-lab-dev-[a-z0-9-]+","container")
    def test_unrelated_volume_is_blocked(self):
        with self.assertRaises(clean.Refused):
            clean.allowlist_matches("other_project_data",r"asa-lab-dev_[a-z0-9_-]+","volume")
    def test_known_app_container_is_allowed(self):
        clean.allowlist_matches("asa-lab-dev-api-1\nasa-lab-dev-postgres-1\n",r"asa-lab-dev-[a-z0-9-]+","container")
    def test_os_and_tailscale_are_outside_removal(self):
        for p in ("/etc/ssh","/etc/systemd/system","/usr/lib/systemd",
                  "/var/lib/tailscale","/etc/tailscale","/home/admins/.ssh",
                  "/etc/netplan","/boot","/"):
            self.assertNotIn(Path(p),clean.DIRS_TO_REMOVE)
        for pkg in ("openssh-server","tailscale","systemd","ufw","ubuntu-desktop"):
            self.assertNotIn(pkg,clean.DOCKER_PKGS)
    def test_cleanup_dirs_are_explicit_not_root(self):
        for p in clean.DIRS_TO_REMOVE:
            self.assertTrue(p.is_absolute())
            self.assertNotEqual(str(p),"/")
            self.assertGreaterEqual(len(p.parts),3)
    def test_archive_is_external_to_app_checkout(self):
        self.assertFalse(clean.ARCHIVE.is_relative_to(clean.EXPECTED_ROOT))
class SnapshotSafety(unittest.TestCase):
    def test_crypto_keys_only(self):
        self.assertEqual(len(restore.KEYS),4)
        self.assertNotIn("POSTGRES_PASSWORD",restore.KEYS)
        self.assertNotIn("APP_DATABASE_URL",restore.KEYS)
        self.assertNotIn("ASA_UPDATE_ENTRY_ORIGIN",restore.KEYS)
    def test_sql_database_identifier_filter(self):
        self.assertIsNone(__import__("re").fullmatch(r"[a-z][a-z0-9_]{0,60}","asalab;drop_database"))
    def test_require_raises(self):
        with self.assertRaises(restore.Refused):
            restore.need(False,"abort")
    def test_encrypted_archive_never_includes_identity(self):
        script=(BASE/"restore-verified-backup.py").read_text()
        self.assertNotIn("asa-cloud-age-identity.txt",script)
        self.assertNotIn("tailscale down",script)
    def test_manager_installer_wires_restore(self):
        content=(BASE/"install-ubuntu-1panel.py").read_text()
        self.assertIn("restore-verified-backup.py",content)
        self.assertIn("--restore-backup",content)
        self.assertIn("--panel-archive",content)
if __name__=="__main__":
    unittest.main(verbosity=2)
