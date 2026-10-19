import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type AuthProviderAvailability,
  type SessionPayload,
  type SocialAuthProvider,
  type SocialPairing,
} from './api';

export const SOCIAL_PROVIDER_LABELS: Readonly<Record<SocialAuthProvider, string>> = {
  max: 'MAX',
  telegram: 'Telegram',
};

export function availableSocialProviders(
  providers: readonly AuthProviderAvailability[],
): (AuthProviderAvailability & { id: SocialAuthProvider })[] {
  return providers.filter(
    (provider): provider is AuthProviderAvailability & { id: SocialAuthProvider } =>
      provider.available && (provider.id === 'max' || provider.id === 'telegram'),
  );
}

export function useAuthProviders(): {
  providers: AuthProviderAvailability[];
  refresh: () => Promise<void>;
} {
  const [providers, setProviders] = useState<AuthProviderAvailability[]>([]);
  const request = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const current = ++request.current;
    const result = await api.authProviders(controller.signal);
    if (inFlight.current === controller) inFlight.current = null;
    if (current === request.current && !controller.signal.aborted) {
      setProviders(result.ok && Array.isArray(result.data.providers) ? result.data.providers : []);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    const timer = window.setInterval(refreshVisible, 30_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      request.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh]);
  return { providers, refresh };
}

/** Display/format only; the server validates this origin against deployment settings. */
export function providerWebhookUrl(provider: SocialAuthProvider, value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? `${url.origin}/api/auth/${provider}/webhook`
      : null;
  } catch {
    return null;
  }
}

export function socialLaunchUrl(provider: SocialAuthProvider, value: string): string | null {
  try {
    const url = new URL(value);
    const hosts = provider === 'max' ? ['max.ru'] : ['t.me', 'telegram.me'];
    return url.protocol === 'https:' &&
      hosts.includes(url.hostname) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

type ProviderFlow = {
  provider: SocialAuthProvider;
  pairing: SocialPairing;
  generation: number;
} & (
  | { phase: 'pending' }
  | { phase: 'registration'; profile: { displayName: string | null; username: string | null } }
);

function pairingFailure(code: string): string {
  if (code === 'auth_timeout')
    return 'Сервер не ответил вовремя. Подтверждение не завершено в этом окне. Можно проверить состояние или войти по паролю.';
  if (code === 'auth_cancelled') return 'Подтверждение отменено.';
  if (code === 'identity_taken' || code.endsWith('_identity_taken')) {
    return 'Этот профиль уже связан с другим аккаунтом ASA Lab. Выберите другой способ.';
  }
  if (code === 'account_already_linked') return 'У аккаунта уже есть привязка этого способа входа.';
  if (code === 'identity_revoked' || code.endsWith('_identity_revoked')) {
    return 'Эта привязка отозвана. Обратитесь к администратору или выберите другой способ.';
  }
  if (code === 'account_suspended')
    return 'Доступ к аккаунту приостановлен. Обратитесь к администратору.';
  if (code.includes('expired')) return 'Время подтверждения истекло. Откройте бота ещё раз.';
  return 'Подтверждение не завершено. Попробуйте ещё раз или выберите другой способ.';
}

export function SocialAuthButtons({
  providers,
  purpose,
  disabled = false,
  onAuthenticated,
  onLinked,
  onUnavailable,
  onUsePassword,
  onRegistrationActiveChange,
  onFlowActiveChange,
  linkActionLabel = 'Подключить',
}: {
  providers: readonly AuthProviderAvailability[];
  purpose: 'login' | 'register' | 'link';
  disabled?: boolean;
  onAuthenticated: (session: SessionPayload) => void;
  onLinked?: () => void;
  onUnavailable?: () => void;
  onUsePassword?: () => void;
  onRegistrationActiveChange?: (active: boolean) => void;
  onFlowActiveChange?: (active: boolean) => void;
  linkActionLabel?: string;
}): JSX.Element | null {
  const [flow, setFlow] = useState<ProviderFlow | null>(null);
  const [starting, setStarting] = useState<SocialAuthProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  const pendingPopup = useRef<Window | null>(null);
  const available = availableSocialProviders(providers);
  const availableRef = useRef(available);
  availableRef.current = available;
  const callbacks = useRef({ onAuthenticated, onLinked, onUnavailable });
  callbacks.current = { onAuthenticated, onLinked, onUnavailable };
  const labelId = useId();

  useEffect(() => {
    onRegistrationActiveChange?.(flow?.phase === 'registration');
  }, [flow?.phase, onRegistrationActiveChange]);
  useEffect(() => {
    onFlowActiveChange?.(flow !== null || starting !== null);
  }, [flow, starting, onFlowActiveChange]);

  useEffect(
    () => () => {
      generation.current += 1;
      pendingRequest.current?.abort();
      pendingPopup.current?.close();
    },
    [],
  );

  // Another sign-in method has taken control (for example password submit).
  // Cancel this attempt instead of allowing two authentication results to race.
  useEffect(() => {
    if (!disabled) return;
    generation.current += 1;
    pendingRequest.current?.abort();
    pendingRequest.current = null;
    pendingPopup.current?.close();
    pendingPopup.current = null;
    setFlow(null);
    setStarting(null);
  }, [disabled]);

  useEffect(() => {
    if (!flow || available.some((provider) => provider.id === flow.provider)) return;
    generation.current += 1;
    pendingRequest.current?.abort();
    setFlow(null);
    setMessage('Этот способ сейчас недоступен. Проверяем другие способы входа.');
    callbacks.current.onUnavailable?.();
  }, [flow, providers]);

  const expiresAt = flow?.pairing.expiresAt;
  const pairingToken = flow?.pairing.pairingToken;
  // Expiry must still fire while a poll or registration request is stalled.
  useEffect(() => {
    if (!expiresAt || !pairingToken) return;
    const timer = window.setTimeout(
      () => {
        generation.current += 1;
        pendingRequest.current?.abort();
        setFlow(null);
        setStarting(null);
        setMessage('Время подтверждения истекло. Откройте бота ещё раз.');
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt, pairingToken]);

  useEffect(() => {
    if (!flow || flow.phase !== 'pending') return;
    let active = true;
    let timer: number | undefined;
    const controller = new AbortController();
    pendingRequest.current = controller;
    const check = async (): Promise<void> => {
      if (Date.parse(flow.pairing.expiresAt) <= Date.now()) {
        setFlow(null);
        setMessage('Время подтверждения истекло. Откройте бота ещё раз.');
        return;
      }
      const result = await api.completeSocialPairing(
        flow.provider,
        flow.pairing.pairingToken,
        controller.signal,
      );
      if (!active || controller.signal.aborted || flow.generation !== generation.current) return;
      if (!result.ok) {
        callbacks.current.onUnavailable?.();
        setFlow(null);
        setMessage(pairingFailure(result.error.code));
        return;
      }
      if (result.data.status === 'authenticated') {
        setFlow(null);
        if (purpose === 'link') {
          setMessage('Не удалось подтвердить привязку к текущему аккаунту. Проверьте состояние.');
          callbacks.current.onUnavailable?.();
          return;
        }
        callbacks.current.onAuthenticated(result.data.session);
        return;
      }
      if (result.data.status === 'linked') {
        setFlow(null);
        callbacks.current.onLinked?.();
        return;
      }
      if (result.data.status === 'registration_required') {
        if (purpose === 'link') {
          setFlow(null);
          setMessage('Не удалось связать способ с текущим аккаунтом. Повторите подтверждение.');
        } else {
          setFlow({ ...flow, phase: 'registration', profile: result.data.profile });
          setMessage(null);
        }
        return;
      }
      if (result.data.status !== 'pending') {
        setFlow(null);
        setMessage(pairingFailure(result.data.status));
        if (result.data.status === 'unavailable') callbacks.current.onUnavailable?.();
        return;
      }
      timer = window.setTimeout(() => void check(), 3_000);
    };
    timer = window.setTimeout(() => void check(), 1_500);
    return () => {
      active = false;
      controller.abort();
      if (pendingRequest.current === controller) pendingRequest.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [flow, purpose]);

  const cancel = (): void => {
    generation.current += 1;
    pendingRequest.current?.abort();
    pendingRequest.current = null;
    pendingPopup.current?.close();
    pendingPopup.current = null;
    setFlow(null);
    setStarting(null);
    setMessage(null);
  };

  async function start(provider: SocialAuthProvider): Promise<void> {
    if (pendingRequest.current || flow) return;
    const current = ++generation.current;
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    pendingPopup.current = popup;
    const controller = new AbortController();
    pendingRequest.current = controller;
    setStarting(provider);
    setMessage(null);
    const result = await api.startSocialPairing(provider, purpose, controller.signal);
    if (pendingRequest.current === controller) pendingRequest.current = null;
    if (pendingPopup.current === popup) pendingPopup.current = null;
    if (current !== generation.current || controller.signal.aborted) {
      popup?.close();
      return;
    }
    setStarting(null);
    if (!result.ok) {
      popup?.close();
      setMessage(pairingFailure(result.error.code));
      callbacks.current.onUnavailable?.();
      return;
    }
    const launchUrl = socialLaunchUrl(provider, result.data.launchUrl);
    if (!launchUrl || !Number.isFinite(Date.parse(result.data.expiresAt))) {
      popup?.close();
      setMessage('Не удалось открыть безопасную ссылку бота. Повторите попытку позже.');
      callbacks.current.onUnavailable?.();
      return;
    }
    if (!availableRef.current.some((entry) => entry.id === provider)) {
      popup?.close();
      callbacks.current.onUnavailable?.();
      return;
    }
    setFlow({
      provider,
      pairing: { ...result.data, launchUrl },
      phase: 'pending',
      generation: current,
    });
    if (popup) popup.location.href = launchUrl;
  }

  if (available.length === 0 && !flow && !starting && !message) return null;

  return (
    <section className="auth-social" aria-labelledby={labelId}>
      <p className="auth-social-label" id={labelId}>
        {flow?.phase === 'registration'
          ? `Регистрация через ${SOCIAL_PROVIDER_LABELS[flow.provider]}`
          : purpose === 'link'
            ? 'Подтвердить одним способом'
            : 'Или продолжить через'}
      </p>
      {flow?.phase === 'registration' ? (
        <SocialRegistrationForm
          key={flow.pairing.pairingToken}
          flow={flow}
          onRegistered={(session) => {
            if (flow.generation !== generation.current || purpose === 'link') return;
            setFlow(null);
            callbacks.current.onAuthenticated(session);
          }}
          onCancel={cancel}
          {...(onUnavailable ? { onUnavailable } : {})}
          {...(onUsePassword
            ? {
                onUsePassword: () => {
                  cancel();
                  onUsePassword();
                },
              }
            : {})}
        />
      ) : (
        <>
          <div className="auth-social-buttons">
            {available.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`btn-secondary auth-provider-button auth-provider-${provider.id}`}
                disabled={disabled || starting !== null || flow !== null}
                onClick={() => void start(provider.id)}
              >
                <span className="auth-provider-mark" aria-hidden="true">
                  {provider.id === 'max' ? 'M' : 'T'}
                </span>
                <span>
                  {starting === provider.id
                    ? 'Открываем…'
                    : `${purpose === 'link' ? linkActionLabel : purpose === 'register' ? 'Создать через' : 'Войти через'} ${SOCIAL_PROVIDER_LABELS[provider.id]}`}
                </span>
              </button>
            ))}
          </div>
          {starting ? (
            <div className="auth-social-actions" role="status">
              <span>Готовим запрос подтверждения…</span>
              <button type="button" className="link-button" onClick={cancel}>
                Отмена
              </button>
            </div>
          ) : null}
          {flow?.phase === 'pending' ? (
            <div className="auth-social-pending" role="status">
              <strong>Подтвердите действие в {SOCIAL_PROVIDER_LABELS[flow.provider]}</strong>
              <p>
                Откройте бота, нажмите «Начать» и подтвердите запрос. Затем вернитесь на эту
                страницу.
              </p>
              <div className="auth-social-actions">
                <a href={flow.pairing.launchUrl} target="_blank" rel="noreferrer">
                  Открыть бота ещё раз
                </a>
                <button type="button" className="link-button" onClick={cancel}>
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {message ? (
        <p className="auth-provider-feedback" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function SocialRegistrationForm({
  flow,
  onRegistered,
  onCancel,
  onUnavailable,
  onUsePassword,
}: {
  flow: ProviderFlow & { phase: 'registration' };
  onRegistered: (session: SessionPayload) => void;
  onCancel: () => void;
  onUnavailable?: () => void;
  onUsePassword?: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState(flow.profile.username ?? '');
  const [displayName, setDisplayName] = useState(flow.profile.displayName ?? '');
  const [birthDate, setBirthDate] = useState('');
  const [country, setCountry] = useState('RU');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const id = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending.current) return;
    if (password.length < 10 || password !== confirmPassword) {
      setError(
        password.length < 10
          ? 'Пароль должен содержать не меньше 10 символов.'
          : 'Повтор пароля не совпадает.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    pending.current = controller;
    const result = await api.registerSocialPairing(
      flow.provider,
      {
        pairingToken: flow.pairing.pairingToken,
        email: email.trim(),
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        birthDate,
        country,
        password,
      },
      controller.signal,
    );
    if (pending.current === controller) pending.current = null;
    if (!alive.current || controller.signal.aborted) return;
    setBusy(false);
    if (result.ok) {
      onRegistered(result.data);
      return;
    }
    if (result.status === 0 || result.status >= 500) onUnavailable?.();
    setError(result.error.message || 'Не удалось создать аккаунт. Проверьте данные.');
  }

  return (
    <form
      className="auth-social-registration"
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
    >
      <h2>Завершить регистрацию</h2>
      <p>
        {SOCIAL_PROVIDER_LABELS[flow.provider]} подтверждён. Укажите данные нового аккаунта ASA Lab.
      </p>
      {onUsePassword ? (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            pending.current?.abort();
            onUsePassword();
          }}
        >
          У меня уже есть аккаунт — войти по паролю
        </button>
      ) : null}
      <label htmlFor={`${id}-email`}>Email</label>
      <input
        id={`${id}-email`}
        type="email"
        autoComplete="email"
        required
        disabled={busy}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor={`${id}-username`}>Имя пользователя</label>
      <input
        id={`${id}-username`}
        autoComplete="username"
        required
        minLength={3}
        maxLength={40}
        disabled={busy}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <label htmlFor={`${id}-display-name`}>Отображаемое имя</label>
      <input
        id={`${id}-display-name`}
        autoComplete="name"
        maxLength={255}
        disabled={busy}
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
      />
      <div className="auth-social-profile-grid">
        <div>
          <label htmlFor={`${id}-birth-date`}>Дата рождения</label>
          <input
            id={`${id}-birth-date`}
            type="date"
            autoComplete="bday"
            required
            disabled={busy}
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-country`}>Страна</label>
          <select
            id={`${id}-country`}
            autoComplete="country"
            value={country}
            disabled={busy}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="RU">Россия</option>
            <option value="KZ">Казахстан</option>
            <option value="BY">Беларусь</option>
            <option value="AM">Армения</option>
            <option value="RS">Сербия</option>
          </select>
        </div>
      </div>
      <label htmlFor={`${id}-password`}>Пароль для входа</label>
      <input
        id={`${id}-password`}
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        disabled={busy}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <p className="field-hint">
        Пароль для входа, если мессенджер недоступен. Не меньше 10 символов.
      </p>
      <label htmlFor={`${id}-confirm-password`}>Повторите пароль</label>
      <input
        id={`${id}-confirm-password`}
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        disabled={busy}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      <p className="field-hint">
        Личный аккаунт доступен с 18 лет. Подтверждение почты отдельно не требуется.
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="auth-social-form-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Создаём…' : 'Создать аккаунт и войти'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            pending.current?.abort();
            onCancel();
          }}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
