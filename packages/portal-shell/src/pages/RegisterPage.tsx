import { useState, type FormEvent } from 'react';
import { api, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

export function RegisterPage({
  onRegistered,
  onBackToLogin,
}: {
  onRegistered: (session: SessionPayload) => void;
  onBackToLogin: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [country, setCountry] = useState('RU');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!email.trim() || !username.trim() || !password || !birthDate) {
      setMessage('Заполните email, имя пользователя, пароль и дату рождения.');
      return;
    }
    setBusy(true);
    const result = await api.register({
      email: email.trim(),
      username: username.trim().toLowerCase(),
      displayName: displayName.trim(),
      password,
      birthDate,
      country,
    });
    setBusy(false);
    if (result.ok) {
      onRegistered(result.data);
      return;
    }
    setMessage(
      result.status === 0
        ? 'Сервер недоступен. Попробуйте ещё раз.'
        : result.error.message || 'Не удалось создать аккаунт.',
    );
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBackToLogin}>
          ← К входу
        </button>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Создание аккаунта</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="register-username">Имя пользователя</label>
          <input
            id="register-username"
            autoComplete="username"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <label htmlFor="register-name">Отображаемое имя (необязательно)</label>
          <input
            id="register-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <label htmlFor="register-birth-date">Дата рождения</label>
          <input
            id="register-birth-date"
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
          />
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
          <label htmlFor="register-password">Пароль</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="field-hint">Не короче 10 символов. Личный аккаунт доступен с 18 лет.</p>
          <p className="form-error" role="alert" hidden={!message}>
            {message}
          </p>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Создаём…' : 'Создать аккаунт'}
          </button>
        </form>
      </main>
    </div>
  );
}
