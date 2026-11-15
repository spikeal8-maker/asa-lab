import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import f from './mujoco-finite-cap-fixed-tilt.fixture.json';

type Vec = [number, number, number];
type Handle = { delete(): void };
type NativeModel = Record<string, unknown> & Handle & { opt: Record<string, unknown> };
type NativeData = Handle & {
  time: number;
  ncon: number;
  nefc: number;
  efc_type: Int32Array;
  efc_id: Int32Array;
  efc_force: Float64Array;
  qfrc_applied: Float64Array;
  xfrc_applied: Float64Array;
  ctrl: Float64Array;
  warning: { size(): number };
};
type Native = {
  mj_versionString(): string;
  mj_version(): number;
  mj_maxContact(model: NativeModel, g1: number, g2: number, hasMargin: number): number;
  mj_id2name(model: NativeModel, type: number, id: number): string;
  MjModel: { from_xml_string(xml: string): NativeModel };
  MjData: new (model: NativeModel) => NativeData;
  DoubleBuffer: new (size: number) => Handle;
  mj_step1(model: NativeModel, data: NativeData): void;
  mj_step2(model: NativeModel, data: NativeData): void;
};
type Cylinder = {
  gravity: Vec;
  initialGapM: number;
  bodies: {
    cylinder: { massKg: number; radiusM: number; heightM: number; inertiaKgM2: number[] };
    floor: { halfExtentsM: Vec; fixedCenterZ: number };
  };
  solver: {
    integrator: string;
    integratorValue: number;
    solver: string;
    solverValue: number;
    jacobian: string;
    jacobianValue: number;
    cone: string;
    coneValue: number;
    iterations: number;
    tolerance: number;
    lsIterations: number;
    lsTolerance: number;
    noSlipIterations: number;
    noSlipTolerance: number;
    impratio: number;
    ccdIterations: number;
    ccdTolerance: number;
    disableFlags: number;
    enableFlags: number;
  };
  contact: {
    geomFriction: number[];
    pairFriction: number[];
    solref: number[];
    solreffriction: number[];
    solimp: number[];
    maxCumulativeSlipM: number;
    maxLoadedSlipSpeedMps: number;
    loadedDownhillRimFraction: number;
  };
  tilt: {
    stationaryWindowUs: number;
    stable: Record<string, number>;
    tip: Record<string, number>;
  };
  resources: { warningCount: number; maxIslands: number };
};
type RegisteredCase = (typeof f.cases)[number];
type Engine = keyof typeof f.engines;
type Append = (kind: string, payload: object) => void;
type Dispatch = { step1: number; step1Returned: number; step2: number; step2Returned: number };
type State = {
  time: number;
  qpos: number[];
  qvel: number[];
  qacc: number[];
  qacc_warmstart: number[];
};
type Body = { com: Vec; rotation: number[]; quaternion: number[]; omega: Vec; velocity: Vec };
type Frame = { normal: Vec; downhill: Vec; positiveTipAxis: Vec };
type Contact = {
  geom: number[];
  dist: number;
  pos: Vec;
  frame: number[];
  dim: number;
  efc_address: number;
  force: number[];
};
type Forward = {
  bodies: Record<number, Body>;
  efcVel: number[];
  efcType: number[];
  efcId: number[];
  ncon: number;
  nefc: number;
};
type Force = {
  contacts: Contact[];
  efcForce: number[];
  qfrcConstraint: number[];
  warnings: number[][];
  islands: number;
  endpoint: State;
};
type RowIds = Pick<Forward, 'ncon' | 'nefc' | 'efcType' | 'efcId'>;
type RetainedRows = RowIds & {
  typeLength: number;
  idLength: number;
  forceLength: number;
  efcForce: number[];
};
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
type Resources = {
  temporaryCreated: number;
  temporaryDeleted: number;
  velocityCalls: number;
  contactForceCalls: number;
};
type Support = {
  loaded: number;
  maxSlip: number;
  outwardForce: number;
  supported: boolean;
  downhillRim: boolean;
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
  signature: boolean;
  signatureLoaded: boolean;
};
type Observer = {
  copyState(data: NativeData): State;
  phaseState(state: State): unknown;
  copyWarnings(data: NativeData, resources: Resources): number[][];
  canonicalEqual(left: unknown, right: unknown): boolean;
  finite(value: unknown): boolean;
  floorFrame(theta: number): Frame;
  captureForward(
    engine: Native,
    model: NativeModel,
    data: NativeData,
    pre: State,
    ids: object,
    resources: Resources,
    buffer: Handle,
    limits: object,
  ): Forward;
  captureForces(
    engine: Native,
    model: NativeModel,
    data: NativeData,
    forward: Forward,
    resources: Resources,
    buffer: Handle,
    limits: object,
  ): Force;
  assessContacts(
    cylinder: Cylinder,
    forward: Forward,
    force: Force,
    ids: object,
    frame: Frame,
  ): { bodies: { cylinder: Support } };
  bodyEndpoint(state: State, shape: object): Body;
  tiltState(body: Body, theta: number, omega: number, cylinder: Cylinder): Tilt;
  assessWindow(
    intervals: Interval[],
    cylinder: Cylinder,
    stepUs: number,
    theta: number,
    type: 'stable' | 'tip',
  ): { accepted: boolean; firstTick?: number; lastTick?: number };
};

const env = process.env;
const repository = realpathSync(new URL('../../../', import.meta.url));
const stepSeconds = f.schedule.stepUs / 1_000_000;
const ticksPerWindow = f.schedule.windowUs / f.schedule.stepUs;
const archiveRoot = env['ASA_D01_FIXED_ARCHIVE'] ?? '';
const nativeEnabled = env['ASA_D01_FIXED_RUN'] === 'fixed-tilt-frozen-1071';

function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function hash(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isBelow(root: string, path: string) {
  const rel = relative(root, path);
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function pinned(path: string, pin: string, maxBytes: number, exactBytes?: number) {
  requireThat(isAbsolute(path) && /^[a-f0-9]{64}$/.test(pin), 'INPUT_PIN ' + path);
  const size = statSync(path).size;
  requireThat(
    size > 0 && size <= maxBytes && (exactBytes === undefined || size === exactBytes),
    'INPUT_SIZE ' + path,
  );
  const bytes = readFileSync(path);
  requireThat(bytes.length === size && hash(bytes) === pin, 'INPUT_SHA256 ' + path);
  return bytes;
}

function localPath(root: string, path: string) {
  const actual = realpathSync(resolve(root, path));
  requireThat(isBelow(root, actual), 'INPUT_PATH_ESCAPE ' + path);
  return actual;
}

function readArchive() {
  requireThat(isAbsolute(archiveRoot), 'REQUIRE_ABSOLUTE_ARCHIVE');
  const root = realpathSync(archiveRoot);
  const read = (entry: (string | number)[]) => {
    const [path, size, digest] = entry as [string, number, string];
    const location = localPath(root, path);
    return { location, bytes: pinned(location, digest, size, size) };
  };
  const a = f.archive;
  read(a.fixedSource);
  read(a.fixedRaw);
  const historical = JSON.parse(read(a.fixedFixture).bytes.toString('utf8')) as {
    engine: { contactProfile: string };
    cases: { angleDegrees: number; expected: string }[];
    nativeStepUs: number;
    durationUs: number;
  };
  const positional = JSON.parse(read(a.positionRaw).bytes.toString('utf8')) as {
    status: string;
    dynamicCalls: number;
    patchPin: string;
    fixturePin: string;
    sourcePin: string;
  };
  requireThat(
    positional.status === 'PASS_POSITION_ONLY' &&
      positional.dynamicCalls === 0 &&
      positional.patchPin === f.positionAdmission.patch &&
      positional.fixturePin === f.positionAdmission.fixture &&
      positional.sourcePin === f.positionAdmission.source,
    'POSITION_RECEIPT_BOUNDARY',
  );
  const cylinder = JSON.parse(read(a.cylinder).bytes.toString('utf8')) as Cylinder;
  requireThat(
    historical.engine.contactProfile === f.archive.engineProfile &&
      historical.nativeStepUs === f.schedule.stepUs &&
      historical.durationUs === f.schedule.durationUs &&
      historical.cases.length === f.cases.length &&
      f.cases.every(
        (c, i) =>
          historical.cases[i]?.angleDegrees === c.angle &&
          historical.cases[i]?.expected === c.expected,
      ) &&
      cylinder.tilt.stationaryWindowUs === f.schedule.windowUs &&
      cylinder.contact.maxLoadedSlipSpeedMps === 0.001 &&
      cylinder.contact.maxCumulativeSlipM === 0.0001 &&
      cylinder.contact.loadedDownhillRimFraction === 0.8 &&
      cylinder.solver.disableFlags === 196608 &&
      cylinder.solver.enableFlags === f.profileReadback.enableflags,
    'HISTORICAL_ORACLE_BINDING',
  );
  return { cylinder, observerPath: read(a.observer).location };
}

function readEngine(engine: Engine, directory: string) {
  requireThat(isAbsolute(directory), 'REQUIRE_ABSOLUTE_ENGINE');
  const root = realpathSync(directory);
  const module = localPath(root, 'mujoco.js');
  let wasm: Buffer | undefined;
  for (const [name, digest] of Object.entries(f.engines[engine].files)) {
    const bytes = pinned(
      localPath(root, name),
      digest,
      name === 'mujoco.wasm' ? 16_000_000 : 2_000_000,
    );
    if (name === 'mujoco.wasm') wasm = bytes;
  }
  requireThat(wasm, 'REQUIRE_PINNED_WASM');
  return { module, wasm };
}

async function loadEngine(artifact: ReturnType<typeof readEngine>) {
  const { default: initialize } = (await import(
    /* @vite-ignore */ pathToFileURL(artifact.module).href
  )) as {
    default(opts: { wasmBinary: Buffer; locateFile(name: string): string }): Promise<Native>;
  };
  const native = await initialize({
    wasmBinary: artifact.wasm,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'UNEXPECTED_ENGINE_RESOURCE');
      return resolve(dirname(artifact.module), name);
    },
  });
  requireThat(
    native.mj_versionString() === f.version && native.mj_version() === 4000000,
    'ENGINE_VERSION',
  );
  return native;
}

function initialGeometry(cylinder: Cylinder, angle: number) {
  const theta = (angle * Math.PI) / 180;
  const normal: Vec = [Math.sin(theta), 0, Math.cos(theta)];
  const rotation = [Math.cos(theta / 2), 0, Math.sin(theta / 2), 0];
  const floorPosition = scale(normal, cylinder.bodies.floor.fixedCenterZ);
  const canPosition = scale(normal, cylinder.bodies.cylinder.heightM / 2 + cylinder.initialGapM);
  return { theta, rotation, floorPosition, canPosition };
}

function modelXml(cylinder: Cylinder, angle: number) {
  const { rotation, floorPosition, canPosition } = initialGeometry(cylinder, angle);
  const { cylinder: can, floor } = cylinder.bodies;
  const s = cylinder.solver;
  const c = cylinder.contact;
  return [
    '<mujoco model="asa1071_fixed_tilt">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false"/>',
    '<option timestep="' + stepSeconds + '" gravity="' + cylinder.gravity.join(' ') + '"',
    'integrator="' +
      s.integrator +
      '" solver="' +
      s.solver +
      '" jacobian="' +
      s.jacobian +
      '" cone="' +
      s.cone +
      '"',
    'iterations="' +
      s.iterations +
      '" tolerance="' +
      s.tolerance +
      '" ls_iterations="' +
      s.lsIterations +
      '"',
    'ls_tolerance="' +
      s.lsTolerance +
      '" noslip_iterations="' +
      s.noSlipIterations +
      '" noslip_tolerance="' +
      s.noSlipTolerance +
      '"',
    'impratio="' +
      s.impratio +
      '" ccd_iterations="' +
      s.ccdIterations +
      '" ccd_tolerance="' +
      s.ccdTolerance +
      '"',
    'density="0" viscosity="0" wind="0 0 0">',
    '<flag warmstart="enable" island="enable" refsafe="enable" nativeccd="enable" multiccd="enable"',
    'diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable"',
    'invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/>',
    '</option>',
    '<default><geom condim="3" friction="' + c.geomFriction.join(' ') + '" margin="0" gap="0"',
    'solref="' + c.solref.join(' ') + '" solimp="' + c.solimp.join(' ') + '"/></default>',
    '<worldbody><geom name="' +
      f.pair.deck +
      '" type="box" size="' +
      floor.halfExtentsM.join(' ') +
      '"',
    'pos="' + floorPosition.join(' ') + '" quat="' + rotation.join(' ') + '"/>',
    '<body name="cylinder" pos="' + canPosition.join(' ') + '" quat="' + rotation.join(' ') + '">',
    '<freejoint name="cylinder_free"/>',
    '<inertial pos="0 0 0" mass="' +
      can.massKg +
      '" diaginertia="' +
      can.inertiaKgM2.join(' ') +
      '"/>',
    '<geom name="' +
      f.pair.can +
      '" type="cylinder" size="' +
      can.radiusM +
      ' ' +
      can.heightM / 2 +
      '"/>',
    '</body></worldbody>',
    '<contact><pair geom1="' + f.pair.deck + '" geom2="' + f.pair.can + '" condim="3"',
    'friction="' + c.pairFriction.join(' ') + '" solref="' + c.solref.join(' ') + '"',
    'solreffriction="' +
      c.solreffriction.join(' ') +
      '" solimp="' +
      c.solimp.join(' ') +
      '" margin="0" gap="0"/></contact>',
    '</mujoco>',
    '',
  ].join('\n');
}

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

type Witness = { pos: Vec; dist: number };

function halfDepthWitness(body: Body, plane: Frame, cylinder: Cylinder): Witness[] {
  const n = plane.normal;
  const lateral = cross(n, plane.downhill);
  const { radiusM: radius, heightM } = cylinder.bodies.cylinder;
  const halfSize = cylinder.bodies.floor.halfExtentsM;
  const [x, y, z] = [body.rotation[2]!, body.rotation[5]!, body.rotation[8]!];
  let axis: Vec = [x, y, z];
  if (dot(axis, n) < 0) axis = scale(axis, -1);
  const axial = dot(axis, n);
  const base = subtract(body.com, scale(axis, heightM / 2));
  const rimUp = subtract(n, scale(axis, axial));
  const slope = Math.hypot(...rimUp);
  const reach = radius * slope;
  const s = dot(base, n);
  const deepest = s - reach;
  // Pinned C mjMINVAL predicate, separate from the historical physical oracle.
  if (!(
    axial > 1e-15 &&
    slope > 1e-15 &&
    Math.abs(s) < reach &&
    deepest > -2 * halfSize[2] &&
    deepest + heightM * axial > 0
  ))
    return [];
  for (const [index, direction] of [plane.downhill, lateral].entries()) {
    const projection = dot(axis, direction);
    const extent = radius * Math.sqrt(Math.max(0, 1 - projection * projection));
    const from = dot(base, direction);
    const to = from - (deepest * projection) / axial;
    if (!(Math.max(Math.abs(from), Math.abs(to)) + extent < halfSize[index]! - f.pair.interiorM))
      return [];
  }
  const down = scale(rimUp, -1 / slope);
  const side = cross(axis, down);
  const sideNorm = Math.hypot(...side);
  if (!(sideNorm > 1e-15)) return [];
  const cosine = (1 + s / reach) / 2;
  const flank = Math.acos(cosine);
  if (!(2 * radius ** 2 * Math.sin(flank) * (1 - cosine) * axial > 1e-15)) return [];
  return [0, flank, -flank].map((angle) => {
    const rim = add(
      base,
      scale(add(scale(down, Math.cos(angle)), scale(side, Math.sin(angle) / sideNorm)), radius),
    );
    const dist = dot(rim, n);
    return { dist, pos: subtract(rim, scale(n, dist / 2)) };
  });
}

const maxRows = f.pair.allocatedContacts * f.pair.dim;

function readRetainedRows(data: NativeData): RetainedRows {
  const types = data.efc_type;
  const ids = data.efc_id;
  const forces = data.efc_force;
  return {
    ncon: data.ncon,
    nefc: data.nefc,
    typeLength: types.length,
    idLength: ids.length,
    forceLength: forces.length,
    efcType: Array.from(types.subarray(0, maxRows)),
    efcId: Array.from(ids.subarray(0, maxRows)),
    efcForce: Array.from(forces.subarray(0, maxRows)),
  };
}

function sameRetainedRows(pre: RowIds, post: RetainedRows) {
  return (
    Number.isSafeInteger(pre.ncon) &&
    pre.ncon >= 0 &&
    pre.ncon <= f.pair.allocatedContacts &&
    Number.isSafeInteger(pre.nefc) &&
    pre.nefc >= 0 &&
    pre.nefc <= maxRows &&
    pre.ncon === post.ncon &&
    pre.nefc === post.nefc &&
    pre.efcType.length === pre.nefc &&
    pre.efcId.length === pre.nefc &&
    post.typeLength === pre.nefc &&
    post.idLength === pre.nefc &&
    post.forceLength === pre.nefc &&
    post.efcType.length === pre.nefc &&
    post.efcId.length === pre.nefc &&
    post.efcForce.length === pre.nefc &&
    pre.efcType.every((type, row) => type === post.efcType[row]) &&
    pre.efcId.every((id, row) => id === post.efcId[row])
  );
}

function sameRetainedForces(
  pre: RowIds,
  post: RetainedRows,
  force: Pick<Force, 'contacts' | 'efcForce'>,
) {
  return (
    force.contacts.length === pre.ncon &&
    force.efcForce.length === pre.nefc &&
    force.efcForce.every((value, row) => Object.is(value, post.efcForce[row]))
  );
}

function dispatchSignature(points: Witness[], contacts: Contact[], forward: Forward, frame: Frame) {
  if (
    points.length !== f.pair.candidateContacts ||
    contacts.length !== points.length ||
    forward.nefc !== points.length * f.pair.dim
  )
    return false;
  const seen = new Set<number>();
  return contacts.every((contact, index) => {
    const [first, second] = contact.geom;
    const sign = first === 0 && second === 1 ? 1 : first === 1 && second === 0 ? -1 : 0;
    const address = contact.efc_address;
    const normal = contact.frame.slice(0, 3) as Vec;
    const match = points.findIndex(
      (point, i) =>
        !seen.has(i) &&
        Math.abs(point.dist - contact.dist) <= f.pair.witnessAgreementM &&
        Math.hypot(...subtract(point.pos, contact.pos)) <= f.pair.witnessAgreementM,
    );
    if (
      !sign ||
      match < 0 ||
      contact.dim !== f.pair.dim ||
      address < 0 ||
      Math.abs(sign * dot(normal, frame.normal) - 1) > f.pair.frameTolerance ||
      ![0, 1, 2].every(
        (row) => forward.efcType[address + row] === 7 && forward.efcId[address + row] === index,
      )
    )
      return false;
    seen.add(match);
    return true;
  });
}

const bodyId = 1;
const canGeom = 1;
const floorGeom = 0;

function readbackModel(
  engine: Native,
  model: NativeModel,
  data: NativeData,
  observer: Observer,
  cylinder: Cylinder,
  angle: number,
) {
  const { canPosition, floorPosition, rotation } = initialGeometry(cylinder, angle);
  const { cylinder: can, floor } = cylinder.bodies;
  const s = cylinder.solver;
  const c = cylinder.contact;
  const counts = {
    nq: 7,
    nv: 6,
    na: 0,
    nu: 0,
    nbody: 2,
    ngeom: 2,
    njnt: 1,
    npair: 1,
    nsensor: 0,
    nplugin: 0,
    neq: 0,
    nflex: 0,
    ntendon: 0,
    nmocap: 0,
  };
  const values = {
    geom_type: [6, 5],
    geom_bodyid: [0, 1],
    geom_condim: [f.pair.dim, f.pair.dim],
    geom_friction: [...c.geomFriction, ...c.geomFriction],
    geom_size: [...floor.halfExtentsM, can.radiusM, can.heightM / 2, 0],
    jnt_type: [0],
    jnt_qposadr: [0],
    jnt_dofadr: [0],
    body_mass: [0, can.massKg],
    body_ipos: [0, 0, 0, 0, 0, 0],
    body_gravcomp: [0, 0],
    dof_damping: [0, 0, 0, 0, 0, 0],
    dof_frictionloss: [0, 0, 0, 0, 0, 0],
    dof_armature: [0, 0, 0, 0, 0, 0],
    geom_margin: [0, 0],
    geom_gap: [0, 0],
    geom_adhesion: [0, 0],
    geom_surfacevel: Array<number>(counts.ngeom * 6).fill(0),
    pair_adhesion: [0],
    pair_dim: [f.pair.dim],
    pair_geom1: [floorGeom],
    pair_geom2: [canGeom],
    pair_friction: c.pairFriction,
    pair_solref: c.solref,
    pair_solreffriction: c.solreffriction,
    pair_solimp: c.solimp,
    pair_gap: [f.pair.gap],
    pair_margin: [f.pair.margin],
  };
  const options = {
    timestep: stepSeconds,
    gravity: cylinder.gravity,
    wind: [0, 0, 0],
    integrator: s.integratorValue,
    solver: s.solverValue,
    jacobian: s.jacobianValue,
    cone: s.coneValue,
    iterations: s.iterations,
    tolerance: s.tolerance,
    ls_iterations: s.lsIterations,
    ls_tolerance: s.lsTolerance,
    noslip_iterations: s.noSlipIterations,
    noslip_tolerance: s.noSlipTolerance,
    impratio: s.impratio,
    ccd_iterations: s.ccdIterations,
    ccd_tolerance: s.ccdTolerance,
    density: 0,
    viscosity: 0,
    disableactuator: 0,
    ...f.profileReadback,
  };
  const read = (fields: Record<string, number | number[]>, object: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(fields).map(([key, value]) => {
        const native = object[key];
        const copied = Array.isArray(value) ? Array.from(native as ArrayLike<number>) : native;
        expect(copied, key).toEqual(value);
        return [key, copied];
      }),
    );
  const geomNames = [engine.mj_id2name(model, 5, floorGeom), engine.mj_id2name(model, 5, canGeom)];
  expect(geomNames).toEqual([f.pair.deck, f.pair.can]);
  const maxContacts = engine.mj_maxContact(model, canGeom, floorGeom, 0);
  expect(maxContacts).toBe(f.pair.allocatedContacts);
  const readCounts = read(counts, model);
  const readValues = read(values, model);
  const readOpts = read(options, model.opt); // borrowed model member
  const initial = observer.copyState(data);
  requireThat(observer.finite(initial), 'NONFINITE_FACTORY_STATE');
  expect(initial.time).toBe(0);
  expect(initial.qvel).toEqual([0, 0, 0, 0, 0, 0]);
  const measures = [
    {
      read: Array.from(model['body_inertia'] as ArrayLike<number>).slice(3),
      expected: can.inertiaKgM2,
    },
    {
      read: Array.from(model['geom_pos'] as ArrayLike<number>).slice(0, 3),
      expected: floorPosition,
    },
    { read: Array.from(model['geom_quat'] as ArrayLike<number>).slice(0, 4), expected: rotation },
    { read: initial.qpos, expected: [...canPosition, ...rotation] },
  ];
  for (const { read, expected } of measures) {
    expect(read).toHaveLength(expected.length);
    expect(read.every((value, index) => Math.abs(value - expected[index]!) <= 1e-12)).toBe(true);
  }
  return {
    geomNames,
    counts: readCounts,
    values: readValues,
    options: readOpts,
    measures,
    maxContacts,
    initial,
  };
}

function stableWarnings(data: NativeData, warnings: number[][], cylinder: Cylinder) {
  return (
    data.warning.size() === cylinder.resources.warningCount &&
    warnings.length === cylinder.resources.warningCount &&
    warnings.every(([count, info]) => count === 0 && info === 0)
  );
}

function noExternalForce(data: NativeData) {
  return (
    data.qfrc_applied.length === 6 &&
    data.xfrc_applied.length === 12 &&
    data.ctrl.length === 0 &&
    data.qfrc_applied.every((value) => value === 0) &&
    data.xfrc_applied.every((value) => value === 0)
  );
}

function validClock(tick: number, previous: number, current: number) {
  const expected = (tick * f.schedule.stepUs) / 1_000_000;
  const gamma = (tick * Number.EPSILON) / (1 - tick * Number.EPSILON);
  const budget = (gamma + 2 * Number.EPSILON) * Math.max(expected, stepSeconds);
  return current > previous && Math.abs(current - expected) <= budget;
}

function runWorld(
  native: Native,
  engine: Engine,
  scenario: RegisteredCase,
  xml: string,
  observer: Observer,
  cylinder: Cylinder,
  append: Append,
  dispatch: Dispatch,
) {
  const world = engine + ':' + scenario.angle;
  const theta = initialGeometry(cylinder, scenario.angle).theta;
  const frame = observer.floorFrame(theta);
  const can = cylinder.bodies.cylinder;
  const shape = {
    name: 'cylinder',
    kind: 'cylinder',
    bodyId,
    geomId: canGeom,
    qposAdr: 0,
    dofAdr: 0,
    mass: can.massKg,
    radius: can.radiusM,
    height: can.heightM,
  };
  const ids = {
    bodyIds: [0, bodyId],
    geomBodies: [0, bodyId],
    floorGeom,
    freeBodies: [shape],
  };
  const limits = {
    maxContacts: f.pair.allocatedContacts,
    maxConstraintRows: f.pair.dim * f.pair.allocatedContacts,
    maxIslands: cylinder.resources.maxIslands,
    pairCaps: [{ geom: [floorGeom, canGeom], maxContacts: f.pair.allocatedContacts }],
    maxContactVectors: f.schedule.stepsPerWorld * 2,
    maxContactGets: f.schedule.stepsPerWorld * 2 * f.pair.allocatedContacts,
  };
  const resources = {
    temporaryCreated: 0,
    temporaryDeleted: 0,
    velocityCalls: 0,
    contactForceCalls: 0,
  };
  let model: NativeModel | undefined;
  let data: NativeData | undefined;
  let buffer: Handle | undefined;
  let stage = 'model';
  const window: Interval[] = [];
  let cumulativeSlipM = 0;
  let hadLoad = false;
  let firstFailure: { tick: number; code: string } | undefined;
  let confirmedTip: { tick: number; loadedSignatures: number } | undefined;
  let firstLoadedSignature: number | undefined;
  let loadedSignatures = 0;
  let eligible = 0;
  let signatures = 0;
  const noteFailure = (tick: number, code: string) => {
    if (firstFailure) return;
    firstFailure = { tick, code };
    append('world-physical-failure', { world, ...firstFailure });
  };
  const cleanup: { deleted: string[]; errors: string[] } = { deleted: [], errors: [] };
  let runtimeError: unknown;
  try {
    model = native.MjModel.from_xml_string(xml);
    requireThat(model, 'MODEL_COMPILE_FAILED');
    data = new native.MjData(model);
    buffer = new native.DoubleBuffer(6);
    stage = 'factory-readback';
    const modelReadback = readbackModel(native, model, data, observer, cylinder, scenario.angle);
    requireThat(data.warning.size() === cylinder.resources.warningCount, 'WARNING_COUNT');
    requireThat(
      stableWarnings(data, observer.copyWarnings(data, resources), cylinder),
      'FACTORY_WARNING',
    );
    requireThat(noExternalForce(data), 'FACTORY_EXTERNAL_FORCE');
    append('world-start', { world, xmlSha256: hash(xml), modelReadback, limits });
    for (let tick = 1; tick <= f.schedule.stepsPerWorld; tick++) {
      stage = 'step1';
      const pre = observer.copyState(data);
      requireThat(observer.finite(pre), 'NONFINITE_PRE');
      dispatch.step1++;
      native.mj_step1(model, data);
      dispatch.step1Returned++;
      requireThat(
        observer.canonicalEqual(
          observer.phaseState(pre),
          observer.phaseState(observer.copyState(data)),
        ),
        'STEP1_STATE_MUTATION',
      );
      stage = 'observe-pre';
      const forward = observer.captureForward(
        native,
        model,
        data,
        pre,
        ids,
        resources,
        buffer,
        limits,
      );
      const body = forward.bodies[bodyId]!;
      const points = halfDepthWitness(body, frame, cylinder);
      stage = 'step2';
      dispatch.step2++;
      native.mj_step2(model, data);
      dispatch.step2Returned++;
      stage = 'observe-solved';
      const activeData = data;
      const retainedRows = readRetainedRows(activeData);
      const recordRowMismatch = (code: string, force?: Force): never => {
        append('world-row-mismatch', {
          world,
          tick,
          code,
          pre,
          post: observer.copyState(activeData),
          preRows: {
            ncon: forward.ncon,
            nefc: forward.nefc,
            efcType: forward.efcType,
            efcId: forward.efcId,
          },
          retainedRows,
          force,
        });
        throw new Error(code);
      };
      if (!sameRetainedRows(forward, retainedRows))
        recordRowMismatch('STEP2_RETAINED_ROW_IDENTITY');
      let force: Force;
      try {
        requireThat(data.warning.size() === cylinder.resources.warningCount, 'WARNING_COUNT');
        force = observer.captureForces(native, model, data, forward, resources, buffer, limits);
      } catch (error) {
        append('native-interval-invalid', {
          world,
          tick,
          pre,
          post: observer.copyState(data),
          forward,
          retainedRows,
          error: String(error),
        });
        throw error;
      }
      if (!sameRetainedForces(forward, retainedRows, force))
        recordRowMismatch('STEP2_RETAINED_FORCE_ROWS', force);
      const post = force.endpoint;
      const tiltPre = observer.tiltState(body, theta, 0, cylinder);
      const tiltPost = observer.tiltState(observer.bodyEndpoint(post, shape), theta, 0, cylinder);
      const raw = {
        world,
        tick,
        pre,
        post,
        tiltPre,
        tiltPost,
        observation: {
          contacts: force.contacts,
          preBodies: forward.bodies,
          ncon: forward.ncon,
          nefc: forward.nefc,
          efcVel: forward.efcVel,
          efcType: forward.efcType,
          efcId: forward.efcId,
          efcForce: force.efcForce,
          retainedRowCounts: {
            ncon: retainedRows.ncon,
            nefc: retainedRows.nefc,
            typeLength: retainedRows.typeLength,
            idLength: retainedRows.idLength,
            forceLength: retainedRows.forceLength,
          },
          qfrcConstraint: force.qfrcConstraint,
          warnings: force.warnings,
          islands: force.islands,
        },
      };
      stage = 'interval-invariants';
      let support: Support;
      try {
        requireThat(
          observer.finite({ pre, forward, force, tiltPre, tiltPost }),
          'NONFINITE_NATIVE_INTERVAL',
        );
        requireThat(stableWarnings(data, force.warnings, cylinder), 'NATIVE_WARNING');
        requireThat(validClock(tick, pre.time, post.time), 'NATIVE_CLOCK');
        requireThat(noExternalForce(data), 'UNEXPECTED_FORCE');
        support = observer.assessContacts(cylinder, forward, force, ids, frame).bodies.cylinder;
      } catch (error) {
        append('native-interval-invalid', { ...raw, error: String(error) });
        throw error;
      }
      const signature = dispatchSignature(points, force.contacts, forward, frame);
      const signatureLoaded = signature && force.contacts.some((contact) => contact.force[0]! > 0);
      eligible += Number(points.length > 0);
      signatures += Number(signature);
      loadedSignatures += Number(signatureLoaded);
      if (signatureLoaded) firstLoadedSignature ??= tick;
      append('native-interval', {
        ...raw,
        attribution: {
          eligible: points.length > 0,
          geometricSignature: signature,
          loadedSignature: signatureLoaded,
        },
      });
      if (confirmedTip) continue;
      stage = 'physical-gates';
      const loaded = support.loaded > 0;
      hadLoad ||= loaded;
      cumulativeSlipM += support.maxSlip * stepSeconds;
      if (cumulativeSlipM > cylinder.contact.maxCumulativeSlipM)
        noteFailure(tick, 'FIXED_CAN_CUMULATIVE_SLIP');
      if (loaded && (!support.supported || !(support.outwardForce > 0)))
        noteFailure(tick, 'FIXED_CAN_CONTACT_DOMAIN');
      window.push({
        tick,
        pre: tiltPre,
        post: tiltPost,
        loaded,
        positiveSupport: support.outwardForce > 0,
        supported: support.supported,
        downhillRim: support.downhillRim,
        noSlip: support.maxSlip <= cylinder.contact.maxLoadedSlipSpeedMps,
        signature,
        signatureLoaded,
      });
      if (window.length > ticksPerWindow) window.shift();
      if (
        !firstFailure &&
        observer.assessWindow(window, cylinder, f.schedule.stepUs, theta, 'tip').accepted
      ) {
        confirmedTip = {
          tick,
          loadedSignatures: window.filter((interval) => interval.signatureLoaded).length,
        };
        append('confirmed-tip', { world, ...confirmedTip, tiltPost, cumulativeSlipM });
      }
    }
  } catch (error) {
    runtimeError = error;
    append('world-runtime-failure', { world, stage, dispatch, error: String(error) });
  } finally {
    for (const [name, handle] of [
      ['buffer', buffer],
      ['data', data],
      ['model', model],
    ] as const) {
      if (!handle) continue;
      try {
        handle.delete();
        cleanup.deleted.push(name);
      } catch (error) {
        cleanup.errors.push(name + ': ' + String(error));
      }
    }
    append('world-resources', { world, stage, dispatch, resources, cleanup });
  }
  if (runtimeError !== undefined) throw runtimeError;
  requireThat(
    cleanup.errors.length === 0 &&
      cleanup.deleted.length === 3 &&
      resources.temporaryCreated === resources.temporaryDeleted,
    'RESOURCE_CLEANUP ' + world,
  );
  requireThat(
    resources.velocityCalls === 2 * f.schedule.stepsPerWorld &&
      resources.contactForceCalls <= f.schedule.stepsPerWorld * f.pair.allocatedContacts,
    'RESOURCE_CALL_BOUND ' + world,
  );
  const stable = observer.assessWindow(
    window,
    cylinder,
    f.schedule.stepUs,
    theta,
    'stable',
  ).accepted;
  const passes =
    hadLoad && (scenario.expected === 'stable' ? stable && !confirmedTip : Boolean(confirmedTip));
  if (!passes)
    noteFailure(
      f.schedule.stepsPerWorld,
      scenario.expected === 'stable' ? 'FIXED_CAN_NO_STABLE_WINDOW' : 'FIXED_CAN_NO_TIP_WINDOW',
    );
  const result = {
    engine,
    angle: scenario.angle,
    world,
    dispatch,
    verdict: firstFailure ? 'FAIL' : 'PASS',
    firstFailure,
    stable,
    confirmedTip,
    cumulativeSlipM,
    hadLoad,
    attribution: {
      eligible,
      signatures,
      loadedSignatures,
      firstLoadedSignature,
      decidingLoadedSignatures:
        scenario.expected === 'stable'
          ? window.filter((interval) => interval.signatureLoaded).length
          : (confirmedTip?.loadedSignatures ?? 0),
    },
  };
  append('world-outcome', result);
  return result;
}

function openReceipt() {
  const path = env['ASA_D01_FIXED_OUTPUT'] ?? '';
  requireThat(
    isAbsolute(path) && /^[a-z0-9][a-z0-9.-]*[.]ndjson$/i.test(basename(path)),
    'REQUIRE_ABSOLUTE_NDJSON',
  );
  const parent = realpathSync(dirname(path));
  const temp = realpathSync(tmpdir());
  requireThat(
    isBelow(temp, parent) && !isBelow(repository, parent) && parent !== repository,
    'RECEIPT_REQUIRES_EXTERNAL_TEMP',
  );
  const descriptor = openSync(join(parent, basename(path)), 'wx', 0o600);
  let bytes = 0;
  const append: Append = (kind, payload) => {
    const line = Buffer.from(
      JSON.stringify({ kind, ...payload }, (_key, value: unknown) =>
        typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
          ? { $float64: Object.is(value, -0) ? '-0' : String(value) }
          : value,
      ) + '\n',
    );
    const footer =
      kind === 'acquisition-end' ||
      kind === 'world-resources' ||
      kind === 'world-runtime-failure' ||
      kind === 'world-row-mismatch' ||
      kind === 'native-interval-invalid';
    requireThat(
      bytes + line.length <=
        f.schedule.maxJournalBytes - (footer ? 0 : f.schedule.reservedFooterBytes),
      'RAW_JOURNAL_CAP',
    );
    requireThat(writeSync(descriptor, line) === line.length, 'RAW_SHORT_WRITE');
    bytes += line.length;
  };
  return { descriptor, append };
}

function verifyCommittedAdmission() {
  const { patch, fixture, source } = f.positionAdmission;
  expect(
    hash(
      readFileSync(
        new URL('../../../tools/robotics-field-core/mujoco-finite-cap-v1.patch', import.meta.url),
      ),
    ),
  ).toBe(patch);
  expect(
    hash(readFileSync(new URL('./mujoco-finite-cap-admission.fixture.json', import.meta.url))),
  ).toBe(fixture);
  expect(
    hash(readFileSync(new URL('./mujoco-finite-cap-admission.spec.ts', import.meta.url))),
  ).toBe(source);
}

it('pins position admission and the four nativeCCD case budgets without initializing MuJoCo', () => {
  verifyCommittedAdmission();
  expect(f.cases.map((scenario) => [scenario.angle, scenario.expected])).toEqual([
    [28, 'stable'],
    [32, 'tip'],
  ]);
  const critical = Math.atan2(0.033, 0.0575) * (180 / Math.PI);
  expect(critical).toBeCloseTo(29.85207626918268, 12);
  expect(32 - critical).toBeGreaterThan(2);
  expect(ticksPerWindow).toBe(200);
  expect(f.schedule.order).toEqual(['candidate:28', 'candidate:32', 'stock:28', 'stock:32']);
  expect(f.schedule.stepsPerWorld * f.schedule.stepUs).toBe(f.schedule.durationUs);
  expect(f.schedule.stepsPerWorld * f.schedule.worlds).toBe(f.schedule.totalSteps);
  expect(f.schedule.totalSteps).toBe(16_000);
  expect(f.profileReadback).toEqual({ disableflags: 65536, enableflags: 32 });
});

it('requires ordered PRE rows and the same bounded solved row forces', () => {
  const pre: RowIds = {
    ncon: 2,
    nefc: 6,
    efcType: [7, 7, 7, 7, 7, 7],
    efcId: [0, 0, 0, 1, 1, 1],
  };
  const post: RetainedRows = {
    ...pre,
    typeLength: 6,
    idLength: 6,
    forceLength: 6,
    efcForce: [1, 0, 0, 2, 0, 0],
  };
  expect(sameRetainedRows(pre, post)).toBe(true);
  expect(sameRetainedRows(pre, { ...post, efcId: [1, 1, 1, 0, 0, 0] })).toBe(false);
  expect(sameRetainedRows(pre, { ...post, efcType: [7, 7, 7, 7, 7, 6] })).toBe(false);
  expect(sameRetainedRows(pre, { ...post, forceLength: 5 })).toBe(false);
  expect(sameRetainedRows(pre, { ...post, ncon: 1 })).toBe(false);
  expect(sameRetainedRows(pre, { ...post, nefc: 5 })).toBe(false);
  const contacts = [0, 1].map((i) => ({
    geom: [0, 1],
    dist: -0.001,
    pos: [0, 0, 0] as Vec,
    frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
    dim: 3,
    efc_address: i * 3,
    force: [],
  }));
  expect(sameRetainedForces(pre, post, { contacts, efcForce: post.efcForce })).toBe(true);
  expect(sameRetainedForces(pre, post, { contacts, efcForce: post.efcForce.slice(0, 5) })).toBe(
    false,
  );
});

it.runIf(Boolean(archiveRoot))(
  'checks the preserved archive and authored model digests without loading native',
  () => {
    const { cylinder } = readArchive();
    expect(cylinder.bodies.cylinder).toMatchObject({ massKg: 0.5, radiusM: 0.033, heightM: 0.115 });
    expect(cylinder.bodies.floor.halfExtentsM).toEqual([0.5, 0.5, 0.025]);
    expect(cylinder.gravity).toEqual([0, 0, -9.81]);
    expect(cylinder.initialGapM).toBe(0.0001);
    expect(cylinder.contact.pairFriction).toEqual([1, 1, 0, 0, 0]);
    const frame: Frame = { normal: [0, 0, 1], downhill: [1, 0, 0], positiveTipAxis: [0, 1, 0] };
    const { radiusM: radius, heightM } = cylinder.bodies.cylinder;
    const tilt = 0.1;
    const sine = Math.sin(tilt);
    const cosine = Math.cos(tilt);
    const body: Body = {
      com: scale([sine, 0, cosine], heightM / 2),
      rotation: [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine],
      quaternion: [Math.cos(tilt / 2), 0, Math.sin(tilt / 2), 0],
      omega: [0, 0, 0],
      velocity: [0, 0, 0],
    };
    const witnesses = halfDepthWitness(body, frame, cylinder);
    expect(witnesses).toHaveLength(3);
    expect(witnesses[0]!.dist).toBeCloseTo(-radius * sine, 13);
    expect(witnesses[1]!.dist).toBeCloseTo(witnesses[0]!.dist / 2, 13);
    const forward: Forward = {
      bodies: { 1: body },
      ncon: 3,
      nefc: 9,
      efcType: Array<number>(9).fill(7),
      efcId: [0, 0, 0, 1, 1, 1, 2, 2, 2],
      efcVel: Array<number>(9).fill(0),
    };
    const matching = witnesses.map((point, index) => ({
      ...point,
      geom: [0, 1],
      dim: 3,
      frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
      efc_address: index * 3,
      force: [1, 0, 0, 0, 0, 0],
    }));
    expect(dispatchSignature(witnesses, matching, forward, frame)).toBe(true);
    expect(
      dispatchSignature(
        witnesses,
        matching,
        { ...forward, efcId: Array<number>(9).fill(0) },
        frame,
      ),
    ).toBe(false);
    expect(
      dispatchSignature(
        witnesses,
        matching.map((contact) => ({ ...contact, geom: [1, 0] })),
        forward,
        frame,
      ),
    ).toBe(false);
    expect(
      halfDepthWitness({ ...body, com: add(body.com, [0.49, 0, 0]) }, frame, cylinder),
    ).toEqual([]);
    for (const scenario of f.cases)
      expect(hash(modelXml(cylinder, scenario.angle)), 'angle ' + scenario.angle).toBe(
        scenario.xmlSha256,
      );
  },
);

it.runIf(Boolean(env['ASA_D01_FIXED_CANDIDATE'] && env['ASA_D01_FIXED_STOCK']))(
  'verifies both frozen engine artifacts without loading or instantiating WebAssembly',
  () => {
    const candidate = readEngine('candidate', env['ASA_D01_FIXED_CANDIDATE']!);
    const stock = readEngine('stock', env['ASA_D01_FIXED_STOCK']!);
    expect(candidate.module).not.toBe(stock.module);
    expect(candidate.wasm.subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
    expect(stock.wasm.subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
  },
);

it.runIf(nativeEnabled)(
  'records the frozen candidate and matched stock physical verdicts',
  async () => {
    const { descriptor, append } = openReceipt();
    let runtimeStage = 'pins';
    const attempted: { world: string; dispatch: Dispatch }[] = [];
    let finished = false;
    try {
      const fixturePin = env['ASA_D01_FIXED_FIXTURE_SHA256'] ?? '';
      const sourcePin = env['ASA_D01_FIXED_SOURCE_SHA256'] ?? '';
      pinned(
        realpathSync(new URL('./mujoco-finite-cap-fixed-tilt.fixture.json', import.meta.url)),
        fixturePin,
        32_768,
      );
      pinned(realpathSync(new URL(import.meta.url)), sourcePin, 65_536);
      verifyCommittedAdmission();
      const { cylinder, observerPath } = readArchive();
      const artifacts = {
        candidate: readEngine('candidate', env['ASA_D01_FIXED_CANDIDATE'] ?? ''),
        stock: readEngine('stock', env['ASA_D01_FIXED_STOCK'] ?? ''),
      };
      const models = f.cases.map((scenario) => {
        const xml = modelXml(cylinder, scenario.angle);
        requireThat(hash(xml) === scenario.xmlSha256, 'MODEL_XML_PIN ' + scenario.angle);
        return { scenario, xml };
      });
      append('acquisition-start', { fixturePin, sourcePin, fixture: f, models });
      runtimeStage = 'observer-import';
      const observer = (await import(
        /* @vite-ignore */ pathToFileURL(observerPath).href
      )) as Observer;
      const outcomes: ReturnType<typeof runWorld>[] = [];
      for (const engine of ['candidate', 'stock'] as const) {
        runtimeStage = 'engine-initialization:' + engine;
        const native = await loadEngine(artifacts[engine]);
        for (const { scenario, xml } of models) {
          runtimeStage = 'world:' + engine + ':' + scenario.angle;
          const dispatch = { step1: 0, step1Returned: 0, step2: 0, step2Returned: 0 };
          attempted.push({ world: engine + ':' + scenario.angle, dispatch });
          outcomes.push(
            runWorld(native, engine, scenario, xml, observer, cylinder, append, dispatch),
          );
        }
      }
      const order = outcomes.map((result) => result.world);
      requireThat(
        order.every((world, index) => world === f.schedule.order[index]) &&
          order.length === f.schedule.worlds,
        'WORLD_ORDER',
      );
      const parts = outcomes.map((outcome) => outcome.dispatch);
      requireThat(
        parts.every((part) =>
          Object.values(part).every((steps) => steps === f.schedule.stepsPerWorld),
        ),
        'NATIVE_CALL_CENSUS',
      );
      const conditions = f.cases.map((scenario) => {
        const candidate = outcomes.find(
          (o) => o.engine === 'candidate' && o.angle === scenario.angle,
        )!;
        const stock = outcomes.find((o) => o.engine === 'stock' && o.angle === scenario.angle)!;
        const distinguished =
          candidate.verdict === 'PASS' &&
          stock.verdict === 'FAIL' &&
          candidate.attribution.decidingLoadedSignatures > 0 &&
          stock.attribution.signatures === 0;
        return {
          angle: scenario.angle,
          candidate: candidate.verdict,
          stock: stock.verdict,
          patchContribution: distinguished ? 'DISTINGUISHED_LOADED_SIGNATURE' : 'INCONCLUSIVE',
        };
      });
      const physical = conditions.every((condition) => condition.candidate === 'PASS')
        ? 'PASS'
        : 'FAIL';
      append('acquisition-end', { runtime: 'COMPLETE', physical, conditions, outcomes });
      finished = true;
      expect(physical, 'bounded two-angle candidate physical verdict (see raw journal)').toBe(
        'PASS',
      );
    } catch (error) {
      if (!finished)
        append('acquisition-end', {
          runtime: 'ERROR',
          runtimeStage,
          physical: 'UNRESOLVED',
          attempted,
          error: String(error),
        });
      throw error;
    } finally {
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }
  },
  f.schedule.timeoutMs,
);
