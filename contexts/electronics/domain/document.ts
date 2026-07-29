import {
  COMPONENT_KINDS,
  componentValueError,
  isComponentTerminal,
  type ComponentKind,
  type TerminalId,
} from './component-model.js';

export type { ComponentKind, TerminalId } from './component-model.js';
/** @deprecated Use TerminalId. Kept as a source-compatible alias. */
export type Terminal = TerminalId;

/** Electronics schematic document stored inside ProjectDraft. */
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

export interface SchematicEndpoint {
  readonly componentId: string;
  /** Stable within the component definition; existing documents use a/b. */
  readonly terminal: TerminalId;
}

export interface SchematicConnection {
  readonly id: string;
  readonly from: SchematicEndpoint;
  readonly to: SchematicEndpoint;
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

const GEOMETRY_PROFILES: readonly ElectronicsGeometryProfile[] = [
  'legacy-pixel-v1',
  'breadboard-2.54mm-v1',
];
const ROTATIONS = new Set([0, 90, 180, 270]);
const MAX_COMPONENTS = 100;
const MAX_CONNECTIONS = 200;
const MAX_WIRE_VERTICES = 24;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isTerminalId(value: unknown): value is TerminalId {
  return typeof value === 'string' && TERMINAL_ID_PATTERN.test(value);
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

function parseGeometryProfile(value: unknown): ElectronicsGeometryProfile | null {
  if (value === undefined) return 'legacy-pixel-v1';
  if (
    typeof value === 'string' &&
    GEOMETRY_PROFILES.includes(value as ElectronicsGeometryProfile)
  ) {
    return value as ElectronicsGeometryProfile;
  }
  return null;
}

function parseEndpoint(
  value: unknown,
  field: string,
  componentKinds: ReadonlyMap<string, ComponentKind>,
): SchematicEndpoint | string {
  if (!isPlainObject(value) || !isId(value['componentId']) || !isTerminalId(value['terminal'])) {
    return `${field} must contain a componentId and safe terminal ID`;
  }
  const componentId = value['componentId'];
  const kind = componentKinds.get(componentId);
  if (!kind) return `${field} must reference an existing component`;
  const terminal = value['terminal'];
  if (!isComponentTerminal(kind, terminal)) {
    return `${field} references unsupported terminal ${terminal} on ${kind}`;
  }
  return { componentId, terminal };
}

function endpointKey(endpoint: SchematicEndpoint): string {
  return `${endpoint.componentId}:${endpoint.terminal}`;
}

function connectionPairKey(from: SchematicEndpoint, to: SchematicEndpoint): string {
  return [endpointKey(from), endpointKey(to)].sort().join('|');
}

export type DocumentParseResult =
  | { readonly ok: true; readonly document: ElectronicsDocument }
  | { readonly ok: false; readonly message: string };

export function parseElectronicsDocument(value: unknown): DocumentParseResult {
  if (!isPlainObject(value)) return { ok: false, message: 'document must be an object' };
  if (value['schemaVersion'] !== 1)
    return { ok: false, message: 'unsupported document schemaVersion' };

  const geometryProfile = parseGeometryProfile(value['geometryProfile']);
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
  const componentKinds = new Map<string, ComponentKind>();
  for (const raw of rawComponents) {
    if (!isPlainObject(raw)) return { ok: false, message: 'component must be an object' };
    const { id, kind, position, value: componentValue, rotation } = raw;
    if (!isId(id) || seenComponents.has(id))
      return { ok: false, message: 'component id must be unique and non-empty' };
    if (typeof kind !== 'string' || !COMPONENT_KINDS.includes(kind as ComponentKind))
      return { ok: false, message: `unsupported component kind: ${String(kind)}` };
    const componentKind = kind as ComponentKind;
    const parsedPosition = parsePosition(position, 'component position');
    if (typeof parsedPosition === 'string') return { ok: false, message: parsedPosition };
    if (!isFiniteNumber(componentValue))
      return { ok: false, message: 'component value must be a finite number' };
    const valueError = componentValueError(componentKind, componentValue);
    if (valueError) return { ok: false, message: valueError };
    if (
      rotation !== undefined &&
      (!Number.isInteger(rotation) || !ROTATIONS.has(rotation as number))
    )
      return { ok: false, message: 'component rotation must be 0, 90, 180 or 270' };
    seenComponents.add(id);
    componentKinds.set(id, componentKind);
    components.push({
      id,
      kind: componentKind,
      position: parsedPosition,
      value: componentValue,
      ...(rotation === undefined ? {} : { rotation: rotation as 0 | 90 | 180 | 270 }),
    });
  }

  const connections: SchematicConnection[] = [];
  const seenConnections = new Set<string>();
  const seenEndpointPairs = new Set<string>();
  for (const raw of rawConnections) {
    if (!isPlainObject(raw)) return { ok: false, message: 'connection must be an object' };
    const { id, from: rawFrom, to: rawTo, color, vertices } = raw;
    if (!isId(id) || seenConnections.has(id))
      return { ok: false, message: 'connection id must be unique and non-empty' };
    const from = parseEndpoint(rawFrom, 'connection from', componentKinds);
    if (typeof from === 'string') return { ok: false, message: from };
    const to = parseEndpoint(rawTo, 'connection to', componentKinds);
    if (typeof to === 'string') return { ok: false, message: to };
    if (endpointKey(from) === endpointKey(to)) {
      return { ok: false, message: 'connection cannot join a terminal to itself' };
    }
    const pairKey = connectionPairKey(from, to);
    if (seenEndpointPairs.has(pairKey)) {
      return { ok: false, message: 'duplicate connection endpoints are not allowed' };
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
    seenEndpointPairs.add(pairKey);
    connections.push({
      id,
      from,
      to,
      ...(color === undefined ? {} : { color }),
      ...(parsedVertices === undefined ? {} : { vertices: parsedVertices }),
    });
  }

  return {
    ok: true,
    document: { schemaVersion: 1, geometryProfile, components, connections },
  };
}
