#!/usr/bin/env node
/**
 * LOCAL ONLY — the ACCOUNT-VERTICAL-001 owner gate, run against the live demo
 * (4610/4611) in Chromium with the real API.
 *
 * Create an account → be signed in → make an Electronics project → refresh →
 * sign out → sign in by username → sign out → sign in by email, checking the
 * project each time. Alongside it, the seeded teacher signs in and still has
 * their classes and projects.
 *
 * Console errors, page errors and failed requests are collected per screen and
 * make the run fail; screenshots land in e2e/artifacts/account-vertical/demo.
 * The teacher password is read from the local credential file, never printed.
 *
 * Usage: node tools/demo-vertical-review.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'e2e/artifacts/account-vertical/demo';
mkdirSync(OUT, { recursive: true });

const creds = readFileSync(
  join(process.env.LOCALAPPDATA, 'asa-lab-devenv', 'seed-teacher-credentials.txt'),
  'utf8',
);
const value = (key) => creds.match(new RegExp(`^${key}=(.*)$`, 'm'))[1].trim();
const teacherWorkspace = value('workspace');
const teacherEmail = value('email');
const teacherPassword = value('password');

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const username = `creator${stamp}`;
const email = `${username}@test.local`;
const password = 'sufficiently-long-pass';
const projectTitle = `Схема ${stamp}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const problems = [];
let current = 'startup';
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`${current}: console ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`${current}: page ${String(error)}`));
page.on('requestfailed', (request) => {
  if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
  problems.push(`${current}: request ${request.url()} ${request.failure()?.errorText}`);
});
page.on('response', (response) => {
  if (response.status() >= 400)
    problems.push(`${current}: response ${response.status()} ${response.url()}`);
});

async function shot(name) {
  current = name;
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}`);
}

async function signIn(identifier) {
  await page.goto('http://127.0.0.1:4610/');
  await page.getByTestId('entry-sign-in').click();
  await page.getByLabel('Email или имя пользователя').fill(identifier);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForSelector('text=Мои проекты');
}

async function expectProject() {
  await page.waitForSelector(`[data-testid="personal-project-grid"] >> text=${projectTitle}`);
}

// 1. Public entry: only what works today is offered.
await page.goto('http://127.0.0.1:4610/');
await page.waitForSelector('[data-testid="entry-sign-in"]');
if ((await page.getByTestId('entry-class-code').count()) !== 0) {
  problems.push('public entry: class-code button is visible while the flag is off');
}
await shot('01-public-entry');

// 2–3. Sign up: age first, then the account; registration signs the person in.
await page.getByTestId('entry-sign-up').click();
await page.waitForSelector('[data-testid="sign-up-age"]');
await page.getByLabel('Дата рождения').fill('1990-05-17');
await page.getByRole('button', { name: 'Продолжить' }).click();
await page.waitForSelector('[data-testid="sign-up-account"]');
await shot('02-sign-up-account');

await page.getByLabel('Имя пользователя').fill(username);
await page.getByLabel('Email').fill(email);
await page.getByLabel('Пароль').fill(password);
await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
await page.waitForSelector('text=Мои проекты');
if ((await page.getByRole('button', { name: 'Классы' }).count()) !== 0) {
  problems.push('creator sees the Classes tab');
}
await shot('03-signed-in-after-registration');

// 4–6. A personal Electronics project, created and saved.
await page.getByRole('button', { name: 'Создать проект' }).first().click();
const dialog = page.getByRole('dialog');
await dialog.getByLabel('Название проекта').fill(projectTitle);
await dialog.getByRole('button', { name: 'Создать проект' }).click();
await page.waitForSelector('text=Все изменения сохранены', { timeout: 20_000 });
await shot('04-project-editor');

// F5 on the project hub.
await page.goto('http://127.0.0.1:4610/#/projects');
await page.reload();
await expectProject();
await shot('05-after-refresh');

// 7–9. Out, in by username, in by email; the project survives both.
await page.getByRole('button', { name: 'Выйти' }).click();
await page.waitForSelector('[data-testid="entry-sign-in"]');
await shot('06-signed-out');

await signIn(username);
await expectProject();
await shot('07-after-username-sign-in');

await page.getByRole('button', { name: 'Выйти' }).click();
await page.waitForSelector('[data-testid="entry-sign-in"]');
await signIn(email);
await expectProject();
await shot('08-after-email-sign-in');

// The teacher from before accounts existed still has everything.
await page.getByRole('button', { name: 'Выйти' }).click();
await page.waitForSelector('[data-testid="entry-sign-in"]');
await page.getByTestId('entry-sign-in').click();
await page.getByRole('button', { name: 'Вход для ранее подключённой организации' }).click();
await page.getByLabel('Код организации').fill(teacherWorkspace);
await page.getByLabel('Email').fill(teacherEmail);
await page.getByLabel('Пароль').fill(teacherPassword);
await page.getByRole('button', { name: 'Войти через организацию' }).click();
await page.waitForSelector('text=Мои проекты');
await shot('09-teacher-projects');

await page.getByRole('button', { name: 'Классы' }).click();
await page.waitForSelector('[data-testid="classroom-card"]');
await shot('10-teacher-classes');

await browser.close();

if (problems.length > 0) {
  console.error('PROBLEMS:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`demo review clean: account ${username} kept "${projectTitle}" across every sign-in.`);
