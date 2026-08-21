import { expect, test, type Page, type Route } from '@playwright/test';

const ORGANIZATION_ID = '30000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const TARGET_ACCOUNT_ID = '20000000-0000-4000-8000-000000000002';

const authSession = {
  authenticated: true,
  user: { id: ACCOUNT_ID, displayName: 'Администратор', email: 'admin@example.test' },
  account: { id: ACCOUNT_ID, displayName: 'Администратор', email: 'admin@example.test' },
  capabilities: [{ capability: 'educator', state: 'verified' }],
  workspaces: [
    {
      workspaceId: ORGANIZATION_ID,
      kind: 'organization',
      title: 'Школа № 1',
      role: 'school_admin',
    },
  ],
  activeWorkspace: { workspaceId: ORGANIZATION_ID, kind: 'organization' },
  navigation: { classes: true, classroomManagement: true },
  timeZone: 'Europe/Moscow',
};

function profile(permissions: string[]) {
  return {
    administrator: true,
    principalId: '10000000-0000-4000-8000-000000000001',
    accountId: ACCOUNT_ID,
    displayName: 'Администратор',
    activeWorkspaceId: ORGANIZATION_ID,
    scopes: [
      {
        kind: 'organization',
        id: ORGANIZATION_ID,
        title: 'Школа № 1',
        role: 'school_admin',
        permissions,
      },
    ],
  };
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAuthenticatedAdmin(page: Page, permissions: string[]): Promise<string[]> {
  const directoryRequests: string[] = [];
  await page.route('**/api/auth/me', (route) => json(route, authSession));
  await page.route('**/api/account/avatar', (route) => json(route, { avatarDataUrl: null }));
  await page.route('**/api/classrooms/awaiting-review', (route) => json(route, { total: 0 }));
  await page.route('**/api/admin/v1/me', (route) => json(route, profile(permissions)));
  await page.route('**/api/admin/v1/accounts?**', async (route) => {
    directoryRequests.push(route.request().url());
    await json(route, {
      items: [
        {
          accountId: ACCOUNT_ID,
          principalId: '10000000-0000-4000-8000-000000000001',
          email: 'admin@example.test',
          displayName: 'Администратор',
          username: 'school_admin',
          status: 'active',
          emailVerificationState: 'verified',
          createdAt: '2026-08-20T10:00:00.000Z',
          organizationRole: 'school_admin',
          membershipState: 'active',
          activeSessionCount: 1,
          lastSeenAt: '2026-08-21T17:00:00.000Z',
          hasEverSignedIn: true,
          isPlatformAdmin: false,
        },
      ],
      next: null,
    });
  });
  await page.route('**/api/admin/v1/organizations?**', async (route) => {
    directoryRequests.push(route.request().url());
    await json(route, {
      items: [
        {
          workspaceId: ORGANIZATION_ID,
          title: 'Школа № 1',
          status: 'active',
          createdAt: '2026-08-20T10:00:00.000Z',
          memberCount: 12,
          administratorCount: 2,
          activeSessionCount: 7,
        },
      ],
      next: null,
    });
  });
  await page.route('**/api/admin/v1/security/sessions?**', async (route) => {
    directoryRequests.push(route.request().url());
    await json(route, {
      items: [
        {
          sessionId: '40000000-0000-4000-8000-000000000001',
          accountId: ACCOUNT_ID,
          email: 'admin@example.test',
          displayName: 'Администратор',
          username: 'school_admin',
          workspaceId: ORGANIZATION_ID,
          workspaceTitle: 'Школа № 1',
          createdAt: '2026-08-21T16:00:00.000Z',
          lastSeenAt: '2026-08-21T17:00:00.000Z',
          expiresAt: '2026-08-22T16:00:00.000Z',
          revokedAt: null,
          status: 'active',
          userAgentSummary: 'Chrome 140 · Windows 11',
        },
      ],
      next: null,
    });
  });
  await page.route('**/api/admin/v1/audit-events?**', (route) =>
    json(route, { items: [], next: null }),
  );
  return directoryRequests;
}

test('administrator can inspect real scoped directory sections without secret fields', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (failure) => errors.push(failure.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const requests = await mockAuthenticatedAdmin(page, [
    'administration.open',
    'administration.scopes.read',
    'administration.audit.read',
    'administration.accounts.read',
    'administration.organizations.read',
    'administration.security.read',
  ]);

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Админ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Что можно делать в админке' }).click();
  await expect(page.getByText(/Вы управляете организацией «Школа № 1»/)).toBeVisible();

  await page.getByRole('button', { name: 'Пользователи', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Администратор/ }).first()).toContainText(
    'admin@example.test',
  );
  await expect(page.getByText('Почта: Подтверждена')).toBeVisible();

  await page.getByRole('button', { name: 'Организации', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Школа № 1/ }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '12', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Безопасность', exact: true }).click();
  await expect(page.getByText('Chrome 140 · Windows 11')).toBeVisible();
  await expect(page.getByText(/IP-адрес пока не сохраняется/)).toBeVisible();
  await expect(page.getByText('Последний IP')).toHaveCount(0);
  await expect(page.getByText('Хэш токена')).toHaveCount(0);

  expect(requests).toHaveLength(3);
  for (const request of requests) {
    const url = new URL(request);
    expect(url.searchParams.get('scopeKind')).toBe('organization');
    expect(url.searchParams.get('scopeId')).toBe(ORGANIZATION_ID);
    expect(url.searchParams.has('tenantId')).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('tabs that were not granted by the server never appear, including on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthenticatedAdmin(page, [
    'administration.open',
    'administration.scopes.read',
    'administration.audit.read',
  ]);

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Админ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пользователи', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Организации', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Безопасность', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'История', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('platform administrator sees real system status and no infrastructure secrets', async ({
  page,
}) => {
  const platformProfile = {
    ...profile(['administration.open', 'administration.operations.read']),
    scopes: [
      {
        kind: 'platform',
        id: null,
        title: 'ASA Lab',
        role: 'platform_admin',
        permissions: ['administration.open', 'administration.operations.read'],
      },
    ],
  };
  await page.route('**/api/auth/me', (route) => json(route, authSession));
  await page.route('**/api/account/avatar', (route) => json(route, { avatarDataUrl: null }));
  await page.route('**/api/classrooms/awaiting-review', (route) => json(route, { total: 0 }));
  await page.route('**/api/admin/v1/me', (route) => json(route, platformProfile));
  await page.route('**/api/admin/v1/operations/status', (route) =>
    json(route, {
      checkedAt: '2026-08-21T18:00:00.000Z',
      services: { api: 'responding', database: 'responding' },
      migration: {
        version: '0071',
        name: 'admin_operations',
        appliedAt: '2026-08-21T17:59:00.000Z',
      },
      counts: {
        accounts: 14,
        activeAccounts: 12,
        suspendedAccounts: 2,
        organizations: 3,
        activeSessions: 7,
        auditEvents24h: 22,
      },
      runtime: {
        uptimeSeconds: 7200,
        eventLoopDelayMs: { p50: 10, p99: 18, max: 25 },
        memory: { rssMb: 180, heapUsedMb: 90 },
        host: {
          cpuUsedByApiPercent: 2.5,
          logicalCpuCount: 16,
          memoryTotalMb: 32768,
          memoryUsedPercent: 44,
        },
        requests: {
          total: 250,
          inFlight: 1,
          byStatusClass: { '2xx': 248, '5xx': 2 },
          durationMs: { p50: 12, p95: 50, p99: 80 },
        },
        database: { total: 4, idle: 3, waiting: 0 },
      },
    }),
  );

  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'Система', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Система', exact: true })).toBeVisible();
  await expect(page.getByText('PostgreSQL').first()).toBeVisible();
  await expect(page.getByText('0071', { exact: true })).toBeVisible();
  await expect(page.getByText('14', { exact: true })).toBeVisible();
  await expect(page.getByText('2 ч 0 мин', { exact: true })).toBeVisible();
  await expect(page.getByText(/паролей, токенов, IP-адресов/)).toBeVisible();
  await expect(page.getByText(/databaseUrl|tokenHash|ipAddress/i)).toHaveCount(0);
});

test('platform administrator can manage a user and revoke a foreign session with a reason', async ({
  page,
}) => {
  const mutations: Array<{ url: string; body: unknown }> = [];
  const permissions = [
    'administration.open',
    'administration.accounts.read',
    'administration.accounts.manage',
    'administration.security.read',
    'administration.security.manage',
  ];
  await page.route('**/api/auth/me', (route) => json(route, authSession));
  await page.route('**/api/account/avatar', (route) => json(route, { avatarDataUrl: null }));
  await page.route('**/api/classrooms/awaiting-review', (route) => json(route, { total: 0 }));
  await page.route('**/api/admin/v1/me', (route) =>
    json(route, {
      ...profile(permissions),
      scopes: [
        { kind: 'platform', id: null, title: 'ASA Lab', role: 'platform_admin', permissions },
      ],
    }),
  );
  await page.route('**/api/admin/v1/accounts?**', (route) =>
    json(route, {
      items: [
        {
          accountId: TARGET_ACCOUNT_ID,
          principalId: '10000000-0000-4000-8000-000000000002',
          email: 'learner@example.test',
          displayName: 'Тестовый ученик',
          username: 'learner',
          status: 'active',
          emailVerificationState: 'unverified',
          createdAt: '2026-08-20T10:00:00.000Z',
          organizationRole: null,
          membershipState: null,
          activeSessionCount: 1,
          lastSeenAt: '2026-08-21T17:00:00.000Z',
          hasEverSignedIn: true,
          isPlatformAdmin: false,
        },
      ],
      next: null,
    }),
  );
  await page.route('**/api/admin/v1/accounts/*/status', async (route) => {
    mutations.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await json(route, { accountId: TARGET_ACCOUNT_ID, status: 'suspended' });
  });
  await page.route('**/api/admin/v1/security/sessions?**', (route) =>
    json(route, {
      items: [
        {
          sessionId: '40000000-0000-4000-8000-000000000002',
          accountId: TARGET_ACCOUNT_ID,
          email: 'learner@example.test',
          displayName: 'Тестовый ученик',
          username: 'learner',
          workspaceId: ORGANIZATION_ID,
          workspaceTitle: 'Школа № 1',
          createdAt: '2026-08-21T16:00:00.000Z',
          lastSeenAt: '2026-08-21T17:00:00.000Z',
          expiresAt: '2026-08-22T16:00:00.000Z',
          revokedAt: null,
          status: 'active',
          userAgentSummary: 'Chrome · Windows',
        },
      ],
      next: null,
    }),
  );
  await page.route('**/api/admin/v1/security/sessions/*/revoke', async (route) => {
    mutations.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await json(route, { sessionId: '40000000-0000-4000-8000-000000000002', revoked: true });
  });

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Админ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Вернуться в ASA Lab' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Пользователи', exact: true }).click();
  await expect(page.getByText('Действующих входов: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Управлять' }).click();
  await page.getByLabel('Причина изменения').fill('Запрос владельца аккаунта');
  await page.getByRole('button', { name: 'Заблокировать вход' }).click();

  await page.getByRole('button', { name: 'Безопасность', exact: true }).click();
  await page.getByRole('button', { name: 'Завершить' }).click();
  await page.getByLabel('Причина', { exact: true }).fill('Подозрительная активность');
  await page.getByRole('button', { name: 'Завершить сессию' }).click();

  expect(mutations).toHaveLength(2);
  expect(mutations[0]?.body).toEqual({
    status: 'suspended',
    reason: 'Запрос владельца аккаунта',
  });
  expect(mutations[1]?.body).toEqual({ reason: 'Подозрительная активность' });
});
