import { describe, expect, it } from 'vitest';
import type { SolveResult } from '../../api';
import {
  circuitStateMessage,
  preflightFailure,
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
  it('does not show a banner for a passive unpowered circuit', () => {
    expect(circuitStateMessage(noSource)).toBeNull();
  });

  it('still displays other circuit errors after a no-source diagnostic', () => {
    const short = { code: 'short_circuit', severity: 'error', message: 'Short circuit.' } as const;
    expect(
      circuitStateMessage({ ...noSource, diagnostics: [...noSource.diagnostics, short] }),
    ).toEqual({ category: 'circuit-state', code: 'short_circuit', text: 'Short circuit.' });
  });

  it('shows the L298N power warning even when the circuit was solved', () => {
    const diagnostic = {
      code: 'l298n_logic_supply',
      severity: 'warning',
      message: 'L298N: снимите 5V_EN, подайте внешние 5 В на +5V и соедините GND.',
    } as const;
    const solved: SolveResult = {
      ...noSource,
      solved: true,
      status: 'solved',
      diagnostics: [diagnostic],
    };
    const firstMessage = circuitStateMessage(solved);
    expect(firstMessage).toEqual({
      category: 'circuit-state',
      code: diagnostic.code,
      text: diagnostic.message,
    });
    expect(circuitStateMessage({ ...solved, diagnostics: [{ ...diagnostic }] }, firstMessage)).toBe(
      firstMessage,
    );
    expect(
      circuitStateMessage({
        ...solved,
        diagnostics: [{ ...diagnostic, code: 'led_near_limit' }],
      }),
    ).toBeNull();
  });

  it('shows the exact L298N wiring instruction from preflight', () => {
    const message = 'L298N: проверьте нагрузку канала. Ток превышает 2 А.';
    const failure = preflightFailure({
      ...noSource,
      status: 'unsupported',
      diagnostics: [{ code: 'unsupported_topology', severity: 'error', message }],
    })!;
    expect(simulationFailureMessage(failure)).toEqual({
      category: 'unsupported',
      code: 'unsupported_topology',
      text: message,
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

  it.each([
    ['worker-start', 'Не удалось запустить вычислительный модуль'],
    ['worker-post', 'Не удалось отправить запрос вычислительному модулю'],
    ['worker-runtime', 'Ошибка работы вычислительного модуля'],
    ['internal', 'Внутренняя ошибка вычислительного модуля'],
    ['worker-message', 'Не удалось прочитать ответ вычислительного модуля'],
    ['invalid-response', 'Не удалось прочитать ответ вычислительного модуля'],
    ['invalid-request', 'Вычислительный модуль отклонил запрос'],
  ] as const)('shows a safe visible cause and retry for %s', (code, cause) => {
    const message = simulationFailureMessage(
      new SimulationFailure('technical', code, 'Private exception detail'),
    );
    expect(message).toMatchObject({ category: 'technical', code });
    expect(message.text).toContain(cause);
    expect(message.text).toContain('Запустите моделирование снова');
    expect(message.text).not.toContain('Private exception detail');
  });
});
