/** Schema-versioned Electronics document stored inside a mutable ProjectDraft. */
export type ComponentKind =
  'source' | 'resistor' | 'led' | 'button' | 'switch' | 'potentiometer' | 'diode' | 'lamp' | 'wire';
export type Terminal = 'a' | 'b' | 'wiper';
export type Rotation = 0 | 90 | 180 | 270;

export interface ComponentPosition {
  readonly x: number;
  readonly y: number;
}

export interface SchematicComponent {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly position: ComponentPosition;
  /** Primary electrical value: V, Ohm or forward drop depending on kind. */
  readonly value: number;
  readonly rotation?: Rotation;
  readonly name?: string;
  /** Closed/pressed state for switches and buttons. */
  readonly state?: boolean;
  /** Potentiometer wiper position from terminal a (0) to terminal b (1). */
  readonly wiperPosition?: number;
}

export interface TerminalRef {
  readonly componentId: string;
  readonly terminal: Terminal;
}

export interface SchematicConnection {
  readonly id: string;
  readonly from: TerminalRef;
  readonly to: TerminalRef;
  readonly color?: string;
  readonly vertices?: readonly ComponentPosition[];
}

export interface ElectronicsViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface SimulationSettings {
  readonly running: boolean;
  readonly maxIterations: number;
}

export interface ElectronicsDocument {
  readonly schemaVersion: 2;
  readonly components: readonly SchematicComponent[];
  readonly connections: readonly SchematicConnection[];
  readonly viewport: ElectronicsViewport;
  readonly simulation: SimulationSettings;
}

export const DEFAULT_VIEWPORT: ElectronicsViewport = { x: 0, y: 0, zoom: 1 };
export const DEFAULT_SIMULATION: SimulationSettings = { running: false, maxIterations: 24 };
export const EMPTY_DOCUMENT: ElectronicsDocument = {
  schemaVersion: 2,
  components: [],
  connections: [],
  viewport: DEFAULT_VIEWPORT,
  simulation: DEFAULT_SIMULATION,
};

const KINDS: readonly ComponentKind[] = [
  'source',
  'resistor',
  'led',
  'button',
  'switch',
  'potentiometer',
  'diode',
  'lamp',
  'wire',
];
const ROTATIONS = new Set([0, 90, 180, 270]);
const MAX_COMPONENTS = 300;
const MAX_CONNECTIONS = 800;
const MAX_WIRE_VERTICES = 48;
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
  if (!isPlainObject(value) || !isFiniteNumber(value['x']) || !isFiniteNumber(value['y'])) {
    return `${field} must contain finite x/y numbers`;
  }
  if (Math.abs(value['x']) > 100000 || Math.abs(value['y']) > 100000) {
    return `${field} is outside the supported workspace`;
  }
  return { x: value['x'], y: value['y'] };
}

export function terminalsForKind(kind: ComponentKind): readonly Terminal[] {
  return kind === 'potentiometer' ? ['a', 'b', 'wiper'] : ['a', 'b'];
}

export type DocumentParseResult =
  | { readonly ok: true; readonly document: ElectronicsDocument; readonly migrated: boolean }
  | { readonly ok: false; readonly message: string };

/** Accepts the historical schema v1 and normalises it additively to v2. */
export function parseElectronicsDocument(value: unknown): DocumentParseResult {
  if (!isPlainObject(value)) return { ok: false, message: 'document must be an object' };
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    return { ok: false, message: 'unsupported document schemaVersion' };
  }
  const rawComponents = value['components'];
  const rawConnections = value['connections'];
  if (!Array.isArray(rawComponents) || !Array.isArray(rawConnections)) {
    return { ok: false, message: 'document must contain components and connections arrays' };
  }
  if (rawComponents.length > MAX_COMPONENTS || rawConnections.length > MAX_CONNECTIONS) {
    return { ok: false, message: 'document exceeds the supported size' };
  }

  const components: SchematicComponent[] = [];
  const seenComponents = new Set<string>();
  const kindById = new Map<string, ComponentKind>();
  for (const raw of rawComponents) {
    if (!isPlainObject(raw)) return { ok: false, message: 'component must be an object' };
    const { id, kind, position, value: componentValue, rotation, name, state, wiperPosition } = raw;
    if (!isId(id) || seenComponents.has(id)) {
      return { ok: false, message: 'component id must be unique and non-empty' };
    }
    if (typeof kind !== 'string' || !KINDS.includes(kind as ComponentKind)) {
      return { ok: false, message: `unsupported component kind: ${String(kind)}` };
    }
    const parsedPosition = parsePosition(position, 'component position');
    if (typeof parsedPosition === 'string') return { ok: false, message: parsedPosition };
    if (!isFiniteNumber(componentValue) || componentValue < 0 || componentValue > 1_000_000_000) {
      return { ok: false, message: 'component value must be a bounded non-negative number' };
    }
    if (
      rotation !== undefined &&
      (!Number.isInteger(rotation) || !ROTATIONS.has(rotation as number))
    ) {
      return { ok: false, message: 'component rotation must be 0, 90, 180 or 270' };
    }
    if (name !== undefined && (typeof name !== 'string' || name.length > 120)) {
      return { ok: false, message: 'component name must be at most 120 characters' };
    }
    if (state !== undefined && typeof state !== 'boolean') {
      return { ok: false, message: 'component state must be boolean' };
    }
    if (
      wiperPosition !== undefined &&
      (!isFiniteNumber(wiperPosition) || wiperPosition < 0 || wiperPosition > 1)
    ) {
      return { ok: false, message: 'potentiometer wiperPosition must be between 0 and 1' };
    }
    const parsedKind = kind as ComponentKind;
    seenComponents.add(id);
    kindById.set(id, parsedKind);
    components.push({
      id,
      kind: parsedKind,
      position: parsedPosition,
      value: componentValue,
      ...(rotation === undefined ? {} : { rotation: rotation as Rotation }),
      ...(name === undefined ? {} : { name }),
      ...(state === undefined ? {} : { state }),
      ...(wiperPosition === undefined ? {} : { wiperPosition }),
    });
  }

  const connections: SchematicConnection[] = [];
  const seenConnections = new Set<string>();
  for (const raw of rawConnections) {
    if (!isPlainObject(raw)) return { ok: false, message: 'connection must be an object' };
    const { id, from, to, color, vertices } = raw;
    if (!isId(id) || seenConnections.has(id)) {
      return { ok: false, message: 'connection id must be unique and non-empty' };
    }
    const endpoints: TerminalRef[] = [];
    for (const endpoint of [from, to]) {
      if (!isPlainObject(endpoint) || !isId(endpoint['componentId'])) {
        return { ok: false, message: 'connection endpoints must reference existing terminals' };
      }
      const componentId = endpoint['componentId'];
      const componentKind = kindById.get(componentId);
      const terminal = endpoint['terminal'];
      if (
        !componentKind ||
        typeof terminal !== 'string' ||
        !terminalsForKind(componentKind).includes(terminal as Terminal)
      ) {
        return { ok: false, message: 'connection endpoints must reference existing terminals' };
      }
      endpoints.push({ componentId, terminal: terminal as Terminal });
    }
    if (color !== undefined && (typeof color !== 'string' || !COLOR_PATTERN.test(color))) {
      return { ok: false, message: 'wire color must be a six-digit hex color' };
    }
    let parsedVertices: ComponentPosition[] | undefined;
    if (vertices !== undefined) {
      if (!Array.isArray(vertices) || vertices.length > MAX_WIRE_VERTICES) {
        return { ok: false, message: 'wire vertices must be a bounded array' };
      }
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
      from: endpoints[0] as TerminalRef,
      to: endpoints[1] as TerminalRef,
      ...(color === undefined ? {} : { color }),
      ...(parsedVertices === undefined ? {} : { vertices: parsedVertices }),
    });
  }

  let viewport = DEFAULT_VIEWPORT;
  if (schemaVersion === 2 && value['viewport'] !== undefined) {
    const rawViewport = value['viewport'];
    if (
      !isPlainObject(rawViewport) ||
      !isFiniteNumber(rawViewport['x']) ||
      !isFiniteNumber(rawViewport['y']) ||
      !isFiniteNumber(rawViewport['zoom']) ||
      rawViewport['zoom'] < 0.1 ||
      rawViewport['zoom'] > 8
    ) {
      return { ok: false, message: 'viewport must contain bounded x/y/zoom numbers' };
    }
    viewport = { x: rawViewport['x'], y: rawViewport['y'], zoom: rawViewport['zoom'] };
  }

  let simulation = DEFAULT_SIMULATION;
  if (schemaVersion === 2 && value['simulation'] !== undefined) {
    const rawSimulation = value['simulation'];
    if (
      !isPlainObject(rawSimulation) ||
      typeof rawSimulation['running'] !== 'boolean' ||
      !Number.isInteger(rawSimulation['maxIterations']) ||
      (rawSimulation['maxIterations'] as number) < 4 ||
      (rawSimulation['maxIterations'] as number) > 100
    ) {
      return { ok: false, message: 'simulation settings are invalid' };
    }
    simulation = {
      running: rawSimulation['running'],
      maxIterations: rawSimulation['maxIterations'] as number,
    };
  }

  return {
    ok: true,
    migrated: schemaVersion === 1,
    document: { schemaVersion: 2, components, connections, viewport, simulation },
  };
}
