"""v3 PostgreSQL pinning and fail-closed CI acceptance, preserving older manifests."""
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked, LEGACY_SERVICES, LEGACY_POSTGRES_IMAGES, REGISTRY, SERVICES, V3_SERVICES, validate_release
from deployment.release_channel import publication_channel
from deployment.releases import apply_release_environment, assert_ci, validate_resolved_images


def candidate(version):
    names = {1: LEGACY_SERVICES, 2: SERVICES, 3: V3_SERVICES}[version]
    return {'format': f'asa-deployment-v{version}', 'repository': 'spikeal8-maker/asa-lab',
            'revision': 'a' * 40, 'schema': 234, 'platform': 'linux/amd64', 'publicationRunId': 1,
            'images': {name: f'{REGISTRY}/{name}@sha256:' + 'b' * 64 for name in names}}


class PostgresReleaseTransportTests(unittest.TestCase):
    def test_publication_stays_v2_and_rejects_unaccepted_v3_activation(self):
        format_name, names = publication_channel()
        self.assertEqual(format_name, 'asa-deployment-v2')
        self.assertEqual(names, SERVICES)
        self.assertNotIn('postgres', names)
        with self.assertRaisesRegex(Blocked, 'v3 publication'):
            publication_channel({'format': 'asa-release-channel-v1', 'manifestFormat': 'asa-deployment-v3',
                                 'v3Activation': 'blocked_until_installed_bridge_acceptance'})

    def test_all_three_manifests_remain_valid_but_v3_requires_immutable_postgres(self):
        for version in (1, 2, 3):
            self.assertEqual(validate_release(candidate(version)), candidate(version))
        for replacement in (None, 'sha256:' + 'c' * 64, 'postgres:17.11-bookworm', f'{REGISTRY}/postgres:latest', f'{REGISTRY}/api@sha256:' + 'b' * 64):
            changed = candidate(3)
            if replacement is None:
                del changed['images']['postgres']
            else:
                changed['images']['postgres'] = replacement
            with self.subTest(replacement=replacement), self.assertRaises(Blocked):
                validate_release(changed)

    def test_v3_applies_postgres_digest_and_legacy_manifests_keep_official_base(self):
        for version in (1, 2, 3):
            install = MagicMock(process_env={})
            release = candidate(version)
            apply_release_environment(install, release)
            self.assertEqual(install.process_env['ASA_POSTGRES_IMAGE'],
                             release['images']['postgres'] if version == 3 else LEGACY_POSTGRES_IMAGES[release['format']])

    def test_legacy_selection_is_independent_of_current_candidate_baseline(self):
        with patch('runtime_image_baseline.runtime_defaults', side_effect=AssertionError('must not select current baseline')):
            for version in (1, 2):
                install = MagicMock(process_env={})
                apply_release_environment(install, candidate(version))
                self.assertEqual(install.process_env['ASA_POSTGRES_IMAGE'],
                                 'docker.io/library/postgres@sha256:e9243ab06e47223dedeb3c129fa9ece8d37f506bdc6ee943afb9335f98bb4854')

    def test_v3_refuses_an_effective_compose_postgres_substitution(self):
        release = candidate(3)
        services = {name: {'image': value} for name, value in release['images'].items()}
        services['postgres']['environment'] = {}
        services['migration'] = {'image': release['images']['api']}
        services['minio-init'] = {'image': release['images']['minio']}
        install = MagicMock(profile='dev')
        with patch('deployment.releases.attest_embedded_editor'), patch('deployment.releases.attest_database_targets'):
            install.compose.return_value = json.dumps({'services': services})
            validate_resolved_images(install, release)
            services['postgres']['image'] = 'postgres:latest'
            install.compose.return_value = json.dumps({'services': services})
            with self.assertRaisesRegex(Blocked, 'postgres'):
                validate_resolved_images(install, release)

    def test_v3_requires_latest_successful_security_for_the_exact_main_sha(self):
        general = {'name': 'ASA Lab Governance and Code Gates', 'head_sha': 'a' * 40,
                   'head_branch': 'main', 'status': 'completed', 'conclusion': 'success', 'run_number': 1}
        security = {**general, 'name': 'Runtime Image Security'}
        publication = {'name': 'ASA Portable Release', 'path': '.github/workflows/portable-release.yml',
                       'display_title': 'Release ' + 'a' * 40, 'head_branch': 'main',
                       'status': 'completed', 'conclusion': 'success'}
        for changes in (None, {}, {'conclusion': 'failure'}, {'status': 'in_progress'},
                        {'head_sha': 'c' * 40}, {'head_branch': 'feature'}, {'run_number': 2, 'conclusion': 'failure'}):
            runs = [general]
            if changes is not None:
                runs += [security, {**security, **changes}] if changes.get('run_number') else [{**security, **changes}]
            replies = [io.BytesIO(json.dumps({'workflow_runs': runs}).encode()), io.BytesIO(json.dumps(publication).encode())]
            with self.subTest(changes=changes), patch('deployment.releases.urllib.request.urlopen', side_effect=replies):
                if changes == {}:
                    assert_ci(candidate(3))
                else:
                    with self.assertRaises(Blocked):
                        assert_ci(candidate(3))


if __name__ == '__main__':
    unittest.main()
