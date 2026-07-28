import { test, expect } from '@playwright/test';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { signInThroughOrganization } from './entry';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: import('@playwright/test').Page): Promise<void> {
  await signInThroughOrganization(page, teacher);
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'states');
});

test.afterAll(async () => {
  await admin.end();
});

/** Classes are a separate area in the project-first workbench. */
async function openClasses(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

test('session-check failure is explicit and can be retried', async ({ page }) => {
  let failNext = true;
  await page.route('**/api/auth/me', async (route) => {
    if (failNext) {
      failNext = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Не удалось проверить активную сессию');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
});

test('create dialog exposes validation and idempotency conflict states', async ({ page }) => {
  await login(page);
  await openClasses(page);
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });

  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Введите название класса');

  await page.route('**/api/classrooms', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'idempotency_conflict',
            message: 'same key, different payload',
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByLabel('Название класса').fill('Конфликт');
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Запрос уже был использован');
});

test('create dialog exposes a server-error state without closing', async ({ page }) => {
  await login(page);
  await page.route('**/api/classrooms', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal', message: 'unexpected failure' } }),
      });
      return;
    }
    await route.continue();
  });

  await openClasses(page);
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await page.getByLabel('Название класса').fill('Ошибка сервера');
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ошибка сервера');
  await expect(dialog).toBeVisible();
});

test('classroom loading failure can be retried', async ({ page }) => {
  let failNextList = true;
  await page.route('**/api/classrooms', async (route) => {
    if (route.request().method() === 'GET' && failNextList) {
      failNextList = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await login(page);
  // Classrooms are only fetched inside the classes section now.
  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(page.getByRole('alert')).toContainText('Сервер недоступен');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('heading', { name: 'Создайте первый класс' })).toBeVisible();
});

test('logout failure keeps the authenticated dashboard visible', async ({ page }) => {
  await login(page);
  await page.route('**/api/auth/logout', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'unavailable', message: 'temporarily unavailable' } }),
    });
  });

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось выйти');
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
});
