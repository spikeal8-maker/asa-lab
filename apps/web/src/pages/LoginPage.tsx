import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import './LoginPage.css';
import { api, type BotProof, type SessionPayload } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';
import { BotCheck } from '../components/BotCheck';
import { availableSocialProviders, SocialAuthButtons, useAuthProviders } from '../auth-providers';

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
  const { providers, refresh: refreshProviders } = useAuthProviders();
  const socialAvailable = availableSocialProviders(providers).length > 0;
  const [socialRegistration, setSocialRegistration] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(false);
  const messageId = useId();
  const identifierRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void api.localPreviewConfig().then((result) => {
      if (active && result.ok) setLocalPreviewEnabled(result.data.enabled);
    });
    return () => {
      active = false;
      pending.current?.abort();
    };
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending.current) return;
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
    const controller = new AbortController();
    pending.current = controller;
    const result = await api.login(identifier.trim(), password, botProof, controller.signal);
    if (pending.current === controller) pending.current = null;
    if (controller.signal.aborted) return;
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
      setMessage(
        result.error.code === 'auth_timeout'
          ? result.error.message
          : 'Сервер недоступен. Попробуйте ещё раз.',
      );
    } else {
      setMessage('Ошибка сервера. Попробуйте ещё раз.');
    }
    identifierRef.current?.focus();
  }

  async function enterLocalPreview(): Promise<void> {
    if (pending.current) return;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    pending.current = controller;
    const result = await api.localPreviewSession(controller.signal);
    if (pending.current === controller) pending.current = null;
    if (controller.signal.aborted) return;
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setMessage('Не удалось войти в локальный preview. Обновите страницу и попробуйте ещё раз.');
  }

  return (
    <div className="page-center auth-entry-stage">
      <div className="auth-entry-layout">
        <aside className="auth-entry-intro" aria-label="Возможности ASA Lab">
          <span className="auth-entry-eyebrow">
            <span className="auth-entry-spark" aria-hidden="true" />
            Цифровая мастерская
          </span>
          <div className="auth-entry-intro-content">
            <p className="auth-entry-overline">ASA LAB / ПРОСТРАНСТВО ДЛЯ ИДЕЙ</p>
            <h2>
              От идеи
              <span> к своему проекту.</span>
            </h2>
            <p className="auth-entry-description">
              Моделируйте в 3D, собирайте электронные схемы и создавайте программы. Все инструменты
              для обучения и творчества — в одном пространстве.
            </p>
            <div className="auth-entry-disciplines" aria-label="Направления мастерской">
              <span>3D и CAD</span>
              <span>Электроника</span>
              <span>Программирование</span>
            </div>
          </div>
          <p className="auth-entry-intro-footnote">
            Продолжайте свои работы там, где остановились.
          </p>
        </aside>
        <main className="login-card auth-entry-form" aria-busy={busy}>
          <button type="button" className="btn-ghost entry-back" onClick={onBack}>
            ← Назад
          </button>
          <AuthHomeBrand onHome={onHome} />
          <p className="auth-entry-form-kicker">Рады видеть вас снова</p>
          <h1 className="auth-title">Вход</h1>
          <p className="auth-entry-form-description">
            Войдите в аккаунт, чтобы открыть свои проекты.
          </p>
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
          {!contextMessage ? (
            <SocialAuthButtons
              providers={providers}
              purpose="login"
              disabled={busy}
              onAuthenticated={(session) => {
                if (!pending.current) onSignedIn(session);
              }}
              onUnavailable={() => void refreshProviders()}
              onUsePassword={() => {
                setSocialRegistration(false);
                window.setTimeout(() => identifierRef.current?.focus(), 0);
              }}
              onRegistrationActiveChange={setSocialRegistration}
            />
          ) : null}
          {socialAvailable && !socialRegistration && !contextMessage ? (
            <p className="auth-entry-password-divider">Или войдите по паролю</p>
          ) : null}
          <form onSubmit={(event) => void submit(event)} noValidate hidden={socialRegistration}>
            <label htmlFor="identifier">Email или имя пользователя</label>
            <input
              id="identifier"
              ref={identifierRef}
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

          {recoveryOpen ? (
            <section className="auth-recovery-note" aria-label="Восстановление пароля">
              <strong>Как восстановить доступ</strong>
              <p>
                Если MAX или Telegram уже связан с аккаунтом и его кнопка доступна выше, подтвердите
                вход через него. Если пароль ещё не задан, его можно создать в разделе «Учётная
                запись». Для изменения уже заданного пароля потребуется текущий пароль. Если
                доступного способа нет, обратитесь к администратору портала.
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
    </div>
  );
}
