import { useId } from 'react';
import type {
  RoboticsDistanceMeasurement,
  RoboticsWorldDocument,
  RoboticsWorldState,
} from './world';

export function RobotField({
  world,
  state,
  distance,
  showGrid,
}: {
  world: RoboticsWorldDocument;
  state: RoboticsWorldState;
  distance: RoboticsDistanceMeasurement;
  showGrid: boolean;
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

  return (
    <svg
      className="robotics-field"
      data-testid="robotics-field"
      role="img"
      aria-labelledby={`robotics-field-title-${id} robotics-field-description-${id}`}
      viewBox={`-65 -65 ${width + 130} ${height + 130}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`robotics-field-title-${id}`}>Поле робота, вид сверху</title>
      <desc id={`robotics-field-description-${id}`}>
        Поле {width} на {height} миллиметров. Робот: X {Math.round(pose.xMeters * 1000)}, Y{' '}
        {Math.round(pose.yMeters * 1000)} миллиметров. Бирюзовый луч показывает измерение датчика,
        оранжевая линия — пройденный путь.
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
      <rect width={width} height={height} rx="12" fill="#fbfdff" />
      {showGrid ? (
        <rect width={width} height={height} rx="12" fill={`url(#robotics-grid-${id})`} />
      ) : null}
      <rect width={width} height={height} rx="12" fill="none" stroke="#afc2d0" strokeWidth="5" />
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
          x={obstacle.xMeters * 1000}
          y={height - (obstacle.yMeters + obstacle.heightMeters) * 1000}
          width={obstacle.widthMeters * 1000}
          height={obstacle.heightMeters * 1000}
          rx="8"
          fill={`url(#robotics-obstacle-${id})`}
          stroke="#738a9d"
          strokeWidth="4"
        />
      ))}
      {state.trail.length > 1 ? (
        <polyline
          points={trail}
          fill="none"
          stroke="#ed9b18"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {distance.status === 'ok' ? (
        <g aria-hidden="true">
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
      <g
        data-testid="robotics-robot"
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
          stroke="#0b3558"
          strokeWidth="5"
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
          <rect x="-8" y="-25" width="15" height="50" rx="4" fill="#0aa4c8" />
          <circle cx="0" cy="-13" r="9" fill="#e9f2f7" stroke="#526b7d" strokeWidth="3" />
          <circle cx="0" cy="13" r="9" fill="#e9f2f7" stroke="#526b7d" strokeWidth="3" />
        </g>
      </g>
    </svg>
  );
}
