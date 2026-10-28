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
  let releaseAnswer: () => void = () => undefined;
  const answerReleased = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
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
    await answerReleased;
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
    const authenticated = await page.request.get('/api/auth/me');
    expect(authenticated.status()).toBe(200);
    const session = await authenticated.json();
    expect(session.authenticated).toBe(true);
    expect(session.user.id).toBe(account);
    expect(session.capabilities).toContainEqual({
      capability: 'platform_admin',
      state: 'verified',
    });
    // Registration happened through APIRequestContext after the SPA mounted
    // anonymously. Reload so its mounted auth state reads the real session.
    await page.reload();
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
    // Evidence is from native product CSS, never injected screenshot styles.
    async function capture(state: string, widths = [1440, 1024, 390, 320]) {
      for (const width of widths) {
        const backgrounds: string[] = [];
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
          await page.emulateMedia({ colorScheme });
          await expect(row).toBeVisible();
          const background = await budgets.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          );
          backgrounds.push(background);
          if (colorScheme === 'dark') expect(background).toBe('rgb(32, 33, 35)');
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            ),
          ).toBe(true);
          await row.evaluate((element) => element.scrollIntoView({ block: 'center' }));
          await row.getByLabel('Общий лимит в месяц', { exact: true }).focus();
          const globalInput = row.getByLabel('Общий лимит в месяц', { exact: true });
          await expect(globalInput).toBeInViewport();
          await expect(globalInput).toHaveCSS('outline-width', '2px');
          if (colorScheme === 'dark') {
            await expect(globalInput).toHaveCSS('color', 'rgb(245, 245, 245)');
            await expect(globalInput).toHaveCSS('border-top-color', 'rgb(116, 116, 122)');
            await expect(globalInput).toHaveCSS('outline-color', 'rgb(124, 185, 230)');
          }
          await expect(
            row.getByLabel('Лимит каждого пользователя в месяц', { exact: true }),
          ).toBeInViewport();
          await page.screenshot({
            path: test.info().outputPath(`${state}-${width}-${colorScheme}.png`),
          });
          await row.screenshot({
            path: test.info().outputPath(`${state}-row-${width}-${colorScheme}.png`),
          });
          if (state === 'before-limits') {
            const model = page.locator('.asa-ai-policy-model-row').first();
            await model.evaluate((element) => element.scrollIntoView({ block: 'center' }));
            await expect(model.getByRole('spinbutton')).toBeInViewport();
            await page.screenshot({
              path: test.info().outputPath(`model-controls-${width}-${colorScheme}.png`),
            });
            await model.screenshot({
              path: test.info().outputPath(`model-row-${width}-${colorScheme}.png`),
            });
          }
        }
        expect(
          backgrounds[1],
          'dark media preference must change actual Settings background',
        ).not.toBe(backgrounds[0]);
      }
    }
    async function checkChatAccountingHidden(exhausted = false) {
      const loaded = page.waitForResponse(
        (response) => response.url().endsWith('/api/ai/token-budgets') && response.status() === 200,
      );
      await page.goto('/#/ai');
      await loaded;
      const chat = page.locator('.asa-ai-layout');
      await expect(chat).toBeVisible();
      await expect(chat).not.toContainText(
        /Подтверждено токенов|Резерв:|Остаток личного бюджета|Новый период:/,
      );
      await expect(chat.getByRole('button', { name: 'Проверить остаток' })).toHaveCount(0);
      await expect(chat.locator('p.chat-runtime-note[role="status"]')).toHaveCount(0);
      await expect(
        chat
          .getByRole('status')
          .filter({ hasText: /бюджет модели исчерпан|расход ожидает подтверждения/ }),
      ).toHaveCount(0);
      if (exhausted) {
        await chat.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Новый ответ');
        await expect(
          chat.getByRole('button', { name: 'Отправить сообщение', exact: true }),
        ).toBeDisabled();
        await expect(
          chat.getByRole('button', { name: 'Отправить сообщение', exact: true }),
        ).toHaveAttribute('title', 'Месячный бюджет модели исчерпан');
        // Change the real admin policy while this exhausted chat stays mounted.
        const current = await (await page.request.get('/api/admin/v1/ai/token-budgets')).json();
        const raised = await page.request.put('/api/admin/v1/ai/token-budgets', {
          headers,
          data: {
            configurationVersion: current.configurationVersion,
            requestId: randomUUID(),
            models: current.models.map(
              (model: { model: string; globalLimit: string | null; userLimit: string | null }) => ({
                model: model.model,
                globalLimit: model.globalLimit,
                userLimit: model.model === 'ollama-local' ? '100' : model.userLimit,
              }),
            ),
          },
        });
        expect(raised.status()).toBe(200);
        const refreshed = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/ai/token-budgets') && response.status() === 200,
        );
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        const recovered = await (await refreshed).json();
        expect(recovered.models[0]).toMatchObject({ used: '12', held: '0', available: true });
        await expect(
          chat.getByRole('button', { name: 'Отправить сообщение', exact: true }),
        ).toBeEnabled();
        await expect(chat.locator('p.chat-runtime-note[role="status"]')).toHaveCount(0);
        expect(calls).toHaveLength(1);
      }
      await page.goto('/#/admin/ai?section=settings');
      await expect(row).toBeVisible();
    }
    await capture('before-limits');
    await checkChatAccountingHidden();
    await row.getByLabel('Общий лимит в месяц', { exact: true }).fill('');
    await row.getByLabel('Лимит каждого пользователя в месяц', { exact: true }).fill('1');
    await budgets.getByRole('button', { name: 'Сохранить лимиты токенов' }).click();
    await expect(budgets.getByRole('status')).toContainText('Лимиты токенов сохранены');
    const threadReply = await page.request.post('/api/ai/threads', { headers, data: {} });
    expect(threadReply.status()).toBe(201);
    const thread = (await threadReply.json()).id,
      requestId = randomUUID();
    const pendingAnswer = page.request.post(`/api/ai/threads/${thread}/messages`, {
      headers,
      data: { message: 'Покажи полный ответ', requestId },
      timeout: 120000,
    });
    // Hold one real admitted operation before synthetic terminal usage arrives.
    // No successful API mocks or manually inserted ledger records.
    try {
      await expect.poll(() => calls.length).toBe(1);
      const pending = await (await page.request.get('/api/ai/token-budgets')).json();
      expect(BigInt(pending.models[0].held)).toBeGreaterThan(0n);
      expect(pending.models[0].used).toBe('0');
      await page.reload();
      await expect(row).toContainText('Резерв: ' + pending.models[0].held);
      await capture('pending-admitted-answer', [390]);
      await checkChatAccountingHidden();
    } finally {
      releaseAnswer();
    }
    const answer = await pendingAnswer;
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
    await expect(row).toContainText('Подтверждено токенов всего: 12');
    await capture('after-limits');
    await checkChatAccountingHidden(true);
    await expect(row).toContainText('Подтверждено токенов всего: 12');
    expect(calls).toHaveLength(1);
    // Leaving Settings removes the shell opt-in; Prompt retains its own layout.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByRole('tab', { name: 'Системный промпт', exact: true }).click();
    await expect(page.locator('.asa-ai-settings')).toHaveCount(0);
    expect(
      await page
        .locator('.portal-shell')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe('rgb(22, 22, 24)');
    await test.info().attach('visual-scope-limits', {
      body: 'Native OS media theme, 1440/1024/390/320 viewport and row crops. Browser zoom 200%: NOT_RUN; no CSS scale emulation. Controlled inference uses fixed synthetic prompt/usage and proves accounting only.',
      contentType: 'text/plain',
    });
  } finally {
    releaseAnswer();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await db.end();
  }
});
