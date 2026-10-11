import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
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
  // seedTeacher is a migrated organization account; unlike registration it has
  // no personal workspace. Bootstrap only that isolated test membership. All
  // switching, class creation and course assignment below use production commands.
  const actor = await profileTeacherIdentity(admin, owner);
  const personal = await admin.query('SELECT * FROM auth_personal_workspace($1)', [
    actor.account_id,
  ]);
  if (personal.rows.length === 0) {
    const tenantId = randomUUID(),
      workspaceId = randomUUID();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO tenants(id,title,workspace_slug) VALUES($1,$2,$3)', [
        tenantId,
        'Личные классы автора',
        'profile-personal-' + tenantId,
      ]);
      await client.query(
        "INSERT INTO tenant_placements(tenant_id,mode) VALUES($1,'SHARED_CLUSTER')",
        [tenantId],
      );
      await client.query(
        "INSERT INTO workspaces(id,tenant_id,kind,title) VALUES($1,$2,'personal','Личное пространство')",
        [workspaceId, tenantId],
      );
      await client.query(
        "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'owner')",
        [actor.account_id, workspaceId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
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
async function confirmStudentCodeSignIn(page: Page): Promise<void> {
  // Clicking does not await fetch; an immediate goto aborted the second pupil's
  // login in the real trace. Wait for the actual response and stored cookie.
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/class-join/studentseat',
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(200);
  await response.finished();
  const cookies = await page.context().cookies(new URL(page.url()).origin);
  expect(
    cookies.some((cookie) => cookie.name === 'asa_student_session' && cookie.value.length > 0),
  ).toBe(true);
}
async function createClass(page: Page) {
  await loginWithOrganization(page, owner);
  // This scenario deliberately tests an organization author teaching in a personal class.
  const session = await get<{ workspaces: Array<{ workspaceId: string; kind: string }> }>(
    page,
    '/api/auth/me',
  );
  const personal = session.workspaces.find((workspace) => workspace.kind === 'personal');
  expect(personal, 'The author has a personal teaching workspace').toBeDefined();
  await post(page, '/api/session/context', { workspaceId: personal!.workspaceId });
  await page.reload();
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
  await page.locator('.classroom-code-chip').click();
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
  // API fixture setup does not refresh an already-mounted same-hash classroom.
  await page.reload();
  await page.getByRole('row').filter({ hasText: name }).locator('.classroom-student-name').click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function assertLayout(page: Page, width: number, file: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.locator('#main-content').evaluate((element) => {
    (element as HTMLElement).focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const controls = page.locator(
    '.participant-tabs button, .participant-assignments button, .participant-assignments a, .participant-role select, .participant-grades button',
  );
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    const rect = await control.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1);
    if (
      await control.evaluate((element) =>
        Boolean(element.closest('.participant-grades, .participant-assignments')),
      )
    ) {
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  if (width <= 900) {
    const header = page.locator('.portal-header');
    const rect = await header.boundingBox();
    expect(rect!.y).toBe(0);
    expect(rect!.height).toBe(56);
    const headerControls = header.locator(
      '.portal-menu-toggle, .portal-brand, .portal-global-nav a, .portal-header-create, .portal-account > summary',
    );
    await expect(headerControls).toHaveCount(6);
    let previousRight = 0;
    for (const control of await headerControls.all()) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(previousRight - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      previousRight = box.x + box.width;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(56);
    }
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
  const version = await seedProfileProjectActivity(admin, owner, title, classroom.id);
  const assignment = await post(page, `/api/classrooms/${classroom.id}/learning/activity-runs`, {
    activityVersionId: version,
    audienceType: 'named_learners',
    seatIds: [a.id],
    dueAt: null,
    requestId: randomUUID(),
  });
  const theory = await seedProfileTheory(admin, owner, classroom.id, [a.id]);
  const lineage = (
    await admin.query(
      `SELECT classroom.tenant_id class_tenant,source.tenant_id source_tenant,
      copy.tenant_id copy_tenant,copy.copied_from_course_id,
      run.tenant_id run_tenant,run.course_id,run.course_version_id,lesson.tenant_id lesson_tenant,
      lesson.source_lesson_id,version.outline->'sections'->0->'lessons'->0->>'sourceLessonId' pinned_lesson
    FROM classroom_course_runs run
    JOIN classrooms classroom ON classroom.id=run.classroom_id
    JOIN classroom_course_run_lessons lesson ON lesson.run_id=run.id
    JOIN courses copy ON copy.id=run.course_id
    JOIN courses source ON source.id=copy.copied_from_course_id
    JOIN course_versions version ON version.id=run.course_version_id
    WHERE run.id=$1`,
      [theory.courseRunId],
    )
  ).rows[0];
  expect(lineage.source_tenant).toBe(owner.tenantId);
  expect(lineage.class_tenant).not.toBe(owner.tenantId);
  expect(lineage).toMatchObject({
    copy_tenant: lineage.class_tenant,
    copied_from_course_id: theory.sourceCourseId,
    run_tenant: lineage.class_tenant,
    course_id: theory.courseId,
    course_version_id: theory.versionId,
    lesson_tenant: lineage.class_tenant,
    source_lesson_id: theory.sourceLessonId,
    pinned_lesson: theory.sourceLessonId,
  });
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
  const theoryRow = list.locator(`[data-assignment-id="${theory.lessonId}"]`);
  await expect(theoryRow).toHaveCount(1);
  await expect(theoryRow).toContainText('Теория курса');
  await expect(theoryRow.getByRole('link', { name: 'Открыть задание' })).toHaveAttribute(
    'href',
    `#/classrooms/${classroom.id}?courseRun=${theory.courseRunId}&lesson=${theory.lessonId}`,
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
      await confirmStudentCodeSignIn(learner);
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
    expect(selfBefore.items.filter((item) => item.id === theory.lessonId)).toEqual([
      expect.objectContaining({ kind: 'theory', courseRunId: theory.courseRunId, projectId: null }),
    ]);
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
    a = await addPupil(
      page,
      classroom.id,
      'История Александры Константинопольской Длинное Имя Участника',
    ),
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
    await confirmStudentCodeSignIn(seat);
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
            reason: i ? `Уточнение: ${'ПодробныйКомментарийПреподавателя'.repeat(8)}` : null,
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
    const avatarTitle = `Несохранённый выбор ${randomUUID().slice(0, 8)}`;
    const image = new PNG({ width: 32, height: 32 });
    image.data.fill(255);
    await post(page, `/api/classrooms/${classroom.id}/participants/actions/avatar`, {
      requestId: randomUUID(),
      title: avatarTitle,
      secret: false,
      dataUrl: `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`,
    });
    for (const [learner, route, profilePath] of [
      [account, '/#/attending', `/api/classrooms/${classroom.id}/participants/${ownId}/profile`],
      [seat, '/#/learning', '/api/class-join/participants/me'],
    ] as const) {
      await learner.goto(route);
      if (learner === account)
        await learner.getByRole('button', { name: 'Мой рейтинг и заслуги', exact: true }).click();
      const summary = learner.getByRole('region', { name: 'Мои показатели', exact: true });
      const details = summary
        .locator('details')
        .filter({ has: learner.locator('.participant-grades') });
      await details.locator('summary').click();
      await details
        .locator('.participant-grade-row')
        .filter({ hasText: 'symbols' })
        .getByRole('button', { name: 'История', exact: true })
        .click();
      await expect(details.locator('.participant-history ol li')).toHaveCount(5);
      const draft = summary.getByRole('button', { name: `Выбрать ${avatarTitle}`, exact: true });
      await draft.click();
      await expect(draft).toHaveAttribute('aria-pressed', 'true');
      const mounted = await Promise.all([
        details.elementHandle(),
        details.locator('.participant-history').elementHandle(),
        summary.locator('.participant-recognition').elementHandle(),
        draft.elementHandle(),
      ]);
      const refreshed = learner.waitForResponse(
        (response) =>
          response.request().method() === 'GET' && new URL(response.url()).pathname === profilePath,
      );
      await learner.evaluate(() => window.dispatchEvent(new Event('focus')));
      const response = await refreshed;
      expect(response.ok()).toBe(true);
      expect(await response.finished()).toBeNull();
      await expect(draft).toHaveAttribute('aria-pressed', 'true');
      await expect(details).toHaveAttribute('open', '');
      await expect(details.locator('.participant-history ol li')).toHaveCount(5);
      for (const node of mounted) {
        expect(node).not.toBeNull();
        expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
        await node!.dispose();
      }
    }
    await openProfile(page, classroom.id, a.name);
    await page.getByRole('button', { name: 'Оценки и история', exact: true }).click();
    const gradesRegion = page.getByRole('region', { name: 'Оценки и история' });
    await expect(
      gradesRegion.locator('.participant-grade-value').filter({ hasText: /^0$/ }),
    ).toHaveCount(1);
    await page
      .getByRole('region', { name: 'Оценки и история' })
      .locator('.participant-grade-row')
      .filter({ hasText: 'symbols' })
      .getByRole('button', { name: 'История', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'История ручной оценки' })).toBeVisible();
    const history = page.locator('.participant-history');
    await expect(history.locator('ol li')).toHaveCount(5);
    await expect(history).toContainText(
      `Уточнение: ${'ПодробныйКомментарийПреподавателя'.repeat(8)}`,
    );
    const times = history.locator('time');
    expect(await times.count()).toBeGreaterThan(0);
    for (const time of await times.all()) {
      const original = await time.getAttribute('datetime');
      expect(original).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      await expect(time).not.toHaveText(original!);
      expect(await time.innerText()).toContain(String(new Date(original!).getFullYear()));
    }
    const historyRefreshed = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes(`/participants/${a.id}/grades?`),
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await historyRefreshed).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'История ручной оценки' })).toBeVisible();
    for (const width of [320, 390, 1440]) await assertLayout(page, width, 'grade-history');
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
