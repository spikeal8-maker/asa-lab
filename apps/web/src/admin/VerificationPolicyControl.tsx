import { useEffect, useRef, useState } from 'react';
import { adminApi, type AdminVerificationPolicy } from './admin-api';
import { notifyAccountVerificationRequired } from '../auth-verification';

export function VerificationPolicyControl({
  refreshKey,
  onAccessDenied,
}: {
  refreshKey: number;
  onAccessDenied: () => void;
}): JSX.Element {
  const [policy, setPolicy] = useState<AdminVerificationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  useEffect(() => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setLoading(true);
    void adminApi.verificationPolicy(controller.signal).then((result) => {
      if (pending.current === controller) pending.current = null;
      if (current !== generation.current || controller.signal.aborted) return;
      setLoading(false);
      if (result.ok) {
        setPolicy(result.data);
        setNotice(null);
      } else {
        setPolicy(null);
        if (result.status === 401 || result.status === 403) denied.current();
        else setNotice({ kind: 'error', text: result.error.message });
      }
    });
    return () => {
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [refreshKey]);

  useEffect(
    () => () => {
      generation.current += 1;
      pending.current?.abort();
    },
    [],
  );

  async function change(enabled: boolean): Promise<void> {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setSaving(true);
    setNotice(null);
    const result = await adminApi.updateVerificationPolicy(enabled, controller.signal);
    if (pending.current === controller) pending.current = null;
    if (current !== generation.current || controller.signal.aborted) return;
    setSaving(false);
    if (!result.ok) {
      if (result.error.code === 'auth_timeout') setPolicy(null);
      if (result.status === 401 || result.status === 403) denied.current();
      else setNotice({ kind: 'error', text: result.error.message });
      return;
    }
    setPolicy(result.data);
    setNotice({
      kind: 'success',
      text: result.data.enabled
        ? 'Обязательное подтверждение включено. Срок для новых требований — 24 часа.'
        : 'Обязательное подтверждение выключено. Обычный вход разрешён.',
    });
    notifyAccountVerificationRequired();
  }

  return (
    <section
      className="auth-policy-control"
      aria-labelledby="auth-policy-title"
      aria-busy={loading || saving}
    >
      <div className="auth-policy-copy">
        <span className="auth-confirmation-kicker">Правило доступа</span>
        <h3 id="auth-policy-title">Подтверждение входа через 24 часа</h3>
        <p>
          Пользователю достаточно один раз подтвердить MAX или Telegram. Первые сутки доступны без
          подтверждения.
        </p>
        <p className="auth-policy-fallback">
          Если все каналы недоступны или ещё не прошли настоящее подтверждение, вход по паролю
          остаётся доступным.
        </p>
      </div>
      <label className="auth-policy-switch">
        <input
          type="checkbox"
          role="switch"
          aria-label="Обязательное подтверждение входа"
          checked={policy?.enabled ?? false}
          disabled={!policy || loading || saving}
          onChange={(event) => void change(event.target.checked)}
        />
        <span aria-hidden="true" className="auth-policy-switch-track" />
        <strong>
          {saving
            ? 'Сохраняем…'
            : loading && !policy
              ? 'Проверяем…'
              : !policy
                ? 'Статус недоступен'
                : policy.enabled
                  ? 'Включено'
                  : 'Выключено'}
        </strong>
      </label>
      {policy?.activatedAt ? (
        <p className="auth-policy-date">
          Правило действует с{' '}
          {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
            new Date(policy.activatedAt),
          )}
          .
        </p>
      ) : null}
      {notice ? (
        <p
          className={`auth-settings-notice is-${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
