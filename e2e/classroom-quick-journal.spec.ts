import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool, owner: SeededTeacher;
test.beforeAll(async () => {
  admin = e2eAdminPool();
  owner = await seedTeacher(admin, 'quick-journal-e2e');
  mkdirSync('e2e/artifacts/owner-preview/classroom-quick-journal', { recursive: true });
});
test.afterAll(async () => {
  await admin?.end();
});
async function post(page: Page, path: string, body: unknown) {
  return page.request.post(path, { headers: { origin: new URL(page.url()).origin }, data: body });
}
async function counts(classId: string) {
  return (
    await admin.query(
      `SELECT
  (SELECT count(*) FROM classroom_journal_columns WHERE classroom_id=$1)::int AS columns,
  (SELECT count(*) FROM classroom_journal_revisions WHERE classroom_id=$1)::int AS grades,
  (SELECT count(*) FROM learning_notifications WHERE classroom_id=$1)::int AS notifications,
  (SELECT count(*) FROM classroom_assignments WHERE classroom_id=$1)::int AS assignments`,
      [classId],
    )
  ).rows[0];
}
test('30 students, ten free slots, atomic retry, keyboard, header edit and relogin', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await loginWithOrganization(page, owner);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page
    .getByRole('button', { name: /^Создать (новый )?класс$/ })
    .first()
    .click();
  const title = `Компактный журнал ${randomUUID().slice(0, 8)}`,
    create = page.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill(title);
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  const classId = (await page.request.get('/api/classrooms').then((r) => r.json())).items.find(
    (c: { title: string }) => c.title === title,
  ).id as string;
  const names = Array.from(
    { length: 30 },
    (_, i) => `${i + 1}${i === 0 ? 'Иван' : i === 9 ? 'Артем' : 'Ученик'}`,
  );
  for (const displayLabel of names) {
    const r = await post(page, `/api/classrooms/${classId}/seats`, {
      displayLabel,
      safeMode: true,
    });
    expect(r.status(), await r.text()).toBe(201);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  const journal = page.getByRole('region', { name: 'Ручной журнал', exact: true });
  await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
  await expect(journal.getByRole('columnheader')).toHaveCount(11);
  await expect(journal.getByRole('rowheader')).toHaveCount(30);
  await expect(journal.getByRole('rowheader').nth(0)).toContainText('1Иван');
  await expect(journal.getByRole('rowheader').nth(9)).toContainText('10Артем');
  const before = await counts(classId);
  expect(before).toEqual({ columns: 0, grades: 0, notifications: 0, assignments: 0 });
  for (let i = 0; i < 3; i++)
    await journal.getByRole('button', { name: 'Обновить журнал', exact: true }).click();
  await expect(journal.getByRole('button', { name: 'Обновить журнал', exact: true })).toBeEnabled();
  expect(await counts(classId)).toEqual(before);
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes(`/classrooms/${classId}/journal`))
      requests.push(r.url());
  });
  const cell = (student: string, work: number) =>
    journal.getByRole('button', { name: new RegExp(`^${student}, .*?, Работа ${work}:`) });
  const matrix = journal.getByRole('region', { name: 'Таблица оценок по датам' });
  await matrix.evaluate((el) => el.setAttribute('data-continuity', 'same-matrix'));
  await cell(names[0], 1).focus();
  await page.keyboard.press('Enter');
  let editor = journal.getByRole('region', { name: `Оценка: ${names[0]}` });
  await expect(
    editor.getByRole('group', { name: 'Оценка' }).getByRole('button', { name: '0', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(
    editor.getByRole('group', { name: 'Оценка' }).getByRole('button', { name: '1', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(cell(names[0], 1)).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(cell(names[0], 2)).toBeFocused();
  let loseOnce = true;
  const firstPayloads: unknown[] = [];
  await page.route(`**/api/classrooms/${classId}/journal/quick`, async (route) => {
    firstPayloads.push(route.request().postDataJSON());
    if (!loseOnce) {
      await route.continue();
      return;
    }
    loseOnce = false;
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort('failed');
  });
  await cell(names[0], 1).click();
  editor = journal.getByRole('region', { name: `Оценка: ${names[0]}` });
  await editor
    .getByRole('group', { name: 'Оценка' })
    .getByRole('button', { name: '0', exact: true })
    .click();
  await expect(editor.getByRole('alert')).toContainText('сервер недоступен');
  await expect(cell(names[0], 1)).toHaveText('—');
  expect(await counts(classId)).toEqual({
    columns: 1,
    grades: 1,
    notifications: 1,
    assignments: 0,
  });
  // Focus reads the real committed grade and materializes the virtual slot.
  // Retry must still send the first command, with no correction reason.
  const focusedRead = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes(`/classrooms/${classId}/journal?`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await focusedRead;
  await expect(cell(names[0], 1)).toHaveText('0');
  await expect(editor.getByLabel('Причина изменения')).toHaveCount(0);
  expect(await counts(classId)).toEqual({
    columns: 1,
    grades: 1,
    notifications: 1,
    assignments: 0,
  });
  requests.length = 0;
  await editor.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(firstPayloads).toHaveLength(2);
  expect(firstPayloads[1]).toEqual(firstPayloads[0]);
  expect(await counts(classId)).toEqual({
    columns: 1,
    grades: 1,
    notifications: 1,
    assignments: 0,
  });
  await page.unroute(`**/api/classrooms/${classId}/journal/quick`);
  for (const [student, work, value] of [
    [names[1], 2, '4'],
    [names[2], 3, '5'],
  ] as const) {
    await cell(student, work).click();
    await journal
      .getByRole('region', { name: `Оценка: ${student}` })
      .getByRole('group', { name: 'Оценка' })
      .getByRole('button', { name: value, exact: true })
      .click();
    await expect(cell(student, work)).toHaveText(value);
  }
  expect(requests).toEqual([]); // no full fetch and no eager history on a cell click
  await expect(matrix).toHaveAttribute('data-continuity', 'same-matrix');
  await expect(journal.getByRole('columnheader')).toHaveCount(11);
  expect(await counts(classId)).toEqual({
    columns: 3,
    grades: 3,
    notifications: 3,
    assignments: 0,
  });
  const geometry = await journal.evaluate((el) => {
    const controls = Array.from(el.querySelector('.manual-journal-filters')!.children).map((c) =>
      c.getBoundingClientRect(),
    );
    const name = el.querySelector('tbody th')!,
      work = el.querySelector('tbody td')!;
    return {
      rows: new Set(controls.map((c) => Math.round(c.top))).size,
      name: name.getBoundingClientRect().width,
      work: work.getBoundingClientRect().width,
      font: getComputedStyle(name).fontSize,
    };
  });
  expect(geometry.rows).toBe(1);
  expect(geometry.name).toBeGreaterThanOrEqual(210);
  expect(geometry.work).toBeGreaterThanOrEqual(80);
  expect(geometry.work).toBeLessThanOrEqual(112);
  expect(geometry.font).toBe('16px');
  await page.screenshot({
    path: 'e2e/artifacts/owner-preview/classroom-quick-journal/teacher-1366.png',
    fullPage: true,
  });
  await journal.getByRole('button', { name: /^Изменить столбец: Работа 1,/ }).click();
  const header = journal.getByRole('dialog', { name: 'Столбец журнала' });
  await header.getByLabel('Категория занятия').fill('Самостоятельная');
  await header.getByLabel('Дата занятия').fill('2026-10-09');
  const headerSnapshot = await page.request
    .get(`/api/classrooms/${classId}/journal?from=2026-10-01&to=2026-10-31`)
    .then((r) => r.json());
  const workOne = headerSnapshot.columns.find(
    (c: { slotKey: string }) => c.slotKey === '2026-10:1',
  );
  const competing = await post(page, `/api/classrooms/${classId}/journal/quick`, {
    columnId: workOne.id,
    date: '2026-09-30',
    category: 'Правка другого педагога',
    expectedHeaderRevision: 0,
    expectedScaleVersion: headerSnapshot.scale.version,
    requestId: randomUUID(),
  });
  expect(competing.ok(), await competing.text()).toBe(true);
  await header.getByRole('button', { name: 'Сохранить столбец', exact: true }).click();
  await expect(header.getByRole('alert')).toContainText('уже изменились');
  await expect(header.getByLabel('Категория занятия')).toHaveValue('Самостоятельная');
  await expect(header.getByLabel('Дата занятия')).toHaveValue('2026-10-09');
  await header.getByRole('button', { name: 'Обновить журнал', exact: true }).click();
  await expect(
    header.getByRole('button', { name: 'Повторить сохранение', exact: true }),
  ).toBeEnabled();
  await expect(header.getByLabel('Категория занятия')).toHaveValue('Самостоятельная');
  await expect(header.getByLabel('Дата занятия')).toHaveValue('2026-10-09');
  await header.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(
    journal.getByRole('button', {
      name: new RegExp(`^${names[0]}, 2026-10-09, Самостоятельная: 0$`),
    }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
  await expect(
    journal.getByRole('button', {
      name: new RegExp(`^${names[0]}, 2026-10-09, Самостоятельная: 0$`),
    }),
  ).toBeVisible();
  await expect(cell(names[1], 2)).toHaveText('4');
  await expect(cell(names[2], 3)).toHaveText('5');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const mobile = await matrix.evaluate((el) => ({
    width: el.clientWidth,
    content: el.scrollWidth,
    name: el.querySelector('tbody th')!.getBoundingClientRect().width,
  }));
  expect(mobile.content).toBeGreaterThan(mobile.width);
  expect(mobile.name).toBeGreaterThanOrEqual(140);
  await page.screenshot({
    path: 'e2e/artifacts/owner-preview/classroom-quick-journal/teacher-390.png',
    fullPage: true,
  });
  const menu = page.getByRole('button', { name: 'Открыть меню', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await page.screenshot({
      path: 'e2e/artifacts/owner-preview/classroom-quick-journal/teacher-390-sidebar.png',
      fullPage: true,
    });
  }
  const context = await browser.newContext(),
    again = await context.newPage();
  try {
    await loginWithOrganization(again, owner);
    await again.getByRole('link', { name: 'Классы', exact: true }).click();
    await again
      .getByTestId('classroom-card')
      .filter({ hasText: title })
      .locator('.classroom-row-title')
      .click();
    await again.getByRole('button', { name: 'Журнал', exact: true }).click();
    await again.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
    await expect(
      again.getByRole('button', {
        name: new RegExp(`^${names[0]}, 2026-10-09, Самостоятельная: 0$`),
      }),
    ).toBeVisible();
    expect(await counts(classId)).toEqual({
      columns: 3,
      grades: 3,
      notifications: 3,
      assignments: 0,
    });
  } finally {
    await context.close();
  }
  // Commit on the real server, then deliver the response after the teacher has
  // switched months. The old editor must not report success in the new matrix.
  // Distinguish the visible sidebar close from its backdrop, both named identically.
  const closeMenu = page.locator('.portal-menu-close');
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page.setViewportSize({ width: 1366, height: 900 });
  let loseCorrection = true;
  const correctionPayloads: {
    requestId: string;
    columnId: string;
    reason: string;
    expectedRevision: number;
  }[] = [];
  await page.route(`**/api/classrooms/${classId}/journal/quick`, async (route) => {
    correctionPayloads.push(route.request().postDataJSON());
    if (!loseCorrection) {
      await route.continue();
      return;
    }
    loseCorrection = false;
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort('failed');
  });
  await cell(names[2], 3).click();
  const correctionEditor = journal.getByRole('region', { name: `Оценка: ${names[2]}` });
  await correctionEditor.getByLabel('Причина изменения').fill('Точная причина исправления');
  await correctionEditor
    .getByRole('group', { name: 'Оценка' })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await expect(correctionEditor.getByRole('alert')).toContainText('сервер недоступен');
  const correctionRead = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes(`/classrooms/${classId}/journal?`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await correctionRead;
  await expect(cell(names[2], 3)).toHaveText('4');
  await correctionEditor.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(correctionEditor).toHaveCount(0);
  expect(correctionPayloads).toHaveLength(2);
  expect(correctionPayloads[1]).toEqual(correctionPayloads[0]);
  expect(correctionPayloads[0]).toMatchObject({
    reason: 'Точная причина исправления',
    expectedRevision: 1,
  });
  const correctionSnapshot = await page.request
    .get(`/api/classrooms/${classId}/journal?from=2026-10-01&to=2026-10-31`)
    .then((r) => r.json());
  const correctionGrade = correctionSnapshot.grades.find(
    (g: { columnId: string }) => g.columnId === correctionPayloads[0].columnId,
  );
  const correctionHistory = await page.request
    .get(
      `/api/classrooms/${classId}/journal/${correctionGrade.columnId}/${correctionGrade.seatId}/history`,
    )
    .then((r) => r.json());
  expect(correctionHistory.items).toHaveLength(2);
  expect(correctionHistory.items[0]).toMatchObject({
    value: 4,
    revision: 2,
    reason: 'Точная причина исправления',
  });
  expect(await counts(classId)).toEqual({
    columns: 3,
    grades: 4,
    notifications: 4,
    assignments: 0,
  });
  await page.unroute(`**/api/classrooms/${classId}/journal/quick`);
  let release!: () => void, committed!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const didCommit = new Promise<void>((resolve) => {
    committed = resolve;
  });
  await page.route(`**/api/classrooms/${classId}/journal/quick`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committed();
    await hold;
    await route.fulfill({ response });
  });
  await cell(names[1], 2).click();
  const pendingEditor = journal.getByRole('region', { name: `Оценка: ${names[1]}` });
  await pendingEditor.getByLabel('Причина изменения').fill('Уточнение оценки');
  await pendingEditor
    .getByRole('group', { name: 'Оценка' })
    .getByRole('button', { name: '5', exact: true })
    .click();
  await didCommit;
  await expect(pendingEditor.getByRole('status')).toHaveText('Сохраняем…');
  await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-09');
  await expect(journal.getByRole('columnheader')).toHaveCount(11);
  const delivered = page.waitForResponse((r) =>
    r.url().endsWith(`/classrooms/${classId}/journal/quick`),
  );
  release();
  await delivered;
  await expect(journal.getByRole('region', { name: `Оценка: ${names[1]}` })).toHaveCount(0);
  await expect(journal.getByText('Оценка сохранена.', { exact: true })).toHaveCount(0);
  expect(await counts(classId)).toEqual({
    columns: 3,
    grades: 5,
    notifications: 5,
    assignments: 0,
  });
  await page.unroute(`**/api/classrooms/${classId}/journal/quick`);
});
