import { resistorVisualCode } from './resistor-band-visual';

export interface NativeResistorGraphicProps {
  readonly valueOhm: number;
  readonly tolerancePercent?: 1 | 2 | 5 | 10;
}

/** Original ASA Lab axial resistor vector with value-derived colour bands. */
export function NativeResistorGraphic({
  valueOhm,
  tolerancePercent = 5,
}: NativeResistorGraphicProps) {
  const code = resistorVisualCode(valueOhm, tolerancePercent);
  const positions = [107, 121, 135, 149] as const;
  return (
    <g className="native-resistor-graphic" aria-hidden="true" pointerEvents="none">
      <path d="M0 47H90" stroke="#777f86" strokeWidth="8" strokeLinecap="round" />
      <path d="M170 47H260" stroke="#777f86" strokeWidth="8" strokeLinecap="round" />
      <path d="M0 47H90" stroke="#d2d5d7" strokeWidth="2" strokeLinecap="round" opacity="0.82" />
      <path d="M170 47H260" stroke="#d2d5d7" strokeWidth="2" strokeLinecap="round" opacity="0.82" />
      <rect x="90" y="24" width="80" height="46" rx="19" fill="#d8c29e" stroke="#9f8967" strokeWidth="2" />
      <rect x="96" y="29" width="68" height="12" rx="6" fill="#f1e3c6" opacity="0.42" />
      {code.bands.map((band, index) => (
        <g key={band.meaning}>
          <rect
            x={positions[index]}
            y="25"
            width="8"
            height="44"
            rx="1.5"
            fill={band.cssColor}
            stroke="#20262a"
            strokeOpacity="0.28"
            strokeWidth="0.7"
          />
          <title>{`${band.meaning}: ${band.color}`}</title>
        </g>
      ))}
      <circle cx="12" cy="47" r="7" fill="#f7f8f7" stroke="#24313b" strokeWidth="3" />
      <circle cx="248" cy="47" r="7" fill="#f7f8f7" stroke="#24313b" strokeWidth="3" />
      <text x="130" y="87" textAnchor="middle" fontSize="11" fontWeight="700" fill="#3c4850">
        {code.representedOhms.toLocaleString('ru-RU')} Ω ±{tolerancePercent}%
      </text>
    </g>
  );
}
