#!/usr/bin/env node
// TEST_ONLY. No native work on import or --describe. Execution requires a separate,
// exact-source approved predata file; this source-authoring slice creates none.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import {
  SOURCE_PATHS,
  REALMS,
  ROUTES,
  PHY01_SHA256,
  ProtocolReceiver,
  inspectPacket,
  decodeBase64,
  runRealm,
  admitContract,
  admitFixture,
  parseBoundedJson,
  validateIdentity,
  receiptSnapshot,
  validateNativeSnapshot,
  validateAdmissionSnapshot,
  assertRealmCounters,
  terminalReceipt,
} from './mujoco-portability-runtime.mjs';
import {
  demand,
  PortabilityError,
  failureRecord,
  failureError,
  failureOutcome,
  runPlan,
  stateBytes,
  RECORD_BYTES,
  decodeRecord,
  equalBytes,
} from './mujoco-portability-sampler.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_PATH = 'tests/robotics/field-core-qualification/mujoco-phy01.fixture.json';
const CONTRACT_PATH = 'tests/robotics/field-core-qualification/mujoco-portability.fixture.json';
const ORIGINAL_PATH = 'tools/robotics-field-core/mujoco-phy01.mjs';
const text = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const callGit = (args, root = ROOT) =>
  execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  }).trim();

export function deriveBudget(fixture, contract) {
  const positive = runPlan(fixture);
  const positiveAdvances = positive.reduce(
    (sum, item) => sum + fixture.sampleTimesUs.at(-1) / item.dtUs,
    0,
  );
  const advances = 3 * (positiveAdvances + 4),
    worlds = 3 * (positive.length + 1);
  const records = advances + worlds + 2 + 3;
  const packets = 3 * (positive.length + positiveAdvances / 100 + 3) + 2;
  const normalDataBytes = records * RECORD_BYTES + packets * 64;
  const digestBytes = advances * 32;
  const maximumBytes =
    normalDataBytes +
    416 +
    digestBytes +
    Object.values(contract.journalBudget.fixedCaps).reduce((a, b) => a + b, 0);
  return {
    worlds,
    advances,
    records,
    packets,
    normalDataBytes,
    digestBytes,
    maximumBytes,
    hardEnvelopeBytes: 64 * 1024 * 1024,
  };
}
export class JournalAllowance {
  constructor(contract) {
    this.limits = {
      ...contract.journalBudget.fixedCaps,
      raw: contract.journalBudget.maxDataBytes,
      digests: contract.journalBudget.stateDigestsBytes,
    };
    this.totalLimit = contract.journalBudget.hardEnvelopeBytes;
    this.used = Object.fromEntries(Object.keys(this.limits).map((key) => [key, 0]));
    this.total = 0;
  }
  reserve(category, bytes) {
    demand(
      Object.hasOwn(this.limits, category) && Number.isSafeInteger(bytes) && bytes >= 0,
      'JOURNAL_RESERVATION',
    );
    demand(
      this.used[category] + bytes <= this.limits[category] && this.total + bytes <= this.totalLimit,
      'JOURNAL_BYTE_BUDGET',
    );
    this.used[category] += bytes;
    this.total += bytes;
  }
}
export const EXECUTION_INPUT_PATHS = Object.freeze(SOURCE_PATHS.slice(0, 6));
export const REPORT_PATHS = Object.freeze(SOURCE_PATHS.slice(6));
export const FROZEN_INPUT_PATHS = Object.freeze([
  'docs/product/robotics/FIELD_CORE_SPEC.md',
  'docs/product/electronics/tasks/TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001.md',
  'tools/robotics-field-core/mujoco-phy01.mjs',
  'tools/robotics-field-core/run-mujoco-phy01.mjs',
  'tests/robotics/field-core-qualification/mujoco-phy01.fixture.json',
  'tests/robotics/field-core-qualification/mujoco-phy01.spec.ts',
  'tools/robotics-field-core/mujoco-artifact.json',
  'tools/robotics-field-core/MUJOCO-LICENSE.txt',
  'tools/robotics-field-core/MUJOCO-THIRD-PARTY-NOTICES.txt',
  'package.json',
  'pnpm-lock.yaml',
]);
function exactInputSet(expected, actual, checkpoint, paths, label) {
  for (const entries of [expected, actual, checkpoint])
    demand(Array.isArray(entries) && entries.length === paths.length, label + '_COUNT');
  for (const path of paths) {
    const matches = [expected, actual, checkpoint].map((entries) =>
      entries.filter((entry) => entry.path === path),
    );
    demand(
      matches.every((entries) => entries.length === 1),
      label + '_PATH:' + path,
    );
    const [approved, current, frozen] = matches.map((entries) => entries[0]);
    demand(
      Number.isSafeInteger(approved.bytes) &&
        approved.bytes > 0 &&
        /^[0-9a-f]{64}$/.test(approved.sha256) &&
        approved.bytes === current.bytes &&
        current.bytes === frozen.bytes &&
        approved.sha256 === current.sha256 &&
        current.sha256 === frozen.sha256,
      label + '_IDENTITY:' + path,
    );
  }
}
export function validateExecutionApproval(predata, observed, contract) {
  demand(
    predata?.schema === 'MUJOCO_PORTABILITY_PREDATA_V1' &&
      predata.approval === 'APPROVED_FOR_ONE_NATIVE_RUN',
    'NATIVE_EXECUTION_NOT_APPROVED',
  );
  demand(
    /^[0-9a-f]{64}$/.test(predata.independentReviewSha256) &&
      /^[A-Za-z0-9_-]{8,80}$/.test(predata.runId),
    'PREDATA_REVIEW_IDENTITY',
  );
  demand(
    /^[0-9a-f]{40}$/.test(predata.sourceHead) &&
      predata.sourceHead === observed.sourceCheckpointHead &&
      /^[0-9a-f]{40}$/.test(observed.sourceHead) &&
      observed.sourceCheckpointIsAncestor === true,
    'PREDATA_SOURCE_HEAD',
  );
  const reports = predata.reportOnlyPaths;
  demand(
    Array.isArray(reports) &&
      reports.length >= 2 &&
      reports.length <= 8 &&
      new Set(reports).size === reports.length &&
      reports.every(
        (path) =>
          typeof path === 'string' &&
          /^docs\/product\/robotics\/evidence\/field-core-mujoco-portability-[A-Za-z0-9_-]+\.(?:json|md)$/.test(
            path,
          ),
      ) &&
      REPORT_PATHS.every((path) => reports.includes(path)),
    'PREDATA_REPORT_ALLOWLIST',
  );
  for (const key of ['committedChanges', 'stagedChanges', 'workingChanges', 'untrackedFiles']) {
    demand(
      Array.isArray(observed[key]) && observed[key].every((path) => reports.includes(path)),
      'PREDATA_UNEXPECTED_DRIFT:' + key,
    );
  }
  exactInputSet(
    predata.sourceFiles,
    observed.sourceFiles.filter((entry) => EXECUTION_INPUT_PATHS.includes(entry.path)),
    observed.checkpointSourceFiles,
    EXECUTION_INPUT_PATHS,
    'PREDATA_SOURCE_FILES',
  );
  exactInputSet(
    predata.frozenFiles,
    observed.frozenFiles,
    observed.checkpointFrozenFiles,
    FROZEN_INPUT_PATHS,
    'PREDATA_FROZEN_FILES',
  );
  demand(
    JSON.stringify(predata.nativeBudget) === JSON.stringify(contract.nativeBudget),
    'PREDATA_NATIVE_BUDGET',
  );
  demand(
    predata.journalMaximumBytes === 43357920 && predata.journalEnvelopeBytes === 67108864,
    'PREDATA_JOURNAL_BUDGET',
  );
  demand(
    predata.nodeVersion === 'v22.23.3' && observed.nodeVersion === predata.nodeVersion,
    'PREDATA_NODE_VERSION',
  );
  demand(
    predata.chromiumRevision === '1193' && predata.chromiumVersion === '140.0.7339.186',
    'PREDATA_CHROMIUM_VERSION',
  );
  demand(
    predata.chromiumSha256 === 'fe844627cb1b2131d63eaef5c272519c3d03f6caafeebd16d569d6a22a7b793a',
    'PREDATA_CHROMIUM_SHA',
  );
  for (const key of ['outputDirectory', 'dependencyRoot', 'engineRoot', 'chromiumExecutable'])
    demand(
      typeof predata[key] === 'string' && isAbsolute(predata[key]),
      'PREDATA_ABSOLUTE_PATH:' + key,
    );
  return predata;
}
export function resolveLocalRoute(requestTarget, method) {
  demand(method === 'GET' && ROUTES.includes(requestTarget), 'LOCAL_ASSET_ALLOWLIST');
  return requestTarget;
}
async function loadInputs() {
  const fixtureBytes = await readFile(join(ROOT, FIXTURE_PATH));
  demand(hash(fixtureBytes) === PHY01_SHA256, 'FIXTURE_FILE_SHA256');
  const fixture = parseBoundedJson(fixtureBytes),
    contract = parseBoundedJson(await readFile(join(ROOT, CONTRACT_PATH)));
  await admitFixture(fixture);
  await admitContract(contract);
  const arithmetic = deriveBudget(fixture, contract);
  demand(
    arithmetic.worlds === 63 &&
      arithmetic.advances === 72012 &&
      arithmetic.records === 72080 &&
      arithmetic.packets === 791 &&
      arithmetic.maximumBytes === 43357920,
    'SOURCE_RESOURCE_ARITHMETIC',
  );
  return { fixture, contract, arithmetic };
}
function repositoryReader(checkpointHead, root) {
  demand(/^[0-9a-f]{40}$/.test(checkpointHead), 'SOURCE_CHECKPOINT_ID');
  demand(isAbsolute(root), 'SOURCE_ROOT');
  const gitBytes = (args) =>
    execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_NO_LAZY_FETCH: '1',
      },
    });
  const list = (args) => gitBytes(args).toString('utf8').split('\0').filter(Boolean);
  const identify = (path, bytes) => ({ path, bytes: bytes.byteLength, sha256: hash(bytes) });
  const current = async (paths) => {
    const entries = [];
    for (const path of paths) entries.push(identify(path, await readFile(join(root, path))));
    return entries;
  };
  const checkpoint = (paths) =>
    paths.map((path) => identify(path, gitBytes(['show', checkpointHead + ':' + path])));
  return { list, current, checkpoint };
}
export async function inheritedSnapshot(checkpointHead, root = ROOT) {
  const reader = repositoryReader(checkpointHead, root);
  return {
    frozenFiles: await reader.current(FROZEN_INPUT_PATHS),
    checkpointFrozenFiles: reader.checkpoint(FROZEN_INPUT_PATHS),
  };
}
export async function sourceSnapshot(checkpointHead, root = ROOT) {
  const { list, current, checkpoint } = repositoryReader(checkpointHead, root);
  const sourceCheckpointHead = callGit(
    ['rev-parse', '--verify', checkpointHead + '^{commit}'],
    root,
  );
  let sourceCheckpointIsAncestor = true;
  try {
    callGit(['merge-base', '--is-ancestor', checkpointHead, 'HEAD'], root);
  } catch (error) {
    if (error.status === 1) sourceCheckpointIsAncestor = false;
    else throw error;
  }
  return {
    sourceHead: callGit(['rev-parse', 'HEAD'], root),
    sourceCheckpointHead,
    sourceCheckpointIsAncestor,
    sourceFiles: await current(SOURCE_PATHS),
    frozenFiles: await current(FROZEN_INPUT_PATHS),
    checkpointSourceFiles: checkpoint(EXECUTION_INPUT_PATHS),
    checkpointFrozenFiles: checkpoint(FROZEN_INPUT_PATHS),
    committedChanges: list(['diff', '--name-only', '--no-renames', '-z', checkpointHead, 'HEAD']),
    stagedChanges: list(['diff', '--cached', '--name-only', '--no-renames', '-z']),
    workingChanges: list(['diff', '--name-only', '--no-renames', '-z', 'HEAD']),
    untrackedFiles: list(['ls-files', '--others', '--exclude-standard', '-z']),
    nodeVersion: process.version,
  };
}
async function exactAssets(predata, source, contract) {
  const assets = new Map();
  const type = (route) =>
    route.endsWith('.wasm')
      ? 'application/wasm'
      : route.endsWith('.mjs') || route.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : route.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : 'text/html; charset=utf-8';
  const add = (route, bytes) => assets.set(route, { bytes, contentType: type(route) });
  for (const entry of contract.engine.files) {
    const bytes = await readFile(join(predata.engineRoot, entry.path));
    demand(
      bytes.byteLength === entry.bytes && hash(bytes) === entry.sha256,
      'ENGINE_FILE_IDENTITY:' + entry.path,
    );
    if (entry.path === 'mujoco.js' || entry.path === 'mujoco.wasm')
      add('/assets/' + entry.path, bytes);
  }
  const corrupt = Buffer.from(assets.get('/assets/mujoco.wasm').bytes);
  demand(corrupt[0] === 0, 'WASM_MAGIC');
  corrupt[0] = 1;
  add('/negative/corrupt-mujoco.wasm', corrupt);
  for (const name of ['runtime', 'sampler', 'worker'])
    add(
      '/src/mujoco-portability-' + name + '.mjs',
      await readFile(join(ROOT, 'tools/robotics-field-core/mujoco-portability-' + name + '.mjs')),
    );
  add('/fixtures/mujoco-phy01.fixture.json', await readFile(join(ROOT, FIXTURE_PATH)));
  add('/fixtures/mujoco-portability.fixture.json', await readFile(join(ROOT, CONTRACT_PATH)));
  add(
    '/',
    Buffer.from(
      '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>MuJoCo TEST_ONLY</title></head><body></body></html>',
    ),
  );
  add('/offline-sentinel', Buffer.from('online'));
  const manifest = {
    schema: 'MUJOCO_PORTABILITY_ASSETS_V1',
    ...source,
    assets: Object.fromEntries(
      [...assets].map(([route, entry]) => [
        route,
        { bytes: entry.bytes.byteLength, sha256: hash(entry.bytes) },
      ]),
    ),
  };
  const manifestBytes = text(manifest);
  demand(manifestBytes.byteLength <= 65536, 'SOURCE_MANIFEST_LIMIT');
  add('/manifest.json', manifestBytes);
  return { assets, manifest, manifestSha256: hash(manifestBytes) };
}

function sameIdentity(expected, observed) {
  validateIdentity(expected);
  validateIdentity(observed);
  for (const key of ['runId', 'generation', 'sourceManifestSha256', 'realm'])
    demand(expected[key] === observed[key], 'RECEIPT_IDENTITY:' + key);
}
function validateModuleReceipt(body, realm) {
  validateNativeSnapshot(body.counters, realm);
  validateAdmissionSnapshot(body.accounting, body.instantiation, realm);
  demand(
    body.version === 4000000 &&
      body.versionString === '4.0.0' &&
      Number.isSafeInteger(body.memoryBytes) &&
      body.memoryBytes >= 17629184 &&
      body.memoryBytes <= 2147483648,
    'MODULE_RECEIPT_IDENTITY',
  );
}
export function validateWorldReceipt(body, world) {
  const snapshot = receiptSnapshot(body, 65536),
    { run, counters, memoryBytes } = snapshot;
  demand(
    run &&
      run.worldOrdinal === world.ordinal &&
      ['mode', 'massKg', 'dtUs', 'repeat', 'quota'].every((key) => run[key] === world[key]),
    'WORLD_END_IDENTITY',
  );
  validateNativeSnapshot(counters, world.realm);
  const limit = world.quota ? 4 : 400000 / world.dtUs;
  demand(
    Number.isInteger(run.steps) &&
      run.steps >= 0 &&
      run.steps <= limit &&
      Number.isInteger(run.attemptedStepIndex) &&
      run.attemptedStepIndex >= run.steps &&
      run.attemptedStepIndex <= limit + (world.quota ? 1 : 0) &&
      typeof run.phase === 'string' &&
      run.phase.length <= 128 &&
      Number.isSafeInteger(memoryBytes) &&
      memoryBytes >= 17629184 &&
      memoryBytes <= 2147483648,
    'WORLD_RECEIPT_BOUNDS',
  );
  for (const key of ['mj_step1', 'mj_step2', 'mj_step']) {
    const calls = run.nativeCalls?.[key];
    demand(
      calls &&
        Number.isInteger(calls.dispatched) &&
        calls.dispatched >= 0 &&
        calls.dispatched <= limit &&
        Number.isInteger(calls.returned) &&
        calls.returned >= 0 &&
        calls.returned <= calls.dispatched,
      'WORLD_CALL_RECEIPT',
    );
  }
  demand(
    run.steps === run.nativeCalls.mj_step2.returned + run.nativeCalls.mj_step.returned &&
      run.nativeCalls.mj_step2.dispatched <= run.nativeCalls.mj_step1.returned &&
      run.steps <= counters.advancesCompleted,
    'WORLD_COMPLETED_RECEIPT',
  );
  const records = run.recordAccounting;
  demand(
    records &&
      JSON.stringify(Object.keys(records).sort()) ===
        JSON.stringify(
          [
            'validatedEndpoints',
            'emittedEndpoints',
            'acknowledgedEndpoints',
            'emittedFailureFrames',
            'acknowledgedFailureFrames',
            'packetsDispatched',
            'packetsAcknowledged',
          ].sort(),
        ),
    'WORLD_RECORD_SCHEMA',
  );
  for (const key of ['validatedEndpoints', 'emittedEndpoints', 'acknowledgedEndpoints'])
    demand(
      Number.isSafeInteger(records?.[key]) && records[key] >= 0 && records[key] <= run.steps,
      'WORLD_ENDPOINT_RECEIPT',
    );
  for (const key of ['emittedFailureFrames', 'acknowledgedFailureFrames'])
    demand([0, 1].includes(records[key]), 'WORLD_FAILURE_FRAME_RECEIPT');
  for (const key of ['packetsDispatched', 'packetsAcknowledged'])
    demand(
      Number.isInteger(records[key]) && records[key] >= 0 && records[key] <= 19,
      'WORLD_PACKET_RECEIPT',
    );
  demand(
    records.acknowledgedEndpoints <= records.emittedEndpoints &&
      records.emittedEndpoints <= records.validatedEndpoints &&
      records.packetsAcknowledged <= records.packetsDispatched &&
      records.acknowledgedFailureFrames <= records.emittedFailureFrames &&
      world.endpointCount <= records.emittedEndpoints &&
      (world.failureFrames ?? 0) <= records.emittedFailureFrames,
    'WORLD_RECORD_RELATION',
  );
  demand(
    Array.isArray(run.cleanupErrors) &&
      run.cleanupErrors.length <= 2 &&
      run.cleanupErrors.every((error) => typeof error === 'string' && error.length <= 4096) &&
      Array.isArray(run.cleanupFailures) &&
      run.cleanupFailures.length <= 2,
    'WORLD_CLEANUP_RECEIPT',
  );
  for (const failure of [run.failure, ...run.cleanupFailures, run.failureObservationFailure].filter(
    Boolean,
  ))
    failureError(failure);
  demand(
    run.error === null ? run.failure === null : typeof run.error === 'string' && !!run.failure,
    'WORLD_ERROR_RECEIPT',
  );
  return snapshot;
}
export class HostJournal {
  constructor(directory, fixture, contract, assessor) {
    this.directory = directory;
    this.fixture = fixture;
    this.contract = contract;
    this.assessor = assessor;
    this.allowance = new JournalAllowance(contract);
    this.files = new Set();
    this.worlds = new Map();
    this.negative = [];
    this.realms = [];
    this.assessments = [];
    this.packetCount = 0;
    this.acceptedPacketCount = 0;
    this.durablePacketCount = 0;
    this.failureFrameCount = 0;
    this.receipts = new Map();
    this.identities = new Map();
    this.recordCount = 0;
    this.protocolRows = 0;
    this.networkRows = 0;
    this.queue = Promise.resolve();
    this.ioError = null;
    this.closed = false;
  }
  async init(invocation, plan) {
    await mkdir(this.directory, { recursive: false });
    await this.writeJson('invocation.json', invocation, 'invocationManifest');
    await this.writeJson('plan.json', plan, 'invocationManifest');
    for (const name of ['protocol.ndjson', 'network.ndjson', 'logs.txt'])
      await this.writeBytes(
        name,
        Buffer.alloc(0),
        name === 'protocol.ndjson' ? 'protocol' : name === 'network.ndjson' ? 'network' : 'logs',
      );
  }
  async writeBytes(path, bytes, category, append = false) {
    demand(
      !this.closed && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'),
      'JOURNAL_PATH',
    );
    this.allowance.reserve(category, bytes.byteLength);
    if (!append) {
      demand(!this.files.has(path) && this.files.size < 261, 'JOURNAL_FILE_BUDGET');
    } else demand(this.files.has(path), 'JOURNAL_APPEND_TO_UNREGISTERED_FILE');
    const handle = await open(join(this.directory, path), append ? 'a' : 'wx');
    if (!append) this.files.add(path);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async writeJson(path, value, category, perFileLimit = Infinity) {
    const bytes = text(value);
    demand(bytes.byteLength <= perFileLimit, 'JOURNAL_RECORD_LIMIT');
    await this.writeBytes(path, bytes, category);
  }
  enqueueLine(path, value, category, maxBytes) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    demand(bytes.byteLength <= maxBytes, 'JOURNAL_ROW_LIMIT');
    this.queue = this.queue.then(() => this.writeBytes(path, bytes, category, true));
    this.queue.catch((error) => {
      this.ioError = error;
    });
    return this.queue;
  }
  protocol(stage, envelope, payloadBytes = 0) {
    demand(++this.protocolRows <= 4096, 'PROTOCOL_ROW_BUDGET');
    return this.enqueueLine(
      'protocol.ndjson',
      {
        utc: new Date().toISOString(),
        stage,
        realm: envelope.realm,
        kind: envelope.kind,
        sequence: envelope.sequence,
        worldOrdinal: envelope.worldOrdinal,
        payloadBytes,
      },
      'protocol',
      1024,
    );
  }
  network(event) {
    demand(++this.networkRows <= 256, 'NETWORK_ROW_BUDGET');
    return this.enqueueLine(
      'network.ndjson',
      { utc: new Date().toISOString(), ...event },
      'network',
      2048,
    );
  }
  log(value) {
    return this.writeBytes('logs.txt', Buffer.from(String(value) + '\n'), 'logs', true);
  }

  registerRealm(identity) {
    validateIdentity(identity);
    const prior = this.identities.get(identity.realm);
    if (prior) sameIdentity(prior, identity);
    else {
      demand(this.identities.size < 3, 'RECEIPT_REALM_BUDGET');
      this.identities.set(identity.realm, { ...identity });
    }
  }
  async rememberReceipt(kind, identity, body, sequence = -1, channel = kind) {
    const expected = this.identities.get(identity.realm);
    demand(expected, 'RECEIPT_REALM_UNREGISTERED');
    sameIdentity(expected, identity);
    demand(['module', 'realm-end', 'terminal'].includes(kind), 'RECEIPT_KIND');
    const maximum = kind === 'module' ? 8192 : kind === 'realm-end' ? 16384 : 32768;
    const snapshot = receiptSnapshot({ identity: expected, channel, body }, maximum);
    const bytes = Buffer.from(JSON.stringify(snapshot));
    const key = identity.realm + '/' + kind,
      sha256 = hash(bytes);
    const previous = this.receipts.get(key);
    if (previous) {
      demand(previous.sha256 === sha256, 'RECEIPT_DUPLICATE_CHANGED');
      return previous;
    }
    demand(this.receipts.size < 9, 'RECEIPT_COUNT_LIMIT');
    const receipt = {
      key,
      kind,
      identity: expected,
      channel,
      snapshot,
      sha256,
      bytes: bytes.byteLength,
      parts: Math.ceil(bytes.byteLength / 384),
      durable: false,
    };
    this.receipts.set(key, receipt); // Received data survives even if persistence/ACK fails next.
    for (let offset = 0, part = 0; offset < bytes.byteLength; offset += 384, part += 1) {
      demand(++this.protocolRows <= 4096, 'PROTOCOL_ROW_BUDGET');
      const row = {
        stage: 'receipt',
        realm: identity.realm,
        kind,
        sequence,
        receiptSha256: sha256,
        part,
        parts: receipt.parts,
        bytes: bytes.byteLength,
        base64: bytes.subarray(offset, offset + 384).toString('base64'),
      };
      const encoded = Buffer.from(JSON.stringify(row) + '\n');
      demand(encoded.byteLength <= 1024, 'JOURNAL_ROW_LIMIT');
      this.queue = this.queue
        .catch(() => {})
        .then(() => this.writeBytes('protocol.ndjson', encoded, 'protocol', true));
      try {
        await this.queue;
      } catch (error) {
        this.ioError ??= error;
        receipt.persistenceError = failureRecord(error, 'receipt_write');
        throw error;
      }
    }
    receipt.durable = true;
    return receipt;
  }
  async recordModule(envelope) {
    validateModuleReceipt(envelope.body, envelope.realm);
    return this.rememberReceipt('module', envelope, envelope.body, envelope.sequence);
  }
  async captureTerminal(identity, payload, channel) {
    sameIdentity(identity, payload?.identity);
    demand(
      payload.realm === identity.realm &&
        ['SAMPLED', 'FAIL', 'INCOMPLETE'].includes(payload.verdict),
      'TERMINAL_IDENTITY',
    );
    if (payload.counters === null) {
      demand(
        ['worker-failed', 'node-failed', 'browser-failed'].includes(channel) &&
          payload.accounting === null &&
          payload.lastWorld === null,
        'TERMINAL_UNKNOWN_COUNTERS',
      );
    } else {
      validateNativeSnapshot(payload.counters, identity.realm);
      validateAdmissionSnapshot(payload.accounting, payload.instantiation, identity.realm);
    }
    for (const failure of [
      payload.error,
      payload.relayFailure,
      ...(payload.secondaryErrors ?? []),
    ].filter(Boolean))
      failureError(failure);
    demand(
      Array.isArray(payload.secondaryErrors) && payload.secondaryErrors.length <= 8,
      'TERMINAL_FAILURE_LIMIT',
    );
    if (payload.module) validateModuleReceipt(payload.module, identity.realm);
    const { logs, ...observedPayload } = payload;
    const receipt = await this.rememberReceipt('terminal', identity, observedPayload, -1, channel);
    if (logs !== undefined) {
      demand(
        Array.isArray(logs) &&
          logs.every((line) => typeof line === 'string') &&
          logs.reduce((sum, line) => sum + Buffer.byteLength(line), 0) <= 262144,
        'TERMINAL_LOG_BUDGET',
      );
      for (const line of logs) await this.log(identity.realm + ' engine: ' + line);
    }
    if (payload.lastWorld) {
      const world = this.worlds.get(payload.lastWorld.worldOrdinal);
      if (world && !world.receivedEnd)
        await this.endWorld({
          ...identity,
          worldOrdinal: world.ordinal,
          body: {
            run: payload.lastWorld,
            counters: payload.counters,
            memoryBytes: payload.lastMemoryBytes,
          },
        });
    }
    return receipt;
  }
  receiptReferences() {
    return [...this.receipts.values()].map(
      ({ key, channel, sha256, bytes, parts, durable, persistenceError }) => ({
        key,
        channel,
        sha256,
        bytes,
        parts,
        durable,
        persistenceError: persistenceError ?? null,
      }),
    );
  }
  latestNativeObservation(realm) {
    for (const kind of ['terminal', 'realm-end']) {
      const receipt = this.receipts.get(realm + '/' + kind);
      if (receipt?.snapshot.body.counters)
        return { realm, source: receipt.key, counters: receipt.snapshot.body.counters };
    }
    const worlds = [...this.worlds.values()].filter(
      (world) => world.realm === realm && world.receivedEnd,
    );
    if (worlds.length)
      return {
        realm,
        source: 'world-end:' + worlds.at(-1).ordinal,
        counters: worlds.at(-1).receivedEnd.counters,
      };
    const module = this.receipts.get(realm + '/module');
    return {
      realm,
      source: module?.key ?? null,
      counters: module?.snapshot.body.counters ?? 'UNKNOWN',
    };
  }
  observedFailures() {
    const failures = [];
    for (const world of this.worlds.values()) {
      const run = world.receivedEnd?.run;
      if (run)
        failures.push(run.failure, ...(run.cleanupFailures ?? []), run.failureObservationFailure);
      failures.push(world.hostFailure);
    }
    for (const receipt of this.receipts.values()) {
      const body = receipt.snapshot.body;
      failures.push(
        body.error,
        ...(body.secondaryErrors ?? []),
        body.relayFailure,
        receipt.persistenceError,
      );
    }
    return failures.filter(Boolean);
  }
  async writeWorldMetadata(world) {
    if (this.files.has(world.folder + '/metadata.json')) return;
    const observed = world.receivedEnd;
    await this.writeJson(
      world.folder + '/metadata.json',
      {
        worldOrdinal: world.ordinal,
        status: observed?.run.error
          ? failureOutcome(
              [
                observed.run.failure,
                ...observed.run.cleanupFailures,
                observed.run.failureObservationFailure,
              ].filter(Boolean),
            )
          : observed && !world.hostFailure
            ? 'RECORDED'
            : 'INCOMPLETE',
        received: observed ?? null,
        hostFailure: world.hostFailure ?? null,
        progress: {
          nativeCompleted: observed?.run.steps ?? 'UNKNOWN',
          emittedEndpoints: observed?.run.recordAccounting.emittedEndpoints ?? 'UNKNOWN',
          acknowledgedEndpoints: observed?.run.recordAccounting.acknowledgedEndpoints ?? 'UNKNOWN',
          acceptedEndpoints: world.endpointCount,
          durableEndpoints: world.durableEndpointCount,
          receivedFailureFrames: world.failureFrames ?? 0,
          durableFailureFrames: world.durableFailureFrames ?? 0,
          unobservedAfterLastNativeReceipt: observed ? 'NONE_WITHIN_THIS_WORLD_RECEIPT' : 'UNKNOWN',
        },
        rawAndDigestDurablePrefixSha256: world.raw.copy().digest('hex'),
        acceptedTrajectorySha256: world.trajectory.copy().digest('hex'),
        acceptedWarningTrajectorySha256: world.warnings.copy().digest('hex'),
        warningDigestSource:
          'actual accepted endpoint slices; durable prefix separately counted; no extra warning file',
        durability: 'only raw and state-digest appends with completed fsync are counted durable',
      },
      'worldMetadata',
      65536,
    );
  }
  async beginWorld(envelope) {
    const ordinal = envelope.worldOrdinal,
      body = envelope.body,
      local = ordinal % 21;
    demand(
      JSON.stringify(Object.keys(body).sort()) ===
        JSON.stringify(['dtUs', 'massKg', 'mode', 'quota', 'repeat', 'worldOrdinal']),
      'WORLD_START_SCHEMA',
    );
    demand(
      ordinal === REALMS.indexOf(envelope.realm) * 21 + local && !this.worlds.has(ordinal),
      'WORLD_IDENTITY',
    );
    const expected =
      local === 20
        ? { mode: 'split', massKg: 0.5, dtUs: 500, repeat: 0 }
        : runPlan(this.fixture)[local];
    for (const key of ['mode', 'massKg', 'dtUs', 'repeat'])
      demand(body[key] === expected[key], 'WORLD_PLAN_IDENTITY');
    demand(body.quota === (local === 20) && this.worlds.size < 63, 'WORLD_PLAN_IDENTITY');
    const folder = 'worlds/' + String(ordinal).padStart(3, '0');
    await mkdir(join(this.directory, folder), { recursive: true });
    await this.writeBytes(folder + '/raw.bin', Buffer.alloc(0), 'raw');
    await this.writeBytes(folder + '/state-sha256.bin', Buffer.alloc(0), 'digests');
    let baseline = null;
    if (envelope.realm !== 'node-child') {
      const node = this.worlds.get(local);
      demand(node?.run && !node.run.error, 'NODE_BASELINE_MISSING');
      baseline = await this.readRecordMap(node);
    }
    this.worlds.set(ordinal, {
      ordinal,
      realm: envelope.realm,
      ...body,
      folder,
      baseline,
      endpointCount: 0,
      durableEndpointCount: 0,
      failureFrames: 0,
      durableFailureFrames: 0,
      receivedEnd: null,
      initial: null,
      resumed: 0,
      refused: 0,
      samples: [],
      stateDigestByStep: [],
      trajectory: createHash('sha256'),
      warnings: createHash('sha256'),
      raw: createHash('sha256'),
      lastEndpoint: null,
      run: null,
    });
  }
  async readRecordMap(world) {
    const bytes = await readFile(join(this.directory, world.folder, 'raw.bin'));
    const records = new Map();
    for (let offset = 0; offset < bytes.byteLength;) {
      demand(offset + 64 <= bytes.byteLength, 'RAW_PACKET_PREFIX');
      const payloadBytes = bytes.readUInt32LE(offset + 20),
        count = bytes.readUInt16LE(offset + 14);
      demand(
        payloadBytes === count * RECORD_BYTES &&
          count >= 1 &&
          count <= 100 &&
          offset + 64 + payloadBytes <= bytes.byteLength,
        'RAW_PACKET_LENGTH',
      );
      for (let index = 0; index < count; index += 1) {
        const raw = bytes.subarray(
          offset + 64 + index * RECORD_BYTES,
          offset + 64 + (index + 1) * RECORD_BYTES,
        );
        const record = decodeRecord(raw);
        if (record.kind === 0 || record.kind === 1) records.set(record.step, raw);
      }
      offset += 64 + payloadBytes;
    }
    return records;
  }
  async acceptPacket(envelope, bytes) {
    demand(++this.packetCount <= 792, 'PACKET_COUNT_BUDGET');
    const world = this.worlds.get(envelope.worldOrdinal);
    demand(world && !world.run, 'PACKET_WORLD_LIFETIME');
    const parsed = await inspectPacket(bytes, envelope);
    demand(parsed.count === envelope.body.count, 'PACKET_BODY_COUNT');
    demand(this.recordCount + parsed.count <= 72081, 'RAW_RECORD_BUDGET');
    const digestParts = [];
    for (let index = 0; index < parsed.count; index += 1) {
      const record = parsed.records[index],
        raw = parsed.payload.subarray(index * RECORD_BYTES, (index + 1) * RECORD_BYTES);
      demand(
        record.mode === world.mode && record.timeUs === record.step * world.dtUs,
        'RAW_SOURCE_TIME',
      );
      if (world.baseline && record.kind !== 4) {
        const prior = world.baseline.get(record.step);
        demand(
          prior &&
            equalBytes(raw.subarray(16, 28), prior.subarray(16, 28)) &&
            equalBytes(raw.subarray(32), prior.subarray(32)),
          'CROSS_REALM_NATIVE_BYTES',
        );
      }
      if (record.kind === 0) {
        demand(
          world.initial === null &&
            world.endpointCount === 0 &&
            record.step === 0 &&
            record.flags === 512,
          'RAW_INITIAL',
        );
        world.initial = raw.slice();
      } else if (record.kind === 1) {
        demand(
          world.initial &&
            record.step === world.endpointCount + 1 &&
            record.step <= (world.quota ? 4 : 400000 / world.dtUs),
          'RAW_ENDPOINT_ORDER',
        );
        demand(
          record.flags === (world.mode === 'split' ? 255 : 127) &&
            record.ncon === 0 &&
            record.nefc === 0 &&
            record.awake === 1,
          'RAW_ENDPOINT_INVARIANTS',
        );
        stateBytes(record.state);
        demand(
          record.warnings.every((w) => w.number === 0 && w.lastinfo === 0),
          'RAW_NATIVE_WARNING',
        );
        const stateDigest = createHash('sha256').update(raw.subarray(32, 240)).digest();
        digestParts.push(stateDigest);
        world.stateDigestByStep.push(stateDigest.toString('hex'));
        world.trajectory.update(stateDigest);
        world.warnings.update(raw.subarray(240));
        world.endpointCount += 1;
        world.lastEndpoint = raw.slice();
        if (this.fixture.sampleTimesUs.includes(record.timeUs))
          world.samples.push({
            timeUs: record.timeUs,
            stepIndex: record.step,
            nativeTime: record.state.time,
            position: record.state.qpos.slice(0, 3),
            quaternion: record.state.qpos.slice(3),
            velocity: record.state.qvel.slice(0, 3),
            angularVelocity: record.state.qvel.slice(3),
            acceleration: record.state.qacc.slice(0, 3),
            nativeState: record.state,
            nativeStateHex: Buffer.from(raw.subarray(32, 240)).toString('hex'),
            contactCount: record.ncon,
            constraintCount: record.nefc,
            clearanceM: record.state.qpos[2] - this.fixture.sphereRadiusM - this.fixture.floorTopZ,
          });
      } else if (record.kind === 2 || record.kind === 3) {
        demand(
          world.lastEndpoint &&
            record.step === world.endpointCount &&
            record.flags === 256 &&
            equalBytes(raw.subarray(16, 28), world.lastEndpoint.subarray(16, 28)) &&
            equalBytes(raw.subarray(32), world.lastEndpoint.subarray(32)),
          'RAW_CONTINUATION_CHANGED_STATE',
        );
        if (record.kind === 2) {
          demand(
            world.ordinal % 21 === 0 &&
              world.realm !== 'node-child' &&
              record.step === 400 &&
              world.resumed++ === 0,
            'RAW_OFFLINE_RECORD',
          );
        } else {
          demand(world.quota && record.step === 4 && world.refused++ === 0, 'RAW_QUOTA_RECORD');
        }
      } else {
        demand(
          record.kind === 4 &&
            record.flags === 0 &&
            Number.isInteger(record.step) &&
            record.step >= world.endpointCount &&
            record.step <= (world.quota ? 4 : 400000 / world.dtUs) &&
            this.failureFrameCount === 0,
          'RAW_FAILURE_FRAME',
        );
        this.failureFrameCount += 1;
        world.failureFrames = (world.failureFrames ?? 0) + 1;
      }
    }
    this.acceptedPacketCount += 1;
    await this.writeBytes(world.folder + '/raw.bin', bytes, 'raw', true);
    if (digestParts.length)
      await this.writeBytes(
        world.folder + '/state-sha256.bin',
        Buffer.concat(digestParts),
        'digests',
        true,
      );
    world.raw.update(bytes);
    world.durableEndpointCount = world.endpointCount;
    world.durableFailureFrames = world.failureFrames ?? 0;
    this.durablePacketCount += 1;
    this.recordCount += parsed.count;
  }
  async endWorld(envelope) {
    const world = this.worlds.get(envelope.worldOrdinal);
    demand(world && world.realm === envelope.realm && !world.receivedEnd, 'WORLD_END_IDENTITY');
    const received = validateWorldReceipt(envelope.body, world),
      { run, counters } = received;
    world.receivedEnd = received;
    world.counters = counters;
    try {
      if (!run.error) {
        const limit = world.quota ? 4 : 400000 / world.dtUs;
        demand(
          run.steps === limit &&
            run.steps === world.endpointCount &&
            run.steps === world.durableEndpointCount &&
            run.recordAccounting.validatedEndpoints === run.steps &&
            run.recordAccounting.emittedEndpoints === run.steps &&
            run.recordAccounting.acknowledgedEndpoints === run.steps &&
            (world.failureFrames ?? 0) === 0,
          'WORLD_SUCCESS_COMPLETENESS',
        );
        demand(
          run.xml === this.assessor.makeModelXml(this.fixture, world.massKg, world.dtUs) &&
            run.xmlSha256 === hash(Buffer.from(run.xml)),
          'WORLD_XML_IDENTITY',
        );
        demand(
          world.initial &&
            equalBytes(stateBytes(run.initialReadback.initial), world.initial.subarray(32, 240)),
          'WORLD_INITIAL_READBACK_BYTES',
        );
        demand(
          world.refused === (world.quota ? 1 : 0) &&
            world.resumed === (world.ordinal % 21 === 0 && world.realm !== 'node-child' ? 1 : 0),
          'WORLD_DIAGNOSTIC_RECORDS',
        );
      }
      const state = world.lastEndpoint ? decodeRecord(world.lastEndpoint) : null;
      world.run = {
        ...run,
        samples: world.samples,
        stateDigestByStep: world.stateDigestByStep,
        trajectorySha256: world.trajectory.copy().digest('hex'),
        warningTrajectorySha256: world.warnings.copy().digest('hex'),
        lastObservation: state
          ? {
              stepIndex: state.step,
              phase: run.phase,
              state: state.state,
              warnings: state.warnings,
              contactCount: state.ncon,
              constraintCount: state.nefc,
            }
          : null,
      };
    } catch (error) {
      world.hostFailure = failureRecord(error, 'world_end_validation');
      await this.writeWorldMetadata(world);
      throw error;
    }
    await this.writeWorldMetadata(world);
    world.baseline = null;
  }
  async finishRealm(envelope) {
    const result = receiptSnapshot(envelope.body, 16384);
    sameIdentity(this.identities.get(envelope.realm), result.identity);
    demand(
      result.realm === envelope.realm &&
        ['SAMPLED', 'FAIL', 'INCOMPLETE'].includes(result.verdict) &&
        Array.isArray(result.worlds) &&
        result.worlds.length <= 21 &&
        Array.isArray(result.secondaryErrors) &&
        result.secondaryErrors.length <= 8,
      'REALM_END_SCHEMA',
    );
    validateNativeSnapshot(result.counters, envelope.realm);
    validateAdmissionSnapshot(result.accounting, result.instantiation, envelope.realm);
    for (const error of [result.error, ...result.secondaryErrors].filter(Boolean))
      failureError(error);
    await this.rememberReceipt('realm-end', envelope, result, envelope.sequence);
    demand(!this.realms.some((item) => item.realm === envelope.realm), 'REALM_END_DUPLICATE');
    this.realms.push(result);
    const worlds = [...this.worlds.values()].filter((world) => world.realm === envelope.realm);
    const positive = worlds.filter((world) => !world.quota);
    const complete =
      result.verdict === 'SAMPLED' &&
      !result.error &&
      result.secondaryErrors.length === 0 &&
      worlds.length === 21 &&
      positive.length === 20 &&
      result.worlds.length === 21 &&
      worlds.every(
        (world) =>
          world.run &&
          !world.run.error &&
          !world.hostFailure &&
          world.run.steps === (world.quota ? 4 : 400000 / world.dtUs) &&
          world.endpointCount === world.run.steps &&
          world.durableEndpointCount === world.run.steps,
      );
    let assessment;
    if (complete) {
      assertRealmCounters(result.counters);
      const counters = positive.at(-1).counters;
      assessment = this.assessor.assessPhy01(
        this.fixture,
        positive.map((world) => world.run),
        {
          worlds: positive.length,
          modelsCreated: counters.models.returned,
          dataCreated: counters.data.returned,
          modelsDeleted: counters.modelsDeleted.returned,
          dataDeleted: counters.dataDeleted.returned,
          nativeStepsDispatched: counters.advancesDispatched,
          nativeStepsCompleted: counters.advancesCompleted,
        },
      );
    } else
      assessment = {
        verdict: 'NOT_RUN',
        summary: 'Incomplete native observations; physical assessor not invoked',
        failures: [],
        cases: [],
        nativeOutcome: result.verdict,
      };
    this.assessments.push({ realm: envelope.realm, ...assessment });
    for (const world of worlds.filter((item) => item.run)) {
      const observedFailure = world.run.failure;
      await this.writeJson(
        world.folder + '/summary.json',
        {
          worldOrdinal: world.ordinal,
          quota: world.quota,
          error: world.run.error,
          nativeCompleted: world.run.steps,
          emittedEndpoints: world.run.recordAccounting.emittedEndpoints,
          acceptedEndpoints: world.endpointCount,
          durableEndpoints: world.durableEndpointCount,
          failureFrames: world.failureFrames ?? 0,
          trajectorySha256: world.run.trajectorySha256,
          warningTrajectorySha256: world.run.warningTrajectorySha256,
          assessment: !complete
            ? {
                verdict: observedFailure?.classification ?? 'INCOMPLETE',
                physicalAssessment: 'NOT_RUN',
              }
            : world.quota
              ? { verdict: 'PASS', physicalAcceptance: 'NOT_APPLICABLE_QUOTA_NEGATIVE' }
              : assessment.cases.find(
                  (item) =>
                    item.key === [world.mode, world.massKg, world.dtUs, world.repeat].join('/'),
                ),
        },
        'worldSummary',
        16384,
      );
    }
    if (complete && assessment.verdict !== 'PASS')
      throw new PortabilityError('PHYSICAL_ASSESSMENT_FAILED', {
        realm: envelope.realm,
        summary: assessment.summary,
      });
    if (!complete && result.verdict === 'SAMPLED')
      throw new PortabilityError('REALM_OBSERVATIONS_INCOMPLETE');
  }
  async handle(envelope, bytes, barrier) {
    // Preserve received receipts before an earlier I/O failure or a later ACK failure propagates.
    if (envelope.kind === 'module') await this.recordModule(envelope);
    else if (envelope.kind === 'world-end') await this.endWorld(envelope);
    else if (envelope.kind === 'realm-end') await this.finishRealm(envelope);
    if (this.ioError) throw this.ioError;
    await this.protocol('received', envelope, bytes?.byteLength ?? 0);
    let value = null;
    if (envelope.kind === 'world-start') await this.beginWorld(envelope);
    else if (envelope.kind === 'packet') await this.acceptPacket(envelope, bytes);
    else if (envelope.kind === 'negative') {
      demand(
        this.negative.length < 18 && text(envelope.body).byteLength <= 8192,
        'NEGATIVE_METADATA_LIMIT',
      );
      this.negative.push({ realm: envelope.realm, ...envelope.body });
    } else if (envelope.kind === 'offline-barrier') {
      demand(typeof barrier === 'function', 'OFFLINE_UNEXPECTED');
      value = await barrier(envelope);
    } else
      demand(['module', 'world-end', 'realm-end'].includes(envelope.kind), 'HOST_PROTOCOL_KIND');
    await this.protocol('acknowledged', envelope);
    return value;
  }
  async finalize(runtime, failure) {
    await this.queue.catch(() => {});
    const observedFailures = this.observedFailures();
    const propagation = failure ? failureRecord(failure, 'host_finalization') : null;
    const reasons = [
      ...observedFailures,
      propagation,
      ...(runtime.resources?.cleanupFailures ?? []),
      runtime.resources?.nodeForcedTermination
        ? failureRecord(new PortabilityError('FORCED_TERMINATION'), 'node_child')
        : null,
      this.ioError ? failureRecord(this.ioError, 'journal_io') : null,
    ].filter(Boolean);
    const verdict = reasons.length ? failureOutcome(reasons) : 'PASS_FOR_BOUNDED_PORTABILITY_ONLY';
    for (const world of this.worlds.values()) {
      await this.writeWorldMetadata(world);
      if (!this.files.has(world.folder + '/summary.json'))
        await this.writeJson(
          world.folder + '/summary.json',
          {
            worldOrdinal: world.ordinal,
            verdict: world.receivedEnd?.run.failure?.classification ?? 'INCOMPLETE',
            physicalAssessment: 'NOT_RUN',
            nativeCompleted: world.receivedEnd?.run.steps ?? 'UNKNOWN',
            acceptedEndpoints: world.endpointCount,
            durableEndpoints: world.durableEndpointCount,
            failureFrames: world.failureFrames ?? 0,
          },
          'worldSummary',
          16384,
        );
    }
    await this.writeJson(
      'runtime.json',
      {
        ...runtime,
        realms: this.realms,
        receipts: this.receiptReferences(),
        lastObservedNative: REALMS.map((realm) => this.latestNativeObservation(realm)),
        assessments: this.assessments.map(({ realm, verdict, summary, failures }) => ({
          realm,
          verdict,
          summary,
          failures,
        })),
        receivedPacketCount: this.packetCount,
        acceptedPacketCount: this.acceptedPacketCount,
        durablePacketCount: this.durablePacketCount,
        durableRecordCount: this.recordCount,
        receivedFailureFrames: this.failureFrameCount,
        journal: { used: this.allowance.used, bytes: this.allowance.total },
      },
      'realmMetadata',
      98304,
    );
    await this.writeJson('negative.json', this.negative, 'negativeMetadata');
    await this.writeJson(
      'failure.json',
      reasons.length
        ? {
            status: verdict,
            primary: observedFailures[0] ?? propagation,
            propagation,
            observedFailures,
            receivedReceipts: [...this.receipts.values()].map(
              ({ key, snapshot, durable, sha256 }) => ({ key, snapshot, durable, sha256 }),
            ),
            ioError: this.ioError ? failureRecord(this.ioError, 'journal_io') : null,
          }
        : { status: 'NONE' },
      'emergencyNonData',
    );
    const files = [];
    for (const path of [...this.files].sort()) {
      const bytes = await readFile(join(this.directory, path));
      files.push({ path, bytes: bytes.byteLength, sha256: hash(bytes) });
    }
    await this.writeJson(
      'manifest.json',
      {
        schema: 'MUJOCO_PORTABILITY_RAW_V1',
        verdict,
        files,
        nativeCompileObservation: 'UNKNOWN_INTERNAL_COMPILE_COUNT',
        maximumFiles: 261,
        totalBytesBeforeManifest: this.allowance.total,
        D01: 'NOT_ACCEPTED',
        D04: 'BLOCKED',
      },
      'invocationManifest',
    );
    this.closed = true;
  }
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(
      () => reject(new PortabilityError('TIMEOUT:' + label)),
      milliseconds,
    );
  });
  return Promise.race([promise, timeout]).finally(() => globalThis.clearTimeout(timer));
}
async function loadAssessor(predata, contract) {
  for (const root of [ROOT, predata.dependencyRoot])
    demand(
      hash(await readFile(join(root, ORIGINAL_PATH))) === contract.phy01Module,
      'ORIGINAL_ASSESSOR_IDENTITY',
    );
  // This module's pure exports are loaded from the identical read-only checkout
  // so its existing YAML dependency resolves normally without install/symlink.
  const module = await import(pathToFileURL(join(predata.dependencyRoot, ORIGINAL_PATH)).href);
  return { assessPhy01: module.assessPhy01, makeModelXml: module.makeModelXml };
}
async function startAssetServer(bundle, journal, resources, takeOwnership) {
  demand(typeof takeOwnership === 'function', 'SERVER_OWNER_REQUIRED');
  demand(resources.httpServersCreated === 0, 'SERVER_BUDGET');
  const { createServer } = createRequire(import.meta.url)('node:http');
  const server = createServer((request, response) => {
    try {
      const route = resolveLocalRoute(request.url, request.method);
      if (route === '/negative/missing-mujoco.wasm') {
        response.writeHead(404, { 'Content-Length': '0', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      const asset = bundle.assets.get(route);
      demand(asset, 'ASSET_NOT_REGISTERED');
      response.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': String(asset.bytes.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(asset.bytes);
    } catch (error) {
      journal.ioError ??= error;
      response.writeHead(400, { 'Content-Length': '0' });
      response.end();
    }
  });
  resources.httpServersCreated += 1;
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const owner = { server, sockets, baseUrl: null };
  takeOwnership(owner); // The caller owns cleanup before listen can fail or time out.
  const listening = once(server, 'listening');
  resources.serverListenDispatched = (resources.serverListenDispatched ?? 0) + 1;
  server.listen({ host: '127.0.0.1', port: 0 });
  await withTimeout(listening, 5000, 'server-listening');
  resources.serverListenReturned = (resources.serverListenReturned ?? 0) + 1;
  const address = server.address();
  demand(
    address &&
      typeof address === 'object' &&
      address.address === '127.0.0.1' &&
      address.port !== 4630,
    'SERVER_BIND_IDENTITY',
  );
  resources.serverAddress = { host: address.address, port: address.port };
  owner.baseUrl = 'http://127.0.0.1:' + address.port + '/';
  return owner;
}
async function closeAssetServer(owner, resources) {
  if (!owner) return;
  resources.serverCloseDispatched = (resources.serverCloseDispatched ?? 0) + 1;
  const closing = new Promise((resolveClose, reject) =>
    owner.server.close((error) => {
      resources.serverCloseCallbacks = (resources.serverCloseCallbacks ?? 0) + 1;
      if (error?.code === 'ERR_SERVER_NOT_RUNNING') {
        resources.serverClosedWithoutListening = (resources.serverClosedWithoutListening ?? 0) + 1;
        resolveClose();
      } else if (error) reject(error);
      else resolveClose();
    }),
  );
  owner.server.closeAllConnections();
  await withTimeout(closing, 5000, 'server-close');
  demand(owner.sockets.size === 0, 'SERVER_LIVE_SOCKETS');
  resources.httpServersClosed += 1;
}
async function nodeChild(predata, config, journal, resources) {
  demand(resources.nodeChildrenCreated === 0, 'NODE_CHILD_BUDGET');
  journal.registerRealm(config.identity);
  const receiver = new ProtocolReceiver(config.identity);
  const child = fork(fileURLToPath(import.meta.url), ['--node-child'], {
    execPath: process.execPath,
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, MUJOCO_PORTABILITY_CHILD: predata.runId },
  });
  resources.nodeChildrenCreated += 1;
  resources.nodeChildPid = child.pid;
  let terminal,
    failure,
    exitCode,
    terminalPending = Promise.resolve();
  const exited = new Promise((resolveExit) =>
    child.once('exit', (code, signal) => {
      exitCode = code;
      resources.nodeChildrenExited += 1;
      resources.nodeChildExit = { code, signal };
      resolveExit();
    }),
  );
  child.stdout.on('data', (bytes) =>
    journal.log('node stdout: ' + bytes.toString('utf8')).catch((error) => {
      failure ??= error;
    }),
  );
  child.stderr.on('data', (bytes) =>
    journal.log('node stderr: ' + bytes.toString('utf8')).catch((error) => {
      failure ??= error;
    }),
  );
  child.on('error', (error) => {
    failure ??= new PortabilityError('NODE_CHILD_LOST', String(error));
  });
  child.on('message', (message) => {
    if (message?.kind === 'node-disposed' || message?.kind === 'node-failed') {
      terminal = message.result;
      terminalPending = journal
        .captureTerminal(config.identity, terminal, message.kind)
        .catch((error) => {
          failure ??= error;
        });
      return;
    }
    if (message?.kind !== 'event') {
      failure ??= new PortabilityError('NODE_CHILD_PROTOCOL');
      return;
    }
    receiver
      .receive(message.envelope, (envelope) =>
        journal.handle(envelope, message.buffer ? new Uint8Array(message.buffer) : null, null),
      )
      .then(
        (ack) => {
          if (child.connected) child.send({ kind: 'ack', ack });
        },
        (error) => {
          failure ??= error;
          if (child.connected)
            child.send({ kind: 'fatal', failure: failureRecord(error, 'node_host_ack') });
        },
      );
  });
  try {
    child.send({ kind: 'start', config, engineRoot: predata.engineRoot });
    await withTimeout(exited, config.remainingMs, 'node-child');
  } catch (error) {
    failure ??= error;
  } finally {
    if (resources.nodeChildrenExited === 0) {
      resources.nodeForcedTermination = true;
      child.kill(); // Only this invocation's exact owned child handle.
      try {
        await withTimeout(exited, 5000, 'node-child-termination');
      } catch (error) {
        (resources.cleanupFailures ??= []).push(failureRecord(error, 'node_termination'));
        failure ??= error;
      }
    }
    await terminalPending; // Persist received counters/disposal before propagation, even on failed ACK.
  }
  if (failure) throw failure;
  demand(terminal, 'NODE_CHILD_LOST');
  if (terminal.verdict !== 'SAMPLED')
    throw failureError(
      terminal.error ?? failureRecord(new PortabilityError('NODE_CHILD_INCOMPLETE')),
    );
  demand(
    exitCode === 0 &&
      terminal.counters.liveData === 0 &&
      terminal.counters.liveModels === 0 &&
      terminal.counters.liveWarningCopies === 0,
    'NODE_CHILD_INCOMPLETE',
  );
  return terminal;
}
async function runNodeChild() {
  demand(
    typeof process.send === 'function' &&
      /^[A-Za-z0-9_-]{8,80}$/.test(process.env.MUJOCO_PORTABILITY_CHILD ?? ''),
    'NODE_CHILD_REQUIRES_PARENT',
  );
  let pending = null,
    started = false,
    failed = null;
  const send = (envelope, bytes, onDispatched) =>
    new Promise((resolveAck, reject) => {
      if (failed) {
        reject(failed);
        return;
      }
      demand(pending === null, 'NODE_CHILD_INFLIGHT');
      pending = { envelope, resolveAck, reject };
      process.send({ kind: 'event', envelope, buffer: bytes ? Buffer.from(bytes) : null });
      onDispatched?.();
    });
  const handler = (message) => {
    if (message?.kind === 'fatal') {
      failed = message.failure
        ? failureError(message.failure)
        : new PortabilityError('NODE_PARENT_FAILURE', message.reason);
      if (pending) {
        pending.reject(failed);
        pending = null;
      }
      return;
    }
    if (message?.kind === 'ack') {
      if (pending) {
        const current = pending;
        pending = null;
        current.resolveAck(message.ack);
      } else failed = new PortabilityError('NODE_UNEXPECTED_ACK');
      return;
    }
    if (message?.kind !== 'start' || started) {
      failed = new PortabilityError('NODE_START_PROTOCOL');
      return;
    }
    started = true;
    const { config, engineRoot } = message;
    demand(
      config.identity.realm === 'node-child' &&
        config.identity.runId === process.env.MUJOCO_PORTABILITY_CHILD,
      'NODE_CHILD_IDENTITY',
    );
    const logs = [];
    let logBytes = 0;
    runRealm({
      ...config,
      send,
      assets: {
        wasmLocation: join(engineRoot, 'mujoco.wasm'),
        readWasm: async (kind) => {
          if (kind === 'missing') {
            try {
              return new Uint8Array(
                await readFile(join(engineRoot, 'asa-portability-intentionally-missing.wasm')),
              );
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
              throw new PortabilityError('ASSET_UNAVAILABLE', { code: error.code });
            }
          }
          const bytes = new Uint8Array(await readFile(join(engineRoot, 'mujoco.wasm')));
          if (kind === 'corrupt') {
            demand(bytes[0] === 0, 'WASM_MAGIC');
            bytes[0] = 1;
          }
          return bytes;
        },
        readJs: async () => new Uint8Array(await readFile(join(engineRoot, 'mujoco.js'))),
        importEngine: () => import(pathToFileURL(join(engineRoot, 'mujoco.js')).href),
        log: (message) => {
          const line = String(message);
          logBytes += Buffer.byteLength(line);
          demand(logBytes <= 262144, 'ENGINE_LOG_BUDGET');
          logs.push(line);
        },
      },
    }).then(
      (result) => {
        process.off('message', handler);
        process.send(
          {
            kind: 'node-disposed',
            result: terminalReceipt(result, { logs }),
          },
          () => {
            process.disconnect();
            process.exitCode = result.verdict === 'SAMPLED' ? 0 : 1;
          },
        );
      },
      (error) => {
        process.off('message', handler);
        process.send(
          {
            kind: 'node-failed',
            result: {
              identity: config.identity,
              realm: config.identity.realm,
              verdict: 'INCOMPLETE',
              counters: null,
              accounting: null,
              instantiation: null,
              module: null,
              error: failureRecord(error, 'node_realm_rejection'),
              secondaryErrors: [],
              lastWorld: null,
              lastMemoryBytes: null,
              logs,
            },
          },
          () => {
            process.disconnect();
            process.exitCode = 1;
          },
        );
      },
    );
  };
  process.on('message', handler);
}

// Serialized by Playwright into the already-created blank page. It imports only
// the frozen browser graph and constructs exactly one real Worker when selected.
async function browserEntry(config) {
  const api = await import(
    new globalThis.URL('/src/mujoco-portability-runtime.mjs', config.baseUrl).href
  );
  const binding = (message) => globalThis.__mujocoPortabilityEvent(message);
  const terminalBinding = (result, channel) =>
    globalThis.__mujocoPortabilityTerminal({ result, channel });
  if (config.identity.realm === 'browser-main') {
    let terminal;
    try {
      const result = await api.runBrowserRealm(config, (envelope, bytes, onDispatched) => {
        const sent = binding({ envelope, base64: bytes ? api.encodeBase64(bytes) : null });
        onDispatched?.();
        return sent;
      });
      terminal = api.terminalReceipt(result, { logs: result.logs });
    } catch (error) {
      terminal = {
        identity: config.identity,
        realm: config.identity.realm,
        verdict: 'INCOMPLETE',
        counters: null,
        accounting: null,
        instantiation: null,
        module: null,
        error: api.failureRecord(error, 'browser_realm_rejection'),
        secondaryErrors: [],
        lastWorld: null,
        lastMemoryBytes: null,
      };
      await terminalBinding(terminal, 'browser-failed');
      return terminal;
    }
    await terminalBinding(terminal, 'browser-terminal');
    return terminal;
  }
  const worker = new globalThis.Worker(
    new globalThis.URL('/src/mujoco-portability-worker.mjs', config.baseUrl),
    { type: 'module', name: config.identity.runId },
  );
  return api.relayWorker(worker, config, binding, terminalBinding);
}
async function browserRealm(browser, config, journal, resources) {
  journal.registerRealm(config.identity);
  demand(
    resources.contextsCreated - resources.contextsClosed === 0 && resources.contextsCreated < 2,
    'BROWSER_CONTEXT_BUDGET',
  );
  const context = await browser.newContext({ serviceWorkers: 'block' });
  resources.contextsCreated += 1;
  const receiver = new ProtocolReceiver(config.identity);
  let offline = false,
    networkFailure = null,
    activeWorkers = 0,
    workersClosed = 0;
  const workerClosePromises = [];
  let page = null,
    primaryFailure = null,
    completedResult = null;
  try {
    const observe = (event) => {
      try {
        journal.network({ realm: config.identity.realm, offline, ...event }).catch((error) => {
          networkFailure ??= error;
        });
      } catch (error) {
        networkFailure ??= error;
      }
    };
    context.on('request', (request) =>
      observe({ event: 'request', method: request.method(), url: request.url() }),
    );
    context.on('response', (response) =>
      observe({ event: 'response', status: response.status(), url: response.url() }),
    );
    context.on('requestfailed', (request) =>
      observe({
        event: 'requestfailed',
        url: request.url(),
        error: request.failure()?.errorText ?? null,
      }),
    );
    await context.route('**/*', async (route) => {
      const request = route.request(),
        url = new globalThis.URL(request.url());
      const permitted =
        url.origin === new globalThis.URL(config.baseUrl).origin &&
        request.method() === 'GET' &&
        ROUTES.includes(url.pathname) &&
        url.search === '' &&
        url.hash === '';
      if (!permitted || (offline && url.pathname !== '/offline-sentinel')) {
        networkFailure ??= new PortabilityError('UNREGISTERED_APPLICATION_REQUEST', {
          url: request.url(),
          offline,
        });
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue(); // Never fulfill cached bytes across the offline barrier.
    });
    page = await context.newPage();
    resources.pagesCreated += 1;
    page.on('worker', (worker) => {
      resources.workersCreated += 1;
      activeWorkers += 1;
      if (config.identity.realm !== 'dedicated-worker' || resources.workersCreated !== 1)
        networkFailure ??= new PortabilityError('WORKER_BUDGET');
      workerClosePromises.push(
        new Promise((resolveClose) =>
          worker.once('close', () => {
            resources.workersClosed += 1;
            workersClosed += 1;
            activeWorkers -= 1;
            resolveClose();
          }),
        ),
      );
    });
    page.on('console', (message) =>
      journal.log('browser console: ' + message.text()).catch((error) => {
        networkFailure ??= error;
      }),
    );
    page.on('pageerror', (error) => {
      networkFailure ??= error;
    });
    const barrier = async (envelope) => {
      demand(
        !offline &&
          envelope.body.tick === 400 &&
          envelope.body.sourceTimeUs === 200000 &&
          envelope.worldOrdinal % 21 === 0,
        'OFFLINE_BARRIER_IDENTITY',
      );
      await context.setOffline(true);
      offline = true;
      const observed = await page.evaluate(async (sentinel) => {
        let sentinelFailed = false;
        try {
          await globalThis.fetch(sentinel, { cache: 'no-store' });
        } catch {
          sentinelFailed = true;
        }
        return { online: globalThis.navigator.onLine, sentinelFailed };
      }, new globalThis.URL('/offline-sentinel', config.baseUrl).href);
      demand(observed.online === false && observed.sentinelFailed, 'OFFLINE_NOT_OBSERVED');
      resources.offlineBarriers += 1;
      return {
        offline: true,
        sentinelFailed: true,
        worldOrdinal: envelope.worldOrdinal,
        tick: 400,
        sourceTimeUs: 200000,
      };
    };
    await page.exposeBinding('__mujocoPortabilityEvent', async (_source, message) => {
      try {
        if (networkFailure) throw networkFailure;
        const bytes = message.base64 === null ? null : decodeBase64(message.base64);
        return await receiver.receive(message.envelope, (envelope) =>
          journal.handle(envelope, bytes, barrier),
        );
      } catch (error) {
        return { kind: 'fatal', failure: failureRecord(error, 'browser_host_ack') };
      }
    });
    await page.exposeBinding('__mujocoPortabilityTerminal', async (_source, message) =>
      journal.captureTerminal(config.identity, message.result, message.channel),
    );
    await page.goto(config.baseUrl, { waitUntil: 'load' });
    const result = await withTimeout(
      page.evaluate(browserEntry, config),
      config.remainingMs,
      config.identity.realm,
    );
    if (config.identity.realm === 'dedicated-worker')
      await withTimeout(Promise.all(workerClosePromises), 5000, 'worker-self-close');
    await journal.queue;
    if (networkFailure) throw networkFailure;
    if (result.verdict !== 'SAMPLED')
      throw failureError(
        result.error ?? failureRecord(new PortabilityError('BROWSER_REALM_INCOMPLETE')),
      );
    demand(
      offline &&
        result.counters.liveModels === 0 &&
        result.counters.liveData === 0 &&
        result.counters.liveWarningCopies === 0,
      'BROWSER_REALM_INCOMPLETE',
    );
    if (config.identity.realm === 'dedicated-worker') {
      demand(
        workersClosed === 1 &&
          activeWorkers === 0 &&
          result.resources.disposed &&
          result.resources.packetsTransferred === 264 &&
          result.resources.senderBuffersDetached === 264 &&
          result.resources.listenersCreated === 1 &&
          result.resources.listenersRemoved === 1,
        'WORKER_DISPOSAL_RECEIPT',
      );
    } else
      demand(activeWorkers === 0 && workerClosePromises.length === 0, 'MAIN_UNEXPECTED_WORKER');
    completedResult = result;
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (activeWorkers > 0) {
      resources.workerForcedByContext = true;
      (resources.cleanupFailures ??= []).push(
        failureRecord(new PortabilityError('FORCED_TERMINATION'), 'worker_context_close'),
      );
    }
    try {
      await withTimeout(context.close(), 5000, 'context-close');
      resources.contextsClosed += 1;
      if (page) resources.pagesClosed += 1;
    } catch (cleanupError) {
      (resources.cleanupFailures ??= []).push(failureRecord(cleanupError, 'context_close'));
      primaryFailure ??= cleanupError;
    }
  }
  if (primaryFailure) throw primaryFailure;
  return completedResult;
}

async function executeNative(predataPath) {
  const { fixture, contract, arithmetic } = await loadInputs();
  const predataBytes = await readFile(predataPath);
  const requested = parseBoundedJson(predataBytes);
  const source = await sourceSnapshot(requested.sourceHead);
  const predata = validateExecutionApproval(requested, source, contract);
  demand(
    resolve(predata.outputDirectory) !== ROOT &&
      !resolve(predata.outputDirectory).startsWith(ROOT + '\\') &&
      !resolve(predata.outputDirectory).startsWith(ROOT + '/'),
    'OUTPUT_OUTSIDE_SOURCE',
  );
  demand(
    hash(await readFile(predata.chromiumExecutable)) === predata.chromiumSha256,
    'CHROMIUM_EXECUTABLE_IDENTITY',
  );
  const corePath = join(
    predata.dependencyRoot,
    'node_modules/.pnpm/playwright-core@1.55.1/node_modules/playwright-core',
  );
  const corePackage = JSON.parse(await readFile(join(corePath, 'package.json'), 'utf8'));
  demand(corePackage.version === '1.55.1', 'PLAYWRIGHT_VERSION');
  const cachedBrowsers = JSON.parse(await readFile(join(corePath, 'browsers.json'), 'utf8'));
  demand(
    cachedBrowsers.browsers.some(
      (entry) =>
        entry.name === 'chromium' &&
        entry.revision === '1193' &&
        entry.browserVersion === '140.0.7339.186',
    ),
    'CHROMIUM_CACHE_METADATA',
  );
  const bundle = await exactAssets(predata, source, contract);
  const assessor = await loadAssessor(predata, contract);
  const journal = new HostJournal(predata.outputDirectory, fixture, contract, assessor);
  await journal.init(
    {
      schema: 'MUJOCO_PORTABILITY_INVOCATION_V1',
      utc: new Date().toISOString(),
      predataSha256: hash(predataBytes),
      predata,
      source,
      sourceManifestSha256: bundle.manifestSha256,
      assets: bundle.manifest,
      nodeExecutable: process.execPath,
    },
    { fixture, contract, arithmetic },
  );
  const resources = {
    nodeOrchestrators: 1,
    nodeChildrenCreated: 0,
    nodeChildrenExited: 0,
    browserLaunches: 0,
    browsersClosed: 0,
    contextsCreated: 0,
    contextsClosed: 0,
    pagesCreated: 0,
    pagesClosed: 0,
    workersCreated: 0,
    workersClosed: 0,
    httpServersCreated: 0,
    httpServersClosed: 0,
    offlineBarriers: 0,
    chromiumProcessObservations: [],
    cleanupFailures: [],
    wasmAccountingScope: 'Three pinned MuJoCo instantiations in the three measured realms only.',
    hostAndChromiumInternalWasm: {
      observation: 'OUTSIDE_MEASURED_MUJOCO_BOUNDARIES',
      actualCalls: null,
      note: 'Host HTTP/tooling and Chromium may internally use other WASM. No zero/all-process claim.',
    },
    maxLiveNativeRealmsBySequentialOwnership: 1,
  };
  let browser,
    serverOwner,
    failure = null;
  const started = Date.now(),
    deadline = started + 300000;
  const remaining = () => {
    const left = deadline - Date.now();
    demand(left > 0, 'OVERALL_WALL_DEADLINE');
    return left;
  };
  const configFor = (realm) => ({
    identity: {
      protocolVersion: 1,
      runId: predata.runId,
      generation: 1,
      sourceManifestSha256: bundle.manifestSha256,
      realm,
    },
    fixture,
    contract,
    remainingMs: remaining(),
  });
  try {
    await nodeChild(predata, configFor('node-child'), journal, resources);
    demand(resources.nodeChildrenExited === 1, 'NODE_REALM_NOT_TERMINATED');
    serverOwner = await startAssetServer(bundle, journal, resources, (owner) => {
      serverOwner = owner;
    });
    const { chromium } = await import(pathToFileURL(join(corePath, 'index.mjs')).href);
    resources.browserLaunches += 1;
    browser = await chromium.launch({
      executablePath: predata.chromiumExecutable,
      headless: true,
      timeout: Math.min(30000, remaining()),
    });
    resources.browserVersion = browser.version();
    demand(resources.browserVersion === predata.chromiumVersion, 'ACTUAL_CHROMIUM_VERSION');
    const cdp = await browser.newBrowserCDPSession();
    try {
      resources.chromiumProcessObservations.push({
        phase: 'launched',
        processes: (await cdp.send('SystemInfo.getProcessInfo')).processInfo,
      });
    } finally {
      await cdp.detach();
    }
    for (const realm of ['browser-main', 'dedicated-worker'])
      await browserRealm(
        browser,
        { ...configFor(realm), baseUrl: serverOwner.baseUrl },
        journal,
        resources,
      );
    demand(
      journal.realms.length === 3 &&
        journal.assessments.every((item) => item.verdict === 'PASS') &&
        journal.packetCount === 791 &&
        journal.recordCount === 72080,
      'GLOBAL_NATIVE_COMPLETENESS',
    );
    demand(
      journal.negative.length === 18 && journal.negative.every((item) => item.verdict === 'PASS'),
      'GLOBAL_NEGATIVE_COMPLETENESS',
    );
    for (const realm of REALMS) {
      const ids = journal.negative.filter((item) => item.realm === realm).map((item) => item.id);
      demand(
        JSON.stringify(ids) === JSON.stringify(contract.negativeCases),
        'NEGATIVE_CASE_IDENTITIES',
      );
    }
    const aggregate = (read) => journal.realms.reduce((sum, result) => sum + read(result), 0);
    demand(
      aggregate((r) => r.accounting.factory.dispatched) === 3 &&
        aggregate((r) => r.accounting.factory.returned) === 3,
      'GLOBAL_FACTORY_ACCOUNTING',
    );
    demand(
      aggregate((r) => r.instantiation.dispatched) === 3 &&
        aggregate((r) => r.instantiation.returned) === 3 &&
        aggregate((r) => r.instantiation.rejected) === 0 &&
        journal.realms.every(
          (r) =>
            r.instantiation.scope === 'PINNED_MUJOCO_REALM' &&
            r.instantiation.input?.realm === r.realm &&
            r.instantiation.input?.sha256 ===
              contract.engine.files.find((file) => file.path === 'mujoco.wasm').sha256,
        ),
      'GLOBAL_PINNED_MUJOCO_INSTANTIATION_ACCOUNTING',
    );
    demand(
      aggregate((r) => r.counters.worlds) === 63 &&
        aggregate((r) => r.counters.advancesCompleted) === 72012 &&
        aggregate((r) => r.counters.warningGet.returned) === 504560,
      'GLOBAL_NATIVE_BUDGET',
    );
    demand(
      resources.contextsCreated === 2 &&
        resources.contextsClosed === 2 &&
        resources.workersCreated === 1 &&
        resources.workersClosed === 1 &&
        resources.offlineBarriers === 2,
      'GLOBAL_MANAGED_OWNERSHIP',
    );
    const after = await sourceSnapshot(predata.sourceHead);
    demand(hash(await readFile(predataPath)) === hash(predataBytes), 'PREDATA_CHANGED_DURING_RUN');
    demand(JSON.stringify(after) === JSON.stringify(source), 'SOURCE_CHANGED_DURING_RUN');
    for (const entry of contract.engine.files)
      demand(
        hash(await readFile(join(predata.engineRoot, entry.path))) === entry.sha256,
        'ENGINE_CHANGED_DURING_RUN',
      );
  } catch (error) {
    failure = error;
  } finally {
    if (browser) {
      try {
        await withTimeout(browser.close(), 5000, 'browser-close');
        resources.browsersClosed += 1;
      } catch (error) {
        failure ??= error;
        resources.browserCloseError = String(error);
        resources.cleanupFailures.push(failureRecord(error, 'browser_close'));
      }
    }
    if (serverOwner) {
      try {
        await closeAssetServer(serverOwner, resources);
      } catch (error) {
        failure ??= error;
        resources.serverCloseError = String(error);
        resources.cleanupFailures.push(failureRecord(error, 'server_close'));
      }
    }
    resources.elapsedWallMs = Date.now() - started;
    if (
      !failure &&
      (resources.browserLaunches !== resources.browsersClosed ||
        resources.httpServersCreated !== resources.httpServersClosed)
    )
      failure = new PortabilityError('RESOURCE_DISPOSAL_INCOMPLETE');
    try {
      await journal.finalize(
        {
          resources,
          nativeCompileCount: null,
          nativeCompileObservation: 'NOT_INSTRUMENTED_INTERNAL',
          sourceHead: source.sourceHead,
          sourceManifestSha256: bundle.manifestSha256,
        },
        failure,
      );
    } catch (error) {
      failure ??= error;
      globalThis.console.error('JOURNAL_FINALIZATION_FAILED: ' + String(error));
    }
  }
  if (failure) throw failure;
  globalThis.console.log(
    JSON.stringify({
      status: 'PASS_FOR_BOUNDED_PORTABILITY_ONLY',
      outputDirectory: predata.outputDirectory,
      sourceHead: source.sourceHead,
      sourceManifestSha256: bundle.manifestSha256,
      D01: 'NOT_ACCEPTED',
      D04: 'BLOCKED',
    }),
  );
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--describe') {
    const { contract, arithmetic } = await loadInputs();
    globalThis.console.log(
      JSON.stringify(
        {
          status: 'NATIVE_NOT_RUN',
          nativeImports: 0,
          moduleFactories: 0,
          wasmInstantiate: 0,
          browserLaunches: 0,
          servers: 0,
          sourcePaths: SOURCE_PATHS,
          contract: contract.id,
          arithmetic,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (argv.length === 1 && argv[0] === '--node-child') {
    await runNodeChild();
    return;
  }
  demand(
    argv.length === 2 && argv[0] === '--execute-native' && isAbsolute(argv[1]),
    'USAGE: --describe OR --execute-native <absolute approved predata JSON>',
  );
  await executeNative(argv[1]);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    globalThis.console.error(String(error));
    process.exitCode = 1;
  });
}
