import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../domain/document.js';
import { analyseCircuit } from '../domain/simulation.js';
import { electricalModelIdentityForComponent } from '../domain/model-identity.js';
import { advanceArduinoCircuitClock } from '../domain/arduino-circuit-scheduler.js';
import { TMP36_DEVICE_MODEL, TMP36_PROFILE } from '../domain/models/tmp36-dc-model.js';

function sensor(temperatureCelsius = 25): SchematicComponent {
  return {
    id: 'tmp',
    kind: 'visual',
    componentTypeId: 'temperature-sensor',
    value: 0,
    position: { x: 0, y: 0 },
    pinIds: ['pin-1', 'pin-2', 'pin-3'],
    stateProperties: { temperatureCelsius },
  };
}
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
function circuit(temperature = 25, supply = 5, resistance = 10e6, reverse = false) {
  return document(
    [
      sensor(temperature),
      { id: 'supply', kind: 'source', value: supply, position: { x: 0, y: 0 } },
      { id: 'load', kind: 'resistor', value: resistance, position: { x: 0, y: 0 } },
    ],
    [
      ['supply', reverse ? 'b' : 'a', 'tmp', 'pin-1'],
      ['supply', reverse ? 'a' : 'b', 'tmp', 'pin-3'],
      ['tmp', 'pin-2', 'load', 'a'],
      ['tmp', 'pin-3', 'load', 'b'],
    ],
  );
}
const measurement = (doc: ElectronicsDocument) => {
  const result = analyseCircuit(doc);
  expect(result.solved, JSON.stringify(result.diagnostics)).toBe(true);
  expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
  return { result, tmp: result.components.find((entry) => entry.componentId === 'tmp')! };
};
describe('TMP36 common electrical model', () => {
  it('uses breadboard groups without moving pins or depending on wire geometry', () => {
    const direct = circuit();
    const board: SchematicComponent = {
      id: 'breadboard',
      kind: 'breadboard',
      value: 0,
      position: { x: 0, y: 0 },
      pinIds: ['A1', 'B1', 'A2', 'B2', 'A3', 'B3'],
      internalConnections: [
        ['A1', 'B1'],
        ['A2', 'B2'],
        ['A3', 'B3'],
      ],
    };
    const wired = document(
      [...direct.components, board],
      [
        ['supply', 'a', 'breadboard', 'A1'],
        ['breadboard', 'B1', 'tmp', 'pin-1'],
        ['supply', 'b', 'breadboard', 'A3'],
        ['breadboard', 'B3', 'tmp', 'pin-3'],
        ['tmp', 'pin-2', 'breadboard', 'A2'],
        ['breadboard', 'B2', 'load', 'a'],
        ['load', 'b', 'breadboard', 'A3'],
      ],
    );
    const { tmp, result } = measurement(wired);
    expect(tmp.sensorOutputVoltageVolt).toBe(measurement(direct).tmp.sensorOutputVoltageVolt);
    const reshaped = {
      ...wired,
      connections: wired.connections.map((w) => ({ ...w, vertices: [{ x: 777, y: -100 }] })),
    };
    expect(analyseCircuit(reshaped)).toEqual(result);
  });
  it.each([-40, 0, 25, 100, 125])(
    'solves temperature %s, finite output impedance, KCL and power',
    (temperature) => {
      const { result, tmp } = measurement(circuit(temperature));
      const expected = ((0.5 + 0.01 * temperature) * 10e6) / (10e6 + 60);
      expect(tmp.sensorOutputVoltageVolt).toBeCloseTo(expected, 8);
      expect(tmp.voltageDrop).toBeCloseTo(expected, 8);
      expect(tmp.sensorPowerState).toBe('powered');
      expect(tmp.sensorOutputRegion).toBe('regulated');
      expect(tmp.current).toBeCloseTo(50e-6 + 5e-9 + expected / 10e6, 9);
      expect(
        Object.values(tmp.terminalCurrents!).reduce((sum, value) => sum + value!, 0),
      ).toBeCloseTo(0, 9);
      expect(result.quality.powerBalanceResidualWatt).toBeLessThan(1e-8);
    },
  );
  it.each([2.7, 3.3, 5.5])('does not treat the sensor as a supply divider at %s V', (supply) => {
    expect(measurement(circuit(25, supply)).tmp.sensorOutputVoltageVolt).toBeCloseTo(0.75, 5);
  });
  it('shows a warning under excess load and limits short current without destroying the sensor', () => {
    const loaded = measurement(circuit(25, 5, 10_000));
    expect(loaded.tmp.sensorOutputVoltageVolt).toBeCloseTo((0.75 * 10000) / 10060, 8);
    expect(loaded.result.diagnostics.some((d) => d.code === 'temperature_sensor_load')).toBe(true);
    const shorted = circuit(25, 5, 0);
    const { tmp, result } = measurement(shorted);
    expect(tmp.sensorOutputCurrentAmp).toBeCloseTo(250e-6, 9);
    expect(tmp.sensorOutputRegion).toBe('current-limit');
    expect(tmp.stressState).not.toBe('burned');
    expect(result.components.find((p) => p.componentId === 'supply')!.current).toBeCloseTo(
      300e-6 + 5e-9,
      9,
    );
    expect(measurement(circuit()).tmp.sensorOutputRegion).toBe('regulated');
  });
  it.each([
    [2, false, 'undervoltage'],
    [9, false, 'overvoltage'],
    [5, true, 'reversed'],
  ] as const)(
    'does not generate a temperature voltage with invalid supply %s',
    (voltage, reverse, status) => {
      const { tmp, result } = measurement(circuit(25, voltage, 10e6, reverse));
      expect(tmp.sensorPowerState).toBe(status);
      expect(tmp.sensorOutputCurrentAmp).toBe(0);
      // An inactive high-impedance output can retain reference-shunt residue;
      // it must not manufacture the 0.75 V temperature transfer.
      expect(Math.abs(tmp.sensorOutputVoltageVolt!)).toBeLessThan(0.0001);
      expect(result.diagnostics.some((d) => d.code === 'temperature_sensor_power')).toBe(true);
    },
  );
  it('does not output a voltage when either supply pin is disconnected', () => {
    for (const disconnected of ['w0', 'w1']) {
      const full = circuit();
      const { tmp } = measurement({
        ...full,
        connections: full.connections.filter((w) => w.id !== disconnected),
      });
      expect(tmp.sensorPowerState).not.toBe('powered');
      expect(tmp.sensorOutputCurrentAmp).toBe(0);
    }
  });
  it.each([NaN, Infinity, -Infinity, -41, 126, '25', true])(
    'rejects invalid temperature %s rather than silently clamping it',
    (value) => {
      const part = { ...sensor(), stateProperties: { temperatureCelsius: value } };
      expect(TMP36_DEVICE_MODEL.validate(part)).not.toHaveLength(0);
      expect(() => TMP36_DEVICE_MODEL.normalize(part)).toThrow();
    },
  );
  it('migrates only the exact legacy placeholder and preserves old pin IDs and persisted temperature', () => {
    const old = {
      ...sensor(-10),
      electricalModelId: 'unsupported',
      electricalModelVersion: 1,
      modelProfileId: 'unsupported-temperature-sensor',
      modelProfileVersion: 1,
    };
    expect(electricalModelIdentityForComponent(old).modelProfileId).toBe(TMP36_PROFILE.id);
    expect(
      electricalModelIdentityForComponent({ ...old, modelProfileVersion: 999 }).electricalModelId,
    ).toBe('unsupported');
    const doc = circuit(-10);
    const restored = parseElectronicsDocument(JSON.parse(JSON.stringify(doc)));
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.message);
    expect(analyseCircuit(restored.document)).toEqual(analyseCircuit(doc));
    expect(analyseCircuit(circuit(50)).simulationInputDigest).not.toBe(
      analyseCircuit(doc).simulationInputDigest,
    );
  });
  it('reads the same output with a real multimeter component', () => {
    const initial = circuit();
    const doc = document(
      [
        ...initial.components.filter((p) => p.id !== 'load'),
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
        ['supply', 'a', 'tmp', 'pin-1'],
        ['supply', 'b', 'tmp', 'pin-3'],
        ['tmp', 'pin-2', 'meter', 'v-ohm-ma'],
        ['tmp', 'pin-3', 'meter', 'com'],
      ],
    );
    const { result, tmp } = measurement(doc);
    expect(result.components.find((p) => p.componentId === 'meter')!.measuredValue).toBe(
      tmp.sensorOutputVoltageVolt,
    );
  });
  it('warns about an externally driven output without sinking fictitious current', () => {
    const initial = circuit();
    const doc = {
      ...initial,
      connections: [
        ...initial.connections,
        {
          id: 'backfeed',
          from: { componentId: 'supply', terminal: 'a' as const },
          to: { componentId: 'tmp', terminal: 'pin-2' as const },
        },
      ],
    };
    const { tmp, result } = measurement(doc);
    expect(tmp.sensorOutputRegion).toBe('high-impedance');
    expect(tmp.sensorOutputCurrentAmp).toBe(0);
    expect(result.diagnostics.some((d) => d.code === 'temperature_sensor_backfeed')).toBe(true);
  });
  it('uses sensor voltage in both Arduino execution paths and applies timestamped temperature only when due', () => {
    const doc = document(
      [
        sensor(),
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          value: 5,
          position: { x: 0, y: 0 },
          pinIds: ['a0', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: {
            arduinoSource:
              'int reading = 0; void setup() { pinMode(13, OUTPUT); } void loop() { reading = analogRead(A0); digitalWrite(13, reading > 200); delay(1); }',
          },
        },
      ],
      [
        ['uno', 'power-5v', 'tmp', 'pin-1'],
        ['uno', 'power-gnd-1', 'tmp', 'pin-3'],
        ['tmp', 'pin-2', 'uno', 'a0'],
      ],
    );
    const first = measurement(doc);
    expect(
      first.result.components.find((p) => p.componentId === 'uno')!.terminalVoltages['a0'],
    ).toBeCloseTo(0.75, 8);
    expect(
      first.result.components.find((p) => p.componentId === 'uno')!.terminalVoltages['d13'],
    ).toBe(0);
    const inputs = [
      {
        atMicroseconds: 2000,
        componentId: 'tmp',
        property: 'temperatureCelsius' as const,
        value: 100,
      },
    ];
    const before = advanceArduinoCircuitClock(doc, 1999, undefined, { inputs });
    expect(before.executionStatus, JSON.stringify(before.diagnostics)).toBe('ready');
    expect(
      before.result!.components.find((p) => p.componentId === 'tmp')!.sensorOutputVoltageVolt,
    ).toBeCloseTo(0.75, 8);
    const after = advanceArduinoCircuitClock(doc, 3500, before.state!, { inputs });
    expect(after.executionStatus, JSON.stringify(after.diagnostics)).toBe('ready');
    expect(after.result!.quality.passed).toBe(true);
    expect(
      after.result!.components.find((p) => p.componentId === 'tmp')!.sensorOutputVoltageVolt,
    ).toBeCloseTo(1.5, 8);
    expect(
      after.result!.components.find((p) => p.componentId === 'uno')!.terminalVoltages['d13'],
    ).toBeCloseTo(5, 8);
    const direct = advanceArduinoCircuitClock(doc, 3500, undefined, { inputs });
    expect(after.result).toEqual(direct.result);
    expect(
      advanceArduinoCircuitClock(doc, 3500, undefined, { inputs: [{ ...inputs[0]!, value: 126 }] })
        .executionStatus,
    ).toBe('fault');
  });
});
