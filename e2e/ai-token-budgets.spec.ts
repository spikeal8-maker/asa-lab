import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import { e2eAdminPool } from './seed';

// Real built Web/API/PostgreSQL; only the inference transport is controlled.
// CI only, never points at a working installation or saved provider keys.
test('Settings saves real monthly limits; a complete admitted answer crosses them and the next start is blocked', async ({
  page,
}) => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')
    throw new Error(
      'Budget inference fixture is GitHub CI only; never bind over workstation Ollama.',
    );
  const db = e2eAdminPool(),
    origin = 'http://127.0.0.1:4612',
    headers = { origin };
  const calls: unknown[] = [];
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (request.url === '/api/show') {
      response.end(JSON.stringify({ capabilities: ['completion'] }));
      return;
    }
    if (request.url !== '/api/chat') {
      response.statusCode = 404;
      response.end();
      return;
    }
    calls.push(body);
    response.setHeader('content-type', 'application/x-ndjson');
    response.end(
      JSON.stringify({
        message: { content: 'Полный ответ сохранён, даже когда месячный бюджет превышен.' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 7,
        eval_count: 5,
      }) + '\n',
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      provider.once('error', reject);
      provider.listen(11434, '127.0.0.1', resolve);
    });
    await page.goto('/#/explore');
    const id = randomUUID().replaceAll('-', '');
    const registered = await page.request.post('/api/auth/register', {
      headers,
      data: {
        email: `budget-${id}@isolated.test`,
        username: `b_${id.slice(0, 25)}`,
        displayName: 'Администратор бюджетов',
        password: `Budget-${id}-Password`,
        birthDate: '1990-01-01',
        country: 'RU',
      },
    });
    expect(registered.status()).toBe(201);
    const account = (await registered.json()).user.id;
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','asa-lab-2026-07','migration')",
      [account],
    );
    await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
      account,
    ]);
    const local = await (await page.request.get('/api/admin/v1/ai/ollama')).json();
    expect(
      (
        await page.request.put('/api/admin/v1/ai/ollama', {
          headers,
          data: {
            enabled: true,
            baseUrl: 'http://127.0.0.1:11434',
            model: 'qwen3:4b',
            revision: local.revision,
          },
        })
      ).status(),
    ).toBe(200);
    const policy = await (await page.request.get('/api/admin/v1/ai/generation-policy')).json();
    expect(
      (
        await page.request.put('/api/admin/v1/ai/generation-policy', {
          headers,
          data: {
            configurationVersion: policy.configurationVersion,
            systemPrompt: policy.systemPrompt,
            allowedModels: ['ollama-local'],
            defaultModel: 'ollama-local',
            requestId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(200);
    await page.goto('/#/admin/ai?section=settings');
    const budgets = page.getByRole('region', { name: 'Месячные бюджеты токенов' });
    await expect(budgets.getByRole('button', { name: 'Сохранить лимиты токенов' })).toBeVisible();
    const row = budgets
      .locator('fieldset')
      .filter({ has: page.locator('legend').getByText('ollama-local', { exact: true }) });
    for (const width of [1440, 390, 320])
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ colorScheme });
        await row.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: test.info().outputPath(`before-limits-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
    await row.getByLabel('Общий лимит в месяц', { exact: true }).fill('');
    await row.getByLabel('Лимит каждого пользователя в месяц', { exact: true }).fill('1');
    await budgets.getByRole('button', { name: 'Сохранить лимиты токенов' }).click();
    await expect(budgets.getByRole('status')).toContainText('Лимиты токенов сохранены');
    const threadReply = await page.request.post('/api/ai/threads', { headers, data: {} });
    expect(threadReply.status()).toBe(201);
    const thread = (await threadReply.json()).id,
      requestId = randomUUID();
    const answer = await page.request.post(`/api/ai/threads/${thread}/messages`, {
      headers,
      data: { message: 'Покажи полный ответ', requestId },
    });
    expect(answer.status()).toBe(200);
    expect(JSON.stringify(await answer.json())).toContain('Полный ответ сохранён');
    const denied = await page.request.post(`/api/ai/threads/${thread}/messages`, {
      headers,
      data: { message: 'Новый ответ', requestId: randomUUID() },
    });
    expect(denied.status()).toBe(429);
    expect((await denied.json()).error.code).toBe('ai_budget_exhausted');
    const replay = await page.request.post(`/api/ai/threads/${thread}/messages`, {
      headers,
      data: { message: 'Покажи полный ответ', requestId },
    });
    expect((await replay.json()).replayed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ options: { num_predict: -1 } });
    const own = await (await page.request.get('/api/ai/token-budgets')).json();
    expect(own.models[0]).toMatchObject({
      used: '12',
      held: '0',
      remaining: '0',
      reason: 'ai_budget_exhausted',
    });
    expect(JSON.stringify(own)).not.toContain('globalLimit');
    await page.reload();
    await test.info().attach('budget-accounting-evidence', {
      body: JSON.stringify({
        inference:
          'Controlled local CI transport; synthetic provider token counts, no real-vendor quality proof',
        apiVersion: await (await page.request.get('/api/version')).json(),
        ownBudget: own,
        upstreamDispatches: calls.length,
        outputTruncation: false,
      }),
      contentType: 'application/json',
    });
    for (const width of [1440, 390, 320])
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ colorScheme });
        await expect(row).toContainText('Подтверждено токенов всего:');
        await row.scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`after-limits-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
  } finally {
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await db.end();
  }
});
