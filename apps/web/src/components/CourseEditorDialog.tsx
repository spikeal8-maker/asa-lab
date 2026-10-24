import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/** Keeps the canvas mounted; preview is a screen so existing image portals stay usable. */
export function CourseEditorDialog({
  open,
  inline = false,
  screen = false,
  title,
  closeLabel,
  closeDisabled = false,
  className = '',
  returnFocusRef,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly inline?: boolean;
  readonly screen?: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly closeDisabled?: boolean;
  readonly className?: string;
  readonly returnFocusRef?: RefObject<HTMLElement>;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (inline) dialog.setAttribute('open', '');
    else if (open) {
      if (screen) {
        returnTarget.current =
          previousFocus instanceof HTMLElement &&
          previousFocus !== document.body &&
          previousFocus.getClientRects().length > 0
            ? previousFocus
            : (returnFocusRef?.current ?? null);
        dialog.show();
        closeRef.current?.focus();
      } else dialog.showModal();
    } else if (screen && returnTarget.current) {
      // The document is visible again before this layout effect restores focus.
      if (returnTarget.current.isConnected) returnTarget.current.focus();
      returnTarget.current = null;
    }
    const previousOverflow = document.documentElement.style.overflow;
    if (!inline && !screen && open) document.documentElement.style.overflow = 'hidden';
    return () => {
      if (dialog.open) dialog.close();
      if (!inline && !screen && open) document.documentElement.style.overflow = previousOverflow;
    };
  }, [inline, open, screen, returnFocusRef]);
  return (
    <dialog
      ref={ref}
      className={`course-editor-dialog ${className}`.trim()}
      data-inline={inline ? 'true' : undefined}
      data-screen={screen ? 'true' : undefined}
      role={inline ? 'presentation' : 'dialog'}
      aria-label={inline ? undefined : title}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // React portals bubble here too. Their own image dialog owns Escape.
        if (!event.currentTarget.contains(event.target as Node)) return;
        const externalDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
          (element) =>
            element !== event.currentTarget &&
            !event.currentTarget.contains(element) &&
            element.getClientRects().length > 0,
        );
        if (externalDialog) return;
        // Escape first closes the current disclosure, then the dialog itself.
        const menu = ref.current?.querySelector<HTMLDetailsElement>('details[open]');
        if (menu) {
          event.preventDefault();
          event.stopPropagation();
          menu.open = false;
          menu.querySelector('summary')?.focus();
        } else if (screen && !closeDisabled) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {!inline ? (
        <header className="course-dialog-header">
          <h3>{title}</h3>
          <button
            ref={closeRef}
            type="button"
            className="btn-secondary"
            disabled={closeDisabled}
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </header>
      ) : null}
      {children}
    </dialog>
  );
}
