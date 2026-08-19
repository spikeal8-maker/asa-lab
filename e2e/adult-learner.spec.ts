import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/**
 * Взрослый учится в классе, оставаясь собой.
 *
 * Учатся не только дети. Преподаватель проходит курс коллеги, студент берёт
 * факультатив, взрослый учится ради себя — и всем им незачем заводить второй
 * вход по выданному логину и вторую полку работ.
 *
 * Отдельно проверяется граница: преподаватель видит у взрослого только то, что
 * сделано по заданиям класса. Личная работа взрослого школе не принадлежит и в
 * журнале появляться не должна.
 */

const evidenceDir = 'e2e/artifacts/adult-learner';
const PERSONAL = `Личное, не для школы ${Date.now().toString(36)}`;

let admin: pg.Pool;
let teacher: SeededTeacher;
let adult: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'adult-teacher');
  // Второй аккаунт: он умеет преподавать, но здесь приходит учиться.
  adult = await seedTeacher(admin, 'adult-learner');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('человек с аккаунтом входит в класс по коду, получает задание и сдаёт его', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const teacherFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);

  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await dialog.getByLabel('Название класса').fill('Курс для взрослых');
  await dialog.getByLabel('Возраст учеников').selectOption('mixed');
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByTestId('classroom-card').filter({ hasText: 'Курс для взрослых' }).locator('.classroom-row-title').click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  expect(joinCode).toMatch(/^[A-Z2-9]{3} [A-Z2-9]{3} [A-Z2-9]{3}$/);

  // Взрослый в своём окне: сначала личная работа, потом класс.
  const adultContext = await browser.newContext();
  const adultPage = await adultContext.newPage();
  const adultFailures = collectBrowserFailures(adultPage, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(adultPage, adult);

  await adultPage.evaluate(async (title) => {
    const created = await fetch('/api/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': `personal-${Date.now()}` },
      body: JSON.stringify({ scope: 'personal', module: 'three-d', title }),
    });
    return created.status;
  }, PERSONAL);

  // Вход в класс по тому же коду, что и у детей — но своим аккаунтом.
  await adultPage.getByRole('button', { name: 'Классы', exact: true }).click();
  await adultPage.getByRole('button', { name: 'Я учусь в классе →' }).click();
  await expect(adultPage.getByRole('heading', { name: 'Я учусь' })).toBeVisible();
  await adultPage.getByLabel('Код класса').fill(joinCode);
  await adultPage.getByRole('button', { name: 'Войти в класс' }).click();
  await adultPage.screenshot({ path: `${evidenceDir}/join-attempt.png`, fullPage: true });
  const problem = adultPage.locator('.form-error');
  if (await problem.count()) {
    throw new Error(`вход в класс отклонён: ${await problem.first().innerText()}`);
  }
  await expect(adultPage.getByText('Вы в классе «Курс для взрослых».')).toBeVisible();
  await expect(adultPage.getByText('Преподаватель:')).toBeVisible();

  // Задания класса приходят ему так же, как ребёнку.
  const tasks = adultPage.getByTestId('attended-assignments');
  await expect(tasks.locator('li').first()).toBeVisible();
  const first = tasks.locator('li').filter({ hasText: 'Домик' });
  await expect(first).toContainText('Не начато');
  await adultPage.screenshot({ path: `${evidenceDir}/attending.png`, fullPage: true });

  await first.getByRole('button', { name: 'Начать' }).click();
  await expect(adultPage.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 60_000 });
  await adultPage.getByRole('button', { name: 'ASA Lab' }).first().click();
  await adultPage.getByRole('button', { name: 'Классы', exact: true }).click();
  await adultPage.getByRole('button', { name: 'Я учусь в классе →' }).click();
  await first.getByRole('button', { name: 'Сдать' }).click();
  await expect(first).toContainText(/Сдано \d/);

  // Преподаватель видит сдачу и отвечает.
  await page.reload();
  await page.getByRole('button', { name: 'Учащиеся' }).click();
  const row = page.getByText('Педагог adult-learner');
  await expect(row).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/roster.png`, fullPage: true });

  teacherFailures.assertEmpty();
  adultFailures.assertEmpty();
  await adultContext.close();
});
