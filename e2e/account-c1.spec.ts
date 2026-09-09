import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { collectBrowserFailures, registerAccount, signOutAccount } from './access-a.helpers';

const EVIDENCE_DIR = resolve('e2e/artifacts/owner-preview/access-a');
const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });

test.beforeAll(async () => {
  await admin.connect();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('owner completes Account C1 and existing project modules remain available', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const username = `owner_${unique}`.slice(0, 36);
  const email = `${username}@account-e2e.test`;
  const password = `Safe-${unique}-Password`;

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Идея есть? Сделай её.' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/01-public-entry-desktop.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Owner Preview');
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page.getByRole('heading', { name: 'Подтвердите email' })).toBeVisible();
  const verification = await admin.query<{ token: string }>(
    `SELECT token FROM account_verification_tokens_v2
       WHERE account_id=(SELECT id FROM accounts WHERE email=$1)
       ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  expect(verification.rowCount).toBe(1);
  await page.goto(`/#/verify-email?token=${verification.rows[0].token}`);
  await expect(page.getByText('Email подтверждён')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();

  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/02-owner-home.png`,
    fullPage: true,
  });

  await page.getByRole('link', { name: 'Мои проекты' }).first().click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/03-owner-projects-empty.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByText('Виртуальная электроника').click();
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page).toHaveURL(/#\/projects\/[^/]+\/edit$/);
  await expect(page.getByText('Виртуальная электроника')).toBeVisible();
  const electronicsUrl = page.url();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/04-electronics-editor.png`,
    fullPage: true,
  });

  await page.goto('/#/projects');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByText('3D-моделирование').click();
  await page.getByRole('button', { name: 'Создать' }).click();
  await expect(page).toHaveURL(/#\/projects\/[^/]+\/edit$/);
  await expect(page.getByText('3D-моделирование')).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/05-three-d-editor.png`,
    fullPage: true,
  });

  await page.goto('/#/projects');
  await expect(page.getByRole('link', { name: /Виртуальная электроника/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /3D-моделирование/ })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/06-owner-projects-filled.png`,
    fullPage: true,
  });

  await page.goto(electronicsUrl);
  await expect(page.getByText('Виртуальная электроника')).toBeVisible();

  const secondPage = await browser.newPage();
  const secondFailures = collectBrowserFailures(secondPage);
  const second = await registerAccount(admin, secondPage, `other_${unique}`);
  await secondPage.goto('/#/projects');
  await expect(secondPage.getByText('У вас пока нет проектов')).toBeVisible();
  await signOutAccount(secondPage);
  expect(secondFailures).toEqual([]);
  await secondPage.close();

  expect(failures).toEqual([]);
});
