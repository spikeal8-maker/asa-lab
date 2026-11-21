"""Real collector publication using synthetic Docker replies; no Docker/network/host access."""
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from collect_logs import Collector, DATABASE_DIAGNOSTICS
from deployment import operational


SERVICES = ['postgres', 'api', 'web', 'scratch', 'minio', 'search', 'migration', 'minio-init', 'frp']


class ObservedComposePolicyTests(unittest.TestCase):
    def collector(self):
        temporary = tempfile.TemporaryDirectory(prefix='asa-compose-policy-')
        self.addCleanup(temporary.cleanup)
        c = Collector(Path(temporary.name), {'project': 'asa-policy-fixture'})
        self.addCleanup(lambda: c.db.close())
        return c

    def inventory(self, c, services, generation=1, mutate=None):
        rows = [dict(Id=f'{name}-{generation}', Created=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat(),
            State={'Running': name not in ('migration', 'minio-init'), 'Status': 'running', 'ExitCode': 0},
            Config={'Labels': {'com.docker.compose.project': c.config['project'],
                'com.docker.compose.project.working_dir': str(c.root), 'com.docker.compose.service': name}})
            for name in services]
        if mutate: mutate(rows)
        def command(argv, **kwargs):
            if argv[:3] == ['docker', 'ps', '-aq']: return ' '.join(r['Id'] for r in rows).encode()
            if argv[:2] == ['docker', 'inspect']: return '\n'.join(json.dumps(r) for r in rows).encode()
            if argv[:2] == ['docker', 'logs']: return b''  # Successful empty log window is still observed.
            if argv[:2] == ['docker', 'exec']: return b'2'
            raise AssertionError('Unexpected command outside the closed synthetic Docker reply set')
        c.command = command
        c.docker(history=False)

    def catalog(self, c):
        c.publish()
        return json.loads((c.store/'catalog.json').read_text(encoding='utf-8'))

    def test_actual_inventory_publisher_declares_every_observed_recent_source(self):
        c = self.collector()
        self.inventory(c, SERVICES)
        catalog = self.catalog(c)
        rules = {r['source']: r for r in catalog['requiredSources']['sources']}
        for name in SERVICES:
            rule = rules[name + ':recent']
            self.assertEqual(rule, {'source': name + ':recent', 'applicable': True,
                'maxAgeSeconds': 300, 'requireThrough': True})
        observed = [s for s in catalog['sources'] if s['source'].endswith(':recent')]
        self.assertEqual({s['source'] for s in observed}, {s + ':recent' for s in SERVICES})
        self.assertTrue(all(s['state'] == 'ok' and s['collectedThrough'] for s in observed))
        self.assertEqual(c.state('docker:required-services'), sorted(SERVICES))

    def test_removed_service_stays_required_and_immediately_unavailable_after_cold_reopen(self):
        c = self.collector()
        self.inventory(c, SERVICES)
        before = self.catalog(c)
        prior = next(s for s in before['sources'] if s['source'] == 'search:recent')
        c.db.close()
        # Reuse the actual on-disk index in a fresh collector, not a copied catalog declaration.
        reopened = Collector(c.root, c.config)
        self.addCleanup(reopened.db.close)
        self.inventory(reopened, [s for s in SERVICES if s not in ('search', 'frp')])
        catalog = self.catalog(reopened)
        rules = {r['source']: r for r in catalog['requiredSources']['sources']}
        sources = {s['source']: s for s in catalog['sources']}
        for name in ('search:recent', 'frp:recent'):
            self.assertTrue(rules[name]['applicable'])
            self.assertTrue(rules[name]['requireThrough'])
            self.assertEqual(sources[name]['state'], 'unavailable')
        self.assertEqual(sources['search:recent']['collectedThrough'], prior['collectedThrough'])
        self.assertEqual(sources['search:recent']['lastCollectedAt'], prior['lastCollectedAt'])

    def test_restart_same_service_has_one_stable_required_id_and_real_log_errors_stay_errors(self):
        c = self.collector()
        self.inventory(c, SERVICES)
        self.catalog(c)
        self.inventory(c, SERVICES, generation=2)
        catalog = self.catalog(c)
        ids = [r['source'] for r in catalog['requiredSources']['sources']]
        self.assertEqual(ids.count('search:recent'), 1)
        self.assertEqual(c.state('docker:required-services'), sorted(SERVICES))
        command = c.command
        def failed_logs(argv, **kwargs):
            if argv[:2] == ['docker', 'logs'] and argv[-1].startswith('search-'):
                raise OSError('synthetic log read failure')
            return command(argv, **kwargs)
        c.command = failed_logs
        c.docker(history=False)
        catalog = self.catalog(c)
        self.assertEqual(next(s['state'] for s in catalog['sources'] if s['source'] == 'search:recent'), 'error')

    def test_foreign_root_project_or_malformed_labels_cannot_expand_required_policy(self):
        for field, value in [('com.docker.compose.project', 'foreign'),
                ('com.docker.compose.project.working_dir', '/foreign'),
                ('com.docker.compose.service', '../foreign'),
                ('com.docker.compose.service', 'forged:recent'),
                ('com.docker.compose.service', None)]:
            with self.subTest(field=field, value=value):
                c = self.collector()
                self.inventory(c, ['postgres'])
                self.inventory(c, ['postgres', 'search'],
                    mutate=lambda rows: rows[-1]['Config']['Labels'].update({field: value}))
                self.assertEqual(c.state('docker:required-services'), ['postgres'])
                catalog = self.catalog(c)
                self.assertEqual(next(s['state'] for s in catalog['sources'] if s['source'] == 'docker'), 'error')
                self.assertNotIn('search:recent', {r['source'] for r in catalog['requiredSources']['sources']})

    def test_catalog_health_rows_are_not_an_authority_for_new_service_declarations(self):
        c = self.collector()
        self.inventory(c, ['postgres'])
        c.status('unattested:recent', 'ok', 'synthetic untrusted row')
        catalog = self.catalog(c)
        self.assertIn('unattested:recent', {s['source'] for s in catalog['sources']})
        self.assertNotIn('unattested:recent', {r['source'] for r in catalog['requiredSources']['sources']})

    def test_empty_or_unidentified_inventory_does_not_forget_the_previous_obligation(self):
        c = self.collector()
        self.inventory(c, SERVICES)
        self.catalog(c)
        for inventory in ([], ['api']):
            with self.subTest(inventory=inventory):
                self.inventory(c, inventory)
                catalog = self.catalog(c)
                self.assertEqual(c.state('docker:required-services'), sorted(SERVICES))
                self.assertIn('search:recent', {r['source'] for r in catalog['requiredSources']['sources']})
                self.assertEqual(next(s['state'] for s in catalog['sources'] if s['source'] == 'docker'), 'error')

    def test_retained_identity_bounds_and_baseline_rules_fail_closed(self):
        for malformed in (None, 'api', {}, [None], ['x:recent'], ['a'*122], ['service'+str(i) for i in range(257)]):
            with self.subTest(malformed=type(malformed).__name__), self.assertRaises(ValueError):
                operational.compose_service_ids(malformed)
        with self.assertRaises(ValueError):
            operational.compose_service_ids(['service'+str(i) for i in range(256)], ['one-more'])
        with self.assertRaises(ValueError):
            operational.required_sources({}, DATABASE_DIAGNOSTICS['sources'], 'linux',
                ['service'+str(i) for i in range(240)])
        rules = operational.required_sources({}, DATABASE_DIAGNOSTICS['sources'], 'linux', ['postgres'])['sources']
        self.assertTrue({'api:recent', 'web:recent', 'scratch:recent', 'minio:recent', 'operations:backup'} <=
            {r['source'] for r in rules})


if __name__ == '__main__':
    unittest.main()
