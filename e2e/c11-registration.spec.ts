import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { e2eAdminPool, seedTeacher } from './seed';
import { resolveJoinCodePepper } from '../tools/local-secrets.mjs';

/**
 * C1.1 owner-review evidence for the simplified entry.
 *
 * Seven screens: the public page, the universal sign-in (with refresh and
 * Back), the age-aware sign-up entry, class-code entry, the resolved class,
 * the account path that keeps the pending class after sign-in, and the
 * separate legacy organization sign-in.
 *
 * Public registration stays behind a feature flag that is off until
 * principal-aware sessions exist, so sign-up proves the honest answer rather
 * than a working adult account.
 */

let admin: pg.Pool;
let classCode: string;
let classTitle: string;
let teacher: Awaited<ReturnType<typeof seedTeacher>>;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'join');
  classTitle = '7Б Робототехника';
  const classroom = await admin.query(
    `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [teacher.tenantId, teacher.schoolId, teacher.periodId, classTitle, teacher.teacherId],
  );
  // The code is generated here the way the application does and stored only as
  // a keyed digest, exactly like a code a teacher would be shown once.
  // A fresh code per run: only one digest may be active for a class at a time.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  classCode = Array.from(
    { length: 8 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join('');
  const digest = createHmac('sha256', resolveJoinCodePepper()).update(classCode).digest('hex');
  await admin.query(`SELECT classroom_issue_join_code($1, $2, $3)`, [
    teacher.tenantId,
    classroom.rows[0].id,
    digest,
  ]);
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

test('public screens are real addresses that survive refresh and Back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('entry-sign-in').click();
  await expect(page).toHaveURL(/#\/sign-in$/);
  await expect(page.getByLabel('Email или имя пользователя')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/2-universal-sign-in.png' });

  // Refresh keeps the same screen.
  await page.reload();
  await expect(page).toHaveURL(/#\/sign-in$/);
  await expect(page.getByLabel('Email или имя пользователя')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/2b-sign-in-after-refresh.png' });

  // Back returns to the public page, Forward comes back to sign-in.
  await page.goBack();
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Email или имя пользователя')).toBeVisible();

  // Every public screen is deep-linkable.
  for (const [path, testId] of [
    ['#/sign-up', 'sign-up-age'],
    ['#/join-class', 'class-code'],
  ] as const) {
    await page.goto(`/${path}`);
    await expect(page.getByTestId(testId)).toBeVisible();
  }

  await page.goto('/#/sign-in');
  await page.getByRole('button', { name: 'Вход для ранее подключённой организации' }).click();
  await expect(page).toHaveURL(/#\/organization-sign-in$/);
  await expect(page.getByLabel('Код организации')).toBeVisible();
  await expect(page.getByText('Временный совместимый путь')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/7-organization-sign-in.png' });
});

test('sign-up starts with age policy, not with an account type', async ({ page }) => {
  await page.goto('/#/sign-up');

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
  await expect(page).toHaveURL(/#\/join-class$/);
  await expect(page.getByTestId('class-code')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/4-class-code.png' });

  // An unknown code is refused without revealing which codes exist.
  await page.getByTestId('class-code').fill('ZZZZZZZZ');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByTestId('class-code-error')).toContainText('не найден');

  // Spaces, dashes and case are normalized away.
  await page
    .getByTestId('class-code')
    .fill(` ${classCode.slice(0, 4).toLowerCase()}-${classCode.slice(4)} `);
  await page.getByRole('button', { name: 'Продолжить' }).click();

  await expect(page.getByTestId('class-preview-title')).toHaveText(classTitle);
  await expect(page.getByTestId('join-with-account')).toHaveText('У меня есть аккаунт ASA Lab');
  await expect(page.getByTestId('join-with-handle')).toHaveText('Педагог выдал мне имя для входа');
  await page.screenshot({ path: 'e2e/artifacts/c11/5-class-preview.png' });

  expect(pageErrors).toEqual([]);
});

test('the account path keeps the class through sign-in and says what is real', async ({ page }) => {
  await page.goto('/#/join-class');
  await page.getByTestId('class-code').fill(classCode);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByTestId('join-with-account').click();

  // The pending class is named on the sign-in screen and survives a refresh.
  await expect(page.getByTestId('sign-in-intro')).toContainText(classTitle);
  await page.reload();
  await expect(page.getByTestId('sign-in-intro')).toContainText(classTitle);

  // Signing in answers the class instead of dropping into the project hub.
  await page.getByRole('button', { name: 'Вход для ранее подключённой организации' }).click();
  await page.getByLabel('Код организации').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти через организацию' }).click();

  await expect(page.getByTestId('join-pending')).toBeVisible();
  await expect(page.getByTestId('join-pending-title')).toHaveText(classTitle);
  await expect(page.getByText('следующем этапе')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/c11/6-account-path-join-pending.png' });

  // Continuing clears the intent; the class is not promised twice.
  await page.getByTestId('join-pending-continue').click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('join-pending')).toHaveCount(0);
});
