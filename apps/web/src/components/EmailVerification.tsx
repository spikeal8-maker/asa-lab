import { useEffect, useRef, useState } from 'react';
import { emailApi, type EmailStatus } from '../email-api';
import '../admin/email-settings.css';
interface EmailVerificationProps {
  accountId: string;
  available: boolean;
}
export function EmailVerification({ accountId, available }: EmailVerificationProps) {
  return <OwnEmailVerification key={accountId} accountId={accountId} available={available} />;
}
function OwnEmailVerification({ accountId, available }: EmailVerificationProps) {
  const [status, setStatus] = useState<EmailStatus | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const live = useRef(true),
    intent = useRef<string | null>(null);
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    // Provider readiness belongs to the parent verification/provider request.
    // Reading the mailbox must not start a second global confirmation check.
    void emailApi.status(undefined, controller.signal).then((r) => {
      if (!live.current || controller.signal.aborted) return;
      if (r.ok && r.data.accountId === accountId) setStatus(r.data);
      else setMessage('Не удалось загрузить почту текущего аккаунта. Обновите страницу.');
    });
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [accountId]);
  async function send() {
    if (busy || !status || !available) return;
    setBusy(true);
    setMessage('');
    const id = intent.current ?? crypto.randomUUID();
    intent.current = id;
    const r = await emailApi.request(accountId, id);
    if (!live.current) return;
    setBusy(false);
    if (r.ok && r.data.accountId === accountId) {
      setStatus(r.data);
      intent.current = null;
      setMessage(
        r.data.pending?.state === 'sending'
          ? 'Отправка начата. Проверьте состояние через несколько секунд.'
          : 'Письмо отправлено. Откройте ссылку в течение 30 минут.',
      );
    } else {
      setMessage(r.ok ? 'Аккаунт изменился. Обновите страницу.' : r.error.message);
      if (!r.ok && r.status !== 0) intent.current = null;
    }
  }
  return (
    <section className="email-proof" aria-label="Подтверждение почты">
      <h3>Электронная почта</h3>
      <p>{status?.email}</p>
      <p>
        {status?.verified
          ? 'Адрес подтверждён.'
          : status
            ? status.email
              ? 'Адрес ещё не подтверждён.'
              : 'Адрес не указан. Его можно добавить через администратора.'
            : 'Загружаем…'}
      </p>
      {status?.pending?.state === 'sent' ? (
        <p>
          Письмо ожидает подтверждения до{' '}
          {new Date(status.pending.expiresAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          .
        </p>
      ) : null}
      {status?.email && !status.verified ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || !available}
          onClick={() => void send()}
        >
          {busy
            ? 'Отправляем…'
            : status.pending?.state === 'sent'
              ? 'Отправить письмо повторно'
              : 'Подтвердить почту по письму'}
        </button>
      ) : null}
      {status?.email && !status.verified && !available ? (
        <p>Почта сейчас недоступна. Попробуйте позже или выберите другой способ подтверждения.</p>
      ) : null}
      <button
        type="button"
        className="link-button"
        disabled={busy}
        onClick={() => {
          void emailApi.status().then((r) => {
            if (live.current && r.ok && r.data.accountId === accountId) setStatus(r.data);
          });
        }}
      >
        Проверить состояние почты
      </button>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
