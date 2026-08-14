import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { api, type PublicUser } from '../api';
import { ChessModuleExperience } from '../chess/ChessModuleExperience';
import { SchematicEditor } from '../pages/SchematicEditor';

interface ModuleEditorProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

const EDITORS: Readonly<Record<string, ComponentType<ModuleEditorProps>>> = {
  electronics: SchematicEditor,
  chess: ChessModuleExperience,
  checkers: lazy(() =>
    import('../checkers/CheckersModuleExperience').then((module) => ({
      default: module.CheckersModuleExperience,
    })),
  ),
  'three-d': lazy(() =>
    import('../three-d/ThreeDEditor').then((module) => ({ default: module.ThreeDEditor })),
  ),
};

type HostState =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; moduleKey: string };

/** Shared editor host. Project Core selects a module by manifest key; the host
 * mounts the registered subject editor without putting subject branches in App. */
export function ModuleEditorHost(props: ModuleEditorProps): JSX.Element {
  const [state, setState] = useState<HostState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void api.openProject(props.projectId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setState({ kind: 'error', message: result.error.message || 'Не удалось открыть проект.' });
        return;
      }
      setState({ kind: 'ready', moduleKey: result.data.project.moduleKey });
    });
    return () => {
      active = false;
    };
  }, [props.projectId]);

  if (state.kind === 'loading') {
    return (
      <main className="page-center" role="status" aria-live="polite">
        Загружаем среду проекта…
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>Проект не открыт</h1>
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={props.onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }

  const Editor = EDITORS[state.moduleKey];
  if (!Editor) {
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>Среда пока недоступна</h1>
          <p>
            Проект использует модуль «{state.moduleKey}», для которого в этой версии ASA Lab нет
            подключённого редактора.
          </p>
          <button type="button" className="btn-secondary" onClick={props.onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }

  return (
    <Suspense
      fallback={
        <main className="page-center" role="status" aria-live="polite">
          Загружаем учебную среду…
        </main>
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
