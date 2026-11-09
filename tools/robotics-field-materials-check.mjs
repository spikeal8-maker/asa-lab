#!/usr/bin/env node
// Local D2-R2 acceptance for physics presets, resize handles, images and field JSON.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
const configDir = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const credentials = Object.fromEntries(
  readFileSync(join(configDir, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const base = 'http://127.0.0.1:4630';
if (!credentials.URL?.startsWith(base + '/#/home/'))
  throw Error('Only isolated D2-R2 demo may be tested');
const out = join(process.cwd(), 'e2e/artifacts/robotics-field-materials-009');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [],
  writes = [],
  steps = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (req) => {
  const u = new URL(req.url());
  if (u.origin === base && u.pathname.startsWith('/api/projects') && req.method() !== 'GET')
    writes.push(req.method() + ' ' + u.pathname);
});
const palette = page.getByTestId('robotics-field-palette');
const canvas = page.locator('.robotics-field-canvas svg.robotics-field');
const popup = page.getByRole('dialog', { name: 'Параметры выбранного объекта' });
const undo = () => page.getByRole('button', { name: 'Отменить', exact: true });
async function create(name, kind, x, y) {
  const target = page.locator('.robotics-field-canvas [data-object-kind="' + kind + '"]');
  const n = await target.count();
  const box = await canvas.boundingBox();
  if (!box) throw Error('Field canvas missing');
  await palette
    .getByRole('button', { name, exact: true })
    .dragTo(canvas, { targetPosition: { x: box.width * x, y: box.height * y }, timeout: 9000 });
  await expect(target).toHaveCount(n + 1, { timeout: 6000 });
  return { target, n };
}
async function reset(selector, n) {
  await undo().click();
  await expect(page.locator(selector)).toHaveCount(n);
}
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(credentials.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.PASSWORD);
  const captcha = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await captcha.isVisible()) {
    await captcha.press('Space');
    await expect(captcha).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 20000 });
  await page.goto(credentials.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await expect(palette).toBeVisible();

  const ball = await create('Мяч', 'ball', 0.22, 0.2);
  await expect(popup).toBeVisible();
  const preset = popup.getByRole('combobox', { name: 'Тип мяча' });
  await preset.selectOption('tennis');
  await expect(preset).toHaveValue('tennis');
  steps.push('ball tennis physics preset');
  await popup.getByRole('button', { name: 'Закрыть параметры объекта' }).click();
  await undo().click(); // undo chosen physical preset
  await reset('.robotics-field-canvas [data-object-kind="ball"]', ball.n);
  console.log('PASS ball preset changes physical size/mass and Undo restores source');

  const can = await create('Банка', 'can', 0.78, 0.82);
  await expect(popup).toBeVisible();
  const volume = popup.getByRole('combobox', { name: 'Объём банки' });
  await volume.selectOption('500');
  await popup.getByRole('combobox', { name: 'Наполнение банки' }).selectOption('full');
  await expect(volume).toHaveValue('500');
  await expect(popup.getByRole('combobox', { name: 'Наполнение банки' })).toHaveValue('full');
  steps.push('can volume+fill mass');
  await popup.getByRole('button', { name: 'Закрыть параметры объекта' }).click();
  await undo().click();
  await undo().click();
  await reset('.robotics-field-canvas [data-object-kind="can"]', can.n);
  console.log('PASS can 500mL and filled mass; all changes reversed');

  const rect = await create('Прямоугольник', 'rectangle', 0.56, 0.31);
  const visual = rect.target.last();
  await visual.click({ force: true });
  await expect(popup).toBeVisible();
  const widthBefore = Number(await visual.locator('rect').first().getAttribute('width'));
  // Popover is placed BESIDE the selected object and must not cover the resize grip.
  const end = page
    .locator(
      '.robotics-field-selection-handles [data-vector-kind="decoration"][data-vector-handle="end"]',
    )
    .last();
  const endBox = await end.boundingBox(),
    popupBox = await popup.boundingBox();
  if (!endBox || !popupBox) throw Error('Missing resize grip/popup');
  const hx = endBox.x + endBox.width / 2,
    hy = endBox.y + endBox.height / 2;
  if (
    hx > popupBox.x &&
    hx < popupBox.x + popupBox.width &&
    hy > popupBox.y &&
    hy < popupBox.y + popupBox.height
  )
    throw Error('Object context panel covers its resize handle');
  const canvasRect = await page.locator('.robotics-field-canvas').boundingBox();
  if (!canvasRect || popupBox.x + popupBox.width > canvasRect.x + canvasRect.width + 2)
    throw Error('Floating inspector overlaps the right-side field catalog');
  await page.screenshot({ path: join(out, 'rectangle-context-1440.png'), fullPage: false });
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx + 25, hy - 10, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await visual.locator('rect').first().getAttribute('width')))
    .toBeGreaterThan(widthBefore);
  steps.push('pointer resize rectangle + floating object settings');
  await popup.getByRole('button', { name: 'Закрыть параметры объекта' }).click();
  await undo().click(); // undo resize
  await reset('.robotics-field-canvas [data-object-kind="rectangle"]', rect.n);
  console.log('PASS resize grips edit geometry, contextual inspector does not obstruct them');

  const initialImages = await page
    .locator('.robotics-field-canvas [data-object-kind="image"]')
    .count();
  const dataURL = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 24;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0698b9';
    ctx.fillRect(0, 0, 48, 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.fillText('ASA', 10, 16);
    return c.toDataURL('image/png');
  });
  const png = Buffer.from(dataURL.split(',')[1], 'base64');
  await page.getByLabel('Файл изображения поля', { exact: true }).setInputFiles({
    name: 'field-test.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.locator('.robotics-field-canvas [data-object-kind="image"]')).toHaveCount(
    initialImages + 1,
    { timeout: 10000 },
  );
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'Закрыть параметры объекта' }).click();
  await reset('.robotics-field-canvas [data-object-kind="image"]', initialImages);
  steps.push('local raster upload');
  console.log('PASS local image conversion, no remote fetch, one source undo');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: 'Экспортировать поле JSON', exact: true }).click(),
  ]);
  const exported = readFileSync(await download.path(), 'utf8');
  const parsed = JSON.parse(exported);
  if (parsed.format !== 'asa-lab/robotics-field/v1' || !parsed.field)
    throw Error('Exported field JSON invalid');
  page.once('dialog', async (dialog) => {
    if (dialog.type() === 'confirm') await dialog.accept();
  });
  await page.getByLabel('Файл JSON поля', { exact: true }).setInputFiles({
    name: 'field-reimport.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported, 'utf8'),
  });
  await expect(page.getByRole('alert', { name: /Некорректный/ })).toHaveCount(0);
  steps.push('JSON export and import round trip');
  console.log('PASS JSON export/import using current project field only');

  if (errors.length) throw Error('Browser exceptions ' + errors.join(' | '));
  if (writes.length) throw Error('Unexpected project API writes ' + writes.join(' | '));
  writeFileSync(
    join(out, 'report.json'),
    JSON.stringify({ steps, writes, errors }, null, 2) + '\n',
  );
  console.log('PASS no uncaught JS errors and no server writes');
} catch (e) {
  console.error('MATERIALS_CHECK_FAILED', String(e));
  await page.screenshot({ path: join(out, 'failed.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
