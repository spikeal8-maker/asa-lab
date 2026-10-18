import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function profile() {
  return JSON.parse(readFileSync(new URL('./profile-v1.json', import.meta.url), 'utf8'));
}
export function validateProfile(p) {
  const fail = () => {
    throw new Error('Invalid capacity workload profile');
  };
  if (p.id !== 'C3000-PROFILE-V1' || p.targetActiveSessions !== 3000) fail();
  for (const mix of [p.identityPercent, p.admissionPercent, p.modulePercent])
    if (
      !mix ||
      Object.values(mix).some((v) => !Number.isInteger(v) || v <= 0) ||
      Object.values(mix).reduce((a, b) => a + b, 0) !== 100
    )
      fail();
  for (const distribution of [p.documentSizes, p.mediaSizes])
    if (
      !Array.isArray(distribution) ||
      distribution.some(
        (v) =>
          !Number.isInteger(v.bytes) ||
          v.bytes <= 0 ||
          !Number.isInteger(v.percent) ||
          v.percent <= 0,
      ) ||
      distribution.reduce((n, v) => n + v.percent, 0) !== 100
    )
      fail();
  if (
    !Array.isArray(p.stages) ||
    p.stages[0] !== 30 ||
    p.stages.at(-1) !== 3000 ||
    p.stages.some((n, i) => !Number.isInteger(n) || (i > 0 && n <= p.stages[i - 1]))
  )
    fail();
  const b = p.backendBaseline;
  if (
    b.sessions !== 30 ||
    b.accounts + b.studentSeats !== b.sessions ||
    b.blocks + b.electronics !== b.sessions ||
    b.saveWaves !== 2 ||
    b.waveIntervalSeconds !== 60 ||
    !b.missingLayers?.length
  )
    fail();
  return p;
}
export function assertIsolatedEnvironment(env) {
  if (
    env.ASA_BLOCKS_RUNTIME_ORIGIN !== 'http://127.0.0.1:4612' ||
    env.ASA_OBJECT_STORAGE_ENDPOINT !== 'http://127.0.0.1:19000'
  )
    throw new Error(
      'Loopback-only capacity runtime and unused object-store configuration required',
    );
  if (
    env.ASA_CAPACITY_BASELINE !== '1' ||
    env.GITHUB_ACTIONS !== 'true' ||
    !/^\d+$/.test(env.GITHUB_RUN_ID || '') ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
  )
    throw new Error('Explicit disposable GitHub capacity fixture required');
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => new URL(env[key] || ''));
  if (
    urls.some(
      (url) =>
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.hostname !== '127.0.0.1' ||
        url.port !== '5432' ||
        url.pathname !== '/asa_capacity_test' ||
        url.search ||
        url.hash,
    ) ||
    urls[0].username !== 'postgres' ||
    urls[1].username !== 'asalab_app'
  )
    throw new Error('Matching loopback disposable capacity database required');
  return true;
}
export function quantiles(values) {
  if (!values.length) return { count: 0, p50: null, p95: null, p99: null, max: null };
  if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Invalid duration sample');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] * 100) / 100;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}

export function sessionIdentity(kind, body, expected) {
  const id =
    kind === 'account' ? body?.user?.id : kind === 'seat' ? body?.student?.seatId : undefined;
  if (body?.authenticated !== true || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
    throw new Error('Capacity actor is not authenticated');
  const key = `${kind}:${id}`;
  if (expected !== undefined && key !== expected)
    throw new Error('Capacity actor identity changed');
  return key;
}
