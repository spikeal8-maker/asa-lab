import { useEffect, useRef, useState } from 'react';
import { api, type PublicKnowledgeItem } from '../api';
import { PortalLink } from '../components/PortalLink';
import { LearningGlyph } from '../components/portal-icons';
import { publicProjectsApi, type PublicProject } from '../projects-public/api';
import { publicationHref } from '../projects-public/presentation';
import { HomeShelf } from './HomeShelf';
import { homeModuleTitle } from './QuickProjectCreation';

export function KnowledgeCard({
  item,
  onOpen,
}: {
  item: PublicKnowledgeItem;
  onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <li className="home-public-card">
      <PortalLink
        href={`/#/knowledge/${encodeURIComponent(item.id)}`}
        onNavigate={() => onOpen(item.id)}
      >
        <span className="home-knowledge-cover" aria-hidden="true">
          <LearningGlyph />
          <span>Курс · {item.lessonCount} уроков</span>
        </span>
        <strong>{item.title}</strong>
        <span>{item.authorName}</span>
      </PortalLink>
    </li>
  );
}

export function HomePublicShelves({
  onGallery,
  onWork,
  onKnowledge,
  onCourse,
}: {
  onGallery: () => void;
  onWork: (id: string) => void;
  onKnowledge: () => void;
  onCourse: (id: string) => void;
}): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reload, setReload] = useState(0);
  const [works, setWorks] = useState<readonly PublicProject[] | null>(null);
  const [knowledge, setKnowledge] = useState<PublicKnowledgeItem[] | null>(null);
  const [workError, setWorkError] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setWorks(null);
    setWorkError(false);
    setKnowledgeError(false);
    void publicProjectsApi.list().then((result) => {
      if (!current) return;
      if (result.ok && Array.isArray(result.data?.items)) setWorks(result.data.items.slice(0, 10));
      else setWorkError(true);
    });
    void api.publicKnowledge(0, 10).then((result) => {
      if (!current) return;
      if (result.ok) setKnowledge(result.data.items.slice(0, 10));
      else setKnowledgeError(true);
    });
    return () => {
      current = false;
    };
  }, [visible, reload]);
  const unavailable = (error: boolean, empty: boolean, loading: boolean): JSX.Element | null =>
    error ? (
      <p className="home-shelf-state" role="alert">
        Не удалось загрузить.{' '}
        <button type="button" onClick={() => setReload((n) => n + 1)}>
          Повторить
        </button>
      </p>
    ) : empty ? (
      <p className="home-shelf-state">Здесь появятся новые публикации.</p>
    ) : loading ? (
      <p className="home-shelf-state" role="status">
        Загружаем публикации…
      </p>
    ) : null;
  return (
    <div ref={root} className="home-public-shelves">
      <section aria-labelledby="home-community-title">
        <div className="creator-module-heading">
          <h2 id="home-community-title">Проекты сообщества</h2>
          <PortalLink href="/#/explore" onNavigate={onGallery}>
            Все <span aria-hidden="true">›</span>
          </PortalLink>
        </div>
        {unavailable(workError, works?.length === 0, works === null)}
        {works?.length ? (
          <HomeShelf label="Проекты сообщества">
            {works.map((item) => (
              <li key={`${item.publicationId}:${item.revisionId}`} className="home-public-card">
                <PortalLink
                  href={publicationHref(item.publicationId)}
                  onNavigate={() => onWork(item.publicationId)}
                >
                  {item.preview ? (
                    <img src={item.preview.url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span>Предпросмотр недоступен</span>
                  )}
                  <strong>{item.title}</strong>
                  <span>{homeModuleTitle(item.moduleKey)}</span>
                  <span>{item.authorLabel}</span>
                </PortalLink>
              </li>
            ))}
          </HomeShelf>
        ) : null}
      </section>
      <section aria-labelledby="home-knowledge-title">
        <div className="creator-module-heading">
          <h2 id="home-knowledge-title">Новое в знаниях</h2>
          <PortalLink href="/#/knowledge" onNavigate={onKnowledge}>
            Все <span aria-hidden="true">›</span>
          </PortalLink>
        </div>
        {unavailable(knowledgeError, knowledge?.length === 0, knowledge === null)}
        {knowledge?.length ? (
          <HomeShelf label="Новое в знаниях">
            {knowledge.map((item) => (
              <KnowledgeCard key={item.id} item={item} onOpen={onCourse} />
            ))}
          </HomeShelf>
        ) : null}
      </section>
    </div>
  );
}
