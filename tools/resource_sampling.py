"""One in-process resource producer; it never touches SQLite or log segments."""
from collections import deque
from copy import deepcopy
import threading
import time
import uuid
from datetime import datetime, timezone


class ResourceSampler:
    def __init__(self, capture, interval=60, capacity=8, clock=time.monotonic):
        self.capture, self.interval, self.clock = capture, interval, clock
        self.capacity = capacity
        self.lock = threading.Lock()
        self.queue = deque()
        self.targets = ((), None)
        self.sequence = self.dropped = 0
        self.stream_id = str(uuid.uuid4())
        self.stop_event = threading.Event()
        self.thread = None

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
            if len(self.queue) == self.capacity:
                self.queue.popleft(); self.dropped += 1
            self.queue.append(deepcopy(value))
        # No catch-up burst after an overrun or sleep; retain the absolute cadence.
        return deadline + (missed + 1) * self.interval

    def drain(self):
        with self.lock:
            values = list(self.queue); self.queue.clear()
            for value in values: value['sampling']['droppedSamplesTotal'] = self.dropped
        return values

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
