import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2026-10-15T12:00:00.000Z';
const authSession = {
  authenticated: true,
  user: { id: ACCOUNT_ID, displayName: 'Администратор', email: 'admin@example.test' },
  account: { id: ACCOUNT_ID, displayName: 'Администратор', email: 'admin@example.test' },
  capabilities: [{ capability: 'platform_admin', state: 'verified' }],
  workspaces: [{ workspaceId: WORKSPACE_ID, kind: 'personal', title: 'Личное', role: 'owner' }],
  activeWorkspace: { workspaceId: WORKSPACE_ID, kind: 'personal' },
  navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
  timeZone: 'Europe/Moscow',
};
const profile = {
  administrator: true,
  principalId: '30000000-0000-4000-8000-000000000001',
  accountId: ACCOUNT_ID,
  displayName: 'Администратор',
  activeWorkspaceId: WORKSPACE_ID,
  scopes: [
    {
      kind: 'platform',
      id: null,
      title: 'ASA Lab',
      role: 'platform_admin',
      permissions: ['administration.open', 'administration.operations.read'],
    },
  ],
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  requestId: string;
  state?: 'complete' | 'stopped';
}

async function fixture(page: Page, answer = 'Arduino — это платформа для электроники.') {
  const threads: { id: string; title: string; updatedAt: string }[] = [];
  const messages = new Map<string, Message[]>();
  const requests: string[] = [];
  const requestThreads: string[] = [];
  const models: string[] = [];
  const historyCursors: (string | null)[] = [];
  let completion: 'current' | 'legacy' | 'recovery' | 'stopped' | 'pending' = 'current';
  let releaseAnswer: (() => void) | null = null;
  let enabled = true;
  let hasKey = false;
  let keyWasSubmitted = false;
  const waitForAnswer = new Promise<void>((resolve) => {
    releaseAnswer = resolve;
  });
  const respond = (route: Route, json: unknown, status = 200) => route.fulfill({ status, json });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === '/api/auth/me') return respond(route, authSession);
    if (path === '/api/admin/v1/me') return respond(route, profile);
    if (path === '/api/account/presentation')
      return respond(route, { motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/account/avatar') return respond(route, { avatarDataUrl: null });
    if (path === '/api/auth/max/status')
      return respond(route, {
        linked: false,
        verifiedAt: null,
        firstAuthenticatedAt: null,
        promptDue: false,
        promptDismissedUntil: null,
        available: false,
      });
    if (path === '/api/auth/max/config') return respond(route, { enabled: false, launchUrl: null });
    if (path === '/api/class-join/me') return respond(route, { authenticated: false });
    if (path === '/api/ai/scopes') return respond(route, { personal: true, items: [] });
    if (path === '/api/ai/status')
      return respond(route, {
        enabled,
        provider: 'openai',
        model: 'gpt-5-mini',
        availableModels: ['gpt-5-mini', 'gpt-4.1-mini'],
      });
    if (path === '/api/ai/threads' && method === 'GET') {
      return respond(route, { items: threads, nextCursor: null });
    }
    if (path === '/api/ai/threads' && method === 'POST') {
      const id = randomUUID();
      threads.unshift({ id, title: 'Новый чат', updatedAt: NOW });
      messages.set(id, []);
      return respond(route, { id }, 201);
    }
    const threadAction = /^\/api\/ai\/threads\/([a-f0-9-]+)$/.exec(path);
    if (threadAction) {
      const id = threadAction[1]!;
      const record = threads.find((t) => t.id === id);
      if (!record)
        return respond(
          route,
          { error: { code: 'ai_thread_not_found', message: 'Диалог не найден' } },
          404,
        );
      if (method === 'PATCH') {
        const body = req.postDataJSON() as { title: string };
        record.title = body.title.trim();
        return respond(route, record);
      }
      if (method === 'DELETE') {
        threads.splice(threads.indexOf(record), 1);
        messages.delete(id);
        return respond(route, { deleted: true });
      }
    }
    const chat = /^\/api\/ai\/threads\/([a-f0-9-]+)\/messages(?:\/stream)?$/.exec(path);
    if (chat) {
      const id = chat[1]!;
      const history = messages.get(id);
      if (!history)
        return respond(route, { error: { code: 'ai_thread_denied', message: 'Not found' } }, 404);
      if (method === 'GET') {
        const beforeId = new URL(req.url()).searchParams.get('beforeId');
        historyCursors.push(beforeId);
        const end = beforeId
          ? history.findIndex((message) => message.id === beforeId)
          : history.length;
        const start = Math.max(0, end - 50);
        const items = history.slice(start, end);
        const first = items[0];
        return respond(route, {
          items,
          nextCursor: start > 0 && first ? { at: first.createdAt, id: first.id } : null,
        });
      }
      const streamed = path.endsWith('/stream');
      const sse = (kind: string, value: unknown) =>
        'event: ' + kind + '\n' + 'data: ' + JSON.stringify(value) + '\n\n';
      const payload = req.postDataJSON() as { message: string; requestId: string; model?: string };
      requests.push(payload.requestId);
      requestThreads.push(id);
      models.push(payload.model ?? '');
      const replayed = history.some(
        (msg) => msg.role === 'user' && msg.requestId === payload.requestId,
      );
      if (!replayed) {
        history.push({
          id: randomUUID(),
          role: 'user',
          content: payload.message,
          createdAt: NOW,
          requestId: payload.requestId,
        });
        threads.find((t) => t.id === id)!.title = payload.message;
        await waitForAnswer;
        if (completion !== 'pending') {
          history.push({
            id: randomUUID(),
            role: 'assistant',
            content: answer,
            createdAt: NOW,
            requestId: payload.requestId,
            state: completion === 'stopped' ? 'stopped' : 'complete',
          });
        }
      }
      const result = {
        messages:
          completion === 'legacy'
            ? history.slice(-80)
            : history.filter((message) => message.requestId === payload.requestId),
        replayed,
        stopped: completion === 'stopped',
      };
      if (streamed) {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream; charset=utf-8',
          body:
            sse('delta', { text: history.at(-1)?.content ?? '' }) +
            (completion === 'recovery' || completion === 'pending' ? '' : sse('done', result)),
        });
      }
      return respond(route, result);
    }
    if (path === '/api/admin/v1/ai/ollama' && method === 'GET') {
      return respond(route, {
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'ornith:9b',
        revision: 1,
        updatedAt: NOW,
      });
    }
    if (path === '/api/admin/v1/ai/ollama/models' && method === 'POST') {
      return respond(route, { models: [{ name: 'ornith:9b', size: 60000 }] });
    }
    if (path === '/api/admin/v1/ai') {
      if (method === 'PUT') {
        const payload = req.postDataJSON() as {
          enabled: boolean;
          provider: string;
          model: string;
          apiKey?: string;
        };
        keyWasSubmitted = Boolean(payload.apiKey);
        hasKey = keyWasSubmitted;
        enabled = payload.enabled;
      }
      return respond(
        route,
        aiAdminFixture({
          enabled,
          provider: 'openai',
          model: 'gpt-5-mini',
          apiKeyConfigured: hasKey,
          paidOperationsPerHour: 1000,
          encryptionReady: true,
          keyFingerprint: hasKey ? 'abcdef123456' : null,
          configurationVersion: hasKey ? 2 : 1,
          updatedAt: NOW,
        }),
      );
    }
    if (method === 'GET') return respond(route, { items: [], meta: { total: 0 } });
    return respond(route, { error: { code: 'unexpected_mutation', message: path } }, 400);
  });

  return {
    release: () => {
      releaseAnswer?.();
    },
    requests,
    requestThreads,
    threads,
    models,
    messages,
    historyCursors,
    setCompletion: (value: typeof completion) => {
      completion = value;
    },
    submittedKey: () => keyWasSubmitted,
  };
}

test('AI composer uploads a real file once and restores the saved attachment after reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const fake = await fixture(page, 'В коде указан INPUT, нужен OUTPUT.');
  const bytes = Buffer.from('void setup() { pinMode(13, INPUT); }\n');
  const hash = createHash('sha256').update(bytes).digest('hex');
  let uploadId: string | null = null;
  let uploadCount = 0;
  let sentIds: readonly string[] = [];
  await page.route(/\/api\/ai\/attachments(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/ai/attachments' && request.method() === 'POST') {
      const descriptor = request.postDataJSON() as {
        uploadId: string;
        fileName: string;
        sizeBytes: number;
        sha256: string;
      };
      expect(descriptor).toMatchObject({
        fileName: 'sketch.ino',
        sizeBytes: bytes.length,
        sha256: hash,
      });
      expect(descriptor.uploadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      uploadId = descriptor.uploadId;
      return route.fulfill({
        json: { uploadId, sha256: hash, state: 'reserved' },
      });
    }
    if (
      uploadId &&
      path === '/api/ai/attachments/' + uploadId + '/bytes' &&
      request.method() === 'PUT'
    ) {
      uploadCount += 1;
      expect(request.postDataBuffer()).toEqual(bytes);
      expect(request.headers()['content-type']).toBe('application/vnd.asa.ai-attachment');
      return route.fulfill({ json: { uploadId, sha256: hash, state: 'ready' } });
    }
    return route.fallback();
  });
  await page.route(/\/api\/ai\/threads\/[0-9a-f-]+\/attachments(?:\?|$)/, async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('requestIds')?.split(',') ?? [];
    return route.fulfill({
      json: {
        items: ids.map((requestId) => ({
          requestId,
          attachments:
            requestId === fake.requests[0]
              ? [
                  {
                    uploadId,
                    fileName: 'sketch.ino',
                    sizeBytes: bytes.length,
                    mediaType: 'text/plain',
                    kind: 'text',
                  },
                ]
              : [],
        })),
      },
    });
  });
  await page.route('**/api/ai/threads/*/messages/stream', async (route) => {
    sentIds = (route.request().postDataJSON() as { attachmentIds?: string[] }).attachmentIds ?? [];
    return route.fallback();
  });

  fake.release();
  await page.goto('/#/ai');
  await page.locator('input[type=file][accept]').setInputFiles({
    name: 'sketch.ino',
    mimeType: 'text/plain',
    buffer: bytes,
  });
  await expect(page.locator('.chat-attachment-drafts')).toContainText('sketch.ino');
  await expect(page.locator('.chat-attachment-drafts')).toContainText('text/plain');
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Найди ошибку в коде');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.locator('.chat-attached-history')).toContainText('sketch.ino');
  expect(uploadCount).toBe(1);
  expect(uploadId).not.toBeNull();
  expect(sentIds).toEqual([uploadId]);
  expect(fake.requests).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Найди ошибку в коде', exact: true }).click();
  await expect(page.locator('.chat-attached-history')).toContainText('sketch.ino');
  await expect(page.locator('.chat-turns')).toContainText('В коде указан INPUT, нужен OUTPUT.');
  // Reselecting the same current thread clears the rendered history; it must
  // also invalidate its loaded-ID cache so its file chips are fetched again.
  await page.getByRole('button', { name: 'Найди ошибку в коде', exact: true }).click();
  await expect(page.locator('.chat-attached-history')).toContainText('sketch.ino');
  expect(uploadCount).toBe(1);
});

test('AI clears bound file chips when a saved answer is recovered after SSE loss', async ({
  page,
}) => {
  const fake = await fixture(page, 'Ответ сохранён при обрыве сети');
  fake.setCompletion('recovery');
  const bytes = Buffer.from('pinMode(13, INPUT);\n');
  const hash = createHash('sha256').update(bytes).digest('hex');
  let uploadId: string | null = null;
  let uploads = 0;
  const sent: Array<{ message: string; attachmentIds?: readonly string[] }> = [];
  await page.route(/\/api\/ai\/attachments(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/ai/attachments' && request.method() === 'POST') {
      const descriptor = request.postDataJSON() as { uploadId: string };
      uploadId = descriptor.uploadId;
      return route.fulfill({ json: { uploadId, sha256: hash, state: 'reserved' } });
    }
    if (
      uploadId &&
      path === '/api/ai/attachments/' + uploadId + '/bytes' &&
      request.method() === 'PUT'
    ) {
      uploads += 1;
      expect(request.postDataBuffer()).toEqual(bytes);
      return route.fulfill({ json: { uploadId, sha256: hash, state: 'ready' } });
    }
    return route.fallback();
  });
  await page.route('**/api/ai/threads/*/messages/stream', async (route) => {
    sent.push(route.request().postDataJSON() as (typeof sent)[number]);
    return route.fallback();
  });
  fake.release();
  await page.goto('/#/ai');
  await page.locator('input[type=file][accept]').setInputFiles({
    name: 'arduino.ino',
    mimeType: 'text/plain',
    buffer: bytes,
  });
  const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await composer.fill('Исправь код из файла');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.locator('.chat-turns')).toContainText('Ответ сохранён при обрыве сети');
  await expect(page.locator('.chat-attachment-drafts')).toHaveCount(0);
  await expect(composer).toHaveValue('');
  await expect(page.locator('.asa-ai-error')).toHaveCount(0);
  fake.setCompletion('current');
  await composer.fill('Новый вопрос без файла');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.locator('.chat-turns > article')).toHaveCount(4);
  expect(uploads).toBe(1);
  expect(sent).toHaveLength(2);
  expect(sent[0]?.attachmentIds).toEqual([uploadId]);
  expect(sent[1]?.attachmentIds).toBeUndefined();
  expect(fake.requests[1]).not.toBe(fake.requests[0]);
});

test('AI retains all attachment chips while paging over 125 user messages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const fake = await fixture(page);
  const threadId = randomUUID();
  fake.threads.push({ id: threadId, title: 'История файлов', updatedAt: NOW });
  const history: Message[] = Array.from({ length: 125 }, (_, index) => ({
    id: randomUUID(),
    role: 'user',
    content: 'Вопрос с номером ' + index,
    createdAt: new Date(Date.parse(NOW) - (125 - index) * 1000).toISOString(),
    requestId: randomUUID(),
  }));
  fake.messages.set(threadId, history);
  const names = new Map([
    [history[0]!.requestId, 'oldest.png'],
    [history[60]!.requestId, 'middle.png'],
    [history[124]!.requestId, 'newest.png'],
  ]);
  const fetched: string[][] = [];
  await page.route(/\/api\/ai\/threads\/[0-9a-f-]+\/attachments(?:\?|$)/, async (route) => {
    const ids = new URL(route.request().url()).searchParams.get('requestIds')?.split(',') ?? [];
    fetched.push(ids);
    return route.fulfill({
      json: {
        items: ids.map((requestId) => ({
          requestId,
          attachments: names.has(requestId)
            ? [
                {
                  uploadId: randomUUID(),
                  fileName: names.get(requestId),
                  sizeBytes: 512,
                  mediaType: 'image/png',
                  kind: 'image',
                },
              ]
            : [],
        })),
      },
    });
  });
  fake.release();
  await page.goto('/#/ai');
  await page.getByRole('button', { name: 'История файлов', exact: true }).click();
  const turns = page.locator('.chat-turns > article');
  const older = page.getByRole('button', { name: 'Загрузить предыдущие сообщения' });
  await expect(turns).toHaveCount(50);
  await expect(page.locator('.chat-attached-history')).toContainText('newest.png');
  await older.click();
  await expect(turns).toHaveCount(100);
  await expect(page.locator('.chat-attached-history')).toHaveCount(2);
  await older.click();
  await expect(turns).toHaveCount(125);
  await expect(page.locator('.chat-attached-history')).toHaveCount(3);
  const namesOnScreen = await page.locator('.chat-attached-history').allTextContents();
  expect(namesOnScreen.join(' ')).toContain('oldest.png');
  expect(namesOnScreen.join(' ')).toContain('middle.png');
  expect(namesOnScreen.join(' ')).toContain('newest.png');
  expect(fetched.every((batch) => batch.length > 0 && batch.length <= 50)).toBe(true);
  expect(new Set(fetched.flat()).size).toBe(125);
  // Reopen the same selected conversation and paginate again. All historical
  // attachments must reappear rather than remain marked loaded but hidden.
  await page.getByRole('button', { name: 'История файлов', exact: true }).click();
  await expect(turns).toHaveCount(50);
  await expect(page.locator('.chat-attached-history')).toContainText('newest.png');
  await older.click();
  await expect(turns).toHaveCount(100);
  await older.click();
  await expect(turns).toHaveCount(125);
  const reopened = (await page.locator('.chat-attached-history').allTextContents()).join(' ');
  for (const filename of ['oldest.png', 'middle.png', 'newest.png']) {
    expect(reopened).toContain(filename);
  }
});

for (const selection of ['single', 'switch', 'switch-error', 'retry'] as const) {
  test(`AI waits for selected history before sending: ${selection}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 750 });
    const fake = await fixture(page, 'Ответ после загрузки');
    const ids = [randomUUID(), randomUUID()];
    for (const [threadIndex, id] of ids.entries()) {
      fake.threads.push({ id, title: `Диалог ${threadIndex}`, updatedAt: NOW });
      fake.messages.set(
        id,
        Array.from({ length: 10 }, (_, index) => ({
          id: randomUUID(),
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `История ${threadIndex}/${index}`,
          createdAt: NOW,
          requestId: randomUUID(),
        })),
      );
    }
    const releases: (() => void)[] = [];
    await page.route('**/api/ai/threads/*/messages', async (route) => {
      const index = releases.length;
      await new Promise<void>((resolve) => releases.push(resolve));
      if (index === 0 && (selection === 'switch-error' || selection === 'retry')) {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'history_unavailable', message: 'История недоступна' } },
        });
      }
      return route.fallback();
    });
    fake.release();
    await page.goto('/#/ai');
    const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    const send = page.getByRole('button', { name: 'Отправить сообщение', exact: true });
    await composer.fill('Вопрос после истории');
    // Selection and submit happen in one JS task, before React disables send.
    await page.getByRole('button', { name: 'Диалог 0', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      document.querySelector<HTMLFormElement>('form.chat-composer')!.requestSubmit();
    });
    await expect.poll(() => releases.length).toBe(1);
    await composer.press('Enter');
    await expect(send).toBeDisabled();
    expect(fake.requests).toHaveLength(0);

    const switched = selection === 'switch' || selection === 'switch-error';
    if (switched) {
      await page.getByRole('button', { name: 'Диалог 1', exact: true }).click();
      await expect.poll(() => releases.length).toBe(2);
    }
    const firstResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/threads/${ids[0]}/messages`),
    );
    releases[0]!();
    await firstResponse;
    if (switched || selection === 'retry') {
      if (selection === 'retry') {
        await expect(page.locator('.asa-ai-error')).toContainText('История недоступна');
      }
      await composer.press('Enter');
      await expect(send).toBeDisabled();
      expect(fake.requests).toHaveLength(0);
      if (selection === 'retry') {
        await page.getByRole('button', { name: 'Обновить переписку' }).click();
        await expect.poll(() => releases.length).toBe(2);
      }
      releases[1]!();
    }
    const turns = page.locator('.chat-turns > article');
    await expect(turns).toHaveCount(10);
    await expect(turns.first()).toContainText(`История ${switched ? 1 : 0}/0`);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(turns).toHaveCount(12);
    await expect(turns.first()).toContainText(`История ${switched ? 1 : 0}/0`);
    await expect(turns.last()).toContainText('Ответ после загрузки');
    expect(fake.requests).toHaveLength(1);
    expect(fake.requestThreads).toEqual([ids[switched ? 1 : 0]]);
  });
}

for (const outcome of ['current', 'legacy', 'recovery', 'stopped'] as const) {
  test(`AI preserves 80+ history on send/reload: ${outcome}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 750 });
    const fake = await fixture(page, 'Новый сохранённый ответ');
    fake.setCompletion(outcome);
    const id = randomUUID();
    fake.threads.push({ id, title: 'Длинная переписка', updatedAt: NOW });
    const history: Message[] = Array.from({ length: 120 }, (_, index) => ({
      id: randomUUID(),
      role: index % 2 === 0 ? 'user' : 'assistant',
      // Legacy done really exceeds 128 KiB, using permitted persisted lengths.
      content: `История ${index}: ` + (index % 2 === 1 ? 'я'.repeat(8000) : 'вопрос'),
      createdAt: new Date(Date.parse(NOW) - (120 - index) * 1000).toISOString(),
      requestId: randomUUID(),
      state: 'complete',
    }));
    fake.messages.set(id, history);
    expect(JSON.stringify(history.slice(-80)).length).toBeGreaterThan(128 * 1024);
    fake.release();
    await page.goto('/#/ai');
    await page.getByRole('button', { name: 'Длинная переписка', exact: true }).click();
    const turns = page.locator('.chat-turns > article');
    const older = page.getByRole('button', { name: 'Загрузить предыдущие сообщения' });
    const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    const send = page.getByRole('button', { name: 'Отправить сообщение' });
    await expect(turns).toHaveCount(50);
    await older.click();
    await expect(turns).toHaveCount(100);
    await expect(turns.first()).toContainText('История 20:');
    await composer.fill('Продолжить длинную переписку');
    await send.click();
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue('');
    await expect(turns).toHaveCount(102);
    await expect(turns.first()).toContainText('История 20:');
    await expect(turns.last()).toContainText('Новый сохранённый ответ');
    // A valid large completion must succeed through SSE, without a hidden
    // history-recovery GET masking a parser failure.
    expect(fake.historyCursors).toHaveLength(outcome === 'recovery' ? 3 : 2);
    if (outcome === 'stopped') await expect(turns.last()).toContainText('Ответ остановлен.');
    await expect(page.locator('.asa-ai-error')).toHaveCount(0);
    await older.click();
    await expect(turns).toHaveCount(122);
    // Recovery must not move the cursor back to its newest 50-message page.
    expect(fake.historyCursors.at(-1)).toBe(history[20]!.id);
    await expect(turns.first()).toContainText('История 0:');
    await expect(older).toHaveCount(0);
    await composer.fill('Ещё один вопрос');
    await send.click();
    await expect(composer).toBeEnabled();
    await expect(turns).toHaveCount(124);
    await expect(older).toHaveCount(0);
    await expect(turns.first()).toContainText('История 0:');
    expect(fake.requests).toHaveLength(2);
    await page.reload();
    // The fixture auto-titles on send.
    await page.getByRole('button', { name: 'Ещё один вопрос', exact: true }).click();
    await expect(turns).toHaveCount(50);
    await older.click();
    await expect(turns).toHaveCount(100);
    await older.click();
    await expect(turns).toHaveCount(124);
    await expect(turns.first()).toContainText('История 0:');
    await expect(turns.last()).toContainText('Новый сохранённый ответ');
    await expect(older).toHaveCount(0);
    expect(fake.requests).toHaveLength(2);
  });
}

test('AI pending and stopped replays keep request identity and state', async ({ page }) => {
  const fake = await fixture(page);
  fake.setCompletion('pending');
  fake.release();
  await page.goto('/#/ai');
  const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  const send = page.getByRole('button', { name: 'Отправить сообщение' });
  const turns = page.locator('.chat-turns > article');
  await composer.fill('Запрос без завершённого ответа');
  await send.click();
  await expect(composer).toBeEnabled();
  await expect(turns).toHaveCount(1);
  await expect(page.locator('.asa-ai-error')).toBeVisible();
  fake.setCompletion('current');
  await composer.fill('Запрос без завершённого ответа');
  await send.click();
  await expect(composer).toBeEnabled();
  await expect(page.locator('.asa-ai-error')).toContainText('Запрос уже был принят');
  await expect(composer).toHaveValue('Запрос без завершённого ответа');
  await expect(turns).toHaveCount(1);
  expect(fake.requests[1]).toBe(fake.requests[0]);
  fake.messages.get(fake.threads[0]!.id)!.push({
    id: randomUUID(),
    role: 'assistant',
    content: 'Сохранённая часть ответа',
    createdAt: NOW,
    requestId: fake.requests[0]!,
    state: 'stopped',
  });
  await send.click();
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('');
  await expect(turns).toHaveCount(2);
  await expect(turns.last()).toContainText('Ответ остановлен.');
  await expect(page.locator('.asa-ai-error')).toHaveCount(0);
  expect(new Set(fake.requests).size).toBe(1);
});

for (const scenario of ['empty', 'existing', 'server-error', 'network-error'] as const) {
  test(`AI pending new-chat blocks duplicate creation and send: ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 750 });
    const fake = await fixture(page);
    await page.goto('/#/ai');
    const newChat = page
      .locator('.chat-sidebar-actions')
      .getByRole('button', { name: 'Новый чат', exact: true });
    const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    const send = page.getByRole('button', { name: 'Отправить сообщение' });
    await expect(newChat).toBeEnabled();
    if (scenario === 'existing') {
      await newChat.click();
      await expect(
        page
          .getByRole('navigation', { name: 'Диалоги' })
          .getByRole('button', { name: 'Новый чат', exact: true }),
      ).toHaveCount(1);
      await expect(newChat).toBeEnabled();
    }
    await composer.fill('Черновик до создания чата');
    let releaseCreate = (): void => undefined;
    const pendingCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let createPosts = 0;
    await page.route('**/api/ai/threads', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      createPosts += 1;
      if (createPosts === 1) {
        await pendingCreate;
        if (scenario === 'network-error') return route.abort('failed');
        if (scenario === 'server-error') {
          return route.fulfill({
            status: 503,
            json: { error: { code: 'unavailable', message: 'Создание чата недоступно' } },
          });
        }
      }
      return route.fallback();
    });
    try {
      // One browser task also exercises the synchronous guard before React can
      // render disabled controls. requestSubmit bypasses the disabled send button.
      await newChat.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
        document.querySelector<HTMLFormElement>('.chat-composer')!.requestSubmit();
      });
      await expect(newChat).toBeDisabled();
      await expect(composer).toBeDisabled();
      await expect(send).toBeDisabled();
      await expect.poll(() => createPosts).toBe(1);
      expect(fake.requests).toHaveLength(0);
      await expect(page.getByTestId('ai-pending-message')).toHaveCount(0);
      // A later submit while POST is still pending must also do nothing.
      await composer.evaluate((input: HTMLTextAreaElement) => input.form!.requestSubmit());
      releaseCreate();
      await expect(newChat).toBeEnabled();
      await expect(composer).toBeEnabled();
      await expect(send).toBeEnabled();
      await expect(composer).toHaveValue('Черновик до создания чата');
      expect(createPosts).toBe(1);
      expect(fake.requests).toHaveLength(0);
      if (scenario.endsWith('error')) {
        await expect(page.getByRole('alert').and(page.locator('.asa-ai-error'))).toBeVisible();
        await newChat.click();
        await expect(newChat).toBeEnabled();
        expect(createPosts).toBe(2);
      }
      const createdId = fake.threads[0]!.id;
      fake.release();
      await send.click();
      await expect(page.getByText('Arduino — это платформа для электроники.')).toBeVisible();
      await expect(composer).toBeEnabled();
      await expect(composer).toHaveValue('');
      await expect(newChat).toBeEnabled();
      expect(fake.requestThreads).toEqual([createdId]);
      expect(createPosts).toBe(scenario.endsWith('error') ? 2 : 1);
    } finally {
      releaseCreate();
      fake.release();
    }
  });
}

for (const outcome of ['current', 'other', 'server-error', 'network-error'] as const) {
  test(`AI pending deletion serializes chat actions and preserves unrelated state: ${outcome}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 750 });
    const fake = await fixture(page);
    const currentId = randomUUID();
    const otherId = randomUUID();
    fake.threads.push(
      { id: currentId, title: 'Текущий проект', updatedAt: NOW },
      { id: otherId, title: 'Другой проект', updatedAt: NOW },
    );
    fake.messages.set(currentId, []);
    fake.messages.set(otherId, []);
    const deleteId = outcome === 'other' ? otherId : currentId;
    let releaseDelete = (): void => undefined;
    const pendingDelete = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteCalls = 0;
    let createCalls = 0;
    await page.route(`**/api/ai/threads/${deleteId}`, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleteCalls++;
      await pendingDelete;
      if (outcome === 'network-error') return route.abort('failed');
      if (outcome === 'server-error') {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'delete_unavailable', message: 'Удаление временно недоступно' } },
        });
      }
      return route.fallback();
    });
    await page.route('**/api/ai/threads', async (route) => {
      if (route.request().method() === 'POST') createCalls++;
      return route.fallback();
    });
    await page.goto('/#/ai');
    const sidebar = page.getByRole('dialog', { name: 'История диалогов' });
    await sidebar.getByRole('button', { name: 'Текущий проект', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    await composer.fill('Сохранить черновик проекта');
    const send = page.getByRole('button', { name: 'Отправить сообщение' });
    await expect(send).toBeEnabled();
    const newChat = page.getByRole('button', { name: 'Создать новый диалог' });
    await sidebar
      .getByRole('button', {
        name: 'Удалить: ' + (outcome === 'other' ? 'Другой проект' : 'Текущий проект'),
      })
      .click();
    const confirmation = sidebar.getByRole('button', { name: 'Удалить', exact: true });
    try {
      // The same task attempts duplicate deletion, creation and form submission
      // before React can make all affected controls disabled.
      await confirmation.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
        document.querySelector<HTMLButtonElement>('.asa-ai-new-chat')!.click();
        document.querySelector<HTMLButtonElement>('.chat-sidebar-actions > button')!.click();
        document.querySelector<HTMLFormElement>('.chat-composer')!.requestSubmit();
      });
      await expect.poll(() => deleteCalls).toBe(1);
      await expect(confirmation).toBeDisabled();
      await expect(newChat).toBeDisabled();
      await expect(composer).toBeDisabled();
      await expect(send).toBeDisabled();
      await expect(composer).toHaveValue('Сохранить черновик проекта');
      await composer.evaluate((input: HTMLTextAreaElement) => input.form!.requestSubmit());
      expect(createCalls).toBe(0);
      expect(fake.requests).toHaveLength(0);
      releaseDelete();
      await expect(newChat).toBeEnabled();
      await expect(composer).toBeEnabled();
      expect(deleteCalls).toBe(1);
      expect(createCalls).toBe(0);
      if (outcome === 'current') {
        await expect(page.locator('.asa-ai-current-title')).toHaveText('Новый диалог');
        await expect(composer).toHaveValue('');
        await expect(
          sidebar.getByRole('button', { name: 'Текущий проект', exact: true }),
        ).toHaveCount(0);
      } else {
        await expect(page.locator('.asa-ai-current-title')).toHaveText('Текущий проект');
        await expect(composer).toHaveValue('Сохранить черновик проекта');
        await expect(send).toBeEnabled();
      }
      if (outcome.endsWith('error')) {
        await expect(page.locator('.chat-main').getByRole('alert')).toBeVisible();
        expect(fake.threads).toHaveLength(2);
        await sidebar.getByRole('button', { name: 'Отмена', exact: true }).click();
      } else {
        expect(fake.threads.map((thread) => thread.id)).not.toContain(deleteId);
      }
      // Completion unlocks the normal creation/send flow; a previous DELETE
      // must not clear the newly selected conversation or its response.
      await newChat.click();
      await expect(composer).toBeEnabled();
      const createdId = fake.threads[0]!.id;
      expect(createCalls).toBe(1);
      await composer.fill('Сообщение нового диалога');
      fake.release();
      await send.click();
      await expect(page.getByText('Arduino — это платформа для электроники.')).toBeVisible();
      expect(fake.requestThreads).toEqual([createdId]);
      await expect(page.locator('.asa-ai-current-title')).toHaveText('Сообщение нового диалога');
    } finally {
      releaseDelete();
      fake.release();
    }
  });
}

async function expectChatFits(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('.asa-ai-layout').evaluate((root) => {
        const main = root.querySelector('.chat-main')!;
        const conversations = root.querySelectorAll('.chat-scroll, .chat-start-state');
        const mainBounds = main.getBoundingClientRect();
        const isEmpty = root.querySelector('.asa-ai-chat')!.classList.contains('is-empty');
        const dock = root.querySelector('.chat-composer-dock')!.getBoundingClientRect();
        const textarea = root.querySelector('textarea')!.getBoundingClientRect();
        const body = root.querySelector('.chat-scroll, .chat-start-state')!.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        const viewportBottom = visualViewport
          ? visualViewport.offsetTop + visualViewport.height
          : innerHeight;
        const checks = {
          pageWidth: document.documentElement.scrollWidth <= innerWidth,
          chatWidth: root.scrollWidth <= root.clientWidth + 1,
          mainWidth: main.scrollWidth <= main.clientWidth + 1,
          conversationWidth: [...conversations].every(
            (node) => node.scrollWidth <= node.clientWidth,
          ),
          chatLeft: bounds.left >= 0,
          chatRight: bounds.right <= innerWidth + 1,
          composerBottom: dock.bottom <= viewportBottom + 1,
          conversationBottom: isEmpty || body.bottom <= dock.top + 1,
          inputTop: textarea.top >= bounds.top,
          centeredOnEmpty: !isEmpty || Math.abs((dock.top + dock.bottom - mainBounds.top - mainBounds.bottom) / 2) <= 15,
          noDuplicateToolbar: root.querySelector('.chat-toolbar') === null,
          modelInComposer: !!root.querySelector('.chat-composer .asa-ai-model-picker'),
          inputLeft: textarea.left >= bounds.left,
          inputRight: textarea.right <= bounds.right,
          inputBottom: textarea.bottom <= dock.bottom,
        };
        return Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([check]) => check);
      }),
    )
    .toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 600, 768, 1024, 1120, 1440]) {
    test(`AI creation workspace fits ${width}px in ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 750 });
      const fake = await fixture(page);
      await page.goto('/#/ai');
      await expect(page.locator('.chat-start-state')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Модель ИИ' })).toBeVisible();
      await expect(page.locator('summary.chat-attach-button')).toBeVisible();
      await expect(page.locator('.asa-ai-layout')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(29, 29, 31)' : 'rgb(255, 255, 255)',
      );
      await expectChatFits(page);
      await page.screenshot({ path: test.info().outputPath(`ai-empty-${theme}-${width}.png`) });
      const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
      await composer.focus();
      await composer.fill('Помоги написать или улучшить код. Я хочу сделать: ');
      await expect(composer).toBeFocused();
      await expect(composer).toHaveValue('Помоги написать или улучшить код. Я хочу сделать: ');
      expect(fake.requests).toHaveLength(0);
      expect(fake.threads).toHaveLength(0);
      await composer.fill('Черновик\n' + 'Строка проекта\n'.repeat(14));
      const inputBounds = await composer.boundingBox();
      expect(inputBounds!.height).toBeLessThanOrEqual(160);
      expect(await composer.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await expectChatFits(page);
      if (width >= 1120) {
        const expanded = await page.locator('.chat-main').boundingBox();
        await page.getByRole('button', { name: 'Свернуть историю', exact: true }).click();
        const toggle = page.getByRole('button', { name: 'Открыть историю диалогов' });
        await expect(toggle).toBeFocused();
        const collapsed = await page.locator('.chat-main').boundingBox();
        expect(collapsed!.width).toBeGreaterThan(expanded!.width + 250);
        await expectChatFits(page);
        await toggle.click();
        await expect(page.getByRole('button', { name: 'Свернуть историю' })).toBeVisible();
      }
    });
  }
}

test('AI long draft contracts with the keyboard visual viewport and remains editable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 750 });
  const fake = await fixture(page);
  await page.goto('/#/ai');
  const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  const send = page.getByRole('button', { name: 'Отправить сообщение' });
  const draft = 'Строка проекта\n'.repeat(40);
  await composer.fill(draft);
  await expect(composer).toHaveCSS('height', '160px');
  for (const height of [350, 300]) {
    // Desktop automation has no OS keyboard. Shrink only visualViewport to
    // exercise the keyboard listener while the layout viewport stays at 750px.
    await page.evaluate((height) => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, 'height', { configurable: true, value: height });
      viewport.dispatchEvent(new Event('resize'));
    }, height);
    await expectChatFits(page);
    await expect.poll(() => composer.evaluate((node) => node.clientHeight)).toBeLessThan(160);
    expect(await composer.evaluate((node) => node.clientHeight)).toBeGreaterThanOrEqual(32);
    expect(await composer.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await composer.press('ControlOrMeta+End');
    await composer.press('x');
    await expect(composer).toHaveValue(draft + 'x');
    expect(await composer.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const button = await send.boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(height);
    expect(button!.y).toBeGreaterThanOrEqual(0);
    await expect(send).toBeInViewport({ ratio: 1 });
    await composer.fill(draft);
  }
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport!, 'height');
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(composer).toHaveCSS('height', '160px');
  await expectChatFits(page);
  expect(fake.requests).toHaveLength(0);
});

for (const width of [320, 600, 1440]) {
  for (const action of ['rename', 'delete', 'pagination', 'new-chat'] as const) {
    test(`AI history ${action} failure stays accessible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 750 });
      const fake = await fixture(page);
      const id = randomUUID();
      fake.threads.push({ id, title: 'Схема проекта', updatedAt: NOW });
      fake.messages.set(id, []);
      const failure = `Не удалось выполнить действие: ${action}`;
      await page.route(/\/api\/ai\/threads(?:\?.*)?$/, (route) => {
        const request = route.request();
        if (
          (action === 'new-chat' && request.method() === 'POST') ||
          (action === 'pagination' && new URL(request.url()).searchParams.has('beforeId'))
        ) {
          return route.fulfill({
            status: 503,
            json: { error: { code: 'history_action_failed', message: failure } },
          });
        }
        if (request.method() !== 'GET') return route.fallback();
        return route.fulfill({ json: { items: fake.threads, nextCursor: { at: NOW, id } } });
      });
      await page.route(`**/api/ai/threads/${id}`, (route) =>
        route.fulfill({
          status: 503,
          json: { error: { code: 'history_action_failed', message: failure } },
        }),
      );
      await page.goto('/#/ai');
      const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
      await composer.fill('Сохранить черновик');
      const toggle = page.getByRole('button', { name: 'Открыть историю диалогов' });
      const dialog = page.getByRole('dialog', { name: 'История диалогов' });
      if (width < 1120) await toggle.click();
      await expect(dialog).toBeVisible();
      if (action === 'rename') {
        await dialog.getByRole('button', { name: 'Переименовать: Схема проекта' }).click();
        await dialog.getByRole('textbox', { name: 'Новое название диалога' }).fill('Новое имя');
        await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      } else if (action === 'delete') {
        await dialog.getByRole('button', { name: 'Удалить: Схема проекта' }).click();
        await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
      } else if (action === 'pagination') {
        await dialog.getByRole('button', { name: 'Показать больше диалогов' }).click();
      } else {
        await dialog.getByRole('button', { name: 'Новый чат', exact: true }).click();
      }
      if (width < 1120) {
        const alert = dialog.getByRole('alert');
        await expect(alert).toHaveText(failure);
        await expect(alert).toBeInViewport({ ratio: 1 });
        expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(toggle).toBeFocused();
        await expect(page.locator('.chat-main').getByRole('alert')).toContainText(failure);
        await toggle.click();
        await expect(dialog.getByRole('alert')).toHaveText(failure);
        await dialog.getByRole('button', { name: 'Закрыть историю', exact: true }).click();
        await expect(toggle).toBeFocused();
      } else {
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(page.locator('.chat-main').getByRole('alert')).toContainText(failure);
      }
      await expect(composer).toHaveValue('Сохранить черновик');
      expect(fake.threads).toEqual([{ id, title: 'Схема проекта', updatedAt: NOW }]);
      expect(fake.requests).toHaveLength(0);
    });
  }
}

test('AI composer sends with Enter, adds a line with Shift+Enter and respects IME', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 750 });
  const fake = await fixture(page, 'Ответ на многострочный вопрос');
  fake.release();
  await page.goto('/#/ai');
  const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await composer.fill('Первая строка');
  await composer.press('End');
  await composer.press('Shift+Enter');
  await composer.press('x');
  await expect(composer).toHaveValue('Первая строка\nx');
  expect(fake.requests).toHaveLength(0);
  await composer.dispatchEvent('compositionstart', { data: '' });
  const prevented = await composer.evaluate((node) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await composer.dispatchEvent('compositionend', { data: 'x' });
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('Первая строка\nx');
  expect(fake.requests).toHaveLength(0);
  expect(fake.threads).toHaveLength(0);
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await expect(page.locator('.chat-user-bubble')).toHaveText('Первая строка\nx');
  await expect(page.locator('.chat-turn-assistant')).toContainText('Ответ на многострочный вопрос');
  expect(fake.requests).toHaveLength(1);
});

test.describe('AI history touch backdrop', () => {
  test.use({ hasTouch: true });

  test('tap dismisses without activating the send control underneath and allows reopening', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 750 });
    const fake = await fixture(page);
    await page.goto('/#/ai');
    const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    await composer.fill('Черновик под историей');
    const send = page.getByRole('button', { name: 'Отправить сообщение' });
    await expect(send).toBeEnabled();
    const button = (await send.boundingBox())!;
    const toggle = page.getByRole('button', { name: 'Открыть историю диалогов' });
    const dialog = page.getByRole('dialog', { name: 'История диалогов' });
    await toggle.tap();
    await expect(dialog).toBeVisible();
    const drawer = (await dialog.boundingBox())!;
    const point = { x: button.x + button.width - 4, y: button.y + button.height / 2 };
    expect(point.x).toBeGreaterThan(drawer.x + drawer.width);
    // Record any event delivered through the modal to the actual underlying UI.
    await page.locator('.chat-main').evaluate((main) => {
      main.setAttribute('data-backdrop-actions', '0');
      for (const type of ['touchstart', 'pointerdown', 'click', 'submit']) {
        main.addEventListener(type, () => {
          main.setAttribute(
            'data-backdrop-actions',
            String(Number(main.getAttribute('data-backdrop-actions')) + 1),
          );
        });
      }
    });
    await page.touchscreen.tap(point.x, point.y);
    await expect(dialog).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(page.locator('.chat-main')).toHaveAttribute('data-backdrop-actions', '0');
    await expect(composer).toHaveValue('Черновик под историей');
    expect(fake.requests).toHaveLength(0);
    expect(fake.threads).toHaveLength(0);
    await toggle.tap();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Закрыть историю', exact: true }),
    ).toBeFocused();
  });
});

test('AI history drawer traps focus, paginates and closes after selection on narrow screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const fake = await fixture(page);
  const id = randomUUID();
  fake.threads.push({ id, title: 'Схема проекта', updatedAt: NOW });
  fake.messages.set(id, []);
  const olderId = randomUUID();
  fake.messages.set(olderId, []);
  const pages: (string | null)[] = [];
  await page.route(/\/api\/ai\/threads(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const params = new URL(route.request().url()).searchParams;
    const cursor = params.get('beforeId');
    pages.push(cursor);
    if (params.get('q')) return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({
      json: cursor
        ? { items: [{ id: olderId, title: 'Ранний диалог', updatedAt: NOW }], nextCursor: null }
        : { items: fake.threads, nextCursor: { at: NOW, id } },
    });
  });
  await page.goto('/#/ai');
  const toggle = page.getByRole('button', { name: 'Открыть историю диалогов' });
  const dialog = page.getByRole('dialog', { name: 'История диалогов' });
  await expect(dialog).toBeHidden();
  await toggle.click();
  const close = dialog.getByRole('button', { name: 'Закрыть историю', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Показать больше диалогов' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await dialog.getByRole('button', { name: 'Показать больше диалогов' }).click();
  await expect(dialog.getByRole('button', { name: 'Ранний диалог', exact: true })).toBeVisible();
  // React StrictMode can replay the initial read. Pagination must still request
  // its exact cursor once and must not create a second page request.
  expect(pages.filter((cursor) => cursor !== null)).toEqual([id]);
  await dialog.getByRole('searchbox', { name: 'Найти диалог' }).fill('Не существует');
  await expect(dialog.getByText('Ничего не найдено в истории')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await dialog.getByRole('searchbox', { name: 'Найти диалог' }).fill('');
  await page.screenshot({ path: test.info().outputPath('ai-history-drawer-320.png') });
  await dialog.getByRole('button', { name: 'Схема проекта', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.asa-ai-current-title')).toHaveText('Схема проекта');
  await expectChatFits(page);
  await toggle.click();
  // A native dialog backdrop receives outside clicks, including the narrow
  // strip left available on a 320px screen.
  await page.mouse.click(315, 400);
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('AI preserves automatic portal collapse as chat history closes and the screen shrinks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await fixture(page);
  await page.goto('/#/ai');
  await expect(page.locator('.portal-sidebar')).toHaveClass(/collapsed/);
  const expandSite = page.getByRole('button', { name: 'Развернуть боковую панель' });
  await expect(expandSite).toBeVisible();
  await expandSite.click();
  await expect(page.locator('.portal-sidebar')).not.toHaveClass(/collapsed/);
  await expect(page.getByRole('button', { name: 'Открыть историю диалогов' })).toBeVisible();
  await page.getByRole('button', { name: 'Свернуть боковую панель' }).click();
  await expect(page.locator('.portal-sidebar')).toHaveClass(/collapsed/);
  await page.getByRole('button', { name: 'Открыть историю диалогов' }).click();
  await page.getByRole('button', { name: 'Свернуть историю' }).click();
  for (const viewport of [
    { width: 1024, height: 750 },
    { width: 600, height: 750 },
    { width: 390, height: 640 },
    { width: 320, height: 480 },
    { width: 768, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await expectChatFits(page);
    await page
      .getByRole('textbox', { name: 'Сообщение ИИ' })
      .fill('Черновик после изменения ширины');
    await page.getByRole('button', { name: 'Открыть историю диалогов' }).click();
    await expect(page.getByRole('dialog', { name: 'История диалогов' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectChatFits(page);
    await page.screenshot({ path: test.info().outputPath(`ai-collapsed-${viewport.width}.png`) });
  }

  // Crossing the desktop breakpoint must not reopen history while ASA is open.
  await page.setViewportSize({ width: 1024, height: 850 });
  await page.getByRole('button', { name: 'Развернуть боковую панель' }).click();
  await expect(page.locator('.portal-sidebar')).not.toHaveClass(/collapsed/);
  await page.setViewportSize({ width: 1440, height: 850 });
  const historyButton = page.getByRole('button', { name: 'Открыть историю диалогов' });
  await expect(historyButton).toBeVisible();
  await expectChatFits(page);
  // Opening chat history deliberately gives it the width by collapsing ASA.
  await historyButton.click();
  await expect(page.locator('.portal-sidebar')).toHaveClass(/collapsed/);
  await expect(page.getByRole('button', { name: 'Свернуть историю' })).toBeVisible();
  await expectChatFits(page);
});

test('AI confines long code and tables to message scrollers and copies the original source', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = `const project = "${'x'.repeat(400)}";`;
  const answer = [
    '```js',
    source,
    '```',
    '',
    '| Компонент | ' + 'Название | '.repeat(12),
    '| --- | ' + '--- | '.repeat(12),
    '| Arduino | ' + 'Значение | '.repeat(12),
    '',
    'https://example.test/' + 'long-path'.repeat(60),
  ].join('\n');
  const fake = await fixture(page, answer);
  fake.release();
  await page.goto('/#/ai');
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Покажи исходный код');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  const copyCode = page.getByRole('button', { name: 'Копировать код' });
  await expect(copyCode).toBeVisible();
  await expectChatFits(page);
  expect(
    await page
      .locator('.asa-ai-code-block pre')
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  expect(
    await page
      .locator('.asa-ai-table-scroll')
      .evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await copyCode.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  await page.getByRole('button', { name: 'Копировать', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(answer);
  await page.screenshot({ path: test.info().outputPath('ai-long-source-320.png') });
});

test('AI stop control saves a stopped reply and unlocks the composer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  const fake = await fixture(page, 'Сохранённая часть ответа');
  let stopRequests = 0;
  await page.route('**/requests/*/stop', async (route) => {
    stopRequests += 1;
    fake.setCompletion('stopped');
    fake.release();
    await route.fulfill({ json: { stopped: true } });
  });
  await page.goto('/#/ai');
  const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await composer.fill('Придумай проект');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByTestId('ai-pending-message')).toBeVisible();
  await expect.poll(() => fake.requests.length).toBe(1);
  await expectChatFits(page);
  await page.getByRole('button', { name: 'Остановить генерацию' }).click();
  await expect(page.getByText('Ответ остановлен.')).toBeVisible();
  await expect(composer).toBeEnabled();
  expect(stopRequests).toBe(1);
  expect(fake.requests).toHaveLength(1);
  await expectChatFits(page);
});

for (const width of [1440, 1024, 600, 390, 320]) {
  test(`AI text chat shows pending, model reply and saved history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 750 });
    const fake = await fixture(page);
    await page.goto('/#/ai');
    await expect(page.locator('.chat-start-state')).toBeVisible();
    await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Что такое Arduino?');
    await page.getByRole('button', { name: 'Отправить сообщение' }).click();
    await expect(page.getByTestId('ai-pending-message')).toContainText('Что такое Arduino?');
    await expect(
      page.getByRole('status', { name: '' }).filter({ hasText: 'Модель формирует ответ' }),
    ).toBeVisible();
    fake.release();
    await expect(page.getByText('Arduino — это платформа для электроники.')).toBeVisible();
    expect(fake.requests).toHaveLength(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`ai-chat-${width}.png`) });
    await page.reload();
    if (width < 1120) {
      await page.getByRole('button', { name: 'Открыть историю диалогов' }).click();
    }
    await page.getByRole('button', { name: 'Что такое Arduino?', exact: true }).click();
    await expect(page.getByText('Arduino — это платформа для электроники.')).toBeVisible();
    expect(fake.requests).toHaveLength(1);
  });
}

test('Platform admin saves a separate cloud key without exposing it to the page', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/admin/ai', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('group', { name: 'Доступные ИИ-провайдеры' })
    .getByRole('button', { name: /^OpenAI/ })
    .click();
  await page.getByRole('region', { name: 'Настройки OpenAI' }).waitFor();
  const secret = 'sk-ai-fake-test-secret-safe-value';
  await page.getByRole('checkbox', { name: 'Включено' }).uncheck();
  await page.getByLabel('Новый API-ключ').fill(secret);
  await page.getByRole('button', { name: 'Сохранить выключенным' }).click();
  await expect(page.getByText('Сохранено · облачные запросы выключены')).toBeVisible();
  await expect(page.getByLabel('Новый API-ключ')).toHaveValue('');
  await expect(page.getByRole('group', { name: 'Доступные ИИ-провайдеры' })).toContainText(
    'Ключ сохранён',
  );
  expect(await page.evaluate((value) => document.body.textContent?.includes(value), secret)).toBe(
    false,
  );
});

test('AI conversation rename and delete update the sidebar without phantom history', async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/#/ai');
  await page.getByRole('button', { name: 'Открыть историю диалогов' }).click();
  await page.getByRole('button', { name: 'Новый чат' }).click();
  await page.getByRole('button', { name: 'Открыть историю диалогов' }).click();
  const sidebar = page.getByRole('navigation', { name: 'Диалоги' });
  await expect(sidebar.getByRole('button', { name: 'Новый чат', exact: true })).toHaveCount(1);
  await sidebar.getByRole('button', { name: 'Переименовать: Новый чат' }).click();
  await sidebar
    .getByRole('textbox', { name: 'Новое название диалога' })
    .fill('Робототехника и Arduino');
  await sidebar.getByRole('button', { name: 'Сохранить' }).click();
  await expect(
    sidebar.getByRole('button', { name: 'Робототехника и Arduino', exact: true }),
  ).toBeVisible();
  await sidebar.getByRole('button', { name: 'Удалить: Робототехника и Arduino' }).click();
  await expect(sidebar.getByRole('group', { name: 'Подтверждение удаления' })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Отмена' }).click();
  await expect(
    sidebar.getByRole('button', { name: 'Робототехника и Arduino', exact: true }),
  ).toBeVisible();
  await sidebar.getByRole('button', { name: 'Удалить: Робототехника и Arduino' }).click();
  await sidebar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(
    sidebar.getByRole('button', { name: 'Робототехника и Arduino', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.chat-start-state')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('AI renders GFM tables, code and safe links without injecting HTML', async ({ page }) => {
  const markdown = [
    '# Объяснение',
    '',
    '- **Arduino** — платформа',
    '- `digitalWrite` управляет пином',
    '',
    '| Пин | Режим |',
    '| --- | --- |',
    '| 13 | OUTPUT |',
    '',
    '```cpp',
    'digitalWrite(13, HIGH);',
    '```',
    '',
    '[Документация](https://example.com/arduino)',
    '',
    '<script>window.hacked = true</script>',
  ].join('\n');
  const fake = await fixture(page, markdown);
  await page.goto('/#/ai');
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Поясни мне Arduino');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  fake.release();
  await expect(page.getByRole('heading', { name: 'Объяснение' })).toBeVisible();
  await expect(
    page.locator('.asa-ai-rich-text strong').filter({ hasText: 'Arduino' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Таблица ответа' }).getByText('OUTPUT'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Копировать код' })).toBeVisible();
  const link = page.getByRole('link', { name: 'Документация' });
  await expect(link).toHaveAttribute('href', 'https://example.com/arduino');
  await expect(link).toHaveAttribute('rel', /noopener/);
  expect(
    await page.evaluate(() => (window as Window & { hacked?: boolean }).hacked),
  ).toBeUndefined();
  await expect(page.locator('.asa-ai-rich-text script')).toHaveCount(0);
});

test('AI model picker uses only admin-allowed OpenAI models', async ({ page }) => {
  const fake = await fixture(page);
  await page.goto('/#/ai');
  const picker = page.getByRole('combobox', { name: 'Модель ИИ' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option')).toHaveCount(2);
  await picker.selectOption('gpt-4.1-mini');
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Выбранная модель');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  fake.release();
  await expect(page.getByText('Arduino — это платформа для электроники.')).toBeVisible();
  expect(fake.requests).toHaveLength(1);
  expect(fake.models).toEqual(['gpt-4.1-mini']);
});

for (const width of [1440, 600, 390, 320]) {
  test(`Admin tests the saved provider only with explicit paid consent at ${width}px`, async ({
    page,
  }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 800 });
    const tests: unknown[] = [];
    await page.route('**/api/admin/v1/ai/test', async (route) => {
      tests.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          provider: 'openai',
          model: 'gpt-5-mini',
          elapsedMs: 120,
          testedAt: NOW,
          configurationVersion: 2,
        },
      });
    });
    await page.goto('/#/admin/ai', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('group', { name: 'Доступные ИИ-провайдеры' })
      .getByRole('button', { name: /^OpenAI/ })
      .click();
    await page.getByRole('region', { name: 'Настройки OpenAI' }).waitFor();
    await page.getByLabel('Новый API-ключ').fill('sk-safe-test-value-not-real-key');
    const apply = page.getByRole('button', { name: 'Сохранить и проверить', exact: true });
    await expect(apply).toBeDisabled();
    await page.getByLabel('Разрешаю один платный запрос для проверки').check();
    await apply.click();
    await expect(page.getByText(/Подключено · OpenAI/)).toBeVisible();
    expect(tests).toEqual([{ acknowledgePaidRequest: true, configurationVersion: 2 }]);
    await expect(page.getByLabel('Разрешаю один платный запрос для проверки')).not.toBeChecked();
    await expect(apply).toBeDisabled();
    await page.getByLabel('Модель', { exact: true }).selectOption('gpt-4.1-mini');
    await expect(page.getByText(/Подключено · OpenAI/)).toHaveCount(0);
    await expect(apply).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`ai-admin-connection-${width}.png`),
      fullPage: true,
    });
  });
}


test('AI composer keeps one centered input and shows only real attachment tools', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const fake = await fixture(page);
  await page.goto('/#/ai');
  await expect(page.locator('.chat-toolbar')).toHaveCount(0);
  await expect(page.locator('.chat-history-filters')).toHaveCount(0);
  await expect(page.getByText('Чем помочь?')).toHaveCount(0);
  await expectChatFits(page);
  const tools = page.locator('details.chat-tools-menu');
  await tools.locator('summary').click();
  await expect(tools).toHaveAttribute('open', '');
  await expect(tools.getByRole('button', { name: 'Добавить изображение' })).toBeVisible();
  await expect(tools.getByRole('button', { name: 'Фото и файлы' })).toBeVisible();
  await expect(tools.getByRole('button', { name: /Поиск в интернете/ })).toBeDisabled();
  await expect(tools.getByRole('button', { name: /Создать изображение/ })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).click();
  await expect(tools).not.toHaveAttribute('open', '');
  await page.getByLabel('Выбрать файлы для ИИ').setInputFiles({
    name: 'lesson.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Arduino LED test', 'utf8'),
  });
  await expect(page.getByLabel('Выбранные вложения')).toContainText('lesson.txt');
  expect(fake.requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Удалить lesson.txt' }).click();
  await expect(page.getByLabel('Выбранные вложения')).toHaveCount(0);
});

test('AI shows no internal provider setup notice on the empty consumer screen', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/ai/status', async (route) => {
    await route.fulfill({
      json: {
        enabled: false,
        provider: 'ollama',
        model: 'ollama-local',
        availableModels: [],
        providerEnabled: false,
        reason: 'provider_missing',
      },
    });
  });
  await page.goto('/#/ai');
  await expect(page.locator('.chat-start-state')).toBeVisible();
  await expect(page.getByText('ИИ не подключён')).toHaveCount(0);
  await expect(page.getByText(/администратор должен|провайдер не настроен/i)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
});

test('AI composer frame and Send stay fully visible at ordinary viewport heights', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 750 });
  await fixture(page);
  await page.goto('/#/ai');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 750 });
    await expect(page.locator('.chat-start-state')).toBeVisible();
    await expectChatFits(page);
    const geometry = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>('.chat-composer-dock')!;
      const form = document.querySelector<HTMLFormElement>('form.chat-composer')!;
      const send = document.querySelector<HTMLButtonElement>('.chat-send-button')!;
      const dockBox = dock.getBoundingClientRect();
      const formBox = form.getBoundingClientRect();
      const sendBox = send.getBoundingClientRect();
      return {
        dockTop: dockBox.top,
        dockBottom: dockBox.bottom,
        formTop: formBox.top,
        formBottom: formBox.bottom,
        sendBottom: sendBox.bottom,
        dockScrollTop: dock.scrollTop,
        dockScrollHeight: dock.scrollHeight,
        dockClientHeight: dock.clientHeight,
      };
    });
    // The grid already reserves the toolbar. A second 52px subtraction once
    // clipped both the rounded composer border and the Send button.
    expect(geometry.formTop).toBeGreaterThanOrEqual(geometry.dockTop - 1);
    expect(geometry.formBottom).toBeLessThanOrEqual(geometry.dockBottom + 1);
    expect(geometry.sendBottom).toBeLessThanOrEqual(geometry.formBottom + 1);
    expect(geometry.dockScrollTop).toBe(0);
    expect(geometry.dockScrollHeight).toBeLessThanOrEqual(geometry.dockClientHeight + 1);
  }
});
