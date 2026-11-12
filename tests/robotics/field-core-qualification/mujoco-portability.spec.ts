import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import {
  analyticalAt as originalAnalyticalAt,
  makeModelXml as originalXml,
  nativeTimeBudget as originalTimeBudget,
  float64Bytes as originalFloat64,
  stateBytes as originalState,
  runPlan as originalPlan,
  validateModelReadback as originalReadback,
  assessPhy01,
} from '../../../tools/robotics-field-core/mujoco-phy01.mjs';
import {
  makeModelXml,
  runPlan,
  analyticalAt,
  nativeTimeBudget,
  validateModelReadback,
  validatePhysicalInput,
  float64Bytes,
  stateBytes,
  copyWarnings,
  copyNative,
  createNativeCounters,
  reserveAdvance,
  encodeRecord,
  decodeRecord,
  RECORD_KIND,
  RECORD_BYTES,
  PortabilityError,
  readModel,
  failureRecord,
  failureError,
  failureOutcome,
  createRecordAccounting,
  dispatchRecordBatch,
} from '../../../tools/robotics-field-core/mujoco-portability-sampler.mjs';
import {
  admitFixture,
  admitContract,
  verifyEngineRequest,
  createAdmissionAccounting,
  observeInstantiation,
  ProtocolReceiver,
  ProtocolSender,
  acknowledgement,
  makePacket,
  inspectPacket,
  encodeBase64,
  decodeBase64,
  SOURCE_PATHS,
  ROUTES,
  CONTRACT_SHA256,
  sha256,
  relayWorker,
  receiptSnapshot,
  validateNativeSnapshot,
} from '../../../tools/robotics-field-core/mujoco-portability-runtime.mjs';
import {
  deriveBudget,
  JournalAllowance,
  HostJournal,
  validateExecutionApproval,
  resolveLocalRoute,
  EXECUTION_INPUT_PATHS,
  REPORT_PATHS,
  FROZEN_INPUT_PATHS,
  inheritedSnapshot,
  sourceSnapshot,
  ROOT,
} from '../../../tools/robotics-field-core/run-mujoco-portability.mjs';

import { installDedicatedWorker } from '../../../tools/robotics-field-core/mujoco-portability-worker.mjs';

// All state/handle objects below are explicit serialization/admission unit data.
// No test invokes sampleWorld/runRealm, a factory, a browser, Worker or server.
const fixture = JSON.parse(
  readFileSync(new URL('./mujoco-phy01.fixture.json', import.meta.url), 'utf8'),
);
const contract = JSON.parse(
  readFileSync(new URL('./mujoco-portability.fixture.json', import.meta.url), 'utf8'),
);
const require = createRequire(import.meta.url);
const engineRoot =
  process.env.ASA_MUJOCO_TEST_ENGINE_ROOT ?? dirname(require.resolve('@mujoco/mujoco'));
const identity = {
  runId: 'pure-unit-only',
  generation: 1,
  sourceManifestSha256: 'a'.repeat(64),
  realm: 'dedicated-worker',
};
const initialState = () => ({
  qpos: [0, -0, 2, 1, 0, 0, 0],
  qvel: [0, 0, 0, 0, 0, 0],
  qacc: [0, 0, 0, 0, 0, 0],
  qacc_warmstart: [0, 0, 0, 0, 0, 0],
  time: 0,
});
const warnings = () => Array.from({ length: 7 }, () => ({ number: 0, lastinfo: 0 }));
const entry = { mode: 'split', massKg: 0.5, dtUs: 500, repeat: 0 };
const makeRecord = (kind = RECORD_KIND.initial, step = 0) =>
  encodeRecord({
    kind,
    entry,
    worldOrdinal: 42,
    step,
    state: initialState(),
    warnings: warnings(),
    ncon: 0,
    nefc: 0,
    awake: 1,
    flags: kind === RECORD_KIND.initial ? 512 : 255,
  });

afterEach(() => vi.restoreAllMocks());

describe('portable PHY01 source conformance — no dynamics', () => {
  it('keeps the exact physical fixture and approved operational contract', async () => {
    await expect(admitFixture(fixture)).resolves.toBe(fixture);
    await expect(admitContract(contract)).resolves.toBe(contract);
    expect(await sha256(new TextEncoder().encode(JSON.stringify(contract)))).toBe(CONTRACT_SHA256);
  });
  it.each([0.02, 0.5, 2].flatMap((mass) => [500, 250].map((dt) => [mass, dt])))(
    'produces byte-exact original XML for mass%s dt%s',
    (mass, dt) => {
      expect(Buffer.from(makeModelXml(fixture, mass, dt))).toEqual(
        Buffer.from(originalXml(fixture, mass, dt)),
      );
    },
  );
  it('keeps all20 original worlds in the exact original order', () => {
    expect(runPlan(fixture)).toEqual(originalPlan(fixture));
    expect(runPlan(fixture)).toHaveLength(20);
  });
  it('uses the unchanged analytical and roundoff oracles', () => {
    for (const time of fixture.sampleTimesUs)
      expect(analyticalAt(fixture, time)).toEqual(originalAnalyticalAt(fixture, time));
    for (const dt of [500, 250])
      for (let tick = 0; tick <= 1600; tick += 1)
        expect(nativeTimeBudget(tick, dt)).toBe(originalTimeBudget(tick, dt));
    expect(analyticalAt(fixture, 100000).positionToleranceM).toBeCloseTo(0.0004905, 15);
  });
  it('does not accept empty observations as physical evidence', () => {
    expect(assessPhy01(fixture, [], null).verdict).toBe('FAIL');
  });
  it('preserves the canonical208 native state bytes, signed zero and finite extremes', () => {
    const values = [0, -0, 1, -1, Math.PI, Number.MIN_VALUE, Number.MAX_VALUE, 1e-250, -1e250];
    expect(Buffer.from(float64Bytes(values))).toEqual(originalFloat64(values));
    const state = initialState();
    state.qacc = values.slice(0, 6);
    expect(stateBytes(state).byteLength).toBe(208);
    expect(Buffer.from(stateBytes(state))).toEqual(originalState(state));
    expect(Buffer.from(stateBytes(state, ['qpos', 'qvel', 'time']))).toEqual(
      originalState(state, ['qpos', 'qvel', 'time']),
    );
    expect(Buffer.from(float64Bytes([0])).equals(Buffer.from(float64Bytes([-0])))).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite state encoding %s', (value) => {
    expect(() => float64Bytes([value])).toThrow('STATE_NONFINITE');
  });
  it('copies native-shaped arrays without retaining their underlying views', () => {
    const source = Object.fromEntries(
      Object.entries(initialState()).map(([name, value]) => [
        name,
        Array.isArray(value) ? new Float64Array(value) : value,
      ]),
    );
    const copied = copyNative(source);
    (source.qpos as Float64Array)[2] = 100;
    expect(copied.qpos[2]).toBe(2);
    expect(() => copyNative({ ...source, qpos: new Float64Array(8) })).toThrow('NATIVE_STATE_VIEW');
  });
});

describe('finite/geometry/artifact admission — no engine import', () => {
  it.each(['nan', 'infinity', 'geometry'])(
    'rejects %s before digest and engine IO',
    async (kind) => {
      const bad = structuredClone(fixture);
      if (kind === 'nan') bad.massesKg[1] = NaN;
      if (kind === 'infinity') bad.gravity[2] = Infinity;
      if (kind === 'geometry') bad.sphereRadiusM = 0;
      const digest = vi
        .spyOn(globalThis.crypto.subtle, 'digest')
        .mockRejectedValue(new Error('hash must not run'));
      const readWasm = vi.fn().mockRejectedValue(new Error('IO must not run'));
      const accounting = createAdmissionAccounting();
      await expect(verifyEngineRequest(bad, 'valid', { readWasm }, accounting)).rejects.toThrow(
        kind === 'geometry' ? 'POSITIVE_GEOMETRY_REJECTED' : 'FINITE_INPUT_REJECTED',
      );
      expect(digest).not.toHaveBeenCalled();
      expect(readWasm).not.toHaveBeenCalled();
      expect(accounting.engineAssetReads).toBe(0);
      expect(accounting.factory.dispatched).toBe(0);
      if (kind === 'nan') expect(Number.isNaN(bad.massesKg[1])).toBe(true);
      if (kind === 'infinity') expect(bad.gravity[2]).toBe(Infinity);
    },
  );
  it.each(['tolerance', 'phase', 'budget', 'step'])(
    'rejects a changed finite %s contract before asset IO',
    async (kind) => {
      const bad = structuredClone(fixture);
      if (kind === 'tolerance') bad.tolerance.relative = 0.1;
      if (kind === 'phase') bad.phase.parityFields.pop();
      if (kind === 'budget') bad.budget.totalNativeSteps += 1;
      if (kind === 'step') bad.nativeStepUs[0] = 1250;
      const readWasm = vi.fn();
      await expect(
        verifyEngineRequest(bad, 'valid', { readWasm }, createAdmissionAccounting()),
      ).rejects.toThrow('FIXTURE_IDENTITY');
      expect(readWasm).not.toHaveBeenCalled();
    },
  );
  it.each([0, -0.1, -Infinity])('rejects invalid geometry%s before native allocation', (radius) => {
    expect(() => validatePhysicalInput({ ...fixture, sphereRadiusM: radius })).toThrow();
  });
  it('rejects excessive arrays before traversing or allocating native state', () => {
    expect(() =>
      validatePhysicalInput({ ...fixture, extra: Array.from({ length: 65 }, () => 0) }),
    ).toThrow('INPUT_ARRAY_LIMIT');
  });
  it('uses actual inaccessible local file error and actual corrupted pinned WASM bytes', async () => {
    const accounting = createAdmissionAccounting();
    const missing = async () => {
      try {
        return new Uint8Array(
          await readFile(join(engineRoot, 'asa-portability-intentionally-missing.wasm')),
        );
      } catch (error) {
        expect(error).toMatchObject({ code: 'ENOENT' });
        throw new PortabilityError('ASSET_UNAVAILABLE', { code: 'ENOENT' });
      }
    };
    await expect(
      verifyEngineRequest(fixture, 'missing', { readWasm: missing }, accounting),
    ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE', detail: { code: 'ENOENT' } });
    const original = new Uint8Array(readFileSync(join(engineRoot, 'mujoco.wasm')));
    const corrupt = original.slice();
    corrupt[0] = 1;
    expect(original[0]).toBe(0);
    expect(corrupt.byteLength).toBe(11200612);
    await expect(
      verifyEngineRequest(fixture, 'corrupt', { readWasm: async () => corrupt }, accounting),
    ).rejects.toMatchObject({ code: 'ASSET_INTEGRITY_REJECTED' });
    expect(accounting.engineAssetReads).toBe(2);
    expect(accounting.engineImports.dispatched).toBe(0);
    expect(accounting.factory.dispatched).toBe(0);
    expect(
      createHash('sha256')
        .update(readFileSync(join(engineRoot, 'mujoco.wasm')))
        .digest('hex'),
    ).toBe('51ae58ae3c69145f6570aeb1fae27f8f142b2d883c804c4747c1a0c3bc80b0de');
  });
});

function unitReadback() {
  const mass = 0.5,
    inertia = (2 * mass * 0.02 ** 2) / 5;
  return {
    counts: {
      nq: 7,
      nv: 6,
      na: 0,
      nu: 0,
      nbody: 2,
      ngeom: 2,
      njnt: 1,
      nplugin: 0,
      nsensor: 0,
      ntree: 1,
    },
    arrays: {
      body_mass: [0, mass],
      body_ipos: [0, 0, 0, 0, 0, 0],
      body_iquat: [1, 0, 0, 0, 1, 0, 0, 0],
      body_pos: [0, 0, 0, 0, 0, 2],
      body_quat: [1, 0, 0, 0, 1, 0, 0, 0],
      body_inertia: [0, 0, 0, inertia, inertia, inertia],
      jnt_type: [0],
      jnt_qposadr: [0],
      jnt_dofadr: [0],
      geom_type: [6, 2],
      geom_size: [5, 5, 0.01, 0.02, 0, 0],
      geom_pos: [0, 0, -0.01, 0, 0, 0],
      dof_damping: [0, 0, 0, 0, 0, 0],
      dof_armature: [0, 0, 0, 0, 0, 0],
      dof_frictionloss: [0, 0, 0, 0, 0, 0],
      jnt_stiffness: [0],
    },
    options: {
      timestep: 0.0005,
      integrator: 3,
      solver: 2,
      jacobian: 0,
      cone: 1,
      iterations: 100,
      tolerance: 1e-8,
      disableflags: 0,
      enableflags: 0,
      density: 0,
      viscosity: 0,
    },
    gravity: [0, 0, -9.81],
    wind: [0, 0, 0],
    initial: initialState(),
    warnings: warnings(),
    controls: [],
    act: [],
    qfrcApplied: [0, 0, 0, 0, 0, 0],
    xfrcApplied: Array.from({ length: 12 }, () => 0),
  };
}
describe('unchanged model/readback admission and owned copy cleanup', () => {
  it('matches the original readback validator', () => {
    expect(() => originalReadback(fixture, 0.5, 500, unitReadback())).not.toThrow();
    expect(() => validateModelReadback(fixture, 0.5, 500, unitReadback())).not.toThrow();
  });
  it.each([
    'topology',
    'mass',
    'com',
    'inertia',
    'solver',
    'damping',
    'force',
    'warning',
    'rotation',
  ])('rejects %s using both original and portable validators', (kind) => {
    const value = unitReadback();
    if (kind === 'topology') value.counts.nq += 1;
    if (kind === 'mass') value.arrays.body_mass[1] *= 2;
    if (kind === 'com') value.arrays.body_ipos[3] = 0.01;
    if (kind === 'inertia') value.arrays.body_inertia[3] = 0;
    if (kind === 'solver') value.options.integrator = 1;
    if (kind === 'damping') value.arrays.dof_damping[0] = 1;
    if (kind === 'force') value.qfrcApplied[0] = 1;
    if (kind === 'warning') value.warnings[0].number = 1;
    if (kind === 'rotation') value.initial.qpos[3] = 0;
    expect(() => originalReadback(fixture, 0.5, 500, value)).toThrow();
    expect(() => validateModelReadback(fixture, 0.5, 500, value)).toThrow();
  });
  it('rejects topology before touching any native array getter', () => {
    const arrayRead = vi.fn();
    const model = {
      nq: 1000000000,
      get body_mass() {
        arrayRead();
        return new Float64Array(2);
      },
    };
    expect(() => readModel(model, {}, createNativeCounters('node-child'))).toThrow(
      'NATIVE_TOPOLOGY',
    );
    expect(arrayRead).not.toHaveBeenCalled();
  });
  it('deletes each owned warning copy, never the borrowed vector', () => {
    const counters = createNativeCounters('node-child'),
      deleted: number[] = [],
      borrowedDelete = vi.fn();
    const vector = {
      size: () => 7,
      delete: borrowedDelete,
      get: (index: number) => ({ number: 0, lastinfo: 0, delete: () => deleted.push(index) }),
    };
    expect(copyWarnings({ warning: vector }, counters)).toEqual(warnings());
    expect(deleted).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(borrowedDelete).not.toHaveBeenCalled();
    expect(counters.warningGet).toEqual({ dispatched: 7, returned: 7 });
    expect(counters.warningDelete).toEqual({ dispatched: 7, returned: 7 });
    expect(counters.maxLiveWarningCopies).toBe(1);
    expect(counters.liveWarningCopies).toBe(0);
  });
  it('deletes a returned warning copy even when its read throws', () => {
    const deleted = vi.fn(),
      counters = createNativeCounters('node-child');
    expect(() =>
      copyWarnings(
        {
          warning: {
            size: () => 7,
            get: () => ({
              get number() {
                throw new Error('read failed');
              },
              lastinfo: 0,
              delete: deleted,
            }),
          },
        },
        counters,
      ),
    ).toThrow('read failed');
    expect(deleted).toHaveBeenCalledOnce();
    expect(counters.liveWarningCopies).toBe(0);
  });
  it('does not allocate a second owned warning copy after failed delete', () => {
    const counters = createNativeCounters('node-child'),
      get = vi.fn(() => ({
        number: 0,
        lastinfo: 0,
        delete: () => {
          throw new Error('delete failed');
        },
      }));
    const data = { warning: { size: () => 7, get } };
    expect(() => copyWarnings(data, counters)).toThrow('delete failed');
    expect(() => copyWarnings(data, counters)).toThrow('WARNING_OWNERSHIP');
    expect(get).toHaveBeenCalledOnce();
    expect(counters.liveWarningCopies).toBe(1);
  });
});

describe('integer dispatch reservation, not simulated dynamics', () => {
  it('rejects fifth quota attempt before invoking a step callback', () => {
    const counters = createNativeCounters('node-child'),
      dispatch = vi.fn();
    for (let tick = 1; tick <= 4; tick += 1) {
      reserveAdvance(counters, tick - 1, tick, 500, 4);
      dispatch();
    }
    expect(() => {
      reserveAdvance(counters, 4, 5, 500, 4);
      dispatch();
    }).toThrow('COMPUTE_QUOTA');
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(counters.advanceAttempts).toBe(5);
    expect(counters.advanceSlotsReserved).toBe(4);
    expect(counters.mj_step1.dispatched).toBe(0);
    expect(counters.mj_step2.dispatched).toBe(0);
  });
  it.each([
    [0, 2, 500],
    [0, 1.5, 500],
    [0, 1, 1250],
    [NaN, 1, 500],
  ])('rejects invalid source-time transition%s/%s/%s', (completed, next, dt) => {
    const counters = createNativeCounters('node-child');
    expect(() => reserveAdvance(counters, completed, next, dt, 4)).toThrow();
    expect(counters.advanceSlotsReserved).toBe(0);
  });
  it('never refunds a dispatched attempt into the realm budget', () => {
    const counters = createNativeCounters('node-child');
    counters.advanceSlotsReserved = 24003;
    reserveAdvance(counters, 0, 1, 500, 4);
    expect(() => reserveAdvance(counters, 1, 2, 500, 4)).toThrow('COMPUTE_QUOTA');
    expect(counters.advanceSlotsReserved).toBe(24004);
  });
});

describe('observed API boundary with rejection-only unit doubles', () => {
  it('delegates the same arguments once and restores after an asynchronous rejection', async () => {
    const rejected = new Error('unit API rejection');
    const original = vi.fn().mockRejectedValue(rejected);
    const api = { instantiate: original, Instance: class {} };
    const bytes = new Uint8Array([1, 2, 3]),
      imports = {};
    let observedError: unknown;
    try {
      await observeInstantiation(async () => api.instantiate(bytes, imports), api);
    } catch (error) {
      observedError = error;
    }
    expect(observedError).toMatchObject({
      message: 'unit API rejection',
      instantiationCounters: {
        dispatched: 1,
        returned: 0,
        rejected: 1,
        internalCompileCalls: null,
      },
    });
    expect(original).toHaveBeenCalledExactlyOnceWith(bytes, imports);
    expect(api.instantiate).toBe(original);
  });
  it('records a synchronous API rejection and restores its exact descriptor', async () => {
    const original = vi.fn(() => {
      throw new Error('synchronous unit rejection');
    });
    const api = { instantiate: original, Instance: class {} },
      before = Object.getOwnPropertyDescriptor(api, 'instantiate');
    await expect(observeInstantiation(async () => api.instantiate(), api)).rejects.toMatchObject({
      instantiationCounters: { dispatched: 1, returned: 0, rejected: 1 },
    });
    expect(Object.getOwnPropertyDescriptor(api, 'instantiate')).toEqual(before);
  });
  it('does not fabricate an instantiation count from task/factory completion', async () => {
    const original = vi.fn(),
      api = { instantiate: original, Instance: class {} };
    const result = await observeInstantiation(async () => 'no native boundary was called', api);
    expect(result.counters.dispatched).toBe(0);
    expect(result.counters.returned).toBe(0);
    expect(result.instance).toBe(null);
    expect(original).not.toHaveBeenCalled();
    expect(api.instantiate).toBe(original);
  });
  it('refuses a second boundary dispatch even after the first rejected', async () => {
    const original = vi.fn().mockRejectedValue(new Error('first unit rejection')),
      api = { instantiate: original, Instance: class {} };
    await expect(
      observeInstantiation(async () => {
        try {
          await api.instantiate();
        } catch {
          // The first rejection is expected; the second dispatch must remain forbidden.
        }
        return api.instantiate();
      }, api),
    ).rejects.toMatchObject({
      code: 'WASM_INSTANTIATION_BUDGET',
      instantiationCounters: { dispatched: 1, returned: 0, rejected: 1, blockedRequests: 1 },
    });
    expect(original).toHaveBeenCalledOnce();
    expect(api.instantiate).toBe(original);
  });
  it('rejects boundary replacement and still restores the original', async () => {
    const original = vi.fn(),
      api = { instantiate: original, Instance: class {} };
    await expect(
      observeInstantiation(async () => {
        api.instantiate = vi.fn();
      }, api),
    ).rejects.toThrow('WASM_BOUNDARY_REPLACED');
    expect(api.instantiate).toBe(original);
  });
  it('binds the observed rejection boundary to verified pinned bytes and the measured realm', async () => {
    const bytes = new Uint8Array(readFileSync(join(engineRoot, 'mujoco.wasm')));
    const expectedSha = contract.engine.files.find(
      (file: { path: string }) => file.path === 'mujoco.wasm',
    ).sha256;
    expect(await sha256(bytes)).toBe(expectedSha);
    const original = vi.fn().mockRejectedValue(new Error('unit pinned API rejection'));
    const api = { instantiate: original, Instance: class {} };
    const binding = { realm: 'node-child', sha256: expectedSha, bytes: bytes.slice() };
    await expect(
      observeInstantiation(async () => api.instantiate(bytes, {}), api, binding),
    ).rejects.toMatchObject({
      instantiationCounters: {
        scope: 'PINNED_MUJOCO_REALM',
        dispatched: 1,
        returned: 0,
        rejected: 1,
        inFlight: 0,
        input: { realm: 'node-child', sha256: expectedSha, bytes: 11200612 },
      },
    });
    expect(original).toHaveBeenCalledOnce();
    expect(api.instantiate).toBe(original);
  });
  it('rejects changed WASM input before even the rejection-only unit API is called', async () => {
    const bytes = new Uint8Array(readFileSync(join(engineRoot, 'mujoco.wasm')));
    const original = vi.fn(),
      api = { instantiate: original, Instance: class {} };
    const binding = {
      realm: 'dedicated-worker',
      sha256: contract.engine.files.find((file: { path: string }) => file.path === 'mujoco.wasm')
        .sha256,
      bytes: bytes.slice(),
    };
    bytes[0] ^= 1;
    await expect(
      observeInstantiation(async () => api.instantiate(bytes, {}), api, binding),
    ).rejects.toMatchObject({
      code: 'WASM_PINNED_INPUT_MISMATCH',
      instantiationCounters: { dispatched: 0, returned: 0, blockedRequests: 1, inFlight: 0 },
    });
    expect(original).not.toHaveBeenCalled();
    expect(api.instantiate).toBe(original);
  });
  it('fails closed when the actual API is unavailable or unobservable', async () => {
    await expect(observeInstantiation(async () => {}, {})).rejects.toThrow('WASM_API_UNAVAILABLE');
    const api = Object.defineProperty({}, 'instantiate', { value: () => {}, writable: false });
    await expect(observeInstantiation(async () => {}, api)).rejects.toThrow(
      'WASM_BOUNDARY_UNOBSERVABLE',
    );
  });
});

describe('352B records and bounded transferred packet protocol', () => {
  it('round-trips exact state/warnings and header positions', () => {
    const record = makeRecord();
    expect(record.byteLength).toBe(RECORD_BYTES);
    const decoded = decodeRecord(record);
    expect(decoded.worldOrdinal).toBe(42);
    expect(decoded.step).toBe(0);
    expect(decoded.timeUs).toBe(0);
    expect(decoded.state).toEqual(initialState());
    expect(decoded.warnings).toEqual(warnings());
    expect(Buffer.from(record.subarray(32, 240))).toEqual(originalState(initialState()));
  });
  it('preserves non-finite failure bits without allowing them in a success record', () => {
    const state = initialState();
    state.qpos[2] = NaN;
    const data = {
      kind: RECORD_KIND.failure,
      entry,
      worldOrdinal: 42,
      step: 0,
      state,
      warnings: warnings(),
      ncon: 0,
      nefc: 0,
      awake: 1,
    };
    expect(Number.isNaN(decodeRecord(encodeRecord(data)).state.qpos[2])).toBe(true);
    expect(() => encodeRecord({ ...data, kind: RECORD_KIND.endpoint })).toThrow('STATE_NONFINITE');
  });
  it('validates packet identity, digest and bounded canonical base64', async () => {
    const payload = makeRecord();
    const envelope = { ...identity, sequence: 1, worldOrdinal: 42 };
    const packet = await makePacket(payload, 1, identity.realm, 1, 42);
    expect((await inspectPacket(packet, envelope)).records).toHaveLength(1);
    expect(decodeBase64(encodeBase64(packet))).toEqual(packet);
    const corrupt = packet.slice();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(inspectPacket(corrupt, envelope)).rejects.toThrow('PACKET_SHA256');
    await expect(inspectPacket(packet, { ...envelope, sequence: 2 })).rejects.toThrow(
      'PACKET_IDENTITY',
    );
    expect(() => decodeBase64('A'.repeat(47024))).toThrow('PACKET_BASE64_LIMIT');
    expect(() => decodeBase64('####')).toThrow('PACKET_BASE64_LIMIT');
  });
  it('detaches only an owned copied ArrayBuffer without creating a Worker', async () => {
    const nativeShapedSource = makeRecord();
    const ownedCopy = await makePacket(nativeShapedSource, 1, identity.realm, 1, 42);
    const expected = ownedCopy.slice();
    const received = structuredClone(ownedCopy.buffer, { transfer: [ownedCopy.buffer] });
    expect(ownedCopy.buffer.byteLength).toBe(0);
    expect(new Uint8Array(received)).toEqual(expected);
    expect(nativeShapedSource.byteLength).toBe(352);
  });
  it('accepts exactly one acknowledged sequence at a time', async () => {
    const receiver = new ProtocolReceiver(identity),
      work = vi.fn(async () => ({ accepted: true }));
    const sender = new ProtocolSender(identity, (envelope: unknown) =>
      receiver.receive(envelope, work),
    );
    await expect(sender.emit('module', -1, {})).resolves.toEqual({ accepted: true });
    expect(receiver.sequence).toBe(1);
    expect(sender.sequence).toBe(1);
    expect(work).toHaveBeenCalledOnce();
  });
  it.each(['runId', 'generation', 'sequence', 'sourceManifestSha256'])(
    'rejects wrong %s and closes the receiver',
    async (field) => {
      const receiver = new ProtocolReceiver(identity),
        work = vi.fn();
      const envelope: Record<string, unknown> = {
        protocolVersion: 1,
        ...identity,
        sequence: 1,
        worldOrdinal: -1,
        kind: 'module',
        body: {},
      };
      envelope[field] = field === 'generation' || field === 'sequence' ? 2 : 'wrong';
      await expect(receiver.receive(envelope, work)).rejects.toThrow();
      expect(work).not.toHaveBeenCalled();
      expect(receiver.closed).toBe(true);
    },
  );
  it('does not accept a mismatched acknowledgement as permission to continue', async () => {
    const sender = new ProtocolSender(identity, async (envelope: { sequence: number }) => ({
      ...acknowledgement(envelope),
      sequence: envelope.sequence + 1,
    }));
    await expect(sender.emit('module', -1, {})).rejects.toThrow('PROTOCOL_ACK_IDENTITY:sequence');
    expect(sender.failed).toBe(true);
    await expect(sender.emit('module', -1, {})).rejects.toThrow('PROTOCOL_INFLIGHT');
  });
});

describe('failure ownership without a native world, Worker or server', () => {
  it('disposes an invalid Worker start before engine admission using a message-scope unit double', () => {
    const scope: {
      onmessage: null | ((event: { data: unknown }) => void);
      postMessage: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    } = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
    const owner = installDedicatedWorker(scope);
    const handler = scope.onmessage;
    expect(typeof handler).toBe('function');
    handler?.({
      data: { kind: 'start', config: { identity: { ...identity, realm: 'node-child' } } },
    });
    expect(owner.state()).toBe('ERROR');
    expect(scope.onmessage).toBe(null);
    expect(scope.close).toHaveBeenCalledOnce();
    expect(scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'worker-failed' }),
    );
    expect(owner.resources).toMatchObject({
      listenersCreated: 1,
      listenersRemoved: 1,
      disposed: true,
    });
  });
  it('does not mark accepted records durable when the state-digest append rejects', async () => {
    // Serialization/I/O unit rows only, never a simulated or assessed trajectory.
    const journal = new HostJournal('unused-unit-directory', fixture, contract, {});
    const world = {
      ordinal: 42,
      realm: 'dedicated-worker',
      ...entry,
      quota: false,
      folder: 'unit-world',
      baseline: null,
      endpointCount: 0,
      durableEndpointCount: 0,
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
    };
    journal.worlds.set(42, world);
    const endpoint = encodeRecord({
      kind: RECORD_KIND.endpoint,
      entry,
      worldOrdinal: 42,
      step: 1,
      state: { ...initialState(), time: 0.0005 },
      warnings: warnings(),
      ncon: 0,
      nefc: 0,
      awake: 1,
      flags: 255,
    });
    const payload = new Uint8Array(RECORD_BYTES * 2);
    payload.set(makeRecord());
    payload.set(endpoint, RECORD_BYTES);
    const envelope = { ...identity, sequence: 1, worldOrdinal: 42, body: { count: 2 } };
    const packet = await makePacket(payload, 2, identity.realm, 1, 42);
    journal.writeBytes = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('unit state-digest append failure'));
    await expect(journal.acceptPacket(envelope, packet)).rejects.toThrow(
      'unit state-digest append failure',
    );
    expect(world.endpointCount).toBe(1);
    expect(world.durableEndpointCount).toBe(0);
    expect(journal.recordCount).toBe(0);
  });
});

function pureApprovalObjects() {
  // Ephemeral unit data only: this function writes no preregistration or receipt.
  const sourceFiles = SOURCE_PATHS.map((path: string) => ({
    path,
    bytes: 1,
    sha256: 'c'.repeat(64),
  }));
  const frozenFiles = FROZEN_INPUT_PATHS.map((path: string) => ({
    path,
    bytes: 2,
    sha256: 'f'.repeat(64),
  }));
  const source = {
    sourceHead: 'b'.repeat(40),
    sourceCheckpointHead: 'b'.repeat(40),
    sourceCheckpointIsAncestor: true,
    sourceFiles,
    frozenFiles,
    checkpointSourceFiles: structuredClone(
      sourceFiles.filter((entry: { path: string }) => EXECUTION_INPUT_PATHS.includes(entry.path)),
    ),
    checkpointFrozenFiles: structuredClone(frozenFiles),
    committedChanges: [] as string[],
    stagedChanges: [] as string[],
    workingChanges: [] as string[],
    untrackedFiles: [] as string[],
    nodeVersion: 'v22.23.3',
  };
  const approved = {
    schema: 'MUJOCO_PORTABILITY_PREDATA_V1',
    approval: 'APPROVED_FOR_ONE_NATIVE_RUN',
    independentReviewSha256: 'd'.repeat(64),
    runId: 'pure-validation-only',
    sourceHead: source.sourceCheckpointHead,
    sourceFiles: structuredClone(source.checkpointSourceFiles),
    frozenFiles: structuredClone(frozenFiles),
    reportOnlyPaths: [...REPORT_PATHS],
    nodeVersion: source.nodeVersion,
    nativeBudget: contract.nativeBudget,
    journalMaximumBytes: 43357920,
    journalEnvelopeBytes: 67108864,
    chromiumRevision: '1193',
    chromiumVersion: '140.0.7339.186',
    chromiumSha256: 'fe844627cb1b2131d63eaef5c272519c3d03f6caafeebd16d569d6a22a7b793a',
    outputDirectory: resolve(tmpdir(), 'unit-future-output'),
    dependencyRoot: resolve(tmpdir(), 'unit-dependencies'),
    engineRoot: resolve(tmpdir(), 'unit-engine'),
    chromiumExecutable: resolve(tmpdir(), 'unit-chromium'),
  };
  return { source, approved };
}

describe('execution admission and complete finite resource arithmetic', () => {
  it('derives63worlds/72012advances/791packets/72080records and exact journal cap', () => {
    expect(deriveBudget(fixture, contract)).toEqual({
      worlds: 63,
      advances: 72012,
      records: 72080,
      packets: 791,
      normalDataBytes: 25422784,
      digestBytes: 2304384,
      maximumBytes: 43357920,
      hardEnvelopeBytes: 67108864,
    });
    expect(contract.nativeBudget.warningCopies).toBe(504560);
    expect(contract.nativeBudget.warningCopiesIncludingOneEmergency).toBe(504567);
    expect(63 * 4 + 9).toBe(261);
  });
  it('refuses journal over-allocation before changing the allowance', () => {
    const ledger = new JournalAllowance(contract);
    for (const [category, limit] of Object.entries(ledger.limits)) ledger.reserve(category, limit);
    expect(ledger.total).toBe(43357920);
    expect(() => ledger.reserve('raw', 1)).toThrow('JOURNAL_BYTE_BUDGET');
    expect(ledger.total).toBe(43357920);
  });
  it('requires exact future approval/source/browser/budget before any execution', () => {
    const { source, approved } = pureApprovalObjects();
    expect(validateExecutionApproval(approved, source, contract)).toBe(approved);
    expect(() =>
      validateExecutionApproval({ ...approved, approval: 'SOURCE_ONLY' }, source, contract),
    ).toThrow('NATIVE_EXECUTION_NOT_APPROVED');
    expect(() =>
      validateExecutionApproval({ ...approved, sourceHead: 'e'.repeat(40) }, source, contract),
    ).toThrow('PREDATA_SOURCE_HEAD');
    expect(() =>
      validateExecutionApproval({ ...approved, chromiumRevision: '1228' }, source, contract),
    ).toThrow('PREDATA_CHROMIUM_VERSION');
    expect(() =>
      validateExecutionApproval(
        { ...approved, nativeBudget: { ...contract.nativeBudget, advances: 72013 } },
        source,
        contract,
      ),
    ).toThrow('PREDATA_NATIVE_BUDGET');
  });
  it('admits report-only preregistration after its committed source checkpoint without a self hash', () => {
    const { source, approved } = pureApprovalObjects();
    source.sourceHead = 'e'.repeat(40);
    source.committedChanges = [REPORT_PATHS[0]];
    source.stagedChanges = [REPORT_PATHS[0]];
    source.workingChanges = [REPORT_PATHS[1]];
    const report = source.sourceFiles.find(
      (entry: { path: string }) => entry.path === REPORT_PATHS[0],
    );
    expect(report).toBeDefined();
    report.sha256 = '0'.repeat(64);
    expect(approved.sourceFiles).toHaveLength(6);
    expect(
      approved.sourceFiles.every((entry: { path: string }) => !REPORT_PATHS.includes(entry.path)),
    ).toBe(true);
    expect(validateExecutionApproval(approved, source, contract)).toBe(approved);
  });
  it.each(['committedChanges', 'stagedChanges', 'workingChanges', 'untrackedFiles'] as const)(
    'rejects unexpected source drift in %s before native dispatch',
    (field) => {
      const { source, approved } = pureApprovalObjects();
      source[field] = ['tools/robotics-field-core/unreviewed.mjs'];
      expect(() => validateExecutionApproval(approved, source, contract)).toThrow(
        'PREDATA_UNEXPECTED_DRIFT:' + field,
      );
    },
  );
  it('rejects edited executable bytes even if a drift list omits them', () => {
    const { source, approved } = pureApprovalObjects();
    source.sourceFiles[0].sha256 = '0'.repeat(64);
    expect(() => validateExecutionApproval(approved, source, contract)).toThrow(
      'PREDATA_SOURCE_FILES_IDENTITY',
    );
  });
  it('rejects different checkpoint bytes and frozen physics/spec inputs', () => {
    const { source, approved } = pureApprovalObjects();
    source.checkpointSourceFiles[0].sha256 = '0'.repeat(64);
    expect(() => validateExecutionApproval(approved, source, contract)).toThrow(
      'PREDATA_SOURCE_FILES_IDENTITY',
    );
    const second = pureApprovalObjects();
    second.source.frozenFiles[0].sha256 = '0'.repeat(64);
    expect(() => validateExecutionApproval(second.approved, second.source, contract)).toThrow(
      'PREDATA_FROZEN_FILES_IDENTITY',
    );
  });
  it('refuses unrelated history or a code path disguised as a report allowlist entry', () => {
    const { source, approved } = pureApprovalObjects();
    expect(() =>
      validateExecutionApproval(
        approved,
        { ...source, sourceCheckpointIsAncestor: false },
        contract,
      ),
    ).toThrow('PREDATA_SOURCE_HEAD');
    expect(() =>
      validateExecutionApproval(
        { ...approved, reportOnlyPaths: [...approved.reportOnlyPaths, EXECUTION_INPUT_PATHS[0]] },
        source,
        contract,
      ),
    ).toThrow('PREDATA_REPORT_ALLOWLIST');
  });
  it('allows only exact local GET routes, without path normalization/fallback', () => {
    for (const route of ROUTES) expect(resolveLocalRoute(route, 'GET')).toBe(route);
    for (const route of [
      'https://example.org/mujoco.wasm',
      '/../assets/mujoco.wasm',
      '/assets/mujoco.wasm?fallback=1',
      '/unknown',
    ])
      expect(() => resolveLocalRoute(route, 'GET')).toThrow('LOCAL_ASSET_ALLOWLIST');
    expect(() => resolveLocalRoute('/assets/mujoco.wasm', 'POST')).toThrow('LOCAL_ASSET_ALLOWLIST');
  });
  it('keeps the browser import graph free of Node-only helpers and state writes', () => {
    for (const name of ['sampler', 'runtime', 'worker']) {
      const code = readFileSync(
        new URL(
          '../../../tools/robotics-field-core/mujoco-portability-' + name + '.mjs',
          import.meta.url,
        ),
        'utf8',
      );
      expect(code).not.toMatch(/(?:from\s*|import\s*\()\s*['"]node:/);
      expect(code).not.toMatch(/\bBuffer\b|\brequire\s*\(/);
      expect(code).not.toMatch(/data\.q(?:pos|vel)\s*(?:\[[^\]]+\]\s*=|\.set\s*\()/);
      expect(code).not.toContain('executePhy01');
    }
    const host = readFileSync(
      new URL('../../../tools/robotics-field-core/run-mujoco-portability.mjs', import.meta.url),
      'utf8',
    );
    expect(host).not.toContain('.executePhy01(');
    expect(host).not.toContain('instantiateWasm:');
    expect(host).not.toContain('route.fulfill(');
  });
});

// This independent list is the eleven published inputs that actually exist in 7abc72d.
// It is intentionally not derived from FROZEN_INPUT_PATHS.
const publishedInputs = [
  [
    'docs/product/robotics/FIELD_CORE_SPEC.md',
    '297bcc4f48ac3af82f9cf6f85e7dc019a409beb48c7506b75c8efeacb6443a0e',
  ],
  [
    'docs/product/electronics/tasks/TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001.md',
    '0ca37747706d04d38d405bdd99186a19616a8cf7187ae91dad5d8162b4061623',
  ],
  [
    'tools/robotics-field-core/mujoco-phy01.mjs',
    '05998a3f88968552cb80c75172d724719fb7f7ecfe6c66762e7e44857e0b5f99',
  ],
  [
    'tools/robotics-field-core/run-mujoco-phy01.mjs',
    '5b2179f0ff1b6c759b63757dd881242aee6c9fb4b258243a08a7b50dfefb12ad',
  ],
  [
    'tests/robotics/field-core-qualification/mujoco-phy01.fixture.json',
    'a8c88eac291c4ef48a0db7261f67949e162b1e13e713705333365c804d41f67c',
  ],
  [
    'tests/robotics/field-core-qualification/mujoco-phy01.spec.ts',
    '1266b4c420baea08fd4448beb9d96a908d039bc3ddcbfc89a67b911aef893cb4',
  ],
  [
    'tools/robotics-field-core/mujoco-artifact.json',
    '1c353e3593f1fcd730c6e97f9549d3b6fdff7ce1fff7b9c45755edd7cd1ca1c3',
  ],
  [
    'tools/robotics-field-core/MUJOCO-LICENSE.txt',
    'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  ],
  [
    'tools/robotics-field-core/MUJOCO-THIRD-PARTY-NOTICES.txt',
    '6f681117208684ef2ab3ad03a9f928ae8c6dffb4f765eeab59fb2d8b189e1540',
  ],
  ['package.json', 'c2f5a1421e86b7dd37022eda8a37cf25cded373d986c31dc8f8e1beb435c7492'],
  ['pnpm-lock.yaml', '448b5a8faa0f8497c3efe1bdc63959b381fad5577bfb5734261e9578ee5a93e1'],
] as const;

describe('PDR-01/02 real filesystem and isolated Git index regressions', () => {
  it('reads exactly the eleven independently enumerated inherited files and published Git blobs', async () => {
    const observed = await inheritedSnapshot('7abc72d2f8bf88475fd9b2467603243d7498b336', ROOT);
    expect(FROZEN_INPUT_PATHS).toEqual(publishedInputs.map(([path]) => path));
    expect(observed.frozenFiles).toEqual(observed.checkpointFrozenFiles);
    expect(
      observed.frozenFiles.map(({ path, sha256 }: { path: string; sha256: string }) => [
        path,
        sha256,
      ]),
    ).toEqual(publishedInputs);
  });
  it('rejects HEAD=A/index=B/worktree=A executable drift and admits only staged report changes', async () => {
    const parent = process.env.ASA_PORTABILITY_GIT_FIXTURE_PARENT ?? tmpdir();
    const root = await mkdtemp(join(parent, 'asa-portability-git-unit-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        [
          '--no-optional-locks',
          '-C',
          root,
          '-c',
          'core.autocrlf=false',
          '-c',
          'core.hooksPath=' + join(root, 'disabled-hooks'),
          '-c',
          'commit.gpgSign=false',
          '-c',
          'user.name=Portability unit fixture',
          '-c',
          'user.email=portability-unit@example.invalid',
          ...args,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
        },
      ).trim();
    try {
      for (const path of [...SOURCE_PATHS, ...publishedInputs.map(([path]) => path)]) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), 'unit A: ' + path + '\n');
      }
      git('init', '--quiet');
      git('config', '--local', 'core.longpaths', 'true');
      git('add', '--all');
      git('commit', '--quiet', '-m', 'Ephemeral admission fixture A');
      const head = git('rev-parse', 'HEAD');
      const before = await sourceSnapshot(head, root);
      expect(before.stagedChanges).toEqual([]);
      expect(before.workingChanges).toEqual([]);
      const { approved } = pureApprovalObjects();
      Object.assign(approved, {
        sourceHead: head,
        sourceFiles: before.checkpointSourceFiles,
        frozenFiles: before.checkpointFrozenFiles,
      });
      expect(validateExecutionApproval(approved, before, contract)).toBe(approved);
      const codePath = EXECUTION_INPUT_PATHS[0];
      const original = await readFile(join(root, codePath));
      await writeFile(join(root, codePath), 'unit B: staged source only\n');
      git('add', '--', codePath);
      await writeFile(join(root, codePath), original);
      const staged = await sourceSnapshot(head, root);
      expect(staged.workingChanges).toEqual([]);
      expect(staged.sourceFiles).toEqual(before.sourceFiles);
      expect(staged.stagedChanges).toEqual([codePath]);
      expect(() => validateExecutionApproval(approved, staged, contract)).toThrow(
        'PREDATA_UNEXPECTED_DRIFT:stagedChanges',
      );
      git('restore', '--staged', '--', codePath);
      const report = REPORT_PATHS[0],
        reportBytes = await readFile(join(root, report));
      await writeFile(join(root, report), 'unit B: staged report only\n');
      git('add', '--', report);
      await writeFile(join(root, report), reportBytes);
      const after = await sourceSnapshot(head, root);
      expect(after.stagedChanges).toEqual([report]);
      expect(after.workingChanges).toEqual([]);
      expect(after.sourceFiles).toEqual(before.sourceFiles);
      expect(validateExecutionApproval(approved, after, contract)).toBe(approved);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});

function unitModule(realm = identity.realm) {
  const accounting = createAdmissionAccounting();
  accounting.engineAssetReads = 4;
  accounting.engineImports = { dispatched: 1, returned: 1 };
  accounting.factory = { dispatched: 1, returned: 1 };
  accounting.versionCalls = { mj_version: 1, mj_versionString: 1 };
  return {
    counters: createNativeCounters(realm),
    accounting,
    instantiation: {
      dispatched: 1,
      returned: 1,
      rejected: 0,
      blockedRequests: 0,
      inFlight: 0,
      scope: 'PINNED_MUJOCO_REALM',
      internalCompileCalls: null,
      compileObservation: 'NOT_INSTRUMENTED',
      input: {
        realm,
        sha256: contract.engine.files[1].sha256,
        bytes: 11200612,
        identity: 'BYTE_EXACT_TO_PREVIOUSLY_SHA256_VERIFIED_ASSET',
      },
    },
    version: 4000000,
    versionString: '4.0.0',
    memoryBytes: 17629184,
    crossOriginIsolated: false,
    online: true,
  };
}
function unitFailureWorld() {
  const failure = failureRecord(new PortabilityError('STATE_NONFINITE'), 'endpoint_observation');
  const counters = createNativeCounters(identity.realm);
  Object.assign(counters, {
    worlds: 1,
    maxLiveModels: 1,
    maxLiveData: 1,
    advanceAttempts: 1,
    advanceSlotsReserved: 1,
    advancesDispatched: 1,
    advancesCompleted: 1,
    failureObservations: 1,
  });
  for (const name of ['models', 'data', 'modelsDeleted', 'dataDeleted', 'mj_step1', 'mj_step2'])
    counters[name] = { dispatched: 1, returned: 1 };
  const run = {
    ...entry,
    worldOrdinal: 42,
    quota: false,
    steps: 1,
    attemptedStepIndex: 1,
    phase: 'endpoint_observation',
    errorPhase: 'endpoint_observation',
    error: 'PortabilityError: STATE_NONFINITE',
    failure,
    cleanupErrors: [],
    cleanupFailures: [],
    failureObservationError: null,
    nativeCalls: {
      mj_step1: { dispatched: 1, returned: 1 },
      mj_step2: { dispatched: 1, returned: 1 },
      mj_step: { dispatched: 0, returned: 0 },
    },
    recordAccounting: {
      ...createRecordAccounting(),
      emittedFailureFrames: 1,
      acknowledgedFailureFrames: 1,
      packetsDispatched: 2,
      packetsAcknowledged: 2,
    },
  };
  const world = {
    ordinal: 42,
    realm: identity.realm,
    ...entry,
    quota: false,
    folder: 'unit-world',
    baseline: null,
    endpointCount: 0,
    durableEndpointCount: 0,
    failureFrames: 0,
    durableFailureFrames: 0,
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
    receivedEnd: null,
  };
  return { failure, counters, run, world, body: { run, counters, memoryBytes: 17629184 } };
}
function memoryOnlyJournal() {
  const assessor = { assessPhy01: vi.fn(), makeModelXml: originalXml };
  const journal = new HostJournal('unused-unit-directory', fixture, contract, assessor);
  journal.registerRealm(identity);
  const rows: Uint8Array[] = [];
  journal.writeBytes = vi.fn(async (_path: string, bytes: Uint8Array) => {
    rows.push(bytes.slice());
  });
  journal.writeJson = vi.fn(async () => {});
  return { journal, assessor, rows };
}

describe('PDR-03 received evidence and interruption classification — no realm execution', () => {
  it.each([
    'TIMEOUT:protocol-ack',
    'TIMEOUT:world',
    'NODE_CHILD_LOST',
    'WORKER_LOST',
    'FORCED_TERMINATION',
  ])('classifies %s as INCOMPLETE while retaining its phase and primary cause', (code) => {
    const failure = failureRecord(new PortabilityError(code), 'unit_phase');
    expect(failure.classification).toBe('INCOMPLETE');
    expect(failureRecord(failureError(failure), 'propagation_phase')).toEqual(failure);
    expect(failureOutcome([failureRecord(new PortabilityError('STATE_NONFINITE')), failure])).toBe(
      'INCOMPLETE',
    );
  });
  it('classifies a confirmed native invariant as FAIL and rejects forged classifications', () => {
    const failure = failureRecord(new PortabilityError('STATE_NONFINITE'), 'endpoint_observation');
    expect(failureOutcome([failure])).toBe('FAIL');
    expect(() => failureError({ ...failure, classification: 'INCOMPLETE' })).toThrow(
      'FAILURE_RECEIPT_CLASSIFICATION',
    );
    expect(() => failureError({ ...failure, phase: 'x'.repeat(129) })).toThrow(
      'FAILURE_RECEIPT_SCHEMA',
    );
  });
  it('counts actual adapter dispatch independently from the later failed ACK', async () => {
    const counts = createRecordAccounting();
    counts.validatedEndpoints = 1;
    const sender = new ProtocolSender(
      identity,
      async (_envelope: unknown, _bytes: unknown, dispatched: () => void) => {
        dispatched();
        return { kind: 'fatal', failure: failureRecord(new PortabilityError('TIMEOUT:unit-ack')) };
      },
    );
    const dispatch = () =>
      dispatchRecordBatch(counts, [RECORD_KIND.endpoint], (sent: () => void) =>
        sender.emit('packet', 42, { count: 1 }, null, sent),
      );
    await expect(dispatch()).rejects.toThrow('TIMEOUT:unit-ack');
    expect(counts).toMatchObject({
      validatedEndpoints: 1,
      emittedEndpoints: 1,
      acknowledgedEndpoints: 0,
      packetsDispatched: 1,
      packetsAcknowledged: 0,
    });
    await expect(dispatch()).rejects.toThrow('PROTOCOL_INFLIGHT');
    expect(counts.emittedEndpoints).toBe(1);
  });
  it('does not count a transport rejection before dispatch as an emitted endpoint', async () => {
    const counts = createRecordAccounting();
    counts.validatedEndpoints = 1;
    const sender = new ProtocolSender(identity, () => {
      throw new PortabilityError('WORKER_LOST');
    });
    await expect(
      dispatchRecordBatch(counts, [RECORD_KIND.endpoint], (sent: () => void) =>
        sender.emit('packet', 42, { count: 1 }, null, sent),
      ),
    ).rejects.toThrow('WORKER_LOST');
    expect(counts.emittedEndpoints).toBe(0);
    expect(counts.packetsDispatched).toBe(0);
  });
  it('retains one completed step and its failure frame without inventing a successful endpoint', async () => {
    const { journal } = memoryOnlyJournal(),
      unit = unitFailureWorld();
    journal.worlds.set(42, unit.world);
    const failedState = initialState();
    failedState.qpos[2] = NaN;
    const record = encodeRecord({
      kind: RECORD_KIND.failure,
      entry,
      worldOrdinal: 42,
      step: 1,
      state: { ...failedState, time: 0.0005 },
      warnings: warnings(),
      ncon: 0,
      nefc: 0,
      awake: 1,
      flags: 0,
    });
    const payload = new Uint8Array(RECORD_BYTES * 2);
    payload.set(makeRecord());
    payload.set(record, RECORD_BYTES);
    const envelope = { ...identity, sequence: 1, worldOrdinal: 42, body: { count: 2 } };
    await journal.acceptPacket(envelope, await makePacket(payload, 2, identity.realm, 1, 42));
    await journal.endWorld({ ...identity, worldOrdinal: 42, body: unit.body });
    expect(unit.world.receivedEnd.run.steps).toBe(1);
    expect(unit.world.receivedEnd.counters.mj_step2.returned).toBe(1);
    expect(unit.world.endpointCount).toBe(0);
    expect(unit.world.durableEndpointCount).toBe(0);
    expect(unit.world.failureFrames).toBe(1);
    expect(journal.writeJson).toHaveBeenCalledWith(
      'unit-world/metadata.json',
      expect.objectContaining({
        status: 'FAIL',
        progress: expect.objectContaining({
          nativeCompleted: 1,
          emittedEndpoints: 0,
          acceptedEndpoints: 0,
          durableEndpoints: 0,
          receivedFailureFrames: 1,
          durableFailureFrames: 1,
        }),
      }),
      'worldMetadata',
      65536,
    );
  });
  it('keeps complete-success equality strict even when partial counts form a valid failed receipt', async () => {
    const { journal } = memoryOnlyJournal(),
      unit = unitFailureWorld();
    Object.assign(unit.run, { error: null, failure: null });
    journal.worlds.set(42, unit.world);
    await expect(
      journal.endWorld({ ...identity, worldOrdinal: 42, body: unit.body }),
    ).rejects.toThrow('WORLD_SUCCESS_COMPLETENESS');
    expect(unit.world.receivedEnd.run.steps).toBe(1);
    expect(journal.writeJson).toHaveBeenCalled();
  });
  it('persists the exact module receipt before an ACK error and reconstructs it from bounded protocol chunks', async () => {
    const { journal, rows } = memoryOnlyJournal(),
      module = unitModule();
    journal.protocol = vi.fn(async () => {
      throw new PortabilityError('TIMEOUT:unit-ack');
    });
    const envelope = { ...identity, kind: 'module', worldOrdinal: -1, sequence: 6, body: module };
    await expect(journal.handle(envelope, null, null)).rejects.toThrow('TIMEOUT:unit-ack');
    const receipt = journal.receipts.get(identity.realm + '/module');
    expect(receipt.durable).toBe(true);
    const reconstructed = Buffer.concat(
      rows.map((row) => {
        expect(row.byteLength).toBeLessThanOrEqual(1024);
        return Buffer.from(JSON.parse(Buffer.from(row).toString()).base64, 'base64');
      }),
    );
    expect(createHash('sha256').update(reconstructed).digest('hex')).toBe(receipt.sha256);
    expect(JSON.parse(reconstructed.toString()).body).toEqual(module);
  });
  it('retains the received module in memory when its journal write rejects', async () => {
    const { journal } = memoryOnlyJournal(),
      module = unitModule();
    journal.writeBytes = vi.fn(async () => {
      throw new Error('unit disk failure');
    });
    await expect(journal.recordModule({ ...identity, body: module, sequence: 6 })).rejects.toThrow(
      'unit disk failure',
    );
    expect(journal.receipts.get(identity.realm + '/module')).toMatchObject({
      durable: false,
      snapshot: { body: module },
      persistenceError: { phase: 'receipt_write' },
    });
  });
  it('saves terminal counters and the last world after a transport failure without invoking the physical assessor', async () => {
    const { journal, assessor } = memoryOnlyJournal(),
      unit = unitFailureWorld(),
      module = unitModule();
    journal.worlds.set(42, unit.world);
    const terminal = {
      identity,
      realm: identity.realm,
      verdict: 'FAIL',
      counters: unit.counters,
      accounting: module.accounting,
      instantiation: module.instantiation,
      module,
      error: unit.failure,
      secondaryErrors: [failureRecord(new PortabilityError('TIMEOUT:world-end-ack'))],
      lastWorld: unit.run,
      lastMemoryBytes: 17629184,
      resources: {
        disposed: true,
        listenersCreated: 1,
        listenersRemoved: 1,
        packetsTransferred: 2,
        senderBuffersDetached: 2,
        maxInflight: 1,
      },
    };
    await journal.captureTerminal(identity, terminal, 'worker-disposed');
    expect(journal.receipts.get(identity.realm + '/terminal').snapshot.body).toEqual(terminal);
    expect(journal.latestNativeObservation(identity.realm).counters.advancesCompleted).toBe(1);
    expect(unit.world.receivedEnd.run.steps).toBe(1);
    expect(assessor.assessPhy01).not.toHaveBeenCalled();
    expect(failureOutcome(journal.observedFailures())).toBe('INCOMPLETE');
  });
  it('preserves an incomplete realm receipt and never submits its partial set to the assessor', async () => {
    const { journal, assessor } = memoryOnlyJournal(),
      module = unitModule();
    const result = {
      identity,
      realm: identity.realm,
      verdict: 'INCOMPLETE',
      counters: module.counters,
      accounting: module.accounting,
      instantiation: module.instantiation,
      error: failureRecord(new PortabilityError('TIMEOUT:world')),
      secondaryErrors: [],
      worlds: [],
    };
    await journal.finishRealm({ ...identity, sequence: 7, body: result });
    expect(journal.receipts.get(identity.realm + '/realm-end').durable).toBe(true);
    expect(journal.assessments).toEqual([expect.objectContaining({ verdict: 'NOT_RUN' })]);
    expect(assessor.assessPhy01).not.toHaveBeenCalled();
  });
  it('waits for the real disposal message after relay failure and saves it before settling', async () => {
    const worker: {
      onmessage: null | ((event: { data: unknown }) => Promise<void>);
      onerror: null | ((event: { message: string }) => void);
      postMessage: ReturnType<typeof vi.fn>;
    } = { onmessage: null, onerror: null, postMessage: vi.fn() };
    const binding = vi.fn(async () => {
      throw new PortabilityError('TIMEOUT:unit-binding');
    });
    let release: () => void = () => {};
    const stored = vi.fn(
      () =>
        new Promise<void>((resolveStored) => {
          release = resolveStored;
        }),
    );
    let settled = false;
    const pending = relayWorker(worker, { identity }, binding, stored).then((result: unknown) => {
      settled = true;
      return result;
    });
    await worker.onmessage?.({ data: { kind: 'event', envelope: {}, buffer: null } });
    expect(settled).toBe(false);
    expect(worker.onmessage).not.toBe(null);
    expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'fatal' }));
    const result = {
      identity,
      realm: identity.realm,
      verdict: 'INCOMPLETE',
      counters: createNativeCounters(identity.realm),
    };
    const disposing = worker.onmessage?.({ data: { kind: 'worker-disposed', result } });
    expect(stored).toHaveBeenCalledWith(expect.objectContaining(result), 'worker-disposed');
    expect(settled).toBe(false);
    release();
    await disposing;
    await expect(pending).resolves.toMatchObject({
      ...result,
      relayFailure: { code: 'TIMEOUT:unit-binding' },
    });
    expect(worker.onmessage).toBe(null);
    expect(worker.onerror).toBe(null);
  });
  it('rejects mismatched identity and impossible counters before accepting terminal evidence', async () => {
    const { journal } = memoryOnlyJournal();
    await expect(
      journal.captureTerminal(
        identity,
        { identity: { ...identity, runId: 'wrong-run-id' } },
        'worker-disposed',
      ),
    ).rejects.toThrow('RECEIPT_IDENTITY:runId');
    const counters = createNativeCounters(identity.realm);
    counters.advancesCompleted = 1;
    expect(() => validateNativeSnapshot(counters, identity.realm)).toThrow(
      'COUNTER_SNAPSHOT_RELATION',
    );
    expect(journal.receipts.size).toBe(0);
  });
  it('bounds receipt chunks inside the existing protocol cap and keeps non-finite metadata explicit', () => {
    const parts = 3 * [8192, 16384, 32768].reduce((sum, cap) => sum + Math.ceil(cap / 384), 0);
    expect(parts).toBe(453);
    expect(parts + 1886).toBeLessThanOrEqual(4096);
    expect((parts + 1886) * 1024).toBeLessThanOrEqual(contract.journalBudget.fixedCaps.protocol);
    expect(receiptSnapshot({ value: NaN }, 100)).toEqual({ value: { nonFinite: 'NaN' } });
    expect(() => receiptSnapshot({ value: 'x'.repeat(500) }, 100)).toThrow('RECEIPT_BYTE_LIMIT');
    expect(deriveBudget(fixture, contract).maximumBytes).toBe(43357920);
  });
});
