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
  const threadId = '70000000-0000-4000-8000-000000000001';
  let requestId = '';
  let state = 'admitted';
  let uncertain = false;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMfoAAAAASUVORK5CYII=',
    'base64',
  );
  const image = () => ({
    requestId,
    width: 512,
    height: 512,
    mimeType: 'image/png',
    sizeBytes: png.length,
    downloadUrl: '/ignore/untrusted-url',
  });
  let imageConfig = {
    configurationVersion: 1,
    enabled: true,
    dailyLimit: 10,
    globalConcurrency: 1,
    sizes: [512, 768, 1024],
    ready: true,
    reason: null,
    recipe: 'flux2-klein-4b-v1',
  };

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
    if (path === '/api/admin/v1/ai/comfyui/status')
      return json({
        connected: true,
        baseUrl: 'http://127.0.0.1:8188',
        version: '0.42.1',
        diffusionModels: ['flux-2-klein-4b-fp8.safetensors'],
        textEncoders: ['qwen_3_4b_fp4_flux2.safetensors'],
        vaeModels: ['flux2-vae.safetensors'],
        fluxKlein4bFound: true,
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
      if (uncertain) return route.abort();
      return json({
        threadId,
        requestId,
        state,
        prompt: body.prompt,
        createdAt: '2026-10-26T00:00:00Z',
        cancelRequested: false,
        errorCode: null,
        image: null,
      });
    }
    if (path.includes('/image-generations/')) {
      imageReads.push(path);
      if (path.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: png });
      if (path.endsWith('/cancel')) state = 'cancelled';
      return json({
        threadId,
        requestId,
        state,
        prompt: 'Птица на дереве',
        createdAt: '2026-10-26T00:00:00Z',
        cancelRequested: false,
        errorCode: null,
        image: state === 'complete' ? image() : null,
      });
    }
    return json({ items: [], meta: { total: 0 } });
  });
  return {
    writes,
    errors,
    imagePosts,
    imageReads,
    complete: () => {
      state = 'complete';
    },
    fail: () => {
      state = 'failed';
    },
    uncertain: () => {
      uncertain = true;
    },
    threadId,
    conflict: () => {
      conflict = true;
    },
  };
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}
for (const width of [1440, 1024, 390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`local image generation and settings at ${width} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => localStorage.setItem('asa-ai-chat-theme', value), theme);
      const fixture = await imageFixture(page);
      await page.goto('/#/ai');
      await page.getByLabel('Инструменты чата').click();
      await page.getByRole('button', { name: 'Создать изображение', exact: true }).click();
      const mode = page.getByRole('region', { name: 'Создать изображение' });
      await page
        .getByRole('textbox', { name: 'Описание изображения' })
        .fill(
          'Птица на дереве. Подробное русское описание с длинным текстом для проверки формы изображения.',
        );
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`image-mode-${width}-${theme}.png`) });
      await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
      await expect(page.getByText('Задание принято. Ожидаем GPU…')).toBeVisible();
      expect(fixture.imagePosts).toHaveLength(1);
      fixture.complete();
      await expect(page.getByRole('img', { name: 'Созданное изображение' })).toBeVisible({
        timeout: 18000,
      });
      await expect(page.getByRole('button', { name: 'Новый вариант ответа' })).toHaveCount(0);
      const download = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Скачать PNG' }).click();
      expect((await download).suggestedFilename()).toMatch(/^asa-image-.*\.png$/);
      await mode.getByRole('button', { name: 'К текстовому чату' }).click();
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
  await page.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await page.getByRole('textbox', { name: 'Описание изображения' }).fill('Птица на дереве');
  await page
    .getByRole('region', { name: 'Создать изображение' })
    .getByRole('button', { name: 'Создать изображение', exact: true })
    .click();
  await expect.poll(() => fixture.imagePosts.length).toBe(1);
  await page.reload();
  if (await page.getByRole('button', { name: 'Открыть историю' }).isVisible())
    await page.getByRole('button', { name: 'Открыть историю' }).click();
  await page.getByRole('button', { name: 'Локальные изображения', exact: true }).click();
  await expect(page.getByText('Задание принято. Ожидаем GPU…')).toBeVisible();
  expect(fixture.imagePosts).toHaveLength(1);
  expect(fixture.imageReads.length).toBeGreaterThan(0);
});
test('an older image API leaves text tools intact and generation disabled', async ({ page }) => {
  await imageFixture(page);
  await page.route('**/api/ai/image-generation/status', (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'missing' } } }),
  );
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await expect(
    page.getByRole('button', { name: 'Создать изображение', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Фото и файлы', exact: true })).toBeEnabled();
});
test('a cancelled image job is never labelled complete', async ({ page }) => {
  const fixture = await imageFixture(page);
  await page.goto('/#/ai');
  await page.getByLabel('Инструменты чата').click();
  await page.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await page.getByRole('textbox', { name: 'Описание изображения' }).fill('Птица на дереве');
  const mode = page.getByRole('region', { name: 'Создать изображение' });
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expect(page.getByText('Задание принято. Ожидаем GPU…')).toBeVisible();
  await mode.getByRole('button', { name: 'Отменить задание', exact: true }).click();
  await expect(page.getByText('Задание отменено.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Созданное изображение' })).toHaveCount(0);
  expect(fixture.imagePosts).toHaveLength(1);
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
  await page.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  const mode = page.getByRole('region', { name: 'Создать изображение' });
  await page.getByRole('textbox', { name: 'Описание изображения' }).fill('Птица на дереве');
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expect(mode.getByText('Размер больше не разрешён.', { exact: true })).toBeVisible();
  await expect(
    mode.getByRole('button', { name: 'Создать изображение', exact: true }),
  ).toBeEnabled();
  expect(fixture.imagePosts).toHaveLength(0);
  await mode.getByRole('button', { name: 'Создать изображение', exact: true }).click();
  await expect(page.getByText('Задание принято. Ожидаем GPU…')).toBeVisible();
  expect(attempted).toHaveLength(2);
  expect(attempted[1]!.requestId).not.toBe(attempted[0]!.requestId);
  expect(fixture.imagePosts).toHaveLength(1);
});
