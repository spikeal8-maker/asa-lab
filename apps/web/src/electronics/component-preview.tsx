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
  | 'vibration-motor'
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

/**
 * Catalogue thumbnail. Only an explicit owner-archive SVG may draw a component.
 * Missing assets are shown as an honest disabled marker; the UI never invents a
 * substitute battery, board, motor or other physical part.
 */
export function ComponentPreview({ preview, asset, className = '' }: Props): JSX.Element {
  if (asset) {
    return (
      <img
        className={`workbench-component-preview ${className}`}
        src={asset}
        alt=""
        draggable={false}
        loading="lazy"
      />
    );
  }

  return (
    <svg
      className={`workbench-component-preview workbench-component-preview-missing ${className}`}
      viewBox="0 0 100 80"
      data-missing-preview={preview}
      aria-hidden="true"
    >
      <rect
        x="13"
        y="12"
        width="74"
        height="56"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <text x="50" y="38" textAnchor="middle" fontSize="10" fill="currentColor">
        нет SVG
      </text>
      <text x="50" y="52" textAnchor="middle" fontSize="8" fill="currentColor">
        владельца
      </text>
    </svg>
  );
}
