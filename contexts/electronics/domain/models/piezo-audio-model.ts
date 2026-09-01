import type { SchematicComponent } from '../document.js';

export type PiezoOperatingMode = 'passive' | 'active';
export type PiezoDriveState =
  'silent' | 'below_voltage' | 'sounding' | 'reverse_polarity' | 'overvoltage';

export interface PiezoTransducerProfile {
  readonly id: 'piezo-enclosed-audio' | 'piezo-disc-audio';
  readonly version: 2;
  readonly passiveDcResistanceOhm: number;
  readonly activeDcResistanceOhm: number;
  readonly activeStartVoltageVolt: number;
  readonly activeNominalVoltageVolt: number;
  readonly activeMaximumVoltageVolt: number;
  readonly activeFrequencyHz: number;
  readonly passiveFrequencyMinHz: number;
  readonly passiveFrequencyMaxHz: number;
  readonly acousticLevel: number;
}

export interface PendingSpeakerProfile {
  readonly id: 'small-speaker-8ohm-pending-owner-svg';
  readonly availability: 'disabled_missing_owner_svg';
  readonly nominalImpedanceOhm: number;
  readonly frequencyMinHz: number;
  readonly frequencyMaxHz: number;
  readonly supportsVariableFrequency: true;
}

export interface PiezoActiveObservation {
  readonly mode: PiezoOperatingMode;
  readonly driveState: PiezoDriveState;
  readonly energized: boolean;
  readonly frequencyHz: number;
  readonly soundLevel: number;
  readonly minimumVoltageVolt: number;
  readonly nominalVoltageVolt: number;
  readonly maximumVoltageVolt: number;
}

export const PIEZO_AUDIO_MODEL_VERSION = 2;

const PASSIVE_DC_RESISTANCE_OHM = 100_000_000;
const ACTIVE_NOMINAL_VOLTAGE_VOLT = 5;
const ACTIVE_NOMINAL_CURRENT_AMP = 0.015;
// A nominal 3 V battery pack settles a few millivolts below its label under
// load. Keep the published 3 V operating limit while accepting that ordinary
// source sag instead of incorrectly silencing a correctly wired buzzer.
const ACTIVE_START_VOLTAGE_TOLERANCE_VOLT = 0.05;

export const PIEZO_TRANSDUCER_PROFILES: Readonly<
  Record<'piezo-passive-buzzer' | 'piezo-disc', PiezoTransducerProfile>
> = {
  'piezo-passive-buzzer': {
    id: 'piezo-enclosed-audio',
    version: PIEZO_AUDIO_MODEL_VERSION,
    passiveDcResistanceOhm: PASSIVE_DC_RESISTANCE_OHM,
    activeDcResistanceOhm: ACTIVE_NOMINAL_VOLTAGE_VOLT / ACTIVE_NOMINAL_CURRENT_AMP,
    activeStartVoltageVolt: 3,
    activeNominalVoltageVolt: ACTIVE_NOMINAL_VOLTAGE_VOLT,
    activeMaximumVoltageVolt: 12,
    activeFrequencyHz: 2_300,
    passiveFrequencyMinHz: 20,
    passiveFrequencyMaxHz: 20_000,
    acousticLevel: 0.8,
  },
  'piezo-disc': {
    id: 'piezo-disc-audio',
    version: PIEZO_AUDIO_MODEL_VERSION,
    passiveDcResistanceOhm: PASSIVE_DC_RESISTANCE_OHM,
    activeDcResistanceOhm: ACTIVE_NOMINAL_VOLTAGE_VOLT / ACTIVE_NOMINAL_CURRENT_AMP,
    activeStartVoltageVolt: 3,
    activeNominalVoltageVolt: ACTIVE_NOMINAL_VOLTAGE_VOLT,
    activeMaximumVoltageVolt: 12,
    activeFrequencyHz: 2_300,
    passiveFrequencyMinHz: 20,
    passiveFrequencyMaxHz: 20_000,
    acousticLevel: 0.62,
  },
};

/**
 * Electrical/audio contract prepared for the future speaker component. It is
 * deliberately not registered as an installable component until an owner SVG
 * and measured terminal geometry exist.
 */
export const PENDING_SMALL_SPEAKER_PROFILE: PendingSpeakerProfile = {
  id: 'small-speaker-8ohm-pending-owner-svg',
  availability: 'disabled_missing_owner_svg',
  nominalImpedanceOhm: 8,
  frequencyMinHz: 100,
  frequencyMaxHz: 8_000,
  supportsVariableFrequency: true,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function piezoOperatingMode(component: SchematicComponent): PiezoOperatingMode {
  return component.stateProperties?.['piezoMode'] === 'active' ? 'active' : 'passive';
}

export function piezoTransducerProfile(component: SchematicComponent): PiezoTransducerProfile {
  return component.componentTypeId === 'piezo-disc'
    ? PIEZO_TRANSDUCER_PROFILES['piezo-disc']
    : PIEZO_TRANSDUCER_PROFILES['piezo-passive-buzzer'];
}

export function piezoDcResistanceOhm(component: SchematicComponent): number {
  const profile = piezoTransducerProfile(component);
  return piezoOperatingMode(component) === 'active'
    ? profile.activeDcResistanceOhm
    : profile.passiveDcResistanceOhm;
}

export function observeActivePiezo(
  component: SchematicComponent,
  voltageDropVolt: number,
): PiezoActiveObservation {
  const profile = piezoTransducerProfile(component);
  const mode = piezoOperatingMode(component);
  if (mode === 'passive') {
    return {
      mode,
      driveState: 'silent',
      energized: false,
      frequencyHz: 0,
      soundLevel: 0,
      minimumVoltageVolt: profile.activeStartVoltageVolt,
      nominalVoltageVolt: profile.activeNominalVoltageVolt,
      maximumVoltageVolt: profile.activeMaximumVoltageVolt,
    };
  }
  if (voltageDropVolt < -0.1) {
    return {
      mode,
      driveState: 'reverse_polarity',
      energized: false,
      frequencyHz: 0,
      soundLevel: 0,
      minimumVoltageVolt: profile.activeStartVoltageVolt,
      nominalVoltageVolt: profile.activeNominalVoltageVolt,
      maximumVoltageVolt: profile.activeMaximumVoltageVolt,
    };
  }
  if (voltageDropVolt + ACTIVE_START_VOLTAGE_TOLERANCE_VOLT < profile.activeStartVoltageVolt) {
    return {
      mode,
      driveState: 'below_voltage',
      energized: false,
      frequencyHz: 0,
      soundLevel: 0,
      minimumVoltageVolt: profile.activeStartVoltageVolt,
      nominalVoltageVolt: profile.activeNominalVoltageVolt,
      maximumVoltageVolt: profile.activeMaximumVoltageVolt,
    };
  }
  const overvoltage = voltageDropVolt > profile.activeMaximumVoltageVolt;
  return {
    mode,
    driveState: overvoltage ? 'overvoltage' : 'sounding',
    energized: true,
    frequencyHz: profile.activeFrequencyHz,
    soundLevel: clamp(
      profile.acousticLevel * (voltageDropVolt / profile.activeNominalVoltageVolt),
      0,
      1,
    ),
    minimumVoltageVolt: profile.activeStartVoltageVolt,
    nominalVoltageVolt: profile.activeNominalVoltageVolt,
    maximumVoltageVolt: profile.activeMaximumVoltageVolt,
  };
}

export function canonicalPiezoAudioProfileRegistry(): string {
  return JSON.stringify({
    modelVersion: PIEZO_AUDIO_MODEL_VERSION,
    profiles: PIEZO_TRANSDUCER_PROFILES,
  });
}
