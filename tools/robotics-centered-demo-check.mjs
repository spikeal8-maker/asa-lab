#!/usr/bin/env node
// Create at most one new local-only 5x5 Robotics demo without changing existing projects.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const local = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const settings = Object.fromEntries(
  readFileSync(join(local, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const base = 'http://127.0.0.1:4630';
if (!settings.URL?.startsWith(base + '/#/home/')) throw Error('Unexpected account host');
const stateFile = join(local, 'arena-centered-20261110.url');
const out = join(process.cwd(), 'e2e/artifacts/robotics-centered-010');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(settings.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(settings.PASSWORD);
  const human = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await human.isVisible()) {
    await human.press('Space');
    await expect(human).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25000 });
  let projectUrl = existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : '';
  if (!projectUrl) {
    await page.locator('.portal-header .portal-quick-create > summary').click();
    const createdResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST',
    );
    await page
      .locator('.portal-header .portal-create-options')
      .getByRole('button', { name: /^Робототехника/ })
      .click();
    const response = await createdResponse;
    if (response.status() !== 201) throw Error('New local project returned ' + response.status());
    const data = await response.json();
    if (!data.project?.id) throw Error('New project has no id');
    projectUrl = base + '/#/home/' + data.project.id + '?module=robotics';
    writeFileSync(stateFile, projectUrl + '\n');
    console.log('LOCAL_ARENA_CREATED');
  } else console.log('REUSED_EXISTING_LOCAL_ARENA');

  const projectId = new URL(projectUrl).hash.match(/#\/home\/([^?]+)/)?.[1];
  if (!projectId) throw new Error('Missing centered demo ID');
  const check = await page.request.get('/api/projects/' + projectId);
  if (!check.ok()) throw new Error('Centered project API failed: ' + check.status());
  const saved = (await check.json()).draft?.document?.world;
  if (!saved || saved.field.widthMeters !== 5 || saved.field.heightMeters !== 5 ||
      saved.initialPose.xMeters !== 2.5 || saved.initialPose.yMeters !== 2.5)
    throw new Error('Project is not centered at 2.5, 2.5: ' + JSON.stringify(saved?.initialPose));
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  const field = page.locator('.robotics-field-canvas svg.robotics-field');
  await expect(field).toBeVisible({ timeout: 30000 });
  const viewbox = await field.getAttribute('viewBox');
  if (!viewbox) throw Error('Field SVG missing viewBox');
  const dims = viewbox.trim().split(/\s+/).map(Number);
  if (Math.abs(dims[2] - 5130) > 1 || Math.abs(dims[3] - 5130) > 1)
    throw Error('Default field is not 5×5m: ' + viewbox);
  const label = page.locator('.robotics-field-dimension').first();
  await expect(label).toContainText('5000');
  await expect(page.getByTestId('robotics-field-palette')).toBeVisible();
  const robot = page.getByTestId('robotics-robot');
  await expect(robot).toHaveAttribute('data-x-meters', '2.5');
  await expect(robot).toHaveAttribute('data-y-meters', '2.5');
  await page.screenshot({ path: join(out, 'new-5m-field-1440.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(out, 'new-5m-field-390.png'), fullPage: false });
  if (errors.length) throw Error('Browser JS errors: ' + errors.join(' | '));
  writeFileSync(
    join(out, 'measurements.json'),
    JSON.stringify(
      {
        fieldWidthMeters: 5,
        fieldHeightMeters: 5,
        initialPose: { xMeters: 2.5, yMeters: 2.5 },
        viewBox: viewbox,
        note: 'Dedicated local-only demo. Previously saved projects retain their original dimensions.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS new 5x5m project: robot at exact center X=2.5 Y=2.5; older projects untouched');
  console.log('ARENA_LOCAL_URL=' + projectUrl);
} catch (err) {
  console.error('NEW_ARENA_CHECK_FAILED', String(err));
  await page.screenshot({ path: join(out, 'failed.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
