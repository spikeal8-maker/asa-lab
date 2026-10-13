import { useEffect, useRef, useState } from 'react';
import { api, type LearningNotification, type NotificationCategory } from '../api';
import { notificationCategories } from './LearningNotificationPreferences';
import { createLearningInboxPoller, type LearningInboxSnapshot } from './learning-inbox-poller';

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
  const journal = item as LearningNotification & {
    journalRevisionId?: string | null;
    journalDate?: string | null;
    journalColumnId?: string | null;
  };
  if (journal.journalRevisionId) {
    const query = new URLSearchParams({ journal: '1' });
    if (journal.journalDate) query.set('journalMonth', journal.journalDate.slice(0, 7));
    if (journal.journalColumnId) query.set('journalColumn', journal.journalColumnId);
    return `#/learning?${query.toString()}`;
  }
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
/** Mounted only in the active Notifications panel; the parent keys actor and workspace. */
export function LearningInbox() {
  const poller = useRef<ReturnType<typeof createLearningInboxPoller> | null>(null);
  const marking = useRef(false);
  const [data, setData] = useState<LearningInboxSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const error = readError ?? loadError;
  const [category, setCategory] = useState(''),
    [classId, setClassId] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const current = createLearningInboxPoller({
      load: api.learningNotifications,
      onResult: (result) => {
        if (result.ok) {
          setData(result.data);
          setLoadError(null);
        } else setLoadError(result.error.message);
      },
    });
    poller.current = current;
    return () => current.stop();
  }, []);
  function refresh() {
    setReadError(null);
    void poller.current?.refresh();
  }
  async function mark(ids: string[] | null) {
    const current = poller.current;
    if (!data || !current || marking.current) return;
    marking.current = true;
    const finished = current.beginMutation();
    setBusy(true);
    setReadError(null);
    try {
      const result = await api.readLearningNotifications(ids, data.snapshot);
      if (!current.isActive()) return;
      if (!result.ok) setReadError(result.error.message);
    } catch {
      if (current.isActive()) setReadError('Не удалось отметить оповещения прочитанными.');
    } finally {
      if (current.isActive()) {
        marking.current = false;
        setBusy(false);
        finished();
      }
    }
  }
  const shown =
    data?.items.filter(
      (item) =>
        (!category || category === item.category) && (!classId || classId === item.classroomId),
    ) ?? [];
  return (
    <section className="learning-inbox-events" aria-label="События уведомлений">
      <h3>События</h3>
      <p className="learning-inbox-unread" role="status">
        Непрочитанных: {data?.unread ?? '…'}
      </p>

      {error ? (
        <div className="learning-inbox-error" role="alert">
          {error}
          <button className="btn-secondary" onClick={refresh}>
            Повторить
          </button>
        </div>
      ) : null}
      {!data && !error ? <p>Загружаем события…</p> : null}
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
          className="btn-secondary"
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
              {titles[item.kind] ?? notificationCategories[item.category as NotificationCategory]}
            </strong>
            <p>
              {item.title} · {item.classroomTitle}
            </p>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
            <a
              className="learning-inbox-open"
              href={destination(item)}
              onClick={() => {
                void mark([item.id]);
              }}
            >
              Открыть
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
