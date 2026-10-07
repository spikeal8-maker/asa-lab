import { useEffect, useRef, useState, type RefObject } from 'react';

export const settingsPanels = {
  profile: 'Профиль',
  interface: 'Интерфейс',
  notifications: 'Уведомления',
  security: 'Вход и безопасность',
  privacy: 'Данные и приватность',
  capabilities: 'Возможности',
  school: 'Мои доступы',
  requests: 'Приглашения и запросы',
} as const;
export type SettingsPanel = keyof typeof settingsPanels;
export function settingsPanelFromLocation(): SettingsPanel {
  const panel = window.location.hash.split('/')[2];
  return panel && Object.hasOwn(settingsPanels, panel) ? (panel as SettingsPanel) : 'profile';
}

let guard: ((proceed: () => void) => void) | null = null;
let dirtySettings: (() => boolean) | null = null;
let pendingSettings: (() => boolean) | null = null;
export function isSettingsNavigationPending(): boolean {
  return pendingSettings?.() ?? false;
}
export function hasSettingsDraft(): boolean {
  return dirtySettings?.() ?? false;
}
export function historyEntryIndex(): number | null {
  const browser = window as Window & { navigation?: { currentEntry?: { index: number } } };
  return browser.navigation?.currentEntry?.index ?? window.history.state?.asaRouteIndex ?? null;
}
export function pushSettingsAwareLocation(href: string): void {
  const index = window.history.state?.asaRouteIndex ?? 0;
  window.history.pushState({ asaRouteIndex: index + 1 }, '', href);
}
/** Opt-in for the settings surface; all other router consumers proceed normally. */
export function requestSettingsNavigation(proceed: () => void): void {
  if (guard) guard(proceed);
  else proceed();
}

export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    if (!open || !ref.current) return;
    const opener = document.activeElement;
    const dialog = ref.current;
    const focusable = () => [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
      ),
    ];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusable()[0]?.focus();
    };
    document.addEventListener('keydown', trap);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', trap);
      document.removeEventListener('focusin', containFocus);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open, ref]);
}

export interface SettingsDraft {
  dirty: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}
export function useSettingsDraftGuard(drafts: readonly SettingsDraft[]) {
  const latest = useRef(drafts);
  latest.current = drafts;
  const pending = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(open, dialog);
  useEffect(() => {
    const protect = (proceed: () => void) => {
      if (!latest.current.some((draft) => draft.dirty)) {
        proceed();
        return;
      }
      if (pending.current) return;
      pending.current = proceed;
      setError('');
      setOpen(true);
    };
    guard = protect;
    const isDirty = () => latest.current.some((draft) => draft.dirty);
    dirtySettings = isDirty;
    const isPending = () => pending.current !== null;
    pendingSettings = isPending;
    const unload = (event: BeforeUnloadEvent) => {
      if (!latest.current.some((draft) => draft.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target || anchor.download) return;
      const target = new URL(anchor.href);
      if (
        target.origin !== location.origin ||
        !target.hash.startsWith('#/') ||
        target.href === location.href
      )
        return;
      if (!latest.current.some((draft) => draft.dirty)) return;
      event.preventDefault();
      event.stopPropagation();
      protect(() => {
        window.location.href = target.href;
      });
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      if (guard === protect) guard = null;
      if (dirtySettings === isDirty) dirtySettings = null;
      window.dispatchEvent(new Event('settings-draft-state'));
      if (pendingSettings === isPending) pendingSettings = null;
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, []);
  const isAnyDirty = drafts.some((draft) => draft.dirty);
  useEffect(() => {
    window.dispatchEvent(new Event('settings-draft-state'));
  }, [isAnyDirty]);
  const stay = () => {
    if (busy) return;
    pending.current = null;
    setOpen(false);
  };
  const proceed = () => {
    const action = pending.current;
    pending.current = null;
    setOpen(false);
    action?.();
  };
  const modal = open ? (
    <div className="account-avatar-backdrop">
      <section
        ref={dialog}
        className="account-draft-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-draft-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') stay();
        }}
      >
        <h2 id="settings-draft-title">Несохранённые изменения</h2>
        <p>Сохраните настройки перед переходом или отмените изменения.</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="account-form-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                for (const draft of latest.current.filter((entry) => entry.dirty)) {
                  if (!(await draft.save())) {
                    setError(
                      'Не удалось сохранить изменения. Проверьте форму и повторите попытку.',
                    );
                    return;
                  }
                }
                proceed();
              } catch {
                setError('Не удалось сохранить изменения. Попробуйте ещё раз.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Сохраняем…' : 'Сохранить и перейти'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              latest.current.filter((draft) => draft.dirty).forEach((draft) => draft.discard());
              proceed();
            }}
          >
            Отменить изменения и перейти
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={stay}>
            Остаться
          </button>
        </div>
      </section>
    </div>
  ) : null;
  return modal;
}
