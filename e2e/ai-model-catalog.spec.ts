import { expect, test, type Page } from '@playwright/test';
import type { AiAdminConfig, AiProvider } from '../apps/web/src/admin/ai-model-config';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';

const ACCOUNT_ID = '20000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2026-10-19T12:00:00.000Z';

async function adminFixture(page: Page, initial = aiAdminFixture()) {
  let config = structuredClone(initial);
  const writes: Record<string, unknown>[] = [];
  const paidTests: unknown[] = [];
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
    if (path === '/api/admin/v1/ai/test') {
      paidTests.push(request.postDataJSON());
      return route.fulfill({
        json: {
          provider: config.provider,
          model: config.model,
          configurationVersion: config.configurationVersion,
          elapsedMs: 120,
          testedAt: NOW,
        },
      });
    }
    if (path === '/api/admin/v1/ai') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as Record<string, unknown>;
        writes.push(body);
        if (body['configurationVersion'] !== config.configurationVersion)
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
    pageErrors,
    current: () => config,
    replace: (next: AiAdminConfig) => {
      config = structuredClone(next);
    },
  };
}

async function openAdmin(page: Page) {
  await page.goto('/#/admin/ai');
  await expect(page.getByRole('heading', { name: 'ИИ и модели' })).toBeVisible();
  await expect(page.getByLabel('Провайдер', { exact: true })).toBeVisible();
  await expect(page.locator('.portal-global-error')).toHaveCount(0);
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(
    page.getByText('Настройки сохранены. Новый API-ключ не возвращается в браузер.'),
  ).toBeVisible();
}

test('Admin catalog uses server defaults and shows model support separately from product features', async ({
  page,
}) => {
  const fake = await adminFixture(page);
  await openAdmin(page);
  const picker = page.getByLabel('Модель', { exact: true });
  await expect(picker).toHaveValue('gpt-6-luna');
  await expect(picker.locator('option')).toHaveText([
    'GPT-6 Luna',
    'GPT-5 mini · до 2026-12-11',
    'GPT-4.1 mini · до 2027-01-14',
  ]);
  const capabilities = page.getByLabel('Возможности выбранной модели');
  await expect(capabilities).toContainText('Модель принимает текст и изображения.');
  await expect(
    capabilities.locator('dl > div').filter({ hasText: 'Загрузка изображений' }),
  ).toContainText('Ещё не подключено');
  await expect(
    capabilities.locator('dl > div').filter({ hasText: 'Генерация изображений' }),
  ).toContainText('Ещё не подключено');
  await page.getByLabel('Провайдер', { exact: true }).selectOption('deepseek');
  await expect(picker).toHaveValue('deepseek-flash');
  await expect(picker.locator('option')).toHaveText(['DeepSeek Flash', 'DeepSeek V4 Pro']);
  await picker.selectOption('deepseek-v4-pro');
  await expect(capabilities).toContainText('Модель принимает только текст.');
  expect(fake.writes).toHaveLength(0);
  expect(fake.paidTests).toHaveLength(0);
  expect(fake.pageErrors).toEqual([]);
});

test('Admin stores both provider keys, switches with fingerprints and clears only the selected key', async ({
  page,
}) => {
  const fake = await adminFixture(page);
  await openAdmin(page);
  const password = page.getByLabel(/Новый API-ключ/);
  await password.fill('test-openai-key-kept-in-its-slot');
  await page.getByLabel('Общий лимит платных ИИ-операций за час').fill('5');
  await save(page);
  await expect(password).toHaveValue('');
  const slots = page.getByRole('region', { name: 'Сохранённые ключи провайдеров' });
  await expect(slots).toContainText('openai-hash');
  await page.getByLabel('Провайдер', { exact: true }).selectOption('deepseek');
  await expect(password).toHaveAttribute('required', '');
  await password.fill('test-deepseek-key-kept-in-its-slot');
  await page.getByLabel('Модель', { exact: true }).selectOption('deepseek-v4-pro');
  await save(page);
  await expect(slots).toContainText('openai-hash');
  await expect(slots).toContainText('deepseek-hash');
  expect(fake.current().providerConfigurations.every((slot) => slot.apiKeyConfigured)).toBe(true);
  await page.getByLabel('Провайдер', { exact: true }).selectOption('openai');
  await expect(password).not.toHaveAttribute('required', '');
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('gpt-6-luna');
  await save(page);
  expect(fake.writes.at(-1)).toEqual({
    enabled: false,
    paidOperationsPerHour: 5,
    provider: 'openai',
    model: 'gpt-6-luna',
    configurationVersion: 3,
  });
  await page.getByLabel('Удалить сохранённый API-ключ', { exact: true }).check();
  await save(page);
  await expect(slots).not.toContainText('openai-hash');
  await expect(slots).toContainText('deepseek-hash');
  await page.getByLabel('Провайдер', { exact: true }).selectOption('deepseek');
  await expect(page.getByLabel('Модель', { exact: true })).toHaveValue('deepseek-v4-pro');
  await save(page);
  expect(fake.writes.at(-1)).toEqual({
    enabled: false,
    paidOperationsPerHour: 5,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    configurationVersion: 5,
  });
  expect(fake.paidTests).toHaveLength(0);
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('test-openai-key');
  expect(visible).not.toContain('test-deepseek-key');
  expect(fake.pageErrors).toEqual([]);
});

test('Admin reloads a stale save and requires fresh paid consent for the confirmed version', async ({
  page,
}) => {
  const configured = aiAdminFixture({
    provider: 'deepseek',
    model: 'deepseek-flash',
    apiKeyConfigured: true,
    keyFingerprint: 'deepseek-hash',
    paidOperationsPerHour: 5,
    configurationVersion: 2,
  });
  const fake = await adminFixture(page, configured);
  await openAdmin(page);
  await page.getByLabel('Подтверждаю один платный проверочный запрос').check();
  await page.getByLabel('Общий лимит платных ИИ-операций за час').fill('6');
  await expect(page.getByLabel('Подтверждаю один платный проверочный запрос')).not.toBeChecked();
  fake.replace({ ...configured, configurationVersion: 3, paidOperationsPerHour: 7 });
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Настройки изменились');
  await expect(
    page.getByText('Настройки сохранены. Новый API-ключ не возвращается в браузер.'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Проверить подключение', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByLabel('Общий лимит платных ИИ-операций за час')).toHaveValue('7');
  await expect(page.getByLabel('Подтверждаю один платный проверочный запрос')).not.toBeChecked();
  await page.getByLabel('Подтверждаю один платный проверочный запрос').check();
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  await expect(page.getByText('Модель deepseek-flash ответила.', { exact: false })).toBeVisible();
  expect(fake.paidTests).toEqual([{ acknowledgePaidRequest: true, configurationVersion: 3 }]);
  expect(fake.pageErrors).toEqual([]);
});

test('Admin does not report an unrelated model response as a successful paid check', async ({
  page,
}) => {
  const fake = await adminFixture(
    page,
    aiAdminFixture({
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKeyConfigured: true,
      keyFingerprint: 'deepseek-hash',
      paidOperationsPerHour: 5,
      configurationVersion: 2,
    }),
  );
  let calls = 0;
  await page.route('**/api/admin/v1/ai/test', async (route) => {
    calls += 1;
    return route.fulfill({
      json: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        configurationVersion: 2,
        elapsedMs: 120,
        testedAt: NOW,
      },
    });
  });
  await openAdmin(page);
  await page.getByLabel('Подтверждаю один платный проверочный запрос').check();
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Запрос мог быть оплачен');
  await expect(page.locator('.asa-ai-admin-success')).toHaveCount(0);
  await expect(page.getByLabel('Подтверждаю один платный проверочный запрос')).not.toBeChecked();
  expect(calls).toBe(1);
  expect(fake.pageErrors).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`Admin catalog and migrated key remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fake = await adminFixture(
      page,
      aiAdminFixture({
        provider: 'deepseek',
        model: 'deepseek-flash',
        apiKeyConfigured: true,
        keyFingerprint: '123456789abc',
        paidOperationsPerHour: 5,
        configurationVersion: 8,
        migratedFromModel: 'deepseek-chat',
      }),
    );
    await openAdmin(page);
    await expect(page.getByRole('alert')).toContainText('deepseek-chat снята с обслуживания');
    await expect(page.getByRole('alert')).toContainText('отдельной платной проверкой');
    await expect(page.getByLabel('Разрешить ИИ-запросы', { exact: false })).not.toBeChecked();
    await expect(page.getByLabel('Подтверждаю один платный проверочный запрос')).not.toBeChecked();
    await page.getByLabel('Модель', { exact: true }).selectOption('deepseek-v4-pro');
    await expect(page.getByLabel('Возможности выбранной модели')).toContainText(
      'Модель принимает только текст',
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`ai-model-catalog-${width}.png`),
      fullPage: true,
    });
    expect(fake.writes).toHaveLength(0);
    expect(fake.paidTests).toHaveLength(0);
    expect(fake.pageErrors).toEqual([]);
  });
}
