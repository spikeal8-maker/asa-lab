import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BRUSHED_MOTOR_ASSEMBLY_PROFILES } from '../domain/models/brushed-motor-profiles.js';
import {
  advanceBrushedMotorExternalShaft,
  advanceBrushedMotorTransientState,
  createBrushedMotorExternalShaftState,
  createBrushedMotorTransientState,
  type BrushedMotorExternalShaftState,
  type BrushedMotorExternalShaftStep,
} from '../domain/models/brushed-motor-transient-model.js';

const profile = BRUSHED_MOTOR_ASSEMBLY_PROFILES.find(
  (entry) => entry.profileId === 'adafruit-3777-tt-48to1',
);
if (!profile) throw new Error('The prespecified plastic TT profile is unavailable');
const tt = profile;
const componentId = 'tt';
const ratio = 48;
const resistance = 4;
const inductance = 0.00035;
const torqueConstant = 0.004265352474862796;
const viscous = 5.430815443229307e-7;
const efficiency = 0.255460195657764;
const thermalResistance = 10;
const thermalCapacitance = 7;
const ambient = 25;

function makeInput(
  state: BrushedMotorExternalShaftState,
  speed: number,
  voltage = 6,
  intervalMicroseconds = 500,
): BrushedMotorExternalShaftStep {
  return {
    componentId,
    profileId: tt.profileId,
    profileVersion: tt.profileVersion,
    axis: 'positive-output-shaft',
    fromMicroseconds: state.atMicroseconds,
    toMicroseconds: state.atMicroseconds + intervalMicroseconds,
    outputAngularVelocityRadPerSecond: speed,
    voltageVolt: voltage,
  };
}

function runningState() {
  return { ...createBrushedMotorExternalShaftState(componentId, tt), currentAmp: 0.2 };
}

function step(state: BrushedMotorExternalShaftState, speed: number, voltage = 6, dtUs = 500) {
  return advanceBrushedMotorExternalShaft(tt, state, makeInput(state, speed, voltage, dtUs));
}

describe('TEST_ONLY TT winding with an external output shaft', () => {
  it.each([
    [0, 1.306382978723404],
    [10, 0.8707725132055016],
    [-10, 1.7419934442413065],
  ])('uses signed back-EMF at %s rad/s in the same winding companion', (speed, expectedCurrent) => {
    const previous = runningState();
    const result = step(previous, speed);
    expect(result.companion?.conductanceSiemens).toBeCloseTo(1 / 4.7, 14);
    expect(result.companion?.historyCurrentAmp).toBeCloseTo(
      (torqueConstant * ratio * speed - (inductance / 0.0005) * previous.currentAmp) / 4.7,
      14,
    );
    expect(result.companion?.reflectedLoadTorqueNewtonMeter).toBe(0);
    expect(result.intervalCurrentAmp).toBeCloseTo(expectedCurrent, 14);
    expect(result.state.currentAmp).toBeCloseTo(expectedCurrent, 14);
    expect(result.electromagneticTorqueNewtonMeter).toBeCloseTo(
      torqueConstant * expectedCurrent,
      14,
    );
    expect(result.state.atMicroseconds).toBe(500);
    expect(result.state).not.toHaveProperty('motorAngularVelocityRadPerSecond');
    expect(result.state).not.toHaveProperty('motorAngularPhaseRadian');
    expect(result.state).not.toHaveProperty('rotorInertiaKgMeterSquared');
  });

  it('holds the analytic DC operating point and mirrors voltage and motion signs', () => {
    const speed = 10;
    const current = (6 - torqueConstant * ratio * speed) / resistance;
    const initial = { ...runningState(), currentAmp: current };
    const forward = step(initial, speed);
    const reverse = step({ ...initial, currentAmp: -current }, -speed, -6);
    expect(forward.state.currentAmp).toBeCloseTo(current, 14);
    expect(reverse.state.currentAmp).toBeCloseTo(-current, 14);
    expect(reverse.outputTorqueNewtonMeter).toBeCloseTo(-forward.outputTorqueNewtonMeter, 14);
    expect(reverse.state.temperatureCelsius).toBe(forward.state.temperatureCelsius);
  });

  it.each([
    { voltage: 6, speed: 10, backdrive: false },
    { voltage: 0, speed: 4, backdrive: true },
  ])(
    'balances electrical, mechanical and thermal energy at $voltage V and $speed rad/s',
    ({ voltage, speed, backdrive }) => {
      const dt = 0.0005;
      const previous = runningState();
      const result = step(previous, speed, voltage);
      const current = result.intervalCurrentAmp;
      const omegaMotor = speed * ratio;
      const copperWork = current * current * resistance * dt;
      const viscousWork = viscous * omegaMotor * omegaMotor * dt;
      const gearInput = (torqueConstant * current - viscous * omegaMotor) * omegaMotor * dt;
      const outputWork = result.outputTorqueImpulseNewtonMeterSeconds * speed;
      const gearLoss = result.transmissionLossWatt * dt;
      const magneticChange = (inductance / 2) * (current * current - previous.currentAmp ** 2);
      const backwardEulerLoss = (inductance / 2) * (current - previous.currentAmp) ** 2;

      expect(gearInput < 0).toBe(backdrive);
      expect(result.viscousLossWatt * dt).toBeCloseTo(viscousWork, 14);
      expect(result.outputTorqueNewtonMeter).toBeCloseTo(
        (torqueConstant * current - viscous * omegaMotor) *
          ratio *
          (backdrive ? 1 / efficiency : efficiency),
        14,
      );
      expect(gearLoss).toBeGreaterThan(0);
      expect(gearInput - outputWork).toBeCloseTo(gearLoss, 14);
      expect(voltage * current * dt).toBeCloseTo(
        copperWork + magneticChange + backwardEulerLoss + viscousWork + gearLoss + outputWork,
        14,
      );

      const deltaEquilibrium = thermalResistance * resistance * current * current;
      const rise = -deltaEquilibrium * Math.expm1(-dt / (thermalResistance * thermalCapacitance));
      expect(result.state.temperatureCelsius).toBeCloseTo(ambient + rise, 12);
      const storedHeat = thermalCapacitance * (result.state.temperatureCelsius - ambient);
      expect(storedHeat).toBeGreaterThan(0);
      expect(copperWork - storedHeat).toBeGreaterThan(0);
    },
  );

  it('sums signed impulse through an unequal-time voltage change and replays byte for byte', () => {
    function trace() {
      const first = step(runningState(), 10);
      const second = step(first.state, 10, -6, 1000);
      return [first, second];
    }
    const [first, second] = trace();
    expect(first.outputTorqueImpulseNewtonMeterSeconds).toBeCloseTo(0.00002117339457792169, 15);
    expect(second.outputTorqueImpulseNewtonMeterSeconds).toBeCloseTo(-0.0014754761726839581, 15);
    expect(
      first.outputTorqueImpulseNewtonMeterSeconds + second.outputTorqueImpulseNewtonMeterSeconds,
    ).toBeCloseTo(-0.0014543027781060364, 15);
    expect(second.state.atMicroseconds).toBe(1500);
    expect(JSON.stringify([first, second])).toBe(JSON.stringify(trace()));
  });

  it('reuses winding opening and unpowered cooling without replacing externally given motion', () => {
    const warm = {
      ...createBrushedMotorExternalShaftState(componentId, tt),
      temperatureCelsius: 149.999,
    };
    const opened = advanceBrushedMotorExternalShaft(tt, warm, {
      ...makeInput(warm, 0, 6, 50000),
      ambientTemperatureCelsius: 150,
    });
    const legacy = advanceBrushedMotorTransientState(
      tt,
      { ...createBrushedMotorTransientState(componentId, tt), temperatureCelsius: 149.999 },
      { voltageVolt: 6, stepSeconds: 0.05, ambientTemperatureCelsius: 150, shaftLocked: true },
    );
    expect(opened.state).toMatchObject({
      currentAmp: 0,
      temperatureCelsius: legacy.state.temperatureCelsius,
      accumulatedDamage: 1,
      failureMode: 'winding_open',
    });
    expect(opened.intervalCurrentAmp).toBeGreaterThan(0);
    const cooled = step(opened.state, 10, 0, 50000);
    expect(cooled.companion).toBeNull();
    expect(cooled.intervalCurrentAmp).toBe(0);
    expect(cooled.state.temperatureCelsius).toBeLessThan(opened.state.temperatureCelsius);
    expect(cooled.outputTorqueNewtonMeter).toBeLessThan(0);
  });

  it('rejects bad boundaries, identity and non-finite inputs without changing its prior state', () => {
    const state = Object.freeze(step(runningState(), 10).state);
    const before = JSON.stringify(state);
    const goodInput = Object.freeze(makeInput(state, 10));
    const invalid: ReadonlyArray<Partial<BrushedMotorExternalShaftStep>> = [
      { componentId: 'other-tt' },
      { profileId: 'other-profile' },
      { profileVersion: tt.profileVersion + 1 },
      { axis: 'reversed' as BrushedMotorExternalShaftStep['axis'] },
      { fromMicroseconds: 499 },
      { fromMicroseconds: 501 },
      { toMicroseconds: 500 },
      { toMicroseconds: 500.5 },
      { toMicroseconds: Number.MAX_SAFE_INTEGER + 1 },
      { voltageVolt: Number.POSITIVE_INFINITY },
      { ambientTemperatureCelsius: Number.NaN },
      { outputAngularVelocityRadPerSecond: Number.NaN },
      { outputAngularVelocityRadPerSecond: Number.NEGATIVE_INFINITY },
      { outputAngularVelocityRadPerSecond: Number.MAX_VALUE },
    ];
    for (const change of invalid) {
      expect(() =>
        advanceBrushedMotorExternalShaft(tt, state, { ...goodInput, ...change }),
      ).toThrow();
      expect(JSON.stringify(state)).toBe(before);
    }
    expect(() =>
      advanceBrushedMotorExternalShaft(tt, { ...state, currentAmp: NaN }, goodInput),
    ).toThrow();
    expect(advanceBrushedMotorExternalShaft(tt, state, goodInput).state.atMicroseconds).toBe(1000);
  });

  it('rejects impossible open and healthy winding continuations without modifying them', () => {
    const healthy = runningState();
    const input = makeInput(healthy, 10);
    const invalid = [
      { ...healthy, failureMode: 'winding_open', accumulatedDamage: 1 },
      { ...healthy, failureMode: 'winding_open', currentAmp: 0, accumulatedDamage: 0.5 },
      { ...healthy, accumulatedDamage: 1 },
    ] as const;
    for (const state of invalid) {
      const before = JSON.stringify(state);
      expect(() => advanceBrushedMotorExternalShaft(tt, Object.freeze(state), input)).toThrow(
        'external motor winding damage or failure mode is invalid',
      );
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it('preserves exact legacy TT outputs across driven, loaded, unpowered and locked steps', () => {
    const inputs = [
      { voltageVolt: 6, stepSeconds: 0.0005 },
      { voltageVolt: 3, stepSeconds: 0.001, outputLoadTorqueNewtonMeter: 0.005 },
      { voltageVolt: 0, stepSeconds: 0.00075 },
      { voltageVolt: -6, stepSeconds: 0.001, outputLoadTorqueNewtonMeter: 0.005 },
      { voltageVolt: -12, stepSeconds: 0.002, shaftLocked: true },
    ];
    let previous = createBrushedMotorTransientState(componentId, tt);
    const trace = inputs.map((input) => {
      const result = advanceBrushedMotorTransientState(tt, previous, input);
      previous = result.state;
      return result;
    });
    // Recorded through the unchanged implementation at the registration base.
    expect(createHash('sha256').update(JSON.stringify(trace)).digest('hex')).toBe(
      'b5259e905471530f2cfdc34bedfae6298a2a055d6429ab477a5c9d4acbbf56cb',
    );
  });
});
