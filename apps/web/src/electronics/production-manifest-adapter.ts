import type { ComponentKind, ProductionStateValue } from '../api';
import type { PreviewKey } from './component-preview';
import { BREADBOARD_PITCH_MM, WORLD_UNITS_PER_MM } from './production-asset-contracts';

export const OWNER_CATALOG_MANIFEST_URL = '/assets/electronics/owner-catalog/manifest.json';

export interface ProductionPin {
  readonly id: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly electricalRole: string;
  readonly toleranceMm: number;
}

export interface ProductionFootprint {
  readonly kind: string;
  readonly pinOffsetsMm?: readonly (readonly [number, number])[];
  readonly pitchMm?: number;
  readonly holeCount?: number;
}

export interface OwnerStateAsset {
  readonly state: string;
  readonly sourceOwnerArchive: string;
  readonly sourceOwnerPath: string;
  readonly sourceSha256: string;
  readonly runtimePath: string;
  readonly runtimeSha256: string;
}

export interface OwnerCatalogComponent {
  readonly componentId: string;
  readonly familyId: string;
  readonly familyLabelRu: string;
  readonly familyLabelEn: string;
  readonly variantId: string;
  readonly isDefaultVariant: boolean;
  readonly variantLabelRu: string;
  readonly variantLabelEn: string;
  readonly displayName: string;
  readonly displayNameEn: string;
  readonly category: string;
  readonly subcategoryId: string;
  readonly catalogOrder: number;
  readonly appearsInBasic: boolean;
  readonly searchAliases: readonly string[];
  readonly catalogTier: 'core' | 'preview';
  readonly sourceOwnerArchive: string | null;
  readonly sourceOwnerPath: string | null;
  readonly sourceSha256: string | null;
  readonly runtimePath: string | null;
  readonly runtimeSha256: string | null;
  readonly provenance: 'exact_owner_svg' | 'owner_supplied' | 'missing_owner_source';
  readonly status: 'enabled' | 'disabled_missing_svg' | 'disabled_missing_model';
  readonly physicalWidthMm: number | null;
  readonly physicalHeightMm: number | null;
  readonly viewBox: readonly [number, number, number, number] | null;
  readonly assetFit?: 'meet' | 'stretch';
  readonly pins: readonly ProductionPin[];
  readonly footprint: ProductionFootprint | null;
  readonly states: readonly string[];
  readonly stateAssets: readonly OwnerStateAsset[];
  readonly stateContract: Readonly<Record<string, unknown>> | null;
  readonly simulationSupport: string;
  readonly blockReason: string | null;
}

export interface BreadboardHoleDefinition {
  readonly id: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly groupId: string;
  readonly kind: string;
}

export interface RuntimeBreadboardDefinition {
  readonly componentId: string;
  readonly pitchMm: number;
  readonly holes: readonly BreadboardHoleDefinition[];
  readonly groups: Readonly<Record<string, readonly string[]>>;
}

export interface OwnerCatalogManifest {
  readonly schema: 'asa-lab.electronics-owner-catalog.v1';
  readonly worldUnitsPerMm: number;
  readonly policy: {
    readonly runtimeArt: 'byte_exact_owner_svg_only';
    readonly failClosed: true;
    readonly forbidden: readonly string[];
  };
  readonly breadboards: readonly RuntimeBreadboardDefinition[];
  readonly components: readonly OwnerCatalogComponent[];
}

export type ProductionCatalogCategory =
  | 'all'
  | 'power'
  | 'prototyping'
  | 'passives'
  | 'switches'
  | 'optoelectronics'
  | 'displays'
  | 'other';

export interface ProductionCatalogItem {
  readonly key: string;
  readonly familyId: string;
  readonly familyLabel: string;
  readonly variantId: string;
  readonly isDefaultVariant: boolean;
  readonly variantLabel: string;
  readonly subcategoryId: string;
  readonly catalogOrder: number;
  readonly catalogTier: 'core' | 'preview';
  readonly appearsInBasic: boolean;
  readonly blockReason: string | null;
  readonly kind: Exclude<ComponentKind, 'wire'>;
  readonly label: string;
  readonly semanticCategory: string;
  readonly category: Exclude<ProductionCatalogCategory, 'all'>;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly preview: PreviewKey;
  readonly asset: string;
  readonly stateAssets: Readonly<Record<string, string>>;
  readonly viewBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly physicalSizeMm: { readonly width: number; readonly height: number };
  readonly assetFit: 'meet' | 'stretch';
  readonly terminals: Readonly<Record<string, ProductionPin & { readonly label: string }>>;
  readonly footprint: ProductionFootprint | null;
  readonly defaultValue: number;
  readonly defaultState?: boolean;
  readonly defaultWiperPosition?: number;
  readonly defaultStateProperties: Readonly<Record<string, ProductionStateValue>>;
  readonly unit: string;
  readonly provenance: string;
  readonly catalogStatus: OwnerCatalogComponent['status'];
  readonly sourceOwnerPath: string;
  readonly sourceSha256: string;
  readonly runtimePath: string;
  readonly runtimeSha256: string;
  readonly sourceFile: string;
  readonly simulationSupported: boolean;
  readonly enabled: boolean;
}

let catalog: readonly ProductionCatalogItem[] = [];
let ownerItems: readonly ProductionCatalogItem[] = [];
let catalogById = new Map<string, ProductionCatalogItem>();
let boardsById = new Map<string, RuntimeBreadboardDefinition>();

const LEGACY_TYPE_BY_KIND: Readonly<Partial<Record<ComponentKind, string>>> = {
  source: 'battery-holder-aa-2',
  resistor: 'resistor-axial',
  led: 'led-5mm',
  button: 'button-tactile-6mm',
  switch: 'switch-spdt',
  potentiometer: 'potentiometer',
  diode: 'diode-do35',
  lamp: 'incandescent-lamp',
};

const SIMULATED_TYPES = new Set([
  'battery-holder-aa-1',
  'battery-holder-aa-2',
  'battery-holder-aa-3',
  'battery-holder-aa-4',
  'battery-holder-aa-6',
  'battery-holder-aa-8',
  'resistor-axial',
  'led-5mm',
  'button-tactile-6mm',
  'switch-spdt',
  'potentiometer',
  'diode-do35',
  'diode-do41',
  'incandescent-lamp',
  'rgb-led',
  'seven-segment-display',
]);

const COMPONENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  resistor:
    'Ограничивает электрический ток. Цветовые полосы показывают сопротивление и допуск.',
  led: 'Светится при правильной полярности; яркость рассчитывается по току в цепи.',
  button: 'Моментально замыкает контакты, пока кнопка нажата во время моделирования.',
  potentiometer: 'Регулируемый резистор: положение ручки изменяет положение движка.',
  capacitor: 'Накапливает электрический заряд и сглаживает изменения напряжения.',
  'spdt-switch': 'Переключает общий контакт между левым и правым выводами.',
  battery: 'Источник постоянного напряжения для питания схемы.',
  breadboard: 'Макетная плата для сборки цепей без пайки. Отверстия соединены группами.',
  microbit: 'Учебная микроконтроллерная плата micro:bit.',
  'arduino-uno': 'Микроконтроллерная плата Arduino Uno.',
  'vibration-motor': 'Миниатюрный двигатель, создающий вибрацию.',
  'dc-motor': 'Двигатель постоянного тока с управлением скоростью и направлением.',
  servo: 'Сервопривод с управляемым углом поворота.',
  'battery-holder-aa': 'Батарейный отсек AA: выберите количество элементов после размещения.',
  diode: 'Пропускает ток преимущественно в одном направлении.',
  'rgb-led': 'Четырёхконтактный RGB-светодиод смешивает красный, зелёный и синий каналы.',
  'seven-segment': 'Семисегментный индикатор отображает цифры и отдельные сегменты.',
  lamp: 'Лампа накаливания, яркость которой зависит от питания цепи.',
  'regulated-power-supply': 'Регулируемый лабораторный источник питания.',
  photoresistor: 'Фоторезистор изменяет сопротивление в зависимости от освещения.',
  'transistor-npn': 'NPN-транзистор для усиления и переключения электрического сигнала.',
  piezo: 'Пьезоизлучатель преобразует электрический сигнал в звук.',
  multimeter: 'Измерительный прибор для напряжения, тока и сопротивления.',
};

function componentKind(componentId: string): Exclude<ComponentKind, 'wire'> {
  if (/^battery(?:-|$)|^regulated-power-supply$/.test(componentId)) return 'source';
  if (componentId === 'resistor-axial') return 'resistor';
  if (componentId === 'led-5mm') return 'led';
  if (componentId === 'rgb-led') return 'rgb-led';
  if (componentId === 'seven-segment-display') return 'seven-segment';
  if (componentId === 'button-tactile-6mm') return 'button';
  if (componentId === 'switch-spdt') return 'switch';
  if (componentId === 'potentiometer') return 'potentiometer';
  if (componentId.startsWith('diode-')) return 'diode';
  if (componentId === 'incandescent-lamp') return 'lamp';
  if (componentId.startsWith('breadboard-')) return 'breadboard';
  return 'visual';
}

function category(value: string): Exclude<ProductionCatalogCategory, 'all'> {
  if (value === 'power') return 'power';
  if (value === 'prototyping') return 'prototyping';
  if (value === 'input') return 'switches';
  if (value === 'output') return 'optoelectronics';
  if (value === 'displays') return 'displays';
  if (['passives', 'semiconductors', 'sensors'].includes(value)) return 'passives';
  return 'other';
}

function preview(componentId: string, kind: Exclude<ComponentKind, 'wire'>): PreviewKey {
  if (componentId.startsWith('breadboard-')) return 'breadboard';
  if (componentId === 'arduino-uno') return 'arduino';
  if (componentId === 'servo-motor') return 'servo';
  if (componentId === 'dc-motor') return 'motor';
  if (componentId === 'vibration-motor') return 'vibration-motor';
  if (componentId === 'microbit') return 'microbit';
  if (componentId === 'transistor-npn') return 'transistor';
  if (componentId === 'photoresistor') return 'photoresistor';
  if (componentId === 'rgb-led') return 'rgb-led';
  if (componentId === 'seven-segment-display') return 'seven-segment';
  if (componentId === 'switch-spdt') return 'slide-switch';
  return kind;
}

function defaults(componentId: string): {
  value: number;
  unit: string;
  state?: boolean;
  wiperPosition?: number;
  properties: Readonly<Record<string, ProductionStateValue>>;
} {
  if (componentId.startsWith('battery-holder-aa-')) {
    const cells = Number(componentId.split('-').at(-1));
    return { value: cells * 1.5, unit: 'В', properties: { cells } };
  }
  if (componentId === 'resistor-axial')
    return { value: 220, unit: 'Ом', properties: { tolerancePercent: 5 } };
  if (componentId === 'led-5mm')
    return {
      value: 2,
      unit: 'В',
      properties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
    };
  if (componentId === 'rgb-led')
    return {
      value: 0,
      unit: '',
      properties: { red: 0, green: 0, blue: 0, commonMode: 'common-cathode' },
    };
  if (componentId === 'seven-segment-display')
    return {
      value: 0,
      unit: '',
      properties: { commonMode: 'common-cathode' },
    };
  if (componentId === 'button-tactile-6mm')
    return { value: 0, unit: '', state: false, properties: { contactState: 'released' } };
  if (componentId === 'switch-spdt')
    return { value: 0, unit: '', state: false, properties: { selectedThrow: 'left' } };
  if (componentId === 'potentiometer')
    return { value: 1_000, unit: 'Ом', wiperPosition: 0.5, properties: {} };
  if (componentId.startsWith('diode-')) return { value: 0.7, unit: 'В', properties: {} };
  if (componentId === 'incandescent-lamp')
    return { value: 24, unit: 'Ом', properties: { lampLevel: 'off' } };
  return { value: 0, unit: '', properties: { simulationStatus: 'not_yet_supported' } };
}

function pinLabel(componentId: string, pinId: string): string {
  const labels: Readonly<Record<string, string>> = {
    'BAT+': 'Положительный',
    'BAT-': 'Отрицательный',
    positive: 'Положительный',
    negative: 'Отрицательный',
    'lead-1': 'Вывод 1',
    'lead-2': 'Вывод 2',
    anode: 'Анод',
    cathode: 'Катод',
    'terminal-1': 'Клемма 1',
    'terminal-2': 'Клемма 2',
    wiper: 'Движок',
    L1: 'Клемма 1',
    L2: 'Клемма 2',
    common: 'Общий',
    'throw-left': 'Клемма 1',
    'throw-right': 'Клемма 2',
    'SW-A1': '1a',
    'SW-A2': '1b',
    'SW-B1': '2a',
    'SW-B2': '2b',
    red: 'R',
    green: 'G',
    blue: 'B',
  };
  const sevenSegmentLabels: Readonly<Record<string, string>> = {
    // Standard 10-pin single-digit display viewed from the front.
    'top-1': 'G',
    'top-2': 'F',
    'top-3': 'COM2',
    'top-4': 'A',
    'top-5': 'B',
    'bottom-1': 'E',
    'bottom-2': 'D',
    'bottom-3': 'COM1',
    'bottom-4': 'C',
    'bottom-5': 'DP',
  };
  if (componentId.startsWith('breadboard-')) return pinId;
  if (componentId === 'seven-segment-display') return sevenSegmentLabels[pinId] ?? pinId;
  return labels[pinId] ?? pinId;
}

function assertFailClosed(item: OwnerCatalogComponent): void {
  if (item.status === 'disabled_missing_svg') {
    if (item.runtimePath !== null || item.runtimeSha256 !== null) {
      throw new Error(`disabled owner catalog item exposes runtime art: ${item.componentId}`);
    }
    return;
  }
  if (
    item.provenance !== 'exact_owner_svg' ||
    !item.sourceOwnerPath ||
    !item.runtimePath?.startsWith('/assets/electronics/owner-audit/') ||
    !item.runtimePath.endsWith('.svg') ||
    item.sourceSha256 === null ||
    item.runtimeSha256 !== item.sourceSha256
  ) {
    throw new Error(`owner catalog rejected runtime substitution: ${item.componentId}`);
  }
  if (item.status === 'enabled') {
    if (
      item.physicalWidthMm === null ||
      item.physicalHeightMm === null ||
      !Number.isFinite(item.physicalWidthMm) ||
      !Number.isFinite(item.physicalHeightMm) ||
      item.physicalWidthMm <= 0 ||
      item.physicalHeightMm <= 0 ||
      item.viewBox === null
    ) {
      throw new Error(`owner catalog rejected unknown physical scale: ${item.componentId}`);
    }
    for (const pin of item.pins) {
      if (
        pin.xMm < 0 ||
        pin.xMm > item.physicalWidthMm ||
        pin.yMm < 0 ||
        pin.yMm > item.physicalHeightMm
      ) {
        throw new Error(`owner catalog rejected out-of-bounds pin: ${item.componentId}:${pin.id}`);
      }
    }
    if (
      item.footprint?.pinOffsetsMm &&
      item.footprint.pinOffsetsMm.length !== item.pins.length
    ) {
      throw new Error(`owner catalog rejected incomplete footprint: ${item.componentId}`);
    }
  }
  for (const state of item.stateAssets) {
    if (
      !state.runtimePath.startsWith('/assets/electronics/owner-audit/') ||
      !state.runtimePath.endsWith('.svg') ||
      state.runtimeSha256 !== state.sourceSha256
    ) {
      throw new Error(
        `owner catalog rejected state substitution: ${item.componentId}:${state.state}`,
      );
    }
  }
}

function toCatalogItem(item: OwnerCatalogComponent): ProductionCatalogItem {
  assertFailClosed(item);
  const kind = componentKind(item.componentId);
  const configured = defaults(item.componentId);
  const width = item.physicalWidthMm ?? 20;
  const height = item.physicalHeightMm ?? 16;
  const viewBox = item.viewBox ?? [0, 0, width, height];
  return {
    key: item.componentId,
    familyId: item.familyId,
    familyLabel: item.familyLabelRu,
    variantId: item.variantId,
    isDefaultVariant: item.isDefaultVariant,
    variantLabel: item.variantLabelRu,
    subcategoryId: item.subcategoryId,
    catalogOrder: item.catalogOrder,
    catalogTier: item.catalogTier,
    appearsInBasic: item.appearsInBasic,
    blockReason: item.blockReason,
    kind,
    label: item.displayName,
    semanticCategory: item.category,
    category: category(item.category),
    description:
      COMPONENT_DESCRIPTIONS[item.familyId] ??
      (item.status === 'enabled'
        ? 'Компонент из подтверждённого комплекта владельца.'
        : (item.blockReason ?? 'Недоступно.')),
    keywords: [
      ...item.searchAliases,
      item.componentId,
      item.displayName,
      item.displayNameEn,
      ...item.pins.map((pin) => pin.id),
    ],
    preview: preview(item.componentId, kind),
    asset: item.runtimePath ?? '',
    stateAssets: Object.fromEntries(
      item.stateAssets.map((state) => [state.state, state.runtimePath]),
    ),
    viewBox: { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] },
    physicalSizeMm: { width, height },
    assetFit: item.assetFit ?? 'meet',
    terminals: Object.fromEntries(
      item.pins.map((pin) => [pin.id, { ...pin, label: pinLabel(item.componentId, pin.id) }]),
    ),
    footprint: item.footprint,
    defaultValue: configured.value,
    ...(configured.state === undefined ? {} : { defaultState: configured.state }),
    ...(configured.wiperPosition === undefined
      ? {}
      : { defaultWiperPosition: configured.wiperPosition }),
    defaultStateProperties: configured.properties,
    unit: configured.unit,
    provenance: item.provenance,
    catalogStatus: item.status,
    sourceOwnerPath: item.sourceOwnerPath ?? '',
    sourceSha256: item.sourceSha256 ?? '',
    runtimePath: item.runtimePath ?? '',
    runtimeSha256: item.runtimeSha256 ?? '',
    sourceFile: item.sourceOwnerPath ?? '',
    simulationSupported: item.status === 'enabled' && SIMULATED_TYPES.has(item.componentId),
    enabled: item.status === 'enabled',
  };
}

export function configureProductionLibrary(manifest: OwnerCatalogManifest): void {
  if (manifest.schema !== 'asa-lab.electronics-owner-catalog.v1' || !manifest.policy.failClosed) {
    throw new Error('fail-closed owner Electronics catalog is unavailable');
  }
  if (manifest.worldUnitsPerMm !== WORLD_UNITS_PER_MM) {
    throw new Error(
      `owner catalog worldUnitsPerMm=${manifest.worldUnitsPerMm}, expected ${WORLD_UNITS_PER_MM}`,
    );
  }
  for (const board of manifest.breadboards) {
    if (board.pitchMm !== BREADBOARD_PITCH_MM) {
      throw new Error(
        `owner breadboard ${board.componentId} pitchMm=${board.pitchMm}, expected ${BREADBOARD_PITCH_MM}`,
      );
    }
  }
  ownerItems = manifest.components.map(toCatalogItem);
  catalog = ownerItems.filter((item) => item.enabled);
  catalogById = new Map(catalog.map((item) => [item.key, item]));
  boardsById = new Map(manifest.breadboards.map((board) => [board.componentId, board]));
}

export async function loadProductionLibrary(): Promise<void> {
  const response = await fetch(OWNER_CATALOG_MANIFEST_URL);
  if (!response.ok) throw new Error('owner Electronics catalog is unavailable');
  configureProductionLibrary((await response.json()) as OwnerCatalogManifest);
}

export function productionCatalog(): readonly ProductionCatalogItem[] {
  return catalog;
}
export function ownerCatalogItems(): readonly ProductionCatalogItem[] {
  return ownerItems;
}
export function productionCatalogEntry(componentTypeId: string): ProductionCatalogItem | null {
  return catalogById.get(componentTypeId) ?? null;
}
export function defaultProductionType(kind: ComponentKind): string | null {
  return LEGACY_TYPE_BY_KIND[kind] ?? null;
}
export function productionBreadboard(componentTypeId: string): RuntimeBreadboardDefinition | null {
  return boardsById.get(componentTypeId) ?? null;
}
export function productionLibraryReady(): boolean {
  return catalog.length > 0;
}
