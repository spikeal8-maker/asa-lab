import { describe, expect, it, vi } from 'vitest';
import type { SchematicComponent } from '../domain/document';
import type { DcStampContext } from '../domain/models/device-model';
import {
  createLinearDcDevice,
  isMultimeterDcCurrentDevice,
  isMultimeterResistanceDevice,
  isMultimeterDcVoltageDevice,
  isResistorDevice,
  isSourceDevice,
  MULTIMETER_DC_INPUT_RESISTANCE_OHM,
  MULTIMETER_DC_CURRENT_DEVICE_MODEL,
  MULTIMETER_DC_CURRENT_SHUNT_RESISTANCE_OHM,
  MULTIMETER_DC_VOLTAGE_DEVICE_MODEL,
  MULTIMETER_RESISTANCE_DEVICE_MODEL,
  MULTIMETER_RESISTANCE_MAX_RANGE_OHM,
  RESISTOR_DEVICE_MODEL,
  SOURCE_DEVICE_MODEL,
} from '../domain/models/linear-dc-models';

function component(
  id: string,
  kind: SchematicComponent['kind'],
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 }, ...options };
}

describe('MATH-1 linear DC device models', () => {
  it('normalizes source and resistor profiles from versioned model identities', () => {
    const source = createLinearDcDevice(
      component('battery', 'source', 4.5, { componentTypeId: 'battery-holder-aa-3' }),
    );
    const resistor = createLinearDcDevice(
      component('r1', 'resistor', 220, {
        componentTypeId: 'resistor-axial',
        stateProperties: { powerRatingWatt: 0.5 },
      }),
    );

    expect(source && isSourceDevice(source) ? source.instance.parameters : null).toEqual({
      emfVolt: 4.5,
      internalResistanceOhm: 0.675,
      continuousCurrentAmp: 1,
    });
    expect(resistor && isResistorDevice(resistor) ? resistor.instance.parameters : null).toEqual({
      resistanceOhm: 220,
      powerRatingWatt: 0.5,
    });
  });

  it('stamps only through the restricted DC context', () => {
    const stampConductance = vi.fn();
    const stampVoltageSource = vi.fn();
    const context: DcStampContext = {
      node: (_component, terminal) => (terminal === 'a' ? 1 : 0),
      stampConductance,
      stampVoltageSource,
    };
    const resistor = RESISTOR_DEVICE_MODEL.normalize(component('r1', 'resistor', 100));
    const source = SOURCE_DEVICE_MODEL.normalize(component('source', 'source', 5));

    RESISTOR_DEVICE_MODEL.stampDc(context, resistor);
    SOURCE_DEVICE_MODEL.stampDc(context, source);

    expect(stampConductance).toHaveBeenCalledWith(1, 0, 0.01);
    expect(stampVoltageSource).toHaveBeenCalledWith('source', 1, 0, 5, 1e-12);
  });

  it('classifies resistor heating from the solved operating point', () => {
    const resistor = RESISTOR_DEVICE_MODEL.normalize(
      component('r1', 'resistor', 100, { stateProperties: { powerRatingWatt: 0.25 } }),
    );

    expect(
      RESISTOR_DEVICE_MODEL.observe?.(resistor, {
        voltageDrop: 6,
        current: 0,
      }),
    ).toMatchObject({
      current: 0.06,
      power: 0.36,
      powerUtilizationPercent: 144,
      stressState: 'overcurrent',
      terminalCurrents: { a: 0.06, b: -0.06 },
      diagnostics: [expect.objectContaining({ code: 'resistor_overload', severity: 'error' })],
    });
  });

  it('models DC voltage mode as a finite 10 MΩ two-terminal input', () => {
    const meterComponent = component('meter', 'visual', 0, {
      componentTypeId: 'multimeter',
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'dc-voltage', meterRange: 'auto' },
    });
    const meter = createLinearDcDevice(meterComponent);
    expect(meter && isMultimeterDcVoltageDevice(meter)).toBe(true);
    if (!meter || !isMultimeterDcVoltageDevice(meter)) return;
    expect(meter.instance.parameters.inputResistanceOhm).toBe(MULTIMETER_DC_INPUT_RESISTANCE_OHM);

    const stampConductance = vi.fn();
    MULTIMETER_DC_VOLTAGE_DEVICE_MODEL.stampDc(
      {
        node: (_component, terminal) => (terminal === 'a' ? 2 : 1),
        stampConductance,
        stampVoltageSource: vi.fn(),
      },
      meter.instance,
    );
    expect(stampConductance).toHaveBeenCalledWith(2, 1, 1e-7);

    expect(
      MULTIMETER_DC_VOLTAGE_DEVICE_MODEL.observe?.(meter.instance, {
        voltageDrop: -3,
        current: 0,
      }),
    ).toMatchObject({
      current: -3e-7,
      measurementMode: 'dc-voltage',
      measuredValue: -3,
      measurementUnit: 'V',
      meterInputResistanceOhm: 10_000_000,
      meterOverload: false,
      terminalCurrents: { 'v-ohm-ma': -3e-7, com: 3e-7 },
      diagnostics: [],
    });
  });

  it('models DC current mode as a finite fused 1.8 Ω shunt', () => {
    const meter = createLinearDcDevice(
      component('meter', 'visual', 0, {
        componentTypeId: 'multimeter',
        pinIds: ['com', 'v-ohm-ma'],
        stateProperties: { measurementMode: 'dc-current' },
      }),
    );
    expect(meter && isMultimeterDcCurrentDevice(meter)).toBe(true);
    if (!meter || !isMultimeterDcCurrentDevice(meter)) return;
    expect(meter.instance.parameters.shuntResistanceOhm).toBe(
      MULTIMETER_DC_CURRENT_SHUNT_RESISTANCE_OHM,
    );

    const observation = MULTIMETER_DC_CURRENT_DEVICE_MODEL.observe?.(meter.instance, {
      voltageDrop: 0.18,
      current: 0,
    });
    expect(observation).toMatchObject({
      measurementMode: 'dc-current',
      measurementUnit: 'A',
      meterShuntResistanceOhm: 1.8,
      meterBurdenVoltageVolt: 0.18,
      meterFuseRatingAmp: 0.44,
      meterFuseState: 'intact',
      meterOverload: false,
      diagnostics: [],
    });
    expect(observation?.current).toBeCloseTo(0.1, 12);
    expect(observation?.measuredValue).toBeCloseTo(0.1, 12);
    expect(observation?.terminalCurrents['v-ohm-ma']).toBeCloseTo(0.1, 12);
    expect(observation?.terminalCurrents.com).toBeCloseTo(-0.1, 12);
  });

  it('models resistance mode as a bounded internal test source', () => {
    const meter = createLinearDcDevice(
      component('meter', 'visual', 0, {
        componentTypeId: 'multimeter',
        pinIds: ['com', 'v-ohm-ma'],
        stateProperties: { measurementMode: 'resistance' },
      }),
    );
    expect(meter && isMultimeterResistanceDevice(meter)).toBe(true);
    if (!meter || !isMultimeterResistanceDevice(meter)) return;

    const stampVoltageSource = vi.fn();
    MULTIMETER_RESISTANCE_DEVICE_MODEL.stampDc(
      {
        node: (_component, terminal) => (terminal === 'a' ? 2 : 1),
        stampConductance: vi.fn(),
        stampVoltageSource,
      },
      meter.instance,
    );
    expect(stampVoltageSource).toHaveBeenCalledWith('meter', 2, 1, 1, 1_000);

    const observation = MULTIMETER_RESISTANCE_DEVICE_MODEL.observe?.(meter.instance, {
      voltageDrop: 0.5,
      current: 0.0005,
    });
    expect(observation).toMatchObject({
      measurementMode: 'resistance',
      measuredValue: 1_000,
      measurementUnit: 'Ω',
      meterTestVoltageVolt: 1,
      meterTestCurrentAmp: 0.0005,
      meterResistanceRangeOhm: MULTIMETER_RESISTANCE_MAX_RANGE_OHM,
      meterOpenCircuit: false,
      meterExternalPowerPresent: false,
      meterOverload: false,
      terminalCurrents: { 'v-ohm-ma': -0.0005, com: 0.0005 },
      diagnostics: [],
    });
  });

  it('reports source sag, internal heating and calculated burnout independently of UI', () => {
    const source = SOURCE_DEVICE_MODEL.normalize(
      component('coin', 'source', 3, { componentTypeId: 'battery-3v' }),
    );

    const observation = SOURCE_DEVICE_MODEL.observe?.(source, {
      voltageDrop: 0.4,
      current: 0.01,
    });
    expect(observation).toMatchObject({
      current: 0.01,
      currentUtilizationPercent: 333.33333333333337,
      stressState: 'burned',
      internalResistanceOhm: 13,
      voltageSag: 0.13,
      terminalCurrents: { positive: -0.01, negative: 0.01 },
      voltageConstraintResidual: 2.47,
      diagnostics: [expect.objectContaining({ code: 'source_overload', severity: 'error' })],
    });
    expect(observation?.diagnostics[0]?.message).toContain('напряжение на клеммах проседает');
    expect(observation?.diagnostics[0]?.suggestedAction).toContain('уменьшите нагрузку');
    expect(observation?.internalPower).toBeCloseTo(0.0013, 12);
  });

  it('does not guess a model for an incompatible persisted identity', () => {
    const incompatible = component('r1', 'resistor', 100, {
      componentTypeId: 'resistor-axial',
      electricalModelId: 'future-resistor',
      electricalModelVersion: 7,
      modelProfileId: 'future-profile',
      modelProfileVersion: 2,
    });
    expect(createLinearDcDevice(incompatible)).toBeNull();
  });
});
