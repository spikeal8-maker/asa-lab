import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  createRoboticsBall,
  createRoboticsFloorMark,
  createRoboticsWall,
  createRoboticsWorldDocument,
  createRoboticsWorldState,
  measureRoboticsDistance,
  nextRoboticsObjectId,
  parseRoboticsWorldDocument,
  ROBOTICS_BALL_LIMITS,
  ROBOTICS_FIELD_LIMITS,
  ROBOTICS_FIELD_PRESETS,
  ROBOTICS_SCENE_LIMITS,
  type RoboticsBall,
  type RoboticsDistanceMeasurement,
  type RoboticsFloorMark,
  type RoboticsPoint,
  type RoboticsRectObstacle,
  type RoboticsWorldDocument,
  type RoboticsWorldState,
} from './world';
import { RobotField, type RoboticsObjectKey } from './RobotField';

const TOOLS = [
  { id: 'select', label: 'Выбор', symbol: '↖' },
  { id: 'wall', label: 'Стена', symbol: '▰' },
  { id: 'ball', label: 'Мяч', symbol: '●' },
  { id: 'line', label: 'Линия', symbol: '╱' },
  { id: 'area', label: 'Зона', symbol: '▧' },
] as const;
type Tool = (typeof TOOLS)[number]['id'];
const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const rounded = (value: number) => Math.round(value * 10000) / 10000;

/** A draft may be incomplete while typing; only a complete valid number reaches history. */
export function RoboticsNumberField({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onCommit: (value: number) => boolean;
}) {
  const [draft, setDraft] = useState(String(rounded(value)));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(String(rounded(value)));
    setError(null);
  }, [value]);
  function commit() {
    if (disabled) return;
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setError(`Допустимо от ${rounded(min)} до ${rounded(max)}${unit ? ` ${unit}` : ''}.`);
      return;
    }
    if (Math.abs(parsed - value) < 1e-9) {
      setError(null);
      return;
    }
    if (!onCommit(parsed)) {
      setError('Изменение не принято. Проверьте положение и размеры.');
      return;
    }
    setError(null);
  }
  return (
    <label className="robotics-number-field">
      <span>
        {label}
        {unit ? <small>{unit}</small> : null}
      </span>
      <input
        type="number"
        aria-label={label}
        aria-invalid={Boolean(error)}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(String(rounded(value)));
            setError(null);
          }
        }}
      />
      {error ? (
        <small className="robotics-field-error" role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

function sceneAt(
  world: RoboticsWorldDocument,
  tool: Exclude<Tool, 'select'>,
  position: RoboticsPoint,
) {
  const id = nextRoboticsObjectId(world, tool);
  const field = world.field;
  if (tool === 'wall')
    return {
      key: `wall:${id}` as RoboticsObjectKey,
      world: {
        ...world,
        field: { ...field, obstacles: [...field.obstacles, createRoboticsWall(id, position)] },
      },
    };
  if (tool === 'ball')
    return {
      key: `ball:${id}` as RoboticsObjectKey,
      world: {
        ...world,
        field: { ...field, balls: [...field.balls, createRoboticsBall(id, position)] },
      },
    };
  return {
    key: `mark:${id}` as RoboticsObjectKey,
    world: {
      ...world,
      field: {
        ...field,
        floorMarks: [...field.floorMarks, createRoboticsFloorMark(tool, id, position)],
      },
    },
  };
}

function translated(
  world: RoboticsWorldDocument,
  key: RoboticsObjectKey,
  dx: number,
  dy: number,
): RoboticsWorldDocument {
  const move = <T extends RoboticsPoint>(point: T): T => ({
    ...point,
    xMeters: rounded(point.xMeters + dx),
    yMeters: rounded(point.yMeters + dy),
  });
  if (key === 'robot') return { ...world, initialPose: move(world.initialPose) };
  return {
    ...world,
    field: {
      ...world.field,
      obstacles: world.field.obstacles.map((item) =>
        key === `wall:${item.id}` ? move(item) : item,
      ),
      balls: world.field.balls.map((item) => (key === `ball:${item.id}` ? move(item) : item)),
      floorMarks: world.field.floorMarks.map((item) =>
        key !== `mark:${item.id}`
          ? item
          : item.kind === 'line'
            ? { ...item, start: move(item.start), end: move(item.end) }
            : move(item),
      ),
    },
  };
}

/** Uses the actual SVG transform, including viewBox margins and letterboxing. */
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
}: {
  world: RoboticsWorldDocument;
  state: RoboticsWorldState;
  distance: RoboticsDistanceMeasurement;
  running: boolean;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  onCommit: (world: RoboticsWorldDocument) => boolean;
}) {
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<RoboticsObjectKey | null>(null);
  const [draft, setDraft] = useState<RoboticsWorldDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const drag = useRef<{
    pointerId: number;
    svg: SVGSVGElement;
    start: RoboticsPoint;
    world: RoboticsWorldDocument;
    key: RoboticsObjectKey;
    next: RoboticsWorldDocument;
  } | null>(null);

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
  function add(position?: RoboticsPoint) {
    if (tool === 'select' || running) return;
    if (position) {
      const next = sceneAt(world, tool, position);
      if (commit(next.world)) {
        setSelection(next.key);
        setTool('select');
        setPropertiesOpen(true);
      }
      return;
    }
    // Finite, deterministic placement. Every candidate goes through the same parser.
    const candidates: RoboticsPoint[] = [
      { xMeters: world.field.widthMeters / 2, yMeters: world.field.heightMeters / 2 },
    ];
    for (let y = 0.1; y < world.field.heightMeters; y += 0.1)
      for (let x = 0.1; x < world.field.widthMeters; x += 0.1)
        candidates.push({ xMeters: rounded(x), yMeters: rounded(y) });
    for (const point of candidates) {
      const next = sceneAt(world, tool, point);
      const parsed = parseRoboticsWorldDocument(next.world);
      if (!parsed.ok) continue;
      if (commit(parsed.world)) {
        setSelection(next.key);
        setTool('select');
        setPropertiesOpen(true);
      }
      return;
    }
    setError(
      'Нет свободного места или достигнут лимит предметов. Удалите предмет либо увеличьте поле.',
    );
  }
  function select(key: RoboticsObjectKey) {
    setSelection(key);
    setPropertiesOpen(true);
    setTool('select');
    setError(null);
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (running || event.button !== 0 || !event.isPrimary) return;
    const point = pointerPosition(event, world);
    if (!point) return;
    if (tool !== 'select') {
      event.preventDefault();
      add(point);
      return;
    }
    const target = (event.target as Element).closest('[data-scene-key]');
    const key = target?.getAttribute('data-scene-key') as RoboticsObjectKey | null;
    if (!key) {
      setSelection(null);
      return;
    }
    event.preventDefault();
    setSelection(key);
    setTool('select');
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
    current.next = translated(
      current.world,
      current.key,
      point.xMeters - current.start.xMeters,
      point.yMeters - current.start.yMeters,
    );
    setDraft(current.next);
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = pointerPosition(event, current.world);
    const next = point
      ? translated(
          current.world,
          current.key,
          point.xMeters - current.start.xMeters,
          point.yMeters - current.start.yMeters,
        )
      : current.next;
    releaseDrag();
    if (
      point &&
      Math.hypot(point.xMeters - current.start.xMeters, point.yMeters - current.start.yMeters) <
        0.003
    )
      setPropertiesOpen(true);
    if (current.world === world && next !== current.world) commit(next);
  }
  function remove() {
    if (running || !selection || selection === 'robot') return;
    if (
      commit({
        ...world,
        field: {
          ...world.field,
          obstacles: world.field.obstacles.filter((item) => selection !== `wall:${item.id}`),
          balls: world.field.balls.filter((item) => selection !== `ball:${item.id}`),
          floorMarks: world.field.floorMarks.filter((item) => selection !== `mark:${item.id}`),
        },
      })
    ) {
      setSelection(null);
      setPropertiesOpen(false);
    }
  }
  const wall = world.field.obstacles.find((item) => selection === `wall:${item.id}`);
  const ball = world.field.balls.find((item) => selection === `ball:${item.id}`);
  const mark = world.field.floorMarks.find((item) => selection === `mark:${item.id}`);
  const selected = wall ?? ball ?? mark;
  const patchWall = (patch: Partial<RoboticsRectObstacle>) =>
    commit({
      ...world,
      field: {
        ...world.field,
        obstacles: world.field.obstacles.map((item) =>
          item === wall ? { ...item, ...patch } : item,
        ),
      },
    });
  const patchBall = (patch: Partial<RoboticsBall>) =>
    commit({
      ...world,
      field: {
        ...world.field,
        balls: world.field.balls.map((item) => (item === ball ? { ...item, ...patch } : item)),
      },
    });
  const patchMark = (next: RoboticsFloorMark) =>
    commit({
      ...world,
      field: {
        ...world.field,
        floorMarks: world.field.floorMarks.map((item) => (item === mark ? next : item)),
      },
    });
  const scene = draft ?? world;
  const previewState = draft ? createRoboticsWorldState(draft) : state;
  const previewDistance = draft
    ? measureRoboticsDistance(draft, draft.initialPose, previewState.balls)
    : distance;
  const preset = ROBOTICS_FIELD_PRESETS.find(
    (item) =>
      item.widthMeters === world.field.widthMeters &&
      item.heightMeters === world.field.heightMeters,
  );
  const maxed =
    tool === 'wall'
      ? world.field.obstacles.length >= ROBOTICS_SCENE_LIMITS.walls
      : tool === 'ball'
        ? world.field.balls.length >= ROBOTICS_SCENE_LIMITS.balls
        : tool === 'line' || tool === 'area'
          ? world.field.floorMarks.length >= ROBOTICS_SCENE_LIMITS.floorMarks
          : false;
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
    ...world.field.floorMarks.map((item) => ({
      key: `mark:${item.id}` as const,
      label: `${item.label ?? (item.kind === 'line' ? 'Линия' : 'Зона')} · ${item.id}`,
    })),
  ];
  const numeric = (
    label: string,
    value: number,
    min: number,
    max: number,
    update: (value: number) => boolean,
    step = 0.01,
    unit = 'м',
  ) => (
    <RoboticsNumberField
      key={`${selection}:${label}`}
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      disabled={running}
      onCommit={update}
    />
  );

  return (
    <>
      <div className="robotics-panel-toolbar">
        <h2>Поле</h2>
        <label className="robotics-grid-toggle">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(event) => onShowGridChange(event.target.checked)}
          />
          Сетка
        </label>
        <button
          type="button"
          className="robotics-button robotics-properties-toggle"
          aria-expanded={propertiesOpen}
          onClick={() => setPropertiesOpen((value) => !value)}
        >
          Свойства
        </button>
      </div>
      <div className="robotics-field-tools" role="toolbar" aria-label="Инструменты поля">
        {TOOLS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={tool === item.id}
            disabled={running}
            onClick={() => {
              setTool(item.id);
              setError(null);
            }}
          >
            <span aria-hidden="true">{item.symbol}</span>
            {item.label}
          </button>
        ))}
      </div>
      {running ? (
        <p className="robotics-edit-hint">Остановите моделирование, чтобы изменить поле.</p>
      ) : tool !== 'select' ? (
        <div className="robotics-placement-hint">
          <span>
            {maxed ? 'Достигнут лимит предметов этого типа.' : 'Нажмите на поле для размещения.'}
          </span>
          <button type="button" disabled={maxed} onClick={() => add()}>
            Добавить в свободное место
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="robotics-field-error robotics-scene-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="robotics-field-editor-body" data-properties-open={propertiesOpen}>
        <div
          className="robotics-field-canvas"
          tabIndex={0}
          role="group"
          aria-label="Полотно поля"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              releaseDrag();
              setTool('select');
            }
            if (
              (event.key === 'Delete' || event.key === 'Backspace') &&
              event.target === event.currentTarget
            ) {
              event.preventDefault();
              remove();
            }
          }}
        >
          <RobotField
            world={scene}
            state={previewState}
            distance={previewDistance}
            showGrid={showGrid}
            selection={selection}
            editable={!running}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={releaseDrag}
            onLostPointerCapture={releaseDrag}
          />
        </div>
        <aside className="robotics-scene-inspector" aria-label="Свойства поля и предмета">
          <details className="robotics-settings-group" open>
            <summary>Размеры и учебная сцена</summary>
            <label className="robotics-select-field">
              Учебная сцена
              <select
                aria-label="Учебная сцена"
                value={preset?.id ?? ''}
                disabled={running}
                onChange={(event) => {
                  const selectedPreset = ROBOTICS_FIELD_PRESETS.find(
                    (item) => item.id === event.target.value,
                  );
                  if (
                    !selectedPreset ||
                    !window.confirm(
                      'Заменить предметы и старт робота учебной сценой? Схема, программа и назначение компонентов сохранятся.',
                    )
                  )
                    return;
                  const next = createRoboticsWorldDocument(selectedPreset.id);
                  if (commit({ ...world, field: next.field, initialPose: next.initialPose }))
                    setSelection(null);
                }}
              >
                {!preset ? <option value="">Свой размер</option> : null}
                {ROBOTICS_FIELD_PRESETS.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="robotics-form-grid">
              {(['widthMeters', 'heightMeters', 'gridMeters'] as const).map((property, index) => (
                <RoboticsNumberField
                  key={property}
                  label={['Ширина поля', 'Высота поля', 'Шаг сетки'][index]!}
                  unit="м"
                  value={world.field[property]}
                  {...ROBOTICS_FIELD_LIMITS[property]}
                  disabled={running}
                  onCommit={(value) =>
                    commit({ ...world, field: { ...world.field, [property]: value } })
                  }
                />
              ))}
            </div>
          </details>
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
          {selection === 'robot' ? (
            <section className="robotics-settings-group">
              <h3>Старт робота</h3>
              <div className="robotics-form-grid">
                {numeric(
                  'Старт X',
                  world.initialPose.xMeters,
                  0,
                  world.field.widthMeters,
                  (value) =>
                    commit({ ...world, initialPose: { ...world.initialPose, xMeters: value } }),
                )}
                {numeric(
                  'Старт Y',
                  world.initialPose.yMeters,
                  0,
                  world.field.heightMeters,
                  (value) =>
                    commit({ ...world, initialPose: { ...world.initialPose, yMeters: value } }),
                )}
                {numeric(
                  'Направление робота',
                  degrees(world.initialPose.headingRadians),
                  -180,
                  180,
                  (value) =>
                    commit({
                      ...world,
                      initialPose: { ...world.initialPose, headingRadians: radians(value) },
                    }),
                  1,
                  '°',
                )}
              </div>
            </section>
          ) : null}
          {selected ? (
            <section className="robotics-settings-group" key={selection}>
              <h3>{selected.label ?? selected.id}</h3>
              <label className="robotics-select-field">
                Название
                <input
                  key={`${selected.id}:${selected.label ?? selected.id}`}
                  aria-label="Название предмета"
                  type="text"
                  maxLength={80}
                  disabled={running}
                  defaultValue={selected.label ?? selected.id}
                  onBlur={(event) => {
                    const label = event.target.value.trim();
                    const accepted = wall
                      ? patchWall({ label })
                      : ball
                        ? patchBall({ label })
                        : mark
                          ? patchMark({ ...mark, label })
                          : false;
                    if (!accepted) event.target.value = selected.label ?? selected.id;
                  }}
                />
              </label>
              <div className="robotics-form-grid">
                {wall ? (
                  <>
                    {numeric(
                      'X стены',
                      wall.xMeters,
                      -Math.hypot(world.field.widthMeters, world.field.heightMeters),
                      world.field.widthMeters,
                      (value) => patchWall({ xMeters: value }),
                    )}
                    {numeric(
                      'Y стены',
                      wall.yMeters,
                      -Math.hypot(world.field.widthMeters, world.field.heightMeters),
                      world.field.heightMeters,
                      (value) => patchWall({ yMeters: value }),
                    )}
                    {numeric(
                      'Длина стены',
                      wall.widthMeters,
                      0.02,
                      Math.hypot(world.field.widthMeters, world.field.heightMeters),
                      (value) => patchWall({ widthMeters: value }),
                    )}
                    {numeric(
                      'Толщина стены',
                      wall.heightMeters,
                      0.02,
                      Math.hypot(world.field.widthMeters, world.field.heightMeters),
                      (value) => patchWall({ heightMeters: value }),
                    )}
                    {numeric(
                      'Угол стены',
                      degrees(wall.headingRadians ?? 0),
                      -180,
                      180,
                      (value) => patchWall({ headingRadians: radians(value) }),
                      1,
                      '°',
                    )}
                  </>
                ) : null}
                {ball ? (
                  <>
                    {numeric('X мяча', ball.xMeters, 0, world.field.widthMeters, (value) =>
                      patchBall({ xMeters: value }),
                    )}
                    {numeric('Y мяча', ball.yMeters, 0, world.field.heightMeters, (value) =>
                      patchBall({ yMeters: value }),
                    )}
                    {numeric(
                      'Диаметр мяча',
                      ball.radiusMeters * 2,
                      ROBOTICS_BALL_LIMITS.radiusMeters.min * 2,
                      ROBOTICS_BALL_LIMITS.radiusMeters.max * 2,
                      (value) => patchBall({ radiusMeters: value / 2 }),
                    )}
                  </>
                ) : null}
                {mark?.kind === 'line' ? (
                  <>
                    {numeric(
                      'Начало линии X',
                      mark.start.xMeters,
                      0,
                      world.field.widthMeters,
                      (value) => patchMark({ ...mark, start: { ...mark.start, xMeters: value } }),
                    )}
                    {numeric(
                      'Начало линии Y',
                      mark.start.yMeters,
                      0,
                      world.field.heightMeters,
                      (value) => patchMark({ ...mark, start: { ...mark.start, yMeters: value } }),
                    )}
                    {numeric(
                      'Конец линии X',
                      mark.end.xMeters,
                      0,
                      world.field.widthMeters,
                      (value) => patchMark({ ...mark, end: { ...mark.end, xMeters: value } }),
                    )}
                    {numeric(
                      'Конец линии Y',
                      mark.end.yMeters,
                      0,
                      world.field.heightMeters,
                      (value) => patchMark({ ...mark, end: { ...mark.end, yMeters: value } }),
                    )}
                    {numeric(
                      'Толщина линии',
                      mark.widthMeters,
                      0.005,
                      0.2,
                      (value) => patchMark({ ...mark, widthMeters: value }),
                      0.005,
                    )}
                  </>
                ) : null}
                {mark?.kind === 'area' ? (
                  <>
                    {numeric('X зоны', mark.xMeters, 0, world.field.widthMeters, (value) =>
                      patchMark({ ...mark, xMeters: value }),
                    )}
                    {numeric('Y зоны', mark.yMeters, 0, world.field.heightMeters, (value) =>
                      patchMark({ ...mark, yMeters: value }),
                    )}
                    {numeric(
                      'Ширина зоны',
                      mark.widthMeters,
                      0.02,
                      world.field.widthMeters,
                      (value) => patchMark({ ...mark, widthMeters: value }),
                    )}
                    {numeric(
                      'Высота зоны',
                      mark.heightMeters,
                      0.02,
                      world.field.heightMeters,
                      (value) => patchMark({ ...mark, heightMeters: value }),
                    )}
                  </>
                ) : null}
                {mark ? (
                  <label className="robotics-number-field">
                    <span>Цвет разметки</span>
                    <input
                      aria-label="Цвет разметки"
                      type="color"
                      value={mark.color}
                      disabled={running}
                      onChange={(event) => patchMark({ ...mark, color: event.target.value })}
                    />
                  </label>
                ) : null}
              </div>
              {ball ? (
                <details className="robotics-settings-group">
                  <summary>Физика мяча</summary>
                  <div className="robotics-form-grid">
                    {numeric(
                      'Масса мяча',
                      ball.massKg,
                      ROBOTICS_BALL_LIMITS.massKg.min,
                      ROBOTICS_BALL_LIMITS.massKg.max,
                      (value) => patchBall({ massKg: value }),
                      0.01,
                      'кг',
                    )}
                    {numeric(
                      'Трение скольжения по полу',
                      ball.frictionCoefficient,
                      0,
                      1,
                      (value) => patchBall({ frictionCoefficient: value }),
                      0.01,
                      '',
                    )}
                    {numeric(
                      'Упругость мяча',
                      ball.restitution,
                      0,
                      1,
                      (value) => patchBall({ restitution: value }),
                      0.05,
                      '',
                    )}
                  </div>
                  <p className="robotics-help">
                    Масса влияет на столкновения мячей друг с другом. Движение робота задано
                    моторами; обратная нагрузка на них пока не рассчитывается. Мяч скользит по
                    плоскости, без расчёта вращения.
                  </p>
                </details>
              ) : null}
              {mark ? (
                <p className="robotics-help">
                  Разметка пола: без столкновений и сигнала датчика цвета.
                </p>
              ) : null}
              <button
                type="button"
                className="robotics-button danger"
                disabled={running}
                onClick={remove}
              >
                Удалить предмет
              </button>
            </section>
          ) : (
            <p className="robotics-help robotics-selection-hint">
              Выберите предмет на поле или в списке. Перетаскивание — один шаг истории.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
