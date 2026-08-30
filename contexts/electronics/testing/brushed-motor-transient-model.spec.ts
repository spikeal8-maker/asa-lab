import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  brushedMotorProfile,
  type BrushedMotorAssemblyProfile,
} from '../domain/models/brushed-motor-profiles.js';
import {
  advanceBrushedMotorTransientState,
  brushedMotorCompanion,
  brushedMotorTransientStateIsCompatible,
  createBrushedMotorTransientState,
  createBrushedMotorTransientStateForComponent,
  type BrushedMotorObservation,
  type BrushedMotorStepInput,
  type BrushedMotorTransientStateEntry,
} from '../domain/models/brushed-motor-transient-model.js';

function requiredProfile(profileId: string): BrushedMotorAssemblyProfile {
  const profile = brushedMotorProfile(profileId);
  if (!profile) throw new Error(`missing test motor profile ${profileId}`);
  return profile;
}

function evolve(
  profile: BrushedMotorAssemblyProfile,
  initialState: BrushedMotorTransientStateEntry,
  durationSeconds: number,
  input: Omit<BrushedMotorStepInput, 'stepSeconds'>,
  stepSeconds = 0.001,
): {
  readonly state: BrushedMotorTransientStateEntry;
  readonly observation: BrushedMotorObservation;
} {
  let state = initialState;
  let observation: BrushedMotorObservation | undefined;
  const targetTime = initialState.simulationTimeSeconds + durationSeconds;
  while (state.simulationTimeSeconds < targetTime - 1e-12) {
    const nextStepSeconds = Math.min(stepSeconds, targetTime - state.simulationTimeSeconds);
    const result = advanceBrushedMotorTransientState(profile, state, {
      ...input,
      stepSeconds: nextStepSeconds,
    });
    state = result.state;
    observation = result.observation;
  }
  if (!observation) throw new Error('motor fixture duration must be positive');
  return { state, observation };
}

function fixtureNumber(value: number): number {
  return Number(value.toFixed(12));
}

function fixtureSample(result: ReturnType<typeof evolve>) {
  return {
    timeSeconds: Number(result.state.simulationTimeSeconds.toFixed(9)),
    currentAmp: fixtureNumber(result.state.currentAmp),
    motorRpm: fixtureNumber(result.observation.motorRpm),
    outputRpm: fixtureNumber(result.observation.outputRpm),
    phaseRadian: fixtureNumber(result.state.motorAngularPhaseRadian),
    temperatureCelsius: fixtureNumber(result.state.temperatureCelsius),
    accumulatedDamage: fixtureNumber(result.state.accumulatedDamage),
    direction: result.observation.direction,
    operatingMode: result.observation.operatingMode,
    failureMode: result.state.failureMode,
  };
}

describe('MATH-5B brushed motor transient model', () => {
  const direct = requiredProfile('pololu-1117-130-6v');
  const gear48 = requiredProfile('adafruit-3777-tt-48to1');

  it('builds a finite backward-Euler companion for the shared nodal solver', () => {
    const state = createBrushedMotorTransientState('motor', direct);
    const companion = brushedMotorCompanion(direct, state, {
      voltageVolt: 6,
      stepSeconds: 0.001,
    });
    expect(companion.conductanceSiemens).toBeGreaterThan(0);
    expect(companion.effectiveResistanceOhm).toBeGreaterThan(direct.armatureResistanceOhm.value);
    expect(Object.values(companion).every(Number.isFinite)).toBe(true);
    const first = advanceBrushedMotorTransientState(direct, state, {
      voltageVolt: 6,
      stepSeconds: 0.001,
    });
    expect(first.state.currentAmp).toBeCloseTo(
      companion.conductanceSiemens * 6 - companion.historyCurrentAmp,
      12,
    );
    expect(first.state.currentAmp).toBeGreaterThan(0);
    expect(first.state.motorAngularVelocityRadPerSecond).toBeGreaterThan(0);
  });

  it('starts a 6 V direct motor with inrush and converges to the vendor no-load point', () => {
    const initial = createBrushedMotorTransientState('motor', direct);
    const first = evolve(direct, initial, 0.001, { voltageVolt: 6 });
    const settled = evolve(direct, first.state, 1.5, { voltageVolt: 6 });
    expect(first.observation.currentAmp).toBeGreaterThan(settled.observation.currentAmp * 5);
    expect(settled.observation.motorRpm).toBeCloseTo(11_500, -1);
    expect(settled.observation.outputRpm).toBeCloseTo(settled.observation.motorRpm, 10);
    expect(settled.observation.currentAmp).toBeCloseTo(0.07, 2);
    expect(settled.observation.direction).toBe('clockwise');
    expect(settled.observation.failureMode).toBe('none');
  });

  it('uses the same motor equations through a transmission profile', () => {
    const settled = evolve(
      gear48,
      createBrushedMotorTransientState('gearmotor', gear48),
      2,
      { voltageVolt: 6 },
      0.001,
    );
    expect(settled.observation.motorRpm).toBeCloseTo(12_000, -1);
    expect(settled.observation.outputRpm).toBeCloseTo(250, 0);
    expect(settled.observation.currentAmp).toBeCloseTo(0.16, 2);
    const fitPoint = gear48.referencePoints.find(
      (point) => point.voltageVolt === gear48.fitReferenceVoltageVolt,
    );
    if (fitPoint?.outputStallTorqueNewtonMeter === undefined) {
      throw new Error('missing gearmotor stall-torque reference');
    }
    const expectedEfficiency =
      fitPoint.outputStallTorqueNewtonMeter /
      (gear48.torqueNewtonMeterPerAmpere.value *
        fitPoint.stallCurrentAmp *
        gear48.transmission.gearRatio.value);
    expect(settled.observation.transmissionEfficiency).toBeCloseTo(expectedEfficiency, 12);
    expect(settled.observation.outputTorqueNewtonMeter).toBeCloseTo(
      settled.observation.electromagneticTorqueNewtonMeter *
        gear48.transmission.gearRatio.value *
        expectedEfficiency,
      12,
    );
    expect(settled.observation.outputMechanicalPowerWatt).toBeLessThanOrEqual(
      settled.observation.motorMechanicalPowerWatt,
    );
    const stalled = evolve(
      gear48,
      createBrushedMotorTransientState('blocked-gearmotor', gear48),
      0.05,
      { voltageVolt: 6, shaftLocked: true },
    );
    expect(stalled.observation.currentAmp).toBeCloseTo(fitPoint.stallCurrentAmp, 8);
    expect(stalled.observation.outputTorqueNewtonMeter).toBeCloseTo(
      fitPoint.outputStallTorqueNewtonMeter,
      10,
    );
  });

  it('coasts after disconnection instead of stopping instantaneously', () => {
    const running = evolve(direct, createBrushedMotorTransientState('motor', direct), 1, {
      voltageVolt: 6,
    });
    const firstCoast = evolve(direct, running.state, 0.01, { voltageVolt: 0 });
    const laterCoast = evolve(direct, firstCoast.state, 0.5, { voltageVolt: 0 });
    expect(firstCoast.observation.motorRpm).toBeGreaterThan(0);
    expect(firstCoast.observation.motorRpm).toBeLessThan(running.observation.motorRpm);
    expect(firstCoast.observation.currentAmp).toBeLessThan(0);
    expect(firstCoast.observation.operatingMode).toBe('coasting');
    expect(Math.abs(laterCoast.observation.motorRpm)).toBeLessThan(
      Math.abs(firstCoast.observation.motorRpm),
    );
  });

  it('reverses only after braking through zero angular velocity', () => {
    const running = evolve(direct, createBrushedMotorTransientState('motor', direct), 0.8, {
      voltageVolt: 6,
    });
    const firstReverseStep = evolve(direct, running.state, 0.001, { voltageVolt: -6 });
    expect(firstReverseStep.observation.motorRpm).toBeGreaterThan(0);
    expect(firstReverseStep.observation.currentAmp).toBeLessThan(0);

    let state = firstReverseStep.state;
    let minimumAbsoluteRpm = Math.abs(firstReverseStep.observation.motorRpm);
    let finalObservation = firstReverseStep.observation;
    for (let index = 0; index < 1_000 && finalObservation.motorRpm >= 0; index += 1) {
      const next = advanceBrushedMotorTransientState(direct, state, {
        voltageVolt: -6,
        stepSeconds: 0.001,
      });
      state = next.state;
      finalObservation = next.observation;
      minimumAbsoluteRpm = Math.min(minimumAbsoluteRpm, Math.abs(next.observation.motorRpm));
    }
    expect(finalObservation.motorRpm).toBeLessThan(0);
    expect(minimumAbsoluteRpm).toBeLessThan(200);
    const reversed = evolve(direct, state, 1, { voltageVolt: -6 });
    expect(reversed.observation.motorRpm).toBeCloseTo(-11_500, -1);
    expect(reversed.observation.direction).toBe('counterclockwise');
  });

  it('slows under load and recovers after the load is removed', () => {
    const unloaded = evolve(direct, createBrushedMotorTransientState('motor', direct), 1, {
      voltageVolt: 6,
    });
    const loaded = evolve(direct, unloaded.state, 0.8, {
      voltageVolt: 6,
      outputLoadTorqueNewtonMeter: 0.001,
    });
    const recovered = evolve(direct, loaded.state, 0.8, { voltageVolt: 6 });
    expect(loaded.observation.motorRpm).toBeLessThan(unloaded.observation.motorRpm);
    expect(loaded.observation.currentAmp).toBeGreaterThan(unloaded.observation.currentAmp);
    expect(recovered.observation.motorRpm).toBeGreaterThan(loaded.observation.motorRpm);
    expect(recovered.observation.motorRpm).toBeCloseTo(unloaded.observation.motorRpm, -1);
  });

  it('treats a blocked shaft as a physical stall and fails only after calculated heating', () => {
    const ordinaryStall = evolve(
      direct,
      createBrushedMotorTransientState('ordinary-stall', direct),
      1,
      { voltageVolt: 6, shaftLocked: true },
      0.01,
    );
    expect(ordinaryStall.observation.operatingMode).toBe('stalled');
    expect(ordinaryStall.observation.currentAmp).toBeCloseTo(0.8, 8);
    expect(ordinaryStall.observation.thermalState).toBe('normal');
    expect(ordinaryStall.observation.failureMode).toBe('none');

    let state = createBrushedMotorTransientState('motor', direct);
    let seenWarning = false;
    let lastObservation: BrushedMotorObservation | undefined;
    for (let index = 0; index < 2_400 && state.failureMode === 'none'; index += 1) {
      const result = advanceBrushedMotorTransientState(direct, state, {
        voltageVolt: 12,
        stepSeconds: 0.05,
        shaftLocked: true,
      });
      state = result.state;
      lastObservation = result.observation;
      if (result.observation.thermalState === 'warning') seenWarning = true;
    }
    expect(lastObservation).toBeDefined();
    expect(seenWarning).toBe(true);
    expect(state.simulationTimeSeconds).toBeGreaterThan(1);
    expect(state.failureMode).toBe('winding_open');
    expect(state.currentAmp).toBe(0);
    expect(state.motorAngularVelocityRadPerSecond).toBe(0);
    expect(lastObservation?.operatingMode).toBe('failed');
    expect(lastObservation?.thermalState).toBe('failed');

    const afterFailure = advanceBrushedMotorTransientState(direct, state, {
      voltageVolt: 12,
      stepSeconds: 1,
      shaftLocked: true,
    });
    expect(afterFailure.state.currentAmp).toBe(0);
    expect(afterFailure.state.temperatureCelsius).toBeLessThan(state.temperatureCelsius);
    expect(afterFailure.state.failureMode).toBe('winding_open');
  });

  it('is byte-for-byte deterministic for the same profile, inputs, time and state', () => {
    const initial = createBrushedMotorTransientState('motor', direct);
    const first = evolve(
      direct,
      initial,
      0.75,
      { voltageVolt: 6, outputLoadTorqueNewtonMeter: 0.0005 },
      0.0025,
    );
    const second = evolve(
      direct,
      initial,
      0.75,
      { voltageVolt: 6, outputLoadTorqueNewtonMeter: 0.0005 },
      0.0025,
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(
      Object.values(first.state)
        .filter((value) => typeof value === 'number')
        .every(Number.isFinite),
    ).toBe(true);
    expect(
      Object.values(first.observation)
        .filter((value) => typeof value === 'number')
        .every(Number.isFinite),
    ).toBe(true);
    const initialSnapshot = JSON.stringify(initial);
    advanceBrushedMotorTransientState(direct, initial, {
      voltageVolt: 12,
      stepSeconds: 0.05,
      shaftLocked: true,
    });
    expect(JSON.stringify(initial)).toBe(initialSnapshot);
    expect(
      advanceBrushedMotorTransientState(direct, initial, {
        voltageVolt: 6,
        stepSeconds: 0.0025,
      }),
    ).toEqual(
      advanceBrushedMotorTransientState(direct, initial, {
        voltageVolt: 6,
        stepSeconds: 0.0025,
      }),
    );
  });

  it('matches the canonical startup, coast, reverse, transmission and failure trajectories', () => {
    const d1 = evolve(direct, createBrushedMotorTransientState('motor', direct), 0.001, {
      voltageVolt: 6,
    });
    const d100 = evolve(direct, d1.state, 0.099, { voltageVolt: 6 });
    const d1500 = evolve(direct, d100.state, 1.4, { voltageVolt: 6 });
    const coast = evolve(direct, d1500.state, 0.05, { voltageVolt: 0 });
    const reverseFirst = evolve(direct, d1500.state, 0.001, { voltageVolt: -6 });
    const reverseSettled = evolve(direct, reverseFirst.state, 1.5, { voltageVolt: -6 });
    const gearSettled = evolve(gear48, createBrushedMotorTransientState('gearmotor', gear48), 2, {
      voltageVolt: 6,
    });
    let failedState = createBrushedMotorTransientState('locked', direct);
    let failedObservation: BrushedMotorObservation | undefined;
    while (failedState.failureMode === 'none' && failedState.simulationTimeSeconds < 120) {
      const result = advanceBrushedMotorTransientState(direct, failedState, {
        voltageVolt: 12,
        stepSeconds: 0.05,
        shaftLocked: true,
      });
      failedState = result.state;
      failedObservation = result.observation;
    }
    if (!failedObservation) throw new Error('failure fixture did not produce an observation');
    const actual = {
      schema: 'asa-lab.electronics-brushed-motor-transient-fixtures.v1',
      directStartup: {
        at1ms: fixtureSample(d1),
        at100ms: fixtureSample(d100),
        at1500ms: fixtureSample(d1500),
      },
      directCoast50ms: fixtureSample(coast),
      directReverse: {
        after1ms: fixtureSample(reverseFirst),
        after1500ms: fixtureSample(reverseSettled),
      },
      gear48At2s: fixtureSample(gearSettled),
      locked12vFailure: fixtureSample({
        state: failedState,
        observation: failedObservation,
      }),
    };
    const fixture = JSON.parse(
      readFileSync(
        new URL('./fixtures/brushed-motor-transient-fixtures.v1.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    expect(actual).toEqual(fixture);
  });

  it('rejects incompatible profiles, unavailable visual variants and non-finite inputs', () => {
    expect(
      createBrushedMotorTransientStateForComponent({
        id: 'motor',
        kind: 'visual',
        componentTypeId: 'dc-motor',
        position: { x: 0, y: 0 },
        value: 6,
        pinIds: ['negative', 'positive'],
      }),
    ).toMatchObject({ ok: true, profile: { profileId: direct.profileId } });
    expect(
      createBrushedMotorTransientStateForComponent({
        id: 'gear',
        kind: 'visual',
        componentTypeId: 'gearmotor',
        position: { x: 0, y: 0 },
        value: 6,
        pinIds: ['negative', 'positive'],
        stateProperties: { motorAssemblyProfileId: 'adafruit-3801-tt-bimetal-90to1' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'motor_profile_not_selectable' } });
    const state = createBrushedMotorTransientState('motor', direct);
    expect(brushedMotorTransientStateIsCompatible(state, 'motor', direct)).toBe(true);
    expect(brushedMotorTransientStateIsCompatible(state, 'other', direct)).toBe(false);
    expect(() =>
      advanceBrushedMotorTransientState(direct, state, {
        voltageVolt: Number.NaN,
        stepSeconds: 0.001,
      }),
    ).toThrow(/finite/);
    expect(() =>
      advanceBrushedMotorTransientState(direct, state, {
        voltageVolt: 6,
        stepSeconds: 0,
      }),
    ).toThrow(/positive/);
  });
});
