#!/usr/bin/env node
/**
 * LOCAL ONLY — owner browser review against the running demo (4610/4611).
 *
 * Captures the C1.1 review screens in Chromium and records console errors,
 * page errors and failed requests for each one, so the evidence is produced
 * the same way twice instead of by hand. The teacher password is read from the
 * local credential file and never printed.
 *
 * Usage: node tools/demo-browser-review.mjs <class code>
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'e2e/artifacts/c11/demo';
mkdirSync(OUT, { recursive: true });

const creds = readFileSync(
  join(process.env.LOCALAPPDATA, 'asa-lab-devenv', 'seed-teacher-credentials.txt'),
  'utf8',
);
const value = (key) => creds.match(new RegExp(`^${key}=(.*)$`, 'm'))[1].trim();
const workspace = value('workspace');
const email = value('email');
const password = value('password');
const classCode = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Two answers are deliberate parts of the product and the browser logs them
// as failed loads: "no session yet" (401 on /api/auth/me) and "registration is
// closed" (503 on /api/auth/register). Everything else counts as a problem.
const EXPECTED = [
  { url: '/api/auth/me', status: 401 },
  { url: '/api/auth/register', status: 503 },
];
const problems = [];
const expected = [];
let current = 'startup';
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (text.includes('Failed to load resource')) return; // judged by response below
  problems.push(`${current}: console ${text}`);
});
page.on('pageerror', (e) => problems.push(`${current}: page ${String(e)}`));
page.on('requestfailed', (r) => {
  // A request the browser cancels because the page moved on is not a failure.
  if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
  problems.push(`${current}: request ${r.url()} ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() < 400) return;
  const match = EXPECTED.find(
    (entry) => r.url().includes(entry.url) && r.status() === entry.status,
  );
  if (match) {
    expected.push(`${current}: ${r.status()} ${match.url} (by design)`);
    return;
  }
  problems.push(`${current}: response ${r.status()} ${r.url()}`);
});

async function shot(name) {
  current = name;
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}`);
}

await page.goto('http://127.0.0.1:4610/');
await page.waitForSelector('[data-testid="entry-sign-in"]');
await shot('01-public-entry');

await page.getByTestId('entry-sign-in').click();
await page.waitForSelector('#identifier');
await shot('02-sign-in');

await page.reload();
await page.waitForSelector('#identifier');
await shot('03-sign-in-after-refresh');

await page.goto('http://127.0.0.1:4610/#/sign-up');
await page.waitForSelector('[data-testid="sign-up-age"]');
await shot('04-sign-up-age');

await page.getByLabel('Дата рождения').fill('2014-01-01');
await page.getByRole('button', { name: 'Продолжить' }).click();
await page.waitForSelector('[data-testid="sign-up-student"]');
await shot('05-minor-routes');

await page.getByRole('button', { name: '← Назад' }).click();
await page.getByLabel('Дата рождения').fill('1990-05-17');
await page.getByRole('button', { name: 'Продолжить' }).click();
await page.waitForSelector('[data-testid="sign-up-account"]');
await page.getByLabel('Имя пользователя').fill(`demo-check-${Date.now()}`);
await page.getByLabel('Email').fill(`demo-check-${Date.now()}@test.local`);
await page.getByLabel('Пароль').fill('sufficiently-long-pass');
await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
await page.waitForSelector('[data-testid="register-error"]');
await shot('06-registration-disabled');

await page.goto('http://127.0.0.1:4610/#/join-class');
await page.waitForSelector('[data-testid="class-code"]');
await shot('07-class-code');

await page.getByTestId('class-code').fill(classCode);
await page.getByRole('button', { name: 'Продолжить' }).click();
await page.waitForSelector('[data-testid="class-preview"]');
await shot('08-class-preview');

await page.getByTestId('join-with-account').click();
await page.waitForSelector('[data-testid="sign-in-intro"]');
await shot('09-account-path-intent');

await page.getByLabel('Email или имя пользователя').fill(email);
await page.getByLabel('Пароль').fill(password);
await page.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForSelector('[data-testid="join-pending"]');
// Let the server confirm the intent before reloading, so the check is real.
await page.waitForResponse((r) => r.url().includes('/api/join-class/intent'));
await page.reload();
await page.waitForSelector('[data-testid="join-pending-title"]');
await shot('10-join-pending-after-refresh');

await page.getByTestId('join-pending-continue').click();
await page.waitForSelector('text=Мои проекты');
await shot('11-seed-teacher-projects');

await page.getByRole('button', { name: 'Классы' }).click();
await page.waitForSelector('text=Мои классы');
await shot('12-seed-teacher-classes');

// Legacy organization sign-in, on its own screen.
await page.getByRole('button', { name: 'Выйти' }).click();
await page.waitForSelector('[data-testid="entry-sign-in"]');
await page.getByTestId('entry-sign-in').click();
await page.getByRole('button', { name: 'Вход для ранее подключённой организации' }).click();
await page.waitForSelector('#workspace');
await shot('13-organization-sign-in');
await page.getByLabel('Код организации').fill(workspace);
await page.getByLabel('Email').fill(email);
await page.getByLabel('Пароль').fill(password);
await page.getByRole('button', { name: 'Войти через организацию' }).click();
await page.waitForSelector('text=Мои проекты');
await shot('14-organization-sign-in-result');

await browser.close();

for (const entry of expected) console.log(`expected: ${entry}`);
if (problems.length > 0) {
  console.error('PROBLEMS:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('demo review clean: no console errors, no page errors, no failed requests.');
