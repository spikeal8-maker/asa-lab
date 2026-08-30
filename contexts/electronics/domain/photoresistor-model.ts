import type { SchematicComponent } from './document.js';

export const PHOTORESISTOR_DEFAULT_ILLUMINATION = 0.5;
export const PHOTORESISTOR_PROFILE_REGISTRY_VERSION = 1;

/**
 * Educational CdS LDR profile based on the published GL5528 characteristic class.
 * It is deliberately a representative curve rather than a claim about an exact
 * specimen: real photoresistors have wide part-to-part tolerances.
 */
export const PHOTORESISTOR_PROFILE = {
  profileId: 'generic-photoresistor',
  profileVersion: 2,
  referenceClass: 'GL5528-class 5 mm CdS LDR',
  darkResistanceOhm: 1_000_000,
  resistanceAt10LuxOhm: 15_000,
  gamma: 0.7,
  maximumIlluminanceLux: 10_000,
  controlCurveScaleLux: 0.1,
  maximumVoltageVolt: 150,
  maximumPowerWatt: 0.1,
  sourceIds: ['senba-gl5528-datasheet', 'adafruit-photocells-guide'],
} as const;

export const PHOTORESISTOR_DARK_RESISTANCE_OHM = PHOTORESISTOR_PROFILE.darkResistanceOhm;

export const PHOTORESISTOR_BRIGHT_RESISTANCE_OHM =
  PHOTORESISTOR_PROFILE.resistanceAt10LuxOhm *
  (PHOTORESISTOR_PROFILE.maximumIlluminanceLux / 10) ** -PHOTORESISTOR_PROFILE.gamma;

export function photoresistorIllumination(component: SchematicComponent): number {
  const raw = Number(
    component.stateProperties?.['illumination'] ?? PHOTORESISTOR_DEFAULT_ILLUMINATION,
  );
  if (!Number.isFinite(raw)) return PHOTORESISTOR_DEFAULT_ILLUMINATION;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Converts the normalized runtime control to a continuous logarithmic lux scale.
 * Zero remains true darkness; the rest of the slider covers dim night light through
 * bright daylight without spending almost its entire travel at the bright end.
 */
export function photoresistorIlluminanceLux(component: SchematicComponent): number {
  const illumination = photoresistorIllumination(component);
  if (illumination === 0) return 0;
  const scale = PHOTORESISTOR_PROFILE.controlCurveScaleLux;
  const ratio = PHOTORESISTOR_PROFILE.maximumIlluminanceLux / scale;
  return scale * ((ratio + 1) ** illumination - 1);
}

/** Deterministic GL5528-class R10/lux power curve with finite profile limits. */
export function photoresistorResistanceAtIlluminanceOhm(lux: number): number {
  const normalizedLux = Number.isFinite(lux)
    ? Math.min(PHOTORESISTOR_PROFILE.maximumIlluminanceLux, Math.max(0, lux))
    : 0;
  if (normalizedLux <= 0) return PHOTORESISTOR_DARK_RESISTANCE_OHM;
  const resistance =
    PHOTORESISTOR_PROFILE.resistanceAt10LuxOhm *
    (normalizedLux / 10) ** -PHOTORESISTOR_PROFILE.gamma;
  return Math.min(
    PHOTORESISTOR_DARK_RESISTANCE_OHM,
    Math.max(PHOTORESISTOR_BRIGHT_RESISTANCE_OHM, resistance),
  );
}

export function photoresistorResistanceOhm(component: SchematicComponent): number {
  return photoresistorResistanceAtIlluminanceOhm(photoresistorIlluminanceLux(component));
}

export function canonicalPhotoresistorProfileRegistry(): string {
  return JSON.stringify({
    registryVersion: PHOTORESISTOR_PROFILE_REGISTRY_VERSION,
    profiles: [PHOTORESISTOR_PROFILE],
  });
}
