import type {
  ComponentKind,
  ComponentResult,
  ProductionStateValue,
  SchematicComponent,
} from '../api';
import { sha256Hex } from '@asa-lab/electronics/simulation';

export type PropertyBindingId =
  'component-name' | 'electrical-value' | 'resistance-ohm' | 'wiper-position' | 'led-colour';
export type MetricBindingId =
  | 'voltage-drop'
  | 'current'
  | 'power'
  | 'brightness'
  | 'frequency'
  | 'sound-level'
  | 'source-operating-mode'
  | 'operating-region';

export interface InspectorFieldProfile {
  readonly fieldId: string;
  readonly label: string;
  readonly propertyBindingId: PropertyBindingId;
  readonly priority: 'primary' | 'secondary' | 'advanced';
}

export interface TechnicalMetricProfile {
  readonly metricId: string;
  readonly label: string;
  readonly metricBindingId: MetricBindingId;
  readonly unit: string;
  readonly precision: number;
}

export interface ComponentInformationProfile {
  readonly componentFamilyId: string;
  readonly compactFields: readonly InspectorFieldProfile[];
  readonly technicalMetrics: readonly TechnicalMetricProfile[];
  readonly terminalPresentation: 'hidden' | 'summary' | 'grouped' | 'full';
}

export interface HelpSection {
  readonly id: 'description' | 'principle' | 'connection' | 'usage' | 'safety';
  readonly title: string;
  readonly text: string;
}

export interface HelpContentPayload {
  readonly componentFamilyId: string;
  readonly locale: string;
  readonly contentVersion: number;
  readonly contentStatus: 'draft' | 'needs_review' | 'approved';
  readonly sections: readonly HelpSection[];
}

export interface HelpApprovalRecord {
  readonly componentFamilyId: string;
  readonly locale: string;
  readonly contentVersion: number;
  readonly contentDigest: string;
  readonly reviewedBy: string;
  readonly engineeringApprovedBy: string;
  readonly ownerPublishedBy: string;
  readonly reviewedAt: string;
  readonly sourceCommitSha: string;
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('help content numbers must be finite');
      return Object.is(candidate, -0) ? 0 : candidate;
    }
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

export function helpContentDigest(content: HelpContentPayload): string {
  return sha256Hex(canonicalJson(content));
}

export function isHelpContentPublishable(
  content: HelpContentPayload,
  approval: HelpApprovalRecord | null,
): boolean {
  return (
    content.contentStatus === 'approved' &&
    approval !== null &&
    approval.componentFamilyId === content.componentFamilyId &&
    approval.locale === content.locale &&
    approval.contentVersion === content.contentVersion &&
    approval.contentDigest === helpContentDigest(content) &&
    /^[a-f0-9]{40}$/.test(approval.sourceCommitSha) &&
    Boolean(approval.reviewedBy && approval.engineeringApprovedBy && approval.ownerPublishedBy) &&
    Number.isFinite(Date.parse(approval.reviewedAt))
  );
}

const NAME_FIELD: InspectorFieldProfile = {
  fieldId: 'name',
  label: 'Имя',
  propertyBindingId: 'component-name',
  priority: 'primary',
};
const VALUE_FIELD: InspectorFieldProfile = {
  fieldId: 'value',
  label: 'Значение',
  propertyBindingId: 'electrical-value',
  priority: 'primary',
};
const RESISTANCE_FIELD: InspectorFieldProfile = {
  fieldId: 'resistance',
  label: 'Сопротивление',
  propertyBindingId: 'resistance-ohm',
  priority: 'primary',
};
const WIPER_FIELD: InspectorFieldProfile = {
  fieldId: 'wiper-position',
  label: 'Положение движка',
  propertyBindingId: 'wiper-position',
  priority: 'secondary',
};
const LED_COLOUR_FIELD: InspectorFieldProfile = {
  fieldId: 'led-colour',
  label: 'Цвет',
  propertyBindingId: 'led-colour',
  priority: 'primary',
};

const METRICS = {
  voltage: {
    metricId: 'voltage-drop',
    label: 'Напряжение',
    metricBindingId: 'voltage-drop',
    unit: 'В',
    precision: 3,
  },
  current: {
    metricId: 'current',
    label: 'Ток',
    metricBindingId: 'current',
    unit: 'мА',
    precision: 2,
  },
  power: {
    metricId: 'power',
    label: 'Мощность',
    metricBindingId: 'power',
    unit: 'Вт',
    precision: 3,
  },
  brightness: {
    metricId: 'brightness',
    label: 'Яркость',
    metricBindingId: 'brightness',
    unit: '%',
    precision: 0,
  },
  frequency: {
    metricId: 'frequency',
    label: 'Частота',
    metricBindingId: 'frequency',
    unit: 'Гц',
    precision: 0,
  },
  sound: {
    metricId: 'sound-level',
    label: 'Уровень сигнала',
    metricBindingId: 'sound-level',
    unit: '%',
    precision: 0,
  },
  sourceMode: {
    metricId: 'source-operating-mode',
    label: 'Режим источника',
    metricBindingId: 'source-operating-mode',
    unit: '',
    precision: 0,
  },
  region: {
    metricId: 'operating-region',
    label: 'Рабочая область',
    metricBindingId: 'operating-region',
    unit: '',
    precision: 0,
  },
} as const satisfies Readonly<Record<string, TechnicalMetricProfile>>;

const PROFILE_BY_KIND: Readonly<
  Record<
    ComponentKind,
    Pick<ComponentInformationProfile, 'compactFields' | 'technicalMetrics' | 'terminalPresentation'>
  >
> = {
  source: {
    compactFields: [NAME_FIELD, VALUE_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power, METRICS.sourceMode],
    terminalPresentation: 'full',
  },
  resistor: {
    compactFields: [NAME_FIELD, RESISTANCE_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power],
    terminalPresentation: 'full',
  },
  potentiometer: {
    compactFields: [NAME_FIELD, RESISTANCE_FIELD, WIPER_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power],
    terminalPresentation: 'full',
  },
  photoresistor: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power],
    terminalPresentation: 'full',
  },
  led: {
    compactFields: [NAME_FIELD, LED_COLOUR_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power, METRICS.brightness],
    terminalPresentation: 'full',
  },
  'rgb-led': {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power, METRICS.brightness],
    terminalPresentation: 'grouped',
  },
  'seven-segment': {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power, METRICS.brightness],
    terminalPresentation: 'grouped',
  },
  button: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current],
    terminalPresentation: 'grouped',
  },
  switch: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current],
    terminalPresentation: 'full',
  },
  piezo: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.frequency, METRICS.sound],
    terminalPresentation: 'full',
  },
  diode: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power],
    terminalPresentation: 'full',
  },
  transistor: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power, METRICS.region],
    terminalPresentation: 'grouped',
  },
  lamp: {
    compactFields: [NAME_FIELD, RESISTANCE_FIELD],
    technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power, METRICS.brightness],
    terminalPresentation: 'full',
  },
  breadboard: {
    compactFields: [NAME_FIELD],
    technicalMetrics: [],
    terminalPresentation: 'grouped',
  },
  visual: { compactFields: [NAME_FIELD], technicalMetrics: [], terminalPresentation: 'summary' },
  wire: { compactFields: [], technicalMetrics: [], terminalPresentation: 'hidden' },
};

export function componentInformationProfile(
  componentFamilyId: string,
  kind: ComponentKind,
): ComponentInformationProfile {
  if (componentFamilyId === 'dc-motor') {
    return {
      componentFamilyId,
      compactFields: [NAME_FIELD],
      technicalMetrics: [METRICS.voltage, METRICS.current, METRICS.power],
      terminalPresentation: 'full',
    };
  }
  return { componentFamilyId, ...PROFILE_BY_KIND[kind] };
}

export function readPropertyBinding(
  bindingId: PropertyBindingId,
  component: SchematicComponent,
): string | number | boolean | readonly string[] {
  if (bindingId === 'component-name') return component.name ?? '';
  if (bindingId === 'wiper-position') return component.wiperPosition ?? 0.5;
  if (bindingId === 'led-colour') return component.stateProperties?.['ledColour'] ?? 'red';
  return component.value;
}

export function propertyBindingPatch(
  bindingId: PropertyBindingId,
  value: string | number | boolean | readonly string[],
): Partial<SchematicComponent> & {
  readonly stateProperties?: Readonly<Record<string, ProductionStateValue>>;
} {
  if (bindingId === 'component-name') return { name: String(value) };
  if (bindingId === 'wiper-position') return { wiperPosition: Number(value) };
  if (bindingId === 'led-colour') return { stateProperties: { ledColour: String(value) } };
  return { value: Number(value) };
}

export function readMetricBinding(
  bindingId: MetricBindingId,
  result: ComponentResult,
): number | string | null {
  const raw =
    bindingId === 'voltage-drop'
      ? result.voltageDrop
      : bindingId === 'current'
        ? result.current * 1000
        : bindingId === 'power'
          ? result.power
          : bindingId === 'brightness'
            ? result.brightness
            : bindingId === 'frequency'
              ? result.frequencyHz
              : bindingId === 'sound-level'
                ? result.soundLevel === undefined
                  ? undefined
                  : result.soundLevel * 100
                : bindingId === 'source-operating-mode'
                  ? result.sourceOperatingMode === 'delivering'
                    ? 'Отдаёт ток'
                    : result.sourceOperatingMode === 'absorbing'
                      ? 'Принимает обратный ток'
                      : 'Без нагрузки'
                  : result.operatingRegion;
  return typeof raw === 'number' ? (Number.isFinite(raw) ? raw : null) : (raw ?? null);
}

export function validateComponentInformationKinds(
  kinds: readonly ComponentKind[],
): readonly string[] {
  return [...new Set(kinds)].filter((kind) => PROFILE_BY_KIND[kind] === undefined);
}
