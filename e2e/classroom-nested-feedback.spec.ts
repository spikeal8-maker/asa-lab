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
