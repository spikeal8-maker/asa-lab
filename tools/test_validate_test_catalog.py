"""Local, unpublished branches are executable; missing Git is never clean proof."""
import subprocess
import unittest
from unittest.mock import patch

import validate_test_catalog as catalog


class BranchPresence(unittest.TestCase):
    def test_current_unpublished_branch_is_verified_locally(self):
        with patch.object(catalog.subprocess, "run", return_value=subprocess.CompletedProcess(
            [], 0, "codex/asa-access-a-result-a\n", ""
        )) as run:
            self.assertTrue(catalog._checkout_contains_task_branch("codex/asa-access-a-result-a"))
            self.assertEqual(run.call_count, 1)

    def test_another_local_branch_is_not_enough(self):
        with patch.object(catalog.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], 0, "main\n", ""),
            subprocess.CompletedProcess([], 128, "", "missing ref"),
        ]):
            self.assertFalse(catalog._checkout_contains_task_branch("codex/access"))

    def test_detached_ci_requires_ancestry(self):
        for code in (0, 1, 128):
            with self.subTest(code=code), patch.object(catalog.subprocess, "run", side_effect=[
                subprocess.CompletedProcess([], 1, "", ""),
                subprocess.CompletedProcess([], code, "", ""),
            ]):
                self.assertEqual(catalog._checkout_contains_task_branch("codex/access"), code == 0)

    def test_git_unavailable_cannot_prove_code_present(self):
        with patch.object(catalog.subprocess, "run", side_effect=OSError("git unavailable")):
            self.assertFalse(catalog._checkout_contains_task_branch("codex/access"))


if __name__ == "__main__":
    unittest.main()
