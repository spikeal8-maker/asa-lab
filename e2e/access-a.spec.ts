import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { e2eAdminPool } from './seed';
import {
  openPortalSection,
  portalSection,
  openAccountMenu,
  accountMenu,
} from './portal-navigation';

const evidence = 'e2e/artifacts/owner-preview/access-a';
const origin = 'http://127.0.0.1:4612';
const admin = e2eAdminPool();
let teacherCookie = '';
let classId = '';
let classCode = '';
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));
test.afterAll(async () => {
  await admin.end();
});
async function shot(page: Page, name: string) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    // Capture the settled keyboard skip-link, not a frame of its blur transition.
    await Promise.all(
      (document.querySelector('.skip-link')?.getAnimations() ?? []).map((a) =>
        a.finished.catch(() => undefined),
      ),
    );
  });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
async function mutation(request: APIRequestContext, path: string, data: unknown, cookie?: string) {
  const response = await request.post(path, {
    headers: { origin, 'idempotency-key': crypto.randomUUID(), ...(cookie ? { cookie } : {}) },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function register(page: Page, label: string) {
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@access-browser.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill(`a${unique}`);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill(label);
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль', { exact: true }).fill(`Strong-${unique}-Password`);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await expect(page.getByRole('checkbox', { name: 'Я не робот' })).toBeChecked();
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  const response = await page.request.get('/api/auth/me');
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function panel(page: Page, name: string) {
  const select = page.getByRole('combobox', { name: 'Выбрать раздел настроек' });
  if (await select.isVisible()) await select.selectOption({ label: name });
  else await page.getByLabel('Разделы настроек').getByRole('button', { name, exact: true }).click();
}

test('A–E: register, personal project, profile/avatar, explicit teaching, independent class', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/');
  await expect(
    page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first(),
  ).toBeVisible();
  await shot(page, 'A-public');
  const session = await register(page, 'Преподаватель Access A');
  expect(session.activeWorkspace.kind).toBe('personal');
  expect(session.workspaces.every((w: { kind: string }) => w.kind === 'personal')).toBe(true);
  await expect(portalSection(page, 'Классы')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Открыть знания', exact: true })).toBeVisible();
  await shot(page, 'A-new-personal-account');
  await page.locator('.access-personal-start summary').click();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/projects') && response.request().method() === 'POST',
  );
  await page
    .locator('.access-personal-start')
    .getByRole('button', { name: /Электрическая цепь/ })
    .click();
  const creation = await created;
  expect(creation.ok(), await creation.text()).toBeTruthy();
  const project = (await creation.json()).project;
  await expect(page).toHaveURL(new RegExp(project.id));
  await expect(page.locator('.workbench-shell')).toBeVisible();
  await shot(page, 'B-personal-project');
  await page.goto('/#/account');
  await page.getByLabel(/^Отображаемое имя/).fill('Имя без смены прав');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByText('Изменения сохранены.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Выбрать:/ })
    .nth(1)
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const unchanged = await (await page.request.get('/api/auth/me')).json();
  expect(
    unchanged.capabilities.some((c: { capability: string }) => c.capability === 'educator'),
  ).toBe(false);
  await shot(page, 'C-profile-no-role-change');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Выбрать раздел настроек' })).toBeVisible();
  await shot(page, 'C-mobile-profile');
  await page.setViewportSize({ width: 1366, height: 900 });
  await panel(page, 'Возможности');
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Преподавание', exact: true }) })
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  await expect(portalSection(page, 'Классы')).toBeVisible();
  await shot(page, 'D-teaching-capability');
  await openPortalSection(page, 'Классы');
  await page
    .getByRole('button', { name: /^Создать(?: новый)? класс$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await dialog.getByLabel('Название класса').fill('Независимый класс Access A');
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: 'Независимый класс Access A' })
    .locator('.classroom-row-title')
    .click();
  classCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  classId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;
  teacherCookie = `asa_session=${(await page.context().cookies()).find((c) => c.name === 'asa_session')!.value}`;
  const context = await admin.query(
    'SELECT lc.kind,lc.school_id FROM classrooms c JOIN learning_contexts lc ON lc.id=c.school_id WHERE c.id=$1',
    [classId],
  );
  expect(context.rows[0]).toEqual({ kind: 'independent_teaching', school_id: null });
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).project.id).toBe(
    project.id,
  );
  await shot(page, 'E-independent-class');
});

test('F: author without teaching creates and opens own material, no roster', async ({ page }) => {
  await register(page, 'Только автор');
  await page.goto('/#/account');
  await panel(page, 'Возможности');
  await page.getByRole('button', { name: 'Подключить авторство', exact: true }).click();
  await expect(portalSection(page, 'Курсы и задания')).toBeVisible();
  await expect(portalSection(page, 'Классы')).toHaveCount(0);
  await openPortalSection(page, 'Курсы и задания');
  await page.getByLabel('Название материала').fill('Личный материал автора');
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Самостоятельный текст без доступа к ученикам.');
  await page.getByRole('button', { name: 'Создать материал' }).click();
  await expect(page.getByRole('region', { name: 'Открытый материал' })).toContainText(
    'Самостоятельный текст',
  );
  expect((await page.request.get(`/api/classrooms/${classId}/roster`)).status()).toBe(403);
  await shot(page, 'F-author-only');
});

test('G, I, J: Account learner owns learning, forbidden staff link, mixed contexts remain separate', async ({
  page,
}) => {
  await register(page, 'Ученик и преподаватель');
  await openPortalSection(page, 'Моё обучение');
  await page.getByLabel('Код класса', { exact: true }).fill(classCode);
  await page.getByRole('button', { name: 'Войти в класс', exact: true }).click();
  await expect(page.locator('.attended-list')).toContainText('Независимый класс Access A');
  const task = await mutation(
    page.request,
    '/api/assignments',
    {
      title: 'Практика ученика Access A',
      brief: 'Соберите цепь',
      goal: null,
      moduleKey: 'electronics',
    },
    teacherCookie,
  );
  const activity = await mutation(
    page.request,
    '/api/learning/activities',
    {
      requestId: crypto.randomUUID(),
      kind: 'project',
      title: 'Практика ученика Access A',
      instructions: 'Соберите цепь',
      scope: 'personal',
      visibility: 'private',
      sourceTeacherAssignmentId: task.id,
      resultMode: 'completion',
      maxPoints: null,
      moduleKey: 'electronics',
      policies: {
        attemptPolicy: { maxAttempts: 1 },
        resultSelectionPolicy: { mode: 'latest' },
        completionPolicy: { mode: 'submission' },
        latePolicy: { mode: 'allow_mark_late' },
        assessmentPolicy: { mode: 'manual' },
        feedbackReleasePolicy: { mode: 'after_review' },
      },
    },
    teacherCookie,
  );
  const version = await mutation(
    page.request,
    `/api/learning/activities/${activity.id}/publish`,
    { expectedRevision: 1, requestId: crypto.randomUUID() },
    teacherCookie,
  );
  await mutation(
    page.request,
    `/api/classrooms/${classId}/learning/activity-runs`,
    {
      activityVersionId: version.id,
      audienceType: 'whole_class',
      seatIds: [],
      dueAt: null,
      requestId: crypto.randomUUID(),
    },
    teacherCookie,
  );
  await page.reload();
  await expect(page.getByTestId('attended-assignments')).toContainText('Практика ученика Access A');
  await expect(page.getByRole('navigation', { name: 'Разделы моего обучения' })).toContainText(
    'Завершённое',
  );
  await shot(page, 'G-account-learning');
  await page.goto(`/#/classrooms/${classId}`);
  await expect(
    page.getByRole('heading', { name: 'Доступ к управлению классом закрыт' }),
  ).toBeVisible();
  expect((await page.request.get(`/api/classrooms/${classId}/roster`)).status()).toBe(403);
  await shot(page, 'I-learner-forbidden-staff');
  await page.goto('/#/account');
  await panel(page, 'Возможности');
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Преподавание', exact: true }) })
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  await openPortalSection(page, 'Классы');
  await expect(
    page.getByRole('button', { name: /^Создать(?: новый)? класс$/ }).first(),
  ).toBeVisible();
  const denied = await page.request.get(`/api/classrooms/${classId}/roster`);
  expect([403, 404]).toContain(denied.status());
  await openPortalSection(page, 'Моё обучение');
  await expect(page.locator('.attended-list')).toContainText('Независимый класс Access A');
  await expect(portalSection(page, 'Классы')).toBeVisible();
  await shot(page, 'J-mixed-account-scopes');
});

test('H: private StudentSeat key, profile, logout, next learner does not see first work', async ({
  page,
  browser,
}) => {
  const first = await mutation(
    page.request,
    `/api/classrooms/${classId}/seats`,
    { displayLabel: 'Первый ученик', loginHandle: 'browser-first', safeMode: true },
    teacherCookie,
  );
  const second = await mutation(
    page.request,
    `/api/classrooms/${classId}/seats`,
    { displayLabel: 'Второй ученик', loginHandle: 'browser-second', safeMode: true },
    teacherCookie,
  );
  const privateTeacherNote = 'Личное замечание преподавателя только первому ученику';
  const keys: string[] = [];
  for (const seat of [first, second]) {
    keys.push(
      (
        await mutation(
          page.request,
          `/api/classrooms/${classId}/seats/${seat.student.id}/credential`,
          { requestId: crypto.randomUUID() },
          teacherCookie,
        )
      ).credential,
    );
  }
  // Verify the actual teacher action and use the key returned by that UI.
  const teacherContext = await browser.newContext();
  await teacherContext.addCookies([
    { name: 'asa_session', value: teacherCookie.slice('asa_session='.length), url: origin },
  ]);
  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`${origin}/#/classrooms/${classId}`);
  await teacherPage.getByRole('button', { name: 'Действия: Первый ученик', exact: true }).click();
  teacherPage.once('dialog', (dialog) => dialog.accept());
  const issuance = teacherPage.waitForResponse(
    (response) =>
      response.url().endsWith(`/seats/${first.student.id}/credential`) &&
      response.request().method() === 'POST',
  );
  await teacherPage.getByRole('button', { name: 'Выдать личный ключ', exact: true }).click();
  const issued = await issuance;
  expect(issued.ok()).toBeTruthy();
  keys[0] = (await issued.json()).credential;
  await expect(teacherPage.getByText(keys[0]!, { exact: true })).toBeVisible();
  await teacherPage.getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(teacherPage.getByText(keys[0]!, { exact: true })).toHaveCount(0);
  await shot(teacherPage, 'H-teacher-issued-key-hidden');
  await teacherContext.close();
  async function enter(handle: string, credential: string) {
    await page.goto('/#/join-class');
    await page.getByLabel('Код класса', { exact: true }).fill(classCode);
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByLabel('Имя для входа', { exact: true }).fill(handle);
    await page.getByLabel('Личный ключ', { exact: true }).fill(credential);
    await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
    await expect(page.getByRole('checkbox', { name: 'Я не робот' })).toBeChecked();
    await page.getByRole('button', { name: 'Войти в класс', exact: true }).click();
    await expect(portalSection(page, 'Мой учебный профиль')).toBeVisible();
  }
  await enter('browser-first', keys[0]!);
  // First real sign-in creates the Seat principal. Give this active learner
  // a real teacher note; do not manufacture principal rows in the fixture.
  const award = await page.request.put(
    `/api/classrooms/${classId}/students/${first.student.id}/awards/careful-work`,
    {
      headers: { origin, cookie: teacherCookie },
      data: { granted: true, note: privateTeacherNote },
    },
  );
  expect(award.ok(), await award.text()).toBeTruthy();
  await openPortalSection(page, 'Моё обучение');
  await expect(page.getByRole('heading', { name: 'Моё обучение', exact: true })).toBeVisible();
  await expect(page.locator('.seat-class-heading')).toContainText('Независимый класс Access A');
  const previousToken = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'asa_student_session',
  )!.value;
  const work = await mutation(page.request, '/api/projects', {
    scope: 'personal',
    module: 'electronics',
    title: 'Секретная работа первого',
  });
  await openPortalSection(page, 'Мои учебные работы');
  await expect(page.getByText('Секретная работа первого', { exact: true }).first()).toBeVisible();
  await openPortalSection(page, 'Мой учебный профиль');
  await expect(page.getByText(privateTeacherNote, { exact: true })).toBeVisible();
  await shot(page, 'H-first-seat-profile');
  await page.evaluate(() => {
    sessionStorage.setItem('asa-seat-notes:synthetic-first-seat', 'private first learner draft');
    sessionStorage.setItem('asa-pending-create:synthetic', 'private project draft');
  });
  await openAccountMenu(page);
  await accountMenu(page).getByRole('button', { name: 'Выход', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('asa-seat-notes:synthetic-first-seat')))
    .toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem('asa-pending-create:synthetic')),
  ).toBeNull();
  const ended = await page.request.get('/api/class-join/me', {
    headers: { cookie: `asa_student_session=${previousToken}` },
  });
  expect((await ended.json()).authenticated).toBe(false);
  expect(
    (
      await page.request.get('/api/class-join/me/awards', {
        headers: { cookie: `asa_student_session=${previousToken}` },
      })
    ).status(),
  ).toBe(401);
  await enter('browser-second', keys[1]!);
  await openPortalSection(page, 'Мои учебные работы');
  await expect(page.getByText('Секретная работа первого', { exact: true })).toHaveCount(0);
  expect([403, 404]).toContain(
    (await page.request.get(`/api/projects/${work.project.id}`)).status(),
  );
  await openPortalSection(page, 'Мой учебный профиль');
  await expect(page.getByText('Первый ученик', { exact: true })).toHaveCount(0);
  await expect(page.getByText(privateTeacherNote, { exact: true })).toHaveCount(0);
  const secondAwards = await page.request.get('/api/class-join/me/awards');
  expect(secondAwards.status()).toBe(200);
  expect((await secondAwards.json()).items).toEqual([]);
  await expect(page.getByText('private first learner draft')).toHaveCount(0);
  expect((await (await page.request.get('/api/class-join/me')).json()).student.seatId).toBe(
    second.student.id,
  );
  await openPortalSection(page, 'Моё обучение');
  await shot(page, 'H-second-seat-isolation');
});
