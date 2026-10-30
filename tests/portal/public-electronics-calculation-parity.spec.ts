import { describe, expect, it } from 'vitest';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import type { SchematicDocument, SolveResult } from '../../apps/web/src/api';
import { createPublicArtifactAdapters } from '../../apps/api/src/public-project-artifact';
import { publicSimulationDocument } from '../../apps/web/src/projects-public/electronics-public-runtime';
import { evaluateSimulationWorkerRequest } from '../../apps/web/src/electronics/simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
} from '../../apps/web/src/electronics/simulation-worker-protocol';
import { parseElectronicsDocument } from '../../contexts/electronics/domain/document';
import { resetElectronicsTimedState } from '../../contexts/electronics/timed-state';

const provenance = { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 1 };
const registry = {
  get: () => ({
    provider: {
      validate: (input: unknown) => {
        const parsed = parseElectronicsDocument(input);
        return parsed.ok
          ? { ok: true, payload: parsed.document }
          : { ok: false, diagnostics: [{ message: parsed.message }] };
      },
    },
  }),
} as unknown as ModuleRegistry;

function published(arduino: boolean, pressed: boolean): SchematicDocument {
  const components: SchematicDocument['components'] = [
    arduino
      ? {
          id: 's',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          value: 5,
          position: { x: 0, y: 0 },
          pinIds: ['d2', 'd13', 'power-gnd-1', 'power-5v', 'power-3v3'],
          stateProperties: {
            arduinoCodeMode: 'text',
            arduinoWorkspace: '{}',
            arduinoSource:
              'void setup(){pinMode(2,INPUT_PULLUP);pinMode(13,OUTPUT);}void loop(){if(digitalRead(2)==LOW){digitalWrite(13,HIGH);}else{digitalWrite(13,LOW);}delay(1);}',
          },
        }
      : {
          id: 's',
          kind: 'source',
          componentTypeId: 'battery-holder-aa-2',
          value: 3,
          position: { x: 0, y: 0 },
          pinIds: ['BAT+', 'BAT-'],
          stateProperties: { cells: 2, internalResistanceOhm: 1.7, maxContinuousCurrentAmp: 0.8 },
        },
    {
      id: 'r',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      value: 550,
      position: { x: 100, y: 0 },
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { powerRatingWatt: 0.5, tolerancePercent: 1, resistanceUnit: 'Ом' },
    },
    {
      id: 'l',
      kind: 'led',
      componentTypeId: 'led-5mm',
      value: 2,
      position: { x: 200, y: 0 },
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'green', ledBrightness: 73, ledFault: 'none' },
    },
    {
      id: 'b',
      kind: 'button',
      componentTypeId: 'button-tactile-6mm',
      value: 0,
      state: pressed,
      position: { x: 300, y: 0 },
      pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
      internalConnections: [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ],
    },
  ];
  const ends = arduino
    ? [
        ['s', 'd13', 'r', 'lead-1'],
        ['r', 'lead-2', 'l', 'anode'],
        ['l', 'cathode', 's', 'power-gnd-1'],
        ['s', 'd2', 'b', 'SW-A1'],
        ['b', 'SW-B1', 's', 'power-gnd-1'],
      ]
    : [
        ['s', 'BAT+', 'b', 'SW-A1'],
        ['b', 'SW-B1', 'r', 'lead-1'],
        ['r', 'lead-2', 'l', 'anode'],
        ['l', 'cathode', 's', 'BAT-'],
      ];
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components,
    connections: ends.map(([a, pinA, b, pinB], i) => ({
      id: `w${i}`,
      from: { componentId: a, terminal: pinA },
      to: { componentId: b, terminal: pinB },
    })),
    viewport: { x: 100, y: -50, zoom: 2 },
    simulation: { running: false, maxIterations: 48 },
  });
  if (!parsed.ok) throw Error(parsed.message);
  return JSON.parse(JSON.stringify(parsed.document)) as SchematicDocument;
}
/** Execute exactly the evaluator used by the canonical Worker; no public solver. */
function solve(document: SchematicDocument): SolveResult {
  let state = resetElectronicsTimedState();
  for (let i = 0; i < 64; i++) {
    const response = evaluateSimulationWorkerRequest({
      protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
      engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
      projectSessionId: 'parity',
      generationId: 1,
      requestId: `parity-${i}`,
      kind: 'advance',
      document,
      state,
      requestedHorizonMicroseconds: 25000,
    });
    if (!response.ok || response.kind !== 'advance') throw Error(JSON.stringify(response));
    if (response.advance.executionStatus === 'fault')
      throw Error(JSON.stringify(response.advance.diagnostics));
    if (response.advance.executionStatus === 'ready') {
      expect(response.advance.committedHorizonMicroseconds).toBe(25000);
      expect(response.advance.result?.solved).toBe(true);
      expect(response.advance.result?.quality?.passed).toBe(true);
      return response.advance.result!;
    }
    state = response.advance.state;
  }
  throw Error('Canonical Worker parity evaluation did not finish within its bounded test budget');
}
function physical(result: SolveResult, arduino: boolean) {
  const led = result.components.find((c) => c.componentId === 'l')!;
  expect(Number.isFinite(led.current)).toBe(true);
  expect(Number.isFinite(led.voltageDrop)).toBe(true);
  const board = result.components.find((c) => c.componentId === 's');
  const gpio = arduino
    ? { d13: board?.terminalVoltages.d13, d2: board?.terminalVoltages.d2 }
    : null;
  if (gpio) for (const voltage of Object.values(gpio)) expect(Number.isFinite(voltage)).toBe(true);
  return {
    current: led.current,
    voltage: led.voltageDrop,
    brightness: led.brightness,
    lit: led.lit,
    gpio,
  };
}
describe('published projection uses the same electrical calculation as the editor', () => {
  it.each([false, true])(
    'preserves physical results for full document versus public V3: Arduino=%s',
    (arduino) => {
      const observations = [];
      for (const pressed of [false, true]) {
        const full = published(arduino, pressed);
        const artifact = createPublicArtifactAdapters(registry).get('electronics')!(
          full,
          provenance,
        );
        if (artifact?.schemaVersion !== 3) throw Error('Expected executable public projection');
        const projected = publicSimulationDocument(artifact);
        expect(projected.simulation.maxIterations).toBe(full.simulation.maxIterations);
        const expected = physical(solve(full), arduino);
        expect(physical(solve(projected), arduino)).toEqual(expected);
        observations.push(expected);
      }
      // Both input states actually change the shared engine's physical output;
      // matching two permanently dark/inert circuits cannot satisfy this test.
      expect(observations[0]!.brightness).toBe(0);
      expect(observations[1]!.brightness).toBeGreaterThan(0);
      expect(observations[1]!.current).not.toBe(observations[0]!.current);
      if (arduino) expect(observations[1]!.gpio!.d13).not.toBe(observations[0]!.gpio!.d13);
      else {
        const changed = published(false, true);
        changed.components[0]!.stateProperties!.internalResistanceOhm = 50;
        expect(physical(solve(changed), false).current).not.toBe(observations[1]!.current);
      }
    },
  );
});
