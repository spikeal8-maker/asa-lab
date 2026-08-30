import type { ComponentKind, SchematicComponent, Terminal } from './document.js';
import { isArduinoUno } from './arduino-model.js';
import {
  componentModelIdentityIsInstalled,
  electricalModelIdentityForComponent,
  type ElectricalModelId,
} from './model-identity.js';

export type { ElectricalModelId } from './model-identity.js';

export type ElectricalModelSupport = 'supported' | 'infrastructure' | 'unsupported';

export interface ElectricalModelDescriptor {
  readonly id: ElectricalModelId | 'unsupported';
  readonly version?: number;
  readonly profileId?: string;
  readonly profileVersion?: number;
  readonly kind: ComponentKind;
  readonly support: ElectricalModelSupport;
  readonly topology:
    | 'voltage-source'
    | 'two-terminal'
    | 'three-terminal'
    | 'multi-junction'
    | 'connectivity-only'
    | 'unsupported';
  readonly requiredTerminals: readonly Terminal[];
}

export interface ElectricalTerminalContractResult {
  readonly valid: boolean;
  readonly missing: readonly Terminal[];
}

const MODELS: Readonly<Record<ComponentKind, ElectricalModelDescriptor>> = {
  source: {
    id: 'ideal-dc-source',
    kind: 'source',
    support: 'supported',
    topology: 'voltage-source',
    requiredTerminals: ['a', 'b'],
  },
  resistor: {
    id: 'resistor',
    kind: 'resistor',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['a', 'b'],
  },
  led: {
    id: 'ordinary-led',
    kind: 'led',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['a', 'b'],
  },
  'rgb-led': {
    id: 'rgb-led',
    kind: 'rgb-led',
    support: 'supported',
    topology: 'multi-junction',
    requiredTerminals: ['red', 'common', 'green', 'blue'],
  },
  'seven-segment': {
    id: 'seven-segment',
    kind: 'seven-segment',
    support: 'supported',
    topology: 'multi-junction',
    requiredTerminals: [
      'top-1',
      'top-2',
      'top-3',
      'top-4',
      'top-5',
      'bottom-1',
      'bottom-2',
      'bottom-3',
      'bottom-4',
      'bottom-5',
    ],
  },
  button: {
    id: 'momentary-button',
    kind: 'button',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['a', 'b'],
  },
  switch: {
    id: 'spdt-switch',
    kind: 'switch',
    support: 'supported',
    topology: 'three-terminal',
    requiredTerminals: ['common', 'throw-left', 'throw-right'],
  },
  potentiometer: {
    id: 'potentiometer',
    kind: 'potentiometer',
    support: 'supported',
    topology: 'three-terminal',
    requiredTerminals: ['a', 'b', 'wiper'],
  },
  photoresistor: {
    id: 'photoresistor',
    kind: 'photoresistor',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['a', 'b'],
  },
  piezo: {
    id: 'passive-piezo',
    kind: 'piezo',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['positive', 'negative'],
  },
  diode: {
    id: 'diode',
    kind: 'diode',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['a', 'b'],
  },
  transistor: {
    id: 'npn-transistor',
    kind: 'transistor',
    support: 'supported',
    topology: 'three-terminal',
    requiredTerminals: ['base', 'collector', 'emitter'],
  },
  lamp: {
    id: 'incandescent-lamp',
    kind: 'lamp',
    support: 'supported',
    topology: 'two-terminal',
    requiredTerminals: ['a', 'b'],
  },
  breadboard: {
    id: 'breadboard-connectivity',
    kind: 'breadboard',
    support: 'infrastructure',
    topology: 'connectivity-only',
    requiredTerminals: [],
  },
  wire: {
    id: 'ideal-wire',
    kind: 'wire',
    support: 'infrastructure',
    topology: 'connectivity-only',
    requiredTerminals: ['a', 'b'],
  },
  visual: {
    id: 'unsupported',
    kind: 'visual',
    support: 'unsupported',
    topology: 'unsupported',
    requiredTerminals: [],
  },
};

const ARDUINO_UNO_MODEL: ElectricalModelDescriptor = {
  id: 'arduino-uno',
  kind: 'visual',
  support: 'supported',
  topology: 'multi-junction',
  requiredTerminals: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
};

const DC_MOTOR_MODEL: ElectricalModelDescriptor = {
  id: 'dc-motor',
  kind: 'visual',
  support: 'supported',
  topology: 'two-terminal',
  requiredTerminals: ['negative', 'positive'],
};

const ELECTROLYTIC_CAPACITOR_MODEL: ElectricalModelDescriptor = {
  id: 'capacitor',
  kind: 'visual',
  support: 'supported',
  topology: 'two-terminal',
  requiredTerminals: ['negative', 'positive'],
};

export function electricalModelFor(component: SchematicComponent): ElectricalModelDescriptor {
  const identity = electricalModelIdentityForComponent(component);
  const installed = componentModelIdentityIsInstalled(component);
  const base = !installed
    ? MODELS.visual
    : isArduinoUno(component)
      ? ARDUINO_UNO_MODEL
      : component.componentTypeId === 'dc-motor' || component.componentTypeId === 'gearmotor'
        ? DC_MOTOR_MODEL
        : component.componentTypeId === 'electrolytic-capacitor'
          ? ELECTROLYTIC_CAPACITOR_MODEL
          : MODELS[component.kind];
  return {
    ...base,
    id: installed ? (identity.electricalModelId as ElectricalModelId) : 'unsupported',
    version: identity.electricalModelVersion,
    profileId: identity.modelProfileId,
    profileVersion: identity.modelProfileVersion,
    ...(!installed ? { support: 'unsupported' as const, topology: 'unsupported' as const } : {}),
  };
}

export function unsupportedElectricalComponents(
  components: readonly SchematicComponent[],
): readonly SchematicComponent[] {
  return components.filter((component) => electricalModelFor(component).support === 'unsupported');
}

function productionRequiredTerminals(component: SchematicComponent): readonly Terminal[] {
  if (!component.componentTypeId) return [];
  if (isArduinoUno(component)) return ARDUINO_UNO_MODEL.requiredTerminals;
  if (component.componentTypeId === 'dc-motor' || component.componentTypeId === 'gearmotor')
    return DC_MOTOR_MODEL.requiredTerminals;
  if (component.componentTypeId === 'electrolytic-capacitor')
    return ELECTROLYTIC_CAPACITOR_MODEL.requiredTerminals;
  // Holders expose BAT+/BAT-; single-cell batteries and the bench supply use
  // positive/negative. The simulation maps both already — the contract must
  // accept whichever pair the component actually carries, or a catalog battery
  // can never pass validation no matter how well it is wired.
  if (component.kind === 'source') {
    const pins = new Set(component.pinIds ?? []);
    if (pins.has('positive') || pins.has('negative')) return ['negative', 'positive'];
    return ['BAT-', 'BAT+'];
  }
  if (component.kind === 'resistor' || component.kind === 'photoresistor')
    return ['lead-1', 'lead-2'];
  if (component.kind === 'led' || component.kind === 'diode') return ['anode', 'cathode'];
  if (component.kind === 'transistor') {
    const pins = new Set(component.pinIds ?? []);
    if (pins.has('gate') || pins.has('drain')) return ['gate', 'source', 'drain'];
    return ['base', 'collector', 'emitter'];
  }
  if (component.kind === 'rgb-led') return ['red', 'common', 'green', 'blue'];
  if (component.kind === 'seven-segment') return MODELS['seven-segment'].requiredTerminals;
  if (component.kind === 'button') return ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'];
  if (component.kind === 'switch') return ['throw-left', 'common', 'throw-right'];
  if (component.kind === 'potentiometer') return ['terminal-1', 'wiper', 'terminal-2'];
  if (component.kind === 'lamp') return ['L1', 'L2'];
  return [];
}

export function validateElectricalTerminalContract(
  component: SchematicComponent,
): ElectricalTerminalContractResult {
  const required = productionRequiredTerminals(component);
  const available = new Set(component.pinIds ?? []);
  const missing = required.filter((terminal) => !available.has(terminal));
  return { valid: missing.length === 0, missing };
}
