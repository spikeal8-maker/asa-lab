"""Sizing regressions use synthetic metadata, never a live host or database."""

import contextlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deployment import resources
from deployment.contracts import Blocked
from deployment.system import Installation


class ResourceTests(unittest.TestCase):
    def install(self):
        return SimpleNamespace(root=Path('.'), env={}, process_env={},
                               container_environment=lambda _: {})

    def test_defaults_preserve_measured_main_and_actual_analytics_pool(self):
        config = resources.pool_configuration({})
        result = resources.connection_budget(config, {'maxConnections': 100, 'superuserReserved': 3,
                                                       'reservedConnections': 0, 'connections': 7})
        self.assertEqual(result['selectedMainPool'], 10)
        self.assertEqual(result['selectedAnalyticsPool'], 1)
        self.assertEqual(result['plannedConnections'], 19)
        self.assertEqual(result['remainingSlots'], 78)
        self.assertTrue(result['fits'])

    def test_reserved_pg17_slots_and_exact_boundary(self):
        database = {'maxConnections': 25, 'superuserReserved': 3, 'reservedConnections': 3, 'connections': 2}
        self.assertTrue(resources.connection_budget(resources.pool_configuration({}), database)['fits'])
        database['maxConnections'] = 24
        self.assertFalse(resources.connection_budget(resources.pool_configuration({}), database)['fits'])

    def test_all_explicit_values_are_strict_and_checked_before_docker(self):
        for key in (*resources.POOL_DEFAULTS, resources.RESERVE_KEY):
            for raw in ('0', '-1', '10junk', '1.5', '1e2', ' 10', '2147483648'):
                with self.subTest(key=key, raw=raw), tempfile.TemporaryDirectory() as directory:
                    Path(directory, '.env').write_text(f'{key}="{raw}"\n')
                    with patch('deployment.system.run') as run, self.assertRaises(Blocked):
                        Installation(directory)
                    run.assert_not_called()

    def test_docker_vm_not_host_memory_and_fresh_database_is_unknown(self):
        with patch.object(resources, '_read', return_value={'memoryBytes': 16 * 1024**3, 'cpus': 12}):
            report = resources.resource_report(self.install(), {})
        self.assertEqual(report['scope'], 'docker-engine-not-host')
        self.assertEqual(report['docker']['memoryBytes'], 16 * 1024**3)
        self.assertNotIn('fits', report['database'])
        self.assertEqual(report['capacityAcceptance'], 'not-measured')

    def test_runtime_drift_unlimited_memory_and_secret_free_projection(self):
        install = self.install()
        install.env = {'ASA_DB_POOL_MAX': '20', 'POSTGRES_PASSWORD': 'never-print-this'}
        install.container_environment = lambda _: {'APP_DATABASE_URL': 'never-print-this'}
        replies = [{'memoryBytes': 16 * 1024**3, 'cpus': 12},
                   {'memoryLimitBytes': 0, 'memoryReservationBytes': 0, 'nanoCpus': 0, 'pidsLimit': None},
                   {'memoryLimitBytes': 0, 'memoryReservationBytes': 0, 'nanoCpus': 0, 'pidsLimit': None},
                   ['APP_DATABASE_URL=never-print-this'],
                   {'maxConnections': 100, 'superuserReserved': 3, 'reservedConnections': 0, 'connections': 7}]
        with patch.object(resources, '_read', side_effect=replies) as read:
            report = resources.resource_report(install, {'api': {'id': 'api'}, 'postgres': {'id': 'pg', 'running': True}})
        self.assertEqual(report['runningPool']['ASA_DB_POOL_MAX'], 10)
        self.assertEqual(report['database']['selectedMainPool'], 20)
        self.assertTrue(any('differs' in warning for warning in report['warnings']))
        self.assertTrue(any('unbounded' in warning for warning in report['warnings']))
        self.assertNotIn('never-print-this', json.dumps(report))
        command = read.call_args.args[0]
        self.assertIn('default_transaction_read_only=on', ' '.join(command))
        self.assertIn('statement_timeout=3000', ' '.join(command))
        self.assertNotIn('never-print-this', ' '.join(command))

    def test_insufficient_budget_blocks_without_changing_settings(self):
        report = {'database': {'fits': False}}
        with patch.object(resources, 'resource_report', return_value=report), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(Blocked) as failure:
                resources.check_resources(self.install(), {})
        self.assertEqual(failure.exception.code, 'RESOURCE_CONNECTIONS')

    def test_probe_timeout_and_errors_do_not_leak_private_output(self):
        for result in (subprocess.TimeoutExpired('docker', 8), OSError('private-secret')):
            with patch.object(resources.subprocess, 'run', side_effect=result) as run:
                with self.assertRaises(Blocked) as failure:
                    resources._read(['docker', 'info'], self.install())
                self.assertNotIn('private-secret', str(failure.exception))
                self.assertEqual(run.call_args.kwargs['timeout'], 8)
        with patch.object(resources.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='private-secret')):
            with self.assertRaises(Blocked) as failure:
                resources._read(['docker', 'info'], self.install())
            self.assertNotIn('private-secret', str(failure.exception))

    def test_compose_wires_all_supported_pool_knobs(self):
        # The resolved Compose values are also exercised by the Docker CI smoke;
        # this cheap guard catches adding a runtime knob without its transport.
        compose = (Path(__file__).resolve().parents[2] / 'compose.yaml').read_text()
        for key, default in resources.POOL_DEFAULTS.items():
            self.assertIn(f'{key}: ${{{key}:-{default}}}', compose)

    def test_owned_container_log_defaults_are_explicit_and_scoped(self):
        compose = (Path(__file__).resolve().parents[2] / 'compose.yaml').read_text()
        self.assertIn("x-asa-container-logging: &asa-container-logging\n  driver: json-file\n  options:\n    max-size: '10m'\n    max-file: '5'\n", compose)
        consumers = re.findall(r'^  ([a-z][a-z-]*):\n    logging: \*asa-container-logging$', compose, re.M)
        self.assertCountEqual(consumers, ('postgres', 'migration', 'minio', 'minio-init',
                                         'api', 'search', 'web', 'scratch'))
        self.assertEqual(compose.count('    logging:'), 8)

    @unittest.skipUnless(os.environ.get('ASA_TEST_DOCKER_COMPOSE') == '1', 'Resolved Compose contract runs in Linux CI')
    def test_resolved_profiles_keep_all_eight_owned_log_budgets(self):
        # Resolve real anchors, interpolation, profiles and overlay merges.
        # This read-only command creates no containers, images or volumes.
        root = Path(__file__).resolve().parents[2]
        owned = ('postgres', 'migration', 'minio', 'minio-init', 'api', 'search', 'web', 'scratch')
        synthetic = {
            'COMPOSE_PROJECT_NAME': 'asa-log-contract-test',
            'POSTGRES_PASSWORD': 'synthetic-ci-only',
            'MIGRATION_DATABASE_URL': 'postgres://admin:synthetic-ci-only@postgres:5432/asa_log_test',
            'MIGRATION_EXPECT_DATABASE': 'asa_log_test',
            'MIGRATION_CONFIRM': 'APPLY:asa_log_test',
            'ASA_APP_DB_PASSWORD': 'synthetic-ci-only',
            'APP_DATABASE_URL': 'postgres://asalab_app:synthetic-ci-only@postgres:5432/asa_log_test',
            'ASA_SETTINGS_ENCRYPTION_KEY': '01' * 32,
        }
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / 'empty.env'
            env_file.write_text('')  # Never consume an operator-owned .env.
            for profile in (None, 'dev', 'test', 'staging', 'production'):
                with self.subTest(profile=profile or 'base'):
                    command = ['docker', 'compose', '--env-file', str(env_file),
                               '-f', str(root / 'compose.yaml')]
                    if profile:
                        command += ['-f', str(root / f'compose.{profile}.yaml')]
                    command += ['--profile', '*', 'config', '--format', 'json']
                    result = subprocess.run(command, cwd=root, env={**os.environ, **synthetic},
                                            capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, 0, 'Compose configuration failed; private output withheld')
                    services = json.loads(result.stdout)['services']
                    for service in owned:
                        self.assertEqual(services[service]['logging'], {
                            'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '5'}
                        }, service)

    @unittest.skipUnless(os.environ.get('ASA_TEST_DOCKER_COMPOSE') == '1', 'Resolved Compose contract runs in Linux CI')
    def test_resolved_compose_preserves_custom_pool_and_timeout_values(self):
        root = Path(__file__).resolve().parents[2]
        custom = {key: str(value + 7) for key, value in resources.POOL_DEFAULTS.items()}
        result = subprocess.run(['docker', 'compose', '-f', str(root / 'compose.yaml'), 'config', '--format', 'json'],
                                cwd=root, env={**os.environ, **custom}, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, 'Compose configuration failed; private output withheld')
        environment = json.loads(result.stdout)['services']['api']['environment']
        self.assertEqual({key: str(environment[key]) for key in custom}, custom)


if __name__ == '__main__':
    unittest.main()
