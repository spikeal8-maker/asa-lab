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

const RGB_PIN_LAYOUTS: Readonly<Record<string, readonly string[]>> = {
  RCBG: ['red', 'common', 'blue', 'green'],
  RCGB: ['red', 'common', 'green', 'blue'],
  BRCG: ['blue', 'red', 'common', 'green'],
};

function stableTrig(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

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

// Tinkercad's Basic drawer is the visual reference for discoverability. Keep
// every confirmed owner family in the same relative order as the reference.
// Reference-only parts without confirmed owner SVGs are not invented here;
// they remain missing until their audited assets enter the owner manifest.
export const TINKERCAD_BASIC_FAMILY_ORDER = [
  'resistor',
  'led',
  'button',
  'potentiometer',
  'capacitor',
  'spdt-switch',
  'battery-9v',
  'battery-3v',
  'battery-1.5v',
  'breadboard',
  'arduino-uno',
  'vibration-motor',
  'dc-motor',
  'servo',
  'gearmotor',
  'transistor',
  'rgb-led',
  'diode',
  'photoresistor',
  'soil-moisture-sensor',
  'ultrasonic-sensor',
  'pir-sensor',
  'piezo',
  'temperature-sensor',
  'multimeter',
] as const;
const TINKERCAD_BASIC_FAMILY_INDEX = new Map<string, number>(
  TINKERCAD_BASIC_FAMILY_ORDER.map((familyId, index) => [familyId, index]),
);

const TINKERCAD_REFERENCE_PLACEHOLDERS: readonly {
  readonly familyId: string;
  readonly familyLabel: string;
  readonly categoryId: SemanticComponentCategory;
}[] = [
  { familyId: 'gearmotor', familyLabel: 'Мотор-редуктор', categoryId: 'motors' },
  {
    familyId: 'soil-moisture-sensor',
    familyLabel: 'Датчик влажности почвы',
    categoryId: 'sensors',
  },
  {
    familyId: 'ultrasonic-sensor',
    familyLabel: 'Ультразвуковой датчик',
    categoryId: 'sensors',
  },
  {
    familyId: 'pir-sensor',
    familyLabel: 'Пироэлектрический ИК-датчик',
    categoryId: 'sensors',
  },
  {
    familyId: 'temperature-sensor',
    familyLabel: 'Датчик температуры',
    categoryId: 'sensors',
  },
];

function referencePlaceholderItem(
  definition: (typeof TINKERCAD_REFERENCE_PLACEHOLDERS)[number],
): ProductionCatalogItem {
  const catalogOrder = TINKERCAD_BASIC_FAMILY_INDEX.get(definition.familyId) ?? 999;
  const blockReason = 'Ожидается подтверждённый SVG и электрическая модель.';
  return {
    key: definition.familyId,
    familyId: definition.familyId,
    familyLabel: definition.familyLabel,
    variantId: definition.familyId,
    isDefaultVariant: true,
    variantLabel: definition.familyLabel,
    subcategoryId: definition.categoryId,
    catalogOrder,
    catalogTier: 'preview',
    appearsInBasic: true,
    blockReason,
    kind: 'visual',
    label: definition.familyLabel,
    semanticCategory: definition.categoryId,
    category: 'other',
    description: blockReason,
    keywords: [definition.familyId, definition.familyLabel],
    preview: 'visual',
    asset: '',
    stateAssets: {},
    viewBox: { x: 0, y: 0, width: 20, height: 16 },
    physicalSizeMm: { width: 20, height: 16 },
    assetFit: 'meet',
    terminals: {},
    footprint: null,
    defaultValue: 0,
    defaultStateProperties: {},
    unit: '',
    provenance: 'missing_owner_source',
    catalogStatus: 'disabled_missing_svg',
    sourceOwnerPath: '',
    sourceSha256: '',
    runtimePath: '',
    runtimeSha256: '',
    sourceFile: '',
    simulationSupported: false,
    enabled: false,
  };
}

export function workbenchCatalog(): readonly ComponentFamily[] {
  const manifestItems = ownerCatalogItems();
  const manifestFamilyIds = new Set(manifestItems.map((item) => item.familyId));
  const ownerItems = [
    ...manifestItems,
    ...TINKERCAD_REFERENCE_PLACEHOLDERS.filter(
      (definition) => !manifestFamilyIds.has(definition.familyId),
    ).map(referencePlaceholderItem),
  ];
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
    .sort((left, right) => {
      const leftReferenceOrder = TINKERCAD_BASIC_FAMILY_INDEX.get(left.familyId);
      const rightReferenceOrder = TINKERCAD_BASIC_FAMILY_INDEX.get(right.familyId);
      if (leftReferenceOrder !== undefined || rightReferenceOrder !== undefined) {
        return (
          (leftReferenceOrder ?? Number.MAX_SAFE_INTEGER) -
          (rightReferenceOrder ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return (
        left.catalogOrder - right.catalogOrder ||
        left.familyLabel.localeCompare(right.familyLabel, 'ru')
      );
    });
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
  // Basic is a stable Tinkercad-parity shelf, not an alias for the whole
  // manifest. Extra owner components remain available under All and their
  // semantic category without continuously reshuffling the reference shelf.
  if (category === 'basic') return TINKERCAD_BASIC_FAMILY_INDEX.has(family.familyId);
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
    // Tinkercad keeps the selected LED colour visible while the current is
    // above the recommended 20 mA and presents the warning separately. Do not
    // replace the emitting bulb with the orange audit asset in that state.
    const fault: OrdinaryLedFault =
      visualState === 'reverse' || visualState === 'burned' ? visualState : explicitFault;
    // A stopped or electrically-off LED must use the exact 0% owner state. The package
    // still keeps its selected body colour, but no light is emitted until the solver
    // reports current through the LED.
    const normalizedBrightness =
      visualState === 'default' || visualState === 'off' || visualState === 'reverse'
        ? 0
        : brightness;
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
  const radians = (normalized * Math.PI) / 180;
  const cos = stableTrig(Math.cos(radians));
  const sin = stableTrig(Math.sin(radians));
  const rendered = renderedSize(entry, normalized);
  const relativeX = px - baseWidth / 2;
  const relativeY = py - baseHeight / 2;
  return {
    x: origin.x + rendered.width / 2 + relativeX * cos - relativeY * sin,
    y: origin.y + rendered.height / 2 + relativeX * sin + relativeY * cos,
  };
}

export function renderedSize(entry: CatalogEntry, rotation = 0): { width: number; height: number } {
  const original = physicalToWorld(entry.physicalSizeMm);
  const radians = ((((rotation % 360) + 360) % 360) * Math.PI) / 180;
  const cos = Math.abs(stableTrig(Math.cos(radians)));
  const sin = Math.abs(stableTrig(Math.sin(radians)));
  return {
    width: original.width * cos + original.height * sin,
    height: original.width * sin + original.height * cos,
  };
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
    piezo: { a: 'positive', b: 'negative' },
    lamp: { a: 'L1', b: 'L2' },
  };
  const resolved = entry?.terminals[terminal]
    ? terminal
    : component
      ? (aliases[component.kind]?.[terminal] ?? terminal)
      : terminal;
  let spec = entry?.terminals[resolved];
  if (entry && component?.kind === 'rgb-led') {
    const layout = RGB_PIN_LAYOUTS[String(component.stateProperties?.['pinLayout'] ?? 'RCBG')];
    const slot = layout?.indexOf(resolved) ?? -1;
    const physicalPins = Object.values(entry.terminals)
      .filter((pin) => ['red', 'common', 'green', 'blue'].includes(pin.id))
      .sort((left, right) => left.xMm - right.xMm);
    if (slot >= 0 && physicalPins[slot]) spec = physicalPins[slot];
  }
  if (!entry || !spec) return null;
  return componentPointPosition(componentOrType, origin, spec, rotation);
}

export function physicalTerminalOrder(component: SchematicComponent): readonly string[] {
  const entry = catalogEntry(component);
  if (!entry) return component.pinIds ?? [];
  if (component.kind !== 'rgb-led') return component.pinIds ?? Object.keys(entry.terminals);
  return (
    RGB_PIN_LAYOUTS[String(component.stateProperties?.['pinLayout'] ?? 'RCBG')] ??
    RGB_PIN_LAYOUTS['RCBG']!
  ).filter((terminal) => entry.terminals[terminal]);
}
