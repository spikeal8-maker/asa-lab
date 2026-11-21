import type { PublicArtifactProvenance } from './public-artifact.js';

export const PUBLIC_THREE_D_PRIMITIVES = [
  'box',
  'cylinder',
  'sphere',
  'cone',
  'torus',
  'wedge',
  'roof',
  'pyramid',
  'half-sphere',
  'tube',
  'rounded-box',
  'polygon',
  'star',
  'heart',
  'diamond',
  'capsule',
  'paraboloid',
  'extrude-sketch',
  'revolve-sketch',
  'scribble',
  'text',
  'round-roof',
  'ring',
  'icosahedron',
  'star-6',
] as const;
export const PUBLIC_THREE_D_NUMBER_PARAMETERS = [
  'topRadius',
  'baseRadius',
  'innerRadius',
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
] as const;
export type PublicThreeDVector = Readonly<{ x: number; y: number; z: number }>;
export interface PublicThreeDNode {
  readonly id: string;
  readonly primitive: (typeof PUBLIC_THREE_D_PRIMITIVES)[number];
  readonly name: string;
  readonly operation: 'solid' | 'hole';
  readonly color: string;
  readonly opacity: number;
  readonly transform: Readonly<{
    position: PublicThreeDVector;
    rotation: PublicThreeDVector;
    scale: PublicThreeDVector;
  }>;
  readonly dimensions: Readonly<{ width: number; depth: number; height: number }>;
  readonly sides: number;
  readonly bevel: number;
  readonly parameters: Readonly<Record<(typeof PUBLIC_THREE_D_NUMBER_PARAMETERS)[number], number>> &
    Readonly<{
      text: string;
      font: 'sans' | 'serif' | 'mono';
      smoothTwist: boolean;
      sketchPoints: readonly Readonly<{ x: number; y: number }>[];
      sketchAccepted: boolean;
    }>;
  readonly visible: boolean;
  readonly groupId: string | null;
  readonly groupOperation: 'union' | 'difference' | 'intersection' | null;
}
export interface PublicThreeDArtifact {
  readonly schemaVersion: 4;
  readonly status: 'display';
  readonly viewerFamily: 'three-d';
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: Readonly<{ readOnly: true; interactive: true; download: false }>;
  readonly units: 'mm';
  readonly nodes: readonly PublicThreeDNode[];
}
export const PUBLIC_THREE_D_NODE_FIELDS = [
  'id',
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
  'groupId',
  'groupOperation',
] as const;
export const PUBLIC_THREE_D_LIMITS = Object.freeze({ nodes: 256, bytes: 524288, points: 2048 });

/** Geometry-only wire contract. Never transport an editor document/property bag. */
export function validatePublicThreeDArtifact(
  input: unknown,
):
  | { readonly ok: true; readonly artifact: PublicThreeDArtifact }
  | { readonly ok: false; readonly reason: 'invalid-public-artifact' } {
  try {
    let budget = 0;
    const seen = new Set<object>();
    function inspect(v: unknown, depth: number): void {
      if (++budget > 45000 || depth > 12) throw Error();
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw Error();
        return;
      }
      if (typeof v === 'string') {
        if (v.length > 512) throw Error();
        return;
      }
      if (!v || typeof v !== 'object' || seen.has(v)) throw Error();
      if (Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype))
        throw Error();
      seen.add(v);
      for (const key of Reflect.ownKeys(v)) {
        if (Array.isArray(v) && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor))
          throw Error();
        inspect(descriptor.value, depth + 1);
      }
    }
    const record = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error();
      const actual = Object.keys(v);
      if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw Error();
      return v as Record<string, unknown>;
    };
    const number = (v: unknown, min = -100000, max = 100000): number => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw Error();
      return v;
    };
    const text = (v: unknown, max: number): string => {
      if (typeof v !== 'string' || v.length > max || v.includes('\0')) throw Error();
      return v;
    };
    inspect(input, 0);
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > PUBLIC_THREE_D_LIMITS.bytes)
      throw Error();
    const a = record(input, [
      'schemaVersion',
      'status',
      'viewerFamily',
      'provenance',
      'capabilities',
      'units',
      'nodes',
    ]);
    if (
      a.schemaVersion !== 4 ||
      a.status !== 'display' ||
      a.viewerFamily !== 'three-d' ||
      a.units !== 'mm'
    )
      throw Error();
    const p = record(a.provenance, ['publicationId', 'revisionNumber']);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        text(p.publicationId, 36),
      ) ||
      !Number.isSafeInteger(p.revisionNumber) ||
      number(p.revisionNumber, 1) < 1
    )
      throw Error();
    const c = record(a.capabilities, ['readOnly', 'interactive', 'download']);
    if (c.readOnly !== true || c.interactive !== true || c.download !== false) throw Error();
    if (!Array.isArray(a.nodes) || !a.nodes.length || a.nodes.length > PUBLIC_THREE_D_LIMITS.nodes)
      throw Error();
    const ids = new Set<string>();
    let points = 0;
    const groups = new Map<string, string>();
    for (const raw of a.nodes) {
      const n = record(raw, PUBLIC_THREE_D_NODE_FIELDS);
      const id = text(n.id, 128);
      if (
        !id ||
        ids.has(id) ||
        !PUBLIC_THREE_D_PRIMITIVES.includes(n.primitive as PublicThreeDNode['primitive'])
      )
        throw Error();
      ids.add(id);
      text(n.name, 256);
      if (
        !['solid', 'hole'].includes(String(n.operation)) ||
        !/^#[0-9a-f]{6}$/i.test(text(n.color, 7)) ||
        typeof n.visible !== 'boolean'
      )
        throw Error();
      number(n.opacity, 0, 1);
      number(n.bevel, 0, 1000);
      if (!Number.isInteger(n.sides)) throw Error();
      number(n.sides, 3, 128);
      const transform = record(n.transform, ['position', 'rotation', 'scale']);
      for (const key of ['position', 'rotation', 'scale']) {
        const vector = record(transform[key], ['x', 'y', 'z']);
        for (const axis of ['x', 'y', 'z']) number(vector[axis]);
      }
      const dimensions = record(n.dimensions, ['width', 'depth', 'height']);
      for (const key of ['width', 'depth', 'height']) number(dimensions[key], 0.01);
      const parameters = record(n.parameters, [
        ...PUBLIC_THREE_D_NUMBER_PARAMETERS,
        'text',
        'font',
        'smoothTwist',
        'sketchPoints',
        'sketchAccepted',
      ]);
      for (const key of PUBLIC_THREE_D_NUMBER_PARAMETERS) number(parameters[key]);
      number(parameters.steps, 1, 128);
      number(parameters.twistSteps, 1, 64);
      number(parameters.segments, 0, 128);
      text(parameters.text, 256);
      if (
        !['sans', 'serif', 'mono'].includes(String(parameters.font)) ||
        typeof parameters.smoothTwist !== 'boolean' ||
        typeof parameters.sketchAccepted !== 'boolean'
      )
        throw Error();
      if (!Array.isArray(parameters.sketchPoints) || parameters.sketchPoints.length > 256)
        throw Error();
      points += parameters.sketchPoints.length;
      if (points > PUBLIC_THREE_D_LIMITS.points) throw Error();
      for (const rawPoint of parameters.sketchPoints) {
        const point = record(rawPoint, ['x', 'y']);
        number(point.x);
        number(point.y);
      }
      if (n.groupId === null) {
        if (n.groupOperation !== null) throw Error();
      } else {
        const group = text(n.groupId, 128);
        if (!group || !['union', 'difference', 'intersection'].includes(String(n.groupOperation)))
          throw Error();
        if (groups.has(group) && groups.get(group) !== n.groupOperation) throw Error();
        groups.set(group, String(n.groupOperation));
      }
    }
    return { ok: true, artifact: JSON.parse(JSON.stringify(input)) as PublicThreeDArtifact };
  } catch {
    return { ok: false, reason: 'invalid-public-artifact' };
  }
}
