"""Actual collector regression: first-cycle originals and both commit boundaries."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from collect_logs import Collector, normalize, now


class RetirementAtomicTests(unittest.TestCase):
    def fixture(self, root):
        c = Collector(root, {}); c.reader_format = 2
        metadata = {}
        base_time = datetime.now(timezone.utc)-timedelta(minutes=10)
        for i in range(256):
            at=(base_time+timedelta(milliseconds=i)).isoformat(timespec='milliseconds').replace('+00:00','Z')
            e = normalize('api', 'fixture', at, str(i)); c.add(e)
            m = c.write_segment(f'seg-{i+1:016d}-{i+1:016d}.jsonl', [e]); metadata[m['file']] = m
        c.db.execute('UPDATE events SET published=1'); c.set_state('segments', metadata); c.db.commit()
        with patch.object(c, 'compact', side_effect=lambda s, r: (s, r)): c.publish()
        earlier = (base_time-timedelta(minutes=1)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        c.add(normalize('api', 'created in this publish', earlier, 'fresh-original'))
        c.db.commit()
        return c

    def test_freshly_written_compacted_original_metadata_survives_publish_and_cold_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); c = self.fixture(root)
            c.publish()
            retired = c.state('retired:segments'); meta = c.state('retired:metadata')
            fresh = 'seg-0000000000000257-0000000000000257.jsonl.gz'
            self.assertIn(fresh, retired)
            self.assertEqual(set(retired), set(meta))
            self.assertEqual(meta[fresh]['count'], 1)
            # No original receipt is invented for this newly-written predecessor.
            self.assertIsNone(c.db.execute('SELECT 1 FROM segment_verification WHERE name=?', (fresh,)).fetchone())
            expected = c.db.execute('SELECT count(*),count(distinct id) FROM events').fetchone()
            c.db.close(); c = Collector(root, {}); c.reader_format = 2
            c.publish()
            self.assertEqual(c.db.execute('SELECT count(*),count(distinct id) FROM events').fetchone(), expected)
            self.assertIn(fresh, c.state('retired:metadata')); c.db.close()

    def test_power_loss_before_or_after_compaction_commit_keeps_atomic_retirement(self):
        for after_commit in (False, True):
            with self.subTest(after_commit=after_commit), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); c = self.fixture(root); real = c.db
                class Crash:
                    armed = False
                    def __getattr__(self, name): return getattr(real, name)
                    def execute(self, sql, *args):
                        value = real.execute(sql, *args)
                        if sql == "DELETE FROM state WHERE key='compaction:pending'":
                            self.armed = True
                            if not after_commit: raise RuntimeError('power loss before commit')
                        return value
                    def commit(self):
                        value = real.commit()
                        if self.armed and after_commit: raise RuntimeError('power loss after commit')
                        return value
                c.db = Crash()
                with self.assertRaisesRegex(RuntimeError, 'power loss'): c.publish()
                real.rollback(); real.close()
                c = Collector(root, {}); c.reader_format = 2
                self.assertFalse(c.state('compaction:pending'))
                self.assertEqual(set(c.state('retired:segments')), set(c.state('retired:metadata')))
                c.publish()
                self.assertEqual(c.db.execute('SELECT count(*),count(distinct id) FROM events').fetchone(), (257, 257))
                c.db.close()


if __name__ == '__main__': unittest.main()
