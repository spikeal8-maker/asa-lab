import { simulationModelSetDigest } from '../../domain/simulation.js';

export const HC_SR04_V2_MODEL_SET_DIGEST =
  'sha256:9676af902ad2603b595c0fdfde8325c34a328da5e4fae1db608f75ffdc971fbc';
export const PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST =
  'sha256:85476b0f4fd6412285623a06c1d2cbf15508339b6e181d8ace5d9f952faa0788';
export const PRE_HC_SR04_V2_MODEL_SET_DIGEST =
  'sha256:fcb0f3241eef974a312c1fa1891b86aee92d5d3cd5a8e76475f53fcaa2b201d5';

/**
 * Comparison-only bridge to immutable goldens recorded before the HC-SR04 v2
 * registry revision. The photoresistor thermal registry revision is pinned
 * explicitly; its changed DC observations have separate benchmark fingerprints.
 * Another registry revision requires new explicit review.
 * Only the exact metadata field is translated; opaque strings (including saved
 * runtime JSON), property order and all other values retain their existing bytes.
 */
export function serializePreHcSr04V2Golden(value: unknown): string {
  if (simulationModelSetDigest() !== PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST)
    throw new Error('Unreviewed model registry for pre-HC-SR04-v2 golden comparison.');
  // The benchmark's digest operation hashes the raw input-digest string.
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value, (key, entry: unknown) => {
    if (key !== 'modelSetDigest') return entry;
    if (entry !== PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST)
      throw new Error('Unreviewed modelSetDigest field in pre-HC-SR04-v2 golden comparison.');
    return PRE_HC_SR04_V2_MODEL_SET_DIGEST;
  });
  if (serialized === undefined) throw new TypeError('The golden result must be serializable.');
  return serialized;
}
