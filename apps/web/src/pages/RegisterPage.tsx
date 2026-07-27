import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Adult self-registration into a Personal Workspace.
 *
 * The username is a pseudonym the person chooses: it is never taken from the
 * email, and a real first or last name is not asked for. Someone under 18 is
 * not left at a refusal — the form shows the routes that actually work.
 */
export function RegisterPage({
  onRegistered,
  onBackToLogin,
  onClassCode,
  onStudentNextStage,
}: {
  onRegistered: () => void;
  onBackToLogin: () => void;
  onClassCode: () => void;
  onStudentNextStage: () => void;
}): JSX.Element {
  const [country, setCountry] = useState('RU');
  const [birthDate, setBirthDate] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability>('idle');
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // Availability is checked while typing so the pseudonym is settled before
  // the account is submitted.
  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (value.length === 0) {
      setAvailability('idle');
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9._-]{1,38})[a-z0-9]$/.test(value)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    const timer = window.setTimeout(() => {
      void api.usernameAvailable(value).then((result) => {
        if (!result.ok) {
          setAvailability('idle');
          return;
        }
        setAvailability(result.data.available ? 'free' : 'taken');
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [username]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setRoutes([]);
    if (!birthDate) {
      setError('Укажите дату рождения.');
      return;
    }
    if (!username.trim() || !email.trim() || !password) {
      setError('Заполните псевдоним, email и пароль.');
      return;
    }
    setBusy(true);
    const result = await api.register({
      email: email.trim(),
      password,
      username: username.trim().toLowerCase(),
      displayName: displayName.trim(),
      birthDate,
      country,
    });
    setBusy(false);
    if (result.ok) {
      onRegistered();
      return;
    }
    if (result.status === 422) {
      setError(result.error.message);
      setRoutes(result.error.routes ?? []);
    } else if (result.status === 409) {
      setError(result.error.message);
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError(result.error.message || 'Не удалось создать аккаунт.');
    }
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBackToLogin}>
          ← Назад
        </button>
        <h1 className="brand">ASA Lab</h1>
        <p className="subtitle">Создание личного аккаунта</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="register-country">Страна</label>
          <select
            id="register-country"
            ref={firstFieldRef}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="RU">Россия</option>
            <option value="KZ">Казахстан</option>
            <option value="BY">Беларусь</option>
            <option value="AM">Армения</option>
            <option value="RS">Сербия</option>
          </select>

          <label htmlFor="register-birth-date">Дата рождения</label>
          <input
            id="register-birth-date"
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            aria-describedby="register-age-hint"
          />
          <p id="register-age-hint" className="field-hint">
            Личный аккаунт доступен с 18 лет. Ученики заходят по коду класса.
          </p>

          <label htmlFor="register-username">Псевдоним</label>
          <input
            id="register-username"
            data-testid="register-username"
            value={username}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setUsername(event.target.value)}
            aria-describedby="register-username-hint"
          />
          <p id="register-username-hint" className="field-hint" data-testid="username-availability">
            {availability === 'invalid'
              ? 'Латиница, цифры, точка, дефис или подчёркивание, 3–40 символов.'
              : availability === 'checking'
                ? 'Проверяем…'
                : availability === 'free'
                  ? 'Псевдоним свободен.'
                  : availability === 'taken'
                    ? 'Псевдоним занят — выберите другой.'
                    : 'Имя, под которым вас видят другие. Настоящее имя не требуется.'}
          </p>

          <label htmlFor="register-name">Отображаемое имя (необязательно)</label>
          <input
            id="register-name"
            value={displayName}
            autoComplete="off"
            onChange={(event) => setDisplayName(event.target.value)}
          />

          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="register-password">Пароль</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="register-password-hint"
          />
          <p id="register-password-hint" className="field-hint">
            Не короче 10 символов.
          </p>

          {error ? (
            <p className="form-error" role="alert" data-testid="register-error">
              {error}
            </p>
          ) : null}

          {routes.length > 0 ? (
            <div className="entry-routes" data-testid="minor-routes">
              {routes.includes('class_code') ? (
                <button type="button" className="btn-secondary entry-action" onClick={onClassCode}>
                  Войти по коду класса
                </button>
              ) : null}
              {routes.includes('student_account_next_stage') ? (
                <button
                  type="button"
                  className="btn-ghost entry-action"
                  onClick={onStudentNextStage}
                >
                  Создать ученический аккаунт — следующий этап
                </button>
              ) : null}
            </div>
          ) : null}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Создаём…' : 'Создать аккаунт'}
          </button>
          <button type="button" className="btn-ghost login-secondary" onClick={onBackToLogin}>
            У меня уже есть аккаунт
          </button>
        </form>
      </main>
    </div>
  );
}
