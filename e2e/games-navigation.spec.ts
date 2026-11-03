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
    if (path === '/api/account/presentation')
      return json(route, { motion: 'system', sidebar: 'expanded', revision: 1 });
    if (/^\/api\/learning\/projects\/[^/]+\/context$/.test(path))
      return json(route, { state: 'not_learning', projectId: path.split('/')[4] });
    if (path === '/api/games/chess/notifications')
      return json(route, { playerId: 'fixture-player', incoming: [] });
    if (path === '/api/games/chess/lobby')
      return json(route, { players: [], incoming: [], outgoing: [], limit: 100 });
    if (path === '/api/account/avatar') return json(route, { avatarDataUrl: null });
    if (path === '/api/modules') return json(route, { items: modules });
    if (path === '/api/games/access')
      return json(route, { granted: true, reason: 'allowed', threshold: null });
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
    const save = /^\/api\/projects\/([^/]+)\/draft$/.exec(path);
    if (save && method === 'PUT') {
      const input = route.request().postDataJSON() as { document: unknown; baseRevision: number };
      documents[save[1]!] = input.document;
      return json(route, {
        draft: {
          projectId: save[1],
          document: input.document,
          revision: input.baseRevision + 1,
          updatedAt: null,
        },
        result: null,
      });
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
  return { saves, documents, errors, creations: () => creations };
}

test('Games has two large cards and games disappear from project shelves and creation', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#/games');
  await expect(page.getByRole('link', { name: 'Игры', exact: true })).toHaveAttribute(
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
    .filter({ hasText: /^Мои проекты$/ })
    .click();
  await expect(page.locator('main.project-hub')).toBeVisible();
  await expect(page.locator('.project-card:not(.is-new)')).toHaveCount(0);
  await expect(page.locator('main.project-hub')).not.toContainText('Шахматы');
  await expect(page.locator('main.project-hub')).not.toContainText('Шашки');
  await page
    .locator('.portal-nav-item')
    .filter({ hasText: /^Главная$/ })
    .click();
  await expect(page.locator('.creator-home')).not.toContainText('Шахматы');
  await expect(page.locator('.creator-home')).not.toContainText('Шашки');
  await page.locator('.portal-header .portal-quick-create > summary').click();
  await expect(page.locator('.portal-header .portal-create-options')).toBeVisible();
  await expect(page.locator('.portal-header .portal-create-options')).not.toContainText('Шахматы');
  await expect(page.locator('.portal-header .portal-create-options')).not.toContainText('Шашки');
  expect(state.errors).toEqual([]);
});

test('both games launch, reload and return to Games without duplicate saves', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к играм', exact: true }).click();
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Шахматы', exact: true })).toBeVisible();
  expect(state.creations()).toBe(1);
  expect(state.errors).toEqual([]);
});

test('an unavailable save list shows an error and does not create a duplicate', async ({
  page,
}) => {
  const state = await fixture(page, true);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.locator('.games-page').getByRole('alert')).toContainText(
    'Не удалось загрузить игры',
  );
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
  await expect(page.locator('.games-page').getByRole('alert')).toContainText(
    'Не удалось загрузить игры',
  );
  await expect(page.locator('.game-card')).not.toContainText(['Загрузка…', 'Загрузка…']);
  await page.unroute('**/api/modules');
  await page.locator('.games-page').getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Играть: Шахматы', exact: true })).toBeEnabled();
  expect(state.creations()).toBe(0);
  expect(state.errors).toEqual([]);
});

test('Chess uses the shared profile header and square board at every layout size', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByTestId('asa-chess-home-position')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть доску', exact: true })).toHaveCount(0);
  mkdirSync('reports/games/chess-redesign', { recursive: true });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.portal-header .portal-user-avatar img')).toBeVisible();
    await page.locator('.portal-account > summary').click();
    await expect(page.getByLabel('Центр аккаунта', { exact: true })).toBeVisible();
    await page.locator('.portal-account > summary').click();
    await expect(
      page.getByRole('button', { name: 'Вернуться к играм', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.asa-chess-home-shell .editor-header')).toHaveCount(0);
    await expect(page.locator('.asa-chess-home-shell nav')).toHaveCount(0);
    const start = await page
      .getByRole('button', { name: 'Играть с компьютером', exact: true })
      .boundingBox();
    expect(start!.y).toBeLessThan(160);
    expect(start!.y + start!.height).toBeLessThan(260);
    const board = page.getByTestId('asa-chess-home-position');
    const bounds = await board.boundingBox();
    expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(1);
    const square = await board
      .locator('button')
      .first()
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          radius: getComputedStyle(node).borderRadius,
        };
      });
    expect(Math.abs(square.width - square.height)).toBeLessThan(1);
    expect(square.radius).toBe('0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `reports/games/chess-redesign/home-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await expect(page.locator('.asa-chess-portal-content')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.asa-chess-portal-content')).not.toHaveAttribute('inert');
  await page.getByRole('button', { name: 'Играть с компьютером', exact: true }).click();
  await page.getByText('Выбрать бота', { exact: true }).click();
  for (const level of ['Начальный', 'Средний', 'Продвинутый']) {
    const choice = page.getByRole('button', { name: new RegExp(level) });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    const visibleProfiles = page.locator('.asa-chess-bot-profile-grid label:visible');
    expect(await visibleProfiles.count()).toBeGreaterThan(0);
    const selected = page.locator('input[name="asa-bot-profile"]:checked');
    await expect(selected).toBeVisible();
    await expect(selected.locator('..')).toHaveClass('selected');
  }
  await page.screenshot({ path: 'reports/games/chess-redesign/bots-320.png', fullPage: true });
  expect(state.errors).toEqual([]);
});

test('Chess entry buttons start the selected mode and preserve it after reload', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть доску', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Двое на одном устройстве', exact: true }).click();
  await expect(page).toHaveURL(/\/local$/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Двое на одном устройстве', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Сложность бота' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click();
  await expect(page).toHaveURL(/\/play\/game$/);
  expect(state.documents['old-chess']).toMatchObject({ mode: 'local', result: '*' });
  const board = page.getByTestId('asa-chess-board');
  for (const square of ['e2', 'e4', 'e7', 'e5'])
    await board.locator(`[data-square="${square}"]`).click();
  await expect
    .poll(() => (state.documents['old-chess'] as { moves: unknown[] }).moves.length)
    .toBe(2);

  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить партию', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Играть с компьютером', exact: true }).click();
  await page.getByRole('button', { name: /Начальный/ }).click();
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click();
  await expect(page).toHaveURL(/\/play\/game$/);
  expect(state.documents['old-chess']).toMatchObject({ mode: 'computer', bot: { level: 1 } });
  await page.getByTestId('asa-chess-board').locator('[data-square="e2"]').click();
  await page.getByTestId('asa-chess-board').locator('[data-square="e4"]').click();
  await expect
    .poll(() => (state.documents['old-chess'] as { moves: unknown[] }).moves.length, {
      timeout: 15000,
    })
    .toBe(2);

  await page.reload();
  await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  await expect(page.getByLabel('Профиль соперника')).toContainText('Росток ASA');
  expect(state.errors).toEqual([]);
});

test('personal network entry has platform opponents without a school selector', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 900 });
  let scopes = ['platform'];
  let createdScope = '';
  await page.route('**/api/games/chess/access', (route) =>
    route.fulfill({
      json: {
        player: { playerId: 'personal-player', displayAlias: 'Игрок' },
        allowed: true,
        reason: 'allowed',
        scopes,
      },
    }),
  );
  await page.route('**/api/games/chess/history*', (route) =>
    route.fulfill({ json: { matches: [], invites: [], nextCursor: null } }),
  );
  await page.route('**/api/games/chess/invites', (route) => {
    const input = route.request().postDataJSON();
    createdScope = input.scope;
    return route.fulfill({
      json: {
        invite: {
          id: 'invite',
          code: 'PLATFORM1234',
          scope: input.scope,
          status: 'open',
          version: 1,
          initialMs: input.initialMs,
          incrementMs: input.incrementMs,
          expiresAt: Date.now() + 60000,
          colorPreference: input.colorPreference,
          matchId: null,
        },
        replayed: false,
      },
    });
  });
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await page.getByRole('button', { name: 'Играть с человеком', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Создать приглашение', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Круг соперников для партии' })).toHaveCount(0);
  await expect(page.getByText('Соперники: Вся платформа', { exact: true })).toBeVisible();
  await expect(page.locator('.asa-network-shell .editor-header')).toHaveCount(0);
  await page.screenshot({
    path: 'reports/games/chess-redesign/network-personal-390.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Создать приглашение', exact: true }).click();
  expect(createdScope).toBe('platform');
  await expect(page.locator('.asa-network-code')).toContainText('PLATFORM1234');
  scopes = ['classroom', 'school'];
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Круг соперников для партии' })).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Круг соперников для партии' }).locator('option'),
  ).toHaveText(['Мой класс', 'Моя школа']);
  expect(state.errors).toEqual([]);
});

test('scoped online lobby renders avatars and delivers targeted challenges without copying a code', async ({
  page,
}) => {
  const state = await fixture(page);
  const peer = {
    playerId: '00000000-0000-4000-8000-000000000021',
    displayAlias: 'Игрок 7a38f2',
    avatarUrl: '/assets/avatars/default/avatar-07.webp',
  };
  const sender = {
    playerId: '00000000-0000-4000-8000-000000000022',
    displayAlias: 'Игрок c120e4',
    avatarUrl: '/assets/avatars/default/avatar-03.webp',
  };
  const invite = {
    id: '00000000-0000-4000-8000-000000000023',
    code: 'ABCDEF0123456789ABCDEF01',
    scope: 'classroom',
    status: 'open',
    version: 1,
    initialMs: 600000,
    incrementMs: 5000,
    expiresAt: Date.now() + 60000,
    colorPreference: 'white',
    matchId: null,
  };
  let available = true;
  let pending = false;
  let incoming = true;
  let chosen = '';
  await page.route('**/api/games/chess/access', (route) =>
    route.fulfill({
      json: {
        player: { playerId: 'self', displayAlias: 'Ваш игрок' },
        allowed: true,
        reason: 'allowed',
        scopes: ['classroom', 'school'],
      },
    }),
  );
  await page.route('**/api/games/chess/history*', (route) =>
    route.fulfill({ json: { matches: [], invites: [], nextCursor: null } }),
  );
  await page.route('**/api/games/chess/lobby', (route) =>
    route.fulfill({
      json: {
        available,
        players: [peer],
        incoming: incoming ? [{ invite, from: sender }] : [],
        outgoing: pending ? [{ invite, to: peer }] : [],
        limit: 100,
      },
    }),
  );
  await page.route(`**/api/games/chess/players/${peer.playerId}/challenge`, (route) => {
    chosen = route.request().postDataJSON().scope;
    pending = true;
    return route.fulfill({ json: { invite, replayed: false } });
  });
  await page.route(`**/api/games/chess/challenges/${invite.id}/decline`, (route) => {
    incoming = false;
    return route.fulfill({ json: { replayed: false } });
  });
  await page.route(`**/api/games/chess/invites/${invite.code}`, (route) =>
    route.fulfill({ json: { invite } }),
  );
  await page.goto('/#/games');
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await page.getByRole('button', { name: 'Играть с человеком', exact: true }).click();
  const list = page.getByRole('region', { name: 'Игроки в сети', exact: true });
  const player = list.locator(`[data-player-id="${peer.playerId}"]`);
  await expect(
    player.getByRole('button', { name: 'Пригласить играть', exact: true }),
  ).toBeEnabled();
  await expect(player.getByRole('img')).toHaveAttribute('src', peer.avatarUrl);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await player.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        player
          .locator('img')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `reports/games/chess-redesign/online-avatars-${width}.png`,
      fullPage: true,
    });
  }
  await list.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(list.getByRole('region', { name: 'Входящие вызовы', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Круг соперников для партии' }).selectOption('school');
  await expect(list.getByRole('heading', { name: 'Игроки в сети · Моя школа' })).toBeVisible();
  await player.getByRole('button', { name: 'Пригласить играть', exact: true }).click();
  expect(chosen).toBe('school');
  await expect(player.getByRole('button', { name: 'Вызов отправлен', exact: true })).toBeDisabled();
  available = false;
  pending = false;
  await page.reload();
  await expect(
    page.getByText('У вас уже идёт партия. Вернитесь к ней через историю.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.asa-network-player-list')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('game invitations reach the shared navigation and game card, ping once and survive reload without replay', async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createOscillator;
    (window as unknown as { gamePings: number }).gamePings = 0;
    AudioContext.prototype.createOscillator = function () {
      (window as unknown as { gamePings: number }).gamePings++;
      return original.call(this);
    };
  });
  await fixture(page);
  let incoming: { id: string; expiresAt: number }[] = [];
  await page.route('**/api/games/chess/notifications', (route) =>
    route.fulfill({ json: { playerId: 'notification-player', incoming } }),
  );
  await page.goto('/#/games');
  await expect(page.getByRole('button', { name: 'Играть: Шахматы', exact: true })).toBeVisible();
  // The global polite announcement must not add an empty status to unrelated page feedback.
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('.portal-game-announcement')).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('heading', { name: 'Игры', exact: true }).click();
  incoming = [{ id: 'new-real-invitation', expiresAt: Date.now() + 600000 }];
  const card = page.getByRole('button', { name: 'Посмотреть приглашения: Шахматы', exact: true });
  await expect(card).toContainText('Вас приглашают играть', { timeout: 12000 });
  await expect(
    page.getByRole('link', { name: 'Игры', exact: true }).locator('.game-invitation-badge'),
  ).toHaveText('1');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { gamePings: number }).gamePings))
    .toBe(1);
  mkdirSync('reports/games/chess-redesign', { recursive: true });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(card.locator('.game-invitation-badge')).toHaveText('1');
    if (width < 760)
      await expect(
        page
          .getByRole('button', { name: 'Открыть меню', exact: true })
          .locator('.game-invitation-badge'),
      ).toHaveText('1');
    await page.screenshot({
      path: `reports/games/chess-redesign/invitation-notification-${width}.png`,
      fullPage: true,
    });
  }
  await page.waitForTimeout(5500);
  expect(await page.evaluate(() => (window as unknown as { gamePings: number }).gamePings)).toBe(1);
  await page.reload();
  await expect(card).toContainText('Вас приглашают играть', { timeout: 12000 });
  await page.getByRole('heading', { name: 'Игры', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { gamePings: number }).gamePings)).toBe(0);
  await card.click();
  await expect(page).toHaveURL(/#\/chess\/old-chess\/network$/);
  incoming = [];
  await expect(page.locator('.portal-game-announcement')).toBeEmpty({ timeout: 12000 });
});
