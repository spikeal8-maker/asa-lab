import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  createReadStream,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import f from './mujoco-finite-cap-near-threshold.fixture.json';
import g from './mujoco-finite-cap-stage6-diagnostic.fixture.json';

const fixtureUrl = new URL('./mujoco-finite-cap-near-threshold.fixture.json', import.meta.url),
  sourceUrl = new URL(import.meta.url);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
function demand(v: unknown, code: string): asserts v {
  if (!v) throw new Error(code);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const dt = 0.0005,
  base = (28 * Math.PI) / 180;
type Vec = [number, number, number];
type State = {
  time: number;
  qpos: number[];
  qvel: number[];
  qacc: number[];
  qacc_warmstart: number[];
};
type Phase = { time: number; qpos: number[]; qvel: number[] };
type Body = { com: Vec; rotation: number[]; omega: Vec; velocity: Vec; quaternion?: number[] };
type Floor = { rotation: number[]; normal: Vec; downhill: Vec; positiveTipAxis: Vec };
type Tilt = {
  theta: number;
  omega: number;
  phi: number;
  beta: number;
  relativeOmega: number;
  relativeOmegaY: number;
  uphillDirectionValid: boolean;
  uphillRimLift: number | null;
};
type Interval = {
  tick: number;
  pre: Tilt;
  post: Tilt;
  loaded: boolean;
  positiveSupport: boolean;
  supported: boolean;
  downhillRim: boolean;
  noSlip: boolean;
};
type Control = { u: number; stage: number; target: number; phase: string; stageEndUs: number };
type Handle = { delete(): void };
type Model = Handle & Record<string, unknown>;
type Data = Handle &
  Record<string, unknown> & {
    time: number;
    ncon: number;
    nefc: number;
    nJ: number;
    nisland: number;
    ntree_awake: number;
    ctrl: Float64Array;
  };
type BufferHandle = Handle & { GetView(): Float64Array };
type Native = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (m: Model) => Data;
  DoubleBuffer: new (n: number) => BufferHandle;
  mj_version(): number;
  mj_versionString(): string;
  mj_step1(m: Model, d: Data): void;
  mj_step2(m: Model, d: Data): void;
  mj_maxContact(m: Model, a: number, b: number, margin: number): number;
  mj_contactForce(m: Model, d: Data, i: number, b: BufferHandle): void;
  mj_differentiatePos(m: Model, b: BufferHandle, dt: number, pre: number[], post: number[]): void;
};
type Contact = {
  index: number;
  geom1: number;
  geom2: number;
  geom: number[];
  flex: number[];
  elem: number[];
  vert: number[];
  pos: number[];
  frame: number[];
  dist: number;
  includemargin: number;
  dim: number;
  exclude: number;
  efc_address: number;
  friction: number[];
  solref: number[];
  solreffriction: number[];
  solimp: number[];
  surfacevel: number[];
  adhesion: number;
  mu?: number;
  H?: number[];
};
type Rows = { ncon: number; nefc: number; type: number[]; id: number[] };
type Forward = {
  ncon: number;
  nefc: number;
  contacts: Contact[];
  bodies: Record<number, Body>;
  efcVel: number[];
  efcType: number[];
  efcId: number[];
  state: Phase;
};
type Force = {
  contacts: (Contact & { force: number[] })[];
  efcForce: number[];
  qfrcConstraint: number[];
  qfrcActuator: number[];
  actuatorForce: number[];
  endpoint: State;
  warnings: number[][];
  solverIterations: number[];
  islands: number;
  qacc: number[];
};
type Shape = {
  kind: string;
  name: string;
  bodyId: number;
  geomId: number;
  dofAdr: number;
  qposAdr: number;
  mass: number;
  radius: number;
  height: number;
  inertia: number[];
};
type Ids = {
  bodyIds: number[];
  geomBodies: number[];
  floorGeom: number;
  floorBody: number;
  freeBodies: Shape[];
};
type Resources = {
  temporaryCreated: number;
  temporaryDeleted: number;
  contactVectorsCreated: number;
  contactGetsCreated: number;
  warningGetsCreated: number;
  contactForceCalls: number;
  velocityCalls: number;
  cleanupErrors?: unknown[];
  [key: string]: unknown;
};
type Condition = {
  id: string;
  kind: string;
  rate: string;
  dtUs: number;
  maxSteps: number;
  targets: number;
  [key: string]: unknown;
};
type Readback = Record<string, unknown> & {
  options: Record<string, unknown>;
  body_pos: number[];
  body_quat: number[];
};
type Module = Record<string, unknown>;
const allowedExports = new Set([
  'worldIds',
  'makeCylinderXml',
  'readModel',
  'validateModel',
  'controlAt',
  'finite',
  'canonicalEqual',
  'contactIdentity',
  'numberVectorEqual',
  'floorFrame',
  'bodyEndpoint',
  'tiltState',
  'supportWitness',
  'forceAggregationBudget',
  'frameError',
  'contactWorldForce',
  'relativePointVelocity',
  'assessWindow',
  'assessContacts',
  'copyWarnings',
  'captureForward',
  'copyContacts',
  'nativeTimeBudget',
  'effectiveTorque',
  'quaternionMatrix',
  'rotate',
]);
function call<T>(m: Module, key: string, ...args: unknown[]): T {
  demand(allowedExports.has(key), 'PURE_EXPORT_ALLOWLIST_' + key);
  const fn = m[key];
  demand(typeof fn === 'function', 'PINNED_PURE_EXPORT_' + key);
  return Reflect.apply(fn, undefined, args) as T;
}
const norm = (v: number[]) => Math.hypot(...v);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);
const add = (a: Vec, b: Vec) => a.map((v, i) => v + b[i]!) as Vec;
const sub = (a: Vec, b: Vec) => a.map((v, i) => v - b[i]!) as Vec;
const scale = (a: Vec, s: number) => a.map((v) => v * s) as Vec;
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const asVec = (v: number[]) => {
  demand(v.length === 3 && v.every(Number.isFinite), 'VECTOR3');
  return v as Vec;
};
const c = JSON.parse(f.archive.cylinder.utf8) as {
  initialGapM: number;
  bodies: { cylinder: { radiusM: number; heightM: number }; floor: { halfExtentsM: number[] } };
  stand: { forceRangeNm: number[]; forceCapArithmeticAllowanceNm: number; kv: number };
  solver: { disableFlags: number; maxCombinedSolverIterationsPerIsland: number };
  contact: {
    maxLoadedSlipSpeedMps: number;
    maxCumulativeSlipM: number;
    velocityReconstructionToleranceMps: number;
  };
  tilt: {
    targetStepRad: number;
    maxPreTipTrackingDeg: number;
    maxStageSpanDeg: number;
    tip: {
      criticalAngleRad: number;
      maxBracketDistanceDeg: number;
      maxRateDtFirstTargetIndexDifference: number;
    };
  };
};
type Rate = 'normal' | 'slow';
type Helpers = {
  observer: Module;
  harness: Module;
  parent: Module;
  condition: Condition;
  ids: Ids;
  shape: Shape;
};
let purePromise: Promise<Helpers> | undefined;
const dataUrl = (s: string) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
function replaceOnce(s: string, a: string, b: string) {
  demand(s.split(a).length === 2, 'UNIQUE_PURE_SOURCE_BINDING');
  return s.replace(a, b);
}
async function helpers(): Promise<Helpers> {
  validateFixture();
  if (purePromise) return purePromise;
  purePromise = (async () => {
    for (const e of [
      f.archive.cylinder,
      f.archive.observer,
      f.archive.harness,
      f.archive.parent,
      f.archive.parentFixture,
    ])
      demand(
        Buffer.byteLength(e.utf8) === e.bytes && hash(e.utf8) === e.sha256,
        'FROZEN_ARCHIVE_BYTES',
      );
    // These immutable modules define pure math/readback functions. No old execute/main,
    // admission, test or CLI entry is invoked. Engine glue is imported only by loadNative.
    const observerUrl = dataUrl(f.archive.observer.utf8);
    const observer = (await import(/* @vite-ignore */ observerUrl)) as Module;
    const require = createRequire(import.meta.url);
    const parentSource = replaceOnce(
      f.archive.parent.utf8,
      "'yaml'",
      JSON.stringify(pathToFileURL(require.resolve('yaml')).href),
    ).replaceAll(
      'import.meta.url',
      JSON.stringify(pathToFileURL(join(repo, f.archive.parent.path)).href),
    );
    const parentUrl = dataUrl(parentSource),
      parent = (await import(/* @vite-ignore */ parentUrl)) as Module;
    const harnessSource = replaceOnce(
      replaceOnce(f.archive.harness.utf8, "'./mujoco-phy01.mjs'", JSON.stringify(parentUrl)),
      "'./mujoco-contact-observer.mjs'",
      JSON.stringify(observerUrl),
    ).replaceAll(
      'import.meta.url',
      JSON.stringify(pathToFileURL(join(repo, f.archive.harness.path)).href),
    );
    const harness = (await import(/* @vite-ignore */ dataUrl(harnessSource))) as Module;
    // Literal frozen model condition only. Never call cylinderPlan/admission/main.
    const condition: Condition = {
      id: 'admission-B-500-split',
      mode: 'admission',
      probe: 'B',
      kind: 'tilt',
      dtUs: 500,
      phase: 'split',
      repeat: 1,
      rate: 'normal',
      maxSteps: 6500,
      targets: 1,
    };
    const ids = call<Ids>(harness, 'worldIds', c, condition),
      shape = ids.freeBodies[0]!;
    demand(
      shape.bodyId === 2 &&
        shape.geomId === 1 &&
        shape.qposAdr === 1 &&
        shape.dofAdr === 1 &&
        shape.mass === 0.5,
      'CYLINDER_FREE_LAYOUT',
    );
    const original = call<string>(harness, 'makeCylinderXml', c, condition);
    let xml = replaceOnce(original, 'nativeccd="disable"', 'nativeccd="enable"');
    for (const [a, b] of [
      ['name="floor"', 'name="asa1168_finite_top"'],
      ['geom1="floor"', 'geom1="asa1168_finite_top"'],
      ['name="cylinder_geom"', 'name="asa1168_finite_cap_can"'],
      ['geom2="cylinder_geom"', 'geom2="asa1168_finite_cap_can"'],
    ])
      xml = replaceOnce(xml, a!, b!);
    const height = 0.0575 + 0.0001,
      q = [Math.cos(base / 2), 0, Math.sin(base / 2), 0],
      pos = [height * Math.sin(base), 0, height * Math.cos(base)];
    xml = replaceOnce(
      xml,
      '<body name="floor_body" pos="0 0 0">',
      '<body name="floor_body" pos="0 0 0" quat="' + q.join(' ') + '">',
    );
    xml = replaceOnce(
      xml,
      '<body name="cylinder" pos="0 0 ' + height + '">',
      '<body name="cylinder" pos="' + pos.join(' ') + '" quat="' + q.join(' ') + '">',
    );
    demand(xml === f.model.xml && hash(xml) === f.model.sha256, 'EXACT_BIASED_SHARED_XML');
    return { observer, harness, parent, condition, ids, shape };
  })();
  return purePromise;
}
function f64(v: unknown, n: number, label: string) {
  demand(v instanceof Float64Array && v.length === n, label + '_WIDTH');
  const a = Array.from(v);
  demand(a.every(Number.isFinite), label + '_FINITE');
  return a;
}
function i32(v: unknown, n: number, label: string) {
  demand(v instanceof Int32Array && v.length === n, label + '_WIDTH');
  return Array.from(v);
}
function floatBytes(values: number[]) {
  demand(values.every(Number.isFinite), 'FINITE_RAW');
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return b;
}
function stateBytes(s: State) {
  demand(
    s.qpos.length === 8 &&
      s.qvel.length === 7 &&
      s.qacc.length === 7 &&
      s.qacc_warmstart.length === 7,
    'STATE_WIDTH',
  );
  return floatBytes([...s.qpos, ...s.qvel, ...s.qacc, ...s.qacc_warmstart, s.time]);
}
function phaseBytes(s: Phase) {
  demand(s.qpos.length === 8 && s.qvel.length === 7, 'PHASE_WIDTH');
  return floatBytes([...s.qpos, ...s.qvel, s.time]);
}
function copyState(d: Data): State {
  return {
    time: d.time,
    qpos: f64(d.qpos, 8, 'QPOS'),
    qvel: f64(d.qvel, 7, 'QVEL'),
    qacc: f64(d.qacc, 7, 'QACC'),
    qacc_warmstart: f64(d.qacc_warmstart, 7, 'WARMSTART'),
  };
}
function nativeRows(d: Data): Rows {
  demand(
    Number.isInteger(d.ncon) &&
      d.ncon >= 0 &&
      d.ncon <= 4 &&
      Number.isInteger(d.nefc) &&
      d.nefc >= 0 &&
      d.nefc <= 12 &&
      d.nJ === d.nefc * 7,
    'NATIVE_ROW_CAP',
  );
  return {
    ncon: d.ncon,
    nefc: d.nefc,
    type: i32(d.efc_type, d.nefc, 'ROW_TYPE'),
    id: i32(d.efc_id, d.nefc, 'ROW_ID'),
  };
}
const materialKeys = [
  'friction',
  'solref',
  'solreffriction',
  'solimp',
  'surfacevel',
  'adhesion',
] as const;
function materialValues(v: typeof f.material | Contact) {
  return materialKeys.flatMap((k) =>
    typeof v[k] === 'number' ? [v[k] as number] : (v[k] as number[]),
  );
}
function zeroMask(values: number[]) {
  demand(values.length <= 32 && values.every((v) => v === 0), 'ZERO_INPUTS');
  return values.reduce<number>((m, v, i) => (Object.is(v, -0) ? (m | (2 ** i)) >>> 0 : m), 0);
}
const zeroValues = (mask: number, n: number) =>
  Array.from({ length: n }, (_, i) => (mask & (2 ** i) ? -0 : 0));
function materialMask(contact: Contact) {
  demand(
    contact.friction.length === 5 &&
      contact.solref.length === 2 &&
      contact.solreffriction.length === 2 &&
      contact.solimp.length === 5 &&
      contact.surfacevel.length === 3,
    'MATERIAL_FIELD_WIDTHS',
  );
  const actual = materialValues(contact),
    expected = materialValues(f.material);
  demand(actual.length === 18, 'MATERIAL_WIDTH');
  let mask = 0;
  actual.forEach((v, i) => {
    demand(Number.isFinite(v) && v === expected[i], 'NATIVE_MATERIAL_DICTIONARY');
    if (Object.is(v, -0)) mask |= 2 ** i;
  });
  demand(
    same(contact.geom, [contact.geom1, contact.geom2]) &&
      same(contact.flex, [-1, -1]) &&
      same(contact.elem, [-1, -1]) &&
      same(contact.vert, [-1, -1]),
    'RIGID_PAIR_DICTIONARY',
  );
  return mask;
}
type PackedContact = {
  contact: Contact;
  force: number[];
  rowForce: number[];
  rowVelocity: number[];
  jdelta: number[];
  relative: Vec;
  rowType: number[];
  rowId: number[];
};
type Packet = {
  world: number;
  tick: number;
  pre: State;
  phase: Phase;
  post: State;
  phaseHash: string;
  contacts: PackedContact[];
  ncon: number;
  nefc: number;
  nJ: number;
  islands: number;
  solverIterations: number[];
  awakePhase: number;
  awakePost: number;
  phaseWarnings: number[][];
  postWarnings: number[][];
  ctrl: number;
  nativeForce: number;
  qfrcActuator: number[];
  qfrcConstraint: number[];
  inputsPre: number[];
  inputsPost: number[];
  effective: number;
  signedWork: number;
  rowIdentity: true;
};
const schema = {
  version: 'ASA_LOCAL_BIASED_THRESHOLD_LE_1872_V1',
  bytes: 1872,
  header: 0,
  pre: 16,
  post: 256,
  relative: 496,
  phaseHash: 592,
  contacts: 624,
  contactBytes: 248,
  maxContacts: 4,
  phaseWarnings: 1616,
  postWarnings: 1672,
  ctrl: 1728,
  nativeForce: 1736,
  hingeForce: 1744,
  constraint: 1752,
  inputSigns: 1808,
  actuatorSigns: 1816,
  effective: 1824,
  work: 1832,
  reserved: 1840,
  stateOrder: ['qpos8', 'qvel7', 'qacc7', 'qacc_warmstart7', 'time1'],
  jointLayout: {
    deckQ: 0,
    deckV: 0,
    canPositionQ: [1, 2, 3],
    canQuaternionWxyzQ: [4, 5, 6, 7],
    canLinearWorldV: [1, 2, 3],
    canAngularLocalV: [4, 5, 6],
  },
  bodyIds: { world: 0, deck: 1, cylinder: 2 },
  geomIds: { deck: 0, cylinder: 1 },
  forceConvention:
    'Normal/tangent frame and force order retained from native geom1 to geom2; actual contact relative vector uses v2+omega2 cross(p-COM2)-v1-omega1 cross(p-COM1).',
  contactDoubleOrder: [
    'pos3',
    'frame9',
    'dist',
    'includemargin',
    'nativeForce6',
    'efcForce3',
    'efcVelocity3',
    'J_PRE_delta3',
  ],
  contactHeader: [
    'geom1',
    'geom2',
    'index',
    'dim',
    'exclude',
    'efc_address_or255',
    'rowType3',
    'rowId3',
    'materialDictionary0',
    'zeroSigns18bit',
  ],
  phase:
    'Actual STEP1 preserved fields captured and equality-witnessed before dedup; SHA256 and exact PRE byte back-reference preserve signed zero.',
  caches:
    'Native finite H/mu checked live and retained fully on first error; outside identity and physical oracle. Dense J projected, not serialized.',
};
function encode(p: Packet) {
  demand(
    p.qfrcActuator.length === 7 &&
      p.qfrcConstraint.length === 7 &&
      p.inputsPre.length === 25 &&
      p.inputsPost.length === 25 &&
      p.solverIterations.length === 2,
    'PACKET_FIXED_WIDTHS',
  );
  demand(
    p.contacts.length === p.ncon && p.ncon <= 4 && p.world <= 1 && p.tick > 0 && p.tick <= 89000,
    'RECORD_ID_COUNT',
  );
  demand(
    phaseBytes(p.phase).equals(phaseBytes(p.pre)) && p.phaseHash === hash(phaseBytes(p.phase)),
    'ACTUAL_STEP1_CANNOT_DEDUP_CHANGED_PHASE',
  );
  demand(p.rowIdentity === true, 'OBSERVED_POST_ROW_IDENTITY');
  const b = Buffer.alloc(1872);
  b.writeUInt32LE(p.tick, 0);
  const fields = [
    p.world,
    p.ncon,
    p.nefc,
    p.nJ,
    p.islands,
    p.solverIterations[0] ?? 0,
    p.solverIterations[1] ?? 0,
    p.awakePhase,
    p.awakePost,
    3,
    1,
    0,
  ];
  fields.forEach((v, i) => {
    demand(Number.isInteger(v) && v >= 0 && v <= 255, 'HEADER_INTEGER');
    b.writeUInt8(v, 4 + i);
  });
  stateBytes(p.pre).copy(b, 16);
  stateBytes(p.post).copy(b, 256);
  Buffer.from(p.phaseHash, 'hex').copy(b, 592);
  const put = (v: number[], off: number, n: number) => {
    demand(v.length === n, 'PACKED_WIDTH');
    floatBytes(v).copy(b, off);
  };
  p.contacts.forEach((v, i) => {
    const ct = v.contact;
    demand(
      ct.pos.length === 3 &&
        ct.frame.length === 9 &&
        v.force.length === 6 &&
        v.rowForce.length === 3 &&
        v.rowVelocity.length === 3 &&
        v.jdelta.length === 3,
      'CONTACT_FIXED_WIDTHS',
    );
    demand(
      ct.efc_address === -1 ||
        (Number.isInteger(ct.efc_address) &&
          ct.efc_address >= 0 &&
          ct.efc_address + 3 <= p.nefc &&
          ct.efc_address % 3 === 0),
      'CONTACT_ADDRESS_ENCODING',
    );
    demand(ct.index === i, 'NATIVE_CONTACT_ORDER');
    put(v.relative, 496 + 24 * i, 3);
    const off = 624 + i * 248,
      active = ct.efc_address >= 0;
    const small = [
      ct.geom1,
      ct.geom2,
      i,
      ct.dim,
      ct.exclude,
      active ? ct.efc_address : 255,
      ...[0, 1, 2].map((j) => (active ? v.rowType[j]! : 255)),
      ...[0, 1, 2].map((j) => (active ? v.rowId[j]! : 255)),
      0,
    ];
    small.forEach((n, j) => {
      demand(Number.isInteger(n) && n >= 0 && n <= 255, 'CONTACT_INTEGER');
      b.writeUInt8(n, off + j);
    });
    const mask = materialMask(ct);
    b.writeUIntLE(mask, off + 13, 3);
    put(
      [
        ...ct.pos,
        ...ct.frame,
        ct.dist,
        ct.includemargin,
        ...v.force,
        ...v.rowForce,
        ...v.rowVelocity,
        ...v.jdelta,
      ],
      off + 16,
      29,
    );
  });
  for (const [warnings, off] of [
    [p.phaseWarnings, 1616],
    [p.postWarnings, 1672],
  ] as const) {
    demand(warnings.length === 7 && warnings.every((v) => v.length === 2), 'WARNING_WIDTH');
    warnings.flat().forEach((v, i) => {
      demand(Number.isInteger(v) && v >= -2147483648 && v <= 2147483647, 'WARNING_INT32');
      b.writeInt32LE(v, off + i * 4);
    });
  }
  put([p.ctrl, p.nativeForce, p.qfrcActuator[0]!], 1728, 3);
  put(p.qfrcConstraint, 1752, 7);
  b.writeUInt32LE(zeroMask(p.inputsPre), 1808);
  b.writeUInt32LE(zeroMask(p.inputsPost), 1812);
  b.writeUInt8(zeroMask(p.qfrcActuator.slice(1)), 1816);
  put([p.effective, p.signedWork], 1824, 2);
  return b;
}
function decode(b: Buffer): Packet {
  demand(
    b.length === 1872 &&
      b[13] === 3 &&
      b[14] === 1 &&
      b[15] === 0 &&
      b.subarray(1817, 1824).every((v) => v === 0) &&
      b.subarray(1840).every((v) => v === 0),
    'RECORD_FRAMING',
  );
  const read = (off: number, n: number) => {
    const v = Array.from({ length: n }, (_, i) => b.readDoubleLE(off + 8 * i));
    demand(v.every(Number.isFinite), 'NONFINITE_RECORD');
    return v;
  };
  const state = (off: number): State => {
    const v = read(off, 30);
    return {
      qpos: v.slice(0, 8),
      qvel: v.slice(8, 15),
      qacc: v.slice(15, 22),
      qacc_warmstart: v.slice(22, 29),
      time: v[29]!,
    };
  };
  const pre = state(16),
    post = state(256),
    phase = { qpos: [...pre.qpos], qvel: [...pre.qvel], time: pre.time },
    phaseHash = b.subarray(592, 624).toString('hex');
  demand(hash(phaseBytes(phase)) === phaseHash, 'WITNESSED_PHASE_BACK_REFERENCE');
  const ncon = b[5]!,
    contacts: PackedContact[] = [];
  demand(ncon <= 4, 'RECORD_CONTACT_CAP');
  for (let i = 0; i < 4; i++) {
    const off = 624 + i * 248;
    if (i >= ncon) {
      demand(
        b.subarray(off, off + 248).every((v) => v === 0) &&
          b.subarray(496 + 24 * i, 520 + 24 * i).every((v) => v === 0),
        'UNUSED_CONTACT_SLOT',
      );
      continue;
    }
    const small = Array.from(b.subarray(off, off + 13)),
      v = read(off + 16, 29),
      mask = b.readUIntLE(off + 13, 3);
    demand(
      small[2] === i && small[3] === 3 && small[12] === 0 && mask >>> 18 === 0,
      'CONTACT_HEADER',
    );
    const mv = materialValues(f.material).map((x, j) =>
      mask & (2 ** j) ? (demand(x === 0, 'SIGN_MASK_NONZERO'), -0) : x,
    );
    const ct: Contact = {
      index: i,
      geom1: small[0]!,
      geom2: small[1]!,
      geom: small.slice(0, 2),
      flex: [-1, -1],
      elem: [-1, -1],
      vert: [-1, -1],
      dim: 3,
      exclude: small[4]!,
      efc_address: small[5] === 255 ? -1 : small[5]!,
      pos: v.slice(0, 3),
      frame: v.slice(3, 12),
      dist: v[12]!,
      includemargin: v[13]!,
      friction: mv.slice(0, 5),
      solref: mv.slice(5, 7),
      solreffriction: mv.slice(7, 9),
      solimp: mv.slice(9, 14),
      surfacevel: mv.slice(14, 17),
      adhesion: mv[17]!,
    };
    const active = ct.efc_address >= 0;
    demand(active || small.slice(6, 12).every((v) => v === 255), 'INACTIVE_ROWS_REFERENCE');
    contacts.push({
      contact: ct,
      force: v.slice(14, 20),
      rowForce: v.slice(20, 23),
      rowVelocity: v.slice(23, 26),
      jdelta: v.slice(26, 29),
      relative: asVec(read(496 + 24 * i, 3)),
      rowType: active ? small.slice(6, 9) : [],
      rowId: active ? small.slice(9, 12) : [],
    });
  }
  const warnings = (off: number) =>
    Array.from({ length: 7 }, (_, i) => [
      b.readInt32LE(off + 8 * i),
      b.readInt32LE(off + 8 * i + 4),
    ]);
  demand(
    b.readUInt32LE(1808) < 2 ** 25 && b.readUInt32LE(1812) < 2 ** 25 && b[1816]! < 64,
    'ZERO_SIGN_MASK_WIDTH',
  );
  return {
    world: b[4]!,
    tick: b.readUInt32LE(0),
    pre,
    phase,
    post,
    phaseHash,
    contacts,
    ncon,
    nefc: b[6]!,
    nJ: b[7]!,
    islands: b[8]!,
    solverIterations: [b[9]!, b[10]!],
    awakePhase: b[11]!,
    awakePost: b[12]!,
    phaseWarnings: warnings(1616),
    postWarnings: warnings(1672),
    ctrl: b.readDoubleLE(1728),
    nativeForce: b.readDoubleLE(1736),
    qfrcActuator: [b.readDoubleLE(1744), ...zeroValues(b[1816]!, 6)],
    qfrcConstraint: read(1752, 7),
    inputsPre: zeroValues(b.readUInt32LE(1808), 25),
    inputsPost: zeroValues(b.readUInt32LE(1812), 25),
    effective: b.readDoubleLE(1824),
    signedWork: b.readDoubleLE(1832),
    rowIdentity: true,
  };
}

function condition(h: Helpers, rate: Rate): Condition {
  return {
    ...h.condition,
    id: 'local-biased-' + rate,
    rate,
    maxSteps: f.schedule[rate].maxIntervals,
    targets: 17,
  };
}
function control(h: Helpers, rate: Rate, tickBefore: number) {
  return call<Control>(h.harness, 'controlAt', c, condition(h, rate), tickBefore);
}
function stateBodies(h: Helpers, s: State): Record<number, Body> {
  const floor = call<Floor>(h.observer, 'floorFrame', base + s.qpos[0]!),
    com = scale(floor.normal, -0.025),
    omega: Vec = [0, s.qvel[0]!, 0];
  return {
    0: {
      com: [0, 0, 0],
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      omega: [0, 0, 0],
      velocity: [0, 0, 0],
    },
    1: { com, rotation: floor.rotation, omega, velocity: cross(omega, com) },
    2: call<Body>(h.observer, 'bodyEndpoint', s, h.shape),
  };
}
type Support = {
  loaded: number;
  maxSlip: number;
  outwardForce: number;
  supported: boolean;
  downhillRim: boolean;
};
function supportCertificate(h: Helpers, p: Packet): Support {
  const floor = call<Floor>(h.observer, 'floorFrame', base + p.pre.qpos[0]!),
    bodies = stateBodies(h, p.pre),
    occupied = new Set<number>();
  const result: Support = {
      loaded: 0,
      maxSlip: 0,
      outwardForce: 0,
      supported: true,
      downhillRim: true,
    },
    forceSum = [0, 0, 0],
    sumAbs = [0, 0, 0];
  demand(p.ncon === p.contacts.length && p.nefc <= 12 && p.nJ === p.nefc * 7, 'CONTACT_ROW_COUNTS');
  for (const [index, v] of p.contacts.entries()) {
    const ct = v.contact;
    materialMask(ct);
    demand(
      ct.index === index &&
        ((ct.geom1 === 0 && ct.geom2 === 1) || (ct.geom1 === 1 && ct.geom2 === 0)) &&
        ct.dim === 3,
      'REGISTERED_PAIR',
    );
    demand(
      call<number>(h.observer, 'frameError', ct.frame) <= 1e-12,
      'CONTACT_FRAME_ORTHONORMALITY',
    );
    demand(
      v.force.length === 6 && v.force.every(Number.isFinite) && v.force[0]! >= 0,
      'NATIVE_CONTACT_FORCE',
    );
    const reconstructed = call<Vec>(
      h.observer,
      'relativePointVelocity',
      ct.pos,
      bodies[h.ids.geomBodies[ct.geom1]!]!,
      bodies[h.ids.geomBodies[ct.geom2]!]!,
    );
    demand(
      Math.max(...sub(v.relative, reconstructed).map(Math.abs)) <=
        c.contact.velocityReconstructionToleranceMps,
      'STATE_NATIVE_POINT_VELOCITY_MAPPING',
    );
    const rows = ct.efc_address >= 0;
    if (rows) {
      demand(
        ct.efc_address % 3 === 0 &&
          ct.efc_address + 3 <= p.nefc &&
          v.rowType.length === 3 &&
          v.rowId.length === 3,
        'CONTACT_ADDRESS',
      );
      for (let j = 0; j < 3; j++) {
        const row = ct.efc_address + j;
        demand(
          !occupied.has(row) && v.rowType[j] === 7 && v.rowId[j] === index,
          'EXACT_NATIVE_ROW_IDENTITY',
        );
        occupied.add(row);
        demand(
          Math.abs(v.rowVelocity[j]! - dot(ct.frame.slice(3 * j, 3 * j + 3), v.relative)) <=
            c.contact.velocityReconstructionToleranceMps,
          'CONTACT_POINT_VELOCITY_RECONSTRUCTION',
        );
      }
      demand(
        call<boolean>(h.observer, 'numberVectorEqual', v.rowForce, v.force.slice(0, 3)),
        'CONTACT_FORCE_EFC_PARITY',
      );
    } else
      demand(
        v.rowType.length === 0 &&
          v.rowId.length === 0 &&
          v.rowForce.every((x) => x === 0) &&
          v.rowVelocity.every((x) => x === 0) &&
          v.jdelta.every((x) => x === 0),
        'INACTIVE_CONTACT_ROWS',
      );
    const worldForce = call<Vec>(h.observer, 'contactWorldForce', ct.frame, v.force),
      sign = ct.geom2 === 1 ? 1 : -1;
    for (let axis = 0; axis < 3; axis++) {
      forceSum[axis]! += sign * worldForce[axis]!;
      sumAbs[axis]! += [0, 1, 2].reduce(
        (s, j) => s + Math.abs(ct.frame[3 * j + axis]! * v.force[j]!),
        0,
      );
    }
    if (v.force[0]! > 0) {
      demand(
        rows &&
          ct.exclude === 0 &&
          ct.dist < 0 &&
          ct.includemargin === 0 &&
          v.force.slice(3).every((x) => x === 0),
        'UNKNOWN_LOADED_CONTACT_DOMAIN',
      );
      const tangent = sub(v.relative, scale(floor.normal, dot(v.relative, floor.normal))),
        speed = Math.max(Math.hypot(v.rowVelocity[1]!, v.rowVelocity[2]!), norm(tangent));
      const witness = call<{ supported: boolean; downhillRim: boolean }>(
        h.observer,
        'supportWitness',
        ct,
        1,
        bodies[2],
        floor,
        h.shape,
        c,
      );
      result.loaded++;
      result.maxSlip = Math.max(result.maxSlip, speed);
      result.outwardForce += sign * dot(worldForce, floor.normal);
      result.supported &&= witness.supported;
      result.downhillRim &&= witness.downhillRim;
    }
  }
  demand(occupied.size === p.nefc, 'NO_ORPHAN_NATIVE_ROWS');
  for (let i = 0; i < 3; i++) {
    const allowance = call<number>(h.observer, 'forceAggregationBudget', p.ncon, sumAbs[i], 0.5);
    demand(
      Math.abs(forceSum[i]! - p.qfrcConstraint[i + 1]!) <= allowance,
      'CONTACT_FORCE_AGGREGATION_TRANSLATION',
    );
  }
  result.downhillRim = result.loaded > 0 && result.downhillRim;
  return result;
}
function compareNativeCertificate(
  h: Helpers,
  packet: Packet,
  forward: Forward,
  force: Force,
  beforeTip: boolean,
) {
  const nativeSupport = call<{ bodies: { cylinder: Support } }>(
    h.observer,
    'assessContacts',
    c,
    forward,
    force,
    h.ids,
    call<Floor>(h.observer, 'floorFrame', base + packet.pre.qpos[0]!),
  ).bodies.cylinder;
  const retainedSupport = supportCertificate(h, packet);
  demand(
    Object.is(nativeSupport.maxSlip, retainedSupport.maxSlip) &&
      Object.is(nativeSupport.outwardForce, retainedSupport.outwardForce) &&
      nativeSupport.loaded === retainedSupport.loaded,
    'NATIVE_RETAINED_FORCE_VELOCITY_CERTIFICATE',
  );
  if (beforeTip)
    demand(
      nativeSupport.supported === retainedSupport.supported &&
        nativeSupport.downhillRim === retainedSupport.downhillRim,
      'NATIVE_RETAINED_FINITE_WITNESS_CERTIFICATE',
    );
  return { native: nativeSupport, retained: retainedSupport };
}
type Torque = {
  nativeForce: number;
  effective: number;
  endpointFormula: number;
  algebraBudget: number;
  saturated: boolean;
};
function torqueOf(h: Helpers, p: Pick<Packet, 'ctrl' | 'pre' | 'post' | 'nativeForce'>) {
  return call<Torque>(
    h.observer,
    'effectiveTorque',
    p.ctrl,
    p.pre.qpos[0],
    p.pre.qvel[0],
    p.post.qvel[0],
    p.nativeForce,
    c.stand,
  );
}
function validatePacket(
  h: Helpers,
  p: Packet,
  rate: Rate,
  world: number,
  previous: State,
  expectedControl?: Control,
) {
  demand(
    p.world === world &&
      p.tick > 0 &&
      p.tick <= f.schedule[rate].maxIntervals &&
      stateBytes(p.pre).equals(stateBytes(previous)),
    'NATIVE_INTERVAL_CONTINUITY',
  );
  demand(
    phaseBytes(p.phase).equals(phaseBytes(p.pre)) && hash(phaseBytes(p.phase)) === p.phaseHash,
    'OBSERVED_STEP1_PRESERVATION',
  );
  const time = p.tick * 0.0005,
    limit = call<number>(h.parent, 'nativeTimeBudget', p.tick, 500);
  demand(
    Number.isFinite(p.pre.time) &&
      Number.isFinite(p.post.time) &&
      p.post.time > p.pre.time &&
      Math.abs(p.post.time - time) <= limit,
    'INTEGER_NATIVE_CLOCK',
  );
  stateBytes(p.post);
  demand(
    Math.abs(norm(p.pre.qpos.slice(4, 8)) - 1) <= 1e-12 &&
      Math.abs(norm(p.post.qpos.slice(4, 8)) - 1) <= 1e-12,
    'NATIVE_UNIT_QUATERNION',
  );
  demand(
    p.islands <= 2 &&
      p.islands >= 0 &&
      p.solverIterations.length === 2 &&
      p.solverIterations.every(
        (v) => Number.isInteger(v) && v >= 0 && v <= c.solver.maxCombinedSolverIterationsPerIsland,
      ),
    'SOLVER_ITERATION_CAP',
  );
  demand(
    Number.isInteger(p.awakePhase) && p.awakePhase >= 0 && p.awakePhase <= 2 && p.awakePost === 2,
    'NATIVE_AWAKE_COUNTS',
  );
  demand(
    p.phaseWarnings.length === 7 &&
      p.postWarnings.length === 7 &&
      [...p.phaseWarnings, ...p.postWarnings].every(
        (v) => v.length === 2 && v.every((n) => n === 0),
      ),
    'NATIVE_WARNINGS',
  );
  zeroMask(p.inputsPre);
  zeroMask(p.inputsPost);
  zeroMask(p.qfrcActuator.slice(1));
  const want = expectedControl ?? control(h, rate, p.tick - 1);
  demand(Object.is(p.ctrl, want.u), 'LEFT_HELD_NATIVE_CONTROL');
  const torque = torqueOf(h, p),
    allow = c.stand.forceCapArithmeticAllowanceNm;
  demand(
    Number.isFinite(torque.effective) &&
      Math.abs(p.nativeForce) <= 32 + allow &&
      Math.abs(torque.effective) <= 32 + allow,
    'STAND_NATIVE_AND_EFFECTIVE_FORCE_BOUND',
  );
  demand(
    Math.abs(p.nativeForce - p.qfrcActuator[0]!) <= allow &&
      Math.abs(torque.effective - torque.endpointFormula) <= torque.algebraBudget,
    'STAND_ACTUATOR_MAPPING_AND_ALGEBRA',
  );
  demand(
    Object.is(p.effective, torque.effective) &&
      Object.is(p.signedWork, dt * torque.effective * ((p.pre.qvel[0]! + p.post.qvel[0]!) / 2)),
    'RECOMPUTED_SIGNED_SERVO_WORK',
  );
}
type WindowResult = {
  accepted: boolean;
  range?: number;
  growth?: number;
  firstTick?: number;
  lastTick?: number;
  reason?: string;
};
type Event = {
  targetIndex: number;
  tick: number;
  atUs: number;
  bracket: number[];
  window: WindowResult;
  finishHoldAtUs: number;
};
class Certificate {
  readonly failures = new Map<string, number>();
  readonly stages: Record<string, unknown>[] = [];
  readonly prefix = createHash('sha256');
  previous: State;
  tick = 0;
  window: Interval[] = [];
  previousStable: number[] = [];
  stage = 0;
  low = Infinity;
  high = -Infinity;
  firstConfirmed: Event | null = null;
  firstObservedTip: Record<string, unknown> | null = null;
  stopAtUs: number | null = null;
  done = false;
  stopReason = '';
  cumulativeSlip = 0;
  peakSlip = 0;
  work = 0;
  positiveWork = 0;
  negativeWork = 0;
  lastSupport: Support | undefined;
  constructor(
    readonly h: Helpers,
    readonly rate: Rate,
    readonly world: number,
    initial: State,
  ) {
    this.previous = initial;
  }
  private fail(code: string, tick: number) {
    if (!this.failures.has(code)) this.failures.set(code, tick);
  }
  private acceptWindow(type: 'stable' | 'tip', target: number) {
    return call<WindowResult>(this.h.observer, 'assessWindow', this.window, c, 500, target, type);
  }
  observe(p: Packet, bytes: Buffer) {
    demand(!this.done && p.tick === this.tick + 1, 'NO_ADVANCE_AFTER_WORLD_STOP');
    validatePacket(this.h, p, this.rate, this.world, this.previous);
    const support = supportCertificate(this.h, p);
    this.lastSupport = support;
    this.previous = p.post;
    this.tick = p.tick;
    this.prefix.update(bytes);
    const ctl = control(this.h, this.rate, p.tick - 1),
      next = control(this.h, this.rate, p.tick),
      endUs = p.tick * 500;
    this.work += p.signedWork;
    this.positiveWork += Math.max(p.signedWork, 0);
    this.negativeWork += Math.min(p.signedWork, 0);
    const before = call<Tilt>(
      this.h.observer,
      'tiltState',
      call<Body>(this.h.observer, 'bodyEndpoint', p.pre, this.h.shape),
      base + p.pre.qpos[0]!,
      p.pre.qvel[0],
      c,
    );
    const after = call<Tilt>(
      this.h.observer,
      'tiltState',
      call<Body>(this.h.observer, 'bodyEndpoint', p.post, this.h.shape),
      base + p.post.qpos[0]!,
      p.post.qvel[0],
      c,
    );
    if (ctl.stage !== this.stage) {
      demand(
        ctl.stage === this.stage + 1 && this.previousStable.length > 0,
        'ONLY_ACCEPTED_STABLE_TARGET_PROGRESSION',
      );
      this.stage = ctl.stage;
      this.low = Math.min(...this.previousStable);
      this.high = Math.max(...this.previousStable);
      this.window = [];
    }
    const interval: Interval = {
      tick: p.tick,
      pre: before,
      post: after,
      loaded: support.loaded > 0,
      positiveSupport: support.outwardForce > 0,
      supported: support.supported,
      downhillRim: support.downhillRim,
      noSlip: support.maxSlip <= 0.001,
    };
    this.window.push(interval);
    if (this.window.length > 200) this.window.shift();
    if (endUs === 2000000) {
      const accepted = this.acceptWindow('stable', base);
      if (!accepted.accepted) {
        this.fail('INDETERMINATE_INITIAL_SETTLE_NOT_STABLE', p.tick);
        this.done = true;
        this.stopReason = 'INITIAL_SETTLE_FAILED';
      } else this.previousStable = this.window.flatMap((v) => [v.pre.theta, v.post.theta]);
      this.stages.push({ stage: 0, accepted, tick: p.tick });
      return;
    }
    if (ctl.stage === 0) return;
    if (!this.firstConfirmed) {
      this.low = Math.min(this.low, before.theta, after.theta);
      this.high = Math.max(this.high, before.theta, after.theta);
      this.peakSlip = Math.max(this.peakSlip, support.maxSlip);
      this.cumulativeSlip += dt * support.maxSlip;
      if (support.maxSlip > 0.001) this.fail('MAX_LOADED_POINT_SLIP', p.tick);
      if (this.cumulativeSlip > 0.0001) this.fail('MAX_CUMULATIVE_SLIP', p.tick);
      if (!(support.loaded > 0 && support.outwardForce > 0 && support.supported))
        this.fail('UNKNOWN_SUPPORT_WITNESS_DOMAIN', p.tick);
      if (
        Math.max(Math.abs(p.pre.qpos[0]! - ctl.u), Math.abs(p.post.qpos[0]! - next.u)) >
        (0.05 * Math.PI) / 180
      )
        this.fail('STAND_PRETIP_TRACKING', p.tick);
      if (
        Math.max(Math.abs(p.pre.qvel[0]!), Math.abs(p.post.qvel[0]!)) >
        f.schedule[this.rate].maxSpeedRadps
      )
        this.fail('STAND_PRETIP_SPEED', p.tick);
      if (this.high - this.low > (0.25 * Math.PI) / 180)
        this.fail('STAND_STAGE_ANGLE_SPAN', p.tick);
      const tip = this.acceptWindow('tip', base + ctl.target);
      if (tip.accepted) {
        this.firstObservedTip ??= { tick: p.tick, targetIndex: ctl.stage, window: tip };
        if (
          ![this.low, this.high].every(
            (v) => Math.abs(v - c.tilt.tip.criticalAngleRad) <= (2 * Math.PI) / 180,
          )
        )
          this.fail('TIP_ANALYTIC_FULL_BRACKET', p.tick);
        if (this.failures.size === 0) {
          this.firstConfirmed = {
            targetIndex: ctl.stage,
            tick: p.tick,
            atUs: endUs,
            bracket: [this.low, this.high],
            window: tip,
            finishHoldAtUs: ctl.stageEndUs,
          };
          this.stopAtUs = ctl.stageEndUs;
        }
      }
      if (this.failures.size > 0) this.stopAtUs ??= ctl.stageEndUs;
    }
    // A tip on the final interval is adjudicated BEFORE the hold boundary. Use the
    // actual PRE stage, not controlAt(end), which already names the following stage.
    if (endUs === ctl.stageEndUs) {
      if (this.firstConfirmed) {
        this.done = true;
        this.stopReason = 'FIRST_CONFIRMED_FULL_HOLD_COMPLETE';
      } else if (this.failures.size > 0) {
        this.done = true;
        this.stopReason = 'FAILED_CURRENT_HOLD_COMPLETE';
      } else {
        const stable = this.acceptWindow('stable', base + ctl.target);
        this.stages.push({
          stage: ctl.stage,
          tick: p.tick,
          stable,
          actualRange: [this.low, this.high],
        });
        if (!stable.accepted) {
          this.fail('INDETERMINATE_STAGE_END_NO_STABLE_OR_TIP', p.tick);
          this.done = true;
          this.stopReason = 'NO_STABLE_OR_TIP';
        } else if (ctl.stage === 17) {
          this.fail('LOCAL_THRESHOLD_UNRESOLVED', p.tick);
          this.done = true;
          this.stopReason = 'LOCAL_THRESHOLD_UNRESOLVED';
        } else this.previousStable = this.window.flatMap((v) => [v.pre.theta, v.post.theta]);
      }
    }
  }
  finish() {
    demand(this.done, 'NO_COMPLETE_REGISTERED_WORLD');
    return {
      rate: this.rate,
      world: this.world,
      intervals: this.tick,
      atUs: this.tick * 500,
      physical: this.failures.size === 0 && this.firstConfirmed ? 'PASS' : 'FAIL',
      failures: Array.from(this.failures),
      stopReason: this.stopReason,
      firstConfirmed: this.firstConfirmed,
      firstObservedTip: this.firstObservedTip,
      stages: this.stages,
      cumulativeSlip: this.cumulativeSlip,
      peakSlip: this.peakSlip,
      signedWork: this.work,
      positiveWork: this.positiveWork,
      negativeWork: this.negativeWork,
      streamSha256: this.prefix.digest('hex'),
    };
  }
}

type Pins = { bytes: number; sha256: string };
function pinned(path: string, pin: Pins) {
  const st = lstatSync(path);
  demand(st.isFile() && !st.isSymbolicLink() && st.size === pin.bytes, 'PINNED_FILE_WIDTH');
  const b = readFileSync(path);
  demand(hash(b) === pin.sha256, 'PINNED_FILE_SHA');
  return b;
}
function validateFixture(v: typeof f = f) {
  demand(
    hash(JSON.stringify(v)) === 'f38204417dda946197b9b88f1688200f969d7b9e24818a68a5826988dc24d4a3',
    'EXACT_REGISTERED_FIXTURE',
  );
  demand(
    v.id === 'E1-LOCAL-BIASED-CYLINDER-THRESHOLD-01' &&
      v.scope === 'TEST_ONLY' &&
      v.selectedMain === '8922c5fb372727245b9df7506c4f1bc64e20905a',
    'SELECTED_LOCAL_SCOPE',
  );
  demand(
    hash(v.archive.cylinder.utf8) ===
      'fea819890c357f7d6cc6cccc1b8ff84ab3e60c8910d33f7ab02c4ed0614a1cf5' &&
      hash(v.archive.observer.utf8) ===
        '77146b9e01f974345ad95d93fda1930cc82550d3b3b9fdf4e758eb8f1d1bb987',
    'ARCHIVED_PHYSICAL_ORACLE',
  );
  demand(
    hash(v.model.xml) === 'b39f6f4b2e5cca9c81086faa1a29fb6f25e7f4d103e4900be0aef78fec019e39' &&
      Buffer.byteLength(v.model.xml) === 2057,
    'FIXED_NATIVE_MODEL',
  );
  demand(
    same(v.capture, {
      recordBytes: 1872,
      metadataBytes: 4194304,
      errorBytes: 8388608,
      maxBytes: 268435456,
      worstCaseBytes: 266238912,
    }),
    'REGISTERED_CAPTURE_CAPS',
  );
  demand(
    v.schedule.maxIntervals === 135500 &&
      v.schedule.maxWorlds === 2 &&
      v.schedule.stepUs === 500 &&
      v.schedule.maxTarget === 17 &&
      v.schedule.maxContacts === 4 &&
      v.schedule.maxRows === 12,
    'REGISTERED_WORK_BOUNDS',
  );
}
function sourceAdmission() {
  return [
    [fixtureUrl, 'ASA_D01_NEAR_FIXTURE_SHA256'],
    [sourceUrl, 'ASA_D01_NEAR_SOURCE_SHA256'],
  ].map(([url, k]) => {
    const expected = process.env[k as string] ?? '';
    demand(/^[a-f0-9]{64}$/.test(expected), 'EXPLICIT_FROZEN_SOURCE_SHA');
    const b = readFileSync(url as URL);
    demand(hash(b) === expected, 'SOURCE_DIGEST');
    return {
      file: fileURLToPath(url as URL)
        .split(sep)
        .at(-1),
      bytes: b.length,
      sha256: expected,
    };
  });
}
function historyAdmission() {
  for (const [name, pin] of Object.entries(f.archive)) {
    const commit = name.startsWith('biased') ? f.biasedCommit : f.archiveCommit;
    const bytes = execFileSync('git', ['show', commit + ':' + pin.path], {
      cwd: repo,
      maxBuffer: 1 << 20,
    });
    demand(bytes.length === pin.bytes && hash(bytes) === pin.sha256, 'IMMUTABLE_GIT_BLOB_' + name);
  }
  return Object.fromEntries(
    Object.entries(f.archive).map(([k, v]) => [
      k,
      { path: v.path, bytes: v.bytes, sha256: v.sha256 },
    ]),
  );
}
async function rawAdmission(path: string) {
  demand(isAbsolute(path), 'EXPLICIT_ARCHIVED_RAW_PATH');
  const st = lstatSync(path);
  demand(
    st.isFile() && !st.isSymbolicLink() && st.size === f.biasedRaw.bytes,
    'ARCHIVED_RAW_WIDTH',
  );
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  demand(digest.digest('hex') === f.biasedRaw.sha256, 'ARCHIVED_RAW_SHA');
  return f.biasedRaw;
}
function engineAdmission(path: string, license: string) {
  demand(
    isAbsolute(path) && realpathSync(path) === resolve(path) && isAbsolute(license),
    'ABSOLUTE_ENGINE_AND_LICENSE',
  );
  const e = f.engine;
  const glue = pinned(join(path, e.glue.file), e.glue),
    wasm = pinned(join(path, e.wasm.file), e.wasm);
  pinned(join(path, e.declarations.file), e.declarations);
  pinned(license, e.license);
  const build = pinned(join(dirname(path), 'build-receipt.json'), e.buildReceipt),
    browser = pinned(join(dirname(path), 'browser-receipt.json'), e.browserReceipt);
  demand(
    JSON.parse(build.toString()).accepted === true &&
      JSON.parse(browser.toString()).accepted === true &&
      JSON.parse(browser.toString()).buildReceiptSha256 === e.buildReceipt.sha256,
    'ACCEPTED_AOT_RECEIPTS',
  );
  demand(wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { path, glue, wasm };
}
type Initialization = { attempted: number; returned: number; phase: string };
async function loadNative(
  input: ReturnType<typeof engineAdmission>,
  init: Initialization,
  mode: NativeMode = 'original',
) {
  demand(selectedNativeMode() === mode && init.attempted === 0, 'EXPLICIT_ONCE_NATIVE_ADMISSION');
  init.attempted++;
  init.phase = 'glue-import';
  const path = join(input.path, f.engine.glue.file);
  pinned(path, f.engine.glue);
  const { default: factory } = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as {
    default(options: { wasmBinary: Buffer; locateFile(n: string): string }): Promise<Native>;
  };
  pinned(path, f.engine.glue);
  init.phase = 'factory';
  const M = await factory({
    wasmBinary: input.wasm,
    locateFile(n) {
      demand(n === 'mujoco.wasm', 'UNREGISTERED_NATIVE_RESOURCE');
      return join(input.path, n);
    },
  });
  init.returned++;
  init.phase = 'version-readback';
  demand(M.mj_version() === 4000000 && M.mj_versionString() === '4.0.0', 'EXACT_NATIVE_VERSION');
  return M;
}
function outputRoot(path: string) {
  demand(isAbsolute(path), 'EXTERNAL_OUTPUT_ABSOLUTE');
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
    'NEW_EXISTING_OS_TEMP_DIRECTORY',
  );
  return p;
}
const files = {
  meta: 'mujoco-finite-cap-near-threshold.jsonl',
  binary: 'mujoco-finite-cap-near-threshold.bin',
};
class Journal {
  readonly meta: number;
  readonly bin: number;
  bytes = 0;
  metadata = 0;
  errorBytes = 0;
  readonly digest = createHash('sha256');
  constructor(
    readonly root: string,
    readonly diagnostic = false,
  ) {
    const names = diagnostic ? g.files : files;
    this.meta = openSync(join(root, names.meta), 'wx', 0o600);
    try {
      this.bin = openSync(join(root, names.binary), 'wx', 0o600);
    } catch (e) {
      try {
        writeSync(
          this.meta,
          JSON.stringify({ kind: 'admission-error', error: String(e), step1: 0, step2: 0 }) + '\n',
        );
        fsyncSync(this.meta);
      } finally {
        closeSync(this.meta);
      }
      throw e;
    }
  }
  write(v: unknown, error = false) {
    const b = Buffer.from(
      JSON.stringify(v, (_k, x: unknown) =>
        typeof x === 'number'
          ? Object.is(x, -0)
            ? 'float64:-0'
            : Number.isFinite(x)
              ? x
              : String(x)
          : x,
      ) + '\n',
    );
    demand(
      (error ? this.errorBytes : this.metadata) + b.length <=
        (error ? f.capture.errorBytes : f.capture.metadataBytes),
      'METADATA_CAP',
    );
    demand(writeSync(this.meta, b) === b.length, 'METADATA_SHORT_WRITE');
    if (error) this.errorBytes += b.length;
    else this.metadata += b.length;
  }
  reserve() {
    demand(
      this.bytes + 1872 + f.capture.metadataBytes + f.capture.errorBytes <= f.capture.maxBytes &&
        (!this.diagnostic || this.bytes + 1872 <= g.capture.maxBinaryBytes),
      'CAPACITY_BEFORE_NATIVE_ADVANCE',
    );
  }
  frame(b: Buffer) {
    demand(b.length === 1872 && writeSync(this.bin, b) === b.length, 'BINARY_SHORT_WRITE');
    this.bytes += b.length;
    this.digest.update(b);
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
type Census = {
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  models: number;
  data: number;
};
function resources(): Resources {
  return {
    temporaryCreated: 0,
    temporaryDeleted: 0,
    contactVectorsCreated: 0,
    contactGetsCreated: 0,
    warningGetsCreated: 0,
    contactForceCalls: 0,
    velocityCalls: 0,
  };
}
function inputValues(d: Data) {
  f64(d.act, 0, 'ACT');
  return [...f64(d.qfrc_applied, 7, 'QFRC_APPLIED'), ...f64(d.xfrc_applied, 18, 'XFRC_APPLIED')];
}
function validateFactory(h: Helpers, r: Readback, initial: State) {
  demand(
    r.options.disableflags === 65536 && r.options.enableflags === 32,
    'EXACT_SHARED_NATIVE_CCD_PROFILE',
  );
  const q = [Math.cos(base / 2), 0, Math.sin(base / 2), 0],
    height = 0.0575 + 0.0001,
    pos = [height * Math.sin(base), 0, height * Math.cos(base)],
    identity = [1, 0, 0, 0];
  demand(
    call<boolean>(h.observer, 'canonicalEqual', r.body_pos, [0, 0, 0, 0, 0, 0, ...pos]) &&
      call<boolean>(h.observer, 'canonicalEqual', r.body_quat, [...identity, ...q, ...q]) &&
      phaseBytes(initial).equals(phaseBytes(f.model.initial)),
    'EXACT_BIASED_FACTORY_POSES',
  );
  // Check the two deliberate, frozen factory/profile deltas first. The pure old
  // validator receives a validation-only unrotated/legacy-flag copy, never native state.
  call<Ids>(
    h.harness,
    'validateModel',
    c,
    h.condition,
    {
      ...r,
      body_pos: [0, 0, 0, 0, 0, 0, 0, 0, height],
      body_quat: [...identity, ...identity, ...identity],
      options: { ...r.options, disableflags: 196608 },
    },
    { ...initial, qpos: [0, 0, 0, height, ...identity] },
  );
}
function verifyBodies(h: Helpers, pre: State, forward: Forward) {
  const derived = stateBodies(h, pre);
  for (const id of [0, 1, 2]) {
    const a = forward.bodies[id]!,
      b = derived[id]!;
    demand(
      norm(sub(a.com, b.com)) <= 1e-12 &&
        Math.max(...a.rotation.map((v, i) => Math.abs(v - b.rotation[i]!))) <= 1e-12 &&
        norm(sub(a.velocity, b.velocity)) <= 1e-9 &&
        norm(sub(a.omega, b.omega)) <= 1e-9,
      'EXACT_NATIVE_BODY_TREE_MAPPING',
    );
  }
}
function validatePreRows(forward: Forward) {
  const occupied = new Set<number>();
  demand(
    forward.ncon === forward.contacts.length &&
      forward.efcType.length === forward.nefc &&
      forward.efcId.length === forward.nefc &&
      forward.efcVel.length === forward.nefc,
    'PRE_EXACT_ROW_WIDTHS',
  );
  for (const [index, contact] of forward.contacts.entries()) {
    if (contact.efc_address === -1) continue;
    demand(
      Number.isInteger(contact.efc_address) &&
        contact.efc_address >= 0 &&
        contact.efc_address % 3 === 0 &&
        contact.efc_address + 3 <= forward.nefc,
      'PRE_CONTACT_ROW_ADDRESS',
    );
    for (let j = 0; j < 3; j++) {
      const row = contact.efc_address + j;
      demand(
        !occupied.has(row) && forward.efcType[row] === 7 && forward.efcId[row] === index,
        'PRE_NATIVE_ROW_IDENTITY',
      );
      occupied.add(row);
    }
  }
  demand(occupied.size === forward.nefc, 'PRE_NO_ORPHAN_ROWS');
}
function solvedRowsMatch(forward: Forward, post: Rows, postContacts: Contact[], o: Module) {
  demand(
    forward.ncon === post.ncon &&
      forward.nefc === post.nefc &&
      same(forward.efcType, post.type) &&
      same(forward.efcId, post.id),
    'UNCHANGED_SOLVED_NATIVE_ROWS',
  );
  demand(
    postContacts.length === forward.contacts.length &&
      forward.contacts.every((v, i) =>
        call<boolean>(
          o,
          'canonicalEqual',
          call(o, 'contactIdentity', v),
          call(o, 'contactIdentity', postContacts[i]),
        ),
      ),
    'UNCHANGED_NATIVE_CONTACT_IDENTITY',
  );
}
type Hook = {
  strictDynamic: true;
  shape: { nq: number; nv: number; nu: number; nbody: number; ngeom: number; solverSlots: number };
  keyframes: number;
  warningCount: number;
  invoke<T>(api: string, fn: () => T): T;
  stop(e: unknown): void;
};
function warning(h: Helpers, d: Data, r: Resources, hooks: Hook) {
  return call<number[][]>(h.observer, 'copyWarnings', d, r, hooks);
}
function stageDataFailure(d: Data) {
  const v: Record<string, unknown> = {};
  for (const name of [
    'time',
    'ncon',
    'nefc',
    'nJ',
    'nisland',
    'ntree_awake',
    'qpos',
    'qvel',
    'qacc',
    'qacc_warmstart',
    'ctrl',
    'qfrc_applied',
    'xfrc_applied',
    'qfrc_constraint',
    'qfrc_actuator',
  ]) {
    try {
      const x = d[name];
      v[name] = ArrayBuffer.isView(x) ? Array.from(x as Float64Array) : x;
    } catch (e) {
      v[name] = { readError: String(e) };
    }
  }
  return v;
}
async function runWorld(
  M: Native,
  h: Helpers,
  rate: Rate,
  world: number,
  journal: Journal,
  total: Census,
  diagnostic?: DiagnosticContext,
) {
  const maxIntervals = diagnostic ? g.schedule[rate].maxIntervals : f.schedule[rate].maxIntervals;
  const r = resources(),
    local = {
      step1: 0,
      step1Returned: 0,
      step2: 0,
      step2Returned: 0,
      modelAttempted: 0,
      modelReturned: 0,
      modelDeleteAttempted: 0,
      modelDeleted: 0,
      dataAttempted: 0,
      dataReturned: 0,
      dataDeleteAttempted: 0,
      dataDeleted: 0,
      bufferAttempted: 0,
      bufferReturned: 0,
      bufferDeleteAttempted: 0,
      bufferDeleted: 0,
    };
  const apiCalls: Record<string, number> = {},
    apiReturned: Record<string, number> = {};
  let nativeStop: unknown;
  const hooks: Hook = {
    strictDynamic: true,
    shape: { nq: 8, nv: 7, nu: 1, nbody: 3, ngeom: 2, solverSlots: 20 },
    keyframes: 0,
    warningCount: 7,
    invoke<T>(api: string, fn: () => T): T {
      if (nativeStop && !api.endsWith('.delete')) throw nativeStop;
      apiCalls[api] = (apiCalls[api] ?? 0) + 1;
      try {
        const value = fn();
        apiReturned[api] = (apiReturned[api] ?? 0) + 1;
        return value;
      } catch (error) {
        nativeStop ??= error;
        throw error;
      }
    },
    stop(e) {
      nativeStop ??= e;
    },
  };
  const limits = {
    maxContacts: 4,
    maxConstraintRows: 12,
    maxIslands: 2,
    pairCaps: [{ geom: [0, 1], maxContacts: 4 }],
    maxContactVectors: 2 * maxIntervals,
    maxContactGets: 8 * maxIntervals,
  };
  let model: Model | undefined,
    data: Data | undefined,
    six: BufferHandle | undefined,
    deltaBuffer: BufferHandle | undefined,
    certificate: Certificate | undefined;
  let pending: Record<string, unknown> | undefined,
    primary: unknown,
    failureData: Record<string, unknown> | undefined,
    stage = 'factory';
  const cleanup: string[] = [];
  const startOffset = journal.bytes;
  try {
    demand(total.models < 2 && total.data < 2, 'TWO_FRESH_WORLDS_ONLY');
    local.modelAttempted++;
    model = M.MjModel.from_xml_string(f.model.xml);
    local.modelReturned++;
    total.models++;
    local.dataAttempted++;
    data = new M.MjData(model);
    local.dataReturned++;
    total.data++;
    local.bufferAttempted++;
    six = new M.DoubleBuffer(6);
    local.bufferReturned++;
    local.bufferAttempted++;
    deltaBuffer = new M.DoubleBuffer(7);
    local.bufferReturned++;
    const initial = copyState(data),
      readback = call<Readback>(h.harness, 'readModel', model, hooks),
      initialWarnings = warning(h, data, r, hooks);
    journal.write({
      kind: 'world-start',
      world,
      rate,
      startOffset,
      initial,
      readback,
      initialWarnings,
      ...(diagnostic
        ? { profileId: rate === 'normal' ? 'normal_prefix_ramp250' : 'normal_prefix_ramp500' }
        : {}),
    });
    validateFactory(h, readback, initial);
    demand(
      initialWarnings.flat().every((x) => x === 0) && M.mj_maxContact(model, 0, 1, 0) === 4,
      'WARNING_BASELINE_AND_ALLOCATION',
    );
    zeroMask(inputValues(data));
    certificate = diagnostic
      ? new DiagnosticCertificate(h, rate, world, initial, diagnostic)
      : new Certificate(h, rate, world, initial);
    for (let tick = 1; tick <= maxIntervals; tick++) {
      stage = 'pre-step1';
      const totalCap = diagnostic ? g.schedule.maxIntervals : 135500;
      demand(total.step1 < totalCap && total.step2 < totalCap, 'TOTAL_NATIVE_CAP');
      journal.reserve();
      const pre = copyState(data),
        inputsPre = inputValues(data),
        ctl = diagnostic ? diagnosticControl(h, rate, tick - 1) : control(h, rate, tick - 1);
      zeroMask(inputsPre);
      data.ctrl[0] = ctl.u;
      demand(Object.is(f64(data.ctrl, 1, 'CTRL')[0], ctl.u), 'ACTUAL_CTRL_READBACK');
      pending = { world, rate, tick, pre, ctl, inputsPre };
      local.step1++;
      total.step1++;
      hooks.invoke('mj_step1', () => M.mj_step1(model!, data!));
      local.step1Returned++;
      total.step1Returned++;
      stage = 'post-step1';
      const phase = copyState(data);
      pending.phase = phase;
      demand(phaseBytes(phase).equals(phaseBytes(pre)), 'ACTUAL_STEP1_CANNOT_CHANGE_PHASE');
      const phaseWarnings = warning(h, data, r, hooks);
      pending.phaseWarnings = phaseWarnings;
      demand(
        phaseWarnings.flat().every((x) => x === 0),
        'PHASE_WARNING',
      );
      zeroMask(inputValues(data));
      const forward = call<Forward>(
        h.observer,
        'captureForward',
        M,
        model,
        data,
        pre,
        h.ids,
        r,
        six,
        limits,
        hooks,
      );
      pending.forward = forward;
      validatePreRows(forward);
      verifyBodies(h, pre, forward);
      demand(data.nJ === forward.nefc * 7, 'PRE_DENSE_J_WIDTH');
      const jacobian = f64(data.efc_J, data.nJ, 'PRE_DENSE_J'),
        awakePhase = data.ntree_awake;
      pending.jacobian = jacobian;
      pending.awakePhase = awakePhase;
      // Validate dictionary compressibility and raw capacity while still before STEP2.
      forward.contacts.forEach(materialMask);
      journal.reserve();
      stage = 'step2';
      local.step2++;
      total.step2++;
      hooks.invoke('mj_step2', () => M.mj_step2(model!, data!));
      local.step2Returned++;
      total.step2Returned++;
      stage = 'post-step2';
      const post = copyState(data);
      pending.post = post;
      const rows = nativeRows(data);
      pending.rows = rows;
      const efcForce = f64(data.efc_force, rows.nefc, 'SOLVED_EFC_FORCE');
      pending.efcForce = efcForce;
      const after = call<Contact[]>(h.observer, 'copyContacts', data, r, limits, hooks);
      pending.postContacts = after;
      solvedRowsMatch(forward, rows, after, h.observer);
      const nativeForces: number[][] = [];
      pending.nativeForces = nativeForces;
      for (let i = 0; i < rows.ncon; i++) {
        hooks.invoke('mj_contactForce', () => M.mj_contactForce(model!, data!, i, six!));
        r.contactForceCalls++;
        nativeForces.push(f64(six.GetView(), 6, 'CONTACT_FORCE'));
      }
      const postWarnings = warning(h, data, r, hooks),
        qfrcConstraint = f64(data.qfrc_constraint, 7, 'QFRC_CONSTRAINT'),
        qfrcActuator = f64(data.qfrc_actuator, 7, 'QFRC_ACTUATOR'),
        actuatorForce = f64(data.actuator_force, 1, 'ACTUATOR_FORCE'),
        solverIterations = i32(data.solver_niter, 20, 'SOLVER_ITERATIONS'),
        islands = data.nisland,
        inputsPost = inputValues(data),
        ctrl = f64(data.ctrl, 1, 'POST_CTRL')[0]!;
      const force: Force = {
        contacts: after.map((v, i) => ({ ...v, force: nativeForces[i]! })),
        efcForce,
        qfrcConstraint,
        qfrcActuator,
        actuatorForce,
        endpoint: post,
        warnings: postWarnings,
        solverIterations,
        islands,
        qacc: post.qacc,
      };
      pending.force = force;
      demand(call<boolean>(h.observer, 'finite', force), 'FINITE_SOLVED_NATIVE_FORCE');
      hooks.invoke('mj_differentiatePos', () =>
        M.mj_differentiatePos(model!, deltaBuffer!, dt, pre.qpos, post.qpos),
      );
      const delta = f64(deltaBuffer.GetView(), 7, 'NATIVE_CONFIGURATION_TANGENT').map(
        (v) => v * dt,
      );
      const packets = forward.contacts.map((ct, i): PackedContact => {
        const address = ct.efc_address,
          active = address >= 0;
        const relative = call<Vec>(
          h.observer,
          'relativePointVelocity',
          ct.pos,
          forward.bodies[h.ids.geomBodies[ct.geom1]!]!,
          forward.bodies[h.ids.geomBodies[ct.geom2]!]!,
        );
        return {
          contact: ct,
          force: nativeForces[i]!,
          relative,
          rowForce: active ? efcForce.slice(address, address + 3) : [0, 0, 0],
          rowVelocity: active ? forward.efcVel.slice(address, address + 3) : [0, 0, 0],
          jdelta: active
            ? [0, 1, 2].map((j) =>
                dot(jacobian.slice((address + j) * 7, (address + j + 1) * 7), delta),
              )
            : [0, 0, 0],
          rowType: active ? forward.efcType.slice(address, address + 3) : [],
          rowId: active ? forward.efcId.slice(address, address + 3) : [],
        };
      });
      const torque = call<Torque>(
        h.observer,
        'effectiveTorque',
        ctrl,
        pre.qpos[0],
        pre.qvel[0],
        post.qvel[0],
        actuatorForce[0],
        c.stand,
      );
      const packet: Packet = {
        world,
        tick,
        pre,
        phase,
        post,
        phaseHash: hash(phaseBytes(phase)),
        contacts: packets,
        ncon: rows.ncon,
        nefc: rows.nefc,
        nJ: data.nJ,
        islands,
        solverIterations: solverIterations.slice(0, 2),
        awakePhase,
        awakePost: data.ntree_awake,
        phaseWarnings,
        postWarnings,
        ctrl,
        nativeForce: actuatorForce[0]!,
        qfrcActuator,
        qfrcConstraint,
        inputsPre,
        inputsPost,
        effective: torque.effective,
        signedWork: dt * torque.effective * ((pre.qvel[0]! + post.qvel[0]!) / 2),
        rowIdentity: true,
      };
      pending.packet = packet;
      const bytes = encode(packet);
      journal.frame(bytes);
      stage = 'independent-physical-certificate';
      compareNativeCertificate(h, packet, forward, force, !certificate.firstConfirmed);
      certificate.observe(packet, bytes);
      pending = undefined;
      if (certificate.done) break;
    }
    demand(certificate.done, 'REGISTERED_HORIZON_WITHOUT_STOP');
    stage = 'complete';
  } catch (e) {
    primary = nativeStop ?? e;
    if (data) failureData = stageDataFailure(data);
  }
  for (const [kind, handle] of [
    ['buffer', deltaBuffer],
    ['buffer', six],
    ['data', data],
    ['model', model],
  ] as const) {
    if (!handle) continue;
    if (kind === 'buffer') local.bufferDeleteAttempted++;
    else if (kind === 'data') local.dataDeleteAttempted++;
    else local.modelDeleteAttempted++;
    try {
      handle.delete();
      if (kind === 'buffer') local.bufferDeleted++;
      else if (kind === 'data') local.dataDeleted++;
      else local.modelDeleted++;
    } catch (e) {
      cleanup.push(kind + ': ' + String(e));
    }
  }
  try {
    journal.write(
      {
        kind: 'world-resources',
        world,
        rate,
        stage,
        local,
        resources: r,
        apiCalls,
        apiReturned,
        startOffset,
        endOffset: journal.bytes,
        primary: primary ? String(primary) : null,
        cleanup,
        pending: primary ? pending : undefined,
        failureData,
      },
      true,
    );
  } catch (e) {
    cleanup.push('resource receipt: ' + String(e));
    primary ??= e;
  }
  if (primary || cleanup.length || (r.cleanupErrors?.length ?? 0) > 0)
    throw Object.assign(
      primary instanceof Error
        ? primary
        : new Error(primary ? String(primary) : 'NATIVE_CLEANUP_FAILED'),
      { local, resources: r, cleanup },
    );
  demand(
    certificate &&
      local.modelReturned === 1 &&
      local.modelDeleted === 1 &&
      local.dataReturned === 1 &&
      local.dataDeleted === 1 &&
      local.bufferReturned === 2 &&
      local.bufferDeleted === 2 &&
      r.temporaryCreated === r.temporaryDeleted &&
      Object.keys(apiCalls).every((key) => apiCalls[key] === apiReturned[key]) &&
      local.step1 === local.step1Returned &&
      local.step2 === local.step2Returned &&
      local.step2 === certificate.tick,
    'BALANCED_NATIVE_WORLD',
  );
  const outcome = certificate.finish();
  journal.write({ kind: 'world-end', world, rate, startOffset, endOffset: journal.bytes, outcome });
  return outcome;
}

type Outcome = ReturnType<Certificate['finish']>;
function assessPair(outcomes: Outcome[]) {
  demand(
    outcomes.length === 2 && outcomes[0]!.rate === 'normal' && outcomes[1]!.rate === 'slow',
    'TWO_ORDERED_RATES',
  );
  const indices = outcomes.map((v) => v.firstConfirmed?.targetIndex ?? null),
    difference =
      indices[0] !== null && indices[1] !== null ? Math.abs(indices[0]! - indices[1]!) : null;
  const pass =
    outcomes.every((v) => v.physical === 'PASS') && difference !== null && difference <= 1;
  return {
    physical: pass ? 'PASS' : 'FAIL',
    scope: 'LOCAL_BIASED_THRESHOLD_ONLY',
    formalAcceptance: 'D01_D02_OPEN',
    firstTargetIndices: indices,
    targetIndexDifference: difference,
    criticalAngleRad: c.tilt.tip.criticalAngleRad,
    criticalAngleDeg: (c.tilt.tip.criticalAngleRad * 180) / Math.PI,
    outcomes,
  };
}
function checkResources(record: Record<string, unknown>, intervals: number, contacts: number) {
  const local = record.local as Record<string, number>,
    r = record.resources as Resources,
    api = record.apiCalls as Record<string, number>,
    returned = record.apiReturned as Record<string, number>;
  demand(
    api &&
      returned &&
      Object.keys(api).every((k) => api[k] === returned[k]) &&
      api.mj_step1 === intervals &&
      api.mj_step2 === intervals &&
      (api.mj_contactForce ?? 0) === contacts &&
      api.mj_differentiatePos === intervals &&
      api.mj_objectVelocity === 3 * intervals &&
      api['warning.get'] === 7 * (2 * intervals + 1),
    'EXACT_NATIVE_API_ATTEMPT_RETURN',
  );
  demand(
    record.stage === 'complete' &&
      record.primary === null &&
      same(record.cleanup, []) &&
      (r.cleanupErrors?.length ?? 0) === 0,
    'COMPLETE_SAFE_RESOURCES',
  );
  for (const key of [
    'modelAttempted',
    'modelReturned',
    'modelDeleteAttempted',
    'modelDeleted',
    'dataAttempted',
    'dataReturned',
    'dataDeleteAttempted',
    'dataDeleted',
  ])
    demand(local[key] === 1, 'ONE_MODEL_DATA_' + key);
  for (const key of ['bufferAttempted', 'bufferReturned', 'bufferDeleteAttempted', 'bufferDeleted'])
    demand(local[key] === 2, 'TWO_BUFFERS_' + key);
  for (const key of ['step1', 'step1Returned', 'step2', 'step2Returned'])
    demand(local[key] === intervals, 'EXACT_PHASE_COUNT_' + key);
  demand(
    r.contactVectorsCreated === 2 * intervals &&
      r.contactGetsCreated === 2 * contacts &&
      r.contactForceCalls === contacts &&
      r.warningGetsCreated === 7 * (2 * intervals + 1) &&
      r.velocityCalls === 3 * intervals &&
      r.temporaryCreated === r.temporaryDeleted,
    'EXACT_TEMPORARY_OWNERSHIP',
  );
}
function parseLine(line: string) {
  return JSON.parse(line, (_k, v: unknown) => (v === 'float64:-0' ? -0 : v)) as Record<
    string,
    unknown
  >;
}
async function replay(
  h: Helpers,
  root: string,
  live: Outcome[],
): Promise<ReturnType<typeof assessPair>>;
async function replay(
  h: Helpers,
  root: string,
  live: Outcome[],
  diagnostic: DiagnosticContext,
): Promise<ReturnType<typeof assessDiagnosticPair>>;
async function replay(h: Helpers, root: string, live: Outcome[], diagnostic?: DiagnosticContext) {
  const names = diagnostic ? g.files : files;
  const binary = readFileSync(join(root, names.binary)),
    metadata = readFileSync(join(root, names.meta), 'utf8').trim().split('\n').map(parseLine);
  let offset = 0;
  const outcomes: Outcome[] = [];
  for (const [world, rate] of (['normal', 'slow'] as const).entries()) {
    const start = metadata.find((v) => v.kind === 'world-start' && v.world === world),
      end = metadata.find((v) => v.kind === 'world-end' && v.world === world),
      r = metadata.find((v) => v.kind === 'world-resources' && v.world === world);
    demand(
      start &&
        end &&
        r &&
        start.startOffset === offset &&
        end.endOffset === r.endOffset &&
        Number.isSafeInteger(end.endOffset),
      'REPLAY_WORLD_BOUNDARIES',
    );
    validateFactory(h, start.readback as Readback, start.initial as State);
    const cert = diagnostic
      ? new DiagnosticCertificate(h, rate, world, start.initial as State, diagnostic)
      : new Certificate(h, rate, world, start.initial as State);
    let contacts = 0;
    demand(
      (end.endOffset as number) >= offset &&
        (end.endOffset as number) <= binary.length &&
        ((end.endOffset as number) - offset) % 1872 === 0,
      'REPLAY_FIXED_FRAME_ALIGNMENT',
    );
    while (offset < (end.endOffset as number)) {
      const raw = binary.subarray(offset, offset + 1872),
        p = decode(raw);
      cert.observe(p, raw);
      contacts += p.ncon;
      offset += 1872;
    }
    const reconstructed = cert.finish();
    checkResources(r, cert.tick, contacts);
    demand(
      same(reconstructed, end.outcome) && same(reconstructed, live[world]),
      'RECOMPUTED_PHYSICAL_CERTIFICATE',
    );
    outcomes.push(reconstructed);
  }
  demand(offset === binary.length, 'NO_TRAILING_BINARY');
  return diagnostic ? assessDiagnosticPair(outcomes) : assessPair(outcomes);
}
type ArchivedInterval = {
  kind: string;
  engine: string;
  tick: number;
  pre: State;
  post: State;
  forward: Forward;
  force: Force;
  rows: { ncon: number; nefc: number; efcType: number[]; efcId: number[] };
  retainedForce: number[];
  torque: { effective: number };
  signedWork: number;
  support: Support;
  control: Control;
};
function archivePacket(h: Helpers, v: ArchivedInterval): Packet {
  const contacts = v.forward.contacts.map((ct, i): PackedContact => {
    const active = ct.efc_address >= 0,
      a = ct.efc_address;
    return {
      contact: ct,
      force: v.force.contacts[i]!.force,
      relative: call<Vec>(
        h.observer,
        'relativePointVelocity',
        ct.pos,
        v.forward.bodies[h.ids.geomBodies[ct.geom1]!]!,
        v.forward.bodies[h.ids.geomBodies[ct.geom2]!]!,
      ),
      rowForce: active ? v.force.efcForce.slice(a, a + 3) : [0, 0, 0],
      rowVelocity: active ? v.forward.efcVel.slice(a, a + 3) : [0, 0, 0],
      rowType: active ? v.forward.efcType.slice(a, a + 3) : [],
      rowId: active ? v.forward.efcId.slice(a, a + 3) : [],
      // Historical receipt has no Jdelta/phase-warning/zero-input vector fields.
      // These are synthetic unit-test slots, never new historical native evidence.
      jdelta: [0.000123, -0, -0.000456],
    };
  });
  return {
    world: v.engine === 'candidate' ? 0 : 1,
    tick: v.tick,
    pre: v.pre,
    phase: v.forward.state,
    post: v.post,
    phaseHash: hash(phaseBytes(v.forward.state)),
    contacts,
    ncon: v.forward.ncon,
    nefc: v.forward.nefc,
    nJ: v.forward.nefc * 7,
    islands: v.force.islands,
    solverIterations: v.force.solverIterations.slice(0, 2),
    awakePhase: 2,
    awakePost: 2,
    phaseWarnings: Array.from({ length: 7 }, () => [0, 0]),
    postWarnings: v.force.warnings,
    ctrl: v.control.u,
    nativeForce: v.force.actuatorForce[0]!,
    qfrcActuator: v.force.qfrcActuator,
    qfrcConstraint: v.force.qfrcConstraint,
    inputsPre: Array<number>(25).fill(0),
    inputsPost: Array<number>(25).fill(0),
    effective: v.torque.effective,
    signedWork: v.signedWork,
    rowIdentity: true,
  };
}
function retainedProjection(p: Packet) {
  return {
    ...p,
    phase: { qpos: p.phase.qpos, qvel: p.phase.qvel, time: p.phase.time },
    contacts: p.contacts.map((v) => {
      const contact = Object.fromEntries(
        Object.entries(v.contact).filter(([key]) => key !== 'mu' && key !== 'H'),
      );
      return { ...v, contact };
    }),
  };
}
async function checkArchivedProjection(h: Helpers, path: string) {
  await rawAdmission(path);
  let intervals = 0,
    candidateFour = 0,
    stockFour = 0,
    candidateIntervals = 0,
    stockIntervals = 0;
  const digest = createHash('sha256');
  const input = createReadStream(path);
  const reader = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      demand(Buffer.byteLength(line) <= 16384, 'BOUNDED_ARCHIVED_LINE');
      const raw = parseLine(line);
      if (raw.kind === 'header') {
        demand(
          raw.xml === f.model.xml &&
            raw.sourceSha256 === f.archive.biasedSpec.sha256 &&
            raw.fixtureSha256 === f.archive.biasedFixture.sha256,
          'EXACT_ARCHIVED_HEADER',
        );
        continue;
      }
      if (raw.kind !== 'interval') continue;
      const v = raw as unknown as ArchivedInterval;
      const p = archivePacket(h, v);
      materialValues(f.material);
      solvedRowsMatch(
        v.forward,
        { ncon: v.rows.ncon, nefc: v.rows.nefc, type: v.rows.efcType, id: v.rows.efcId },
        v.force.contacts,
        h.observer,
      );
      const compact = encode(p),
        restored = decode(compact);
      demand(
        call<boolean>(
          h.observer,
          'canonicalEqual',
          retainedProjection(p),
          retainedProjection(restored),
        ),
        'ARCHIVE_COMPACT_PROJECTION_ROUNDTRIP',
      );
      const support = supportCertificate(h, restored);
      demand(
        Object.is(support.maxSlip, v.support.maxSlip) &&
          Object.is(support.outwardForce, v.support.outwardForce) &&
          support.loaded === v.support.loaded &&
          support.supported === v.support.supported &&
          support.downhillRim === v.support.downhillRim,
        'ARCHIVE_EXACT_PHYSICAL_CERTIFICATE',
      );
      digest.update(compact);
      intervals++;
      if (v.engine === 'candidate') {
        candidateIntervals++;
        if (p.ncon === 4) candidateFour++;
      } else {
        stockIntervals++;
        if (p.ncon === 4) stockFour++;
      }
    }
  } finally {
    reader.close();
    input.destroy();
  }
  demand(
    intervals === 13000 &&
      candidateIntervals === 6500 &&
      stockIntervals === 6500 &&
      candidateFour === 41 &&
      stockFour === 4058,
    'COMPLETE_ARCHIVED_COMPACT_CHECK',
  );
  return {
    intervals,
    candidateFour,
    stockFour,
    sha256: digest.digest('hex'),
    projectionOnly: true,
    notNewPhysicalMeasurement: true,
  };
}

it('pins pure archive exports, exact XML and immutable two-rate capacity before any native import', async () => {
  validateFixture();
  const h = await helpers();
  validateFactory(h, f.model.readbackExample as Readback, f.model.initial);
  expect(f.schedule.normal.maxIntervals + f.schedule.slow.maxIntervals).toBe(135500);
  expect(135500 * 1872 + 4194304 + 8388608).toBe(266238912);
  expect(266238912).toBeLessThan(268435456);
  expect(control(h, 'normal', 4000).stage).toBe(1);
  expect(control(h, 'slow', 4000).stage).toBe(1);
  expect(control(h, 'normal', 6500).u).toBeCloseTo((0.24 * Math.PI) / 180, 15);
  expect(() => call(h.harness, 'cylinderPlan', c, 'admission')).toThrow('PURE_EXPORT_ALLOWLIST');
});
it.skipIf(!process.env['ASA_D01_NEAR_BIASED_RAW'])(
  'losslessly compacts all13000 frozen rows including candidate4-contact and independently preserves old contact oracles',
  async () => {
    const h = await helpers(),
      v = await checkArchivedProjection(h, process.env['ASA_D01_NEAR_BIASED_RAW']!);
    expect(v.intervals).toBe(13000);
  },
  30000,
);
it.skipIf(!process.env['ASA_D01_NEAR_ENGINE'] || !process.env['ASA_D01_NEAR_LICENSE'])(
  'pins current AOT assets without importing engine glue',
  () => {
    const v = engineAdmission(
      process.env['ASA_D01_NEAR_ENGINE']!,
      process.env['ASA_D01_NEAR_LICENSE']!,
    );
    expect(v.wasm.length).toBe(11229000);
    historyAdmission();
  },
);
it.skipIf(process.env['ASA_D01_NEAR_RUN'] !== 'two-local-frozen-rates-1071')(
  'acquires exactly the registered two local native threshold worlds',
  async () => {
    const root = outputRoot(process.env['ASA_D01_NEAR_OUTPUT'] ?? ''),
      journal = new Journal(root),
      init: Initialization = { attempted: 0, returned: 0, phase: 'not-imported' },
      total: Census = {
        step1: 0,
        step1Returned: 0,
        step2: 0,
        step2Returned: 0,
        models: 0,
        data: 0,
      };
    let primary: unknown, result: ReturnType<typeof assessPair> | undefined, closeErrors: string[];
    const receiptErrors: string[] = [];
    try {
      demand(selectedNativeMode() === 'original', 'ORIGINAL_MODE_ONLY');
      validateFixture();
      const sources = sourceAdmission(),
        history = historyAdmission(),
        h = await helpers(),
        offline = await checkArchivedProjection(h, process.env['ASA_D01_NEAR_BIASED_RAW'] ?? ''),
        engine = engineAdmission(
          process.env['ASA_D01_NEAR_ENGINE'] ?? '',
          process.env['ASA_D01_NEAR_LICENSE'] ?? '',
        );
      journal.write({
        kind: 'header',
        scope: 'TEST_ONLY',
        fixture: f,
        sources,
        history,
        offline,
        schema,
        modelSha256: hash(f.model.xml),
        nativeInitialized: false,
        init,
        total,
        node: process.version,
      });
      fsyncSync(journal.meta);
      const header = readFileSync(join(root, files.meta)),
        readback = parseLine(header.toString());
      demand(
        header.length === journal.metadata &&
          same(readback.fixture, f) &&
          same(readback.sources, sources) &&
          same(readback.schema, schema),
        'ON_DISK_ADMISSION_HEADER',
      );
      journal.write({
        kind: 'header-readback',
        bytes: header.length,
        sha256: hash(header),
        nativeInitialized: false,
        init,
        total,
      });
      const M = await loadNative(engine, init),
        outcomes: Outcome[] = [];
      for (const [world, rate] of (['normal', 'slow'] as const).entries())
        outcomes.push(await runWorld(M, h, rate, world, journal, total));
      demand(
        init.attempted === 1 &&
          init.returned === 1 &&
          total.models === 2 &&
          total.data === 2 &&
          total.step1 === total.step1Returned &&
          total.step2 === total.step2Returned &&
          total.step1 === total.step2 &&
          total.step2 === outcomes.reduce((s, v) => s + v.intervals, 0),
        'EXACT_TWO_WORLD_NATIVE_ACCOUNTING',
      );
      fsyncSync(journal.bin);
      result = await replay(h, root, outcomes);
      journal.write(
        {
          kind: 'finish',
          runtime: 'COMPLETE',
          physical: result.physical,
          acquisition: 'CONSUMED',
          formalAcceptance: 'D01_D02_OPEN',
          init,
          total,
          result,
          binary: { bytes: journal.bytes, sha256: journal.digest.copy().digest('hex') },
        },
        true,
      );
    } catch (e) {
      primary = e;
      try {
        journal.write(
          {
            kind: 'first-error',
            runtime: 'ERROR',
            physical: 'UNRESOLVED',
            acquisition: total.step1 + total.step2 > 0 ? 'CONSUMED' : 'PRE_DISPATCH',
            init,
            total,
            error: String(e),
            binary: {
              completePrefixBytes: journal.bytes,
              actualFileBytes: fstatSync(journal.bin).size,
              completePrefixSha256: journal.digest.copy().digest('hex'),
            },
          },
          true,
        );
      } catch (receiptError) {
        receiptErrors.push(String(receiptError));
      }
    } finally {
      closeErrors = journal.close();
    }
    if (primary)
      throw Object.assign(primary instanceof Error ? primary : new Error(String(primary)), {
        receiptErrors,
        closeErrors,
      });
    demand(receiptErrors.length === 0 && closeErrors.length === 0, 'RECEIPT_CLEANUP');
    expect(result?.physical).toBe('PASS');
  },
  600000,
);

function syntheticState(
  h: Helpers,
  rate: Rate,
  timeUs: number,
  eventEndUs: number | null,
  slipAtUs: number | null = null,
): State {
  const ctl = control(h, rate, timeUs / 500),
    u = ctl.u;
  let deckOmega = 0;
  if (ctl.phase === 'RAMP') {
    const span = f.schedule[rate].transitionUs + f.schedule[rate].holdUs,
      elapsed = timeUs - 2000000,
      local = ((elapsed % span) + span) % span,
      s = local / f.schedule[rate].transitionUs;
    deckOmega =
      (c.tilt.targetStepRad * (30 * s * s - 60 * s * s * s + 30 * s * s * s * s)) /
      (f.schedule[rate].transitionUs / 1e6);
  }
  let beta = 0,
    betaDot = 0;
  if (eventEndUs !== null) {
    const b = (2 * Math.PI) / 180 + 0.000001 + 0.05 * ((timeUs - (eventEndUs - 100000)) / 1e6);
    if (b > 0) {
      beta = b;
      betaDot = 0.05;
    }
  }
  const theta = base + u,
    floor = call<Floor>(h.observer, 'floorFrame', theta),
    a = theta + beta,
    q = [Math.cos(a / 2), 0, Math.sin(a / 2), 0],
    rotation = call<number[]>(h.observer, 'quaternionMatrix', q);
  const pivot = scale(floor.downhill, 0.033),
    arm = call<Vec>(h.observer, 'rotate', rotation, [0.033, 0, -0.0575]),
    centre = sub(pivot, arm),
    omega: Vec = [0, deckOmega + betaDot, 0];
  let velocity = add(cross([0, deckOmega, 0], pivot), cross(omega, sub(centre, pivot)));
  if (timeUs === slipAtUs) velocity = add(velocity, scale(floor.downhill, 0.002));
  return {
    time: timeUs / 1e6,
    qpos: [u, ...centre, ...q],
    qvel: [deckOmega, ...velocity, 0, deckOmega + betaDot, 0],
    qacc: Array<number>(7).fill(0),
    qacc_warmstart: Array<number>(7).fill(0),
  };
}
function syntheticPacket(
  h: Helpers,
  rate: Rate,
  tick: number,
  eventEndUs: number | null,
  slipAtUs: number | null = null,
): Packet {
  const pre = syntheticState(h, rate, (tick - 1) * 500, eventEndUs, slipAtUs),
    post = syntheticState(h, rate, tick * 500, eventEndUs, slipAtUs),
    floor = call<Floor>(h.observer, 'floorFrame', base + pre.qpos[0]!),
    bodies = stateBodies(h, pre),
    point = scale(floor.downhill, 0.033),
    basis = [...floor.normal, ...floor.downhill, ...floor.positiveTipAxis];
  const contact: Contact = {
    index: 0,
    geom1: 0,
    geom2: 1,
    geom: [0, 1],
    flex: [-1, -1],
    elem: [-1, -1],
    vert: [-1, -1],
    pos: point,
    frame: basis,
    dist: -0.000001,
    includemargin: 0,
    dim: 3,
    exclude: 0,
    efc_address: 0,
    friction: [...f.material.friction],
    solref: [...f.material.solref],
    solreffriction: [...f.material.solreffriction],
    solimp: [...f.material.solimp],
    surfacevel: [0, -0, 0],
    adhesion: 0,
  };
  const worldForce: Vec = [0, 0, 4.905],
    rowForce = [floor.normal, floor.downhill, floor.positiveTipAxis].map((v) => dot(v, worldForce)),
    force = [...rowForce, 0, 0, -0],
    relative = call<Vec>(h.observer, 'relativePointVelocity', point, bodies[1], bodies[2]),
    rowVelocity = [floor.normal, floor.downhill, floor.positiveTipAxis].map((v) =>
      dot(v, relative),
    ),
    ctrl = control(h, rate, tick - 1).u;
  const nativeForce = -210 * pre.qvel[0]!,
    torque = call<Torque>(
      h.observer,
      'effectiveTorque',
      ctrl,
      pre.qpos[0],
      pre.qvel[0],
      post.qvel[0],
      nativeForce,
      c.stand,
    ),
    qConstraint = [0, ...call<Vec>(h.observer, 'contactWorldForce', basis, force), 0, 0, 0];
  return {
    world: rate === 'normal' ? 0 : 1,
    tick,
    pre,
    phase: { qpos: [...pre.qpos], qvel: [...pre.qvel], time: pre.time },
    post,
    phaseHash: hash(phaseBytes(pre)),
    contacts: [
      {
        contact,
        force,
        rowForce: [...rowForce],
        rowVelocity,
        jdelta: [0.00012, -0, -0.000345],
        relative,
        rowType: [7, 7, 7],
        rowId: [0, 0, 0],
      },
    ],
    ncon: 1,
    nefc: 3,
    nJ: 21,
    islands: 1,
    solverIterations: [3, 0],
    awakePhase: 2,
    awakePost: 2,
    phaseWarnings: Array.from({ length: 7 }, () => [0, 0]),
    postWarnings: Array.from({ length: 7 }, () => [0, 0]),
    ctrl,
    nativeForce,
    qfrcActuator: [nativeForce, 0, -0, 0, 0, 0, 0],
    qfrcConstraint: qConstraint,
    inputsPre: [-0, ...Array<number>(24).fill(0)],
    inputsPost: Array<number>(25).fill(0),
    effective: torque.effective,
    signedWork: dt * torque.effective * ((pre.qvel[0]! + post.qvel[0]!) / 2),
    rowIdentity: true,
  };
}
it('preserves compact fields and witnessed phase bits; rejects changed phase/material/rows/forces/warnings', async () => {
  const h = await helpers(),
    p = syntheticPacket(h, 'normal', 1, null),
    raw = encode(p),
    restored = decode(raw);
  expect(encode(restored)).toEqual(raw);
  expect(
    call<boolean>(
      h.observer,
      'canonicalEqual',
      retainedProjection(p),
      retainedProjection(restored),
    ),
  ).toBe(true);
  const mutated = structuredClone(p);
  mutated.phase.qvel[0] = 0.1;
  expect(() => encode(mutated)).toThrow('ACTUAL_STEP1');
  const zero = structuredClone(p);
  zero.phase.qpos[0] = -0;
  expect(() => encode(zero)).toThrow('ACTUAL_STEP1');
  const material = structuredClone(p);
  material.contacts[0]!.contact.friction[0] = 0.9;
  expect(() => encode(material)).toThrow('DICTIONARY');
  const wrong = structuredClone(p);
  wrong.contacts[0]!.rowId[0] = 1;
  expect(() => supportCertificate(h, decode(encode(wrong)))).toThrow('IDENTITY');
  const forces = structuredClone(p);
  forces.contacts[0]!.rowForce[0]! += 0.1;
  expect(() => supportCertificate(h, decode(encode(forces)))).toThrow('EFC_PARITY');
  const warnings = structuredClone(p);
  warnings.postWarnings[0]![0] = 1;
  expect(() => validatePacket(h, decode(encode(warnings)), 'normal', 0, p.pre)).toThrow('WARNINGS');
  const corrupt = Buffer.from(raw);
  corrupt[592] = corrupt[592]! ^ 1;
  expect(() => decode(corrupt)).toThrow('BACK_REFERENCE');
  const extra = structuredClone(p);
  extra.nefc = 6;
  extra.nJ = 42;
  expect(() => supportCertificate(h, decode(encode(extra)))).toThrow('ORPHAN');
});
it('accepts late firstConfirmed on the final hold interval before any next-stage progression', async () => {
  const h = await helpers(),
    endUs = 3250000,
    cert = new Certificate(h, 'normal', 0, syntheticState(h, 'normal', 0, endUs));
  for (let tick = 1; tick <= 6500; tick++) {
    const p = syntheticPacket(h, 'normal', tick, endUs);
    cert.observe(p, encode(p));
  }
  const outcome = cert.finish();
  expect(outcome.physical).toBe('PASS');
  expect(outcome.firstConfirmed?.tick).toBe(6500);
  expect(outcome.firstConfirmed?.targetIndex).toBe(1);
  expect(outcome.atUs).toBe(3250000);
  expect(() => cert.observe(syntheticPacket(h, 'normal', 6501, endUs), Buffer.alloc(1872))).toThrow(
    'NO_ADVANCE',
  );
}, 30000);
it('never forgives early slip with a late window and keeps post-confirmation numerical guards', async () => {
  const h = await helpers(),
    endUs = 3250000,
    cert = new Certificate(h, 'normal', 0, syntheticState(h, 'normal', 0, endUs, 2100000));
  for (let tick = 1; tick <= 6500; tick++) {
    const p = syntheticPacket(h, 'normal', tick, endUs, 2100000);
    cert.observe(p, encode(p));
  }
  expect(cert.finish().physical).toBe('FAIL');
  expect(cert.failures.has('MAX_LOADED_POINT_SLIP')).toBe(true);
  expect(cert.firstConfirmed).toBeNull();
  const early = 3100000,
    active = new Certificate(h, 'normal', 0, syntheticState(h, 'normal', 0, early));
  for (let tick = 1; tick <= 6200; tick++) {
    const p = syntheticPacket(h, 'normal', tick, early);
    active.observe(p, encode(p));
  }
  expect(active.firstConfirmed?.tick).toBe(6200);
  expect(active.done).toBe(false);
  const p = syntheticPacket(h, 'normal', 6201, early);
  p.postWarnings[0]![0] = 1;
  expect(() => active.observe(p, encode(p))).toThrow('WARNINGS');
}, 60000);
it('keeps target17 unresolved without tip and retains two-rate target-index agreement', async () => {
  const h = await helpers(),
    startTick = 44000,
    initial = syntheticState(h, 'normal', startTick * 500, null),
    cert = new Certificate(h, 'normal', 0, initial);
  // Isolated state-machine boundary setup; not an acquired physical prior history.
  cert.tick = startTick;
  cert.stage = 16;
  cert.previousStable = [base + (16 * 0.24 * Math.PI) / 180];
  for (let tick = startTick + 1; tick <= 46500; tick++) {
    const p = syntheticPacket(h, 'normal', tick, null);
    cert.observe(p, encode(p));
  }
  const unresolved = cert.finish();
  expect(unresolved.physical).toBe('FAIL');
  expect(unresolved.stopReason).toBe('LOCAL_THRESHOLD_UNRESOLVED');
  const normal = {
      ...unresolved,
      rate: 'normal' as const,
      physical: 'PASS',
      firstConfirmed: {
        targetIndex: 8,
        tick: 1,
        atUs: 1,
        bracket: [0.52, 0.521],
        window: { accepted: true },
        finishHoldAtUs: 1,
      },
    },
    slow = {
      ...normal,
      rate: 'slow' as const,
      world: 1,
      firstConfirmed: { ...normal.firstConfirmed, targetIndex: 10 },
    };
  expect(assessPair([normal, slow]).physical).toBe('FAIL');
  slow.firstConfirmed.targetIndex = 9;
  expect(assessPair([normal, slow]).physical).toBe('PASS');
}, 30000);

it('rejects changed fixture/profile/limits and malformed evidence before any initialization', () => {
  for (const mutate of [
    (v: typeof f) => {
      v.schedule.stepUs = 250;
    },
    (v: typeof f) => {
      v.schedule.normal.holdUs = 2000000;
    },
    (v: typeof f) => {
      v.capture.maxBytes *= 2;
    },
    (v: typeof f) => {
      v.material.friction[0] = 0.5;
    },
    (v: typeof f) => {
      v.model.xml += ' ';
    },
    (v: typeof f) => {
      v.engine.wasm.sha256 = '0'.repeat(64);
    },
  ]) {
    const v = structuredClone(f);
    mutate(v);
    expect(() => validateFixture(v)).toThrow();
  }
  expect(() => decode(Buffer.alloc(0))).toThrow();
  expect(() => assessPair([])).toThrow();
  expect(() => floatBytes([NaN])).toThrow();
  expect(() => zeroMask([1])).toThrow();
});
it('releases owned warning/contact copies and vectors without deleting borrowed members or masking primary errors', async () => {
  const h = await helpers(),
    hooks: Hook = {
      strictDynamic: true,
      shape: { nq: 8, nv: 7, nu: 1, nbody: 3, ngeom: 2, solverSlots: 20 },
      keyframes: 0,
      warningCount: 7,
      invoke(_api, fn) {
        return fn();
      },
      stop() {
        /* fake-wrapper unit, no native engine */
      },
    };
  let borrowedDeletes = 0,
    warningDeletes = 0;
  const borrowed = {
    size: () => 7,
    get: () => ({
      number: 0,
      lastinfo: 0,
      delete: () => {
        warningDeletes++;
      },
    }),
    delete: () => {
      borrowedDeletes++;
    },
  };
  const wr = resources();
  expect(
    call<number[][]>(h.observer, 'copyWarnings', { warning: borrowed }, wr, hooks),
  ).toHaveLength(7);
  expect([borrowedDeletes, warningDeletes, wr.temporaryCreated, wr.temporaryDeleted]).toEqual([
    0, 7, 7, 7,
  ]);
  const bad = {
    size: () => 7,
    get: () => ({
      get number() {
        throw new Error('first-read');
      },
      lastinfo: 0,
      delete: () => {
        throw new Error('secondary-delete');
      },
    }),
  };
  const br = resources();
  expect(() => call(h.observer, 'copyWarnings', { warning: bad }, br, hooks)).toThrow('first-read');
  expect(br.cleanupErrors).toHaveLength(1);
  const seed = syntheticPacket(h, 'normal', 1, null).contacts[0]!.contact,
    deletes: number[] = [];
  const vector = {
    size: () => 2,
    get: (index: number) => {
      const raw: Record<string, unknown> = {
        ...seed,
        efc_address: index * 3,
        mu: 1,
        H: new Float64Array(36),
      };
      for (const [key, value] of Object.entries(raw))
        if (Array.isArray(value))
          raw[key] = ['geom', 'flex', 'elem', 'vert'].includes(key)
            ? new Int32Array(value)
            : new Float64Array(value);
      return {
        ...raw,
        delete() {
          deletes.push(index);
          if (index === 0) throw new Error('contact-delete');
        },
      };
    },
    delete() {
      deletes.push(2);
    },
  };
  const data = {
      ncon: 2,
      nefc: 6,
      nisland: 1,
      efc_type: new Int32Array(6).fill(7),
      efc_id: new Int32Array([0, 0, 0, 1, 1, 1]),
      contact: vector,
    },
    cr = resources();
  expect(() =>
    call(
      h.observer,
      'copyContacts',
      data,
      cr,
      {
        maxContacts: 4,
        maxConstraintRows: 12,
        maxIslands: 2,
        pairCaps: [{ geom: [0, 1], maxContacts: 4 }],
        maxContactVectors: 2,
        maxContactGets: 4,
      },
      hooks,
    ),
  ).toThrow('NATIVE_WRAPPER_CLEANUP');
  expect(deletes).toEqual([0, 1, 2]);
  expect(cr.temporaryCreated).toBe(3);
  expect(cr.temporaryDeleted).toBe(2);
  expect(cr.cleanupErrors).toHaveLength(1);
});
it('replays both complete synthetic rate worlds from exclusive external files without native', async () => {
  const h = await helpers(),
    root = mkdtempSync(join(tmpdir(), 'asa-near-pure-'));
  demand(
    relative(realpathSync(tmpdir()), realpathSync(root)).startsWith('asa-near-pure-'),
    'OWNED_PURE_TEMP',
  );
  const journal = new Journal(root),
    live: Outcome[] = [];
  try {
    journal.write({ kind: 'pure-synthetic-not-native', schema });
    for (const [world, rate] of (['normal', 'slow'] as const).entries()) {
      const endUs = rate === 'normal' ? 3250000 : 4500000,
        maxTick = endUs / 500,
        startOffset = journal.bytes,
        initial = structuredClone(f.model.initial),
        cert = new Certificate(h, rate, world, initial);
      journal.write({
        kind: 'world-start',
        world,
        rate,
        startOffset,
        initial,
        readback: f.model.readbackExample,
      });
      for (let tick = 1; tick <= maxTick; tick++) {
        const p = syntheticPacket(h, rate, tick, endUs);
        if (tick === 1) {
          p.pre = initial;
          p.phase = { qpos: [...initial.qpos], qvel: [...initial.qvel], time: 0 };
          p.phaseHash = hash(phaseBytes(initial));
        }
        journal.reserve();
        const raw = encode(p);
        journal.frame(raw);
        cert.observe(p, raw);
      }
      const outcome = cert.finish();
      live.push(outcome);
      const warningGets = 7 * (2 * maxTick + 1),
        local = {
          modelAttempted: 1,
          modelReturned: 1,
          modelDeleteAttempted: 1,
          modelDeleted: 1,
          dataAttempted: 1,
          dataReturned: 1,
          dataDeleteAttempted: 1,
          dataDeleted: 1,
          bufferAttempted: 2,
          bufferReturned: 2,
          bufferDeleteAttempted: 2,
          bufferDeleted: 2,
          step1: maxTick,
          step1Returned: maxTick,
          step2: maxTick,
          step2Returned: maxTick,
        };
      const r = {
        ...resources(),
        warningGetsCreated: warningGets,
        contactVectorsCreated: 2 * maxTick,
        contactGetsCreated: 2 * maxTick,
        contactForceCalls: maxTick,
        velocityCalls: 3 * maxTick,
        temporaryCreated: warningGets + 4 * maxTick,
        temporaryDeleted: warningGets + 4 * maxTick,
      };
      journal.write(
        {
          kind: 'world-resources',
          world,
          rate,
          stage: 'complete',
          primary: null,
          cleanup: [],
          local,
          resources: r,
          apiCalls: {
            mj_step1: maxTick,
            mj_step2: maxTick,
            mj_contactForce: maxTick,
            mj_differentiatePos: maxTick,
            mj_objectVelocity: 3 * maxTick,
            'warning.get': warningGets,
          },
          apiReturned: {
            mj_step1: maxTick,
            mj_step2: maxTick,
            mj_contactForce: maxTick,
            mj_differentiatePos: maxTick,
            mj_objectVelocity: 3 * maxTick,
            'warning.get': warningGets,
          },
          endOffset: journal.bytes,
          synthetic: true,
        },
        true,
      );
      journal.write({
        kind: 'world-end',
        world,
        rate,
        startOffset,
        endOffset: journal.bytes,
        outcome,
      });
    }
    fsyncSync(journal.bin);
    const result = await replay(h, root, live);
    expect(result.physical).toBe('PASS');
    expect(journal.bytes).toBe(15500 * 1872);
    expect(journal.bytes + journal.metadata + journal.errorBytes).toBeLessThan(f.capture.maxBytes);
  } finally {
    expect(journal.close()).toEqual([]);
    unlinkSync(join(root, files.meta));
    unlinkSync(join(root, files.binary));
    rmdirSync(root);
  }
}, 60000);

// Exact candidate tick11 from the pinned f3e700b3� receipt: four native contacts,
// two loaded contacts. This is retained historical input, not a new native run.
const defaultArchivedFourContact =
  '{"kind":"interval","engine":"candidate","tick":11,"pre":{"time":0.005000000000000001,"qpos":[-0.000007970797553397634,0.027041562016467312,0,0.05072289384867421,0.9702957262759965,0,0.24192189559966773,0],"qvel":[-0.0019803286820398456,0,0,-0.04905,0,0,0],"qacc":[0.0436547072809511,0,0,-9.81,0,0,0],"qacc_warmstart":[0.0436547072809511,0,0,-9.81,0,0,0]},"control":{"u":0,"stage":0,"phase":"SETTLING","target":0,"stageEndUs":2000000},"stage":"solved-observation","forward":{"state":{"qpos":[-0.000007970797553397634,0.027041562016467312,0,0.05072289384867421,0.9702957262759965,0,0.24192189559966773,0],"qvel":[-0.0019803286820398456,0,0,-0.04905,0,0,0],"time":0.005000000000000001},"bodies":{"0":{"com":[0,0,0],"rotation":[1,0,0,0,1,0,0,0,1],"quaternion":[1,0,0,0],"omega":[0,0,0],"velocity":[0,0,0]},"1":{"com":[-0.01173661312436161,0,-0.02207378337234157],"rotation":[0.8829513348936627,0,0.46946452497446434,0,1.0000000000000002,0,-0.46946452497446434,0,0.8829513348936627],"quaternion":[0.9702966904235175,0,0.24191802858234593,0],"omega":[0,-0.0019803286820398456,0],"velocity":[0.00004371334633338224,0,-0.00002324235160017858]},"2":{"com":[0.027041562016467312,0,0.05072289384867421],"rotation":[0.882947592858927,0,0.4694715627858908,0,1,0,-0.4694715627858908,0,0.882947592858927],"quaternion":[0.9702957262759965,0,0.24192189559966773,0],"omega":[0,0,0],"velocity":[0,0,-0.04905]}},"contacts":[{"index":0,"dist":-0.000018856084316987068,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":0,"adhesion":0,"pos":[-0.026867954620029597,0.012628553268048015,0.014274992304176271],"frame":[-0.4694645249744904,0,-0.8829513348936487,0,1,0,0.8829513348936487,0,-0.4694645249744904],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},{"index":1,"dist":-0.000019199757830144162,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":3,"adhesion":0,"pos":[0.011201804668187001,0.030488024572872474,-0.005966863153286579],"frame":[-0.46946452497448315,0,-0.8829513348936526,0,1,0,0.8829513348936526,0,-0.46946452497448315],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},{"index":2,"dist":-0.000019342112060302195,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":6,"adhesion":0,"pos":[0.02697081528164535,-0.012628553268047965,-0.014351314211363514],"frame":[-0.469464524974452,0,-0.8829513348936693,0,1,0,0.8829513348936693,0,-0.469464524974452],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},{"index":3,"dist":-0.000018998438547159846,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":9,"adhesion":0,"pos":[-0.011098944006571174,-0.03048802457287248,0.005890541246099302],"frame":[-0.4694645249744595,0,-0.8829513348936653,0,1,0,0.8829513348936653,0,-0.4694645249744595],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}],"efcVel":[-0.043248512072701535,0,-0.023027216279376452,-0.043333897068468796,0,-0.02302721593908284,-0.0433692646917395,0,-0.02302721579812723,-0.043283879695972236,0,-0.023027216138420858],"efcType":[7,7,7,7,7,7,7,7,7,7,7,7],"efcId":[0,0,0,1,1,1,2,2,2,3,3,3],"ncon":4,"nefc":12},"worldDeck":{"hingeAnchor":[0,0,0],"hingeAxis":[0,1,0],"geomCenter":[-0.01173661312436161,0,-0.02207378337234157]},"post":{"time":0.005500000000000001,"qpos":[-0.000008748047980867814,0.027042055615151044,4.8875466426682175e-8,0.05070471486144854,0.970294960251713,-4.1245032184649473e-7,0.24192496793416313,1.0284045026571632e-7],"qvel":[-0.0015545008549403606,0.0009871973674647823,0.00009775093285336434,-0.03635797445133844,-0.0017003125650485664,0.012665564309214837,1.954271730667873e-8],"qacc":[1.0641479560387126,1.9743947349295645,0.19550186570672867,25.384051097323123,-3.4006251300971333,25.331128618429673,0.000039085434613357465],"qacc_warmstart":[1.0641479560387126,1.9743947349295645,0.19550186570672867,25.384051097323123,-3.4006251300971333,25.331128618429673,0.000039085434613357465]},"rows":{"ncon":4,"nefc":12,"efcType":[7,7,7,7,7,7,7,7,7,7,7,7],"efcId":[0,0,0,1,1,1,2,2,2,3,3,3]},"retainedForce":[0,0,0,4.501982600898777,-0.608452740504672,2.3472545625355794,11.498788740622748,0.5107018076513077,5.0422774442237275,0,0,0],"force":{"contacts":[{"index":0,"dist":-0.000018856084316987068,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":0,"adhesion":0,"pos":[-0.026867954620029597,0.012628553268048015,0.014274992304176271],"frame":[-0.4694645249744904,0,-0.8829513348936487,0,1,0,0.8829513348936487,0,-0.4694645249744904],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"force":[0,0,0,0,0,0]},{"index":1,"dist":-0.000019199757830144162,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":3,"adhesion":0,"pos":[0.011201804668187001,0.030488024572872474,-0.005966863153286579],"frame":[-0.46946452497448315,0,-0.8829513348936526,0,1,0,0.8829513348936526,0,-0.46946452497448315],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"force":[4.501982600898777,-0.608452740504672,2.3472545625355794,0,0,0]},{"index":2,"dist":-0.000019342112060302195,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":6,"adhesion":0,"pos":[0.02697081528164535,-0.012628553268047965,-0.014351314211363514],"frame":[-0.469464524974452,0,-0.8829513348936693,0,1,0,0.8829513348936693,0,-0.469464524974452],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"force":[11.498788740622748,0.5107018076513077,5.0422774442237275,0,0,0]},{"index":3,"dist":-0.000018998438547159846,"includemargin":0,"mu":1,"dim":3,"geom1":1,"geom2":0,"exclude":0,"efc_address":9,"adhesion":0,"pos":[-0.011098944006571174,-0.03048802457287248,0.005890541246099302],"frame":[-0.4694645249744595,0,-0.8829513348936653,0,1,0,0.8829513348936653,0,-0.4694645249744595],"friction":[1,1,0.00001,0.00001,0.00001],"solref":[0.004,1],"solreffriction":[0,0],"solimp":[0.99,0.99,0.001,0.5,2],"geom":[1,0],"flex":[-1,-1],"elem":[-1,-1],"vert":[-1,-1],"surfacevel":[0,0,0],"H":[13.806913667173852,0.00007250294856789539,13.806913666983485,0.00007250294856789539,21.2367093044783,-0.000039015387794421404,13.806913666983485,-0.000039015387794421404,13.806913667378737,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"force":[0,0,0,0,0,0]}],"efcForce":[0,0,0,4.501982600898777,-0.608452740504672,2.3472545625355794,11.498788740622748,0.5107018076513077,5.0422774442237275,0,0,0],"qfrcConstraint":[0.4083708431862537,0.9871973674647823,0.09775093285336434,17.597025548661563,-0.002336796235231747,0.017406707215630923,1.064100957348657e-8],"qfrcActuator":[0.6151389620633084,0,0,0,0,0,0],"actuatorForce":[0.6151389620633084],"qacc":[1.0641479560387126,1.9743947349295645,0.19550186570672867,25.384051097323123,-3.4006251300971333,25.331128618429673,0.000039085434613357465],"solverIterations":[16,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"islands":1,"warnings":[[0,0],[0,0],[0,0],[0,0],[0,0],[0,0],[0,0]],"endpoint":{"time":0.005500000000000001,"qpos":[-0.000008748047980867814,0.027042055615151044,4.8875466426682175e-8,0.05070471486144854,0.970294960251713,-4.1245032184649473e-7,0.24192496793416313,1.0284045026571632e-7],"qvel":[-0.0015545008549403606,0.0009871973674647823,0.00009775093285336434,-0.03635797445133844,-0.0017003125650485664,0.012665564309214837,1.954271730667873e-8],"qacc":[1.0641479560387126,1.9743947349295645,0.19550186570672867,25.384051097323123,-3.4006251300971333,25.331128618429673,0.000039085434613357465],"qacc_warmstart":[1.0641479560387126,1.9743947349295645,0.19550186570672867,25.384051097323123,-3.4006251300971333,25.331128618429673,0.000039085434613357465]}},"kinematics":[{"vDeck":[-0.000028269176695858327,0,-0.00005320738116178959],"local":[-0.043248512072701535,0,-0.023027216279376456],"native":[-0.043248512072701535,0,-0.023027216279376452],"projectedSlip":0.023027216279375175},{"vDeck":[0.000011816350244260125,0,0.00002218325507501856],"local":[-0.04333389706846879,0,-0.02302721593908284],"native":[-0.043333897068468796,0,-0.02302721593908284],"projectedSlip":0.02302721593908192},{"vDeck":[0.000028420319157729215,0,0.00005341107908024086],"local":[-0.0433692646917395,0,-0.02302721579812723],"native":[-0.0433692646917395,0,-0.02302721579812723],"projectedSlip":0.02302721579812784},{"vDeck":[-0.000011665207782389179,0,-0.000021979557156567136],"local":[-0.04328387969597223,0,-0.023027216138420854],"native":[-0.043283879695972236,0,-0.023027216138420858],"projectedSlip":0.023027216138421094}],"support":{"loaded":2,"maxSlip":0.02302721593908284,"outwardForce":16.000771341521506,"supported":true,"downhillRim":false,"forceSum":[0.9871973674647823,0.09775093285336434,17.597025548661563],"sumAbsProducts":[14.036391666679954,1.1191545481559797,17.597025548661563],"contactCount":4},"torque":{"u":0,"thetaPre":-0.000007970797553397634,"omegaPre":-0.0019803286820398456,"omegaPost":-0.0015545008549403606,"nativeForce":0.6151389620633084,"saturated":false,"effective":0.5257151183724166,"endpointFormula":0.5257151183724166,"algebraBudget":6.099136245917717e-14},"signedWork":-4.6457833211496596e-7,"work":-0.000003943047693078962,"physical":{"tick":11,"pre":{"theta":0.4886842197608589,"omega":-0.0019803286820398456,"phi":0.00000797079755335386,"beta":0.00000797079755335386,"relativeOmega":0.0019803286820398456,"relativeOmegaY":0.0019803286820398456,"uphillRimLift":-0.000018836061869375448,"uphillDirectionValid":true,"maximumRimLift":-0.00001883606186937433},"post":{"theta":0.48868344251043144,"omega":-0.0015545008549403606,"phi":0.000015104774188259873,"beta":0.000015080830135427492,"relativeOmega":0.01432135873763604,"relativeOmegaY":0.014220065164155199,"uphillRimLift":-0.00003442091659328246,"uphillDirectionValid":true,"maximumRimLift":-0.00003442012643953861},"loaded":true,"positiveSupport":true,"supported":true,"downhillRim":false,"noSlip":false},"slip":0,"signature":{"eligible":false,"matches":false,"movingSpeed":0,"loadedMoving":false}}';
it('routes the real archived four-contact specimen through the same dispatched native-certificate comparison as runWorld', async () => {
  expect(hash(defaultArchivedFourContact)).toBe(
    '1325a0593d2de5c796266a850946c912913636941149984b49d8e753bdc9fdc6',
  );
  const sample = parseLine(defaultArchivedFourContact) as unknown as ArchivedInterval;
  expect([sample.engine, sample.tick, sample.forward.ncon, sample.forward.nefc]).toEqual([
    'candidate',
    11,
    4,
    12,
  ]);
  const h = await helpers(),
    packet = archivePacket(h, sample);
  const actual = compareNativeCertificate(h, packet, sample.forward, sample.force, true);
  expect(Object.is(actual.native.maxSlip, sample.support.maxSlip)).toBe(true);
  expect(Object.is(actual.native.outwardForce, sample.support.outwardForce)).toBe(true);
  expect(actual.native.loaded).toBe(sample.support.loaded);
  expect(actual.retained.supported).toBe(sample.support.supported);
  expect(actual.retained.downhillRim).toBe(sample.support.downhillRim);
  for (const denied of [
    'cylinderPlan',
    'executePhy01',
    'verifyEngineArtifacts',
    'validateCylinderDynamicAuthorization',
  ])
    expect(() => call(h.harness, denied, c)).toThrow('PURE_EXPORT_ALLOWLIST_');
});

// Additive #1071 diagnostic. No native glue is imported by this section or pure tests.
type NativeMode = 'original' | 'stage6' | null;
function selectedNativeMode(env: Record<string, string | undefined> = process.env): NativeMode {
  const original = env['ASA_D01_NEAR_RUN'],
    diagnostic = env['ASA_D01_STAGE6_RUN'];
  demand(!(original && diagnostic), 'MUTUALLY_EXCLUSIVE_NATIVE_MODES');
  demand(!original || original === 'two-local-frozen-rates-1071', 'UNKNOWN_ORIGINAL_NATIVE_MODE');
  demand(!diagnostic || diagnostic === g.nativeToken, 'UNKNOWN_DIAGNOSTIC_NATIVE_MODE');
  return original ? 'original' : diagnostic ? 'stage6' : null;
}
function validateDiagnosticFixture(v: typeof g = g) {
  demand(
    hash(JSON.stringify(v)) === 'ee9b146a639da32ec45feb7abfc8e053a06bbb7bb025632a8d8953d7eccf0d2f',
    'EXACT_STAGE6_FIXTURE',
  );
  pinned(fileURLToPath(fixtureUrl), v.originalFixture);
  demand(
    v.modelSha256 === f.model.sha256 &&
      v.prefix.bytes === v.prefix.intervals * 1872 &&
      v.capture.maxBinaryBytes === v.schedule.maxIntervals * 1872 &&
      v.capture.worstCaseBytes ===
        v.capture.maxBinaryBytes + v.capture.metadataBytes + v.capture.errorBytes &&
      v.capture.worstCaseBytes <= v.capture.maxBytes,
    'STAGE6_GEOMETRY_AND_CAPS',
  );
}
type DiagnosticContext = { prior: Buffer };
function diagnosticControl(h: Helpers, rate: Rate, tickBefore: number): Control {
  demand(
    Number.isSafeInteger(tickBefore) &&
      tickBefore >= 0 &&
      tickBefore <= g.schedule[rate].maxIntervals,
    'DIAGNOSTIC_INTEGER_HORIZON',
  );
  if (tickBefore < g.prefix.intervals) return control(h, 'normal', tickBefore);
  const localUs = tickBefore * 500 - g.prefix.throughUs,
    rampUs = g.schedule[rate].rampUs,
    fraction = Math.min(1, localUs / rampUs),
    smooth = 10 * fraction ** 3 - 15 * fraction ** 4 + 6 * fraction ** 5;
  return {
    u: (5 + smooth) * c.tilt.targetStepRad,
    stage: 6,
    target: 6 * c.tilt.targetStepRad,
    phase: localUs < rampUs ? 'RAMP' : 'HOLD',
    stageEndUs: g.schedule[rate].checkpoint2Us,
  };
}
function canonicalFrame(bytes: Buffer) {
  demand(
    bytes.length === 1872 && (bytes[4] === 0 || bytes[4] === 1),
    'CANONICAL_FRAME_WIDTH_AND_WORLD',
  );
  const out = Buffer.from(bytes);
  out[4] = 0; // The ONLY permitted normalization, including signed-zero bits everywhere else.
  return out;
}
function frameDifference(actual: Buffer, expected: Buffer, tick: number) {
  const normalized = canonicalFrame(actual);
  const offset = normalized.findIndex((v, i) => v !== expected[i]);
  return offset < 0
    ? null
    : { tick, byteOffset: offset, actual: normalized[offset], expected: expected[offset] };
}
function physicalTilts(h: Helpers, p: Packet) {
  return [p.pre, p.post].map((s) =>
    call<Tilt>(
      h.observer,
      'tiltState',
      call<Body>(h.observer, 'bodyEndpoint', s, h.shape),
      base + s.qpos[0]!,
      s.qvel[0],
      c,
    ),
  ) as [Tilt, Tilt];
}
function diagnosticClassification(firstStable: boolean, secondStable: boolean, tip: boolean) {
  return tip
    ? 'original-tip-window-observed'
    : firstStable && secondStable
      ? 'stable-at-both'
      : !firstStable && secondStable
        ? 'recovered-only-in-additional-second'
        : firstStable
          ? 'lost-stability-in-additional-second'
          : 'no-stable-recovery';
}
type DiagnosticCheckpoint = {
  tick: number;
  atUs: number;
  stable: WindowResult;
  tip: WindowResult;
  physical: string;
  failures: [string, number][];
  metrics: Record<string, unknown>;
  validFirstTipObserved: boolean;
};
class CheckpointLedger {
  readonly checkpoints: DiagnosticCheckpoint[] = [];
  firstFailure: [string, number] | null = null;
  record(
    value: Omit<DiagnosticCheckpoint, 'physical' | 'failures' | 'validFirstTipObserved'>,
    failures: Map<string, number>,
    validFirstTipObserved = false,
  ) {
    demand(this.checkpoints.length < 2, 'ONLY_TWO_FIXED_CHECKPOINTS');
    if (
      this.checkpoints.length === 0 &&
      !value.stable.accepted &&
      !value.tip.accepted &&
      !validFirstTipObserved
    )
      failures.set('ORIGINAL_ONE_SECOND_NO_STABLE_OR_TIP', value.tick);
    this.firstFailure ??= Array.from(failures)[0] ?? null;
    // Copy, never revise the first checkpoint after the additional diagnostic second.
    const checkpoint = {
      ...value,
      validFirstTipObserved,
      physical:
        failures.size === 0 &&
        (value.stable.accepted || value.tip.accepted || validFirstTipObserved)
          ? 'PASS'
          : 'FAIL',
      failures: Array.from(failures),
    };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }
}
class DiagnosticCertificate extends Certificate {
  readonly ledger = new CheckpointLedger();
  readonly canonicalPrefix = createHash('sha256');
  readonly historicalStream = createHash('sha256');
  prefixVerified = false;
  prefixDigest: string | null = null;
  historicalDigest: string | null = null;
  historicalDifference: ReturnType<typeof frameDifference> = null;
  readonly variant: Rate;
  readonly supportWindow: Support[] = [];
  constructor(
    h: Helpers,
    rate: Rate,
    world: number,
    initial: State,
    readonly context: DiagnosticContext,
  ) {
    super(h, 'normal', world, initial); // Prefix is NORMAL for both variants; world identity remains actual.
    this.variant = rate;
  }
  override observe(p: Packet, bytes: Buffer) {
    const normalized = canonicalFrame(bytes);
    if (p.tick <= g.descriptive.intervals && this.variant === 'normal') {
      this.historicalStream.update(normalized);
      this.historicalDifference ??= frameDifference(
        bytes,
        this.context.prior.subarray((p.tick - 1) * 1872, p.tick * 1872),
        p.tick,
      );
      if (p.tick === g.descriptive.intervals)
        this.historicalDigest = this.historicalStream.digest('hex');
    }
    if (p.tick <= g.prefix.intervals) {
      const difference = frameDifference(
        bytes,
        this.context.prior.subarray((p.tick - 1) * 1872, p.tick * 1872),
        p.tick,
      );
      demand(!difference, 'MANDATORY_PREFIX_DIFFERENCE_' + JSON.stringify(difference));
      this.canonicalPrefix.update(normalized);
      super.observe(p, bytes);
      if (p.tick === g.prefix.intervals) {
        this.prefixDigest = this.canonicalPrefix.digest('hex');
        demand(
          this.prefixDigest === g.prefix.sha256 &&
            this.stage === 5 &&
            !this.done &&
            this.failures.size === 0 &&
            this.previousStable.length === 400,
          'MANDATORY_ACCEPTED_STAGE5_PREFIX',
        );
        this.prefixVerified = true;
        this.stage = 6;
        this.low = Math.min(...this.previousStable);
        this.high = Math.max(...this.previousStable);
        this.window = [];
      }
      return;
    }
    demand(
      this.prefixVerified &&
        !this.done &&
        p.tick === this.tick + 1 &&
        p.tick <= g.schedule[this.variant].maxIntervals,
      'DIAGNOSTIC_NO_STAGE7_OR_EXTRA_ADVANCE',
    );
    const ctl = diagnosticControl(this.h, this.variant, p.tick - 1),
      next = diagnosticControl(this.h, this.variant, p.tick);
    validatePacket(this.h, p, this.variant, this.world, this.previous, ctl);
    const support = supportCertificate(this.h, p),
      [before, after] = physicalTilts(this.h, p);
    this.lastSupport = support;
    this.previous = p.post;
    this.tick = p.tick;
    this.prefix.update(bytes);
    this.work += p.signedWork;
    this.positiveWork += Math.max(0, p.signedWork);
    this.negativeWork += Math.min(0, p.signedWork);
    this.window.push({
      tick: p.tick,
      pre: before,
      post: after,
      loaded: support.loaded > 0,
      positiveSupport: support.outwardForce > 0,
      supported: support.supported,
      downhillRim: support.downhillRim,
      noSlip: support.maxSlip <= 0.001,
    });
    if (this.window.length > 200) this.window.shift();
    this.supportWindow.push(support);
    if (this.supportWindow.length > 200) this.supportWindow.shift();
    const fail = (code: string) => {
      if (!this.failures.has(code)) this.failures.set(code, p.tick);
    };
    if (!this.firstConfirmed) {
      this.low = Math.min(this.low, before.theta, after.theta);
      this.high = Math.max(this.high, before.theta, after.theta);
      this.peakSlip = Math.max(this.peakSlip, support.maxSlip);
      this.cumulativeSlip += dt * support.maxSlip;
      if (support.maxSlip > 0.001) fail('MAX_LOADED_POINT_SLIP');
      if (this.cumulativeSlip > 0.0001) fail('MAX_CUMULATIVE_SLIP');
      if (!(support.loaded > 0 && support.outwardForce > 0 && support.supported))
        fail('UNKNOWN_SUPPORT_WITNESS_DOMAIN');
      if (
        Math.max(Math.abs(p.pre.qpos[0]! - ctl.u), Math.abs(p.post.qpos[0]! - next.u)) >
        (0.05 * Math.PI) / 180
      )
        fail('STAND_PRETIP_TRACKING');
      // Earlier stages share normal speed. Only the selected stage6 duration changes this limit.
      if (
        Math.max(Math.abs(p.pre.qvel[0]!), Math.abs(p.post.qvel[0]!)) >
        f.schedule[this.variant].maxSpeedRadps
      )
        fail('STAND_PRETIP_SPEED');
      if (this.high - this.low > (0.25 * Math.PI) / 180) fail('STAND_STAGE_ANGLE_SPAN');
    }
    const tip = call<WindowResult>(
      this.h.observer,
      'assessWindow',
      this.window,
      c,
      500,
      base + ctl.target,
      'tip',
    );
    if (tip.accepted) {
      this.firstObservedTip ??= { tick: p.tick, targetIndex: 6, window: tip };
      if (!this.firstConfirmed && this.failures.size === 0) {
        if (
          ![this.low, this.high].every(
            (v) => Math.abs(v - c.tilt.tip.criticalAngleRad) <= (2 * Math.PI) / 180,
          )
        )
          fail('TIP_ANALYTIC_FULL_BRACKET');
        if (this.failures.size === 0)
          this.firstConfirmed = {
            targetIndex: 6,
            tick: p.tick,
            atUs: p.tick * 500,
            bracket: [this.low, this.high],
            window: tip,
            finishHoldAtUs: ctl.stageEndUs,
          };
      }
    }
    const atUs = p.tick * 500,
      schedule = g.schedule[this.variant];
    if (atUs === schedule.checkpoint1Us || atUs === schedule.checkpoint2Us) {
      const stable = call<WindowResult>(
          this.h.observer,
          'assessWindow',
          this.window,
          c,
          500,
          base + ctl.target,
          'stable',
        ),
        tilts = this.window.flatMap((v) => [v.pre, v.post]);
      const checkpoint = this.ledger.record(
        {
          tick: p.tick,
          atUs,
          stable,
          tip,
          metrics: {
            thetaRange: [
              Math.min(...tilts.map((v) => v.theta)),
              Math.max(...tilts.map((v) => v.theta)),
            ],
            betaRange: [
              Math.min(...tilts.map((v) => v.beta)),
              Math.max(...tilts.map((v) => v.beta)),
            ],
            maxPhi: Math.max(...tilts.map((v) => v.phi)),
            maxRelativeOmega: Math.max(...tilts.map((v) => v.relativeOmega)),
            relativeOmegaYRange: [
              Math.min(...tilts.map((v) => v.relativeOmegaY)),
              Math.max(...tilts.map((v) => v.relativeOmegaY)),
            ],
            rimLiftRange: tilts.every((v) => v.uphillRimLift !== null)
              ? [
                  Math.min(...tilts.map((v) => v.uphillRimLift!)),
                  Math.max(...tilts.map((v) => v.uphillRimLift!)),
                ]
              : null,
            uphillDirectionValidSamples: tilts.filter((v) => v.uphillDirectionValid).length,
            loadedIntervals: this.window.filter((v) => v.loaded && v.positiveSupport && v.supported)
              .length,
            noSlipIntervals: this.window.filter((v) => v.noSlip).length,
            cumulativeSlip: this.cumulativeSlip,
            peakSlip: this.peakSlip,
            currentOutwardForce: support.outwardForce,
            outwardSupportRange: [
              Math.min(...this.supportWindow.map((v) => v.outwardForce)),
              Math.max(...this.supportWindow.map((v) => v.outwardForce)),
            ],
            last100msMaxPointSlip: Math.max(...this.supportWindow.map((v) => v.maxSlip)),
            maxFloorSpeed: Math.max(...tilts.map((v) => Math.abs(v.omega))),
            maxTargetError: Math.max(...tilts.map((v) => Math.abs(v.theta - (base + ctl.target)))),
            nativeTorque: p.nativeForce,
            effectiveTorque: p.effective,
            signedWork: this.work,
            positiveWork: this.positiveWork,
            negativeWork: this.negativeWork,
          },
        },
        this.failures,
        this.firstConfirmed !== null,
      );
      this.stages.push({ stage: 6, checkpoint });
      if (atUs === schedule.checkpoint2Us) {
        this.done = true;
        this.stopReason = 'FIXED_DIAGNOSTIC_SECOND_HOLD_COMPLETE';
      }
    }
  }
  override finish() {
    demand(
      this.done &&
        this.prefixVerified &&
        this.ledger.checkpoints.length === 2 &&
        this.tick === g.schedule[this.variant].maxIntervals,
      'COMPLETE_FIXED_DIAGNOSTIC',
    );
    const baseOutcome = super.finish(),
      first = this.ledger.checkpoints[0]!,
      second = this.ledger.checkpoints[1]!;
    return {
      ...baseOutcome,
      rate: this.variant,
      physical: first.physical,
      diagnostic: {
        validity: 'VALID',
        variant: this.variant === 'normal' ? 'normal_prefix_ramp250' : 'normal_prefix_ramp500',
        prefix: { intervals: 16500, sha256: this.prefixDigest, exact: true },
        descriptive19000:
          this.variant === 'normal'
            ? {
                sha256: this.historicalDigest,
                expected: g.descriptive.sha256,
                exact:
                  this.historicalDifference === null &&
                  this.historicalDigest === g.descriptive.sha256,
                firstDifference: this.historicalDifference,
              }
            : null,
        checkpoints: this.ledger.checkpoints,
        firstPhysicalFailure: this.ledger.firstFailure,
        classification: diagnosticClassification(
          first.stable.accepted,
          second.stable.accepted,
          this.firstObservedTip !== null,
        ),
        formalAcceptance: 'D01_D02_OPEN_NO_THRESHOLD_OR_TOOLBOX_ACCEPTANCE',
      },
    };
  }
}
type DiagnosticOutcome = ReturnType<DiagnosticCertificate['finish']>;
function asDiagnostic(v: Outcome) {
  const value = v as DiagnosticOutcome;
  demand(
    value.diagnostic?.validity === 'VALID' && value.diagnostic.checkpoints.length === 2,
    'DIAGNOSTIC_OUTCOME',
  );
  return value;
}
function assessDiagnosticPair(outcomes: Outcome[]) {
  demand(
    outcomes.length === 2 && outcomes[0]!.rate === 'normal' && outcomes[1]!.rate === 'slow',
    'TWO_DIAGNOSTIC_VARIANTS',
  );
  const values = outcomes.map(asDiagnostic);
  demand(
    values.every(
      (v) => v.diagnostic.prefix.exact && v.diagnostic.prefix.sha256 === g.prefix.sha256,
    ),
    'MATCHED_MANDATORY_PREFIXES',
  );
  return {
    physical: values.every((v) => v.physical === 'PASS') ? 'PASS' : 'FAIL',
    scope: g.id,
    diagnosticValidity: 'VALID',
    formalAcceptance: 'D01_D02_OPEN',
    outcomes: values,
  };
}

function diagnosticSourceAdmission() {
  validateDiagnosticFixture();
  const entries: [URL, string][] = [
    [sourceUrl, 'ASA_D01_STAGE6_SOURCE_SHA256'],
    [
      new URL('./mujoco-finite-cap-stage6-diagnostic.fixture.json', import.meta.url),
      'ASA_D01_STAGE6_FIXTURE_SHA256',
    ],
  ];
  return entries.map(([url, key]) => {
    const expected = process.env[key] ?? '',
      bytes = readFileSync(url);
    demand(/^[a-f0-9]{64}$/.test(expected) && hash(bytes) === expected, 'EXACT_STAGE6_SOURCE_PINS');
    return { file: fileURLToPath(url).split(sep).at(-1), bytes: bytes.length, sha256: expected };
  });
}
function originalSourceAdmission() {
  const original = execFileSync(
    'git',
    ['show', g.frozenSource.commit + ':' + g.frozenSource.path],
    { cwd: repo, maxBuffer: 1 << 20 },
  );
  demand(
    original.length === g.frozenSource.bytes && hash(original) === g.frozenSource.sha256,
    'FROZEN_ORIGINAL_SPEC',
  );
  const old = original.toString().replaceAll('\r\n', '\n'),
    current = readFileSync(sourceUrl, 'utf8').replaceAll('\r\n', '\n');
  // These exact ranges include the whole schema/1872 codec and factory/row/ownership readbacks.
  for (const [start, end] of [
    ['const schema =', 'function condition('],
    ['function inputValues(', 'async function runWorld('],
  ] as const) {
    const segment = (s: string) => s.slice(s.indexOf(start), s.indexOf(end));
    demand(
      old.indexOf(start) >= 0 &&
        old.indexOf(end) > old.indexOf(start) &&
        segment(old) === segment(current),
      'UNCHANGED_CODEC_AND_NATIVE_READBACK_' + start,
    );
  }
  return { source: g.frozenSource, fixture: g.originalFixture };
}
async function priorDiagnosticAdmission(h: Helpers, path: string) {
  demand(isAbsolute(path) && realpathSync(path) === resolve(path), 'ABSOLUTE_PRIOR_RAW');
  const prior = pinned(join(path, g.priorRaw.binary.file), g.priorRaw.binary),
    metadata = pinned(join(path, g.priorRaw.meta.file), g.priorRaw.meta),
    lines = metadata.toString().trim().split('\n').map(parseLine),
    finish = lines.find((v) => v.kind === 'finish'),
    header = lines.find((v) => v.kind === 'header');
  demand(
    finish?.runtime === 'COMPLETE' &&
      finish.physical === 'FAIL' &&
      finish.acquisition === 'CONSUMED' &&
      header &&
      same(header.fixture, f),
    'COMPLETE_IMMUTABLE_PRIOR_FAILURE',
  );
  const outcomes = lines.filter((v) => v.kind === 'world-end').map((v) => v.outcome as Outcome);
  const result = await replay(h, path, outcomes);
  demand(
    same(result, finish.result) && result.outcomes.reduce((a, v) => a + v.intervals, 0) === 58000,
    'COMPLETE_PRIOR_58000_REPLAY',
  );
  demand(
    hash(prior.subarray(0, g.prefix.bytes)) === g.prefix.sha256 &&
      hash(prior.subarray(0, g.descriptive.intervals * 1872)) === g.descriptive.sha256,
    'ARCHIVED_CANONICAL_PREFIXES',
  );
  return {
    prior,
    receipt: { binary: g.priorRaw.binary, meta: g.priorRaw.meta, result, notNewAcquisition: true },
  };
}
it.skipIf(!process.env['ASA_D01_STAGE6_PRIOR_RAW'])(
  'replays all58000 consumed native intervals and first16500 exact prefix without any native import',
  async () => {
    validateDiagnosticFixture();
    originalSourceAdmission();
    const h = await helpers(),
      prior = await priorDiagnosticAdmission(h, process.env['ASA_D01_STAGE6_PRIOR_RAW']!);
    expect(prior.receipt.result.physical).toBe('FAIL');
    // Exercise actual new assessor and unchanged first1s physical failure on the old normal stream.
    const initial = decode(prior.prior.subarray(0, 1872)).pre,
      cert = new DiagnosticCertificate(h, 'normal', 0, initial, { prior: prior.prior });
    for (let tick = 1; tick <= 19000; tick++) {
      const raw = prior.prior.subarray((tick - 1) * 1872, tick * 1872);
      cert.observe(decode(raw), raw);
    }
    expect(cert.prefixVerified).toBe(true);
    expect(cert.ledger.checkpoints[0]!.physical).toBe('FAIL');
    expect(cert.done).toBe(false);
    expect(cert.historicalDigest).toBe(g.descriptive.sha256);
    expect(cert.historicalDifference).toBe(null);
    const slow = new DiagnosticCertificate(h, 'slow', 1, initial, { prior: prior.prior });
    for (let tick = 1; tick <= 16500; tick++) {
      const raw = Buffer.from(prior.prior.subarray((tick - 1) * 1872, tick * 1872));
      raw[4] = 1;
      slow.observe(decode(raw), raw);
    }
    expect(slow.prefixVerified).toBe(true);
    expect(slow.prefixDigest).toBe(g.prefix.sha256);
    expect(slow.rate).toBe('normal');
    const rejected = new DiagnosticCertificate(h, 'normal', 0, initial, { prior: prior.prior });
    for (let tick = 1; tick <= 10; tick++) {
      const raw = prior.prior.subarray((tick - 1) * 1872, tick * 1872);
      rejected.observe(decode(raw), raw);
    }
    const bad = Buffer.from(prior.prior.subarray(10 * 1872, 11 * 1872));
    bad[640] = bad[640]! ^ 1;
    expect(() => rejected.observe(decode(bad), bad)).toThrow('MANDATORY_PREFIX_DIFFERENCE');
    expect(rejected.tick).toBe(10);
  },
  60000,
);
it.skipIf(process.env['ASA_D01_STAGE6_RUN'] !== g.nativeToken)(
  'acquires only the new identical-prefix stage6 diagnostic pair; physical FAIL is retained separately from diagnostic validity',
  async () => {
    const root = outputRoot(process.env['ASA_D01_STAGE6_OUTPUT'] ?? ''),
      journal = new Journal(root, true),
      init: Initialization = { attempted: 0, returned: 0, phase: 'not-imported' },
      total: Census = {
        step1: 0,
        step1Returned: 0,
        step2: 0,
        step2Returned: 0,
        models: 0,
        data: 0,
      };
    let primary: unknown,
      result: ReturnType<typeof assessDiagnosticPair> | undefined,
      closeErrors: string[];
    const receiptErrors: string[] = [];
    try {
      demand(selectedNativeMode() === 'stage6', 'STAGE6_MODE_ONLY');
      const sources = diagnosticSourceAdmission(),
        original = originalSourceAdmission(),
        history = historyAdmission(),
        h = await helpers(),
        offline = await checkArchivedProjection(h, process.env['ASA_D01_NEAR_BIASED_RAW'] ?? ''),
        archived = await priorDiagnosticAdmission(h, process.env['ASA_D01_STAGE6_PRIOR_RAW'] ?? ''),
        engine = engineAdmission(
          process.env['ASA_D01_NEAR_ENGINE'] ?? '',
          process.env['ASA_D01_NEAR_LICENSE'] ?? '',
        ),
        context = { prior: archived.prior };
      journal.write({
        kind: 'header',
        scope: g.id,
        fixture: g,
        originalFixture: f,
        sources,
        original,
        history,
        offline,
        prior: archived.receipt,
        schema,
        modelSha256: f.model.sha256,
        nativeInitialized: false,
        init,
        total,
        node: process.version,
      });
      fsyncSync(journal.meta);
      const bytes = readFileSync(join(root, g.files.meta)),
        readback = parseLine(bytes.toString());
      demand(
        bytes.length === journal.metadata &&
          same(readback.fixture, g) &&
          same(readback.sources, sources) &&
          same(readback.schema, schema),
        'STAGE6_ON_DISK_HEADER',
      );
      journal.write({
        kind: 'header-readback',
        bytes: bytes.length,
        sha256: hash(bytes),
        nativeInitialized: false,
        init,
        total,
      });
      const M = await loadNative(engine, init, 'stage6'),
        outcomes: Outcome[] = [];
      for (const [world, rate] of (['normal', 'slow'] as const).entries())
        outcomes.push(await runWorld(M, h, rate, world, journal, total, context));
      demand(
        init.attempted === 1 &&
          init.returned === 1 &&
          total.models === 2 &&
          total.data === 2 &&
          total.step1 === 42500 &&
          total.step1Returned === 42500 &&
          total.step2 === 42500 &&
          total.step2Returned === 42500 &&
          journal.bytes === g.capture.maxBinaryBytes,
        'EXACT_STAGE6_NATIVE_COUNTS',
      );
      fsyncSync(journal.bin);
      const replayed = await replay(h, root, outcomes, context);
      demand(
        'diagnosticValidity' in replayed && replayed.diagnosticValidity === 'VALID',
        'COMPLETE_SAVED_DIAGNOSTIC_REPLAY',
      );
      result = replayed as ReturnType<typeof assessDiagnosticPair>;
      journal.write(
        {
          kind: 'finish',
          runtime: 'COMPLETE',
          diagnosticValidity: 'VALID',
          physical: result.physical,
          acquisition: 'CONSUMED',
          formalAcceptance: 'D01_D02_OPEN',
          init,
          total,
          result,
          binary: { bytes: journal.bytes, sha256: journal.digest.copy().digest('hex') },
        },
        true,
      );
    } catch (e) {
      primary = e;
      try {
        journal.write(
          {
            kind: 'first-error',
            runtime: 'ERROR',
            diagnosticValidity: 'UNRESOLVED',
            physical: 'UNRESOLVED',
            acquisition: total.step1 + total.step2 > 0 ? 'CONSUMED' : 'PRE_DISPATCH',
            init,
            total,
            error: String(e),
            binary: {
              completePrefixBytes: journal.bytes,
              actualFileBytes: fstatSync(journal.bin).size,
              completePrefixSha256: journal.digest.copy().digest('hex'),
            },
          },
          true,
        );
      } catch (error) {
        receiptErrors.push(String(error));
      }
    } finally {
      closeErrors = journal.close();
    }
    if (primary)
      throw Object.assign(primary instanceof Error ? primary : new Error(String(primary)), {
        receiptErrors,
        closeErrors,
      });
    demand(receiptErrors.length === 0 && closeErrors.length === 0, 'STAGE6_RECEIPT_CLEANUP');
    expect(result?.diagnosticValidity).toBe('VALID'); // Physical FAIL is never changed to PASS by this assertion.
  },
  600000,
);
it('keeps both native modes explicitly exclusive/default skipped and old model/codec/readbacks frozen', () => {
  expect(selectedNativeMode({})).toBe(null);
  expect(selectedNativeMode({ ASA_D01_NEAR_RUN: 'two-local-frozen-rates-1071' })).toBe('original');
  expect(selectedNativeMode({ ASA_D01_STAGE6_RUN: g.nativeToken })).toBe('stage6');
  expect(() =>
    selectedNativeMode({
      ASA_D01_NEAR_RUN: 'two-local-frozen-rates-1071',
      ASA_D01_STAGE6_RUN: g.nativeToken,
    }),
  ).toThrow('MUTUALLY_EXCLUSIVE');
  expect(() => selectedNativeMode({ ASA_D01_STAGE6_RUN: 'retry' })).toThrow('UNKNOWN_DIAGNOSTIC');
  validateDiagnosticFixture();
  originalSourceAdmission();
  expect(() =>
    validateDiagnosticFixture({ ...g, schedule: { ...g.schedule, maxIntervals: 42501 } }),
  ).toThrow('EXACT_STAGE6_FIXTURE');
  expect(g.capture.worstCaseBytes).toBe(92142912);
});
it('matches every original NORMAL prefix control and fixes stage6 horizons without stage7', async () => {
  const h = await helpers();
  for (const rate of ['normal', 'slow'] as const) {
    for (let tick = 0; tick < 16500; tick++)
      expect(diagnosticControl(h, rate, tick)).toEqual(control(h, 'normal', tick));
    const s = g.schedule[rate];
    expect(diagnosticControl(h, rate, 16500).u).toBe(control(h, 'normal', 16500).u);
    expect(diagnosticControl(h, rate, (g.prefix.throughUs + s.rampUs) / 500).phase).toBe('HOLD');
    expect(diagnosticControl(h, rate, s.maxIntervals)).toEqual({
      u: 6 * c.tilt.targetStepRad,
      stage: 6,
      target: 6 * c.tilt.targetStepRad,
      phase: 'HOLD',
      stageEndUs: s.checkpoint2Us,
    });
    expect(() => diagnosticControl(h, rate, s.maxIntervals + 1)).toThrow(
      'DIAGNOSTIC_INTEGER_HORIZON',
    );
  }
  for (let tick = 16500; tick <= 17000; tick++)
    expect(Object.is(diagnosticControl(h, 'normal', tick).u, control(h, 'normal', tick).u)).toBe(
      true,
    );
});
it('normalizes only the declared identity byte and rejects phase/contact/signed-zero prefix changes', async () => {
  const h = await helpers(),
    sample = parseLine(defaultArchivedFourContact) as unknown as ArchivedInterval,
    packet = archivePacket(h, sample),
    original = encode(packet),
    world = Buffer.from(original);
  world[4] = 1;
  expect(frameDifference(world, original, 11)).toBe(null);
  for (const offset of [16, 256, 496, 592, 624, 1616, 1728, 1832]) {
    const bad = Buffer.from(world);
    bad[offset] = bad[offset]! ^ 128;
    expect(frameDifference(bad, original, 11)?.byteOffset).toBe(offset);
  }
  const bad = decode(original);
  bad.phase.qvel[0] = bad.phase.qvel[0]! + 1;
  expect(() => encode(bad)).toThrow();
});
it('retains original one-second FAIL even after a later quiet diagnostic window and rejects extra checkpoints', () => {
  const ledger = new CheckpointLedger(),
    failures = new Map<string, number>(),
    cp = (tick: number, accepted: boolean) => ({
      tick,
      atUs: tick * 500,
      stable: { accepted },
      tip: { accepted: false },
      metrics: {},
    });
  const first = ledger.record(cp(19000, false), failures),
    sealed = JSON.stringify(first);
  ledger.record(cp(21000, true), failures);
  expect(JSON.stringify(first)).toBe(sealed);
  expect(first.physical).toBe('FAIL');
  expect(ledger.firstFailure).toEqual(['ORIGINAL_ONE_SECOND_NO_STABLE_OR_TIP', 19000]);
  expect(ledger.checkpoints[1]!.stable.accepted).toBe(true);
  expect(ledger.checkpoints[1]!.physical).toBe('FAIL');
  expect(diagnosticClassification(false, true, false)).toBe('recovered-only-in-additional-second');
  expect(diagnosticClassification(true, true, false)).toBe('stable-at-both');
  expect(diagnosticClassification(false, false, false)).toBe('no-stable-recovery');
  expect(diagnosticClassification(false, false, true)).toBe('original-tip-window-observed');
  expect(() => ledger.record(cp(23000, true), failures)).toThrow('ONLY_TWO_FIXED_CHECKPOINTS');
  const tipped = new CheckpointLedger();
  expect(tipped.record(cp(19000, false), new Map(), true).physical).toBe('PASS');
  expect(tipped.checkpoints[0]!.tip.accepted).toBe(false); // Earlier original firstConfirmed remains decisive.
});
it('enforces diagnostic binary cap before a native advance without invoking native', () => {
  const root = mkdtempSync(join(tmpdir(), 'asa-stage6-cap-pure-'));
  const journal = new Journal(root, true);
  try {
    journal.bytes = g.capture.maxBinaryBytes - 1872;
    journal.reserve();
    journal.bytes += 1872;
    expect(() => journal.reserve()).toThrow('CAPACITY_BEFORE_NATIVE_ADVANCE');
  } finally {
    expect(journal.close()).toEqual([]);
    unlinkSync(join(root, g.files.meta));
    unlinkSync(join(root, g.files.binary));
    rmdirSync(root);
  }
});
