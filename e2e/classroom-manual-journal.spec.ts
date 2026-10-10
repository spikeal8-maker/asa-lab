import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

// Real API and isolated PostgreSQL. Coordinator adds this file to the browser
// command after integration; no server is launched by this spec itself.
let admin: pg.Pool;
let owner: SeededTeacher;
let accountLearner: SeededTeacher;
let foreign: SeededTeacher;
test.beforeAll(async () => {
  admin = e2eAdminPool();
  owner = await seedTeacher(admin, 'manual-journal-e2e');
  accountLearner = await seedTeacher(admin, 'manual-journal-account');
  foreign = await seedTeacher(admin, 'manual-journal-foreign');
  mkdirSync('e2e/artifacts/owner-preview/classroom-manual-journal', { recursive: true });
});
test.afterAll(async () => {
  await admin?.end();
});
async function post(page: Page, path: string, body: unknown) {
  return page.request.post(path, {
    headers: { origin: new URL(page.url()).origin },
    data: body,
  });
}
async function setGrade(page: Page, name: string, value: string, reason?: string) {
  await page
    .getByRole('button', { name: new RegExp(`^${name}, 2026-10-09, Работа на уроке:`) })
    .click();
  const editor = page.getByRole('region', { name: `Оценка: ${name}` });
  await editor.getByLabel('Оценка', { exact: true }).selectOption(value);
  if (reason) await editor.getByLabel('Причина изменения').fill(reason);
  await editor.getByRole('button', { name: 'Сохранить оценку', exact: true }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: value === '' ? 'Оценка очищена' : 'Оценка сохранена' }),
  ).toBeVisible();
}
test('real manual date journal survives retries, corrections, presets and both learner logins', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await loginWithOrganization(page, owner);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page
    .getByRole('button', { name: /^Создать (новый )?класс$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  const title = `Журнал ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Название класса').fill(title);
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  const classId = (await page.request.get('/api/classrooms').then((r) => r.json())).items.find(
    (c: { title: string }) => c.title === title,
  ).id as string;
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  expect(
    (
      await admin.query(
        'SELECT count(*)::integer AS count FROM classroom_assignments WHERE classroom_id=$1',
        [classId],
      )
    ).rows[0].count,
  ).toBe(0);
  const pupils = [];
  for (const name of ['Алина без заданий', 'Борис без заданий']) {
    const created = await post(page, `/api/classrooms/${classId}/seats`, {
      displayLabel: name,
      safeMode: true,
    });
    expect(created.status(), await created.text()).toBe(201);
    const seat = (await created.json()).student;
    const code = await post(page, `/api/classrooms/${classId}/seats/${seat.id}/code`, {
      requestId: randomUUID(),
    });
    expect(code.ok()).toBe(true);
    pupils.push({
      id: seat.id as string,
      name,
      studentCode: (await code.json()).studentCode as string,
    });
  }
  const scaleSeatResponse = await post(page, `/api/classrooms/${classId}/seats`, {
    displayLabel: 'Ученик шкал',
    safeMode: true,
  });
  expect(scaleSeatResponse.ok()).toBe(true);
  const scaleSeat = (await scaleSeatResponse.json()).student;
  const scaleCode = await post(page, `/api/classrooms/${classId}/seats/${scaleSeat.id}/code`, {
    requestId: randomUUID(),
  });
  expect(scaleCode.ok()).toBe(true);
  const scaleStudentCode = (await scaleCode.json()).studentCode;
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await expect(page.getByRole('button', { name: 'По датам', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const journal = page.getByRole('region', { name: 'Ручной журнал', exact: true });
  await expect(journal.getByRole('rowheader', { name: pupils[0].name })).toBeVisible();
  await expect(journal.getByRole('rowheader', { name: pupils[1].name })).toBeVisible();
  await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
  await journal.getByLabel('Дата занятия').fill('2026-10-09');
  await journal.getByLabel('Категория занятия').fill('Работа на уроке');
  await journal.getByRole('button', { name: 'Добавить столбец', exact: true }).click();
  await expect(journal.getByRole('columnheader').filter({ hasText: '09.10.2026' })).toBeVisible();
  const snapshot = await page.request
    .get(`/api/classrooms/${classId}/journal?from=2026-10-01&to=2026-10-31`)
    .then((r) => r.json());
  const columnId = snapshot.columns[0].id as string;

  // The server really commits; only its first response is deliberately lost.
  // No mocked response or API payload is supplied to the browser.
  let loseOnce = true;
  await page.route(`**/api/classrooms/${classId}/journal/grade`, async (route) => {
    if (!loseOnce) {
      await route.continue();
      return;
    }
    loseOnce = false;
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort('failed');
  });
  await journal.getByRole('button', { name: new RegExp(`^${pupils[0].name},`) }).click();
  const editor = page.getByRole('region', { name: `Оценка: ${pupils[0].name}` });
  await editor.getByLabel('Оценка', { exact: true }).selectOption('0');
  await editor.getByRole('button', { name: 'Сохранить оценку', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('сервер недоступен');
  await expect(journal.getByText('Оценка сохранена.', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
  await expect(journal.getByRole('status').filter({ hasText: 'Оценка сохранена.' })).toBeVisible();
  await page.unroute(`**/api/classrooms/${classId}/journal/grade`);
  await expect(
    journal.getByRole('button', { name: new RegExp(`^${pupils[0].name},.*: 0$`) }),
  ).toBeVisible();
  await setGrade(page, pupils[0].name, '5', 'Исправлена опечатка');
  await setGrade(page, pupils[0].name, '', 'Оценка снята');
  await setGrade(page, pupils[0].name, '0', 'Подтверждён ноль');
  const history = await page.request
    .get(`/api/classrooms/${classId}/journal/${columnId}/${pupils[0].id}/history`)
    .then((r) => r.json());
  expect(history.items.map((g: { value: number | null }) => g.value)).toEqual([0, null, 5, 0]);
  expect(new Set(history.items.map((g: { id: string }) => g.id)).size).toBe(4);
  expect(
    (
      await post(page, `/api/classrooms/${classId}/journal/grade`, {
        columnId,
        seatId: pupils[0].id,
        value: 5,
        expectedRevision: 1,
        reason: 'Устаревший запрос',
        requestId: randomUUID(),
      })
    ).status(),
  ).toBe(409);

  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Шкала ручного журнала', exact: true });
  const examples = [
    { preset: 'hundred', value: '100', label: '100' },
    { preset: 'three_five', value: '3', label: '3' },
    { preset: 'smileys', value: '1', label: '😟 — уровень 1 из 5' },
    { preset: 'symbols', value: '5', label: '● — уровень 5 из 5' },
    { preset: 'five', value: '0', label: '0' },
  ];
  for (const { preset, value, label } of examples) {
    await settings.getByLabel('Шкала новых столбцов').selectOption(preset);
    await settings.getByRole('button', { name: 'Сохранить шкалу', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Шкала сохранена');
    await page.reload();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(settings.getByLabel('Шкала новых столбцов')).toHaveValue(preset);
    await page.getByRole('button', { name: 'Журнал', exact: true }).click();
    await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
    await journal.getByLabel('Дата занятия').fill('2026-10-10');
    await journal.getByLabel('Категория занятия').fill(`Шкала ${preset}`);
    await journal.getByRole('button', { name: 'Добавить столбец', exact: true }).click();
    const cell = journal.getByRole('button', {
      name: new RegExp(`^Ученик шкал, 2026-10-10, Шкала ${preset}:`),
    });
    await cell.click();
    const scaleEditor = page.getByRole('region', { name: 'Оценка: Ученик шкал' });
    await expect(scaleEditor.getByLabel('Оценка', { exact: true }).locator('option')).toHaveCount(
      preset === 'hundred' ? 102 : preset === 'three_five' ? 4 : preset === 'five' ? 7 : 6,
    );
    await scaleEditor.getByLabel('Оценка', { exact: true }).selectOption(value);
    await scaleEditor.getByRole('button', { name: 'Сохранить оценку', exact: true }).click();
    await expect(cell).toHaveAttribute(
      'aria-label',
      `Ученик шкал, 2026-10-10, Шкала ${preset}: ${label}`,
    );
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
  await expect(
    journal.getByRole('button', { name: new RegExp(`^${pupils[0].name},.*: 0$`) }),
  ).toBeVisible();
  await expect(journal.getByRole('columnheader').filter({ hasText: '09.10.2026' })).toContainText(
    '0–5 баллов',
  );
  await journal.getByLabel('Категория занятия').fill('Моя категория');
  await journal.getByLabel('Дата занятия').fill('2026-10-09');
  await journal.getByRole('button', { name: 'Добавить столбец', exact: true }).click();
  await expect(
    journal.getByRole('columnheader').filter({ hasText: 'Моя категория' }),
  ).toBeVisible();
  await setGrade(page, pupils[1].name, '3');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const geometry = await journal
    .getByRole('region', { name: 'Таблица оценок по датам' })
    .evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
  expect(geometry.content).toBeGreaterThan(geometry.width);
  await page.screenshot({
    path: 'e2e/artifacts/owner-preview/classroom-manual-journal/teacher-390.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });

  const contexts = [];
  const scaleContext = await browser.newContext();
  const scalePage = await scaleContext.newPage();
  await scalePage.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await scalePage.getByLabel('Код ученика', { exact: true }).fill(scaleStudentCode);
  await scalePage.getByRole('button', { name: 'Войти', exact: true }).click();
  await scalePage.goto('/#/learning?journalMonth=2026-10');
  const scaleResults = scalePage.getByRole('region', { name: 'Мои оценки по датам' });
  await expect(scaleResults.locator('li')).toHaveCount(5);
  for (const { preset, label } of examples) {
    await expect(
      scaleResults
        .locator('li')
        .filter({ hasText: `Шкала ${preset}` })
        .locator('b'),
    ).toHaveText(label);
  }
  await scalePage.reload();
  await expect(scaleResults.locator('li')).toHaveCount(5);
  await scaleContext.close();
  for (const pupil of pupils) {
    const context = await browser.newContext();
    contexts.push(context);
    const learner = await context.newPage();
    await learner.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
    await learner.getByLabel('Код ученика', { exact: true }).fill(pupil.studentCode);
    await learner.getByRole('button', { name: 'Войти', exact: true }).click();
    await learner.goto('/#/learning');
    const grades = learner.getByRole('region', { name: 'Мои оценки по датам' });
    await grades.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
    await expect(grades.locator('li')).toHaveCount(1);
    await expect(grades.locator('li b')).toHaveText(pupil.id === pupils[0].id ? '0' : '3');
    await learner.reload();
    await grades.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
    await expect(grades.locator('li')).toHaveCount(1);
    await learner.screenshot({
      path: `e2e/artifacts/owner-preview/classroom-manual-journal/pupil-${pupil.id}.png`,
      fullPage: true,
    });
    if (pupil.id === pupils[0].id) {
      await learner.goto('/#/account/notifications');
      await expect(
        learner
          .getByRole('region', { name: 'События уведомлений' })
          .getByText('2026-10-09 · Работа на уроке', { exact: false })
          .first(),
      ).toBeVisible();
      const notification = learner
        .getByRole('region', { name: 'События уведомлений' })
        .locator('li')
        .filter({ hasText: '2026-10-09 · Работа на уроке' })
        .first();
      await notification.getByRole('link', { name: 'Открыть', exact: true }).click();
      await expect(grades.getByLabel('Месяц журнала', { exact: true })).toHaveValue('2026-10');
      await expect(grades.locator('li b')).toHaveText('0');
      const pref = await learner.request
        .get('/api/learning/notifications/preferences')
        .then((r) => r.json());
      const disabled = await post(learner, '/api/learning/notifications/preferences', {
        revision: pref.revision,
        masterEnabled: false,
        categories: pref.categories,
        classOverrides: pref.classOverrides,
        requestId: randomUUID(),
      });
      expect(disabled.ok()).toBe(true);
      await setGrade(page, pupil.name, '5', 'Оценка после отключения оповещений');
      await learner.goto('/#/learning');
      await grades.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
      await expect(grades.locator('li b')).toHaveText('5');
      const loggedOut = await post(learner, '/api/class-join/logout', {});
      expect(loggedOut.status(), await loggedOut.text()).toBe(200);
      expect(
        (await context.cookies()).some((cookie) => cookie.name === 'asa_student_session'),
      ).toBe(false);
      expect((await learner.request.get('/api/class-join/journal/results')).status()).toBe(401);
      // The request context logs out out-of-band; reload resets the SPA's old
      // session just as a fresh visit would before testing an actual new login.
      await learner.reload();
      await learner.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
      await learner.getByLabel('Код ученика', { exact: true }).fill(pupil.studentCode);
      await learner.getByRole('button', { name: 'Войти', exact: true }).click();
      await learner.goto('/#/learning');
      await grades.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
      await expect(grades.locator('li b')).toHaveText('5');
    }
  }
  const accountContext = await browser.newContext();
  contexts.push(accountContext);
  const accountPage = await accountContext.newPage();
  await loginWithOrganization(accountPage, accountLearner);
  const join = await post(accountPage, '/api/class-join/account', { code: joinCode });
  expect(join.ok()).toBe(true);
  const pending = await join.json();
  expect(pending.status).toBe('pending');
  expect(
    (await accountPage.request.get('/api/learning/journal/results').then((r) => r.json())).items,
  ).toEqual([]);
  expect(
    (
      await post(page, `/api/class-join/requests/${classId}/${pending.requestId}/decision`, {
        decision: 'approved',
        reason: null,
      })
    ).ok(),
  ).toBe(true);
  const admitted = (
    await accountPage.request.get('/api/class-join/account/classes').then((r) => r.json())
  ).items.find((c: { classroomId: string }) => c.classroomId === classId);
  expect(
    (
      await post(page, `/api/classrooms/${classId}/journal/grade`, {
        columnId,
        seatId: admitted.seatId,
        value: 4,
        reason: null,
        expectedRevision: 0,
        requestId: randomUUID(),
      })
    ).ok(),
  ).toBe(true);
  await accountPage.goto('/#/learning');
  const accountGrades = accountPage.getByRole('region', { name: 'Мои оценки по датам' });
  await accountGrades.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
  await expect(accountGrades.locator('li')).toHaveCount(1);
  await expect(accountGrades.locator('li b')).toHaveText('4');
  await accountPage.reload();
  await accountGrades.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
  await expect(accountGrades.locator('li b')).toHaveText('4');
  // The platform deliberately rejects dual session cookies before routing.
  // Preserve that guard: conflict responses disclose no grades, and each
  // already-mounted surface clears stale data without falling back identities.
  const accountCookies = (await accountContext.cookies()).filter((c) =>
    ['asa_session', 'asa_refresh'].includes(c.name),
  );
  const seatCookies = (await contexts[0].cookies()).filter((c) => c.name === 'asa_student_session');
  const seatPage = contexts[0].pages()[0];
  const seatGrades = seatPage.getByRole('region', { name: 'Мои оценки по датам' });
  await contexts[0].addCookies(accountCookies);
  for (const path of ['/api/class-join/journal/results', '/api/learning/journal/results']) {
    const response = await seatPage.request.get(path + '?from=2026-10-01&to=2026-10-31');
    expect(response.status(), await response.text()).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'session_conflict' } });
    expect((await response.json()).items).toBeUndefined();
  }
  await seatPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(seatGrades.getByRole('alert')).toContainText('два разных входа');
  await expect(seatGrades.locator('li')).toHaveCount(0);
  await accountContext.addCookies(seatCookies);
  await accountPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(accountGrades.getByRole('alert')).toContainText('два разных входа');
  await expect(accountGrades.locator('li')).toHaveCount(0);
  await contexts[0].clearCookies({ name: 'asa_student_session' });
  expect((await seatPage.request.get('/api/class-join/journal/results')).status()).toBe(401);
  const accountOnly = await seatPage.request.get(
    '/api/learning/journal/results?from=2026-10-01&to=2026-10-31',
  );
  expect(accountOnly.ok()).toBe(true);
  expect((await accountOnly.json()).items.map((g: { value: number }) => g.value)).toEqual([4]);
  await seatPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(seatGrades.getByRole('alert')).toBeVisible();
  await expect(seatGrades.locator('li')).toHaveCount(0);
  await contexts[0].clearCookies({ name: 'asa_session' });
  await contexts[0].clearCookies({ name: 'asa_refresh' });
  await contexts[0].addCookies(seatCookies);
  await seatPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(seatGrades.locator('li b')).toHaveText('5');

  // A previous month remains reachable in both matrices and notification links.
  const scale = (
    await page.request.get(`/api/classrooms/${classId}/journal/settings`).then((r) => r.json())
  ).scale;
  const oldColumnResponse = await post(page, `/api/classrooms/${classId}/journal/column`, {
    date: '2026-09-30',
    category: 'Прошлое занятие',
    expectedRevision: scale.version,
    requestId: randomUUID(),
  });
  expect(oldColumnResponse.ok()).toBe(true);
  const oldColumn = (await oldColumnResponse.json()).id;
  expect(
    (
      await post(page, `/api/classrooms/${classId}/journal/grade`, {
        columnId: oldColumn,
        seatId: pupils[0].id,
        value: 3,
        expectedRevision: 0,
        reason: null,
        requestId: randomUUID(),
      })
    ).ok(),
  ).toBe(true);
  await journal.getByRole('button', { name: 'Предыдущий месяц', exact: true }).click();
  await expect(journal.getByLabel('Месяц журнала', { exact: true })).toHaveValue('2026-09');
  await expect(journal.getByRole('columnheader').filter({ hasText: '30.09.2026' })).toContainText(
    'Прошлое занятие',
  );
  await journal.getByRole('button', { name: 'Следующий месяц', exact: true }).click();
  await expect(
    journal.getByRole('columnheader').filter({ hasText: '09.10.2026' }).first(),
  ).toBeVisible();
  await seatGrades.getByRole('button', { name: 'Предыдущий месяц', exact: true }).click();
  await expect(seatGrades.locator('li b')).toHaveText('3');
  await expect(seatGrades).toContainText('Прошлое занятие');
  await seatPage.goto(`/#/learning?journal=1&journalMonth=2026-09&journalColumn=${oldColumn}`);
  await expect(seatGrades.locator('li b')).toHaveText('3');
  await expect(seatGrades.getByLabel('Месяц журнала', { exact: true })).toHaveValue('2026-09');
  const firstPage = await seatPage.request
    .get('/api/class-join/journal/results?from=2026-09-01&to=2026-10-31&limit=1')
    .then((r) => r.json());
  expect(firstPage.items).toHaveLength(1);
  expect(firstPage.items[0].value).toBe(5);
  expect(firstPage.items[0].timeZone).toBe(snapshot.timeZone);
  expect(firstPage.nextOffset).toBe(1);
  const previousPage = await seatPage.request
    .get('/api/class-join/journal/results?from=2026-09-01&to=2026-10-31&limit=1&offset=1')
    .then((r) => r.json());
  expect(previousPage.items).toHaveLength(1);
  expect(previousPage.items[0]).toMatchObject({ columnId: oldColumn, value: 3 });
  expect(previousPage.nextOffset).toBeNull();
  await accountContext.clearCookies({ name: 'asa_session' });
  await accountContext.clearCookies({ name: 'asa_refresh' });
  expect((await accountPage.request.get('/api/learning/journal/results')).status()).toBe(401);
  expect((await accountPage.request.get('/api/class-join/journal/results')).ok()).toBe(true);
  await accountPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(accountGrades.locator('li')).toHaveCount(0);
  const foreignContext = await browser.newContext();
  contexts.push(foreignContext);
  const foreignPage = await foreignContext.newPage();
  await loginWithOrganization(foreignPage, foreign);
  expect((await foreignPage.request.get(`/api/classrooms/${classId}/journal`)).status()).toBe(403);
  const archive = await post(page, `/api/classrooms/${classId}/status`, { status: 'archived' });
  expect(archive.ok()).toBe(true);
  expect(
    (
      await post(page, `/api/classrooms/${classId}/journal/grade`, {
        columnId,
        seatId: pupils[1].id,
        value: 4,
        reason: 'Архив',
        expectedRevision: 1,
        requestId: randomUUID(),
      })
    ).status(),
  ).toBe(409);
  for (const context of contexts) await context.close();
});
