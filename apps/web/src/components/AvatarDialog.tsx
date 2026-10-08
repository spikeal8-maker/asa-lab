import { useEffect, useRef } from 'react';
import { useAvatarModule } from './use-avatar-module';
import { CloseIcon } from '../electronics/workbench-icons';
import type { AvatarChooserProps } from './AvatarChooser';
import './avatar-chooser.css';

/** The modal opens immediately; catalogue and image processing load on demand. */
export function AvatarDialog(
  props: AvatarChooserProps & { readonly returnFocus: HTMLElement | null },
): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const { module, failed, canRetry, retry } = useAvatarModule(true);
  const Content = module?.AvatarChooser;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>('button')?.focus();
    const focusable = () =>
      [
        ...(element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), a[href]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length > 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !element?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !element?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      element?.close();
      if (props.returnFocus?.isConnected && props.returnFocus.getClientRects().length > 0)
        props.returnFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="avatar-chooser-dialog"
      aria-labelledby="avatar-chooser-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            props.onClose();
        }
      }}
    >
      <header className="avatar-chooser-heading">
        <h2 id="avatar-chooser-title">Выберите аватар</h2>
        <button type="button" aria-label="Закрыть выбор аватара" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </header>
      {Content ? (
        <Content {...props} />
      ) : failed ? (
        <div role="alert">
          <p>Не удалось открыть выбор аватара.</p>
          <button type="button" disabled={!canRetry} onClick={retry}>
            Повторить
          </button>
        </div>
      ) : (
        <p role="status">Открываем аватары…</p>
      )}
    </dialog>
  );
}
