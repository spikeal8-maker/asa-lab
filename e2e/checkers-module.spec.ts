import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: Page): Promise<void> {
  await loginWithOrganization(page, teacher);
}

async function createProject(
  page: Page,
  input: { readonly title: string; readonly classroomId?: string },
): Promise<string> {
  const response = await page.context().request.post('/api/projects', {
    headers: {
      origin: new URL(page.url()).origin,
      'idempotency-key': `checkers-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    },
    data: {
      scope: input.classroomId ? 'classroom' : 'personal',
      classroomId: input.classroomId ?? null,
      module: 'checkers',
      title: input.title,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-checkers');
  mkdirSync('e2e/artifacts/checkers', { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('learner solves an original Russian-64 task, reloads progress and receives a bot reply', async ({
  page,
}) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  const projectId = await createProject(page, { title: 'Мой путь в шашках' });
  await page.goto(`/#/projects/${projectId}`);

  await expect(page.getByRole('heading', { name: /твой следующий ход/ })).toBeVisible();
  await expect(page.getByText('Здесь собраны задания, обучение, игры и повторение')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('heading', { name: 'Путь русских шашек' })).toBeVisible();
  await expect(page.getByText('0 / 4 задач')).toBeVisible();
  await page
    .getByRole('article')
    .filter({ hasText: 'Обязательное взятие' })
    .getByRole('button')
    .click();
  await expect(page.getByText('Задача · Обязательное взятие')).toBeVisible();

  await page.locator('[data-square="c3"]').click();
  await page.locator('[data-square="e5"]').click();
  await expect(
    page.getByText('Задача решена. Доказательство добавлено в учебный прогресс.'),
  ).toBeVisible();
  await expect(page.locator('.checkers-save-state')).toContainText('Сохранено', {
    timeout: 15_000,
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: /твой следующий ход/ })).toBeVisible();
  await expect(page.getByText('1 из 4 задач')).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Искра' }).click();
  await expect(page.getByRole('heading', { name: /Шесть соперников/ })).toBeVisible();
  await page
    .getByRole('article')
    .filter({ hasText: 'Искра' })
    .getByRole('button', { name: 'Начать партию' })
    .click();
  await page.locator('[data-square="c3"]').click();
  await page.locator('[data-square="b4"]').click();
  await expect(page.getByText(/Искра:/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.checkers-move-panel, .checkers-context-bar')).toContainText('Искра');
  await page.getByRole('button', { name: 'Закрыть сообщение' }).click();

  await page.screenshot({
    path: 'e2e/artifacts/checkers/checkers-student-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Доска для русских шашек, 8 на 8')).toBeVisible();
  await page.screenshot({
    path: 'e2e/artifacts/checkers/checkers-student-mobile.png',
    fullPage: true,
  });
  failures.assertEmpty();
});

test('teacher publishes a durable Checkers assignment inside an existing class', async ({
  page,
}) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  const classroomResponse = await page.context().request.post('/api/classrooms', {
    headers: {
      origin: new URL(page.url()).origin,
      'idempotency-key': `checkers-class-${Date.now()}`,
    },
    data: { title: '5Б · Шашки и логика' },
  });
  expect(classroomResponse.status()).toBe(201);
  const classroom = (await classroomResponse.json()) as {
    classroom: { id: string; title: string };
  };
  const projectId = await createProject(page, {
    title: 'Шашечные задания 5Б',
    classroomId: classroom.classroom.id,
  });
  await page.goto(
    `/#/classrooms/${classroom.classroom.id}/projects/${projectId}?title=${encodeURIComponent(classroom.classroom.title)}`,
  );

  await expect(page.getByText('ASA Шашки · педагог')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Шашечные задания 5Б' })).toBeVisible();
  await page.getByRole('button', { name: 'Создать задание' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое задание' });
  await dialog.getByLabel('Название').fill('Серии взятий · практика');
  await dialog.getByLabel('Срок').fill('2026-08-20');
  await dialog.getByRole('button', { name: 'Назначить классу' }).click();
  await expect(page.getByText('Задание «Серии взятий · практика» опубликовано')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Серии взятий · практика' })).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Серии взятий · практика' })).toBeVisible();
  await expect(page.getByText('Свободного чата')).toHaveCount(0);

  await page.screenshot({
    path: 'e2e/artifacts/checkers/checkers-teacher-desktop.png',
    fullPage: true,
  });
  failures.assertEmpty();
});
