import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { classId, fixture, origin } from './fixtures/classroom-owner';

const evidence = 'e2e/artifacts/owner-preview/classroom-nested-feedback';
const endpoint = `${origin}/api/project-distribution/classrooms/${classId}/policy`;
interface Policy {
  publish: boolean;
  download: boolean;
  comments: boolean;
  version: number;
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
async function boxes(page: Page, group: Locator) {
  const header = await page.locator('.portal-header').boundingBox();
  const tabs = await page.locator('.classroom-tabbar').boundingBox();
  const settings = await group.boundingBox();
  expect(header).not.toBeNull();
  expect(tabs).not.toBeNull();
  expect(settings).not.toBeNull();
  return { header: header!, tabs: tabs!, settings: settings! };
}
function unchanged(
  before: Awaited<ReturnType<typeof boxes>>,
  after: Awaited<ReturnType<typeof boxes>>,
) {
  for (const name of ['header', 'tabs', 'settings'] as const) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(before[name][dimension] - after[name][dimension])).toBeLessThanOrEqual(0.5);
    }
  }
}
async function selectSection(page: Page, section: 'settings' | 'students') {
  const bar = page.locator('.classroom-tabbar');
  await expect(bar).toBeVisible();
  const mobile = bar.getByRole('combobox', { name: 'Раздел класса', exact: true });
  if (await mobile.isVisible()) await mobile.selectOption(section);
  else
    await bar
      .getByRole('button', {
        name: section === 'settings' ? 'Настройки' : 'Ученики',
        exact: true,
      })
      .click();
}
async function openProjects(page: Page) {
  await page.goto(`${origin}/#/classrooms/${classId}`);
  await selectSection(page, 'settings');
  const group = page.getByRole('group', { name: 'Проекты класса', exact: true });
  await expect(group.getByRole('button', { name: 'Сохранить разрешения' })).toBeVisible();
  await settle(page);
  return group;
}
async function projectFixture(
  page: Page,
  options: { reject?: boolean; wait?: Promise<void> } = {},
) {
  const state = await fixture(page, 3, { sidebar: 'collapsed' });
  let policy: Policy = { publish: false, download: false, comments: false, version: 1 };
  const writes: Record<string, unknown>[] = [];
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: policy });
    expect(route.request().method()).toBe('PUT');
    const input = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(input);
    if (options.wait) await options.wait;
    if (options.reject) {
      return route.fulfill({ status: 500, json: { error: { code: 'synthetic_failure' } } });
    }
    expect(input.expectedVersion).toBe(policy.version);
    policy = {
      publish: input.publish === true,
      download: input.download === true,
      comments: input.comments === true,
      version: policy.version + 1,
    };
    return route.fulfill({ json: policy });
  });
  return { state, writes };
}

test.beforeAll(() => mkdirSync(evidence, { recursive: true }));

for (const [width, height] of [
  [1920, 900],
  [1366, 768],
  [390, 844],
  [320, 720],
] as const) {
  test(`nested project save has one page ribbon and no reflow at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    const { state, writes } = await projectFixture(page);
    const group = await openProjects(page);
    await group.getByLabel('Публикация проектов', { exact: true }).check();
    await group.getByRole('button', { name: 'Сохранить разрешения' }).scrollIntoViewIfNeeded();
    await settle(page);
    const before = await boxes(page, group);
    await group.getByRole('button', { name: 'Сохранить разрешения' }).click();
    const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
    await expect(ribbon).toHaveCount(1);
    await expect(ribbon).toContainText('Разрешения проектов сохранены.');
    await expect(group.getByText('Разрешения проектов сохранены.', { exact: true })).toHaveCount(0);
    const announcement = page.locator('.system-feedback-announcement[role="status"]');
    await expect(announcement).toHaveCount(1);
    await expect(announcement).toContainText('Разрешения проектов сохранены.');
    await expect(group.getByRole('button', { name: 'Сохранить разрешения' })).toBeDisabled();
    await settle(page);
    const during = await boxes(page, group);
    unchanged(before, during);
    await page.screenshot({ path: `${evidence}/${width}-project-success.png` });
    await ribbon.getByRole('button', { name: 'Закрыть уведомление' }).click();
    await expect(ribbon).toHaveCount(0);
    await settle(page);
    const after = await boxes(page, group);
    unchanged(before, after);
    await info.attach('nested-feedback-geometry', {
      body: JSON.stringify({ width, height, before, during, after }),
      contentType: 'application/json',
    });
    expect(writes).toEqual([
      { publish: true, download: false, comments: false, expectedVersion: 1 },
    ]);
    expect(state.errors).toEqual([]);
  });
}

test('failed project save remains local and never reports success', async ({ page }) => {
  const { state, writes } = await projectFixture(page, { reject: true });
  const group = await openProjects(page);
  await group.getByLabel('Публикация проектов', { exact: true }).check();
  await group.getByRole('button', { name: 'Сохранить разрешения' }).click();
  await expect(group.getByRole('alert')).toContainText('Не удалось сохранить разрешения проектов.');
  await expect(group.getByRole('button', { name: 'Обновить разрешения' })).toBeVisible();
  await expect(page.locator('.system-feedback-ribbon.system-feedback-success')).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('completion from a settings tab that has been left cannot notify the roster', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { state, writes } = await projectFixture(page, { wait });
  const group = await openProjects(page);
  await group.getByLabel('Публикация проектов', { exact: true }).check();
  await group.getByRole('button', { name: 'Сохранить разрешения' }).click();
  await expect.poll(() => writes.length).toBe(1);
  await selectSection(page, 'students');
  await expect(group).toHaveCount(0);
  const response = page.waitForResponse(
    (item) => item.url() === endpoint && item.request().method() === 'PUT',
  );
  release!();
  await response;
  await settle(page);
  await expect(page.locator('.classroom-roster-row')).toHaveCount(3);
  await expect(page.locator('.system-feedback-ribbon')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

type NestedSurface = 'ai' | 'games' | 'network' | 'rating';
const nestedSurfaces = ['ai', 'games', 'network', 'rating'] as const;

async function allSettingsFixture(page: Page, rejected?: NestedSurface) {
  const state = await fixture(page, 3, { sidebar: 'collapsed' });
  const writes: Array<{ surface: NestedSurface; input: Record<string, unknown> }> = [];
  const factors = { projects: true, logins: true, days: true, time: true, grades: true };
  let ai = {
    classroomId: classId,
    mode: 'deny',
    minimumRating: 0,
    revision: 1,
    readOnly: false,
    students: [],
  };
  let games = { mode: 'allow', threshold: null, state: 'active', version: 1 };
  let network = { enabled: false, scope: 'classroom', version: 1 };
  let rating = { periodDays: 30, factors, revision: 1 };
  const urls = {
    ai: `${origin}/api/ai/classrooms/${classId}/access`,
    games: `${origin}/api/games/classrooms/${classId}/policy`,
    network: `${origin}/api/games/chess/policy/${classId}`,
    rating: `${origin}/api/classrooms/${classId}/participants/actions/settings`,
  };
  await page.route(`${origin}/api/classrooms/${classId}/participants`, (route) =>
    route.fulfill({ json: { settings: rating, items: [] } }),
  );
  for (const surface of nestedSurfaces) {
    await page.route(urls[surface], async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        const value = surface === 'ai' ? ai : surface === 'games' ? games : network;
        return route.fulfill({ json: value });
      }
      expect(method).toBe(surface === 'rating' ? 'POST' : 'PUT');
      const input = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ surface, input });
      if (surface === rejected) {
        return route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: 'Изменение не подтверждено.' } },
        });
      }
      if (surface === 'ai') {
        expect(input).toMatchObject({
          kind: 'classroom',
          mode: 'allow',
          minimumRating: 0,
          expectedRevision: 1,
        });
        expect(input.requestId).toEqual(expect.any(String));
        ai = { ...ai, mode: 'allow', revision: 2 };
        return route.fulfill({ json: { saved: true, revision: 2 } });
      }
      if (surface === 'games') {
        expect(input).toEqual({ mode: 'deny', threshold: null, expectedVersion: 1 });
        games = { ...games, mode: 'deny', version: 2 };
        return route.fulfill({ json: games });
      }
      if (surface === 'network') {
        expect(input).toEqual({ enabled: true, scope: 'classroom', expectedVersion: 1 });
        expect(route.request().headers()['idempotency-key']).toEqual(expect.any(String));
        network = { ...network, enabled: true, version: 2 };
        return route.fulfill({ json: { ...network, replayed: false } });
      }
      expect(input).toMatchObject({ periodDays: 7, expectedRevision: 1, factors });
      expect(input.requestId).toEqual(expect.any(String));
      rating = { ...rating, periodDays: 7, revision: 2 };
      return route.fulfill({ json: rating });
    });
  }
  return { state, writes };
}

async function prepareNestedSave(page: Page, surface: NestedSurface) {
  await page.goto(`${origin}/#/classrooms/${classId}`);
  await selectSection(page, 'settings');
  const group =
    surface === 'rating'
      ? page.getByRole('region', { name: 'Настройки рейтинга', exact: true })
      : page.getByRole('group', {
          name:
            surface === 'ai'
              ? 'ИИ-чат учеников'
              : surface === 'games'
                ? 'Игры в классе'
                : 'Сетевая игра в шахматы и шашки',
          exact: true,
        });
  const name =
    surface === 'ai'
      ? 'Сохранить правило класса'
      : surface === 'games'
        ? 'Сохранить доступ'
        : surface === 'network'
          ? 'Сохранить сетевой режим'
          : 'Сохранить рейтинг';
  const button = group.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  if (surface === 'ai') {
    const rule = group.getByLabel('Правило класса');
    await expect(rule).toHaveCount(1);
    await rule.selectOption('allow');
  } else if (surface === 'games')
    await group.getByLabel('Доступ к играм', { exact: true }).selectOption('deny');
  else if (surface === 'network')
    await group.getByLabel('Разрешить сетевую игру', { exact: true }).check();
  else await group.getByLabel('Период рейтинга', { exact: true }).selectOption('7');
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await settle(page);
  const message =
    surface === 'ai'
      ? 'Доступ к ИИ сохранён. Новые сообщения используют это правило.'
      : surface === 'games'
        ? 'Доступ к играм сохранён.'
        : surface === 'network'
          ? 'Настройки сетевой игры сохранены.'
          : 'Рейтинг сохранён';
  return { group, button, message };
}

for (const surface of nestedSurfaces) {
  for (const width of [1440, 390]) {
    test(`${surface} confirmed save uses one overlay without reflow at ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const { state, writes } = await allSettingsFixture(page);
      const { group, button, message } = await prepareNestedSave(page, surface);
      const before = await boxes(page, group);
      await button.click();
      const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
      await expect(ribbon).toHaveCount(1);
      await expect(ribbon).toBeVisible();
      await expect(ribbon).toContainText(message);
      await expect(group.getByText(message, { exact: true })).toHaveCount(0);
      const announcement = page.locator('.system-feedback-announcement[role="status"]');
      await expect(announcement).toHaveCount(1);
      await expect(announcement).toContainText(message);
      await expect(button).toBeVisible();
      await expect(group).not.toHaveAttribute('aria-busy', 'true');
      await settle(page);
      const during = await boxes(page, group);
      unchanged(before, during);
      await page.screenshot({ path: `${evidence}/${surface}-${width}-success.png` });
      await ribbon.getByRole('button', { name: 'Закрыть уведомление' }).click();
      await expect(ribbon).toHaveCount(0);
      await settle(page);
      const after = await boxes(page, group);
      unchanged(before, after);
      await info.attach('nested-settings-geometry', {
        body: JSON.stringify({ surface, width, before, during, after }),
        contentType: 'application/json',
      });
      expect(writes).toHaveLength(1);
      expect(writes[0]?.surface).toBe(surface);
      expect(state.errors).toEqual([]);
    });
  }
  test(`${surface} rejected save stays local without a false success`, async ({ page }) => {
    const { state, writes } = await allSettingsFixture(page, surface);
    const { group, button, message } = await prepareNestedSave(page, surface);
    await button.click();
    await expect(group.getByRole('alert')).toBeVisible();
    await expect(page.locator('.system-feedback-ribbon.system-feedback-success')).toHaveCount(0);
    await expect(page.locator('.system-feedback-announcement[role="status"]')).toHaveCount(0);
    await expect(group.getByText(message, { exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
}
