import { expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  EmailService,
  mailAddress,
  mailConfiguration,
  mailKey,
  sealMailPassword,
  openMailPassword,
  emailTokenHash,
  mailFailure,
  smtpTransportOptions,
} from './email.service.js';
const KEY = 'ab'.repeat(32),
  config = {
    enabled: true,
    host: 'smtp.example.test',
    port: 587 as const,
    sender: 'asa@example.test',
    username: 'asa@example.test',
    siteOrigin: 'https://portal.example.test',
  };
function fixture(overrides: Record<string, unknown> = {}) {
  const runtime = {
    config,
    passwordEnvelope: sealMailPassword('sensitive-mail-password', Buffer.from(KEY, 'hex')),
    version: 4,
    testedVersion: 4,
    testedAt: '2026-10-25T10:00:00Z',
    testOk: true,
    deliveryVerifiedVersion: null,
    ...overrides,
  };
  const sendMail = vi.fn(async () => ({ accepted: ['new@example.test'], rejected: [] })),
    verify = vi.fn(async () => true),
    close = vi.fn(),
    transport = vi.fn(async () => ({ sendMail, verify, close }));
  const status = {
    accountId: 'target',
    email: 'old@example.test',
    verified: true,
    pending: { state: 'sent' },
  };
  const query = vi.fn(async (sql: string, ...args: unknown[]) => ({
    rows: [
      {
        value: (void args, sql.includes('mail_runtime'))
          ? runtime
          : sql.includes('mail_intent_create')
            ? { created: true, status }
            : sql.includes('mail_admin_config')
              ? { ...runtime, passwordEnvelope: undefined, passwordConfigured: true }
              : sql.includes('mail_intent_status')
                ? status
                : null,
      },
    ],
  }));
  const service = new EmailService({ query } as unknown as pg.Pool, {
    encryptionKey: KEY,
    transport,
  });
  return { runtime, sendMail, verify, close, transport, query, service, status };
}
it('validates addresses, protected ports, hostnames and canonical site origins', () => {
  expect(mailAddress('User@example.test')).toBe('user@example.test');
  for (const bad of [
    'bad@example.test\r\nBcc:other@example.test',
    '<a@example.test>',
    'a@localhost',
    '.a@example.test',
    'a..b@example.test',
    'a@bad..test',
  ])
    expect(() => mailAddress(bad)).toThrow();
  expect(mailConfiguration(config)).toEqual(config);
  for (const change of [
    { port: 25 },
    { host: 'https://smtp.example.test' },
    { host: '127.0.0.1' },
    { username: 'a\nb' },
    { siteOrigin: 'https://portal.example.test/#secret' },
    { siteOrigin: 'https://user:password@portal.example.test' },
    { siteOrigin: 'http://public.example.test' },
  ])
    expect(() => mailConfiguration({ ...config, ...change })).toThrow();
  expect(mailConfiguration({ ...config, siteOrigin: 'http://127.0.0.1:4610' }).siteOrigin).toBe(
    'http://127.0.0.1:4610',
  );
});
it('encrypts passwords under the installation key with authenticated purpose and fresh IVs', () => {
  const key = mailKey(KEY)!;
  expect(mailKey('missing')).toBeNull();
  const a = sealMailPassword('secret', key),
    b = sealMailPassword('secret', key);
  expect(a).not.toEqual(b);
  expect(JSON.stringify(a)).not.toContain('secret');
  expect(openMailPassword(a, key)).toBe('secret');
  expect(() =>
    openMailPassword({ ...a, tag: Buffer.alloc(16).toString('base64url') }, key),
  ).toThrow();
  expect(() => openMailPassword(a, Buffer.alloc(32))).toThrow();
});
it('has exact readable Russian errors rather than encoding-corrupted text', () => {
  try {
    mailFailure('mail_invalid');
  } catch (e) {
    expect((e as { getResponse: () => unknown }).getResponse()).toEqual({
      error: { code: 'mail_invalid', message: 'Проверьте поля почты и адрес сайта.' },
    });
  }
});
it('does not present connection verification alone as proven inbox delivery', async () => {
  const f = fixture();
  expect(await f.service.availability()).toMatchObject({
    available: true,
    enforcementEligible: false,
    enforcementReason: 'delivery_unverified',
  });
  f.runtime.deliveryVerifiedVersion = 4 as never;
  expect(await f.service.availability()).toMatchObject({ enforcementEligible: true });
  f.runtime.testOk = false;
  expect(await f.service.availability()).toMatchObject({
    available: false,
    enforcementEligible: false,
  });
});
it('fails closed for missing key/password, stale version and rejected or failed SMTP', async () => {
  const missing = fixture({ passwordEnvelope: null });
  await expect(missing.service.test('admin', 4, null, 'request')).rejects.toMatchObject({
    status: 503,
  });
  expect(missing.transport).not.toHaveBeenCalled();
  const f = fixture();
  await expect(f.service.test('admin', 3, null, 'request')).rejects.toMatchObject({ status: 409 });
  expect(f.transport).not.toHaveBeenCalled();
  f.verify.mockRejectedValueOnce(
    new Error('smtp sensitive-mail-password upstream user@example.test'),
  );
  await expect(f.service.test('admin', 4, null, 'request')).rejects.toMatchObject({ status: 503 });
  expect(f.close).toHaveBeenCalled();
  expect(
    f.query.mock.calls.some(
      ([sql, args]) => sql.includes('mail_test_result') && args?.[2] === false,
    ),
  ).toBe(true);
  f.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['new@example.test'] });
  await expect(
    f.service.request('admin', 'target', true, 'new@example.test', 'version', 'Reason', 'id'),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    f.query.mock.calls.some(
      ([sql, args]) => sql.includes('mail_intent_delivery') && args?.[2] === false,
    ),
  ).toBe(true);
});
it('delivers raw proof only inside mail, stores only a hash, and never returns proof or password', async () => {
  const f = fixture(),
    result = await f.service.request(
      'admin',
      'target',
      true,
      'new@example.test',
      'version',
      'Reason',
      'id',
    );
  const mail = f.sendMail.mock.calls[0]![0] as unknown as { text: string; subject: string };
  expect(mail.subject).toBe('Подтверждение почты ASA Lab');
  const token = mail.text.match(/confirm-email#([A-Za-z0-9_-]{43})/)![1]!;
  const create = f.query.mock.calls.find(([sql]) => sql.includes('mail_intent_create'))!;
  expect(create[1]?.[8]).toBe(emailTokenHash(token));
  expect(JSON.stringify(f.query.mock.calls)).not.toContain(token);
  expect(JSON.stringify(result)).not.toContain(token);
  expect(JSON.stringify(result)).not.toContain('sensitive-mail-password');
  expect(mail.text).toContain('https://portal.example.test/confirm-email#');
});
it('does not send twice for idempotent lost-response retry and rejects unavailable or unauthorized requests', async () => {
  const f = fixture();
  f.query.mockImplementation(async (sql: string) => ({
    rows: [
      {
        value: sql.includes('mail_runtime')
          ? f.runtime
          : sql.includes('mail_intent_create')
            ? { created: false, status: f.status }
            : f.status,
      },
    ],
  }));
  await f.service.request('admin', 'target', true, 'new@example.test', 'version', 'Reason', 'id');
  expect(f.transport).not.toHaveBeenCalled();
  f.query.mockRejectedValueOnce({ code: '42501' });
  await expect(
    f.service.request('teacher', 'target', true, 'new@example.test', 'version', 'Reason', 'id'),
  ).rejects.toMatchObject({ status: 403 });
  expect(f.transport).not.toHaveBeenCalled();
  const bad = fixture({ testOk: false });
  await expect(
    bad.service.request('a', 'target', true, 'new@example.test', 'v', 'Reason', 'id'),
  ).rejects.toMatchObject({ status: 503 });
  expect(bad.transport).not.toHaveBeenCalled();
});

it('requires TLS and certificate validation on both supported transports and forbids message-side file/URL access', () => {
  for (const port of [465, 587] as const) {
    const options = smtpTransportOptions({ ...config, port }, 'secret');
    expect(options).toMatchObject({
      secure: port === 465,
      requireTLS: port === 587,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: 'smtp.example.test' },
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(options.socketTimeout).toBeLessThanOrEqual(12000);
    expect(options.connectionTimeout).toBeLessThanOrEqual(8000);
  }
});
