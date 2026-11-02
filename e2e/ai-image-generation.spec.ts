import {
  AI_IMAGE_PRESETS,
  type AiImageGenerationJob,
  type AiImageJobState,
} from '../packages/contracts/src/ai-image-generation';
import { expect, test, type Page } from '@playwright/test';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';
import { generationPolicyFixture } from '../apps/web/src/admin/testing/ai-generation-policy.fixture';

async function imageFixture(page: Page) {
  let policy = generationPolicyFixture();
  let search = {
    schemaVersion: 1,
    provider: 'searxng',
    enabled: true,
    configured: true,
    weatherConfigured: true,
    weatherEnabled: true,
    operationsPerHour: 100,
    configurationVersion: 2,
    allowedDomains: [] as string[],
    blockedDomains: [] as string[],
    searchInstructions: '',
  };
  let conflict = false;
  const writes: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const imagePosts: Record<string, unknown>[] = [];
  const imageReads: string[] = [];
  const imageCancels: { method: string; path: string }[] = [];
  const threadId = '70000000-0000-4000-8000-000000000001';
  let requestId = '';
  let state: AiImageJobState = 'admitted';
  let acceptedPrompt = 'Птица на дереве';
  let queuePaused = false;
  let uncertain = false;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfoAAAAASUVORK5CYII=',
    'base64',
  );
  const image = () => ({
    requestId,
    width: 512,
    height: 512,
    mimeType: 'image/png' as const,
    sizeBytes: png.length,
    downloadUrl: '/ignore/untrusted-url',
  });
  let imageConfig = {
    configurationVersion: 1,
    enabled: true,
    dailyLimit: 10,
    globalConcurrency: 1,
    sizes: AI_IMAGE_PRESETS.map((p) => p.id),
    ready: true,
    reason: null,
    recipe: 'flux2-klein-4b-v1',
  };
  const receipt = (): AiImageGenerationJob => ({
    threadId,
    requestId,
    state,
    prompt: acceptedPrompt,
    createdAt: '2026-10-26T00:00:00Z',
    cancelRequested: state === 'cancelled',
    queuePaused: state === 'admitted' && queuePaused,
    errorCode: null,
    image: state === 'complete' ? image() : null,
  });

  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === '/api/auth/me')
      return json({
        authenticated: true,
        account: {
          id: '20000000-0000-4000-8000-000000000001',
          displayName: 'Администратор',
          email: 'admin@example.test',
        },
        user: {
          id: '20000000-0000-4000-8000-000000000001',
          displayName: 'Администратор',
          email: 'admin@example.test',
        },
        capabilities: [{ capability: 'platform_admin', state: 'verified' }],
        workspaces: [
          {
            workspaceId: '10000000-0000-4000-8000-000000000001',
            kind: 'personal',
            title: 'Личное',
            role: 'owner',
          },
        ],
        activeWorkspace: { workspaceId: '10000000-0000-4000-8000-000000000001', kind: 'personal' },
        navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/admin/v1/me')
      return json({
        administrator: true,
        principalId: '30000000-0000-4000-8000-000000000001',
        accountId: '20000000-0000-4000-8000-000000000001',
        displayName: 'Администратор',
        activeWorkspaceId: '10000000-0000-4000-8000-000000000001',
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
    if (path === '/api/account/presentation')
      return json({ motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/account/avatar') return json({ avatarDataUrl: null });
    if (path === '/api/class-join/me') return json({ authenticated: false });
    if (path === '/api/auth/max/status')
      return json({
        linked: false,
        verifiedAt: null,
        firstAuthenticatedAt: null,
        promptDue: false,
        promptDismissedUntil: null,
        available: false,
      });
    if (path === '/api/auth/max/config') return json({ enabled: false, launchUrl: null });
    if (path === '/api/admin/v1/ai') return json(aiAdminFixture());
    if (path === '/api/admin/v1/ai/ollama')
      return json({
        enabled: false,
        model: 'gemma4:12b',
        baseUrl: 'http://127.0.0.1:11434',
        revision: 1,
        updatedAt: null,
      });
    if (path === '/api/admin/v1/ai/comfyui/settings')
      return json({
        configurationVersion: 2,
        baseUrl: 'http://192.168.1.112:8188',
        source: 'saved',
      });
    if (path === '/api/admin/v1/ai/comfyui/status')
      return json({
        connected: true,
        baseUrl: 'http://192.168.1.112:8188',
        version: '0.19.3',
        diffusionModels: ['flux-2-klein-4b-fp8.safetensors'],
        textEncoders: ['qwen_3_4b_fp4_flux2.safetensors'],
        vaeModels: ['flux2-vae.safetensors'],
        fluxKlein4bFound: true,
        recipe: 'flux2-klein-4b-v1',
        recipeReady: true,
        recipeReason: null,
        devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 3060', vramTotalBytes: 12 * 1024 ** 3 }],
        checkedAt: '2026-10-26T09:00:00Z',
      });
    if (path === '/api/admin/v1/ai/generation-policy') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        writes.push(body);
        if (conflict)
          return json({ error: { code: 'changed', message: 'private server detail' } }, 409);
        policy = {
          ...policy,
          systemPrompt: body.systemPrompt,
          defaultModel: body.defaultModel,
          allowedModels: body.allowedModels,
          configurationVersion: policy.configurationVersion + 1,
        };
      }
      return json(policy);
    }
    if (path === '/api/admin/v1/ai/web-search') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        writes.push(body);
        search = { ...search, ...body, configurationVersion: search.configurationVersion + 1 };
      }
      return json(search);
    }

    if (path === '/api/admin/v1/ai/images') {
      if (request.method() === 'PUT') {
        writes.push(request.postDataJSON());
        imageConfig = {
          ...imageConfig,
          ...request.postDataJSON(),
          configurationVersion: imageConfig.configurationVersion + 1,
        };
      }
      return json(imageConfig);
    }
    if (path === '/api/ai/scopes') return json({ personal: true, items: [] });
    if (path === '/api/ai/status')
      return json({
        enabled: false,
        model: '',
        availableModels: [],
        reason: 'ai_provider_unconfigured',
      });
    if (path === '/api/ai/image-generation/status')
      return json({ ...imageConfig, remainingToday: 10 });
    if (path === '/api/ai/threads')
      return request.method() === 'POST'
        ? json({ id: threadId })
        : json({
            items: [
              { id: threadId, title: 'Локальные изображения', updatedAt: '2026-10-26T00:00:00Z' },
            ],
          });
    if (path.endsWith('/messages'))
      return json({
        items:
          state === 'complete'
            ? [
                {
                  id: 'u1',
                  role: 'user',
                  content: 'Птица на дереве',
                  createdAt: '2026-10-26T00:00:00Z',
                  requestId,
                  generationKind: 'image',
                },
                {
                  id: 'a1',
                  role: 'assistant',
                  content: 'Изображение создано.',
                  createdAt: '2026-10-26T00:00:01Z',
                  requestId,
                  generationKind: 'image',
                  generatedImages: [image()],
                },
              ]
            : [],
      });
    if (path.endsWith('/image-generations') && request.method() === 'POST') {
      const body = request.postDataJSON();
      imagePosts.push(body);
      requestId = body.requestId;
      acceptedPrompt = body.prompt;
      if (uncertain) return route.abort();
      return json(receipt());
    }
    if (path.includes('/image-generations/')) {
      if (request.method() === 'GET') imageReads.push(path);
      if (path.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: png });
      if (path.endsWith('/cancel')) {
        imageCancels.push({ method: request.method(), path });
        state = 'cancelled';
      }
      return json(receipt());
    }
    return json({ items: [], meta: { total: 0 } });
  });
  return {
    writes,
    errors,
    imagePosts,
    imageReads,
    imageCancels,
    complete: () => {
      state = 'complete';
    },
    fail: () => {
      state = 'failed';
    },
    uncertain: () => {
      uncertain = true;
    },
    pauseQueue: (paused = true) => {
      queuePaused = paused;
    },
    threadId,
    conflict: () => {
      conflict = true;
    },
  };
}

const QUEUED = 'В очереди. Изображение начнёт создаваться, когда освободится видеокарта.';
async function expectQueued(page: Page) {
  const notice = page.getByRole('status').filter({ hasText: QUEUED });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(QUEUED);
  await expect(page.getByRole('button', { name: 'Отменить задание', exact: true })).toBeEnabled();
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toHaveCount(0);
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}
test('image tab never widens the mobile viewport during keyboard navigation', async ({ page }) => {
  await imageFixture(page);
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/#/admin/ai?section=overview');
  await page.getByRole('tab', { name: 'Обзор', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Транскрибация', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowLeft'); // Видео
  await page.keyboard.press('ArrowLeft'); // Изображения
  await expect(page.getByRole('tab', { name: 'Изображения', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offending: Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 1 && bounds.left < innerWidth && bounds.right > innerWidth + 1;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  expect(layout.scrollWidth, JSON.stringify(layout.offending)).toBeLessThanOrEqual(layout.viewport);
});

test('image workbench: responsive settings and an explicit preview', async ({ page }) => {
  const fixture = await imageFixture(page);
  await page.goto('/#/admin/ai?section=comfyui');

  const local = page.getByRole('tab', { name: 'ComfyUI', exact: true });
  const api = page.getByRole('tab', { name: 'API-провайдеры' });
  await expect(local).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Пробная генерация' })).toBeVisible();
  await expect(page.getByLabel('Состояние локальной генерации')).toContainText('RTX 3060');

  for (const width of [3840, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.getByRole('heading', { name: 'Настройки генерации' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Адрес ComfyUI' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Разрешённые размеры' })).toBeVisible();
    const technicalDetails = page.locator('.asa-image-diagnostics');
    await expect(technicalDetails).toHaveCount(1);
    await expect(technicalDetails).not.toHaveAttribute('open');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await noOverflow(page);
      await page.screenshot({
        path: test.info().outputPath('image-workbench-' + width + '-os-' + scheme + '.png'),
        fullPage: true,
      });
    }
  }

  await api.click();
  await expect(api).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Polza AI' })).toBeVisible();
  await expect(page.getByText('Не подключён')).toBeVisible();
  expect(fixture.imagePosts).toHaveLength(0);

  await local.click();
  await page
    .getByRole('textbox', { name: 'Описание тестового изображения' })
    .fill('Школьный робот на светлом фоне');
  await page.getByRole('button', { name: 'Сгенерировать' }).click();
  await expect.poll(() => fixture.imagePosts.length).toBe(1);
  expect(fixture.imagePosts[0]).toMatchObject({
    prompt: 'Школьный робот на светлом фоне',
    size: 1024,
  });
  fixture.complete();
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toBeVisible({
    timeout: 18000,
  });
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath('image-workbench-result.png'),
    fullPage: true,
  });
});

test('image intent is a removable token in the same input and preserves the draft', async ({
  page,
}) => {
  const fixture = await imageFixture(page);
  await page.goto('/#/ai');
  const input = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await input.fill('Робот на белом фоне');
  const originalInput = await input.elementHandle();
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  await expect(input).toHaveValue('Робот на белом фоне');
  expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
  await page.getByRole('combobox', { name: 'Размер изображения' }).selectOption('1024');
  await page.getByRole('button', { name: 'Убрать изображение из запроса' }).click();
  await expect(input).toHaveValue('Робот на белом фоне');
  await expect(page.getByRole('combobox', { name: 'Размер изображения' })).toHaveCount(0);
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  await input.press('Control+Home');
  await input.press('Backspace');
  await expect(input).toHaveValue('Робот на белом фоне');
  await expect(page.getByRole('combobox', { name: 'Размер изображения' })).toHaveCount(0);
  expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
  expect(fixture.imagePosts).toHaveLength(0);
});

test('explicit image mode routes one GPU job without a text-model request', async ({ page }) => {
  const fixture = await imageFixture(page);
  const textPosts: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/messages(?:\/stream)?$/.test(new URL(request.url()).pathname)
    )
      textPosts.push(request.url());
  });
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Нарисуй кота на белом фоне');
  await page
    .getByRole('region', { name: 'Создать изображение' })
    .getByRole('button', { name: 'Создать изображение', exact: true })
    .click();
  await expect.poll(() => fixture.imagePosts.length).toBe(1);
  expect(fixture.imagePosts[0]?.prompt).toBe('Нарисуй кота на белом фоне');
  expect(textPosts).toEqual([]);
  await expect(page.getByRole('button', { name: 'Отменить задание', exact: true })).toBeVisible();
  fixture.complete();
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toBeVisible({
    timeout: 18000,
  });
  expect(fixture.imagePosts).toHaveLength(1);
  expect(textPosts).toEqual([]);
});

test('image Auto sends a native image-tool allowance from plain chat without opening tools', async ({
  page,
}) => {
  const fixture = await imageFixture(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        provider: 'ollama',
        model: 'ollama-local',
        availableModels: ['ollama-local'],
        nativeImageTools: ['ollama-local'],
      },
    }),
  );
  await page.route('**/api/ai/threads/*/messages/stream', (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      contentType: 'text/event-stream; charset=utf-8',
      body: 'event: done\ndata: {"messages":[],"replayed":false,"stopped":false}\n\n',
    });
  });
  await page.goto('/#/ai');
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Нарисуй кота на белом фоне');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    message: 'Нарисуй кота на белом фоне',
    model: 'ollama-local',
    nativeImage: { mode: 'auto', size: 1024 },
  });
  expect(fixture.imagePosts).toHaveLength(0);
});

for (const width of [1440, 1024, 390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`local image generation and settings at ${width} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => localStorage.setItem('asa-ai-chat-theme', value), theme);
      const fixture = await imageFixture(page);
      await page.goto('/#/ai');
      await page.getByLabel('Инструменты чата').click();
      await page.getByRole('button', { name: 'Изображение', exact: true }).click();
      const mode = page.getByRole('region', { name: 'Создать изображение' });
      await page
        .getByRole('textbox', { name: 'Сообщение ИИ' })
        .fill(
          'Птица на дереве. Подробное русское описание с длинным текстом для проверки формы изображения.',
        );
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`image-mode-${width}-${theme}.png`) });
      await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
      await expectQueued(page);
      expect(fixture.imagePosts).toHaveLength(1);
      fixture.complete();
      await expect(page.getByRole('img', { name: 'Созданное изображение' })).toBeVisible({
        timeout: 18000,
      });
      await expect(page.getByRole('button', { name: 'Новый вариант ответа' })).toHaveCount(0);
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: /^Скачать изображение ·/u }).click();
      expect((await download).suggestedFilename()).toMatch(/^asa-image-.*\.png$/);
      await mode.getByRole('button', { name: 'Убрать изображение из запроса' }).click();
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`image-complete-${width}-${theme}.png`) });
      await page.goto('/#/admin/ai');
      await page.getByRole('tab', { name: 'Изображения', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Изображения', exact: true })).toBeVisible();
      await page.getByRole('checkbox', { name: 'Разрешить создание изображений' }).uncheck();
      await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
      await expect(page.getByText('Настройки сохранены. Генерация не запускалась.')).toBeVisible();
      expect(fixture.imagePosts).toHaveLength(1);
      await noOverflow(page);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: testInfo.outputPath(`image-admin-${width}-${theme}.png`),
        fullPage: true,
      });
      expect(fixture.errors).toEqual([]);
    });
  }
}
test('unknown image POST resumes with GET only after reload', async ({ page }) => {
  const fixture = await imageFixture(page);
  fixture.uncertain();
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Птица на дереве');
  await page
    .getByRole('region', { name: 'Создать изображение' })
    .getByRole('button', { name: 'Создать изображение', exact: true })
    .click();
  await expect.poll(() => fixture.imagePosts.length).toBe(1);
  await page.reload();
  if (await page.getByRole('button', { name: 'Открыть историю' }).isVisible())
    await page.getByRole('button', { name: 'Открыть историю' }).click();
  await page.getByRole('button', { name: 'Локальные изображения', exact: true }).click();
  await expectQueued(page);
  expect(fixture.imagePosts).toHaveLength(1);
  expect(fixture.imageReads.length).toBeGreaterThan(0);
  expect(fixture.imageCancels).toHaveLength(0);
});
test('an older image API leaves text tools intact and generation disabled', async ({ page }) => {
  await imageFixture(page);
  await page.route('**/api/ai/image-generation/status', (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'missing' } } }),
  );
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await expect(page.getByRole('button', { name: 'Изображение', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Фото и файлы', exact: true })).toBeEnabled();
});
test('a cancelled image job is never labelled complete', async ({ page }) => {
  const fixture = await imageFixture(page);
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Птица на дереве');
  const mode = page.getByRole('region', { name: 'Создать изображение' });
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expectQueued(page);
  await mode.getByRole('button', { name: 'Отменить задание', exact: true }).click();
  await expect(page.getByText('Задание отменено.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toHaveCount(0);
  expect(fixture.imagePosts).toHaveLength(1);
});

test('a queued image clears its pause notice by GET and stays cancellable on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const fixture = await imageFixture(page);
  fixture.pauseQueue();
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Птица на дереве');
  const mode = page.getByRole('region', { name: 'Создать изображение' });
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Очередь приостановлена' })).toHaveText(
    'Очередь приостановлена: проверяем неопределённый результат генерации. Задание можно отменить.',
  );
  await expect(mode.getByRole('button', { name: 'Отменить задание', exact: true })).toBeEnabled();
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toHaveCount(0);
  await noOverflow(page);
  expect(fixture.imagePosts).toHaveLength(1);
  expect(fixture.imageCancels).toHaveLength(0);
  const reads = fixture.imageReads.length;
  fixture.pauseQueue(false);
  await expectQueued(page);
  expect(fixture.imageReads.length).toBeGreaterThan(reads);
  expect(fixture.imagePosts).toHaveLength(1);
  await mode.getByRole('button', { name: 'Отменить задание', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Задание отменено.' })).toHaveText(
    'Задание отменено.',
  );
  expect(fixture.imageCancels).toEqual([
    {
      method: 'POST',
      path: `/api/ai/threads/${fixture.threadId}/image-generations/${fixture.imagePosts[0]!.requestId}/cancel`,
    },
  ]);
  expect(fixture.imagePosts).toHaveLength(1);
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});
test('a confirmed rejected first image POST permits an explicit corrected request with a new UUID', async ({
  page,
}) => {
  const fixture = await imageFixture(page);
  const attempted: Record<string, unknown>[] = [];
  await page.route('**/api/ai/threads/*/image-generations', async (route) => {
    const input = route.request().postDataJSON();
    attempted.push(input);
    if (attempted.length === 1)
      return route.fulfill({
        status: 400,
        json: { error: { code: 'ai_image_not_admitted', message: 'Размер больше не разрешён.' } },
      });
    return route.fallback();
  });
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Изображение', exact: true }).click();
  const mode = page.getByRole('region', { name: 'Создать изображение' });
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Птица на дереве');
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expect(mode.getByText('Размер больше не разрешён.', { exact: true })).toBeVisible();
  await expect(
    mode.getByRole('button', { name: 'Создать изображение', exact: true }),
  ).toBeEnabled();
  expect(fixture.imagePosts).toHaveLength(0);
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expectQueued(page);
  expect(attempted).toHaveLength(2);
  expect(attempted[1]!.requestId).not.toBe(attempted[0]!.requestId);
  expect(fixture.imagePosts).toHaveLength(1);
});
test('two saved image cards retain native previews and downloads after history reload', async ({
  page,
}) => {
  const fixture = await imageFixture(page);
  const requests = ['20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012'];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfoAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('**/api/ai/threads/*/messages', (route) =>
    route.fulfill({
      json: {
        items: requests.map((requestId, index) => ({
          id: 'saved-' + index,
          role: 'assistant',
          content: 'Изображение создано.',
          createdAt: '2026-10-26T00:00:01Z',
          requestId,
          generationKind: 'image',
          generatedImages: [
            {
              requestId,
              width: 512,
              height: 512,
              mimeType: 'image/png',
              sizeBytes: png.length,
              downloadUrl: 'https://untrusted.invalid/image',
            },
          ],
        })),
      },
    }),
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0,
    maximum = 0,
    reads = 0,
    busyResponses = 0;
  await page.route('**/api/ai/threads/*/image-generations/*/image', async (route) => {
    reads += 1;
    if (active) {
      busyResponses += 1;
      return route.fulfill({
        status: 429,
        json: { error: { code: 'ai_image_busy', message: 'busy' } },
      });
    }
    active += 1;
    maximum = Math.max(maximum, active);
    try {
      if (reads === 1) await held;
      await route.fulfill({ contentType: 'image/png', body: png });
    } finally {
      active -= 1;
    }
  });
  try {
    await page.goto('/#/ai');
    await page.getByRole('button', { name: 'Локальные изображения', exact: true }).click();
    await expect.poll(() => reads).toBe(1);
    release();
    await expect(page.getByRole('link', { name: /^Скачать изображение ·/u })).toHaveCount(2);
    await expect(page.getByRole('img', { name: 'Созданное изображение' })).toHaveCount(2);
    expect(maximum).toBe(1);
    expect(busyResponses).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'Локальные изображения', exact: true }).click();
    await expect(page.getByRole('link', { name: /^Скачать изображение ·/u })).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const download = page.waitForEvent('download');
      await page
        .getByRole('link', { name: /^Скачать изображение ·/u })
        .nth(index)
        .click();
      expect((await download).suggestedFilename()).toBe('asa-image-' + requests[index] + '.png');
    }
    expect(reads).toBe(4);
    expect(busyResponses).toBe(0);
    expect(maximum).toBe(1);
    expect(fixture.imagePosts).toHaveLength(0);
    expect(fixture.errors).toEqual([]);
  } finally {
    release();
  }
});
