import { useCallback, useState } from 'react';
import { api, type SessionPayload } from '../api';
import { PortalLink } from '../components/PortalLink';
import {
  HOME_MODULES,
  homeModuleTitle,
  useQuickProjectCreation,
  useProjectScroll,
  type HomeModule,
} from '../creator-portal/QuickProjectCreation';
import { HomeShelf } from '../creator-portal/HomeShelf';
import { HomePublicShelves } from '../creator-portal/HomePublicShelves';
import { PersonalProgress } from '../creator-portal/PersonalProgress';
import {
  useNextLearningAction,
  usePersonalProgress,
  usePersonalRead,
  useProgressLifetime,
  type OwnProgressActor,
  type ProgressLifetime,
} from '../creator-portal/personal-progress';
import { creatorViewToHref, type CreatorPortalSection } from '../creator-portal/navigation';
import { ProjectModuleIcon } from '../modules/ProjectModuleIcon';
import { ProjectCard } from '../modules/ProjectCard';
import { useHomeProjectActions } from '../modules/useHomeProjectActions';

const PROJECTS_PER_MODULE = 10;
interface HomeProps {
  readonly session: SessionPayload;
  readonly actor: OwnProgressActor;
  readonly onNavigate: (section: CreatorPortalSection) => void;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
  readonly onAllProjects: (module?: string) => void;
  readonly onOpenWork: (id: string) => void;
  readonly onOpenCourse: (id: string) => void;
}

function useModuleProjects(module: HomeModule, lifetime: ProgressLifetime, revision: number) {
  const read = useCallback(
    () => api.listProjects({ scope: 'personal', module, limit: PROJECTS_PER_MODULE }),
    [module],
  );
  return usePersonalRead(lifetime, read, revision);
}

export function CreatorHomePage(props: HomeProps): JSX.Element {
  const lifetime = useProgressLifetime(props.actor);
  // Retire private cards and action dialogs in the same render as a session handoff.
  return <HomeContent key={lifetime.key ?? 'checking'} {...props} lifetime={lifetime} />;
}

function HomeContent({
  actor,
  lifetime,
  onNavigate,
  onOpenProject,
  onAllProjects,
  onOpenWork,
  onOpenCourse,
}: HomeProps & { readonly lifetime: ProgressLifetime }): JSX.Element {
  const { modules, modulesError, create, busy } = useQuickProjectCreation();
  const [revision, setRevision] = useState(0);
  const projectActions = useHomeProjectActions(() => setRevision((value) => value + 1));
  const lists = {
    'three-d': useModuleProjects('three-d', lifetime, revision),
    electronics: useModuleProjects('electronics', lifetime, revision),
    blocks: useModuleProjects('blocks', lifetime, revision),
    robotics: useModuleProjects('robotics', lifetime, revision),
  };
  const progress = usePersonalProgress(actor);
  const next = useNextLearningAction(actor, lifetime);
  const settled =
    Object.values(lists).every((list) => list.settled) &&
    progress.summary.settled &&
    next.settled &&
    (modules !== null || modulesError);
  // Restoring earlier would clamp the saved position against a still-short page.
  const rememberScroll = useProjectScroll(lifetime.key !== null && settled);
  const empty = Object.values(lists).every((list) => list.data?.items.length === 0);
  const openLearning = () => {
    rememberScroll();
    onNavigate('learning');
  };
  return (
    <main
      className="portal-content creator-home"
      id="main-content"
      aria-label="Главная"
      tabIndex={-1}
    >
      <PersonalProgress actor={actor} progress={progress} onLearning={openLearning} />
      {lifetime.key ? (
        <section className="personal-progress-next" aria-label="Продолжить обучение">
          {next.action ? (
            <p>
              <a href={next.action.href} onClick={rememberScroll}>
                {next.action.label}: {next.action.title}
              </a>
            </p>
          ) : !next.settled ? (
            <p role="status">Ищем доступные задания…</p>
          ) : (
            <p>
              <PortalLink href="/#/learning" onNavigate={openLearning}>
                Открыть обучение
              </PortalLink>
            </p>
          )}
          {next.error ? (
            <>
              <p role="alert">Часть заданий сейчас не загрузилась.</p>
              <button className="btn-secondary" type="button" onClick={next.reload}>
                Повторить загрузку заданий
              </button>
            </>
          ) : null}
        </section>
      ) : null}
      {empty ? (
        <section className="access-personal-start" aria-label="Начать работу">
          <PortalLink
            href={creatorViewToHref({ kind: 'knowledge' })}
            className="btn-secondary"
            onNavigate={() => onNavigate('knowledge')}
          >
            Открыть знания
          </PortalLink>
        </section>
      ) : null}
      <div className="creator-module-feed" data-testid="creator-recent-projects">
        {HOME_MODULES.map((key) => {
          const module = modules?.find(
            (item) => item.moduleKey === key && item.availability === 'active' && item.creatable,
          );
          const list = lists[key];
          const items = list.data?.items.slice(0, PROJECTS_PER_MODULE) ?? [];
          const title = homeModuleTitle(key);
          return (
            <section
              className="creator-module-section"
              aria-labelledby={`creator-module-${key}`}
              key={key}
              data-module={key}
            >
              <div className="creator-module-heading">
                <h2 id={`creator-module-${key}`} aria-label={title}>
                  <button
                    type="button"
                    className="home-module-all"
                    aria-label={
                      key === 'three-d'
                        ? 'Все модели'
                        : key === 'electronics'
                          ? 'Все схемы'
                          : 'Все программы'
                    }
                    onClick={() => {
                      rememberScroll();
                      onAllProjects(key);
                    }}
                  >
                    <span className="home-module-icon" aria-hidden="true">
                      <ProjectModuleIcon moduleKey={key} size={24} />
                    </span>
                    {title} <span aria-hidden="true">›</span>
                  </button>
                </h2>
                <button
                  type="button"
                  className="home-create-button"
                  disabled={busy || !module || !lifetime.key}
                  onClick={() => create(key)}
                >
                  <ProjectModuleIcon moduleKey={key} size={28} />
                  <span>
                    {key === 'three-d'
                      ? 'Создать модель'
                      : key === 'electronics'
                        ? 'Создать цепь'
                        : 'Создать программу'}
                  </span>
                </button>
              </div>
              {!module ? (
                <p className="home-module-availability">
                  {modulesError
                    ? 'Не удалось проверить доступность среды.'
                    : modules !== null
                      ? 'Сейчас недоступно'
                      : 'Проверяем доступность среды…'}
                </p>
              ) : null}
              {list.loading ? (
                <p role="status" className="home-module-empty">
                  Загружаем проекты…
                </p>
              ) : null}
              {list.error ? (
                <div className="home-module-error" role="alert">
                  <p>Проекты этой среды сейчас не загрузились.</p>
                  <button className="btn-secondary" type="button" onClick={list.reload}>
                    Повторить загрузку {title.toLocaleLowerCase('ru-RU')}
                  </button>
                </div>
              ) : null}
              {items.length ? (
                <HomeShelf label={title}>
                  {items.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      module={module ? { ...module, displayName: title } : undefined}
                      timeLabel={new Date(project.updatedAt).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      footerLabel=""
                      menuItems={projectActions.menuItems(project)}
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
              ) : list.data ? (
                <p className="home-module-empty">
                  {key === 'three-d'
                    ? 'Пока нет моделей'
                    : key === 'electronics'
                      ? 'Пока нет схем'
                      : 'Пока нет программ'}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
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
      {projectActions.dialogs}
      {lifetime.key ? (
        <HomePublicShelves
          key={lifetime.key}
          onGallery={() => onNavigate('gallery')}
          onWork={onOpenWork}
          onKnowledge={() => onNavigate('knowledge')}
          onCourse={onOpenCourse}
        />
      ) : null}
    </main>
  );
}
