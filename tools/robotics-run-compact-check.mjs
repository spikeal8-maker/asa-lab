#!/usr/bin/env node
// Read-only layout checks, then local-only simulation interaction on D2-R2.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const dir = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const account = Object.fromEntries(
  readFileSync(join(dir, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
if (!account.URL?.startsWith('http://127.0.0.1:4630/#/home/')) {
  throw new Error('Refusing to access anything except the local D2-R2 account project');
}
const path = join(process.cwd(), 'e2e/artifacts/robotics-run-compact-002');
mkdirSync(path, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: 'http://127.0.0.1:4630',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const reports = [];
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(account.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(account.PASSWORD);
  const challenge = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await challenge.isVisible()) {
    await challenge.press('Space');
    await expect(challenge).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25000 });
  await page.goto(account.URL, { waitUntil: 'domcontentloaded' });
  const editor = page.getByTestId('robotics-account-editor');
  const bar = page.locator('.robotics-run-bar');
  const notice = page.getByTestId('robotics-notice');
  const clock = page.getByRole('button', { name: 'Изменить скорость моделирования' });
  await expect(editor).toBeVisible({ timeout: 30000 });
  await expect(bar).toBeVisible();
  await expect(clock).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сбросить', exact: true })).toBeVisible();
  await expect(notice).toHaveAttribute('hidden', '');
  console.log('PASS correct control set and no empty notification strip');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
    await expect(bar).toBeVisible();
    const data = await page.evaluate(() => {
      const rect = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {
          left: +r.left.toFixed(1),
          right: +r.right.toFixed(1),
          top: +r.top.toFixed(1),
          bottom: +r.bottom.toFixed(1),
        };
      };
      return {
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        header: rect('.robotics-unified-header'),
        bar: rect('.robotics-run-bar'),
        main: rect('.robotics-panel:not([hidden])'),
        observation: rect('.robotics-observation'),
        workspace: rect('.robotics-workspace'),
        clock: rect('.workbench-simulation-clock-button'),
        controls: rect('.robotics-run-buttons'),
      };
    });
    if (data.document > width)
      throw new Error('Horizontal overflow at ' + width + ': ' + JSON.stringify(data));
    if (data.bar.right > width + 1 || data.bar.right < width - 32)
      throw new Error(
        'Run buttons are not right aligned at ' + width + ': ' + JSON.stringify(data),
      );
    if (width > 760) {
      if (data.main.top - data.header.bottom > 16)
        throw new Error(
          'Main editor was not raised below header at ' + width + ': ' + JSON.stringify(data),
        );
      if (data.observation.top < data.bar.bottom - 2)
        throw new Error(
          'Run controls overlap the right observation panel: ' + JSON.stringify(data),
        );
    } else if (data.main.top < data.bar.bottom - 2) {
      throw new Error('Mobile run controls overlap editor: ' + JSON.stringify(data));
    }
    await page.screenshot({ path: join(path, 'editor-' + width + '.png'), fullPage: false });
    await bar.screenshot({ path: join(path, 'runbar-' + width + '.png') });
    reports.push(data);
    console.log('PASS layout ' + width + ': compact right controls, no overflow/overlap');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await clock.click();
  const dialog = page.getByRole('dialog', { name: 'Скорость моделирования' });
  await expect(dialog).toBeVisible();
  const slider = dialog.getByRole('slider');
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', '×10');
  await dialog.screenshot({ path: join(path, 'speed-10x.png') });
  await expect(page.locator('.robotics-run-bar .workbench-simulation-rate')).toHaveText('×10');
  await slider.press('Home');
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '×0,1');
  await dialog.getByRole('button', { name: '×1', exact: true }).click();
  await expect(page.locator('.robotics-run-bar .workbench-simulation-rate')).toHaveText('×1');
  await clock.click();
  console.log('PASS shared physics speed slider: 0.1× to 10×, reset to 1×');

  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Остановить', exact: true });
  await expect(stop).toBeVisible();
  await expect(stop).toBeEnabled({ timeout: 25_000 });
  await bar.screenshot({ path: join(path, 'runbar-running-1440.png') });
  const pause = page.getByRole('button', { name: 'Пауза', exact: true });
  await pause.click();
  const resume = page.getByRole('button', { name: 'Продолжить', exact: true });
  await expect(resume).toBeVisible();
  await expect(resume).toBeEnabled({ timeout: 25_000 });
  await bar.screenshot({ path: join(path, 'runbar-paused-1440.png') });
  await resume.click();
  await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();
  await stop.click();
  await expect(page.getByRole('button', { name: 'Запустить', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(page.getByTestId('robotics-time')).toHaveAttribute('data-microseconds', '0');
  console.log('PASS start → stop, pause → resume, reset and zero clock');

  if (errors.length) throw new Error('Browser JavaScript errors: ' + errors.join(' | '));
  writeFileSync(join(path, 'layout-audit.json'), JSON.stringify(reports, null, 2) + '\n');
  console.log('PASS no page errors');
} catch (error) {
  console.error('VISUAL_CHECK_FAILED', String(error));
  await page.screenshot({ path: join(path, 'failure.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
