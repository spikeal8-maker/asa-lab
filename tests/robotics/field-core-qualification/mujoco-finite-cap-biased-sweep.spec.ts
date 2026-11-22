import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import f from './mujoco-finite-cap-biased-sweep.fixture.json';

type Vec = [number, number, number];
type Handle = { delete(): void };
type Model = Handle & Record<string, unknown>;
type Data = Handle &
  Record<string, unknown> & {
    time: number;
    ncon: number;
    nefc: number;
    ctrl: Float64Array;
  };
type Native = {
  mj_version(): number;
  mj_versionString(): string;
  mj_step1(model: Model, data: Data): void;
  mj_step2(model: Model, data: Data): void;
  mj_id2name(model: Model, kind: number, id: number): string;
  mj_maxContact(model: Model, g1: number, g2: number, margin: number): number;
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  DoubleBuffer: new (size: number) => Handle & { GetView(): Float64Array };
};
type Engine = keyof typeof f.engines;
type Pin = [string, number, string];
type Body = { com: Vec; rotation: number[]; omega: Vec; velocity: Vec };
type Frame = { rotation: number[]; normal: Vec; downhill: Vec; positiveTipAxis: Vec };
type State = {
  time: number;
  qpos: number[];
  qvel: number[];
  qacc: number[];
  qacc_warmstart: number[];
};
type Contact = {
  geom: number[];
  dist: number;
  pos: Vec;
  frame: number[];
  dim: number;
  efc_address: number;
  exclude: number;
};
type SolvedContact = Contact & { force: number[] };
type RowIds = { ncon: number; nefc: number; efcType: number[]; efcId: number[] };
type Forward = RowIds & { contacts: Contact[]; bodies: Record<number, Body>; efcVel: number[] };
type Force = {
  contacts: SolvedContact[];
  efcForce: number[];
  actuatorForce: number[];
  qfrcActuator: number[];
  qfrcConstraint: number[];
  endpoint: State;
  islands: number;
  solverIterations: number[];
  warnings: number[][];
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
type Cylinder = {
  initialGapM: number;
  bodies: {
    cylinder: { radiusM: number; heightM: number };
    floor: { halfExtentsM: Vec };
  };
  solver: { disableFlags: number; maxCombinedSolverIterationsPerIsland: number };
  tilt: {
    settleUs: number;
    targetStepDeg: number;
    targetStepRad: number;
    stationaryWindowUs: number;
    maxPreTipTrackingDeg: number;
    maxStageSpanDeg: number;
    rates: { id: string; rampUs: number; holdUs: number; maxActualSpeedRadps: number }[];
  };
  stand: { forceRangeNm: number[]; forceCapArithmeticAllowanceNm: number };
  contact: {
    maxLoadedSlipSpeedMps: number;
    maxCumulativeSlipM: number;
    velocityReconstructionToleranceMps: number;
  };
  resources: { warningCount: number; maxIslands: number };
};
type Resources = {
  temporaryCreated: number;
  temporaryDeleted: number;
  velocityCalls: number;
  contactForceCalls: number;
  contactVectorsCreated: number;
  contactGetsCreated: number;
  warningGetsCreated: number;
};
type Hooks = {
  strictDynamic: true;
  shape: { nq: number; nv: number; nu: number; nbody: number; ngeom: number; solverSlots: number };
  keyframes: number;
  warningCount: number;
  invoke<T>(api: string, call: () => T): T;
  stop(error: unknown): void;
};
type Limits = {
  maxContacts: number;
  maxConstraintRows: number;
  maxIslands: number;
  pairCaps: { geom: number[]; maxContacts: number }[];
};
type Condition = {
  id: string;
  maxSteps: number;
  dtUs: number;
  targets: number;
  kind: string;
  rate: string;
  phase: string;
};
type Control = { u: number; stage: number; target: number; phase: string; stageEndUs: number };
type Ids = {
  bodyIds: number[];
  geomBodies: number[];
  floorGeom: number;
  floorBody: number;
  freeBodies: object[];
};
type Readback = { options: Record<string, unknown> } & Record<string, unknown>;
type Harness = {
  cylinderPlan(cylinder: Cylinder, mode: 'admission'): Condition[];
  worldIds(cylinder: Cylinder, condition: Condition): Ids;
  makeCylinderXml(cylinder: Cylinder, condition: Condition): string;
  controlAt(cylinder: Cylinder, condition: Condition, tick: number): Control;
  readModel(model: Model, hooks: Hooks): Readback;
  validateModel(cylinder: Cylinder, condition: Condition, readback: Readback, initial: State): Ids;
};
type Observer = {
  canonicalEqual(left: unknown, right: unknown): boolean;
  finite(value: unknown): boolean;
  copyState(data: Data, hooks: Hooks): State;
  phaseState(state: State): unknown;
  copyWarnings(data: Data, resources: Resources, hooks: Hooks): number[][];
  captureForward(
    engine: Native,
    model: Model,
    data: Data,
    pre: State,
    ids: Ids,
    resources: Resources,
    buffer: Handle,
    limits: Limits,
    hooks: Hooks,
  ): Forward;
  captureForces(
    engine: Native,
    model: Model,
    data: Data,
    forward: Forward,
    resources: Resources,
    buffer: Handle,
    limits: Limits,
    hooks: Hooks,
  ): Force;
  assessContacts(
    cylinder: Cylinder,
    forward: Forward,
    force: Force,
    ids: Ids,
    frame: Frame,
  ): {
    bodies: {
      cylinder: {
        loaded: number;
        maxSlip: number;
        outwardForce: number;
        supported: boolean;
        downhillRim: boolean;
      };
    };
  };
  floorFrame(theta: number): Frame;
  bodyEndpoint(state: State, shape: object): Body;
  tiltState(body: Body, theta: number, omega: number, cylinder: Cylinder): Tilt;
  assessWindow(
    intervals: Interval[],
    cylinder: Cylinder,
    dtUs: number,
    target: number,
    type: 'stable',
  ): { accepted: boolean };
  effectiveTorque(
    u: number,
    theta: number,
    omegaPre: number,
    omegaPost: number,
    force: number,
    stand: Cylinder['stand'],
  ): {
    nativeForce: number;
    effective: number;
    endpointFormula: number;
    algebraBudget: number;
    saturated: boolean;
  };
};

const env = process.env;
const prefix = 'ASA_D01_BIASED_SWEEP_';
const nativeEnabled = env[prefix + 'RUN'] === 'biased-sweep-frozen-1071';
const repository = realpathSync(new URL('../../../', import.meta.url));
const maxRows = f.pair.dim * f.pair.allocatedContacts;
const dt = f.schedule.stepUs / 1_000_000;
const archiveRoot = env[prefix + 'ARCHIVE'] ?? '';
const fixedR2Raw = env[prefix + 'FIXED_R2_RAW'] ?? '';
const baseTheta = (f.model.baseDeg * Math.PI) / 180;
const absoluteDeckAngle = (hinge: number) => baseTheta + hinge;

function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function hash(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function below(root: string, child: string) {
  const rel = relative(root, child);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function localPath(root: string, file: string) {
  const actual = realpathSync(resolve(root, file));
  requireThat(below(root, actual), 'INPUT_PATH_ESCAPE ' + file);
  return actual;
}

function pinned(path: string, sha: string, cap: number, exact?: number) {
  const size = statSync(path).size;
  requireThat(
    size > 0 && size <= cap && (exact === undefined || exact === size),
    'PINNED_SIZE ' + path,
  );
  const bytes = readFileSync(path);
  requireThat(bytes.length === size && hash(bytes) === sha, 'PINNED_HASH ' + path);
  return bytes;
}

function replaceOnce(source: string, old: string, next: string) {
  requireThat(source.split(old).length === 2, 'UNIQUE_ARCHIVE_XML_FIELD ' + old);
  return source.replace(old, next);
}

function sharedXml(original: string) {
  let xml = replaceOnce(original, 'nativeccd="disable"', 'nativeccd="enable"');
  xml = replaceOnce(xml, 'name="floor"', 'name="' + f.pair.deck + '"');
  xml = replaceOnce(xml, 'geom1="floor"', 'geom1="' + f.pair.deck + '"');
  xml = replaceOnce(xml, 'name="cylinder_geom"', 'name="' + f.pair.can + '"');
  return replaceOnce(xml, 'geom2="cylinder_geom"', 'geom2="' + f.pair.can + '"');
}

function initialBias(cylinder: Cylinder) {
  const height = cylinder.bodies.cylinder.heightM / 2 + cylinder.initialGapM;
  const sine = Math.sin(baseTheta);
  const cosine = Math.cos(baseTheta);
  const quat = [Math.cos(baseTheta / 2), 0, Math.sin(baseTheta / 2), 0];
  const position: Vec = [height * sine, 0, height * cosine];
  const deckOpening = '<body name="floor_body" pos="0 0 0" quat="' + quat.join(' ') + '">';
  const canOpening =
    '<body name="cylinder" pos="' + position.join(' ') + '" quat="' + quat.join(' ') + '">';
  return { height, quat, position, deckOpening, canOpening };
}

function biasDeckXml(stage01: string, cylinder: Cylinder) {
  const { height, deckOpening, canOpening } = initialBias(cylinder);
  const deck = replaceOnce(stage01, '<body name="floor_body" pos="0 0 0">', deckOpening);
  return replaceOnce(deck, '<body name="cylinder" pos="0 0 ' + height + '">', canOpening);
}

async function readArchive() {
  requireThat(isAbsolute(archiveRoot), 'REQUIRE_ABSOLUTE_ARCHIVE');
  const root = realpathSync(archiveRoot);
  requireThat(!below(repository, root) && root !== repository, 'ARCHIVE_OUTSIDE_WORKTREE');
  const read = ([name, size, sha]: Pin) => {
    const path = localPath(root, name);
    return { url: pathToFileURL(path).href, bytes: pinned(path, sha, size, size) };
  };
  const cylinder = JSON.parse(read(f.archive.cylinder as Pin).bytes.toString('utf8')) as Cylinder;
  read(f.archive.positionRaw as Pin);
  read(f.archive.parentFixture as Pin);
  const { url: parentUrl } = read(f.archive.parent as Pin);
  const { url: harnessUrl } = read(f.archive.harness as Pin);
  const { url: observerUrl } = read(f.archive.observer as Pin);
  const yaml = pathToFileURL(createRequire(import.meta.url).resolve('yaml')).href;
  // Resolve only the frozen archive parent dependency. The readonly archive has no node_modules.
  const hook = registerHooks({
    resolve(specifier, context, next) {
      return next(
        specifier === 'yaml' && context.parentURL === parentUrl ? yaml : specifier,
        context,
      );
    },
  });
  let harness: Harness;
  try {
    harness = (await import(/* @vite-ignore */ harnessUrl)) as Harness;
  } finally {
    hook.deregister();
  }
  const observer = (await import(/* @vite-ignore */ observerUrl)) as Observer;
  const parent = (await import(/* @vite-ignore */ parentUrl)) as {
    nativeTimeBudget(tick: number, stepUs: number): number;
  };
  const condition = harness
    .cylinderPlan(cylinder, 'admission')
    .find((entry) => entry.id === f.schedule.condition);
  const rate = cylinder.tilt.rates.find((entry) => entry.id === 'normal');
  requireThat(
    condition?.dtUs === f.schedule.stepUs &&
      condition.maxSteps === f.schedule.stepsPerWorld &&
      condition.phase === 'split' &&
      condition.kind === 'tilt' &&
      condition.rate === 'normal' &&
      condition.targets === 1 &&
      cylinder.tilt.settleUs === f.schedule.settleUs &&
      cylinder.tilt.targetStepDeg === f.schedule.targetDeg &&
      cylinder.tilt.stationaryWindowUs === f.schedule.windowUs &&
      rate?.rampUs === f.schedule.transitionUs &&
      rate.holdUs === f.schedule.holdUs &&
      cylinder.solver.disableFlags === 196608 &&
      cylinder.contact.maxLoadedSlipSpeedMps === 0.001 &&
      cylinder.contact.maxCumulativeSlipM === 0.0001 &&
      cylinder.stand.forceRangeNm[0] === -32 &&
      cylinder.stand.forceRangeNm[1] === 32,
    'EXACT_ONE_STAGE_ARCHIVE_CONDITION',
  );
  const original = harness.makeCylinderXml(cylinder, condition);
  const stage01 = sharedXml(original);
  const xml = biasDeckXml(stage01, cylinder);
  requireThat(
    hash(original) === f.model.archivedXmlSha256 &&
      hash(stage01) === f.model.stage01SharedXmlSha256 &&
      Buffer.byteLength(xml) === f.model.sharedXmlBytes &&
      hash(xml) === f.model.sharedXmlSha256,
    'EXACT_BIASED_SHARED_MODEL_XML',
  );
  return {
    cylinder,
    harness,
    observer,
    condition,
    rate,
    xml,
    nativeTimeBudget: parent.nativeTimeBudget,
  };
}

function readEngine(engine: Engine, directory: string) {
  requireThat(isAbsolute(directory), 'REQUIRE_ABSOLUTE_ENGINE');
  const root = realpathSync(directory);
  for (const [name, sha] of Object.entries(f.engines[engine].files))
    pinned(localPath(root, name), sha, name === 'mujoco.wasm' ? 16_000_000 : 2_000_000);
  const module = localPath(root, 'mujoco.js');
  const moduleSha = f.engines[engine].files['mujoco.js'];
  const wasm = pinned(
    localPath(root, 'mujoco.wasm'),
    f.engines[engine].files['mujoco.wasm'],
    16_000_000,
  );
  requireThat(wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { module, moduleSha, wasm };
}

async function loadEngine({ module, moduleSha, wasm }: ReturnType<typeof readEngine>) {
  pinned(module, moduleSha, 2_000_000);
  const { default: initialize } = (await import(/* @vite-ignore */ pathToFileURL(module).href)) as {
    default(opts: { wasmBinary: Buffer; locateFile(name: string): string }): Promise<Native>;
  };
  pinned(module, moduleSha, 2_000_000);
  const native = await initialize({
    wasmBinary: wasm,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'UNEXPECTED_ENGINE_RESOURCE');
      return join(dirname(module), name);
    },
  });
  requireThat(
    native.mj_versionString() === f.version && native.mj_version() === 4000000,
    'NATIVE_VERSION',
  );
  return native;
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

function floatArray(value: unknown, width: number, label: string) {
  requireThat(
    value instanceof Float64Array && value.length === width && value.every(Number.isFinite),
    label,
  );
  return value;
}

function integerArray(value: unknown, width: number, label: string) {
  requireThat(value instanceof Int32Array && value.length === width, label);
  return value;
}

function boundedRows(data: Data) {
  const { ncon, nefc } = data;
  requireThat(
    Number.isSafeInteger(ncon) &&
      ncon >= 0 &&
      ncon <= f.pair.allocatedContacts &&
      Number.isSafeInteger(nefc) &&
      nefc >= 0 &&
      nefc <= maxRows,
    'BOUNDED_NATIVE_ROW_COUNT',
  );
  return {
    ncon,
    nefc,
    efcType: Array.from(integerArray(data['efc_type'], nefc, 'EFC_TYPE')),
    efcId: Array.from(integerArray(data['efc_id'], nefc, 'EFC_ID')),
  };
}

function orderedRows(rowIds: RowIds, contacts: Contact[]) {
  if (
    contacts.length !== rowIds.ncon ||
    rowIds.efcType.length !== rowIds.nefc ||
    rowIds.efcId.length !== rowIds.nefc
  )
    return false;
  let nextRow = 0;
  for (const [index, contact] of contacts.entries()) {
    if (contact.efc_address === -1) continue;
    if (contact.efc_address !== nextRow || contact.exclude !== 0 || contact.dim !== f.pair.dim)
      return false;
    for (let j = 0; j < f.pair.dim; j += 1) {
      if (rowIds.efcType[nextRow] !== 7 || rowIds.efcId[nextRow] !== index) return false;
      nextRow += 1;
    }
  }
  return nextRow === rowIds.nefc;
}

function solvedMatches(forward: Forward, rows: RowIds, force: Force, liveForce: number[]) {
  return (
    forward.ncon === rows.ncon &&
    forward.nefc === rows.nefc &&
    orderedRows(forward, forward.contacts) &&
    orderedRows(rows, force.contacts) &&
    forward.efcType.every((val, index) => val === rows.efcType[index]) &&
    forward.efcId.every((val, index) => val === rows.efcId[index]) &&
    force.efcForce.length === rows.nefc &&
    liveForce.length === rows.nefc &&
    force.efcForce.every((val, index) => Object.is(val, liveForce[index]))
  );
}

function pointVelocity(body: Body, p: Vec) {
  return add(body.velocity, cross(body.omega, subtract(p, body.com)));
}

function contactKinematics(ids: Ids, forward: Forward, frame: Frame, tolerance: number) {
  return forward.contacts.map((contact) => {
    const [first, second] = contact.geom;
    const a = forward.bodies[ids.geomBodies[first!]!]!;
    const b = forward.bodies[ids.geomBodies[second!]!]!;
    const deck = forward.bodies[ids.floorBody]!;
    const delta = subtract(pointVelocity(b, contact.pos), pointVelocity(a, contact.pos));
    const vDeck = pointVelocity(deck, contact.pos);
    const basis = [0, 3, 6].map((i) => contact.frame.slice(i, i + 3) as Vec);
    const local = basis.map((axis) => dot(axis, delta));
    const native =
      contact.efc_address < 0
        ? []
        : forward.efcVel.slice(contact.efc_address, contact.efc_address + 3);
    requireThat(
      native.length === 0 ||
        native.every((val, index) => Math.abs(val - local[index]!) <= tolerance),
      'RIGID_BODY_POINT_VELOCITY_PARITY',
    );
    const tangent = subtract(delta, scale(frame.normal, dot(delta, frame.normal)));
    return { vDeck, local, native, projectedSlip: Math.hypot(...tangent) };
  });
}

type MovingSignature = {
  eligible: boolean;
  matches: boolean;
  movingSpeed: number;
  loadedMoving: boolean;
};

function deriveMovingSignature(
  cylinder: Cylinder,
  frame: Frame,
  forward: Forward,
  force: Pick<Force, 'efcForce'>,
  control: Pick<Control, 'phase'>,
  hingeOmega: number,
  kinematics: ReturnType<typeof contactKinematics>,
): MovingSignature {
  const points = halfDepthWitness(forward.bodies[2]!, frame, cylinder);
  const speeds = kinematics.map((row) => Math.hypot(...row.vDeck));
  const movingSpeed = control.phase === 'RAMP' && hingeOmega > 0 ? Math.max(0, ...speeds) : 0;
  const loadedMoving =
    movingSpeed > 0 &&
    forward.contacts.some(
      ({ efc_address }, index) =>
        efc_address >= 0 && force.efcForce[efc_address]! > 0 && speeds[index]! > 0,
    );
  return {
    eligible: points.length === f.pair.candidateContacts,
    matches: dispatchSignature(points, forward.contacts, forward, frame),
    movingSpeed,
    loadedMoving,
  };
}

function verifyRetainedSignature(saved: MovingSignature, computed: MovingSignature) {
  requireThat(
    saved.eligible === computed.eligible &&
      saved.matches === computed.matches &&
      Object.is(saved.movingSpeed, computed.movingSpeed) &&
      saved.loadedMoving === computed.loadedMoving,
    'RAW_MOVING_SIGNATURE_MISMATCH',
  );
}

function unchangedForces(data: Data) {
  for (const [field, width] of [
    ['qfrc_applied', 7],
    ['xfrc_applied', 18],
    ['qfrc_passive', 7],
    ['act', 0],
  ] as const)
    requireThat(
      floatArray(data[field], width, field).every((x) => x === 0),
      'FORBIDDEN_NATIVE_FORCE ' + field,
    );
}

function validateWarnings(warnings: number[][], cylinder: Cylinder) {
  requireThat(
    warnings.length === cylinder.resources.warningCount &&
      warnings.every((warning) => warning.length === 2 && warning[0] === 0 && warning[1] === 0),
    'NATIVE_WARNING_NONZERO',
  );
}

function rawLine(value: object) {
  return Buffer.from(
    JSON.stringify(value, (_key, scalar: unknown) => {
      if (typeof scalar === 'number') {
        if (Object.is(scalar, -0)) return 'float64:-0';
        if (!Number.isFinite(scalar)) return 'float64:' + String(scalar);
      }
      return scalar;
    }) + '\n',
    'utf8',
  );
}

class Receipt {
  readonly digest = createHash('sha256');
  bytes = 0;
  rows = 0;
  private metadataBytes = 0;
  closed = false;
  private readonly fd: number;

  constructor(readonly path: string) {
    requireThat(isAbsolute(path), 'REQUIRE_ABSOLUTE_RECEIPT');
    const root = realpathSync(dirname(path));
    const temp = realpathSync(tmpdir());
    requireThat(
      below(temp, root) && !below(repository, root),
      'RECEIPT_IN_EXTERNAL_TEMP_SUBDIRECTORY',
    );
    this.fd = openSync(path, 'wx');
  }

  append(record: object, kind: 'interval' | 'metadata' | 'failure') {
    const bytes = rawLine(record);
    requireThat(!this.closed, 'CLOSED_RAW_RECEIPT');
    if (kind === 'interval') {
      requireThat(
        this.rows < f.schedule.totalIntervals && bytes.length <= f.schedule.maxRecordBytes,
        'BOUNDED_INTERVAL_JOURNAL',
      );
    }
    if (kind === 'metadata')
      requireThat(this.metadataBytes + bytes.length <= f.schedule.summaryBytes, 'BOUNDED_METADATA');
    const cap =
      kind === 'failure'
        ? f.schedule.maxJournalBytes
        : f.schedule.maxJournalBytes - f.schedule.emergencyBytes;
    requireThat(this.bytes + bytes.length <= cap, 'BOUNDED_JOURNAL');
    requireThat(writeSync(this.fd, bytes) === bytes.length, 'JOURNAL_SHORT_WRITE');
    if (kind === 'interval') this.rows += 1;
    if (kind === 'metadata') this.metadataBytes += bytes.length;
    this.bytes += bytes.length;
    this.digest.update(bytes);
  }

  checkpoint() {
    requireThat(!this.closed, 'CLOSED_RAW_RECEIPT');
    fsyncSync(this.fd);
  }

  close() {
    try {
      fsyncSync(this.fd);
    } finally {
      this.closed = true;
      closeSync(this.fd);
    }
  }
}

type Archive = Awaited<ReturnType<typeof readArchive>>;
type Runs = { step1: number; step1Returned: number; step2: number; step2Returned: number };

function checkNativeBoundary(archive: Archive, state: State, tick: number) {
  requireThat(
    Math.abs(state.time - tick * dt) <= archive.nativeTimeBudget(tick, f.schedule.stepUs),
    'NATIVE_INTEGER_CLOCK',
  );
}

function validateBiasedFactory(archive: Archive, readback: Readback, initial: State) {
  const { observer, harness, condition, cylinder } = archive;
  const { height, quat, position } = initialBias(cylinder);
  const identity = [1, 0, 0, 0];
  requireThat(
    observer.canonicalEqual(readback['body_pos'], [0, 0, 0, 0, 0, 0, ...position]) &&
      observer.canonicalEqual(readback['body_quat'], [...identity, ...quat, ...quat]) &&
      observer.canonicalEqual(initial.qpos, [0, ...position, ...quat]) &&
      observer.canonicalEqual(initial.qvel, [0, 0, 0, 0, 0, 0, 0]),
    'EXACT_AUTHORED_BIASED_FACTORY_POSES',
  );
  // The archived validator encodes the unrotated factory baseline and legacy
  // CCD flag. Check those intentional deltas above and in the live flag gate,
  // then preserve every other archived contract on a validation-only copy.
  return harness.validateModel(
    cylinder,
    condition,
    {
      ...readback,
      body_pos: [0, 0, 0, 0, 0, 0, 0, 0, height],
      body_quat: [...identity, ...identity, ...identity],
      options: { ...readback.options, disableflags: cylinder.solver.disableFlags },
    },
    { ...initial, qpos: [0, 0, 0, height, ...identity] },
  );
}

function verifyMovingDeck(data: Data, deck: Body, frame: Frame, cylinder: Cylinder) {
  const anchor = floatArray(data['xanchor'], 6, 'NATIVE_JOINT_ANCHORS');
  const axis = floatArray(data['xaxis'], 6, 'NATIVE_JOINT_AXES');
  const geo = floatArray(data['geom_xpos'], 6, 'NATIVE_WORLD_GEOM_CENTERS');
  const expectedCenter = scale(frame.normal, -cylinder.bodies.floor.halfExtentsM[2]);
  const tolerance = f.pair.frameTolerance;
  requireThat(
    anchor.subarray(0, 3).every((val) => Math.abs(val) <= tolerance) &&
      axis
        .subarray(0, 3)
        .every((val, index) => Math.abs(val - frame.positiveTipAxis[index]!) <= tolerance) &&
      geo
        .subarray(0, 3)
        .every((val, index) => Math.abs(val - expectedCenter[index]!) <= tolerance) &&
      deck.com.every((val, index) => Math.abs(val - expectedCenter[index]!) <= tolerance),
    'BIASED_DECK_WORLD_HINGE_AXIS_AND_CENTER',
  );
  return {
    hingeAnchor: Array.from(anchor.subarray(0, 3)),
    hingeAxis: Array.from(axis.subarray(0, 3)),
    geomCenter: Array.from(geo.subarray(0, 3)),
  };
}

function newResources(): Resources {
  return {
    temporaryCreated: 0,
    temporaryDeleted: 0,
    velocityCalls: 0,
    contactForceCalls: 0,
    contactVectorsCreated: 0,
    contactGetsCreated: 0,
    warningGetsCreated: 0,
  };
}

function recordStage(engine: Engine, M: Native, archive: Archive, journal: Receipt, total: Runs) {
  const { observer, harness, condition, cylinder, rate, xml } = archive;
  const resources = newResources();
  const hooks: Hooks = {
    strictDynamic: true,
    shape: { nq: 8, nv: 7, nu: 1, nbody: 3, ngeom: 2, solverSlots: 20 },
    keyframes: 0,
    warningCount: cylinder.resources.warningCount,
    invoke(_api, operation) {
      return operation();
    },
    stop() {
      // The archived observer rethrows the first error after releasing local handles.
    },
  };
  const limits = {
    maxContacts: f.pair.allocatedContacts,
    maxConstraintRows: maxRows,
    maxIslands: cylinder.resources.maxIslands,
    pairCaps: [{ geom: [0, 1], maxContacts: f.pair.allocatedContacts }],
    maxContactVectors: 2 * f.schedule.stepsPerWorld,
    maxContactGets: 2 * f.schedule.stepsPerWorld * f.pair.allocatedContacts,
  };
  const local: Runs = { step1: 0, step1Returned: 0, step2: 0, step2Returned: 0 };
  const cleanup: string[] = [];
  let model: Model | undefined;
  let data: Data | undefined;
  let buffer: (Handle & { GetView(): Float64Array }) | undefined;
  let tick = 0;
  let pending: Record<string, unknown> | undefined;
  let primary: unknown;
  let intervals = 0;
  const window: Interval[] = [];
  const physicalFailures = new Map<string, number>();
  const fail = (code: string) => {
    if (!physicalFailures.has(code)) physicalFailures.set(code, tick);
  };
  let eligibleMoving = 0;
  let matchingMoving = 0;
  let loadedMatchingMoving = 0;
  let firstMovingSignatureTick: number | null = null;
  let maxMovingSpeed = 0;
  let work = 0;
  let positiveWork = 0;
  let negativeWork = 0;
  let slip = 0;
  let peakSlip = 0;
  let lowAngle = Infinity;
  let highAngle = -Infinity;
  let settle: { accepted: boolean } | undefined;
  let hold: { accepted: boolean } | undefined;
  try {
    model = M.MjModel.from_xml_string(xml);
    requireThat(model, 'NATIVE_MODEL');
    data = new M.MjData(model);
    buffer = new M.DoubleBuffer(6);
    floatArray(buffer.GetView(), 6, 'OWNED_NATIVE_BUFFER');
    const readback = harness.readModel(model, hooks);
    const nativeFlags = readback.options['disableflags'];
    requireThat(
      nativeFlags === f.profileReadback.disableflags &&
        readback.options['enableflags'] === f.profileReadback.enableflags &&
        M.mj_id2name(model, 5, 0) === f.pair.deck &&
        M.mj_id2name(model, 5, 1) === f.pair.can &&
        M.mj_maxContact(model, 0, 1, 0) === f.pair.allocatedContacts,
      'NATIVE_PROFILE_NAMES_ALLOCATION',
    );
    const initial = observer.copyState(data, hooks);
    const ids = validateBiasedFactory(archive, readback, initial);
    requireThat(
      observer.canonicalEqual(ids, harness.worldIds(cylinder, condition)),
      'ARCHIVE_WORLD_LAYOUT',
    );
    const shape = ids.freeBodies[0]!;
    const initialWarnings = observer.copyWarnings(data, resources, hooks);
    validateWarnings(initialWarnings, cylinder);
    unchangedForces(data);
    checkNativeBoundary(archive, initial, 0);
    journal.append(
      { kind: 'world-start', engine, initial, readback, initialWarnings, ids },
      'metadata',
    );
    for (tick = 1; tick <= f.schedule.stepsPerWorld; tick += 1) {
      requireThat(
        total.step1 < f.schedule.totalIntervals && total.step2 < f.schedule.totalIntervals,
        'EXACT_DISPATCH_CAP',
      );
      const pre = observer.copyState(data, hooks);
      checkNativeBoundary(archive, pre, tick - 1);
      const control = harness.controlAt(cylinder, condition, tick - 1);
      const ctrl = floatArray(data.ctrl, 1, 'STAND_CONTROL');
      ctrl[0] = control.u;
      requireThat(
        Object.is(floatArray(data.ctrl, 1, 'STAND_CONTROL_READBACK')[0], control.u),
        'ACTUAL_STAND_CONTROL',
      );
      pending = { engine, tick, pre, control, stage: 'step1' };
      local.step1 += 1;
      total.step1 += 1;
      M.mj_step1(model, data);
      local.step1Returned += 1;
      total.step1Returned += 1;
      requireThat(
        observer.canonicalEqual(
          observer.phaseState(pre),
          observer.phaseState(observer.copyState(data, hooks)),
        ),
        'STEP1_CANNOT_ADVANCE_STATE',
      );
      const forward = observer.captureForward(
        M,
        model,
        data,
        pre,
        ids,
        resources,
        buffer,
        limits,
        hooks,
      );
      const frame = observer.floorFrame(absoluteDeckAngle(pre.qpos[0]!));
      const deck = forward.bodies[ids.floorBody]!;
      const worldDeck = verifyMovingDeck(data, deck, frame, cylinder);
      pending = { ...pending, forward, worldDeck, stage: 'step2' };
      requireThat(orderedRows(forward, forward.contacts), 'PRE_ORDERED_CONTACT_ROWS');
      local.step2 += 1;
      total.step2 += 1;
      M.mj_step2(model, data);
      local.step2Returned += 1;
      total.step2Returned += 1;
      const post = observer.copyState(data, hooks);
      pending = { ...pending, post, stage: 'solved-rows' };
      const rows = boundedRows(data);
      const retainedForce = Array.from(
        floatArray(data['efc_force'], rows.nefc, 'NATIVE_SOLVED_FORCE_WIDTH'),
      );
      pending = { ...pending, rows, retainedForce, stage: 'solved-forces' };
      const force = observer.captureForces(
        M,
        model,
        data,
        forward,
        resources,
        buffer,
        limits,
        hooks,
      );
      pending = { ...pending, rows, retainedForce, force, stage: 'solved-observation' };
      requireThat(
        solvedMatches(forward, rows, force, retainedForce),
        'SAME_NATIVE_ROWS_AND_SOLVED_FORCES',
      );
      validateWarnings(force.warnings, cylinder);
      unchangedForces(data);
      requireThat(
        observer.canonicalEqual(force.endpoint, post) &&
          force.endpoint.time > pre.time &&
          Object.is(floatArray(data.ctrl, 1, 'SOLVED_CTRL')[0], control.u),
        'NATIVE_STEP2_TIME_CONTROL',
      );
      checkNativeBoundary(archive, force.endpoint, tick);
      requireThat(
        force.solverIterations
          .slice(0, Math.max(1, force.islands))
          .every(
            (iteration) =>
              Number.isSafeInteger(iteration) &&
              iteration >= 0 &&
              iteration <= cylinder.solver.maxCombinedSolverIterationsPerIsland,
          ),
        'BOUNDED_COMBINED_SOLVER_ITERATIONS',
      );
      const thetaPre = pre.qpos[0]!;
      const omegaPre = pre.qvel[0]!;
      const thetaPost = force.endpoint.qpos[0]!;
      const omegaPost = force.endpoint.qvel[0]!;
      requireThat(
        deck.rotation.every(
          (value, i) => Math.abs(value - frame.rotation[i]!) <= f.pair.frameTolerance,
        ),
        'NATIVE_MOVING_DECK_FRAME',
      );
      const kinematics = contactKinematics(
        ids,
        forward,
        frame,
        cylinder.contact.velocityReconstructionToleranceMps,
      );
      const support = observer.assessContacts(cylinder, forward, force, ids, frame).bodies.cylinder;
      const torque = observer.effectiveTorque(
        control.u,
        thetaPre,
        omegaPre,
        omegaPost,
        force.actuatorForce[0]!,
        cylinder.stand,
      );
      const allowance = cylinder.stand.forceCapArithmeticAllowanceNm;
      const maxTorque = cylinder.stand.forceRangeNm[1]!;
      requireThat(
        observer.finite(torque) &&
          Math.abs(torque.nativeForce) <= maxTorque + allowance &&
          Math.abs(torque.effective) <= maxTorque + allowance,
        'STAND_NATIVE_AND_EFFECTIVE_FORCE_BOUND',
      );
      requireThat(
        Math.abs(torque.nativeForce - force.qfrcActuator[0]!) <= allowance &&
          force.qfrcActuator.slice(1).every((x) => x === 0) &&
          Math.abs(torque.effective - torque.endpointFormula) <= torque.algebraBudget,
        'STAND_ACTUATOR_MAPPING_AND_ALGEBRA',
      );
      const signedWork = dt * torque.effective * ((omegaPre + omegaPost) / 2);
      work += signedWork;
      positiveWork += Math.max(signedWork, 0);
      negativeWork += Math.min(signedWork, 0);
      const before = observer.tiltState(
        observer.bodyEndpoint(pre, shape),
        absoluteDeckAngle(thetaPre),
        omegaPre,
        cylinder,
      );
      const after = observer.tiltState(
        observer.bodyEndpoint(force.endpoint, shape),
        absoluteDeckAngle(thetaPost),
        omegaPost,
        cylinder,
      );
      const physical: Interval = {
        tick,
        pre: before,
        post: after,
        loaded: support.loaded > 0,
        positiveSupport: support.outwardForce > 0,
        supported: support.supported,
        downhillRim: support.downhillRim,
        noSlip: support.maxSlip <= cylinder.contact.maxLoadedSlipSpeedMps,
      };
      window.push(physical);
      if (window.length > f.schedule.windowIntervals) window.shift();
      const signature = deriveMovingSignature(
        cylinder,
        frame,
        forward,
        force,
        control,
        omegaPre,
        kinematics,
      );
      if (signature.movingSpeed > 0) {
        maxMovingSpeed = Math.max(maxMovingSpeed, signature.movingSpeed);
        if (signature.eligible) eligibleMoving += 1;
        if (signature.matches) {
          matchingMoving += 1;
          if (signature.loadedMoving) {
            loadedMatchingMoving += 1;
            firstMovingSignatureTick ??= tick;
          }
        }
      }
      if (tick * f.schedule.stepUs === f.schedule.settleUs) {
        settle = observer.assessWindow(window, cylinder, f.schedule.stepUs, baseTheta, 'stable');
        if (!settle.accepted) fail('INDETERMINATE_INITIAL_SETTLE_NOT_STABLE');
        const priorAngles = window.flatMap((record) => [record.pre.theta, record.post.theta]);
        lowAngle = Math.min(...priorAngles);
        highAngle = Math.max(...priorAngles);
      }
      if (control.stage === 1) {
        const next = harness.controlAt(cylinder, condition, tick);
        const radians = Math.PI / 180;
        lowAngle = Math.min(lowAngle, before.theta, after.theta);
        highAngle = Math.max(highAngle, before.theta, after.theta);
        if (
          Math.max(Math.abs(thetaPre - control.u), Math.abs(thetaPost - next.u)) >
          cylinder.tilt.maxPreTipTrackingDeg * radians
        )
          fail('STAND_PRETIP_TRACKING');
        if (Math.max(Math.abs(omegaPre), Math.abs(omegaPost)) > rate.maxActualSpeedRadps)
          fail('STAND_PRETIP_SPEED');
        if (highAngle - lowAngle > cylinder.tilt.maxStageSpanDeg * radians)
          fail('STAND_STAGE_ANGLE_SPAN');
        if (!before.uphillDirectionValid || !after.uphillDirectionValid)
          fail('UNKNOWN_DEGENERATE_UPHILL_RIM_DIRECTION');
        if (!physical.loaded || !physical.positiveSupport)
          fail('UNKNOWN_MISSING_LOADED_OUTWARD_SUPPORT');
        if (!physical.supported) fail('UNKNOWN_SUPPORT_WITNESS_DOMAIN');
        peakSlip = Math.max(peakSlip, support.maxSlip);
        slip += dt * support.maxSlip;
        if (!physical.noSlip || slip > cylinder.contact.maxCumulativeSlipM) fail('NO_SLIP_GATE');
      }
      if (tick === f.schedule.stepsPerWorld) {
        hold = observer.assessWindow(
          window,
          cylinder,
          f.schedule.stepUs,
          absoluteDeckAngle(cylinder.tilt.targetStepRad),
          'stable',
        );
        if (!hold.accepted) fail('INDETERMINATE_STAGE_END_NO_STABLE');
      }
      journal.append(
        {
          kind: 'interval',
          ...pending,
          kinematics,
          support,
          torque,
          signedWork,
          work,
          physical,
          slip,
          signature,
        },
        'interval',
      );
      intervals += 1;
      pending = undefined;
    }
    requireThat(
      local.step1Returned === f.schedule.stepsPerWorld &&
        local.step2Returned === f.schedule.stepsPerWorld &&
        intervals === f.schedule.stepsPerWorld &&
        resources.velocityCalls === 3 * intervals &&
        resources.contactForceCalls <= f.pair.allocatedContacts * intervals &&
        resources.temporaryCreated === resources.temporaryDeleted,
      'COMPLETE_NATIVE_CENSUS',
    );
  } catch (error) {
    primary = error;
  } finally {
    for (const [name, owned] of [
      ['buffer', buffer],
      ['data', data],
      ['model', model],
    ] as const) {
      if (!owned) continue;
      try {
        owned.delete();
      } catch (error) {
        cleanup.push(name + ': ' + String(error));
      }
    }
  }
  const runtime = primary || cleanup.length ? 'UNRESOLVED' : 'COMPLETE';
  const summary = {
    kind: 'world-end',
    engine,
    runtime,
    physical: runtime === 'UNRESOLVED' ? 'UNRESOLVED' : physicalFailures.size ? 'FAIL' : 'PASS',
    failures: Array.from(physicalFailures),
    resources,
    cleanup,
    local,
    intervals,
    settle,
    hold,
    slip,
    peakSlip,
    stageSpan: Number.isFinite(highAngle - lowAngle) ? highAngle - lowAngle : null,
    work,
    positiveWork,
    negativeWork,
    eligibleMoving,
    matchingMoving,
    loadedMatchingMoving,
    firstMovingSignatureTick,
    maxMovingSpeed,
  };
  journal.append(summary, runtime === 'COMPLETE' ? 'metadata' : 'failure');
  if (runtime === 'UNRESOLVED') {
    journal.append(
      { kind: 'first-error', engine, tick, pending, error: String(primary ?? cleanup[0]) },
      'failure',
    );
    throw new Error('BIASED_SWEEP_NATIVE_UNRESOLVED', { cause: primary ?? cleanup[0] });
  }
  return summary;
}

type MovingOpportunity = {
  tick: number;
  eligible: boolean;
  matches: boolean;
  loadedMoving: boolean;
};

function compareMovingSignatures(candidate: MovingOpportunity[], stock: MovingOpportunity[]) {
  const candidateLoaded = candidate.filter(
    (item) => item.eligible && item.matches && item.loadedMoving,
  );
  const stockEligible = stock.filter((item) => item.eligible);
  const stockLoaded = stockEligible.filter((item) => item.loadedMoving);
  const stockLoadedTicks = new Set(stockLoaded.map((item) => item.tick));
  const sharedTicks = candidateLoaded
    .filter((item) => stockLoadedTicks.has(item.tick))
    .map((item) => item.tick);
  const stockLoadedMatches = stockLoaded.filter((item) => item.matches).length;
  const evidence = {
    candidateLoadedMatches: candidateLoaded.length,
    stockEligibleMoving: stockEligible.length,
    stockLoadedMatches,
    sharedLoadedOpportunityTicks: sharedTicks.length,
    firstSharedLoadedOpportunityTick: sharedTicks[0] ?? null,
  };
  if (!candidateLoaded.length) return { attribution: 'UNEXERCISED', ...evidence };
  if (stockLoadedMatches) return { attribution: 'NOT_DISTINGUISHED', ...evidence };
  if (!stockEligible.length)
    return { attribution: 'INCONCLUSIVE', reason: 'NO_ELIGIBLE_MOVING_STOCK_POSE', ...evidence };
  if (!sharedTicks.length)
    return {
      attribution: 'INCONCLUSIVE',
      reason: 'NO_SAME_TICK_LOADED_STOCK_OPPORTUNITY',
      ...evidence,
    };
  return { attribution: 'CANDIDATE_DISTINGUISHED', ...evidence };
}

type RetainedInterval = {
  engine: Engine;
  tick: number;
  pre: State;
  control: Control;
  forward: Forward;
  rows: RowIds;
  retainedForce: number[];
  force: Force;
  signature: MovingSignature;
  signedWork: number;
  work: number;
  slip: number;
};

async function replayRecordedIntervals(journal: Receipt, archive: Archive) {
  journal.checkpoint();
  const source = createReadStream(journal.path, { encoding: 'utf8' });
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  const digest = createHash('sha256');
  const { observer, harness, cylinder, condition } = archive;
  const ids = harness.worldIds(cylinder, condition);
  const moving: Record<Engine, MovingOpportunity[]> = { candidate: [], stock: [] };
  let count = 0;
  let work = 0;
  let slip = 0;
  let endpoint: State | undefined;
  try {
    for await (const line of lines) {
      digest.update(line + '\n', 'utf8');
      const record = JSON.parse(line, (_key, value: unknown) =>
        value === 'float64:-0' ? -0 : value,
      ) as object;
      if (!('kind' in record) || record.kind !== 'interval') continue;
      const item = record as RetainedInterval & { kind: string };
      const index = count % f.schedule.stepsPerWorld;
      requireThat(
        item.engine === f.schedule.order[Math.floor(count / f.schedule.stepsPerWorld)] &&
          item.tick === index + 1,
        'RAW_INTERVAL_SEQUENCE',
      );
      if (index === 0) {
        endpoint = undefined;
        work = 0;
        slip = 0;
      }
      if (endpoint)
        requireThat(
          observer.canonicalEqual(observer.phaseState(endpoint), observer.phaseState(item.pre)),
          'RAW_CONTINUOUS_NATIVE_STATE',
        );
      const wantControl = harness.controlAt(cylinder, condition, index);
      requireThat(observer.canonicalEqual(item.control, wantControl), 'RAW_INTEGER_CONTROL');
      checkNativeBoundary(archive, item.pre, index);
      endpoint = item.force.endpoint;
      checkNativeBoundary(archive, endpoint, index + 1);
      requireThat(
        solvedMatches(item.forward, item.rows, item.force, item.retainedForce),
        'RAW_SOLVED_ROW_WITNESS',
      );
      const theta = item.pre.qpos[0]!;
      const omega0 = item.pre.qvel[0]!;
      const omega1 = endpoint.qvel[0]!;
      const frame = observer.floorFrame(absoluteDeckAngle(theta));
      const kinematics = contactKinematics(
        ids,
        item.forward,
        frame,
        cylinder.contact.velocityReconstructionToleranceMps,
      );
      const support = observer.assessContacts(cylinder, item.forward, item.force, ids, frame).bodies
        .cylinder;
      if (wantControl.stage === 1) slip += dt * support.maxSlip;
      const torque = observer.effectiveTorque(
        wantControl.u,
        theta,
        omega0,
        omega1,
        item.force.actuatorForce[0]!,
        cylinder.stand,
      );
      const intervalWork = dt * torque.effective * ((omega0 + omega1) / 2);
      work += intervalWork;
      requireThat(
        Object.is(item.signedWork, intervalWork) &&
          Object.is(item.work, work) &&
          Object.is(item.slip, slip),
        'RAW_WORK_AND_SLIP_INTEGRALS',
      );
      const signature = deriveMovingSignature(
        cylinder,
        frame,
        item.forward,
        item.force,
        wantControl,
        omega0,
        kinematics,
      );
      verifyRetainedSignature(item.signature, signature);
      if (signature.movingSpeed > 0) moving[item.engine].push({ ...signature, tick: item.tick });
      count += 1;
    }
  } finally {
    lines.close();
    source.destroy();
  }
  requireThat(
    count === journal.rows &&
      count === f.schedule.totalIntervals &&
      digest.digest('hex') === journal.digest.copy().digest('hex'),
    'EXACT_SAVED_SEQUENCE_AND_DIGEST',
  );
  return { count, comparison: compareMovingSignatures(moving.candidate, moving.stock) };
}

const fixedWorlds = ['candidate:28', 'candidate:32', 'stock:28', 'stock:32'] as const;
type FixedWorld = (typeof fixedWorlds)[number];
type FixedObservation = Omit<Forward, 'bodies' | 'contacts'> & {
  preBodies: Record<number, Body>;
  contacts: SolvedContact[];
  efcForce: number[];
};
type FixedInterval = {
  world: FixedWorld;
  tick: number;
  pre: State;
  observation: FixedObservation;
  attribution: { eligible: boolean; geometricSignature: boolean; loadedSignature: boolean };
};
type FixedRecord =
  | ({ kind: 'native-interval' } & FixedInterval)
  | {
      kind: 'acquisition-start';
      sourcePin: string;
      fixturePin: string;
      models: { scenario: { angle: number }; xml: string }[];
    }
  | { kind: 'world-start'; world: FixedWorld; xmlSha256: string }
  | { kind: 'world-outcome'; world: FixedWorld; verdict: string }
  | { kind: 'acquisition-end'; runtime: string; physical: string };

function fixedTickEvidence(record: FixedInterval, archive: Archive, frame: Frame) {
  const { observation: observed, attribution } = record;
  const forward: Forward = { ...observed, bodies: observed.preBodies };
  requireThat(
    orderedRows(forward, observed.contacts) &&
      observed.efcForce.length === observed.nefc &&
      observed.efcForce.every(Number.isFinite) &&
      observed.contacts.every(
        ({ efc_address: row, force }) =>
          force.length === 6 &&
          force.every(Number.isFinite) &&
          force[0]! >= 0 &&
          (row < 0
            ? force[0] === 0
            : force.slice(0, f.pair.dim).every((x, j) => Object.is(x, observed.efcForce[row + j]))),
      ),
    'FIXED_R2_RETAINED_CONTACT_CENSUS',
  );
  const body = forward.bodies[1];
  requireThat(body && archive.observer.finite(body), 'FIXED_R2_RETAINED_CAN_PRE');
  const points = halfDepthWitness(body, frame, archive.cylinder);
  const eligible = points.length === f.pair.candidateContacts;
  const matches = dispatchSignature(points, observed.contacts, forward, frame);
  const loaded = observed.contacts.some((contact) => contact.force[0]! > 0);
  requireThat(
    eligible === attribution.eligible &&
      matches === attribution.geometricSignature &&
      (matches && loaded) === attribution.loadedSignature,
    'FIXED_R2_NATIVE_SIGNATURE_RECONSTRUCTION',
  );
  return { tick: record.tick, eligible, matches, loaded };
}

async function readFixedR2(archive: Archive) {
  requireThat(isAbsolute(fixedR2Raw), 'REQUIRE_ABSOLUTE_FIXED_R2_RAW');
  const location = realpathSync(fixedR2Raw);
  const info = statSync(location);
  requireThat(
    !below(repository, location) && info.isFile() && info.size === f.fixedR2.rawBytes,
    'FIXED_R2_RECEIPT_PATH_AND_SIZE',
  );
  const stream = createReadStream(location, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const digest = createHash('sha256');
  const frame = archive.observer.floorFrame(baseTheta);
  const counts: Record<FixedWorld, number> = {
    'candidate:28': 0,
    'candidate:32': 0,
    'stock:28': 0,
    'stock:32': 0,
  };
  const fixed28: Record<'candidate:28' | 'stock:28', ReturnType<typeof fixedTickEvidence>[]> = {
    'candidate:28': [],
    'stock:28': [],
  };
  const worldStarts: FixedWorld[] = [];
  const worldEnds: FixedWorld[] = [];
  let starts = 0;
  let ends = 0;
  try {
    for await (const line of lines) {
      requireThat(Buffer.byteLength(line) < f.schedule.maxRecordBytes, 'BOUNDED_FIXED_R2_LINE');
      digest.update(line + '\n', 'utf8');
      const record = JSON.parse(line, (_key, value: unknown) =>
        value && typeof value === 'object' && '$float64' in value && value.$float64 === '-0'
          ? -0
          : value,
      ) as FixedRecord;
      switch (record.kind) {
        case 'acquisition-start': {
          starts += 1;
          const { canOpening } = initialBias(archive.cylinder);
          const model = record.models.find((entry) => entry.scenario.angle === f.model.baseDeg);
          requireThat(
            record.sourcePin === f.fixedR2.sourceSha256 &&
              record.fixturePin === f.fixedR2.fixtureSha256 &&
              model &&
              hash(model.xml) === f.fixedR2.xml28Sha256 &&
              model.xml.split(canOpening).length === 2,
            'FIXED_R2_FROZEN_HEADER_AND_MODEL',
          );
          break;
        }
        case 'world-start':
          worldStarts.push(record.world);
          if (record.world.endsWith(':28'))
            requireThat(
              record.xmlSha256 === f.fixedR2.xml28Sha256,
              'FIXED_R2_IDENTICAL_28_DEGREE_MODELS',
            );
          break;
        case 'world-outcome':
          worldEnds.push(record.world);
          if (record.world === 'candidate:28' || record.world === 'stock:28') {
            const engine = record.world === 'candidate:28' ? 'candidate' : 'stock';
            requireThat(
              record.verdict === f.fixedR2.physical[engine],
              'FIXED_R2_HISTORICAL_PHYSICAL_VERDICT',
            );
          }
          break;
        case 'native-interval':
          requireThat(
            fixedWorlds.includes(record.world) &&
              record.tick === counts[record.world] + 1 &&
              record.tick <= f.fixedR2.intervalsPerWorld,
            'FIXED_R2_COMPLETE_INTERVAL_ORDINALS',
          );
          counts[record.world] += 1;
          if (record.world === 'candidate:28' || record.world === 'stock:28') {
            checkNativeBoundary(archive, record.pre, record.tick - 1);
            fixed28[record.world].push(fixedTickEvidence(record, archive, frame));
          }
          break;
        case 'acquisition-end':
          ends += 1;
          requireThat(
            record.runtime === 'COMPLETE' && record.physical === 'FAIL',
            'FIXED_R2_PRESERVED_TERMINAL_VERDICT',
          );
          break;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  requireThat(
    starts === 1 &&
      ends === 1 &&
      archive.observer.canonicalEqual(worldStarts, fixedWorlds) &&
      archive.observer.canonicalEqual(worldEnds, fixedWorlds) &&
      Object.values(counts).every((count) => count === f.fixedR2.intervalsPerWorld) &&
      Object.values(counts).reduce((sum, count) => sum + count, 0) === f.fixedR2.totalIntervals &&
      digest.digest('hex') === f.fixedR2.rawSha256,
    'EXACT_COMPLETE_FIXED_R2_ARCHIVE',
  );
  const stock = new Map(fixed28['stock:28'].map((item) => [item.tick, item]));
  const paired = fixed28['candidate:28'].filter((item) => {
    const other = stock.get(item.tick);
    return item.eligible && item.loaded && other?.eligible && other.loaded;
  });
  const first = paired.at(0)?.tick;
  const last = paired.at(-1)?.tick;
  const candidateLoadedMatching = paired.filter((item) => item.matches).length;
  const stockLoadedMatching = paired.filter((item) => stock.get(item.tick)?.matches).length;
  requireThat(
    first === f.fixedR2.firstSharedTick &&
      last === f.fixedR2.lastSharedTick &&
      (first - 1) * f.schedule.stepUs === f.fixedR2.firstPreUs &&
      paired.every((item, index) => item.tick === first + index) &&
      paired.length === f.fixedR2.sharedLoadedEligible &&
      candidateLoadedMatching === f.fixedR2.candidateLoadedMatching &&
      stockLoadedMatching === f.fixedR2.stockLoadedMatching,
    'EXACT_FIXED_R2_SAME_TICK_LOADED_ELIGIBLE_OPPORTUNITIES',
  );
  return {
    first,
    last,
    sharedLoadedEligible: paired.length,
    candidateLoadedMatching,
    stockLoadedMatching,
  };
}

function verifyPositionAdmission() {
  const files = {
    'tools/robotics-field-core/mujoco-finite-cap-v1.patch': f.positionAdmission.patch,
    'tests/robotics/field-core-qualification/mujoco-finite-cap-admission.fixture.json':
      f.positionAdmission.fixture,
    'tests/robotics/field-core-qualification/mujoco-finite-cap-admission.spec.ts':
      f.positionAdmission.source,
  };
  for (const [file, sha] of Object.entries(files))
    pinned(localPath(repository, file), sha, 2_000_000);
}

function verifySourceSeal() {
  for (const [key, extension] of [
    ['SOURCE_SHA256', 'spec.ts'],
    ['FIXTURE_SHA256', 'fixture.json'],
  ] as const) {
    const expected = env[prefix + key] ?? '';
    requireThat(/^[0-9a-f]{64}$/.test(expected), 'REQUIRE_EXACT_FROZEN_PIN ' + key);
    pinned(
      fileURLToPath(new URL('./mujoco-finite-cap-biased-sweep.' + extension, import.meta.url)),
      expected,
      2_000_000,
    );
  }
}

it('requires a loaded, geometrically eligible stock opportunity at the same moving tick', () => {
  const candidate = [{ tick: 4251, eligible: true, matches: true, loadedMoving: true }];
  const stock = { tick: 4251, eligible: true, matches: false, loadedMoving: true };
  expect(compareMovingSignatures(candidate, [])).toMatchObject({
    attribution: 'INCONCLUSIVE',
    reason: 'NO_ELIGIBLE_MOVING_STOCK_POSE',
  });
  expect(compareMovingSignatures(candidate, [{ ...stock, loadedMoving: false }])).toMatchObject({
    attribution: 'INCONCLUSIVE',
    reason: 'NO_SAME_TICK_LOADED_STOCK_OPPORTUNITY',
  });
  expect(compareMovingSignatures(candidate, [{ ...stock, tick: 4252 }])).toMatchObject({
    attribution: 'INCONCLUSIVE',
    reason: 'NO_SAME_TICK_LOADED_STOCK_OPPORTUNITY',
  });
  expect(compareMovingSignatures(candidate, [stock])).toMatchObject({
    attribution: 'CANDIDATE_DISTINGUISHED',
    firstSharedLoadedOpportunityTick: 4251,
  });
  expect(compareMovingSignatures(candidate, [{ ...stock, matches: true }]).attribution).toBe(
    'NOT_DISTINGUISHED',
  );
  expect(compareMovingSignatures([], [stock]).attribution).toBe('UNEXERCISED');
});

it('binds the accepted position files and the exclusive biased-sweep evidence budgets', () => {
  verifyPositionAdmission();
  expect(f.schedule.order).toEqual(['candidate', 'stock']);
  expect(f.schedule.settleUs + f.schedule.transitionUs + f.schedule.holdUs).toBe(
    f.schedule.horizonUs,
  );
  expect(f.schedule.horizonUs / f.schedule.stepUs).toBe(f.schedule.stepsPerWorld);
  expect(f.schedule.windowUs / f.schedule.stepUs).toBe(f.schedule.windowIntervals);
  expect(f.schedule.totalIntervals).toBe(f.schedule.stepsPerWorld * f.schedule.order.length);
  expect(
    f.schedule.totalIntervals * f.schedule.maxRecordBytes +
      f.schedule.emergencyBytes +
      f.schedule.summaryBytes,
  ).toBe(f.schedule.worstCaseReceiptBytes);
  expect(f.schedule.worstCaseReceiptBytes).toBeLessThan(f.schedule.maxJournalBytes);
  expect(rawLine({ negativeZero: -0, nonfinite: Infinity }).toString('utf8')).toContain(
    '"negativeZero":"float64:-0"',
  );
});

it('rejects an orphan or moved row and measures a shared point on a moving deck', () => {
  const contact: Contact = {
    geom: [0, 1],
    pos: [0.03, 0, 0],
    frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
    exclude: 0,
    dist: -0.00001,
    dim: 3,
    efc_address: 0,
  };
  const deck: Body = {
    com: [0, 0, -0.025],
    velocity: [-0.001, 0, 0],
    omega: [0, 0.04, 0],
    rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };
  const can: Body = {
    ...deck,
    com: [0.03, 0, 0.0575],
    velocity: [0, 0, -0.0012],
    omega: [0, 0, 0],
  };
  const ids: Ids = {
    bodyIds: [0, 1, 2],
    geomBodies: [1, 2],
    floorGeom: 0,
    floorBody: 1,
    freeBodies: [],
  };
  const forward: Forward = {
    ncon: 1,
    nefc: 3,
    efcType: [7, 7, 7],
    efcId: [0, 0, 0],
    efcVel: [0, 0, 0],
    contacts: [contact],
    bodies: { 1: deck, 2: can },
  };
  const frame: Frame = {
    rotation: deck.rotation,
    downhill: [1, 0, 0],
    normal: [0, 0, 1],
    positiveTipAxis: [0, 1, 0],
  };
  expect(orderedRows(forward, forward.contacts)).toBe(true);
  expect(orderedRows({ ...forward, efcId: [0, 0, 1] }, forward.contacts)).toBe(false);
  expect(
    orderedRows(
      { ...forward, nefc: 4, efcId: [0, 0, 0, 0], efcType: [7, 7, 7, 7] },
      forward.contacts,
    ),
  ).toBe(false);
  expect(orderedRows(forward, [{ ...contact, efc_address: 1 }])).toBe(false);
  const reconstructed = contactKinematics(ids, forward, frame, 1e-9)[0]!;
  expect(reconstructed.vDeck[2]).toBeCloseTo(-0.0012, 15);
  expect(reconstructed.projectedSlip).toBeCloseTo(0, 15);
  expect(() => contactKinematics(ids, { ...forward, efcVel: [0.0012, 0, 0] }, frame, 1e-9)).toThrow(
    'RIGID_BODY_POINT_VELOCITY_PARITY',
  );
});

it.runIf(Boolean(archiveRoot))(
  'binds the immutable archived servo, exact XML projection, and integer-time control',
  async () => {
    const { condition, cylinder, harness, observer, xml } = await readArchive();
    expect(hash(xml)).toBe(f.model.sharedXmlSha256);
    expect(initialBias(cylinder).position).toEqual([0.027041562016467312, 0, 0.0508577813486742]);
    expect(baseTheta).toBe(0.4886921905584123);
    expect(absoluteDeckAngle(cylinder.tilt.targetStepRad)).toBe(0.4928809807631987);
    const u = (tick: number) => harness.controlAt(cylinder, condition, tick);
    expect(u(3999)).toMatchObject({ phase: 'SETTLING', u: 0 });
    expect(u(4000)).toMatchObject({ phase: 'RAMP', stage: 1, u: 0 });
    expect(u(4250).u).toBeCloseTo(cylinder.tilt.targetStepRad / 2, 15);
    expect(u(4500)).toMatchObject({ phase: 'HOLD', u: cylinder.tilt.targetStepRad });
    expect(u(6499)).toMatchObject({ phase: 'HOLD', stage: 1, stageEndUs: f.schedule.horizonUs });
    const frame = observer.floorFrame(0.05);
    const body: Body = {
      com: scale([Math.sin(0.1), 0, Math.cos(0.1)], cylinder.bodies.cylinder.heightM / 2),
      rotation: observer.floorFrame(0.1).rotation,
      velocity: [0, 0, 0],
      omega: [0, 0, 0],
    };
    const witnesses = halfDepthWitness(body, frame, cylinder);
    expect(witnesses).toHaveLength(3);
    const forward: Forward = {
      ncon: 0,
      nefc: 0,
      efcType: [],
      efcId: [],
      efcVel: [],
      contacts: [],
      bodies: { 2: body },
    };
    const signature = deriveMovingSignature(
      cylinder,
      frame,
      forward,
      { efcForce: [] },
      { phase: 'RAMP' },
      0.01,
      [],
    );
    expect(signature).toEqual({
      eligible: true,
      matches: false,
      movingSpeed: 0,
      loadedMoving: false,
    });
    expect(() => verifyRetainedSignature(signature, signature)).not.toThrow();
    expect(() =>
      verifyRetainedSignature(
        { ...signature, movingSpeed: 0.001, loadedMoving: true, matches: true },
        signature,
      ),
    ).toThrow('RAW_MOVING_SIGNATURE_MISMATCH');
    expect(witnesses[1]!.dist).toBeCloseTo(witnesses[0]!.dist / 2, 15);
    expect(witnesses[2]!.dist).toBeCloseTo(witnesses[0]!.dist / 2, 15);
    expect(
      halfDepthWitness(
        { ...body, com: add(body.com, scale(frame.downhill, 0.49)) },
        frame,
        cylinder,
      ),
    ).toEqual([]);
  },
);

it.runIf(Boolean(env[prefix + 'CANDIDATE'] && env[prefix + 'STOCK']))(
  'checks both exact engine artifacts without loading them',
  () => {
    expect(readEngine('candidate', env[prefix + 'CANDIDATE']!).wasm.length).toBeGreaterThan(0);
    expect(readEngine('stock', env[prefix + 'STOCK']!).wasm.length).toBeGreaterThan(0);
  },
);

it.runIf(Boolean(archiveRoot && fixedR2Raw))(
  'recomputes the sealed fixed 28-degree comparison from 8000 PRE and solved frames',
  async () => {
    const archive = await readArchive();
    expect(await readFixedR2(archive)).toEqual({
      first: 41,
      last: 4000,
      sharedLoadedEligible: 3960,
      candidateLoadedMatching: 3960,
      stockLoadedMatching: 0,
    });
  },
  30000,
);

type PairPhysical = {
  physical: string;
  candidatePhysical: string;
  stockPhysical: string;
  candidateFailures: [string, number][];
  stockFailures: [string, number][];
};

function pairPhysical(
  candidate: ReturnType<typeof recordStage>,
  stock: ReturnType<typeof recordStage>,
): PairPhysical {
  return {
    physical: candidate.physical === 'PASS' && stock.physical === 'PASS' ? 'PASS' : 'FAIL',
    candidatePhysical: candidate.physical,
    stockPhysical: stock.physical,
    candidateFailures: candidate.failures,
    stockFailures: stock.failures,
  };
}

it.runIf(nativeEnabled)(
  'records the paired native servo sweep from 28.00 to 28.24 degrees',
  async () => {
    verifySourceSeal();
    verifyPositionAdmission();
    const archive = await readArchive();
    const fixedComparison = await readFixedR2(archive);
    const artifacts = {
      candidate: readEngine('candidate', env[prefix + 'CANDIDATE'] ?? ''),
      stock: readEngine('stock', env[prefix + 'STOCK'] ?? ''),
    };
    const journal = new Receipt(env[prefix + 'RECEIPT'] ?? '');
    const total: Runs = { step1: 0, step1Returned: 0, step2: 0, step2Returned: 0 };
    let result: (PairPhysical & ReturnType<typeof compareMovingSignatures>) | undefined;
    try {
      journal.append(
        {
          kind: 'header',
          fixture: f,
          xml: archive.xml,
          fixedComparison,
          sourceSha256: env[prefix + 'SOURCE_SHA256'],
          fixtureSha256: env[prefix + 'FIXTURE_SHA256'],
        },
        'metadata',
      );
      const candidate = recordStage(
        'candidate',
        await loadEngine(artifacts.candidate),
        archive,
        journal,
        total,
      );
      const stock = recordStage(
        'stock',
        await loadEngine(artifacts.stock),
        archive,
        journal,
        total,
      );
      requireThat(
        total.step1 === f.schedule.totalIntervals &&
          total.step2 === f.schedule.totalIntervals &&
          total.step1Returned === f.schedule.totalIntervals &&
          total.step2Returned === f.schedule.totalIntervals &&
          journal.rows === f.schedule.totalIntervals,
        'PAIRED_HORIZON_AND_ACQUISITION_COUNTS',
      );
      const replayed = await replayRecordedIntervals(journal, archive);
      result = {
        ...pairPhysical(candidate, stock),
        ...replayed.comparison,
      };
      journal.append(
        {
          kind: 'pair-end',
          runtime: 'COMPLETE',
          ...result,
          total,
          candidate,
          stock,
          replayed: replayed.count,
        },
        'metadata',
      );
    } catch (error) {
      journal.append(
        { kind: 'terminal-error', runtime: 'UNRESOLVED', total, error: String(error) },
        'failure',
      );
      throw error;
    } finally {
      journal.close();
      process.stdout.write(
        JSON.stringify({
          biasedSweepReceipt: {
            bytes: journal.bytes,
            intervals: journal.rows,
            sha256: journal.digest.digest('hex'),
            ...result,
          },
        }) + '\n',
      );
    }
    expect(
      result?.candidatePhysical,
      'candidate physical stage result is retained in the raw journal',
    ).toBe('PASS');
    expect(result?.attribution, 'moving half-depth attribution is independently retained').toBe(
      'CANDIDATE_DISTINGUISHED',
    );
  },
  f.schedule.timeoutMs,
);
