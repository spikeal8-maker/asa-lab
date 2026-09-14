import type { ReactNode } from 'react';
import './blocks-editor-shell.css';

export interface BlocksEditorShellProps {
  children: ReactNode;
  accountLabel: string;
  accountInitials: string;
  avatarUrl?: string | null;
  onAccountClick: () => void;
}

/**
 * Parent-owned visual shell around the isolated Scratch iframe.
 *
 * Identity stays in ASA Web: this component never forwards account data,
 * cookies or callbacks into the Scratch runtime. The child runtime is supplied
 * as `children` so protocol/bootstrap authority remains a separate concern.
 */
export function BlocksEditorShell({
  children,
  accountLabel,
  accountInitials,
  avatarUrl = null,
  onAccountClick,
}: BlocksEditorShellProps): JSX.Element {
  return (
    <section className="blocks-editor-shell" data-asa-blocks-editor-shell>
      <div className="blocks-editor-runtime" data-asa-blocks-runtime-slot>
        {children}
      </div>
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
