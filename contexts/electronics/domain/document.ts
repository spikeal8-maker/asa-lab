/** Electronics schematic document stored inside ProjectDraft. */
export type ComponentKind = 'source' | 'resistor' | 'led' | 'wire';
export type Terminal = 'a' | 'b';
export type ElectronicsGeometryProfile = 'legacy-pixel-v1' | 'breadboard-2.54mm-v1';

export interface ComponentPosition {
  readonly x: number;
  readonly y: number;
}

export interface SchematicComponent {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly position: ComponentPosition;
  readonly value: number;
  readonly rotation?: 0 | 90 | 180 | 270;
}

export interface SchematicConnection {
  readonly id: string;
  readonly from: { readonly componentId: string; readonly terminal: Terminal };
  readonly to: { readonly componentId: string; readonly terminal: Terminal };
  readonly color?: string;
  readonly vertices?: readonly ComponentPosition[];
}

export interface ElectronicsDocument {
  readonly schemaVersion: 1;
  /**
   * Layout/physical rendering is versioned independently from the electrical
   * document schema. Missing values from the first foundation are interpreted
   * as `legacy-pixel-v1`; new projects use the 2.54 mm breadboard profile.
   */
  readonly geometryProfile?: ElectronicsGeometryProfile;
  readonly components: readonly SchematicComponent[];
  readonly connections: readonly SchematicConnection[];
}

export const EMPTY_DOCUMENT: ElectronicsDocument = {
  schemaVersion: 1,
  geometryProfile: 'breadboard-2.54mm-v1',
  components: [],
  connections: [],
};

const KINDS: readonly ComponentKind[] = ['source', 'resistor', 'led', 'wire'];
const TERMINALS: readonly Terminal[] = ['a', 'b'];
const GEOMETRY_PROFILES: readonly ElectronicsGeometryProfile[] = [
  'legacy-pixel-v1',
  'breadboard-2.54mm-v1',
];
const ROTATIONS = new Set([0, 90, 180, 270]);
const MAX_COMPONENTS = 100;
const MAX_CONNECTIONS = 200;
const MAX_WIRE_VERTICES = 24;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown, field: string): ComponentPosition | string {
  if (!isPlainObject(value) || !isFiniteNumber(value['x']) || !isFiniteNumber(value['y']))
    return `${field} must contain finite x/y numbers`;
  if (Math.abs(value['x']) > 100000 || Math.abs(value['y']) > 100000)
    return `${field} is outside the supported workspace`;
  return { x: value['x'], y: value['y'] };
}

export type DocumentParseResult =
  | { readonly ok: true; readonly document: ElectronicsDocument }
  | { readonly ok: false; readonly message: string };

export function parseElectronicsDocument(value: unknown): DocumentParseResult {
  if (!isPlainObject(value)) return { ok: false, message: 'document must be an object' };
  if (value['schemaVersion'] !== 1)
    return { ok: false, message: 'unsupported document schemaVersion' };

  const rawGeometryProfile = value['geometryProfile'];
  const geometryProfile: ElectronicsGeometryProfile =
    rawGeometryProfile === undefined
      ? 'legacy-pixel-v1'
      : typeof rawGeometryProfile === 'string' &&
          GEOMETRY_PROFILES.includes(rawGeometryProfile as ElectronicsGeometryProfile)
        ? (rawGeometryProfile as ElectronicsGeometryProfile)
        : (null as never);
  if (geometryProfile === null)
    return { ok: false, message: 'unsupported document geometryProfile' };

  const rawComponents = value['components'];
  const rawConnections = value['connections'];
  if (!Array.isArray(rawComponents) || !Array.isArray(rawConnections))
    return { ok: false, message: 'document must contain components and connections arrays' };
  if (rawComponents.length > MAX_COMPONENTS || rawConnections.length > MAX_CONNECTIONS)
    return { ok: false, message: 'document exceeds the supported size' };

  const components: SchematicComponent[] = [];
  const seenComponents = new Set<string>();
  for (const raw of rawComponents) {
    if (!isPlainObject(raw)) return { ok: false, message: 'component must be an object' };
    const { id, kind, position, value: componentValue, rotation } = raw;
    if (!isId(id) || seenComponents.has(id))
      return { ok: false, message: 'component id must be unique and non-empty' };
    if (typeof kind !== 'string' || !KINDS.includes(kind as ComponentKind))
      return { ok: false, message: `unsupported component kind: ${String(kind)}` };
    const parsedPosition = parsePosition(position, 'component position');
    if (typeof parsedPosition === 'string') return { ok: false, message: parsedPosition };
    if (!isFiniteNumber(componentValue) || componentValue < 0)
      return { ok: false, message: 'component value must be a non-negative number' };
    if (
      rotation !== undefined &&
      (!Number.isInteger(rotation) || !ROTATIONS.has(rotation as number))
    )
      return { ok: false, message: 'component rotation must be 0, 90, 180 or 270' };
    seenComponents.add(id);
    components.push({
      id,
      kind: kind as ComponentKind,
      position: parsedPosition,
      value: componentValue,
      ...(rotation === undefined ? {} : { rotation: rotation as 0 | 90 | 180 | 270 }),
    });
  }

  const connections: SchematicConnection[] = [];
  const seenConnections = new Set<string>();
  for (const raw of rawConnections) {
    if (!isPlainObject(raw)) return { ok: false, message: 'connection must be an object' };
    const { id, from, to, color, vertices } = raw;
    if (!isId(id) || seenConnections.has(id))
      return { ok: false, message: 'connection id must be unique and non-empty' };
    for (const endpoint of [from, to]) {
      if (
        !isPlainObject(endpoint) ||
        !isId(endpoint['componentId']) ||
        !seenComponents.has(endpoint['componentId'] as string) ||
        typeof endpoint['terminal'] !== 'string' ||
        !TERMINALS.includes(endpoint['terminal'] as Terminal)
      )
        return { ok: false, message: 'connection endpoints must reference existing terminals' };
    }
    if (color !== undefined && (typeof color !== 'string' || !COLOR_PATTERN.test(color)))
      return { ok: false, message: 'wire color must be a six-digit hex color' };
    let parsedVertices: ComponentPosition[] | undefined;
    if (vertices !== undefined) {
      if (!Array.isArray(vertices) || vertices.length > MAX_WIRE_VERTICES)
        return { ok: false, message: 'wire vertices must be a bounded array' };
      parsedVertices = [];
      for (const vertex of vertices) {
        const parsed = parsePosition(vertex, 'wire vertex');
        if (typeof parsed === 'string') return { ok: false, message: parsed };
        parsedVertices.push(parsed);
      }
    }
    seenConnections.add(id);
    connections.push({
      id,
      from: {
        componentId: (from as Record<string, unknown>)['componentId'] as string,
        terminal: (from as Record<string, unknown>)['terminal'] as Terminal,
      },
      to: {
        componentId: (to as Record<string, unknown>)['componentId'] as string,
        terminal: (to as Record<string, unknown>)['terminal'] as Terminal,
      },
      ...(color === undefined ? {} : { color }),
      ...(parsedVertices === undefined ? {} : { vertices: parsedVertices }),
    });
  }

  return {
    ok: true,
    document: { schemaVersion: 1, geometryProfile, components, connections },
  };
}
