import type { ComponentKind } from '../api';

/**
 * Visual catalog for the schematic editor.
 *
 * Artwork comes from the owner's component library; the copies under
 * `public/assets/electronics/components` are sanitised (no scripts, event
 * handlers, external URLs or editor metadata) and keep the original viewBox and
 * proportions. Terminal coordinates are expressed in that viewBox, so they
 * follow the drawing exactly and move with the component.
 */

export interface TerminalSpec {
  /** Position inside the SVG viewBox. */
  readonly x: number;
  readonly y: number;
  /** Label shown to the teacher for this pin. */
  readonly label: string;
}

export interface CatalogEntry {
  readonly kind: ComponentKind;
  readonly label: string;
  /** Asset path, or null for elements drawn directly on the canvas. */
  readonly asset: string | null;
  readonly viewBox: { readonly width: number; readonly height: number };
  /** Rendered width in canvas units; height follows the viewBox ratio. */
  readonly renderWidth: number;
  readonly terminals: { readonly a: TerminalSpec; readonly b: TerminalSpec };
  readonly defaultValue: number;
  readonly unit: string;
  /** false when the drawing is a stand-in rather than the owner's artwork. */
  readonly authored: boolean;
  readonly sourceFile: string;
}

/** Components the current slice can actually place, wire and solve. */
export const ACTIVE_COMPONENTS: Record<Exclude<ComponentKind, 'wire'>, CatalogEntry> = {
  source: {
    kind: 'source',
    label: 'Источник',
    asset: '/assets/electronics/components/power-source.svg',
    viewBox: { width: 485, height: 843 },
    renderWidth: 110,
    // BAT- / BAT+ contacts marked in the original drawing.
    terminals: {
      a: { x: 295.5, y: 74, label: '+' },
      b: { x: 190.5, y: 74, label: '−' },
    },
    defaultValue: 3,
    unit: 'В',
    authored: true,
    sourceFile: 'aa_holder_2x_sketch_exact_v6.svg',
  },
  resistor: {
    kind: 'resistor',
    label: 'Резистор',
    asset: '/assets/electronics/components/resistor.svg',
    viewBox: { width: 240, height: 120 },
    renderWidth: 150,
    terminals: {
      a: { x: 18, y: 60, label: 'A' },
      b: { x: 222, y: 60, label: 'B' },
    },
    defaultValue: 300,
    unit: 'Ом',
    // The owner's library has no resistor drawing yet; this stand-in keeps the
    // slice usable and must be replaced by the authored asset.
    authored: false,
    sourceFile: 'placeholder (no authored resistor in the component library)',
  },
  led: {
    kind: 'led',
    label: 'Светодиод',
    asset: '/assets/electronics/components/led.svg',
    viewBox: { width: 240, height: 400 },
    renderWidth: 90,
    // Anode / cathode pins marked in the original drawing.
    terminals: {
      a: { x: 83, y: 372, label: 'A' },
      b: { x: 209, y: 372, label: 'K' },
    },
    defaultValue: 2,
    unit: 'В',
    authored: true,
    sourceFile: 'led_universal_css_variable_template.svg',
  },
};

/**
 * Artwork found in the owner's library that this slice does not simulate yet.
 * Listed so the inventory is not lost, deliberately kept out of the palette:
 * showing a part the solver cannot model would fake a capability.
 */
export const FUTURE_COMPONENTS: readonly {
  readonly key: string;
  readonly label: string;
  readonly sourceFolder: string;
  readonly status: 'future' | 'not_enabled';
  readonly note: string;
}[] = [
  {
    key: 'rgb-led',
    label: 'RGB-светодиод',
    sourceFolder: 'RGB - светодиод',
    status: 'future',
    note: 'Требует трёх независимых каналов в расчёте.',
  },
  {
    key: 'diode',
    label: 'Диод',
    sourceFolder: 'Диод',
    status: 'future',
    note: 'Нужна нелинейная модель проводимости.',
  },
  {
    key: 'button',
    label: 'Кнопка',
    sourceFolder: 'Кнопка',
    status: 'future',
    note: 'Нужны состояния цепи во времени.',
  },
  {
    key: 'lamp',
    label: 'Лампа накаливания',
    sourceFolder: 'Лампа накаливания',
    status: 'future',
    note: 'Нужна тепловая зависимость сопротивления.',
  },
  {
    key: 'breadboard',
    label: 'Макетная плата',
    sourceFolder: 'Макетка',
    status: 'not_enabled',
    note: 'Вне текущего среза: соединения задаются напрямую.',
  },
  {
    key: 'switch',
    label: 'Переключатель',
    sourceFolder: 'Переключатель',
    status: 'future',
    note: 'Нужны состояния цепи во времени.',
  },
  {
    key: 'seven-segment',
    label: 'Семисегментный индикатор',
    sourceFolder: 'Семисегментный индикатор',
    status: 'future',
    note: 'Нужна логика сегментов и многоконтактная модель.',
  },
];

export function catalogEntry(kind: ComponentKind): CatalogEntry | null {
  return kind === 'wire' ? null : ACTIVE_COMPONENTS[kind];
}

/** Terminal position in canvas coordinates for a placed component. */
export function terminalPosition(
  kind: ComponentKind,
  origin: { x: number; y: number },
  terminal: 'a' | 'b',
): { x: number; y: number } | null {
  const entry = catalogEntry(kind);
  if (!entry) {
    return null;
  }
  const scale = entry.renderWidth / entry.viewBox.width;
  const spec = entry.terminals[terminal];
  return { x: origin.x + spec.x * scale, y: origin.y + spec.y * scale };
}

export function renderedSize(entry: CatalogEntry): { width: number; height: number } {
  const scale = entry.renderWidth / entry.viewBox.width;
  return { width: entry.renderWidth, height: entry.viewBox.height * scale };
}
