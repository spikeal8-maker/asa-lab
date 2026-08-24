export const THREE_D_SCHEMA_VERSION = 1 as const;
export const THREE_D_UNITS = 'mm' as const;

export const PRIMITIVE_KINDS = [
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

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];
export type ShapeOperation = 'solid' | 'hole';
export type BooleanOperation = 'union' | 'difference' | 'intersection';

export interface Vector3Value {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vector2Value {
  readonly x: number;
  readonly y: number;
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

export interface ThreeDShapeParameters {
  readonly topRadius: number;
  readonly baseRadius: number;
  readonly innerRadius: number;
  readonly text: string;
  readonly font: 'sans' | 'serif' | 'mono';
  readonly bevelSegments: number;
  readonly radius: number;
  readonly tubeRadius: number;
  readonly wallThickness: number;
  readonly steps: number;
  readonly points: number;
  readonly innerRatio: number;
  readonly fontSize: number;
  readonly segments: number;
  readonly topScale: number;
  readonly baseScale: number;
  readonly twist: number;
  readonly twistSteps: number;
  readonly smoothTwist: boolean;
  readonly sketchPoints: readonly Vector2Value[];
  readonly sketchAccepted: boolean;
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
  readonly parameters: ThreeDShapeParameters;
  readonly visible: boolean;
  readonly locked: boolean;
  /** A lightweight, non-boolean bundle. Members keep their own geometry and colour. */
  readonly bundleId: string | null;
  /** A reversible modelling group. Null keeps the primitive independent. */
  readonly groupId: string | null;
  /** Repeated on group members so the browser can rebuild the boolean result. */
  readonly groupOperation: BooleanOperation | null;
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

export interface ThreeDRulerSettings {
  readonly visible: boolean;
  readonly origin: Vector3Value;
  readonly precision: 0 | 1 | 2;
}

export interface ThreeDDocument {
  readonly schemaVersion: typeof THREE_D_SCHEMA_VERSION;
  readonly units: typeof THREE_D_UNITS;
  readonly nodes: readonly ThreeDNode[];
  readonly grid: ThreeDGridSettings;
  readonly camera: ThreeDCameraState;
  readonly ruler: ThreeDRulerSettings;
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
  position: { x: 0, y: 181, z: 181 },
  target: { x: 0, y: 0, z: 0 },
  projection: 'perspective',
};

const DEFAULT_RULER: ThreeDRulerSettings = {
  visible: false,
  origin: { x: 0, y: 0, z: 0 },
  precision: 2,
};

export function createEmptyThreeDDocument(): ThreeDDocument {
  return {
    schemaVersion: THREE_D_SCHEMA_VERSION,
    units: THREE_D_UNITS,
    nodes: [],
    grid: { width: 200, depth: 200, snap: 1, visible: true },
    camera: DEFAULT_CAMERA,
    ruler: DEFAULT_RULER,
  };
}

function defaultDimensions(primitive: PrimitiveKind): ThreeDDimensions {
  switch (primitive) {
    case 'sphere':
      return { width: 20, depth: 20, height: 20 };
    case 'torus':
      return { width: 20, depth: 20, height: 5 };
    case 'roof':
      return { width: 20, depth: 20, height: 15 };
    case 'tube':
      return { width: 20, depth: 20, height: 20 };
    case 'star':
      return { width: 40, depth: 40, height: 5 };
    case 'heart':
      return { width: 24, depth: 20, height: 5 };
    case 'half-sphere':
      return { width: 20, depth: 20, height: 10 };
    case 'rounded-box':
      return { width: 24, depth: 18, height: 12 };
    case 'capsule':
      return { width: 14, depth: 14, height: 28 };
    case 'text':
      return { width: 32, depth: 12, height: 4 };
    case 'round-roof':
      return { width: 20, depth: 20, height: 10 };
    case 'ring':
      return { width: 24, depth: 24, height: 5 };
    case 'extrude-sketch':
    case 'scribble':
    case 'star-6':
      return { width: 24, depth: 20, height: 5 };
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
  pyramid: 'Пирамида',
  'half-sphere': 'Полусфера',
  tube: 'Труба',
  'rounded-box': 'Скруглённый блок',
  polygon: 'Многоугольник',
  star: 'Звезда',
  heart: 'Сердце',
  diamond: 'Ромб',
  capsule: 'Капсула',
  paraboloid: 'Параболоид',
  'extrude-sketch': 'Extrude sketch',
  'revolve-sketch': 'Revolve sketch',
  scribble: 'Scribble',
  text: 'Текст',
  'round-roof': 'Круглая кровля',
  ring: 'Кольцо',
  icosahedron: 'Икосаэдр',
  'star-6': 'Звезда 6-конечная',
};

export const THREE_D_SHAPE_COLORS: Readonly<Record<PrimitiveKind, string>> = {
  box: '#e31c2b',
  cylinder: '#f5831f',
  sphere: '#0099c6',
  cone: '#6e2786',
  torus: '#00a5c8',
  wedge: '#2f7d3a',
  roof: '#58a84f',
  pyramid: '#f2c313',
  'half-sphere': '#d94693',
  tube: '#e68117',
  'rounded-box': '#1e70c9',
  polygon: '#304c97',
  star: '#f2c313',
  heart: '#b7653f',
  diamond: '#d82633',
  capsule: '#00a5c8',
  paraboloid: '#7fb34d',
  'extrude-sketch': '#8492bd',
  'revolve-sketch': '#9bd765',
  scribble: '#91a9bd',
  text: '#e31c2b',
  'round-roof': '#68b9c0',
  ring: '#8c6b45',
  icosahedron: '#d82633',
  'star-6': '#e0bd16',
};

function defaultShapeParameters(primitive: PrimitiveKind): ThreeDShapeParameters {
  const sketchPoints =
    primitive === 'revolve-sketch'
      ? [
          { x: 0.2, y: -1 },
          { x: 0.7, y: -0.85 },
          { x: 0.9, y: -0.25 },
          { x: 0.65, y: 0.3 },
          { x: 0.45, y: 1 },
        ]
      : [
          { x: -0.9, y: -0.65 },
          { x: -0.25, y: -0.9 },
          { x: 0.8, y: -0.45 },
          { x: 0.65, y: 0.55 },
          { x: 0, y: 0.9 },
          { x: -0.75, y: 0.45 },
        ];
  return {
    topRadius: primitive === 'cone' ? 0 : 10,
    baseRadius: 10,
    innerRadius: primitive === 'ring' ? 8 : 6,
    text: 'TEXT',
    font: 'sans',
    bevelSegments: 1,
    radius: primitive === 'torus' ? 7.5 : primitive === 'star' ? 20 : 10,
    tubeRadius: 2.5,
    wallThickness: 2.5,
    steps: primitive === 'torus' ? 48 : primitive === 'sphere' ? 24 : 24,
    points: 5,
    innerRatio: 0.5,
    fontSize: 10,
    segments: 0,
    topScale: 1,
    baseScale: 1,
    twist: 0,
    twistSteps: 1,
    smoothTwist: false,
    sketchPoints,
    sketchAccepted: !['extrude-sketch', 'revolve-sketch', 'scribble'].includes(primitive),
  };
}

export function createThreeDNode(primitive: PrimitiveKind, id: string): ThreeDNode {
  const dimensions = defaultDimensions(primitive);
  return {
    id,
    kind: 'primitive',
    primitive,
    name: SHAPE_NAMES[primitive],
    operation: 'solid',
    color: THREE_D_SHAPE_COLORS[primitive],
    transform: {
      position: { x: 0, y: dimensions.height / 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    dimensions,
    sides:
      primitive === 'polygon'
        ? 6
        : primitive === 'pyramid'
          ? 4
          : primitive === 'cylinder' ||
              primitive === 'cone' ||
              primitive === 'tube' ||
              primitive === 'ring'
            ? 48
            : 24,
    bevel: 0,
    parameters: defaultShapeParameters(primitive),
    visible: true,
    locked: false,
    bundleId: null,
    groupId: null,
    groupOperation: null,
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
  return typeof value === 'string' && (PRIMITIVE_KINDS as readonly string[]).includes(value);
}

function isBooleanOperation(value: unknown): value is BooleanOperation {
  return value === 'union' || value === 'difference' || value === 'intersection';
}

function isShapeParameters(value: unknown): value is ThreeDShapeParameters {
  if (!isRecord(value)) return false;
  const optionalNumber = (name: string, minimum: number, maximum: number): boolean =>
    value[name] === undefined ||
    (isFiniteNumber(value[name]) && value[name] >= minimum && value[name] <= maximum);
  const optionalInteger = (name: string, minimum: number, maximum: number): boolean => {
    const candidate = value[name];
    return (
      candidate === undefined ||
      (isFiniteNumber(candidate) &&
        Number.isInteger(candidate) &&
        candidate >= minimum &&
        candidate <= maximum)
    );
  };
  const sketchPoints = value['sketchPoints'];
  return (
    isFiniteNumber(value['topRadius']) &&
    value['topRadius'] >= 0 &&
    value['topRadius'] <= 5_000 &&
    isFiniteNumber(value['baseRadius']) &&
    value['baseRadius'] >= 0.1 &&
    value['baseRadius'] <= 5_000 &&
    isFiniteNumber(value['innerRadius']) &&
    value['innerRadius'] >= 0 &&
    value['innerRadius'] <= 5_000 &&
    typeof value['text'] === 'string' &&
    value['text'].length <= 128 &&
    (value['font'] === 'sans' || value['font'] === 'serif' || value['font'] === 'mono') &&
    (value['bevelSegments'] === undefined ||
      (Number.isInteger(value['bevelSegments']) &&
        (value['bevelSegments'] as number) >= 1 &&
        (value['bevelSegments'] as number) <= 10)) &&
    optionalNumber('radius', 0.1, 5_000) &&
    optionalNumber('tubeRadius', 0.1, 5_000) &&
    optionalNumber('wallThickness', 0.1, 5_000) &&
    optionalInteger('steps', 3, 128) &&
    optionalInteger('points', 3, 30) &&
    optionalNumber('innerRatio', 0.01, 1) &&
    optionalNumber('fontSize', 0.1, 100) &&
    optionalInteger('segments', 0, 10) &&
    optionalNumber('topScale', 0.01, 5) &&
    optionalNumber('baseScale', 0.01, 5) &&
    optionalNumber('twist', -360, 360) &&
    optionalInteger('twistSteps', 1, 64) &&
    (value['smoothTwist'] === undefined || typeof value['smoothTwist'] === 'boolean') &&
    (value['sketchAccepted'] === undefined || typeof value['sketchAccepted'] === 'boolean') &&
    (sketchPoints === undefined ||
      (Array.isArray(sketchPoints) &&
        sketchPoints.length >= 3 &&
        sketchPoints.length <= 256 &&
        sketchPoints.every(
          (point) =>
            isRecord(point) &&
            isFiniteNumber(point['x']) &&
            point['x'] >= -2 &&
            point['x'] <= 2 &&
            isFiniteNumber(point['y']) &&
            point['y'] >= -2 &&
            point['y'] <= 2,
        )))
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
    (value['parameters'] === undefined || isShapeParameters(value['parameters'])) &&
    typeof value['visible'] === 'boolean' &&
    typeof value['locked'] === 'boolean' &&
    (value['bundleId'] === undefined ||
      value['bundleId'] === null ||
      (typeof value['bundleId'] === 'string' && value['bundleId'].length > 0)) &&
    (value['groupId'] === undefined ||
      value['groupId'] === null ||
      (typeof value['groupId'] === 'string' && value['groupId'].length > 0)) &&
    (value['groupOperation'] === undefined ||
      value['groupOperation'] === null ||
      isBooleanOperation(value['groupOperation']))
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
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    parameters: {
      ...defaultShapeParameters(node.primitive),
      ...(node.parameters ?? {}),
    },
    bundleId: node.bundleId ?? null,
    groupId: node.groupId ?? null,
    groupOperation: node.groupId ? (node.groupOperation ?? 'union') : null,
  }));
  const operationsByGroup = new Map<string, BooleanOperation>();
  for (const node of normalizedNodes) {
    if (!node.groupId || !node.groupOperation) continue;
    const current = operationsByGroup.get(node.groupId);
    if (current && current !== node.groupOperation) {
      return { ok: false, message: 'Участники 3D-группы содержат разные булевы операции.' };
    }
    operationsByGroup.set(node.groupId, node.groupOperation);
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
  const ruler = value['ruler'];
  const normalizedRuler =
    ruler === undefined
      ? DEFAULT_RULER
      : isRecord(ruler) &&
          typeof ruler['visible'] === 'boolean' &&
          isVector(ruler['origin']) &&
          (ruler['precision'] === 0 || ruler['precision'] === 1 || ruler['precision'] === 2)
        ? (ruler as unknown as ThreeDRulerSettings)
        : null;
  if (!normalizedRuler) {
    return { ok: false, message: 'Настройки 3D-линейки повреждены.' };
  }
  return {
    ok: true,
    value: {
      ...(value as unknown as ThreeDDocument),
      nodes: normalizedNodes,
      ruler: normalizedRuler,
    },
  };
}

export function cloneThreeDDocument(document: ThreeDDocument): ThreeDDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      parameters: {
        ...node.parameters,
        sketchPoints: node.parameters.sketchPoints.map((point) => ({ ...point })),
      },
      dimensions: { ...node.dimensions },
      transform: {
        position: { ...node.transform.position },
        rotation: { ...node.transform.rotation },
        scale: { ...node.transform.scale },
      },
    })),
    grid: { ...document.grid },
    ruler: {
      ...document.ruler,
      origin: { ...document.ruler.origin },
    },
    camera: {
      ...document.camera,
      position: { ...document.camera.position },
      target: { ...document.camera.target },
    },
  };
}
