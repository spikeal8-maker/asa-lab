import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../domain/document.js';
import { analyseCircuit } from '../domain/simulation.js';
import { advanceArduinoCircuitClock } from '../domain/arduino-circuit-scheduler.js';
import { electricalModelIdentityForComponent } from '../domain/model-identity.js';
import { SOIL_MOISTURE_MODEL, soilResistanceOhm } from '../domain/models/soil-moisture-model.js';

function document(parts: SchematicComponent[], wires: string[][]): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components: parts,
    connections: wires.map(([from, a, to, b], i) => ({
      id: `w${i}`,
      from: { componentId: from, terminal: a },
      to: { componentId: to, terminal: b },
    })),
    simulation: { running: true, maxIterations: 64 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
const soil = (moisturePercent = 50): SchematicComponent => ({
  id: 'soil',
  kind: 'visual',
  componentTypeId: 'soil-moisture-sensor',
  value: 0,
  position: { x: 0, y: 0 },
  pinIds: ['vcc', 'gnd', 'signal'],
  stateProperties: { moisturePercent },
});
function circuit(moisture = 50, supply = 5, load = 10e6) {
  return document(
    [
      soil(moisture),
      { id: 'source', kind: 'source', value: supply, position: { x: 0, y: 0 } },
      { id: 'load', kind: 'resistor', value: load, position: { x: 0, y: 0 } },
    ],
    [
      ['source', 'a', 'soil', 'vcc'],
      ['source', 'b', 'soil', 'gnd'],
      ['soil', 'signal', 'load', 'a'],
      ['load', 'b', 'soil', 'gnd'],
    ],
  );
}
function measure(doc: ElectronicsDocument) {
  const result = analyseCircuit(doc);
  expect(result.solved, JSON.stringify(result.diagnostics)).toBe(true);
  expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
  expect(result.quality.powerBalanceResidualWatt).toBeLessThan(1e-7);
  return { result, sensor: result.components.find((p) => p.componentId === 'soil')! };
}
describe('resistive soil module in the common solver', () => {
  it.each([0, 25, 50, 75, 100])(
    'solves moisture %s with real loading, supply current, KCL and power',
    (moisture) => {
      for (const supply of [3.3, 5]) {
        const { sensor } = measure(circuit(moisture, supply));
        const bottom = 1 / (1 / 10000 + 1 / 10e6);
        const resistance = 1e6 * 1e-3 ** (moisture / 100);
        const expected = (supply * bottom) / (bottom + resistance);
        expect(sensor.sensorOutputVoltageVolt).toBeCloseTo(expected, 7);
        expect(sensor.voltageDrop).toBe(sensor.sensorOutputVoltageVolt);
        expect(sensor.current).toBeCloseTo(supply / (bottom + resistance), 9);
        expect(sensor.sensorPowerState).toBe('powered');
        expect(
          Object.values(sensor.terminalCurrents!).reduce((sum, current) => sum + current!, 0),
        ).toBeCloseTo(0, 9);
      }
    },
  );
  it('does not assume an unloaded ideal output', () => {
    const { sensor, result } = measure(circuit(100, 5, 1000));
    expect(sensor.voltageDrop).toBeCloseTo((5 * (10000 / 11)) / (1000 + 10000 / 11), 7);
    expect(result.diagnostics.some((d) => d.code === 'soil_sensor_load')).toBe(true);
  });
  it('limits short current by the physical probe resistance without burning the sensor', () => {
    const { sensor } = measure(circuit(100, 5, 0));
    expect(sensor.current).toBeCloseTo(0.005, 8);
    expect(sensor.stressState).not.toBe('burned');
    expect(measure(circuit()).sensor.sensorPowerState).toBe('powered');
  });
  it.each(['w0', 'w1'])('does not invent powered readings with disconnected %s', (id) => {
    const full = circuit();
    const { sensor } = measure({
      ...full,
      connections: full.connections.filter((w) => w.id !== id),
    });
    expect(sensor.sensorPowerState).not.toBe('powered');
  });
  it('preserves passive physics under reverse supply while warning', () => {
    const normal = circuit(50, 5);
    const { sensor, result } = measure({
      ...normal,
      connections: normal.connections.map((w) =>
        w.from.componentId === 'source'
          ? { ...w, from: { ...w.from, terminal: w.from.terminal === 'a' ? 'b' : 'a' } }
          : w,
      ),
    });
    expect(sensor.voltageDrop).toBeLessThan(0);
    expect(sensor.sensorPowerState).toBe('reversed');
    expect(result.diagnostics.some((d) => d.code === 'soil_sensor_power')).toBe(true);
  });
  it('warns above the selected supply range without secretly opening the divider', () => {
    const { sensor } = measure(circuit(50, 9));
    expect(sensor.sensorPowerState).toBe('overvoltage');
    expect(sensor.voltageDrop).toBeCloseTo((measure(circuit(50, 5)).sensor.voltageDrop * 9) / 5, 7);
  });
  it.each([NaN, Infinity, -Infinity, -1, 101, '50', true])('rejects invalid input %s', (value) => {
    const component = { ...soil(), stateProperties: { moisturePercent: value } };
    expect(SOIL_MOISTURE_MODEL.validate(component).length).toBeGreaterThan(0);
    expect(() => SOIL_MOISTURE_MODEL.normalize(component)).toThrow();
    const doc = circuit();
    const invalid = {
      ...doc,
      components: doc.components.map((p) => (p.id === 'soil' ? component : p)),
    };
    if (typeof value === 'number' && !Number.isFinite(value)) {
      expect(() => analyseCircuit(invalid)).toThrow(/must be finite/);
    } else expect(analyseCircuit(invalid).solved).toBe(false);
  });
  it('migrates only known placeholders, persists calibration input and stays deterministic', () => {
    const part = {
      ...soil(80),
      electricalModelId: 'unsupported',
      electricalModelVersion: 1,
      modelProfileId: 'unsupported-soil-moisture-sensor',
      modelProfileVersion: 1,
    };
    expect(electricalModelIdentityForComponent(part).electricalModelId).toBe(
      'resistive-soil-sensor',
    );
    expect(
      electricalModelIdentityForComponent({ ...part, modelProfileVersion: 2 }).electricalModelId,
    ).toBe('unsupported');
    const doc = circuit(80);
    const restored = parseElectronicsDocument(JSON.parse(JSON.stringify(doc)));
    if (!restored.ok) throw new Error(restored.message);
    expect(analyseCircuit(restored.document)).toEqual(analyseCircuit(doc));
    expect(
      analyseCircuit({
        ...doc,
        connections: doc.connections.map((w) => ({ ...w, vertices: [{ x: 999, y: -300 }] })),
      }),
    ).toEqual(analyseCircuit(doc));
    expect(analyseCircuit(circuit(20)).simulationInputDigest).not.toBe(
      analyseCircuit(doc).simulationInputDigest,
    );
  });
  it('Arduino reads the circuit voltage, including time-stamped moisture and GPIO power', () => {
    for (const pin of ['a0', 'a5']) {
      const doc = document(
        [
          soil(0),
          {
            id: 'uno',
            kind: 'visual',
            componentTypeId: 'arduino-uno',
            value: 5,
            position: { x: 0, y: 0 },
            pinIds: [pin, 'd7', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
            stateProperties: {
              arduinoSource: `void setup() { pinMode(7, OUTPUT); digitalWrite(7, HIGH); pinMode(13, OUTPUT); } void loop() { digitalWrite(13, analogRead(${pin.toUpperCase()}) > 500); delay(1); }`,
            },
          },
        ],
        [
          ['uno', 'd7', 'soil', 'vcc'],
          ['uno', 'power-gnd-1', 'soil', 'gnd'],
          ['soil', 'signal', 'uno', pin],
        ],
      );
      expect(
        measure(doc).result.components.find((p) => p.componentId === 'uno')!.terminalVoltages[
          'd13'
        ],
      ).toBe(0);
      const inputs = [
        {
          atMicroseconds: 2000,
          componentId: 'soil',
          property: 'moisturePercent' as const,
          value: 100,
        },
      ];
      const before = advanceArduinoCircuitClock(doc, 1999, undefined, { inputs });
      expect(before.executionStatus, JSON.stringify(before.diagnostics)).toBe('ready');
      expect(
        before.result!.components.find((p) => p.componentId === 'uno')!.terminalVoltages['d13'],
      ).toBe(0);
      const after = advanceArduinoCircuitClock(doc, 3500, before.state!, { inputs });
      expect(after.executionStatus, JSON.stringify(after.diagnostics)).toBe('ready');
      expect(
        after.result!.components.find((p) => p.componentId === 'uno')!.terminalVoltages['d13'],
      ).toBeCloseTo(5, 7);
      expect(after.result).toEqual(
        advanceArduinoCircuitClock(doc, 3500, undefined, { inputs }).result,
      );
    }
  });
  it('uses a monotone explicit calibration rather than universal moisture claims', () => {
    expect(soilResistanceOhm(0)).toBe(1e6);
    expect(soilResistanceOhm(100)).toBe(1000);
    for (let m = 1; m <= 100; m++)
      expect(soilResistanceOhm(m)).toBeLessThan(soilResistanceOhm(m - 1));
  });
  it('measures through breadboard hole groups with the common multimeter model', () => {
    const initial = circuit(75);
    const doc = document(
      [
        ...initial.components.filter((p) => p.id !== 'load'),
        {
          id: 'board',
          kind: 'breadboard',
          value: 0,
          position: { x: 0, y: 0 },
          pinIds: ['J1', 'I1'],
          internalConnections: [['J1', 'I1']],
        },
        {
          id: 'meter',
          kind: 'visual',
          componentTypeId: 'multimeter',
          value: 0,
          position: { x: 0, y: 0 },
          pinIds: ['v-ohm-ma', 'com'],
          stateProperties: { measurementMode: 'dc-voltage' },
        },
      ],
      [
        ['source', 'a', 'soil', 'vcc'],
        ['source', 'b', 'soil', 'gnd'],
        ['soil', 'signal', 'board', 'J1'],
        ['board', 'I1', 'meter', 'v-ohm-ma'],
        ['soil', 'gnd', 'meter', 'com'],
      ],
    );
    const { result, sensor } = measure(doc);
    expect(result.components.find((p) => p.componentId === 'meter')!.measuredValue).toBe(
      sensor.sensorOutputVoltageVolt,
    );
    expect(sensor.sensorOutputVoltageVolt).toBeCloseTo(
      measure(initial).sensor.sensorOutputVoltageVolt!,
      7,
    );
  });
});
