import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { adminDashboardFixture } from '../apps/web/src/admin/testing/admin-dashboard.fixture';
import {
  catalogUserFixture,
  catalogPageFixture,
} from '../apps/web/src/admin/testing/admin-user-catalog.fixture';
import type { AdminDashboardRange } from '../apps/web/src/admin/admin-api';

const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const WORKSPACE = '10000000-0000-4000-8000-000000000001';
const SCHOOL = '10000000-0000-4000-8000-000000000002';
const evidence = 'reports/playwright/admin-dashboard';
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));

async function fixture(page: Page) {
  const dist = resolve('apps/web/dist');
  let account = ACCOUNT,
    holdAccess = false,
    holdDashboard = false,
    failDashboard = false,
    empty = false;
  let accessCalls = 0;
  let catalogMode = false;
  const catalogQueries: URLSearchParams[] = [];
  const accessQueue: Array<(status?: number) => Promise<void>> = [];
  const dashboardQueue: Array<() => Promise<void>> = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4612') return route.abort();
    if (!url.pathname.startsWith('/api/')) {
      const file = resolve(
        dist,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      );
      if (!file.startsWith(`${dist}${sep}`) || !existsSync(file)) return route.abort();
      return route.fulfill({ path: file });
    }
    const reply = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    const path = url.pathname;
    if (path === '/api/auth/me')
      return reply({
        authenticated: true,
        user: {
          id: account,
          email: 'admin@example.test',
          displayName: 'Администратор с длинным русским именем',
        },
        account: { id: account, email: 'admin@example.test', displayName: 'Администратор' },
        capabilities: [
          { capability: 'creator', state: 'verified' },
          { capability: 'platform_admin', state: 'verified' },
        ],
        workspaces: [
          { workspaceId: WORKSPACE, kind: 'personal', title: 'Личное пространство', role: 'owner' },
        ],
        activeWorkspace: { workspaceId: WORKSPACE, kind: 'personal' },
        navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/auth/refresh') return reply({ error: { code: 'unauthorized' } }, 401);
    if (path === '/api/class-join/me') return reply({ authenticated: false });
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/auth/max/status')
      return reply({
        linked: false,
        verifiedAt: null,
        firstAuthenticatedAt: null,
        promptDue: false,
        promptDismissedUntil: null,
        available: false,
      });
    if (path === '/api/admin/v1/me') {
      accessCalls++;
      const permissions = [
        'administration.open',
        'administration.scopes.read',
        'administration.accounts.read',
        'administration.accounts.manage',
        'administration.organizations.read',
        'administration.security.read',
        'administration.audit.read',
        'administration.operations.read',
      ];
      const profile = {
        administrator: true,
        principalId: account,
        accountId: account,
        displayName: 'Администратор',
        activeWorkspaceId: WORKSPACE,
        scopes: [
          { kind: 'platform', id: null, title: 'ASA Lab', role: 'platform_admin', permissions },
          {
            kind: 'organization',
            id: SCHOOL,
            title: 'Школа с длинным названием для проверки области управления',
            role: 'school_admin',
            permissions,
          },
        ],
      };
      if (holdAccess)
        return new Promise<void>((done) =>
          accessQueue.push(async (status = 200) => {
            await reply(status === 200 ? profile : { error: { code: 'denied' } }, status);
            done();
          }),
        );
      return reply(profile);
    }
    if (path === '/api/admin/v1/dashboard') {
      const range = (url.searchParams.get('range') ?? '24h') as AdminDashboardRange;
      const marker =
        account === ACCOUNT && url.searchParams.get('scopeKind') === 'platform' ? 8 : 42;
      const dashboard = adminDashboardFixture(range, marker, empty);
      if (holdDashboard)
        return new Promise<void>((done) =>
          dashboardQueue.push(async () => {
            await reply(dashboard);
            done();
          }),
        );
      return failDashboard
        ? reply({ error: { code: 'offline', message: 'Недоступно' } }, 503)
        : reply(dashboard);
    }
    if (path === '/api/admin/v1/users') {
      catalogQueries.push(url.searchParams);
      if (!catalogMode) return reply(catalogPageFixture());
      const organization = url.searchParams.get('scopeKind') === 'organization';
      const shared = '20000000-0000-4000-8000-000000000002';
      const accountUser = catalogUserFixture(
        'account',
        shared,
        'Яков — длинное русское имя пользователя административного каталога',
      );
      const student = catalogUserFixture(
        'student',
        shared,
        'Анна — длинное имя ученицы цифровой лаборатории',
      );
      let items = url.searchParams.has('cursor')
        ? [
            catalogUserFixture(
              'student',
              '20000000-0000-4000-8000-000000000003',
              'Следующая ученица',
            ),
          ]
        : [accountUser, ...(organization ? [] : [student])];
      const kind = url.searchParams.get('kind');
      if (kind === 'accounts') items = items.filter((item) => item.kind === 'account');
      if (kind === 'students') items = items.filter((item) => item.kind === 'student');
      if (url.searchParams.get('status') === 'inactive') items = [];
      const search = url.searchParams.get('search')?.toLowerCase();
      if (search) items = items.filter((item) => item.displayName.toLowerCase().includes(search));
      return reply(
        catalogPageFixture(
          items,
          url.searchParams.has('cursor') || kind !== 'all' || organization || search
            ? null
            : 'fixture-next',
          organization,
        ),
      );
    }
    if (path.startsWith('/api/admin/v1/accounts/') && path.endsWith('/crm')) {
      const user = catalogUserFixture('account', '20000000-0000-4000-8000-000000000002');
      return reply({
        ...user.account,
        firstAuthenticatedAt: user.createdAt,
        organizations: [],
        sessions: [],
        activity: [],
        ipAddresses: [],
        notes: [],
        max: { linked: false, verifiedAt: null },
        moduleUsage: [],
      });
    }
    if (
      path === '/api/admin/v1/accounts' ||
      path === '/api/admin/v1/organizations' ||
      path === '/api/admin/v1/audit'
    )
      return reply({ items: [], next: null });
    return reply({ items: [], next: null });
  });
  return {
    catalog: (value: boolean) => {
      catalogMode = value;
    },
    catalogQueries: () => catalogQueries,
    holdAccess: (value: boolean) => {
      holdAccess = value;
    },
    accessCalls: () => accessCalls,
    releaseAccess: async (status = 200) => {
      const next = accessQueue.shift();
      if (!next) throw new Error('No pending access fixture');
      await next(status);
    },
    pendingAccess: () => accessQueue.length,
    holdDashboard: (value: boolean) => {
      holdDashboard = value;
    },
    pendingDashboard: () => dashboardQueue.length,
    releaseDashboard: async () => {
      const next = dashboardQueue.shift();
      if (!next) throw new Error('No pending dashboard fixture');
      await next();
    },
    account: (value: string) => {
      account = value;
    },
    error: (value: boolean) => {
      failDashboard = value;
    },
    empty: (value: boolean) => {
      empty = value;
    },
  };
}
const learning = (page: Page) =>
  page.getByRole('heading', { name: 'Учебные инструменты — запуски', exact: true });
async function noPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    page: {
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    },
    layout: [
      ...document.querySelectorAll(
        '.admin-page, .admin-dashboard, .admin-dashboard > *, .admin-dashboard-grid, .admin-chart-card, .admin-chart-canvas',
      ),
    ].map((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        className: element.className,
        width: Math.round(bounds.width),
        right: Math.round(bounds.right),
        client: element.clientWidth,
        scroll: element.scrollWidth,
        minWidth: style.minWidth,
        overflowX: style.overflowX,
      };
    }),
  }));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    JSON.stringify(dimensions),
  ).toBe(true);
}

for (const width of [1440, 1024, 390, 320]) {
  test(`admin overview readable time axis and local scrolling at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto('/#/admin');
    await expect(learning(page)).toBeVisible();
    await noPageOverflow(page);
    const learningCard = page.locator('.admin-chart-card').filter({ has: learning(page) });
    await expect(learningCard.locator('.admin-chart-time-label')).toHaveCount(12);
    await expect(learningCard.getByRole('button', { name: 'Scratch', exact: true })).toBeVisible();
    await expect(learningCard.getByRole('button', { name: 'Шахматы', exact: true })).toHaveCount(0);
    const games = page
      .locator('.admin-chart-card')
      .filter({ has: page.getByRole('heading', { name: 'Игры — запуски', exact: true }) });
    await expect(games.getByRole('button', { name: 'Шахматы', exact: true })).toBeVisible();
    expect(
      await page
        .locator('.admin-chart-canvas svg path')
        .evaluateAll((paths) =>
          paths.every((path) => /^#[0-9a-f]{6}$/.test(path.getAttribute('stroke') ?? '')),
        ),
    ).toBe(true);
    const plot = learningCard.getByRole('region');
    await plot.focus();
    await page.keyboard.press('ArrowRight');
    if (await plot.evaluate((element) => element.scrollWidth > element.clientWidth))
      await expect.poll(() => plot.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    else await expect(learningCard.locator('.admin-chart-time-label').last()).toBeInViewport();
    expect(
      await plot
        .locator('.admin-chart-time-label')
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    // Long chart titles get their own row instead of squeezing between legend buttons.
    expect(
      await learning(page).evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThan(180);
    await plot.blur();
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/overview-${width}.png`, fullPage: true });
    if (width === 390 || width === 320) {
      await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Основная навигация' })).toBeVisible();
    }
    const nav = page.locator('.portal-sidebar .portal-nav');
    expect(await nav.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe('none');
    const last = page.locator('.portal-admin-subnav-item').last();
    await last.focus();
    await expect(last).toBeInViewport();
    await noPageOverflow(page);
  });
}

test('admin overview keeps matching refresh charts, then shows clear error/retry/empty states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const f = await fixture(page);
  await page.goto('/#/admin');
  await expect(learning(page)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { chart: Element | null }).chart =
      document.querySelector('.admin-chart-card');
  });
  f.holdDashboard(true);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Пока показаны предыдущие данные');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { chart: Element }).chart ===
        document.querySelector('.admin-chart-card'),
    ),
  ).toBe(true);
  await expect.poll(() => f.pendingDashboard()).toBe(1);
  f.holdDashboard(false);
  await f.releaseDashboard();
  f.error(true);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Показаны предыдущие данные');
  await expect(learning(page)).toBeVisible();
  await noPageOverflow(page);
  f.empty(true);
  f.error(false);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.locator('.admin-chart-empty').first()).toBeVisible();
  await noPageOverflow(page);
  // An actual range change has no matching previous data and must show loading/error.
  f.holdDashboard(true);
  await page.getByRole('button', { name: '7 дней', exact: true }).click();
  await expect(page.getByText('Собираем реальные показатели', { exact: true })).toBeVisible();
  await expect(learning(page)).toHaveCount(0);
  await expect.poll(() => f.pendingDashboard()).toBe(1);
  await f.releaseDashboard();
  await expect(learning(page)).toBeVisible();
  f.error(true);
  f.holdDashboard(false);
  await page.getByRole('button', { name: '1 год', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Дашборд не загрузился');
  f.error(false);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(learning(page)).toBeVisible();
  await noPageOverflow(page);
});

for (const status of [401, 403]) {
  test(`admin navigation preserves verified shell while rechecking and revokes on ${status}`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await page.goto('/#/admin');
    await expect(learning(page)).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { sidebar: Element | null }).sidebar =
        document.querySelector('.portal-sidebar');
    });
    const calls = f.accessCalls();
    f.holdAccess(true);
    await page.evaluate(() => {
      window.location.hash = '/admin/users';
    });
    await expect.poll(() => f.accessCalls()).toBeGreaterThan(calls);
    await expect.poll(() => f.pendingAccess()).toBe(1);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { sidebar: Element }).sidebar ===
          document.querySelector('.portal-sidebar'),
      ),
    ).toBe(true);
    await expect(page.getByText('Проверяем права доступа', { exact: true })).toHaveCount(0);
    await expect(page.locator('.portal-admin-subnav-item').first()).toBeVisible();
    await f.releaseAccess(status);
    if (status === 403)
      await expect(
        page.getByRole('heading', { name: 'Нет административного доступа', exact: true }),
      ).toBeVisible();
    else await expect(page.locator('.portal-admin-subnav-item')).toHaveCount(0);
    await expect(page.locator('.admin-chart-card')).toHaveCount(0);
  });
}

test('late old-account grants never populate a new canonical identity', async ({ page }) => {
  const f = await fixture(page);
  await page.goto('/#/admin');
  await expect(learning(page)).toBeVisible();
  f.holdAccess(true);
  await page.evaluate(() => {
    window.location.hash = '/admin/users';
  });
  await expect.poll(() => f.pendingAccess()).toBe(1);
  f.account(OTHER);
  await page.evaluate(() => window.dispatchEvent(new Event('asa-account-verification-required')));
  await expect.poll(() => f.pendingAccess()).toBe(2);
  await expect(page.locator('.portal-admin-subnav-item')).toHaveCount(0);
  await f.releaseAccess();
  await expect(page.locator('.portal-admin-subnav-item')).toHaveCount(0);
  f.holdAccess(false);
  await f.releaseAccess();
  await expect(page.locator('.portal-admin-subnav-item').first()).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '/admin';
  });
  await expect(learning(page)).toBeVisible();
  await expect(page.locator('.admin-dashboard-kpis strong').first()).toHaveText('42');
});

test('scope change discards old refresh data and ignores its late dashboard response', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto('/#/admin');
  await expect(learning(page)).toBeVisible();
  f.holdDashboard(true);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect.poll(() => f.pendingDashboard()).toBe(1);
  await page.getByRole('combobox', { name: 'Область управления' }).selectOption({ index: 1 });
  await expect.poll(() => f.pendingDashboard()).toBe(2);
  await expect(learning(page)).toHaveCount(0);
  await f.releaseDashboard();
  await expect(learning(page)).toHaveCount(0);
  await f.releaseDashboard();
  await expect(learning(page)).toBeVisible();
  await expect(page.locator('.admin-dashboard-kpis strong').first()).toHaveText('42');
});

for (const width of [1440, 1024, 390, 320]) {
  test(`unified users catalog typed rows server filters pagination and layout at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    f.catalog(true);
    await page.goto('/#/admin/users');
    const account = page.locator('[data-actor-key="account:20000000-0000-4000-8000-000000000002"]');
    const student = page.locator('[data-actor-key="student:20000000-0000-4000-8000-000000000002"]');
    await expect(account).toBeVisible();
    await expect(student).toBeVisible();
    await expect(student.getByRole('button')).toHaveCount(0);
    await expect(student).toContainText('Выдано');
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/users-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await expect(page.getByText('Показано записей: 3.', { exact: false })).toBeVisible();
    expect(f.catalogQueries().at(-1)!.get('cursor')).toBe('fixture-next');
    await page.getByRole('combobox', { name: 'Сортировка', exact: true }).selectOption('name');
    await expect.poll(() => f.catalogQueries().at(-1)!.get('sort')).toBe('name');
    expect(f.catalogQueries().at(-1)!.has('cursor')).toBe(false);
    await account.locator('button.admin-user-row').click();
    await expect(account.getByRole('tab', { name: 'Управление', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Тип записи', exact: true }).selectOption('students');
    await expect(account).toHaveCount(0);
    await expect(student).toBeVisible();
    await page.getByRole('combobox', { name: 'Область управления' }).selectOption({ index: 1 });
    await expect(page.getByRole('status')).toContainText(
      'связь классов с организацией не подтверждена',
    );
    await expect(
      page.getByText('Каталог ученических мест в этой области недоступен', { exact: true }),
    ).toBeVisible();
    await expect(student).toHaveCount(0);
    await noPageOverflow(page);
  });
}
