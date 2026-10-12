import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { useLearningDestination } from '../learning/use-learning-destination';

type Props = { classroomId?: string; onChanged?: () => void; expanded?: boolean };
type JoinRequest = {
  id: string;
  classroom_id: string;
  classroom_title: string;
  display_label: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
};

export function ClassroomJoinRequests(props: Props) {
  return <JoinRequests key={props.classroomId ?? 'own-requests'} {...props} />;
}

function JoinRequests({ classroomId, onChanged, expanded = false }: Props) {
  const destination = useLearningDestination();
  const formId = useId();
  const [items, setItems] = useState<JoinRequest[]>([]);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(false);
  const generation = useRef(0);
  const targetPresent = items.some((item) => item.id === destination.joinRequest);
  useEffect(() => {
    if (targetPresent) document.getElementById(`join-request-${destination.joinRequest}`)?.focus();
  }, [targetPresent, destination.joinRequest]);
  const load = useCallback(async () => {
    const token = ++generation.current;
    try {
      const result = await api.classroomJoinRequests(classroomId);
      if (!alive.current || token !== generation.current) return;
      if (result.ok) {
        setItems(result.data.items);
        setError(null);
      } else {
        if ([401, 403, 404].includes(result.status)) {
          setItems([]);
          setReplies({});
        }
        setError(result.error.message);
      }
    } catch {
      if (alive.current && token === generation.current)
        setError('Не удалось загрузить заявки. Повторите попытку.');
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  }, [classroomId]);
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      alive.current = false;
      generation.current++;
      window.clearInterval(timer);
    };
  }, [load]);
  async function decide(item: JoinRequest, decision: 'approved' | 'rejected') {
    if (!classroomId || busy) return;
    const reason = (replies[item.id] ?? '').trim();
    if (reason.length > 500) {
      setError('Ответ: не более 500 символов.');
      return;
    }
    setBusy(item.id);
    setError(null);
    try {
      const result = await api.decideClassroomJoin(classroomId, item.id, decision, reason);
      if (!alive.current) return;
      if (!result.ok) {
        if ([401, 403, 404].includes(result.status)) {
          setItems([]);
          setReplies({});
        }
        setError(result.error.message);
        return;
      }
      setReplies((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
      if (alive.current) onChanged?.();
    } catch {
      if (alive.current)
        setError('Решение не подтверждено. Ответ сохранён в форме; повторите попытку.');
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  const heading = (
    <>
      {classroomId ? 'Заявки в класс' : 'Мои заявки в классы'} ·{' '}
      {items.filter((item) => item.status === 'pending').length}
    </>
  );
  const content = (
    <>
      {!expanded ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void load()}
        >
          Обновить заявки
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">Загружаем заявки…</p> : null}
      {!loading && items.length === 0 && !error ? <p>Заявок пока нет.</p> : null}
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            id={`join-request-${item.id}`}
            tabIndex={-1}
            data-request-status={item.status}
            aria-current={item.id === destination.joinRequest ? 'true' : undefined}
          >
            <div className="classroom-request-summary">
              <strong>{classroomId ? item.display_label : item.classroom_title}</strong>
              <span>
                {item.status === 'pending'
                  ? 'Ждёт подтверждения'
                  : item.status === 'approved'
                    ? 'Принята'
                    : 'Отклонена'}
              </span>
            </div>
            {classroomId && item.status === 'pending' ? (
              <div className="classroom-request-actions">
                <label htmlFor={`${formId}-${item.id}`}>Ответ ученику (необязательно)</label>
                <input
                  id={`${formId}-${item.id}`}
                  type="text"
                  maxLength={500}
                  disabled={busy !== null}
                  value={replies[item.id] ?? ''}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setReplies((current) => ({ ...current, [item.id]: value }));
                  }}
                />
                <span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy !== null}
                    onClick={() => void decide(item, 'approved')}
                  >
                    Принять заявку
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy !== null}
                    onClick={() => void decide(item, 'rejected')}
                  >
                    Отклонить
                  </button>
                </span>
              </div>
            ) : null}
            {item.reason ? <p>{item.reason}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
  return expanded ? (
    <section className="learning-join-requests" aria-label="Заявки в класс">
      <div className="classroom-request-heading">
        <h2>{heading}</h2>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy !== null}
          onClick={() => void load()}
        >
          Обновить заявки
        </button>
      </div>
      {content}
    </section>
  ) : (
    <details
      className="learning-join-requests"
      open={items.some((item) => item.status === 'pending')}
    >
      <summary>{heading}</summary>
      {content}
    </details>
  );
}
