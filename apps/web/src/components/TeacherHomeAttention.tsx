import { useEffect, useState } from 'react';
import { api, type TeacherHomeAttention as Attention } from '../api';
import { PortalLink } from './PortalLink';
import './teacher-home-attention.css';

export function TeacherHomeAttention(): JSX.Element {
  const [data, setData] = useState<Attention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const result = await api.teacherHomeAttention();
      if (!active || request !== sequence) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else setError(result.error.message);
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);
  const actions = [
    ...(data?.reviews ?? []).map((item) => {
      const query = new URLSearchParams({ assignment: item.assignmentId, learner: item.seatId });
      if (item.attemptId) query.set('attempt', item.attemptId);
      return {
        key: item.key,
        href: `#/classrooms/${encodeURIComponent(item.classroomId)}?${query}`,
        title: `${item.learnerName} · ${item.assignmentTitle}`,
        context: `Проверить работу · ${item.classroomTitle}`,
      };
    }),
    ...(data?.joinRequests ?? []).map((item) => ({
      key: item.id,
      href: `#/classrooms/${encodeURIComponent(item.classroomId)}?joinRequest=${encodeURIComponent(item.id)}`,
      title: item.learnerName,
      context: `Рассмотреть заявку · ${item.classroomTitle}`,
    })),
  ];
  return (
    <section className="teacher-home-attention" aria-labelledby="teacher-attention-title">
      <header>
        <h2 id="teacher-attention-title">Требует внимания</h2>
        <button type="button" className="btn-secondary" onClick={() => setReload((n) => n + 1)}>
          Обновить
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!data && !error ? <p role="status">Загружаем учебные действия…</p> : null}
      {data && !error ? (
        <>
          <p>
            Работы на проверке: {data.reviews.length} · Активные классы: {data.classrooms.length}
            {' · '}Заявки: {data.joinRequests.length}
            {data.joinRequestsMayBeLimited ? '+' : ''}
          </p>
          {actions.length === 0 && !data.joinRequestsMayBeLimited ? (
            <p>Сейчас нет работ и заявок, ожидающих вашего решения.</p>
          ) : (
            <ol aria-label="Ближайшие действия">
              {(expanded ? actions : actions.slice(0, 5)).map((item) => (
                <li key={item.key}>
                  <PortalLink href={item.href}>{item.title}</PortalLink>
                  <small>{item.context}</small>
                </li>
              ))}
            </ol>
          )}
          {actions.length > 5 ? (
            <button type="button" className="btn-secondary" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Свернуть действия' : `Все действия (${actions.length})`}
            </button>
          ) : null}
          {data.joinRequestsMayBeLimited ? (
            <p>Показаны заявки из недавней истории. Проверьте также заявки в классах.</p>
          ) : null}
          {data.classrooms.length ? (
            <details>
              <summary>Активные классы ({data.classrooms.length})</summary>
              <ul>
                {data.classrooms.map((item) => (
                  <li key={item.id}>
                    <PortalLink href={`#/classrooms/${encodeURIComponent(item.id)}`}>
                      {item.title}
                    </PortalLink>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
