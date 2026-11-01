import { useId, useState } from 'react';
import { publicationUrl } from './presentation';

/** Clipboard failure on a local HTTP installation keeps the URL selectable. */
export function SharePublicationLink({
  publicationId,
  compact = false,
}: {
  readonly publicationId: string;
  readonly compact?: boolean;
}): JSX.Element {
  const fieldId = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function share(): Promise<void> {
    if (busy) return;
    const value = publicationUrl(publicationId, window.location.href);
    setUrl(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(value);
      setNotice('Ссылка скопирована.');
    } catch {
      setUrl(value);
      setNotice('Выделите и скопируйте ссылку ниже.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="publication-share">
      <button
        type="button"
        className={`btn-secondary${compact ? ' publication-share-compact' : ''}`}
        aria-label="Копировать ссылку"
        title="Копировать ссылку"
        disabled={busy}
        onClick={() => void share()}
      >
        {compact ? (
          <svg
            aria-hidden="true"
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
          </svg>
        ) : null}
        <span className={compact ? 'sr-only' : undefined}>
          {busy ? 'Копируем…' : 'Копировать ссылку'}
        </span>
      </button>
      {notice ? <p role="status">{notice}</p> : null}
      {url ? (
        <div className="publication-share-address">
          <label className="sr-only" htmlFor={fieldId}>
            Публичная ссылка на проект
          </label>
          <input
            id={fieldId}
            value={url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  );
}
