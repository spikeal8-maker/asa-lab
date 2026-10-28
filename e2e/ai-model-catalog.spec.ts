import { expect, test, type Page } from '@playwright/test';
import type { AiOllamaCloudPool, AiOllamaCloudKeyUpdate } from '@asa-lab/contracts';
import type { AiAdminConfig, AiProvider } from '../apps/web/src/admin/ai-model-config';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2026-10-19T12:00:00.000Z';

async function adminFixture(page: Page, initial = aiAdminFixture()) {
  let config = structuredClone(initial);
  const writes: Record<string, unknown>[] = [];
  const paidTests: unknown[] = [];
  const poolWrites: { configurationVersion: number; keys: AiOllamaCloudKeyUpdate[] }[] = [];
  let pool: AiOllamaCloudPool = {
    configurationVersion: config.configurationVersion,
    managed: false,
    models: config.modelCatalog.models
      .filter((model) => model.provider === 'ollama-cloud')
      .map((model) => ({
        id: model.id,
        model: model.id,
        active: true,
        capabilities: ['completion'],
      })),
    keys: Array.from({ length: 5 }, (_, index) => ({
      slot: index + 1,
      label: 'Ключ ' + (index + 1),
      priority: index + 1,
      enabled: false,
      configured: false,
      fingerprint: null,
      models: [],
      account: null,
      blockedUntil: null,
      unavailableModels: [],
    })),
  };
  const ollamaWrites: Record<string, unknown>[] = [];
  const ollamaDiscoveries: Record<string, unknown>[] = [];
  const ollamaTests: Record<string, unknown>[] = [];
  let ollama = {
    enabled: false,
    baseUrl: 'http://127.0.0.1:11434',
    model: 'gemma4:12b',
    revision: 1,
    updatedAt: null as string | null,
  };
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/auth/me')
      return route.fulfill({
        json: {
          authenticated: true,
          user: { id: ACCOUNT_ID, displayName: 'Администратор', email: 'admin@example.test' },
          account: { id: ACCOUNT_ID, displayName: 'Администратор', email: 'admin@example.test' },
          capabilities: [{ capability: 'platform_admin', state: 'verified' }],
          workspaces: [
            { workspaceId: WORKSPACE_ID, kind: 'personal', title: 'Личное', role: 'owner' },
          ],
          activeWorkspace: { workspaceId: WORKSPACE_ID, kind: 'personal' },
          navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
          timeZone: 'Europe/Moscow',
        },
      });
    if (path === '/api/admin/v1/me')
      return route.fulfill({
        json: {
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
        },
      });
    if (path === '/api/account/avatar') return route.fulfill({ json: { avatarDataUrl: null } });
    if (path === '/api/account/presentation')
      return route.fulfill({ json: { motion: 'system', sidebar: 'expanded', revision: 0 } });
    if (path === '/api/auth/max/status')
      return route.fulfill({
        json: {
          linked: false,
          verifiedAt: null,
          firstAuthenticatedAt: null,
          promptDue: false,
          promptDismissedUntil: null,
          available: false,
        },
      });
    if (path === '/api/auth/max/config')
      return route.fulfill({ json: { enabled: false, launchUrl: null } });
    if (path === '/api/class-join/me') return route.fulfill({ json: { authenticated: false } });
    if (path === '/api/admin/v1/ai/ollama/models') {
      ollamaDiscoveries.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        json: {
          models: [
            { name: 'ornith:9b', size: 7_654_321 },
            { name: 'gemma4:12b', size: 8_765_432 },
          ],
        },
      });
    }
    if (path === '/api/admin/v1/ai/comfyui/status') {
      return route.fulfill({
        json: {
          connected: true,
          baseUrl: 'http://host.docker.internal:8188',
          version: '0.42.1',
          diffusionModels: ['flux-2-klein-4b-fp8.safetensors'],
          textEncoders: ['qwen_3_4b_fp4_flux2.safetensors'],
          vaeModels: ['flux2-vae.safetensors'],
          fluxKlein4bFound: true,
          checkedAt: NOW,
        },
      });
    }
    if (path === '/api/admin/v1/ai/ollama/apply') {
      const input = request.postDataJSON() as Record<string, unknown>;
      if (input['revision'] !== ollama.revision) {
        return route.fulfill({
          status: 409,
          json: { error: { code: 'ai_ollama_config_changed', message: 'Настройки изменились.' } },
        });
      }
      const exists = ['ornith:9b', 'gemma4:12b'].includes(String(input['model']));
      if (input['enabled'] && !exists) {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'ai_ollama_model_missing', message: 'Модель не установлена.' } },
        });
      }
      ollamaWrites.push(input);
      ollama = {
        enabled: input['enabled'] === true,
        baseUrl: String(input['baseUrl']),
        model: String(input['model']),
        revision: ollama.revision + 1,
        updatedAt: NOW,
      };
      if (ollama.enabled) ollamaTests.push({ revision: ollama.revision });
      return route.fulfill({
        json: {
          config: ollama,
          verified: ollama.enabled,
          test: ollama.enabled ? { model: ollama.model, elapsedMs: 6560, testedAt: NOW } : null,
        },
      });
    }
    if (path === '/api/admin/v1/ai/ollama/test') {
      const input = request.postDataJSON() as Record<string, unknown>;
      ollamaTests.push(input);
      if (input['revision'] !== ollama.revision)
        return route.fulfill({
          status: 409,
          json: {
            error: { code: 'ai_ollama_config_changed', message: 'Настройки Ollama изменились.' },
          },
        });
      return route.fulfill({
        json: { model: ollama.model, elapsedMs: 6560, testedAt: NOW, revision: ollama.revision },
      });
    }
    if (path === '/api/admin/v1/ai/ollama') {
      if (request.method() === 'PUT') {
        const input = request.postDataJSON() as Record<string, unknown>;
        ollamaWrites.push(input);
        if (input['revision'] !== ollama.revision)
          return route.fulfill({
            status: 409,
            json: {
              error: { code: 'ai_ollama_config_changed', message: 'Настройки Ollama изменились.' },
            },
          });
        ollama = {
          enabled: input['enabled'] === true,
          baseUrl: String(input['baseUrl']),
          model: String(input['model']),
          revision: ollama.revision + 1,
          updatedAt: NOW,
        };
      }
      return route.fulfill({ json: ollama });
    }
    if (path === '/api/admin/v1/ai/ollama-cloud/keys') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as (typeof poolWrites)[number];
        if (body.configurationVersion !== config.configurationVersion)
          return route.fulfill({ status: 409, json: { error: { code: 'ai_config_changed' } } });
        poolWrites.push(body);
        pool = {
          ...pool,
          managed: true,
          keys: pool.keys.map((old) => {
            const next = body.keys.find((key) => key.slot === old.slot)!;
            return {
              ...old,
              label: next.label,
              priority: next.priority,
              enabled: next.enabled && !next.clearApiKey,
              configured: next.clearApiKey ? false : Boolean(next.apiKey) || old.configured,
              fingerprint: next.clearApiKey
                ? null
                : next.apiKey
                  ? 'cloud-slot-' + old.slot
                  : old.fingerprint,
              models: next.models,
            };
          }),
        };
        const active = [...pool.keys]
          .sort((a, b) => a.priority - b.priority)
          .find((key) => key.enabled && key.configured);
        config = {
          ...config,
          configurationVersion: config.configurationVersion + 1,
          providerConfigurations: config.providerConfigurations.map((slot) =>
            slot.provider === 'ollama-cloud'
              ? { ...slot, apiKeyConfigured: !!active, keyFingerprint: active?.fingerprint ?? null }
              : slot,
          ),
        };
      }
      return route.fulfill({
        json: { ...pool, configurationVersion: config.configurationVersion },
      });
    }
    if (path === '/api/admin/v1/ai/test') {
      const body = request.postDataJSON();
      const slot = config.providerConfigurations.find((item) => item.provider === body.provider);
      paidTests.push(body);
      if (
        body.configurationVersion !== config.configurationVersion ||
        !slot?.enabled ||
        body.providerConfigurationVersion !== slot.revision
      )
        return route.fulfill({ status: 409, json: { error: { code: 'ai_config_changed' } } });
      return route.fulfill({
        json: {
          provider: slot.provider,
          model: slot.model,
          configurationVersion: config.configurationVersion,
          providerConfigurationVersion: slot.revision,
          elapsedMs: 120,
          testedAt: NOW,
        },
      });
    }
    if (path === '/api/admin/v1/ai') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as Record<string, unknown>;
        writes.push(body);
        if (
          body['configurationVersion'] !== config.configurationVersion ||
          body['providerConfigurationVersion'] !==
            config.providerConfigurations.find((slot) => slot.provider === body['provider'])
              ?.revision
        )
          return route.fulfill({
            status: 409,
            json: {
              error: {
                code: 'ai_config_changed',
                message: 'Настройки изменились. Перезагрузите страницу.',
              },
            },
          });
        const provider = body['provider'] as AiProvider;
        const model = body['model'] as string;
        const slots = config.providerConfigurations.map((slot) =>
          slot.provider !== provider
            ? slot
            : {
                ...slot,
                model,
                enabled: Boolean(body['enabled']),
                revision: slot.revision + 1,
                updatedAt: NOW,
                apiKeyConfigured: body['clearApiKey']
                  ? false
                  : body['apiKey']
                    ? true
                    : slot.apiKeyConfigured,
                keyFingerprint: body['clearApiKey']
                  ? null
                  : body['apiKey']
                    ? `${provider}-hash`
                    : slot.keyFingerprint,
              },
        );
        const active = slots.find((slot) => slot.provider === provider)!;
        config = {
          ...config,
          provider,
          model,
          providerConfigurations: slots,
          enabled: Boolean(body['enabled']),
          paidOperationsPerHour: Number(body['paidOperationsPerHour']),
          apiKeyConfigured: active.apiKeyConfigured,
          keyFingerprint: active.keyFingerprint,
          configurationVersion: config.configurationVersion + 1,
          updatedAt: NOW,
          migratedFromModel: null,
        };
      }
      return route.fulfill({ json: config });
    }
    if (request.method() === 'GET')
      return route.fulfill({ json: { items: [], meta: { total: 0 } } });
    return route.fulfill({
      status: 400,
      json: { error: { code: 'unexpected_mutation', message: path } },
    });
  });
  return {
    writes,
    paidTests,
    poolWrites,
    ollamaWrites,
    ollamaDiscoveries,
    ollamaTests,
    currentOllama: () => ollama,
    pageErrors,
    current: () => config,
    replace: (next: AiAdminConfig) => {
      config = structuredClone(next);
    },
  };
}

async function openAdmin(page: Page) {
  await page.goto('/#/admin/ai', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Подключения' })).toBeVisible();
  await page.getByRole('tab', { name: 'Подключения' }).click();
  await expect(page.getByRole('group', { name: 'Доступные ИИ-провайдеры' })).toBeVisible();
  await expect(page.locator('.portal-global-error')).toHaveCount(0);
}

async function selectProvider(
  page: Page,
  provider: 'ollama' | 'ollama-cloud' | 'deepseek' | 'openai',
) {
  const title =
    provider === 'ollama-cloud'
      ? 'Ollama Cloud'
      : provider === 'ollama'
        ? 'Ollama'
        : provider === 'deepseek'
          ? 'DeepSeek'
          : 'OpenAI';
  const card = page
    .getByRole('group', { name: 'Доступные ИИ-провайдеры' })
    .getByRole('button')
    .filter({ has: page.getByText(title, { exact: true }) });
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  return card;
}

test('Four supported connections show exact key status and no secret or redundant test button', async ({
  page,
}) => {
  // D2-R2 Chrome cold-start can spend >30s in its very first navigation.
  test.setTimeout(90_000);
  const fake = await adminFixture(page);
  await openAdmin(page);
  for (const name of ['Ollama', 'Ollama Cloud', 'DeepSeek', 'OpenAI']) {
    await expect(
      page
        .getByRole('group', { name: 'Доступные ИИ-провайдеры' })
        .getByRole('button')
        .filter({ has: page.getByText(name, { exact: true }) }),
    ).toBeVisible();
  }
  await expect(page.getByRole('group', { name: 'Доступные ИИ-провайдеры' })).toContainText(
    'без ключа',
  );
  await expect(page.getByRole('button', { name: 'Проверить реальный ответ модели' })).toHaveCount(
    0,
  );
  await selectProvider(page, 'openai');
  await expect(page.getByRole('region', { name: 'Настройки OpenAI' })).toBeVisible();
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('gpt-6-luna');
  await expect(page.getByRole('button', { name: 'Сохранить выключенным' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Настройки OpenAI' })).not.toContainText(
    'Отпечаток',
  );
  await selectProvider(page, 'deepseek');
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('deepseek-flash');
  expect(fake.writes).toHaveLength(0);
  expect(fake.paidTests).toHaveLength(0);
  expect(fake.pageErrors).toEqual([]);
});

test('Separate OpenAI and DeepSeek keys stay server-side and delete only selected slot', async ({
  page,
}) => {
  const fake = await adminFixture(page);
  await openAdmin(page);
  await selectProvider(page, 'openai');
  const secretA = 'test-openai-key-do-not-render';
  await page.getByLabel('Новый API-ключ').fill(secretA);
  await page.getByRole('button', { name: 'Сохранить выключенным' }).click();
  await expect(page.getByText('Сохранено · облачные запросы выключены')).toBeVisible();
  await expect(page.getByLabel('Новый API-ключ')).toHaveValue('');
  await selectProvider(page, 'deepseek');
  const secretB = 'test-deepseek-key-do-not-render';
  await page.getByLabel('Новый API-ключ').fill(secretB);
  await page.getByLabel('Модель', { exact: true }).selectOption('deepseek-v4-pro');
  await page.getByRole('button', { name: 'Сохранить выключенным' }).click();
  await expect(page.getByText('Сохранено · облачные запросы выключены')).toBeVisible();
  expect(
    fake
      .current()
      .providerConfigurations.filter((x) => x.provider !== 'ollama-cloud')
      .every((x) => x.apiKeyConfigured),
  ).toBe(true);
  expect(
    fake.current().providerConfigurations.find((x) => x.provider === 'ollama-cloud')
      ?.apiKeyConfigured,
  ).toBe(false);
  await selectProvider(page, 'openai');
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('gpt-6-luna');
  await expect(page.getByLabel('Новый API-ключ')).toHaveValue('');
  await page.getByText('Дополнительно', { exact: true }).click();
  await page.getByLabel('Удалить сохранённый ключ этого провайдера').check();
  await page.getByRole('button', { name: 'Сохранить выключенным' }).click();
  await expect(page.getByText('Сохранено · облачные запросы выключены')).toBeVisible();
  const slots = fake.current().providerConfigurations;
  expect(slots.find((x) => x.provider === 'deepseek')?.apiKeyConfigured).toBe(true);
  expect(slots.find((x) => x.provider === 'openai')?.apiKeyConfigured).toBe(false);
  const content = await page.locator('body').innerText();
  expect(content).not.toContain(secretA);
  expect(content).not.toContain(secretB);
  expect(fake.paidTests).toHaveLength(0);
});

test('Cloud save-and-verify uses exactly one consented paid request and refreshed version', async ({
  page,
}) => {
  const configured = aiAdminFixture({
    provider: 'deepseek',
    model: 'deepseek-flash',
    enabled: true,
    apiKeyConfigured: true,
    paidOperationsPerHour: 5,
    configurationVersion: 3,
  });
  const fake = await adminFixture(page, configured);
  await openAdmin(page);
  await selectProvider(page, 'deepseek');
  const action = page.getByRole('button', { name: 'Сохранить и проверить' });
  await expect(action).toBeDisabled();
  await page.getByLabel('Общий лимит платных ИИ-операций за час').fill('6');
  await page.getByLabel('Разрешаю один платный запрос для проверки').check();
  await action.click();
  await expect(page.getByText(/Подключено · DeepSeek/)).toBeVisible();
  expect(fake.writes).toHaveLength(1);
  expect(fake.paidTests).toEqual([
    {
      acknowledgePaidRequest: true,
      configurationVersion: 4,
      provider: 'deepseek',
      providerConfigurationVersion: 2,
    },
  ]);
  await expect(page.getByLabel('Разрешаю один платный запрос для проверки')).not.toBeChecked();
  await expect(action).toBeDisabled();
  expect(fake.pageErrors).toEqual([]);
});

for (const width of [1440, 1024, 390, 320]) {
  test(`Ollama Cloud saves a separate key and uses explicit paid verification at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const fake = await adminFixture(page);
    await openAdmin(page);
    await selectProvider(page, 'ollama-cloud');
    await expect(page.getByRole('region', { name: 'Настройки Ollama Cloud' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Войти в Ollama и получить ключ' }),
    ).toHaveAttribute('href', 'https://ollama.com/settings/keys');
    await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('gemma4:31b');
    const keyCard = page.locator('details.asa-cloud-key-card').filter({
      has: page.getByLabel('API-ключ 1', { exact: true }),
    });
    await keyCard.locator('summary').click();
    await keyCard.getByLabel('API-ключ 1', { exact: true }).fill('test-ollama-cloud-key-only');
    await keyCard.getByRole('checkbox', { name: 'Использовать ключ', exact: true }).check();
    await keyCard.getByRole('checkbox', { name: 'gemma4:31b', exact: true }).check();
    expect(fake.paidTests).toHaveLength(0);
    await page.getByRole('button', { name: 'Сохранить ключи и порядок', exact: true }).click();
    await expect(page.getByText('Ключи и порядок сохранены', { exact: true })).toBeVisible();
    await expect(keyCard.getByLabel('API-ключ 1', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Выключено', { exact: true })).not.toBeChecked();
    expect(fake.poolWrites).toHaveLength(1);
    expect(fake.poolWrites[0]).toMatchObject({
      configurationVersion: 1,
      keys: expect.arrayContaining([
        {
          slot: 1,
          label: 'Ключ 1',
          priority: 1,
          enabled: true,
          models: ['gemma4:31b'],
          apiKey: 'test-ollama-cloud-key-only',
        },
      ]),
    });
    expect(
      fake.current().providerConfigurations.find((slot) => slot.provider === 'ollama-cloud'),
    ).toMatchObject({ enabled: false, apiKeyConfigured: true, revision: 1 });
    expect(fake.paidTests).toHaveLength(0);
    await page.getByLabel('Общий лимит платных ИИ-операций за час').fill('5');
    await page.getByLabel('Выключено', { exact: true }).check();
    await expect(page.getByRole('button', { name: 'Сохранить и проверить' })).toBeDisabled();
    expect(fake.paidTests).toHaveLength(0);
    await page.getByLabel('Разрешаю один платный запрос для проверки').check();
    await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
    await expect(page.getByText(/Подключено · Ollama Cloud/)).toBeVisible();
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]).toMatchObject({
      provider: 'ollama-cloud',
      model: 'gemma4:31b',
      enabled: true,
      configurationVersion: 2,
      providerConfigurationVersion: 1,
    });
    expect(fake.writes[0]).not.toHaveProperty('apiKey');
    expect(fake.paidTests).toEqual([
      {
        acknowledgePaidRequest: true,
        configurationVersion: 3,
        provider: 'ollama-cloud',
        providerConfigurationVersion: 2,
      },
    ]);
    await expect(keyCard.getByLabel('API-ключ 1', { exact: true })).toHaveValue('');
    expect(await page.locator('body').innerText()).not.toContain('test-ollama-cloud-key-only');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('region', { name: 'Настройки Ollama Cloud' }).scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.screenshot({ path: test.info().outputPath(`ollama-cloud-${width}.png`) });
    expect(fake.pageErrors).toEqual([]);
  });
}

test('Stale cloud save cannot start a paid request or claim success', async ({ page }) => {
  const configured = aiAdminFixture({
    provider: 'deepseek',
    model: 'deepseek-flash',
    enabled: true,
    apiKeyConfigured: true,
    paidOperationsPerHour: 5,
    configurationVersion: 3,
  });
  const fake = await adminFixture(page, configured);
  await openAdmin(page);
  await selectProvider(page, 'deepseek');
  await page.getByLabel('Общий лимит платных ИИ-операций за час').fill('8');
  await page.getByLabel('Разрешаю один платный запрос для проверки').check();
  fake.replace({ ...configured, paidOperationsPerHour: 9, configurationVersion: 4 });
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(page.getByRole('alert')).toContainText('Настройки ИИ изменились');
  expect(fake.paidTests).toHaveLength(0);
  await expect(page.getByText('Подключено ·')).toHaveCount(0);
});

test('A response for another model is never a verified connection', async ({ page }) => {
  const fake = await adminFixture(
    page,
    aiAdminFixture({
      provider: 'deepseek',
      model: 'deepseek-flash',
      enabled: true,
      apiKeyConfigured: true,
      paidOperationsPerHour: 5,
      configurationVersion: 2,
    }),
  );
  await page.route('**/api/admin/v1/ai/test', async (route) =>
    route.fulfill({
      json: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        providerConfigurationVersion: 1,
        elapsedMs: 123,
        testedAt: NOW,
        configurationVersion: 2,
      },
    }),
  );
  await openAdmin(page);
  await selectProvider(page, 'deepseek');
  await page.getByLabel('Разрешаю один платный запрос для проверки').check();
  await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
  await expect(page.getByRole('alert')).toContainText('не соответствует текущим настройкам');
  await expect(page.getByText('Подключено ·')).toHaveCount(0);
  expect(fake.pageErrors).toEqual([]);
});

for (const width of [1440, 1024, 390, 320]) {
  test('Compact connection cards remain responsive at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fake = await adminFixture(
      page,
      aiAdminFixture({
        provider: 'deepseek',
        model: 'deepseek-flash',
        enabled: false,
        apiKeyConfigured: true,
        paidOperationsPerHour: 5,
      }),
    );
    await openAdmin(page);
    await selectProvider(page, 'deepseek');
    await expect(page.getByRole('button', { name: 'Сохранить выключенным' })).toBeVisible();
    await expect(page.getByLabel('Новый API-ключ')).toHaveValue('');
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('ai-connections-' + width + '.png'),
      fullPage: true,
    });
    expect(fake.writes).toHaveLength(0);
    expect(fake.paidTests).toHaveLength(0);
    expect(fake.pageErrors).toEqual([]);
  });
}

for (const width of [1440, 390]) {
  test('Ollama auto-discovery and ComfyUI model presence at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fake = await adminFixture(page);
    await openAdmin(page);
    await selectProvider(page, 'ollama');
    await expect(page.getByLabel('Адрес Ollama')).toHaveValue('http://127.0.0.1:11434');
    await expect(
      page.getByRole('group', { name: 'Установленные модели Ollama' }).getByRole('button'),
    ).toHaveCount(2);
    await page.getByLabel('Адрес Ollama').fill('http://192.168.1.20:11434');
    await expect(
      page.getByRole('group', { name: 'Установленные модели Ollama' }).getByRole('button'),
    ).toHaveCount(2);
    await page
      .getByRole('group', { name: 'Установленные модели Ollama' })
      .getByRole('button', { name: /ornith:9b/ })
      .click();
    await page.getByRole('checkbox', { name: 'Выключено' }).check();
    await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
    await expect(page.getByText('Сохранено · ornith:9b', { exact: false })).toBeVisible();
    expect(fake.ollamaWrites).toHaveLength(1);
    expect(fake.ollamaTests).toEqual([{ revision: 2 }]);
    await page.getByRole('tab', { name: 'Изображения', exact: true }).click();
    const technicalState = page.locator('details.asa-ai-comfy');
    await technicalState.getByText('Техническое состояние ComfyUI', { exact: true }).click();
    await expect(technicalState.getByText('FLUX.2 Klein 4B', { exact: true })).toBeVisible();
    await expect(technicalState.getByText('Граф генерации ещё не проверен')).toBeVisible();
    await page.getByRole('tab', { name: 'Подключения' }).click();
    await selectProvider(page, 'ollama');
    await expect(page.getByLabel('Адрес Ollama')).toHaveValue('http://192.168.1.20:11434');
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('ai-ollama-' + width + '.png'),
      fullPage: true,
    });
    expect(fake.pageErrors).toEqual([]);
  });
}

const CASES = [
  ['ai_provider_invalid_request', 502, 'отклонил формат запроса'],
  ['ai_provider_authentication_failed', 502, 'не принял API-ключ'],
  ['ai_provider_insufficient_balance', 502, 'недостаточно средств'],
  ['ai_provider_access_denied', 502, 'запретил доступ'],
  ['ai_provider_model_unavailable', 502, 'Модель или endpoint недоступны'],
  ['ai_provider_rate_limit', 429, 'ограничил частоту'],
  ['ai_provider_unavailable', 503, 'не смог соединиться'],
  ['ai_provider_timeout', 504, 'не ответил вовремя'],
  ['ai_key_decryption_failed', 503, 'не удалось расшифровать'],
  ['ai_platform_quota_exhausted', 429, 'равен нулю'],
  ['ai_test_incomplete', 503, 'не получила завершённый'],
] as const;
for (const [code, status, message] of CASES) {
  test('Paid check failure ' + code + ' masks upstream secrets', async ({ page }) => {
    const fake = await adminFixture(
      page,
      aiAdminFixture({
        provider: 'deepseek',
        model: 'deepseek-flash',
        enabled: true,
        apiKeyConfigured: true,
        paidOperationsPerHour: 5,
      }),
    );
    let attempts = 0;
    await page.route('**/api/admin/v1/ai/test', async (route) => {
      attempts += 1;
      return route.fulfill({
        status,
        json: {
          error: { code, message: 'PRIVATE_REMOTE_PROVIDER_BODY sk-not-user-visible' },
        },
      });
    });
    await openAdmin(page);
    await selectProvider(page, 'deepseek');
    await page.getByLabel('Разрешаю один платный запрос для проверки').check();
    await page.getByRole('button', { name: 'Сохранить и проверить' }).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.locator('body')).not.toContainText('PRIVATE_REMOTE_PROVIDER_BODY');
    await expect(page.locator('body')).not.toContainText('sk-not-user-visible');
    expect(attempts).toBe(1);
    expect(fake.writes).toHaveLength(0);
  });
}

test('Encryption unready and zero quota prohibit cloud paid checks', async ({ page }) => {
  const fake = await adminFixture(
    page,
    aiAdminFixture({
      provider: 'deepseek',
      model: 'deepseek-flash',
      enabled: true,
      apiKeyConfigured: true,
      encryptionReady: false,
      paidOperationsPerHour: 0,
    }),
  );
  await openAdmin(page);
  await selectProvider(page, 'deepseek');
  await expect(page.getByLabel('Новый API-ключ')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить и проверить' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Шифрование ключей');
  expect(fake.paidTests).toHaveLength(0);
  expect(fake.writes).toHaveLength(0);
});
