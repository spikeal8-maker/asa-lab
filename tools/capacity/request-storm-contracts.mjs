import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
export { digest as documentDigest } from './contracts.mjs';

export const STORM_ORIGIN = 'http://127.0.0.1:4612';
export const STORM_API_ORIGIN = 'http://127.0.0.1:4611';
export const STORM_BASELINE = '6a876a942985780297cf346a9a85077be7479d0b';

export const STORM_CLIENT_MODULES = Object.freeze([
  'apps/web/src/api.ts',
  'apps/web/src/api-call.ts',
  'apps/web/src/session-fetch.ts',
  'apps/web/src/client-diagnostics.ts',
  'apps/web/src/analytics-runtime.ts',
  'apps/web/src/telemetry-context.ts',
  'apps/web/src/games/game-notifications.ts',
]);

/** @returns {import('vite').Plugin} */
export function stormSourcePlugin(entry, sourceRoot) {
  const selectedRoot = realpathSync(sourceRoot);
  const entryPath = realpathSync(entry).replaceAll('\\', '/');
  return {
    name: 'exact-request-storm-client-source',
    // Vite's own resolver otherwise finds the existing candidate file first.
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        importer?.split('?')[0].replaceAll('\\', '/') === entryPath &&
        source.startsWith('../../apps/')
      )
        return this.resolve(resolve(selectedRoot, source.slice(6)), importer, { skipSelf: true });
      return null;
    },
  };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const moduleFingerprint = (modules) => sha256(JSON.stringify(modules));

/** Inspect the emitted graph, independently of whether the resolver ran correctly. */
export function stormClientProvenance(chunks, sourceRoot, source) {
  const selectedRoot = realpathSync(sourceRoot);
  const selectedApp = resolve(selectedRoot, 'apps/web/src');
  const moduleFiles = new Map();
  if (!chunks.length || chunks.some((chunk) => chunk.type !== 'chunk'))
    throw Error('Missing real client bundle');
  for (const chunk of chunks) {
    if (!Array.isArray(chunk.moduleIds) || !chunk.modules)
      throw Error('Missing client module graph');
    for (const id of new Set([...chunk.moduleIds, ...Object.keys(chunk.modules)])) {
      // Rollup may decorate physical paths with a virtual prefix or a query.
      const undecorated = id.replace(/^\0+/, '').split('?')[0];
      const path = undecorated.startsWith('file:') ? fileURLToPath(undecorated) : undecorated;
      if (!path.replaceAll('\\', '/').includes('/apps/web/src/')) continue;
      if (!isAbsolute(path)) throw Error(`Unverifiable client module: ${id}`);
      const actual = realpathSync(path);
      const fromApp = relative(selectedApp, actual);
      if (!fromApp || fromApp === '..' || fromApp.startsWith(`..${sep}`) || isAbsolute(fromApp))
        throw Error(`Foreign client module outside selected source root: ${id}`);
      const repoPath = relative(selectedRoot, actual).split(sep).join('/');
      moduleFiles.set(repoPath, sha256(readFileSync(actual)));
    }
  }
  const missing = STORM_CLIENT_MODULES.filter((path) => !moduleFiles.has(path));
  if (missing.length) throw Error(`Missing required client modules: ${missing.join(', ')}`);
  const modules = [...moduleFiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const proof = {
    schemaVersion: 1,
    source,
    sourceRoot: selectedRoot,
    moduleCount: modules.length,
    modules,
    moduleFingerprint: moduleFingerprint(modules),
    bundleFingerprint: sha256(JSON.stringify(chunks.map((chunk) => [chunk.fileName, chunk.code]))),
  };
  assertStormClientProvenance(proof, source);
  return proof;
}

/** Old success:true reports without a checked module graph are not comparable evidence. */
export function assertStormClientProvenance(proof, source) {
  const digest = /^[a-f0-9]{64}$/;
  if (
    !proof ||
    proof.schemaVersion !== 1 ||
    proof.source !== source ||
    !/^[a-f0-9]{40}$/.test(source || '') ||
    typeof proof.sourceRoot !== 'string' ||
    !proof.sourceRoot ||
    !Array.isArray(proof.modules) ||
    proof.modules.length !== proof.moduleCount ||
    proof.modules.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        !entry[0].startsWith('apps/web/src/') ||
        entry[0].split('/').some((part) => !part || part === '.' || part === '..') ||
        entry[0].includes('\\') ||
        !digest.test(entry[1]),
    ) ||
    new Set(proof.modules.map(([path]) => path)).size !== proof.moduleCount ||
    STORM_CLIENT_MODULES.some((path) => !proof.modules.some(([included]) => included === path)) ||
    !digest.test(proof.bundleFingerprint) ||
    proof.moduleFingerprint !== moduleFingerprint(proof.modules)
  )
    throw Error('Verified client source provenance is required before comparison');
  return proof;
}

/** ps columns: pid, ppid, rss (KiB), lifetime %cpu, command name. */
export function stormChromiumResources(output, ownerPid, browserLive) {
  const rows = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(.+?)\s*$/.exec(line);
      if (!match) throw Error('Invalid Chromium process sample');
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        rss: Number(match[3]),
        cpu: Number(match[4]),
        name: match[5],
      };
    });
  const owned = new Set([ownerPid]);
  const pending = [ownerPid];
  for (let i = 0; i < pending.length; i++)
    for (const row of rows)
      if (row.parent === pending[i] && !owned.has(row.pid)) {
        owned.add(row.pid);
        pending.push(row.pid);
      }
  const chromium = rows.filter(
    (row) => owned.has(row.pid) && /^(?:chrome|chromium|headless_shell)(?:$|[-_])/.test(row.name),
  );
  if (browserLive && !chromium.length) throw Error('Live Chromium has no owned process samples');
  return {
    supported: true,
    scope: 'workload-process-descendants',
    processes: chromium.length,
    rssSumBytes: chromium.reduce((sum, row) => sum + row.rss * 1024, 0),
    lifetimeCpuPercentSum: chromium.reduce((sum, row) => sum + row.cpu, 0),
  };
}

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
