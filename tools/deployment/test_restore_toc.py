"""Restore planning and safety guards; no Docker or database is used here."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.backup import restore_check
from deployment.contracts import Blocked
from deployment import restore_toc

TOC = """; Archive created by pg_dump
1; 0 0 ENCODING - ENCODING
2; 1259 100 TABLE public ai_assistant_config postgres
3; 1259 101 TABLE public ai_ollama_cloud_models postgres
4; 2606 102 CONSTRAINT public ai_assistant_config model_check postgres
5; 0 100 TABLE DATA public ai_assistant_config postgres
6; 0 101 TABLE DATA public ai_ollama_cloud_models postgres
7; 0 0 SEQUENCE SET public project_seq postgres
8; 0 0 ACL public TABLE ai_assistant_config postgres
9; 0 0 ROW SECURITY public ai_assistant_config postgres
"""


class RestoreTocTests(unittest.TestCase):
    def test_moves_only_catalog_data_and_preserves_every_other_entry(self):
        planned = restore_toc.plan_restore_toc(TOC)
        before, after = TOC.splitlines(), planned.splitlines()
        self.assertCountEqual(before, after)
        selected = before[6]
        self.assertEqual([line for line in before if line != selected],
                         [line for line in after if line != selected])
        self.assertLess(after.index(selected), after.index(before[5]))
        self.assertGreater(after.index(selected), after.index(before[4]))
        self.assertEqual(restore_toc.plan_restore_toc(planned), planned)

    def test_older_archive_without_optional_catalog_remains_unchanged(self):
        older = "\n".join(line for line in TOC.splitlines() if "ai_ollama_cloud_models" not in line) + "\n"
        self.assertEqual(restore_toc.plan_restore_toc(older), older)
        # A different schema/table or a function mentioning the name is not moved.
        unrelated = older + "11; 0 0 TABLE DATA other ai_ollama_cloud_models postgres\n"
        unrelated += "12; 0 0 FUNCTION public ai_ollama_cloud_models() postgres\n"
        self.assertEqual(restore_toc.plan_restore_toc(unrelated), unrelated)

    def test_rejects_duplicate_malformed_missing_schema_and_oversized_lists(self):
        for value in (
            "", "; comments only\n", TOC + TOC.splitlines()[2] + "\n",
            TOC + "11; 0 101 TABLE DATA public ai_ollama_cloud_models postgres\n",
            TOC + "11; 1259 101 TABLE public ai_ollama_cloud_models postgres\n",
            TOC + "not an entry\n", TOC + "0; 0 0 COMMENT - invalid\n", TOC + "\x00",
            TOC + "11; 0 0 TABLE DATA public ai_ollama_cloud_models\n",
            TOC.replace("3; 1259 101 TABLE public ai_ollama_cloud_models postgres\n", ""),
            TOC + ";" + "x" * restore_toc.MAX_TOC_LINE,
        ):
            with self.subTest(value=value[:35]), self.assertRaises(Blocked) as failure:
                restore_toc.plan_restore_toc(value)
            self.assertEqual(failure.exception.code, "RESTORE_TOC")
        with patch.object(restore_toc, "MAX_TOC_ENTRIES", 2), self.assertRaises(Blocked):
            restore_toc.plan_restore_toc(TOC)
        with patch.object(restore_toc, "MAX_TOC_BYTES", 20), self.assertRaises(Blocked):
            restore_toc.plan_restore_toc(TOC)


class FakeInstallation:
    env = {"POSTGRES_USER": "postgres", "POSTGRES_DB": "working"}

    def __init__(self, *, toc=TOC, exists="", fail=False):
        self.calls, self.toc, self.exists, self.fail = [], toc, exists, fail

    def identity(self):
        self.calls.append(("identity",))
        return {"postgres": {"id": "same-existing-postgres"}}

    def compose(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if "psql" in args:
            return self.exists
        if "--list" in args:
            return self.toc
        if "--use-list" in args and self.fail:
            raise Blocked("COMMAND", "injected restore failure", "Test only")
        return ""


class RestoreCheckTests(unittest.TestCase):
    def invoke(self, install, target="safe_restore_test"):
        with tempfile.TemporaryDirectory() as directory, \
                patch("deployment.backup.verify_backup", return_value={"applicationPrivileges": []}), \
                patch("deployment.backup.upload_dump"), \
                patch("deployment.backup.privileges", return_value=[]):
            restore_check(install, directory, target)

    def test_real_identity_and_restore_guards_remain_and_use_seekable_private_plan(self):
        install = FakeInstallation()
        self.invoke(install)
        self.assertEqual(install.calls[0], ("identity",))
        commands = [call for call in install.calls if len(call) == 2]
        restore = next(args for args, _ in commands if "--use-list" in args)
        for flag in ("--exit-on-error", "--single-transaction", "--no-owner"):
            self.assertIn(flag, restore)
        for flag in ("--no-acl", "--disable-triggers", "--clean", "--create", "--data-only"):
            self.assertNotIn(flag, restore)
        plan_path = restore[restore.index("--use-list") + 1]
        self.assertTrue(plan_path.startswith("/tmp/asa-restore-") and plan_path.endswith(".dump.list"))
        plan = next((args, kwargs) for args, kwargs in commands if "asa-restore-plan" in args)
        self.assertIn('umask 077; cat > "$1"', plan[0])
        self.assertEqual(plan[1]["input_data"], restore_toc.plan_restore_toc(TOC))
        self.assertEqual(commands[-1][0][-4:], ("rm", "-f", restore[-1], plan_path))

    def test_malformed_plan_fails_before_creating_a_database_and_cleans_both_files(self):
        install = FakeInstallation(toc=TOC + "malformed\n")
        with self.assertRaises(Blocked) as failure:
            self.invoke(install)
        self.assertEqual(failure.exception.code, "RESTORE_TOC")
        self.assertFalse(any("createdb" in str(call) for call in install.calls))
        cleanup = install.calls[-1][0]
        self.assertEqual(cleanup[3:5], ("rm", "-f"))
        self.assertEqual(cleanup[-1], cleanup[-2] + ".list")

    def test_failed_restore_cleans_files_without_deleting_any_database(self):
        install = FakeInstallation(fail=True)
        with self.assertRaises(Blocked):
            self.invoke(install)
        self.assertIn("rm", install.calls[-1][0])
        self.assertFalse(any("dropdb" in str(call) or "--clean" in str(call) for call in install.calls))

    def test_existing_database_and_invalid_live_targets_fail_before_copy_or_restore(self):
        for target in ("working", "working_test; DROP DATABASE working", "../unsafe_test", "plain"):
            install = FakeInstallation()
            with self.subTest(target=target), self.assertRaises(Blocked) as failure:
                self.invoke(install, target)
            self.assertEqual(failure.exception.code, "RESTORE_TARGET")
            self.assertEqual(install.calls, [])
        install = FakeInstallation()
        install.env = {**install.env, "POSTGRES_DB": "working_test"}
        with self.assertRaises(Blocked) as live:
            self.invoke(install, "working_test")
        self.assertEqual(live.exception.code, "RESTORE_TARGET")
        self.assertEqual(install.calls, [])
        install = FakeInstallation(exists="1")
        with self.assertRaises(Blocked) as failure:
            self.invoke(install)
        self.assertEqual(failure.exception.code, "RESTORE_EXISTS")
        self.assertFalse(any("--list" in str(call) or "createdb" in str(call) for call in install.calls))


if __name__ == "__main__":
    unittest.main()
