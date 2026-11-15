import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
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
import accepted from './arduino-tt-native-drive.fixture.json';
import f from './arduino-tt-rover-ramp-can.fixture.json';

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
  point: Vec;
  frame: number[];
  force: Vec;
  velocity: Vec;
  jacDelta: Vec;
};
type ContactIdentity = { first: number; second: number; exclude: number; active: boolean };
type ContactCensus = { identities: ContactIdentity[]; nativeRowCount: number };
type Frame = {
  from: number;
  to: number;
  pre: State;
  post: State;
  before: Pose[];
  after: Pose[];
  circuit: Electrical;
  contacts: Entry[];
  census: ContactCensus;
  kinematics: ReturnType<typeof bodyVelocities>;
};

const xml = f.xml.join('\n') + '\n';
const eng = f.engine;
const physics = f.physical;
const limits = physics.limits;
const budgets = f.budgets;
const cap = f.raw;
const nq = 17;
const nv = 15;
const nbody = 6;
const ngeom = 10;
const axleQ = f.expected.qposAdr[1]!;
const axleV = f.expected.dofAdr[1]!;
const names = {
  lower: 0,
  slope: 1,
  upper: 2,
  chassis: 3,
  bumper: 4,
  rearLeft: 5,
  rearRight: 6,
  frontLeft: 7,
  frontRight: 8,
  can: 9,
} as const;
const wheels = [names.rearLeft, names.rearRight, names.frontLeft, names.frontRight];
const terrainGeoms: readonly number[] = [names.lower, names.slope, names.upper];
const geomBodies = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5];
const canBody = 5;
const canOffset = physics.can.comHeight - physics.can.height / 2;
const ids = ['uno', 'battery', 'left-motor', 'left-fet', 'left-flyback'] as const;
const motorId = ids[2];
const port = 'tt-left-output';
const selectedMotor = BRUSHED_MOTOR_ASSEMBLY_PROFILES.find(
  (item) => item.profileId === f.motor.profileId,
);
const fixtureUrl = new URL('./arduino-tt-rover-ramp-can.fixture.json', import.meta.url);
const sourceUrl = new URL(import.meta.url);
const nativeMode = process.env['ASA_TT_ROVER_NATIVE'];
const receiptMode = process.env['ASA_TT_ROVER_REPLAY'];
const secondsPerMicrosecond = 1e-6;
const radians = (d: number) => (d * Math.PI) / 180;
const nSlope: Vec = [-Math.sin(radians(5)), 0, Math.cos(radians(5))];
const up: Vec = [0, 0, 1];
const alongRamp: Vec = [Math.cos(radians(5)), 0, Math.sin(radians(5))];
const worldPose: Pose = { p: [0, 0, 0], q: [1, 0, 0, 0] };
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
function terrainNormal(geom: number): Vec {
  return geom === names.slope ? nSlope : up;
}
function topPoint(geom: number, point: Vec) {
  const yOk = Math.abs(point[1]) <= physics.terrain.halfY;
  if (!yOk) return false;
  if (geom === names.slope) {
    const normalDistance = dot(point, nSlope);
    const projected = sub(point, scale(nSlope, normalDistance));
    return (
      Math.abs(normalDistance) <= limits.faceDistanceM &&
      projected[0] >= 0 &&
      projected[0] <= physics.terrain.slope[1]!
    );
  }
  const extent = geom === names.lower ? physics.terrain.lower : physics.terrain.upper;
  const level = geom === names.lower ? 0 : physics.terrain.height;
  return (
    Math.abs(point[2] - level) <= limits.faceDistanceM &&
    point[0] >= extent[0]! &&
    point[0] <= extent[1]!
  );
}
function canCom(pose: Pose) {
  return add(pose.p, rotate(pose.q, [0, 0, canOffset]));
}
function canTwist(pose: Pose) {
  const axis = rotate(pose.q, up);
  return {
    upright: Math.atan2(norm(cross(axis, up)), axis[2]),
    tip: Math.atan2(Math.hypot(axis[0], axis[1]), axis[2]),
    axis,
  };
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
  const events: readonly Gpio[] = f.programs[world].gpio;
  const match = events.filter((e) => e.kind === 'output-change' && e.atMicroseconds <= from).at(-1);
  return finite(match?.voltageVolt, 'LOGICAL_GPIO_AT_LEFT_EDGE');
}
function sourcePins() {
  requireThat(selectedMotor, 'CANONICAL_TT_PROFILE');
  const acceptedBytes = readFileSync(
    new URL('./arduino-tt-native-drive.fixture.json', import.meta.url),
  );
  const acceptedSource = readFileSync(
    new URL('./arduino-tt-native-drive.spec.ts', import.meta.url),
  );
  requireThat(
    hash(acceptedBytes) === f.acceptedTt.fixtureSha256 &&
      hash(acceptedSource) === f.acceptedTt.sourceSha256,
    'ACCEPTED_TT_SOURCE_PINS',
  );
  requireThat(
    hash(xml) === f.xmlSha256 && f.programs.powered.source === accepted.unoReference.source,
    'REGISTERED_XML_AND_SKETCH_PIN',
  );
  requireThat(
    JSON.stringify(f.engine) === JSON.stringify(accepted.engine) &&
      JSON.stringify(f.motor) === JSON.stringify(accepted.motor),
    'INHERITED_ENGINE_AND_MOTOR',
  );
  requireThat(
    f.programs.control.source ===
      f.programs.powered.source.replaceAll('digitalWrite(5, HIGH)', 'digitalWrite(5, LOW)'),
    'LOW_ONLY_SKETCH_DELTA',
  );
  for (const world of ['powered', 'control'] as const) {
    requireThat(hash(f.programs[world].source) === f.programs[world].sketchSha256, 'SKETCH_SHA256');
    requireThat(
      hash(JSON.stringify(f.programs[world].gpio)) === f.programs[world].gpioSha256,
      'GPIO_SHA256',
    );
  }
  near(selectedMotor.transmission.gearRatio.value, f.motor.gearRatio, 0, 'GEAR_RATIO');
  near(
    selectedMotor.rotorInertiaKgMeterSquared.value,
    f.motor.rotorInertiaKgM2,
    0,
    'ROTOR_INERTIA',
  );
  near(
    f.motor.gearRatio ** 2 * f.motor.rotorInertiaKgM2,
    f.motor.reflectedInertiaKgM2,
    1e-18,
    'REFLECTED_ARMATURE',
  );
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
  handle.delete();
  ledger.deleted++;
}
function widths(model: Model) {
  const counts = {
    nq,
    nv,
    nbody,
    ngeom,
    njnt: 5,
    nmocap: 0,
    nu: 0,
    na: 0,
    nsensor: 0,
    nplugin: 0,
    neq: 0,
    ntendon: 0,
    nflex: 0,
    npair: 27,
    nmesh: 1,
    nmeshvert: 8,
    nmeshface: 12,
  };
  for (const [k, count] of Object.entries(counts))
    requireThat(model[k] === count, 'FACTORY_COUNT ' + k);
  const ints = {
    geom_type: [6, 7, 6, 6, 6, 5, 5, 5, 5, 5],
    geom_bodyid: geomBodies,
    geom_condim: Array<number>(ngeom).fill(3),
    geom_contype: Array<number>(ngeom).fill(0),
    geom_conaffinity: Array<number>(ngeom).fill(0),
    jnt_type: [0, 3, 3, 3, 0],
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
  for (const [j, name] of [
    [1, 'tt'],
    [2, 'front-left'],
    [3, 'front-right'],
  ] as const)
    requireThat(
      same(vec(floatView(model.jnt_axis, counts.njnt * 3, 'jnt_axis'), j * 3), [0, 1, 0]),
      'FACTORY_HINGE_AXIS ' + name,
    );
  const masses = Array.from(floatView(model.body_mass, nbody, 'body_mass'));
  near(
    masses.slice(1, canBody).reduce((sum, x) => sum + x, 0),
    physics.chassisMass,
    1e-14,
    'CHASSIS_MASS',
  );
  near(masses[canBody]!, physics.can.mass, 0, 'CAN_MASS');
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
  near(ipos[canBody * 3 + 2]!, canOffset, 1e-15, 'CAN_COM_OFFSET');
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
  return { counts, arms: armature, masses, ipos, inertia: Array.from(inertia), pairs, settings };
}
function modelReadback(M: Native, model: Model, data: Data) {
  const w = widths(model);
  const names = [
    Array.from({ length: nbody }, (_, id) => M.mj_id2name(model, 1, id)),
    Array.from({ length: ngeom }, (_, id) => M.mj_id2name(model, 5, id)),
    Array.from({ length: 5 }, (_, id) => M.mj_id2name(model, 3, id)),
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
  const qpos = [
    -0.25,
    0,
    0.06,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    1.2,
    0,
    physics.terrain.height + physics.can.height / 2,
    1,
    0,
    0,
    0,
  ];
  native.qpos.forEach((value, i) => near(value, qpos[i]!, 1e-14, 'FACTORY_QPOS'));
  return { ...w, pairAllocation, max, names, native, geomBodies };
}
function assertMesh(model: Model, data: Data) {
  const vid = model.mesh_vert;
  const faces = intView(model.mesh_face, 36, 'mesh_face');
  requireThat(
    vid instanceof Float32Array && vid.length === 24 && faces.every((i) => ints(i, 7)),
    'FACTORY_MESH_VERTEX_AND_FACE',
  );
  const gf = floatView(data.geom_xpos, ngeom * 3, 'geom_xpos');
  const gx = floatView(data.geom_xmat, ngeom * 9, 'geom_xmat');
  const origin = vec(gf, names.slope * 3);
  const start = names.slope * 9;
  const axes = [vec(gx, start), vec(gx, start + 3), vec(gx, start + 6)];
  const transformed = Array.from({ length: 8 }, (_, i) =>
    add(origin, [
      dot(axes[0]!, vec(vid, 3 * i)),
      dot(axes[1]!, vec(vid, 3 * i)),
      dot(axes[2]!, vec(vid, 3 * i)),
    ]),
  );
  const matched = new Set<number>();
  for (const actual of transformed) {
    const i = physics.terrain.vertices.findIndex(
      (v, i) => !matched.has(i) && norm(sub(actual, vec(v))) <= 2e-7,
    );
    requireThat(i >= 0, 'FACTORY_MESH_WORLD_ENVELOPE');
    matched.add(i);
  }
  for (const [id, wanted] of [
    [names.lower, [-0.4, 0, -0.025]],
    [names.upper, [1.9, 0, physics.terrain.height - 0.025]],
  ] as const)
    vec(gf, id * 3).forEach((value, i) => near(value, wanted[i]!, 1e-14, 'FACTORY_DECK'));
  for (const w of wheels) {
    const i = 9 * w;
    near(gx[i + 2]!, 0, 1e-14, 'WHEEL_AXIS_X');
    near(gx[i + 5]!, 1, 1e-14, 'WHEEL_AXIS_Y');
    near(gx[i + 8]!, 0, 1e-14, 'WHEEL_AXIS_Z');
  }
  return { transformed };
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
) {
  const post = rowSnapshot(data);
  requireThat(
    pre.rows.size === post.size && same(pre.rows.type, post.type) && same(pre.rows.id, post.id),
    'POST_EFC_IDENTITY',
  );
  const contacts = nativeContacts(data, ledger, capacity);
  requireThat(
    JSON.stringify(contacts) === JSON.stringify(pre.contacts) &&
      contacts.every(
        (c, i) =>
          same(c.frame, pre.contacts[i]!.frame) &&
          same(c.point, pre.contacts[i]!.point) &&
          Object.is(c.distance, pre.contacts[i]!.distance),
      ),
    'POST_CONTACT_IDENTITY',
  );
  const force = floatView(data.efc_force, post.size, 'POST_EFC_FORCE');
  const active = contacts.flatMap((c, id) => {
    if (c.address < 0) return [];
    M.mj_contactForce(model, data, id, buffer);
    ledger.force++;
    const actual = floatView(buffer.GetView(), 6, 'CONTACT_FORCE');
    const localForce = vec(actual);
    requireThat(
      localForce[0] >= 0 && same(localForce, vec(force, c.address)),
      'SOLVED_CONTACT_FORCE_ROWS',
    );
    requireThat(
      actual.subarray(3).every((x) => x === 0),
      'CONTACT_NONTRANSLATIONAL_WRENCH',
    );
    if (localForce[0] > 0) requireThat(c.distance < 0, 'LOADED_CONTACT_NOT_PENETRATING');
    const row = c.address;
    const jacDelta = [0, 1, 2].map((i) =>
      dot(pre.jac.slice((row + i) * nv, (row + i + 1) * nv), delta),
    );
    return [
      {
        first: c.first,
        second: c.second,
        address: row,
        rowTypes: 0x0777,
        index: id,
        point: c.point,
        frame: c.frame,
        force: localForce,
        velocity: vec(pre.velocity, row),
        jacDelta: vec(jacDelta),
      },
    ];
  });
  const census: ContactCensus = {
    nativeRowCount: post.size,
    identities: contacts.map(({ first, second, exclude, address }) => ({
      first,
      second,
      exclude,
      active: address >= 0,
    })),
  };
  return { active, census };
}

const moving = nbody - 1;
const headerWords = 5 + 2 * (nq + nv) + 2 * moving * 7 + moving * 9 + electricKeys.length;
const recordFootprint = cap.intervalByteCap;
const censusOffset = headerWords * 8;
const censusSlotsOffset = censusOffset + 4;
const censusBytes = 4 + 2 * cap.maxContactsPerInterval;

function validateContactCensus(contacts: Entry[], census: ContactCensus) {
  requireThat(
    ints(census.identities.length, cap.maxContactsPerInterval) &&
      ints(census.nativeRowCount, cap.maxRowsPerInterval) &&
      census.nativeRowCount === 3 * contacts.length,
    'NATIVE_CONTACT_CENSUS_COUNTS',
  );
  let activeIndex = 0;
  census.identities.forEach((entry, index) => {
    requireThat(
      ints(entry.first, ngeom - 1) &&
        ints(entry.second, ngeom - 1) &&
        indexedPairs.has(pairKey(entry.first, entry.second)) &&
        ints(entry.exclude, 7),
      'NATIVE_CONTACT_CENSUS_IDENTITY',
    );
    if (!entry.active) return;
    const solved = contacts[activeIndex];
    requireThat(
      entry.exclude === 0 &&
        solved?.index === index &&
        solved.address === 3 * activeIndex &&
        solved.first === entry.first &&
        solved.second === entry.second &&
        solved.rowTypes === 0x0777,
      'NATIVE_CONTACT_CENSUS_ACTIVE_ROW_LINK',
    );
    activeIndex++;
  });
  requireThat(activeIndex === contacts.length, 'NATIVE_CONTACT_CENSUS_ACTIVE_COUNT');
}
const rawUpperBytes =
  2 * (cap.maxIntervalsPerWorld * recordFootprint + cap.maxContactsPerWorld * cap.contactBytes) +
  cap.metadataByteCap +
  cap.footerByteCap;

function encodeInterval(frame: Frame) {
  validateContactCensus(frame.contacts, frame.census);
  const item = Buffer.alloc(recordFootprint + frame.contacts.length * cap.contactBytes);
  const bodies = (poses: Pose[]) => poses.slice(1).flatMap((p) => [...p.p, ...p.q]);
  const words = [
    frame.from,
    frame.to,
    frame.pre.seconds,
    frame.post.seconds,
    frame.contacts.length,
    ...frame.pre.qpos,
    ...frame.pre.qvel,
    ...frame.post.qpos,
    ...frame.post.qvel,
    ...bodies(frame.before),
    ...bodies(frame.after),
    ...frame.kinematics.slice(1).flatMap((b) => [...b.com, ...b.velocity, ...b.omega]),
    ...electricKeys.map((field) => frame.circuit[field]),
  ];
  requireThat(
    words.length === headerWords && words.every(Number.isFinite),
    'INTERVAL_SCHEMA_FINITE',
  );
  words.forEach((value, index) => item.writeDoubleLE(value, index * 8));
  item.writeUInt16LE(frame.census.identities.length, censusOffset);
  item.writeUInt16LE(frame.census.nativeRowCount, censusOffset + 2);
  frame.census.identities.forEach(({ first, second, exclude, active }, index) => {
    const packed = first | (second << 4) | (exclude << 8) | (Number(active) << 11);
    item.writeUInt16LE(packed, censusSlotsOffset + index * 2);
  });
  frame.contacts.forEach((c, i) => {
    const offset = recordFootprint + i * cap.contactBytes;
    const addressGroup = c.address / 3;
    requireThat(ints(c.index, 131) && ints(addressGroup, 131), 'PACKED_CONTACT_ID_AND_ROW');
    item.writeUInt16LE(c.first, offset);
    item.writeUInt16LE(c.second, offset + 2);
    item.writeUInt16LE(c.rowTypes, offset + 4);
    item.writeUInt16LE(addressGroup | (c.index << 8), offset + 6);
    const row = [...c.point, ...c.frame, ...c.force, ...c.velocity, ...c.jacDelta];
    requireThat(
      row.length * 8 === cap.contactBytes - 8 && row.every(Number.isFinite),
      'CONTACT_RECORD_SHAPE',
    );
    row.forEach((value, index) => item.writeDoubleLE(value, offset + 8 + index * 8));
  });
  return item;
}
function decodeInterval(item: Buffer): Frame {
  requireThat(item.length >= recordFootprint, 'DECODE_INTERVAL_TRUNCATED');
  let at = 0;
  const take = () => {
    const value = item.readDoubleLE(at);
    at += 8;
    return finite(value, 'RAW_INTERVAL_WORD');
  };
  const many = (n: number) => Array.from({ length: n }, take);
  const [from, to, preTime, postTime, n] = many(5) as [number, number, number, number, number];
  requireThat(
    ints(n, cap.maxContactsPerInterval) && item.length === recordFootprint + n * cap.contactBytes,
    'DECODE_INTERVAL_SIZE',
  );
  const pre = { seconds: preTime, qpos: many(nq), qvel: many(nv) };
  const post = { seconds: postTime, qpos: many(nq), qvel: many(nv) };
  const pose = () => ({ p: vec(many(3)), q: quat(many(4)) });
  const poses = () => [worldPose, ...Array.from({ length: moving }, pose)];
  const before = poses();
  const after = poses();
  const kinematics = [
    { com: worldPose.p, velocity: worldPose.p, omega: worldPose.p },
    ...Array.from({ length: moving }, () => ({
      com: vec(many(3)),
      velocity: vec(many(3)),
      omega: vec(many(3)),
    })),
  ];
  const circuit = Object.fromEntries(electricKeys.map((key) => [key, take()])) as Electrical;
  const ncon = item.readUInt16LE(censusOffset);
  const nativeRowCount = item.readUInt16LE(censusOffset + 2);
  requireThat(
    at === censusOffset &&
      ints(ncon, cap.maxContactsPerInterval) &&
      item.subarray(censusSlotsOffset + ncon * 2, recordFootprint).every((value) => value === 0),
    'RAW_INTERVAL_CENSUS_AND_PADDING',
  );
  const identities = Array.from({ length: ncon }, (_, i) => {
    const bits = item.readUInt16LE(censusSlotsOffset + 2 * i);
    requireThat(bits >>> 12 === 0, 'RAW_CONTACT_CENSUS_RESERVED_BITS');
    return {
      first: bits & 0xf,
      second: (bits >>> 4) & 0xf,
      exclude: (bits >>> 8) & 7,
      active: Boolean(bits & (1 << 11)),
    };
  });
  const census = { nativeRowCount, identities };
  const contacts = Array.from({ length: n }, (_, index) => {
    at = recordFootprint + index * cap.contactBytes;
    const first = item.readUInt16LE(at);
    const second = item.readUInt16LE(at + 2);
    const rowTypes = item.readUInt16LE(at + 4);
    const packed = item.readUInt16LE(at + 6);
    const address = 3 * (packed & 0xff);
    at += 8;
    requireThat(
      indexedPairs.has(pairKey(first, second)) && rowTypes === 0x0777 && address === 3 * index,
      'RAW_CONTACT_IDENTITY',
    );
    return {
      first,
      second,
      rowTypes,
      address,
      index: packed >> 8,
      point: vec(many(3)),
      frame: many(9),
      force: vec(many(3)),
      velocity: vec(many(3)),
      jacDelta: vec(many(3)),
    };
  });
  validateContactCensus(contacts, census);
  return { from, to, pre, post, before, after, kinematics, circuit, contacts, census };
}
function pairWork(frame: Frame, c: Entry) {
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
  const geometric = dot(force, sub(dB, dA));
  const fromRows = dot(c.force, c.jacDelta);
  const allowed = Math.max(
    budgets.motionWorkAbsJ,
    budgets.motionWorkRel * Math.max(Math.abs(geometric), Math.abs(fromRows)),
  );
  near(geometric, fromRows, allowed, 'INDEPENDENT_CONTACT_WORK');
  return { force, velocity, geometric, fromRows, dA, dB };
}
function isPair(c: Entry, a: number, b: number) {
  return (c.first === a && c.second === b) || (c.first === b && c.second === a);
}
function forceOn(c: Entry, g: number, force: Vec) {
  return c.second === g ? force : scale(force, -1);
}
function validSupport(c: Entry, terrain: number, body: number, force: Vec) {
  const n = terrainNormal(terrain);
  return (
    topPoint(terrain, c.point) &&
    dot(forceOn(c, body, vec(c.frame)), n) >= Math.cos(radians(limits.faceNormalAllowDeg)) &&
    dot(forceOn(c, body, force), n) > 0 &&
    dot(forceOn(c, body, force), up) > 0
  );
}
function canSidePoint(p: Vec, pose: Pose) {
  const [w, x, y, z] = pose.q;
  const local = rotate([w, -x, -y, -z], sub(p, pose.p));
  return (
    Math.abs(Math.hypot(local[0], local[1]) - physics.can.radius) <= limits.faceDistanceM &&
    Math.abs(local[2]) <= physics.can.height / 2 + limits.faceDistanceM
  );
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
function driveBranch(frame: Frame, box: ReturnType<typeof gearbox>) {
  const { ratio, kt, b, eta } = box;
  const motorOmega = ratio * frame.pre.qvel[axleV]!;
  const g = kt * frame.circuit.current - b * motorOmega;
  const reciprocal = g * motorOmega < 0;
  const actual = g * ratio * (reciprocal ? 1 / eta : eta);
  near(frame.circuit.torque, actual, 1e-14, 'SOURCE_GEAR_POWER_BRANCH');
  const dt = (frame.to - frame.from) * secondsPerMicrosecond;
  near(frame.circuit.j, actual * dt, 1e-16, 'SOURCE_TORQUE_IMPULSE');
  const extra = reciprocal ? frame.circuit.torque - g * ratio * eta : 0;
  const measured = frame.post.qpos[axleQ]! - frame.pre.qpos[axleQ]!;
  return {
    impulse: extra * dt,
    work: extra * measured,
    held: extra * frame.pre.qvel[axleV]! * dt,
    structural: reciprocal && extra !== 0,
  };
}

type Window = { from: number; to: number };
function extendWindow(previous: Window | undefined, from: number, to: number, valid: boolean) {
  if (!valid) return undefined;
  return previous?.to === from ? { from: previous.from, to } : { from, to };
}

class Witness {
  readonly world: World;
  readonly profile: ReturnType<typeof sourcePins>;
  readonly gears: ReturnType<typeof gearbox>;
  readonly prefix = createHash('sha256');
  private staticW: Window | undefined;
  private slopeW: Window | undefined;
  private slopeZ = 0;
  private uprightW: Window | undefined;
  private sideW: Window | undefined;
  phase = {
    settled: false,
    mixedAt: 0,
    rampAt: 0,
    topAt: 0,
    bumpAt: 0,
    crossAt: 0,
    sideAt: 0,
    initialZ: 0,
    mixedZ: 0,
    rampHeightGain: 0,
    rise: 0,
    worstSlopeSlip: 0,
    bumpHeight: 0,
    bumpImpulse: 0,
    firstBumpPitchImpulse: 0,
    bumpWork: 0,
    settledX: -0.25,
    controlMaxDx: 0,
    downhillTorqueImpulse: 0,
  };
  readonly failures = new Map<string, number>();
  private settledCaptured = false;
  private slipForWindow = 0;
  private priorCurrent = 0;
  step = 0;
  lastTime = 0;
  commonC = 0;
  private prefixSteps = 0;
  private prev?: State;
  flyback = 0;
  readonly aggregate = {
    input: 0,
    positiveInput: 0,
    circuit: 0,
    copper: 0,
    viscous: 0,
    transmission: 0,
    electricalEuler: 0,
    magnet: 0,
    contact: 0,
    independentContact: 0,
    contactPositive: 0,
    contactNegative: 0,
    shaft: 0,
    positiveShaft: 0,
    commandAtHeldSpeed: 0,
    couplingDifference: 0,
    gearAbs: 0,
    gearPositive: 0,
    gearWork: 0,
    gearHeld: 0,
    gearBranch: 0,
  };
  gearAtSide?: { abs: number; branches: number };
  constructor(world: World, profile: ReturnType<typeof sourcePins>) {
    this.world = world;
    this.profile = profile;
    this.gears = gearbox(profile);
  }
  physicalFailure(code: string, when: number) {
    if (!this.failures.has(code)) this.failures.set(code, when);
  }
  private integrateEnergy(frame: Frame) {
    const a = this.aggregate;
    const circuit = frame.circuit;
    const dt = (frame.to - frame.from) * secondsPerMicrosecond;
    const R = this.profile.armatureResistanceOhm.value;
    const L = this.profile.armatureInductanceHenry.value;
    const backEmf =
      this.profile.backEmfVoltSecondPerRadian.value * this.gears.ratio * frame.pre.qvel[axleV]!;
    const current = (circuit.windV - backEmf + (L / dt) * this.priorCurrent) / (R + L / dt);
    near(current, circuit.current, 1e-10, 'RECONSTRUCTED_IMPLICIT_MNA_WINDING');
    requireThat(circuit.maxKcl <= circuit.kcl, 'REPLAY_KCL_MAX');
    a.input += circuit.inW * dt;
    a.positiveInput += Math.max(0, circuit.inW) * dt;
    a.circuit += circuit.circuitW * dt;
    a.copper += R * circuit.current ** 2 * dt;
    a.viscous += circuit.viscousW * dt;
    a.transmission += circuit.transmissionW * dt;
    a.electricalEuler += (L / 2) * (circuit.current - this.priorCurrent) ** 2;
    a.magnet = (L / 2) * circuit.current ** 2;
    this.priorCurrent = circuit.current;
    const w = (circuit.j / dt) * (frame.post.qpos[axleQ]! - frame.pre.qpos[axleQ]!);
    a.shaft += w;
    a.positiveShaft += Math.max(0, w);
    a.commandAtHeldSpeed += circuit.j * frame.pre.qvel[axleV]!;
    a.couplingDifference = a.shaft - a.commandAtHeldSpeed;
    if (frame.from >= f.programs.offUs && circuit.logic === 0 && circuit.windV < 0)
      this.flyback = Math.max(this.flyback, circuit.diodeA);
    const branch = driveBranch(frame, this.gears);
    if (frame.to >= f.programs.divergeUs) {
      a.gearAbs += Math.abs(branch.impulse);
      a.gearPositive += Math.max(0, branch.work);
      a.gearWork += branch.work;
      a.gearHeld += branch.held;
      a.gearBranch += Number(branch.structural);
    }
  }
  observe(frame: Frame, encoded: Buffer) {
    const { from, to, contacts } = frame;
    const q = this.phase;
    const dt = (to - from) * secondsPerMicrosecond;
    requireThat(
      from === this.lastTime &&
        ints(to, budgets.horizonUs) &&
        to > from &&
        to - from <= budgets.maxStepUs,
      'ACCEPTED_INTERVAL_CLOCK',
    );
    requireThat(frame.circuit.logic === gpioAt(this.world, from), 'REPLAY_D5_CADENCE');
    if (this.prev) requireThat(sameState(this.prev, frame.pre), 'NATIVE_INTERVAL_STATE_CONTINUITY');
    this.prev = frame.post;
    this.lastTime = to;
    this.step++;
    near(frame.pre.seconds * 1e6, from, budgets.clockToleranceUs, 'PRE_NATIVE_CLOCK');
    near(frame.post.seconds * 1e6, to, budgets.clockToleranceUs, 'POST_NATIVE_CLOCK');
    if (to < f.programs.divergeUs) {
      this.prefix.update(encoded);
      this.prefixSteps++;
      this.commonC = to;
    }
    this.integrateEnergy(frame);
    const support = new Map<number, Set<number>>();
    const rejectedSupport = new Set<number>();
    let canOnTop = false;
    let onSide = false;
    let robotTouchesCan = false;
    let impactTick = false;
    let earliestHeight = Infinity;
    let bumpImpulse = 0;
    let bumpWork = 0;
    let pitchImpulse = 0;
    let slip = 0;
    const canPre = frame.before[canBody]!;
    const canPost = frame.after[canBody]!;
    const preCom = canCom(canPre);
    const postCom = canCom(canPost);
    const { axis: preAxis, tip: preTip } = canTwist(canPre);
    const { axis: postAxis, tip: postTip } = canTwist(canPost);
    for (const c of contacts) {
      const pair = pairWork(frame, c);
      const a = this.aggregate;
      a.contact += pair.fromRows;
      a.independentContact += pair.geometric;
      a.contactPositive += Math.max(0, pair.fromRows);
      a.contactNegative += Math.min(0, pair.fromRows);
      if (c.force[0] === 0) continue;
      const terrain = terrainGeoms.find((g) => c.first === g || c.second === g);
      const other = terrain === c.first ? c.second : c.first;
      if (terrain !== undefined) {
        if (other === names.chassis || other === names.bumper)
          this.physicalFailure('BODY_DRAGGED_ON_TERRAIN', from);
        if (wheels.some((wheel) => wheel === other)) {
          if (validSupport(c, terrain, other, pair.force)) {
            const found = support.get(other) ?? new Set<number>();
            found.add(terrain);
            support.set(other, found);
            if (terrain === names.slope)
              slip = Math.max(slip, Math.abs(dot(pair.velocity, alongRamp)));
          } else rejectedSupport.add(other);
        }
        if (other === names.can) {
          if (terrain !== names.upper) this.physicalFailure('CAN_LEFT_UPPER_DECK', from);
          if (terrain === names.upper && validSupport(c, terrain, names.can, pair.force)) {
            canOnTop = true;
            onSide ||= canSidePoint(c.point, canPre);
          }
        }
      } else if (c.first === names.can || c.second === names.can) {
        robotTouchesCan = true;
        if (isPair(c, names.bumper, names.can)) {
          impactTick = true;
          earliestHeight = Math.min(earliestHeight, c.point[2] - preCom[2]);
          const force = forceOn(c, names.can, pair.force);
          bumpImpulse += c.force[0] * dt;
          pitchImpulse += cross(sub(c.point, preCom), force)[1] * dt;
          bumpWork += dot(force, c.second === names.can ? pair.dB : pair.dA);
        } else if (!q.crossAt) this.physicalFailure('UNREGISTERED_ROBOT_CAN_CAUSE', from);
      }
    }

    const on = (wheel: number, terrain: number) => {
      const set = support.get(wheel);
      return !rejectedSupport.has(wheel) && set?.size === 1 && set.has(terrain);
    };
    const all = (terrain: number) => wheels.every((wheel) => on(wheel, terrain));
    const rover0 = frame.before[1]!;
    const rover1 = frame.after[1]!;
    if (to <= f.programs.divergeUs) {
      this.staticW = extendWindow(this.staticW, from, to, all(names.lower));
      if (to === f.programs.divergeUs || !this.settledCaptured) {
        q.initialZ = rover1.p[2];
        if (to === f.programs.divergeUs) {
          q.settledX = rover1.p[0];
          q.settled =
            this.staticW !== undefined && this.staticW.to - this.staticW.from >= limits.staticUs;
          this.settledCaptured = true;
        }
      }
    } else if (!this.settledCaptured) {
      q.initialZ = rover0.p[2];
      q.settledX = rover0.p[0];
      q.settled =
        this.staticW !== undefined && this.staticW.to - this.staticW.from >= limits.staticUs;
      this.settledCaptured = true;
    }
    const unpowered = this.world === 'control';
    q.controlMaxDx = Math.max(
      q.controlMaxDx,
      this.settledCaptured ? Math.abs(rover1.p[0] - q.settledX) : 0,
    );
    if (unpowered) {
      if (robotTouchesCan) this.physicalFailure('CONTROL_ROBOT_REACHED_CAN', from);
      if (wheels.some((wheel) => on(wheel, names.slope)))
        this.physicalFailure('CONTROL_WHEEL_CLIMBED', from);
      if (postTip >= physics.can.tipAngleRad) this.physicalFailure('CONTROL_CAN_TIPPED', to);
    }
    if (
      !q.mixedAt &&
      q.settled &&
      on(names.frontLeft, names.slope) &&
      on(names.frontRight, names.slope) &&
      on(names.rearLeft, names.lower) &&
      on(names.rearRight, names.lower)
    ) {
      q.mixedAt = to;
      q.mixedZ = rover0.p[2];
    }
    if (q.mixedAt && !q.rampAt) {
      const valid = all(names.slope) && slip <= limits.maxSlipMps;
      if (valid && this.slopeW?.to !== from) {
        this.slopeZ = rover0.p[2];
        this.slipForWindow = 0;
      }
      this.slopeW = extendWindow(this.slopeW, from, to, valid);
      this.slipForWindow = Math.max(this.slipForWindow, slip);
      if (this.slopeW && to - this.slopeW.from >= limits.rampUs && rover1.p[2] > this.slopeZ) {
        q.rampAt = to;
        q.rampHeightGain = rover1.p[2] - this.slopeZ;
        q.worstSlopeSlip = this.slipForWindow;
      }
    }
    if (q.rampAt && !q.topAt && all(names.upper)) {
      q.rise = rover1.p[2] - q.initialZ;
      q.topAt = to;
      if (q.rise < limits.minElevationM) this.physicalFailure('INSUFFICIENT_ELEVATION', to);
    }
    const upright =
      canOnTop &&
      !robotTouchesCan &&
      preTip <= radians(limits.canUprightDeg) &&
      postTip <= radians(limits.canUprightDeg);
    if (impactTick && !q.bumpAt) {
      q.bumpAt = from;
      q.bumpHeight = earliestHeight;
      q.firstBumpPitchImpulse = pitchImpulse;
      if (!(q.firstBumpPitchImpulse > 0))
        this.physicalFailure('FIRST_BUMPER_PITCH_IMPULSE_NOT_POSITIVE', from);
      if (!q.topAt || q.topAt > from)
        this.physicalFailure('IMPACT_BEFORE_FOUR_WHEEL_TOP_SUPPORT', from);
      if (
        !this.uprightW ||
        this.uprightW.to !== from ||
        from - this.uprightW.from < limits.staticUs
      )
        this.physicalFailure('CAN_NOT_UPRIGHT_BEFORE_IMPACT', from);
      if (earliestHeight < limits.impactAboveComM)
        this.physicalFailure('IMPACT_TOO_LOW_FOR_REGISTERED_BUMPER', from);
    }
    this.uprightW = extendWindow(this.uprightW, from, to, upright);
    if (q.bumpAt && !q.crossAt) {
      q.bumpImpulse += bumpImpulse;
      q.bumpWork += bumpWork;
      q.downhillTorqueImpulse += pitchImpulse;
    }
    if (!q.crossAt && postTip >= physics.can.tipAngleRad) {
      q.crossAt = to;
      if (
        !q.bumpAt ||
        preTip >= physics.can.tipAngleRad ||
        q.bumpImpulse <= 0 ||
        q.downhillTorqueImpulse <= 0
      )
        this.physicalFailure('TIP_OUTSIDE_LOADED_BUMPER_CAUSAL_ORDER', to);
    }
    const sideBand = Math.sin(radians(limits.canSideFromHorizontalDeg));
    const targetDrop = limits.canDropFraction * (physics.can.comHeight - physics.can.radius);
    const side =
      q.crossAt > 0 &&
      q.crossAt <= from &&
      onSide &&
      !robotTouchesCan &&
      Math.abs(preAxis[2]) <= sideBand &&
      Math.abs(postAxis[2]) <= sideBand &&
      physics.can.initialComZ - preCom[2] >= targetDrop &&
      physics.can.initialComZ - postCom[2] >= targetDrop;
    this.sideW = extendWindow(this.sideW, from, to, side);
    if (!q.sideAt && this.sideW && to - this.sideW.from >= limits.sideUs) {
      q.sideAt = to;
      this.gearAtSide = { abs: this.aggregate.gearAbs, branches: this.aggregate.gearBranch };
    }
    if (
      q.topAt &&
      (rover1.p[0] > physics.terrain.upper[1]! ||
        Math.abs(rover1.p[1]) > physics.terrain.halfY ||
        rover1.p[2] <= physics.terrain.height)
    )
      this.physicalFailure('ROVER_LEFT_TOP_SUPPORTED_FIELD', to);
    if (
      postCom[0] < physics.terrain.upper[0]! ||
      postCom[0] > physics.terrain.upper[1]! ||
      Math.abs(postCom[1]) > physics.terrain.halfY ||
      postCom[2] <= physics.terrain.height
    )
      this.physicalFailure('CAN_FELL_OFF_FINITE_DECK', to);
  }
  finish(initial: Energy, end: Energy) {
    const a = this.aggregate;
    const q = this.phase;
    const limitJ = Math.max(
      budgets.absoluteEnergyLimitJ,
      budgets.relativeEnergyLimit * a.positiveInput,
    );
    const deltaStored =
      end.potential + end.kinetic - initial.potential - initial.kinetic + a.magnet;
    const contactAbsorption = Math.max(0, -a.contact);
    const dissipation =
      a.circuit + a.copper + a.viscous + a.transmission + a.electricalEuler + contactAbsorption;
    const residualJ = deltaStored + dissipation - a.input;
    requireThat(this.lastTime === budgets.horizonUs, 'WORLD_FULL_HORIZON');
    requireThat(this.prev && sameState(this.prev, end.state), 'FINAL_ACCEPTED_STATE');
    if (Math.max(0, residualJ) > limitJ) this.physicalFailure('FULL_ENERGY_BUDGET', this.lastTime);
    if (this.world === 'powered') {
      if (!q.settled || !q.mixedAt || !q.rampAt || !q.topAt)
        this.physicalFailure('MISSING_POWERED_PHYSICAL_RAMP_SEQUENCE', this.lastTime);
      if (!q.bumpAt || !q.crossAt || !q.sideAt)
        this.physicalFailure('MISSING_NATIVE_BUMPER_TIP_AND_SIDE_WINDOW', this.lastTime);
      if (this.flyback < accepted.witness.minimumFlybackCurrentAmp)
        this.physicalFailure('EXPECTED_FLYBACK_CURRENT_NOT_OBSERVED', this.lastTime);
    } else {
      if (
        !q.settled ||
        q.controlMaxDx > limits.controlMaxTravelM ||
        a.positiveShaft > limits.controlPositiveShaftMaxJ
      )
        this.physicalFailure('CONTROL_TRAVEL_OR_POSITIVE_WORK', this.lastTime);
      if (
        !this.uprightW ||
        this.uprightW.to !== this.lastTime ||
        this.lastTime - this.uprightW.from < limits.sideUs
      )
        this.physicalFailure('CONTROL_FINAL_UPRIGHT_WINDOW', this.lastTime);
    }
    return {
      world: this.world,
      step: this.step,
      acceptedTime: this.lastTime,
      prehistory: { c: this.commonC, steps: this.prefixSteps, digest: this.prefix.digest('hex') },
      phase: q,
      failures: Array.from(this.failures),
      flyback: this.flyback,
      gearAtSide: this.gearAtSide,
      energy: { ...a, deltaStored, contactAbsorption, dissipation, residualJ, limitJ },
      physical: this.failures.size === 0 ? 'PASS' : 'FAIL',
    };
  }
}
type Outcome = ReturnType<Witness['finish']>;
function pairOutcome(powered: Outcome, control: Outcome) {
  const physical = powered.physical === 'PASS' && control.physical === 'PASS' ? 'PASS' : 'FAIL';
  const common =
    powered.prehistory.c === control.prehistory.c &&
    powered.prehistory.c > 0 &&
    powered.prehistory.steps === control.prehistory.steps &&
    powered.prehistory.digest === control.prehistory.digest;
  const causal =
    common && powered.gearAtSide?.abs === 0 && powered.gearAtSide.branches === 0
      ? 'QUALIFIED_NO_RECIPROCAL_GAIN_RELIANCE'
      : 'GAP_CAUSAL_TT';
  return {
    physical,
    common,
    causal,
    status:
      physical === 'PASS' && causal === 'QUALIFIED_NO_RECIPROCAL_GAIN_RELIANCE'
        ? 'PASS'
        : physical === 'FAIL'
          ? 'FAIL'
          : 'GAP_CAUSAL_TT',
  };
}

const kindNames = {
  meta: 'arduino-rover-r1181.jsonl',
  intervals: 'arduino-rover-r1181.bin',
};
type JsonLine = Record<string, unknown>;
function below(root: string, child: string) {
  const rel = relative(root, child);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
function externalReceiptRoot(path: string) {
  requireThat(isAbsolute(path), 'ABSOLUTE_RECEIPT_ROOT');
  const actual = realpathSync(path);
  const temp = realpathSync(tmpdir());
  const repository = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  requireThat(
    below(temp, actual) && actual !== repository && !below(repository, actual),
    'EXCLUSIVE_EXTERNAL_TEMP_ROOT',
  );
  return actual;
}
function pinned(directory: string, name: string, expected: string, cap: number) {
  const file = realpathSync(join(directory, name));
  requireThat(
    below(directory, file) && statSync(file).isFile() && statSync(file).size <= cap,
    'ARTIFACT_PATH_OR_SIZE ' + name,
  );
  const bytes = readFileSync(file);
  requireThat(hash(bytes) === expected, 'ARTIFACT_SHA256 ' + name);
  return { file, bytes };
}
function enginePins(input: string) {
  requireThat(isAbsolute(input), 'ABSOLUTE_STOCK_MUJOCO_PACKAGE_ROOT');
  const root = realpathSync(input);
  const packageBytes = pinned(root, 'package.json', eng.packageSha256, 64 * 1024).bytes;
  const pkg = JSON.parse(packageBytes.toString('utf8')) as {
    name?: string;
    version?: string;
    license?: string;
  };
  requireThat(
    pkg.name === '@mujoco/mujoco' &&
      pkg.version === eng.version &&
      pkg.license === eng.declaredNpmLicense,
    'OFFICIAL_STOCK_ENGINE_ID',
  );
  const glue = pinned(root, 'mujoco.js', eng.glueSha256, 2_000_000);
  const wasm = pinned(root, 'mujoco.wasm', eng.wasmSha256, 16_000_000);
  requireThat(wasm.bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM_MAGIC');
  return { glue, wasm };
}
async function loadNative(pinnedEngine: ReturnType<typeof enginePins>) {
  const { glue, wasm } = pinnedEngine;
  requireThat(hash(readFileSync(glue.file)) === eng.glueSha256, 'STOCK_GLUE_BEFORE_IMPORT');
  const { default: factory } = (await import(/* @vite-ignore */ pathToFileURL(glue.file).href)) as {
    default(input: { wasmBinary: Buffer; locateFile(name: string): string }): Promise<Native>;
  };
  requireThat(hash(readFileSync(glue.file)) === eng.glueSha256, 'STOCK_GLUE_AFTER_IMPORT');
  const native = await factory({
    wasmBinary: wasm.bytes,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'UNEXPECTED_RESOURCE_FROM_PINNED_GLUE');
      return wasm.file;
    },
  });
  requireThat(
    native.mj_version() === 4000000 && native.mj_versionString() === eng.version,
    'STOCK_NATIVE_VERSION',
  );
  return native;
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
    this.intervals = 0;
    this.contacts = 0;
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
    let first: unknown;
    for (const fd of [this.bin, this.meta]) {
      try {
        fsyncSync(fd);
      } catch (e) {
        first ??= e;
      }
      try {
        closeSync(fd);
      } catch (e) {
        first ??= e;
      }
    }
    if (first) throw first;
  }
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
      query.runId === '1181:' + world &&
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

type PartialFrame = Omit<Frame, 'after'>;
function dynamicWorld(
  M: Native,
  world: World,
  journal: Journal,
  profile: ReturnType<typeof sourcePins>,
) {
  const history = new Witness(world, profile);
  const ledger = newLedger();
  const baseOffset = journal.binaryBytes;
  const circuit = buildCircuit(world);
  const circuitProjectionSha = hash(JSON.stringify(circuit));
  const session = createElectronicsTtNativeDriveTestSession(circuit, {
    componentId: motorId,
    port,
    runId: '1181:' + world,
    generation: 1,
    requestedHorizonMicroseconds: budgets.horizonUs,
    maxEvents: budgets.maxEvents,
  });
  let model: Model | undefined;
  let data: Data | undefined;
  const ownedBuffers: BufferView[] = [];
  let pending: PartialFrame | undefined;
  let stage = 'model';
  let sequence = 0;
  let calls = 0;
  let lastCanonicalC = 0;
  let firstError: unknown;
  let complete: Outcome | undefined;
  let attempted: { from: number; to: number } | undefined;
  let firstNativeError: unknown;
  const flush = (finalPoses: Pose[]) => {
    if (!pending) return;
    stage = 'retained-interval';
    const packet = { ...pending, after: finalPoses };
    const encoded = encodeInterval(packet);
    journal.frame(encoded);
    history.observe(packet, encoded);
    pending = undefined;
  };
  try {
    journal.beginWorld();
    journal.write({
      kind: 'setup',
      world,
      baseOffset,
      circuitProjectionSha,
      xmlSha256: f.xmlSha256,
      ledger,
    });
    model = M.MjModel.from_xml_string(xml);
    requireThat(model, 'FACTORY_MODEL');
    ledger.model++;
    data = new M.MjData(model);
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
    const capacity = new Map(readback.pairAllocation.map((pair) => [pair.key, pair.max]));
    warnings(data, ledger);
    action(data, 0);
    stage = 'initial-forward-observation';
    const initial = endpointEnergy(M, model, data, massBuffer, vectorBuffer, readback, ledger);
    const mesh = assertMesh(model, data);
    journal.write({
      kind: 'world-start',
      world,
      baseOffset,
      initial,
      readback,
      mesh,
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
        break;
      }
      if (query.kind !== 'shaft-start' && query.kind !== 'shaft-interval')
        throw new Error('UNEXPECTED_TT_QUERY');
      validateShaftQuery(query, world, ++sequence);
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
      const pre = state(data);
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
      const dt = (query.toMicroseconds - query.fromMicroseconds) * secondsPerMicrosecond;
      near(electrical.torque * dt, electrical.j, 1e-16, 'HELD_SIGNED_OUTPUT_IMPULSE');
      model.opt.timestep = dt;
      near(model.opt.timestep, dt, 0, 'NATIVE_STEP_DT');
      stage = 'native-step1';
      ledger.step1++;
      M.mj_step1(model, data);
      ledger.step1Returned++;
      requireThat(sameState(pre, state(data)), 'STEP1_CANNOT_ADVANCE_STATE');
      const before = poseState(data);
      if (pending) {
        requireThat(sameState(pending.post, pre), 'DEFERRED_POST_POSE_IDENTITY');
        flush(before);
      }
      stage = 'pre-constraint-observation';
      const constraints = preConstraints(M, model, data, pre, vectorBuffer, ledger, capacity);
      journal.reserve(constraints.contacts.filter((c) => c.address >= 0).length);
      data.qfrc_applied[axleV] = electrical.j / dt;
      action(data, electrical.j / dt);
      stage = 'native-step2';
      ledger.step2++;
      M.mj_step2(model, data);
      ledger.step2Returned++;
      stage = 'solved-contact-observation';
      const post = state(data);
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
      );
      warnings(data, ledger);
      action(data, electrical.j / dt);
      pending = {
        from: query.fromMicroseconds,
        to: query.toMicroseconds,
        pre,
        post,
        before,
        kinematics: constraints.kinematic,
        circuit: electrical,
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
    }
    requireThat(complete, 'SESSION_BOUNDED_HORIZON_NOT_REACHED');
  } catch (e) {
    firstError = e;
    if (ledger.step1 > 0 || ledger.step2 > 0) firstNativeError = e;
  }
  const cleanup: string[] = [];
  try {
    session.dispose();
  } catch (e) {
    cleanup.push('session: ' + String(e));
  }
  for (const handle of [...ownedBuffers, data, model]) {
    if (!handle) continue;
    try {
      handle.delete();
    } catch (e) {
      cleanup.push(String(e));
    }
  }
  journal.write(
    {
      kind: 'world-resources',
      world,
      stage,
      calls: calls + (complete ? 1 : 0),
      ledger,
      deletedPersistent:
        ownedBuffers.length + Number(Boolean(data)) + Number(Boolean(model)) - cleanup.length,
      cleanup,
    },
    true,
  );
  if (firstError || cleanup.length) {
    journal.write(
      {
        kind: 'first-error',
        world,
        stage,
        attempted,
        submitted: pending,
        ledger,
        lastCanonicalC,
        lastCapturedC: history.lastTime,
        physicalObservations: Array.from(history.failures),
        status: String(firstError).includes('GAP_CAPTURE') ? 'GAP_CAPTURE' : 'UNRESOLVED',
        error: String(firstError ?? cleanup[0]),
      },
      true,
    );
    throw firstNativeError ?? firstError ?? new Error('CLEANUP_FAILED');
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

type WorldStart = {
  kind: 'world-start';
  world: World;
  baseOffset: number;
  initial: Energy;
  readback: ReturnType<typeof modelReadback>;
};
type WorldEnd = {
  kind: 'world-end';
  world: World;
  endOffset: number;
  final: Energy;
  outcome: Outcome;
  ledger: Ledger;
  gpio: Gpio[];
};
type Finish = {
  kind: 'finish';
  status: string;
  physical: string;
  causal: string;
  common: boolean;
  stepTotal: number;
  binaryBytes: number;
  binarySha256: string;
};

function readExact(fd: number, count: number, at: number) {
  const buf = Buffer.alloc(count);
  requireThat(readSync(fd, buf, 0, count, at) === count, 'RAW_READ_SHORT');
  return buf;
}
function replay(root: string, profile: ReturnType<typeof sourcePins>) {
  const dir = externalReceiptRoot(root);
  const meta = realpathSync(join(dir, kindNames.meta));
  const bin = realpathSync(join(dir, kindNames.intervals));
  requireThat(below(dir, meta) && below(dir, bin), 'REPLAY_RECEIPT_PATH');
  const size = statSync(bin).size;
  const metaSize = statSync(meta).size;
  requireThat(
    metaSize <= cap.metadataByteCap + cap.footerByteCap && metaSize + size <= cap.byteCap,
    'REPLAY_RECEIPT_BYTE_LIMIT',
  );
  const lines = readFileSync(meta, 'utf8')
    .trimEnd()
    .split('\n')
    .map(
      (entry) =>
        JSON.parse(entry, (_key, value: unknown) =>
          value === 'float64:-0' ? -0 : value,
        ) as JsonLine,
    );
  const start = lines[0];
  const finish = lines.at(-1) as Finish;
  requireThat(
    start?.kind === 'start' &&
      start.xmlSha256 === f.xmlSha256 &&
      start.fixtureSha256 === hash(readFileSync(fixtureUrl)) &&
      start.sourceSha256 === hash(readFileSync(sourceUrl)),
    'REPLAY_EXACT_SOURCE_FIXTURE_MODEL',
  );
  requireThat(finish.kind === 'finish' && finish.binaryBytes === size, 'REPLAY_COMPLETE_EXPECTED');
  const digest = createHash('sha256');
  const results: Outcome[] = [];
  const descriptor = openSync(bin, 'r');
  try {
    let at = 0;
    for (const world of ['powered', 'control'] as const) {
      const worldStart = lines.find((x) => x.kind === 'world-start' && x.world === world) as
        WorldStart | undefined;
      const worldEnd = lines.find((x) => x.kind === 'world-end' && x.world === world) as
        WorldEnd | undefined;
      requireThat(
        worldStart &&
          worldEnd &&
          worldStart.baseOffset === at &&
          ints(worldEnd.endOffset, size) &&
          worldEnd.endOffset > at,
        'RAW_WORLD_OFFSET_BOUNDS',
      );
      requireThat(
        JSON.stringify(worldEnd.gpio) === JSON.stringify(f.programs[world].gpio),
        'REPLAY_CANONICAL_D5_TRACE',
      );
      const history = new Witness(world, profile);
      let rows = 0;
      while (at < worldEnd.endOffset) {
        const header = readExact(descriptor, recordFootprint, at);
        const n = header.readDoubleLE(4 * 8);
        requireThat(
          ints(n, cap.maxContactsPerInterval) &&
            rows + n <= cap.maxContactsPerWorld &&
            history.step < cap.maxIntervalsPerWorld,
          'REPLAY_CONTACT_OR_INTERVAL_CAP',
        );
        rows += n;
        const contacts = readExact(descriptor, n * cap.contactBytes, at + recordFootprint);
        const bytes = Buffer.concat([header, contacts]);
        at += bytes.length;
        requireThat(at <= worldEnd.endOffset, 'REPLAY_WORLD_CAP');
        const frame = decodeInterval(bytes);
        if (history.step === 0)
          requireThat(sameState(frame.pre, worldStart.initial.state), 'REPLAY_INITIAL_STATE');
        digest.update(bytes);
        history.observe(frame, bytes);
      }
      for (const energy of [worldStart.initial, worldEnd.final]) {
        requireThat(
          energy.bodies.every(
            (body) =>
              body.mass === worldStart.readback.masses[body.id] &&
              same(body.moments, vec(worldStart.readback.inertia, 3 * body.id)),
          ),
          'REPLAY_NATIVE_BODY_MODEL_BINDING',
        );
        checkEndpointEnergy(energy);
      }
      const actual = history.finish(worldStart.initial, worldEnd.final);
      requireThat(
        JSON.stringify(actual) === JSON.stringify(worldEnd.outcome),
        'INDEPENDENT_BINARY_PHYSICAL_AND_ENERGY_REPLAY',
      );
      requireThat(
        worldEnd.ledger.step1Returned === history.step &&
          worldEnd.ledger.step2Returned === history.step,
        'REPLAY_STEPS_MATCH',
      );
      const cleanup = lines.find((x) => x.kind === 'world-resources' && x.world === world);
      requireThat(
        cleanup?.deletedPersistent === 5 &&
          Array.isArray(cleanup.cleanup) &&
          cleanup.cleanup.length === 0,
        'REPLAY_NATIVE_CLEANUP',
      );
      results.push(actual);
    }
    requireThat(
      at === size && digest.digest('hex') === finish.binarySha256,
      'IMMUTABLE_BINARY_ARCHIVE_DIGEST',
    );
  } finally {
    closeSync(descriptor);
  }
  const result = pairOutcome(results[0]!, results[1]!);
  requireThat(
    result.physical === finish.physical &&
      result.causal === finish.causal &&
      result.common === finish.common &&
      result.status === finish.status &&
      results.reduce((total, x) => total + x.step, 0) === finish.stepTotal,
    'INDEPENDENT_PAIRED_RESULT_BINDING',
  );
  return { result, results };
}

it('pins the actual previous TT fixture/source, validates both independent Uno schedules and proves journal ceilings', () => {
  sourcePins();
  for (const world of ['powered', 'control'] as const) {
    expect(pureUno(world, 1)).toEqual(f.programs[world].gpio);
    expect(pureUno(world, 256)).toEqual(f.programs[world].gpio);
  }
  const powerGpio: readonly Gpio[] = f.programs.powered.gpio;
  expect(powerGpio.find((e) => e.voltageVolt === 5)?.atMicroseconds).toBe(f.programs.divergeUs);
  expect(powerGpio.at(-1)?.atMicroseconds).toBe(f.programs.offUs);
  expect(f.programs.control.gpio.length).toBe(2);
  expect(
    f.programs.control.gpio.every((event) => !('voltageVolt' in event) || event.voltageVolt === 0),
  ).toBe(true);
  const artifact = process.env['ASA_TT_ROVER_ENGINE_ROOT'];
  if (artifact) enginePins(artifact);
  const powered = buildCircuit('powered');
  const control = buildCircuit('control');
  expect(powered.components.map((x) => x.id).sort()).toEqual([...ids].sort());
  expect(powered.connections).toEqual(control.connections);
  expect(powered.components.filter((c) => c.id !== 'uno')).toEqual(
    control.components.filter((c) => c.id !== 'uno'),
  );
  expect(physics.terrain.height).toBe(0.8 * Math.tan(radians(5)));
  expect(physics.terrain.upper).toEqual([0.8, 3]);
  expect(physics.can.nominalEnergyBarrierJ).toBeCloseTo(0.0008966619455577198, 17);
  expect(indexedPairs.size).toBe(27);
  expect(geomBodies).toHaveLength(ngeom);
  expect(f.expected.bodies).toHaveLength(nbody);
  expect(rawUpperBytes).toBe(257_949_184);
  expect(rawUpperBytes).toBeLessThan(cap.byteCap);
  expect(censusOffset + censusBytes).toBeLessThanOrEqual(recordFootprint);
  expect(cap.contactBytes).toBe(176);
});

it('reconstructs energy from rotated inertia, translation, gravity and one armature', () => {
  const qvel = Array<number>(nv).fill(0);
  qvel[axleV] = 3;
  const reflectedInertia = f.motor.reflectedInertiaKgM2;
  const zero: Vec = [0, 0, 0];
  const com: Vec = [0, 0, 0.3];
  const omega: Vec = [2, 0, 0];
  const velocity: Vec = [1, 2, 0];
  const moments: Vec = [0.01, 0.02, 0.03];
  const mass = 0.05;
  // First local axis is +Y, second is -X, third is +Z.
  const inertialToWorld = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const kinetic = (mass * 5 + moments[1] * 4 + reflectedInertia * 9) / 2;
  const potential = mass * 9.81 * com[2];
  const massTimesVelocity = Array<number>(nv).fill(0);
  massTimesVelocity[axleV] = (2 * kinetic) / qvel[axleV]!;
  const endpoint: Energy = {
    state: { qpos: Array<number>(nq).fill(0), qvel, seconds: 0 },
    poses: Array<Pose>(nbody).fill(worldPose),
    kinetic,
    potential,
    gravity: [0, 0, -9.81],
    reflectedInertia,
    massTimesVelocity,
    bodies: Array.from({ length: nbody - 1 }, (_, i) => ({
      id: i + 1,
      mass,
      moments,
      inertialToWorld,
      com: i === 0 ? com : zero,
      omega: i === 0 ? omega : zero,
      velocity: i === 0 ? velocity : zero,
    })),
  };
  expect(checkEndpointEnergy(endpoint).independentlyComputedKinetic).toBe(kinetic);
  expect(() =>
    checkEndpointEnergy({
      ...endpoint,
      bodies: endpoint.bodies.map((body, i) =>
        i === 0 ? { ...body, inertialToWorld: [1, 0, 0, 0, 1, 0, 0, 0, 1] } : body,
      ),
    }),
  ).toThrow('INDEPENDENT_RIGID_BODY_KINETIC_ENERGY');
});

it('retains signs and all independent geometric contact-work inputs at the worst record size', () => {
  const vecZero: Vec = [-0, 0, 0];
  const poses = Array<Pose>(nbody).fill(worldPose);
  const kinematics = poses.map(() => ({ com: vecZero, omega: vecZero, velocity: vecZero }));
  const fallback = Array<number>(nq).fill(0);
  const velocities = Array<number>(nv).fill(-0);
  const state: State = { qpos: fallback, qvel: velocities, seconds: 0 };
  const contact: Entry = {
    first: names.lower,
    second: names.rearLeft,
    index: 0,
    address: 0,
    rowTypes: 0x0777,
    point: vecZero,
    frame: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    velocity: vecZero,
    jacDelta: vecZero,
    force: [1, 0, 0],
  };
  const circuit = Object.fromEntries(electricKeys.map((key) => [key, -0])) as Electrical;
  const contacts = Array.from({ length: cap.maxContactsPerInterval }, (_, i) => ({
    ...contact,
    index: i,
    address: 3 * i,
  }));
  const identities = contacts.map(({ first, second }, index) => ({
    first,
    second,
    exclude: index === 0 ? 1 : 0,
    active: index !== 0,
  }));
  const active = contacts.slice(1).map((c, i) => ({ ...c, address: 3 * i }));
  const frame: Frame = {
    from: 0,
    to: 500,
    pre: state,
    post: state,
    before: poses,
    after: poses,
    kinematics,
    circuit,
    contacts: active,
    census: { nativeRowCount: active.length * 3, identities },
  };
  const encoded = encodeInterval(frame);
  expect(encoded.length).toBe(recordFootprint + active.length * cap.contactBytes);
  const read = decodeInterval(encoded);
  expect(same(read.pre.qvel, velocities)).toBe(true);
  expect(read.contacts.at(-1)?.index).toBe(cap.maxContactsPerInterval - 1);
  expect(read.census.identities[0]).toEqual({ ...identities[0], active: false, exclude: 1 });
  expect(read.census.nativeRowCount).toBe(3 * (cap.maxContactsPerInterval - 1));
  const wrongRows = Buffer.from(encoded);
  wrongRows.writeUInt16LE(read.census.nativeRowCount - 3, censusOffset + 2);
  expect(() => decodeInterval(wrongRows)).toThrow('NATIVE_CONTACT_CENSUS_COUNTS');
  const allActive = encodeInterval({
    ...frame,
    contacts,
    census: {
      nativeRowCount: 3 * contacts.length,
      identities: identities.map((id) => ({ ...id, exclude: 0, active: true })),
    },
  });
  expect(allActive.length).toBe(recordFootprint + cap.maxContactsPerInterval * cap.contactBytes);
  expect(Object.is(read.circuit.current, -0)).toBe(true);
  expect(pairWork(read, read.contacts[0]!).fromRows).toBe(0);
  expect(pairWork(read, read.contacts[0]!).geometric).toBe(0);
});

it('uses the finite top face and the signed material-point displacement of the actual contact pair', () => {
  const center: Vec = [0.4, 0, physics.terrain.height / 2];
  const n = nSlope;
  const zero: Vec = [0, 0, 0];
  const basis = [...n, 0, 1, 0, ...cross(n, [0, 1, 0])];
  const edge: Entry = {
    first: names.slope,
    second: names.rearLeft,
    index: 0,
    address: 0,
    rowTypes: 0x0777,
    point: center,
    frame: basis,
    force: [3, 0, 0],
    jacDelta: [0.0002, 0, 0],
    velocity: zero,
  };
  expect(validSupport(edge, names.slope, names.rearLeft, scale(n, 3))).toBe(true);
  expect(
    validSupport({ ...edge, point: [0.4, 0, -0.05] }, names.slope, names.rearLeft, scale(n, 3)),
  ).toBe(false);
  expect(validSupport(edge, names.slope, names.rearLeft, scale(n, -3))).toBe(false);
  const before = Array<Pose>(nbody).fill(worldPose);
  const after = [...before];
  after[2] = { p: scale(n, 0.0002), q: worldPose.q };
  const native: State = {
    seconds: 0,
    qpos: Array<number>(nq).fill(0),
    qvel: Array<number>(nv).fill(0),
  };
  const frame: Frame = {
    from: 0,
    to: 500,
    pre: native,
    post: native,
    before,
    after,
    kinematics: before.map(() => ({ com: zero, velocity: zero, omega: zero })),
    circuit: Object.fromEntries(electricKeys.map((key) => [key, 0])) as Electrical,
    contacts: [edge],
    census: {
      nativeRowCount: 3,
      identities: [{ first: edge.first, second: edge.second, exclude: 0, active: true }],
    },
  };
  const work = pairWork(frame, edge);
  expect(work.fromRows).toBeCloseTo(0.0006, 14);
  expect(work.geometric).toBeCloseTo(work.fromRows, 14);
  expect(() => pairWork(frame, { ...edge, jacDelta: [-0.0002, 0, 0] })).toThrow(
    'INDEPENDENT_CONTACT_WORK',
  );
});

it('retains a nonpositive first bumper pitch impulse even after a larger positive impulse', () => {
  const zero: Vec = [0, 0, 0];
  const poses = Array<Pose>(nbody).fill(worldPose);
  poses[canBody] = { p: [1.2, 0, physics.terrain.height + physics.can.height / 2], q: worldPose.q };
  const kinematics = poses.map((pose) => ({ com: pose.p, velocity: zero, omega: zero }));
  const at = (seconds: number): State => ({
    seconds,
    qpos: Array<number>(nq).fill(0),
    qvel: Array<number>(nv).fill(0),
  });
  const circuit = Object.fromEntries(electricKeys.map((key) => [key, 0])) as Electrical;
  const point = add(canCom(poses[canBody]!), [0, 0, 0.01]);
  const contact = (forward: boolean): Entry => ({
    first: names.bumper,
    second: names.can,
    index: 0,
    address: 0,
    rowTypes: 0x0777,
    point,
    frame: forward ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [-1, 0, 0, 0, 1, 0, 0, 0, -1],
    force: [forward ? 3 : 1, 0, 0],
    jacDelta: zero,
    velocity: zero,
  });
  const witness = new Witness('powered', sourcePins());
  const frame = (from: number, contacts: Entry[]): Frame => ({
    from,
    to: from + 500,
    pre: at(from * secondsPerMicrosecond),
    post: at((from + 500) * secondsPerMicrosecond),
    before: poses,
    after: poses,
    kinematics,
    circuit,
    contacts,
    census: {
      nativeRowCount: 3 * contacts.length,
      identities: contacts.map(({ first, second }) => ({
        first,
        second,
        exclude: 0,
        active: true,
      })),
    },
  });
  for (const step of [frame(0, []), frame(500, [contact(false)]), frame(1000, [contact(true)])])
    witness.observe(step, encodeInterval(step));
  expect(witness.phase.firstBumpPitchImpulse).toBeLessThan(0);
  expect(witness.phase.downhillTorqueImpulse).toBeGreaterThan(0);
  expect(witness.failures.get('FIRST_BUMPER_PITCH_IMPULSE_NOT_POSITIVE')).toBe(500);
});

it('obtains equal prepared common-clock electrical intervals before the different D5 edge', () => {
  const runPrefix = (world: World) => {
    const session = createElectronicsTtNativeDriveTestSession(buildCircuit(world), {
      componentId: motorId,
      port,
      runId: '1181:' + world,
      generation: 1,
      requestedHorizonMicroseconds: budgets.horizonUs,
      maxEvents: budgets.maxEvents,
    });
    const prefix: unknown[] = [];
    try {
      for (let i = 0; i < cap.maxSessionCalls; i++) {
        const query = session.step();
        requireThat(query, 'PURE_PREFIX_SESSION');
        if (query.kind === 'working') continue;
        requireThat(
          query.kind === 'shaft-start' || query.kind === 'shaft-interval',
          'PURE_PREFIX_QUERY',
        );
        if (query.toMicroseconds >= f.programs.divergeUs)
          return { prefix, cutoff: query.fromMicroseconds };
        if (query.kind === 'shaft-interval')
          prefix.push([query.fromMicroseconds, query.toMicroseconds, readElectrical(query, world)]);
        requireThat(
          session.respond(
            shaftReply(query, {
              measuredAtMicroseconds: query.toMicroseconds,
              angleRadian: 0,
              angularVelocityRadPerSecond: 0,
            }),
          ),
          'PURE_PREFIX_REPLY',
        );
      }
      throw new Error('PURE_PREFIX_LIMIT');
    } finally {
      session.dispose();
    }
  };
  const powered = runPrefix('powered');
  expect(powered).toEqual(runPrefix('control'));
  expect(powered.cutoff).toBeGreaterThan(f.programs.divergeUs - budgets.maxStepUs - 1);
  expect(powered.cutoff).toBeLessThan(f.programs.divergeUs);
});

it.runIf(Boolean(receiptMode))(
  'reconstructs the complete externally retained paired receipt without MuJoCo',
  () => {
    requireThat(!nativeMode && receiptMode, 'REPLAY_ONLY');
    const result = replay(receiptMode, sourcePins());
    expect(['PASS', 'FAIL', 'GAP_CAUSAL_TT']).toContain(result.result.status);
  },
  budgets.timeoutMs,
);

it.runIf(nativeMode === 'frozen-1181')(
  'records the paired actual Uno rover climb, native impact, side support and LOW control',
  async () => {
    requireThat(!receiptMode, 'ACQUISITION_ONLY');
    const out = externalReceiptRoot(process.env['ASA_TT_ROVER_OUTPUT_DIR'] ?? '');
    const journal = new Journal(out);
    let startedNative = false;
    let final: ReturnType<typeof pairOutcome> | undefined;
    let terminalError: unknown;
    try {
      const fixtureSha256 = process.env['ASA_TT_ROVER_FIXTURE_SHA256'];
      const sourceSha256 = process.env['ASA_TT_ROVER_SOURCE_SHA256'];
      requireThat(
        sourceSha256 === hash(readFileSync(sourceUrl)) &&
          fixtureSha256 === hash(readFileSync(fixtureUrl)),
        'FROZEN_FIXTURE_AND_SOURCE_OPT_IN',
      );
      const profile = sourcePins();
      const artifacts = enginePins(process.env['ASA_TT_ROVER_ENGINE_ROOT'] ?? '');
      for (const world of ['powered', 'control'] as const)
        requireThat(
          JSON.stringify(pureUno(world, 7)) === JSON.stringify(f.programs[world].gpio),
          'PRE_NATIVE_PURE_UNO_REFERENCE',
        );
      journal.write({
        kind: 'start',
        scope: 'TEST_ONLY',
        sourceSha256,
        fixtureSha256,
        xmlSha256: f.xmlSha256,
        engine: eng,
        motor: f.motor,
        priorTt: f.acceptedTt,
        budgets,
        raw: cap,
        nearStatic: {
          firstDifferentD5: f.programs.divergeUs,
          scope: 'powered path through first native 100ms side support',
        },
        binary: {
          endian: 'little',
          intervalHeaderBytes: recordFootprint,
          contactBytes: cap.contactBytes,
          headerWords,
          header: [
            'fromUs',
            'toUs',
            'preSeconds',
            'postSeconds',
            'contactCount',
            'preQpos17',
            'preQvel15',
            'postQpos17',
            'postQvel15',
            'movingPrePose5x7',
            'movingPostPose5x7',
            'movingPreComVelocityOmega5x9',
            ...electricKeys,
          ],
          census: {
            offset: censusOffset,
            slotsOffset: censusSlotsOffset,
            bytes: censusBytes,
            header: ['nativeNcon-u16', 'nativeNefc-u16'],
            slots: 'native ordinal order: geom1 bits 0-3, geom2 4-7, exclude 8-10, active 11',
          },
          contacts: [
            'geom1-u16',
            'geom2-u16',
            'ellipticRowTypes-u16',
            'nativeContactIndexHighByte_rowGroupLowByte-u16',
            'point3-f64',
            'frame9-f64',
            'force3-f64',
            'efcVelocity3-f64',
            'JDelta3-f64',
          ],
        },
      });
      startedNative = true;
      const M = await loadNative(artifacts);
      const powered = dynamicWorld(M, 'powered', journal, profile);
      const control = dynamicWorld(M, 'control', journal, profile);
      final = pairOutcome(powered, control);
      journal.write(
        {
          kind: 'finish',
          runtime: 'COMPLETE',
          ...final,
          stepTotal: powered.step + control.step,
          binaryBytes: journal.binaryBytes,
          binarySha256: journal.digest.digest('hex'),
        },
        true,
      );
    } catch (error) {
      terminalError = error;
      journal.write(
        {
          kind: 'terminal-error',
          stage: startedNative ? 'factory-or-native' : 'pre-dispatch-guard',
          status: String(error).includes('GAP_CAPTURE') ? 'GAP_CAPTURE' : 'UNRESOLVED',
          error: String(error),
          binaryBytes: journal.binaryBytes,
          binarySha256: journal.digest.digest('hex'),
        },
        true,
      );
    } finally {
      journal.close();
    }
    if (terminalError) throw terminalError;
    expect(
      final?.status,
      'paired bounded physical and causal verdict (see immutable raw receipt)',
    ).toBe('PASS');
  },
  budgets.timeoutMs,
);
