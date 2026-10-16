/** Schema-versioned Electronics document stored inside a mutable ProjectDraft. */
import { resolveElectricalModelIdentity } from './model-identity.js';

export type ComponentKind =
  | 'source'
  | 'resistor'
  | 'led'
  | 'rgb-led'
  | 'seven-segment'
  | 'button'
  | 'switch'
  | 'potentiometer'
  | 'photoresistor'
  | 'piezo'
  | 'diode'
  | 'transistor'
  | 'lamp'
  | 'breadboard'
  | 'visual'
  | 'wire';
export type Terminal = string;
export type Rotation = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;
export type ProductionStateValue = string | number | boolean | readonly string[];

export interface ComponentPosition {
  readonly x: number;
  readonly y: number;
}

export interface SchematicComponent {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly componentTypeId?: string;
  readonly variantId?: string;
  readonly electricalModelId?: string;
  readonly electricalModelVersion?: number;
  readonly modelProfileId?: string;
  readonly modelProfileVersion?: number;
  readonly position: ComponentPosition;
  /** Primary electrical value: V, Ohm or forward drop depending on kind. */
  readonly value: number;
  readonly rotation?: Rotation;
  readonly name?: string;
  /** Button: pressed when true. SPDT: right throw when true, left throw otherwise. */
  readonly state?: boolean;
  /** Potentiometer wiper position from terminal a (0) to terminal b (1). */
  readonly wiperPosition?: number;
  readonly stateProperties?: Readonly<Record<string, ProductionStateValue>>;
  readonly pinIds?: readonly string[];
  readonly holeBindings?: Readonly<
    Record<string, { readonly breadboardComponentId: string; readonly holeId: string }>
  >;
  readonly internalConnections?: readonly (readonly [string, string])[];
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
  readonly schemaVersion: 4;
  readonly components: readonly SchematicComponent[];
  readonly connections: readonly SchematicConnection[];
  readonly viewport: ElectronicsViewport;
  readonly simulation: SimulationSettings;
}

export const DEFAULT_VIEWPORT: ElectronicsViewport = { x: 0, y: 0, zoom: 1 };
export const DEFAULT_SIMULATION: SimulationSettings = { running: false, maxIterations: 24 };
export const EMPTY_DOCUMENT: ElectronicsDocument = {
  schemaVersion: 4,
  components: [],
  connections: [],
  viewport: DEFAULT_VIEWPORT,
  simulation: DEFAULT_SIMULATION,
};

const KINDS: readonly ComponentKind[] = [
  'source',
  'resistor',
  'led',
  'rgb-led',
  'seven-segment',
  'button',
  'switch',
  'potentiometer',
  'photoresistor',
  'piezo',
  'diode',
  'transistor',
  'lamp',
  'breadboard',
  'visual',
  'wire',
];
const ROTATIONS = new Set<Rotation>([0, 45, 90, 135, 180, 225, 270, 315]);
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

function isStateValue(value: unknown): value is ProductionStateValue {
  return (
    (typeof value === 'string' && value.length <= 500_000) ||
    typeof value === 'boolean' ||
    isFiniteNumber(value) ||
    (Array.isArray(value) &&
      value.length <= 32 &&
      value.every((item) => typeof item === 'string' && item.length <= 512))
  );
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

export function terminalsForComponent(component: SchematicComponent): readonly Terminal[] {
  return component.pinIds && component.pinIds.length > 0
    ? component.pinIds
    : terminalsForKind(component.kind);
}

export const ELECTRONICS_DOCUMENT_VALIDATION_REASONS = [
  'electronics_component_id',
  'electronics_component_kind',
  'electronics_component_name',
  'electronics_component_pins',
  'electronics_component_position',
  'electronics_component_rotation',
  'electronics_component_shape',
  'electronics_component_state',
  'electronics_component_type',
  'electronics_component_value',
  'electronics_component_variant',
  'electronics_component_wiper',
  'electronics_connection_endpoint',
  'electronics_connection_id',
  'electronics_connection_shape',
  'electronics_document_arrays',
  'electronics_document_shape',
  'electronics_document_size',
  'electronics_hole_binding_reference',
  'electronics_hole_binding_shape',
  'electronics_hole_bindings_shape',
  'electronics_internal_connection_pair',
  'electronics_internal_connection_reference',
  'electronics_internal_connections',
  'electronics_model_identity',
  'electronics_schema_version',
  'electronics_simulation',
  'electronics_state_properties',
  'electronics_state_value',
  'electronics_viewport',
  'electronics_wire_color',
  'electronics_wire_position',
  'electronics_wire_vertices',
] as const;

export type DocumentParseResult =
  | { readonly ok: true; readonly document: ElectronicsDocument; readonly migrated: boolean }
  | {
      readonly ok: false;
      readonly message: string;
      readonly reasonCode: (typeof ELECTRONICS_DOCUMENT_VALIDATION_REASONS)[number];
    };

/** Accepts historical schema v1-v3 and normalises additively to production schema v4. */
export function parseElectronicsDocument(value: unknown): DocumentParseResult {
  if (!isPlainObject(value))
    return {
      ok: false,
      reasonCode: 'electronics_document_shape',
      message: 'document must be an object',
    };
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) {
    return {
      ok: false,
      reasonCode: 'electronics_schema_version',
      message: 'unsupported document schemaVersion',
    };
  }
  const rawComponents = value['components'];
  const rawConnections = value['connections'];
  if (!Array.isArray(rawComponents) || !Array.isArray(rawConnections)) {
    return {
      ok: false,
      reasonCode: 'electronics_document_arrays',
      message: 'document must contain components and connections arrays',
    };
  }
  if (rawComponents.length > MAX_COMPONENTS || rawConnections.length > MAX_CONNECTIONS) {
    return {
      ok: false,
      reasonCode: 'electronics_document_size',
      message: 'document exceeds the supported size',
    };
  }

  const components: SchematicComponent[] = [];
  const seenComponents = new Set<string>();
  const componentById = new Map<string, SchematicComponent>();
  for (const raw of rawComponents) {
    if (!isPlainObject(raw))
      return {
        ok: false,
        reasonCode: 'electronics_component_shape',
        message: 'component must be an object',
      };
    const {
      id,
      kind,
      componentTypeId,
      variantId,
      electricalModelId,
      electricalModelVersion,
      modelProfileId,
      modelProfileVersion,
      position,
      value: componentValue,
      rotation,
      name,
      state,
      wiperPosition,
      stateProperties,
      pinIds,
      holeBindings,
      internalConnections,
    } = raw;
    if (!isId(id) || seenComponents.has(id)) {
      return {
        ok: false,
        reasonCode: 'electronics_component_id',
        message: 'component id must be unique and non-empty',
      };
    }
    if (typeof kind !== 'string' || !KINDS.includes(kind as ComponentKind)) {
      return {
        ok: false,
        reasonCode: 'electronics_component_kind',
        message: `unsupported component kind: ${String(kind)}`,
      };
    }
    const parsedPosition = parsePosition(position, 'component position');
    if (typeof parsedPosition === 'string')
      return { ok: false, reasonCode: 'electronics_component_position', message: parsedPosition };
    if (!isFiniteNumber(componentValue) || componentValue < 0 || componentValue > 1_000_000_000) {
      return {
        ok: false,
        reasonCode: 'electronics_component_value',
        message: 'component value must be a bounded non-negative number',
      };
    }
    if (
      rotation !== undefined &&
      (!Number.isInteger(rotation) || !ROTATIONS.has(rotation as Rotation))
    ) {
      return {
        ok: false,
        reasonCode: 'electronics_component_rotation',
        message: 'component rotation must use 45-degree steps',
      };
    }
    if (name !== undefined && (typeof name !== 'string' || name.length > 120)) {
      return {
        ok: false,
        reasonCode: 'electronics_component_name',
        message: 'component name must be at most 120 characters',
      };
    }
    if (state !== undefined && typeof state !== 'boolean') {
      return {
        ok: false,
        reasonCode: 'electronics_component_state',
        message: 'component state must be boolean',
      };
    }
    if (
      wiperPosition !== undefined &&
      (!isFiniteNumber(wiperPosition) || wiperPosition < 0 || wiperPosition > 1)
    ) {
      return {
        ok: false,
        reasonCode: 'electronics_component_wiper',
        message: 'potentiometer wiperPosition must be between 0 and 1',
      };
    }
    if (componentTypeId !== undefined && !isId(componentTypeId)) {
      return {
        ok: false,
        reasonCode: 'electronics_component_type',
        message: 'componentTypeId must be a bounded non-empty string',
      };
    }
    if (variantId !== undefined && !isId(variantId)) {
      return {
        ok: false,
        reasonCode: 'electronics_component_variant',
        message: 'variantId must be a bounded non-empty string',
      };
    }
    const explicitIdentity = [
      electricalModelId,
      electricalModelVersion,
      modelProfileId,
      modelProfileVersion,
    ];
    if (explicitIdentity.some((part) => part !== undefined)) {
      if (
        !isId(electricalModelId) ||
        !Number.isInteger(electricalModelVersion) ||
        (electricalModelVersion as number) < 1 ||
        (electricalModelVersion as number) > 1_000_000 ||
        !isId(modelProfileId) ||
        !Number.isInteger(modelProfileVersion) ||
        (modelProfileVersion as number) < 1 ||
        (modelProfileVersion as number) > 1_000_000
      ) {
        return {
          ok: false,
          reasonCode: 'electronics_model_identity',
          message: 'component electrical model identity is incomplete or invalid',
        };
      }
    }
    let parsedStateProperties: Record<string, ProductionStateValue> | undefined;
    if (stateProperties !== undefined) {
      if (!isPlainObject(stateProperties) || Object.keys(stateProperties).length > 48) {
        return {
          ok: false,
          reasonCode: 'electronics_state_properties',
          message: 'stateProperties must be a bounded object',
        };
      }
      parsedStateProperties = {};
      for (const [key, stateValue] of Object.entries(stateProperties)) {
        if (!isId(key) || !isStateValue(stateValue)) {
          return {
            ok: false,
            reasonCode: 'electronics_state_value',
            message: 'stateProperties contains an invalid value',
          };
        }
        parsedStateProperties[key] = stateValue;
      }
    }
    let parsedPinIds: string[] | undefined;
    if (pinIds !== undefined) {
      if (
        !Array.isArray(pinIds) ||
        pinIds.length > 1000 ||
        !pinIds.every(isId) ||
        new Set(pinIds).size !== pinIds.length
      ) {
        return {
          ok: false,
          reasonCode: 'electronics_component_pins',
          message: 'pinIds must contain unique bounded pin identifiers',
        };
      }
      parsedPinIds = [...pinIds];
    }
    let parsedHoleBindings:
      Record<string, { breadboardComponentId: string; holeId: string }> | undefined;
    if (holeBindings !== undefined) {
      if (!isPlainObject(holeBindings) || Object.keys(holeBindings).length > 64) {
        return {
          ok: false,
          reasonCode: 'electronics_hole_bindings_shape',
          message: 'holeBindings must be a bounded object',
        };
      }
      parsedHoleBindings = {};
      for (const [pinId, binding] of Object.entries(holeBindings)) {
        if (
          !isId(pinId) ||
          !isPlainObject(binding) ||
          !isId(binding['breadboardComponentId']) ||
          !isId(binding['holeId'])
        ) {
          return {
            ok: false,
            reasonCode: 'electronics_hole_binding_shape',
            message: 'holeBindings contains an invalid binding',
          };
        }
        parsedHoleBindings[pinId] = {
          breadboardComponentId: binding['breadboardComponentId'],
          holeId: binding['holeId'],
        };
      }
    }
    let parsedInternalConnections: [string, string][] | undefined;
    if (internalConnections !== undefined) {
      if (!Array.isArray(internalConnections) || internalConnections.length > 1000) {
        return {
          ok: false,
          reasonCode: 'electronics_internal_connections',
          message: 'internalConnections must be a bounded array',
        };
      }
      parsedInternalConnections = [];
      for (const pair of internalConnections) {
        if (!Array.isArray(pair) || pair.length !== 2 || !isId(pair[0]) || !isId(pair[1])) {
          return {
            ok: false,
            reasonCode: 'electronics_internal_connection_pair',
            message: 'internalConnections contains an invalid pin pair',
          };
        }
        parsedInternalConnections.push([pair[0], pair[1]]);
      }
    }
    const parsedKind = kind as ComponentKind;
    const modelIdentity = explicitIdentity.every((part) => part !== undefined)
      ? {
          electricalModelId: electricalModelId as string,
          electricalModelVersion: electricalModelVersion as number,
          modelProfileId: modelProfileId as string,
          modelProfileVersion: modelProfileVersion as number,
        }
      : resolveElectricalModelIdentity({
          ...(componentTypeId === undefined ? {} : { componentTypeId }),
          kind: parsedKind,
          ...(parsedStateProperties === undefined
            ? {}
            : { stateProperties: parsedStateProperties }),
        });
    seenComponents.add(id);
    const component: SchematicComponent = {
      id,
      kind: parsedKind,
      ...(componentTypeId === undefined ? {} : { componentTypeId }),
      ...(variantId === undefined ? {} : { variantId }),
      ...modelIdentity,
      position: parsedPosition,
      value: componentValue,
      ...(rotation === undefined ? {} : { rotation: rotation as Rotation }),
      ...(name === undefined ? {} : { name }),
      ...(state === undefined ? {} : { state }),
      ...(wiperPosition === undefined ? {} : { wiperPosition }),
      ...(parsedStateProperties === undefined ? {} : { stateProperties: parsedStateProperties }),
      ...(parsedPinIds === undefined ? {} : { pinIds: parsedPinIds }),
      ...(parsedHoleBindings === undefined ? {} : { holeBindings: parsedHoleBindings }),
      ...(parsedInternalConnections === undefined
        ? {}
        : { internalConnections: parsedInternalConnections }),
    };
    components.push(component);
    componentById.set(id, component);
  }

  for (const component of components) {
    const pins = new Set(terminalsForComponent(component));
    for (const [left, right] of component.internalConnections ?? []) {
      if (!pins.has(left) || !pins.has(right)) {
        return {
          ok: false,
          reasonCode: 'electronics_internal_connection_reference',
          message: 'internalConnections must reference component pins',
        };
      }
    }
    for (const [pinId, binding] of Object.entries(component.holeBindings ?? {})) {
      const board = componentById.get(binding.breadboardComponentId);
      if (
        !pins.has(pinId) ||
        board?.kind !== 'breadboard' ||
        !terminalsForComponent(board).includes(binding.holeId)
      ) {
        return {
          ok: false,
          reasonCode: 'electronics_hole_binding_reference',
          message: 'holeBindings must reference a real board hole',
        };
      }
    }
  }

  const connections: SchematicConnection[] = [];
  const seenConnections = new Set<string>();
  for (const raw of rawConnections) {
    if (!isPlainObject(raw))
      return {
        ok: false,
        reasonCode: 'electronics_connection_shape',
        message: 'connection must be an object',
      };
    const { id, from, to, color, vertices } = raw;
    if (!isId(id) || seenConnections.has(id)) {
      return {
        ok: false,
        reasonCode: 'electronics_connection_id',
        message: 'connection id must be unique and non-empty',
      };
    }
    const endpoints: TerminalRef[] = [];
    for (const endpoint of [from, to]) {
      if (!isPlainObject(endpoint) || !isId(endpoint['componentId'])) {
        return {
          ok: false,
          reasonCode: 'electronics_connection_endpoint',
          message: 'connection endpoints must reference existing terminals',
        };
      }
      const componentId = endpoint['componentId'];
      const component = componentById.get(componentId);
      const terminal = endpoint['terminal'];
      if (
        !component ||
        typeof terminal !== 'string' ||
        !terminalsForComponent(component).includes(terminal as Terminal)
      ) {
        return {
          ok: false,
          reasonCode: 'electronics_connection_endpoint',
          message: 'connection endpoints must reference existing terminals',
        };
      }
      endpoints.push({ componentId, terminal: terminal as Terminal });
    }
    if (color !== undefined && (typeof color !== 'string' || !COLOR_PATTERN.test(color))) {
      return {
        ok: false,
        reasonCode: 'electronics_wire_color',
        message: 'wire color must be a six-digit hex color',
      };
    }
    let parsedVertices: ComponentPosition[] | undefined;
    if (vertices !== undefined) {
      if (!Array.isArray(vertices) || vertices.length > MAX_WIRE_VERTICES) {
        return {
          ok: false,
          reasonCode: 'electronics_wire_vertices',
          message: 'wire vertices must be a bounded array',
        };
      }
      parsedVertices = [];
      for (const vertex of vertices) {
        const parsed = parsePosition(vertex, 'wire vertex');
        if (typeof parsed === 'string')
          return { ok: false, reasonCode: 'electronics_wire_position', message: parsed };
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
  if (schemaVersion !== 1 && value['viewport'] !== undefined) {
    const rawViewport = value['viewport'];
    if (
      !isPlainObject(rawViewport) ||
      !isFiniteNumber(rawViewport['x']) ||
      !isFiniteNumber(rawViewport['y']) ||
      !isFiniteNumber(rawViewport['zoom']) ||
      rawViewport['zoom'] < 0.1 ||
      rawViewport['zoom'] > 8
    ) {
      return {
        ok: false,
        reasonCode: 'electronics_viewport',
        message: 'viewport must contain bounded x/y/zoom numbers',
      };
    }
    viewport = { x: rawViewport['x'], y: rawViewport['y'], zoom: rawViewport['zoom'] };
  }

  let simulation = DEFAULT_SIMULATION;
  if (schemaVersion !== 1 && value['simulation'] !== undefined) {
    const rawSimulation = value['simulation'];
    if (
      !isPlainObject(rawSimulation) ||
      typeof rawSimulation['running'] !== 'boolean' ||
      !Number.isInteger(rawSimulation['maxIterations']) ||
      (rawSimulation['maxIterations'] as number) < 4 ||
      (rawSimulation['maxIterations'] as number) > 100
    ) {
      return {
        ok: false,
        reasonCode: 'electronics_simulation',
        message: 'simulation settings are invalid',
      };
    }
    simulation = {
      running: rawSimulation['running'],
      maxIterations: rawSimulation['maxIterations'] as number,
    };
  }

  return {
    ok: true,
    migrated: schemaVersion !== 4,
    document: { schemaVersion: 4, components, connections, viewport, simulation },
  };
}
