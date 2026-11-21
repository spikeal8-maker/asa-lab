const registeredFixtureContractSha256 =
  '52562ead409721a49732e9d9f985b230d757edbdd2ecee9b88c13d2115580bea';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import YAML from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const fixturePath = resolve(
  root,
  'tests/robotics/field-core-qualification/mujoco-phy01.fixture.json',
);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const demand = (condition, message) => {
  if (!condition) throw new Error(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finiteArray = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const zeroArray = (a) => Array.isArray(a) && a.every((v) => v === 0);
const hexDigest = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const norm = (a) => Math.hypot(...a);
const difference = (a, b) => a.map((v, i) => v - b[i]);

export function readFixture() {
  const bytes = readFileSync(fixturePath);
  return { fixture: JSON.parse(bytes.toString('utf8')), fixtureSha256: sha256(bytes) };
}
export function validateFixture(f) {
  demand(
    f && sha256(JSON.stringify(f)) === registeredFixtureContractSha256,
    'MUJOCO_PHY01_FIXTURE: differs from the registered physical, phase or work-budget contract',
  );
  for (const dtUs of f.nativeStepUs) {
    demand(
      Number.isSafeInteger(dtUs) &&
        f.macroStepUs % dtUs === 0 &&
        f.sampleTimesUs.every((t) => t % dtUs === 0),
      'MUJOCO_PHY01_FIXTURE: invalid integer schedule',
    );
  }
  return f;
}
export function verifyEngineArtifacts(f, packageRoot = dirname(require.resolve('@mujoco/mujoco'))) {
  validateFixture(f);
  demand(
    sha256(readFileSync(resolve(root, f.specification.path))) === f.specification.sha256,
    'MUJOCO_PHY01_SPECIFICATION: registered source hash mismatch',
  );
  const manifestBytes = readFileSync(resolve(root, f.engine.artifactManifest));
  demand(
    sha256(manifestBytes) === f.engine.artifactManifestSha256,
    'MUJOCO_PHY01_ENGINE: artifact manifest hash mismatch',
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  demand(
    manifest.package === f.engine.package && manifest.version === f.engine.version,
    'MUJOCO_PHY01_ENGINE: manifest package mismatch',
  );
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  demand(
    pkg.name === f.engine.package &&
      pkg.version === f.engine.version &&
      pkg.license === 'Apache-2.0',
    'MUJOCO_PHY01_ENGINE: installed package mismatch',
  );
  for (const file of manifest.files) {
    const bytes = readFileSync(resolve(packageRoot, file.path));
    demand(
      bytes.length === file.bytes && sha256(bytes) === file.sha256,
      'MUJOCO_PHY01_ENGINE: hash mismatch ' + file.path,
    );
  }
  for (const file of [manifest.companionLicense, manifest.companionNotices])
    demand(
      sha256(readFileSync(resolve(root, file.path))) === file.sha256,
      'MUJOCO_PHY01_ENGINE: companion notice mismatch ' + file.path,
    );
  demand(
    manifest.files.find((x) => x.path === 'mujoco.wasm')?.sha256 === f.engine.wasmSha256 &&
      manifest.files.find((x) => x.path === 'mujoco.js')?.sha256 === f.engine.moduleSha256,
    'MUJOCO_PHY01_ENGINE: selected single-thread artifact mismatch',
  );
  const declared = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const lock = YAML.parse(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'));
  const key = f.engine.package + '@' + f.engine.version;
  const importer = lock.importers['.'].devDependencies[f.engine.package];
  demand(
    declared.devDependencies[f.engine.package] === f.engine.version &&
      importer?.specifier === f.engine.version &&
      importer.version === f.engine.version &&
      lock.packages[key]?.resolution?.integrity === f.engine.integrity,
    'MUJOCO_PHY01_ENGINE: exact dependency/lock mismatch',
  );
  return {
    packageRoot,
    manifestSha256: sha256(manifestBytes),
    package: pkg.name,
    version: pkg.version,
    wasmSha256: f.engine.wasmSha256,
    moduleSha256: f.engine.moduleSha256,
    networkRequiredForRun: false,
    license: pkg.license,
    companionNoticesSha256: manifest.companionNotices.sha256,
  };
}
export const sourcePaths = [
  'package.json',
  'pnpm-lock.yaml',
  'tools/robotics-field-core/mujoco-artifact.json',
  'tools/robotics-field-core/MUJOCO-LICENSE.txt',
  'tools/robotics-field-core/MUJOCO-THIRD-PARTY-NOTICES.txt',
  'tools/robotics-field-core/mujoco-phy01.mjs',
  'tools/robotics-field-core/run-mujoco-phy01.mjs',
  'tests/robotics/field-core-qualification/mujoco-phy01.fixture.json',
  'tests/robotics/field-core-qualification/mujoco-phy01.spec.ts',
];
export function sourceManifest() {
  return Object.fromEntries(sourcePaths.map((p) => [p, sha256(readFileSync(resolve(root, p)))]));
}
export function analyticalAt(f, timeUs) {
  const t = timeUs / 1e6;
  const displacement = f.gravity.map((g) => (g * t * t) / 2);
  const velocity = f.gravity.map((g) => g * t);
  return {
    displacement,
    velocity,
    positionToleranceM: Math.max(
      f.tolerance.positionAbsoluteM,
      f.tolerance.relative * norm(displacement),
    ),
    velocityToleranceMps: Math.max(
      f.tolerance.velocityAbsoluteMps,
      f.tolerance.relative * norm(velocity),
    ),
  };
}
export function nativeTimeBudget(step, dtUs) {
  const h = dtUs / 1e6;
  const t = (step * dtUs) / 1e6;
  const gamma = (step * Number.EPSILON) / (1 - step * Number.EPSILON);
  return (gamma + 2 * Number.EPSILON) * Math.max(t, h);
}
/** Canonical IEEE754 bytes preserve signed zero; JSON is not used for native parity. */
export function float64Bytes(values) {
  demand(
    Array.isArray(values) && values.every(Number.isFinite),
    'MUJOCO_PHY01_STATE: non-finite numeric state',
  );
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => bytes.writeDoubleLE(v, i * 8));
  return bytes;
}
export function stateBytes(state, fields = ['qpos', 'qvel', 'qacc', 'qacc_warmstart', 'time']) {
  return float64Bytes(fields.flatMap((key) => (key === 'time' ? [state.time] : state[key])));
}
function copyNative(data) {
  const state = { time: data.time };
  for (const field of ['qpos', 'qvel', 'qacc', 'qacc_warmstart']) {
    const view = data[field];
    demand(
      view instanceof Float64Array,
      'MUJOCO_PHY01_STATE: expected native Float64Array ' + field,
    );
    state[field] = Array.from(view);
  }
  return state;
}
function copyWarnings(data) {
  // warning and opt are borrowed embedded members under Embind reference().
  // register_vector.get returns an owned MjWarningStat copy that must be deleted.
  const vector = data.warning;
  return Array.from({ length: vector.size() }, (_, i) => {
    const value = vector.get(i);
    demand(value != null, 'MUJOCO_PHY01_WARNING: missing native statistic ' + i);
    try {
      return { number: value.number, lastinfo: value.lastinfo };
    } finally {
      value.delete();
    }
  });
}
function zeroWarningTrace(steps, warningCount) {
  const hash = createHash('sha256');
  const bytes = Buffer.alloc(warningCount * 2 * 8);
  for (let i = 0; i < steps; i += 1) hash.update(bytes);
  return hash.digest('hex');
}
function failureObservation(data, stepIndex, phase) {
  const observation = { stepIndex, phase, state: {}, errors: [] };
  for (const field of ['qpos', 'qvel', 'qacc', 'qacc_warmstart', 'time']) {
    try {
      observation.state[field] = field === 'time' ? data.time : Array.from(data[field]);
    } catch (error) {
      observation.errors.push(field + ': ' + String(error));
    }
  }
  for (const [key, field] of [
    ['contactCount', 'ncon'],
    ['constraintCount', 'nefc'],
    ['awakeTrees', 'ntree_awake'],
  ]) {
    try {
      observation[key] = data[field];
    } catch (error) {
      observation.errors.push(field + ': ' + String(error));
    }
  }
  try {
    observation.warnings = copyWarnings(data);
  } catch (error) {
    observation.errors.push('warnings: ' + String(error));
  }
  return observation;
}
function zeroWarnings(warnings) {
  return (
    Array.isArray(warnings) &&
    warnings.length === 7 &&
    warnings.every((w) => w.number === 0 && w.lastinfo === 0)
  );
}
export function makeModelXml(f, massKg, dtUs) {
  validateFixture(f);
  demand(
    f.massesKg.includes(massKg) && f.nativeStepUs.includes(dtUs),
    'MUJOCO_PHY01_MODEL: unregistered identity',
  );
  const inertia = (2 * massKg * f.sphereRadiusM ** 2) / 5;
  return [
    '<mujoco model="asa_phy01_mujoco">',
    '<compiler angle="radian" inertiafromgeom="false" autolimits="false"/>',
    '<option timestep="' +
      dtUs / 1e6 +
      '" gravity="' +
      f.gravity.join(' ') +
      '" integrator="' +
      f.solver.integrator +
      '" solver="' +
      f.solver.solver +
      '" jacobian="' +
      f.solver.jacobian +
      '" cone="' +
      f.solver.cone +
      '" iterations="' +
      f.solver.iterations +
      '" tolerance="' +
      f.solver.tolerance +
      '" density="0" viscosity="0" wind="0 0 0"><flag sleep="disable"/></option>',
    '<default><joint damping="0" armature="0" frictionloss="0" stiffness="0" limited="false"/>' +
      '<geom friction="0 0 0" margin="0" gap="0"/></default>',
    '<worldbody><geom name="floor" type="box" size="' +
      f.floorHalfExtentsM.join(' ') +
      '" pos="0 0 ' +
      (f.floorTopZ - f.floorHalfExtentsM[2]) +
      '"/>',
    '<body name="falling_sphere" pos="0 0 2" quat="1 0 0 0"><joint name="free" type="free"/>',
    '<inertial pos="0 0 0" quat="1 0 0 0" mass="' +
      massKg +
      '" diaginertia="' +
      [inertia, inertia, inertia].join(' ') +
      '"/>',
    '<geom name="sphere" type="sphere" size="' + f.sphereRadiusM + '"/>',
    '</body></worldbody></mujoco>',
  ].join('\n');
}
function readModel(model, data) {
  const opt = model.opt;
  const value = {
    counts: Object.fromEntries(
      ['nq', 'nv', 'na', 'nu', 'nbody', 'ngeom', 'njnt', 'nplugin', 'nsensor', 'ntree'].map(
        (key) => [key, model[key]],
      ),
    ),
    arrays: Object.fromEntries(
      [
        'body_mass',
        'body_ipos',
        'body_iquat',
        'body_inertia',
        'body_pos',
        'body_quat',
        'jnt_type',
        'jnt_qposadr',
        'jnt_dofadr',
        'geom_type',
        'geom_size',
        'geom_pos',
        'dof_damping',
        'dof_armature',
        'dof_frictionloss',
        'jnt_stiffness',
      ].map((key) => [key, Array.from(model[key])]),
    ),
    options: Object.fromEntries(
      [
        'timestep',
        'integrator',
        'solver',
        'jacobian',
        'cone',
        'iterations',
        'tolerance',
        'disableflags',
        'enableflags',
        'density',
        'viscosity',
      ].map((key) => [key, opt[key]]),
    ),
    gravity: Array.from(opt.gravity),
    wind: Array.from(opt.wind),
    initial: copyNative(data),
    warnings: copyWarnings(data),
    controls: Array.from(data.ctrl),
    act: Array.from(data.act),
    qfrcApplied: Array.from(data.qfrc_applied),
    xfrcApplied: Array.from(data.xfrc_applied),
  };
  return value;
}
export function validateModelReadback(f, massKg, dtUs, r) {
  demand(
    r &&
      same(r.counts, {
        nq: 7,
        nv: 6,
        na: 0,
        nu: 0,
        nbody: 2,
        ngeom: 2,
        njnt: 1,
        nplugin: 0,
        nsensor: 0,
        ntree: 1,
      }),
    'MUJOCO_PHY01_MODEL: unexpected model topology',
  );
  const a = r.arrays;
  demand(
    same(a.body_ipos, [0, 0, 0, 0, 0, 0]) &&
      same(a.body_iquat, [1, 0, 0, 0, 1, 0, 0, 0]) &&
      same(a.body_pos, [0, 0, 0, 0, 0, 2]) &&
      same(a.body_quat, [1, 0, 0, 0, 1, 0, 0, 0]),
    'MUJOCO_PHY01_MODEL: nonzero COM or changed body frame',
  );
  demand(
    finiteArray(a.body_mass, 2) &&
      a.body_mass[0] === 0 &&
      Math.abs(a.body_mass[1] - massKg) <= massKg * f.tolerance.massReadbackRelative,
    'MUJOCO_PHY01_MODEL: mass mismatch',
  );
  const inertia = (2 * massKg * f.sphereRadiusM ** 2) / 5;
  demand(
    finiteArray(a.body_inertia, 6) &&
      a.body_inertia.slice(0, 3).every((v) => v === 0) &&
      a.body_inertia
        .slice(3)
        .every((v) => Math.abs(v - inertia) <= inertia * f.tolerance.massReadbackRelative),
    'MUJOCO_PHY01_MODEL: inertia mismatch',
  );
  demand(
    same(a.jnt_type, [0]) && same(a.jnt_qposadr, [0]) && same(a.jnt_dofadr, [0]),
    'MUJOCO_PHY01_MODEL: free-joint coordinate layout mismatch',
  );
  demand(
    same(a.geom_type, [6, 2]) &&
      same(a.geom_size, [...f.floorHalfExtentsM, f.sphereRadiusM, 0, 0]) &&
      same(a.geom_pos, [0, 0, -0.01, 0, 0, 0]),
    'MUJOCO_PHY01_MODEL: geometry mismatch',
  );
  for (const key of ['dof_damping', 'dof_armature', 'dof_frictionloss', 'jnt_stiffness'])
    demand(zeroArray(a[key]), 'MUJOCO_PHY01_MODEL: nonzero passive parameter ' + key);
  demand(
    same(r.options, {
      timestep: dtUs / 1e6,
      integrator: 3,
      solver: 2,
      jacobian: 0,
      cone: 1,
      iterations: f.solver.iterations,
      tolerance: f.solver.tolerance,
      disableflags: 0,
      enableflags: 0,
      density: 0,
      viscosity: 0,
    }) &&
      same(r.gravity, f.gravity) &&
      same(r.wind, [0, 0, 0]),
    'MUJOCO_PHY01_MODEL: native option mismatch',
  );
  demand(
    same(r.initial.qpos, f.initialQpos) &&
      same(r.initial.qvel, f.initialQvel) &&
      r.initial.time === 0,
    'MUJOCO_PHY01_MODEL: initial state mismatch',
  );
  demand(zeroWarnings(r.warnings), 'MUJOCO_PHY01_MODEL: nonzero initial warning');
  demand(
    r.controls.length === 0 &&
      r.act.length === 0 &&
      zeroArray(r.qfrcApplied) &&
      zeroArray(r.xfrcApplied),
    'MUJOCO_PHY01_MODEL: unexpected initial inputs',
  );
}
export function runPlan(f) {
  validateFixture(f);
  const plan = [];
  for (const dtUs of f.nativeStepUs)
    for (const massKg of f.massesKg)
      for (let repeat = 0; repeat < f.repeats; repeat += 1)
        plan.push({ mode: 'split', massKg, dtUs, repeat });
  for (const dtUs of f.nativeStepUs)
    plan.push({ mode: 'full', massKg: f.phase.referenceMassKg, dtUs, repeat: 0 });
  return plan;
}
function identity(run) {
  return [run.mode, run.massKg, run.dtUs, run.repeat].join('/');
}
function runWorld(M, f, entry, budget, rawRuns) {
  const run = {
    ...entry,
    steps: 0,
    attemptedStepIndex: 0,
    phase: 'before_model_creation',
    samples: [],
    stateDigestByStep: [],
    warningTrajectorySha256: null,
    nativeCalls: {
      mj_step1: { dispatched: 0, returned: 0 },
      mj_step2: { dispatched: 0, returned: 0 },
      mj_step: { dispatched: 0, returned: 0 },
    },
    invariantCounts: {
      step1Preserved: 0,
      finite: 0,
      noContact: 0,
      warningFree: 0,
      zeroInput: 0,
      nativeTime: 0,
    },
    initialReadback: null,
    xmlSha256: null,
    trajectorySha256: null,
    error: null,
    cleanupErrors: [],
  };
  // The run is retained before any model allocation, including failures in cleanup.
  rawRuns.push(run);
  let model;
  let data;
  const trajectory = createHash('sha256');
  const warningTrajectory = createHash('sha256');
  try {
    demand(budget.worlds < f.budget.totalWorlds, 'MUJOCO_PHY01_BUDGET: world limit exceeded');
    budget.worlds += 1;
    const xml = makeModelXml(f, entry.massKg, entry.dtUs);
    run.xmlSha256 = sha256(xml);
    run.phase = 'create_model';
    model = M.MjModel.from_xml_string(xml);
    budget.modelsCreated += 1;
    run.phase = 'create_data';
    data = new M.MjData(model);
    budget.dataCreated += 1;
    run.phase = 'initial_readback';
    run.initialReadback = readModel(model, data);
    validateModelReadback(f, entry.massKg, entry.dtUs, run.initialReadback);
    const target = f.sampleTimesUs.at(-1) / entry.dtUs;
    for (let step = 1; step <= target; step += 1) {
      run.attemptedStepIndex = step;
      run.phase = 'before_native_step';
      demand(
        step <= f.budget.maxStepsPerWorld &&
          budget.nativeStepsDispatched < f.budget.totalNativeSteps,
        'MUJOCO_PHY01_BUDGET: native step limit exceeded',
      );
      demand(
        zeroArray(Array.from(data.ctrl)) &&
          zeroArray(Array.from(data.act)) &&
          zeroArray(Array.from(data.qfrc_applied)) &&
          zeroArray(Array.from(data.xfrc_applied)),
        'MUJOCO_PHY01_RUNTIME: nonzero input before step',
      );
      if (entry.mode === 'split') {
        const before = stateBytes(copyNative(data), f.phase.preserveAcrossStep1);
        run.phase = 'mj_step1';
        run.nativeCalls.mj_step1.dispatched += 1;
        M.mj_step1(model, data);
        run.nativeCalls.mj_step1.returned += 1;
        const after = stateBytes(copyNative(data), f.phase.preserveAcrossStep1);
        demand(before.equals(after), 'MUJOCO_PHY01_PHASE: mj_step1 changed qpos/qvel/time');
        demand(data.ncon === 0 && data.nefc === 0, 'MUJOCO_PHY01_PHASE: contact after mj_step1');
        run.invariantCounts.step1Preserved += 1;
        run.phase = 'mj_step2';
        budget.nativeStepsDispatched += 1;
        run.nativeCalls.mj_step2.dispatched += 1;
        M.mj_step2(model, data);
        run.nativeCalls.mj_step2.returned += 1;
      } else {
        run.phase = 'mj_step';
        budget.nativeStepsDispatched += 1;
        run.nativeCalls.mj_step.dispatched += 1;
        M.mj_step(model, data);
        run.nativeCalls.mj_step.returned += 1;
      }
      budget.nativeStepsCompleted += 1;
      run.steps = step;
      run.phase = 'endpoint_observation';
      const state = copyNative(data);
      run.lastObservation = {
        stepIndex: step,
        phase: run.phase,
        state,
        contactCount: data.ncon,
        constraintCount: data.nefc,
      };
      const bytes = stateBytes(state, f.phase.parityFields);
      demand(
        finiteArray(state.qpos, 7) &&
          finiteArray(state.qvel, 6) &&
          finiteArray(state.qacc, 6) &&
          finiteArray(state.qacc_warmstart, 6) &&
          Number.isFinite(state.time),
        'MUJOCO_PHY01_RUNTIME: non-finite state',
      );
      demand(
        same(state.qpos.slice(3), [1, 0, 0, 0]) && zeroArray(state.qvel.slice(3)),
        'MUJOCO_PHY01_RUNTIME: unexpected rotation',
      );
      run.invariantCounts.finite += 1;
      demand(
        data.ncon === 0 && data.nefc === 0 && data.ntree_awake === model.ntree,
        'MUJOCO_PHY01_RUNTIME: contact, constraint or sleeping tree',
      );
      run.invariantCounts.noContact += 1;
      const warnings = copyWarnings(data);
      run.lastObservation.warnings = warnings;
      demand(zeroWarnings(warnings), 'MUJOCO_PHY01_RUNTIME: native warning');
      run.invariantCounts.warningFree += 1;
      warningTrajectory.update(float64Bytes(warnings.flatMap((w) => [w.number, w.lastinfo])));
      demand(
        zeroArray(Array.from(data.ctrl)) &&
          zeroArray(Array.from(data.act)) &&
          zeroArray(Array.from(data.qfrc_applied)) &&
          zeroArray(Array.from(data.xfrc_applied)),
        'MUJOCO_PHY01_RUNTIME: nonzero applied input',
      );
      run.invariantCounts.zeroInput += 1;
      const timeUs = step * entry.dtUs;
      demand(
        Math.abs(state.time - timeUs / 1e6) <= nativeTimeBudget(step, entry.dtUs),
        'MUJOCO_PHY01_RUNTIME: native time does not match integer schedule',
      );
      run.invariantCounts.nativeTime += 1;
      const digest = sha256(bytes);
      run.stateDigestByStep.push(digest);
      trajectory.update(Buffer.from(digest, 'hex'));
      if (f.sampleTimesUs.includes(timeUs))
        run.samples.push({
          timeUs,
          stepIndex: step,
          nativeTime: state.time,
          position: state.qpos.slice(0, 3),
          quaternion: state.qpos.slice(3),
          velocity: state.qvel.slice(0, 3),
          angularVelocity: state.qvel.slice(3),
          acceleration: state.qacc.slice(0, 3),
          nativeState: state,
          nativeStateHex: bytes.toString('hex'),
          contactCount: data.ncon,
          constraintCount: data.nefc,
          clearanceM: state.qpos[2] - f.sphereRadiusM - f.floorTopZ,
        });
    }
    run.phase = 'complete';
  } catch (error) {
    run.error = String(error);
    if (data) run.failureObservation = failureObservation(data, run.attemptedStepIndex, run.phase);
  } finally {
    if (data) {
      try {
        data.delete();
        budget.dataDeleted += 1;
      } catch (error) {
        run.cleanupErrors.push('data: ' + String(error));
      }
    }
    if (model) {
      try {
        model.delete();
        budget.modelsDeleted += 1;
      } catch (error) {
        run.cleanupErrors.push('model: ' + String(error));
      }
    }
    if (run.cleanupErrors.length)
      run.error = [run.error, ...run.cleanupErrors].filter(Boolean).join('; ');
    run.trajectorySha256 = trajectory.digest('hex');
    run.warningTrajectorySha256 = warningTrajectory.digest('hex');
  }
  return run;
}
export function assessPhy01(f, rawRuns, budget) {
  validateFixture(f);
  const failures = [],
    cases = [],
    convergence = [],
    massIndependence = [],
    repeatability = [],
    phaseParity = [];
  const fail = (s) => failures.push(s);
  const plan = runPlan(f),
    runs = Array.isArray(rawRuns) ? rawRuns : [];
  if (runs.length !== plan.length) fail('incomplete run set');
  const byKey = new Map();
  for (const run of runs) {
    if (!run || !plan.some((e) => identity(e) === identity(run))) {
      fail('invalid case identity');
      continue;
    }
    const key = identity(run);
    if (byKey.has(key)) fail('duplicate case ' + key);
    byKey.set(key, run);
  }
  for (const expected of plan) {
    const key = identity(expected),
      run = byKey.get(key);
    if (!run) {
      fail('missing case ' + key);
      continue;
    }
    const before = failures.length,
      steps = f.sampleTimesUs.at(-1) / run.dtUs;
    if (run.error) fail('runtime error ' + key + ': ' + run.error);
    if (run.steps !== steps) fail('incomplete native steps ' + key);
    try {
      validateModelReadback(f, run.massKg, run.dtUs, run.initialReadback);
    } catch (error) {
      fail(String(error) + ' ' + key);
    }
    const counters = {
      step1Preserved: run.mode === 'split' ? steps : 0,
      finite: steps,
      noContact: steps,
      warningFree: steps,
      zeroInput: steps,
      nativeTime: steps,
    };
    if (!same(run.invariantCounts, counters)) fail('incomplete runtime invariants ' + key);
    if (
      !Array.isArray(run.stateDigestByStep) ||
      run.stateDigestByStep.length !== steps ||
      !run.stateDigestByStep.every(hexDigest)
    )
      fail('incomplete state digests ' + key);
    else if (
      sha256(Buffer.concat(run.stateDigestByStep.map((d) => Buffer.from(d, 'hex')))) !==
      run.trajectorySha256
    )
      fail('trajectory digest mismatch ' + key);
    if (
      run.warningTrajectorySha256 !== zeroWarningTrace(steps, f.warningCount) ||
      !zeroWarnings(run.lastObservation?.warnings)
    )
      fail('incomplete or nonzero native warnings ' + key);
    const splitCalls = run.mode === 'split' ? steps : 0;
    const fullCalls = run.mode === 'full' ? steps : 0;
    if (
      !same(run.nativeCalls, {
        mj_step1: { dispatched: splitCalls, returned: splitCalls },
        mj_step2: { dispatched: splitCalls, returned: splitCalls },
        mj_step: { dispatched: fullCalls, returned: fullCalls },
      }) ||
      run.phase !== 'complete' ||
      run.attemptedStepIndex !== steps ||
      !Array.isArray(run.cleanupErrors) ||
      run.cleanupErrors.length !== 0
    )
      fail('incomplete native call lifecycle ' + key);
    const comparisons = [];
    if (!Array.isArray(run.samples) || run.samples.length !== f.sampleTimesUs.length)
      fail('incomplete samples ' + key);
    else
      for (let i = 0; i < f.sampleTimesUs.length; i += 1) {
        const sample = run.samples[i],
          timeUs = f.sampleTimesUs[i];
        if (
          !sample ||
          sample.timeUs !== timeUs ||
          sample.stepIndex !== timeUs / run.dtUs ||
          !finiteArray(sample.position, 3) ||
          !finiteArray(sample.velocity, 3) ||
          !finiteArray(sample.angularVelocity, 3) ||
          !finiteArray(sample.acceleration, 3) ||
          !same(sample.quaternion, [1, 0, 0, 0]) ||
          !zeroArray(sample.angularVelocity) ||
          !Number.isFinite(sample.nativeTime) ||
          Math.abs(sample.nativeTime - timeUs / 1e6) >
            nativeTimeBudget(sample.stepIndex, run.dtUs) ||
          sample.contactCount !== 0 ||
          sample.constraintCount !== 0 ||
          !Number.isFinite(sample.clearanceM) ||
          sample.clearanceM <= 0 ||
          sample.clearanceM !== sample.position[2] - f.sphereRadiusM - f.floorTopZ
        ) {
          fail('invalid, non-finite or contact sample ' + key + '/' + timeUs);
          continue;
        }
        try {
          const bytes = stateBytes(sample.nativeState, f.phase.parityFields);
          if (
            bytes.toString('hex') !== sample.nativeStateHex ||
            sha256(bytes) !== run.stateDigestByStep[sample.stepIndex - 1] ||
            !same(sample.position, sample.nativeState.qpos.slice(0, 3)) ||
            !same(sample.velocity, sample.nativeState.qvel.slice(0, 3)) ||
            sample.nativeTime !== sample.nativeState.time
          )
            fail('sample state/digest mismatch ' + key + '/' + timeUs);
        } catch (error) {
          fail('invalid native sample state ' + key + ': ' + error);
        }
        const oracle = analyticalAt(f, timeUs);
        const displacement = difference(sample.position, f.initialQpos.slice(0, 3));
        const positionErrorM = norm(difference(displacement, oracle.displacement));
        const velocityErrorMps = norm(difference(sample.velocity, oracle.velocity));
        const pass =
          positionErrorM <= oracle.positionToleranceM &&
          velocityErrorMps <= oracle.velocityToleranceMps;
        if (!pass) fail('analytical tolerance exceeded ' + key + '/' + timeUs);
        comparisons.push({
          timeUs,
          displacement,
          positionErrorM,
          velocityErrorMps,
          ...oracle,
          verdict: pass ? 'PASS' : 'FAIL',
        });
      }
    cases.push({
      key,
      mode: run.mode,
      comparisons,
      verdict: failures.length === before ? 'PASS' : 'FAIL',
    });
  }
  const expectedBudget = {
    worlds: 20,
    modelsCreated: 20,
    dataCreated: 20,
    modelsDeleted: 20,
    dataDeleted: 20,
    nativeStepsDispatched: 24000,
    nativeStepsCompleted: 24000,
  };
  if (!same(budget, expectedBudget)) fail('native resource/work budget incomplete');
  if (failures.length === 0) {
    for (const massKg of f.massesKg)
      for (let repeat = 0; repeat < f.repeats; repeat += 1) {
        const a = byKey.get(identity({ mode: 'split', massKg, dtUs: f.nativeStepUs[0], repeat }));
        const b = byKey.get(identity({ mode: 'split', massKg, dtUs: f.nativeStepUs[1], repeat }));
        let coarseSquared = 0,
          refinedSquared = 0;
        const differences = a.samples.map((sample, i) => {
          const oracle = analyticalAt(f, sample.timeUs);
          coarseSquared +=
            norm(
              difference(
                difference(sample.position, f.initialQpos.slice(0, 3)),
                oracle.displacement,
              ),
            ) ** 2;
          refinedSquared +=
            norm(
              difference(
                difference(b.samples[i].position, f.initialQpos.slice(0, 3)),
                oracle.displacement,
              ),
            ) ** 2;
          return {
            timeUs: sample.timeUs,
            distanceM: norm(difference(sample.position, b.samples[i].position)),
            toleranceM: oracle.positionToleranceM,
          };
        });
        const pass =
          refinedSquared <= coarseSquared && differences.every((v) => v.distanceM <= v.toleranceM);
        if (!pass) fail('step convergence failed');
        convergence.push({
          massKg,
          repeat,
          coarseL2ErrorM: Math.sqrt(coarseSquared),
          refinedL2ErrorM: Math.sqrt(refinedSquared),
          differences,
          verdict: pass ? 'PASS' : 'FAIL',
        });
      }
    for (const dtUs of f.nativeStepUs)
      for (const massKg of f.massesKg) {
        const first = byKey.get(identity({ mode: 'split', massKg, dtUs, repeat: 0 }));
        const pass = Array.from({ length: f.repeats }, (_, repeat) =>
          byKey.get(identity({ mode: 'split', massKg, dtUs, repeat })),
        ).every(
          (r) =>
            r.trajectorySha256 === first.trajectorySha256 &&
            same(r.stateDigestByStep, first.stateDigestByStep) &&
            r.warningTrajectorySha256 === first.warningTrajectorySha256,
        );
        if (!pass) fail('bitwise repeatability mismatch');
        repeatability.push({ dtUs, massKg, verdict: pass ? 'PASS' : 'FAIL' });
      }
    for (const dtUs of f.nativeStepUs)
      for (let repeat = 0; repeat < f.repeats; repeat += 1)
        for (let i = 0; i < f.sampleTimesUs.length; i += 1) {
          const samples = f.massesKg.map(
            (massKg) => byKey.get(identity({ mode: 'split', massKg, dtUs, repeat })).samples[i],
          );
          const oracle = analyticalAt(f, f.sampleTimesUs[i]);
          let positionSpreadM = 0,
            velocitySpreadMps = 0;
          for (const a of samples)
            for (const b of samples) {
              positionSpreadM = Math.max(positionSpreadM, norm(difference(a.position, b.position)));
              velocitySpreadMps = Math.max(
                velocitySpreadMps,
                norm(difference(a.velocity, b.velocity)),
              );
            }
          const pass =
            positionSpreadM <= oracle.positionToleranceM &&
            velocitySpreadMps <= oracle.velocityToleranceMps;
          if (!pass) fail('mass independence failed');
          massIndependence.push({
            dtUs,
            repeat,
            timeUs: f.sampleTimesUs[i],
            positionSpreadM,
            velocitySpreadMps,
            verdict: pass ? 'PASS' : 'FAIL',
          });
        }
    for (const dtUs of f.nativeStepUs) {
      const a = byKey.get(
        identity({ mode: 'split', massKg: f.phase.referenceMassKg, dtUs, repeat: 0 }),
      );
      const b = byKey.get(
        identity({ mode: 'full', massKg: f.phase.referenceMassKg, dtUs, repeat: 0 }),
      );
      const firstMismatch = a.stateDigestByStep.findIndex(
        (hash, i) => hash !== b.stateDigestByStep[i],
      );
      const warningsEqual = a.warningTrajectorySha256 === b.warningTrajectorySha256,
        pass = firstMismatch === -1 && warningsEqual;
      if (!pass) fail('split/full native phase parity mismatch');
      phaseParity.push({
        dtUs,
        comparedNativeSteps: a.steps,
        firstMismatchStep: firstMismatch < 0 ? null : firstMismatch + 1,
        warningsEqual,
        representation: f.phase.parityRepresentation,
        fields: f.phase.parityFields,
        verdict: pass ? 'PASS' : 'FAIL',
      });
    }
  }
  const comparisons = cases.filter((c) => c.mode === 'split').flatMap((c) => c.comparisons);
  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    cases,
    convergence,
    massIndependence,
    repeatability,
    phaseParity,
    summary: {
      expectedWorlds: 20,
      actualWorlds: runs.length,
      expectedMainSamples: 72,
      comparedMainSamples: comparisons.length,
      expectedNativeSteps: 24000,
      completedNativeSteps: budget?.nativeStepsCompleted ?? 0,
      maxPositionErrorM: comparisons.length
        ? Math.max(...comparisons.map((c) => c.positionErrorM))
        : null,
      maxVelocityErrorMps: comparisons.length
        ? Math.max(...comparisons.map((c) => c.velocityErrorMps))
        : null,
    },
  };
}
export async function executePhy01(f = readFixture().fixture) {
  const budget = {
    worlds: 0,
    modelsCreated: 0,
    dataCreated: 0,
    modelsDeleted: 0,
    dataDeleted: 0,
    nativeStepsDispatched: 0,
    nativeStepsCompleted: 0,
  };
  const rawRuns = [];
  let provenance = null;
  let executionError = null;
  let stage = 'admission';
  try {
    validateFixture(f);
    const checked = verifyEngineArtifacts(f);
    const { packageRoot, ...portableProvenance } = checked;
    provenance = portableProvenance;
    stage = 'module_initialization';
    const { default: loadMujoco } = await import(
      pathToFileURL(resolve(packageRoot, 'mujoco.js')).href
    );
    const M = await loadMujoco({
      wasmBinary: readFileSync(resolve(packageRoot, 'mujoco.wasm')),
      locateFile: (name) => {
        demand(name === 'mujoco.wasm', 'MUJOCO_PHY01_ENGINE: unexpected runtime resource');
        return resolve(packageRoot, name);
      },
    });
    const runtimeVersion = M.mj_versionString();
    demand(
      M.mj_version() === 4000000 && runtimeVersion === '4.0.0',
      'MUJOCO_PHY01_ENGINE: native version mismatch',
    );
    provenance = { ...portableProvenance, runtimeVersion };
    stage = 'native_worlds';
    for (const entry of runPlan(f)) {
      const run = runWorld(M, f, entry, budget, rawRuns);
      if (run.error) break;
    }
  } catch (error) {
    executionError = stage + ': ' + String(error);
  }
  let assessment;
  try {
    assessment = assessPhy01(f, rawRuns, budget);
  } catch (error) {
    assessment = {
      verdict: 'FAIL',
      failures: ['assessment: ' + String(error)],
      cases: [],
      convergence: [],
      massIndependence: [],
      repeatability: [],
      phaseParity: [],
      summary: {
        expectedWorlds: 20,
        actualWorlds: rawRuns.length,
        expectedMainSamples: 72,
        comparedMainSamples: 0,
        expectedNativeSteps: 24000,
        completedNativeSteps: budget.nativeStepsCompleted,
        maxPositionErrorM: null,
        maxVelocityErrorMps: null,
      },
    };
  }
  if (executionError) {
    assessment.verdict = 'FAIL';
    assessment.failures.unshift(executionError);
  }
  // All ordinary exceptions after allocation retain this partial execution envelope.
  return { provenance, budget, rawRuns, assessment, executionError };
}
