import { describe, expect, it } from 'vitest';
import mixedFixture from './fixtures/mixed-servo-observation.json';
import {
  advanceElectronicsToHorizon,
  resetElectronicsTimedState,
  type ElectronicsTimedState,
} from '../engine';
import { parseElectronicsDocument, type ElectronicsDocument } from '../domain/document';
import { arduinoSnapshotFromState } from '../domain/arduino-model';
import type { ArduinoRuntimeState } from '../domain/arduino-program-runtime';
import type { ServoMotorRuntimeState } from '../domain/models/servo-runtime';
import { solveRcCircuitWithHeldArduino } from '../domain/solver';

function document(input: unknown = mixedFixture): ElectronicsDocument {
  const parsed = parseElectronicsDocument(input);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function through(
  doc: ElectronicsDocument,
  horizon: number,
  previous?: ElectronicsTimedState,
  maxEvents = 1024,
) {
  let state = previous ?? resetElectronicsTimedState();
  for (let attempt = 0; attempt < 10000; attempt++) {
    const next = advanceElectronicsToHorizon(doc, {
      state,
      requestedHorizonMicroseconds: horizon,
      maxEvents,
    });
    if (next.executionStatus === 'fault') throw new Error(JSON.stringify(next.diagnostics));
    if (next.executionStatus === 'ready') return next;
    state = JSON.parse(JSON.stringify(next.state)) as ElectronicsTimedState;
  }
  throw new Error('Mixed Servo did not reach its requested horizon.');
}

function decoded(state: ElectronicsTimedState) {
  return JSON.parse(state.continuation!.serializedState) as {
    boards: { componentId: string; runtime: ArduinoRuntimeState }[];
    servoMotors: { componentId: string; runtime: ServoMotorRuntimeState }[];
  };
}

function directServo() {
  const original = document();
  const ids = new Set(['uno', 'servo']);
  return document({
    ...original,
    components: original.components.filter((c) => ids.has(c.id)),
    connections: original.connections.filter(
      (w) => ids.has(w.from.componentId) && ids.has(w.to.componentId),
    ),
  });
}

function heldContext() {
  const doc = directServo();
  const frame = through(doc, 26000);
  const state = decoded(frame.state);
  return {
    doc,
    snapshots: new Map(
      state.boards.map((board) => [board.componentId, arduinoSnapshotFromState(board.runtime)]),
    ),
    servoStates: new Map(state.servoMotors.map((motor) => [motor.componentId, motor.runtime])),
  };
}

describe('decoded Servo pose through transient observation boundaries', () => {
  it('observes the decoded pulse, not the current Servo.write target, in the real mixed circuit', () => {
    const doc = document();
    const observed = [];
    for (const horizon of [0, 1000, 10000, 26000, 51000, 100000]) {
      const frame = through(doc, horizon);
      expect(frame.state.continuation!.clockProfileId).toBe('electrothermal-v1');
      const motor = decoded(frame.state).servoMotors.find(
        (entry) => entry.componentId === 'servo',
      )!;
      const servo = frame.observation.components.find((entry) => entry.componentId === 'servo')!;
      expect(frame.observation.solved).toBe(true);
      expect(frame.observation.quality).toMatchObject({ finite: true, passed: true });
      expect(servo.servoAngleDegrees).toBe(motor.runtime.angleDegrees);
      expect(servo.terminalVoltages).toMatchObject({ vcc: 5, gnd: 0 });
      observed.push(servo.servoAngleDegrees);
      if (horizon === 1000) {
        expect(motor.runtime.lastValidPulseWidthMicroseconds).toBeUndefined();
        expect(servo.servoAngleDegrees).toBe(90);
      }
    }
    expect(observed).toContain(45);
    expect(observed).toContain(135);
  });

  it('preserves full state and observations through JSON, yields and UI horizon partitions', () => {
    const doc = document();
    const reference = through(doc, 30000);
    expect(through(doc, 30000, undefined, 1)).toEqual(reference);
    let state: ElectronicsTimedState | undefined;
    let partitioned = reference;
    for (const horizon of [0, 1000, 10000, 26000, 30000]) {
      partitioned = through(doc, horizon, state, 3);
      state = JSON.parse(JSON.stringify(partitioned.state)) as ElectronicsTimedState;
    }
    expect(partitioned).toEqual(reference);
    expect(through(doc, 30000)).toEqual(reference);
  });

  it('keeps direct DC Servo observation unchanged while forwarding zero-time and ordinary transient frames', () => {
    const context = heldContext();
    expect(context.servoStates.get('servo')?.angleDegrees).toBe(135);
    const initial = solveRcCircuitWithHeldArduino(
      context.doc,
      0,
      context.snapshots,
      undefined,
      undefined,
      undefined,
      context.servoStates,
    );
    const ordinary = solveRcCircuitWithHeldArduino(
      context.doc,
      1,
      context.snapshots,
      initial.transientState,
      undefined,
      undefined,
      context.servoStates,
    );
    for (const frame of [initial, ordinary]) {
      expect(frame.solved).toBe(true);
      expect(
        frame.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
      ).toBe(135);
    }
    expect(initial.transientAnalysis?.acceptedSteps).toBe(0);
    expect(ordinary.transientAnalysis!.acceptedSteps).toBeGreaterThan(0);
    expect(through(context.doc, 26000).state.continuation!.clockProfileId).toBe('dc-inputs-v1');
  });

  it('retains decoded pose through real RC rejection, full and adaptive half steps', () => {
    const context = heldContext();
    const doc = document({
      ...context.doc,
      components: [
        ...context.doc.components,
        { id: 'r', kind: 'resistor', value: 100, position: { x: 0, y: 0 } },
        {
          id: 'c',
          kind: 'visual',
          componentTypeId: 'electrolytic-capacitor',
          value: 1,
          position: { x: 0, y: 0 },
          pinIds: ['positive', 'negative'],
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      connections: [
        ...context.doc.connections,
        {
          id: 'rc1',
          from: { componentId: 'uno', terminal: 'power-5v' },
          to: { componentId: 'r', terminal: 'a' },
        },
        {
          id: 'rc2',
          from: { componentId: 'r', terminal: 'b' },
          to: { componentId: 'c', terminal: 'positive' },
        },
        {
          id: 'rc3',
          from: { componentId: 'c', terminal: 'negative' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    const initial = solveRcCircuitWithHeldArduino(
      doc,
      0,
      context.snapshots,
      undefined,
      undefined,
      undefined,
      context.servoStates,
    );
    const frame = solveRcCircuitWithHeldArduino(
      doc,
      1,
      context.snapshots,
      initial.transientState,
      undefined,
      undefined,
      context.servoStates,
    );
    expect(frame.solved).toBe(true);
    expect(frame.transientAnalysis!.rejectedSteps).toBeGreaterThan(0);
    expect(frame.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees).toBe(
      135,
    );
    expect(frame.components.find((entry) => entry.componentId === 'c')!.voltageDrop).toBeCloseTo(
      5 * (1 - Math.exp(-10)),
      1,
    );
  });

  it('retains decoded pose after an actual thermal failure and circuit resampling', () => {
    const context = heldContext();
    const doc = document({
      ...context.doc,
      components: [
        ...context.doc.components,
        {
          id: 'hot-source',
          kind: 'source',
          value: 12,
          position: { x: 0, y: 0 },
          stateProperties: { internalResistanceOhm: 0.01, maxContinuousCurrentAmp: 1000 },
        },
        {
          id: 'hot-r',
          kind: 'resistor',
          value: 1,
          position: { x: 0, y: 0 },
          stateProperties: { powerRatingWatt: 0.25 },
        },
      ],
      connections: [
        ...context.doc.connections,
        {
          id: 'h1',
          from: { componentId: 'hot-source', terminal: 'a' },
          to: { componentId: 'hot-r', terminal: 'a' },
        },
        {
          id: 'h2',
          from: { componentId: 'hot-r', terminal: 'b' },
          to: { componentId: 'hot-source', terminal: 'b' },
        },
      ],
    });
    const frame = solveRcCircuitWithHeldArduino(
      doc,
      1000,
      context.snapshots,
      undefined,
      undefined,
      undefined,
      context.servoStates,
    );
    expect(frame.solved).toBe(true);
    expect(frame.components.find((entry) => entry.componentId === 'hot-r')?.damageState).toBe(
      'failed',
    );
    expect(frame.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees).toBe(
      135,
    );
  });

  it('preserves pose when the transient work limit returns an unfinished result', () => {
    const context = heldContext();
    const fallback = solveRcCircuitWithHeldArduino(
      context.doc,
      10000000,
      context.snapshots,
      undefined,
      undefined,
      undefined,
      context.servoStates,
    );
    expect(fallback.solved).toBe(false);
    expect(fallback.diagnostics.some((entry) => entry.code === 'numerical_instability')).toBe(true);
    expect(
      fallback.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
    ).toBe(135);
  });
});
