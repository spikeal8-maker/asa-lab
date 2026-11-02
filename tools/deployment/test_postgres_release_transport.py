"""v3 PostgreSQL pinning and fail-closed CI acceptance, preserving older manifests."""
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment.contracts import Blocked, LEGACY_SERVICES, LEGACY_POSTGRES_IMAGES, REGISTRY, SERVICES, V3_SERVICES, validate_release
import asa_manager
from deployment.release_channel import publication_channel
from deployment.releases import apply_release_environment, assert_ci, fetch_images, validate_resolved_images


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

    def test_fresh_and_mirror_only_legacy_hosts_pull_and_attest_postgres_first(self):
        release = candidate(2)
        reference = LEGACY_POSTGRES_IMAGES[release['format']]
        image_id = 'sha256:' + 'c' * 64
        for mirror_only in (False, True):
            install = MagicMock() if mirror_only else None
            if install:
                install.identity.return_value = {'postgres': {'id': 'owned-pg-container', 'image': 'mirror.gcr.io/library/postgres@sha256:' + 'd' * 64}}
            def docker(args, **kwargs):
                if '{{.Id}}' in args or '{{.Image}}' in args:
                    return image_id
                if '{{.Os}}/{{.Architecture}}' in args:
                    return 'linux/amd64'
                if '--version' in args:
                    return 'postgres (PostgreSQL) 17.7 (Debian 17.7-3.pgdg12+1)'
                return release['revision']
            with self.subTest(mirror_only=mirror_only), patch('deployment.releases.run', side_effect=docker) as runner:
                fetch_images(release, install=install)
                self.assertEqual(runner.call_args_list[0].args[0], ['docker', 'pull', '--platform', 'linux/amd64', reference])
                postgres_checks = [c.args[0] for c in runner.call_args_list if reference in c.args[0]]
                self.assertTrue(any('--version' in args for args in postgres_checks))
                self.assertFalse(any('org.opencontainers.image.revision' in ' '.join(args) for args in postgres_checks))

    def test_changed_current_postgres_is_preserved_and_requires_explicit_migration(self):
        install = MagicMock()
        install.identity.return_value = {'postgres': {'id': 'owned-pg-container'}}
        def docker(args, **kwargs):
            if '{{.Id}}' in args:
                return 'sha256:' + 'c' * 64
            if '{{.Image}}' in args:
                return 'sha256:' + 'd' * 64
            if '--version' in args:
                return 'postgres (PostgreSQL) 17.7'
            return 'linux/amd64'
        with patch('deployment.releases.run', side_effect=docker), self.assertRaises(Blocked) as error:
            fetch_images(candidate(2), install=install)
        self.assertEqual(error.exception.code, 'POSTGRES_MIGRATION_REQUIRED')
        install.compose.assert_not_called()

    def test_failed_legacy_pull_stops_update_before_source_backup_or_downtime(self):
        with tempfile.TemporaryDirectory() as directory:
            install = MagicMock(root=Path(directory), state=Path(directory), settings={}, profile='dev')
            release = candidate(2)
            install.readiness.return_value = {'revision': release['revision'], 'schema': release['schema']}
            install.env = {name: 'http://127.0.0.1:4610' for name in ('ASA_UPDATE_ENTRY_ORIGIN', 'ASA_BLOCKS_PARENT_ORIGIN', 'ASA_BLOCKS_RUNTIME_ORIGIN')}
            with patch.object(asa_manager, 'doctor'), patch.object(asa_manager, 'clean_checkout'), patch.object(asa_manager, 'assert_ci'), \
                    patch.object(asa_manager, 'discover_release', return_value=release), \
                    patch('deployment.releases.run', side_effect=Blocked('PULL_UNAVAILABLE', 'synthetic missing legacy image', 'test')), \
                    patch.object(asa_manager, 'selected_source') as source, patch.object(asa_manager, 'export_backup') as backup, self.assertRaises(Blocked) as error:
                asa_manager.update(install)
            self.assertEqual(error.exception.code, 'PULL_UNAVAILABLE')
            source.assert_not_called()
            backup.assert_not_called()
            install.compose.assert_not_called()

    def test_legacy_overlay_cannot_replace_postgres(self):
        for version in (1, 2):
            release = candidate(version)
            services = {name: {'image': ref} for name, ref in release['images'].items()}
            services.update({'postgres': {'image': LEGACY_POSTGRES_IMAGES[release['format']], 'environment': {}},
                             'migration': {'image': release['images']['api']}, 'minio-init': {'image': release['images']['minio']}})
            install = MagicMock(profile='dev')
            with patch('deployment.releases.attest_embedded_editor'), patch('deployment.releases.attest_database_targets'):
                install.compose.return_value = json.dumps({'services': services})
                validate_resolved_images(install, release)
                services['postgres']['image'] = 'postgres:17.11-bookworm'
                install.compose.return_value = json.dumps({'services': services})
                with self.assertRaisesRegex(Blocked, 'legacy postgres'):
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
