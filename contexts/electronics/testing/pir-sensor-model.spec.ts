import { describe, expect, it } from 'vitest';
import type { SchematicComponent } from '../domain/document.js';
import {
  PIR_SENSOR_MODEL,
  PIR_SENSOR_PROFILE,
  type PirSensorState,
} from '../domain/models/pir-sensor-model.js';

function pir(motionDetected = false): SchematicComponent {
  return {
    id: 'pir',
    kind: 'visual',
    value: 0,
    position: { x: 0, y: 0 },
    componentTypeId: 'pir-sensor',
    variantId: 'pir-sensor',
    pinIds: ['vcc', 'signal', 'gnd'],
    stateProperties: { motionDetected },
  };
}

function stateAt(
  motionDetected: boolean,
  supplyVolt: number,
  previous: PirSensorState = PIR_SENSOR_MODEL.initialIterationState(
    PIR_SENSOR_MODEL.normalize(pir(motionDetected)),
  ),
) {
  const instance = PIR_SENSOR_MODEL.normalize(pir(motionDetected));
  return PIR_SENSOR_MODEL.evaluateIteration(instance, previous, {
    supplyVolt,
    outputVolt: 0,
  }).state;
}

describe('PIR deterministic digital motion model', () => {
  it('validates only boolean motionDetected and defaults to no motion', () => {
    expect(PIR_SENSOR_MODEL.validate(pir())).toEqual([]);
    expect(PIR_SENSOR_MODEL.normalize(pir()).parameters.motionDetected).toBe(false);
    expect(PIR_SENSOR_MODEL.normalize(pir(true)).parameters.motionDetected).toBe(true);
    expect(
      PIR_SENSOR_MODEL.validate({
        ...pir(),
        stateProperties: { motionDetected: 'yes' },
      }),
    ).toEqual([expect.objectContaining({ code: 'invalid_motion_state' })]);
  });

  it.each([
    [5, 'powered', 'digital-high', 3.3],
    [3.3, 'powered', 'digital-high', 3.3],
    [2.5, 'undervoltage', 'high-impedance', 0],
    [7, 'overvoltage', 'high-impedance', 0],
    [0, 'unpowered', 'high-impedance', 0],
    [-5, 'reversed', 'high-impedance', 0],
  ] as const)(
    'classifies %s V as %s with %s output',
    (supplyVolt, power, output, targetVoltageVolt) => {
      expect(stateAt(true, supplyVolt)).toEqual({ power, output, targetVoltageVolt });
    },
  );

  it('drives LOW when powered without motion and HIGH only when powered with motion', () => {
    expect(stateAt(false, 5)).toMatchObject({ output: 'digital-low', targetVoltageVolt: 0 });
    expect(stateAt(true, 5)).toMatchObject({
      output: 'digital-high',
      targetVoltageVolt: PIR_SENSOR_PROFILE.logicHighVolt,
    });
  });

  it('uses high impedance while unpowered and a bounded source while powered', () => {
    const instance = PIR_SENSOR_MODEL.normalize(pir(true));
    const conductances: number[] = [];
    const offsets: number[] = [];
    const context = {
      node: (_component: SchematicComponent, terminal: string) =>
        ({ vcc: 0, signal: 1, gnd: 2 })[terminal] ?? 0,
      stampConductance: (_a: number, _b: number, value: number) => conductances.push(value),
      stampOffset: (_a: number, _b: number, value: number) => offsets.push(value),
      stampVccs: () => undefined,
    };

    PIR_SENSOR_MODEL.stampDc(context, instance, PIR_SENSOR_MODEL.initialIterationState(instance));
    expect(conductances).toEqual([1e-9]);
    expect(offsets).toEqual([]);

    conductances.length = 0;
    PIR_SENSOR_MODEL.stampDc(context, instance, stateAt(true, 5));
    expect(conductances).toEqual([1e-9, 1 / PIR_SENSOR_PROFILE.outputResistanceOhm]);
    expect(offsets).toEqual([
      PIR_SENSOR_PROFILE.logicHighVolt / PIR_SENSOR_PROFILE.outputResistanceOhm,
    ]);
  });

  it('restores output after power returns and reports the current motion truth', () => {
    const instance = PIR_SENSOR_MODEL.normalize(pir(true));
    const unpowered = stateAt(true, 0);
    const restored = PIR_SENSOR_MODEL.evaluateIteration(instance, unpowered, {
      supplyVolt: 5,
      outputVolt: 0,
    }).state;
    const observation = PIR_SENSOR_MODEL.observe(instance, restored, {
      supplyVolt: 5,
      outputVolt: 3.3,
    });
    expect(restored).toMatchObject({ power: 'powered', output: 'digital-high' });
    expect(observation).toMatchObject({
      sensorMotionDetected: true,
      sensorPowerState: 'powered',
      sensorOutputRegion: 'digital-high',
      sensorOutputVoltageVolt: 3.3,
      sensorSupplyVoltageVolt: 5,
    });
  });
});
