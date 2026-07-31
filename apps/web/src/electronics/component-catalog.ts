import type { ComponentKind, SchematicComponent, Terminal } from '../api';
import {
  defaultProductionType,
  productionCatalog,
  productionCatalogEntry,
  type ProductionCatalogCategory,
  type ProductionCatalogItem,
} from './production-manifest-adapter';
import {
  ordinaryLedAsset,
  ordinaryLedState,
  physicalToWorld,
  WORLD_UNITS_PER_MM,
  type OrdinaryLedColour,
  type OrdinaryLedFault,
} from './production-asset-contracts';

export type ComponentCategory = ProductionCatalogCategory;
export type CatalogEntry = ProductionCatalogItem;
export type ComponentVisualState =
  'default' | 'off' | 'lit' | 'reverse' | 'overcurrent' | 'burned' | 'pressed' | 'on';

export const CATEGORY_LABELS: Readonly<Record<ComponentCategory, string>> = {
  all: 'Все компоненты',
  power: 'Питание',
  prototyping: 'Макетки',
  passives: 'Пассивные и датчики',
  switches: 'Кнопки и переключатели',
  optoelectronics: 'Светодиоды',
  displays: 'Индикаторы',
  other: 'Остальные',
};

export function workbenchCatalog(): readonly CatalogEntry[] {
  return productionCatalog();
}

export function catalogEntry(
  componentOrType: SchematicComponent | ComponentKind | string,
): CatalogEntry | null {
  if (typeof componentOrType === 'object') {
    const componentTypeId =
      componentOrType.componentTypeId ?? defaultProductionType(componentOrType.kind);
    return componentTypeId ? productionCatalogEntry(componentTypeId) : null;
  }
  const exact = productionCatalogEntry(componentOrType);
  if (exact) return exact;
  const fallbackType = defaultProductionType(componentOrType as ComponentKind);
  return fallbackType ? productionCatalogEntry(fallbackType) : null;
}

export function visualAsset(
  entry: CatalogEntry,
  component?: SchematicComponent,
  visualState: ComponentVisualState = 'default',
): string {
  if (!component) return entry.asset;
  if (entry.key === 'led-5mm') {
    const colour = (component.stateProperties?.['ledColour'] ?? 'red') as OrdinaryLedColour;
    const brightness = Number(component.stateProperties?.['ledBrightness'] ?? 0);
    const explicitFault = (component.stateProperties?.['ledFault'] ?? 'none') as OrdinaryLedFault;
    const fault: OrdinaryLedFault =
      visualState === 'reverse' || visualState === 'overcurrent' || visualState === 'burned'
        ? visualState
        : explicitFault;
    return ordinaryLedAsset(
      ordinaryLedState(colour, visualState === 'off' ? 0 : brightness, fault),
    );
  }
  if (entry.key === 'button-tactile-6mm') {
    return entry.stateAssets[component.state ? 'pressed' : 'released'] ?? entry.asset;
  }
  if (entry.key === 'switch-spdt') {
    return entry.stateAssets[component.state ? 'right' : 'left'] ?? entry.asset;
  }
  if (entry.key === 'incandescent-lamp') {
    const level = String(
      visualState === 'lit' ? 'on' : (component.stateProperties?.['lampLevel'] ?? 'off'),
    );
    return entry.stateAssets[level] ?? entry.asset;
  }
  return entry.asset;
}

export function renderedSize(entry: CatalogEntry, rotation = 0): { width: number; height: number } {
  const original = physicalToWorld(entry.physicalSizeMm);
  return Math.abs(rotation % 180) === 90
    ? { width: original.height, height: original.width }
    : original;
}

export function terminalPosition(
  componentOrType: SchematicComponent | ComponentKind | string,
  origin: { x: number; y: number },
  terminal: Terminal,
  rotation = 0,
): { x: number; y: number } | null {
  const entry = catalogEntry(componentOrType);
  const component = typeof componentOrType === 'object' ? componentOrType : null;
  const aliases: Readonly<Partial<Record<ComponentKind, Readonly<Record<string, string>>>>> = {
    source: {
      a: entry?.terminals['BAT+'] ? 'BAT+' : 'positive',
      b: entry?.terminals['BAT-'] ? 'BAT-' : 'negative',
    },
    resistor: { a: 'lead-1', b: 'lead-2' },
    led: { a: 'anode', b: 'cathode' },
    button: { a: 'SW-A1', b: 'SW-B1' },
    switch: {
      a: 'common',
      b: component?.state === true ? 'throw-right' : 'throw-left',
    },
    potentiometer: { a: 'terminal-1', b: 'terminal-2', wiper: 'wiper' },
    diode: { a: 'anode', b: 'cathode' },
    lamp: { a: 'L1', b: 'L2' },
  };
  const resolved = entry?.terminals[terminal]
    ? terminal
    : component
      ? (aliases[component.kind]?.[terminal] ?? terminal)
      : terminal;
  const spec = entry?.terminals[resolved];
  if (!entry || !spec) return null;
  const { width: baseWidth, height: baseHeight } = physicalToWorld(entry.physicalSizeMm);
  const px = spec.xMm * WORLD_UNITS_PER_MM;
  const py = spec.yMm * WORLD_UNITS_PER_MM;
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) return { x: origin.x + baseHeight - py, y: origin.y + px };
  if (normalized === 180) return { x: origin.x + baseWidth - px, y: origin.y + baseHeight - py };
  if (normalized === 270) return { x: origin.x + py, y: origin.y + baseWidth - px };
  return { x: origin.x + px, y: origin.y + py };
}
