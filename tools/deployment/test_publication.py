import unittest

from tools.deployment.contracts import Blocked
from tools.deployment.publication import should_promote


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
