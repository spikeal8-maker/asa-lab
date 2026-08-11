export const THREE_D_SCHEMA_VERSION = 1 as const;
export const THREE_D_UNITS = 'mm' as const;

export type PrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'wedge' | 'roof';
export type ShapeOperation = 'solid' | 'hole';

export interface Vector3Value {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ThreeDTransform {
  readonly position: Vector3Value;
  /** Euler rotation in degrees. */
  readonly rotation: Vector3Value;
  readonly scale: Vector3Value;
}

export interface ThreeDDimensions {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export interface ThreeDNode {
  readonly id: string;
  readonly kind: 'primitive';
  readonly primitive: PrimitiveKind;
  readonly name: string;
  readonly operation: ShapeOperation;
  readonly color: string;
  readonly transform: ThreeDTransform;
  readonly dimensions: ThreeDDimensions;
  readonly sides: number;
  readonly bevel: number;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface ThreeDGridSettings {
  readonly width: number;
  readonly depth: number;
  readonly snap: number;
  readonly visible: boolean;
}

export interface ThreeDCameraState {
  readonly position: Vector3Value;
  readonly target: Vector3Value;
  readonly projection: 'perspective' | 'orthographic';
}

export interface ThreeDDocument {
  readonly schemaVersion: typeof THREE_D_SCHEMA_VERSION;
  readonly units: typeof THREE_D_UNITS;
  readonly nodes: readonly ThreeDNode[];
  readonly grid: ThreeDGridSettings;
  readonly camera: ThreeDCameraState;
}

export interface DocumentParseSuccess {
  readonly ok: true;
  readonly value: ThreeDDocument;
}

export interface DocumentParseFailure {
  readonly ok: false;
  readonly message: string;
}

export type DocumentParseResult = DocumentParseSuccess | DocumentParseFailure;

const DEFAULT_CAMERA: ThreeDCameraState = {
  position: { x: 145, y: 115, z: 145 },
  target: { x: 0, y: 0, z: 0 },
  projection: 'perspective',
};

export function createEmptyThreeDDocument(): ThreeDDocument {
  return {
    schemaVersion: THREE_D_SCHEMA_VERSION,
    units: THREE_D_UNITS,
    nodes: [],
    grid: { width: 200, depth: 200, snap: 1, visible: true },
    camera: DEFAULT_CAMERA,
  };
}

function defaultDimensions(primitive: PrimitiveKind): ThreeDDimensions {
  switch (primitive) {
    case 'sphere':
      return { width: 20, depth: 20, height: 20 };
    case 'torus':
      return { width: 24, depth: 24, height: 7 };
    case 'roof':
      return { width: 20, depth: 20, height: 15 };
    default:
      return { width: 20, depth: 20, height: 20 };
  }
}

const SHAPE_NAMES: Readonly<Record<PrimitiveKind, string>> = {
  box: 'Параллелепипед',
  cylinder: 'Цилиндр',
  sphere: 'Сфера',
  cone: 'Конус',
  torus: 'Тор',
  wedge: 'Клин',
  roof: 'Крыша',
};

const SHAPE_COLORS: Readonly<Record<PrimitiveKind, string>> = {
  box: '#ef3340',
  cylinder: '#f68b1f',
  sphere: '#27a9e1',
  cone: '#8a4bb8',
  torus: '#00a5c8',
  wedge: '#2f7de1',
  roof: '#5fbf5f',
};

export function createThreeDNode(primitive: PrimitiveKind, id: string): ThreeDNode {
  const dimensions = defaultDimensions(primitive);
  return {
    id,
    kind: 'primitive',
    primitive,
    name: SHAPE_NAMES[primitive],
    operation: 'solid',
    color: SHAPE_COLORS[primitive],
    transform: {
      position: { x: 0, y: dimensions.height / 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    dimensions,
    sides: primitive === 'cylinder' || primitive === 'cone' ? 32 : 24,
    bevel: 0,
    visible: true,
    locked: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVector(value: unknown): value is Vector3Value {
  return (
    isRecord(value) &&
    isFiniteNumber(value['x']) &&
    isFiniteNumber(value['y']) &&
    isFiniteNumber(value['z'])
  );
}

function isPositiveDimension(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value <= 10_000;
}

function isPrimitive(value: unknown): value is PrimitiveKind {
  return (
    value === 'box' ||
    value === 'cylinder' ||
    value === 'sphere' ||
    value === 'cone' ||
    value === 'torus' ||
    value === 'wedge' ||
    value === 'roof'
  );
}

function isNode(value: unknown): value is ThreeDNode {
  if (!isRecord(value) || value['kind'] !== 'primitive' || !isPrimitive(value['primitive'])) {
    return false;
  }
  const transform = value['transform'];
  const dimensions = value['dimensions'];
  return (
    typeof value['id'] === 'string' &&
    value['id'].length > 0 &&
    typeof value['name'] === 'string' &&
    (value['operation'] === 'solid' || value['operation'] === 'hole') &&
    typeof value['color'] === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value['color']) &&
    isRecord(transform) &&
    isVector(transform['position']) &&
    isVector(transform['rotation']) &&
    isVector(transform['scale']) &&
    isRecord(dimensions) &&
    isPositiveDimension(dimensions['width']) &&
    isPositiveDimension(dimensions['depth']) &&
    isPositiveDimension(dimensions['height']) &&
    Number.isInteger(value['sides']) &&
    (value['sides'] as number) >= 3 &&
    (value['sides'] as number) <= 128 &&
    isFiniteNumber(value['bevel']) &&
    (value['bevel'] as number) >= 0 &&
    typeof value['visible'] === 'boolean' &&
    typeof value['locked'] === 'boolean'
  );
}

export function parseThreeDDocument(value: unknown): DocumentParseResult {
  if (!isRecord(value)) return { ok: false, message: '3D-документ должен быть объектом.' };
  if (value['schemaVersion'] !== THREE_D_SCHEMA_VERSION) {
    return { ok: false, message: 'Неподдерживаемая версия 3D-документа.' };
  }
  if (value['units'] !== THREE_D_UNITS) {
    return { ok: false, message: 'Единицы документа должны быть миллиметрами.' };
  }
  const nodes = value['nodes'];
  if (!Array.isArray(nodes) || !nodes.every(isNode)) {
    return { ok: false, message: 'Список 3D-объектов повреждён.' };
  }
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) {
    return { ok: false, message: 'Идентификаторы 3D-объектов должны быть уникальными.' };
  }
  const grid = value['grid'];
  if (
    !isRecord(grid) ||
    !isPositiveDimension(grid['width']) ||
    !isPositiveDimension(grid['depth']) ||
    !isPositiveDimension(grid['snap']) ||
    typeof grid['visible'] !== 'boolean'
  ) {
    return { ok: false, message: 'Настройки рабочей плоскости повреждены.' };
  }
  const camera = value['camera'];
  if (
    !isRecord(camera) ||
    !isVector(camera['position']) ||
    !isVector(camera['target']) ||
    (camera['projection'] !== 'perspective' && camera['projection'] !== 'orthographic')
  ) {
    return { ok: false, message: 'Настройки камеры повреждены.' };
  }
  return { ok: true, value: value as unknown as ThreeDDocument };
}

export function cloneThreeDDocument(document: ThreeDDocument): ThreeDDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      dimensions: { ...node.dimensions },
      transform: {
        position: { ...node.transform.position },
        rotation: { ...node.transform.rotation },
        scale: { ...node.transform.scale },
      },
    })),
    grid: { ...document.grid },
    camera: {
      ...document.camera,
      position: { ...document.camera.position },
      target: { ...document.camera.target },
    },
  };
}
