import type { ComponentKind, SchematicComponent } from '../index.js';
import { ProductionComponentVisual } from './ProductionComponentVisual';
import { WORLD_UNITS_PER_MM } from './production-asset-contracts';
import type { ProductionCatalogItem } from './production-manifest-adapter';

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
  entry?: ProductionCatalogItem;
  className?: string;
}

/**
 * Catalogue thumbnail. Enabled components use the same measured production
 * renderer as the stage; unsupported owner items remain fail-closed.
 */
export function ComponentPreview({ preview, asset, entry, className = '' }: Props): JSX.Element {
  if (entry?.enabled && asset) {
    const component: SchematicComponent = {
      id: `catalog-preview-${entry.key}`,
      kind: entry.kind,
      componentTypeId: entry.key,
      variantId: entry.variantId,
      position: { x: 0, y: 0 },
      value: entry.defaultValue,
      ...(entry.defaultState === undefined ? {} : { state: entry.defaultState }),
      ...(entry.defaultWiperPosition === undefined
        ? {}
        : { wiperPosition: entry.defaultWiperPosition }),
      stateProperties: { ...entry.defaultStateProperties },
      pinIds: Object.keys(entry.terminals),
    };
    return (
      <span className={`workbench-component-vector-preview ${className}`} aria-hidden="true">
        <ProductionComponentVisual
          entry={entry}
          component={component}
          width={entry.physicalSizeMm.width * WORLD_UNITS_PER_MM}
          height={entry.physicalSizeMm.height * WORLD_UNITS_PER_MM}
          visualState="default"
          effectiveBrightness={0}
        />
      </span>
    );
  }
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
