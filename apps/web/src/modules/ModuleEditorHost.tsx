import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { api, type PublicUser } from '../api';

interface ModuleEditorProps {
  projectId: string;
  onBack: () => void;
  onModuleResolved?: (moduleKey: string) => void;
  user: PublicUser;
}

const EDITORS: Readonly<Record<string, ComponentType<ModuleEditorProps>>> = {
  electronics: lazy(async () => {
    const module = await import('@asa-lab/electronics/editor');
    return { default: module.ElectronicsEditor };
  }),
  chess: lazy(async () => {
    const module = await import('@asa-lab/chess/editor');
    return { default: module.ChessEditor };
  }),
};

class ModuleFailureBoundary extends Component<
  { readonly children: ReactNode; readonly onBack: () => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('subject editor failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>Редактор временно недоступен</h1>
          <p>Основной кабинет продолжает работать. Вернитесь к проектам и повторите открытие.</p>
          <button type="button" className="btn-secondary" onClick={this.props.onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }
}

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
      props.onModuleResolved?.(result.data.project.moduleKey);
      setState({ kind: 'ready', moduleKey: result.data.project.moduleKey });
    });
    return () => {
      active = false;
    };
  }, [props.onModuleResolved, props.projectId]);

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
    <ModuleFailureBoundary key={`${state.moduleKey}:${props.projectId}`} onBack={props.onBack}>
      <Suspense
        fallback={
          <main className="page-center" role="status" aria-live="polite">
            Загружаем редактор проекта…
          </main>
        }
      >
        <Editor projectId={props.projectId} onBack={props.onBack} user={props.user} />
      </Suspense>
    </ModuleFailureBoundary>
  );
}
