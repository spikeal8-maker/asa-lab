import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool } from './seed';

const ORIGIN = 'http://127.0.0.1:4612';
const ENDPOINT = '/api/admin/v1/ai/usage-overview';
const BASELINE = process.env.ASA_AI_OVERVIEW_BASELINE === 'true';
const COUNTS = [1, 0, 2, 1, 3, 0, 2];

interface Overview {
  schemaVersion: 1;
  period: { from: string; to: string; timeZone: 'UTC'; days: 7 };
  generatedAt: string;
  requests: number;
  inputTokens: { known: string | null; knownOperations: number; unknownOperations: number };
  outputTokens: { known: string | null; knownOperations: number; unknownOperations: number };
  daily: { date: string; requests: number }[];
  state: 'empty' | 'partial' | 'complete';
}

async function registerAdministrator(page: Page, db: pg.Pool) {
  const unique = randomUUID().replaceAll('-', '');
  await page.goto('/#/explore');
  const registration = await page.request.post('/api/auth/register', {
    headers: { origin: ORIGIN },
    data: {
      email: `ai-overview-${unique}@isolated.test`,
      username: `ai_${unique.slice(0, 25)}`,
      displayName: 'Администратор проверки ИИ',
      password: `Overview-${unique}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(registration.status()).toBe(201);
  const session = await registration.json();
  expect(session.authenticated).toBe(true);
  const accountId: string = session.user.id;
  // This privileged setup is permitted only inside e2eAdminPool's explicit
  // disposable *_test database. The browser then uses real session cookies.
  await db.query(
    `INSERT INTO capability_grants
       (account_id,capability,state,policy_version,granted_by)
     VALUES ($1,'platform_admin','verified','asa-lab-2026-07','migration')`,
    [accountId],
  );
  await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    accountId,
  ]);
  const authenticated = await page.request.get('/api/auth/me');
  expect(authenticated.status()).toBe(200);
  const checkedSession = await authenticated.json();
  expect(checkedSession.verification?.required).toBe(false);
  expect(checkedSession.capabilities).toContainEqual({
    capability: 'platform_admin',
    state: 'verified',
  });
  const profile = await page.request.get('/api/admin/v1/me');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).scopes).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'platform', role: 'platform_admin' })]),
  );
  const principal = await db.query<{ id: string }>(
    'SELECT id FROM principals WHERE account_id=$1',
    [accountId],
  );
  expect(principal.rows).toHaveLength(1);
  return { accountId, principalId: principal.rows[0]!.id };
}

async function versions(page: Page) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  expect(revision).toMatch(/^[a-f0-9]{40}$/);
  expect(process.env.ASA_BUILD_REVISION).toBe(revision);
  expect(process.env.VITE_ASA_BUILD_REVISION).toBe(revision);
  const response = await page.request.get('/api/version');
  expect(response.status()).toBe(200);
  const api = await response.json();
  expect(api.revision).toBe(revision);
  const served = await page.request.get('/build-metadata.json');
  expect(served.status()).toBe(200);
  const web = await served.json();
  expect(web.revision).toBe(revision);
  const built = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
  expect(built).toEqual(web);
  return { revision, apiVersion: api, webVersion: web };
}

async function overview(page: Page): Promise<Overview> {
  const response = await page.request.get(ENDPOINT);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return response.json();
}

async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all(
      (document.querySelector('.skip-link')?.getAnimations() ?? []).map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    );
  });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

async function assertLayout(page: Page, width: number) {
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('.asa-ai-admin-workspace');
    const bounds = workspace?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      workspaceLeft: bounds?.left,
      workspaceRight: bounds?.right,
    };
  });
  expect(layout.width).toBe(width);
  expect(layout.scrollWidth).toBeLessThanOrEqual(width);
  expect(layout.workspaceLeft).toBeGreaterThanOrEqual(0);
  expect(layout.workspaceRight).toBeLessThanOrEqual(width + 1);
}

async function seedUsage(db: pg.Pool, actor: { principalId: string; accountId: string }) {
  const clock = await db.query<{ now: Date }>('SELECT statement_timestamp() AS now');
  const today = new Date(clock.rows[0]!.now);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 6);
  const rows: { requestId: string; admittedAt: string; input: number; output: number }[] = [];
  const daily = COUNTS.map((requests, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    for (let count = 0; count < requests; count += 1) {
      const ordinal = rows.length + 1;
      rows.push({
        requestId: randomUUID(),
        admittedAt: day.toISOString(),
        input: ordinal * 100,
        output: ordinal * 10,
      });
    }
    return { date: day.toISOString().slice(0, 10), requests };
  });
  const insert = `INSERT INTO ai_usage_journal
    (owner_principal_id,request_id,account_id,admitted_at,status,operation,input_tokens,output_tokens)
    VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7) ON CONFLICT DO NOTHING`;
  for (const [index, row] of rows.entries()) {
    await db.query(insert, [
      actor.principalId,
      row.requestId,
      actor.accountId,
      row.admittedAt,
      index === rows.length - 1 ? 'regeneration' : 'chat',
      row.input,
      row.output,
    ]);
  }
  // Re-inserting an already recorded operation must not duplicate the request.
  await db.query(insert, [
    actor.principalId,
    rows[0]!.requestId,
    actor.accountId,
    rows[0]!.admittedAt,
    'chat',
    rows[0]!.input,
    rows[0]!.output,
  ]);
  // Both lower and upper boundaries are observed with real journal records.
  for (const admittedAt of [
    new Date(start.getTime() - 1).toISOString(),
    new Date(today.getTime() + 86400000).toISOString(),
  ]) {
    await db.query(insert, [
      actor.principalId,
      randomUUID(),
      actor.accountId,
      admittedAt,
      'chat',
      90000,
      90000,
    ]);
  }
  return { rows, daily, from: start.toISOString(), requests: 9, input: '4500', output: '450' };
}

async function assertMetrics(page: Page, input = '4500', output = '450') {
  for (const [testId, expected] of [
    ['ai-usage-requests', '9'],
    ['ai-usage-input', input],
    ['ai-usage-output', output],
  ]) {
    await expect
      .poll(async () =>
        (await page.getByTestId(testId!).locator('.asa-ai-usage-value bdi').innerText()).replace(
          /\s/g,
          '',
        ),
      )
      .toBe(expected);
  }
}

test(
  BASELINE
    ? 'ASAI-01 pristine source baseline snapshots'
    : 'ASAI-01 real usage overview and owner journey',
  async ({ page }) => {
    const db = e2eAdminPool();
    try {
      // This dedicated job must not reuse another suite's journal or a working DB.
      const emptyJournal = await db.query<{ count: string }>(
        'SELECT count(*) AS count FROM ai_usage_journal',
      );
      expect(emptyJournal.rows[0]!.count).toBe('0');
      const actor = await registerAdministrator(page, db);
      const provenance = await versions(page);
      const tabs = page.getByRole('tablist', { name: 'Разделы ИИ' });
      await page.goto('/#/admin/ai');
      await page.reload();

      if (BASELINE) {
        await expect(tabs.getByRole('tab').first()).toHaveText('Подключения');
        await expect(page.locator('#ai-panel-connections')).toBeVisible();
        const fixture = await seedUsage(db, actor);
        for (const width of [1440, 390]) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            await screenshot(page, `baseline-source-${width}-${colorScheme}`);
          }
        }
        writeFileSync(
          test.info().outputPath('safe-baseline-summary.json'),
          JSON.stringify(
            {
              kind: 'pristine-source-baseline-rendered-in-this-ci-run',
              note: 'Source baseline snapshot, not a claim of chronological pre-edit capture. The previous admin UI has no dark theme.',
              ...provenance,
              source: 'ai_usage_journal in an isolated disposable PostgreSQL database',
              expected: {
                requests: fixture.requests,
                input: fixture.input,
                output: fixture.output,
                daily: fixture.daily,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      await expect(tabs.getByRole('tab').nth(0)).toHaveText('Обзор');
      await expect(tabs.getByRole('tab').nth(1)).toHaveText('Настройки');
      await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('heading', { name: 'Обзор использования ИИ' })).toBeVisible();
      await expect(page.getByText('Данных за период нет', { exact: true })).toBeVisible();
      const initial = await overview(page);
      expect(initial).toMatchObject({
        schemaVersion: 1,
        state: 'empty',
        requests: 0,
        inputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
        outputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
      });
      expect(initial.daily).toHaveLength(7);
      expect(initial.daily.every((day) => day.requests === 0)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await screenshot(page, 'empty-1440-light');

      const fixture = await seedUsage(db, actor);
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await assertMetrics(page);
      const received = await overview(page);
      expect(received).toMatchObject({
        schemaVersion: 1,
        period: { timeZone: 'UTC', days: 7 },
        requests: fixture.requests,
        state: 'complete',
        inputTokens: { known: fixture.input, knownOperations: 9, unknownOperations: 0 },
        outputTokens: { known: fixture.output, knownOperations: 9, unknownOperations: 0 },
        daily: fixture.daily,
      });
      expect(Date.parse(received.period.from)).toBe(Date.parse(fixture.from));
      const sql = await db.query(
        `SELECT count(*)::integer AS requests, sum(input_tokens)::text AS input,
              sum(output_tokens)::text AS output
         FROM ai_usage_journal WHERE admitted_at >= $1 AND admitted_at < $2`,
        [received.period.from, received.period.to],
      );
      expect(sql.rows).toEqual([{ requests: 9, input: '4500', output: '450' }]);
      writeFileSync(
        test.info().outputPath('safe-control-summary.json'),
        JSON.stringify(
          { kind: 'real-built-api-web-postgresql', ...provenance, sql: sql.rows[0], api: received },
          null,
          2,
        ),
      );

      for (const width of [1440, 390, 320, 768, 1024, 1920]) {
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await page.reload();
          await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await assertMetrics(page);
          await expect(
            page.getByRole('img', { name: 'Количество запросов по дням за семь дней' }),
          ).toBeVisible();
          await assertLayout(page, width);
          await screenshot(page, `overview-${width}-${colorScheme}`);
        }
      }
      await page.getByText('Данные по дням', { exact: true }).click();
      const table = page.getByRole('table', { name: 'Запросы по дням' });
      await expect(table).toBeVisible();
      await expect(table.locator('tbody tr')).toHaveCount(7);
      for (const [index, requests] of COUNTS.entries()) {
        await expect(table.locator('tbody tr').nth(index).getByRole('cell').last()).toHaveText(
          String(requests),
        );
      }

      await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
      await expect(page.locator('#ai-panel-settings')).toBeVisible();
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Настройки', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.goto('/#/admin/ai?section=connections&provider=openai');
      await expect(page.getByRole('tab', { name: 'Подключения', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByRole('button', { name: /OpenAI/ }).filter({ has: page.locator('strong') }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Подключения', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.goto('/#/explore');
      await page.goto('/#/admin/ai');
      await expect(page.getByRole('tab', { name: 'Подключения', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
      await assertMetrics(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'light' });
      let releaseRead: () => void = () => undefined;
      const heldRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const delayed = '**/api/admin/v1/ai/usage-overview';
      // Delay the request, then pass it to the real API unchanged. No successful
      // payload is substituted, including for the loading-state screenshot.
      await page.route(delayed, async (route) => {
        await heldRead;
        await route.continue();
      });
      try {
        await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
        await expect(page.getByText('Загружаем данные…', { exact: true })).toBeVisible();
        await screenshot(page, 'loading-390-light');
      } finally {
        releaseRead();
        await page.unroute(delayed);
      }
      await assertMetrics(page);

      const available = await db.query<{ exists: boolean; spare: boolean }>(
        "SELECT to_regprocedure('public.ai_usage_overview(uuid,timestamptz)') IS NOT NULL AS exists, to_regprocedure('public.asai_overview_fixture_unavailable(uuid,timestamptz)') IS NULL AS spare",
      );
      expect(available.rows[0]).toEqual({ exists: true, spare: true });
      try {
        // The whole database belongs to this disposable CI job. Temporarily
        // unavailable SQL proves a real 503 and retry; preserve the function and
        // its privileges by restoring its name in finally, without replacing it.
        await db.query(
          'ALTER FUNCTION public.ai_usage_overview(uuid,timestamptz) RENAME TO asai_overview_fixture_unavailable',
        );
        const failure = await page.request.get(ENDPOINT);
        expect(failure.status()).toBe(503);
        expect((await failure.json()).error.code).toBe('ai_usage_unavailable');
        await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Не удалось загрузить данные', exact: true }),
        ).toBeVisible();
        await expect(page.getByText('Данных за период нет', { exact: true })).toHaveCount(0);
        await screenshot(page, 'source-error-390-light');
      } finally {
        await db.query(
          'ALTER FUNCTION public.asai_overview_fixture_unavailable(uuid,timestamptz) RENAME TO ai_usage_overview',
        );
      }
      await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
      await assertMetrics(page);

      await db.query(
        'UPDATE ai_usage_journal SET input_tokens=NULL WHERE owner_principal_id=$1 AND request_id=$2',
        [actor.principalId, fixture.rows[0]!.requestId],
      );
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await expect(page.getByText('Расход известен не полностью', { exact: true })).toBeVisible();
      await assertMetrics(page, '4400');
      expect(await overview(page)).toMatchObject({
        state: 'partial',
        requests: 9,
        inputTokens: { known: '4400', knownOperations: 8, unknownOperations: 1 },
        outputTokens: { known: '450', knownOperations: 9, unknownOperations: 0 },
      });
      await screenshot(page, 'partial-390-light');
      await db.query(
        'UPDATE ai_usage_journal SET input_tokens=NULL,output_tokens=NULL WHERE owner_principal_id=$1',
        [actor.principalId],
      );
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      expect(await overview(page)).toMatchObject({
        state: 'partial',
        inputTokens: { known: null, knownOperations: 0, unknownOperations: 9 },
        outputTokens: { known: null, knownOperations: 0, unknownOperations: 9 },
      });
      await expect(
        page.getByTestId('ai-usage-input').locator('.asa-ai-usage-value bdi'),
      ).toHaveText('Неизвестно');
      await expect(
        page.getByTestId('ai-usage-output').locator('.asa-ai-usage-value bdi'),
      ).toHaveText('Неизвестно');
      await screenshot(page, 'unknown-tokens-390-light');
      // Remove only this fixture's records; an empty response must remain distinct
      // from both the previous partial state and the genuine source error.
      await db.query('DELETE FROM ai_usage_journal WHERE owner_principal_id=$1', [
        actor.principalId,
      ]);
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await expect(page.getByText('Данных за период нет', { exact: true })).toBeVisible();
      expect((await overview(page)).state).toBe('empty');
    } finally {
      await db.end();
    }
  },
);
