import type { ComponentKind } from './component-model.js';

export type ComponentPropertyPrimitive = string | number | boolean;
export type ComponentPropertyValue = ComponentPropertyPrimitive | readonly ComponentPropertyPrimitive[];

export interface NumberPropertyDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: 'number';
  readonly unit: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly editable: boolean;
  readonly presets?: readonly number[];
}

export interface EnumPropertyDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: 'enum';
  readonly values: readonly string[];
  readonly defaultValue: string;
  readonly editable: boolean;
}

export interface BooleanPropertyDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: 'boolean';
  readonly defaultValue: boolean;
  readonly editable: boolean;
}

export type ComponentPropertyDefinition =
  | NumberPropertyDefinition
  | EnumPropertyDefinition
  | BooleanPropertyDefinition;

export interface ComponentPropertySchema {
  readonly componentKind: ComponentKind;
  readonly properties: readonly ComponentPropertyDefinition[];
  /** Legacy schemaVersion 1 stores one numeric `value`; this key receives it. */
  readonly legacyValueKey: string | null;
  readonly modelNote: string;
}

export interface ComponentPropertyValidationSuccess {
  readonly ok: true;
  readonly properties: Readonly<Record<string, ComponentPropertyValue>>;
}

export interface ComponentPropertyValidationFailure {
  readonly ok: false;
  readonly code:
    | 'properties_not_object'
    | 'unknown_property'
    | 'missing_property'
    | 'invalid_property_type'
    | 'property_out_of_range'
    | 'property_value_not_allowed';
  readonly property?: string;
  readonly message: string;
}

export type ComponentPropertyValidation =
  | ComponentPropertyValidationSuccess
  | ComponentPropertyValidationFailure;

export const COMPONENT_PROPERTY_SCHEMAS: Readonly<Record<ComponentKind, ComponentPropertySchema>> = {
  source: {
    componentKind: 'source',
    legacyValueKey: 'voltageV',
    properties: [
      {
        key: 'voltageV',
        label: 'Напряжение',
        type: 'number',
        unit: 'В',
        minimum: 3,
        maximum: 3,
        step: 0,
        defaultValue: 3,
        editable: false,
      },
      {
        key: 'chemistry',
        label: 'Тип источника',
        type: 'enum',
        values: ['2xAA'],
        defaultValue: '2xAA',
        editable: false,
      },
    ],
    modelNote: 'Current owner asset is a fixed 2×AA holder and must not behave as an adjustable bench source.',
  },
  resistor: {
    componentKind: 'resistor',
    legacyValueKey: 'resistanceOhm',
    properties: [
      {
        key: 'resistanceOhm',
        label: 'Сопротивление',
        type: 'number',
        unit: 'Ом',
        minimum: 1,
        maximum: 1_000_000_000,
        step: 1,
        defaultValue: 300,
        editable: true,
        presets: [100, 220, 300, 330, 470, 1_000, 4_700, 10_000, 100_000, 1_000_000],
      },
      {
        key: 'tolerancePercent',
        label: 'Допуск',
        type: 'enum',
        values: ['1', '2', '5', '10'],
        defaultValue: '5',
        editable: true,
      },
      {
        key: 'leadSpanPitches',
        label: 'Шаг между выводами',
        type: 'number',
        unit: '×2,54 мм',
        minimum: 4,
        maximum: 20,
        step: 1,
        defaultValue: 10,
        editable: false,
      },
    ],
    modelNote:
      'Resistance drives the electrical model and colour bands. Lead span drives geometry only; flexible leads remain evidence-required.',
  },
  led: {
    componentKind: 'led',
    legacyValueKey: 'forwardVoltageV',
    properties: [
      {
        key: 'color',
        label: 'Цвет',
        type: 'enum',
        values: ['red'],
        defaultValue: 'red',
        editable: false,
      },
      {
        key: 'forwardVoltageV',
        label: 'Прямое падение',
        type: 'number',
        unit: 'В',
        minimum: 2,
        maximum: 2,
        step: 0,
        defaultValue: 2,
        editable: false,
      },
      {
        key: 'maximumCurrentA',
        label: 'Рекомендуемый максимальный ток',
        type: 'number',
        unit: 'А',
        minimum: 0.02,
        maximum: 0.02,
        step: 0,
        defaultValue: 0.02,
        editable: false,
      },
    ],
    modelNote:
      'The current foundation models a red 5 mm LED with state assets; unsupported thermal damage remains a diagnostic, not fake physics.',
  },
  breadboard: {
    componentKind: 'breadboard',
    legacyValueKey: null,
    properties: [
      {
        key: 'boardKind',
        label: 'Макетная плата',
        type: 'enum',
        values: ['half-400'],
        defaultValue: 'half-400',
        editable: false,
      },
      {
        key: 'pitchMm',
        label: 'Шаг отверстий',
        type: 'number',
        unit: 'мм',
        minimum: 2.54,
        maximum: 2.54,
        step: 0,
        defaultValue: 2.54,
        editable: false,
      },
    ],
    modelNote:
      'Breadboard is a connectivity component. Its physical holes and internal buses are authoritative; a scalar electrical value is meaningless.',
  },
  wire: {
    componentKind: 'wire',
    legacyValueKey: null,
    properties: [
      {
        key: 'ideal',
        label: 'Идеальный провод',
        type: 'boolean',
        defaultValue: true,
        editable: false,
      },
    ],
    modelNote: 'Wire geometry and colour are document fields; current electrical resistance is ideal zero.',
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultValue(definition: ComponentPropertyDefinition): ComponentPropertyPrimitive {
  return definition.defaultValue;
}

export function defaultComponentProperties(
  kind: ComponentKind,
): Readonly<Record<string, ComponentPropertyValue>> {
  return Object.fromEntries(
    COMPONENT_PROPERTY_SCHEMAS[kind].properties.map((definition) => [
      definition.key,
      defaultValue(definition),
    ]),
  );
}

export function legacyValueToComponentProperties(
  kind: ComponentKind,
  legacyValue: number,
): Readonly<Record<string, ComponentPropertyValue>> {
  const defaults = { ...defaultComponentProperties(kind) };
  const key = COMPONENT_PROPERTY_SCHEMAS[kind].legacyValueKey;
  if (key !== null) defaults[key] = legacyValue;
  return defaults;
}

export function validateComponentProperties(
  kind: ComponentKind,
  value: unknown,
): ComponentPropertyValidation {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: 'properties_not_object',
      message: 'Component properties must be an object.',
    };
  }
  const schema = COMPONENT_PROPERTY_SCHEMAS[kind];
  const definitions = new Map(schema.properties.map((definition) => [definition.key, definition]));
  for (const key of Object.keys(value)) {
    if (!definitions.has(key)) {
      return {
        ok: false,
        code: 'unknown_property',
        property: key,
        message: `Unknown ${kind} property: ${key}.`,
      };
    }
  }
  const normalized: Record<string, ComponentPropertyValue> = {};
  for (const definition of schema.properties) {
    const candidate = value[definition.key];
    if (candidate === undefined) {
      return {
        ok: false,
        code: 'missing_property',
        property: definition.key,
        message: `Missing ${kind} property: ${definition.key}.`,
      };
    }
    if (definition.type === 'number') {
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        return {
          ok: false,
          code: 'invalid_property_type',
          property: definition.key,
          message: `${definition.key} must be a finite number.`,
        };
      }
      if (candidate < definition.minimum || candidate > definition.maximum) {
        return {
          ok: false,
          code: 'property_out_of_range',
          property: definition.key,
          message: `${definition.key} must be between ${definition.minimum} and ${definition.maximum}.`,
        };
      }
      normalized[definition.key] = candidate;
      continue;
    }
    if (definition.type === 'boolean') {
      if (typeof candidate !== 'boolean') {
        return {
          ok: false,
          code: 'invalid_property_type',
          property: definition.key,
          message: `${definition.key} must be boolean.`,
        };
      }
      normalized[definition.key] = candidate;
      continue;
    }
    if (typeof candidate !== 'string') {
      return {
        ok: false,
        code: 'invalid_property_type',
        property: definition.key,
        message: `${definition.key} must be a string enum value.`,
      };
    }
    if (!definition.values.includes(candidate)) {
      return {
        ok: false,
        code: 'property_value_not_allowed',
        property: definition.key,
        message: `${definition.key} has unsupported value: ${candidate}.`,
      };
    }
    normalized[definition.key] = candidate;
  }
  return { ok: true, properties: normalized };
}
