import { useId, useState } from 'react';
import { api, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

export function MaxLinkPage({
  session,
  initData,
  onLinked,
  onCancel,
}: {
  session: SessionPayload;
  initData: string;
  onLinked: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const messageId = useId();

  async function link(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = await api.maxLink(initData);
    setBusy(false);
    if (result.ok) {
      onLinked();
      return;
    }
    if (result.error.code === 'max_assertion_replayed') {
      setMessage('Ссылка устарела. Закройте и заново откройте ASA Lab в MAX.');
    } else if (
      result.error.code === 'max_identity_taken' ||
      result.error.code === 'max_account_already_linked'
    ) {
      setMessage(result.error.message);
    } else {
      setMessage('Не удалось связать аккаунты. Попробуйте ещё раз.');
    }
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Связать MAX</p>
        <p className="max-link-copy">
          Профиль MAX будет привязан к аккаунту <strong>{session.account.email}</strong>.
        </p>
        <p id={messageId} className="form-error" role="alert" hidden={!message}>
          {message}
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          aria-describedby={message ? messageId : undefined}
          onClick={() => void link()}
        >
          {busy ? 'Связываем…' : 'Связать и продолжить'}
        </button>
        <button
          type="button"
          className="btn-ghost max-link-cancel"
          disabled={busy}
          onClick={onCancel}
        >
          Не сейчас
        </button>
      </main>
    </div>
  );
}
