import { Component, type ErrorInfo, type ReactNode } from 'react';

interface EditorErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onBack: () => void;
  readonly backLabel?: string;
}

interface EditorErrorBoundaryState {
  readonly message: string | null;
}

/**
 * Subject editors are loaded on demand, so their failures arrive after the
 * portal has already rendered. Without a boundary a failed chunk or a missing
 * component catalog would take the whole application down with a blank page;
 * the learner needs an honest message and a way out instead.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  override state: EditorErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): EditorErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { message: message || 'Не удалось загрузить учебную среду.' };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Diagnostics only: no project content, no learner data.
    console.error('editor failed to load', {
      message: error instanceof Error ? error.message : String(error),
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>Учебная среда не загрузилась</h1>
          <p>{this.state.message}</p>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={this.props.onBack}>
              {this.props.backLabel ?? 'К проектам'}
            </button>
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Попробовать снова
            </button>
          </div>
        </section>
      </main>
    );
  }
}
