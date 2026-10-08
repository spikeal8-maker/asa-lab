import { Component, Suspense, type ReactNode } from 'react';
import { AppBootShell } from './AppBootShell';
import './page-delivery.css';

interface PageDeliveryProps {
  readonly children: ReactNode;
  readonly label: string;
  readonly onBack: () => void;
  readonly backLabel: string;
  readonly embedded?: boolean;
}

/** A delivery failure must leave a usable exit while the page itself stays unchanged. */
export class PageDeliveryBoundary extends Component<PageDeliveryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    const className = this.props.embedded
      ? 'page-delivery page-delivery--embedded'
      : 'page-delivery';
    if (this.state.failed) {
      return (
        <div
          className={className}
          {...(this.props.embedded ? { id: 'main-content', tabIndex: -1 } : {})}
        >
          <main className="page-delivery-error">
            <section className="page-delivery-card" role="alert">
              <h1>Страница не загрузилась</h1>
              <p>Проверьте соединение и попробуйте снова.</p>
              <div className="page-delivery-actions">
                <button type="button" className="btn-secondary" onClick={this.props.onBack}>
                  {this.props.backLabel}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => window.location.reload()}
                >
                  Попробовать снова
                </button>
              </div>
            </section>
          </main>
        </div>
      );
    }
    return (
      <Suspense
        fallback={
          <div
            className={className}
            {...(this.props.embedded ? { id: 'main-content', tabIndex: -1 } : {})}
          >
            <AppBootShell label={this.props.label} />
          </div>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
