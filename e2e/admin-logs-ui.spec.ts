import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const evidence = 'e2e/artifacts/owner-preview/access-a-ui/admin-logs';
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));

async function fixture(
  page: Page,
  state: 'populated' | 'empty' | 'error' | 'loading' | 'unavailable',
) {
  const dist = resolve('apps/web/dist');
  const accountId = '20000000-0000-4000-8000-000000000001';
  const workspaceId = '10000000-0000-4000-8000-000000000001';
  let failed = state === 'error';
  let exports = 0;
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
    const path = url.pathname;
    const reply = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === '/api/auth/me')
      return reply({
        authenticated: true,
        user: { id: accountId, email: 'admin@example.test', displayName: 'Администратор' },
        account: { id: accountId, email: 'admin@example.test', displayName: 'Администратор' },
        capabilities: [
          { capability: 'creator', state: 'verified' },
          { capability: 'platform_admin', state: 'verified' },
        ],
        workspaces: [
          { workspaceId, kind: 'personal', title: 'Личное пространство', role: 'owner' },
        ],
        activeWorkspace: { workspaceId, kind: 'personal' },
        navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/class-join/me') return reply({ authenticated: false });
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/admin/v1/me')
      return reply({
        administrator: true,
        principalId: 'admin-1',
        accountId,
        displayName: 'Администратор',
        activeWorkspaceId: workspaceId,
        scopes: [
          {
            kind: 'platform',
            id: null,
            title: 'ASA Lab',
            role: 'platform_admin',
            permissions: ['administration.open', 'administration.operations.read'],
          },
        ],
      });
    if (path === '/api/admin/v1/logs/status')
      return reply({
        state: state === 'unavailable' ? 'unavailable' : 'ok',
        collectedAt: new Date().toISOString(),
        retentionDays: 30,
        bytes: 2048,
        first: '2026-10-01T00:00:00.000Z',
        last: '2026-10-07T10:00:00.000Z',
        trimmed: false,
        eventSources: ['api', 'scratch', 'windows:Application'],
        sources: [
          {
            source: 'api',
            state: 'ok',
            detail: '',
            lastCollectedAt: new Date().toISOString(),
            collectedThrough: new Date().toISOString(),
          },
          {
            source: 'windows:Security',
            state: 'unavailable',
            detail: 'Access denied',
            lastCollectedAt: null,
            collectedThrough: null,
          },
        ],
      });
    if (path === '/api/admin/v1/logs') {
      if (state === 'loading') return; // Deliberately unresolved response; page close releases it.
      if (failed) return reply({ error: { code: 'unavailable', message: 'offline' } }, 503);
      return reply({
        items: ['empty', 'unavailable'].includes(state)
          ? []
          : [
              {
                id: 'a'.repeat(64),
                time: '2026-10-07T10:00:00.000Z',
                source: 'scratch',
                module: 'scratch',
                level: 'error',
                message: `Ошибка запуска редактора. ${'ОченьДлинноеСообщение'.repeat(60)}\n token=[redacted]`,
                requestId: null,
                revision: 'abcdef0',
                origin: 'scratch.log',
                truncated: true,
              },
            ],
        next: null,
        partial: false,
      });
    }
    if (path === '/api/admin/v1/logs/exports') {
      exports += 1;
      return reply({ id: 'export-1', state: 'running', count: null, bytes: null, error: null });
    }
    if (path === '/api/admin/v1/logs/exports/export-1')
      return reply({ id: 'export-1', state: 'ready', count: 1, bytes: 1024, error: null });
    return reply({ items: [], unread: 0 });
  });
  await page.goto('/#/admin/logs');
  return {
    recover: () => {
      failed = false;
    },
    exports: () => exports,
  };
}

for (const width of [1440, 1024, 390, 320]) {
  test(`populated page and long messages fit ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = await fixture(page, 'populated');
    await expect(page.getByRole('heading', { name: 'Админ Логи', exact: true })).toBeVisible();
    await expect(page.locator('.admin-log-entry')).toHaveCount(1);
    await expect(page.getByLabel('Журналы системы')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `${evidence}/logs-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Скачать все журналы', exact: true }).click();
    await expect(page.getByRole('link', { name: /Скачать ZIP/ })).toBeVisible();
    expect(f.exports()).toBe(1);
  });
}

for (const state of ['empty', 'error', 'loading', 'unavailable'] as const) {
  test(`visible ${state} state at 320`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const f = await fixture(page, state);
    await expect(page.getByRole('heading', { name: 'Админ Логи', exact: true })).toBeVisible();
    if (state === 'empty') await expect(page.getByText(/За выбранный период/)).toBeVisible();
    if (state === 'error') {
      await expect(page.getByText(/Не удалось загрузить журналы/)).toBeVisible();
      f.recover();
      await page.getByRole('button', { name: 'Показать', exact: true }).click();
      await expect(page.locator('.admin-log-entry')).toHaveCount(1);
    }
    if (state === 'loading') await expect(page.getByText(/Загружаем журналы/)).toBeVisible();
    if (state === 'unavailable')
      await expect(
        page.getByRole('button', { name: 'Скачать все журналы', exact: true }),
      ).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `${evidence}/logs-${state}-320.png`, fullPage: true });
  });
}
