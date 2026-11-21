import { createHash } from 'node:crypto';
import {
  closeSync,
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
import f from './arduino-tt-sphere-push.fixture.json';
import { createEditableRampGeometry } from './editable-ramp-geometry.js';

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
const nq = 17,
  nv = 15,
  nbody = 6,
  ngeom = 8;
const axleQ = 7,
  axleV = 6;
const names = {
  floor: 0,
  chassis: 1,
  bumper: 2,
  rearLeft: 3,
  rearRight: 4,
  frontLeft: 5,
  frontRight: 6,
  sphere: 7,
};
const wheels = [3, 4, 5, 6];
const geomBodies = [0, 1, 1, 2, 2, 3, 4, 5];
const sphereBody = 5,
  roverBody = 1;
const bodyParents = [0, 0, roverBody, roverBody, roverBody, 0];
const wheelHinges = new Map([
  [2, 7],
  [3, 8],
  [4, 9],
]);
const hingeAxis: Vec = [0, 1, 0],
  up: Vec = [0, 0, 1];
const sphereOffset = 0;
const worldPose: Pose = { p: [0, 0, 0], q: [1, 0, 0, 0] };
const ids = ['uno', 'battery', 'left-motor', 'left-fet', 'left-flyback'] as const;
const motorId = ids[2],
  port = 'tt-left-output';
const selectedMotor = BRUSHED_MOTOR_ASSEMBLY_PROFILES.find(
  (p) => p.profileId === f.motor.profileId,
);
const fixtureUrl = new URL('./arduino-tt-sphere-push.fixture.json', import.meta.url);
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
    njnt: 5,
    nmocap: 0,
    nu: 0,
    na: 0,
    nsensor: 0,
    nplugin: 0,
    neq: 0,
    ntendon: 0,
    nflex: 0,
    npair: 13,
    nmesh: 1,
    nmeshvert: 8,
    nmeshface: 12,
  };
  for (const [k, count] of Object.entries(counts))
    requireThat(model[k] === count, 'FACTORY_COUNT ' + k);
  const ints = {
    geom_type: [7, 6, 6, 5, 5, 5, 5, 2],
    geom_bodyid: geomBodies,
    body_parentid: bodyParents,
    jnt_bodyid: [1, 2, 3, 4, 5],
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
  const jointAxes = floatView(model.jnt_axis, counts.njnt * 3, 'jnt_axis');
  const jointAnchors = floatView(model.jnt_pos, counts.njnt * 3, 'jnt_pos');
  for (const j of [1, 2, 3])
    requireThat(
      same(vec(jointAxes, j * 3), hingeAxis) && vec(jointAnchors, j * 3).every((x) => x === 0),
      'PRE_HINGE_AXIS_AND_BODY_ORIGIN_ANCHOR_' + j,
    );
  const masses = Array.from(floatView(model.body_mass, nbody, 'body_mass'));
  near(
    masses.slice(1, sphereBody).reduce((sum, x) => sum + x, 0),
    physics.chassisMass,
    1e-14,
    'CHASSIS_MASS',
  );
  near(masses[sphereBody]!, physics.sphere.mass, 0, 'SPHERE_MASS');
  vec(floatView(model.body_inertia, nbody * 3, 'SPHERE_INERTIA'), sphereBody * 3).forEach((v) =>
    near(v, physics.sphere.inertia, 1e-18, 'SPHERE_PRINCIPAL_INERTIA'),
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
  near(ipos[sphereBody * 3 + 2]!, sphereOffset, 1e-15, 'SPHERE_COM_OFFSET');
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
  requireThat(
    same(vec(geomSize, 3 * names.sphere), [physics.sphere.radius, 0, 0]) &&
      same(vec(geomPos, 3 * names.sphere), [0, 0, 0]),
    'ACTUAL_15CM_SPHERE_COLLIDER',
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
    sphereRadius: geomSize[3 * names.sphere]!,
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
    if (first === 7 || second === 7) requireThat(max === 1, 'ONE_SPHERE_CONTACT_PER_PAIR');
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
    physics.sphere.startX,
    0,
    physics.sphere.initialComZ,
    1,
    0,
    0,
    0,
  ];
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
    identities: contacts.map(({ first, second, exclude, address, distance }) => ({
      first,
      second,
      exclude,
      active: address >= 0,
      distance,
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
// Starts beyond every possible census slot, so the archived/prefix layout is unchanged.
const sphereDistancesOffset = censusOffset + censusBytes;
const appliedOffset = sphereDistancesOffset + (ngeom - 1) * 8;
const appliedEnd = appliedOffset + 16;

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
  for (const c of frame.census.identities) {
    if (c.first === names.sphere || c.second === names.sphere) {
      const other = c.first === names.sphere ? c.second : c.first;
      item.writeDoubleLE(
        finite(c.distance, 'NATIVE_SPHERE_GAP'),
        sphereDistancesOffset + 8 * other,
      );
    }
  }
  if (frame.applied) {
    requireThat(frame.from >= comparison.interventionUs, 'APPLIED_WITNESS_AFTER_SHARED_PREFIX');
    item.writeDoubleLE(finite(frame.applied.torque, 'APPLIED_SHAFT_TORQUE'), appliedOffset);
    item.writeDoubleLE(finite(frame.applied.impulse, 'APPLIED_SHAFT_IMPULSE'), appliedOffset + 8);
  }
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
  const alternative = appliesAlternative(from);
  const applied = alternative
    ? {
        torque: finite(item.readDoubleLE(appliedOffset), 'RAW_APPLIED_SHAFT_TORQUE'),
        impulse: finite(item.readDoubleLE(appliedOffset + 8), 'RAW_APPLIED_SHAFT_IMPULSE'),
      }
    : undefined;
  const ncon = item.readUInt16LE(censusOffset);
  const nativeRowCount = item.readUInt16LE(censusOffset + 2);
  requireThat(
    at === censusOffset &&
      ints(ncon, cap.maxContactsPerInterval) &&
      item
        .subarray(censusSlotsOffset + ncon * 2, sphereDistancesOffset)
        .every((value) => value === 0) &&
      item.subarray(appliedEnd, recordFootprint).every((value) => value === 0) &&
      (alternative || item.subarray(appliedOffset, appliedEnd).every((value) => value === 0)),
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
      distance:
        (bits & 0xf) === names.sphere || ((bits >>> 4) & 0xf) === names.sphere
          ? finite(
              item.readDoubleLE(
                sphereDistancesOffset +
                  8 * ((bits & 0xf) === names.sphere ? (bits >>> 4) & 0xf : bits & 0xf),
              ),
              'RAW_SPHERE_DISTANCE',
            )
          : 0,
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
  return {
    from,
    to,
    pre,
    post,
    before,
    after,
    kinematics,
    circuit,
    contacts,
    census,
    ...(applied ? { applied } : {}),
  };
}
// qPost * conjugate(qPre) is the relative rotation in world coordinates.
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
    [roverBody, sphereBody].map((root) => {
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
      query.runId === 'sphere-push:' + world &&
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

function assertMesh(model: Model, data: Data) {
  const floor = physics.floor;
  const made = createEditableRampGeometry({
    lengthMeters: floor.length,
    widthMeters: floor.width,
    riseMeters: floor.height,
    baseThicknessMeters: floor.thickness,
    originMeters: vec(floor.origin),
    headingRadians: 0,
  });
  requireThat(
    JSON.stringify(made.vertices) === JSON.stringify(floor.vertices) &&
      JSON.stringify(made.faces) === JSON.stringify(floor.faces),
    'COMMON_LEVEL_PLATE_GEOMETRY',
  );
  const points = model.mesh_vert;
  requireThat(points instanceof Float32Array && points.length === 24, 'COMPILED_MESH_VERTEX_WIDTH');
  const p = vec(data.geom_xpos);
  const matrix = Array.from(floatView(data.geom_xmat, ngeom * 9, 'geom_xmat')).slice(0, 9);
  const transformed = Array.from({ length: 8 }, (_, i) =>
    add(
      p,
      vec(
        [0, 1, 2].map((row) =>
          dot(matrix.slice(row * 3, row * 3 + 3), Array.from(points.slice(3 * i, 3 * i + 3))),
        ),
      ),
    ),
  );
  for (const expected of made.vertices)
    requireThat(
      transformed.some((v) => norm(sub(v, vec(expected))) <= 2e-6),
      'ACTUAL_FINITE_PLATE_VERTICES',
    );
  return { vertices: transformed, topZ: 0, bounds: { x: [-1, 19], y: [-0.5, 0.5] } };
}
function sphereOmega(s: State): Vec {
  return rotate(quat(s.qpos, 13), vec(s.qvel, 12));
}
function sphereVelocity(s: State): Vec {
  return vec(s.qvel, 9);
}
function sphereMetrics(s: State) {
  const v = sphereVelocity(s),
    w = sphereOmega(s);
  const patch = add(v, cross(w, [0, 0, -physics.sphere.radius]));
  return {
    slip: Math.hypot(patch[0], patch[1]),
    normalVelocity: v[2],
    clearance: s.qpos[12]! - physics.sphere.radius,
    omega: w,
    velocity: v,
  };
}
const boxAxes: readonly Vec[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
function shapeProjections(poses: Pose[]) {
  const boxes = [
    { body: roverBody, offset: [0, 0, 0] as Vec, half: [0.08, 0.05, 0.016] as Vec, axes: boxAxes },
    {
      body: roverBody,
      offset: vec(boom.centerM),
      half: vec(boom.halfSizeM),
      axes: boxAxes.map((axis) => rotate(quat(boom.quatWxyz), axis)),
    },
  ];
  const geometry = boxes.map((shape) => ({
    body: shape.body,
    reach: Math.max(
      ...[-1, 1].flatMap((x) =>
        [-1, 1].flatMap((y) =>
          [-1, 1].map((z) =>
            norm(
              add(
                shape.offset,
                shape.axes.reduce<Vec>(
                  (a, axis, i) => add(a, scale(axis, shape.half[i]! * [x, y, z][i]!)),
                  [0, 0, 0],
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    intervals: boxAxes.map((axis) =>
      boxProjection(poses[shape.body]!, shape.offset, shape.half, axis, shape.axes),
    ),
  }));
  wheels.forEach((id, index) => {
    const body = geomBodies[id]!,
      pose = poses[body]!;
    const offset: Vec = [0, index < 2 ? (index === 0 ? 0.065 : -0.065) : 0, 0];
    const p = add(pose.p, rotate(pose.q, offset));
    geometry.push({
      body,
      reach: norm(offset) + Math.hypot(physics.wheelRadius, physics.wheelHalfWidth),
      intervals: boxAxes.map((axis) =>
        cylinderProjection(
          { ...pose, p },
          hingeAxis,
          axis,
          physics.wheelRadius,
          physics.wheelHalfWidth,
        ),
      ),
    });
  });
  return geometry;
}
function sweptSphereClearance(frame: Frame) {
  const before = shapeProjections(frame.before),
    after = shapeProjections(frame.after);
  const sphereMove = norm(sub(frame.after[sphereBody]!.p, frame.before[sphereBody]!.p));
  const bounds = before.map((part, i) => {
    const gap = (items: ReturnType<typeof shapeProjections>, poses: Pose[]) =>
      Math.max(
        ...boxAxes.map((axis, k) => {
          const box = items[i]!.intervals[k]!;
          return (
            Math.abs(box.center - dot(poses[sphereBody]!.p, axis)) -
            box.halfWidth -
            physics.sphere.radius
          );
        }),
      );
    const rootBefore = frame.before[roverBody]!,
      rootAfter = frame.after[roverBody]!;
    const anchorReach = norm(sub(frame.before[part.body]!.p, rootBefore.p));
    const rootAngle = norm(worldRotationVector(rootBefore.q, rootAfter.q));
    const hinge = wheelHinges.get(part.body);
    const jointArc =
      hinge === undefined ? 0 : Math.abs(frame.post.qpos[hinge]! - frame.pre.qpos[hinge]!);
    // Bound the root and hinge paths separately; opposing rotations cannot cancel this envelope.
    const sweep =
      norm(sub(rootAfter.p, rootBefore.p)) +
      (anchorReach + part.reach) * rootAngle +
      part.reach * jointArc;
    return Math.min(gap(before, frame.before), gap(after, frame.after)) - sweep - sphereMove;
  });
  return Math.min(...bounds);
}
function withinPlate(poses: Pose[]) {
  for (const part of shapeProjections(poses)) {
    const [x, y] = part.intervals;
    if (
      x!.center - x!.halfWidth < -1 ||
      x!.center + x!.halfWidth > 19 ||
      Math.abs(y!.center) + y!.halfWidth > 0.5
    )
      return false;
  }
  const c = poses[sphereBody]!.p,
    r = physics.sphere.radius;
  return c[0] - r > -1 && c[0] + r < 19 && Math.abs(c[1]) + r < 0.5 && c[2] > 0;
}
function frameMomentum(frame: Frame, mass: number, inertia: number, radius: number) {
  const dt = (frame.to - frame.from) * secondsPerMicrosecond;
  const pre = frame.kinematics[sphereBody]!;
  const postV = sphereVelocity(frame.post),
    postW = sphereOmega(frame.post);
  near(
    norm(sub(pre.velocity, sphereVelocity(frame.pre))),
    0,
    budgets.velocityParityMps,
    'SPHERE_PRE_VELOCITY',
  );
  near(
    norm(sub(pre.omega, sphereOmega(frame.pre))),
    0,
    budgets.velocityParityMps,
    'SPHERE_PRE_OMEGA',
  );
  const bySource = {
    floor: {
      normal: [0, 0, 0] as Vec,
      tangent: [0, 0, 0] as Vec,
      normalMoment: [0, 0, 0] as Vec,
      tangentMoment: [0, 0, 0] as Vec,
    },
    bumper: {
      normal: [0, 0, 0] as Vec,
      tangent: [0, 0, 0] as Vec,
      normalMoment: [0, 0, 0] as Vec,
      tangentMoment: [0, 0, 0] as Vec,
    },
    other: {
      normal: [0, 0, 0] as Vec,
      tangent: [0, 0, 0] as Vec,
      normalMoment: [0, 0, 0] as Vec,
      tangentMoment: [0, 0, 0] as Vec,
    },
  };
  let sumJ: Vec = [0, 0, 0],
    sumMoment: Vec = [0, 0, 0],
    impulseNorm = 0,
    momentNorm = 0;
  for (const c of frame.contacts) {
    if (c.first !== names.sphere && c.second !== names.sphere) continue;
    const other = c.first === names.sphere ? c.second : c.first;
    const force = [vec(c.frame), vec(c.frame, 3), vec(c.frame, 6)].reduce<Vec>(
      (a, axis, i) => add(a, scale(axis, c.force[i]!)),
      [0, 0, 0],
    );
    const impulse = scale(forceOn(c, names.sphere, force), dt);
    const normal = scale(forceOn(c, names.sphere, scale(vec(c.frame), c.force[0])), dt);
    const tangent = sub(impulse, normal),
      lever = sub(c.point, pre.com),
      moment = cross(lever, impulse);
    const slot =
      other === names.floor
        ? bySource.floor
        : other === names.bumper
          ? bySource.bumper
          : bySource.other;
    slot.normal = add(slot.normal, normal);
    slot.tangent = add(slot.tangent, tangent);
    slot.normalMoment = add(slot.normalMoment, cross(lever, normal));
    slot.tangentMoment = add(slot.tangentMoment, cross(lever, tangent));
    sumJ = add(sumJ, impulse);
    sumMoment = add(sumMoment, moment);
    impulseNorm += norm(impulse);
    momentNorm += norm(moment);
  }
  const pPre = scale(pre.velocity, mass),
    pPost = scale(postV, mass),
    lPre = scale(pre.omega, inertia),
    lPost = scale(postW, inertia);
  const gravity: Vec = [0, 0, -mass * 9.81 * dt];
  const residualP = sub(sub(pPost, pPre), add(sumJ, gravity));
  const residualL = sub(sub(lPost, lPre), sumMoment);
  const Bp =
    mass * limits.deltaV +
    128 * Number.EPSILON * (norm(pPre) + norm(pPost) + impulseNorm + mass * 9.81 * dt);
  const BL =
    (inertia / radius) * limits.deltaV +
    128 * Number.EPSILON * (norm(lPre) + norm(lPost) + momentNorm);
  return {
    pPre,
    pPost,
    lPre,
    lPost,
    sumJ,
    sumMoment,
    gravity,
    residualP,
    residualL,
    Bp,
    BL,
    bySource,
  };
}
type Window = { from: number; to: number; start: Vec; rotation: number; minimumClearance: number };
class Witness {
  readonly gears: ReturnType<typeof gearbox>;
  readonly failures = new Map<string, number>();
  private readonly prefix = createHash('sha256');
  private prefixSteps = 0;
  private prefixLastFrom = 0;
  private prefixEnd = 0;
  private readonly stream = createHash('sha256');
  private previous: State | undefined;
  private startCentre: Vec | undefined;
  private resting: Vec | undefined;
  private rolling: Window | undefined;
  private restFrom: number | undefined;
  private uprightRestFrom: number | undefined;
  private controlAnchor: Pose | undefined;
  private priorCurrent = 0;
  private totalArc = 0;
  private maxMove = 0;
  private firstBump: number | undefined;
  private finalLowUs: number | undefined;
  private lateRecontact: { firstUs: number; lastUs: number; intervals: number } | undefined;
  private rollingProof: Window | undefined;
  private flyback = 0;
  private maxControlMove = 0;
  private sphereMass = physics.sphere.mass;
  private sphereInertia = physics.sphere.inertia;
  private sphereRadius = physics.sphere.radius;
  private maxResidualP = 0;
  private maxResidualL = 0;
  private firstMomentumFailure: unknown;
  private firstReversalGap: unknown;
  private firstNegativeGearLoss: unknown;
  private firstWindingGap: unknown;
  step = 0;
  lastTime = 0;
  readonly aggregate = {
    input: 0,
    positiveInput: 0,
    circuit: 0,
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
    signedCircuit: 0,
    geometricContact: 0,
    contactCurvatureBound: 0,
    bumperImpulse: 0,
    bumperForwardImpulse: 0,
    floorAngularImpulse: [0, 0, 0] as Vec,
    bumperAngularImpulse: [0, 0, 0] as Vec,
  };
  constructor(
    readonly world: World,
    private readonly profile: ReturnType<typeof sourcePins>,
  ) {
    this.gears = gearbox(profile);
  }
  configure(readback: ReturnType<typeof widths>) {
    this.sphereMass = readback.masses[sphereBody]!;
    this.sphereInertia = readback.inertia[sphereBody * 3]!;
    this.sphereRadius = readback.sphereRadius;
    near(this.sphereMass, physics.sphere.mass, 0, 'SPHERE_MASS_FROM_MODEL');
    for (let i = 0; i < 3; i++)
      near(
        readback.inertia[sphereBody * 3 + i]!,
        physics.sphere.inertia,
        1e-18,
        'ISOTROPIC_SPHERE_INERTIA',
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
      this.prefixLastFrom = frame.from;
      this.prefixEnd = frame.to;
    }
    const dt = (frame.to - frame.from) * secondsPerMicrosecond,
      a = this.aggregate;
    const postSphere = frame.after[sphereBody]!,
      preSphere = frame.before[sphereBody]!;
    near(norm(sub(preSphere.p, vec(frame.pre.qpos, 10))), 0, 1e-12, 'RAW_PRE_SPHERE_POSE');
    near(norm(sub(postSphere.p, vec(frame.post.qpos, 10))), 0, 1e-12, 'RAW_POST_SPHERE_POSE');
    checkPoseState(frame.pre, frame.before);
    checkPoseState(frame.post, frame.after);
    this.startCentre ??= preSphere.p;
    this.maxMove = Math.max(this.maxMove, norm(sub(postSphere.p, this.startCentre)));
    const arc = norm(worldRotationVector(preSphere.q, postSphere.q));
    this.totalArc += arc;
    const momentum = frameMomentum(frame, this.sphereMass, this.sphereInertia, this.sphereRadius);
    this.maxResidualP = Math.max(this.maxResidualP, norm(momentum.residualP));
    this.maxResidualL = Math.max(this.maxResidualL, norm(momentum.residualL));
    if (norm(momentum.residualP) > momentum.Bp || norm(momentum.residualL) > momentum.BL) {
      this.firstMomentumFailure ??= { from: frame.from, to: frame.to, ...momentum };
      if (norm(momentum.residualP) > momentum.Bp) this.fail('LINEAR_MOMENTUM', frame.to);
      if (norm(momentum.residualL) > momentum.BL) this.fail('ANGULAR_MOMENTUM', frame.to);
    }
    a.floorAngularImpulse = add(
      a.floorAngularImpulse,
      add(momentum.bySource.floor.normalMoment, momentum.bySource.floor.tangentMoment),
    );
    a.bumperAngularImpulse = add(
      a.bumperAngularImpulse,
      add(momentum.bySource.bumper.normalMoment, momentum.bySource.bumper.tangentMoment),
    );
    const winding = windingBalance(frame, this.gears, this.profile, this.priorCurrent, dt);
    this.priorCurrent = frame.circuit.current;
    if (winding.violated) this.firstWindingGap ??= { from: frame.from, to: frame.to, ...winding };
    const gear = signedTransmission(frame, this.gears, dt);
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
    let sphereLoaded = false,
      roverTouches = false,
      bumperImpulse = 0,
      bumperForward = 0;
    const sphereIdentities = frame.census.identities.filter(
      (c) => c.first === names.sphere || c.second === names.sphere,
    );
    const penetratingRover = sphereIdentities.some(
      (c) => c.first !== names.floor && c.second !== names.floor && c.distance < 0,
    );
    for (const c of frame.contacts) {
      const work = pairWork(frame, c, motion);
      a.contact += work.fromRows;
      a.positiveContact += Math.max(0, work.fromRows);
      a.contactAbsorption += Math.max(0, -work.fromRows);
      a.geometricContact += work.geometric;
      a.contactCurvatureBound += norm(work.force) * work.taylorBound;
      if (c.force[0] <= 0) continue;
      if (isPair(c, names.floor, names.chassis) || isPair(c, names.floor, names.bumper))
        this.fail('BODY_DRAGS_ON_FLOOR', frame.from);
      if (c.first !== names.sphere && c.second !== names.sphere) continue;
      const other = c.first === names.sphere ? c.second : c.first;
      if (other === names.floor) {
        const normal = forceOn(c, names.sphere, vec(c.frame));
        if (
          norm(sub(normal, up)) <= limits.normalVectorDistance &&
          dot(forceOn(c, names.sphere, work.force), up) > 0 &&
          Math.abs(c.point[2]) <= limits.clearanceM &&
          c.point[0] > -1 &&
          c.point[0] < 19 &&
          Math.abs(c.point[1]) < 0.5
        )
          sphereLoaded = true;
      } else {
        roverTouches = true;
        if (other === names.bumper) {
          bumperImpulse += c.force[0] * dt;
          bumperForward += forceOn(c, names.sphere, work.force)[0] * dt;
        }
      }
    }
    if (this.rollingProof && roverTouches) {
      this.lateRecontact ??= { firstUs: frame.from, lastUs: frame.to, intervals: 0 };
      this.lateRecontact.lastUs = frame.to;
      this.lateRecontact.intervals++;
    }
    if (this.world === 'powered' && frame.from >= f.programs.offUs && frame.circuit.logic === 0)
      this.finalLowUs ??= frame.from;
    a.bumperImpulse += bumperImpulse;
    a.bumperForwardImpulse += bumperForward;
    const preMetric = sphereMetrics(frame.pre),
      postMetric = sphereMetrics(frame.post);
    const quiet =
      sphereLoaded &&
      !roverTouches &&
      !penetratingRover &&
      norm(preMetric.velocity) <= limits.controlSpeedMps &&
      norm(postMetric.velocity) <= limits.controlSpeedMps &&
      this.sphereRadius * norm(preMetric.omega) <= limits.controlRadiusOmegaMps &&
      this.sphereRadius * norm(postMetric.omega) <= limits.controlRadiusOmegaMps;
    if (roverTouches && this.firstBump === undefined && bumperImpulse === 0)
      this.fail('FIRST_ROVER_CONTACT_NOT_BUMPER', frame.from);
    if (bumperImpulse > 0 && this.firstBump === undefined) {
      this.firstBump = frame.from;
      if (this.restFrom === undefined || frame.from - this.restFrom < limits.staticUs)
        this.fail('NO_50MS_LOADED_REST_BEFORE_BUMPER', frame.from);
      if (bumperForward <= 0) this.fail('NO_POSITIVE_FORWARD_BUMPER_IMPULSE', frame.from);
    }
    this.restFrom = quiet ? (this.restFrom ?? frame.from) : undefined;
    if (frame.to === comparison.interventionUs) this.resting = frame.after[roverBody]!.p;
    if (this.resting)
      this.maxControlMove = Math.max(
        this.maxControlMove,
        norm(sub(frame.after[roverBody]!.p, this.resting)),
      );
    if (this.world === 'control') {
      this.uprightRestFrom = quiet ? (this.uprightRestFrom ?? frame.from) : undefined;
      if (this.uprightRestFrom !== undefined && frame.to - this.uprightRestFrom >= limits.staticUs)
        this.controlAnchor ??= postSphere;
      if (
        this.controlAnchor &&
        (norm(sub(postSphere.p, this.controlAnchor.p)) > limits.controlDriftM ||
          norm(worldRotationVector(this.controlAnchor.q, postSphere.q)) > limits.controlAngleRad ||
          norm(postMetric.velocity) > limits.controlSpeedMps ||
          this.sphereRadius * norm(postMetric.omega) > limits.controlRadiusOmegaMps)
      )
        this.fail('LOW_SPHERE_DID_NOT_REMAIN_AT_REST', frame.to);
      if (roverTouches || penetratingRover) this.fail('LOW_ROVER_CONTACTED_SPHERE', frame.to);
    }
    const gap = sweptSphereClearance(frame);
    const rolls =
      this.firstBump !== undefined &&
      this.firstBump <= frame.from &&
      sphereLoaded &&
      !roverTouches &&
      !penetratingRover &&
      gap > 0 &&
      [preMetric, postMetric].every(
        (s) =>
          s.slip <= limits.tangentSlipMps &&
          Math.abs(s.normalVelocity) <= limits.normalVelocityMps &&
          Math.abs(s.clearance) <= limits.clearanceM,
      );
    if (rolls) {
      this.rolling =
        this.rolling?.to === frame.from
          ? {
              ...this.rolling,
              to: frame.to,
              rotation: this.rolling.rotation + arc,
              minimumClearance: Math.min(this.rolling.minimumClearance, gap),
            }
          : {
              from: frame.from,
              to: frame.to,
              start: preSphere.p,
              rotation: arc,
              minimumClearance: gap,
            };
      if (!this.rollingProof && frame.to - this.rolling.from >= limits.rollingUs) {
        const resolution =
          limits.deltaV * (frame.to - this.rolling.from) * secondsPerMicrosecond +
          128 * Number.EPSILON * Math.max(1, norm(preSphere.p), norm(postSphere.p));
        const progress = norm(sub(postSphere.p, this.rolling.start));
        if (progress > resolution && this.rolling.rotation > resolution / this.sphereRadius)
          this.rollingProof = { ...this.rolling };
      }
    } else this.rolling = undefined;
    if (frame.from >= f.programs.offUs && frame.circuit.logic === 0 && frame.circuit.windV < 0)
      this.flyback = Math.max(this.flyback, frame.circuit.diodeA);
    if (!withinPlate(frame.before) || !withinPlate(frame.after))
      this.fail('FINITE_PLATE_DEPARTURE', frame.to);
  }
  finish(initial: Energy, end: Energy) {
    requireThat(
      this.lastTime === budgets.horizonUs && this.previous && sameState(this.previous, end.state),
      'FULL_MEASURED_HORIZON',
    );
    if (this.world === 'powered') {
      if (this.firstBump === undefined || this.aggregate.bumperForwardImpulse <= 0)
        this.fail('MISSING_BUMPER_IMPULSE', this.lastTime);
      if (this.maxMove < limits.minimumDisplacementM)
        this.fail('INSUFFICIENT_SPHERE_MOVEMENT', this.lastTime);
      if (this.totalArc < limits.minimumAccumulatedRotationRad)
        this.fail('INSUFFICIENT_NATIVE_ROTATION', this.lastTime);
      if (!this.rollingProof) this.fail('MISSING_FREE_ROLLING_WINDOW', this.lastTime);
      if (this.finalLowUs !== f.programs.offUs)
        this.fail('ACTUAL_FINAL_LOW_BOUNDARY', this.lastTime);
      if (this.flyback < 1e-6) this.fail('NO_LOW_NEGATIVE_VOLTAGE_FLYBACK', this.lastTime);
    } else {
      if (!this.controlAnchor || this.maxControlMove > limits.controlRoverTravelM)
        this.fail('LOW_CONTROL_TRAVEL_OR_REST', this.lastTime);
    }
    const a = this.aggregate;
    const deltaStored =
      end.potential + end.kinetic - initial.potential - initial.kinetic + a.magnet;
    const contactAbsorption = a.contactAbsorption;
    const dissipation =
      a.circuit + a.copper + a.viscous + a.transmission + a.electricalEuler + contactAbsorption;
    const residualJ = deltaStored + dissipation - a.input;
    const limitJ = Math.max(
      budgets.absoluteEnergyLimitJ,
      budgets.relativeEnergyLimit * a.positiveInput,
    );
    return {
      world: this.world,
      step: this.step,
      acceptedTime: this.lastTime,
      physical: this.failures.size ? 'FAIL' : 'PASS',
      failures: Array.from(this.failures),
      firstBump: this.firstBump ?? null,
      maximumDisplacementM: this.maxMove,
      accumulatedRotationRad: this.totalArc,
      rollingWindow: this.rollingProof ?? null,
      flyback: this.flyback,
      finalLowUs: this.finalLowUs ?? null,
      lateRecontact: this.lateRecontact ?? null,
      maximumControlRoverTravelM: this.maxControlMove,
      prefix: {
        intervals: this.prefixSteps,
        throughUs: this.prefixEnd,
        lastFromUs: this.prefixLastFrom,
        sha256: this.prefix.digest('hex'),
      },
      streamSha256: this.stream.digest('hex'),
      momentum: {
        maximumResidualP: this.maxResidualP,
        maximumResidualL: this.maxResidualL,
        firstFailure: this.firstMomentumFailure ?? null,
      },
      energy: {
        ...a,
        deltaStored,
        contactAbsorption,
        dissipation,
        residualJ,
        limitJ,
        budgetAccepted: Math.max(0, residualJ) <= limitJ,
        firstActualReversalGap: this.firstReversalGap ?? null,
        firstNegativeTransmission: this.firstNegativeGearLoss ?? null,
        firstWindingGap: this.firstWindingGap ?? null,
        historicalCausalStatus: 'GAP_CAUSAL_ALT',
        formalAcceptance: 'D01_D02_OPEN',
      },
    };
  }
}
type Outcome = ReturnType<Witness['finish']>;

const kindNames = { meta: 'arduino-tt-sphere-push.jsonl', intervals: 'arduino-tt-sphere-push.bin' };
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
const nativeMode = process.env['ASA_TT_SPHERE_NATIVE'] === 'one-frozen-pair-1071';
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
  const license = process.env['ASA_TT_SPHERE_LICENSE'] ?? '';
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
    [fixtureUrl, 'ASA_TT_SPHERE_FIXTURE_SHA256'],
    [sourceUrl, 'ASA_TT_SPHERE_SOURCE_SHA256'],
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
async function loadNative(input: ReturnType<typeof enginePins>) {
  const path = join(input.path, eng.glue.file);
  pinned(path, eng.glue);
  const { default: factory } = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as {
    default(options: { wasmBinary: Buffer; locateFile(name: string): string }): Promise<Native>;
  };
  pinned(path, eng.glue);
  const M = await factory({
    wasmBinary: input.wasm,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'NO_UNREGISTERED_NATIVE_RESOURCE');
      return join(input.path, name);
    },
  });
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
      runId: 'sphere-push:' + world,
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
      const alternative = appliesAlternative(query.fromMicroseconds);
      const effort = appliedShaft(pre, electrical, history.gears, dt, alternative);
      model.opt.timestep = dt;
      near(model.opt.timestep, dt, 0, 'NATIVE_STEP_DT');
      stage = 'native-step1';
      ledger.step1++;
      dispatch.step1++;
      M.mj_step1(model, data);
      ledger.step1Returned++;
      dispatch.step1Returned++;
      requireThat(sameState(pre, state(data)), 'STEP1_CANNOT_ADVANCE_STATE');
      const before = poseState(data);
      if (pending) {
        requireThat(sameState(pending.post, pre), 'DEFERRED_POST_POSE_IDENTITY');
        flush(before);
      }
      stage = 'pre-constraint-observation';
      const constraints = preConstraints(M, model, data, pre, vectorBuffer, ledger, capacity);
      journal.reserve(constraints.contacts.filter((c) => c.address >= 0).length);
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
      action(data, effort.torque);
      const applied = finite(data.qfrc_applied[axleV], 'NATIVE_APPLIED_SHAFT_READBACK');
      pending = {
        from: query.fromMicroseconds,
        to: query.toMicroseconds,
        pre,
        post,
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
    }
    requireThat(complete, 'SESSION_BOUNDED_HORIZON_NOT_REACHED');
  } catch (e) {
    firstError = e;
    if (ledger.step1 > 0 || ledger.step2 > 0) firstNativeError = e;
  }
  const cleanup: string[] = [];
  try {
    if (session) {
      session.dispose();
      dispatch.sessionsDisposed++;
    }
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
      cleanup: [...cleanup, ...ledger.cleanupErrors],
    },
    true,
  );
  if (firstError || cleanup.length || ledger.cleanupErrors.length) {
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
    throw (
      firstNativeError ??
      firstError ??
      new Error('CLEANUP_FAILED ' + [...cleanup, ...ledger.cleanupErrors].join('; '))
    );
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
    { p: vec(s.qpos, 10), q: quat(s.qpos, 13) },
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
function sphereBoxDistance(poses: Pose[]) {
  const root = poses[roverBody]!,
    q = multiplyQuat(root.q, quat(boom.quatWxyz));
  const centre = add(root.p, rotate(root.q, vec(boom.centerM)));
  const local = rotate([q[0], -q[1], -q[2], -q[3]], sub(poses[sphereBody]!.p, centre));
  const closest: Vec = vec(
    local.map((v, i) => Math.max(-boom.halfSizeM[i]!, Math.min(boom.halfSizeM[i]!, v))),
  );
  return norm(sub(local, closest)) - physics.sphere.radius;
}
function initialState(): State {
  return {
    seconds: 0,
    qpos: [
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
      physics.sphere.startX,
      0,
      physics.sphere.radius,
      1,
      0,
      0,
      0,
    ],
    qvel: Array<number>(nv).fill(0),
  };
}
function rawSchema() {
  return {
    version: 'ASA_TT_SPHERE_PUSH_F64_LE_V1',
    byteOrder: 'little-endian',
    headerBytes: recordFootprint,
    contactBytes: cap.contactBytes,
    headerWords,
    headerFields: [
      'fromUs',
      'toUs',
      'preSeconds',
      'postSeconds',
      'activeContactCount',
      'preQpos[17]',
      'preQvel[15]',
      'postQpos[17]',
      'postQvel[15]',
      'preFiveBody(p3,q4)',
      'postFiveBody(p3,q4)',
      'preFiveBody(com3,linear3,angular3)',
      ...electricKeys,
    ],
    censusOffset,
    censusSlotsOffset,
    censusSlots: cap.maxContactsPerInterval,
    censusEncoding:
      'uint16: first[0:3],second[4:7],exclude[8:10],active[11]; reserved bits zero; uint16 ncon/nefc first',
    sphereDistancesOffset,
    sphereDistanceSlots: Array.from({ length: 7 }, (_, id) => ({
      otherGeom: id,
      byteOffset: sphereDistancesOffset + id * 8,
    })),
    appliedOffset,
    appliedEnd,
    appliedFields: ['actualTorqueNm', 'actualImpulseNms'],
    contactEncoding:
      'uint16 first,second,rowTypes,addressGroup|(contactIndex<<8), then F64 point3,normal+tangentFrame9,force3,PRE-constraintVelocity3,J_PRE*configurationTangent3',
    bodyNames: f.expected.bodies,
    geomNames: f.expected.geoms,
    geomBodies,
    actualContactOrder:
      'Native geom order is retained; positive normal force acts on second geom. Derive signed force on sphere from its actual side.',
    noDenseJacobian: true,
    maximumPairBytes: rawUpperBytes,
  };
}
function replayPair(root: string, outcomes: Outcome[]) {
  const bytes = readFileSync(join(root, kindNames.intervals));
  const metadata = readFileSync(join(root, kindNames.meta), 'utf8')
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line, (_key, value: unknown) =>
          value === 'float64:-0' ? -0 : value,
        ) as JsonLine,
    );
  const profile = sourcePins();
  let offset = 0;
  const replayed = [];
  for (const outcome of outcomes) {
    const start = metadata.find(
      (record) => record.kind === 'world-start' && record.world === outcome.world,
    );
    const end = metadata.find(
      (record) => record.kind === 'world-end' && record.world === outcome.world,
    );
    requireThat(
      start && end && start.baseOffset === offset && ints(outcome.step, cap.maxIntervalsPerWorld),
      'REPLAY_WORLD_HEADER',
    );
    const initial = start.initial as Energy,
      final = end.final as Energy;
    checkEndpointEnergy(initial);
    checkEndpointEnergy(final);
    const witness = new Witness(outcome.world, profile);
    witness.configure(start.readback as ReturnType<typeof widths>);
    for (let tick = 0; tick < outcome.step; tick++) {
      requireThat(offset + recordFootprint <= bytes.length, 'REPLAY_HEADER_TRUNCATED');
      const n = bytes.readDoubleLE(offset + 4 * 8);
      requireThat(ints(n, cap.maxContactsPerInterval), 'REPLAY_CONTACT_COUNT');
      const size = recordFootprint + n * cap.contactBytes;
      requireThat(offset + size <= bytes.length, 'REPLAY_FRAME_TRUNCATED');
      const raw = bytes.subarray(offset, offset + size),
        frame = decodeInterval(raw);
      checkPoseState(frame.pre, frame.before);
      checkPoseState(frame.post, frame.after);
      witness.observe(frame, raw);
      offset += size;
    }
    requireThat(offset === end.endOffset, 'REPLAY_WORLD_END_OFFSET');
    const recalculated = witness.finish(initial, final);
    requireThat(
      JSON.stringify(recalculated) === JSON.stringify(outcome),
      'REPLAY_ALL_PHYSICAL_AND_ENERGY_OUTCOMES',
    );
    replayed.push(recalculated);
  }
  requireThat(offset === bytes.length, 'REPLAY_TRAILING_BYTES');
  return { bytes: bytes.length, sha256: hash(bytes), worlds: replayed };
}

it('pins the exact canonical five-component circuits and original Arduino traces at budgets one and 256', () => {
  sourcePins();
  for (const world of ['powered', 'control'] as const) {
    const circuit = buildCircuit(world);
    expect([circuit.components.length, circuit.connections.length]).toEqual([5, 7]);
    expect(hash(JSON.stringify(circuit))).toBe(f.circuitSha256[world]);
    for (const budget of [1, 256]) expect(pureUno(world, budget)).toEqual(f.programs[world].gpio);
  }
  expect(
    f.programs.powered.gpio.filter((e) => 'voltageVolt' in e && e.voltageVolt === 5)[0]!
      .atMicroseconds,
  ).toBe(250003);
  expect(f.programs.powered.gpio.at(-1)!.atMicroseconds).toBe(4340082);
});
it('proves the actual 15cm sphere, finite common plate, separated original rover and potential leading bumper hit', () => {
  expect(physics.sphere.radius * 2).toBe(0.15);
  near(
    physics.sphere.inertia,
    (2 * physics.sphere.mass * physics.sphere.radius ** 2) / 5,
    1e-18,
    'HOMOGENEOUS_SPHERE',
  );
  const floor = createEditableRampGeometry({
    lengthMeters: 20,
    widthMeters: 1,
    riseMeters: 0,
    baseThicknessMeters: 0.05,
    originMeters: [-1, 0, 0],
    headingRadians: 0,
  });
  expect(floor.vertices).toEqual(physics.floor.vertices);
  expect(floor.faces).toEqual(physics.floor.faces);
  const state = initialState(),
    poses = posesFromState(state);
  expect(sphereBoxDistance(poses)).toBeGreaterThan(0.7);
  expect(withinPlate(poses)).toBe(true);
  let lo = -0.25,
    hi = physics.sphere.startX - boom.centerM[0]!;
  const distance = (x: number) => {
    const moved = structuredClone(state);
    moved.qpos[0] = x;
    return sphereBoxDistance(posesFromState(moved));
  };
  expect(distance(hi)).toBeLessThan(0);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (distance(mid) > 0) lo = mid;
    else hi = mid;
  }
  expect(hi).toBeLessThan(physics.sphere.startX - physics.sphere.radius - 0.1);
  expect(f.expected.pairs).toHaveLength(13);
  expect(xml.split(f.rover.xml.join('\n')).length).toBe(2);
});
function syntheticFrame(): Frame {
  const pre = initialState(),
    post = structuredClone(pre);
  post.seconds = 0.0005;
  post.qvel[11] = -9.81 * 0.0005;
  post.qpos[12]! += post.qvel[11]! * 0.0005;
  return {
    from: 0,
    to: 500,
    pre,
    post,
    before: posesFromState(pre),
    after: posesFromState(post),
    kinematics: Array.from({ length: nbody }, (_, id) => ({
      com: posesFromState(pre)[id]!.p,
      velocity: [0, 0, 0] as Vec,
      omega: [0, 0, 0] as Vec,
    })),
    contacts: [],
    census: { identities: [], nativeRowCount: 0 },
    circuit: Object.fromEntries(electricKeys.map((key) => [key, 0])) as Electrical,
  };
}
function withContact(frame: Frame, force: Vec): Frame {
  const point = sub(frame.before[sphereBody]!.p, [physics.sphere.radius, 0, 0]);
  frame.contacts = [
    {
      index: 0,
      address: 0,
      rowTypes: 0x777,
      first: names.bumper,
      second: names.sphere,
      point,
      frame: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      force,
      velocity: [0, 0, 0],
      jacDelta: [0, 0, 0],
    },
  ];
  frame.census = {
    nativeRowCount: 3,
    identities: [
      { first: names.bumper, second: names.sphere, exclude: 0, active: true, distance: -0.00001 },
    ],
  };
  return frame;
}
it('reconstructs signed linear and angular impulse without inventing spin from radial normal impact', () => {
  const frame = withContact(syntheticFrame(), [1, 0, 0]),
    m = physics.sphere.mass,
    I = physics.sphere.inertia,
    r = physics.sphere.radius;
  frame.post.qvel[9] = 0.0005 / m;
  let measured = frameMomentum(frame, m, I, r);
  expect(norm(measured.residualP)).toBeLessThan(measured.Bp);
  expect(norm(measured.residualL)).toBeLessThan(measured.BL);
  expect(measured.bySource.bumper.normalMoment).toEqual([0, 0, 0]);
  frame.contacts[0]!.force = [1, 0, 1];
  frame.post.qvel[11] += 0.0005 / m;
  frame.post.qvel[13] = (r * 0.0005) / I;
  measured = frameMomentum(frame, m, I, r);
  expect(norm(measured.residualP)).toBeLessThan(measured.Bp);
  expect(norm(measured.residualL)).toBeLessThan(measured.BL);
  expect(measured.bySource.bumper.tangentMoment[1]).toBeGreaterThan(0);
  frame.post.qvel[13] += 0.01;
  measured = frameMomentum(frame, m, I, r);
  expect(norm(measured.residualL)).toBeGreaterThan(measured.BL);
});
it('packs every signed force, row, sphere gap and endpoint losslessly inside the fixed worst-case pair envelope', () => {
  const original = withContact(syntheticFrame(), [1, 0, 1]);
  const encoded = encodeInterval(original),
    decoded = decodeInterval(encoded);
  expect(decoded).toEqual(original);
  expect(rawUpperBytes).toBeLessThanOrEqual(cap.byteCap);
  expect(appliedEnd).toBeLessThanOrEqual(recordFootprint);
  expect(encoded.length).toBe(recordFootprint + cap.contactBytes);
  const bad = Buffer.from(encoded);
  bad.writeDoubleLE(NaN, sphereDistancesOffset + names.bumper * 8);
  expect(() => decodeInterval(bad)).toThrow('RAW_SPHERE_DISTANCE');
  original.census.nativeRowCount = 0;
  expect(() => encodeInterval(original)).toThrow('CENSUS_COUNTS');
});
it('compares native contact work to PRE tangent work with a bounded finite-chord remainder', () => {
  const frame = withContact(syntheticFrame(), [0, 0, 1]);
  frame.post.qvel.fill(0);
  frame.post.qpos = frame.pre.qpos.slice();
  const angle = 0.5;
  frame.post.qpos.splice(13, 4, Math.cos(angle / 2), 0, Math.sin(angle / 2), 0);
  frame.after = posesFromState(frame.post);
  frame.contacts[0]!.jacDelta = [0, 0, physics.sphere.radius * angle];
  const work = pairWork(frame, frame.contacts[0]!);
  expect(work.curvature).toBeLessThanOrEqual(work.taylorBound + 1e-12);
  expect(Math.abs(work.geometric - work.fromRows)).toBeGreaterThan(
    workAgreement(work.geometric, work.fromRows),
  );
});
it('requires true contact-free rolling progress and uses measured POST quaternion for free-joint omega', () => {
  const frame = syntheticFrame();
  frame.post.qpos.splice(13, 4, Math.SQRT1_2, 0, 0, Math.SQRT1_2);
  frame.post.qvel[12] = 1;
  const w = sphereOmega(frame.post);
  near(w[0], 0, 1e-15, 'POST_QUATERNION_X');
  near(w[1], 1, 1e-15, 'POST_QUATERNION_Y');
  const close = structuredClone(frame);
  close.after[sphereBody]!.p = [0, 0, 0.075];
  expect(sweptSphereClearance(close)).toBeLessThan(0);
});
it('borrows the seven-entry native warning vector and releases only copied entries', () => {
  let vectorDeletes = 0;
  let copyDeletes = 0;
  const warning = {
    size: () => 7,
    get: () => ({
      number: 0,
      lastinfo: 0,
      delete: () => {
        copyDeletes++;
      },
    }),
    delete: () => {
      vectorDeletes++;
    },
  };
  const ledger = newLedger();
  warnings({ warning } as unknown as Data, ledger);
  expect([vectorDeletes, copyDeletes, ledger.created, ledger.deleted]).toEqual([0, 7, 7, 7]);
  const failing = {
    ...warning,
    get: () => ({
      number: 0,
      lastinfo: 0,
      delete: () => {
        throw new Error('copy-delete');
      },
    }),
  };
  const failureLedger = newLedger();
  expect(() => warnings({ warning: failing } as unknown as Data, failureLedger)).toThrow(
    'WARNING_COPY_CLEANUP_FAILED',
  );
  expect(failureLedger.cleanupErrors).toHaveLength(7);
  expect(vectorDeletes).toBe(0);
});
it.skipIf(!process.env['ASA_TT_SPHERE_ENGINE'] || !process.env['ASA_TT_SPHERE_LICENSE'])(
  'checks the same admitted AOT bytes without importing native',
  () => {
    const input = enginePins(process.env['ASA_TT_SPHERE_ENGINE']!);
    expect(input.declarations.toString()).toContain('mj_step2(');
  },
);

it.skipIf(!nativeMode)(
  'acquires one fresh real Arduino powered sphere-push and matched LOW native pair',
  async () => {
    const root = externalReceiptRoot(process.env['ASA_TT_SPHERE_OUTPUT'] ?? '');
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
      const sources = exactSourcePins(),
        profile = sourcePins();
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
      const engine = enginePins(process.env['ASA_TT_SPHERE_ENGINE'] ?? '');
      journal.write({
        kind: 'header',
        scope: 'TEST_ONLY',
        sources,
        runtimeSources,
        fixture: f,
        schema: rawSchema(),
        circuitHashes: circuits,
        pureGpio,
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        nativeInitialized: false,
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
      physical = powered.physical === 'PASS' && control.physical === 'PASS' ? 'PASS' : 'FAIL';
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
          historicalR5Causal: 'GAP_CAUSAL_ALT',
          initialized,
          census,
          outcomes: [powered, control],
          replay,
          binary: { bytes: journal.binaryBytes, sha256: journal.digest.copy().digest('hex') },
        },
        true,
      );
    } catch (error) {
      failure = error;
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
    } finally {
      journal.close();
    }
    if (failure) throw failure;
    expect(physical).toBe('PASS');
    expect(energyBudget).toBe('PASS');
  },
  360000,
);
