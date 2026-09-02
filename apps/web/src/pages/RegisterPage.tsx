import { useEffect, useState, type FormEvent } from 'react';
import { api, type BotProof, type SessionPayload } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';
import { BotCheck } from '../components/BotCheck';

export function RegisterPage({
  onRegistered,
  onBackToLogin,
  onHome,
  maxInitData,
  onMaxRegistered,
}: {
  onRegistered: (session: SessionPayload) => void;
  onBackToLogin: () => void;
  onHome: () => void;
  maxInitData?: string;
  onMaxRegistered?: (session: SessionPayload) => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [country, setCountry] = useState('RU');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [botProof, setBotProof] = useState<BotProof | null>(null);
  const [botReset, setBotReset] = useState(0);
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void api.localPreviewConfig().then((result) => {
      if (active && result.ok) setLocalPreviewEnabled(result.data.enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  async function enterLocalPreview(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = await api.localPreviewSession();
    setBusy(false);
    if (result.ok) {
      onRegistered(result.data);
      return;
    }
    setMessage('Не удалось войти в локальный preview. Обновите страницу и попробуйте ещё раз.');
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!email.trim() || !username.trim() || (!maxInitData && !password) || !birthDate) {
      setMessage(
        maxInitData
          ? 'Заполните email, имя пользователя и дату рождения.'
          : 'Заполните email, имя пользователя, пароль и дату рождения.',
      );
      return;
    }
    if (!maxInitData && !botProof) {
      setMessage('Поставьте галочку «Я не робот» и дождитесь проверки.');
      return;
    }
    setBusy(true);
    const result = maxInitData
      ? await api.maxRegister({
          initData: maxInitData,
          email: email.trim(),
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          birthDate,
          country,
        })
      : await api.register({
          email: email.trim(),
          username: username.trim().toLowerCase(),
          displayName: displayName.trim(),
          password,
          birthDate,
          country,
          botProof: botProof as BotProof,
        });
    setBusy(false);
    if (result.ok) {
      (maxInitData ? (onMaxRegistered ?? onRegistered) : onRegistered)(result.data);
      return;
    }
    setBotProof(null);
    setBotReset((value) => value + 1);
    setMessage(
      result.status === 0
        ? 'Сервер недоступен. Попробуйте ещё раз.'
        : result.error.message || 'Не удалось создать аккаунт.',
    );
  }

  return (
    <div className="page-center">
      <main className="login-card auth-register-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBackToLogin}>
          ← К входу
        </button>
        <AuthHomeBrand onHome={onHome} />
        <h1 className="auth-title">{maxInitData ? 'Продолжить с MAX' : 'Создать аккаунт'}</h1>
        {maxInitData ? (
          <p className="max-link-copy">
            MAX подтвердил вас. Осталось заполнить данные аккаунта ASA Lab — пароль не нужен.
          </p>
        ) : null}
        <form className="auth-register-form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="auth-field">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="register-username">Имя пользователя</label>
            <input
              id="register-username"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="register-name">Отображаемое имя</label>
            <input
              id="register-name"
              value={displayName}
              placeholder="Необязательно"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="register-birth-date">Дата рождения</label>
            <input
              id="register-birth-date"
              type="date"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="register-country">Страна</label>
            <select
              id="register-country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              <option value="RU">Россия</option>
              <option value="KZ">Казахстан</option>
              <option value="BY">Беларусь</option>
              <option value="AM">Армения</option>
              <option value="RS">Сербия</option>
            </select>
          </div>
          {maxInitData ? null : (
            <div className="auth-field">
              <label htmlFor="register-password">Пароль</label>
              <input
                id="register-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="field-hint">Не короче 10 символов. Личный аккаунт — с 18 лет.</p>
            </div>
          )}
          <div className="auth-register-wide">
            {maxInitData ? (
              <p className="field-hint">Личный аккаунт доступен с 18 лет.</p>
            ) : (
              <BotCheck
                key={`register-${botReset}`}
                action="register"
                disabled={busy}
                onVerified={setBotProof}
              />
            )}
            <p className="form-error" role="alert" hidden={!message}>
              {message}
            </p>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || (!maxInitData && !botProof)}
            >
              {busy ? 'Создаём…' : maxInitData ? 'Создать и войти' : 'Создать аккаунт'}
            </button>
          </div>
        </form>
        {localPreviewEnabled && !maxInitData ? (
          <button
            type="button"
            className="btn-secondary max-login-button"
            disabled={busy}
            onClick={() => void enterLocalPreview()}
          >
            Войти в тестовый стенд
          </button>
        ) : null}
      </main>
    </div>
  );
}
