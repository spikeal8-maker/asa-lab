import type { SchematicComponent } from '../document.js';

export type SignalGeneratorWaveform = 'sine' | 'square' | 'triangle';

export interface SignalGeneratorSettings {
  readonly waveform: SignalGeneratorWaveform;
  readonly frequencyHz: number;
  readonly amplitudeVpp: number;
  readonly dcOffsetVolt: number;
  readonly outputEnabled: boolean;
  readonly outputResistanceOhm: number;
  readonly continuousCurrentAmp: number;
}

export const SIGNAL_GENERATOR_MIN_FREQUENCY_HZ = 1;
export const SIGNAL_GENERATOR_MAX_FREQUENCY_HZ = 1_000_000;
export const SIGNAL_GENERATOR_MAX_AMPLITUDE_VPP = 10;
export const SIGNAL_GENERATOR_MIN_OFFSET_VOLT = -5;
export const SIGNAL_GENERATOR_MAX_OFFSET_VOLT = 5;
export const SIGNAL_GENERATOR_DEFAULT_OUTPUT_RESISTANCE_OHM = 50;
export const SIGNAL_GENERATOR_DISABLED_OUTPUT_RESISTANCE_OHM = 1_000_000_000_000;
export const SIGNAL_GENERATOR_DEFAULT_CURRENT_LIMIT_AMP = 0.1;

function finiteProperty(component: SchematicComponent, key: string, fallback: number): number {
  const value = Number(component.stateProperties?.[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function signalGeneratorSettings(component: SchematicComponent): SignalGeneratorSettings {
  const waveformValue = component.stateProperties?.['waveform'];
  const waveform: SignalGeneratorWaveform =
    waveformValue === 'square' || waveformValue === 'triangle' ? waveformValue : 'sine';
  return {
    waveform,
    frequencyHz: finiteProperty(component, 'frequencyHz', component.value || 1_000),
    amplitudeVpp: finiteProperty(component, 'amplitudeVpp', 5),
    dcOffsetVolt: finiteProperty(component, 'dcOffsetVolt', 0),
    outputEnabled:
      component.stateProperties?.['outputEnabled'] === true || component.state === true,
    outputResistanceOhm: finiteProperty(
      component,
      'outputResistanceOhm',
      SIGNAL_GENERATOR_DEFAULT_OUTPUT_RESISTANCE_OHM,
    ),
    continuousCurrentAmp: finiteProperty(
      component,
      'maxContinuousCurrentAmp',
      SIGNAL_GENERATOR_DEFAULT_CURRENT_LIMIT_AMP,
    ),
  };
}

export function signalGeneratorValidationMessage(component: SchematicComponent): string | null {
  const settings = signalGeneratorSettings(component);
  if (
    !Number.isFinite(settings.frequencyHz) ||
    settings.frequencyHz < SIGNAL_GENERATOR_MIN_FREQUENCY_HZ ||
    settings.frequencyHz > SIGNAL_GENERATOR_MAX_FREQUENCY_HZ
  ) {
    return 'Частота генератора должна быть от 1 Гц до 1 МГц.';
  }
  if (
    !Number.isFinite(settings.amplitudeVpp) ||
    settings.amplitudeVpp < 0 ||
    settings.amplitudeVpp > SIGNAL_GENERATOR_MAX_AMPLITUDE_VPP
  ) {
    return 'Амплитуда генератора должна быть от 0 до 10 В пик-пик.';
  }
  if (
    !Number.isFinite(settings.dcOffsetVolt) ||
    settings.dcOffsetVolt < SIGNAL_GENERATOR_MIN_OFFSET_VOLT ||
    settings.dcOffsetVolt > SIGNAL_GENERATOR_MAX_OFFSET_VOLT
  ) {
    return 'Смещение генератора должно быть от −5 до +5 В.';
  }
  if (!Number.isFinite(settings.outputResistanceOhm) || settings.outputResistanceOhm <= 0) {
    return 'Выходное сопротивление генератора должно быть больше нуля.';
  }
  if (!Number.isFinite(settings.continuousCurrentAmp) || settings.continuousCurrentAmp <= 0) {
    return 'Допустимый ток генератора должен быть больше нуля.';
  }
  return null;
}

function normalizedPhase(timeSeconds: number, frequencyHz: number): number {
  const phase = (timeSeconds * frequencyHz) % 1;
  return phase < 0 ? phase + 1 : phase;
}

export function signalGeneratorNormalizedWave(
  waveform: SignalGeneratorWaveform,
  phase: number,
): number {
  if (waveform === 'square') return phase < 0.5 ? 1 : -1;
  if (waveform === 'triangle') return 1 - 4 * Math.abs(phase - 0.5);
  return Math.sin(phase * Math.PI * 2);
}

export function signalGeneratorVoltageAt(
  component: SchematicComponent,
  simulationTimeMs: number,
): number {
  const settings = signalGeneratorSettings(component);
  if (!settings.outputEnabled) return 0;
  const phase = normalizedPhase(simulationTimeMs / 1_000, settings.frequencyHz);
  return (
    settings.dcOffsetVolt +
    (settings.amplitudeVpp / 2) * signalGeneratorNormalizedWave(settings.waveform, phase)
  );
}

export interface OscilloscopeSettings {
  readonly voltsPerDivision: number;
  readonly timePerDivisionMs: number;
  readonly triggerLevelVolt: number;
  readonly displayEnabled: boolean;
}

export const OSCILLOSCOPE_INPUT_RESISTANCE_OHM = 10_000_000;

export function oscilloscopeSettings(component: SchematicComponent): OscilloscopeSettings {
  return {
    voltsPerDivision: finiteProperty(component, 'voltsPerDivision', 1),
    timePerDivisionMs: finiteProperty(component, 'timePerDivisionMs', 1),
    triggerLevelVolt: finiteProperty(component, 'triggerLevelVolt', 0),
    displayEnabled:
      component.stateProperties?.['displayEnabled'] !== false && component.state !== false,
  };
}

export function oscilloscopeValidationMessage(component: SchematicComponent): string | null {
  const settings = oscilloscopeSettings(component);
  if (!Number.isFinite(settings.voltsPerDivision) || settings.voltsPerDivision <= 0) {
    return 'Масштаб осциллографа по напряжению должен быть больше нуля.';
  }
  if (!Number.isFinite(settings.timePerDivisionMs) || settings.timePerDivisionMs <= 0) {
    return 'Масштаб осциллографа по времени должен быть больше нуля.';
  }
  if (!Number.isFinite(settings.triggerLevelVolt)) {
    return 'Уровень синхронизации осциллографа должен быть конечным числом.';
  }
  return null;
}
