import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Age-aware registration.
 *
 * One account, no "teacher or personal" question: educator is a capability an
 * existing account gains later. Country and date of birth come first, because
 * they decide whether the rest of the form is an adult account or the student
 * routes — and a person under 18 is given real routes, not a refusal.
 */
export function RegisterPage({
  onRegistered,
  onBackToLogin,
  onClassCode,
  onStudentNextStage,
  onBack,
}: {
  onRegistered: () => void;
  onBackToLogin: () => void;
  onClassCode: () => void;
  onStudentNextStage: () => void;
  onBack: () => void;
}): JSX.Element {
  const [step, setStep] = useState<'age' | 'account' | 'student'>('age');
  const [country, setCountry] = useState('RU');
  const [birthDate, setBirthDate] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>('idle');

  // Availability is checked while typing so the pseudonym is settled before
  // the whole form is submitted.
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

  /** The 18+ rule belongs to the server; this is only the local preview of it. */
  function isAdult(value: string): boolean {
    const born = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return false;
    const now = new Date();
    let years = now.getUTCFullYear() - born.getUTCFullYear();
    const month = now.getUTCMonth() - born.getUTCMonth();
    if (month < 0 || (month === 0 && now.getUTCDate() < born.getUTCDate())) years -= 1;
    return years >= 18;
  }

  function continueFromAge(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    if (!birthDate) {
      setError('Укажите дату рождения.');
      return;
    }
    setStep(isAdult(birthDate) ? 'account' : 'student');
  }

  async function submitAccount(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!username.trim() || !email.trim() || !password) {
      setError('Заполните имя пользователя, email и пароль.');
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
      // The server is the authority on age; it routes instead of refusing.
      setStep('student');
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
        <button
          type="button"
          className="btn-ghost entry-back"
          onClick={() => (step === 'age' ? onBack() : setStep('age'))}
        >
          ← Назад
        </button>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Создание аккаунта</p>

        {step === 'age' ? (
          <form onSubmit={continueFromAge} noValidate data-testid="sign-up-age">
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

            <label htmlFor="register-birth-date">Дата рождения</label>
            <input
              id="register-birth-date"
              type="date"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
              aria-describedby="register-age-hint"
            />
            <p id="register-age-hint" className="field-hint">
              Возраст определяет, какой аккаунт мы можем создать. Педагогические возможности
              включаются позже, отдельным шагом.
            </p>

            {error ? (
              <p className="form-error" role="alert" data-testid="register-error">
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn-primary">
              Продолжить
            </button>
          </form>
        ) : null}

        {step === 'account' ? (
          <form
            onSubmit={(event) => void submitAccount(event)}
            noValidate
            data-testid="sign-up-account"
          >
            <label htmlFor="register-username">Имя пользователя</label>
            <input
              id="register-username"
              data-testid="register-username"
              value={username}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setUsername(event.target.value)}
              aria-describedby="register-username-hint"
            />
            <p
              id="register-username-hint"
              className="field-hint"
              data-testid="username-availability"
            >
              {availability === 'invalid'
                ? 'Латиница, цифры, точка, дефис или подчёркивание, 3–40 символов.'
                : availability === 'checking'
                  ? 'Проверяем…'
                  : availability === 'free'
                    ? 'Имя свободно.'
                    : availability === 'taken'
                      ? 'Имя занято — выберите другое.'
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

            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать аккаунт'}
            </button>
            <button type="button" className="btn-ghost login-secondary" onClick={onBackToLogin}>
              У меня уже есть аккаунт
            </button>
          </form>
        ) : null}

        {step === 'student' ? (
          <section data-testid="sign-up-student">
            <p className="field-hint">
              {error ?? 'Самостоятельный взрослый аккаунт доступен с 18 лет.'}
            </p>
            <div className="entry-routes">
              <button
                type="button"
                className="btn-secondary entry-action"
                onClick={onStudentNextStage}
              >
                Создать ученический аккаунт
              </button>
              <span className="entry-action-hint">
                Постоянный аккаунт с Safe Mode и подтверждением родителя или педагога.
              </span>
              <button type="button" className="btn-secondary entry-action" onClick={onClassCode}>
                Войти по коду класса
              </button>
              <span className="entry-action-hint">
                Без email и пароля, если педагог выдал код и имя для входа.
              </span>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
