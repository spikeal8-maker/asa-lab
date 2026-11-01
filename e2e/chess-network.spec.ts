import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import { openChessGame } from './open-chess-game';

const evidence = 'e2e/artifacts/chess/network';

test('private history loads the 26th real durable match after reload', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(180000);
  if (
    process.env['CI'] !== 'true' ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']).pathname.endsWith('_test')
  )
    throw new Error('Isolated CI Chess network stack required');
  const admin = e2eAdminPool();
  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
  const origin = new URL(baseURL!).origin;
  try {
    const teacher = await seedTeacher(admin, 'chess-history-pages');
    await loginWithOrganization(page, teacher);
    const fixture = await classroom(page, 'История сетевых шахмат');
    await policy(page, fixture.id, 'classroom');
    const a = await pupil(browser, origin, fixture, await seat(page, fixture, 'История белых'));
    contexts.push(a.context);
    const b = await pupil(browser, origin, fixture, await seat(page, fixture, 'История чёрных'));
    contexts.push(b.context);
    let oldest = '';
    for (let index = 0; index < 26; index++) {
      const created = await post(a.page.request, origin, 'invites', {
        scope: 'classroom',
        initialMs: 600000,
        incrementMs: 0,
        colorPreference: 'white',
      });
      expect(created.status(), await created.text()).toBe(201);
      const accepted = await post(
        b.page.request,
        origin,
        `invites/${(await created.json()).invite.code}/accept`,
        {},
      );
      expect(accepted.status(), await accepted.text()).toBe(201);
      const match = (await accepted.json()).match;
      if (index === 0) oldest = match.id;
      const finished = await post(a.page.request, origin, `matches/${match.id}/commands`, {
        expectedVersion: match.version,
        action: 'resign',
      });
      expect(finished.status(), await finished.text()).toBe(201);
    }
    // Teacher is not a participant and cannot see pupils' private history.
    expect((await (await page.request.get('/api/games/chess/history')).json()).matches).toEqual([]);
    await openChessGame(a.page, 'История из 26 реальных партий');
    await a.page.getByRole('button', { name: 'Онлайн', exact: true }).click();
    await a.page.reload();
    const history = a.page
      .getByRole('heading', { name: 'Мои сетевые партии', exact: true })
      .locator('..');
    await expect(history.locator('button[data-match-id]')).toHaveCount(25);
    await a.page.getByRole('button', { name: 'Загрузить ещё партии', exact: true }).click();
    await expect(history.locator('button[data-match-id]')).toHaveCount(26);
    mkdirSync(evidence, { recursive: true });
    for (const width of [1440, 1024, 390, 320]) {
      await a.page.setViewportSize({ width, height: 900 });
      expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await a.page.screenshot({ path: `${evidence}/history-26-${width}.png`, fullPage: true });
    }
    const response = a.page.waitForResponse(
      (value) =>
        value.url().endsWith(`/api/games/chess/matches/${oldest}`) &&
        value.request().method() === 'GET',
    );
    await history.locator(`button[data-match-id="${oldest}"]`).click();
    expect((await response).status()).toBe(200);
    await expect(a.page.getByText('Результат сохранён.', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await admin.end();
  }
});
interface ClassFixture {
  id: string;
  code: string;
}

test('cold offline lobby recovers durable invitation and live game without reload or forced navigation', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(120000);
  if (
    process.env['CI'] !== 'true' ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']).pathname.endsWith('_test')
  )
    throw new Error('Isolated CI Chess network stack required');
  const admin = e2eAdminPool();
  const origin = new URL(baseURL!).origin;
  const other = await browser.newContext({ baseURL: origin });
  try {
    await loginWithOrganization(page, await seedTeacher(admin, 'chess-recovery-a'));
    const opponent = await other.newPage();
    await loginWithOrganization(opponent, await seedTeacher(admin, 'chess-recovery-b'));
    const created = await post(page.request, origin, 'invites', {
      scope: 'platform',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    expect(created.status(), await created.text()).toBe(201);
    const code = (await created.json()).invite.code;
    await openChessGame(page, 'Восстановление сетевой игры');
    // Keep the real application loaded while disconnecting its actual transport.
    // Adult fixtures avoid the separate pupil offline-admission guard unmounting the module.
    const networkHash = await page.evaluate(
      () => location.hash.split('/').slice(0, 3).join('/') + '/network',
    );
    await page.context().setOffline(true);
    await page.evaluate((hash) => {
      location.hash = hash;
    }, networkHash);
    await expect(
      page.getByText('Приглашения и история не загружены.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Здесь появятся ваши партии.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Подключено', { exact: true })).toHaveCount(0);
    mkdirSync(evidence, { recursive: true });
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole('button', { name: 'Повторить загрузку', exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${evidence}/history-offline-${width}.png`, fullPage: true });
    }
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(page.getByLabel('Ваш код приглашения')).toHaveText(code);
    const accepted = await post(opponent.request, origin, `invites/${code}/accept`, {});
    expect(accepted.status(), await accepted.text()).toBe(201);
    await expect(page.getByTestId('asa-chess-board')).toBeVisible();
    await page.getByRole('button', { name: 'Главная', exact: true }).click();
    await page.context().setOffline(true);
    await page.evaluate((hash) => {
      location.hash = hash;
    }, networkHash);
    await expect(
      page.getByRole('button', { name: 'Повторить загрузку', exact: true }),
    ).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByTestId('asa-chess-board')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'К приглашениям', exact: true }).click();
    await page.waitForTimeout(11000);
    await expect(page.getByTestId('asa-chess-board')).toHaveCount(0);
    await page.getByRole('button', { name: /Продолжить партию/ }).click();
    await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  } finally {
    await page.context().setOffline(false);
    await other.close();
    await admin.end();
  }
});
interface IssuedSeat {
  id: string;
  studentCode: string;
}
async function classroom(page: Page, title: string): Promise<ClassFixture> {
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': randomUUID() },
    data: { title, ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).classroom.id as string;
  const details = await page.request.get(`/api/classrooms/${id}`);
  expect(details.status(), await details.text()).toBe(200);
  return { id, code: (await details.json()).classroom.joinCode as string };
}
async function seat(page: Page, fixture: ClassFixture, name: string): Promise<IssuedSeat> {
  const issued = await page.request.post(`/api/classrooms/${fixture.id}/seats`, {
    headers: { origin: new URL(page.url()).origin },
    data: { displayLabel: name, safeMode: true },
  });
  expect(issued.status(), await issued.text()).toBe(201);
  return (await issued.json()).student as IssuedSeat;
}
async function pupil(browser: Browser, origin: string, fixture: ClassFixture, issued: IssuedSeat) {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  await page.goto(`${origin}/#/join-class?code=${encodeURIComponent(fixture.code)}`);
  await page.getByLabel('Код ученика', { exact: true }).fill(issued.studentCode);
  const signed = page.waitForResponse(
    (response) =>
      response.url().includes('/api/class-join/studentseat') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await signed).status()).toBe(200);
  return { context, page };
}
async function policy(page: Page, id: string, scope: string, enabled = true) {
  const read = await page.request.get(`/api/games/chess/policy/${id}`);
  expect(read.status()).toBe(200);
  const response = await page.request.put(`/api/games/chess/policy/${id}`, {
    headers: { origin: new URL(page.url()).origin, 'idempotency-key': randomUUID() },
    data: { enabled, scope, expectedVersion: (await read.json()).version },
  });
  expect(response.status(), await response.text()).toBe(200);
}
async function post(request: APIRequestContext, origin: string, path: string, data: unknown) {
  return request.post(`/api/games/chess/${path}`, {
    headers: { origin, 'idempotency-key': randomUUID() },
    data,
  });
}

test('real two-pupil Chess, teacher controls, reconnect/history and all opponent scopes', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(240000);
  const origin = new URL(baseURL!).origin;
  if (
    process.env['CI'] !== 'true' ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']).pathname.endsWith('_test')
  )
    throw new Error('Isolated CI Chess network stack required');
  let admin: pg.Pool | undefined;
  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  mkdirSync(evidence, { recursive: true });
  try {
    admin = e2eAdminPool();
    const teacher = await seedTeacher(admin, 'chess-network-a');
    const foreignTeacher = await seedTeacher(admin, 'chess-network-b');
    expect(teacher.tenantId).not.toBe(foreignTeacher.tenantId);
    await loginWithOrganization(page, teacher);
    const aClass = await classroom(page, 'Шахматы — первый класс');
    const bClass = await classroom(page, 'Шахматы — второй класс');
    const aSeat = await seat(page, aClass, 'Первый шахматист');
    const bSeat = await seat(page, aClass, 'Второй шахматист');
    const schoolSeat = await seat(page, bClass, 'Соперник в школе');
    const foreignContext = await browser.newContext({ baseURL: origin });
    contexts.push(foreignContext);
    const foreignPage = await foreignContext.newPage();
    await loginWithOrganization(foreignPage, foreignTeacher);
    const cClass = await classroom(foreignPage, 'Шахматы — другая школа');
    const schools = await admin.query(
      'SELECT id,school_id,tenant_id FROM classrooms WHERE id=ANY($1::uuid[])',
      [[aClass.id, bClass.id, cClass.id]],
    );
    const lineage = new Map(schools.rows.map((row) => [row.id, row]));
    expect(lineage.get(aClass.id).school_id).toBe(lineage.get(bClass.id).school_id);
    expect(lineage.get(aClass.id).school_id).not.toBe(lineage.get(cClass.id).school_id);
    expect(lineage.get(aClass.id).tenant_id).not.toBe(lineage.get(cClass.id).tenant_id);
    const cSeat = await seat(foreignPage, cClass, 'Соперник другой школы');
    const a = await pupil(browser, origin, aClass, aSeat);
    contexts.push(a.context);
    const b = await pupil(browser, origin, aClass, bSeat);
    contexts.push(b.context);
    const school = await pupil(browser, origin, bClass, schoolSeat);
    contexts.push(school.context);
    const foreign = await pupil(browser, origin, cClass, cSeat);
    contexts.push(foreign.context);
    for (const learner of [a, b, school, foreign])
      learner.page.on('pageerror', (error) => errors.push(error.message));
    expect((await (await a.page.request.get('/api/games/chess/access')).json()).allowed).toBe(
      false,
    );
    const denied = await post(a.page.request, origin, 'invites', {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    expect(denied.status()).toBe(403);
    // Teacher enables network through the real settings UI, independently of offline access.
    await page.goto(`${origin}/#/classrooms/${aClass.id}`);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    const network = page.getByRole('group', { name: 'Сетевая игра в шахматы', exact: true });
    await network.getByLabel('Разрешить сетевую игру', { exact: true }).check();
    await network.getByLabel('Круг соперников', { exact: true }).selectOption('classroom');
    await network.getByRole('button', { name: 'Сохранить сетевой режим', exact: true }).click();
    await expect(network.getByRole('status')).toHaveText('Настройки сетевой игры сохранены.');
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        network.getByRole('button', { name: 'Сохранить сетевой режим', exact: true }),
      ).toBeVisible();
      const field = await network.boundingBox();
      expect(field!.width).toBeGreaterThan(150);
      expect(field!.x + field!.width).toBeLessThanOrEqual(width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${evidence}/teacher-network-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await openChessGame(a.page, 'Реальная сетевая партия — белые');
    await a.page.getByRole('button', { name: 'Онлайн', exact: true }).click();
    await openChessGame(b.page, 'Реальная сетевая партия — чёрные');
    await b.page.getByRole('button', { name: 'Онлайн', exact: true }).click();
    await a.page.getByLabel('Ваш цвет', { exact: true }).selectOption('white');
    await a.page.getByRole('button', { name: 'Создать приглашение', exact: true }).click();
    const code = (await a.page.getByLabel('Ваш код приглашения').innerText()).trim();
    await b.page.getByLabel('Код приглашения', { exact: true }).fill(code);
    await b.page.getByRole('button', { name: 'Принять приглашение', exact: true }).click();
    await expect(a.page.getByTestId('asa-chess-board')).toBeVisible();
    await a.page.locator('[data-square="e2"]').click();
    await a.page.locator('[data-square="e4"]').click();
    await expect(b.page.locator('[data-square="e4"]')).toHaveAttribute('data-piece', 'white-pawn');
    await b.page.locator('[data-square="e7"]').click();
    await b.page.locator('[data-square="e5"]').click();
    await expect(a.page.getByLabel('Ходы сетевой партии')).toContainText('e5');
    await b.page.reload();
    await expect(b.page.getByLabel('Ходы сетевой партии')).toContainText('e5');
    // Four geometries, all actual DOM consumers; no fake fetch/data interception.
    for (const width of [1440, 1024, 390, 320]) {
      await a.page.setViewportSize({ width, height: 900 });
      const layout = await a.page.getByTestId('asa-chess-board').boundingBox();
      expect(Math.abs(layout!.width - layout!.height)).toBeLessThan(1);
      expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await a.page.screenshot({ path: `${evidence}/two-players-${width}.png`, fullPage: true });
    }
    a.page.once('dialog', (dialog) => dialog.accept());
    await a.page.getByRole('button', { name: 'Сдаться', exact: true }).click();
    await expect(b.page.getByText('Результат сохранён.', { exact: true })).toBeVisible();
    const aHistory = await (await a.page.request.get('/api/games/chess/history')).json();
    const bHistory = await (await b.page.request.get('/api/games/chess/history')).json();
    expect(aHistory.matches[0]).toMatchObject({ status: 'finished', result: '0-1' });
    expect(bHistory.matches[0].id).toBe(aHistory.matches[0].id);
    expect(bHistory.matches[0].result).toBe('0-1');
    const input = {
      scope: 'classroom',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    };
    await policy(page, bClass.id, 'platform');
    await policy(foreignPage, cClass.id, 'platform');
    const classInvite = await (await post(a.page.request, origin, 'invites', input)).json();
    expect(
      (
        await post(school.page.request, origin, `invites/${classInvite.invite.code}/accept`, {})
      ).status(),
    ).toBe(403);
    await policy(page, aClass.id, 'school');
    const schoolInvite = await (
      await post(a.page.request, origin, 'invites', { ...input, scope: 'school' })
    ).json();
    const schoolMatch = await post(
      school.page.request,
      origin,
      `invites/${schoolInvite.invite.code}/accept`,
      {},
    );
    expect(schoolMatch.status()).toBe(201);
    const schoolGame = (await schoolMatch.json()).match;
    await post(a.page.request, origin, `matches/${schoolGame.id}/commands`, {
      expectedVersion: schoolGame.version,
      action: 'resign',
    });
    const platformInvite = await (
      await post(foreign.page.request, origin, 'invites', { ...input, scope: 'platform' })
    ).json();
    expect(
      (
        await post(a.page.request, origin, `invites/${platformInvite.invite.code}/accept`, {})
      ).status(),
    ).toBe(403);
    await policy(page, aClass.id, 'platform');
    const accepted = await post(
      a.page.request,
      origin,
      `invites/${platformInvite.invite.code}/accept`,
      {},
    );
    expect(accepted.status()).toBe(201);
    const crossTenant = (await accepted.json()).match;
    const firstMove = await post(
      foreign.page.request,
      origin,
      `matches/${crossTenant.id}/commands`,
      { expectedVersion: crossTenant.version, action: 'move', uci: 'e2e4' },
    );
    expect(firstMove.status()).toBe(201);
    const secondMove = await post(a.page.request, origin, `matches/${crossTenant.id}/commands`, {
      expectedVersion: (await firstMove.json()).match.version,
      action: 'move',
      uci: 'e7e5',
    });
    expect(secondMove.status()).toBe(201);
    // A POST is the FIRST request after teacher-off: abort must commit itself.
    await policy(page, aClass.id, 'platform', false);
    const stopped = await post(foreign.page.request, origin, `matches/${crossTenant.id}/commands`, {
      expectedVersion: (await secondMove.json()).match.version,
      action: 'resign',
    });
    expect(stopped.status()).toBe(201);
    expect((await stopped.json()).match).toMatchObject({
      status: 'aborted',
      result: '*',
      termination: 'security_abort',
    });
    const stored = await admin.query('SELECT status FROM games.chess_matches WHERE id=$1', [
      crossTenant.id,
    ]);
    expect(stored.rows[0].status).toBe('aborted');
    // Network OFF still leaves local board playable; games OFF removes an already mounted board.
    await a.page.goto(a.page.url().replace(/\/network$/, '/play/game'));
    await expect(a.page.getByTestId('asa-chess-board').locator('[data-square="e2"]')).toBeEnabled();
    // Offline teacher denial also revokes network, even when its separate setting is on.
    await policy(page, aClass.id, 'platform', true);
    const offline = await page.request.get(`/api/games/classrooms/${aClass.id}/policy`);
    const offlineDenied = await page.request.put(`/api/games/classrooms/${aClass.id}/policy`, {
      headers: { origin },
      data: { mode: 'deny', threshold: null, expectedVersion: (await offline.json()).version },
    });
    expect(offlineDenied.status()).toBe(200);
    expect((await (await a.page.request.get('/api/games/chess/access')).json()).allowed).toBe(
      false,
    );
    await expect(
      a.page.getByRole('heading', { name: 'Игры недоступны', exact: true }),
    ).toBeVisible();
    await expect(a.page.getByTestId('asa-chess-board')).toHaveCount(0);
    // Verified personal Account cannot escape through the retained legacy live endpoints.
    const teacherAccount = (
      await admin.query('SELECT account_id FROM legacy_user_account_links WHERE user_id=$1', [
        teacher.teacherId,
      ])
    ).rows[0].account_id;
    await admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      aSeat.id,
      teacherAccount,
    ]);
    const learner = (
      await admin.query(
        "SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1 AND link_kind='student_seat'",
        [aSeat.id],
      )
    ).rows[0].learner_identity_id;
    await admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
      [randomUUID(), teacher.tenantId, teacher.schoolId, learner, teacherAccount],
    );
    for (const [path, data] of [
      [
        'challenges',
        {
          colorPreference: 'white',
          initialMs: 600000,
          incrementMs: 0,
          rated: false,
          expiresInMs: 60000,
        },
      ],
      [
        'matchmaking',
        {
          colorPreference: 'white',
          initialMs: 600000,
          incrementMs: 0,
          rated: false,
          expiresInMs: 60000,
        },
      ],
      [`games/${crossTenant.id}/moves`, { expectedVersion: 1, uci: 'e2e4' }],
    ] as const) {
      const deniedLegacy = await page.request.post(`/api/chess/live/${path}`, {
        headers: { origin, 'idempotency-key': randomUUID() },
        data,
      });
      expect(deniedLegacy.status(), await deniedLegacy.text()).toBe(403);
    }
    expect((await (await page.request.get('/api/games/chess/access')).json()).allowed).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await admin?.end();
  }
});
