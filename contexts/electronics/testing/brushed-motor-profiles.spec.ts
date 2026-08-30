import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ElectronicsDocument, SchematicComponent } from '../domain/document.js';
import { resolveElectricalModelIdentity } from '../domain/model-identity.js';
import { electricalModelFor } from '../domain/model-registry.js';
import {
  BRUSHED_MOTOR_ASSEMBLY_PROFILES,
  BRUSHED_MOTOR_PROFILE_SOURCES,
  DEFAULT_BRUSHED_MOTOR_PROFILE_IDS,
  MOTOR_ASSEMBLY_PROFILE_PROPERTY,
  brushedMotorProfile,
  brushedMotorProfilesForComponent,
  canonicalBrushedMotorProfileRegistry,
  canonicalBrushedMotorReferenceFixtures,
  resolveBrushedMotorProfileSelection,
  validateBrushedMotorProfileRegistry,
} from '../domain/models/brushed-motor-profiles.js';
import { simulationInputDigest } from '../domain/simulation-input-digest.js';

function motor(componentTypeId: 'dc-motor' | 'gearmotor', profileId?: string): SchematicComponent {
  return {
    id: componentTypeId,
    kind: 'visual',
    componentTypeId,
    position: { x: 0, y: 0 },
    value: 6,
    pinIds: ['negative', 'positive'],
    ...(profileId === undefined
      ? {}
      : { stateProperties: { [MOTOR_ASSEMBLY_PROFILE_PROPERTY]: profileId } }),
  };
}

function document(component: SchematicComponent): ElectronicsDocument {
  return {
    schemaVersion: 4,
    components: [component],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

describe('MATH-5A brushed motor reference profiles', () => {
  it('keeps one finite, deterministic and source-complete profile registry', () => {
    expect(validateBrushedMotorProfileRegistry()).toEqual([]);
    expect(BRUSHED_MOTOR_ASSEMBLY_PROFILES.map((profile) => profile.profileId)).toEqual([
      'pololu-1117-130-6v',
      'adafruit-3777-tt-48to1',
      'adafruit-3801-tt-bimetal-90to1',
    ]);
    expect(BRUSHED_MOTOR_PROFILE_SOURCES.every((source) => source.url.length > 0)).toBe(true);
    const canonical = canonicalBrushedMotorProfileRegistry();
    expect(canonical).toBe(canonicalBrushedMotorProfileRegistry());
    expect(canonical).not.toMatch(/NaN|Infinity/);
    expect(canonical).toContain('educational_assumption');
    expect(canonical).toContain('math_5b_required');
  });

  it('matches the checked-in numeric vendor reference fixture exactly', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('./fixtures/brushed-motor-reference-profiles.v1.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    expect(JSON.parse(canonicalBrushedMotorReferenceFixtures())).toEqual(fixture);
  });

  it('derives the 130-size 6 V electrical fit without hiding the assumptions', () => {
    const profile = brushedMotorProfile('pololu-1117-130-6v');
    expect(profile).toBeDefined();
    expect(profile?.armatureResistanceOhm.value).toBeCloseTo(7.5, 12);
    expect(profile?.backEmfVoltSecondPerRadian.value).toBeCloseTo(0.004_546, 5);
    expect(profile?.torqueNewtonMeterPerAmpere.value).toBe(
      profile?.backEmfVoltSecondPerRadian.value,
    );
    expect(profile?.armatureResistanceOhm.basis).toBe('derived_from_vendor_reference');
    expect(profile?.transmission.gearRatio).toMatchObject({
      value: 1,
      basis: 'derived_from_vendor_reference',
      formula: 'direct drive identity ratio',
    });
    expect(profile?.armatureInductanceHenry.basis).toBe('educational_assumption');
    expect(profile?.rotorInertiaKgMeterSquared.basis).toBe('educational_assumption');
    expect(profile?.activation).toBe('math_5b_required');
  });

  it('keeps 1:48 and 1:90 as explicit TT profiles instead of a free-form ratio', () => {
    const profiles = brushedMotorProfilesForComponent('gearmotor');
    expect(profiles.map((profile) => profile.profileId)).toEqual([
      'adafruit-3777-tt-48to1',
      'adafruit-3801-tt-bimetal-90to1',
    ]);
    const plastic = brushedMotorProfile('adafruit-3777-tt-48to1');
    const biMetal = brushedMotorProfile('adafruit-3801-tt-bimetal-90to1');
    expect(plastic?.transmission.gearRatio.value).toBe(48);
    expect(plastic?.armatureResistanceOhm.value).toBeCloseTo(4, 12);
    expect(plastic?.referencePoints.at(-1)).toMatchObject({
      voltageVolt: 6,
      noLoadSpeedRpm: 250,
      stallCurrentAmp: 1.5,
      outputStallTorqueNewtonMeter: 0.078_453_2,
    });
    expect(biMetal?.transmission.gearRatio.value).toBe(90);
    expect(biMetal?.selectionStatus).toBe('reference_only_visual_variant_required');
    expect(biMetal?.referencePoints.at(-1)).toMatchObject({
      voltageVolt: 6,
      noLoadSpeedRpm: 120,
      stallCurrentAmp: 1,
    });
    expect(
      (biMetal?.referencePoints.at(-1)?.noLoadSpeedRpm ?? Number.POSITIVE_INFINITY) <
        (plastic?.referencePoints.at(-1)?.noLoadSpeedRpm ?? 0),
    ).toBe(true);
  });

  it('resolves only registered profiles compatible with the placed component', () => {
    expect(resolveBrushedMotorProfileSelection(motor('dc-motor'))).toMatchObject({
      ok: true,
      profile: { profileId: DEFAULT_BRUSHED_MOTOR_PROFILE_IDS['dc-motor'] },
    });
    expect(
      resolveBrushedMotorProfileSelection(motor('gearmotor', 'adafruit-3801-tt-bimetal-90to1')),
    ).toMatchObject({ ok: false, error: { code: 'motor_profile_not_selectable' } });
    expect(resolveBrushedMotorProfileSelection(motor('gearmotor', 'custom-37to1'))).toMatchObject({
      ok: false,
      error: { code: 'invalid_motor_profile' },
    });
    expect(
      resolveBrushedMotorProfileSelection(motor('dc-motor', 'adafruit-3777-tt-48to1')),
    ).toMatchObject({ ok: false, error: { code: 'incompatible_motor_profile' } });
  });

  it('binds a selected gear profile to the simulation input digest', () => {
    const ratio48 = document(motor('gearmotor', 'adafruit-3777-tt-48to1'));
    const ratio90 = document(motor('gearmotor', 'adafruit-3801-tt-bimetal-90to1'));
    expect(simulationInputDigest(ratio48)).not.toBe(simulationInputDigest(ratio90));
  });

  it('activates only the direct motor profile while the gearmotor remains unsupported', () => {
    expect(resolveElectricalModelIdentity(motor('dc-motor'))).toMatchObject({
      electricalModelId: 'dc-motor',
      modelProfileId: 'pololu-1117-130-6v',
    });
    expect(resolveElectricalModelIdentity(motor('gearmotor'))).toMatchObject({
      electricalModelId: 'unsupported',
      modelProfileId: 'unsupported-gearmotor',
    });
    expect(electricalModelFor(motor('gearmotor'))).toMatchObject({
      id: 'unsupported',
      support: 'unsupported',
      topology: 'unsupported',
    });
  });
});
