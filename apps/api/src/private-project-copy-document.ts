import { isDeepStrictEqual } from 'node:util';
import { previewDigest, type ModuleRegistry } from '@asa-lab/module-sdk';
import type { ProjectPreview } from '@asa-lab/projects';
import { validationMessage } from './validation.js';

// 3D's parser preserves extension fields. Do not transport unknown extensions:
// future assets/imports need their own copy policy before crossing tenant RLS.
const THREE_D_KEYS = new Set([
  'schemaVersion',
  'units',
  'nodes',
  'grid',
  'camera',
  'ruler',
  'id',
  'kind',
  'primitive',
  'name',
  'operation',
  'color',
  'opacity',
  'transform',
  'dimensions',
  'sides',
  'bevel',
  'parameters',
  'visible',
  'locked',
  'bundleId',
  'groupId',
  'groupOperation',
  'position',
  'rotation',
  'scale',
  'x',
  'y',
  'z',
  'width',
  'depth',
  'height',
  'snap',
  'target',
  'projection',
  'origin',
  'precision',
  'topRadius',
  'baseRadius',
  'innerRadius',
  'text',
  'font',
  'curveAngle',
  'bevelSegments',
  'radius',
  'tubeRadius',
  'wallThickness',
  'steps',
  'points',
  'innerRatio',
  'fontSize',
  'segments',
  'topScale',
  'baseScale',
  'twist',
  'twistSteps',
  'smoothTwist',
  'sketchPoints',
  'sketchAccepted',
]);
function hasOnlyPortableThreeDFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasOnlyPortableThreeDFields);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(
      ([key, nested]) => THREE_D_KEYS.has(key) && hasOnlyPortableThreeDFields(nested),
    );
  }
  return true;
}

export function validatePortableProjectCopyDocument(
  registry: ModuleRegistry,
  moduleKey: string,
  document: unknown,
): { readonly document: unknown; readonly preview: ProjectPreview | null } | null {
  const entry = registry.get(moduleKey);
  if (!entry?.provider || (moduleKey !== 'three-d' && moduleKey !== 'electronics')) return null;
  const parsed = validationMessage(entry, document);
  // Preserve the exact JSON and reject unknown fields that could contain private references.
  if (
    !parsed.ok ||
    !isDeepStrictEqual(parsed.document, document) ||
    (moduleKey === 'three-d' && !hasOnlyPortableThreeDFields(document))
  ) {
    return null;
  }
  const descriptor = entry.provider.createPreview(parsed.document);
  return {
    document,
    preview: descriptor ? { descriptor, digest: previewDigest(descriptor) } : null,
  };
}
