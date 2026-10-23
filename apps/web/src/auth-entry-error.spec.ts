import { describe, expect, it } from 'vitest';
import { authEntryErrorMessage } from './auth-entry-error';

describe('authentication entry failures', () => {
  it.each(['personal', 'organization'] as const)(
    'explains a restart-invalidated bot proof for %s instead of blaming the server/password',
    (kind) => {
      const message = authEntryErrorMessage(
        { status: 403, error: { code: 'bot_check_required' } },
        kind,
      );
      expect(message).toContain('Я не робот');
      expect(message).toContain('ещё раз');
      expect(message).not.toMatch(/пароль|ошибка сервера/i);
    },
  );

  it('directs an origin mismatch to the configured entry without claiming bad credentials', () => {
    expect(authEntryErrorMessage({ status: 403, error: { code: 'origin_forbidden' } })).toContain(
      'Вход по этому адресу не настроен',
    );
  });

  it('keeps NAT rate limiting distinct from password rejection', () => {
    const limited = authEntryErrorMessage({ status: 429, error: { code: 'too_many_attempts' } });
    expect(limited).toContain('Подождите');
    expect(limited).not.toContain('пароль');
    expect(authEntryErrorMessage({ status: 401, error: { code: 'unauthorized' } })).toBe(
      'Неверные данные для входа.',
    );
    expect(
      authEntryErrorMessage({ status: 401, error: { code: 'unauthorized' } }, 'organization'),
    ).toBe('Неверный код организации, email или пароль.');
  });

  it('separates real network timeouts and backend failures without reflecting server details', () => {
    expect(authEntryErrorMessage({ status: 0, error: { code: 'auth_timeout' } })).toContain(
      'слишком долго',
    );
    expect(authEntryErrorMessage({ status: 0, error: { code: 'network' } })).toContain(
      'Проверьте соединение',
    );
    expect(authEntryErrorMessage({ status: 503, error: { code: 'server_error' } })).toContain(
      'Сервис входа временно недоступен',
    );
    expect(authEntryErrorMessage({ status: 403, error: { code: 'unknown_private_error' } })).toBe(
      'Вход отклонён. Обновите страницу и попробуйте ещё раз.',
    );
  });
});
