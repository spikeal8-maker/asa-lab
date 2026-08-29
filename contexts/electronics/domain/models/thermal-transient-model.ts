import type { SchematicComponent } from '../document.js';
import type { ComponentResult } from '../solver.js';
import { isElectrolyticCapacitor } from './capacitor-transient-model.js';

export interface ThermalProfile {
  readonly id: string;
  readonly ambientCelsius: number;
  readonly thermalTimeConstantSeconds: number;
  readonly ratedTemperatureRiseCelsius: number;
  readonly temperatureLoadExponent: number;
  readonly warningTemperatureCelsius: number;
  readonly overheatTemperatureCelsius: number;
  readonly failureTemperatureCelsius: number;
  readonly destructiveLoadRatio: number;
  readonly failureDelayAtDestructiveSeconds: number;
}

export interface ThermalObservation {
  readonly temperatureCelsius: number;
  readonly accumulatedDamage: number;
  readonly loadRatio: number;
  readonly failed: boolean;
  readonly state: 'normal' | 'warning' | 'overheated' | 'failed';
}

const PROFILES = {
  source: {
    id: 'generic-battery-source-thermal@1',
    ambientCelsius: 25,
    thermalTimeConstantSeconds: 12,
    ratedTemperatureRiseCelsius: 35,
    temperatureLoadExponent: 2,
    warningTemperatureCelsius: 65,
    overheatTemperatureCelsius: 90,
    failureTemperatureCelsius: 125,
    destructiveLoadRatio: 3,
    failureDelayAtDestructiveSeconds: 2,
  },
  resistor: {
    id: 'generic-axial-resistor-thermal@1',
    ambientCelsius: 25,
    thermalTimeConstantSeconds: 4,
    ratedTemperatureRiseCelsius: 55,
    temperatureLoadExponent: 1,
    warningTemperatureCelsius: 85,
    overheatTemperatureCelsius: 125,
    failureTemperatureCelsius: 180,
    destructiveLoadRatio: 4,
    failureDelayAtDestructiveSeconds: 0.8,
  },
  junction: {
    id: 'generic-small-signal-junction-thermal@1',
    ambientCelsius: 25,
    // A severe LED overload must be visible as a warning before the package
    // fails.  Five seconds is still a small-junction thermal response, while
    // avoiding a one-frame warning that turns into a starburst before a user
    // can inspect it.
    thermalTimeConstantSeconds: 5,
    ratedTemperatureRiseCelsius: 35,
    temperatureLoadExponent: 1,
    warningTemperatureCelsius: 80,
    overheatTemperatureCelsius: 115,
    failureTemperatureCelsius: 150,
    destructiveLoadRatio: 6,
    failureDelayAtDestructiveSeconds: 4,
  },
  transistor: {
    id: 'generic-to92-thermal@1',
    ambientCelsius: 25,
    thermalTimeConstantSeconds: 1.8,
    ratedTemperatureRiseCelsius: 60,
    temperatureLoadExponent: 1,
    warningTemperatureCelsius: 90,
    overheatTemperatureCelsius: 125,
    failureTemperatureCelsius: 150,
    destructiveLoadRatio: 2,
    failureDelayAtDestructiveSeconds: 0.35,
  },
  capacitor: {
    id: 'generic-electrolytic-capacitor-thermal@1',
    ambientCelsius: 25,
    thermalTimeConstantSeconds: 8,
    ratedTemperatureRiseCelsius: 25,
    temperatureLoadExponent: 2,
    warningTemperatureCelsius: 70,
    overheatTemperatureCelsius: 95,
    failureTemperatureCelsius: 125,
    destructiveLoadRatio: 1.5,
    failureDelayAtDestructiveSeconds: 1.5,
  },
} as const satisfies Record<string, ThermalProfile>;

export function thermalProfileFor(component: SchematicComponent): ThermalProfile | null {
  if (isElectrolyticCapacitor(component)) return PROFILES.capacitor;
  switch (component.kind) {
    case 'source':
      return PROFILES.source;
    case 'resistor':
      return PROFILES.resistor;
    case 'led':
    case 'diode':
      return PROFILES.junction;
    case 'transistor':
      return PROFILES.transistor;
    default:
      return null;
  }
}

export function thermalProfileKey(component: SchematicComponent, profile: ThermalProfile): string {
  return [
    profile.id,
    component.componentTypeId ?? component.kind,
    component.value,
    component.stateProperties?.['powerRatingWatt'] ?? '',
    component.stateProperties?.['continuousCurrentAmp'] ?? '',
    component.stateProperties?.['maxCollectorCurrent'] ?? '',
    component.stateProperties?.['maxPower'] ?? '',
    component.stateProperties?.['voltageRatingVolt'] ?? '',
  ].join('|');
}

function electricalLoadRatio(result: ComponentResult, profile: ThermalProfile): number {
  const utilization = Math.max(
    0,
    result.currentUtilizationPercent ?? 0,
    result.powerUtilizationPercent ?? 0,
  );
  let ratio = utilization / 100;
  if (result.continuousCurrentLimitAmp && result.destructiveCurrentLimitAmp) {
    const physicalDestructiveRatio =
      result.destructiveCurrentLimitAmp / result.continuousCurrentLimitAmp;
    if (Number.isFinite(physicalDestructiveRatio) && physicalDestructiveRatio > 1) {
      ratio *= profile.destructiveLoadRatio / physicalDestructiveRatio;
    }
  }
  if (result.voltageRatingVolt && result.stressState === 'burned') {
    ratio = Math.max(ratio, Math.abs(result.voltageDrop) / result.voltageRatingVolt);
  }
  if (result.stressState === 'warning') ratio = Math.max(ratio, 0.85);
  if (result.stressState === 'overcurrent') ratio = Math.max(ratio, 1.05);
  if (result.stressState === 'burned') ratio = Math.max(ratio, profile.destructiveLoadRatio);
  return Math.min(20, ratio);
}

/**
 * First-order lumped thermal model. It uses the component's already calculated
 * electrical utilisation and integrates in model time, never wall-clock/FPS.
 */
export function advanceThermalState(
  profile: ThermalProfile,
  result: ComponentResult,
  previousTemperatureCelsius: number,
  previousAccumulatedDamage: number,
  stepSeconds: number,
): ThermalObservation {
  const loadRatio = electricalLoadRatio(result, profile);
  // Once the declared destructive load has been reached, a still larger
  // electrical ratio must not compress several seconds of physical damage
  // into a single render frame. The profile owns the failure time; the raw
  // ratio remains available to the inspector as `loadRatio`.
  const boundedThermalLoadRatio = Math.min(loadRatio, profile.destructiveLoadRatio);
  const targetTemperature =
    profile.ambientCelsius +
    profile.ratedTemperatureRiseCelsius *
      Math.pow(boundedThermalLoadRatio, profile.temperatureLoadExponent);
  const decay = Math.exp(-stepSeconds / profile.thermalTimeConstantSeconds);
  const temperatureCelsius =
    targetTemperature + (previousTemperatureCelsius - targetTemperature) * decay;
  const overloadFraction = Math.min(
    1,
    Math.max(0, (loadRatio - 1) / Math.max(0.001, profile.destructiveLoadRatio - 1)),
  );
  const damageRate =
    (overloadFraction * overloadFraction) / profile.failureDelayAtDestructiveSeconds;
  const recoveryRate = loadRatio <= 1 ? 0.02 : 0;
  const accumulatedDamage = Math.max(
    0,
    previousAccumulatedDamage + stepSeconds * (damageRate - recoveryRate),
  );
  const failed = accumulatedDamage >= 1 || temperatureCelsius >= profile.failureTemperatureCelsius;
  const state = failed
    ? 'failed'
    : temperatureCelsius >= profile.overheatTemperatureCelsius || accumulatedDamage >= 0.35
      ? 'overheated'
      : temperatureCelsius >= profile.warningTemperatureCelsius || loadRatio > 1
        ? 'warning'
        : 'normal';
  return {
    temperatureCelsius,
    accumulatedDamage,
    loadRatio,
    failed,
    state,
  };
}
