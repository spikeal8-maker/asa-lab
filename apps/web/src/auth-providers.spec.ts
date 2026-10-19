import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AuthProviderAvailability } from './api';
import {
  availableSocialProviders,
  SocialAuthButtons,
  socialLaunchUrl,
  providerWebhookUrl,
} from './auth-providers';

vi.mock('./api', () => ({ api: {} }));

const provider = (
  id: AuthProviderAvailability['id'],
  available: boolean,
  reason: AuthProviderAvailability['reason'] = available ? 'ready' : 'invalid_token',
): AuthProviderAvailability => ({ id, available, reason, checkedAt: null });

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
