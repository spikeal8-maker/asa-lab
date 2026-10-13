import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { api, type PublicUser } from '../api';
import { loadChessEditor } from '../chess/load-chess-editor';
import { chessRouteFromHash, chessRouteToHash } from '../chess/chess-navigation';
import { loadCheckersEditor } from '../checkers/load-checkers-editor';
import { threeDEditorHash, type CreatorPortalReturnView } from '../creator-portal/navigation';
import { loadSchematicEditor } from '../electronics/load-schematic-editor';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { AssignmentBrief } from '../components/AssignmentBrief';
import { ProjectSaveEvidence } from './project-save-evidence';
import { AppBootShell } from '../components/AppBootShell';
import { beginDiagnosticContext } from '../client-diagnostics';
import { isGameModule } from '../games/game-catalog';
import { BlocksEditor } from '../blocks/BlocksEditor';
import { analyticsSessionTransport } from '../analytics-runtime';
import { actorKey, type TelemetryActor } from '../telemetry-contract';
import { trackInputActivity } from '../activity-lifecycle';
import { useEditorAvatar } from '../components/editor-chrome/EditorAvatar';

interface ModuleEditorProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
  readonly seatLearner?: boolean;
  readonly telemetryActor?: TelemetryActor | null;
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

function BlocksEditorAdapter(props: ModuleEditorProps): JSX.Element {
  const avatar = useEditorAvatar(props.user);
  return (
    <BlocksEditor
      projectId={props.projectId}
      recoveryPrincipalKey={props.user.id}
      telemetryActor={props.telemetryActor ?? null}
      onBack={props.onBack}
      onHomeClick={() => {
        window.location.hash = '/home';
      }}
      accountLabel={props.user.displayName}
      accountInitials={avatar.text}
      avatarUrl={avatar.src}
      onAccountClick={() => {
        window.location.hash = '/account';
      }}
    />
  );
}

const EDITORS: Readonly<Record<string, ComponentType<ModuleEditorProps>>> = {
  blocks: BlocksEditorAdapter,
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
    if (state.kind === 'ready' && state.moduleKey === 'electronics')
      return beginDiagnosticContext('electronics');
    return undefined;
  }, [state.kind, state.kind === 'ready' ? state.moduleKey : null, props.projectId]);

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
    if (
      state.kind !== 'ready' ||
      state.moduleKey === 'blocks' ||
      !Object.hasOwn(EDITORS, state.moduleKey)
    )
      return;
    const key = `${props.projectId}:${state.moduleKey}:${actorKey(props.telemetryActor ?? null)}`;
    if (recordedOpen.current === key) return;
    recordedOpen.current = key;
    const moduleKey = state.moduleKey as 'electronics' | 'three-d' | 'chess' | 'checkers';
    const activity = trackInputActivity(
      props.projectId,
      analyticsSessionTransport(props.telemetryActor ?? null, moduleKey),
      90_000,
    );
    activity.setReady(true);
    // A cancellable first observation avoids StrictMode's development probe.
    const startTimer = window.setTimeout(() => activity.input(), 0);
    const interaction = (): void => activity.input();
    window.addEventListener('pointerdown', interaction, { passive: true });
    window.addEventListener('keydown', interaction, { passive: true });
    return () => {
      if (recordedOpen.current === key) recordedOpen.current = null;
      window.clearTimeout(startTimer);
      window.removeEventListener('pointerdown', interaction);
      window.removeEventListener('keydown', interaction);
      activity.dispose();
    };
  }, [props.projectId, state, props.telemetryActor]);

  const game = isGameModule(props.moduleKey) || props.returnTo.kind === 'games';
  const backLabel = game ? 'К играм' : 'К проектам';
  if (state.kind === 'loading') {
    return <AppBootShell label={game ? 'Открываем игру' : 'Открываем проект'} />;
  }
  if (state.kind === 'error') {
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>{game ? 'Игра не открыта' : 'Проект не открыт'}</h1>
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={props.onBack}>
            {backLabel}
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
            {backLabel}
          </button>
        </section>
      </main>
    );
  }

  return (
    <EditorErrorBoundary onBack={props.onBack} backLabel={backLabel}>
      <ProjectSaveEvidence key={props.projectId}>
        {/* What to make, while you are making it. Renders nothing for anyone
          whose project is not work a teacher set. */}
        <AssignmentBrief projectId={props.projectId} />
        <Suspense fallback={<AppBootShell label="Открываем рабочую среду" />}>
          <Editor
            projectId={props.projectId}
            onBack={props.onBack}
            user={props.user}
            seatLearner={props.seatLearner ?? false}
            telemetryActor={props.telemetryActor ?? null}
          />
        </Suspense>
      </ProjectSaveEvidence>
    </EditorErrorBoundary>
  );
}
