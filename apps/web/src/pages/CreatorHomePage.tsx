import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, type ModuleSummary, type Project, type SessionPayload } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { PlusIcon } from '../electronics/workbench-icons';
import { creatorHomeState, recentProjects } from '../creator-portal/navigation';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(date);
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

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    const [projectsResult, modulesResult] = await Promise.all([
      api.listProjects({ scope: 'personal' }),
      api.listModules(),
    ]);
    if (!projectsResult.ok || !modulesResult.ok) {
      setError(
        projectsResult.status === 0 || modulesResult.status === 0
          ? 'Сервер недоступен.'
          : 'Не удалось загрузить рабочее пространство.',
      );
      return;
    }
    setProjects(projectsResult.data.items);
    setModules(modulesResult.data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const modulesByKey = useMemo(
    () => new Map((modules ?? []).map((module) => [module.moduleKey, module])),
    [modules],
  );
  const recent = useMemo(() => recentProjects(projects ?? []), [projects]);
  const visibleState = creatorHomeState(projects, error);
  const activeWorkspace =
    session.workspaces.find(
      (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
    )?.title ?? 'Личное пространство';

  return (
    <main className="portal-content creator-home" id="main-content" tabIndex={-1}>
      <section className="creator-home-welcome">
        <div>
          <p className="portal-eyebrow">{activeWorkspace}</p>
          <h1>Здравствуйте, {firstName(session.user.displayName)}</h1>
          <p>Продолжайте недавнюю работу или начните новый проект в доступной учебной среде.</p>
        </div>
        <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
          <PlusIcon /> Создать
        </button>
      </section>

      <section className="creator-quick-actions" aria-labelledby="creator-actions-title">
        <div className="creator-section-heading">
          <div>
            <p className="creator-section-kicker">Быстрый старт</p>
            <h2 id="creator-actions-title">Что вы хотите сделать?</h2>
          </div>
        </div>
        <div className="creator-action-grid">
          <button
            type="button"
            className="creator-action-card primary"
            onClick={() => setCreating(true)}
          >
            <span aria-hidden="true">＋</span>
            <strong>Новый проект</strong>
            <small>Электроника, шахматы и другие доступные среды</small>
          </button>
          <button
            type="button"
            className="creator-action-card"
            onClick={() => onNavigate('learning')}
          >
            <span aria-hidden="true">▤</span>
            <strong>Продолжить обучение</strong>
            <small>Ориентиры по работе с проектами</small>
          </button>
          {canTeach ? (
            <button
              type="button"
              className="creator-action-card"
              onClick={() => onNavigate('classes')}
            >
              <span aria-hidden="true">◎</span>
              <strong>Открыть классы</strong>
              <small>Ученики, задания и проекты класса</small>
            </button>
          ) : (
            <button
              type="button"
              className="creator-action-card"
              onClick={() => onNavigate('collections')}
            >
              <span aria-hidden="true">◇</span>
              <strong>Открыть коллекции</strong>
              <small>Место для сохранённых материалов</small>
            </button>
          )}
        </div>
      </section>

      <section className="creator-recent" aria-labelledby="recent-projects-title">
        <div className="creator-section-heading">
          <div>
            <p className="creator-section-kicker">Недавняя работа</p>
            <h2 id="recent-projects-title">Мои проекты</h2>
          </div>
          <button
            type="button"
            className="creator-text-action"
            onClick={() => onNavigate('projects')}
          >
            Все проекты
          </button>
        </div>

        {visibleState === 'error' ? (
          <div className="creator-state" role="alert">
            <strong>Проекты сейчас не загрузились</strong>
            <p>{error}</p>
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              Повторить
            </button>
          </div>
        ) : null}

        {visibleState === 'loading' ? (
          <div className="creator-recent-grid loading" aria-label="Загрузка недавних проектов">
            <div />
            <div />
            <div />
          </div>
        ) : null}

        {visibleState === 'empty' ? (
          <div className="creator-state creator-empty">
            <span aria-hidden="true">✦</span>
            <strong>Здесь появятся ваши проекты</strong>
            <p>Создайте первый проект — он сохранится в личном рабочем пространстве.</p>
            <button type="button" className="btn-secondary" onClick={() => setCreating(true)}>
              Создать первый проект
            </button>
          </div>
        ) : null}

        {visibleState === 'ready' ? (
          <ul className="creator-recent-grid" data-testid="creator-recent-projects">
            {recent.map((project) => {
              const module = modulesByKey.get(project.moduleKey);
              const style = {
                '--module-accent': moduleAccent(project.moduleKey),
              } as CSSProperties;
              return (
                <li key={project.id} style={style}>
                  <button type="button" onClick={() => onOpenProject(project.id)}>
                    <span className="creator-project-glyph">
                      {module ? <ModuleGlyph module={module} size={42} /> : '?'}
                    </span>
                    <span className="creator-project-copy">
                      <strong>{project.title}</strong>
                      <small>
                        {module?.displayName ?? project.moduleKey} · {formatDate(project.createdAt)}
                      </small>
                    </span>
                    <span className="creator-project-open">Открыть</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="creator-discover" aria-labelledby="creator-discover-title">
        <div className="creator-section-heading">
          <div>
            <p className="creator-section-kicker">Навигация</p>
            <h2 id="creator-discover-title">Полезные разделы</h2>
          </div>
        </div>
        <div className="creator-discover-grid">
          <button type="button" onClick={() => onNavigate('learning')}>
            <strong>Обучение</strong>
            <span>Начните с понятного маршрута по средам ASA Lab.</span>
          </button>
          <button type="button" onClick={() => onNavigate('challenges')}>
            <strong>Испытания</strong>
            <span>Практические идеи без неподтверждённых достижений.</span>
          </button>
          <button type="button" onClick={() => onNavigate('help')}>
            <strong>Помощь</strong>
            <span>Ответы о проектах, сохранении и рабочих пространствах.</span>
          </button>
        </div>
      </section>

      {creating ? (
        <CreateProjectModal
          scope="personal"
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setCreating(false);
            onOpenProject(project.id);
          }}
        />
      ) : null}
    </main>
  );
}
