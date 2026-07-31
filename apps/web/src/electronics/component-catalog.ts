import type { ComponentKind, SchematicComponent, Terminal } from '../api';
import {
  defaultProductionType,
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

interface FamilySpec {
  readonly familyId: string;
  readonly familyLabel: string;
  readonly categoryId: SemanticComponentCategory;
  readonly subcategoryId: string;
  readonly catalogTier: CatalogTier;
  readonly catalogOrder: number;
  readonly defaultVariantId: string;
  readonly variants: readonly (readonly [componentTypeId: string, variantLabel: string])[];
  readonly searchAliases: readonly string[];
  readonly appearsInBasic?: boolean;
}

const FAMILY_SPECS: readonly FamilySpec[] = [
  {
    familyId: 'breadboard',
    familyLabel: 'Макетная плата',
    categoryId: 'prototyping',
    subcategoryId: 'breadboards',
    catalogTier: 'core',
    catalogOrder: 1,
    defaultVariantId: 'breadboard-medium',
    variants: [
      ['breadboard-small', '170 точек'],
      ['breadboard-medium', '420 точек'],
      ['breadboard-large', '882 точки'],
    ],
    searchAliases: ['breadboard', 'макетка', 'макетная плата', '170', '420', '882'],
    appearsInBasic: true,
  },
  {
    familyId: 'battery-holder-aa',
    familyLabel: 'Батарейный отсек AA',
    categoryId: 'power',
    subcategoryId: 'battery-holders',
    catalogTier: 'core',
    catalogOrder: 2,
    defaultVariantId: 'battery-holder-aa-2',
    variants: [
      ['battery-holder-aa-1', '1×AA'],
      ['battery-holder-aa-2', '2×AA'],
      ['battery-holder-aa-3', '3×AA'],
      ['battery-holder-aa-4', '4×AA'],
      ['battery-holder-aa-6', '6×AA'],
      ['battery-holder-aa-8', '8×AA'],
    ],
    searchAliases: ['aa', 'battery holder', 'батарея', 'питание', 'отсек'],
    appearsInBasic: true,
  },
  {
    familyId: 'resistor',
    familyLabel: 'Резистор',
    categoryId: 'passives',
    subcategoryId: 'resistors',
    catalogTier: 'core',
    catalogOrder: 3,
    defaultVariantId: 'resistor-axial',
    variants: [['resistor-axial', 'Осевой']],
    searchAliases: ['resistor', 'сопротивление', 'ом', 'ohm', 'tolerance'],
    appearsInBasic: true,
  },
  {
    familyId: 'led',
    familyLabel: 'Светодиод',
    categoryId: 'output',
    subcategoryId: 'leds',
    catalogTier: 'core',
    catalogOrder: 4,
    defaultVariantId: 'led-5mm',
    variants: [['led-5mm', '5 мм']],
    searchAliases: ['led', 'светодиод', 'цвет', 'яркость', 'brightness'],
    appearsInBasic: true,
  },
  {
    familyId: 'button',
    familyLabel: 'Кнопка',
    categoryId: 'input',
    subcategoryId: 'buttons',
    catalogTier: 'core',
    catalogOrder: 5,
    defaultVariantId: 'button-tactile-6mm',
    variants: [['button-tactile-6mm', 'Тактовая 6×6 мм · 4 контакта']],
    searchAliases: ['button', 'кнопка', 'momentary', '4 pin'],
    appearsInBasic: true,
  },
  {
    familyId: 'spdt-switch',
    familyLabel: 'Переключатель SPDT',
    categoryId: 'input',
    subcategoryId: 'switches',
    catalogTier: 'core',
    catalogOrder: 6,
    defaultVariantId: 'switch-spdt',
    variants: [['switch-spdt', 'Ползунковый · 3 контакта']],
    searchAliases: ['spdt', 'switch', 'переключатель', 'common', '3 pin'],
    appearsInBasic: true,
  },
  {
    familyId: 'potentiometer',
    familyLabel: 'Потенциометр',
    categoryId: 'input',
    subcategoryId: 'variable-resistors',
    catalogTier: 'core',
    catalogOrder: 7,
    defaultVariantId: 'potentiometer',
    variants: [['potentiometer', 'Поворотный']],
    searchAliases: ['potentiometer', 'потенциометр', 'wiper', 'переменный резистор'],
    appearsInBasic: true,
  },
  {
    familyId: 'diode',
    familyLabel: 'Диод',
    categoryId: 'semiconductors',
    subcategoryId: 'diodes',
    catalogTier: 'core',
    catalogOrder: 8,
    defaultVariantId: 'diode-do41',
    variants: [
      ['diode-do35', 'DO-35'],
      ['diode-do41', 'DO-41'],
    ],
    searchAliases: ['diode', 'диод', 'do-35', 'do-41', 'полярность'],
    appearsInBasic: true,
  },
  {
    familyId: 'rgb-led',
    familyLabel: 'RGB-светодиод',
    categoryId: 'output',
    subcategoryId: 'leds',
    catalogTier: 'core',
    catalogOrder: 9,
    defaultVariantId: 'rgb-led',
    variants: [['rgb-led', '4 контакта']],
    searchAliases: ['rgb led', 'rgb-светодиод', 'red green blue', 'смешение'],
    appearsInBasic: true,
  },
  {
    familyId: 'seven-segment',
    familyLabel: 'Семисегментный индикатор',
    categoryId: 'output',
    subcategoryId: 'displays',
    catalogTier: 'core',
    catalogOrder: 10,
    defaultVariantId: 'seven-segment-display',
    variants: [['seven-segment-display', '1 разряд']],
    searchAliases: ['seven segment', '7 segment', 'семисегментный', 'индикатор'],
    appearsInBasic: true,
  },
  {
    familyId: 'lamp',
    familyLabel: 'Лампа',
    categoryId: 'output',
    subcategoryId: 'lamps',
    catalogTier: 'core',
    catalogOrder: 11,
    defaultVariantId: 'incandescent-lamp',
    variants: [['incandescent-lamp', 'Накаливания']],
    searchAliases: ['lamp', 'лампа', 'накаливания', 'light'],
    appearsInBasic: true,
  },
  {
    familyId: 'regulated-power-supply',
    familyLabel: 'Регулируемый источник питания',
    categoryId: 'power',
    subcategoryId: 'power-supplies',
    catalogTier: 'supported',
    catalogOrder: 20,
    defaultVariantId: 'regulated-power-supply',
    variants: [['regulated-power-supply', 'Лабораторный']],
    searchAliases: ['power supply', 'источник питания', 'блок питания'],
  },
  {
    familyId: 'capacitor',
    familyLabel: 'Конденсатор',
    categoryId: 'passives',
    subcategoryId: 'capacitors',
    catalogTier: 'preview',
    catalogOrder: 101,
    defaultVariantId: 'electrolytic-capacitor',
    variants: [['electrolytic-capacitor', 'Электролитический']],
    searchAliases: ['capacitor', 'конденсатор', 'электролитический'],
  },
  {
    familyId: 'photoresistor',
    familyLabel: 'Фоторезистор',
    categoryId: 'sensors',
    subcategoryId: 'light-sensors',
    catalogTier: 'preview',
    catalogOrder: 102,
    defaultVariantId: 'photoresistor',
    variants: [['photoresistor', 'Светочувствительный']],
    searchAliases: ['photoresistor', 'ldr', 'фоторезистор', 'датчик света'],
  },
  {
    familyId: 'transistor-npn',
    familyLabel: 'NPN-транзистор',
    categoryId: 'semiconductors',
    subcategoryId: 'transistors',
    catalogTier: 'preview',
    catalogOrder: 103,
    defaultVariantId: 'transistor-npn',
    variants: [['transistor-npn', 'NPN']],
    searchAliases: ['npn', 'transistor', 'транзистор'],
  },
  {
    familyId: 'dc-motor',
    familyLabel: 'Двигатель постоянного тока',
    categoryId: 'motors',
    subcategoryId: 'motors',
    catalogTier: 'preview',
    catalogOrder: 104,
    defaultVariantId: 'dc-motor',
    variants: [['dc-motor', 'DC']],
    searchAliases: ['dc motor', 'двигатель', 'мотор'],
  },
  {
    familyId: 'servo',
    familyLabel: 'Сервопривод',
    categoryId: 'motors',
    subcategoryId: 'servos',
    catalogTier: 'preview',
    catalogOrder: 105,
    defaultVariantId: 'servo-motor',
    variants: [['servo-motor', 'Микро']],
    searchAliases: ['servo', 'сервопривод', 'серво'],
  },
  {
    familyId: 'piezo',
    familyLabel: 'Пьезоэлемент',
    categoryId: 'output',
    subcategoryId: 'sound',
    catalogTier: 'preview',
    catalogOrder: 106,
    defaultVariantId: 'piezo',
    variants: [['piezo', 'Пьезо']],
    searchAliases: ['piezo', 'buzzer', 'пьезо', 'зуммер'],
  },
  {
    familyId: 'arduino-uno',
    familyLabel: 'Arduino Uno',
    categoryId: 'controllers',
    subcategoryId: 'boards',
    catalogTier: 'preview',
    catalogOrder: 107,
    defaultVariantId: 'arduino-uno',
    variants: [['arduino-uno', 'Uno']],
    searchAliases: ['arduino', 'uno', 'контроллер', 'микроконтроллер'],
  },
  {
    familyId: 'multimeter',
    familyLabel: 'Мультиметр',
    categoryId: 'instruments',
    subcategoryId: 'meters',
    catalogTier: 'preview',
    catalogOrder: 108,
    defaultVariantId: 'multimeter',
    variants: [['multimeter', 'Цифровой']],
    searchAliases: ['multimeter', 'мультиметр', 'meter', 'измерение'],
  },
];

function familyFromSpec(spec: FamilySpec): ComponentFamily | null {
  const variants = spec.variants.flatMap(([componentTypeId, variantLabel]) => {
    const entry = productionCatalogEntry(componentTypeId);
    return entry ? [{ variantId: componentTypeId, variantLabel, componentTypeId, entry }] : [];
  });
  if (
    variants.length === 0 ||
    !variants.some((variant) => variant.variantId === spec.defaultVariantId)
  ) {
    return null;
  }
  const enabled = spec.catalogTier !== 'preview';
  return {
    ...spec,
    variants,
    simulationStatus: enabled ? 'supported' : 'not_yet_supported',
    assetProvenance: [...new Set(variants.map((variant) => variant.entry.provenance))],
    enabled,
    appearsInBasic: spec.appearsInBasic === true,
  };
}

export function workbenchCatalog(): readonly ComponentFamily[] {
  return FAMILY_SPECS.flatMap((spec) => {
    const family = familyFromSpec(spec);
    return family ? [family] : [];
  }).sort(
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
    family.variants.find((variant) => variant.variantId === variantId) ??
    family.variants.find((variant) => variant.variantId === family.defaultVariantId) ??
    (family.variants[0] as CatalogVariant)
  );
}

export function familyMatchesCategory(
  family: ComponentFamily,
  category: ComponentCategory,
): boolean {
  if (category === 'basic') return family.enabled && family.appearsInBasic;
  if (category === 'all') return family.enabled;
  if (category === 'preview') return family.catalogTier === 'preview';
  return family.enabled && family.categoryId === category;
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
