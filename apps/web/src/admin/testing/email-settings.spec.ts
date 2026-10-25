// @vitest-environment jsdom
import { api } from '../../api';
import { EmailVerification } from '../../components/EmailVerification';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { emailApi, type SmtpStatus } from '../../email-api';
import { AdminEmailSettings } from '../AdminEmailSettings';
import { CrmEmailChange } from '../CrmEmailChange';
import { EmailConfirmationPage, takeEmailProof } from '../../pages/EmailConfirmationPage';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
const config: SmtpStatus = {
  config: { enabled: false },
  version: 1,
  passwordConfigured: false,
  encryptionReady: true,
  testedVersion: null,
  testedAt: null,
  testOk: false,
  deliveryVerifiedVersion: null,
};
it('shows an unavailable encrypted store honestly and permits disabling without exposing a password', async () => {
  vi.spyOn(emailApi, 'config').mockResolvedValue(
    ok({ ...config, encryptionReady: false, passwordConfigured: true }),
  );
  await act(async () =>
    root.render(createElement(AdminEmailSettings, { refreshKey: 0, onAccessDenied: vi.fn() })),
  );
  expect(host.textContent).toContain('Защита паролей недоступна');
  expect(host.querySelector('input[type=password]')?.getAttribute('value')).toBe('');
  expect(host.querySelector('input[type=password]')?.getAttribute('type')).toBe('password');
  expect(host.textContent).not.toContain('ASA_SETTINGS_ENCRYPTION_KEY');
});
it('does not apply an old config read after a refresh and handles denied reads', async () => {
  let resolve!: (value: ReturnType<typeof ok<SmtpStatus>>) => void;
  vi.spyOn(emailApi, 'config')
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'mail_denied', message: 'Нет доступа' },
    });
  const denied = vi.fn();
  await act(async () =>
    root.render(createElement(AdminEmailSettings, { refreshKey: 0, onAccessDenied: denied })),
  );
  expect(host.textContent).toContain('Загружаем');
  await act(async () =>
    root.render(createElement(AdminEmailSettings, { refreshKey: 1, onAccessDenied: denied })),
  );
  await act(async () => resolve(ok(config)));
  expect(host.textContent).toContain('Нет доступа');
  expect(host.querySelector('input')).toBeNull();
  expect(denied).toHaveBeenCalledOnce();
});
it('shows pending new mail with the old verified login, a cancel action, and never proof material', async () => {
  vi.spyOn(emailApi, 'status').mockResolvedValue(
    ok({
      accountId: 'target',
      email: 'old@example.test',
      verified: true,
      pending: {
        id: 'intent',
        email: 'new@example.test',
        purpose: 'change',
        state: 'sent',
        createdAt: '2026-10-25T10:00:00Z',
        expiresAt: '2030-01-01T10:00:00Z',
      },
    }),
  );
  const cancel = vi
    .spyOn(emailApi, 'cancel')
    .mockResolvedValue(
      ok({ accountId: 'target', email: 'old@example.test', verified: true, pending: null }),
    );
  await act(async () =>
    root.render(
      createElement(CrmEmailChange, {
        accountId: 'target',
        version: 'a'.repeat(64),
        onChanged: vi.fn(),
        onDenied: vi.fn(),
      }),
    ),
  );
  expect(host.textContent).toContain('Текущий адрес: old@example.test');
  expect(host.textContent).toContain('Ожидает подтверждения: new@example.test');
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Отменить запрос')!.click(),
  );
  expect(cancel).toHaveBeenCalledWith('intent', 'target');
  expect(host.textContent).not.toContain('Ожидает подтверждения');
});
it('erases the email fragment before rendering and consumes the proof only on an explicit action', async () => {
  const token = 'A'.repeat(43);
  history.replaceState(null, '', '/confirm-email#' + token);
  expect(takeEmailProof()).toBe(token);
  expect(location.hash).toBe('');
  const confirm = vi
    .spyOn(emailApi, 'confirm')
    .mockResolvedValue({ confirmed: true, changed: true });
  await act(async () => root.render(createElement(EmailConfirmationPage, { token })));
  expect(confirm).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')!.click());
  expect(confirm).toHaveBeenCalledExactlyOnceWith(token);
  expect(host.textContent).toContain('Войдите заново с новой почтой');
  expect(host.textContent).not.toContain(token);
});

it('uses parent-owned email readiness without starting another global verification request', async () => {
  const check = vi.spyOn(api, 'accountVerification');
  vi.spyOn(emailApi, 'status').mockResolvedValue(
    ok({ accountId: 'current', email: 'own@example.test', verified: false, pending: null }),
  );
  await act(async () =>
    root.render(createElement(EmailVerification, { accountId: 'current', available: true })),
  );
  const send = () =>
    [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Подтвердить почту по письму',
    ) as HTMLButtonElement;
  expect(send().disabled).toBe(false);
  expect(check).not.toHaveBeenCalled();
  await act(async () =>
    root.render(createElement(EmailVerification, { accountId: 'current', available: false })),
  );
  expect(send().disabled).toBe(true);
  expect(host.textContent).toContain('Почта сейчас недоступна');
  expect(check).not.toHaveBeenCalled();
});
