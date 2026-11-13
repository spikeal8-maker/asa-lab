#!/usr/bin/env node
// Validates the actual Account Portal -> ModuleEditorHost -> RoboticsField/Electronics
// on the existing isolated D2-R2 demo project, without touching shared servers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const local = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const config = Object.fromEntries(
  readFileSync(join(local, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const origin = 'http://127.0.0.1:4630';
if (!config.URL?.startsWith(origin + '/#/home/')) {
  throw new Error('Expected the private D2-R2 Robotics account project');
}
const outputDir = join(process.cwd(), 'e2e/artifacts/robotics-field-electronics-003');
mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 900 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin === origin && url.pathname.startsWith('/api/projects'))
    requests.push({ method: request.method(), path: url.pathname });
});
const metrics = [];
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(config.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(config.PASSWORD);
  const robotCheck = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await robotCheck.isVisible()) {
    await robotCheck.press('Space');
    await expect(robotCheck).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25000 });
  await page.goto(config.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 35_000 });
  const fieldTab = page.getByRole('tab', { name: 'Поле', exact: true });
  const electronicsTab = page.getByRole('tab', { name: 'Электроника', exact: true });
  const undo = page.getByRole('button', { name: 'Отменить', exact: true });
  const redo = page.getByRole('button', { name: 'Повторить', exact: true });
  const time = page.getByRole('status', { name: 'Время опыта' });
  const fieldTools = page.getByRole('toolbar', { name: 'Инструменты поля' });
  const fieldViewTools = page.locator('.robotics-field-view-tools');
  const electronicsTools = page.getByRole('toolbar', { name: 'Инструменты электроники' });

  await expect(page.locator('.robotics-footer')).toHaveCount(0);
  await expect(page.locator('.robotics-field-heading')).toHaveCount(0);
  await expect(fieldTools).toBeVisible();
  await expect(fieldViewTools).toBeVisible();
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(page.locator('.robotics-field-elapsed')).toBeVisible();
  console.log('PASS field: no redundant heading/footer; named history and live time in tools');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await fieldTab.click();
    await expect(fieldTools).toBeVisible();
    const field = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error('Missing ' + selector);
        const r = el.getBoundingClientRect();
        return {
          left: +r.left.toFixed(1),
          right: +r.right.toFixed(1),
          top: +r.top.toFixed(1),
          bottom: +r.bottom.toFixed(1),
        };
      };
      return {
        width: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        panel: rect('.robotics-field-panel'),
        toolbar: rect('.robotics-field-tools'),
        fieldView: rect('.robotics-field-view-tools'),
        history: rect('.robotics-field-history'),
        bottomGap: Math.round(
          innerHeight -
            document.querySelector('.robotics-field-panel').getBoundingClientRect().bottom,
        ),
      };
    });
    if (field.docWidth > width)
      throw new Error('Field overflow at ' + width + ': ' + JSON.stringify(field));
    if (field.bottomGap > (width <= 390 ? 180 : 22))
      throw new Error(
        'Field has redundant bottom space at ' + width + ': ' + JSON.stringify(field),
      );
    await page.screenshot({ path: join(outputDir, 'field-' + width + '.png'), fullPage: false });
    metrics.push({ section: 'field', ...field });
    console.log('PASS field ' + width + ': no footer, no overflow, expanded usable canvas');
  }

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await electronicsTab.click();
    await expect(electronicsTools).toBeVisible();
    for (const name of [
      'Компоненты',
      'Вписать',
      'Копировать',
      'Вставить',
      'Дублировать',
      'Повернуть',
      'Отразить',
      'Удалить',
      'Отменить',
      'Повторить',
      'Провод 90°',
      'Добавить текст',
    ]) {
      await expect(electronicsTools.getByRole('button', { name, exact: true })).toHaveCount(1);
    }
    await expect(
      electronicsTools.getByRole('group', { name: 'Цвет провода' }).getByRole('button'),
    ).toHaveCount(6);
    const view = await page.evaluate(() => {
      const toolbar = document.querySelector('.robotics-electronics-tools');
      const panel = document.querySelector('.robotics-electronics-panel');
      const workbench = document.querySelector('.robotics-schematic.editing');
      const r = toolbar.getBoundingClientRect();
      return {
        width: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        visibleToolbar: r.width,
        totalToolbar: toolbar.scrollWidth,
        top: +r.top.toFixed(1),
        panelBottom: +panel.getBoundingClientRect().bottom.toFixed(1),
        stageTop: +workbench.getBoundingClientRect().top.toFixed(1),
      };
    });
    if (view.docWidth > width)
      throw new Error('Electronics overflow at ' + width + ': ' + JSON.stringify(view));
    if (view.visibleToolbar < 100) throw new Error('Electronics toolbar too narrow at ' + width);
    await page.screenshot({
      path: join(outputDir, 'electronics-' + width + '.png'),
      fullPage: false,
    });
    metrics.push({ section: 'electronics', ...view });
    console.log('PASS electronics ' + width + ': full commands, scroll reachable, no overflow');
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(electronicsTools).toBeVisible();
  const toggle = electronicsTools.getByRole('button', { name: 'Провод 90°', exact: true });
  const before = await toggle.getAttribute('aria-pressed');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', before);
  const colors = electronicsTools.getByRole('group', { name: 'Цвет провода' }).getByRole('button');
  await colors.nth(2).click();
  await expect(colors.nth(2)).toHaveAttribute('aria-pressed', 'true');
  console.log('PASS shared electronics wire routing and palette state');

  const libraryToggle = electronicsTools.getByRole('button', { name: 'Компоненты', exact: true });
  const libraryBefore = await libraryToggle.getAttribute('aria-pressed');
  await libraryToggle.click();
  await expect(libraryToggle).toHaveAttribute(
    'aria-pressed',
    libraryBefore === 'true' ? 'false' : 'true',
  );
  const workbench = page.locator('#robotics-scheme .robotics-workbench');
  if (libraryBefore === 'false') {
    await expect(workbench).not.toHaveClass(/library-collapsed/);
    await page.screenshot({
      path: join(outputDir, 'electronics-catalog-open-1440.png'),
      fullPage: false,
    });
  }
  await libraryToggle.click();
  await expect(libraryToggle).toHaveAttribute('aria-pressed', libraryBefore);
  console.log('PASS real electronics component catalog opens and closes');

  if (errors.length) throw new Error('Uncaught JavaScript errors: ' + errors.join(' | '));
  if (requests.some((item) => item.method !== 'GET'))
    throw new Error(
      'UI-only navigation sent unexpected project mutations: ' + JSON.stringify(requests),
    );
  writeFileSync(
    join(outputDir, 'layout-audit.json'),
    JSON.stringify({ measurements: metrics, requests }, null, 2) + '\n',
  );
  console.log('PASS no project mutation and no browser JavaScript errors');
} catch (err) {
  console.error('BROWSER_CHECK_FAILED', String(err));
  await page.screenshot({ path: join(outputDir, 'failure.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
