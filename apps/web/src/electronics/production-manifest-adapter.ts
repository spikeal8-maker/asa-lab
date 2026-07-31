import type { ComponentKind, ProductionStateValue } from '../api';
import type { PreviewKey } from './component-preview';
import { WORLD_UNITS_PER_MM } from './production-asset-contracts';

export const PRODUCTION_MANIFEST_URL = '/assets/electronics/production/manifest.json';
export const BREADBOARD_CONNECTIVITY_URL =
  '/assets/electronics/production/breadboard-connectivity.json';

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

export interface ProductionStateAsset {
  readonly state: string;
  readonly file: string;
}

export interface ProductionManifestComponent {
  readonly componentId: string;
  readonly displayName: string;
  readonly category: string;
  readonly status: string;
  readonly provenance: string | null;
  readonly productionSvg: string | null;
  readonly physicalWidthMm: number | null;
  readonly physicalHeightMm: number | null;
  readonly viewBox: readonly [number, number, number, number] | null;
  readonly pins: readonly ProductionPin[];
  readonly footprint: ProductionFootprint | null;
  readonly stateContract: Readonly<Record<string, unknown>> | null;
  readonly stateAssets: { readonly states: readonly ProductionStateAsset[] } | null;
}

export interface ProductionManifest {
  readonly worldUnitsPerMm: number;
  readonly components: readonly ProductionManifestComponent[];
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

export interface BreadboardConnectivityManifest {
  readonly boards: readonly RuntimeBreadboardDefinition[];
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
  readonly kind: Exclude<ComponentKind, 'wire'>;
  readonly label: string;
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
  readonly terminals: Readonly<Record<string, ProductionPin & { readonly label: string }>>;
  readonly footprint: ProductionFootprint | null;
  readonly defaultValue: number;
  readonly defaultState?: boolean;
  readonly defaultWiperPosition?: number;
  readonly defaultStateProperties: Readonly<Record<string, ProductionStateValue>>;
  readonly unit: string;
  readonly provenance: string;
  readonly sourceFile: string;
  readonly simulationSupported: boolean;
  readonly enabled: true;
}

let catalog: readonly ProductionCatalogItem[] = [];
let catalogById = new Map<string, ProductionCatalogItem>();
let boardsById = new Map<string, RuntimeBreadboardDefinition>();

const LEGACY_TYPE_BY_KIND: Readonly<Partial<Record<ComponentKind, string>>> = {
  source: 'battery-6v',
  resistor: 'resistor-axial',
  led: 'led-5mm',
  button: 'button-tactile-6mm',
  switch: 'switch-spdt',
  potentiometer: 'potentiometer',
  diode: 'diode-do35',
  lamp: 'incandescent-lamp',
};

const SIMULATED_TYPES = new Set([
  'battery-1.5v',
  'battery-3v',
  'battery-6v',
  'battery-9v',
  'battery-holder-aa-1',
  'battery-holder-aa-2',
  'battery-holder-aa-3',
  'battery-holder-aa-4',
  'battery-holder-aa-6',
  'battery-holder-aa-8',
  'regulated-power-supply',
  'resistor-axial',
  'led-5mm',
  'button-tactile-6mm',
  'switch-spdt',
  'potentiometer',
  'diode-do35',
  'diode-do41',
  'incandescent-lamp',
]);

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
  if (value === 'switches') return 'switches';
  if (value === 'optoelectronics') return 'optoelectronics';
  if (value === 'displays') return 'displays';
  if (['passives', 'semiconductors', 'sensors'].includes(value)) return 'passives';
  return 'other';
}

function preview(componentId: string, kind: Exclude<ComponentKind, 'wire'>): PreviewKey {
  if (componentId.startsWith('breadboard-')) return 'breadboard';
  if (componentId === 'arduino-uno') return 'arduino';
  if (componentId === 'servo-motor') return 'servo';
  if (componentId === 'dc-motor') return 'motor';
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
  if (componentId === 'battery-1.5v') return { value: 1.5, unit: 'В', properties: {} };
  if (componentId === 'battery-3v') return { value: 3, unit: 'В', properties: {} };
  if (componentId === 'battery-6v') return { value: 6, unit: 'В', properties: {} };
  if (componentId === 'battery-9v') return { value: 9, unit: 'В', properties: {} };
  if (componentId === 'regulated-power-supply') return { value: 5, unit: 'В', properties: {} };
  if (componentId === 'resistor-axial') {
    return { value: 300, unit: 'Ом', properties: { tolerancePercent: 5 } };
  }
  if (componentId === 'led-5mm') {
    return {
      value: 2,
      unit: 'В',
      properties: { ledColour: 'red', ledBrightness: 60, ledFault: 'none' },
    };
  }
  if (componentId === 'rgb-led') {
    return {
      value: 0,
      unit: '',
      properties: { red: 100, green: 45, blue: 0, commonMode: 'common-cathode' },
    };
  }
  if (componentId === 'seven-segment-display') {
    return {
      value: 0,
      unit: '',
      properties: { glyph: '0', segmentMask: '', segmentBrightness: 100 },
    };
  }
  if (componentId === 'button-tactile-6mm') {
    return { value: 0, unit: '', state: false, properties: { contactState: 'released' } };
  }
  if (componentId === 'switch-spdt') {
    return { value: 0, unit: '', state: false, properties: { selectedThrow: 'left' } };
  }
  if (componentId === 'potentiometer') {
    return { value: 1000, unit: 'Ом', wiperPosition: 0.5, properties: {} };
  }
  if (componentId.startsWith('diode-')) return { value: 0.7, unit: 'В', properties: {} };
  if (componentId === 'incandescent-lamp') {
    return { value: 24, unit: 'Ом', properties: { lampLevel: 'off' } };
  }
  return { value: 0, unit: '', properties: { simulationStatus: 'not_yet_supported' } };
}

function pinLabel(componentId: string, pinId: string): string {
  const labels: Readonly<Record<string, string>> = {
    'BAT+': '+',
    'BAT-': '−',
    'lead-1': '1',
    'lead-2': '2',
    anode: 'A',
    cathode: 'K',
    'terminal-1': '1',
    'terminal-2': '2',
    wiper: 'W',
    L1: '1',
    L2: '2',
    common: 'C',
    'throw-left': 'L',
    'throw-right': 'R',
  };
  if (componentId.startsWith('breadboard-')) return pinId;
  return labels[pinId] ?? pinId;
}

function description(item: ProductionManifestComponent, supported: boolean): string {
  const source =
    item.provenance === 'exact_owner_svg' ? 'точный owner SVG' : 'owner-reference vector';
  return supported
    ? `${source}; физический масштаб и выводы из production manifest.`
    : `${source}; визуальный компонент, электрическая модель пока не поддерживается.`;
}

function toCatalogItem(item: ProductionManifestComponent): ProductionCatalogItem | null {
  if (
    item.status === 'missing_reference' ||
    item.productionSvg === null ||
    item.physicalWidthMm === null ||
    item.physicalHeightMm === null
  ) {
    return null;
  }
  const kind = componentKind(item.componentId);
  const configured = defaults(item.componentId);
  const stateAssets = Object.fromEntries(
    (item.stateAssets?.states ?? []).map((state) => [state.state, state.file]),
  );
  const viewBox = item.viewBox ?? [0, 0, item.physicalWidthMm, item.physicalHeightMm];
  return {
    key: item.componentId,
    kind,
    label: item.displayName,
    category: category(item.category),
    description: description(item, SIMULATED_TYPES.has(item.componentId)),
    keywords: [
      item.componentId,
      item.displayName,
      item.category,
      ...item.pins.map((pin) => pin.id),
    ],
    preview: preview(item.componentId, kind),
    asset: item.productionSvg,
    stateAssets,
    viewBox: { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] },
    physicalSizeMm: { width: item.physicalWidthMm, height: item.physicalHeightMm },
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
    provenance: item.provenance ?? 'unknown',
    sourceFile: item.productionSvg,
    simulationSupported: SIMULATED_TYPES.has(item.componentId),
    enabled: true,
  };
}

export function configureProductionLibrary(
  manifest: ProductionManifest,
  connectivity: BreadboardConnectivityManifest,
): void {
  if (manifest.worldUnitsPerMm !== WORLD_UNITS_PER_MM) {
    throw new Error(
      `production manifest worldUnitsPerMm=${manifest.worldUnitsPerMm}, expected ${WORLD_UNITS_PER_MM}`,
    );
  }
  const next = manifest.components.flatMap((item) => {
    const adapted = toCatalogItem(item);
    return adapted === null ? [] : [adapted];
  });
  catalog = next;
  catalogById = new Map(next.map((item) => [item.key, item]));
  boardsById = new Map(connectivity.boards.map((board) => [board.componentId, board]));
}

export async function loadProductionLibrary(): Promise<void> {
  const [manifestResponse, connectivityResponse] = await Promise.all([
    fetch(PRODUCTION_MANIFEST_URL),
    fetch(BREADBOARD_CONNECTIVITY_URL),
  ]);
  if (!manifestResponse.ok || !connectivityResponse.ok) {
    throw new Error('production Electronics manifest is unavailable');
  }
  configureProductionLibrary(
    (await manifestResponse.json()) as ProductionManifest,
    (await connectivityResponse.json()) as BreadboardConnectivityManifest,
  );
}

export function productionCatalog(): readonly ProductionCatalogItem[] {
  return catalog;
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
