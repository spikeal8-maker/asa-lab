import { expect, test, type Page } from '@playwright/test';
import { AI_TOOL_IDS, AI_TOOL_LABELS } from '../packages/contracts/src/ai-tools';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';
import { generationPolicyFixture } from '../apps/web/src/admin/testing/ai-generation-policy.fixture';

async function adminFixture(page: Page) {
  let policy = generationPolicyFixture();
  let search = {
    schemaVersion: 1,
    provider: 'searxng',
    enabled: true,
    configured: true,
    weatherConfigured: true,
    weatherEnabled: true,
    operationsPerHour: 100,
    resultsLimit: 8,
    pagesLimit: 2,
    pageCharLimit: 4500,
    configurationVersion: 2,
    allowedDomains: [] as string[],
    blockedDomains: [] as string[],
    searchInstructions: '',
  };
  let conflict = false;
  const polzaWrites: Record<string, unknown>[] = [];
  let polzaCatalogReady = false;
  const polzaModels = [
    ['chat', 'Polza Text'],
    ['image', 'Polza Image'],
    ['stt', 'Polza Speech'],
    ['video', 'Polza Video'],
  ].map(([kind, label]) => ({
    id: 'polza/fixture/' + kind,
    upstream: 'fixture/' + kind,
    label,
    kind,
    active: true,
    selected: false,
    vision: false,
    tools: false,
    catalogMonth: '2026-10',
  }));
  let polza = {
    configurationVersion: 1,
    textConfigurationVersion: 1,
    paidOperationsPerHour: 0,
    enabled: false,
    transcriptionEnabled: false,
    dailySecondsLimit: 600,
    globalDailySecondsLimit: 7200,
    maxAudioSeconds: 20,
    apiKeyConfigured: false,
    keyFingerprint: null as string | null,
    updatedAt: '2026-10-29T00:00:00.000Z',
    encryptionReady: true,
  };
  const writes: Record<string, unknown>[] = [];
  const errors: string[] = [];
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
    if (path === '/api/admin/v1/ai')
      return json(
        aiAdminFixture({
          provider: 'openai',
          model: 'gpt-6-luna',
          enabled: true,
          apiKeyConfigured: true,
          paidOperationsPerHour: 5,
        }),
      );
    if (path === '/api/admin/v1/ai/openai/catalog')
      return json({
        models: [
          {
            id: 'gpt-6-luna',
            name: 'GPT-6 Luna',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            contextTokens: null,
          },
        ],
      });
    if (path === '/api/admin/v1/ai/polza' && request.method() === 'GET') return json(polza);
    if (path === '/api/admin/v1/ai/polza' && request.method() === 'PUT') {
      const input = request.postDataJSON() as Record<string, unknown>;
      polzaWrites.push(input);
      if (
        input.configurationVersion !== polza.configurationVersion ||
        (input.textConfigurationVersion !== undefined &&
          input.textConfigurationVersion !== polza.textConfigurationVersion)
      )
        return json({ error: { code: 'ai_polza_conflict', message: 'Settings changed' } }, 409);
      polza = {
        ...polza,
        enabled: Boolean(input.enabled),
        transcriptionEnabled: Boolean(input.transcriptionEnabled),
        dailySecondsLimit: Number(input.dailySecondsLimit),
        globalDailySecondsLimit: Number(input.globalDailySecondsLimit),
        maxAudioSeconds: Number(input.maxAudioSeconds),
        apiKeyConfigured: Boolean(input.apiKey) || (polza.apiKeyConfigured && !input.clearApiKey),
        keyFingerprint: input.apiKey ? 'test-fingerprint' : polza.keyFingerprint,
        configurationVersion: polza.configurationVersion + 1,
        paidOperationsPerHour: Number(input.paidOperationsPerHour ?? polza.paidOperationsPerHour),
        textConfigurationVersion: polza.textConfigurationVersion + 1,
        updatedAt: '2026-10-29T00:02:00.000Z',
      };
      return json(polza);
    }
    if (path === '/api/admin/v1/ai/polza/check')
      return json({ ready: true, latencyMs: 180, checkedAt: '2026-10-29T00:02:01.000Z' });
    if (
      path === '/api/admin/v1/ai/polza/models' ||
      path === '/api/admin/v1/ai/polza/models/refresh'
    ) {
      if (request.method() === 'POST' && polza.apiKeyConfigured) {
        polzaCatalogReady = true;
        polza = { ...polza, textConfigurationVersion: polza.textConfigurationVersion + 1 };
      }
      if (request.method() === 'PUT') {
        const { ids } = request.postDataJSON() as { ids: string[] };
        for (const model of polzaModels) model.selected = ids.includes(model.id);
      }
      return json({
        version: polzaCatalogReady ? 2 : 1,
        checkedAt: polzaCatalogReady ? '2026-10-29T00:02:01.000Z' : null,
        credentialCurrent: polzaCatalogReady,
        items: polzaCatalogReady ? polzaModels : [],
      });
    }
    if (path === '/api/admin/v1/ai/ollama-cloud/keys' && request.method() === 'GET')
      return json({
        configurationVersion: 1,
        managed: true,
        models: [
          { id: 'gemma4:31b', model: 'gemma4:31b', active: true, capabilities: ['completion'] },
        ],
        keys: [1, 2, 3, 4, 5].map((slot) => ({
          slot,
          label: 'Key ' + slot,
          priority: slot,
          enabled: slot === 1,
          configured: slot === 1,
          fingerprint: slot === 1 ? 'fixture-hash' : null,
          models: slot === 1 ? ['gemma4:31b'] : [],
          account: null,
          blockedUntil: null,
          unavailableModels: [],
        })),
      });
    if (path === '/api/admin/v1/ai/ollama')
      return json({
        enabled: false,
        model: 'gemma4:12b',
        baseUrl: 'http://127.0.0.1:11434',
        revision: 1,
        updatedAt: null,
      });
    if (path === '/api/admin/v1/ai/tool-policy')
      return json({
        schemaVersion: 1,
        configurationVersion: 1,
        tools: AI_TOOL_IDS.map((id) => ({
          id,
          label: AI_TOOL_LABELS[id],
          enabled: true,
          instructions: '',
          available: true,
          reason: null,
          parameters: ['query'],
          usageDescription: 'По запросу пользователя',
          resultDescription: 'Проверенный результат',
          hardLimits: ['Проверка доступа на сервере'],
        })),
      });
    if (path === '/api/ai/status')
      return json({
        enabled: true,
        canGenerate: true,
        model: 'ollama',
        modelChoices: [{ id: 'ollama', label: 'Локальная тестовая модель' }],
      });
    if (path === '/api/admin/v1/ai/images')
      return json({
        configurationVersion: 1,
        enabled: false,
        dailyLimit: 10,
        globalConcurrency: 1,
        sizes: [768],
        ready: false,
        reason: 'disabled',
        recipe: 'flux2-klein-4b-v1',
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
    if (path === '/api/admin/v1/ai/generation-policy/catalog') return json(policy);
    if (path === '/api/admin/v1/ai/token-budgets')
      return json({ configurationVersion: 1, resetAt: '2026-11-01T00:00:00.000Z', models: [] });
    if (path === '/api/admin/v1/ai/generation-policy') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        writes.push(body);
        if (conflict || body.configurationVersion !== policy.configurationVersion)
          return json({ error: { code: 'changed', message: 'private server detail' } }, 409);
        policy = {
          ...policy,
          systemPrompt: body.systemPrompt,
          defaultModel: body.defaultModel,
          allowedModels: body.allowedModels,
          modelPreferences: body.modelPreferences,
          models: policy.models.map((model) => ({
            ...model,
            eligible:
              body.modelPreferences?.find((entry: { id: string }) => entry.id === model.id)
                ?.eligible ??
              model.eligible ??
              true,
          })),
          providerOrder: body.providerOrder,
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
    return json({ items: [], meta: { total: 0 } });
  });
  return {
    writes,
    polzaWrites,
    errors,
    conflict: () => {
      conflict = true;
    },
  };
}

async function normalView(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      fits: document.documentElement.scrollWidth <= width + 1,
      offenders: [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 && box.right > width + 1 && getComputedStyle(element).position !== 'fixed'
          );
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          label: element.getAttribute('aria-label'),
          right: element.getBoundingClientRect().right,
        })),
    };
  });
  expect(overflow.fits, JSON.stringify(overflow.offenders)).toBe(true);
}

for (const width of [1440, 1024, 390, 320]) {
  test(`AI prompt, model policy and internet settings remain usable at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await adminFixture(page);
    await page.goto('/#/admin/ai');
    await expect(page.getByRole('tablist', { name: 'Разделы ИИ' }).getByRole('tab')).toHaveText([
      'Обзор',
      'Настройки',
      'Подключения',
      'Системный промпт',
      'Инструменты',
      'Изображения',
      'Видео',
      'Транскрибация',
    ]);
    await page.getByRole('tab', { name: 'Системный промпт', exact: true }).click();
    const guideLink = page.getByRole('button', {
      name: 'Как работают промпт, переменные и инструменты',
    });
    await expect(guideLink).toBeVisible();
    await guideLink.click();
    await expect(page).toHaveURL(/\/#\/admin\/ai\?section=prompt&provider=ollama$/);
    await expect(
      page.getByRole('heading', {
        name: 'Как работают системный промпт, переменные и инструменты',
      }),
    ).toBeVisible();
    await expect(page.locator('#ai-prompt-guide-title')).toBeFocused();
    const prompt = page.getByRole('textbox', { name: 'Инструкции помощнику' });
    await prompt.fill(
      'Отвечай кратко и по делу, без повторения вопроса. Полный запрошенный код давай одним файлом. Имя: ',
    );
    await prompt.press('End');
    await page.getByRole('button', { name: 'Вставить Имя пользователя', exact: true }).click();
    await expect(prompt).toHaveValue(/\{\{display_name\}\}$/);
    await page.getByRole('button', { name: 'Описание: Местоположение' }).focus();
    await expect(page.getByRole('tooltip').filter({ hasText: 'Местоположение' })).toBeVisible();
    await expect(page.getByRole('tooltip').filter({ hasText: 'Местоположение' })).toContainText(
      'Не предоставлено',
    );
    await noOverflow(page);
    await normalView(page);
    await page.screenshot({ path: testInfo.outputPath(`prompt-${width}.png`), fullPage: true });
    // Confirm the prompt before navigating: pending edits must never be discarded implicitly.
    await page.getByRole('button', { name: 'Сохранить промпт', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Запрос к модели не выполнялся.'),
    ).toBeVisible();
    expect(fixture.writes[0]).toMatchObject({
      configurationVersion: 3,
      systemPrompt: expect.stringContaining('{{display_name}}'),
    });
    await page.getByRole('tab', { name: 'Подключения', exact: true }).click();
    await page
      .getByRole('group', { name: 'Доступные ИИ-провайдеры' })
      .getByRole('button', { name: /^OpenAI/ })
      .click();
    const cloudEligibility = page.getByRole('checkbox', {
      name: 'GPT-6 Luna',
      exact: true,
    });
    const cloudVisibility = page.getByRole('checkbox', {
      name: 'Показывать пользователям: GPT-6 Luna',
      exact: true,
    });
    await expect(cloudEligibility).toBeChecked();
    await expect(cloudVisibility).toHaveCount(0);
    await cloudEligibility.uncheck();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(fixture.writes[1]).toMatchObject({
      configurationVersion: 4,
      defaultModel: 'deepseek-flash',
      allowedModels: ['deepseek-flash'],
      modelPreferences: expect.arrayContaining([{ id: 'gpt-6-luna', eligible: false, order: 0 }]),
    });
    await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
    await expect(cloudVisibility).toHaveCount(0);
    await expect(
      page
        .getByRole('combobox', { name: 'Модель по умолчанию' })
        .locator('option[value="gpt-6-luna"]'),
    ).toHaveCount(0);
    await page.getByRole('tab', { name: 'Подключения', exact: true }).click();
    await expect(cloudEligibility).not.toBeChecked();
    await cloudEligibility.check();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(fixture.writes[2]).toMatchObject({
      configurationVersion: 5,
      defaultModel: 'deepseek-flash',
      allowedModels: ['deepseek-flash'],
      modelPreferences: expect.arrayContaining([{ id: 'gpt-6-luna', eligible: true, order: 0 }]),
    });
    await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
    await expect(cloudEligibility).toHaveCount(0);
    await expect(cloudVisibility).not.toBeChecked();
    await cloudVisibility.check();
    await expect(cloudEligibility).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Модель по умолчанию' }).selectOption('gpt-6-luna');
    await page
      .getByRole('checkbox', { name: 'Показывать пользователям: DeepSeek Flash', exact: true })
      .uncheck();
    await expect(
      page.getByRole('checkbox', { name: 'Разрешить у провайдера DeepSeek Flash', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Запрос к модели не выполнялся.'),
    ).toBeVisible();
    expect(fixture.writes[3]).toMatchObject({
      defaultModel: 'gpt-6-luna',
      allowedModels: ['gpt-6-luna'],
      configurationVersion: 6,
      systemPrompt: expect.stringContaining('{{display_name}}'),
      requestId: expect.any(String),
    });
    await noOverflow(page);
    await normalView(page);
    await page.screenshot({ path: testInfo.outputPath(`models-${width}.png`), fullPage: true });
    await page
      .getByRole('tablist', { name: 'Разделы ИИ' })
      .getByRole('tab', { name: 'Инструменты', exact: true })
      .click();
    await expect(page.getByRole('textbox', { name: 'Разрешённые сайты' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Проверить инструмент' })).toBeEnabled();
    await noOverflow(page);
    await normalView(page);
    await page.screenshot({
      path: testInfo.outputPath(`tools-compact-${width}.png`),
      fullPage: true,
    });
    await page.getByText('Фильтры и ответы по источникам', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Разрешённые сайты' }).fill('example.org\nнаука.рф');
    await page.getByRole('textbox', { name: 'Исключённые сайты' }).fill('ads.example.org');
    await page
      .getByRole('textbox', { name: 'Инструкции для ответов с интернет-поиском' })
      .fill('Сравни первоисточники кратко и укажи ссылки.');
    await page.getByRole('button', { name: 'Сохранить параметры сети', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Поисковый запрос не выполнялся.'),
    ).toBeVisible();
    expect(fixture.writes[4]).toMatchObject({
      allowedDomains: ['example.org', 'наука.рф'],
      blockedDomains: ['ads.example.org'],
      weatherEnabled: true,
    });
    await noOverflow(page);
    await normalView(page);
    await page.screenshot({
      path: testInfo.outputPath(`search-policy-${width}.png`),
      fullPage: true,
    });
    for (const id of AI_TOOL_IDS) {
      await page
        .getByRole('tablist', { name: 'Инструменты помощника' })
        .getByRole('tab', { name: AI_TOOL_LABELS[id], exact: true })
        .click();
      await expect(
        page
          .getByRole('tabpanel', { name: AI_TOOL_LABELS[id], exact: true })
          .getByRole('heading', { name: AI_TOOL_LABELS[id], exact: true }),
      ).toBeVisible();
      await noOverflow(page);
    }
    await page.getByRole('tab', { name: 'Изображения', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Изображения', exact: true })).toBeVisible();
    await noOverflow(page);
    expect(fixture.errors).toEqual([]);
  });
}

test('AI prompt conflict retains text and prevents a stale save', async ({ page }) => {
  const fixture = await adminFixture(page);
  await page.goto('/#/admin/ai');
  await page.getByRole('tab', { name: 'Системный промпт', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Инструкции помощнику' })
    .fill('Несохранённая редакция администратора.');
  fixture.conflict();
  await page.getByRole('button', { name: 'Сохранить промпт' }).click();
  await expect(page.getByRole('textbox', { name: 'Инструкции помощнику' })).toHaveValue(
    'Несохранённая редакция администратора.',
  );
  await expect(page.getByRole('button', { name: 'Сохранить промпт' })).toBeDisabled();
  await expect(page.getByText('private server detail')).toHaveCount(0);
  await expect(
    page
      .getByRole('region', { name: 'Системный промпт' })
      .getByRole('alert')
      .filter({ hasText: 'Настройки изменились. Загрузите актуальную версию перед сохранением.' })
      .getByRole('button', { name: 'Загрузить актуальные настройки' }),
  ).toBeVisible();
});

test('AI section tabs support arrow, Home and End keyboard navigation', async ({ page }) => {
  await adminFixture(page);
  await page.goto('/#/admin/ai');
  const connections = page.getByRole('tab', { name: 'Подключения', exact: true });
  await connections.focus();
  await connections.press('End');
  const transcription = page.getByRole('tab', { name: 'Транскрибация', exact: true });
  await expect(transcription).toBeFocused();
  await expect(transcription).toHaveAttribute('aria-selected', 'true');
  await transcription.press('ArrowLeft');
  const video = page.getByRole('tab', { name: 'Видео', exact: true });
  await expect(video).toBeFocused();
  await expect(video).toHaveAttribute('aria-selected', 'true');
  await video.press('Home');
  const overview = page.getByRole('tab', { name: 'Обзор', exact: true });
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await overview.press('ArrowRight');
  const settings = page.getByRole('tab', { name: 'Настройки', exact: true });
  await expect(settings).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Модель по умолчанию' })).toBeVisible();
  await settings.press('Home');
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute('aria-selected', 'true');
});

test('Polza admin connection and transcription stay compact on desktop and mobile', async ({
  page,
}, testInfo) => {
  test.slow();
  const fixture = await adminFixture(page);
  await page.goto('/#/admin/ai?section=connections&provider=polza');
  await expect(page.getByRole('heading', { name: 'Polza AI', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  const key = page.getByLabel('API-ключ Polza AI');
  await key.fill('pza_fixture_polza_admin_20261029');
  await page.getByRole('checkbox', { name: 'Включено' }).check();
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(page.getByText('Подключение подтверждено', { exact: false })).toBeVisible();
  await expect(key).toHaveValue('');
  expect(fixture.polzaWrites).toHaveLength(1);
  expect(fixture.polzaWrites[0]?.apiKey).toBe('pza_fixture_polza_admin_20261029');
  await expect(page.getByRole('checkbox', { name: 'В настройки: Polza Text' })).toBeVisible();
  await page.getByLabel('Общий лимит платных запросов в час').fill('5');
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(page.getByText('Подключение подтверждено', { exact: false })).toBeVisible();
  expect(fixture.polzaWrites[1]).toMatchObject({
    paidOperationsPerHour: 5,
    textConfigurationVersion: 3,
  });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await noOverflow(page);
      await expect(page.getByRole('heading', { name: 'Polza AI', exact: true })).toBeVisible();
      if (width <= 390) {
        const heights = await page
          .locator('.asa-ai-provider-card')
          .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
        expect(Math.max(...heights)).toBeLessThanOrEqual(94);
      }
      if (colorScheme === 'dark') {
        await expect(page.locator('.asa-polza-confirmed')).toHaveCSS('color', 'rgb(131, 212, 181)');
      }
      await page.screenshot({
        path: testInfo.outputPath('polza-' + width + '-' + colorScheme + '.png'),
        fullPage: true,
      });
    }
  }

  const categories = page.getByRole('group', { name: 'Категории моделей Polza' });
  for (const [category, label] of [
    ['Изображения', 'Polza Image'],
    ['Видео', 'Polza Video'],
    ['Транскрибация', 'Polza Speech'],
  ]) {
    await categories.getByRole('button', { name: category, exact: true }).click();
    await page.getByRole('checkbox', { name: 'Выбрать: ' + label }).check();
    await expect(page.locator('time[datetime="2026-10"]')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Сохранить выбор моделей' }).click();
  await expect(page.getByText('Выбор моделей сохранён.')).toBeVisible();

  for (const [tab, model] of [
    ['Изображения', 'Polza Image'],
    ['Видео', 'Polza Video'],
    ['Транскрибация', 'Polza Speech'],
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByText(model, { exact: true })).toBeVisible();
    await expect(page.getByText('Polza Text', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(model, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Транскрибация' })).toBeVisible();
  await expect(page.getByText('GigaAM-v3', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Голосовой ввод в чате' }).check();
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(
    page.getByText('Настройки транскрибации сохранены.', { exact: false }),
  ).toBeVisible();
  expect(fixture.polzaWrites).toHaveLength(3);
  expect(fixture.polzaWrites[2]?.transcriptionEnabled).toBe(true);

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath('transcription-' + width + '-' + colorScheme + '.png'),
        fullPage: true,
      });
    }
  }
  await page.getByText('Подробнее о лимитах и HTTPS').click();
  await expect(
    page.getByText('Резервируется максимальная длина записи', { exact: false }),
  ).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

for (const width of [1440, 1024, 390, 320]) {
  test(`AI selected tool probe reports real activity and empty evidence at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await adminFixture(page);
    let sends = 0;
    await page.route('**/api/ai/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/ai/status')
        return route.fulfill({
          json: {
            enabled: true,
            model: 'ollama',
            modelChoices: [{ id: 'ollama', label: 'Тестовая локальная модель' }],
          },
        });
      if (path === '/api/ai/threads')
        return route.fulfill({ json: { id: '10000000-0000-4000-8000-000000000001' } });
      if (route.request().method() === 'PATCH') return route.fulfill({ json: {} });
      if (path.endsWith('/messages/stream')) {
        sends++;
        const input = route.request().postDataJSON();
        const evidence = {
          schemaVersion: 1,
          provider: 'searxng',
          mode: 'web',
          status: 'empty',
          query: 'Проверка',
          retrievedAt: '2026-11-03T00:00:00Z',
          sources: [],
          images: [],
        };
        const frame = (event: string, value: unknown) =>
          `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
        return route.fulfill({
          contentType: 'text/event-stream',
          body:
            frame('activity', { tool: 'web_search', state: 'running' }) +
            frame('activity', { tool: 'web_search', state: 'complete' }) +
            frame('done', {
              messages: [
                {
                  role: 'assistant',
                  requestId: input.requestId,
                  content: 'По запросу ничего не найдено.',
                  webSearch: evidence,
                },
              ],
              replayed: false,
              stopped: false,
            }),
        });
      }
      return route.fulfill({
        status: 404,
        json: { error: { code: 'missing', message: 'Not used' } },
      });
    });
    await page.goto('/#/admin/ai?section=tools');
    const panel = page.getByRole('region', { name: 'Проверка инструмента', exact: true });
    await panel
      .getByRole('textbox', { name: 'Запрос для проверки' })
      .fill('Проверка пустой выдачи');
    await panel.getByRole('button', { name: 'Проверить инструмент', exact: true }).click();
    await expect(
      panel.getByText('Инструмент вернул пустую выдачу.', { exact: true }),
    ).toBeVisible();
    expect(sends).toBe(1);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`probe-${width}.png`), fullPage: true });
  });
}
