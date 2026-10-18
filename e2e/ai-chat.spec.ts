import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';

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
}

async function fixture(page: Page, answer = 'Arduino — это платформа для электроники.') {
  const threads: { id: string; title: string; updatedAt: string }[] = [];
  const messages = new Map<string, Message[]>();
  const requests: string[] = [];
  const requestThreads: string[] = [];
  const models: string[] = [];
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
      if (method === 'GET') return respond(route, { items: history, nextCursor: null });
      const streamed = path.endsWith('/stream');
      const sse = (kind: string, value: unknown) =>
        'event: ' + kind + '\n' + 'data: ' + JSON.stringify(value) + '\n\n';
      const payload = req.postDataJSON() as { message: string; requestId: string; model?: string };
      requests.push(payload.requestId);
      requestThreads.push(id);
      models.push(payload.model ?? '');
      if (!history.some((msg) => msg.role === 'user' && msg.requestId === payload.requestId)) {
        history.push({
          id: randomUUID(),
          role: 'user',
          content: payload.message,
          createdAt: NOW,
          requestId: payload.requestId,
        });
        threads.find((t) => t.id === id)!.title = payload.message;
        await waitForAnswer;
        history.push({
          id: randomUUID(),
          role: 'assistant',
          content: answer,
          createdAt: NOW,
          requestId: payload.requestId,
        });
      }
      const result = { messages: history, replayed: requests.length > 1, stopped: false };
      if (streamed) {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream; charset=utf-8',
          body: sse('delta', { text: history.at(-1)?.content ?? '' }) + sse('done', result),
        });
      }
      return respond(route, result);
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
      return respond(route, {
        enabled,
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKeyConfigured: hasKey,
        paidOperationsPerHour: 1000,
        encryptionReady: true,
        keyFingerprint: hasKey ? 'abcdef123456' : null,
        configurationVersion: hasKey ? 2 : 1,
        updatedAt: NOW,
      });
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
    submittedKey: () => keyWasSubmitted,
  };
}

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

for (const width of [1440, 1024, 390, 320]) {
  test(`AI text chat shows pending, model reply and saved history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 750 });
    const fake = await fixture(page);
    await page.goto('/#/ai');
    await expect(page.getByRole('heading', { name: 'Чем я могу помочь?' })).toBeVisible();
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

test('Platform admin configures GPT without returning secret in page', async ({ page }) => {
  await fixture(page);
  await page.goto('/#/admin/ai');
  await expect(page.getByRole('heading', { name: 'ИИ и модели' })).toBeVisible();
  await expect(page.getByText('Не задан', { exact: true })).toBeVisible();
  const secret = 'sk-ai-fake-test-secret-safe-value';
  await page.getByLabel(/Новый API-ключ/).fill(secret);
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(
    page.getByText('Настройки сохранены. Новый API-ключ не возвращается в браузер.'),
  ).toBeVisible();
  await expect(page.getByText('Настроен', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Чем я могу помочь?' })).toBeVisible();
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

for (const width of [1440, 390, 320]) {
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
    await page.goto('/#/admin/ai');
    const verify = page.getByRole('button', { name: 'Проверить подключение', exact: true });
    await expect(verify).toBeDisabled();
    await page.getByLabel(/Новый API-ключ/).fill('sk-safe-test-value-not-real-key');
    await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await expect(page.getByText('Настроен', { exact: true })).toBeVisible();
    expect(tests).toHaveLength(0);
    await expect(verify).toBeDisabled();
    await page.getByLabel('Подтверждаю один платный проверочный запрос').check();
    await verify.click();
    await expect(page.getByText(/Модель gpt-5-mini ответила/)).toBeVisible();
    expect(tests).toEqual([{ acknowledgePaidRequest: true, configurationVersion: 2 }]);
    await expect(verify).toBeDisabled();
    await page.getByLabel('Модель', { exact: true }).selectOption('gpt-4.1-mini');
    await expect(page.getByText(/Модель gpt-5-mini ответила/)).toHaveCount(0);
    await expect(verify).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`ai-admin-connection-${width}.png`),
      fullPage: true,
    });
  });
}
