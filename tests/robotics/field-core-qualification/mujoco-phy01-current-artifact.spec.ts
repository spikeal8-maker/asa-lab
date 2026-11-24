import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import f from './mujoco-phy01-current-artifact.fixture.json';

// Equations and original assessment conditions are copied from the immutable Git blobs
// listed in the fixture, never imported from their unconditional native test/helper/CLI.
const fixtureUrl = new URL('./mujoco-phy01-current-artifact.fixture.json', import.meta.url);
const sourceUrl = new URL(import.meta.url);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
function demand(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
const norm = (v: number[]) => Math.hypot(...v);
const difference = (a: number[], b: number[]) => a.map((v, i) => v - b[i]!);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type OldFixture = {
  massesKg: number[];
  sampleTimesUs: number[];
  gravity: number[];
  initialQpos: number[];
  initialQvel: number[];
  macroStepUs: number;
  nativeStepUs: number[];
  repeats: number;
  sphereRadiusM: number;
  floorTopZ: number;
  floorHalfExtentsM: number[];
  tolerance: {
    positionAbsoluteM: number;
    velocityAbsoluteMps: number;
    relative: number;
    massReadbackRelative: number;
  };
  phase: { referenceMassKg: number };
  warningCount: number;
};
const original = JSON.parse(f.historical.fixtureUtf8) as OldFixture;
const historyHashes = [
  'a8c88eac291c4ef48a0db7261f67949e162b1e13e713705333365c804d41f67c',
  '1266b4c420baea08fd4448beb9d96a908d039bc3ddcbfc89a67b911aef893cb4',
  '05998a3f88968552cb80c75172d724719fb7f7ecfe6c66762e7e44857e0b5f99',
  '5b2179f0ff1b6c759b63757dd881242aee6c9fb4b258243a08a7b50dfefb12ad',
];
const profile = {
  gravity: [0, 0, -9.81],
  integrator: 3,
  solver: 2,
  jacobian: 0,
  cone: 1,
  iterations: 100,
  ls_iterations: 50,
  noslip_iterations: 20,
  ccd_iterations: 100,
  disableflags: 65536,
  enableflags: 32,
  tolerance: 1e-10,
  ls_tolerance: 0.01,
  noslip_tolerance: 1e-12,
  impratio: 1,
  ccd_tolerance: 1e-8,
  density: 0,
  viscosity: 0,
  wind: [0, 0, 0],
};
const expectedEngineHashes = [
  '9507aabcc8d80deea66e7f93053092a98857381f087ff0a7e19cefe412ccc1d8',
  'd2caf28d73afa997a2534ef0aa940587757c16797653bf476c22994bd2405241',
  '779287fbb2f116717d533055c737ecf3453e9007e9fea26453ff0464c2cb69ff',
  'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  'c065ffc9b16ccaa5ed4c9798f5f962fbfe2476526de016d158abdc2c669ea4e9',
  '70262f08f232705bbacf5050c095c6d35cf3f2a6bb0edb5bfc7ca12285b6b3b5',
];
function validateFixture(value: typeof f = f) {
  demand(
    hash(JSON.stringify(value)) ===
      'a4007082bcd723f520b8a3b4fdbca4994455d9d1b0be6b09e2161129dcecd958',
    'EXACT_REGISTERED_FIXTURE',
  );
  demand(
    value.id === 'E1-PHY01-CURRENT-AOT-TRANSFER-01' && value.scope === 'TEST_ONLY',
    'REGISTERED_ID',
  );
  demand(value.registration === 'c353353a7b1977035e35aeb0201f8ee879251960', 'REGISTERED_SELECTION');
  demand(
    value.historical.commit === '5c2b8126af49c9cbf7595152d97f32ce61caed8b' &&
      value.historical.tree === '2d8dda38723952d48d5d5cb0bdedd56a3d650e64' &&
      value.historical.blobs.length === 4 &&
      same(
        value.historical.blobs.map((x) => x.sha256),
        historyHashes,
      ) &&
      hash(value.historical.fixtureUtf8) === historyHashes[0],
    'FROZEN_HISTORICAL_CONTRACT',
  );
  demand(same(value.profile, profile), 'REGISTERED_CURRENT_PROFILE');
  demand(
    same(
      [
        value.engine.glue,
        value.engine.wasm,
        value.engine.declarations,
        value.engine.license,
        value.engine.buildReceipt,
        value.engine.browserReceipt,
      ].map((x) => x.sha256),
      expectedEngineHashes,
    ),
    'REGISTERED_ARTIFACT_PINS',
  );
  demand(
    value.specification.currentSha256 ===
      '0724664b31fd6ae6934aab31ce531fbfac06e2aaa08e0661dd2fb2daaf728cc3' &&
      value.specification.archiveSha256 ===
        '297bcc4f48ac3af82f9cf6f85e7dc019a409beb48c7506b75c8efeacb6443a0e',
    'REGISTERED_SPECIFICATION',
  );
  demand(
    same(value.raw, {
      recordBytes: 1280,
      maxIntervals: 24000,
      metadataBytes: 1048576,
      emergencyBytes: 1048576,
      totalBytes: 33554432,
    }),
    'REGISTERED_RAW_BOUNDS',
  );
}
type Entry = { mode: 'split' | 'full'; massKg: number; dtUs: number; repeat: number };
function plan(): Entry[] {
  const all: Entry[] = [];
  for (const dtUs of original.nativeStepUs)
    for (const massKg of original.massesKg)
      for (let repeat = 0; repeat < original.repeats; repeat++)
        all.push({ mode: 'split', massKg, dtUs, repeat });
  for (const dtUs of original.nativeStepUs)
    all.push({ mode: 'full', massKg: 0.5, dtUs, repeat: 0 });
  return all;
}
const key = (e: Entry) => [e.mode, e.massKg, e.dtUs, e.repeat].join('/');
function analyticalAt(timeUs: number) {
  const t = timeUs / 1e6;
  const displacement = original.gravity.map((g) => (g * t * t) / 2),
    velocity = original.gravity.map((g) => g * t);
  return {
    displacement,
    velocity,
    positionToleranceM: Math.max(
      original.tolerance.positionAbsoluteM,
      original.tolerance.relative * norm(displacement),
    ),
    velocityToleranceMps: Math.max(
      original.tolerance.velocityAbsoluteMps,
      original.tolerance.relative * norm(velocity),
    ),
  };
}
function nativeTimeBudget(step: number, dtUs: number) {
  const gamma = (step * Number.EPSILON) / (1 - step * Number.EPSILON);
  return (gamma + 2 * Number.EPSILON) * Math.max((step * dtUs) / 1e6, dtUs / 1e6);
}
function float64Bytes(values: number[]) {
  demand(values.every(Number.isFinite), 'NONFINITE_F64');
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return b;
}
type State = {
  qpos: number[];
  qvel: number[];
  qacc: number[];
  qacc_warmstart: number[];
  time: number;
};
const stateFields = ['qpos', 'qvel', 'qacc', 'qacc_warmstart'] as const;
function stateBytes(s: State, preserve = false) {
  return float64Bytes([
    ...(preserve ? [...s.qpos, ...s.qvel] : stateFields.flatMap((k) => s[k])),
    s.time,
  ]);
}
function numbers(v: unknown, width: number, label: string, integer = false) {
  demand(integer ? v instanceof Int32Array : v instanceof Float64Array, label + '_TYPE');
  const values = Array.from(v as Float64Array | Int32Array);
  demand(values.length === width && values.every(Number.isFinite), label + '_WIDTH_FINITE');
  return values;
}
type Handle = { delete(): void };
type Warning = Handle & { number: number; lastinfo: number };
type WarningVector = { size(): number; get(i: number): Warning | undefined };
type Model = Handle & Record<string, unknown> & { opt: Record<string, unknown>; ntree: number };
type Data = Handle &
  Record<string, unknown> & {
    time: number;
    ncon: number;
    nefc: number;
    ntree_awake: number;
    warning: WarningVector;
  };
type Native = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  mj_version(): number;
  mj_versionString(): string;
  mj_step1(m: Model, d: Data): void;
  mj_step2(m: Model, d: Data): void;
  mj_step(m: Model, d: Data): void;
};
type Ledger = {
  modelAttempted: number;
  modelCreated: number;
  modelDeleted: number;
  modelDeleteAttempted: number;
  dataAttempted: number;
  dataCreated: number;
  dataDeleted: number;
  dataDeleteAttempted: number;
  warningCopies: number;
  warningDeleteAttempted: number;
  warningDeleted: number;
  cleanupErrors: string[];
  lastWarnings: Array<{ number: number | string; lastinfo: number | string }>;
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  full: number;
  fullReturned: number;
};
function newLedger(): Ledger {
  return {
    modelAttempted: 0,
    modelCreated: 0,
    modelDeleted: 0,
    modelDeleteAttempted: 0,
    dataAttempted: 0,
    dataCreated: 0,
    dataDeleted: 0,
    dataDeleteAttempted: 0,
    warningCopies: 0,
    warningDeleteAttempted: 0,
    warningDeleted: 0,
    cleanupErrors: [],
    lastWarnings: [],
    step1: 0,
    step1Returned: 0,
    step2: 0,
    step2Returned: 0,
    full: 0,
    fullReturned: 0,
  };
}
function warnings(data: Pick<Data, 'warning'>, ledger: Ledger) {
  // warning and model.opt are borrowed embedded members. Never delete either wrapper.
  // warning.get(i) returns an owned copy; unlike contact's by-value vector, no vector is owned here.
  const vector = data.warning;
  demand(vector.size() === 7, 'WARNING_VECTOR_WIDTH');
  const values: number[] = [];
  ledger.lastWarnings = [];
  for (let i = 0; i < 7; i++) {
    const item = vector.get(i);
    demand(item, 'WARNING_COPY_MISSING');
    ledger.warningCopies++;
    try {
      ledger.lastWarnings.push({
        number: Number.isFinite(item.number) ? item.number : String(item.number),
        lastinfo: Number.isFinite(item.lastinfo) ? item.lastinfo : String(item.lastinfo),
      });
      demand(Number.isFinite(item.number) && Number.isFinite(item.lastinfo), 'WARNING_NONFINITE');
      values.push(item.number, item.lastinfo);
    } finally {
      ledger.warningDeleteAttempted++;
      try {
        item.delete();
        ledger.warningDeleted++;
      } catch (error) {
        ledger.cleanupErrors.push('warning copy: ' + String(error));
      }
    }
  }
  demand(ledger.cleanupErrors.length === 0, 'WARNING_COPY_RELEASE');
  return values;
}
function copyState(data: Data): State {
  demand(Number.isFinite(data.time), 'NATIVE_TIME_NONFINITE');
  return {
    qpos: numbers(data.qpos, 7, 'QPOS'),
    qvel: numbers(data.qvel, 6, 'QVEL'),
    qacc: numbers(data.qacc, 6, 'QACC'),
    qacc_warmstart: numbers(data.qacc_warmstart, 6, 'WARMSTART'),
    time: data.time,
  };
}
const counts = (data: Data) => [data.ncon, data.nefc, data.ntree_awake];
function inputs(data: Data) {
  numbers(data.ctrl, 0, 'CTRL');
  numbers(data.act, 0, 'ACT');
  return [
    ...numbers(data.qfrc_applied, 6, 'QFRC_APPLIED'),
    ...numbers(data.xfrc_applied, 12, 'XFRC_APPLIED'),
  ];
}
const zero = (v: number[]) => v.every((x) => x === 0);
function constraintForces(data: Data) {
  demand(data.nJ === 0, 'NO_DENSE_CONSTRAINT_ROWS');
  numbers(data.efc_J, 0, 'EFC_J');
  numbers(data.efc_force, 0, 'EFC_FORCE');
  numbers(data.efc_type, 0, 'EFC_TYPE', true);
  numbers(data.efc_id, 0, 'EFC_ID', true);
  return numbers(data.qfrc_constraint, 6, 'QFRC_CONSTRAINT');
}
function modelXml(e: Entry) {
  demand(
    plan().some((p) => key(p) === key(e)),
    'UNREGISTERED_MODEL',
  );
  const inertia = (2 * e.massKg * original.sphereRadiusM ** 2) / 5;
  return [
    '<mujoco model="asa_phy01_current_aot">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false"/>',
    '<option timestep="' +
      e.dtUs / 1e6 +
      '" gravity="0 0 -9.81" integrator="implicitfast" solver="Newton" jacobian="dense" cone="elliptic" iterations="100" tolerance="1e-10" ls_iterations="50" ls_tolerance="0.01" noslip_iterations="20" noslip_tolerance="1e-12" ccd_iterations="100" ccd_tolerance="1e-8" impratio="1" density="0" viscosity="0" wind="0 0 0">',
    '<flag warmstart="enable" island="enable" refsafe="enable" nativeccd="enable" multiccd="enable" diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable" invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/></option>',
    '<default><joint damping="0" armature="0" frictionloss="0" stiffness="0" limited="false"/><geom friction="0 0 0" margin="0" gap="0"/></default>',
    '<worldbody><geom name="floor" type="box" size="5 5 0.01" pos="0 0 -0.01"/>',
    '<body name="falling_sphere" pos="0 0 2" quat="1 0 0 0"><joint name="free" type="free"/>',
    '<inertial pos="0 0 0" quat="1 0 0 0" mass="' +
      e.massKg +
      '" diaginertia="' +
      [inertia, inertia, inertia].join(' ') +
      '"/>',
    '<geom name="sphere" type="sphere" size="0.02"/></body></worldbody></mujoco>',
  ].join('\n');
}
const modelDimensions = {
  nq: 7,
  nv: 6,
  nbody: 2,
  ngeom: 2,
  njnt: 1,
  ntree: 1,
  nu: 0,
  na: 0,
  nplugin: 0,
  nsensor: 0,
  nmocap: 0,
  neq: 0,
  ntendon: 0,
  nflex: 0,
};
const modelArraySizes: Record<string, number> = {
  body_mass: 2,
  body_ipos: 6,
  body_iquat: 8,
  body_inertia: 6,
  body_pos: 6,
  body_quat: 8,
  jnt_type: 1,
  jnt_qposadr: 1,
  jnt_dofadr: 1,
  geom_type: 2,
  geom_bodyid: 2,
  geom_size: 6,
  geom_pos: 6,
  geom_quat: 8,
  geom_friction: 6,
  geom_margin: 2,
  geom_gap: 2,
  geom_surfacevel: 12,
  geom_fluid: 24,
  dof_damping: 6,
  dof_armature: 6,
  dof_frictionloss: 6,
  jnt_stiffness: 1,
  jnt_limited: 1,
  qpos0: 7,
};
function readModel(model: Model, data: Data, ledger: Ledger) {
  const dimensions = modelDimensions;
  for (const [name, value] of Object.entries(dimensions))
    demand(model[name] === value, 'MODEL_COUNT_' + name);
  const sizes = modelArraySizes;
  const integer = new Set(['jnt_type', 'jnt_qposadr', 'jnt_dofadr', 'geom_type', 'geom_bodyid']);
  const arrays = Object.fromEntries(
    Object.entries(sizes).map(([name, size]) => {
      if (name === 'jnt_limited') {
        demand(
          model[name] instanceof Uint8Array && model[name].length === size,
          'JOINT_LIMIT_WIDTH',
        );
        return [name, Array.from(model[name])];
      }
      return [name, numbers(model[name], size, name, integer.has(name))];
    }),
  );
  const options = Object.fromEntries(
    Object.keys(profile)
      .filter((k) => !['gravity', 'wind'].includes(k))
      .map((name) => [name, model.opt[name]]),
  );
  options['timestep'] = model.opt.timestep;
  return {
    dimensions,
    arrays,
    options,
    gravity: numbers(model.opt.gravity, 3, 'GRAVITY'),
    wind: numbers(model.opt.wind, 3, 'WIND'),
    initial: copyState(data),
    warnings: warnings(data, ledger),
    inputs: inputs(data),
    constraintForces: numbers(data.qfrc_constraint, 6, 'INITIAL_CONSTRAINT_FORCE'),
  };
}
type Readback = ReturnType<typeof readModel>;
function validateReadback(r: Readback, e: Entry) {
  demand(
    same(r.dimensions, modelDimensions) &&
      same(Object.keys(r.arrays), Object.keys(modelArraySizes)) &&
      Object.entries(modelArraySizes).every(
        ([name, width]) =>
          Array.isArray(r.arrays[name]) &&
          r.arrays[name]!.length === width &&
          r.arrays[name]!.every(Number.isFinite),
      ),
    'READBACK_ARRAY_DIMENSIONS',
  );
  const a = r.arrays;
  demand(
    same(a.body_ipos, [0, 0, 0, 0, 0, 0]) &&
      same(a.body_iquat, [1, 0, 0, 0, 1, 0, 0, 0]) &&
      same(a.body_pos, [0, 0, 0, 0, 0, 2]) &&
      same(a.body_quat, [1, 0, 0, 0, 1, 0, 0, 0]),
    'MODEL_COM_FRAME',
  );
  const I = (2 * e.massKg * original.sphereRadiusM ** 2) / 5;
  demand(
    a.body_mass![0] === 0 &&
      Math.abs(a.body_mass![1]! - e.massKg) <= e.massKg * 1e-6 &&
      zero(a.body_inertia!.slice(0, 3)) &&
      a.body_inertia!.slice(3).every((v) => Math.abs(v - I) <= I * 1e-6),
    'MODEL_MASS_INERTIA',
  );
  for (const [name, expected] of Object.entries({
    jnt_type: [0],
    jnt_qposadr: [0],
    jnt_dofadr: [0],
    geom_type: [6, 2],
    geom_bodyid: [0, 1],
    geom_size: [5, 5, 0.01, 0.02, 0, 0],
    geom_pos: [0, 0, -0.01, 0, 0, 0],
    geom_quat: [1, 0, 0, 0, 1, 0, 0, 0],
    qpos0: original.initialQpos,
    jnt_limited: [0],
  }))
    demand(same(a[name], expected), 'MODEL_' + name);
  for (const name of [
    'geom_friction',
    'geom_margin',
    'geom_gap',
    'geom_surfacevel',
    'dof_damping',
    'dof_armature',
    'dof_frictionloss',
    'jnt_stiffness',
  ])
    demand(zero(a[name]!), 'MODEL_ZERO_' + name);
  const options = Object.fromEntries(
    Object.entries(profile).filter(([k]) => k !== 'gravity' && k !== 'wind'),
  );
  demand(
    same(r.options, { ...options, timestep: e.dtUs / 1e6 }) &&
      same(r.gravity, original.gravity) &&
      same(r.wind, [0, 0, 0]),
    'MODEL_PROFILE',
  );
  demand(
    same(r.initial.qpos, original.initialQpos) &&
      same(r.initial.qvel, original.initialQvel) &&
      r.initial.time === 0 &&
      zero(r.warnings) &&
      zero(r.inputs) &&
      zero(r.constraintForces),
    'MODEL_INITIAL_STATE',
  );
}

type Frame = {
  world: number;
  tick: number;
  mode: 'split' | 'full';
  pre: State;
  phase: State | null;
  post: State;
  phaseWarnings: number[] | null;
  postWarnings: number[];
  beforeInputs: number[];
  afterInputs: number[];
  phaseCounts: number[] | null;
  postCounts: number[];
  phaseConstraint: number[] | null;
  postConstraint: number[];
};
const schema = {
  version: 'ASA_PHY01_CURRENT_AOT_LE_V1',
  recordBytes: 1280,
  header: { world: 0, tick: 4, mode: 8, reserved: 12 },
  stateOrder: ['qpos7', 'qvel6', 'qacc6', 'qacc_warmstart6', 'time1'],
  pre: 16,
  phase: 224,
  post: 432,
  phaseWarnings: 640,
  postWarnings: 752,
  beforeInputs: 864,
  afterInputs: 1008,
  phaseCounts: 1152,
  postCounts: 1164,
  phaseConstraint: 1176,
  postConstraint: 1224,
  zeroPadding: 1272,
  inputsOrder: ['qfrc_applied6', 'xfrc_applied12'],
  countsOrder: ['ncon', 'nefc', 'ntree_awake'],
  warningsOrder: 'seven ordered (number,lastinfo) F64LE pairs',
  absentPhase:
    'full mode has no STEP1 call: all corresponding phase slots are zero, not an observed state',
};
function encode(frame: Frame) {
  const b = Buffer.alloc(schema.recordBytes);
  b.writeUInt32LE(frame.world, 0);
  b.writeUInt32LE(frame.tick, 4);
  b.writeUInt32LE(frame.mode === 'split' ? 1 : 2, 8);
  const put = (values: number[], offset: number, n: number) => {
    demand(values.length === n, 'RAW_WIDTH');
    float64Bytes(values).copy(b, offset);
  };
  stateBytes(frame.pre).copy(b, schema.pre);
  stateBytes(frame.post).copy(b, schema.post);
  if (frame.phase) stateBytes(frame.phase).copy(b, schema.phase);
  if (frame.phaseWarnings) put(frame.phaseWarnings, schema.phaseWarnings, 14);
  put(frame.postWarnings, schema.postWarnings, 14);
  put(frame.beforeInputs, schema.beforeInputs, 18);
  put(frame.afterInputs, schema.afterInputs, 18);
  [frame.phaseCounts, frame.postCounts].forEach((values, idx) => {
    if (values) {
      demand(
        values.length === 3 && values.every((v) => Number.isSafeInteger(v) && v >= 0),
        'RAW_COUNTS',
      );
      values.forEach((v, i) =>
        b.writeUInt32LE(v, (idx ? schema.postCounts : schema.phaseCounts) + 4 * i),
      );
    }
  });
  if (frame.phaseConstraint) put(frame.phaseConstraint, schema.phaseConstraint, 6);
  put(frame.postConstraint, schema.postConstraint, 6);
  return b;
}
function decode(b: Buffer): Frame {
  demand(
    b.length === schema.recordBytes &&
      b.readUInt32LE(12) === 0 &&
      b.subarray(1272).every((v) => v === 0),
    'RAW_FRAME_SIZE_RESERVED',
  );
  const mode = b.readUInt32LE(8);
  demand(mode === 1 || mode === 2, 'RAW_MODE');
  const read = (off: number, n: number) => {
    const v = Array.from({ length: n }, (_, i) => b.readDoubleLE(off + 8 * i));
    demand(v.every(Number.isFinite), 'RAW_NONFINITE');
    return v;
  };
  const state = (off: number): State => {
    const v = read(off, 26);
    return {
      qpos: v.slice(0, 7),
      qvel: v.slice(7, 13),
      qacc: v.slice(13, 19),
      qacc_warmstart: v.slice(19, 25),
      time: v[25]!,
    };
  };
  const integer = (off: number) => [
    b.readUInt32LE(off),
    b.readUInt32LE(off + 4),
    b.readUInt32LE(off + 8),
  ];
  if (mode === 2)
    demand(
      b.subarray(schema.phase, schema.post).every((v) => v === 0) &&
        b.subarray(schema.phaseWarnings, schema.postWarnings).every((v) => v === 0) &&
        b.subarray(schema.phaseCounts, schema.postCounts).every((v) => v === 0) &&
        b.subarray(schema.phaseConstraint, schema.postConstraint).every((v) => v === 0),
      'FULL_HAS_FALSE_PHASE',
    );
  return {
    world: b.readUInt32LE(0),
    tick: b.readUInt32LE(4),
    mode: mode === 1 ? 'split' : 'full',
    pre: state(schema.pre),
    phase: mode === 1 ? state(schema.phase) : null,
    post: state(schema.post),
    phaseWarnings: mode === 1 ? read(schema.phaseWarnings, 14) : null,
    postWarnings: read(schema.postWarnings, 14),
    beforeInputs: read(schema.beforeInputs, 18),
    afterInputs: read(schema.afterInputs, 18),
    phaseCounts: mode === 1 ? integer(schema.phaseCounts) : null,
    postCounts: integer(schema.postCounts),
    phaseConstraint: mode === 1 ? read(schema.phaseConstraint, 6) : null,
    postConstraint: read(schema.postConstraint, 6),
  };
}
function validPhaseCounts(value: number[] | null) {
  // The inherited contract requires no STEP1 contacts/rows; awake is a POST-endpoint gate.
  // Preserve the actual intermediate awake count without inventing another physical gate.
  return (
    value?.length === 3 && value[0] === 0 && value[1] === 0 && (value[2] === 0 || value[2] === 1)
  );
}
function failureObservation(data: Data) {
  const out: Record<string, unknown> = {};
  for (const field of [
    'time',
    'ncon',
    'nefc',
    'nJ',
    'ntree_awake',
    ...stateFields,
    'ctrl',
    'act',
    'qfrc_applied',
    'xfrc_applied',
    'qfrc_constraint',
  ]) {
    try {
      const value = data[field];
      out[field] = ArrayBuffer.isView(value)
        ? Array.from(value as Float64Array).map((v) =>
            Number.isFinite(v) ? (Object.is(v, -0) ? 'float64:-0' : v) : String(v),
          )
        : value;
    } catch (error) {
      out[field] = { readError: String(error) };
    }
  }
  return out;
}
function validateFrame(frame: Frame, e: Entry, world: number, tick: number, previous: State) {
  demand(frame.world === world && frame.tick === tick && frame.mode === e.mode, 'FRAME_IDENTITY');
  demand(stateBytes(frame.pre).equals(stateBytes(previous)), 'FRAME_CONTINUITY');
  if (e.mode === 'split') {
    demand(
      frame.phase && stateBytes(frame.pre, true).equals(stateBytes(frame.phase, true)),
      'STEP1_PRESERVATION',
    );
    demand(
      validPhaseCounts(frame.phaseCounts) &&
        frame.phaseWarnings &&
        zero(frame.phaseWarnings) &&
        frame.phaseConstraint &&
        zero(frame.phaseConstraint),
      'STEP1_CONTACT_WARNING_CONSTRAINT',
    );
  } else
    demand(
      !frame.phase && !frame.phaseWarnings && !frame.phaseCounts && !frame.phaseConstraint,
      'FULL_FALSE_SPLIT',
    );
  demand(
    same(frame.postCounts, [0, 0, 1]) &&
      zero(frame.postWarnings) &&
      zero(frame.beforeInputs) &&
      zero(frame.afterInputs) &&
      zero(frame.postConstraint),
    'ENDPOINT_CONTACT_WARNING_INPUT',
  );
  const s = frame.post;
  stateBytes(s);
  demand(same(s.qpos.slice(3), [1, 0, 0, 0]) && zero(s.qvel.slice(3)), 'ENDPOINT_ROTATION');
  demand(
    Math.abs(s.time - (tick * e.dtUs) / 1e6) <= nativeTimeBudget(tick, e.dtUs),
    'INTEGER_NATIVE_CLOCK',
  );
  demand(s.qpos[2]! - 0.02 > 0, 'CONTACT_FREE_CLEARANCE');
}
type Sample = {
  timeUs: number;
  position: number[];
  velocity: number[];
  positionErrorM: number;
  velocityErrorMps: number;
  positionToleranceM: number;
  velocityToleranceMps: number;
  expectedSemiImplicitPositionErrorM: number;
  pass: boolean;
};
function sample(s: State, e: Entry, tick: number): Sample {
  const timeUs = tick * e.dtUs,
    oracle = analyticalAt(timeUs);
  const position = s.qpos.slice(0, 3),
    velocity = s.qvel.slice(0, 3);
  const positionErrorM = norm(
    difference(difference(position, original.initialQpos.slice(0, 3)), oracle.displacement),
  );
  const velocityErrorMps = norm(difference(velocity, oracle.velocity));
  return {
    timeUs,
    position,
    velocity,
    positionErrorM,
    velocityErrorMps,
    positionToleranceM: oracle.positionToleranceM,
    velocityToleranceMps: oracle.velocityToleranceMps,
    expectedSemiImplicitPositionErrorM:
      (norm(original.gravity) * (timeUs / 1e6) * (e.dtUs / 1e6)) / 2,
    pass:
      positionErrorM <= oracle.positionToleranceM &&
      velocityErrorMps <= oracle.velocityToleranceMps,
  };
}
type Run = Entry & {
  samples: Sample[];
  stateDigests: string[];
  trajectorySha256: string;
  warningSha256: string;
};
function summarize(e: Entry, frames: Frame[], initial: State, world: number): Run {
  demand(frames.length === 400000 / e.dtUs, 'INCOMPLETE_WORLD');
  const samples: Sample[] = [],
    stateDigests: string[] = [],
    trajectory = createHash('sha256'),
    warning = createHash('sha256');
  let previous = initial;
  frames.forEach((v, i) => {
    validateFrame(v, e, world, i + 1, previous);
    previous = v.post;
    const digest = hash(stateBytes(v.post));
    stateDigests.push(digest);
    trajectory.update(Buffer.from(digest, 'hex'));
    warning.update(float64Bytes(v.postWarnings));
    if (original.sampleTimesUs.includes((i + 1) * e.dtUs)) samples.push(sample(v.post, e, i + 1));
  });
  demand(samples.length === 4, 'FOUR_ANALYTIC_SAMPLES');
  return {
    ...e,
    samples,
    stateDigests,
    trajectorySha256: trajectory.digest('hex'),
    warningSha256: warning.digest('hex'),
  };
}
function receiptRun(run: Run) {
  return { ...run, stateDigests: undefined };
}
function receiptAssessment(value: ReturnType<typeof assess>) {
  return { ...value, runs: value.runs.map(receiptRun) };
}
function assess(runs: Run[]) {
  demand(
    runs.length === 20 &&
      new Set(runs.map(key)).size === 20 &&
      same(runs.map(key), plan().map(key)),
    'EXACT_TWENTY_WORLDS',
  );
  const failures: string[] = [],
    convergence: unknown[] = [],
    massIndependence: unknown[] = [],
    repeatability: unknown[] = [],
    phaseParity: unknown[] = [];
  const byKey = new Map(runs.map((r) => [key(r), r]));
  for (const r of runs) {
    demand(r.samples.length === 4 && r.stateDigests.length === 400000 / r.dtUs, 'ASSESS_COMPLETE');
    for (const s of r.samples)
      if (!s.pass) failures.push('analytical tolerance exceeded ' + key(r) + '/' + s.timeUs);
  }
  for (const massKg of original.massesKg)
    for (let repeat = 0; repeat < 3; repeat++) {
      const a = byKey.get(key({ mode: 'split', massKg, dtUs: 500, repeat }))!,
        b = byKey.get(key({ mode: 'split', massKg, dtUs: 250, repeat }))!;
      const coarseSquared = a.samples.reduce((s, v) => s + v.positionErrorM ** 2, 0),
        refinedSquared = b.samples.reduce((s, v) => s + v.positionErrorM ** 2, 0);
      const distances = a.samples.map((v, i) => ({
        timeUs: v.timeUs,
        distanceM: norm(difference(v.position, b.samples[i]!.position)),
        toleranceM: v.positionToleranceM,
      }));
      const pass =
        refinedSquared <= coarseSquared && distances.every((v) => v.distanceM <= v.toleranceM);
      if (!pass) failures.push('step convergence failed');
      convergence.push({ massKg, repeat, coarseSquared, refinedSquared, distances, pass });
    }
  for (const dtUs of original.nativeStepUs)
    for (const massKg of original.massesKg) {
      const base = byKey.get(key({ mode: 'split', massKg, dtUs, repeat: 0 }))!;
      const pass = [0, 1, 2].every((repeat) => {
        const v = byKey.get(key({ mode: 'split', massKg, dtUs, repeat }))!;
        return (
          v.trajectorySha256 === base.trajectorySha256 &&
          same(v.stateDigests, base.stateDigests) &&
          v.warningSha256 === base.warningSha256
        );
      });
      if (!pass) failures.push('bitwise repeatability mismatch');
      repeatability.push({ massKg, dtUs, pass });
    }
  for (const dtUs of original.nativeStepUs)
    for (let repeat = 0; repeat < 3; repeat++)
      for (let i = 0; i < 4; i++) {
        const samples = original.massesKg.map(
          (massKg) => byKey.get(key({ mode: 'split', massKg, dtUs, repeat }))!.samples[i]!,
        );
        let positionSpreadM = 0,
          velocitySpreadMps = 0;
        for (const a of samples)
          for (const b of samples) {
            positionSpreadM = Math.max(positionSpreadM, norm(difference(a.position, b.position)));
            velocitySpreadMps = Math.max(
              velocitySpreadMps,
              norm(difference(a.velocity, b.velocity)),
            );
          }
        const oracle = analyticalAt(original.sampleTimesUs[i]!);
        const pass =
          positionSpreadM <= oracle.positionToleranceM &&
          velocitySpreadMps <= oracle.velocityToleranceMps;
        if (!pass) failures.push('mass independence failed');
        massIndependence.push({
          dtUs,
          repeat,
          timeUs: original.sampleTimesUs[i],
          positionSpreadM,
          velocitySpreadMps,
          pass,
        });
      }
  for (const dtUs of original.nativeStepUs) {
    const a = byKey.get(key({ mode: 'split', massKg: 0.5, dtUs, repeat: 0 }))!,
      b = byKey.get(key({ mode: 'full', massKg: 0.5, dtUs, repeat: 0 }))!;
    const firstMismatch = a.stateDigests.findIndex((s, i) => s !== b.stateDigests[i]);
    const pass = firstMismatch === -1 && a.warningSha256 === b.warningSha256;
    if (!pass) failures.push('split/full native phase parity mismatch');
    phaseParity.push({ dtUs, comparedNativeSteps: a.stateDigests.length, firstMismatch, pass });
  }
  return {
    verdict: failures.length ? 'FAIL' : 'PASS',
    failures,
    analyticMainSamples: runs
      .filter((r) => r.mode === 'split')
      .reduce((n, r) => n + r.samples.length, 0),
    analyticReferenceSamples: runs
      .filter((r) => r.mode === 'full')
      .reduce((n, r) => n + r.samples.length, 0),
    convergence,
    massIndependence,
    repeatability,
    phaseParity,
    runs,
  };
}

type Pin = { bytes: number; sha256: string };
function pinnedBytes(bytes: Buffer, pin: Pin) {
  demand(bytes.length === pin.bytes && hash(bytes) === pin.sha256, 'PINNED_BYTES');
  return bytes;
}
function pinned(path: string, pin: Pin) {
  const st = lstatSync(path);
  demand(st.isFile() && !st.isSymbolicLink(), 'REGULAR_PINNED_FILE');
  return pinnedBytes(readFileSync(path), pin);
}
function historyAdmission() {
  for (const item of f.historical.blobs)
    pinnedBytes(
      execFileSync('git', ['show', f.historical.commit + ':' + item.path], {
        cwd: repo,
        maxBuffer: 1 << 20,
      }),
      item,
    );
  demand(
    hash(readFileSync(join(repo, f.specification.currentPath))) === f.specification.currentSha256 &&
      hash(readFileSync(join(repo, f.specification.archivePath))) === f.specification.archiveSha256,
    'CURRENT_AND_ARCHIVED_SPEC_PINS',
  );
  return f.historical.blobs;
}
function sourceAdmission() {
  return [
    [fixtureUrl, 'ASA_PHY01_CURRENT_FIXTURE_SHA256'],
    [sourceUrl, 'ASA_PHY01_CURRENT_SOURCE_SHA256'],
  ].map(([url, k]) => {
    const expected = process.env[k as string] ?? '';
    demand(/^[a-f0-9]{64}$/.test(expected), 'EXPLICIT_SOURCE_SHA');
    const b = readFileSync(url as URL);
    demand(hash(b) === expected, 'SOURCE_SHA');
    return {
      file: fileURLToPath(url as URL)
        .split(sep)
        .at(-1),
      bytes: b.length,
      sha256: expected,
    };
  });
}
function engineAdmission(path: string, license: string) {
  demand(
    isAbsolute(path) && realpathSync(path) === resolve(path) && isAbsolute(license),
    'ABSOLUTE_PINNED_ENGINE',
  );
  const e = f.engine,
    glue = pinned(join(path, e.glue.file), e.glue),
    wasm = pinned(join(path, e.wasm.file), e.wasm),
    declarations = pinned(join(path, e.declarations.file), e.declarations);
  pinned(license, e.license);
  const build = pinned(join(dirname(path), 'build-receipt.json'), e.buildReceipt),
    browser = pinned(join(dirname(path), 'browser-receipt.json'), e.browserReceipt);
  demand(
    JSON.parse(build.toString()).accepted === true &&
      JSON.parse(browser.toString()).accepted === true &&
      JSON.parse(browser.toString()).buildReceiptSha256 === e.buildReceipt.sha256,
    'ACCEPTED_ENGINE_RECEIPTS',
  );
  demand(wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { path, glue, wasm, declarations };
}
type Initialization = { attempted: number; returned: number; phase: string };
async function loadNative(
  input: ReturnType<typeof engineAdmission>,
  initialization: Initialization,
) {
  demand(
    process.env['ASA_PHY01_CURRENT_RUN'] === 'twenty-frozen-worlds-1071',
    'EXPLICIT_NATIVE_OPT_IN',
  );
  demand(initialization.attempted === 0, 'ONE_MODULE_ONLY');
  initialization.attempted++;
  initialization.phase = 'glue-import';
  const path = join(input.path, f.engine.glue.file);
  pinned(path, f.engine.glue);
  const { default: factory } = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as {
    default(o: { wasmBinary: Buffer; locateFile(n: string): string }): Promise<Native>;
  };
  pinned(path, f.engine.glue);
  initialization.phase = 'module-factory';
  const M = await factory({
    wasmBinary: input.wasm,
    locateFile(n) {
      demand(n === 'mujoco.wasm', 'UNREGISTERED_NATIVE_RESOURCE');
      return join(input.path, n);
    },
  });
  initialization.returned++;
  initialization.phase = 'version-readback';
  demand(M.mj_version() === 4000000 && M.mj_versionString() === '4.0.0', 'EXACT_NATIVE_VERSION');
  return M;
}
function outputRoot(path: string) {
  demand(isAbsolute(path), 'ABSOLUTE_OUTPUT');
  const p = realpathSync(path),
    t = realpathSync(tmpdir()),
    rel = relative(t, p),
    inside = relative(repo, p);
  demand(
    p === resolve(path) &&
      rel !== '' &&
      !isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('..' + sep) &&
      (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)),
    'EXISTING_EXTERNAL_TEMP_OUTPUT',
  );
  return p;
}
const names = {
  meta: 'mujoco-phy01-current-artifact.jsonl',
  binary: 'mujoco-phy01-current-artifact.bin',
};
class Journal {
  readonly meta: number;
  readonly bin: number;
  bytes = 0;
  metadataBytes = 0;
  emergencyBytes = 0;
  readonly digest = createHash('sha256');
  constructor(readonly root: string) {
    this.meta = openSync(join(root, names.meta), 'wx', 0o600);
    try {
      this.bin = openSync(join(root, names.binary), 'wx', 0o600);
    } catch (error) {
      try {
        writeSync(
          this.meta,
          JSON.stringify({ kind: 'admission-error', error: String(error), nativeCalls: 0 }) + '\n',
        );
        fsyncSync(this.meta);
      } finally {
        closeSync(this.meta);
      }
      throw error;
    }
  }
  write(v: unknown, emergency = false) {
    const b = Buffer.from(
      JSON.stringify(v, (_k, x: unknown) =>
        typeof x === 'number' && Object.is(x, -0) ? 'float64:-0' : x,
      ) + '\n',
    );
    demand(
      (emergency ? this.emergencyBytes : this.metadataBytes) + b.length <=
        (emergency ? f.raw.emergencyBytes : f.raw.metadataBytes),
      'METADATA_CAP',
    );
    demand(writeSync(this.meta, b) === b.length, 'METADATA_SHORT_WRITE');
    if (emergency) this.emergencyBytes += b.length;
    else this.metadataBytes += b.length;
  }
  reserve() {
    demand(
      this.bytes + schema.recordBytes + f.raw.metadataBytes + f.raw.emergencyBytes <=
        f.raw.totalBytes,
      'RAW_CAP_BEFORE_DISPATCH',
    );
  }
  frame(b: Buffer) {
    demand(
      b.length === schema.recordBytes && writeSync(this.bin, b) === b.length,
      'RAW_SHORT_WRITE',
    );
    this.digest.update(b);
    this.bytes += b.length;
  }
  close() {
    const errors: string[] = [];
    for (const [label, fd] of [
      ['binary', this.bin],
      ['metadata', this.meta],
    ] as const) {
      try {
        fsyncSync(fd);
      } catch (e) {
        errors.push(label + ' sync ' + String(e));
      }
      try {
        closeSync(fd);
      } catch (e) {
        errors.push(label + ' close ' + String(e));
      }
    }
    return errors;
  }
}
function validateLedger(ledger: Ledger, e: Entry) {
  const steps = 400000 / e.dtUs;
  demand(
    ledger.modelAttempted === 1 &&
      ledger.modelCreated === 1 &&
      ledger.modelDeleteAttempted === 1 &&
      ledger.modelDeleted === 1 &&
      ledger.dataAttempted === 1 &&
      ledger.dataCreated === 1 &&
      ledger.dataDeleteAttempted === 1 &&
      ledger.dataDeleted === 1 &&
      ledger.step1 === (e.mode === 'split' ? steps : 0) &&
      ledger.step1Returned === ledger.step1 &&
      ledger.step2 === ledger.step1 &&
      ledger.step2Returned === ledger.step2 &&
      ledger.full === (e.mode === 'full' ? steps : 0) &&
      ledger.fullReturned === ledger.full &&
      ledger.warningCopies === 7 * (1 + (e.mode === 'split' ? 2 : 1) * steps) &&
      ledger.warningCopies === ledger.warningDeleteAttempted &&
      ledger.warningCopies === ledger.warningDeleted &&
      ledger.cleanupErrors.length === 0,
    'EXACT_WORLD_RESOURCE_LEDGER',
  );
}
type Totals = {
  models: number;
  data: number;
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  full: number;
  fullReturned: number;
};
function runWorld(M: Native, e: Entry, world: number, journal: Journal, totals: Totals): Run {
  const ledger = newLedger();
  let model: Model | undefined,
    data: Data | undefined,
    initial: Readback | undefined,
    pending: Partial<Frame> | undefined;
  let primary: unknown,
    observedFailure: Record<string, unknown> | undefined,
    stage = 'before-model',
    result: Run | undefined;
  const frames: Frame[] = [];
  const startOffset = journal.bytes;
  try {
    demand(world < 20 && totals.models < 20, 'WORLD_MODEL_CAP');
    stage = 'model-construction';
    ledger.modelAttempted++;
    model = M.MjModel.from_xml_string(modelXml(e));
    ledger.modelCreated++;
    totals.models++;
    stage = 'data-construction';
    ledger.dataAttempted++;
    data = new M.MjData(model);
    ledger.dataCreated++;
    totals.data++;
    stage = 'factory-readback';
    initial = readModel(model, data, ledger);
    journal.write({
      kind: 'world-start',
      world,
      entry: e,
      xmlSha256: hash(modelXml(e)),
      startOffset,
      readback: initial,
    });
    validateReadback(initial, e);
    let previous = initial.initial;
    for (let tick = 1; tick <= 400000 / e.dtUs; tick++) {
      stage = 'pre-dispatch';
      demand(tick <= 1600 && totals.step2 + totals.full < 24000, 'NATIVE_ADVANCE_CAP');
      journal.reserve();
      const pre = copyState(data),
        beforeInputs = inputs(data);
      demand(zero(beforeInputs), 'PRE_NONZERO_INPUT');
      demand(stateBytes(pre).equals(stateBytes(previous)), 'LIVE_CONTINUITY');
      pending = { world, tick, mode: e.mode, pre, beforeInputs };
      let phase: State | null = null,
        phaseWarnings: number[] | null = null,
        phaseCounts: number[] | null = null,
        phaseConstraint: number[] | null = null;
      if (e.mode === 'split') {
        stage = 'step1';
        ledger.step1++;
        totals.step1++;
        M.mj_step1(model, data);
        ledger.step1Returned++;
        totals.step1Returned++;
        phase = copyState(data);
        phaseWarnings = warnings(data, ledger);
        phaseCounts = counts(data);
        phaseConstraint = constraintForces(data);
        Object.assign(pending, { phase, phaseWarnings, phaseCounts, phaseConstraint });
        demand(stateBytes(pre, true).equals(stateBytes(phase, true)), 'LIVE_STEP1_PRESERVATION');
        demand(
          validPhaseCounts(phaseCounts) &&
            zero(phaseWarnings) &&
            zero(phaseConstraint) &&
            zero(inputs(data)),
          'LIVE_STEP1_INVARIANTS',
        );
        stage = 'step2';
        ledger.step2++;
        totals.step2++;
        M.mj_step2(model, data);
        ledger.step2Returned++;
        totals.step2Returned++;
      } else {
        stage = 'full-step';
        ledger.full++;
        totals.full++;
        M.mj_step(model, data);
        ledger.fullReturned++;
        totals.fullReturned++;
      }
      stage = 'endpoint-capture';
      const post = copyState(data);
      Object.assign(pending, { post });
      const postWarnings = warnings(data, ledger),
        postCounts = counts(data),
        afterInputs = inputs(data),
        postConstraint = constraintForces(data);
      const frame: Frame = {
        world,
        tick,
        mode: e.mode,
        pre,
        phase,
        post,
        phaseWarnings,
        postWarnings,
        beforeInputs,
        afterInputs,
        phaseCounts,
        postCounts,
        phaseConstraint,
        postConstraint,
      };
      pending = frame;
      const encoded = encode(frame);
      journal.frame(encoded);
      frames.push(frame);
      stage = 'endpoint-invariants';
      validateFrame(frame, e, world, tick, previous);
      previous = post;
      pending = undefined;
    }
    result = summarize(e, frames, initial.initial, world);
    stage = 'complete';
  } catch (error) {
    primary = error;
    if (data) observedFailure = failureObservation(data);
  }
  for (const [kind, handle] of [
    ['data', data],
    ['model', model],
  ] as const) {
    if (!handle) continue;
    try {
      if (kind === 'data') ledger.dataDeleteAttempted++;
      else ledger.modelDeleteAttempted++;
      handle.delete();
      if (kind === 'data') ledger.dataDeleted++;
      else ledger.modelDeleted++;
    } catch (error) {
      ledger.cleanupErrors.push(kind + ': ' + String(error));
    }
  }
  try {
    journal.write(
      {
        kind: 'world-resources',
        world,
        entry: e,
        stage,
        ledger,
        retainedFrames: frames.length,
        endOffset: journal.bytes,
        primary: primary ? String(primary) : null,
        pending: primary ? pending : undefined,
        failureObservation: observedFailure,
      },
      true,
    );
  } catch (receiptError) {
    ledger.cleanupErrors.push('resource receipt: ' + String(receiptError));
    primary ??= receiptError;
  }
  if (primary || ledger.cleanupErrors.length)
    throw Object.assign(
      primary instanceof Error
        ? primary
        : new Error(primary ? String(primary) : 'NATIVE_CLEANUP_ERROR'),
      { nativeLedger: ledger },
    );
  validateLedger(ledger, e);
  demand(
    result &&
      ledger.modelCreated === 1 &&
      ledger.modelDeleted === 1 &&
      ledger.dataCreated === 1 &&
      ledger.dataDeleted === 1 &&
      ledger.warningCopies === ledger.warningDeleted &&
      ledger.warningDeleteAttempted === ledger.warningCopies,
    'WORLD_RESOURCE_BALANCE',
  );
  journal.write({
    kind: 'world-end',
    world,
    entry: e,
    startOffset,
    endOffset: journal.bytes,
    run: receiptRun(result),
  });
  return result;
}
function replay(root: string, live: Run[]) {
  const bytes = readFileSync(join(root, names.binary));
  const lines = readFileSync(join(root, names.meta), 'utf8')
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line, (_k, v: unknown) => (v === 'float64:-0' ? -0 : v)) as Record<
          string,
          unknown
        >,
    );
  demand(bytes.length === 24000 * 1280, 'COMPLETE_BINARY_WIDTH');
  let offset = 0;
  const runs: Run[] = [];
  for (const [world, e] of plan().entries()) {
    const start = lines.find((v) => v.kind === 'world-start' && v.world === world),
      end = lines.find((v) => v.kind === 'world-end' && v.world === world);
    demand(start && end && start.startOffset === offset, 'REPLAY_WORLD_START');
    const r = start.readback as Readback;
    validateReadback(r, e);
    const resources = lines.find((v) => v.kind === 'world-resources' && v.world === world);
    demand(
      resources &&
        resources.stage === 'complete' &&
        resources.primary === null &&
        resources.retainedFrames === 400000 / e.dtUs,
      'REPLAY_COMPLETE_RESOURCES',
    );
    validateLedger(resources.ledger as Ledger, e);
    const frames: Frame[] = [];
    for (let n = 0; n < 400000 / e.dtUs; n++) {
      demand(offset + 1280 <= bytes.length, 'TRUNCATED_BINARY');
      frames.push(decode(bytes.subarray(offset, offset + 1280)));
      offset += 1280;
    }
    const reconstructed = summarize(e, frames, r.initial, world);
    demand(
      end.endOffset === offset &&
        same(end.run, receiptRun(reconstructed)) &&
        same(live[world], reconstructed),
      'REPLAY_DERIVED_WORLD',
    );
    runs.push(reconstructed);
  }
  demand(offset === bytes.length, 'TRAILING_BINARY');
  return assess(runs);
}

it('pins the historical contract and preserves the twenty-world/24000-advance plan without native', () => {
  validateFixture();
  expect(plan()).toHaveLength(20);
  expect(plan().reduce((n, e) => n + 400000 / e.dtUs, 0)).toBe(24000);
  expect(plan().filter((e) => e.mode === 'split')).toHaveLength(18);
  expect(analyticalAt(100000).positionToleranceM).toBeCloseTo(0.0004905, 12);
  expect(nativeTimeBudget(1600, 250)).toBeGreaterThan(1.4e-13);
  expect(nativeTimeBudget(1600, 250)).toBeLessThan(1.5e-13);
  expect(24000 * schema.recordBytes + f.raw.metadataBytes + f.raw.emergencyBytes).toBeLessThan(
    f.raw.totalBytes,
  );
});
it('rejects changed profile, tolerance, schedule, specification and artifact before initialization', () => {
  for (const mutate of [
    (v: typeof f) => {
      v.profile.tolerance = 1e-8;
    },
    (v: typeof f) => {
      v.historical.fixtureUtf8 = v.historical.fixtureUtf8.replace('0.01,', '0.1,');
    },
    (v: typeof f) => {
      v.historical.fixtureUtf8 = v.historical.fixtureUtf8.replace('500,', '1000,');
    },
    (v: typeof f) => {
      v.specification.currentSha256 = '0'.repeat(64);
    },
    (v: typeof f) => {
      v.engine.wasm.sha256 = '0'.repeat(64);
    },
    (v: typeof f) => {
      v.raw.totalBytes *= 2;
    },
  ]) {
    const v = structuredClone(f);
    mutate(v);
    expect(() => validateFixture(v)).toThrow();
  }
  expect(() => pinnedBytes(Buffer.alloc(0), f.engine.wasm)).toThrow();
  expect(() => pinnedBytes(Buffer.alloc(10), f.engine.wasm)).toThrow();
  expect(() => assess([])).toThrow();
  expect(() => float64Bytes([NaN])).toThrow();
  expect(float64Bytes([0]).equals(float64Bytes([-0]))).toBe(false);
});
function syntheticWorld(e: Entry, world: number): { initial: State; frames: Frame[] } {
  const initial: State = {
    qpos: [0, 0, 2, 1, 0, 0, 0],
    qvel: Array<number>(6).fill(0),
    qacc: Array<number>(6).fill(0),
    qacc_warmstart: Array<number>(6).fill(0),
    time: 0,
  };
  const frames: Frame[] = [];
  let previous = initial;
  const dt = e.dtUs / 1e6;
  for (let tick = 1; tick <= 400000 / e.dtUs; tick++) {
    const phase = structuredClone(previous);
    phase.qacc = [0, 0, -9.81, 0, 0, 0];
    const post = structuredClone(phase);
    post.time = (tick * e.dtUs) / 1e6;
    post.qvel[2] = -9.81 * post.time;
    post.qpos[2] = 2 - (9.81 * post.time * (post.time + dt)) / 2;
    post.qacc_warmstart = [0, 0, -9.81, 0, 0, 0];
    frames.push({
      world,
      tick,
      mode: e.mode,
      pre: previous,
      phase: e.mode === 'split' ? phase : null,
      post,
      phaseWarnings: e.mode === 'split' ? Array<number>(14).fill(0) : null,
      postWarnings: Array<number>(14).fill(0),
      beforeInputs: Array<number>(18).fill(0),
      afterInputs: Array<number>(18).fill(0),
      phaseCounts: e.mode === 'split' ? [0, 0, 1] : null,
      postCounts: [0, 0, 1],
      phaseConstraint: e.mode === 'split' ? Array<number>(6).fill(0) : null,
      postConstraint: Array<number>(6).fill(0),
    });
    previous = post;
  }
  return { initial, frames };
}
it('losslessly retains phase/full states and signed zero; rejects warning, force, phase and nonfinite mutations', () => {
  const e = plan()[0]!,
    s = syntheticWorld(e, 0),
    v = s.frames[0]!;
  v.pre.qvel[0] = -0;
  expect(encode(decode(encode(v)))).toEqual(encode(v));
  for (const mutate of [
    (v: Frame) => {
      v.postWarnings[0] = 1;
    },
    (v: Frame) => {
      v.afterInputs[0] = 1;
    },
    (v: Frame) => {
      v.phase!.qpos[0] = 0.1;
    },
    (v: Frame) => {
      v.postCounts[0] = 1;
    },
    (v: Frame) => {
      v.postConstraint[0] = 1;
    },
  ]) {
    const bad = structuredClone(v);
    mutate(bad);
    expect(() => validateFrame(bad, e, 0, 1, bad.pre)).toThrow();
  }
  const bad = encode(v);
  bad.writeDoubleLE(NaN, schema.post);
  expect(() => decode(bad)).toThrow();
  const full = syntheticWorld(plan()[18]!, 18).frames[0]!;
  expect(decode(encode(full)).phase).toBeNull();
  const forged = encode(full);
  forged.writeDoubleLE(1, schema.phase);
  expect(() => decode(forged)).toThrow();
});
it('runs original analytic, convergence, mass, repeat and every-step split/full oracle on pure synthetic records', () => {
  const runs = plan().map((e, i) => {
    const s = syntheticWorld(e, i);
    return summarize(e, s.frames, s.initial, i);
  });
  const good = assess(runs);
  expect(good.verdict).toBe('PASS');
  expect([
    good.analyticMainSamples,
    good.analyticReferenceSamples,
    good.convergence.length,
    good.massIndependence.length,
    good.repeatability.length,
    good.phaseParity.length,
  ]).toEqual([72, 8, 9, 24, 6, 2]);
  const bad = structuredClone(runs);
  bad[18]!.stateDigests[0] = 'f'.repeat(64);
  expect(assess(bad).verdict).toBe('FAIL');
  const duplicate = structuredClone(runs);
  duplicate[1] = duplicate[0]!;
  expect(() => assess(duplicate)).toThrow();
  const incorrect = structuredClone(runs);
  incorrect[19]!.samples[0]!.pass = false;
  expect(assess(incorrect).verdict).toBe('FAIL');
});
function syntheticReadback(e: Entry): Readback {
  const r: Readback = {
    dimensions: {
      nq: 7,
      nv: 6,
      nbody: 2,
      ngeom: 2,
      njnt: 1,
      ntree: 1,
      nu: 0,
      na: 0,
      nplugin: 0,
      nsensor: 0,
      nmocap: 0,
      neq: 0,
      ntendon: 0,
      nflex: 0,
    },
    arrays: {
      body_mass: [0, e.massKg],
      body_ipos: [0, 0, 0, 0, 0, 0],
      body_iquat: [1, 0, 0, 0, 1, 0, 0, 0],
      body_inertia: [0, 0, 0, ...Array<number>(3).fill((2 * e.massKg * 0.02 ** 2) / 5)],
      body_pos: [0, 0, 0, 0, 0, 2],
      body_quat: [1, 0, 0, 0, 1, 0, 0, 0],
      jnt_type: [0],
      jnt_qposadr: [0],
      jnt_dofadr: [0],
      geom_type: [6, 2],
      geom_bodyid: [0, 1],
      geom_size: [5, 5, 0.01, 0.02, 0, 0],
      geom_pos: [0, 0, -0.01, 0, 0, 0],
      geom_quat: [1, 0, 0, 0, 1, 0, 0, 0],
      geom_friction: Array<number>(6).fill(0),
      geom_margin: [0, 0],
      geom_gap: [0, 0],
      geom_surfacevel: Array<number>(12).fill(0),
      geom_fluid: Array<number>(24).fill(0),
      dof_damping: Array<number>(6).fill(0),
      dof_armature: Array<number>(6).fill(0),
      dof_frictionloss: Array<number>(6).fill(0),
      jnt_stiffness: [0],
      jnt_limited: [0],
      qpos0: original.initialQpos,
    },
    options: {
      ...Object.fromEntries(
        Object.entries(profile).filter(([k]) => k !== 'gravity' && k !== 'wind'),
      ),
      timestep: e.dtUs / 1e6,
    },
    gravity: [0, 0, -9.81],
    wind: [0, 0, 0],
    initial: syntheticWorld(e, 0).initial,
    warnings: Array<number>(14).fill(0),
    inputs: Array<number>(18).fill(0),
    constraintForces: Array<number>(6).fill(0),
  };
  return r;
}
it('replays the complete pure synthetic binary from exclusive external files within the immutable cap', () => {
  const root = mkdtempSync(join(tmpdir(), 'asa-phy01-pure-'));
  demand(
    relative(realpathSync(tmpdir()), realpathSync(root)).startsWith('asa-phy01-pure-'),
    'OWNED_PURE_TEMP',
  );
  const journal = new Journal(root),
    runs: Run[] = [];
  try {
    for (const [world, e] of plan().entries()) {
      const startOffset = journal.bytes,
        r = syntheticReadback(e),
        s = syntheticWorld(e, world);
      validateReadback(r, e);
      journal.write({ kind: 'world-start', world, entry: e, startOffset, readback: r });
      for (const v of s.frames) {
        journal.reserve();
        journal.frame(encode(v));
      }
      const steps = s.frames.length,
        ledger = newLedger();
      Object.assign(ledger, {
        modelAttempted: 1,
        modelCreated: 1,
        modelDeleteAttempted: 1,
        modelDeleted: 1,
        dataAttempted: 1,
        dataCreated: 1,
        dataDeleteAttempted: 1,
        dataDeleted: 1,
        step1: e.mode === 'split' ? steps : 0,
        step1Returned: e.mode === 'split' ? steps : 0,
        step2: e.mode === 'split' ? steps : 0,
        step2Returned: e.mode === 'split' ? steps : 0,
        full: e.mode === 'full' ? steps : 0,
        fullReturned: e.mode === 'full' ? steps : 0,
        warningCopies: 7 * (1 + (e.mode === 'split' ? 2 : 1) * steps),
        warningDeleteAttempted: 7 * (1 + (e.mode === 'split' ? 2 : 1) * steps),
        warningDeleted: 7 * (1 + (e.mode === 'split' ? 2 : 1) * steps),
      });
      journal.write(
        {
          kind: 'world-resources',
          world,
          stage: 'complete',
          primary: null,
          retainedFrames: steps,
          ledger,
        },
        true,
      );
      const result = summarize(e, s.frames, s.initial, world);
      runs.push(result);
      journal.write({
        kind: 'world-end',
        world,
        startOffset,
        endOffset: journal.bytes,
        run: receiptRun(result),
      });
    }
    fsyncSync(journal.bin);
    const rebuilt = replay(root, runs);
    expect(rebuilt.verdict).toBe('PASS');
    journal.write({ kind: 'finish', assessment: receiptAssessment(rebuilt) }, true);
    expect(journal.bytes + journal.metadataBytes + journal.emergencyBytes).toBeLessThan(
      f.raw.totalBytes,
    );
  } finally {
    expect(journal.close()).toEqual([]);
    // Only the two exclusive files in this test-owned Temp directory are removed.
    unlinkSync(join(root, names.meta));
    unlinkSync(join(root, names.binary));
    rmdirSync(root);
  }
});
it('borrows warning vector and releases only owned copies, exposing cleanup failure', () => {
  let vectorDeletes = 0,
    copies = 0;
  const warning = {
    size: () => 7,
    get: () => ({
      number: 0,
      lastinfo: 0,
      delete: () => {
        copies++;
      },
    }),
    delete: () => {
      vectorDeletes++;
    },
  };
  const ledger = newLedger();
  expect(warnings({ warning }, ledger)).toEqual(Array<number>(14).fill(0));
  expect([vectorDeletes, copies, ledger.warningCopies, ledger.warningDeleted]).toEqual([
    0, 7, 7, 7,
  ]);
  const failed = {
    ...warning,
    get: () => ({
      number: 0,
      lastinfo: 0,
      delete: () => {
        throw new Error('copy-delete');
      },
    }),
  };
  const errors = newLedger();
  expect(() => warnings({ warning: failed }, errors)).toThrow('WARNING_COPY_RELEASE');
  expect(errors.cleanupErrors).toHaveLength(7);
});
it.skipIf(!process.env['ASA_PHY01_CURRENT_ENGINE'] || !process.env['ASA_PHY01_CURRENT_LICENSE'])(
  'verifies current AOT bytes and original Git blobs without importing native',
  () => {
    historyAdmission();
    const e = engineAdmission(
      process.env['ASA_PHY01_CURRENT_ENGINE']!,
      process.env['ASA_PHY01_CURRENT_LICENSE']!,
    );
    expect(e.declarations.toString()).toContain('mj_step2(');
  },
);
it.skipIf(process.env['ASA_PHY01_CURRENT_RUN'] !== 'twenty-frozen-worlds-1071')(
  'acquires the registered twenty current-AOT freefall worlds once',
  async () => {
    const root = outputRoot(process.env['ASA_PHY01_CURRENT_OUTPUT'] ?? ''),
      journal = new Journal(root);
    const totals: Totals = {
      models: 0,
      data: 0,
      step1: 0,
      step1Returned: 0,
      step2: 0,
      step2Returned: 0,
      full: 0,
      fullReturned: 0,
    };
    const receiptErrors: string[] = [];
    let receiptCleanup: string[];
    const initialization: Initialization = { attempted: 0, returned: 0, phase: 'not-imported' };
    let primary: unknown,
      assessment: ReturnType<typeof assess> | undefined,
      initialized = false;
    try {
      validateFixture();
      const sources = sourceAdmission(),
        historical = historyAdmission(),
        engine = engineAdmission(
          process.env['ASA_PHY01_CURRENT_ENGINE'] ?? '',
          process.env['ASA_PHY01_CURRENT_LICENSE'] ?? '',
        );
      journal.write({
        kind: 'header',
        scope: 'TEST_ONLY',
        fixture: f,
        sources,
        historical,
        schema,
        plan: plan(),
        xml: plan().map((e) => ({ key: key(e), sha256: hash(modelXml(e)), xml: modelXml(e) })),
        nativeInitialized: false,
        totals,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
      });
      fsyncSync(journal.meta);
      const header = readFileSync(join(root, names.meta));
      const readback = JSON.parse(header.toString()) as {
        sources: unknown;
        schema: unknown;
        fixture: unknown;
      };
      demand(
        header.length === journal.metadataBytes &&
          same(readback.sources, sources) &&
          same(readback.schema, schema) &&
          same(readback.fixture, f),
        'ON_DISK_HEADER_ADMISSION',
      );
      journal.write({
        kind: 'header-readback',
        bytes: header.length,
        sha256: hash(header),
        nativeInitialized: false,
        totals,
      });
      const M = await loadNative(engine, initialization);
      initialized = true;
      const runs: Run[] = [];
      for (const [world, e] of plan().entries()) runs.push(runWorld(M, e, world, journal, totals));
      demand(
        initialization.attempted === 1 && initialization.returned === 1,
        'ONE_INITIALIZED_MODULE',
      );
      demand(
        same(totals, {
          models: 20,
          data: 20,
          step1: 21600,
          step1Returned: 21600,
          step2: 21600,
          step2Returned: 21600,
          full: 2400,
          fullReturned: 2400,
        }),
        'COMPLETE_NATIVE_ACCOUNTING',
      );
      fsyncSync(journal.bin);
      assessment = replay(root, runs);
      journal.write(
        {
          kind: 'finish',
          runtime: 'COMPLETE',
          physical: assessment.verdict,
          acquisition: 'CONSUMED',
          formalAcceptance: 'D01_D02_OPEN',
          initialized,
          initialization,
          totals,
          assessment: receiptAssessment(assessment),
          binary: { bytes: journal.bytes, sha256: journal.digest.copy().digest('hex') },
        },
        true,
      );
    } catch (error) {
      primary = error;
      try {
        journal.write(
          {
            kind: 'first-error',
            runtime: 'ERROR',
            physical: 'UNRESOLVED',
            acquisition:
              totals.step1 + totals.step2 + totals.full > 0 ? 'CONSUMED' : 'PRE_DISPATCH',
            initialized,
            initialization,
            totals,
            error: String(error),
            binary: {
              completePrefixBytes: journal.bytes,
              actualFileBytes: fstatSync(journal.bin).size,
              completePrefixSha256: journal.digest.copy().digest('hex'),
            },
          },
          true,
        );
      } catch (receiptError) {
        receiptErrors.push('error receipt: ' + String(receiptError));
      }
    } finally {
      receiptCleanup = journal.close();
    }
    if (primary)
      throw Object.assign(primary instanceof Error ? primary : new Error(String(primary)), {
        receiptErrors,
        receiptCleanup,
      });
    const cleanup = [...receiptErrors, ...receiptCleanup];
    demand(cleanup.length === 0, 'RECEIPT_CLEANUP ' + cleanup.join(';'));
    expect(assessment?.verdict).toBe('PASS');
  },
  120000,
);
