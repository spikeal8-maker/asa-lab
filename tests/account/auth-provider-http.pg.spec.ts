import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { LightMyRequestResponse } from 'fastify';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, fastifyOf, inject, type NestApp } from '../portal/app';
import { testAdminPool } from '../portal/helpers';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan as applyPlan } from '../migration/isolated-postgres-plan';

type Provider = 'max' | 'telegram';
const PROVIDERS = ['max', 'telegram'] as const;
const databaseName = `asa_provider_http_${randomUUID().replaceAll('-', '')}_test`;
const providerBot = {
  max: { id: 6101, username: 'asa_http_max_bot', token: 'test_only_max_http_token_000000' },
  telegram: {
    id: 6102,
    username: 'asa_http_telegram_bot',
    token: '6102:test_only_telegram_http_token_000000',
  },
};
let databaseOwner: pg.Pool;
let databaseCreated = false;
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let administrator: Awaited<ReturnType<typeof account>>;
let updateSequence = 0;

/** A synthetic browser retains server cookies, including HttpOnly cookies.
 * Tests inspect Set-Cookie; no nonce is obtained from a response JSON field. */
class BrowserCookies {
  private readonly values = new Map<string, string>();

  accept(response: LightMyRequestResponse): void {
    for (const cookie of response.cookies) {
      if (cookie.value) this.values.set(cookie.name, cookie.value);
      else this.values.delete(cookie.name);
    }
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  value(name: string): string | undefined {
    return this.values.get(name);
  }
}

function responseBody(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface Subscription {
  url: string;
  secret: string;
  updates: string[];
}
const subscriptions = new Map<Provider, Subscription>();
const confirmationButtons = new Map<string, string>();
const recipientFailures = new Map<string, number>();
const unexpectedFetches: string[] = [];

// This is the sole fake boundary: outside provider HTTP APIs. Account/session,
// settings encryption, provider health, webhook validation, SQL proof/consume,
// central guard, CSRF protection and all application controllers remain real.
const syntheticProviderFetch: typeof fetch = async (input, options) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const provider: Provider | null =
    url.hostname === 'platform-api2.max.ru'
      ? 'max'
      : url.hostname === 'api.telegram.org'
        ? 'telegram'
        : null;
  if (!provider) {
    unexpectedFetches.push(`unexpected host ${url.hostname}`);
    throw new Error('Unexpected external request in synthetic provider test');
  }
  const method = url.pathname.split('/').at(-1)!;
  const body =
    typeof options?.body === 'string'
      ? (JSON.parse(options.body) as Record<string, unknown>)
      : null;
  const answer = (value: unknown) =>
    responseBody(provider === 'telegram' ? { ok: true, result: value } : value);
  const bot = providerBot[provider];
  if (method === 'me' || method === 'getMe') {
    return answer({
      id: bot.id,
      user_id: bot.id,
      username: bot.username,
      is_bot: true,
      name: 'Synthetic HTTP bot',
    });
  }
  if ((method === 'subscriptions' && body) || method === 'setWebhook') {
    const subscription = {
      url: String(body?.['url'] ?? ''),
      secret: String(body?.[provider === 'max' ? 'secret' : 'secret_token'] ?? ''),
      updates: body?.[provider === 'max' ? 'update_types' : 'allowed_updates'] as string[],
    };
    subscriptions.set(provider, subscription);
    return answer(provider === 'max' ? { success: true } : true);
  }
  if (method === 'subscriptions' || method === 'getWebhookInfo') {
    const subscription = subscriptions.get(provider);
    return answer(
      provider === 'max'
        ? {
            subscriptions: subscription
              ? [{ url: subscription.url, update_types: subscription.updates }]
              : [],
          }
        : {
            url: subscription?.url ?? '',
            allowed_updates: subscription?.updates ?? [],
            pending_update_count: 0,
          },
    );
  }
  if (method === 'messages' || method === 'sendMessage') {
    const subject =
      provider === 'max' ? url.searchParams.get('user_id') : String(body?.['chat_id']);
    const recipient = `${provider}:${subject}`;
    if (recipientFailures.has(recipient)) {
      recipientFailures.set(recipient, recipientFailures.get(recipient)! + 1);
      return new Response(
        JSON.stringify(
          provider === 'telegram'
            ? { ok: false, error_code: 403, description: 'Synthetic recipient blocked the bot' }
            : { code: 'forbidden', message: 'Synthetic recipient unavailable' },
        ),
        {
          status: 403,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    const attachments = body?.['attachments'] as
      Array<{ payload?: { buttons?: Array<Array<{ payload?: string }>> } }> | undefined;
    const markup = body?.['reply_markup'] as
      { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined;
    const payload =
      provider === 'max'
        ? attachments?.[0]?.payload?.buttons?.[0]?.[0]?.payload
        : markup?.inline_keyboard?.[0]?.[0]?.callback_data;
    if (payload && subject) confirmationButtons.set(`${provider}:${subject}`, payload);
    return answer(provider === 'max' ? { success: true } : { message_id: ++updateSequence });
  }
  if (method === 'answers' || method === 'answerCallbackQuery') {
    return answer(provider === 'max' ? { success: true } : true);
  }
  unexpectedFetches.push(`${provider}:${method}`);
  throw new Error('Unexpected provider method in synthetic HTTP test');
};

async function visit(
  browser: BrowserCookies,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: Record<string, unknown>,
) {
  const response = await inject(app, {
    method,
    url,
    headers: { cookie: browser.header(), 'user-agent': 'Synthetic provider HTTP test' },
    ...(payload ? { payload } : {}),
  });
  browser.accept(response);
  return response;
}

async function setProviderEnabled(provider: Provider, enabled: boolean): Promise<void> {
  const configured = await visit(
    administrator.browser,
    'PUT',
    `/api/admin/v1/integrations/${provider}`,
    {
      enabled,
      botUsername: providerBot[provider].username,
      miniAppUrl: `https://asa-http.test/${provider}-login`,
    },
  );
  expect(configured.statusCode, configured.body).toBe(200);
  expect(configured.json()).toMatchObject({
    featureEnabled: enabled,
    available: enabled,
    availabilityReason: enabled ? 'ready' : 'disabled',
    tokenConfigured: true,
  });
}

async function setPolicyEnabled(enabled: boolean): Promise<void> {
  const response = await visit(
    administrator.browser,
    'POST',
    '/api/admin/v1/auth/verification-policy',
    { enabled },
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().enabled).toBe(enabled);
}

async function account() {
  const unique = randomUUID().replaceAll('-', '');
  const browser = new BrowserCookies();
  const email = `${unique}@provider-http.test`;
  const password = `Safe-${unique}-Password`;
  const response = await visit(browser, 'POST', '/api/auth/register', {
    email,
    password,
    username: `h${unique.slice(0, 24)}`,
    displayName: 'Synthetic HTTP Account',
    birthDate: '1990-04-12',
    country: 'RU',
  });
  expect(response.statusCode, response.body).toBe(201);
  expect(browser.value('asa_session')).toBeTruthy();
  return { id: response.json().account.id as string, email, password, browser };
}

async function makeOverdue(user: Awaited<ReturnType<typeof account>>): Promise<void> {
  await admin.query(
    "UPDATE accounts SET first_authenticated_at=now()-interval '48 hours' WHERE id=$1",
    [user.id],
  );
  const status = await visit(user.browser, 'GET', '/api/auth/verification');
  expect(status.statusCode, status.body).toBe(200);
  expect(status.json()).toMatchObject({ required: true, reason: 'verification_required' });
}

async function linkedAccounts(provider: Provider, subject: string): Promise<string[]> {
  const result = await admin.query<{ account_id: string }>(
    'SELECT account_id FROM account_external_identities WHERE provider=$1 AND subject=$2 AND revoked_at IS NULL',
    [provider, subject],
  );
  return result.rows.map((row) => row.account_id);
}

async function sessionCount(accountId: string): Promise<number> {
  const result = await admin.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM sessions_v2 WHERE principal_id=(SELECT id FROM principals WHERE account_id=$1)',
    [accountId],
  );
  return result.rows[0]!.count;
}

function webhookUpdate(
  provider: Provider,
  subject: string,
  action: 'start' | 'approve',
  payload: string,
) {
  const human = {
    id: Number(subject),
    user_id: Number(subject),
    username: 'synthetic_person',
    first_name: 'Synthetic',
    last_name: 'Person',
    is_bot: false,
  };
  const bot = { id: providerBot[provider].id, user_id: providerBot[provider].id, is_bot: true };
  if (provider === 'max') {
    return action === 'start'
      ? { update_type: 'bot_started', timestamp: Date.now(), user: human, payload }
      : {
          update_type: 'message_callback',
          timestamp: Date.now(),
          callback: { callback_id: randomUUID(), user: human, payload },
          message: { sender: bot },
        };
  }
  return action === 'start'
    ? {
        update_id: ++updateSequence,
        message: {
          message_id: ++updateSequence,
          from: human,
          chat: { id: Number(subject), type: 'private' },
          text: `/start ${payload}`,
        },
      }
    : {
        update_id: ++updateSequence,
        callback_query: {
          id: randomUUID(),
          from: human,
          data: payload,
          message: { message_id: ++updateSequence, from: bot },
        },
      };
}

async function webhook(provider: Provider, body: Record<string, unknown>, secret?: string) {
  const subscription = subscriptions.get(provider);
  expect(subscription).toBeDefined();
  const header = provider === 'max' ? 'x-max-bot-api-secret' : 'x-telegram-bot-api-secret-token';
  // Real provider deliveries carry the configured secret and no browser Origin.
  return fastifyOf(app).inject({
    method: 'POST',
    url: `/api/auth/${provider}/webhook`,
    headers: { [header]: secret ?? subscription!.secret },
    payload: body,
  });
}

async function startLink(provider: Provider, user: Awaited<ReturnType<typeof account>>) {
  const started = await visit(user.browser, 'POST', `/api/auth/${provider}/pairing/start`, {
    purpose: 'link',
  });
  expect(started.statusCode, started.body).toBe(200);
  const { pairingToken, launchUrl, expiresAt } = started.json();
  expect(started.json()).not.toHaveProperty('browserNonce');
  expect(pairingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  const nonce = started.cookies.find((cookie) =>
    cookie.name.startsWith(`asa_pairing_${provider}_`),
  );
  expect(nonce).toBeDefined();
  const setCookie = started.headers['set-cookie'];
  const serialized = (Array.isArray(setCookie) ? setCookie : [setCookie]).find((header) =>
    header?.startsWith(`${nonce!.name}=`),
  );
  expect(serialized).toMatch(/;\s*HttpOnly\b/i);
  expect(serialized).toMatch(/;\s*SameSite=Lax\b/i);
  expect(serialized).toMatch(/;\s*Path=\/api\/auth(?:;|$)/i);
  expect(JSON.stringify(started.json())).not.toContain(nonce!.value);
  const link = new URL(launchUrl);
  expect(link.protocol).toBe('https:');
  expect(link.hostname).toBe(provider === 'max' ? 'max.ru' : 't.me');
  expect(link.searchParams.get('start')).toBe(`pair_${pairingToken}`);
  return {
    pairingToken: pairingToken as string,
    nonceName: nonce!.name,
    nonceValue: nonce!.value,
    botPayload: link.searchParams.get('start')!,
  };
}

beforeAll(async () => {
  if (!/^asa_provider_http_[a-f0-9]{32}_test$/.test(databaseName) || databaseName.length > 63)
    throw new Error('Unsafe generated test database name');
  const adminUrl = new URL(process.env['TEST_DATABASE_URL']!);
  const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (!adminUrl.pathname.endsWith('_test') || runtimeUrl.pathname !== adminUrl.pathname)
    throw new Error('Matching disposable admin/runtime test databases required');
  databaseOwner = testAdminPool();
  await databaseOwner.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  adminUrl.pathname = runtimeUrl.pathname = '/' + databaseName;
  admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 3 });
  const migrationClient = await admin.connect();
  try {
    await applyPlan(migrationClient, planMigrations());
  } finally {
    migrationClient.release();
  }
  runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 3 });
  vi.stubEnv('ASA_SETTINGS_ENCRYPTION_KEY', Buffer.alloc(32, 19).toString('base64url'));
  vi.stubGlobal('fetch', syntheticProviderFetch);
  app = await buildTestApp(runtime);
  administrator = await account();
  await admin.query(
    "INSERT INTO capability_grants (account_id,capability,state,policy_version,granted_by) VALUES ($1,'platform_admin','verified','provider-http-test','admin')",
    [administrator.id],
  );
  for (const provider of PROVIDERS) {
    const configured = await visit(
      administrator.browser,
      'PUT',
      `/api/admin/v1/integrations/${provider}`,
      {
        enabled: true,
        botUsername: providerBot[provider].username,
        miniAppUrl: `https://asa-http.test/${provider}-login`,
        botToken: providerBot[provider].token,
      },
    );
    expect(configured.statusCode, configured.body).toBe(200);
    expect(configured.json()).toMatchObject({
      featureEnabled: true,
      available: true,
      availabilityReason: 'ready',
      tokenConfigured: true,
    });
    expect(configured.body).not.toContain(providerBot[provider].token);
    expect(subscriptions.get(provider)?.secret).toBeTruthy();
  }
  await admin.query(
    "UPDATE account_verification_policy SET activated_at=now()-interval '48 hours' WHERE singleton_key",
  );
  const enabled = await visit(
    administrator.browser,
    'POST',
    '/api/admin/v1/auth/verification-policy',
    { enabled: true },
  );
  expect(enabled.statusCode, enabled.body).toBe(200);
}, 120_000);

afterAll(async () => {
  try {
    if (app) await app.close();
    else await runtime?.end();
    await admin?.end();
    if (databaseCreated) await databaseOwner.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await databaseOwner?.end();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(unexpectedFetches).toEqual([]);
});

describe('native provider confirmation through real HTTP and PostgreSQL boundaries', () => {
  it.each(PROVIDERS)(
    '%s links the same restricted Account only after explicit bot approval and the initiating browser nonce',
    async (provider) => {
      const user = await account();
      await makeOverdue(user);
      const originalSession = user.browser.value('asa_session');
      const originalSessionCount = await sessionCount(user.id);
      const subject = String(Number.parseInt(randomBytes(6).toString('hex'), 16));
      const pair = await startLink(provider, user);
      const pending = await visit(user.browser, 'POST', `/api/auth/${provider}/pairing/complete`, {
        pairingToken: pair.pairingToken,
      });
      expect(pending.statusCode, pending.body).toBe(200);
      expect(pending.json()).toEqual({ status: 'pending' });

      const rejectedWebhook = await webhook(
        provider,
        webhookUpdate(provider, subject, 'approve', `approve:${pair.botPayload}`),
        'incorrect-synthetic-webhook-secret',
      );
      expect(rejectedWebhook.statusCode, rejectedWebhook.body).toBe(401);
      expect(await linkedAccounts(provider, subject)).toEqual([]);

      const started = await webhook(
        provider,
        webhookUpdate(provider, subject, 'start', pair.botPayload),
      );
      expect(started.statusCode, started.body).toBe(200);
      expect(await linkedAccounts(provider, subject)).toEqual([]);
      const confirmation = confirmationButtons.get(`${provider}:${subject}`);
      expect(confirmation).toBe(`approve:${pair.botPayload}`);
      const approved = await webhook(
        provider,
        webhookUpdate(provider, subject, 'approve', confirmation!),
      );
      expect(approved.statusCode, approved.body).toBe(200);
      // A webhook cannot attach the proof or create a session on its own.
      expect(await linkedAccounts(provider, subject)).toEqual([]);
      expect(await sessionCount(user.id)).toBe(originalSessionCount);
      expect((await visit(user.browser, 'GET', '/api/account/profile')).statusCode).toBe(403);

      const missingNonce = await inject(app, {
        method: 'POST',
        url: `/api/auth/${provider}/pairing/complete`,
        headers: { cookie: `asa_session=${originalSession}` },
        payload: { pairingToken: pair.pairingToken },
      });
      expect(missingNonce.statusCode, missingNonce.body).toBe(400);
      expect(await linkedAccounts(provider, subject)).toEqual([]);
      const forgedNonce = await inject(app, {
        method: 'POST',
        url: `/api/auth/${provider}/pairing/complete`,
        headers: {
          cookie: `asa_session=${originalSession}; ${pair.nonceName}=${randomBytes(32).toString('base64url')}`,
        },
        payload: { pairingToken: pair.pairingToken },
      });
      expect(forgedNonce.statusCode, forgedNonce.body).toBe(400);
      expect(await linkedAccounts(provider, subject)).toEqual([]);

      const completed = await visit(
        user.browser,
        'POST',
        `/api/auth/${provider}/pairing/complete`,
        { pairingToken: pair.pairingToken },
      );
      expect(completed.statusCode, completed.body).toBe(200);
      expect(completed.json()).toEqual({ status: 'linked', linked: true });
      expect(completed.cookies.some((cookie) => cookie.name === 'asa_session')).toBe(false);
      expect(user.browser.value('asa_session')).toBe(originalSession);
      expect(user.browser.value(pair.nonceName)).toBeUndefined();
      expect(await linkedAccounts(provider, subject)).toEqual([user.id]);
      expect(await sessionCount(user.id)).toBe(originalSessionCount);
      const current = await visit(user.browser, 'GET', '/api/auth/me');
      expect(current.json()).toMatchObject({
        account: { id: user.id },
        verification: { required: false, reason: 'verified', verifiedProvider: provider },
      });
      expect((await visit(user.browser, 'GET', '/api/account/profile')).statusCode).toBe(200);
      const email = await admin.query('SELECT email_verification_state FROM accounts WHERE id=$1', [
        user.id,
      ]);
      expect(email.rows[0].email_verification_state).toBe('unverified');
      expect(unexpectedFetches).toEqual([]);
    },
  );

  it.each(PROVIDERS)(
    '%s cannot attach an approved proof after the browser logs out and signs in as another Account',
    async (provider) => {
      const original = await account();
      const other = await account();
      await makeOverdue(original);
      const subject = String(Number.parseInt(randomBytes(6).toString('hex'), 16));
      const pair = await startLink(provider, original);
      const started = await webhook(
        provider,
        webhookUpdate(provider, subject, 'start', pair.botPayload),
      );
      expect(started.statusCode, started.body).toBe(200);
      const confirmation = confirmationButtons.get(`${provider}:${subject}`);
      expect(confirmation).toBe(`approve:${pair.botPayload}`);
      const approved = await webhook(
        provider,
        webhookUpdate(provider, subject, 'approve', confirmation!),
      );
      expect(approved.statusCode, approved.body).toBe(200);
      const beforeOriginal = await sessionCount(original.id);
      const beforeOther = await sessionCount(other.id);
      const loggedOut = await visit(original.browser, 'POST', '/api/auth/logout');
      expect(loggedOut.statusCode, loggedOut.body).toBe(200);
      expect(original.browser.value('asa_session')).toBeUndefined();
      // This browser still has the genuine challenge cookie from the first Account.
      expect(original.browser.value(pair.nonceName)).toBe(pair.nonceValue);
      const entered = await visit(original.browser, 'POST', '/api/auth/login', {
        identifier: other.email,
        password: other.password,
      });
      expect(entered.statusCode, entered.body).toBe(200);
      expect(entered.json().account.id).toBe(other.id);
      const completed = await visit(
        original.browser,
        'POST',
        `/api/auth/${provider}/pairing/complete`,
        { pairingToken: pair.pairingToken },
      );
      expect(completed.statusCode, completed.body).toBe(400);
      expect(completed.json().error.code).toBe(`${provider}_pairing_invalid`);
      expect(completed.cookies.some((cookie) => cookie.name === 'asa_session')).toBe(false);
      expect(await linkedAccounts(provider, subject)).toEqual([]);
      expect(await sessionCount(original.id)).toBe(beforeOriginal);
      expect(await sessionCount(other.id)).toBe(beforeOther + 1);
      const current = await visit(original.browser, 'GET', '/api/auth/me');
      expect(current.json().account.id).toBe(other.id);
      const recorded = await admin.query<{
        requested_account_id: string;
        consumed_at: Date | null;
      }>(
        'SELECT requested_account_id, consumed_at FROM auth_provider_pairings WHERE provider=$1 AND token_hash=$2',
        [provider, hashSessionToken(pair.pairingToken)],
      );
      expect(recorded.rows[0]).toMatchObject({
        requested_account_id: original.id,
        consumed_at: null,
      });
      expect(unexpectedFetches).toEqual([]);
    },
  );

  it.each(PROVIDERS)(
    '%s keeps confirmation required for other Accounts after a recipient-specific delivery rejection',
    async (provider) => {
      const otherProvider = provider === 'max' ? 'telegram' : 'max';
      const subject = String(Number.parseInt(randomBytes(6).toString('hex'), 16));
      const recipient = `${provider}:${subject}`;
      // With the other channel disabled, a false global outage would actually
      // remove the verification gate. Independent health probes stay healthy.
      await setProviderEnabled(otherProvider, false);
      try {
        const requester = await account();
        const unrelated = await account();
        await makeOverdue(requester);
        await makeOverdue(unrelated);
        const pair = await startLink(provider, requester);
        recipientFailures.set(recipient, 0);
        const delivered = await webhook(
          provider,
          webhookUpdate(provider, subject, 'start', pair.botPayload),
        );
        expect(delivered.statusCode, delivered.body).toBe(200);
        expect(recipientFailures.get(recipient)).toBe(1);
        expect(await linkedAccounts(provider, subject)).toEqual([]);

        const publicProviders = await inject(app, { method: 'GET', url: '/api/auth/providers' });
        expect(publicProviders.statusCode, publicProviders.body).toBe(200);
        expect(publicProviders.json().providers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: provider, available: true, reason: 'ready' }),
            expect.objectContaining({ id: otherProvider, available: false, reason: 'disabled' }),
            expect.objectContaining({ id: 'email', available: false }),
          ]),
        );
        const status = await visit(unrelated.browser, 'GET', '/api/auth/verification');
        expect(status.statusCode, status.body).toBe(200);
        expect(status.json()).toMatchObject({ required: true, reason: 'verification_required' });
        const protectedRead = await visit(unrelated.browser, 'GET', '/api/account/profile');
        expect(protectedRead.statusCode, protectedRead.body).toBe(403);
        expect(protectedRead.json().error.code).toBe('account_verification_required');
        expect(unexpectedFetches).toEqual([]);
      } finally {
        recipientFailures.delete(recipient);
        await setProviderEnabled(otherProvider, true);
      }
    },
  );

  it.each(PROVIDERS)(
    '%s refuses direct unlink with the policy off when a previously healthy alternative token cannot be decrypted',
    async (provider) => {
      const otherProvider = provider === 'max' ? 'telegram' : 'max';
      let originalTag: string | undefined;
      await setPolicyEnabled(false);
      try {
        const user = await account();
        const subjects = new Map<Provider, string>();
        for (const linkedProvider of PROVIDERS) {
          const subject = String(Number.parseInt(randomBytes(6).toString('hex'), 16));
          const pair = await startLink(linkedProvider, user);
          const started = await webhook(
            linkedProvider,
            webhookUpdate(linkedProvider, subject, 'start', pair.botPayload),
          );
          expect(started.statusCode, started.body).toBe(200);
          const confirmation = confirmationButtons.get(`${linkedProvider}:${subject}`);
          expect(confirmation).toBe(`approve:${pair.botPayload}`);
          const approved = await webhook(
            linkedProvider,
            webhookUpdate(linkedProvider, subject, 'approve', confirmation!),
          );
          expect(approved.statusCode, approved.body).toBe(200);
          const completed = await visit(
            user.browser,
            'POST',
            `/api/auth/${linkedProvider}/pairing/complete`,
            { pairingToken: pair.pairingToken },
          );
          expect(completed.statusCode, completed.body).toBe(200);
          expect(completed.json()).toEqual({ status: 'linked', linked: true });
          expect(await linkedAccounts(linkedProvider, subject)).toEqual([user.id]);
          subjects.set(linkedProvider, subject);
        }
        // Legacy social Accounts can have a stored password hash while no usable
        // password was configured. This fixture changes only that legacy marker.
        await admin.query('UPDATE accounts SET password_configured=false WHERE id=$1', [user.id]);
        const originalSessions = await sessionCount(user.id);
        const current = await visit(user.browser, 'GET', '/api/auth/me');
        expect(current.json()).toMatchObject({
          account: { id: user.id },
          verification: { policyEnabled: false, required: false, reason: 'disabled' },
        });
        const before = await visit(user.browser, 'GET', `/api/auth/${provider}/status`);
        expect(before.statusCode, before.body).toBe(200);
        expect(before.json()).toMatchObject({ linked: true, canUnlink: true });
        const saved = await admin.query<{
          enabled: boolean;
          configuration_version: string;
          health_available: boolean;
          token_auth_tag: string;
        }>(
          'SELECT enabled,configuration_version,health_available,token_auth_tag FROM auth_provider_settings WHERE provider=$1',
          [otherProvider],
        );
        const settings = saved.rows[0]!;
        expect(settings).toMatchObject({ enabled: true, health_available: true });
        originalTag = settings.token_auth_tag;
        const corrupted = Buffer.from(originalTag, 'base64url');
        corrupted[0] = corrupted[0]! ^ 1;
        const broken = await admin.query(
          'UPDATE auth_provider_settings SET token_auth_tag=$2 WHERE provider=$1 RETURNING enabled,configuration_version,health_available',
          [otherProvider, corrupted.toString('base64url')],
        );
        expect(broken.rows[0]).toEqual({
          enabled: true,
          configuration_version: settings.configuration_version,
          health_available: true,
        });
        // No provider/status/policy request is made between corruption and unlink.
        // The destructive operation must independently invalidate stale health.
        const unlinked = await visit(user.browser, 'POST', `/api/auth/${provider}/unlink`);
        expect(unlinked.statusCode, unlinked.body).toBe(409);
        expect(unlinked.json().error.code).toBe('last_sign_in_method');
        expect(await linkedAccounts(provider, subjects.get(provider)!)).toEqual([user.id]);
        expect(await linkedAccounts(otherProvider, subjects.get(otherProvider)!)).toEqual([
          user.id,
        ]);
        expect(await sessionCount(user.id)).toBe(originalSessions);
        const projection = await admin.query(
          'SELECT enabled,configuration_version,health_available,health_reason FROM auth_provider_settings WHERE provider=$1',
          [otherProvider],
        );
        expect(projection.rows[0]).toEqual({
          enabled: true,
          configuration_version: settings.configuration_version,
          health_available: false,
          health_reason: 'not_configured',
        });
        const status = await visit(user.browser, 'GET', `/api/auth/${provider}/status`);
        expect(status.statusCode, status.body).toBe(200);
        expect(status.json()).toMatchObject({ linked: true, canUnlink: false });
        expect(unexpectedFetches).toEqual([]);
      } finally {
        if (originalTag)
          await admin.query(
            'UPDATE auth_provider_settings SET token_auth_tag=$2 WHERE provider=$1',
            [otherProvider, originalTag],
          );
        await setProviderEnabled(otherProvider, true);
        await setPolicyEnabled(true);
      }
    },
  );
});
