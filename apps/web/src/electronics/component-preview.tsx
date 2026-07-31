import type { ComponentKind } from '../api';

export type PreviewKey =
  | ComponentKind
  | 'button'
  | 'potentiometer'
  | 'capacitor'
  | 'slide-switch'
  | 'battery-9v'
  | 'coin-cell'
  | 'battery-aa'
  | 'breadboard'
  | 'microbit'
  | 'arduino'
  | 'servo'
  | 'motor'
  | 'transistor'
  | 'rgb-led'
  | 'diode'
  | 'photoresistor'
  | 'seven-segment';

interface Props {
  preview: PreviewKey;
  asset?: string | null;
  className?: string;
}

const RESISTOR_PREVIEW_ASSET =
  '/assets/electronics/production/components/resistor-axial-preview.svg';

/**
 * Catalogue thumbnail. Real sanitised SVG artwork always wins. The compact
 * inline drawings below are fallbacks only for archive gaps.
 */
export function ComponentPreview({ preview, asset, className = '' }: Props): JSX.Element {
  const resolvedAsset = preview === 'resistor' ? RESISTOR_PREVIEW_ASSET : asset;
  if (resolvedAsset) {
    return (
      <img
        className={`workbench-component-preview ${className}`}
        src={resolvedAsset}
        alt=""
        draggable={false}
        loading="lazy"
      />
    );
  }

  const common = {
    className: `workbench-component-preview ${className}`,
    viewBox: '0 0 100 80',
    'aria-hidden': true,
  } as const;

  switch (preview) {
    case 'coin-cell':
      return (
        <svg {...common}>
          <circle cx="50" cy="40" r="27" fill="#9a9a9a" stroke="#5d5d5d" strokeWidth="3" />
          <circle cx="50" cy="40" r="21" fill="#bcbcbc" />
          <text x="50" y="39" textAnchor="middle" fill="#555" fontSize="9">
            CR2032
          </text>
          <text x="50" y="50" textAnchor="middle" fill="#555" fontSize="11">
            3V
          </text>
        </svg>
      );
    case 'microbit':
      return (
        <svg {...common}>
          <rect x="14" y="18" width="72" height="45" rx="5" fill="#111827" />
          {Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 5 }, (_, column) => (
              <circle
                key={`${row}-${column}`}
                cx={35 + column * 8}
                cy={29 + row * 7}
                r="1.5"
                fill="#ef4444"
              />
            )),
          )}
          <path
            d="M25 63v11M38 63v11M50 63v11M62 63v11M75 63v11"
            stroke="#d4af37"
            strokeWidth="5"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="15" y="15" width="70" height="50" rx="8" fill="#eef1f5" stroke="#9aa4af" />
          <path d="M32 40h36" stroke="#66717d" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
  }
}
