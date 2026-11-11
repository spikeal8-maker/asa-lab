import { readFileSync } from 'node:fs';
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
  gamma,
  dot,
  add,
  sub,
  norm,
  scale,
  rotate,
  unrotate,
  radians,
  frameError,
  contactWorldForce,
  relativePointVelocity,
  quaternionAngle,
  copyState,
  phaseState,
  copyWarnings,
  captureForward,
  captureForces,
  nativeBodyKinematics,
  TickRetention,
  StepChain,
} from './mujoco-contact-observer.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixturePath = 'tests/robotics/field-core-qualification/mujoco-mechanism.fixture.json';
const fixtureContractSha256 = 'c970f6b4d75630bb3c01fc865fceb644be395e912b64f7780c2a0f8fe9367b1e';
export const mechanismSourcePaths = [
  'tools/robotics-field-core/mujoco-mechanism.mjs',
  'tools/robotics-field-core/run-mujoco-mechanism.mjs',
  fixturePath,
  'tests/robotics/field-core-qualification/mujoco-mechanism.spec.ts',
];
const equalNumbers = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const identityQuaternion = [1, 0, 0, 0];
const nativeKinds = { body: 1, joint: 3, geom: 5, actuator: 19 };
const limitType = 3;
const frictionlessContactType = 5;

export function readMechanismFixture() {
  const bytes = readFileSync(resolve(root, fixturePath));
  return { fixture: JSON.parse(bytes.toString('utf8')), fixtureSha256: sha256(bytes) };
}
export function validateMechanismFixture(f) {
  demand(f && sha256(JSON.stringify(f)) === fixtureContractSha256, 'MECHANISM_CONTRACT_MISMATCH');
  for (const dt of f.nativeStepUs) {
    demand(
      Number.isSafeInteger(dt) &&
        dt > 0 &&
        f.macroStepUs % dt === 0 &&
        [
          f.stationary.windowUs,
          f.retention.compactCadenceUs,
          f.retention.preWindowUs,
          f.retention.postWindowUs,
          ...f.cases.map((c) => c.durationUs),
          ...f.cases[0].drivenPhases.flatMap((p) => [p.startUs, p.endUs]),
        ].every((t) => Number.isSafeInteger(t) && t % dt === 0),
      'MECHANISM_INTEGER_SCHEDULE',
    );
  }
  demand(
    f.retention.maxRingTicks * f.retention.maxTickBytes === f.retention.maxMainRingBytes &&
      f.retention.reservedFailureTrailerBytes >=
        f.retention.maxRingTicks *
          (f.retention.maxTickBytes + f.retention.emergencyRecordOverheadBytes) +
          f.retention.maxFailureObservationBytes +
          f.retention.emergencyTrailerBytes,
    'MECHANISM_RETENTION_RESERVE',
  );
  return f;
}
export function mechanismSourceManifest() {
  const { fixture: f } = readMechanismFixture();
  return {
    newInputs: Object.fromEntries(
      mechanismSourcePaths.map((p) => [p, sha256(readFileSync(resolve(root, p)))]),
    ),
    observer: { [f.parent.observer]: sha256(readFileSync(resolve(root, f.parent.observer))) },
    immutableParents: parentManifest(),
    specification: {
      [f.specification.path]: sha256(readFileSync(resolve(root, f.specification.path))),
    },
    parentExecution: 'Artifact/hash/time helpers only; no PHY01 or cylinder physics is rerun.',
  };
}
export function verifyMechanismArtifacts(f) {
  validateMechanismFixture(f);
  const { fixture: parent } = readParentFixture();
  demand(
    parent.engine.package === f.engine.package &&
      parent.engine.version === f.engine.version &&
      parent.engine.moduleSha256 === f.engine.moduleSha256 &&
      parent.engine.wasmSha256 === f.engine.wasmSha256 &&
      parentManifest()['tools/robotics-field-core/mujoco-phy01.mjs'] ===
        f.parent.phy01SourceSha256 &&
      sha256(readFileSync(resolve(root, f.parent.observer))) === f.parent.observerSourceSha256,
    'MECHANISM_PARENT_IDENTITY',
  );
  return verifyEngineArtifacts(parent);
}
export function mechanismPlan(f) {
  validateMechanismFixture(f);
  const plan = [];
  for (const scenario of f.cases)
    for (const dtUs of f.nativeStepUs)
      for (let repeat = 1; repeat <= scenario.repeats; repeat += 1)
        plan.push({
          id: scenario.id + '-' + dtUs + '-r' + repeat,
          case: scenario.id,
          dtUs,
          repeat,
          durationUs: scenario.durationUs,
          maxSteps: scenario.durationUs / dtUs,
          phase: 'split',
          articulated: scenario.id === 'A' || scenario.id === 'D',
          wall: scenario.id === 'B',
        });
  demand(
    plan.length === f.budget.worlds &&
      plan.reduce((s, p) => s + p.maxSteps, 0) === f.budget.nativeSteps &&
      Math.max(...plan.map((p) => p.maxSteps)) === f.budget.maxStepsPerWorld,
    'MECHANISM_PLAN_BUDGET',
  );
  return plan;
}
const attr = (name, value) =>
  name + '="' + (Array.isArray(value) ? value.join(' ') : String(value)) + '"';
export function makeMechanismXml(f, condition) {
  demand(
    mechanismPlan(f).some((p) => canonicalEqual(p, condition)),
    'MECHANISM_UNPLANNED_WORLD',
  );
  const s = f.solver;
  const xml = [
    '<mujoco model="asa_mujoco_mechanism">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false" fusestatic="false"/>',
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
    '<flag warmstart="enable" island="enable" refsafe="enable" nativeccd="enable" multiccd="enable" ' +
      'diagexact="enable" autoreset="disable" sleep="disable" override="disable" fwdinv="disable" ' +
      'invdiscrete="disable" energy="disable" ipc="disable" speculative="disable"/>',
    '</option>',
    '<default><joint damping="0" frictionloss="0" armature="0" stiffness="0" limited="false" ' +
      'actuatorfrclimited="false" actuatorgravcomp="false"/>' +
      '<geom condim="3" friction="0 0 0" margin="0" gap="0" ' +
      attr('solref', f.contact.solref) +
      ' ' +
      attr('solimp', f.contact.solimp) +
      '/></default>',
    '<worldbody>',
  ];
  if (condition.wall)
    xml.push(
      '<geom name="wall" type="box" ' +
        attr('pos', f.wall.centerM) +
        ' ' +
        attr('size', f.wall.halfExtentsM) +
        '/>',
    );
  for (let i = 0; i < 3; i += 1) {
    xml.push(
      '<body ' +
        attr('name', f.bodies.linkNames[i]) +
        ' ' +
        attr('pos', i === 0 ? f.bodies.rootOriginM : f.bodies.childOffsetM) +
        ' gravcomp="0">',
    );
    if (condition.articulated || i === 2)
      xml.push(
        '<joint ' +
          attr('name', f.bodies.jointNames[i]) +
          ' type="hinge" pos="0 0 0" ' +
          attr('axis', f.bodies.axis) +
          ' limited="true" margin="0" ' +
          attr('range', f.joint.rangeRad) +
          ' ' +
          attr('solreflimit', f.joint.solref) +
          ' ' +
          attr('solimplimit', f.joint.solimp) +
          '/>',
      );
    xml.push(
      '<inertial ' +
        attr('pos', f.bodies.comLocalM) +
        ' ' +
        attr('mass', f.bodies.massKg) +
        ' ' +
        attr('diaginertia', f.bodies.inertiaKgM2) +
        '/>',
      '<geom ' +
        attr('name', f.bodies.linkNames[i] + '_geom') +
        ' type="box" ' +
        attr('pos', f.bodies.comLocalM) +
        ' ' +
        attr('size', f.bodies.halfExtentsM) +
        '/>',
    );
  }
  xml.push('</body></body></body>', '</worldbody>', '<contact>');
  for (const [a, b] of f.bodies.selfCollisionExcludes)
    xml.push('<exclude ' + attr('body1', a) + ' ' + attr('body2', b) + '/>');
  if (condition.wall)
    xml.push(
      '<pair name="wall_L3" geom1="wall" geom2="L3_geom" ' +
        [
          attr('condim', 1),
          attr('friction', f.contact.pairFriction),
          attr('solref', f.contact.solref),
          attr('solreffriction', f.contact.solreffriction),
          attr('solimp', f.contact.solimp),
          attr('margin', 0),
          attr('gap', 0),
        ].join(' ') +
        '/>',
    );
  xml.push('</contact>', '<actuator>');
  for (let i = 0; i < 3; i += 1)
    if (condition.articulated || i === 2)
      xml.push(
        '<motor ' +
          attr('name', f.bodies.actuatorNames[i]) +
          ' ' +
          attr('joint', f.bodies.jointNames[i]) +
          ' gear="1" ctrllimited="true" forcelimited="true" ' +
          attr('ctrlrange', f.motor.ctrlRangeNm) +
          ' ' +
          attr('forcerange', f.motor.forceRangeNm) +
          '/>',
      );
  xml.push('</actuator>', '</mujoco>');
  return xml.join('\n') + '\n';
}

export function controlAt(f, condition, tickBefore, state, joints) {
  demand(
    Number.isSafeInteger(tickBefore) && tickBefore >= 0 && tickBefore < condition.maxSteps,
    'CONTROL_INTEGER_TICK',
  );
  demand(finite(state), 'CONTROL_NONFINITE_STATE');
  const scenario = f.cases.find((c) => c.id === condition.case);
  const timeUs = tickBefore * condition.dtUs;
  const driven = scenario.drivenPhases?.find((p) => timeUs >= p.startUs && timeUs < p.endUs);
  const off = scenario.driveOffFromUs !== undefined && timeUs >= scenario.driveOffFromUs;
  const target = driven?.targetRad ?? scenario.targetRad ?? 0;
  return {
    intervalStartUs: timeUs,
    phase: off
      ? 'DRIVE_OFF'
      : driven
        ? driven.limitSide > 0
          ? 'DRIVE_UPPER'
          : 'DRIVE_LOWER'
        : 'DRIVE_UPPER',
    targetRad: off ? null : target,
    off,
    raw: joints.map((j) =>
      off
        ? 0
        : f.motor.kpNmPerRad * (target - state.qpos[j.qposAdr]) -
          f.motor.kdNmsPerRad * state.qvel[j.dofAdr],
    ),
  };
}

const modelArrays = [
  'qpos0',
  'body_mass',
  'body_inertia',
  'body_ipos',
  'body_iquat',
  'body_gravcomp',
  'body_parentid',
  'body_weldid',
  'body_dofadr',
  'body_dofnum',
  'body_jntnum',
  'body_pos',
  'body_quat',
  'geom_bodyid',
  'geom_type',
  'geom_size',
  'geom_pos',
  'geom_quat',
  'geom_friction',
  'geom_condim',
  'geom_contype',
  'geom_conaffinity',
  'geom_margin',
  'geom_gap',
  'geom_solref',
  'geom_solimp',
  'geom_adhesion',
  'geom_surfacevel',
  'exclude_signature',
  'pair_adhesion',
  'jnt_type',
  'jnt_bodyid',
  'jnt_qposadr',
  'jnt_dofadr',
  'jnt_pos',
  'jnt_axis',
  'jnt_limited',
  'jnt_range',
  'jnt_margin',
  'jnt_solref',
  'jnt_solimp',
  'jnt_stiffness',
  'jnt_actfrclimited',
  'jnt_actfrcrange',
  'jnt_actgravcomp',
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
export function readMechanismModel(model) {
  const r = { options: {} };
  for (const key of [
    'nq',
    'nv',
    'na',
    'nu',
    'nbody',
    'ngeom',
    'njnt',
    'ntree',
    'npair',
    'nexclude',
    'nkey',
    'nplugin',
    'nsensor',
    'neq',
    'ntendon',
  ])
    r[key] = model[key];
  for (const key of modelArrays) r[key] = Array.from(model[key]);
  const option = model.opt; // Borrowed native embedded reference.
  for (const key of optionScalars) r.options[key] = option[key];
  for (const key of ['gravity', 'wind']) r.options[key] = Array.from(option[key]);
  return r;
}
export function resolveMechanismIds(M, model, condition) {
  const lookup = (type, name) => {
    const id = M.mj_name2id(model, nativeKinds[type], name);
    demand(
      Number.isInteger(id) && id >= 0 && M.mj_id2name(model, nativeKinds[type], id) === name,
      'NATIVE_NAMED_ID ' + name,
    );
    return id;
  };
  const links = [1, 2, 3].map((index) => ({
    name: 'L' + index,
    index,
    bodyId: lookup('body', 'L' + index),
    geomId: lookup('geom', 'L' + index + '_geom'),
  }));
  const joints = (condition.articulated ? [1, 2, 3] : [3]).map((index) => {
    const id = lookup('joint', 'J' + index);
    return {
      name: 'J' + index,
      index,
      jointId: id,
      bodyId: links[index - 1].bodyId,
      qposAdr: model.jnt_qposadr[id],
      dofAdr: model.jnt_dofadr[id],
      actuatorId: lookup('actuator', 'M' + index),
    };
  });
  if (!condition.articulated)
    for (const name of ['J1', 'J2'])
      demand(
        M.mj_name2id(model, nativeKinds.joint, name) === -1,
        'WELDED_DIAGNOSTIC_HAS_UPSTREAM_JOINT',
      );
  return {
    links,
    joints,
    bodyIds: [0, ...links.map((l) => l.bodyId)],
    wallGeom: condition.wall ? lookup('geom', 'wall') : null,
  };
}
export function validateMechanismModel(f, condition, r, ids, initial) {
  demand(finite(r) && finite(initial), 'NONFINITE_MODEL_READBACK');
  const n = condition.articulated ? 3 : 1;
  const expectedCounts = {
    nq: n,
    nv: n,
    na: 0,
    nu: n,
    nbody: 4,
    ngeom: condition.wall ? 4 : 3,
    njnt: n,
    ntree: 1,
    npair: condition.wall ? 1 : 0,
    nexclude: 2,
    nkey: 0,
    nplugin: 0,
    nsensor: 0,
    neq: 0,
    ntendon: 0,
  };
  for (const [key, value] of Object.entries(expectedCounts))
    demand(r[key] === value, 'MODEL_COUNT ' + key);
  const s = f.solver;
  const options = {
    timestep: condition.dtUs / 1e6,
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
    gravity: f.gravity,
    wind: [0, 0, 0],
  };
  for (const [key, value] of Object.entries(options))
    demand(canonicalEqual(r.options[key], value), 'MODEL_OPTION ' + key);
  demand(
    equalNumbers(
      ids.links.map((l) => l.bodyId),
      [1, 2, 3],
    ) &&
      equalNumbers(r.body_parentid, [0, 0, 1, 2]) &&
      equalNumbers(r.body_weldid, condition.articulated ? [0, 1, 2, 3] : [0, 0, 0, 3]) &&
      equalNumbers(r.body_dofnum, condition.articulated ? [0, 1, 1, 1] : [0, 0, 0, 1]) &&
      equalNumbers(r.body_jntnum, condition.articulated ? [0, 1, 1, 1] : [0, 0, 0, 1]) &&
      equalNumbers(r.body_dofadr, condition.articulated ? [-1, 0, 1, 2] : [-1, -1, -1, 0]),
    'MODEL_ARTICULATED_OR_WELDED_TOPOLOGY',
  );
  demand(equalNumbers(r.exclude_signature, [65538, 131075]), 'MODEL_ADJACENT_COLLISION_EXCLUSIONS');
  for (const link of ids.links) {
    const b = link.bodyId;
    const g = link.geomId;
    demand(
      r.body_mass[b] === f.bodies.massKg &&
        r.body_inertia
          .slice(3 * b, 3 * b + 3)
          .every(
            (v, i) =>
              Math.abs(v - f.bodies.inertiaKgM2[i]) <= 8 * Number.EPSILON * f.bodies.inertiaKgM2[i],
          ),
      'MODEL_EXPLICIT_MASS_INERTIA ' + link.name,
    );
    for (const [key, width, expected] of [
      ['body_pos', 3, link.index === 1 ? f.bodies.rootOriginM : f.bodies.childOffsetM],
      ['body_quat', 4, identityQuaternion],
      ['body_ipos', 3, f.bodies.comLocalM],
      ['body_iquat', 4, identityQuaternion],
    ])
      demand(
        equalNumbers(r[key].slice(width * b, width * (b + 1)), expected),
        'MODEL_BODY_FRAME ' + key,
      );
    demand(
      r.geom_bodyid[g] === b &&
        r.geom_type[g] === 6 &&
        equalNumbers(r.geom_size.slice(3 * g, 3 * g + 3), f.bodies.halfExtentsM) &&
        equalNumbers(r.geom_pos.slice(3 * g, 3 * g + 3), f.bodies.comLocalM) &&
        equalNumbers(r.geom_quat.slice(4 * g, 4 * g + 4), identityQuaternion),
      'MODEL_LINK_GEOMETRY',
    );
  }
  for (let g = 0; g < r.ngeom; g += 1)
    demand(
      r.geom_condim[g] === 3 &&
        r.geom_contype[g] === 1 &&
        r.geom_conaffinity[g] === 1 &&
        equalNumbers(r.geom_friction.slice(3 * g, 3 * g + 3), f.contact.geomFriction) &&
        equalNumbers(r.geom_solref.slice(2 * g, 2 * g + 2), f.contact.solref) &&
        equalNumbers(r.geom_solimp.slice(5 * g, 5 * g + 5), f.contact.solimp),
      'MODEL_GEOM_CONTACT_PARAMETERS',
    );
  for (const joint of ids.joints) {
    const j = joint.jointId;
    const a = joint.actuatorId;
    demand(
      r.jnt_type[j] === 3 &&
        r.jnt_bodyid[j] === joint.bodyId &&
        r.jnt_limited[j] === 1 &&
        r.jnt_qposadr[j] === joint.qposAdr &&
        r.jnt_dofadr[j] === joint.dofAdr &&
        equalNumbers(r.jnt_axis.slice(j * 3, j * 3 + 3), f.bodies.axis) &&
        equalNumbers(r.jnt_pos.slice(j * 3, j * 3 + 3), [0, 0, 0]) &&
        equalNumbers(r.jnt_range.slice(j * 2, j * 2 + 2), f.joint.rangeRad) &&
        equalNumbers(r.jnt_solref.slice(j * 2, j * 2 + 2), f.joint.solref) &&
        equalNumbers(r.jnt_solimp.slice(j * 5, j * 5 + 5), f.joint.solimp),
      'MODEL_HINGE_LIMIT ' + joint.name,
    );
    demand(
      r.actuator_dyntype[a] === 0 &&
        r.actuator_gaintype[a] === 0 &&
        r.actuator_biastype[a] === 0 &&
        r.actuator_trntype[a] === 0 &&
        r.actuator_trnid[2 * a] === j &&
        r.actuator_trnid[2 * a + 1] === -1 &&
        r.actuator_ctrllimited[a] === 1 &&
        r.actuator_forcelimited[a] === 1 &&
        equalNumbers(r.actuator_gear.slice(6 * a, 6 * a + 6), [1, 0, 0, 0, 0, 0]) &&
        equalNumbers(
          r.actuator_gainprm.slice(10 * a, 10 * a + 10),
          [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ) &&
        r.actuator_biasprm.slice(10 * a, 10 * a + 10).every((v) => v === 0) &&
        equalNumbers(r.actuator_ctrlrange.slice(2 * a, 2 * a + 2), f.motor.ctrlRangeNm) &&
        equalNumbers(r.actuator_forcerange.slice(2 * a, 2 * a + 2), f.motor.forceRangeNm),
      'MODEL_NATIVE_TORQUE_MOTOR ' + joint.name,
    );
  }
  for (const key of [
    'body_gravcomp',
    'jnt_stiffness',
    'jnt_margin',
    'jnt_actfrclimited',
    'jnt_actfrcrange',
    'jnt_actgravcomp',
    'dof_damping',
    'dof_dampingpoly',
    'dof_frictionloss',
    'dof_armature',
    'geom_margin',
    'geom_gap',
    'pair_margin',
    'pair_gap',
    'geom_adhesion',
    'geom_surfacevel',
    'pair_adhesion',
    'actuator_damping',
    'actuator_dampingpoly',
    'actuator_delay',
    'actuator_armature',
  ])
    demand(
      r[key].every((v) => v === 0),
      'MODEL_UNREGISTERED_PASSIVE ' + key,
    );
  if (condition.wall) {
    const g = ids.wallGeom;
    demand(
      r.geom_bodyid[g] === 0 &&
        r.geom_type[g] === 6 &&
        equalNumbers(r.geom_pos.slice(g * 3, g * 3 + 3), f.wall.centerM) &&
        equalNumbers(r.geom_size.slice(g * 3, g * 3 + 3), f.wall.halfExtentsM) &&
        equalNumbers(r.geom_quat.slice(g * 4, g * 4 + 4), identityQuaternion) &&
        equalNumbers(r.pair_dim, [1]) &&
        equalNumbers(r.pair_geom1, [g]) &&
        equalNumbers(r.pair_geom2, [ids.links[2].geomId]) &&
        equalNumbers(r.pair_friction, f.contact.pairFriction) &&
        equalNumbers(r.pair_solref, f.contact.solref) &&
        equalNumbers(r.pair_solimp, f.contact.solimp) &&
        equalNumbers(r.pair_solreffriction, f.contact.solreffriction),
      'MODEL_FRICTIONLESS_WALL_PAIR',
    );
  }
  demand(
    initial.time === 0 &&
      initial.qpos.length === n &&
      initial.qvel.length === n &&
      [initial.qpos, initial.qvel, r.qpos0].every((a) => a.every((v) => v === 0)),
    'MODEL_INITIAL_REST',
  );
  demand(
    new Set(ids.joints.map((j) => j.qposAdr)).size === n &&
      new Set(ids.joints.map((j) => j.dofAdr)).size === n &&
      ids.joints.every((j) => j.qposAdr >= 0 && j.qposAdr < n && j.dofAdr >= 0 && j.dofAdr < n),
    'MODEL_NATIVE_COORDINATE_ADDRESSES',
  );
  return true;
}

function readFrames(data) {
  return {
    positions: Array.from(data.xpos),
    anchors: Array.from(data.xanchor),
    axes: Array.from(data.xaxis),
    geomPositions: Array.from(data.geom_xpos),
    geomRotations: Array.from(data.geom_xmat),
  };
}
/** Diagnostic geometry from actual native frames; never a state update. */
export function projectedBoxMaxY(com, rotation, halfExtents) {
  return (
    com[1] +
    Math.abs(rotation[3]) * halfExtents[0] +
    Math.abs(rotation[4]) * halfExtents[1] +
    Math.abs(rotation[5]) * halfExtents[2]
  );
}
export function assessMechanismEndpoint(f, ids, state, bodies, frames) {
  demand(finite({ state, bodies, frames }), 'MECHANISM_NONFINITE_ENDPOINT');
  demand(
    state.qpos.length === ids.joints.length && state.qvel.length === ids.joints.length,
    'MECHANISM_ENDPOINT_LAYOUT',
  );
  const delta = radians(f.joint.maximumOvershootDeg);
  for (const joint of ids.joints) {
    const q = state.qpos[joint.qposAdr];
    demand(
      q >= f.joint.rangeRad[0] - delta && q <= f.joint.rangeRad[1] + delta,
      'MECHANISM_ANGLE_OVERSHOOT ' + joint.name,
    );
  }
  const anchors = [];
  let maxFrameError = 0;
  for (const link of ids.links) {
    const b = bodies[link.bodyId];
    const origin = frames.positions.slice(3 * link.bodyId, 3 * link.bodyId + 3);
    const parent = link.index === 1 ? null : ids.links[link.index - 2];
    const expected = parent
      ? add(
          frames.positions.slice(3 * parent.bodyId, 3 * parent.bodyId + 3),
          rotate(bodies[parent.bodyId].rotation, f.bodies.childOffsetM),
        )
      : f.bodies.rootOriginM;
    let error = norm(sub(origin, expected));
    const joint = ids.joints.find((j) => j.bodyId === link.bodyId);
    if (joint) {
      const anchor = frames.anchors.slice(3 * joint.jointId, 3 * joint.jointId + 3);
      error = Math.max(error, norm(sub(anchor, origin)), norm(sub(anchor, expected)));
      const axis = frames.axes.slice(3 * joint.jointId, 3 * joint.jointId + 3);
      maxFrameError = Math.max(maxFrameError, norm(sub(axis, rotate(b.rotation, f.bodies.axis))));
    }
    const geomCom = frames.geomPositions.slice(3 * link.geomId, 3 * link.geomId + 3);
    const geomRotation = frames.geomRotations.slice(9 * link.geomId, 9 * link.geomId + 9);
    maxFrameError = Math.max(
      maxFrameError,
      frameError(b.rotation),
      norm(sub(b.com, add(origin, rotate(b.rotation, f.bodies.comLocalM)))),
      norm(sub(geomCom, b.com)),
      Math.max(...geomRotation.map((v, i) => Math.abs(v - b.rotation[i]))),
    );
    anchors.push({ link: link.name, joint: joint?.name ?? null, welded: !joint, errorM: error });
  }
  const maxAnchorErrorM = Math.max(...anchors.map((a) => a.errorM));
  demand(maxAnchorErrorM <= f.joint.maxAnchorErrorM, 'MECHANISM_ANCHOR_GATE');
  demand(maxFrameError <= f.joint.axisFrameTolerance, 'MECHANISM_BODY_COM_GEOM_AXIS_FRAME');
  const l3 = ids.links[2];
  return {
    anchors,
    maxAnchorErrorM,
    maxFrameError,
    l3MaxYM: projectedBoxMaxY(
      frames.geomPositions.slice(l3.geomId * 3, l3.geomId * 3 + 3),
      frames.geomRotations.slice(l3.geomId * 9, l3.geomId * 9 + 9),
      f.bodies.halfExtentsM,
    ),
  };
}
export function mechanismEnergy(f, ids, bodies) {
  let kineticJ = 0;
  let potentialJ = 0;
  for (const link of ids.links) {
    const body = bodies[link.bodyId];
    const omegaLocal = unrotate(body.rotation, body.omega);
    kineticJ +=
      0.5 * f.bodies.massKg * dot(body.velocity, body.velocity) +
      0.5 * omegaLocal.reduce((s, w, i) => s + f.bodies.inertiaKgM2[i] * w * w, 0);
    potentialJ += f.bodies.massKg * -f.gravity[2] * (body.com[2] - f.bodies.rootOriginM[2]);
  }
  return { kineticJ, potentialJ, mechanicalJ: kineticJ + potentialJ };
}
export function assessMechanismActuation(f, ids, pre, post, control, forward, force, dtUs) {
  const n = ids.joints.length;
  demand(
    control.raw.length === n &&
      force.actuatorForce.length === n &&
      force.qfrcActuator.length === n &&
      forward.actuatorLength.length === n &&
      forward.actuatorVelocity.length === n &&
      finite({ control, force }),
    'ACTUATION_LAYOUT_OR_NONFINITE',
  );
  const motors = [];
  let coordinateWorkJ = 0;
  let midpointWorkJ = 0;
  let prePowerW = 0;
  for (let i = 0; i < n; i += 1) {
    const j = ids.joints[i];
    const raw = control.raw[i];
    const torque = force.actuatorForce[j.actuatorId];
    const expected = Math.max(
      f.motor.forceRangeNm[0],
      Math.min(
        f.motor.forceRangeNm[1],
        Math.max(f.motor.ctrlRangeNm[0], Math.min(f.motor.ctrlRangeNm[1], raw)),
      ),
    );
    const arithmetic =
      f.motor.arithmeticRelativeFactor *
      Number.EPSILON *
      Math.max(0.08, Math.abs(raw), Math.abs(expected));
    // This exact cap has no arithmetic enlargement. The separate allowance
    // checks only algebra/mapping against the already bounded native force.
    demand(
      torque >= f.motor.forceRangeNm[0] && torque <= f.motor.forceRangeNm[1],
      'NATIVE_MOTOR_TORQUE_CAP',
    );
    demand(
      Math.abs(torque - expected) <= arithmetic &&
        Math.abs(force.qfrcActuator[j.dofAdr] - torque) <= arithmetic,
      'NATIVE_MOTOR_FORCE_MAPPING',
    );
    demand(
      Math.abs(forward.actuatorLength[j.actuatorId] - pre.qpos[j.qposAdr]) <=
        f.motor.arithmeticRelativeFactor *
          Number.EPSILON *
          Math.max(1, Math.abs(pre.qpos[j.qposAdr])) &&
        Math.abs(forward.actuatorVelocity[j.actuatorId] - pre.qvel[j.dofAdr]) <=
          f.motor.arithmeticRelativeFactor *
            Number.EPSILON *
            Math.max(1, Math.abs(pre.qvel[j.dofAdr])),
      'NATIVE_MOTOR_GEAR_ONE_KINEMATICS',
    );
    if (control.off)
      demand(torque === 0 && force.qfrcActuator[j.dofAdr] === 0, 'DRIVE_OFF_NONZERO_TORQUE');
    const dq = post.qpos[j.qposAdr] - pre.qpos[j.qposAdr];
    const work = torque * dq;
    const midpoint = ((dtUs / 1e6) * torque * (pre.qvel[j.dofAdr] + post.qvel[j.dofAdr])) / 2;
    coordinateWorkJ += work;
    midpointWorkJ += midpoint;
    prePowerW += torque * pre.qvel[j.dofAdr];
    motors.push({
      joint: j.name,
      raw,
      nativeTorqueNm: torque,
      expectedNativeTorqueNm: expected,
      qfrcActuatorNm: force.qfrcActuator[j.dofAdr],
      coordinateWorkJ: work,
      midpointWorkJ: midpoint,
      saturated: torque === f.motor.forceRangeNm[0] || torque === f.motor.forceRangeNm[1],
    });
  }
  return { motors, coordinateWorkJ, midpointWorkJ, prePowerW };
}

export function assessMechanismForces(f, condition, ids, forward, force) {
  const n = ids.joints.length;
  const rows = forward.nefc;
  demand(
    Number.isInteger(rows) &&
      rows >= 0 &&
      rows <= f.resources.maxConstraintRows &&
      forward.efcJ.length === rows * n &&
      forward.efcType.length === rows &&
      forward.efcId.length === rows &&
      forward.efcVel.length === rows &&
      force.efcForce.length === rows &&
      force.qfrcConstraint.length === n &&
      finite({ forward, force }),
    'CONSTRAINT_DENSE_LAYOUT_OR_NONFINITE',
  );
  const total = new Array(n).fill(0);
  const absolute = new Array(n).fill(0);
  const contactGeneralized = new Array(n).fill(0);
  const limitGeneralized = new Array(n).fill(0);
  const limitRows = [];
  const limitJoints = new Set();
  const loaded = Object.fromEntries(
    ids.joints.map((j) => [j.name, { upper: false, lower: false }]),
  );
  for (let row = 0; row < rows; row += 1) {
    const jac = forward.efcJ.slice(row * n, (row + 1) * n);
    const lambda = force.efcForce[row];
    demand(lambda >= 0, 'UNILATERAL_NEGATIVE_LAMBDA');
    const type = forward.efcType[row];
    demand(
      type === limitType || (condition.wall && type === frictionlessContactType),
      'UNREGISTERED_CONSTRAINT_TYPE',
    );
    for (let d = 0; d < n; d += 1) {
      const q = jac[d] * lambda;
      total[d] += q;
      absolute[d] += Math.abs(q);
      (type === limitType ? limitGeneralized : contactGeneralized)[d] += q;
    }
    if (type === limitType) {
      const joint = ids.joints.find((j) => j.jointId === forward.efcId[row]);
      demand(joint, 'LIMIT_UNKNOWN_JOINT');
      demand(!limitJoints.has(joint.jointId), 'DUPLICATE_JOINT_LIMIT_ROW');
      limitJoints.add(joint.jointId);
      const sign = jac[joint.dofAdr];
      demand(
        (sign === -1 || sign === 1) && jac.every((v, d) => d === joint.dofAdr || v === 0),
        'LIMIT_NATIVE_JACOBIAN',
      );
      const side = sign === -1 ? 'upper' : 'lower';
      const q = forward.state.qpos[joint.qposAdr];
      demand(
        side === 'upper' ? q > f.joint.rangeRad[1] : q < f.joint.rangeRad[0],
        'LIMIT_PRE_STATE_SIDE',
      );
      const generalizedTorqueNm = sign * lambda;
      if (lambda > 0) loaded[joint.name][side] = true;
      limitRows.push({ row, joint: joint.name, side, lambda, generalizedTorqueNm });
    }
  }
  const aggregation = total.map((q, d) => ({
    dof: d,
    summedNm: q,
    nativeNm: force.qfrcConstraint[d],
    errorNm: Math.abs(q - force.qfrcConstraint[d]),
    budgetNm: gamma(4 * rows + 64) * absolute[d] + 64 * Number.EPSILON * 0.08,
  }));
  demand(
    aggregation.every((a) => a.errorNm <= a.budgetNm),
    'GENERALIZED_CONSTRAINT_FORCE_AGGREGATION',
  );
  demand(
    forward.ncon === force.contacts.length && forward.contacts.length === forward.ncon,
    'CONTACT_COUNT_PHASE',
  );
  if (!condition.wall) demand(forward.ncon === 0, 'UNEXPECTED_MECHANISM_SELF_CONTACT');
  let wallLoadedContacts = 0;
  let wallNormalForceN = 0;
  let wallOutwardForceN = 0;
  let maxPenetrationM = 0;
  let maxContactVelocityErrorMps = 0;
  const l3 = ids.links[2];
  for (const contact of force.contacts) {
    demand(
      condition.wall &&
        contact.geom.length === 2 &&
        ((contact.geom[0] === ids.wallGeom && contact.geom[1] === l3.geomId) ||
          (contact.geom[1] === ids.wallGeom && contact.geom[0] === l3.geomId)),
      'UNREGISTERED_CONTACT_PAIR',
    );
    demand(
      contact.dim === 1 &&
        contact.adhesion === 0 &&
        contact.includemargin === 0 &&
        contact.surfacevel.every((v) => v === 0) &&
        contact.force.length === 6 &&
        contact.force.slice(1).every((v) => v === 0) &&
        frameError(contact.frame) <= f.contact.frameOrthonormalTolerance &&
        equalNumbers(contact.solref, f.contact.solref) &&
        equalNumbers(contact.solimp, f.contact.solimp),
      'WALL_CONTACT_PROFILE_OR_TANGENTIAL_FORCE',
    );
    const fn = contact.force[0];
    demand(fn >= 0, 'WALL_NEGATIVE_NORMAL_FORCE');
    maxPenetrationM = Math.max(maxPenetrationM, -contact.dist);
    if (contact.efc_address < 0) {
      demand(fn === 0, 'EXCLUDED_CONTACT_HAS_FORCE');
      continue;
    }
    const row = contact.efc_address;
    demand(
      contact.exclude === 0 &&
        row < rows &&
        forward.efcType[row] === frictionlessContactType &&
        forward.efcId[row] === contact.index &&
        Math.abs(fn - force.efcForce[row]) <= 128 * Number.EPSILON * Math.max(1, Math.abs(fn)),
      'FRESH_WALL_CONTACT_FORCE_ROW',
    );
    const body0 = forward.bodies[contact.geom[0] === ids.wallGeom ? 0 : l3.bodyId];
    const body1 = forward.bodies[contact.geom[1] === ids.wallGeom ? 0 : l3.bodyId];
    const reconstructed = dot(
      contact.frame.slice(0, 3),
      relativePointVelocity(contact.pos, body0, body1),
    );
    const error = Math.abs(reconstructed - forward.efcVel[row]);
    maxContactVelocityErrorMps = Math.max(maxContactVelocityErrorMps, error);
    demand(
      error <= f.contact.velocityReconstructionToleranceMps,
      'WALL_CONTACT_PRE_VELOCITY_PHASE',
    );
    if (fn > 0) {
      wallLoadedContacts += 1;
      wallNormalForceN += fn;
      const onGeom1 = contactWorldForce(contact.frame, contact.force);
      const onL3 = contact.geom[1] === l3.geomId ? onGeom1 : scale(onGeom1, -1);
      wallOutwardForceN -= onL3[1];
    }
  }
  for (let row = 0; row < rows; row += 1)
    if (forward.efcType[row] === frictionlessContactType)
      demand(
        force.contacts.some((c) => c.efc_address === row && c.index === forward.efcId[row]),
        'CONTACT_ROW_WITHOUT_CURRENT_CONTACT',
      );
  return {
    limitRows,
    loaded,
    total,
    limitGeneralized,
    contactGeneralized,
    aggregation,
    loadedLimitRows: limitRows.filter((r) => r.lambda > 0).length,
    wallLoadedContacts,
    wallNormalForceN,
    wallOutwardForceN,
    maxPenetrationM,
    maxContactVelocityErrorMps,
  };
}

export function stationaryWindows(f, condition) {
  const scenario = f.cases.find((c) => c.id === condition.case);
  const spans =
    condition.case === 'A'
      ? scenario.drivenPhases.map((p) => ({
          side: p.limitSide,
          startUs: p.endUs - f.stationary.windowUs,
          endUs: p.endUs,
        }))
      : [
          {
            side: condition.case === 'C' ? 1 : 0,
            startUs: scenario.durationUs - f.stationary.windowUs,
            endUs: scenario.durationUs,
          },
        ];
  return spans.map((span) => ({
    ...span,
    case: condition.case,
    dtUs: condition.dtUs,
    expectedIntervals: f.stationary.windowUs / condition.dtUs,
    intervals: 0,
    firstTick: null,
    lastTick: null,
    minQ: [],
    maxQ: [],
    maxAbsQvelRadps: 0,
    freshReactionIntervals: [],
    nearLimitIntervals: [],
    wallIntervals: 0,
    noLimitRowIntervals: 0,
    noLoadedConstraintIntervals: 0,
    minL3MaxYM: null,
    maxL3MaxYM: null,
    firstPre: null,
    lastPost: null,
    accepted: false,
  }));
}
/** O(njoint) streaming state, including both endpoints of every interval. */
export function observeStationaryWindow(f, window, record, ids) {
  const { intervalStartUs: start, intervalEndUs: end } = record;
  if (start < window.startUs || end > window.endUs) return false;
  demand(
    end - start === window.dtUs &&
      (window.intervals === 0 ? start === window.startUs : record.tick === window.lastTick + 1),
    'STATIONARY_WINDOW_NONCONSECUTIVE',
  );
  const pre = record.pre;
  const post = record.endpoint;
  if (window.intervals === 0) {
    window.firstTick = record.tick;
    window.firstPre = { qpos: pre.qpos, qvel: pre.qvel, time: pre.time };
    window.minQ = pre.qpos.slice();
    window.maxQ = pre.qpos.slice();
    window.freshReactionIntervals = new Array(ids.joints.length).fill(0);
    window.nearLimitIntervals = new Array(ids.joints.length).fill(0);
  }
  window.intervals += 1;
  window.lastTick = record.tick;
  window.lastPost = { qpos: post.qpos, qvel: post.qvel, time: post.time };
  for (let i = 0; i < ids.joints.length; i += 1) {
    const joint = ids.joints[i];
    const q0 = pre.qpos[joint.qposAdr];
    const q1 = post.qpos[joint.qposAdr];
    window.minQ[joint.qposAdr] = Math.min(window.minQ[joint.qposAdr], q0, q1);
    window.maxQ[joint.qposAdr] = Math.max(window.maxQ[joint.qposAdr], q0, q1);
    window.maxAbsQvelRadps = Math.max(
      window.maxAbsQvelRadps,
      Math.abs(pre.qvel[joint.dofAdr]),
      Math.abs(post.qvel[joint.dofAdr]),
    );
    if (window.side) {
      const target = f.joint.rangeRad[window.side > 0 ? 1 : 0];
      if (
        Math.max(Math.abs(q0 - target), Math.abs(q1 - target)) <=
        radians(f.joint.maximumOvershootDeg)
      )
        window.nearLimitIntervals[i] += 1;
      if (record.reaction.loaded[joint.name][window.side > 0 ? 'upper' : 'lower'])
        window.freshReactionIntervals[i] += 1;
    }
  }
  const y0 = record.preGeometry.l3MaxYM;
  const y1 = record.endpointGeometry.l3MaxYM;
  window.minL3MaxYM =
    window.minL3MaxYM === null ? Math.min(y0, y1) : Math.min(window.minL3MaxYM, y0, y1);
  window.maxL3MaxYM =
    window.maxL3MaxYM === null ? Math.max(y0, y1) : Math.max(window.maxL3MaxYM, y0, y1);
  if (record.reaction.limitRows.length === 0) window.noLimitRowIntervals += 1;
  if (record.reaction.loadedLimitRows === 0 && record.reaction.wallLoadedContacts === 0)
    window.noLoadedConstraintIntervals += 1;
  const j3 = ids.joints.find((j) => j.name === 'J3');
  if (
    record.reaction.wallLoadedContacts > 0 &&
    record.reaction.wallOutwardForceN > 0 &&
    record.reaction.contactGeneralized[j3.dofAdr] < 0 &&
    pre.qpos[j3.qposAdr] < f.joint.rangeRad[1] &&
    post.qpos[j3.qposAdr] < f.joint.rangeRad[1]
  )
    window.wallIntervals += 1;
  if (end === window.endUs) {
    const ranges = window.maxQ.map((q, i) => q - window.minQ[i]);
    const full = window.intervals === window.expectedIntervals;
    const stationary =
      window.maxAbsQvelRadps <= f.stationary.maxAbsQvelRadps &&
      ranges.every((v) => v <= radians(f.stationary.maxQRangeDeg));
    const witness =
      window.case === 'B'
        ? window.wallIntervals === window.expectedIntervals &&
          window.noLimitRowIntervals === window.expectedIntervals
        : window.case === 'D'
          ? window.noLoadedConstraintIntervals === window.expectedIntervals
          : window.freshReactionIntervals.every((v) => v === window.expectedIntervals) &&
            window.nearLimitIntervals.every((v) => v === window.expectedIntervals);
    window.qRangesRad = ranges;
    window.accepted = full && stationary && witness;
    demand(
      window.accepted,
      'MECHANISM_STATIONARY_OR_REACTION_GATE ' + window.case + ' ' + window.endUs,
    );
  }
  return true;
}

function warningGuard(warnings, f) {
  demand(
    warnings.length === f.resources.warningCount && warnings.every((w) => w[0] === 0 && w[1] === 0),
    'NATIVE_WARNING_NONZERO',
  );
}
function zeroAppliedForces(data) {
  for (const key of ['qfrc_applied', 'xfrc_applied', 'qfrc_passive', 'act'])
    demand(
      Array.from(data[key]).every((v) => v === 0),
      'UNREGISTERED_NATIVE_FORCE_OR_ACT ' + key,
    );
}
function counter() {
  return {
    temporaryCreated: 0,
    temporaryDeleted: 0,
    velocityCalls: 0,
    contactForceCalls: 0,
    step1Dispatched: 0,
    step1Returned: 0,
    step1Preserved: 0,
    advanceDispatched: 0,
    advanceReturned: 0,
    scheduleConfirmedAdvances: 0,
    refreshDispatched: 0,
    refreshReturned: 0,
    preservedRefreshes: 0,
    initialRefreshes: 0,
    endpointRefreshes: 0,
    warningObservations: 0,
    fullyAssessedIntervals: 0,
  };
}

export function makeMechanismTickRecord(input) {
  const {
    tick,
    dtUs,
    control,
    pre,
    forward,
    force,
    endpointBodies,
    endpointFrames,
    preGeometry,
    endpointGeometry,
    reaction,
    actuation,
    energy,
    singleJointBalance,
    iterations,
  } = input;
  return {
    tick,
    intervalStartUs: (tick - 1) * dtUs,
    intervalEndUs: tick * dtUs,
    control,
    pre,
    forward,
    force,
    endpoint: force.endpoint,
    endpointBodies,
    endpointFrames,
    preGeometry,
    endpointGeometry,
    reaction,
    actuation,
    energy,
    singleJointBalance,
    nativeCounts: {
      ncon: forward.ncon,
      nefc: forward.nefc,
      islands: force.islands,
      solverIterations: iterations,
    },
  };
}

/** No native action in the constructor. create/advance are reached only by the explicit executor. */
export class MechanismWorld {
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
    this.res = counter();
    this.retention = new TickRetention(journal, f, condition.id, condition.dtUs);
    this.physical = new StepChain();
    this.lastObservation = null;
    this.previousControlPhase = null;
    this.windows = stationaryWindows(f, condition);
    this.summary = {
      id: condition.id,
      condition,
      status: 'STARTED',
      ticks: 0,
      modelCreationAttempted: false,
      modelCreated: false,
      dataCreationAttempted: false,
      dataCreated: false,
      topologyClaim: f.bodies.topology[condition.case],
      resources: this.res,
      windows: this.windows,
      firstLoaded: { wall: null, limits: {} },
      firstEvent: null,
      maxima: {
        anchorErrorM: 0,
        frameError: 0,
        nativeTorqueNm: 0,
        contacts: 0,
        constraintRows: 0,
        islands: 0,
        solverIterations: 0,
        penetrationM: 0,
        constraintAggregationErrorNm: 0,
        constraintAggregationBudgetNm: 0,
        contactVelocityErrorMps: 0,
        singleJointBalanceErrorNm: 0,
      },
      qMinimum: [],
      qMaximum: [],
      gateCounts: { endpointChecks: 0, torqueIntervals: 0, constraintIntervals: 0 },
      energy: {
        status: 'DIAGNOSTIC_ONLY',
        baselineMechanicalJ: null,
        coordinateWorkJ: 0,
        absoluteCoordinateWorkJ: 0,
        midpointWorkJ: 0,
        constraintWorkJ: 0,
        finalMechanicalJ: null,
        maxMechanicalMinusInputJ: null,
      },
    };
  }
  refresh(initial = false) {
    const before = copyState(this.data);
    this.res.refreshDispatched += 1;
    this.M.mj_kinematics(this.model, this.data);
    this.M.mj_comPos(this.model, this.data);
    this.M.mj_comVel(this.model, this.data);
    this.res.refreshReturned += 1;
    demand(canonicalEqual(before, copyState(this.data)), 'REFRESH_CHANGED_NATIVE_PHYSICAL_STATE');
    this.res.preservedRefreshes += 1;
    if (initial) this.res.initialRefreshes += 1;
    else this.res.endpointRefreshes += 1;
    return {
      bodies: nativeBodyKinematics(
        this.M,
        this.model,
        this.data,
        this.ids.bodyIds,
        this.res,
        this.buffer,
      ),
      frames: readFrames(this.data),
    };
  }
  checkEndpoint(state, bodies, frames) {
    const observed = assessMechanismEndpoint(this.f, this.ids, state, bodies, frames);
    this.summary.gateCounts.endpointChecks += 1;
    this.summary.maxima.anchorErrorM = Math.max(
      this.summary.maxima.anchorErrorM,
      observed.maxAnchorErrorM,
    );
    this.summary.maxima.frameError = Math.max(
      this.summary.maxima.frameError,
      observed.maxFrameError,
    );
    for (let i = 0; i < state.qpos.length; i += 1) {
      this.summary.qMinimum[i] = Math.min(this.summary.qMinimum[i] ?? state.qpos[i], state.qpos[i]);
      this.summary.qMaximum[i] = Math.max(this.summary.qMaximum[i] ?? state.qpos[i], state.qpos[i]);
    }
    return observed;
  }
  appendMetadata(record) {
    demand(
      canonicalBytes(record).length <= this.f.retention.maxWorldMetadataBytes,
      'RESOURCE_WORLD_METADATA_BYTE_CAP',
    );
    this.journal.append(record);
  }
  appendTick(kind, record, event = null) {
    const wrapped = { kind, world: this.c.id, event, observation: record };
    demand(
      canonicalBytes(wrapped).length <=
        this.f.retention.maxTickBytes + this.f.retention.emergencyRecordOverheadBytes,
      'RESOURCE_EVENT_RECORD_BYTE_CAP',
    );
    this.journal.append(wrapped);
  }
  create() {
    const { M, f, c, total } = this;
    demand(
      total.modelCreationDispatched < total.allowedWorlds &&
        total.modelsCreated - total.modelsFreed < total.allowedConcurrentWorlds,
      'RESOURCE_WORLD_BUDGET',
    );
    const xml = makeMechanismXml(f, c);
    this.summary.xmlSha256 = sha256(xml);
    this.summary.modelCreationAttempted = true;
    total.modelCreationDispatched += 1;
    this.model = M.MjModel.from_xml_string(xml);
    demand(this.model, 'NATIVE_MODEL_CREATE_EMPTY');
    total.modelsCreated += 1;
    this.summary.modelCreated = true;
    total.maxConcurrentWorlds = Math.max(
      total.maxConcurrentWorlds,
      total.modelsCreated - total.modelsFreed,
    );
    this.summary.dataCreationAttempted = true;
    total.dataCreationDispatched += 1;
    this.data = new M.MjData(this.model);
    total.dataCreated += 1;
    this.summary.dataCreated = true;
    this.buffer = new M.DoubleBuffer(6);
    this.res.temporaryCreated += 1;
    demand(
      this.buffer.GetView() instanceof Float64Array && this.buffer.GetView().length === 6,
      'NATIVE_OUTPUT_BUFFER_SHAPE',
    );
    const initial = copyState(this.data);
    const readback = readMechanismModel(this.model);
    this.ids = resolveMechanismIds(M, this.model, c);
    validateMechanismModel(f, c, readback, this.ids, initial);
    demand(
      Array.from(this.data.ctrl).every((v) => v === 0),
      'INITIAL_NONZERO_CONTROL',
    );
    zeroAppliedForces(this.data);
    const endpoint = this.refresh(true);
    const geometry = this.checkEndpoint(initial, endpoint.bodies, endpoint.frames);
    const warnings = copyWarnings(this.data, this.res);
    warningGuard(warnings, f);
    this.res.warningObservations += 1;
    const energy = mechanismEnergy(f, this.ids, endpoint.bodies);
    this.summary.energy.baselineMechanicalJ = energy.mechanicalJ;
    this.summary.energy.finalMechanicalJ = energy.mechanicalJ;
    this.summary.energy.maxMechanicalMinusInputJ = 0;
    this.summary.ids = this.ids;
    this.summary.modelReadback = readback;
    this.summary.initialState = initial;
    this.summary.warningBaseline = warnings;
    this.lastObservation = { phase: 'initialized', initial, endpoint, geometry, energy };
    this.appendMetadata({
      kind: 'world-initialization',
      world: c.id,
      condition: c,
      xml,
      readback,
      ids: this.ids,
      initial,
      endpoint,
      geometry,
      energy,
      warnings,
    });
    this.journal.checkpoint();
  }
  advance() {
    const { M, model, data, f, c, res, total } = this;
    const tick = this.tick + 1;
    demand(
      tick <= c.maxSteps &&
        tick <= f.budget.maxStepsPerWorld &&
        total.advanceDispatched < total.allowedNativeSteps,
      'RESOURCE_NATIVE_STEP_BUDGET',
    );
    const pre = copyState(data);
    zeroAppliedForces(data);
    this.lastObservation = { tick, phase: 'before-step1', pre };
    res.step1Dispatched += 1;
    total.step1Dispatched += 1;
    M.mj_step1(model, data);
    res.step1Returned += 1;
    total.step1Returned += 1;
    demand(
      canonicalEqual(phaseState(pre), phaseState(copyState(data))),
      'STEP1_CHANGED_PHYSICAL_STATE',
    );
    res.step1Preserved += 1;
    const forward = captureForward(M, model, data, pre, this.ids, res, this.buffer, f.resources);
    forward.efcJ = Array.from(data.efc_J);
    forward.efcPos = Array.from(data.efc_pos);
    forward.actuatorLength = Array.from(data.actuator_length);
    forward.actuatorVelocity = Array.from(data.actuator_velocity);
    forward.frames = readFrames(data);
    const preGeometry = this.checkEndpoint(pre, forward.bodies, forward.frames);
    const control = controlAt(f, c, this.tick, pre, this.ids.joints);
    for (let i = 0; i < this.ids.joints.length; i += 1)
      data.ctrl[this.ids.joints[i].actuatorId] = control.raw[i];
    this.lastObservation = { tick, phase: 'before-step2', pre, forward, control, preGeometry };
    res.advanceDispatched += 1;
    total.advanceDispatched += 1;
    M.mj_step2(model, data);
    res.advanceReturned += 1;
    total.advanceReturned += 1;
    this.tick = tick;
    this.summary.ticks = tick;
    this.lastObservation = {
      tick,
      phase: 'step2-returned',
      pre,
      forward,
      control,
      endpoint: copyState(data),
    };
    const force = captureForces(M, model, data, forward, res, this.buffer, f.resources);
    this.lastObservation = { tick, phase: 'force-captured', pre, forward, force, control };
    demand(
      canonicalEqual(forward.efcType, Array.from(data.efc_type)) &&
        canonicalEqual(forward.efcId, Array.from(data.efc_id)) &&
        canonicalEqual(forward.efcJ, Array.from(data.efc_J)),
      'CONSTRAINT_ROW_IDENTITY_CHANGED_DURING_SOLVE',
    );
    demand(
      finite(force.endpoint) && data.ntree_awake === model.ntree,
      'NONFINITE_OR_SLEEPING_NATIVE_STATE',
    );
    warningGuard(force.warnings, f);
    res.warningObservations += 1;
    zeroAppliedForces(data);
    demand(
      force.endpoint.time > pre.time &&
        Math.abs(force.endpoint.time - (tick * c.dtUs) / 1e6) <= nativeTimeBudget(tick, c.dtUs),
      'NATIVE_INTEGER_TIME_SCHEDULE',
    );
    res.scheduleConfirmedAdvances += 1;
    total.scheduleConfirmedAdvances += 1;
    const iterations = force.solverIterations.slice(0, Math.max(1, force.islands));
    demand(
      iterations.every(
        (v) => Number.isInteger(v) && v >= 0 && v <= f.solver.maxCombinedSolverIterationsPerIsland,
      ),
      'SOLVER_ITERATION_BUDGET',
    );
    const reaction = assessMechanismForces(f, c, this.ids, forward, force);
    const actuation = assessMechanismActuation(
      f,
      this.ids,
      pre,
      force.endpoint,
      control,
      forward,
      force,
      c.dtUs,
    );
    this.summary.gateCounts.torqueIntervals += 1;
    this.summary.gateCounts.constraintIntervals += 1;
    const endpoint = this.refresh();
    const endpointGeometry = this.checkEndpoint(force.endpoint, endpoint.bodies, endpoint.frames);
    const energy = mechanismEnergy(f, this.ids, endpoint.bodies);
    const constraintWorkJ = this.ids.joints.reduce(
      (sum, j) =>
        sum +
        force.qfrcConstraint[j.dofAdr] * (force.endpoint.qpos[j.qposAdr] - pre.qpos[j.qposAdr]),
      0,
    );
    const e = this.summary.energy;
    e.coordinateWorkJ += actuation.coordinateWorkJ;
    e.absoluteCoordinateWorkJ += actuation.motors.reduce(
      (sum, m) => sum + Math.abs(m.coordinateWorkJ),
      0,
    );
    e.midpointWorkJ += actuation.midpointWorkJ;
    e.constraintWorkJ += constraintWorkJ;
    e.finalMechanicalJ = energy.mechanicalJ;
    e.maxMechanicalMinusInputJ = Math.max(
      e.maxMechanicalMinusInputJ,
      energy.mechanicalJ - e.baselineMechanicalJ - e.coordinateWorkJ,
    );
    const m = this.summary.maxima;
    m.nativeTorqueNm = Math.max(
      m.nativeTorqueNm,
      ...actuation.motors.map((v) => Math.abs(v.nativeTorqueNm)),
    );
    m.contacts = Math.max(m.contacts, forward.ncon);
    m.constraintRows = Math.max(m.constraintRows, forward.nefc);
    m.islands = Math.max(m.islands, force.islands);
    m.solverIterations = Math.max(m.solverIterations, ...iterations);
    m.penetrationM = Math.max(m.penetrationM, reaction.maxPenetrationM);
    m.contactVelocityErrorMps = Math.max(
      m.contactVelocityErrorMps,
      reaction.maxContactVelocityErrorMps,
    );
    m.constraintAggregationErrorNm = Math.max(
      m.constraintAggregationErrorNm,
      ...reaction.aggregation.map((a) => a.errorNm),
    );
    m.constraintAggregationBudgetNm = Math.max(
      m.constraintAggregationBudgetNm,
      ...reaction.aggregation.map((a) => a.budgetNm),
    );
    let singleJointBalance = null;
    if (!c.articulated) {
      const j = this.ids.joints[0];
      const inertia = f.bodies.inertiaKgM2[2] + f.bodies.massKg * f.bodies.comLocalM[0] ** 2;
      const inertialTorqueNm =
        (inertia * (force.endpoint.qvel[j.dofAdr] - pre.qvel[j.dofAdr])) / (c.dtUs / 1e6);
      const appliedTorqueNm = force.qfrcActuator[j.dofAdr] + force.qfrcConstraint[j.dofAdr];
      singleJointBalance = {
        status: 'DIAGNOSTIC_ONLY',
        inertiaKgM2: inertia,
        inertialTorqueNm,
        appliedTorqueNm,
        residualNm: inertialTorqueNm - appliedTorqueNm,
      };
      m.singleJointBalanceErrorNm = Math.max(
        m.singleJointBalanceErrorNm,
        Math.abs(singleJointBalance.residualNm),
      );
    }
    const record = makeMechanismTickRecord({
      tick,
      dtUs: c.dtUs,
      control,
      pre,
      forward,
      force,
      endpointBodies: endpoint.bodies,
      endpointFrames: endpoint.frames,
      preGeometry,
      endpointGeometry,
      reaction,
      actuation,
      energy: { ...energy, constraintWorkJ, cumulative: { ...e } },
      singleJointBalance,
      iterations,
    });
    demand(finite(record), 'NONFINITE_COMPLETE_INTERVAL');
    demand(
      res.temporaryCreated - res.temporaryDeleted === 1,
      'TEMPORARY_WRAPPER_BALANCE_DURING_WORLD',
    );
    this.lastObservation = record;
    const bytes = this.retention.prepare(record);
    this.physical.push(canonicalBytes(force.endpoint));
    this.observeEvents(record);
    if (this.previousControlPhase !== control.phase) {
      this.appendTick('control-phase-start', record);
      this.previousControlPhase = control.phase;
    }
    for (const window of this.windows) {
      const observed = observeStationaryWindow(f, window, record, this.ids);
      if (observed && window.intervals === 1) this.appendTick('stationary-window-start', record);
      if (observed && record.intervalEndUs === window.endUs)
        this.appendTick('stationary-window-end', record);
    }
    res.fullyAssessedIntervals += 1;
    if ((tick * c.dtUs) % f.retention.compactCadenceUs === 0) {
      const compact = {
        kind: 'checkpoint',
        world: c.id,
        tick,
        rawChain: this.retention.chain.checkpoint(),
        physicalChain: this.physical.checkpoint(),
        maxima: m,
        energy: e,
        windows: this.windows,
        resources: res,
        firstLoaded: this.summary.firstLoaded,
      };
      demand(
        canonicalBytes(compact).length <= f.retention.maxCompactRecordBytes,
        'RESOURCE_COMPACT_RECORD_BYTE_CAP',
      );
      this.journal.append(compact);
    }
    this.retention.retain(record, bytes);
  }
  observeEvents(record) {
    const eventAt = (kind, detail) => ({
      kind,
      ...detail,
      tick: record.tick,
      intervalStartUs: record.intervalStartUs,
      nativePreTime: record.pre.time,
      forcePhase: 'saved_PRE_geometry_current_step2_force',
    });
    let event = null;
    if (record.reaction.wallLoadedContacts > 0 && !this.summary.firstLoaded.wall) {
      event = eventAt('loaded-wall', { forceN: record.reaction.wallNormalForceN });
      this.summary.firstLoaded.wall = event;
      this.appendTick('first-loaded-wall', record, event);
    }
    for (const row of record.reaction.limitRows) {
      if (row.lambda <= 0) continue;
      this.summary.firstLoaded.limits[row.joint] ??= {};
      if (!this.summary.firstLoaded.limits[row.joint][row.side]) {
        const next = eventAt('loaded-limit', {
          joint: row.joint,
          side: row.side,
          lambda: row.lambda,
          generalizedTorqueNm: row.generalizedTorqueNm,
        });
        this.summary.firstLoaded.limits[row.joint][row.side] = next;
        this.appendTick('first-loaded-limit-side', record, next);
        event ??= next;
      }
    }
    if (event && !this.summary.firstEvent) {
      this.summary.firstEvent = event;
      this.retention.event(record.tick, event, record);
    }
  }
  finish() {
    const n = this.c.maxSteps;
    demand(
      this.tick === n &&
        this.res.fullyAssessedIntervals === n &&
        this.windows.every((w) => w.accepted),
      'INCOMPLETE_MECHANISM_WORLD',
    );
    demand(
      this.res.step1Dispatched === n &&
        this.res.step1Returned === n &&
        this.res.step1Preserved === n &&
        this.res.advanceDispatched === n &&
        this.res.advanceReturned === n &&
        this.res.scheduleConfirmedAdvances === n &&
        this.res.initialRefreshes === 1 &&
        this.res.endpointRefreshes === n &&
        this.res.preservedRefreshes === n + 1 &&
        this.res.warningObservations === n + 1 &&
        this.summary.gateCounts.endpointChecks === 2 * n + 1 &&
        this.summary.gateCounts.torqueIntervals === n &&
        this.summary.gateCounts.constraintIntervals === n,
      'INCOMPLETE_NATIVE_PHASE_OR_GUARD_COUNTS',
    );
    if (this.c.case === 'B') demand(this.summary.firstLoaded.wall, 'MISSING_FIRST_LOADED_WALL');
    if (this.c.case === 'C')
      demand(this.summary.firstLoaded.limits.J3?.upper, 'MISSING_FIRST_UPPER_LIMIT');
    this.summary.finalState = this.lastObservation.endpoint;
    this.summary.finalBodies = Object.fromEntries(
      this.ids.links.map((l) => [l.name, this.lastObservation.endpointBodies[l.bodyId]]),
    );
    this.summary.finalGeometry = this.lastObservation.endpointGeometry;
    this.summary.status = 'PASS';
    this.summary.rawChain = this.retention.chain.checkpoint();
    this.summary.physicalChain = this.physical.checkpoint();
    this.appendMetadata({
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
      unreturnedNativeAdvancePossible: this.res.advanceDispatched > this.res.advanceReturned,
      lastObservation: this.lastObservation,
      native: {},
      nativeReadErrors: [],
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
      for (const key of ['ncon', 'nefc', 'nisland']) {
        try {
          partial.native[key] = this.data[key];
        } catch (e) {
          partial.nativeReadErrors.push(key + ':' + portableError(e));
        }
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
    this.summary.physicalChain = this.physical.checkpoint();
    return this.summary;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    for (const [key, counterName] of [
      ['buffer', 'temporaryDeleted'],
      ['data', 'dataFreed'],
      ['model', 'modelsFreed'],
    ]) {
      if (!this[key]) continue;
      try {
        this[key].delete();
        if (key === 'buffer') this.res[counterName] += 1;
        else this.total[counterName] += 1;
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
    demand(
      errors.length === 0 && this.res.temporaryCreated === this.res.temporaryDeleted,
      'RESOURCE_OWNED_WRAPPER_CLEANUP ' + JSON.stringify({ errors, resources: this.res }),
    );
  }
}

export function assessMechanismComparisons(f, summaries) {
  const plan = mechanismPlan(f);
  demand(
    summaries.length === plan.length && new Set(summaries.map((s) => s.id)).size === plan.length,
    'MECHANISM_RUN_SET_INCOMPLETE_OR_DUPLICATE',
  );
  for (const entry of plan) {
    const world = summaries.find((s) => s.id === entry.id);
    demand(
      world?.status === 'PASS' &&
        canonicalEqual(world.condition, entry) &&
        world.ticks === entry.maxSteps &&
        world.rawChain?.ticks === entry.maxSteps &&
        world.physicalChain?.ticks === entry.maxSteps,
      'MECHANISM_WORLD_NOT_COMPLETE ' + entry.id,
    );
  }
  const find = (scenario, dt, repeat) =>
    summaries.find(
      (s) =>
        s.condition.case === scenario && s.condition.dtUs === dt && s.condition.repeat === repeat,
    );
  const comparisons = [];
  for (const scenario of f.cases) {
    if (scenario.repeats === 2)
      for (const dt of f.nativeStepUs) {
        const a = find(scenario.id, dt, 1);
        const b = find(scenario.id, dt, 2);
        demand(
          canonicalEqual(a.rawChain, b.rawChain) &&
            canonicalEqual(a.physicalChain, b.physicalChain),
          'MECHANISM_EXACT_REPEATABILITY ' + scenario.id + ' ' + dt,
        );
        comparisons.push({ kind: 'exact-repeat', worlds: [a.id, b.id], verdict: 'PASS' });
      }
    for (let repeat = 1; repeat <= scenario.repeats; repeat += 1) {
      const a = find(scenario.id, f.nativeStepUs[0], repeat);
      const b = find(scenario.id, f.nativeStepUs[1], repeat);
      const bodies = f.bodies.linkNames.map((name) => ({
        name,
        comDifferenceM: norm(sub(a.finalBodies[name].com, b.finalBodies[name].com)),
        quaternionDifferenceRad: quaternionAngle(
          a.finalBodies[name].quaternion,
          b.finalBodies[name].quaternion,
        ),
      }));
      const qDifferenceRad = a.finalState.qpos.map((q, i) => q - b.finalState.qpos[i]);
      const hard = f.refinement.hardCases.includes(scenario.id);
      let eventDifferenceUs = null;
      if (hard) {
        const eventA = scenario.id === 'B' ? a.firstLoaded.wall : a.firstLoaded.limits.J3?.upper;
        const eventB = scenario.id === 'B' ? b.firstLoaded.wall : b.firstLoaded.limits.J3?.upper;
        demand(eventA && eventB, 'REFINEMENT_MISSING_PRE_PHASE_EVENT');
        eventDifferenceUs = Math.abs(eventA.intervalStartUs - eventB.intervalStartUs);
        const l3 = bodies.find((v) => v.name === 'L3');
        demand(
          eventDifferenceUs <= f.refinement.eventTimeMaxDifferenceUs &&
            l3.comDifferenceM <= f.refinement.finalComMaxDifferenceM &&
            l3.quaternionDifferenceRad <= radians(f.refinement.finalQuaternionMaxDifferenceDeg),
          'MECHANISM_BC_REFINEMENT_GATE ' + scenario.id,
        );
      }
      comparisons.push({
        kind: 'dt-refinement',
        worlds: [a.id, b.id],
        case: scenario.id,
        verdict: hard ? 'PASS' : 'DIAGNOSTIC_ONLY',
        eventDifferenceUs,
        bodies,
        qDifferenceRad,
        referenceSizeM: hard ? f.refinement.referenceSizeM : null,
        scope: 'This registered slice does not close entire PHY-14.',
      });
    }
  }
  for (const dt of f.nativeStepUs)
    for (let repeat = 1; repeat <= 2; repeat += 1) {
      const b = find('B', dt, repeat);
      const c = find('C', dt, repeat);
      const minimumGapM = c.windows[0].minL3MaxYM - b.windows[0].maxL3MaxYM;
      demand(minimumGapM >= f.wall.requiredGapM, 'WALL_NO_WALL_STATIONARY_GAP');
      comparisons.push({
        kind: 'wall-no-wall-gap',
        worlds: [b.id, c.id],
        minimumGapM,
        verdict: 'PASS',
        topology: 'both are welded L1/L2 diagnostic stands with J3 only',
      });
    }
  return comparisons;
}

/** Explicit caller only. Module import, fixture reads and plan construction do not initialize MuJoCo. */
export async function executeMechanism(f, journal) {
  validateMechanismFixture(f);
  const plan = mechanismPlan(f);
  const total = {
    allowedWorlds: f.budget.worlds,
    allowedNativeSteps: f.budget.nativeSteps,
    allowedConcurrentWorlds: f.budget.maxConcurrentWorlds,
    maxConcurrentWorlds: 0,
    moduleInitializationDispatched: 0,
    moduleInitializations: 0,
    modelCreationDispatched: 0,
    modelsCreated: 0,
    modelsFreed: 0,
    dataCreationDispatched: 0,
    dataCreated: 0,
    dataFreed: 0,
    step1Dispatched: 0,
    step1Returned: 0,
    advanceDispatched: 0,
    advanceReturned: 0,
    scheduleConfirmedAdvances: 0,
  };
  const report = {
    budget: total,
    worlds: [],
    comparisons: [],
    assessment: { verdict: 'FAIL', failures: [] },
  };
  let current = null;
  try {
    const artifact = verifyMechanismArtifacts(f);
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
    for (const method of [
      'mj_step1',
      'mj_step2',
      'mj_name2id',
      'mj_id2name',
      'mj_kinematics',
      'mj_comPos',
      'mj_comVel',
      'mj_objectVelocity',
      'mj_contactForce',
    ])
      demand(typeof M[method] === 'function', 'NATIVE_REQUIRED_API ' + method);
    report.engine = {
      version: M.mj_versionString(),
      moduleSha256: artifact.moduleSha256,
      wasmSha256: artifact.wasmSha256,
      singleThread: true,
      explicitLocalWasm: true,
    };
    for (const condition of plan) {
      current = new MechanismWorld(M, f, condition, total, journal);
      current.create();
      while (current.tick < condition.maxSteps) current.advance();
      const summary = current.finish();
      current.dispose();
      report.worlds.push(summary);
      current = null;
    }
    report.comparisons = assessMechanismComparisons(f, report.worlds);
    demand(
      total.moduleInitializations === 1 &&
        total.modelCreationDispatched === f.budget.worlds &&
        total.modelsCreated === f.budget.worlds &&
        total.modelsFreed === total.modelsCreated &&
        total.dataCreated === total.modelsCreated &&
        total.dataFreed === total.dataCreated &&
        total.advanceDispatched === f.budget.nativeSteps &&
        total.advanceReturned === f.budget.nativeSteps &&
        total.scheduleConfirmedAdvances === f.budget.nativeSteps &&
        total.step1Dispatched === f.budget.nativeSteps &&
        total.step1Returned === f.budget.nativeSteps &&
        total.maxConcurrentWorlds === 1,
      'MECHANISM_INVOCATION_EXACT_BUDGET',
    );
    report.assessment.verdict = 'PASS';
  } catch (error) {
    report.assessment.failures.push(String(error));
    if (current && !report.worlds.some((w) => w.id === current.c.id))
      report.worlds.push(current.fail(error));
  } finally {
    if (current) {
      try {
        current.dispose();
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
    unreturnedNativeAdvancePossible: total.advanceDispatched > total.advanceReturned,
  };
  report.completeTrajectoryDigest = digest(
    canonicalBytes(
      report.worlds.map((w) => ({
        id: w.id,
        status: w.status,
        ticks: w.ticks,
        rawChain: w.rawChain ?? null,
        physicalChain: w.physicalChain ?? null,
        firstLoaded: w.firstLoaded,
        windows: w.windows,
        energy: w.energy,
      })),
    ),
  );
  return report;
}
