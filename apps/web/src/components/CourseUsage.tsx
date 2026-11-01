import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CourseUsageRun } from '../api';
import { PortalLink } from './PortalLink';
import './course-usage.css';

export function CourseUsage({
  courseId,
  onClose,
  onNavigate,
}: {
  readonly courseId: string;
  readonly onClose: () => void;
  readonly onNavigate: (href: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<CourseUsageRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setItems(null);
    setError(null);
    try {
      const result = await api.courseUsage(courseId);
      if (request !== generation.current) return;
      if (result.ok) setItems(result.data.items);
      else setError(result.error.message);
    } catch {
      if (request === generation.current) setError('Не удалось загрузить использование курса.');
    }
  }, [courseId]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return (
    <section className="course-usage" aria-label="Использование курса">
      <div className="course-usage-header">
        <h3>Использование курса</h3>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Закрыть использование
        </button>
      </div>
      <p>Проведения курса в классах, к которым у вас есть доступ.</p>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить загрузку
          </button>
        </div>
      ) : items === null ? (
        <p role="status">Загружаем использование курса…</p>
      ) : items.length === 0 ? (
        <p role="status">В доступных вам классах курс пока не используется.</p>
      ) : (
        <ul className="course-usage-list">
          {items.map((run) => {
            const href = `#/classrooms/${encodeURIComponent(run.classroomId)}?courseRun=${encodeURIComponent(run.id)}`;
            return (
              <li key={run.id}>
                <h4>{run.classroomTitle}</h4>
                <p>
                  {run.title} · Версия {run.versionNumber}
                </p>
                <p>
                  {run.status === 'open' ? 'Проведение открыто' : 'Проведение закрыто'}
                  {run.classroomStatus === 'archived' ? ' · Класс в архиве' : ''}
                </p>
                <p>
                  {run.audienceType === 'whole_class'
                    ? 'Весь класс'
                    : run.audienceType === 'named_learners'
                      ? 'Выбранные ученики'
                      : 'Аудитория не указана в истории проведения'}
                </p>
                <PortalLink
                  className="btn-secondary"
                  href={href}
                  onNavigate={() => onNavigate(href)}
                >
                  Открыть обучение класса
                </PortalLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
