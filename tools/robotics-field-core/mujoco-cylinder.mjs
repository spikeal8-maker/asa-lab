import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import {
  readFixture as readParentFixture,
  verifyEngineArtifacts,
  sourceManifest as parentManifest,
  nativeTimeBudget,
  sha256,
} from './mujoco-phy01.mjs';
import {
  demand,
  finite,
  canonicalBytes,
  canonicalEqual,
  digest,
  portableError,
  StepChain,
  TickRetention,
  sub,
  norm,
  floorFrame,
  radians,
  copyState,
  phaseState,
  copyWarnings,
  captureForward,
  captureForces,
  contactIdentity,
  assessContacts,
  bodyEndpoint,
  tiltState,
  bodyEnergy,
  quaternionAngle,
  effectiveTorque,
  assessWindow,
  boundedNativeArray,
  captureGeometry,
  copyGeometryWarnings,
  frameError,
  quaternionMatrix,
  rotate,
  supportWitness,
} from './mujoco-contact-observer.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixturePath = 'tests/robotics/field-core-qualification/mujoco-cylinder.fixture.json';
const fixtureContractSha256 = '05c69ee69a797fca063b6b81cbaffd6db01656fac60ea32f704c027540d08ff1';
export const cylinderSourcePaths = [
  'tools/robotics-field-core/mujoco-contact-observer.mjs',
  'tools/robotics-field-core/mujoco-cylinder.mjs',
  'tools/robotics-field-core/run-mujoco-cylinder.mjs',
  fixturePath,
  'tests/robotics/field-core-qualification/mujoco-cylinder.spec.ts',
];
export function readCylinderFixture() {
  const bytes = readFileSync(resolve(root, fixturePath));
  return { fixture: JSON.parse(bytes.toString('utf8')), fixtureSha256: sha256(bytes) };
}
export function validateCylinderFixture(f) {
  demand(
    sha256(JSON.stringify(f)) === fixtureContractSha256,
    'CYLINDER_REGISTERED_CONTRACT_MISMATCH',
  );
  for (const h of f.nativeStepUs) {
    demand(
      Number.isSafeInteger(h) &&
        f.macroStepUs % h === 0 &&
        [
          f.rest.settleUs,
          f.rest.measureUs,
          f.tilt.stationaryWindowUs,
          f.retention.compactCadenceUs,
          f.retention.preWindowUs,
          ...f.tilt.rates.flatMap((r) => [r.rampUs, r.holdUs]),
        ].every((t) => t % h === 0),
      'CYLINDER_INTEGER_SCHEDULE',
    );
  }
  return f;
}
export function cylinderSourceManifest() {
  return {
    newInputs: Object.fromEntries(
      cylinderSourcePaths.map((p) => [p, sha256(readFileSync(resolve(root, p)))]),
    ),
    immutableParents: parentManifest(),
    specification: {
      [readCylinderFixture().fixture.specification.path]: sha256(
        readFileSync(resolve(root, readCylinderFixture().fixture.specification.path)),
      ),
    },
    parentExecution:
      'Only readFixture, artifact validation, hashes and nativeTimeBudget helpers are imported; prior PHY01 physics is not rerun.',
  };
}
export function verifyCylinderArtifacts(f) {
  validateCylinderFixture(f);
  const { fixture: parent } = readParentFixture();
  demand(
    parent.engine.wasmSha256 === f.engine.wasmSha256 &&
      parent.engine.moduleSha256 === f.engine.moduleSha256 &&
      parent.engine.version === f.engine.version,
    'CYLINDER_PARENT_ENGINE_IDENTITY',
  );
  demand(
    parentManifest()['tools/robotics-field-core/mujoco-phy01.mjs'] === f.parent.sourceSha256,
    'CYLINDER_PARENT_HELPER_CHANGED',
  );
  return verifyEngineArtifacts(parent);
}

export function cylinderPlan(f, mode) {
  validateCylinderFixture(f);
  demand(mode === 'admission' || mode === 'main', 'CYLINDER_EXPLICIT_MODE_REQUIRED');
  const result = [];
  if (mode === 'admission') {
    for (const probe of ['A', 'B'])
      for (const dtUs of f.nativeStepUs)
        for (const phase of ['split', 'full']) {
          const durationUs = f.admission[probe].durationUs;
          result.push({
            id: 'admission-' + probe + '-' + dtUs + '-' + phase,
            mode,
            probe,
            kind: probe === 'A' ? 'static' : 'tilt',
            dtUs,
            phase,
            repeat: 1,
            rate: probe === 'B' ? 'normal' : null,
            maxSteps: durationUs / dtUs,
            targets: probe === 'B' ? 1 : 0,
          });
        }
  } else {
    for (const dtUs of f.nativeStepUs)
      for (let repeat = 1; repeat <= f.repeats; repeat += 1)
        result.push({
          id: 'rest-' + dtUs + '-r' + repeat,
          mode,
          probe: null,
          kind: 'static',
          dtUs,
          phase: 'split',
          repeat,
          rate: null,
          maxSteps: (f.rest.settleUs + f.rest.measureUs) / dtUs,
          targets: 0,
        });
    for (const rate of f.tilt.rates)
      for (const dtUs of f.nativeStepUs)
        for (let repeat = 1; repeat <= f.repeats; repeat += 1)
          result.push({
            id: 'tilt-' + rate.id + '-' + dtUs + '-r' + repeat,
            mode,
            probe: null,
            kind: 'tilt',
            dtUs,
            phase: 'split',
            repeat,
            rate: rate.id,
            targets: f.tilt.targetCount,
            maxSteps: (f.tilt.settleUs + f.tilt.targetCount * (rate.rampUs + rate.holdUs)) / dtUs,
          });
  }
  const budget = f.budgets[mode];
  demand(
    result.length === budget.worlds &&
      result.reduce((s, p) => s + p.maxSteps, 0) === (budget.nativeSteps ?? budget.maxNativeSteps),
    'CYLINDER_PLAN_BUDGET',
  );
  return result;
}

export function cylinderScenarioLimits(f, condition) {
  demand(['static', 'tilt'].includes(condition.kind), 'CYLINDER_SCENARIO');
  const limits = { ...f.resources, ...f.resources.scenarios[condition.kind] };
  limits.pairCaps = [{ geom: [0, 1], maxContacts: f.contact.cylinderNativeContactCap }];
  if (condition.kind === 'static')
    limits.pairCaps.push({ geom: [0, 2], maxContacts: f.contact.boxBoxNativeContactCap });
  return limits;
}

/** Encoded live records, including schedule-limited unfilled admission A rings. */
export function cylinderRetentionProof(f) {
  const r = f.retention;
  const minDt = Math.min(...f.nativeStepUs);
  const ringTicks = r.preWindowUs / minDt;
  const aTicks = Math.min(ringTicks, f.admission.A.durationUs / minDt);
  demand(Number.isSafeInteger(ringTicks) && ringTicks <= r.maxRingTicks, 'RESOURCE_RING_COUNT');
  const live = {
    admissionA: 2 * aTicks * r.scenarioTickBytes.static,
    admissionB: 2 * ringTicks * r.scenarioTickBytes.tilt,
    mainStatic: ringTicks * r.scenarioTickBytes.static,
    mainTilt: ringTicks * r.scenarioTickBytes.tilt,
  };
  const maxLiveRing = Math.max(...Object.values(live));
  const overhead = 2 * ringTicks * r.emergencyRecordOverheadBytes;
  const partial = 2 * r.maxFailureObservationBytes;
  const total = maxLiveRing + overhead + partial + r.emergencyTrailerBytes;
  demand(
    maxLiveRing <= r.maxLiveRingBytes &&
      maxLiveRing < r.formerGlobalRingBudgetBytes &&
      Math.max(live.admissionA, live.admissionB) <= r.maxAdmissionRingBytes &&
      Math.max(live.mainStatic, live.mainTilt) <= r.maxMainRingBytes &&
      total <= r.reservedFailureTrailerBytes &&
      r.reservedFailureTrailerBytes < r.maxJournalBytes,
    'RESOURCE_SCHEDULE_RING_OR_RESERVE',
  );
  return { live, maxLiveRing, overhead, partial, trailer: r.emergencyTrailerBytes, total };
}

export function blockInertia(f) {
  const b = f.bodies.block;
  const [x, y, z] = b.dimensionsM;
  return [y * y + z * z, x * x + z * z, x * x + y * y].map((v) => (b.massKg * v) / 12);
}
export function worldIds(f, condition) {
  const c = f.bodies.cylinder;
  const b = f.bodies.block;
  const cylinder = {
    name: 'cylinder',
    kind: 'cylinder',
    bodyId: condition.kind === 'tilt' ? 2 : 1,
    geomId: 1,
    qposAdr: condition.kind === 'tilt' ? 1 : 0,
    dofAdr: condition.kind === 'tilt' ? 1 : 0,
    mass: c.massKg,
    inertia: c.inertiaKgM2,
    radius: c.radiusM,
    height: c.heightM,
  };
  const block = {
    name: 'block',
    kind: 'block',
    bodyId: 2,
    geomId: 2,
    qposAdr: 7,
    dofAdr: 6,
    mass: b.massKg,
    inertia: blockInertia(f),
    dimensions: b.dimensionsM,
  };
  return condition.kind === 'tilt'
    ? { bodyIds: [0, 1, 2], geomBodies: [1, 2], floorGeom: 0, floorBody: 1, freeBodies: [cylinder] }
    : {
        bodyIds: [0, 1, 2],
        geomBodies: [0, 1, 2],
        floorGeom: 0,
        floorBody: 0,
        freeBodies: [cylinder, block],
      };
}
const attr = (name, value) =>
  name + '="' + (Array.isArray(value) ? value.join(' ') : String(value)) + '"';
export function makeCylinderXml(f, condition) {
  validateCylinderFixture(f);
  demand(
    cylinderPlan(f, condition.mode).some((p) => canonicalEqual(p, condition)),
    'CYLINDER_UNREGISTERED_WORLD',
  );
  const s = f.solver;
  const c = f.bodies.cylinder;
  const b = f.bodies.block;
  const pair = (other) =>
    '<pair geom1="floor" geom2="' +
    other +
    '" ' +
    [
      attr('condim', 3),
      attr('friction', f.contact.pairFriction),
      attr('solref', f.contact.solref),
      attr('solreffriction', f.contact.solreffriction),
      attr('solimp', f.contact.solimp),
      attr('margin', 0),
      attr('gap', 0),
    ].join(' ') +
    '/>';
  const cylinder = (x) =>
    '<body name="cylinder" pos="' +
    x +
    ' 0 ' +
    (c.heightM / 2 + f.initialGapM) +
    '"><freejoint name="cylinder_free"/><inertial pos="0 0 0" ' +
    attr('mass', c.massKg) +
    ' ' +
    attr('diaginertia', c.inertiaKgM2) +
    '/><geom name="cylinder_geom" type="cylinder" ' +
    attr('size', [c.radiusM, c.heightM / 2]) +
    '/></body>';
  const xml = [
    '<mujoco model="asa_mujoco_cylinder">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false"/>',
    '<option ' +
      [
        attr('timestep', condition.dtUs / 1e6),
        attr('gravity', f.gravity),
        attr('integrator', s.integrator),
        attr('solver', s.solver),
        attr('jacobian', s.jacobian),
        attr('cone', s.cone),
        attr('iterations', s.iterations),
        attr('tolerance', s.tolerance),
        attr('ls_iterations', s.lsIterations),
        attr('ls_tolerance', s.lsTolerance),
        attr('noslip_iterations', s.noSlipIterations),
        attr('noslip_tolerance', s.noSlipTolerance),
        attr('impratio', s.impratio),
        attr('ccd_iterations', s.ccdIterations),
        attr('ccd_tolerance', s.ccdTolerance),
        attr('density', 0),
        attr('viscosity', 0),
        attr('wind', [0, 0, 0]),
      ].join(' ') +
      '>',
    '<flag warmstart="enable" island="enable" refsafe="enable" nativeccd="disable" multiccd="enable" ' +
      'diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable" ' +
      'invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/>',
    '</option>',
    '<default><joint damping="0" frictionloss="0" armature="0" stiffness="0" limited="false"/>' +
      '<geom condim="3" friction="1 0 0" margin="0" gap="0" ' +
      attr('solref', f.contact.solref) +
      ' ' +
      attr('solimp', f.contact.solimp) +
      '/></default>',
    '<worldbody>',
  ];
  if (condition.kind === 'static') {
    xml.push(
      '<geom name="floor" type="box" ' +
        attr('size', f.bodies.floor.halfExtentsM) +
        ' pos="0 0 -0.025"/>',
      cylinder(c.restX),
      '<body name="block" pos="' +
        b.restX +
        ' 0 ' +
        (b.dimensionsM[2] / 2 + f.initialGapM) +
        '"><freejoint name="block_free"/><inertial pos="0 0 0" ' +
        attr('mass', b.massKg) +
        ' ' +
        attr('diaginertia', blockInertia(f)) +
        '/><geom name="block_geom" type="box" ' +
        attr(
          'size',
          b.dimensionsM.map((x) => x / 2),
        ) +
        '/></body>',
    );
  } else {
    xml.push(
      '<body name="floor_body" pos="0 0 0"><joint name="floor_hinge" type="hinge" ' +
        'axis="0 1 0" pos="0 0 0" limited="false"/>' +
        '<inertial ' +
        attr('pos', f.stand.com) +
        ' ' +
        attr('mass', f.stand.massKg) +
        ' ' +
        attr('diaginertia', f.stand.inertiaKgM2) +
        '/><geom name="floor" type="box" ' +
        attr('size', f.bodies.floor.halfExtentsM) +
        ' pos="0 0 -0.025"/></body>',
      cylinder(0),
    );
  }
  xml.push('</worldbody>', '<contact>', pair('cylinder_geom'));
  if (condition.kind === 'static') xml.push(pair('block_geom'));
  xml.push('</contact>');
  if (condition.kind === 'tilt')
    xml.push(
      '<actuator><position name="floor_servo" joint="floor_hinge" ' +
        [
          attr('gear', f.stand.gear),
          attr('kp', f.stand.kp),
          attr('kv', f.stand.kv),
          attr('ctrllimited', 'true'),
          attr('forcelimited', 'true'),
          attr('ctrlrange', f.stand.ctrlRangeRad),
          attr('forcerange', f.stand.forceRangeNm),
        ].join(' ') +
        '/></actuator>',
    );
  if (condition.probe === 'A') {
    const a = f.admission.A;
    xml.push(
      '<keyframe><key name="initial" ' +
        attr('qvel', [
          ...a.cylinderInitialLinearVelocity,
          ...a.cylinderInitialAngularVelocity,
          ...a.blockInitialLinearVelocity,
          ...a.blockInitialAngularVelocity,
        ]) +
        '/></keyframe>',
    );
  }
  xml.push('</mujoco>');
  return xml.join('\n') + '\n';
}

export function controlAt(f, condition, tickBefore) {
  demand(Number.isSafeInteger(tickBefore) && tickBefore >= 0, 'CONTROL_INTEGER_TICK');
  const tUs = tickBefore * condition.dtUs;
  if (condition.kind === 'static')
    return {
      u: 0,
      stage: 0,
      target: 0,
      phase:
        condition.probe === 'A'
          ? 'ADMISSION_A'
          : tUs < f.rest.settleUs
            ? 'SETTLING'
            : 'REST_MEASUREMENT',
      stageEndUs:
        condition.probe === 'A' ? f.admission.A.durationUs : f.rest.settleUs + f.rest.measureUs,
    };
  if (tUs < f.tilt.settleUs)
    return { u: 0, stage: 0, phase: 'SETTLING', target: 0, stageEndUs: f.tilt.settleUs };
  const rate = f.tilt.rates.find((r) => r.id === condition.rate);
  const span = rate.rampUs + rate.holdUs;
  const elapsed = tUs - f.tilt.settleUs;
  const stage = Math.floor(elapsed / span) + 1;
  const localUs = elapsed % span;
  const fraction = Math.min(1, localUs / rate.rampUs);
  const smooth = 10 * fraction ** 3 - 15 * fraction ** 4 + 6 * fraction ** 5;
  return {
    u: (stage - 1 + smooth) * f.tilt.targetStepRad,
    stage,
    phase: localUs < rate.rampUs ? 'RAMP' : 'HOLD',
    target: stage * f.tilt.targetStepRad,
    stageEndUs: f.tilt.settleUs + stage * span,
  };
}

const modelArrays = [
  'body_mass',
  'body_inertia',
  'body_ipos',
  'body_iquat',
  'body_gravcomp',
  'body_parentid',
  'body_dofadr',
  'body_dofnum',
  'body_pos',
  'body_quat',
  'geom_bodyid',
  'geom_type',
  'geom_size',
  'geom_pos',
  'geom_quat',
  'geom_friction',
  'geom_condim',
  'geom_margin',
  'geom_gap',
  'geom_solref',
  'geom_solimp',
  'geom_adhesion',
  'geom_surfacevel',
  'pair_adhesion',
  'jnt_type',
  'jnt_bodyid',
  'jnt_qposadr',
  'jnt_dofadr',
  'jnt_pos',
  'jnt_axis',
  'jnt_limited',
  'jnt_stiffness',
  'dof_damping',
  'dof_dampingpoly',
  'dof_frictionloss',
  'dof_armature',
  'pair_dim',
  'pair_geom1',
  'pair_geom2',
  'pair_friction',
  'pair_margin',
  'pair_gap',
  'pair_solref',
  'pair_solreffriction',
  'pair_solimp',
  'actuator_gear',
  'actuator_gainprm',
  'actuator_biasprm',
  'actuator_dynprm',
  'actuator_dyntype',
  'actuator_gaintype',
  'actuator_biastype',
  'actuator_ctrllimited',
  'actuator_forcelimited',
  'actuator_ctrlrange',
  'actuator_forcerange',
  'actuator_trnid',
  'actuator_trntype',
  'actuator_damping',
  'actuator_dampingpoly',
  'actuator_delay',
  'actuator_armature',
];
const optionScalars = [
  'timestep',
  'integrator',
  'solver',
  'jacobian',
  'cone',
  'iterations',
  'tolerance',
  'ls_iterations',
  'ls_tolerance',
  'noslip_iterations',
  'noslip_tolerance',
  'impratio',
  'ccd_iterations',
  'ccd_tolerance',
  'disableflags',
  'enableflags',
  'density',
  'viscosity',
  'disableactuator',
];
export function readModel(model) {
  const r = { options: {} };
  for (const k of [
    'nq',
    'nv',
    'na',
    'nu',
    'nbody',
    'ngeom',
    'njnt',
    'ntree',
    'npair',
    'nkey',
    'nplugin',
    'nsensor',
    'neq',
    'nflex',
    'ntendon',
    'nmocap',
  ])
    r[k] = model[k];
  for (const k of modelArrays) r[k] = Array.from(model[k]);
  // opt is a borrowed reference. No delete and no model mutation.
  const option = model.opt;
  for (const k of optionScalars) r.options[k] = option[k];
  for (const k of ['gravity', 'wind']) r.options[k] = Array.from(option[k]);
  return r;
}
export function validateGeometryReadback(f, condition, r) {
  const tilt = condition.kind === 'tilt';
  const ids = worldIds(f, condition);
  const identityQuaternions = (n) => Array.from({ length: n }, () => [1, 0, 0, 0]).flat();
  const sizes = [
    ...f.bodies.floor.halfExtentsM,
    f.bodies.cylinder.radiusM,
    f.bodies.cylinder.heightM / 2,
    0,
  ];
  if (!tilt) sizes.push(...f.bodies.block.dimensionsM.map((v) => v / 2));
  const geomCount = tilt ? 2 : 3;
  demand(
    canonicalEqual(r.geom_size, sizes) &&
      canonicalEqual(r.geom_pos, [0, 0, -0.025, ...new Array(3 * (geomCount - 1)).fill(0)]) &&
      canonicalEqual(r.geom_quat, identityQuaternions(geomCount)) &&
      canonicalEqual(r.geom_bodyid, ids.geomBodies),
    'MODEL_GEOM_SIZE_FRAME',
  );
  const cylinderZ = f.bodies.cylinder.heightM / 2 + f.initialGapM;
  const bodyPositions = tilt
    ? [0, 0, 0, 0, 0, 0, 0, 0, cylinderZ]
    : [
        0,
        0,
        0,
        f.bodies.cylinder.restX,
        0,
        cylinderZ,
        f.bodies.block.restX,
        0,
        f.bodies.block.dimensionsM[2] / 2 + f.initialGapM,
      ];
  const inertialPositions = tilt ? [0, 0, 0, 0, 0, -0.025, 0, 0, 0] : new Array(9).fill(0);
  demand(
    canonicalEqual(r.body_parentid, [0, 0, 0]) &&
      canonicalEqual(r.body_pos, bodyPositions) &&
      canonicalEqual(r.body_quat, identityQuaternions(3)) &&
      canonicalEqual(r.body_ipos, inertialPositions) &&
      canonicalEqual(r.body_iquat, identityQuaternions(3)),
    'MODEL_BODY_TOPOLOGY_OR_FRAME',
  );
  demand(
    canonicalEqual(r.body_dofadr, tilt ? [-1, 0, 1] : [-1, 0, 6]) &&
      canonicalEqual(r.body_dofnum, tilt ? [0, 1, 6] : [0, 6, 6]) &&
      canonicalEqual(r.jnt_bodyid, [1, 2]) &&
      canonicalEqual(r.jnt_qposadr, tilt ? [0, 1] : [0, 7]) &&
      canonicalEqual(r.jnt_dofadr, tilt ? [0, 1] : [0, 6]) &&
      r.jnt_pos.every((v) => v === 0),
    'MODEL_FREE_BODY_DOF_LAYOUT',
  );
  return true;
}
export function validateModel(f, condition, r, initial) {
  const tilt = condition.kind === 'tilt';
  const ids = worldIds(f, condition);
  const s = f.solver;
  demand(finite(r) && finite(initial), 'NONFINITE_MODEL_READBACK');
  const expectedCounts = tilt
    ? { nq: 8, nv: 7, na: 0, nu: 1, nbody: 3, ngeom: 2, njnt: 2, ntree: 2, npair: 1 }
    : { nq: 14, nv: 12, na: 0, nu: 0, nbody: 3, ngeom: 3, njnt: 2, ntree: 2, npair: 2 };
  for (const [k, v] of Object.entries(expectedCounts)) demand(r[k] === v, 'MODEL_COUNT ' + k);
  validateGeometryReadback(f, condition, r);
  demand(
    r.nsensor === 0 &&
      r.nplugin === 0 &&
      ['neq', 'nflex', 'ntendon', 'nmocap'].every((key) => r[key] === 0) &&
      r.nkey === (condition.probe === 'A' ? 1 : 0),
    'MODEL_EXTRA_CAPABILITY',
  );
  const expectedOptions = {
    timestep: condition.dtUs / 1e6,
    integrator: 3,
    solver: 2,
    jacobian: 0,
    cone: 1,
    iterations: s.iterations,
    tolerance: s.tolerance,
    ls_iterations: s.lsIterations,
    ls_tolerance: s.lsTolerance,
    noslip_iterations: s.noSlipIterations,
    noslip_tolerance: s.noSlipTolerance,
    impratio: s.impratio,
    ccd_iterations: s.ccdIterations,
    ccd_tolerance: s.ccdTolerance,
    disableflags: 196608,
    enableflags: 32,
    density: 0,
    viscosity: 0,
    disableactuator: 0,
    gravity: f.gravity,
    wind: [0, 0, 0],
  };
  for (const [k, v] of Object.entries(expectedOptions))
    demand(canonicalEqual(r.options[k], v), 'MODEL_OPTION ' + k);
  for (const shape of ids.freeBodies) {
    demand(r.body_mass[shape.bodyId] === shape.mass, 'MODEL_MASS ' + shape.name);
    const inertia = r.body_inertia.slice(shape.bodyId * 3, shape.bodyId * 3 + 3);
    demand(
      inertia.every(
        (v, i) => Math.abs(v - shape.inertia[i]) <= 8 * Number.EPSILON * shape.inertia[i],
      ),
      'MODEL_INERTIA ' + shape.name,
    );
    demand(
      r.body_ipos.slice(shape.bodyId * 3, shape.bodyId * 3 + 3).every((v) => v === 0) &&
        canonicalEqual(r.body_iquat.slice(shape.bodyId * 4, shape.bodyId * 4 + 4), [1, 0, 0, 0]),
      'MODEL_COM_IDENTITY ' + shape.name,
    );
  }
  for (const k of [
    'body_gravcomp',
    'jnt_stiffness',
    'dof_damping',
    'dof_frictionloss',
    'dof_armature',
    'geom_margin',
    'geom_gap',
    'pair_margin',
    'pair_gap',
    'jnt_limited',
    'geom_adhesion',
    'geom_surfacevel',
    'pair_adhesion',
    'dof_dampingpoly',
    'actuator_damping',
    'actuator_dampingpoly',
    'actuator_delay',
    'actuator_armature',
  ])
    demand(
      r[k].every((v) => v === 0),
      'MODEL_FORBIDDEN_PASSIVE_OR_MARGIN ' + k,
    );
  demand(
    canonicalEqual(r.geom_bodyid, ids.geomBodies) &&
      canonicalEqual(r.jnt_type, tilt ? [3, 0] : [0, 0]) &&
      canonicalEqual(r.jnt_qposadr, tilt ? [0, 1] : [0, 7]) &&
      canonicalEqual(r.jnt_dofadr, tilt ? [0, 1] : [0, 6]),
    'MODEL_LAYOUT',
  );
  demand(
    canonicalEqual(r.geom_type, tilt ? [6, 5] : [6, 5, 6]) &&
      r.geom_condim.every((x) => x === 3) &&
      r.pair_dim.every((x) => x === 3),
    'MODEL_GEOM_TYPE_CONDIM',
  );
  for (let i = 0; i < r.ngeom; i += 1) {
    demand(
      canonicalEqual(r.geom_friction.slice(3 * i, 3 * i + 3), f.contact.geomFriction),
      'MODEL_GEOM_FRICTION',
    );
    demand(
      canonicalEqual(r.geom_solref.slice(2 * i, 2 * i + 2), f.contact.solref) &&
        canonicalEqual(r.geom_solimp.slice(5 * i, 5 * i + 5), f.contact.solimp),
      'MODEL_GEOM_SOFTNESS',
    );
  }
  for (let i = 0; i < r.npair; i += 1) {
    demand(r.pair_geom1[i] === 0 && r.pair_geom2[i] === i + 1, 'MODEL_EXPLICIT_PAIR');
    demand(
      canonicalEqual(r.pair_friction.slice(5 * i, 5 * i + 5), f.contact.pairFriction) &&
        canonicalEqual(r.pair_solref.slice(2 * i, 2 * i + 2), f.contact.solref) &&
        canonicalEqual(r.pair_solreffriction.slice(2 * i, 2 * i + 2), f.contact.solreffriction) &&
        canonicalEqual(r.pair_solimp.slice(5 * i, 5 * i + 5), f.contact.solimp),
      'MODEL_PAIR_PARAMETERS',
    );
  }
  demand(initial.time === 0, 'INITIAL_TIME');
  for (const shape of ids.freeBodies) {
    const p = initial.qpos.slice(shape.qposAdr, shape.qposAdr + 7);
    const expectedX = tilt
      ? 0
      : shape.name === 'cylinder'
        ? f.bodies.cylinder.restX
        : f.bodies.block.restX;
    const height = shape.kind === 'cylinder' ? shape.height : shape.dimensions[2];
    demand(
      canonicalEqual(p, [expectedX, 0, height / 2 + f.initialGapM, 1, 0, 0, 0]),
      'INITIAL_POSE',
    );
  }
  const a = f.admission.A;
  const v0 =
    condition.probe === 'A'
      ? [
          ...a.cylinderInitialLinearVelocity,
          ...a.cylinderInitialAngularVelocity,
          ...a.blockInitialLinearVelocity,
          ...a.blockInitialAngularVelocity,
        ]
      : new Array(r.nv).fill(0);
  demand(canonicalEqual(initial.qvel, v0), 'INITIAL_VELOCITY');
  if (tilt) {
    demand(
      initial.qpos[0] === 0 &&
        r.body_mass[1] === f.stand.massKg &&
        canonicalEqual(r.body_ipos.slice(3, 6), f.stand.com) &&
        canonicalEqual(r.body_inertia.slice(3, 6), f.stand.inertiaKgM2),
      'STAND_INERTIA_COM',
    );
    demand(
      canonicalEqual(r.jnt_axis.slice(0, 3), [0, 1, 0]) && r.jnt_pos.every((x) => x === 0),
      'STAND_HINGE',
    );
    demand(
      canonicalEqual(r.actuator_gear, [1, 0, 0, 0, 0, 0]) &&
        r.actuator_gainprm[0] === f.stand.kp &&
        r.actuator_gainprm.slice(1).every((x) => x === 0) &&
        canonicalEqual(r.actuator_biasprm.slice(0, 3), [0, -f.stand.kp, -f.stand.kv]) &&
        r.actuator_biasprm.slice(3).every((x) => x === 0) &&
        canonicalEqual(r.actuator_dyntype, [0]) &&
        canonicalEqual(r.actuator_gaintype, [0]) &&
        canonicalEqual(r.actuator_biastype, [1]) &&
        canonicalEqual(r.actuator_trntype, [0]) &&
        r.actuator_trnid[0] === 0 &&
        canonicalEqual(r.actuator_ctrllimited, [1]) &&
        canonicalEqual(r.actuator_forcelimited, [1]) &&
        canonicalEqual(r.actuator_ctrlrange, f.stand.ctrlRangeRad) &&
        canonicalEqual(r.actuator_forcerange, f.stand.forceRangeNm),
      'STAND_ACTUATOR_NATIVE_PARAMETERS',
    );
  }
  return ids;
}

function warningGuard(warnings, f) {
  demand(
    warnings.length === f.resources.warningCount && warnings.every((w) => w[0] === 0 && w[1] === 0),
    'NATIVE_WARNING_NONZERO',
  );
}
function zeroNativeForces(data) {
  for (const key of ['qfrc_applied', 'xfrc_applied', 'qfrc_passive', 'act'])
    demand(
      Array.from(data[key]).every((x) => x === 0),
      'UNREGISTERED_NATIVE_FORCE_OR_ACT ' + key,
    );
}
function parityRecord(forward, force) {
  return {
    pre: forward.state,
    bodies: forward.bodies,
    contacts: forward.contacts.map(contactIdentity),
    efcVel: forward.efcVel,
    efcType: forward.efcType,
    efcId: forward.efcId,
    solved: force.contacts,
    efcForce: force.efcForce,
    qfrcConstraint: force.qfrcConstraint,
    qfrcActuator: force.qfrcActuator,
    actuatorForce: force.actuatorForce,
    endpoint: force.endpoint,
    warnings: force.warnings,
  };
}
export function makeTickRecord({
  tick,
  dtUs,
  phase,
  control,
  forward,
  force,
  contact,
  torque,
  preTilt,
  postTilt,
  activeIterations,
}) {
  return {
    tick,
    intervalStartUs: (tick - 1) * dtUs,
    intervalEndUs: tick * dtUs,
    phase,
    control,
    parity: parityRecord(forward, force),
    contact,
    torque,
    preTilt,
    postTilt,
    nativeCounts: {
      ncon: forward.ncon,
      nefc: forward.nefc,
      nisland: force.islands,
      solverIterations: activeIterations,
    },
  };
}

class World {
  constructor(M, f, condition, total, journal) {
    this.M = M;
    this.f = f;
    this.c = condition;
    this.total = total;
    this.journal = journal;
    this.model = null;
    this.data = null;
    this.buffer = null;
    this.tick = 0;
    this.res = {
      temporaryCreated: 0,
      temporaryDeleted: 0,
      velocityCalls: 0,
      contactForceCalls: 0,
      step1Dispatched: 0,
      step1Returned: 0,
      advanceDispatched: 0,
      advanceReturned: 0,
      scheduleConfirmedAdvances: 0,
      endpointRefreshes: 0,
      preservedRefreshes: 0,
      warningObservations: 0,
    };
    this.limits = cylinderScenarioLimits(f, condition);
    this.retention = new TickRetention(
      journal,
      f,
      condition.id,
      condition.dtUs,
      f.retention.scenarioTickBytes[condition.kind],
    );
    this.parity = new StepChain();
    this.physical = new StepChain();
    this.lastObservation = null;
    this.summary = {
      id: condition.id,
      condition,
      status: 'STARTED',
      ticks: 0,
      modelCreationAttempted: false,
      modelCreated: false,
      dataCreated: false,
      peakSlipMps: {},
      cumulativeSlipM: {},
      rest: {},
      probeWitness: {},
      stages: [],
      event: null,
      maxima: {
        contacts: 0,
        rows: 0,
        islands: 0,
        solverIterations: 0,
        velocityError: 0,
        frameError: 0,
        forceAggregationError: 0,
        forceAggregationBudget: 0,
        nativeTorque: 0,
        effectiveTorque: 0,
      },
      nativeContactFrictionObserved: [],
      workDiagnosticJ: 0,
      resources: this.res,
    };
    this.stage = null;
    this.window = [];
    this.previousStableAngles = [];
  }
  create() {
    const { M, f, c, total } = this;
    const xml = makeCylinderXml(f, c);
    this.summary.xmlSha256 = sha256(xml);
    total.modelCreationDispatched += 1;
    this.summary.modelCreationAttempted = true;
    this.model = M.MjModel.from_xml_string(xml);
    demand(this.model, 'NATIVE_MODEL_CREATE_EMPTY');
    total.modelsCreated += 1;
    this.summary.modelCreated = true;
    total.maxConcurrentWorlds = Math.max(
      total.maxConcurrentWorlds,
      total.modelsCreated - total.modelsFreed,
    );
    demand(
      total.maxConcurrentWorlds <= total.allowedConcurrentWorlds,
      'RESOURCE_CONCURRENT_WORLDS',
    );
    total.dataCreationDispatched += 1;
    this.data = new M.MjData(this.model);
    total.dataCreated += 1;
    this.summary.dataCreated = true;
    if (c.probe === 'A') {
      M.mj_resetDataKeyframe(this.model, this.data, 0);
      total.keyframeResets += 1;
    }
    this.buffer = new M.DoubleBuffer(6);
    this.res.temporaryCreated += 1;
    demand(
      this.buffer.GetView() instanceof Float64Array && this.buffer.GetView().length === 6,
      'NATIVE_OUTPUT_BUFFER_SHAPE',
    );
    const readback = readModel(this.model);
    const initial = copyState(this.data);
    this.ids = validateModel(f, c, readback, initial);
    const warnings = copyWarnings(this.data, this.res);
    warningGuard(warnings, f);
    zeroNativeForces(this.data);
    this.summary.warningBaseline = warnings;
    this.summary.modelReadback = readback;
    this.journal.append({
      kind: 'world-initialization',
      world: c.id,
      condition: c,
      xml,
      readback,
      initial,
      warnings,
    });
    this.journal.checkpoint();
    for (const shape of this.ids.freeBodies) {
      this.summary.peakSlipMps[shape.name] = 0;
      this.summary.cumulativeSlipM[shape.name] = 0;
      this.summary.probeWitness[shape.name] = false;
    }
  }
  advance() {
    const { M, f, c, model, data, res, total } = this;
    const tickBefore = this.tick;
    const tick = tickBefore + 1;
    demand(
      tick <= c.maxSteps && total.advanceDispatched < total.allowedNativeSteps,
      'RESOURCE_NATIVE_STEP_BUDGET',
    );
    const control = controlAt(f, c, tickBefore);
    if (c.kind === 'tilt') data.ctrl[0] = control.u;
    const pre = copyState(data);
    this.lastObservation = { tick, phase: 'before-native', pre, control };
    let forward;
    if (c.phase === 'split') {
      res.step1Dispatched += 1;
      total.step1Dispatched += 1;
      M.mj_step1(model, data);
      res.step1Returned += 1;
      total.step1Returned += 1;
      demand(
        canonicalEqual(phaseState(pre), phaseState(copyState(data))),
        'STEP1_PHYSICAL_STATE_CHANGED',
      );
      forward = captureForward(M, model, data, pre, this.ids, res, this.buffer, this.limits);
      this.lastObservation = { tick, phase: 'before-step2', pre, control, forward };
      res.advanceDispatched += 1;
      total.advanceDispatched += 1;
      M.mj_step2(model, data);
    } else {
      res.advanceDispatched += 1;
      total.advanceDispatched += 1;
      M.mj_step(model, data);
    }
    res.advanceReturned += 1;
    total.advanceReturned += 1;
    this.tick = tick;
    this.summary.ticks = tick;
    this.lastObservation = {
      tick,
      phase: 'advance-returned',
      pre,
      control,
      endpoint: copyState(data),
    };
    // mj_step leaves forward position/velocity caches from n while qpos/qvel
    // are n+1. Reference captures them now and deliberately NEVER refreshes.
    if (c.phase === 'full')
      forward = captureForward(M, model, data, pre, this.ids, res, this.buffer, this.limits);
    const force = captureForces(M, model, data, forward, res, this.buffer, this.limits);
    this.lastObservation = {
      tick,
      phase: 'force-captured-before-refresh',
      forward,
      force,
      control,
    };
    demand(finite(force.endpoint), 'NONFINITE_ENDPOINT');
    warningGuard(force.warnings, f);
    res.warningObservations += 1;
    zeroNativeForces(data);
    const scheduled = (tick * c.dtUs) / 1e6;
    demand(
      force.endpoint.time > pre.time &&
        Math.abs(force.endpoint.time - scheduled) <= nativeTimeBudget(tick, c.dtUs),
      'NATIVE_TIME_ADVANCE_OR_DRIFT',
    );
    res.scheduleConfirmedAdvances += 1;
    total.scheduleConfirmedAdvances += 1;
    const activeIterations = force.solverIterations.slice(0, Math.max(1, force.islands));
    demand(
      activeIterations.every(
        (x) =>
          Number.isSafeInteger(x) && x >= 0 && x <= f.solver.maxCombinedSolverIterationsPerIsland,
      ),
      'SOLVER_COMBINED_MAIN_NOSLIP_ITERATION_CAP',
    );
    const thetaPre = c.kind === 'tilt' ? pre.qpos[0] : 0;
    const thetaPost = c.kind === 'tilt' ? force.endpoint.qpos[0] : 0;
    const omegaPre = c.kind === 'tilt' ? pre.qvel[0] : 0;
    const omegaPost = c.kind === 'tilt' ? force.endpoint.qvel[0] : 0;
    const floor = floorFrame(thetaPre);
    const observedFloor = forward.bodies[this.ids.floorBody];
    demand(
      Math.max(...observedFloor.rotation.map((x, i) => Math.abs(x - floor.rotation[i]))) <= 1e-12,
      'FLOOR_ANALYTIC_NATIVE_POSE',
    );
    const contact = assessContacts(f, forward, force, this.ids, floor);
    this.updateMaxima(forward, force, contact, activeIterations);
    let torque = null;
    if (c.kind === 'tilt') {
      torque = effectiveTorque(
        control.u,
        thetaPre,
        omegaPre,
        omegaPost,
        force.actuatorForce[0],
        f.stand,
      );
      torque.qfrcActuator = force.qfrcActuator[0];
      const allowance = f.stand.forceCapArithmeticAllowanceNm;
      demand(
        Math.abs(torque.nativeForce) <= 32 + allowance &&
          Math.abs(torque.effective) <= 32 + allowance,
        'STAND_NOT_QUALIFIED_FORCE_CAP',
      );
      demand(
        Math.abs(torque.nativeForce - torque.qfrcActuator) <= allowance &&
          force.qfrcActuator.slice(1).every((v) => v === 0),
        'STAND_ACTUATOR_GEAR_MAPPING',
      );
      demand(
        Math.abs(torque.effective - torque.endpointFormula) <= torque.algebraBudget,
        'STAND_EFFECTIVE_FORCE_ALGEBRA',
      );
      this.summary.maxima.nativeTorque = Math.max(
        this.summary.maxima.nativeTorque,
        Math.abs(torque.nativeForce),
      );
      this.summary.maxima.effectiveTorque = Math.max(
        this.summary.maxima.effectiveTorque,
        Math.abs(torque.effective),
      );
      this.summary.workDiagnosticJ +=
        ((c.dtUs / 1e6) * torque.effective * (omegaPre + omegaPost)) / 2;
    }
    const endpointBodies = Object.fromEntries(
      this.ids.freeBodies.map((shape) => [shape.name, bodyEndpoint(force.endpoint, shape)]),
    );
    if (c.phase === 'split') {
      const beforeRefresh = copyState(data);
      M.mj_kinematics(model, data);
      M.mj_comPos(model, data);
      M.mj_comVel(model, data);
      res.endpointRefreshes += 1;
      demand(
        canonicalEqual(beforeRefresh, copyState(data)),
        'ENDPOINT_REFRESH_CHANGED_PHYSICAL_STATE',
      );
      res.preservedRefreshes += 1;
      for (const shape of this.ids.freeBodies) {
        const nativePosition = Array.from(data.xipos).slice(3 * shape.bodyId, 3 * shape.bodyId + 3);
        const nativeRotation = Array.from(data.xmat).slice(9 * shape.bodyId, 9 * shape.bodyId + 9);
        const body = endpointBodies[shape.name];
        demand(
          norm(sub(nativePosition, body.com)) <= 1e-12 &&
            Math.max(...nativeRotation.map((v, i) => Math.abs(v - body.rotation[i]))) <= 1e-12,
          'ENDPOINT_COM0_FRAME_RECONSTRUCTION',
        );
        M.mj_objectVelocity(model, data, 1, shape.bodyId, this.buffer, 0);
        res.velocityCalls += 1;
        const v = Array.from(this.buffer.GetView());
        demand(
          norm(sub(v.slice(0, 3), body.omega)) <= 1e-12 &&
            norm(sub(v.slice(3), body.velocity)) <= 1e-12,
          'ENDPOINT_FREEJOINT_VELOCITY_FRAME',
        );
      }
    }
    const parity = parityRecord(forward, force);
    const parityDigest = this.parity.push(canonicalBytes(parity));
    this.physical.push(canonicalBytes(force.endpoint));
    const preTilt =
      c.kind === 'tilt'
        ? tiltState(forward.bodies[this.ids.freeBodies[0].bodyId], thetaPre, omegaPre, f)
        : null;
    const postTilt =
      c.kind === 'tilt' ? tiltState(endpointBodies.cylinder, thetaPost, omegaPost, f) : null;
    const phase = this.summary.event ? 'POST_EVENT_DIAGNOSTIC' : control.phase;
    const record = makeTickRecord({
      tick,
      dtUs: c.dtUs,
      phase,
      control,
      forward,
      force,
      contact,
      torque,
      preTilt,
      postTilt,
      endpointBodies,
      activeIterations,
    });
    this.lastObservation = record;
    // Retain failing observations as well as successful ticks. Physical guards
    // and integrals operate on every interval, never on sparse checkpoints.
    const retainedBytes = this.retention.prepare(record);
    this.evaluate(record, endpointBodies);
    this.pendingRetention = { record, bytes: retainedBytes };
    return { parityDigest, done: this.done() };
  }
  commitTick() {
    const { record, bytes } = this.pendingRetention;
    const { f, c } = this;
    const tick = this.tick;
    if ((tick * c.dtUs) % f.retention.compactCadenceUs === 0)
      this.journal.append({
        kind: 'checkpoint',
        world: c.id,
        tick,
        chain: this.retention.chain.checkpoint(),
        parity: this.parity.checkpoint(),
        physical: this.physical.checkpoint(),
        metrics: this.compact(),
      });
    this.retention.retain(record, bytes);
    this.pendingRetention = null;
  }
  updateMaxima(forward, force, contact, iterations) {
    const m = this.summary.maxima;
    m.contacts = Math.max(m.contacts, forward.ncon);
    m.rows = Math.max(m.rows, forward.nefc);
    m.islands = Math.max(m.islands, force.islands);
    m.solverIterations = Math.max(m.solverIterations, ...iterations);
    m.velocityError = Math.max(m.velocityError, contact.maxVelocityError);
    m.frameError = Math.max(m.frameError, contact.maxFrameError);
    m.forceAggregationError = Math.max(m.forceAggregationError, contact.maxForceAggregationError);
    m.forceAggregationBudget = Math.max(
      m.forceAggregationBudget,
      contact.maxForceAggregationBudget,
    );
    for (const c of force.contacts)
      if (!this.summary.nativeContactFrictionObserved.some((x) => canonicalEqual(x, c.friction)))
        this.summary.nativeContactFrictionObserved.push(c.friction);
  }
  evaluate(record, endpointBodies) {
    const { f, c } = this;
    const endUs = this.tick * c.dtUs;
    const startUs = endUs - c.dtUs;
    for (const shape of this.ids.freeBodies) {
      const body = record.contact.bodies[shape.name];
      if (body.loaded > 0 && body.maxSlip > 0 && body.outwardForce > 0 && body.supported)
        this.summary.probeWitness[shape.name] = true;
    }
    if (c.probe === 'A') return; // Intentional tangential slip is an observer probe.
    const settleUs = c.kind === 'static' ? f.rest.settleUs : f.tilt.settleUs;
    if (c.kind === 'tilt' && endUs > settleUs - f.tilt.stationaryWindowUs && endUs <= settleUs) {
      const body = record.contact.bodies.cylinder;
      this.window.push({
        tick: this.tick,
        pre: record.preTilt,
        post: record.postTilt,
        loaded: body.loaded > 0,
        positiveSupport: body.outwardForce > 0,
        supported: body.supported,
        downhillRim: body.downhillRim,
        noSlip: body.maxSlip <= f.contact.maxLoadedSlipSpeedMps,
      });
    }
    if (endUs === settleUs) {
      for (const shape of this.ids.freeBodies) {
        const body = endpointBodies[shape.name];
        const energy = bodyEnergy(body, shape, -f.gravity[2]);
        this.summary.rest[shape.name] = {
          baseline: body,
          minimumEnergyJ: energy,
          maxEnergyGrowthJ: 0,
          maxComDriftM: 0,
          maxQuaternionAngleRad: 0,
        };
      }
      if (c.kind === 'tilt') {
        const initialStable = assessWindow(this.window, f, c.dtUs, 0, 'stable');
        demand(initialStable.accepted, 'INDETERMINATE_INITIAL_SETTLE_NOT_STABLE');
        this.previousStableAngles = this.window.flatMap((r) => [r.pre.theta, r.post.theta]);
        this.summary.initialStable = initialStable;
      }
      this.journal.append({ kind: 'settle-boundary', world: c.id, tick: this.tick, record });
    }
    if (startUs < settleUs) return;
    const afterEvent = this.summary.event !== null;
    if (!afterEvent) {
      if (c.kind === 'tilt')
        demand(
          record.preTilt.uphillDirectionValid && record.postTilt.uphillDirectionValid,
          'UNKNOWN_DEGENERATE_UPHILL_RIM_DIRECTION',
        );
      for (const shape of this.ids.freeBodies) {
        const body = record.contact.bodies[shape.name];
        demand(
          body.loaded > 0 && body.outwardForce > 0,
          'UNKNOWN_MISSING_LOADED_OUTWARD_SUPPORT ' + shape.name,
        );
        demand(body.supported, 'UNKNOWN_SUPPORT_WITNESS_DOMAIN ' + shape.name);
        this.summary.peakSlipMps[shape.name] = Math.max(
          this.summary.peakSlipMps[shape.name],
          body.maxSlip,
        );
        this.summary.cumulativeSlipM[shape.name] += (c.dtUs / 1e6) * body.maxSlip;
        demand(
          this.summary.peakSlipMps[shape.name] <= f.contact.maxLoadedSlipSpeedMps &&
            this.summary.cumulativeSlipM[shape.name] <= f.contact.maxCumulativeSlipM,
          'NO_SLIP_GATE ' + shape.name,
        );
      }
    }
    if (c.kind === 'static') {
      for (const shape of this.ids.freeBodies) {
        const current = endpointBodies[shape.name];
        const metric = this.summary.rest[shape.name];
        const energy = bodyEnergy(current, shape, -f.gravity[2]);
        metric.minimumEnergyJ = Math.min(metric.minimumEnergyJ, energy);
        metric.maxEnergyGrowthJ = Math.max(metric.maxEnergyGrowthJ, energy - metric.minimumEnergyJ);
        metric.maxComDriftM = Math.max(
          metric.maxComDriftM,
          norm(sub(current.com, metric.baseline.com)),
        );
        metric.maxQuaternionAngleRad = Math.max(
          metric.maxQuaternionAngleRad,
          quaternionAngle(current.quaternion, metric.baseline.quaternion),
        );
        const energyBudget = f.rest.energyGrowth[shape.name + 'BudgetJ'];
        demand(
          metric.maxEnergyGrowthJ <= energyBudget &&
            metric.maxComDriftM <= f.rest.maxComDriftM &&
            metric.maxQuaternionAngleRad <= radians(f.rest.maxRelativeQuaternionAngleDeg),
          'REST_PHYSICAL_GATE ' + shape.name,
        );
      }
      return;
    }
    if (afterEvent) return;
    const rate = f.tilt.rates.find((r) => r.id === c.rate);
    const control = record.control;
    if (!this.stage || this.stage.index !== control.stage) {
      demand(!this.stage || this.stage.stable, 'INDETERMINATE_PREVIOUS_STAGE');
      this.stage = {
        index: control.stage,
        target: control.target,
        minAngle: Math.min(...this.previousStableAngles, record.preTilt.theta),
        maxAngle: Math.max(...this.previousStableAngles, record.preTilt.theta),
        maxTracking: 0,
        maxSpeed: 0,
        stable: null,
      };
      this.window = [];
      this.journal.append({
        kind: 'stage-start',
        world: c.id,
        tick: this.tick,
        stage: this.stage,
        record,
      });
    }
    const stage = this.stage;
    stage.minAngle = Math.min(stage.minAngle, record.preTilt.theta, record.postTilt.theta);
    stage.maxAngle = Math.max(stage.maxAngle, record.preTilt.theta, record.postTilt.theta);
    const endControl = controlAt(f, c, this.tick);
    // At a stage boundary the next stage begins at the same exact previous target.
    stage.maxTracking = Math.max(
      stage.maxTracking,
      Math.abs(record.preTilt.theta - control.u),
      Math.abs(record.postTilt.theta - endControl.u),
    );
    stage.maxSpeed = Math.max(
      stage.maxSpeed,
      Math.abs(record.preTilt.omega),
      Math.abs(record.postTilt.omega),
    );
    demand(stage.maxTracking <= radians(f.tilt.maxPreTipTrackingDeg), 'STAND_PRETIP_TRACKING');
    demand(stage.maxSpeed <= rate.maxActualSpeedRadps, 'STAND_PRETIP_SPEED');
    demand(
      stage.maxAngle - stage.minAngle <= radians(f.tilt.maxStageSpanDeg),
      'STAND_STAGE_ANGLE_SPAN',
    );
    const body = record.contact.bodies.cylinder;
    this.window.push({
      tick: this.tick,
      pre: record.preTilt,
      post: record.postTilt,
      loaded: body.loaded > 0,
      positiveSupport: body.outwardForce > 0,
      supported: body.supported,
      downhillRim: body.downhillRim,
      noSlip: body.maxSlip <= f.contact.maxLoadedSlipSpeedMps,
    });
    const count = f.tilt.stationaryWindowUs / c.dtUs;
    if (this.window.length > count) this.window.shift();
    const tip = assessWindow(this.window, f, c.dtUs, control.target, 'tip');
    if (tip.accepted) {
      const bracket = [stage.minAngle, stage.maxAngle];
      demand(
        bracket.every(
          (angle) =>
            Math.abs(angle - f.tilt.tip.criticalAngleRad) <=
            radians(f.tilt.tip.maxBracketDistanceDeg),
        ),
        'TIP_ANALYTIC_FULL_BRACKET',
      );
      this.summary.event = {
        type: 'firstConfirmed',
        targetIndex: control.stage,
        tick: this.tick,
        endpointTimeUs: endUs,
        actualAngleBracketRad: bracket,
        stageSpanRad: stage.maxAngle - stage.minAngle,
        window: tip,
        finishCurrentHoldAtUs: control.stageEndUs,
        state: record.postTilt,
      };
      this.summary.stages.push({ ...stage, result: 'TIP_CONFIRMED', eventTick: this.tick });
      this.retention.event(this.tick, this.summary.event, record);
      return;
    }
    if (endUs === control.stageEndUs) {
      const stable = assessWindow(this.window, f, c.dtUs, control.target, 'stable');
      demand(stable.accepted, 'INDETERMINATE_STAGE_END_NO_STABLE_OR_TIP');
      stage.stable = stable;
      this.previousStableAngles = this.window.flatMap((r) => [r.pre.theta, r.post.theta]);
      this.summary.stages.push({ ...stage, result: 'STABLE' });
      this.journal.append({ kind: 'stage-end', world: c.id, tick: this.tick, stage, record });
    }
  }
  compact() {
    return {
      tick: this.tick,
      peakSlipMps: this.summary.peakSlipMps,
      cumulativeSlipM: this.summary.cumulativeSlipM,
      rest: Object.fromEntries(
        Object.entries(this.summary.rest).map(([k, r]) => [
          k,
          {
            minimumEnergyJ: r.minimumEnergyJ,
            maxEnergyGrowthJ: r.maxEnergyGrowthJ,
            maxComDriftM: r.maxComDriftM,
            maxQuaternionAngleRad: r.maxQuaternionAngleRad,
          },
        ]),
      ),
      stage: this.stage,
      event: this.summary.event,
      maxima: this.summary.maxima,
      nativeCounts: { dispatched: this.res.advanceDispatched, returned: this.res.advanceReturned },
    };
  }
  done() {
    if (this.summary.event)
      return this.tick * this.c.dtUs >= this.summary.event.finishCurrentHoldAtUs;
    return this.tick >= this.c.maxSteps;
  }
  finish() {
    if (this.c.probe === 'A')
      demand(
        Object.values(this.summary.probeWitness).every(Boolean),
        'ADMISSION_A_MISSING_TANGENT_LOAD_WITNESS',
      );
    if (this.c.mode === 'main' && this.c.kind === 'tilt')
      demand(this.summary.event, 'NO_CONFIRMED_TIP_BY_36_DEGREES');
    this.summary.status = 'PASS';
    this.summary.rawChain = this.retention.chain.checkpoint();
    this.summary.parityChain = this.parity.checkpoint();
    this.summary.physicalChain = this.physical.checkpoint();
    this.journal.append({
      kind: 'world-complete',
      world: this.c.id,
      summary: this.summary,
      finalObservation: this.lastObservation,
    });
    this.journal.checkpoint();
    return this.summary;
  }
  fail(error) {
    this.summary.status = 'FAIL';
    this.summary.error = String(error);
    const partial = {
      tick: this.tick,
      dispatch: this.res.advanceDispatched,
      returned: this.res.advanceReturned,
      lastObservation: this.lastObservation,
      native: {},
      nativeReadErrors: [],
      unreturnedNativeAdvancePossible: this.res.advanceDispatched > this.res.advanceReturned,
    };
    if (this.data) {
      try {
        partial.native.state = copyState(this.data);
      } catch (e) {
        partial.nativeReadErrors.push(portableError(e));
      }
      try {
        partial.native.warnings = copyWarnings(this.data, this.res);
      } catch (e) {
        partial.nativeReadErrors.push(portableError(e));
      }
      for (const k of ['ncon', 'nefc', 'nisland'])
        try {
          partial.native[k] = this.data[k];
        } catch (e) {
          partial.nativeReadErrors.push(k + ': ' + portableError(e));
        }
    }
    this.summary.partial = partial;
    if (this.res.advanceReturned > this.retention.chain.count)
      this.retention.chain.push(canonicalBytes({ kind: 'partial-failed-tick', partial }));
    try {
      this.retention.failure(this.tick, partial, error);
    } catch (e) {
      this.summary.failureJournalError = String(e);
    }
    this.summary.rawChain = this.retention.chain.checkpoint();
    this.summary.parityChain = this.parity.checkpoint();
    this.summary.physicalChain = this.physical.checkpoint();
    return this.summary;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    for (const [key, counter] of [
      ['buffer', 'temporaryDeleted'],
      ['data', 'dataFreed'],
      ['model', 'modelsFreed'],
    ]) {
      if (!this[key]) continue;
      try {
        this[key].delete();
        if (key === 'buffer') this.res[counter] += 1;
        else this.total[counter] += 1;
      } catch (error) {
        errors.push(key + ': ' + String(error));
      }
      this[key] = null;
    }
    this.summary.cleanupErrors = errors;
    try {
      this.journal.append(
        {
          kind: 'world-cleanup',
          world: this.c.id,
          resources: this.res,
          modelsFreed: this.total.modelsFreed,
          dataFreed: this.total.dataFreed,
          errors: errors.map(portableError),
        },
        this.summary.status === 'FAIL',
      );
    } catch (error) {
      errors.push('cleanup-journal: ' + String(error));
    }
    if (errors.length || this.res.temporaryCreated !== this.res.temporaryDeleted)
      throw new Error(
        'RESOURCE_OWNED_WRAPPER_CLEANUP ' + JSON.stringify({ errors, resources: this.res }),
      );
  }
}

export function assessComparisons(f, summaries, mode) {
  const comparisons = [];
  if (mode === 'admission') return comparisons;
  for (const kind of ['static', 'tilt'])
    for (const dtUs of f.nativeStepUs) {
      const rates = kind === 'static' ? [null] : f.tilt.rates.map((r) => r.id);
      for (const rate of rates) {
        const group = summaries.filter(
          (s) =>
            s.condition.kind === kind && s.condition.dtUs === dtUs && s.condition.rate === rate,
        );
        demand(
          group.length === 2 && group.every((s) => s.status === 'PASS'),
          'REPEAT_GROUP_INCOMPLETE',
        );
        demand(
          canonicalEqual(group[0].physicalChain, group[1].physicalChain) &&
            canonicalEqual(group[0].parityChain, group[1].parityChain),
          'EXACT_REPEATABILITY',
        );
        comparisons.push({ kind: 'exact-repeat', worlds: group.map((s) => s.id), verdict: 'PASS' });
      }
    }
  const tips = summaries.filter((s) => s.condition.kind === 'tilt');
  for (let i = 0; i < tips.length; i += 1)
    for (let j = i + 1; j < tips.length; j += 1) {
      const difference = Math.abs(tips[i].event.targetIndex - tips[j].event.targetIndex);
      demand(
        difference <= f.tilt.tip.maxRateDtFirstTargetIndexDifference,
        'TIP_RATE_DT_TARGET_DIFFERENCE',
      );
      comparisons.push({
        kind: 'tip-target-index',
        worlds: [tips[i].id, tips[j].id],
        difference,
        verdict: 'PASS',
      });
    }
  return comparisons;
}

/** Called only by the explicit preregistration-checked CLI. Importing this file
 * never creates a module, model, data, world, or native step. */
export async function executeCylinder(f, mode, journal) {
  validateCylinderFixture(f);
  const plan = cylinderPlan(f, mode);
  cylinderRetentionProof(f);
  const b = f.budgets[mode];
  const total = {
    allowedWorlds: b.worlds,
    allowedNativeSteps: b.nativeSteps ?? b.maxNativeSteps,
    allowedConcurrentWorlds: b.maxConcurrentWorlds,
    maxConcurrentWorlds: 0,
    moduleInitializationDispatched: 0,
    moduleInitializations: 0,
    modelCreationDispatched: 0,
    modelsCreated: 0,
    modelsFreed: 0,
    dataCreationDispatched: 0,
    dataCreated: 0,
    dataFreed: 0,
    keyframeResets: 0,
    step1Dispatched: 0,
    step1Returned: 0,
    advanceDispatched: 0,
    advanceReturned: 0,
    scheduleConfirmedAdvances: 0,
  };
  const report = {
    mode,
    budget: total,
    worlds: [],
    comparisons: [],
    assessment: { verdict: 'FAIL', failures: [] },
  };
  const live = [];
  try {
    const artifact = verifyCylinderArtifacts(f);
    const { default: initialize } = await import(
      pathToFileURL(resolve(artifact.packageRoot, 'mujoco.js')).href
    );
    total.moduleInitializationDispatched += 1;
    const M = await initialize({
      wasmBinary: readFileSync(resolve(artifact.packageRoot, 'mujoco.wasm')),
    });
    total.moduleInitializations += 1;
    demand(
      M.mj_versionString() === f.engine.version && M.mj_version() === 4000000,
      'NATIVE_ENGINE_VERSION',
    );
    report.engine = {
      version: M.mj_versionString(),
      moduleSha256: artifact.moduleSha256,
      wasmSha256: artifact.wasmSha256,
      singleThread: true,
      explicitLocalWasm: true,
    };
    const groupSize = mode === 'admission' ? 2 : 1;
    for (let i = 0; i < plan.length; i += groupSize) {
      live.length = 0;
      for (const condition of plan.slice(i, i + groupSize)) {
        demand(total.modelCreationDispatched < total.allowedWorlds, 'RESOURCE_WORLD_BUDGET');
        const world = new World(M, f, condition, total, journal);
        live.push(world);
        world.create();
      }
      let done = false;
      while (!done) {
        const results = live.map((w) => w.advance());
        if (groupSize === 2)
          demand(
            results[0].parityDigest === results[1].parityDigest,
            'ADMISSION_SPLIT_REFRESH_FULL_NO_REFRESH_EXACT_PARITY',
          );
        for (const world of live) world.commitTick();
        done = results.every((r) => r.done);
        demand(
          results.every((r) => r.done === done),
          'ADMISSION_PAIRED_DURATION',
        );
      }
      if (groupSize === 2)
        report.comparisons.push({
          kind: 'phase-refresh-exact-parity',
          worlds: live.map((w) => w.c.id),
          nativeIntervals: live[0].tick,
          verdict: 'PASS',
        });
      for (const world of live) {
        const summary = world.finish();
        world.dispose();
        report.worlds.push(summary);
      }
      live.length = 0;
    }
    report.comparisons.push(...assessComparisons(f, report.worlds, mode));
    demand(
      total.modelsCreated === total.allowedWorlds &&
        total.modelsFreed === total.modelsCreated &&
        total.dataCreated === total.dataFreed &&
        total.advanceDispatched === total.advanceReturned,
      'INVOCATION_RESOURCE_ACCOUNTING',
    );
    if (mode === 'admission')
      demand(total.advanceReturned === b.nativeSteps, 'ADMISSION_EXACT_STEP_COUNT');
    report.assessment.verdict = 'PASS';
  } catch (error) {
    report.assessment.failures.push(String(error));
    for (const world of live) {
      if (!report.worlds.some((x) => x.id === world.c.id)) report.worlds.push(world.fail(error));
    }
  } finally {
    for (const world of live) {
      try {
        world.dispose();
      } catch (error) {
        report.assessment.verdict = 'FAIL';
        report.assessment.failures.push(String(error));
      }
    }
  }
  report.worldDisposition = {
    planned: plan.map((p) => ({ id: p.id, maxNativeAdvances: p.maxSteps })),
    creationAttempted: report.worlds.filter((w) => w.modelCreationAttempted).map((w) => w.id),
    created: report.worlds.filter((w) => w.modelCreated).map((w) => w.id),
    notCreated: plan
      .filter((p) => !report.worlds.some((w) => w.id === p.id && w.modelCreated))
      .map((p) => p.id),
    noReturnedNativeAdvance: plan
      .filter((p) => !report.worlds.some((w) => w.id === p.id && w.ticks > 0))
      .map((p) => p.id),
    undispatchedNativeAdvances: total.allowedNativeSteps - total.advanceDispatched,
  };
  report.completeTrajectoryDigest = digest(
    canonicalBytes(
      report.worlds.map((w) => ({
        id: w.id,
        status: w.status,
        ticks: w.ticks,
        rawChain: w.rawChain ?? null,
        parityChain: w.parityChain ?? null,
        physicalChain: w.physicalChain ?? null,
        event: w.event,
        peakSlipMps: w.peakSlipMps,
        cumulativeSlipM: w.cumulativeSlipM,
      })),
    ),
  );
  return report;
}

/** Float64 words are authoritative. JSON's spelling cannot preserve signed zero. */
export function float64Words(values) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString('hex');
}
export function decodeFloat64Words(hex, count, label) {
  demand(
    typeof hex === 'string' && hex.length === count * 16 && /^[0-9a-f]+$/.test(hex),
    'GEOMETRY_INPUT_FLOAT64_WORDS ' + label,
  );
  const bytes = Buffer.from(hex, 'hex');
  const values = Array.from({ length: count }, (_, i) => bytes.readDoubleLE(i * 8));
  demand(finite(values), 'GEOMETRY_INPUT_NONFINITE ' + label);
  return values;
}

/** Pure decoder accepts an explicit binding so synthetic unit inputs stay labelled.
 * The native entry point always supplies the immutable fixture binding. */
export function decodeRetainedGeometryInput(bytes, binding) {
  demand(
    Buffer.isBuffer(bytes) &&
      bytes.length === binding.inputBytes &&
      digest(bytes) === binding.inputSha256,
    'GEOMETRY_INPUT_IDENTITY',
  );
  const input = JSON.parse(bytes.toString('utf8'));
  demand(
    input.schema === binding.inputSchema &&
      input.world === binding.world &&
      input.count === binding.poseCount &&
      input.first === binding.firstTick &&
      input.last === binding.lastTick &&
      Array.isArray(input.records) &&
      input.records.length === binding.poseCount &&
      binding.lastTick - binding.firstTick + 1 === binding.poseCount,
    'GEOMETRY_INPUT_SHAPE',
  );
  const poses = input.records.map((record, i) => {
    demand(
      record.tick === binding.firstTick + i && record.intervalStartUs === (record.tick - 1) * 500,
      'GEOMETRY_INPUT_ORDER_OR_TIME',
    );
    demand(
      record.preState &&
        record.preStateFloat64LE &&
        canonicalEqual(Object.keys(record.preState).sort(), ['qpos', 'qvel', 'time']) &&
        canonicalEqual(Object.keys(record.preStateFloat64LE).sort(), ['qpos', 'qvel', 'time']),
      'GEOMETRY_INPUT_PRE_FIELDS',
    );
    demand(
      Number.isSafeInteger(record.recordBytes) &&
        record.recordBytes > 0 &&
        /^[0-9a-f]{64}$/.test(record.recordSha256),
      'GEOMETRY_INPUT_RECORD_IDENTITY',
    );
    const qpos = decodeFloat64Words(record.preStateFloat64LE.qpos, 8, 'qpos');
    const qvel = decodeFloat64Words(record.preStateFloat64LE.qvel, 7, 'qvel');
    const [time] = decodeFloat64Words(record.preStateFloat64LE.time, 1, 'time');
    demand(
      Array.isArray(record.preState.qpos) &&
        record.preState.qpos.length === 8 &&
        Array.isArray(record.preState.qvel) &&
        record.preState.qvel.length === 7 &&
        qpos.every((v, j) => v === record.preState.qpos[j]) &&
        qvel.every((v, j) => v === record.preState.qvel[j]) &&
        time === record.preState.time,
      'GEOMETRY_INPUT_JSON_WORD_MISMATCH',
    );
    return {
      tick: record.tick,
      intervalStartUs: record.intervalStartUs,
      sourceRecordSha256: record.recordSha256,
      qpos,
      time,
      words: { qpos: record.preStateFloat64LE.qpos, time: record.preStateFloat64LE.time },
    };
  });
  return { inputSha256: binding.inputSha256, poses };
}

export function geometryStateWords(data) {
  demand(data.qpos instanceof Float64Array && data.qpos.length === 8, 'GEOMETRY_QPOS_SHAPE');
  return { qpos: float64Words(Array.from(data.qpos)), time: float64Words([data.time]) };
}

export function assessCylinderGeometry(f, qpos, observation) {
  demand(qpos.length === 8 && finite(qpos) && finite(observation), 'GEOMETRY_NONFINITE');
  demand(
    observation.ncon >= 1 &&
      observation.ncon <= 5 &&
      observation.nefc <= 15 &&
      observation.nisland <= 2,
    'GEOMETRY_NATIVE_BOUNDS',
  );
  const floor = floorFrame(qpos[0]);
  const cylR = quaternionMatrix(qpos.slice(4));
  const com = qpos.slice(1, 4);
  const identity = quaternionMatrix([1, 0, 0, 0]);
  const floorCom = rotate(floor.rotation, f.stand.com);
  const expected = {
    xpos: [0, 0, 0, 0, 0, 0, ...com],
    xipos: [0, 0, 0, ...floorCom, ...com],
    xmat: [...identity, ...floor.rotation, ...cylR],
    xquat: [1, 0, 0, 0, Math.cos(qpos[0] / 2), 0, Math.sin(qpos[0] / 2), 0, ...qpos.slice(4)],
    geom_xpos: [...rotate(floor.rotation, [0, 0, f.bodies.floor.fixedCenterZ]), ...com],
    geom_xmat: [...floor.rotation, ...cylR],
  };
  let maxPoseError = 0;
  for (const [key, values] of Object.entries(expected)) {
    const actual = observation.poses[key];
    demand(Array.isArray(actual) && actual.length === values.length, 'GEOMETRY_POSE_SHAPE ' + key);
    const error = Math.max(...values.map((v, i) => Math.abs(v - actual[i])));
    maxPoseError = Math.max(maxPoseError, error);
    demand(error <= 1e-12, 'GEOMETRY_ORIGINAL_POSE_RECONSTRUCTION ' + key);
  }
  warningGuard(observation.warnings, f);
  const shape = worldIds(f, { kind: 'tilt' }).freeBodies[0];
  const body = {
    com: observation.poses.xipos.slice(6, 9),
    rotation: observation.poses.xmat.slice(18, 27),
  };
  const usedRows = new Set();
  const candidates = observation.contacts.map((c, i) => {
    demand(
      c.index === i &&
        c.dim === 3 &&
        ((c.geom[0] === 0 && c.geom[1] === 1) || (c.geom[0] === 1 && c.geom[1] === 0)) &&
        c.geom1 === c.geom[0] &&
        c.geom2 === c.geom[1],
      'GEOMETRY_PAIR_OR_DIM',
    );
    demand(
      c.dist < 0 && c.exclude === 0 && c.includemargin === 0,
      'GEOMETRY_STRICT_PENETRATION_ONLY',
    );
    demand(frameError(c.frame) <= f.contact.frameOrthonormalTolerance, 'GEOMETRY_CONTACT_FRAME');
    demand(
      canonicalEqual(c.friction, f.contact.effectiveFriction) &&
        canonicalEqual(c.solref, f.contact.solref) &&
        canonicalEqual(c.solreffriction, f.contact.solreffriction) &&
        canonicalEqual(c.solimp, f.contact.solimp) &&
        c.adhesion === 0 &&
        c.surfacevel.every((v) => v === 0) &&
        ['flex', 'elem', 'vert'].every((key) => c[key].every((v) => v === -1)),
      'GEOMETRY_EFFECTIVE_CONTACT_PARAMETERS',
    );
    demand(
      Number.isSafeInteger(c.efc_address) &&
        c.efc_address >= 0 &&
        c.efc_address + 3 <= observation.nefc,
      'GEOMETRY_CONTACT_ROWS',
    );
    for (let j = 0; j < 3; j += 1) {
      const row = c.efc_address + j;
      demand(
        !usedRows.has(row) && observation.efcType[row] === 7 && observation.efcId[row] === i,
        'GEOMETRY_UNREGISTERED_CONSTRAINT_ROW',
      );
      usedRows.add(row);
    }
    // Legacy perturbations do not prove unperturbed witnesses. Check the
    // original-pose support candidates verbatim with the unchanged domain.
    const candidate = supportWitness(c, 1, body, floor, shape, f);
    demand(candidate.supported, 'GEOMETRY_SUPPORT_CANDIDATE_OUTSIDE_DOMAIN');
    return candidate;
  });
  demand(
    observation.contacts.length === observation.ncon &&
      usedRows.size === observation.nefc &&
      observation.efcType.length === observation.nefc &&
      observation.efcId.length === observation.nefc,
    'GEOMETRY_EXTRA_CONSTRAINT_ROWS',
  );
  return { maxPoseError, candidates };
}

export function geometryJournalRetention(f) {
  return {
    schema: f.geometryOnly.schema,
    numericEncoding: f.retention.numericEncoding,
    recordFraming: f.retention.recordFraming,
    strings: f.retention.strings,
    perTick: 'all401 saved-pose position observations; no velocity, force or trajectory claim',
    maxJournalBytes: f.geometryOnly.maxJournalBytes,
    reservedFailureTrailerBytes: f.geometryOnly.maxFinalTrailerBytes + 4,
  };
}

export function createGeometryReport(f) {
  return {
    schema: f.geometryOnly.schema,
    profile: f.candidateProfile.id,
    status: 'RUNNING',
    assessment: { verdict: 'NOT_RUN', failures: [] },
    unqualified: [...f.geometryOnly.unqualified],
    inputSha256: f.geometryOnly.inputSha256,
    counts: {
      nativeImportsDispatched: 0,
      nativeImportsReturned: 0,
      factoriesDispatched: 0,
      factoriesReturned: 0,
      modelCreationDispatched: 0,
      modelsCreated: 0,
      modelDeletionDispatched: 0,
      modelsFreed: 0,
      dataCreationDispatched: 0,
      dataCreated: 0,
      dataDeletionDispatched: 0,
      dataFreed: 0,
      positionDispatched: 0,
      positionReturned: 0,
      poseRecordsAppended: 0,
      retainedPoseRecords: 0,
      otherDirectMjCalls: 0,
      nativeAdvances: 0,
      resets: 0,
      doubleBuffers: 0,
    },
    resources: {
      temporaryCreated: 0,
      temporaryDeleted: 0,
      contactVectorsCreated: 0,
      contactGetsCreated: 0,
      warningGetsCreated: 0,
      warningObservations: 0,
      cleanupErrors: [],
    },
    maxContacts: 0,
    maxRows: 0,
    maxIslands: 0,
    maxPoseRecordBytes: 0,
    lastObservation: null,
    failures: [],
  };
}

function geometryFailure(report, stage, error) {
  report.failures.push({ stage, classification: portableError(error), error: String(error) });
}

/** Pure injectable session: M must be supplied; this function cannot import or
 * initialize an engine. The explicit CLI is the only real native entry point. */
export function runCylinderGeometrySession(
  M,
  f,
  input,
  journal,
  report = createGeometryReport(f),
  now = () => performance.now(),
  started = now(),
) {
  const g = f.geometryOnly;
  const counts = report.counts;
  const resources = report.resources;
  const condition = cylinderPlan(f, 'main').find((c) => c.id === g.world);
  const limits = {
    ...cylinderScenarioLimits(f, condition),
    nbody: 3,
    ngeom: 2,
    maxContactVectors: g.maxContactVectors,
    maxContactGets: g.maxContactGets,
    maxWarningGets: g.maxWarningGets,
    maxWarningObservations: g.maxWarningObservations,
  };
  let model = null;
  let data = null;
  let stage = 'input';
  const wallGuard = () =>
    demand(now() - started <= g.wallTimeoutSeconds * 1000, 'GEOMETRY_WALL_TIMEOUT');
  try {
    demand(
      input.inputSha256 === g.inputSha256 && input.poses.length === g.poseCount,
      'GEOMETRY_SESSION_INPUT_BINDING',
    );
    demand(
      counts.positionDispatched === 0 &&
        counts.modelCreationDispatched === 0 &&
        counts.dataCreationDispatched === 0,
      'GEOMETRY_SESSION_ALREADY_STARTED',
    );
    wallGuard();
    const xml = makeCylinderXml(f, condition);
    report.xmlSha256 = digest(xml);
    stage = 'model-create';
    counts.modelCreationDispatched += 1;
    model = M.MjModel.from_xml_string(xml);
    demand(model, 'NATIVE_MODEL_CREATE_EMPTY');
    counts.modelsCreated += 1;
    stage = 'data-create';
    counts.dataCreationDispatched += 1;
    data = new M.MjData(model);
    demand(data, 'NATIVE_DATA_CREATE_EMPTY');
    counts.dataCreated += 1;
    stage = 'initial-readback';
    for (const [key, value] of Object.entries({
      nq: 8,
      nv: 7,
      na: 0,
      nu: 1,
      nbody: 3,
      ngeom: 2,
      njnt: 2,
      ntree: 2,
      npair: 1,
      nkey: 0,
      nplugin: 0,
      nsensor: 0,
      neq: 0,
      nflex: 0,
      ntendon: 0,
      nmocap: 0,
    }))
      demand(model[key] === value, 'GEOMETRY_INITIAL_MODEL_COUNT ' + key);
    const readback = readModel(model);
    const initial = {
      time: data.time,
      qpos: boundedNativeArray(data.qpos, 8, 'qpos', true),
      qvel: boundedNativeArray(data.qvel, 7, 'qvel', true),
    };
    validateModel(f, condition, readback, initial);
    const factoryInputs = {};
    for (const [key, length] of Object.entries({
      qfrc_applied: 7,
      xfrc_applied: 18,
      act: 0,
      ctrl: 1,
      mocap_pos: 0,
      mocap_quat: 0,
    })) {
      factoryInputs[key] = boundedNativeArray(data[key], length, key, true);
      demand(
        factoryInputs[key].every((v) => v === 0),
        'GEOMETRY_FACTORY_NONZERO ' + key,
      );
    }
    const baselineWarnings = copyGeometryWarnings(data, resources, limits);
    warningGuard(baselineWarnings, f);
    const initialization = {
      kind: 'geometry-initialization',
      xmlSha256: report.xmlSha256,
      profile: f.candidateProfile.id,
      inputSha256: input.inputSha256,
      readback,
      initial,
      factoryInputs,
      warnings: baselineWarnings,
      restoredFields: g.restoredFields,
      absentPreFields: g.absentPreFields,
      unqualified: g.unqualified,
    };
    demand(
      canonicalBytes(initialization).length <= g.maxInitializationBytes,
      'GEOMETRY_INITIALIZATION_BYTE_CAP',
    );
    journal.append(initialization);
    journal.checkpoint();
    wallGuard();
    for (let i = 0; i < input.poses.length; i += 1) {
      const pose = input.poses[i];
      stage = 'restore-pose';
      report.lastObservation = {
        index: i,
        tick: pose.tick,
        stage,
        sourceRecordSha256: pose.sourceRecordSha256,
        expectedWords: pose.words,
      };
      demand(
        pose.tick === g.firstTick + i &&
          pose.qpos.length === 8 &&
          finite(pose.qpos) &&
          Number.isFinite(pose.time) &&
          canonicalEqual(
            { qpos: float64Words(pose.qpos), time: float64Words([pose.time]) },
            pose.words,
          ),
        'GEOMETRY_SESSION_POSE_ORDER_OR_WORDS',
      );
      wallGuard();
      demand(
        counts.positionDispatched < g.maxPositionCalls &&
          counts.positionDispatched === counts.positionReturned,
        'GEOMETRY_POSITION_DISPATCH_BUDGET',
      );
      data.qpos.set(pose.qpos);
      data.time = pose.time;
      const before = geometryStateWords(data);
      demand(canonicalEqual(before, pose.words), 'GEOMETRY_RESTORE_WORDS');
      report.lastObservation.before = before;
      stage = 'position-dispatch';
      report.lastObservation.stage = stage;
      counts.positionDispatched += 1;
      M.mj_fwdPosition(model, data);
      counts.positionReturned += 1;
      stage = 'position-readback';
      report.lastObservation.stage = stage;
      const after = geometryStateWords(data);
      report.lastObservation.after = after;
      demand(canonicalEqual(before, after), 'GEOMETRY_QPOS_OR_TIME_MUTATION');
      wallGuard();
      const observation = captureGeometry(data, resources, limits);
      report.lastObservation.observation = observation;
      const geometry = assessCylinderGeometry(f, pose.qpos, observation);
      report.lastObservation.geometry = geometry;
      const record = {
        kind: 'geometry-pose',
        index: i,
        tick: pose.tick,
        intervalStartUs: pose.intervalStartUs,
        sourceRecordSha256: pose.sourceRecordSha256,
        before,
        after,
        observation,
        geometry,
        positionDispatched: counts.positionDispatched,
        positionReturned: counts.positionReturned,
      };
      const recordBytes = canonicalBytes(record).length;
      demand(recordBytes <= g.maxPoseRecordBytes, 'GEOMETRY_POSE_RECORD_BYTE_CAP');
      report.maxPoseRecordBytes = Math.max(report.maxPoseRecordBytes, recordBytes);
      stage = 'pose-journal-write';
      report.lastObservation.stage = stage;
      journal.append(record);
      counts.poseRecordsAppended += 1;
      journal.checkpoint();
      counts.retainedPoseRecords += 1;
      report.maxContacts = Math.max(report.maxContacts, observation.ncon);
      report.maxRows = Math.max(report.maxRows, observation.nefc);
      report.maxIslands = Math.max(report.maxIslands, observation.nisland);
      wallGuard();
    }
    stage = 'complete-counts';
    demand(
      counts.positionDispatched === g.poseCount &&
        counts.positionReturned === g.poseCount &&
        counts.retainedPoseRecords === g.poseCount &&
        counts.poseRecordsAppended === g.poseCount,
      'GEOMETRY_INCOMPLETE_401',
    );
  } catch (error) {
    geometryFailure(report, stage, error);
    if (data) {
      try {
        report.partialStateWords = geometryStateWords(data);
      } catch (readError) {
        geometryFailure(report, 'partial-state-read', readError);
      }
      try {
        report.partialNativeCounts = { ncon: data.ncon, nefc: data.nefc, nisland: data.nisland };
      } catch (readError) {
        geometryFailure(report, 'partial-count-read', readError);
      }
    }
  } finally {
    for (const [label, value] of [
      ['data', data],
      ['model', model],
    ]) {
      if (!value) continue;
      const dispatched = label === 'data' ? 'dataDeletionDispatched' : 'modelDeletionDispatched';
      const freed = label === 'data' ? 'dataFreed' : 'modelsFreed';
      counts[dispatched] += 1;
      try {
        value.delete();
        counts[freed] += 1;
      } catch (error) {
        geometryFailure(report, label + '-cleanup', error);
      }
    }
  }
  if (
    resources.temporaryCreated !== resources.temporaryDeleted ||
    resources.temporaryCreated > g.maxOwnedWrappers ||
    resources.cleanupErrors.length ||
    counts.modelsCreated !== counts.modelsFreed ||
    counts.dataCreated !== counts.dataFreed
  )
    geometryFailure(report, 'ownership', new Error('GEOMETRY_OWNERSHIP_NOT_BALANCED'));
  report.elapsedMs = now() - started;
  if (report.elapsedMs > g.wallTimeoutSeconds * 1000)
    geometryFailure(report, 'wall', new Error('GEOMETRY_WALL_TIMEOUT'));
  report.status = report.failures.length ? 'FAILED' : 'OBSERVATIONS_COMPLETE';
  report.assessment = {
    verdict: report.failures.length ? 'FAIL' : 'PENDING_DURABLE_FINALIZATION',
    failures: report.failures.map((v) => v.classification),
  };
  return report;
}

/** Native import/factory occur only after CLI's external review/preregistration
 * validation. No mj_version, warmup, reset, force, velocity or stepping call. */
export async function executeCylinderGeometry(f, inputBytes, journal) {
  validateCylinderFixture(f);
  const input = decodeRetainedGeometryInput(inputBytes, f.geometryOnly);
  const report = createGeometryReport(f);
  const started = performance.now();
  try {
    const artifact = verifyCylinderArtifacts(f);
    report.counts.nativeImportsDispatched += 1;
    const { default: initialize } = await import(
      pathToFileURL(resolve(artifact.packageRoot, 'mujoco.js')).href
    );
    report.counts.nativeImportsReturned += 1;
    report.counts.factoriesDispatched += 1;
    const M = await initialize({
      wasmBinary: readFileSync(resolve(artifact.packageRoot, 'mujoco.wasm')),
    });
    report.counts.factoriesReturned += 1;
    runCylinderGeometrySession(M, f, input, journal, report, () => performance.now(), started);
  } catch (error) {
    geometryFailure(report, 'native-import-or-factory', error);
    report.status = 'FAILED';
    report.assessment = { verdict: 'FAIL', failures: report.failures.map((v) => v.classification) };
  }
  return report;
}

/** Admission verdict is possible only after observed raw fsync/close succeeds. */
export function finalizeCylinderGeometry(f, report, journal) {
  const c = report.counts;
  if (
    report.status === 'OBSERVATIONS_COMPLETE' &&
    !(
      c.nativeImportsDispatched === 1 &&
      c.nativeImportsReturned === 1 &&
      c.factoriesDispatched === 1 &&
      c.factoriesReturned === 1 &&
      c.modelCreationDispatched === 1 &&
      c.modelsCreated === 1 &&
      c.modelsFreed === 1 &&
      c.dataCreationDispatched === 1 &&
      c.dataCreated === 1 &&
      c.dataFreed === 1 &&
      c.positionDispatched === 401 &&
      c.positionReturned === 401 &&
      c.retainedPoseRecords === 401 &&
      c.otherDirectMjCalls === 0 &&
      c.nativeAdvances === 0
    )
  )
    geometryFailure(report, 'final-native-budget', new Error('GEOMETRY_FINAL_NATIVE_BUDGET'));
  const eligible = report.status === 'OBSERVATIONS_COMPLETE' && report.failures.length === 0;
  const trailer = {
    kind: 'geometry-final',
    status: report.status,
    counts: report.counts,
    resources: report.resources,
    lastObservation: report.lastObservation,
    failures: report.failures,
    verdict: eligible ? 'PENDING_DURABLE_FINALIZATION' : 'FAIL',
  };
  if (canonicalBytes(trailer).length > f.geometryOnly.maxFinalTrailerBytes) {
    geometryFailure(report, 'trailer-size', new Error('GEOMETRY_TRAILER_BYTE_CAP'));
    // Close the existing prefix; do not enlarge a cap or retry a native call.
    report.journal = journal.finish({
      kind: 'geometry-final',
      verdict: 'FAIL',
      reason: 'GEOMETRY_TRAILER_BYTE_CAP',
      counts: report.counts,
      fullTrailerBytes: canonicalBytes(trailer).length,
      fullTrailerSha256: digest(canonicalBytes(trailer)),
    });
  } else report.journal = journal.finish(trailer);
  if (report.journal.trailerError || report.journal.closeError)
    geometryFailure(report, 'journal-finalization', new Error('GEOMETRY_JOURNAL_FINALIZATION'));
  report.status = report.failures.length ? 'FAILED' : 'COMPLETED';
  report.assessment = {
    verdict: eligible && report.failures.length === 0 ? f.geometryOnly.verdict : 'FAIL',
    failures: report.failures.map((v) => v.classification),
  };
  demand(
    Buffer.byteLength(JSON.stringify(report), 'utf8') <= f.geometryOnly.maxSummaryBytes,
    'GEOMETRY_SUMMARY_BYTE_CAP',
  );
  return report;
}
