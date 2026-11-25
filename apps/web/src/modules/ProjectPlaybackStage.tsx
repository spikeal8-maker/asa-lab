import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../components/settings-navigation';
import '../components/work-preview.css';
import './project-playback-stage.css';

/** The same stage surrounds a saved classroom document and an authorized public artifact. */
export function ProjectPlaybackStage({ children }: { readonly children: ReactNode }): JSX.Element {
  return <div className="project-playback-stage">{children}</div>;
}

export function ProjectPreviewDialog({
  title,
  label = title,
  byline,
  children,
  busy = false,
  onClose,
}: {
  readonly title: string;
  readonly label?: string;
  readonly byline?: ReactNode;
  readonly children: ReactNode;
  readonly busy?: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialog);
  useEffect(() => {
    function escape(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.fullscreenElement && !busy)
        onClose();
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  return createPortal(
    <div className="modal-backdrop work-preview-backdrop" role="presentation">
      <div
        ref={dialog}
        className="modal work-preview"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <header className="work-preview-head">
          <div>
            <h2>{title}</h2>
            {byline && <p>{byline}</p>}
          </div>
          <button
            type="button"
            className="work-preview-close"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={onClose}
            disabled={busy}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
