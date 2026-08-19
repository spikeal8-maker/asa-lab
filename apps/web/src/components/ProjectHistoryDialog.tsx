import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectVersion } from '../api';
import { useSchoolTime } from './school-time';
import './version-history.css';

/**
 * Журнал версий, открытый с карточки работы.
 *
 * То же, что панель в редакторе, но добраться до него можно, не открывая саму
 * работу: «что я тут наделал на прошлой неделе» — вопрос, который задают с
 * полки проектов, а не изнутри модели.
 */
export function ProjectHistoryDialog({
  projectId,
  title,
  onClose,
}: {
  readonly projectId: string;
  readonly title: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [items, setItems] = useState<readonly ProjectVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listVersions(projectId);
    setItems(result.ok ? result.data.versions : []);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <h2 id="history-title">Журнал версий</h2>
        <p>«{title}»</p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="notice-success" role="status">
            {notice}
          </p>
        ) : null}

        {items === null ? (
          <p role="status">Загружаем…</p>
        ) : items.length === 0 ? (
          <p className="account-hint">
            Версий пока нет. Откройте работу и нажмите «Сохранить версию» перед тем, как пробовать
            что-то смелое.
          </p>
        ) : (
          <ul className="version-history-panel-list">
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
                  onClick={async () => {
                    setBusy(version.id);
                    setError(null);
                    const result = await api.restoreVersion(projectId, version.id);
                    setBusy(null);
                    if (!result.ok) {
                      setError(result.error.message || 'Не удалось вернуться к этой версии.');
                      return;
                    }
                    setItems(result.data.versions);
                    setNotice('Работа возвращена к этой версии.');
                  }}
                >
                  {busy === version.id ? 'Возвращаем…' : 'Вернуться'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="account-hint version-history-note">
          Возврат ничего не стирает: то, что сейчас в работе, сохранится отдельной версией.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
