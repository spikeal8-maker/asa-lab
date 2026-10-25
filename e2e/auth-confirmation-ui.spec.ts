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
const AUTH_FIXTURE_ORIGIN = new URL(
  process.env['ASA_E2E_BASE_URL'] ?? `http://127.0.0.1:${process.env['ASA_E2E_PORT'] ?? '4612'}`,
).origin;
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

type FixtureIdentity = { id: string; email: string | null; displayName: string };

interface UiState {
  identity: FixtureIdentity | null;
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
  localPreviewEnabled: boolean;
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
    identity: null,
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
    localPreviewEnabled: false,
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
  const identity = () =>
    state.identity ?? { id: ACCOUNT_ID, email: profile.email, displayName: profile.displayName };
  const session = () => ({
    authenticated: true,
    user: identity(),
    account: identity(),
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
    return url.origin === AUTH_FIXTURE_ORIGIN && !url.pathname.startsWith('/api/')
      ? route.fallback()
      : route.abort();
  });
  await page.context().route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== AUTH_FIXTURE_ORIGIN) return route.abort();
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
    if (path === '/api/auth/local-preview/config')
      return reply({ enabled: state.localPreviewEnabled });
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
    if (path === '/api/auth/register') {
      profile = {
        ...profile,
        email: String(body.email),
        username: String(body.username),
        displayName: String(body.displayName),
        birthDate: String(body.birthDate),
        country: String(body.country),
      };
      state.signedIn = true;
      return reply(session(), 201);
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
            accountId: identity().id,
            displayName: identity().displayName,
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
        if (provider === 'max') {
          expect(body).not.toHaveProperty('email');
          expect(body).not.toHaveProperty('password');
          const birthDate = new Date(`${String(body.birthDate)}T00:00:00Z`);
          if (!Number.isFinite(birthDate.getTime()))
            return error('validation_error', 'Укажите дату рождения.', 400);
          const adultCutoff = new Date();
          adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18);
          if (birthDate > adultCutoff)
            return error('age_routed', 'Личный аккаунт доступен с 18 лет.', 422);
          state.passwordConfigured = false;
          state.identity = {
            id: '20000000-0000-4000-8000-000000000009',
            email: null,
            displayName: String(body.displayName),
          };
        }
        profile = {
          ...profile,
          email: provider === 'max' ? '' : String(body.email),
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
      return reply({
        ...profile,
        email: identity().email,
        displayName: identity().displayName,
        capabilities: capabilities(),
        workspaces,
      });
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

test('ordinary Home and Projects never request unavailable MAX Mini App SDK', async ({ page }) => {
  const sdkRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://st.max.ru/js/')) sdkRequests.push(request.url());
  });
  await page.route('https://st.max.ru/**', (route) => route.abort('failed'));
  await fixture(page);

  const durationsMs: Record<string, number> = {};
  for (const path of ['/home', '/projects']) {
    const start = Date.now();
    await visit(page, path);
    durationsMs[path] = Date.now() - start;
    await expect(page.locator('body')).toBeVisible();
  }
  expect(sdkRequests).toEqual([]);
  await test.info().attach('ordinary-navigation-with-blocked-max-sdk', {
    body: JSON.stringify({ durationsMs, sdkRequests }),
    contentType: 'application/json',
  });
});

test('MAX Mini App launch requests the real bridge and reports network failure', async ({
  page,
}) => {
  let sdkRequests = 0;
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => {
    sdkRequests += 1;
    return route.abort('failed');
  });
  await fixture(page);
  await page.goto('/max-login', { waitUntil: 'load' });
  await expect(page.getByText(/Не удалось загрузить SDK MAX/)).toBeVisible();
  expect(sdkRequests).toBe(1);
});

let navigationSequence = 0;
async function visit(page: Page, route: string): Promise<void> {
  // A new document reads the fixture's current authenticated actor explicitly.
  await page.goto(`/?auth-ui=${++navigationSequence}#${route}`);
}

async function screenshot(page: Page, name: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= viewport) return null;
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      elements: Array.from(document.querySelectorAll<HTMLElement>('body *')).flatMap((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.right <= viewport && rect.left >= 0 && node.scrollWidth <= node.clientWidth)
          return [];
        const style = getComputedStyle(node);
        return [
          {
            tag: node.tagName,
            className: node.className,
            text: node.textContent?.slice(0, 180),
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            fontSize: style.fontSize,
            minWidth: style.minWidth,
            whiteSpace: style.whiteSpace,
            display: style.display,
          },
        ];
      }),
    };
  });
  if (overflow)
    await test.info().attach(`${name}-overflow`, {
      body: JSON.stringify(overflow, null, 2),
      contentType: 'application/json',
    });
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

async function passwordLogin(page: Page, identifier = 'auth-review-account'): Promise<void> {
  await page.getByLabel('Почта или логин', { exact: true }).fill(identifier);
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
  test(`public landing keeps direct account entry without opening the menu at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    await fixture(page);
    await visit(page, '/');
    const header = page.locator('.public-home-header');
    const login = header.getByRole('button', { name: 'Войти', exact: true });
    await expect(login).toBeVisible();
    await expect(login).toBeInViewport();
    const loginBox = await login.boundingBox();
    expect(loginBox!.width).toBeGreaterThanOrEqual(44);
    expect(loginBox!.height).toBeGreaterThanOrEqual(44);
    const brandBox = await header.locator('.public-home-brand').boundingBox();
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(loginBox!.x);
    const menu = header.locator('.public-home-mobile-menu');
    if (width <= 1120) {
      await expect(menu).toHaveJSProperty('open', false);
      const menuBox = await menu.boundingBox();
      expect(loginBox!.x + loginBox!.width).toBeLessThanOrEqual(menuBox!.x);
      await menu.locator('summary').click();
      await expect(menu.getByRole('link', { name: 'Инструменты', exact: true })).toBeVisible();
      await expect(
        menu.getByRole('button', { name: 'Создать аккаунт', exact: true }),
      ).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Войти', exact: true })).toHaveCount(0);
      await menu.locator('summary').click();
    }
    const hero = page.locator('.public-home-hero');
    await expect(hero.getByRole('button', { name: 'Создать аккаунт', exact: true })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Смотреть проекты', exact: true })).toHaveAttribute(
      'href',
      '#community',
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`landing-entry-${width}-viewport.png`) });
    await login.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/sign-in$/);
    await visit(page, '/');
    await page
      .locator('.public-home-hero')
      .getByRole('button', { name: 'Создать аккаунт', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/sign-up$/);
  });

  test(`static landing retains a visible native sign-in link with JavaScript disabled at ${width}px`, async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Auth UI fixture baseURL is required');
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width, height: width < 600 ? 720 : 900 },
    });
    try {
      await context.route('https://st.max.ru/**', (route) => route.abort());
      const page = await context.newPage();
      await page.goto(baseURL);
      const login = page
        .locator('.seo-fallback .seo-header')
        .getByRole('link', { name: 'Войти', exact: true });
      await expect(login).toBeVisible();
      await expect(login).toBeInViewport();
      await expect(login).toHaveAttribute('href', '/#/sign-in');
      const box = await login.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await expect(
        page
          .locator('.seo-fallback .seo-actions')
          .getByRole('link', { name: 'Создать аккаунт', exact: true }),
      ).toHaveAttribute('href', '/#/sign-up');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({ path: test.info().outputPath(`static-entry-${width}-viewport.png`) });
      await login.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#\/sign-in$/); // Native route only; SPA authentication needs JS.
    } finally {
      await context.close();
    }
  });

  test(`auth surfaces and long account data fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    const state = await fixture(page);
    await visit(page, '/sign-in');
    await expect(
      page.getByRole('button', { name: 'Войти через Telegram', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#login-identifier-hint')).toBeVisible();
    await expect(page.getByLabel('Почта или логин', { exact: true })).toHaveAttribute(
      'aria-describedby',
      /login-identifier-hint/,
    );
    await screenshot(page, `login-${width}`);
    state.providersFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const providerError = page.locator('.auth-provider-status');
    await expect(providerError).toContainText('Не удалось проверить вход через мессенджеры');
    const providerRetry = providerError.getByRole('button', {
      name: 'Проверить ещё раз',
      exact: true,
    });
    const retryBox = await providerRetry.boundingBox();
    expect(retryBox!.height).toBeGreaterThanOrEqual(44);
    expect(retryBox!.width).toBeGreaterThanOrEqual(44);
    await screenshot(page, `provider-error-${width}`);
    state.providersFailure = false;
    await providerRetry.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeVisible();
    await expect(providerError).toHaveCount(0);
    await visit(page, '/sign-up');
    await expect(
      page.getByRole('button', { name: 'Создать через MAX', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#register-username')).toHaveCount(0);
    await expect(page.getByText('Почта будет вашим логином.', { exact: true })).toBeVisible();
    for (const [field, hint] of [
      ['register-email', 'register-email-hint'],
      ['register-password', 'register-password-hint'],
      ['register-birth-date', 'register-age-hint'],
    ]) {
      await expect(page.locator(`#${field}`)).toHaveAttribute('aria-describedby', hint);
      await expect(page.locator(`#${hint}`)).toBeVisible();
    }
    const help = page.locator('.auth-field-help');
    await expect(help).toHaveJSProperty('open', false);
    const helpBox = await help.locator('summary').boundingBox();
    expect(helpBox!.height).toBeGreaterThanOrEqual(44);
    expect(helpBox!.width).toBeGreaterThanOrEqual(44);
    await help.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(help).toHaveJSProperty('open', true);
    await expect(help.locator('p')).toContainText('Ученики могут входить по коду класса');
    await page.keyboard.press('Enter');
    await expect(help).toHaveJSProperty('open', false);
    await screenshot(page, `register-${width}`);
    state.nextPairing = 'registration_required';
    await page.getByRole('button', { name: 'Создать через MAX', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Выбор аккаунта ASA Lab', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Создать новый аккаунт', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Войти в существующий аккаунт', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Завершить регистрацию', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.auth-social-registration input[type="date"]')).toHaveValue('');
    await expect(
      page.locator(
        '.auth-social-registration input[type="email"], .auth-social-registration input[type="password"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator('.auth-social-registration input[autocomplete="username"]'),
    ).toHaveCount(0);
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

for (const route of ['/sign-in', '/sign-up']) {
  test(`provider-check failure is explained and can retry without clearing credentials on ${route}`, async ({
    page,
  }) => {
    const state = await fixture(page, { providersFailure: true });
    await visit(page, route);
    const identifier =
      route === '/sign-in'
        ? page.getByLabel('Почта или логин', { exact: true })
        : page.getByLabel('Email', { exact: true });
    await identifier.fill('kept@example.test');
    const status = page.locator('.auth-provider-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toContainText('Не удалось проверить вход через мессенджеры');
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect(page.locator('.auth-provider-button')).toHaveCount(0);
    state.providersFailure = false;
    await status.getByRole('button', { name: 'Проверить ещё раз', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: route === '/sign-in' ? 'Войти через MAX' : 'Создать через MAX',
        exact: true,
      }),
    ).toBeVisible();
    await expect(status).toHaveCount(0);
    await expect(identifier).toHaveValue('kept@example.test');
    expect(
      state.requests.filter((request) => request.path === '/api/auth/providers').length,
    ).toBeGreaterThanOrEqual(2);
  });
}

test('a successful empty provider list does not claim a network failure', async ({ page }) => {
  await fixture(page, { providers: [] });
  await visit(page, '/sign-in');
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.locator('.auth-provider-status')).toHaveCount(0);
  await expect(page.locator('.auth-provider-button')).toHaveCount(0);
});

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
  await page.getByLabel('Почта или логин', { exact: true }).fill('kept-identifier');
  state.providers = state.providers.map((entry) =>
    entry.id === 'max' ? { ...entry, available: false, reason: 'invalid_token' } : entry,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Войти через Telegram', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Почта или логин', { exact: true })).toHaveValue('kept-identifier');
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
  await page.getByRole('button', { name: 'Создать новый аккаунт', exact: true }).click();
  const form = page.locator('.auth-social-registration');
  await expect(form.getByLabel('Дата рождения', { exact: true })).toHaveValue('');
  await expect(page.locator('input#identifier')).toBeHidden();
  await form.getByLabel('Email', { exact: true }).fill('new-account@example.test');
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
    username: expect.stringMatching(/^u_[a-f0-9]{32}$/),
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

test('an unknown Telegram identity can return to its existing password account without registering', async ({
  page,
}) => {
  const state = await fixture(page, { nextPairing: 'registration_required' });
  await visit(page, '/sign-in');
  await page.getByLabel('Почта или логин', { exact: true }).fill('existing-account');
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).click();
  await page.getByRole('button', { name: 'Войти в существующий аккаунт', exact: true }).click();
  await expect(page.getByLabel('Почта или логин', { exact: true })).toHaveValue('existing-account');
  await expect(page.locator('.auth-social-registration')).toHaveCount(0);
  expect(state.requests.filter((request) => request.path.endsWith('/register'))).toHaveLength(0);
});

for (const width of [1440, 390]) {
  test(`ordinary account registration uses email without requesting a public handle at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    const state = await fixture(page);
    await visit(page, '/sign-up');
    await expect(page.locator('#register-username')).toHaveCount(0);
    await page.getByLabel('Email', { exact: true }).fill('private-registration@example.test');
    await page.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
    await page.getByLabel('Пароль', { exact: true }).fill('registration-password-2026');
    await screenshot(page, `email-registration-${width}`);
    await page.getByRole('checkbox', { name: 'Я не робот', exact: true }).press('Space');
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect.poll(() => state.signedIn).toBe(true);
    const registered = state.requests.filter((request) => request.path === '/api/auth/register');
    expect(registered).toHaveLength(1);
    expect(registered[0].body).toMatchObject({
      email: 'private-registration@example.test',
      displayName: 'Пользователь',
      username: expect.stringMatching(/^u_[a-f0-9]{32}$/),
    });
  });
}

for (const width of [1440, 1024, 390, 320]) {
  test(`MAX-only registration asks for age without account choice or password at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    const state = await fixture(page, { nextPairing: 'registration_required' });
    await visit(page, '/sign-in');
    await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
    const form = page.locator('.auth-social-registration');
    await expect(
      form.getByRole('heading', { name: 'Завершить регистрацию', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Выбор аккаунта ASA Lab', exact: true }),
    ).toHaveCount(0);
    await expect(
      form.locator('input[type="email"], input[type="password"], input[autocomplete="username"]'),
    ).toHaveCount(0);
    await expect(form.getByLabel('Дата рождения', { exact: true })).toHaveAttribute('required', '');
    await expect(page.getByText('Нет аккаунта?', { exact: true })).toBeHidden();
    const birthDateBox = await form.getByLabel('Дата рождения', { exact: true }).boundingBox();
    const birthDateLabelBox = await form
      .locator('label', { hasText: 'Дата рождения' })
      .boundingBox();
    const countryLabelBox = await form.locator('label', { hasText: 'Страна' }).boundingBox();
    expect(birthDateBox).not.toBeNull();
    expect(birthDateLabelBox).not.toBeNull();
    expect(countryLabelBox).not.toBeNull();
    if (width >= 1024) expect(birthDateBox!.width).toBeGreaterThanOrEqual(200);
    expect(birthDateLabelBox!.y + birthDateLabelBox!.height).toBeLessThanOrEqual(birthDateBox!.y);
    expect(birthDateBox!.y + birthDateBox!.height).toBeLessThanOrEqual(countryLabelBox!.y);
    await expect(form.getByLabel('Отображаемое имя', { exact: true })).toHaveValue(
      'Новый участник',
    );
    expect(state.requests.filter((r) => r.path === '/api/auth/max/pairing/register')).toHaveLength(
      0,
    );
    await form.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
    await screenshot(page, `max-external-registration-${width}`);
    await form.getByRole('button', { name: 'Создать аккаунт и войти', exact: true }).click();
    await expect.poll(() => state.signedIn).toBe(true);
    await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
    const writes = state.requests.filter((r) => r.path === '/api/auth/max/pairing/register');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({
      pairingToken: expect.any(String),
      username: expect.stringMatching(/^u_[a-f0-9]{32}$/),
      displayName: 'Новый участник',
      birthDate: '1988-03-01',
      country: 'RU',
    });
    expect(state.passwordConfigured).toBe(false);
    expect(state.identity?.email).toBeNull();
    expect(state.linked.max).toBe(true);
    expect(state.identity?.id).not.toBe(ACCOUNT_ID);
    expect(
      state.requests.filter((r) => r.path === '/api/auth/login' || r.path === '/api/auth/register'),
    ).toHaveLength(0);
    expect(state.requests.filter((r) => r.path === '/api/auth/max/pairing/start')).toHaveLength(1);
  });

  test(`already-linked MAX identity enters its existing account directly at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 600 ? 720 : 900 });
    const identity = {
      id: ACCOUNT_ID,
      email: 'existing@example.test',
      displayName: 'Существующий аккаунт',
    };
    const state = await fixture(page, {
      nextPairing: 'authenticated',
      linked: { max: true, telegram: false },
      identity,
    });
    await visit(page, '/sign-in');
    await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
    await expect.poll(() => state.signedIn).toBe(true);
    await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
    await expect(page.locator('.auth-social-registration')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Выбор аккаунта ASA Lab', exact: true }),
    ).toHaveCount(0);
    expect(state.identity?.id).toBe(ACCOUNT_ID);
    expect(
      state.requests.filter((r) => r.path.endsWith('/register') || r.path === '/api/auth/login'),
    ).toHaveLength(0);
  });
}

test('MAX-only registration keeps the adult requirement without asking for email', async ({
  page,
}) => {
  const state = await fixture(page, { nextPairing: 'registration_required' });
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  const form = page.locator('.auth-social-registration');
  await form.getByLabel('Дата рождения', { exact: true }).fill('2015-03-01');
  await form.getByRole('button', { name: 'Создать аккаунт и войти', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('18');
  expect(state.signedIn).toBe(false);
  expect(state.linked.max).toBe(false);
  await expect(form.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
});

test('MAX-only registration sends one request while a duplicate submit is pending', async ({
  page,
}) => {
  const state = await fixture(page, { nextPairing: 'registration_required' });
  await holdAuthRequest(page, '/api/auth/max/pairing/register', 'POST');
  await visit(page, '/sign-in');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  const form = page.locator('.auth-social-registration');
  await form.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
  const submit = form.locator('button[type="submit"]');
  await submit.click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await expect(submit).toBeDisabled();
  await form.dispatchEvent('submit');
  await form.dispatchEvent('submit');
  expect(await heldRequests(page)).toBe(1);
  expect(state.signedIn).toBe(false);
  await visit(page, '/sign-in'); // Discard this deliberately unacknowledged synthetic attempt.
});

for (const identifier of [
  'long.account.name.for.layout.review@example.test',
  'auth-review-account',
]) {
  test(`password sign-in keeps existing email or legacy handle: ${identifier}`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await visit(page, '/sign-in');
    await passwordLogin(page, identifier);
    await expect.poll(() => state.signedIn).toBe(true);
    expect(
      state.requests.find((request) => request.path === '/api/auth/login')?.body.identifier,
    ).toBe(identifier);
  });
}

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
  await page.getByLabel('Почта или логин', { exact: true }).fill('kept-account');
  await page.getByRole('button', { name: 'Войти через MAX', exact: true }).click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await releaseHeldRequest(page, {
    pairingToken: 'late-start',
    launchUrl: 'https://max.ru/asa_fixture_bot?start=late-start',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  await expect(page.getByRole('button', { name: 'Войти через MAX', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Почта или логин', { exact: true })).toHaveValue('kept-account');
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
  await page.getByRole('button', { name: 'Создать новый аккаунт', exact: true }).click();
  const form = page.locator('.auth-social-registration');
  await form.getByLabel('Email', { exact: true }).fill('new-account@example.test');
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
  // The shared logout event returns App to public Home. Use its normal entry
  // action to check that a late result cannot restore the authenticated view.
  const publicSignIn = page.getByRole('banner').getByRole('button', { name: 'Войти', exact: true });
  await expect(publicSignIn).toBeVisible();
  await releaseHeldRequest(page, {
    policyEnabled: false,
    required: false,
    reason: 'disabled',
    dueAt: null,
    verifiedProvider: null,
    providers: healthyProviders(),
  });
  await publicSignIn.click();
  await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Подтвердите аккаунт', exact: true })).toHaveCount(
    0,
  );
  expect(state.signedIn).toBe(false);
  expect(await heldRequests(page)).toBe(1);
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

async function submitRegistration(page: Page): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill('pending-a@example.test');
  await page.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
  await page.getByLabel('Пароль', { exact: true }).fill('pending-password-2026');
  await page.getByRole('checkbox', { name: 'Я не робот', exact: true }).focus();
  await page.keyboard.press('Space');
  const submit = page.getByRole('button', { name: 'Создать аккаунт', exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
}

for (const attempt of ['register', 'local-preview'] as const) {
  test(`leaving ${attempt} preserves the password account and its capabilities after a late response`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      admin: true,
      localPreviewEnabled: attempt === 'local-preview',
    });
    const path = attempt === 'register' ? '/api/auth/register' : '/api/auth/local-preview/session';
    await holdAuthRequest(page, path, 'POST');
    await visit(page, '/sign-up');
    if (attempt === 'register') await submitRegistration(page);
    else await page.getByRole('button', { name: 'Войти в тестовый стенд', exact: true }).click();
    await expect.poll(() => heldRequests(page)).toBe(1);
    await page.getByRole('button', { name: '← К входу', exact: true }).click();
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
    await passwordLogin(page);
    const current = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    expect(current.account.id).toBe(ACCOUNT_ID);
    expect(current.capabilities).toContainEqual({
      capability: 'platform_admin',
      state: 'verified',
    });
    await releaseHeldRequest(page, {
      ...current,
      account: {
        ...current.account,
        id: 'late-register-account-a',
        displayName: 'Late registration A',
      },
      user: { ...current.user, id: 'late-register-account-a', displayName: 'Late registration A' },
      capabilities: [],
    });
    const accountMenu = page.locator('.portal-account > summary');
    await expect(accountMenu).toBeVisible();
    await expect(accountMenu).toHaveAttribute(
      'aria-label',
      `Меню аккаунта ${current.user.displayName}`,
    );
    const retained = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    expect(retained.account.id).toBe(ACCOUNT_ID);
    expect(retained.capabilities).toEqual(current.capabilities);
    await page.evaluate(() => {
      location.hash = '#/admin/confirmations';
    });
    await expect(
      page.getByRole('switch', {
        name: 'Обязательное подтверждение входа',
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.getByText('Late registration A', { exact: true })).toHaveCount(0);
    expect(await heldRequests(page)).toBe(1);
    expect(state.requests.filter((request) => request.path === '/api/auth/login')).toHaveLength(1);
    expect(state.signedIn).toBe(true);
  });
}

test('registration timeout retains unknown-result guidance and does not repeat the write', async ({
  page,
}) => {
  await fixture(page);
  await holdAuthRequest(page, '/api/auth/register', 'POST');
  await visit(page, '/sign-up');
  // Complete the anti-bot interaction normally, then control only the request deadline.
  await page.getByLabel('Email', { exact: true }).fill('pending-a@example.test');
  await page.getByLabel('Дата рождения', { exact: true }).fill('1988-03-01');
  await page.getByLabel('Пароль', { exact: true }).fill('pending-password-2026');
  await page.getByRole('checkbox', { name: 'Я не робот', exact: true }).focus();
  await page.keyboard.press('Space');
  const submit = page.getByRole('button', { name: 'Создать аккаунт', exact: true });
  await expect(submit).toBeEnabled();
  await page.clock.install();
  await submit.click();
  await expect.poll(() => heldRequests(page)).toBe(1);
  await page.clock.runFor(15_100);
  await expect(page.getByRole('alert')).toContainText('Результат действия пока неизвестен');
  await expect(page.getByRole('alert')).toContainText('Проверьте состояние перед повтором');
  await expect(page.getByRole('alert')).not.toContainText('Попробуйте ещё раз');
  await expect(page.getByRole('button', { name: '← К входу', exact: true })).toBeEnabled();
  expect(await heldRequests(page)).toBe(1);
});

async function expectReadableProviderSaveActions(page: Page, width: number): Promise<void> {
  const buttons = page
    .locator('.auth-admin-provider > footer')
    .getByRole('button', { name: 'Проверить и сохранить', exact: true });
  await expect(buttons).toHaveCount(2);
  const measurements = await buttons.evaluateAll((elements) =>
    elements.map((button) => {
      const lines = (range: Range): number =>
        new Set(
          Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => Math.round(rect.top)),
        ).size;
      const label = document.createRange();
      label.selectNodeContents(button);
      const brokenWords: string[] = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        for (const word of (node.nodeValue ?? '').matchAll(/\S+/gu)) {
          if (word.index === undefined) continue;
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          if (lines(range) > 1) brokenWords.push(word[0]);
        }
        node = walker.nextNode();
      }
      const rect = button.getBoundingClientRect();
      return {
        provider: button.closest('form')?.getAttribute('aria-label'),
        text: button.textContent?.trim(),
        width: rect.width,
        height: rect.height,
        fontSize: getComputedStyle(button).fontSize,
        lineCount: lines(label),
        brokenWords,
      };
    }),
  );
  await test.info().attach(`admin-primary-labels-${width}-font150`, {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  for (const measurement of measurements) {
    // Readable labels may wrap at spaces on mobile; words must stay intact.
    expect(measurement.brokenWords, `${measurement.provider}: whole CTA words`).toEqual([]);
    expect(measurement.lineCount).toBeGreaterThan(0);
    expect(
      measurement.lineCount,
      `${measurement.provider}: primary label lines`,
    ).toBeLessThanOrEqual(width >= 1024 ? 1 : 2);
  }
}

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
    await expectReadableProviderSaveActions(page, width);
    expect(state.requests.filter((request) => request.method === 'PUT')).toHaveLength(0);
  });
}

const METHOD_ACCOUNT_A: FixtureIdentity = {
  id: ACCOUNT_ID,
  email: 'method-account-a@example.test',
  displayName: 'Аккаунт A — способы входа',
};
const METHOD_ACCOUNT_B: FixtureIdentity = {
  id: '20000000-0000-4000-8000-000000000002',
  email: 'password-account-b@example.test',
  displayName: 'Аккаунт B — парольный вход',
};
const PASSWORD_ACCOUNT_CAPABILITIES = [
  { capability: 'creator', state: 'verified' },
  { capability: 'platform_admin', state: 'verified' },
];

// Install after A is loaded. Only the next matching request is held, so B's
// password login and current-session reads use the normal fixture. Deliberately
// keep the old promise alive after abort to exercise the complete late path.
async function holdNextMethodRequest(page: Page, path: string, method: string): Promise<void> {
  await page.evaluate(
    ({ path, method }) => {
      type Hold = {
        calls: number;
        aborted: number;
        meCalls: number;
        release: (body: unknown) => void;
        settle: () => Promise<void>;
      };
      const target = window as typeof window & { __authUiHold: Hold };
      const original = window.fetch.bind(window);
      let release: ((response: Response) => void) | null = null;
      const pending = new Set<Promise<Response>>();
      let forwarded = 0;
      const forward: typeof fetch = (input, init) => {
        forwarded += 1;
        const response = original(input, init);
        pending.add(response);
        void response.then(
          () => pending.delete(response),
          () => pending.delete(response),
        );
        return response;
      };
      const hold: Hold = {
        calls: 0,
        aborted: 0,
        meCalls: 0,
        release: (body) => {
          release?.(Response.json(body));
          release = null;
        },
        settle: async () => {
          // Drain requests caused by the released continuation too (unlink can
          // refresh two statuses before it starts /me). No polling delay/retry.
          for (;;) {
            const version = forwarded;
            await Promise.allSettled([...pending]);
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            });
            if (pending.size === 0 && version === forwarded) return;
          }
        },
      };
      target.__authUiHold = hold;
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const verb = init?.method ?? (input instanceof Request ? input.method : 'GET');
        if (url.pathname === '/api/auth/me') hold.meCalls += 1;
        if (hold.calls > 0 || url.pathname !== path || verb !== method) return forward(input, init);
        hold.calls += 1;
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        signal?.addEventListener(
          'abort',
          () => {
            hold.aborted += 1;
          },
          { once: true },
        );
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      };
    },
    { path, method },
  );
}

async function methodRequestState(
  page: Page,
): Promise<{ calls: number; aborted: number; meCalls: number }> {
  return page.evaluate(() => {
    const { calls, aborted, meCalls } = (
      window as typeof window & {
        __authUiHold: { calls: number; aborted: number; meCalls: number };
      }
    ).__authUiHold;
    return { calls, aborted, meCalls };
  });
}

async function releaseMethodRequest(page: Page, body: unknown): Promise<void> {
  await releaseHeldRequest(page, body);
  // Observe the render caused by the released promise, rather than accepting
  // the already-visible B header before an old continuation gets to run.
  await page.evaluate(() =>
    (
      window as typeof window & { __authUiHold: { settle: () => Promise<void> } }
    ).__authUiHold.settle(),
  );
}

function authWrites(state: UiState): UiState['requests'] {
  return state.requests.filter(
    (request) => request.path.startsWith('/api/auth/') && request.method === 'POST',
  );
}

async function enterMethodAccount(page: Page, state: UiState): Promise<void> {
  await visit(page, '/account/security');
  await expect(page.locator('.portal-account > summary')).toHaveAttribute(
    'aria-label',
    `Меню аккаунта ${METHOD_ACCOUNT_A.displayName}`,
  );
  const methods = page.getByRole('region', { name: 'Способы входа', exact: true });
  await expect(methods).toBeVisible();
  for (const provider of METHODS) {
    const label = provider === 'max' ? 'MAX' : 'Telegram';
    await expect(methods.getByRole('article', { name: label, exact: true })).toContainText(
      state.linked[provider] ? 'Подтверждён' : 'Не подключён',
    );
  }
  await expect(page.locator('.account-private-facts')).toContainText('Настроен');
}

async function startMethodAction(
  page: Page,
  provider: SocialAuthProvider,
  action: 'link' | 'unlink',
): Promise<void> {
  const label = provider === 'max' ? 'MAX' : 'Telegram';
  if (action === 'unlink') page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('region', { name: 'Способы входа', exact: true })
    .getByRole('button', {
      name: `${action === 'link' ? 'Подключить' : 'Отключить'} ${label}`,
      exact: true,
    })
    .click();
}

async function replaceWithPasswordAccount(page: Page, state: UiState): Promise<void> {
  await page.locator('.portal-account > summary').click();
  await page
    .locator('.portal-account-menu')
    .getByRole('button', { name: 'Выход', exact: true })
    .click();
  const signIn = page.getByRole('banner').getByRole('button', { name: 'Войти', exact: true });
  await expect(signIn).toBeVisible();
  expect(state.signedIn).toBe(false);
  state.identity = { ...METHOD_ACCOUNT_B };
  state.admin = true;
  state.verifiedProvider = null;
  state.linked = { max: false, telegram: false };
  await signIn.click();
  await passwordLogin(page, METHOD_ACCOUNT_B.email);
  await expect(page.locator('.portal-account > summary')).toHaveAttribute(
    'aria-label',
    `Меню аккаунта ${METHOD_ACCOUNT_B.displayName}`,
  );
  const current = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
  expect(current.account).toEqual(METHOD_ACCOUNT_B);
  expect(current.user).toEqual(METHOD_ACCOUNT_B);
  expect(current.capabilities).toEqual(PASSWORD_ACCOUNT_CAPABILITIES);
  await page.evaluate(() => {
    location.hash = '#/account/security';
  });
  await expect(page.getByRole('region', { name: 'Способы входа', exact: true })).toBeVisible();
  for (const label of ['MAX', 'Telegram']) {
    await expect(
      page.getByRole('button', { name: `Подключить ${label}`, exact: true }),
    ).toBeEnabled();
  }
}

async function expectPasswordMethodAccount(page: Page, state: UiState): Promise<void> {
  const summary = page.locator('.portal-account > summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute(
    'aria-label',
    `Меню аккаунта ${METHOD_ACCOUNT_B.displayName}`,
  );
  await expect(summary.locator('.portal-user-copy > strong')).toHaveText(
    METHOD_ACCOUNT_B.displayName,
  );
  const retained = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
  expect(retained.account).toEqual(METHOD_ACCOUNT_B);
  expect(retained.user).toEqual(METHOD_ACCOUNT_B);
  expect(retained.capabilities).toEqual(PASSWORD_ACCOUNT_CAPABILITIES);
  // This is a real App capability gate, in addition to the server identity read.
  await page.evaluate(() => {
    location.hash = '#/admin/confirmations';
  });
  await expect(
    page.getByRole('switch', { name: 'Обязательное подтверждение входа', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(METHOD_ACCOUNT_A.displayName, { exact: true })).toHaveCount(0);
  expect(state.signedIn).toBe(true);
  expect(state.identity).toEqual(METHOD_ACCOUNT_B);
  expect(state.linked).toEqual({ max: false, telegram: false });
  expect(state.verifiedProvider).toBeNull();
  expect(state.requests.filter((request) => request.path === '/api/auth/login')).toHaveLength(1);
  expect(state.requests.filter((request) => request.path === '/api/auth/logout')).toHaveLength(1);
}

for (const provider of METHODS) {
  for (const action of ['link', 'unlink'] as const) {
    test(`account method lifecycle: ${provider} post-${action} read cannot replace password Account B`, async ({
      page,
    }) => {
      const state = await fixture(page, {
        signedIn: true,
        identity: { ...METHOD_ACCOUNT_A },
        nextPairing: 'linked',
        linked: {
          max: action === 'unlink' && provider === 'max',
          telegram: action === 'unlink' && provider === 'telegram',
        },
      });
      await enterMethodAccount(page, state);
      const oldIdentity = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
      await holdNextMethodRequest(page, '/api/auth/me', 'GET');
      await startMethodAction(page, provider, action);
      await expect.poll(() => heldRequests(page)).toBe(1);
      await replaceWithPasswordAccount(page, state);
      const writes = authWrites(state);
      await releaseMethodRequest(page, oldIdentity);
      await expectPasswordMethodAccount(page, state);
      expect(authWrites(state)).toEqual(writes);
      expect(await methodRequestState(page)).toMatchObject({ calls: 1, aborted: 1 });
    });
  }

  for (const stage of ['link-refresh', 'unlink-mutation', 'unlink-refresh'] as const) {
    test(`account method lifecycle: ${provider} cancelled ${stage} starts no later identity read`, async ({
      page,
    }) => {
      const action = stage === 'link-refresh' ? 'link' : 'unlink';
      const state = await fixture(page, {
        signedIn: true,
        identity: { ...METHOD_ACCOUNT_A },
        nextPairing: 'linked',
        linked: {
          max: action === 'unlink' && provider === 'max',
          telegram: action === 'unlink' && provider === 'telegram',
        },
      });
      await enterMethodAccount(page, state);
      const mutation = stage === 'unlink-mutation';
      await holdNextMethodRequest(
        page,
        `/api/auth/${provider}/${mutation ? 'unlink' : 'status'}`,
        mutation ? 'POST' : 'GET',
      );
      await startMethodAction(page, provider, action);
      await expect.poll(() => heldRequests(page)).toBe(1);
      await replaceWithPasswordAccount(page, state);
      const writes = authWrites(state);
      const reads = (await methodRequestState(page)).meCalls;
      await releaseMethodRequest(
        page,
        mutation
          ? { unlinked: true }
          : {
              linked: action === 'link',
              verifiedAt: action === 'link' ? '2026-10-18T09:00:00Z' : null,
              firstAuthenticatedAt: '2026-10-16T09:00:00Z',
              promptDue: false,
              promptDismissedUntil: null,
              available: true,
              canUnlink: true,
            },
      );
      expect((await methodRequestState(page)).meCalls).toBe(reads);
      await expectPasswordMethodAccount(page, state);
      expect(authWrites(state)).toEqual(writes);
      expect(await methodRequestState(page)).toMatchObject({ calls: 1, aborted: 1 });
    });
  }

  test(`account method lifecycle: ${provider} finishing read rejects a different Account while A stays active`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      signedIn: true,
      identity: { ...METHOD_ACCOUNT_A },
      nextPairing: 'linked',
    });
    await enterMethodAccount(page, state);
    const current = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    await holdNextMethodRequest(page, '/api/auth/me', 'GET');
    await startMethodAction(page, provider, 'link');
    await expect.poll(() => heldRequests(page)).toBe(1);
    const writes = authWrites(state);
    await releaseMethodRequest(page, {
      ...current,
      user: METHOD_ACCOUNT_B,
      account: METHOD_ACCOUNT_B,
      capabilities: PASSWORD_ACCOUNT_CAPABILITIES,
    });
    const summary = page.locator('.portal-account > summary');
    await expect(summary).toHaveAttribute(
      'aria-label',
      `Меню аккаунта ${METHOD_ACCOUNT_A.displayName}`,
    );
    const retained = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
    expect(retained.account).toEqual(METHOD_ACCOUNT_A);
    expect(retained.capabilities).toEqual(current.capabilities);
    expect(state.admin).toBe(false);
    expect(authWrites(state)).toEqual(writes);
    expect(await heldRequests(page)).toBe(1);
  });

  test(`account method lifecycle: ${provider} current Account accepts successful link and unlink`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      signedIn: true,
      identity: { ...METHOD_ACCOUNT_A },
      nextPairing: 'linked',
    });
    await enterMethodAccount(page, state);
    const label = provider === 'max' ? 'MAX' : 'Telegram';
    state.identity = { ...METHOD_ACCOUNT_A, displayName: `Аккаунт A — ${label} подключён` };
    await startMethodAction(page, provider, 'link');
    await expect(page.locator('.portal-account > summary')).toHaveAttribute(
      'aria-label',
      `Меню аккаунта ${state.identity.displayName}`,
    );
    await expect(
      page.getByRole('button', { name: `Отключить ${label}`, exact: true }),
    ).toBeEnabled();
    state.identity = { ...METHOD_ACCOUNT_A, displayName: `Аккаунт A — ${label} отключён` };
    await startMethodAction(page, provider, 'unlink');
    await expect(page.locator('.portal-account > summary')).toHaveAttribute(
      'aria-label',
      `Меню аккаунта ${state.identity.displayName}`,
    );
    await expect(
      page.getByRole('button', { name: `Подключить ${label}`, exact: true }),
    ).toBeEnabled();
    expect(state.linked[provider]).toBe(false);
    expect(
      state.requests.filter((request) => request.path === `/api/auth/${provider}/pairing/start`),
    ).toHaveLength(1);
    expect(
      state.requests.filter((request) => request.path === `/api/auth/${provider}/pairing/complete`),
    ).toHaveLength(1);
    expect(
      state.requests.filter((request) => request.path === `/api/auth/${provider}/unlink`),
    ).toHaveLength(1);
    expect(state.requests.filter((request) => request.path.endsWith('/register'))).toHaveLength(0);
  });
}
