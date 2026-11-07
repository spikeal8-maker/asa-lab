from pathlib import Path
import shutil
import tempfile
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import github_queue as g

class GithubQueueTest(unittest.TestCase):
    def setUp(self):
        # Never let versioned production receipts influence bootstrap fixtures:
        # after CTRL-00 is ACCEPTED_MAIN the same tests must remain green.
        temporary = tempfile.TemporaryDirectory(prefix="classroom-queue-regression-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        shutil.copyfile(ROOT / "registry.json", self.root / "registry.json")
        self.registry = g.registry(self.root)
        g.validate(self.registry, self.root)

    def test_open_task_issue_reused_without_duplicate(self):
        action, name, issue = g.choose(self.root, self.registry, {'CTRL-00': {'state': 'open', 'number': 716, 'user': {'login': 'spikeal8-maker'}}})
        self.assertEqual((action, name, issue['number']), ('existing', 'CTRL-00', 716))

    def test_closed_issue_without_accepted_receipt_blocks_next(self):
        with self.assertRaisesRegex(g.QueueError, 'no ACCEPTED_MAIN'):
            g.choose(self.root, self.registry, {'CTRL-00': {'state': 'closed', 'number': 716}})

    def test_no_issue_yields_only_first_ready_task(self):
        action, name, issue = g.choose(self.root, self.registry, {})
        self.assertEqual((action, name, issue), ('ready', 'CTRL-00', None))

    def test_two_open_tasks_block_unscoped_parallel_work(self):
        with self.assertRaisesRegex(g.QueueError, 'More than one open'):
            g.choose(self.root, self.registry, {
                'CTRL-00': {'state': 'open', 'number': 716},
                'QA-01': {'state': 'open', 'number': 717}})

    def test_unknown_issue_marker_blocks(self):
        with self.assertRaisesRegex(g.QueueError, 'Unexpected'):
            g.choose(self.root, self.registry, {'UNAPPROVED': {'state': 'open', 'number': 1}})

    @patch.object(g, 'github_json')
    def test_list_ignores_pr_and_unrelated_issues(self, api):
        api.return_value = [
            {'body': '<!-- ASA-CLASSROOM-TASK:CTRL-00 -->', 'state': 'open', 'number': 716},
            {'body': '<!-- ASA-CLASSROOM-TASK:CTRL-00 -->', 'state': 'open', 'number': 99, 'pull_request': {}},
            {'body': 'ordinary issue', 'state': 'open', 'number': 1}]
        self.assertEqual(set(g.get_program_issues('spikeal8-maker/asa-lab', 'token')), {'CTRL-00'})

    @patch.object(g, 'github_json')
    def test_create_only_from_current_main(self, api):
        sha = 'a' * 40
        def reply(method, path, token, data=None):
            if path.endswith('/git/ref/heads/main'): return {'object': {'sha': sha}}
            if 'issues?state=all' in path: return []
            if method == 'POST':
                self.assertIn('<!-- ASA-CLASSROOM-TASK:CTRL-00 -->', data['body'])
                self.assertIn('docs/execution/current.yaml', data['body'])
                return {'html_url': 'https://github.com/spikeal8-maker/asa-lab/issues/999'}
            self.fail('Unexpected ' + path)
        api.side_effect = reply
        with patch.object(g, 'checked_local_head', return_value=sha):
            self.assertEqual(g.run(self.root, 'spikeal8-maker/asa-lab', 'token', 'create', 715), ('created', 'CTRL-00'))

    @patch.object(g, 'github_json')
    def test_changed_main_prevents_issue_write(self, api):
        api.return_value = {'object': {'sha': 'a' * 40}}
        with patch.object(g, 'checked_local_head', return_value='b' * 40):
            with self.assertRaisesRegex(g.QueueError, 'differs'):
                g.run(self.root, 'spikeal8-maker/asa-lab', 'token', 'create', 715)
        self.assertFalse(any(call.args[0] == 'POST' for call in api.call_args_list))

if __name__ == '__main__':
    unittest.main()
