import type { ComponentKind, Terminal } from '../api';
import type { PreviewKey } from './component-preview';
import { physicalToWorld, type PhysicalSizeMm } from './production-asset-contracts';

export type ComponentCategory = 'all' | 'basic' | 'power' | 'inputs' | 'outputs';
export type ComponentVisualState =
  'default' | 'off' | 'lit' | 'reverse' | 'overcurrent' | 'burned' | 'pressed' | 'on';

export interface TerminalSpec {
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface CatalogEntry {
  readonly key: string;
  readonly kind: Exclude<ComponentKind, 'wire'>;
  readonly label: string;
  readonly category: Exclude<ComponentCategory, 'all'>;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly preview: PreviewKey;
  readonly asset: string;
  readonly stateAssets?: Partial<Record<ComponentVisualState, string>>;
  readonly viewBox: { readonly width: number; readonly height: number };
  readonly physicalSizeMm: PhysicalSizeMm;
  readonly terminals: Readonly<Partial<Record<Terminal, TerminalSpec>>>;
  readonly defaultValue: number;
  readonly defaultState?: boolean;
  readonly defaultWiperPosition?: number;
  readonly unit: string;
  readonly authored: boolean;
  readonly sourceFile: string;
  readonly enabled: true;
}

const ASSET_ROOT = '/assets/electronics/components';

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  all: 'Все компоненты',
  basic: 'Основные',
  power: 'Питание',
  inputs: 'Управление',
  outputs: 'Выходы',
};

const ACTIVE: readonly CatalogEntry[] = [
  {
    key: 'source',
    kind: 'source',
    label: 'Источник постоянного тока',
    category: 'power',
    description: 'Идеальный источник постоянного напряжения.',
    keywords: ['источник', 'батарея', 'питание', 'dc', 'напряжение'],
    preview: 'source',
    asset: `${ASSET_ROOT}/power-source.svg`,
    viewBox: { width: 485, height: 843 },
    physicalSizeMm: { width: 23.524, height: 40.846 },
    terminals: { a: { x: 295.5, y: 74, label: '+' }, b: { x: 190.5, y: 74, label: '−' } },
    defaultValue: 5,
    unit: 'В',
    authored: true,
    sourceFile: 'power-source.svg',
    enabled: true,
  },
  {
    key: 'resistor',
    kind: 'resistor',
    label: 'Резистор',
    category: 'basic',
    description: 'Постоянное сопротивление для ограничения тока и делителей.',
    keywords: ['резистор', 'сопротивление', 'ом', 'делитель'],
    preview: 'resistor',
    asset: `${ASSET_ROOT}/resistor.svg`,
    viewBox: { width: 260, height: 96 },
    physicalSizeMm: { width: 11.582, height: 4.277 },
    terminals: { a: { x: 12, y: 48, label: '1' }, b: { x: 248, y: 48, label: '2' } },
    defaultValue: 300,
    unit: 'Ом',
    authored: true,
    sourceFile: 'resistor.svg',
    enabled: true,
  },
  {
    key: 'led',
    kind: 'led',
    label: 'Светодиод',
    category: 'outputs',
    description: 'Полярный светодиод с прямым падением и контролем тока.',
    keywords: ['светодиод', 'led', 'индикатор', 'анод', 'катод'],
    preview: 'led',
    asset: `${ASSET_ROOT}/led-red-off.svg`,
    stateAssets: {
      default: `${ASSET_ROOT}/led-red-off.svg`,
      off: `${ASSET_ROOT}/led-red-off.svg`,
      lit: `${ASSET_ROOT}/led-red-lit.svg`,
      reverse: `${ASSET_ROOT}/led-red-reverse.svg`,
      overcurrent: `${ASSET_ROOT}/led-red-overcurrent.svg`,
      burned: `${ASSET_ROOT}/led-red-burned.svg`,
    },
    viewBox: { width: 240, height: 400 },
    physicalSizeMm: { width: 7.735, height: 12.892 },
    terminals: { a: { x: 83, y: 372, label: 'A' }, b: { x: 209, y: 372, label: 'K' } },
    defaultValue: 2,
    unit: 'В',
    authored: true,
    sourceFile: 'led-red-state-pack.svg',
    enabled: true,
  },
  {
    key: 'button',
    kind: 'button',
    label: 'Кнопка',
    category: 'inputs',
    description: 'Нормально-разомкнутая кнопка; нажмите на компонент для управления.',
    keywords: ['кнопка', 'button', 'нормально разомкнутая', 'no'],
    preview: 'button',
    asset: `${ASSET_ROOT}/button-up.svg`,
    stateAssets: {
      default: `${ASSET_ROOT}/button-up.svg`,
      pressed: `${ASSET_ROOT}/button-down.svg`,
    },
    viewBox: { width: 10, height: 10 },
    physicalSizeMm: { width: 6, height: 6 },
    terminals: { a: { x: 0.7, y: 5, label: '1' }, b: { x: 9.3, y: 5, label: '2' } },
    defaultValue: 0,
    defaultState: false,
    unit: '',
    authored: true,
    sourceFile: 'button-up.svg/button-down.svg',
    enabled: true,
  },
  {
    key: 'switch',
    kind: 'switch',
    label: 'Переключатель',
    category: 'inputs',
    description: 'Фиксируемый переключатель цепи.',
    keywords: ['переключатель', 'switch', 'ключ', 'замкнуть'],
    preview: 'slide-switch',
    asset: `${ASSET_ROOT}/switch-left.svg`,
    stateAssets: { default: `${ASSET_ROOT}/switch-left.svg`, on: `${ASSET_ROOT}/switch-right.svg` },
    viewBox: { width: 18, height: 10 },
    physicalSizeMm: { width: 18, height: 10 },
    terminals: { a: { x: 1.5, y: 9, label: '1' }, b: { x: 16.5, y: 9, label: '2' } },
    defaultValue: 0,
    defaultState: false,
    unit: '',
    authored: true,
    sourceFile: 'switch-left.svg/switch-right.svg',
    enabled: true,
  },
  {
    key: 'potentiometer',
    kind: 'potentiometer',
    label: 'Потенциометр',
    category: 'inputs',
    description: 'Трёхвыводный регулируемый делитель напряжения.',
    keywords: ['потенциометр', 'переменный резистор', 'делитель', 'wiper'],
    preview: 'potentiometer',
    asset: `${ASSET_ROOT}/potentiometer.svg`,
    viewBox: { width: 180, height: 140 },
    physicalSizeMm: { width: 12.131, height: 13.66 },
    terminals: {
      a: { x: 25, y: 127, label: '1' },
      wiper: { x: 90, y: 127, label: 'W' },
      b: { x: 155, y: 127, label: '2' },
    },
    defaultValue: 1000,
    defaultWiperPosition: 0.5,
    unit: 'Ом',
    authored: true,
    sourceFile: 'asa-potentiometer.svg',
    enabled: true,
  },
  {
    key: 'diode',
    kind: 'diode',
    label: 'Диод',
    category: 'basic',
    description: 'Полупроводниковый диод с контролем полярности.',
    keywords: ['диод', 'diode', 'анод', 'катод', 'полярность'],
    preview: 'diode',
    asset: `${ASSET_ROOT}/diode.svg`,
    viewBox: { width: 220, height: 90 },
    physicalSizeMm: { width: 20, height: 7 },
    terminals: { a: { x: 10, y: 45, label: 'A' }, b: { x: 210, y: 45, label: 'K' } },
    defaultValue: 0.7,
    unit: 'В',
    authored: true,
    sourceFile: 'asa-diode.svg',
    enabled: true,
  },
  {
    key: 'lamp',
    kind: 'lamp',
    label: 'Лампа',
    category: 'outputs',
    description: 'Резистивная лампа с визуальным состоянием питания.',
    keywords: ['лампа', 'lamp', 'накаливания', 'нагрузка'],
    preview: 'lamp',
    asset: `${ASSET_ROOT}/lamp-off.svg`,
    stateAssets: {
      default: `${ASSET_ROOT}/lamp-off.svg`,
      off: `${ASSET_ROOT}/lamp-off.svg`,
      lit: `${ASSET_ROOT}/lamp-on.svg`,
    },
    viewBox: { width: 180, height: 180 },
    physicalSizeMm: { width: 20, height: 30 },
    terminals: { a: { x: 52, y: 166, label: '1' }, b: { x: 128, y: 166, label: '2' } },
    defaultValue: 24,
    unit: 'Ом',
    authored: true,
    sourceFile: 'asa-lamp.svg',
    enabled: true,
  },
];

export const WORKBENCH_CATALOG = ACTIVE;
export const ACTIVE_COMPONENTS = Object.fromEntries(
  ACTIVE.map((entry) => [entry.kind, entry]),
) as Record<Exclude<ComponentKind, 'wire'>, CatalogEntry>;

export function catalogEntry(kind: ComponentKind): CatalogEntry | null {
  return kind === 'wire' ? null : ACTIVE_COMPONENTS[kind];
}

export function visualAsset(entry: CatalogEntry, state: ComponentVisualState = 'default'): string {
  return entry.stateAssets?.[state] ?? entry.stateAssets?.default ?? entry.asset;
}

export function renderedSize(entry: CatalogEntry, rotation = 0): { width: number; height: number } {
  const original = physicalToWorld(entry.physicalSizeMm);
  return Math.abs(rotation % 180) === 90
    ? { width: original.height, height: original.width }
    : original;
}

export function terminalPosition(
  kind: ComponentKind,
  origin: { x: number; y: number },
  terminal: Terminal,
  rotation = 0,
): { x: number; y: number } | null {
  const entry = catalogEntry(kind);
  const spec = entry?.terminals[terminal];
  if (!entry || !spec) return null;
  const { width: baseWidth, height: baseHeight } = physicalToWorld(entry.physicalSizeMm);
  const px = (spec.x / entry.viewBox.width) * baseWidth;
  const py = (spec.y / entry.viewBox.height) * baseHeight;
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) return { x: origin.x + baseHeight - py, y: origin.y + px };
  if (normalized === 180) return { x: origin.x + baseWidth - px, y: origin.y + baseHeight - py };
  if (normalized === 270) return { x: origin.x + py, y: origin.y + baseWidth - px };
  return { x: origin.x + px, y: origin.y + py };
}
