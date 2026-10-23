"""One resource producer with a private durable spool, separate from the log index.

The production spool preserves samples across slow collection and restarts.
The small in-memory mode remains available for once/test/degraded operation.
"""
from collections import deque
from contextlib import contextmanager
from copy import deepcopy
import threading
import time
import uuid
import json
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timezone


class ResourceSampler:
    def __init__(self, capture, interval=60, capacity=8, clock=time.monotonic, spool=None, max_bytes=16 * 1024 * 1024):
        self.capture, self.interval, self.clock = capture, interval, clock
        self.capacity = capacity
        self.lock = threading.Lock()
        self.queue = deque()
        self.pending = None
        self.targets = ((), None)
        self.sequence = self.dropped = 0
        self.stream_id = str(uuid.uuid4())
        self.stop_event = threading.Event()
        self.thread = None
        self.spool = Path(spool) if spool else None
        self.max_bytes = max_bytes
        self.storage_error = None
        if self.spool:
            self.spool.parent.mkdir(parents=True, exist_ok=True)
            from deployment.paths import plain_paths
            plain_paths(self.spool.parent, (self.spool.name,))
            with self.spool_db() as db:
                db.executescript('''CREATE TABLE IF NOT EXISTS samples(
                    ordinal INTEGER PRIMARY KEY AUTOINCREMENT,stream TEXT,sequence INTEGER,payload TEXT,bytes INTEGER,
                    UNIQUE(stream,sequence)); CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY,value INTEGER);''')
                self.dropped = self.counter(db)
            if os.name != 'nt': os.chmod(self.spool, 0o600)

    @contextmanager
    def spool_db(self):
        db = sqlite3.connect(self.spool, timeout=5)
        try:
            db.execute('PRAGMA synchronous=FULL')
            db.execute(f'PRAGMA max_page_count={max(32, self.max_bytes // 4096)}')
            with db: yield db
        finally: db.close()

    @staticmethod
    def counter(db, name='dropped'):
        row = db.execute('SELECT value FROM counters WHERE name=?', (name,)).fetchone()
        return row[0] if row else 0

    def loss_counters(self):
        with self.lock, self.spool_db() as db:
            return dict(droppedSamplesTotal=max(self.dropped, self.counter(db)),
                expiredSamplesTotal=self.counter(db, 'expired'),
                quotaDiscardedSamplesTotal=self.counter(db, 'quota_discarded'))

    def dispose(self, sampling, reason):
        """Record explicit terminal loss, never a successful publication ACK.

        Expired/quota-discarded samples cannot be published on a later retry.
        Deletion and monotonic reason counters commit together, so crash/replay
        cannot silently lose the disposition or double-count it.
        """
        if reason not in ('expired', 'quota_discarded'): raise ValueError('Invalid resource sample disposition')
        with self.lock:
            with self.spool_db() as db:
                changed = db.execute('DELETE FROM samples WHERE stream=? AND sequence=?',
                    (sampling['streamId'], sampling['sequence'])).rowcount
                if changed:
                    dropped = max(self.dropped, self.counter(db)) + changed
                    db.execute("INSERT OR REPLACE INTO counters VALUES('dropped',?)", (dropped,))
                    db.execute('INSERT OR REPLACE INTO counters VALUES(?,?)', (reason, self.counter(db, reason) + changed))
            if changed: self.dropped = max(self.dropped, dropped)

    def batch(self, limit=128):
        """Read without deleting: only a successful catalog publication may ACK.

        Main-index commit without catalog replacement is replayed after restart.
        The existing stable stream/sequence makes this replay idempotent.
        """
        if not self.spool:
            value = self.acquire()
            return [value] if value else []
        with self.lock, self.spool_db() as db:
            self.dropped = max(self.dropped, self.counter(db))
            values = [json.loads(row[0]) for row in db.execute('SELECT payload FROM samples ORDER BY ordinal LIMIT ?', (limit,))]
            for value in values:
                value['sampling']['droppedSamplesTotal'] = self.dropped
                value['sampling']['expiredSamplesTotal'] = self.counter(db, 'expired')
                value['sampling']['quotaDiscardedSamplesTotal'] = self.counter(db, 'quota_discarded')
                if self.storage_error: value['sampling']['spoolError'] = self.storage_error
            return values

    def set_targets(self, containers, postgres):
        with self.lock:
            self.targets = (tuple(containers), postgres)

    def sample(self, deadline):
        started = self.clock()
        with self.lock: targets = self.targets
        # Capture handles component errors using a fixed error vocabulary.
        try: value = self.capture(*targets)
        except Exception:
            value = dict(kind='runtime_metrics', module='system', sampledAt=datetime.now(timezone.utc).isoformat(),
                         incomplete=True, level='error', failedComponents=['sampler'])
        finished = self.clock()
        self.sequence += 1
        missed = max(0, int((finished - deadline) // self.interval))
        value['sampling'] = dict(streamId=self.stream_id, sequence=self.sequence, intervalSeconds=self.interval,
            scheduleLagMs=round(max(0, started-deadline)*1000),
            durationMs=round(max(0, finished-started)*1000), missedIntervals=missed)
        with self.lock:
            if self.spool:
                try:
                    encoded = json.dumps(value, separators=(',', ':'))
                    size = len(encoded.encode('utf-8'))
                    with self.spool_db() as db:
                        used = db.execute('SELECT coalesce(sum(bytes),0) FROM samples').fetchone()[0]
                        if size > 256 * 1024 or used + size > self.max_bytes // 2:
                            self.dropped += 1
                            self.storage_error = 'resource_spool_full'
                        else:
                            db.execute('INSERT INTO samples(stream,sequence,payload,bytes) VALUES(?,?,?,?)',
                                       (self.stream_id, self.sequence, encoded, size))
                            self.storage_error = None
                        db.execute("INSERT OR REPLACE INTO counters VALUES('dropped',?)", (self.dropped,))
                except (sqlite3.Error, OSError):
                    self.dropped += 1
                    self.storage_error = 'resource_spool_write_failed'
            elif len(self.queue) == self.capacity:
                self.queue.popleft(); self.dropped += 1
                self.queue.append(deepcopy(value))
            else:
                self.queue.append(deepcopy(value))
        # No catch-up burst after an overrun or sleep; retain the absolute cadence.
        return deadline + (missed + 1) * self.interval

    def acquire(self):
        """Reserve one sample until its consumer has durably committed it.

        At most capacity queued samples plus one reserved sample are retained.
        Producer overflow cannot evict the unacknowledged reservation.
        """
        if self.spool:
            values = self.batch(1)
            return values[0] if values else None
        with self.lock:
            if self.pending is None and self.queue: self.pending = self.queue.popleft()
            if self.pending is None: return None
            value = deepcopy(self.pending)
            value['sampling']['droppedSamplesTotal'] = self.dropped
            if self.storage_error: value['sampling']['spoolError'] = self.storage_error
            return value

    def acknowledge(self, sampling):
        if self.spool:
            with self.lock, self.spool_db() as db:
                changed = db.execute('DELETE FROM samples WHERE stream=? AND sequence=?',
                    (sampling['streamId'], sampling['sequence'])).rowcount
                if changed != 1: raise ValueError('Resource sample acknowledgement does not match reservation')
            return
        with self.lock:
            if self.pending is None or any(self.pending['sampling'][key] != sampling[key] for key in ('streamId', 'sequence')):
                raise ValueError('Resource sample acknowledgement does not match reservation')
            self.pending = None

    def start(self):
        if self.thread: raise RuntimeError('Resource sampler already started')
        def run():
            deadline = self.clock()
            while not self.stop_event.wait(max(0, deadline-self.clock())):
                deadline = self.sample(deadline)
        self.thread = threading.Thread(target=run, name='asa-resource-sampler', daemon=True)
        self.thread.start()

    def stop(self, timeout=30):
        self.stop_event.set()
        if self.thread: self.thread.join(timeout)
        return not self.thread or not self.thread.is_alive()
