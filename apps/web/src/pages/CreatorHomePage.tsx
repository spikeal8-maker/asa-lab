import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, type ModuleSummary, type Project, type SessionPayload } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { PlusIcon } from '../electronics/workbench-icons';
import { creatorHomeState } from '../creator-portal/navigation';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';

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
  onNavigate,
  onOpenProject,
}: {
  session: SessionPayload;
  canTeach: boolean;
  onNavigate: (
    section: 'projects' | 'learning' | 'collections' | 'challenges' | 'classes' | 'help',
  ) => void;
  onOpenProject: (projectId: string) => void;
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
        <div className="creator-dashboard-banner-copy">
          <p className="creator-dashboard-context">{activeWorkspace}</p>
          <h1 id="creator-banner-title">Проектируйте и обучайте в ASA Lab</h1>
          <p>Создавайте модели, схемы и учебные проекты в одном рабочем пространстве.</p>
          <button
            type="button"
            className="creator-banner-action"
            onClick={() => onNavigate(canTeach ? 'classes' : 'learning')}
          >
            {canTeach ? 'Открыть классы' : 'Перейти к обучению'}
          </button>
        </div>
      </section>

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

                <ul className="creator-module-grid">
                  {visibleProjects.map((project) => (
                    <li className="creator-dashboard-project" key={project.id}>
                      <button type="button" onClick={() => onOpenProject(project.id)}>
                        <span className="creator-dashboard-project-preview">
                          <span className="creator-preview-orbit" aria-hidden="true" />
                          <ModuleGlyph module={module} size={78} />
                        </span>
                        <span className="creator-dashboard-project-meta">
                          <strong>{project.title}</strong>
                          <small>{formatRelativeDate(project.updatedAt)}</small>
                          <span>
                            <small>Личный проект</small>
                            <small aria-hidden="true">•••</small>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {visibleProjects.length < PROJECTS_PER_MODULE ? (
                    <li className="creator-dashboard-project create-project">
                      <button type="button" onClick={() => openCreate(module.moduleKey)}>
                        <span className="creator-dashboard-create-icon" aria-hidden="true">
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
            onOpenProject(project.id);
          }}
        />
      ) : null}
    </main>
  );
}
