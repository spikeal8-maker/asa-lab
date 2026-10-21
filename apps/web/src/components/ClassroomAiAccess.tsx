import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api-call';
import {
  isClassroomAccessSaved,
  isClassroomAccessSettings,
  type ClassroomAccessSettings as AccessSettings,
} from '../ai/classroom-access-response';
import './classroom-ai-access.css';

type Mutation = Record<string, unknown> & { requestId: string; expectedRevision: number };
const INVALID_SETTINGS = 'Не удалось прочитать правила доступа к ИИ. Обновите правила.';
const UNCONFIRMED_SAVE =
  'Не удалось подтвердить сохранение доступа к ИИ. Повторите сохранение для проверки результата.';

export function ClassroomAiAccess({
  classroomId,
  readOnly = false,
}: {
  classroomId: string;
  readOnly?: boolean;
}) {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [mode, setMode] = useState<AccessSettings['mode']>('deny');
  const [minimum, setMinimum] = useState('50');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState<Mutation | null>(null);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(30);
  const generation = useRef(0);
  const path = '/api/ai/classrooms/' + encodeURIComponent(classroomId) + '/access';

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    const response = await call<unknown>(path);
    if (generation.current !== current) return;
    setLoading(false);
    if (!response.ok) {
      setSettings(null);
      setError(
        typeof response.error?.message === 'string' && response.error.message.trim()
          ? response.error.message
          : INVALID_SETTINGS,
      );
      return;
    }
    if (!isClassroomAccessSettings(response.data, classroomId)) {
      setSettings(null);
      setError(INVALID_SETTINGS);
      return;
    }
    setSettings(response.data);
    setMode(response.data.mode);
    setMinimum(String(response.data.minimumRating));
    setOverrides({});
    setError('');
  }, [path, classroomId]);
  useEffect(() => {
    setSettings(null);
    setRetry(null);
    setBusy(false);
    setNotice('');
    setFilter('');
    setLimit(30);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const disabled = readOnly || settings?.readOnly || busy || loading || retry !== null;
  async function save(input: Mutation) {
    if (busy || !settings || readOnly || settings.readOnly) return;
    const current = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    const result = await call<unknown>(path, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    if (generation.current !== current) return;
    setBusy(false);
    if (!result.ok) {
      setError(
        typeof result.error?.message === 'string' && result.error.message.trim()
          ? result.error.message
          : UNCONFIRMED_SAVE,
      );
      // A transport/server failure can follow a successful commit. Retry the
      // exact mutation, including revision and ID, instead of issuing another.
      setRetry(result.status === 0 || result.status >= 500 ? input : null);
      return;
    }
    if (!isClassroomAccessSaved(result.data, input.expectedRevision)) {
      setError(UNCONFIRMED_SAVE);
      setRetry(input);
      return;
    }
    setRetry(null);
    setNotice('Доступ к ИИ сохранён. Новые сообщения используют это правило.');
    await load();
  }
  function change(values: Record<string, unknown>) {
    if (!settings) return;
    void save({ ...values, expectedRevision: settings.revision, requestId: crypto.randomUUID() });
  }
  const students =
    settings?.students.filter((student) =>
      student.displayName.toLocaleLowerCase('ru').includes(filter.toLocaleLowerCase('ru')),
    ) ?? [];
  const visibleError = error || (retry ? UNCONFIRMED_SAVE : '');
  return (
    <fieldset className="classroom-ai-access" aria-busy={loading || busy}>
      <legend>ИИ-чат учеников</legend>
      <p>
        По умолчанию доступ закрыт. Вы можете разрешить чат классу или отдельным ученикам. Личная
        переписка учеников преподавателю не показывается.
      </p>
      {loading && !settings ? <p role="status">Загружаем правила доступа…</p> : null}
      {settings ? (
        <>
          <form
            className="classroom-ai-access__rule"
            onSubmit={(event) => {
              event.preventDefault();
              const threshold = Number(minimum);
              if (
                !Number.isInteger(threshold) ||
                threshold < 0 ||
                threshold > 100 ||
                minimum.trim() === ''
              ) {
                setError('Укажите порог рейтинга от 0 до 100.');
                return;
              }
              change({ kind: 'classroom', mode, minimumRating: threshold });
            }}
          >
            <label>
              Правило класса
              <select
                value={mode}
                disabled={disabled}
                onChange={(event) => setMode(event.currentTarget.value as AccessSettings['mode'])}
              >
                <option value="deny">Закрыт по умолчанию</option>
                <option value="allow">Разрешён ученикам класса</option>
                <option value="rating">По рейтингу ученика</option>
              </select>
            </label>
            {mode === 'rating' ? (
              <label>
                Минимальный рейтинг
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={minimum}
                  disabled={disabled}
                  onChange={(event) => setMinimum(event.currentTarget.value)}
                />
                <span>
                  Текущий рейтинг из списка учеников. При отсутствии рейтинга доступ остаётся
                  закрыт.
                </span>
              </label>
            ) : null}
            <button type="submit" disabled={disabled}>
              Сохранить правило класса
            </button>
          </form>
          <details className="classroom-ai-access__students">
            <summary>Индивидуальные разрешения · {settings.students.length}</summary>
            <p>
              «Разрешить» открывает чат этому ученику независимо от правила класса. «Закрыть»
              запрещает новые сообщения. Уже начатый ответ может завершиться; собственная история
              сохраняется.
            </p>
            {settings.students.length > 0 ? (
              <>
                <label>
                  Поиск ученика
                  <input
                    type="search"
                    value={filter}
                    onChange={(event) => {
                      setFilter(event.currentTarget.value);
                      setLimit(30);
                    }}
                  />
                </label>
                <ul className="classroom-ai-access__list">
                  {students.slice(0, limit).map((student) => (
                    <li key={student.seatId}>
                      <div className="classroom-ai-access__student-name">
                        <strong>{student.displayName}</strong>
                        <span>
                          {student.canGenerate ? 'Доступ разрешён' : 'Доступ закрыт'} · Рейтинг:{' '}
                          {student.rating === null ? 'нет' : student.rating}
                        </span>
                      </div>
                      <label>
                        Доступ для {student.displayName}
                        <select
                          value={overrides[student.seatId] ?? student.override}
                          disabled={disabled || student.status === 'suspended'}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setOverrides((current) => ({
                              ...current,
                              [student.seatId]: value,
                            }));
                          }}
                        >
                          <option value="inherit">По правилу класса</option>
                          <option value="allow">Разрешить</option>
                          <option value="deny">Закрыть</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        aria-label={'Сохранить доступ: ' + student.displayName}
                        disabled={
                          disabled ||
                          student.status === 'suspended' ||
                          overrides[student.seatId] === undefined ||
                          overrides[student.seatId] === student.override
                        }
                        onClick={() =>
                          change({
                            kind: 'seat',
                            seatId: student.seatId,
                            override: overrides[student.seatId],
                          })
                        }
                      >
                        Сохранить доступ
                      </button>
                    </li>
                  ))}
                </ul>
                {students.length === 0 ? <p>Ученик не найден.</p> : null}
                {students.length > limit ? (
                  <button type="button" onClick={() => setLimit((value) => value + 30)}>
                    Показать ещё учеников
                  </button>
                ) : null}
              </>
            ) : (
              <p>После добавления учеников здесь появятся их индивидуальные разрешения.</p>
            )}
          </details>
        </>
      ) : null}
      {visibleError ? (
        <div className="classroom-ai-access__error" role="alert">
          <p>{visibleError}</p>
          <div className="classroom-ai-access__actions">
            {retry ? (
              <button
                type="button"
                disabled={busy || loading || readOnly || !settings || settings.readOnly}
                onClick={() => void save(retry)}
              >
                Повторить сохранение
              </button>
            ) : null}
            <button type="button" disabled={busy || loading} onClick={() => void load()}>
              Обновить правила
            </button>
          </div>
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </fieldset>
  );
}
