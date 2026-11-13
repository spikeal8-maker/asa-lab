#!/usr/bin/env node
// Focused local-only browser acceptance. Does not modify project data or shared servers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const stateDir = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const login = Object.fromEntries(
  readFileSync(join(stateDir, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const origin = 'http://127.0.0.1:4630';
if (!login.URL?.startsWith(origin + '/#/home/'))
  throw new Error('Refusing non-local Robotics project');

const evidence = join(process.cwd(), 'e2e/artifacts/robotics-left-rail-005');
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: origin,
  locale: 'ru-RU',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const failures = [];
const writes = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (
    url.origin === origin &&
    url.pathname.startsWith('/api/projects') &&
    !['GET', 'HEAD'].includes(request.method())
  )
    writes.push(request.method() + ' ' + url.pathname);
});
const results = [];
const rect = async (selector) => page.locator(selector).first().boundingBox();

try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(login.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(login.PASSWORD);
  const bot = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await bot.isVisible()) {
    await bot.press('Space');
    await expect(bot).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 20_000 });
  await page.goto(login.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 35_000 });

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
    for (const section of [
      ['Поле', 'field'],
      ['Робот', 'robot'],
      ['Электроника', 'electronics'],
      ['Код', 'program'],
    ]) {
      await page.getByRole('tab', { name: section[0], exact: true }).click();
      await expect(page.getByTestId('robotics-lab')).toHaveAttribute('data-section', section[1]);
      const sidebar = await rect('.robotics-observation');
      const editor =
        section[1] === 'electronics'
          ? await rect('.robotics-schematic.editing')
          : await rect('#robotics-panel-' + section[1]);
      const runbar = await rect('.robotics-run-bar');
      const header = await rect('.robotics-unified-header');
      const workspace = await rect('.robotics-workspace');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
      if (!sidebar || !editor || !workspace || !runbar || !header)
        throw new Error('Missing workspace element: ' + section[1]);
      if (overflow > width + 1)
        throw new Error('Horizontal overflow ' + JSON.stringify({ width, section, overflow }));
      if (runbar.y < header.y + header.height - 1 || runbar.y + runbar.height > workspace.y + 1)
        throw new Error(
          'Run controls overlap editor: ' + JSON.stringify({ width, section, runbar, workspace }),
        );
      if (width > 760) {
        if (sidebar.x + sidebar.width > editor.x + 2)
          throw new Error(
            'Left sidebar overlaps active editor: ' +
              JSON.stringify({ width, section, sidebar, editor }),
          );
      } else if (sidebar.y < editor.y + editor.height - 2)
        throw new Error('Mobile observation area overlaps editor');
      if (section[1] === 'program') {
        await expect(page.locator('.robotics-mini-field')).toBeVisible();
      }
      if (section[1] === 'electronics') {
        await expect(page.locator('.robotics-electronics-catalog')).toHaveCount(0);
        const toolbar = await rect('.robotics-electronics-toolbar');
        if (!toolbar || runbar.y + runbar.height > toolbar.y + 1)
          throw new Error('Simulator controls cover Electronics buttons');
        const native = page.getByRole('toolbar', { name: 'Инструменты электроники' });
        await expect(native.getByRole('button', { name: 'Повернуть на 45° (R)' })).toHaveCount(1);
      }
      results.push({ width, section: section[1], sidebar, editor, runbar, workspace });
      if (width === 1440 || width === 390)
        await page.screenshot({
          path: join(evidence, section[1] + '-' + width + '.png'),
          fullPage: false,
        });
      console.log('PASS ' + section[1] + ' ' + width + ': sidebar, runbar, no overlap');
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Электроника' }).click();
  const splitter = page.getByRole('separator', { name: 'Ширина панели наблюдения' });
  await expect(splitter).toBeVisible();
  await splitter.focus();
  await splitter.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', '180');
  await splitter.press('End');
  const maximum = Number(await splitter.getAttribute('aria-valuemax'));
  const after = Number(await splitter.getAttribute('aria-valuenow'));
  if (after !== maximum || after > 720)
    throw new Error('Resizable rail exceeded half of workspace: ' + after);
  await splitter.press('Home');
  await splitter.press('ArrowRight');
  await expect(splitter).toHaveAttribute('aria-valuenow', '196');
  const saved = await page.evaluate(() => localStorage.getItem('asa-lab:robotics:side-width:v1'));
  if (saved !== '196') throw new Error('Rail width not persisted locally');
  console.log('PASS keyboard resizing 180px to max half-screen and persisted locally');

  const bounds = await splitter.boundingBox();
  if (!bounds) throw new Error('Splitter bounding box missing');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 52, bounds.y + 70, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(await splitter.getAttribute('aria-valuenow'));
  if (dragged <= 196) throw new Error('Pointer drag did not increase rail width');
  console.log('PASS pointer drag increases left rail width');

  const stage = page.locator('.robotics-schematic.editing');
  await expect(stage).toBeVisible();
  const fit = page
    .getByRole('toolbar', { name: 'Инструменты электроники' })
    .getByRole('button', { name: 'Вписать' });
  await fit.click();
  const stageReadout = stage.locator('.workbench-stage-controls [aria-label^="Масштаб"]');
  await expect(stageReadout).toBeVisible();
  const zoomText = await stageReadout.getAttribute('aria-label');
  console.log('Robotics half-fit zoom readout: ' + zoomText);

  const catalog = stage.locator('.workbench-library');
  await expect(catalog).toBeVisible();
  const item = stage.locator('.workbench-catalog-card').first();
  await expect(item).toBeVisible();
  const visual = await item.evaluate((node) => {
    const art = node.querySelector('.workbench-catalog-art');
    const name = node.querySelector('.workbench-catalog-name');
    const a = art?.getBoundingClientRect();
    const n = name?.getBoundingClientRect();
    return {
      artBottom: a?.bottom,
      nameTop: n?.top,
      artWidth: a?.width,
      imageHeight: art
        ?.querySelector('.workbench-component-preview, .workbench-component-vector-preview')
        ?.getBoundingClientRect().height,
    };
  });
  if (visual.artBottom > visual.nameTop + 2 || visual.imageHeight > 42)
    throw new Error('Component art overlaps its label ' + JSON.stringify(visual));
  console.log('PASS catalog art and labels separated, no giant previews');

  if (failures.length) throw new Error('Browser errors: ' + failures.join(' | '));
  if (writes.length) throw new Error('Layout changes wrote to server: ' + writes.join(' | '));
  writeFileSync(
    join(evidence, 'measurements.json'),
    JSON.stringify({ results, zoomText, visual }, null, 2),
  );
  console.log('PASS no API mutations, no JavaScript errors');
} catch (error) {
  console.error('LEFT_RAIL_CHECK_FAILED', String(error));
  await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
