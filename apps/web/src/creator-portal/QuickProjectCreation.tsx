import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type ModuleSummary, type Project } from '../api';
import { newClientId } from '../client-id';

export const HOME_MODULES = ['three-d', 'electronics'] as const;
export type HomeModule = (typeof HOME_MODULES)[number];
export const homeModuleTitle = (key: string): string =>
  key === 'three-d' ? '3D-моделирование' : key === 'electronics' ? 'Электроника' : 'Проект';

type Intent = { module: HomeModule; key: string };
interface CreationContext {
  contextKey: string;
  modules: readonly ModuleSummary[] | null;
  modulesError: boolean;
  busy: boolean;
  create: (module: HomeModule) => void;
}
const Context = createContext<CreationContext | null>(null);

export function useQuickProjectCreation(): CreationContext {
  const value = useContext(Context);
  if (!value) throw new Error('Project creation provider missing');
  return value;
}

/** Only a numeric scroll position, never a private project list, is retained. */
export function useProjectScroll(ready: boolean): () => void {
  const { contextKey } = useQuickProjectCreation();
  const path = `${location.pathname}${location.search}${location.hash}`;
  const key = `asa-project-scroll:${contextKey}:${path}`;
  useEffect(() => {
    if (!ready) return;
    let y = 0;
    try {
      y = Number(sessionStorage.getItem(key) ?? 0);
    } catch {
      /* Storage can be disabled. */
    }
    const frame = requestAnimationFrame(() =>
      window.scrollTo(0, Number.isFinite(y) ? Math.max(0, y) : 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [ready, key]);
  return () => {
    try {
      sessionStorage.setItem(key, String(window.scrollY));
    } catch {
      /* Optional. */
    }
  };
}

export function QuickProjectCreation({
  contextKey,
  onCreated,
  children,
}: {
  contextKey: string;
  onCreated: (project: Project) => void;
  children: ReactNode;
}): JSX.Element {
  const storageKey = `asa-pending-create:${contextKey}`;
  const [intent, setIntent] = useState<Intent | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Intent | null;
      return saved &&
        HOME_MODULES.includes(saved.module) &&
        typeof saved.key === 'string' &&
        /^[\da-f-]{36}$/i.test(saved.key)
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const pending = useRef(intent);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modules, setModules] = useState<readonly ModuleSummary[] | null>(null);
  const [modulesError, setModulesError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setModulesError(false);
    void api.listProjectModules().then((result) => {
      if (!active) return;
      if (result.ok)
        setModules(
          result.data.items.filter(
            (module) =>
              HOME_MODULES.includes(module.moduleKey as HomeModule) &&
              module.creatable &&
              module.availability === 'active',
          ),
        );
      else setModulesError(true);
    });
    return () => {
      active = false;
    };
  }, [reload]);

  async function create(module: HomeModule): Promise<void> {
    if (inFlight.current) return;
    if (pending.current && pending.current.module !== module) {
      setError('Сначала завершите предыдущее создание. Повтор не создаст второй проект.');
      return;
    }
    if (!modules?.some((item) => item.moduleKey === module)) return;
    const next = pending.current ?? { module, key: newClientId() };
    pending.current = next;
    setIntent(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* In-memory retry remains safe. */
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createProject({
        scope: 'personal',
        module,
        automaticTitle: true,
        idempotencyKey: next.key,
      });
      if (!alive.current) return;
      if (!result.ok) {
        setError(
          result.status === 0
            ? 'Ответ сервера не получен. Повторите ту же операцию.'
            : result.error.message || 'Не удалось создать проект.',
        );
        return;
      }
      pending.current = null;
      setIntent(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* No persistent storage. */
      }
      onCreated(result.data.project);
    } catch {
      if (alive.current) setError('Ответ сервера не получен. Повторите ту же операцию.');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Context.Provider
      value={{ contextKey, modules, modulesError, busy, create: (module) => void create(module) }}
    >
      {children}
      {modulesError || intent ? (
        <div className="portal-create-notice" role={error || modulesError ? 'alert' : 'status'}>
          {modulesError ? (
            <>
              <span>Не удалось загрузить среды.</span>
              <button type="button" onClick={() => setReload((n) => n + 1)}>
                Повторить
              </button>
            </>
          ) : (
            <>
              <span>
                {busy ? 'Создаём проект…' : (error ?? 'Создание проекта ещё не подтверждено.')}
              </span>
              {!busy && intent ? (
                <button type="button" onClick={() => void create(intent.module)}>
                  Продолжить создание
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Context.Provider>
  );
}

export function QuickCreateMenu(): JSX.Element {
  const { modules, busy, create } = useQuickProjectCreation();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !details.current?.contains(event.target))
        details.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={details}
      className="portal-quick-create"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          details.current?.removeAttribute('open');
          details.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary className="portal-header-create" aria-label="Создать проект">
        <span aria-hidden="true">＋</span>
        <span className="portal-header-create-label">Создать</span>
      </summary>
      <div className="portal-create-options" aria-label="Тип нового проекта">
        {modules?.length === 0 ? (
          <span>Сейчас нет доступных сред.</span>
        ) : modules === null ? (
          <span>Загружаем среды…</span>
        ) : (
          HOME_MODULES.map((key) =>
            modules.some((module) => module.moduleKey === key) ? (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => {
                  details.current?.removeAttribute('open');
                  create(key);
                }}
              >
                <strong>{key === 'three-d' ? '3D модель' : 'Электрическая цепь'}</strong>
                <small>
                  {key === 'three-d'
                    ? 'Моделирование из объёмных фигур'
                    : 'Сборка и проверка электронных схем'}
                </small>
              </button>
            ) : null,
          )
        )}
      </div>
    </details>
  );
}
