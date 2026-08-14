import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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

async function registerStudent(
  page: Page,
  input: { email: string; password: string; username: string; displayName: string },
): Promise<void> {
  const response = await page.context().request.post('/api/auth/register', {
    headers: { origin: new URL(page.url()).origin },
    data: { ...input, birthDate: '2008-05-14', country: 'RU' },
  });
  expect(response.status()).toBe(201);
}

async function activateStudentWorkspace(
  context: BrowserContext,
  origin: string,
  email: string,
  password: string,
): Promise<void> {
  const loggedIn = await context.request.post('/api/auth/login', {
    headers: { origin },
    data: { identifier: email, password },
  });
  expect(loggedIn.status()).toBe(200);
  const workspaces = await context.request.get('/api/workspaces');
  expect(workspaces.status()).toBe(200);
  const payload = (await workspaces.json()) as {
    items: { workspaceId: string; kind: string }[];
  };
  const organization = payload.items.find((item) => item.kind === 'organization');
  expect(organization).toBeTruthy();
  const switched = await context.request.post('/api/session/context', {
    headers: { origin },
    data: { workspaceId: organization!.workspaceId },
  });
  expect(switched.status()).toBe(201);
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-checkers');
  mkdirSync('e2e/artifacts/checkers', { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
  });
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
  await expect(page.getByText('0 / 11 задач')).toBeVisible();
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
  await expect(page.getByText('1 из 11 задач')).toBeVisible();
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
  await expect(page.locator('.checkers-save-state')).toContainText('Сохранено', {
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Закрыть сообщение' }).click();
  await page.getByRole('button', { name: 'Разбор' }).click();
  await expect(page.getByText('Пошаговый разбор')).toBeVisible();
  await expect(page.getByText('Обязательные взятия проверены')).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущий' }).click();
  await expect(page.getByRole('heading', { name: /Позиция после хода/ })).toBeVisible();

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

test('teacher assigns real class work and sees the learner evidence after completion', async ({
  browser,
  page,
}) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const studentEmail = `student-checkers-${unique}@test.local`;
  const studentPassword = `Student-${unique}!`;
  const studentDisplayName = 'Маша Шашкина';
  await page.goto('/#/projects');
  const origin = new URL(page.url()).origin;
  const registration = await page.context().request.post('/api/auth/register', {
    headers: { origin },
    data: {
      email: studentEmail,
      password: studentPassword,
      username: `checkers-${unique}`.slice(0, 30),
      displayName: studentDisplayName,
      birthDate: '2006-05-14',
      country: 'RU',
    },
  });
  expect(registration.status()).toBe(201);
  await page.context().clearCookies();

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
  const staffAsStudent = await page
    .context()
    .request.post(`/api/checkers/projects/${projectId}/students`, {
      headers: { origin },
      data: { email: teacher.email },
    });
  expect(staffAsStudent.status()).toBe(409);
  await page.goto(
    `/#/classrooms/${classroom.classroom.id}/projects/${projectId}?title=${encodeURIComponent(classroom.classroom.title)}`,
  );

  await expect(page.getByText('ASA Шашки · педагог')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Шашечные задания 5Б' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить ученика' }).click();
  const enrolDialog = page.getByRole('dialog', { name: 'Добавить ученика' });
  await enrolDialog.getByLabel('Email ученика').fill(studentEmail);
  await enrolDialog.getByRole('button', { name: 'Добавить в класс' }).click();
  await expect(page.getByText(`Ученик ${studentDisplayName} добавлен`)).toBeVisible();
  await expect(page.getByRole('button', { name: studentDisplayName }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Создать задание' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое задание' });
  await dialog.getByLabel('Название').fill('Серии взятий · практика');
  await dialog.getByLabel('Срок').fill('2026-08-20');
  await dialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(page.getByText('Задание «Серии взятий · практика» опубликовано')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Серии взятий · практика' })).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Серии взятий · практика' })).toBeVisible();
  await expect(page.getByText('Свободного чата')).toHaveCount(0);

  const studentContext = await browser.newContext({ baseURL: origin });
  await studentContext.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
  });
  const studentPage = await studentContext.newPage();
  const studentLogin = await studentContext.request.post('/api/auth/login', {
    headers: { origin },
    data: { identifier: studentEmail, password: studentPassword },
  });
  expect(studentLogin.status()).toBe(200);
  const workspaceResponse = await studentContext.request.get('/api/workspaces');
  expect(workspaceResponse.status()).toBe(200);
  const workspacePayload = (await workspaceResponse.json()) as {
    items: { workspaceId: string; kind: string }[];
  };
  const organization = workspacePayload.items.find((item) => item.kind === 'organization');
  expect(organization).toBeTruthy();
  const switched = await studentContext.request.post('/api/session/context', {
    headers: { origin },
    data: { workspaceId: organization!.workspaceId },
  });
  expect(switched.status()).toBe(201);
  const sharedProject = await studentContext.request.get(`/api/projects/${projectId}`);
  expect(sharedProject.status()).toBe(200);
  const sharedPayload = (await sharedProject.json()) as { draft: { document: unknown } };
  const forbiddenSharedWrite = await studentContext.request.put(
    `/api/projects/${projectId}/draft`,
    { headers: { origin }, data: { document: sharedPayload.draft.document } },
  );
  expect(forbiddenSharedWrite.status()).toBe(404);
  await studentPage.goto(
    `/#/classrooms/${classroom.classroom.id}/projects/${projectId}?title=${encodeURIComponent(classroom.classroom.title)}`,
  );
  await expect(studentPage.getByRole('heading', { name: /твой следующий ход/ })).toBeVisible();
  await expect(studentPage.getByText('Серии взятий · практика').first()).toBeVisible();
  await studentPage
    .getByRole('article')
    .filter({ hasText: 'Серии взятий · практика' })
    .getByRole('button', { name: 'Открыть' })
    .click();
  await studentPage
    .getByRole('article')
    .filter({ hasText: 'Обязательное взятие' })
    .getByRole('button', { name: 'Начать' })
    .click();
  await studentPage.locator('[data-square="c3"]').click();
  await studentPage.locator('[data-square="e5"]').click();
  await expect(studentPage.getByText('Задача решена')).toBeVisible();
  await expect(studentPage.locator('.checkers-save-state')).toContainText('Сохранено', {
    timeout: 15_000,
  });
  await studentContext.close();

  await page.reload();
  const assignmentRow = page.getByRole('row').filter({ hasText: 'Серии взятий · практика' });
  await expect(assignmentRow).toContainText('1 из 1');
  await expect(page.getByRole('button', { name: studentDisplayName }).first()).toBeVisible();
  await page.getByRole('button', { name: studentDisplayName }).first().click();
  const feedbackDialog = page.getByRole('dialog', {
    name: `Рекомендация для ${studentDisplayName}`,
  });
  await expect(feedbackDialog.getByText(/capture-choice, ход c3:e5, 100%/)).toBeVisible();
  await feedbackDialog
    .getByLabel('Готовая педагогическая рекомендация')
    .selectOption('retry-capture');
  await feedbackDialog.getByRole('button', { name: 'Отправить рекомендацию' }).click();
  await expect(page.getByText('Учебная рекомендация отправлена ученику')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть сообщение' }).click();

  const feedbackContext = await browser.newContext({ baseURL: origin });
  await activateStudentWorkspace(feedbackContext, origin, studentEmail, studentPassword);
  const feedbackPage = await feedbackContext.newPage();
  await feedbackPage.goto(
    `/#/classrooms/${classroom.classroom.id}/projects/${projectId}?title=${encodeURIComponent(classroom.classroom.title)}`,
  );
  await expect(
    feedbackPage.getByText('Повтори обязательное взятие и попробуй задачу ещё раз.'),
  ).toBeVisible();
  await feedbackContext.close();

  await page.screenshot({
    path: 'e2e/artifacts/checkers/checkers-teacher-desktop.png',
    fullPage: true,
  });
  failures.assertEmpty();
});

test('two enrolled classmates play with keyboard control, audited reactions, mute and teacher signal', async ({
  browser,
  page,
}) => {
  const teacherFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const first = {
    email: `checkers-first-${unique}@test.local`,
    password: `First-${unique}!`,
    username: `first-${unique}`.slice(0, 30),
    displayName: 'Аня Комбинация',
  };
  const second = {
    email: `checkers-second-${unique}@test.local`,
    password: `Second-${unique}!`,
    username: `second-${unique}`.slice(0, 30),
    displayName: 'Борис Диагональ',
  };
  await page.goto('/#/projects');
  const origin = new URL(page.url()).origin;
  await registerStudent(page, first);
  await registerStudent(page, second);
  await page.context().clearCookies();

  await login(page);
  const classroomResponse = await page.context().request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': `checkers-safe-class-${unique}` },
    data: { title: '6А · Безопасная игра' },
  });
  expect(classroomResponse.status()).toBe(201);
  const classroom = (await classroomResponse.json()) as { classroom: { id: string } };
  const projectId = await createProject(page, {
    title: 'Матчи 6А',
    classroomId: classroom.classroom.id,
  });
  for (const student of [first, second]) {
    const enrolled = await page
      .context()
      .request.post(`/api/checkers/projects/${projectId}/students`, {
        headers: { origin },
        data: { email: student.email },
      });
    expect(enrolled.status()).toBe(201);
  }
  await page.goto(`/#/classrooms/${classroom.classroom.id}/projects/${projectId}`);
  await page.getByRole('button', { name: 'Создать задание' }).click();
  const differentiated = page.getByRole('dialog', { name: 'Новое задание' });
  await differentiated.getByLabel('Название').fill('Персональная серия для Ани');
  await differentiated
    .getByLabel('Кому назначить')
    .selectOption({ label: `Только: ${first.displayName}` });
  await differentiated.getByLabel('Лимит попыток').fill('2');
  await differentiated.getByLabel('Сколько успешных решений').fill('2');
  await differentiated.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(page.getByText('Задание «Персональная серия для Ани» опубликовано')).toBeVisible();
  await page.getByRole('button', { name: 'Создать задание' }).click();
  const groupAssignment = page.getByRole('dialog', { name: 'Новое задание' });
  await groupAssignment.getByLabel('Название').fill('Группа тактиков · общий набор');
  await groupAssignment
    .getByLabel('Кому назначить')
    .selectOption({ label: 'Выбранной учебной группе' });
  await groupAssignment.getByRole('checkbox', { name: first.displayName, exact: true }).check();
  await groupAssignment.getByRole('checkbox', { name: second.displayName, exact: true }).check();
  await groupAssignment.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(
    page.getByText('Задание «Группа тактиков · общий набор» опубликовано'),
  ).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Персональная серия для Ани' })).toBeVisible();

  const firstContext = await browser.newContext({ baseURL: origin });
  const secondContext = await browser.newContext({ baseURL: origin });
  await activateStudentWorkspace(firstContext, origin, first.email, first.password);
  await activateStudentWorkspace(secondContext, origin, second.email, second.password);
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const firstFailures = collectBrowserFailures(firstPage, { allowAnonymousSessionProbe: true });
  const secondFailures = collectBrowserFailures(secondPage, { allowAnonymousSessionProbe: true });
  const route = `/#/classrooms/${classroom.classroom.id}/projects/${projectId}`;

  await firstPage.goto(route);
  await expect(firstPage.getByText('Персональная серия для Ани').first()).toBeVisible();
  await expect(firstPage.getByText('Группа тактиков · общий набор').first()).toBeVisible();
  await firstPage.getByRole('button', { name: 'Открыть игры класса' }).click();
  await expect(
    firstPage.getByRole('heading', { name: 'Вызовы только своим одноклассникам' }),
  ).toBeVisible();
  await expect(firstPage.getByText('Борис Диагональ').first()).toBeVisible();
  await expect(firstPage.locator('textarea')).toHaveCount(0);
  const outsideClass = await firstContext.request.post(
    `/api/checkers/projects/${projectId}/challenges`,
    {
      headers: { origin },
      data: {
        opponentId: '11111111-1111-4111-8111-111111111111',
        mode: 'friendly',
      },
    },
  );
  expect(outsideClass.status()).toBe(403);
  await firstPage
    .getByRole('article')
    .filter({ hasText: 'Борис Диагональ' })
    .getByRole('button', { name: 'Дружеский вызов' })
    .click();
  await expect(firstPage.getByText('Вызов отправлен однокласснику')).toBeVisible();

  await secondPage.goto(route);
  await expect(secondPage.getByText('Персональная серия для Ани')).toHaveCount(0);
  await expect(secondPage.getByText('Группа тактиков · общий набор').first()).toBeVisible();
  await secondPage.getByRole('button', { name: 'Открыть игры класса' }).click();
  const pending = secondPage.getByRole('article').filter({ hasText: 'Аня Комбинация' });
  await expect(pending.getByRole('button', { name: 'Принять вызов' })).toBeVisible();
  await pending.getByRole('button', { name: 'Принять вызов' }).click();
  await expect(secondPage.getByText('Вызов принят')).toBeVisible();
  await secondPage
    .getByRole('article')
    .filter({ hasText: 'Аня Комбинация' })
    .getByRole('button', { name: 'Открыть партию' })
    .click();

  await firstPage.reload();
  await firstPage.getByRole('button', { name: 'Открыть игры класса' }).click();
  await firstPage
    .getByRole('article')
    .filter({ hasText: 'Борис Диагональ' })
    .getByRole('button', { name: 'Открыть партию' })
    .click();
  await expect(firstPage.getByText('Игра класса · в процессе')).toBeVisible();
  await firstPage.locator('[data-square="c3"]').focus();
  await firstPage.keyboard.press('ArrowRight');
  await expect(firstPage.locator('[data-square="e3"]')).toBeFocused();
  await firstPage.locator('[data-square="c3"]').click();
  await firstPage.locator('[data-square="b4"]').click();
  await expect(firstPage.getByText(/Ход c3-b4 сохранён/)).toBeVisible();

  await firstPage.getByRole('tab', { name: 'Реакции' }).click();
  await firstPage.getByRole('button', { name: 'Удачи!' }).click();
  await expect(firstPage.getByText('Добрая реакция отправлена')).toBeVisible();
  const playState = await firstContext.request.get(`/api/checkers/projects/${projectId}/play`);
  expect(playState.status()).toBe(200);
  const playPayload = (await playState.json()) as { games: { id: string; status: string }[] };
  const activeGame = playPayload.games.find((game) => game.status === 'active');
  expect(activeGame).toBeTruthy();
  const cooldown = await firstContext.request.post(
    `/api/checkers/projects/${projectId}/games/${activeGame!.id}/reactions`,
    { headers: { origin }, data: { reactionId: 'good-move' } },
  );
  expect(cooldown.status()).toBe(429);
  const authoredText = await firstContext.request.post(
    `/api/checkers/projects/${projectId}/games/${activeGame!.id}/reactions`,
    {
      headers: { origin },
      data: { reactionId: 'good-move', message: 'произвольный текст запрещён' },
    },
  );
  expect(authoredText.status()).toBe(400);

  await secondPage.reload();
  await secondPage.getByRole('button', { name: 'Открыть игры класса' }).click();
  await secondPage
    .getByRole('article')
    .filter({ hasText: 'Аня Комбинация' })
    .getByRole('button', { name: 'Открыть партию' })
    .click();
  await secondPage.getByRole('tab', { name: 'Реакции' }).click();
  await expect(secondPage.getByText('Аня Комбинация Удачи!')).toBeVisible();
  await secondPage.getByRole('button', { name: 'Сообщить педагогу' }).click();
  await expect(secondPage.getByText('Сигнал передан педагогу')).toBeVisible();
  await secondPage.getByRole('button', { name: 'Скрыть реакции у себя' }).click();
  await expect(secondPage.getByText('Реакции скрыты только у вас')).toBeVisible();
  await secondPage.getByRole('button', { name: 'Показывать реакции' }).click();
  await expect(secondPage.getByText('Аня Комбинация Удачи!')).toBeVisible();

  await firstPage.screenshot({
    path: 'e2e/artifacts/checkers/checkers-class-safe-play.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Создать матч класса' }).click();
  const eventDialog = page.getByRole('dialog', { name: 'Новый матч педагога' });
  await eventDialog.getByLabel('Светлые').selectOption({ label: first.displayName });
  await eventDialog.getByLabel('Тёмные').selectOption({ label: second.displayName });
  await eventDialog.getByRole('button', { name: 'Создать матч', exact: true }).click();
  await expect(page.getByText('Матч педагога создан')).toBeVisible();
  const teacherEventRow = page
    .getByRole('row')
    .filter({ hasText: `${first.displayName} — ${second.displayName}` })
    .filter({ hasText: 'Матч педагога' });
  await expect(teacherEventRow).toContainText('В процессе');
  await teacherEventRow.getByRole('button', { name: 'Открыть разбор' }).click();
  await expect(page.getByText('Пошаговый разбор')).toBeVisible();
  await page.getByRole('button', { name: 'ASA Lab' }).click();
  await expect(page.getByRole('heading', { name: 'Сигналы по реакциям' })).toBeVisible();
  const teacherEventState = await secondContext.request.get(
    `/api/checkers/projects/${projectId}/play`,
  );
  expect(teacherEventState.status()).toBe(200);
  const teacherEventPayload = (await teacherEventState.json()) as {
    games: Array<{ mode: string; status: string }>;
  };
  expect(teacherEventPayload.games).toEqual(
    expect.arrayContaining([expect.objectContaining({ mode: 'teacher-event', status: 'active' })]),
  );
  await firstContext.close();
  await secondContext.close();

  const teacherOverviewResponse = await page
    .context()
    .request.get(`/api/checkers/projects/${projectId}/classroom`);
  expect(teacherOverviewResponse.status()).toBe(200);
  const teacherOverview = (await teacherOverviewResponse.json()) as {
    safetySignals: Array<{ reporterName: string; senderName: string; reactionId: string }>;
  };
  expect(teacherOverview.safetySignals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        reporterName: 'Борис Диагональ',
        senderName: 'Аня Комбинация',
        reactionId: 'good-luck',
      }),
    ]),
  );
  await page.goto(`/#/classrooms/${classroom.classroom.id}/projects/${projectId}`);
  await expect(page.getByRole('heading', { name: 'Сигналы по реакциям' })).toBeVisible();
  await page.getByRole('button', { name: 'Обновить данные' }).click();
  const signalRow = page.getByRole('row', {
    name: /Борис Диагональ Аня Комбинация Удачи/,
  });
  await expect(signalRow).toContainText('Борис Диагональ');
  await expect(signalRow).toContainText('Удачи!');
  teacherFailures.assertEmpty();
  firstFailures.assertEmpty();
  secondFailures.assertEmpty();
});
