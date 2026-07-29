import { createBreadboardDefinition } from './breadboard.js';

/**
 * Active foundation kinds. Breadboard is connectivity-only: it contributes
 * terminals and internal buses to the netlist but is not an electrical load.
 */
export type ComponentKind = 'source' | 'resistor' | 'led' | 'breadboard' | 'wire';

/** Persisted, stable terminal identity inside one component instance. */
export type TerminalId = string;

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

export interface ComponentTerminalModel {
  /** Persisted ID used by SchematicConnection. Existing documents use a/b. */
  readonly id: TerminalId;
  readonly label: string;
  readonly role: TerminalElectricalRole;
}

export interface ComponentValueModel {
  readonly kind: ComponentKind;
  readonly label: string;
  readonly unit: string;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly editable: boolean;
  readonly nominalValue?: number;
  readonly step?: number;
  readonly presets?: readonly number[];
  readonly modelNote: string;
}

const HALF_BREADBOARD = createBreadboardDefinition('half-400');

function breadboardTerminalLabel(hole: (typeof HALF_BREADBOARD.holes)[number]): string {
  if (hole.region === 'terminal-strip') return `${hole.row}${hole.column}`;
  const side = hole.rail?.startsWith('top') ? 'T' : 'B';
  const polarity = hole.rail?.endsWith('positive') ? '+' : '−';
  return `${polarity}${side}${hole.railIndex}`;
}

const BREADBOARD_TERMINALS: readonly ComponentTerminalModel[] = HALF_BREADBOARD.holes.map(
  (hole) => ({
    id: hole.id,
    label: breadboardTerminalLabel(hole),
    role:
      hole.region === 'terminal-strip'
        ? 'passive'
        : hole.rail?.endsWith('positive')
          ? 'power'
          : 'ground',
  }),
);

export const COMPONENT_KINDS = [
  'source',
  'resistor',
  'led',
  'breadboard',
  'wire',
] as const satisfies readonly ComponentKind[];

/**
 * Electrical interface for active foundation components.
 * IDs a/b remain compatible with old drafts. The half-size breadboard exposes
 * all 400 physical holes as stable terminal IDs.
 */
export const COMPONENT_TERMINAL_MODELS: Readonly<
  Record<ComponentKind, readonly ComponentTerminalModel[]>
> = {
  source: [
    { id: 'a', label: '+', role: 'positive' },
    { id: 'b', label: '−', role: 'negative' },
  ],
  resistor: [
    { id: 'a', label: '1', role: 'passive' },
    { id: 'b', label: '2', role: 'passive' },
  ],
  led: [
    { id: 'a', label: 'A', role: 'anode' },
    { id: 'b', label: 'K', role: 'cathode' },
  ],
  breadboard: BREADBOARD_TERMINALS,
  wire: [
    { id: 'a', label: '1', role: 'passive' },
    { id: 'b', label: '2', role: 'passive' },
  ],
};

export const COMPONENT_VALUE_MODELS: Readonly<Record<ComponentKind, ComponentValueModel>> = {
  source: {
    kind: 'source',
    label: 'Напряжение',
    unit: 'В',
    defaultValue: 3,
    minimum: 0.1,
    maximum: 60,
    editable: false,
    nominalValue: 3,
    step: 0.1,
    presets: [],
    modelNote:
      'Текущий SVG — батарейный отсек 2×AA с номиналом 3 В. Нестандартные legacy-значения читаются для совместимости, но новые схемы используют 3 В.',
  },
  resistor: {
    kind: 'resistor',
    label: 'Сопротивление',
    unit: 'Ом',
    defaultValue: 300,
    minimum: 1,
    maximum: 1_000_000_000,
    editable: true,
    step: 1,
    presets: [100, 220, 300, 330, 470, 1_000, 4_700, 10_000, 100_000, 1_000_000],
    modelNote: 'Идеальная линейная модель сопротивления для поддержанного DC-series solver.',
  },
  led: {
    kind: 'led',
    label: 'Прямое падение',
    unit: 'В',
    defaultValue: 2,
    minimum: 0.5,
    maximum: 10,
    editable: false,
    nominalValue: 2,
    step: 0.1,
    presets: [],
    modelNote:
      'Текущий компонент — красный LED с номинальным прямым падением 2 В; тепловое разрушение моделируется только диагностикой риска.',
  },
  breadboard: {
    kind: 'breadboard',
    label: 'Макетная плата',
    unit: '',
    defaultValue: 0,
    minimum: 0,
    maximum: 0,
    editable: false,
    nominalValue: 0,
    step: 0,
    presets: [],
    modelNote:
      'Connectivity-only model: 300 terminal-strip holes and 100 rail holes are joined only through the declared physical internal buses.',
  },
  wire: {
    kind: 'wire',
    label: 'Идеальный провод',
    unit: '',
    defaultValue: 0,
    minimum: 0,
    maximum: 0,
    editable: false,
    nominalValue: 0,
    step: 0,
    presets: [],
    modelNote: 'Идеальное соединение без сопротивления в текущем foundation solver.',
  },
};

export function componentTerminalModels(kind: ComponentKind): readonly ComponentTerminalModel[] {
  return COMPONENT_TERMINAL_MODELS[kind];
}

export function componentTerminalIds(kind: ComponentKind): readonly TerminalId[] {
  return COMPONENT_TERMINAL_MODELS[kind].map((terminal) => terminal.id);
}

export function componentTerminalModel(
  kind: ComponentKind,
  terminalId: TerminalId,
): ComponentTerminalModel | null {
  return COMPONENT_TERMINAL_MODELS[kind].find((terminal) => terminal.id === terminalId) ?? null;
}

export function isComponentTerminal(kind: ComponentKind, terminalId: unknown): terminalId is TerminalId {
  return (
    typeof terminalId === 'string' &&
    COMPONENT_TERMINAL_MODELS[kind].some((terminal) => terminal.id === terminalId)
  );
}

export function componentValueError(kind: ComponentKind, value: number): string | null {
  const model = COMPONENT_VALUE_MODELS[kind];
  if (!Number.isFinite(value)) return `${kind} value must be finite`;
  if (value < model.minimum || value > model.maximum) {
    return `${kind} value must be between ${model.minimum} and ${model.maximum} ${model.unit}`.trim();
  }
  return null;
}

export function isNominalComponentValue(kind: ComponentKind, value: number): boolean {
  const nominal = COMPONENT_VALUE_MODELS[kind].nominalValue;
  return nominal === undefined || Math.abs(value - nominal) <= 1e-9;
}
