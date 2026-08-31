import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { api, type PublicUser } from '../api';
import { loadChessEditor } from '../chess/load-chess-editor';
import { chessRouteFromHash, chessRouteToHash } from '../chess/chess-navigation';
import { loadCheckersEditor } from '../checkers/load-checkers-editor';
import { threeDEditorHash, type CreatorPortalReturnView } from '../creator-portal/navigation';
import { loadSchematicEditor } from '../electronics/load-schematic-editor';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { AssignmentBrief } from '../components/AssignmentBrief';
import { AppBootShell } from '../components/AppBootShell';

interface ModuleEditorProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

interface ModuleEditorHostProps extends ModuleEditorProps {
  /** Work is only ever set for a class seat, so nobody else asks for it. */
  readonly seatLearner?: boolean;
  onModuleResolved?: (projectId: string, moduleKey: string) => void;
  /** Known for every newly generated editor URL. Historical URLs omit it and
   * are resolved once through Project Core for backwards compatibility. */
  moduleKey?: string;
  returnTo: CreatorPortalReturnView;
}

const EDITORS: Readonly<Record<string, ComponentType<ModuleEditorProps>>> = {
  electronics: lazy(loadSchematicEditor),
  chess: lazy(loadChessEditor),
  checkers: lazy(loadCheckersEditor),
  'three-d': lazy(() =>
    import('../three-d/ThreeDEditor').then((module) => ({ default: module.ThreeDEditor })),
  ),
};

type HostState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; moduleKey: string; projectTitle: string | null };

function canonicalEditorHash(
  moduleKey: string,
  projectId: string,
  returnTo: CreatorPortalReturnView,
): string | null {
  if (moduleKey === 'three-d') return threeDEditorHash(projectId, returnTo);
  if (moduleKey === 'chess') {
    return chessRouteToHash(projectId, chessRouteFromHash(window.location.hash, projectId));
  }
  return null;
}

/** Shared editor host. Project Core selects a module by manifest key; the host
 * mounts the registered subject editor without putting subject branches in App. */
export function ModuleEditorHost(props: ModuleEditorHostProps): JSX.Element {
  const recordedOpen = useRef<string | null>(null);
  const [state, setState] = useState<HostState>(() =>
    props.moduleKey
      ? { kind: 'ready', moduleKey: props.moduleKey, projectTitle: null }
      : { kind: 'loading' },
  );

  useEffect(() => {
    let active = true;
    if (props.moduleKey) {
      const canonicalHash = canonicalEditorHash(props.moduleKey, props.projectId, props.returnTo);
      if (canonicalHash && window.location.hash !== canonicalHash) {
        window.history.replaceState(null, '', canonicalHash);
      }
      setState({ kind: 'ready', moduleKey: props.moduleKey, projectTitle: null });
      return () => {
        active = false;
      };
    }
    setState({ kind: 'loading' });
    void api.openProject(props.projectId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setState({ kind: 'error', message: result.error.message || 'Не удалось открыть проект.' });
        return;
      }
      const moduleKey = result.data.project.moduleKey;
      props.onModuleResolved?.(props.projectId, moduleKey);
      const canonicalHash = canonicalEditorHash(moduleKey, props.projectId, props.returnTo);
      if (canonicalHash && window.location.hash !== canonicalHash) {
        window.history.replaceState(null, '', canonicalHash);
      }
      setState({ kind: 'ready', moduleKey, projectTitle: result.data.project.title });
    });
    return () => {
      active = false;
    };
  }, [props.moduleKey, props.onModuleResolved, props.projectId, props.returnTo]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const previousTitle = document.title;
    const moduleTitle =
      state.moduleKey === 'three-d'
        ? 'ASA 3D'
        : state.moduleKey === 'chess'
          ? 'ASA Chess'
          : 'ASA Lab';
    if (state.projectTitle) document.title = `${state.projectTitle} · ${moduleTitle}`;
    return () => {
      document.title = previousTitle;
    };
  }, [state]);

  useEffect(() => {
    if (state.kind !== 'ready' || !Object.hasOwn(EDITORS, state.moduleKey)) return;
    const key = `${props.projectId}:${state.moduleKey}`;
    if (recordedOpen.current === key) return;
    recordedOpen.current = key;
    void api.recordModuleOpened(
      state.moduleKey as 'electronics' | 'three-d' | 'chess' | 'checkers',
    );
  }, [props.projectId, state]);

  if (state.kind === 'loading') {
    return <AppBootShell label="Открываем проект" />;
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
      {/* What to make, while you are making it. Renders nothing for anyone
          whose project is not work a teacher set. */}
      {props.seatLearner ? <AssignmentBrief projectId={props.projectId} /> : null}
      <Suspense fallback={<AppBootShell label="Открываем рабочую среду" />}>
        <Editor projectId={props.projectId} onBack={props.onBack} user={props.user} />
      </Suspense>
    </EditorErrorBoundary>
  );
}
