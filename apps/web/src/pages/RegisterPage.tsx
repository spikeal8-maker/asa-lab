import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';

/**
 * Adult self-registration. Country and date of birth are asked before the
 * credentials, matching the reference flow; the 18+ rule itself is enforced by
 * the server, this form only explains it.
 */
export function RegisterPage({
  onRegistered,
  onBackToLogin,
}: {
  onRegistered: () => void;
  onBackToLogin: () => void;
}): JSX.Element {
  const [country, setCountry] = useState('RU');
  const [birthDate, setBirthDate] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!birthDate) {
      setError('Укажите дату рождения.');
      return;
    }
    if (!displayName.trim() || !email.trim() || !password) {
      setError('Заполните имя, email и пароль.');
      return;
    }
    setBusy(true);
    const result = await api.register({
      email: email.trim(),
      password,
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
      setError('Самостоятельная регистрация доступна с 18 лет.');
    } else if (result.status === 409) {
      setError('Аккаунт с таким email уже существует.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError(result.error.message || 'Не удалось создать аккаунт.');
    }
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
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
            Самостоятельный аккаунт доступен с 18 лет. Для учеников класс создаёт педагог.
          </p>

          <label htmlFor="register-name">Имя</label>
          <input
            id="register-name"
            value={displayName}
            autoComplete="name"
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
            <p className="form-error" role="alert">
              {error}
            </p>
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
