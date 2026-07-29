import { HALF_BREADBOARD_VISUAL } from './native-breadboard-model';

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
 * model. It is intentionally renderer-only: electrical identity remains in the
 * domain terminal IDs and internal buses.
 */
export function NativeBreadboardGraphic() {
  const board = HALF_BREADBOARD_VISUAL;
  return (
    <g className="native-breadboard-graphic" pointerEvents="none" aria-hidden="true">
      <defs>
        <linearGradient id="asa-breadboard-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f6f5ef" />
          <stop offset="1" stopColor="#deddd6" />
        </linearGradient>
        <filter id="asa-breadboard-shadow" x="-8%" y="-10%" width="116%" height="124%">
          <feDropShadow dx="0" dy="0.8" stdDeviation="0.8" floodColor="#172431" floodOpacity="0.26" />
        </filter>
      </defs>
      <rect
        x={0.45}
        y={0.45}
        width={board.widthMm - 0.9}
        height={board.heightMm - 0.9}
        rx={2.2}
        fill="url(#asa-breadboard-body)"
        stroke="#a8afb2"
        strokeWidth={0.55}
        filter="url(#asa-breadboard-shadow)"
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
      {board.holes.map((hole) => (
        <g key={hole.id}>
          <circle
            cx={hole.xMm}
            cy={hole.yMm}
            r={0.64}
            fill="#c5c7c6"
            stroke="#f8f8f5"
            strokeWidth={0.22}
          />
          <circle cx={hole.xMm} cy={hole.yMm} r={0.31} fill="#42494d" />
          <circle cx={hole.xMm - 0.12} cy={hole.yMm - 0.13} r={0.09} fill="#ffffff" opacity={0.48} />
        </g>
      ))}
      <text x={41.75} y={52.9} textAnchor="middle" className="native-breadboard-brand" aria-hidden="true">
        ASA LAB · 400
      </text>
    </g>
  );
}
