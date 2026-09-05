import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, type ModuleSummary, type Project, type SessionPayload } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { PlusIcon } from '../electronics/workbench-icons';
import { creatorHomeState, creatorViewToHref } from '../creator-portal/navigation';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';
import { ProjectCard } from '../modules/ProjectCard';

const PROJECTS_PER_MODULE = 4;
const HOME_MODULE_ORDER = ['three-d', 'electronics'] as const;

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
  onNavigate,
  onOpenProject,
}: {
  session: SessionPayload;
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

  async function toggleShare(project: Project): Promise<void> {
    setBusyProject(project.id);
    const isShared = shared.has(project.id);
    const result = isShared
      ? await api.unpublishFromGallery(project.id)
      : await api.publishToGallery(project.id);
    setBusyProject(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось поделиться работой.');
      return;
    }
    setShared((current) => {
      const next = new Set(current);
      if (isShared) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
  }

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    setProjects(null);
    setError(null);
    const [projectsResult, modulesResult, sharedResult] = await Promise.all([
      api.listProjects({ scope: 'personal' }),
      api.listProjectModules(),
      api.myGalleryProjects(),
    ]);
    if (sharedResult.ok) setShared(new Set(sharedResult.data.projectIds));
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
  // Which of these are on the gallery wall, so the menu says the truth here as
  // well as on the projects page — sharing has to be reachable from wherever a
  // person is looking at their work.
  const [shared, setShared] = useState<ReadonlySet<string>>(new Set());

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

  function openCreate(moduleKey?: string): void {
    setCreatingModule(moduleKey);
    setCreating(true);
  }

  return (
    <main className="portal-content creator-home" id="main-content" tabIndex={-1}>
      {/* The banner is gone. It sold the product to someone already inside it,
          and half of it was a decorative strip of module glyphs — the one thing
          on the page that could not tell you anything. Its two doors live where
          they belong: classes in the navigation, school in settings.

          What it must not take with it is the page's name: a page with no
          heading leaves a screen reader, and anyone glancing at a tab, with
          nothing to go on. */}
      <h1 className="creator-home-title">Главная</h1>

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
                          label: shared.has(project.id)
                            ? 'Убрать из галереи'
                            : 'Поделиться в галерее',
                          disabled: busyProject === project.id,
                          onSelect: () => void toggleShare(project),
                        },
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
