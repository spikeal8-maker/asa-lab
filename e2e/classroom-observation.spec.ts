import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import type {
  ObservationSummary,
  ObservationHistoryPage,
} from '../apps/web/src/classroom-observation-api';

// Real browser bundle/API and isolated *_test DB. No route mocks or fabricated
// successful requests. Run after A integrates the two observation components.
let admin: pg.Pool, teacher: SeededTeacher;
test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'observation');
  mkdirSync('e2e/artifacts/owner-preview/classroom-observation', { recursive: true });
});
test.afterAll(async () => {
  await admin?.end();
});
test('teacher finds and opens genuine unassigned pupil work, reads real history and consistent counts', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await loginWithOrganization(page, teacher);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  const title = `Наблюдение ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Название класса').fill(title);
  await dialog.getByLabel('Возраст учеников').selectOption('11-12');
  await dialog.getByLabel('Электроника').check();
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  await page.getByRole('button', { name: 'Добавить ученика', exact: true }).click();
  const pupilDialog = page.getByRole('dialog');
  await pupilDialog.getByLabel('Имя в списке класса').fill('Анна Наблюдаемая');
  await pupilDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  const classUrl = page.url();
  const list = (await (await page.request.get('/api/classrooms')).json()) as {
    items: Array<{ id: string; title: string }>;
  };
  const classId = list.items.find((c) => c.title === title)!.id;
  // A masks credentials by default. Use authorized fixture API readback,
  // without exposing codes in UI evidence/screenshots.
  const detail = (await (await page.request.get(`/api/classrooms/${classId}`)).json()) as {
    classroom: { joinCode: string };
  };
  const roster = (await (await page.request.get(`/api/classrooms/${classId}/roster`)).json()) as {
    items: Array<{ displayLabel: string; loginHandle: string }>;
  };
  const studentCode = roster.items.find((s) => s.displayLabel === 'Анна Наблюдаемая')!.loginHandle;
  const classCode = detail.classroom.joinCode;
  const studentContext = await browser.newContext();
  try {
    const student = await studentContext.newPage();
    await student.goto(`/#/join-class?code=${encodeURIComponent(classCode)}`);
    await student.getByLabel('Код ученика', { exact: true }).fill(studentCode);
    const joined = student.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/api/class-join/studentseat',
    );
    await student.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await joined).ok()).toBe(true);
    const create = student.locator('.portal-header .portal-quick-create');
    await create.locator('> summary').click();
    const created = student.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/projects',
    );
    await create.getByRole('button', { name: /^3D модель/ }).click();
    const response = await created;
    expect(response.ok(), await response.text()).toBe(true);
    const project = (await response.json()).project as { id: string };
    await expect(student.getByTestId('asa3d-viewport')).toHaveAttribute(
      'data-runtime-ready',
      'true',
      { timeout: 30_000 },
    );
    const projectTitle = `Без задания ${randomUUID().slice(0, 8)}`;
    const titleInput = student.getByLabel('Название проекта', { exact: true });
    await titleInput.fill(projectTitle);
    const renamed = student.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        new URL(r.url()).pathname === `/api/projects/${project.id}`,
    );
    await titleInput.press('Enter');
    expect((await renamed).ok()).toBe(true);
    // A real successful explicit logout; closing the page is never evidence.
    const logout = await student.request.post('/api/class-join/logout', {
      headers: { origin: new URL(student.url()).origin },
    });
    expect(logout.ok()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Проекты', exact: true }).first().click();
    const works = page.getByRole('region', { name: 'Работы учеников' });
    const workRow = works.locator('li').filter({ hasText: projectTitle });
    await expect(workRow).toContainText('Анна Наблюдаемая');
    await expect(workRow).toContainText('Без задания');
    await works.getByLabel('Редактор', { exact: true }).selectOption('three-d');
    await works.getByLabel('Название', { exact: true }).fill(projectTitle);
    await expect(workRow).toBeVisible();
    await works.getByLabel('Задание', { exact: true }).selectOption('assigned');
    await expect(works.getByText('По этим фильтрам доступных работ нет.')).toBeVisible();
    await works.getByLabel('Задание', { exact: true }).selectOption('unassigned');
    await workRow
      .getByRole('button', { name: `Открыть работу ${projectTitle}`, exact: true })
      .click();
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByLabel('Название проекта', { exact: true })).toHaveValue(projectTitle);
    await page.goto(classUrl);
    await page.getByRole('button', { name: 'История', exact: true }).click();
    const history = page.getByRole('region', { name: 'История класса' });
    await expect(history).toContainText(projectTitle);
    await expect
      .poll(async () => {
        const result = await page.request.get(
          `/api/classrooms/${classId}/observation/history?category=access`,
        );
        expect(result.ok()).toBe(true);
        return ((await result.json()) as ObservationHistoryPage).items.some(
          (e) => e.action === 'seat.signed_out' && !e.byTeacher,
        );
      })
      .toBe(true);
    await history.getByRole('combobox', { name: 'Действия', exact: true }).selectOption('access');
    await expect(history).toContainText('Явный выход');
    await expect(history).toContainText('Вход по коду класса');
    const summaryResponse = await page.request.post('/api/classrooms/observation/summary', {
      headers: { origin: new URL(page.url()).origin },
      data: { classroomIds: [classId] },
    });
    expect(summaryResponse.ok()).toBe(true);
    const summary = (await summaryResponse.json()) as ObservationSummary;
    const actual = (
      await admin.query(
        "SELECT count(DISTINCT p.id)::int works FROM projects p JOIN principals owner ON owner.id=p.owner_principal_id JOIN classroom_student_seats s ON s.id=owner.seat_id WHERE s.classroom_id=$1 AND p.module_key IN('three-d','electronics','blocks') AND p.status IN('active','archived')",
        [classId],
      )
    ).rows[0].works;
    expect(summary.totals).toMatchObject({
      works: actual,
      assigned: 0,
      submitted: 0,
      waiting: 0,
      notSubmitted: 0,
    });
    expect(actual).toBe(1);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(history).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: `e2e/artifacts/owner-preview/classroom-observation/history-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await studentContext.close();
  }
});
