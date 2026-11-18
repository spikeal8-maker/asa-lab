import { createHash } from 'node:crypto';
import { canonicalElectricalModelRegistry } from '../../domain/model-identity.js';
import { simulationModelSetDigest } from '../../domain/simulation.js';

export const HC_SR04_V2_MODEL_SET_DIGEST =
  'sha256:9676af902ad2603b595c0fdfde8325c34a328da5e4fae1db608f75ffdc971fbc';
export const PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST =
  'sha256:85476b0f4fd6412285623a06c1d2cbf15508339b6e181d8ace5d9f952faa0788';
export const PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST =
  'sha256:e247ff2ce80032038d9017f919e1b96872d95fa8ec7280835463792baf8b25e2';
export const PRE_HC_SR04_V2_MODEL_SET_DIGEST =
  'sha256:fcb0f3241eef974a312c1fa1891b86aee92d5d3cd5a8e76475f53fcaa2b201d5';
/** Exact L298N v1 registry and bounded board profile; requires independent final-source review. */
export const L298N_MODEL_SET_DIGEST =
  'sha256:3bbb15e6e5fbea0b32357b7dd48900261d0197878ada13b010067cab33715f3f';
/** Unchanged identity projection of the previous 43-entry registry. */
export const PRE_L298N_REGISTRY_SHA256 =
  'sha256:c999b9d097296f571bf2b45b3638c8a8e83d523d525a708a4e2052fd68381491';

function verifiedL298nRegistryRevision(): void {
  if (simulationModelSetDigest() !== L298N_MODEL_SET_DIGEST)
    throw new Error('Unreviewed model registry for pre-HC-SR04-v2 golden comparison.');
  const parsed = JSON.parse(canonicalElectricalModelRegistry()) as {
    registryVersion: number;
    entries: { componentTypeId: string; electricalModelId: string; modelProfileId: string }[];
  };
  const l298n = parsed.entries.filter((item) => item.componentTypeId === 'l298n-motor-driver');
  if (
    parsed.entries.length !== 44 ||
    l298n.length !== 1 ||
    l298n[0]?.electricalModelId !== 'l298n-dual-hbridge' ||
    l298n[0]?.modelProfileId !== 'l298n-red-43mm-v1'
  )
    throw new Error('Unreviewed model registry for pre-HC-SR04-v2 golden comparison.');
  const previousEntries = parsed.entries.filter(
    (item) => item.componentTypeId !== 'l298n-motor-driver',
  );
  const previousHash =
    'sha256:' +
    createHash('sha256')
      .update(
        JSON.stringify({ registryVersion: parsed.registryVersion, entries: previousEntries }),
        'utf8',
      )
      .digest('hex');
  if (previousHash !== PRE_L298N_REGISTRY_SHA256)
    throw new Error('Unreviewed model registry: previous identities changed with L298N.');
}

/**
 * Comparison-only bridge to immutable goldens recorded before the HC-SR04 v2
 * registry revision. Historical photoresistor digests remain pinned. The P1 L298N
 * model-set digest is separately pinned and its previous 43 identities are
 * verified byte-for-byte. Other registry revisions require independent review.
 * The thermal revision's changed DC observations have separate benchmark fingerprints.
 * Only the exact metadata field is translated; opaque strings (including saved
 * runtime JSON), property order and all other values retain their existing bytes.
 */
export function serializePreHcSr04V2Golden(value: unknown): string {
  verifiedL298nRegistryRevision();
  // The benchmark's digest operation hashes the raw input-digest string.
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value, (key, entry: unknown) => {
    if (key !== 'modelSetDigest') return entry;
    if (entry !== L298N_MODEL_SET_DIGEST)
      throw new Error('Unreviewed modelSetDigest field in pre-HC-SR04-v2 golden comparison.');
    return PRE_HC_SR04_V2_MODEL_SET_DIGEST;
  });
  if (serialized === undefined) throw new TypeError('The golden result must be serializable.');
  return serialized;
}
