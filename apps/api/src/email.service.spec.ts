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
function fixture(overrides: Record<string, unknown> = {}, now: () => number = Date.now) {
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
    now,
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
  let now = 0;
  const f = fixture({}, () => now);
  expect(await f.service.availability()).toMatchObject({
    available: true,
    enforcementEligible: false,
    enforcementReason: 'delivery_unverified',
  });
  f.runtime.deliveryVerifiedVersion = 4 as never;
  now += 1000;
  expect(await f.service.availability()).toMatchObject({ enforcementEligible: true });
  f.runtime.testOk = false;
  now += 1000;
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

const runtimeReads = (f: ReturnType<typeof fixture>) =>
  f.query.mock.calls.filter(([sql]) => sql.includes('mail_runtime')).length;
it('coalesces a 5000-request health burst and expires only the redacted public cache after one second', async () => {
  let now = 100;
  const f = fixture({}, () => now);
  const results = await Promise.all(Array.from({ length: 5000 }, () => f.service.availability()));
  expect(runtimeReads(f)).toBe(1);
  expect(results.every((value) => value === results[0])).toBe(true);
  expect(Object.isFrozen(results[0])).toBe(true);
  expect(Object.keys(results[0]!).sort()).toEqual(
    ['id', 'available', 'reason', 'checkedAt', 'enforcementEligible', 'enforcementReason'].sort(),
  );
  expect(JSON.stringify(results)).not.toContain('passwordEnvelope');
  expect(JSON.stringify(results)).not.toContain('sensitive-mail-password');
  now += 999;
  await f.service.availability();
  expect(runtimeReads(f)).toBe(1);
  now += 1;
  await Promise.all(Array.from({ length: 100 }, () => f.service.availability()));
  expect(runtimeReads(f)).toBe(2);
});
it('bounds unavailable health caching during database failure and retries after the same short TTL', async () => {
  let now = 0;
  const f = fixture({}, () => now);
  f.query.mockRejectedValueOnce(new Error('database unavailable'));
  const results = await Promise.all(Array.from({ length: 100 }, () => f.service.availability()));
  expect(f.query).toHaveBeenCalledTimes(1);
  expect(results.every((value) => !value.available && !value.enforcementEligible)).toBe(true);
  now = 999;
  await f.service.availability();
  expect(f.query).toHaveBeenCalledTimes(1);
  now = 1000;
  expect(await f.service.availability()).toMatchObject({
    available: true,
    enforcementEligible: false,
  });
  expect(f.query).toHaveBeenCalledTimes(2);
});
it('invalidates immediately after a committed configuration save while keeping privileged reads uncached', async () => {
  const f = fixture();
  await f.service.availability();
  f.runtime.config = { ...config, enabled: false };
  await f.service.save('admin', { version: 4, config: f.runtime.config }, 'request');
  expect(await f.service.availability()).toMatchObject({
    available: false,
    enforcementEligible: false,
  });
  expect(runtimeReads(f)).toBe(2);
  const before = f.query.mock.calls.filter(([sql]) => sql.includes('mail_admin_config')).length;
  await f.service.adminConfig('admin');
  await f.service.adminConfig('admin');
  expect(f.query.mock.calls.filter(([sql]) => sql.includes('mail_admin_config')).length).toBe(
    before + 2,
  );
  await f.service.status('actor-a', 'target-a', true);
  await f.service.status('actor-b', 'target-b', false);
  expect(
    f.query.mock.calls
      .filter(([sql]) => sql.includes('mail_intent_status'))
      .map(([, args]) => args),
  ).toEqual([
    ['actor-a', 'target-a', true],
    ['actor-b', 'target-b', false],
  ]);
});
it('invalidates after a successful connection test and still reads fresh transport credentials', async () => {
  const f = fixture({ testOk: false });
  await f.service.availability();
  f.runtime.testOk = true;
  await f.service.test('admin', 4, null, 'request');
  expect(f.verify).toHaveBeenCalledTimes(1);
  expect(f.transport).toHaveBeenCalledWith(config, 'sensitive-mail-password');
  expect(await f.service.availability()).toMatchObject({
    available: true,
    enforcementEligible: false,
  });
  expect(runtimeReads(f)).toBe(3);
});
it('invalidates a previously ready cache after the failed connection result is persisted', async () => {
  const f = fixture({ deliveryVerifiedVersion: 4 });
  await f.service.availability();
  f.runtime.testOk = false;
  f.verify.mockRejectedValueOnce(new Error('unavailable'));
  await expect(f.service.test('admin', 4, null, 'request')).rejects.toMatchObject({ status: 503 });
  expect(await f.service.availability()).toMatchObject({
    available: false,
    enforcementEligible: false,
  });
  expect(runtimeReads(f)).toBe(3);
});
it('invalidates on consumed email proof, but never caches or treats an invalid proof as confirmation', async () => {
  const f = fixture();
  await f.service.availability();
  f.query.mockResolvedValueOnce({ rows: [{ value: { confirmed: false } }] } as never);
  expect(await f.service.consume('A'.repeat(43))).toEqual({ confirmed: false });
  await f.service.availability();
  expect(runtimeReads(f)).toBe(1);
  f.runtime.deliveryVerifiedVersion = 4 as never;
  f.query.mockResolvedValueOnce({
    rows: [{ value: { confirmed: true, changed: false } }],
  } as never);
  expect(await f.service.consume('B'.repeat(43))).toEqual({ confirmed: true, changed: false });
  expect(await f.service.availability()).toMatchObject({
    available: true,
    enforcementEligible: true,
  });
  expect(runtimeReads(f)).toBe(2);
});
for (const sent of [false, true])
  it(`invalidates after a persisted ${sent ? 'accepted' : 'failed'} delivery without reusing cached transport or target authorization`, async () => {
    const f = fixture();
    await f.service.availability();
    f.sendMail.mockImplementationOnce(async () => {
      f.runtime.testOk = false;
      if (!sent) throw new Error('delivery rejected');
      return { accepted: ['new@example.test'], rejected: [] };
    });
    const request = f.service.request(
      'actor',
      'target',
      true,
      'new@example.test',
      'version',
      'Reason',
      'request',
    );
    if (sent) await request;
    else await expect(request).rejects.toMatchObject({ status: 503 });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.find(([sql]) => sql.includes('mail_intent_status'))?.[1]).toEqual([
      'actor',
      'target',
      true,
    ]);
    expect(await f.service.availability()).toMatchObject({
      available: false,
      enforcementEligible: false,
    });
    expect(runtimeReads(f)).toBe(3);
  });
it('prevents an old in-flight health result from being returned or cached after configuration invalidation', async () => {
  const f = fixture();
  let oldResolve!: (value: unknown) => void, newResolve!: (value: unknown) => void;
  const oldRead = new Promise<unknown>((resolve) => {
      oldResolve = resolve;
    }),
    newRead = new Promise<unknown>((resolve) => {
      newResolve = resolve;
    });
  const oldRuntime = { ...f.runtime, deliveryVerifiedVersion: 4 };
  f.query.mockImplementationOnce(() => oldRead as never);
  const oldFirst = f.service.availability(),
    oldSecond = f.service.availability();
  expect(runtimeReads(f)).toBe(1);
  f.runtime.config = { ...config, enabled: false };
  await f.service.save('admin', { version: 4, config: f.runtime.config }, 'request');
  f.query.mockImplementationOnce(() => newRead as never);
  const current = f.service.availability();
  expect(runtimeReads(f)).toBe(2);
  oldResolve({ rows: [{ value: oldRuntime }] });
  await Promise.resolve();
  await Promise.resolve();
  const joined = f.service.availability();
  expect(runtimeReads(f)).toBe(2);
  newResolve({ rows: [{ value: f.runtime }] });
  for (const result of await Promise.all([oldFirst, oldSecond, current, joined]))
    expect(result).toMatchObject({ available: false, enforcementEligible: false });
  await f.service.availability();
  expect(runtimeReads(f)).toBe(2);
});

it('accepts an empty OFF configuration but never relaxes validation when enabled or for unsafe nonempty fields', async () => {
  const off = { ...config, enabled: false, host: '', sender: '', username: '', siteOrigin: '' };
  expect(mailConfiguration(off)).toEqual(off);
  expect(() => mailConfiguration({ ...off, enabled: true })).toThrow();
  for (const bad of [
    { host: 'http://smtp.example.test' },
    { sender: 'bad\r\nBcc:other@example.test' },
    { username: 'bad\nuser' },
    { siteOrigin: 'https://site.example.test/#proof' },
    { port: 25 },
  ])
    expect(() => mailConfiguration({ ...off, ...bad })).toThrow();
  const f = fixture();
  await f.service.save('admin', { version: 4, config: off }, 'request');
  expect(f.transport).not.toHaveBeenCalled();
  const saved = f.query.mock.calls.find(([sql]) => sql.includes('mail_config_save'))!;
  expect(JSON.parse(saved[1]![2] as string)).toEqual(off);
});

it('does not advertise or send through an OFF draft even with retained credentials and successful old checks', async () => {
  const f = fixture({ config: { ...config, enabled: false, host: '', sender: '', username: '' } });
  expect(await f.service.availability()).toMatchObject({
    available: false,
    enforcementEligible: false,
  });
  await expect(
    f.service.request('admin', 'target', true, 'new@example.test', 'v', 'Reason', 'request'),
  ).rejects.toMatchObject({ status: 503 });
  expect(f.transport).not.toHaveBeenCalled();
});
