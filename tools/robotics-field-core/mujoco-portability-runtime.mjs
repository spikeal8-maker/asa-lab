// TEST_ONLY portable admission and transport. Importing this module initializes no engine.
import {
  PortabilityError,
  demand,
  failureRecord,
  failureError,
  failureOutcome,
  validatePhysicalInput,
  createNativeCounters,
  sampleWorld,
  runPlan,
  RECORD_BYTES,
  decodeRecord,
  equalBytes,
} from './mujoco-portability-sampler.mjs';
export { failureRecord, failureError, failureOutcome };

export const CONTRACT_SHA256 = 'c9f922354af48df7f762a73ee568f67fa0acc000ca0a536cb1b65d6a6dbd487a';
export const PHY01_SHA256 = 'a8c88eac291c4ef48a0db7261f67949e162b1e13e713705333365c804d41f67c';
export const PHY01_CONTRACT_SHA256 =
  '52562ead409721a49732e9d9f985b230d757edbdd2ecee9b88c13d2115580bea';
export const ENGINE_JS_SHA256 = '85fdadb2c5acee97756e2b0257085f795a2af542f0c4cb97412a6d377abe39e2';
export const ENGINE_WASM_SHA256 =
  '51ae58ae3c69145f6570aeb1fae27f8f142b2d883c804c4747c1a0c3bc80b0de';
export const REALMS = Object.freeze(['node-child', 'browser-main', 'dedicated-worker']);
export const MAX_PACKET_BYTES = 35264;
export const MAX_BASE64_CHARS = 47020;
export const SOURCE_PATHS = Object.freeze([
  'tools/robotics-field-core/mujoco-portability-sampler.mjs',
  'tools/robotics-field-core/mujoco-portability-runtime.mjs',
  'tools/robotics-field-core/mujoco-portability-worker.mjs',
  'tools/robotics-field-core/run-mujoco-portability.mjs',
  'tests/robotics/field-core-qualification/mujoco-portability.fixture.json',
  'tests/robotics/field-core-qualification/mujoco-portability.spec.ts',
  'docs/product/robotics/evidence/field-core-mujoco-portability-20261111.json',
  'docs/product/robotics/evidence/field-core-mujoco-portability-20261111.md',
]);
export const ROUTES = Object.freeze([
  '/',
  '/manifest.json',
  '/assets/mujoco.js',
  '/assets/mujoco.wasm',
  '/src/mujoco-portability-runtime.mjs',
  '/src/mujoco-portability-sampler.mjs',
  '/src/mujoco-portability-worker.mjs',
  '/fixtures/mujoco-phy01.fixture.json',
  '/fixtures/mujoco-portability.fixture.json',
  '/negative/missing-mujoco.wasm',
  '/negative/corrupt-mujoco.wasm',
  '/offline-sentinel',
]);
const textBytes = (value) => new globalThis.TextEncoder().encode(value);
export async function boundedWait(promise, milliseconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(
      () => reject(new PortabilityError('TIMEOUT:' + label)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}
const asHex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
export async function sha256(bytes) {
  demand(bytes instanceof Uint8Array && bytes.byteLength <= 16 * 1024 * 1024, 'HASH_INPUT_LIMIT');
  demand(
    globalThis.crypto?.subtle && typeof globalThis.crypto.subtle.digest === 'function',
    'WEBCRYPTO_UNAVAILABLE',
  );
  return asHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}
export function parseBoundedJson(bytes, limit = 65536) {
  demand(bytes instanceof Uint8Array && bytes.byteLength <= limit, 'JSON_BYTE_LIMIT');
  return JSON.parse(new globalThis.TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export async function admitFixture(fixture) {
  validatePhysicalInput(fixture); // Must precede stringify, hashing and all engine IO.
  demand(
    (await sha256(textBytes(JSON.stringify(fixture)))) === PHY01_CONTRACT_SHA256,
    'FIXTURE_IDENTITY',
  );
  return fixture;
}
export async function admitContract(contract) {
  const encoded = textBytes(JSON.stringify(contract));
  demand(encoded.byteLength <= 65536, 'CONTRACT_BYTE_LIMIT');
  demand((await sha256(encoded)) === CONTRACT_SHA256, 'PORTABILITY_CONTRACT_IDENTITY');
  return contract;
}
export function encodeBase64(bytes) {
  demand(bytes instanceof Uint8Array && bytes.byteLength <= MAX_PACKET_BYTES, 'PACKET_BYTE_LIMIT');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return globalThis.btoa(binary);
}
export function decodeBase64(value) {
  demand(
    typeof value === 'string' &&
      value.length <= MAX_BASE64_CHARS &&
      value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    'PACKET_BASE64_LIMIT',
  );
  const binary = globalThis.atob(value);
  demand(binary.length <= MAX_PACKET_BYTES, 'PACKET_BYTE_LIMIT');
  const result = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  demand(encodeBase64(result) === value, 'PACKET_BASE64_CANONICAL');
  return result;
}
export async function makePacket(payload, count, realm, sequence, worldOrdinal) {
  demand(
    payload instanceof Uint8Array &&
      count >= 1 &&
      count <= 100 &&
      payload.byteLength === count * RECORD_BYTES,
    'PACKET_RECORD_COUNT',
  );
  demand(
    REALMS.includes(realm) && Number.isSafeInteger(sequence) && sequence > 0,
    'PACKET_IDENTITY',
  );
  const result = new Uint8Array(64 + payload.byteLength);
  result.set([77, 74, 80, 49]);
  const view = new DataView(result.buffer);
  view.setUint16(4, 1, true);
  view.setUint8(6, REALMS.indexOf(realm));
  view.setUint8(7, 0);
  view.setUint32(8, sequence, true);
  view.setUint16(12, worldOrdinal, true);
  view.setUint16(14, count, true);
  view.setUint32(16, decodeRecord(payload.subarray(0, RECORD_BYTES)).step, true);
  view.setUint32(20, payload.byteLength, true);
  const digest = await sha256(payload);
  for (let index = 0; index < 32; index += 1)
    result[32 + index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  result.set(payload, 64);
  return result;
}
export async function inspectPacket(bytes, envelope) {
  demand(
    bytes instanceof Uint8Array &&
      bytes.byteLength >= 64 + RECORD_BYTES &&
      bytes.byteLength <= MAX_PACKET_BYTES,
    'PACKET_BYTE_LIMIT',
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  demand(
    view.getUint32(0, false) === 0x4d4a5031 &&
      view.getUint16(4, true) === 1 &&
      view.getUint8(7) === 0,
    'PACKET_SCHEMA',
  );
  demand(
    view.getUint8(6) === REALMS.indexOf(envelope.realm) &&
      view.getUint32(8, true) === envelope.sequence &&
      view.getUint16(12, true) === envelope.worldOrdinal,
    'PACKET_IDENTITY',
  );
  const count = view.getUint16(14, true),
    length = view.getUint32(20, true);
  demand(
    count >= 1 &&
      count <= 100 &&
      length === count * RECORD_BYTES &&
      bytes.byteLength === 64 + length,
    'PACKET_RECORD_COUNT',
  );
  demand(view.getUint32(24, true) === 0 && view.getUint32(28, true) === 0, 'PACKET_RESERVED');
  const payload = bytes.subarray(64);
  demand((await sha256(payload)) === asHex(bytes.subarray(32, 64)), 'PACKET_SHA256');
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const record = decodeRecord(payload.subarray(index * RECORD_BYTES, (index + 1) * RECORD_BYTES));
    demand(record.worldOrdinal === envelope.worldOrdinal, 'RECORD_WORLD');
    records.push(record);
  }
  demand(view.getUint32(16, true) === records[0].step, 'PACKET_FIRST_STEP');
  return { count, payload, records };
}
export function validateIdentity(identity) {
  demand(identity && REALMS.includes(identity.realm), 'PROTOCOL_REALM');
  demand(
    typeof identity.runId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(identity.runId),
    'PROTOCOL_RUN',
  );
  demand(
    identity.generation === 1 && /^[0-9a-f]{64}$/.test(identity.sourceManifestSha256),
    'PROTOCOL_SOURCE',
  );
}
export function acknowledgement(envelope, result = null) {
  return {
    protocolVersion: 1,
    runId: envelope.runId,
    generation: envelope.generation,
    sourceManifestSha256: envelope.sourceManifestSha256,
    realm: envelope.realm,
    sequence: envelope.sequence,
    worldOrdinal: envelope.worldOrdinal,
    kind: 'ack',
    result,
  };
}
export function assertAcknowledgement(envelope, ack) {
  demand(ack && ack.protocolVersion === 1 && ack.kind === 'ack', 'PROTOCOL_ACK');
  for (const key of [
    'runId',
    'generation',
    'sourceManifestSha256',
    'realm',
    'sequence',
    'worldOrdinal',
  ])
    demand(ack[key] === envelope[key], 'PROTOCOL_ACK_IDENTITY:' + key);
  return ack.result;
}
export class ProtocolReceiver {
  constructor(identity) {
    validateIdentity(identity);
    this.identity = { ...identity };
    this.sequence = 0;
    this.busy = false;
    this.closed = false;
  }
  async receive(envelope, work) {
    let entered = false;
    try {
      demand(!this.closed && !this.busy, 'PROTOCOL_INFLIGHT');
      demand(
        envelope && envelope.protocolVersion === 1 && envelope.sequence === this.sequence + 1,
        'PROTOCOL_SEQUENCE',
      );
      for (const key of ['runId', 'generation', 'sourceManifestSha256', 'realm'])
        demand(envelope[key] === this.identity[key], 'PROTOCOL_IDENTITY:' + key);
      demand(
        Number.isInteger(envelope.worldOrdinal) &&
          envelope.worldOrdinal >= -1 &&
          envelope.worldOrdinal < 63,
        'PROTOCOL_WORLD',
      );
      demand(
        [
          'negative',
          'module',
          'world-start',
          'packet',
          'offline-barrier',
          'world-end',
          'realm-end',
        ].includes(envelope.kind),
        'PROTOCOL_KIND',
      );
      this.busy = true;
      entered = true;
      this.sequence += 1;
      return acknowledgement(envelope, await work(envelope));
    } catch (error) {
      this.closed = true;
      throw error;
    } finally {
      if (entered) this.busy = false;
    }
  }
}
export class ProtocolSender {
  constructor(identity, send) {
    validateIdentity(identity);
    this.identity = { ...identity };
    this.send = send;
    this.sequence = 0;
    this.busy = false;
    this.failed = false;
  }
  async emit(kind, worldOrdinal, body, payloadBuilder = null, onDispatched = null) {
    demand(!this.busy && !this.failed, 'PROTOCOL_INFLIGHT');
    this.busy = true;
    const envelope = {
      protocolVersion: 1,
      ...this.identity,
      sequence: ++this.sequence,
      worldOrdinal,
      kind,
      body,
    };
    try {
      const payload = payloadBuilder ? await payloadBuilder(envelope.sequence) : null;
      const ack = await boundedWait(
        this.send(envelope, payload, onDispatched),
        10000,
        'protocol-ack',
      );
      if (ack?.kind === 'fatal') throw failureError(ack.failure);
      return assertAcknowledgement(envelope, ack);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
}

/** Byte equality is against the already hashed local asset, before dispatch. */
export function verifyInstantiationInput(input, binding) {
  demand(
    binding &&
      REALMS.includes(binding.realm) &&
      binding.sha256 === ENGINE_WASM_SHA256 &&
      binding.bytes instanceof Uint8Array,
    'WASM_PINNED_BINDING',
  );
  let bytes;
  if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input) && input.buffer instanceof ArrayBuffer)
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else throw new PortabilityError('WASM_INPUT_UNOBSERVABLE');
  demand(equalBytes(bytes, binding.bytes), 'WASM_PINNED_INPUT_MISMATCH');
  return {
    realm: binding.realm,
    sha256: binding.sha256,
    bytes: bytes.byteLength,
    identity: 'BYTE_EXACT_TO_PREVIOUSLY_SHA256_VERIFIED_ASSET',
  };
}

/** Observes the real call boundary. No replacement instance/exports are produced. */
export async function observeInstantiation(task, wasm = globalThis.WebAssembly, binding = null) {
  demand(wasm && typeof wasm.instantiate === 'function', 'WASM_API_UNAVAILABLE');
  const descriptor = Object.getOwnPropertyDescriptor(wasm, 'instantiate');
  demand(
    descriptor && descriptor.value === wasm.instantiate && descriptor.writable,
    'WASM_BOUNDARY_UNOBSERVABLE',
  );
  const original = descriptor.value;
  const counters = {
    dispatched: 0,
    returned: 0,
    rejected: 0,
    blockedRequests: 0,
    scope: binding ? 'PINNED_MUJOCO_REALM' : 'API_UNIT_BOUNDARY_ONLY',
    input: null,
    internalCompileCalls: null,
    compileObservation: 'NOT_INSTRUMENTED',
  };
  let instance = null;
  const observed = function (...args) {
    if (counters.dispatched >= 1) {
      counters.blockedRequests += 1;
      throw new PortabilityError('WASM_INSTANTIATION_BUDGET');
    }
    if (binding) {
      try {
        counters.input = verifyInstantiationInput(args[0], binding);
      } catch (error) {
        counters.blockedRequests += 1;
        throw error;
      }
    }
    counters.dispatched += 1;
    try {
      return Promise.resolve(Reflect.apply(original, wasm, args)).then(
        (result) => {
          counters.returned += 1;
          instance = result?.instance ?? result;
          demand(instance instanceof wasm.Instance, 'WASM_RESULT_UNOBSERVABLE');
          return result;
        },
        (error) => {
          counters.rejected += 1;
          throw error;
        },
      );
    } catch (error) {
      counters.rejected += 1;
      throw error;
    }
  };
  Object.defineProperty(wasm, 'instantiate', { ...descriptor, value: observed });
  let value, failure;
  try {
    value = await task(counters, () => instance);
  } catch (error) {
    failure = error instanceof Error ? error : new PortabilityError(String(error));
  } finally {
    const unchanged = wasm.instantiate === observed;
    Object.defineProperty(wasm, 'instantiate', descriptor);
    demand(wasm.instantiate === original, 'WASM_OBSERVER_RESTORE_FAILED');
    if (!unchanged) failure = new PortabilityError('WASM_BOUNDARY_REPLACED');
  }
  if (failure) {
    failure.instantiationCounters = {
      ...counters,
      inFlight: counters.dispatched - counters.returned - counters.rejected,
    };
    throw failure;
  }
  return {
    value,
    counters: {
      ...counters,
      inFlight: counters.dispatched - counters.returned - counters.rejected,
    },
    instance,
  };
}
async function verifyBytes(bytes, expectedSha, expectedLength) {
  demand(
    bytes instanceof Uint8Array && bytes.byteLength === expectedLength,
    'ASSET_LENGTH_REJECTED',
  );
  const actual = await sha256(bytes);
  if (actual !== expectedSha)
    throw new PortabilityError('ASSET_INTEGRITY_REJECTED', {
      actualSha256: actual,
      expectedSha256: expectedSha,
      bytes: bytes.byteLength,
    });
  return bytes;
}
export async function verifyEngineRequest(fixture, assetKind, assets, accounting) {
  await admitFixture(fixture);
  accounting.engineAssetReads += 1;
  const bytes = await assets.readWasm(assetKind);
  return verifyBytes(bytes, ENGINE_WASM_SHA256, 11200612);
}
export function createAdmissionAccounting() {
  return {
    engineAssetReads: 0,
    engineImports: { dispatched: 0, returned: 0 },
    factory: { dispatched: 0, returned: 0 },
    versionCalls: { mj_version: 0, mj_versionString: 0 },
  };
}
const accountingSnapshot = (accounting, observed, native) => ({
  factoryDispatched: accounting.factory.dispatched,
  factoryReturned: accounting.factory.returned,
  importsDispatched: accounting.engineImports.dispatched,
  importsReturned: accounting.engineImports.returned,
  wasmDispatched: observed.dispatched,
  wasmReturned: observed.returned,
  wasmRejected: observed.rejected,
  modelsDispatched: native.models.dispatched,
  modelsReturned: native.models.returned,
  dataDispatched: native.data.dispatched,
  dataReturned: native.data.returned,
  advancesDispatched: native.advancesDispatched,
  advancesCompleted: native.advancesCompleted,
  engineAssetReads: accounting.engineAssetReads,
});

async function admissionNegatives(fixture, assets, accounting, observed, native, sender) {
  const cases = [
    [
      'N1_NAN_MASS',
      'FINITE_INPUT_REJECTED',
      'valid',
      (f) => {
        f.massesKg[1] = Number.NaN;
      },
    ],
    [
      'N2_INFINITY_GRAVITY',
      'FINITE_INPUT_REJECTED',
      'valid',
      (f) => {
        f.gravity[2] = Number.POSITIVE_INFINITY;
      },
    ],
    [
      'N3_BAD_GEOMETRY',
      'POSITIVE_GEOMETRY_REJECTED',
      'valid',
      (f) => {
        f.sphereRadiusM = 0;
      },
    ],
    ['N4_WASM_UNAVAILABLE', 'ASSET_UNAVAILABLE', 'missing', () => {}],
    ['N5_WASM_CORRUPT', 'ASSET_INTEGRITY_REJECTED', 'corrupt', () => {}],
  ];
  for (const [id, expected, kind, mutate] of cases) {
    const bad = globalThis.structuredClone(fixture);
    mutate(bad);
    const before = accountingSnapshot(accounting, observed, native);
    let caught;
    try {
      await verifyEngineRequest(bad, kind, assets, accounting);
    } catch (error) {
      caught = error;
    }
    demand(caught?.code === expected, 'NEGATIVE_EXPECTED_REJECTION:' + id);
    if (kind === 'missing')
      demand(
        caught.detail?.code === 'ENOENT' || caught.detail?.status === 404,
        'NEGATIVE_UNAVAILABLE_BOUNDARY',
      );
    const after = accountingSnapshot(accounting, observed, native);
    for (const key of Object.keys(before).filter((key) => key !== 'engineAssetReads'))
      demand(before[key] === 0 && after[key] === 0, 'NEGATIVE_NATIVE_ALLOCATION:' + id + ':' + key);
    const reads = after.engineAssetReads - before.engineAssetReads;
    demand(reads === (kind === 'valid' ? 0 : 1), 'NEGATIVE_ASSET_IO:' + id);
    await sender.emit('negative', -1, {
      id,
      verdict: 'PASS',
      boundary: 'admission',
      expected,
      observed: caught.code,
      detail: caught.detail ?? null,
      before,
      after,
    });
  }
}
export function assertRealmCounters(counters) {
  const warningCount = counters.realm === 'node-child' ? 24026 : 24027;
  demand(
    counters.worlds === 21 &&
      counters.advanceAttempts === 24005 &&
      counters.advanceSlotsReserved === 24004 &&
      counters.advancesDispatched === 24004 &&
      counters.advancesCompleted === 24004,
    'REALM_ADVANCE_ACCOUNTING',
  );
  for (const name of ['models', 'data', 'modelsDeleted', 'dataDeleted'])
    demand(
      counters[name].dispatched === 21 && counters[name].returned === 21,
      'REALM_HANDLE_ACCOUNTING:' + name,
    );
  for (const [name, expected] of [
    ['mj_step1', 21604],
    ['mj_step2', 21604],
    ['mj_step', 2400],
    ['warningGet', warningCount * 7],
    ['warningDelete', warningCount * 7],
  ])
    demand(
      counters[name].dispatched === expected && counters[name].returned === expected,
      'REALM_CALL_ACCOUNTING:' + name,
    );
  demand(
    counters.warningObservations === warningCount &&
      counters.warningSizeCalls === warningCount &&
      counters.quotaRefusals === 1 &&
      counters.failureObservations === 0,
    'REALM_OBSERVATION_ACCOUNTING',
  );
  demand(
    counters.liveModels === 0 &&
      counters.liveData === 0 &&
      counters.liveWarningCopies === 0 &&
      counters.maxLiveModels === 1 &&
      counters.maxLiveData === 1 &&
      counters.maxLiveWarningCopies === 1,
    'REALM_OWNERSHIP_ACCOUNTING',
  );
}

/** Bounded metadata only. Non-finite failure state remains explicit; raw bytes stay authoritative. */
export function receiptSnapshot(value, maximumBytes) {
  let visited = 0;
  const visit = (item, depth) => {
    demand(++visited <= 8192 && depth <= 24, 'RECEIPT_STRUCTURE_LIMIT');
    if (typeof item === 'number')
      return Number.isFinite(item)
        ? item
        : { nonFinite: Number.isNaN(item) ? 'NaN' : item > 0 ? 'Infinity' : '-Infinity' };
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') {
      demand(item.length <= 16384, 'RECEIPT_STRING_LIMIT');
      return item;
    }
    if (Array.isArray(item)) {
      demand(item.length <= 256, 'RECEIPT_ARRAY_LIMIT');
      return item.map((child) => visit(child, depth + 1));
    }
    demand(
      item &&
        typeof item === 'object' &&
        [Object.prototype, null].includes(Object.getPrototypeOf(item)),
      'RECEIPT_OBJECT_TYPE',
    );
    const entries = Object.entries(item);
    demand(
      entries.length <= 64 && entries.every(([key]) => key.length <= 128),
      'RECEIPT_OBJECT_LIMIT',
    );
    return Object.fromEntries(entries.map(([key, child]) => [key, visit(child, depth + 1)]));
  };
  const snapshot = visit(value, 0);
  demand(textBytes(JSON.stringify(snapshot)).byteLength <= maximumBytes, 'RECEIPT_BYTE_LIMIT');
  return snapshot;
}
export function validateNativeSnapshot(value, realm) {
  const shape = createNativeCounters(realm);
  demand(
    value &&
      value.realm === realm &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(shape).sort()),
    'COUNTER_SNAPSHOT_SCHEMA',
  );
  const warningLimit = (realm === 'node-child' ? 24026 : 24027) + 1;
  const limits = {
    worlds: 21,
    models: 21,
    data: 21,
    modelsDeleted: 21,
    dataDeleted: 21,
    liveModels: 1,
    liveData: 1,
    maxLiveModels: 1,
    maxLiveData: 1,
    advanceAttempts: 24005,
    advanceSlotsReserved: 24004,
    advancesDispatched: 24004,
    advancesCompleted: 24004,
    mj_step1: 21604,
    mj_step2: 21604,
    mj_step: 2400,
    warningSizeCalls: warningLimit,
    warningGet: warningLimit * 7,
    warningDelete: warningLimit * 7,
    warningObservations: warningLimit,
    liveWarningCopies: 1,
    maxLiveWarningCopies: 1,
    failureObservations: 1,
    quotaRefusals: 1,
  };
  const count = (number, limit) =>
    demand(
      Number.isSafeInteger(number) && number >= 0 && number <= limit,
      'COUNTER_SNAPSHOT_BOUND',
    );
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof shape[key] === 'object') {
      demand(
        value[key] &&
          JSON.stringify(Object.keys(value[key]).sort()) === '["dispatched","returned"]',
        'COUNTER_CALL_SCHEMA',
      );
      count(value[key].dispatched, limit);
      count(value[key].returned, value[key].dispatched);
    } else count(value[key], limit);
  }
  demand(
    value.models.dispatched <= value.worlds &&
      value.data.dispatched <= value.models.returned &&
      value.modelsDeleted.dispatched <= value.models.returned &&
      value.dataDeleted.dispatched <= value.data.returned &&
      value.liveModels <= value.models.returned - value.modelsDeleted.returned &&
      value.liveData <= value.data.returned - value.dataDeleted.returned &&
      value.liveModels <= value.maxLiveModels &&
      value.liveData <= value.maxLiveData &&
      value.advancesCompleted <= value.advancesDispatched &&
      value.advancesDispatched <= value.advanceSlotsReserved &&
      value.advanceSlotsReserved <= value.advanceAttempts &&
      value.mj_step2.returned + value.mj_step.returned === value.advancesCompleted &&
      value.mj_step2.dispatched + value.mj_step.dispatched === value.advancesDispatched &&
      value.mj_step2.dispatched <= value.mj_step1.returned &&
      value.warningDelete.dispatched <= value.warningGet.returned &&
      value.liveWarningCopies === value.warningGet.returned - value.warningDelete.returned &&
      value.liveWarningCopies <= value.maxLiveWarningCopies &&
      value.warningObservations <= value.warningSizeCalls,
    'COUNTER_SNAPSHOT_RELATION',
  );
  return value;
}
export function validateAdmissionSnapshot(accounting, instantiation, realm) {
  demand(
    accounting &&
      JSON.stringify(Object.keys(accounting).sort()) ===
        JSON.stringify(Object.keys(createAdmissionAccounting()).sort()) &&
      Number.isSafeInteger(accounting.engineAssetReads) &&
      accounting.engineAssetReads >= 0 &&
      accounting.engineAssetReads <= 4,
    'ADMISSION_SNAPSHOT',
  );
  for (const name of ['engineImports', 'factory']) {
    const calls = accounting[name];
    demand(
      calls &&
        JSON.stringify(Object.keys(calls).sort()) === '["dispatched","returned"]' &&
        Number.isInteger(calls.dispatched) &&
        calls.dispatched >= 0 &&
        calls.dispatched <= 1 &&
        Number.isInteger(calls.returned) &&
        calls.returned >= 0 &&
        calls.returned <= calls.dispatched,
      'ADMISSION_CALL_SNAPSHOT',
    );
  }
  demand(
    accounting.factory.dispatched <= accounting.engineImports.returned,
    'ADMISSION_CALL_ORDER',
  );
  for (const key of ['mj_version', 'mj_versionString'])
    demand([0, 1].includes(accounting.versionCalls?.[key]), 'VERSION_CALL_SNAPSHOT');
  if (instantiation !== null) {
    demand(
      instantiation?.scope === 'PINNED_MUJOCO_REALM' && instantiation.internalCompileCalls === null,
      'INSTANTIATION_SNAPSHOT_SCOPE',
    );
    for (const key of ['dispatched', 'returned', 'rejected', 'inFlight'])
      demand([0, 1].includes(instantiation[key]), 'INSTANTIATION_SNAPSHOT_BOUND');
    demand(
      instantiation.returned + instantiation.rejected + instantiation.inFlight ===
        instantiation.dispatched &&
        Number.isSafeInteger(instantiation.blockedRequests) &&
        instantiation.blockedRequests >= 0 &&
        instantiation.blockedRequests <= 1,
      'INSTANTIATION_SNAPSHOT_RELATION',
    );
    if (instantiation.dispatched)
      demand(
        instantiation.input?.realm === realm &&
          instantiation.input.sha256 === ENGINE_WASM_SHA256 &&
          instantiation.input.bytes === 11200612,
        'INSTANTIATION_SNAPSHOT_INPUT',
      );
  }
}
export function terminalReceipt(result, additions = {}) {
  return {
    identity: result.identity,
    realm: result.realm,
    verdict: result.verdict,
    counters: result.counters,
    accounting: result.accounting,
    instantiation: result.instantiation,
    module: result.module,
    error: result.error,
    secondaryErrors: result.secondaryErrors,
    lastWorld: result.worlds.at(-1) ?? null,
    lastMemoryBytes: result.moduleMemory.at(-1)?.bytes ?? null,
    ...additions,
  };
}
function recordRealmFailure(result, error, phase) {
  const observed = failureRecord(error, phase);
  if (!result.error) result.error = observed;
  else if (JSON.stringify(result.error) !== JSON.stringify(observed)) {
    demand(result.secondaryErrors.length < 8, 'SECONDARY_FAILURE_LIMIT');
    result.secondaryErrors.push(observed);
  }
  result.verdict = failureOutcome([result.error, ...result.secondaryErrors]);
}
/** A relay over an existing message owner. Unit tests supply an explicit message-scope double. */
export function relayWorker(worker, config, binding, terminalBinding) {
  return new Promise((resolveWorker, rejectWorker) => {
    let relayFailure = null,
      settled = false;
    const disposeHandlers = () => {
      worker.onmessage = null;
      worker.onerror = null;
    };
    const fatal = (error) => {
      relayFailure ??= failureRecord(error, 'worker_relay');
      try {
        worker.postMessage({ kind: 'fatal', failure: relayFailure });
      } catch (sendError) {
        if (!settled) {
          settled = true;
          disposeHandlers();
          rejectWorker(new PortabilityError('WORKER_LOST', String(sendError)));
        }
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      disposeHandlers();
      rejectWorker(new PortabilityError('WORKER_LOST', { message: String(event.message) }));
    };
    worker.onmessage = async (event) => {
      const message = event.data;
      if (settled) return;
      if (message?.kind === 'worker-disposed' || message?.kind === 'worker-failed') {
        settled = true;
        disposeHandlers();
        try {
          const result =
            message.kind === 'worker-disposed'
              ? { ...message.result, relayFailure }
              : {
                  identity: config.identity,
                  realm: config.identity.realm,
                  verdict: 'INCOMPLETE',
                  counters: null,
                  accounting: null,
                  instantiation: null,
                  module: null,
                  error:
                    message.failure ??
                    failureRecord(
                      new PortabilityError('WORKER_LOST', message.error),
                      'worker_failed',
                    ),
                  secondaryErrors: [],
                  lastWorld: null,
                  lastMemoryBytes: null,
                  resources: message.resources,
                  relayFailure,
                };
          await terminalBinding(result, message.kind);
          resolveWorker(result);
        } catch (error) {
          rejectWorker(error);
        }
        return;
      }
      if (message?.kind !== 'event') {
        fatal(new PortabilityError('WORKER_PROTOCOL'));
        return;
      }
      try {
        const bytes = message.buffer ? new Uint8Array(message.buffer) : null;
        const ack = await binding({
          envelope: message.envelope,
          base64: bytes ? encodeBase64(bytes) : null,
        });
        if (ack?.kind === 'fatal') throw failureError(ack.failure);
        worker.postMessage({ kind: 'ack', ack });
      } catch (error) {
        fatal(error); // Keep listening for the actual disposal receipt; outer watchdog is unchanged.
      }
    };
    worker.postMessage({ kind: 'start', config });
  });
}
export async function runRealm({ identity, fixture, contract, assets, send }) {
  validateIdentity(identity);
  await admitFixture(fixture);
  await admitContract(contract);
  const sender = new ProtocolSender(identity, send);
  const counters = createNativeCounters(identity.realm),
    accounting = createAdmissionAccounting();
  const result = {
    identity: { ...identity },
    realm: identity.realm,
    verdict: 'INCOMPLETE',
    accounting,
    counters,
    instantiation: null,
    module: null,
    secondaryErrors: [],
    moduleMemory: [],
    worlds: [],
    error: null,
    moduleLifetime: 'owned by this realm; no invented Module.delete API',
  };
  let M, nativeMemory;
  const nativeBoundary = { realm: identity.realm, sha256: ENGINE_WASM_SHA256, bytes: null };
  try {
    const admission = await observeInstantiation(
      async (observed, actualInstance) => {
        await admissionNegatives(fixture, assets, accounting, observed, counters, sender);
        const wasmBinary = await verifyEngineRequest(fixture, 'valid', assets, accounting);
        nativeBoundary.bytes = wasmBinary.slice();
        accounting.engineAssetReads += 1;
        await verifyBytes(await assets.readJs(), ENGINE_JS_SHA256, 294200);
        accounting.engineImports.dispatched += 1;
        const imported = await assets.importEngine();
        accounting.engineImports.returned += 1;
        demand(typeof imported.default === 'function', 'ENGINE_FACTORY_EXPORT');
        accounting.factory.dispatched += 1;
        const module = await boundedWait(
          imported.default({
            wasmBinary,
            locateFile: (name) => {
              demand(name === 'mujoco.wasm', 'ENGINE_UNREGISTERED_RESOURCE');
              return assets.wasmLocation;
            },
            print: assets.log,
            printErr: assets.log,
          }),
          30000,
          'native-module-init',
        );
        accounting.factory.returned += 1;
        demand(
          observed.dispatched === 1 &&
            observed.returned === 1 &&
            observed.rejected === 0 &&
            observed.blockedRequests === 0 &&
            actualInstance(),
          'WASM_FACTORY_UNOBSERVED',
        );
        const memory = actualInstance().exports.memory;
        demand(
          memory &&
            memory.buffer instanceof ArrayBuffer &&
            memory.buffer.byteLength >= 17629184 &&
            memory.buffer.byteLength <= 2147483648,
          'WASM_ST_MEMORY',
        );
        accounting.versionCalls.mj_version += 1;
        const version = module.mj_version();
        accounting.versionCalls.mj_versionString += 1;
        const versionString = module.mj_versionString();
        demand(version === 4000000 && versionString === '4.0.0', 'ENGINE_RUNTIME_VERSION');
        return { module, memoryBytes: memory.buffer.byteLength, version, versionString };
      },
      globalThis.WebAssembly,
      nativeBoundary,
    );
    M = admission.value.module;
    nativeMemory = admission.instance.exports.memory;
    result.instantiation = admission.counters;
    result.moduleMemory.push({ phase: 'initialized', bytes: admission.value.memoryBytes });
    result.module = {
      counters: globalThis.structuredClone(counters),
      accounting: globalThis.structuredClone(accounting),
      instantiation: result.instantiation,
      version: admission.value.version,
      versionString: admission.value.versionString,
      memoryBytes: admission.value.memoryBytes,
      crossOriginIsolated: globalThis.crossOriginIsolated ?? null,
      online: globalThis.navigator?.onLine ?? null,
    };
    await sender.emit('module', -1, result.module);
    const offset = REALMS.indexOf(identity.realm) * 21;
    const plan = runPlan(fixture);
    plan.push({ mode: 'split', massKg: 0.5, dtUs: 500, repeat: 0 });
    for (let index = 0; index < plan.length; index += 1) {
      const quota = index === 20;
      const before = quota ? globalThis.structuredClone(counters) : null;
      const run = await sampleWorld({
        M,
        fixture,
        entry: plan[index],
        worldOrdinal: offset + index,
        counters,
        sha256,
        quota,
        onStart: (body) => sender.emit('world-start', offset + index, body),
        onRecords: (payload, count, worldOrdinal, onDispatched) =>
          sender.emit(
            'packet',
            worldOrdinal,
            { count },
            (sequence) => makePacket(payload, count, identity.realm, sequence, worldOrdinal),
            onDispatched,
          ),
        onOfflineBarrier:
          identity.realm !== 'node-child' && index === 0
            ? async (barrier) => {
                demand(
                  barrier.tick === 400 && barrier.sourceTimeUs === 200000,
                  'OFFLINE_INTEGER_BARRIER',
                );
                const ack = await sender.emit('offline-barrier', offset, barrier);
                demand(
                  ack?.offline === true &&
                    ack?.sentinelFailed === true &&
                    ack.tick === 400 &&
                    ack.sourceTimeUs === 200000 &&
                    ack.worldOrdinal === offset,
                  'OFFLINE_ACK',
                );
                demand(globalThis.navigator?.onLine === false, 'OFFLINE_REALM_STILL_ONLINE');
              }
            : null,
      });
      result.worlds.push(run);
      if (run.failure) {
        recordRealmFailure(result, failureError(run.failure), run.errorPhase);
        for (const secondary of [...run.cleanupFailures, run.failureObservationFailure].filter(
          Boolean,
        ))
          recordRealmFailure(result, failureError(secondary), secondary.phase);
      }
      const memoryBytes = nativeMemory.buffer.byteLength;
      result.moduleMemory.push({ worldOrdinal: offset + index, bytes: memoryBytes });
      await sender.emit('world-end', offset + index, {
        run,
        counters: globalThis.structuredClone(counters),
        memoryBytes,
      });
      if (run.error) throw failureError(run.failure);
      if (quota) {
        demand(
          run.steps === 4 && run.attemptedStepIndex === 5 && run.phase === 'quota_refused',
          'QUOTA_NATIVE_OUTCOME',
        );
        await sender.emit('negative', offset + index, {
          id: 'N6_QUOTA',
          verdict: 'PASS',
          boundary: 'native-before-fifth-dispatch',
          before,
          after: globalThis.structuredClone(counters),
          completed: 4,
          refusedTick: 5,
        });
      }
    }
    assertRealmCounters(counters);
    result.verdict = 'SAMPLED'; // Physical PASS belongs only to the original host assessor.
  } catch (error) {
    recordRealmFailure(result, error, result.worlds.at(-1)?.phase ?? 'module_admission');
    if (error.instantiationCounters) result.instantiation = error.instantiationCounters;
  }
  if (!sender.failed) {
    try {
      await sender.emit('realm-end', -1, {
        ...result,
        worlds: result.worlds.map((run) => ({
          worldOrdinal: run.worldOrdinal,
          error: run.error,
          phase: run.phase,
          steps: run.steps,
        })),
      });
    } catch (error) {
      recordRealmFailure(result, error, 'realm_end_ack');
    }
  }
  return result;
}

export async function runBrowserRealm(config, send) {
  validateIdentity(config.identity);
  demand(
    config.identity.realm !== 'node-child' && globalThis.crossOriginIsolated === false,
    'BROWSER_ST_CONTEXT',
  );
  const base = new globalThis.URL(config.baseUrl);
  demand(
    base.protocol === 'http:' &&
      base.hostname === '127.0.0.1' &&
      base.pathname === '/' &&
      !base.username &&
      !base.password,
    'TEST_LOOPBACK_ORIGIN',
  );
  const read = async (route, maxBytes = 16 * 1024 * 1024) => {
    demand(ROUTES.includes(route), 'LOCAL_ASSET_ALLOWLIST');
    let response;
    try {
      response = await globalThis.fetch(new globalThis.URL(route, base), {
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (error) {
      throw new PortabilityError('ASSET_UNAVAILABLE', { route, reason: String(error) });
    }
    if (!response.ok)
      throw new PortabilityError('ASSET_UNAVAILABLE', { route, status: response.status });
    const declared = Number(response.headers.get('content-length'));
    demand(
      Number.isSafeInteger(declared) && declared >= 0 && declared <= maxBytes,
      'ASSET_DECLARED_LENGTH',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    demand(bytes.byteLength === declared && bytes.byteLength <= maxBytes, 'ASSET_LENGTH_REJECTED');
    return bytes;
  };
  const manifestBytes = await read('/manifest.json', 65536);
  demand(
    (await sha256(manifestBytes)) === config.identity.sourceManifestSha256,
    'SOURCE_MANIFEST_SHA256',
  );
  const manifest = parseBoundedJson(manifestBytes);
  demand(manifest.schema === 'MUJOCO_PORTABILITY_ASSETS_V1', 'SOURCE_MANIFEST_SCHEMA');
  for (const route of [
    '/src/mujoco-portability-runtime.mjs',
    '/src/mujoco-portability-sampler.mjs',
    '/src/mujoco-portability-worker.mjs',
  ]) {
    const bytes = await read(route, 262144);
    demand((await sha256(bytes)) === manifest.assets[route]?.sha256, 'PORTABLE_SOURCE_SHA256');
  }
  const fixtureBytes = await read('/fixtures/mujoco-phy01.fixture.json', 65536);
  demand((await sha256(fixtureBytes)) === PHY01_SHA256, 'FIXTURE_FILE_SHA256');
  const contractBytes = await read('/fixtures/mujoco-portability.fixture.json', 65536);
  demand(
    (await sha256(contractBytes)) ===
      manifest.assets['/fixtures/mujoco-portability.fixture.json']?.sha256,
    'CONTRACT_FILE_SHA256',
  );
  const logs = [];
  let logBytes = 0;
  const result = await runRealm({
    identity: config.identity,
    fixture: parseBoundedJson(fixtureBytes),
    contract: parseBoundedJson(contractBytes),
    send,
    assets: {
      readWasm: (kind) =>
        read(
          kind === 'missing'
            ? '/negative/missing-mujoco.wasm'
            : kind === 'corrupt'
              ? '/negative/corrupt-mujoco.wasm'
              : '/assets/mujoco.wasm',
        ),
      readJs: () => read('/assets/mujoco.js', 294200),
      importEngine: () => import(new globalThis.URL('/assets/mujoco.js', base).href),
      wasmLocation: new globalThis.URL('/assets/mujoco.wasm', base).href,
      log: (message) => {
        const line = String(message);
        logBytes += textBytes(line).byteLength;
        demand(logBytes <= 262144, 'ENGINE_LOG_BUDGET');
        logs.push(line);
      },
    },
  });
  return { ...result, logs };
}
