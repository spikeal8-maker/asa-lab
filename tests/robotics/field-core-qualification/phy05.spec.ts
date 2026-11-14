import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Collider, Vector, World } from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import {
  readFixture,
  sha256,
  validateFixture,
  verifyEngineArtifacts,
} from '../../../tools/robotics-field-core/phy01.mjs';
import fixture from './phy05.fixture.json';

const FIXTURE_SHA256 = 'b70a650580c8c953a7f652dc5f2d116d7838d8d0697443e6d2d6caf95550964f';
const fixtureUrl = new URL('./phy05.fixture.json', import.meta.url);
const specificationUrl = new URL('../../../' + fixture.specification.path, import.meta.url);
const artifactVerifierUrl = new URL(
  '../../../tools/robotics-field-core/phy01.mjs',
  import.meta.url,
);
const theta = (fixture.slopeDegrees * Math.PI) / 180;
const downhill = { x: Math.cos(theta), y: 0, z: -Math.sin(theta) };
const normal = { x: Math.sin(theta), y: 0, z: Math.cos(theta) };
const crossSlope = { x: 0, y: 1, z: 0 };
const radius = fixture.sphereRadiusM;
const inertia = (2 * fixture.sphereMassKg * radius ** 2) / 5;
const linearReference =
  (fixture.gravityMps2 * Math.sin(theta)) / (1 + inertia / (fixture.sphereMassKg * radius ** 2));
const angularReference = linearReference / radius;
const dtUs = fixture.macroStepUs / fixture.substeps;
const windowStart = fixture.analysisTimesUs[0]!;
const windowSteps = (fixture.durationUs - windowStart) / dtUs + 1;

const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vector, factor: number) => ({
  x: a.x * factor,
  y: a.y * factor,
  z: a.z * factor,
});
const sum = (a: Vector, b: Vector) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const cross = (a: Vector, b: Vector) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const magnitude = (a: Vector) => Math.hypot(a.x, a.y, a.z);
const finiteVector = (a: Vector) => [a.x, a.y, a.z].every(Number.isFinite);
const contactArm = scale(normal, -radius);

interface ContactObservation {
  normal: Vector;
  solverContacts: number;
  normalImpulsesNs: number[];
}

interface StepObservation {
  timeUs: number;
  position: Vector;
  rotation: { x: number; y: number; z: number; w: number };
  velocity: Vector;
  angularVelocity: Vector;
  pairs: ('slope' | 'other')[];
  contacts: ContactObservation[];
}

function measureEndpoint(step: StepObservation) {
  const clearance = dot(step.position, normal) - radius;
  const normalSpeed = Math.abs(dot(step.velocity, normal));
  const velocityAtPole = sum(step.velocity, cross(step.angularVelocity, contactArm));
  const slip = magnitude(sum(velocityAtPole, scale(normal, -dot(velocityAtPole, normal))));
  return { clearance, normalSpeed, slip };
}

function hasSupportingContact(step: StepObservation): boolean {
  return (
    step.pairs.length === 1 &&
    step.pairs[0] === 'slope' &&
    step.contacts.some(
      (contact) =>
        finiteVector(contact.normal) &&
        magnitude(sum(contact.normal, scale(normal, -1))) <=
          fixture.tolerance.supportNormalDistance &&
        contact.solverContacts > 0 &&
        contact.normalImpulsesNs.some((impulse) => Number.isFinite(impulse) && impulse > 0),
    )
  );
}

function externalEvidencePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (!isAbsolute(path)) throw new Error('PHY05_EVIDENCE_OUT must be an absolute external path');
  const repository = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  const directory = realpathSync(dirname(path));
  const fromRepository = relative(repository, directory).replaceAll('\\', '/');
  if (!isAbsolute(fromRepository) && fromRepository !== '..' && !fromRepository.startsWith('../'))
    throw new Error('PHY05_EVIDENCE_OUT must be outside the checkout');
  return join(directory, basename(path));
}

function checkSupport(step: StepObservation) {
  const measurement = measureEndpoint(step);
  return {
    ...measurement,
    contact: hasSupportingContact(step),
    geometry:
      Math.abs(measurement.clearance) <= fixture.tolerance.supportGapM &&
      measurement.normalSpeed <= fixture.tolerance.normalVelocityMps &&
      Math.abs(dot(step.position, downhill)) < fixture.planeHalfExtentsM[0]! - radius &&
      Math.abs(step.position.y) < fixture.planeHalfExtentsM[1]! - radius,
    noSlip: measurement.slip <= fixture.tolerance.tangentialSlipMps,
  };
}

function observeContacts(world: World, slope: Collider, sphere: Collider) {
  const pairs: StepObservation['pairs'] = [];
  const contacts: ContactObservation[] = [];
  world.contactPairsWith(sphere, (other) => {
    pairs.push(other.handle === slope.handle ? 'slope' : 'other');
  });
  world.contactPair(slope, sphere, (manifold, flipped) => {
    // Copy from the temporary native wrapper inside this callback. World owns the wrapper.
    const worldNormal = manifold.normal();
    const normalImpulsesNs = [];
    for (let index = 0; index < manifold.numContacts(); index++) {
      normalImpulsesNs.push(manifold.contactImpulse(index));
    }
    contacts.push({
      normal: scale(worldNormal, flipped ? -1 : 1),
      solverContacts: manifold.numSolverContacts(),
      normalImpulsesNs,
    });
  });
  return { pairs, contacts };
}

function isFiniteObservation(step: StepObservation) {
  return (
    [step.position, step.rotation, step.velocity, step.angularVelocity].every(finiteVector) &&
    Number.isFinite(step.rotation.w) &&
    step.contacts.every(
      (contact) =>
        finiteVector(contact.normal) &&
        Number.isSafeInteger(contact.solverContacts) &&
        contact.solverContacts >= 0 &&
        contact.normalImpulsesNs.every(Number.isFinite),
    )
  );
}

function assessMotion(steps: readonly StepObservation[]) {
  const window = steps.filter((step) => step.timeUs >= windowStart);
  const samples = window.filter((step) => fixture.analysisTimesUs.includes(step.timeUs));
  const firstNonFinite = steps.find((step) => !isFiniteObservation(step))?.timeUs ?? null;
  const firstUnsupported = window.find((step) => !checkSupport(step).contact)?.timeUs ?? null;
  const firstBadGeometry = window.find((step) => !checkSupport(step).geometry)?.timeUs ?? null;
  const firstSlip = window.find((step) => !checkSupport(step).noSlip)?.timeUs ?? null;
  const support = window.map(measureEndpoint);
  const scheduleExact =
    steps.length === fixture.maxStepsPerWorld &&
    steps.every((step, index) => step.timeUs === (index + 1) * dtUs) &&
    window.length === windowSteps &&
    samples.every((step, index) => step.timeUs === fixture.analysisTimesUs[index]) &&
    samples.length === fixture.analysisTimesUs.length;
  const supported =
    scheduleExact &&
    firstNonFinite === null &&
    firstUnsupported === null &&
    firstBadGeometry === null &&
    firstSlip === null;
  const acceleration = supported
    ? samples.slice(1).map((end, index) => {
        const start = samples[index]!;
        const dt = (end.timeUs - start.timeUs) / 1e6;
        const linear = (dot(end.velocity, downhill) - dot(start.velocity, downhill)) / dt;
        const angular =
          (dot(end.angularVelocity, crossSlope) - dot(start.angularVelocity, crossSlope)) / dt;
        return {
          startUs: start.timeUs,
          endUs: end.timeUs,
          linearMps2: linear,
          angularRadps2: angular,
          linearRelativeError: Math.abs(linear / linearReference - 1),
          angularRelativeError: Math.abs(angular / angularReference - 1),
        };
      })
    : [];
  const passed =
    supported &&
    acceleration.every(
      ({ linearRelativeError, angularRelativeError }) =>
        linearRelativeError <= fixture.tolerance.relativeAcceleration &&
        angularRelativeError <= fixture.tolerance.relativeAcceleration,
    );
  return {
    passed,
    scheduleExact,
    firstNonFinite,
    firstUnsupported,
    firstBadGeometry,
    firstSlip,
    maxSlipMps: Math.max(0, ...support.map(({ slip }) => slip)),
    maxAbsoluteClearanceM: Math.max(0, ...support.map(({ clearance }) => Math.abs(clearance))),
    maxNormalSpeedMps: Math.max(0, ...support.map(({ normalSpeed }) => normalSpeed)),
    windowSteps: window.length,
    acceleration,
  };
}

type Rapier = (typeof import('@dimforge/rapier3d-compat'))['default'];

function runNominalWorld(R: Rapier, solver: Record<string, number>) {
  const world = new R.World({ x: 0, y: 0, z: -fixture.gravityMps2 });
  try {
    world.timestep = dtUs / 1e6;
    for (const [key, value] of Object.entries(solver)) {
      Reflect.set(world.integrationParameters, key, value);
    }
    const [halfLength, halfWidth, halfHeight] = fixture.planeHalfExtentsM;
    const center = scale(normal, -halfHeight!);
    const slopeBody = world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: 0, y: Math.sin(theta / 2), z: 0, w: Math.cos(theta / 2) }),
    );
    const slope = world.createCollider(
      R.ColliderDesc.cuboid(halfLength!, halfWidth!, halfHeight!)
        .setFriction(fixture.friction)
        .setRestitution(fixture.restitution)
        .setFrictionCombineRule(R.CoefficientCombineRule.Average),
      slopeBody,
    );
    const initialPosition = scale(normal, radius);
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(initialPosition.x, initialPosition.y, initialPosition.z)
        .setLinearDamping(fixture.linearDamping)
        .setAngularDamping(fixture.angularDamping)
        .setCanSleep(fixture.canSleep)
        .setCcdEnabled(fixture.ccdEnabled),
    );
    const sphere = world.createCollider(
      R.ColliderDesc.ball(radius)
        .setMass(fixture.sphereMassKg)
        .setFriction(fixture.friction)
        .setRestitution(fixture.restitution)
        .setFrictionCombineRule(R.CoefficientCombineRule.Average),
      body,
    );
    body.recomputeMassPropertiesFromColliders();
    const configuration = {
      solver: Object.fromEntries(
        Object.keys(solver).map((key) => [key, Reflect.get(world.integrationParameters, key)]),
      ),
      engineDtSeconds: world.timestep,
      sphereRadiusM: sphere.radius(),
      massKg: body.mass(),
      colliderMassKg: sphere.mass(),
      inertia: body.principalInertia(),
      friction: [slope.friction(), sphere.friction()],
      restitution: [slope.restitution(), sphere.restitution()],
      frictionCombine: [slope.frictionCombineRule(), sphere.frictionCombineRule()],
      expectedFrictionCombine: R.CoefficientCombineRule.Average,
      gravity: world.gravity,
      linearDamping: body.linearDamping(),
      angularDamping: body.angularDamping(),
      ccdEnabled: body.isCcdEnabled(),
      initialPosition: body.translation(),
      initialVelocity: body.linvel(),
      initialAngularVelocity: body.angvel(),
      slopeCenter: slopeBody.translation(),
      slopeRotation: slopeBody.rotation(),
      slopeHalfExtents: slope.halfExtents(),
      slopeFixed: slopeBody.isFixed(),
      sphereLocalCom: body.localCom(),
      contactSkin: [slope.contactSkin(), sphere.contactSkin()],
    };
    assertConfiguration(configuration, solver);
    const steps = [];
    for (let index = 1; index <= fixture.maxStepsPerWorld; index++) {
      world.step();
      steps.push({
        timeUs: index * dtUs,
        position: body.translation(),
        rotation: body.rotation(),
        velocity: body.linvel(),
        angularVelocity: body.angvel(),
        ...observeContacts(world, slope, sphere),
      });
    }
    return { configuration, steps };
  } finally {
    world.free();
  }
}

function assertConfiguration(
  configuration: ReturnType<typeof runNominalWorld>['configuration'],
  solver: Record<string, number>,
) {
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
      Math.max(1e-12, Math.abs(expected) * fixture.tolerance.artifactReadbackRelative),
    );
  near(configuration.engineDtSeconds, dtUs / 1e6);
  near(configuration.massKg, fixture.sphereMassKg);
  near(configuration.colliderMassKg, fixture.sphereMassKg);
  near(configuration.sphereRadiusM, radius);
  for (const axis of ['x', 'y', 'z'] as const) {
    near(configuration.inertia[axis], inertia);
    near(configuration.initialPosition[axis], radius * normal[axis]);
    near(configuration.slopeCenter[axis], -fixture.planeHalfExtentsM[2]! * normal[axis]);
  }
  near(configuration.slopeHalfExtents.x, fixture.planeHalfExtentsM[0]!);
  near(configuration.slopeHalfExtents.y, fixture.planeHalfExtentsM[1]!);
  near(configuration.slopeHalfExtents.z, fixture.planeHalfExtentsM[2]!);
  near(configuration.slopeRotation.x, 0);
  near(configuration.slopeRotation.y, Math.sin(theta / 2));
  near(configuration.slopeRotation.z, 0);
  near(configuration.slopeRotation.w, Math.cos(theta / 2));
  near(configuration.gravity.x, 0);
  near(configuration.gravity.y, 0);
  near(configuration.gravity.z, -fixture.gravityMps2);
  for (const [key, value] of Object.entries(solver)) near(configuration.solver[key], value);
  expect(configuration.initialVelocity).toEqual({ x: 0, y: 0, z: 0 });
  expect(configuration.initialAngularVelocity).toEqual({ x: 0, y: 0, z: 0 });
  expect(configuration.friction).toEqual([fixture.friction, fixture.friction]);
  expect(configuration.restitution).toEqual([fixture.restitution, fixture.restitution]);
  expect(configuration.frictionCombine).toEqual([
    configuration.expectedFrictionCombine,
    configuration.expectedFrictionCombine,
  ]);
  expect(configuration.linearDamping).toBe(fixture.linearDamping);
  expect(configuration.angularDamping).toBe(fixture.angularDamping);
  expect(configuration.ccdEnabled).toBe(fixture.ccdEnabled);
  expect(configuration.slopeFixed).toBe(true);
  expect(configuration.sphereLocalCom).toEqual({ x: 0, y: 0, z: 0 });
  expect(configuration.contactSkin).toEqual([0, 0]);
}

function syntheticObservations(): StepObservation[] {
  return Array.from({ length: fixture.maxStepsPerWorld }, (_, index) => {
    const timeUs = (index + 1) * dtUs;
    const time = timeUs / 1e6;
    return {
      timeUs,
      position: sum(scale(normal, radius), scale(downhill, 0.5 * linearReference * time ** 2)),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: scale(downhill, time * linearReference),
      angularVelocity: scale(crossSlope, time * angularReference),
      pairs: ['slope'],
      contacts: [{ normal, solverContacts: 1, normalImpulsesNs: [0.001] }],
    };
  });
}

describe('PHY-05 oracle admission (pure)', () => {
  it('pins the fixture bytes, assumptions and normative spec before dynamics', () => {
    expect(sha256(readFileSync(fixtureUrl))).toBe(FIXTURE_SHA256);
    expect(sha256(readFileSync(specificationUrl))).toBe(fixture.specification.sha256);
    expect(dtUs * fixture.maxStepsPerWorld).toBe(fixture.durationUs);
    expect(fixture.analysisTimesUs.every((time) => time % dtUs === 0)).toBe(true);
    expect(linearReference).toBeCloseTo(1.2167775877947, 12);
    expect(angularReference).toBeCloseTo(24.335551755894, 11);
  });

  it('admits supported reference kinematics, rejects missing support or slip before judging acceleration', () => {
    const original = syntheticObservations();
    const first = original.findIndex((step) => step.timeUs === windowStart);
    const step = original[first]!;
    expect(assessMotion(original)).toMatchObject({ passed: true, windowSteps });
    for (const changed of [
      { ...step, pairs: ['other'] as const },
      { ...step, contacts: [{ ...step.contacts[0]!, normal: scale(normal, -1) }] },
      { ...step, contacts: [{ ...step.contacts[0]!, normalImpulsesNs: [0] }] },
      { ...step, velocity: sum(step.velocity, scale(crossSlope, 0.002)) },
      { ...step, position: sum(step.position, scale(normal, 0.002)) },
      { ...step, velocity: { ...step.velocity, z: Number.NaN } },
      { ...step, timeUs: step.timeUs + 1 },
    ]) {
      const altered = original.slice();
      altered[first] = { ...changed, pairs: [...changed.pairs] };
      expect(assessMotion(altered)).toMatchObject({ passed: false, acceleration: [] });
    }
  });

  it('rejects an overspeed but supported, no-slip motion at the unchanged acceleration tolerance', () => {
    const tooFast = syntheticObservations().map((step) => ({
      ...step,
      velocity: scale(step.velocity, 1.06),
      angularVelocity: scale(step.angularVelocity, 1.06),
    }));
    expect(assessMotion(tooFast)).toMatchObject({
      passed: false,
      firstUnsupported: null,
      firstSlip: null,
      firstBadGeometry: null,
    });
  });
});

it('PHY-05 executes nominal Rapier contact and an exact same-process replay', async () => {
  const output = externalEvidencePath(process.env['PHY05_EVIDENCE_OUT']);
  expect(sha256(readFileSync(fixtureUrl))).toBe(FIXTURE_SHA256);
  expect(sha256(readFileSync(specificationUrl))).toBe(fixture.specification.sha256);
  const { fixture: artifactFixture, fixtureSha256 } = readFixture();
  expect(fixtureSha256).toBe(fixture.engineArtifactFixture.sha256);
  expect(artifactFixture.id).toBe(fixture.engineArtifactFixture.id);
  validateFixture(artifactFixture);
  const provenance = verifyEngineArtifacts(artifactFixture);
  expect(provenance.version).toBe(fixture.engineArtifactFixture.version);
  expect(provenance.wasmSha256).toBe(fixture.engineArtifactFixture.wasmSha256);
  expect(provenance.embeddedWasmMatches).toBe(true);
  const { default: R } = await import('@dimforge/rapier3d-compat');
  await R.init();
  expect(R.version()).toBe(provenance.version);

  const results = Array.from({ length: fixture.identicalWorlds }, () =>
    runNominalWorld(R, { ...artifactFixture.solver, ...fixture.solverOverride }),
  );
  const assessments = results.map(({ steps }) => assessMotion(steps));
  const preserveNumbers = (_key: string, value: unknown) =>
    typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))
      ? { $float64: Object.is(value, -0) ? '-0' : String(value) }
      : value;
  const observedBytes = results.map((result) => JSON.stringify(result, preserveNumbers));
  const digests = observedBytes.map(sha256);
  const exactRepeat = observedBytes.every((bytes) => bytes === observedBytes[0]);
  const summary = {
    fixtureSha256: FIXTURE_SHA256,
    specificationSha256: fixture.specification.sha256,
    sourceSha256: sha256(readFileSync(new URL(import.meta.url))),
    artifactVerifierSha256: sha256(readFileSync(artifactVerifierUrl)),
    engine: provenance.version,
    wasmSha256: provenance.wasmSha256,
    dtUs,
    worlds: results.length,
    actualNativeSteps: results.reduce((count, result) => count + result.steps.length, 0),
    linearReferenceMps2: linearReference,
    angularReferenceRadps2: angularReference,
    digests,
    exactRepeat,
    assessments,
  };
  if (output) {
    writeFileSync(output, JSON.stringify({ summary, results }, preserveNumbers) + '\n', {
      flag: 'wx',
    });
  }
  console.info(
    'PHY05_EVIDENCE',
    JSON.stringify({ ...summary, rawEvidenceWritten: Boolean(output) }, preserveNumbers),
  );
  expect(exactRepeat).toBe(true);
  for (const assessment of assessments) {
    expect(assessment.passed, JSON.stringify(assessment)).toBe(true);
  }
});
