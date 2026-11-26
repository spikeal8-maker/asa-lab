import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';
import { generationPolicyFixture } from '../apps/web/src/admin/testing/ai-generation-policy.fixture';

// This suite verifies the browser contract with fixtures; live acceptance is a separate run.
const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const WORKSPACE = '10000000-0000-4000-8000-000000000001';
const PRINCIPAL = '30000000-0000-4000-8000-000000000001';
const NOW = '2026-11-24T12:00:00.000Z';
const KEY = 'fixture-key-never-a-real-secret';
const MODEL = 'fixture-language-model';

async function fixture(page: Page) {
  let config = {
    enabled: false,
    baseUrl: 'http://fixture-server:8080',
    model: '',
    revision: 2,
    updatedAt: null as string | null,
    apiKeyConfigured: false,
    contextTokens: null as number | null,
    confirmedContextTokens: null as number | null,
    contextSource: 'unknown',
    toolsVerified: false,
    temperature: null as number | null,
    topP: null as number | null,
    maxOutputTokens: null as number | null,
  };
  let models = [{ id: MODEL, contextTokens: 32768 as number | null, tools: false }];
  let requiresKey = true;
  let offline = false;
  let rejectApply = false;
  let customPolicy = false;
  const discoveries: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const otherWrites: string[] = [];
  const chatModels: string[] = [];
  const pageErrors: string[] = [];
  const threads: { id: string; title: string; updatedAt: string }[] = [];
  const history: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
    requestId: string;
  }[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const normalize = (value: unknown) => {
    const text = String(value);
    return /^https?:\/\//.test(text)
      ? text.replace(/\/v1\/?$/, '').replace(/\/$/, '')
      : 'http://' + text + (text.includes(':') ? '' : ':8080');
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const respond = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    const error = (code: string, status: number) =>
      respond({ error: { code, message: 'fixture error' } }, status);
    if (path === '/api/auth/me')
      return respond({
        authenticated: true,
        user: { id: ACCOUNT, displayName: 'Администратор', email: 'admin@example.test' },
        account: { id: ACCOUNT, displayName: 'Администратор', email: 'admin@example.test' },
        capabilities: [{ capability: 'platform_admin', state: 'verified' }],
        workspaces: [{ workspaceId: WORKSPACE, kind: 'personal', title: 'Личное', role: 'owner' }],
        activeWorkspace: { workspaceId: WORKSPACE, kind: 'personal' },
        navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/admin/v1/me')
      return respond({
        administrator: true,
        principalId: PRINCIPAL,
        accountId: ACCOUNT,
        displayName: 'Администратор',
        activeWorkspaceId: WORKSPACE,
        scopes: [
          {
            kind: 'platform',
            id: null,
            title: 'ASA Lab',
            role: 'platform_admin',
            permissions: ['administration.open', 'administration.operations.read'],
          },
        ],
      });
    if (path === '/api/account/avatar') return respond({ avatarDataUrl: null });
    if (path === '/api/account/presentation')
      return respond({ motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/auth/max/status')
      return respond({ linked: false, promptDue: false, available: false });
    if (path === '/api/auth/max/config') return respond({ enabled: false, launchUrl: null });
    if (path === '/api/class-join/me') return respond({ authenticated: false });
    if (path === '/api/admin/v1/ai/llamacpp') return respond(config);
    if (path === '/api/admin/v1/ai/llamacpp/models') {
      const input = request.postDataJSON() as Record<string, unknown>;
      discoveries.push(input);
      if (offline) return error('ai_llamacpp_unreachable', 503);
      const endpoint = normalize(input.baseUrl);
      if (
        requiresKey &&
        input.apiKey !== KEY &&
        !(config.apiKeyConfigured && endpoint === config.baseUrl && !input.clearApiKey)
      )
        return error('ai_llamacpp_auth', 502);
      return respond({ baseUrl: endpoint, models });
    }
    if (path === '/api/admin/v1/ai/llamacpp/apply') {
      const input = request.postDataJSON() as Record<string, unknown>;
      writes.push(input);
      if (input.revision !== config.revision) return error('ai_llamacpp_config_changed', 409);
      if (input.enabled && (offline || rejectApply)) return error('ai_llamacpp_unreachable', 503);
      config = {
        ...config,
        enabled: Boolean(input.enabled),
        baseUrl: normalize(input.baseUrl),
        model: String(input.model),
        revision: config.revision + 1,
        updatedAt: NOW,
        apiKeyConfigured: Boolean(input.apiKey) || (config.apiKeyConfigured && !input.clearApiKey),
        contextTokens: input.contextTokens as number | null,
        confirmedContextTokens:
          models.find((entry) => entry.id === input.model)?.contextTokens ?? null,
        contextSource: 'metadata',
        temperature: input.temperature as number | null,
        topP: input.topP as number | null,
        maxOutputTokens: input.maxOutputTokens as number | null,
      };
      return respond({
        config,
        verified: config.enabled,
        test: config.enabled
          ? {
              model: config.model,
              contextTokens: config.confirmedContextTokens,
              toolsVerified: false,
            }
          : null,
      });
    }
    if (path === '/api/admin/v1/ai/ollama')
      return respond({
        enabled: true,
        baseUrl: 'http://ollama-fixture:11434',
        model: 'ollama-fixture-model',
        revision: 7,
        updatedAt: NOW,
        thinking: 'off',
        contextTokens: 8192,
      });
    if (path === '/api/admin/v1/ai/ollama/models')
      return respond({ models: [{ name: 'ollama-fixture-model', size: 1000000 }] });
    if (path === '/api/admin/v1/ai/ollama/model-detail')
      return respond({ capabilities: ['completion'], thinking: null, contextMax: 8192 });
    if (path === '/api/admin/v1/ai') {
      if (['PUT', 'PATCH', 'DELETE'].includes(method)) otherWrites.push(path);
      return respond(aiAdminFixture());
    }
    if (
      path === '/api/admin/v1/ai/generation-policy' ||
      path === '/api/admin/v1/ai/generation-policy/catalog'
    ) {
      if (['PUT', 'PATCH', 'DELETE'].includes(method)) otherWrites.push(path);
      const base = generationPolicyFixture();
      return respond({
        ...base,
        defaultModel: 'ollama-local',
        allowedModels: customPolicy ? ['ollama-local'] : ['ollama-local', 'llamacpp-local'],
        models: [
          ...base.models.map((row) =>
            row.provider === 'ollama' ? { ...row, ready: true, allowed: true } : row,
          ),
          {
            id: 'llamacpp-local',
            provider: 'llamacpp-local',
            label: 'llama.cpp · ' + (config.model || MODEL),
            ready: config.enabled,
            selectable: true,
            eligible: true,
            allowed: !customPolicy,
            connectionSelected: true,
            adapterCompatible: true,
            inputModalities: ['text'],
          },
        ],
      });
    }
    if (path === '/api/admin/v1/ai/token-budgets')
      return respond({
        configurationVersion: 1,
        resetAt: '2026-12-01T00:00:00.000Z',
        models: ['ollama-local', 'llamacpp-local'].map((model) => ({
          model,
          globalLimit: null,
          userLimit: null,
          used: '0',
          held: '0',
          unresolved: false,
          pendingUnknown: false,
        })),
      });
    if (path === '/api/ai/scopes') return respond({ personal: true, items: [] });
    if (path === '/api/ai/status')
      return respond({
        enabled: true,
        provider: 'ollama',
        model: 'ollama-local',
        ollamaModel: 'ollama-fixture-model',
        availableModels:
          config.enabled && !customPolicy ? ['ollama-local', 'llamacpp-local'] : ['ollama-local'],
        modelChoices: [
          { id: 'ollama-local', label: 'Ollama · ollama-fixture-model' },
          ...(config.enabled && !customPolicy
            ? [{ id: 'llamacpp-local', label: 'llama.cpp · ' + config.model }]
            : []),
        ],
      });
    if (path === '/api/ai/threads' && method === 'GET')
      return respond({ items: threads, nextCursor: null });
    if (path === '/api/ai/threads' && method === 'POST') {
      const id = randomUUID();
      threads.push({ id, title: 'Проверка llama.cpp', updatedAt: NOW });
      return respond({ id }, 201);
    }
    if (/\/api\/ai\/threads\/[^/]+\/messages(?:\/stream)?$/.test(path)) {
      if (method === 'GET') return respond({ items: history, nextCursor: null });
      const input = request.postDataJSON() as { model: string; message: string; requestId: string };
      chatModels.push(input.model);
      const messages = [
        {
          id: randomUUID(),
          role: 'user',
          content: input.message,
          createdAt: NOW,
          requestId: input.requestId,
        },
        {
          id: randomUUID(),
          role: 'assistant',
          content: 'Проверочный ответ llama.cpp в браузерном сценарии.',
          createdAt: NOW,
          requestId: input.requestId,
        },
      ];
      history.push(...messages);
      const event = (kind: string, data: unknown) =>
        `event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
      return route.fulfill({
        contentType: 'text/event-stream; charset=utf-8',
        body:
          event('delta', { text: messages[1]!.content }) +
          event('done', { messages, replayed: false, stopped: false }),
      });
    }
    if (path.startsWith('/api/admin/') && ['PUT', 'PATCH', 'DELETE'].includes(method))
      otherWrites.push(path);
    return respond({ items: [], enabled: false });
  });
  return {
    discoveries,
    writes,
    otherWrites,
    chatModels,
    pageErrors,
    current: () => config,
    setModels: (value: typeof models) => {
      models = value;
    },
    setRequiresKey: (value: boolean) => {
      requiresKey = value;
    },
    setOffline: (value: boolean) => {
      offline = value;
    },
    setRejectApply: (value: boolean) => {
      rejectApply = value;
    },
    setCustomPolicy: (value: boolean) => {
      customPolicy = value;
    },
  };
}

async function open(page: Page) {
  await page.goto('/#/admin/ai?section=connections&provider=llamacpp-local', {
    waitUntil: 'domcontentloaded',
  });
  const panel = page.getByRole('region', { name: 'Настройки llama.cpp', exact: true });
  await expect(panel.getByLabel('Адрес llama.cpp')).toBeEnabled();
  return panel;
}

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(page.locator('.portal-global-error')).toHaveCount(0);
}

for (const width of [1440, 1024, 390, 320]) {
  test(`llama.cpp IP discovery, protected save and independent Ollama fit ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    const fake = await fixture(page);
    const panel = await open(page);
    const providers = page.getByRole('group', { name: 'Доступные ИИ-провайдеры' });
    await expect(providers.locator('strong')).toHaveText([
      'Ollama',
      'llama.cpp',
      'Ollama Cloud',
      'DeepSeek',
      'OpenAI',
      'Polza AI',
    ]);
    await panel.getByLabel('Адрес llama.cpp').fill('192.0.2.30');
    await expect(panel.getByText('Сервер не принял API-ключ.', { exact: false })).toBeVisible();
    await panel.getByLabel('API-ключ llama.cpp', { exact: true }).fill(KEY);
    const model = panel
      .getByRole('group', { name: 'Модели llama.cpp' })
      .getByRole('button', { name: MODEL });
    await expect(model).toHaveAttribute('aria-pressed', 'true');
    await panel.getByLabel('Включить llama.cpp').check();
    await panel.getByRole('button', { name: 'Сохранить и проверить', exact: true }).click();
    await expect(panel.getByText('Сохранено · модель ответила на проверку')).toBeVisible();
    await expect(panel.getByLabel('API-ключ llama.cpp', { exact: true })).toHaveValue('');
    await expect(panel.getByLabel('Адрес llama.cpp')).toHaveValue('http://192.0.2.30:8080');
    await expect(model).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText('Доступно моделей: 1', { exact: true })).toBeVisible();
    expect(fake.current().model).toBe(MODEL);
    expect(fake.writes).toHaveLength(1);
    expect(fake.otherWrites).toEqual([]);
    await fits(page);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.screenshot({
      path: test.info().outputPath(`llamacpp-${width}.png`),
      fullPage: true,
    });
    await page.reload();
    await expect(panel.getByLabel('Включить llama.cpp')).toBeChecked();
    await expect(model).toHaveAttribute('aria-pressed', 'true');
    await providers
      .getByRole('button')
      .filter({ has: page.getByText('Ollama', { exact: true }) })
      .click();
    await expect(page.getByLabel('Адрес Ollama')).toHaveValue('http://ollama-fixture:11434');
    expect(fake.otherWrites).toEqual([]);
    expect(fake.pageErrors).toEqual([]);
    await fits(page);
  });
}

test('changing the endpoint drops the typed key before auto-discovery and failed apply preserves saved settings', async ({
  page,
}) => {
  const fake = await fixture(page);
  const panel = await open(page);
  await panel.getByLabel('API-ключ llama.cpp', { exact: true }).fill(KEY);
  await expect(panel.getByRole('group', { name: 'Модели llama.cpp' })).toBeVisible();
  await panel.getByLabel('Адрес llama.cpp').fill('new-fixture-server:8080');
  await expect(panel.getByLabel('API-ключ llama.cpp', { exact: true })).toHaveValue('');
  await expect(panel.getByText('Сервер не принял API-ключ.', { exact: false })).toBeVisible();
  const switched = fake.discoveries.filter((input) => input.baseUrl === 'new-fixture-server:8080');
  expect(switched.length).toBeGreaterThan(0);
  expect(switched.every((input) => !input.apiKey && !input.apiKeyEndpoint)).toBe(true);
  await panel.getByLabel('API-ключ llama.cpp', { exact: true }).fill(KEY);
  await expect(panel.getByRole('group', { name: 'Модели llama.cpp' })).toBeVisible();
  await panel.getByLabel('Включить llama.cpp').check();
  fake.setRejectApply(true);
  await panel.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(panel.getByText('Нет связи с сервером llama.cpp.', { exact: false })).toBeVisible();
  expect(fake.current()).toMatchObject({
    enabled: false,
    baseUrl: 'http://fixture-server:8080',
    revision: 2,
  });
  expect(await page.locator('body').innerText()).not.toContain(KEY);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(KEY);
});

test('multiple models, unknown context, long labels and offline disabling stay usable at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 950 });
  const fake = await fixture(page);
  fake.setRequiresKey(false);
  const longName = 'модель-для-длинных-текстов-и-учебных-задач-с-длинным-названием';
  fake.setModels([
    { id: MODEL, contextTokens: 32768, tools: false },
    { id: longName, contextTokens: null, tools: false },
  ]);
  const panel = await open(page);
  await expect(panel.getByRole('group', { name: 'Модели llama.cpp' })).toBeVisible();
  await panel.getByLabel('Включить llama.cpp').check();
  await expect(panel.getByRole('button', { name: 'Сохранить и проверить' })).toBeDisabled();
  await panel.getByRole('button', { name: longName }).click();
  await panel.getByText('Параметры генерации', { exact: true }).click();
  await panel.getByLabel('Лимит контекста llama.cpp').fill('8192');
  await panel.getByLabel('Максимальный ответ llama.cpp').fill('1024');
  await expect(panel.getByText('Лимит задан администратором;', { exact: false })).toBeVisible();
  await fits(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({ path: test.info().outputPath('llamacpp-long-320.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(panel.getByText('Сохранено · модель ответила на проверку')).toBeVisible();
  fake.setOffline(true);
  await page.reload();
  await expect(panel.getByText('Нет связи с сервером llama.cpp.', { exact: false })).toBeVisible();
  await panel.getByLabel('Включить llama.cpp').uncheck();
  await panel.getByRole('button', { name: 'Выключить и сохранить' }).click();
  await expect(panel.getByText('llama.cpp выключен · рабочие параметры сохранены')).toBeVisible();
  expect(fake.current()).toMatchObject({ enabled: false, model: longName, contextTokens: 8192 });
});

test('saved model joins policy, budgets and chat without switching the existing default', async ({
  page,
}) => {
  const fake = await fixture(page);
  fake.setRequiresKey(false);
  const panel = await open(page);
  await expect(panel.getByRole('group', { name: 'Модели llama.cpp' })).toBeVisible();
  await panel.getByLabel('Включить llama.cpp').check();
  await panel.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(panel.getByText('Сохранено · модель ответила на проверку')).toBeVisible();
  await panel.getByText('Подключение и доступ в чате', { exact: true }).click();
  await panel.getByRole('link', { name: 'Разрешённые модели' }).click();
  await expect(page.getByLabel('Показывать пользователям: llama.cpp · ' + MODEL)).toBeChecked();
  await expect(page.getByLabel('Общий лимит llamacpp-local', { exact: true })).toBeVisible();
  expect(fake.otherWrites).toEqual([]);
  await fits(page);
  await page.goto('/#/ai');
  const chooser = page.getByRole('button', { name: 'Модель ИИ', exact: true });
  await expect(chooser).toContainText('Ollama');
  await chooser.click();
  await page.getByRole('option', { name: 'llama.cpp · ' + MODEL, exact: true }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Проверочный вопрос');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(
    page.getByText('Проверочный ответ llama.cpp в браузерном сценарии.', { exact: true }),
  ).toBeVisible();
  expect(fake.chatModels).toEqual(['llamacpp-local']);
  expect(fake.pageErrors).toEqual([]);
});

test('saving a connection does not widen a custom allowlist and empty discovery has one explanation', async ({
  page,
}) => {
  const fake = await fixture(page);
  fake.setRequiresKey(false);
  fake.setCustomPolicy(true);
  const panel = await open(page);
  await expect(panel.getByRole('group', { name: 'Модели llama.cpp' })).toBeVisible();
  await panel.getByLabel('Включить llama.cpp').check();
  await panel.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(panel.getByText('Сохранено · модель ответила на проверку')).toBeVisible();
  await panel.getByText('Подключение и доступ в чате', { exact: true }).click();
  await panel.getByRole('link', { name: 'Разрешённые модели' }).click();
  await expect(page.getByLabel('Показывать пользователям: llama.cpp · ' + MODEL)).not.toBeChecked();
  expect(fake.otherWrites).toEqual([]);
  fake.setModels([]);
  await open(page);
  await expect(panel.getByText('Модели не найдены', { exact: true })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Сохранить и проверить' })).toBeDisabled();
});
