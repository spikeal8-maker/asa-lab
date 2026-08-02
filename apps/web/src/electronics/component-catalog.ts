import type { ComponentKind, SchematicComponent, Terminal } from '../api';
import {
  defaultProductionType,
  ownerCatalogItems,
  productionCatalogEntry,
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

export type ComponentCategory =
  | 'basic'
  | 'all'
  | 'power'
  | 'prototyping'
  | 'passives'
  | 'semiconductors'
  | 'input'
  | 'output'
  | 'sensors'
  | 'motors'
  | 'controllers'
  | 'instruments'
  | 'preview';

export type SemanticComponentCategory = Exclude<ComponentCategory, 'basic' | 'all' | 'preview'>;
export type CatalogTier = 'core' | 'supported' | 'preview';
export type CatalogEntry = ProductionCatalogItem;
export type ComponentVisualState =
  'default' | 'off' | 'lit' | 'reverse' | 'overcurrent' | 'burned' | 'pressed' | 'on';

export interface CatalogVariant {
  readonly variantId: string;
  readonly variantLabel: string;
  readonly componentTypeId: string;
  readonly entry: CatalogEntry;
  readonly enabled: boolean;
  readonly blockReason: string | null;
}

export interface ComponentFamily {
  readonly familyId: string;
  readonly familyLabel: string;
  readonly categoryId: SemanticComponentCategory;
  readonly subcategoryId: string;
  readonly catalogTier: CatalogTier;
  readonly catalogOrder: number;
  readonly defaultVariantId: string;
  readonly variants: readonly CatalogVariant[];
  readonly searchAliases: readonly string[];
  readonly simulationStatus: 'supported' | 'not_yet_supported';
  readonly assetProvenance: readonly string[];
  readonly enabled: boolean;
  readonly appearsInBasic: boolean;
  readonly blockReason: string | null;
}

export const CATEGORY_OPTIONS: readonly {
  readonly id: ComponentCategory;
  readonly label: string;
}[] = [
  { id: 'basic', label: 'Основные' },
  { id: 'all', label: 'Все компоненты' },
  { id: 'power', label: 'Питание' },
  { id: 'prototyping', label: 'Макетки и монтаж' },
  { id: 'passives', label: 'Пассивные' },
  { id: 'semiconductors', label: 'Полупроводники' },
  { id: 'input', label: 'Ввод и управление' },
  { id: 'output', label: 'Вывод и индикация' },
  { id: 'sensors', label: 'Датчики' },
  { id: 'motors', label: 'Двигатели и приводы' },
  { id: 'controllers', label: 'Контроллеры' },
  { id: 'instruments', label: 'Измерительные приборы' },
  { id: 'preview', label: 'В разработке' },
];

export const CATEGORY_LABELS: Readonly<Record<ComponentCategory, string>> = Object.fromEntries(
  CATEGORY_OPTIONS.map((category) => [category.id, category.label]),
) as Readonly<Record<ComponentCategory, string>>;

export function workbenchCatalog(): readonly ComponentFamily[] {
  const ownerItems = ownerCatalogItems();
  const familiesWithOwnerArt = new Set(
    ownerItems.filter((item) => item.asset).map((item) => item.familyId),
  );
  const grouped = new Map<string, ProductionCatalogItem[]>();
  for (const item of ownerItems) {
    // A missing variant must not pollute a family that already has confirmed owner artwork.
    // Standalone missing families remain visible in the disabled preview category.
    if (!item.asset && familiesWithOwnerArt.has(item.familyId)) continue;
    grouped.set(item.familyId, [...(grouped.get(item.familyId) ?? []), item]);
  }
  return [...grouped.values()]
    .map((items): ComponentFamily => {
      const ordered = [...items].sort(
        (left, right) =>
          left.catalogOrder - right.catalogOrder || left.variantId.localeCompare(right.variantId),
      );
      const first = ordered[0] as ProductionCatalogItem;
      const enabled = ordered.some((item) => item.enabled);
      const defaultItem =
        ordered.find((item) => item.isDefaultVariant && item.enabled) ??
        ordered.find((item) => item.enabled) ??
        ordered.find((item) => item.isDefaultVariant) ??
        first;
      const blockReasons = [
        ...new Set(ordered.flatMap((item) => (item.blockReason ? [item.blockReason] : []))),
      ];
      return {
        familyId: first.familyId,
        familyLabel: first.familyLabel,
        categoryId: first.semanticCategory as SemanticComponentCategory,
        subcategoryId: first.subcategoryId,
        catalogTier: enabled ? 'core' : 'preview',
        catalogOrder: first.catalogOrder,
        defaultVariantId: defaultItem.variantId,
        variants: ordered.map((item) => ({
          variantId: item.variantId,
          variantLabel: item.variantLabel,
          componentTypeId: item.key,
          entry: item,
          enabled: item.enabled,
          blockReason: item.blockReason,
        })),
        searchAliases: [...new Set(ordered.flatMap((item) => item.keywords))],
        simulationStatus: ordered.some((item) => item.simulationSupported)
          ? 'supported'
          : 'not_yet_supported',
        assetProvenance: [...new Set(ordered.map((item) => item.provenance))],
        enabled,
        appearsInBasic: ordered.some((item) => item.appearsInBasic),
        blockReason: enabled ? null : blockReasons.join('; '),
      };
    })
    .sort(
      (left, right) =>
        left.catalogOrder - right.catalogOrder ||
        left.familyLabel.localeCompare(right.familyLabel, 'ru'),
    );
}

export function familyById(familyId: string): ComponentFamily | null {
  return workbenchCatalog().find((family) => family.familyId === familyId) ?? null;
}

export function familyForVariant(variantId: string | null | undefined): ComponentFamily | null {
  if (!variantId) return null;
  return (
    workbenchCatalog().find((family) =>
      family.variants.some((variant) => variant.variantId === variantId),
    ) ?? null
  );
}

export function selectedFamilyVariant(
  family: ComponentFamily,
  variantId: string | null | undefined,
): CatalogVariant {
  return (
    family.variants.find((variant) => variant.variantId === variantId && variant.enabled) ??
    family.variants.find(
      (variant) => variant.variantId === family.defaultVariantId && variant.enabled,
    ) ??
    family.variants.find((variant) => variant.enabled) ??
    (family.variants[0] as CatalogVariant)
  );
}

export function familyMatchesCategory(
  family: ComponentFamily,
  category: ComponentCategory,
): boolean {
  // The owner expects the default shelf to be a discoverable inventory, like
  // Tinkercad's "Basic" drawer. Unsupported owner items remain visible but
  // disabled, so nothing silently disappears from the supplied catalog.
  if (category === 'basic') return true;
  if (category === 'all') return true;
  if (category === 'preview') return !family.enabled;
  return family.categoryId === category;
}

export function familySearchText(family: ComponentFamily): string {
  return [
    family.familyId,
    family.familyLabel,
    family.categoryId,
    family.subcategoryId,
    ...family.searchAliases,
    ...family.variants.flatMap((variant) => [
      variant.variantId,
      variant.variantLabel,
      variant.entry.label,
      variant.entry.description,
      ...variant.entry.keywords,
    ]),
  ]
    .join(' ')
    .toLocaleLowerCase('ru');
}

export function catalogEntry(
  componentOrType: SchematicComponent | ComponentKind | string,
): CatalogEntry | null {
  if (typeof componentOrType === 'object') {
    const variant = componentOrType.variantId
      ? productionCatalogEntry(componentOrType.variantId)
      : null;
    if (variant) return variant;
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
    const brightness = Math.min(
      100,
      Math.max(0, Math.round(Number(component.stateProperties?.['ledBrightness'] ?? 0))),
    );
    const explicitFault = (component.stateProperties?.['ledFault'] ?? 'none') as OrdinaryLedFault;
    const fault: OrdinaryLedFault =
      visualState === 'reverse' || visualState === 'overcurrent' || visualState === 'burned'
        ? visualState
        : explicitFault;
    const normalizedBrightness = visualState === 'off' ? 0 : brightness;
    return ordinaryLedAsset(ordinaryLedState(colour, normalizedBrightness, fault));
  }
  if (entry.key === 'button-tactile-6mm')
    return entry.stateAssets[component.state ? 'pressed' : 'released'] ?? entry.asset;
  if (entry.key === 'switch-spdt')
    return entry.stateAssets[component.state ? 'right' : 'left'] ?? entry.asset;
  if (entry.key === 'incandescent-lamp') {
    const level = String(
      component.stateProperties?.['lampLevel'] ?? (visualState === 'lit' ? 'on' : 'off'),
    );
    return entry.stateAssets[level] ?? entry.asset;
  }
  return entry.asset;
}

export function componentPointPosition(
  componentOrType: SchematicComponent | ComponentKind | string,
  origin: { x: number; y: number },
  pointMm: { xMm: number; yMm: number },
  rotation = 0,
): { x: number; y: number } | null {
  const entry = catalogEntry(componentOrType);
  if (!entry) return null;
  const component = typeof componentOrType === 'object' ? componentOrType : null;
  const { width: baseWidth, height: baseHeight } = physicalToWorld(entry.physicalSizeMm);
  const originalPx = pointMm.xMm * WORLD_UNITS_PER_MM;
  const originalPy = pointMm.yMm * WORLD_UNITS_PER_MM;
  const px = component?.stateProperties?.['mirrorX'] === true ? baseWidth - originalPx : originalPx;
  const py =
    component?.stateProperties?.['mirrorY'] === true ? baseHeight - originalPy : originalPy;
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) return { x: origin.x + baseHeight - py, y: origin.y + px };
  if (normalized === 180) return { x: origin.x + baseWidth - px, y: origin.y + baseHeight - py };
  if (normalized === 270) return { x: origin.x + py, y: origin.y + baseWidth - px };
  return { x: origin.x + px, y: origin.y + py };
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
    switch: { a: 'common', b: component?.state === true ? 'throw-right' : 'throw-left' },
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
  return componentPointPosition(componentOrType, origin, spec, rotation);
}
