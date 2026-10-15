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

async function fixture(page: Page) {
  const threads: { id: string; title: string; updatedAt: string }[] = [];
  const messages = new Map<string, Message[]>();
  const requests: string[] = [];
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
      return respond(route, { enabled, provider: 'openai', model: 'gpt-5-mini' });
    if (path === '/api/ai/threads' && method === 'GET') return respond(route, { items: threads });
    if (path === '/api/ai/threads' && method === 'POST') {
      const id = randomUUID();
      threads.unshift({ id, title: 'Новый чат', updatedAt: NOW });
      messages.set(id, []);
      return respond(route, { id }, 201);
    }
    const chat = /^\/api\/ai\/threads\/([a-f0-9-]+)\/messages$/.exec(path);
    if (chat) {
      const id = chat[1]!;
      const history = messages.get(id);
      if (!history)
        return respond(route, { error: { code: 'ai_thread_denied', message: 'Not found' } }, 404);
      if (method === 'GET') return respond(route, { items: history });
      const payload = req.postDataJSON() as { message: string; requestId: string };
      requests.push(payload.requestId);
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
          content: 'Arduino — это платформа для электроники.',
          createdAt: NOW,
          requestId: payload.requestId,
        });
      }
      return respond(route, { messages: history, replayed: requests.length > 1 });
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
    submittedKey: () => keyWasSubmitted,
  };
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
    await page.getByRole('button', { name: 'Что такое Arduino?' }).click();
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
