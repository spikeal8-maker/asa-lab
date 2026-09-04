import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, type BotProof, type SessionPayload } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';
import { BotCheck } from '../components/BotCheck';

export function LoginPage({
  onSignedIn,
  onCreateAccount,
  onClassCodeLogin,
  onOrganizationLogin,
  onBack,
  onHome = onBack,
  contextMessage,
}: {
  onSignedIn: (session: SessionPayload) => void;
  onCreateAccount: () => void;
  onClassCodeLogin?: () => void;
  onOrganizationLogin: () => void;
  onBack: () => void;
  onHome?: () => void;
  contextMessage?: string;
}): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [botProof, setBotProof] = useState<BotProof | null>(null);
  const [botReset, setBotReset] = useState(0);
  const [maxLaunchUrl, setMaxLaunchUrl] = useState<string | null>(null);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingLaunchUrl, setPairingLaunchUrl] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(false);
  const messageId = useId();
  const identifierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void api.maxConfig().then((result) => {
      if (active && result.ok && result.data.enabled) setMaxLaunchUrl(result.data.launchUrl);
    });
    void api.localPreviewConfig().then((result) => {
      if (active && result.ok) setLocalPreviewEnabled(result.data.enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pairingToken) return;
    let active = true;
    let timer: number | null = null;
    const check = async (): Promise<void> => {
      const result = await api.completeMaxPairing(pairingToken);
      if (!active) return;
      if (result.ok && result.data.status === 'authenticated') {
        setPairingToken(null);
        onSignedIn(result.data.session);
        return;
      }
      if (!result.ok && result.status !== 0) {
        setPairingToken(null);
        setMessage(
          result.error.code === 'max_pairing_expired'
            ? 'Время входа истекло. Откройте MAX ещё раз.'
            : 'Не удалось завершить вход через MAX.',
        );
        return;
      }
      timer = window.setTimeout(() => void check(), 6_000);
    };
    timer = window.setTimeout(() => void check(), 2_000);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [onSignedIn, pairingToken]);

  async function openMax(): Promise<void> {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    setBusy(true);
    setMessage(null);
    const result = await api.startMaxPairing();
    setBusy(false);
    if (!result.ok) {
      popup?.close();
      setMessage('Не удалось создать вход через MAX. Попробуйте ещё раз.');
      return;
    }
    setPairingToken(result.data.pairingToken);
    setPairingLaunchUrl(result.data.launchUrl);
    setMessage(
      'В MAX нажмите «Начать». Ничего вводить не нужно — затем вернитесь сюда, вход завершится автоматически.',
    );
    if (popup) popup.location.href = result.data.launchUrl;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!identifier.trim() || !password) {
      setMessage('Введите email или имя пользователя и пароль.');
      identifierRef.current?.focus();
      return;
    }
    if (!botProof) {
      setMessage('Поставьте галочку «Я не робот» и дождитесь проверки.');
      return;
    }
    setBusy(true);
    const result = await api.login(identifier.trim(), password, botProof);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setBotProof(null);
    setBotReset((value) => value + 1);
    if (result.status === 400 || result.status === 401) {
      setMessage('Неверные данные для входа.');
    } else if (result.status === 0) {
      setMessage('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setMessage('Ошибка сервера. Попробуйте ещё раз.');
    }
    identifierRef.current?.focus();
  }

  async function enterLocalPreview(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = await api.localPreviewSession();
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setMessage('Не удалось войти в локальный preview. Обновите страницу и попробуйте ещё раз.');
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <AuthHomeBrand onHome={onHome} />
        <h1 className="auth-title">Вход</h1>
        {onClassCodeLogin ? (
          <nav className="auth-method-switch" aria-label="Способ входа">
            <button type="button" className="active" aria-current="page">
              Аккаунт
            </button>
            <button type="button" data-testid="login-class-code" onClick={onClassCodeLogin}>
              Код класса
            </button>
          </nav>
        ) : null}
        {contextMessage ? <p className="max-link-copy">{contextMessage}</p> : null}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="identifier">Email или имя пользователя</label>
          <input
            id="identifier"
            ref={identifierRef}
            autoFocus
            autoComplete="username"
            spellCheck={false}
            value={identifier}
            disabled={busy}
            aria-invalid={message ? 'true' : undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => setIdentifier(event.target.value)}
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            aria-invalid={message ? 'true' : undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="link-button auth-forgot-password"
            onClick={() => setRecoveryOpen((value) => !value)}
          >
            Не помню пароль
          </button>
          <BotCheck
            key={`login-${botReset}`}
            action="login"
            disabled={busy}
            onVerified={setBotProof}
          />
          <p id={messageId} className="form-error" role="alert" hidden={!message}>
            {message}
          </p>
          <button type="submit" className="btn-primary" disabled={busy || !botProof}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>

        {maxLaunchUrl && !contextMessage ? (
          <button
            type="button"
            className="btn-secondary max-login-button"
            disabled={busy || pairingToken !== null}
            onClick={() => void openMax()}
          >
            {pairingToken ? 'Подтвердите вход в MAX…' : 'Войти через MAX'}
          </button>
        ) : null}
        {pairingLaunchUrl && pairingToken ? (
          <a className="auth-max-fallback" href={pairingLaunchUrl} target="_blank" rel="noreferrer">
            MAX не открылся? Открыть ещё раз
          </a>
        ) : null}
        {recoveryOpen ? (
          <section className="auth-recovery-note" aria-label="Восстановление пароля">
            <strong>Восстановление через MAX</strong>
            <p>
              Если MAX уже связан с аккаунтом, просто подтвердите вход в боте. Затем новый пароль
              можно задать в разделе «Учётная запись». Отправку писем подключим позже.
            </p>
          </section>
        ) : null}

        {localPreviewEnabled ? (
          <button
            type="button"
            className="btn-secondary max-login-button"
            disabled={busy}
            onClick={() => void enterLocalPreview()}
          >
            Войти в тестовый стенд
          </button>
        ) : null}

        <p className="auth-account-switch">
          <span>Нет аккаунта?</span>{' '}
          <button type="button" className="link-button" onClick={onCreateAccount}>
            Создать
          </button>
        </p>
        <p className="auth-organization-link">
          <button
            type="button"
            className="link-button link-muted"
            data-testid="login-organization"
            onClick={onOrganizationLogin}
          >
            Для организации
          </button>
        </p>
      </main>
    </div>
  );
}
