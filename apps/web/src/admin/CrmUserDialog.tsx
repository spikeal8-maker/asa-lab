import { useEffect, useId, useRef, type ReactNode } from 'react';
import './crm-user-card.css';

/** A single top-layer card: the directory keeps its position behind the dialog. */
export function CrmUserDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal?.();
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="crm-user-dialog"
      aria-labelledby={heading}
      onCancel={onClose}
      onClose={onClose}
    >
      <header className="crm-user-dialog-heading">
        <div>
          <span>Карточка пользователя</span>
          <h2 id={heading}>{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть карточку пользователя">
          Закрыть ×
        </button>
      </header>
      <div className="crm-user-dialog-content">{children}</div>
    </dialog>
  );
}
