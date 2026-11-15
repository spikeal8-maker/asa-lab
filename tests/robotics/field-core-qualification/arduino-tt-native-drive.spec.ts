import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import {
  createElectronicsTtNativeDriveTestSession,
  parseElectronicsEngineDocument,
} from '../../../contexts/electronics/engine.js';
import { BRUSHED_MOTOR_ASSEMBLY_PROFILES } from '../../../contexts/electronics/domain/models/brushed-motor-profiles.js';
import type { ComponentResult } from '../../../contexts/electronics/domain/solver.js';
import { createInitialRoboticsProject } from '../../../contexts/robotics/domain/default-project.js';
import fixture from './arduino-tt-native-drive.fixture.json';

const fixtureSha256 = '397f29ae62b28a609647458939a21bc9f6df43d16506001913a6d8f35e65f22f';
const fixtureUrl = new URL('./arduino-tt-native-drive.fixture.json', import.meta.url);
const output = process.env['ASA_ROBOTICS_TT_NATIVE_OUTPUT'];
const root = process.env['ASA_ROBOTICS_TT_NATIVE_ENGINE_ROOT'];
const sourcePin = process.env['ASA_ROBOTICS_TT_NATIVE_SOURCE_SHA256'];
const ids = ['uno', 'battery', 'left-motor', 'left-fet', 'left-flyback'] as const;
const unoId = ids[0];
const motorId = ids[2];
const port = 'tt-left-output';
const intervalColumns = [
  'from',
  'to',
  'nativeSeconds',
  'before',
  'after',
  'logicalGpio',
  'electrical',
  'windingV',
  'current',
  'priorCurrent',
  'backEmf',
  'temperature',
  'kclToleranceAmp',
  'maxKclResidualAmp',
  'viscousW',
  'transmissionW',
  'impulse',
  'appliedTorque',
  'contactTorque',
  'contacts',
  'potentialJ',
] as const;
const electricalColumns = [
  'gpioV',
  'driveA',
  'sourceV',
  'sourceA',
  'windingV',
  'windingA',
  'fetVds',
  'fetVgs',
  'fetA',
  'fetGateA',
  'diodeV',
  'diodeA',
  'inputW',
  'circuitLossW',
] as const;
const contactColumns = ['geom1', 'geom2', 'row', 'distance', 'force'] as const;
const [halfX, halfY, halfZ] = fixture.mechanics.bodyHalfExtentsM as [number, number, number];
const mass = fixture.mechanics.bodyMassKg;
const shapeInertias = [
  (mass * (halfY ** 2 + halfZ ** 2)) / 3,
  (mass * (halfX ** 2 + halfZ ** 2)) / 3,
  (mass * (halfX ** 2 + halfY ** 2)) / 3,
];
const angularInertia =
  fixture.motor.reflectedInertiaKgM2 +
  shapeInertias[2]! +
  mass * fixture.mechanics.bodyLocalComM[0]! ** 2;
const knownMotor = BRUSHED_MOTOR_ASSEMBLY_PROFILES.find(
  ({ profileId }) => profileId === fixture.motor.profileId,
);

type Session = ReturnType<typeof createElectronicsTtNativeDriveTestSession>;
type Step = NonNullable<ReturnType<Session['step']>>;
type NativeCase = 'free' | 'stop';
type NativeHandle = { delete(): void };
type Model = NativeHandle & {
  nq: number;
  nv: number;
  nu: number;
  ngeom: number;
  nbody: number;
  opt: { timestep: number } & Record<string, number | Float64Array>;
  dof_armature: Float64Array;
  body_inertia: Float64Array;
  body_ipos: Float64Array;
  body_mass: Float64Array;
};
type Data = NativeHandle & {
  time: number;
  qpos: Float64Array;
  qvel: Float64Array;
  qfrc_applied: Float64Array;
  qfrc_constraint: Float64Array;
  xipos: Float64Array;
  M: Float64Array;
  ncon: number;
  nefc: number;
  contact: NativeHandle & {
    size(): number;
    get(index: number):
      | (NativeHandle & {
          geom1: number;
          geom2: number;
          efc_address: number;
          dist: number;
          dim: number;
        })
      | undefined;
  };
};
type DoubleBuffer = NativeHandle & { GetView(): Float64Array };
type MuJoCo = {
  MjModel: { from_xml_string(xml: string): Model };
  MjData: new (model: Model) => Data;
  DoubleBuffer: new (count: number) => DoubleBuffer;
  mj_versionString(): string;
  mj_forward(model: Model, data: Data): void;
  mj_step(model: Model, data: Data): void;
  mj_contactForce(model: Model, data: Data, index: number, out: DoubleBuffer): void;
};
type NativeFactory = (options: {
  wasmBinary: Buffer;
  locateFile(name: string): string;
}) => Promise<MuJoCo>;

function demand(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function finite(value: number | undefined, witness: string): number {
  demand(value !== undefined && Number.isFinite(value), 'MISSING_FINITE_' + witness);
  return value;
}

function near(actual: number, expected: number, tolerance: number, message: string) {
  demand(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    message + ' actual=' + actual + ' expected=' + expected,
  );
}

function sha(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function vector(values: readonly number[]) {
  return values.join(' ');
}

function scene(kind: NativeCase) {
  const setup = fixture.mechanics;
  const stop =
    kind === 'stop'
      ? '<geom name="fixed-stop" type="box" pos="' +
        vector(setup.stopCenterM) +
        '" size="' +
        vector(setup.stopHalfExtentsM) +
        '" contype="0" conaffinity="0"/>'
      : '';
  const pair =
    kind === 'stop'
      ? '<contact><pair geom1="fixed-stop" geom2="rotor" condim="' +
        setup.contactDimension +
        '" margin="0" gap="0"/></contact>'
      : '';
  return (
    '<mujoco model="asa-tt-' +
    kind +
    '"><compiler angle="radian" autolimits="false"/>' +
    '<option timestep="0.0005" integrator="implicitfast" solver="Newton" jacobian="dense" ' +
    'cone="elliptic" iterations="100" ls_iterations="50" noslip_iterations="20" ccd_iterations="100" gravity="0 0 -9.81">' +
    '<flag autoreset="disable" diagexact="enable"/></option><worldbody>' +
    stop +
    '<body name="shaft" pos="' +
    vector(setup.pivotM) +
    '">' +
    '<inertial pos="' +
    vector(setup.bodyLocalComM) +
    '" mass="' +
    mass +
    '" diaginertia="' +
    vector(shapeInertias) +
    '"/>' +
    '<joint name="shaft-hinge" type="hinge" axis="' +
    vector(setup.axis) +
    '" armature="' +
    fixture.motor.reflectedInertiaKgM2 +
    '" damping="0" frictionloss="0" limited="false"/>' +
    '<geom name="rotor" type="box" pos="' +
    vector(setup.bodyLocalComM) +
    '" size="' +
    vector(setup.bodyHalfExtentsM) +
    '" contype="0" conaffinity="0"/></body></worldbody>' +
    pair +
    '</mujoco>'
  );
}

function circuit() {
  const starter = createInitialRoboticsProject();
  const include = (id: string) => ids.some((allowed) => allowed === id);
  const parsed = parseElectronicsEngineDocument({
    ...starter.circuit,
    components: starter.circuit.components
      .filter(({ id }) => include(id))
      .map((part) =>
        part.id === unoId
          ? {
              ...part,
              stateProperties: {
                arduinoCodeMode: 'text',
                arduinoSource: fixture.unoReference.source,
              },
            }
          : part,
      ),
    connections: starter.circuit.connections.filter(
      ({ from, to }) => include(from.componentId) && include(to.componentId),
    ),
  });
  demand(parsed.ok, 'REGISTERED_CIRCUIT_REJECTED');
  return parsed.document;
}

function exactInputs() {
  demand(sha(readFileSync(fixtureUrl)) === fixtureSha256, 'FIXTURE_SHA256');
  demand(sha(fixture.unoReference.source) === fixture.unoReference.sketchSha256, 'SKETCH_SHA256');
  demand(
    sha(JSON.stringify(fixture.unoReference.gpio)) === fixture.unoReference.gpioSha256,
    'REFERENCE_GPIO_SHA256',
  );
  demand(knownMotor, 'REGISTERED_TT_PROFILE_NOT_FOUND');
  near(
    knownMotor.rotorInertiaKgMeterSquared.value,
    fixture.motor.rotorInertiaKgM2,
    0,
    'PROFILE_INERTIA',
  );
  near(knownMotor.transmission.gearRatio.value, fixture.motor.gearRatio, 0, 'PROFILE_RATIO');
  near(
    fixture.motor.gearRatio ** 2 * fixture.motor.rotorInertiaKgM2,
    fixture.motor.reflectedInertiaKgM2,
    1e-18,
    'REFLECTED_ROTOR_INERTIA',
  );
  demand(
    fixture.windows.offAtUs === fixture.unoReference.gpio.at(-1)?.atMicroseconds,
    'REGISTERED_CUTOFF',
  );
  return knownMotor;
}

function within(parent: string, file: string) {
  const path = relative(parent, file);
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function receiptHandle(target: string) {
  const parent = realpathSync(dirname(target));
  const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  demand(
    isAbsolute(target) &&
      target.endsWith('.jsonl') &&
      within(realpathSync(tmpdir()), parent) &&
      parent !== repo &&
      !within(repo, parent),
    'EXCLUSIVE_EXTERNAL_TEMP_JSONL_REQUIRED',
  );
  return openSync(join(parent, relative(dirname(target), target)), 'wx');
}

function checkedBytes(directory: string, name: string, digest: string) {
  const file = realpathSync(join(directory, name));
  demand(within(directory, file), 'ENGINE_RESOURCE_ESCAPED ' + name);
  const bytes = readFileSync(file);
  demand(sha(bytes) === digest, 'ENGINE_RESOURCE_DIGEST ' + name);
  return { bytes, file };
}

async function loadNative(packageRoot: string) {
  demand(isAbsolute(packageRoot), 'ABSOLUTE_ENGINE_PACKAGE_ROOT');
  const directory = realpathSync(packageRoot);
  const info = JSON.parse(
    checkedBytes(directory, 'package.json', fixture.engine.packageSha256).bytes.toString(),
  );
  demand(
    info.name === '@mujoco/mujoco' &&
      info.version === fixture.engine.version &&
      info.license === fixture.engine.declaredNpmLicense,
    'ENGINE_PACKAGE_ID',
  );
  const glue = checkedBytes(directory, 'mujoco.js', fixture.engine.glueSha256);
  const wasm = checkedBytes(directory, 'mujoco.wasm', fixture.engine.wasmSha256);
  const { default: factory } = (await import(pathToFileURL(glue.file).href)) as {
    default: NativeFactory;
  };
  const engine = await factory({
    wasmBinary: wasm.bytes,
    locateFile(name) {
      demand(name === 'mujoco.wasm', 'UNEXPECTED_ENGINE_RESOURCE');
      return wasm.file;
    },
  });
  demand(engine.mj_versionString() === fixture.engine.version, 'ENGINE_NATIVE_VERSION');
  return engine;
}

function receiptWriter(fd: number) {
  let written = 0;
  return (record: { readonly type: string } & Record<string, unknown>) => {
    const text =
      JSON.stringify(record, (_key, value: unknown) =>
        typeof value === 'number' && !Number.isFinite(value)
          ? String(value)
          : typeof value === 'number' && Object.is(value, -0)
            ? '-0'
            : value,
      ) + '\n';
    const next = written + Buffer.byteLength(text);
    const footer = ['case-cleanup', 'first-error', 'finish'].includes(record.type);
    const limit = fixture.limits.receiptMaxBytes - (footer ? 0 : 65_536);
    demand(next <= limit, 'NATIVE_RECEIPT_LIMIT');
    written = next;
    writeFileSync(fd, text);
    return text;
  };
}

function nativeSample(data: Data) {
  const rawTimeUs = data.time * 1e6;
  const measuredAtMicroseconds = Math.round(rawTimeUs);
  near(
    rawTimeUs,
    measuredAtMicroseconds,
    fixture.limits.nativeClockToleranceUs,
    'NATIVE_OFF_CANONICAL_GRID',
  );
  demand(Number.isSafeInteger(measuredAtMicroseconds), 'NATIVE_MICROSECOND_RANGE');
  return {
    measuredAtMicroseconds,
    angleRadian: finite(data.qpos[0], 'NATIVE_ANGLE'),
    angularVelocityRadPerSecond: finite(data.qvel[0], 'NATIVE_SPEED'),
  };
}

function replyFor(
  query: {
    componentId: string;
    port: string;
    runId: string;
    generation: number;
    sequence: number;
    token: symbol;
    axis: string;
    fromMicroseconds: number;
    toMicroseconds: number;
  },
  sample: ReturnType<typeof nativeSample>,
) {
  const {
    componentId,
    port,
    runId,
    generation,
    sequence,
    token,
    axis,
    fromMicroseconds,
    toMicroseconds,
  } = query;
  return {
    componentId,
    port,
    runId,
    generation,
    sequence,
    token,
    axis,
    fromMicroseconds,
    toMicroseconds,
    ...sample,
  };
}

function expectedGpioAt(time: number) {
  return fixture.unoReference.gpio
    .filter(({ kind, atMicroseconds }) => kind === 'output-change' && atMicroseconds <= time)
    .at(-1)?.voltageVolt;
}

function readCircuit(
  parts: readonly ComponentResult[],
  fixedGpio: number,
  kclToleranceAmp: number,
) {
  const [uno, battery, motor, fet, diode] = ids.map((id) => {
    const part = parts.find((row) => row.componentId === id);
    demand(part, 'MISSING_SOLVER_COMPONENT ' + id);
    return part;
  }) as [ComponentResult, ComponentResult, ComponentResult, ComponentResult, ComponentResult];
  const voltage = (
    part: ComponentResult,
    plus: keyof ComponentResult['terminalVoltages'],
    minus: keyof ComponentResult['terminalVoltages'],
  ) =>
    finite(part.terminalVoltages[plus], part.componentId + ':' + plus) -
    finite(part.terminalVoltages[minus], part.componentId + ':' + minus);
  const gpioV = voltage(uno, 'd5', 'power-gnd-1');
  const driveA = finite(uno.branchCurrents?.['d5'], 'GPIO_D5_CURRENT');
  const sourceV = voltage(battery, 'BAT+', 'BAT-');
  const sourceA = -finite(battery.terminalCurrents?.['BAT+'], 'BATTERY_CURRENT');
  const windingV = voltage(motor, 'positive', 'negative');
  const windingA = finite(motor.terminalCurrents?.positive, 'WINDING_CURRENT');
  const fetVds = voltage(fet, 'drain', 'source');
  const fetVgs = voltage(fet, 'gate', 'source');
  const fetA = finite(fet.branchCurrents?.['drain'], 'FET_DRAIN_CURRENT');
  const fetGateA = finite(fet.branchCurrents?.['gate'], 'FET_GATE_CURRENT');
  const diodeV = voltage(diode, 'anode', 'cathode');
  const diodeA = finite(diode.current, 'FLYBACK_CURRENT');
  const tol = fixture.limits.terminalReadTolerance;
  near(windingV + fetVds, sourceV, tol, 'SERIES_KVL');
  near(diodeV, -windingV, tol, 'FLYBACK_WINDING_KVL');
  near(fetVgs, gpioV, tol, 'GPIO_GATE_KVL');
  near(windingA, fetA + diodeA, kclToleranceAmp, 'RETURN_KCL');
  near(sourceA + diodeA, windingA, kclToleranceAmp, 'BATTERY_KCL');
  near(driveA, fetGateA, kclToleranceAmp, 'GATE_KCL');
  return {
    gpioV,
    driveA,
    sourceV,
    sourceA,
    windingV,
    windingA,
    fetVds,
    fetVgs,
    fetA,
    fetGateA,
    diodeV,
    diodeA,
    inputW: 6 * sourceA + fixedGpio * driveA,
    circuitLossW:
      (6 - sourceV) * sourceA +
      (fixedGpio - gpioV) * driveA +
      fetVds * fetA +
      fetVgs * fetGateA +
      diodeV * diodeA,
  };
}

function caseTelemetry() {
  return {
    intervals: 0,
    calls: 0,
    contactCalls: 0,
    contactWrapperAttempts: 0,
    contactWrappersCreated: 0,
    contactDeleteAttempts: 0,
    contactWrappersDeleted: 0,
    inputJ: 0,
    positiveInputJ: 0,
    circuitLossJ: 0,
    copperJ: 0,
    viscousJ: 0,
    transmissionJ: 0,
    backwardEulerJ: 0,
    mechanicalEulerJ: 0,
    contactAbsorbedJ: 0,
    nativeDriveJ: 0,
    heldShaftJ: 0,
    elapsedDriveS: 0,
    speedIntegral: 0,
    currentIntegral: 0,
    stopImpulseNs: 0,
    firstContactUs: null as number | null,
    maxFlybackA: 0,
    cutoffAngle: null as number | null,
    coastAngle: null as number | null,
    initialPotentialJ: 0,
    finalPotentialJ: 0,
    statesDeleted: 0,
    sessionDisposed: false,
    terminal: null as ReturnType<typeof nativeSample> | null,
    storedMagneticJ: 0,
    finalKineticJ: 0,
    normalizedGpioSha256: '',
  };
}

type Telemetry = ReturnType<typeof caseTelemetry>;

function trackInterval(
  total: Telemetry,
  from: ReturnType<typeof nativeSample>,
  to: ReturnType<typeof nativeSample>,
  rightCurrent: number,
  priorCurrent: number,
  impulse: number,
  circuit: ReturnType<typeof readCircuit>,
  viscousW: number,
  gearW: number,
  contactTorque: number,
  normalForce: number,
  resistance: number,
  inductance: number,
) {
  const fromUs = from.measuredAtMicroseconds;
  const toUs = to.measuredAtMicroseconds;
  const dt = (toUs - fromUs) / 1e6;
  const dAngle = to.angleRadian - from.angleRadian;
  total.inputJ += circuit.inputW * dt;
  total.positiveInputJ += Math.max(0, circuit.inputW) * dt;
  total.circuitLossJ += circuit.circuitLossW * dt;
  total.copperJ += resistance * rightCurrent ** 2 * dt;
  total.viscousJ += viscousW * dt;
  total.transmissionJ += gearW * dt;
  total.backwardEulerJ += (inductance / 2) * (rightCurrent - priorCurrent) ** 2;
  total.mechanicalEulerJ +=
    (angularInertia / 2) * (to.angularVelocityRadPerSecond - from.angularVelocityRadPerSecond) ** 2;
  total.contactAbsorbedJ -= contactTorque * dAngle;
  total.nativeDriveJ += (impulse * dAngle) / dt;
  total.heldShaftJ += impulse * from.angularVelocityRadPerSecond;
  if (normalForce > 0) total.firstContactUs ??= fromUs;
  total.stopImpulseNs += normalForce * dt;
  if (fromUs >= fixture.windows.offAtUs && toUs <= fixture.windows.coastEndUs)
    total.maxFlybackA = Math.max(total.maxFlybackA, circuit.diodeA);
  if (toUs === fixture.windows.offAtUs) total.cutoffAngle = to.angleRadian;
  if (
    fromUs < fixture.windows.coastEndUs &&
    toUs >= fixture.windows.coastEndUs &&
    total.cutoffAngle !== null
  )
    total.coastAngle = to.angleRadian - total.cutoffAngle;
  const window =
    Math.max(
      0,
      Math.min(toUs, fixture.windows.drivenToUs) - Math.max(fromUs, fixture.windows.drivenFromUs),
    ) / 1e6;
  total.elapsedDriveS += window;
  total.speedIntegral += Math.abs(to.angularVelocityRadPerSecond) * window;
  total.currentIntegral += rightCurrent * window;
  total.storedMagneticJ = (inductance / 2) * rightCurrent ** 2;
}

function actualContact(
  M: Pick<MuJoCo, 'mj_contactForce'>,
  model: Model,
  data: Data,
  buffer: DoubleBuffer,
  kind: NativeCase,
  totals: Telemetry,
) {
  const { ncon, nefc } = data;
  demand(Number.isSafeInteger(ncon) && ncon >= 0 && ncon <= 8, 'NATIVE_CONTACT_COUNT');
  demand(nefc >= 0 && nefc <= 8, 'NATIVE_CONSTRAINT_COUNT');
  demand(kind === 'stop' || (ncon === 0 && nefc === 0), 'FREE_SHAFT_CONTACT');
  const rows: { geom: number[]; row: number; distance: number; force: number }[] = [];
  if (ncon === 0) {
    demand(nefc === 0, 'NATIVE_COMPLETE_DISTINCT_CONTACT_ROWS');
    return rows;
  }

  const cleanupErrors: unknown[] = [];
  const acquire = <Handle extends NativeHandle>(get: () => Handle | undefined): Handle => {
    demand(totals.contactWrapperAttempts < 9 * totals.intervals, 'NATIVE_CONTACT_WRAPPER_BUDGET');
    totals.contactWrapperAttempts++;
    const handle = get();
    demand(handle, 'NATIVE_CONTACT_WRAPPER_MISSING');
    totals.contactWrappersCreated++;
    return handle;
  };
  const release = (handle: NativeHandle) => {
    totals.contactDeleteAttempts++;
    try {
      handle.delete();
      totals.contactWrappersDeleted++;
    } catch (error) {
      cleanupErrors.push(error);
    }
  };

  // The getter and every get() return owned wrappers in the pinned WASM binding.
  const vector = acquire(() => data.contact);
  let primary: { error: unknown } | undefined;
  try {
    demand(vector.size() === ncon, 'NATIVE_CONTACT_VECTOR_COUNT');
    for (let index = 0; index < ncon && cleanupErrors.length === 0; index++) {
      const contact = acquire(() => vector.get(index));
      try {
        const { geom1, geom2, efc_address: row, dist, dim } = contact;
        demand(
          Math.min(geom1, geom2) === 0 &&
            Math.max(geom1, geom2) === 1 &&
            dim === fixture.mechanics.contactDimension,
          'UNEXPECTED_NATIVE_CONTACT_PAIR',
        );
        if (row < 0) continue;
        demand(
          row < nefc && totals.contactCalls < 8 * fixture.limits.maxIntervalsPerWorld,
          'NATIVE_CONTACT_CALL_BUDGET',
        );
        M.mj_contactForce(model, data, index, buffer);
        totals.contactCalls++;
        const force = finite(buffer.GetView()[0], 'CONTACT_NORMAL_FORCE');
        demand(force >= 0, 'NEGATIVE_CONTACT_NORMAL_FORCE');
        rows.push({ geom: [geom1, geom2], row, distance: finite(dist, 'CONTACT_DISTANCE'), force });
      } finally {
        release(contact);
      }
    }
  } catch (error) {
    primary = { error };
  } finally {
    release(vector);
  }
  if (cleanupErrors.length > 0) {
    const errors = primary ? [primary.error, ...cleanupErrors] : cleanupErrors;
    throw new AggregateError(errors, errors.map(String).join(' / '));
  }
  if (primary) throw primary.error;
  demand(
    rows.length === nefc && new Set(rows.map(({ row }) => row)).size === nefc,
    'NATIVE_COMPLETE_DISTINCT_CONTACT_ROWS',
  );
  return rows;
}

function validateModel(model: Model, data: Data, kind: NativeCase) {
  demand(
    model.nq === 1 &&
      model.nv === 1 &&
      model.nu === 0 &&
      model.nbody === 2 &&
      model.ngeom === (kind === 'stop' ? 2 : 1),
    'REGISTERED_SINGLE_SHAFT_MODEL',
  );
  for (const [key, expected] of Object.entries(fixture.engine.profile)) {
    const real = model.opt[key];
    if (Array.isArray(expected)) expect(Array.from(real as Float64Array)).toEqual(expected);
    else expect(real).toBe(expected);
  }
  near(
    finite(model.dof_armature[0], 'NATIVE_ARMATURE'),
    fixture.motor.reflectedInertiaKgM2,
    0,
    'ARMATURE_ONCE',
  );
  near(finite(model.body_mass[1], 'NATIVE_ROTOR_MASS'), mass, 0, 'ROTOR_MASS');
  near(
    finite(model.body_ipos[3], 'NATIVE_ROTOR_COM'),
    fixture.mechanics.bodyLocalComM[0]!,
    0,
    'ROTOR_COM',
  );
  near(
    finite(model.body_inertia[5], 'NATIVE_ROTOR_INERTIA'),
    shapeInertias[2]!,
    1e-18,
    'ROTOR_INERTIA',
  );
  near(finite(data.M[0], 'NATIVE_MASS_MATRIX'), angularInertia, 1e-15, 'SHARED_INERTIA_READBACK');
}

function runCase(
  M: MuJoCo,
  kind: NativeCase,
  repeat: number,
  record: ReturnType<typeof receiptWriter>,
  profile: NonNullable<typeof knownMotor>,
) {
  const xml = scene(kind);
  const document = circuit();
  const session = createElectronicsTtNativeDriveTestSession(document, {
    componentId: motorId,
    port,
    runId: 'asa-test-tt-' + kind,
    generation: 1,
    requestedHorizonMicroseconds: fixture.windows.horizonUs,
    maxEvents: 1024,
  });
  const totals = caseTelemetry();
  const digest = createHash('sha256');
  const handles: NativeHandle[] = [];
  const keep = <Handle extends NativeHandle>(handle: Handle) => {
    handles.unshift(handle);
    return handle;
  };
  let completed: Extract<Step, { kind: 'complete' }> | undefined;
  let caseError: { error: unknown } | undefined;
  const cleanupErrors: unknown[] = [];
  let priorCurrent = 0;
  let sequence: number | undefined;
  const resistance = profile.armatureResistanceOhm.value;
  const inductance = profile.armatureInductanceHenry.value;
  try {
    record({
      type: 'case-start',
      kind,
      repeat,
      modelSha256: sha(xml),
      circuitSha256: sha(JSON.stringify(document)),
    });
    const model = keep(M.MjModel.from_xml_string(xml));
    const data = keep(new M.MjData(model));
    const force = keep(new M.DoubleBuffer(6));
    const options = model.opt;
    M.mj_forward(model, data);
    validateModel(model, data, kind);
    const initial = nativeSample(data);
    demand(
      initial.measuredAtMicroseconds === 0 &&
        initial.angleRadian === 0 &&
        initial.angularVelocityRadPerSecond === 0 &&
        data.ncon === 0,
      'NATIVE_FACTORY_INITIAL_STATE',
    );
    const potential = () =>
      -mass * fixture.engine.profile.gravity[2]! * finite(data.xipos[5], 'NATIVE_COM_Z');
    totals.initialPotentialJ = potential();

    for (; totals.calls < fixture.limits.maxSessionCallsPerWorld;) {
      totals.calls++;
      const query = session.step();
      demand(query, 'BUS_EARLY_CLOSE');
      if (query.kind === 'working') continue;
      if (query.kind === 'fault') throw new Error('ELECTRICAL_STEP_FAULT ' + JSON.stringify(query));
      if (query.kind === 'complete') {
        completed = query;
        break;
      }
      demand(
        query.kind === 'shaft-start' || query.kind === 'shaft-interval',
        'UNEXPECTED_BUS_STEP',
      );
      demand(
        query.componentId === motorId &&
          query.port === port &&
          query.axis === 'positive-output-shaft' &&
          query.committedHorizonMicroseconds === query.fromMicroseconds &&
          Number.isSafeInteger(query.fromMicroseconds) &&
          Number.isSafeInteger(query.toMicroseconds),
        'IDENTITY_OR_COMMIT_AT_REQUEST',
      );
      if (sequence !== undefined) demand(sequence + 1 === query.sequence, 'REQUEST_SEQUENCE');
      sequence = query.sequence;
      const before = nativeSample(data);
      demand(before.measuredAtMicroseconds === query.fromMicroseconds, 'NATIVE_LEFT_TIME');
      if (query.kind === 'shaft-start') {
        demand(
          totals.intervals === 0 &&
            before.measuredAtMicroseconds === 0 &&
            query.toMicroseconds === 0,
          'SOLE_NATIVE_INITIAL_SAMPLE',
        );
        demand(session.respond(replyFor(query, before)), 'INITIAL_REPLY');
        continue;
      }

      demand(
        query.quality.passed && query.winding.state.failureMode === 'none',
        'FAILED_MNA_OR_OPEN_WINDING',
      );
      demand(totals.intervals < fixture.limits.maxIntervalsPerWorld, 'NATIVE_ADVANCE_LIMIT');
      const stepUs = query.toMicroseconds - query.fromMicroseconds;
      demand(stepUs > 0 && stepUs <= fixture.limits.maxIntervalUs, 'NATIVE_INTERVAL_WIDTH');
      expect(query.leftShaft).toEqual(before);
      const nextGpio = fixture.unoReference.gpio.find(
        ({ atMicroseconds }) => atMicroseconds > query.fromMicroseconds,
      );
      demand(
        nextGpio === undefined || nextGpio.atMicroseconds >= query.toMicroseconds,
        'INTERVAL_STRADDLES_ACTUAL_GPIO',
      );
      const logicalGpio = finite(expectedGpioAt(query.fromMicroseconds), 'REGISTERED_GPIO_LEVEL');
      const electrical = readCircuit(query.components, logicalGpio, query.quality.kclToleranceAmp);
      demand(
        logicalGpio === 0 ? Math.abs(electrical.gpioV) < 2.5 : electrical.gpioV >= 2.5,
        'ACTUAL_GPIO_LEVEL',
      );
      const current = finite(query.winding.intervalCurrentAmp, 'EXTERNAL_WINDING_CURRENT');
      const windingV = finite(query.windingVoltageVolt, 'MNA_EXACT_WINDING_VOLTAGE');
      near(
        electrical.windingV,
        windingV,
        fixture.limits.terminalReadTolerance,
        'MNA_WINDING_VOLTAGE',
      );
      near(
        electrical.windingA,
        current,
        fixture.limits.terminalReadTolerance,
        'MNA_WINDING_CURRENT',
      );
      const dt = stepUs / 1e6;
      const backEmf =
        profile.backEmfVoltSecondPerRadian.value *
        fixture.motor.gearRatio *
        before.angularVelocityRadPerSecond;
      const predicted =
        (windingV - backEmf + (inductance / dt) * priorCurrent) / (resistance + inductance / dt);
      near(current, predicted, 1e-10, 'EXACT_WINDING_COMPANION');
      demand(query.winding.state.atMicroseconds === query.toMicroseconds, 'WINDING_RIGHT_TIME');
      near(query.winding.state.currentAmp, current, 0, 'WINDING_ACCEPTED_CURRENT');
      const impulse = finite(
        query.winding.outputTorqueImpulseNewtonMeterSeconds,
        'WINDING_IMPULSE',
      );
      const torque = finite(query.winding.outputTorqueNewtonMeter, 'WINDING_TORQUE');
      near(impulse, torque * dt, 1e-16, 'WINDING_IMPULSE_BUDGET');

      options.timestep = dt;
      near(options.timestep, dt, 0, 'NATIVE_EXACT_STEP_READBACK');
      data.qfrc_applied[0] = impulse / dt;
      M.mj_step(model, data);
      totals.intervals++;
      const after = nativeSample(data);
      const appliedTorque = finite(data.qfrc_applied[0], 'NATIVE_APPLIED_TORQUE');
      const contactTorque = finite(data.qfrc_constraint[0], 'NATIVE_CONSTRAINT_TORQUE');
      demand(after.measuredAtMicroseconds === query.toMicroseconds, 'NATIVE_RIGHT_TIME');
      near(appliedTorque * dt, impulse, 1e-16, 'APPLIED_IMPULSE_READBACK');
      near(
        angularInertia * (after.angularVelocityRadPerSecond - before.angularVelocityRadPerSecond),
        impulse + contactTorque * dt,
        1e-8,
        'NATIVE_SIGNED_MOMENTUM_BALANCE',
      );
      const contacts = actualContact(M, model, data, force, kind, totals);
      const normal = contacts.reduce((sum, row) => sum + row.force, 0);
      if (contacts.length === 0) near(contactTorque, 0, 1e-12, 'CONTACT_TORQUE_WITHOUT_NATIVE_ROW');
      const row = {
        type: 'interval',
        from: before.measuredAtMicroseconds,
        to: after.measuredAtMicroseconds,
        nativeSeconds: data.time,
        before: [before.angleRadian, before.angularVelocityRadPerSecond],
        after: [after.angleRadian, after.angularVelocityRadPerSecond],
        logicalGpio,
        electrical,
        windingV,
        current,
        priorCurrent,
        backEmf,
        temperature: finite(query.winding.state.temperatureCelsius, 'WINDING_TEMPERATURE'),
        kclToleranceAmp: query.quality.kclToleranceAmp,
        maxKclResidualAmp: query.quality.maxKclResidualAmp,
        viscousW: finite(query.winding.viscousLossWatt, 'WINDING_VISCOUS_LOSS'),
        transmissionW: finite(query.winding.transmissionLossWatt, 'WINDING_TRANSMISSION_LOSS'),
        impulse,
        appliedTorque,
        contactTorque,
        contacts,
        potentialJ: potential(),
      };
      const values = intervalColumns.map((key) => {
        if (key === 'electrical') return electricalColumns.map((column) => electrical[column]);
        if (key === 'contacts')
          return contacts.map(({ geom, row: address, distance, force }) => [
            ...geom,
            address,
            distance,
            force,
          ]);
        return row[key];
      });
      digest.update(record({ type: 'interval', values }));
      trackInterval(
        totals,
        before,
        after,
        current,
        priorCurrent,
        impulse,
        electrical,
        row.viscousW,
        row.transmissionW,
        contactTorque,
        normal,
        resistance,
        inductance,
      );
      priorCurrent = current;
      const response = replyFor(query, after);
      demand(
        session.respond(response) && !session.respond(response),
        'ATOMIC_REPLY_AND_DUPLICATE_REJECTION',
      );
      demand(
        session.lastCommitted().committedHorizonMicroseconds === query.fromMicroseconds,
        'PRIVATE_UNTIL_CANONICAL_COMMIT',
      );
    }

    demand(completed?.observation.quality.passed, 'COMPLETE_MNA_QUALITY');
    demand(totals.intervals > 0 && session.step() === undefined, 'BOUNDED_COMPLETE_SESSION');
    totals.terminal = nativeSample(data);
    expect(completed.shaft).toEqual(totals.terminal);
    demand(
      completed.committedHorizonMicroseconds === fixture.windows.horizonUs &&
        totals.terminal.measuredAtMicroseconds === fixture.windows.horizonUs,
      'SYNCHRONIZED_TEN_SECOND_HORIZON',
    );
    near(
      finite(completed.winding?.currentAmp, 'COMMITTED_FINAL_WINDING'),
      priorCurrent,
      0,
      'COMMITTED_FINAL_CURRENT',
    );
    const normalized = completed.events
      .filter((event) => event.componentId === unoId && event.terminal === 'd5')
      .map((event, eventSequence) => ({
        sequence: eventSequence,
        atMicroseconds: event.atMicroseconds,
        terminal: event.terminal,
        kind: event.kind,
        ...(event.kind === 'pin-mode-change'
          ? { mode: event.mode }
          : { voltageVolt: event.voltage }),
      }));
    expect(normalized).toEqual(fixture.unoReference.gpio);
    totals.normalizedGpioSha256 = sha(JSON.stringify(normalized));
    demand(
      totals.normalizedGpioSha256 === fixture.unoReference.gpioSha256,
      'REAL_CANONICAL_GPIO_DIGEST',
    );
    totals.finalPotentialJ = potential();
    totals.finalKineticJ = (angularInertia / 2) * totals.terminal.angularVelocityRadPerSecond ** 2;
    record({ type: 'gpio', repeat, kind, events: normalized });
  } catch (error) {
    caseError = { error };
  } finally {
    try {
      session.dispose();
      totals.sessionDisposed = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const handle of handles) {
      try {
        handle.delete();
        totals.statesDeleted++;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      record({
        type: 'case-cleanup',
        repeat,
        kind,
        counts: {
          intervals: totals.intervals,
          calls: totals.calls,
          contactQueries: totals.contactCalls,
          contactWrapperAttempts: totals.contactWrapperAttempts,
          contactWrappersCreated: totals.contactWrappersCreated,
          contactDeleteAttempts: totals.contactDeleteAttempts,
          contactWrappersDeleted: totals.contactWrappersDeleted,
          handles: totals.statesDeleted,
          sessionDisposed: totals.sessionDisposed,
        },
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length) {
    const errors = caseError ? [caseError.error, ...cleanupErrors] : cleanupErrors;
    throw new AggregateError(errors, errors.map(String).join(' / '));
  }
  if (caseError) throw caseError.error;

  const dissipated =
    totals.circuitLossJ +
    totals.copperJ +
    totals.viscousJ +
    totals.transmissionJ +
    totals.backwardEulerJ +
    totals.mechanicalEulerJ +
    totals.contactAbsorbedJ;
  const stored =
    totals.storedMagneticJ +
    totals.finalKineticJ +
    totals.finalPotentialJ -
    totals.initialPotentialJ;
  // The fixed world's anchor and stop have no displacement. Their external work is zero;
  // contact work on the shaft is independently recovered from generalized force above.
  const externalWorkJ = 0;
  const residualJ = stored + dissipated - totals.inputJ - externalWorkJ;
  const limitJ = Math.max(
    fixture.limits.absoluteEnergyLimitJ,
    fixture.limits.relativeEnergyLimit * totals.positiveInputJ,
  );
  const summary = {
    ...totals,
    dissipated,
    stored,
    externalWorkJ,
    residualJ,
    limitJ,
    nativeVsHeldShaftWorkJ: totals.nativeDriveJ - totals.heldShaftJ,
    intervalDigest: digest.digest('hex'),
  };
  record({ type: 'case-summary', repeat, kind, summary });
  demand(
    totals.statesDeleted === 3 &&
      totals.sessionDisposed &&
      totals.contactWrapperAttempts === totals.contactWrappersCreated &&
      totals.contactWrappersCreated === totals.contactDeleteAttempts &&
      totals.contactDeleteAttempts === totals.contactWrappersDeleted,
    'COMPLETE_CASE_CLEANUP',
  );
  demand(totals.positiveInputJ > 0, 'NO_MEASURED_ELECTRICAL_INPUT_WORK');
  near(
    totals.elapsedDriveS,
    (fixture.windows.drivenToUs - fixture.windows.drivenFromUs) / 1e6,
    1e-9,
    'ACTUAL_ALIGNED_DRIVE_WINDOW',
  );
  demand(
    totals.contactAbsorbedJ >= -fixture.limits.absoluteEnergyLimitJ,
    'CONTACT_NET_ENERGY_CREATION',
  );
  demand(
    Number.isFinite(residualJ) && Math.max(0, residualJ) <= limitJ,
    'TEN_SECOND_CREATION_ENERGY_LIMIT ' + JSON.stringify({ residualJ, limitJ }),
  );
  return summary;
}

it('releases the owned contact vector and attempted copies on native wrapper failure', () => {
  const released: string[] = [];
  let vectorGets = 0;
  const data = {
    ncon: 2,
    nefc: 2,
    get contact() {
      vectorGets++;
      return {
        size: () => 2,
        get: (index: number) => ({
          geom1: 0,
          geom2: 1,
          efc_address: index,
          dist: -0.0001,
          dim: fixture.mechanics.contactDimension,
          delete() {
            released.push('copy-' + index);
            if (index === 1) throw new Error('copy delete failed');
          },
        }),
        delete: () => {
          released.push('vector');
        },
      };
    },
  } as Data;
  const engine = {
    mj_contactForce(_model: Model, _data: Data, index: number) {
      if (index === 1) throw new Error('force read failed');
    },
  };
  const buffer = { GetView: () => new Float64Array([1]), delete: () => {} };
  const totals = caseTelemetry();
  totals.intervals = 1;
  expect(() => actualContact(engine, {} as Model, data, buffer, 'stop', totals)).toThrow(
    'force read failed / Error: copy delete failed',
  );
  expect(vectorGets).toBe(1);
  expect(released).toEqual(['copy-0', 'copy-1', 'vector']);
  expect(totals).toMatchObject({
    contactWrapperAttempts: 3,
    contactWrappersCreated: 3,
    contactDeleteAttempts: 3,
    contactWrappersDeleted: 2,
  });
});

it('freezes the scoped circuit, Uno timing reference, armature and paired scene', () => {
  exactInputs();
  const parsed = circuit();
  expect(parsed.components.map(({ id }) => id).sort()).toEqual([...ids].sort());
  expect(parsed.connections).toHaveLength(7);
  expect(fixture.unoReference.gpio).toHaveLength(20);
  expect(
    fixture.unoReference.gpio.some(
      ({ atMicroseconds }) => atMicroseconds % fixture.limits.maxIntervalUs !== 0,
    ),
  ).toBe(true);
  expect(scene('stop')).toContain('<pair geom1="fixed-stop" geom2="rotor" condim="1"');
  expect(scene('free')).not.toContain('fixed-stop');
  expect(fixture.windows.horizonUs).toBe(10_000_000);
});

it('isolates pending and stale native replies before any WASM is loaded', () => {
  const document = circuit();
  const request = {
    componentId: motorId,
    port,
    runId: 'same-labels',
    generation: 1,
    requestedHorizonMicroseconds: 1000,
  };
  const first = createElectronicsTtNativeDriveTestSession(document, request);
  const second = createElectronicsTtNativeDriveTestSession(document, request);
  const initial = { measuredAtMicroseconds: 0, angleRadian: 0, angularVelocityRadPerSecond: 0 };
  try {
    const start = first.step();
    const other = second.step();
    demand(
      start?.kind === 'shaft-start' && other?.kind === 'shaft-start',
      'NATIVE_INITIAL_QUERY_MISSING',
    );
    const reply = replyFor(start, initial);
    expect(second.respond(reply)).toBe(false);
    expect(first.respond({ ...reply, measuredAtMicroseconds: 1 })).toBe(false);
    expect(first.respond({ ...reply, axis: 'bad-axis' })).toBe(false);
    expect(first.respond({ ...reply, port: 'other' })).toBe(false);
    expect(first.respond({ ...reply, angularVelocityRadPerSecond: Number.NaN })).toBe(false);
    first.pause();
    expect(first.step()).toEqual({ kind: 'paused', committedHorizonMicroseconds: 0 });
    expect(first.respond(reply)).toBe(false);
    first.resume();
    expect(first.step()).toBe(start);
    expect(first.respond(reply)).toBe(true);
    expect(first.respond(reply)).toBe(false);
    expect(first.lastCommitted().shaft).toBeUndefined();
    first.cancel();
    expect(first.step()).toBeUndefined();
    expect(first.reset(2)).toBe(true);
    const reset = first.step();
    expect(reset).toMatchObject({ kind: 'shaft-start', generation: 2 });
    expect(first.respond(reply)).toBe(false);
    expect(second.respond(replyFor(other, initial))).toBe(true);
  } finally {
    first.dispose();
    second.dispose();
  }
});

it.runIf(Boolean(output))(
  'drives a real TT shaft and real stop with Arduino through 10 seconds',
  async () => {
    demand(
      output && root && sourcePin && /^[0-9a-f]{64}$/i.test(sourcePin),
      'EXPLICIT_NATIVE_ADMISSION_REQUIRED',
    );
    const actualSource = sha(readFileSync(fileURLToPath(import.meta.url)));
    demand(sourcePin.toLowerCase() === actualSource, 'EXACT_NATIVE_SOURCE_SHA256');
    const profile = exactInputs();
    const fd = receiptHandle(output);
    const record = receiptWriter(fd);
    let passed = false;
    try {
      record({
        type: 'start',
        scope: fixture.scope,
        fixtureSha256,
        source: actualSource,
        engine: fixture.engine,
        unoReference: fixture.unoReference.receiptSha256,
        fixtures: fixture.id,
        limits: fixture.limits,
        intervalColumns,
        electricalColumns,
        contactColumns,
      });
      const engine = await loadNative(root);
      const traces = [];
      for (let repeat = 0; repeat < fixture.limits.repeats; repeat++) {
        const free = runCase(engine, 'free', repeat, record, profile);
        const stop = runCase(engine, 'stop', repeat, record, profile);
        const speedDifference =
          free.speedIntegral / free.elapsedDriveS - stop.speedIntegral / stop.elapsedDriveS;
        const currentDifference =
          stop.currentIntegral / stop.elapsedDriveS - free.currentIntegral / free.elapsedDriveS;
        record({
          type: 'pair',
          repeat,
          speedDifference,
          currentDifference,
          coastRadian: free.coastAngle,
          freeFlybackA: free.maxFlybackA,
          stopFlybackA: stop.maxFlybackA,
          stopImpulseNs: stop.stopImpulseNs,
        });
        demand(
          free.stopImpulseNs === 0 &&
            stop.stopImpulseNs >= fixture.witness.minimumStopContactImpulseNs &&
            stop.firstContactUs !== null &&
            stop.firstContactUs < fixture.windows.drivenFromUs,
          'GENUINE_CONTACT_AND_FREE_CONTROL',
        );
        demand(
          speedDifference >= fixture.witness.minimumDrivenMeanSpeedDifferenceRadPerSecond &&
            currentDifference >= fixture.witness.minimumDrivenMeanCurrentDifferenceA,
          'LOADED_SLOWDOWN_AND_CURRENT_RISE',
        );
        demand(
          finite(free.coastAngle ?? undefined, 'FREE_COAST') >=
            fixture.witness.minimumFreeCoastAngleRadian &&
            free.maxFlybackA >= fixture.witness.minimumFlybackCurrentAmp &&
            stop.maxFlybackA >= fixture.witness.minimumFlybackCurrentAmp,
          'MEASURED_FREE_COAST_AND_PHYSICAL_FLYBACK',
        );
        traces.push({ free, stop });
      }
      expect(traces[0]).toEqual(traces[1]);
      passed = true;
    } catch (error) {
      record({ type: 'first-error', message: String(error).slice(0, 8000) });
      throw error;
    } finally {
      try {
        record({ type: 'finish', status: passed ? 'PASS' : 'FAIL' });
      } finally {
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
    }
  },
  fixture.limits.wallMs,
);

it('observes energized winding, real flyback and finite KCL from the shared solver before native', () => {
  exactInputs();
  const time = fixture.unoReference.gpio[4]?.atMicroseconds;
  demand(time !== undefined, 'PREREGISTERED_FIRST_PWM_GAP');
  const session = createElectronicsTtNativeDriveTestSession(circuit(), {
    componentId: motorId,
    port,
    runId: 'pure-common-MNA',
    generation: 1,
    requestedHorizonMicroseconds: time,
    maxEvents: 1024,
  });
  let acceptedPeak = 0;
  let flybackPeak = 0;
  let complete = false;
  try {
    for (let count = 0; count < 5000; count++) {
      const step = session.step();
      demand(step, 'PRE_NATIVE_SOLVER_CLOSED');
      if (step.kind === 'fault') throw new Error('PRE_NATIVE_SOLVER_FAULT ' + JSON.stringify(step));
      if (step.kind === 'complete') {
        complete = true;
        expect(step.observation.quality.passed).toBe(true);
        expect(step.committedHorizonMicroseconds).toBe(time);
        break;
      }
      if (step.kind === 'working') continue;
      demand(
        step.kind === 'shaft-start' || step.kind === 'shaft-interval',
        'PRE_NATIVE_UNEXPECTED_STEP',
      );
      if (step.kind === 'shaft-interval') {
        const logical = expectedGpioAt(step.fromMicroseconds);
        const actual = readCircuit(
          step.components,
          finite(logical, 'PURE_D5'),
          step.quality.kclToleranceAmp,
        );
        if (logical === 5) acceptedPeak = Math.max(acceptedPeak, actual.sourceA);
        if (logical === 0 && step.fromMicroseconds >= 1_450_009) {
          flybackPeak = Math.max(flybackPeak, actual.diodeA);
          if (actual.diodeA >= fixture.witness.minimumFlybackCurrentAmp) {
            expect(actual.windingV).toBeLessThan(0);
            expect(Math.abs(actual.sourceA)).toBeLessThanOrEqual(
              fixture.limits.terminalReadTolerance,
            );
          }
        }
      }
      // Prescribed stationary witness for electronics-only API validation.
      expect(
        session.respond(
          replyFor(step, {
            measuredAtMicroseconds: step.toMicroseconds,
            angleRadian: 0,
            angularVelocityRadPerSecond: 0,
          }),
        ),
      ).toBe(true);
    }
  } finally {
    session.dispose();
  }
  expect(complete).toBe(true);
  expect(acceptedPeak).toBeGreaterThan(0);
  expect(flybackPeak).toBeGreaterThan(fixture.witness.minimumFlybackCurrentAmp);
}, 30000);
