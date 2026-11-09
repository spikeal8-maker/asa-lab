import { useEffect, useRef, useState, type PointerEvent } from 'react';
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
import { RobotFieldSettings } from './RobotFieldSettings';
import { RobotObjectInspector } from './RobotObjectInspector';

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
] as const;
type Tool = (typeof TOOLS)[number]['id'];
const STAMPS: readonly { id: RoboticsTileStampKind; label: string }[] = [
  { id: 'straight', label: 'Прямая' },
  { id: 'turn', label: 'Поворот' },
  { id: 't-junction', label: 'Т-развилка' },
  { id: 'cross', label: 'Перекрёсток' },
];
const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3] as const;
const rounded = (value: number) => Math.round(value * 10000) / 10000;

function sceneAt(
  world: RoboticsWorldDocument,
  tool: Exclude<Tool, 'select'>,
  position: RoboticsPoint,
  stamp: RoboticsTileStampKind,
  turns: number,
): { key: RoboticsObjectKey; world: RoboticsWorldDocument } {
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

/** SVG's own transform handles zoom, scrolling, margins and letterboxing. */
function pointerPosition(
  event: PointerEvent<SVGSVGElement>,
  world: RoboticsWorldDocument,
): RoboticsPoint | null {
  const matrix = event.currentTarget.getScreenCTM();
  if (!matrix) return null;
  const point = event.currentTarget.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  return {
    xMeters: rounded(local.x / 1000),
    yMeters: rounded(world.field.heightMeters - local.y / 1000),
  };
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
}) {
  const [tool, setTool] = useState<Tool>('select');
  const [stamp, setStamp] = useState<RoboticsTileStampKind>('straight');
  const [turns, setTurns] = useState(0);
  const [selection, setSelection] = useState<RoboticsObjectKey | null>(null);
  const [draft, setDraft] = useState<RoboticsWorldDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [snap, setSnap] = useState(false);
  const [pan, setPan] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const propertiesButton = useRef<HTMLButtonElement>(null);
  const inspectorObject = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    svg: SVGSVGElement;
    start: RoboticsPoint;
    world: RoboticsWorldDocument;
    key: RoboticsObjectKey;
    next: RoboticsWorldDocument;
  } | null>(null);
  const extended = isRoboticsWorldV3(world);
  const zoom = ZOOM_LEVELS[zoomIndex]!;
  const selectedTool = TOOLS.find((item) => item.id === tool)!;

  function releaseDrag() {
    const current = drag.current;
    drag.current = null;
    if (current?.svg.hasPointerCapture?.(current.pointerId))
      current.svg.releasePointerCapture(current.pointerId);
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
  function select(key: RoboticsObjectKey) {
    setSelection(canonicalRoboticsObjectKey(world, key));
    setPropertiesOpen(true);
    setTool('select');
    setPan(false);
    setError(null);
  }
  function selectAdded(key: RoboticsObjectKey) {
    setSelection(key);
    setPropertiesOpen(true);
    setTool('select');
    setPan(false);
    requestAnimationFrame(() => inspectorObject.current?.scrollIntoView({ block: 'nearest' }));
  }
  const dynamicCount = world.field.balls.length + (world.field.bodies?.length ?? 0);
  const maxed =
    tool === 'wall'
      ? world.field.obstacles.length >= ROBOTICS_SCENE_LIMITS.walls
      : tool === 'ball' || tool === 'can' || tool === 'box'
        ? dynamicCount >= ROBOTICS_SCENE_LIMITS.dynamicBodies
        : tool !== 'select'
          ? world.field.floorMarks.length +
              (tool === 'stamp' && (stamp === 'cross' || stamp === 't-junction') ? 2 : 1) >
            ROBOTICS_SCENE_LIMITS.floorMarks
          : false;
  function add(position?: RoboticsPoint) {
    if (tool === 'select' || running || maxed || (selectedTool.extended && !extended)) return;
    if (position) {
      try {
        const point =
          snap && tool !== 'stamp'
            ? {
                xMeters: rounded(
                  Math.round(position.xMeters / world.field.gridMeters) * world.field.gridMeters,
                ),
                yMeters: rounded(
                  Math.round(position.yMeters / world.field.gridMeters) * world.field.gridMeters,
                ),
              }
            : position;
        const next = sceneAt(world, tool, point, stamp, turns);
        if (commit(next.world)) selectAdded(next.key);
      } catch (error) {
        fail(error);
      }
      return;
    }
    const step = tool === 'stamp' ? (world.field.tiles?.sizeMeters ?? 0.3) : 0.1;
    const candidates: RoboticsPoint[] =
      tool === 'stamp'
        ? []
        : [{ xMeters: world.field.widthMeters / 2, yMeters: world.field.heightMeters / 2 }];
    for (let y = tool === 'stamp' ? 0 : step; y < world.field.heightMeters; y += step)
      for (let x = tool === 'stamp' ? 0 : step; x < world.field.widthMeters; x += step)
        candidates.push({ xMeters: rounded(x), yMeters: rounded(y) });
    for (const point of candidates) {
      try {
        const next = sceneAt(world, tool, point, stamp, turns);
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
    if (running || pan || event.button !== 0 || !event.isPrimary) return;
    const point = pointerPosition(event, world);
    if (!point) return;
    if (tool !== 'select') {
      event.preventDefault();
      add(point);
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
    setPropertiesOpen(false);
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
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || running) return;
    const point = pointerPosition(event, current.world);
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
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = pointerPosition(event, current.world);
    releaseDrag();
    if (current.world !== world || running) return;
    if (
      point &&
      Math.hypot(point.xMeters - current.start.xMeters, point.yMeters - current.start.yMeters) <
        0.003
    ) {
      setPropertiesOpen(true);
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
        setPropertiesOpen(false);
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
    setZoomIndex(0);
    if (canvasRef.current) {
      canvasRef.current.scrollTop = 0;
      canvasRef.current.scrollLeft = 0;
    }
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
      <div className="robotics-field-tools" role="toolbar" aria-label="Инструменты поля">
        {TOOLS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={tool === item.id && !pan}
            disabled={running || (item.extended && !extended)}
            title={
              item.extended && !extended
                ? 'Сначала включите расширенное поле в свойствах'
                : undefined
            }
            onClick={() => {
              setTool(item.id);
              setPan(false);
              setError(null);
            }}
          >
            <span aria-hidden="true">{item.symbol}</span>
            {item.label}
          </button>
        ))}
        <button
          ref={propertiesButton}
          type="button"
          className="robotics-button robotics-properties-toggle"
          aria-expanded={propertiesOpen}
          onClick={() => setPropertiesOpen((value) => !value)}
        >
          Свойства
        </button>
      </div>
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
        <div className="robotics-field-history" role="group" aria-label="История изменений поля">
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
        <output
          className="robotics-field-elapsed"
          aria-label="Время опыта"
          data-microseconds={state.atMicroseconds}
          title="Время текущего опыта (не более 40 секунд)"
        >
          Время:{' '}
          {(state.atMicroseconds / 1_000_000).toLocaleString('ru-RU', {
            maximumFractionDigits: 1,
            minimumFractionDigits: 1,
          })}{' '}
          с
        </output>
        <div className="robotics-field-zoom">
          <button
            type="button"
            aria-label="Отдалить поле"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((value) => Math.max(0, value - 1))}
          >
            −
          </button>
          <output aria-label="Масштаб поля">{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            aria-label="Приблизить поле"
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            onClick={() => setZoomIndex((value) => Math.min(ZOOM_LEVELS.length - 1, value + 1))}
          >
            +
          </button>
          <button type="button" aria-label="Показать поле целиком" onClick={fit}>
            Всё
          </button>
        </div>
      </div>
      {!running && tool === 'stamp' ? (
        <div className="robotics-stamp-tools">
          <label>
            Плитка трассы
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
          </label>
          <button
            type="button"
            onClick={() => setTurns((value) => (value + 1) % 4)}
            aria-label="Повернуть шаблон на 90 градусов"
          >
            ↻ {turns * 90}°
          </button>
        </div>
      ) : null}
      {running ? (
        <p className="robotics-edit-hint">Остановите моделирование, чтобы изменить поле.</p>
      ) : tool !== 'select' ? (
        <div className="robotics-placement-hint">
          <span>
            {maxed
              ? 'Достигнут лимит предметов этого типа.'
              : tool === 'stamp'
                ? 'Нажмите на плитку. Весь штамп — один предмет.'
                : 'Нажмите на поле для размещения.'}
          </span>
          <button type="button" disabled={maxed} onClick={() => add()}>
            Добавить в свободное место
          </button>
        </div>
      ) : pan ? (
        <p className="robotics-edit-hint">
          Перемещайте увеличенное поле прокруткой. «Всё» вернёт полный вид.
        </p>
      ) : null}
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
          data-pan={pan}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Escape') {
              releaseDrag();
              setTool('select');
              setPan(false);
            }
            if (event.key === 'Home') {
              event.preventDefault();
              fit();
            }
            if (event.key === '+' || event.key === '=') {
              event.preventDefault();
              setZoomIndex((value) => Math.min(ZOOM_LEVELS.length - 1, value + 1));
            }
            if (event.key === '-') {
              event.preventDefault();
              setZoomIndex((value) => Math.max(0, value - 1));
            }
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              remove();
            }
          }}
        >
          <div
            className="robotics-field-zoom-surface"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <RobotField
              world={scene}
              state={previewState}
              distance={previewDistance}
              showGrid={showGrid}
              selection={selection}
              editable={!running && !pan}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={releaseDrag}
              onLostPointerCapture={releaseDrag}
            />
          </div>
        </div>
        <aside
          className="robotics-scene-inspector"
          aria-label="Свойства поля и предмета"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && propertiesButton.current?.getClientRects().length) {
              event.stopPropagation();
              closeProperties();
            }
          }}
        >
          <div className="robotics-inspector-heading">
            <strong>Свойства поля</strong>
            <button type="button" className="robotics-button" onClick={closeProperties}>
              Закрыть свойства
            </button>
          </div>
          <RobotFieldSettings
            world={world}
            running={running}
            sourceSchemaVersion={sourceSchemaVersion}
            onUpgradeField={onUpgradeField}
            onCommit={commit}
            onError={setError}
            onPresetApplied={() => setSelection(null)}
          />
          <h3 className="robotics-object-list-heading">
            Предметы <span>{objects.length - 1}</span>
          </h3>
          <div className="robotics-object-list" aria-label="Объекты поля">
            {objects.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={selection === item.key}
                onClick={() => select(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div ref={inspectorObject}>
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
        </aside>
      </div>
    </>
  );
}
