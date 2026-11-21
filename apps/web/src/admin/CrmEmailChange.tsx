import { useEffect, useRef, useState, type FormEvent } from 'react';
import { emailApi, type EmailStatus } from '../email-api';
import './email-settings.css';
export function CrmEmailChange({
  accountId,
  version,
  onChanged,
  onDenied,
}: {
  accountId: string;
  version: string;
  onChanged: () => void;
  onDenied: () => void;
}) {
  const [status, setStatus] = useState<EmailStatus | null>(null),
    [email, setEmail] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const live = useRef(true),
    intent = useRef<{ id: string; email: string; reason: string; version: string } | null>(null),
    denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void emailApi.status(accountId, controller.signal).then((r) => {
      if (!live.current || controller.signal.aborted) return;
      if (r.ok) setStatus(r.data);
      else {
        setMessage(r.error.message);
        if (r.status === 401 || r.status === 403) denied.current();
      }
    });
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [accountId, version]);
  function result(r: Awaited<ReturnType<typeof emailApi.status>>) {
    if (!live.current) return;
    setBusy(false);
    if (r.ok) {
      setStatus(r.data);
      setMessage('Состояние почты обновлено.');
    } else {
      setMessage(r.error.message);
      if (r.status === 401 || r.status === 403) denied.current();
    }
  }
  async function send(e?: FormEvent, resend = false) {
    e?.preventDefault();
    if (busy) return;
    const address = resend ? status?.pending?.email : email;
    if (!address) return;
    const why = reason.trim();
    if (why.length < 3) {
      setMessage('Укажите причину смены адреса (не менее трёх символов).');
      return;
    }
    const old = intent.current;
    const next =
      old && old.email === address && old.reason === why && old.version === version
        ? old
        : { id: crypto.randomUUID(), email: address, reason: why, version };
    intent.current = next;
    setBusy(true);
    setMessage('');
    const r = await emailApi.change(accountId, address, version, why, next.id);
    if (!live.current) return;
    result(r);
    if (r.ok) {
      intent.current = null;
      setMessage(
        r.data.pending?.state === 'sending'
          ? 'Отправка начата. Обновите состояние через несколько секунд.'
          : 'Письмо отправлено на новый адрес. Текущий адрес и вход сохранятся до подтверждения.',
      );
    } else if (r.status !== 0) intent.current = null;
  }
  const pending = status?.pending,
    active = pending && (pending.state === 'sent' || pending.state === 'sending');
  return (
    <section className="email-proof" aria-label="Смена электронной почты">
      <h4>Смена почты</h4>
      <p>
        Текущий адрес: <strong>{status ? status.email || 'Не указан' : 'Загружаем…'}</strong>
        {status?.verified ? ' · подтверждён' : ''}
      </p>
      <p>
        Новый адрес начнёт работать после подтверждения по письму. После смены потребуется войти
        заново.
      </p>
      {pending ? (
        <p role="status">
          {active
            ? `Ожидает подтверждения: ${pending.email}. Ссылка действует до ${new Date(pending.expiresAt).toLocaleString('ru-RU')}.`
            : pending.state === 'consumed'
              ? 'Адрес подтверждён.'
              : pending.state === 'failed'
                ? 'Письмо не отправлено. Можно повторить попытку.'
                : pending.state === 'expired'
                  ? 'Срок ссылки истёк. Отправьте новое письмо.'
                  : 'Запрос отменён.'}
        </p>
      ) : null}
      <form onSubmit={(e) => void send(e)}>
        <label>
          Новый адрес
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Причина смены
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </label>
        <div className="email-proof-actions">
          <button type="submit" className="btn-primary" disabled={busy || !status}>
            {busy ? 'Отправляем…' : 'Отправить ссылку подтверждения'}
          </button>
          {active ? (
            <>
              <button type="button" disabled={busy} onClick={() => void send(undefined, true)}>
                Отправить повторно
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void emailApi.cancel(pending.id, accountId).then(result);
                }}
              >
                Отменить запрос
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void emailApi.status(accountId).then((r) => {
                result(r);
                if (r.ok) onChanged();
              });
            }}
          >
            Обновить состояние
          </button>
        </div>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
