import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { adminDashboardFixture } from '../apps/web/src/admin/testing/admin-dashboard.fixture';
import { crmProfileFixture } from '../apps/web/src/admin/testing/crm-user.fixture';
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
  let directoryMode = false,
    bound = false;
  const exportQueries: URLSearchParams[] = [];
  let crmConflict = false;
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
    if (path.startsWith('/api/crm/v1/responsibilities/')) {
      const [, , , , , kind, scope, target] = path.split('/');
      return reply({
        kind,
        scopeId: scope,
        targetId: target,
        role: 'member',
        state: route.request().method() === 'PUT' ? route.request().postDataJSON().state : 'active',
        version: 'a'.repeat(64),
        allowedRoles: kind === 'classroom' ? ['co_teacher'] : ['member', 'educator'],
      });
    }
    if (path.startsWith('/api/crm/v1/users/')) {
      const kind = path.includes('/student/') ? 'student' : 'account';
      if (path.endsWith('/email') || path.endsWith('/email/cancel'))
        return reply({
          accountId: OTHER,
          email: 'profile@example.test',
          verified: true,
          pending: {
            id: WORKSPACE,
            email: 'new.long.pending.email.for.layout.review@example.test',
            purpose: 'change',
            state: path.endsWith('/cancel') ? 'cancelled' : 'sent',
            expiresAt: '2030-01-01T12:00:00Z',
            createdAt: '2026-10-25T10:00:00Z',
          },
        });

      if (path.endsWith('/detail') || path.endsWith('/notes')) {
        const category = url.searchParams.get('category');
        const notes = category === 'notes' || path.endsWith('/notes');
        const next = url.searchParams.has('cursor');
        return reply({
          items: notes
            ? [
                {
                  id: OTHER,
                  key: `note:${OTHER}`,
                  text: 'Сохранённая учебная заметка',
                  occurredAt: '2026-10-25T10:00:00Z',
                },
              ]
            : category === 'ai'
              ? [
                  {
                    id: next ? ACCOUNT : OTHER,
                    key: `ai:${next ? ACCOUNT : OTHER}`,
                    type: 'ai',
                    status: 'failed',
                    model: null,
                    inputTokens: null,
                    outputTokens: null,
                    errorCode: 'ai_ollama_timeout',
                    occurredAt: '2026-10-25T10:00:00Z',
                  },
                ]
              : category === 'publications'
                ? [
                    {
                      id: OTHER,
                      key: `publication:${OTHER}`,
                      type: 'publication',
                      title: 'Сохранённая публикация ученика',
                      projectId: OTHER,
                      revision: 2,
                      occurredAt: '2026-10-25T10:00:00Z',
                    },
                  ]
                : [
                    {
                      id: OTHER,
                      key: `version:${OTHER}`,
                      type: 'version',
                      title: 'Сохранённая работа ученика',
                      projectId: OTHER,
                      revision: 2,
                      occurredAt: '2026-10-25T10:00:00Z',
                    },
                  ],
          next: category === 'ai' && !next ? 'seat-ai-next' : null,
          canWrite: notes,
          version: 'a'.repeat(64),
        });
      }
      if (path.endsWith('/profile'))
        return crmConflict
          ? reply(
              {
                error: {
                  code: 'crm_conflict',
                  message: 'Данные уже изменились. Обновите карточку.',
                },
              },
              409,
            )
          : reply({
              ...crmProfileFixture(kind),
              ...route.request().postDataJSON(),
              version: 'b'.repeat(64),
            });
      if (path.endsWith('/content')) {
        const category = url.searchParams.get('category'),
          next = url.searchParams.has('cursor');
        return reply({
          items:
            category === 'messages'
              ? [
                  {
                    id: next ? 'message-two' : 'message-one',
                    threadId: '20000000-0000-4000-8000-000000000005',
                    requestId: '20000000-0000-4000-8000-000000000006',
                    role: next ? 'assistant' : 'user',
                    text: next
                      ? 'Полный ответ искусственного интеллекта'
                      : 'Очень длинный вопрос ученика: <script>window.__crmInjected = true</script>',
                    state: 'complete',
                    occurredAt: '2026-10-25T10:00:00Z',
                  },
                ]
              : category === 'projects'
                ? [
                    {
                      id: '20000000-0000-4000-8000-000000000003',
                      title: 'Полная учебная работа по электронике',
                      module: 'electronics',
                      status: 'active',
                      occurredAt: '2026-10-25T10:00:00Z',
                    },
                  ]
                : [],
          next: category === 'messages' && !next ? 'crm-next' : null,
        });
      }
      if (path.includes('/projects/'))
        return reply({
          projectId: '20000000-0000-4000-8000-000000000003',
          title: 'Полная учебная работа по электронике',
          module: 'electronics',
          revision: 3,
          source: url.searchParams.has('versionId') ? 'saved_version' : 'draft',
          updatedAt: '2026-10-25T10:00:00Z',
          document: { circuit: 'Полное сохранённое содержимое' },
        });
      return reply(
        url.searchParams.has('classroomId')
          ? {
              ...crmProfileFixture(kind),
              canEdit: false,
              canManageCapabilities: false,
              linkedIdentities: [],
            }
          : crmProfileFixture(kind),
      );
    }
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
    if (/^\/api\/admin\/v1\/users\/(account|student)\/[^/]+\/history$/.test(path)) {
      const category = url.searchParams.get('category');
      const next = url.searchParams.has('cursor');
      return reply({
        coverage: 'retained',
        asOf: '2026-10-25T12:00:00.123456Z',
        next: next ? null : 'history-next',
        items: [
          {
            key: `${category}:${next ? 'second' : 'first'}`,
            id: next ? 'second' : 'first',
            occurredAt: '2026-10-24T12:00:00.000001Z',
            type:
              category === 'ai' ? 'ai' : category === 'publications' ? 'publication' : 'version',
            title:
              category === 'ai'
                ? null
                : 'Очень длинное название сохранённой учебной работы по электронике и программированию',
            projectId: '20000000-0000-4000-8000-000000000003',
            module: 'electronics',
            revision: 3,
            provider: 'ollama',
            requestedModel: 'long-model-name-for-responsive-layout:latest',
            model: null,
            inputTokens: null,
            outputTokens: '0',
            status: 'failed',
            errorCode: 'ai_ollama_timeout',
            durationMs: '15000',
          },
        ],
      });
    }
    if (path === '/api/admin/v1/users-export') {
      exportQueries.push(url.searchParams);
      return reply({
        count: 61,
        csv:
          '\uFEFF"Тип записи";"Имя"\r\n' +
          Array.from({ length: 61 }, (_, i) => `"Ученическое место";"Строка ${i}"`).join('\r\n'),
      });
    }
    if (path === '/api/admin/v1/users-filter-options')
      return reply({
        classes: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            title: 'Очень длинное название учебного класса для фильтрации',
          },
        ],
        organizations: [{ id: SCHOOL, title: 'Организация цифровых лабораторий' }],
      });
    if (path === '/api/admin/v1/organization-class-bindings') {
      if (route.request().method() === 'PUT') {
        bound = !!route.request().postDataJSON().workspaceId;
        return reply({ ok: true });
      }
      return reply({
        classes: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            title: 'Учебный класс цифровой лаборатории',
            workspaceId: bound ? SCHOOL : null,
          },
        ],
        organizations: [{ id: SCHOOL, title: 'Организация цифровых лабораторий' }],
      });
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
        : [accountUser, ...(organization && !(directoryMode && bound) ? [] : [student])];
      const kind = url.searchParams.get('kind');
      if (kind === 'accounts') items = items.filter((item) => item.kind === 'account');
      if (kind === 'students') items = items.filter((item) => item.kind === 'student');
      if (url.searchParams.get('status') === 'inactive') items = [];
      const search = url.searchParams.get('search')?.toLowerCase();
      if (search) items = items.filter((item) => item.displayName.toLowerCase().includes(search));
      const catalog = catalogPageFixture(
        items,
        url.searchParams.has('cursor') || kind !== 'all' || organization || search
          ? null
          : 'fixture-next',
        organization && !directoryMode,
      );
      return reply(
        directoryMode
          ? {
              ...catalog,
              matchedCount: 61,
              items: catalog.items.map((item) => ({
                ...item,
                acquisitionLatest: {
                  source: 'school',
                  medium: 'email',
                  campaign: 'autumn-2026',
                  observedAt: '2026-10-25T10:00:00Z',
                },
              })),
              analytics: {
                accounts: 31,
                students: 30,
                linkedRecords: 2,
                ageUnknown: 30,
                emailAbsent: 30,
                sourceUnknown: 60,
                activeObserved: 12,
                aiRequests: 4,
                aiTokenCovered: 2,
                aiInputTokens: '90071992547409931234567890',
                aiOutputTokens: null,
                periodDays: Number(url.searchParams.get('days') ?? 30),
                roles: { learner: 30, creator: 10 },
                referrers: { unknown: 60, 'https://example.test': 1 },
                tools: { electronics: 12 },
                devices: { desktop: 12, unknown: 49 },
                ageGroups: { unknown: 30, '18–34': 31 },
                loginMethods: { password: 12 },
                registrationMethods: { password: 3, max: 1 },
                acquisition: {
                  retentionDays: 90,
                  status: 'collecting_current_document',
                  observedRecords: 2,
                  unknownRecords: 59,
                  observations: 2,
                  sources: { school: 2 },
                  mediums: { email: 2 },
                  campaigns: { 'autumn-2026': 2 },
                },
                daily: Array.from(
                  { length: Number(url.searchParams.get('days') ?? 30) },
                  (_, i) => ({
                    date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
                    events: i,
                    registrations: 1,
                  }),
                ),
              },
            }
          : catalog,
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
    directory: () => {
      directoryMode = true;
      catalogMode = true;
    },
    exportQueries: () => exportQueries,
    catalog: (value: boolean) => {
      catalogMode = value;
    },
    catalogQueries: () => catalogQueries,
    crmConflict: (value: boolean) => {
      crmConflict = value;
    },
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

for (const width of [1440, 1024, 390, 320]) {
  test(`full CRM profile actual AI transcript and project reader at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    f.catalog(true);
    await page.goto('/#/admin/users');
    const account = page.locator('[data-actor-key="account:20000000-0000-4000-8000-000000000002"]');
    await account.locator('button.admin-user-row').click();
    await account.getByRole('tab', { name: 'Профиль', exact: true }).click();
    const card = account.getByRole('region', { name: 'Полная карточка пользователя', exact: true });
    await expect(card.getByRole('textbox', { name: 'Имя', exact: true })).toHaveValue(/Полное имя/);
    await expect(card.getByText('36 лет', { exact: true })).toBeVisible();
    await expect(account.getByRole('tab')).toHaveCount(7);
    await expect(card.getByRole('navigation', { name: 'Разделы CRM' })).toHaveCount(0);
    await card
      .getByRole('textbox', { name: 'Имя', exact: true })
      .fill('Изменённое полное имя пользователя');
    await card
      .getByRole('textbox', { name: 'Причина изменения', exact: true })
      .fill('Обращение пользователя');
    f.crmConflict(true);
    await card.getByRole('button', { name: 'Сохранить профиль', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('Данные уже изменились');
    await expect(card.getByRole('textbox', { name: 'Имя', exact: true })).toHaveValue(
      'Изменённое полное имя пользователя',
    );
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/crm-profile-${width}.png`, fullPage: true });
    await account.getByRole('tab', { name: 'Безопасность и доступ', exact: true }).click();
    await expect(
      account.getByRole('button', { name: 'Назначить администратором', exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole('region', { name: 'Смена электронной почты', exact: true }),
    ).toContainText('Ожидает подтверждения: new.long.pending.email.for.layout.review@example.test');
    await expect(
      card.getByRole('region', { name: 'Смена электронной почты', exact: true }),
    ).toContainText('Текущий адрес: profile@example.test');
    const responsibilities = account.getByRole('region', {
      name: 'Роли в организациях и классах',
      exact: true,
    });
    await responsibilities
      .getByRole('textbox', { name: 'Поиск организации или класса по названию', exact: true })
      .fill('Организация цифровых лабораторий');
    await responsibilities.getByRole('button', { name: 'Найти по названию', exact: true }).click();
    await responsibilities
      .getByRole('combobox', { name: 'Название области', exact: true })
      .selectOption(SCHOOL);
    await responsibilities.getByRole('button', { name: 'Загрузить доступ', exact: true }).click();
    await responsibilities
      .getByRole('combobox', { name: 'Роль', exact: true })
      .selectOption('educator');
    await responsibilities
      .getByRole('textbox', { name: 'Причина изменения', exact: true })
      .fill('Назначение ответственности');
    await responsibilities.getByRole('button', { name: 'Назначить', exact: true }).click();
    await expect(responsibilities.getByRole('status')).toContainText('Доступ сохранён');
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/crm-access-${width}.png`, fullPage: true });
    await account.getByRole('tab', { name: 'Переписка с ИИ', exact: true }).click();
    await expect(
      account.getByText('Очень длинный вопрос ученика:', { exact: false }),
    ).toBeVisible();
    await account.getByRole('button', { name: 'Ещё записи', exact: true }).click();
    await expect(
      account.getByText('Полный ответ искусственного интеллекта', { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => '__crmInjected' in window)).toBe(false);
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/crm-transcript-${width}.png`, fullPage: true });
    await account.getByRole('tab', { name: 'Проекты', exact: true }).click();
    await account.getByRole('button', { name: 'Просмотр проекта', exact: true }).click();
    await account.getByText('Полные данные проекта — только просмотр', { exact: true }).click();
    await expect(account.locator('pre')).toContainText('Полное сохранённое содержимое');
    await account.getByRole('tab', { name: 'Входы и действия', exact: true }).click();
    await expect(
      account.getByRole('heading', { name: 'Все входы и устройства', exact: true }),
    ).toBeVisible();
    await expect(account.getByRole('heading', { name: 'Все действия', exact: true })).toBeVisible();
    await noPageOverflow(page);
    await account.getByRole('tab', { name: 'Заметки', exact: true }).click();
    await expect(account.getByPlaceholder('Добавить внутренний комментарий')).toBeVisible();
    await noPageOverflow(page);
    const student = page.locator('[data-actor-key="student:20000000-0000-4000-8000-000000000002"]');
    await student
      .getByRole('button', { name: 'Полная карточка пользователя', exact: true })
      .click();
    await expect(
      student
        .getByRole('region', { name: 'Полная карточка пользователя', exact: true })
        .getByText('11 лет', { exact: true }),
    ).toBeVisible();
    await student.getByRole('button', { name: 'Заметки', exact: true }).click();
    await expect(
      student.getByRole('region', { name: 'Учебные заметки', exact: true }),
    ).toContainText('Сохранённая учебная заметка');
    await student
      .getByRole('textbox', { name: 'Новая учебная заметка', exact: true })
      .fill('Проверенная учебная заметка');
    await student
      .getByRole('textbox', { name: 'Причина добавления', exact: true })
      .fill('Учебное наблюдение');
    await student.getByRole('button', { name: 'Добавить заметку', exact: true }).click();
    await student.getByRole('button', { name: 'Публикации и история', exact: true }).click();
    await expect(student.getByText('Сохранённая работа ученика', { exact: false })).toBeVisible();
    await student.getByRole('button', { name: 'Просмотр сохранённой версии', exact: true }).click();
    await expect(
      student.getByRole('button', { name: 'Скачать документ JSON', exact: true }),
    ).toBeVisible();
    await expect(student.locator('details[open]')).toHaveCount(0);
    await noPageOverflow(page);
    await student.getByRole('button', { name: 'Безопасность и доступ', exact: true }).click();
    await expect(
      student.getByRole('button', { name: 'Приостановить доступ ученика', exact: true }),
    ).toBeDisabled();
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/crm-seat-access-${width}.png`, fullPage: true });
    await student.getByRole('button', { name: 'Входы и действия', exact: true }).click();
    await expect(
      student.getByRole('heading', { name: 'Все входы и устройства', exact: true }),
    ).toBeVisible();
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
    await expect(student.getByRole('button')).toHaveCount(1);
    await expect(student).toContainText('Выдано');
    await noPageOverflow(page);
    await student
      .getByRole('button', { name: 'Полная карточка пользователя', exact: true })
      .click();
    await student.getByRole('button', { name: 'Публикации и история', exact: true }).click();
    const history = student.getByRole('region', { name: 'Сохранённая история ученика' });
    await expect(history.getByText('Сохранённая версия', { exact: false })).toBeVisible();
    await history.getByRole('button', { name: 'Публикации', exact: true }).click();
    await expect(history.getByText('Версия публикации', { exact: false })).toBeVisible();
    const aiRead = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === `/api/crm/v1/users/student/${OTHER}/detail` &&
        url.searchParams.get('category') === 'ai' &&
        url.searchParams.get('classroomId') === SCHOOL
      );
    });
    await history.getByRole('button', { name: 'Использование ИИ', exact: true }).click();
    await aiRead;
    await expect(history.getByText('вход: неизвестно', { exact: false })).toBeVisible();
    await expect(history.getByText('ai_ollama_timeout', { exact: false })).toBeVisible();
    await history.getByRole('button', { name: 'Показать ещё', exact: true }).click();
    await expect(history.getByRole('listitem')).toHaveCount(2);
    await expect(history.getByRole('button', { name: 'Показать ещё', exact: true })).toHaveCount(0);
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
    await expect(
      account.getByRole('tab', { name: 'Безопасность и доступ', exact: true }),
    ).toBeVisible();
    await account.getByRole('tab', { name: 'Публикации и история', exact: true }).click();
    await expect(
      account
        .getByRole('region', { name: 'История пользователя' })
        .getByText('Сохранённая версия', { exact: false }),
    ).toBeVisible();
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/account-history-${width}.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Тип записи', exact: true }).selectOption('students');
    await expect(account).toHaveCount(0);
    await expect(student).toBeVisible();
    await page.getByRole('combobox', { name: 'Область управления' }).selectOption({ index: 1 });
    await expect(page.getByRole('status')).toContainText(
      'связь классов с организацией не подтверждена',
    );
    await expect(page.getByRole('combobox', { name: 'Тип записи', exact: true })).toHaveValue(
      'all',
    );
    await expect(account).toBeVisible();
    await expect(student).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Тип записи', exact: true }).selectOption('students');
    await expect(
      page.getByText('Каталог ученических мест в этой области недоступен', { exact: true }),
    ).toBeVisible();
    await expect(account).toHaveCount(0);
    await expect(student).toHaveCount(0);
    await noPageOverflow(page);
  });
}

for (const width of [1440, 1024, 390, 320]) {
  test(`CRM filtered analytics full CSV and explicit organization binding at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page);
    f.directory();
    await page.goto('/#/admin/users');
    await expect(page.getByText('Найдено записей: 61.', { exact: false })).toBeVisible();
    await page.getByText('Дополнительные фильтры', { exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Возможность или роль', exact: true })
      .selectOption('learner');
    await expect.poll(() => f.catalogQueries().at(-1)?.get('role')).toBe('learner');
    await page.getByRole('combobox', { name: 'Возраст', exact: true }).selectOption('unknown');
    await expect.poll(() => f.catalogQueries().at(-1)?.get('age')).toBe('unknown');
    await page.getByRole('button', { name: 'Найти значения фильтра', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Класс', exact: true })
      .selectOption('40000000-0000-4000-8000-000000000001');
    await expect
      .poll(() => f.catalogQueries().at(-1)?.get('classId'))
      .toBe('40000000-0000-4000-8000-000000000001');
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать все результаты (CSV)', exact: true }).click();
    const download = await ready;
    const file = await download.path();
    expect(file).not.toBeNull();
    const csv = readFileSync(file!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Строка 60');
    expect(csv.split('\r\n')).toHaveLength(62);
    expect(f.exportQueries().at(-1)?.get('classId')).toBe('40000000-0000-4000-8000-000000000001');
    const analytics = page.getByRole('region', {
      name: 'Аналитика выбранных записей',
      exact: true,
    });
    // A named section without an explicit role is exposed as a region.
    await expect(analytics).toBeVisible();
    await expect(analytics).toContainText('это не число уникальных людей');
    const events = analytics.getByRole('group', {
      name: 'Сохранённые события по дням UTC',
      exact: true,
    });
    const records = analytics.getByRole('group', {
      name: 'Создано аккаунтов и ученических мест по дням UTC',
      exact: true,
    });
    await expect(events).toBeVisible();
    await expect(records).toBeVisible();
    await expect(events.locator('circle')).toHaveCount(30);
    await page
      .getByRole('combobox', { name: 'Период событий и ИИ', exact: true })
      .selectOption('90');
    await expect(events.locator('circle')).toHaveCount(90);
    await expect(records.locator('circle')).toHaveCount(90);
    await events.locator('circle').nth(10).focus();
    await expect(analytics.locator('.crm-analytics-chart-value').last()).toContainText('UTC: 10');
    await page.keyboard.press('Tab');
    await expect(analytics.locator('.crm-analytics-chart-value').last()).toContainText('UTC: 11');
    await page
      .getByRole('combobox', { name: 'Период событий и ИИ', exact: true })
      .selectOption('7');
    await expect(events.locator('circle')).toHaveCount(7);
    await page
      .getByRole('combobox', { name: 'Период событий и ИИ', exact: true })
      .selectOption('30');
    await expect(events.locator('circle')).toHaveCount(30);
    await analytics.getByText('Наблюдения источников и кампаний', { exact: true }).click();
    await expect(analytics).toContainText('Хранение: 90 дней');
    await expect(
      page.getByText('Метки браузера за 90 дней:', { exact: false }).first(),
    ).toBeVisible();
    await noPageOverflow(page);
    await page.screenshot({ path: `${evidence}/crm-directory-${width}.png`, fullPage: true });
    await page.getByText('Связь классов с организациями', { exact: true }).click();
    await page.getByRole('button', { name: 'Найти классы и организации', exact: true }).click();
    const manager = page.locator('.crm-directory-bindings');
    await manager
      .getByRole('combobox', { name: 'Класс', exact: true })
      .selectOption('40000000-0000-4000-8000-000000000001');
    await manager
      .getByRole('combobox', { name: 'Организация класса', exact: true })
      .selectOption(SCHOOL);
    await manager
      .getByRole('textbox', { name: 'Причина изменения', exact: true })
      .fill('Явное поручение владельца организации');
    await manager.getByRole('button', { name: 'Сохранить привязку', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('Привязка сохранена');
    await noPageOverflow(page);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `${evidence}/crm-binding-${width}.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Область управления' }).selectOption({ index: 1 });
    const student = page.locator('[data-actor-key="student:20000000-0000-4000-8000-000000000002"]');
    await expect(student).toBeVisible();
    await expect(
      student.getByRole('button', { name: 'История проектов, публикаций и ИИ' }),
    ).toHaveCount(0);
    await student
      .getByRole('button', { name: 'Полная карточка пользователя', exact: true })
      .click();
    await expect(student.locator('.crm-full-card')).toBeVisible();
    await expect(student.getByRole('textbox', { name: 'Имя', exact: true })).toBeDisabled();
    await expect(
      student.getByRole('button', { name: 'Публикации и история', exact: true }),
    ).toBeVisible();
    await student.getByRole('button', { name: 'Безопасность и доступ', exact: true }).click();
    await expect(
      student.getByRole('button', { name: 'Приостановить доступ ученика', exact: true }),
    ).toHaveCount(0);
    await expect(
      student.getByText('Изменение доступа недоступно.', { exact: false }),
    ).toBeVisible();
    await noPageOverflow(page);
  });
}

test('catalog CSV cancellation blocks a late download', async ({ page }) => {
  const f = await fixture(page);
  f.catalog(true);
  let finish!: () => Promise<void>;
  await page.route('**/api/admin/v1/users-export?*', async (route) => {
    await new Promise<void>((resolve) => {
      finish = async () => {
        resolve();
      };
    });
    await route.fulfill({ json: { csv: 'late', count: 1 } }).catch(() => {});
  });
  await page.goto('/#/admin/users');
  await page.getByRole('button', { name: 'Скачать все результаты (CSV)', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить выгрузку', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Скачать все результаты (CSV)', exact: true }),
  ).toBeEnabled();
  let downloads = 0;
  page.on('download', () => {
    downloads++;
  });
  await expect.poll(() => typeof finish).toBe('function');
  await finish();
  await expect(page.getByText('CSV: до 10 000 записей', { exact: false })).toBeVisible();
  expect(downloads).toBe(0);
});
