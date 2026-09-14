import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useLearningDestination } from '../learning/use-learning-destination';

export function ClassroomJoinRequests({
  classroomId,
  onChanged,
}: {
  classroomId?: string;
  onChanged?: () => void;
}) {
  const destination = useLearningDestination();
  const [items, setItems] = useState<
    Array<{
      id: string;
      classroom_id: string;
      classroom_title: string;
      display_label: string;
      status: 'pending' | 'approved' | 'rejected';
      reason: string | null;
    }>
  >([]);
  const targetPresent = items.some((item) => item.id === destination.joinRequest);
  useEffect(() => {
    if (targetPresent) document.getElementById(`join-request-${destination.joinRequest}`)?.focus();
  }, [targetPresent, destination.joinRequest]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await api.classroomJoinRequests(classroomId);
    if (result.ok) {
      setItems(result.data.items);
      setError(null);
    } else setError(result.error.message);
  }, [classroomId]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <details
      className="learning-join-requests"
      open={items.some((item) => item.status === 'pending')}
    >
      <summary>
        {classroomId ? 'Заявки в класс' : 'Мои заявки в классы'} ·{' '}
        {items.filter((item) => item.status === 'pending').length}
      </summary>
      <p>
        Код позволяет подать заявку. Доступ к занятиям появляется после подтверждения
        преподавателем.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          void load();
          onChanged?.();
        }}
      >
        Обновить заявки
      </button>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            id={`join-request-${item.id}`}
            tabIndex={-1}
            aria-current={item.id === destination.joinRequest ? 'true' : undefined}
          >
            <strong>{classroomId ? item.display_label : item.classroom_title}</strong>
            {' · '}
            {item.status === 'pending'
              ? 'Ждёт подтверждения'
              : item.status === 'approved'
                ? 'Принята'
                : 'Отклонена'}
            {classroomId && item.status === 'pending' ? (
              <span>
                {(['approved', 'rejected'] as const).map((decision) => (
                  <button
                    type="button"
                    className="btn-secondary"
                    key={decision}
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(item.id);
                      const result = await api.decideClassroomJoin(classroomId, item.id, decision);
                      setBusy(null);
                      if (result.ok) {
                        await load();
                        onChanged?.();
                      } else setError(result.error.message);
                    }}
                  >
                    {decision === 'approved' ? 'Принять заявку' : 'Отклонить'}
                  </button>
                ))}
              </span>
            ) : null}
            {item.reason ? <p>{item.reason}</p> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
