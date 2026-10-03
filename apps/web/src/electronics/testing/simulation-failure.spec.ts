import { describe, expect, it } from 'vitest';
import type { SolveResult } from '../../api';
import {
  circuitStateMessage,
  simulationFailureMessage,
  timedAdvanceFailure,
  SimulationFailure,
} from '../simulation-failure';
import type { SimulationTimedAdvancePayload } from '../simulation-worker-protocol';
import { resetElectronicsTimedState } from '@asa-lab/electronics/engine';

const noSource: SolveResult = {
  solved: false,
  status: 'invalid',
  current: 0,
  components: [],
  nodes: [],
  diagnostics: [
    { code: 'no_source', severity: 'error', message: 'В схеме нет источника напряжения.' },
  ],
  iterations: 0,
  numericalResidual: 0,
  numericalTolerance: 0,
};

function fault(code: string, message: string): SimulationTimedAdvancePayload {
  return {
    executionStatus: 'fault',
    requestedHorizonMicroseconds: 100_000,
    committedHorizonMicroseconds: 0,
    state: resetElectronicsTimedState(),
    result: null,
    serial: [],
    diagnostics: [{ code, message }],
  };
}

describe('simulation failure presentation', () => {
  it('keeps a supported unpowered circuit in circuit state rather than a Worker failure', () => {
    expect(circuitStateMessage(noSource)).toEqual({
      category: 'circuit-state',
      code: 'no_source',
      text: 'В схеме нет источника напряжения.',
    });
  });

  it.each([
    ['electrical_sample_failed', 'electrical'],
    ['electrical_quality_failed', 'electrical'],
    ['physical_advance_failed', 'physical'],
    ['arduino_execution_failed', 'runtime'],
    ['clocked_profile_unsupported', 'unsupported'],
  ] as const)('keeps %s in its distinct fault class', (code, category) => {
    const failure = timedAdvanceFailure(fault(code, 'Specific diagnostic.'));
    expect(failure).toMatchObject({ code, category, message: 'Specific diagnostic.' });
    expect(simulationFailureMessage(failure)).toMatchObject({ code, category });
  });

  it('uses technical wording only for a technical timeout', () => {
    const message = simulationFailureMessage(
      new SimulationFailure('technical', 'worker-timeout', 'Timed out after 30000 ms.'),
    );
    expect(message).toMatchObject({ category: 'technical', code: 'worker-timeout' });
    expect(message.text).toContain('не ответил вовремя');
  });
});
