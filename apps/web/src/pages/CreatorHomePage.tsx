import { useEffect, useRef, useState } from 'react';
import { api, type Project, type SessionPayload } from '../api';
import { PortalLink } from '../components/PortalLink';
import {
  HOME_MODULES,
  QuickCreateMenu,
  homeModuleTitle,
  useQuickProjectCreation,
  useProjectScroll,
  type HomeModule,
} from '../creator-portal/QuickProjectCreation';
import { HomeShelf } from '../creator-portal/HomeShelf';
import { HomePublicShelves } from '../creator-portal/HomePublicShelves';
import { creatorViewToHref, type CreatorPortalSection } from '../creator-portal/navigation';
import { ModuleGlyph } from '../modules/ModuleGlyph';
import { ProjectCard } from '../modules/ProjectCard';

const PROJECTS_PER_MODULE = 10;
const ORDER: readonly HomeModule[] = ['three-d', 'electronics'];

export function CreatorHomePage({
  session,
  onNavigate,
  onOpenProject,
  onAllProjects,
  onOpenWork,
  onOpenCourse,
}: {
  session: SessionPayload;
  onNavigate: (section: CreatorPortalSection) => void;
  onOpenProject: (projectId: string, moduleKey: string) => void;
  onAllProjects: (module?: string) => void;
  onOpenWork: (id: string) => void;
  onOpenCourse: (id: string) => void;
}): JSX.Element {
  const { modules, create, busy } = useQuickProjectCreation();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current;
    setProjects(null);
    setError(false);
    void Promise.all(
      HOME_MODULES.map((module) =>
        api.listProjects({ scope: 'personal', module, limit: PROJECTS_PER_MODULE }),
      ),
    ).then((results) => {
      if (request !== sequence.current) return;
      if (results.some((result) => !result.ok)) {
        setError(true);
        return;
      }
      setProjects(
        results.flatMap((result) =>
          result.ok ? result.data.items.slice(0, PROJECTS_PER_MODULE) : [],
        ),
      );
    });
    return () => {
      sequence.current += 1;
    };
  }, [session.user.id, session.activeWorkspace.workspaceId, reload]);
  const rememberScroll = useProjectScroll(projects !== null);
  return (
    <main className="portal-content creator-home" id="main-content" tabIndex={-1}>
      <div className="creator-home-topline">
        <h1 className="creator-home-title">Главная</h1>
        <div className="home-mobile-create">
          <QuickCreateMenu />
        </div>
      </div>
      {error ? (
        <section className="creator-dashboard-state" role="alert">
          <strong>Проекты сейчас не загрузились</strong>
          <button type="button" className="btn-secondary" onClick={() => setReload((n) => n + 1)}>
            Повторить
          </button>
        </section>
      ) : null}
      {!error && projects === null ? (
        <section className="creator-dashboard-loading" aria-label="Загрузка проектов">
          <div />
          <div />
        </section>
      ) : null}
      {projects !== null ? (
        <div className="creator-module-feed" data-testid="creator-recent-projects">
          {ORDER.map((key) => {
            const module = modules?.find(
              (item) => item.moduleKey === key && item.availability === 'active' && item.creatable,
            );
            if (!module) return null;
            const items = projects.filter((item) => item.moduleKey === key);
            const title = homeModuleTitle(key);
            return (
              <section
                className="creator-module-section"
                aria-labelledby={`creator-module-${key}`}
                key={key}
              >
                <div className="creator-module-heading">
                  <h2 id={`creator-module-${key}`} aria-label={title}>
                    <button
                      type="button"
                      className="home-module-all"
                      aria-label={key === 'three-d' ? 'Все модели' : 'Все схемы'}
                      onClick={() => {
                        rememberScroll();
                        onAllProjects(key);
                      }}
                    >
                      <span className="home-module-icon" aria-hidden="true">
                        <ModuleGlyph module={module} size={24} />
                      </span>
                      {title} <span aria-hidden="true">›</span>
                    </button>
                  </h2>
                  <button
                    type="button"
                    className="home-create-button"
                    disabled={busy}
                    onClick={() => create(key)}
                  >
                    <span aria-hidden="true">＋</span>
                    <span>{key === 'three-d' ? 'Создать модель' : 'Создать цепь'}</span>
                  </button>
                </div>
                {items.length ? (
                  <HomeShelf label={title}>
                    {items.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        module={{ ...module, displayName: title }}
                        timeLabel={new Date(project.updatedAt).toLocaleDateString('ru-RU', {
                          day: 'numeric',
                          month: 'short',
                        })}
                        footerLabel=""
                        open={{
                          href: creatorViewToHref({
                            kind: 'editor',
                            projectId: project.id,
                            moduleKey: project.moduleKey,
                            returnTo: { kind: 'home' },
                          }),
                          onNavigate: () => {
                            rememberScroll();
                            onOpenProject(project.id, project.moduleKey);
                          },
                        }}
                      />
                    ))}
                  </HomeShelf>
                ) : (
                  <button
                    type="button"
                    className="home-empty-create"
                    disabled={busy}
                    onClick={() => create(key)}
                  >
                    <span aria-hidden="true">＋</span>
                    <span>
                      {key === 'three-d'
                        ? 'Ваша первая 3D модель'
                        : 'Ваша первая электрическая цепь'}
                    </span>
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
      <PortalLink
        className="home-all-projects"
        href="/#/projects"
        onNavigate={() => {
          rememberScroll();
          onAllProjects();
        }}
      >
        Все мои проекты <span aria-hidden="true">›</span>
      </PortalLink>
      <HomePublicShelves
        key={`${session.user.id}:${session.activeWorkspace.workspaceId}`}
        onGallery={() => onNavigate('gallery')}
        onWork={onOpenWork}
        onKnowledge={() => onNavigate('knowledge')}
        onCourse={onOpenCourse}
      />
    </main>
  );
}
