import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page, type Locator } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool } from './seed';
import { openAiUsageNativeZoom } from './ai-usage-native-zoom';
const ROOT = '/api/admin/v1/ai/own-quality',
  ORIGIN = 'http://127.0.0.1:4612';
async function account(page: Page, db: pg.Pool) {
  const id = randomUUID().replaceAll('-', '');
  await page.goto('/#/explore');
  const response = await page.request.post('/api/auth/register', {
    headers: { origin: ORIGIN },
    data: {
      email: `own-quality-${id}@isolated.test`,
      username: `qa_${id.slice(0, 24)}`,
      displayName: 'Контроль качества — свой Account',
      password: `Own-Quality-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status()).toBe(201);
  const a = (await response.json()).user.id as string;
  await db.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [a],
  );
  await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [a]);
  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).authenticated).toBe(true);
  const p = (await db.query<{ id: string }>('SELECT id FROM principals WHERE account_id=$1', [a]))
    .rows[0]!.id;
  await page.reload();
  return { a, p };
}
async function record(db: pg.Pool, who: { a: string; p: string }, n: number, status = 'succeeded') {
  const request = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const thread = (await db.query<{ id: string }>('SELECT ai_chat_create($1) id', [who.p])).rows[0]!
    .id;
  const q = (
    await db.query<{ id: string }>(
      "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES($1,$2,$3,$4,'user',$5) RETURNING id",
      [thread, who.a, who.p, request, `Контрольный вопрос ${n}`],
    )
  ).rows[0]!.id;
  if (status === 'succeeded')
    await db.query(
      "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,source_user_message_id) VALUES($1,$2,$3,$4,'assistant',$5,$6)",
      [
        thread,
        who.a,
        who.p,
        request,
        `Соответствующий ответ ${n}\n\n\`\`\`js\nconst example=${n};\n\`\`\``,
        q,
      ],
    );
  await db.query(
    "INSERT INTO ai_usage_journal(owner_principal_id,request_id,account_id,thread_id,admitted_at,status,operation,provider,requested_model,actual_model) VALUES($1,$2,$3,$4,$5,$6,'chat','ollama','контрольная модель',NULL)",
    [
      who.p,
      request,
      who.a,
      thread,
      n > 11 ? new Date().toISOString() : '2020-01-01T00:00:00Z',
      status,
    ],
  );
  return request;
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="ai-own-quality"]')!,
      first = section.querySelector('.asa-ai-own-row'),
      heading = section.querySelector('h3')!;
    return {
      width: innerWidth,
      height: innerHeight,
      scroll: document.documentElement.scrollWidth,
      heading: heading.getBoundingClientRect().top,
      first: first?.getBoundingClientRect().top ?? null,
      controls: Array.from(section.querySelectorAll('button,summary'))
        .filter((n) => n.getClientRects().length)
        .map((n) => ({
          height: n.getBoundingClientRect().height,
          font: Number.parseFloat(getComputedStyle(n).fontSize),
        })),
    };
  });
}
async function captureTarget(page: Page, target: Locator, filename: string) {
  await target.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' }),
  );
  await expect(target).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath(filename) });
}

test('own-only quality: real sessions, exact saved pairs, compact four-width views, revoke and reload', async ({
  page,
}) => {
  test.skip(
    process.env.ASA_AI_OVERVIEW_BASELINE === 'true',
    'The historical density baseline predates the own-quality route.',
  );
  const db = e2eAdminPool(),
    who = await account(page, db);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  try {
    const api = await page.request.get('/api/version');
    expect((await api.json()).revision).toBe(revision);
    expect((await (await page.request.get('/build-metadata.json')).json()).revision).toBe(revision);
    for (let n = 1; n <= 11; n++) await record(db, who, n);
    const forbidden = await page.request.get(ROOT);
    expect(forbidden.status()).toBe(403);
    const inference: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/ai\//.test(r.url())) inference.push(r.url());
    });
    await page.goto('/#/admin/ai?section=overview');
    await page.reload();
    const section = page.getByTestId('ai-own-quality');
    await expect(
      section.getByRole('button', { name: 'Разрешить просмотр моих диалогов' }),
    ).toBeVisible();
    for (const width of [1440, 390, 320])
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
        await page.emulateMedia({ colorScheme });
        await captureTarget(
          page,
          section.getByRole('button', { name: 'Разрешить просмотр моих диалогов' }),
          `before-optin-${width}-${colorScheme}.png`,
        );
      }
    await section.getByRole('button', { name: 'Разрешить просмотр моих диалогов' }).click();
    await expect(section.locator('.asa-ai-own-row')).toHaveCount(10);
    const response = await page.request.get(ROOT);
    expect(response.headers()['cache-control']).toContain('no-store');
    const data = await response.json();
    expect(data.items.map((r: { question: string }) => r.question)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Контрольный вопрос ${11 - i}`),
    );
    for (const width of [1440, 1024, 390, 320])
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.evaluate(() => window.scrollTo(0, 0));
        const box = await geometry(page);
        expect(box.scroll).toBeLessThanOrEqual(width);
        for (const control of box.controls) expect(control.height).toBeGreaterThanOrEqual(43);
        if (width === 1440 || width === 390) {
          expect(box.heading).toBeLessThan(box.height);
          expect(box.first).not.toBeNull();
          expect(box.first!).toBeLessThan(box.height);
        }
        await page.screenshot({
          path: test.info().outputPath(`after-own-${width}-${colorScheme}.png`),
        });
        await captureTarget(
          page,
          section.locator('.asa-ai-own-row').first(),
          `own-rows-${width}-${colorScheme}.png`,
        );
        if (width === 390 || width === 320) {
          const first = section.locator('.asa-ai-own-row').first();
          await first.click();
          const detail = section.locator('.asa-ai-own-detail');
          const answer = detail.getByText('Соответствующий ответ 11', { exact: true });
          await expect(answer).toBeVisible();
          await captureTarget(page, answer, `own-detail-${width}-${colorScheme}.png`);
          await first.click();
        }
      }
    for (const n of [11, 10]) {
      const row = section.getByRole('button').filter({ hasText: `Контрольный вопрос ${n}` });
      await row.click();
      await expect(section.locator('.asa-ai-own-detail')).toContainText(
        `Соответствующий ответ ${n}`,
      );
      await expect(section.locator('.asa-ai-own-detail')).toContainText('Не зафиксирована');
      await row.click();
    }
    await record(db, who, 12, 'running');
    await record(db, who, 13, 'failed');
    await section.getByRole('button', { name: 'Обновить журнал качества' }).click();
    await expect(section.locator('.asa-ai-own-row').first()).toContainText('Контрольный вопрос 13');
    await expect(section.locator('.asa-ai-own-row').first()).toContainText('Ошибка');
    await expect(section.locator('.asa-ai-own-row').nth(1)).toContainText('Ответ ожидается');
    if (process.env.CI === 'true') {
      const zoom = await openAiUsageNativeZoom(page);
      try {
        await zoom.page.goto(page.url());
        await expect(
          zoom.page.getByTestId('ai-own-quality').locator('.asa-ai-own-row'),
        ).toHaveCount(10);
        expect((await zoom.setZoom(2)).factor).toBe(2);
        const g = await geometry(zoom.page);
        expect(g.scroll).toBeLessThanOrEqual(g.width);
        const zoomSection = zoom.page.getByTestId('ai-own-quality');
        await captureTarget(
          zoom.page,
          zoomSection.locator('.asa-ai-own-row').first(),
          'own-quality-native-200.png',
        );
        const completed = zoomSection
          .getByRole('button')
          .filter({ hasText: 'Контрольный вопрос 11' });
        await completed.click();
        const answer = zoomSection
          .locator('.asa-ai-own-detail')
          .getByText('Соответствующий ответ 11', { exact: true });
        await expect(answer).toBeVisible();
        await captureTarget(zoom.page, answer, 'own-quality-detail-native-200.png');
      } finally {
        await zoom.close();
      }
    }
    await section.getByRole('button', { name: 'Отозвать разрешение' }).click();
    await expect(section.locator('.asa-ai-own-row')).toHaveCount(0);
    expect((await page.request.get(ROOT)).status()).toBe(403);
    await page.reload();
    await expect(
      page
        .getByTestId('ai-own-quality')
        .getByRole('button', { name: 'Разрешить просмотр моих диалогов' }),
    ).toBeVisible();
    expect(inference).toEqual([]);
  } finally {
    await db.end();
  }
});
