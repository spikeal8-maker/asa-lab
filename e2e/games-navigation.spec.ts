import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { createEmptyChessDocument } from '@asa-lab/chess';
import { createInitialCheckersProjectDocument } from '@asa-lab/checkers';

const user = { id: 'games-test-user', displayName: 'Игрок', email: 'games@example.test' };
const session = {
  authenticated: true,
  user,
  account: user,
  capabilities: [],
  workspaces: [
    {
      workspaceId: 'games-test-workspace',
      kind: 'personal',
      title: 'Личный кабинет',
      role: 'owner',
    },
  ],
  activeWorkspace: { workspaceId: 'games-test-workspace', kind: 'personal' },
  navigation: { classes: true, classroomManagement: false },
  timeZone: 'Europe/Moscow',
};
const modules = ['electronics', 'three-d', 'chess', 'checkers'].map((moduleKey) => ({
  moduleKey,
  moduleVersion: '0.1.0',
  displayName: (
    { electronics: 'Электроника', 'three-d': '3D', chess: 'Шахматы', checkers: 'Шашки' } as Record<
      string,
      string
    >
  )[moduleKey],
  shortDescription: moduleKey,
  defaultProjectTitlePrefix: 'Проект',
  projectType: moduleKey,
  schemaVersion: 1,
  editorRoute: '',
  viewerRoute: '',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'board',
  iconKey: moduleKey,
  categories: [],
  creatable: true,
}));

function savedGame(id: string, moduleKey: string) {
  return {
    id,
    moduleKey,
    title: moduleKey === 'chess' ? 'Шахматы' : 'Шашки',
    scope: 'personal',
    classroomId: null,
    status: 'active',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    preview: null,
    snapshotRevision: null,
    copiedFrom: null,
  };
}

async function fixture(page: Page, failList = false) {
  const saves = [savedGame('old-chess', 'chess'), savedGame('old-checkers', 'checkers')];
  const documents: Record<string, unknown> = {
    'old-chess': createEmptyChessDocument('analysis'),
    'old-checkers': createInitialCheckersProjectDocument(),
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let creations = 0;
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/auth/me') return json(route, session);
    if (path === '/api/auth/max/status')
      return json(route, { linked: false, available: false, promptDue: false });
    if (path === '/api/admin/v1/me')
      return json(route, { error: { code: 'forbidden', message: 'forbidden' } }, 403);
    if (path === '/api/account/avatar') return json(route, { avatarDataUrl: null });
    if (path === '/api/modules') return json(route, { items: modules });
    if (path === '/api/gallery/mine') return json(route, { projectIds: [] });
    if (path === '/api/projects/title-suggestion')
      return json(route, { title: 'Новый проект', sequence: 1 });
    if (path === '/api/projects' && method === 'GET')
      return json(
        route,
        failList ? { error: { code: 'unavailable', message: 'unavailable' } } : { items: saves },
        failList ? 503 : 200,
      );
    if (path === '/api/projects' && method === 'POST') {
      creations++;
      const input = route.request().postDataJSON() as { module: string };
      const project = savedGame(`new-${input.module}`, input.module);
      saves.push(project);
      documents[project.id] =
        input.module === 'chess'
          ? createEmptyChessDocument('analysis')
          : createInitialCheckersProjectDocument();
      return json(route, { project, created: true }, 201);
    }
    const open = /^\/api\/projects\/([^/]+)$/.exec(path);
    if (open) {
      const project = saves.find((item) => item.id === open[1]);
      return json(route, {
        project,
        draft: {
          projectId: project?.id,
          document: documents[open[1]!],
          revision: 0,
          updatedAt: null,
        },
        versions: [],
        result: null,
      });
    }
    if (path.startsWith('/api/analytics/')) return json(route, { accepted: true });
    return json(route, { items: [], total: 0 });
  });
  return { saves, errors, creations: () => creations };
}

test('Games has two large cards and games disappear from project shelves and creation', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/games');
  await expect(page.getByRole('button', { name: 'Игры', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.game-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Играть: Шахматы', exact: true })).toBeEnabled();
  const bounds = await page.locator('.game-card').evaluateAll((cards) =>
    cards.map((card) => {
      const { x, y, width } = card.getBoundingClientRect();
      return { x, y, width };
    }),
  );
  expect(bounds[0]!.width).toBeGreaterThan(350);
  expect(bounds[0]!.y).toEqual(bounds[1]!.y);
  mkdirSync('reports/games', { recursive: true });
  await page.screenshot({ path: 'reports/games/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.game-card')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobile = await page
    .locator('.game-card')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().y));
  expect(mobile[1]).toBeGreaterThan(mobile[0]!);
  await page.screenshot({ path: 'reports/games/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('.portal-nav-item')
    .filter({ hasText: /^Проекты$/ })
    .click();
  await expect(page.locator('.project-card:not(.is-new)')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Шахматы');
  await expect(page.locator('main')).not.toContainText('Шашки');
  await page
    .locator('.portal-nav-item')
    .filter({ hasText: /^Главная$/ })
    .click();
  await expect(page.locator('.creator-home')).not.toContainText('Шахматы');
  await expect(page.locator('.creator-home')).not.toContainText('Шашки');
  await page
    .getByRole('button', { name: /^Создать(?: проект)?$/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('Шахматы');
  await expect(page.getByRole('dialog')).not.toContainText('Шашки');
  expect(state.errors).toEqual([]);
});

test('both games launch, reload and return to Games without duplicate saves', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к играм', exact: true }).click();
  await expect(page).toHaveURL(/#\/games$/);
  await page.getByRole('button', { name: 'Играть: Шашки', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Вернуться к играм ASA Lab', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Вернуться к играм ASA Lab', exact: true }).click();
  await expect(page).toHaveURL(/#\/games$/);
  expect(state.creations()).toBe(0);
  expect(state.errors).toEqual([]);
});

test('first launch creates one save and subsequent launch resumes it', async ({ page }) => {
  const state = await fixture(page);
  state.saves.splice(0);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к играм', exact: true }).click();
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
  expect(state.creations()).toBe(1);
  expect(state.errors).toEqual([]);
});

test('an unavailable save list shows an error and does not create a duplicate', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить игры');
  await expect(page.getByRole('button', { name: 'Играть: Шахматы', exact: true })).toBeEnabled();
  expect(state.creations()).toBe(0);
});

test('an unavailable catalogue can be retried without a stuck loading screen', async ({ page }) => {
  const state = await fixture(page);
  await page.route('**/api/modules', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'unavailable', message: 'unavailable' } }),
    }),
  );
  await page.goto('/#/games');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить игры');
  await expect(page.locator('.game-card')).not.toContainText(['Загрузка…', 'Загрузка…']);
  await page.unroute('**/api/modules');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Играть: Шахматы', exact: true })).toBeEnabled();
  expect(state.creations()).toBe(0);
  expect(state.errors).toEqual([]);
});
