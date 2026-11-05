import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { endianness } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

export const SCALE_LEVELS = Object.freeze([30, 60, 100, 150, 200]);
export const SCALE_ORIGIN = 'http://web:8080';
export const SCALE_DATABASE = 'asalab_test';
// The public header's "Проекты" link opens the gallery. The measured Seat
// journey must click the native personal-project link instead.
export const SCALE_PROJECTS_LINK_SELECTOR =
  'nav[aria-label="Личные и рабочие разделы"] a[aria-label="Мои проекты"][href="/#/projects"]';

/** Preserve machine-readable causes without persisting URLs, SQL, credentials,
 * request bodies or arbitrary exception messages. The count remains unbounded
 * evidence even when the bounded diagnostic details are full. */
export function createScaleObserverJournal() {
  const state = {
    count: 0,
    dropped: 0,
    details: /** @type {Array<Record<string, string | number | boolean | null>>} */ ([]),
  };
  const codes = new Set([
    'ENOENT',
    'EACCES',
    'EPERM',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    'EIO',
    'ENOSPC',
    'ABORT_ERR',
    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    'served_script_incomplete',
    'served_script_differs_from_image',
    'served_script_not_in_manifest',
    'invalid_proc_clock',
    'invalid_proc_stat',
    'invalid_proc_status',
    'missing_proc_owner',
    'missing_owned_chromium',
    'unsupported_proc_architecture',
    'proc_process_bound',
  ]);
  const categories = new Map([
    ['Query read timeout', 'query_read_timeout'],
    ['timeout exceeded when trying to connect', 'connection_timeout'],
    ['Connection terminated unexpectedly', 'connection_terminated'],
    ['Invalid Chromium process sample', 'invalid_chromium_process_sample'],
    ['Live Chromium has no owned process samples', 'no_owned_chromium_process_sample'],
  ]);
  return {
    state,
    record(stage, phase, error, atMs = Date.now()) {
      state.count++;
      if (state.details.length >= 32) {
        state.dropped++;
        return;
      }
      const cause = error && typeof error === 'object' ? error : {};
      const label = (value) =>
        typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(value) ? value : 'unknown';
      state.details.push({
        atMs,
        stage: label(stage),
        phase: label(phase),
        name: [
          'Error',
          'TypeError',
          'RangeError',
          'TimeoutError',
          'AbortError',
          'FixtureFailure',
        ].includes(cause.name)
          ? cause.name
          : 'Error',
        code:
          typeof cause.code === 'string' &&
          (codes.has(cause.code) || /^[0-9][A-Z0-9]{4}$/.test(cause.code))
            ? cause.code
            : 'unknown',
        syscall: ['spawn ps', 'read', 'open', 'connect'].includes(cause.syscall)
          ? cause.syscall
          : null,
        command: cause.path === 'ps' ? 'ps' : null,
        errno:
          Number.isSafeInteger(cause.errno) && Math.abs(cause.errno) <= 4095 ? cause.errno : null,
        signal: ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(cause.signal) ? cause.signal : null,
        killed: cause.killed === true,
        messageCategory: categories.get(cause.message) ?? 'unclassified',
      });
    },
  };
}

/** The pinned slim test image has no procps/ps. Read the same process fields
 * directly: RSS is KiB from status; lifetime CPU uses stat ticks and the actual
 * AT_CLKTCK value, never an assumed100Hz or an unavailable-data zero fallback. */
export async function readScaleChromiumResources(ownerPid, browserLive, procRoot = '/proc') {
  const signal = globalThis.AbortSignal.timeout(2000);
  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  if (!['x64', 'arm64'].includes(process.arch) || endianness() !== 'LE')
    fail('unsupported_proc_architecture');
  const auxv = await readFile(join(procRoot, 'self/auxv'), { signal });
  let ticksPerSecond = 0;
  if (auxv.length % 16 !== 0) fail('invalid_proc_clock');
  for (let offset = 0; offset < auxv.length; offset += 16) {
    const type = auxv.readBigUInt64LE(offset);
    if (type === 0n) break;
    // Linux AT_CLKTCK (auxvec.h): frequency at which times() increments.
    if (type === 17n) ticksPerSecond = Number(auxv.readBigUInt64LE(offset + 8));
  }
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) fail('invalid_proc_clock');
  const pids = (await readdir(procRoot)).filter((entry) => /^[1-9][0-9]*$/.test(entry));
  if (pids.length > 16384) fail('proc_process_bound');
  const number = (value) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail('invalid_proc_stat');
    return Number(value);
  };
  const rows = [];
  // Keep simultaneous filesystem reads bounded at higher learner counts.
  for (let offset = 0; offset < pids.length; offset += 32) {
    const chunk = await Promise.all(
      pids.slice(offset, offset + 32).map(async (pid) => {
        let stat;
        try {
          stat = await readFile(join(procRoot, pid, 'stat'), { encoding: 'utf8', signal });
        } catch (error) {
          if (error?.code === 'ENOENT') return null; // A process exited during enumeration.
          throw error;
        }
        const first = stat.indexOf(' (');
        const last = stat.lastIndexOf(') ');
        if (first < 0 || last <= first || stat.slice(0, first) !== pid) fail('invalid_proc_stat');
        const fields = stat
          .slice(last + 2)
          .trim()
          .split(/\s+/);
        if (fields.length < 20 || !/^[RSDZTWtXxKWPIN]$/.test(fields[0])) fail('invalid_proc_stat');
        return {
          pid: number(pid),
          parent: number(fields[1]),
          name: stat.slice(first + 2, last),
          state: fields[0],
          cpuTicks: number(fields[11]) + number(fields[12]),
          startedTicks: number(fields[19]),
        };
      }),
    );
    rows.push(...chunk.filter(Boolean));
  }
  if (!rows.some((row) => row.pid === ownerPid)) fail('missing_proc_owner');
  const owned = new Set([ownerPid]);
  const pending = [ownerPid];
  for (let index = 0; index < pending.length; index++)
    for (const row of rows)
      if (row.parent === pending[index] && !owned.has(row.pid)) {
        owned.add(row.pid);
        pending.push(row.pid);
      }
  const chromium = rows.filter(
    (row) =>
      owned.has(row.pid) &&
      !['Z', 'X', 'x'].includes(row.state) &&
      /^(?:chrome|chromium|headless_shell)(?:$|[-_])/.test(row.name),
  );
  const samples = [];
  for (let offset = 0; offset < chromium.length; offset += 32) {
    const chunk = await Promise.all(
      chromium.slice(offset, offset + 32).map(async (row) => {
        let status;
        try {
          status = await readFile(join(procRoot, String(row.pid), 'status'), {
            encoding: 'utf8',
            signal,
          });
        } catch (error) {
          if (error?.code === 'ENOENT') return null;
          throw error;
        }
        const pid = /^Pid:\s*(\d+)\s*$/m.exec(status);
        const rss = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
        if (/^State:\s*[ZXx]\b/m.test(status)) return null; // Exited after the stat read.
        if (!pid || Number(pid[1]) !== row.pid || !rss) fail('invalid_proc_status');
        return { ...row, rssBytes: number(rss[1]) * 1024 };
      }),
    );
    samples.push(...chunk.filter(Boolean));
  }
  const uptime = Number(
    (await readFile(join(procRoot, 'uptime'), { encoding: 'utf8', signal })).trim().split(/\s+/)[0],
  );
  if (!Number.isFinite(uptime) || uptime <= 0) fail('invalid_proc_clock');
  let lifetimeCpuPercentSum = 0;
  for (const sample of samples) {
    const lifetime = uptime - sample.startedTicks / ticksPerSecond;
    if (lifetime <= 0) fail('invalid_proc_clock');
    lifetimeCpuPercentSum += (100 * sample.cpuTicks) / ticksPerSecond / lifetime;
  }
  const rssSumBytes = samples.reduce((sum, sample) => sum + sample.rssBytes, 0);
  if (browserLive && (!samples.length || !rssSumBytes)) fail('missing_owned_chromium');
  return {
    supported: true,
    source: 'linux-procfs',
    scope: 'workload-process-descendants',
    processes: samples.length,
    rssSumBytes,
    lifetimeCpuPercentSum,
    ticksPerSecond,
  };
}

export const SCALE_OPERATIONS = Object.freeze([
  'login',
  'portal',
  'electronics-open',
  'electronics-save',
  'electronics-reload',
  'electronics-outage-save',
  'electronics-offline-edit',
  'electronics-recovery',
  'scratch-open',
  'scratch-save',
  'scratch-reload',
  'scratch-outage-save',
  'scratch-offline-edit',
  'scratch-recovery',
]);

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// These thresholds are source-controlled before the first workload. No environment
// variable changes the SLO, editor profile or safety floors after seeing a result.
export const SCALE_PROFILE = freeze({
  schemaVersion: 1,
  id: 'P0-CLASSROOM-FULL-UI-V1',
  levels: SCALE_LEVELS,
  calibration: { users: 2, result: 'VALID_FIXTURE', capacityEvidence: false },
  classrooms: {
    maximumSeats: 30,
    distribution: Object.fromEntries(
      [2, ...SCALE_LEVELS].map((users) => [
        users,
        Array.from({ length: Math.ceil(users / 30) }, (_, index) =>
          Math.min(30, users - index * 30),
        ),
      ]),
    ),
    assignment:
      'contiguous independent cohorts; each Seat authenticates with its own classroom join code',
  },
  users: 'independent StudentSeat browser contexts; account control is separate',
  ingress: {
    origin: SCALE_ORIGIN,
    nodeEnv: 'test',
    database: SCALE_DATABASE,
    runtimeRole: 'asalab_app',
    topology: 'owned Docker Web reverse proxy to API; all clients share the same proxy peer/NAT',
    auth: 'actual native UI bot challenge, normal codes/passwords and cookie sessions; no injected identity or privilege',
    enforcementDifference:
      'NODE_ENV=test does not force production Secure cookies or production-only botProof enforcement; no production auth equivalence is claimed',
    admission: 'unchanged application rate/admission limits and RLS; no trusted-source-wide bypass',
    qualification: 'fixed isolated test ingress only; no FRP or public production capacity claim',
  },
  editors: ['electronics', 'scratch'],
  editorConcurrency: 'all N learners in each editor, in separate sequential phases',
  electronics:
    'one resistor-axial placed in the real blank circuit; resistance 1000+10*client+step ohms for steps1,2,3; no wires or simulation load',
  scratch:
    'native Apple library sprite added to the default project; renamed Scale-{client}-{step}, x=(client%80)+step,y=0 for steps1,2,3; actual costume/object-store persistence and native minute autosave; no script blocks added',
  telemetryOutage:
    'native editor reload observes actual telemetry503 before editing; this fault preparation is outside save timing',
  portalDefinition: 'projects navigation to visible usable project list, after login',
  slo: {
    authSuccessRatio: 1,
    saveSuccessRatio: 1,
    unexpected5xx: 0,
    unexpected429: 0,
    portalP95Ms: 2000,
  },
  deadlinesMs: { login: 30000, portal: 15000, editor: 60000, save: 90000, recovery: 90000 },
  healthyObservationMs: 15000,
  maximumHttpObservations: 200000,
  maximumControlObservations: 50000,
  retainedState:
    'fresh owned database per workflow; earlier-level synthetic rows remain, earlier browser contexts are closed',
  setupRetryBudgetMs: 120000,
  setupMaximumRetriesPerOperation: 3,
  offlineMs: 10000,
  levelTimeoutMs: 720000,
  resources: {
    minimumAvailableBytes: 2 * 1024 ** 3,
    minimumAvailableFraction: 0.15,
    minimumDiskBytes: 10 * 1024 ** 3,
    maximumContainerMemoryFraction: 0.85,
    maximumSampleGapMs: 10000,
    driverMemoryLimitBytes: 8 * 1024 ** 3,
  },
  operationNames: SCALE_OPERATIONS,
  server: {
    apiPoolMax: 10,
    apiConnectionTimeoutMs: 5000,
    apiStatementAndQueryTimeoutMs: 15000,
    analyticsPoolMax: 1,
    acquisitionPoolMax: 1,
    uvThreadpoolSize: 8,
    postgres:
      'pinned official image defaults; actual max_connections/shared_buffers/work_mem captured before calibration',
  },
  limitations: [
    'Generator and server share this isolated hosted runner; report generator limitations separately.',
    'A maximum passing tested level is a lower bound for this exact profile, not absolute product capacity.',
    'Loopback/Compose evidence does not qualify Windows, public FRP, VPN or production topology.',
    'Chromium summed RSS may double-count shared pages; safety uses available/cgroup memory.',
  ],
});

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
        .join(',') +
      '}'
    );
  const result = JSON.stringify(value);
  if (result === undefined || (typeof value === 'number' && !Number.isFinite(value)))
    throw Error('Only finite JSON evidence is allowed');
  return result;
}

export const scaleHash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : canonicalJson(value))
    .digest('hex');
export const SCALE_PROFILE_HASH = scaleHash(SCALE_PROFILE);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

export function assertScaleEnvironment(env, browser = false) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'spikeal8-maker/asa-lab' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
    !sha(env.ASA_SCALE_SHA) ||
    !/^[a-f0-9]{32}$/.test(env.ASA_SCALE_RUN_TOKEN || '') ||
    env.ASA_SCALE_PROFILE_HASH !== SCALE_PROFILE_HASH ||
    env.DOCKER_HOST ||
    env.DOCKER_CONTEXT
  )
    throw Error('Explicit exact-source hosted GitHub capacity fixture required');
  if (browser) {
    if (env.ASA_E2E_EXTERNAL !== 'true' || env.ASA_E2E_BASE_URL !== SCALE_ORIGIN)
      throw Error('Capacity browser requires the owned Compose Web origin');
    for (const key of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
      const url = new URL(env[key] || '');
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.hostname !== 'postgres' ||
        (url.port && url.port !== '5432') ||
        url.pathname !== '/' + SCALE_DATABASE ||
        url.search ||
        url.hash ||
        url.username !== (key === 'TEST_DATABASE_URL' ? 'postgres' : 'asalab_app')
      )
        throw Error('Capacity browser only accepts its isolated test database');
    }
    const mode = env.ASA_SCALE_MODE;
    if (
      !['capacity', 'calibration'].includes(mode) ||
      (mode === 'calibration'
        ? Number(env.ASA_SCALE_USERS) !== 2
        : !SCALE_LEVELS.includes(Number(env.ASA_SCALE_USERS)))
    )
      throw Error('Unknown capacity/calibration level');
  }
  return {
    schemaVersion: 1,
    sourceSha: env.ASA_SCALE_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    runToken: env.ASA_SCALE_RUN_TOKEN,
    profileHash: SCALE_PROFILE_HASH,
  };
}

export function assertScaleDockerContext(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0]?.Name !== 'default' ||
    value[0]?.Endpoints?.docker?.Host !== 'unix:///var/run/docker.sock'
  )
    throw Error('Capacity Docker must be the hosted runner local default socket');
}

export function assertScaleImages(images, sourceSha) {
  if (!sha(sourceSha)) throw Error('Invalid source revision');
  for (const service of ['api', 'web', 'scratch']) {
    const image = images.find((item) => item.service === service);
    if (!image || !/^sha256:[a-f0-9]{64}$/.test(image.id || '') || image.revision !== sourceSha)
      throw Error('Missing or mixed exact-source production image: ' + service);
  }
  if (new Set(images.map((item) => item.service)).size !== images.length)
    throw Error('Duplicate image service evidence');
  return scaleHash(images);
}

export function assertPriorScaleLevels(previous, users, identity) {
  const index = SCALE_LEVELS.indexOf(users);
  if (index < 0 || previous.length !== index)
    throw Error('Capacity levels cannot be skipped or repeated');
  previous.forEach((receipt, position) => {
    if (receipt.users !== SCALE_LEVELS[position] || receipt.status !== 'PASS')
      throw Error('Previous capacity level is not fully confirmed');
    for (const key of [
      'sourceSha',
      'runId',
      'attempt',
      'runToken',
      'profileHash',
      'environmentHash',
      'imageManifestHash',
    ])
      if (!identity[key] || receipt[key] !== identity[key])
        throw Error('Stale or mixed previous level receipt: ' + key);
  });
}

export function createScaleLedger(users, calibration = false) {
  if (calibration ? users !== 2 : !SCALE_LEVELS.includes(users))
    throw Error('Unknown capacity level');
  return SCALE_OPERATIONS.flatMap((name) =>
    Array.from({ length: users }, (_, client) => ({
      id: name + ':' + client,
      client,
      name,
      status: 'NOT_STARTED',
      startedAtMs: null,
      endedAtMs: null,
      durationMs: null,
      attempts: 0,
    })),
  );
}

/** @returns {{cohort: number, planned: number, clients: number[]}[]} */
export function scaleCohortPlan(users, calibration = false) {
  if (calibration ? users !== 2 : !SCALE_LEVELS.includes(users))
    throw Error('Unknown classroom cohort level');
  const distribution = SCALE_PROFILE.classrooms.distribution[users];
  let first = 0;
  return distribution.map((planned, cohort) => {
    const result = {
      cohort,
      planned,
      clients: Array.from({ length: planned }, (_, offset) => first + offset),
    };
    first += planned;
    return result;
  });
}

export function scaleQuantiles(values) {
  if (values.some((value) => !finite(value))) throw Error('Non-finite latency evidence');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) =>
    sorted.length ? Math.round(sorted[Math.ceil(sorted.length * q) - 1] * 100) / 100 : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export const scaleIsSave = (name) => name.endsWith('-save') || name.endsWith('-recovery');
export const scaleNeedsReadback = (name) => scaleIsSave(name) || name.endsWith('-reload');

function validateLedger(operations, users, calibration) {
  const expected = createScaleLedger(users, calibration);
  if (
    !Array.isArray(operations) ||
    operations.length !== expected.length ||
    new Set(operations.map((operation) => operation.id)).size !== expected.length
  )
    throw Error('Every planned operation must remain in the denominator');
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  for (const planned of expected) {
    const operation = byId.get(planned.id);
    if (
      !operation ||
      operation.client !== planned.client ||
      operation.name !== planned.name ||
      !['NOT_STARTED', 'STARTED', 'ACKNOWLEDGED', 'VERIFIED', 'FAILED', 'TIMED_OUT'].includes(
        operation.status,
      ) ||
      !integer(operation.attempts)
    )
      throw Error('Invalid operation ledger');
    if (operation.status === 'VERIFIED') {
      if (
        !finite(operation.startedAtMs) ||
        !finite(operation.endedAtMs) ||
        !finite(operation.durationMs) ||
        operation.endedAtMs < operation.startedAtMs ||
        operation.attempts < 1 ||
        Math.abs(operation.endedAtMs - operation.startedAtMs - operation.durationMs) > 2
      )
        throw Error('Verified operation lacks coherent timing');
      if (scaleNeedsReadback(operation.name)) {
        const proof = operation.verification;
        if (
          !proof ||
          proof.kind !== 'independent-authenticated-api-readback' ||
          proof.httpStatus !== 200 ||
          proof.identityMatched !== true ||
          !digest(proof.expectedContentHash) ||
          proof.expectedContentHash !== proof.actualContentHash ||
          !digest(proof.documentHash) ||
          !integer(proof.revisionBefore) ||
          !integer(proof.revisionAfter) ||
          proof.revisionAfter < proof.revisionBefore ||
          (scaleIsSave(operation.name) &&
            (proof.revisionAfter <= proof.revisionBefore || proof.changeObserved !== true))
        )
          throw Error(
            'Save/reload success requires independent identity/content/revision evidence',
          );
      }
    }
  }
  return expected.map((planned) => byId.get(planned.id));
}

export function readScaleMemInfo(text) {
  const read = (key) => {
    const match = String(text).match(new RegExp('^' + key + ':\\s+(\\d+) kB$', 'm'));
    if (!match) throw Error('Missing Linux memory observation: ' + key);
    return Number(match[1]) * 1024;
  };
  const totalBytes = read('MemTotal');
  const availableBytes = read('MemAvailable');
  if (totalBytes <= 0 || availableBytes > totalBytes)
    throw Error('Invalid Linux memory observation');
  return { totalBytes, availableBytes };
}

export function scaleResourceViolation(sample) {
  if (
    !finite(sample.atMs) ||
    !finite(sample.totalBytes) ||
    sample.totalBytes <= 0 ||
    !finite(sample.availableBytes) ||
    sample.availableBytes > sample.totalBytes ||
    !finite(sample.diskFreeBytes)
  )
    throw Error('Missing or invalid runner resource evidence');
  if (
    sample.availableBytes <
    Math.max(
      SCALE_PROFILE.resources.minimumAvailableBytes,
      sample.totalBytes * SCALE_PROFILE.resources.minimumAvailableFraction,
    )
  )
    return 'runner_memory_floor';
  if (sample.diskFreeBytes < SCALE_PROFILE.resources.minimumDiskBytes) return 'runner_disk_floor';
  for (const container of sample.containers || []) {
    if (
      !finite(container.memoryBytes) ||
      !finite(container.memoryLimitBytes) ||
      !integer(container.oomKills) ||
      !integer(container.restarts)
    )
      throw Error('Invalid container observation');
    if (container.oomKills || container.restarts) return 'owned_container_oom_or_restart';
    if (
      container.memoryLimitBytes > 0 &&
      container.memoryBytes / container.memoryLimitBytes >
        SCALE_PROFILE.resources.maximumContainerMemoryFraction
    )
      return 'owned_container_memory_floor';
  }
  return null;
}

export function validateScaleAssets(provenance, expected) {
  if (
    !provenance ||
    provenance.sourceSha !== expected.sourceSha ||
    provenance.imageManifestHash !== expected.imageManifestHash ||
    !Array.isArray(provenance.assets)
  )
    throw Error('Exact served image/source evidence is required');
  for (const service of ['web', 'scratch']) {
    const assets = provenance.assets.filter(
      (asset) => asset.service === service && asset.path.endsWith('.js'),
    );
    if (
      !assets.length ||
      assets.some(
        (asset) =>
          asset.executed !== true ||
          !digest(asset.expectedHash) ||
          asset.expectedHash !== asset.actualHash ||
          !integer(asset.bytes) ||
          asset.bytes === 0 ||
          !asset.path.startsWith('/'),
      )
    )
      throw Error('Served ' + service + ' bytes differ from the inspected image');
  }
}

export function summarizeScaleRequests(requests, elapsedMs, users) {
  if (!Array.isArray(requests) || !finite(elapsedMs) || elapsedMs <= 0)
    throw Error('Invalid HTTP evidence');
  const measured = requests.filter((record) => record.client >= 0 && record.client < users);
  for (const record of measured)
    if (
      !integer(record.status) ||
      !finite(record.durationMs) ||
      !finite(record.startedAtMs) ||
      typeof record.injected !== 'boolean' ||
      typeof record.completed !== 'boolean' ||
      typeof record.phase !== 'string' ||
      typeof record.route !== 'string'
    )
      throw Error('Malformed HTTP observation');
  const injected = measured.filter((record) => record.injected);
  if (
    injected.some(
      (record) =>
        record.status !== 503 ||
        !record.phase.includes('telemetry-outage') ||
        !/^\/api\/(analytics|diagnostics)\//.test(record.route),
    )
  )
    throw Error('Unexpected response cannot be relabelled as injected');
  const ordinary = measured.filter((record) => !record.injected);
  const healthy = ordinary.filter(
    (record) =>
      record.completed &&
      record.status >= 200 &&
      record.status < 400 &&
      record.route.startsWith('/api/') &&
      !/offline|recovery|telemetry-outage/.test(record.phase) &&
      !/^\/api\/(analytics|diagnostics)\//.test(record.route),
  );
  const byPhase = {};
  for (const record of measured) byPhase[record.phase] = (byPhase[record.phase] || 0) + 1;
  return {
    requests: measured.length,
    requestsPerSecond: (measured.length * 1000) / elapsedMs,
    requestsPerClient: measured.length / users,
    apiRequests: measured.filter((record) => record.route.startsWith('/api/')).length,
    staticRequests: measured.filter((record) => !record.route.startsWith('/api/')).length,
    notificationRequests: measured.filter((record) =>
      /^\/api\/games\/(chess|checkers)\/notifications$/.test(record.route),
    ).length,
    diagnosticRequests: measured.filter((record) => /^\/api\/diagnostics\//.test(record.route))
      .length,
    injected503: injected.length,
    unexpected5xx: ordinary.filter((record) => record.status >= 500).length,
    unexpected429: ordinary.filter((record) => record.status === 429).length,
    incomplete: measured.filter((record) => !record.completed).length,
    healthyProductLatencyMs: scaleQuantiles(healthy.map((record) => record.durationMs)),
    healthyProductFilter:
      'completed HTTP2xx/3xx under /api/, excluding analytics/diagnostics and phases containing offline/recovery/telemetry-outage',
    wholeNonInjectedLatencyMs: scaleQuantiles(ordinary.map((record) => record.durationMs)),
    byPhase,
  };
}

function evaluateScaleWorkload(raw, identity, resources, calibration) {
  const receipt = {
    ...identity,
    schemaVersion: 1,
    users: raw?.users,
    status: 'INVALID',
    reasons: [],
  };
  try {
    if (
      !raw ||
      raw.schemaVersion !== 1 ||
      raw.sourceSha !== identity.sourceSha ||
      raw.profileHash !== SCALE_PROFILE_HASH ||
      raw.runToken !== identity.runToken ||
      raw.mode !== (calibration ? 'calibration' : 'capacity') ||
      (calibration ? raw.users !== 2 : !SCALE_LEVELS.includes(raw.users))
    )
      throw Error('Wrong workload identity');
    const operations = validateLedger(raw.operations, raw.users, calibration);
    receipt.operations = Object.fromEntries(
      SCALE_OPERATIONS.map((name) => {
        const group = operations.filter((operation) => operation.name === name);
        const verified = group.filter((operation) => operation.status === 'VERIFIED');
        return [
          name,
          {
            planned: raw.users,
            started: group.filter((operation) => operation.attempts > 0).length,
            verified: verified.length,
            successRatio: verified.length / raw.users,
            latencyMs: scaleQuantiles(verified.map((operation) => operation.durationMs)),
          },
        ];
      }),
    );
    if (raw.integrityFailures?.length) {
      receipt.status = 'FAIL';
      receipt.reasons.push('document_or_identity_integrity_failure');
      return receipt;
    }
    if (!Array.isArray(resources) || !resources.length) throw Error('No runner resource samples');
    const violations = resources.map(scaleResourceViolation).filter(Boolean);
    if (violations.length || raw.runnerBlocked) {
      if (!violations.length) throw Error('Runner blocker has no measured resource violation');
      receipt.status = 'BLOCKED_BY_RUNNER';
      receipt.reasons.push(...new Set(violations));
      return receipt;
    }
    if (
      resources.some(
        (sample, index) =>
          index &&
          (sample.atMs <= resources[index - 1].atMs ||
            sample.atMs - resources[index - 1].atMs > SCALE_PROFILE.resources.maximumSampleGapMs),
      )
    )
      throw Error('Non-monotonic or missing runner samples');
    validateScaleAssets(raw.provenance, identity);
    const plannedCohorts = scaleCohortPlan(raw.users, calibration);
    if (
      raw.classCount !== plannedCohorts.length ||
      !Array.isArray(raw.cohorts) ||
      raw.cohorts.length !== plannedCohorts.length ||
      new Set(raw.cohorts.map((cohort) => cohort.classroomHash)).size !== plannedCohorts.length
    )
      throw Error('The workload did not provision the fixed classroom distribution');
    for (const [index, planned] of plannedCohorts.entries()) {
      const actual = raw.cohorts[index];
      if (
        actual.cohort !== planned.cohort ||
        actual.planned !== planned.planned ||
        actual.provisioned !== planned.planned ||
        !digest(actual.classroomHash) ||
        canonicalJson(actual.clients) !== canonicalJson(planned.clients)
      )
        throw Error('Classroom cohort identities or denominators changed');
    }
    receipt.classCount = raw.classCount;
    receipt.cohortDistribution = raw.cohorts.map((cohort) => cohort.provisioned);
    if (
      raw.observerErrors !== 0 ||
      raw.droppedObservations !== 0 ||
      !Array.isArray(raw.browserSamples) ||
      !raw.browserSamples.length ||
      raw.browserSamples.some(
        (sample) =>
          !integer(sample.chromiumProcesses) ||
          sample.chromiumProcesses < 1 ||
          !finite(sample.chromiumRssBytes) ||
          sample.chromiumRssBytes === 0,
      )
    )
      throw Error('Browser/process evidence incomplete');
    receipt.http = summarizeScaleRequests(raw.requests, raw.elapsedMs, raw.users);
    if (!Array.isArray(raw.observerRequests))
      throw Error('Missing independent control observations');
    receipt.verificationHttp = summarizeScaleRequests(
      raw.observerRequests.filter((record) => record.phase !== 'setup'),
      raw.elapsedMs,
      raw.users,
    );
    const failures = operations.filter((operation) => operation.status !== 'VERIFIED');
    if (failures.length) receipt.reasons.push('required_operations_unconfirmed');
    if (raw.workloadComplete !== true || raw.failure)
      receipt.reasons.push('workload_not_completed');
    if (
      !calibration &&
      (receipt.operations.portal.latencyMs.p95 === null ||
        receipt.operations.portal.latencyMs.p95 > SCALE_PROFILE.slo.portalP95Ms)
    )
      receipt.reasons.push('portal_p95_exceeds_2000ms');
    if (receipt.http.unexpected5xx) receipt.reasons.push('unexpected_5xx');
    if (receipt.http.unexpected429) receipt.reasons.push('unexpected_429');
    if (receipt.verificationHttp.unexpected5xx) receipt.reasons.push('verification_5xx');
    if (receipt.verificationHttp.unexpected429) receipt.reasons.push('verification_429');
    if (!Array.isArray(raw.javascriptErrors) || raw.javascriptErrors.length)
      receipt.reasons.push('javascript_errors');
    if (!Array.isArray(raw.networkFailures)) throw Error('Missing network failure observations');
    for (const failure of raw.networkFailures) {
      if (failure.expected === true) {
        const offline =
          failure.error === 'net::ERR_INTERNET_DISCONNECTED' && failure.phase.includes('offline');
        const navigation =
          failure.error === 'net::ERR_ABORTED' &&
          ['GET', 'HEAD'].includes(failure.method) &&
          failure.navigationWindow === true;
        if (!offline && !navigation)
          throw Error('A generic network failure was incorrectly exempted');
      } else receipt.reasons.push('unexpected_network_failure');
    }
    if (raw.accountControl?.status !== 'VERIFIED')
      receipt.reasons.push('ordinary_account_login_unconfirmed');
    if (
      raw.games?.chessInvitations !== 1 ||
      raw.games?.checkersInvitations !== 1 ||
      raw.games?.chessMatches !== 1 ||
      raw.games?.checkersMatches !== 1
    )
      receipt.reasons.push('game_controls_unconfirmed');
    receipt.status = receipt.reasons.length ? 'FAIL' : 'PASS';
    receipt.confirmedUsers = receipt.status === 'PASS' ? raw.users : null;
  } catch (error) {
    receipt.status = 'INVALID';
    receipt.reasons.push(error instanceof Error ? error.message : 'Invalid evidence');
  }
  return receipt;
}

export function evaluateScaleLevel(raw, identity, resources) {
  return evaluateScaleWorkload(raw, identity, resources, false);
}

export function evaluateScaleCalibration(raw, identity, resources) {
  const receipt = evaluateScaleWorkload(raw, identity, resources, true);
  return {
    ...receipt,
    mode: 'calibration',
    capacityEvidence: false,
    confirmedUsers: null,
    status:
      receipt.status === 'PASS'
        ? 'VALID_FIXTURE'
        : receipt.status === 'BLOCKED_BY_RUNNER'
          ? receipt.status
          : 'INVALID_FIXTURE',
  };
}

export function scaleLadderSummary(receipts, identity) {
  const levels = [];
  let halted = false;
  for (const users of SCALE_LEVELS) {
    const found = receipts.find((receipt) => receipt.users === users);
    if (halted && found) throw Error('A higher level ran after an unconfirmed level');
    if (!found) {
      halted = true;
      levels.push({ users, status: 'NOT_RUN' });
      continue;
    }
    if (found.sourceSha !== identity.sourceSha || found.profileHash !== SCALE_PROFILE_HASH)
      throw Error('Mixed ladder evidence');
    levels.push(found);
    if (found.status !== 'PASS') halted = true;
  }
  return {
    ...identity,
    schemaVersion: 1,
    profile: SCALE_PROFILE,
    levels,
    maximumConfirmedUsers: Math.max(
      0,
      ...levels.filter((level) => level.status === 'PASS').map((level) => level.users),
    ),
    absoluteCapacityEstablished: false,
    limitations: SCALE_PROFILE.limitations,
  };
}

/** The orchestrator and its regression tests execute this same sequential gate. */
export async function runScaleLadder(identity, runLevel, persistReceipt) {
  const receipts = [];
  for (const users of SCALE_LEVELS) {
    assertPriorScaleLevels(receipts, users, identity);
    const receipt = await runLevel(users);
    if (
      !receipt ||
      receipt.users !== users ||
      !['PASS', 'FAIL', 'BLOCKED_BY_RUNNER', 'INVALID'].includes(receipt.status) ||
      [
        'sourceSha',
        'runId',
        'attempt',
        'runToken',
        'profileHash',
        'environmentHash',
        'imageManifestHash',
      ].some((key) => receipt[key] !== identity[key])
    )
      throw Error('Invalid level runner receipt');
    receipts.push(receipt);
    await persistReceipt(receipt);
    if (receipt.status !== 'PASS') break;
  }
  return scaleLadderSummary(receipts, identity);
}

export function assertLatencyScenario(value) {
  if (value !== undefined && value !== 'full' && value !== 'latency')
    throw Error('Unknown request-storm scenario');
  return value || 'full';
}

export function assertLatencySample(value) {
  if (!['ab-a', 'ab-b', 'ba-b', 'ba-a'].includes(value))
    throw Error('Exact counterbalanced latency sample required');
  return value;
}

// Separate browser-local and proxy-local durations. Absolute clocks across
// Chromium/Node are retained for correlation, never subtracted as network time.
export function summarizeLatencyTimings(clients, records, users = 30) {
  if (
    !integer(users) ||
    users < 1 ||
    !Array.isArray(clients) ||
    clients.length !== users ||
    !Array.isArray(records)
  )
    throw Error('Missing latency clients or proxy observations');
  const groups = Object.fromEntries(
    ['login', 'healthy-save', 'telemetry-outage-save'].map((name) => [name, []]),
  );
  const seen = new Set();
  for (const client of clients) {
    if (
      client.dropped !== 0 ||
      !Array.isArray(client.operations) ||
      client.operations.length !== 3 ||
      !Array.isArray(client.fetches)
    )
      throw Error('Incomplete bounded timing observer');
    for (const operation of client.operations) {
      if (
        !groups[operation.name] ||
        !integer(operation.client) ||
        operation.client >= users ||
        operation.status !== 'VERIFIED' ||
        seen.has(operation.name + ':' + operation.client)
      )
        throw Error('Invalid or duplicated timing operation');
      seen.add(operation.name + ':' + operation.client);
      const chain = [operation.startedAtMs, operation.apiCompletedAtMs, operation.completedAtMs];
      if (chain.some((value, index) => !finite(value) || (index && value < chain[index - 1])))
        throw Error('Unfinished or non-monotonic browser operation');
      const fetches = client.fetches.filter((fetch) => fetch.operationId === operation.id);
      const write = fetches.filter(
        (fetch) => fetch.method === (operation.name === 'login' ? 'POST' : 'PUT'),
      );
      const readback = fetches.filter((fetch) => fetch.method === 'GET');
      if (write.length !== 1 || (operation.name !== 'login' && readback.length !== 1))
        throw Error('Ambiguous write/readback timing; inspect raw attempts');
      const fetch = write[0];
      const steps = [
        operation.startedAtMs,
        fetch.nativeFetchAtMs,
        fetch.headersAtMs,
        fetch.jsonStartedAtMs,
        fetch.jsonCompletedAtMs,
        operation.apiCompletedAtMs,
      ];
      if (
        steps.some((value, index) => !finite(value) || (index && value < steps[index - 1])) ||
        fetch.status < 200 ||
        fetch.status >= 300
      )
        throw Error('Missing native-fetch/JSON boundary');
      if (
        readback.length &&
        (!finite(readback[0].jsonCompletedAtMs) ||
          readback[0].nativeFetchAtMs < operation.apiCompletedAtMs ||
          readback[0].jsonCompletedAtMs > operation.completedAtMs ||
          readback[0].status !== 200)
      )
        throw Error('Missing completed save readback boundary');
      const matches = records.filter(
        (record) =>
          record.client === operation.client &&
          record.requestId === fetch.id &&
          record.operationId === operation.id,
      );
      if (matches.length !== 1)
        throw Error('Native request cannot be joined to exactly one proxy observation');
      const proxy = matches[0];
      const proxySteps = [
        proxy.proxyReceivedAtMs,
        proxy.upstreamDispatchedAtMs,
        proxy.upstreamHeadersAtMs,
        proxy.proxyFinishedAtMs,
      ];
      if (
        !proxy.completed ||
        proxy.injected ||
        proxy.status < 200 ||
        proxy.status >= 300 ||
        proxySteps.some(
          (value, index) => !finite(value) || (index && value < proxySteps[index - 1]),
        )
      )
        throw Error('Missing successful upstream timing boundaries');
      groups[operation.name].push({
        client: operation.client,
        operationMs: operation.completedAtMs - operation.startedAtMs,
        beforeNativeFetchMs: fetch.nativeFetchAtMs - operation.startedAtMs,
        nativeFetchToHeadersMs: fetch.headersAtMs - fetch.nativeFetchAtMs,
        headersToJsonStartMs: fetch.jsonStartedAtMs - fetch.headersAtMs,
        bodyAndJsonMs: fetch.jsonCompletedAtMs - fetch.jsonStartedAtMs,
        jsonToApiResultMs: operation.apiCompletedAtMs - fetch.jsonCompletedAtMs,
        afterApiResultMs: operation.completedAtMs - operation.apiCompletedAtMs,
        proxyDispatchToHeadersMs: proxy.upstreamHeadersAtMs - proxy.upstreamDispatchedAtMs,
        proxyTotalMs: proxy.proxyFinishedAtMs - proxy.proxyReceivedAtMs,
        proxyReceivedAtMs: proxy.proxyReceivedAtMs,
      });
    }
  }
  return Object.fromEntries(
    Object.entries(groups).map(([name, values]) => {
      if (values.length !== users) throw Error('Timing denominator changed');
      const metrics = Object.fromEntries(
        Object.keys(values[0])
          .filter((key) => key.endsWith('Ms') && key !== 'proxyReceivedAtMs')
          .map((key) => [key, scaleQuantiles(values.map((value) => value[key]))]),
      );
      return [
        name,
        {
          count: users,
          proxyArrivalSpreadMs:
            Math.max(...values.map((value) => value.proxyReceivedAtMs)) -
            Math.min(...values.map((value) => value.proxyReceivedAtMs)),
          metrics,
        },
      ];
    }),
  );
}
