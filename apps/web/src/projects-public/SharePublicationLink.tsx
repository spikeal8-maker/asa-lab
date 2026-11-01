import { useEffect, useId, useRef, useState } from 'react';
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
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function share(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const current = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
    const value = publicationUrl(publicationId, window.location.href);
    setUrl(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(value);
      if (current !== generation.current) return;
      setCopied(true);
      setNotice('Ссылка скопирована.');
      timer.current = setTimeout(() => {
        setCopied(false);
        setNotice(null);
      }, 2400);
    } catch {
      if (current !== generation.current) return;
      setUrl(value);
      setNotice('Выделите и скопируйте ссылку ниже.');
    } finally {
      pending.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <div className="publication-share">
      <button
        type="button"
        className={`btn-secondary${compact ? ' publication-share-compact' : ''}${copied ? ' is-copied' : ''}`}
        aria-label="Копировать ссылку"
        title={copied ? 'Ссылка скопирована' : 'Копировать ссылку'}
        disabled={busy}
        onClick={() => void share()}
      >
        {copied ? (
          <svg
            aria-hidden="true"
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : compact ? (
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
          {busy ? 'Копируем…' : copied ? 'Скопировано' : 'Копировать ссылку'}
        </span>
      </button>
      {notice ? (
        <p role="status" className={compact && copied ? 'sr-only' : undefined}>
          {notice}
        </p>
      ) : null}
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
