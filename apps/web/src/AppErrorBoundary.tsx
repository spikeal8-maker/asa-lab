import { Component, type ErrorInfo, type ReactNode } from 'react';

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

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Technical diagnostics only: never include the current account, project
    // document, URL query or browser storage.
    console.error('application render failed', {
      revision: __ASA_BUILD_REVISION__,
      errorName: error instanceof Error ? error.name : 'unknown',
      component: info.componentStack?.trim().split('\n', 1)[0] ?? null,
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
