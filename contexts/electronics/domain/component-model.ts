import type { ComponentKind } from './document.js';

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
    modelNote:
      'Текущий компонент — красный LED с номинальным прямым падением 2 В; тепловое разрушение моделируется только диагностикой риска.',
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
    modelNote: 'Идеальное соединение без сопротивления в текущем foundation solver.',
  },
};

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
