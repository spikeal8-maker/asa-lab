import type { ReactElement } from 'react';

/**
 * Render inside the L298N component's local SVG group, AFTER owner artwork and
 * BEFORE standard terminal hit-targets. The stage already uses 5 units per mm.
 * LED visual state must come from a committed circuit-simulation result.
 * The existing static LED painting is covered by this inexpensive overlay.
 */
export interface L298nLedOverlayProps {
  readonly powered: boolean;
  readonly componentId: string;
  readonly unitsPerMm?: number;
}
export function L298nLedOverlay({
  powered,
  componentId,
  unitsPerMm = 5,
}: L298nLedOverlayProps): ReactElement {
  const x = 12.18 * unitsPerMm;
  const y = 22.76 * unitsPerMm;
  return (
    <g
      data-l298n-led={componentId}
      data-l298n-led-state={powered ? 'on' : 'off'}
      pointerEvents="none"
    >
      {powered ? (
        <>
          <circle cx={x} cy={y} r={1.85 * unitsPerMm} fill="#ffcc43" opacity={0.12} />
          <circle cx={x} cy={y} r={1.14 * unitsPerMm} fill="#ffc439" opacity={0.31} />
        </>
      ) : null}
      <rect
        x={x - 0.94 * unitsPerMm}
        y={y - 0.52 * unitsPerMm}
        width={1.88 * unitsPerMm}
        height={1.04 * unitsPerMm}
        rx={0.18 * unitsPerMm}
        fill={powered ? '#efc24d' : '#665126'}
        stroke={powered ? '#fff2b1' : '#8b6a3c'}
        strokeWidth={0.11 * unitsPerMm}
      />
      <rect
        x={x - 0.62 * unitsPerMm}
        y={y - 0.29 * unitsPerMm}
        width={1.24 * unitsPerMm}
        height={0.58 * unitsPerMm}
        rx={0.15 * unitsPerMm}
        fill={powered ? '#fff6a4' : '#876330'}
      />
    </g>
  );
}
