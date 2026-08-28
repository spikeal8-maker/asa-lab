import type { SchematicComponent, Terminal } from '../document.js';
import {
  componentModelIdentityIsInstalled,
  electricalModelIdentityForComponent,
} from '../model-identity.js';
import type { DeviceDiagnostic, DeviceModel, NormalizedDevice } from './device-model.js';

const CLOSED_RESISTANCE_OHM = 1e-4;
const LEGACY_SOURCE_RESISTANCE_OHM = 1e-12;
const FRESH_AA_INTERNAL_RESISTANCE_OHM = 0.225;
const FRESH_CR2032_INTERNAL_RESISTANCE_OHM = 13;
const DEFAULT_RESISTOR_POWER_RATING_W = 0.25;
const RESISTOR_WARNING_PERCENT = 80;

export type LinearDcStressState = 'normal' | 'warning' | 'overcurrent' | 'burned';

export interface LinearDcObservation {
  readonly current: number;
  readonly power: number;
  readonly stressState: LinearDcStressState;
  readonly currentUtilizationPercent?: number;
  readonly powerUtilizationPercent?: number;
  readonly internalResistanceOhm?: number;
  readonly internalPower?: number;
  readonly voltageSag?: number;
  readonly sourceOperatingMode?: 'delivering' | 'idle' | 'absorbing';
  /** Positive values enter the component through the named physical terminal. */
  readonly terminalCurrents: Readonly<Record<Terminal, number>>;
  readonly voltageConstraintResidual?: number;
  readonly diagnostics: readonly DeviceDiagnostic[];
}

function physicalTerminalPair(component: SchematicComponent): readonly [Terminal, Terminal] {
  if (!component.componentTypeId) return ['a', 'b'];
  if (component.kind === 'source') {
    return component.pinIds?.includes('BAT+') ? ['BAT+', 'BAT-'] : ['positive', 'negative'];
  }
  return component.componentTypeId ? ['lead-1', 'lead-2'] : ['a', 'b'];
}

function stressFromPercent(
  utilizationPercent: number,
  warningPercent: number,
): LinearDcStressState {
  if (utilizationPercent > 200.000_001) return 'burned';
  if (utilizationPercent > 100.000_001) return 'overcurrent';
  if (utilizationPercent >= warningPercent) return 'warning';
  return 'normal';
}

export interface ResistorParameters {
  readonly resistanceOhm: number;
  readonly powerRatingWatt: number;
}

export interface SourceParameters {
  readonly emfVolt: number;
  readonly internalResistanceOhm: number;
  readonly continuousCurrentAmp: number;
}

export function sourceInternalResistanceOhm(component: SchematicComponent): number {
  const configured = Number(component.stateProperties?.['internalResistanceOhm']);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const typeId = component.componentTypeId ?? '';
  const holder = /^battery-holder-aa-(\d+)$/.exec(typeId);
  if (holder) return Math.max(1, Number(holder[1])) * FRESH_AA_INTERNAL_RESISTANCE_OHM;
  if (typeId === 'battery-3v') return FRESH_CR2032_INTERNAL_RESISTANCE_OHM;
  if (!typeId) return LEGACY_SOURCE_RESISTANCE_OHM;
  return 0.1;
}

export function sourceContinuousCurrentAmp(component: SchematicComponent): number {
  const configured = Number(component.stateProperties?.['maxContinuousCurrentAmp']);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const typeId = component.componentTypeId ?? '';
  if (typeId === 'battery-3v') return 0.003;
  if (/^battery-holder-aa-\d+$/.test(typeId)) return 1;
  return 1;
}

export function resistorPowerRatingWatt(component: SchematicComponent): number {
  const configured = Number(component.stateProperties?.['powerRatingWatt']);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RESISTOR_POWER_RATING_W;
}

export const RESISTOR_DEVICE_MODEL: DeviceModel<ResistorParameters, LinearDcObservation> = {
  id: 'resistor',
  version: 1,
  analyses: ['dc'],
  validate(component) {
    return Number.isFinite(component.value) && component.value >= 0
      ? []
      : [{ code: 'invalid_resistance', message: 'Сопротивление должно быть конечным.' }];
  },
  normalize(component) {
    return {
      componentId: component.id,
      component,
      parameters: {
        resistanceOhm: Math.max(CLOSED_RESISTANCE_OHM, component.value),
        powerRatingWatt: resistorPowerRatingWatt(component),
      },
    };
  },
  stampDc(context, instance) {
    const left = context.node(instance.component, 'a');
    const right = context.node(instance.component, 'b');
    context.stampConductance(left, right, 1 / instance.parameters.resistanceOhm);
  },
  observe(instance, operatingPoint) {
    const currentAmp = operatingPoint.voltageDrop / instance.parameters.resistanceOhm;
    const powerWatt = Math.abs(currentAmp * operatingPoint.voltageDrop);
    const powerUtilizationPercent = (powerWatt / instance.parameters.powerRatingWatt) * 100;
    const [left, right] = physicalTerminalPair(instance.component);
    const label = instance.component.name ?? instance.component.id;
    const diagnostics: DeviceDiagnostic[] =
      powerUtilizationPercent > 100
        ? [
            {
              code: 'resistor_overload',
              severity: 'error',
              message: `${label}: мощность ${powerWatt.toFixed(3)} Вт превышает номинал ${instance.parameters.powerRatingWatt.toFixed(3)} Вт. Резистор перегревается и может выйти из строя.`,
              suggestedAction:
                'Увеличьте сопротивление или допустимую мощность резистора либо уменьшите напряжение питания.',
            },
          ]
        : powerUtilizationPercent >= RESISTOR_WARNING_PERCENT
          ? [
              {
                code: 'resistor_near_limit',
                severity: 'warning',
                message: `${label}: мощность ${powerWatt.toFixed(3)} Вт близка к номиналу ${instance.parameters.powerRatingWatt.toFixed(3)} Вт.`,
                suggestedAction: 'Оставьте запас по мощности или выберите более мощный резистор.',
              },
            ]
          : [];
    return {
      current: currentAmp,
      power: powerWatt,
      powerUtilizationPercent,
      stressState: stressFromPercent(powerUtilizationPercent, RESISTOR_WARNING_PERCENT),
      terminalCurrents: { [left]: currentAmp, [right]: -currentAmp },
      diagnostics,
    };
  },
};

export const SOURCE_DEVICE_MODEL: DeviceModel<SourceParameters, LinearDcObservation> = {
  id: 'ideal-dc-source',
  version: 1,
  analyses: ['dc'],
  validate(component) {
    return Number.isFinite(component.value) && component.value > 0
      ? []
      : [{ code: 'invalid_voltage', message: 'Напряжение должно быть больше нуля.' }];
  },
  normalize(component) {
    return {
      componentId: component.id,
      component,
      parameters: {
        emfVolt: component.value,
        internalResistanceOhm: sourceInternalResistanceOhm(component),
        continuousCurrentAmp: sourceContinuousCurrentAmp(component),
      },
    };
  },
  stampDc(context, instance) {
    const positive = context.node(instance.component, 'a');
    const negative = context.node(instance.component, 'b');
    context.stampVoltageSource(
      instance.componentId,
      positive,
      negative,
      instance.parameters.emfVolt,
      instance.parameters.internalResistanceOhm,
    );
  },
  observe(instance, operatingPoint) {
    const currentAmp = operatingPoint.current;
    const sourceOperatingMode =
      currentAmp > 1e-9 ? 'delivering' : currentAmp < -1e-9 ? 'absorbing' : 'idle';
    const currentUtilizationPercent =
      (Math.abs(currentAmp) / instance.parameters.continuousCurrentAmp) * 100;
    const [positive, negative] = physicalTerminalPair(instance.component);
    const diagnostics: DeviceDiagnostic[] =
      currentUtilizationPercent > 100.000_001
        ? [
            {
              code: 'source_overload',
              severity: 'error',
              message: `${instance.component.name ?? instance.component.id}: ток ${Math.abs(currentAmp).toFixed(3)} А превышает длительный предел ${instance.parameters.continuousCurrentAmp.toFixed(3)} А. Источник нагревается, а напряжение на клеммах проседает.`,
              suggestedAction: 'Уберите короткое замыкание или уменьшите нагрузку.',
            },
          ]
        : [];
    return {
      current: currentAmp,
      power: Math.abs(currentAmp * operatingPoint.voltageDrop),
      currentUtilizationPercent,
      stressState: stressFromPercent(currentUtilizationPercent, 80),
      internalResistanceOhm: instance.parameters.internalResistanceOhm,
      internalPower: currentAmp * currentAmp * instance.parameters.internalResistanceOhm,
      voltageSag: Math.abs(currentAmp) * instance.parameters.internalResistanceOhm,
      sourceOperatingMode,
      terminalCurrents: { [positive]: -currentAmp, [negative]: currentAmp },
      voltageConstraintResidual: Math.abs(
        operatingPoint.voltageDrop -
          (instance.parameters.emfVolt - currentAmp * instance.parameters.internalResistanceOhm),
      ),
      diagnostics,
    };
  },
};

export interface ResistorDevice {
  readonly model: typeof RESISTOR_DEVICE_MODEL;
  readonly instance: NormalizedDevice<ResistorParameters>;
}

export interface SourceDevice {
  readonly model: typeof SOURCE_DEVICE_MODEL;
  readonly instance: NormalizedDevice<SourceParameters>;
}

export type LinearDcDevice = ResistorDevice | SourceDevice;

export function isResistorDevice(device: LinearDcDevice): device is ResistorDevice {
  return device.model === RESISTOR_DEVICE_MODEL;
}

export function isSourceDevice(device: LinearDcDevice): device is SourceDevice {
  return device.model === SOURCE_DEVICE_MODEL;
}

export function createLinearDcDevice(component: SchematicComponent): LinearDcDevice | null {
  if (!componentModelIdentityIsInstalled(component)) return null;
  const identity = electricalModelIdentityForComponent(component);
  if (identity.electricalModelId === RESISTOR_DEVICE_MODEL.id) {
    return { model: RESISTOR_DEVICE_MODEL, instance: RESISTOR_DEVICE_MODEL.normalize(component) };
  }
  if (identity.electricalModelId === SOURCE_DEVICE_MODEL.id) {
    return { model: SOURCE_DEVICE_MODEL, instance: SOURCE_DEVICE_MODEL.normalize(component) };
  }
  return null;
}
