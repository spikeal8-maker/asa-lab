import {
  isRoboticsWorldV3,
  ROBOTICS_BALL_LIMITS,
  ROBOTICS_BODY_LIMITS,
  type RoboticsBall,
  type RoboticsBody,
  type RoboticsFloorMark,
  type RoboticsFieldDecoration,
  type RoboticsObjectKey,
  type RoboticsRectObstacle,
  type RoboticsWorldDocument,
} from '@asa-lab/robotics/world-document';
import { translateRoboticsObject } from '@asa-lab/robotics/world-authoring';
import { RoboticsNumberField } from './RoboticsNumberField';
import {
  BALL_PRESETS,
  CAN_PRESETS,
  CAN_FILL_PRESETS,
  CUBE_PRESETS,
  applyBallPreset,
  applyCanPreset,
  applyCubePreset,
  type BallPresetId,
  type CanPresetId,
  type CanFillId,
  type CubePresetId,
} from './field-object-presets';

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function RobotObjectInspector({
  world,
  selection,
  running,
  onCommit,
  onError,
  onRotate,
  onDuplicate,
  onRemove,
}: {
  world: RoboticsWorldDocument;
  selection: RoboticsObjectKey | null;
  running: boolean;
  onCommit: (world: RoboticsWorldDocument) => boolean;
  onError: (message: string) => void;
  onRotate: (angle: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const wall = world.field.obstacles.find((item) => selection === `wall:${item.id}`);
  const ball = world.field.balls.find((item) => selection === `ball:${item.id}`);
  const body = world.field.bodies?.find((item) => selection === `body:${item.id}`);
  const marks = world.field.floorMarks.filter(
    (item) =>
      selection === `mark:${item.id}` ||
      (item.groupId && selection === `mark-group:${item.groupId}`),
  );
  const mark = marks[0];
  const decoration = world.field.visuals?.find((item) => selection === `decoration:${item.id}`);
  const grouped = !!mark?.groupId;
  const selected = wall ?? ball ?? body ?? mark ?? decoration;
  const patchWall = (patch: Partial<RoboticsRectObstacle>) =>
    onCommit({
      ...world,
      field: {
        ...world.field,
        obstacles: world.field.obstacles.map((item) =>
          item === wall ? { ...item, ...patch } : item,
        ),
      },
    });
  const patchBall = (patch: Partial<RoboticsBall>) =>
    onCommit({
      ...world,
      field: {
        ...world.field,
        balls: world.field.balls.map((item) => (item === ball ? { ...item, ...patch } : item)),
      },
    });
  const patchBody = (next: RoboticsBody) =>
    onCommit({
      ...world,
      field: {
        ...world.field,
        bodies: world.field.bodies!.map((item) => (item === body ? next : item)),
      },
    });
  const patchDecoration = (patch: Partial<RoboticsFieldDecoration>) =>
    onCommit({
      ...world,
      field: {
        ...world.field,
        visuals: (world.field.visuals ?? []).map((item) =>
          item === decoration ? { ...item, ...patch } : item,
        ),
      },
    });
  const patchMark = (next: RoboticsFloorMark) =>
    onCommit({
      ...world,
      field: {
        ...world.field,
        floorMarks: world.field.floorMarks.map((item) => (item === mark ? next : item)),
      },
    });
  const patchMarks = (patch: { label?: string; color?: string; widthMeters?: number }) =>
    onCommit({
      ...world,
      field: {
        ...world.field,
        floorMarks: world.field.floorMarks.map((item) =>
          marks.includes(item) ? { ...item, ...patch } : item,
        ),
      },
    });
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
      onValidationReset={() => onError('')}
    />
  );
  function moveGroup(axis: 'xMeters' | 'yMeters', value: number) {
    if (!mark?.groupPivot || !selection) return false;
    try {
      return onCommit(
        translateRoboticsObject(
          world,
          selection,
          axis === 'xMeters' ? value - mark.groupPivot.xMeters : 0,
          axis === 'yMeters' ? value - mark.groupPivot.yMeters : 0,
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Штамп выходит за границы поля.');
      return false;
    }
  }
  const ballPreset = ball
    ? BALL_PRESETS.find(
        (item) =>
          Math.abs(item.radiusMeters - ball.radiusMeters) < 0.0005 &&
          Math.abs(item.massKg - ball.massKg) < 0.003,
      )
    : undefined;
  const canPreset =
    body?.kind === 'can'
      ? CAN_PRESETS.find(
          (item) =>
            Math.abs(item.radiusMeters - body.radiusMeters) < 0.001 &&
            Math.abs(item.heightMeters - body.heightMeters) < 0.005,
        )
      : undefined;
  const canFill =
    body?.kind === 'can' && canPreset
      ? CAN_FILL_PRESETS.find(
          (item) =>
            Math.abs(body.massKg - (canPreset.shellKg + canPreset.volumeLiters * item.fraction)) <
            0.005,
        )
      : undefined;
  const cubePreset =
    body?.kind === 'box'
      ? CUBE_PRESETS.find(
          (item) =>
            Math.abs(item.sideMeters - body.widthMeters) < 0.001 &&
            Math.abs(item.sideMeters - body.depthMeters) < 0.001 &&
            Math.abs(item.sideMeters - body.heightMeters) < 0.001,
        )
      : undefined;

  if (selection === 'robot')
    return (
      <section className="robotics-settings-group" data-testid="robotics-object-inspector">
        <h3>Старт робота</h3>
        <div className="robotics-form-grid">
          {numeric('Старт X', world.initialPose.xMeters, 0, world.field.widthMeters, (value) =>
            onCommit({ ...world, initialPose: { ...world.initialPose, xMeters: value } }),
          )}
          {numeric('Старт Y', world.initialPose.yMeters, 0, world.field.heightMeters, (value) =>
            onCommit({ ...world, initialPose: { ...world.initialPose, yMeters: value } }),
          )}
          {numeric(
            'Направление робота',
            degrees(world.initialPose.headingRadians),
            -180,
            180,
            (value) =>
              onCommit({
                ...world,
                initialPose: { ...world.initialPose, headingRadians: radians(value) },
              }),
            1,
            '°',
          )}
        </div>
        <p className="robotics-help">
          Сохраняется старт, а не положение после запуска. Конструкция и крепления — в разделе
          «Робот».
        </p>
      </section>
    );
  if (!selected)
    return (
      <p className="robotics-help robotics-selection-hint">
        Выберите предмет на поле или в списке. Перетаскивание — один шаг истории.
      </p>
    );

  return (
    <section
      className="robotics-settings-group robotics-object-inspector"
      key={selection}
      data-testid="robotics-object-inspector"
    >
      <h3>{selected.label ?? selected.id}</h3>
      {ball || body ? (
        <p className="robotics-object-dimensions">
          {ball
            ? `Мяч · Ø ${Math.round(ball.radiusMeters * 2000)} мм · ${Math.round(ball.massKg * 1000)} г`
            : body?.kind === 'can'
              ? `Банка · Ø ${Math.round(body.radiusMeters * 2000)} × ${Math.round(body.heightMeters * 1000)} мм · ${Math.round(body.massKg * 1000)} г`
              : body?.kind === 'box'
                ? `Брусок · ${Math.round(body.widthMeters * 1000)} × ${Math.round(body.depthMeters * 1000)} × ${Math.round(body.heightMeters * 1000)} мм · ${Math.round(body.massKg * 1000)} г`
                : ''}
        </p>
      ) : null}
      {ball ? (
        <label className="robotics-select-field robotics-object-preset">
          Размер мяча
          <select
            aria-label="Тип мяча"
            disabled={running}
            value={ballPreset?.id ?? ''}
            onChange={(event) => {
              const next = applyBallPreset(ball, event.target.value as BallPresetId);
              patchBall({ radiusMeters: next.radiusMeters, massKg: next.massKg });
            }}
          >
            <option value="">Свой диаметр и масса</option>
            {BALL_PRESETS.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {body?.kind === 'can' ? (
        <div className="robotics-object-preset-row">
          <label className="robotics-select-field">
            Размер банки
            <select
              aria-label="Объём банки"
              disabled={running}
              value={canPreset?.id ?? ''}
              onChange={(event) => {
                const next = applyCanPreset(
                  body,
                  event.target.value as CanPresetId,
                  canFill?.id ?? 'empty',
                );
                patchBody(next);
              }}
            >
              <option value="">Свой размер</option>
              {CAN_PRESETS.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="robotics-select-field">
            Наполнение
            <select
              aria-label="Наполнение банки"
              disabled={running}
              value={canFill?.id ?? ''}
              onChange={(event) => {
                const next = applyCanPreset(
                  body,
                  canPreset?.id ?? '330',
                  event.target.value as CanFillId,
                );
                patchBody(next);
              }}
            >
              <option value="">Своя масса</option>
              {CAN_FILL_PRESETS.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {body?.kind === 'box' ? (
        <label className="robotics-select-field robotics-object-preset">
          Размер кубика
          <select
            aria-label="Размер кубика"
            disabled={running}
            value={cubePreset?.id ?? ''}
            onChange={(event) =>
              patchBody(applyCubePreset(body, event.target.value as CubePresetId))
            }
          >
            <option value="">Свой размер</option>
            {CUBE_PRESETS.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
                : body
                  ? patchBody({ ...body, label })
                  : decoration
                    ? patchDecoration({ label })
                    : patchMarks({ label });
            if (!accepted) event.target.value = selected.label ?? selected.id;
          }}
        />
      </label>
      {grouped ? (
        <p className="robotics-help">
          Цельный штамп трассы: {marks.length} {marks.length === 1 ? 'линия' : 'линии'}. Поворот,
          перенос и удаление действуют на весь штамп.
        </p>
      ) : null}
      <div className="robotics-form-grid">
        {decoration ? (
          <>
            {numeric('X на поле', decoration.xMeters, 0, world.field.widthMeters, (value) =>
              patchDecoration({ xMeters: value }),
            )}
            {numeric('Y на поле', decoration.yMeters, 0, world.field.heightMeters, (value) =>
              patchDecoration({ yMeters: value }),
            )}
            {numeric(
              decoration.kind === 'circle' ? 'Диаметр круга' : 'Ширина элемента',
              decoration.widthMeters,
              0.02,
              world.field.widthMeters,
              (value) =>
                patchDecoration(
                  decoration.kind === 'circle'
                    ? { widthMeters: value, heightMeters: value }
                    : { widthMeters: value },
                ),
            )}
            {decoration.kind !== 'circle'
              ? numeric(
                  decoration.kind === 'text' ? 'Высота текста' : 'Высота элемента',
                  decoration.heightMeters,
                  0.02,
                  world.field.heightMeters,
                  (value) => patchDecoration({ heightMeters: value }),
                )
              : null}
            <label className="robotics-number-field">
              <span>Цвет контура</span>
              <input
                aria-label="Цвет контура"
                type="color"
                value={decoration.strokeColor}
                disabled={running}
                onChange={(event) => patchDecoration({ strokeColor: event.target.value })}
              />
            </label>
            {decoration.kind === 'rectangle' || decoration.kind === 'circle' ? (
              <>
                <label className="robotics-grid-toggle">
                  <input
                    type="checkbox"
                    aria-label="Заливка фигуры"
                    disabled={running}
                    checked={decoration.fillEnabled}
                    onChange={(event) => patchDecoration({ fillEnabled: event.target.checked })}
                  />
                  Заливка
                </label>
                <label className="robotics-number-field">
                  <span>Цвет заливки</span>
                  <input
                    type="color"
                    aria-label="Цвет заливки"
                    value={decoration.fillColor}
                    disabled={running || !decoration.fillEnabled}
                    onChange={(event) => patchDecoration({ fillColor: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            {decoration.kind === 'text' ? (
              <label className="robotics-select-field robotics-visual-text">
                Текст
                <input
                  type="text"
                  maxLength={120}
                  aria-label="Надпись на поле"
                  key={decoration.id + decoration.text}
                  defaultValue={decoration.text ?? ''}
                  disabled={running}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value) patchDecoration({ text: value });
                  }}
                />
              </label>
            ) : null}
          </>
        ) : null}
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
        {body ? (
          <>
            {numeric(
              body.kind === 'can' ? 'X банки' : 'X бруска',
              body.xMeters,
              0,
              world.field.widthMeters,
              (value) => patchBody({ ...body, xMeters: value }),
            )}
            {numeric(
              body.kind === 'can' ? 'Y банки' : 'Y бруска',
              body.yMeters,
              0,
              world.field.heightMeters,
              (value) => patchBody({ ...body, yMeters: value }),
            )}
            {body.kind === 'can' ? (
              numeric(
                'Диаметр банки',
                body.radiusMeters * 2,
                ROBOTICS_BODY_LIMITS.radiusMeters.min * 2,
                ROBOTICS_BODY_LIMITS.radiusMeters.max * 2,
                (value) => patchBody({ ...body, radiusMeters: value / 2 }),
              )
            ) : (
              <>
                {numeric(
                  'Длина бруска',
                  body.widthMeters,
                  ROBOTICS_BODY_LIMITS.widthMeters.min,
                  ROBOTICS_BODY_LIMITS.widthMeters.max,
                  (value) => patchBody({ ...body, widthMeters: value }),
                )}
                {numeric(
                  'Ширина бруска',
                  body.depthMeters,
                  ROBOTICS_BODY_LIMITS.depthMeters.min,
                  ROBOTICS_BODY_LIMITS.depthMeters.max,
                  (value) => patchBody({ ...body, depthMeters: value }),
                )}
              </>
            )}
            {numeric(
              body.kind === 'can' ? 'Высота банки' : 'Высота бруска',
              body.heightMeters,
              ROBOTICS_BODY_LIMITS.heightMeters.min,
              ROBOTICS_BODY_LIMITS.heightMeters.max,
              (value) => patchBody({ ...body, heightMeters: value }),
            )}
            {numeric(
              'Угол предмета',
              degrees(body.headingRadians),
              -180,
              180,
              (value) => patchBody({ ...body, headingRadians: radians(value) }),
              1,
              '°',
            )}
          </>
        ) : null}
        {grouped && mark?.groupPivot ? (
          <>
            {numeric(
              'Центр штампа X',
              mark.groupPivot.xMeters,
              0,
              world.field.widthMeters,
              (value) => moveGroup('xMeters', value),
            )}
            {numeric(
              'Центр штампа Y',
              mark.groupPivot.yMeters,
              0,
              world.field.heightMeters,
              (value) => moveGroup('yMeters', value),
            )}
          </>
        ) : null}
        {mark && mark.kind !== 'area' && !grouped ? (
          <>
            {numeric('Начало линии X', mark.start.xMeters, 0, world.field.widthMeters, (value) =>
              patchMark({ ...mark, start: { ...mark.start, xMeters: value } }),
            )}
            {numeric('Начало линии Y', mark.start.yMeters, 0, world.field.heightMeters, (value) =>
              patchMark({ ...mark, start: { ...mark.start, yMeters: value } }),
            )}
            {numeric('Конец линии X', mark.end.xMeters, 0, world.field.widthMeters, (value) =>
              patchMark({ ...mark, end: { ...mark.end, xMeters: value } }),
            )}
            {numeric('Конец линии Y', mark.end.yMeters, 0, world.field.heightMeters, (value) =>
              patchMark({ ...mark, end: { ...mark.end, yMeters: value } }),
            )}
            {mark.kind === 'curve' ? (
              <>
                {numeric('Изгиб X', mark.control.xMeters, 0, world.field.widthMeters, (value) =>
                  patchMark({ ...mark, control: { ...mark.control, xMeters: value } }),
                )}
                {numeric('Изгиб Y', mark.control.yMeters, 0, world.field.heightMeters, (value) =>
                  patchMark({ ...mark, control: { ...mark.control, yMeters: value } }),
                )}
              </>
            ) : null}
          </>
        ) : null}
        {mark && mark.kind !== 'area'
          ? numeric(
              'Толщина линии',
              mark.widthMeters,
              0.005,
              0.2,
              (value) => patchMarks({ widthMeters: value }),
              0.005,
            )
          : null}
        {mark?.kind === 'area' ? (
          <>
            {numeric('X зоны', mark.xMeters, 0, world.field.widthMeters, (value) =>
              patchMark({ ...mark, xMeters: value }),
            )}
            {numeric('Y зоны', mark.yMeters, 0, world.field.heightMeters, (value) =>
              patchMark({ ...mark, yMeters: value }),
            )}
            {numeric('Ширина зоны', mark.widthMeters, 0.02, world.field.widthMeters, (value) =>
              patchMark({ ...mark, widthMeters: value }),
            )}
            {numeric('Высота зоны', mark.heightMeters, 0.02, world.field.heightMeters, (value) =>
              patchMark({ ...mark, heightMeters: value }),
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
              onChange={(event) => patchMarks({ color: event.target.value })}
            />
          </label>
        ) : null}
      </div>
      {ball ? (
        <details className="robotics-settings-group robotics-object-physics">
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
            {isRoboticsWorldV3(world) ? (
              <>
                {numeric(
                  'Сопротивление качению',
                  ball.rollingResistanceCoefficient!,
                  0,
                  1,
                  (value) => patchBall({ rollingResistanceCoefficient: value }),
                  0.01,
                  '',
                )}
                {numeric(
                  'Контактное трение мяча',
                  ball.contactFrictionCoefficient!,
                  0,
                  1,
                  (value) => patchBall({ contactFrictionCoefficient: value }),
                  0.01,
                  '',
                )}
              </>
            ) : (
              numeric(
                'Трение скольжения по полу',
                ball.frictionCoefficient,
                0,
                1,
                (value) => patchBall({ frictionCoefficient: value }),
                0.01,
                '',
              )
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
            {isRoboticsWorldV3(world)
              ? 'Мяч катится по полу. Упругость задаёт отскок, контактное трение — взаимодействие при касании.'
              : 'Прежняя модель: мяч скользит по плоскости, обратная нагрузка на робот не рассчитывается.'}
          </p>
        </details>
      ) : null}
      {body ? (
        <details className="robotics-settings-group robotics-object-physics" open>
          <summary>{body.kind === 'can' ? 'Физика банки' : 'Физика бруска'}</summary>
          <div className="robotics-form-grid">
            {numeric(
              body.kind === 'can' ? 'Масса банки' : 'Масса бруска',
              body.massKg,
              ROBOTICS_BODY_LIMITS.massKg.min,
              ROBOTICS_BODY_LIMITS.massKg.max,
              (value) => patchBody({ ...body, massKg: value }),
              0.01,
              'кг',
            )}
            {numeric(
              'Трение скольжения предмета',
              body.slidingFrictionCoefficient,
              0,
              1,
              (value) => patchBody({ ...body, slidingFrictionCoefficient: value }),
              0.01,
              '',
            )}
            {numeric(
              'Контактное трение предмета',
              body.contactFrictionCoefficient,
              0,
              1,
              (value) => patchBody({ ...body, contactFrictionCoefficient: value }),
              0.01,
              '',
            )}
            {numeric(
              'Упругость предмета',
              body.restitution,
              0,
              1,
              (value) => patchBody({ ...body, restitution: value }),
              0.05,
              '',
            )}
          </div>
          <p className="robotics-help">
            {body.kind === 'can'
              ? 'Банка стоит вертикально и скользит основанием по полу.'
              : 'Брусок скользит и поворачивается на плоскости.'}{' '}
            Высота описывает реальную деталь; опрокидывание не рассчитывается.
          </p>
        </details>
      ) : null}
      {mark ? (
        <p className="robotics-help">
          Разметка лежит на полу: без столкновений и сигнала датчика цвета.
        </p>
      ) : null}
      <div className="robotics-object-actions">
        {!ball && mark?.kind !== 'area' ? (
          <button
            type="button"
            className="robotics-button"
            disabled={running}
            onClick={() => onRotate(Math.PI / 2)}
          >
            Повернуть на 90°
          </button>
        ) : null}
        <button type="button" className="robotics-button" disabled={running} onClick={onDuplicate}>
          Дублировать предмет
        </button>
        <button
          type="button"
          className="robotics-button danger"
          disabled={running}
          onClick={onRemove}
        >
          Удалить предмет
        </button>
      </div>
    </section>
  );
}
