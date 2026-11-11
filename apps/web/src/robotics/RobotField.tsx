import { useId, type MouseEventHandler, type PointerEventHandler } from 'react';
import { fieldCameraViewBox, type FieldCamera, type FieldViewport } from './field-camera';
import type {
  RoboticsDistanceMeasurement,
  RoboticsWorldDocument,
  RoboticsWorldState,
} from './world';
import type {
  RoboticsBody,
  RoboticsObjectKey,
  RoboticsPoint,
} from '@asa-lab/robotics/world-document';

export type { RoboticsObjectKey } from '@asa-lab/robotics/world-document';

type RoboticsBodyGeometry = Pick<
  RoboticsBody,
  'id' | 'label' | 'xMeters' | 'yMeters' | 'headingRadians' | 'heightMeters'
> &
  (
    | { readonly kind: 'can'; readonly radiusMeters: number }
    | { readonly kind: 'box'; readonly widthMeters: number; readonly depthMeters: number }
  );

/** The same drawing accepts source-only published geometry and a full editable world. */
export type RoboticsFieldGeometry = Pick<RoboticsWorldDocument, 'robot' | 'initialPose'> & {
  readonly field: Omit<RoboticsWorldDocument['field'], 'balls' | 'bodies'> & {
    readonly balls: readonly Pick<
      RoboticsWorldDocument['field']['balls'][number],
      'id' | 'label' | 'xMeters' | 'yMeters' | 'radiusMeters'
    >[];
    readonly bodies?: readonly RoboticsBodyGeometry[];
  };
};

export function RobotField({
  world,
  state,
  distance,
  showGrid,
  selection = null,
  editable = false,
  view = 'field',
  testIdPrefix = 'robotics',
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onContextMenu,
  draftStroke,
  projection,
}: {
  world: RoboticsFieldGeometry;
  projection?: { camera: FieldCamera; viewport: FieldViewport } | undefined;
  state?: RoboticsWorldState;
  distance?: RoboticsDistanceMeasurement;
  showGrid: boolean;
  selection?: RoboticsObjectKey | null;
  editable?: boolean;
  view?: 'field' | 'robot';
  testIdPrefix?: string;
  onPointerDown?: PointerEventHandler<SVGSVGElement>;
  onPointerMove?: PointerEventHandler<SVGSVGElement>;
  onPointerUp?: PointerEventHandler<SVGSVGElement>;
  onPointerCancel?: PointerEventHandler<SVGSVGElement>;
  onLostPointerCapture?: PointerEventHandler<SVGSVGElement>;
  onContextMenu?: MouseEventHandler<SVGSVGElement>;
  draftStroke?: {
    kind: 'line' | 'curve';
    points: readonly RoboticsPoint[];
    cursor: RoboticsPoint | null;
  } | null;
}) {
  const id = useId().replaceAll(':', '');
  const width = world.field.widthMeters * 1000;
  const height = world.field.heightMeters * 1000;
  const robot = world.robot;
  const length = robot.bodyLengthMeters * 1000;
  const bodyWidth = robot.bodyWidthMeters * 1000;
  const radius = robot.wheelRadiusMeters * 1000;
  const wheelWidth = robot.wheelWidthMeters * 1000;
  const halfTrack = (robot.wheelTrackMeters * 1000) / 2;
  const sensorX = robot.sensorForwardMeters * 1000;
  const sensorY = -robot.sensorLateralMeters * 1000;
  const pose = state?.pose ?? world.initialPose;
  const currentTrail = state?.trail ?? [];
  const trail = currentTrail
    .map((point) => `${point.xMeters * 1000},${height - point.yMeters * 1000}`)
    .join(' ');

  const robotViewRadius =
    Math.max(
      length,
      bodyWidth,
      Math.abs(sensorX) * 2 + 100,
      Math.abs(sensorY) * 2 + 100,
      halfTrack * 2 + wheelWidth,
    ) * 0.8;
  const viewBox =
    projection && view === 'field'
      ? fieldCameraViewBox(projection.camera, projection.viewport, world.field.heightMeters)
      : view === 'robot'
        ? `${pose.xMeters * 1000 - robotViewRadius} ${height - pose.yMeters * 1000 - robotViewRadius} ${robotViewRadius * 2} ${robotViewRadius * 2}`
        : `-65 -65 ${width + 130} ${height + 130}`;

  const vectorHandle = (
    kind: 'mark' | 'wall' | 'ball' | 'body' | 'decoration',
    itemId: string,
    which: 'start' | 'end' | 'control' | 'radius',
    sceneKey: string,
    point: RoboticsPoint,
  ) => (
    <circle
      key={kind + ':' + itemId + ':' + which}
      className="robotics-vector-handle"
      data-vector-kind={kind}
      data-vector-id={itemId}
      data-vector-handle={which}
      data-scene-key={sceneKey}
      aria-label={'Изменить ' + which + ': ' + kind}
      cx={point.xMeters * 1000}
      cy={height - point.yMeters * 1000}
      r={projection ? 7_000 / projection.camera.pixelsPerMeter : 16}
      stroke="#066c90"
      strokeWidth={projection ? 2_000 / projection.camera.pixelsPerMeter : 6}
      fill="#ffffff"
      role="presentation"
    />
  );
  const rectHandles = (
    kind: 'wall' | 'decoration',
    itemId: string,
    sceneKey: string,
    left: number,
    bottom: number,
    widthMeters: number,
    heightMeters: number,
  ) => [
    vectorHandle(kind, itemId, 'start', sceneKey, { xMeters: left, yMeters: bottom }),
    vectorHandle(kind, itemId, 'end', sceneKey, {
      xMeters: left + widthMeters,
      yMeters: bottom + heightMeters,
    }),
  ];

  return (
    <svg
      className="robotics-field"
      data-testid={`${testIdPrefix}-field`}
      data-editable={editable}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onContextMenu={onContextMenu}
      role="img"
      aria-labelledby={`robotics-field-title-${id} robotics-field-description-${id}`}
      viewBox={viewBox}
      preserveAspectRatio={projection ? 'none' : 'xMidYMid meet'}
    >
      <title id={`robotics-field-title-${id}`}>
        {view === 'robot' ? 'Шасси и крепление датчика, вид сверху' : 'Поле робота, вид сверху'}
      </title>
      <desc id={`robotics-field-description-${id}`}>
        {view === 'robot'
          ? `Корпус ${length} на ${bodyWidth} миллиметров. Колёса L и R и положение HC-SR04. Бирюзовая стрелка показывает направление датчика относительно корпуса.`
          : `Поле ${Math.round(width * 100) / 100} на ${Math.round(height * 100) / 100} миллиметров. Робот: X ${Math.round(pose.xMeters * 1000)}, Y ${Math.round(pose.yMeters * 1000)} миллиметров. ${state ? 'Бирюзовый луч показывает измерение датчика, оранжевая линия — пройденный путь.' : 'Сохранённая сцена и начальное положение робота.'}`}
      </desc>
      <defs>
        <clipPath id={`robotics-floor-clip-${id}`}>
          <rect width={width} height={height} />
        </clipPath>
        <linearGradient id={`robotics-metal-${id}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f3f7fa" />
          <stop offset=".45" stopColor="#c4d1da" />
          <stop offset="1" stopColor="#8299aa" />
        </linearGradient>
        <pattern
          id={`robotics-tiles-${id}`}
          width={(world.field.tiles?.sizeMeters ?? 0.3) * 1000}
          height={(world.field.tiles?.sizeMeters ?? 0.3) * 1000}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(0 ${height})`}
        >
          <path
            d={`M ${(world.field.tiles?.sizeMeters ?? 0.3) * 1000} 0 H 0 V ${(world.field.tiles?.sizeMeters ?? 0.3) * 1000}`}
            fill="none"
            stroke="#bdcbd4"
            strokeWidth="3"
          />
        </pattern>
        <pattern
          id={`robotics-grid-${id}`}
          width={world.field.gridMeters * 1000}
          height={world.field.gridMeters * 1000}
          patternUnits="userSpaceOnUse"
          patternTransform={`translate(0 ${height})`}
        >
          <path
            d={`M ${world.field.gridMeters * 1000} 0 H 0 V ${world.field.gridMeters * 1000}`}
            fill="none"
            stroke="#dce8ee"
            strokeWidth="2"
          />
        </pattern>
        <pattern
          id={`robotics-obstacle-${id}`}
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="24" height="24" fill="#e9eef3" />
          <path d="M0 0V24" stroke="#cbd5df" strokeWidth="5" />
        </pattern>
      </defs>
      {view === 'field' ? (
        <>
          <rect
            width={width}
            height={height}
            rx="12"
            fill={
              world.field.surface === 'carpet'
                ? '#e7ede7'
                : world.field.surface === 'wood'
                  ? '#faf7ef'
                  : '#fbfdff'
            }
          />
          {showGrid ? (
            <rect width={width} height={height} rx="12" fill={`url(#robotics-grid-${id})`} />
          ) : null}
          {world.field.tiles?.enabled ? (
            <rect
              data-testid={`${testIdPrefix}-tiles`}
              width={width}
              height={height}
              rx="12"
              fill={`url(#robotics-tiles-${id})`}
              pointerEvents="none"
            />
          ) : null}
          <rect
            width={width}
            height={height}
            rx="12"
            fill="none"
            stroke="#afc2d0"
            strokeWidth="5"
          />
          <text x={width / 2} y="-22" textAnchor="middle" className="robotics-field-dimension">
            {Math.round(width * 100) / 100} мм
          </text>
          <text
            transform={`translate(-24 ${height / 2}) rotate(-90)`}
            textAnchor="middle"
            className="robotics-field-dimension"
          >
            {Math.round(height * 100) / 100} мм
          </text>
          <g clipPath={`url(#robotics-floor-clip-${id})`}>
            {world.field.floorMarks.map((mark) => {
              const key: RoboticsObjectKey = mark.groupId
                ? `mark-group:${mark.groupId}`
                : `mark:${mark.id}`;
              return mark.kind !== 'area' ? (
                <path
                  key={mark.id}
                  data-scene-key={key}
                  data-object-kind={mark.kind}
                  data-floor-mark-id={mark.id}
                  d={`M${mark.start.xMeters * 1000} ${height - mark.start.yMeters * 1000} ${mark.kind === 'curve' ? `Q${mark.control.xMeters * 1000} ${height - mark.control.yMeters * 1000}` : 'L'} ${mark.end.xMeters * 1000} ${height - mark.end.yMeters * 1000}`}
                  fill="none"
                  stroke={mark.color}
                  strokeWidth={mark.widthMeters * 1000}
                  strokeLinecap="round"
                  className={selection === key ? 'selected' : ''}
                >
                  <title>
                    {mark.label ?? (mark.kind === 'curve' ? 'Плавный поворот' : 'Линия')}
                  </title>
                </path>
              ) : (
                <rect
                  key={mark.id}
                  data-scene-key={key}
                  data-object-kind="area"
                  data-floor-mark-id={mark.id}
                  x={mark.xMeters * 1000}
                  y={height - (mark.yMeters + mark.heightMeters) * 1000}
                  width={mark.widthMeters * 1000}
                  height={mark.heightMeters * 1000}
                  fill={mark.color}
                  fillOpacity=".42"
                  stroke={selection === key ? '#087d9b' : mark.color}
                  strokeWidth={selection === key ? 9 : 2}
                >
                  <title>{mark.label ?? 'Цветная зона'}</title>
                </rect>
              );
            })}
          </g>
          <g clipPath={'url(#robotics-floor-clip-' + id + ')'}>
            {(world.field.visuals ?? []).map((visual) => {
              const x = visual.xMeters * 1000;
              const y = height - (visual.yMeters + visual.heightMeters) * 1000;
              const w = visual.widthMeters * 1000;
              const h = visual.heightMeters * 1000;
              const isSelected = selection === 'decoration:' + visual.id;
              return (
                <g
                  key={visual.id}
                  data-scene-key={'decoration:' + visual.id}
                  data-object-kind={visual.kind}
                  data-decoration-id={visual.id}
                  transform={
                    'rotate(' +
                    -((visual.rotationRadians ?? 0) * 180) / Math.PI +
                    ' ' +
                    (x + w / 2) +
                    ' ' +
                    (y + h / 2) +
                    ')'
                  }
                >
                  <title>{visual.label ?? visual.kind}</title>
                  {visual.kind === 'rectangle' ? (
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      stroke={isSelected ? '#087d9b' : visual.strokeColor}
                      fill={visual.fillEnabled ? visual.fillColor : 'none'}
                      strokeWidth={isSelected ? 7 : 4}
                    />
                  ) : visual.kind === 'circle' ? (
                    <circle
                      cx={x + w / 2}
                      cy={y + h / 2}
                      r={w / 2}
                      stroke={isSelected ? '#087d9b' : visual.strokeColor}
                      fill={visual.fillEnabled ? visual.fillColor : 'none'}
                      strokeWidth={isSelected ? 7 : 4}
                    />
                  ) : visual.kind === 'text' ? (
                    <>
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill="transparent"
                        stroke={isSelected ? '#087d9b' : 'none'}
                        strokeDasharray="8 6"
                        strokeWidth="3"
                      />
                      <text
                        x={x + 7}
                        y={y + Math.min(h * 0.78, 120)}
                        fontSize={Math.min(h * 0.73, 110)}
                        fontFamily="Arial, sans-serif"
                        fontWeight="700"
                        fill={visual.strokeColor}
                        textLength={Math.max(8, w - 14)}
                        lengthAdjust="spacingAndGlyphs"
                        pointerEvents="none"
                      >
                        {visual.text}
                      </text>
                    </>
                  ) : (
                    <>
                      <image
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        href={visual.imageData}
                        preserveAspectRatio="none"
                      />
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill="transparent"
                        stroke={isSelected ? '#087d9b' : '#9db3be'}
                        strokeWidth={isSelected ? 7 : 3}
                      />
                    </>
                  )}
                </g>
              );
            })}
            {selection && editable ? (
              <g className="robotics-field-selection-handles">
                {world.field.floorMarks.flatMap((mark) => {
                  const key = mark.groupId ? 'mark-group:' + mark.groupId : 'mark:' + mark.id;
                  if (selection !== key) return [];
                  return mark.kind === 'area'
                    ? [
                        vectorHandle('mark', mark.id, 'start', key, mark),
                        vectorHandle('mark', mark.id, 'end', key, {
                          xMeters: mark.xMeters + mark.widthMeters,
                          yMeters: mark.yMeters + mark.heightMeters,
                        }),
                      ]
                    : [
                        vectorHandle('mark', mark.id, 'start', key, mark.start),
                        ...(mark.kind === 'curve'
                          ? [vectorHandle('mark', mark.id, 'control', key, mark.control)]
                          : []),
                        vectorHandle('mark', mark.id, 'end', key, mark.end),
                      ];
                })}
                {world.field.obstacles.flatMap((wall) =>
                  selection === 'wall:' + wall.id
                    ? rectHandles(
                        'wall',
                        wall.id,
                        'wall:' + wall.id,
                        wall.xMeters,
                        wall.yMeters,
                        wall.widthMeters,
                        wall.heightMeters,
                      )
                    : [],
                )}
                {world.field.balls.flatMap((ball) =>
                  selection === 'ball:' + ball.id
                    ? [
                        vectorHandle('ball', ball.id, 'radius', 'ball:' + ball.id, {
                          xMeters: ball.xMeters + ball.radiusMeters,
                          yMeters: ball.yMeters,
                        }),
                      ]
                    : [],
                )}
                {(world.field.bodies ?? []).flatMap((body) =>
                  selection === 'body:' + body.id
                    ? [
                        vectorHandle('body', body.id, 'radius', 'body:' + body.id, {
                          xMeters:
                            body.xMeters +
                            (body.kind === 'can' ? body.radiusMeters : body.widthMeters / 2),
                          yMeters: body.yMeters + (body.kind === 'can' ? 0 : body.depthMeters / 2),
                        }),
                      ]
                    : [],
                )}
                {(world.field.visuals ?? []).flatMap((visual) =>
                  selection === 'decoration:' + visual.id
                    ? rectHandles(
                        'decoration',
                        visual.id,
                        'decoration:' + visual.id,
                        visual.xMeters,
                        visual.yMeters,
                        visual.widthMeters,
                        visual.heightMeters,
                      )
                    : [],
                )}
              </g>
            ) : null}
            {draftStroke && draftStroke.points.length > 0 ? (
              <>
                <path
                  className="robotics-draft-stroke"
                  d={(() => {
                    const points = [
                      ...draftStroke.points,
                      ...(draftStroke.cursor ? [draftStroke.cursor] : []),
                    ];
                    const point = (p: RoboticsPoint) =>
                      p.xMeters * 1000 + ' ' + (height - p.yMeters * 1000);
                    if (points.length < 2) return '';
                    if (draftStroke.kind === 'curve' && points.length > 2)
                      return (
                        'M ' +
                        point(points[0]!) +
                        ' Q ' +
                        point(points[1]!) +
                        ' ' +
                        point(points[2]!)
                      );
                    return 'M ' + points.map(point).join(' L ');
                  })()}
                  fill="none"
                  stroke="#0aa4c8"
                  strokeWidth="13"
                  strokeDasharray="24 14"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
                {draftStroke.points.map((point, index) => (
                  <circle
                    key={index}
                    cx={point.xMeters * 1000}
                    cy={height - point.yMeters * 1000}
                    r="16"
                    stroke="#0b83a4"
                    strokeWidth="5"
                    fill="#fff"
                    pointerEvents="none"
                  />
                ))}
              </>
            ) : null}
          </g>
          {view === 'field' ? (
            <g
              className="robotics-start-zone"
              data-testid={`${testIdPrefix}-start-zone`}
              data-zone-size-meters="0.3"
              data-center-x-meters={world.initialPose.xMeters}
              data-center-y-meters={world.initialPose.yMeters}
              pointerEvents="none"
              aria-label="Стартовая зона 30 на 30 сантиметров"
            >
              <title>Стартовая зона 30 × 30 см</title>
              <rect
                x={world.initialPose.xMeters * 1000 - 150}
                y={height - world.initialPose.yMeters * 1000 - 150}
                width="300"
                height="300"
                rx="8"
                fill="#0aa4c8"
                fillOpacity="0.12"
                stroke="#0a86aa"
                strokeWidth="5"
                strokeDasharray="18 10"
              />
              <text
                x={world.initialPose.xMeters * 1000}
                y={height - world.initialPose.yMeters * 1000 - 107}
                textAnchor="middle"
                fontSize="32"
                fontFamily="Arial, sans-serif"
                fontWeight="700"
                fill="#066d90"
              >
                СТАРТ
              </text>
            </g>
          ) : null}
          {world.field.obstacles.map((obstacle) => (
            <rect
              key={obstacle.id}
              data-obstacle-id={obstacle.id}
              data-scene-key={`wall:${obstacle.id}`}
              data-object-kind="wall"
              transform={`rotate(${(-(obstacle.headingRadians ?? 0) * 180) / Math.PI} ${(obstacle.xMeters + obstacle.widthMeters / 2) * 1000} ${height - (obstacle.yMeters + obstacle.heightMeters / 2) * 1000})`}
              x={obstacle.xMeters * 1000}
              y={height - (obstacle.yMeters + obstacle.heightMeters) * 1000}
              width={obstacle.widthMeters * 1000}
              height={obstacle.heightMeters * 1000}
              rx="8"
              fill={`url(#robotics-obstacle-${id})`}
              stroke={selection === `wall:${obstacle.id}` ? '#087d9b' : '#738a9d'}
              strokeWidth={selection === `wall:${obstacle.id}` ? 9 : 4}
            />
          ))}
          {world.field.balls.map((ball) => {
            const current = state?.balls.find((entry) => entry.id === ball.id) ?? ball;
            return (
              <g
                key={ball.id}
                data-scene-key={`ball:${ball.id}`}
                data-object-kind="ball"
                data-ball-id={ball.id}
                data-x-meters={current.xMeters}
                data-y-meters={current.yMeters}
                data-velocity-x={
                  state
                    ? 'velocityXMetersPerSecond' in current
                      ? current.velocityXMetersPerSecond
                      : 0
                    : undefined
                }
                data-velocity-y={
                  state
                    ? 'velocityYMetersPerSecond' in current
                      ? current.velocityYMetersPerSecond
                      : 0
                    : undefined
                }
                transform={`translate(${current.xMeters * 1000} ${height - current.yMeters * 1000})`}
              >
                <title>{ball.label ?? 'Мяч'}</title>
                <circle
                  r={ball.radiusMeters * 1000}
                  fill="#ef9d39"
                  stroke={selection === `ball:${ball.id}` ? '#087d9b' : '#b97624'}
                  strokeWidth={selection === `ball:${ball.id}` ? 9 : 4}
                />
                <path
                  d={`M${-ball.radiusMeters * 650} ${-ball.radiusMeters * 350}Q0 ${-ball.radiusMeters * 850} ${ball.radiusMeters * 450} ${-ball.radiusMeters * 400}`}
                  fill="none"
                  stroke="#ffe3ad"
                  strokeWidth="8"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {(world.field.bodies ?? []).map((body) => {
            const current = state?.bodies?.find((entry) => entry.id === body.id) ?? body;
            const selected = selection === `body:${body.id}`;
            return (
              <g
                key={body.id}
                data-body-id={body.id}
                data-scene-key={`body:${body.id}`}
                data-object-kind={body.kind}
                data-x-meters={current.xMeters}
                data-y-meters={current.yMeters}
                data-heading-radians={current.headingRadians}
                data-velocity-x={
                  state
                    ? 'velocityXMetersPerSecond' in current
                      ? current.velocityXMetersPerSecond
                      : 0
                    : undefined
                }
                data-velocity-y={
                  state
                    ? 'velocityYMetersPerSecond' in current
                      ? current.velocityYMetersPerSecond
                      : 0
                    : undefined
                }
                transform={`translate(${current.xMeters * 1000} ${height - current.yMeters * 1000}) rotate(${(-current.headingRadians * 180) / Math.PI})`}
              >
                <title>
                  {body.label ??
                    (body.kind === 'can' ? 'Металлическая банка' : 'Деревянный брусок')}
                </title>
                {body.kind === 'can' ? (
                  <>
                    <circle
                      r={body.radiusMeters * 1000}
                      fill={`url(#robotics-metal-${id})`}
                      stroke={selected ? '#087d9b' : '#617b8e'}
                      strokeWidth={selected ? 7 : 3}
                    />
                    <circle
                      r={body.radiusMeters * 810}
                      fill="none"
                      stroke="#f1f5f8"
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                    <ellipse
                      cx={body.radiusMeters * 220}
                      cy="0"
                      rx={body.radiusMeters * 340}
                      ry={body.radiusMeters * 210}
                      fill="#899fad"
                      stroke="#e8eff4"
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                    <rect
                      x={-body.radiusMeters * 300}
                      y={-body.radiusMeters * 180}
                      width={body.radiusMeters * 470}
                      height={body.radiusMeters * 360}
                      rx={body.radiusMeters * 150}
                      fill="none"
                      stroke="#f3f7fa"
                      strokeWidth="4"
                      pointerEvents="none"
                    />
                  </>
                ) : (
                  <>
                    <rect
                      x={-body.widthMeters * 500}
                      y={-body.depthMeters * 500}
                      width={body.widthMeters * 1000}
                      height={body.depthMeters * 1000}
                      rx="4"
                      fill="#d9b27b"
                      stroke={selected ? '#087d9b' : '#9c703e'}
                      strokeWidth={selected ? 7 : 3}
                    />
                    {[-0.22, 0.08, 0.3].map((stripe) => (
                      <path
                        key={stripe}
                        d={`M${-body.widthMeters * 430} ${body.depthMeters * stripe * 1000}q${body.widthMeters * 220} -6 ${body.widthMeters * 430} 0t${body.widthMeters * 430} 0`}
                        fill="none"
                        stroke="#bd9058"
                        strokeWidth="2"
                        pointerEvents="none"
                      />
                    ))}
                  </>
                )}
              </g>
            );
          })}
          {currentTrail.length > 1 ? (
            <polyline
              points={trail}
              pointerEvents="none"
              fill="none"
              stroke="#ed9b18"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {distance?.status === 'ok' ? (
            <g aria-hidden="true" pointerEvents="none">
              <line
                x1={distance.origin.xMeters * 1000}
                y1={height - distance.origin.yMeters * 1000}
                x2={distance.hit.xMeters * 1000}
                y2={height - distance.hit.yMeters * 1000}
                stroke="#0a91b2"
                strokeWidth="5"
                strokeDasharray="14 10"
              />
              <circle
                cx={distance.hit.xMeters * 1000}
                cy={height - distance.hit.yMeters * 1000}
                r="8"
                fill="#0a91b2"
              />
            </g>
          ) : null}
        </>
      ) : null}
      <g
        data-testid={`${testIdPrefix}-robot`}
        data-scene-key="robot"
        data-object-kind="robot"
        data-x-meters={pose.xMeters}
        data-y-meters={pose.yMeters}
        data-heading-radians={pose.headingRadians}
        transform={`translate(${pose.xMeters * 1000} ${height - pose.yMeters * 1000}) rotate(${(-pose.headingRadians * 180) / Math.PI})`}
      >
        <path d={`M0 ${-halfTrack}V${halfTrack}`} stroke="#758997" strokeWidth="8" />
        {[-halfTrack, halfTrack].map((center, index) => (
          <g key={center}>
            <rect
              x={-radius}
              y={center - wheelWidth / 2}
              width={radius * 2}
              height={wheelWidth}
              rx="6"
              fill="#243b4e"
              stroke="#102b40"
              strokeWidth="3"
            />
            {[-0.6, 0, 0.6].map((part) => (
              <path
                key={part}
                d={`M${part * radius} ${center - wheelWidth / 2 + 3}v${wheelWidth - 6}`}
                stroke="#667e90"
                strokeWidth="3"
              />
            ))}
            <text
              x="0"
              y={center + (index ? wheelWidth / 2 + 20 : -wheelWidth / 2 - 10)}
              textAnchor="middle"
              className="robotics-wheel-label"
            >
              {index ? 'R' : 'L'}
            </text>
          </g>
        ))}
        <rect
          x={-length / 2}
          y={-bodyWidth / 2}
          width={length}
          height={bodyWidth}
          rx="22"
          fill="#e0f3f8"
          stroke={selection === 'robot' ? '#0ca2c4' : '#0b3558'}
          strokeWidth={selection === 'robot' ? 9 : 5}
        />
        <rect x="-53" y="-31" width="75" height="62" rx="8" fill="#0b3558" />
        <text x="-15" y="6" textAnchor="middle" className="robotics-board-label">
          UNO
        </text>
        <path
          d={`M${length / 2 - 48} -14l20 14-20 14`}
          fill="none"
          stroke="#098cab"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g
          transform={`translate(${sensorX} ${sensorY}) rotate(${(-robot.sensorHeadingRadians * 180) / Math.PI})`}
        >
          {view === 'robot' ? (
            <path
              d="M14 0H78M64 -10L78 0 64 10"
              fill="none"
              stroke="#0a91b2"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            />
          ) : null}
          <rect x="-8" y="-25" width="15" height="50" rx="4" fill="#0aa4c8" />
          <circle cx="0" cy="-13" r="9" fill="#e9f2f7" stroke="#526b7d" strokeWidth="3" />
          <circle cx="0" cy="13" r="9" fill="#e9f2f7" stroke="#526b7d" strokeWidth="3" />
        </g>
      </g>
    </svg>
  );
}
