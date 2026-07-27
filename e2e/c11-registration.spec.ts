import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { e2eAdminPool, seedTeacher } from './seed';

/**
 * C1.1 owner-review evidence for the simplified entry.
 *
 * Six screens: the public page with three unambiguous actions, the universal
 * sign-in, the age-aware sign-up entry, class-code entry, the resolved class
 * with its two identity paths, and the separate legacy organization sign-in.
 *
 * Public registration stays behind a feature flag that is off until
 * principal-aware sessions exist, so sign-up proves the honest answer rather
 * than a working adult account.
 */

let admin: pg.Pool;
let classCode: string;
let classTitle: string;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  const teacher = await seedTeacher(admin, 'join');
  classTitle = '7Б Робототехника';
  const classroom = await admin.query(
    `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING join_code`,
    [teacher.tenantId, teacher.schoolId, teacher.periodId, classTitle, teacher.teacherId],
  );
  classCode = classroom.rows[0].join_code as string;
  mkdirSync('e2e/artifacts/c11', { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('the public page offers three unambiguous actions', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await expect(page.getByTestId('entry-sign-in')).toHaveText('Войти');
  await expect(page.getByTestId('entry-sign-up')).toHaveText('Создать аккаунт');
  await expect(page.getByTestId('entry-class-code')).toHaveText('Войти по коду класса');

  // Никаких типов аккаунта на публичном экране.
  await expect(page.getByText('Педагог', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Зарегистрированный ученик')).toHaveCount(0);
  await expect(page.getByText('Присоединиться к классу')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/artifacts/c11/1-public-entry.png' });

  expect(pageErrors).toEqual([]);
});

test('sign-in is one universal form reached in a single step', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('entry-sign-in').click();

  await expect(page.getByLabel('Email или имя пользователя')).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();
  await expect(page.getByLabel('Код организации')).toHaveCount(0);
  await expect(page.getByText('Email педагога')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/artifacts/c11/2-universal-sign-in.png' });

  // Legacy organization sign-in stays a secondary link on its own screen.
  await page.getByRole('button', { name: 'Вход для ранее подключённой организации' }).click();
  await expect(page.getByLabel('Код организации')).toBeVisible();
  await expect(page.getByText('Временный совместимый путь')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/6-organization-sign-in.png' });
});

test('sign-up starts with age policy, not with an account type', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('entry-sign-up').click();

  await expect(page.getByTestId('sign-up-age')).toBeVisible();
  await expect(page.getByLabel('Страна')).toBeVisible();
  await expect(page.getByLabel('Дата рождения')).toBeVisible();
  await expect(page.getByText('Педагог', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'e2e/artifacts/c11/3-sign-up-age.png' });

  // A minor gets working routes instead of a refusal.
  await page.getByLabel('Дата рождения').fill('2014-01-01');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByTestId('sign-up-student')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать ученический аккаунт' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти по коду класса' })).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/3b-sign-up-student-routes.png' });

  // An adult reaches the account form; the pseudonym has its own answer.
  await page.getByRole('button', { name: '← Назад' }).click();
  await page.getByLabel('Дата рождения').fill('1990-05-17');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByTestId('sign-up-account')).toBeVisible();
  await page.getByLabel('Имя пользователя').fill(`pseudo${Date.now()}`);
  await expect(page.getByTestId('username-availability')).toContainText('свободно');
  await page.getByLabel('Email').fill(`adult-${Date.now()}@test.local`);
  await page.getByLabel('Пароль').fill('sufficiently-long-pass');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByTestId('register-error')).toContainText('следующем этапе');
  await page.screenshot({ path: 'e2e/artifacts/c11/3c-sign-up-flag-off.png' });
});

test('a class code resolves to the class and two ways to identify', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await page.getByTestId('entry-class-code').click();
  await expect(page.getByTestId('class-code')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/4-class-code.png' });

  // An unknown code is refused without revealing which codes exist.
  await page.getByTestId('class-code').fill('ZZZZZZ');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByTestId('class-code-error')).toContainText('не найден');

  // Spaces, dashes and case are normalized away.
  await page
    .getByTestId('class-code')
    .fill(` ${classCode.slice(0, 3).toLowerCase()}-${classCode.slice(3)} `);
  await page.getByRole('button', { name: 'Продолжить' }).click();

  await expect(page.getByTestId('class-preview-title')).toHaveText(classTitle);
  await expect(page.getByTestId('join-with-account')).toHaveText('У меня есть аккаунт ASA Lab');
  await expect(page.getByTestId('join-with-handle')).toHaveText('Педагог выдал мне имя для входа');
  await page.screenshot({ path: 'e2e/artifacts/c11/5-class-preview.png' });

  // The account path leads to the same universal sign-in, carrying the class.
  await page.getByTestId('join-with-account').click();
  await expect(page.getByLabel('Email или имя пользователя')).toBeVisible();
  await expect(page.getByTestId('sign-in-intro')).toContainText(classTitle);

  expect(pageErrors).toEqual([]);
});
