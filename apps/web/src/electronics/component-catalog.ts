import type { ComponentKind, TerminalId } from '../api';
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
 * Visual definitions used by the Electronics workbench.
 *
 * Active components use owner/ASA vector assets and are calibrated against the
 * standard 2.54 mm breadboard pitch. Future parts remain visible but disabled
 * until their vector asset, terminal map, electrical model and reference
 * behavior are verified. A documented size never makes a component available.
 */

export type ComponentCategory =
  | 'all'
  | 'basic'
  | 'power'
  | 'inputs'
  | 'outputs'
  | 'boards'
  | 'instruments';
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
  | 'ground'
  | 'digital'
  | 'analog'
  | 'instrument';

export interface TerminalSpec {
  /** Stable persisted ID. Existing documents use a/b. */
  readonly id: TerminalId;
  /** Human/electrical identity independent from the legacy persisted ID. */
  readonly semanticId: string;
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
  /** Render width in workbench units; active parts derive it from terminal pitch. */
  readonly renderWidth: number;
  readonly terminals: readonly TerminalSpec[];
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
  all: 'Все',
  basic: 'Основные',
  power: 'Питание',
  inputs: 'Входы и датчики',
  outputs: 'Выходы и приводы',
  boards: 'Платы и макетки',
  instruments: 'Приборы',
};

const SOURCE_TERMINALS = [
  { id: 'a', semanticId: 'positive', x: 295.5, y: 74, label: '+', role: 'positive' },
  { id: 'b', semanticId: 'negative', x: 190.5, y: 74, label: '−', role: 'negative' },
] as const satisfies readonly TerminalSpec[];
const RESISTOR_TERMINALS = [
  { id: 'a', semanticId: 'lead-1', x: 12, y: 48, label: '1', role: 'passive' },
  { id: 'b', semanticId: 'lead-2', x: 248, y: 48, label: '2', role: 'passive' },
] as const satisfies readonly TerminalSpec[];
const LED_TERMINALS = [
  { id: 'a', semanticId: 'anode', x: 83, y: 372, label: 'A', role: 'anode' },
  { id: 'b', semanticId: 'cathode', x: 209, y: 372, label: 'K', role: 'cathode' },
] as const satisfies readonly TerminalSpec[];

function requiredTerminal(
  terminals: readonly TerminalSpec[],
  terminalId: TerminalId,
): TerminalSpec {
  const terminal = terminals.find((candidate) => candidate.id === terminalId);
  if (!terminal) throw new Error(`component terminal not found: ${terminalId}`);
  return terminal;
}

const ACTIVE: CatalogEntry[] = [
  {
    key: 'source',
    kind: 'source',
    label: 'Батарейный отсек 2×AA',
    category: 'power',
    description: 'Нативный двухэлементный отсек 3 В, откалиброванный по выводам и макетной сетке.',
    keywords: ['источник', 'батарея', 'питание', 'aa', '3v', '3 в'],
    preview: 'source',
    asset: `${ASSET_ROOT}/power-source.svg`,
    viewBox: { width: 485, height: 843 },
    renderWidth: renderWidthForTerminalSpan(
      485,
      requiredTerminal(SOURCE_TERMINALS, 'a').x,
      requiredTerminal(SOURCE_TERMINALS, 'b').x,
      4,
    ),
    terminals: SOURCE_TERMINALS,
    physical: {
      bodyMm: { width: 44, height: 76.6, depth: 16 },
      envelopeMm: { width: 47, height: 82, depth: 16 },
      terminalSpanPitches: 4,
      evidence: 'owner_asset_calibrated',
      source: 'owner SVG snap points calibrated to a 10.16 mm terminal span',
      referenceBehaviorVerified: true,
    },
    placement: { gridDivisor: 2, anchorTerminal: 'a', mode: 'free-physical' },
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
    description:
      'Осевой учебный резистор: текущий foundation использует 10 шагов; гибкие выводы требуют отдельной физической модели и reference-проверки.',
    keywords: ['резистор', 'сопротивление', 'ом', '300'],
    preview: 'resistor',
    asset: `${ASSET_ROOT}/resistor.svg`,
    viewBox: { width: 260, height: 96 },
    renderWidth: renderWidthForTerminalSpan(
      260,
      requiredTerminal(RESISTOR_TERMINALS, 'a').x,
      requiredTerminal(RESISTOR_TERMINALS, 'b').x,
      10,
    ),
    terminals: RESISTOR_TERMINALS,
    physical: {
      bodyMm: { width: 6.3, height: 2.5, depth: 2.5 },
      envelopeMm: { width: 28, height: 10.5, depth: 2.5 },
      terminalSpanPitches: 10,
      evidence: 'manufacturer_typical',
      source: 'typical axial quarter-watt body; current educational lead span 25.4 mm',
      referenceBehaviorVerified: false,
    },
    placement: { gridDivisor: 2, anchorTerminal: 'a', mode: 'terminal-grid' },
    defaultValue: 300,
    unit: 'Ом',
    authored: false,
    sourceFile: 'native ASA SVG; replace only with owner-approved vector artwork',
    enabled: true,
  },
  {
    key: 'led',
    kind: 'led',
    label: 'Светодиод 5 мм',
    category: 'outputs',
    description: 'Красный сквозной LED; анод и катод находятся на шаге 2,54 мм.',
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
    renderWidth: renderWidthForTerminalSpan(
      240,
      requiredTerminal(LED_TERMINALS, 'a').x,
      requiredTerminal(LED_TERMINALS, 'b').x,
      1,
    ),
    terminals: LED_TERMINALS,
    physical: {
      bodyMm: { width: 5, height: 8.6, depth: 5 },
      envelopeMm: { width: 5, height: 8.6, depth: 5 },
      terminalSpanPitches: 1,
      evidence: 'manufacturer_typical',
      source: 'typical 5 mm through-hole red LED with 2.54 mm lead pitch',
      referenceBehaviorVerified: false,
    },
    placement: { gridDivisor: 2, anchorTerminal: 'a', mode: 'terminal-grid' },
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
  source = 'provisional target; verify exact part and reference behavior before enabling',
  depth?: number,
): PhysicalComponentSpec {
  return {
    bodyMm: { width, height, ...(depth === undefined ? {} : { depth }) },
    evidence: 'reference_capture_required',
    source,
    referenceBehaviorVerified: false,
  };
}

function officialPhysical(
  width: number,
  height: number,
  source: string,
  depth?: number,
): PhysicalComponentSpec {
  return {
    bodyMm: { width, height, ...(depth === undefined ? {} : { depth }) },
    evidence: 'manufacturer_official',
    source,
    referenceBehaviorVerified: false,
  };
}

function future(options: {
  key: string;
  label: string;
  category: Exclude<ComponentCategory, 'all'>;
  preview: PreviewKey;
  description: string;
  physical: PhysicalComponentSpec;
  keywords?: readonly string[];
  asset?: string;
  stateAssets?: Partial<Record<ComponentVisualState, string>>;
  sourceFile?: string;
  authored?: boolean;
  placementMode?: PlacementSpec['mode'];
}): CatalogEntry {
  return {
    key: options.key,
    kind: null,
    label: options.label,
    category: options.category,
    description: options.description,
    keywords: [options.label.toLowerCase(), options.key, ...(options.keywords ?? [])],
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
    terminals: [],
    physical: options.physical,
    placement: {
      gridDivisor: 2,
      anchorTerminal: null,
      mode: options.placementMode ?? 'terminal-grid',
    },
    defaultValue: 0,
    unit: '',
    authored: options.authored ?? true,
    sourceFile: options.sourceFile ?? 'future ASA component implementation',
    enabled: false,
  };
}

// Disabled targets are intentionally honest: dimensions can be official while
// exact Tinkercad interaction, asset, terminal map and model remain unresolved.
const FUTURE: CatalogEntry[] = [
  future({ key: 'button', label: 'Кнопка', category: 'inputs', preview: 'button', description: 'Моментальная кнопка с отпущенным и нажатым состоянием.', physical: provisionalPhysical(6, 6) }),
  future({ key: 'potentiometer', label: 'Потенциометр', category: 'inputs', preview: 'potentiometer', description: 'Трёхвыводное регулируемое сопротивление.', physical: provisionalPhysical(10, 10) }),
  future({ key: 'capacitor', label: 'Конденсатор', category: 'basic', preview: 'capacitor', description: 'Неполярный конденсатор и временные процессы.', physical: provisionalPhysical(5, 8) }),
  future({ key: 'electrolytic-capacitor', label: 'Электролитический конденсатор', category: 'basic', preview: 'capacitor', description: 'Полярный конденсатор с проверкой подключения.', physical: provisionalPhysical(6.3, 11) }),
  future({ key: 'inductor', label: 'Катушка индуктивности', category: 'basic', preview: 'inductor', description: 'Индуктивный элемент для transient-модели.', physical: provisionalPhysical(8, 4) }),
  future({ key: 'slide-switch', label: 'Ползунковый переключатель', category: 'inputs', preview: 'slide-switch', description: 'Переключатель с устойчивыми положениями.', physical: provisionalPhysical(12, 5) }),
  future({ key: 'dip-switch', label: 'DIP-переключатель', category: 'inputs', preview: 'dip-switch', description: 'Несколько независимых переключателей с многовыводной моделью.', physical: provisionalPhysical(20, 9) }),
  future({ key: 'battery-9v', label: 'Батарея 9 В', category: 'power', preview: 'battery-9v', description: 'Источник постоянного напряжения 9 В.', physical: provisionalPhysical(26.5, 48.5, 'typical PP3/6F22 envelope', 17.5) }),
  future({ key: 'coin-cell', label: 'Кнопочная батарея 3 В', category: 'power', preview: 'coin-cell', description: 'Компактный источник CR2032.', authored: false, physical: provisionalPhysical(20, 20, 'typical CR2032 diameter and thickness', 3.2) }),
  future({ key: 'battery-aa', label: 'Элемент AA 1,5 В', category: 'power', preview: 'battery-aa', description: 'Один цилиндрический элемент AA.', physical: provisionalPhysical(14.5, 50.5, 'typical AA cell envelope', 14.5) }),
  future({ key: 'adjustable-source', label: 'Регулируемый источник', category: 'power', preview: 'power-supply', description: 'Источник с регулируемым напряжением и ограничением тока.', physical: provisionalPhysical(55, 35) }),
  future({ key: 'breadboard-mini', label: 'Мини-макетка 170 точек', category: 'boards', preview: 'breadboard', description: '17 колонок, две группы по пять отверстий, шаг 2,54 мм.', physical: officialPhysical(47, 35, 'SparkFun PRT-12047 mechanical dimensions; reference visual still pending', 10), placementMode: 'breadboard-hole' }),
  future({ key: 'breadboard-half', label: 'Макетка 400 точек', category: 'boards', preview: 'breadboard', description: '30 рядов, центральный канал и четыре шины питания; UI attachment persistence ещё не реализована.', physical: officialPhysical(83.5, 54.5, 'SparkFun PRT-12002 mechanical dimensions; exact reference visual still pending', 8.5), placementMode: 'breadboard-hole' }),
  future({ key: 'breadboard-full', label: 'Макетка 830 точек', category: 'boards', preview: 'breadboard', description: '63 ряда и разделённые шины питания.', physical: officialPhysical(165.1, 54.29, 'SparkFun PRT-12615 mechanical dimensions; exact reference visual still pending', 9.68), placementMode: 'breadboard-hole' }),
  future({ key: 'microbit', label: 'micro:bit V2', category: 'boards', preview: 'microbit', description: 'Плата с edge connector, LED-матрицей, кнопками, sensors, speaker и microphone.', authored: false, physical: officialPhysical(51.6, 42, 'micro:bit Educational Foundation V2 mechanical dimensions', 11.65), placementMode: 'free-physical' }),
  future({ key: 'arduino', label: 'Arduino Uno R3', category: 'boards', preview: 'arduino', description: 'Официальная геометрия платы, headers и pin model.', physical: officialPhysical(68.6, 53.4, 'Arduino official Uno Rev3 length and width'), placementMode: 'free-physical' }),
  future({ key: 'servo', label: 'Сервопривод', category: 'outputs', preview: 'servo', description: 'Трёхвыводный привод с сигналом, питанием и землёй.', physical: provisionalPhysical(23, 12) }),
  future({ key: 'motor', label: 'Двигатель постоянного тока', category: 'outputs', preview: 'motor', description: 'Двигатель постоянного тока с механическим состоянием.', physical: provisionalPhysical(25, 20) }),
  future({ key: 'stepper-motor', label: 'Шаговый двигатель', category: 'outputs', preview: 'motor', description: 'Многовыводный шаговый привод.', physical: provisionalPhysical(28, 28) }),
  future({ key: 'vibration-motor', label: 'Вибромотор', category: 'outputs', preview: 'motor', description: 'Малый двигатель с эксцентриком.', physical: provisionalPhysical(12, 5) }),
  future({ key: 'relay', label: 'Реле', category: 'outputs', preview: 'relay', description: 'Катушка и изолированные переключающие контакты.', physical: provisionalPhysical(19, 15.5) }),
  future({ key: 'buzzer', label: 'Пьезодинамик', category: 'outputs', preview: 'buzzer', description: 'Звуковой излучатель.', physical: provisionalPhysical(12, 12, undefined, 9) }),
  future({ key: 'speaker', label: 'Динамик', category: 'outputs', preview: 'speaker', description: 'Акустический выход с частотным сигналом.', physical: provisionalPhysical(36, 36, undefined, 15) }),
  future({ key: 'lamp', label: 'Лампа накаливания', category: 'outputs', preview: 'lamp', description: 'Лампа с выключенным и светящимся состоянием.', physical: provisionalPhysical(10, 18) }),
  future({ key: 'transistor', label: 'NPN-транзистор', category: 'basic', preview: 'transistor', description: 'Трёхвыводный ключ и усилитель.', physical: provisionalPhysical(5, 5) }),
  future({ key: 'pnp-transistor', label: 'PNP-транзистор', category: 'basic', preview: 'transistor', description: 'Трёхвыводная PNP-модель.', physical: provisionalPhysical(5, 5) }),
  future({ key: 'nmos', label: 'N-MOSFET', category: 'basic', preview: 'transistor', description: 'Полевой транзистор с gate/source/drain.', physical: provisionalPhysical(5, 5) }),
  future({ key: 'diode', label: 'Диод', category: 'basic', preview: 'diode', description: 'Полупроводниковый диод с анодом и катодом.', physical: provisionalPhysical(7, 3) }),
  future({ key: 'zener-diode', label: 'Стабилитрон', category: 'basic', preview: 'diode', description: 'Диод с обратным напряжением стабилизации.', physical: provisionalPhysical(7, 3) }),
  future({ key: 'rgb-led', label: 'RGB-светодиод', category: 'outputs', preview: 'rgb-led', description: 'Четырёхвыводный RGB-светодиод.', physical: provisionalPhysical(5, 8.6) }),
  future({ key: 'neopixel-strip', label: 'Адресная RGB-лента', category: 'outputs', preview: 'rgb-led', description: 'Цепочка адресных RGB pixels.', physical: provisionalPhysical(50, 10) }),
  future({ key: 'photoresistor', label: 'Фоторезистор', category: 'inputs', preview: 'photoresistor', description: 'Датчик освещённости.', physical: provisionalPhysical(5, 4) }),
  future({ key: 'thermistor', label: 'Термистор', category: 'inputs', preview: 'sensor', description: 'Температурно-зависимое сопротивление.', physical: provisionalPhysical(5, 4) }),
  future({ key: 'temperature-sensor', label: 'Датчик температуры', category: 'inputs', preview: 'sensor', description: 'Трёхвыводный температурный sensor.', physical: provisionalPhysical(5, 5) }),
  future({ key: 'pir-sensor', label: 'PIR-датчик движения', category: 'inputs', preview: 'sensor', description: 'Датчик движения с digital output.', physical: provisionalPhysical(32, 24) }),
  future({ key: 'ultrasonic-sensor', label: 'Ультразвуковой датчик', category: 'inputs', preview: 'ultrasonic-sensor', description: 'Trigger/echo distance sensor.', physical: provisionalPhysical(45, 20) }),
  future({ key: 'tilt-sensor', label: 'Датчик наклона', category: 'inputs', preview: 'sensor', description: 'Дискретный датчик положения.', physical: provisionalPhysical(5, 10) }),
  future({ key: 'flex-sensor', label: 'Датчик изгиба', category: 'inputs', preview: 'sensor', description: 'Сопротивление зависит от изгиба.', physical: provisionalPhysical(73, 6) }),
  future({ key: 'force-sensor', label: 'Датчик давления', category: 'inputs', preview: 'sensor', description: 'Force-sensitive resistor.', physical: provisionalPhysical(19, 19) }),
  future({ key: 'gas-sensor', label: 'Газовый датчик', category: 'inputs', preview: 'sensor', description: 'Аналоговый датчик с прогревом и ограниченной моделью.', physical: provisionalPhysical(20, 20) }),
  future({ key: 'soil-sensor', label: 'Датчик влажности почвы', category: 'inputs', preview: 'sensor', description: 'Аналоговая модель влажности.', physical: provisionalPhysical(60, 20) }),
  future({ key: 'seven-segment', label: 'Семисегментный индикатор', category: 'outputs', preview: 'seven-segment', description: 'Многоконтактный цифровой индикатор.', physical: provisionalPhysical(19, 13) }),
  future({ key: 'four-digit-seven-segment', label: 'Четырёхразрядный индикатор', category: 'outputs', preview: 'seven-segment', description: 'Мультиплексируемый четырёхразрядный display.', physical: provisionalPhysical(50, 19) }),
  future({ key: 'lcd-16x2', label: 'LCD 16×2', category: 'outputs', preview: 'lcd', description: 'Символьный дисплей с параллельным интерфейсом.', physical: provisionalPhysical(80, 36) }),
  future({ key: 'led-matrix', label: 'LED-матрица', category: 'outputs', preview: 'led-matrix', description: 'Многовыводная LED-матрица.', physical: provisionalPhysical(32, 32) }),
  future({ key: 'timer-555', label: 'Таймер 555', category: 'basic', preview: 'ic', description: 'DIP-8 timer with real pin numbering.', physical: provisionalPhysical(10, 6.5) }),
  future({ key: 'op-amp', label: 'Операционный усилитель', category: 'basic', preview: 'ic', description: 'Многовыводная analog model.', physical: provisionalPhysical(10, 6.5) }),
  future({ key: 'logic-gate', label: 'Логический элемент', category: 'basic', preview: 'ic', description: 'Digital logic family with powered pins.', physical: provisionalPhysical(19, 6.5) }),
  future({ key: 'shift-register', label: 'Сдвиговый регистр', category: 'basic', preview: 'ic', description: 'DIP serial-to-parallel register.', physical: provisionalPhysical(19, 6.5) }),
  future({ key: 'motor-driver', label: 'Драйвер двигателя', category: 'basic', preview: 'ic', description: 'Power driver with control and output pins.', physical: provisionalPhysical(20, 7) }),
  future({ key: 'multimeter', label: 'Мультиметр', category: 'instruments', preview: 'multimeter', description: 'Voltage/current/resistance modes and probes.', physical: provisionalPhysical(55, 95, 'reference instrument geometry and controls require capture', 25), placementMode: 'free-physical' }),
  future({ key: 'oscilloscope', label: 'Осциллограф', category: 'instruments', preview: 'oscilloscope', description: 'Channels, probes, scale, timebase, trigger and traces.', physical: provisionalPhysical(110, 75, 'reference instrument geometry and controls require capture', 35), placementMode: 'free-physical' }),
  future({ key: 'signal-generator', label: 'Генератор сигналов', category: 'instruments', preview: 'signal-generator', description: 'Available only after exact reference confirmation.', physical: provisionalPhysical(100, 65), placementMode: 'free-physical' }),
  future({ key: 'bench-power-supply', label: 'Лабораторный источник', category: 'instruments', preview: 'power-supply', description: 'Adjustable voltage/current with explicit limits.', physical: provisionalPhysical(100, 65), placementMode: 'free-physical' }),
];

const PLANNED_HALF_BREADBOARD = FUTURE.find(
  (entry) => entry.key === 'breadboard-half',
);
if (!PLANNED_HALF_BREADBOARD) {
  throw new Error('planned half breadboard catalogue entry is missing');
}

export const WORKBENCH_CATALOG: readonly CatalogEntry[] = [...ACTIVE, ...FUTURE];
/**
 * Every persisted ComponentKind resolves deterministically. Breadboard resolves
 * to an explicitly disabled planning entry until its original asset, 400-hole
 * terminal map, attachment persistence and browser flow are complete.
 */
export const ACTIVE_COMPONENTS: Readonly<
  Record<Exclude<ComponentKind, 'wire'>, CatalogEntry>
> = {
  source: ACTIVE[0] as CatalogEntry,
  resistor: ACTIVE[1] as CatalogEntry,
  led: ACTIVE[2] as CatalogEntry,
  breadboard: PLANNED_HALF_BREADBOARD,
};

export function catalogEntry(kind: ComponentKind): CatalogEntry | null {
  return kind === 'wire' ? null : ACTIVE_COMPONENTS[kind];
}

export function terminalSpec(entry: CatalogEntry, terminalId: TerminalId): TerminalSpec | null {
  return entry.terminals.find((terminal) => terminal.id === terminalId) ?? null;
}

export function terminalIds(entry: CatalogEntry): readonly TerminalId[] {
  return entry.terminals.map((terminal) => terminal.id);
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
  terminalId: TerminalId,
  rotation = 0,
): PointLike | null {
  const spec = terminalSpec(entry, terminalId);
  if (!spec) return null;
  const scale = entry.renderWidth / entry.viewBox.width;
  const baseWidth = entry.renderWidth;
  const baseHeight = entry.viewBox.height * scale;
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
  terminalId: TerminalId,
  rotation = 0,
): PointLike | null {
  const entry = catalogEntry(kind);
  if (!entry) return null;
  const offset = terminalOffset(entry, terminalId, rotation);
  return offset ? { x: origin.x + offset.x, y: origin.y + offset.y } : null;
}

/** Align a component's configured terminal anchor with its physical grid. */
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

export function physicalEvidenceLabel(entry: CatalogEntry): string {
  switch (entry.physical.evidence) {
    case 'owner_asset_calibrated':
      return 'Откалибровано по авторскому SVG';
    case 'manufacturer_official':
      return 'Официальные механические размеры';
    case 'manufacturer_typical':
      return 'Типовой физический размер';
    default:
      return 'Требуется reference-проверка';
  }
}
