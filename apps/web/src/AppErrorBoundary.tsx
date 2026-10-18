import { Component, type ReactNode } from 'react';
import { reportRenderDiagnostic } from './client-diagnostics';

interface AppErrorBoundaryState {
  readonly failed: boolean;
}

export class AppErrorBoundary extends Component<
  { readonly children: ReactNode },
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    reportRenderDiagnostic(error, 'app_boundary');
    // Technical diagnostics only: never include the current account, project
    // document, URL query or browser storage.
    console.error('application render failed', {
      revision: __ASA_BUILD_REVISION__,
    });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>ASA Lab не удалось открыть</h1>
          <p>Обновите страницу. Ваш сохранённый проект останется в учётной записи.</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </section>
      </main>
    );
  }
}
