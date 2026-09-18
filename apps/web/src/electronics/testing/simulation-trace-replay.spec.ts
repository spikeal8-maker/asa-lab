import {
  advanceElectronicsToHorizon,
  resetElectronicsTimedState,
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

type DirectReady = Extract<ElectronicsTimedAdvanceResult, { executionStatus: 'ready' }>;

interface WorkerFixture {
  readonly name: string;
  readonly document: SchematicDocument;
  readonly horizon: number;
  readonly trace: readonly ElectronicsTimedInputEvent[];
}

interface WorkerReplay {
  readonly final: SimulationTimedAdvancePayload;
  readonly yieldSequence: readonly number[];
}

function source(id: string, value = 5) {
  return {
    id,
    kind: 'source' as const,
    value,
    position: { x: 0, y: 0 },
  };
}

function resistor(id: string, value = 1000) {
  return {
    id,
    kind: 'resistor' as const,
    value,
    position: { x: 100, y: 0 },
  };
}

function board(sourceCode: string) {
  return {
    id: 'uno',
    kind: 'visual' as const,
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd3', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: sourceCode },
  };
}

function button(id: string) {
  return {
    id,
    kind: 'button' as const,
    value: 1,
    position: { x: 60, y: 0 },
    state: false,
  };
}

function document(
  components: SchematicDocument['components'],
  connections: SchematicDocument['connections'],
): SchematicDocument {
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  };
}

function physicalFixture(): WorkerFixture {
  return {
    name: 'physical-rc',
    horizon: 160_000,
    trace: [],
    document: document(
      [
        source('source'),
        resistor('r1'),
        {
          id: 'c1',
          kind: 'visual',
          value: 100,
          position: { x: 200, y: 0 },
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['negative', 'positive'],
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      [
        {
          id: 'w1',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'r1', terminal: 'a' },
        },
        {
          id: 'w2',
          from: { componentId: 'r1', terminal: 'b' },
          to: { componentId: 'c1', terminal: 'positive' },
        },
        {
          id: 'w3',
          from: { componentId: 'c1', terminal: 'negative' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    ),
  };
}

function arduinoFixture(): WorkerFixture {
  return {
    name: 'arduino-gpio',
    horizon: 160_000,
    trace: [],
    document: document(
      [
        board(
          'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);digitalWrite(13,LOW);delay(20);}',
        ),
        resistor('load'),
      ],
      [
        {
          id: 'w1',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'load', terminal: 'a' },
        },
        {
          id: 'w2',
          from: { componentId: 'load', terminal: 'b' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    ),
  };
}

const CANONICAL_TRACE: readonly ElectronicsTimedInputEvent[] = Object.freeze([
  Object.freeze({
    atMicroseconds: 50_000,
    targetId: 'one',
    operation: 'state',
    payload: true,
  }),
  Object.freeze({
    atMicroseconds: 50_000,
    targetId: 'two',
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

function inputTraceFixture(): WorkerFixture {
  return {
    name: 'canonical-input-trace',
    horizon: 160_000,
    trace: CANONICAL_TRACE,
    document: document(
      [
        board(
          'int left=1;int right=1;void setup(){pinMode(2,INPUT_PULLUP);pinMode(3,INPUT_PULLUP);pinMode(13,OUTPUT);}void loop(){left=digitalRead(2);right=digitalRead(3);if(left==right){digitalWrite(13,HIGH);}else{digitalWrite(13,LOW);}delay(20);}',
        ),
        button('one'),
        button('two'),
        resistor('load'),
      ],
      [
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
    ),
  };
}

const FIXTURES = [physicalFixture(), arduinoFixture(), inputTraceFixture()] as const;

function steppedTargets(
  horizon: number,
  step: number,
  trace: readonly ElectronicsTimedInputEvent[],
) {
  const targets: number[] = [];
  for (let value = step; value < horizon; value += step) targets.push(value);
  return [...new Set([...targets, ...trace.map((event) => event.atMicroseconds), horizon])]
    .filter((value) => value > 0 && value <= horizon)
    .sort((left, right) => left - right);
}

function profiles(fixture: WorkerFixture) {
  const { horizon, trace } = fixture;
  const withTrace = (values: readonly number[]) =>
    [...new Set([...values, ...trace.map((event) => event.atMicroseconds), horizon])]
      .filter((value) => value > 0 && value <= horizon)
      .sort((left, right) => left - right);
  return {
    'single-shot': [horizon],
    '16ms-partition': steppedTargets(horizon, 16_000, trace),
    '33ms-partition': steppedTargets(horizon, 33_000, trace),
    '100ms-partition': steppedTargets(horizon, 100_000, trace),
    'irregular-stalled': withTrace([7_000, 23_000, 91_000, 145_000]),
  } as const;
}

function workerReplay(fixture: WorkerFixture, targets: readonly number[]): WorkerReplay {
  let state: ElectronicsTimedState = resetElectronicsTimedState();
  let sent = 0;
  let requestSequence = 0;
  let final: SimulationTimedAdvancePayload | undefined;
  const yieldSequence: number[] = [];

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
    const target = targets[targetIndex]!;
    const newlyAccepted: ElectronicsTimedInputEvent[] = [];
    if (targets.length === 1 && targetIndex === 0) {
      newlyAccepted.push(...fixture.trace);
      sent = fixture.trace.length;
    } else {
      while (sent < fixture.trace.length && fixture.trace[sent]!.atMicroseconds <= target) {
        newlyAccepted.push(fixture.trace[sent]!);
        sent++;
      }
    }
    const nextUnsent = fixture.trace[sent];
    if (nextUnsent && nextUnsent.atMicroseconds < target) {
      throw new Error(
        `Worker profile committed past unsent input at ${nextUnsent.atMicroseconds}`,
      );
    }

    const evaluate = (inputEvents: readonly ElectronicsTimedInputEvent[] | undefined) => {
      const response = evaluateSimulationWorkerRequest({
        protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
        engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
        requestId: `eopt3e-${++requestSequence}`,
        generationId: 1,
        projectSessionId: 'eopt3e-replay',
        kind: 'advance',
        document: fixture.document,
        state,
        requestedHorizonMicroseconds: target,
        ...(inputEvents && inputEvents.length > 0 ? { inputEvents } : {}),
      });
      if (!response.ok || response.kind !== 'advance') {
        throw new Error(`${fixture.name} Worker failure: ${JSON.stringify(response)}`);
      }
      return response.advance;
    };

    let result = evaluate(newlyAccepted);
    for (let resume = 0; result.executionStatus === 'yielded'; resume++) {
      if (resume > 20_000) throw new Error(`Worker yield did not converge for ${fixture.name}`);
      yieldSequence.push(result.committedHorizonMicroseconds);
      state = result.state;
      result = evaluate(undefined);
    }
    if (result.executionStatus === 'fault') {
      throw new Error(
        `${fixture.name} Worker fault at target ${target}: ${JSON.stringify(
          result.diagnostics,
        )}`,
      );
    }
    expect(result.committedHorizonMicroseconds).toBe(target);
    state = result.state;
    final = result;
  }

  expect(sent).toBe(fixture.trace.length);
  if (!final) throw new Error(`${fixture.name} Worker produced no ready result`);
  return { final, yieldSequence };
}

function directReplay(fixture: WorkerFixture): DirectReady {
  let result = advanceElectronicsToHorizon(fixture.document, {
    requestedHorizonMicroseconds: fixture.horizon,
    state: resetElectronicsTimedState(),
    ...(fixture.trace.length > 0 ? { inputEvents: fixture.trace } : {}),
  });
  for (let resume = 0; result.executionStatus === 'yielded'; resume++) {
    if (resume > 20_000) throw new Error(`direct yield did not converge for ${fixture.name}`);
    result = advanceElectronicsToHorizon(fixture.document, {
      requestedHorizonMicroseconds: fixture.horizon,
      state: result.state,
    });
  }
  if (result.executionStatus !== 'ready') {
    throw new Error(`${fixture.name} direct replay did not become ready`);
  }
  return result;
}

function directSemanticPayload(result: DirectReady) {
  return {
    executionStatus: result.executionStatus,
    requestedHorizonMicroseconds: result.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: result.committedHorizonMicroseconds,
    state: result.state,
    result: {
      solved: result.observation.solved,
      current: result.observation.current,
      components: result.observation.components,
      nodes: result.observation.nodes,
      diagnostics: result.observation.diagnostics,
      iterations: result.observation.iterations,
      numericalResidual: result.observation.numericalResidual,
      numericalTolerance: result.observation.numericalTolerance,
      quality: result.observation.quality,
    },
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

describe('E-OPT-3E Worker trace/replay equivalence', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: Worker payload converges across request partitions`, () => {
      const matrix = profiles(fixture);
      const reference = workerReplay(fixture, matrix['single-shot']);
      for (const [name, targets] of Object.entries(matrix)) {
        const actual = workerReplay(fixture, targets);
        expect(actual.final, `${fixture.name}/Worker/${name}`).toEqual(reference.final);
      }
    });

    it(`${fixture.name}: Worker final semantic payload equals direct timed engine`, () => {
      const worker = workerReplay(fixture, profiles(fixture)['33ms-partition']).final;
      const direct = directReplay(fixture);
      expect(workerSemanticPayload(worker)).toEqual(directSemanticPayload(direct));
      expect(worker.result?.status).toBe(direct.observation.solved ? 'solved' : 'invalid');
      expect(worker.result?.simulationInputDigest).toBe(worker.state.continuation?.documentDigest);
      expect(worker.result?.modelSetDigest).toBe(worker.state.continuation?.modelSetDigest);
      expect(worker.result?.solverRevision).toBe(ELECTRONICS_SIMULATION_ENGINE_REVISION);
    });
  }

  it('Worker input replay preserves the canonical same-time trace exactly once', () => {
    const fixture = inputTraceFixture();
    const done = workerReplay(fixture, profiles(fixture)['irregular-stalled']).final;
    const continuation = JSON.parse(done.state.continuation!.serializedState);
    expect(continuation.inputs).toEqual([
      { atMicroseconds: 50_000, componentId: 'one', property: 'state', value: true },
      { atMicroseconds: 50_000, componentId: 'two', property: 'state', value: true },
      { atMicroseconds: 125_000, componentId: 'one', property: 'state', value: false },
    ]);
    expect(continuation.nextInputIndex).toBe(3);
  });
});
