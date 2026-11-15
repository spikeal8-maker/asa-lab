import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import YAML from 'yaml';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixturePath = resolve(repoRoot, 'tests/robotics/field-core-qualification/phy01.fixture.json');
const require = createRequire(import.meta.url);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const norm = (v) => Math.hypot(v.x, v.y, v.z);
const difference = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const vectorFinite = (v) => v && ['x', 'y', 'z'].every((axis) => Number.isFinite(v[axis]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const demand = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function readFixture() {
  const bytes = readFileSync(fixturePath);
  return { fixture: JSON.parse(bytes.toString('utf8')), fixtureSha256: sha256(bytes) };
}

export function validateFixture(f) {
  const exact = (actual, expected, name) =>
    demand(same(actual, expected), 'PHY01_FIXTURE: unexpected ' + name);
  exact(f.id, 'PHY-01-v1', 'id');
  exact(f.scope, 'TEST_ONLY', 'scope');
  exact(f.massesKg, [0.02, 0.5, 2], 'masses');
  exact(f.sampleTimesUs, [100000, 200000, 300000, 400000], 'sample times');
  exact(f.gravity, { x: 0, y: 0, z: -9.81 }, 'gravity');
  exact(f.initialPosition, { x: 0, y: 0, z: 2 }, 'initial position');
  exact(f.initialVelocity, { x: 0, y: 0, z: 0 }, 'initial velocity');
  exact(f.initialAngularVelocity, { x: 0, y: 0, z: 0 }, 'initial angular velocity');
  exact([f.macroStepUs, f.substeps, f.repeats, f.seed], [5000, [4, 8], 3, 0], 'step/repeat/seed');
  exact(
    f.tolerance,
    {
      positionAbsoluteM: 0.0001,
      velocityAbsoluteMps: 0.001,
      relative: 0.01,
      massReadbackRelative: 0.000001,
    },
    'tolerances',
  );
  exact(
    [f.linearDamping, f.angularDamping, f.friction, f.restitution, f.canSleep, f.ccdEnabled],
    [0, 0, 0, 0, false, true],
    'losses/sleep/CCD',
  );
  exact([f.sphereRadiusM, f.floorTopZ, f.floorHalfExtentsM], [0.02, 0, [5, 5, 0.01]], 'geometry');
  exact(f.maxStepsPerWorld, 640, 'work budget');
  exact(
    f.solver,
    {
      numSolverIterations: 4,
      numInternalPgsIterations: 1,
      minIslandSize: 128,
      maxCcdSubsteps: 1,
      lengthUnit: 1,
      normalizedAllowedLinearError: 0.001,
      normalizedPredictionDistance: 0.002,
    },
    'solver settings',
  );
  for (const count of f.substeps) {
    const dtUs = f.macroStepUs / count;
    demand(Number.isSafeInteger(dtUs) && dtUs > 0, 'PHY01_FIXTURE: invalid step');
    demand(
      f.sampleTimesUs.every((time) => time % dtUs === 0),
      'PHY01_FIXTURE: fractional sample',
    );
    demand(
      f.sampleTimesUs.at(-1) / dtUs <= f.maxStepsPerWorld,
      'PHY01_FIXTURE: work budget exceeded',
    );
  }
  return f;
}

/** Checks local frozen artifacts before importing or initializing WASM. No network is used here. */
export function verifyEngineArtifacts(
  f,
  packageRoot = dirname(require.resolve('@dimforge/rapier3d-compat')),
) {
  const pkgBytes = readFileSync(resolve(packageRoot, 'package.json'));
  const pkg = JSON.parse(pkgBytes.toString('utf8'));
  demand(
    pkg.name === f.engine.package && pkg.version === f.engine.version,
    'PHY01_ENGINE: package pin mismatch',
  );
  demand(pkg.license === f.engine.license, 'PHY01_ENGINE: license metadata mismatch');
  const wasm = readFileSync(resolve(packageRoot, 'rapier_wasm3d_bg.wasm'));
  const moduleBytes = readFileSync(resolve(packageRoot, 'rapier.mjs'));
  const license = readFileSync(resolve(repoRoot, 'tools/robotics-field-core/RAPIER-LICENSE.txt'));
  for (const [bytes, expected, name] of [
    [pkgBytes, f.engine.packageJsonSha256, 'package.json'],
    [wasm, f.engine.wasmSha256, 'WASM'],
    [moduleBytes, f.engine.moduleSha256, 'ESM'],
    [license, f.engine.licenseSha256, 'license'],
  ])
    demand(sha256(bytes) === expected, 'PHY01_ENGINE: hash mismatch ' + name);
  demand(
    moduleBytes.toString('utf8').includes(wasm.toString('base64')),
    'PHY01_ENGINE: embedded WASM differs from hashed binary',
  );
  const lock = YAML.parse(readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8'));
  const key = f.engine.package + '@' + f.engine.version;
  demand(
    lock.packages[key]?.resolution?.integrity === f.engine.integrity,
    'PHY01_ENGINE: lockfile integrity mismatch',
  );
  const declared = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  demand(
    declared.devDependencies[f.engine.package] === f.engine.version,
    'PHY01_ENGINE: root exact version mismatch',
  );
  const importer = lock.importers['.'].devDependencies[f.engine.package];
  demand(
    importer.specifier === f.engine.version && importer.version === f.engine.version,
    'PHY01_ENGINE: importer version mismatch',
  );
  return {
    ...f.engine,
    wasmBytes: wasm.length,
    moduleBytes: moduleBytes.length,
    embeddedWasmMatches: true,
    networkRequiredForRun: false,
  };
}

export function sourceManifest() {
  return Object.fromEntries(
    [
      'tools/robotics-field-core/phy01.mjs',
      'tools/robotics-field-core/run-phy01.mjs',
      'tools/robotics-field-core/RAPIER-LICENSE.txt',
      'tests/robotics/field-core-qualification/phy01.fixture.json',
      'tests/robotics/field-core-qualification/phy01.spec.ts',
    ].map((path) => [path, sha256(readFileSync(resolve(repoRoot, path)))]),
  );
}

/** Independent analytical oracle: never used by the dynamics runner to write engine states. */
export function analyticalAt(f, timeUs) {
  const t = timeUs / 1e6;
  const displacement = Object.fromEntries(
    ['x', 'y', 'z'].map((a) => [a, (f.gravity[a] * t * t) / 2]),
  );
  const velocity = Object.fromEntries(['x', 'y', 'z'].map((a) => [a, f.gravity[a] * t]));
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

function runWorld(R, f, massKg, substeps, repeat) {
  const world = new R.World(f.gravity);
  const dtUs = f.macroStepUs / substeps;
  try {
    world.timestep = dtUs / 1e6;
    for (const [key, value] of Object.entries(f.solver)) world.integrationParameters[key] = value;
    const floor = world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(0, 0, f.floorTopZ - f.floorHalfExtentsM[2]),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(...f.floorHalfExtentsM)
        .setFriction(0)
        .setRestitution(0),
      floor,
    );
    const p = f.initialPosition;
    const v = f.initialVelocity;
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setLinvel(v.x, v.y, v.z)
        .setAngvel(f.initialAngularVelocity)
        .setLinearDamping(f.linearDamping)
        .setAngularDamping(f.angularDamping)
        .setCanSleep(f.canSleep)
        .setCcdEnabled(f.ccdEnabled),
    );
    // Only the collider supplies mass. No additional rigid-body mass or manual velocity updates.
    const collider = world.createCollider(
      R.ColliderDesc.ball(f.sphereRadiusM)
        .setMass(massKg)
        .setFriction(f.friction)
        .setRestitution(f.restitution),
      body,
    );
    body.recomputeMassPropertiesFromColliders();
    const initial = {
      position: body.translation(),
      velocity: body.linvel(),
      angularVelocity: body.angvel(),
      bodyMassKg: body.mass(),
      colliderMassKg: collider.mass(),
    };
    const solverReadback = Object.fromEntries(
      Object.keys(f.solver).map((key) => [key, world.integrationParameters[key]]),
    );
    const samples = [];
    let steps = 0;
    let contactCount = 0;
    for (const timeUs of f.sampleTimesUs) {
      const target = timeUs / dtUs;
      while (steps < target) {
        demand(steps < f.maxStepsPerWorld, 'PHY01_RUNTIME: work budget exceeded');
        world.step();
        steps += 1;
        demand(
          vectorFinite(body.translation()) &&
            vectorFinite(body.linvel()) &&
            vectorFinite(body.angvel()),
          'PHY01_RUNTIME: non-finite engine state',
        );
        world.contactPairsWith(collider, () => {
          contactCount += 1;
        });
      }
      const position = body.translation();
      samples.push({
        timeUs,
        stepIndex: steps,
        position,
        velocity: body.linvel(),
        angularVelocity: body.angvel(),
        contactCount,
        clearanceM: position.z - f.sphereRadiusM - f.floorTopZ,
      });
    }
    return {
      massKg,
      substeps,
      repeat,
      dtUs,
      engineDtSeconds: world.timestep,
      initial,
      solverReadback,
      steps,
      samples,
    };
  } finally {
    world.free();
  }
}

export async function executePhy01(f = readFixture().fixture) {
  validateFixture(f);
  const provenance = verifyEngineArtifacts(f);
  const R = (await import('@dimforge/rapier3d-compat')).default;
  await R.init();
  const rawRuns = [];
  for (const substeps of f.substeps) {
    for (const massKg of f.massesKg) {
      for (let repeat = 0; repeat < f.repeats; repeat += 1) {
        rawRuns.push(runWorld(R, f, massKg, substeps, repeat));
      }
    }
  }
  return {
    provenance: { ...provenance, runtimeVersion: R.version() },
    rawRuns,
    assessment: assessPhy01(f, rawRuns),
  };
}

/** Fails closed on missing, duplicate, malformed, non-finite or out-of-tolerance observations. */
export function assessPhy01(f, rawRuns) {
  validateFixture(f);
  const failures = [];
  const cases = [];
  const convergence = [];
  const massIndependence = [];
  const repeatability = [];
  const fail = (message) => failures.push(message);
  const expectedCount = f.substeps.length * f.massesKg.length * f.repeats;
  if (!Array.isArray(rawRuns) || rawRuns.length !== expectedCount) fail('incomplete run set');
  const runs = Array.isArray(rawRuns) ? rawRuns : [];
  const byKey = new Map();
  for (const run of runs) {
    if (
      !run ||
      !f.massesKg.includes(run.massKg) ||
      !f.substeps.includes(run.substeps) ||
      !Number.isInteger(run.repeat) ||
      run.repeat < 0 ||
      run.repeat >= f.repeats
    ) {
      fail('invalid case identity');
      continue;
    }
    const key = [run.massKg, run.substeps, run.repeat].join('/');
    if (byKey.has(key)) fail('duplicate case ' + key);
    byKey.set(key, run);
  }
  for (const substeps of f.substeps)
    for (const massKg of f.massesKg) {
      for (let repeat = 0; repeat < f.repeats; repeat += 1) {
        const key = [massKg, substeps, repeat].join('/');
        const run = byKey.get(key);
        if (!run) {
          fail('missing case ' + key);
          continue;
        }
        const before = failures.length;
        const dtUs = f.macroStepUs / substeps;
        if (
          run.dtUs !== dtUs ||
          run.steps !== f.sampleTimesUs.at(-1) / dtUs ||
          !Number.isFinite(run.engineDtSeconds) ||
          Math.abs(run.engineDtSeconds - dtUs / 1e6) > (dtUs / 1e6) * 1e-6
        )
          fail('invalid time metadata ' + key);
        if (
          !run.initial ||
          !vectorFinite(run.initial.position) ||
          !vectorFinite(run.initial.velocity) ||
          !vectorFinite(run.initial.angularVelocity) ||
          norm(difference(run.initial.position, f.initialPosition)) !== 0 ||
          norm(run.initial.velocity) !== 0 ||
          norm(run.initial.angularVelocity) !== 0
        )
          fail('invalid initial state ' + key);
        for (const name of ['bodyMassKg', 'colliderMassKg']) {
          const mass = run.initial?.[name];
          if (
            !Number.isFinite(mass) ||
            Math.abs(mass - massKg) > massKg * f.tolerance.massReadbackRelative
          )
            fail('invalid realized mass ' + key + '/' + name);
        }
        for (const [setting, value] of Object.entries(f.solver)) {
          const actual = run.solverReadback?.[setting];
          if (!Number.isFinite(actual) || Math.abs(actual - value) > Math.abs(value) * 1e-6)
            fail('invalid solver readback ' + key + '/' + setting);
        }
        if (!Array.isArray(run.samples) || run.samples.length !== f.sampleTimesUs.length) {
          fail('incomplete samples ' + key);
          continue;
        }
        const comparisons = [];
        for (let index = 0; index < f.sampleTimesUs.length; index += 1) {
          const timeUs = f.sampleTimesUs[index];
          const sample = run.samples[index];
          if (
            !sample ||
            sample.timeUs !== timeUs ||
            sample.stepIndex !== timeUs / dtUs ||
            !vectorFinite(sample.position) ||
            !vectorFinite(sample.velocity) ||
            !vectorFinite(sample.angularVelocity) ||
            !Number.isFinite(sample.clearanceM) ||
            sample.contactCount !== 0 ||
            sample.clearanceM <= 0 ||
            Math.abs(sample.clearanceM - (sample.position.z - f.sphereRadiusM - f.floorTopZ)) >
              1e-12
          ) {
            fail('invalid/non-finite/contact sample ' + key + '/' + index);
            continue;
          }
          const oracle = analyticalAt(f, timeUs);
          const displacement = difference(sample.position, f.initialPosition);
          const positionErrorM = norm(difference(displacement, oracle.displacement));
          const velocityErrorMps = norm(difference(sample.velocity, oracle.velocity));
          const pass =
            positionErrorM <= oracle.positionToleranceM &&
            velocityErrorMps <= oracle.velocityToleranceMps;
          if (!pass) fail('analytical tolerance exceeded ' + key + '/' + timeUs);
          comparisons.push({
            timeUs,
            actualDisplacement: displacement,
            expectedDisplacement: oracle.displacement,
            expectedVelocity: oracle.velocity,
            accelerationZFromVelocityMps2: sample.velocity.z / (timeUs / 1e6),
            positionErrorM,
            velocityErrorMps,
            positionToleranceM: oracle.positionToleranceM,
            velocityToleranceMps: oracle.velocityToleranceMps,
            verdict: pass ? 'PASS' : 'FAIL',
          });
        }
        cases.push({
          key,
          massKg,
          substeps,
          repeat,
          comparisons,
          verdict: failures.length === before ? 'PASS' : 'FAIL',
        });
      }
    }
  // Do not derive a convergence/repeatability PASS from an incomplete run.
  if (failures.length === 0) {
    for (const massKg of f.massesKg)
      for (let repeat = 0; repeat < f.repeats; repeat += 1) {
        const coarse = byKey.get([massKg, f.substeps[0], repeat].join('/'));
        const refined = byKey.get([massKg, f.substeps[1], repeat].join('/'));
        let coarseSquared = 0;
        let refinedSquared = 0;
        const differences = [];
        for (let i = 0; i < f.sampleTimesUs.length; i += 1) {
          const timeUs = f.sampleTimesUs[i];
          const oracle = analyticalAt(f, timeUs);
          const a = difference(coarse.samples[i].position, f.initialPosition);
          const b = difference(refined.samples[i].position, f.initialPosition);
          const distanceM = norm(difference(a, b));
          coarseSquared += norm(difference(a, oracle.displacement)) ** 2;
          refinedSquared += norm(difference(b, oracle.displacement)) ** 2;
          if (distanceM > oracle.positionToleranceM) fail('step convergence tolerance exceeded');
          differences.push({ timeUs, distanceM, toleranceM: oracle.positionToleranceM });
        }
        const coarseL2ErrorM = Math.sqrt(coarseSquared);
        const refinedL2ErrorM = Math.sqrt(refinedSquared);
        if (refinedL2ErrorM > coarseL2ErrorM) fail('refinement did not reduce displacement error');
        convergence.push({
          massKg,
          repeat,
          coarseL2ErrorM,
          refinedL2ErrorM,
          differences,
          verdict:
            refinedL2ErrorM <= coarseL2ErrorM &&
            differences.every((x) => x.distanceM <= x.toleranceM)
              ? 'PASS'
              : 'FAIL',
        });
      }
    for (const substeps of f.substeps)
      for (const massKg of f.massesKg) {
        const first = byKey.get([massKg, substeps, 0].join('/'));
        const pass = Array.from({ length: f.repeats }, (_, repeat) => repeat).every((repeat) =>
          same(first.samples, byKey.get([massKg, substeps, repeat].join('/')).samples),
        );
        if (!pass) fail('repeatability mismatch');
        repeatability.push({ substeps, massKg, verdict: pass ? 'PASS' : 'FAIL' });
      }
    for (const substeps of f.substeps)
      for (let repeat = 0; repeat < f.repeats; repeat += 1) {
        for (let i = 0; i < f.sampleTimesUs.length; i += 1) {
          const timeUs = f.sampleTimesUs[i];
          const oracle = analyticalAt(f, timeUs);
          const samples = f.massesKg.map(
            (massKg) => byKey.get([massKg, substeps, repeat].join('/')).samples[i],
          );
          let positionSpreadM = 0;
          let velocitySpreadMps = 0;
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
          if (!pass) fail('mass dependence outside tolerance');
          massIndependence.push({
            substeps,
            repeat,
            timeUs,
            positionSpreadM,
            velocitySpreadMps,
            verdict: pass ? 'PASS' : 'FAIL',
          });
        }
      }
  }
  const comparisons = cases.flatMap((x) => x.comparisons);
  return {
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    cases,
    convergence,
    massIndependence,
    repeatability,
    summary: {
      expectedRuns: expectedCount,
      actualRuns: runs.length,
      expectedSamples: expectedCount * f.sampleTimesUs.length,
      comparedSamples: comparisons.length,
      maxPositionErrorM: comparisons.length
        ? Math.max(...comparisons.map((x) => x.positionErrorM))
        : null,
      maxVelocityErrorMps: comparisons.length
        ? Math.max(...comparisons.map((x) => x.velocityErrorMps))
        : null,
      maxPositionToleranceRatio: comparisons.length
        ? Math.max(...comparisons.map((x) => x.positionErrorM / x.positionToleranceM))
        : null,
      maxVelocityToleranceRatio: comparisons.length
        ? Math.max(...comparisons.map((x) => x.velocityErrorMps / x.velocityToleranceMps))
        : null,
    },
  };
}
