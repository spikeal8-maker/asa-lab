import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brushedMotorProfile } from '@asa-lab/electronics';

interface GearmotorInformationFixture {
  readonly componentTypeId: string;
  readonly profileId: string;
  readonly gearRatio: number;
  readonly transmissionEfficiencyAtSixVoltReference: number;
  readonly sixVoltNoLoadReference: {
    readonly motorRpm: number;
    readonly outputRpm: number;
    readonly motorMechanicalPowerWatt: number;
    readonly outputMechanicalPowerWatt: number;
  };
  readonly inspectorFields: readonly string[];
  readonly stageReadout: string;
  readonly visualPhaseSource: string;
  readonly productionActivation: string;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/gearmotor-information-profile.json', import.meta.url), 'utf8'),
) as GearmotorInformationFixture;

describe('MATH-5D gearmotor information contract', () => {
  it('binds the inspector fixture to the confirmed selectable 1:48 profile', () => {
    const profile = brushedMotorProfile(fixture.profileId);
    expect(profile).toBeDefined();
    expect(profile).toMatchObject({
      componentTypeId: fixture.componentTypeId,
      selectionStatus: 'selectable_reference',
      transmission: { gearRatio: { value: fixture.gearRatio } },
    });
    expect(fixture.sixVoltNoLoadReference.motorRpm / fixture.gearRatio).toBe(
      fixture.sixVoltNoLoadReference.outputRpm,
    );
    expect(fixture.transmissionEfficiencyAtSixVoltReference).toBeGreaterThan(0);
    expect(fixture.transmissionEfficiencyAtSixVoltReference).toBeLessThanOrEqual(1);
    expect(fixture.sixVoltNoLoadReference.outputMechanicalPowerWatt).toBeLessThanOrEqual(
      fixture.sixVoltNoLoadReference.motorMechanicalPowerWatt,
    );
  });

  it('keeps internal and output observations explicit for the active confirmed profile', () => {
    expect(fixture.inspectorFields).toEqual([
      'gearRatio',
      'transmissionEfficiency',
      'motorRpm',
      'outputRpm',
      'motorTorqueNewtonMeter',
      'outputTorqueNewtonMeter',
      'currentAmp',
      'temperatureCelsius',
      'failureMode',
    ]);
    expect(fixture.stageReadout).toBe('signedOutputRpm');
    expect(fixture.visualPhaseSource).toBe('acceptedSimulationTime');
    expect(fixture.productionActivation).toBe('active_confirmed_1_to_48_profile');
  });
});
