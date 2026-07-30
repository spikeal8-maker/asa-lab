import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedLegacyTeacherIdentity, seedTeacher, type SeededTeacher } from './seed';

interface LivePlayerCredentials {
  readonly workspace: string;
  readonly email: string;
  readonly password: string;
  readonly userId: string;
}

let admin: pg.Pool;
let first: SeededTeacher;
let second: LivePlayerCredentials;

async function seedSecondPlayer(): Promise<LivePlayerCredentials> {
  const email = `teacher-chess-live-second-${Date.now()}@test.local`;
  const inserted = await admin.query(
    `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
     SELECT tenant_id, school_id, 'teacher', $1, 'Педагог Соперник', password_hash
       FROM users
      WHERE id = $2
     RETURNING id, password_hash`,
    [email, first.teacherId],
  );
  const workspace = await admin.query(
    `SELECT wm.workspace_id
       FROM legacy_user_account_links l
       JOIN workspace_memberships wm ON wm.account_id = l.account_id
      WHERE l.tenant_id = $1 AND l.user_id = $2
      LIMIT 1`,
    [first.tenantId, first.teacherId],
  );
  await seedLegacyTeacherIdentity(admin, {
    tenantId: first.tenantId,
    userId: inserted.rows[0].id as string,
    email,
    passwordHash: inserted.rows[0].password_hash as string,
    displayName: 'Педагог Соперник',
    workspaceId: workspace.rows[0].workspace_id as string,
  });
  return {
    workspace: first.workspace,
    email,
    password: first.password,
    userId: inserted.rows[0].id as string,
  };
}

async function login(page: Page, credentials: LivePlayerCredentials): Promise<void> {
  await loginWithOrganization(page, credentials);
}

async function createChessProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByLabel('Название проекта').fill(title);
  const tile = page.locator('.module-tile').filter({ hasText: 'ASA Chess' });
  await tile.click();
  await expect(tile.getByRole('radio')).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть онлайн-шахматы' }).click();
  await expect(page.getByRole('heading', { name: 'Вызовы и поиск соперника' })).toBeVisible();
}

async function clickMove(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

async function pages(browser: Browser): Promise<{
  firstPage: Page;
  secondPage: Page;
  close(): Promise<void>;
}> {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  return {
    firstPage: await firstContext.newPage(),
    secondPage: await secondContext.newPage(),
    close: async () => {
      await firstContext.close();
      await secondContext.close();
    },
  };
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  first = await seedTeacher(admin, 'e2e-chess-live');
  second = await seedSecondPlayer();
});

test.afterAll(async () => {
  await admin.end();
});

test('two teachers create and play one server-authoritative direct challenge', async ({
  browser,
}) => {
  const session = await pages(browser);
  const firstFailures = collectBrowserFailures(session.firstPage, {
    allowAnonymousSessionProbe: true,
  });
  const secondFailures = collectBrowserFailures(session.secondPage, {
    allowAnonymousSessionProbe: true,
  });
  try {
    await login(session.firstPage, {
      workspace: first.workspace,
      email: first.email,
      password: first.password,
      userId: first.teacherId,
    });
    await login(session.secondPage, second);
    await createChessProject(session.firstPage, 'Онлайн — белые');
    await createChessProject(session.secondPage, 'Онлайн — чёрные');

    await session.firstPage.getByRole('button', { name: 'Белые' }).click();
    await session.firstPage.getByRole('button', { name: '3+2' }).click();
    await session.firstPage.getByRole('button', { name: 'Создать код вызова' }).click();
    const code = (await session.firstPage.locator('.asa-online-share-code').textContent())?.trim();
    expect(code).toMatch(/^[A-Z0-9]{8,16}$/);

    await session.secondPage.getByLabel('Код соперника').fill(code!);
    const acceptResponsePromise = session.secondPage.waitForResponse(
      (response) =>
        response.url().includes('/api/chess/live/challenges/') &&
        response.url().endsWith('/accept'),
    );
    await session.secondPage.getByRole('button', { name: 'Принять вызов' }).click();
    const acceptedResponse = await acceptResponsePromise;
    expect(acceptedResponse.ok()).toBe(true);
    const accepted = (await acceptedResponse.json()) as {
      game: { gameId: string; whitePlayerId: string; blackPlayerId: string; version: number };
    };
    expect(accepted.game).toMatchObject({
      whitePlayerId: first.teacherId,
      blackPlayerId: second.userId,
      version: 1,
    });

    await expect(
      session.secondPage.getByRole('heading', { name: 'Товарищеская партия' }),
    ).toBeVisible();
    await expect(
      session.firstPage.getByRole('heading', { name: 'Товарищеская партия' }),
    ).toBeVisible({
      timeout: 8_000,
    });

    await clickMove(session.firstPage, 'e2', 'e4');
    await expect(session.firstPage.getByLabel('Ходы онлайн-партии')).toContainText('e4');
    await expect(session.secondPage.getByLabel('Ходы онлайн-партии')).toContainText('e4', {
      timeout: 5_000,
    });
    await clickMove(session.secondPage, 'e7', 'e5');
    await expect(session.firstPage.getByLabel('Ходы онлайн-партии')).toContainText('e5', {
      timeout: 5_000,
    });
    await clickMove(session.firstPage, 'g1', 'f3');
    await expect(session.secondPage.getByLabel('Ходы онлайн-партии')).toContainText('Nf3', {
      timeout: 5_000,
    });

    const reconnect = await session.firstPage.request.get(
      `/api/chess/live/games/${encodeURIComponent(accepted.game.gameId)}/reconnect?after=2`,
    );
    expect(reconnect.ok()).toBe(true);
    const envelope = (await reconnect.json()) as {
      snapshot: { version: number; sequence: number; moves: Array<{ uci: string }> };
      events: Array<{ sequence: number; type: string }>;
    };
    expect(envelope.snapshot.moves.map((move) => move.uci)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(envelope.snapshot.version).toBe(4);
    expect(envelope.events.map((event) => event.type)).toEqual([
      'move_played',
      'move_played',
      'move_played',
    ]);

    const forged = await session.firstPage.request.post(
      `/api/chess/live/games/${encodeURIComponent(accepted.game.gameId)}/moves`,
      {
        headers: {
          origin: 'http://web:8080',
          'idempotency-key': `forged:${Date.now()}`,
        },
        data: {
          expectedVersion: envelope.snapshot.version,
          uci: 'f1b5',
          tenantId: 'tenant:foreign',
          userId: second.userId,
          result: '1-0',
          currentFen: 'forged',
          clock: { whiteRemainingMs: 999999999 },
        },
      },
    );
    expect(forged.status()).toBe(400);

    mkdirSync('e2e/artifacts', { recursive: true });
    await session.firstPage.setViewportSize({ width: 1366, height: 768 });
    await session.firstPage.screenshot({
      path: 'e2e/artifacts/chess-online-white-desktop.png',
      fullPage: true,
    });
    await session.firstPage.screenshot({
      path: 'e2e/artifacts/docker-chess-online.png',
      fullPage: true,
    });
    await session.secondPage.setViewportSize({ width: 390, height: 844 });
    await session.secondPage.screenshot({
      path: 'e2e/artifacts/chess-online-black-mobile.png',
      fullPage: true,
    });
    firstFailures.assertEmpty();
    secondFailures.assertEmpty();
  } finally {
    await session.close();
  }
});

test('rated matchmaking pairs compatible teachers and writes rating after resignation', async ({
  browser,
}) => {
  const session = await pages(browser);
  const firstFailures = collectBrowserFailures(session.firstPage, {
    allowAnonymousSessionProbe: true,
  });
  const secondFailures = collectBrowserFailures(session.secondPage, {
    allowAnonymousSessionProbe: true,
  });
  try {
    await login(session.firstPage, {
      workspace: first.workspace,
      email: first.email,
      password: first.password,
      userId: first.teacherId,
    });
    await login(session.secondPage, second);
    await createChessProject(session.firstPage, 'Рейтинговая очередь A');
    await createChessProject(session.secondPage, 'Рейтинговая очередь B');

    await session.firstPage.getByText('Рейтинговая', { exact: true }).click();
    await session.secondPage.getByText('Рейтинговая', { exact: true }).click();
    await session.firstPage.getByRole('button', { name: 'Белые' }).click();
    await session.secondPage.getByRole('button', { name: 'Чёрные' }).click();
    await session.firstPage.getByRole('button', { name: 'Найти соперника' }).click();
    await expect(session.firstPage.getByRole('heading', { name: 'Ищем соперника' })).toBeVisible();
    await session.secondPage.getByRole('button', { name: 'Найти соперника' }).click();

    await expect(
      session.firstPage.getByRole('heading', { name: 'Рейтинговая партия' }),
    ).toBeVisible({
      timeout: 8_000,
    });
    await expect(
      session.secondPage.getByRole('heading', { name: 'Рейтинговая партия' }),
    ).toBeVisible({
      timeout: 8_000,
    });
    await session.secondPage.getByRole('button', { name: 'Сдаться' }).click();
    await expect(session.firstPage.getByText(/Белые победили/)).toBeVisible({ timeout: 5_000 });

    const whiteRating = await session.firstPage.request.get('/api/chess/live/ratings/rapid');
    const blackRating = await session.secondPage.request.get('/api/chess/live/ratings/rapid');
    expect(whiteRating.ok()).toBe(true);
    expect(blackRating.ok()).toBe(true);
    expect(await whiteRating.json()).toMatchObject({
      rating: { rating: 1224, games: 1, algorithm: 'asa-elo-v1' },
      ledger: [{ delta: 24 }],
    });
    expect(await blackRating.json()).toMatchObject({
      rating: { rating: 1176, games: 1, algorithm: 'asa-elo-v1' },
      ledger: [{ delta: -24 }],
    });
    firstFailures.assertEmpty();
    secondFailures.assertEmpty();
  } finally {
    await session.close();
  }
});
