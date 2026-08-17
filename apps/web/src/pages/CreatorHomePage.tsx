import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, type ModuleSummary, type Project, type SessionPayload } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { SeatAssignments } from '../components/SeatAssignments';
import { PlusIcon } from '../electronics/workbench-icons';
import { creatorHomeState, creatorViewToHref } from '../creator-portal/navigation';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';
import { ProjectCard } from '../modules/ProjectCard';

const PROJECTS_PER_MODULE = 4;
const HOME_MODULE_ORDER = ['three-d', 'electronics', 'chess'] as const;

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const elapsedDays = Math.round((date.getTime() - Date.now()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });
  if (Math.abs(elapsedDays) < 30) return formatter.format(elapsedDays, 'day');
  const elapsedMonths = Math.round(elapsedDays / 30);
  if (Math.abs(elapsedMonths) < 12) return formatter.format(elapsedMonths, 'month');
  return formatter.format(Math.round(elapsedMonths / 12), 'year');
}

function sortProjects(projects: readonly Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const timeDifference = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    return timeDifference === 0 ? left.title.localeCompare(right.title, 'ru') : timeDifference;
  });
}

export function CreatorHomePage({
  session,
  canTeach,
  seatLearner = false,
  onNavigate,
  onOpenProject,
}: {
  session: SessionPayload;
  canTeach: boolean;
  /** A class seat: the only kind of person who can have work set for them. */
  seatLearner?: boolean;
  onNavigate: (
    section:
      'projects' | 'learning' | 'collections' | 'challenges' | 'classes' | 'help' | 'account',
  ) => void;
  onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingModule, setCreatingModule] = useState<string | undefined>();
  const loadSequence = useRef(0);
  const activeWorkspaceId = session.activeWorkspace.workspaceId;

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    setProjects(null);
    setError(null);
    const [projectsResult, modulesResult] = await Promise.all([
      api.listProjects({ scope: 'personal' }),
      api.listModules(),
    ]);
    if (sequence !== loadSequence.current) return;
    if (!projectsResult.ok || !modulesResult.ok) {
      setError(
        projectsResult.status === 0 || modulesResult.status === 0
          ? 'Сервер недоступен.'
          : 'Не удалось загрузить проекты.',
      );
      return;
    }
    setProjects(projectsResult.data.items);
    setModules(modulesResult.data.items);
  }, [activeWorkspaceId]);

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  // The card menu offers the actions that are a single decision. Renaming needs
  // a field and a confirmation, so it stays where a project is managed rather
  // than glanced at.
  const [busyProject, setBusyProject] = useState<string | null>(null);

  async function runProjectAction(
    project: Project,
    action: () => Promise<{ readonly ok: boolean; readonly error?: { readonly message: string } }>,
    failure: string,
  ): Promise<void> {
    setBusyProject(project.id);
    const result = await action();
    setBusyProject(null);
    if (!result.ok) {
      setError(result.error?.message || failure);
      return;
    }
    await load();
  }

  const activeModules = useMemo(
    () =>
      (modules ?? [])
        .filter((module) => module.availability === 'active' && module.creatable)
        .sort((left, right) => {
          const leftIndex = HOME_MODULE_ORDER.indexOf(
            left.moduleKey as (typeof HOME_MODULE_ORDER)[number],
          );
          const rightIndex = HOME_MODULE_ORDER.indexOf(
            right.moduleKey as (typeof HOME_MODULE_ORDER)[number],
          );
          return (
            (leftIndex < 0 ? HOME_MODULE_ORDER.length : leftIndex) -
              (rightIndex < 0 ? HOME_MODULE_ORDER.length : rightIndex) ||
            left.displayName.localeCompare(right.displayName, 'ru')
          );
        }),
    [modules],
  );
  const projectsByModule = useMemo(() => {
    const grouped = new Map<string, Project[]>();
    for (const project of sortProjects(projects ?? [])) {
      const group = grouped.get(project.moduleKey) ?? [];
      group.push(project);
      grouped.set(project.moduleKey, group);
    }
    return grouped;
  }, [projects]);
  const visibleState = creatorHomeState(projects, error);
  const activeWorkspace =
    session.workspaces.find(
      (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
    )?.title ?? 'Личное пространство';

  function openCreate(moduleKey?: string): void {
    setCreatingModule(moduleKey);
    setCreating(true);
  }

  return (
    <main className="portal-content creator-home" id="main-content" tabIndex={-1}>
      <section className="creator-dashboard-banner" aria-labelledby="creator-banner-title">
        <div className="creator-dashboard-art" aria-hidden="true">
          {activeModules.slice(0, 3).map((module, index) => (
            <span
              key={module.moduleKey}
              className={`creator-dashboard-art-tile tile-${index + 1}`}
              style={{ '--module-accent': moduleAccent(module.moduleKey) } as CSSProperties}
            >
              <ModuleGlyph module={module} size={70} />
            </span>
          ))}
        </div>
        {/*
          The banner answers "what is this place for", which is the one thing a
          first visit needs and the one thing a decorative strip cannot say. The
          three answers are the three ways ASA Lab is used, and each is a button
          rather than a claim.
        */}
        <div className="creator-dashboard-banner-copy">
          <p className="creator-dashboard-context">{activeWorkspace}</p>
          <h1 id="creator-banner-title">Проектируйте сами, ведите класс, подключите школу</h1>
          <p>
            Модели, схемы, шахматы и шашки — в одном месте. Класс может открыть любой взрослый:
            ученикам не нужны свои аккаунты. Школа добавляет общее пространство и коллег-учителей.
          </p>
          {/*
            Creating a project already has its button in the header, so the
            banner offers only the two things a person cannot otherwise find:
            where classes live and how a school is connected. Managing a class
            stays behind the educator capability, so that door is only shown to
            someone who can walk through it.
          */}
          <div className="creator-banner-actions">
            {canTeach ? (
              <button
                type="button"
                className="creator-banner-action"
                onClick={() => onNavigate('classes')}
              >
                Открыть классы
              </button>
            ) : null}
            <button
              type="button"
              className={`creator-banner-action${canTeach ? ' secondary' : ''}`}
              onClick={() => onNavigate('account')}
            >
              Подключить школу
            </button>
          </div>
        </div>
      </section>

      {/* Work a teacher set, above a learner's own gallery: a task with a
          deadline outranks a shelf of models. Renders nothing for anyone who
          has no teacher, so an account holder's home page is unchanged. */}
      {seatLearner ? <SeatAssignments onOpenProject={onOpenProject} /> : null}

      {visibleState === 'error' ? (
        <section className="creator-dashboard-state" role="alert">
          <strong>Проекты сейчас не загрузились</strong>
          <p>{error}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </section>
      ) : null}

      {visibleState === 'loading' ? (
        <section className="creator-dashboard-loading" aria-label="Загрузка проектов">
          <div />
          <div />
          <div />
          <div />
        </section>
      ) : null}

      {visibleState === 'empty' || visibleState === 'ready' ? (
        <div className="creator-module-feed" data-testid="creator-recent-projects">
          {activeModules.map((module) => {
            const moduleProjects = projectsByModule.get(module.moduleKey) ?? [];
            const visibleProjects = moduleProjects.slice(0, PROJECTS_PER_MODULE);
            const hiddenCount = Math.max(0, moduleProjects.length - visibleProjects.length);
            const style = { '--module-accent': moduleAccent(module.moduleKey) } as CSSProperties;

            return (
              <section
                className="creator-module-section"
                aria-labelledby={`creator-module-${module.moduleKey}`}
                key={module.moduleKey}
                style={style}
              >
                <div className="creator-module-heading">
                  <h2 id={`creator-module-${module.moduleKey}`}>
                    <span aria-hidden="true">
                      <ModuleGlyph module={module} size={24} />
                    </span>
                    {module.displayName}
                  </h2>
                  {moduleProjects.length > PROJECTS_PER_MODULE ? (
                    <button type="button" onClick={() => onNavigate('projects')}>
                      Показать ещё {hiddenCount}
                      <span aria-hidden="true">›</span>
                    </button>
                  ) : (
                    <button type="button" onClick={() => onNavigate('projects')}>
                      Все проекты
                      <span aria-hidden="true">›</span>
                    </button>
                  )}
                </div>

                <ul className="project-card-grid">
                  {visibleProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      module={module}
                      timeLabel={formatRelativeDate(project.updatedAt)}
                      footerLabel="Личный проект"
                      open={{
                        href: creatorViewToHref({
                          kind: 'editor',
                          projectId: project.id,
                          moduleKey: project.moduleKey,
                          returnTo: { kind: 'home' },
                        }),
                        onNavigate: () => onOpenProject(project.id, project.moduleKey),
                      }}
                      menuItems={[
                        {
                          label: 'Дублировать',
                          disabled: busyProject === project.id,
                          onSelect: () =>
                            void runProjectAction(
                              project,
                              () =>
                                api.duplicateProject(
                                  project.id,
                                  `${project.title} — копия`,
                                  crypto.randomUUID(),
                                ),
                              'Не удалось дублировать проект.',
                            ),
                        },
                        {
                          label: 'Архивировать',
                          disabled: busyProject === project.id,
                          onSelect: () =>
                            void runProjectAction(
                              project,
                              () => api.changeProjectStatus(project.id, 'archived'),
                              'Не удалось архивировать проект.',
                            ),
                        },
                        {
                          label: 'В корзину',
                          danger: true,
                          disabled: busyProject === project.id,
                          onSelect: () =>
                            void runProjectAction(
                              project,
                              () => api.changeProjectStatus(project.id, 'trashed'),
                              'Не удалось переместить проект в корзину.',
                            ),
                        },
                      ]}
                    />
                  ))}
                  {visibleProjects.length < PROJECTS_PER_MODULE ? (
                    <li className="project-card is-new">
                      <button type="button" onClick={() => openCreate(module.moduleKey)}>
                        <span className="project-card-new-icon" aria-hidden="true">
                          <PlusIcon />
                        </span>
                        <strong>Новый проект</strong>
                        <small>{module.displayName}</small>
                      </button>
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}

      {creating ? (
        <CreateProjectModal
          scope="personal"
          initialModule={creatingModule}
          onClose={() => {
            setCreating(false);
            setCreatingModule(undefined);
          }}
          onCreated={(project) => {
            setCreating(false);
            setCreatingModule(undefined);
            onOpenProject(project.id, project.moduleKey);
          }}
        />
      ) : null}
    </main>
  );
}
