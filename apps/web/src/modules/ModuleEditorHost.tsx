import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { api, type PublicUser } from '../api';
import { ChessModuleExperience } from '../chess/ChessModuleExperience';
import { chessRouteFromHash, chessRouteToHash } from '../chess/chess-navigation';
import { loadCheckersEditor } from '../checkers/load-checkers-editor';
import { threeDEditorHash, type CreatorPortalReturnView } from '../creator-portal/navigation';
import { loadSchematicEditor } from '../electronics/load-schematic-editor';
import { EditorErrorBoundary } from './EditorErrorBoundary';

interface ModuleEditorProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

interface ModuleEditorHostProps extends ModuleEditorProps {
  onModuleResolved?: (projectId: string, moduleKey: string) => void;
  returnTo: CreatorPortalReturnView;
}

const EDITORS: Readonly<Record<string, ComponentType<ModuleEditorProps>>> = {
  electronics: lazy(loadSchematicEditor),
  chess: ChessModuleExperience,
  checkers: lazy(loadCheckersEditor),
  'three-d': lazy(() =>
    import('../three-d/ThreeDEditor').then((module) => ({ default: module.ThreeDEditor })),
  ),
};

type HostState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; moduleKey: string; projectTitle: string };

/** Shared editor host. Project Core selects a module by manifest key; the host
 * mounts the registered subject editor without putting subject branches in App. */
export function ModuleEditorHost(props: ModuleEditorHostProps): JSX.Element {
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
      const moduleKey = result.data.project.moduleKey;
      props.onModuleResolved?.(props.projectId, moduleKey);
      const canonicalHash =
        moduleKey === 'three-d'
          ? threeDEditorHash(props.projectId, props.returnTo)
          : moduleKey === 'chess'
            ? chessRouteToHash(
                props.projectId,
                chessRouteFromHash(window.location.hash, props.projectId),
              )
            : null;
      if (canonicalHash && window.location.hash !== canonicalHash) {
        window.history.replaceState(null, '', canonicalHash);
      }
      setState({ kind: 'ready', moduleKey, projectTitle: result.data.project.title });
    });
    return () => {
      active = false;
    };
  }, [props.onModuleResolved, props.projectId, props.returnTo]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const previousTitle = document.title;
    const moduleTitle =
      state.moduleKey === 'three-d'
        ? 'ASA 3D'
        : state.moduleKey === 'chess'
          ? 'ASA Chess'
          : 'ASA Lab';
    document.title = `${state.projectTitle} · ${moduleTitle}`;
    return () => {
      document.title = previousTitle;
    };
  }, [state]);

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
    <EditorErrorBoundary onBack={props.onBack}>
      <Suspense
        fallback={
          <main className="page-center" role="status" aria-live="polite">
            Загружаем учебную среду…
          </main>
        }
      >
        <Editor projectId={props.projectId} onBack={props.onBack} user={props.user} />
      </Suspense>
    </EditorErrorBoundary>
  );
}
