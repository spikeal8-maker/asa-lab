import type { SchematicComponent } from './document.js';

export const PHOTORESISTOR_DEFAULT_ILLUMINATION = 0.5;

export function photoresistorIllumination(component: SchematicComponent): number {
  const raw = Number(
    component.stateProperties?.['illumination'] ?? PHOTORESISTOR_DEFAULT_ILLUMINATION,
  );
  if (!Number.isFinite(raw)) return PHOTORESISTOR_DEFAULT_ILLUMINATION;
  return Math.min(1, Math.max(0, raw));
}
