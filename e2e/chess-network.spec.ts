import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type Route,
} from '@playwright/test';
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

test('cold offline module and cached API lobby recover invitation and live game without forced reload', async ({
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
    // First entry has no network chunk cached. Stay on the loaded Chess shell offline,
    // then let the real online event load it and restore the durable invitation in place.
    await expect(
      page.getByText('Для загрузки сетевых шахмат нужно подключение.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Главная', exact: true })).toBeEnabled();
    await expect(page.getByTestId('asa-chess-board')).toHaveCount(0);
    await expect(page.getByText('Подключено', { exact: true })).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(page.getByLabel('Ваш код приглашения')).toHaveText(code);
    // The chunk is now cached: a second offline entry exercises the original API/history
    // bootstrap failure and explicit retry, separately from initial module loading.
    await page.getByRole('button', { name: 'Главная', exact: true }).click();
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
test('failed optional network chunk stays local until explicit user reload restores real invitation', async ({
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
  try {
    await loginWithOrganization(page, await seedTeacher(admin, 'chess-network-chunk-retry'));
    const created = await post(page.request, origin, 'invites', {
      scope: 'platform',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    expect(created.status(), await created.text()).toBe(201);
    const code = (await created.json()).invite.code;
    await openChessGame(page, 'Восстановление загрузки сетевых шахмат');
    const projectHash = await page.evaluate(() => location.hash.split('/').slice(0, 3).join('/'));
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.resourceType() === 'document')
        documentRequests.push(request.url());
    });
    // Fault injection is limited to one optional static JavaScript chunk; every API remains real.
    const optionalChunk = (url: URL) =>
      url.origin === origin && /^\/assets\/ChessNetworkLobby-[^/]+\.js$/.test(url.pathname);
    let failedChunks = 0;
    await page.route(
      optionalChunk,
      async (route) => {
        failedChunks++;
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Онлайн', exact: true }).click();
    await expect(
      page.getByText('Не удалось загрузить сетевые шахматы. Повторная загрузка обновит страницу.', {
        exact: true,
      }),
    ).toBeVisible();
    expect(failedChunks).toBe(1);
    expect(documentRequests).toEqual([]);
    expect(await page.evaluate(() => location.hash)).toBe(`${projectHash}/network`);
    await expect(page.getByRole('button', { name: 'Главная', exact: true })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Вернуться к играм', exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Онлайн-шахматы', exact: true })).toBeVisible();
    await page.unroute(optionalChunk);
    const reloaded = page.waitForEvent('domcontentloaded');
    await page
      .getByRole('button', { name: 'Повторить загрузку сетевых шахмат', exact: true })
      .click();
    await reloaded;
    await expect(page.getByLabel('Ваш код приглашения')).toHaveText(code);
    expect(documentRequests).toHaveLength(1);
    expect(await page.evaluate(() => location.hash)).toBe(`${projectHash}/network`);
  } finally {
    await admin.end();
  }
});

test('stalled optional network chunk reaches a finite local deadline and explicit reload recovers', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90000);
  if (
    process.env['CI'] !== 'true' ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']).pathname.endsWith('_test')
  )
    throw new Error('Isolated CI Chess network stack required');
  const admin = e2eAdminPool();
  const origin = new URL(baseURL!).origin;
  const optionalChunk = (url: URL) =>
    url.origin === origin && /^\/assets\/ChessNetworkLobby-[^/]+\.js$/.test(url.pathname);
  let heldRoute: Route | undefined;
  let releaseHeld: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  try {
    await loginWithOrganization(page, await seedTeacher(admin, 'chess-network-chunk-deadline'));
    const created = await post(page.request, origin, 'invites', {
      scope: 'platform',
      initialMs: 600000,
      incrementMs: 0,
      colorPreference: 'white',
    });
    expect(created.status(), await created.text()).toBe(201);
    const code = (await created.json()).invite.code;
    await openChessGame(page, 'Ограниченное ожидание сетевых шахмат');
    const projectHash = await page.evaluate(() => location.hash.split('/').slice(0, 3).join('/'));
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.resourceType() === 'document')
        documentRequests.push(request.url());
    });
    // Hold only the optional static module, not an API or the application's real data.
    await page.route(
      optionalChunk,
      async (route) => {
        heldRoute = route;
        await hold;
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Онлайн', exact: true }).click();
    await expect.poll(() => Boolean(heldRoute)).toBe(true);
    await expect(page.getByText('Загружаем сетевые шахматы…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Главная', exact: true })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Вернуться к играм', exact: true }),
    ).toBeEnabled();
    // The route's real deadline is 15 seconds: observe its outcome instead of sleeping.
    await expect(
      page.getByText('Не удалось загрузить сетевые шахматы. Повторная загрузка обновит страницу.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
    expect(documentRequests).toEqual([]);
    expect(await page.evaluate(() => location.hash)).toBe(`${projectHash}/network`);
    const lateFailure = page.waitForEvent('requestfailed', {
      predicate: (request) => optionalChunk(new URL(request.url())),
    });
    await heldRoute!.abort('failed');
    heldRoute = undefined;
    releaseHeld!();
    await lateFailure;
    await page.unroute(optionalChunk);
    const retry = page.getByRole('button', {
      name: 'Повторить загрузку сетевых шахмат',
      exact: true,
    });
    await expect(retry).toBeEnabled();
    expect(documentRequests).toEqual([]);
    const reloaded = page.waitForEvent('domcontentloaded');
    await retry.click();
    await reloaded;
    await expect(page.getByLabel('Ваш код приглашения')).toHaveText(code);
    expect(documentRequests).toHaveLength(1);
    expect(await page.evaluate(() => location.hash)).toBe(`${projectHash}/network`);
  } finally {
    await heldRoute?.abort('failed').catch(() => undefined);
    releaseHeld?.();
    await page.unroute(optionalChunk);
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

// These games start from the normal initial position and finish through actual touch/click
// moves. Requests below only observe persistence or attempt forbidden commands; none seed a FEN.
test('two pupils finish white and black checkmates with personal outcomes on desktop and touch', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(240000);
  if (
    process.env['CI'] !== 'true' ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']).pathname.endsWith('_test')
  )
    throw new Error('Isolated CI Chess network stack required');
  const origin = new URL(baseURL!).origin;
  const admin = e2eAdminPool();
  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
  const errors: string[] = [];
  mkdirSync(evidence, { recursive: true });
  try {
    await loginWithOrganization(page, await seedTeacher(admin, 'chess-mate-outcomes'));
    const fixture = await classroom(page, 'Мат и результат двух учеников');
    await policy(page, fixture.id, 'classroom');
    const white = await pupil(browser, origin, fixture, await seat(page, fixture, 'Белые'), true);
    contexts.push(white.context);
    const black = await pupil(browser, origin, fixture, await seat(page, fixture, 'Чёрные'), true);
    contexts.push(black.context);
    for (const learner of [white, black]) {
      learner.page.on('pageerror', (error) => errors.push(error.message));
      await learner.page.setViewportSize({ width: 390, height: 900 });
      await openChessGame(learner.page, 'Партия до мата');
      await learner.page.getByRole('button', { name: 'Онлайн', exact: true }).click();
    }
    async function readMatch(view: Page, id: string) {
      const response = await view.request.get(`/api/games/chess/matches/${id}`);
      expect(response.status(), await response.text()).toBe(200);
      return (await response.json()).match;
    }
    async function start() {
      await white.page.getByLabel('Ваш цвет', { exact: true }).selectOption('white');
      await white.page.getByRole('button', { name: 'Создать приглашение', exact: true }).tap();
      const code = (await white.page.getByLabel('Ваш код приглашения').innerText()).trim();
      await black.page.getByLabel('Код приглашения', { exact: true }).fill(code);
      await black.page.getByRole('button', { name: 'Принять приглашение', exact: true }).tap();
      for (const learner of [white, black])
        await expect(learner.page.getByTestId('asa-chess-board')).toBeVisible();
      const history = await (await white.page.request.get('/api/games/chess/history')).json();
      const active = history.matches.find((match: { status: string }) => match.status === 'active');
      expect(active).toBeTruthy();
      return active.id as string;
    }
    async function move(view: Page, other: Page, id: string, uci: string, ply: number) {
      const sent = view.waitForResponse(
        (response) =>
          response.url().endsWith(`/matches/${id}/commands`) &&
          response.request().method() === 'POST',
      );
      await view.locator(`[data-square="${uci.slice(0, 2)}"]`).tap();
      await view.locator(`[data-square="${uci.slice(2, 4)}"]`).tap();
      const response = await sent;
      expect(response.status(), await response.text()).toBe(201);
      const match = (await response.json()).match;
      expect(match.moves).toHaveLength(ply);
      expect(match.moves.at(-1).uci).toBe(uci);
      if (match.status === 'finished' && match.result === '1-0') {
        // Observe the short live effect before waiting for the opponent polling cycle.
        await expect(view.locator('[data-victory-effect="active"]')).toHaveCount(1);
        await view.screenshot({
          path: `${evidence}/live-white-victory-touch-390.png`,
          fullPage: true,
        });
      }
      await expect.poll(async () => (await readMatch(other, id)).moves.length).toBe(ply);
      await expect(other.getByLabel('Ходы сетевой партии')).toContainText(match.moves.at(-1).san);
      return match;
    }
    async function forbidden(
      view: Page,
      id: string,
      expectedVersion: number,
      uci: string,
      finished = false,
    ) {
      const response = await post(view.request, origin, `matches/${id}/commands`, {
        expectedVersion,
        action: 'move',
        uci,
      });
      expect(response.status(), await response.text()).toBe(finished ? 409 : 422);
      expect((await response.json()).error.code).toBe(
        finished ? 'MATCH_FINISHED' : 'GAME_COMMAND_REJECTED',
      );
      expect((await readMatch(view, id)).version).toBe(expectedVersion);
    }
    const whiteWinId = await start();
    const initial = await readMatch(white.page, whiteWinId);
    // Both a wrong-turn move and an impossible king leap are rejected by the real server.
    await forbidden(black.page, whiteWinId, initial.version, 'e7e5');
    await forbidden(white.page, whiteWinId, initial.version, 'e1e3');
    await expect(black.page.locator('[data-square="e7"]')).toBeDisabled();
    await white.page.locator('[data-square="e1"]').tap();
    await white.page.locator('[data-square="e3"]').tap();
    expect((await readMatch(white.page, whiteWinId)).moves).toHaveLength(0);
    const scholar = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
    for (const [index, uci] of scholar.entries()) {
      const active = index % 2 === 0 ? white.page : black.page;
      const observer = index % 2 === 0 ? black.page : white.page;
      await move(active, observer, whiteWinId, uci, index + 1);
    }
    await expect(white.page.locator('[data-outcome="win"]')).toContainText('Вы победили');
    await expect(black.page.locator('[data-outcome="loss"]')).toContainText('Вы проиграли');
    await expect(black.page.locator('[data-victory-effect="active"]')).toHaveCount(0);

    async function finished(id: string, result: string, winner: Page, loser: Page, prefix: string) {
      const clockLabels = ['Время белых', 'Время чёрных'];
      const frozenClocks = await Promise.all(
        [white, black].map(async (learner) =>
          Promise.all(
            clockLabels.map((label) => learner.page.getByLabel(label, { exact: true }).innerText()),
          ),
        ),
      );
      const a = await readMatch(white.page, id);
      const b = await readMatch(black.page, id);
      expect(a).toMatchObject({ status: 'finished', result, termination: 'checkmate' });
      expect(b.currentFen).toBe(a.currentFen);
      expect(b.moves).toEqual(a.moves);
      expect(b.result).toBe(a.result);
      expect(a.currentFen).toContain(result === '1-0' ? ' b ' : ' w ');
      const frozen = {
        currentFen: a.currentFen,
        result: a.result,
        version: a.version,
        moves: a.moves,
      };
      for (const learner of [white, black]) {
        await expect(
          learner.page.getByRole('dialog', {
            name: 'Выберите фигуру для превращения',
            exact: true,
          }),
        ).toHaveCount(0);
        const terminalKing = learner.page.locator('[data-square="e1"]');
        await expect(terminalKing).toBeDisabled();
        const kingGlyph = terminalKing.locator('.asa-chess-piece-glyph');
        await learner.page.mouse.move(0, 0);
        const idleTransform = await kingGlyph.evaluate(
          (element) => getComputedStyle(element).transform,
        );
        await terminalKing.hover();
        const hoverTransform = await kingGlyph.evaluate(async (element) => {
          // Two animation frames expose the old 100ms hover transition without a timed sleep.
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return getComputedStyle(element).transform;
        });
        expect(hoverTransform).toBe(idleTransform);
        await learner.page.mouse.move(0, 0);
        await expect(
          learner.page.getByRole('button', { name: 'Сдаться', exact: true }),
        ).toBeDisabled();
        await expect(
          learner.page.getByRole('button', { name: 'Предложить ничью', exact: true }),
        ).toBeDisabled();
        await forbidden(learner.page, id, a.version, 'e2e4', true);
        expect(await readMatch(learner.page, id)).toMatchObject(frozen);
      }
      for (const width of [1440, 1024, 390, 320]) {
        for (const [view, outcome] of [
          [winner, 'win'],
          [loser, 'loss'],
        ] as const) {
          await view.setViewportSize({ width, height: 900 });
          const board = await view.getByTestId('asa-chess-board').boundingBox();
          expect(board).not.toBeNull();
          expect(Math.abs(board!.width - board!.height)).toBeLessThan(1);
          expect(board!.x).toBeGreaterThanOrEqual(0);
          expect(board!.x + board!.width).toBeLessThanOrEqual(width + 1);
          expect(
            await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await expect(view.locator(`[data-outcome="${outcome}"]`)).toBeVisible();
          const back = view.getByRole('button', { name: 'К приглашениям', exact: true });
          await back.scrollIntoViewIfNeeded();
          await expect(back).toBeVisible();
          const bounds = await back.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
          await view.screenshot({
            path: `${evidence}/${prefix}-${outcome}-${width}.png`,
            fullPage: true,
          });
        }
      }
      // Real requests and sixteen layout/screenshot checks have elapsed; neither terminal clock ticks.
      for (const [index, learner] of [white, black].entries())
        for (const [clock, label] of clockLabels.entries())
          await expect(learner.page.getByLabel(label, { exact: true })).toHaveText(
            frozenClocks[index][clock],
          );
      // Replay and reload are durable views, never a second victory celebration/result insertion.
      for (const learner of [white, black]) {
        const historyBefore = await (
          await learner.page.request.get('/api/games/chess/history')
        ).json();
        expect(
          historyBefore.matches.filter((match: { id: string }) => match.id === id),
        ).toHaveLength(1);
        expect(
          historyBefore.matches.find((match: { id: string }) => match.id === id),
        ).toMatchObject(frozen);
        await learner.page.getByRole('button', { name: 'К приглашениям', exact: true }).tap();
        await learner.page.locator(`button[data-match-id="${id}"]`).tap();
        await expect(learner.page.locator('[data-outcome]')).toContainText(
          learner.page === winner ? 'Вы победили' : 'Вы проиграли',
        );
        await expect(learner.page.locator('[data-victory-effect="active"]')).toHaveCount(0);
        await learner.page.reload();
        await expect(
          learner.page.getByRole('heading', { name: 'Мои сетевые партии', exact: true }),
        ).toBeVisible();
        await learner.page.locator(`button[data-match-id="${id}"]`).tap();
        await expect(learner.page.locator('[data-outcome]')).toContainText(
          learner.page === winner ? 'Вы победили' : 'Вы проиграли',
        );
        await expect(learner.page.locator('[data-victory-effect="active"]')).toHaveCount(0);
        expect(await readMatch(learner.page, id)).toMatchObject(frozen);
        const historyAfter = await (
          await learner.page.request.get('/api/games/chess/history')
        ).json();
        expect(
          historyAfter.matches.filter((match: { id: string }) => match.id === id),
        ).toHaveLength(1);
        await learner.page.getByRole('button', { name: 'К приглашениям', exact: true }).tap();
      }
    }
    await finished(whiteWinId, '1-0', white.page, black.page, 'scholar-mate');
    // A second game reverses the winner; reduced-motion users still receive the full result.
    for (const learner of [white, black]) {
      await learner.page.emulateMedia({ reducedMotion: 'reduce' });
      await learner.page.setViewportSize({ width: 390, height: 900 });
    }
    const blackWinId = await start();
    const fool = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
    for (const [index, uci] of fool.entries())
      await move(
        index % 2 === 0 ? white.page : black.page,
        index % 2 === 0 ? black.page : white.page,
        blackWinId,
        uci,
        index + 1,
      );
    await expect(black.page.locator('[data-outcome="win"]')).toContainText('Вы победили');
    await expect(white.page.locator('[data-outcome="loss"]')).toContainText('Вы проиграли');
    for (const learner of [white, black])
      await expect(learner.page.locator('[data-victory-effect="active"]')).toHaveCount(0);
    await finished(blackWinId, '0-1', black.page, white.page, 'fool-mate-reduced-motion');
    // Both already mounted clients must observe policy revocation as an abort, never a victory.
    const abortedId = await start();
    await move(white.page, black.page, abortedId, 'e2e4', 1);
    await policy(page, fixture.id, 'classroom', false);
    for (const learner of [white, black]) {
      await expect(learner.page.locator('[data-outcome="aborted"]')).toContainText(
        'Партия остановлена',
      );
      await expect(
        learner.page.getByText('Доступ или круг соперников изменился. Результат не засчитан.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(learner.page.locator('[data-victory-effect="active"]')).toHaveCount(0);
      await expect(learner.page.getByText('Вы победили', { exact: true })).toHaveCount(0);
      await expect(learner.page.getByText('Вы проиграли', { exact: true })).toHaveCount(0);
      await expect(learner.page.locator('[data-square="e7"]')).toBeDisabled();
      const stopped = await readMatch(learner.page, abortedId);
      expect(stopped).toMatchObject({
        status: 'aborted',
        result: '*',
        termination: 'security_abort',
      });
    }
    expect((await readMatch(white.page, abortedId)).currentFen).toBe(
      (await readMatch(black.page, abortedId)).currentFen,
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await admin.end();
  }
});
