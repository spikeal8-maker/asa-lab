import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import { openCheckersGame } from './open-checkers-game';
const evidence = 'e2e/artifacts/checkers/network';
interface ClassFixture {
  id: string;
  code: string;
}
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
async function pupil(
  browser: Browser,
  origin: string,
  fixture: ClassFixture,
  issued: IssuedSeat,
  touch = false,
) {
  const context = await browser.newContext({ baseURL: origin, hasTouch: touch });
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
  const read = await page.request.get(`/api/games/checkers/policy/${id}`);
  expect(read.status()).toBe(200);
  const response = await page.request.put(`/api/games/checkers/policy/${id}`, {
    headers: { origin: new URL(page.url()).origin, 'idempotency-key': randomUUID() },
    data: { enabled, scope, expectedVersion: (await read.json()).version },
  });
  expect(response.status(), await response.text()).toBe(200);
}
async function post(request: APIRequestContext, origin: string, path: string, data: unknown) {
  return request.post(`/api/games/checkers/${path}`, {
    headers: { origin, 'idempotency-key': randomUUID() },
    data,
  });
}

test('real two-pupil Checkers, teacher controls, reconnect/history and all opponent scopes', async ({
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
    throw new Error('Isolated CI Checkers network stack required');
  let admin: pg.Pool | undefined;
  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  mkdirSync(evidence, { recursive: true });
  try {
    admin = e2eAdminPool();
    const teacher = await seedTeacher(admin, 'checkers-network-a');
    const foreignTeacher = await seedTeacher(admin, 'checkers-network-b');
    expect(teacher.tenantId).not.toBe(foreignTeacher.tenantId);
    await loginWithOrganization(page, teacher);
    const aClass = await classroom(page, 'Шашки — первый класс');
    const bClass = await classroom(page, 'Шашки — второй класс');
    const aSeat = await seat(page, aClass, 'Первый игрок в шашки');
    const bSeat = await seat(page, aClass, 'Второй игрок в шашки');
    const schoolSeat = await seat(page, bClass, 'Соперник в школе');
    const foreignContext = await browser.newContext({ baseURL: origin });
    contexts.push(foreignContext);
    const foreignPage = await foreignContext.newPage();
    await loginWithOrganization(foreignPage, foreignTeacher);
    const cClass = await classroom(foreignPage, 'Шашки — другая школа');
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
    expect((await (await a.page.request.get('/api/games/checkers/access')).json()).allowed).toBe(
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
    const network = page.getByRole('group', {
      name: 'Сетевая игра в шахматы и шашки',
      exact: true,
    });
    await network.getByLabel('Разрешить сетевую игру', { exact: true }).check();
    await network.getByLabel('Круг соперников', { exact: true }).selectOption('classroom');
    await network.getByRole('button', { name: 'Сохранить сетевой режим', exact: true }).click();
    const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
    await expect(ribbon).toHaveCount(1);
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toContainText('Настройки сетевой игры сохранены.');
    const announcement = page.locator('.system-feedback-announcement[role="status"]');
    await expect(announcement).toHaveCount(1);
    await expect(announcement).toContainText('Настройки сетевой игры сохранены.');
    const inlineSuccess = network.getByText('Настройки сетевой игры сохранены.', { exact: true });
    await expect(inlineSuccess).toHaveCount(0);
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
    await openCheckersGame(a.page, 'Реальная сетевая партия — белые');
    await a.page.getByRole('button', { name: 'Играть с человеком', exact: true }).click();
    await openCheckersGame(b.page, 'Реальная сетевая партия — чёрные');
    await b.page.getByRole('button', { name: 'Играть с человеком', exact: true }).click();
    await a.page.getByLabel('Ваш цвет', { exact: true }).selectOption('white');
    const avatarSaved = await b.page.request.put('/api/class-join/me/avatar', {
      headers: { origin },
      data: { avatarKey: 'asa-avatar-07' },
    });
    expect(avatarSaved.ok(), await avatarSaved.text()).toBe(true);
    const bPlayer = (await (await b.page.request.get('/api/games/checkers/access')).json()).player;
    const peer = a.page.locator(`[data-player-id="${bPlayer.playerId}"]`);
    await expect(peer.locator('img')).toBeVisible({ timeout: 15000 });
    const currentLobby = await (
      await post(a.page.request, origin, 'lobby', { scope: 'classroom' })
    ).json();
    const expectedAvatar = currentLobby.players.find(
      (p: { playerId: string }) => p.playerId === bPlayer.playerId,
    ).avatarUrl;
    await expect(peer.locator('img')).toHaveAttribute('src', expectedAvatar, { timeout: 15000 });

    await expect(
      peer.getByRole('button', { name: 'Пригласить играть', exact: true }),
    ).toBeEnabled();
    await expect(peer.locator('img')).toHaveAttribute(
      'src',
      new RegExp(`/players/${bPlayer.playerId}/avatar`),
    );
    await expect
      .poll(() =>
        peer
          .locator('img')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    const avatar = await a.page.request.get(
      `/api/games/checkers/players/${bPlayer.playerId}/avatar?scope=classroom`,
      { maxRedirects: 0 },
    );
    expect(avatar.status()).toBe(302);
    expect(avatar.headers()['location']).toBe('/assets/avatars/default/avatar-07.webp');
    for (const width of [1440, 1024, 390, 320]) {
      await a.page.setViewportSize({ width, height: 900 });
      expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await a.page.screenshot({
        path: `${evidence}/class-lobby-avatars-${width}.png`,
        fullPage: true,
      });
    }
    await a.page.setViewportSize({ width: 1440, height: 900 });
    // Recipient can be elsewhere on the portal; the common header owns delivery.
    await b.page.goto(`${origin}/#/games`);
    await peer.getByRole('button', { name: 'Пригласить играть', exact: true }).click();
    const invitedGame = b.page.getByRole('button', {
      name: 'Посмотреть приглашения: Шашки',
      exact: true,
    });
    await expect(invitedGame).toContainText('Вас приглашают играть', { timeout: 15000 });
    await expect(
      b.page.getByRole('link', { name: 'Игры', exact: true }).locator('.game-invitation-badge'),
    ).toHaveText('1');
    await invitedGame.click();

    const received = b.page.getByRole('region', { name: 'Входящие вызовы' });
    await expect(received.locator('img')).toBeVisible({ timeout: 15000 });
    await received.getByRole('button', { name: 'Принять вызов', exact: true }).click();
    await expect(
      a.page.getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' }),
    ).toBeVisible();
    await a.page.locator('[data-square="a3"]').click();
    await a.page.locator('[data-square="b4"]').click();
    await expect(b.page.locator('[data-piece-square="b4"]')).toBeVisible();
    await b.page.locator('[data-square="b6"]').click();
    await b.page.locator('[data-square="a5"]').click();
    await expect(a.page.getByLabel('Ходы сетевой партии')).toContainText('a5');
    await b.page.reload();
    await expect(b.page.getByLabel('Ходы сетевой партии')).toContainText('a5');
    // Four geometries, all actual DOM consumers; no fake fetch/data interception.
    for (const width of [1440, 1024, 390, 320]) {
      await a.page.setViewportSize({ width, height: 900 });
      const layout = await a.page
        .getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' })
        .boundingBox();
      expect(Math.abs(layout!.width - layout!.height)).toBeLessThan(1);
      expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await a.page.screenshot({ path: `${evidence}/two-players-${width}.png`, fullPage: true });
    }
    a.page.once('dialog', (dialog) => dialog.accept());
    await a.page.getByRole('button', { name: 'Сдаться', exact: true }).click();
    await expect(b.page.getByText('Результат сохранён.', { exact: true })).toBeVisible();
    const aHistory = await (await a.page.request.get('/api/games/checkers/history')).json();
    const bHistory = await (await b.page.request.get('/api/games/checkers/history')).json();
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
      { expectedVersion: crossTenant.version, action: 'move', path: ['a3', 'b4'] },
    );
    expect(firstMove.status()).toBe(201);
    const secondMove = await post(a.page.request, origin, `matches/${crossTenant.id}/commands`, {
      expectedVersion: (await firstMove.json()).match.version,
      action: 'move',
      path: ['b6', 'a5'],
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
    const stored = await admin.query('SELECT status FROM games.checkers_matches WHERE id=$1', [
      crossTenant.id,
    ]);
    expect(stored.rows[0].status).toBe('aborted');
    expect((await post(a.page.request, origin, 'lobby', { scope: 'classroom' })).status()).toBe(
      403,
    );
    expect(
      (
        await a.page.request.get(
          `/api/games/checkers/players/${bPlayer.playerId}/avatar?scope=classroom`,
        )
      ).status(),
    ).toBe(403);
    // Network OFF still leaves local board playable; games OFF removes an already mounted board.
    await a.page.goto(a.page.url().replace(/\/network$/, '/local'));
    await a.page.getByRole('button', { name: 'Начать локальную партию', exact: true }).click();
    await expect(
      a.page
        .getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' })
        .locator('[data-square="a3"]'),
    ).toBeEnabled();
    // Offline teacher denial also revokes network, even when its separate setting is on.
    await policy(page, aClass.id, 'platform', true);
    const offline = await page.request.get(`/api/games/classrooms/${aClass.id}/policy`);
    const offlineDenied = await page.request.put(`/api/games/classrooms/${aClass.id}/policy`, {
      headers: { origin },
      data: { mode: 'deny', threshold: null, expectedVersion: (await offline.json()).version },
    });
    expect(offlineDenied.status()).toBe(200);
    expect((await (await a.page.request.get('/api/games/checkers/access')).json()).allowed).toBe(
      false,
    );
    await expect(
      a.page.getByRole('heading', { name: 'Игры недоступны', exact: true }),
    ).toBeVisible();
    await expect(a.page.getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' })).toHaveCount(
      0,
    );
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
      ['challenges', { opponentUserId: randomUUID() }],
      [`games/${crossTenant.id}/accept`, {}],
      [`games/${crossTenant.id}/moves`, { expectedVersion: 1, path: ['a3', 'b4'] }],
    ] as const) {
      const deniedLegacy = await page.request.post(
        `/api/checkers/projects/${randomUUID()}/${path}`,
        {
          headers: { origin, 'idempotency-key': randomUUID() },
          data,
        },
      );
      expect(deniedLegacy.status(), await deniedLegacy.text()).toBe(403);
    }
    expect((await (await page.request.get('/api/games/checkers/access')).json()).allowed).toBe(
      false,
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await admin?.end();
  }
});

test('two real pupils finish normal Checkers games for both sides with honest responsive outcomes', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(300000);
  if (
    process.env['CI'] !== 'true' ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']).pathname.endsWith('_test')
  )
    throw Error('Isolated Checkers CI required');
  const { chooseCheckersBotMove, validateCheckersDocument } =
    await import('../contexts/checkers/dist/index.js');
  const admin = e2eAdminPool();
  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
  const origin = new URL(baseURL!).origin;
  mkdirSync(evidence, { recursive: true });
  try {
    const teacher = await seedTeacher(admin, 'checkers-completed');
    await loginWithOrganization(page, teacher);
    const cls = await classroom(page, 'Завершённые партии в шашки');
    await policy(page, cls.id, 'classroom');
    const a = await pupil(browser, origin, cls, await seat(page, cls, 'Светлые'));
    const b = await pupil(browser, origin, cls, await seat(page, cls, 'Тёмные'), true);
    contexts.push(a.context, b.context);
    await openCheckersGame(a.page, 'Светлые — полная партия');
    await openCheckersGame(b.page, 'Тёмные — полная партия');
    await a.page.getByRole('button', { name: 'Играть с человеком', exact: true }).click();
    await b.page.getByRole('button', { name: 'Играть с человеком', exact: true }).click();
    for (const strongSide of ['light', 'dark'] as const) {
      if (strongSide === 'dark') {
        for (const actor of [a, b])
          await actor.page.getByRole('button', { name: 'К приглашениям', exact: true }).click();
      }
      await a.page.getByLabel('Ваш цвет', { exact: true }).selectOption('white');
      await a.page.getByRole('button', { name: 'Создать приглашение', exact: true }).click();
      const code = (await a.page.getByLabel('Ваш код приглашения').innerText()).trim();
      await b.page.getByLabel('Код приглашения', { exact: true }).fill(code);
      const acceptance = b.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/invites/${code}/accept`) &&
          response.request().method() === 'POST',
      );
      await b.page.getByRole('button', { name: 'Принять приглашение', exact: true }).tap();
      const accepted = await acceptance;
      expect(accepted.status(), await accepted.text()).toBe(201);
      let match = (await accepted.json()).match;
      for (const actor of [a, b])
        await expect(
          actor.page.getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' }),
        ).toBeVisible();
      // No custom position or database edits: every move goes through a real board and server.
      for (let ply = 0; ply < 160 && match.status === 'active'; ply++) {
        const parsed = validateCheckersDocument(match.position);
        if (!parsed.ok) throw Error(parsed.message);
        const position = parsed.value;
        const decision = chooseCheckersBotMove(
          position,
          position.sideToMove === strongSide ? 'master' : 'iskra',
          { seed: 3 + ply, maxDepth: 2, maxNodes: 600, maxTimeMs: 1000 },
        );
        if (!decision.ok) throw Error(decision.message);
        const path = decision.value.move.path;
        const actor = position.sideToMove === 'light' ? a.page : b.page;
        const observer = position.sideToMove === 'light' ? b.page : a.page;
        await expect(actor.locator('[data-square="' + path[0] + '"]')).toBeEnabled();
        const response = actor.waitForResponse(
          (r) =>
            r.url().endsWith(`/matches/${match.id}/commands`) && r.request().method() === 'POST',
        );
        for (const square of [path[0], path.at(-1)]) {
          const cell = actor.locator('[data-square="' + square + '"]');
          if (actor === b.page) await cell.tap();
          else await cell.click();
        }
        const choices = actor.getByRole('dialog', { name: 'Выберите путь взятия' });
        if (await choices.isVisible())
          await choices.getByRole('button', { name: path.join(' × '), exact: true }).click();
        const committed = await response;
        expect(committed.status(), await committed.text()).toBe(201);
        match = (await committed.json()).match;
        await expect(observer.getByLabel('Ходы сетевой партии').locator('li')).toHaveCount(
          Math.ceil((ply + 1) / 2),
        );
      }
      expect(match.status).toBe('finished');
      expect(match.result).toBe(strongSide === 'light' ? '1-0' : '0-1');
      expect(['no-pieces', 'no-legal-moves']).toContain(match.termination);
      const winner = strongSide === 'light' ? a.page : b.page;
      const loser = strongSide === 'light' ? b.page : a.page;
      await expect(winner.locator('[data-outcome="win"]')).toContainText('Вы победили');
      await expect(loser.locator('[data-outcome="loss"]')).toContainText('Вы проиграли');
      await expect(loser.locator('[data-victory-effect="active"]')).toHaveCount(0);
      for (const width of [1440, 1024, 390, 320]) {
        for (const [view, outcome] of [
          [winner, 'win'],
          [loser, 'loss'],
        ] as const) {
          await view.setViewportSize({ width, height: 900 });
          const board = await view
            .getByRole('grid', { name: 'Доска для русских шашек, 8 на 8' })
            .boundingBox();
          expect(Math.abs(board!.width - board!.height)).toBeLessThan(1);
          expect(
            await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(view.getByRole('button', { name: 'Сдаться', exact: true })).toBeDisabled();
          await view.screenshot({
            path: `${evidence}/${strongSide}-${outcome}-${width}.png`,
            fullPage: true,
          });
        }
      }
      const illegal = await post(a.page.request, origin, `matches/${match.id}/commands`, {
        expectedVersion: match.version,
        action: 'move',
        path: ['a3', 'b4'],
      });
      expect(illegal.status()).toBe(409);
      await winner.emulateMedia({ reducedMotion: 'reduce' });
      await winner.reload();
      await expect(
        winner.getByRole('heading', { name: 'Мои сетевые партии', exact: true }),
      ).toBeVisible();
      await winner.locator(`button[data-match-id="${match.id}"]`).click();
      await expect(winner.locator('[data-outcome="win"]')).toBeVisible();
      await expect(winner.locator('[data-victory-effect="active"]')).toHaveCount(0);
      const history = await (await loser.request.get('/api/games/checkers/history')).json();
      expect(history.matches.find((item: { id: string }) => item.id === match.id)).toMatchObject({
        status: 'finished',
        result: match.result,
      });
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await admin.end();
  }
});
