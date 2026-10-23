import { quantiles } from './contracts.mjs';

export const SOAK = Object.freeze({
  stages: [30, 60, 100],
  stageMs: 600000,
  periodMs: 10000,
  lateLimitMs: 1000,
  requestTimeoutMs: 10000,
  saveP95Ms: 700,
  readP95Ms: 400,
  checkoutDiagnosticP95Ms: 100,
});

// Fixture instrumentation only. Always use pg's callback implementation so the
// promise overload cannot recursively enter this wrapper and count twice.
export function instrumentPool(pool, record, now = () => performance.now()) {
  const original = pool.connect;
  pool.connect = function (callback) {
    const started = now();
    const acquire = (done) =>
      original.call(pool, (error, client, release) => {
        const acquired = now();
        const finish = record({ waitMs: acquired - started, failed: Boolean(error) });
        if (error) return done(error);
        let released = false;
        const measuredRelease = (error) => {
          if (released) throw new Error('fixture_double_release');
          released = true;
          finish?.(now() - acquired);
          return release(error);
        };
        client.release = measuredRelease;
        done(undefined, client, measuredRelease);
      });
    if (typeof callback === 'function') return acquire(callback);
    return new Promise((resolve, reject) =>
      acquire((error, client) => (error ? reject(error) : resolve(client))),
    );
  };
  return () => {
    pool.connect = original;
  };
}

// Fixed offered arrivals, independent of response latency. One outstanding
// chain per identity prevents same-document races; skipped arrivals fail gate.
export async function scheduledStage({
  actors,
  durationMs,
  periodMs,
  lateLimitMs,
  work,
  fatal,
  now = () => performance.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onProgress = () => {},
}) {
  const started = now(),
    busy = new Set(),
    pending = new Set();
  const result = {
    planned: Math.floor(durationMs / periodMs) * actors.length,
    offered: 0,
    launched: 0,
    completed: 0,
    failed: 0,
    skippedBusy: 0,
    skippedLate: 0,
    lateOver100Ms: 0,
    lagMs: [],
    actualDurationMs: 0,
  };
  onProgress(result);
  for (let slot = 0; slot < result.planned && !fatal(); slot++) {
    const due = started + (slot * periodMs) / actors.length;
    await sleep(Math.max(0, due - now()));
    if (fatal()) break;
    const lag = Math.max(0, now() - due),
      actor = actors[slot % actors.length];
    result.offered++;
    result.lagMs.push(lag);
    if (lag > 100) result.lateOver100Ms++;
    if (lag > lateLimitMs) {
      result.skippedLate++;
      continue;
    }
    if (busy.has(actor.index)) {
      result.skippedBusy++;
      continue;
    }
    result.launched++;
    busy.add(actor.index);
    const task = Promise.resolve()
      .then(() => work(actor))
      .then(
        () => {
          result.completed++;
        },
        () => {
          result.failed++;
        },
      )
      .finally(() => {
        busy.delete(actor.index);
        pending.delete(task);
      });
    pending.add(task);
  }
  if (!fatal()) await sleep(Math.max(0, started + durationMs - now()));
  await Promise.all(pending);
  result.actualDurationMs = now() - started;
  return result;
}

export function stageVerdict({
  schedule,
  saves,
  reads,
  checkout,
  failedAcquires,
  unreleasedAcquires = 0,
  errors,
  sampleErrors,
  actorsVerified,
  actorsExpected,
  acknowledged,
  verified,
}) {
  const checks = {
    offeredLoad:
      schedule.offered === schedule.planned &&
      schedule.completed === schedule.planned &&
      schedule.failed === 0 &&
      schedule.skippedBusy === 0 &&
      schedule.skippedLate === 0,
    generatorHeadroom: schedule.lateOver100Ms / Math.max(1, schedule.offered) <= 0.01,
    identities: actorsVerified === actorsExpected,
    correctness: acknowledged > 0 && acknowledged === verified && errors === 0,
    observation:
      sampleErrors === 0 && checkout.count > 0 && failedAcquires === 0 && unreleasedAcquires === 0,
    saveProductSlo: saves.count > 0 && saves.p95 <= SOAK.saveP95Ms,
    readProductSlo: reads.count > 0 && reads.p95 <= SOAK.readP95Ms,
    checkoutDiagnosticGuard: checkout.count > 0 && checkout.p95 <= SOAK.checkoutDiagnosticP95Ms,
  };
  return { verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks };
}

export function summarizePool(rows) {
  return {
    checkoutMs: quantiles(rows.map((r) => r.waitMs)),
    holdMs: quantiles(rows.filter((r) => r.holdMs !== undefined).map((r) => r.holdMs)),
    failedAcquires: rows.filter((r) => r.failed).length,
    unreleasedAcquires: rows.filter((r) => !r.failed && r.holdMs === undefined).length,
  };
}
