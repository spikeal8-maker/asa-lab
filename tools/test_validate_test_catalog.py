"""Local, unpublished branches are executable; missing Git is never clean proof."""
import subprocess
import unittest
from unittest.mock import patch

import validate_test_catalog as catalog


class BranchPresence(unittest.TestCase):
    def test_direct_main_deleted_optional_branch_uses_main_ancestry(self):
        task = {"branch": "codex/deleted-after-merge", "status": "in_progress"}
        branch = catalog._test_source_branch(task, {"mode": "direct_main"})
        with patch.object(catalog.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], returncode=1, stdout=""),
            subprocess.CompletedProcess([], returncode=0),
        ]) as run:
            self.assertTrue(catalog._checkout_contains_task_branch(branch))
        self.assertEqual(run.call_args_list[-1].args[0],
                         ["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"])
        self.assertEqual(task, {"branch": "codex/deleted-after-merge", "status": "in_progress"})

    def test_direct_main_behind_main_does_not_claim_executable_code(self):
        branch = catalog._test_source_branch({"branch": "codex/old"}, {"mode": "direct_main"})
        with patch.object(catalog.subprocess, "run", side_effect=[
            subprocess.CompletedProcess([], returncode=1, stdout=""),
            subprocess.CompletedProcess([], returncode=1),
        ]):
            self.assertFalse(catalog._checkout_contains_task_branch(branch))

    def test_coordinated_mode_retains_the_selected_task_branch(self):
        self.assertEqual(catalog._test_source_branch({"branch": "codex/work"}, {}), "codex/work")

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


class LocalEligibility(unittest.TestCase):
    def test_default_is_ineligible_and_false_cannot_define_order(self):
        errors = []
        catalog.validate_local_checks([{'id': 'A'}, {'id': 'B', 'local_check': {
            'eligible': False, 'reason': 'CI only', 'order': 1}}], errors)
        self.assertEqual(len(errors), 1)

    def test_invalid_types_groups_dependencies_and_cycles(self):
        def entry(test_id, **changes):
            return {'id': test_id, 'local_check': {
                'eligible': True, 'reason': 'safe', 'order': 10, 'group': 'owned', 'after': [], **changes}}
        for tests in ([entry('A', eligible='yes')], [entry('A', order=True)],
                      [entry('A', group='../outside')], [entry('A', after=['MISSING'])],
                      [entry('A', after=['B']), entry('B', after=['A'])],
                      [entry('A', after=['B']), entry('B', order=20)],
                      [entry('A', arbitrary='command')]):
            with self.subTest(tests=tests):
                errors = []
                catalog.validate_local_checks(tests, errors)
                self.assertTrue(errors)

    def test_valid_explicit_ordering(self):
        tests = [{'id': key, 'local_check': {'eligible': True, 'reason': 'safe',
                  'order': order, 'group': 'workspace', 'after': after}}
                 for key, order, after in [('A', 10, []), ('B', 20, ['A'])]]
        errors = []
        catalog.validate_local_checks(tests, errors)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
