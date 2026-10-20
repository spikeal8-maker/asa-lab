import { describe, expect, it, vi } from 'vitest';
import type { SchematicComponent } from '../domain/document';
import type { DcStampContext } from '../domain/models/device-model';
import {
  ARDUINO_GROUND_TERMINALS,
  arduinoGroundTerminalsHaveOriginalDefinition,
} from '../domain/arduino-model';
import {
  ARDUINO_NUMERIC_TYPES,
  arduinoNumericTypesHaveOriginalDefinition,
} from '../domain/arduino-values';
import {
  resolveElectricalModelIdentity,
  strictElectricalIdentitiesHaveOriginalDefinition,
} from '../domain/model-identity';
import {
  electricalModelFor,
  strictElectricalTerminalsHaveOriginalDefinition,
} from '../domain/model-registry';
import {
  strictThermalProfilesHaveOriginalDefinition,
  thermalProfileFor,
  thermalProfileKey,
} from '../domain/models/thermal-transient-model';
import {
  ORDINARY_LED_PROFILES,
  ordinaryLedProfile,
  ordinaryLedProfilesHaveOriginalDefinition,
} from '../domain/led-model';
import {
  createLinearDcDevice,
  FUNCTION_GENERATOR_DEVICE_MODEL,
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
  OSCILLOSCOPE_DEVICE_MODEL,
  REGULATED_POWER_SUPPLY_DEVICE_MODEL,
  RESISTOR_DEVICE_MODEL,
  resistorDeviceModelHasOriginalDefinition,
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

describe('definition-time origin of the request-owned resistor/ordinary LED route', () => {
  function temporarilyChange(target: object, change: () => void, check: () => void): void {
    const descriptors = Object.getOwnPropertyDescriptors(target);
    const prototype = Object.getPrototypeOf(target);
    try {
      change();
      check();
    } finally {
      Object.setPrototypeOf(target, prototype);
      for (const key of Reflect.ownKeys(target)) {
        if (Object.getOwnPropertyDescriptor(target, key)?.configurable)
          Reflect.deleteProperty(target, key);
      }
      Object.defineProperties(target, descriptors);
    }
  }

  it('admits the unmodified definitions without freezing the public models', () => {
    expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
    expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(true);
    expect(Object.isFrozen(RESISTOR_DEVICE_MODEL)).toBe(false);
    expect(Object.isFrozen(ORDINARY_LED_PROFILES.red.linearSegments)).toBe(false);
    expect(ordinaryLedProfile('red')).toBe(ORDINARY_LED_PROFILES.red);
  });

  it.each(['validate', 'normalize', 'stampDc', 'observe'] as const)(
    'rejects a substituted %s before any callback is invoked, then accepts restoration',
    (method) => {
      const replacement = vi.fn(() => {
        throw new Error('must not execute in admission');
      });
      temporarilyChange(
        RESISTOR_DEVICE_MODEL,
        () => Object.defineProperty(RESISTOR_DEVICE_MODEL, method, { value: replacement }),
        () => {
          expect(resistorDeviceModelHasOriginalDefinition()).toBe(false);
          expect(replacement).not.toHaveBeenCalled();
        },
      );
      expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
    },
  );

  it('detects model identity, own keys, descriptors and prototypes without inspecting substitutes', () => {
    const trap = vi.fn(() => {
      throw new Error('unknown proxy must not be inspected');
    });
    const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    const changes = [
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL, 'id', { value: 'custom-resistor' }),
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL, 'version', { value: 2 }),
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL, 'normalize', { enumerable: false }),
      () => Reflect.deleteProperty(RESISTOR_DEVICE_MODEL, 'normalize'),
      () =>
        Object.defineProperty(RESISTOR_DEVICE_MODEL, Symbol('custom'), {
          value: proxy,
          configurable: true,
        }),
      () => Object.setPrototypeOf(RESISTOR_DEVICE_MODEL, proxy),
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL, 'analyses', { value: proxy }),
    ];
    for (const change of changes) {
      temporarilyChange(RESISTOR_DEVICE_MODEL, change, () => {
        expect(resistorDeviceModelHasOriginalDefinition()).toBe(false);
        expect(trap).not.toHaveBeenCalled();
      });
      expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
    }
  });

  it('detects original method metadata and analyses-array mutations', () => {
    temporarilyChange(
      RESISTOR_DEVICE_MODEL.normalize,
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL.normalize, 'name', { value: 'custom' }),
      () => expect(resistorDeviceModelHasOriginalDefinition()).toBe(false),
    );
    temporarilyChange(
      RESISTOR_DEVICE_MODEL.analyses,
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL.analyses, '0', { value: 'ac' }),
      () => expect(resistorDeviceModelHasOriginalDefinition()).toBe(false),
    );
    expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
  });

  it('rejects even a revoked substituted callable without probing it', () => {
    const replacement = Proxy.revocable(() => undefined, {});
    replacement.revoke();
    temporarilyChange(
      RESISTOR_DEVICE_MODEL,
      () =>
        Object.defineProperty(RESISTOR_DEVICE_MODEL, 'normalize', {
          value: replacement.proxy,
        }),
      () => expect(resistorDeviceModelHasOriginalDefinition()).toBe(false),
    );
    expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
  });

  it('does not read substituted accessors and preserves generic getter/throw dispatch', () => {
    const error = new Error('custom normalize');
    const getter = vi.fn(() => {
      throw error;
    });
    temporarilyChange(
      RESISTOR_DEVICE_MODEL,
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL, 'normalize', { get: getter }),
      () => {
        expect(resistorDeviceModelHasOriginalDefinition()).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(() => createLinearDcDevice(component('r1', 'resistor', 220))).toThrow(error);
        expect(getter).toHaveBeenCalledTimes(1);
      },
    );
    expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
  });

  it('preserves generic custom-normalizer dispatch and the original component alias', () => {
    const input = component('r1', 'resistor', 220);
    const original = RESISTOR_DEVICE_MODEL.normalize;
    const normalize = vi.fn((value: SchematicComponent) => original(value));
    temporarilyChange(
      RESISTOR_DEVICE_MODEL,
      () => Object.defineProperty(RESISTOR_DEVICE_MODEL, 'normalize', { value: normalize }),
      () => {
        expect(resistorDeviceModelHasOriginalDefinition()).toBe(false);
        const device = createLinearDcDevice(input);
        expect(normalize).toHaveBeenCalledExactlyOnceWith(input);
        expect(device?.instance.component).toBe(input);
      },
    );
  });

  it('captures both authorities before a later solver consumer imports them', async () => {
    vi.resetModules();
    const producer = await import('../domain/models/linear-dc-models');
    const ledProducer = await import('../domain/led-model');
    const original = producer.RESISTOR_DEVICE_MODEL.normalize;
    const red = ledProducer.ORDINARY_LED_PROFILES.red;
    try {
      Object.defineProperty(producer.RESISTOR_DEVICE_MODEL, 'normalize', {
        value: (value: SchematicComponent) => original(value),
      });
      Object.defineProperty(ledProducer.ORDINARY_LED_PROFILES, 'red', { value: { ...red } });
      await import('../domain/solver');
      expect(producer.resistorDeviceModelHasOriginalDefinition()).toBe(false);
      expect(ledProducer.ordinaryLedProfilesHaveOriginalDefinition()).toBe(false);
    } finally {
      Object.defineProperty(producer.RESISTOR_DEVICE_MODEL, 'normalize', { value: original });
      Object.defineProperty(ledProducer.ORDINARY_LED_PROFILES, 'red', { value: red });
    }
    expect(producer.resistorDeviceModelHasOriginalDefinition()).toBe(true);
    expect(ledProducer.ordinaryLedProfilesHaveOriginalDefinition()).toBe(true);
  });

  it('rejects copied profiles, arrays and segment records even when all values match', () => {
    const red = ORDINARY_LED_PROFILES.red;
    const segments = red.linearSegments!;
    const segment = segments[0]!;
    const cases: [object, () => void][] = [
      [
        ORDINARY_LED_PROFILES,
        () => Object.defineProperty(ORDINARY_LED_PROFILES, 'red', { value: { ...red } }),
      ],
      [red, () => Object.defineProperty(red, 'linearSegments', { value: [...segments] })],
      [segments, () => Object.defineProperty(segments, '0', { value: { ...segment } })],
    ];
    for (const [target, change] of cases) {
      temporarilyChange(target, change, () =>
        expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(false),
      );
      expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(true);
    }
  });

  it('checks every colour and segment field, array keys/length/prototype and restoration', () => {
    for (const profile of Object.values(ORDINARY_LED_PROFILES)) {
      for (const key of Object.keys(profile).filter((key) => key !== 'linearSegments')) {
        temporarilyChange(
          profile,
          () => Object.defineProperty(profile, key, { value: null }),
          () => {
            expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(false);
          },
        );
      }
      for (const segment of profile.linearSegments!) {
        for (const key of Object.keys(segment)) {
          temporarilyChange(
            segment,
            () => Object.defineProperty(segment, key, { value: -1 }),
            () => {
              expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(false);
            },
          );
        }
      }
    }
    const segments = ORDINARY_LED_PROFILES.red.linearSegments!;
    const changes = [
      () => Reflect.deleteProperty(segments, '0'),
      () => Object.defineProperty(segments, 'length', { value: 1 }),
      () =>
        Object.defineProperty(segments, Symbol.iterator, {
          value: () => [][Symbol.iterator](),
          configurable: true,
        }),
      () => Object.setPrototypeOf(segments, null),
    ];
    for (const change of changes) {
      temporarilyChange(segments, change, () =>
        expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(false),
      );
      expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(true);
    }
  });

  it('rejects nested getters and proxies without any admission-time callback or proxy trap', () => {
    const trap = vi.fn(() => {
      throw new Error('unexpected reflection or callback');
    });
    const proxy = new Proxy(
      {},
      {
        get: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
      },
    );
    const red = ORDINARY_LED_PROFILES.red;
    const segments = red.linearSegments!;
    const cases: [object, string, PropertyDescriptor][] = [
      [ORDINARY_LED_PROFILES, 'red', { value: proxy }],
      [red, 'linearSegments', { value: proxy }],
      [segments, '0', { value: proxy }],
      [segments[0]!, 'kneeVoltage', { get: trap }],
      [red, 'nominalCurrentAmp', { get: trap }],
    ];
    for (const [target, key, descriptor] of cases) {
      temporarilyChange(
        target,
        () => Object.defineProperty(target, key, descriptor),
        () => {
          expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(false);
          expect(trap).not.toHaveBeenCalled();
        },
      );
      expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(true);
    }
  });

  it('preserves live ordinary-profile lookup and its generic getter error exactly once', () => {
    const error = new Error('custom red lookup');
    const getter = vi.fn(() => {
      throw error;
    });
    temporarilyChange(
      ORDINARY_LED_PROFILES,
      () => Object.defineProperty(ORDINARY_LED_PROFILES, 'red', { get: getter }),
      () => {
        expect(ordinaryLedProfilesHaveOriginalDefinition()).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(() => ordinaryLedProfile('red')).toThrow(error);
        expect(getter).toHaveBeenCalledTimes(1);
      },
    );
  });

  const strictComponents = [
    component('uno', 'visual', 0, { componentTypeId: 'arduino-uno' }),
    component('resistor', 'resistor', 220, { componentTypeId: 'resistor-axial' }),
    component('led', 'led', 0, { componentTypeId: 'led-5mm' }),
  ];

  it('admits only the unchanged selected ground, terminal, identity, thermal and numeric definitions', () => {
    expect(arduinoGroundTerminalsHaveOriginalDefinition()).toBe(true);
    expect(strictElectricalTerminalsHaveOriginalDefinition()).toBe(true);
    expect(strictElectricalIdentitiesHaveOriginalDefinition()).toBe(true);
    expect(strictThermalProfilesHaveOriginalDefinition()).toBe(true);
    expect(arduinoNumericTypesHaveOriginalDefinition()).toBe(true);
  });

  it('detects own array callbacks without calling them and leaves the generic callback live', () => {
    const error = new Error('custom array method');
    const getter = vi.fn(() => {
      throw error;
    });
    const cases: [object, string, () => boolean, () => unknown][] = [
      [
        ARDUINO_GROUND_TERMINALS,
        'find',
        arduinoGroundTerminalsHaveOriginalDefinition,
        () => ARDUINO_GROUND_TERMINALS.find(() => true),
      ],
      [
        ARDUINO_GROUND_TERMINALS,
        'filter',
        arduinoGroundTerminalsHaveOriginalDefinition,
        () => ARDUINO_GROUND_TERMINALS.filter(() => true),
      ],
      [
        ARDUINO_NUMERIC_TYPES,
        'includes',
        arduinoNumericTypesHaveOriginalDefinition,
        () => ARDUINO_NUMERIC_TYPES.includes('int'),
      ],
      ...strictComponents.map((entry): [object, string, () => boolean, () => unknown] => {
        const terminals = electricalModelFor(entry).requiredTerminals;
        return [
          terminals,
          'filter',
          strictElectricalTerminalsHaveOriginalDefinition,
          () => terminals.filter(() => true),
        ];
      }),
    ];
    for (const [array, method, check, genericCall] of cases) {
      getter.mockClear();
      temporarilyChange(
        array,
        () => Object.defineProperty(array, method, { get: getter, configurable: true }),
        () => {
          expect(check()).toBe(false);
          expect(getter).not.toHaveBeenCalled();
          expect(genericCall).toThrow(error);
          expect(getter).toHaveBeenCalledTimes(1);
        },
      );
      expect(check()).toBe(true);
    }
  });

  it('detects selected array element/proxy and prototype changes without probing replacements', () => {
    const trap = vi.fn(() => {
      throw new Error('must not probe replacement');
    });
    const proxy = new Proxy(
      {},
      { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap },
    );
    const cases: [object, () => boolean][] = [
      [ARDUINO_GROUND_TERMINALS, arduinoGroundTerminalsHaveOriginalDefinition],
      [ARDUINO_NUMERIC_TYPES, arduinoNumericTypesHaveOriginalDefinition],
      ...strictComponents.map((entry): [object, () => boolean] => [
        electricalModelFor(entry).requiredTerminals,
        strictElectricalTerminalsHaveOriginalDefinition,
      ]),
    ];
    for (const [array, check] of cases) {
      for (const change of [
        () => Object.defineProperty(array, '0', { value: proxy }),
        () => Object.setPrototypeOf(array, proxy),
      ]) {
        temporarilyChange(array, change, () => {
          expect(check()).toBe(false);
          expect(trap).not.toHaveBeenCalled();
        });
        expect(check()).toBe(true);
      }
    }
  });

  it('guards all primitive fields of exactly three shared identity records', () => {
    for (const input of strictComponents) {
      const identity = resolveElectricalModelIdentity(input);
      for (const key of Object.keys(identity)) {
        temporarilyChange(
          identity,
          () => Object.defineProperty(identity, key, { value: null }),
          () => {
            expect(strictElectricalIdentitiesHaveOriginalDefinition()).toBe(false);
          },
        );
        expect(strictElectricalIdentitiesHaveOriginalDefinition()).toBe(true);
      }
      const getter = vi.fn(() => {
        throw new Error('custom identity');
      });
      temporarilyChange(
        identity,
        () => Object.defineProperty(identity, 'modelProfileId', { get: getter }),
        () => {
          expect(strictElectricalIdentitiesHaveOriginalDefinition()).toBe(false);
          expect(getter).not.toHaveBeenCalled();
          expect(() => resolveElectricalModelIdentity(input).modelProfileId).toThrow(
            'custom identity',
          );
          expect(getter).toHaveBeenCalledTimes(1);
        },
      );
    }
  });

  it('guards both resistor and junction thermal records without invoking their getters', () => {
    for (const input of strictComponents.slice(1)) {
      const profile = thermalProfileFor(input)!;
      for (const key of Object.keys(profile)) {
        temporarilyChange(
          profile,
          () => Object.defineProperty(profile, key, { value: null }),
          () => {
            expect(strictThermalProfilesHaveOriginalDefinition()).toBe(false);
          },
        );
        expect(strictThermalProfilesHaveOriginalDefinition()).toBe(true);
      }
      const getter = vi.fn(() => {
        throw new Error('custom thermal id');
      });
      temporarilyChange(
        profile,
        () => Object.defineProperty(profile, 'id', { get: getter }),
        () => {
          expect(strictThermalProfilesHaveOriginalDefinition()).toBe(false);
          expect(getter).not.toHaveBeenCalled();
          expect(() => thermalProfileKey(input, profile)).toThrow('custom thermal id');
          expect(getter).toHaveBeenCalledTimes(1);
        },
      );
    }
  });

  it('guards only original own id selectors of the seven rejected linear models', () => {
    const rejected = [
      SOURCE_DEVICE_MODEL,
      REGULATED_POWER_SUPPLY_DEVICE_MODEL,
      FUNCTION_GENERATOR_DEVICE_MODEL,
      OSCILLOSCOPE_DEVICE_MODEL,
      MULTIMETER_DC_VOLTAGE_DEVICE_MODEL,
      MULTIMETER_DC_CURRENT_DEVICE_MODEL,
      MULTIMETER_RESISTANCE_DEVICE_MODEL,
    ];
    for (const model of rejected) {
      const getter = vi.fn(() => {
        throw new Error('custom rejected selector');
      });
      for (const change of [
        () => Object.defineProperty(model, 'id', { value: 'arduino-uno' }),
        () => Object.defineProperty(model, 'id', { enumerable: false }),
        () => Reflect.deleteProperty(model, 'id'),
        () => Object.defineProperty(model, 'id', { get: getter }),
      ]) {
        temporarilyChange(model, change, () => {
          expect(resistorDeviceModelHasOriginalDefinition()).toBe(false);
          expect(getter).not.toHaveBeenCalled();
        });
        expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
      }
      // These callbacks are never reached when the original id rejects a strict
      // component. Admission deliberately does not walk unused model graphs.
      temporarilyChange(
        model,
        () => Object.defineProperty(model, 'normalize', { get: getter }),
        () => {
          expect(resistorDeviceModelHasOriginalDefinition()).toBe(true);
          expect(getter).not.toHaveBeenCalled();
        },
      );
    }
  });

  it('captures remaining definitions before a later consumer can establish eligibility', async () => {
    vi.resetModules();
    const ground = await import('../domain/arduino-model');
    const values = await import('../domain/arduino-values');
    const metadata = await import('../domain/model-registry');
    const identities = await import('../domain/model-identity');
    const thermal = await import('../domain/models/thermal-transient-model');
    const linear = await import('../domain/models/linear-dc-models');
    const targets: [object, string, () => boolean][] = [
      [ground.ARDUINO_GROUND_TERMINALS, '0', ground.arduinoGroundTerminalsHaveOriginalDefinition],
      [values.ARDUINO_NUMERIC_TYPES, '0', values.arduinoNumericTypesHaveOriginalDefinition],
      [
        metadata.electricalModelFor(strictComponents[0]!).requiredTerminals,
        '0',
        metadata.strictElectricalTerminalsHaveOriginalDefinition,
      ],
      [
        identities.resolveElectricalModelIdentity(strictComponents[1]!),
        'modelProfileId',
        identities.strictElectricalIdentitiesHaveOriginalDefinition,
      ],
      [
        thermal.thermalProfileFor(strictComponents[2]!)!,
        'id',
        thermal.strictThermalProfilesHaveOriginalDefinition,
      ],
      [linear.SOURCE_DEVICE_MODEL, 'id', linear.resistorDeviceModelHasOriginalDefinition],
    ];
    const originals = targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key)!);
    try {
      for (const [target, key] of targets) Object.defineProperty(target, key, { value: 'custom' });
      await import('../domain/solver');
      for (const [, , check] of targets) expect(check()).toBe(false);
    } finally {
      for (let index = 0; index < targets.length; index += 1) {
        const [target, key] = targets[index]!;
        Object.defineProperty(target, key, originals[index]!);
      }
    }
    for (const [, , check] of targets) expect(check()).toBe(true);
  });
});
