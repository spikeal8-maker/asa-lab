"""Regression tests for real ASA Lab cloud snapshots and dependency-safe pg_restore."""

from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from deployment.restore_order import ordered_restore_toc
from deployment.contracts import Blocked
from deployment import backup as module


HEADER = "; PostgreSQL database dump\n"
CONFIG = "100; 0 100 TABLE DATA public ai_assistant_config asalab_admin\n"
POLICY = "101; 0 101 TABLE DATA public ai_generation_policy asalab_admin\n"
CATALOG = "102; 0 102 TABLE DATA public ai_ollama_cloud_models asalab_admin\n"
EXTRA = "103; 0 103 TABLE DATA public projects asalab_admin\n"


class OrderedRestoreTocTests(unittest.TestCase):
    def test_ollama_catalog_is_restored_before_dependent_tables(self):
        original = HEADER + CONFIG + POLICY + EXTRA + CATALOG
        result = ordered_restore_toc(original)
        self.assertEqual(result, HEADER + CATALOG + CONFIG + POLICY + EXTRA)
        self.assertEqual(sorted(result.splitlines()), sorted(original.splitlines()))
        self.assertEqual(len(result), len(original))

    def test_already_valid_and_legacy_backup_order_is_unchanged(self):
        for toc in (HEADER + CATALOG + CONFIG + POLICY,
                    HEADER + CONFIG + EXTRA,
                    HEADER + CATALOG + EXTRA,
                    HEADER + CATALOG + POLICY + CONFIG,
                    HEADER + EXTRA):
            with self.subTest(toc=toc):
                self.assertEqual(ordered_restore_toc(toc), toc)

    def test_bad_or_duplicate_restore_list_is_rejected(self):
        for toc in ("", "  ", HEADER + CATALOG + CATALOG + CONFIG):
            with self.subTest(toc=toc), self.assertRaises(Blocked) as caught:
                ordered_restore_toc(toc)
            self.assertEqual(caught.exception.code, "RESTORE_TOC")

    def test_dependent_tables_reordered_without_touching_privilege_entries(self):
        acl = "104; 0 104 ACL public TABLE ai_assistant_config asalab_admin\n"
        original = HEADER + CONFIG + acl + EXTRA + CATALOG
        result = ordered_restore_toc(original)
        self.assertEqual(result, HEADER + CATALOG + CONFIG + acl + EXTRA)


class RestoreCheckContractTests(unittest.TestCase):
    def test_no_duplicate_restore_can_ever_mutate_an_existing_target(self):
        with tempfile.TemporaryDirectory() as temp:
            install = Mock()
            install.env = {"POSTGRES_DB": "asalab", "POSTGRES_USER": "asalab_admin"}
            install.compose.return_value = "1"
            with patch.object(module, "verify_backup", return_value={}), \
                    patch.object(module, "upload_dump") as upload:
                with self.assertRaises(Blocked) as caught:
                    module.restore_check(install, Path(temp), "restore_guard_test")
            self.assertEqual(caught.exception.code, "RESTORE_EXISTS")
            upload.assert_not_called()

    def test_failed_new_restore_removes_only_its_own_test_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "database.dump").write_bytes(b"synthetic, never used")
            install = Mock()
            install.env = {"POSTGRES_DB": "asalab", "POSTGRES_USER": "asalab_admin"}
            calls = []

            def compose(*args, **kwargs):
                calls.append(args)
                if args[0:4] == ("exec", "-T", "postgres", "psql"):
                    return ""
                if "pg_restore" in args and "--list" in args:
                    return HEADER + CONFIG + CATALOG
                if "pg_restore" in args and "--single-transaction" in args:
                    raise Blocked("COMMAND", "Synthetic copy failure", "Do not alter live database")
                return ""

            install.compose.side_effect = compose
            with patch.object(module, "verify_backup", return_value={"applicationPrivileges": []}), \
                 patch.object(module, "upload_dump"), \
                 patch.object(module, "db_command"):
                with self.assertRaises(Blocked):
                    module.restore_check(install, root, "asa_failed_copy_test")
            deleted = [args for args in calls if "dropdb" in args]
            self.assertEqual(len(deleted), 1)
            self.assertIn("--if-exists", deleted[0])
            self.assertNotIn("--force", deleted[0])
            self.assertIn("asa_failed_copy_test", deleted[0])
            self.assertNotIn("asalab", deleted[0])

    def test_restore_uses_whole_toc_and_does_not_turn_off_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "database.dump").write_bytes(b"synthetic, never used")
            install = Mock()
            install.env = {"POSTGRES_DB": "asalab", "POSTGRES_USER": "asalab_admin"}
            recorded = []

            def compose(*args, **kwargs):
                recorded.append((args, kwargs))
                if args[0:4] == ("exec", "-T", "postgres", "psql"):
                    return ""
                if "pg_restore" in args and "--list" in args:
                    return HEADER + CONFIG + CATALOG
                return ""

            install.compose.side_effect = compose
            manifest = {"applicationPrivileges": []}
            with patch.object(module, "verify_backup", return_value=manifest), \
                 patch.object(module, "upload_dump"), \
                 patch.object(module, "db_command"), \
                 patch.object(module, "privileges", return_value=[]):
                module.restore_check(install, root, "restore_synthetic_test")

            uploads = [(args,kw) for args,kw in recorded
                       if "asa-restore-list" in args]
            self.assertEqual(len(uploads), 1)
            self.assertIn(CATALOG + CONFIG, uploads[0][1]["input_data"])
            restores = [args for args,_ in recorded if "pg_restore" in args and "--single-transaction" in args]
            self.assertEqual(len(restores), 1)
            self.assertIn("--use-list", restores[0])
            self.assertNotIn("--disable-triggers", restores[0])
            self.assertNotIn("--no-acl", restores[0])


if __name__ == "__main__":
    unittest.main()
