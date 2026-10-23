import { useState } from 'react';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';
import { CloseIcon, SaveIcon, ShareIcon } from './workbench-icons';

export function WorkbenchShareDialog({
  controller: c,
  onClose,
}: {
  controller: ElectronicsWorkbenchController;
  onClose: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="workbench-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="workbench-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Отправить проект"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <ShareIcon />
          <strong>Отправить проект</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>
        <label>
          <span>Ссылка на проект</span>
          <input
            readOnly
            value={window.location.href}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <div className="workbench-share-actions">
          <button type="button" onClick={() => void copyLink()}>
            <ShareIcon /> {copied ? 'Ссылка скопирована' : 'Копировать ссылку'}
          </button>
          <button type="button" onClick={() => void c.saveNow()} disabled={c.busy}>
            <SaveIcon /> Сохранить сейчас
          </button>
          <button type="button" onClick={() => void c.checkpoint()} disabled={c.busy}>
            <ShareIcon /> Создать версию
          </button>
        </div>
      </section>
    </div>
  );
}
