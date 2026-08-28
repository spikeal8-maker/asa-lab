import type { SchematicComponent, Terminal } from '../document.js';
import {
  componentModelIdentityIsInstalled,
  electricalModelIdentityForComponent,
} from '../model-identity.js';
import type { DeviceDiagnostic, IterativeDcDeviceModel, NormalizedDevice } from './device-model.js';

const GMIN = 1e-12;
const REGION_HYSTERESIS_VOLT = 0.02;
const ITERATION_CONDUCTANCE_TOLERANCE = 1e-12;

export type NpnOperatingRegion = 'cutoff' | 'active' | 'saturation';
export type NpnStressState = 'normal' | 'warning' | 'overcurrent' | 'burned';

export interface NpnProfile {
  readonly version: number;
  readonly currentGain: number;
  readonly baseEmitterVoltageVolt: number;
  readonly baseEmitterDynamicResistanceOhm: number;
  readonly saturationVoltageVolt: number;
  readonly saturationDynamicResistanceOhm: number;
  /** Declared finite output resistance: ro is approximated as VA / Ic. */
  readonly earlyVoltageVolt: number;
  readonly maxCollectorCurrentAmp: number;
  readonly maxPowerWatt: number;
  readonly reverseBaseEmitterLimitVolt: number;
}

export const NPN_DC_PROFILES: Readonly<Record<string, NpnProfile>> = {
  'generic-npn-to92': {
    version: 1,
    currentGain: 100,
    baseEmitterVoltageVolt: 0.7,
    baseEmitterDynamicResistanceOhm: 10,
    saturationVoltageVolt: 0.2,
    saturationDynamicResistanceOhm: 0.5,
    earlyVoltageVolt: 100,
    maxCollectorCurrentAmp: 0.2,
    maxPowerWatt: 0.625,
    reverseBaseEmitterLimitVolt: 5,
  },
  'legacy-npn-transistor': {
    version: 1,
    currentGain: 100,
    baseEmitterVoltageVolt: 0.7,
    baseEmitterDynamicResistanceOhm: 10,
    saturationVoltageVolt: 0.2,
    saturationDynamicResistanceOhm: 0.5,
    earlyVoltageVolt: 100,
    maxCollectorCurrentAmp: 0.2,
    maxPowerWatt: 0.625,
    reverseBaseEmitterLimitVolt: 5,
  },
};

const FALLBACK_PROFILE = NPN_DC_PROFILES['generic-npn-to92'] as NpnProfile;

export interface NpnParameters extends NpnProfile {
  readonly base: Terminal;
  readonly collector: Terminal;
  readonly emitter: Terminal;
}

export interface NpnIterationState {
  readonly region: NpnOperatingRegion;
  readonly earlyConductanceSiemens: number;
}

export interface NpnOperatingPoint {
  readonly baseEmitterDropVolt: number;
  readonly collectorEmitterDropVolt: number;
}

export interface NpnObservation {
  readonly operatingRegion: NpnOperatingRegion;
  readonly baseEmitterDropVolt: number;
  readonly collectorEmitterDropVolt: number;
  readonly baseCurrentAmp: number;
  readonly collectorCurrentAmp: number;
  readonly emitterCurrentAmp: number;
  readonly nominalCurrentGain: number;
  readonly effectiveCurrentGain: number;
  readonly earlyVoltageVolt: number;
  readonly maxCollectorCurrentAmp: number;
  readonly maxPowerWatt: number;
  readonly powerWatt: number;
  readonly currentUtilizationPercent: number;
  readonly powerUtilizationPercent: number;
  readonly stressState: NpnStressState;
  /** Positive values enter the component at base/collector and leave at emitter. */
  readonly terminalCurrents: Readonly<Record<Terminal, number>>;
  readonly diagnostics: readonly DeviceDiagnostic[];
}

export interface NpnDcDevice {
  readonly model: typeof NPN_DEVICE_MODEL;
  readonly instance: NormalizedDevice<NpnParameters>;
}

function finiteProperty(component: SchematicComponent, key: string, fallback: number): number {
  const value = rawProperty(component, key, fallback);
  return Number.isFinite(value) ? value : fallback;
}

function rawProperty(component: SchematicComponent, key: string, fallback: number): number {
  return Number(component.stateProperties?.[key] ?? fallback);
}

function boundedProperty(
  component: SchematicComponent,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, finiteProperty(component, key, fallback)));
}

function profileFor(component: SchematicComponent): NpnProfile {
  const identity = electricalModelIdentityForComponent(component);
  return NPN_DC_PROFILES[identity.modelProfileId] ?? FALLBACK_PROFILE;
}

function stressState(utilizationPercent: number): NpnStressState {
  if (utilizationPercent > 200.000_001) return 'burned';
  if (utilizationPercent > 100.000_001) return 'overcurrent';
  if (utilizationPercent >= 80) return 'warning';
  return 'normal';
}

function baseCurrent(parameters: NpnParameters, baseEmitterDropVolt: number): number {
  return Math.max(
    0,
    (baseEmitterDropVolt - parameters.baseEmitterVoltageVolt) /
      parameters.baseEmitterDynamicResistanceOhm,
  );
}

export function classifyNpnOperatingRegion(
  parameters: NpnParameters,
  operatingPoint: NpnOperatingPoint,
): NpnOperatingRegion {
  if (
    operatingPoint.baseEmitterDropVolt <
    parameters.baseEmitterVoltageVolt - REGION_HYSTERESIS_VOLT
  ) {
    return 'cutoff';
  }
  if (
    operatingPoint.collectorEmitterDropVolt <=
    parameters.saturationVoltageVolt + REGION_HYSTERESIS_VOLT
  ) {
    return 'saturation';
  }
  return 'active';
}

export const NPN_DEVICE_MODEL: IterativeDcDeviceModel<
  NpnParameters,
  NpnIterationState,
  NpnOperatingPoint,
  NpnObservation
> = {
  id: 'npn-transistor',
  version: 1,
  analyses: ['dc'],
  validate(component) {
    const profile = profileFor(component);
    const checks = [
      ['hFE', rawProperty(component, 'currentGain', profile.currentGain), 1, 1_000],
      [
        'VBE',
        rawProperty(component, 'baseEmitterVoltage', profile.baseEmitterVoltageVolt),
        0.4,
        1.2,
      ],
      [
        'VCE(sat)',
        rawProperty(component, 'saturationVoltage', profile.saturationVoltageVolt),
        0.05,
        0.6,
      ],
      [
        'Early voltage',
        rawProperty(component, 'earlyVoltage', profile.earlyVoltageVolt),
        10,
        1_000,
      ],
      [
        'Предельный ток коллектора',
        rawProperty(component, 'maxCollectorCurrent', profile.maxCollectorCurrentAmp),
        0.001,
        20,
      ],
      [
        'Предельная мощность',
        rawProperty(component, 'maxPowerWatt', profile.maxPowerWatt),
        0.01,
        100,
      ],
    ] as const;
    return checks.flatMap(([key, value, minimum, maximum]) =>
      Number.isFinite(value) && value >= minimum && value <= maximum
        ? []
        : [
            {
              code: 'invalid_npn_parameter',
              message: `${key} должен быть конечным значением от ${minimum} до ${maximum}.`,
            },
          ],
    );
  },
  normalize(component) {
    const profile = profileFor(component);
    return {
      componentId: component.id,
      component,
      parameters: {
        ...profile,
        currentGain: boundedProperty(component, 'currentGain', profile.currentGain, 1, 1_000),
        baseEmitterVoltageVolt: boundedProperty(
          component,
          'baseEmitterVoltage',
          profile.baseEmitterVoltageVolt,
          0.4,
          1.2,
        ),
        saturationVoltageVolt: boundedProperty(
          component,
          'saturationVoltage',
          profile.saturationVoltageVolt,
          0.05,
          0.6,
        ),
        earlyVoltageVolt: boundedProperty(
          component,
          'earlyVoltage',
          profile.earlyVoltageVolt,
          10,
          1_000,
        ),
        maxCollectorCurrentAmp: boundedProperty(
          component,
          'maxCollectorCurrent',
          profile.maxCollectorCurrentAmp,
          0.001,
          20,
        ),
        maxPowerWatt: boundedProperty(component, 'maxPowerWatt', profile.maxPowerWatt, 0.01, 100),
        base: 'base',
        collector: 'collector',
        emitter: 'emitter',
      },
    };
  },
  initialIterationState() {
    return { region: 'cutoff', earlyConductanceSiemens: 0 };
  },
  stampDc(context, instance, state) {
    const parameters = instance.parameters;
    const base = context.node(instance.component, parameters.base);
    const collector = context.node(instance.component, parameters.collector);
    const emitter = context.node(instance.component, parameters.emitter);
    if (state.region === 'cutoff') {
      context.stampConductance(base, emitter, GMIN);
      context.stampConductance(collector, emitter, GMIN);
      return;
    }

    const baseEmitterConductance = 1 / parameters.baseEmitterDynamicResistanceOhm;
    context.stampConductance(base, emitter, baseEmitterConductance);
    context.stampOffset(base, emitter, baseEmitterConductance * parameters.baseEmitterVoltageVolt);
    if (state.region === 'saturation') {
      const saturationConductance = 1 / parameters.saturationDynamicResistanceOhm;
      context.stampConductance(collector, emitter, saturationConductance);
      context.stampOffset(
        collector,
        emitter,
        saturationConductance * parameters.saturationVoltageVolt,
      );
      return;
    }

    const transconductance = parameters.currentGain * baseEmitterConductance;
    context.stampVccs(collector, emitter, base, emitter, transconductance);
    context.stampOffset(collector, emitter, transconductance * parameters.baseEmitterVoltageVolt);
    context.stampConductance(collector, emitter, Math.max(GMIN, state.earlyConductanceSiemens));
  },
  evaluateIteration(instance, state, operatingPoint) {
    const parameters = instance.parameters;
    const classified = classifyNpnOperatingRegion(parameters, operatingPoint);
    // The saturated companion model intentionally clamps VCE. Reclassifying
    // that clamped solution as active on the next pass creates a two-state
    // oscillation for strongly driven switches. Every fresh solve still starts
    // in cutoff, so this latch applies only inside one bounded operating-point
    // evaluation and cannot persist across document changes.
    const region =
      state.region === 'saturation' &&
      operatingPoint.baseEmitterDropVolt >=
        parameters.baseEmitterVoltageVolt - REGION_HYSTERESIS_VOLT
        ? 'saturation'
        : classified;
    const idealCollectorCurrentAmp =
      region === 'active'
        ? parameters.currentGain * baseCurrent(parameters, operatingPoint.baseEmitterDropVolt)
        : 0;
    const earlyConductanceSiemens =
      region === 'active'
        ? state.region === 'active'
          ? Math.max(GMIN, idealCollectorCurrentAmp / parameters.earlyVoltageVolt)
          : GMIN
        : 0;
    return {
      state: { region, earlyConductanceSiemens },
      changed:
        region !== state.region ||
        Math.abs(earlyConductanceSiemens - state.earlyConductanceSiemens) >
          ITERATION_CONDUCTANCE_TOLERANCE,
    };
  },
  observe(instance, state, operatingPoint) {
    const parameters = instance.parameters;
    const baseCurrentAmp =
      state.region === 'cutoff' ? 0 : baseCurrent(parameters, operatingPoint.baseEmitterDropVolt);
    const collectorCurrentAmp =
      state.region === 'cutoff'
        ? 0
        : state.region === 'active'
          ? Math.max(
              0,
              parameters.currentGain * baseCurrentAmp +
                state.earlyConductanceSiemens *
                  Math.max(0, operatingPoint.collectorEmitterDropVolt),
            )
          : Math.max(
              0,
              (operatingPoint.collectorEmitterDropVolt - parameters.saturationVoltageVolt) /
                parameters.saturationDynamicResistanceOhm,
            );
    const emitterCurrentAmp = baseCurrentAmp + collectorCurrentAmp;
    const powerWatt = Math.abs(
      collectorCurrentAmp * operatingPoint.collectorEmitterDropVolt +
        baseCurrentAmp * operatingPoint.baseEmitterDropVolt,
    );
    // A transistor can be destroyed by a large base current even when the
    // collector branch is open. Reporting collector current alone produced the
    // contradictory UI "power 100%, current 0%" for a directly powered base.
    // Use the largest current entering either active junction for the compact
    // component load indicator.
    const limitingCurrentAmp = Math.max(baseCurrentAmp, collectorCurrentAmp);
    const currentUtilizationPercent =
      (limitingCurrentAmp / parameters.maxCollectorCurrentAmp) * 100;
    const powerUtilizationPercent = (powerWatt / parameters.maxPowerWatt) * 100;
    const utilizationPercent = Math.max(currentUtilizationPercent, powerUtilizationPercent);
    const stress = stressState(utilizationPercent);
    const label = instance.component.name ?? instance.component.id;
    const diagnostics: DeviceDiagnostic[] = [];
    if (operatingPoint.baseEmitterDropVolt < -parameters.reverseBaseEmitterLimitVolt) {
      diagnostics.push({
        code: 'transistor_reverse_bias',
        severity: 'error',
        message: `${label}: обратное напряжение база–эмиттер ${Math.abs(operatingPoint.baseEmitterDropVolt).toFixed(2)} В превышает предел ${parameters.reverseBaseEmitterLimitVolt.toFixed(1)} В.`,
        suggestedAction: 'Проверьте выводы B, C, E и полярность питания.',
      });
    }
    if (stress === 'overcurrent' || stress === 'burned') {
      const baseDominates = baseCurrentAmp > collectorCurrentAmp;
      diagnostics.push({
        code: 'transistor_overcurrent',
        severity: 'error',
        message: `${label}: перегрузка — ток базы ${(baseCurrentAmp * 1_000).toFixed(1)} мА, ток нагрузки ${(collectorCurrentAmp * 1_000).toFixed(1)} мА, мощность ${powerWatt.toFixed(3)} Вт.`,
        suggestedAction: baseDominates
          ? 'Ток базы слишком велик. Добавьте ограничивающий резистор в цепь базы.'
          : 'Ограничьте ток нагрузки и проверьте сопротивление в цепи коллектора.',
      });
    }
    return {
      operatingRegion: state.region,
      baseEmitterDropVolt: operatingPoint.baseEmitterDropVolt,
      collectorEmitterDropVolt: operatingPoint.collectorEmitterDropVolt,
      baseCurrentAmp,
      collectorCurrentAmp,
      emitterCurrentAmp,
      nominalCurrentGain: parameters.currentGain,
      effectiveCurrentGain: baseCurrentAmp > 0 ? collectorCurrentAmp / baseCurrentAmp : 0,
      earlyVoltageVolt: parameters.earlyVoltageVolt,
      maxCollectorCurrentAmp: parameters.maxCollectorCurrentAmp,
      maxPowerWatt: parameters.maxPowerWatt,
      powerWatt,
      currentUtilizationPercent,
      powerUtilizationPercent,
      stressState: stress,
      terminalCurrents: {
        [parameters.base]: baseCurrentAmp,
        [parameters.collector]: collectorCurrentAmp,
        [parameters.emitter]: -emitterCurrentAmp,
      },
      diagnostics,
    };
  },
};

export function createNpnDcDevice(component: SchematicComponent): NpnDcDevice | null {
  if (!componentModelIdentityIsInstalled(component)) return null;
  const identity = electricalModelIdentityForComponent(component);
  if (identity.electricalModelId !== NPN_DEVICE_MODEL.id) return null;
  return { model: NPN_DEVICE_MODEL, instance: NPN_DEVICE_MODEL.normalize(component) };
}

export function canonicalNpnDcProfileRegistry(): string {
  return JSON.stringify({ registryVersion: 1, profiles: NPN_DC_PROFILES });
}
