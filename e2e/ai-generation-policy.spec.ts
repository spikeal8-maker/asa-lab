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
    if (path === '/api/admin/v1/ai') return json(aiAdminFixture());
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
        sizes: [512],
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
    return json({ items: [], meta: { total: 0 } });
  });
  return {
    writes,
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
      'Подключения',
      'Изображения',
      'Системный промпт',
      'Настройки',
      'Интернет-поиск',
    ]);
    await page.getByRole('tab', { name: 'Системный промпт', exact: true }).click();
    const guideLink = page.getByRole('button', {
      name: 'Как работают промпт, переменные и инструменты',
    });
    await expect(guideLink).toBeVisible();
    await guideLink.click();
    await expect(page).toHaveURL(/\/#\/admin\/ai$/);
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
    await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Gemma 4 31B · Ollama Cloud' }).check();
    await page.getByRole('combobox', { name: 'Модель по умолчанию' }).selectOption('gemma4:31b');
    await page.getByRole('checkbox', { name: 'DeepSeek Flash' }).uncheck();
    await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Запрос к модели не выполнялся.'),
    ).toBeVisible();
    expect(fixture.writes[0]).toMatchObject({
      defaultModel: 'gemma4:31b',
      allowedModels: ['gemma4:31b'],
      configurationVersion: 3,
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
    expect(fixture.writes[1]).toMatchObject({
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
  const internet = page.getByRole('tab', { name: 'Интернет-поиск', exact: true });
  await expect(internet).toBeFocused();
  await expect(internet).toHaveAttribute('aria-selected', 'true');
  await internet.press('ArrowLeft');
  const settings = page.getByRole('tab', { name: 'Настройки', exact: true });
  await expect(settings).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Модель по умолчанию' })).toBeVisible();
  await settings.press('Home');
  await expect(connections).toBeFocused();
  await expect(connections).toHaveAttribute('aria-selected', 'true');
});
