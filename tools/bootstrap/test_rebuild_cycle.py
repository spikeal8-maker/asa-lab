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
    def test_first_install_waits_for_1panel_initial_firewall_policy(self):
        content=(BASE/"install-ubuntu-1panel.py").read_text()
        self.assertIn("PANEL_FIREWALL_POLICY_READY",content)
        self.assertIn("time.monotonic() + 90",content)

    def test_operator_collector_has_user_systemd_manager(self):
        content=(BASE/"install-ubuntu-1panel.py").read_text()
        self.assertIn('run("loginctl", "enable-linger", args.operator)',content)
        self.assertIn("XDG_RUNTIME_DIR=/run/user/{uid}",content)
        self.assertIn('"-m", "deployment.collector"',content)

    def test_verified_yandex_school_size(self):
        restore.validate_population(accounts=89, seats=418, active=327,
                                    min_seats=400, min_active=300)

    def test_reject_wrong_small_student_population(self):
        with self.assertRaises(restore.Refused):
            restore.validate_population(accounts=89, seats=418, active=299,
                                        min_seats=400, min_active=300)

    def test_reject_wrong_seat_count(self):
        with self.assertRaises(restore.Refused):
            restore.validate_population(accounts=89, seats=399, active=327,
                                        min_seats=400, min_active=300)

    def test_freshness_rejects_stale_backup(self):
        with self.assertRaises(restore.Refused):
            restore.validate_snapshot_age("20261001T231505Z-7b457013",48)

    def test_freshness_allows_explicit_no_age_limit(self):
        restore.validate_snapshot_age("20261001T231505Z-7b457013",0)

    def test_installer_requires_source_for_fresh_production(self):
        source=(BASE/"install-ubuntu-1panel.py").read_text()
        self.assertIn("--require-restore",source)
        self.assertIn("--fresh-empty",source)
        self.assertIn("--min-active-students",source)
        self.assertIn("--min-seats",source)

    def test_restore_uses_bounded_service_readiness_on_cutover_and_rollback(self):
        code=(BASE/"restore-verified-backup.py").read_text()
        expected='wait_ready(release["revision"],release["schema"])'
        self.assertEqual(code.count(expected),2)
        self.assertIn('CHECKPOINT', (BASE/"restore-verified-backup.py").read_text().upper())
        self.assertIn('ROLLBACK_DATA_RETURNED',code)
        self.assertIn('ROLLBACK_DATA_DONE_HEALTH_PENDING',code)

    def test_canonical_wait_ready_recovers_from_transient_reset(self):
        import sys
        from unittest.mock import patch
        tools_dir=next((p for p in (BASE.parent,Path.cwd()/"tools")
                        if (p/"deployment/system.py").is_file()),None)
        self.assertIsNotNone(tools_dir,"Canonical deployment tools are required")
        sys.path.insert(0,str(tools_dir))
        from deployment.system import Installation
        class FlakyProbe:
            def __init__(self): self.calls=0
            def readiness(self,revision,schema):
                self.calls+=1
                if self.calls<3:raise ConnectionResetError("transient startup")
                return {"revision":revision,"schema":schema}
        probe=FlakyProbe()
        with patch("deployment.system.time.sleep",lambda sec: None):
            outcome=Installation.wait_ready(probe,"released_sha",213)
        self.assertEqual(probe.calls,3)
        self.assertEqual(outcome["schema"],213)

    def test_manager_installer_wires_restore(self):
        content=(BASE/"install-ubuntu-1panel.py").read_text()
        self.assertIn("restore-verified-backup.py",content)
        self.assertIn("--restore-backup",content)
        self.assertIn("--panel-archive",content)
if __name__=="__main__":
    unittest.main(verbosity=2)
