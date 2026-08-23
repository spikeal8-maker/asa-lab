import type { SchematicComponent } from './document.js';

export const PHOTORESISTOR_DEFAULT_ILLUMINATION = 0.5;
export const PHOTORESISTOR_DARK_RESISTANCE_OHM = 1_000_000;
export const PHOTORESISTOR_BRIGHT_RESISTANCE_OHM = 500;

export function photoresistorIllumination(component: SchematicComponent): number {
  const raw = Number(
    component.stateProperties?.['illumination'] ?? PHOTORESISTOR_DEFAULT_ILLUMINATION,
  );
  if (!Number.isFinite(raw)) return PHOTORESISTOR_DEFAULT_ILLUMINATION;
  return Math.min(1, Math.max(0, raw));
}

/** Deterministic log interpolation models the broad monotonic response of an educational LDR. */
export function photoresistorResistanceOhm(component: SchematicComponent): number {
  const illumination = photoresistorIllumination(component);
  return (
    PHOTORESISTOR_DARK_RESISTANCE_OHM *
    (PHOTORESISTOR_BRIGHT_RESISTANCE_OHM / PHOTORESISTOR_DARK_RESISTANCE_OHM) ** illumination
  );
}
