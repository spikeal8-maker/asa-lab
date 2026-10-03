import type { SolveResult } from '../api';
import type {
  ElectronicsSimulationWorkerResponse,
  SimulationTimedAdvancePayload,
} from './simulation-worker-protocol';

type ProtocolFailureCode = Extract<ElectronicsSimulationWorkerResponse, { ok: false }>['code'];

export type SimulationWorkerErrorCode =
  | ProtocolFailureCode
  | 'worker-start'
  | 'worker-runtime'
  | 'worker-message'
  | 'worker-post'
  | 'worker-timeout'
  | 'invalid-response'
  | 'stale-response'
  | 'cancelled';

export class SimulationWorkerError extends Error {
  constructor(
    readonly code: SimulationWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SimulationWorkerError';
  }
}

export type SimulationFailureCategory =
  'unsupported' | 'nonconvergent' | 'electrical' | 'physical' | 'runtime' | 'technical';

export class SimulationFailure extends Error {
  constructor(
    readonly category: SimulationFailureCategory,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SimulationFailure';
  }
}

export interface SimulationStatusMessage {
  readonly category: SimulationFailureCategory | 'circuit-state';
  readonly code: string;
  readonly text: string;
}

/** Preflight is diagnostic only: passive no-source circuits still reach a ready frame. */
export function preflightFailure(result: SolveResult): SimulationFailure | null {
  if (result.status !== 'unsupported' && result.status !== 'nonconvergent') return null;
  const diagnostic = result.diagnostics.find((entry) => entry.severity === 'error');
  return new SimulationFailure(
    result.status,
    diagnostic?.code ?? result.status,
    diagnostic?.message ?? 'Расчёт схемы не дал достоверного результата.',
  );
}

export function timedAdvanceFailure(advance: SimulationTimedAdvancePayload): SimulationFailure {
  const diagnostic = advance.diagnostics[0];
  const code = diagnostic?.code ?? 'timed_advance_failed';
  const category: SimulationFailureCategory =
    code === 'physical_advance_failed'
      ? 'physical'
      : code === 'electrical_sample_failed' || code === 'electrical_quality_failed'
        ? 'electrical'
        : code === 'clocked_profile_unsupported'
          ? 'unsupported'
          : code === 'arduino_execution_failed'
            ? 'runtime'
            : 'technical';
  return new SimulationFailure(
    category,
    code,
    diagnostic?.message || 'Не удалось завершить шаг моделирования.',
  );
}

export function workerFailure(reason: unknown): SimulationFailure {
  if (reason instanceof SimulationFailure) return reason;
  if (reason instanceof SimulationWorkerError)
    return new SimulationFailure('technical', reason.code, reason.message);
  return new SimulationFailure(
    'technical',
    'worker-failure',
    reason instanceof Error ? reason.message : 'Вычислительный модуль остановился.',
  );
}

function technicalFailureText(code: string): string {
  switch (code) {
    case 'worker-timeout':
      return 'Вычислительный модуль не ответил вовремя. Запустите моделирование снова.';
    case 'protocol-mismatch':
    case 'solver-mismatch':
      return 'Версия вычислительного модуля не совпадает. Попробуйте запустить снова.';
    case 'worker-start':
      return 'Не удалось запустить вычислительный модуль. Запустите моделирование снова.';
    case 'worker-post':
      return 'Не удалось отправить запрос вычислительному модулю. Запустите моделирование снова.';
    case 'worker-runtime':
      return 'Ошибка работы вычислительного модуля. Запустите моделирование снова.';
    case 'internal':
      return 'Внутренняя ошибка вычислительного модуля. Запустите моделирование снова.';
    case 'worker-message':
    case 'invalid-response':
      return 'Не удалось прочитать ответ вычислительного модуля. Запустите моделирование снова.';
    case 'invalid-request':
      return 'Вычислительный модуль отклонил запрос. Запустите моделирование снова.';
    default:
      return 'Технический сбой вычислительного модуля. Запустите моделирование снова.';
  }
}

export function simulationFailureMessage(failure: SimulationFailure): SimulationStatusMessage {
  const detail = failure.message.trim();
  const text =
    failure.category === 'unsupported'
      ? `Моделирование не поддерживается: ${detail}`
      : failure.category === 'nonconvergent'
        ? `Численная проверка схемы не прошла: ${detail}`
        : failure.category === 'electrical'
          ? `Электрический расчёт остановлен: ${detail}`
          : failure.category === 'physical'
            ? `Переходный расчёт остановлен: ${detail}`
            : failure.category === 'runtime'
              ? `Исполнение программы остановлено: ${detail}`
              : technicalFailureText(failure.code);
  return { category: failure.category, code: failure.code, text };
}

export function circuitStateMessage(result: SolveResult): SimulationStatusMessage | null {
  if (result.solved || result.status !== 'invalid') return null;
  const diagnostic = result.diagnostics.find((entry) => entry.severity === 'error');
  if (!diagnostic) return null;
  return { category: 'circuit-state', code: diagnostic.code, text: diagnostic.message };
}
