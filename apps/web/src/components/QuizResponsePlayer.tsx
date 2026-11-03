import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, type LearningQuizAttempt, type QuizAnswer } from '../api';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { QuizQuestionFields } from './QuizQuestionFields';
import './quiz-learning.css';

type Recovery = { attemptId: string; version: number; answers: Record<string, QuizAnswer> };
const recovery = new Map<string, Recovery>();

export function QuizResponsePlayer({
  activityRunId,
  onChanged,
  onRegisterLeaveGuard,
}: {
  readonly activityRunId: string;
  readonly onChanged: () => Promise<void>;
  readonly onRegisterLeaveGuard?: (id: string, guard: (() => boolean) | null) => void;
}): JSX.Element {
  const continuity = useSyncExternalStore(
    subscribeTelemetry,
    () => telemetryContext().continuity,
    () => 0,
  );
  const scope = `${continuity}:${activityRunId}`;
  const [response, setResponse] = useState<{
    participationId: string;
    attempt: LearningQuizAttempt | null;
    title: string;
    instructions: string | null;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [unsent, setUnsent] = useState<Recovery | null>(null);
  const session = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expiryRetry, setExpiryRetry] = useState(0);
  const [expiryRetryReady, setExpiryRetryReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const clock = useRef({ server: Date.now(), local: Date.now() });
  const live = useRef(false);
  const operation = useRef<number | null>(null);
  const current = useRef({ response, answers, conflict });
  current.current = { response, answers, conflict };
  const callbacks = useRef({ onChanged, onRegisterLeaveGuard });
  callbacks.current = { onChanged, onRegisterLeaveGuard };
  const startRequest = useRef(crypto.randomUUID());
  const submitRequest = useRef<{ version: number; id: string } | null>(null);
  function adoptAttempt(next: LearningQuizAttempt, restoreEditableDraft = false) {
    const local = recovery.get(scope);
    const open = ['created', 'in_progress', 'working', 'active'].includes(next.state);
    const sameAttempt = local?.attemptId === next.attemptId;
    const sameAnswers = local && JSON.stringify(local.answers) === JSON.stringify(next.answers);
    clock.current = { server: Date.parse(next.serverNow), local: Date.now() };
    setResponse((previous) => (previous ? { ...previous, attempt: next } : previous));
    if (restoreEditableDraft && open && local && sameAttempt) {
      setAnswers(local.answers);
      setUnsent(null);
      if (local.version !== next.version && !sameAnswers) {
        setConflict(true);
        setError(
          'Попытка изменена в другом окне. Несохранённые ответы сохранены ниже; сначала загрузите актуальную версию.',
        );
      }
      return;
    }
    // Every terminal adoption renders the immutable server answers. A failed-save
    // draft stays separately recoverable, never inside the official submission.
    setAnswers(next.answers);
    if (local && (!sameAttempt || !sameAnswers)) setUnsent(local);
    else {
      recovery.delete(scope);
      setUnsent(null);
    }
    if (!open) {
      setConflict(false);
      setError(null);
    }
  }
  useEffect(() => {
    const generation = ++session.current;
    let active = true;
    live.current = true;
    operation.current = null;
    setBusy(false);
    setResponse(null);
    setError(null);
    setConflict(false);
    setUnsent(null);
    startRequest.current = crypto.randomUUID();
    submitRequest.current = null;
    void api
      .readQuizLearning(activityRunId)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setResponse(result.data);
        const attempt = result.data.attempt;
        if (attempt) adoptAttempt(attempt, true);
        else setAnswers({});
      })
      .catch(() => {
        if (active) setError('Не удалось открыть тест. Повторите загрузку.');
      });
    return () => {
      active = false;
      if (session.current === generation) {
        live.current = false;
        session.current++;
      }
    };
  }, [activityRunId, scope, retry]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const attempt = response?.attempt;
  const serverNow = clock.current.server + (now - clock.current.local);
  const expired = !!attempt?.expiresAt && serverNow >= Date.parse(attempt.expiresAt);
  const editable =
    !!attempt &&
    ['created', 'in_progress', 'working', 'active'].includes(attempt.state) &&
    !expired &&
    !conflict;
  const dirty = !!attempt && JSON.stringify(answers) !== JSON.stringify(attempt.answers);
  useEffect(() => {
    const guard = () =>
      operation.current === null &&
      (!recovery.has(scope) ||
        window.confirm('Ответы ещё не сохранены. Выйти? Ответы останутся в этой учебной сессии.'));
    callbacks.current.onRegisterLeaveGuard?.(activityRunId, guard);
    const warn = (event: BeforeUnloadEvent) => {
      if (operation.current !== null || recovery.has(scope)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      callbacks.current.onRegisterLeaveGuard?.(activityRunId, null);
      window.removeEventListener('beforeunload', warn);
    };
  }, [activityRunId, scope]);

  async function perform(kind: 'start' | 'save' | 'submit') {
    if (operation.current !== null) return;
    const generation = session.current;
    const isCurrent = () => live.current && session.current === generation;
    const state = current.current;
    if (!state.response || state.conflict) return;
    operation.current = generation;
    setBusy(true);
    setError(null);
    try {
      let savedAttempt = state.response.attempt;
      if (kind === 'start') {
        if (
          recovery.has(scope) &&
          !window.confirm(
            'Начать новую попытку? Несохранённые ответы предыдущего редактирования останутся отдельно для копирования.',
          )
        )
          return;
        const result = await api.startQuizLearning(
          state.response.participationId,
          startRequest.current,
        );
        if (!result.ok) throw new Error(result.error.message);
        if (!isCurrent()) return;
        savedAttempt = result.data.attempt;
        adoptAttempt(savedAttempt);
        startRequest.current = crypto.randomUUID();
        await callbacks.current.onChanged();
        return;
      }
      if (!savedAttempt || !editable) return;
      if (JSON.stringify(state.answers) !== JSON.stringify(savedAttempt.answers)) {
        const result = await api.saveQuizAnswers(
          savedAttempt.attemptId,
          savedAttempt.version,
          state.answers,
        );
        if (!result.ok) {
          if (isCurrent() && result.error.code?.includes('conflict')) setConflict(true);
          throw new Error(result.error.message);
        }
        savedAttempt = {
          ...savedAttempt,
          answers: state.answers,
          version: result.data.version,
          lastSavedAt: result.data.savedAt,
          expiresAt: result.data.expiresAt,
        };
        if (!isCurrent()) return;
        setResponse((previous) => (previous ? { ...previous, attempt: savedAttempt } : previous));
        if (JSON.stringify(current.current.answers) === JSON.stringify(state.answers))
          recovery.delete(scope);
        else
          recovery.set(scope, {
            attemptId: savedAttempt.attemptId,
            version: savedAttempt.version,
            answers: current.current.answers,
          });
      }
      if (kind === 'submit') {
        // Submit only the exact server-confirmed revision; never submit later local edits.
        if (JSON.stringify(current.current.answers) !== JSON.stringify(savedAttempt.answers))
          throw new Error('Ответы изменились во время сохранения. Сохраните их перед сдачей.');
        if (submitRequest.current?.version !== savedAttempt.version)
          submitRequest.current = { version: savedAttempt.version, id: crypto.randomUUID() };
        const result = await api.submitQuizAttempt(
          savedAttempt.attemptId,
          savedAttempt.version,
          submitRequest.current.id,
        );
        if (!result.ok) throw new Error(result.error.message);
        if (!isCurrent()) return;
        adoptAttempt(result.data.attempt);
        await callbacks.current.onChanged();
      }
    } catch (problem) {
      if (isCurrent())
        setError(
          problem instanceof Error
            ? problem.message
            : 'Не удалось сохранить тест. Повторите действие.',
        );
    } finally {
      if (operation.current === generation) operation.current = null;
      if (isCurrent()) setBusy(false);
    }
  }
  const performRef = useRef(perform);
  performRef.current = perform;
  useEffect(() => {
    if (!dirty || !editable || busy || error) return;
    const timer = setTimeout(() => void performRef.current('save'), 700);
    return () => clearTimeout(timer);
  }, [answers, dirty, editable, busy, error]);
  const adoptAttemptRef = useRef(adoptAttempt);
  adoptAttemptRef.current = adoptAttempt;
  const expiryAttemptId = attempt?.attemptId;
  const expiryAttemptState = attempt?.state;
  // Serial bounded reads: a transient failure must not strand the expired player.
  // Only the server can finalize the Attempt; retries never submit or grade locally.
  useEffect(() => {
    setExpiryRetryReady(false);
    if (
      !expired ||
      !expiryAttemptId ||
      !expiryAttemptState ||
      !['created', 'in_progress', 'working', 'active'].includes(expiryAttemptState)
    )
      return;
    const generation = session.current;
    let cancelled = false;
    let reads = 0;
    let timer: ReturnType<typeof setTimeout>;
    const delays = [1500, 3000, 6000, 10000];
    const isCurrent = () => !cancelled && live.current && session.current === generation;
    const poll = async () => {
      if (!isCurrent()) return;
      reads++;
      try {
        const result = await api.readQuizAttempt(expiryAttemptId);
        if (!isCurrent()) return;
        if (result.ok) {
          adoptAttemptRef.current(result.data.attempt);
          if (!['created', 'in_progress', 'working', 'active'].includes(result.data.attempt.state))
            return;
        }
      } catch {
        // Network rejection and HTTP errors use the same bounded retry schedule.
      }
      if (!isCurrent()) return;
      if (reads < delays.length) timer = setTimeout(() => void poll(), delays[reads]!);
      else setExpiryRetryReady(true);
    };
    timer = setTimeout(() => void poll(), delays[0]!);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expired, expiryAttemptId, expiryAttemptState, scope, expiryRetry]);
  return (
    <section className="quiz-player" aria-label="Прохождение теста">
      {error ? <p role="alert">{error}</p> : null}
      {expiryRetryReady ? (
        <div role="status">
          <p>Окончательный статус ещё не получен.</p>
          <button type="button" onClick={() => setExpiryRetry((value) => value + 1)}>
            Повторить получение итога
          </button>
        </div>
      ) : null}
      {unsent ? (
        <details>
          <summary>Несохранённые ответы предыдущего редактирования</summary>
          <p>Официальная сдача показана ниже. Эти ответы её не изменяют.</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {JSON.stringify(unsent.answers, null, 2)}
          </pre>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Удалить несохранённые ответы?')) {
                recovery.delete(scope);
                setUnsent(null);
              }
            }}
          >
            Удалить несохранённые ответы
          </button>
        </details>
      ) : null}
      {!response ? (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Повторить загрузку теста
        </button>
      ) : (
        <>
          {response.instructions ? <p>{response.instructions}</p> : null}
          {!attempt ? (
            <button type="button" disabled={busy} onClick={() => void perform('start')}>
              Начать тест
            </button>
          ) : (
            <>
              {attempt.expiresAt ? (
                <p role="timer">
                  {expired
                    ? 'Время истекло. Ожидаем серверный итог.'
                    : `Осталось: ${Math.max(0, Math.ceil((Date.parse(attempt.expiresAt) - serverNow) / 1000))} с`}
                </p>
              ) : null}
              {(attempt.questionOrder ?? attempt.questions.map((question) => question.id)).map(
                (id, index) => {
                  const question = attempt.questions.find((item) => item.id === id);
                  const feedback = attempt.feedback?.find((item) => item.questionVersionId === id);
                  return question ? (
                    <fieldset key={id} disabled={!editable || busy}>
                      <legend>
                        {index + 1}.{' '}
                        {question.promptBlocks.map((block) => block.text ?? '').join('\n')}
                      </legend>
                      <small>
                        Максимум {question.maxPoints} балл(а)
                        {question.type === 'long_text_manual' ? ' · проверяет преподаватель' : ''}
                      </small>
                      <QuizQuestionFields
                        question={question}
                        answer={answers[id]}
                        disabled={!editable || busy}
                        onChange={(answer) =>
                          setAnswers((previous) => {
                            const next = { ...previous, [id]: answer };
                            recovery.set(scope, {
                              attemptId: attempt.attemptId,
                              version: attempt.version,
                              answers: next,
                            });
                            return next;
                          })
                        }
                      />
                      {feedback ? (
                        <p data-testid="quiz-question-feedback">
                          {feedback.manualPending
                            ? 'Ожидает проверки'
                            : feedback.correct === null
                              ? question.type === 'long_text_manual' &&
                                attempt.result &&
                                !attempt.result.provisional
                                ? 'Проверено преподавателем'
                                : 'Ожидает проверки'
                              : feedback.correct
                                ? 'Верно'
                                : 'Неверно'}
                          {feedback.points !== null
                            ? ` · ${feedback.points} из ${feedback.maxPoints} балл(а)`
                            : ''}
                        </p>
                      ) : null}
                    </fieldset>
                  ) : null;
                },
              )}
              <p role="status">
                {busy
                  ? 'Сохраняем…'
                  : dirty
                    ? 'Есть несохранённые ответы'
                    : attempt.lastSavedAt
                      ? 'Ответы сохранены'
                      : 'Ответы пока не сохранены'}
              </p>
              {conflict ? (
                <>
                  <p>Ваши ответы до конфликта</p>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {JSON.stringify(answers, null, 2)}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Загрузить актуальную версию? Сначала скопируйте нужные несохранённые ответы.',
                        )
                      ) {
                        recovery.delete(scope);
                        setRetry((value) => value + 1);
                      }
                    }}
                  >
                    Загрузить актуальную версию
                  </button>
                </>
              ) : null}
              {editable ? (
                <div className="quiz-actions">
                  <button
                    type="button"
                    disabled={busy || !dirty}
                    onClick={() => void perform('save')}
                  >
                    Сохранить ответы
                  </button>
                  <button type="button" disabled={busy} onClick={() => void perform('submit')}>
                    Сдать тест
                  </button>
                </div>
              ) : (
                <div>
                  <p>
                    {conflict
                      ? 'Сохранение остановлено до разрешения конфликта'
                      : expired && attempt.state === 'in_progress'
                        ? 'Ожидаем серверное завершение'
                        : attempt.state === 'submitted' || attempt.state === 'evaluating'
                          ? 'Тест сдан'
                          : 'Попытка завершена'}
                  </p>
                  {!conflict &&
                  !['in_progress', 'submitted', 'evaluating'].includes(attempt.state) ? (
                    <button type="button" disabled={busy} onClick={() => void perform('start')}>
                      Новая попытка
                    </button>
                  ) : null}
                </div>
              )}
              {attempt.result ? (
                <p>
                  {attempt.result.provisional
                    ? 'Предварительный результат, ожидает проверки преподавателем'
                    : 'Результат'}
                  :{' '}
                  {attempt.result.points === null
                    ? 'баллы пока скрыты'
                    : `${attempt.result.points} из ${attempt.result.maxPoints}`}
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
