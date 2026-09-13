import { useEffect, useRef, useState } from 'react';
import { api, type LearningConditions as Conditions } from '../api';

const FIELDS = [
  ['opensAt', 'Открыть с'],
  ['dueAt', 'Срок сдачи'],
  ['closesAt', 'Закрыть после'],
  ['attemptLimit', 'Лимит попыток'],
  ['latePolicy', 'После срока'],
] as const;
const SOURCES: Record<string, string> = {
  participation_override: 'личное исключение',
  run_override: 'условия класса',
  run_pin: 'условия при назначении',
  activity_version: 'опубликованный материал',
};
export function LearningConditions({
  classroomId,
  assignmentId,
  seatId = null,
  onChanged,
}: {
  classroomId: string;
  assignmentId: string;
  seatId?: string | null;
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState<Conditions | null>(null);
  const [draft, setDraft] = useState<Record<string, string | number | null>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [excused, setExcused] = useState(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    setCurrent(null);
    setError(null);
    void api.learningConditions(classroomId, assignmentId, seatId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setCurrent(result.data);
        setDraft(result.data.overrides);
        setExtra(result.data.effective.extraAttempts);
        setUnlocked(result.data.effective.teacherUnlocked);
        setExcused(result.data.impact.excused);
      } else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [classroomId, assignmentId, seatId]);
  function mode(key: string, value: string) {
    const copy = { ...draft };
    if (value === 'inherit') delete copy[key];
    else if (value === 'none') copy[key] = null;
    else
      copy[key] =
        key === 'attemptLimit'
          ? Number(current?.effective.values[key] ?? 1)
          : key === 'latePolicy'
            ? 'allow_until_close'
            : String(current?.effective.values[key] ?? new Date().toISOString());
    setDraft(copy);
  }
  async function save() {
    if (!current || busy) return;
    const payload = JSON.stringify({
      seatId,
      expectedRevision: current.revision,
      overrides: draft,
      reason: reason.trim(),
    });
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.saveLearningConditions(classroomId, assignmentId, {
      seatId,
      expectedRevision: current.revision,
      overrides: draft,
      reason: reason.trim(),
      requestId: request.current.id,
    });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    const fresh = await api.learningConditions(classroomId, assignmentId, seatId);
    setBusy(false);
    if (fresh.ok) {
      setCurrent(fresh.data);
      setDraft(fresh.data.overrides);
      setReason('');
      setNotice('Условия сохранены. Сданные версии не изменились.');
      onChanged?.();
    } else setError(fresh.error.message);
  }
  async function saveAllowance() {
    if (!seatId || !current || busy) return;
    const input = {
      expectedRevision: current.revision,
      extraAttempts: extra,
      teacherUnlocked: unlocked,
      excuse: excused,
      reason: reason.trim(),
    };
    const payload = JSON.stringify(input);
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.saveLearningAllowance(classroomId, assignmentId, seatId, {
      ...input,
      requestId: request.current.id,
    });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    const fresh = await api.learningConditions(classroomId, assignmentId, seatId);
    setBusy(false);
    if (fresh.ok) {
      setCurrent(fresh.data);
      setExtra(fresh.data.effective.extraAttempts);
      setUnlocked(fresh.data.effective.teacherUnlocked);
      setExcused(fresh.data.impact.excused);
      setReason('');
      setNotice('Индивидуальное разрешение сохранено. История попыток не изменена.');
      onChanged?.();
    } else setError(fresh.error.message);
  }
  return (
    <details className="learning-conditions">
      <summary>{seatId ? 'Индивидуальные условия' : 'Условия для класса'}</summary>
      <p>
        {seatId
          ? 'Только для этого ученика и назначения.'
          : 'Для всех участников этого назначения. Личные исключения имеют приоритет.'}
      </p>
      <p>
        Даты и время вводятся в UTC. Изменение не меняет опубликованный материал или уже сданные
        работы. Применяется к следующим действиям и новым попыткам.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {current ? (
        <fieldset disabled={busy} style={{ display: 'grid', gap: 8, border: 0, padding: 0 }}>
          <p>
            Затронуто участников: {current.impact.participants}. Сейчас в работе:{' '}
            {current.impact.activeAttempts}, сдано на проверку: {current.impact.submittedAttempts}.
            Сохранённые условия начала и точные сдачи не перезаписываются.
          </p>
          {FIELDS.map(([key, label]) => {
            const selected = !Object.hasOwn(draft, key)
              ? 'inherit'
              : draft[key] === null
                ? 'none'
                : 'value';
            return (
              <label key={key} style={{ display: 'grid', gap: 4 }}>
                {label}
                <select
                  aria-label={label + ' — режим'}
                  value={selected}
                  onChange={(e) => mode(key, e.target.value)}
                >
                  <option value="inherit">Наследовать</option>
                  <option value="value">Задать значение</option>
                  {key !== 'latePolicy' ? <option value="none">Без ограничения</option> : null}
                </select>
                {selected === 'value' ? (
                  key === 'latePolicy' ? (
                    <select
                      aria-label={label + ' — значение'}
                      value={String(draft[key])}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    >
                      <option value="allow_until_close">Разрешать до закрытия</option>
                      <option value="allow_mark_late">Разрешать с отметкой опоздания</option>
                      <option value="block_at_due">Запретить после срока</option>
                    </select>
                  ) : key === 'attemptLimit' ? (
                    <input
                      aria-label={label + ' — значение'}
                      type="number"
                      min={1}
                      max={100}
                      value={Number(draft[key])}
                      onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                    />
                  ) : (
                    <input
                      aria-label={label + ' — значение UTC'}
                      type="datetime-local"
                      value={String(draft[key]).slice(0, 16)}
                      onChange={(e) => {
                        if (e.target.value)
                          setDraft({ ...draft, [key]: e.target.value + ':00.000Z' });
                      }}
                    />
                  )
                ) : null}
                <small>
                  Сейчас: {String(current.effective.values[key] ?? 'без ограничения')} ·{' '}
                  {SOURCES[current.effective.sources[key] ?? ''] ?? 'наследование'}
                </small>
              </label>
            );
          })}
          <small>
            Дополнительных попыток с учётом возвратов: {current.effective.extraAttempts}.
          </small>
          <label>
            Причина изменения условий
            <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </label>
          {seatId ? (
            <details>
              <summary>Дополнительные попытки и освобождение</summary>
              <label>
                Всего дополнительных попыток
                <input
                  type="number"
                  min={current.effective.extraAttempts}
                  max={100}
                  value={extra}
                  onChange={(e) => setExtra(Number(e.target.value))}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={unlocked}
                  onChange={(e) => setUnlocked(e.target.checked)}
                />{' '}
                Разрешить индивидуальную сдачу после срока (закрытие назначения сохраняется)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={excused}
                  disabled={current.impact.excused}
                  onChange={(e) => setExcused(e.target.checked)}
                />{' '}
                Освободить от выполнения без оценки
              </label>
              <p>
                Не отменяет уже выданные попытки, закрытие назначения или прежние решения.
                Освобождение требует причины.
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={
                  !reason.trim() ||
                  !Number.isInteger(extra) ||
                  extra < current.effective.extraAttempts ||
                  extra > 100
                }
                onClick={() => void saveAllowance()}
              >
                Сохранить индивидуальное разрешение
              </button>
            </details>
          ) : null}
          <div>
            <button
              type="button"
              className="btn-primary"
              disabled={!reason.trim()}
              onClick={() => void save()}
            >
              Сохранить условия
            </button>{' '}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraft(current.overrides);
                setReason('');
              }}
            >
              Отменить изменения
            </button>
          </div>
        </fieldset>
      ) : !error ? (
        <p>Загрузка условий…</p>
      ) : null}
    </details>
  );
}
