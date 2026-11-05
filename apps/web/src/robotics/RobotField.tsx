import { useId, type PointerEventHandler } from 'react';
import type {
  RoboticsDistanceMeasurement,
  RoboticsWorldDocument,
  RoboticsWorldState,
} from './world';

export type RoboticsObjectKey = 'robot' | `wall:${string}` | `ball:${string}` | `mark:${string}`;

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
}: {
  world: RoboticsWorldDocument;
  state: RoboticsWorldState;
  distance: RoboticsDistanceMeasurement;
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
  const pose = state.pose;
  const trail = state.trail
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
    view === 'robot'
      ? `${pose.xMeters * 1000 - robotViewRadius} ${height - pose.yMeters * 1000 - robotViewRadius} ${robotViewRadius * 2} ${robotViewRadius * 2}`
      : `-65 -65 ${width + 130} ${height + 130}`;

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
      role="img"
      aria-labelledby={`robotics-field-title-${id} robotics-field-description-${id}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`robotics-field-title-${id}`}>
        {view === 'robot' ? 'Шасси и крепление датчика, вид сверху' : 'Поле робота, вид сверху'}
      </title>
      <desc id={`robotics-field-description-${id}`}>
        {view === 'robot'
          ? `Корпус ${length} на ${bodyWidth} миллиметров. Колёса L и R и положение HC-SR04. Бирюзовая стрелка показывает направление датчика относительно корпуса.`
          : `Поле ${width} на ${height} миллиметров. Робот: X ${Math.round(pose.xMeters * 1000)}, Y ${Math.round(pose.yMeters * 1000)} миллиметров. Бирюзовый луч показывает измерение датчика, оранжевая линия — пройденный путь.`}
      </desc>
      <defs>
        <pattern
          id={`robotics-grid-${id}`}
          width={world.field.gridMeters * 1000}
          height={world.field.gridMeters * 1000}
          patternUnits="userSpaceOnUse"
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
          <rect width={width} height={height} rx="12" fill="#fbfdff" />
          {showGrid ? (
            <rect width={width} height={height} rx="12" fill={`url(#robotics-grid-${id})`} />
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
            {width} мм
          </text>
          <text
            transform={`translate(-24 ${height / 2}) rotate(-90)`}
            textAnchor="middle"
            className="robotics-field-dimension"
          >
            {height} мм
          </text>
          {world.field.floorMarks.map((mark) =>
            mark.kind === 'line' ? (
              <line
                key={mark.id}
                data-scene-key={`mark:${mark.id}`}
                data-object-kind="line"
                data-floor-mark-id={mark.id}
                x1={mark.start.xMeters * 1000}
                y1={height - mark.start.yMeters * 1000}
                x2={mark.end.xMeters * 1000}
                y2={height - mark.end.yMeters * 1000}
                stroke={mark.color}
                strokeWidth={mark.widthMeters * 1000}
                strokeLinecap="round"
                className={selection === `mark:${mark.id}` ? 'selected' : ''}
              >
                <title>{mark.label ?? 'Линия'}</title>
              </line>
            ) : (
              <rect
                key={mark.id}
                data-scene-key={`mark:${mark.id}`}
                data-object-kind="area"
                data-floor-mark-id={mark.id}
                x={mark.xMeters * 1000}
                y={height - (mark.yMeters + mark.heightMeters) * 1000}
                width={mark.widthMeters * 1000}
                height={mark.heightMeters * 1000}
                fill={mark.color}
                fillOpacity=".42"
                stroke={selection === `mark:${mark.id}` ? '#087d9b' : mark.color}
                strokeWidth={selection === `mark:${mark.id}` ? 9 : 2}
              >
                <title>{mark.label ?? 'Цветная зона'}</title>
              </rect>
            ),
          )}
          <g aria-hidden="true" className="robotics-start-marker">
            <circle
              cx={world.initialPose.xMeters * 1000}
              cy={height - world.initialPose.yMeters * 1000}
              r={bodyWidth / 2}
              fill="none"
              stroke="#a7bbc9"
              strokeWidth="3"
              strokeDasharray="10 10"
            />
          </g>
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
            const current = state.balls.find((entry) => entry.id === ball.id) ?? ball;
            return (
              <g
                key={ball.id}
                data-scene-key={`ball:${ball.id}`}
                data-object-kind="ball"
                data-ball-id={ball.id}
                data-x-meters={current.xMeters}
                data-y-meters={current.yMeters}
                data-velocity-x={
                  'velocityXMetersPerSecond' in current ? current.velocityXMetersPerSecond : 0
                }
                data-velocity-y={
                  'velocityYMetersPerSecond' in current ? current.velocityYMetersPerSecond : 0
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
          {state.trail.length > 1 ? (
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
          {distance.status === 'ok' ? (
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
