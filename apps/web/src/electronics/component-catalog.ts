import type { ComponentKind } from '../api';
import type { PreviewKey } from './component-preview';
import {
  BREADBOARD_PITCH_MM,
  formatMillimetres,
  renderWidthForTerminalSpan,
  snapWorkbench,
  workbenchUnitsToMm,
  type PhysicalComponentSpec,
  type PlacementSpec,
} from './workbench-scale';

/**
 * Visual definitions used by the electronics workbench.
 *
 * Active components use owner/ASA vector assets and are calibrated against the
 * standard 2.54 mm breadboard pitch. Future components remain visible but
 * disabled until their real asset, terminal map, electrical model and exact
 * reference behavior are verified.
 */

export type ComponentCategory = 'all' | 'basic' | 'power' | 'inputs' | 'outputs' | 'boards';
export type ComponentVisualState =
  | 'default'
  | 'off'
  | 'lit'
  | 'reverse'
  | 'overcurrent'
  | 'burned'
  | 'pressed'
  | 'on';
export type TerminalElectricalRole =
  | 'passive'
  | 'positive'
  | 'negative'
  | 'anode'
  | 'cathode'
  | 'signal'
  | 'power'
  | 'ground';

export interface TerminalSpec {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly role: TerminalElectricalRole;
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
  readonly stateAssets?: Partial<Record<ComponentVisualState, string>> | undefined;
  readonly viewBox: { readonly width: number; readonly height: number };
  /** Render width in workbench units; derived from terminal pitch for active parts. */
  readonly renderWidth: number;
  readonly terminals: { readonly a: TerminalSpec; readonly b: TerminalSpec } | null;
  readonly physical: PhysicalComponentSpec;
  readonly placement: PlacementSpec;
  readonly defaultValue: number;
  readonly unit: string;
  readonly authored: boolean;
  readonly sourceFile: string;
  readonly enabled: boolean;
}

export interface PointLike {
  readonly x: number;
  readonly y: number;
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

const SOURCE_TERMINALS = {
  a: { id: 'positive', x: 295.5, y: 74, label: '+', role: 'positive' },
  b: { id: 'negative', x: 190.5, y: 74, label: '−', role: 'negative' },
} as const satisfies { a: TerminalSpec; b: TerminalSpec };
const RESISTOR_TERMINALS = {
  a: { id: 'lead-1', x: 12, y: 48, label: '1', role: 'passive' },
  b: { id: 'lead-2', x: 248, y: 48, label: '2', role: 'passive' },
} as const satisfies { a: TerminalSpec; b: TerminalSpec };
const LED_TERMINALS = {
  a: { id: 'anode', x: 83, y: 372, label: 'A', role: 'anode' },
  b: { id: 'cathode', x: 209, y: 372, label: 'K', role: 'cathode' },
} as const satisfies { a: TerminalSpec; b: TerminalSpec };

const ACTIVE: CatalogEntry[] = [
  {
    key: 'source',
    kind: 'source',
    label: 'Батарейный отсек',
    category: 'power',
    description: 'Двухэлементный отсек 2×AA, откалиброванный по шагу макетной платы.',
    keywords: ['источник', 'батарея', 'питание', 'aa', '3v', '3 в'],
    preview: 'source',
    asset: `${ASSET_ROOT}/power-source.svg`,
    viewBox: { width: 485, height: 843 },
    renderWidth: renderWidthForTerminalSpan(
      485,
      SOURCE_TERMINALS.a.x,
      SOURCE_TERMINALS.b.x,
      4,
    ),
    terminals: SOURCE_TERMINALS,
    physical: {
      bodyMm: { width: 44, height: 76.6, depth: 16 },
      terminalSpanPitches: 4,
      evidence: 'owner_asset_calibrated',
      source: 'owner SVG snap-points contain 10.16 mm terminal separation',
    },
    placement: { gridDivisor: 2, anchorTerminal: 'a' },
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
    description: 'Осевой резистор с расстоянием выводов 10 шагов макетной платы.',
    keywords: ['резистор', 'сопротивление', 'ом', '300'],
    preview: 'resistor',
    asset: `${ASSET_ROOT}/resistor.svg`,
    viewBox: { width: 260, height: 96 },
    renderWidth: renderWidthForTerminalSpan(
      260,
      RESISTOR_TERMINALS.a.x,
      RESISTOR_TERMINALS.b.x,
      10,
    ),
    terminals: RESISTOR_TERMINALS,
    physical: {
      bodyMm: { width: 6.3, height: 2.5, depth: 2.5 },
      terminalSpanPitches: 10,
      evidence: 'manufacturer_typical',
      source: 'typical axial 1/4 W body; lead span chosen for educational breadboard placement',
    },
    placement: { gridDivisor: 2, anchorTerminal: 'a' },
    defaultValue: 300,
    unit: 'Ом',
    authored: false,
    sourceFile: 'native ASA SVG; replace only with owner-approved vector artwork',
    enabled: true,
  },
  {
    key: 'led',
    kind: 'led',
    label: 'Светодиод',
    category: 'outputs',
    description: 'Красный LED 5 мм, выводы привязаны к одному шагу макетной платы.',
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
    renderWidth: renderWidthForTerminalSpan(240, LED_TERMINALS.a.x, LED_TERMINALS.b.x, 1),
    terminals: LED_TERMINALS,
    physical: {
      bodyMm: { width: 5, height: 8.6, depth: 5 },
      terminalSpanPitches: 1,
      evidence: 'manufacturer_typical',
      source: 'typical 5 mm through-hole LED with 2.54 mm lead pitch',
    },
    placement: { gridDivisor: 2, anchorTerminal: 'a' },
    defaultValue: 2,
    unit: 'В',
    authored: true,
    sourceFile: 'led_v9_verified_pack (off/lit/reverse/overcurrent/burned states)',
    enabled: true,
  },
];

function provisionalPhysical(
  width: number,
  height: number,
  source = 'provisional target; verify against owner/reference evidence before enabling',
): PhysicalComponentSpec {
  return {
    bodyMm: { width, height },
    evidence: 'reference_capture_required',
    source,
  };
}

function future(options: {
  key: string;
  label: string;
  category: Exclude<ComponentCategory, 'all'>;
  preview: PreviewKey;
  description: string;
  physical: PhysicalComponentSpec;
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
      ? (Object.fromEntries(
          Object.entries(options.stateAssets).map(([state, file]) => [
            state,
            `${ASSET_ROOT}/${file}`,
          ]),
        ) as Partial<Record<ComponentVisualState, string>>)
      : undefined,
    viewBox: { width: 100, height: 80 },
    renderWidth: 100,
    terminals: null,
    physical: options.physical,
    placement: { gridDivisor: 2, anchorTerminal: null },
    defaultValue: 0,
    unit: '',
    authored: options.authored ?? true,
    sourceFile: options.sourceFile ?? 'owner component archive / future implementation',
    enabled: false,
  };
}

// Disabled parts are intentionally honest: their geometry is a planning target,
// not evidence that the exact Tinkercad/reference asset or electrical model is complete.
const FUTURE: CatalogEntry[] = [
  future({
    key: 'button',
    label: 'Кнопка',
    category: 'inputs',
    preview: 'button',
    description: 'Моментальная кнопка с отпущенным и нажатым состоянием.',
    physical: provisionalPhysical(6, 6),
  }),
  future({
    key: 'potentiometer',
    label: 'Потенциометр',
    category: 'inputs',
    preview: 'potentiometer',
    description: 'Трёхвыводное регулируемое сопротивление.',
    physical: provisionalPhysical(10, 10),
  }),
  future({
    key: 'capacitor',
    label: 'Конденсатор',
    category: 'basic',
    preview: 'capacitor',
    description: 'Накопление заряда и временные процессы.',
    physical: provisionalPhysical(5, 8),
  }),
  future({
    key: 'slide-switch',
    label: 'Ползунковый переключатель',
    category: 'inputs',
    preview: 'slide-switch',
    description: 'Переключатель с устойчивыми положениями.',
    physical: provisionalPhysical(12, 5),
  }),
  future({
    key: 'battery-9v',
    label: 'Батарея 9 В',
    category: 'power',
    preview: 'battery-9v',
    description: 'Источник постоянного напряжения 9 В.',
    physical: provisionalPhysical(26.5, 48.5),
  }),
  future({
    key: 'coin-cell',
    label: 'Кнопочная батарея 3 В',
    category: 'power',
    preview: 'coin-cell',
    description: 'Компактный источник CR2032.',
    authored: false,
    physical: provisionalPhysical(20, 3.2),
  }),
  future({
    key: 'battery-aa',
    label: 'Батарея 1,5 В',
    category: 'power',
    preview: 'battery-aa',
    description: 'Один элемент AA.',
    physical: provisionalPhysical(14.5, 50.5),
  }),
  future({
    key: 'adjustable-source',
    label: 'Регулируемый источник',
    category: 'power',
    preview: 'battery-9v',
    description: 'Источник с регулируемым напряжением и ограничением тока.',
    physical: provisionalPhysical(55, 35),
  }),
  future({
    key: 'breadboard',
    label: 'Малая макетная плата',
    category: 'boards',
    preview: 'breadboard',
    description: 'Макетная плата с внутренними шинами и шагом отверстий 2,54 мм.',
    physical: provisionalPhysical(
      47,
      35,
      `typical mini breadboard target; hole pitch is fixed at ${BREADBOARD_PITCH_MM} mm`,
    ),
  }),
  future({
    key: 'microbit',
    label: 'micro:bit',
    category: 'boards',
    preview: 'microbit',
    description: 'Учебная микроконтроллерная плата; точный pin map моделируется отдельно.',
    authored: false,
    physical: provisionalPhysical(51.6, 42, 'micro:bit V2 official mechanical dimensions'),
  }),
  future({
    key: 'arduino',
    label: 'Arduino Uno',
    category: 'boards',
    preview: 'arduino',
    description: 'Arduino Uno с точной геометрией headers и pin model.',
    physical: provisionalPhysical(68.6, 53.4),
  }),
  future({
    key: 'servo',
    label: 'Сервопривод',
    category: 'outputs',
    preview: 'servo',
    description: 'Сервопривод с управляющим, силовым и земляным выводами.',
    physical: provisionalPhysical(23, 12),
  }),
  future({
    key: 'motor',
    label: 'Двигатель постоянного тока',
    category: 'outputs',
    preview: 'motor',
    description: 'Двигатель постоянного тока.',
    physical: provisionalPhysical(25, 20),
  }),
  future({
    key: 'buzzer',
    label: 'Пьезодинамик',
    category: 'outputs',
    preview: 'motor',
    description: 'Звуковой излучатель.',
    physical: provisionalPhysical(12, 9),
  }),
  future({
    key: 'lamp',
    label: 'Лампа накаливания',
    category: 'outputs',
    preview: 'led',
    description: 'Лампа с выключенным и светящимся состоянием.',
    physical: provisionalPhysical(10, 18),
  }),
  future({
    key: 'transistor',
    label: 'NPN-транзистор',
    category: 'basic',
    preview: 'transistor',
    description: 'Трёхвыводный ключ и усилитель.',
    physical: provisionalPhysical(5, 5),
  }),
  future({
    key: 'rgb-led',
    label: 'RGB-светодиод',
    category: 'outputs',
    preview: 'rgb-led',
    description: 'Четырёхвыводный RGB-светодиод.',
    physical: provisionalPhysical(5, 8.6),
  }),
  future({
    key: 'diode',
    label: 'Диод',
    category: 'basic',
    preview: 'diode',
    description: 'Полупроводниковый диод с анодом и катодом.',
    physical: provisionalPhysical(7, 3),
  }),
  future({
    key: 'photoresistor',
    label: 'Фоторезистор',
    category: 'inputs',
    preview: 'photoresistor',
    description: 'Датчик освещённости.',
    physical: provisionalPhysical(5, 4),
  }),
  future({
    key: 'seven-segment',
    label: 'Семисегментный индикатор',
    category: 'outputs',
    preview: 'seven-segment',
    description: 'Многоконтактный цифровой индикатор.',
    physical: provisionalPhysical(19, 13),
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

export function renderedSize(
  entry: CatalogEntry,
  rotation = 0,
): { width: number; height: number } {
  const scale = entry.renderWidth / entry.viewBox.width;
  const original = { width: entry.renderWidth, height: entry.viewBox.height * scale };
  return Math.abs(rotation % 180) === 90
    ? { width: original.height, height: original.width }
    : original;
}

export function renderedSizeMillimetres(entry: CatalogEntry): { width: number; height: number } {
  const size = renderedSize(entry, 0);
  return {
    width: workbenchUnitsToMm(size.width),
    height: workbenchUnitsToMm(size.height),
  };
}

function terminalOffset(
  entry: CatalogEntry,
  terminal: 'a' | 'b',
  rotation = 0,
): PointLike | null {
  if (!entry.terminals) return null;
  const scale = entry.renderWidth / entry.viewBox.width;
  const baseWidth = entry.renderWidth;
  const baseHeight = entry.viewBox.height * scale;
  const spec = entry.terminals[terminal];
  const px = spec.x * scale;
  const py = spec.y * scale;
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) return { x: baseHeight - py, y: px };
  if (normalized === 180) return { x: baseWidth - px, y: baseHeight - py };
  if (normalized === 270) return { x: py, y: baseWidth - px };
  return { x: px, y: py };
}

export function terminalPosition(
  kind: ComponentKind,
  origin: PointLike,
  terminal: 'a' | 'b',
  rotation = 0,
): PointLike | null {
  const entry = catalogEntry(kind);
  if (!entry) return null;
  const offset = terminalOffset(entry, terminal, rotation);
  return offset ? { x: origin.x + offset.x, y: origin.y + offset.y } : null;
}

/** Align a component's placement anchor with the configured breadboard grid. */
export function snapComponentOrigin(
  kind: ComponentKind,
  proposedOrigin: PointLike,
  rotation = 0,
): PointLike {
  const entry = catalogEntry(kind);
  if (!entry || !entry.placement.anchorTerminal) {
    return {
      x: snapWorkbench(proposedOrigin.x, entry?.placement.gridDivisor ?? 2),
      y: snapWorkbench(proposedOrigin.y, entry?.placement.gridDivisor ?? 2),
    };
  }
  const offset = terminalOffset(entry, entry.placement.anchorTerminal, rotation);
  if (!offset) return proposedOrigin;
  return {
    x: snapWorkbench(proposedOrigin.x + offset.x, entry.placement.gridDivisor) - offset.x,
    y: snapWorkbench(proposedOrigin.y + offset.y, entry.placement.gridDivisor) - offset.y,
  };
}

export function componentOriginForCenter(
  kind: ComponentKind,
  center: PointLike,
  rotation = 0,
): PointLike {
  const entry = catalogEntry(kind);
  if (!entry) return center;
  const size = renderedSize(entry, rotation);
  return snapComponentOrigin(
    kind,
    { x: center.x - size.width / 2, y: center.y - size.height / 2 },
    rotation,
  );
}

export function componentPhysicalSummary(entry: CatalogEntry): string {
  const body = entry.physical.bodyMm;
  const bodyLabel = `${formatMillimetres(body.width)} × ${formatMillimetres(body.height)}`;
  const pitchLabel = entry.physical.terminalSpanPitches
    ? `; выводы ${entry.physical.terminalSpanPitches}×${formatMillimetres(BREADBOARD_PITCH_MM)}`
    : '';
  return `${bodyLabel}${pitchLabel}`;
}
