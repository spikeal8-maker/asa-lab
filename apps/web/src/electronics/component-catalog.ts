import type { ComponentKind } from '../api';
import type { PreviewKey } from './component-preview';

/**
 * Visual definitions used by the electronics workbench.
 *
 * Every `asset` below is a sanitised, still-vector SVG copied from the owner's
 * `Компоненты.zip` archive unless `authored` is explicitly false. Active parts
 * expose simulation-aware state assets and exact terminal coordinates from the
 * source package. Future parts are visible in the catalogue as real artwork,
 * but remain disabled until their electrical model exists.
 */

export type ComponentCategory = 'all' | 'basic' | 'power' | 'inputs' | 'outputs' | 'boards';
export type ComponentVisualState =
  'default' | 'off' | 'lit' | 'reverse' | 'overcurrent' | 'burned' | 'pressed' | 'on';

export interface TerminalSpec {
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface CatalogEntry {
  readonly key: string;
  readonly kind: ComponentKind | null;
  readonly label: string;
  readonly category: Exclude<ComponentCategory, 'all'>;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly preview: PreviewKey;
  readonly asset: string | null;
  readonly stateAssets?: Partial<Record<ComponentVisualState, string>>;
  readonly viewBox: { readonly width: number; readonly height: number };
  readonly renderWidth: number;
  readonly terminals: { readonly a: TerminalSpec; readonly b: TerminalSpec } | null;
  readonly defaultValue: number;
  readonly unit: string;
  readonly authored: boolean;
  readonly sourceFile: string;
  readonly enabled: boolean;
}

const ASSET_ROOT = '/assets/electronics/components';

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  all: 'Основные',
  basic: 'Основные',
  power: 'Питание',
  inputs: 'Входы',
  outputs: 'Выходы',
  boards: 'Платы и макетки',
};

const ACTIVE: CatalogEntry[] = [
  {
    key: 'source',
    kind: 'source',
    label: 'Батарейный отсек',
    category: 'power',
    description: 'Авторский батарейный отсек 2×AA, 3 В.',
    keywords: ['источник', 'батарея', 'питание', 'aa', '3v', '3 в'],
    preview: 'source',
    asset: `${ASSET_ROOT}/power-source.svg`,
    viewBox: { width: 485, height: 843 },
    renderWidth: 118,
    terminals: {
      a: { x: 295.5, y: 74, label: '+' },
      b: { x: 190.5, y: 74, label: '−' },
    },
    defaultValue: 3,
    unit: 'В',
    authored: true,
    sourceFile: 'aa_holder_2x_sketch_exact_v6.svg',
    enabled: true,
  },
  {
    key: 'resistor',
    kind: 'resistor',
    label: 'Резистор',
    category: 'basic',
    description: 'Токоограничивающий резистор. Вектор создан по спецификации ASA Lab.',
    keywords: ['резистор', 'сопротивление', 'ом', '300'],
    preview: 'resistor',
    asset: `${ASSET_ROOT}/resistor.svg`,
    viewBox: { width: 260, height: 96 },
    renderWidth: 164,
    terminals: {
      a: { x: 12, y: 48, label: '1' },
      b: { x: 248, y: 48, label: '2' },
    },
    defaultValue: 300,
    unit: 'Ом',
    authored: false,
    sourceFile: 'native SVG drawn from owner specification; replace when authored artwork exists',
    enabled: true,
  },
  {
    key: 'led',
    kind: 'led',
    label: 'Светодиод',
    category: 'outputs',
    description: 'Авторский светодиод с реальными SVG-кадрами состояния.',
    keywords: ['светодиод', 'led', 'лампа', 'индикатор', 'красный'],
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
    renderWidth: 92,
    terminals: {
      a: { x: 83, y: 372, label: 'A' },
      b: { x: 209, y: 372, label: 'K' },
    },
    defaultValue: 2,
    unit: 'В',
    authored: true,
    sourceFile: 'led_v9_verified_pack (off/lit/reverse/overcurrent/burned states)',
    enabled: true,
  },
];

function future(options: {
  key: string;
  label: string;
  category: Exclude<ComponentCategory, 'all'>;
  preview: PreviewKey;
  description: string;
  asset?: string;
  stateAssets?: Partial<Record<ComponentVisualState, string>>;
  sourceFile?: string;
  authored?: boolean;
}): CatalogEntry {
  return {
    key: options.key,
    kind: null,
    label: options.label,
    category: options.category,
    description: options.description,
    keywords: [options.label.toLowerCase(), options.key],
    preview: options.preview,
    asset: options.asset ? `${ASSET_ROOT}/${options.asset}` : null,
    stateAssets: options.stateAssets
      ? Object.fromEntries(
          Object.entries(options.stateAssets).map(([state, file]) => [
            state,
            `${ASSET_ROOT}/${file}`,
          ]),
        )
      : undefined,
    viewBox: { width: 100, height: 80 },
    renderWidth: 100,
    terminals: null,
    defaultValue: 0,
    unit: '',
    authored: options.authored ?? true,
    sourceFile: options.sourceFile ?? 'owner component archive / future implementation',
    enabled: false,
  };
}

const FUTURE: CatalogEntry[] = [
  future({
    key: 'button',
    label: 'Кнопка',
    category: 'inputs',
    preview: 'button',
    description: 'Авторская кнопка с отпущенным и нажатым SVG-состоянием.',
    asset: 'button-up.svg',
    stateAssets: { default: 'button-up.svg', pressed: 'button-down.svg' },
  }),
  future({
    key: 'potentiometer',
    label: 'Потенциометр',
    category: 'inputs',
    preview: 'potentiometer',
    description: 'Регулируемое сопротивление.',
    asset: 'potentiometer.svg',
  }),
  future({
    key: 'capacitor',
    label: 'Конденсатор',
    category: 'basic',
    preview: 'capacitor',
    description: 'Накопление заряда и временные процессы.',
    asset: 'capacitor.svg',
  }),
  future({
    key: 'slide-switch',
    label: 'Ползунковый переключатель',
    category: 'inputs',
    preview: 'slide-switch',
    description: 'Авторский переключатель с двумя SVG-положениями.',
    asset: 'switch-left.svg',
    stateAssets: { default: 'switch-left.svg', on: 'switch-right.svg' },
  }),
  future({
    key: 'battery-9v',
    label: 'Батарея 9 В',
    category: 'power',
    preview: 'battery-9v',
    description: 'Источник постоянного напряжения 9 В.',
    asset: 'battery-9v.svg',
  }),
  future({
    key: 'coin-cell',
    label: 'Кнопочная батарея 3 В',
    category: 'power',
    preview: 'coin-cell',
    description: 'Компактный источник 3 В. В архиве пока нет отдельного SVG.',
    authored: false,
  }),
  future({
    key: 'battery-aa',
    label: 'Батарея 1,5 В',
    category: 'power',
    preview: 'battery-aa',
    description: 'Один элемент AA из авторского набора.',
    asset: 'battery-aa.svg',
  }),
  future({
    key: 'adjustable-source',
    label: 'Регулируемый источник',
    category: 'power',
    preview: 'battery-9v',
    description:
      'Источник с регулируемым напряжением; крупный asset будет подключён отдельным оптимизационным проходом.',
  }),
  future({
    key: 'breadboard',
    label: 'Малая макетная плата',
    category: 'boards',
    preview: 'breadboard',
    description:
      'Авторская макетная плата; крупный asset будет подключён вместе с моделью внутренних шин.',
  }),
  future({
    key: 'microbit',
    label: 'micro:bit',
    category: 'boards',
    preview: 'microbit',
    description: 'Учебная микроконтроллерная плата. Пока только место в каталоге.',
    authored: false,
  }),
  future({
    key: 'arduino',
    label: 'Arduino Uno',
    category: 'boards',
    preview: 'arduino',
    description: 'Авторский вектор Arduino будет подключён после оптимизации большого SVG.',
  }),
  future({
    key: 'servo',
    label: 'Сервопривод',
    category: 'outputs',
    preview: 'servo',
    description: 'Авторский привод будет подключён вместе с моделью управления.',
  }),
  future({
    key: 'motor',
    label: 'Двигатель постоянного тока',
    category: 'outputs',
    preview: 'motor',
    description: 'Простой электродвигатель.',
    asset: 'motor.svg',
  }),
  future({
    key: 'buzzer',
    label: 'Пьезодинамик',
    category: 'outputs',
    preview: 'motor',
    description: 'Звуковой излучатель.',
    asset: 'buzzer.svg',
  }),
  future({
    key: 'lamp',
    label: 'Лампа накаливания',
    category: 'outputs',
    preview: 'led',
    description: 'Авторская лампа с выключенным и светящимся SVG-состоянием.',
    asset: 'lamp-off.svg',
    stateAssets: { default: 'lamp-off.svg', on: 'lamp-on.svg' },
  }),
  future({
    key: 'transistor',
    label: 'NPN-транзистор',
    category: 'basic',
    preview: 'transistor',
    description: 'Ключ и усилитель.',
    asset: 'transistor.svg',
  }),
  future({
    key: 'rgb-led',
    label: 'RGB-светодиод',
    category: 'outputs',
    preview: 'rgb-led',
    description: 'Авторский RGB-светодиод с отдельными SVG-состояниями.',
    asset: 'rgb-led-off.svg',
    stateAssets: { default: 'rgb-led-off.svg', lit: 'rgb-led-lit.svg' },
  }),
  future({
    key: 'diode',
    label: 'Диод',
    category: 'basic',
    preview: 'diode',
    description: 'Авторский диод; электрическая модель будет добавлена позже.',
    asset: 'diode.svg',
  }),
  future({
    key: 'photoresistor',
    label: 'Фоторезистор',
    category: 'inputs',
    preview: 'photoresistor',
    description: 'Датчик освещённости.',
    asset: 'photoresistor.svg',
  }),
  future({
    key: 'seven-segment',
    label: 'Семисегментный индикатор',
    category: 'outputs',
    preview: 'seven-segment',
    description: 'Авторский многоконтактный индикатор.',
    asset: 'seven-segment.svg',
  }),
];

export const WORKBENCH_CATALOG: readonly CatalogEntry[] = [...ACTIVE, ...FUTURE];
export const ACTIVE_COMPONENTS: Record<Exclude<ComponentKind, 'wire'>, CatalogEntry> = {
  source: ACTIVE[0] as CatalogEntry,
  resistor: ACTIVE[1] as CatalogEntry,
  led: ACTIVE[2] as CatalogEntry,
};

export function catalogEntry(kind: ComponentKind): CatalogEntry | null {
  return kind === 'wire' ? null : ACTIVE_COMPONENTS[kind];
}

export function visualAsset(
  entry: CatalogEntry,
  state: ComponentVisualState = 'default',
): string | null {
  return entry.stateAssets?.[state] ?? entry.stateAssets?.default ?? entry.asset;
}

export function renderedSize(entry: CatalogEntry, rotation = 0): { width: number; height: number } {
  const scale = entry.renderWidth / entry.viewBox.width;
  const original = { width: entry.renderWidth, height: entry.viewBox.height * scale };
  return Math.abs(rotation % 180) === 90
    ? { width: original.height, height: original.width }
    : original;
}

export function terminalPosition(
  kind: ComponentKind,
  origin: { x: number; y: number },
  terminal: 'a' | 'b',
  rotation = 0,
): { x: number; y: number } | null {
  const entry = catalogEntry(kind);
  if (!entry?.terminals) return null;
  const scale = entry.renderWidth / entry.viewBox.width;
  const baseWidth = entry.renderWidth;
  const baseHeight = entry.viewBox.height * scale;
  const spec = entry.terminals[terminal];
  const px = spec.x * scale;
  const py = spec.y * scale;
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) return { x: origin.x + baseHeight - py, y: origin.y + px };
  if (normalized === 180) return { x: origin.x + baseWidth - px, y: origin.y + baseHeight - py };
  if (normalized === 270) return { x: origin.x + py, y: origin.y + baseWidth - px };
  return { x: origin.x + px, y: origin.y + py };
}
