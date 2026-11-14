import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rotation } from '@dimforge/rapier3d-compat';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  projectElectronicsArduinoSerial,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { expect, it } from 'vitest';
import { createInitialRoboticsProject } from '../../../contexts/robotics/domain/default-project.js';
import { readFixture, verifyEngineArtifacts } from '../../../tools/robotics-field-core/phy01.mjs';
import fixture from './electronics-seam.fixture.json';

type Rapier = typeof import('@dimforge/rapier3d-compat').default;
const fixtureSha256 = '8785b826e5cf7df10e4723669cc8863bfab48ef77eb38e9b567053347403e14c';
const fixtureUrl = new URL('./electronics-seam.fixture.json', import.meta.url);
const receiptPath = process.env['ASA_ROBOTICS_E1_SEAM_OUTPUT'];
const zero = { x: 0, y: 0, z: 0 };
const [rotorHalfX, rotorHalfY] = fixture.rotorHalfExtentsM;
const rotorInertia = (fixture.rotorMassKg * (rotorHalfX ** 2 + rotorHalfY ** 2)) / 3;

function sha256(file: URL) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function openReceipt(output: string) {
  if (!isAbsolute(output)) throw new Error('Use an absolute path for the seam receipt.');
  const parent = realpathSync(dirname(output));
  const target = join(parent, basename(output));
  const fromTemp = relative(realpathSync(tmpdir()), target);
  if (!fromTemp || fromTemp === '..' || fromTemp.startsWith(`..${sep}`) || isAbsolute(fromTemp)) {
    throw new Error('Write the seam receipt under the operating system temp directory.');
  }
  const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  const fromRepo = relative(repo, target);
  if (!fromRepo || (!fromRepo.startsWith(`..${sep}`) && !isAbsolute(fromRepo))) {
    throw new Error('Write the seam receipt outside the repository.');
  }
  return openSync(target, 'wx');
}

function retainRaw(receipt: number, value: unknown) {
  const json = JSON.stringify(
    value,
    (_key, entry: unknown) => {
      if (typeof entry !== 'number') return entry;
      if (Object.is(entry, -0)) return '-0';
      return Number.isFinite(entry) ? entry : String(entry);
    },
    2,
  );
  writeFileSync(receipt, json + '\n');
}

function createCircuit() {
  const project = createInitialRoboticsProject();
  const bindings = project.world.bindings;
  const source = `
void setup() {
  pinMode(2, INPUT);
  pinMode(5, OUTPUT);
  pinMode(6, OUTPUT);
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  digitalWrite(6, LOW);
  digitalWrite(5, HIGH);
  delay(${fixture.triggerDelayMs});
  digitalWrite(13, HIGH);
  delayMicroseconds(10);
  digitalWrite(13, LOW);
  unsigned long duration = pulseIn(2, HIGH, 30000);
  Serial.println(duration);
  if (duration > 0 && duration < ${fixture.cutoffEchoUs}) digitalWrite(5, LOW);
}
void loop() { delay(100); }
`;
  const parsed = parseElectronicsEngineDocument({
    ...project.circuit,
    components: project.circuit.components.map((component) =>
      component.id === bindings.boardId
        ? { ...component, stateProperties: { arduinoCodeMode: 'text', arduinoSource: source } }
        : component,
    ),
  });
  if (!parsed.ok) throw new Error(`Starter circuit rejected: ${JSON.stringify(parsed)}`);
  const sensor = parsed.document.components.find(({ id }) => id === bindings.distanceSensorId);
  const initialDistance = Number(sensor?.stateProperties?.['distanceMeters']);
  return { document: parsed.document, bindings, initialDistance, source };
}

function point(values: number[]) {
  const [x, y, z] = values;
  return { x, y, z };
}

// Rotate local +X by the full world quaternion so the ray uses the actual native orientation.
function forward({ x, y, z, w }: Rotation) {
  return { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) };
}

function createRotor(R: Rapier, withStop: boolean, solver: Record<string, number>) {
  const world = new R.World(zero);
  try {
    world.timestep = fixture.stepUs / 1e6;
    Object.assign(world.integrationParameters, solver);
    const center = point(fixture.rotorCenterM);
    const anchor = world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    const rotor = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCanSleep(false),
    );
    const cuboid = (extents: number[]) => {
      const { x, y, z } = point(extents);
      return R.ColliderDesc.cuboid(x, y, z).setFriction(0).setRestitution(0);
    };
    const blade = world.createCollider(
      cuboid(fixture.rotorHalfExtentsM).setMass(fixture.rotorMassKg),
      rotor,
    );
    rotor.recomputeMassPropertiesFromColliders();
    world.createImpulseJoint(
      R.JointData.revolute(zero, zero, { x: 0, y: 0, z: 1 }),
      anchor,
      rotor,
      true,
    );
    const addFixed = (position: number[], extents: number[]) => {
      const { x, y, z } = point(position);
      return world.createCollider(cuboid(extents).setTranslation(x, y, z));
    };
    const stop = withStop ? addFixed(fixture.stopCenterM, fixture.stopHalfExtentsM) : null;
    const target = addFixed(fixture.targetCenterM, fixture.targetHalfExtentsM);
    const actual = {
      stepSeconds: world.timestep,
      massKg: rotor.mass(),
      inertia: rotor.principalInertia(),
      gravity: world.gravity,
      angularDamping: rotor.angularDamping(),
      solver: Object.fromEntries(
        Object.keys(solver).map((key) => [key, Reflect.get(world.integrationParameters, key)]),
      ),
    };
    let steps = 0;
    return {
      actual,
      free: () => world.free(),
      step(heldTorqueNm: number) {
        rotor.resetTorques(true);
        rotor.addTorque({ x: 0, y: 0, z: heldTorqueNm }, true);
        let peakImpulseNs = 0;
        let firstContactUs: number | null = null;
        for (let substep = 0; substep < fixture.exchangeUs / fixture.stepUs; substep += 1) {
          if (steps >= fixture.maxStepsPerWorld) throw new Error('Rotor step budget exceeded.');
          world.step();
          steps += 1;
          if (!stop) continue;
          world.contactPair(blade, stop, (manifold) => {
            for (let index = 0; index < manifold.numContacts(); index += 1) {
              const impulse = manifold.contactImpulse(index);
              if (impulse > 0) firstContactUs ??= steps * fixture.stepUs;
              peakImpulseNs = Math.max(peakImpulseNs, impulse);
            }
          });
        }
        const velocity = rotor.angvel();
        return { velocity, peakImpulseNs, firstContactUs, steps };
      },
      measure() {
        const orientation = rotor.rotation();
        const position = rotor.translation();
        const origin = { ...position, z: position.z + fixture.sonarHeightAboveRotorM };
        const direction = forward(orientation);
        const hit = world.castRay(new R.Ray(origin, direction), fixture.maxRayM, true);
        return {
          origin,
          direction,
          position,
          orientation,
          didHitTarget: hit?.collider.handle === target.handle,
          hitDistanceM: hit?.timeOfImpact ?? null,
        };
      },
    };
  } catch (error) {
    world.free();
    throw error;
  }
}

it('registers a bounded TEST_ONLY Arduino and 3D rotor fixture', () => {
  expect(sha256(fixtureUrl)).toBe(fixtureSha256);
  expect(fixture.scope).toBe('TEST_ONLY');
  expect(fixture.horizonUs % fixture.exchangeUs).toBe(0);
  expect(fixture.exchangeUs % fixture.stepUs).toBe(0);
  expect(fixture.sampleAtUs % fixture.exchangeUs).toBe(0);
  expect(fixture.horizonUs / fixture.stepUs).toBe(fixture.maxStepsPerWorld);
  expect(fixture.maxEventsPerExchange).toBe(1024);
  expect(fixture.triggerDelayMs * 1000).toBeGreaterThan(fixture.sampleAtUs + 1);
  expect(rotorInertia).toBeGreaterThan(0);
  expect(createCircuit().initialDistance * fixture.microsecondsPerMeter).toBeGreaterThan(
    fixture.cutoffEchoUs,
  );
});

async function runNative(receipt: number, sourceSha256: string) {
  const rapierFixture = readFixture().fixture;
  const provenance = verifyEngineArtifacts(rapierFixture);
  const R = (await import('@dimforge/rapier3d-compat')).default;
  await R.init();
  const { document, bindings, initialDistance, source } = createCircuit();

  function advance(
    atUs: number,
    state?: ElectronicsTimedState,
    inputEvents?: ElectronicsTimedInputEvent[],
  ) {
    const result = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: atUs,
      maxEvents: fixture.maxEventsPerExchange,
      ...(state ? { state } : {}),
      ...(inputEvents ? { inputEvents } : {}),
    });
    if (
      result.executionStatus !== 'ready' ||
      !result.observation.solved ||
      result.committedHorizonMicroseconds !== atUs
    ) {
      throw new Error(
        `Electronics did not commit ${atUs} us: ${JSON.stringify(result.diagnostics)}`,
      );
    }
    const component = (id: string) =>
      result.observation.components.find(({ componentId }) => componentId === id);
    const board = component(bindings.boardId);
    const motor = component(bindings.leftMotorId);
    const right = component(bindings.rightMotorId);
    const battery = component('battery');
    const fet = component('left-fet');
    const terminals = {
      leftGpioVolt: board?.terminalVoltages.d5,
      rightGpioVolt: board?.terminalVoltages.d6,
      positiveVolt: motor?.terminalVoltages.positive,
      negativeVolt: motor?.terminalVoltages.negative,
      batteryPositiveVolt: battery?.terminalVoltages['BAT+'],
      batteryNegativeVolt: battery?.terminalVoltages['BAT-'],
      gateVolt: fet?.terminalVoltages.gate,
      drainVolt: fet?.terminalVoltages.drain,
      sourceVolt: fet?.terminalVoltages.source,
    };
    const torqueNm = motor?.outputTorqueNewtonMeter;
    const rpm = motor?.outputRpm;
    const currentA = motor?.current;
    const loadTorqueNm = motor?.outputLoadTorqueNewtonMeter;
    const rightTorqueNm = right?.outputTorqueNewtonMeter;
    const minMotorVolt = motor?.operatingVoltageMinVolt;
    const maxMotorVolt = motor?.operatingVoltageMaxVolt;
    if (
      torqueNm === undefined ||
      rpm === undefined ||
      [
        torqueNm,
        rpm,
        currentA,
        loadTorqueNm,
        rightTorqueNm,
        minMotorVolt,
        maxMotorVolt,
        ...Object.values(terminals),
      ].some((value) => !Number.isFinite(value))
    ) {
      throw new Error(`Missing finite motor/terminal observation at ${atUs} us.`);
    }
    return {
      state: result.state,
      observation: {
        atUs,
        torqueNm,
        rpm,
        currentA,
        loadTorqueNm,
        rightTorqueNm,
        minMotorVolt,
        maxMotorVolt,
        terminals,
        mode: motor?.motorOperatingMode,
      },
    };
  }

  const rotors: ReturnType<typeof createRotor>[] = [];
  try {
    const free = createRotor(R, false, rapierFixture.solver);
    rotors.push(free);
    const blocked = createRotor(R, true, rapierFixture.solver);
    rotors.push(blocked);
    let electrical = advance(0);
    let ray: ReturnType<typeof blocked.measure> | undefined;
    let integratedSpeed = 0;
    const samples = [];
    let feedback;
    let inputEvents: ElectronicsTimedInputEvent[] | undefined;
    for (let atUs = fixture.exchangeUs; atUs <= fixture.horizonUs; atUs += fixture.exchangeUs) {
      // Hold a committed output over the next interval. Future electrical output never drives prior physics.
      const held = electrical.observation;
      const freeStep = free.step(held.torqueNm);
      const blockedStep = blocked.step(held.torqueNm);
      integratedSpeed += (held.torqueNm * fixture.exchangeUs) / (1e6 * rotorInertia);
      electrical = advance(atUs, electrical.state, inputEvents);
      inputEvents = undefined;
      samples.push({
        atUs,
        held,
        free: freeStep,
        blocked: blockedStep,
        electrical: electrical.observation,
        integratedSpeed,
      });
      if (atUs === fixture.sampleAtUs) {
        ray = blocked.measure();
        if (ray.hitDistanceM !== null) {
          inputEvents = [
            {
              atMicroseconds: atUs + 1,
              targetId: bindings.distanceSensorId,
              operation: 'distanceMeters',
              payload: ray.hitDistanceM,
            },
            {
              atMicroseconds: atUs + 1,
              targetId: bindings.distanceSensorId,
              operation: 'echoAvailable',
              payload: true,
            },
          ];
        }
        const attempted = {
          atMicroseconds: atUs + 1,
          targetId: bindings.leftMotorId,
          operation: 'shaftAngularVelocityRadiansPerSecond',
          payload: blockedStep.velocity.z,
        };
        const probe = advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: atUs + 1,
          state: electrical.state,
          inputEvents: [attempted],
          maxEvents: fixture.maxEventsPerExchange,
        });
        feedback = {
          attempted,
          status: probe.executionStatus,
          committedUs: probe.committedHorizonMicroseconds,
          diagnostics: probe.diagnostics,
          stateUnchanged: probe.state === electrical.state,
          environment: inputEvents,
        };
      }
    }
    const serial =
      projectElectronicsArduinoSerial(electrical.state).find(
        (board) => board.componentId === bindings.boardId,
      )?.tx ?? [];
    retainRaw(receipt, {
      fixture,
      fixtureSha256,
      sourceSha256,
      provenance: { ...provenance, runtimeVersion: R.version() },
      circuitSha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
      previousNativeReceipt: {
        sha256: 'cdfdd4c42d32b953aafa75b4b2e666f25132e77b5dce2d128d8f45e1494224bc',
        outcome: 'FAIL: a 5 V winding floor ignored the series FET drop in the loaded circuit.',
      },
      bindings,
      initialDistance,
      source,
      free: free.actual,
      blocked: blocked.actual,
      feedback,
      ray,
      serial,
      samples,
    });

    expect(R.version()).toBe(provenance.version);
    for (const { actual } of rotors) {
      expect(actual.stepSeconds).toBeCloseTo(fixture.stepUs / 1e6, 8);
      expect(actual.massKg).toBeCloseTo(fixture.rotorMassKg, 6);
      expect(actual.inertia.z).toBeCloseTo(rotorInertia, 9);
      expect(actual.gravity).toEqual(zero);
      expect(actual.angularDamping).toBe(0);
      for (const [key, value] of Object.entries<number>(rapierFixture.solver)) {
        expect(actual.solver[key]).toBeCloseTo(value, 8);
      }
    }
    expect(
      samples.every(
        (sample) =>
          Math.abs(sample.free.velocity.z - sample.integratedSpeed) <=
          fixture.maximumFreeVelocityErrorRadPerSecond,
      ),
    ).toBe(true);
    expect(samples[0].held.atUs).toBe(0);
    expect(samples.at(-1)?.blocked.steps).toBe(fixture.maxStepsPerWorld);
    const contact = samples.find(
      (sample) => sample.blocked.peakImpulseNs > fixture.minimumStopImpulseNs,
    );
    expect(contact?.blocked.firstContactUs).toBeLessThan(fixture.sampleAtUs);
    expect(contact?.held.torqueNm).toBeGreaterThan(fixture.minimumDriveTorqueNm);
    const stopped = samples.find(({ atUs }) => atUs === fixture.sampleAtUs)!;
    expect(Math.abs(stopped.blocked.velocity.z)).toBeLessThan(
      fixture.maximumBlockedSpeedRadPerSecond,
    );
    expect(stopped.free.velocity.z - stopped.blocked.velocity.z).toBeGreaterThan(
      fixture.minimumSpeedSeparationRadPerSecond,
    );
    expect(stopped.electrical.rpm).toBeGreaterThan(fixture.minimumDriveRpm);
    expect(stopped.electrical.torqueNm).toBeGreaterThan(fixture.minimumDriveTorqueNm);
    expect(stopped.electrical.loadTorqueNm).toBe(0);
    expect(Math.abs(stopped.electrical.currentA!)).toBeGreaterThan(0.001);
    const terminals = stopped.electrical.terminals;
    expect(terminals.leftGpioVolt).toBeGreaterThan(4.9);
    expect(terminals.rightGpioVolt).toBeCloseTo(0, 8);
    expect(terminals.gateVolt).toBe(terminals.leftGpioVolt);
    expect(terminals.batteryPositiveVolt).toBe(terminals.positiveVolt);
    expect(terminals.drainVolt).toBe(terminals.negativeVolt);
    expect(terminals.sourceVolt).toBe(terminals.batteryNegativeVolt);
    const packVolt = terminals.batteryPositiveVolt! - terminals.batteryNegativeVolt!;
    const fetDropVolt = terminals.drainVolt! - terminals.sourceVolt!;
    const windingVolt = terminals.positiveVolt! - terminals.negativeVolt!;
    expect(fetDropVolt).toBeGreaterThan(0);
    expect(windingVolt + fetDropVolt).toBeCloseTo(packVolt, 8);
    expect(windingVolt).toBeGreaterThanOrEqual(stopped.electrical.minMotorVolt!);
    expect(windingVolt).toBeLessThanOrEqual(stopped.electrical.maxMotorVolt!);
    expect(Math.abs(stopped.electrical.rightTorqueNm!)).toBeLessThan(fixture.maximumRestTorqueNm);
    expect(feedback).toMatchObject({
      status: 'fault',
      committedUs: fixture.sampleAtUs,
      stateUnchanged: true,
      diagnostics: [{ code: 'unsupported_timed_input' }],
    });

    expect(ray?.didHitTarget).toBe(true);
    const hitDistance = ray!.hitDistanceM!;
    expect(Math.hypot(ray!.direction.x, ray!.direction.y, ray!.direction.z)).toBeCloseTo(1, 6);
    const nearWallX = fixture.targetCenterM[0] - fixture.targetHalfExtentsM[0];
    const analyticDistance = (nearWallX - ray!.origin.x) / ray!.direction.x;
    expect(Math.abs(analyticDistance - hitDistance)).toBeLessThan(fixture.maximumRayErrorM);
    const echoUs = Math.round(hitDistance * fixture.microsecondsPerMeter);
    expect(echoUs).toBeGreaterThan(0);
    expect(echoUs).toBeLessThan(fixture.cutoffEchoUs);
    expect(serial).toHaveLength(1);
    expect(Number(serial[0].text.trim())).toBe(echoUs);
    expect(serial[0].atMicroseconds).toBeGreaterThan(fixture.triggerDelayMs * 1000);
    const coast = samples.find(
      ({ atUs, electrical: sample }) =>
        atUs >= serial[0].atMicroseconds && sample.mode === 'coasting',
    );
    expect(coast?.electrical.terminals.leftGpioVolt).toBeCloseTo(0, 8);
    expect(Math.abs(samples.at(-1)!.electrical.torqueNm)).toBeLessThan(fixture.maximumRestTorqueNm);
  } finally {
    for (const rotor of rotors) rotor.free();
  }
}

it.runIf(Boolean(receiptPath))(
  'drives a real 3D rotor, reads a physical Echo, and exposes the missing load feedback',
  async () => {
    expect(sha256(fixtureUrl)).toBe(fixtureSha256);
    const sourceSha256 = sha256(new URL(import.meta.url));
    const receipt = openReceipt(receiptPath!);
    try {
      await runNative(receipt, sourceSha256);
    } finally {
      closeSync(receipt);
    }
  },
  30_000,
);
