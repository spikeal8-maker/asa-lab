import type { MainModule, MjData } from '@mujoco/mujoco';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import {
  canonicalEqual,
  captureGeometry,
  contactWorldForce,
  cross,
  frameError,
  quaternionMatrix,
  rotate,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import {
  readFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/mujoco-phy01.mjs';
import fixture from './mujoco-can-impact.fixture.json';

type ImpactCase = (typeof fixture.cases)[number];
type Geometry = ReturnType<typeof captureGeometry>;
const receiptPath = process.env['ASA_ROBOTICS_CAN_IMPACT_OUTPUT'];
const expectedSource = process.env['ASA_ROBOTICS_CAN_IMPACT_SOURCE_SHA256'];
const fixtureUrl = new URL('./mujoco-can-impact.fixture.json', import.meta.url);
const fixtureSha256 = 'a9e964b27a22012ac6309e3843511154455c71d83d6fc828d0789026af11d899';
const { can, striker, terrain, contact, time, witness, limits } = fixture;
const stepSeconds = time.stepUs / 1e6;
const pulseSeconds = striker.pulseUs / 1e6;
const stepsPerWorld = time.horizonUs / time.stepUs;
const launchUntilUs = time.settleUs + striker.pulseUs;
const ground = 0,
  canGeom = 1,
  bumper = 2,
  sliderDof = 6;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const barrierJ =
  can.massKg * terrain.gravityMps2 * (Math.hypot(can.radiusM, can.halfHeightM) - can.halfHeightM);
const criticalTiltRad = Math.atan2(can.radiusM, can.halfHeightM);
const landingDropM = (can.halfHeightM - can.radiusM) * witness.dropFraction;

function demand(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

function sha(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function launch(scenario: ImpactCase) {
  const targetEnergyJ = scenario.launchEnergyToBarrier * barrierJ;
  const speedMps = Math.sqrt((2 * targetEnergyJ) / striker.massKg);
  const impulseNs = striker.massKg * speedMps;
  return {
    targetEnergyJ,
    speedMps,
    impulseNs,
    forceN: impulseNs / pulseSeconds,
    upperPulseDisplacementM: (speedMps * (pulseSeconds + stepSeconds)) / 2,
  };
}

function makeXml() {
  const pair = (first: string, second: string, mu: number) =>
    `<pair geom1="${first}" geom2="${second}" condim="3" margin="0" gap="0" friction="${mu} ${mu} 0 0 0" solref="${contact.solref.join(' ')}" solreffriction="0 0" solimp="${contact.solimp.join(' ')}"/>`;
  const startX = -can.radiusM - striker.radiusM - striker.initialGapM;
  const strikerInertia = 0.4 * striker.massKg * striker.radiusM ** 2;
  return `<mujoco model="asa_can_impact">
    <compiler angle="radian" inertiafromgeom="false" autolimits="false" alignfree="false"/>
    <option timestep="${stepSeconds}" gravity="0 0 -${terrain.gravityMps2}" integrator="implicitfast" solver="Newton" jacobian="dense" cone="elliptic" iterations="100" tolerance="1e-10" ls_iterations="50" ls_tolerance="0.01" noslip_iterations="20" noslip_tolerance="1e-12" impratio="1" ccd_iterations="100" ccd_tolerance="1e-8">
      <flag warmstart="enable" island="enable" refsafe="enable" nativeccd="enable" multiccd="enable" diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable" invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/>
    </option>
    <default><joint damping="0" frictionloss="0" armature="0" stiffness="0" limited="false"/><geom contype="0" conaffinity="0"/></default>
    <worldbody>
      <geom name="ground" type="plane" size="${terrain.interiorHalfWidthM} ${terrain.interiorHalfDepthM} 0.025"/>
      <body name="can" pos="0 0 ${can.halfHeightM + can.initialGapM}">
        <freejoint name="can_free"/><inertial pos="0 0 0" mass="${can.massKg}" diaginertia="${can.inertiaKgM2.join(' ')}"/>
        <geom name="can_geom" type="cylinder" size="${can.radiusM} ${can.halfHeightM}"/>
      </body>
      <body name="striker" pos="${startX} 0 ${striker.axisZM}">
        <joint name="striker_slide" type="slide" axis="1 0 0"/><inertial pos="0 0 0" mass="${striker.massKg}" diaginertia="${[strikerInertia, strikerInertia, strikerInertia].join(' ')}"/>
        <geom name="striker_geom" type="sphere" size="${striker.radiusM}"/>
      </body>
    </worldbody>
    <contact>${pair('ground', 'can_geom', contact.groundFriction)}${pair('striker_geom', 'can_geom', contact.bumperFriction)}</contact>
  </mujoco>`;
}

function state(data: MjData) {
  const value = {
    qpos: Array.from<number>(data.qpos),
    qvel: Array.from<number>(data.qvel),
    time: data.time,
  };
  demand(
    value.qpos.length === 8 &&
      value.qvel.length === 7 &&
      [...value.qpos, ...value.qvel, value.time].every(Number.isFinite),
    'FINITE_NATIVE_STATE',
  );
  return value;
}

function motion(value: ReturnType<typeof state>) {
  const center = value.qpos.slice(0, 3);
  const quaternion = value.qpos.slice(3, 7);
  demand(Math.abs(Math.hypot(...quaternion) - 1) <= 1e-12, 'CAN_UNIT_QUATERNION');
  const axis: number[] = rotate(quaternionMatrix(quaternion), [0, 0, 1]);
  const tilt = Math.acos(Math.max(-1, Math.min(1, axis[2])));
  const speed = Math.hypot(...value.qvel.slice(0, 3));
  const angularSpeed = Math.hypot(...value.qvel.slice(3, 6));
  const energyJ = {
    canPotentialRelativeJ: can.massKg * terrain.gravityMps2 * (center[2] - can.halfHeightM),
    canLinearJ: 0.5 * can.massKg * speed ** 2,
    canAngularJ: can.inertiaKgM2.reduce(
      (sum, inertia, i) => sum + 0.5 * inertia * value.qvel[3 + i] ** 2,
      0,
    ),
    strikerJ: 0.5 * striker.massKg * value.qvel[sliderDof] ** 2,
  };
  return { center, axis, tilt, speed, angularSpeed, energyJ };
}

function openReceipt(path: string) {
  demand(isAbsolute(path) && resolve(path) === path, 'CANONICAL_OUTPUT_PATH');
  const directory = realpathSync(dirname(path));
  const within = (parent: string) => {
    const suffix = relative(parent, directory);
    return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep);
  };
  const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  demand(
    directory === dirname(path) && within(realpathSync(tmpdir())) && !within(repo),
    'EXTERNAL_TEMP_PATH',
  );
  return openSync(path, 'wx');
}

interface ContactForce {
  geom: number[];
  index: number;
  position: number[];
  frame: number[];
  distanceM: number;
  nativeForce: number[];
  forceOnCan: number[];
}

function observeForces(
  M: MainModule,
  model: InstanceType<MainModule['MjModel']>,
  data: MjData,
  pre: Geometry,
  force: InstanceType<MainModule['DoubleBuffer']>,
  counter: { forces: number },
): ContactForce[] {
  return pre.contacts.map(
    (row: {
      geom: number[];
      index: number;
      pos: number[];
      frame: number[];
      dist: number;
      exclude: number;
      efc_address: number;
    }) => {
      demand(
        row.geom.includes(canGeom) &&
          row.exclude === 0 &&
          row.efc_address >= 0 &&
          frameError(row.frame) <= witness.contactFrameTolerance &&
          pre.efcId.slice(row.efc_address, row.efc_address + 3).length === 3 &&
          pre.efcId
            .slice(row.efc_address, row.efc_address + 3)
            .every((id: number) => id === row.index),
        'NATIVE_ACTIVE_CONTACT_IDENTITY',
      );
      M.mj_contactForce(model, data, row.index, force);
      counter.forces += 1;
      const nativeForce = Array.from<number>(force.GetView());
      demand(
        nativeForce.length === 6 && nativeForce.every(Number.isFinite) && nativeForce[0] >= 0,
        'NATIVE_SOLVED_CONTACT_FORCE',
      );
      const sign = row.geom[1] === canGeom ? 1 : -1;
      const forceOnCan: number[] = contactWorldForce(row.frame, nativeForce).map(
        (component: number) => sign * component,
      );
      return {
        geom: row.geom,
        index: row.index,
        position: row.pos,
        frame: row.frame,
        distanceM: row.dist,
        nativeForce,
        forceOnCan,
      };
    },
  );
}

interface WorldReceipt {
  id: string;
  counters: { step1: number; step2: number; forces: number; nativeSteps: number };
  freed: number;
  records: unknown[];
}

function runWorld(M: MainModule, scenario: ImpactCase, raw: WorldReceipt, xml: string) {
  const drive = launch(scenario);
  const model = M.MjModel.from_xml_string(xml);
  let data: MjData | undefined;
  let forceBuffer: InstanceType<MainModule['DoubleBuffer']> | undefined;
  try {
    const readback = {
      dimensions: [model.nq, model.nv, model.ngeom, model.nbody, model.npair, model.nu],
      flags: [model.opt.disableflags, model.opt.enableflags],
      dt: model.opt.timestep,
      gravity: Array.from(model.opt.gravity),
      geomTypes: Array.from(model.geom_type),
      bodyMass: Array.from(model.body_mass),
      bodyInertia: Array.from(model.body_inertia),
      joints: Array.from(model.jnt_type),
      jointAxes: Array.from(model.jnt_axis),
      dofs: Array.from(model.jnt_dofadr),
      pairs: Array.from<number>(model.pair_geom1).map((id, i) =>
        [id, model.pair_geom2[i]].sort((a, b) => a - b),
      ),
      condim: Array.from(model.pair_dim),
      pairFriction: Array.from(model.pair_friction),
    };
    raw.records.push({ readback, drive, barrierJ, criticalTiltRad, landingDropM });
    demand(
      canonicalEqual(readback.dimensions, [8, 7, 3, 3, 2, 0]) &&
        canonicalEqual(readback.flags, [fixture.engine.disableFlags, fixture.engine.enableFlags]) &&
        Object.is(readback.dt, stepSeconds) &&
        canonicalEqual(readback.gravity, [0, 0, -terrain.gravityMps2]) &&
        canonicalEqual(readback.geomTypes, [0, 5, 2]) &&
        canonicalEqual(readback.bodyMass, [0, can.massKg, striker.massKg]) &&
        canonicalEqual(readback.bodyInertia.slice(3, 6), can.inertiaKgM2) &&
        canonicalEqual(readback.joints, [0, 2]) &&
        canonicalEqual(readback.jointAxes.slice(-3), [1, 0, 0]) &&
        canonicalEqual(readback.dofs, [0, sliderDof]) &&
        canonicalEqual(readback.pairs, [
          [ground, canGeom],
          [canGeom, bumper],
        ]) &&
        canonicalEqual(readback.condim, [3, 3]) &&
        canonicalEqual(readback.pairFriction, [
          contact.groundFriction,
          contact.groundFriction,
          0,
          0,
          0,
          contact.bumperFriction,
          contact.bumperFriction,
          0,
          0,
          0,
        ]),
      'MODEL_READBACK',
    );
    data = new M.MjData(model);
    forceBuffer = new M.DoubleBuffer(6);
    const factory = state(data);
    demand(
      factory.qvel.every((component) => component === 0) &&
        factory.time === 0 &&
        canonicalEqual(factory.qpos, [0, 0, can.halfHeightM + can.initialGapM, 1, 0, 0, 0, 0]),
      'INITIAL_NATIVE_FACTORY_STATE',
    );
    const maxContacts = limits.settleCanFloorContacts + limits.bumperCanContacts;
    const geometryLimits = {
      nbody: model.nbody,
      ngeom: model.ngeom,
      maxContacts,
      maxConstraintRows: 3 * maxContacts,
      maxIslands: model.ntree,
      pairCaps: [
        { geom: [ground, canGeom], maxContacts: limits.settleCanFloorContacts },
        { geom: [canGeom, bumper], maxContacts: limits.bumperCanContacts },
      ],
      warningCount: 7,
      maxWarningObservations: 2 * stepsPerWorld,
      maxWarningGets: 14 * stepsPerWorld,
      maxContactVectors: 2 * stepsPerWorld,
      maxContactGets: 2 * maxContacts * stepsPerWorld,
    };
    const resources = { temporaryCreated: 0, temporaryDeleted: 0 };
    let settledSamples = 0,
      lowUprightSamples = 0,
      sideUs = 0,
      bumperNormalNs = 0,
      bumperForwardNs = 0,
      bumperTipAngularNms = 0,
      workJ = 0,
      displacementWorkJ = 0,
      peakTiltRad = 0;
    let firstImpact: { timeUs: number; contactHeightM: number } | null = null;
    let firstCrossUs: number | null = null;
    let crossAngularImpulseNms: number | null = null;
    let firstSideUs: number | null = null;
    let launched = false;
    let settleOk = true,
      lowFinalOk = true,
      driveClear = true;
    for (let i = 0; i < stepsPerWorld; i += 1) {
      const startUs = i * time.stepUs;
      const endUs = startUs + time.stepUs;
      const forceN = startUs >= time.settleUs && startUs < launchUntilUs ? drive.forceN : 0;
      const applied = data.qfrc_applied;
      demand(
        applied.length === 7 &&
          Array.from<number>(applied)
            .slice(0, sliderDof)
            .every((value) => value === 0),
        'ONLY_STRIKER_FORCE',
      );
      applied[sliderDof] = forceN;
      const before = state(data);
      raw.counters.step1 += 1;
      M.mj_step1(model, data);
      demand(canonicalEqual(before, state(data)), 'STEP1_MUTATED_PRE');
      const pre = captureGeometry(data, resources, geometryLimits);
      demand(
        pre.nefc === 3 * pre.ncon && !pre.warnings.flat().some((value: number) => value !== 0),
        'PRE_NATIVE_GEOMETRY',
      );
      if (forceN !== 0 && pre.contacts.some((c: { geom: number[] }) => c.geom.includes(bumper)))
        driveClear = false;
      raw.counters.step2 += 1;
      M.mj_step2(model, data);
      raw.counters.nativeSteps += 1;
      const after = state(data);
      demand(Math.abs(after.time - endUs / 1e6) <= 1e-9, 'NATIVE_INTEGRATED_TIME');
      const solved = captureGeometry(data, resources, geometryLimits);
      demand(
        canonicalEqual(pre.contacts, solved.contacts) &&
          solved.nefc === pre.nefc &&
          canonicalEqual(pre.efcId, solved.efcId) &&
          !solved.warnings.flat().some((value: number) => value !== 0) &&
          resources.temporaryCreated === resources.temporaryDeleted,
        'SOLVED_PRE_IDENTITY_OR_WRAPPERS',
      );
      const forces = observeForces(M, model, data, pre, forceBuffer, raw.counters);
      const current = motion(after);
      const floorLoaded = forces.some((row) => row.geom.includes(ground) && row.nativeForce[0] > 0);
      const impacts = forces.filter((row) => row.geom.includes(bumper) && row.nativeForce[0] > 0);
      for (const hit of impacts) {
        firstImpact ??= { timeUs: startUs, contactHeightM: hit.position[2] };
        const lever = hit.position.map((value, index) => value - before.qpos[index]);
        bumperNormalNs += hit.nativeForce[0] * stepSeconds;
        bumperForwardNs += hit.forceOnCan[0] * stepSeconds;
        bumperTipAngularNms += cross(lever, hit.forceOnCan)[1] * stepSeconds;
      }
      workJ += 0.5 * forceN * (before.qvel[sliderDof] + after.qvel[sliderDof]) * stepSeconds;
      displacementWorkJ += forceN * (after.qpos[7] - before.qpos[7]);
      if (endUs === launchUntilUs)
        launched =
          Math.abs(current.energyJ.strikerJ - drive.targetEnergyJ) <=
            witness.launchEnergyRelativeTolerance * drive.targetEnergyJ &&
          Math.abs(workJ - current.energyJ.strikerJ) <=
            witness.launchEnergyRelativeTolerance * drive.targetEnergyJ;
      peakTiltRad = Math.max(peakTiltRad, current.tilt);
      if (firstCrossUs === null && current.tilt >= criticalTiltRad) {
        firstCrossUs = endUs;
        crossAngularImpulseNms = bumperTipAngularNms;
      }
      const upright =
        floorLoaded &&
        current.tilt <= radians(witness.uprightToleranceDegrees) &&
        Math.abs(current.center[2] - can.halfHeightM) <= witness.settledCenterErrorM &&
        current.speed <= witness.settledSpeedMps &&
        current.angularSpeed <= witness.settledAngularSpeedRadPS;
      if (endUs > time.settleUs - time.settleWitnessUs && endUs <= time.settleUs) {
        settledSamples += 1;
        settleOk &&=
          upright && impacts.length === 0 && after.qpos[7] === 0 && after.qvel[sliderDof] === 0;
      }
      if (endUs > time.horizonUs - time.landingWitnessUs) {
        lowUprightSamples += 1;
        lowFinalOk &&= upright && impacts.length === 0;
      }
      const interior =
        Math.abs(current.center[0]) + can.halfHeightM + can.radiusM < terrain.interiorHalfWidthM &&
        Math.abs(current.center[1]) + can.halfHeightM + can.radiusM < terrain.interiorHalfDepthM;
      const side =
        firstImpact !== null &&
        firstCrossUs !== null &&
        firstCrossUs > firstImpact.timeUs &&
        floorLoaded &&
        impacts.length === 0 &&
        interior &&
        Math.abs(current.axis[2]) <= Math.sin(radians(witness.sideToleranceDegrees)) &&
        can.halfHeightM - current.center[2] >= landingDropM;
      sideUs = side ? sideUs + time.stepUs : 0;
      if (sideUs >= time.landingWitnessUs) firstSideUs ??= endUs;
      raw.records.push({
        startUs,
        endUs,
        forceN,
        pre: before,
        post: after,
        forces,
        current,
        floorLoaded,
        side,
        workJ,
        displacementWorkJ,
        bumperNormalNs,
        bumperForwardNs,
        bumperTipAngularNms,
      });
    }
    const actualHighContact =
      firstImpact !== null &&
      firstImpact.timeUs >= launchUntilUs &&
      firstImpact.contactHeightM >= striker.axisZM - striker.radiusM;
    const causal =
      actualHighContact && bumperNormalNs > 0 && bumperForwardNs > 0 && bumperTipAngularNms > 0;
    const initialValid =
      settleOk &&
      settledSamples === time.settleWitnessUs / time.stepUs &&
      driveClear &&
      launched &&
      Number.isFinite(workJ) &&
      workJ > 0;
    const outcome =
      scenario.expected === 'upright'
        ? lowFinalOk &&
          lowUprightSamples === time.landingWitnessUs / time.stepUs &&
          peakTiltRad < criticalTiltRad &&
          firstSideUs === null
        : firstImpact !== null &&
          firstCrossUs !== null &&
          firstCrossUs > firstImpact.timeUs &&
          crossAngularImpulseNms !== null &&
          crossAngularImpulseNms > 0 &&
          firstSideUs !== null &&
          firstSideUs > firstCrossUs;
    const verdict = {
      id: scenario.id,
      initialValid,
      causal,
      outcome,
      firstImpact,
      firstCrossUs,
      crossAngularImpulseNms,
      firstSideUs,
      peakTiltRad,
      workJ,
      displacementWorkJ,
      bumperNormalNs,
      bumperForwardNs,
      bumperTipAngularNms,
      resources,
      accepted: initialValid && causal && outcome,
    };
    raw.records.push({ verdict });
    return verdict;
  } finally {
    try {
      if (forceBuffer) {
        forceBuffer.delete();
        raw.freed += 1;
      }
    } finally {
      try {
        if (data) {
          data.delete();
          raw.freed += 1;
        }
      } finally {
        model.delete();
        raw.freed += 1;
      }
    }
  }
}

it('registers a bounded contact-driven low/high launch and real gravity settle', () => {
  expect(sha(readFileSync(fixtureUrl))).toBe(fixtureSha256);
  expect(fixture.scope).toBe('TEST_ONLY');
  expect(fixture.cases).toHaveLength(limits.worlds);
  expect(stepsPerWorld * limits.worlds).toBe(limits.stepsTotal);
  for (const duration of [
    time.settleUs,
    time.settleWitnessUs,
    time.landingWitnessUs,
    time.horizonUs,
    striker.pulseUs,
  ])
    expect(duration % time.stepUs).toBe(0);
  expect(barrierJ).toBeGreaterThan(0);
  expect(landingDropM).toBeGreaterThan(0);
  expect(launch(fixture.cases[0]).targetEnergyJ).toBeLessThan(barrierJ);
  expect(launch(fixture.cases[1]).targetEnergyJ).toBeGreaterThan(barrierJ);
  for (const scenario of fixture.cases)
    expect(launch(scenario).upperPulseDisplacementM).toBeLessThan(striker.initialGapM);
  expect(makeXml().match(/<pair /g)).toHaveLength(2);
  expect(makeXml()).toContain('nativeccd="enable" multiccd="enable"');
});

it.runIf(Boolean(receiptPath))(
  'tests real low/high can impacts under one pinned native CCD profile',
  async () => {
    const sourceSha256 = sha(readFileSync(new URL(import.meta.url)));
    demand(
      expectedSource?.toLowerCase() === sourceSha256 &&
        sha(readFileSync(fixtureUrl)) === fixtureSha256,
      'EXACT_SOURCE_ADMISSION',
    );
    const fd = openReceipt(receiptPath!);
    const xml = makeXml();
    const receipt = {
      sourceSha256,
      fixtureSha256,
      fixture,
      xml,
      xmlSha256: sha(xml),
      runtime: '',
      worlds: [] as WorldReceipt[],
      verdicts: [] as ReturnType<typeof runWorld>[],
      error: null as string | null,
    };
    try {
      const { packageRoot, ...artifact } = verifyEngineArtifacts(readFixture().fixture);
      demand(artifact.wasmSha256 === fixture.engine.wasmSha256, 'ENGINE_ARTIFACT');
      const { default: init } = await import(pathToFileURL(resolve(packageRoot, 'mujoco.js')).href);
      const M: MainModule = await init({
        wasmBinary: readFileSync(resolve(packageRoot, 'mujoco.wasm')),
        locateFile: (name: string) => {
          demand(name === 'mujoco.wasm', 'ENGINE_RESOURCE');
          return resolve(packageRoot, name);
        },
      });
      receipt.runtime = M.mj_versionString();
      demand(receipt.runtime === fixture.engine.version, 'ENGINE_RUNTIME');
      for (const scenario of fixture.cases) {
        demand(receipt.worlds.length < limits.worlds, 'MODEL_BUDGET');
        const raw: WorldReceipt = {
          id: scenario.id,
          counters: { step1: 0, step2: 0, forces: 0, nativeSteps: 0 },
          freed: 0,
          records: [],
        };
        receipt.worlds.push(raw);
        receipt.verdicts.push(runWorld(M, scenario, raw, xml));
      }
    } catch (error) {
      receipt.error = String(error);
    } finally {
      try {
        const json = JSON.stringify(receipt, (_key, value) =>
          typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
            ? Object.is(value, -0)
              ? '-0'
              : String(value)
            : value,
        );
        const bytes = Buffer.from(json + '\n');
        demand(bytes.length <= limits.maxReceiptBytes, 'RAW_RECEIPT_BUDGET');
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    expect(receipt.error).toBeNull();
    expect(receipt.worlds).toHaveLength(limits.worlds);
    expect(receipt.worlds.reduce((sum, w) => sum + w.counters.nativeSteps, 0)).toBe(
      limits.stepsTotal,
    );
    for (const world of receipt.worlds) {
      expect(world.freed).toBe(3);
      expect(world.counters.step1).toBe(stepsPerWorld);
      expect(world.counters.step2).toBe(stepsPerWorld);
    }
    expect(receipt.verdicts.map(({ id, accepted }) => ({ id, accepted }))).toEqual(
      fixture.cases.map(({ id }) => ({ id, accepted: true })),
    );
  },
  120_000,
);
