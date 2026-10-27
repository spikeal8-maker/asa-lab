import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedLegacyTeacherIdentity, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

// Real API + isolated *_test PostgreSQL. No successful endpoint is mocked.
let admin: pg.Pool;
let teacher: SeededTeacher;
const evidence = 'e2e/artifacts/owner-preview/classroom-participants';
test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'participants');
  mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => {
  await admin.end();
});

test('real participant works, persisted rating, merits, avatars and mixed-cookie isolation', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  await loginWithOrganization(page, teacher);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  const title = `Участники ${randomUUID().slice(0, 8)}`;
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
  const studentDialog = page.getByRole('dialog');
  await studentDialog.getByLabel('Имя в списке класса').fill('Анна Участница');
  await studentDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить ученика', exact: true }).click();
  const peerDialog = page.getByRole('dialog');
  await peerDialog.getByLabel('Имя в списке класса').fill('Борис Участник');
  await peerDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Анна Участница' });
  await row.locator('.classroom-login-handle').click();
  const code = (await row.locator('.classroom-login-handle').innerText()).trim();
  await expect(row.getByLabel('Всего работ: Анна Участница')).toContainText('0');
  const list = (await (await page.request.get('/api/classrooms')).json()) as {
    items: Array<{ id: string; title: string }>;
  };
  const classId = list.items.find((c) => c.title === title)!.id;
  const rosterResponse = await page.request.get(`/api/classrooms/${classId}/roster`);
  const roster = (await rosterResponse.json()) as {
    items: Array<{ id: string; displayLabel: string }>;
  };
  const seatId = roster.items.find((s) => s.displayLabel === 'Анна Участница')!.id;
  const peerSeatId = roster.items.find((s) => s.displayLabel === 'Борис Участник')!.id;
  expect(peerSeatId).not.toBe(seatId);
  await page.locator('.classroom-code-chip').click();
  const shareCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  const studentContext = await browser.newContext();
  try {
    const student = await studentContext.newPage();
    await student.goto(`/#/join-class?code=${encodeURIComponent(shareCode)}`);
    await student.getByLabel('Код ученика', { exact: true }).fill(code);
    await student.getByRole('button', { name: 'Войти', exact: true }).click();
    const createMenu = student.locator('.portal-header .portal-quick-create');
    await createMenu.locator('> summary').click();
    const createdProject = student.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/projects'),
    );
    await createMenu.getByRole('button', { name: /^3D модель/ }).click();
    const creation = await createdProject;
    expect(creation.ok(), await creation.text()).toBe(true);
    const project = (await creation.json()).project;
    await expect(student.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 30_000 });
    await expect(student.getByTestId('asa3d-viewport')).toHaveAttribute(
      'data-runtime-ready',
      'true',
    );
    const titleField = student.getByLabel('Название проекта', { exact: true });
    await titleField.fill('Модель участницы');
    const renamed = student.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith('/api/projects/' + project.id),
    );
    await titleField.press('Enter');
    expect((await renamed).ok()).toBe(true);
    await expect(titleField).toHaveValue('Модель участницы');
    await student.goto('/#/projects');

    await page.reload();
    await expect(row.getByLabel('Всего работ: Анна Участница')).toContainText('1');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    const rating = page.getByRole('region', { name: 'Настройки рейтинга' });
    await rating.getByLabel('Период рейтинга').selectOption('7');
    for (const factor of ['Активные дни', 'Активное время', 'Оценки', 'Дни со входом'])
      await rating.getByLabel(factor, { exact: true }).uncheck();
    await rating.getByLabel('Проекты', { exact: true }).check();
    await rating.getByRole('button', { name: 'Сохранить рейтинг' }).click();
    await expect(rating.getByText('Рейтинг сохранён')).toBeVisible();
    await page.reload();
    await expect(row.getByLabel('Рейтинг: Анна Участница')).toContainText('20');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(rating.getByLabel('Период рейтинга')).toHaveValue('7');
    await expect(rating.getByLabel('Оценки', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Ученики', exact: true }).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(row.getByLabel('Всего работ: Анна Участница')).toBeVisible();
      await expect(row.locator('.classroom-seat-safe')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: `${evidence}/roster-${width}.png`, fullPage: true });
    }
    await row.locator('.classroom-student-name').click();
    await expect(
      page.getByRole('heading', { name: 'Выбрать ученика: Анна Участница', exact: true }),
    ).toBeVisible();
    // The redundant "1 of 1 accessible" sentence is intentionally hidden.
    // The one accessible project and the cross-module filters remain asserted.
    await expect(page.getByTestId('project-card')).toHaveCount(1);
    await expect(page.getByText('Модель участницы', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Электроника', exact: true }).click();
    await expect(page.getByText('Нет доступных работ по этому фильтру.')).toBeVisible();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByText('Модель участницы', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scratch', exact: true }).click();
    await expect(page.getByText('Нет доступных работ по этому фильтру.')).toBeVisible();
    await page.getByRole('button', { name: 'Все работы', exact: true }).click();

    // Abort one transport request, then retry against the real server.
    await page.route(`**/api/classrooms/${classId}/participants/${seatId}/works*`, (route) =>
      route.abort(),
    );
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('сервер недоступен');
    await page.unroute(`**/api/classrooms/${classId}/participants/${seatId}/works*`);
    await page.getByRole('alert').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Модель участницы', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Заслуги', exact: true }).click();

    // UI-05/B1b: real builtin-award API, receipt, persistence and learner visibility.
    type Award = { awardKey: string; note: string | null; awardedBy: string; createdAt: string };
    const awardNote = 'Помог Борису собрать первую схему.';
    const awardKey = 'helper';
    const awardPath = (targetClassId = classId, targetSeatId = seatId) =>
      `/api/classrooms/${targetClassId}/participants/${targetSeatId}/builtin-awards`;
    const writePath = (targetClassId = classId) =>
      `/api/classrooms/${targetClassId}/participants/actions/builtin_grant`;
    const origin = new URL(page.url()).origin;
    const readAwards = async (targetClassId = classId, targetSeatId = seatId) => {
      const response = await page.request.get(awardPath(targetClassId, targetSeatId));
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()) as { items: Award[] };
    };
    const expectDenied = async (
      requester: APIRequestContext,
      expectedStatus: number,
      context: string,
      targetClassId = classId,
      targetSeatId = seatId,
    ) => {
      const before = await readAwards();
      for (const granted of [true, false]) {
        const denied = await requester.post(writePath(targetClassId), {
          headers: { origin },
          data: {
            requestId: randomUUID(),
            seatId: targetSeatId,
            awardKey,
            granted,
            note: granted ? awardNote : null,
          },
        });
        expect(
          denied.status(),
          `${context}: ${granted ? 'grant' : 'revoke'}: ${await denied.text()}`,
        ).toBe(expectedStatus);
        expect(await readAwards()).toEqual(before);
      }
    };
    const awardGrid = page.getByTestId('seat-award-grid');
    const badgeButton = awardGrid.getByRole('button', { name: /Помощник/ });
    const awardDialog = page.getByRole('dialog', { name: 'Причина значка' });
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(badgeButton).toBeVisible();
      await expect(badgeButton).toBeEnabled();
      const bounds = await badgeButton.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await badgeButton.click();
      await expect(awardDialog.getByLabel('Причина')).toBeVisible();
      await expect(awardDialog.getByRole('button', { name: 'Выдать значок' })).toBeVisible();
      await page.screenshot({ path: `${evidence}/builtin-dialog-${width}.png` });
      await awardDialog.getByRole('button', { name: 'Отмена' }).click();
      await expect(awardDialog).toHaveCount(0);
    }
    await badgeButton.click();
    await awardDialog.getByLabel('Причина').fill(awardNote);
    const grantResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith(writePath()),
    );
    await awardDialog.getByRole('button', { name: 'Выдать значок' }).click();
    const granted = await grantResponse;
    expect(granted.status(), await granted.text()).toBe(201);
    const grantBody = granted.request().postDataJSON() as {
      requestId: string;
      seatId: string;
      awardKey: string;
      note: string;
      granted: boolean;
    };
    expect(grantBody).toMatchObject({ seatId, awardKey, note: awardNote, granted: true });
    const grantReceipt = await admin.query<{
      payload: { action: string; input: { requestId: string } };
      result: { items: Award[] };
    }>(
      'SELECT payload,result FROM classroom_participant_receipts WHERE classroom_id=$1 AND request_id=$2',
      [classId, grantBody.requestId],
    );
    expect(grantReceipt.rows).toHaveLength(1);
    expect(grantReceipt.rows[0]!.payload).toMatchObject({
      action: 'builtin_grant',
      input: { requestId: grantBody.requestId, granted: true, seatId, awardKey },
    });
    const savedAwards = await readAwards();
    expect(await granted.json()).toEqual(savedAwards);
    expect(grantReceipt.rows[0]!.result).toEqual(savedAwards);
    const savedBadge = savedAwards.items.find((item) => item.awardKey === awardKey);
    expect(savedBadge).toMatchObject({ awardKey, note: awardNote });
    expect(savedBadge!.awardedBy.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(savedBadge!.createdAt))).toBe(true);
    await expect(badgeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(badgeButton).toContainText(awardNote);
    await expect(badgeButton.locator('em')).toContainText(savedBadge!.awardedBy);
    expect(await badgeButton.locator('em').innerText()).toMatch(/\d/);
    await page.screenshot({ path: `${evidence}/builtin-teacher-granted.png`, fullPage: true });

    // The learner sees the same server record but never receives teacher controls.
    await student.locator('.portal-account > summary').click();
    await student.getByRole('button', { name: 'Настройки', exact: true }).click();
    const earnedAwards = student.getByTestId('seat-awards-earned');
    await expect(earnedAwards).toContainText('Помощник');
    await expect(earnedAwards).toContainText(awardNote);
    await expect(earnedAwards).toContainText(savedBadge!.awardedBy);
    await expect(student.getByRole('button', { name: 'Выдать значок' })).toHaveCount(0);
    await expect(student.getByRole('button', { name: 'Отозвать значок' })).toHaveCount(0);
    await expect(
      (await (await student.request.get('/api/class-join/me/awards')).json()).items,
    ).toContainEqual(savedBadge);
    await student.screenshot({ path: `${evidence}/builtin-student-granted.png` });

    // F5 and reopening the teacher profile must read the persisted award.
    await page.reload();
    await page
      .getByRole('row')
      .filter({ hasText: 'Анна Участница' })
      .locator('.classroom-student-name')
      .click();
    await page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('button', { name: 'Заслуги', exact: true })
      .click();
    await expect(badgeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(badgeButton).toContainText(awardNote);
    expect(await readAwards()).toEqual(savedAwards);

    // Moving to a different learner cannot leak the previous learner's award.
    await page.getByRole('button', { name: 'Выбрать ученика: Анна Участница' }).click();
    await page
      .getByRole('dialog', { name: 'Ученики класса' })
      .getByRole('button', { name: 'Борис Участник' })
      .click();
    await page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('button', { name: 'Заслуги', exact: true })
      .click();
    await expect(badgeButton).toHaveAttribute('aria-pressed', 'false');
    expect((await readAwards(classId, peerSeatId)).items).toEqual([]);
    await page.getByRole('button', { name: 'Выбрать ученика: Борис Участник' }).click();
    await page
      .getByRole('dialog', { name: 'Ученики класса' })
      .getByRole('button', { name: 'Анна Участница' })
      .click();
    await page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('button', { name: 'Заслуги', exact: true })
      .click();
    await expect(badgeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(badgeButton).toContainText(awardNote);

    // Authorization is enforced by the actual API, with unchanged reads after every denial.
    await expectDenied(request, 401, 'anonymous');
    await expectDenied(student.request, 401, 'student seat without teacher credentials');

    // Wrong classroom/seat association is denied even for a teacher of both classes.
    const otherClassResponse = await page.request.post('/api/classrooms', {
      headers: { origin, 'idempotency-key': randomUUID() },
      data: {
        title: `Награды другого класса ${randomUUID().slice(0, 8)}`,
        ageBand: '11-12',
        topicKeys: ['electronics'],
        safeModeDefault: true,
      },
    });
    expect(otherClassResponse.status(), await otherClassResponse.text()).toBe(201);
    const otherClassId = (
      (await otherClassResponse.json()) as {
        classroom: { id: string };
      }
    ).classroom.id;
    const otherSeatResponse = await page.request.post(`/api/classrooms/${otherClassId}/seats`, {
      headers: { origin },
      data: { displayLabel: 'Другой класс', safeMode: true },
    });
    expect(otherSeatResponse.status(), await otherSeatResponse.text()).toBe(201);
    const otherSeatId = (
      (await otherSeatResponse.json()) as {
        student: { id: string };
      }
    ).student.id;
    expect((await readAwards(otherClassId, otherSeatId)).items).toEqual([]);
    await expectDenied(page.request, 403, 'wrong class for seat', otherClassId, seatId);
    await expectDenied(page.request, 403, 'foreign seat for class', classId, otherSeatId);
    expect((await readAwards(otherClassId, otherSeatId)).items).toEqual([]);

    // An educator in the same tenant cannot mutate a class without membership.
    const outsiderEmail = `award-outsider-${randomUUID()}@test.local`;
    const outsiderUser = await admin.query<{ id: string; password_hash: string }>(
      `INSERT INTO users (tenant_id,school_id,role,email,display_name,password_hash)
       SELECT tenant_id,school_id,'teacher',$2,'Посторонний педагог',password_hash
       FROM users WHERE id=$1 RETURNING id,password_hash`,
      [teacher.teacherId, outsiderEmail],
    );
    expect(outsiderUser.rows).toHaveLength(1);
    const workspace = await admin.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE tenant_id=$1 AND kind='organization'",
      [teacher.tenantId],
    );
    expect(workspace.rows).toHaveLength(1);
    await seedLegacyTeacherIdentity(admin, {
      tenantId: teacher.tenantId,
      userId: outsiderUser.rows[0]!.id,
      email: outsiderEmail,
      passwordHash: outsiderUser.rows[0]!.password_hash,
      displayName: 'Посторонний педагог',
      workspaceId: workspace.rows[0]!.id,
    });
    const outsiderContext = await browser.newContext();
    try {
      const outsiderPage = await outsiderContext.newPage();
      await loginWithOrganization(outsiderPage, {
        ...teacher,
        teacherId: outsiderUser.rows[0]!.id,
        email: outsiderEmail,
      });
      await expectDenied(outsiderPage.request, 403, 'same-tenant nonmember');
      // Give a temporary co-teacher membership in the isolated _test DB, then revoke it.
      await admin.query(
        `INSERT INTO classroom_memberships (tenant_id,classroom_id,user_id,account_id,member_role)
         SELECT $1,$2,$3,id,'co_teacher' FROM accounts WHERE email=$4`,
        [teacher.tenantId, classId, outsiderUser.rows[0]!.id, outsiderEmail],
      );
      const allowedRead = await outsiderPage.request.get(awardPath());
      expect(allowedRead.status(), await allowedRead.text()).toBe(200);
      await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND user_id=$2', [
        classId,
        outsiderUser.rows[0]!.id,
      ]);
      await expectDenied(outsiderPage.request, 403, 'revoked co-teacher membership');
    } finally {
      await outsiderContext.close();
    }

    const foreignTeacher = await seedTeacher(admin, 'awards-other-tenant');
    expect(foreignTeacher.tenantId).not.toBe(teacher.tenantId);
    const foreignContext = await browser.newContext();
    try {
      const foreignPage = await foreignContext.newPage();
      await loginWithOrganization(foreignPage, foreignTeacher);
      await expectDenied(foreignPage.request, 403, 'foreign tenant');
    } finally {
      await foreignContext.close();
    }

    // Archived classroom is read-only: 409, not a false success or a hidden button.
    const archivedResponse = await page.request.post(`/api/classrooms/${otherClassId}/status`, {
      headers: { origin },
      data: { status: 'archived' },
    });
    expect(archivedResponse.status(), await archivedResponse.text()).toBe(201);
    await expectDenied(page.request, 409, 'archived classroom', otherClassId, otherSeatId);
    expect((await readAwards(otherClassId, otherSeatId)).items).toEqual([]);

    await page.getByLabel('Название заслуги').fill('Мастер класса');
    await page.getByLabel('Описание', { exact: true }).fill('Аккуратная работа');
    await expect(page.getByLabel('Описание', { exact: true })).toHaveAccessibleName('Описание');
    const refreshProfile = async () => {
      const refreshedProfile = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().endsWith(`/classrooms/${classId}/participants/${seatId}/profile`),
      );
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      expect((await refreshedProfile).ok()).toBe(true);
    };
    await refreshProfile();
    await expect(page.getByLabel('Название заслуги')).toHaveValue('Мастер класса');
    await expect(page.getByLabel('Описание', { exact: true })).toHaveValue('Аккуратная работа');
    await expect(page.getByLabel('Описание', { exact: true })).toHaveAccessibleName('Описание');
    await page.getByRole('button', { name: 'Создать заслугу' }).click();
    const merit = page.locator('.participant-merits li').filter({ hasText: 'Мастер класса' });
    await merit.getByRole('button', { name: 'Выдать', exact: true }).click();
    await expect(merit.getByRole('button', { name: 'Отозвать', exact: true })).toBeVisible();
    await page.getByLabel('Название аватара').fill('Секретный мастер');
    await page.getByLabel('Секретный аватар', { exact: true }).check();
    const meritResponse = await page.request.get(
      `/api/classrooms/${classId}/participants/${seatId}/profile`,
    );
    const beforeUpload = (await meritResponse.json()) as { merits: Array<{ id: string }> };
    await page
      .getByLabel('Открыть при достижении')
      .selectOption(`custom:${beforeUpload.merits[0]!.id}`);
    const image = new PNG({ width: 32, height: 32 });
    image.data.fill(255);
    await page
      .getByLabel('Файлы аватаров')
      .setInputFiles({ name: 'raster.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
    await expect(page.getByRole('button', { name: 'Загрузить 1', exact: true })).toBeVisible();
    await refreshProfile();
    await expect(page.getByLabel('Название аватара')).toHaveValue('Секретный мастер');
    await expect(page.getByLabel('Секретный аватар', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Открыть при достижении')).toHaveValue(
      `custom:${beforeUpload.merits[0]!.id}`,
    );
    await expect(page.getByRole('button', { name: 'Загрузить 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Загрузить 1', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать Секретный мастер', exact: true }).click();
    await refreshProfile();
    await expect(
      page.getByRole('button', { name: 'Выбрать Секретный мастер', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const avatarSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/participants/actions/avatar_choose'),
    );
    await page.getByRole('button', { name: 'Сохранить аватар', exact: true }).click();
    const savedResponse = await avatarSaved;
    expect(savedResponse.status(), await savedResponse.text()).toBe(201);
    await expect(
      page.getByRole('button', { name: 'Выбрать Секретный мастер', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const ownBefore = (await (
      await student.request.get('/api/class-join/participants/me')
    ).json()) as { metrics: { seatId: string; avatarUrl: string }; avatars: Array<{ id: string }> };
    expect(ownBefore.metrics.seatId).toBe(seatId);
    expect(ownBefore.metrics.avatarUrl).toContain('/api/class-join/participants/avatars/');
    expect(
      (await student.request.get(ownBefore.metrics.avatarUrl)).headers()['content-type'],
    ).toContain('image/png');
    const invalid = await page.request.post(
      `/api/classrooms/${classId}/participants/actions/avatar`,
      {
        headers: { origin: new URL(page.url()).origin },
        data: {
          requestId: randomUUID(),
          title: 'Bad',
          secret: false,
          dataUrl: 'data:image/png;base64,PGh0bWw+',
        },
      },
    );
    expect(invalid.status()).toBe(400);
    const oversized = await page.request.post(
      `/api/classrooms/${classId}/participants/actions/avatar`,
      {
        headers: { origin: new URL(page.url()).origin },
        data: {
          requestId: randomUUID(),
          title: 'Big',
          secret: false,
          dataUrl: `data:image/png;base64,${'A'.repeat(300000)}`,
        },
      },
    );
    expect(oversized.status()).toBe(400);
    expect(
      (await (await student.request.get('/api/class-join/participants/me')).json()).metrics
        .avatarUrl,
    ).toBe(ownBefore.metrics.avatarUrl);
    // Role administration moved into the single teacher Settings category.
    // Return to merits to preserve the existing real award/revocation journey.
    await page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    const identity = page
      .getByRole('region', { name: 'Настройки ученика', exact: true })
      .getByRole('button', { name: /^Данные и роль/ });
    await identity.click();
    const role = page.getByRole('combobox', { name: 'Роль ученика в настройках' });
    await role.selectOption('helper');
    await expect(role).toHaveValue('helper');
    await expectDenied(student.request, 401, 'learner helper without educator capability');
    await page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('button', { name: 'Заслуги', exact: true })
      .click();
    expect((await student.request.get(`/api/classrooms/${classId}/participants`)).status()).toBe(
      401,
    );
    await studentContext.addCookies(await page.context().cookies());
    const mixed = await student.request.get('/api/class-join/participants/me');
    expect(mixed.status(), await mixed.text()).toBe(409);
    expect(await mixed.json()).toMatchObject({ error: { code: 'session_conflict' } });
    expect((await mixed.json()).metrics).toBeUndefined();
    await studentContext.clearCookies({ name: 'asa_session' });
    await studentContext.clearCookies({ name: 'asa_refresh' });
    const seatOnly = await student.request.get('/api/class-join/participants/me');
    expect(seatOnly.ok(), await seatOnly.text()).toBe(true);
    expect((await seatOnly.json()).metrics.seatId).toBe(seatId);
    await student.reload();
    expect(
      (await (await student.request.get('/api/class-join/participants/me')).json()).metrics
        .avatarUrl,
    ).toBe(ownBefore.metrics.avatarUrl);
    const meritRevoked = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/participants/actions/merit_grant'),
    );
    await merit.getByRole('button', { name: 'Отозвать', exact: true }).click();
    const revokedResponse = await meritRevoked;
    expect(revokedResponse.status(), await revokedResponse.text()).toBe(201);
    await expect(merit.getByRole('button', { name: 'Выдать', exact: true })).toBeVisible();
    const revoked = await (await student.request.get('/api/class-join/participants/me')).json();
    expect(revoked.avatars).toEqual([]);
    expect(revoked.metrics.avatarUrl).toBeNull();

    // Grant and revoke controls must remain visible at all four owner widths.
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(badgeButton).toHaveAttribute('aria-pressed', 'true');
      await expect(badgeButton).toBeEnabled();
      const bounds = await badgeButton.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `${evidence}/builtin-before-revoke-${width}.png` });
    }
    // Revoke the builtin badge using the teacher UI, not by editing the database.
    const revokeResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith(writePath()),
    );
    await badgeButton.click();
    const ungranted = await revokeResponse;
    expect(ungranted.status(), await ungranted.text()).toBe(201);
    expect(ungranted.request().postDataJSON()).toMatchObject({
      seatId,
      awardKey,
      granted: false,
      note: null,
    });
    const revokeBody = ungranted.request().postDataJSON() as { requestId: string };
    const revokedReceipt = await admin.query<{
      payload: { action: string; input: { granted: boolean } };
      result: { items: Award[] };
    }>(
      'SELECT payload,result FROM classroom_participant_receipts WHERE classroom_id=$1 AND request_id=$2',
      [classId, revokeBody.requestId],
    );
    expect(revokedReceipt.rows).toHaveLength(1);
    expect(revokedReceipt.rows[0]!.payload).toMatchObject({
      action: 'builtin_grant',
      input: { granted: false, seatId, awardKey },
    });
    const awardsAfterRevoke = await readAwards();
    expect(awardsAfterRevoke.items.some((item) => item.awardKey === awardKey)).toBe(false);
    expect(await ungranted.json()).toEqual(awardsAfterRevoke);
    expect(revokedReceipt.rows[0]!.result).toEqual(awardsAfterRevoke);
    await expect(badgeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(badgeButton).not.toContainText(awardNote);

    await page.reload();
    await page
      .getByRole('row')
      .filter({ hasText: 'Анна Участница' })
      .locator('.classroom-student-name')
      .click();
    await page
      .getByRole('navigation', { name: 'Разделы профиля' })
      .getByRole('button', { name: 'Заслуги', exact: true })
      .click();
    await expect(badgeButton).toHaveAttribute('aria-pressed', 'false');
    expect(await readAwards()).toEqual(awardsAfterRevoke);
    await student.reload();
    await expect(earnedAwards).toHaveCount(0);
    await expect(
      student.getByText('Пока ни одного. Значки появляются за работы, идеи и помощь другим.'),
    ).toBeVisible();

    // A fresh seat-code login gets a fresh server read, not an old browser cache.
    const freshStudentContext = await browser.newContext();
    try {
      const freshStudent = await freshStudentContext.newPage();
      await freshStudent.goto(`/#/join-class?code=${encodeURIComponent(shareCode)}`);
      await freshStudent.getByLabel('Код ученика', { exact: true }).fill(code);
      await freshStudent.getByRole('button', { name: 'Войти', exact: true }).click();
      await freshStudent.locator('.portal-account > summary').click();
      await freshStudent.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(freshStudent.getByTestId('seat-awards-earned')).toHaveCount(0);
      await expect(
        freshStudent.getByText(
          'Пока ни одного. Значки появляются за работы, идеи и помощь другим.',
        ),
      ).toBeVisible();
      const learnerRead = await freshStudent.request.get('/api/class-join/me/awards');
      expect(learnerRead.status(), await learnerRead.text()).toBe(200);
      expect(
        ((await learnerRead.json()) as { items: Award[] }).items.some(
          (item) => item.awardKey === awardKey,
        ),
      ).toBe(false);
      await freshStudent.screenshot({ path: `${evidence}/builtin-student-after-relogin.png` });
    } finally {
      await freshStudentContext.close();
    }
    await page.screenshot({ path: `${evidence}/merits.png`, fullPage: true });
  } finally {
    await studentContext.close();
  }
});
