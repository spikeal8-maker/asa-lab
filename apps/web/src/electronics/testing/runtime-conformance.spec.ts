import {
  advanceElectronicsToHorizon,
  pauseElectronicsTimedState,
  resetElectronicsTimedState,
  resumeElectronicsTimedState,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import { evaluateSimulationWorkerRequest } from '../simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type SimulationTimedAdvancePayload,
} from '../simulation-worker-protocol';

type ReadyResult = Extract<ElectronicsTimedAdvanceResult, { executionStatus: 'ready' }>;

const document: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'uno',
      kind: 'visual',
      value: 5,
      position: { x: 0, y: 0 },
      componentTypeId: 'arduino-uno',
      pinIds: ['d2', 'd3', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
      stateProperties: {
        arduinoSource:
          'int left=1;int right=1;void setup(){pinMode(2,INPUT_PULLUP);pinMode(3,INPUT_PULLUP);pinMode(13,OUTPUT);}void loop(){left=digitalRead(2);right=digitalRead(3);if(left==right){digitalWrite(13,HIGH);}else{digitalWrite(13,LOW);}delay(20);}',
      },
    },
    { id: 'one', kind: 'button', value: 1, position: { x: 60, y: 0 }, state: false },
    { id: 'two', kind: 'button', value: 1, position: { x: 90, y: 0 }, state: false },
    { id: 'load', kind: 'resistor', value: 1000, position: { x: 160, y: 0 } },
  ],
  connections: [
    {
      id: 'b1',
      from: { componentId: 'uno', terminal: 'd2' },
      to: { componentId: 'one', terminal: 'a' },
    },
    {
      id: 'b2',
      from: { componentId: 'one', terminal: 'b' },
      to: { componentId: 'uno', terminal: 'power-gnd-1' },
    },
    {
      id: 'b3',
      from: { componentId: 'uno', terminal: 'd3' },
      to: { componentId: 'two', terminal: 'a' },
    },
    {
      id: 'b4',
      from: { componentId: 'two', terminal: 'b' },
      to: { componentId: 'uno', terminal: 'power-gnd-1' },
    },
    {
      id: 'out1',
      from: { componentId: 'uno', terminal: 'd13' },
      to: { componentId: 'load', terminal: 'a' },
    },
    {
      id: 'out2',
      from: { componentId: 'load', terminal: 'b' },
      to: { componentId: 'uno', terminal: 'power-gnd-1' },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};

const TRACE: readonly ElectronicsTimedInputEvent[] = Object.freeze([
  Object.freeze({
    atMicroseconds: 50_000,
    targetId: 'two',
    operation: 'state',
    payload: true,
  }),
  Object.freeze({
    atMicroseconds: 50_000,
    targetId: 'one',
    operation: 'state',
    payload: true,
  }),
  Object.freeze({
    atMicroseconds: 125_000,
    targetId: 'one',
    operation: 'state',
    payload: false,
  }),
]);

function requireReady(result: ElectronicsTimedAdvanceResult): ReadyResult {
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  if (result.executionStatus !== 'ready') {
    throw new Error(`Expected ready result: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
}

function directAdvance(
  state: ElectronicsTimedState,
  horizon: number,
  inputEvents?: readonly ElectronicsTimedInputEvent[],
) {
  return advanceElectronicsToHorizon(document, {
    requestedHorizonMicroseconds: horizon,
    state,
    ...(inputEvents ? { inputEvents } : {}),
  });
}

function workerAdvance(
  requestId: string,
  state: ElectronicsTimedState,
  horizon: number,
  inputEvents?: readonly ElectronicsTimedInputEvent[],
): SimulationTimedAdvancePayload {
  const response = evaluateSimulationWorkerRequest({
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
    requestId,
    generationId: 7,
    projectSessionId: 'eopt3f-runtime-conformance',
    kind: 'advance',
    document,
    state,
    requestedHorizonMicroseconds: horizon,
    ...(inputEvents ? { inputEvents } : {}),
  });
  expect(response.ok).toBe(true);
  if (!response.ok || response.kind !== 'advance') {
    throw new Error(`Worker advance failed: ${JSON.stringify(response)}`);
  }
  return response.advance;
}

function directSemanticPayload(result: ElectronicsTimedAdvanceResult) {
  return {
    executionStatus: result.executionStatus,
    requestedHorizonMicroseconds: result.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: result.committedHorizonMicroseconds,
    state: result.state,
    result: result.observation
      ? {
          solved: result.observation.solved,
          current: result.observation.current,
          components: result.observation.components,
          nodes: result.observation.nodes,
          diagnostics: result.observation.diagnostics,
          iterations: result.observation.iterations,
          numericalResidual: result.observation.numericalResidual,
          numericalTolerance: result.observation.numericalTolerance,
          quality: result.observation.quality,
        }
      : null,
    diagnostics: result.diagnostics,
  };
}

function workerSemanticPayload(result: SimulationTimedAdvancePayload) {
  const value = result.result;
  return {
    executionStatus: result.executionStatus,
    requestedHorizonMicroseconds: result.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: result.committedHorizonMicroseconds,
    state: result.state,
    result: value
      ? {
          solved: value.solved,
          current: value.current,
          components: value.components,
          nodes: value.nodes,
          diagnostics: value.diagnostics,
          iterations: value.iterations,
          numericalResidual: value.numericalResidual,
          numericalTolerance: value.numericalTolerance,
          quality: value.quality,
        }
      : null,
    diagnostics: result.diagnostics,
  };
}

function progressedState() {
  return requireReady(directAdvance(resetElectronicsTimedState(), 100_000, TRACE.slice(0, 2)))
    .state;
}

function finalState() {
  return requireReady(directAdvance(resetElectronicsTimedState(), 160_000, TRACE)).state;
}

describe('E-OPT-3F Worker runtime conformance', () => {
  it('preserves paused-state fault semantics across the Worker evaluator boundary', () => {
    const paused = pauseElectronicsTimedState(progressedState());
    const direct = directAdvance(paused, 160_000, [TRACE[2]!]);
    const worker = workerAdvance('paused', paused, 160_000, [TRACE[2]!]);

    expect(workerSemanticPayload(worker)).toEqual(directSemanticPayload(direct));
    expect(worker).toMatchObject({
      executionStatus: 'fault',
      committedHorizonMicroseconds: 100_000,
      state: paused,
      result: null,
      diagnostics: [{ code: 'timed_state_paused' }],
    });
  });

  it('preserves resumed canonical execution across the Worker evaluator boundary', () => {
    const resumed = resumeElectronicsTimedState(pauseElectronicsTimedState(progressedState()));
    const direct = directAdvance(resumed, 160_000, [TRACE[2]!]);
    const worker = workerAdvance('resumed', resumed, 160_000, [TRACE[2]!]);

    expect(workerSemanticPayload(worker)).toEqual(directSemanticPayload(direct));
    expect(worker.executionStatus).toBe('ready');
    expect(worker.committedHorizonMicroseconds).toBe(160_000);
  });

  it('preserves stale-horizon fail-closed semantics across the Worker evaluator boundary', () => {
    const state = finalState();
    const direct = directAdvance(state, 150_000);
    const worker = workerAdvance('stale-horizon', state, 150_000);

    expect(workerSemanticPayload(worker)).toEqual(directSemanticPayload(direct));
    expect(worker).toMatchObject({
      executionStatus: 'fault',
      committedHorizonMicroseconds: 160_000,
      state,
      result: null,
      diagnostics: [{ code: 'invalid_clock_continuation' }],
    });
  });

  it('preserves retroactive-input rejection across the Worker evaluator boundary', () => {
    const state = finalState();
    const retroactive: ElectronicsTimedInputEvent = {
      atMicroseconds: 160_000,
      targetId: 'two',
      operation: 'state',
      payload: false,
    };
    const direct = directAdvance(state, 200_000, [retroactive]);
    const worker = workerAdvance('retroactive-input', state, 200_000, [retroactive]);

    expect(workerSemanticPayload(worker)).toEqual(directSemanticPayload(direct));
    expect(worker).toMatchObject({
      executionStatus: 'fault',
      committedHorizonMicroseconds: 160_000,
      state,
      result: null,
      diagnostics: [{ code: 'retroactive_input' }],
    });
  });
});
