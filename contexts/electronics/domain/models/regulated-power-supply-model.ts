import type { SchematicComponent } from '../document.js';

export type RegulatedPowerSupplyMode = 'off' | 'cv' | 'cc';

export interface RegulatedPowerSupplySettings {
  readonly outputEnabled: boolean;
  readonly voltageSetpointVolt: number;
  readonly currentLimitAmp: number;
  readonly outputResistanceOhm: number;
}

export interface RegulatedPowerSupplyStamp {
  readonly emfVolt: number;
  readonly seriesResistanceOhm: number;
}

/**
 * Versioned educational profile for the owner-supplied 0-30 V / 0-5 A supply.
 * The large CC resistance is a deterministic Thevenin representation of a
 * bounded current source: it keeps the matrix finite while limiting short-
 * circuit current without pretending that the output is an ideal voltage
 * source. It is an explicit solver assumption, not a manufacturer claim.
 */
export const REGULATED_POWER_SUPPLY_PROFILE = {
  profileId: 'asa-bench-supply-30v-5a',
  profileVersion: 1,
  voltageMinVolt: 0,
  voltageMaxVolt: 30,
  currentMinAmp: 0,
  currentMaxAmp: 5,
  defaultVoltageVolt: 5,
  defaultCurrentLimitAmp: 1,
  outputResistanceOhm: 0.05,
  currentControlResistanceOhm: 1_000_000,
  outputOffResistanceOhm: 1_000_000_000_000,
  ambientTemperatureCelsius: 25,
  thermalResistanceCelsiusPerWatt: 0.8,
} as const;

function finiteProperty(component: SchematicComponent, key: string): number | null {
  const value = Number(component.stateProperties?.[key]);
  return Number.isFinite(value) ? value : null;
}

export function regulatedPowerSupplySettings(
  component: SchematicComponent,
): RegulatedPowerSupplySettings {
  const configuredVoltage = finiteProperty(component, 'voltageSetpointVolt');
  const configuredCurrent = finiteProperty(component, 'currentLimitAmp');
  const configuredResistance = finiteProperty(component, 'outputResistanceOhm');
  return {
    outputEnabled:
      component.stateProperties?.['outputEnabled'] === true ||
      (component.stateProperties?.['outputEnabled'] === undefined && component.state === true),
    voltageSetpointVolt:
      configuredVoltage ??
      (Number.isFinite(component.value)
        ? component.value
        : REGULATED_POWER_SUPPLY_PROFILE.defaultVoltageVolt),
    currentLimitAmp: configuredCurrent ?? REGULATED_POWER_SUPPLY_PROFILE.defaultCurrentLimitAmp,
    outputResistanceOhm: configuredResistance ?? REGULATED_POWER_SUPPLY_PROFILE.outputResistanceOhm,
  };
}

export function regulatedPowerSupplyValidationMessage(
  component: SchematicComponent,
): string | null {
  const settings = regulatedPowerSupplySettings(component);
  if (
    !Number.isFinite(settings.voltageSetpointVolt) ||
    settings.voltageSetpointVolt < REGULATED_POWER_SUPPLY_PROFILE.voltageMinVolt ||
    settings.voltageSetpointVolt > REGULATED_POWER_SUPPLY_PROFILE.voltageMaxVolt
  ) {
    return 'Уставка лабораторного источника должна быть от 0 до 30 В.';
  }
  if (
    !Number.isFinite(settings.currentLimitAmp) ||
    settings.currentLimitAmp < REGULATED_POWER_SUPPLY_PROFILE.currentMinAmp ||
    settings.currentLimitAmp > REGULATED_POWER_SUPPLY_PROFILE.currentMaxAmp
  ) {
    return 'Ограничение тока лабораторного источника должно быть от 0 до 5 А.';
  }
  if (!Number.isFinite(settings.outputResistanceOhm) || settings.outputResistanceOhm <= 0) {
    return 'Выходное сопротивление лабораторного источника должно быть больше нуля.';
  }
  const outputEnabled = component.stateProperties?.['outputEnabled'];
  if (outputEnabled !== undefined && typeof outputEnabled !== 'boolean') {
    return 'Состояние выхода лабораторного источника должно быть логическим значением.';
  }
  return null;
}

export function regulatedPowerSupplyStamp(
  settings: RegulatedPowerSupplySettings,
  mode: RegulatedPowerSupplyMode,
): RegulatedPowerSupplyStamp {
  if (!settings.outputEnabled || mode === 'off') {
    return {
      emfVolt: 0,
      seriesResistanceOhm: REGULATED_POWER_SUPPLY_PROFILE.outputOffResistanceOhm,
    };
  }
  if (mode === 'cc' && settings.currentLimitAmp <= 0) {
    return {
      emfVolt: 0,
      seriesResistanceOhm: REGULATED_POWER_SUPPLY_PROFILE.outputOffResistanceOhm,
    };
  }
  if (mode === 'cc') {
    return {
      emfVolt:
        settings.currentLimitAmp * REGULATED_POWER_SUPPLY_PROFILE.currentControlResistanceOhm,
      seriesResistanceOhm: REGULATED_POWER_SUPPLY_PROFILE.currentControlResistanceOhm,
    };
  }
  return {
    emfVolt: settings.voltageSetpointVolt,
    seriesResistanceOhm: settings.outputResistanceOhm,
  };
}

export function regulatedPowerSupplyModeForOperatingPoint(
  settings: RegulatedPowerSupplySettings,
  previousMode: RegulatedPowerSupplyMode,
  deliveredCurrentAmp: number,
  outputVoltageVolt: number,
): RegulatedPowerSupplyMode {
  if (!settings.outputEnabled) return 'off';
  if (previousMode === 'cc') {
    return outputVoltageVolt > settings.voltageSetpointVolt + 1e-7 || deliveredCurrentAmp < -1e-9
      ? 'cv'
      : 'cc';
  }
  return deliveredCurrentAmp > settings.currentLimitAmp + 1e-9 ? 'cc' : 'cv';
}

export function regulatedPowerSupplyTemperatureCelsius(
  settings: RegulatedPowerSupplySettings,
  mode: RegulatedPowerSupplyMode,
  outputVoltageVolt: number,
  deliveredCurrentAmp: number,
): number {
  if (mode === 'off') return REGULATED_POWER_SUPPLY_PROFILE.ambientTemperatureCelsius;
  const current = Math.max(0, deliveredCurrentAmp);
  const controlLossWatt =
    Math.max(0, settings.voltageSetpointVolt - Math.max(0, outputVoltageVolt)) * current;
  const conductorLossWatt = current * current * settings.outputResistanceOhm;
  return Math.min(
    180,
    REGULATED_POWER_SUPPLY_PROFILE.ambientTemperatureCelsius +
      (controlLossWatt + conductorLossWatt) *
        REGULATED_POWER_SUPPLY_PROFILE.thermalResistanceCelsiusPerWatt,
  );
}

export function canonicalRegulatedPowerSupplyProfileRegistry(): string {
  return JSON.stringify(REGULATED_POWER_SUPPLY_PROFILE);
}
