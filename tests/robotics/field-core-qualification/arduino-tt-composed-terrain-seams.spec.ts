import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  lstatSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { advanceClockedArduinoRuntime } from '../../../contexts/electronics/domain/arduino-program-runtime.js';
import { BRUSHED_MOTOR_ASSEMBLY_PROFILES } from '../../../contexts/electronics/domain/models/brushed-motor-profiles.js';
import type { ComponentResult } from '../../../contexts/electronics/domain/solver.js';
import {
  createElectronicsTtNativeDriveTestSession,
  parseElectronicsEngineDocument,
} from '../../../contexts/electronics/engine.js';
import { createInitialRoboticsProject } from '../../../contexts/robotics/domain/default-project.js';
import f from './arduino-tt-composed-terrain-seams.fixture.json';
import { createEditableRampGeometry, rampRiseForAngle } from './editable-ramp-geometry.js';

type World = 'powered' | 'control';
type Vec = [number, number, number];
type Quat = [number, number, number, number];
type Pose = { p: Vec; q: Quat };
type State = { seconds: number; qpos: number[]; qvel: number[] };
type Session = ReturnType<typeof createElectronicsTtNativeDriveTestSession>;
type Query = Extract<NonNullable<ReturnType<Session['step']>>, { kind: 'shaft-interval' }>;
type Handle = { delete(): void };
type BufferView = Handle & { GetView(): Float64Array };
type Vector<T> = { size(): number; get(n: number): T | undefined };
type OwnedVector<T> = Handle & Vector<T>;
type NativeContact = Handle & {
  geom: Int32Array;
  dim: number;
  exclude: number;
  efc_address: number;
  dist: number;
  pos: Float64Array;
  frame: Float64Array;
  friction: Float64Array;
  surfacevel: Float64Array;
  adhesion: number;
};
type Model = Handle &
  Record<string, unknown> & {
    opt: Record<string, unknown> & { timestep: number };
    nq: number;
    nv: number;
    nbody: number;
    ngeom: number;
  };
type Data = Handle & {
  qpos: Float64Array;
  qvel: Float64Array;
  qfrc_applied: Float64Array;
  xfrc_applied: Float64Array;
  ctrl: Float64Array;
  xpos: Float64Array;
  xquat: Float64Array;
  xipos: Float64Array;
  ximat: Float64Array;
  geom_xpos: Float64Array;
  geom_xmat: Float64Array;
  efc_type: Int32Array;
  efc_id: Int32Array;
  efc_J: Float64Array;
  efc_vel: Float64Array;
  efc_force: Float64Array;
  energy: Float64Array;
  ncon: number;
  nefc: number;
  nJ: number;
  time: number;
  contact: OwnedVector<NativeContact>;
  warning: Vector<Handle & { number: number; lastinfo: number }>;
};
type Native = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  DoubleBuffer: new (length: number) => BufferView;
  mj_version(): number;
  mj_versionString(): string;
  mj_id2name(model: Model, kind: number, id: number): string;
  mj_isSparse(model: Model): number;
  mj_maxContact(model: Model, i: number, j: number, margin: number): number;
  mj_step1(model: Model, data: Data): void;
  mj_step2(model: Model, data: Data): void;
  mj_forward(model: Model, data: Data): void;
  mj_energyPos(model: Model, data: Data): void;
  mj_energyVel(model: Model, data: Data): void;
  mj_mulM(model: Model, data: Data, out: BufferView, qvel: number[]): void;
  mj_differentiatePos(
    model: Model,
    out: BufferView,
    dt: number,
    from: number[],
    to: number[],
  ): void;
  mj_objectVelocity(
    model: Model,
    data: Data,
    kind: number,
    id: number,
    out: BufferView,
    local: number,
  ): void;
  mj_contactForce(model: Model, data: Data, id: number, out: BufferView): void;
};
type Entry = {
  index: number;
  first: number;
  second: number;
  address: number;
  rowTypes: number;
  exclude: number;
  distance: number;
  point: Vec;
  frame: number[];
  force: Vec;
  velocity: Vec;
  jacDelta: Vec;
};
type ContactIdentity = {
  first: number;
  second: number;
  exclude: number;
  active: boolean;
  distance: number;
};
type ContactCensus = { identities: ContactIdentity[]; nativeRowCount: number };
type AppliedShaft = { torque: number; impulse: number };
type Frame = {
  from: number;
  to: number;
  pre: State;
  post: State;
  before: Pose[];
  after: Pose[];
  circuit: Electrical;
  applied?: AppliedShaft;
  contacts: Entry[];
  census: ContactCensus;
  phaseHash: string;
  kinematics: ReturnType<typeof bodyVelocities>;
};

// Observation/serialization code is traced to frozen R5 cb068c9b and sphere source 7d7fa52.
const xml = f.xml.join('\n') + '\n';
const eng = f.engine,
  physics = f.physical,
  boom = physics.boom,
  limits = physics.limits,
  budgets = f.budgets,
  cap = f.raw,
  comparison = f.comparison;
const nq = 10,
  nv = 9,
  nbody = 5,
  ngeom = 11;
const axleQ = 7,
  axleV = 6;
const names = {
  lower: 0,
  ascent: 1,
  platform: 2,
  descent: 3,
  terminal: 4,
  chassis: 5,
  bumper: 6,
  rearLeft: 7,
  rearRight: 8,
  frontLeft: 9,
  frontRight: 10,
};
const wheels = [7, 8, 9, 10];
const geomBodies = [0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 4];
const roverBody = 1;
const bodyParents = [0, 0, 1, 1, 1];
const wheelHinges = new Map([
  [2, 7],
  [3, 8],
  [4, 9],
]);
const hingeAxis: Vec = [0, 1, 0],
  up: Vec = [0, 0, 1];
const worldPose: Pose = { p: [0, 0, 0], q: [1, 0, 0, 0] };
const ids = ['uno', 'battery', 'left-motor', 'left-fet', 'left-flyback'] as const;
const motorId = ids[2],
  port = 'tt-left-output';
const selectedMotor = BRUSHED_MOTOR_ASSEMBLY_PROFILES.find(
  (p) => p.profileId === f.motor.profileId,
);
const fixtureUrl = new URL('./arduino-tt-composed-terrain-seams.fixture.json', import.meta.url);
const sourceUrl = new URL(import.meta.url);
const secondsPerMicrosecond = 1e-6;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, i) => sum + value * b[i]!, 0);
const norm = (a: Vec) => Math.hypot(...a);
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const ints = (x: number, cap: number) => Number.isSafeInteger(x) && x >= 0 && x <= cap;
const pairKey = (a: number, b: number) => Math.min(a, b) * ngeom + Math.max(a, b);
const indexedPairs = new Map(f.expected.pairs.map((p) => [pairKey(p.ids[0]!, p.ids[1]!), p]));

function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function near(a: number, b: number, epsilon: number, code: string) {
  requireThat(
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon,
    code + ': ' + a + ' vs ' + b,
  );
}
function finite(value: number | undefined, code: string): number {
  requireThat(typeof value === 'number' && Number.isFinite(value), code);
  return value;
}
function floatView(value: unknown, size: number, label: string) {
  requireThat(
    value instanceof Float64Array && value.length === size && value.every(Number.isFinite),
    'NATIVE_FLOAT64 ' + label + ' size=' + size,
  );
  return value;
}
function intView(value: unknown, size: number, label: string) {
  requireThat(
    value instanceof Int32Array && value.length === size,
    'NATIVE_INT32 ' + label + ' size=' + size,
  );
  return value;
}
function vec(a: ArrayLike<number>, at = 0): Vec {
  return [finite(a[at], 'VEC_X'), finite(a[at + 1], 'VEC_Y'), finite(a[at + 2], 'VEC_Z')];
}
function quat(a: ArrayLike<number>, at = 0): Quat {
  return [
    finite(a[at], 'QUAT_W'),
    finite(a[at + 1], 'QUAT_X'),
    finite(a[at + 2], 'QUAT_Y'),
    finite(a[at + 3], 'QUAT_Z'),
  ];
}
function rotate(q: Quat, p: Vec): Vec {
  const axis: Vec = [q[1], q[2], q[3]];
  const t = scale(cross(axis, p), 2);
  return add(p, add(scale(t, q[0]), cross(axis, t)));
}
function displacement(p: Vec, before: Pose, after: Pose): Vec {
  const [w, x, y, z] = before.q;
  const local = rotate([w, -x, -y, -z], sub(p, before.p));
  return sub(add(after.p, rotate(after.q, local)), p);
}
type Gpio = {
  sequence: number;
  atMicroseconds: number;
  terminal: string;
  kind: string;
  mode?: string;
  voltageVolt?: number;
};
type GpioInput = Omit<Gpio, 'voltageVolt'> & { voltage?: number };
function normalizeGpio(event: GpioInput): Gpio {
  return {
    sequence: event.sequence,
    atMicroseconds: event.atMicroseconds,
    terminal: event.terminal,
    kind: event.kind,
    ...(event.mode === undefined ? {} : { mode: event.mode }),
    ...(event.voltage === undefined ? {} : { voltageVolt: event.voltage }),
  };
}
function pureUno(world: World, instructionBudget: number) {
  let state: Parameters<typeof advanceClockedArduinoRuntime>[3];
  const events: Gpio[] = [];
  for (let call = 0; call < 4096; call++) {
    const step = advanceClockedArduinoRuntime(
      f.programs[world].source,
      {},
      budgets.horizonUs / 1000,
      state,
      undefined,
      { instructionBudget },
    );
    state = step.state;
    events.push(...step.events.filter((e) => e.terminal === 'd5').map(normalizeGpio));
    requireThat(
      step.executionStatus !== 'fault',
      'PURE_UNO_FAULT ' + JSON.stringify(step.diagnostics),
    );
    if (step.executionStatus === 'ready') {
      requireThat(
        Math.round(state.virtualTimeMs * 1000) === budgets.horizonUs &&
          state.outputVoltages.d5 === 0,
        'PURE_UNO_HORIZON',
      );
      return events;
    }
  }
  throw new Error('PURE_UNO_BUDGET');
}
function buildCircuit(world: World) {
  const starter = createInitialRoboticsProject();
  const includes = (key: string) => ids.some((id) => key === id);
  const parsed = parseElectronicsEngineDocument({
    ...starter.circuit,
    components: starter.circuit.components
      .filter((p) => includes(p.id))
      .map((p) =>
        p.id === ids[0]
          ? {
              ...p,
              stateProperties: { arduinoCodeMode: 'text', arduinoSource: f.programs[world].source },
            }
          : p,
      ),
    connections: starter.circuit.connections.filter(
      ({ from, to }) => includes(from.componentId) && includes(to.componentId),
    ),
  });
  requireThat(parsed.ok, 'CANONICAL_TT_CIRCUIT_REJECTED');
  return parsed.document;
}

function gpioAt(world: World, from: number) {
  let level = 0;
  for (const event of f.programs[world].gpio) {
    if (event.atMicroseconds > from) break;
    if ('voltageVolt' in event) level = event.voltageVolt!;
  }
  return level;
}
function appliesAlternative(from: number) {
  return from >= comparison.interventionUs;
}
function sourcePins() {
  requireThat(selectedMotor, 'CANONICAL_TT_PROFILE');
  requireThat(hash(xml) === f.xmlSha256, 'FIXTURE_XML_DIGEST');
  requireThat(
    hash(
      readFileSync(
        new URL(
          '../../../contexts/electronics/domain/models/brushed-motor-profiles.ts',
          import.meta.url,
        ),
      ),
    ) === f.provenance.motorProfileSha256,
    'MOTOR_PROFILE_SOURCE',
  );
  requireThat(
    hash(readFileSync(new URL('./editable-ramp-geometry.ts', import.meta.url))) ===
      f.provenance.geometrySha256,
    'ACCEPTED_GEOMETRY_SOURCE',
  );
  requireThat(
    hash(f.rover.xml.join('\n') + '\n') === f.provenance.roverBlockSha256 &&
      xml.split(f.rover.xml.join('\n')).length === 2,
    'IMMUTABLE_R5_ROVER_BLOCK',
  );
  near(f.motor.gearRatio, selectedMotor.transmission.gearRatio.value, 0, 'GEAR_RATIO');
  near(
    f.motor.reflectedInertiaKgM2,
    f.motor.rotorInertiaKgM2 * f.motor.gearRatio ** 2,
    1e-18,
    'ONE_ROTOR_INERTIA',
  );
  requireThat(
    f.programs.control.source ===
      f.programs.powered.source.replaceAll('digitalWrite(5, HIGH)', 'digitalWrite(5, LOW)'),
    'LOW_ONLY_PROGRAM_DELTA',
  );
  for (const world of ['powered', 'control'] as const) {
    requireThat(hash(f.programs[world].source) === f.programs[world].sketchSha256, 'SKETCH_HASH');
    requireThat(
      hash(JSON.stringify(f.programs[world].gpio)) === f.programs[world].gpioSha256,
      'GPIO_HASH',
    );
  }
  return selectedMotor;
}
type Electrical = ReturnType<typeof readElectrical>;
function readElectrical(query: Query, world: World) {
  requireThat(query.quality.passed, 'SHARED_MNA_QUALITY');
  const [uno, battery, motor, fet, diode] = ids.map((id) => {
    const part = query.components.find((item) => item.componentId === id);
    requireThat(part, 'MISSING_MNA_COMPONENT ' + id);
    return part;
  }) as [ComponentResult, ComponentResult, ComponentResult, ComponentResult, ComponentResult];
  const v = (part: ComponentResult, a: string, b: string) =>
    finite(part.terminalVoltages[a], a) - finite(part.terminalVoltages[b], b);
  const logic = gpioAt(world, query.fromMicroseconds);
  const gpio = v(uno, 'd5', 'power-gnd-1');
  requireThat(gpio >= 2.5 === (logic === 5), 'ACTUAL_D5_TERMINAL_LEVEL');
  const gpioA = finite(uno.branchCurrents?.d5, 'D5_CURRENT');
  const sourceV = v(battery, 'BAT+', 'BAT-');
  const sourceA = -finite(battery.terminalCurrents?.['BAT+'], 'BATTERY_CURRENT');
  const windV = v(motor, 'positive', 'negative');
  const current = finite(motor.terminalCurrents?.positive, 'WINDING_CURRENT');
  const fetVds = v(fet, 'drain', 'source');
  const fetVgs = v(fet, 'gate', 'source');
  const fetA = finite(fet.branchCurrents?.drain, 'FET_DRAIN');
  const fetGate = finite(fet.branchCurrents?.gate, 'FET_GATE');
  const diodeV = v(diode, 'anode', 'cathode');
  const diodeA = finite(diode.current, 'FLYBACK_CURRENT');
  const tol = budgets.terminalReadTolerance;
  const kcl = query.quality.kclToleranceAmp;
  near(windV + fetVds, sourceV, tol, 'SERIES_KVL');
  near(diodeV, -windV, tol, 'DIODE_KVL');
  near(fetVgs, gpio, tol, 'GATE_KVL');
  near(current, fetA + diodeA, kcl, 'RETURN_KCL');
  near(sourceA + diodeA, current, kcl, 'BATTERY_KCL');
  near(gpioA, fetGate, kcl, 'GATE_KCL');
  near(current, query.winding.intervalCurrentAmp, tol, 'MNA_CURRENT');
  near(windV, query.windingVoltageVolt, tol, 'MNA_VOLTAGE');
  return {
    logic,
    gpio,
    gpioA,
    sourceV,
    sourceA,
    windV: query.windingVoltageVolt,
    current: query.winding.intervalCurrentAmp,
    fetVds,
    fetVgs,
    fetA,
    fetGate,
    diodeV,
    diodeA,
    inW: 6 * sourceA + logic * gpioA,
    circuitW:
      (6 - sourceV) * sourceA +
      (logic - gpio) * gpioA +
      fetVds * fetA +
      fetVgs * fetGate +
      diodeV * diodeA,
    viscousW: query.winding.viscousLossWatt,
    transmissionW: query.winding.transmissionLossWatt,
    j: query.winding.outputTorqueImpulseNewtonMeterSeconds,
    torque: query.winding.outputTorqueNewtonMeter,
    temperature: query.winding.state.temperatureCelsius,
    kcl,
    maxKcl: query.quality.maxKclResidualAmp,
  };
}
const electricKeys = [
  'logic',
  'gpio',
  'gpioA',
  'sourceV',
  'sourceA',
  'windV',
  'current',
  'fetVds',
  'fetVgs',
  'fetA',
  'fetGate',
  'diodeV',
  'diodeA',
  'inW',
  'circuitW',
  'viscousW',
  'transmissionW',
  'j',
  'torque',
  'temperature',
  'kcl',
  'maxKcl',
] as const satisfies readonly (keyof Electrical)[];

type Ledger = {
  cleanupErrors: string[];
  created: number;
  deleted: number;
  model: number;
  data: number;
  buffer: number;
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  forwards: number;
  force: number;
  velocity: number;
};
const newLedger = (): Ledger => ({
  cleanupErrors: [],
  created: 0,
  deleted: 0,
  model: 0,
  data: 0,
  buffer: 0,
  step1: 0,
  step1Returned: 0,
  step2: 0,
  step2Returned: 0,
  forwards: 0,
  force: 0,
  velocity: 0,
});
function release(handle: Handle, ledger: Ledger) {
  try {
    handle.delete();
    ledger.deleted++;
  } catch (error) {
    ledger.cleanupErrors.push(String(error));
  }
}
type Inertia = [number, number, number, number, number, number];

function inertiaInBodyFrame(diagonal: Vec, axes: Quat): Inertia {
  const basis: Vec[] = [rotate(axes, [1, 0, 0]), rotate(axes, [0, 1, 0]), rotate(axes, up)];
  const product = (i: number, j: number) =>
    basis.reduce((a, axis, k) => a + diagonal[k]! * axis[i]! * axis[j]!, 0);
  return [product(0, 0), product(1, 1), product(2, 2), product(0, 1), product(0, 2), product(1, 2)];
}

function widths(model: Model) {
  const counts = {
    nq,
    nv,
    nbody,
    ngeom,
    njnt: 4,
    nmocap: 0,
    nu: 0,
    na: 0,
    nsensor: 0,
    nplugin: 0,
    neq: 0,
    ntendon: 0,
    nflex: 0,
    npair: 30,
    nmesh: 5,
    nmeshvert: 40,
    nmeshface: 60,
  };
  for (const [k, count] of Object.entries(counts))
    requireThat(model[k] === count, 'FACTORY_COUNT ' + k);
  const ints = {
    geom_type: [7, 7, 7, 7, 7, 6, 6, 5, 5, 5, 5],
    geom_bodyid: geomBodies,
    body_parentid: bodyParents,
    jnt_bodyid: [1, 2, 3, 4],
    geom_condim: Array<number>(ngeom).fill(3),
    geom_contype: Array<number>(ngeom).fill(0),
    geom_conaffinity: Array<number>(ngeom).fill(0),
    jnt_type: [0, 3, 3, 3],
    jnt_qposadr: f.expected.qposAdr,
    jnt_dofadr: f.expected.dofAdr,
  };
  for (const [k, expected] of Object.entries(ints))
    requireThat(
      same(Array.from(intView(model[k], expected.length, k)), expected),
      'FACTORY_INDEX ' + k,
    );
  const zero = (length: number) => Array<number>(length).fill(0);
  const zeros = {
    geom_surfacevel: ngeom * 6,
    geom_gap: ngeom,
    geom_margin: ngeom,
    geom_adhesion: ngeom,
    dof_damping: nv,
    dof_frictionloss: nv,
    body_gravcomp: nbody,
    pair_gap: counts.npair,
    pair_margin: counts.npair,
    pair_adhesion: counts.npair,
  };
  for (const [k, length] of Object.entries(zeros))
    requireThat(
      same(Array.from(floatView(model[k], length, k)), zero(length)),
      'FACTORY_ZERO ' + k,
    );
  const armature = zero(nv);
  armature[axleV] = f.motor.reflectedInertiaKgM2;
  requireThat(
    same(Array.from(floatView(model.dof_armature, nv, 'dof_armature')), armature),
    'FACTORY_ONE_TT_ARMATURE',
  );
  const jointAxes = floatView(model.jnt_axis, counts.njnt * 3, 'jnt_axis');
  const jointAnchors = floatView(model.jnt_pos, counts.njnt * 3, 'jnt_pos');
  for (const j of [1, 2, 3])
    requireThat(
      same(vec(jointAxes, j * 3), hingeAxis) && vec(jointAnchors, j * 3).every((x) => x === 0),
      'PRE_HINGE_AXIS_AND_BODY_ORIGIN_ANCHOR_' + j,
    );
  const masses = Array.from(floatView(model.body_mass, nbody, 'body_mass'));
  near(
    masses.slice(1).reduce((sum, x) => sum + x, 0),
    physics.chassisMass,
    1e-14,
    'CHASSIS_MASS',
  );
  const wheelSpin = (physics.wheelMass * physics.wheelRadius ** 2) / 2;
  const wheelCross =
    (physics.wheelMass * (3 * physics.wheelRadius ** 2 + (2 * physics.wheelHalfWidth) ** 2)) / 12;
  const rearCross = 2 * (wheelCross + physics.wheelMass * 0.065 ** 2);
  const inertia = floatView(model.body_inertia, nbody * 3, 'body_inertia');
  for (const [id, witness] of [
    [2, [rearCross, 2 * wheelSpin, rearCross]],
    [3, [wheelCross, wheelSpin, wheelCross]],
    [4, [wheelCross, wheelSpin, wheelCross]],
  ] as const)
    vec(inertia, id * 3).forEach((value, i) =>
      near(value, witness[i]!, 1e-14, 'WHEEL_BODY_INERTIA'),
    );
  const ipos = Array.from(floatView(model.body_ipos, nbody * 3, 'body_ipos'));
  requireThat(
    ipos.every((x) => x === 0),
    'ALL_RIGID_COM_ORIGINS',
  );
  const assembly = { inertia: f.rover.fullInertia };
  near(masses[roverBody]!, boom.combinedChassisMassKg, 0, 'ASSEMBLY_CHASSIS_MASS');
  requireThat(
    vec(ipos, 3 * roverBody).every((x) => x === 0),
    'ASSEMBLY_CHASSIS_COM',
  );
  const bodyIquat = floatView(model.body_iquat, nbody * 4, 'body_iquat');
  const assemblyTensor = inertiaInBodyFrame(
    vec(inertia, 3 * roverBody),
    quat(bodyIquat, 4 * roverBody),
  );
  assemblyTensor.forEach((value, i) =>
    near(value, assembly.inertia[i]!, 1e-14, 'ASSEMBLY_BODY_INERTIA_TENSOR'),
  );
  const geomPos = floatView(model.geom_pos, 3 * ngeom, 'geom_pos');
  const geomSize = floatView(model.geom_size, 3 * ngeom, 'geom_size');
  const geomQuat = floatView(model.geom_quat, 4 * ngeom, 'geom_quat');
  requireThat(
    same(vec(geomPos, 3 * names.bumper), boom.centerM) &&
      same(vec(geomSize, 3 * names.bumper), boom.halfSizeM),
    'MOUNTED_BOOM_NATIVE_COLLISION_BOX',
  );
  const bumperQuat = quat(geomQuat, 4 * names.bumper);
  bumperQuat.forEach((value, i) =>
    near(value, boom.quatWxyz[i]!, 1e-14, 'MOUNTED_BOOM_NATIVE_QUATERNION'),
  );
  const pairs = {
    first: Array.from(intView(model.pair_geom1, counts.npair, 'pair_geom1')),
    second: Array.from(intView(model.pair_geom2, counts.npair, 'pair_geom2')),
    dims: Array.from(intView(model.pair_dim, counts.npair, 'pair_dim')),
    friction: Array.from(floatView(model.pair_friction, counts.npair * 5, 'pair_friction')),
    solref: Array.from(floatView(model.pair_solref, counts.npair * 2, 'pair_solref')),
    solreffriction: Array.from(
      floatView(model.pair_solreffriction, counts.npair * 2, 'pair_solreffriction'),
    ),
    solimp: Array.from(floatView(model.pair_solimp, counts.npair * 5, 'pair_solimp')),
  };
  for (const [field, length] of Object.entries({
    geom_pos: ngeom * 3,
    geom_quat: ngeom * 4,
    geom_size: ngeom * 3,
    geom_friction: ngeom * 3,
  }))
    floatView(model[field], length, field);
  const settings = {
    ...eng.profile,
    timestep: budgets.maxStepUs * secondsPerMicrosecond,
    tolerance: 1e-10,
    ls_tolerance: 0.01,
    noslip_tolerance: 1e-12,
    impratio: 1,
    ccd_tolerance: 1e-8,
    density: 0,
    viscosity: 0,
  };
  const { gravity, ...scalars } = settings;
  for (const [k, expected] of Object.entries(scalars))
    near(
      finite(typeof model.opt[k] === 'number' ? model.opt[k] : undefined, 'OPT ' + k),
      expected,
      0,
      'OPT ' + k,
    );
  requireThat(same(Array.from(floatView(model.opt.gravity, 3, 'gravity')), gravity), 'OPT_GRAVITY');
  requireThat(same(Array.from(floatView(model.opt.wind, 3, 'wind')), [0, 0, 0]), 'OPT_WIND');
  return {
    counts,
    arms: armature,
    masses,
    ipos,
    inertia: Array.from(inertia),
    pairs,
    settings,
    assembly,
    assemblyTensor,
    bumperQuat,
  };
}
function modelReadback(M: Native, model: Model, data: Data) {
  const w = widths(model);
  const names = [
    Array.from({ length: nbody }, (_, id) => M.mj_id2name(model, 1, id)),
    Array.from({ length: ngeom }, (_, id) => M.mj_id2name(model, 5, id)),
    Array.from({ length: 4 }, (_, id) => M.mj_id2name(model, 3, id)),
  ];
  requireThat(
    JSON.stringify(names) ===
      JSON.stringify([f.expected.bodies, f.expected.geoms, f.expected.joints]),
    'FACTORY_NAMES',
  );
  requireThat(M.mj_isSparse(model) === 0, 'EXPLICIT_DENSE_JACOBIAN');
  const seen = new Set<number>();
  const pairAllocation = w.pairs.first.map((first, i) => {
    const second = w.pairs.second[i]!;
    const key = pairKey(first, second);
    const pair = indexedPairs.get(key);
    requireThat(pair && !seen.has(key) && w.pairs.dims[i] === 3, 'FACTORY_REGISTERED_PAIR');
    seen.add(key);
    requireThat(
      same(w.pairs.friction.slice(i * 5, i * 5 + 5), [pair.friction, pair.friction, 0, 0, 0]),
      'FACTORY_PAIR_FRICTION',
    );
    requireThat(same(w.pairs.solref.slice(i * 2, i * 2 + 2), [0.004, 1]), 'FACTORY_PAIR_SOLREF');
    requireThat(
      same(w.pairs.solreffriction.slice(i * 2, i * 2 + 2), [0, 0]),
      'FACTORY_PAIR_SOLREFFRICTION',
    );
    requireThat(
      same(w.pairs.solimp.slice(i * 5, i * 5 + 5), [0.99, 0.99, 0.001, 0.5, 2]),
      'FACTORY_PAIR_SOLIMP',
    );
    const max = M.mj_maxContact(model, first, second, 0);
    requireThat(ints(max, 8) && max > 0, 'FACTORY_PAIR_CAPACITY');
    requireThat(max === 4, 'FINITE_MESH_PAIR_CAPACITY');
    return { key, max };
  });
  const max = pairAllocation.reduce((sum, pair) => sum + pair.max, 0);
  requireThat(
    max <= cap.maxContactsPerInterval && max * 3 <= cap.maxRowsPerInterval,
    'FACTORY_AGGREGATE_PAIR_CAP',
  );
  const native = state(data);
  requireThat(
    same(native.qvel, Array<number>(nv).fill(0)) && native.seconds === 0,
    'FACTORY_INITIAL_CLOCK_VELOCITY',
  );
  const qpos = [-0.25, 0, 0.06, 1, 0, 0, 0, 0, 0, 0];
  native.qpos.forEach((value, i) => near(value, qpos[i]!, 1e-14, 'FACTORY_QPOS'));
  return { ...w, pairAllocation, max, names, native, geomBodies };
}
function state(data: Data): State {
  return {
    seconds: finite(data.time, 'NATIVE_TIME'),
    qpos: Array.from(floatView(data.qpos, nq, 'qpos')),
    qvel: Array.from(floatView(data.qvel, nv, 'qvel')),
  };
}
function sameState(a: State, b: State) {
  return Object.is(a.seconds, b.seconds) && same(a.qpos, b.qpos) && same(a.qvel, b.qvel);
}
function poseState(data: Data): Pose[] {
  const x = floatView(data.xpos, nbody * 3, 'xpos');
  const q = floatView(data.xquat, nbody * 4, 'xquat');
  return Array.from({ length: nbody }, (_, id) => {
    const p = vec(x, id * 3);
    const rotation = quat(q, id * 4);
    near(Math.hypot(...rotation), 1, 1e-12, 'NATIVE_BODY_QUATERNION');
    return { p, q: rotation };
  });
}
function warnings(data: Data, ledger: Ledger) {
  // The pinned binding returns warning by reference: never delete its borrowed vector.
  // contact is returned by value; its vector and each get() copy are owned separately.
  const v = data.warning;
  requireThat(v.size() === 7, 'PINNED_WARNING_COUNT');
  for (let i = 0; i < 7; i++) {
    const stat = v.get(i);
    requireThat(stat, 'NATIVE_WARNING_MISSING');
    ledger.created++;
    try {
      requireThat(
        stat.number === 0 && stat.lastinfo === 0,
        'NATIVE_WARNING ' + i + ': ' + stat.lastinfo,
      );
    } finally {
      release(stat, ledger);
    }
  }
  requireThat(ledger.cleanupErrors.length === 0, 'WARNING_COPY_CLEANUP_FAILED');
}
function action(data: Data, torque: number) {
  requireThat(
    floatView(data.ctrl, 0, 'ctrl').length === 0 &&
      floatView(data.xfrc_applied, nbody * 6, 'xfrc_applied').every((x) => x === 0),
    'NO_BODY_FORCE',
  );
  const qfrc = floatView(data.qfrc_applied, nv, 'qfrc_applied');
  requireThat(
    qfrc.every((x, i) => x === (i === axleV ? torque : 0)),
    'ONE_APPLIED_HINGE_TORQUE',
  );
}
type Energy = {
  state: State;
  poses: Pose[];
  potential: number;
  kinetic: number;
  massTimesVelocity: number[];
  bodies: {
    id: number;
    com: Vec;
    omega: Vec;
    velocity: Vec;
    inertialToWorld: number[];
    mass: number;
    moments: Vec;
  }[];
  gravity: Vec;
  reflectedInertia: number;
};

function endpointEnergy(
  M: Native,
  model: Model,
  data: Data,
  massBuffer: BufferView,
  vectorBuffer: BufferView,
  readback: ReturnType<typeof widths>,
  ledger: Ledger,
): Energy {
  const before = state(data);
  ledger.forwards++;
  M.mj_forward(model, data);
  const after = state(data);
  requireThat(sameState(before, after), 'ENDPOINT_FORWARD_STATE_CHANGED');
  M.mj_energyPos(model, data);
  M.mj_energyVel(model, data);
  M.mj_mulM(model, data, massBuffer, after.qvel);
  const massTimesVelocity = Array.from(floatView(massBuffer.GetView(), nv, 'mass-times-velocity'));
  const [potential, kinetic] = floatView(data.energy, 2, 'energy') as unknown as [number, number];
  const ximat = floatView(data.ximat, nbody * 9, 'ximat');
  const bodies = bodyVelocities(M, model, data, vectorBuffer, ledger)
    .slice(1)
    .map((body, index) => {
      const id = index + 1;
      return {
        id,
        ...body,
        inertialToWorld: Array.from(ximat.subarray(id * 9, (id + 1) * 9)),
        mass: readback.masses[id]!,
        moments: vec(readback.inertia, id * 3),
      };
    });
  const energy = {
    state: after,
    poses: poseState(data),
    potential,
    kinetic,
    massTimesVelocity,
    bodies,
    gravity: vec(readback.settings.gravity),
    reflectedInertia: readback.arms[axleV]!,
  };
  checkEndpointEnergy(energy);
  return energy;
}

function checkEndpointEnergy(endpoint: Energy) {
  requireThat(
    endpoint.bodies.length === nbody - 1 &&
      endpoint.massTimesVelocity.length === nv &&
      same(endpoint.gravity, eng.profile.gravity) &&
      endpoint.reflectedInertia === f.motor.reflectedInertiaKgM2,
    'ENDPOINT_PRIMITIVE_MECHANICS',
  );
  let independentlyComputedKinetic =
    (endpoint.reflectedInertia * endpoint.state.qvel[axleV]! ** 2) / 2;
  let independentlyComputedPotential = 0;
  endpoint.bodies.forEach((body, index) => {
    const rotation = body.inertialToWorld;
    requireThat(
      body.id === index + 1 &&
        rotation.length === 9 &&
        body.mass > 0 &&
        body.moments.every((moment) => moment > 0),
      'ENDPOINT_PRIMITIVE_BODY_ID_INERTIA',
    );
    // ximat maps the principal inertial frame to world. Its columns express the
    // principal axes in world, so their omega projections yield local rotation energy.
    const axes = [0, 1, 2].map((i) => vec([rotation[i]!, rotation[i + 3]!, rotation[i + 6]!]));
    for (const [i, axis] of axes.entries())
      axes.forEach((other, j) =>
        near(
          dot(axis, other),
          i === j ? 1 : 0,
          budgets.forceFrameTolerance,
          'ENDPOINT_INERTIAL_ROTATION',
        ),
      );
    const omegaLocal = axes.map((axis) => dot(axis, body.omega));
    independentlyComputedKinetic +=
      (body.mass * dot(body.velocity, body.velocity) +
        dot(
          body.moments,
          omegaLocal.map((x) => x * x),
        )) /
      2;
    independentlyComputedPotential -= body.mass * dot(endpoint.gravity, body.com);
  });
  const massDot = dot(endpoint.state.qvel, endpoint.massTimesVelocity) / 2;
  // Five body sums, their coordinate products and the generalized mass product
  // are evaluated in different orders. This bound scales with binary64 roundoff.
  const agree = (actual: number, independent: number, code: string) =>
    near(
      actual,
      independent,
      256 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(independent)),
      code,
    );
  agree(endpoint.kinetic, massDot, 'FULL_MASS_ENERGY_WITH_ARMATURE');
  agree(endpoint.kinetic, independentlyComputedKinetic, 'INDEPENDENT_RIGID_BODY_KINETIC_ENERGY');
  agree(
    endpoint.potential,
    independentlyComputedPotential,
    'INDEPENDENT_BODY_GRAVITATIONAL_ENERGY',
  );
  return { independentlyComputedKinetic, independentlyComputedPotential, massDot };
}

type ContactSnapshot = Omit<Entry, 'index' | 'force' | 'velocity' | 'jacDelta' | 'rowTypes'> & {
  distance: number;
  exclude: number;
};
function nativeContacts(
  data: Data,
  ledger: Ledger,
  pairCapacity: Map<number, number>,
): ContactSnapshot[] {
  requireThat(ints(data.ncon, cap.maxContactsPerInterval), 'NATIVE_CONTACT_COUNT');
  const contacts = data.contact;
  ledger.created++;
  const countByPair = new Map<number, number>();
  try {
    requireThat(contacts.size() === data.ncon, 'NATIVE_CONTACT_VECTOR_WIDTH');
    return Array.from({ length: data.ncon }, (_, i) => {
      const c = contacts.get(i);
      requireThat(c, 'CONTACT_HANDLE');
      ledger.created++;
      try {
        const ids = intView(c.geom, 2, 'contact.geom');
        const first = ids[0]!;
        const second = ids[1]!;
        requireThat(
          ints(first, ngeom - 1) && ints(second, ngeom - 1) && first !== second,
          'CONTACT_GEOM_ID',
        );
        const key = pairKey(first, second);
        const pair = indexedPairs.get(key);
        const count = (countByPair.get(key) ?? 0) + 1;
        countByPair.set(key, count);
        requireThat(
          pair && count <= (pairCapacity.get(key) ?? 0) && c.dim === 3,
          'EXPLICIT_CONTACT_PAIR_OR_DIM',
        );
        const actualFriction = Array.from(floatView(c.friction, 5, 'contact.friction'));
        requireThat(
          same(actualFriction, [pair.friction, pair.friction, 1e-5, 1e-5, 1e-5]),
          'EFFECTIVE_CONTACT_FRICTION',
        );
        requireThat(
          floatView(c.surfacevel, 3, 'contact.surfacevel').every((x) => x === 0) &&
            c.adhesion === 0,
          'NO_CONTACT_DRIVE',
        );
        const point = vec(floatView(c.pos, 3, 'contact.pos'));
        const frame = Array.from(floatView(c.frame, 9, 'contact.frame'));
        const basis = [vec(frame), vec(frame, 3), vec(frame, 6)];
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++)
            near(
              dot(basis[row]!, basis[col]!),
              row === col ? 1 : 0,
              budgets.forceFrameTolerance,
              'CONTACT_FRAME_ORTHONORMAL',
            );
        near(
          norm(sub(cross(basis[0]!, basis[1]!), basis[2]!)),
          0,
          budgets.forceFrameTolerance,
          'RIGHT_HANDED_CONTACT_FRAME',
        );
        requireThat(
          Number.isSafeInteger(c.efc_address) && c.efc_address >= -1 && ints(c.exclude, 7),
          'NATIVE_CONTACT_ROW_ADDRESS',
        );
        return {
          first,
          second,
          address: c.efc_address,
          point,
          frame,
          exclude: c.exclude,
          distance: finite(c.dist, 'CONTACT_SEPARATION'),
        };
      } finally {
        release(c, ledger);
      }
    });
  } finally {
    release(contacts, ledger);
  }
}
function rowSnapshot(data: Data) {
  requireThat(ints(data.nefc, cap.maxRowsPerInterval), 'BOUNDED_EFC_ROW_COUNT');
  const size = data.nefc;
  return {
    size,
    type: Array.from(intView(data.efc_type, size, 'efc_type')),
    id: Array.from(intView(data.efc_id, size, 'efc_id')),
  };
}
function contactPointVelocity(p: Vec, body: { com: Vec; velocity: Vec; omega: Vec }) {
  return add(body.velocity, cross(body.omega, sub(p, body.com)));
}
function bodyVelocities(M: Native, model: Model, data: Data, buffer: BufferView, ledger: Ledger) {
  const com = floatView(data.xipos, nbody * 3, 'xipos');
  return Array.from({ length: nbody }, (_, id) => {
    M.mj_objectVelocity(model, data, 1, id, buffer, 0);
    ledger.velocity++;
    const v = floatView(buffer.GetView(), 6, 'COM_VELOCITY');
    return { com: vec(com, id * 3), omega: vec(v), velocity: vec(v, 3) };
  });
}
function preConstraints(
  M: Native,
  model: Model,
  data: Data,
  before: State,
  buffer: BufferView,
  ledger: Ledger,
  capacity: Map<number, number>,
) {
  const contacts = nativeContacts(data, ledger, capacity);
  const rows = rowSnapshot(data);
  requireThat(data.nJ === rows.size * nv, 'DENSE_ROWS_NOT_MATERIALIZED');
  const jac = Array.from(floatView(data.efc_J, data.nJ, 'PRE_EFC_J'));
  const velocity = Array.from(floatView(data.efc_vel, rows.size, 'PRE_EFC_VEL'));
  const kinematic = bodyVelocities(M, model, data, buffer, ledger);
  const observedRows = new Set<number>();
  contacts.forEach((c, id) => {
    if (c.address < 0) return;
    requireThat(c.exclude === 0 && c.address + 3 <= rows.size, 'INACTIVE_CONSTRAINT_HAS_ROWS');
    const relative = sub(
      contactPointVelocity(c.point, kinematic[geomBodies[c.second]!]!),
      contactPointVelocity(c.point, kinematic[geomBodies[c.first]!]!),
    );
    for (let local = 0; local < 3; local++) {
      const row = c.address + local;
      requireThat(
        rows.type[row] === 7 && rows.id[row] === id && !observedRows.has(row),
        'PRE_ELLIPTIC_ROW_IDENTITIES',
      );
      observedRows.add(row);
      near(
        dot(relative, vec(c.frame, local * 3)),
        velocity[row]!,
        budgets.velocityParityMps,
        'POINT_SPEED_NATIVE_EFC_PARITY',
      );
      near(
        dot(jac.slice(row * nv, row * nv + nv), before.qvel),
        velocity[row]!,
        budgets.velocityParityMps,
        'J_QVEL_NATIVE_EFC_PARITY',
      );
    }
  });
  requireThat(observedRows.size === rows.size, 'UNREGISTERED_EFC_ROW');
  return { contacts, rows, jac, velocity, kinematic };
}
function solvedRows(
  M: Native,
  model: Model,
  data: Data,
  pre: ReturnType<typeof preConstraints>,
  delta: number[],
  buffer: BufferView,
  ledger: Ledger,
  capacity: Map<number, number>,
  attempt?: Record<string, unknown>,
) {
  const post = rowSnapshot(data);
  if (attempt) attempt.postRows = post;
  requireThat(
    pre.rows.size === post.size && same(pre.rows.type, post.type) && same(pre.rows.id, post.id),
    'POST_EFC_IDENTITY',
  );
  const contacts = nativeContacts(data, ledger, capacity);
  if (attempt) attempt.postContacts = contacts;
  requireThat(
    JSON.stringify(contacts) === JSON.stringify(pre.contacts) &&
      contacts.every(
        (v, i) =>
          same(v.point, pre.contacts[i]!.point) &&
          same(v.frame, pre.contacts[i]!.frame) &&
          Object.is(v.distance, pre.contacts[i]!.distance),
      ),
    'SAME_ROW_NATIVE_CONTACT_PHASE',
  );
  const forces = Array.from(floatView(data.efc_force, post.size, 'SOLVED_EFC_FORCE'));
  const actualForces: number[][] = [];
  if (attempt) {
    attempt.efcForce = forces;
    attempt.actualForces = actualForces;
  }
  const all = contacts.map((ct, index): Entry => {
    M.mj_contactForce(model, data, index, buffer);
    ledger.force++;
    const six = Array.from(floatView(buffer.GetView(), 6, 'NATIVE_CONTACT_FORCE'));
    actualForces.push(six);
    requireThat(
      six.slice(3).every((v) => v === 0),
      'DIM3_NO_CONTACT_TORQUE',
    );
    if (ct.address < 0) {
      requireThat(
        six.every((v) => v === 0),
        'INACTIVE_CONTACT_NO_FORCE',
      );
      return {
        ...ct,
        index,
        rowTypes: 0,
        force: vec(six),
        velocity: [0, 0, 0],
        jacDelta: [0, 0, 0],
      };
    }
    const at = ct.address;
    requireThat(ct.exclude === 0 && six[0]! >= 0, 'NONNEGATIVE_NORMAL_FORCE');
    if (six[0]! > 0) requireThat(ct.distance < 0, 'LOADED_CONTACT_NOT_PENETRATING');
    requireThat(same(vec(six), vec(forces, at)), 'SOLVED_CONTACT_FORCE_ROWS');
    return {
      ...ct,
      index,
      rowTypes: 0x777,
      force: vec(six),
      velocity: vec(pre.velocity, at),
      jacDelta: vec(
        [0, 1, 2].map((j) => dot(pre.jac.slice((at + j) * nv, (at + j + 1) * nv), delta)),
      ),
    };
  });
  return {
    active: all,
    census: {
      nativeRowCount: post.size,
      identities: contacts.map(({ first, second, exclude, address, distance }) => ({
        first,
        second,
        exclude,
        active: address >= 0,
        distance,
      })),
    },
  };
}

const moving = nbody - 1;
const headerWords = 4 + (nq + nv) + moving * 7 + moving * 9 + electricKeys.length;
const recordFootprint = cap.intervalByteCap;
const countsOffset = headerWords * 8; // 872: uint16 actual nefc, uint8 POST reference, reserved.
const appliedOffset = 880,
  distancesOffset = 896,
  postHashOffset = 1952,
  phaseHashOffset = 1984,
  paddingOffset = 2016;
const rawUpperBytes =
  2 * (cap.maxIntervalsPerWorld * recordFootprint + cap.maxContactsPerWorld * cap.contactBytes) +
  cap.metadataByteCap +
  cap.footerByteCap;
type Endpoint = { state: State; poses: Pose[] };
function doubles(values: readonly number[]) {
  requireThat(values.every(Number.isFinite), 'FINITE_F64');
  const b = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
  return b;
}
function stateBytes(v: State) {
  return doubles([v.seconds, ...v.qpos, ...v.qvel]);
}
function endpointBytes(e: Endpoint) {
  return Buffer.concat([stateBytes(e.state), doubles(e.poses.flatMap((p) => [...p.p, ...p.q]))]);
}
function validateContactCensus(contacts: Entry[], census: ContactCensus) {
  requireThat(
    ints(contacts.length, 132) &&
      contacts.length === census.identities.length &&
      ints(census.nativeRowCount, 396),
    'COMPLETE_NATIVE_CENSUS',
  );
  let rank = 0;
  const pairCounts = new Map<number, number>();
  contacts.forEach((ct, index) => {
    const id = census.identities[index]!;
    const key = pairKey(ct.first, ct.second),
      pairCount = (pairCounts.get(key) ?? 0) + 1;
    pairCounts.set(key, pairCount);
    requireThat(pairCount <= 4, 'NATIVE_PAIR_ALLOCATION4');
    requireThat(
      ct.index === index &&
        ints(ct.first, ngeom - 1) &&
        ints(ct.second, ngeom - 1) &&
        indexedPairs.has(pairKey(ct.first, ct.second)) &&
        ct.first === id.first &&
        ct.second === id.second &&
        ct.exclude === id.exclude &&
        Object.is(ct.distance, id.distance),
      'FULL_CONTACT_IDENTITY',
    );
    requireThat(ints(ct.exclude, 7) && ct.address >= 0 === id.active, 'CONTACT_EXCLUDE_ROW');
    if (id.active) {
      requireThat(
        ct.exclude === 0 && ct.address === 3 * rank++ && ct.rowTypes === 0x777,
        'EXACT_NATIVE_ROW_ID_ADDRESS_TYPES',
      );
    } else
      requireThat(
        ct.address === -1 &&
          ct.rowTypes === 0 &&
          [...ct.force, ...ct.velocity, ...ct.jacDelta].every((v) => v === 0),
        'INACTIVE_CONTACT_RETAINED',
      );
  });
  requireThat(census.nativeRowCount === 3 * rank, 'NO_ORPHAN_NATIVE_ROWS');
}
function encodeInterval(frame: Frame, successor?: Endpoint) {
  validateContactCensus(frame.contacts, frame.census);
  const actual: Endpoint = { state: frame.post, poses: frame.after };
  if (successor)
    requireThat(
      endpointBytes(actual).equals(endpointBytes(successor)),
      'EXACT_ACTUAL_POST_SUCCESSOR_BYTES',
    );
  requireThat(frame.phaseHash === hash(stateBytes(frame.pre)), 'EXACT_ACTUAL_STEP1_PHASE_BYTES');
  requireThat(
    doubles([...frame.before[0]!.p, ...frame.before[0]!.q]).equals(
      doubles([...worldPose.p, ...worldPose.q]),
    ),
    'WORLD_POSE_DICTIONARY',
  );
  const raw = Buffer.alloc(recordFootprint + frame.contacts.length * 176),
    words = [
      frame.from,
      frame.to,
      frame.pre.seconds,
      frame.contacts.length,
      ...frame.pre.qpos,
      ...frame.pre.qvel,
      ...frame.before.slice(1).flatMap((v) => [...v.p, ...v.q]),
      ...frame.kinematics.slice(1).flatMap((v) => [...v.com, ...v.velocity, ...v.omega]),
      ...electricKeys.map((k) => frame.circuit[k]),
    ];
  requireThat(headerWords === 109 && words.length === headerWords, 'EXACT_HEADER_872');
  doubles(words).copy(raw);
  raw.writeUInt16LE(frame.census.nativeRowCount, countsOffset);
  raw[countsOffset + 2] = successor ? 1 : 2;
  if (frame.applied) {
    raw.writeDoubleLE(frame.applied.torque, appliedOffset);
    raw.writeDoubleLE(frame.applied.impulse, appliedOffset + 8);
  }
  Buffer.from(hash(endpointBytes(actual)), 'hex').copy(raw, postHashOffset);
  Buffer.from(frame.phaseHash, 'hex').copy(raw, phaseHashOffset);
  supportLabels(frame).masks.forEach((v, i) => (raw[2016 + i] = v));
  frame.contacts.forEach((ct, i) => {
    raw.writeDoubleLE(ct.distance, distancesOffset + 8 * i);
    const offset = recordFootprint + i * 176;
    raw.writeUInt16LE(ct.first, offset);
    raw.writeUInt16LE(ct.second, offset + 2);
    raw.writeUInt16LE(
      ct.rowTypes | (ct.exclude << 12) | ((ct.address >= 0 ? 1 : 0) << 15),
      offset + 4,
    );
    raw.writeUInt16LE((ct.address < 0 ? 255 : ct.address / 3) | (ct.index << 8), offset + 6);
    const row = [...ct.point, ...ct.frame, ...ct.force, ...ct.velocity, ...ct.jacDelta];
    requireThat(row.length === 21, 'CONTACT_176');
    doubles(row).copy(raw, offset + 8);
  });
  return raw;
}
function decodeHead(item: Buffer) {
  requireThat(item.length >= 2048, 'RAW_HEADER_TRUNCATED');
  let at = 0;
  const take = () => {
      const v = item.readDoubleLE(at);
      at += 8;
      return finite(v, 'RAW_F64');
    },
    many = (n: number) => Array.from({ length: n }, take);
  const from = take(),
    to = take(),
    seconds = take(),
    count = take();
  requireThat(ints(count, 132) && item.length === 2048 + count * 176, 'RAW_ALL_CONTACT_FRAME_SIZE');
  const pre = { seconds, qpos: many(nq), qvel: many(nv) },
    before = [
      worldPose,
      ...Array.from({ length: moving }, () => ({ p: vec(many(3)), q: quat(many(4)) })),
    ];
  const kinematics = [
    { com: worldPose.p, velocity: worldPose.p, omega: worldPose.p },
    ...Array.from({ length: moving }, () => ({
      com: vec(many(3)),
      velocity: vec(many(3)),
      omega: vec(many(3)),
    })),
  ];
  const circuit = Object.fromEntries(electricKeys.map((k) => [k, take()])) as Electrical;
  requireThat(
    at === countsOffset &&
      item.subarray(countsOffset + 3, appliedOffset).every((v) => v === 0) &&
      item.subarray(paddingOffset + 4, 2048).every((v) => v === 0),
    'RAW_HEADER_PADDING',
  );
  const ref = item[countsOffset + 2];
  requireThat(ref === 1 || ref === 2, 'EXACT_POST_REFERENCE_KIND');
  return { from, to, pre, before, kinematics, circuit, count, ref };
}
function decodeInterval(item: Buffer, endpoint: Endpoint): Frame {
  const h = decodeHead(item);
  requireThat(
    hash(endpointBytes(endpoint)) ===
      item.subarray(postHashOffset, postHashOffset + 32).toString('hex'),
    'ACTUAL_POST_BACKREFERENCE_HASH',
  );
  const phaseHash = item.subarray(phaseHashOffset, phaseHashOffset + 32).toString('hex');
  requireThat(phaseHash === hash(stateBytes(h.pre)), 'ACTUAL_PHASE_HASH');
  const contacts = Array.from({ length: h.count }, (_, i): Entry => {
    const offset = 2048 + i * 176,
      bits = item.readUInt16LE(offset + 4),
      link = item.readUInt16LE(offset + 6),
      group = link & 255;
    let at = offset + 8;
    const many = (n: number) =>
      Array.from({ length: n }, () => {
        const v = item.readDoubleLE(at);
        at += 8;
        return finite(v, 'RAW_CONTACT_F64');
      });
    return {
      first: item.readUInt16LE(offset),
      second: item.readUInt16LE(offset + 2),
      rowTypes: bits & 0xfff,
      exclude: (bits >>> 12) & 7,
      index: link >>> 8,
      address: group === 255 ? -1 : 3 * group,
      point: vec(many(3)),
      frame: many(9),
      force: vec(many(3)),
      velocity: vec(many(3)),
      jacDelta: vec(many(3)),
      distance: finite(item.readDoubleLE(distancesOffset + i * 8), 'RAW_DISTANCE'),
    };
  });
  contacts.forEach((ct, i) =>
    requireThat(
      (item.readUInt16LE(2048 + i * 176 + 4) >>> 15 !== 0) === ct.address >= 0,
      'RAW_ACTIVE_FLAG',
    ),
  );
  requireThat(
    item.subarray(distancesOffset + h.count * 8, postHashOffset).every((v) => v === 0),
    'RAW_UNUSED_CONTACT_DISTANCES',
  );
  const census = {
    nativeRowCount: item.readUInt16LE(countsOffset),
    identities: contacts.map((ct) => ({
      first: ct.first,
      second: ct.second,
      exclude: ct.exclude,
      active: ct.address >= 0,
      distance: ct.distance,
    })),
  };
  validateContactCensus(contacts, census);
  const applied = appliesAlternative(h.from)
    ? { torque: item.readDoubleLE(appliedOffset), impulse: item.readDoubleLE(appliedOffset + 8) }
    : undefined;
  if (!applied)
    requireThat(
      item.subarray(appliedOffset, appliedOffset + 16).every((v) => v === 0),
      'RAW_LEGACY_EFFORT_DICTIONARY',
    );
  return {
    from: h.from,
    to: h.to,
    pre: h.pre,
    post: endpoint.state,
    before: h.before,
    after: endpoint.poses,
    kinematics: h.kinematics,
    circuit: h.circuit,
    phaseHash,
    contacts,
    census,
    ...(applied ? { applied } : {}),
  };
}

function worldRotationVector(pre: Quat, post: Quat): Vec {
  const a = vec(post, 1);
  const b = scale(vec(pre, 1), -1);
  const real = post[0] * pre[0] - dot(a, b);
  const imaginary = add(add(scale(b, post[0]), scale(a, pre[0])), cross(a, b));
  const length = norm(imaginary);
  if (length === 0) return [0, 0, 0];
  const sign = real < 0 ? -1 : 1;
  return scale(imaginary, (sign * 2 * Math.atan2(length, Math.abs(real))) / length);
}

function preparePointMotion(frame: Frame) {
  const rootMoves = new Map(
    [roverBody].map((root) => {
      const pre = frame.before[root]!;
      const post = frame.after[root]!;
      return [
        root,
        {
          origin: pre.p,
          translation: sub(post.p, pre.p),
          angle: worldRotationVector(pre.q, post.q),
        },
      ];
    }),
  );
  return bodyParents.map((parent, body) => {
    if (body === 0) return undefined;
    const root = rootMoves.get(parent || body)!;
    const anchor = frame.before[body]!.p;
    const slot = wheelHinges.get(body);
    const jointAngle = slot === undefined ? 0 : frame.post.qpos[slot]! - frame.pre.qpos[slot]!;
    const jointArc = scale(rotate(frame.before[body]!.q, hingeAxis), jointAngle);
    return { ...root, anchor, jointAngle, jointArc };
  });
}

function pointTangentAndRemainder(point: Vec, body: ReturnType<typeof preparePointMotion>[number]) {
  if (!body) return { tangent: [0, 0, 0] as Vec, remainder: 0 };
  const lever = sub(point, body.anchor);
  const tangent = add(
    add(body.translation, cross(body.angle, sub(point, body.origin))),
    cross(body.jointArc, lever),
  );
  const rootAngle = norm(body.angle);
  // In the unit-parameter path, the anchor rotates with the free root; the
  // point lever rotates with both joints. Bound the second derivative by
  // the squared angular operator norms and integrate (1-s) over [0,1].
  const remainder =
    (rootAngle ** 2 * norm(sub(body.anchor, body.origin)) +
      (rootAngle + Math.abs(body.jointAngle)) ** 2 * norm(lever)) /
    2;
  return { tangent, remainder };
}

function boxProjection(pose: Pose, offset: Vec, half: Vec, axis: Vec, axes = boxAxes) {
  const center = dot(add(pose.p, rotate(pose.q, offset)), axis);
  const halfWidth = axes.reduce(
    (total, local, i) => total + half[i]! * Math.abs(dot(rotate(pose.q, local), axis)),
    0,
  );
  return { center, halfWidth };
}

function cylinderProjection(
  pose: Pose,
  localAxis: Vec,
  axis: Vec,
  radius: number,
  halfLength: number,
) {
  const longitudinal = Math.min(1, Math.abs(dot(rotate(pose.q, localAxis), axis)));
  return {
    center: dot(pose.p, axis),
    halfWidth: longitudinal * halfLength + Math.sqrt(1 - longitudinal ** 2) * radius,
  };
}

function pairWork(frame: Frame, c: Entry, motion = preparePointMotion(frame)) {
  const a = geomBodies[c.first]!;
  const b = geomBodies[c.second]!;
  const basis = [vec(c.frame), vec(c.frame, 3), vec(c.frame, 6)];
  const force = basis.reduce<Vec>(
    (value, dir, i) => add(value, scale(dir, c.force[i]!)),
    [0, 0, 0],
  );
  const velocity = sub(
    contactPointVelocity(c.point, frame.kinematics[b]!),
    contactPointVelocity(c.point, frame.kinematics[a]!),
  );
  for (let i = 0; i < 3; i++)
    near(
      dot(velocity, basis[i]!),
      c.velocity[i]!,
      budgets.velocityParityMps,
      'RAW_POINT_SPEED_EFC_PARITY',
    );
  const dA = displacement(c.point, frame.before[a]!, frame.after[a]!);
  const dB = displacement(c.point, frame.before[b]!, frame.after[b]!);
  const chord = sub(dB, dA);
  const geometric = dot(force, chord);
  const fromRows = dot(c.force, c.jacDelta);
  const tA = pointTangentAndRemainder(c.point, motion[a]);
  const tB = pointTangentAndRemainder(c.point, motion[b]);
  const tangent = sub(tB.tangent, tA.tangent);
  const tangentRows = vec(basis.map((axis) => dot(tangent, axis)));
  const motionScale = Math.max(
    1,
    norm(c.point),
    norm(frame.before[a]!.p),
    norm(frame.before[b]!.p),
    norm(frame.after[a]!.p),
    norm(frame.after[b]!.p),
  );
  const roundoff = 128 * Number.EPSILON * motionScale;
  const dt = (frame.to - frame.from) * secondsPerMicrosecond;
  const tangentDisplacementError = norm(sub(tangentRows, c.jacDelta));
  tangentRows.forEach((value, i) =>
    near(
      value,
      c.jacDelta[i]!,
      budgets.velocityParityMps * dt + roundoff,
      'PRE_TANGENT_NATIVE_ROW_DISPLACEMENT',
    ),
  );
  const tangentWork = dot(force, tangent);
  near(tangentWork, fromRows, workAgreement(tangentWork, fromRows), 'INDEPENDENT_CONTACT_WORK');
  const curvature = norm(sub(chord, tangent));
  const taylorBound = tA.remainder + tB.remainder;
  requireThat(curvature <= taylorBound + roundoff, 'RIGID_POINT_CHORD_TAYLOR_REMAINDER');
  return {
    force,
    velocity,
    geometric,
    fromRows,
    dA,
    dB,
    tangentDisplacementError,
    curvature,
    taylorBound,
  };
}

function workAgreement(a: number, b: number) {
  return Math.max(
    budgets.motionWorkAbsJ,
    budgets.motionWorkRel * Math.max(Math.abs(a), Math.abs(b)),
  );
}
function isPair(c: Entry, a: number, b: number) {
  return (c.first === a && c.second === b) || (c.first === b && c.second === a);
}
function forceOn(c: Entry, g: number, force: Vec) {
  return c.second === g ? force : scale(force, -1);
}
function gearbox(profile: ReturnType<typeof sourcePins>) {
  const fit = profile.referencePoints.find(
    (x) => x.voltageVolt === profile.fitReferenceVoltageVolt,
  );
  requireThat(fit?.outputStallTorqueNewtonMeter, 'REFERENCE_TT_EFFICIENCY');
  const ratio = profile.transmission.gearRatio.value;
  const kt = profile.torqueNewtonMeterPerAmpere.value;
  const b = profile.viscousFrictionNewtonMeterSecondPerRadian.value;
  const eta = Math.min(
    profile.transmission.efficiencyUpperBound.value,
    Math.max(
      profile.transmission.efficiencyLowerBound.value,
      fit.outputStallTorqueNewtonMeter / (kt * fit.stallCurrentAmp * ratio),
    ),
  );
  requireThat(eta > 0 && eta < 1, 'EXACT_EFFICIENCY_MODEL');
  return { ratio, kt, b, eta };
}
function gearInput(pre: State, current: number, gear: ReturnType<typeof gearbox>) {
  const omega = pre.qvel[axleV]!;
  const motorOmega = gear.ratio * omega;
  const g = gear.kt * current - gear.b * motorOmega;
  return { torque: g * gear.ratio, reverse: g * motorOmega < 0, omega };
}

function appliedShaft(
  pre: State,
  circuit: Electrical,
  gear: ReturnType<typeof gearbox>,
  dt: number,
  alternative: boolean,
): AppliedShaft {
  const input = gearInput(pre, circuit.current, gear);
  const torque = alternative && input.reverse ? input.torque : circuit.j / dt;
  return { torque: finite(torque, 'FINITE_SELECTED_SHAFT_TORQUE'), impulse: torque * dt };
}

function gammaBound(operations: number) {
  const roundoff = Number.EPSILON / 2;
  return (operations * roundoff) / (1 - operations * roundoff);
}

function signedTransmission(frame: Frame, gear: ReturnType<typeof gearbox>, dt: number) {
  const input = gearInput(frame.pre, frame.circuit.current, gear);
  const applied = frame.applied ?? appliedShaft(frame.pre, frame.circuit, gear, dt, false);
  const delta = frame.post.qpos[axleQ]! - frame.pre.qpos[axleQ]!;
  const heldDelta = input.omega * dt;
  const lossTorque = input.torque - applied.torque;
  const nativeLoss = lossTorque * delta;
  const heldLoss = lossTorque * heldDelta;
  const nativeWork = applied.torque * delta;
  const heldGearInput = input.torque * heldDelta;
  const epsilon = input.torque * (heldDelta - delta);
  const remainder = heldGearInput - (nativeWork + nativeLoss + epsilon);
  const roundoff =
    gammaBound(12) *
    (Math.abs(heldGearInput) + Math.abs(nativeWork) + Math.abs(nativeLoss) + Math.abs(epsilon));
  const workSign = (torque: number) => Math.sign(torque) * Math.sign(delta);
  return {
    reverse: input.reverse,
    delta,
    applied,
    nativeWork,
    nativeLoss,
    heldLoss,
    epsilon,
    remainder,
    roundoff,
    reverseProducesWork: input.reverse && workSign(applied.torque) > 0,
    gearProducesEnergy: workSign(lossTorque) < 0,
  };
}

function windingBalance(
  frame: Frame,
  gear: ReturnType<typeof gearbox>,
  profile: ReturnType<typeof sourcePins>,
  priorCurrent: number,
  dt: number,
) {
  const circuit = frame.circuit;
  const resistance = profile.armatureResistanceOhm.value;
  const inductance = profile.armatureInductanceHenry.value;
  const i = circuit.current;
  const motorOmega = gear.ratio * frame.pre.qvel[axleV]!;
  const backEmf = profile.backEmfVoltSecondPerRadian.value * motorOmega;
  const input = circuit.windV * i * dt;
  const copper = resistance * i ** 2 * dt;
  const magnetic = (inductance / 2) * (i ** 2 - priorCurrent ** 2);
  const backwardEuler = (inductance / 2) * (i - priorCurrent) ** 2;
  const viscous = gear.b * motorOmega ** 2 * dt;
  const gearInput = gear.kt * i * motorOmega * dt - viscous;
  const windingResidual = input - (copper + magnetic + backwardEuler + viscous + gearInput);
  // Include the unsimplified affine-current term scale, so subtraction of
  // nearly equal voltage/EMF/history terms does not masquerade as free energy.
  const affineScale =
    Math.abs(i) *
    (dt * (Math.abs(circuit.windV) + Math.abs(backEmf) + resistance * Math.abs(i)) +
      inductance * (Math.abs(i) + Math.abs(priorCurrent)));
  const windingRoundoff =
    gammaBound(32) *
    (affineScale +
      Math.abs(input) +
      copper +
      Math.abs(magnetic) +
      backwardEuler +
      viscous +
      Math.abs(gearInput));
  return {
    input,
    copper,
    magnetic,
    backwardEuler,
    viscous,
    gearInput,
    residual: windingResidual,
    bound: windingRoundoff,
    violated: Math.abs(windingResidual) > windingRoundoff,
  };
}

function shaftValue(native: State) {
  const raw = native.seconds / secondsPerMicrosecond;
  const measuredAtMicroseconds = Math.round(raw);
  near(raw, measuredAtMicroseconds, budgets.clockToleranceUs, 'SHAFT_NATIVE_MICROSECOND_GRID');
  return {
    measuredAtMicroseconds,
    angleRadian: native.qpos[axleQ]!,
    angularVelocityRadPerSecond: native.qvel[axleV]!,
  };
}
type ShaftQuery = Extract<
  NonNullable<ReturnType<Session['step']>>,
  { kind: 'shaft-start' | 'shaft-interval' }
>;
function shaftReply(query: ShaftQuery, shaft: ReturnType<typeof shaftValue>) {
  return {
    componentId: query.componentId,
    port: query.port,
    runId: query.runId,
    generation: query.generation,
    sequence: query.sequence,
    token: query.token,
    axis: query.axis,
    fromMicroseconds: query.fromMicroseconds,
    toMicroseconds: query.toMicroseconds,
    ...shaft,
  };
}
function validateShaftQuery(query: ShaftQuery, world: World, sequence: number) {
  requireThat(
    query.componentId === motorId &&
      query.port === port &&
      query.axis === 'positive-output-shaft' &&
      query.sequence === sequence &&
      query.runId === 'terrain-seams:' + world &&
      query.generation === 1 &&
      typeof query.token === 'symbol',
    'CANONICAL_TT_QUERY_IDENTITY',
  );
}
function exactShaftSample(value: Query['leftShaft'], before: State) {
  const exact = shaftValue(before);
  return (
    value.measuredAtMicroseconds === exact.measuredAtMicroseconds &&
    Object.is(value.angularVelocityRadPerSecond, exact.angularVelocityRadPerSecond) &&
    Object.is(value.angleRadian, exact.angleRadian)
  );
}

const boxAxes: readonly Vec[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
function initialState(): State {
  return {
    seconds: 0,
    qpos: [-0.25, 0, 0.06, 1, 0, 0, 0, 0, 0, 0],
    qvel: Array<number>(nv).fill(0),
  };
}
function terrainGeometry() {
  const out = physics.terrain.map((t, i) => {
    const a = t.x[0]!,
      b = t.x[1]!,
      za = t.top[0]!,
      zb = t.top[1]!,
      ascending = zb >= za;
    const made = createEditableRampGeometry({
      lengthMeters: b - a,
      widthMeters: 1,
      riseMeters: Math.abs(zb - za),
      baseThicknessMeters: 0.05 + Math.min(za, zb),
      originMeters: [ascending ? a : 0, 0, Math.min(za, zb)],
      headingRadians: 0,
    });
    const points = ascending ? made.vertices : made.vertices.map((v) => [b - v[0], -v[1], v[2]]);
    const tol = 128 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
    requireThat(
      t.id === i &&
        t.bottom === -0.05 &&
        t.y[0] === -0.5 &&
        t.y[1] === 0.5 &&
        t.vertices.length === 8 &&
        points.every((v) => t.vertices.some((e) => norm(sub(vec(v), vec(e))) <= tol)),
      'CANONICAL_HELPER_VOLUME',
    );
    const centre = scale(
      t.vertices.reduce<Vec>((a, v) => add(a, vec(v)), [0, 0, 0]),
      1 / 8,
    );
    for (const face of t.faces) {
      const a = vec(t.vertices[face[0]!]!),
        b = vec(t.vertices[face[1]!]!),
        c = vec(t.vertices[face[2]!]!);
      requireThat(
        dot(cross(sub(b, a), sub(c, a)), sub(centre, a)) < 0,
        'CLOSED_OUTWARD_CONVEX_FACES',
      );
    }
    if (i > 0)
      requireThat(
        t.x[0] === physics.terrain[i - 1]!.x[1] && t.top[0] === physics.terrain[i - 1]!.top[1],
        'SHARED_CANONICAL_EDGE',
      );
    return {
      id: i,
      vertices: t.vertices,
      faces: t.faces,
      plan: t.vertices.slice(0, 4).map((v) => [v[0], v[1]]),
      profile: [
        [a, -0.05],
        [b, -0.05],
        [b, zb],
        [a, za],
      ],
      normal: t.normal,
      angle: Math.atan2(Math.abs(zb - za), b - a),
      volume: (b - a) * (0.05 + (za + zb) / 2),
    };
  });
  return out;
}
function ulp32(value: number) {
  const a = Math.abs(value);
  return a === 0 ? 2 ** -149 : 2 ** (Math.max(-126, Math.floor(Math.log2(a))) - 23);
}
function compiledDisplacementBudget() {
  return (
    Math.sqrt(3) * (3 * 0.5 * ulp32(20) + 256 * f.geometry.float64UnitRoundoff * (1 + 20 + 3 * 20))
  );
}
function compiledVertexBudget(point: Vec, matrix: number[], local: Vec) {
  // Frozen a-priori F32 rounding + F64 transform arithmetic; not a physical face allowance.
  const inputBound = 20;
  requireThat(norm(local) <= inputBound, 'COMPILED_LOCAL_VERTEX_BOUND');
  return [0, 1, 2].map((row) => {
    const rounding = [0, 1, 2].reduce(
      (sum, j) => sum + Math.abs(matrix[row * 3 + j]!) * 0.5 * ulp32(inputBound),
      0,
    );
    return (
      rounding +
      256 *
        f.geometry.float64UnitRoundoff *
        (1 +
          Math.abs(point[row]!) +
          [0, 1, 2].reduce((sum, j) => sum + Math.abs(matrix[row * 3 + j]! * local[j]!), 0))
    );
  }) as Vec;
}
function assertMesh(model: Model, data: Data) {
  const made = terrainGeometry(),
    vertices = model.mesh_vert,
    faces = model.mesh_face;
  requireThat(
    vertices instanceof Float32Array &&
      vertices.length === 120 &&
      faces instanceof Int32Array &&
      faces.length === 180,
    'FIVE_COMPILED_MESH_SHAPES',
  );
  const adr = intView(model.mesh_vertadr, 5, 'mesh_vertadr'),
    count = intView(model.mesh_vertnum, 5, 'mesh_vertnum'),
    fa = intView(model.mesh_faceadr, 5, 'mesh_faceadr'),
    fc = intView(model.mesh_facenum, 5, 'mesh_facenum'),
    geomIds = intView(model.geom_dataid, ngeom, 'geom_dataid');
  const gp = floatView(data.geom_xpos, ngeom * 3, 'geom_xpos'),
    gm = floatView(data.geom_xmat, ngeom * 9, 'geom_xmat'),
    used = new Set<number>();
  const actual = made.map((g, i) => {
    const mesh = geomIds[i]!;
    requireThat(
      ints(mesh, 4) && !used.has(mesh) && count[mesh] === 8 && fc[mesh] === 12,
      'ONE_CLOSED_MESH_PER_VOLUME',
    );
    used.add(mesh);
    const matrix = Array.from(gm.slice(i * 9, i * 9 + 9)),
      position = vec(gp, i * 3),
      local = Array.from({ length: 8 }, (_, j) => vec(vertices, (adr[mesh]! + j) * 3));
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        near(
          dot(matrix.slice(a * 3, a * 3 + 3), matrix.slice(b * 3, b * 3 + 3)),
          a === b ? 1 : 0,
          1e-12,
          'COMPILED_ROTATION_ORTHONORMAL',
        );
    const transformed = local.map((v) => ({
      p: add(position, vec([0, 1, 2].map((row) => dot(matrix.slice(row * 3, row * 3 + 3), v)))),
      budget: compiledVertexBudget(position, matrix, v),
    }));
    const assigned = new Set<number>();
    g.vertices.forEach((expected) => {
      const matches = transformed
        .map((v, j) => ({ v, j }))
        .filter(({ v }) =>
          [0, 1, 2].every((k) => Math.abs(v.p[k]! - expected[k]!) <= v.budget[k]!),
        );
      requireThat(
        matches.length === 1 && !assigned.has(matches[0]!.j),
        'COMPILED_VERTEX_BIJECTION',
      );
      assigned.add(matches[0]!.j);
    });
    const centre = scale(
      transformed.reduce<Vec>((a, v) => add(a, v.p), [0, 0, 0]),
      1 / 8,
    );
    for (let j = 0; j < 12; j++) {
      const ids = Array.from(faces.slice((fa[mesh]! + j) * 3, (fa[mesh]! + j + 1) * 3));
      requireThat(
        ids.every((x) => ints(x, 7)),
        'COMPILED_FACE_INDICES',
      );
      const [a, b, c] = ids.map((k) => transformed[k]!.p) as [Vec, Vec, Vec];
      requireThat(dot(cross(sub(b, a), sub(c, a)), sub(centre, a)) < 0, 'COMPILED_OUTWARD_HULL');
    }
    return { id: i, mesh, vertices: transformed };
  });
  const seams = actual.slice(1).map((right, index) => {
    const left = actual[index]!,
      x = physics.terrain[index]!.x[1]!,
      z = physics.terrain[index]!.top[1]!;
    return [-0.5, 0.5].map((y) => {
      const expected: Vec = [x, y, z],
        pick = (shape: typeof left) =>
          shape.vertices.reduce((a, b) =>
            norm(sub(a.p, expected)) <= norm(sub(b.p, expected)) ? a : b,
          ),
        a = pick(left),
        b = pick(right);
      requireThat(
        [0, 1, 2].every((k) => Math.abs(a.p[k]! - b.p[k]!) <= a.budget[k]! + b.budget[k]!),
        'ACTUAL_SHARED_TOP_EDGE',
      );
      return { expected, left: a, right: b };
    });
  });
  return {
    volumes: actual,
    seams,
    representation: 'F32 local vertices / F64 native geom transforms',
    noHiddenCollider: true,
  };
}
function terrainTop(id: number, point: Vec) {
  const t = physics.terrain[id];
  if (!t) return false;
  const n = vec(t.normal),
    origin: Vec = [t.x[0]!, 0, t.top[0]!],
    distance = dot(sub(point, origin), n),
    projected = sub(point, scale(n, distance));
  return (
    Math.abs(distance) <= limits.faceDistanceM &&
    projected[0] >= t.x[0]! &&
    projected[0] <= t.x[1]! &&
    Math.abs(projected[1]) <= 0.5
  );
}
function wheelPoint(frame: Frame, wheel: number, point: Vec) {
  const index = wheels.indexOf(wheel);
  requireThat(index >= 0, 'DECLARED_WHEEL');
  const body = geomBodies[wheel]!,
    pose = frame.before[body]!,
    offset: Vec = [0, index < 2 ? (index === 0 ? 0.065 : -0.065) : 0, 0],
    centre = add(pose.p, rotate(pose.q, offset)),
    axis = rotate(pose.q, hingeAxis),
    r = sub(point, centre),
    axial = dot(r, axis),
    radial = norm(sub(r, scale(axis, axial)));
  return {
    centre,
    axis,
    axial,
    radial,
    valid:
      Math.abs(radial - physics.wheelRadius) <= limits.faceDistanceM &&
      Math.abs(axial) <= physics.wheelHalfWidth + limits.faceDistanceM,
  };
}
function supportLabels(frame: Frame) {
  const masks = [0, 0, 0, 0],
    invalid = [0, 0, 0, 0],
    failures: string[] = [],
    outward = [0, 0, 0, 0],
    impulses = [0, 0, 0, 0];
  let slip = 0;
  for (const ct of frame.contacts) {
    if (ct.force[0] <= 0) continue;
    const wheel = wheels.find((v) => ct.first === v || ct.second === v),
      terrain = ct.first < 5 ? ct.first : ct.second < 5 ? ct.second : -1;
    if (wheel === undefined) {
      if (terrain >= 0 && (isPair(ct, terrain, names.chassis) || isPair(ct, terrain, names.bumper)))
        failures.push('BODY_TERRAIN_CONTACT');
      continue;
    }
    if (terrain < 0) {
      failures.push('UNREGISTERED_WHEEL_PAIR');
      continue;
    }
    const i = wheels.indexOf(wheel),
      n = vec(physics.terrain[terrain]!.normal),
      force = [vec(ct.frame), vec(ct.frame, 3), vec(ct.frame, 6)].reduce<Vec>(
        (a, v, j) => add(a, scale(v, ct.force[j]!)),
        [0, 0, 0],
      ),
      normal = forceOn(ct, wheel, vec(ct.frame)),
      worldForce = forceOn(ct, wheel, force),
      signed = dot(worldForce, n),
      point = wheelPoint(frame, wheel, ct.point);
    const valid =
      terrain >= 0 &&
      terrainTop(terrain, ct.point) &&
      point.valid &&
      dot(normal, n) >= Math.cos((limits.faceNormalAllowDeg * Math.PI) / 180) &&
      signed > 0 &&
      dot(worldForce, up) > 0;
    if (!valid) {
      failures.push('INVALID_LOADED_WHEEL_TOP_FACE');
      invalid[i] = 1;
    } else masks[i] = masks[i]! | (1 << terrain);
    slip = Math.max(slip, Math.hypot(ct.velocity[1], ct.velocity[2]));
    outward[i]! += signed;
    impulses[i]! += signed * (frame.to - frame.from) * 1e-6;
  }
  return { masks, invalid, failures, slip, outward, impulses };
}
const boxShapes = [
  { offset: [0, 0, 0] as Vec, half: [0.08, 0.05, 0.016] as Vec, axes: boxAxes },
  {
    offset: vec(boom.centerM),
    half: vec(boom.halfSizeM),
    axes: boxAxes.map((a) => rotate(quat(boom.quatWxyz), a)),
  },
];
function bodyClearances(poses: Pose[]) {
  const pose = poses[roverBody]!;
  return boxShapes.map((shape) =>
    physics.terrain.map((t) => {
      const ownAxes = shape.axes.map((a) => rotate(pose.q, a)),
        edges: Vec[] = [
          [1, 0, (t.top[1]! - t.top[0]!) / (t.x[1]! - t.x[0]!)],
          [0, 1, 0],
          [0, 0, 1],
        ],
        axes = [
          ...boxAxes,
          vec(t.normal),
          ...ownAxes,
          ...ownAxes.flatMap((a) => edges.map((b) => cross(a, b))),
        ]
          .filter((a) => norm(a) > 1e-12)
          .map((a) => scale(a, 1 / norm(a)));
      return Math.max(
        ...axes.map((axis) => {
          const box = boxProjection(pose, shape.offset, shape.half, axis, shape.axes),
            terrain = t.vertices.map((v) => dot(vec(v), axis));
          return Math.max(
            box.center - box.halfWidth - Math.max(...terrain),
            Math.min(...terrain) - box.center - box.halfWidth,
          );
        }),
      );
    }),
  );
}
function completeEnvelope(poses: Pose[]) {
  const root = poses[roverBody]!,
    boxes = boxShapes.map((shape) => ({
      body: roverBody,
      reach: norm(shape.offset) + norm(shape.half),
      intervals: boxAxes.map((a) => boxProjection(root, shape.offset, shape.half, a, shape.axes)),
    }));
  wheels.forEach((id, i) => {
    const body = geomBodies[id]!,
      pose = poses[body]!,
      offset: Vec = [0, i < 2 ? (i === 0 ? 0.065 : -0.065) : 0, 0],
      p = add(pose.p, rotate(pose.q, offset));
    boxes.push({
      body,
      reach: norm(offset) + Math.hypot(physics.wheelRadius, physics.wheelHalfWidth),
      intervals: boxAxes.map((a) =>
        cylinderProjection(
          { ...pose, p },
          hingeAxis,
          a,
          physics.wheelRadius,
          physics.wheelHalfWidth,
        ),
      ),
    });
  });
  return boxes;
}
function assemblyZ(poses: Pose[], masses: readonly number[]) {
  const mass = masses.slice(1).reduce((a, b) => a + b, 0);
  return poses.slice(1).reduce((a, p, i) => a + masses[i + 1]! * p.p[2], 0) / mass;
}
type TerrainWindow = { from: number; to: number; minimumZ: number; maximumZ: number };
class Witness {
  readonly gears: ReturnType<typeof gearbox>;
  readonly failures = new Map<string, number>();
  readonly missing: string[] = [];
  readonly aggregate = {
    input: 0,
    positiveInput: 0,
    circuit: 0,
    signedCircuit: 0,
    copper: 0,
    magnet: 0,
    electricalEuler: 0,
    viscous: 0,
    transmission: 0,
    signedTransmission: 0,
    legacyTransmission: 0,
    shaft: 0,
    positiveShaft: 0,
    contact: 0,
    positiveContact: 0,
    contactAbsorption: 0,
    geometricContact: 0,
    contactCurvatureBound: 0,
  };
  readonly wheelDossier = wheels.map((id) => ({
    id,
    firstBySurface: Array<number | null>(5).fill(null),
    lastMask: 0,
    maskChanges: 0,
    invalidLoadedIntervals: 0,
    impulse: 0,
  }));
  readonly mixed: Array<{ from: number; to: number; masks: number[] } | null> = Array(4).fill(null);
  private readonly prefix = createHash('sha256');
  private readonly stream = createHash('sha256');
  private previous: State | undefined;
  private priorCurrent = 0;
  private prefixSteps = 0;
  private prefixEnd = 0;
  private prefixLastFrom = 0;
  private masses: number[] = [];
  private anchor: Vec | undefined;
  private activeWindows: Array<TerrainWindow | undefined> = Array(5).fill(undefined);
  readonly windows: Array<TerrainWindow | null> = Array(5).fill(null);
  private finalLow: number | undefined;
  private flyback = 0;
  private maxControlMove = 0;
  private maxSlip = 0;
  private maxRise = 0;
  private maxFall = 0;
  private minimumClearance = Infinity;
  private firstWindingGap: unknown;
  private firstReversalGap: unknown;
  private firstNegativeGearLoss: unknown;
  step = 0;
  lastTime = 0;
  constructor(
    readonly world: World,
    private readonly profile: ReturnType<typeof sourcePins>,
  ) {
    this.gears = gearbox(profile);
  }
  configure(readback: ReturnType<typeof widths>) {
    this.masses = readback.masses;
    near(
      this.masses.slice(1).reduce((a, b) => a + b, 0),
      0.6,
      1e-14,
      'EXACT_ASSEMBLY_MASS',
    );
  }
  private fail(code: string, at: number) {
    if (!this.failures.has(code)) this.failures.set(code, at);
  }
  observe(frame: Frame, encoded: Buffer) {
    requireThat(
      frame.from === this.lastTime && frame.to > frame.from && frame.to <= budgets.horizonUs,
      'OBSERVED_CLOCK',
    );
    if (this.previous) requireThat(sameState(this.previous, frame.pre), 'CONTINUOUS_NATIVE_STATE');
    this.previous = frame.post;
    this.lastTime = frame.to;
    this.step++;
    this.stream.update(encoded);
    if (frame.to <= comparison.interventionUs) {
      this.prefix.update(encoded);
      this.prefixSteps++;
      this.prefixEnd = frame.to;
      this.prefixLastFrom = frame.from;
    }
    checkPoseState(frame.pre, frame.before);
    checkPoseState(frame.post, frame.after);
    validateContactCensus(frame.contacts, frame.census);
    const labels = supportLabels(frame);
    requireThat(
      same(Array.from(encoded.subarray(2016, 2020)), labels.masks),
      'RECOMPUTED_INDIVIDUAL_WHEEL_LABELS',
    );
    const dt = (frame.to - frame.from) * 1e-6,
      a = this.aggregate,
      winding = windingBalance(frame, this.gears, this.profile, this.priorCurrent, dt),
      gear = signedTransmission(frame, this.gears, dt);
    this.priorCurrent = frame.circuit.current;
    if (winding.violated) this.firstWindingGap ??= { from: frame.from, to: frame.to, ...winding };
    if (gear.reverseProducesWork)
      this.firstReversalGap ??= { from: frame.from, to: frame.to, ...gear };
    if (gear.gearProducesEnergy)
      this.firstNegativeGearLoss ??= { from: frame.from, to: frame.to, ...gear };
    a.input += frame.circuit.inW * dt;
    a.positiveInput += Math.max(0, frame.circuit.inW * dt);
    a.signedCircuit += frame.circuit.circuitW * dt;
    a.circuit += Math.max(0, frame.circuit.circuitW * dt);
    a.copper += winding.copper;
    a.magnet += winding.magnetic;
    a.electricalEuler += winding.backwardEuler;
    a.viscous += winding.viscous;
    a.transmission += Math.max(0, gear.nativeLoss);
    a.signedTransmission += gear.nativeLoss;
    a.legacyTransmission += frame.circuit.transmissionW * dt;
    a.shaft += gear.nativeWork;
    a.positiveShaft += Math.max(0, gear.nativeWork);
    const motion = preparePointMotion(frame);
    for (const ct of frame.contacts) {
      if (ct.address < 0) continue;
      const w = pairWork(frame, ct, motion);
      a.contact += w.fromRows;
      a.positiveContact += Math.max(0, w.fromRows);
      a.contactAbsorption += Math.max(0, -w.fromRows);
      a.geometricContact += w.geometric;
      a.contactCurvatureBound += norm(w.force) * w.taylorBound;
    }
    for (const code of labels.failures) this.fail(code, frame.from);
    if (labels.slip > limits.maxSlipMps) this.fail('WHEEL_POINT_SLIP', frame.from);
    this.maxSlip = Math.max(this.maxSlip, labels.slip);
    labels.masks.forEach((mask, i) => {
      const d = this.wheelDossier[i]!;
      if (mask !== d.lastMask) {
        d.maskChanges++;
        d.lastMask = mask;
      }
      d.impulse += labels.impulses[i]!;
      d.invalidLoadedIntervals += labels.invalid[i]!;
      for (let surface = 0; surface < 5; surface++)
        if (mask & (1 << surface)) d.firstBySurface[surface] ??= frame.from;
    });
    for (let seam = 0; seam < 4; seam++)
      if (
        !this.mixed[seam] &&
        labels.failures.length === 0 &&
        labels.masks.every(
          (mask) => mask > 0 && (mask & ~((1 << seam) | (1 << (seam + 1)))) === 0,
        ) &&
        labels.masks.some((mask) => !!(mask & (1 << seam))) &&
        labels.masks.some((mask) => !!(mask & (1 << (seam + 1))))
      )
        this.mixed[seam] = { from: frame.from, to: frame.to, masks: [...labels.masks] };
    const z0 = assemblyZ(frame.before, this.masses),
      z1 = assemblyZ(frame.after, this.masses);
    for (let surface = 0; surface < 5; surface++) {
      const valid =
        labels.masks.every((mask) => !!(mask & (1 << surface))) &&
        labels.failures.length === 0 &&
        labels.slip <= 0.02 &&
        (surface !== 0 || (frame.from >= limits.staticUs && frame.to <= comparison.interventionUs));
      const last = this.activeWindows[surface];
      this.activeWindows[surface] = valid
        ? last?.to === frame.from
          ? {
              from: last.from,
              to: frame.to,
              minimumZ: Math.min(last.minimumZ, z0, z1),
              maximumZ: Math.max(last.maximumZ, z0, z1),
            }
          : {
              from: frame.from,
              to: frame.to,
              minimumZ: Math.min(z0, z1),
              maximumZ: Math.max(z0, z1),
            }
        : undefined;
      const w = this.activeWindows[surface];
      if (!this.windows[surface] && w && w.to - w.from >= 100000) this.windows[surface] = { ...w };
    }
    const base = this.windows[0],
      platform = this.windows[2];
    if (base && platform) this.maxRise = platform.minimumZ - base.maximumZ;
    const terminal = this.windows[4];
    if (platform && terminal) this.maxFall = platform.minimumZ - terminal.maximumZ;
    if (frame.to === comparison.interventionUs) this.anchor = frame.after[roverBody]!.p;
    if (this.anchor)
      this.maxControlMove = Math.max(
        this.maxControlMove,
        norm(sub(frame.after[roverBody]!.p, this.anchor)),
      );
    if (this.world === 'control' && this.maxControlMove > 0.02)
      this.fail('LOW_CONTROL_TRAVEL', frame.to);
    const before = completeEnvelope(frame.before),
      after = completeEnvelope(frame.after);
    for (const shapes of [before, after])
      if (
        shapes.some(
          (v) =>
            v.intervals[0]!.center - v.intervals[0]!.halfWidth < -0.8 ||
            v.intervals[0]!.center + v.intervals[0]!.halfWidth > 19 ||
            Math.abs(v.intervals[1]!.center) + v.intervals[1]!.halfWidth > 0.5,
        )
      )
        this.fail('FINITE_COURSE_DEPARTURE', frame.to);
    const c0 = bodyClearances(frame.before),
      c1 = bodyClearances(frame.after),
      root0 = frame.before[roverBody]!,
      root1 = frame.after[roverBody]!,
      angle = norm(worldRotationVector(root0.q, root1.q)),
      travel = norm(sub(root1.p, root0.p));
    for (let i = 0; i < 2; i++) {
      const shape = boxShapes[i]!,
        sweep = travel + (norm(shape.offset) + norm(shape.half)) * angle;
      for (let j = 0; j < 5; j++) {
        const gap = Math.min(c0[i]![j]!, c1[i]![j]!) - sweep - compiledDisplacementBudget();
        this.minimumClearance = Math.min(this.minimumClearance, gap);
        if (gap <= 0) this.fail('BODY_SWEEP_CLEARANCE_UNRESOLVED', frame.from);
      }
    }
    if (frame.from >= f.programs.offUs && frame.circuit.logic === 0) {
      this.finalLow ??= frame.from;
      if (frame.circuit.windV < 0) this.flyback = Math.max(this.flyback, frame.circuit.diodeA);
    }
  }
  finish(initial: Energy, end: Energy) {
    requireThat(
      this.lastTime === 10000000 && this.previous && sameState(this.previous, end.state),
      'FULL_MEASURED_HORIZON',
    );
    if (!this.windows[0]) this.fail('MISSING_SHARED_LOWER_BASELINE', 0);
    if (this.world === 'powered') {
      if (this.finalLow !== f.programs.offUs) this.fail('ACTUAL_FINAL_LOW_BOUNDARY', this.lastTime);
      if (this.flyback < 1e-6) this.fail('NO_LOW_NEGATIVE_VOLTAGE_FLYBACK', this.lastTime);
      this.missing.push(
        ...missingRoute(this.wheelDossier, this.windows, this.mixed, this.maxRise, this.maxFall),
      );
      for (const d of this.wheelDossier) {
        const times = d.firstBySurface.filter((v): v is number => v !== null);
        if (times.some((v, i) => i > 0 && v < times[i - 1]!))
          this.fail('NONCHRONOLOGICAL_WHEEL_ROUTE', this.lastTime);
      }
    }
    const a = this.aggregate,
      deltaStored = end.potential + end.kinetic - initial.potential - initial.kinetic + a.magnet,
      dissipation =
        a.circuit + a.copper + a.viscous + a.transmission + a.electricalEuler + a.contactAbsorption,
      residualJ = deltaStored + dissipation - a.input,
      limitJ = Math.max(0.0001, 0.01 * a.positiveInput);
    return {
      world: this.world,
      step: this.step,
      acceptedTime: this.lastTime,
      physical: this.failures.size ? 'FAIL' : this.missing.length ? 'NOT_REACHED' : 'PASS',
      failures: Array.from(this.failures),
      missing: this.missing,
      wheelDossier: this.wheelDossier,
      mixed: this.mixed,
      windows: this.windows,
      maxRise: this.maxRise,
      maxFall: this.maxFall,
      maxSlip: this.maxSlip,
      minimumClearance: this.minimumClearance,
      maximumControlRoverTravelM: this.maxControlMove,
      finalLowUs: this.finalLow ?? null,
      flyback: this.flyback,
      prefix: {
        intervals: this.prefixSteps,
        throughUs: this.prefixEnd,
        lastFromUs: this.prefixLastFrom,
        sha256: this.prefix.digest('hex'),
      },
      streamSha256: this.stream.digest('hex'),
      energy: {
        ...a,
        deltaStored,
        dissipation,
        residualJ,
        limitJ,
        budgetAccepted: Math.max(0, residualJ) <= limitJ,
        firstActualReversalGap: this.firstReversalGap ?? null,
        firstNegativeTransmission: this.firstNegativeGearLoss ?? null,
        firstWindingGap: this.firstWindingGap ?? null,
        causal:
          this.firstReversalGap ||
          this.firstNegativeGearLoss ||
          this.firstWindingGap ||
          Math.max(0, residualJ) > limitJ
            ? 'GAP'
            : 'NO_NEW_GAP_OBSERVED',
        historicalCausalStatus: 'GAP_CAUSAL_ALT',
        formalAcceptance: 'D01_D02_OPEN',
      },
    };
  }
}

type Outcome = ReturnType<Witness['finish']>;

const kindNames = {
  meta: 'arduino-tt-composed-terrain-seams.jsonl',
  intervals: 'arduino-tt-composed-terrain-seams.bin',
};
type JsonLine = Record<string, unknown>;
type Census = {
  modelAttempted: number;
  modelReturned: number;
  dataAttempted: number;
  dataReturned: number;
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  sessionsDisposed: number;
};
const nativeMode = process.env['ASA_TT_TERRAIN_NATIVE'] === 'one-composed-terrain-pair-1071';
function externalReceiptRoot(path: string) {
  requireThat(isAbsolute(path), 'ABSOLUTE_EXTERNAL_RECEIPT_ROOT');
  const actual = realpathSync(path),
    temp = realpathSync(tmpdir());
  const rel = relative(temp, actual);
  requireThat(
    actual === resolve(path) &&
      rel !== '' &&
      !isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('..' + sep),
    'EXISTING_UNIQUE_OS_TEMP_RECEIPT',
  );
  const checkout = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const inside = relative(checkout, actual);
  requireThat(
    inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside),
    'RECEIPT_OUTSIDE_CHECKOUT',
  );
  return actual;
}
function pinned(path: string, expected: { bytes: number; sha256: string }) {
  const stat = lstatSync(path);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.bytes,
    'PINNED_ARTIFACT_WIDTH ' + path,
  );
  const bytes = readFileSync(path);
  requireThat(hash(bytes) === expected.sha256, 'PINNED_ARTIFACT_SHA ' + path);
  return bytes;
}
function enginePins(path: string) {
  requireThat(isAbsolute(path) && realpathSync(path) === resolve(path), 'PINNED_AOT_DIRECTORY');
  const glue = pinned(join(path, eng.glue.file), eng.glue);
  const wasm = pinned(join(path, eng.wasm.file), eng.wasm);
  const declarations = pinned(join(path, eng.declarations.file), eng.declarations);
  const license = process.env['ASA_TT_TERRAIN_LICENSE'] ?? '';
  requireThat(isAbsolute(license), 'PINNED_UPSTREAM_LICENSE_PATH');
  pinned(license, eng.license);
  const build = pinned(join(dirname(path), 'build-receipt.json'), eng.buildReceipt);
  const browser = pinned(join(dirname(path), 'browser-receipt.json'), eng.browserReceipt);
  requireThat(
    JSON.parse(build.toString()).accepted === true &&
      JSON.parse(browser.toString()).accepted === true &&
      JSON.parse(browser.toString()).buildReceiptSha256 === eng.buildReceipt.sha256,
    'AOT_ADMISSION_RECEIPTS',
  );
  requireThat(wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { path, glue, wasm, declarations };
}
function exactSourcePins() {
  return [
    [fixtureUrl, 'ASA_TT_TERRAIN_FIXTURE_SHA256'],
    [sourceUrl, 'ASA_TT_TERRAIN_SOURCE_SHA256'],
  ].map(([url, key]) => {
    const expected = process.env[key as string] ?? '';
    requireThat(/^[a-f0-9]{64}$/.test(expected), 'EXPLICIT_FROZEN_SOURCE_DIGEST');
    const raw = readFileSync(url as URL);
    requireThat(hash(raw) === expected, 'FROZEN_SOURCE_DIGEST');
    return {
      file: fileURLToPath(url as URL)
        .split(sep)
        .at(-1),
      sha256: expected,
      bytes: raw.length,
    };
  });
}
const initialization = { attempted: 0, returned: 0, phase: 'not-imported' };
async function loadNative(input: ReturnType<typeof enginePins>) {
  assertNativeAdmission(nativeMode, initialization.attempted);
  initialization.attempted++;
  initialization.phase = 'glue-import';
  const path = join(input.path, eng.glue.file);
  pinned(path, eng.glue);
  const { default: factory } = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as {
    default(options: { wasmBinary: Buffer; locateFile(name: string): string }): Promise<Native>;
  };
  pinned(path, eng.glue);
  initialization.phase = 'factory';
  const M = await factory({
    wasmBinary: input.wasm,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'NO_UNREGISTERED_NATIVE_RESOURCE');
      return join(input.path, name);
    },
  });
  initialization.returned++;
  initialization.phase = 'version-readback';
  requireThat(
    M.mj_version() === 4000000 && M.mj_versionString() === eng.version,
    'NATIVE_EXACT_VERSION',
  );
  return M;
}
class Journal {
  readonly bin: number;
  readonly meta: number;
  readonly digest = createHash('sha256');
  binaryBytes = 0;
  metadataBytes = 0;
  footerBytes = 0;
  private intervals = 0;
  private contacts = 0;
  lastFrame: { to: number; postHash: string } | undefined;
  constructor(root: string) {
    this.meta = openSync(join(root, kindNames.meta), 'wx', 0o600);
    try {
      this.bin = openSync(join(root, kindNames.intervals), 'wx', 0o600);
    } catch (error) {
      const terminal = Buffer.from(
        JSON.stringify({ kind: 'admission-error', message: String(error), step1: 0, step2: 0 }) +
          '\n',
      );
      try {
        writeSync(this.meta, terminal);
        fsyncSync(this.meta);
      } finally {
        closeSync(this.meta);
      }
      throw error;
    }
  }
  beginWorld() {
    this.lastFrame = undefined;
    this.intervals = 0;
    this.contacts = 0;
  }
  reserveHeader() {
    requireThat(
      this.intervals < cap.maxIntervalsPerWorld &&
        this.contacts <= cap.maxContactsPerWorld &&
        this.binaryBytes + recordFootprint + cap.metadataByteCap + cap.footerByteCap <= cap.byteCap,
      'PRE_STEP1_CAPTURE_CAP',
    );
  }
  reserve(n: number) {
    const bytes = recordFootprint + n * cap.contactBytes;
    const reserved = this.binaryBytes + bytes + cap.metadataByteCap + cap.footerByteCap;
    if (
      !ints(n, cap.maxContactsPerInterval) ||
      this.contacts + n > cap.maxContactsPerWorld ||
      this.intervals >= cap.maxIntervalsPerWorld ||
      reserved > cap.byteCap
    ) {
      this.write(
        {
          kind: 'capture-gap',
          intervals: this.intervals,
          contacts: this.contacts,
          requestedBytes: bytes,
          requestedContacts: n,
          binaryBytes: this.binaryBytes,
        },
        true,
      );
      throw new Error('GAP_CAPTURE');
    }
    this.intervals++;
    this.contacts += n;
  }
  frame(buf: Buffer) {
    requireThat(writeSync(this.bin, buf) === buf.length, 'BINARY_SHORT_WRITE');
    this.digest.update(buf);
    this.binaryBytes += buf.length;
    this.lastFrame = {
      to: buf.readDoubleLE(8),
      postHash: buf.subarray(postHashOffset, postHashOffset + 32).toString('hex'),
    };
  }
  write(obj: JsonLine, emergency = false) {
    const line = Buffer.from(
      JSON.stringify(obj, (_k, value: unknown) =>
        typeof value === 'number' && Object.is(value, -0) ? 'float64:-0' : value,
      ) + '\n',
    );
    const size = emergency ? this.footerBytes + line.length : this.metadataBytes + line.length;
    if (size > (emergency ? cap.footerByteCap : cap.metadataByteCap))
      throw new Error('METADATA_CAPTURE_LIMIT');
    requireThat(writeSync(this.meta, line) === line.length, 'METADATA_SHORT_WRITE');
    if (emergency) this.footerBytes = size;
    else this.metadataBytes = size;
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
type PartialFrame = Omit<Frame, 'after'>;
function dynamicWorld(
  M: Native,
  world: World,
  journal: Journal,
  profile: ReturnType<typeof sourcePins>,
  dispatch: Census,
) {
  const history = new Witness(world, profile);
  const ledger = newLedger();
  const baseOffset = journal.binaryBytes;
  const circuit = buildCircuit(world);
  const circuitProjectionSha = hash(JSON.stringify(circuit));
  let session: Session | undefined;
  const createSession = () =>
    createElectronicsTtNativeDriveTestSession(circuit, {
      componentId: motorId,
      port,
      runId: 'terrain-seams:' + world,
      generation: 1,
      requestedHorizonMicroseconds: budgets.horizonUs,
      maxEvents: budgets.maxEvents,
    });
  let model: Model | undefined;
  let data: Data | undefined;
  const ownedBuffers: BufferView[] = [];
  let pending: PartialFrame | undefined;
  let lastObservedEndpoint: Endpoint | undefined;
  let stage = 'model';
  let sequence = 0;
  let calls = 0;
  let lastCanonicalC = 0;
  let firstError: unknown;
  let complete: Outcome | undefined;
  let attempted: { from: number; to: number } | undefined;
  let firstNativeError: unknown;
  let pendingAttempt: Record<string, unknown> | undefined;
  const flush = (finalPoses: Pose[], successor?: Endpoint) => {
    if (!pending) return;
    stage = 'retained-interval';
    const packet = { ...pending, after: finalPoses };
    const encoded = encodeInterval(packet, successor);
    if (!successor)
      journal.write(
        { kind: 'endpoint-tail', world, to: packet.to, state: packet.post, poses: finalPoses },
        true,
      );
    journal.frame(encoded);
    history.observe(packet, encoded);
    pending = undefined;
  };
  try {
    journal.beginWorld();
    requireThat(circuitProjectionSha === f.circuitSha256[world], 'EXACT_CANONICAL_CIRCUIT_SHA');
    session = createSession();
    journal.write({
      kind: 'setup',
      world,
      baseOffset,
      circuitProjectionSha,
      xmlSha256: f.xmlSha256,
      ledger,
    });
    dispatch.modelAttempted++;
    model = M.MjModel.from_xml_string(xml);
    dispatch.modelReturned++;
    requireThat(model, 'FACTORY_MODEL');
    ledger.model++;
    dispatch.dataAttempted++;
    data = new M.MjData(model);
    dispatch.dataReturned++;
    ledger.data++;
    const size = (length: number) => {
      const owner = new M.DoubleBuffer(length);
      ownedBuffers.push(owner);
      ledger.buffer++;
      return owner;
    };
    const vectorBuffer = size(6);
    const tangentBuffer = size(nv);
    const massBuffer = size(nv);
    stage = 'factory-readback';
    const readback = modelReadback(M, model, data);
    history.configure(readback);
    const capacity = new Map(readback.pairAllocation.map((pair) => [pair.key, pair.max]));
    warnings(data, ledger);
    action(data, 0);
    stage = 'initial-forward-observation';
    requireThat(ledger.cleanupErrors.length === 0, 'INITIAL_NATIVE_HANDLE_CLEANUP');
    const initial = endpointEnergy(M, model, data, massBuffer, vectorBuffer, readback, ledger);
    const mesh = assertMesh(model, data);
    const initialEnvelope = completeEnvelope(initial.poses);
    requireThat(
      initialEnvelope.every(
        (v) =>
          v.intervals[0]!.center - v.intervals[0]!.halfWidth >= -0.8 &&
          v.intervals[0]!.center + v.intervals[0]!.halfWidth <= 19 &&
          Math.abs(v.intervals[1]!.center) + v.intervals[1]!.halfWidth <= 0.5,
      ) &&
        bodyClearances(initial.poses)
          .flat()
          .every((v) => v > compiledDisplacementBudget()),
      'COMPILED_INITIAL_FULL_ROVER_ENVELOPE',
    );
    warnings(data, ledger);
    journal.write({
      kind: 'world-start',
      world,
      baseOffset,
      initial,
      readback,
      mesh,
      initialEnvelope,
      compiledClearanceBound: compiledDisplacementBudget(),
      circuitProjectionSha,
    });
    let started = false;
    for (; calls < cap.maxSessionCalls; calls++) {
      stage = 'canonical-session';
      const query = session.step();
      requireThat(query, 'TT_SESSION_EMPTY');
      lastCanonicalC = query.committedHorizonMicroseconds;
      if (query.kind === 'fault' || query.kind === 'paused')
        throw new Error('TT_SESSION_' + query.kind + ' ' + JSON.stringify(query));
      if (query.kind === 'working') continue;
      if (query.kind === 'complete') {
        requireThat(
          started && query.committedHorizonMicroseconds === budgets.horizonUs && pending,
          'EXACT_TT_COMPLETE_HORIZON',
        );
        const finalShaft = shaftValue(state(data));
        requireThat(
          query.shaft &&
            exactShaftSample(query.shaft, state(data)) &&
            finalShaft.measuredAtMicroseconds === budgets.horizonUs,
          'FINAL_TT_NATIVE_STATE_MATCH',
        );
        const gpio = query.events.filter((e) => e.terminal === 'd5').map(normalizeGpio);
        requireThat(
          JSON.stringify(gpio) === JSON.stringify(f.programs[world].gpio),
          'ACTUAL_CANONICAL_D5_TRACE',
        );
        stage = 'terminal-forward-observation';
        const end = endpointEnergy(M, model, data, massBuffer, vectorBuffer, readback, ledger);
        warnings(data, ledger);
        flush(end.poses);
        complete = history.finish(initial, end);
        requireThat(
          ledger.step1Returned === history.step &&
            ledger.step2Returned === history.step &&
            ledger.forwards === 2,
          'NATIVE_CALL_CENSUS',
        );
        journal.write({
          kind: 'world-end',
          world,
          calls: calls + 1,
          endOffset: journal.binaryBytes,
          final: end,
          gpio,
          outcome: complete,
          ledger,
        });
        stage = 'complete';
        break;
      }
      if (query.kind !== 'shaft-start' && query.kind !== 'shaft-interval')
        throw new Error('UNEXPECTED_TT_QUERY');
      validateShaftQuery(query, world, ++sequence);
      requireThat(
        query.committedHorizonMicroseconds === query.fromMicroseconds,
        'LEFT_COMMITTED_QUERY_BOUNDARY',
      );
      if (query.kind === 'shaft-start') {
        requireThat(
          !started && query.fromMicroseconds === 0 && query.toMicroseconds === 0,
          'EXACT_T0_SHAFT_START',
        );
        requireThat(
          session.respond(shaftReply(query, shaftValue(state(data)))),
          'START_SAMPLE_NOT_ACCEPTED',
        );
        started = true;
        continue;
      }
      requireThat(
        started &&
          ints(query.toMicroseconds, budgets.horizonUs) &&
          query.toMicroseconds > query.fromMicroseconds &&
          query.toMicroseconds - query.fromMicroseconds <= budgets.maxStepUs,
        'CLOCKED_NATIVE_INTERVAL_RANGE',
      );
      requireThat(
        ledger.step1 < cap.maxIntervalsPerWorld && ledger.step2 < cap.maxIntervalsPerWorld,
        'PRE_DISPATCH_NATIVE_CALL_CAP',
      );
      attempted = { from: query.fromMicroseconds, to: query.toMicroseconds };
      requireThat(
        query.toMicroseconds <= comparison.interventionUs ||
          query.fromMicroseconds >= comparison.interventionUs,
        'NATIVE_QUERY_SPANS_FIXED_INTERVENTION',
      );
      const pre = state(data);
      pendingAttempt = {
        world,
        from: query.fromMicroseconds,
        to: query.toMicroseconds,
        pre,
        query: {
          kind: query.kind,
          runId: query.runId,
          generation: query.generation,
          sequence: query.sequence,
          fromMicroseconds: query.fromMicroseconds,
          toMicroseconds: query.toMicroseconds,
          committedHorizonMicroseconds: query.committedHorizonMicroseconds,
          leftShaft: query.leftShaft,
        },
      };
      requireThat(
        query.fromMicroseconds === shaftValue(pre).measuredAtMicroseconds &&
          exactShaftSample(query.leftShaft, pre),
        'NATIVE_LEFT_BOUNDARY',
      );
      requireThat(
        query.winding.state.atMicroseconds === query.toMicroseconds &&
          query.winding.state.failureMode === 'none',
        'ACCEPTED_WINDING_AT_RIGHT_EDGE',
      );
      const electrical = readElectrical(query, world);
      pendingAttempt.electrical = electrical;
      const dt = (query.toMicroseconds - query.fromMicroseconds) * secondsPerMicrosecond;
      near(electrical.torque * dt, electrical.j, 1e-16, 'HELD_SIGNED_OUTPUT_IMPULSE');
      const alternative = appliesAlternative(query.fromMicroseconds);
      const effort = appliedShaft(pre, electrical, history.gears, dt, alternative);
      model.opt.timestep = dt;
      near(model.opt.timestep, dt, 0, 'NATIVE_STEP_DT');
      requireThat(dispatch.step1 < 44000 && dispatch.step2 < 44000, 'GLOBAL_STEP_CAP');
      journal.reserveHeader();
      stage = 'native-step1';
      ledger.step1++;
      dispatch.step1++;
      M.mj_step1(model, data);
      ledger.step1Returned++;
      dispatch.step1Returned++;
      const actualPhase = state(data);
      pendingAttempt.actualPhase = actualPhase;
      requireThat(sameState(pre, actualPhase), 'STEP1_CANNOT_ADVANCE_STATE');
      warnings(data, ledger);
      const resolvedActualPost = poseState(data);
      const before = poseState(data);
      requireThat(
        doubles(resolvedActualPost.flatMap((p) => [...p.p, ...p.q])).equals(
          doubles(before.flatMap((p) => [...p.p, ...p.q])),
        ),
        'INDEPENDENT_ENDPOINT_POSE_READ_BYTES',
      );
      pendingAttempt.before = before;
      pendingAttempt.resolvedActualPost = resolvedActualPost;
      requireThat(
        doubles([...before[0]!.p, ...before[0]!.q]).equals(
          doubles([...worldPose.p, ...worldPose.q]),
        ),
        'PRE_WORLD_POSE_DICTIONARY',
      );
      lastObservedEndpoint = { state: pre, poses: before };
      if (pending) {
        requireThat(sameState(pending.post, pre), 'DEFERRED_POST_POSE_IDENTITY');
        flush(resolvedActualPost, { state: pre, poses: before });
      }
      stage = 'pre-constraint-observation';
      const constraints = preConstraints(M, model, data, pre, vectorBuffer, ledger, capacity);
      pendingAttempt.constraints = constraints;
      journal.reserve(constraints.contacts.length);
      requireThat(ledger.cleanupErrors.length === 0, 'PRE_SOLVE_NATIVE_HANDLE_CLEANUP');
      data.qfrc_applied[axleV] = effort.torque;
      action(data, effort.torque);
      stage = 'native-step2';
      ledger.step2++;
      dispatch.step2++;
      M.mj_step2(model, data);
      ledger.step2Returned++;
      dispatch.step2Returned++;
      stage = 'solved-contact-observation';
      const post = state(data);
      pendingAttempt.post = post;
      requireThat(post.seconds > pre.seconds, 'NATIVE_TIME_NONMONOTONE');
      const shaft = shaftValue(post);
      requireThat(shaft.measuredAtMicroseconds === query.toMicroseconds, 'NATIVE_RIGHT_BOUNDARY');
      M.mj_differentiatePos(model, tangentBuffer, dt, pre.qpos, post.qpos);
      const delta = Array.from(
        floatView(tangentBuffer.GetView(), nv, 'CONFIGURATION_TANGENT'),
        (x) => x * dt,
      );
      const { active: contacts, census } = solvedRows(
        M,
        model,
        data,
        constraints,
        delta,
        vectorBuffer,
        ledger,
        capacity,
        pendingAttempt,
      );
      warnings(data, ledger);
      action(data, effort.torque);
      const applied = finite(data.qfrc_applied[axleV], 'NATIVE_APPLIED_SHAFT_READBACK');
      pending = {
        from: query.fromMicroseconds,
        to: query.toMicroseconds,
        pre,
        post,
        phaseHash: hash(stateBytes(actualPhase)),
        before,
        kinematics: constraints.kinematic,
        circuit: electrical,
        ...(alternative ? { applied: { torque: applied, impulse: applied * dt } } : {}),
        contacts,
        census,
      };
      stage = 'accept-native-shaft';
      const priorC = session.lastCommitted().committedHorizonMicroseconds;
      requireThat(session.respond(shaftReply(query, shaft)), 'NATIVE_RIGHT_SAMPLE_NOT_ACCEPTED');
      requireThat(
        session.lastCommitted().committedHorizonMicroseconds === priorC,
        'REPLY_EXPOSED_UNCLOSED_HORIZON',
      );
      pendingAttempt = undefined;
    }
    requireThat(complete, 'SESSION_BOUNDED_HORIZON_NOT_REACHED');
  } catch (e) {
    firstError = e;
    if (ledger.step1 > 0 || ledger.step2 > 0) firstNativeError = e;
  }
  const receiptErrors: string[] = [];
  if (firstError && journal.lastFrame) {
    const endpoint = matchingActualEndpoint(journal.lastFrame.postHash, [
      lastObservedEndpoint,
      pending ? { state: pending.pre, poses: pending.before } : undefined,
    ]);
    try {
      journal.write(
        endpoint
          ? { kind: 'aborted-successor', world, to: journal.lastFrame.to, ...endpoint }
          : {
              kind: 'unresolved-successor',
              world,
              to: journal.lastFrame.to,
              expectedPostHash: journal.lastFrame.postHash,
            },
        true,
      );
    } catch (e) {
      receiptErrors.push('abort endpoint: ' + String(e));
    }
  }
  const cleanup: string[] = [];
  const persistentCleanup = {
    bufferAttempted: 0,
    bufferDeleted: 0,
    dataAttempted: 0,
    dataDeleted: 0,
    modelAttempted: 0,
    modelDeleted: 0,
  };
  let sessionDisposeAttempted = 0,
    sessionDisposed = 0;
  try {
    if (session) {
      sessionDisposeAttempted++;
      session.dispose();
      sessionDisposed++;
      dispatch.sessionsDisposed++;
    }
  } catch (e) {
    cleanup.push('session: ' + String(e));
  }
  for (const handle of [...ownedBuffers, data, model]) {
    if (!handle) continue;
    const kind = handle === data ? 'data' : handle === model ? 'model' : 'buffer';
    persistentCleanup[(kind + 'Attempted') as keyof typeof persistentCleanup]++;
    try {
      handle.delete();
      persistentCleanup[(kind + 'Deleted') as keyof typeof persistentCleanup]++;
    } catch (e) {
      cleanup.push(kind + ': ' + String(e));
    }
  }
  try {
    journal.write(
      {
        kind: 'world-resources',
        world,
        stage,
        calls: calls + (complete ? 1 : 0),
        ledger,
        persistentCleanup,
        sessionDisposeAttempted,
        sessionDisposed,
        deletedPersistent:
          persistentCleanup.bufferDeleted +
          persistentCleanup.dataDeleted +
          persistentCleanup.modelDeleted,
        cleanup: [...cleanup, ...ledger.cleanupErrors],
      },
      true,
    );
  } catch (e) {
    receiptErrors.push('world resources: ' + String(e));
    firstError ??= e;
  }
  if (firstError || cleanup.length || ledger.cleanupErrors.length) {
    try {
      journal.write(
        {
          kind: 'first-error',
          world,
          stage,
          attempted,
          submitted: pending,
          pendingAttempt,
          ledger,
          lastCanonicalC,
          lastCapturedC: history.lastTime,
          physicalObservations: Array.from(history.failures),
          status: String(firstError).includes('GAP_CAPTURE') ? 'GAP_CAPTURE' : 'UNRESOLVED',
          error: String(firstError ?? cleanup[0]),
        },
        true,
      );
    } catch (e) {
      receiptErrors.push('primary receipt: ' + String(e));
    }
    const primary =
      firstNativeError ??
      firstError ??
      new Error('CLEANUP_FAILED ' + [...cleanup, ...ledger.cleanupErrors].join('; '));
    throw Object.assign(primary instanceof Error ? primary : new Error(String(primary)), {
      receiptErrors,
      cleanup: [...cleanup, ...ledger.cleanupErrors],
    });
  }
  requireThat(
    complete &&
      ledger.created === ledger.deleted &&
      ledger.model === 1 &&
      ledger.data === 1 &&
      ledger.buffer === 3,
    'NATIVE_LIFETIME_CENSUS',
  );
  return complete;
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  const imaginary = add(
    add(scale(vec(b, 1), a[0]), scale(vec(a, 1), b[0])),
    cross(vec(a, 1), vec(b, 1)),
  );
  return [a[0] * b[0] - dot(vec(a, 1), vec(b, 1)), ...imaginary];
}
function posesFromState(s: State): Pose[] {
  const root: Pose = { p: vec(s.qpos), q: quat(s.qpos, 3) };
  const offsets: Vec[] = [
    [-0.07, 0, -0.03],
    [0.07, 0.065, -0.03],
    [0.07, -0.065, -0.03],
  ];
  return [
    worldPose,
    root,
    ...offsets.map((offset, i) => {
      const theta = s.qpos[7 + i]!;
      const joint: Quat = [Math.cos(theta / 2), 0, Math.sin(theta / 2), 0];
      return { p: add(root.p, rotate(root.q, offset)), q: multiplyQuat(root.q, joint) };
    }),
  ];
}
function checkPoseState(s: State, poses: Pose[]) {
  const expected = posesFromState(s);
  requireThat(poses.length === expected.length, 'NATIVE_POSE_COUNT');
  poses.forEach((pose, i) => {
    near(norm(sub(pose.p, expected[i]!.p)), 0, 1e-12, 'ACTUAL_ENDPOINT_BODY_POSITION');
    near(
      norm(worldRotationVector(pose.q, expected[i]!.q)),
      0,
      1e-12,
      'ACTUAL_ENDPOINT_BODY_ORIENTATION',
    );
  });
}

function rawSchema() {
  return {
    version: 'ASA_COMPOSED_TERRAIN_LE_V1',
    byteOrder: 'little-endian',
    headerBytes: 2048,
    contactBytes: 176,
    headerWords: 109,
    scalarLayout: {
      fromUs: 0,
      toUs: 8,
      actualPreSeconds: 16,
      nativeContacts: 24,
      preQpos10: 32,
      preQvel9: 112,
      preBodyOrigins4x7: 184,
      preNativeTwists4x9: 408,
      electrical22: 696,
    },
    identities: {
      nq,
      nv,
      nbody,
      ngeom,
      geomBodies,
      wheels,
      bodyParents,
      wheelHinges: Array.from(wheelHinges),
    },
    electricalOrder: electricKeys,
    fields: [
      'from,to,actualPREtime,ncon',
      'PREqpos10/qvel9',
      'PREnativeBodyOriginPoses4x7',
      'PREnativeCOM/linear/angular4x9',
      'electrical22 ordered',
    ],
    countsOffset,
    appliedOffset,
    distancesOffset,
    postHashOffset,
    phaseHashOffset,
    supportMasksOffset: 2016,
    paddingOffset: 2020,
    post: 'actual endpoint SHA256 + successor actual PRE bytes; concrete final/abort footer; includes signed zeros',
    endpointHashLayout:
      'F64 seconds,qpos10,qvel9,then all5 native body origin position3/quaternionWxyz4, little-endian; world0 is explicitly checked against the static dictionary',
    contacts:
      'ALL native contacts in native index order;uint16 first,second,types12|exclude3|active1,addrGroup8|index8;21F64 point3/frame9/force3/efcVelocity3/J_PRE*Delta3;132 actual signed distances in header',
    rowDictionary:
      'condim3; each active rowType7 and efc_id=actual contactIndex at address3*activeRank, checked actual PRE and POST before compression. Inactive address=-1 and no rows.',
    bound: rawUpperBytes,
    physical: 'TEST_ONLY_D01_D02_OPEN',
  };
}
function readMetadata(path: string) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line, (_k, v: unknown) => (v === 'float64:-0' ? -0 : v)) as JsonLine);
}
function replayPair(root: string, outcomes: Outcome[]) {
  const bytes = readFileSync(join(root, kindNames.intervals)),
    metadata = readMetadata(join(root, kindNames.meta)),
    profile = sourcePins();
  let offset = 0;
  const replayed = outcomes.map((outcome) => {
    const start = metadata.find((v) => v.kind === 'world-start' && v.world === outcome.world),
      end = metadata.find((v) => v.kind === 'world-end' && v.world === outcome.world),
      resources = metadata.find((v) => v.kind === 'world-resources' && v.world === outcome.world);
    requireThat(
      start && end && resources && start.baseOffset === offset && ints(outcome.step, 22000),
      'REPLAY_WORLD_BOUNDARIES',
    );
    const initial = start.initial as Energy,
      final = end.final as Energy;
    checkEndpointEnergy(initial);
    checkEndpointEnergy(final);
    const witness = new Witness(outcome.world, profile);
    witness.configure(start.readback as ReturnType<typeof widths>);
    let count = 0;
    for (let tick = 0; tick < outcome.step; tick++) {
      requireThat(offset + 2048 <= bytes.length, 'RAW_HEADER_BOUND');
      const n = bytes.readDoubleLE(offset + 24);
      requireThat(ints(n, 132), 'RAW_CONTACT_CAP');
      const size = 2048 + n * 176;
      requireThat(offset + size <= (end.endOffset as number), 'RAW_FRAME_BOUND');
      const raw = bytes.subarray(offset, offset + size),
        head = decodeHead(raw);
      let endpoint: Endpoint;
      if (head.ref === 1) {
        requireThat(offset + size < (end.endOffset as number), 'SUCCESSOR_REQUIRED');
        const nextN = bytes.readDoubleLE(offset + size + 24);
        requireThat(ints(nextN, 132), 'NEXT_CONTACT_CAP');
        const next = decodeHead(bytes.subarray(offset + size, offset + size + 2048 + nextN * 176));
        requireThat(next.from === head.to, 'ACTUAL_SUCCESSOR_CLOCK');
        endpoint = { state: next.pre, poses: next.before };
      } else {
        requireThat(tick === outcome.step - 1, 'ONLY_FINAL_FOOTER_REFERENCE');
        const tail = metadata.find(
          (v) => v.kind === 'endpoint-tail' && v.world === outcome.world && v.to === head.to,
        );
        requireThat(tail, 'CONCRETE_FINAL_ENDPOINT');
        endpoint = { state: tail.state as State, poses: tail.poses as Pose[] };
        requireThat(
          endpointBytes(endpoint).equals(endpointBytes({ state: final.state, poses: final.poses })),
          'INDEPENDENT_ACTUAL_FINAL_ENDPOINT',
        );
      }
      const frame = decodeInterval(raw, endpoint);
      witness.observe(frame, raw);
      count += n;
      offset += size;
    }
    requireThat(offset === end.endOffset, 'EXACT_END_OFFSET');
    const actual = witness.finish(initial, final);
    requireThat(
      JSON.stringify(actual) === JSON.stringify(outcome),
      'REPLAY_ALL_PHYSICAL_AND_ENERGY_OUTCOMES',
    );
    const ledger = resources.ledger as Ledger,
      life = resources.persistentCleanup as Record<string, number>;
    requireThat(
      ledger.step1 === outcome.step &&
        ledger.step1Returned === outcome.step &&
        ledger.step2 === outcome.step &&
        ledger.step2Returned === outcome.step &&
        ledger.force === count &&
        ledger.velocity === (outcome.step + 2) * nbody &&
        ledger.forwards === 2 &&
        ledger.created === ledger.deleted &&
        (resources.cleanup as unknown[]).length === 0,
      'REPLAY_NATIVE_RESOURCE_CENSUS',
    );
    requireThat(
      life.bufferAttempted === 3 &&
        life.bufferDeleted === 3 &&
        life.dataAttempted === 1 &&
        life.dataDeleted === 1 &&
        life.modelAttempted === 1 &&
        life.modelDeleted === 1 &&
        resources.sessionDisposeAttempted === 1 &&
        resources.sessionDisposed === 1,
      'REPLAY_ALL_PERSISTENT_CLOSURES',
    );
    return actual;
  });
  requireThat(offset === bytes.length, 'NO_TRAILING_RAW');
  return { bytes: bytes.length, sha256: hash(bytes), worlds: replayed };
}
function priorAdmission(rawRoot: string, receiptPath: string) {
  requireThat(isAbsolute(rawRoot) && isAbsolute(receiptPath), 'ABSOLUTE_PRIOR_EVIDENCE');
  const binary = pinned(join(rawRoot, f.frozen.priorBinary.file), f.frozen.priorBinary),
    meta = pinned(join(rawRoot, f.frozen.priorMeta.file), f.frozen.priorMeta),
    receiptBytes = pinned(receiptPath, f.frozen.replayReceipt);
  pinned(join(dirname(receiptPath), f.frozen.verifier.file), f.frozen.verifier);
  const checkout = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  for (const key of ['spec', 'fixture'] as const)
    pinned(join(checkout, f.frozen[key].path), f.frozen[key]);
  const r = JSON.parse(receiptBytes.toString()) as Record<string, unknown>;
  verifyPriorReceipt(r);
  const oldLines = meta
      .toString()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JsonLine),
    finish = oldLines.find((v) => v.kind === 'finish');
  requireThat(
    finish?.runtime === 'COMPLETE' &&
      finish.physical === 'PASS' &&
      finish.energyBudget === 'PASS' &&
      binary.length === 145827456,
    'PRIOR_ACTUAL_COMPLETE_TRACE',
  );
  return {
    receipt: f.frozen.replayReceipt,
    verifier: f.frozen.verifier,
    source: f.frozen.source,
    binary: f.frozen.priorBinary,
    metadata: f.frozen.priorMeta,
    independent: r,
    noLegacyExecution: true,
  };
}

it.skipIf(!nativeMode)(
  'acquires the one composed-terrain real Arduino powered and LOW native pair',
  async () => {
    const root = externalReceiptRoot(process.env['ASA_TT_TERRAIN_OUTPUT'] ?? '');
    const journal = new Journal(root);
    const census: Census = {
      modelAttempted: 0,
      modelReturned: 0,
      dataAttempted: 0,
      dataReturned: 0,
      step1: 0,
      step1Returned: 0,
      step2: 0,
      step2Returned: 0,
      sessionsDisposed: 0,
    };
    let initialized = false,
      physical = 'UNRESOLVED',
      energyBudget = 'UNRESOLVED',
      failure: unknown;
    try {
      requireThat(
        nativeMode && !process.env['ASA_TT_SPHERE_NATIVE'],
        'ONLY_NEW_TERRAIN_ACQUISITION',
      );
      requireThat(
        rawUpperBytes === 257949184 && rawSchema().headerWords === 109,
        'REGISTERED_COMPLETE_CAPTURE',
      );
      const sources = exactSourcePins(),
        profile = sourcePins();
      const prior = priorAdmission(
        process.env['ASA_TT_TERRAIN_PRIOR_RAW'] ?? '',
        process.env['ASA_TT_TERRAIN_PRIOR_REPLAY'] ?? '',
      );
      const runtimeSources = f.nativeRuntimeSources.map((entry) => {
        pinned(resolve(fileURLToPath(new URL('../../../', import.meta.url)), entry.path), entry);
        return entry;
      });
      const circuits = Object.fromEntries(
        (['powered', 'control'] as const).map((world) => [
          world,
          hash(JSON.stringify(buildCircuit(world))),
        ]),
      );
      requireThat(
        JSON.stringify(circuits) === JSON.stringify(f.circuitSha256),
        'PURE_CIRCUIT_PINS_BEFORE_NATIVE',
      );
      const pureGpio = Object.fromEntries(
        (['powered', 'control'] as const).map((world) => {
          const events = pureUno(world, 256);
          requireThat(
            JSON.stringify(events) === JSON.stringify(f.programs[world].gpio),
            'ACTUAL_PURE_GPIO_BEFORE_NATIVE',
          );
          return [world, events];
        }),
      );
      const engine = enginePins(process.env['ASA_TT_TERRAIN_ENGINE'] ?? '');
      journal.write({
        kind: 'header',
        scope: f.id,
        prior,
        sources,
        runtimeSources,
        fixture: f,
        schema: rawSchema(),
        circuitHashes: circuits,
        pureGpio,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        nativeInitialized: false,
        initialization,
        census,
      });
      fsyncSync(journal.meta);
      const header = readFileSync(join(root, kindNames.meta));
      const decodedHeader = JSON.parse(header.toString()) as {
        sources: unknown;
        runtimeSources: unknown;
        fixture: typeof f;
        schema: { version: string };
      };
      requireThat(
        header.length === journal.metadataBytes &&
          JSON.stringify(decodedHeader.sources) === JSON.stringify(sources) &&
          JSON.stringify(decodedHeader.runtimeSources) === JSON.stringify(runtimeSources) &&
          decodedHeader.fixture.xmlSha256 === f.xmlSha256 &&
          decodedHeader.schema.version === rawSchema().version,
        'ON_DISK_HEADER_PINS_BEFORE_NATIVE',
      );
      journal.write({
        kind: 'header-readback',
        bytes: header.length,
        sha256: hash(header),
        nativeInitialized: false,
        initialization,
        census,
      });
      const M = await loadNative(engine);
      initialized = true;
      const powered = dynamicWorld(M, 'powered', journal, profile, census);
      const control = dynamicWorld(M, 'control', journal, profile, census);
      requireThat(
        powered.prefix.intervals === comparison.prefixIntervals &&
          powered.prefix.throughUs === comparison.interventionUs &&
          control.prefix.throughUs === comparison.interventionUs &&
          powered.prefix.lastFromUs === comparison.lastLegacyFromUs &&
          control.prefix.lastFromUs === comparison.lastLegacyFromUs &&
          control.prefix.intervals === comparison.prefixIntervals &&
          powered.prefix.sha256 === control.prefix.sha256,
        'EXACT_NEW_SCENE_COMMON_PREFIX',
      );
      requireThat(
        census.step1 === census.step1Returned &&
          census.step2 === census.step2Returned &&
          census.step2 === powered.step + control.step &&
          census.sessionsDisposed === 2,
        'PAIR_NATIVE_LIFETIME_CENSUS',
      );
      fsyncSync(journal.bin);
      const replay = replayPair(root, [powered, control]);
      physical =
        powered.physical === 'FAIL' || control.physical === 'FAIL'
          ? 'FAIL'
          : powered.physical === 'NOT_REACHED'
            ? 'NOT_REACHED'
            : 'PASS';
      energyBudget =
        powered.energy.budgetAccepted && control.energy.budgetAccepted ? 'PASS' : 'FAIL';
      journal.write(
        {
          kind: 'finish',
          runtime: 'COMPLETE',
          acquisition: 'CONSUMED',
          physical,
          energyBudget:
            powered.energy.budgetAccepted && control.energy.budgetAccepted ? 'PASS' : 'FAIL',
          formalAcceptance: 'D01_D02_OPEN',
          causal:
            powered.energy.causal === 'GAP' || control.energy.causal === 'GAP'
              ? 'GAP'
              : 'NO_NEW_GAP_OBSERVED',
          historicalR5Causal: 'GAP_CAUSAL_ALT',
          initialized,
          initialization,
          census,
          outcomes: [powered, control],
          replay,
          binary: { bytes: journal.binaryBytes, sha256: journal.digest.copy().digest('hex') },
        },
        true,
      );
    } catch (error) {
      failure = error;
      try {
        journal.write(
          {
            kind: 'first-error',
            runtime: 'ERROR',
            physical: 'UNRESOLVED',
            acquisition: census.step1 > 0 || census.step2 > 0 ? 'CONSUMED' : 'PRE_DISPATCH',
            initialized,
            census,
            error: String(error),
            binary: { bytes: journal.binaryBytes, sha256: journal.digest.copy().digest('hex') },
          },
          true,
        );
      } catch (receiptError) {
        failure = Object.assign(error instanceof Error ? error : new Error(String(error)), {
          receiptError: String(receiptError),
        });
      }
    } finally {
      const closed = journal.close();
      if (closed.length) failure ??= new Error('RECEIPT_CLOSE ' + closed.join('; '));
    }
    if (failure) throw failure;
    expect(physical).toBe('PASS');
    expect(energyBudget).toBe('PASS');
  },
  360000,
);

function verifyPriorReceipt(r: Record<string, unknown>) {
  const source = r.source as Record<string, unknown>,
    inputs = r.inputs as Record<string, unknown>,
    pair = r.pair as Record<string, unknown>,
    verdict = r.verdict as Record<string, unknown>,
    verifier = r.verifier as Record<string, unknown>;
  const compare = (a: unknown, b: { bytes: number; sha256: string }) => {
    const v = a as Record<string, unknown>;
    return v.bytes === b.bytes && v.sha256 === b.sha256;
  };
  requireThat(
    r.schema === 'ASA_INDEPENDENT_SPHERE_REPLAY_V1' &&
      r.audit === 'PURE_OFFLINE_NO_NATIVE' &&
      source.commit === f.frozen.source &&
      compare(source.spec, f.frozen.spec) &&
      compare(source.fixture, f.frozen.fixture) &&
      compare(inputs.binary, f.frozen.priorBinary) &&
      compare(inputs.jsonl, f.frozen.priorMeta) &&
      compare(verifier, f.frozen.verifier),
    'PRIOR_RECEIPT_SOURCE_RAW_VERIFIER_LINK',
  );
  const prefix = pair['503_prefix'] as Record<string, unknown>;
  requireThat(
    pair.world_count === 2 &&
      pair.interval_count === 40180 &&
      pair.first_us === 0 &&
      pair.last_us === 10000000 &&
      prefix.interval_count === 503 &&
      prefix.last_from_us === 250000 &&
      prefix.through_us === 250003 &&
      prefix.sha256 === f.frozen.prefixSha256 &&
      prefix.equal === true,
    'PRIOR_COMPLETE_PAIRED_PREFIX',
  );
  requireThat(
    ['audit', 'physical', 'prefix', 'momentum', 'energy', 'control'].every(
      (k) => verdict[k] === 'PASS',
    ) &&
      verdict.causal === 'GAP_PRESERVED' &&
      verdict.no_native === true &&
      verdict.scope_limit === 'ARCHIVED_SPHERE_PAIR_ONLY_D01_D02_OPEN',
    'PRIOR_VERDICT_BOUNDARY',
  );
  const worlds = r.per_world as Record<string, unknown>[];
  requireThat(
    worlds.length === 2 &&
      worlds[0]!.id === 'powered' &&
      worlds[1]!.id === 'control' &&
      worlds.every(
        (v) =>
          v.interval_count === 20090 &&
          v.first_us === 0 &&
          v.last_us === 10000000 &&
          [
            'clock',
            'continuity',
            'census',
            'contact_sign',
            'gpio',
            'momentum',
            'energy',
            'physical',
            'resources',
          ].every((k) => (v.checks as Record<string, unknown>)[k] === 'PASS'),
      ),
    'PRIOR_BOTH_WHOLE_WORLD_REPLAYS',
  );
}

function syntheticFrame(): Frame {
  const pre = initialState(),
    post = structuredClone(pre);
  post.seconds = 0.0005;
  const before = posesFromState(pre),
    after = posesFromState(post),
    circuit = Object.fromEntries(electricKeys.map((k) => [k, 0])) as Electrical;
  return {
    from: 0,
    to: 500,
    pre,
    post,
    before,
    after,
    circuit,
    contacts: [],
    census: { nativeRowCount: 0, identities: [] },
    phaseHash: hash(stateBytes(pre)),
    kinematics: before.map((p) => ({
      com: p.p,
      velocity: [0, 0, 0] as Vec,
      omega: [0, 0, 0] as Vec,
    })),
  };
}
function syntheticContacts(frame: Frame, inactive = false) {
  const contacts = wheels.map((wheel, index): Entry => {
    const point = wheelPoint(frame, wheel, [0, 0, 0]).centre;
    point[2] -= 0.03;
    return {
      first: 0,
      second: wheel,
      index,
      address: inactive && index === 0 ? -1 : 3 * (index - (inactive ? 1 : 0)),
      exclude: inactive && index === 0 ? 1 : 0,
      distance: -0.000001,
      rowTypes: inactive && index === 0 ? 0 : 0x777,
      point,
      frame: [0, 0, 1, 1, 0, 0, 0, 1, 0],
      force: inactive && index === 0 ? [0, -0, 0] : [1, 0, 0],
      velocity: [0, -0, 0],
      jacDelta: [0, 0, -0],
    };
  });
  frame.contacts = contacts;
  frame.census = {
    nativeRowCount: 3 * contacts.filter((v) => v.address >= 0).length,
    identities: contacts.map((c) => ({
      first: c.first,
      second: c.second,
      exclude: c.exclude,
      active: c.address >= 0,
      distance: c.distance,
    })),
  };
  return frame;
}
it('pins the unchanged R5 rover, pure public circuits, real Uno GPIO at1/256 and independent archive truth without Git or native', () => {
  sourcePins();
  const checkout = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  for (const key of ['spec', 'fixture'] as const)
    pinned(join(checkout, f.frozen[key].path), f.frozen[key]);
  expect(hash(f.frozen.replayReceipt.utf8)).toBe(f.frozen.replayReceipt.sha256);
  verifyPriorReceipt(JSON.parse(f.frozen.replayReceipt.utf8));
  for (const world of ['powered', 'control'] as const) {
    expect(hash(JSON.stringify(buildCircuit(world)))).toBe(f.circuitSha256[world]);
    expect(pureUno(world, 1)).toEqual(f.programs[world].gpio);
    expect(pureUno(world, 256)).toEqual(f.programs[world].gpio);
  }
});
it('constructs exactly five disjoint closed volumes with shared plan/profile edges and signed descent normals', () => {
  const terrain = terrainGeometry();
  expect(terrain).toHaveLength(5);
  expect(terrain.reduce((a, v) => a + v.volume, 0)).toBeCloseTo(0.99 + 1.2 * f.geometry.height, 14);
  expect(terrain[1]!.normal[0]).toBeLessThan(0);
  expect(terrain[3]!.normal[0]).toBeGreaterThan(0);
  expect(terrainTop(1, [0.4, 0, f.geometry.height / 2])).toBe(true);
  expect(terrainTop(3, [1.6, 0, f.geometry.height / 2])).toBe(true);
  expect(terrainTop(2, [1, 0, 0])).toBe(false);
  expect(terrainTop(2, [1, 0.51, f.geometry.height])).toBe(false);
  expect(terrainTop(3, [1.19, 0, f.geometry.height])).toBe(false);
  expect(
    completeEnvelope(posesFromState(initialState())).every((v) =>
      v.intervals.every((p) => Number.isFinite(p.center + p.halfWidth)),
    ),
  ).toBe(true);
  expect(
    bodyClearances(posesFromState(initialState()))
      .flat()
      .every((v) => v > 0),
  ).toBe(true);
  const input = {
    lengthMeters: 0.8,
    widthMeters: 1,
    riseMeters: f.geometry.height,
    baseThicknessMeters: 0.05,
    originMeters: [0, 0, 0] as Vec,
    headingRadians: 0,
  };
  for (const bad of [
    { ...input, lengthMeters: 0 },
    { ...input, widthMeters: -1 },
    { ...input, riseMeters: -1 },
    { ...input, baseThicknessMeters: NaN },
  ])
    expect(() => createEditableRampGeometry(bad)).toThrow();
});
it('freezes a priori Float32/Float64 mesh error and rejects wrong transform/ABI shapes without native', () => {
  expect(ulp32(20)).toBe(2 ** -19);
  expect(ulp32(0)).toBe(2 ** -149);
  const budget = compiledVertexBudget(
    [10.5, 0, -0.025],
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [8.5, 0.5, 0.025],
  );
  expect(budget.every((v) => v > 0 && v < 0.000002)).toBe(true);
  expect(() => compiledVertexBudget([0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], [21, 0, 0])).toThrow(
    'COMPILED_LOCAL_VERTEX_BOUND',
  );
  expect(() => floatView(new Float64Array(ngeom * 6 - 1), ngeom * 6, 'geom_surfacevel')).toThrow(
    'geom_surfacevel',
  );
  expect(() => floatView(new Float32Array(3), 3, 'wrong')).toThrow();
  expect(() => intView(new Int32Array(4), 5, 'count')).toThrow();
});
it('retains inactive geometry/row identity and every signed F64, with exact actual POST and phase backreferences', () => {
  const frame = syntheticContacts(syntheticFrame(), true),
    endpoint = { state: frame.post, poses: frame.after },
    raw = encodeInterval(frame, endpoint),
    decoded = decodeInterval(raw, endpoint);
  expect(raw.length).toBe(2048 + 4 * 176);
  expect(encodeInterval(decoded, endpoint).equals(raw)).toBe(true);
  expect(decoded.contacts[0]!.address).toBe(-1);
  expect(decoded.contacts[0]!.exclude).toBe(1);
  expect(Object.is(decoded.contacts[0]!.force[1], -0)).toBe(true);
  const bad = structuredClone(endpoint);
  bad.state.qpos[1] = -0;
  expect(() => encodeInterval(frame, bad)).toThrow('EXACT_ACTUAL_POST_SUCCESSOR_BYTES');
  expect(() => decodeInterval(raw, bad)).toThrow('ACTUAL_POST_BACKREFERENCE_HASH');
  const rotation = structuredClone(endpoint);
  rotation.poses[1]!.q = rotation.poses[1]!.q.map((v) => -v) as Quat;
  expect(() => decodeInterval(raw, rotation)).toThrow('BACKREFERENCE');
  const altered = Buffer.from(raw);
  altered[phaseHashOffset] = altered[phaseHashOffset]! ^ 1;
  expect(() => decodeInterval(altered, endpoint)).toThrow('ACTUAL_PHASE_HASH');
  const census = structuredClone(frame);
  census.census.nativeRowCount++;
  expect(() => encodeInterval(census, endpoint)).toThrow('ORPHAN');
  const lost = structuredClone(frame);
  lost.contacts.shift();
  expect(() => encodeInterval(lost, endpoint)).toThrow('CENSUS');
});
it('never hides an invalid loaded side row behind another valid wheel support and preserves signed normal direction', () => {
  const frame = syntheticContacts(syntheticFrame());
  expect(supportLabels(frame).masks).toEqual([1, 1, 1, 1]);
  expect(supportLabels(frame).failures).toEqual([]);
  const valid = structuredClone(frame.contacts[0]!),
    bad = structuredClone(valid);
  bad.point[2] = 0.03;
  bad.point[0] += 0.03;
  frame.contacts.push(bad);
  expect(supportLabels(frame).masks[0]).toBe(1);
  expect(supportLabels(frame).failures).toContain('INVALID_LOADED_WHEEL_TOP_FACE');
  frame.contacts = [valid];
  valid.first = names.rearLeft;
  valid.second = 0;
  valid.frame = [0, 0, -1, 1, 0, 0, 0, -1, 0];
  expect(supportLabels(frame).masks[0]).toBe(1);
});
it('rejects fabricated wheel labels, missing routes and naive finite-chord/contact tangent equality', () => {
  const frame = syntheticContacts(syntheticFrame()),
    bytes = encodeInterval(frame, { state: frame.post, poses: frame.after }),
    witness = new Witness('powered', sourcePins());
  witness.configure({ masses: [0, 0.44, 0.08, 0.04, 0.04] } as ReturnType<typeof widths>);
  const forged = Buffer.from(bytes);
  forged[2016] = 0;
  expect(() => witness.observe(frame, forged)).toThrow('RECOMPUTED_INDIVIDUAL_WHEEL_LABELS');
  const clean = new Witness('control', sourcePins());
  clean.configure({ masses: [0, 0.44, 0.08, 0.04, 0.04] } as ReturnType<typeof widths>);
  clean.observe(frame, bytes);
  expect(clean.step).toBe(1);
  const point: Vec = [0.03, 0, 0.03],
    post = structuredClone(frame.post);
  post.qpos[7] = 0.5;
  const moving = { ...frame, post, after: posesFromState(post) };
  const motion = preparePointMotion(moving),
    body = motion[2]!,
    parts = pointTangentAndRemainder(point, body);
  expect(parts.remainder).toBeGreaterThan(0);
  expect(norm(parts.tangent)).toBeGreaterThan(0);
});
it('binds independent receipt source, full40180 interval pair, both outcomes and historic causal gap fail-closed', () => {
  const receipt = JSON.parse(f.frozen.replayReceipt.utf8) as Record<string, unknown>;
  verifyPriorReceipt(receipt);
  for (const change of [
    (v: Record<string, unknown>) => {
      (v.pair as Record<string, unknown>).interval_count = 40179;
    },
    (v: Record<string, unknown>) => {
      (v.verdict as Record<string, unknown>).causal = 'PASS';
    },
    (v: Record<string, unknown>) => {
      ((v.per_world as Record<string, unknown>[])[1]!.checks as Record<string, unknown>).resources =
        'FAIL';
    },
    (v: Record<string, unknown>) => {
      (v.source as Record<string, unknown>).commit = 'old';
    },
  ]) {
    const bad = structuredClone(receipt);
    change(bad);
    expect(() => verifyPriorReceipt(bad)).toThrow();
  }
});
it('rejects stale shaft token/time/phase before physical dispatch through the actual public pure session', () => {
  const session = createElectronicsTtNativeDriveTestSession(buildCircuit('powered'), {
    componentId: motorId,
    port,
    runId: 'terrain-seams:powered',
    generation: 1,
    requestedHorizonMicroseconds: 10000000,
    maxEvents: 256,
  });
  try {
    let query = session.step();
    for (let i = 0; i < 100 && query?.kind === 'working'; i++) query = session.step();
    requireThat(query?.kind === 'shaft-start', 'PURE_SHAFT_START');
    validateShaftQuery(query, 'powered', 1);
    const reply = shaftReply(query, shaftValue(initialState()));
    expect(session.respond({ ...reply, token: Symbol('forged') })).toBe(false);
    expect(session.respond({ ...reply, sequence: query.sequence + 1 })).toBe(false);
    expect(session.lastCommitted().committedHorizonMicroseconds).toBe(0);
    expect(session.respond(reply)).toBe(true);
    expect(session.lastCommitted().committedHorizonMicroseconds).toBe(0);
  } finally {
    session.dispose();
  }
});
it('reserves the full bounded native census before STEP2 and keeps footer/closure separate from first errors', () => {
  expect(rawUpperBytes).toBe(257949184);
  expect(rawUpperBytes).toBeLessThan(268435456);
  expect(headerWords * 8).toBe(872);
  expect(phaseHashOffset + 32).toBe(2016);
  const root = mkdtempSync(join(tmpdir(), 'asa-terrain-capture-pure-')),
    journal = new Journal(root);
  try {
    journal.reserveHeader();
    Object.assign(journal, { contacts: 449999 });
    expect(() => journal.reserve(2)).toThrow('GAP_CAPTURE');
    expect(journal.binaryBytes).toBe(0);
  } finally {
    expect(journal.close()).toEqual([]);
    unlinkSync(join(root, kindNames.meta));
    unlinkSync(join(root, kindNames.intervals));
    rmdirSync(root);
  }
});
it('borrows warning vector and releases only all seven owned entry copies, preserving cleanup failures', () => {
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
    },
    ledger = newLedger();
  warnings({ warning } as unknown as Data, ledger);
  expect([vectorDeletes, copies, ledger.created, ledger.deleted]).toEqual([0, 7, 7, 7]);
  const broken = {
      ...warning,
      get: () => ({
        number: 0,
        lastinfo: 0,
        delete: () => {
          throw new Error('copy-delete');
        },
      }),
    },
    bad = newLedger();
  expect(() => warnings({ warning: broken } as unknown as Data, bad)).toThrow(
    'WARNING_COPY_CLEANUP_FAILED',
  );
  expect(bad.cleanupErrors).toHaveLength(7);
  expect(vectorDeletes).toBe(0);
});
it.skipIf(!process.env['ASA_TT_TERRAIN_ENGINE'] || !process.env['ASA_TT_TERRAIN_LICENSE'])(
  'checks exact AOT assets without importing engine',
  () => {
    expect(enginePins(process.env['ASA_TT_TERRAIN_ENGINE']!).wasm.length).toBe(11229000);
  },
);
it.skipIf(!process.env['ASA_TT_TERRAIN_PRIOR_RAW'] || !process.env['ASA_TT_TERRAIN_PRIOR_REPLAY'])(
  'links full immutable old raw to independently regenerated pure replay without importing old test/engine',
  () => {
    expect(
      priorAdmission(
        process.env['ASA_TT_TERRAIN_PRIOR_RAW']!,
        process.env['ASA_TT_TERRAIN_PRIOR_REPLAY']!,
      ).source,
    ).toBe(f.frozen.source);
  },
);

function matchingActualEndpoint(expectedHash: string, candidates: (Endpoint | undefined)[]) {
  return candidates.find(
    (value): value is Endpoint =>
      value !== undefined && hash(endpointBytes(value)) === expectedHash,
  );
}

function missingRoute(
  dossier: { id: number; firstBySurface: (number | null)[] }[],
  windows: (TerrainWindow | null)[],
  mixed: unknown[],
  rise: number,
  fall: number,
) {
  const missing: string[] = [];
  for (const d of dossier)
    if (d.firstBySurface.some((v) => v === null))
      missing.push('WHEEL_' + d.id + '_INCOMPLETE_ROUTE');
  for (const i of [1, 2, 4]) if (!windows[i]) missing.push('MISSING_100MS_SURFACE_' + i);
  if (mixed.some((v) => v === null)) missing.push('MISSING_MIXED_SEAM');
  if (rise < 0.06) missing.push('RISE_BELOW_60MM');
  if (fall < 0.06) missing.push('FALL_BELOW_60MM');
  return missing;
}
it('uses the exact frozen signed MNA/shaft/work/ownership math without importing or executing the old spec', () => {
  const old = readFileSync(
      new URL('./arduino-tt-sphere-push.spec.ts', import.meta.url),
      'utf8',
    ).replaceAll('\r\n', '\n'),
    current = readFileSync(sourceUrl, 'utf8').replaceAll('\r\n', '\n');
  expect(Buffer.byteLength(old)).toBe(f.frozen.spec.bytes);
  expect(hash(old)).toBe(f.frozen.spec.sha256);
  const slice = (text: string, name: string) => {
    const start = text.indexOf('function ' + name + '('),
      end = text.indexOf('\n}\n', start);
    requireThat(start >= 0 && end > start, 'FROZEN_FUNCTION_BOUNDARY_' + name);
    return text.slice(start, end + 2);
  };
  for (const name of [
    'pureUno',
    'readElectrical',
    'release',
    'warnings',
    'action',
    'endpointEnergy',
    'checkEndpointEnergy',
    'contactPointVelocity',
    'bodyVelocities',
    'preConstraints',
    'worldRotationVector',
    'pointTangentAndRemainder',
    'boxProjection',
    'cylinderProjection',
    'pairWork',
    'workAgreement',
    'isPair',
    'forceOn',
    'gearbox',
    'gearInput',
    'appliedShaft',
    'gammaBound',
    'signedTransmission',
    'windingBalance',
    'shaftValue',
    'shaftReply',
    'exactShaftSample',
  ])
    expect(slice(current, name), name).toBe(slice(old, name));
  expect(() => assertNativeAdmission(false, 0)).toThrow('EXPLICIT_TERRAIN_NATIVE_ADMISSION');
  expect(() => assertNativeAdmission(true, 1)).toThrow('EXPLICIT_TERRAIN_NATIVE_ADMISSION');
  expect(() => assertNativeAdmission(true, 0)).not.toThrow();
});
it('requires every wheel and mixed seam in order, with real100ms platform/terminal windows and60mm elevation gates', () => {
  const dossier = wheels.map((id) => ({ id, firstBySurface: [1, 2, 3, 4, 5] })),
    w = { from: 0, to: 100000, minimumZ: 0, maximumZ: 0 },
    windows = Array(5).fill(w),
    mixed = Array(4).fill({});
  expect(missingRoute(dossier, windows, mixed, 0.06, 0.06)).toEqual([]);
  const absent = structuredClone(dossier) as { id: number; firstBySurface: (number | null)[] }[];
  absent[0]!.firstBySurface[3] = null;
  expect(missingRoute(absent, windows, mixed, 0.06, 0.06)).toContain('WHEEL_7_INCOMPLETE_ROUTE');
  windows[4] = null;
  expect(missingRoute(dossier, windows, mixed, 0.06, 0.06)).toContain('MISSING_100MS_SURFACE_4');
  expect(missingRoute(dossier, windows, mixed, 0.059999, 0.06)).toContain('RISE_BELOW_60MM');
  expect(missingRoute(dossier, windows, mixed, 0.06, 0.059999)).toContain('FALL_BELOW_60MM');
});
it('roundtrips consecutive captured native endpoints and concrete terminal/abort tails without sign-zero normalization', () => {
  const first = syntheticContacts(syntheticFrame()),
    second = syntheticContacts(syntheticFrame());
  second.from = 500;
  second.to = 1000;
  second.pre = structuredClone(first.post);
  second.post = structuredClone(second.pre);
  second.post.seconds = 0.001;
  second.before = posesFromState(second.pre);
  second.after = posesFromState(second.post);
  second.phaseHash = hash(stateBytes(second.pre));
  const successor = { state: second.pre, poses: second.before },
    tail = { state: second.post, poses: second.after },
    a = encodeInterval(first, successor),
    b = encodeInterval(second);
  expect(decodeHead(a).ref).toBe(1);
  expect(decodeHead(b).ref).toBe(2);
  const next = decodeHead(b),
    decoded = decodeInterval(a, { state: next.pre, poses: next.before });
  expect(
    endpointBytes({ state: decoded.post, poses: decoded.after }).equals(endpointBytes(successor)),
  ).toBe(true);
  expect(encodeInterval(decodeInterval(b, tail)).equals(b)).toBe(true);
  const actualHash = a.subarray(postHashOffset, postHashOffset + 32).toString('hex'),
    wrong = structuredClone(successor);
  wrong.poses[2]!.q[0] = -wrong.poses[2]!.q[0];
  expect(matchingActualEndpoint(actualHash, [wrong, successor])).toBe(successor);
  expect(matchingActualEndpoint(actualHash, [wrong])).toBeUndefined();
  const future = Buffer.from(b);
  future[32 + 10 * 8] = future[32 + 10 * 8]! ^ 128;
  const mutated = decodeHead(future);
  expect(() => decodeInterval(a, { state: mutated.pre, poses: mutated.before })).toThrow(
    'BACKREFERENCE_HASH',
  );
});

it('preserves fixed-horizontal-length angle edits and rotated metric plan/profile without claiming new physical slope cases', () => {
  expect(rampRiseForAngle(0.8, (5 * Math.PI) / 180)).toBe(f.geometry.height);
  for (const [L, W, degrees] of [
    [0.8, 1, 5],
    [1.2, 0.4, 15],
    [0.4, 2, 0],
  ] as const) {
    const H = rampRiseForAngle(L, (degrees * Math.PI) / 180),
      g = createEditableRampGeometry({
        lengthMeters: L,
        widthMeters: W,
        riseMeters: H,
        baseThicknessMeters: 0.05,
        originMeters: [1, -2, 0.1],
        headingRadians: 0.7,
      });
    expect(g.angleRadians).toBeCloseTo((degrees * Math.PI) / 180, 15);
    expect(g.slopingLengthMeters).toBe(Math.hypot(L, H));
    expect(g.volumeCubicMeters).toBe(L * W * (0.05 + H / 2));
    expect(dot(vec(g.tangent), vec(g.normal))).toBeCloseTo(0, 15);
    expect(norm(vec(g.upslope))).toBeCloseTo(1, 15);
    expect(g.profile[2]).toEqual([L, H]);
  }
  expect(() => rampRiseForAngle(0.8, Math.PI / 2)).toThrow('RAMP_ANGLE_RANGE');
  expect(() => rampRiseForAngle(Number.MIN_VALUE, 0.5)).toThrow('RAMP_ANGLE_UNREPRESENTABLE');
});
it('admits actual compiled-mesh ABI shapes and rejects a seam gap, reversed face, duplicate hull or wrong scalar width before any advance', () => {
  const make = () => {
    const vertices = new Float32Array(physics.terrain.flatMap((t) => t.vertices.flat())),
      faces = new Int32Array(physics.terrain.flatMap((t) => t.faces.flat())),
      model = {
        mesh_vert: vertices,
        mesh_face: faces,
        mesh_vertadr: Int32Array.from([0, 8, 16, 24, 32]),
        mesh_vertnum: Int32Array.from([8, 8, 8, 8, 8]),
        mesh_faceadr: Int32Array.from([0, 12, 24, 36, 48]),
        mesh_facenum: Int32Array.from([12, 12, 12, 12, 12]),
        geom_dataid: Int32Array.from([0, 1, 2, 3, 4, -1, -1, -1, -1, -1, -1]),
      } as unknown as Model;
    const data = {
      geom_xpos: new Float64Array(33),
      geom_xmat: Float64Array.from(
        Array.from({ length: 11 }, () => [1, 0, 0, 0, 1, 0, 0, 0, 1]).flat(),
      ),
    } as unknown as Data;
    return { model, data, vertices, faces };
  };
  const valid = make();
  expect(assertMesh(valid.model, valid.data).seams).toHaveLength(4);
  const gap = make();
  gap.vertices[15]! += 0.001;
  expect(() => assertMesh(gap.model, gap.data)).toThrow('COMPILED_VERTEX_BIJECTION');
  const reversed = make();
  [reversed.faces[0], reversed.faces[1]] = [reversed.faces[1]!, reversed.faces[0]!];
  expect(() => assertMesh(reversed.model, reversed.data)).toThrow('COMPILED_OUTWARD_HULL');
  const duplicate = make();
  (duplicate.model.geom_dataid as Int32Array)[1] = 0;
  expect(() => assertMesh(duplicate.model, duplicate.data)).toThrow('ONE_CLOSED_MESH_PER_VOLUME');
  const width = make();
  width.model.mesh_vert = new Float64Array(120);
  expect(() => assertMesh(width.model, width.data)).toThrow('FIVE_COMPILED_MESH_SHAPES');
});

function assertNativeAdmission(enabled: boolean, attempts: number) {
  requireThat(enabled && attempts === 0, 'EXPLICIT_TERRAIN_NATIVE_ADMISSION');
}

it.skipIf(
  !process.env['ASA_TT_TERRAIN_FIXTURE_SHA256'] || !process.env['ASA_TT_TERRAIN_SOURCE_SHA256'],
)('dry-preflights current exact source and fixture pins without native import', () => {
  expect(exactSourcePins()).toHaveLength(2);
});
