#!/usr/bin/env node
// Focused visual and interaction acceptance for native Robotics/Electronics parity.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const home = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const account = Object.fromEntries(
  readFileSync(join(home, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((s) => s.includes('='))
    .map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]),
);
const base = 'http://127.0.0.1:4630';
if (!account.URL?.startsWith(base + '/#/home/'))
  throw new Error('Only D2-R2 local account accepted');
const proof = join(process.cwd(), 'e2e/artifacts/robotics-electronics-parity-004');
mkdirSync(proof, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
const requests = [];
let phase = 'loading';
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin === base && url.pathname.startsWith('/api/projects')) {
    requests.push({ phase, method: request.method(), path: url.pathname });
  }
});

const electronics = () => page.getByRole('tab', { name: 'Электроника', exact: true });
const code = () => page.getByRole('tab', { name: 'Код', exact: true });
const toolbar = () => page.getByRole('toolbar', { name: 'Инструменты электроники' });
async function screenshot(name) {
  await page.screenshot({ path: join(proof, name), fullPage: false });
}
async function layout(width, mode) {
  const data = await page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: +r.x.toFixed(1),
        right: +r.right.toFixed(1),
        y: +r.y.toFixed(1),
        height: +r.height.toFixed(1),
        width: +r.width.toFixed(1),
      };
    };
    const program = document.querySelector('.robotics-program-panel');
    const observer = document.querySelector('.robotics-observation');
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panel: rect('.robotics-electronics-panel'),
      toolbar: rect('.robotics-electronics-tools'),
      stage: rect('.robotics-schematic.editing'),
      code: rect('.robotics-program-panel'),
      fullCode: program?.getAttribute('data-drawer-open'),
      observationDisplay: observer ? getComputedStyle(observer).display : null,
      panelBorder: document.querySelector('.robotics-electronics-panel')
        ? getComputedStyle(document.querySelector('.robotics-electronics-panel')).borderTopWidth
        : null,
    };
  });
  if (data.documentWidth > width)
    throw new Error(mode + ' horizontal overflow ' + JSON.stringify(data));
  if (data.panelBorder !== '0px')
    throw new Error('Redundant panel frame still visible: ' + JSON.stringify(data));
  console.log('PASS ' + mode + ' ' + width + 'px, no frame/overflow');
  return data;
}

try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(account.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(account.PASSWORD);
  const challenge = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await challenge.isVisible()) {
    await challenge.press('Space');
    await expect(challenge).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25_000 });
  await page.goto(account.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 30_000 });
  phase = 'editor';
  await electronics().click();
  await expect(toolbar()).toBeVisible();
  await expect(page.locator('.robotics-electronics-panel .robotics-edit-hint')).toHaveCount(0);
  await expect(toolbar().locator('.workbench-breadboard-tools')).toBeVisible();
  await expect(toolbar().locator('.robotics-electronics-tool-label')).toHaveCount(0);
  const copy = toolbar().getByRole('button', { name: 'Копировать (Ctrl+C)' });
  await expect(copy).toHaveAttribute('data-workbench-tooltip', 'Копировать (Ctrl+C)');
  await copy.hover();
  await expect(page.locator('.workbench-tooltip')).toContainText('Копировать');
  console.log('PASS same native icon tools and hover help');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
    await expect(toolbar()).toBeVisible();
    await screenshot('electronics-' + width + '.png');
    await layout(width, 'electronics');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const catalog = toolbar().getByRole('button', { name: 'Компоненты' });
  await catalog.click();
  await expect(catalog).toHaveAttribute('aria-pressed', 'true');
  const panel = page.locator('.robotics-schematic.editing .workbench-library');
  await expect(panel).toBeVisible();
  const measurements = await panel.evaluate((el) => {
    const card = el.querySelector('.workbench-catalog-card');
    return {
      width: el.getBoundingClientRect().width,
      cardWidth: card?.getBoundingClientRect().width ?? null,
      font: card ? getComputedStyle(card).fontSize : null,
    };
  });
  if (measurements.width > 245)
    throw new Error('Library not compact ' + JSON.stringify(measurements));
  if (measurements.cardWidth && measurements.cardWidth > 78) {
    throw new Error('Component images not compact ' + JSON.stringify(measurements));
  }
  await screenshot('catalog-compact-1440.png');
  console.log('PASS compact shared library', JSON.stringify(measurements));

  const stage = page.locator('.robotics-schematic.editing .workbench-main');
  await expect(stage).toBeVisible();
  await stage.evaluate((element) => {
    element.dataset['sharedStageProof'] = 'unchanged';
  });
  await toolbar().getByRole('button', { name: 'Открыть код' }).click();
  const drawer = page.getByRole('region', { name: 'Выдвижной редактор кода Arduino' });
  await expect(drawer).toBeVisible({ timeout: 20_000 });
  await expect(drawer.locator('.arduino-code-panel')).toBeVisible({ timeout: 20_000 });
  const drawerLayout = await layout(1440, 'drawer');
  if (!drawerLayout.code || drawerLayout.code.width < 420 || drawerLayout.code.width > 960) {
    throw new Error('Drawer size is not partial screen ' + JSON.stringify(drawerLayout));
  }
  await screenshot('electronics-code-drawer-1440.png');
  await expect(stage).toHaveAttribute('data-shared-stage-proof', 'unchanged');
  await toolbar().getByRole('button', { name: 'Закрыть код' }).click();
  await expect(drawer).toHaveCount(0);
  console.log('PASS code slides out over part of the electronics, shared stage remains mounted');

  await code().click();
  const full = page.locator('#robotics-panel-program');
  await expect(full).toBeVisible();
  await expect(full.locator('.arduino-code-panel')).toBeVisible();
  const fullscreen = await layout(1440, 'fullscreen-code');
  if (
    !fullscreen.code ||
    fullscreen.code.width < 1400 ||
    fullscreen.observationDisplay !== 'none'
  ) {
    throw new Error('Code tab is not full width ' + JSON.stringify(fullscreen));
  }
  await screenshot('code-full-1440.png');
  await electronics().click();
  await expect(stage).toHaveAttribute('data-shared-stage-proof', 'unchanged');
  console.log('PASS fullscreen Код and no duplicate electronic/Arduino stage');

  await page.setViewportSize({ width: 390, height: 844 });
  await toolbar().getByRole('button', { name: 'Открыть код' }).click();
  await expect(page.getByRole('region', { name: 'Выдвижной редактор кода Arduino' })).toBeVisible();
  await screenshot('electronics-code-drawer-390.png');
  await toolbar().getByRole('button', { name: 'Закрыть код' }).click();
  await code().click();
  await expect(full).toBeVisible();
  await screenshot('code-full-390.png');
  console.log('PASS mobile drawer and fullscreen Code');

  if (errors.length) throw new Error('Uncaught browser errors ' + errors.join(' | '));
  const writes = requests.filter((entry) => entry.phase === 'editor' && entry.method !== 'GET');
  if (writes.length) throw new Error('UI changes caused server mutation ' + JSON.stringify(writes));
  writeFileSync(
    join(proof, 'report.json'),
    JSON.stringify({ library: measurements, requests, errors }, null, 2),
  );
  console.log('PASS zero mutation requests during UI interactions and no page errors');
} catch (err) {
  console.error('VISUAL_TEST_FAILED', String(err));
  await screenshot('failure.png').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
