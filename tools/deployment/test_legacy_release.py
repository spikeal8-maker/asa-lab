import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked, REGISTRY, SERVICES
from deployment import legacy_release as release_tools


def release():
    return {'format': 'asa-deployment-v2', 'repository': 'spikeal8-maker/asa-lab',
            'revision': 'a' * 40, 'schema': 268, 'platform': 'linux/amd64', 'publicationRunId': 7,
            'images': {name: f'{REGISTRY}/{name}@sha256:' + 'b' * 64 for name in SERVICES}}


class ExactReleaseTests(unittest.TestCase):
    def fixture(self, payload=None, *, symlink=False):
        raw = json.dumps(payload or release()).encode()
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as archive:
            member = tarfile.TarInfo('release.json')
            member.size = len(raw)
            if symlink:
                member.type = tarfile.SYMTYPE
                member.linkname = '/private.env'
            archive.addfile(member, None if symlink else io.BytesIO(raw))
        layer = output.getvalue()
        manifest = {'layers': [{'size': len(layer), 'digest': release_tools.digest(layer)}]}
        return layer, manifest

    def test_exact_release_reads_verified_archive_without_docker_or_extraction(self):
        layer, manifest = self.fixture()
        with patch.object(release_tools, 'registry_token', return_value='ephemeral'), \
             patch.object(release_tools, 'registry_manifest', return_value=(manifest, 'sha256:' + 'd' * 64)) as registry, \
             patch.object(release_tools, 'read_url', return_value=(layer, {})), \
             patch.object(release_tools, 'assert_ci') as ci:
            selected, receipt = release_tools.read_exact_release('a' * 40)
        self.assertEqual(selected, release())
        self.assertEqual(receipt['deploymentDigest'], 'sha256:' + 'd' * 64)
        ci.assert_called_once_with(release())
        self.assertEqual(registry.call_count, 6)
        self.assertEqual(registry.call_args_list[0].args[1], 'a' * 40)

    def test_changed_manifest_sha_archive_link_and_checksum_fail_closed(self):
        for payload, link, corrupt in (({**release(), 'revision': 'c' * 40}, False, False),
                                       (release(), True, False), (release(), False, True)):
            layer, manifest = self.fixture(payload, symlink=link)
            if corrupt:
                layer += b'corrupt'
            with self.subTest(payload=payload['revision'], link=link, corrupt=corrupt), \
                 patch.object(release_tools, 'registry_token', return_value='ephemeral'), \
                 patch.object(release_tools, 'registry_manifest', return_value=(manifest, 'sha256:' + 'd' * 64)), \
                 patch.object(release_tools, 'read_url', return_value=(layer, {})), \
                 patch.object(release_tools, 'assert_ci') as ci, self.assertRaises(Blocked):
                release_tools.read_exact_release('a' * 40)
            ci.assert_not_called()

    def test_latest_short_sha_and_foreign_repository_are_never_accepted(self):
        for value in ('stable', 'main', 'latest', 'bd804264', '../main'):
            with self.subTest(value=value), patch.object(release_tools, 'read_url') as request, self.assertRaises(Blocked):
                release_tools.read_exact_release(value)
            request.assert_not_called()
        with self.assertRaises(Blocked):
            release_tools.registry_manifest('../foreign', 'a' * 40, 'ephemeral')

    def test_registry_digest_must_match_response_bytes(self):
        raw = b'{"layers":[]}'
        with patch.object(release_tools, 'read_url', return_value=(raw, {'Docker-Content-Digest': 'sha256:' + '0' * 64})), self.assertRaises(Blocked):
            release_tools.registry_manifest('deployment', 'a' * 40, 'ephemeral')
        with patch.object(release_tools, 'read_url', return_value=(raw, {})), self.assertRaises(Blocked):
            release_tools.registry_manifest('api', 'sha256:' + '0' * 64, 'ephemeral')


class ManagerEvidenceTests(unittest.TestCase):
    sha = 'a' * 40
    url = 'https://github.com/spikeal8-maker/asa-lab/pull/810#pullrequestreview-123'

    def test_repository_comparison_is_allowed_but_traversal_and_other_origins_are_not(self):
        path = 'compare/' + self.sha + '...main?per_page=1'
        with patch.object(release_tools, 'read_url', return_value=(b'{"status":"ahead"}', {})) as request:
            self.assertEqual(release_tools.github_json(path), {'status': 'ahead'})
        self.assertEqual(request.call_args.args[0], 'https://api.github.com/repos/spikeal8-maker/asa-lab/' + path)
        for unsafe in ('../other', '/absolute', 'compare/../other', 'https://example.com/x',
                       '//example.com/x', 'compare/%2e%2e/other', 'compare\\other', 'pulls/1#fragment'):
            with self.subTest(path=unsafe), patch.object(release_tools, 'read_url') as request, self.assertRaises(Blocked):
                release_tools.github_json(unsafe)
            request.assert_not_called()

    def fixtures(self):
        review = {'commit_id': self.sha, 'state': 'COMMENTED',
                  'body': f'INDEPENDENT_REVIEW\nVERDICT: APPROVE\nREVIEWED_SHA: {self.sha}'}
        runs = [{'id': 1, 'name': 'ASA Lab Governance and Code Gates', 'path': '.github/workflows/spec-validation.yml',
                 'head_sha': self.sha, 'run_number': 1, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'},
                {'id': 2, 'name': 'ASA Portable Delivery Checks', 'path': '.github/workflows/portable-delivery.yml',
                 'head_sha': self.sha, 'run_number': 1, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'}]
        return review, {'head': {'sha': self.sha}}, {'workflow_runs': runs}

    def test_attributed_exact_sha_review_and_both_workflows_required(self):
        with patch.object(release_tools, 'github_json', side_effect=self.fixtures()):
            evidence = release_tools.verify_manager_evidence(self.sha, self.url)
        self.assertEqual(evidence['workflows']['ASA Portable Delivery Checks'], 2)
        for mutate in ('old_review', 'changes_requested', 'moved_head', 'failed', 'stale', 'wrong_workflow'):
            review, pull, runs = self.fixtures()
            if mutate == 'old_review': review['commit_id'] = 'b' * 40
            if mutate == 'changes_requested': review['state'] = 'CHANGES_REQUESTED'
            if mutate == 'moved_head': pull['head']['sha'] = 'b' * 40
            if mutate == 'failed': runs['workflow_runs'][1]['conclusion'] = 'failure'
            if mutate == 'stale': runs['workflow_runs'][1]['head_sha'] = 'b' * 40
            if mutate == 'wrong_workflow': runs['workflow_runs'][0]['path'] = '.github/workflows/unrelated.yml'
            with self.subTest(mutate=mutate), patch.object(release_tools, 'github_json', side_effect=(review, pull, runs)), self.assertRaises(Blocked):
                release_tools.verify_manager_evidence(self.sha, self.url)

    def test_foreign_or_missing_review_url_never_requests_evidence(self):
        for url in ('', self.url.replace('github.com', 'github.example'), self.url.replace('/asa-lab/', '/foreign/')):
            with self.subTest(url=url), patch.object(release_tools, 'github_json') as request, self.assertRaises(Blocked):
                release_tools.verify_manager_evidence(self.sha, url)
            request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
