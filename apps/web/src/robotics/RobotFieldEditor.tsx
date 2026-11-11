import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  createRoboticsBall,
  createRoboticsBody,
  createRoboticsCurve,
  createRoboticsFloorMark,
  createRoboticsWall,
  getRoboticsPhysicsMode,
  isRoboticsWorldV3,
  nextRoboticsObjectId,
  ROBOTICS_SCENE_LIMITS,
  type RoboticsObjectKey,
  type RoboticsPoint,
  type RoboticsFieldDecoration,
  type RoboticsFloorMark,
  type RoboticsWorldDocument,
} from '@asa-lab/robotics/world-document';
import {
  canonicalRoboticsObjectKey,
  createRoboticsTileStamp,
  duplicateRoboticsObject,
  removeRoboticsObject,
  rotateRoboticsObject,
  translateRoboticsObject,
  type RoboticsTileStampKind,
} from '@asa-lab/robotics/world-authoring';
import {
  createRoboticsWorldState,
  measureRoboticsDistance,
  parseRoboticsWorldDocument,
  type RoboticsDistanceMeasurement,
  type RoboticsWorldState,
} from './world';
import { RobotField } from './RobotField';
import { useFieldCamera } from './use-field-camera';
import { FIELD_CAMERA_MIN_SCALE, FIELD_CAMERA_MAX_SCALE, fitFieldCamera } from './field-camera';
import { RobotFieldSettings } from './RobotFieldSettings';
import {
  createImageVisual,
  exportRoboticsField,
  importRoboticsField,
  MAX_FIELD_JSON_BYTES,
  optimizeFieldImage,
} from './field-files';
import { RobotObjectInspector } from './RobotObjectInspector';
import {
  resizeRoboticsFieldHandle,
  type FieldResizeKind,
  type FieldResizeHandle,
} from './field-vector-resize';

// Existing construction controls use this entry point too.
export { RoboticsNumberField } from './RoboticsNumberField';

const TOOLS = [
  { id: 'select', label: 'Выбор', symbol: '↖', extended: false },
  { id: 'wall', label: 'Стена', symbol: '▰', extended: false },
  { id: 'ball', label: 'Мяч', symbol: '●', extended: false },
  { id: 'can', label: 'Банка', symbol: '◉', extended: true },
  { id: 'box', label: 'Брусок', symbol: '▱', extended: true },
  { id: 'line', label: 'Линия', symbol: '╱', extended: false },
  { id: 'curve', label: 'Кривая', symbol: '╰', extended: true },
  { id: 'area', label: 'Зона', symbol: '▧', extended: false },
  { id: 'stamp', label: 'Трасса', symbol: '⊞', extended: true },
  { id: 'rectangle', label: 'Прямоугольник', symbol: '□', extended: false },
  { id: 'circle', label: 'Круг', symbol: '○', extended: false },
  { id: 'text', label: 'Текст', symbol: 'Т', extended: false },
] as const;
type Tool = (typeof TOOLS)[number]['id'];
const STAMPS: readonly { id: RoboticsTileStampKind; label: string }[] = [
  { id: 'straight', label: 'Прямая' },
  { id: 'turn', label: 'Поворот' },
  { id: 't-junction', label: 'Т-развилка' },
  { id: 'cross', label: 'Перекрёсток' },
];
const rounded = (value: number) => Math.round(value * 10000) / 10000;

function sceneAt(
  world: RoboticsWorldDocument,
  tool: Exclude<Tool, 'select'>,
  position: RoboticsPoint,
  stamp: RoboticsTileStampKind,
  turns: number,
): { key: RoboticsObjectKey; world: RoboticsWorldDocument } {
  if (tool === 'rectangle' || tool === 'circle' || tool === 'text') {
    const id = nextRoboticsObjectId(world, 'visual');
    const diameter = 0.22;
    const w = tool === 'text' ? 0.7 : tool === 'circle' ? diameter : 0.38;
    const h = tool === 'text' ? 0.16 : tool === 'circle' ? diameter : 0.28;
    const visual: RoboticsFieldDecoration = {
      id,
      kind: tool,
      label: tool === 'text' ? 'Надпись' : tool === 'circle' ? 'Круг' : 'Прямоугольник',
      xMeters: Math.min(position.xMeters, world.field.widthMeters - w),
      yMeters: Math.min(position.yMeters, world.field.heightMeters - h),
      widthMeters: w,
      heightMeters: h,
      strokeColor: '#0b3558',
      fillColor: '#e5f3fa',
      fillEnabled: tool !== 'text',
      ...(tool === 'text' ? { text: 'Старт' } : {}),
    };
    return {
      key: `decoration:${id}`,
      world: {
        ...world,
        field: { ...world.field, visuals: [...(world.field.visuals ?? []), visual] },
      },
    };
  }
  if (tool === 'stamp') {
    const size = world.field.tiles?.sizeMeters ?? 0.3;
    const next = createRoboticsTileStamp(
      stamp,
      world,
      {
        xMeters: rounded(Math.floor((position.xMeters + 1e-8) / size) * size),
        yMeters: rounded(Math.floor((position.yMeters + 1e-8) / size) * size),
      },
      turns,
    );
    return { world: next.world, key: next.keys[0]! };
  }
  const id = nextRoboticsObjectId(world, tool);
  const field = world.field;
  if (tool === 'wall')
    return {
      key: `wall:${id}`,
      world: {
        ...world,
        field: { ...field, obstacles: [...field.obstacles, createRoboticsWall(id, position)] },
      },
    };
  if (tool === 'ball') {
    const ball = createRoboticsBall(id, position);
    return {
      key: `ball:${id}`,
      world: { ...world, field: { ...field, balls: [...field.balls, ball] } },
    };
  }
  if (tool === 'can' || tool === 'box')
    return {
      key: `body:${id}`,
      world: {
        ...world,
        field: {
          ...field,
          bodies: [...(field.bodies ?? []), createRoboticsBody(tool, id, position)],
        },
      },
    };
  return {
    key: `mark:${id}`,
    world: {
      ...world,
      field: {
        ...field,
        floorMarks: [
          ...field.floorMarks,
          tool === 'curve'
            ? createRoboticsCurve(id, position)
            : createRoboticsFloorMark(tool, id, position),
        ],
      },
    },
  };
}

const PALETTE_GROUPS: readonly { title: string; tools: readonly Tool[] }[] = [
  { title: 'Предметы', tools: ['wall', 'ball', 'can', 'box'] },
  { title: 'Рисование', tools: ['line', 'curve', 'area', 'rectangle', 'circle', 'text', 'stamp'] },
];

function FieldToolArtwork({ kind }: { kind: Tool }) {
  const common = {
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 56 36" role="presentation" aria-hidden="true" focusable="false">
      {kind === 'wall' ? (
        <>
          <rect
            x="7"
            y="10"
            width="42"
            height="16"
            rx="3"
            fill="#d9e8f2"
            stroke="#477b99"
            {...common}
          />
          <path d="M14 25 27 11M25 25 38 11M38 25l9-10" stroke="#91b2c7" {...common} />
        </>
      ) : null}
      {kind === 'ball' ? (
        <>
          <circle cx="28" cy="17" r="13" fill="#f6ac39" stroke="#bd7824" {...common} />
          <path
            d="M22 11q6-5 13 2"
            fill="none"
            stroke="#ffdf9f"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <ellipse cx="28" cy="32" rx="12" ry="2" fill="#e0e8ee" />
        </>
      ) : null}
      {kind === 'can' ? (
        <>
          <path d="M15 10v16c0 7 26 7 26 0V10" fill="#bbd6e3" stroke="#5486a0" {...common} />
          <ellipse cx="28" cy="10" rx="13" ry="5" fill="#e9f2f6" stroke="#5486a0" {...common} />
          <ellipse cx="28" cy="26" rx="13" ry="4" fill="none" stroke="#79a6b8" strokeWidth="1.4" />
        </>
      ) : null}
      {kind === 'box' ? (
        <>
          <path d="m10 13 19-7 18 7-18 8z" fill="#e9c68e" stroke="#a67c40" {...common} />
          <path d="M10 13v13l19 7V21z" fill="#d3ad76" stroke="#a67c40" {...common} />
          <path d="M47 13v13l-18 7V21z" fill="#c99c62" stroke="#a67c40" {...common} />
        </>
      ) : null}
      {kind === 'line' ? (
        <>
          <path d="m11 26 34-17" stroke="#0c98bb" strokeWidth="4" strokeLinecap="round" />
          <circle cx="11" cy="26" r="3" fill="#fff" stroke="#0c98bb" {...common} />
          <circle cx="45" cy="9" r="3" fill="#fff" stroke="#0c98bb" {...common} />
        </>
      ) : null}
      {kind === 'curve' ? (
        <>
          <path
            d="M9 29C9 2 47 2 47 29"
            fill="none"
            stroke="#0c98bb"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="9" cy="29" r="3" fill="#fff" stroke="#0c98bb" {...common} />
          <circle cx="47" cy="29" r="3" fill="#fff" stroke="#0c98bb" {...common} />
        </>
      ) : null}
      {kind === 'area' ? (
        <rect
          x="10"
          y="7"
          width="36"
          height="22"
          rx="2"
          stroke="#0c98bb"
          strokeWidth="2"
          strokeDasharray="5 3"
          fill="#d5f0f5"
        />
      ) : null}
      {kind === 'rectangle' ? (
        <rect
          x="8"
          y="5"
          width="40"
          height="26"
          rx="1"
          fill="#e3f4fb"
          stroke="#0c87ae"
          strokeWidth="2.5"
        />
      ) : null}
      {kind === 'circle' ? (
        <circle cx="28" cy="18" r="13" fill="none" stroke="#0c87ae" strokeWidth="3" />
      ) : null}
      {kind === 'text' ? (
        <text
          x="28"
          y="27"
          textAnchor="middle"
          fill="#0b789a"
          fontSize="27"
          fontWeight="800"
          fontFamily="Arial"
        >
          T
        </text>
      ) : null}
      {kind === 'stamp' ? (
        <>
          <rect
            x="10"
            y="4"
            width="36"
            height="28"
            rx="2"
            fill="#eaf0f4"
            stroke="#7292a4"
            strokeWidth="1.3"
          />
          <path d="M22 4v28M34 4v28M10 14h36M10 23h36" stroke="#c4d3de" strokeWidth="1" />
          <path
            d="M16 28V18h24V8"
            fill="none"
            stroke="#0b8cae"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </svg>
  );
}

export function RobotFieldEditor({
  world,
  state,
  distance,
  running,
  showGrid,
  onShowGridChange,
  onCommit,
  sourceSchemaVersion,
  onUpgradeField,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  simulationControls,
}: {
  world: RoboticsWorldDocument;
  state: RoboticsWorldState;
  distance: RoboticsDistanceMeasurement;
  running: boolean;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  onCommit: (world: RoboticsWorldDocument) => boolean;
  sourceSchemaVersion: 2 | 3;
  onUpgradeField: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  simulationControls?: ReactNode;
}) {
  const [tool, setTool] = useState<Tool>('select');
  const [stamp, setStamp] = useState<RoboticsTileStampKind>('straight');
  const [turns, setTurns] = useState(0);
  const [selection, setSelection] = useState<RoboticsObjectKey | null>(null);
  const [objectEditorOpen, setObjectEditorOpen] = useState(false);
  const [objectFlyout, setObjectFlyout] = useState({ x: 40, y: 12 });
  const [tracePoints, setTracePoints] = useState<RoboticsPoint[]>([]);
  const [traceCursor, setTraceCursor] = useState<RoboticsPoint | null>(null);
  const [draft, setDraft] = useState<RoboticsWorldDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [snap, setSnap] = useState(false);
  const [pan, setPan] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const suppressNextCanvasClick = useRef(false);
  // Upload decoding is async; reject stale completions rather than replacing
  // changes made on the field while the browser processes an image or JSON.
  const latestWorldRef = useRef(world);
  latestWorldRef.current = world;
  const latestRunningRef = useRef(running);
  latestRunningRef.current = running;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const propertiesButton = useRef<HTMLButtonElement>(null);
  const inspectorObject = useRef<HTMLDivElement>(null);
  const resizeDrag = useRef<{
    pointerId: number;
    svg: SVGSVGElement;
    world: RoboticsWorldDocument;
    kind: FieldResizeKind;
    id: string;
    part: FieldResizeHandle;
    next: RoboticsWorldDocument;
  } | null>(null);
  const drag = useRef<{
    pointerId: number;
    svg: SVGSVGElement;
    start: RoboticsPoint;
    world: RoboticsWorldDocument;
    key: RoboticsObjectKey;
    next: RoboticsWorldDocument;
  } | null>(null);
  const extended = isRoboticsWorldV3(world);
  const pendingTouch = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const fieldBounds = {
    minX: 0,
    minY: 0,
    maxX: world.field.widthMeters,
    maxY: world.field.heightMeters,
  };
  const cameraControl = useFieldCamera(canvasRef, fieldBounds, {
    onStart: (keepPointerCapture) => {
      releaseDrag(!keepPointerCapture);
      pendingTouch.current = null;
      suppressNextCanvasClick.current = true;
    },
    onCancel: () => {
      releaseDrag();
      pendingTouch.current = null;
      setTracePoints([]);
      setTraceCursor(null);
      setTool('select');
      setPan(false);
      suppressNextCanvasClick.current = true;
    },
    isEditing: () => Boolean(drag.current || resizeDrag.current),
  });
  const projection = cameraControl.camera
    ? { camera: cameraControl.camera, viewport: cameraControl.viewport }
    : undefined;
  const fitScale = fitFieldCamera(fieldBounds, cameraControl.viewport).pixelsPerMeter;
  const zoom = (cameraControl.camera?.pixelsPerMeter ?? fitScale) / fitScale;
  function pointAt(clientX: number, clientY: number): RoboticsPoint | null {
    const point = cameraControl.point(clientX, clientY);
    return point ? { xMeters: rounded(point.xMeters), yMeters: rounded(point.yMeters) } : null;
  }
  function pointerPosition(event: PointerEvent<SVGSVGElement>) {
    return pointAt(event.clientX, event.clientY);
  }
  const selectedTool = TOOLS.find((item) => item.id === tool)!;

  useEffect(() => {
    if (!selection || !objectEditorOpen) return;
    const root = canvasRef.current?.closest<HTMLElement>('.robotics-field-editor-body');
    if (!root) return;
    const position = () => {
      const svg = canvasRef.current?.querySelector('svg.robotics-field');
      const element = [...(svg?.querySelectorAll('[data-scene-key]') ?? [])].find(
        (node) => node.getAttribute('data-scene-key') === selection,
      );
      const rootRect = root.getBoundingClientRect();
      const objectRect = element?.getBoundingClientRect();
      if (!objectRect) return;
      const editorWidth =
        (canvasRef.current?.getBoundingClientRect().right ?? rootRect.right) - rootRect.left;
      const size = Math.min(300, editorWidth - 16);
      const objectLeft = objectRect.left - rootRect.left;
      const objectRight = objectRect.right - rootRect.left;
      const rightSide = objectRight + 12;
      const leftSide = objectLeft - size - 12;
      // Never cover the selected object's resize handles when there is space beside it.
      const x =
        rightSide + size <= editorWidth - 8
          ? rightSide
          : leftSide >= 8
            ? leftSide
            : Math.max(8, Math.min(editorWidth - size - 8, objectLeft));
      const maxPanelHeight = Math.min(320, rootRect.height * 0.6);
      const y = Math.max(
        8,
        Math.min(rootRect.height - maxPanelHeight - 8, objectRect.top - rootRect.top - 20),
      );
      setObjectFlyout((old) =>
        Math.abs(old.x - x) < 1 && Math.abs(old.y - y) < 1 ? old : { x, y },
      );
    };
    const frame = requestAnimationFrame(position);
    window.addEventListener('resize', position);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', position);
      observer?.disconnect();
    };
  }, [selection, objectEditorOpen, world, cameraControl.camera]);

  function releaseDrag(releaseCapture = true) {
    const current = drag.current;
    const resizing = resizeDrag.current;
    drag.current = null;
    resizeDrag.current = null;
    if (releaseCapture && current?.svg.hasPointerCapture?.(current.pointerId))
      current.svg.releasePointerCapture(current.pointerId);
    if (releaseCapture && resizing?.svg.hasPointerCapture?.(resizing.pointerId))
      resizing.svg.releasePointerCapture(resizing.pointerId);
    setDraft(null);
  }
  useEffect(() => {
    releaseDrag();
    setError(null);
  }, [world, running]);
  useEffect(
    () => () => {
      const current = drag.current;
      if (current?.svg.hasPointerCapture?.(current.pointerId))
        current.svg.releasePointerCapture(current.pointerId);
    },
    [],
  );
  function fail(error: unknown) {
    setError(error instanceof Error ? error.message : 'Не удалось изменить предмет.');
  }
  function commit(next: RoboticsWorldDocument): boolean {
    if (running) return false;
    const parsed = parseRoboticsWorldDocument(next);
    if (!parsed.ok) {
      setError(parsed.message);
      return false;
    }
    if (!onCommit(parsed.world)) {
      setError('Не удалось применить изменение. Проверьте привязку датчика в разделе «Робот».');
      return false;
    }
    setError(null);
    return true;
  }
  function selectAdded(key: RoboticsObjectKey) {
    setSelection(key);
    setObjectEditorOpen(true);
    setTool('select');
    setPan(false);
    requestAnimationFrame(() => inspectorObject.current?.scrollTo({ top: 0 }));
  }
  const dynamicCount = world.field.balls.length + (world.field.bodies?.length ?? 0);
  function isMaxed(kind: Tool): boolean {
    if (kind === 'wall') return world.field.obstacles.length >= ROBOTICS_SCENE_LIMITS.walls;
    if (kind === 'ball' || kind === 'can' || kind === 'box')
      return dynamicCount >= ROBOTICS_SCENE_LIMITS.dynamicBodies;
    if (kind === 'select') return false;
    if (kind === 'rectangle' || kind === 'circle' || kind === 'text')
      return (world.field.visuals?.length ?? 0) >= ROBOTICS_SCENE_LIMITS.visuals;
    return (
      world.field.floorMarks.length +
        (kind === 'stamp' && (stamp === 'cross' || stamp === 't-junction') ? 2 : 1) >
      ROBOTICS_SCENE_LIMITS.floorMarks
    );
  }
  const maxed = isMaxed(tool);

  function add(position?: RoboticsPoint, placingTool: Tool = tool) {
    const chosen = TOOLS.find((item) => item.id === placingTool);
    if (
      placingTool === 'select' ||
      !chosen ||
      running ||
      isMaxed(placingTool) ||
      (chosen.extended && !extended)
    )
      return;
    if (position) {
      try {
        if (
          position.xMeters < 0 ||
          position.xMeters > world.field.widthMeters ||
          position.yMeters < 0 ||
          position.yMeters > world.field.heightMeters
        ) {
          setError('Перетащите предмет внутрь границ поля.');
          return;
        }
        const point =
          snap && placingTool !== 'stamp'
            ? {
                xMeters: rounded(
                  Math.round(position.xMeters / world.field.gridMeters) * world.field.gridMeters,
                ),
                yMeters: rounded(
                  Math.round(position.yMeters / world.field.gridMeters) * world.field.gridMeters,
                ),
              }
            : position;
        const next = sceneAt(world, placingTool, point, stamp, turns);
        if (commit(next.world)) selectAdded(next.key);
      } catch (error) {
        fail(error);
      }
      return;
    }
    const step = placingTool === 'stamp' ? (world.field.tiles?.sizeMeters ?? 0.3) : 0.1;
    const candidates: RoboticsPoint[] =
      placingTool === 'stamp'
        ? []
        : [{ xMeters: world.field.widthMeters / 2, yMeters: world.field.heightMeters / 2 }];
    for (let y = placingTool === 'stamp' ? 0 : step; y < world.field.heightMeters; y += step)
      for (let x = placingTool === 'stamp' ? 0 : step; x < world.field.widthMeters; x += step)
        candidates.push({ xMeters: rounded(x), yMeters: rounded(y) });
    for (const point of candidates) {
      try {
        const next = sceneAt(world, placingTool, point, stamp, turns);
        if (!parseRoboticsWorldDocument(next.world).ok) continue;
        if (commit(next.world)) selectAdded(next.key);
        return;
      } catch {
        /* Try the next bounded, deterministic location. */
      }
    }
    setError(
      'Нет свободного места или достигнут лимит предметов. Удалите предмет либо увеличьте поле.',
    );
  }

  function dragOverCanvas(event: DragEvent<HTMLDivElement>) {
    if (running || !event.dataTransfer.types.includes('application/x-asa-robotics-field-tool'))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dropHover) setDropHover(true);
  }
  function dropOnCanvas(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('application/x-asa-robotics-field-tool')) return;
    event.preventDefault();
    setDropHover(false);
    if (running) return;
    const draggedKind = event.dataTransfer.getData('application/x-asa-robotics-field-tool');
    const selected = TOOLS.find((item) => item.id === draggedKind);
    const svg = canvasRef.current?.querySelector<SVGSVGElement>('svg.robotics-field');
    if (!selected || !svg) return;
    const position = pointAt(event.clientX, event.clientY);
    if (position) {
      if (selected.id === 'line' || selected.id === 'curve') {
        setTool(selected.id);
        setTracePoints([position]);
        setTraceCursor(null);
      } else add(position, selected.id);
    }
  }
  const clearTrace = () => {
    setTracePoints([]);
    setTraceCursor(null);
  };
  function finishTrace() {
    if (tool !== 'line' || tracePoints.length < 2) {
      clearTrace();
      return;
    }
    const points = tracePoints.filter(
      (point, index) =>
        index === 0 ||
        Math.hypot(
          point.xMeters - tracePoints[index - 1]!.xMeters,
          point.yMeters - tracePoints[index - 1]!.yMeters,
        ) >= 0.02,
    );
    if (points.length < 2) return clearTrace();
    if (points.length - 1 + world.field.floorMarks.length > ROBOTICS_SCENE_LIMITS.floorMarks) {
      setError('Достигнут лимит линий. Удалите лишние элементы разметки.');
      return;
    }
    const groupId = points.length > 2 ? nextRoboticsObjectId(world, 'line-group') : undefined;
    let next = world;
    let firstId = '';
    for (let i = 1; i < points.length; i += 1) {
      const id = nextRoboticsObjectId(next, 'line');
      if (!firstId) firstId = id;
      const mark: RoboticsFloorMark = {
        id,
        kind: 'line',
        label: 'Линия',
        start: points[i - 1]!,
        end: points[i]!,
        widthMeters: 0.02,
        color: '#1e293b',
        ...(groupId ? { groupId, groupPivot: points[0]! } : {}),
      };
      next = {
        ...next,
        field: {
          ...next.field,
          floorMarks: [...next.field.floorMarks, mark],
        },
      };
    }
    if (commit(next)) {
      setSelection((groupId ? 'mark-group:' + groupId : 'mark:' + firstId) as RoboticsObjectKey);
      setObjectEditorOpen(true);
      setTool('select');
      clearTrace();
    }
  }
  function handleTracePoint(point: RoboticsPoint) {
    if (
      point.xMeters < 0 ||
      point.yMeters < 0 ||
      point.xMeters > world.field.widthMeters ||
      point.yMeters > world.field.heightMeters
    )
      return;
    if (tool === 'line') {
      if (
        tracePoints.length &&
        Math.hypot(
          point.xMeters - tracePoints[tracePoints.length - 1]!.xMeters,
          point.yMeters - tracePoints[tracePoints.length - 1]!.yMeters,
        ) < 0.02
      )
        return;
      setTracePoints((points) => [...points, point]);
      setTraceCursor(null);
      return;
    }
    if (tool === 'curve') {
      if (tracePoints.length < 2) {
        setTracePoints((points) => [...points, point]);
        setTraceCursor(null);
        return;
      }
      const id = nextRoboticsObjectId(world, 'curve');
      const curve: RoboticsFloorMark = {
        ...createRoboticsCurve(id, tracePoints[0]!),
        start: tracePoints[0]!,
        control: tracePoints[1]!,
        end: point,
      };
      const next = {
        ...world,
        field: {
          ...world.field,
          floorMarks: [...world.field.floorMarks, curve],
        },
      };
      if (commit(next)) {
        setSelection(('mark:' + id) as RoboticsObjectKey);
        setObjectEditorOpen(true);
        setTool('select');
        clearTrace();
      }
    }
  }

  async function addImageFile(file: File) {
    if (running) return;
    const sourceWorld = world;
    try {
      const result = await optimizeFieldImage(file);
      if (latestWorldRef.current !== sourceWorld || latestRunningRef.current) {
        setError('Поле изменилось во время загрузки картинки. Выберите файл повторно.');
        return;
      }
      const visual = createImageVisual(sourceWorld, result.data, result.width, result.height);
      const next = {
        ...world,
        field: {
          ...world.field,
          visuals: [...(world.field.visuals ?? []), visual],
        },
      };
      if (commit(next)) selectAdded(('decoration:' + visual.id) as RoboticsObjectKey);
    } catch (error) {
      fail(error);
    }
  }
  async function readFieldFile(file: File) {
    if (running) return;
    const sourceWorld = world;
    if (file.size > MAX_FIELD_JSON_BYTES) return fail(new Error('JSON поля больше 500 КБ.'));
    try {
      const source = await file.text();
      if (latestWorldRef.current !== sourceWorld || latestRunningRef.current) {
        setError('Поле изменилось во время чтения JSON. Выберите файл повторно.');
        return;
      }
      const next = importRoboticsField(sourceWorld, source);
      if (
        !window.confirm(
          'Заменить только размеры, рисунки и предметы поля из JSON? Электроника, код и конструкция робота останутся прежними.',
        )
      )
        return;
      if (commit(next)) {
        setSelection(null);
        setObjectEditorOpen(false);
        clearTrace();
      }
    } catch (error) {
      fail(error);
    }
  }
  function exportFieldFile() {
    const blob = new Blob([exportRoboticsField(world)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'asa-lab-pole.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function moved(current: NonNullable<typeof drag.current>, point: RoboticsPoint) {
    const dx = point.xMeters - current.start.xMeters,
      dy = point.yMeters - current.start.yMeters;
    const field = current.world.field;
    const mark = field.floorMarks.find(
      (item) =>
        current.key === `mark:${item.id}` ||
        (item.groupId && current.key === `mark-group:${item.groupId}`),
    );
    const step = mark?.groupPivot ? (field.tiles?.sizeMeters ?? 0.3) : field.gridMeters;
    const anchor =
      current.key === 'robot'
        ? current.world.initialPose
        : (field.obstacles.find((item) => current.key === `wall:${item.id}`) ??
          field.balls.find((item) => current.key === `ball:${item.id}`) ??
          field.bodies?.find((item) => current.key === `body:${item.id}`) ??
          field.visuals?.find((item) => current.key === `decoration:${item.id}`) ??
          (mark?.groupPivot
            ? {
                xMeters: mark.groupPivot.xMeters - step / 2,
                yMeters: mark.groupPivot.yMeters - step / 2,
              }
            : mark
              ? mark.kind === 'area'
                ? mark
                : mark.start
              : current.start));
    return translateRoboticsObject(
      current.world,
      current.key,
      rounded(snap ? Math.round((anchor.xMeters + dx) / step) * step - anchor.xMeters : dx),
      rounded(snap ? Math.round((anchor.yMeters + dy) / step) * step - anchor.yMeters : dy),
    );
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    suppressNextCanvasClick.current = false;
    const object = (event.target as Element).closest('[data-scene-key]');
    const requestPan =
      event.button === 0 &&
      event.pointerType !== 'touch' &&
      (pan || (tool === 'select' && !object));
    if (cameraControl.pointerDown(event, requestPan)) {
      suppressNextCanvasClick.current = true;
      return;
    }
    if (running || pan || event.button !== 0 || !event.isPrimary) return;
    const point = pointerPosition(event);
    if (!point) return;
    const handle = (event.target as Element).closest('[data-vector-handle]');
    if (handle && tool === 'select') {
      const kind = handle.getAttribute('data-vector-kind') as FieldResizeKind | null;
      const part = handle.getAttribute('data-vector-handle') as FieldResizeHandle | null;
      const id = handle.getAttribute('data-vector-id');
      if (kind && part && id) {
        event.preventDefault();
        resizeDrag.current = {
          pointerId: event.pointerId,
          svg: event.currentTarget,
          world,
          kind,
          id,
          part,
          next: world,
        };
        setObjectEditorOpen(false);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (tool !== 'select') {
      event.preventDefault();
      if (event.pointerType === 'touch') {
        // A first touch can still become a two-finger camera gesture. Place or
        // add a trace point only after a completed single-finger tap.
        pendingTouch.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        return;
      }
      // The browser dispatches click after pointerDown/pointerUp. A completed
      // curve can already have switched to Select by then; do not reselect an
      // underlying robot instead of the freshly authored object.
      suppressNextCanvasClick.current = true;
      if (tool === 'line' || tool === 'curve') handleTracePoint(point);
      else add(point);
      return;
    }
    const target = (event.target as Element).closest('[data-scene-key]');
    const inputKey = target?.getAttribute('data-scene-key') as RoboticsObjectKey | null;
    if (!inputKey) {
      setSelection(null);
      return;
    }
    const key = canonicalRoboticsObjectKey(world, inputKey);
    event.preventDefault();
    setSelection(key);
    setError(null);
    setObjectEditorOpen(false);
    drag.current = {
      pointerId: event.pointerId,
      svg: event.currentTarget,
      start: point,
      world,
      key,
      next: world,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (cameraControl.pointerMove(event)) {
      suppressNextCanvasClick.current = true;
      return;
    }
    if (pendingTouch.current?.pointerId === event.pointerId) return;
    const resizing = resizeDrag.current;
    if (resizing && resizing.pointerId === event.pointerId && !running) {
      const point = pointerPosition(event);
      if (!point) return;
      try {
        resizing.next = resizeRoboticsFieldHandle(
          resizing.world,
          resizing.kind,
          resizing.id,
          resizing.part,
          point,
        );
        setDraft(resizing.next);
        setError(null);
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (!running && (tool === 'line' || tool === 'curve') && tracePoints.length) {
      setTraceCursor(pointerPosition(event));
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || running) return;
    const point = pointerPosition(event);
    if (!point) return;
    try {
      current.next = moved(current, point);
      setDraft(current.next);
      setError(null);
    } catch (error) {
      fail(error);
    }
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (cameraControl.pointerUp(event)) {
      pendingTouch.current = null;
      suppressNextCanvasClick.current = true;
      return;
    }
    const touch = pendingTouch.current;
    if (touch?.pointerId === event.pointerId) {
      pendingTouch.current = null;
      suppressNextCanvasClick.current = true;
      if (!running && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) < 6) {
        const point = pointerPosition(event);
        if (point) {
          if (tool === 'line' || tool === 'curve') handleTracePoint(point);
          else add(point);
        }
      }
      return;
    }
    const resizing = resizeDrag.current;
    if (resizing && resizing.pointerId === event.pointerId) {
      const point = pointerPosition(event);
      releaseDrag();
      if (!point || running || resizing.world !== world) return;
      try {
        const next = resizeRoboticsFieldHandle(
          resizing.world,
          resizing.kind,
          resizing.id,
          resizing.part,
          point,
        );
        if (commit(next)) setObjectEditorOpen(true);
      } catch (error) {
        fail(error);
      }
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = pointerPosition(event);
    releaseDrag();
    if (current.world !== world || running) return;
    if (
      point &&
      Math.hypot(point.xMeters - current.start.xMeters, point.yMeters - current.start.yMeters) <
        0.003
    ) {
      setObjectEditorOpen(true);
      return;
    }
    try {
      commit(point ? moved(current, point) : current.next);
    } catch (error) {
      fail(error);
    }
  }
  function remove() {
    if (!selection || selection === 'robot' || running) return;
    try {
      if (commit(removeRoboticsObject(world, selection))) {
        setSelection(null);
        setObjectEditorOpen(false);
        if (propertiesButton.current?.getClientRects().length)
          requestAnimationFrame(() => propertiesButton.current?.focus());
      }
    } catch (error) {
      fail(error);
    }
  }
  function rotate(angle: number) {
    if (!selection || running) return;
    try {
      commit(rotateRoboticsObject(world, selection, angle));
    } catch (error) {
      fail(error);
    }
  }
  function duplicate() {
    if (!selection || selection === 'robot' || running) return;
    const step = selection.startsWith('mark-group:') ? (world.field.tiles?.sizeMeters ?? 0.3) : 0.1;
    let lastError: unknown;
    for (const [dx, dy] of [
      [1, 1],
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [-1, -1],
      [2, 0],
      [0, 2],
    ]) {
      try {
        const next = duplicateRoboticsObject(world, selection, {
          xMeters: step * dx!,
          yMeters: step * dy!,
        });
        if (commit(next.world)) selectAdded(next.key);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    fail(lastError);
  }
  function fit() {
    cameraControl.fit(fieldBounds);
  }
  function focusRobot() {
    const pose = state.pose;
    const radius = Math.max(
      world.robot.bodyLengthMeters,
      world.robot.bodyWidthMeters,
      world.robot.wheelTrackMeters,
      0.5,
    );
    cameraControl.fit({
      minX: pose.xMeters - radius,
      minY: pose.yMeters - radius,
      maxX: pose.xMeters + radius,
      maxY: pose.yMeters + radius,
    });
  }
  function focusSelection() {
    if (!selection) return;
    if (selection === 'robot') return focusRobot();
    const nodes = canvasRef.current?.querySelectorAll<SVGGraphicsElement>(
      '[data-scene-key]:not([data-vector-handle])',
    );
    const points: RoboticsPoint[] = [];
    for (const node of nodes ?? []) {
      const key = node.getAttribute('data-scene-key') as RoboticsObjectKey;
      if (canonicalRoboticsObjectKey(world, key) !== selection) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const a = cameraControl.point(rect.left, rect.top);
      const b = cameraControl.point(rect.right, rect.bottom);
      if (a && b) points.push(a, b);
    }
    if (!points.length) return;
    cameraControl.fit({
      minX: Math.min(...points.map((p) => p.xMeters)),
      maxX: Math.max(...points.map((p) => p.xMeters)),
      minY: Math.min(...points.map((p) => p.yMeters)),
      maxY: Math.max(...points.map((p) => p.yMeters)),
    });
  }

  function closeProperties() {
    setPropertiesOpen(false);
    requestAnimationFrame(() => propertiesButton.current?.focus());
  }
  const scene = draft ?? world;
  const previewState = draft ? createRoboticsWorldState(draft) : state;
  const previewDistance = draft
    ? measureRoboticsDistance(draft, draft.initialPose, previewState.balls, previewState.bodies)
    : distance;
  const seenGroups = new Set<string>();
  const objects: { key: RoboticsObjectKey; label: string }[] = [
    { key: 'robot', label: 'Старт робота' },
    ...world.field.obstacles.map((item) => ({
      key: `wall:${item.id}` as const,
      label: `${item.label ?? 'Стена'} · ${item.id}`,
    })),
    ...world.field.balls.map((item) => ({
      key: `ball:${item.id}` as const,
      label: `${item.label ?? 'Мяч'} · ${item.id}`,
    })),
    ...(world.field.bodies ?? []).map((item) => ({
      key: `body:${item.id}` as const,
      label: `${item.label ?? (item.kind === 'can' ? 'Банка' : 'Брусок')} · ${item.id}`,
    })),
    ...(world.field.visuals ?? []).map((item) => ({
      key: `decoration:${item.id}` as const,
      label: `${item.label ?? item.kind} · ${item.id}`,
    })),
    ...world.field.floorMarks.flatMap((item) => {
      if (item.groupId) {
        if (seenGroups.has(item.groupId)) return [];
        seenGroups.add(item.groupId);
      }
      return [
        {
          key: item.groupId
            ? (`mark-group:${item.groupId}` as const)
            : (`mark:${item.id}` as const),
          label: `${item.label ?? (item.kind === 'area' ? 'Зона' : 'Линия')} · ${item.groupId ?? item.id}`,
        },
      ];
    }),
  ];
  return (
    <>
      <span className="robotics-visually-hidden" data-testid="robotics-physics-mode">
        {!extended
          ? 'Прежняя модель'
          : getRoboticsPhysicsMode(world) === 'dynamic'
            ? 'Динамика 2D'
            : 'Учебный'}
      </span>
      <div className="robotics-field-toolbar" role="toolbar" aria-label="Инструменты поля">
        <div className="robotics-field-toolbar-scroll">
          <button
            ref={propertiesButton}
            type="button"
            className="robotics-button robotics-properties-toggle robotics-field-catalog-toggle"
            aria-controls="robotics-field-catalog"
            aria-expanded={propertiesOpen}
            title="Показать элементы поля и их настройки"
            onClick={() => setPropertiesOpen((value) => !value)}
          >
            <span aria-hidden="true">▦</span>
            Элементы поля
          </button>
          <div className="robotics-field-view-tools" aria-label="Вид и привязка поля">
            <label className="robotics-grid-toggle">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(event) => onShowGridChange(event.target.checked)}
              />
              Сетка
            </label>
            <label
              className="robotics-grid-toggle"
              title="Предметы — к сетке; штампы трассы — к плиткам"
            >
              <input
                type="checkbox"
                checked={snap}
                disabled={running}
                onChange={(event) => setSnap(event.target.checked)}
              />
              Привязка
            </label>
            <button
              type="button"
              aria-label="Перемещать вид поля"
              aria-pressed={pan}
              onClick={() => {
                releaseDrag();
                setPan((value) => !value);
                setTool('select');
              }}
            >
              Рука
            </button>
            <div
              className="robotics-field-history"
              role="group"
              aria-label="История изменений поля"
            >
              <button
                type="button"
                aria-label="Отменить"
                title="Шаг назад — отменить последнее изменение"
                disabled={running || !canUndo}
                onClick={onUndo}
              >
                <span aria-hidden="true">↶</span>
                <span>Назад</span>
              </button>
              <button
                type="button"
                aria-label="Повторить"
                title="Шаг вперёд — вернуть отменённое изменение"
                disabled={running || !canRedo}
                onClick={onRedo}
              >
                <span aria-hidden="true">↷</span>
                <span>Вперёд</span>
              </button>
            </div>
            <div className="robotics-field-zoom">
              <button
                type="button"
                aria-label="Отдалить поле"
                disabled={(cameraControl.camera?.pixelsPerMeter ?? 1) <= FIELD_CAMERA_MIN_SCALE}
                onClick={() => cameraControl.zoom(1 / 1.2)}
              >
                −
              </button>
              <output aria-label="Масштаб поля">{Math.round(zoom * 100)}%</output>
              <button
                type="button"
                aria-label="Приблизить поле"
                disabled={(cameraControl.camera?.pixelsPerMeter ?? 1) >= FIELD_CAMERA_MAX_SCALE}
                onClick={() => cameraControl.zoom(1.2)}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Показать поле целиком"
                title="Показать всё (Home)"
                onClick={fit}
              >
                Всё
              </button>
              <button type="button" aria-label="К роботу" title="К роботу" onClick={focusRobot}>
                Робот
              </button>
              <button
                type="button"
                aria-label="К выделенному"
                title="К выделенному"
                disabled={!selection}
                onClick={focusSelection}
              >
                Выбор
              </button>
            </div>
          </div>
        </div>
        {simulationControls}
      </div>
      {error ? (
        <p className="robotics-field-error robotics-scene-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="robotics-field-editor-body" data-properties-open={propertiesOpen}>
        <div
          ref={canvasRef}
          className="robotics-field-canvas robotics-field-scroll"
          tabIndex={0}
          role="group"
          aria-label="Полотно поля"
          data-pan={pan || cameraControl.spacePressed}
          data-camera-gesturing={cameraControl.gesturing}
          onPointerEnter={cameraControl.enter}
          onPointerLeave={cameraControl.leave}
          data-drawing={tracePoints.length > 0}
          data-drop-hover={dropHover}
          onClick={(event) => {
            if (suppressNextCanvasClick.current) {
              suppressNextCanvasClick.current = false;
              return;
            }
            if (running || pan || cameraControl.spacePressed || tool !== 'select') return;
            const target = (event.target as Element).closest('[data-scene-key]');
            const key = target?.getAttribute('data-scene-key') as RoboticsObjectKey | null;
            if (key) {
              setSelection(canonicalRoboticsObjectKey(world, key));
              setObjectEditorOpen(true);
            }
          }}
          onDragOver={dragOverCanvas}
          onDragLeave={() => setDropHover(false)}
          onDrop={dropOnCanvas}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cameraControl.cancel();
              pendingTouch.current = null;
              suppressNextCanvasClick.current = true;
              clearTrace();
              releaseDrag();
              setTool('select');
              setPan(false);
            }
            if (event.key === 'Enter' && tool === 'line') {
              event.preventDefault();
              finishTrace();
              return;
            }
            if (event.key === 'Home') {
              event.preventDefault();
              fit();
            }
            if (event.key === '+' || event.key === '=') {
              event.preventDefault();
              cameraControl.zoom(1.2);
            }
            if (event.key === '-') {
              event.preventDefault();
              cameraControl.zoom(1 / 1.2);
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              remove();
            }
          }}
        >
          <div className="robotics-field-camera-surface">
            <RobotField
              world={scene}
              projection={projection}
              state={previewState}
              distance={previewDistance}
              showGrid={showGrid}
              selection={selection}
              editable={!running && !pan}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => {
                cameraControl.cancel();
                pendingTouch.current = null;
                releaseDrag();
                clearTrace();
                suppressNextCanvasClick.current = true;
              }}
              onLostPointerCapture={(event) => {
                cameraControl.lostPointerCapture(event);
                if (
                  drag.current?.pointerId === event.pointerId ||
                  resizeDrag.current?.pointerId === event.pointerId
                )
                  releaseDrag();
              }}
              onContextMenu={(event) => {
                if (tool !== 'line' && tool !== 'curve') return;
                event.preventDefault();
                if (tool === 'line') finishTrace();
                else clearTrace();
              }}
              draftStroke={
                (tool === 'line' || tool === 'curve') && tracePoints.length
                  ? { kind: tool, points: tracePoints, cursor: traceCursor }
                  : null
              }
            />
          </div>
        </div>
        <aside
          id="robotics-field-catalog"
          className="robotics-scene-inspector"
          aria-label="Свойства поля и предмета"
          onFocusCapture={() => {
            // Field controls cannot be used while a floating object inspector
            // obscures them, especially on 320-390px screens.
            setObjectEditorOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && propertiesButton.current?.getClientRects().length) {
              event.stopPropagation();
              closeProperties();
            }
          }}
        >
          <div className="robotics-field-palette-heading">
            <strong>Элементы поля</strong>
            <button
              type="button"
              className="robotics-field-palette-close"
              aria-label="Закрыть каталог элементов"
              onClick={closeProperties}
            >
              ×
            </button>
          </div>
          <div className="robotics-field-palette" data-testid="robotics-field-palette">
            {PALETTE_GROUPS.map((group) => (
              <section
                className="robotics-field-palette-section"
                key={group.title}
                aria-label={group.title}
              >
                <h3>{group.title}</h3>
                <div className="robotics-field-palette-grid">
                  {group.tools.map((kind) => {
                    const item = TOOLS.find((entry) => entry.id === kind)!;
                    const disabled = running || isMaxed(kind) || (item.extended && !extended);
                    return (
                      <button
                        key={kind}
                        type="button"
                        className="robotics-field-palette-card"
                        data-robotics-palette-tool={kind}
                        aria-label={item.label}
                        aria-pressed={tool === kind && !pan}
                        title={
                          item.extended && !extended
                            ? 'Включите расширенное поле в настройках'
                            : 'Перетащите на поле или выберите и нажмите на место'
                        }
                        disabled={disabled}
                        draggable={!disabled}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('application/x-asa-robotics-field-tool', kind);
                          event.dataTransfer.setData('text/plain', kind);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                          releaseDrag();
                          clearTrace();
                          setTool(kind);
                          setSelection(null);
                          // A selected object's floating inspector must not cover
                          // pointer gestures when the user starts drawing a new item.
                          setObjectEditorOpen(false);
                          setPan(false);
                          setError(null);
                          if (window.matchMedia('(max-width: 760px)').matches)
                            setPropertiesOpen(false);
                        }}
                      >
                        <span className="robotics-field-palette-art">
                          <FieldToolArtwork kind={kind} />
                        </span>
                        <span className="robotics-field-palette-name">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <section
            className="robotics-field-palette-section robotics-field-import-section"
            aria-label="Файлы поля"
          >
            <h3>Файлы поля</h3>
            <div className="robotics-field-file-actions">
              <button
                type="button"
                title="Загрузить изображение PNG, JPEG или WebP"
                disabled={running}
                aria-label="Добавить изображение"
                onClick={() => imageInputRef.current?.click()}
              >
                <span aria-hidden="true">▧</span>
                <span>Картинка</span>
              </button>
              <button
                type="button"
                title="Заменить поле из локального JSON, сохранив робота, электронику и код"
                disabled={running}
                aria-label="Импортировать поле JSON"
                onClick={() => jsonInputRef.current?.click()}
              >
                <span aria-hidden="true">{'{ }'}</span>
                <span>Импорт JSON</span>
              </button>
              <button
                type="button"
                title="Скачать поле и предметы в JSON"
                aria-label="Экспортировать поле JSON"
                onClick={exportFieldFile}
              >
                <span aria-hidden="true">⇩</span>
                <span>Сохранить JSON</span>
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="robotics-visually-hidden"
              tabIndex={-1}
              aria-label="Файл изображения поля"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void addImageFile(file);
              }}
            />
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json,application/json"
              className="robotics-visually-hidden"
              tabIndex={-1}
              aria-label="Файл JSON поля"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void readFieldFile(file);
              }}
            />
          </section>
          {!running && tool !== 'select' ? (
            <div className="robotics-field-palette-action">
              <span role="status">
                {maxed
                  ? 'Лимит элементов достигнут'
                  : tool === 'line'
                    ? 'Щелкните точки линии, правой кнопкой мыши или Enter завершите. Esc отменит.'
                    : tool === 'curve'
                      ? 'Кривая: начало → точка изгиба → конец (три щелчка).'
                      : 'Выбран: ' + selectedTool.label + '. Нажмите на поле.'}
              </span>
              {tool !== 'line' && tool !== 'curve' ? (
                <button type="button" disabled={maxed} onClick={() => add()}>
                  Добавить
                </button>
              ) : null}
            </div>
          ) : null}
          {!running && tool === 'stamp' ? (
            <div className="robotics-field-stamp-controls">
              <select
                aria-label="Штамп трассы"
                value={stamp}
                onChange={(event) => {
                  const next = STAMPS.find((item) => item.id === event.target.value);
                  if (next) setStamp(next.id);
                }}
              >
                {STAMPS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Повернуть шаблон на 90 градусов"
                onClick={() => setTurns((value) => (value + 1) % 4)}
              >
                ↻ {turns * 90}°
              </button>
            </div>
          ) : null}
          <details className="robotics-field-settings-sheet">
            <summary>Настройки поля</summary>
            <RobotFieldSettings
              world={world}
              running={running}
              sourceSchemaVersion={sourceSchemaVersion}
              onUpgradeField={onUpgradeField}
              onCommit={commit}
              onError={setError}
              onPresetApplied={() => setSelection(null)}
            />
          </details>
        </aside>
        {selection && objectEditorOpen && objects.some((item) => item.key === selection) ? (
          <div
            ref={inspectorObject}
            className="robotics-field-object-flyout"
            role="dialog"
            aria-label="Параметры выбранного объекта"
            style={{ left: objectFlyout.x, top: objectFlyout.y }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setObjectEditorOpen(false);
              }
            }}
          >
            <div className="robotics-object-flyout-header">
              <strong>
                {objects.find((item) => item.key === selection)?.label?.split(' · ')[0] ?? 'Объект'}
              </strong>
              <button
                type="button"
                aria-label="Закрыть параметры объекта"
                onClick={() => setObjectEditorOpen(false)}
              >
                ×
              </button>
            </div>
            <RobotObjectInspector
              world={world}
              selection={selection}
              running={running}
              onCommit={commit}
              onError={setError}
              onRotate={rotate}
              onDuplicate={duplicate}
              onRemove={remove}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
