import type { ComponentResult } from '../solver.js';
import type { ThermalProfile } from './thermal-transient-model.js';

/**
 * Versioned educational profile for the owner-provided T-1 bi-pin 6 V lamp.
 *
 * The artwork names the physical class and rated voltage, while the previous
 * static model already declared a 24 Ohm hot resistance and 1.5 W nominal
 * power. Those values form a self-consistent 6 V / 250 mA operating point.
 * Cold resistance, thermal inertia and failure timing are explicit educational
 * assumptions so the simulator never presents them as a hidden manufacturer
 * part number.
 */
export const INCANDESCENT_LAMP_PROFILE = {
  profileId: 't1-bipin-6v-incandescent',
  profileVersion: 2,
  referenceClass: 'T-1 bi-pin miniature incandescent lamp',
  ratedVoltageVolt: 6,
  ratedCurrentAmp: 0.25,
  ratedPowerWatt: 1.5,
  hotResistanceOhm: 24,
  coldResistanceOhm: 2.4,
  ambientCelsius: 25,
  ratedFilamentTemperatureCelsius: 2_450,
  visibleGlowTemperatureCelsius: 550,
  heatingTimeConstantSeconds: 0.12,
  coolingTimeConstantSeconds: 0.2,
  warningVoltageRatio: 1.1,
  overheatVoltageRatio: 1.35,
  destructiveVoltageRatio: 2,
  failureTemperatureCelsius: 3_250,
  failureDelayAtDestructiveSeconds: 1.5,
} as const;

export const INCANDESCENT_LAMP_THERMAL_PROFILE: ThermalProfile = {
  id: `${INCANDESCENT_LAMP_PROFILE.profileId}@${INCANDESCENT_LAMP_PROFILE.profileVersion}`,
  ambientCelsius: INCANDESCENT_LAMP_PROFILE.ambientCelsius,
  thermalTimeConstantSeconds: INCANDESCENT_LAMP_PROFILE.heatingTimeConstantSeconds,
  ratedTemperatureRiseCelsius:
    INCANDESCENT_LAMP_PROFILE.ratedFilamentTemperatureCelsius -
    INCANDESCENT_LAMP_PROFILE.ambientCelsius,
  temperatureLoadExponent: 0.7,
  warningTemperatureCelsius: 2_650,
  overheatTemperatureCelsius: 2_900,
  failureTemperatureCelsius: INCANDESCENT_LAMP_PROFILE.failureTemperatureCelsius,
  destructiveLoadRatio: INCANDESCENT_LAMP_PROFILE.destructiveVoltageRatio,
  failureDelayAtDestructiveSeconds: INCANDESCENT_LAMP_PROFILE.failureDelayAtDestructiveSeconds,
};

export type IncandescentLampFilamentState = 'cold' | 'warming' | 'lit' | 'overheated' | 'burned';

export interface IncandescentLampThermalObservation {
  readonly temperatureCelsius: number;
  readonly accumulatedDamage: number;
  readonly loadRatio: number;
  readonly failed: boolean;
  readonly state: Exclude<IncandescentLampFilamentState, 'burned'> | 'burned';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function incandescentLampResistanceOhm(temperatureCelsius: number): number {
  const profile = INCANDESCENT_LAMP_PROFILE;
  const progress = clamp(
    (temperatureCelsius - profile.ambientCelsius) /
      (profile.ratedFilamentTemperatureCelsius - profile.ambientCelsius),
    0,
    1.5,
  );
  return (
    profile.coldResistanceOhm + (profile.hotResistanceOhm - profile.coldResistanceOhm) * progress
  );
}

export function incandescentLampBrightnessPercent(temperatureCelsius: number): number {
  const profile = INCANDESCENT_LAMP_PROFILE;
  const visibleProgress = clamp(
    (temperatureCelsius - profile.visibleGlowTemperatureCelsius) /
      (profile.ratedFilamentTemperatureCelsius - profile.visibleGlowTemperatureCelsius),
    0,
    1,
  );
  // Visible radiation rises much faster than filament temperature. A power
  // curve preserves a faint low-voltage glow without making a cold wire look lit.
  return 100 * Math.pow(visibleProgress, 2.2);
}

export function incandescentLampFilamentState(
  temperatureCelsius: number,
  failed = false,
): IncandescentLampFilamentState {
  if (failed) return 'burned';
  const profile = INCANDESCENT_LAMP_PROFILE;
  if (temperatureCelsius >= INCANDESCENT_LAMP_THERMAL_PROFILE.overheatTemperatureCelsius)
    return 'overheated';
  const brightness = incandescentLampBrightnessPercent(temperatureCelsius);
  if (brightness >= 45) return 'lit';
  if (brightness > 0) return 'warming';
  return temperatureCelsius > profile.ambientCelsius + 5 ? 'warming' : 'cold';
}

/**
 * Integrates filament temperature in simulation time. Damage is driven by
 * sustained over-voltage rather than normal cold-start inrush, so a rated lamp
 * can warm up without falsely consuming its life in the first frame.
 */
export function advanceIncandescentLampThermalState(
  result: ComponentResult,
  previousTemperatureCelsius: number,
  previousAccumulatedDamage: number,
  stepSeconds: number,
): IncandescentLampThermalObservation {
  const profile = INCANDESCENT_LAMP_PROFILE;
  const voltageRatio = Math.abs(result.voltageDrop) / profile.ratedVoltageVolt;
  const targetTemperature =
    profile.ambientCelsius +
    (profile.ratedFilamentTemperatureCelsius - profile.ambientCelsius) *
      Math.pow(clamp(voltageRatio, 0, profile.destructiveVoltageRatio), 0.7);
  const timeConstant =
    targetTemperature >= previousTemperatureCelsius
      ? profile.heatingTimeConstantSeconds
      : profile.coolingTimeConstantSeconds;
  const decay = Math.exp(-stepSeconds / timeConstant);
  const temperatureCelsius =
    targetTemperature + (previousTemperatureCelsius - targetTemperature) * decay;
  const overloadFraction = clamp(
    (voltageRatio - profile.warningVoltageRatio) /
      (profile.destructiveVoltageRatio - profile.warningVoltageRatio),
    0,
    1,
  );
  const damageRate =
    (overloadFraction * overloadFraction) / profile.failureDelayAtDestructiveSeconds;
  const recoveryRate = voltageRatio <= 1 ? 0.01 : 0;
  const accumulatedDamage = Math.max(
    0,
    previousAccumulatedDamage + stepSeconds * (damageRate - recoveryRate),
  );
  const failed = accumulatedDamage >= 1 || temperatureCelsius >= profile.failureTemperatureCelsius;
  return {
    temperatureCelsius,
    accumulatedDamage,
    loadRatio: voltageRatio,
    failed,
    state: incandescentLampFilamentState(temperatureCelsius, failed),
  };
}

export function canonicalIncandescentLampProfileRegistry(): string {
  return JSON.stringify({
    registryVersion: 1,
    profiles: [INCANDESCENT_LAMP_PROFILE],
  });
}
