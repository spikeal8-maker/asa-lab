// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type AuthProviderAvailability, type SessionPayload } from './api';
import { RegisterPage } from './pages/RegisterPage';
import { registrationDisplayName } from './registration-profile';
import {
  availableSocialProviders,
  SocialAuthButtons,
  socialLaunchUrl,
  providerWebhookUrl,
  AuthProviderStatus,
  useAuthProviders,
} from './auth-providers';

vi.mock('./api', () => ({
  api: {
    startSocialPairing: vi.fn(),
    completeSocialPairing: vi.fn(),
    registerSocialPairing: vi.fn(),
    register: vi.fn(),
    maxRegister: vi.fn(),
    authProviders: vi.fn(),
    localPreviewConfig: vi.fn(),
  },
}));
vi.mock('./components/BotCheck', () => ({
  BotCheck: ({ onVerified }: { onVerified: (proof: unknown) => void }) =>
    createElement(
      'button',
      {
        type: 'button',
        onClick: () => onVerified({ synthetic: true }),
      },
      'Подтвердить тест',
    ),
}));

const provider = (
  id: AuthProviderAvailability['id'],
  available: boolean,
  reason: AuthProviderAvailability['reason'] = available ? 'ready' : 'invalid_token',
): AuthProviderAvailability => ({ id, available, reason, checkedAt: null });

describe('provider discovery availability feedback', () => {
  let root: Root;
  let container: HTMLDivElement;
  function Discovery() {
    const state = useAuthProviders();
    return createElement(
      'div',
      null,
      createElement(AuthProviderStatus, {
        status: state.status,
        onRetry: () => void state.refresh(),
      }),
      createElement(
        'output',
        { 'data-testid': 'available' },
        availableSocialProviders(state.providers)
          .map((value) => value.id)
          .join(','),
      ),
      createElement('button', { type: 'button', onClick: () => void state.refresh() }, 'Обновить'),
    );
  }
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  async function refresh(label: string) {
    const button = [...container.querySelectorAll('button')].find(
      (value) => value.textContent === label,
    )!;
    await act(async () => button.click());
  }
  it('distinguishes an outage from disabled providers, fails closed, and recovers on explicit retry', async () => {
    vi.mocked(api.authProviders)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { providers: [provider('max', true)] },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'PRIVATE_INTERNAL' },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { providers: [provider('telegram', true)] },
      });
    await act(async () => root.render(createElement(Discovery)));
    expect(container.querySelector('output')?.textContent).toBe('max');
    await refresh('Обновить');
    expect(container.querySelector('output')?.textContent).toBe('');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Не удалось проверить вход',
    );
    expect(container.textContent).not.toContain('PRIVATE_INTERNAL');
    await refresh('Проверить ещё раз');
    expect(container.querySelector('output')?.textContent).toBe('telegram');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
  it('does not label a successful empty or disabled result as a network failure', async () => {
    vi.mocked(api.authProviders)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { providers: [] } })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { providers: [provider('max', false)] },
      });
    await act(async () => root.render(createElement(Discovery)));
    expect(container.querySelector('[role="status"]')).toBeNull();
    await refresh('Обновить');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('output')?.textContent).toBe('');
  });
  it('shows pending discovery and aborts late results on unmount', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof api.authProviders>>) => void;
    vi.mocked(api.authProviders).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await act(async () => root.render(createElement(Discovery)));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Проверяем способы входа',
    );
    const signal = vi.mocked(api.authProviders).mock.calls[0]![0]!;
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve({ ok: true, status: 200, data: { providers: [provider('max', true)] } }),
    );
    expect(container.textContent).toBe('');
  });
  it('handles a rejected discovery promise without exposing technical details', async () => {
    vi.mocked(api.authProviders).mockRejectedValueOnce(new Error('PRIVATE_NETWORK_URL'));
    await act(async () => root.render(createElement(Discovery)));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Войдите по почте и паролю',
    );
    expect(container.textContent).not.toContain('PRIVATE_NETWORK_URL');
  });
});

describe('confirmed unlinked provider account choice', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  const onAuthenticated = vi.fn();
  const onUsePassword = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(api.startSocialPairing).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        pairingToken: 'confirmed-pairing',
        launchUrl: 'https://max.ru/fixture_bot?start=opaque',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    vi.mocked(api.completeSocialPairing).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: 'registration_required',
        profile: { displayName: 'Подтверждённый', username: 'confirmed' },
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(
      (entry) =>
        (
          entry.querySelector('span:not([aria-hidden])')?.textContent ?? entry.textContent
        )?.trim() === label,
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.click());
  }
  async function confirm(purpose: 'login' | 'register' | 'link') {
    await act(async () =>
      root!.render(
        createElement(SocialAuthButtons, {
          providers: [provider('max', true)],
          purpose,
          onAuthenticated,
          onUsePassword,
        }),
      ),
    );
    await click(
      purpose === 'login'
        ? 'Войти через MAX'
        : purpose === 'register'
          ? 'Создать через MAX'
          : 'Подключить MAX',
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
  }

  it.each(['login', 'register'] as const)(
    '%s asks before collecting new-account data',
    async (purpose) => {
      await confirm(purpose);
      expect(container.textContent).toContain('Войти в существующий аккаунт');
      expect(container.textContent).toContain('Создать новый аккаунт');
      expect(container.querySelector('form')).toBeNull();
      expect(api.registerSocialPairing).not.toHaveBeenCalled();
      await click('Создать новый аккаунт');
      expect(container.querySelector('.auth-social-registration')).not.toBeNull();
      expect(api.startSocialPairing).toHaveBeenCalledTimes(1);
      expect(api.registerSocialPairing).not.toHaveBeenCalled();
      expect(onAuthenticated).not.toHaveBeenCalled();
    },
  );

  it('returns to existing password proof without creating or silently linking an account', async () => {
    await confirm('login');
    await click('Войти в существующий аккаунт');
    expect(onUsePassword).toHaveBeenCalledTimes(1);
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(api.registerSocialPairing).not.toHaveBeenCalled();
    expect(container.querySelector('form')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.completeSocialPairing).toHaveBeenCalledTimes(1);
  });

  it('expires the choice without permitting late registration', async () => {
    await confirm('login');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(container.textContent).toContain('Время подтверждения истекло');
    expect(container.textContent).not.toContain('Создать новый аккаунт');
    expect(api.registerSocialPairing).not.toHaveBeenCalled();
  });

  it('keeps authenticated linked identities on the direct login path', async () => {
    const session = { authenticated: true } as unknown as SessionPayload;
    vi.mocked(api.completeSocialPairing).mockResolvedValue({
      ok: true,
      status: 200,
      data: { status: 'authenticated', session },
    });
    await confirm('login');
    expect(onAuthenticated).toHaveBeenCalledWith(session);
    expect(container.textContent).not.toContain('Создать новый аккаунт');
  });

  it('never offers registration when a same-account link attempt is rejected', async () => {
    await confirm('link');
    expect(container.textContent).toContain('Не удалось связать способ');
    expect(container.textContent).not.toContain('Создать новый аккаунт');
    expect(api.registerSocialPairing).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});

describe('registration without a mandatory public handle', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(api.authProviders).mockResolvedValue({
      ok: true,
      status: 200,
      data: { providers: [] },
    });
    vi.mocked(api.localPreviewConfig).mockResolvedValue({
      ok: true,
      status: 200,
      data: { enabled: false },
    });
    for (const method of [api.register, api.maxRegister, api.registerSocialPairing]) {
      vi.mocked(method).mockResolvedValue({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Сервер пока недоступен' },
      });
    }
    vi.mocked(api.startSocialPairing).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        pairingToken: 'registration-pairing',
        launchUrl: 'https://max.ru/fixture_bot?start=opaque',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    vi.mocked(api.completeSocialPairing).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        status: 'registration_required',
        profile: { displayName: null, username: 'messenger-name' },
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  async function click(text: string) {
    const button = [...container.querySelectorAll('button')].find((entry) =>
      entry.textContent?.trim().endsWith(text),
    );
    if (!button) throw new Error(`Missing button: ${text}`);
    await act(async () => button.click());
  }
  async function fill(text: string, value: string) {
    const label = [...container.querySelectorAll('label')].find(
      (entry) => entry.textContent?.trim() === text,
    );
    const input = label && container.querySelector<HTMLInputElement>(`[id="${label.htmlFor}"]`);
    if (!input) throw new Error(`Missing field: ${text}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function mount(kind: 'ordinary' | 'legacy-max' | 'social-max') {
    await act(async () =>
      root.render(
        kind === 'social-max'
          ? createElement(SocialAuthButtons, {
              providers: [provider('max', true)],
              purpose: 'register',
              onAuthenticated: vi.fn(),
              onUsePassword: vi.fn(),
            })
          : createElement(RegisterPage, {
              onRegistered: vi.fn(),
              onBackToLogin: vi.fn(),
              onHome: vi.fn(),
              ...(kind === 'legacy-max' ? { maxInitData: 'signed-max' } : {}),
            }),
      ),
    );
    if (kind === 'social-max') {
      await click('Создать через MAX');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      await click('Создать новый аккаунт');
    }
    await fill('Email', 'private-person@example.test');
    await fill('Дата рождения', '1988-03-01');
    await fill(kind === 'social-max' ? 'Пароль для входа' : 'Пароль', 'safe-password-2026');
    if (kind !== 'ordinary') await fill('Повторите пароль', 'safe-password-2026');
  }
  async function submit(kind: 'ordinary' | 'legacy-max' | 'social-max') {
    if (kind === 'ordinary') await click('Подтвердить тест');
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }
  it('keeps optional display names without exposing an email or generated handle as a fallback', () => {
    expect(registrationDisplayName('')).toBe('Пользователь');
    expect(registrationDisplayName(' Имя из MAX ')).toBe('Имя из MAX');
  });
  it.each(['ordinary', 'legacy-max', 'social-max'] as const)(
    '%s keeps a private generated handle stable across ambiguous failures and rotates only definite conflicts',
    async (kind) => {
      await mount(kind);
      expect(container.textContent).not.toContain('Имя пользователя');
      expect(container.textContent).toContain('Почта будет вашим логином');
      const method =
        kind === 'ordinary'
          ? api.register
          : kind === 'legacy-max'
            ? api.maxRegister
            : api.registerSocialPairing;
      await submit(kind);
      const body = (index: number) =>
        vi.mocked(method).mock.calls[index]![kind === 'social-max' ? 1 : 0] as {
          username: string;
          displayName: string;
          email: string;
        };
      expect(body(0)).toMatchObject({
        email: 'private-person@example.test',
        displayName: 'Пользователь',
        username: expect.stringMatching(/^u_[a-f0-9]{32}$/),
      });
      expect(vi.mocked(method)).toHaveBeenCalledTimes(1); // No automatic retry after a 503.
      vi.mocked(method).mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: { code: 'username_taken', message: 'internal conflict' },
      });
      await submit(kind);
      expect(body(1).username).toBe(body(0).username); // Unknown outcome never changes identity.
      expect(container.textContent).toContain('Повторите отправку формы');
      expect(vi.mocked(method)).toHaveBeenCalledTimes(2); // Conflict also requires explicit submit.
      await submit(kind);
      expect(body(2).username).toMatch(/^u_[a-f0-9]{32}$/);
      expect(body(2).username).not.toBe(body(1).username);
      expect(vi.mocked(method)).toHaveBeenCalledTimes(3);
    },
  );
});

describe('available sign-in methods', () => {
  it('shows only server-available implemented methods, with no email placeholder', () => {
    expect(
      availableSocialProviders([
        provider('max', false),
        provider('telegram', true),
        provider('email', false, 'not_configured'),
      ]).map((entry) => entry.id),
    ).toEqual(['telegram']);
    // A future server email capability must not invent an unfinished UI flow.
    expect(availableSocialProviders([provider('email', true)])).toEqual([]);
  });

  it('renders no social section when every channel is unavailable', () => {
    const html = renderToStaticMarkup(
      createElement(SocialAuthButtons, {
        providers: [provider('max', false), provider('telegram', false, 'delivery_unavailable')],
        purpose: 'login',
        onAuthenticated: vi.fn(),
      }),
    );
    expect(html).toBe('');
  });

  it('allows the first native check without claiming enforcement eligibility', () => {
    const html = renderToStaticMarkup(
      createElement(SocialAuthButtons, {
        providers: [
          {
            ...provider('max', true),
            enforcementEligible: false,
            enforcementReason: 'delivery_unverified',
          },
        ],
        purpose: 'link',
        linkActionLabel: 'Подтвердить в боте',
        onAuthenticated: vi.fn(),
      }),
    );
    expect(html).toContain('Подтвердить в боте MAX');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('Вход проверен');
  });

  it('keeps visible button text specific to login, registration and same-account linking', () => {
    for (const [purpose, label] of [
      ['login', 'Войти через Telegram'],
      ['register', 'Создать через Telegram'],
      ['link', 'Подключить Telegram'],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(SocialAuthButtons, {
          providers: [provider('max', false), provider('telegram', true)],
          purpose,
          onAuthenticated: vi.fn(),
        }),
      );
      expect(html).toContain(label);
      expect(html).not.toContain('auth-provider-max');
      expect(html).not.toContain('Email');
    }
  });
});

describe('messenger launch destinations', () => {
  it('formats a public callback without inferring browser-origin trust', () => {
    expect(providerWebhookUrl('max', 'https://asa.example.test/max-login')).toBe(
      'https://asa.example.test/api/auth/max/webhook',
    );
    expect(providerWebhookUrl('telegram', 'https://192.0.2.20:8443/')).toBe(
      'https://192.0.2.20:8443/api/auth/telegram/webhook',
    );
    expect(providerWebhookUrl('telegram', 'http://192.0.2.20/')).toBeNull();
    expect(providerWebhookUrl('max', 'https://name:secret@asa.example.test/')).toBeNull();
    expect(providerWebhookUrl('max', '')).toBeNull();
  });
  it('accepts HTTPS native bot links for their matching provider', () => {
    expect(socialLaunchUrl('max', 'https://max.ru/fixture_bot?start=opaque')).toBe(
      'https://max.ru/fixture_bot?start=opaque',
    );
    expect(socialLaunchUrl('telegram', 'https://t.me/fixture_bot?start=opaque')).toBe(
      'https://t.me/fixture_bot?start=opaque',
    );
    expect(socialLaunchUrl('telegram', 'https://telegram.me/fixture_bot')).toBe(
      'https://telegram.me/fixture_bot',
    );
  });

  it.each([
    ['max', 'http://max.ru/fixture_bot'],
    ['max', 'https://max.ru.example.test/fixture_bot'],
    ['max', 'https://user:password@max.ru/fixture_bot'],
    ['max', 'https://t.me/fixture_bot'],
    ['telegram', 'https://example.test/fixture_bot'],
    ['telegram', 'javascript:alert(1)'],
    ['telegram', '/relative-bot'],
  ] as const)('rejects an unexpected %s destination %s', (method, url) => {
    expect(socialLaunchUrl(method, url)).toBeNull();
  });
});
