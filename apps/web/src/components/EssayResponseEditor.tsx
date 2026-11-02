import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, type EssayLearningResponse } from '../api';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { GrowingTextarea } from './GrowingTextarea';

type LocalDraft = { text: string; revision: number };
type RecoveryDraft = LocalDraft & { attemptId: string };
// Recovery of unsent text only. No browser persistence or academic state lives
// here; a fresh authorized server read is required before using an entry.
const localDrafts = new Map<string, LocalDraft>();
let draftContinuity = -1;

export function EssayResponseEditor({
  activityRunId,
  activityVersionId,
  onChanged,
  onRegisterLeaveGuard,
}: {
  readonly activityRunId: string;
  readonly activityVersionId: string;
  readonly onChanged: () => Promise<void>;
  readonly onRegisterLeaveGuard?: (id: string, guard: (() => boolean) | null) => void;
}): JSX.Element {
  const continuity = useSyncExternalStore(
    subscribeTelemetry,
    () => telemetryContext().continuity,
    () => 0,
  );
  const [response, setResponse] = useState<EssayLearningResponse | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<EssayLearningResponse | null>(null);
  const [recovery, setRecovery] = useState<RecoveryDraft | null>(null);
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const [retry, setRetry] = useState(0);
  const textRef = useRef(text);
  const responseRef = useRef(response);
  const expectedRevision = useRef(0);
  const operation = useRef(false);
  const operationToken = useRef(0);
  const scope = `${continuity}:${activityRunId}:${activityVersionId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const requests = useRef(new Map<string, string>());
  const callbacks = useRef({ onChanged, onRegisterLeaveGuard });
  callbacks.current = { onChanged, onRegisterLeaveGuard };
  textRef.current = text;
  responseRef.current = response;
  const active = () =>
    mounted.current &&
    currentScope.current === scope &&
    telemetryContext().continuity === continuity;
  const key = (attemptId: string) => `${continuity}:${activityRunId}:${attemptId}`;
  function remember(value: string, current = responseRef.current) {
    if (!active() || !current?.attempt) return;
    const context = telemetryContext();
    if (!context.ready || !context.actor) return;
    if (draftContinuity !== continuity) {
      localDrafts.clear();
      draftContinuity = continuity;
    }
    const cacheKey = key(current.attempt.id);
    if (value === current.attempt.text && expectedRevision.current === current.attempt.revision) {
      localDrafts.delete(cacheKey);
    } else {
      localDrafts.set(cacheKey, { text: value, revision: expectedRevision.current });
    }
  }
  const valid = (value: EssayLearningResponse) =>
    value.activityRunId === activityRunId && value.activityVersionId === activityVersionId;
  function apply(value: EssayLearningResponse, restoreLocal = false) {
    if (!active() || !valid(value)) return;
    const recovered = restoreLocal && value.attempt ? localDrafts.get(key(value.attempt.id)) : null;
    const differs = recovered && recovered.text !== value.attempt?.text;
    const cached =
      differs && value.canEdit && value.attempt?.state === 'in_progress' ? recovered : null;
    if (restoreLocal) {
      setRecovery(
        differs && !cached && value.attempt ? { ...recovered, attemptId: value.attempt.id } : null,
      );
    }
    if (recovered && !differs && value.attempt) localDrafts.delete(key(value.attempt.id));
    setResponse(value);
    responseRef.current = value;
    expectedRevision.current = cached?.revision ?? value.attempt?.revision ?? 0;
    const nextText = cached?.text ?? value.attempt?.text ?? '';
    setText(nextText);
    textRef.current = nextText;
    setConflict(cached && cached.revision !== value.attempt?.revision ? value : null);
  }
  useLayoutEffect(() => {
    mounted.current = true;
    operationToken.current += 1;
    operation.current = false;
    setBusy(false);
    let current = true;
    if (draftContinuity !== continuity) {
      localDrafts.clear();
      draftContinuity = continuity;
    }
    setResponse(null);
    responseRef.current = null;
    setText('');
    setRecovery(null);
    textRef.current = '';
    requests.current.clear();
    setError(null);
    void api
      .readEssayLearning(activityRunId)
      .then((result) => {
        if (!current || !active()) return;
        if (result.ok && valid(result.data)) apply(result.data, true);
        else setError(result.ok ? 'Получен ответ для другого задания.' : result.error.message);
      })
      .catch(() => {
        if (current && active()) setError('Не удалось загрузить ответ. Повторите загрузку.');
      });
    return () => {
      current = false;
      mounted.current = false;
    };
    // Each scope has its own component key; callbacks never reopen old sessions.
  }, [activityRunId, activityVersionId, continuity, retry]);

  const dirty = response?.attempt !== null && response !== null && text !== response.attempt.text;
  const leave = () => {
    if (operation.current) return false;
    const current = responseRef.current;
    if (recoveryRef.current) {
      if (
        !window.confirm(
          'Несохранённый текст предыдущего редактирования будет потерян. Выйти и удалить этот текст?',
        )
      )
        return false;
      localDrafts.delete(key(recoveryRef.current.attemptId));
      recoveryRef.current = null;
      setRecovery(null);
    }
    if (!current?.attempt || textRef.current === current.attempt.text) return true;
    return window.confirm(
      'Ответ ещё не сохранён. Выйти из задания? Текст останется в этой учебной сессии.',
    );
  };
  useEffect(() => {
    callbacks.current.onRegisterLeaveGuard?.(activityRunId, leave);
    const warn = (event: BeforeUnloadEvent) => {
      if (
        operation.current ||
        (responseRef.current?.attempt && textRef.current !== responseRef.current.attempt.text) ||
        recoveryRef.current !== null
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      callbacks.current.onRegisterLeaveGuard?.(activityRunId, null);
      window.removeEventListener('beforeunload', warn);
    };
  }, [activityRunId]);

  async function perform(kind: 'start' | 'save' | 'submit') {
    if (operation.current || !response || conflict) return;
    if (kind !== 'start' && (!response.attempt || !response.canEdit)) return;
    if (kind === 'submit' && !textRef.current.trim()) return;
    operation.current = true;
    const token = ++operationToken.current;
    setBusy(true);
    setError(null);
    async function send(step: 'start' | 'save' | 'submit') {
      const current = responseRef.current!;
      const attempt = current.attempt;
      const answer = textRef.current;
      const payload = JSON.stringify({
        step,
        activityRunId,
        attemptId: attempt?.id,
        revision: expectedRevision.current,
        text: step === 'save' ? answer : undefined,
      });
      let requestId = requests.current.get(payload);
      if (!requestId) {
        requestId = crypto.randomUUID();
        requests.current.set(payload, requestId);
      }
      const result =
        step === 'start'
          ? await api.startEssayLearning(activityRunId, requestId)
          : step === 'save'
            ? await api.saveEssayLearning(activityRunId, {
                requestId,
                attemptId: attempt!.id,
                expectedRevision: expectedRevision.current,
                text: answer,
              })
            : await api.submitEssayLearning(activityRunId, {
                requestId,
                attemptId: attempt!.id,
                expectedRevision: expectedRevision.current,
              });
      if (!active()) return false;
      if (!result.ok) {
        setError(
          result.error.code === 'draft_revision_conflict'
            ? 'Ответ изменён в другом окне. Ваш текст оставлен в редакторе.'
            : result.error.message,
        );
        if (result.error.code === 'draft_revision_conflict') {
          const latest = await api.readEssayLearning(activityRunId);
          if (active() && latest.ok && valid(latest.data)) setConflict(latest.data);
        }
        return false;
      }
      if (!valid(result.data)) {
        setError('Не удалось подтвердить точное задание. Ваш текст оставлен в редакторе.');
        return false;
      }
      if (attempt) localDrafts.delete(key(attempt.id));
      apply(result.data);
      requests.current.delete(payload);
      return true;
    }
    try {
      // Submit includes Save under the same lock. Only the acknowledged new
      // revision can be frozen, and each network step retains its own retry ID.
      if (kind === 'submit' && textRef.current !== responseRef.current?.attempt?.text) {
        if (!(await send('save'))) return;
      }
      if (!(await send(kind))) return;
      if (kind === 'start' || kind === 'submit') {
        try {
          await callbacks.current.onChanged();
        } catch {
          if (active()) setError('Ответ подтверждён. Не удалось обновить прогресс курса.');
        }
      }
    } catch {
      if (active())
        setError(
          'Не удалось подтвердить действие. Ваш текст оставлен в редакторе; повторите действие.',
        );
    } finally {
      if (operationToken.current === token) {
        operation.current = false;
        if (active()) setBusy(false);
      }
    }
  }
  function resolveConflict(useLocal: boolean) {
    if (!conflict || operation.current) return;
    if (
      !useLocal &&
      text !== conflict.attempt?.text &&
      !window.confirm('Заменить текст в редакторе сохранённым ответом?')
    )
      return;
    const local = text;
    apply(conflict);
    requests.current.clear();
    setError(null);
    setConflict(null);
    if (useLocal && conflict.canEdit) {
      setText(local);
      textRef.current = local;
      remember(local, conflict);
    } else if (conflict.attempt) localDrafts.delete(key(conflict.attempt.id));
  }

  return (
    <section
      className="essay-response"
      aria-label="Письменный ответ"
      data-testid="essay-response-editor"
    >
      {error ? <p role="alert">{error}</p> : null}
      {!response ? (
        <>
          {!error ? (
            <p role="status">Загружаем ответ…</p>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Повторить загрузку
            </button>
          )}
        </>
      ) : (
        <>
          {response.attempt ? (
            <>
              <label>
                Ваш ответ
                <GrowingTextarea
                  aria-label="Ваш письменный ответ"
                  value={text}
                  maxLength={40_000}
                  disabled={busy || !response.canEdit || conflict !== null}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '5rem',
                    fontSize: '.875rem',
                  }}
                  onChange={(event) => {
                    const next = event.target.value;
                    setText(next);
                    textRef.current = next;
                    remember(next);
                  }}
                />
              </label>
              <small role="status">
                {busy
                  ? 'Подтверждаем…'
                  : dirty
                    ? 'Есть несохранённый текст'
                    : response.attempt.submissionId
                      ? 'Ответ сдан'
                      : 'Ответ сохранён'}
                {' · '}Попытка {response.attempt.number}
              </small>
              {response.attempt.feedback ? <p>Преподаватель: {response.attempt.feedback}</p> : null}
            </>
          ) : null}
          <div className="seat-course-activity-actions">
            {response.canStart ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void perform('start')}
              >
                {response.attempt ? 'Начать доработку' : 'Написать ответ'}
              </button>
            ) : null}
            {response.canEdit ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || !dirty || conflict !== null}
                  onClick={() => void perform('save')}
                >
                  Сохранить ответ
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || !text.trim() || conflict !== null}
                  onClick={() => void perform('submit')}
                >
                  Сдать ответ
                </button>
              </>
            ) : null}
            {conflict ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => resolveConflict(false)}
                >
                  Загрузить сохранённый ответ
                </button>
                {conflict.canEdit && conflict.attempt?.id === response.attempt?.id ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => resolveConflict(true)}
                  >
                    Оставить мой текст
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {recovery ? (
            <details className="essay-response-recovery">
              <summary>Несохранённый текст предыдущего редактирования</summary>
              <p>
                Этот текст не был сдан. Официальный ответ показан выше. Здесь текст можно выделить и
                скопировать.
              </p>
              <GrowingTextarea
                aria-label="Локальный несохранённый текст"
                value={recovery.text}
                readOnly
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: '5rem',
                  fontSize: '.875rem',
                }}
              />
              {response.canEdit && response.attempt?.id !== recovery.attemptId ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setText(recovery.text);
                    textRef.current = recovery.text;
                    remember(recovery.text);
                    localDrafts.delete(key(recovery.attemptId));
                    setRecovery(null);
                  }}
                >
                  Использовать в новой попытке
                </button>
              ) : null}
            </details>
          ) : null}
          {!response.canStart && !response.canEdit && !response.attempt?.submissionId ? (
            <p role="status">Редактирование пока недоступно.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
