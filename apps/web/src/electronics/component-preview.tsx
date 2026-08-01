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
 * Catalogue thumbnail. A byte-exact owner SVG is the only component image.
 * Missing assets render a neutral empty slot rather than an invented drawing.
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
    <span
      className={`workbench-component-preview missing-owner-asset ${className}`}
      data-missing-owner-asset={preview}
      aria-hidden="true"
    />
  );
}
