import { isDeepStrictEqual } from 'node:util';
import { previewDigest, type ModuleRegistry } from '@asa-lab/module-sdk';
import type { ProjectPreview } from '@asa-lab/projects';
import type { RoboticsProject } from '@asa-lab/robotics/document';
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

// The Robotics provider reconstructs the whole project and world, including
// bounded inline raster images. Circuit state preserves bounded numbers and
// booleans. Only modelled circuit controls may carry text and arrays.
const ROBOTICS_TEXT_STATE = new Set([
  'arduinoCodeMode',
  'commonMode',
  'contactState',
  'coupling',
  'lampLevel',
  'ledColour',
  'ledFault',
  'measurementMode',
  'meterRange',
  'motorAssemblyProfileId',
  'piezoMode',
  'piezoVariant',
  'pinLayout',
  'resistanceUnit',
  'segmentColor',
  'selectedThrow',
  'simulationStatus',
  'transistorType',
  'waveform',
]);
const LOCAL_DEVICE_VALUE = /^[A-Za-z0-9_.+Ω-]{1,100}$/u;

function hasOnlyPortableRoboticsState(document: RoboticsProject): boolean {
  const localComponents = new Set(document.circuit.components.map(({ id }) => id));
  return document.circuit.components.every((component) =>
    Object.entries(component.stateProperties ?? {}).every(([key, value]) => {
      if (typeof value === 'boolean' || typeof value === 'number') return true;
      if (key === 'arduinoInputPins')
        return Array.isArray(value) && value.every((pin) => LOCAL_DEVICE_VALUE.test(pin));
      if (typeof value !== 'string') return false;
      if (key === 'arduinoSource' || key === 'arduinoWorkspace') return true;
      if (key === 'lightSourceComponentId') return value === '' || localComponents.has(value);
      return ROBOTICS_TEXT_STATE.has(key) && LOCAL_DEVICE_VALUE.test(value);
    }),
  );
}

export function validatePortableProjectCopyDocument(
  registry: ModuleRegistry,
  moduleKey: string,
  document: unknown,
): { readonly document: unknown; readonly preview: ProjectPreview | null } | null {
  const entry = registry.get(moduleKey);
  if (!entry?.provider || !['three-d', 'electronics', 'robotics'].includes(moduleKey)) return null;
  const parsed = validationMessage(entry, document);
  // Preserve the exact JSON and reject unknown fields that could contain private references.
  if (
    !parsed.ok ||
    !isDeepStrictEqual(parsed.document, document) ||
    (moduleKey === 'three-d' && !hasOnlyPortableThreeDFields(document)) ||
    (moduleKey === 'robotics' && !hasOnlyPortableRoboticsState(parsed.document as RoboticsProject))
  ) {
    return null;
  }
  const descriptor = entry.provider.createPreview(parsed.document);
  return {
    document,
    preview: descriptor ? { descriptor, digest: previewDigest(descriptor) } : null,
  };
}
