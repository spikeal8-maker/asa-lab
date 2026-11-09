#!/usr/bin/env node
// UI acceptance for Robotics field vector tools on the private D2-R2 demo project.
// Edits made by this test are reverted by the existing Undo history.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
const localDir = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const login = Object.fromEntries(
  readFileSync(join(localDir, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const host = 'http://127.0.0.1:4630';
if (!login.URL?.startsWith(host + '/#/home/')) throw Error('Only private D2-R2 project allowed');
const out = join(root, 'e2e/artifacts/robotics-field-vectors-008');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: host,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [],
  writes = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (request) => {
  const u = new URL(request.url());
  if (u.origin === host && u.pathname.startsWith('/api/projects') && request.method() !== 'GET')
    writes.push(request.method() + ' ' + u.pathname);
});
const palette = page.getByTestId('robotics-field-palette');
const field = page.locator('.robotics-field-canvas svg.robotics-field');
const undo = () => page.getByRole('button', { name: 'Отменить', exact: true });
const selected = page.getByRole('dialog', { name: 'Параметры выбранного объекта' });
async function revertOne(selector, count) {
  await undo().click();
  await expect(page.locator(selector)).toHaveCount(count);
}
async function clickField(fx, fy, button = 'left') {
  const r = await field.boundingBox();
  if (!r) throw Error('Field not visible');
  await page.mouse.click(r.x + r.width * fx, r.y + r.height * fy, { button });
}
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(login.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(login.PASSWORD);
  const antiBot = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await antiBot.isVisible()) {
    await antiBot.press('Space');
    await expect(antiBot).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
  await page.goto(login.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 25000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await expect(palette).toBeVisible();
  for (const name of [
    'Стена',
    'Мяч',
    'Банка',
    'Брусок',
    'Линия',
    'Кривая',
    'Зона',
    'Прямоугольник',
    'Круг',
    'Текст',
    'Трасса',
  ]) {
    await expect(palette.getByRole('button', { name, exact: true })).toBeVisible();
  }
  for (const name of [
    'Добавить изображение',
    'Импортировать поле JSON',
    'Экспортировать поле JSON',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  checks.push('right-side palette + image/JSON controls');
  console.log('PASS field palette groups, vector tools and file controls');
  await page.screenshot({ path: join(out, 'field-1440.png'), fullPage: false });

  const rectangle = page.locator('.robotics-field-canvas [data-object-kind="rectangle"]');
  const initialRect = await rectangle.count();
  await palette.getByRole('button', { name: 'Прямоугольник', exact: true }).dragTo(field, {
    targetPosition: {
      x: (await field.boundingBox()).width * 0.58,
      y: (await field.boundingBox()).height * 0.53,
    },
    timeout: 10000,
  });
  await expect(rectangle).toHaveCount(initialRect + 1, { timeout: 7000 });
  const placed = rectangle.last();
  await placed.click({ force: true });
  await expect(selected).toBeVisible();
  await expect(selected.getByRole('checkbox', { name: 'Заливка фигуры' })).toBeVisible();
  const handle = page
    .locator(
      '.robotics-field-selection-handles [data-vector-kind="decoration"][data-vector-handle="end"]',
    )
    .last();
  await expect(handle).toBeVisible();
  await page.screenshot({ path: join(out, 'rectangle-settings-1440.png'), fullPage: false });
  checks.push('context popup, vector handles');
  console.log('PASS contextual settings over field + vector resize controls');
  await selected.getByRole('button', { name: 'Закрыть параметры объекта' }).click();
  await revertOne('.robotics-field-canvas [data-object-kind="rectangle"]', initialRect);

  const circle = page.locator('.robotics-field-canvas [data-object-kind="circle"]');
  const beforeCircle = await circle.count();
  await palette.getByRole('button', { name: 'Круг', exact: true }).click();
  await clickField(0.64, 0.38);
  await expect(circle).toHaveCount(beforeCircle + 1, { timeout: 7000 });
  await revertOne('.robotics-field-canvas [data-object-kind="circle"]', beforeCircle);
  checks.push('circle creation + undo');
  console.log('PASS circle creation and undo');

  const text = page.locator('.robotics-field-canvas [data-object-kind="text"]');
  const initialText = await text.count();
  await palette.getByRole('button', { name: 'Текст', exact: true }).click();
  await clickField(0.63, 0.61);
  await expect(text).toHaveCount(initialText + 1, { timeout: 7000 });
  await text.last().click({ force: true });
  await expect(selected.getByRole('textbox', { name: 'Надпись на поле' })).toBeVisible();
  await selected.getByRole('textbox', { name: 'Надпись на поле' }).fill('ФИНИШ');
  await selected.getByRole('textbox', { name: 'Надпись на поле' }).press('Tab');
  await expect(text.last()).toContainText('ФИНИШ');
  await selected.getByRole('button', { name: 'Закрыть параметры объекта' }).click();
  await undo().click(); // revert inscription
  await revertOne('.robotics-field-canvas [data-object-kind="text"]', initialText); // revert creation
  checks.push('text creation, editing, undo');
  console.log('PASS text editing and individual Undo steps');

  const line = page.locator('.robotics-field-canvas [data-object-kind="line"]');
  const beforeLine = await line.count();
  await palette.getByRole('button', { name: 'Линия', exact: true }).click();
  await clickField(0.18, 0.77);
  await clickField(0.28, 0.68);
  await clickField(0.42, 0.75);
  await clickField(0.42, 0.75, 'right');
  await expect(line).toHaveCount(beforeLine + 2, { timeout: 7000 });
  await undo().click();
  await expect(line).toHaveCount(beforeLine);
  checks.push('multi-point line single Undo');
  console.log('PASS vector polyline with corners; right-click finish and one Undo');

  const curve = page.locator('.robotics-field-canvas [data-object-kind="curve"]');
  const beforeCurve = await curve.count();
  await palette.getByRole('button', { name: 'Кривая', exact: true }).click();
  await clickField(0.2, 0.62);
  await clickField(0.32, 0.49);
  await clickField(0.43, 0.65);
  await expect(curve).toHaveCount(beforeCurve + 1, { timeout: 7000 });
  await revertOne('[data-object-kind="curve"]', beforeCurve);
  checks.push('Bezier 3-point curve');
  console.log('PASS 3-point curve and Undo');

  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
    await expect(page.getByRole('tab', { name: 'Поле' })).toBeVisible();
    if (width < 761) {
      const toggle = page.getByRole('button', { name: 'Элементы поля', exact: true });
      await toggle.click();
      await expect(palette).toBeVisible();
    }
    const data = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll('.robotics-field-palette-card')].map((c) => {
        const a = c.querySelector('.robotics-field-palette-art').getBoundingClientRect();
        const t = c.querySelector('.robotics-field-palette-name').getBoundingClientRect();
        return a.bottom <= t.top + 2;
      }),
    }));
    if (data.scrollWidth > width + 1) throw Error('Viewport overflow ' + JSON.stringify(data));
    if (data.cards.some((ok) => !ok)) throw Error('Palette art overlaps text ' + width);
    await page.screenshot({ path: join(out, 'field-' + width + '.png'), fullPage: false });
    if (width < 761) await page.getByRole('button', { name: 'Закрыть каталог элементов' }).click();
    checks.push('responsive ' + width);
    console.log('PASS width ' + width + 'px palette graphics fit');
  }

  if (errors.length) throw Error('Browser JS errors ' + errors.join(' | '));
  if (writes.length) throw Error('Unexpected server project write ' + writes.join(' | '));
  writeFileSync(
    join(out, 'report.json'),
    JSON.stringify({ checks, errors, writes }, null, 2) + '\n',
  );
  console.log('PASS all checks: no JS errors or project API writes');
} catch (error) {
  console.error('FIELD_VECTOR_BROWSER_FAILED', String(error));
  await page.screenshot({ path: join(out, 'failed.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
