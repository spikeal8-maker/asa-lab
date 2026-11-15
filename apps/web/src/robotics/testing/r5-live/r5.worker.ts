import {
  createElectronicsTtNativeDriveTestSession,
  parseElectronicsEngineDocument,
} from '@asa-lab/electronics/engine';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';

export type XYZ = readonly [number, number, number];
export type WXYZ = readonly [number, number, number, number];
const bodyNames = [
  'rover',
  'rear-axle',
  'front-left-wheel',
  'front-right-wheel',
  'empty-can',
] as const;
export type R5BodyName = (typeof bodyNames)[number];
export type R5RunCase = 'powered' | 'control';
export type R5StandScene = {
  geometries: {
    id: string;
    body: R5BodyName | null;
    positionMeters: XYZ;
    quaternionWxyz: WXYZ;
    shape:
      | { kind: 'box'; halfExtentsMeters: XYZ }
      | { kind: 'cylinder'; radiusMeters: number; halfHeightMeters: number }
      | { kind: 'mesh'; verticesMeters: XYZ[]; triangles: XYZ[] };
  }[];
};
export type R5Landmark = {
  key:
    | 'settled'
    | 'mixed'
    | 'ramp'
    | 'top'
    | 'impact'
    | 'tip'
    | 'final-low'
    | 'free-side'
    | 'late-recontact';
  atMicroseconds: number;
  value?: number;
};
export type R5StandSnapshot = {
  generation: number;
  tickId: number;
  atMicroseconds: number;
  poses: { body: R5BodyName; positionMeters: XYZ; quaternionWxyz: WXYZ }[];
  telemetry: null | {
    gpioD5Volt: number;
    windingVoltageVolt: number;
    windingCurrentAmp: number;
    shaftAngularVelocityRadPerSecond: number;
    appliedTorqueNm: number;
  };
  landmarks: R5Landmark[];
};
export type R5StandCommand =
  | { kind: 'reset'; generation: number; runCase: R5RunCase }
  | { kind: 'play' | 'pause' | 'resume' | 'dispose'; generation: number };
export type R5StandEvent =
  | {
      kind: 'ready';
      generation: number;
      runCase: R5RunCase;
      pins: Pins;
      scene: R5StandScene;
      circuit: CircuitDisplay;
      snapshot: R5StandSnapshot;
    }
  | { kind: 'snapshot'; snapshot: R5StandSnapshot }
  | {
      kind: 'phase';
      generation: number;
      tickId: number;
      atMicroseconds: number;
      phase: 'running' | 'paused' | 'complete' | 'fault' | 'disposed';
      error?: string;
    }
  | { kind: 'proof'; generation: number; record: unknown };

type CircuitDisplay = {
  components: { id: string; type: string; label: string }[];
  connections: {
    from: { componentId: string; terminalId: string };
    to: { componentId: string; terminalId: string };
  }[];
  arduinoSource: string;
};
type Pins = {
  buildCommit: string;
  fixtureSha256: string;
  xmlSha256: string;
  glueSha256: string;
  wasmSha256: string;
  circuitSha256: string;
};
type Fixture = {
  schema: string;
  xml: string[];
  xmlSha256: string;
  comparison: { interventionUs: number; prefixIntervals: number };
  programs: { powered: Program; control: Program; divergeUs: number; offUs: number };
  expected: {
    bodies: string[];
    geoms: string[];
    joints: string[];
    qposAdr: number[];
    dofAdr: number[];
    pairs: { ids: [number, number]; friction: number }[];
  };
  engine: { profile: Record<string, number | number[]> };
  motor: { profileId: string; gearRatio: number; reflectedInertiaKgM2: number };
  raw: {
    maxIntervalsPerWorld: number;
    maxSessionCalls: number;
    maxContactsPerWorld: number;
    maxContactsPerInterval: number;
    maxRowsPerInterval: number;
    byteCap: number;
  };
  budgets: {
    horizonUs: number;
    maxStepUs: number;
    maxEvents: number;
    clockToleranceUs: number;
    velocityParityMps: number;
    terminalReadTolerance: number;
  };
  physical: {
    terrain: {
      halfY: number;
      height: number;
      angleDeg: number;
      lower: number[];
      slope: number[];
      upper: number[];
      vertices: XYZ[];
      faces: XYZ[];
    };
    wheelRadius: number;
    wheelHalfWidth: number;
    can: {
      startX: number;
      radius: number;
      height: number;
      comHeight: number;
      initialComZ: number;
      tipAngleRad: number;
    };
    boom: { centerM: XYZ; halfSizeM: XYZ; quatWxyz: WXYZ };
    limits: {
      staticUs: number;
      rampUs: number;
      sideUs: number;
      maxSlipMps: number;
      minElevationM: number;
      canUprightDeg: number;
      canSideFromHorizontalDeg: number;
      canDropFraction: number;
      impactAboveComM: number;
      controlMaxTravelM: number;
      controlPositiveShaftMaxJ: number;
      faceDistanceM: number;
      faceNormalAllowDeg: number;
    };
  };
};
type Program = {
  source: string;
  gpio: {
    kind: string;
    sequence: number;
    terminal: string;
    atMicroseconds: number;
    mode?: string;
    voltageVolt?: number;
    voltage?: number;
  }[];
};
type Pose = { p: XYZ; q: WXYZ };
type NativeState = { time: number; qpos: number[]; qvel: number[] };
type Handle = { delete(): void };
type Vector<T> = { size(): number; get(index: number): T | undefined };
type BufferHandle = Handle & { GetView(): Float64Array };
type ContactHandle = Handle & {
  geom: ArrayLike<number>;
  geom1: number;
  geom2: number;
  dim: number;
  efc_address: number;
  exclude: number;
  dist: number;
  pos: ArrayLike<number>;
  frame: ArrayLike<number>;
};
type Model = Handle & Record<string, unknown> & { opt: Record<string, unknown> };
type Data = Handle &
  Record<string, unknown> & {
    time: number;
    qpos: Float64Array;
    qvel: Float64Array;
    qfrc_applied: Float64Array;
    ncon: number;
    nefc: number;
    nJ: number;
    contact: Handle & Vector<ContactHandle>;
    warning: Vector<Handle & { number: number; lastinfo: number }>;
  };
type Native = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  DoubleBuffer: new (length: number) => BufferHandle;
  mj_versionString(): string;
  mj_id2name(model: Model, type: number, id: number): string;
  mj_maxContact(model: Model, a: number, b: number, dim: number): number;
  mj_isSparse(model: Model): number;
  mj_forward(model: Model, data: Data): void;
  mj_step1(model: Model, data: Data): void;
  mj_step2(model: Model, data: Data): void;
  mj_contactForce(model: Model, data: Data, contact: number, out: BufferHandle): void;
  mj_objectVelocity(
    model: Model,
    data: Data,
    type: number,
    id: number,
    out: BufferHandle,
    local: number,
  ): void;
  mj_differentiatePos(
    model: Model,
    output: BufferHandle,
    dt: number,
    before: number[],
    after: number[],
  ): void;
  mj_mulM(model: Model, data: Data, output: BufferHandle, v: number[]): void;
};
type Session = ReturnType<typeof createElectronicsTtNativeDriveTestSession>;
type Query = Extract<NonNullable<ReturnType<Session['step']>>, { kind: 'shaft-interval' }>;
type Contact = {
  first: number;
  second: number;
  index: number;
  address: number;
  exclude: number;
  dist: number;
  point: XYZ;
  frame: number[];
};
type Loaded = Contact & { force: XYZ; velocity: XYZ; delta: XYZ };
type Span = { from: number; to: number };
type Electrical = ReturnType<typeof observeCircuit>;

declare const __R5_BUILD_COMMIT__: string;

const assetPins = {
  fixtureSha256: '6a1b46d96489db96e927f24cdbc59d497a11b864b36572287adc05fa51dcf07d',
  xmlSha256: 'acc67614d9a64117311867895679719ac1c9bd5031ee2e2718e7ad41d94673c0',
  glueSha256: '9507aabcc8d80deea66e7f93053092a98857381f087ff0a7e19cefe412ccc1d8',
  wasmSha256: 'd2caf28d73afa997a2534ef0aa940587757c16797653bf476c22994bd2405241',
} as const;
const circuitPins = {
  powered: 'ce2494ba0736c27b045096f38324174df2691eb241317aefdb6c53fc1cebd49e',
  control: '4a4b9d3d8cedec0cfdc25ffc91ca8b7fb0a5e411e8b8f65b0356dee0879fbf06',
};
const ids = ['uno', 'battery', 'left-motor', 'left-fet', 'left-flyback'] as const;
const [unoId, batteryId, motorId, fetId, diodeId] = ids;
const port = 'tt-left-output';
const nq = 17,
  nv = 15,
  nbody = 6,
  ngeom = 10,
  axleQ = 7,
  axleV = 6;
const [lower, slope, upper, chassis, bumper, rearLeft, rearRight, frontLeft, frontRight, can] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;
const wheelIds = [rearLeft, rearRight, frontLeft, frontRight] as const;
const geomBodies = [0, 0, 0, 1, 1, 2, 2, 3, 4, 5];
const basis: XYZ[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const up: XYZ = [0, 0, 1];
const unit: WXYZ = [1, 0, 0, 0];
const zero: XYZ = [0, 0, 0];
// Exact calibrated R5 lower-loss branch. The packager checks the canonical profile source hash.
const kt = 0.004265352474862795;
const motorViscosity = 5.430815443229305e-7;
const minimumFlybackCurrent = 1e-6;
const scope = self as unknown as {
  onmessage: (event: MessageEvent<unknown>) => void;
  postMessage: (event: R5StandEvent) => void;
};

function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function finite(value: unknown, code: string): number {
  requireThat(typeof value === 'number' && Number.isFinite(value), code);
  return value;
}
function near(value: number, target: number, epsilon: number, code: string): void {
  requireThat(Number.isFinite(value) && Math.abs(value - target) <= epsilon, code);
}
function f64(value: unknown, length: number, code: string): Float64Array {
  requireThat(
    value instanceof Float64Array && value.length === length && value.every(Number.isFinite),
    code,
  );
  return value;
}
function i32(value: unknown, length: number, code: string): number[] {
  requireThat(value instanceof Int32Array && value.length === length, code);
  return Array.from(value);
}
function arrayEq(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  return (
    left.length === right.length &&
    Array.from(left).every((word, index) => Object.is(word, right[index]))
  );
}
function vec(value: ArrayLike<number>, offset = 0): XYZ {
  return [
    finite(value[offset], 'VEC_X'),
    finite(value[offset + 1], 'VEC_Y'),
    finite(value[offset + 2], 'VEC_Z'),
  ];
}
function quat(value: ArrayLike<number>, offset = 0): WXYZ {
  return [finite(value[offset], 'QUAT_W'), ...vec(value, offset + 1)];
}
const add = (a: XYZ, b: XYZ): XYZ => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: XYZ, b: XYZ): XYZ => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: XYZ, s: number): XYZ => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a: XYZ, b: XYZ): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: XYZ, b: XYZ): XYZ => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: XYZ): number => Math.hypot(...v);
const radians = (deg: number): number => (deg * Math.PI) / 180;
const conjugate = (q: WXYZ): WXYZ => [q[0], -q[1], -q[2], -q[3]];
function rotate(q: WXYZ, p: XYZ): XYZ {
  const axis = vec(q, 1);
  const t = scale(cross(axis, p), 2);
  return add(p, add(scale(t, q[0]), cross(axis, t)));
}
function multiply(a: WXYZ, b: WXYZ): WXYZ {
  const av = vec(a, 1),
    bv = vec(b, 1);
  return [a[0] * b[0] - dot(av, bv), ...add(add(scale(bv, a[0]), scale(av, b[0])), cross(av, bv))];
}
function rotationDistance(a: WXYZ, b: WXYZ): number {
  const q = multiply(b, conjugate(a));
  return 2 * Math.atan2(norm(vec(q, 1)), Math.abs(q[0]));
}
const pairKey = (a: number, b: number): number => Math.min(a, b) * ngeom + Math.max(a, b);
const state = (data: Data): NativeState => ({
  time: finite(data.time, 'NATIVE_TIME'),
  qpos: Array.from(f64(data.qpos, nq, 'NATIVE_QPOS')),
  qvel: Array.from(f64(data.qvel, nv, 'NATIVE_QVEL')),
});
function timeUs(value: NativeState, tolerance: number): number {
  const time = value.time * 1e6;
  const rounded = Math.round(time);
  near(time, rounded, tolerance, 'NATIVE_INTEGER_TIME');
  return rounded;
}
function keepSpan(previous: Span | null, from: number, to: number, keep: boolean): Span | null {
  if (!keep) return null;
  return { from: previous?.to === from ? previous.from : from, to };
}
async function sha(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
async function fetchPinned(url: URL, hash: string, contentType: string): Promise<ArrayBuffer> {
  requireThat(url.origin === self.location.origin, 'SAME_ORIGIN_ASSET');
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  requireThat(
    response.ok &&
      response.url === url.href &&
      response.headers.get('content-type')?.split(';')[0] === contentType,
    'ASSET_REQUEST_OR_MIME',
  );
  const bytes = await response.arrayBuffer();
  requireThat(bytes.byteLength <= 12_000_000 && (await sha(bytes)) === hash, 'ASSET_SHA256');
  return bytes;
}
async function loadAssets() {
  const url = (name: string) => new URL('../engine/' + name, self.location.href);
  const [fixtureBytes, , wasm] = await Promise.all([
    fetchPinned(url('r5.fixture.json'), assetPins.fixtureSha256, 'application/json'),
    fetchPinned(url('mujoco.js'), assetPins.glueSha256, 'text/javascript'),
    fetchPinned(url('mujoco.wasm'), assetPins.wasmSha256, 'application/wasm'),
  ]);
  const fixture = JSON.parse(new TextDecoder().decode(fixtureBytes)) as Fixture;
  const xml = fixture.xml.join('\n') + '\n';
  requireThat(
    fixture.xmlSha256 === assetPins.xmlSha256 && (await sha(encode(xml))) === assetPins.xmlSha256,
    'R5_XML',
  );
  const source = url('mujoco.js').href;
  const { default: factory } = (await import(/* @vite-ignore */ source)) as {
    default(options: {
      wasmBinary: ArrayBuffer;
      locateFile(name: string): string;
    }): Promise<Native>;
  };
  const native = await factory({
    wasmBinary: wasm,
    locateFile(name) {
      requireThat(name === 'mujoco.wasm', 'UNREGISTERED_EMSCRIPTEN_FILE');
      return url(name).href;
    },
  });
  requireThat(native.mj_versionString() === '4.0.0', 'PINNED_ENGINE_VERSION');
  return { fixture, native, xml };
}
type Assets = Awaited<ReturnType<typeof loadAssets>>;

async function circuit(f: Fixture, runCase: R5RunCase) {
  const starter = createInitialRoboticsProject().circuit;
  const source = f.programs[runCase].source;
  const include = (id: string) => ids.some((one) => one === id);
  const parsed = parseElectronicsEngineDocument({
    ...starter,
    components: starter.components
      .filter(({ id }) => include(id))
      .map((component) =>
        component.id === unoId
          ? {
              ...component,
              stateProperties: { arduinoCodeMode: 'text', arduinoSource: source },
            }
          : component,
      ),
    connections: starter.connections.filter(
      ({ from, to }) => include(from.componentId) && include(to.componentId),
    ),
  });
  requireThat(parsed.ok, 'CANONICAL_R5_CIRCUIT');
  const document = parsed.document;
  requireThat(
    document.components.length === 5 &&
      document.connections.length === 7 &&
      (await sha(encode(JSON.stringify(document)))) === circuitPins[runCase],
    'R5_RUNTIME_CIRCUIT_SHA256',
  );
  const display: CircuitDisplay = {
    components: document.components.map((part) => {
      const type =
        (part as { type?: string; typeId?: string }).type ??
        (part as { typeId?: string }).typeId ??
        part.id;
      return { id: part.id, type, label: part.id };
    }),
    connections: document.connections.map(({ from, to }) => ({
      from: { componentId: from.componentId, terminalId: from.terminal },
      to: { componentId: to.componentId, terminalId: to.terminal },
    })),
    arduinoSource: source,
  };
  return { document, display };
}

function observeCircuit(query: Query, f: Fixture, runCase: R5RunCase) {
  requireThat(
    query.quality.passed && query.winding.state.failureMode === 'none',
    'SHARED_MNA_AND_WINDING',
  );
  const component = (id: string) => {
    const result = query.components.find((part) => part.componentId === id);
    requireThat(result, 'MISSING_MNA_PART_' + id);
    return result;
  };
  const uno = component(unoId),
    battery = component(batteryId),
    motor = component(motorId);
  const fet = component(fetId),
    diode = component(diodeId);
  const volts = (part: typeof uno, a: string, b: string) =>
    finite(part.terminalVoltages[a], a) - finite(part.terminalVoltages[b], b);
  const edge = f.programs[runCase].gpio
    .filter(
      (item) => item.kind === 'output-change' && item.atMicroseconds <= query.fromMicroseconds,
    )
    .at(-1);
  const logic = finite(edge?.voltageVolt ?? edge?.voltage, 'PINNED_D5_PHASE');
  const gpio = volts(uno, 'd5', 'power-gnd-1');
  const gpioA = finite(uno.branchCurrents?.d5, 'D5_CURRENT');
  const sourceV = volts(battery, 'BAT+', 'BAT-');
  const sourceA = -finite(battery.terminalCurrents?.['BAT+'], 'BATTERY_CURRENT');
  const windV = volts(motor, 'positive', 'negative');
  const current = finite(motor.terminalCurrents?.positive, 'WINDING_CURRENT');
  const fetVds = volts(fet, 'drain', 'source'),
    fetVgs = volts(fet, 'gate', 'source');
  const fetA = finite(fet.branchCurrents?.drain, 'FET_DRAIN');
  const gateA = finite(fet.branchCurrents?.gate, 'FET_GATE');
  const diodeV = volts(diode, 'anode', 'cathode'),
    diodeA = finite(diode.current, 'FLYBACK_CURRENT');
  const tol = f.budgets.terminalReadTolerance,
    kcl = query.quality.kclToleranceAmp;
  requireThat(gpio >= 2.5 === (logic === 5), 'ACTUAL_D5');
  near(windV + fetVds, sourceV, tol, 'WINDING_KVL');
  near(-windV, diodeV, tol, 'DIODE_KVL');
  near(fetVgs, gpio, tol, 'GATE_KVL');
  near(current, fetA + diodeA, kcl, 'RETURN_KCL');
  near(sourceA + diodeA, current, kcl, 'SOURCE_KCL');
  near(gpioA, gateA, kcl, 'GATE_KCL');
  near(current, query.winding.intervalCurrentAmp, tol, 'CANONICAL_WINDING_CURRENT');
  near(windV, query.windingVoltageVolt, tol, 'CANONICAL_WINDING_VOLTAGE');
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
    gateA,
    diodeV,
    diodeA,
    powerIn: 6 * sourceA + logic * gpioA,
    powerCircuit:
      (6 - sourceV) * sourceA +
      (logic - gpio) * gpioA +
      fetVds * fetA +
      fetVgs * gateA +
      diodeV * diodeA,
    viscousW: query.winding.viscousLossWatt,
    transmissionW: query.winding.transmissionLossWatt,
    impulse: query.winding.outputTorqueImpulseNewtonMeterSeconds,
    torque: query.winding.outputTorqueNewtonMeter,
    temperature: query.winding.state.temperatureCelsius,
    maxKcl: query.quality.maxKclResidualAmp,
    kcl,
  };
}

function nativeReadback(M: Native, model: Model, data: Data, f: Fixture) {
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
  for (const [name, value] of Object.entries(counts))
    requireThat(model[name] === value, 'FACTORY_COUNT_' + name);
  for (const [kind, names] of [
    [1, f.expected.bodies],
    [5, f.expected.geoms],
    [3, f.expected.joints],
  ] as const)
    requireThat(
      names.every((name, id) => M.mj_id2name(model, kind, id) === name),
      'FACTORY_NATIVE_NAMES',
    );
  for (const [key, value] of Object.entries({
    geom_type: [6, 7, 6, 6, 6, 5, 5, 5, 5, 5],
    geom_bodyid: geomBodies,
    body_parentid: [0, 0, 1, 1, 1, 0],
    jnt_bodyid: [1, 2, 3, 4, 5],
    geom_condim: Array<number>(ngeom).fill(3),
    geom_contype: Array<number>(ngeom).fill(0),
    geom_conaffinity: Array<number>(ngeom).fill(0),
    jnt_type: [0, 3, 3, 3, 0],
    jnt_qposadr: f.expected.qposAdr,
    jnt_dofadr: f.expected.dofAdr,
  }))
    requireThat(arrayEq(i32(model[key], value.length, key), value), 'FACTORY_LAYOUT_' + key);
  for (const [key, length] of Object.entries({
    geom_surfacevel: ngeom * 6,
    geom_gap: ngeom,
    geom_margin: ngeom,
    geom_adhesion: ngeom,
    dof_damping: nv,
    dof_frictionloss: nv,
    body_gravcomp: nbody,
    pair_gap: 27,
    pair_margin: 27,
    pair_adhesion: 27,
  }))
    requireThat(
      f64(model[key], length, key).every((x) => x === 0),
      'FACTORY_ZERO_' + key,
    );
  requireThat(
    M.mj_isSparse(model) === 0 &&
      f.motor.gearRatio === 48 &&
      f.motor.profileId === 'adafruit-3777-tt-48to1',
    'DENSE_R5_PROFILE',
  );
  const armature = f64(model.dof_armature, nv, 'ARMATURE');
  requireThat(
    armature.every((x, index) => x === (index === axleV ? f.motor.reflectedInertiaKgM2 : 0)),
    'SOLE_NATIVE_TT_ARMATURE',
  );
  const options = {
    ...f.engine.profile,
    timestep: f.budgets.maxStepUs * 1e-6,
    tolerance: 1e-10,
    ls_tolerance: 0.01,
    noslip_tolerance: 1e-12,
    impratio: 1,
    ccd_tolerance: 1e-8,
    density: 0,
    viscosity: 0,
  };
  for (const [name, value] of Object.entries(options)) {
    if (Array.isArray(value))
      requireThat(
        arrayEq(f64(model.opt[name], value.length, name), value),
        'NATIVE_OPTION_' + name,
      );
    else requireThat(model.opt[name] === value, 'NATIVE_OPTION_' + name);
  }
  const accepted = new Map(
    f.expected.pairs.map(({ ids: [a, b], friction }) => [pairKey(a, b), friction]),
  );
  const allowed = new Map<number, { maximum: number; friction: number }>();
  const pairA = i32(model.pair_geom1, 27, 'PAIR_GEOM1'),
    pairB = i32(model.pair_geom2, 27, 'PAIR_GEOM2');
  const pairDims = i32(model.pair_dim, 27, 'PAIR_DIM');
  const pairFriction = f64(model.pair_friction, 27 * 5, 'PAIR_FRICTION');
  const solref = f64(model.pair_solref, 27 * 2, 'PAIR_SOLREF');
  const solrefFriction = f64(model.pair_solreffriction, 27 * 2, 'PAIR_SOLREFFRICTION');
  const solimp = f64(model.pair_solimp, 27 * 5, 'PAIR_SOLIMP');
  pairA.forEach((a, index) => {
    const b = pairB[index]!;
    const key = pairKey(a, b);
    const friction = accepted.get(key);
    requireThat(
      friction !== undefined &&
        !allowed.has(key) &&
        pairDims[index] === 3 &&
        arrayEq(pairFriction.subarray(index * 5, index * 5 + 5), [friction, friction, 0, 0, 0]) &&
        arrayEq(solref.subarray(index * 2, index * 2 + 2), [0.004, 1]) &&
        arrayEq(solrefFriction.subarray(index * 2, index * 2 + 2), [0, 0]) &&
        arrayEq(solimp.subarray(index * 5, index * 5 + 5), [0.99, 0.99, 0.001, 0.5, 2]),
      'FACTORY_EXPLICIT_PAIR',
    );
    const maximum = M.mj_maxContact(model, a, b, 0);
    requireThat(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 8, 'PAIR_ALLOCATION');
    allowed.set(key, { maximum, friction });
  });
  const capacity = Array.from(allowed.values()).reduce((sum, { maximum }) => sum + maximum, 0);
  requireThat(
    capacity <= f.raw.maxContactsPerInterval && 3 * capacity <= f.raw.maxRowsPerInterval,
    'PAIRED_CAPACITY',
  );
  const initial = state(data);
  const expectedQpos = [
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
    f.physical.can.startX,
    0,
    f.physical.terrain.height + f.physical.can.height / 2,
    1,
    0,
    0,
    0,
  ];
  requireThat(initial.time === 0 && initial.qvel.every((x) => x === 0), 'NATIVE_FACTORY_START');
  initial.qpos.forEach((value, index) =>
    near(value, expectedQpos[index]!, 1e-14, 'NATIVE_RESET_POSE'),
  );
  const bodyPos = f64(model.body_pos, nbody * 3, 'BODY_POS');
  const bodyQuat = f64(model.body_quat, nbody * 4, 'BODY_QUAT');
  const bodyIpos = f64(model.body_ipos, nbody * 3, 'BODY_IPOS');
  const masses = f64(model.body_mass, nbody, 'BODY_MASS');
  const jointAxis = f64(model.jnt_axis, 15, 'JOINT_AXES');
  const jointPosition = f64(model.jnt_pos, 15, 'JOINT_POSITIONS');
  for (const id of [1, 2, 3]) {
    requireThat(
      arrayEq(vec(jointAxis, id * 3), [0, 1, 0]) &&
        vec(jointPosition, 3 * id).every((word) => word === 0),
      'FACTORY_HINGE_AXES',
    );
  }
  near(
    masses.slice(1, 5).reduce((a, b) => a + b, 0),
    0.6,
    1e-14,
    'ROVER_TOTAL_MASS',
  );
  near(masses[5]!, 0.0122, 0, 'CAN_MASS');
  near(bodyIpos[17]!, f.physical.can.comHeight - f.physical.can.height / 2, 1e-15, 'CAN_COM');
  const geomPos = f64(model.geom_pos, ngeom * 3, 'GEOM_POS');
  const geomQuat = f64(model.geom_quat, ngeom * 4, 'GEOM_QUAT');
  const geomSize = f64(model.geom_size, ngeom * 3, 'GEOM_SIZE');
  requireThat(
    arrayEq(vec(geomPos, bumper * 3), f.physical.boom.centerM) &&
      arrayEq(vec(geomSize, bumper * 3), f.physical.boom.halfSizeM),
    'FACTORY_BOOM_SIZE',
  );
  quat(geomQuat, bumper * 4).forEach((value, index) =>
    near(value, f.physical.boom.quatWxyz[index]!, 1e-14, 'FACTORY_BOOM_QUAT'),
  );
  const anchors = [2, 3, 4].map((body) => ({
    p: vec(bodyPos, body * 3),
    q: quat(bodyQuat, body * 4),
  }));
  const geom = f.expected.geoms.map((id, i) => ({
    id,
    body: bodyNames[geomBodies[i]! - 1] ?? null,
    positionMeters: i === slope ? zero : vec(geomPos, i * 3),
    quaternionWxyz: i === slope ? unit : quat(geomQuat, i * 4),
    shape:
      i === slope
        ? {
            kind: 'mesh' as const,
            verticesMeters: f.physical.terrain.vertices,
            triangles: f.physical.terrain.faces,
          }
        : i >= rearLeft
          ? {
              kind: 'cylinder' as const,
              radiusMeters: geomSize[i * 3]!,
              halfHeightMeters: geomSize[i * 3 + 1]!,
            }
          : { kind: 'box' as const, halfExtentsMeters: vec(geomSize, i * 3) },
  }));
  const scene: R5StandScene = { geometries: geom };
  return {
    options,
    counts,
    initial,
    scene,
    allowed,
    anchors,
    masses: Array.from(masses),
    inertialOffsets: Array.from({ length: nbody }, (_, i) => vec(bodyIpos, i * 3)),
    bodyInertia: Array.from(f64(model.body_inertia, nbody * 3, 'BODY_INERTIA')),
  };
}
type Readback = ReturnType<typeof nativeReadback>;

function assertTerrain(model: Model, data: Data, f: Fixture): void {
  const vertices = model.mesh_vert;
  const faces = i32(model.mesh_face, 36, 'MESH_FACES');
  requireThat(
    vertices instanceof Float32Array &&
      vertices.length === 24 &&
      faces.every((i) => i >= 0 && i < 8),
    'FACTORY_MESH_STORAGE',
  );
  const p = f64(data.geom_xpos, ngeom * 3, 'MESH_WORLD_POS');
  const x = f64(data.geom_xmat, ngeom * 9, 'MESH_WORLD_ROTATION');
  const origin = vec(p, slope * 3);
  const axes = [vec(x, slope * 9), vec(x, slope * 9 + 3), vec(x, slope * 9 + 6)];
  const used = new Set<number>();
  const remapped: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const local = vec(vertices, i * 3);
    const world = add(origin, [dot(axes[0]!, local), dot(axes[1]!, local), dot(axes[2]!, local)]);
    const wanted = f.physical.terrain.vertices.findIndex(
      (v, index) => !used.has(index) && norm(sub(v, world)) <= 2e-7,
    );
    requireThat(wanted >= 0, 'FACTORY_MESH_ENVELOPE');
    used.add(wanted);
    remapped.push(wanted);
  }
  const faceKey = (triangle: number[]) => triangle.sort((a, b) => a - b).join(',');
  const nativeFaces = Array.from({ length: 12 }, (_, i) =>
    faceKey(faces.slice(i * 3, i * 3 + 3).map((v) => remapped[v]!)),
  ).sort();
  requireThat(
    nativeFaces.join('|') ===
      f.physical.terrain.faces
        .map((triangle) => faceKey([...triangle]))
        .sort()
        .join('|'),
    'FACTORY_MESH_FACES',
  );
  for (const [id, wanted] of [
    [lower, [-0.4, 0, -0.025]],
    [upper, [1.9, 0, f.physical.terrain.height - 0.025]],
  ] as const)
    vec(p, id * 3).forEach((value, i) => near(value, wanted[i]!, 1e-14, 'FACTORY_DECK_WORLD'));
  for (const id of wheelIds)
    [0, 1, 0].forEach((value, i) =>
      near(x[id * 9 + i * 3 + 2]!, value, 1e-14, 'FACTORY_WHEEL_AXIS'),
    );
}

function projectPoses(qpos: number[], anchors: Readback['anchors']): Pose[] {
  const rover = { p: vec(qpos), q: quat(qpos, 3) };
  const wheels = anchors.map((local, index) => {
    const angle = qpos[axleQ + index]! / 2;
    const hinge: WXYZ = [Math.cos(angle), 0, Math.sin(angle), 0];
    return {
      p: add(rover.p, rotate(rover.q, local.p)),
      q: multiply(multiply(rover.q, local.q), hinge),
    };
  });
  return [{ p: zero, q: unit }, rover, ...wheels, { p: vec(qpos, 10), q: quat(qpos, 13) }];
}

function observedPoses(data: Data, projection: Pose[]): Pose[] {
  const positions = f64(data.xpos, nbody * 3, 'NATIVE_BODY_ORIGIN');
  const rotations = f64(data.xquat, nbody * 4, 'NATIVE_BODY_QUAT');
  return projection.map(({ p, q }, i) => {
    const nativeP = vec(positions, i * 3),
      nativeQ = quat(rotations, i * 4);
    near(norm(sub(nativeP, p)), 0, 1e-12, 'BODY_PROJECTION_POSITION');
    near(rotationDistance(q, nativeQ), 0, 1e-12, 'BODY_PROJECTION_ROTATION');
    return { p: nativeP, q: nativeQ };
  });
}

type Ledger = {
  owned: number;
  freed: number;
  step1: number;
  step1Returned: number;
  step2: number;
  step2Returned: number;
  calls: number;
  activeContacts: number;
  positionObservations: number;
  cleanupFailures: string[];
};
function own<T extends Handle>(value: T, ledger: Ledger): T {
  requireThat(typeof value?.delete === 'function', 'NATIVE_OWNED_HANDLE');
  ledger.owned++;
  return value;
}
function release(handle: Handle | undefined, ledger: Ledger): void {
  if (!handle) return;
  try {
    handle.delete();
    ledger.freed++;
  } catch (error) {
    ledger.cleanupFailures.push(String(error));
  }
}
function warnings(data: Data, ledger: Ledger): void {
  const warningVector = data.warning;
  requireThat(warningVector.size() === 7, 'NATIVE_WARNING_WIDTH');
  for (let i = 0; i < 7; i++) {
    const item = warningVector.get(i);
    requireThat(item, 'NATIVE_WARNING_HANDLE');
    own(item, ledger);
    try {
      requireThat(item.number === 0 && item.lastinfo === 0, 'NATIVE_WARNING_NONZERO');
    } finally {
      release(item, ledger);
    }
  }
  requireThat(ledger.cleanupFailures.length === 0, 'NATIVE_WARNING_CLEANUP');
}
function contactRows(data: Data, f: Fixture) {
  requireThat(
    Number.isSafeInteger(data.nefc) && data.nefc >= 0 && data.nefc <= f.raw.maxRowsPerInterval,
    'NATIVE_ROW_COUNT',
  );
  return {
    size: data.nefc,
    kinds: i32(data.efc_type, data.nefc, 'NATIVE_ROW_TYPE'),
    ids: i32(data.efc_id, data.nefc, 'NATIVE_ROW_ID'),
  };
}

function captureContacts(
  data: Data,
  f: Fixture,
  ledger: Ledger,
  allowed: Readback['allowed'],
): Contact[] {
  requireThat(
    Number.isSafeInteger(data.ncon) && data.ncon >= 0 && data.ncon <= f.raw.maxContactsPerInterval,
    'NATIVE_CONTACT_CAP',
  );
  const vector = own(data.contact, ledger);
  const counts = new Map<number, number>();
  try {
    requireThat(vector.size() === data.ncon, 'NATIVE_CONTACT_WIDTH');
    return Array.from({ length: data.ncon }, (_, index) => {
      const got = vector.get(index);
      requireThat(got, 'NATIVE_CONTACT_HANDLE');
      const item = own(got, ledger) as ContactHandle & {
        friction: ArrayLike<number>;
        surfacevel: ArrayLike<number>;
        adhesion: number;
      };
      try {
        const { geom1: first, geom2: second, exclude, efc_address: address } = item;
        const ids = i32(item.geom, 2, 'CONTACT_GEOM_ARRAY');
        const key = pairKey(first, second),
          pair = allowed.get(key),
          count = (counts.get(key) ?? 0) + 1;
        requireThat(
          pair &&
            count <= pair.maximum &&
            item.dim === 3 &&
            first === ids[0] &&
            second === ids[1] &&
            first !== second &&
            first >= 0 &&
            first < ngeom &&
            second >= 0 &&
            second < ngeom &&
            Number.isSafeInteger(address) &&
            address >= -1 &&
            Number.isSafeInteger(exclude) &&
            exclude >= 0 &&
            exclude <= 7,
          'NATIVE_EXPLICIT_CONTACT',
        );
        counts.set(key, count);
        requireThat(
          arrayEq(f64(item.friction, 5, 'CONTACT_FRICTION'), [
            pair.friction,
            pair.friction,
            1e-5,
            1e-5,
            1e-5,
          ]) &&
            f64(item.surfacevel, 3, 'CONTACT_SURFACE_VEL').every((v) => v === 0) &&
            item.adhesion === 0,
          'CONTACT_MATERIAL_READBACK',
        );
        const frame = Array.from(f64(item.frame, 9, 'CONTACT_FRAME'));
        const axes = [vec(frame), vec(frame, 3), vec(frame, 6)];
        for (const [i, a] of axes.entries())
          for (const [j, b] of axes.entries())
            near(dot(a, b), Number(i === j), 1e-12, 'CONTACT_FRAME_ORTHONORMAL');
        near(
          norm(sub(cross(axes[0]!, axes[1]!), axes[2]!)),
          0,
          1e-12,
          'CONTACT_FRAME_RIGHT_HANDED',
        );
        return {
          first,
          second,
          index,
          address,
          exclude,
          dist: finite(item.dist, 'CONTACT_DISTANCE'),
          point: vec(f64(item.pos, 3, 'CONTACT_POINT')),
          frame,
        };
      } finally {
        release(item, ledger);
      }
    });
  } finally {
    release(vector, ledger);
  }
}
function bodyVelocities(M: Native, model: Model, data: Data, buffer: BufferHandle) {
  const centres = f64(data.xipos, 3 * nbody, 'NATIVE_COM');
  return Array.from({ length: nbody }, (_, body) => {
    M.mj_objectVelocity(model, data, 1, body, buffer, 0);
    const v = f64(buffer.GetView(), 6, 'NATIVE_BODY_TWIST');
    return { com: vec(centres, 3 * body), omega: vec(v), velocity: vec(v, 3) };
  });
}
function preWitness(
  M: Native,
  model: Model,
  data: Data,
  pre: NativeState,
  f: Fixture,
  capacity: Readback['allowed'],
  buffer: BufferHandle,
  ledger: Ledger,
) {
  const contacts = captureContacts(data, f, ledger, capacity);
  const rows = contactRows(data, f);
  requireThat(data.nJ === rows.size * nv, 'NATIVE_DENSE_JACOBIAN');
  const jacobian = Array.from(f64(data.efc_J, data.nJ, 'NATIVE_PRE_J'));
  const velocity = Array.from(f64(data.efc_vel, rows.size, 'NATIVE_PRE_V'));
  const body = bodyVelocities(M, model, data, buffer);
  const read = new Set<number>();
  for (const c of contacts) {
    if (c.address < 0) continue;
    requireThat(c.exclude === 0 && c.address + 3 <= rows.size, 'CONTACT_ACTIVE_ADDRESS');
    const speed = (id: number): XYZ => {
      const b = body[geomBodies[id]!]!;
      return add(b.velocity, cross(b.omega, sub(c.point, b.com)));
    };
    const relative = sub(speed(c.second), speed(c.first));
    for (let i = 0; i < 3; i++) {
      const row = c.address + i;
      requireThat(
        rows.kinds[row] === 7 && rows.ids[row] === c.index && !read.has(row),
        'PRE_ROW_IDENTITY',
      );
      read.add(row);
      near(
        dot(relative, vec(c.frame, i * 3)),
        velocity[row]!,
        f.budgets.velocityParityMps,
        'CONTACT_POINT_VELOCITY',
      );
      const jv = pre.qvel.reduce((sum, value, dof) => sum + jacobian[row * nv + dof]! * value, 0);
      near(jv, velocity[row]!, f.budgets.velocityParityMps, 'NATIVE_JACOBIAN_VELOCITY');
    }
  }
  requireThat(read.size === rows.size && ledger.cleanupFailures.length === 0, 'PRE_ROW_CLOSURE');
  return { contacts, rows, jacobian, velocity, body };
}
function resolvedContacts(
  M: Native,
  model: Model,
  data: Data,
  before: ReturnType<typeof preWitness>,
  f: Fixture,
  capacity: Readback['allowed'],
  buffer: BufferHandle,
  delta: number[],
  ledger: Ledger,
): Loaded[] {
  const after = contactRows(data, f);
  requireThat(
    after.size === before.rows.size &&
      arrayEq(after.kinds, before.rows.kinds) &&
      arrayEq(after.ids, before.rows.ids),
    'POST_ROW_IDENTITY',
  );
  const copies = captureContacts(data, f, ledger, capacity);
  requireThat(
    copies.length === before.contacts.length &&
      copies.every((c, i) => {
        const a = before.contacts[i]!;
        return (
          c.first === a.first &&
          c.second === a.second &&
          c.address === a.address &&
          c.exclude === a.exclude &&
          Object.is(c.dist, a.dist) &&
          arrayEq(c.point, a.point) &&
          arrayEq(c.frame, a.frame)
        );
      }),
    'POST_CONTACT_IDENTITY',
  );
  const forces = f64(data.efc_force, after.size, 'POST_EFC_FORCE');
  return copies.flatMap((c) => {
    if (c.address < 0) return [];
    M.mj_contactForce(model, data, c.index, buffer);
    const result = f64(buffer.GetView(), 6, 'SOLVED_CONTACT_FORCE');
    const force = vec(result);
    requireThat(
      force[0] >= 0 &&
        arrayEq(force, vec(forces, c.address)) &&
        result.subarray(3).every((x) => x === 0) &&
        (force[0] === 0 || c.dist < 0),
      'CONTACT_SOLVED_FORCE_PARITY',
    );
    const rowWork = (local: number) =>
      delta.reduce(
        (sum, value, index) => sum + before.jacobian[(c.address + local) * nv + index]! * value,
        0,
      );
    ledger.activeContacts++;
    requireThat(ledger.activeContacts <= f.raw.maxContactsPerWorld, 'WORLD_CONTACT_CAP');
    return [
      {
        ...c,
        force,
        velocity: vec(before.velocity, c.address),
        delta: [rowWork(0), rowWork(1), rowWork(2)] as XYZ,
      },
    ];
  });
}

function terrainNormal(id: number, f: Fixture): XYZ {
  const angle = radians(f.physical.terrain.angleDeg);
  return id === slope ? [-Math.sin(angle), 0, Math.cos(angle)] : up;
}
function worldForce(contact: Loaded): XYZ {
  return add(
    add(
      scale(vec(contact.frame), contact.force[0]),
      scale(vec(contact.frame, 3), contact.force[1]),
    ),
    scale(vec(contact.frame, 6), contact.force[2]),
  );
}
function forceOn(contact: Loaded, geom: number, force: XYZ): XYZ {
  return scale(force, contact.second === geom ? 1 : -1);
}
function onTop(id: number, point: XYZ, f: Fixture): boolean {
  const { terrain, limits } = f.physical;
  if (Math.abs(point[1]) > terrain.halfY) return false;
  if (id === slope) {
    const normal = terrainNormal(id, f);
    const distance = dot(point, normal);
    const projected = sub(point, scale(normal, distance));
    return (
      Math.abs(distance) <= limits.faceDistanceM &&
      projected[0] >= 0 &&
      projected[0] <= terrain.slope[1]!
    );
  }
  const extent = id === lower ? terrain.lower : terrain.upper;
  const level = id === lower ? 0 : terrain.height;
  return (
    Math.abs(point[2] - level) <= limits.faceDistanceM &&
    point[0] >= extent[0]! &&
    point[0] <= extent[1]!
  );
}
function validSupport(
  contact: Loaded,
  terrain: number,
  body: number,
  force: XYZ,
  f: Fixture,
): boolean {
  const normal = terrainNormal(terrain, f);
  return (
    onTop(terrain, contact.point, f) &&
    dot(forceOn(contact, body, vec(contact.frame)), normal) >=
      Math.cos(radians(f.physical.limits.faceNormalAllowDeg)) &&
    dot(forceOn(contact, body, force), normal) > 0 &&
    dot(forceOn(contact, body, force), up) > 0
  );
}
function canCom(pose: Pose, f: Fixture): XYZ {
  return add(pose.p, rotate(pose.q, [0, 0, f.physical.can.comHeight - f.physical.can.height / 2]));
}
function pointOnSide(point: XYZ, pose: Pose, f: Fixture): boolean {
  const local = rotate(conjugate(pose.q), sub(point, pose.p));
  const { can, limits } = f.physical;
  return (
    Math.abs(Math.hypot(local[0], local[1]) - can.radius) <= limits.faceDistanceM &&
    Math.abs(local[2]) <= can.height / 2 + limits.faceDistanceM
  );
}
function projection(pose: Pose, geom: R5StandScene['geometries'][number], axis: XYZ) {
  const center = dot(add(pose.p, rotate(pose.q, geom.positionMeters)), axis);
  const q = multiply(pose.q, geom.quaternionWxyz);
  const shape = geom.shape;
  requireThat(shape.kind !== 'mesh', 'CLEARANCE_PRIMITIVE');
  if (shape.kind === 'box') {
    return {
      center,
      half: basis.reduce(
        (sum, direction, i) =>
          sum + shape.halfExtentsMeters[i]! * Math.abs(dot(rotate(q, direction), axis)),
        0,
      ),
    };
  }
  const cosine = Math.min(1, Math.abs(dot(rotate(q, up), axis)));
  return {
    center,
    half: cosine * shape.halfHeightMeters + Math.sqrt(1 - cosine ** 2) * shape.radiusMeters,
  };
}
function shapeReach(geom: R5StandScene['geometries'][number]): number {
  const shape = geom.shape;
  requireThat(shape.kind !== 'mesh', 'CLEARANCE_REACH');
  if (shape.kind === 'cylinder')
    return norm(geom.positionMeters) + Math.hypot(shape.radiusMeters, shape.halfHeightMeters);
  return Math.max(
    ...[-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map((z) =>
          norm(
            add(
              geom.positionMeters,
              rotate(geom.quaternionWxyz, [
                x * shape.halfExtentsMeters[0],
                y * shape.halfExtentsMeters[1],
                z * shape.halfExtentsMeters[2],
              ]),
            ),
          ),
        ),
      ),
    ),
  );
}
function clearanceBound(before: Pose[], after: Pose[], scene: R5StandScene): number {
  const shapes = scene.geometries;
  const canGeom = shapes[can]!;
  const swept = (body: number, radius: number) => {
    const a = before[body]!,
      b = after[body]!;
    return norm(sub(b.p, a.p)) + radius * rotationDistance(a.q, b.q);
  };
  const canSweep = swept(5, shapeReach(canGeom));
  const bound = (key: number) => {
    const owner = geomBodies[key]!,
      geom = shapes[key]!;
    const gap = (poses: Pose[]) =>
      Math.max(
        ...basis.map((axis) => {
          const a = projection(poses[owner]!, geom, axis),
            b = projection(poses[5]!, canGeom, axis);
          return Math.abs(a.center - b.center) - a.half - b.half;
        }),
      );
    return { gap: Math.min(gap(before), gap(after)), sweep: swept(owner, shapeReach(geom)) };
  };
  const chassisBound = bound(chassis);
  const bumperBound = bound(bumper);
  const tires = wheelIds.map(bound);
  return (
    Math.min(
      chassisBound.gap - chassisBound.sweep,
      bumperBound.gap - bumperBound.sweep,
      Math.min(...tires.map(({ gap }) => gap)) - Math.max(...tires.map(({ sweep }) => sweep)),
    ) - canSweep
  );
}

type Frame = {
  from: number;
  to: number;
  pre: NativeState;
  post: NativeState;
  before: Pose[];
  after: Pose[];
  effort: number;
  reverse: boolean;
  circuit: Electrical;
  contacts: Loaded[];
  identities: Contact[];
  kinematics: ReturnType<typeof bodyVelocities>;
};

class PhysicalWitness {
  readonly landmarks: R5Landmark[] = [];
  readonly failures = new Map<string, number>();
  private settled: Span | null = null;
  private upward: Span | null = null;
  private upright: Span | null = null;
  private side: Span | null = null;
  private resting: Pose | undefined;
  private rampZ = 0;
  private sideClearance = Infinity;
  private bumpImpulse = 0;
  private pitchImpulse = 0;
  private flyback = 0;
  private controlTravel = 0;
  private shaftPositive = 0;
  private shaftSigned = 0;
  private loadedContactWork = 0;
  private supplyWork = 0;
  private circuitLoss = 0;
  private reverseViolations = 0;
  private firstReverseViolation: { from: number; to: number; work: number } | undefined;
  private recontact = { ticks: 0, loadedTimeUs: 0, impulseNs: 0, lastUs: 0 };

  constructor(
    private readonly f: Fixture,
    private readonly runCase: R5RunCase,
    private readonly scene: R5StandScene,
  ) {}

  private has(key: R5Landmark['key']): boolean {
    return this.landmarks.some((value) => value.key === key);
  }
  private add(key: R5Landmark['key'], atMicroseconds: number, value?: number): void {
    this.landmarks.push({ key, atMicroseconds, ...(value === undefined ? {} : { value }) });
  }
  private fail(reason: string, at: number): void {
    if (!this.failures.has(reason)) this.failures.set(reason, at);
  }

  observe(frame: Frame): void {
    const f = this.f,
      { terrain, can: canSpec, limits } = f.physical;
    const { from, to, before, after, contacts } = frame;
    const dt = (to - from) * 1e-6;
    const preCan = before[5]!,
      postCan = after[5]!,
      preCom = canCom(preCan, f),
      postCom = canCom(postCan, f);
    if (
      postCom[0] < terrain.upper[0]! ||
      postCom[0] > terrain.upper[1]! ||
      Math.abs(postCom[1]) > terrain.halfY ||
      postCom[2] <= terrain.height
    )
      this.fail('CAN_LEFT_FINITE_SUPPORTED_FIELD', to);
    const preAxis = rotate(preCan.q, up),
      postAxis = rotate(postCan.q, up);
    const preTip = Math.atan2(Math.hypot(preAxis[0], preAxis[1]), preAxis[2]);
    const postTip = Math.atan2(Math.hypot(postAxis[0], postAxis[1]), postAxis[2]);
    const support = new Map<number, Set<number>>();
    const rejected = new Set<number>();
    let slip = 0,
      strikeHeight = Infinity,
      pitch = 0,
      impulse = 0,
      robotTouchesCan = false;
    let sideContact = false,
      supportedCan = false,
      laterImpulse = 0;
    const slopeNormal = terrainNormal(slope, f);
    const slopeDirection: XYZ = [slopeNormal[2], 0, -slopeNormal[0]];
    const appliedWork = frame.effort * (frame.post.qpos[axleQ]! - frame.pre.qpos[axleQ]!);
    this.shaftPositive += Math.max(0, appliedWork);
    this.shaftSigned += appliedWork;
    this.supplyWork += frame.circuit.powerIn * dt;
    this.circuitLoss += frame.circuit.powerCircuit * dt;
    if (frame.reverse && from >= f.comparison.interventionUs && appliedWork > 0) {
      this.reverseViolations++;
      this.firstReverseViolation ??= { from, to, work: appliedWork };
    }
    for (const c of contacts) {
      this.loadedContactWork += dot(c.force, c.delta);
      if (c.force[0] === 0) continue;
      const terrainId = c.first <= upper ? c.first : c.second <= upper ? c.second : -1;
      const other = terrainId === c.first ? c.second : c.first;
      const force = worldForce(c);
      if (terrainId >= 0) {
        if (other === chassis || other === bumper) this.fail('BODY_DRAGGED_ON_TERRAIN', from);
        if (wheelIds.some((wheel) => wheel === other)) {
          if (!validSupport(c, terrainId, other, force, f)) {
            rejected.add(other);
          } else {
            const foot = support.get(other) ?? new Set<number>();
            foot.add(terrainId);
            support.set(other, foot);
            if (terrainId === slope) {
              const speed = worldForce({ ...c, force: c.velocity });
              slip = Math.max(slip, Math.abs(dot(speed, slopeDirection)));
            }
          }
        }
        if (other === can) {
          if (terrainId !== upper) this.fail('CAN_LEFT_UPPER_DECK', from);
          if (terrainId === upper && validSupport(c, terrainId, can, force, f)) {
            supportedCan = true;
            sideContact ||= pointOnSide(c.point, preCan, f);
          }
        }
      } else if (c.first === can || c.second === can) {
        robotTouchesCan = true;
        if (this.has('free-side')) laterImpulse += c.force[0] * dt;
        if (pairKey(c.first, c.second) === pairKey(bumper, can)) {
          strikeHeight = Math.min(strikeHeight, c.point[2] - preCom[2]);
          impulse += c.force[0] * dt;
          pitch += cross(sub(c.point, preCom), forceOn(c, can, force))[1] * dt;
        } else if (!this.has('tip')) this.fail('UNREGISTERED_ROBOT_CAN_CAUSE', from);
      }
    }
    if (laterImpulse > 0) {
      if (!this.has('late-recontact')) this.add('late-recontact', from);
      this.recontact.ticks++;
      this.recontact.loadedTimeUs += to - from;
      this.recontact.impulseNs += laterImpulse;
      this.recontact.lastUs = to;
    }

    const on = (wheel: number, surface: number) => {
      const surfaces = support.get(wheel);
      return !rejected.has(wheel) && surfaces?.size === 1 && surfaces.has(surface);
    };
    const allOn = (surface: number) => wheelIds.every((wheel) => on(wheel, surface));
    const rover0 = before[1]!,
      rover1 = after[1]!;
    if (to <= f.programs.divergeUs) {
      this.settled = keepSpan(this.settled, from, to, allOn(lower));
      if (
        to === f.programs.divergeUs &&
        this.settled &&
        to - this.settled.from >= limits.staticUs
      ) {
        this.resting = rover1;
        this.add('settled', to, rover1.p[2]);
      }
    }
    if (this.resting)
      this.controlTravel = Math.max(this.controlTravel, Math.abs(rover1.p[0] - this.resting.p[0]));
    if (this.runCase === 'control') {
      if (
        robotTouchesCan ||
        wheelIds.some((wheel) => on(wheel, slope)) ||
        postTip >= canSpec.tipAngleRad
      )
        this.fail('LOW_CONTROL_LEFT_REST', from);
    } else {
      if (
        !this.has('mixed') &&
        this.resting &&
        on(frontLeft, slope) &&
        on(frontRight, slope) &&
        on(rearLeft, lower) &&
        on(rearRight, lower)
      )
        this.add('mixed', to, rover0.p[2]);
      if (this.has('mixed') && !this.has('ramp')) {
        const valid = allOn(slope) && slip <= limits.maxSlipMps;
        if (valid && this.upward?.to !== from) this.rampZ = rover0.p[2];
        this.upward = keepSpan(this.upward, from, to, valid);
        if (this.upward && to - this.upward.from >= limits.rampUs && rover1.p[2] > this.rampZ)
          this.add('ramp', to, rover1.p[2] - this.rampZ);
      }
      if (this.has('ramp') && !this.has('top') && allOn(upper) && this.resting) {
        const rise = rover1.p[2] - this.resting.p[2];
        this.add('top', to, rise);
        if (rise < limits.minElevationM) this.fail('INSUFFICIENT_ELEVATION', to);
      }
    }

    if (impulse > 0 && !this.has('impact')) {
      this.add('impact', from, strikeHeight);
      if (
        !this.has('top') ||
        (this.landmarks.find(({ key }) => key === 'top')?.atMicroseconds ?? Infinity) > from
      )
        this.fail('IMPACT_BEFORE_TOP', from);
      if (strikeHeight < limits.impactAboveComM || pitch <= 0)
        this.fail('IMPACT_COM_HEIGHT_OR_PITCH_SIGN', from);
      if (!this.upright || this.upright.to !== from || from - this.upright.from < limits.staticUs)
        this.fail('CAN_NOT_UPRIGHT_50MS_BEFORE_IMPACT', from);
    }
    this.upright = keepSpan(
      this.upright,
      from,
      to,
      supportedCan &&
        !robotTouchesCan &&
        preTip <= radians(limits.canUprightDeg) &&
        postTip <= radians(limits.canUprightDeg),
    );
    if (this.has('impact') && !this.has('tip')) {
      this.bumpImpulse += impulse;
      this.pitchImpulse += pitch;
    }
    if (this.runCase === 'powered' && !this.has('tip') && postTip >= canSpec.tipAngleRad) {
      this.add('tip', to, postTip);
      if (
        !this.has('impact') ||
        preTip >= canSpec.tipAngleRad ||
        this.bumpImpulse <= 0 ||
        this.pitchImpulse <= 0
      )
        this.fail('TIP_OUTSIDE_NATIVE_CAUSAL_ORDER', to);
    }
    if (this.runCase === 'powered' && from >= f.programs.offUs && frame.circuit.logic === 0) {
      if (frame.circuit.windV < 0) this.flyback = Math.max(this.flyback, frame.circuit.diodeA);
      if (!this.has('final-low')) {
        this.add('final-low', from);
        if (from !== f.programs.offUs) this.fail('FINAL_LOW_AT_WRONG_BOUNDARY', from);
      }
    }
    const crossing = this.landmarks.find(({ key }) => key === 'tip')?.atMicroseconds;
    const sideBand = Math.sin(radians(limits.canSideFromHorizontalDeg));
    const targetDrop = limits.canDropFraction * (canSpec.comHeight - canSpec.radius);
    const side =
      crossing !== undefined &&
      crossing <= from &&
      from >= f.programs.offUs &&
      frame.circuit.logic === 0 &&
      sideContact &&
      !robotTouchesCan &&
      Math.abs(preAxis[2]) <= sideBand &&
      Math.abs(postAxis[2]) <= sideBand &&
      canSpec.initialComZ - preCom[2] >= targetDrop &&
      canSpec.initialComZ - postCom[2] >= targetDrop;
    const gap = side ? clearanceBound(before, after, this.scene) : Infinity;
    if (side && (!this.side || this.side.to !== from)) this.sideClearance = Infinity;
    this.side = keepSpan(this.side, from, to, side && gap > 0);
    if (this.side) {
      this.sideClearance = Math.min(this.sideClearance, gap);
      if (!this.has('free-side') && to - this.side.from >= limits.sideUs)
        this.add('free-side', to, this.sideClearance);
    }
    if (
      this.has('top') &&
      (rover1.p[0] > terrain.upper[1]! ||
        Math.abs(rover1.p[1]) > terrain.halfY ||
        rover1.p[2] <= terrain.height)
    )
      this.fail('ROVER_LEFT_TOP_SUPPORTED_FIELD', to);
  }

  complete(at: number) {
    if (!this.resting) this.fail('NO_INITIAL_50MS_CONTACT_SETTLE', at);
    if (this.runCase === 'powered') {
      for (const key of [
        'mixed',
        'ramp',
        'top',
        'impact',
        'tip',
        'final-low',
        'free-side',
        'late-recontact',
      ] as const)
        if (!this.has(key)) this.fail('MISSING_' + key, at);
      if (this.flyback < minimumFlybackCurrent) this.fail('NO_FINAL_FLYBACK_WITNESS', at);
    } else {
      if (
        this.controlTravel > this.f.physical.limits.controlMaxTravelM ||
        this.shaftPositive > this.f.physical.limits.controlPositiveShaftMaxJ
      )
        this.fail('CONTROL_TRAVEL_OR_POSITIVE_WORK', at);
      if (
        !this.upright ||
        this.upright.to !== at ||
        at - this.upright.from < this.f.physical.limits.sideUs
      )
        this.fail('CONTROL_FINAL_UPRIGHT_WINDOW', at);
    }
    return {
      physical: this.failures.size === 0 ? 'PASS' : 'FAIL',
      causal: 'GAP_CAUSAL_ALT',
      failures: Array.from(this.failures),
      landmarks: this.landmarks,
      controlTravel: this.controlTravel,
      maxFlybackAmp: this.flyback,
      signedPitchImpulse: this.pitchImpulse,
      normalImpulse: this.bumpImpulse,
      recontact: this.recontact,
      energy: {
        signedShaftWorkJ: this.shaftSigned,
        positiveShaftWorkJ: this.shaftPositive,
        contactWorkJ: this.loadedContactWork,
        sourceWorkJ: this.supplyWork,
        circuitLossJ: this.circuitLoss,
        reversePositiveIntervals: this.reverseViolations,
        firstActualReversePositive: this.firstReverseViolation ?? null,
      },
    };
  }
}

type Step = NonNullable<ReturnType<Session['step']>>;
type ShaftQuery = Extract<Step, { kind: 'shaft-start' | 'shaft-interval' }>;
function sample(value: NativeState, f: Fixture) {
  return {
    measuredAtMicroseconds: timeUs(value, f.budgets.clockToleranceUs),
    angleRadian: value.qpos[axleQ]!,
    angularVelocityRadPerSecond: value.qvel[axleV]!,
  };
}
function respond(session: Session, query: ShaftQuery, value: NativeState, f: Fixture): void {
  const before = session.lastCommitted().committedHorizonMicroseconds;
  requireThat(
    session.respond({
      componentId: query.componentId,
      port: query.port,
      axis: query.axis,
      fromMicroseconds: query.fromMicroseconds,
      toMicroseconds: query.toMicroseconds,
      runId: query.runId,
      generation: query.generation,
      sequence: query.sequence,
      token: query.token,
      ...sample(value, f),
    }),
    'NATIVE_RIGHT_SAMPLE_NOT_ACCEPTED',
  );
  requireThat(session.lastCommitted().committedHorizonMicroseconds === before, 'PREMATURE_COMMIT');
}
function actions(data: Data, effort: number): void {
  requireThat(
    f64(data.qfrc_applied, nv, 'APPLIED_FORCE_SHAPE').every((value, i) =>
      Object.is(value, i === axleV ? effort : 0),
    ),
    'SOLE_AXLE_FORCE_READBACK',
  );
}
function poseWords(poses: Pose[]): number[] {
  return poses.slice(1).flatMap(({ p, q }) => [...p, ...q]);
}
function rawByteCost(contacts: number, activeContacts: number): number {
  // One length word, 209 header/state/kinematics words, then native witness words.
  return 8 * (1 + 209 + contacts + 24 * activeContacts);
}
function rawFrame(frame: Frame): number[] {
  const e = frame.circuit;
  const prefix = [
    frame.from,
    frame.to,
    frame.pre.time,
    frame.post.time,
    frame.effort,
    Number(frame.reverse),
    e.logic,
    e.gpio,
    e.gpioA,
    e.sourceV,
    e.sourceA,
    e.windV,
    e.current,
    e.fetVds,
    e.fetVgs,
    e.fetA,
    e.gateA,
    e.diodeV,
    e.diodeA,
    e.powerIn,
    e.powerCircuit,
    e.viscousW,
    e.transmissionW,
    e.impulse,
    e.torque,
    e.temperature,
    e.maxKcl,
    e.kcl,
    ...frame.pre.qpos,
    ...frame.pre.qvel,
    ...frame.post.qpos,
    ...frame.post.qvel,
    ...poseWords(frame.before),
    ...poseWords(frame.after),
    ...frame.kinematics
      .slice(1)
      .flatMap(({ com, omega, velocity }) => [...com, ...omega, ...velocity]),
    frame.identities.length,
    frame.contacts.length,
  ];
  const active = frame.contacts.flatMap((c) => [
    c.index,
    c.address,
    c.dist,
    ...c.point,
    ...c.frame,
    ...c.force,
    ...c.velocity,
    ...c.delta,
  ]);
  const contacts = frame.identities.map(
    ({ first, second, exclude, address }) =>
      first + ngeom * second + (exclude + 8 * Number(address >= 0)) * ngeom ** 2,
  );
  return [prefix.length + active.length + contacts.length, ...prefix, ...contacts, ...active];
}
function f64Base64(words: number[]): string {
  const buffer = new ArrayBuffer(words.length * 8);
  const view = new DataView(buffer);
  words.forEach((word, i) => {
    requireThat(Number.isFinite(word), 'NONFINITE_PROOF_WORD');
    view.setFloat64(i * 8, word, true);
  });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function replayCap(ledger: Ledger, f: Fixture) {
  requireThat(
    ledger.step1 < f.raw.maxIntervalsPerWorld &&
      ledger.step2 < f.raw.maxIntervalsPerWorld &&
      ledger.calls <= f.raw.maxSessionCalls &&
      ledger.cleanupFailures.length === 0,
    'BEFORE_NATIVE_DISPATCH_BUDGET',
  );
}

type Phase = 'ready' | 'running' | 'paused' | 'complete' | 'fault' | 'disposed';
class Run {
  readonly witness: PhysicalWitness;
  phase: Phase = 'ready';
  private sequence = 0;
  private sampledStart = false;
  private pendingFrame: Frame | null = null;
  private queuedStep: Step | null = null;
  private timer: number | undefined;
  private wallStart = 0;
  private lastPaint = 0;
  private telemetry: R5StandSnapshot['telemetry'] = null;
  private tick = 0;
  private committedUs = 0;
  private pose: Pose[];
  private chunk: number[] = [];
  private chunkCount = 0;
  private chunkStart = 0;
  private proofBytes = 0;
  private closed = false;

  constructor(
    readonly generation: number,
    readonly runCase: R5RunCase,
    private readonly assets: Assets,
    private readonly session: Session,
    private readonly model: Model,
    private readonly data: Data,
    private readonly buffer: BufferHandle,
    private readonly tangent: BufferHandle,
    private readonly mass: BufferHandle,
    private readonly ledger: Ledger,
    private readonly readback: Readback,
  ) {
    this.pose = observedPoses(data, projectPoses(readback.initial.qpos, readback.anchors));
    this.witness = new PhysicalWitness(assets.fixture, runCase, readback.scene);
  }

  private proof(record: unknown) {
    scope.postMessage({ kind: 'proof', generation: this.generation, record });
  }
  private snapshot(): R5StandSnapshot {
    return {
      generation: this.generation,
      tickId: this.tick,
      atMicroseconds: this.committedUs,
      poses: bodyNames.map((body, i) => ({
        body,
        positionMeters: this.pose[i + 1]!.p,
        quaternionWxyz: this.pose[i + 1]!.q,
      })),
      telemetry: this.telemetry,
      landmarks: this.witness.landmarks.slice(),
    };
  }
  private publish(): void {
    scope.postMessage({ kind: 'snapshot', snapshot: this.snapshot() });
    this.lastPaint = performance.now();
  }
  private announce(phase: Exclude<Phase, 'ready'>, error?: string): void {
    scope.postMessage({
      kind: 'phase',
      generation: this.generation,
      tickId: this.tick,
      atMicroseconds: this.committedUs,
      phase,
      ...(error === undefined ? {} : { error }),
    });
  }
  private energy(): { potentialJ: number; kineticJ: number } {
    const velocities = Array.from(this.data.qvel);
    this.assets.native.mj_mulM(this.model, this.data, this.mass, velocities);
    const out = f64(this.mass.GetView(), nv, 'NATIVE_MASS_PRODUCT');
    const kineticJ = 0.5 * velocities.reduce((sum, value, i) => sum + value * out[i]!, 0);
    const com = f64(this.data.xipos, nbody * 3, 'NATIVE_ENERGY_COM');
    const potentialJ = this.readback.masses.reduce(
      (sum, kg, i) => sum + kg * 9.81 * com[i * 3 + 2]!,
      0,
    );
    requireThat(
      Number.isFinite(kineticJ) && kineticJ >= 0 && Number.isFinite(potentialJ),
      'NATIVE_ENDPOINT_ENERGY',
    );
    return { potentialJ, kineticJ };
  }
  ready(display: CircuitDisplay): void {
    const pins = {
      buildCommit: __R5_BUILD_COMMIT__,
      ...assetPins,
      circuitSha256: circuitPins[this.runCase],
    };
    this.proof({
      kind: 'factory',
      runCase: this.runCase,
      pins,
      model: {
        counts: this.readback.counts,
        options: this.readback.options,
        initial: this.readback.initial,
        geomBodies,
        geometry: this.readback.scene.geometries,
        anchors: this.readback.anchors,
        masses: this.readback.masses,
        bodyInertia: this.readback.bodyInertia,
        inertialOffsets: this.readback.inertialOffsets,
        capacity: Array.from(this.readback.allowed.entries()),
      },
      runTimeUs: this.committedUs,
      energy: this.energy(),
      ledger: this.ledger,
    });
    scope.postMessage({
      kind: 'ready',
      generation: this.generation,
      runCase: this.runCase,
      pins,
      scene: this.readback.scene,
      circuit: display,
      snapshot: this.snapshot(),
    });
  }
  play(): void {
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    this.phase = 'running';
    this.wallStart = performance.now() - this.committedUs / 1000;
    this.announce('running');
    this.schedule(0);
  }
  pause(): void {
    if (this.phase !== 'running') return;
    requireThat(
      this.pendingFrame === null &&
        this.session.lastCommitted().committedHorizonMicroseconds === this.committedUs,
      'PAUSE_UNCOMMITTED',
    );
    this.clearTimer();
    this.session.pause();
    this.phase = 'paused';
    this.flushChunk();
    this.publish();
    this.proof({
      kind: 'pause',
      tickId: this.tick,
      atMicroseconds: this.committedUs,
      native: state(this.data),
      ledger: this.ledger,
    });
    this.announce('paused');
  }
  resume(): void {
    if (this.phase !== 'paused') return;
    this.session.resume();
    this.play();
  }
  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(delay: number): void {
    this.timer = windowlessTimeout(() => this.pump(), delay);
  }
  private pump(): void {
    this.timer = undefined;
    if (this.phase !== 'running') return;
    try {
      const started = performance.now();
      do {
        this.advance();
      } while (
        this.phase === 'running' &&
        (this.pendingFrame !== null ||
          (performance.now() - started < 10 &&
            this.committedUs / 1000 <= performance.now() - this.wallStart))
      );
      if (this.phase !== 'running') return;
      if (performance.now() - this.lastPaint >= 33) this.publish();
      this.schedule(Math.max(0, this.committedUs / 1000 - (performance.now() - this.wallStart)));
    } catch (error) {
      this.fail(error);
    }
  }
  private advance(): void {
    const { fixture: f } = this.assets;
    const step = this.queuedStep ?? this.session.step();
    if (!this.queuedStep) this.ledger.calls++;
    this.queuedStep = null;
    requireThat(this.ledger.calls <= f.raw.maxSessionCalls && step, 'CANONICAL_SESSION_STEP');
    if (step.kind === 'fault')
      throw new Error('ELECTRONICS_FAULT ' + JSON.stringify(step.diagnostics));
    if (this.pendingFrame) {
      const committed = this.session.lastCommitted().committedHorizonMicroseconds;
      if (committed === this.pendingFrame.to) {
        this.commit(this.pendingFrame);
        this.pendingFrame = null;
        this.queuedStep = step;
      } else
        requireThat(
          committed === this.pendingFrame.from && step.kind === 'working',
          'UNMATCHED_ATOMIC_COMMIT',
        );
      return;
    }
    if (step.kind === 'working') return;
    if (step.kind === 'complete') {
      this.finish(step);
      return;
    }
    requireThat(
      step.kind === 'shaft-start' || step.kind === 'shaft-interval',
      'UNEXPECTED_SHAFT_SUSPENSION',
    );
    requireThat(
      step.componentId === motorId &&
        step.port === port &&
        step.axis === 'positive-output-shaft' &&
        step.runId === 'r5-live:' + this.runCase &&
        step.generation === this.generation &&
        step.sequence === ++this.sequence &&
        step.committedHorizonMicroseconds === step.fromMicroseconds &&
        step.fromMicroseconds === this.committedUs,
      'CANONICAL_QUERY_IDENTITY',
    );
    const pre = state(this.data);
    const left = sample(pre, f);
    requireThat(left.measuredAtMicroseconds === step.fromMicroseconds, 'NATIVE_LEFT_TIME');
    if (step.kind === 'shaft-start') {
      requireThat(
        !this.sampledStart && this.tick === 0 && step.toMicroseconds === 0,
        'NATIVE_T0_SAMPLE',
      );
      respond(this.session, step, pre, f);
      this.sampledStart = true;
      return;
    }
    requireThat(
      this.sampledStart &&
        step.leftShaft.measuredAtMicroseconds === left.measuredAtMicroseconds &&
        Object.is(step.leftShaft.angleRadian, left.angleRadian) &&
        Object.is(step.leftShaft.angularVelocityRadPerSecond, left.angularVelocityRadPerSecond),
      'LIVE_LEFT_SHAFT_FEEDBACK',
    );
    this.pendingFrame = this.nativeStep(step, pre);
  }
  private nativeStep(query: Query, pre: NativeState): Frame {
    const { fixture: f, native: M } = this.assets;
    const { model, data, buffer, ledger } = this;
    const from = query.fromMicroseconds,
      to = query.toMicroseconds;
    requireThat(
      Number.isSafeInteger(to) &&
        to > from &&
        to - from <= f.budgets.maxStepUs &&
        to <= f.budgets.horizonUs &&
        (to <= f.comparison.interventionUs || from >= f.comparison.interventionUs) &&
        query.winding.state.atMicroseconds === to,
      'R5_INTERVAL_OR_TIMED_EDGE',
    );
    replayCap(ledger, f);
    const electrical = observeCircuit(query, f, this.runCase);
    const dt = (to - from) * 1e-6;
    near(electrical.torque * dt, electrical.impulse, 1e-16, 'HELD_OUTPUT_IMPULSE');
    const motorOmega = f.motor.gearRatio * pre.qvel[axleV]!;
    const effortOnMotor = kt * electrical.current - motorViscosity * motorOmega;
    const reverse = effortOnMotor * motorOmega < 0;
    const effort = finite(
      from >= f.comparison.interventionUs && reverse
        ? effortOnMotor * f.motor.gearRatio
        : electrical.impulse / dt,
      'R5_APPLIED_EFFORT',
    );
    model.opt.timestep = dt;
    near(finite(model.opt.timestep, 'NATIVE_TIMESTEP'), dt, 0, 'READBACK_TIMESTEP');
    ledger.step1++;
    M.mj_step1(model, data);
    ledger.step1Returned++;
    const still = state(data);
    requireThat(
      pre.time === still.time && arrayEq(pre.qpos, still.qpos) && arrayEq(pre.qvel, still.qvel),
      'STEP_ONE_CHANGED_STATE',
    );
    const before = observedPoses(data, projectPoses(pre.qpos, this.readback.anchors));
    const physicalPre = preWitness(M, model, data, pre, f, this.readback.allowed, buffer, ledger);
    const activeContacts = physicalPre.rows.size / 3;
    requireThat(
      Number.isInteger(activeContacts) &&
        ledger.activeContacts + activeContacts <= f.raw.maxContactsPerWorld &&
        this.proofBytes + rawByteCost(physicalPre.contacts.length, activeContacts) <=
          f.raw.byteCap / 2,
      'NATIVE_PRE_CAPTURE_ADMISSION',
    );
    data.qfrc_applied[axleV] = effort;
    actions(data, effort);
    ledger.step2++;
    M.mj_step2(model, data);
    ledger.step2Returned++;
    const post = state(data);
    requireThat(
      post.time > pre.time && timeUs(post, f.budgets.clockToleranceUs) === to,
      'NATIVE_RIGHT_TIME',
    );
    M.mj_differentiatePos(model, this.tangent, dt, pre.qpos, post.qpos);
    const delta = Array.from(f64(this.tangent.GetView(), nv, 'TANGENT_BUFFER'), (x) => x * dt);
    const contacts = resolvedContacts(
      M,
      model,
      data,
      physicalPre,
      f,
      this.readback.allowed,
      buffer,
      delta,
      ledger,
    );
    warnings(data, ledger);
    actions(data, effort);
    respond(this.session, query, post, f);
    return {
      from,
      to,
      pre,
      post,
      before,
      after: projectPoses(post.qpos, this.readback.anchors),
      effort,
      reverse,
      circuit: electrical,
      contacts,
      identities: physicalPre.contacts,
      kinematics: physicalPre.body,
    };
  }
  private commit(frame: Frame): void {
    requireThat(
      frame.from === this.committedUs &&
        frame.to === this.session.lastCommitted().committedHorizonMicroseconds,
      'COMMIT_CLOCK',
    );
    this.tick++;
    this.committedUs = frame.to;
    this.pose = frame.after;
    this.telemetry = {
      gpioD5Volt: frame.circuit.gpio,
      windingVoltageVolt: frame.circuit.windV,
      windingCurrentAmp: frame.circuit.current,
      shaftAngularVelocityRadPerSecond: frame.post.qvel[axleV]!,
      appliedTorqueNm: frame.effort,
    };
    const words = rawFrame(frame);
    requireThat(
      words.length * 8 === rawByteCost(frame.identities.length, frame.contacts.length),
      'EXACT_PROOF_BYTE_COST',
    );
    this.proofBytes += words.length * 8;
    requireThat(this.proofBytes <= this.assets.fixture.raw.byteCap / 2, 'PROOF_BYTE_CAP');
    if (this.chunkCount === 0) this.chunkStart = this.tick;
    this.chunk.push(...words);
    this.chunkCount++;
    this.witness.observe(frame);
    if (this.chunkCount >= 32) this.flushChunk();
  }
  private flushChunk(): void {
    if (this.chunkCount === 0) return;
    this.proof({
      kind: 'intervals',
      runCase: this.runCase,
      firstTick: this.chunkStart,
      count: this.chunkCount,
      binary: f64Base64(this.chunk),
    });
    this.chunk = [];
    this.chunkCount = 0;
  }
  private finish(step: Extract<Step, { kind: 'complete' }>): void {
    const { fixture: f, native: M } = this.assets;
    const final = state(this.data);
    const shaft = sample(final, f);
    requireThat(
      this.sampledStart &&
        this.committedUs === f.budgets.horizonUs &&
        step.committedHorizonMicroseconds === this.committedUs &&
        step.shaft &&
        step.shaft.angleRadian === shaft.angleRadian &&
        step.shaft.angularVelocityRadPerSecond === shaft.angularVelocityRadPerSecond &&
        step.shaft.measuredAtMicroseconds === shaft.measuredAtMicroseconds,
      'CANONICAL_TERMINAL_STATE',
    );
    // Terminal observation after the closed horizon, matching original R5.
    this.ledger.positionObservations++;
    M.mj_forward(this.model, this.data);
    const now = state(this.data);
    requireThat(
      now.time === final.time && arrayEq(now.qpos, final.qpos) && arrayEq(now.qvel, final.qvel),
      'TERMINAL_OBSERVATION_ADVANCED',
    );
    this.pose = observedPoses(this.data, this.pose);
    const gpio = step.events
      .filter((event) => event.terminal === 'd5')
      .map((event) => ({
        sequence: event.sequence,
        atMicroseconds: event.atMicroseconds,
        terminal: event.terminal,
        kind: event.kind,
        ...('mode' in event ? { mode: event.mode } : {}),
        ...('voltage' in event ? { voltageVolt: event.voltage } : {}),
      }));
    requireThat(
      JSON.stringify(gpio) === JSON.stringify(f.programs[this.runCase].gpio),
      'ACTUAL_CANONICAL_D5_TRACE',
    );
    requireThat(
      this.ledger.step1 === this.tick &&
        this.ledger.step1Returned === this.tick &&
        this.ledger.step2 === this.tick &&
        this.ledger.step2Returned === this.tick &&
        this.ledger.positionObservations === 2,
      'EXACT_NATIVE_TERMINAL_DISPATCH_CENSUS',
    );
    this.flushChunk();
    this.proof({
      kind: 'finish',
      runCase: this.runCase,
      runtime: 'COMPLETE',
      ...this.witness.complete(this.committedUs),
      tickId: this.tick,
      atMicroseconds: this.committedUs,
      final,
      endpointEnergy: this.energy(),
      gpio,
      ledger: this.ledger,
      bytes: this.proofBytes,
    });
    this.phase = 'complete';
    this.publish();
    this.close();
    requireThat(
      this.ledger.cleanupFailures.length === 0 && this.ledger.owned === this.ledger.freed,
      'TERMINAL_NATIVE_RESOURCE_LEAK',
    );
    this.announce('complete');
  }
  fail(error: unknown): void {
    this.phase = 'fault';
    this.clearTimer();
    const message = String(error).slice(0, 1600);
    try {
      this.flushChunk();
    } catch (cause) {
      this.ledger.cleanupFailures.push(String(cause));
    }
    this.proof({
      kind: 'finish',
      runCase: this.runCase,
      runtime: 'ERROR',
      physical: 'UNRESOLVED',
      causal: 'GAP_CAUSAL_ALT',
      error: message,
      tickId: this.tick,
      atMicroseconds: this.committedUs,
      ledger: this.ledger,
    });
    this.close();
    this.publish();
    this.announce('fault', message);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    const persistent = { session: 0, buffer: 0, data: 0, model: 0 };
    try {
      this.session.dispose();
      persistent.session += 1;
    } catch (error) {
      this.ledger.cleanupFailures.push(String(error));
    }
    const handles = [
      [this.mass, 'buffer'],
      [this.tangent, 'buffer'],
      [this.buffer, 'buffer'],
      [this.data, 'data'],
      [this.model, 'model'],
    ] as const;
    for (const [handle, family] of handles) {
      const freed = this.ledger.freed;
      release(handle, this.ledger);
      persistent[family] += this.ledger.freed - freed;
    }
    this.proof({ kind: 'cleanup', runCase: this.runCase, persistent, ...this.ledger });
  }
  dispose(): void {
    this.flushChunk();
    this.close();
    this.phase = 'disposed';
    this.announce('disposed');
  }
}
function windowlessTimeout(callback: () => void, delay: number): number {
  return (globalThis.setTimeout as unknown as (run: () => void, ms: number) => number)(
    callback,
    delay,
  );
}

async function prepare(generation: number, runCase: R5RunCase, assets: Assets) {
  const { native: M, fixture: f, xml } = assets;
  const { document, display } = await circuit(f, runCase);
  if (latestGeneration !== generation) return;
  const ledger: Ledger = {
    owned: 0,
    freed: 0,
    step1: 0,
    step1Returned: 0,
    step2: 0,
    step2Returned: 0,
    calls: 0,
    activeContacts: 0,
    positionObservations: 0,
    cleanupFailures: [],
  };
  const allocated: Handle[] = [];
  const take = <T extends Handle>(item: T): T => {
    allocated.unshift(own(item, ledger));
    return item;
  };
  let session: Session | undefined;
  try {
    const model = take(M.MjModel.from_xml_string(xml));
    const data = take(new M.MjData(model));
    const buffer = take(new M.DoubleBuffer(6));
    const tangent = take(new M.DoubleBuffer(nv));
    const mass = take(new M.DoubleBuffer(nv));
    const readback = nativeReadback(M, model, data, f);
    actions(data, 0);
    warnings(data, ledger);
    ledger.positionObservations++;
    M.mj_forward(model, data);
    const observed = state(data);
    requireThat(
      observed.time === 0 &&
        arrayEq(observed.qpos, readback.initial.qpos) &&
        arrayEq(observed.qvel, readback.initial.qvel),
      'INITIAL_OBSERVATION_ADVANCED',
    );
    assertTerrain(model, data, f);
    session = createElectronicsTtNativeDriveTestSession(document, {
      componentId: motorId,
      port,
      runId: 'r5-live:' + runCase,
      generation,
      maxEvents: f.budgets.maxEvents,
      requestedHorizonMicroseconds: f.budgets.horizonUs,
    });
    const candidate = new Run(
      generation,
      runCase,
      assets,
      session,
      model,
      data,
      buffer,
      tangent,
      mass,
      ledger,
      readback,
    );
    candidate.ready(display);
    active = candidate;
  } catch (error) {
    try {
      session?.dispose();
    } catch (cause) {
      ledger.cleanupFailures.push(String(cause));
    }
    for (const handle of allocated) release(handle, ledger);
    scope.postMessage({
      kind: 'proof',
      generation,
      record: { kind: 'cleanup', runCase, ...ledger },
    });
    throw error;
  }
}

let latestGeneration = 0;
let active: Run | undefined;
let assets: Promise<Assets> | undefined;
function isCommand(value: unknown): value is R5StandCommand {
  if (typeof value !== 'object' || value === null) return false;
  const command = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(command.generation) &&
    (command.kind === 'reset'
      ? command.runCase === 'powered' || command.runCase === 'control'
      : command.kind === 'play' ||
        command.kind === 'pause' ||
        command.kind === 'resume' ||
        command.kind === 'dispose')
  );
}
scope.onmessage = ({ data }) => {
  if (!isCommand(data)) return;
  const { generation, kind } = data;
  if (kind === 'reset') {
    if (generation <= latestGeneration) return;
    latestGeneration = generation;
    active?.dispose();
    active = undefined;
    assets ??= loadAssets();
    void assets
      .then((value) => prepare(generation, data.runCase, value))
      .catch((error: unknown) => {
        if (latestGeneration !== generation) return;
        scope.postMessage({
          kind: 'phase',
          generation,
          tickId: 0,
          atMicroseconds: 0,
          phase: 'fault',
          error: String(error).slice(0, 1600),
        });
      });
    return;
  }
  if (!active || generation !== active.generation || generation !== latestGeneration) return;
  try {
    if (kind === 'play') active.play();
    else if (kind === 'pause') active.pause();
    else if (kind === 'resume') active.resume();
    else {
      active.dispose();
      active = undefined;
    }
  } catch (error) {
    active?.fail(error);
  }
};
