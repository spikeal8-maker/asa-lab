import { expect, test, type Page } from '@playwright/test';
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
    configurationVersion: 2,
    allowedDomains: [] as string[],
    blockedDomains: [] as string[],
    searchInstructions: '',
  };
  let conflict = false;
  const polzaWrites: Record<string, unknown>[] = [];
  let polza = {
    configurationVersion: 1,
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
          provider: 'ollama-cloud',
          model: 'gemma4:31b',
          enabled: true,
          apiKeyConfigured: true,
          paidOperationsPerHour: 5,
        }),
      );
    if (path === '/api/admin/v1/ai/polza' && request.method() === 'GET') return json(polza);
    if (path === '/api/admin/v1/ai/polza' && request.method() === 'PUT') {
      const input = request.postDataJSON() as Record<string, unknown>;
      polzaWrites.push(input);
      if (input.configurationVersion !== polza.configurationVersion)
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
        updatedAt: '2026-10-29T00:02:00.000Z',
      };
      return json(polza);
    }
    if (path === '/api/admin/v1/ai/polza/check')
      return json({ ready: true, latencyMs: 180, checkedAt: '2026-10-29T00:02:01.000Z' });
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
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
      'Интернет-поиск',
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
      .getByRole('button', { name: /^Ollama Cloud/ })
      .click();
    const cloudEligibility = page.getByRole('checkbox', {
      name: 'Разрешить у провайдера Gemma 4 31B · Ollama Cloud',
      exact: true,
    });
    const cloudVisibility = page.getByRole('checkbox', {
      name: 'Показывать пользователям: Gemma 4 31B · Ollama Cloud',
      exact: true,
    });
    await expect(cloudEligibility).toBeChecked();
    await expect(cloudVisibility).toHaveCount(0);
    await cloudEligibility.uncheck();
    await page.getByRole('button', { name: 'Сохранить модели подключения', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Запрос к модели не выполнялся.'),
    ).toBeVisible();
    expect(fixture.writes[1]).toMatchObject({
      configurationVersion: 4,
      defaultModel: 'deepseek-flash',
      allowedModels: ['deepseek-flash'],
      modelPreferences: expect.arrayContaining([{ id: 'gemma4:31b', eligible: false, order: 0 }]),
    });
    await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
    await expect(cloudVisibility).toHaveCount(0);
    await expect(
      page
        .getByRole('combobox', { name: 'Модель по умолчанию' })
        .locator('option[value="gemma4:31b"]'),
    ).toHaveCount(0);
    await page.getByRole('tab', { name: 'Подключения', exact: true }).click();
    await expect(cloudEligibility).not.toBeChecked();
    await cloudEligibility.check();
    await page.getByRole('button', { name: 'Сохранить модели подключения', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Запрос к модели не выполнялся.'),
    ).toBeVisible();
    expect(fixture.writes[2]).toMatchObject({
      configurationVersion: 5,
      defaultModel: 'deepseek-flash',
      allowedModels: ['deepseek-flash'],
      modelPreferences: expect.arrayContaining([{ id: 'gemma4:31b', eligible: true, order: 0 }]),
    });
    await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
    await expect(cloudEligibility).toHaveCount(0);
    await expect(cloudVisibility).not.toBeChecked();
    await cloudVisibility.check();
    await expect(cloudEligibility).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Модель по умолчанию' }).selectOption('gemma4:31b');
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
      defaultModel: 'gemma4:31b',
      allowedModels: ['gemma4:31b'],
      configurationVersion: 6,
      systemPrompt: expect.stringContaining('{{display_name}}'),
      requestId: expect.any(String),
    });
    await noOverflow(page);
    await normalView(page);
    await page.screenshot({ path: testInfo.outputPath(`models-${width}.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Интернет-поиск' }).click();
    await page.getByRole('textbox', { name: 'Разрешённые сайты' }).fill('example.org\nнаука.рф');
    await page.getByRole('textbox', { name: 'Исключённые сайты' }).fill('ads.example.org');
    await page
      .getByRole('textbox', { name: 'Инструкции для ответов с интернет-поиском' })
      .fill('Сравни первоисточники кратко и укажи ссылки.');
    await page.getByRole('button', { name: 'Сохранить поиск', exact: true }).click();
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
  await page.getByRole('checkbox', { name: 'Использовать Polza AI' }).check();
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(page.getByText('Подключение подтверждено', { exact: false })).toBeVisible();
  await expect(key).toHaveValue('');
  expect(fixture.polzaWrites).toHaveLength(1);
  expect(fixture.polzaWrites[0]?.apiKey).toBe('pza_fixture_polza_admin_20261029');

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await noOverflow(page);
      await expect(page.getByRole('heading', { name: 'Polza AI', exact: true })).toBeVisible();
      if (width <= 390) {
        const heights = await page.locator('.asa-ai-provider-card').evaluateAll((cards) =>
          cards.map((card) => card.getBoundingClientRect().height),
        );
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

  await page.getByRole('tab', { name: 'Транскрибация', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Транскрибация' })).toBeVisible();
  await expect(page.getByText('GigaAM-v3', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Голосовой ввод в чате' }).check();
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(
    page.getByText('Настройки транскрибации сохранены.', { exact: false }),
  ).toBeVisible();
  expect(fixture.polzaWrites).toHaveLength(2);
  expect(fixture.polzaWrites[1]?.transcriptionEnabled).toBe(true);

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
