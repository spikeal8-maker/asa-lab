import { expect, it, vi } from 'vitest';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { EmailController, mailBody, mailId } from './email.controller';
import type { EmailService } from './email.service';
const ACCOUNT = '20000000-0000-4000-8000-000000000001',
  PRINCIPAL = '20000000-0000-4000-8000-000000000002';
function fixture(authenticated = true) {
  const accounts = {
      resolve: vi.fn(async () =>
        authenticated ? { principalId: PRINCIPAL, accountId: ACCOUNT } : null,
      ),
    },
    mail = {
      adminConfig: vi.fn(),
      save: vi.fn(),
      status: vi.fn(async () => ({ email: 'own@example.test' })),
      request: vi.fn(),
      consume: vi.fn(),
      cancel: vi.fn(),
      test: vi.fn(),
    };
  return {
    accounts,
    mail,
    controller: new EmailController(
      accounts as unknown as ActiveContextUseCase,
      mail as unknown as EmailService,
    ),
  };
}
const req = (origin = 'https://portal.example.test') =>
  ({
    cookies: { asa_session: 'session' },
    headers: { origin, host: 'portal.example.test', 'content-type': 'application/json' },
    id: 'request',
    ip: '127.0.0.1',
  }) as unknown as FastifyRequest;
it('requires a session and same origin for mailbox mutations', async () => {
  const a = fixture(false);
  await expect(a.controller.config(req())).rejects.toMatchObject({ status: 401 });
  const b = fixture();
  await expect(b.controller.save(req('https://evil.example.test'), {})).rejects.toMatchObject({
    status: 403,
  });
  expect(b.mail.save).not.toHaveBeenCalled();
});
it('targets the current canonical Account and rejects stale account switching instead of verifying another person', async () => {
  const f = fixture();
  await f.controller.verify(req(), { accountId: ACCOUNT, requestId: PRINCIPAL });
  expect(f.mail.request).toHaveBeenCalledWith(
    PRINCIPAL,
    ACCOUNT,
    false,
    'own@example.test',
    null,
    'Подтверждение собственной почты',
    PRINCIPAL,
  );
  await expect(
    f.controller.verify(req(), { accountId: PRINCIPAL, requestId: ACCOUNT }),
  ).rejects.toMatchObject({ status: 409 });
});
it('rejects extra keys, invalid target identities and malformed expected versions', async () => {
  expect(() => mailId('student-seat')).toThrow();
  expect(() => mailBody({ token: 'x', password: 'secret' }, ['token'])).toThrow();
  const f = fixture();
  await expect(
    f.controller.change(req(), ACCOUNT, {
      email: 'new@example.test',
      version: 'old',
      reason: 'Reason',
      requestId: PRINCIPAL,
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(f.mail.request).not.toHaveBeenCalled();
});
it('accepts public token proof without acquiring Account authority and bounds proof attempts', async () => {
  const f = fixture(false);
  await f.controller.consume(req(), { token: 'A'.repeat(43) });
  expect(f.mail.consume).toHaveBeenCalledWith('A'.repeat(43));
  expect(f.accounts.resolve).not.toHaveBeenCalled();
  for (let n = 1; n < 30; n++) await f.controller.consume(req(), { token: 'B'.repeat(43) });
  await expect(f.controller.consume(req(), { token: 'C'.repeat(43) })).rejects.toMatchObject({
    status: 429,
  });
});
