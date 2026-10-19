import { expect, test, type Page } from '@playwright/test';
import type {
  AccountVerificationState,
  AuthProviderAvailability,
  LearningNotificationPreferences,
  SocialAuthProvider,
} from '../apps/web/src/api';
import { telemetryReceipt } from './fixtures/telemetry-receipts';

// Browser/layout contracts only. Every API response below is synthetic, and
// messenger popups are blocked from making external requests.
const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const METHODS: readonly SocialAuthProvider[] = ['max', 'telegram'];
type PairingOutcome =
  | 'pending'
  | 'linked'
  | 'registration_required'
  | 'authenticated'
  | 'identity_revoked'
  | 'unavailable';

function healthyProviders(): AuthProviderAvailability[] {
  return [
    {
      id: 'max',
      available: true,
      reason: 'ready',
      enforcementEligible: true,
      enforcementReason: 'ready',
      checkedAt: '2026-10-18T09:00:00Z',
    },
    {
      id: 'telegram',
      available: true,
      reason: 'ready',
      enforcementEligible: true,
      enforcementReason: 'ready',
      checkedAt: '2026-10-18T09:00:00Z',
    },
    { id: 'email', available: false, reason: 'not_configured', checkedAt: null },
  ];
}

interface UiState {
  signedIn: boolean;
  admin: boolean;
  policyEnabled: boolean;
  overdue: boolean;
  verifiedProvider: SocialAuthProvider | null;
  providers: AuthProviderAvailability[];
  providersFailure: boolean;
  verificationFailure: boolean;
  policySaveFailure: boolean;
  adminReadFailure: boolean;
  emptyProviderUrl: boolean;
  pairingExpiresAt: string | null;
  nextPairing: PairingOutcome;
  passwordConfigured: boolean;
  linked: Record<SocialAuthProvider, boolean>;
  canUnlink: Record<SocialAuthProvider, boolean>;
  requests: { path: string; method: string; body: unknown }[];
}

async function fixture(
  page: Page,
  options: Partial<Omit<UiState, 'requests'>> = {},
): Promise<UiState> {
  const state: UiState = {
    signedIn: false,
    admin: false,
    policyEnabled: false,
    overdue: false,
    verifiedProvider: null,
    providers: healthyProviders(),
    providersFailure: false,
    verificationFailure: false,
    policySaveFailure: false,
    adminReadFailure: false,
    emptyProviderUrl: false,
    pairingExpiresAt: null,
    nextPairing: 'pending',
    passwordConfigured: true,
    linked: { max: false, telegram: false },
    canUnlink: { max: true, telegram: true },
    ...options,
    requests: [],
  };
  let profile = {
    email: 'long.account.name.for.layout.review@example.test',
    emailVerificationState: 'unverified',
    username: 'auth-review-account',
    displayName: 'Александра Константинопольская — проверка длинного имени аккаунта',
    bio: '',
    birthDate: '1988-03-01',
    country: 'RU',
  };
  const providerSettings = {
    max: {
      featureEnabled: true,
      botUsername: 'asa_fixture_max_bot',
      miniAppUrl: 'https://asa.example.test/max-login',
      configurationVersion: 1,
    },
    telegram: {
      featureEnabled: true,
      botUsername: 'asa_fixture_telegram_bot',
      miniAppUrl: state.emptyProviderUrl ? '' : 'https://asa.example.test/',
      configurationVersion: 1,
    },
  };
  const pairings = new Map<string, { provider: SocialAuthProvider; purpose: string }>();
  // Account settings keeps its notification editor mounted across sections.
  // Even the security journey needs the complete public preferences contract.
  const notificationPreferences: LearningNotificationPreferences = {
    revision: 0,
    masterEnabled: true,
    categories: {
      NC01: true,
      NC02: true,
      NC03: true,
      NC04: true,
      NC05: true,
      NC06: true,
      NC08: true,
    },
    classOverrides: {},
    classes: [],
  };
  const workspaces = [
    { workspaceId: WORKSPACE_ID, kind: 'personal', title: 'Личное пространство', role: 'owner' },
  ];
  const capabilities = () => [
    { capability: 'creator', state: 'verified' },
    ...(state.admin ? [{ capability: 'platform_admin', state: 'verified' }] : []),
  ];
  const verification = (): AccountVerificationState => {
    const healthy = state.providers.some((provider) => provider.available);
    const eligible = state.providers.some(
      (provider) => provider.available && provider.enforcementEligible === true,
    );
    return {
      policyEnabled: state.policyEnabled,
      required: state.policyEnabled && state.overdue && !state.verifiedProvider && eligible,
      reason: !state.policyEnabled
        ? 'disabled'
        : state.verifiedProvider
          ? 'verified'
          : !state.overdue
            ? 'grace_period'
            : !healthy
              ? 'providers_unavailable'
              : !eligible
                ? 'providers_unverified'
                : 'verification_required',
      dueAt: state.overdue ? '2026-10-17T09:00:00Z' : '2030-01-01T00:00:00Z',
      verifiedProvider: state.verifiedProvider,
      providers: state.providers,
    };
  };
  const session = () => ({
    authenticated: true,
    user: { id: ACCOUNT_ID, email: profile.email, displayName: profile.displayName },
    account: { id: ACCOUNT_ID, email: profile.email, displayName: profile.displayName },
    capabilities: verification().required ? [] : capabilities(),
    actions: [],
    workspaces,
    activeWorkspace: { workspaceId: WORKSPACE_ID, kind: 'personal' },
    navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
    timeZone: 'Europe/Moscow',
    verification: verification(),
  });
  const scope = {
    kind: 'platform',
    id: null,
    title: 'ASA Lab',
    role: 'platform_admin',
    permissions: ['administration.open', 'administration.operations.read'],
  };
  const providerConfig = (provider: SocialAuthProvider) => {
    const health = state.providers.find((entry) => entry.id === provider);
    const nativeCurrent = health?.enforcementEligible === true;
    const available = health?.available === true;
    const verifiedAt = '2026-10-18T09:00:00Z';
    const checked = { state: 'ok', reason: null, checkedAt: verifiedAt };
    return {
      ...providerSettings[provider],
      miniAppUrl: providerSettings[provider].miniAppUrl || null,
      enabled: available,
      available,
      enforcementEligible: available && nativeCurrent,
      enforcementReason: available && !nativeCurrent ? 'delivery_unverified' : health?.reason,
      diagnostics: {
        token:
          health?.reason === 'invalid_token'
            ? { state: 'failed', reason: 'invalid_token', checkedAt: verifiedAt }
            : checked,
        subscription: available ? checked : { state: 'not_checked', reason: null, checkedAt: null },
        ingress: available ? checked : { state: 'not_checked', reason: null, checkedAt: null },
        nativeConfirmation: {
          current: nativeCurrent,
          configurationVersion: nativeCurrent
            ? providerSettings[provider].configurationVersion
            : null,
          verifiedAt: nativeCurrent ? verifiedAt : null,
        },
      },
      availabilityReason: health?.reason ?? 'unavailable',
      healthCheckedAt: health?.checkedAt ?? null,
      tokenConfigured: true,
      encryptionReady: true,
      tokenFingerprint: null,
      verifiedBotId: 'synthetic-bot',
      verifiedBotName: provider,
      tokenVerifiedAt: '2026-10-18T09:00:00Z',
      updatedAt: '2026-10-18T09:00:00Z',
      launchUrl:
        provider === 'max'
          ? 'https://max.ru/asa_fixture_max_bot'
          : 'https://t.me/asa_fixture_telegram_bot',
      webhookUrl: providerSettings[provider].miniAppUrl
        ? `${new URL(providerSettings[provider].miniAppUrl).origin}/api/auth/${provider}/webhook`
        : null,
      webhookVerifiedAt: '2026-10-18T09:00:00Z',
      webhookLastError:
        health?.reason === 'delivery_unavailable' ? 'synthetic delivery failure' : null,
    };
  };

  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    // An API request must never fall through to the static server, including
    // unload/keepalive requests after the initiating page has been closed.
    return url.origin === 'http://127.0.0.1:4612' && !url.pathname.startsWith('/api/')
      ? route.fallback()
      : route.abort();
  });
  await page.context().route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4612') return route.abort();
    const path = url.pathname;
    const method = request.method();
    const body = (request.postData() ? request.postDataJSON() : {}) as Record<string, unknown>;
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    const error = (code: string, message: string, status: number) =>
      reply({ error: { code, message } }, status);
    const receipt = telemetryReceipt(request);
    if (receipt) return route.fulfill(receipt);
    state.requests.push({ path, method, body });
    if (path === '/api/diagnostics/client' && method === 'POST') {
      return reply({ accepted: true }, 202);
    }
    if (path === '/api/auth/me')
      return reply(state.signedIn ? session() : { authenticated: false });
    if (path === '/api/class-join/me') return reply({ authenticated: false });
    if (path === '/api/auth/local-preview/config') return reply({ enabled: false });
    if (path === '/api/auth/max/config') return reply({ enabled: false, launchUrl: null });
    if (path === '/api/auth/providers')
      return state.providersFailure
        ? error('unavailable', 'Сервер недоступен', 503)
        : reply({ providers: state.providers });
    if (path === '/api/auth/verification')
      return state.verificationFailure
        ? error('unavailable', 'Сервер недоступен', 503)
        : reply(verification());
    if (path === '/api/auth/bot-challenge')
      return reply({
        required: false,
        challenge: {
          action: new URL(request.url()).searchParams.get('action'),
          nonce: 'synthetic-nonce',
          salt: 'synthetic-salt',
          difficulty: 0,
          issuedAt: Date.now(),
          expiresAt: Date.now() + 300_000,
          signature: 'synthetic-signature',
        },
      });
    if (path === '/api/auth/login') {
      state.signedIn = true;
      return reply(session());
    }
    if (path === '/api/auth/logout') {
      state.signedIn = false;
      return reply({ ok: true });
    }
    if (path === '/api/admin/v1/me')
      return state.admin
        ? reply({
            administrator: true,
            principalId: 'fixture-admin',
            accountId: ACCOUNT_ID,
            displayName: profile.displayName,
            activeWorkspaceId: WORKSPACE_ID,
            scopes: [scope],
          })
        : error('forbidden', 'Недостаточно прав', 403);
    if (path === '/api/admin/v1/scopes') return reply({ scopes: [scope] });
    if (path === '/api/admin/v1/dashboard')
      return error('account_verification_required', 'Подтвердите аккаунт', 403);
    if (path === '/api/admin/v1/auth/verification-policy') {
      if (method === 'GET' && state.adminReadFailure)
        return error('unavailable', 'Статус пока недоступен', 503);
      if (method === 'POST') {
        if (state.policySaveFailure)
          return error('unavailable', 'Не удалось сохранить правило. Повторите попытку.', 503);
        state.policyEnabled = body.enabled === true;
      }
      return reply({
        enabled: state.policyEnabled,
        activatedAt: state.policyEnabled ? '2026-10-16T09:00:00Z' : null,
        graceHours: 24,
      });
    }
    for (const provider of METHODS) {
      if (path === `/api/admin/v1/integrations/${provider}/check` && method === 'POST')
        return reply(providerConfig(provider));
      if (path === `/api/admin/v1/integrations/${provider}`) {
        if (method === 'GET' && state.adminReadFailure)
          return error('unavailable', 'Статус пока недоступен', 503);
        if (method === 'PUT') {
          providerSettings[provider] = {
            featureEnabled: body.enabled === true,
            botUsername: String(body.botUsername),
            miniAppUrl: String(body.miniAppUrl),
            configurationVersion: providerSettings[provider].configurationVersion + 1,
          };
          state.providers = state.providers.map((entry) =>
            entry.id !== provider
              ? entry
              : {
                  ...entry,
                  available: body.enabled === true && body.botToken !== 'fixture-invalid-token',
                  enforcementEligible: false,
                  enforcementReason: 'delivery_unverified',
                  reason:
                    body.enabled !== true
                      ? 'disabled'
                      : body.botToken === 'fixture-invalid-token'
                        ? 'invalid_token'
                        : 'ready',
                },
          );
        }
        return reply(providerConfig(provider));
      }
      if (path === `/api/auth/${provider}/status`)
        return reply({
          linked: state.linked[provider],
          verifiedAt: state.linked[provider] ? '2026-10-18T09:00:00Z' : null,
          firstAuthenticatedAt: '2026-10-16T09:00:00Z',
          promptDue: false,
          promptDismissedUntil: null,
          available: state.providers.some((entry) => entry.id === provider && entry.available),
          canUnlink: state.canUnlink[provider],
        });
      if (path === `/api/auth/${provider}/pairing/start`) {
        const pairingToken = `synthetic-${provider}-${pairings.size}`;
        pairings.set(pairingToken, { provider, purpose: String(body.purpose) });
        return reply({
          pairingToken,
          launchUrl: `https://${provider === 'max' ? 'max.ru' : 't.me'}/asa_fixture_bot?start=${pairingToken}`,
          expiresAt: state.pairingExpiresAt ?? new Date(Date.now() + 600_000).toISOString(),
        });
      }
      if (path === `/api/auth/${provider}/pairing/complete`) {
        const pairing = pairings.get(String(body.pairingToken));
        if (!pairing) return error('invalid', 'Не найден запрос подтверждения', 400);
        if (state.nextPairing === 'identity_revoked')
          return error('identity_revoked', 'Эта привязка отозвана', 409);
        if (state.nextPairing === 'unavailable') {
          state.providers = state.providers.map((entry) =>
            entry.id === provider
              ? { ...entry, available: false, reason: 'delivery_unavailable' }
              : entry,
          );
          return error('provider_unavailable', 'Бот недоступен', 503);
        }
        if (state.nextPairing === 'registration_required')
          return reply({
            status: 'registration_required',
            profile: { username: null, displayName: 'Новый участник' },
          });
        if (state.nextPairing === 'linked') {
          expect(pairing.purpose).toBe('link');
          state.linked[provider] = true;
          state.verifiedProvider = provider;
          state.providers = state.providers.map((entry) =>
            entry.id === provider
              ? { ...entry, enforcementEligible: true, enforcementReason: 'ready' }
              : entry,
          );
          return reply({ status: 'linked', linked: true });
        }
        if (state.nextPairing === 'authenticated') {
          state.signedIn = true;
          state.verifiedProvider = provider;
          return reply({ status: 'authenticated', session: session() });
        }
        return reply({ status: 'pending' });
      }
      if (path === `/api/auth/${provider}/pairing/register`) {
        expect(pairings.has(String(body.pairingToken))).toBe(true);
        profile = {
          ...profile,
          email: String(body.email),
          username: String(body.username),
          displayName: String(body.displayName),
          birthDate: String(body.birthDate),
          country: String(body.country),
        };
        state.signedIn = true;
        state.verifiedProvider = provider;
        state.linked[provider] = true;
        return reply(session(), 201);
      }
      if (path === `/api/auth/${provider}/unlink`) {
        if (!state.canUnlink[provider])
          return error('last_sign_in_method', 'Сначала настройте пароль', 409);
        state.linked[provider] = false;
        return reply({ unlinked: true });
      }
    }
    if (path === '/api/account/profile')
      return reply({ ...profile, capabilities: capabilities(), workspaces });
    if (path === '/api/account/avatar') return reply({ avatarDataUrl: null });
    if (path === '/api/account/sessions') return reply({ items: [] });
    if (path === '/api/account/password')
      return reply({ configured: state.passwordConfigured, canResetWithoutCurrent: false });
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/classrooms/awaiting-review') return reply({ total: 0 });
    if (path === '/api/learning/notifications')
      return reply({ items: [], snapshot: '2026-10-18T09:00:00Z', unread: 0 });
    if (path === '/api/learning/notifications/preferences' && method === 'GET') {
      return reply(notificationPreferences);
    }
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    return error('unexpected_mutation', path, 400);
  });
  return state;
}

let navigationSequence = 0;
async function visit(page: Page, route: string): Promise<void> {
  // A new document reads the fixture's current authenticated actor explicitly.
  await page.goto(`/?auth-ui=${++navigationSequence}#${route}`);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
  await page.screenshot({ path: test.info().outputPath(`${name}-viewport.png`) });
}

async function enlargeText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('body *')).map(
      (node) => [node, parseFloat(getComputedStyle(node).fontSize) * 1.5] as const,
    );
    for (const [node, size] of sizes) node.style.fontSize = `${size}px`;
  });
}

// Deliberately ignore AbortSignal, so late-result fences are tested in addition
// to normal fetch cancellation. No request reaches a bot or a real backend.
async function holdAuthRequest(page: Page, path: string, method: string): Promise<void> {
  await page.addInitScript(
    ({ path, method }) => {
      type Hold = { calls: number; aborted: number; release: (body: unknown) => void };
      const target = window as typeof window & { __authUiHold: Hold };
      const original = window.fetch.bind(window);
      const pending: ((response: Response) => void)[] = [];
      target.__authUiHold = {
        calls: 0,
        aborted: 0,
        release: (body) => {
          for (const resolve of pending.splice(0)) resolve(Response.json(body));
        },
      };
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const verb = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (url.pathname !== path || verb !== method) return original(input, init);
        target.__authUiHold.calls += 1;
        init?.signal?.addEventListener(
          'abort',
          () => {
            target.__authUiHold.aborted += 1;
          },
          { once: true },
        );
        return new Promise<Response>((resolve) => pending.push(resolve));
      };
    },
    { path, method },
  );
}

async function heldRequests(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __authUiHold: { calls: number };
        }
      ).__authUiHold.calls,
  );
}

async function releaseHeldRequest(page: Page, body: unknown): Promise<void> {
  await page.evaluate(
    (value) =>
      (
        window as typeof window & {
          __authUiHold: { release: (body: unknown) => void };
        }
      ).__authUiHold.release(value),
    body,
  );
}

async function passwordLogin(page: Page): Promise<void> {
  await page.getByLabel('Email или имя пользователя', { exact: true }).fill('auth-review-account');
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password-2026');
  await page.getByRole('checkbox', { name: 'Я не робот' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeEnabled();
  const completedLogin = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/login' &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const response = await completedLogin;
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ authenticated: true });
  // The shell accepts the session and chooses its destination asynchronously.
  // Navigating before that render lets the pending onSignedIn overwrite the
  // requested settings route with Home. Wait for the actual login transition.
  await expect(page.locator('input#identifier')).toHaveCount(0);
}

for (const width of [1440, 1024, 390, 320]) {
  test(`auth surfaces and long account data fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    const state = await fixture(page);
    await visit(page, '/sign-in');
    await expect(
      page.getByRole('button', { name: 'Войти через Telegram', exact: true }),
    ).toBeVisible();
    await screenshot(page, `login-${width}`);
    await visit(page, '/sign-up');
    await expect(
      page.getByRole('button', { name: 'Создать через MAX', exact: true }),
    ).toBeVisible();
    await screenshot(page, `register-${width}`);
    state.nextPairing = 'registration_required';
    await page.getByRole('button', { name: 'Создать через MAX', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Завершить регистрацию', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.auth-social-registration input[type="date"]')).toHaveValue('');
    await screenshot(page, `social-registration-${width}`);
    state.signedIn = true;
    state.policyEnabled = true;
    state.overdue = true;
    await visit(page, '/account/security');
    await expect(
      page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true }),
    ).toBeVisible();
    await screenshot(page, `required-${width}`);
    state.admin = true;
    await visit(page, '/admin/confirmations');
    await expect(
      page.getByRole('switch', { name: 'Обязательное подтверждение входа', exact: true }),
    ).toBeChecked();
    await expect(page.getByLabel('Имя бота', { exact: true })).toHaveCount(2);
    await screenshot(page, `admin-required-${width}`);
    expect(
      state.requests.filter((request) => request.path === '/api/admin/v1/dashboard'),
    ).toHaveLength(0);
    state.policyEnabled = false;
    await visit(page, '/account/security');
    await expect(page.getByRole('region', { name: 'Способы входа', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Подключить Telegram', exact: true }),
    ).toBeVisible();
    await screenshot(page, `account-methods-${width}`);
  });
}

for (const failure of ['invalid_token', 'delivery_unavailable', 'api_error'] as const) {
  test(`unavailable providers are hidden and password login works: ${failure}`, async ({
    page,
  }) => {
    const state = await fixture(page, { policyEnabled: true, overdue: true });
    state.providers = state.providers.map((provider) => ({
      ...provider,
      available: false,
      reason: failure === 'api_error' ? 'unavailable' : failure,
    }));
    state.providersFailure = failure === 'api_error';
    await visit(page, '/sign-in');
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect(page.locator('.auth-provider-button')).toHaveCount(0);
    await passwordLogin(page);
    await expect(
      page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = '#/account/security';
    });
    await expect(page.getByRole('region', { name: 'Способы входа', exact: true })).toBeVisible();
    expect(state.requests.some((request) => request.path === '/api/auth/login')).toBe(true);
  });
}

test('a health update hides the dead button without clearing the password form', async ({
  page,
}) => {
  const state = await fixture(page);
  await visit(page, '/sign-in');
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeVisible();
  await page.getByLabel('Email или имя пользователя', { exact: true }).fill('kept-identifier');
  state.providers = state.providers.map((entry) =>
    entry.id === 'max' ? { ...entry, available: false, reason: 'invalid_token' } : entry,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Войти через Telegram', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Email или имя пользователя', { exact: true })).toHaveValue(
    'kept-identifier',
  );
});

test('overdue password sign-in links the same account and resumes after server confirmation', async ({
  page,
}) => {
  const state = await fixture(page, { policyEnabled: true, overdue: true, nextPairing: 'linked' });
  await visit(page, '/sign-in');
  await passwordLogin(page);
  await expect(
    page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Настройки подтверждения', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.auth-confirmation-account')).toContainText(
    'long.account.name.for.layout.review@example.test',
  );
  await page.getByRole('button', { name: 'Подключить MAX', exact: true }).click();
  await expect.poll(() => state.verifiedProvider).toBe('max');
  await expect(page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    location.hash = '#/account/security';
  });
  await expect(page.getByRole('article', { name: 'MAX', exact: true })).toContainText(
    'Подтверждён',
  );
  expect(
    state.requests.find((request) => request.path === '/api/auth/max/pairing/start')?.body,
  ).toEqual({ purpose: 'link' });
  expect(state.requests.filter((request) => request.path.endsWith('/register'))).toHaveLength(0);
});

test('client verification errors keep the restriction; server outage allowance releases it', async ({
  page,
}) => {
  const state = await fixture(page, {
    signedIn: true,
    policyEnabled: true,
    overdue: true,
    verificationFailure: true,
  });
  await visit(page, '/account/security');
  await expect(page.getByRole('alert')).toContainText('Не удалось проверить способы подтверждения');
  await expect(
    page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.auth-provider-button')).toHaveCount(0);
  state.verificationFailure = false;
  state.providers = state.providers.map((entry) => ({
    ...entry,
    available: false,
    reason: 'delivery_unavailable',
  }));
  await page.getByRole('button', { name: 'Проверить и продолжить', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Способы входа', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true })).toHaveCount(
    0,
  );
});

test('new social registration collects a real birth date and backup password', async ({ page }) => {
  const state = await fixture(page, { nextPairing: 'registration_required' });
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  const form = page.locator('.auth-social-registration');
  await expect(form.getByLabel('Дата рождения', { exact: true })).toHaveValue('');
  await expect(page.locator('input#identifier')).toBeHidden();
  await form.getByLabel('Email', { exact: true }).fill('new-account@example.test');
  await form.getByLabel('Имя пользователя', { exact: true }).fill('new-account');
  await form.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
  await form.getByLabel('Пароль для входа', { exact: true }).fill('backup-password-2026');
  await form.getByLabel('Повторите пароль', { exact: true }).fill('different-password-2026');
  await form.getByRole('button', { name: 'Создать аккаунт и войти', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Повтор пароля не совпадает.');
  expect(
    state.requests.filter((request) => request.path.endsWith('/pairing/register')),
  ).toHaveLength(0);
  await form.getByLabel('Повторите пароль', { exact: true }).fill('backup-password-2026');
  await form.getByRole('button', { name: 'Создать аккаунт и войти', exact: true }).click();
  await expect.poll(() => state.signedIn).toBe(true);
  expect(
    state.requests.find((request) => request.path === '/api/auth/telegram/pairing/register')?.body,
  ).toMatchObject({
    email: 'new-account@example.test',
    username: 'new-account',
    birthDate: '1988-03-01',
    country: 'RU',
    password: 'backup-password-2026',
  });
});

test('a bot failure during confirmation rechecks server policy before releasing the account', async ({
  page,
}) => {
  const state = await fixture(page, {
    signedIn: true,
    policyEnabled: true,
    overdue: true,
    nextPairing: 'unavailable',
    providers: healthyProviders().map((provider) =>
      provider.id === 'max' ? provider : { ...provider, available: false, reason: 'disabled' },
    ),
  });
  await visit(page, '/account/security');
  await page.getByRole('button', { name: 'Подключить MAX', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Способы входа', exact: true })).toBeVisible();
  expect(
    state.requests.filter((request) => request.path === '/api/auth/verification').length,
  ).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.auth-provider-button')).toHaveCount(0);
});

test('an unknown social identity can return to its existing password account without registering', async ({
  page,
}) => {
  const state = await fixture(page, { nextPairing: 'registration_required' });
  await visit(page, '/sign-in');
  await page.getByLabel('Email или имя пользователя', { exact: true }).fill('existing-account');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await page
    .getByRole('button', { name: 'У меня уже есть аккаунт — войти по паролю', exact: true })
    .click();
  await expect(page.getByLabel('Email или имя пользователя', { exact: true })).toHaveValue(
    'existing-account',
  );
  await expect(page.locator('.auth-social-registration')).toHaveCount(0);
  expect(state.requests.filter((request) => request.path.endsWith('/register'))).toHaveLength(0);
});

test('a revoked identity is a terminal error and stops polling', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page, { nextPairing: 'identity_revoked' });
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await page.clock.runFor(1_600);
  await expect(page.getByRole('alert')).toContainText('Эта привязка отозвана');
  const completed = () =>
    state.requests.filter((request) => request.path === '/api/auth/max/pairing/complete').length;
  expect(completed()).toBe(1);
  await page.clock.fastForward(10_000);
  expect(completed()).toBe(1);
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeEnabled();
});

test('a restricted platform administrator can turn off the policy without dashboard access', async ({
  page,
}) => {
  const state = await fixture(page, {
    signedIn: true,
    admin: true,
    policyEnabled: true,
    overdue: true,
  });
  await visit(page, '/account/security');
  await page.getByRole('button', { name: 'Настройки подтверждения', exact: true }).click();
  await expect(page).toHaveURL(/#\/admin\/confirmations$/);
  const toggle = page.getByRole('switch', {
    name: 'Обязательное подтверждение входа',
    exact: true,
  });
  await expect(toggle).toBeChecked();
  const savedPolicy = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/v1/auth/verification-policy' &&
      response.request().method() === 'POST',
  );
  // This controlled checkbox reflects the acknowledged server value. Native
  // uncheck() checks synchronously, before that request can settle.
  await toggle.click();
  expect((await savedPolicy).ok()).toBe(true);
  await expect.poll(() => state.policyEnabled).toBe(false);
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.auth-admin-recovery')).toHaveCount(0);
  expect(
    state.requests.filter((request) => request.path === '/api/admin/v1/dashboard'),
  ).toHaveLength(0);
  expect(
    state.requests.find(
      (request) => request.path.endsWith('/auth/verification-policy') && request.method === 'POST',
    )?.body,
  ).toEqual({ enabled: false });
});

test('policy save failure keeps the original switch state and shows an error', async ({ page }) => {
  await fixture(page, { signedIn: true, admin: true, policySaveFailure: true });
  await visit(page, '/admin/confirmations');
  const toggle = page.getByRole('switch', {
    name: 'Обязательное подтверждение входа',
    exact: true,
  });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.auth-policy-control').getByRole('alert')).toContainText(
    'Не удалось сохранить правило',
  );
});

test('invalid token health is visible in admin and hides the public button', async ({ page }) => {
  const state = await fixture(page, { signedIn: true, admin: true });
  await visit(page, '/admin/confirmations');
  const max = page.getByRole('form', { name: 'MAX', exact: true });
  await max.getByLabel('Токен бота', { exact: true }).fill('fixture-invalid-token');
  await max.getByRole('button', { name: 'Проверить и сохранить', exact: true }).click();
  await expect(max).toContainText('Токен недействителен');
  await expect(max).toContainText('кнопка входа скрыта');
  await expect(
    max.getByRole('button', { name: 'Подтвердить в боте MAX', exact: true }),
  ).toHaveCount(0);
  state.signedIn = false;
  await visit(page, '/sign-in');
  await expect(
    page.getByRole('button', { name: 'Войти через Telegram', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toHaveCount(0);
});

test('the account UI prevents removal of the last server-declared sign-in method', async ({
  page,
}) => {
  const state = await fixture(page, {
    signedIn: true,
    passwordConfigured: false,
    linked: { max: true, telegram: false },
    canUnlink: { max: false, telegram: false },
  });
  await visit(page, '/account/security');
  await expect(page.getByRole('button', { name: 'Отключить MAX', exact: true })).toBeDisabled();
  await expect(page.getByRole('article', { name: 'MAX', exact: true })).toContainText(
    'сначала настройте пароль',
  );
  await expect(
    page.getByRole('button', { name: 'Подключить Telegram', exact: true }),
  ).toBeVisible();
  expect(state.requests.filter((request) => request.path.endsWith('/unlink'))).toHaveLength(0);
});

test('an administrator checks transport then confirms the current configuration on the same linked account', async ({
  page,
}) => {
  const state = await fixture(page, {
    signedIn: true,
    admin: true,
    linked: { max: true, telegram: false },
    nextPairing: 'linked',
    providers: healthyProviders().map((provider) =>
      provider.id === 'max'
        ? { ...provider, enforcementEligible: false, enforcementReason: 'delivery_unverified' }
        : provider,
    ),
  });
  await visit(page, '/admin/confirmations');
  const max = page.getByRole('form', { name: 'MAX', exact: true });
  const native = max.locator('dl > div').filter({ hasText: 'Подтверждение человеком' });
  await expect(native).toContainText('Ещё не проверено');
  await expect(max).toContainText('https://asa.example.test/api/auth/max/webhook');
  await max.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  await expect
    .poll(
      () =>
        state.requests.filter((request) => request.path === '/api/admin/v1/integrations/max/check')
          .length,
    )
    .toBe(1);
  await expect(native).toContainText('Ещё не проверено');
  expect(state.providers.find((provider) => provider.id === 'max')?.enforcementEligible).toBe(
    false,
  );
  await max.getByRole('button', { name: 'Подтвердить в боте MAX', exact: true }).click();
  await expect(native).toContainText('Проверено —');
  expect(state.providers.find((provider) => provider.id === 'max')?.enforcementEligible).toBe(true);
  expect(
    state.requests.find((request) => request.path === '/api/auth/max/pairing/start')?.body,
  ).toEqual({ purpose: 'link' });
  expect(state.requests.filter((request) => request.path.endsWith('/check'))).toHaveLength(2);
  expect(
    state.requests.filter(
      (request) =>
        request.method === 'PUT' ||
        request.path.endsWith('/logout') ||
        request.path.endsWith('/register'),
    ),
  ).toHaveLength(0);
  expect(state.signedIn).toBe(true);
  const current = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
  expect(current.account.id).toBe(ACCOUNT_ID);
});

test('an HTTP administration address is not prefilled as the public HTTPS receiver', async ({
  page,
}) => {
  const state = await fixture(page, {
    signedIn: true,
    admin: true,
    emptyProviderUrl: true,
    providers: healthyProviders().map((provider) =>
      provider.id === 'telegram'
        ? { ...provider, available: false, reason: 'not_configured', enforcementEligible: false }
        : provider,
    ),
  });
  await visit(page, '/admin/confirmations');
  const telegram = page.getByRole('form', { name: 'Telegram', exact: true });
  const receiver = telegram.getByLabel('Публичный HTTPS-адрес ASA Lab', { exact: true });
  await expect(receiver).toHaveValue('');
  await receiver.fill('http://192.0.2.15:8080');
  await telegram.getByRole('button', { name: 'Проверить и сохранить', exact: true }).click();
  await expect(telegram.getByRole('alert')).toContainText('HTTPS');
  expect(state.requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
});

test('unknown policy and provider reads do not claim that confirmation is disabled', async ({
  page,
}) => {
  await fixture(page, { signedIn: true, admin: true, adminReadFailure: true });
  await visit(page, '/admin/confirmations');
  const policy = page.locator('.auth-policy-control');
  await expect(policy.getByRole('switch')).toBeDisabled();
  await expect(policy).toContainText('Статус недоступен');
  await expect(policy).not.toContainText('Выключено');
  const max = page.getByRole('form', { name: 'MAX', exact: true });
  await expect(max.getByRole('switch')).toBeDisabled();
  await expect(max).toContainText('Статус недоступен');
  await expect(max).not.toContainText('Выключен');
  await expect(
    max.getByRole('button', { name: 'Подтвердить в боте MAX', exact: true }),
  ).toHaveCount(0);
});

test('a stalled pairing start can be cancelled and its late success is ignored', async ({
  page,
}) => {
  const state = await fixture(page);
  await holdAuthRequest(page, '/api/auth/max/pairing/start', 'POST');
  await visit(page, '/sign-in');
  await page.getByLabel('Email или имя пользователя', { exact: true }).fill('kept-account');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await releaseHeldRequest(page, {
    pairingToken: 'late-start',
    launchUrl: 'https://max.ru/asa_fixture_bot?start=late-start',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Email или имя пользователя', { exact: true })).toHaveValue(
    'kept-account',
  );
  await expect(page.locator('.auth-social-pending')).toHaveCount(0);
  expect(
    state.requests.filter((request) => request.path.endsWith('/pairing/complete')),
  ).toHaveLength(0);
});

test('pairing expiry remains independent of a stalled completion request', async ({ page }) => {
  await page.clock.install();
  const state = await fixture(page);
  await holdAuthRequest(page, '/api/auth/max/pairing/complete', 'POST');
  await visit(page, '/sign-in');
  state.pairingExpiresAt = await page.evaluate(() => new Date(Date.now() + 5_000).toISOString());
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await expect(page.locator('.auth-social-pending')).toBeVisible();
  await page.clock.runFor(1_600);
  await expect.poll(() => heldRequests(page)).toBe(1);
  await page.clock.runFor(3_500);
  await expect(page.getByRole('alert')).toContainText('Время подтверждения истекло');
  await releaseHeldRequest(page, {
    status: 'authenticated',
    session: {
      authenticated: true,
      account: { id: 'late-other-account' },
      user: { id: 'late-other-account' },
    },
  });
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeEnabled();
  expect(state.signedIn).toBe(false);
});

test('a stalled registration can return to password login without accepting its late result', async ({
  page,
}) => {
  const state = await fixture(page, { nextPairing: 'registration_required' });
  await holdAuthRequest(page, '/api/auth/telegram/pairing/register', 'POST');
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  const form = page.locator('.auth-social-registration');
  await form.getByLabel('Email', { exact: true }).fill('new-account@example.test');
  await form.getByLabel('Имя пользователя', { exact: true }).fill('new-account');
  await form.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
  await form.getByLabel('Пароль для входа', { exact: true }).fill('backup-password-2026');
  await form.getByLabel('Повторите пароль', { exact: true }).fill('backup-password-2026');
  await form.getByRole('button', { name: 'Создать аккаунт и войти', exact: true }).click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await form
    .getByRole('button', { name: 'У меня уже есть аккаунт — войти по паролю', exact: true })
    .click();
  await releaseHeldRequest(page, {
    authenticated: true,
    account: { id: 'late-other-account' },
    user: { id: 'late-other-account' },
  });
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.locator('.auth-social-registration')).toHaveCount(0);
  expect(await heldRequests(page)).toBe(1);
  expect(state.signedIn).toBe(false);
});

test('confirmation checks are single flight and logout remains usable during a stalled check', async ({
  page,
}) => {
  const state = await fixture(page, { signedIn: true, policyEnabled: true, overdue: true });
  await holdAuthRequest(page, '/api/auth/verification', 'GET');
  await visit(page, '/account/security');
  await expect.poll(() => heldRequests(page)).toBe(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await heldRequests(page)).toBe(1);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect.poll(() => state.signedIn).toBe(false);
  await releaseHeldRequest(page, {
    policyEnabled: false,
    required: false,
    reason: 'disabled',
    dueAt: null,
    verifiedProvider: null,
    providers: healthyProviders(),
  });
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true })).toHaveCount(
    0,
  );
  expect(state.requests.filter((request) => request.path === '/api/auth/logout')).toHaveLength(1);
});

test('a pairing timeout restores controls without retrying the unknown start result', async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page);
  await holdAuthRequest(page, '/api/auth/max/pairing/start', 'POST');
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await page.clock.runFor(15_100);
  await expect(page.getByRole('alert')).toContainText('Сервер не ответил вовремя');
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  expect(await heldRequests(page)).toBe(1);
});

test('password sign-in cancels the pending social attempt and ignores its late account result', async ({
  page,
}) => {
  const state = await fixture(page);
  await holdAuthRequest(page, '/api/auth/max/pairing/complete', 'POST');
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await passwordLogin(page);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __authUiHold: { aborted: number };
          }
        ).__authUiHold.aborted,
    ),
  ).toBe(1);
  const current = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
  await releaseHeldRequest(page, {
    status: 'authenticated',
    session: {
      ...current,
      account: { ...current.account, id: 'late-other-account', displayName: 'Late other Account' },
      user: { ...current.user, id: 'late-other-account', displayName: 'Late other Account' },
    },
  });
  await page.evaluate(() => {
    location.hash = '#/account/security';
  });
  await expect(page.getByRole('region', { name: 'Способы входа', exact: true })).toBeVisible();
  await expect(page.getByText('Late other Account', { exact: true })).toHaveCount(0);
  await expect(page.locator('.auth-social-pending')).toHaveCount(0);
  expect(state.signedIn).toBe(true);
  expect(state.verifiedProvider).toBeNull();
  expect(state.requests.filter((request) => request.path === '/api/auth/login')).toHaveLength(1);
  expect(await heldRequests(page)).toBe(1);
});

for (const width of [1440, 1024, 390, 320]) {
  test(`confirmation and provider readiness remain usable at ${width}px font150`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    const state = await fixture(page, {
      signedIn: true,
      admin: true,
      policyEnabled: true,
      overdue: true,
      providers: healthyProviders().map((provider) =>
        provider.id === 'max'
          ? { ...provider, enforcementEligible: false, enforcementReason: 'delivery_unverified' }
          : provider,
      ),
    });
    await visit(page, '/account/security');
    await expect(
      page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true }),
    ).toBeVisible();
    await enlargeText(page);
    await screenshot(page, `required-${width}-font150`);
    await visit(page, '/admin/confirmations');
    const max = page.getByRole('form', { name: 'MAX', exact: true });
    await expect(
      max.getByRole('button', { name: 'Подтвердить в боте MAX', exact: true }),
    ).toBeEnabled();
    await expect(
      max.locator('dl > div').filter({ hasText: 'Подтверждение человеком' }),
    ).toContainText('Ещё не проверено');
    await screenshot(page, `admin-readiness-${width}-normal`);
    await enlargeText(page);
    await screenshot(page, `admin-readiness-${width}-font150`);
    expect(state.requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
  });
}
