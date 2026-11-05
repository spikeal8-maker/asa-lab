import { createHash } from 'node:crypto';
import { URL } from 'node:url';

export const STORM_ORIGIN = 'http://127.0.0.1:4612';
export const STORM_API_ORIGIN = 'http://127.0.0.1:4611';
export const STORM_BASELINE = '6a876a942985780297cf346a9a85077be7479d0b';

/** The workload never accepts a site URL, a production DB name, or real credentials. */
export function assertStormEnvironment(env) {
  const users = Number(env.ASA_STORM_USERS);
  const variant = env.ASA_STORM_VARIANT;
  if (
    env.ASA_REQUEST_STORM !== '1' ||
    ![30, 60].includes(users) ||
    !['baseline', 'candidate'].includes(variant) ||
    !/^[a-f0-9]{40}$/.test(env.ASA_STORM_SOURCE_SHA || '') ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      env.ASA_STORM_RUN_ID || '',
    ) ||
    (variant === 'baseline' && env.ASA_STORM_SOURCE_SHA !== STORM_BASELINE)
  )
    throw new Error(
      'Explicit request-storm fixture, exact source, run UUID and 30/60 users required',
    );
  const database = `asa_request_storm_${variant}_test`;
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => new URL(env[key] || ''));
  if (
    urls.some(
      (url) =>
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['127.0.0.1', 'postgres'].includes(url.hostname) ||
        (url.port && url.port !== '5432') ||
        url.pathname !== `/${database}` ||
        url.search ||
        url.hash,
    ) ||
    urls[0].hostname !== urls[1].hostname ||
    urls[0].username !== 'postgres' ||
    urls[1].username !== 'asalab_app'
  )
    throw new Error('Only the paired disposable request-storm PostgreSQL databases are allowed');
  return { users, variant, database, source: env.ASA_STORM_SOURCE_SHA, run: env.ASA_STORM_RUN_ID };
}

export function stormQuantiles(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const at = (q) =>
    sorted.length ? Math.round(sorted[Math.ceil(sorted.length * q) - 1] * 100) / 100 : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export function stormRoute(path) {
  return path
    .split('?')[0]
    .replace(/(\/invites\/)[^/]+/g, '$1:code')
    .replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi, ':id');
}

export function documentDigest(document) {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

export function summarizeStorm(records, elapsedMs, users) {
  const measured = records.filter((record) => record.client >= 0);
  const byPhase = {};
  const byRoute = {};
  const statuses = {};
  for (const record of measured) {
    byPhase[record.phase] = (byPhase[record.phase] || 0) + 1;
    byRoute[record.route] = (byRoute[record.route] || 0) + 1;
    statuses[record.status] = (statuses[record.status] || 0) + 1;
  }
  return {
    requests: measured.length,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Math.round((measured.length * 100_000) / Math.max(1, elapsedMs)) / 100,
    requestsPerMinute: Math.round((measured.length * 6_000_000) / Math.max(1, elapsedMs)) / 100,
    requestsPerClient: Math.round((measured.length * 100) / users) / 100,
    latencyMs: stormQuantiles(
      measured.filter((record) => !record.injected).map((record) => record.durationMs),
    ),
    statuses,
    injectedFailures: measured.filter((record) => record.injected).length,
    unexpected5xx: measured.filter((record) => !record.injected && record.status >= 500).length,
    unexpected429: measured.filter((record) => !record.injected && record.status === 429).length,
    byPhase,
    byRoute,
  };
}
