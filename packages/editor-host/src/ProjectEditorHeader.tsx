import type { KeyboardEvent, ReactNode } from 'react';
import { CheckIcon } from '@asa-lab/ui-kit';

export type EditorHeaderSaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface EditorHeaderTab<ViewId extends string> {
  readonly id: ViewId;
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
}

export interface ProjectEditorHeaderProps<ViewId extends string> {
  readonly activeView: ViewId;
  readonly displayName: string;
  readonly onBack: () => void;
  readonly onTitleCancel: () => void;
  readonly onTitleChange: (title: string) => void;
  readonly onTitleCommit: () => void | Promise<void>;
  readonly onViewChange: (view: ViewId) => void;
  readonly projectTitle: string;
  readonly saveError?: string | null;
  readonly saveStatus: EditorHeaderSaveStatus;
  readonly saveText: string;
  readonly tabs: readonly EditorHeaderTab<ViewId>[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function ProjectEditorHeader<ViewId extends string>({
  activeView,
  displayName,
  onBack,
  onTitleCancel,
  onTitleChange,
  onTitleCommit,
  onViewChange,
  projectTitle,
  saveError,
  saveStatus,
  saveText,
  tabs,
}: ProjectEditorHeaderProps<ViewId>): JSX.Element {
  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      onTitleCancel();
      event.currentTarget.blur();
    }
  };

  return (
    <header className="editor-host-header">
      <div className="editor-host-brand-zone">
        <button type="button" className="editor-host-brand" onClick={onBack} aria-label="ASA Lab">
          <img
            className="editor-host-brand-mark"
            src="/asa-lab-mark.svg"
            alt=""
            aria-hidden="true"
          />
          <span className="editor-host-brand-name">ASA Lab</span>
        </button>
        <input
          className="editor-host-title-input"
          value={projectTitle}
          aria-label="Название проекта"
          maxLength={255}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={() => void onTitleCommit()}
          onKeyDown={handleTitleKeyDown}
        />
      </div>
      <span className={`editor-host-save-state ${saveStatus}`} title={saveError ?? undefined}>
        {saveStatus === 'saved' ? <CheckIcon /> : null}
        {saveText}
      </span>
      <nav className="editor-host-mode-buttons" aria-label="Представления проекта">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeView === tab.id ? 'active' : ''}
            type="button"
            title={tab.label}
            aria-label={tab.label}
            aria-pressed={activeView === tab.id}
            disabled={tab.disabled}
            onClick={() => onViewChange(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
        <span className="editor-host-avatar" title={displayName}>
          {initials(displayName)}
        </span>
      </nav>
    </header>
  );
}
