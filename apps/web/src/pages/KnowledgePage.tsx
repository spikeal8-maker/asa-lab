import { useEffect, useState } from 'react';
import { api, type CatalogueCoursePreview, type PublicKnowledgeItem } from '../api';
import { LessonBlocks } from '../components/LessonBlocks';
import { PortalLink } from '../components/PortalLink';
import { KnowledgeCard } from '../creator-portal/HomePublicShelves';

export function KnowledgePage({
  courseId,
  onOpen,
  onBack,
}: {
  courseId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}): JSX.Element {
  const [items, setItems] = useState<PublicKnowledgeItem[]>([]);
  const [course, setCourse] = useState<CatalogueCoursePreview | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(null);
    setCourse(null);
    if (courseId) {
      void api.publicKnowledgeCourse(courseId).then((result) => {
        if (!current) return;
        setBusy(false);
        if (result.ok) setCourse(result.data);
        else
          setError(
            result.status === 404
              ? 'Курс больше не опубликован или недоступен.'
              : 'Не удалось загрузить курс.',
          );
      });
    } else {
      void api.publicKnowledge(offset).then((result) => {
        if (!current) return;
        setBusy(false);
        if (result.ok) {
          setItems(result.data.items);
          setNextOffset(result.data.nextOffset);
        } else setError('Не удалось загрузить знания.');
      });
    }
    return () => {
      current = false;
    };
  }, [courseId, offset, reload]);
  return (
    <main className="portal-content knowledge-page" id="main-content" tabIndex={-1}>
      {courseId ? (
        <PortalLink href="/#/knowledge" onNavigate={onBack}>
          ‹ Все знания
        </PortalLink>
      ) : null}
      <h1>{course?.title ?? 'Знания'}</h1>
      {!courseId ? (
        <p>Открытые курсы сообщества. Выберите курс, чтобы посмотреть его материалы.</p>
      ) : course?.summary ? (
        <p>{course.summary}</p>
      ) : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Повторить
          </button>
        </p>
      ) : null}
      {busy ? (
        <p role="status">Загружаем…</p>
      ) : !error && !courseId ? (
        <>
          {items.length ? (
            <ul className="knowledge-grid">
              {items.map((item) => (
                <KnowledgeCard key={item.id} item={item} onOpen={onOpen} />
              ))}
            </ul>
          ) : (
            <p className="home-shelf-state">Публичных курсов пока нет.</p>
          )}
          <div className="knowledge-pagination">
            {offset > 0 ? (
              <button type="button" onClick={() => setOffset(Math.max(0, offset - 24))}>
                Предыдущие
              </button>
            ) : null}
            {nextOffset !== null ? (
              <button type="button" onClick={() => setOffset(nextOffset)}>
                Следующие
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {!busy && !error && course ? (
        <div className="knowledge-outline">
          {course.sections.map((section) => (
            <section key={section.id}>
              <h2>{section.title}</h2>
              {section.summary ? <p>{section.summary}</p> : null}
              {section.lessons.map((lesson) => (
                <details key={lesson.id} className="knowledge-lesson">
                  <summary>
                    <strong>{lesson.title}</strong>
                    {lesson.estimatedMinutes ? <span>{lesson.estimatedMinutes} мин</span> : null}
                  </summary>
                  {lesson.summary ? <p>{lesson.summary}</p> : null}
                  <LessonBlocks blocks={lesson.blocks} legacyContent={lesson.content} compact />
                </details>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </main>
  );
}
