// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type AuthProviderAvailability, type SessionPayload } from './api';
import {
  availableSocialProviders,
  SocialAuthButtons,
  socialLaunchUrl,
  providerWebhookUrl,
} from './auth-providers';

vi.mock('./api', () => ({
  api: {
    startSocialPairing: vi.fn(),
    completeSocialPairing: vi.fn(),
    registerSocialPairing: vi.fn(),
  },
}));

const provider = (
  id: AuthProviderAvailability['id'],
  available: boolean,
  reason: AuthProviderAvailability['reason'] = available ? 'ready' : 'invalid_token',
): AuthProviderAvailability => ({ id, available, reason, checkedAt: null });

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
