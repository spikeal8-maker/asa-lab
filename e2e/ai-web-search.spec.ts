import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { AiWebSearchEvidence } from '@asa-lab/contracts';
import { aiAdminFixture } from '../apps/web/src/admin/testing/ai-admin-config.fixture';

const NOW = '2026-10-25T12:00:00.000Z';
const accountId = '20000000-0000-4000-8000-000000000001';
const workspaceId = '10000000-0000-4000-8000-000000000001';
const baseEvidence: AiWebSearchEvidence = {
  schemaVersion: 1,
  provider: 'searxng',
  mode: 'web',
  status: 'ready',
  query: 'Новости науки',
  retrievedAt: NOW,
  sources: [
    {
      id: 1,
      title: 'Результаты исследования — подробное описание с длинным русским заголовком',
      url: 'https://example.org/research',
      hostname: 'example.org',
      snippet: 'Официальный материал об исследовании с данными и пояснениями.',
    },
    {
      id: 2,
      title: 'Обзор результатов',
      url: 'https://example.com/overview',
      hostname: 'example.com',
      snippet: 'Независимый обзор результатов исследования.',
    },
  ],
  images: [],
};

async function fixture(page: Page) {
  const threads: { id: string; title: string; updatedAt: string }[] = [];
  const histories = new Map<string, Record<string, unknown>[]>();
  const requests: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const imageReads: string[] = [];
  let evidence: AiWebSearchEvidence | null = baseEvidence;
  let available = true;
  let weatherAvailable = true;
  let waiting = false;
  let release: (() => void) | null = null;
  let config = {
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
    configurationVersion: 4,
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === '/api/auth/me')
      return json({
        authenticated: true,
        user: { id: accountId, displayName: 'Администратор', email: 'admin@example.test' },
        account: { id: accountId, displayName: 'Администратор', email: 'admin@example.test' },
        capabilities: [{ capability: 'platform_admin', state: 'verified' }],
        workspaces: [{ workspaceId, kind: 'personal', title: 'Личное', role: 'owner' }],
        activeWorkspace: { workspaceId, kind: 'personal' },
        navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/admin/v1/me')
      return json({
        administrator: true,
        principalId: '30000000-0000-4000-8000-000000000001',
        accountId,
        displayName: 'Администратор',
        activeWorkspaceId: workspaceId,
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
    if (path === '/api/class-join/me') return json({ authenticated: false });
    if (path === '/api/ai/scopes') return json({ personal: true, items: [] });
    if (path === '/api/ai/status')
      return json({
        enabled: true,
        provider: 'openai',
        model: 'gpt-6-luna',
        availableModels: ['gpt-6-luna'],
      });
    if (path === '/api/ai/web-search/status')
      return json({
        schemaVersion: 1,
        provider: 'searxng',
        enabled: available || weatherAvailable,
        configured: available,
        weatherConfigured: weatherAvailable,
      });
    if (path === '/api/admin/v1/ai/web-search') {
      if (method === 'PUT') {
        const data = req.postDataJSON() as Record<string, unknown>;
        writes.push(data);
        config = {
          ...config,
          enabled: Boolean(data.enabled),
          operationsPerHour: Number(data.operationsPerHour),
          weatherEnabled: Boolean(data.weatherEnabled),
          resultsLimit: Number(data.resultsLimit),
          pagesLimit: Number(data.pagesLimit),
          pageCharLimit: Number(data.pageCharLimit),
          configurationVersion: config.configurationVersion + 1,
        };
      }
      return json(config);
    }
    if (path === '/api/admin/v1/ai') return json(aiAdminFixture());
    if (path === '/api/admin/v1/ai/ollama')
      return json({
        enabled: false,
        model: 'gemma4:12b',
        baseUrl: 'http://127.0.0.1:11434',
        revision: 1,
        updatedAt: null,
      });
    if (path === '/api/ai/threads') {
      if (method === 'GET') return json({ items: threads, nextCursor: null });
      const id = randomUUID();
      threads.push({ id, title: 'Новый чат', updatedAt: NOW });
      histories.set(id, []);
      return json({ id }, 201);
    }
    if (/\/web-search\/[^/]+\/images\/\d+$/.test(path)) {
      imageReads.push(req.url());
      return route.fulfill({
        contentType: 'image/png',
        body: readFileSync('apps/web/public/landing/electronics-simulation.png'),
      });
    }
    if (/\/attachments$/.test(path)) return json({ items: [] });
    if (path.endsWith('/stop')) {
      release?.();
      return json({ stopped: true });
    }
    const operation = /^\/api\/ai\/threads\/([^/]+)\/(messages|regenerations)(\/stream)?$/.exec(
      path,
    );
    if (operation) {
      const id = operation[1]!;
      const history = histories.get(id) ?? [];
      if (method === 'GET') return json({ items: history, nextCursor: null });
      const data = req.postDataJSON() as Record<string, unknown>;
      requests.push(data);
      const requestId = String(data.requestId);
      const source = history.find((row) => row.id === data.sourceUserMessageId);
      const user = {
        id: randomUUID(),
        role: 'user',
        content: String(data.message),
        requestId,
        createdAt: NOW,
      };
      if (!source) {
        history.push(user);
        threads.find((thread) => thread.id === id)!.title = String(data.message);
      }
      const snapshot = source
        ? history.find((row) => row.requestId === source.requestId && row.role === 'assistant')
            ?.webSearch
        : evidence;
      const webSearch = snapshot
        ? {
            ...(snapshot as AiWebSearchEvidence),
            images: (snapshot as AiWebSearchEvidence).images.map((image) => ({
              ...image,
              thumbnailUrl: `/api/ai/threads/${id}/web-search/${source ? source.requestId : requestId}/images/${image.id}`,
            })),
          }
        : undefined;
      if (waiting)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const answer = {
        id: randomUUID(),
        role: 'assistant',
        content: '## Результат\n\nНашёл полезные материалы [1](https://example.org/research).',
        requestId,
        createdAt: NOW,
        ...(source
          ? { sourceUserMessageId: source.id, sourcePrompt: source.content, regenerated: true }
          : {}),
        ...(webSearch ? { webSearch } : {}),
      };
      history.push(answer);
      histories.set(id, history);
      const frame = (event: string, data: unknown) =>
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          frame('delta', { text: answer.content }) +
          frame('done', {
            messages: source ? [answer] : [user, answer],
            replayed: false,
            stopped: waiting,
          }),
      });
    }
    return json({ items: [], meta: { total: 0 } });
  });
  return {
    requests,
    imageReads,
    writes,
    errors,
    setEvidence: (value: AiWebSearchEvidence | null) => {
      evidence = value;
    },
    unavailable: () => {
      available = false;
      weatherAvailable = false;
    },
    weatherOnly: () => {
      available = false;
      weatherAvailable = true;
    },
    wait: () => {
      waiting = true;
    },
  };
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  if (await page.locator('.asa-ai-web-evidence').count()) {
    const toolbar = await page.locator('.chat-utility-strip').boundingBox();
    const scroll = await page.locator('.chat-scroll').boundingBox();
    expect(toolbar).not.toBeNull();
    expect(scroll).not.toBeNull();
    expect(scroll!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height);
  }
}
async function send(page: Page, mode: string, message: string) {
  const menu = page.locator('details.chat-tools-menu');
  if ((await menu.getAttribute('open')) === null)
    await page.locator('summary.chat-attach-button').click();
  await page.getByRole('button', { name: 'Режим интернет-поиска' }).click();
  const label = (
    {
      auto: 'Авто',
      off: 'Выключен',
      web: 'Веб-поиск',
      images: 'Картинки',
      weather: 'Погода',
    } as Record<string, string>
  )[mode];
  await page
    .getByRole('listbox', { name: 'Режим интернет-поиска' })
    .getByRole('option', { name: label })
    .click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill(message);
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Остановить генерацию' })).toHaveCount(0);
}

for (const width of [1440, 1024, 390, 320]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`server search sources, image gallery and real weather data remain readable at ${width} in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => localStorage.setItem('asa-ai-chat-theme', value), theme);
      const fake = await fixture(page);
      await page.goto('/#/ai');
      await send(page, 'web', 'Найди новости науки');
      await page.locator('.asa-ai-web-sources summary').first().click();
      await expect(page.getByRole('link', { name: /Источник 1:/ })).toBeVisible();
      await expect(
        page.locator('.asa-ai-web-sources').getByRole('link', { name: /Результаты исследования/ }),
      ).toBeVisible();
      expect(fake.requests[0]?.webSearchMode).toBe('web');
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`web-sources-${width}.png`) });
      await page.reload();
      await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeVisible();
      const toggle = page.getByRole('button', { name: 'Открыть историю диалогов' });
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole('button', { name: 'Найди новости науки', exact: true }).click();
      await expect(page.getByRole('link', { name: /Источник 1:/ })).toBeVisible();
      expect(fake.requests).toHaveLength(1);
      fake.setEvidence({
        ...baseEvidence,
        mode: 'images',
        images: [
          {
            id: 1,
            title: 'Электронная схема для учебного проекта',
            thumbnailUrl: '',
            sourceUrl: 'https://example.org/project',
          },
          {
            id: 2,
            title: 'Второе изображение с длинным описанием',
            thumbnailUrl: '',
            sourceUrl: 'https://example.com/project',
          },
        ],
      });
      await send(page, 'images', 'Найди картинки электронных схем');
      await page.locator('.asa-ai-web-images').scrollIntoViewIfNeeded();
      await expect(page.locator('.asa-ai-web-images img')).toHaveCount(2);
      await expect(
        page.getByRole('region', { name: 'Найденные изображения, прокрутка по горизонтали' }),
      ).toBeVisible();
      await page
        .getByRole('button', {
          name: 'Открыть изображение: Электронная схема для учебного проекта',
          exact: true,
        })
        .click();
      await expect(page.getByRole('dialog', { name: 'Просмотр изображения' })).toBeVisible();
      await expect(
        page.getByRole('dialog').getByRole('link', { name: 'Источник' }),
      ).toHaveAttribute('href', 'https://example.org/project');
      await noOverflow(page);
      await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click();
      if (width <= 390) {
        expect(
          await page
            .locator('.asa-ai-web-images')
            .evaluate((node) => node.scrollWidth > node.clientWidth),
        ).toBe(true);
      }
      for (const image of await page.locator('.asa-ai-web-images img').all())
        expect(
          await image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        ).toBeGreaterThan(0);
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`web-images-${width}.png`) });

      fake.setEvidence({
        ...baseEvidence,
        mode: 'weather',
        weather: {
          location: 'Казань, Республика Татарстан',
          provider: 'met-norway',
          forecastAt: '2026-10-25T14:00:00Z',
          forecastUpdatedAt: '2026-10-25T11:45:00Z',
          attributions: [
            { title: 'MET Norway · CC BY 4.0', url: 'https://api.met.no/doc/License' },
            {
              title: '© OpenStreetMap contributors',
              url: 'https://www.openstreetmap.org/copyright',
            },
          ],
          sourceUrl: 'https://www.yr.no/en/forecast',
          temperatureC: 12,
          hours: [
            {
              time: '2026-10-25T14:00:00Z',
              temperatureC: 13,
              humidityPercent: 60,
              pressureHpa: 1000,
              windSpeedMs: 3,
            },
            {
              time: '2026-10-25T17:00:00Z',
              temperatureC: 11,
              humidityPercent: 65,
              pressureHpa: 1001,
              windSpeedMs: 2,
            },
          ],
        },
      });
      await send(page, 'weather', 'Погода в Казани');
      await expect(
        page.getByRole('region', { name: 'Прогноз: Казань, Республика Татарстан' }),
      ).toBeVisible();
      await expect(page.getByText('12°', { exact: false }).first()).toBeVisible();
      await expect(page.getByLabel('Температура 12 °C')).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`web-weather-${width}.png`) });
      expect(fake.errors).toEqual([]);
    });
  }
}

test('off, unavailable, ambiguous location and Stop stay truthful without automatic extra operations', async ({
  page,
}) => {
  const fake = await fixture(page);
  await page.goto('/#/ai');
  fake.setEvidence(null);
  await send(page, 'off', 'Сколько будет два плюс два');
  expect(fake.requests[0]?.webSearchMode).toBe('off');
  await expect(page.getByLabel('Результаты интернет-поиска')).toHaveCount(0);
  fake.setEvidence({
    ...baseEvidence,
    status: 'unavailable',
    reason: 'provider_unavailable',
    sources: [],
  });
  await send(page, 'web', 'Найди информацию');
  await expect(page.getByText('Поиск сейчас недоступен.', { exact: false })).toBeVisible();
  fake.setEvidence({
    ...baseEvidence,
    mode: 'weather',
    status: 'needs_location',
    reason: 'location_ambiguous',
    sources: [],
    locationChoices: ['Киров, Кировская область', 'Киров, Калужская область'],
  });
  await send(page, 'weather', 'Погода в Кирове');
  const count = fake.requests.length;
  await page.getByRole('button', { name: 'Киров, Кировская область', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toHaveValue(
    'Погода в Киров, Кировская область',
  );
  expect(fake.requests).toHaveLength(count);
  fake.wait();
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.getByText('Обдумываю ответ…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Остановить генерацию' }).click();
  await expect(page.getByRole('button', { name: 'Остановить генерацию' })).toHaveCount(0);
});

test('missing provider configuration does not disable ordinary chat', async ({ page }) => {
  const fake = await fixture(page);
  fake.unavailable();
  fake.setEvidence(null);
  await page.goto('/#/ai');
  await page.locator('summary.chat-attach-button').click();
  await expect(page.getByRole('button', { name: 'Режим интернет-поиска' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).click();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Объясни закон Ома');
  await page.getByRole('button', { name: 'Отправить сообщение', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Результат', exact: true })).toBeVisible();
  expect(fake.requests[0]?.webSearchMode).toBe('off');
});

test('native forecast mode can be chosen without an installed search component', async ({
  page,
}) => {
  const fake = await fixture(page);
  fake.weatherOnly();
  fake.setEvidence({
    ...baseEvidence,
    mode: 'weather',
    status: 'needs_location',
    reason: 'location_required',
    sources: [],
  });
  await page.goto('/#/ai');
  await page.locator('summary.chat-attach-button').click();
  const mode = page.getByRole('button', { name: 'Режим интернет-поиска' });
  await expect(mode).toBeEnabled();
  await expect(mode).toContainText('Выключен');
  await mode.click();
  await expect(
    page
      .getByRole('listbox', { name: 'Режим интернет-поиска' })
      .getByRole('option', { name: 'Веб-поиск' }),
  ).toBeDisabled();
  await mode.press('Escape');
  await send(page, 'weather', 'Узнать прогноз погоды');
  expect(fake.requests[0]?.webSearchMode).toBe('weather');
  await expect(page.getByText('Для прогноза укажите город.')).toBeVisible();
});

for (const width of [1440, 1024, 390, 320]) {
  test(`search administrator configures free internal search without keys or endpoint fields at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const fake = await fixture(page);
    await page.goto('/#/admin/ai');
    await page.getByRole('tab', { name: 'Интернет-поиск' }).click();
    await expect(page.getByRole('heading', { name: 'Интернет-поиск · SearxNG' })).toBeVisible();
    await expect(page.locator('input[type=password]')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.getByText('Прогноз погоды', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Включить прогноз погоды' })).toBeChecked();
    await page.getByRole('spinbutton', { name: 'Лимит поисковых операций за час' }).fill('50');
    await page.getByRole('spinbutton', { name: 'Результатов поиска', exact: true }).fill('6');
    await page.getByRole('spinbutton', { name: 'Страниц для чтения', exact: true }).fill('1');
    await page.getByRole('spinbutton', { name: 'Символов со страницы', exact: true }).fill('2500');
    await page.getByRole('button', { name: 'Сохранить поиск', exact: true }).click();
    await expect(
      page.getByText('Настройки сохранены. Поисковый запрос не выполнялся.'),
    ).toBeVisible();
    expect(fake.writes[0]).toEqual({
      enabled: true,
      weatherEnabled: true,
      operationsPerHour: 50,
      resultsLimit: 6,
      pagesLimit: 1,
      pageCharLimit: 2500,
      configurationVersion: 4,
    });
    expect(fake.requests).toHaveLength(0);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`web-admin-${width}.png`) });
    expect(fake.errors).toEqual([]);
  });
}

test('found images copy repeatedly and download the displayed file without navigating', async ({
  page,
}) => {
  const fake = await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const image = await items[0]!.getType('image/png');
          if (!image.size) throw new Error('Empty image');
        },
      },
    });
  });
  fake.setEvidence({
    ...baseEvidence,
    mode: 'images',
    images: [
      {
        id: 1,
        title: 'Тестовая картинка',
        thumbnailUrl: '',
        sourceUrl: 'https://example.org/image',
        originalUrl: 'https://images.example.org/original.png',
      },
    ],
  });
  await page.goto('/#/ai');
  await send(page, 'images', 'Найди картинки');
  const card = page.locator('.asa-ai-web-image-card');
  await card.hover();
  const copy = card.getByRole('button', { name: 'Копировать изображение', exact: true });
  await copy.click();
  await expect(
    card.getByRole('button', { name: 'Изображение скопировано', exact: true }),
  ).toBeEnabled();
  // The same button remains usable; changing tabs or the feedback timeout resets its icon.
  await card.getByRole('button', { name: 'Изображение скопировано', exact: true }).click();
  await expect(copy).toBeVisible({ timeout: 5000 });
  const downloadEvent = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Скачать изображение', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('Тестовая картинка.png');
  expect(fake.imageReads.filter((url) => url.includes('original=1'))).toHaveLength(1);
  const path = await download.path();
  expect(readFileSync(path!).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  await expect(page).toHaveURL(/#\/ai$/);
  await card.getByRole('button', { name: 'Использовать в чате', exact: true }).click();
  await expect(page.locator('.chat-attachment-drafts img')).toHaveAttribute(
    'alt',
    'Тестовая картинка.png',
  );
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeFocused();
  await page.getByRole('button', { name: 'Удалить Тестовая картинка.png', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await input.fill('Объясни: ');
  await input.evaluate((element, png) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['print(42)'], 'example.py', { type: 'text/plain' }));
    transfer.items.add(
      new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'clipboard.png', {
        type: 'image/png',
      }),
    );
    transfer.setData('text/plain', 'этот пример');
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, readFileSync('apps/web/public/landing/electronics-simulation.png').toString('base64'));
  await expect(input).toHaveValue('Объясни: этот пример');
  await expect(page.locator('.chat-attachment-chip')).toHaveCount(2);
  await expect(page.locator('.chat-attachment-drafts img')).toHaveAttribute('alt', 'clipboard.png');
  await expect(page.getByRole('button', { name: 'Удалить example.py', exact: true })).toBeVisible();
});
