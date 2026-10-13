import {
  resetElectronicsTimedState,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { describe, expect, it } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import {
  ElectronicsLiveSimulationWorkerController,
  type ElectronicsSimulationWorkerExecutor,
} from '../live-simulation-worker-controller';
import { evaluateSimulationWorkerRequest } from '../simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerResponse,
  type SimulationTimedAdvancePayload,
} from '../simulation-worker-protocol';

function fixture(body: string, active = false): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        pinIds: ['d8', 'd13', 'power-5v', 'power-gnd-1', 'power-3v3'],
        position: { x: 0, y: 0 },
        value: 5,
        stateProperties: {
          arduinoSource: 'void setup(){tone(8,1000);delay(10);noTone(8);}void loop(){delay(100);}',
        },
      },
      {
        id: 'sounder',
        kind: 'piezo',
        componentTypeId: body,
        pinIds: ['positive', 'negative'],
        position: { x: 300, y: 0 },
        value: 0,
        stateProperties: { piezoMode: active ? 'active' : 'passive' },
      },
    ],
    connections: [
      {
        id: 'positive',
        from: { componentId: 'uno', terminal: active ? 'power-5v' : 'd8' },
        to: { componentId: 'sounder', terminal: 'positive' },
      },
      {
        id: 'negative',
        from: { componentId: 'sounder', terminal: 'negative' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}
function executor() {
  let generation = 0;
  let request = 0;
  let cancelled = 0;
  const records: ElectronicsSimulationWorkerResponse[] = [];
  const base = (generationId: number) => ({
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
    generationId,
    requestId: `piezo-${++request}`,
    projectSessionId: 'piezo-project',
  });
  const execution: ElectronicsSimulationWorkerExecutor = {
    beginGeneration() {
      return ++generation;
    },
    async preflight(generationId, document) {
      const result = evaluateSimulationWorkerRequest({
        ...base(generationId),
        kind: 'preflight',
        document,
      });
      records.push(result);
      if (!result.ok || result.kind !== 'preflight') throw new Error(JSON.stringify(result));
      return result.result;
    },
    async advance(generationId, document, state, requestedHorizonMicroseconds, inputEvents) {
      const result = evaluateSimulationWorkerRequest({
        ...base(generationId),
        kind: 'advance',
        document,
        state,
        requestedHorizonMicroseconds,
        ...(inputEvents ? { inputEvents } : {}),
      });
      records.push(result);
      if (!result.ok || result.kind !== 'advance') throw new Error(JSON.stringify(result));
      return result.advance;
    },
    cancelActiveGeneration() {
      cancelled++;
    },
    dispose() {},
  };
  return { execution, records, cancelled: () => cancelled };
}
async function drain() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe('real canonical piezo evaluator and live controller', () => {
  it.each(['piezo-passive-buzzer', 'piezo-disc'])(
    '%s produces complete ready and actual continuation, never invented yielded result',
    async (body) => {
      const actual = executor();
      const doc = fixture(body);
      const bytes = JSON.stringify(doc);
      const preflight = await actual.execution.preflight(1, doc);
      expect(preflight).toMatchObject({ solved: true, quality: { finite: true, passed: true } });
      let state: ElectronicsTimedState = resetElectronicsTimedState();
      let ready!: SimulationTimedAdvancePayload;
      for (let i = 0; i < 100; i++) {
        const response = await actual.execution.advance(1, doc, state, 5000);
        state = JSON.parse(JSON.stringify(response.state));
        if (response.executionStatus === 'yielded') {
          expect(response.result).toBeNull();
          expect(response.committedHorizonMicroseconds).toBeLessThan(5000);
        } else {
          ready = response;
          break;
        }
      }
      expect(ready).toMatchObject({
        executionStatus: 'ready',
        requestedHorizonMicroseconds: 5000,
        committedHorizonMicroseconds: 5000,
        result: { solved: true, quality: { finite: true, passed: true } },
      });
      expect(ready.result!.components.find((part) => part.componentId === 'sounder')).toMatchObject(
        { frequencyHz: 1000, energized: true },
      );
      expect(JSON.stringify(doc)).toBe(bytes);
      expect(state.continuation?.serializedState).toContain('tone');
    },
  );

  it.each(['piezo-passive-buzzer', 'piezo-disc'])(
    '%s controller publishes valid frames, noTone silence and Stop/new Start at zero',
    async (body) => {
      const actual = executor();
      const doc = fixture(body);
      const controller = new ElectronicsLiveSimulationWorkerController(actual.execution);
      const publications: SolveResult[] = [];
      const horizons: number[] = [];
      const failures: unknown[] = [];
      const callbacks = {
        onResult: (result: SolveResult) => publications.push(result),
        onCommittedHorizon: (horizon: number) => horizons.push(horizon),
        onFailure: (failure: unknown) => failures.push(failure),
      };
      controller.start('piezo-project', doc, callbacks);
      await drain();
      expect(failures).toEqual([]);
      expect(horizons.at(-1)).toBe(0);
      controller.update(doc, 5000);
      await drain();
      expect(horizons.at(-1)).toBe(5000);
      expect(
        publications.at(-1)!.components.find((part) => part.componentId === 'sounder'),
      ).toMatchObject({ frequencyHz: 1000, energized: true });
      controller.update(doc, 20000);
      await drain();
      expect(
        publications.at(-1)!.components.find((part) => part.componentId === 'sounder'),
      ).toMatchObject({ frequencyHz: 0, soundLevel: 0 });
      for (const response of actual.records) {
        if (!response.ok || response.kind !== 'advance') continue;
        expect(Number.isFinite(response.metrics.computeMs)).toBe(true);
        if (response.advance.executionStatus === 'ready')
          expect(response.advance.committedHorizonMicroseconds).toBe(
            response.advance.requestedHorizonMicroseconds,
          );
        else expect(response.advance.result).toBeNull();
      }
      controller.stop();
      expect(actual.cancelled()).toBe(1);
      const count = publications.length;
      controller.update(doc, 50000);
      await drain();
      expect(publications).toHaveLength(count);
      controller.start('piezo-project', doc, callbacks);
      await drain();
      expect(horizons.at(-1)).toBe(0);
      expect(
        actual.records.filter((response) => response.ok && response.kind === 'advance').at(-1),
      ).toMatchObject({
        generationId: 2,
        advance: { executionStatus: 'ready', committedHorizonMicroseconds: 0 },
      });
      expect(failures).toEqual([]);
      controller.dispose();
    },
  );

  it('supports approved active mode in the same real evaluator', async () => {
    const actual = executor();
    const result = await actual.execution.advance(
      1,
      fixture('piezo-passive-buzzer', true),
      resetElectronicsTimedState(),
      0,
    );
    expect(result).toMatchObject({ executionStatus: 'ready', committedHorizonMicroseconds: 0 });
    expect(result.result!.components.find((part) => part.componentId === 'sounder')).toMatchObject({
      frequencyHz: 2300,
      energized: true,
    });
  });
});
