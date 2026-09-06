import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

const baseline = process.env['ASA_HOME_BASELINE'] === 'true';
const evidence = `e2e/artifacts/owner-preview/home-workspace/${baseline ? 'before' : 'after'}`;

async function login(page: Page): Promise<void> {
  const pool = e2eAdminPool();
  try {
    const teacher = await seedTeacher(pool, 'home-workspace');
    await loginWithOrganization(page, teacher);
  } finally {
    await pool.end();
  }
}

async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function compactHome(page: Page): Promise<void> {
  const measurements = await page.locator('.creator-module-feed').evaluate((feed) => {
    const sections = Array.from(feed.querySelectorAll('.creator-module-section'));
    return sections.map((section, index) => {
      const heading = section.querySelector('.creator-module-heading')!;
      const title = heading.querySelector('h2')!.getBoundingClientRect();
      const create = heading.querySelector('.home-create-button')!.getBoundingClientRect();
      const shelf = section.querySelector('.home-shelf, .home-empty-create')!;
      return {
        sectionGap:
          index === 0
            ? 0
            : section.getBoundingClientRect().top -
              sections[index - 1].getBoundingClientRect().bottom,
        headingGap: shelf.getBoundingClientRect().top - heading.getBoundingClientRect().bottom,
        titleClearance: create.left - title.right,
      };
    });
  });
  expect(measurements).toHaveLength(2);
  for (const measurement of measurements) {
    expect(measurement.sectionGap).toBeGreaterThanOrEqual(0);
    expect(measurement.sectionGap).toBeLessThanOrEqual(16);
    expect(measurement.headingGap).toBeGreaterThanOrEqual(0);
    expect(measurement.headingGap).toBeLessThanOrEqual(6);
    expect(measurement.titleClearance).toBeGreaterThanOrEqual(4);
  }
}

test('Home: production-build baseline, desktop and mobile workspace', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(evidence, { recursive: true });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await expect(page).toHaveURL(/#\/home$/);
  if (process.env['ASA_E2E_LAN_CHECK'] === 'true') {
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  }
  const samples: unknown[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  for (let run = 0; run < 5; run++) {
    const start = Date.now();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Электроника', exact: true })).toBeVisible();
    samples.push({
      readyMs: Date.now() - start,
      ...(await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const assets = resources.filter((entry) => /\.(js|css)(\?|$)/.test(entry.name));
        return {
          decodedAssetBytes: assets.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
          transferAssetBytes: assets.reduce((sum, entry) => sum + entry.transferSize, 0),
          assets: assets.map((entry) => ({
            path: new URL(entry.name).pathname,
            bytes: entry.decodedBodySize,
          })),
        };
      })),
    });
  }
  writeFileSync(`${evidence}/measurements.json`, JSON.stringify(samples, null, 2));
  await page.screenshot({ path: `${evidence}/desktop-empty.png`, fullPage: true });
  if (baseline) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${evidence}/mobile-empty.png`, fullPage: true });
    return;
  }
  await expect(page.locator('.portal-sidebar-avatar')).not.toHaveAttribute('role', 'button');
  await expect(page.locator('.portal-sidebar-avatar button')).toHaveCount(0);
  await page.locator('.portal-header .portal-quick-create > summary').click();
  await expect(page.locator('.portal-header .portal-create-options button')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/create-menu.png`, fullPage: true });
  await page.keyboard.press('Escape');
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    await compactHome(page);
    await expect(page.locator('.portal-header-create-label:visible')).toHaveCount(1);
    if (width <= 820) {
      await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Основная навигация' })).toBeVisible();
      expect(await page.locator('main').evaluate((element) => element.inert)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${evidence}/mobile-empty.png`, fullPage: true });
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.screenshot({ path: `${evidence}/mobile-menu.png`, fullPage: true });
  await page.getByLabel('Основная навигация').getByText('Мои проекты', { exact: true }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('direct creation survives a lost response and reload, without a second project', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const keys: string[] = [];
  let createdId = '';
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const response = await route.fetch();
    expect(response.status()).toBe(keys.length === 1 ? 201 : 200);
    const body = await response.json();
    if (keys.length === 1) {
      createdId = body.project.id;
      await route.abort('failed');
    } else {
      expect(body.project.id).toBe(createdId);
      expect(body.created).toBe(false);
      await route.fulfill({ response });
    }
  });
  await page
    .getByRole('button', { name: 'Создать модель', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole('button', { name: 'Продолжить создание' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Электроника', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить создание' }).click();
  await expect(page.locator('.asa3d-title-input')).toHaveValue('3D модель 1');
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe('');
  await page.reload();
  await expect(page.locator('.asa3d-title-input')).toHaveValue('3D модель 1');
  await page.getByRole('button', { name: 'ASA Lab', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByTestId('project-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Все модели', exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\?filter=three-d$/);
  await page.getByTestId('project-card').getByRole('link').first().click();
  await expect(page.locator('.asa3d-title-input')).toBeVisible();
  await page.reload();
  await expect(page.locator('.asa3d-title-input')).toBeVisible();
  await page.getByRole('button', { name: 'ASA Lab', exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\?filter=three-d$/);
  await page.goto('/#/home');
  await page.unroute('**/api/projects');
  await page.getByRole('button', { name: 'Создать цепь', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Начать моделирование', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toMatch(/\/projects\/[^/]+\/electronics\/edit/);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Начать моделирование', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByTestId('project-card')).toHaveCount(2);
});

test('ten-item shelves scroll on phones, public feed errors never hide personal work', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  for (const module of ['three-d', 'electronics']) {
    for (let i = 0; i < 12; i++) {
      const response = await page.request.post('/api/projects', {
        headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
        data: { module, scope: 'personal', automaticTitle: true },
      });
      expect(response.status()).toBe(201);
    }
  }
  await page.reload();
  await expect(page.getByTestId('project-card')).toHaveCount(20);
  await compactHome(page);
  await page.screenshot({ path: `${evidence}/desktop-filled.png`, fullPage: true });
  for (const width of [320, 360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    await compactHome(page);
    const track = page.locator('.home-shelf-track').first();
    await expect(track.locator('.project-card')).toHaveCount(10);
    expect(await track.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
    await track.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const partial = await track.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return Array.from(el.children).some((child) => {
        const card = child.getBoundingClientRect();
        return card.left < rect.right && card.right > rect.right + 4;
      });
    });
    expect(partial).toBe(true);
    await track.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await track.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await track.locator('.project-card').last().getByRole('link').last().click();
    await expect(page.locator('.asa3d-title-input')).toHaveValue('3D модель 3');
    await page.goBack();
    await expect(page.getByTestId('project-card')).toHaveCount(20);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${evidence}/mobile-filled.png`, fullPage: true });
  await page.route('**/api/gallery?*', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'test_unavailable', message: 'Test' } } }),
  );
  await page.reload();
  await page
    .getByRole('heading', { name: 'Проекты сообщества', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить');
  await expect(page.getByTestId('project-card')).toHaveCount(20);
  await page.getByRole('button', { name: 'Все модели', exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\?filter=three-d$/);
  // Management has a full-size, unclipped menu in the complete project list.
  const card = page.getByTestId('project-card').first();
  await card.hover();
  await card.locator('details > summary').click();
  await expect(card.getByRole('button', { name: 'Архивировать', exact: true })).toBeVisible();
});

test('a completed old-account request never opens its project in the next account', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await login(page);
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let persisted = (): void => undefined;
  const saved = new Promise<void>((resolve) => {
    persisted = resolve;
  });
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    persisted();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'Создать модель', exact: true }).click();
    await saved;
    await page.locator('.portal-account > summary').click();
    await page
      .locator('.portal-account-menu')
      .getByRole('button', { name: 'Выход', exact: true })
      .click();
    await login(page);
  } finally {
    release();
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByRole('heading', { name: 'Электроника', exact: true })).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.asa3d-title-input')).toHaveCount(0);
});

test('twenty editor round trips keep workers and retained Home resources bounded', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page);
  for (const module of ['three-d', 'electronics']) {
    const response = await page.request.post('/api/projects', {
      headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
      data: { module, scope: 'personal', automaticTitle: true },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  const cdp = await page.context().newCDPSession(page);
  const receipts: {
    cycle: number;
    workers: number;
    heap: number;
    nodes: number;
    listeners: number;
  }[] = [];
  for (let cycle = 0; cycle < 24; cycle++) {
    const title = cycle % 2 === 0 ? '3D модель 1' : 'Электрическая цепь 1';
    await page
      .getByTestId('project-card')
      .filter({ hasText: title })
      .getByRole('link')
      .first()
      .click();
    if (cycle % 2 === 0) {
      await expect(page.locator('.asa3d-title-input')).toHaveValue(title);
    } else {
      await expect(
        page.getByRole('button', { name: 'Начать моделирование', exact: true }),
      ).toBeVisible();
    }
    await page.goBack();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByTestId('project-card')).toHaveCount(2);
    await expect.poll(() => page.workers().length).toBe(0);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    if (cycle >= 4)
      receipts.push({
        cycle: cycle - 3,
        workers: page.workers().length,
        heap: heap.usedSize,
        nodes: dom.nodes,
        listeners: dom.jsEventListeners,
      });
  }
  mkdirSync(evidence, { recursive: true });
  writeFileSync(`${evidence}/round-trips.json`, JSON.stringify(receipts, null, 2));
  const first = receipts[0];
  const last = receipts.at(-1)!;
  // A bounded regression ceiling, not a proof that every editor resource is leak-free.
  expect(last.heap - first.heap).toBeLessThan(12_000_000);
  expect(last.nodes - first.nodes).toBeLessThan(500);
  expect(last.listeners - first.listeners).toBeLessThan(100);
});

test('twenty separate accounts on one address create exactly their own projects', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const pool = e2eAdminPool();
  const contexts: BrowserContext[] = [];
  const receipts: { sessions: number; elapsedMs: number; uniqueProjects: number }[] = [];
  try {
    for (const batch of [1, 4, 5, 10]) {
      const started = Date.now();
      const created = await Promise.all(
        Array.from({ length: batch }, async (_, index) => {
          const teacher = await seedTeacher(pool, `home-school-${contexts.length}-${index}`);
          const context = await browser.newContext({ baseURL });
          contexts.push(context);
          const page = await context.newPage();
          await loginWithOrganization(page, teacher);
          await page.close();
          const key = crypto.randomUUID();
          const options = {
            headers: { origin: new URL(baseURL!).origin, 'idempotency-key': key },
            data: { module: 'electronics', scope: 'personal', automaticTitle: true },
          };
          const response = await context.request.post('/api/projects', options);
          expect(response.status()).toBe(201);
          const { project } = await response.json();
          expect(project.title).toBe('Электрическая цепь 1');
          const replay = await context.request.post('/api/projects', options);
          expect(replay.status()).toBe(200);
          expect((await replay.json()).project.id).toBe(project.id);
          const list = await context.request.get(
            '/api/projects?scope=personal&module=electronics&limit=5',
          );
          expect(list.status()).toBe(200);
          expect((await list.json()).items.map((item: { id: string }) => item.id)).toEqual([
            project.id,
          ]);
          return project.id as string;
        }),
      );
      expect(new Set(created).size).toBe(batch);
      receipts.push({
        sessions: contexts.length,
        elapsedMs: Date.now() - started,
        uniqueProjects: created.length,
      });
    }
    expect(contexts).toHaveLength(20);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(`${evidence}/school-sessions.json`, JSON.stringify(receipts, null, 2));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await pool.end();
  }
});
