import { HALF_BREADBOARD_VISUAL } from './native-breadboard-model';

export interface NativeBreadboardGraphicProps {
  readonly instanceId: string;
  readonly mountedHoleIds?: ReadonlySet<string>;
  readonly wiredHoleIds?: ReadonlySet<string>;
}

function columnLabels() {
  const values = [1, 5, 10, 15, 20, 25, 30];
  return values.map((column) => {
    const hole = HALF_BREADBOARD_VISUAL.holes.find(
      (candidate) => candidate.column === column && candidate.row === 'a',
    );
    if (!hole) return null;
    return (
      <g key={`column-${column}`} aria-hidden="true">
        <text x={hole.xMm} y={10.4} textAnchor="middle" className="native-breadboard-number">
          {column}
        </text>
        <text x={hole.xMm} y={44.8} textAnchor="middle" className="native-breadboard-number">
          {column}
        </text>
      </g>
    );
  });
}

function rowLabels() {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
  return rows.map((row) => {
    const hole = HALF_BREADBOARD_VISUAL.holes.find(
      (candidate) => candidate.column === 1 && candidate.row === row,
    );
    if (!hole) return null;
    return (
      <text
        key={`row-${row}`}
        x={2.55}
        y={hole.yMm + 0.42}
        textAnchor="middle"
        className="native-breadboard-row"
        aria-hidden="true"
      >
        {row.toUpperCase()}
      </text>
    );
  });
}

function railGuides() {
  return [
    { id: 'top-positive', color: '#d74b43', symbol: '+', y: 5.08 },
    { id: 'top-negative', color: '#3979c6', symbol: '−', y: 10.16 },
    { id: 'bottom-positive', color: '#d74b43', symbol: '+', y: 44.34 },
    { id: 'bottom-negative', color: '#3979c6', symbol: '−', y: 49.42 },
  ].map((rail) => (
    <g key={rail.id} aria-hidden="true">
      <path
        d={`M 9.2 ${rail.y} H 74.3`}
        stroke={rail.color}
        strokeWidth={0.55}
        strokeLinecap="round"
        opacity={0.72}
      />
      <text
        x={7.2}
        y={rail.y + 0.65}
        textAnchor="middle"
        className="native-breadboard-polarity"
        fill={rail.color}
      >
        {rail.symbol}
      </text>
    </g>
  ));
}

/**
 * Original ASA Lab vector breadboard generated from the physical 83.5×54.5 mm
 * model. Electrical identity remains in stable domain terminal and bus IDs.
 */
export function NativeBreadboardGraphic({
  instanceId,
  mountedHoleIds = new Set(),
  wiredHoleIds = new Set(),
}: NativeBreadboardGraphicProps) {
  const board = HALF_BREADBOARD_VISUAL;
  const safeInstanceId = instanceId.replace(/[^A-Za-z0-9_-]/g, '-');
  const gradientId = `asa-breadboard-body-${safeInstanceId}`;
  const shadowId = `asa-breadboard-shadow-${safeInstanceId}`;
  return (
    <g className="native-breadboard-graphic" pointerEvents="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f6f5ef" />
          <stop offset="1" stopColor="#deddd6" />
        </linearGradient>
        <filter id={shadowId} x="-8%" y="-10%" width="116%" height="124%">
          <feDropShadow
            dx="0"
            dy="0.8"
            stdDeviation="0.8"
            floodColor="#172431"
            floodOpacity="0.26"
          />
        </filter>
      </defs>
      <rect
        x={0.45}
        y={0.45}
        width={board.widthMm - 0.9}
        height={board.heightMm - 0.9}
        rx={2.2}
        fill={`url(#${gradientId})`}
        stroke="#a8afb2"
        strokeWidth={0.55}
        filter={`url(#${shadowId})`}
      />
      <rect
        x={board.channel.xMm}
        y={board.channel.yMm}
        width={board.channel.widthMm}
        height={board.channel.heightMm}
        rx={0.65}
        fill="#d5d4ce"
        stroke="#bbb9b1"
        strokeWidth={0.28}
      />
      {railGuides()}
      {columnLabels()}
      {rowLabels()}
      {board.holes.map((hole) => {
        const mounted = mountedHoleIds.has(hole.id);
        const wired = wiredHoleIds.has(hole.id);
        const outerFill = mounted ? '#f2a51a' : wired ? '#0aa4c8' : '#c5c7c6';
        const innerFill = mounted || wired ? '#173247' : '#42494d';
        return (
          <g key={hole.id} data-hole-id={hole.id} data-bus-id={hole.internalBusId}>
            <circle
              cx={hole.xMm}
              cy={hole.yMm}
              r={mounted || wired ? 0.78 : 0.64}
              fill={outerFill}
              stroke="#f8f8f5"
              strokeWidth={mounted || wired ? 0.3 : 0.22}
            />
            <circle cx={hole.xMm} cy={hole.yMm} r={0.31} fill={innerFill} />
            <circle
              cx={hole.xMm - 0.12}
              cy={hole.yMm - 0.13}
              r={0.09}
              fill="#ffffff"
              opacity={0.48}
            />
          </g>
        );
      })}
      <text
        x={41.75}
        y={52.9}
        textAnchor="middle"
        className="native-breadboard-brand"
        aria-hidden="true"
      >
        ASA LAB · 400
      </text>
    </g>
  );
}
