import type { ComponentKind } from '../api';

export interface WorkbenchValueControl {
  readonly label: string;
  readonly unit: string;
  readonly defaultValue: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly editable: boolean;
  readonly step: number;
  readonly presets: readonly number[];
  readonly help: string;
}

export const WORKBENCH_VALUE_CONTROLS: Readonly<Record<ComponentKind, WorkbenchValueControl>> = {
  source: {
    label: 'Напряжение',
    unit: 'В',
    defaultValue: 3,
    minimum: 0.1,
    maximum: 60,
    editable: false,
    step: 0.1,
    presets: [],
    help: 'Батарейный отсек 2×AA моделируется как фиксированный источник 3 В.',
  },
  resistor: {
    label: 'Сопротивление',
    unit: 'Ом',
    defaultValue: 300,
    minimum: 1,
    maximum: 1_000_000_000,
    editable: true,
    step: 1,
    presets: [100, 220, 300, 330, 470, 1_000, 4_700, 10_000, 100_000, 1_000_000],
    help: 'Идеальный линейный резистор. Выберите типовой номинал или введите значение.',
  },
  led: {
    label: 'Прямое падение',
    unit: 'В',
    defaultValue: 2,
    minimum: 0.5,
    maximum: 10,
    editable: false,
    step: 0.1,
    presets: [],
    help: 'Красный LED использует фиксированное прямое падение 2 В в foundation-модели.',
  },
  wire: {
    label: 'Сопротивление',
    unit: 'Ом',
    defaultValue: 0,
    minimum: 0,
    maximum: 0,
    editable: false,
    step: 0,
    presets: [],
    help: 'Провод идеален в текущем solver; его сопротивление не моделируется.',
  },
};

export function validEditableValue(kind: ComponentKind, value: number): number | null {
  const control = WORKBENCH_VALUE_CONTROLS[kind];
  if (!control.editable || !Number.isFinite(value)) return null;
  if (value < control.minimum || value > control.maximum) return null;
  return value;
}

export function isNominalWorkbenchValue(kind: ComponentKind, value: number): boolean {
  const nominal = WORKBENCH_VALUE_CONTROLS[kind].defaultValue;
  return Math.abs(value - nominal) <= 1e-9;
}

export function formatComponentValue(kind: ComponentKind, value: number): string {
  if (kind !== 'resistor') return `${value:g}`.replace(':g', '');
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(3))} МОм`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(3))} кОм`;
  return `${Number(value.toFixed(3))} Ом`;
}
