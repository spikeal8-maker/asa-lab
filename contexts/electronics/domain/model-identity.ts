import type { ComponentKind, ProductionStateValue, SchematicComponent } from './document.js';

export type ElectricalModelId =
  | 'ideal-dc-source'
  | 'resistor'
  | 'ordinary-led'
  | 'rgb-led'
  | 'seven-segment'
  | 'momentary-button'
  | 'spdt-switch'
  | 'potentiometer'
  | 'photoresistor'
  | 'passive-piezo'
  | 'diode'
  | 'npn-transistor'
  | 'pnp-transistor'
  | 'n-channel-fet'
  | 'incandescent-lamp'
  | 'breadboard-connectivity'
  | 'arduino-uno'
  | 'ideal-wire'
  | 'unsupported';

export interface ElectricalModelIdentity {
  readonly electricalModelId: ElectricalModelId | string;
  readonly electricalModelVersion: number;
  readonly modelProfileId: string;
  readonly modelProfileVersion: number;
}

export interface ElectricalModelRegistryEntry extends ElectricalModelIdentity {
  readonly componentTypeId: string;
}

export const ELECTRICAL_MODEL_REGISTRY_VERSION = 1;

const KNOWN_MODEL_IDS: ReadonlySet<string> = new Set<ElectricalModelId>([
  'ideal-dc-source',
  'resistor',
  'ordinary-led',
  'rgb-led',
  'seven-segment',
  'momentary-button',
  'spdt-switch',
  'potentiometer',
  'photoresistor',
  'passive-piezo',
  'diode',
  'npn-transistor',
  'pnp-transistor',
  'n-channel-fet',
  'incandescent-lamp',
  'breadboard-connectivity',
  'arduino-uno',
  'ideal-wire',
  'unsupported',
]);

const EXACT_IDENTITIES: Readonly<Record<string, ElectricalModelIdentity>> = {
  'arduino-uno': identity('arduino-uno', 'arduino-uno-r3'),
  'resistor-axial': identity('resistor', 'axial-resistor'),
  'led-5mm': identity('ordinary-led', 'generic-red-led'),
  'rgb-led': identity('rgb-led', 'generic-rgb-led'),
  'seven-segment-display': identity('seven-segment', 'generic-seven-segment'),
  'button-tactile-6mm': identity('momentary-button', 'tactile-button-6mm'),
  'switch-spdt': identity('spdt-switch', 'slide-switch-spdt'),
  potentiometer: identity('potentiometer', 'generic-potentiometer'),
  photoresistor: identity('photoresistor', 'generic-photoresistor'),
  'piezo-passive-buzzer': identity('passive-piezo', 'passive-piezo-enclosed'),
  'piezo-disc': identity('passive-piezo', 'passive-piezo-disc'),
  'diode-do35': identity('diode', 'generic-signal-diode-do35'),
  'diode-do41': identity('diode', 'generic-rectifier-diode-do41'),
  'transistor-npn': identity('npn-transistor', 'generic-npn-to92'),
  'transistor-pnp': identity('pnp-transistor', 'generic-pnp-to92'),
  'transistor-fet': identity('n-channel-fet', 'generic-n-channel-fet-to92'),
  'incandescent-lamp': identity('incandescent-lamp', 'generic-incandescent-lamp'),
  'breadboard-small': identity('breadboard-connectivity', 'breadboard-small'),
  'breadboard-medium': identity('breadboard-connectivity', 'breadboard-medium'),
  'breadboard-large': identity('breadboard-connectivity', 'breadboard-large'),
  'battery-3v': identity('ideal-dc-source', 'generic-battery-3v'),
  'battery-9v': identity('ideal-dc-source', 'generic-battery-9v'),
  'battery-holder-aa-1': identity('ideal-dc-source', 'generic-battery-pack-aa-1'),
  'battery-holder-aa-2': identity('ideal-dc-source', 'generic-battery-pack-aa-2'),
  'battery-holder-aa-3': identity('ideal-dc-source', 'generic-battery-pack-aa-3'),
  'battery-holder-aa-4': identity('ideal-dc-source', 'generic-battery-pack-aa-4'),
  'battery-holder-aa-6': identity('ideal-dc-source', 'generic-battery-pack-aa-6'),
  'battery-holder-aa-8': identity('ideal-dc-source', 'generic-battery-pack-aa-8'),
  'regulated-power-supply': identity('ideal-dc-source', 'generic-regulated-power-supply'),
};

function identity(
  electricalModelId: ElectricalModelId,
  modelProfileId: string,
): ElectricalModelIdentity {
  return {
    electricalModelId,
    electricalModelVersion: 1,
    modelProfileId,
    modelProfileVersion: 1,
  };
}

function legacyIdentity(
  kind: ComponentKind,
  stateProperties?: Readonly<Record<string, ProductionStateValue>>,
): ElectricalModelIdentity {
  if (kind === 'transistor') {
    const transistorType = stateProperties?.['transistorType'];
    if (transistorType === 'pnp') return identity('pnp-transistor', 'legacy-pnp-transistor');
    if (transistorType === 'fet') return identity('n-channel-fet', 'legacy-n-channel-fet');
    return identity('npn-transistor', 'legacy-npn-transistor');
  }
  const byKind: Readonly<Record<ComponentKind, ElectricalModelId>> = {
    source: 'ideal-dc-source',
    resistor: 'resistor',
    led: 'ordinary-led',
    'rgb-led': 'rgb-led',
    'seven-segment': 'seven-segment',
    button: 'momentary-button',
    switch: 'spdt-switch',
    potentiometer: 'potentiometer',
    photoresistor: 'photoresistor',
    piezo: 'passive-piezo',
    diode: 'diode',
    transistor: 'npn-transistor',
    lamp: 'incandescent-lamp',
    breadboard: 'breadboard-connectivity',
    visual: 'unsupported',
    wire: 'ideal-wire',
  };
  return identity(byKind[kind], `legacy-${kind}`);
}

export function resolveElectricalModelIdentity(input: {
  readonly componentTypeId?: string;
  readonly kind: ComponentKind;
  readonly stateProperties?: Readonly<Record<string, ProductionStateValue>>;
}): ElectricalModelIdentity {
  if (input.componentTypeId) {
    const exact = EXACT_IDENTITIES[input.componentTypeId];
    if (exact) return exact;
    return identity('unsupported', `unsupported-${input.componentTypeId}`);
  }
  return legacyIdentity(input.kind, input.stateProperties);
}

export function electricalModelIdentityForComponent(
  component: SchematicComponent,
): ElectricalModelIdentity {
  if (
    component.electricalModelId &&
    component.electricalModelVersion &&
    component.modelProfileId &&
    component.modelProfileVersion
  ) {
    return {
      electricalModelId: component.electricalModelId,
      electricalModelVersion: component.electricalModelVersion,
      modelProfileId: component.modelProfileId,
      modelProfileVersion: component.modelProfileVersion,
    };
  }
  return resolveElectricalModelIdentity(component);
}

export function isKnownElectricalModelId(value: string): value is ElectricalModelId {
  return KNOWN_MODEL_IDS.has(value);
}

export function componentModelIdentityIsInstalled(component: SchematicComponent): boolean {
  const actual = electricalModelIdentityForComponent(component);
  const installed = resolveElectricalModelIdentity(component);
  return (
    isKnownElectricalModelId(actual.electricalModelId) &&
    actual.electricalModelId !== 'unsupported' &&
    actual.electricalModelId === installed.electricalModelId &&
    actual.electricalModelVersion === installed.electricalModelVersion &&
    actual.modelProfileId === installed.modelProfileId &&
    actual.modelProfileVersion === installed.modelProfileVersion
  );
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function electricalModelRegistryEntries(): readonly ElectricalModelRegistryEntry[] {
  return Object.entries(EXACT_IDENTITIES)
    .sort(([left], [right]) => ordinalCompare(left, right))
    .map(([componentTypeId, model]) => ({ componentTypeId, ...model }));
}

export function canonicalElectricalModelRegistry(): string {
  return JSON.stringify({
    registryVersion: ELECTRICAL_MODEL_REGISTRY_VERSION,
    entries: electricalModelRegistryEntries(),
  });
}
