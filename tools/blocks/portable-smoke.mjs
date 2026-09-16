import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// CI-only disposable installation. Never point this at a working user database.
assert.equal(process.env.CI, 'true', 'portable smoke requires an isolated CI runner');
const root = path.resolve(process.env.ASA_PORTABLE_ROOT ?? '');
assert.ok(path.basename(root).startsWith('asa-portable-'));
assert.ok(
  !fs.existsSync(path.join(root, '.git')),
  'use exported tracked sources, not developer files',
);
const values = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
assert.equal(values.ASA_SEED_DEV, 'true');
const origin = 'http://127.0.0.1:4610';
const out = path.resolve('reports/blocks/portable-install');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  baseURL: origin,
  viewport: { width: 1440, height: 960 },
  locale: 'en-US',
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const ready = await (await context.request.get('/health/ready')).json();
  const metadata = await (await context.request.get('/build-metadata.json')).json();
  expect(ready.deployment.revision).toBe(process.env.ASA_BUILD_REVISION);
  expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
  expect(ready.deployment.synchronized).toBe(true);
  const login = await context.request.post('/api/auth/login', {
    headers: { origin },
    data: { identifier: values.ASA_SEED_TEACHER_EMAIL, password: values.ASA_SEED_TEACHER_PASSWORD },
  });
  expect(login.status()).toBe(200);
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: 'Программирование · Scratch', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: path.join(out, 'home.png'), fullPage: true });
  await page.getByRole('button', { name: 'Создать программу', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Scratch runtime"]');
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 45000 },
  );
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    'http://localhost:4613/?asaStatus=parent',
  );
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(frame.locator('#runtime-status')).toBeHidden();
  const box = await page.locator('iframe').boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 1440, height: 960 });
  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-project-running',
    'true',
  );
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  await frame.getByText('File', { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    frame.getByText('Save to your computer', { exact: true }).click(),
  ]);
  await download.saveAs(path.join(out, 'fresh-install.sb3'));
  expect(await download.failure()).toBeNull();
  await page.screenshot({ path: path.join(out, 'editor.png') });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'ASA Lab — на главную', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(
    page.getByRole('heading', { name: 'Программирование · Scratch', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  fs.writeFileSync(
    path.join(out, 'result.json'),
    JSON.stringify(
      {
        revision: metadata.revision,
        result: 'PASS',
        scenario:
          'archive → standard up twice → seeded login → home → create → real editor → native download → home',
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
