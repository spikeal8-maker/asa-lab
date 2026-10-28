import { useId, useState } from 'react';
import { publicationUrl } from './presentation';

/** Clipboard failure on a local HTTP installation keeps the URL selectable. */
export function SharePublicationLink({
  publicationId,
}: {
  readonly publicationId: string;
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
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void share()}>
        {busy ? 'Копируем…' : 'Копировать ссылку'}
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
