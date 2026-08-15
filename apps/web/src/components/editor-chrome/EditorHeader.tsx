import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import './editor-header.css';

export type EditorSaveKind = 'saved' | 'dirty' | 'saving' | 'error';

export type EditorHeaderTitle =
  | {
      kind: 'editable';
      value: string;
      ariaLabel: string;
      maxLength: number;
      onChange(value: string): void;
      onCommit(): void | Promise<void>;
      onCancel(): void;
    }
  | { kind: 'readonly'; text: string };

export interface EditorHeaderItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly emphasis?: 'neutral' | 'primary' | 'danger';
  readonly visibility?: 'always' | 'wide';
  readonly onActivate: () => void;
}

export interface EditorHeaderProps {
  readonly moduleId: string;
  readonly onExit: () => void;
  readonly exitLabel: string;
  readonly title: EditorHeaderTitle;
  readonly status?: {
    readonly kind: EditorSaveKind;
    readonly label: string;
    readonly detail?: string;
    readonly icon?: ReactNode;
  };
  readonly navigation?: {
    readonly ariaLabel: string;
    readonly items: readonly EditorHeaderItem[];
  };
  readonly actions?: readonly EditorHeaderItem[];
  readonly avatar?: {
    readonly label: string;
    readonly text: string;
    readonly title?: string;
  };
}

export type EditorHeaderTitleKeyAction = 'commit' | 'cancel' | null;

export function editorHeaderTitleKeyAction(key: string): EditorHeaderTitleKeyAction {
  if (key === 'Enter') return 'commit';
  if (key === 'Escape') return 'cancel';
  return null;
}

function itemClassName(item: EditorHeaderItem): string {
  return [
    'editor-header-item',
    item.selected ? 'is-selected' : '',
    item.emphasis ? `is-${item.emphasis}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function EditorHeaderButton({ item }: { readonly item: EditorHeaderItem }): JSX.Element {
  return (
    <button
      type="button"
      className={itemClassName(item)}
      data-item-id={item.id}
      data-visibility={item.visibility ?? 'always'}
      aria-pressed={item.selected}
      disabled={item.disabled ?? false}
      onClick={item.onActivate}
    >
      {item.icon ? (
        <span className="editor-header-item-icon" aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span className="editor-header-item-label">{item.label}</span>
    </button>
  );
}

export function EditorHeader({
  moduleId,
  onExit,
  exitLabel,
  title,
  status,
  navigation,
  actions,
  avatar,
}: EditorHeaderProps): JSX.Element {
  const skipNextTitleBlur = useRef(false);

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (title.kind !== 'editable') return;
    const action = editorHeaderTitleKeyAction(event.key);
    if (!action) return;
    event.preventDefault();
    skipNextTitleBlur.current = true;
    if (action === 'commit') void title.onCommit();
    else title.onCancel();
    event.currentTarget.blur();
  }

  return (
    <header className="editor-header" data-module-id={moduleId}>
      <div className="editor-header-brand-zone">
        <button
          type="button"
          className="editor-header-brand"
          onClick={onExit}
          aria-label={exitLabel}
          title={exitLabel}
        >
          <img
            className="editor-header-brand-mark"
            src="/asa-lab-mark.svg"
            alt=""
            aria-hidden="true"
          />
          <span className="editor-header-brand-name">ASA Lab</span>
        </button>
        {title.kind === 'editable' ? (
          <input
            className="editor-header-title-input"
            value={title.value}
            aria-label={title.ariaLabel}
            maxLength={title.maxLength}
            onChange={(event) => title.onChange(event.target.value)}
            onBlur={() => {
              if (skipNextTitleBlur.current) {
                skipNextTitleBlur.current = false;
                return;
              }
              void title.onCommit();
            }}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <strong className="editor-header-title-readonly">{title.text}</strong>
        )}
      </div>

      {status ? (
        <span
          className={`editor-header-status is-${status.kind}`}
          role="status"
          aria-live="polite"
          aria-label={status.detail ? `${status.label}: ${status.detail}` : status.label}
          title={status.detail ?? status.label}
        >
          {status.icon ? (
            <span className="editor-header-status-icon" aria-hidden="true">
              {status.icon}
            </span>
          ) : null}
          <span>{status.label}</span>
        </span>
      ) : (
        <span className="editor-header-status-spacer" aria-hidden="true" />
      )}

      <div className="editor-header-trailing">
        {navigation ? (
          <nav className="editor-header-navigation" aria-label={navigation.ariaLabel}>
            {navigation.items.map((item) => (
              <EditorHeaderButton key={item.id} item={item} />
            ))}
          </nav>
        ) : null}
        {actions?.length ? (
          <div className="editor-header-actions" role="group" aria-label="Действия проекта">
            {actions.map((item) => (
              <EditorHeaderButton key={item.id} item={item} />
            ))}
          </div>
        ) : null}
        {avatar ? (
          <span
            className="editor-header-avatar"
            aria-label={avatar.label}
            title={avatar.title ?? avatar.label}
          >
            {avatar.text}
          </span>
        ) : null}
      </div>
    </header>
  );
}
