import type { ReactNode } from 'react';
import './blocks-editor-shell.css';

export type BlocksSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface BlocksEditorShellProps {
  children: ReactNode;
  accountLabel: string;
  accountInitials: string;
  avatarUrl?: string | null;
  saveState: BlocksSaveState;
  savedRevision: number | null;
  saveDisabled: boolean;
  onSave: () => void;
  onAccountClick: () => void;
  onHomeClick: () => void;
}

function saveCopy(state: BlocksSaveState): string {
  if (state === 'saving') return 'Сохранение…';
  if (state === 'saved') return 'Сохранено';
  if (state === 'conflict') return 'Конфликт сохранения';
  if (state === 'error') return 'Ошибка сохранения';
  return 'Сохранить в ASA';
}

/**
 * Parent-owned visual shell around the isolated Scratch iframe.
 *
 * Identity and explicit save control stay in ASA Web: this component never
 * forwards account data, cookies or callbacks into the Scratch runtime. The
 * child runtime is supplied as `children` so protocol/bootstrap authority
 * remains a separate concern.
 */
export function BlocksEditorShell({
  children,
  accountLabel,
  accountInitials,
  avatarUrl = null,
  saveState,
  savedRevision,
  saveDisabled,
  onSave,
  onAccountClick,
  onHomeClick,
}: BlocksEditorShellProps): JSX.Element {
  const label = saveCopy(saveState);
  const accessibleLabel =
    saveState === 'saved' && savedRevision !== null
      ? `Сохранено в ASA, ревизия ${savedRevision}`
      : label;

  return (
    <section className="blocks-editor-shell" data-asa-blocks-editor-shell>
      <div className="blocks-editor-runtime" data-asa-blocks-runtime-slot>
        {children}
      </div>
      <button
        type="button"
        className="blocks-editor-home"
        aria-label="ASA Lab — на главную"
        title="ASA Lab — на главную"
        data-asa-blocks-home-overlay
        onClick={onHomeClick}
      />
      <button
        type="button"
        className="blocks-editor-save"
        data-asa-blocks-save
        data-save-state={saveState}
        data-confirmed-revision={savedRevision ?? undefined}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        disabled={saveDisabled}
        onClick={onSave}
      >
        <span aria-live="polite">{label}</span>
      </button>
      <button
        type="button"
        className="blocks-editor-account"
        aria-label={`Открыть аккаунт: ${accountLabel}`}
        data-asa-blocks-account-overlay
        onClick={onAccountClick}
      >
        {avatarUrl ? (
          <img className="blocks-editor-account-avatar" src={avatarUrl} alt="" />
        ) : (
          <span className="blocks-editor-account-initials" aria-hidden="true">
            {accountInitials}
          </span>
        )}
      </button>
    </section>
  );
}
