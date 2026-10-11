import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import {
  profileTeacherIdentity,
  seedProfileProjectActivity,
  seedProfileTheory,
} from '../tests/portal/classroom-profile-fixture';
import type {
  ParticipantAssignments,
  ParticipantGrades,
  ParticipantManualHistory,
} from '../apps/web/src/classroom-participants-api';

// Production browser bundle + real API + isolated *_test PostgreSQL. No mocks.
let admin: pg.Pool, owner: SeededTeacher, outsider: SeededTeacher;
const screenshots = 'e2e/artifacts/owner-preview/classroom-profile-completion';
test.beforeAll(async () => {
  admin = e2eAdminPool();
  owner = await seedTeacher(admin, 'profile-completion');
  outsider = await seedTeacher(admin, 'profile-foreign');
  mkdirSync(screenshots, { recursive: true });
});
test.afterAll(async () => {
  await admin?.end();
});
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, {
    headers: { origin: new URL(page.url()).origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function get<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function createClass(page: Page) {
  await loginWithOrganization(page, owner);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page
    .getByRole('button', { name: /^Создать (новый )?класс$/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' }),
    title = `Профиль ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Название класса').fill(title);
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  const classes = await get<{ items: Array<{ id: string; title: string }> }>(
    page,
    '/api/classrooms',
  );
  return {
    id: classes.items.find((c) => c.title === title)!.id,
    title,
    code: (await page.locator('.classroom-code-chip').innerText()).trim(),
  };
}
async function addPupil(page: Page, classId: string, name: string) {
  const created = await post(page, `/api/classrooms/${classId}/seats`, {
    displayLabel: name,
    safeMode: true,
  });
  const credential = await post(
    page,
    `/api/classrooms/${classId}/seats/${created.student.id}/code`,
    { requestId: randomUUID() },
  );
  return { id: created.student.id as string, name, code: credential.studentCode as string };
}
async function openProfile(page: Page, classId: string, name: string) {
  await page.goto(`/#/classrooms/${classId}`);
  await page.getByRole('row').filter({ hasText: name }).locator('.classroom-student-name').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function assertLayout(page: Page, width: number, file: string) {
  await page.setViewportSize({ width, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const controls = page.locator(
    '.participant-tabs button, .participant-assignments button, .participant-assignments a, .participant-role select',
  );
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const rect = await control.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
    expect(
      await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  await page.screenshot({ path: `${screenshots}/${file}-${width}.png`, fullPage: true });
}

test('assigned without a project stays one row through start, submission and review; theory, exclusion, helper and real mobile profile', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const classroom = await createClass(page);
  const a = await addPupil(
    page,
    classroom.id,
    'Александра Константинопольская Длинное Имя Участника',
  );
  const b = await addPupil(page, classroom.id, 'Борис Другой Участник');
  const actor = await profileTeacherIdentity(admin, owner);
  await admin.query('SELECT classroom_participant_prepare($1,$2::uuid[])', [
    actor.principal_id,
    [classroom.id],
  ]);
  const title = 'Назначено, но ещё не открыто';
  const version = await seedProfileProjectActivity(admin, owner, title);
  const assignment = await post(page, `/api/classrooms/${classroom.id}/learning/activity-runs`, {
    activityVersionId: version,
    audienceType: 'named_learners',
    seatIds: [a.id],
    dueAt: null,
    requestId: randomUUID(),
  });
  const theory = await seedProfileTheory(admin, owner, classroom.id, [a.id]);
  const counts = async () =>
    (
      await admin.query(
        `SELECT
    (SELECT count(*)::int FROM projects WHERE owner_principal_id IN(SELECT id FROM classroom_participant_principals($1))) projects,
    (SELECT count(*)::int FROM learning_attempts WHERE seat_id=$1) attempts,
    (SELECT count(*)::int FROM learning_submissions sub JOIN learning_attempts attempt ON attempt.id=sub.attempt_id WHERE attempt.seat_id=$1) submissions`,
        [a.id],
      )
    ).rows[0];
  const before = await counts();
  await openProfile(page, classroom.id, a.name);
  await expect(page.getByRole('region', { name: 'Последние оценки' })).toBeVisible();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  const list = page.getByRole('region', { name: 'Задания участника' });
  const row = list.locator(`[data-assignment-id="${assignment.assignmentId}"]`);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Не начато');
  await expect(row.getByRole('link', { name: 'Открыть проект' })).toHaveCount(0);
  await expect(list.locator(`[data-assignment-id="${theory.lessonId}"]`)).toContainText(
    'Теория курса',
  );
  expect(await counts()).toEqual(before);
  const other = await get<ParticipantAssignments>(
    page,
    `/api/classrooms/${classroom.id}/participants/${b.id}/assignments`,
  );
  expect(other.items).toEqual([]);
  for (const width of [390, 1440])
    await assertLayout(page, width, 'assigned-not-started-long-name');

  const pupilContext = await browser.newContext(),
    pupil = await pupilContext.newPage();
  const secondContext = await browser.newContext(),
    second = await secondContext.newPage();
  const foreignContext = await browser.newContext(),
    foreign = await foreignContext.newPage();
  try {
    for (const [learner, seat] of [
      [pupil, a],
      [second, b],
    ] as const) {
      await learner.goto(`/#/join-class?code=${encodeURIComponent(classroom.code)}`);
      await learner.getByLabel('Код ученика', { exact: true }).fill(seat.code);
      await learner.getByRole('button', { name: 'Войти', exact: true }).click();
      await learner.goto('/#/learning');
    }
    expect(
      (await get<ParticipantAssignments>(second, '/api/class-join/participants/assignments')).items,
    ).toEqual([]);
    expect(
      (
        await second.request.get(`/api/classrooms/${classroom.id}/participants/${a.id}/assignments`)
      ).status(),
    ).toBe(401);
    const selfBefore = await get<ParticipantAssignments>(
      pupil,
      '/api/class-join/participants/assignments',
    );
    expect(selfBefore.items.find((item) => item.id === assignment.assignmentId)).toMatchObject({
      status: 'not_started',
      projectId: null,
    });
    expect(await counts()).toEqual(before);
    await loginWithOrganization(foreign, outsider);
    expect(
      (
        await foreign.request.get(
          `/api/classrooms/${classroom.id}/participants/${a.id}/assignments`,
        )
      ).status(),
    ).toBe(404);

    const started = await post(pupil, `/api/learning/work/runs/${assignment.activityRunId}/start`, {
      requestId: randomUUID(),
    });
    await page.getByRole('button', { name: 'Обновить задания' }).click();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('В работе');
    await expect(row.getByRole('link', { name: 'Открыть проект' })).toBeVisible();
    expect((await counts()).projects).toBe(before.projects + 1);
    await pupil.goto(`/#/projects/${started.projectId}`);
    await expect(pupil.getByTestId('asa3d-viewport')).toHaveAttribute(
      'data-runtime-ready',
      'true',
      { timeout: 60_000 },
    );
    const library = pupil.getByRole('button', { name: 'Добавить фигуру', exact: true });
    if (await library.isVisible()) await library.click();
    const saved = pupil.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes(`/api/projects/${started.projectId}/draft`),
    );
    await pupil.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    const stored = await get<{ draft: { revision: number } }>(
      pupil,
      `/api/projects/${started.projectId}`,
    );
    const submitted = await post(pupil, `/api/learning/projects/${started.projectId}/submit`, {
      clientRequestId: randomUUID(),
      expectedRevision: stored.draft.revision,
    });
    await page.getByRole('button', { name: 'Обновить задания' }).click();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Ждёт проверки');
    const review = await post(
      page,
      `/api/classrooms/${classroom.id}/attempts/${submitted.attemptId}/review`,
      {
        decision: 'changes_requested',
        points: null,
        feedback: 'Добавь деталь',
        reason: 'Нужна деталь',
        requestId: randomUUID(),
        expectedResultId: null,
      },
    );
    await page.getByRole('button', { name: 'Обновить задания' }).click();
    await expect(row).toContainText('На доработке');
    await post(page, `/api/classrooms/${classroom.id}/attempts/${submitted.attemptId}/review`, {
      decision: 'accepted',
      points: null,
      feedback: 'Работа принята',
      reason: 'Уточнение проверки',
      requestId: randomUUID(),
      expectedResultId: review.assessmentResultId,
    });
    await page.getByRole('button', { name: 'Обновить задания' }).click();
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Принято');
    expect(
      (
        await get<ParticipantAssignments>(pupil, '/api/class-join/participants/assignments')
      ).items.find((item) => item.id === assignment.assignmentId)?.status,
    ).toBe('completed');
    expect((await counts()).projects).toBe(before.projects + 1);

    await page.getByLabel('Роль в классе').selectOption('helper');
    await expect(page.getByRole('region', { name: 'Классы помощника' })).toContainText(
      classroom.title,
    );
    await expect(page.getByRole('region', { name: 'Последние оценки' })).toHaveCount(0);
    expect((await pupil.request.get(`/api/classrooms/${classroom.id}/participants`)).status()).toBe(
      401,
    );
    expect(
      (
        await pupil.request.get(`/api/classrooms/${classroom.id}/participants/${b.id}/grades`)
      ).status(),
    ).toBe(401);
    await pupil.goto('/#/learning');
    await expect(pupil.getByRole('heading', { name: 'Мои заслуги', exact: true })).toBeVisible();
    await expect(pupil.getByRole('heading', { name: 'Заслуги преподавателя' })).toHaveCount(0);
    await expect(pupil.getByRole('region', { name: 'Мои показатели' })).not.toContainText('API');
    for (const width of [390, 1440]) await assertLayout(page, width, 'helper-profile');
    await post(
      page,
      `/api/classrooms/${classroom.id}/learning/audiences/${assignment.audienceId}/members/${a.id}`,
      {
        include: false,
        expectedIncluded: true,
        reason: 'Исключён из назначения',
        requestId: randomUUID(),
      },
    );
    await page.getByRole('button', { name: 'Обновить задания' }).click();
    await expect(row).toHaveCount(0);
    expect(
      (
        await get<ParticipantAssignments>(pupil, '/api/class-join/participants/assignments')
      ).items.some((item) => item.id === assignment.assignmentId),
    ).toBe(false);
    const theoryRow = list.locator(`[data-assignment-id="${theory.lessonId}"]`);
    await expect(theoryRow).toHaveCount(1);
    await theoryRow.getByRole('link', { name: 'Открыть задание' }).click();
    await expect(page.locator('.classroom-course-detail-head')).toContainText(theory.title);
  } finally {
    await Promise.all([pupilContext.close(), secondContext.close(), foreignContext.close()]);
  }
});

test('real full Account and Seat manual history preserves zero and all five levels while mixed identities remain isolated', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const classroom = await createClass(page),
    a = await addPupil(page, classroom.id, 'История Анны'),
    b = await addPupil(page, classroom.id, 'История Бориса');
  const accountOwner = await seedTeacher(admin, 'profile-account-self');
  const accountContext = await browser.newContext(),
    account = await accountContext.newPage();
  const seatContext = await browser.newContext(),
    seat = await seatContext.newPage();
  try {
    await loginWithOrganization(account, accountOwner);
    const pending = await post(account, '/api/class-join/account', { code: classroom.code });
    await post(page, `/api/class-join/requests/${classroom.id}/${pending.requestId}/decision`, {
      decision: 'approved',
      reason: null,
    });
    const classes = await get<{ items: Array<{ classroomId: string; seatId: string }> }>(
      account,
      '/api/class-join/account/classes',
    );
    const ownId = classes.items.find((c) => c.classroomId === classroom.id)!.seatId;
    await seat.goto(`/#/join-class?code=${encodeURIComponent(classroom.code)}`);
    await seat.getByLabel('Код ученика', { exact: true }).fill(a.code);
    await seat.getByRole('button', { name: 'Войти', exact: true }).click();
    let revision = 0;
    for (const preset of ['five', 'symbols', 'smileys'] as const) {
      await post(page, `/api/classrooms/${classroom.id}/journal/scale`, {
        preset,
        expectedRevision: revision++,
        requestId: randomUUID(),
      });
      const column = await post(page, `/api/classrooms/${classroom.id}/journal/column`, {
        date: '2026-10-10',
        category: preset,
        expectedRevision: revision,
        requestId: randomUUID(),
      });
      const values = preset === 'five' ? [0] : [1, 2, 3, 4, 5];
      for (const id of [a.id, ownId])
        for (let i = 0; i < values.length; i++)
          await post(page, `/api/classrooms/${classroom.id}/journal/grade`, {
            columnId: column.id,
            seatId: id,
            value: values[i],
            expectedRevision: i,
            reason: i ? 'Уточнение' : null,
            requestId: randomUUID(),
          });
      const seatHistory = await get<ParticipantManualHistory>(
        seat,
        `/api/class-join/participants/history/${column.id}`,
      );
      const ownHistory = await get<ParticipantManualHistory>(
        account,
        `/api/classrooms/${classroom.id}/participants/${ownId}/history/${column.id}`,
      );
      expect(seatHistory.preset).toBe(preset);
      expect(ownHistory.preset).toBe(preset);
      expect(seatHistory.items.map((g) => g.value)).toEqual([...values].reverse());
      expect(ownHistory.items.map((g) => g.value)).toEqual([...values].reverse());
      expect(
        (
          await account.request.get(
            `/api/classrooms/${classroom.id}/participants/${a.id}/history/${column.id}`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await account.request.get(`/api/classrooms/${classroom.id}/participants/${b.id}/grades`)
        ).status(),
      ).toBe(404);
    }
    expect(
      (
        await get<ParticipantGrades>(seat, '/api/class-join/participants/grades')
      ).journal.grades.every((g) => g.seatId === a.id),
    ).toBe(true);
    expect(
      (
        await get<ParticipantGrades>(
          account,
          `/api/classrooms/${classroom.id}/participants/${ownId}/grades`,
        )
      ).journal.grades.every((g) => g.seatId === ownId),
    ).toBe(true);
    await openProfile(page, classroom.id, a.name);
    await page.getByRole('button', { name: 'Оценки и история', exact: true }).click();
    await page
      .getByRole('region', { name: 'Оценки и история' })
      .getByRole('button', { name: 'История', exact: true })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'История ручной оценки' })).toBeVisible();
    for (const width of [390, 1440]) await assertLayout(page, width, 'grade-history');
    await seatContext.addCookies(await accountContext.cookies());
    for (const path of [
      '/api/class-join/participants/grades',
      '/api/class-join/participants/assignments',
      '/api/class-join/participants/me',
    ]) {
      const mixed = await seat.request.get(path);
      expect(mixed.status()).toBe(409);
      expect(await mixed.json()).toMatchObject({ error: { code: 'session_conflict' } });
    }
    await seatContext.clearCookies({ name: 'asa_session' });
    await seatContext.clearCookies({ name: 'asa_refresh' });
    expect(
      (
        await get<ParticipantGrades>(seat, '/api/class-join/participants/grades')
      ).journal.grades.every((g) => g.seatId === a.id),
    ).toBe(true);
  } finally {
    await Promise.all([accountContext.close(), seatContext.close()]);
  }
});
