#!/usr/bin/env node
// Local-only acceptance against the complete Portal -> ModuleEditorHost -> RoboticsEditor.
// Never touches production, the shared test database, or third-party processes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
const env = new Map(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z_0-9]*=/.test(line))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
if (
  env.get('ASA_WEB_PORT') !== '4630' ||
  env.get('ASA_API_PORT') !== '4631' ||
  env.get('MIGRATION_EXPECT_DATABASE') !== 'asalab_robotics_fast'
) {
  throw new Error('BLOCKED: this test requires the dedicated local Robotics worktree');
}
const baseURL = 'http://127.0.0.1:4630';
const state = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const screenshots = join(state, 'screenshots');
const projectFile = join(state, 'project.json');
const css = join(root, 'apps/web/src/robotics/robotics.css');
mkdirSync(screenshots, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log('Bundled Chromium is not ready; retry with installed Chrome.');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
}
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const result = { baseURL, projectId: null, editorUrl: null, checks: [], consoleErrors: [] };
const pass = (name) => {
  result.checks.push(name);
  console.log('PASS ' + name);
};
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(env.get('ASA_SEED_TEACHER_EMAIL'));
  await page.getByLabel('Пароль', { exact: true }).fill(env.get('ASA_SEED_TEACHER_PASSWORD'));
  const bot = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await bot.isVisible()) {
    await bot.press('Space');
    await expect(bot).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
  pass('Local demonstration account login');

  let projectId = null;
  if (existsSync(projectFile)) {
    const prior = JSON.parse(readFileSync(projectFile, 'utf8'));
    if (/^[0-9a-f-]{36}$/i.test(prior.projectId ?? '')) {
      const response = await page.request.get('/api/projects/' + prior.projectId);
      if (response.status() === 200) projectId = prior.projectId;
    }
  }
  if (!projectId) {
    await page.locator('.portal-header .portal-quick-create > summary').click();
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/projects' &&
        response.request().method() === 'POST',
      { timeout: 20000 },
    );
    await page
      .locator('.portal-header .portal-create-options')
      .getByRole('button', { name: /^Робототехника/ })
      .click();
    const created = await createdResponse;
    if (created.status() !== 201) {
      throw new Error(
        'Creating the demonstration Robotics project failed: HTTP ' + created.status(),
      );
    }
    projectId = (await created.json()).project.id;
    writeFileSync(projectFile, JSON.stringify({ projectId }, null, 2));
    pass('Created account-backed Robotics demo project');
  }
  const editorUrl = baseURL + '/#/home/' + projectId + '?module=robotics';
  await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 45000 });
  const header = page.locator('.robotics-unified-header');
  await expect(header).toBeVisible({ timeout: 20000 });
  for (const tab of ['Поле', 'Робот', 'Электроника', 'Программа']) {
    await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('textbox', { name: 'Название проекта', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
  pass('Actual Portal/ModuleEditorHost/RoboticsEditor and 4 tabs');

  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('robotics-account-editor')).toHaveAttribute(
    'data-server-revision',
    /^[1-9]\d*$/,
    { timeout: 30000 },
  );
  const response = await page.request.get('/api/projects/' + projectId);
  if (response.status() !== 200)
    throw new Error('Project read after save: HTTP ' + response.status());
  const body = await response.json();
  if (body.project.moduleKey !== 'robotics') throw new Error('Wrong project module');
  pass('Real project save and API round-trip');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 45000 });
  pass('Real project reopened after reload');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(header).toBeVisible();
  await page.screenshot({ path: join(screenshots, 'robotics-1440.png'), fullPage: false });
  await header.screenshot({ path: join(screenshots, 'robotics-header-1440.png') });
  pass('Screenshot of existing header at 1440px');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header).toBeVisible();
  await page.screenshot({ path: join(screenshots, 'robotics-390.png'), fullPage: false });
  await header.screenshot({ path: join(screenshots, 'robotics-header-390.png') });
  pass('Screenshot of existing header at 390px');

  await page.setViewportSize({ width: 1440, height: 900 });
  const before = readFileSync(css);
  const probe = 'robotics-hmr-' + randomUUID().slice(0, 8);
  await page.evaluate((mark) => {
    window.__asaRoboticsHmrMark = mark;
  }, probe);
  let changed = false;
  try {
    writeFileSync(
      css,
      Buffer.concat([
        before,
        Buffer.from('\n.robotics-portal-editor { --asa-fast-dev-hmr-probe: ' + probe + '; }\n'),
      ]),
    );
    changed = true;
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            getComputedStyle(document.querySelector('.robotics-portal-editor'))
              .getPropertyValue('--asa-fast-dev-hmr-probe')
              .trim(),
          ),
        { timeout: 20000 },
      )
      .toBe(probe);
    const marker = await page.evaluate(() => window.__asaRoboticsHmrMark);
    if (marker !== probe)
      throw new Error('Vite reloaded the entire page rather than applying CSS HMR');
    pass('Vite HMR applied CSS with no full page reload');
  } finally {
    if (changed) writeFileSync(css, before);
  }
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          getComputedStyle(document.querySelector('.robotics-portal-editor'))
            .getPropertyValue('--asa-fast-dev-hmr-probe')
            .trim(),
        ),
      { timeout: 20000 },
    )
    .toBe('');
  pass('Temporary CSS probe reverted');

  result.projectId = projectId;
  result.editorUrl = editorUrl;
  result.consoleErrors = errors.slice(0, 20);
  writeFileSync(join(state, 'acceptance.json'), JSON.stringify(result, null, 2));
  console.log('EDITOR_URL=' + editorUrl);
  console.log('SCREENSHOTS=' + screenshots);
  console.log('PAGE_ERRORS=' + errors.length);
  if (errors.length) console.log('ERROR_SAMPLE=' + errors.slice(0, 5).join(' || ').slice(0, 1200));
} catch (error) {
  console.error('ACCEPTANCE_FAILED: ' + String(error));
  result.consoleErrors = errors.slice(0, 20);
  writeFileSync(join(state, 'acceptance.json'), JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
