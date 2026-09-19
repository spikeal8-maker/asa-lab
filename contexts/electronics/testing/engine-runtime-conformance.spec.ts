import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  pauseElectronicsTimedState,
  resetElectronicsTimedState,
  resumeElectronicsTimedState,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '../engine';

type ReadyResult = Extract<ElectronicsTimedAdvanceResult, { executionStatus: 'ready' }>;

function parseDocument(value: unknown): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function board() {
  return {
    id: 'uno',
    kind: 'visual' as const,
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd3', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: {
      arduinoSource:
        'int left=1;int right=1;void setup(){pinMode(2,INPUT_PULLUP);pinMode(3,INPUT_PULLUP);pinMode(13,OUTPUT);}void loop(){left=digitalRead(2);right=digitalRead(3);if(left==right){digitalWrite(13,HIGH);}else{digitalWrite(13,LOW);}delay(20);}',
    },
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

function runtimeFixture(): ElectronicsEngineDocument {
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(),
      button('one'),
      button('two'),
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
  });
}

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

const SEGMENT_A: readonly ElectronicsTimedInputEvent[] = Object.freeze([
  Object.freeze({
    atMicroseconds: 40_000,
    targetId: 'one',
    operation: 'state',
    payload: true,
  }),
  Object.freeze({
    atMicroseconds: 80_000,
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

function continuation(state: ElectronicsTimedState) {
  const serialized = state.continuation?.serializedState;
  if (!serialized) throw new Error('Expected serialized continuation.');
  return JSON.parse(serialized) as {
    reachedMicroseconds: number;
    nextInputIndex: number;
    inputs: Array<{
      atMicroseconds: number;
      componentId: string;
      property: string;
      value: unknown;
    }>;
    boards: unknown[];
    physicalState?: unknown;
  };
}

function advance(
  document: ElectronicsEngineDocument,
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

describe('E-OPT-3F engine runtime conformance', () => {
  it('pause freezes a progressed canonical state and rejects future input without mutation', () => {
    const document = runtimeFixture();
    const progressed = requireReady(
      advance(document, resetElectronicsTimedState(), 100_000, TRACE.slice(0, 2)),
    );
    const paused = pauseElectronicsTimedState(progressed.state);

    expect(paused.lifecycle).toBe('paused');
    expect(paused.continuation).toEqual(progressed.state.continuation);

    const blocked = advance(document, paused, 160_000, [TRACE[2]!]);
    expect(blocked).toMatchObject({
      executionStatus: 'fault',
      requestedHorizonMicroseconds: 160_000,
      committedHorizonMicroseconds: 100_000,
      state: paused,
      observation: null,
      diagnostics: [{ code: 'timed_state_paused' }],
    });
    expect(blocked.state).toEqual(paused);
    expect(continuation(blocked.state)).toEqual(continuation(paused));
  });

  it('resume converges exactly with uninterrupted execution from the same progressed state', () => {
    const document = runtimeFixture();
    const directAtC = requireReady(
      advance(document, resetElectronicsTimedState(), 100_000, TRACE.slice(0, 2)),
    );
    const pausedAtC = requireReady(
      advance(document, resetElectronicsTimedState(), 100_000, TRACE.slice(0, 2)),
    );
    expect(pausedAtC).toEqual(directAtC);

    const direct = requireReady(advance(document, directAtC.state, 160_000, [TRACE[2]!]));
    const resumed = resumeElectronicsTimedState(pauseElectronicsTimedState(pausedAtC.state));
    const afterPause = requireReady(advance(document, resumed, 160_000, [TRACE[2]!]));

    expect(afterPause).toEqual(direct);
  });

  it('reset starts an isolated replay segment with no retained input or runtime continuation', () => {
    const document = runtimeFixture();
    const oldSegment = requireReady(
      advance(document, resetElectronicsTimedState(), 160_000, SEGMENT_A),
    );
    const oldContinuation = continuation(oldSegment.state);
    expect(oldContinuation.inputs).toHaveLength(2);
    expect(oldContinuation.boards.length).toBeGreaterThan(0);

    const reset = resetElectronicsTimedState();
    expect(reset).toEqual({ version: 1, lifecycle: 'running', continuation: null });

    const replayed = requireReady(advance(document, reset, 160_000, TRACE));
    const fresh = requireReady(advance(document, resetElectronicsTimedState(), 160_000, TRACE));
    expect(replayed).toEqual(fresh);
    expect(replayed.state).not.toEqual(oldSegment.state);

    const next = continuation(replayed.state);
    expect(next.inputs).toEqual([
      { atMicroseconds: 50_000, componentId: 'two', property: 'state', value: true },
      { atMicroseconds: 50_000, componentId: 'one', property: 'state', value: true },
      { atMicroseconds: 125_000, componentId: 'one', property: 'state', value: false },
    ]);
    expect(next.inputs).not.toContainEqual({
      atMicroseconds: 40_000,
      componentId: 'one',
      property: 'state',
      value: true,
    });
  });

  it('rejects a stale horizon without rewinding or replacing authoritative state', () => {
    const document = runtimeFixture();
    const committed = requireReady(advance(document, resetElectronicsTimedState(), 160_000, TRACE));
    const stale = advance(document, committed.state, 150_000);

    expect(stale).toMatchObject({
      executionStatus: 'fault',
      requestedHorizonMicroseconds: 150_000,
      committedHorizonMicroseconds: 160_000,
      state: committed.state,
      observation: null,
      diagnostics: [{ code: 'invalid_clock_continuation' }],
    });
    expect(stale.state).toEqual(committed.state);
  });

  it('accepts the equal-horizon boundary without treating it as stale rewind', () => {
    const document = runtimeFixture();
    const committed = requireReady(advance(document, resetElectronicsTimedState(), 160_000, TRACE));
    const same = requireReady(advance(document, committed.state, 160_000));

    expect(same.committedHorizonMicroseconds).toBe(160_000);
    expect(same.state).toEqual(committed.state);
    expect(same.observation).toEqual(committed.observation);
    expect(same.diagnostics).toEqual(committed.diagnostics);
  });

  it('rejects retroactive input at the committed horizon and keeps prior state authoritative', () => {
    const document = runtimeFixture();
    const committed = requireReady(advance(document, resetElectronicsTimedState(), 160_000, TRACE));
    const retroactive: ElectronicsTimedInputEvent = {
      atMicroseconds: 160_000,
      targetId: 'two',
      operation: 'state',
      payload: false,
    };
    const fault = advance(document, committed.state, 200_000, [retroactive]);

    expect(fault).toMatchObject({
      executionStatus: 'fault',
      committedHorizonMicroseconds: 160_000,
      state: committed.state,
      observation: null,
      diagnostics: [{ code: 'retroactive_input' }],
    });
    expect(fault.state).toEqual(committed.state);
  });

  it('accepts a future input after the committed horizon and appends it exactly once', () => {
    const document = runtimeFixture();
    const committed = requireReady(advance(document, resetElectronicsTimedState(), 160_000, TRACE));
    const future: ElectronicsTimedInputEvent = {
      atMicroseconds: 175_000,
      targetId: 'two',
      operation: 'state',
      payload: false,
    };
    const advanced = requireReady(advance(document, committed.state, 200_000, [future]));
    const next = continuation(advanced.state);

    expect(advanced.committedHorizonMicroseconds).toBe(200_000);
    expect(next.inputs).toHaveLength(4);
    expect(next.inputs.at(-1)).toEqual({
      atMicroseconds: 175_000,
      componentId: 'two',
      property: 'state',
      value: false,
    });
    expect(next.nextInputIndex).toBe(4);
  });

  it('preserves deliberately non-lexicographic same-time canonical order', () => {
    const sameTimeTargets = TRACE.filter((event) => event.atMicroseconds === 50_000).map(
      (event) => event.targetId,
    );
    expect(sameTimeTargets).toEqual(['two', 'one']);
    expect([...sameTimeTargets].sort()).not.toEqual(sameTimeTargets);

    const document = runtimeFixture();
    const result = requireReady(advance(document, resetElectronicsTimedState(), 160_000, TRACE));
    expect(
      continuation(result.state)
        .inputs.slice(0, 2)
        .map((event) => event.componentId),
    ).toEqual(['two', 'one']);
  });
});
