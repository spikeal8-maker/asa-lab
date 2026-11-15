import type { MainModule, MjData, MjModel } from '@mujoco/mujoco';
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import {
  canonicalEqual,
  captureGeometry,
  contactWorldForce,
  cross,
  dot,
  frameError,
  quaternionMatrix,
  rotate,
} from '../../../tools/robotics-field-core/mujoco-contact-observer.mjs';
import {
  readFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/mujoco-phy01.mjs';
import impact from './mujoco-can-impact.fixture.json';
import fixture from './mujoco-shared-motion.fixture.json';

const fixtureSha = '08a2e75a4fdd72c6cedfcba56be832eda3e67d54065046d693749c30999f70ed';
const fixtureUrl = new URL('./mujoco-shared-motion.fixture.json', import.meta.url);
const rollingDir = process.env['ASA_ROBOTICS_MOTION_ROLLING_DIR'];
const impactPath = process.env['ASA_ROBOTICS_MOTION_IMPACT_RECEIPT'];
const outputPath = process.env['ASA_ROBOTICS_MOTION_OUTPUT'];
const sourcePin = process.env['ASA_ROBOTICS_MOTION_SOURCE_SHA256'];
const { rolling, can, time, limits } = fixture;
const dt = time.stepUs / 1e6;
const slope = (rolling.slopeDeg * Math.PI) / 180;
const rampNormal = [-Math.sin(slope), 0, Math.cos(slope)];
const uphill = [Math.cos(slope), 0, Math.sin(slope)];
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const names = {
  can: 'can_geom',
  bumper: 'striker_geom',
  canFloor: 'ground',
  flat: 'flat',
  ramp: 'ramp',
  wheels: Array.from({ length: 4 }, (_, i) => `wheel_geom_${i}`),
};

function demand(value: unknown, error: string): asserts value {
  if (!value) throw new Error(error);
}

function digest(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pinned(path: string, pin: { bytes: number; sha256: string }) {
  demand(isAbsolute(path) && statSync(path).size === pin.bytes, 'ARCHIVE_PATH_OR_SIZE');
  const bytes = readFileSync(path);
  demand(bytes.length === pin.bytes && digest(bytes) === pin.sha256, 'ARCHIVE_HASH');
  return bytes;
}

function one(xml: string, pattern: string | RegExp, value: string) {
  const replaced = xml.replace(pattern, value);
  demand(replaced !== xml, 'FIXED_XML_BOUNDARY');
  return replaced;
}

function composeXml(rollingXml: string, impactXml: string) {
  const tag = (xml: string, name: string) =>
    xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
  const bodies = tag(impactXml, 'worldbody');
  const pairs = tag(impactXml, 'contact');
  demand(bodies && pairs, 'IMPACT_AUTHORED_XML_SECTIONS');
  let lane = bodies.replaceAll('<geom ', '<geom contype="0" conaffinity="0" ');
  lane = one(
    lane,
    'name="ground" type="plane"',
    `name="ground" type="plane" pos="0 ${can.laneYM} 0"`,
  );
  for (const body of ['can', 'striker']) {
    lane = one(
      lane,
      new RegExp(`name="${body}" pos="([^ ]+) 0 ([^"]+)"`),
      `name="${body}" pos="$1 ${can.laneYM} $2"`,
    );
  }
  return one(
    one(rollingXml, '</worldbody>', lane + '</worldbody>'),
    '</contact>',
    pairs + '</contact>',
  );
}

type OptionSnapshot = Record<string, number | number[]>;
type Launch = { targetEnergyJ: number; forceN: number; upperPulseDisplacementM: number };

function readInputs(rampDirectory: string, canReceipt: string) {
  demand(isAbsolute(rampDirectory), 'ABSOLUTE_ROLLING_DIR');
  const pins = fixture.archives;
  const journal = pinned(resolve(rampDirectory, pins.rollingJournal.file), pins.rollingJournal);
  const index = JSON.parse(
    pinned(resolve(rampDirectory, pins.rollingInit.file), pins.rollingInit).toString('utf8'),
  );
  const summary = JSON.parse(
    pinned(resolve(rampDirectory, pins.rollingSummary.file), pins.rollingSummary).toString('utf8'),
  );
  const reference = JSON.parse(pinned(canReceipt, pins.canReceipt).toString('utf8'));
  demand(
    index.raw.sha256 === pins.rollingJournal.sha256 &&
      summary.rawIdentity.sha256 === pins.rollingJournal.sha256,
    'RAMP_JOURNAL_BINDING',
  );
  const initialization = index.initializations.find(
    ({ frame }: { frame: { ordinal: number } }) => frame.ordinal === rolling.initializationFrame,
  );
  const selected = initialization?.record;
  const archivedRamp = summary.worlds.find(({ id }: { id: string }) => id === rolling.world);
  demand(
    selected?.world === rolling.world &&
      selected.condition.durationUs === time.horizonUs &&
      selected.condition.dtUs === time.stepUs &&
      digest(selected.xml) === rolling.xmlSha256 &&
      archivedRamp?.status === 'PASS' &&
      archivedRamp.loadedTicks === (time.horizonUs - rolling.windowStartUs) / time.stepUs,
    'RAMP_WORLD_BINDING',
  );
  const { offset, frameBytes, payloadSha256 } = initialization.frame;
  demand(
    journal.readUInt32LE(offset) + 4 === frameBytes &&
      payloadSha256 === rolling.initializationPayloadSha256 &&
      digest(journal.subarray(offset + 4, offset + frameBytes)) === payloadSha256,
    'RAW_ROLLING_INITIALIZATION',
  );
  const firstRecord = 4 + journal.readUInt32LE(0);
  const invocation = journal.subarray(
    firstRecord + 4,
    firstRecord + 4 + journal.readUInt32LE(firstRecord),
  );
  const tagged = (value: string) => {
    const text = Buffer.from(value);
    const header = Buffer.alloc(5);
    header.writeUInt8(4);
    header.writeUInt32LE(text.length, 1);
    return Buffer.concat([header, text]);
  };
  const rawBinding = (path: string, hash: string) =>
    invocation.includes(Buffer.concat([tagged(path), tagged(hash)]));
  demand(
    rawBinding(
      'tools/robotics-field-core/mujoco-rolling-chassis.mjs',
      rolling.controllerSourceSha256,
    ) &&
      rawBinding(
        'tests/robotics/field-core-qualification/mujoco-rolling-chassis.fixture.json',
        rolling.controllerFixtureSha256,
      ),
    'ARCHIVED_ROLLING_CONTROL_BINDING',
  );
  const prior = reference.worlds.find(({ id }: { id: string }) => id === 'high');
  const archivedHigh = reference.verdicts.find(({ id }: { id: string }) => id === 'high');
  demand(
    reference.sourceSha256 === can.sourceSha256 &&
      reference.fixtureSha256 === can.fixtureSha256 &&
      digest(readFileSync(new URL('./mujoco-can-impact.fixture.json', import.meta.url))) ===
        can.fixtureSha256 &&
      reference.error === null &&
      archivedHigh?.accepted === true &&
      prior.counters.nativeSteps === impact.time.horizonUs / impact.time.stepUs,
    'IMPACT_ARCHIVE_BINDING',
  );
  const launch = prior.records[0].drive as Launch;
  const barrier =
    impact.can.massKg *
    impact.terrain.gravityMps2 *
    (Math.hypot(impact.can.radiusM, impact.can.halfHeightM) - impact.can.halfHeightM);
  const target = barrier * impact.cases.find(({ id }) => id === 'high')!.launchEnergyToBarrier;
  const force = Math.sqrt(2 * target * impact.striker.massKg) / (impact.striker.pulseUs / 1e6);
  demand(
    Math.abs(launch.targetEnergyJ - target) < 1e-12 &&
      Math.abs(launch.forceN - force) < 1e-12 &&
      launch.upperPulseDisplacementM < impact.striker.initialGapM,
    'IMPACT_LAUNCH_BINDING',
  );
  const rollingXml: string = selected.xml;
  const impactXml: string = reference.xml;
  demand(digest(impactXml) === reference.xmlSha256, 'IMPACT_XML_HASH');
  const optionsOf = (xml: string) =>
    Object.fromEntries(
      Array.from(
        xml.match(/<option ([^>]+)>/)![1].matchAll(/([a-z_]+)="([^"]+)"/g),
        ([, key, value]) => [key, value],
      ),
    );
  const r = optionsOf(rollingXml),
    c = optionsOf(impactXml);
  demand(
    canonicalEqual(r, { ...c, density: '0', viscosity: '0', wind: '0 0 0' }) &&
      rollingXml.match(/<flag [^>]+>/)?.[0] === impactXml.match(/<flag [^>]+>/)?.[0],
    'SHARED_GLOBAL_OPTIONS',
  );
  return {
    xml: composeXml(rollingXml, impactXml),
    options: selected.readback.options as OptionSnapshot,
    rampInitialQpos: selected.initial.qpos as number[],
    launch,
    reference: {
      archivedRamp: {
        id: archivedRamp.id,
        status: archivedRamp.status,
        ticks: archivedRamp.ticks,
        loadedTicks: archivedRamp.loadedTicks,
        workJ: archivedRamp.workJ,
      },
      archivedHigh,
      rollingXmlSha256: digest(rollingXml),
      impactXmlSha256: digest(impactXml),
    },
  };
}

function wheelTorque(startUs: number, v: number) {
  return startUs < rolling.motorSettleUs
    ? 0
    : rolling.torqueCapNm * Math.min(1, Math.max(0, 1 - v / rolling.noLoadJointRadPS));
}

function deckMotion(qpos: number[], qvel: number[]) {
  const mat = quaternionMatrix(qpos.slice(3, 7));
  // Archived R3: calibrated 0.8 kg centered base and four 0.05 kg wheel COMs.
  // Their symmetric x/y offsets cancel; total mass 1 kg and summed z moment -.004 kg m.
  const off: number[] = rotate(mat, [0, 0, -0.004]);
  const angular: number[] = rotate(mat, qvel.slice(3, 6));
  const delta: number[] = cross(angular, off);
  const com = off.map((v, i) => v + qpos[i]);
  const v = delta.map((v, i) => v + qvel[i]);
  return { com, uphillMps: dot(v, uphill) };
}

function canMotion(qpos: number[], qvel: number[]) {
  const center = qpos.slice(11, 14);
  const quat = qpos.slice(14, 18);
  demand(Math.abs(Math.hypot(...quat) - 1) < 1e-12, 'CAN_UNIT_QUATERNION');
  const axis: number[] = rotate(quaternionMatrix(quat), [0, 0, 1]);
  const tilt = Math.acos(Math.max(-1, Math.min(1, axis[2])));
  const speed = Math.hypot(...qvel.slice(10, 13));
  const angularSpeed = Math.hypot(...qvel.slice(13, 16));
  return { center, axis, tilt, speed, angularSpeed };
}

function state(data: MjData) {
  const result = {
    qpos: Array.from<number>(data.qpos),
    qvel: Array.from<number>(data.qvel),
    time: data.time,
  };
  demand(
    result.qpos.length === 19 &&
      result.qvel.length === 17 &&
      [...result.qpos, ...result.qvel, result.time].every(Number.isFinite),
    'FINITE_MODEL_STATE',
  );
  return result;
}

function optionReadback(model: MjModel, reference: OptionSnapshot) {
  const options = model.opt as unknown as Record<string, number | ArrayLike<number>>;
  return Object.fromEntries(
    Object.keys(reference).map((key) => [
      key,
      typeof options[key] === 'number'
        ? options[key]
        : Array.from(options[key] as ArrayLike<number>),
    ]),
  );
}

type Receipt = {
  records: unknown[];
  step1: number;
  step2: number;
  returned: number;
  forces: number;
  freed: number;
};

function observe(M: MainModule, input: ReturnType<typeof readInputs>, receipt: Receipt) {
  const model = M.MjModel.from_xml_string(input.xml);
  let data: MjData | undefined;
  let forceBuffer: InstanceType<MainModule['DoubleBuffer']> | undefined;
  try {
    const geomChars = Buffer.from(model.names);
    const geomNames = Array.from<number>(model.name_geomadr).map((start) =>
      geomChars.subarray(start, geomChars.indexOf(0, start)).toString('utf8'),
    );
    const ids = {
      ramp: geomNames.indexOf(names.ramp),
      flat: geomNames.indexOf(names.flat),
      can: geomNames.indexOf(names.can),
      canFloor: geomNames.indexOf(names.canFloor),
      bumper: geomNames.indexOf(names.bumper),
      wheels: names.wheels.map((name) => geomNames.indexOf(name)),
    };
    const pairKey = (pair: number[]) => [...pair].sort((a, b) => a - b).join('/');
    const pairs = Array.from<number>(model.pair_geom1).map((id, i) => [id, model.pair_geom2[i]]);
    const expectedPairs = [
      ...ids.wheels.flatMap((wheel) => [
        [ids.flat, wheel],
        [ids.ramp, wheel],
      ]),
      [ids.canFloor, ids.can],
      [ids.can, ids.bumper],
    ];
    const actualOptions = optionReadback(model, input.options);
    receipt.records.push({
      type: 'model',
      geomNames,
      ids,
      pairs,
      actualOptions,
      dimensions: [model.nq, model.nv, model.nu, model.npair, model.nbody, model.ngeom],
      geomTypes: Array.from(model.geom_type),
      inertias: Array.from(model.body_inertia),
    });
    demand(
      model.nq === 19 &&
        model.nv === 17 &&
        model.nu === 4 &&
        model.nbody === 8 &&
        model.ngeom === 10 &&
        model.npair === 10 &&
        canonicalEqual(actualOptions, input.options),
      'SHARED_MODEL_LAYOUT_OR_OPTIONS',
    );
    demand(
      [ids.ramp, ids.flat, ids.can, ids.canFloor, ids.bumper, ...ids.wheels].every(
        (id) => id >= 0,
      ) &&
        model.geom_type[ids.ramp] === 7 &&
        model.geom_type[ids.can] === 5 &&
        model.geom_type[ids.bumper] === 2 &&
        model.geom_type[ids.canFloor] === 0 &&
        canonicalEqual(pairs.map(pairKey).sort(), expectedPairs.map(pairKey).sort()),
      'SHARED_GEOMETRY_AND_PAIR_TOPOLOGY',
    );
    demand(
      [ids.can, ids.canFloor, ids.bumper].every(
        (id) => model.geom_contype[id] === 0 && model.geom_conaffinity[id] === 0,
      ) &&
        canonicalEqual(Array.from(model.jnt_qposadr), [0, 7, 8, 9, 10, 11, 18]) &&
        canonicalEqual(Array.from(model.jnt_dofadr), [0, 6, 7, 8, 9, 10, 16]) &&
        canonicalEqual(Array.from(model.actuator_trnid), [1, -1, 2, -1, 3, -1, 4, -1]),
      'MODEL_ACTUATOR_OR_ISOLATION',
    );
    data = new M.MjData(model);
    forceBuffer = new M.DoubleBuffer(6);
    const initial = state(data);
    const pistonDof = 16;
    demand(
      initial.qvel.every((v) => v === 0) &&
        initial.time === 0 &&
        canonicalEqual(initial.qpos.slice(0, 11), input.rampInitialQpos) &&
        initial.qpos[11] === 0 &&
        initial.qpos[12] === can.laneYM &&
        initial.qpos[13] === impact.can.halfHeightM + impact.can.initialGapM &&
        initial.qpos[18] === 0,
      'SHARED_FACTORY_START',
    );
    const resources = { temporaryCreated: 0, temporaryDeleted: 0 };
    const cap = {
      nbody: model.nbody,
      ngeom: model.ngeom,
      maxContacts: limits.maxContacts,
      maxConstraintRows: 3 * limits.maxContacts,
      maxIslands: model.ntree,
      pairCaps: pairs.map((geom) => ({ geom, maxContacts: geom.includes(ids.bumper) ? 1 : 4 })),
      warningCount: 7,
      maxWarningObservations: 2 * limits.steps,
      maxWarningGets: 14 * limits.steps,
      maxContactVectors: 2 * limits.steps,
      maxContactGets: 2 * limits.maxContacts * limits.steps,
    };
    const startPulse = can.launchStartUs;
    const endPulse = startPulse + impact.striker.pulseUs;
    const threshold = Math.atan2(impact.can.radiusM, impact.can.halfHeightM);
    const floorDrop = (impact.can.halfHeightM - impact.can.radiusM) * impact.witness.dropFraction;
    let firstHit: { us: number; heightM: number; fourWheels: boolean } | null = null;
    let firstCrossUs: number | null = null;
    let signedMomentAtCross: number | null = null;
    let sideSinceUs: number | null = null;
    let firstSideUs: number | null = null;
    let rampStart: ReturnType<typeof deckMotion> | null = null;
    let settled = 0,
      supported = 0,
      sideUs = 0,
      impulseNs = 0,
      tipMomentNms = 0,
      speedIntegral = 0,
      driveWorkJ = 0,
      bumperWorkJ = 0;
    let settlingValid = true,
      separatedCommand = true,
      launchEnergyValid = false,
      sawFlat = false,
      sawRampBeforeWindow = false;
    for (let tick = 0; tick < limits.steps; tick += 1) {
      const startUs = tick * time.stepUs;
      const endUs = startUs + time.stepUs;
      const before = state(data);
      const torque = before.qvel.slice(6, 10).map((v) => wheelTorque(startUs, v));
      data.ctrl.set(torque);
      const drive = startUs >= startPulse && startUs < endPulse ? input.launch.forceN : 0;
      demand(
        Array.from<number>(data.qfrc_applied)
          .slice(0, pistonDof)
          .every((f) => f === 0),
        'ONLY_PRISMATIC_DRIVE',
      );
      data.qfrc_applied[pistonDof] = drive;
      receipt.step1 += 1;
      M.mj_step1(model, data);
      demand(canonicalEqual(before, state(data)), 'STEP1_MUTATED_STATE');
      const pre = captureGeometry(data, resources, cap);
      if (drive !== 0 && pre.contacts.some((c: { geom: number[] }) => c.geom.includes(ids.bumper)))
        separatedCommand = false;
      receipt.step2 += 1;
      M.mj_step2(model, data);
      receipt.returned += 1;
      const post = state(data);
      demand(Math.abs(post.time - endUs / 1e6) < 1e-9, 'NATIVE_CANONICAL_TIME');
      const solved = captureGeometry(data, resources, cap);
      demand(
        pre.nefc === 3 * pre.ncon &&
          solved.nefc === pre.nefc &&
          canonicalEqual(pre.contacts, solved.contacts) &&
          canonicalEqual(pre.efcId, solved.efcId) &&
          !pre.warnings.flat().some(Boolean) &&
          !solved.warnings.flat().some(Boolean) &&
          resources.temporaryCreated === resources.temporaryDeleted,
        'SOLVED_CONTACT_PHASE',
      );
      const actualTorque = Array.from<number>(data.actuator_force);
      const deliveredTorque = Array.from<number>(data.qfrc_actuator);
      demand(
        actualTorque.length === 4 &&
          actualTorque.every(
            (v, i) =>
              Number.isFinite(v) &&
              Math.abs(v) <= rolling.torqueCapNm + rolling.torqueRoundoffNm &&
              Math.abs(v - torque[i]) <= rolling.torqueRoundoffNm,
          ) &&
          deliveredTorque.length === 17 &&
          deliveredTorque.slice(0, 6).every((v) => v === 0) &&
          deliveredTorque.slice(10).every((v) => v === 0) &&
          canonicalEqual(deliveredTorque.slice(6, 10), actualTorque),
        'NATIVE_WHEEL_TORQUE',
      );
      driveWorkJ +=
        actualTorque.reduce(
          (power, value, i) => power + 0.5 * value * (before.qvel[6 + i] + post.qvel[6 + i]),
          0,
        ) * dt;
      bumperWorkJ += 0.5 * drive * (before.qvel[pistonDof] + post.qvel[pistonDof]) * dt;
      const records = [];
      const wheelLoads = new Set<number>();
      let wheelRowsValid = true;
      let floorLoaded = false;
      let bumperLoaded = false;
      const heights: number[] = [];
      for (const row of pre.contacts) {
        const geom: number[] = row.geom;
        const address: number = row.efc_address;
        demand(
          row.exclude === 0 &&
            address >= 0 &&
            pre.efcId.slice(address, address + 3).length === 3 &&
            pre.efcId.slice(address, address + 3).every((id: number) => id === row.index) &&
            frameError(row.frame) <= impact.witness.contactFrameTolerance,
          'REGISTERED_SOLVED_CONTACT',
        );
        receipt.forces += 1;
        M.mj_contactForce(model, data, row.index, forceBuffer);
        const f = Array.from<number>(forceBuffer.GetView());
        demand(f.length === 6 && f.every(Number.isFinite) && f[0] >= 0, 'FINITE_CONTACT_FORCE');
        if (f[0] > 0) {
          const wheel = ids.wheels.find((id) => geom.includes(id));
          if (wheel !== undefined) {
            if (geom.includes(ids.flat)) sawFlat = true;
            if (geom.includes(ids.ramp)) {
              if (startUs < rolling.windowStartUs) sawRampBeforeWindow = true;
              const direction: number[] = contactWorldForce(row.frame, f).map((v: number) =>
                geom[1] === wheel ? v : -v,
              );
              const normal = row.frame.slice(0, 3).map((v: number) => (geom[1] === wheel ? v : -v));
              const center = pre.poses.geom_xpos.slice(3 * wheel, 3 * wheel + 3);
              const axis = [2, 5, 8].map((i) => pre.poses.geom_xmat[9 * wheel + i]);
              const offset = row.pos.map((v: number, i: number) => v - center[i]);
              const axial = dot(offset, axis);
              const radial = Math.sqrt(Math.max(0, dot(offset, offset) - axial ** 2));
              const radius = model.geom_size[3 * wheel];
              const halfWidth = model.geom_size[3 * wheel + 1];
              const height = dot(row.pos, rampNormal);
              const x = row.pos[0] - height * rampNormal[0];
              if (
                dot(direction, rampNormal) > 0 &&
                Math.abs(dot(normal, rampNormal) - 1) <= impact.witness.contactFrameTolerance &&
                row.dist < 0 &&
                row.dist >= -rolling.elevationToleranceM &&
                Math.abs(dot(center, rampNormal) - radius) <= rolling.elevationToleranceM &&
                Math.abs(radial - radius) <= rolling.elevationToleranceM &&
                Math.abs(axial) <= halfWidth + rolling.elevationToleranceM &&
                x >= rolling.interiorMarginM &&
                x <= rolling.wedgeLengthM - rolling.interiorMarginM &&
                Math.abs(row.pos[1]) <= rolling.wedgeHalfWidthM - rolling.interiorMarginM &&
                Math.abs(height) <= rolling.elevationToleranceM / 2 + 1e-6
              )
                wheelLoads.add(wheel);
              else wheelRowsValid = false;
            } else wheelRowsValid = false;
          }
          if (geom.includes(ids.canFloor)) floorLoaded = true;
          if (geom.includes(ids.bumper)) {
            bumperLoaded = true;
            heights.push(row.pos[2]);
            const world: number[] = contactWorldForce(row.frame, f).map((v: number) =>
              geom[1] === ids.can ? v : -v,
            );
            const lever = row.pos.map((v: number, i: number) => v - before.qpos[11 + i]);
            impulseNs += world[0] * dt;
            tipMomentNms += cross(lever, world)[1] * dt;
          }
        }
        records.push({ geom, point: row.pos, frame: row.frame, dist: row.dist, force: f });
      }
      const canNow = canMotion(post.qpos, post.qvel);
      const rampNow = deckMotion(post.qpos, post.qvel);
      const allWheels = wheelRowsValid && wheelLoads.size === 4;
      if (startUs >= rolling.windowStartUs) {
        if (rampStart === null) rampStart = deckMotion(before.qpos, before.qvel);
        if (allWheels) supported += 1;
        speedIntegral += deckMotion(before.qpos, before.qvel).uphillMps * dt;
      }
      if (!firstHit && heights.length > 0)
        firstHit = { us: startUs, heightM: Math.max(...heights), fourWheels: allWheels };
      if (firstCrossUs === null && canNow.tilt >= threshold) {
        firstCrossUs = endUs;
        signedMomentAtCross = tipMomentNms;
      }
      if (endUs > startPulse - impact.time.settleWitnessUs && endUs <= startPulse) {
        settled += 1;
        settlingValid &&=
          floorLoaded &&
          !bumperLoaded &&
          canNow.tilt <= radians(impact.witness.uprightToleranceDegrees) &&
          Math.abs(canNow.center[2] - impact.can.halfHeightM) <=
            impact.witness.settledCenterErrorM &&
          canNow.speed <= impact.witness.settledSpeedMps &&
          canNow.angularSpeed <= impact.witness.settledAngularSpeedRadPS &&
          post.qpos[18] === 0 &&
          post.qvel[pistonDof] === 0;
      }
      if (endUs === endPulse) {
        const energy = 0.5 * impact.striker.massKg * post.qvel[pistonDof] ** 2;
        const tolerance = impact.witness.launchEnergyRelativeTolerance * input.launch.targetEnergyJ;
        launchEnergyValid =
          Math.abs(energy - input.launch.targetEnergyJ) <= tolerance &&
          Math.abs(energy - bumperWorkJ) <= tolerance;
      }
      const side =
        firstHit !== null &&
        firstCrossUs !== null &&
        firstCrossUs > firstHit.us &&
        allWheels &&
        floorLoaded &&
        !bumperLoaded &&
        Math.abs(canNow.axis[2]) <= Math.sin(radians(impact.witness.sideToleranceDegrees)) &&
        impact.can.halfHeightM - canNow.center[2] >= floorDrop &&
        Math.abs(canNow.center[0]) + impact.can.halfHeightM + impact.can.radiusM <
          impact.terrain.interiorHalfWidthM &&
        Math.abs(canNow.center[1] - can.laneYM) + impact.can.halfHeightM + impact.can.radiusM <
          impact.terrain.interiorHalfDepthM;
      if (side) {
        if (sideUs === 0) sideSinceUs = startUs;
        sideUs += time.stepUs;
      } else {
        sideUs = 0;
        sideSinceUs = null;
      }
      if (sideUs >= impact.time.landingWitnessUs && firstSideUs === null) firstSideUs = endUs;
      if (
        endUs % time.ordinarySampleUs === 0 ||
        (startUs >= startPulse && startUs < time.denseCaptureUntilUs) ||
        endUs === firstSideUs
      ) {
        receipt.records.push({
          type: 'sample',
          startUs,
          endUs,
          before,
          post,
          canNow,
          rampNow,
          torque,
          actualTorque,
          deliveredTorque,
          drive,
          records,
          allWheels,
          floorLoaded,
          bumperLoaded,
          side,
          sideSinceUs,
          driveWorkJ,
          bumperWorkJ,
        });
      }
    }
    demand(rampStart, 'MISSING_COMMON_RAMP_WINDOW');
    const final = state(data);
    const end = deckMotion(final.qpos, final.qvel);
    const dx = end.com[0] - rampStart.com[0],
      dz = end.com[2] - rampStart.com[2];
    const meanSpeed = speedIntegral / ((time.horizonUs - rolling.windowStartUs) / 1e6);
    const speedOk = (speed: number) =>
      Math.abs(speed - rolling.terminalSpeedMps) <=
      rolling.speedRelativeTolerance * rolling.terminalSpeedMps;
    const rampPass =
      sawFlat &&
      sawRampBeforeWindow &&
      supported === (time.horizonUs - rolling.windowStartUs) / time.stepUs &&
      dx > 0 &&
      dz > 0 &&
      Math.abs(dz - Math.tan(slope) * dx) <= rolling.elevationToleranceM &&
      speedOk(meanSpeed) &&
      speedOk(end.uphillMps) &&
      driveWorkJ > 0;
    const canPass =
      settled === impact.time.settleWitnessUs / time.stepUs &&
      settlingValid &&
      separatedCommand &&
      launchEnergyValid &&
      firstHit !== null &&
      firstHit.us >= endPulse &&
      firstHit.fourWheels &&
      firstHit.heightM >= impact.striker.axisZM - impact.striker.radiusM &&
      impulseNs > 0 &&
      firstCrossUs !== null &&
      firstCrossUs > firstHit.us &&
      signedMomentAtCross !== null &&
      signedMomentAtCross > 0 &&
      firstSideUs !== null &&
      firstSideUs > firstCrossUs;
    return {
      rampPass,
      canPass,
      commonPass: rampPass && canPass,
      firstHit,
      firstCrossUs,
      signedMomentAtCross,
      firstSideUs,
      meanSpeed,
      endpointSpeed: end.uphillMps,
      dx,
      dz,
      supported,
      driveWorkJ,
      bumperWorkJ,
      impulseNs,
      resources,
    };
  } finally {
    try {
      if (forceBuffer) {
        forceBuffer.delete();
        receipt.freed += 1;
      }
    } finally {
      try {
        if (data) {
          data.delete();
          receipt.freed += 1;
        }
      } finally {
        model.delete();
        receipt.freed += 1;
      }
    }
  }
}

function openReceipt(path: string) {
  demand(isAbsolute(path) && resolve(path) === path, 'CANONICAL_OUTPUT');
  const dir = realpathSync(dirname(path));
  const under = (base: string) => {
    const tail = relative(base, dir);
    return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail);
  };
  demand(
    dir === dirname(path) &&
      under(realpathSync(tmpdir())) &&
      !under(realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))),
    'EXTERNAL_TEMP_OUTPUT',
  );
  return openSync(path, 'wx');
}

it('locks the independent actuation, common window and single-model native budget', () => {
  expect(digest(readFileSync(fixtureUrl))).toBe(fixtureSha);
  expect(limits.models).toBe(1);
  expect(time.horizonUs / time.stepUs).toBe(limits.steps);
  expect(wheelTorque(rolling.motorSettleUs - 1, 0)).toBe(0);
  expect(wheelTorque(rolling.motorSettleUs, -1)).toBe(rolling.torqueCapNm);
  expect(wheelTorque(rolling.motorSettleUs, rolling.noLoadJointRadPS / 2)).toBe(
    rolling.torqueCapNm / 2,
  );
  expect(wheelTorque(rolling.motorSettleUs, rolling.noLoadJointRadPS)).toBe(0);
  expect(can.launchStartUs).toBe(rolling.windowStartUs);
  expect(time.horizonUs - can.launchStartUs).toBeGreaterThan(
    impact.striker.pulseUs + impact.time.landingWitnessUs,
  );
});

it.runIf(Boolean(rollingDir && impactPath))(
  'binds two unchanged archives and authors one composed XML',
  () => {
    const input = readInputs(rollingDir!, impactPath!);
    expect(input.xml.match(/<option /g)).toHaveLength(1);
    expect(input.xml.match(/<pair /g)).toHaveLength(10);
    expect(input.xml.match(/<motor /g)).toHaveLength(4);
    expect(input.xml).toContain(
      `<geom contype="0" conaffinity="0" name="ground" type="plane" pos="0 ${can.laneYM} 0"`,
    );
    expect(input.xml).toContain('<geom name="ramp" type="mesh" mesh="ramp_mesh"/>');
  },
);

it.runIf(Boolean(outputPath))(
  'witnesses actual can impact and wheel climbing in one native world',
  async () => {
    const sourceSha256 = digest(readFileSync(new URL(import.meta.url)));
    demand(
      sourcePin?.toLowerCase() === sourceSha256 &&
        digest(readFileSync(fixtureUrl)) === fixtureSha &&
        rollingDir &&
        impactPath,
      'EXACT_SOURCE_ADMISSION',
    );
    const input = readInputs(rollingDir, impactPath);
    const fd = openReceipt(outputPath!);
    const receipt = {
      fixture,
      fixtureSha256: fixtureSha,
      sourceSha256,
      modelXml: input.xml,
      modelSha256: digest(input.xml),
      reference: input.reference,
      runtime: '',
      records: [] as unknown[],
      step1: 0,
      step2: 0,
      returned: 0,
      forces: 0,
      freed: 0,
      error: null as string | null,
      verdict: null as ReturnType<typeof observe> | null,
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
      receipt.verdict = observe(M, input, receipt);
    } catch (error) {
      receipt.error = String(error);
    } finally {
      try {
        const bytes = Buffer.from(
          JSON.stringify(receipt, (_key, value) =>
            typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
              ? Object.is(value, -0)
                ? '-0'
                : String(value)
              : value,
          ) + '\n',
        );
        demand(bytes.length <= limits.maxReceiptBytes, 'EXTERNAL_RECEIPT_CAP');
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    expect(receipt.error).toBeNull();
    expect(receipt.step1).toBe(limits.steps);
    expect(receipt.step2).toBe(limits.steps);
    expect(receipt.returned).toBe(limits.steps);
    expect(receipt.freed).toBe(3);
    expect(receipt.verdict?.commonPass).toBe(true);
  },
  120_000,
);
