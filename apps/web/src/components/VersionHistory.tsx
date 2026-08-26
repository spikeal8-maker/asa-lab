import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectVersion } from '../api';
import { useSchoolTime } from './school-time';
import './version-history.css';

/**
 * The history of a project, and the way back into it.
 *
 * Children build by trying things, and the try that goes wrong is the one that
 * teaches — as long as there is a way back. Until now a version could be saved
 * and never returned to, which made the button a write-only button.
 *
 * Going back does not throw anything away: what was on screen is saved as its
 * own version first, so a learner who pressed the wrong row can press their way
 * back out. Nothing here ever deletes.
 */
export function VersionHistory({
  projectId,
  versions,
  triggerLabel = 'История',
  onShare,
  onSaveVersion,
  onRestored,
}: {
  readonly projectId: string;
  /** What the editor already knows, so the panel opens filled rather than blank. */
  readonly versions: readonly ProjectVersion[];
  readonly triggerLabel?: string;
  readonly onShare?: () => Promise<void>;
  readonly onSaveVersion: () => Promise<void>;
  readonly onRestored: (document: unknown, serverRevision: number) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<readonly ProjectVersion[]>(versions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareDone, setShareDone] = useState(false);
  const time = useSchoolTime();

  useEffect(() => {
    setItems(versions);
  }, [versions]);

  const reload = useCallback(async () => {
    const result = await api.listVersions(projectId);
    if (result.ok) setItems(result.data.versions);
  }, [projectId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function restore(version: ProjectVersion): Promise<void> {
    setBusy(version.id);
    setError(null);
    const result = await api.restoreVersion(projectId, version.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось вернуться к этой версии.');
      return;
    }
    setItems(result.data.versions);
    onRestored(result.data.draft.document, result.data.draft.revision);
    setOpen(false);
  }

  return (
    <div className="version-history">
      <button
        type="button"
        className="asa3d-version-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {triggerLabel}
      </button>

      {open ? (
        <>
          {/* Pressing anywhere else closes it: a panel over a canvas must not
              need a target the size of a full stop to dismiss. */}
          <div
            className="version-history-shade"
            role="presentation"
            onClick={() => setOpen(false)}
          />
          <div
            className="version-history-panel"
            role="dialog"
            aria-label={onShare ? 'Отправить проект и открыть историю версий' : 'История версий'}
          >
            <header>
              <h2>{onShare ? 'Отправить проект' : 'История'}</h2>
              {onShare ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy('share');
                    setError(null);
                    setShareDone(false);
                    try {
                      await onShare();
                      setShareDone(true);
                    } catch {
                      setError('Не удалось отправить проект или скопировать ссылку.');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === 'share' ? 'Отправляем…' : shareDone ? 'Готово' : 'Поделиться ссылкой'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  setBusy('new');
                  await onSaveVersion();
                  setBusy(null);
                  await reload();
                }}
                disabled={busy !== null}
              >
                Сохранить версию
              </button>
            </header>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            {onShare ? <h3 className="version-history-subtitle">История версий</h3> : null}

            {items.length === 0 ? (
              <p className="account-hint">
                Версий пока нет. Нажмите «Сохранить версию» перед тем, как пробовать что-то смелое —
                к сохранённой версии всегда можно вернуться.
              </p>
            ) : (
              <ul>
                {items.map((version, index) => (
                  <li key={version.id}>
                    <div className="version-history-copy">
                      <strong>
                        {version.label ?? `Версия ${version.versionNo}`}
                        {index === 0 ? <em>последняя</em> : null}
                      </strong>
                      <span>{time.dateTime(version.createdAt)}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy !== null}
                      onClick={() => void restore(version)}
                    >
                      {busy === version.id ? 'Возвращаем…' : 'Вернуться'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="account-hint version-history-note">
              Возврат ничего не стирает: то, что сейчас на экране, сохранится отдельной версией.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
