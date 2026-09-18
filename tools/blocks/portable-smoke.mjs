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
// A non-secret HttpOnly marker proves the iframe does not receive portal cookies.
const cookieProbe = 'asa_portable_host_cookie';
await context.addCookies([
  { name: cookieProbe, value: 'isolation-test', domain: '127.0.0.1', path: '/', httpOnly: true },
]);
let runtimeRequests = 0;
let portalCookieLeaked = false;
await context.route(/^http:\/\/(?:localhost|127\.0\.0\.1):4613\//, async (route) => {
  const headers = await route.request().allHeaders();
  runtimeRequests += 1;
  portalCookieLeaked ||= (headers['cookie'] ?? '').includes(`${cookieProbe}=`);
  await route.continue();
});
const page = await context.newPage();
const errors = [];
let phase = 'readiness';
page.on('pageerror', (error) => errors.push(error.message));
try {
  const ready = await (await context.request.get('/health/ready')).json();
  const metadata = await (await context.request.get('/build-metadata.json')).json();
  expect(ready.deployment.revision).toBe(process.env.ASA_BUILD_REVISION);
  expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
  expect(ready.deployment.synchronized).toBe(true);
  phase = 'host-runtime-port';
  for (const host of ['localhost', '127.0.0.1']) {
    const health = await context.request.get(`http://${host}:4613/healthz`, { timeout: 10000 });
    expect(health.status(), 'runtime must be reachable from the host, not only docker exec').toBe(
      200,
    );
  }
  phase = 'organization-login';
  const login = await context.request.post('/api/auth/login', {
    headers: { origin },
    // The standard seed creates an organization membership, not a personal workspace.
    // Exercise the existing school-login contract; do not change product authorization.
    data: {
      workspace: values.ASA_SEED_WORKSPACE,
      email: values.ASA_SEED_TEACHER_EMAIL,
      password: values.ASA_SEED_TEACHER_PASSWORD,
    },
  });
  expect(login.status(), 'seeded organization login').toBe(200);
  phase = 'home-create-editor';
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
  expect(runtimeRequests).toBeGreaterThan(0);
  expect(portalCookieLeaked, 'Scratch must not receive the portal host cookie').toBe(false);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(frame.locator('#runtime-status')).toBeHidden();
  const box = await page.locator('iframe').boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 1440, height: 960 });
  const shell = frame.locator('[data-asa-host-shell]');
  await frame.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(shell).not.toHaveAttribute('data-runtime-state', 'error');
  await frame.getByRole('button', { name: 'Stop project', exact: true }).click();
  await expect(shell).toHaveAttribute('data-project-running', 'false');
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
        portalCookieLeaked,
        runtimeRequests,
        scenario:
          'archive → standard up twice → seeded login → home → create → real editor → native download → home',
        errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  fs.writeFileSync(
    path.join(out, 'failure.json'),
    JSON.stringify({ phase, error: String(error), pageErrors: errors }, null, 2),
  );
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
