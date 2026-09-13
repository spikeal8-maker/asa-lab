import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type LearningNotification, type NotificationCategory } from '../api';
import {
  LearningNotificationPreferences,
  notificationCategories,
} from './LearningNotificationPreferences';

const titles: Record<string, string> = {
  NF01: 'Назначено обучение',
  NF02: 'Работа сдана',
  NF03: 'Нужна доработка',
  NF04: 'Результат опубликован',
  NF05: 'Результат исправлен',
  NF06: 'Заявка в класс',
  NF07: 'Решение по заявке',
  NF08: 'Условия работы изменены',
  NF13: 'Срок скоро',
  NF14: 'Срок прошёл',
  NF15: 'Курс завершён',
};
function destination(item: LearningNotification): string {
  const query = new URLSearchParams();
  if (item.assignmentId) query.set('assignment', item.assignmentId);
  if (item.seatId) query.set('learner', item.seatId);
  if (item.attemptId) query.set('attempt', item.attemptId);
  if (item.courseRunId) query.set('courseRun', item.courseRunId);
  if (item.recipientKind === 'teacher') {
    if (item.joinRequestId) query.set('joinRequest', item.joinRequestId);
    return `#/classrooms/${item.classroomId}?${query.toString()}`;
  }
  return `#/${item.recipientKind === 'requester' ? 'attending' : 'learning'}?${query.toString()}`;
}
export function LearningInbox({ seat = false }: { seat?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<{
      snapshot: string;
      unread: number;
      items: LearningNotification[];
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false),
    [category, setCategory] = useState(''),
    [classId, setClassId] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const result = await api.learningNotifications();
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error.message);
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  async function mark(ids: string[] | null) {
    if (!data) return;
    setBusy(true);
    const result = await api.readLearningNotifications(ids, data.snapshot);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    else await refresh();
  }
  const shown =
    data?.items.filter(
      (item) =>
        (!category || category === item.category) && (!classId || classId === item.classroomId),
    ) ?? [];
  return (
    <>
      <button
        className="btn-secondary learning-inbox-button"
        aria-label={`Оповещения${data ? `: непрочитанных ${data.unread}` : ''}`}
        onClick={() => {
          setSettings(false);
          dialog.current?.showModal();
          void refresh();
        }}
      >
        <span className="learning-inbox-label">Оповещения</span>
        <span className="learning-inbox-icon" aria-hidden="true">
          🔔
        </span>
        {data && data.unread > 0 ? (
          <span className="learning-inbox-badge">{data.unread}</span>
        ) : null}
        {error ? ' !' : ''}
      </button>
      <dialog ref={dialog} className="learning-inbox-dialog" aria-label="Учебные оповещения">
        <header>
          <strong>{settings ? 'Настройки оповещений' : 'Учебные оповещения'}</strong>
          <button className="btn-secondary" onClick={() => dialog.current?.close()}>
            Закрыть
          </button>
        </header>
        <button className="btn-secondary" onClick={() => setSettings(!settings)}>
          {settings ? 'К событиям' : 'Настроить'}
        </button>
        {settings ? (
          <LearningNotificationPreferences seat={seat} />
        ) : (
          <>
            {error ? (
              <p role="alert">
                {error}
                <button onClick={() => void refresh()}>Повторить</button>
              </p>
            ) : null}
            {!data && !error ? <p>Загружаем события…</p> : null}
            <p>
              Непрочитанные — личные оповещения. Очередь «Ждут проверки» в журнале считается
              отдельно.
            </p>
            <div className="learning-notification-actions">
              <label>
                Категория{' '}
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Все категории</option>
                  {Object.entries(notificationCategories).map(([id, title]) => (
                    <option value={id} key={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Класс{' '}
                <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">Все классы</option>
                  {[
                    ...new Map(
                      (data?.items ?? []).map((item) => [item.classroomId, item.classroomTitle]),
                    ).entries(),
                  ].map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy || !shown.length}
                onClick={() => void mark(category || classId ? shown.map((item) => item.id) : null)}
              >
                Отметить прочитанными
              </button>
            </div>
            {data && !shown.length ? <p>Нет доставленных оповещений в этом списке.</p> : null}
            <ul className="learning-inbox-list">
              {shown.map((item) => (
                <li key={item.id} data-unread={!item.readAt}>
                  <strong>
                    {titles[item.kind] ??
                      notificationCategories[item.category as NotificationCategory]}
                  </strong>
                  <p>
                    {item.title} · {item.classroomTitle}
                  </p>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                  <a
                    href={destination(item)}
                    onClick={() => {
                      void mark([item.id]);
                      dialog.current?.close();
                    }}
                  >
                    Открыть
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </dialog>
    </>
  );
}
