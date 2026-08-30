import type { SchematicComponent } from '../document.js';
import type { BrushedMotorTransientStateEntry } from './brushed-motor-transient-model.js';

export interface CapacitorParameters {
  readonly capacitanceFarad: number;
  readonly capacitanceMicrofarad: number;
  readonly initialVoltageVolt: number;
  readonly voltageRatingVolt: number;
  readonly positive: 'positive';
  readonly negative: 'negative';
}

export interface CapacitorCompanion {
  readonly conductanceSiemens: number;
  readonly historyCurrentAmp: number;
}

export interface CapacitorObservation {
  readonly voltageVolt: number;
  readonly currentAmp: number;
  readonly chargeCoulomb: number;
  readonly storedEnergyJoule: number;
  readonly reversePolarized: boolean;
  readonly overVoltage: boolean;
}

export interface CapacitorTransientStateEntry {
  readonly componentId: string;
  readonly capacitanceFarad: number;
  readonly initialVoltageVolt: number;
  readonly voltageRatingVolt: number;
  readonly voltageVolt: number;
}

export type TransientFailureMode = 'none' | 'open';

export interface ThermalTransientStateEntry {
  readonly componentId: string;
  /** Identifies the exact physical/limit profile that produced this state. */
  readonly profileKey: string;
  readonly temperatureCelsius: number;
  readonly loadRatio: number;
  /** Normalised accumulated damage. A value of 1 means permanent failure. */
  readonly accumulatedDamage: number;
  readonly failureMode: TransientFailureMode;
}

/**
 * Explicit transient state passed between pure solver calls. The state is part
 * of the simulation input, not mutable module memory, so a browser and server
 * given the same document, model time and state reproduce the same result.
 */
export interface CapacitorTransientState {
  readonly version: 2;
  readonly simulationTimeMs: number;
  readonly capacitors: readonly CapacitorTransientStateEntry[];
  readonly thermal: readonly ThermalTransientStateEntry[];
  /**
   * Previous algebraic BJT regions are only an initial guess for the next
   * transient step. Carrying them prevents a symmetric oscillator from being
   * re-seeded into the same cutoff solution at every browser clock sample.
   */
  readonly bjtRegions?: readonly {
    readonly componentId: string;
    readonly region: 'cutoff' | 'active' | 'saturation';
  }[];
  /**
   * Accepted electromechanical state for every active brushed motor. Keeping it
   * beside capacitor and thermal state makes browser and server replay the
   * same acceleration, coast, reversal and winding temperature.
   */
  readonly motors?: readonly BrushedMotorTransientStateEntry[];
}

const MICROFARAD_TO_FARAD = 1e-6;
const MIN_CAPACITANCE_MICROFARAD = 0.001;
const MAX_CAPACITANCE_MICROFARAD = 1_000_000;
const DEFAULT_VOLTAGE_RATING_VOLT = 25;

export function isElectrolyticCapacitor(component: SchematicComponent): boolean {
  return component.componentTypeId === 'electrolytic-capacitor';
}

export function capacitorParameters(component: SchematicComponent): CapacitorParameters {
  const capacitanceMicrofarad = component.value;
  const initialVoltageVolt = Number(component.stateProperties?.['initialVoltageVolt'] ?? 0);
  const voltageRatingVolt = Number(
    component.stateProperties?.['voltageRatingVolt'] ?? DEFAULT_VOLTAGE_RATING_VOLT,
  );
  return {
    capacitanceFarad: capacitanceMicrofarad * MICROFARAD_TO_FARAD,
    capacitanceMicrofarad,
    initialVoltageVolt,
    voltageRatingVolt,
    positive: 'positive',
    negative: 'negative',
  };
}

export function capacitorPropertyError(component: SchematicComponent): string | null {
  if (!isElectrolyticCapacitor(component)) return null;
  const parameters = capacitorParameters(component);
  if (
    !Number.isFinite(parameters.capacitanceMicrofarad) ||
    parameters.capacitanceMicrofarad < MIN_CAPACITANCE_MICROFARAD ||
    parameters.capacitanceMicrofarad > MAX_CAPACITANCE_MICROFARAD
  ) {
    return `Ёмкость должна быть от ${MIN_CAPACITANCE_MICROFARAD} до ${MAX_CAPACITANCE_MICROFARAD} мкФ.`;
  }
  if (
    !Number.isFinite(parameters.voltageRatingVolt) ||
    parameters.voltageRatingVolt < 1 ||
    parameters.voltageRatingVolt > 1_000
  ) {
    return 'Допустимое напряжение конденсатора должно быть от 1 до 1000 В.';
  }
  if (
    !Number.isFinite(parameters.initialVoltageVolt) ||
    Math.abs(parameters.initialVoltageVolt) > parameters.voltageRatingVolt
  ) {
    return 'Начальное напряжение должно быть конечным и не превышать допустимое напряжение.';
  }
  return null;
}

/**
 * Backward Euler companion for i = C · dV/dt:
 * i(n) = G · V(n) - G · V(n-1), where G = C / dt.
 */
export function capacitorCompanion(
  parameters: CapacitorParameters,
  previousVoltageVolt: number,
  stepSeconds: number,
): CapacitorCompanion {
  if (!Number.isFinite(previousVoltageVolt)) {
    throw new TypeError('capacitor previous voltage must be finite');
  }
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new TypeError('capacitor step must be a positive finite number');
  }
  const conductanceSiemens = parameters.capacitanceFarad / stepSeconds;
  return {
    conductanceSiemens,
    historyCurrentAmp: conductanceSiemens * previousVoltageVolt,
  };
}

export function observeCapacitor(
  parameters: CapacitorParameters,
  previousVoltageVolt: number,
  voltageVolt: number,
  stepSeconds: number,
): CapacitorObservation {
  const companion = capacitorCompanion(parameters, previousVoltageVolt, stepSeconds);
  const currentAmp = companion.conductanceSiemens * (voltageVolt - previousVoltageVolt);
  return {
    voltageVolt,
    currentAmp,
    chargeCoulomb: parameters.capacitanceFarad * voltageVolt,
    storedEnergyJoule: 0.5 * parameters.capacitanceFarad * voltageVolt * voltageVolt,
    reversePolarized: voltageVolt < -0.1,
    overVoltage: Math.abs(voltageVolt) > parameters.voltageRatingVolt,
  };
}
