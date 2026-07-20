import { test, expect } from '@playwright/test';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace').fill(teacher.workspace);
  await page.getByLabel('Email').fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'states');
});

test.afterAll(async () => {
  await admin.end();
});

test('create dialog exposes validation and idempotency conflict states', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Создать класс' }).click();
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
  await expect(page.getByRole('alert')).toContainText('Сервер недоступен');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByText('Классов пока нет.')).toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('Не удалось завершить сессию');
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
});
