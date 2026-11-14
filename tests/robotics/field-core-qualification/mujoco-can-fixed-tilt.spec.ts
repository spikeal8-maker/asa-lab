import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { MainModule, MjData, MjModel, DoubleBuffer } from '@mujoco/mujoco';
import { describe, expect, it } from 'vitest';
import {
  readCylinderFixture,
  readModel,
  verifyCylinderArtifacts,
} from '../../../tools/robotics-field-core/mujoco-cylinder.mjs';
import {
  assessContacts,
  assessWindow,
  bodyEndpoint,
  canonicalEqual,
  captureForces,
  captureForward,
  copyState,
  copyWarnings,
  demand,
  finite,
  floorFrame,
  phaseState,
  tiltState,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import { nativeTimeBudget, sha256 } from '../../../tools/robotics-field-core/mujoco-phy01.mjs';
import fixture from './mujoco-can-fixed-tilt.fixture.json';

const fixtureSha256 = 'accbcc23dea77616a5c3900fd7269a0c9928e15a803fb48803a5642d75523cda';
const rootUrl = new URL('../../../', import.meta.url);
const fixtureUrl = new URL('./mujoco-can-fixed-tilt.fixture.json', import.meta.url);
const inherited = readCylinderFixture().fixture;
const can = inherited.bodies.cylinder;
const floor = inherited.bodies.floor;
const substep = fixture.nativeStepUs;
const stepsPerWorld = fixture.durationUs / substep;
const windowSize = inherited.tilt.stationaryWindowUs / substep;
const angle = (degrees: number) => (degrees * Math.PI) / 180;
const floorGeom = 0;
const canGeom = 1;
const canBody = 1;
const shape = {
  name: 'cylinder',
  kind: 'cylinder',
  bodyId: canBody,
  geomId: canGeom,
  qposAdr: 0,
  dofAdr: 0,
  mass: can.massKg,
  radius: can.radiusM,
  height: can.heightM,
};
const ids = {
  bodyIds: [0, canBody],
  geomBodies: [0, canBody],
  floorGeom,
  freeBodies: [shape],
};
const limits = {
  maxContacts: inherited.resources.scenarios.tilt.maxContacts,
  maxConstraintRows: inherited.resources.scenarios.tilt.maxConstraintRows,
  maxIslands: inherited.resources.maxIslands,
  pairCaps: [
    { geom: [floorGeom, canGeom], maxContacts: inherited.contact.cylinderNativeContactCap },
  ],
  maxContactVectors: stepsPerWorld * 2,
  maxContactGets: stepsPerWorld * 2 * inherited.contact.cylinderNativeContactCap,
};
type Case = (typeof fixture.cases)[number];
type Tilt = ReturnType<typeof tiltState>;
interface NativeState {
  time: number;
  qpos: number[];
  qvel: number[];
  qacc: number[];
  qacc_warmstart: number[];
}
interface ContactSupport {
  loaded: number;
  outwardForce: number;
  maxSlip: number;
  supported: boolean;
  downhillRim: boolean;
}
interface ObservedInterval {
  tick: number;
  pre: Tilt;
  post: Tilt;
  loaded: boolean;
  positiveSupport: boolean;
  supported: boolean;
  downhillRim: boolean;
  noSlip: boolean;
}
type Append = (record: Record<string, unknown>) => void;

function verifySource() {
  expect(sha256(readFileSync(fixtureUrl))).toBe(fixtureSha256);
  for (const [path, digest] of Object.entries(fixture.inputsSha256)) {
    expect(sha256(readFileSync(new URL(path, rootUrl))), path).toBe(digest);
  }
  expect(inherited.candidateProfile.id).toBe(fixture.engine.contactProfile);
  expect(fixture.cases).toHaveLength(fixture.maxWorlds);
  expect(stepsPerWorld * fixture.maxWorlds).toBe(fixture.maxNativeSteps);
  expect(windowSize * substep).toBe(inherited.tilt.stationaryWindowUs);
  return verifyCylinderArtifacts(inherited);
}

function initialGeometry(degrees: number) {
  const theta = angle(degrees);
  const direction: number[] = floorFrame(theta).normal;
  const rotation = [Math.cos(theta / 2), 0, Math.sin(theta / 2), 0];
  const floorPosition = direction.map((component) => floor.fixedCenterZ * component);
  const center = direction.map(
    (component) => (can.heightM / 2 + inherited.initialGapM) * component,
  );
  return { theta, rotation, floorPosition, center };
}

function xmlFor({ angleDegrees }: Case) {
  const { rotation, floorPosition, center } = initialGeometry(angleDegrees);
  const s = inherited.solver;
  const c = inherited.contact;
  return `<mujoco model="asa_fixed_can">
  <compiler angle="radian" inertiafromgeom="false" autolimits="false"/>
  <option timestep="${substep / 1e6}" gravity="${inherited.gravity.join(' ')}"
    integrator="${s.integrator}" solver="${s.solver}" jacobian="${s.jacobian}" cone="${s.cone}"
    iterations="${s.iterations}" tolerance="${s.tolerance}" ls_iterations="${s.lsIterations}"
    ls_tolerance="${s.lsTolerance}" noslip_iterations="${s.noSlipIterations}"
    noslip_tolerance="${s.noSlipTolerance}" impratio="${s.impratio}"
    ccd_iterations="${s.ccdIterations}" ccd_tolerance="${s.ccdTolerance}" density="0" viscosity="0" wind="0 0 0">
    <flag warmstart="enable" island="enable" refsafe="enable" nativeccd="disable" multiccd="enable"
      diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable"
      invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/>
  </option>
  <default><geom condim="3" friction="${c.geomFriction.join(' ')}" margin="0" gap="0"
    solref="${c.solref.join(' ')}" solimp="${c.solimp.join(' ')}"/></default>
  <worldbody>
    <geom name="floor" type="box" size="${floor.halfExtentsM.join(' ')}"
      pos="${floorPosition.join(' ')}" quat="${rotation.join(' ')}"/>
    <body name="cylinder" pos="${center.join(' ')}" quat="${rotation.join(' ')}">
      <freejoint name="cylinder_free"/>
      <inertial pos="0 0 0" mass="${can.massKg}" diaginertia="${can.inertiaKgM2.join(' ')}"/>
      <geom name="cylinder_geom" type="cylinder" size="${can.radiusM} ${can.heightM / 2}"/>
    </body>
  </worldbody>
  <contact><pair geom1="floor" geom2="cylinder_geom" condim="3"
    friction="${c.pairFriction.join(' ')}" solref="${c.solref.join(' ')}"
    solreffriction="${c.solreffriction.join(' ')}" solimp="${c.solimp.join(' ')}" margin="0" gap="0"/></contact>
</mujoco>\n`;
}

function verifyModel(model: MjModel, data: MjData, testCase: Case) {
  const readback = readModel(model) as Record<string, unknown>;
  const { rotation, floorPosition, center } = initialGeometry(testCase.angleDegrees);
  const s = inherited.solver;
  const c = inherited.contact;
  const initial = copyState(data) as NativeState;
  expect(finite(readback) && finite(initial)).toBe(true);
  expect(readback).toMatchObject({
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
    geom_type: [6, 5],
    geom_bodyid: [0, canBody],
    jnt_type: [0],
    jnt_qposadr: [0],
    jnt_dofadr: [0],
    body_mass: [0, can.massKg],
    geom_size: [...floor.halfExtentsM, can.radiusM, can.heightM / 2, 0],
    pair_dim: [3],
    pair_friction: c.pairFriction,
    pair_solref: c.solref,
    pair_solreffriction: c.solreffriction,
    pair_solimp: c.solimp,
    pair_gap: [0],
    pair_margin: [0],
    options: {
      timestep: substep / 1e6,
      gravity: inherited.gravity,
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
      disableflags: s.disableFlags,
      enableflags: s.enableFlags,
      density: 0,
      viscosity: 0,
      disableactuator: 0,
    },
  });
  for (const key of [
    'body_ipos',
    'body_gravcomp',
    'dof_damping',
    'dof_frictionloss',
    'dof_armature',
    'geom_margin',
    'geom_gap',
    'geom_adhesion',
    'geom_surfacevel',
    'pair_adhesion',
  ]) {
    expect(
      (readback[key] as number[]).every((value) => value === 0),
      key,
    ).toBe(true);
  }
  const components: [number[], number[]][] = [
    [(readback['body_inertia'] as number[]).slice(3), can.inertiaKgM2],
    [(readback['geom_pos'] as number[]).slice(0, 3), floorPosition],
    [(readback['geom_quat'] as number[]).slice(0, 4), rotation],
    [initial.qpos, [...center, ...rotation]],
  ];
  for (const [observed, expected] of components) {
    expect(observed).toHaveLength(expected.length);
    observed.forEach((value, index) =>
      expect(Math.abs(value - expected[index]!)).toBeLessThanOrEqual(1e-12),
    );
  }
  expect(initial.qvel).toEqual(new Array(6).fill(0));
  expect(initial.time).toBe(0);
  return { readback, initial };
}

function warningFree(warnings: number[][]): boolean {
  return (
    warnings.length === inherited.resources.warningCount &&
    warnings.every(([count, info]) => count === 0 && info === 0)
  );
}

function guardNoExternalForce(data: MjData): void {
  const applied: Float64Array = data.qfrc_applied;
  const external: Float64Array = data.xfrc_applied;
  demand(
    applied.length === 6 &&
      external.length === 12 &&
      applied.every((value) => value === 0) &&
      external.every((value) => value === 0) &&
      data.ctrl.length === 0,
    'FIXED_CAN_UNEXPECTED_FORCE',
  );
}

function runCase(M: MainModule, testCase: Case, append: Append) {
  const { theta } = initialGeometry(testCase.angleDegrees);
  const frame = floorFrame(theta);
  const xml = xmlFor(testCase);
  let model: MjModel | null = null;
  let data: MjData | null = null;
  let buffer: DoubleBuffer | null = null;
  const resources = {
    temporaryCreated: 0,
    temporaryDeleted: 0,
    velocityCalls: 0,
    contactForceCalls: 0,
  };
  const cleanupErrors: string[] = [];
  let advanced = 0;
  let dispatched = 0;
  let tipTick: number | null = null;
  let lastStage = 'initialization';
  let cumulativeSlipM = 0;
  let hadLoad = false;
  const window: ObservedInterval[] = [];
  const a = testCase.angleDegrees;
  try {
    model = M.MjModel.from_xml_string(xml);
    demand(model, 'FIXED_CAN_MODEL_CREATE_EMPTY');
    data = new M.MjData(model);
    buffer = new M.DoubleBuffer(6);
    const { readback, initial } = verifyModel(model, data, testCase);
    demand(warningFree(copyWarnings(data, resources)), 'FIXED_CAN_INITIAL_WARNING');
    guardNoExternalForce(data);
    append({
      kind: 'world-start',
      angleDegrees: a,
      xml,
      xmlSha256: sha256(xml),
      readback,
      initial,
    });
    for (let tick = 1; tick <= stepsPerWorld; tick += 1) {
      lastStage = 'step1';
      const pre = copyState(data);
      M.mj_step1(model, data);
      demand(canonicalEqual(phaseState(pre), phaseState(copyState(data))), 'FIXED_CAN_STEP1_STATE');
      const forward = captureForward(M, model, data, pre, ids, resources, buffer, limits);
      lastStage = 'step2';
      dispatched += 1;
      M.mj_step2(model, data);
      advanced += 1;
      lastStage = 'observe';
      const force = captureForces(M, model, data, forward, resources, buffer, limits);
      const bodies = forward.bodies as Record<number, ReturnType<typeof bodyEndpoint>>;
      const prior = tiltState(bodies[canBody], theta, 0, inherited);
      const post = tiltState(bodyEndpoint(force.endpoint, shape), theta, 0, inherited);
      append({
        kind: 'native-tick',
        angleDegrees: a,
        tick,
        pre,
        post: force.endpoint,
        metrics: { pre: prior, post },
        observation: {
          contacts: force.contacts,
          preBodies: forward.bodies,
          efcVel: forward.efcVel,
          efcType: forward.efcType,
          efcId: forward.efcId,
          efcForce: force.efcForce,
          qfrcConstraint: force.qfrcConstraint,
          warnings: force.warnings,
          islands: force.islands,
        },
      });
      demand(finite({ pre, prior, post, forward, force }), 'FIXED_CAN_NONFINITE_OBSERVATION');
      demand(warningFree(force.warnings), 'FIXED_CAN_NATIVE_WARNING');
      demand(
        force.endpoint.time > pre.time &&
          Math.abs(force.endpoint.time - (tick * substep) / 1e6) <= nativeTimeBudget(tick, substep),
        'FIXED_CAN_NATIVE_CLOCK',
      );
      guardNoExternalForce(data);
      if (tipTick !== null) continue;
      lastStage = 'contact-gate';
      const { bodies: support } = assessContacts(inherited, forward, force, ids, frame);
      const { cylinder: contact } = support as { cylinder: ContactSupport };
      const loaded = contact.loaded > 0;
      hadLoad ||= loaded;
      cumulativeSlipM += contact.maxSlip * (substep / 1e6);
      demand(cumulativeSlipM <= inherited.contact.maxCumulativeSlipM, 'FIXED_CAN_CUMULATIVE_SLIP');
      // Missing load outside the stable/tip windows cannot create a PASS. Once the
      // fixture seats, any loaded unsupported/side contact before confirmation fails.
      demand(
        !loaded || (contact.supported && contact.outwardForce > 0),
        'FIXED_CAN_CONTACT_DOMAIN',
      );
      const interval = {
        tick,
        pre: prior,
        post,
        loaded,
        positiveSupport: contact.outwardForce > 0,
        supported: contact.supported,
        downhillRim: contact.downhillRim,
        noSlip: contact.maxSlip <= inherited.contact.maxLoadedSlipSpeedMps,
      };
      window.push(interval);
      if (window.length > windowSize) window.shift();
      if (assessWindow(window, inherited, substep, theta, 'tip').accepted) {
        tipTick = tick;
        append({ kind: 'confirmed-tip', angleDegrees: a, tick, metrics: post, cumulativeSlipM });
      }
    }
    const stable = assessWindow(window, inherited, substep, theta, 'stable').accepted;
    const passed =
      hadLoad && (testCase.expected === 'stable' ? stable && tipTick === null : tipTick !== null);
    return { angleDegrees: a, passed, stable, tipTick, hadLoad, cumulativeSlipM, advanced };
  } catch (error) {
    append({
      kind: 'world-error',
      angleDegrees: a,
      lastStage,
      advanced,
      dispatched,
      error: String(error),
    });
    throw error;
  } finally {
    for (const owner of [buffer, data, model]) {
      try {
        owner?.delete();
      } catch (error) {
        cleanupErrors.push(String(error));
      }
    }
    append({
      kind: 'world-resources',
      angleDegrees: a,
      advanced,
      dispatched,
      resources,
      cleanupErrors,
    });
    expect(cleanupErrors).toEqual([]);
    expect(resources.temporaryDeleted).toBe(resources.temporaryCreated);
  }
}

describe('MuJoCo fixed-can diagnostic admission (pure)', () => {
  it('verifies the frozen source, installed WASM and exactly two bounded cases without initialization', () => {
    const artifact = verifySource();
    expect(artifact.version).toBe(fixture.engine.version);
    expect(artifact.wasmSha256).toBe(fixture.engine.wasmSha256);
    expect(can).toMatchObject({ heightM: 0.115, radiusM: 0.033, massKg: 0.5 });
    const critical = Math.atan2(can.radiusM, can.heightM / 2);
    expect((critical * 180) / Math.PI).toBeCloseTo(29.85207626918268, 12);
    for (const testCase of fixture.cases) {
      const theta = angle(testCase.angleDegrees);
      expect(Math.tan(theta)).toBeLessThan(inherited.contact.pairFriction[0]);
      expect(theta < critical).toBe(testCase.expected === 'stable');
      expect(xmlFor(testCase)).not.toMatch(/<actuator|<keyframe|<plugin|<sensor/);
    }
  });

  it('rejects lost support, slipping, or a rim witness outside the allowed loaded domain', () => {
    const theta = angle(32);
    const state = (i: number) => ({
      theta,
      omega: 0,
      phi: 0.07,
      beta: 0.06 + i * 0.0001,
      relativeOmega: 0.2,
      relativeOmegaY: 0.2,
      uphillRimLift: 0.002,
      uphillDirectionValid: true,
    });
    const valid = Array.from({ length: windowSize }, (_, i) => ({
      tick: i + 1,
      pre: state(i),
      post: state(i + 1),
      loaded: true,
      positiveSupport: true,
      supported: true,
      downhillRim: true,
      noSlip: true,
    }));
    expect(assessWindow(valid, inherited, substep, theta, 'tip').accepted).toBe(true);
    for (const key of [
      'loaded',
      'positiveSupport',
      'supported',
      'downhillRim',
      'noSlip',
    ] as const) {
      const altered = [...valid];
      altered[10] = { ...altered[10]!, [key]: false };
      expect(assessWindow(altered, inherited, substep, theta, 'tip').accepted, key).toBe(false);
    }
  });
});

const evidenceOutput = process.env['ASA_MUJOCO_CAN_FIXED_TILT_OUT'];
it.runIf(Boolean(evidenceOutput))(
  'MuJoCo fixed-can native paired diagnostic',
  async () => {
    const requested = evidenceOutput!;
    expect(isAbsolute(requested)).toBe(true);
    const directory = realpathSync(dirname(requested));
    const repository = realpathSync(fileURLToPath(rootUrl));
    const relativeDirectory = relative(repository, directory).replaceAll('\\', '/');
    expect(
      isAbsolute(relativeDirectory) ||
        relativeDirectory === '..' ||
        relativeDirectory.startsWith('../'),
    ).toBe(true);
    const artifact = verifySource();
    const fd = openSync(join(directory, basename(requested)), 'wx');
    let bytes = 0;
    const append: Append = (record) => {
      const line =
        JSON.stringify(record, (_key, value: unknown) =>
          typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
            ? { $float64: Object.is(value, -0) ? '-0' : String(value) }
            : value,
        ) + '\n';
      const buffer = Buffer.from(line);
      demand(bytes + buffer.length <= fixture.maxJournalBytes, 'FIXED_CAN_JOURNAL_LIMIT');
      demand(writeSync(fd, buffer) === buffer.length, 'FIXED_CAN_JOURNAL_SHORT_WRITE');
      bytes += buffer.length;
    };
    try {
      append({
        kind: 'invocation-start',
        fixtureSha256,
        sourceSha256: sha256(readFileSync(new URL(import.meta.url))),
        sourceBase: fixture.sourceBase,
        inputHashes: fixture.inputsSha256,
        wasmSha256: artifact.wasmSha256,
        worlds: fixture.maxWorlds,
        maxNativeSteps: fixture.maxNativeSteps,
      });
      const { default: initialize } = await import(
        pathToFileURL(join(artifact.packageRoot, 'mujoco.js')).href
      );
      const M: MainModule = await initialize({
        wasmBinary: readFileSync(join(artifact.packageRoot, 'mujoco.wasm')),
      });
      expect(M.mj_versionString()).toBe(fixture.engine.version);
      expect(M.mj_version()).toBe(4000000);
      const results = fixture.cases.map((testCase) => runCase(M, testCase, append));
      const summary = { results, passed: results.every((result) => result.passed) };
      append({ kind: 'invocation-end', ...summary });
      console.info('FIXED_CAN_EVIDENCE', JSON.stringify(summary));
      expect(summary.passed).toBe(true);
    } finally {
      closeSync(fd);
    }
  },
  90_000,
);
