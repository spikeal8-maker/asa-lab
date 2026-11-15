#!/usr/bin/env node
// Browser-only request-budget check for the isolated D2-R2 Robotics Portal.
// Reads local demo credentials, never prints them or accesses another server.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const root = process.cwd();
const local = join(process.env.LOCALAPPDATA ?? '.', 'ASA-Lab-Robotics-Fast-Dev-001');
const config = Object.fromEntries(
  readFileSync(join(local, 'demo-login.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const baseURL = 'http://127.0.0.1:4630';
if (!config.URL?.startsWith(baseURL + '/#/home/')) {
  throw new Error('Only the isolated D2-R2 demo project is allowed');
}
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const requests = [];
const pageErrors = [];
let phase = 'loading';
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.origin !== baseURL || !url.pathname.startsWith('/api/')) return;
  requests.push({ phase, method: request.method(), path: url.pathname });
});
const phaseRequests = (name) => requests.filter((item) => item.phase === name);
const noBackgroundTraffic = (name) => {
  const calls = phaseRequests(name);
  if (calls.length) {
    throw new Error(name + ' sent unexpected API calls: ' + JSON.stringify(calls));
  }
  console.log('PASS ' + name + ': 0 API requests');
};
try {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.locator('.public-home-header-actions').getByRole('button', { name: 'Войти' }).click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(config.EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(config.PASSWORD);
  const bot = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await bot.isVisible()) {
    await bot.press('Space');
    await expect(bot).toBeChecked();
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 25000 });
  await page.goto(config.URL, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 30000 });
  const save = page.getByRole('button', { name: 'Сохранить', exact: true });
  await expect(save).toHaveAttribute('data-save-state', 'saved', { timeout: 20000 });
  await page.waitForTimeout(2_000);

  phase = 'idle';
  await page.waitForTimeout(7_000);
  noBackgroundTraffic('idle');

  phase = 'simulation';
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect
    .poll(
      async () => Number(await page.getByTestId('robotics-time').getAttribute('data-microseconds')),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(6_000);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  noBackgroundTraffic('simulation');

  const title = page.getByRole('textbox', { name: 'Название проекта', exact: true });
  const original = await title.inputValue();
  phase = 'typing';
  await title.fill(original + ' · проверка сети');
  await title.press('Tab');
  await expect(save).toHaveAttribute('data-save-state', 'dirty');
  await page.waitForTimeout(2_000);
  noBackgroundTraffic('typing');

  phase = 'manual-save';
  await save.click();
  await expect(save).toHaveAttribute('data-save-state', 'saved', { timeout: 20000 });
  const first = phaseRequests('manual-save').filter((item) =>
    item.path.startsWith('/api/projects'),
  );
  if (first.length !== 1 || first[0].method !== 'PATCH' || first[0].path.includes('snapshot')) {
    throw new Error(
      'Expected exactly one title PATCH on manual Save; observed: ' + JSON.stringify(first),
    );
  }
  console.log('PASS manual Save: exactly one title PATCH, no image upload');

  phase = 'restoring-title';
  await title.fill(original);
  await title.press('Tab');
  await save.click();
  await expect(save).toHaveAttribute('data-save-state', 'saved', { timeout: 20000 });

  const result = {
    checks: ['idle', 'simulation', 'typing', 'manual-save', 'restoring-title'],
    requests,
    pageErrors,
  };
  if (pageErrors.length) throw new Error('Uncaught page exceptions: ' + pageErrors.join(' | '));
  const evidence = join(root, 'docs/testing/evidence/robotics-save-budget-001');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'request-audit.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS no uncaught browser errors');
  console.log(
    'API_REQUEST_SUMMARY=' +
      JSON.stringify(
        result.checks.map((name) => ({
          phase: name,
          count: phaseRequests(name).length,
          requests: phaseRequests(name).map(({ method, path }) => method + ' ' + path),
        })),
      ),
  );
} catch (error) {
  console.error('NETWORK_AUDIT_FAILED', String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
