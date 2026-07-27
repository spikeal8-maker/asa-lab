/** Electronics schematic document: the subject payload stored inside a
 * project draft. Deliberately tiny — four component kinds and plain wires. */

export type ComponentKind = 'source' | 'resistor' | 'led' | 'wire';

/** Every component exposes exactly two terminals in this slice. */
export type Terminal = 'a' | 'b';

export interface ComponentPosition {
  readonly x: number;
  readonly y: number;
}

export interface SchematicComponent {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly position: ComponentPosition;
  /** Source: volts. Resistor: ohms. LED: forward voltage. Wire: unused. */
  readonly value: number;
}

export interface SchematicConnection {
  readonly id: string;
  readonly from: { readonly componentId: string; readonly terminal: Terminal };
  readonly to: { readonly componentId: string; readonly terminal: Terminal };
}

export interface ElectronicsDocument {
  readonly schemaVersion: 1;
  readonly components: readonly SchematicComponent[];
  readonly connections: readonly SchematicConnection[];
}

export const EMPTY_DOCUMENT: ElectronicsDocument = {
  schemaVersion: 1,
  components: [],
  connections: [],
};

const KINDS: readonly ComponentKind[] = ['source', 'resistor', 'led', 'wire'];
const TERMINALS: readonly Terminal[] = ['a', 'b'];
const MAX_COMPONENTS = 100;
const MAX_CONNECTIONS = 200;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type DocumentParseResult =
  | { readonly ok: true; readonly document: ElectronicsDocument }
  | { readonly ok: false; readonly message: string };

/** Strict parser: the document always arrives from a client, so nothing is
 * trusted and no field is silently coerced. */
export function parseElectronicsDocument(value: unknown): DocumentParseResult {
  if (!isPlainObject(value)) {
    return { ok: false, message: 'document must be an object' };
  }
  if (value['schemaVersion'] !== 1) {
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
  for (const raw of rawComponents) {
    if (!isPlainObject(raw)) {
      return { ok: false, message: 'component must be an object' };
    }
    const { id, kind, position, value: componentValue } = raw;
    if (!isId(id) || seenComponents.has(id)) {
      return { ok: false, message: 'component id must be unique and non-empty' };
    }
    if (typeof kind !== 'string' || !KINDS.includes(kind as ComponentKind)) {
      return { ok: false, message: `unsupported component kind: ${String(kind)}` };
    }
    if (
      !isPlainObject(position) ||
      !isFiniteNumber(position['x']) ||
      !isFiniteNumber(position['y'])
    ) {
      return { ok: false, message: 'component position must be finite x/y numbers' };
    }
    if (!isFiniteNumber(componentValue) || componentValue < 0) {
      return { ok: false, message: 'component value must be a non-negative number' };
    }
    seenComponents.add(id);
    components.push({
      id,
      kind: kind as ComponentKind,
      position: { x: position['x'], y: position['y'] },
      value: componentValue,
    });
  }

  const connections: SchematicConnection[] = [];
  const seenConnections = new Set<string>();
  for (const raw of rawConnections) {
    if (!isPlainObject(raw)) {
      return { ok: false, message: 'connection must be an object' };
    }
    const { id, from, to } = raw;
    if (!isId(id) || seenConnections.has(id)) {
      return { ok: false, message: 'connection id must be unique and non-empty' };
    }
    for (const endpoint of [from, to]) {
      if (
        !isPlainObject(endpoint) ||
        !isId(endpoint['componentId']) ||
        !seenComponents.has(endpoint['componentId'] as string) ||
        typeof endpoint['terminal'] !== 'string' ||
        !TERMINALS.includes(endpoint['terminal'] as Terminal)
      ) {
        return { ok: false, message: 'connection endpoints must reference existing terminals' };
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
    });
  }

  return { ok: true, document: { schemaVersion: 1, components, connections } };
}
