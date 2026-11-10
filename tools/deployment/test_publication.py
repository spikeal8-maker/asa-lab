import unittest
from unittest.mock import patch

from tools.deployment.contracts import Blocked
from tools.deployment.publication import should_promote, verify_recovery_source


def release(revision, schema):
    return {'revision': revision, 'schema': schema}


class StablePromotionTests(unittest.TestCase):
    def setUp(self):
        history = {'a': {'a'}, 'b': {'a', 'b'}, 'c': {'a', 'b', 'c'}, 'd': {'a', 'b', 'd'}}
        self.ancestor = lambda older, newer: older in history[newer]

    def test_candidate_can_advance_schema_while_main_keeps_moving(self):
        self.assertTrue(should_promote(release('b', 314), release('a', 308), 'c', self.ancestor))

    def test_duplicate_or_late_workflow_keeps_the_published_channel(self):
        for candidate in (release('b', 314), release('a', 308)):
            with self.subTest(candidate=candidate):
                self.assertFalse(should_promote(candidate, release('b', 314), 'c', self.ancestor))

    def test_divergent_source_or_schema_downgrade_blocks_promotion(self):
        for candidate, code in ((release('d', 314), 'RELEASE_SOURCE'), (release('b', 307), 'RELEASE_SCHEMA')):
            with self.subTest(candidate=candidate), self.assertRaises(Blocked) as error:
                should_promote(candidate, release('a', 308), 'c', self.ancestor)
            self.assertEqual(error.exception.code, code)


class RecoveryPublicationTests(unittest.TestCase):
    def test_recovery_requires_the_original_runtime_and_exact_forward_migrations(self):
        candidate, base, target, main = (letter * 40 for letter in 'abcd')
        for change, trees, eligible in (
            ('A\tmigrations/0314_test.sql', ['tree', 'tree'], True),
            ('A\tmigrations/0314_test.sql\nM\tDockerfile.api', ['tree', 'tree'], False),
            ('A\tmigrations/0314_test.sql', ['changed', 'tree'], False),
        ):
            with self.subTest(change=change, trees=trees), \
                    patch('tools.deployment.publication.is_ancestor', return_value=True), \
                    patch('tools.deployment.publication.run', side_effect=[f'{candidate} {base}', change, *trees]):
                if eligible:
                    verify_recovery_source(candidate, base, target, main)
                else:
                    with self.assertRaisesRegex(Blocked, 'migrations|migration'):
                        verify_recovery_source(candidate, base, target, main)
