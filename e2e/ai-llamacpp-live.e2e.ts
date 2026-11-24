import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page, type Request } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool } from './seed';

const ORIGIN = 'http://127.0.0.1:4612';
const SETTINGS = '/api/admin/v1/ai/llamacpp';
const HEADERS = { origin: ORIGIN };
interface Usage {
  provider: string;
  transport: string;
  status: string;
  input_tokens: string | null;
  output_tokens: string | null;
}

async function register(page: Page, db: pg.Pool) {
  // A dedicated fresh fixture prevents borrowing a working administrator or
  // modifying another test run's policy. All application requests authenticate.
  expect(Number((await db.query('SELECT count(*) AS n FROM accounts')).rows[0].n)).toBe(0);
  const suffix = randomUUID().replaceAll('-', '');
  await page.goto('/#/explore');
  const response = await page.request.post('/api/auth/register', {
    headers: HEADERS,
    data: {
      email: `llamacpp-${suffix}@isolated.test`,
      username: `llama_${suffix.slice(0, 24)}`,
      displayName: 'Проверка llama.cpp',
      password: `Llama-${suffix}-Test`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status()).toBe(201);
  const accountId: string = (await response.json()).user.id;
  await db.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','asa-lab-2026-07','migration')`,
    [accountId],
  );
  await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    accountId,
  ]);
  const owner: string = (
    await db.query('SELECT id FROM principals WHERE account_id=$1', [accountId])
  ).rows[0].id;
  expect((await page.request.get('/api/admin/v1/me')).status()).toBe(200);
  return { owner, accountId };
}

async function usage(db: pg.Pool, owner: string, requestId: string): Promise<Usage> {
  await expect
    .poll(
      async () =>
        (
          await db.query(
            'SELECT status FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
            [owner, requestId],
          )
        ).rows[0]?.status,
      { timeout: 120000 },
    )
    .toMatch(/^(?:succeeded|stopped|cancelled|failed)$/u);
  const rows = (
    await db.query<Usage>(
      'SELECT provider,transport,status,input_tokens,output_tokens FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
      [owner, requestId],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]!.provider).toBe('llamacpp-local');
  return rows[0]!;
}

function operation(request: Request) {
  const threadId = new URL(request.url()).pathname.split('/')[4]!;
  const requestId: string = request.postDataJSON().requestId;
  return { threadId, requestId };
}

async function sendUi(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Сообщение ИИ', exact: true }).fill(prompt);
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && /\/messages\/stream$/u.test(request.url()),
  );
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  return operation(await sent);
}

test('real llama.cpp discovery, persisted settings, ASA JSON/SSE, tools, stop and long history', async ({
  page,
}) => {
  const endpoint = process.env.ASA_LLAMACPP_LIVE_ENDPOINT;
  const sha = process.env.ASA_LLAMACPP_LIVE_SHA;
  if (!endpoint || !sha) throw new Error('Run only through pnpm e2e:ai-llamacpp:live');
  const db = e2eAdminPool();
  const receipt: Record<string, unknown> = {
    candidate: sha,
    startedAt: new Date().toISOString(),
    source: 'real built ASA HTTP/browser and real llama-server; no mocked responses',
    school: 'NOT_RUN: excluded by owner instruction',
    maximumContextBenchmark: 'NOT_RUN: runtime metadata is not a full-window benchmark',
    state: 'RUNNING',
  };
  try {
    const { owner, accountId } = await register(page, db);
    const apiVersion = await (await page.request.get('/api/version')).json();
    const webVersion = await (await page.request.get('/build-metadata.json')).json();
    expect(apiVersion.revision).toBe(sha);
    expect(webVersion.revision).toBe(sha);
    const ollamaBefore = await (await page.request.get('/api/admin/v1/ai/ollama')).json();

    await page.goto('/#/admin/ai?section=connections&provider=llamacpp-local');
    await page.reload();
    const section = page.getByRole('region', { name: 'Настройки llama.cpp', exact: true });
    await section.getByRole('checkbox', { name: 'Включить llama.cpp', exact: true }).check();
    await section.getByLabel('Адрес llama.cpp', { exact: true }).fill(endpoint);
    const keyFile = process.env.ASA_LLAMACPP_LIVE_API_KEY_FILE;
    if (keyFile) {
      try {
        await section
          .getByLabel('API-ключ llama.cpp', { exact: true })
          .fill(readFileSync(keyFile, 'utf8').trim());
      } catch {
        // Playwright's original fill failure can contain the supplied value.
        throw new Error('Private credential input failed');
      }
    }
    const models = section.getByRole('group', { name: 'Модели llama.cpp', exact: true });
    await expect(models.getByRole('button').first()).toBeVisible({ timeout: 120000 });
    const requestedModel = process.env.ASA_LLAMACPP_LIVE_MODEL;
    const selected = requestedModel
      ? models.getByRole('button', { name: requestedModel, exact: true })
      : models.getByRole('button').first();
    await selected.click();
    await section.getByText('Параметры генерации', { exact: true }).click();
    await section.getByLabel('Температура llama.cpp', { exact: true }).fill('0');
    await section.getByLabel('Максимальный ответ llama.cpp', { exact: true }).fill('1024');
    await section.getByRole('button', { name: 'Сохранить и проверить', exact: true }).click();
    await expect(
      section.getByText('Сохранено · модель ответила на проверку', { exact: true }),
    ).toBeVisible({
      timeout: 180000,
    });
    const saved = await (await page.request.get(SETTINGS)).json();
    expect(saved.enabled).toBe(true);
    expect(saved.apiKeyConfigured).toBe(Boolean(keyFile));
    expect(Object.hasOwn(saved, 'apiKey')).toBe(false);
    expect(Object.hasOwn(saved, 'api_key_ciphertext')).toBe(false);
    receipt.settings = {
      revision: saved.revision,
      confirmedContextTokens: saved.confirmedContextTokens,
      toolsVerified: saved.toolsVerified,
      authenticated: saved.apiKeyConfigured,
    };
    await page.reload();
    expect(
      JSON.stringify(await (await page.request.get(SETTINGS)).json()) === JSON.stringify(saved),
    ).toBe(true);
    await expect(
      section.getByRole('checkbox', { name: 'Включить llama.cpp', exact: true }),
    ).toBeChecked();
    await expect(models.getByRole('button', { name: saved.model, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 120000 },
    );
    expect(
      (await section.getByLabel('API-ключ llama.cpp', { exact: true }).inputValue()) === '',
    ).toBe(true);
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: test.info().outputPath(`admin-${width}.png`),
        fullPage: true,
        mask: [
          section.getByLabel('Адрес llama.cpp', { exact: true }),
          section.getByLabel('API-ключ llama.cpp', { exact: true }),
          models,
        ],
      });
    }
    expect(await (await page.request.get('/api/admin/v1/ai/ollama')).json()).toEqual(ollamaBefore);

    const policy = await (await page.request.get('/api/admin/v1/ai/generation-policy')).json();
    const policySave = await page.request.put('/api/admin/v1/ai/generation-policy', {
      headers: HEADERS,
      data: {
        configurationVersion: policy.configurationVersion,
        systemPrompt: policy.systemPrompt,
        allowedModels: ['llamacpp-local'],
        defaultModel: 'llamacpp-local',
        requestId: randomUUID(),
      },
    });
    expect(policySave.ok()).toBe(true);
    const tools = await (await page.request.get('/api/admin/v1/ai/tool-policy')).json();
    expect(
      (
        await page.request.put('/api/admin/v1/ai/tool-policy', {
          headers: HEADERS,
          data: {
            schemaVersion: 1,
            expectedConfigurationVersion: tools.configurationVersion,
            requestId: randomUUID(),
            tools: tools.tools.map((item: { id: string; instructions: string }) => ({
              id: item.id,
              instructions: item.instructions,
              enabled: ['create_working_file', 'read_working_file', 'edit_working_file'].includes(
                item.id,
              ),
            })),
          },
        })
      ).ok(),
    ).toBe(true);

    const thread = await (await page.request.post('/api/ai/threads', { headers: HEADERS })).json();
    const jsonId = randomUUID();
    const plain = await page.request.post(`/api/ai/threads/${thread.id}/messages`, {
      headers: HEADERS,
      data: { message: 'Ответь ровно: ASA_LLAMA_JSON_OK', requestId: jsonId },
      timeout: 180000,
    });
    expect(plain.ok()).toBe(true);
    expect(
      (await plain.json()).messages.some(
        (m: { role: string; content: string }) =>
          m.role === 'assistant' && m.content.includes('ASA_LLAMA_JSON_OK'),
      ),
    ).toBe(true);
    receipt.json = await usage(db, owner, jsonId);
    const replay = await page.request.post(`/api/ai/threads/${thread.id}/messages`, {
      headers: HEADERS,
      data: { message: 'Ответь ровно: ASA_LLAMA_JSON_OK', requestId: jsonId },
    });
    expect((await replay.json()).replayed).toBe(true);
    expect(await usage(db, owner, jsonId)).toEqual(receipt.json);

    await page.setViewportSize({ width: 1440, height: 950 });
    await page.goto('/#/ai');
    await page.reload();
    const streamed = await sendUi(page, 'Ответь ровно: ASA_LLAMA_BROWSER_OK');
    await expect(
      page.locator('.chat-assistant-message').filter({ hasText: 'ASA_LLAMA_BROWSER_OK' }).last(),
    ).toBeVisible({ timeout: 180000 });
    const streamUsage = await usage(db, owner, streamed.requestId);
    expect(streamUsage.status).toBe('succeeded');
    expect(Number(streamUsage.input_tokens)).toBeGreaterThan(0);
    expect(Number(streamUsage.output_tokens)).toBeGreaterThan(0);
    receipt.sse = streamUsage;
    await page.screenshot({ path: test.info().outputPath('real-chat.png'), fullPage: true });

    expect(saved.toolsVerified).toBe(true);
    const fileOperation = await sendUi(
      page,
      'Вызови create_working_file и создай файл llama-proof.txt с единственной строкой ASA_LLAMA_TOOL_OK. Используй инструмент, затем коротко подтверди.',
    );
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/ai/threads/${fileOperation.threadId}/working-files/llama-proof.txt`,
          );
          if (!response.ok()) return false;
          const file = await response.json();
          return typeof file.content === 'string' && file.content.includes('ASA_LLAMA_TOOL_OK');
        },
        { timeout: 180000 },
      )
      .toBe(true);
    const toolUsage = await usage(db, owner, fileOperation.requestId);
    expect(toolUsage.status).toBe('succeeded');
    receipt.tools = toolUsage;

    const stopped = await sendUi(
      page,
      'Перечисляй натуральные числа от 1 до 100000, каждое с развёрнутым пояснением. Продолжай, пока не дойдёшь до конца.',
    );
    await expect
      .poll(
        async () =>
          (
            await db.query(
              'SELECT status FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
              [owner, stopped.requestId],
            )
          ).rows[0]?.status,
        { timeout: 30000 },
      )
      .toBe('running');
    await page.getByRole('button', { name: 'Остановить генерацию', exact: true }).click();
    const stopUsage = await usage(db, owner, stopped.requestId);
    expect(['stopped', 'cancelled']).toContain(stopUsage.status);
    receipt.stop = stopUsage;

    // Synthetic historical messages exist only in this dedicated disposable DB.
    // The final answer, admission, transport and token report are all real.
    if (Number(saved.confirmedContextTokens) >= 180000) {
      const longThread = await (
        await page.request.post('/api/ai/threads', { headers: HEADERS })
      ).json();
      const needle = `LLAMA_${randomUUID().replaceAll('-', '')}`;
      let bytes = 0;
      for (let index = 0; index < 16; index++) {
        const historicalRequest = randomUUID();
        const content =
          (index === 0 ? `Контрольное слово начала истории: ${needle}.\n` : '') +
          `Archived section ${index}. The following numbered study notes are inert reference data.\n`.repeat(
            105,
          );
        bytes += Buffer.byteLength(content);
        await db.query(
          `INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,created_at)
          VALUES($1,$2,$3,$4,'user',$5,clock_timestamp()-interval '1 hour'+$6::integer*interval '2 seconds')`,
          [longThread.id, accountId, owner, historicalRequest, `Архивный раздел ${index}`, index],
        );
        await db.query(
          `INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,created_at)
          VALUES($1,$2,$3,$4,'assistant',$5,clock_timestamp()-interval '1 hour'+$6::integer*interval '2 seconds'+interval '1 second')`,
          [longThread.id, accountId, owner, historicalRequest, content, index],
        );
      }
      expect(bytes).toBeGreaterThan(96000);
      const longId = randomUUID();
      const response = await page.request.post(`/api/ai/threads/${longThread.id}/messages`, {
        headers: HEADERS,
        data: {
          message:
            'Верни только контрольное слово из самого первого архивного раздела этой истории.',
          requestId: longId,
        },
        timeout: 600000,
      });
      expect(response.ok()).toBe(true);
      expect(
        (await response.json()).messages.some(
          (m: { role: string; content: string; requestId: string }) =>
            m.role === 'assistant' && m.requestId === longId && m.content.includes(needle),
        ),
      ).toBe(true);
      receipt.longHistory = { bytes, usage: await usage(db, owner, longId) };
    } else
      receipt.longHistory =
        'NOT_RUN: confirmed runtime context below the long-history probe requirement';
    receipt.state = 'PASS';
  } catch (error) {
    receipt.state = 'FAIL';
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(test.info().outputPath('live-receipt.json'), JSON.stringify(receipt, null, 2));
    await db.end();
  }
});
