import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const WORKSPACE = '30000000-0000-4000-8000-000000000001';
const SEAT = '40000000-0000-4000-8000-000000000001';
const CLASS = '50000000-0000-4000-8000-000000000001';
const NOW = '2026-10-19T12:00:00.000123Z';
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  requestId: string;
  createdAt: string;
  sourceUserMessageId?: string;
  sourcePrompt?: string;
  regenerated?: boolean;
  state?: 'complete' | 'stopped';
}
interface Thread {
  id: string;
  title: string;
  updatedAt: string;
  archivedAt?: string;
  matchPreview?: string;
}
const releases: (() => void)[] = [];
test.afterEach(() => {
  for (const release of releases.splice(0)) release();
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}

async function fixture(page: Page, school = false) {
  const threads: Thread[] = [],
    messages = new Map<string, Message[]>();
  const searches: Array<{
    query: string;
    archived: boolean;
    cursor: string | null;
    at: string | null;
  }> = [];
  const regenerations: Array<{
    threadId: string;
    sourceUserMessageId: string;
    requestId: string;
    model?: string;
  }> = [];
  const archives: Array<{ id: string; archived: boolean }> = [];
  const resultReads: string[] = [],
    normalPosts: string[] = [];
  const scopeCalls: Array<{ path: string; method: string; scope: string | undefined }> = [];
  const authRefreshes: string[] = [];
  const controls = {
    holdGeneration: false,
    holdArchive: false,
    uncertain: false,
    readFailure: false,
    generationDenied: false,
  };
  const generationGate = gate(),
    archiveGate = gate();
  function addThread(title = 'Схема проекта'): Thread {
    const thread = { id: randomUUID(), title, updatedAt: NOW };
    threads.push(thread);
    messages.set(thread.id, []);
    return thread;
  }
  function addQuestion(threadId: string, content: string, answer?: string): Message {
    const question: Message = {
      id: randomUUID(),
      requestId: randomUUID(),
      role: 'user',
      content,
      createdAt: NOW,
    };
    messages.get(threadId)!.push(question);
    if (answer)
      messages.get(threadId)!.push({
        id: randomUUID(),
        requestId: question.requestId,
        role: 'assistant',
        content: answer,
        createdAt: NOW,
        sourceUserMessageId: question.id,
        sourcePrompt: question.content,
        state: 'complete',
      });
    return question;
  }
  function saveVariant(
    operation: (typeof regenerations)[number],
    content = 'Сохранённый новый вариант',
    state: 'complete' | 'stopped' = 'complete',
  ) {
    const history = messages.get(operation.threadId)!;
    const source = history.find((message) => message.id === operation.sourceUserMessageId)!;
    const message: Message = {
      id: randomUUID(),
      role: 'assistant',
      content,
      requestId: operation.requestId,
      createdAt: NOW,
      sourceUserMessageId: source.id,
      sourcePrompt: source.content,
      regenerated: true,
      state,
    };
    history.push(message);
    return message;
  }
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === '/api/auth/me')
      return reply(
        school
          ? { authenticated: false }
          : {
              authenticated: true,
              user: { id: ACCOUNT, displayName: 'Участник', email: 'student@example.test' },
              account: { id: ACCOUNT, displayName: 'Участник', email: 'student@example.test' },
              capabilities: [],
              workspaces: [
                { workspaceId: WORKSPACE, kind: 'personal', title: 'Личное', role: 'owner' },
              ],
              activeWorkspace: { workspaceId: WORKSPACE, kind: 'personal' },
              navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
            },
      );
    if (path === '/api/class-join/me')
      return reply(
        school
          ? {
              authenticated: true,
              student: { seatId: SEAT, displayName: 'Участник', safeMode: true, avatarKey: null },
              classroom: {
                id: CLASS,
                title: 'Школьная лаборатория',
                teacherDisplayName: 'Преподаватель',
              },
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            }
          : { authenticated: false },
      );
    if (path === '/api/auth/refresh') {
      authRefreshes.push(path);
      return reply({ error: { code: 'refresh_not_applicable' } }, 409);
    }
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: 'collapsed', revision: 0 });
    if (path === '/api/account/avatar') return reply({ avatarDataUrl: null });
    if (path === '/api/auth/max/status')
      return reply({ linked: false, available: false, promptDue: false });
    if (path === '/api/auth/max/config') return reply({ enabled: false, launchUrl: null });
    if (path === '/api/ai/scopes')
      return reply({
        personal: !school,
        items: school
          ? [
              {
                seatId: SEAT,
                classroomId: CLASS,
                classroomTitle: 'Школьная лаборатория',
                displayName: 'Участник',
              },
            ]
          : [],
      });
    if (path.startsWith('/api/ai/')) {
      const scope = request.headers()['x-asa-ai-seat'];
      scopeCalls.push({ path, method, scope });
      if (school && scope !== SEAT)
        return reply(
          { error: { code: 'ai_scope_denied', message: 'Неверный школьный контекст.' } },
          403,
        );
    }
    if (path === '/api/ai/status')
      return reply({
        enabled: !controls.generationDenied,
        providerEnabled: true,
        canGenerate: !controls.generationDenied,
        reason: controls.generationDenied ? 'ai_student_denied' : null,
        provider: 'openai',
        model: 'gpt-5-mini',
        availableModels: ['gpt-5-mini', 'gpt-4.1-mini'],
      });
    if (path === '/api/ai/threads' && method === 'GET') {
      const query = url.searchParams.get('q') ?? '',
        archived = url.searchParams.get('archived') === 'true';
      const cursor = url.searchParams.get('beforeId');
      searches.push({ query, archived, cursor, at: url.searchParams.get('beforeAt') });
      const matching = threads
        .filter((thread) => !!thread.archivedAt === archived)
        .flatMap((thread) => {
          const hit = query
            ? messages
                .get(thread.id)
                ?.find((message) =>
                  message.content
                    .toLocaleLowerCase('ru-RU')
                    .includes(query.toLocaleLowerCase('ru-RU')),
                )
            : undefined;
          return !query ||
            thread.title.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU')) ||
            hit
            ? [{ ...thread, ...(hit ? { matchPreview: hit.content.slice(0, 180) } : {}) }]
            : [];
        });
      const offset = cursor ? matching.findIndex((thread) => thread.id === cursor) + 1 : 0;
      const items = matching.slice(offset, offset + 50),
        last = items.at(-1);
      return reply({
        items,
        nextCursor:
          offset + 50 < matching.length && last ? { at: last.updatedAt, id: last.id } : null,
      });
    }
    if (path === '/api/ai/threads' && method === 'POST')
      return reply({ id: addThread('Новый диалог').id }, 201);
    const archive = /^\/api\/ai\/threads\/([^/]+)\/archive$/.exec(path);
    if (archive && method === 'PATCH') {
      const body = request.postDataJSON() as { archived: boolean },
        thread = threads.find((item) => item.id === archive[1])!;
      archives.push({ id: thread.id, archived: body.archived });
      if (controls.holdArchive) await archiveGate.promise;
      if (body.archived) thread.archivedAt = NOW;
      else delete thread.archivedAt;
      return reply(thread);
    }
    const read = /^\/api\/ai\/threads\/([^/]+)\/requests\/([^/]+)$/.exec(path);
    if (read && method === 'GET') {
      resultReads.push(read[2]!);
      if (controls.readFailure)
        return reply(
          {
            error: {
              code: 'history_unavailable',
              message: 'Не удалось проверить сохранённый ответ.',
            },
          },
          503,
        );
      return reply({
        items: messages.get(read[1]!)!.filter((message) => message.requestId === read[2]),
      });
    }
    const regeneration = /^\/api\/ai\/threads\/([^/]+)\/regenerations\/stream$/.exec(path);
    if (regeneration && method === 'POST') {
      const operation = {
        ...(request.postDataJSON() as {
          sourceUserMessageId: string;
          requestId: string;
          model?: string;
        }),
        threadId: regeneration[1]!,
      };
      regenerations.push(operation);
      if (controls.generationDenied)
        return reply(
          {
            error: {
              code: 'ai_student_denied',
              message: 'Преподаватель закрыл доступ к новым ответам.',
            },
          },
          403,
        );
      if (controls.holdGeneration) await generationGate.promise;
      if (controls.uncertain)
        return reply(
          {
            error: {
              code: 'ai_provider_unavailable',
              message: 'Связь с моделью прервалась. Проверьте результат запроса.',
            },
          },
          503,
        );
      const message = saveVariant(operation, 'Вариант ' + regenerations.length + ': новый ответ');
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          'event: delta\ndata: ' +
          JSON.stringify({ text: message.content }) +
          '\n\n' +
          'event: done\ndata: ' +
          JSON.stringify({ messages: [message], replayed: false, stopped: false }) +
          '\n\n',
      });
    }
    const history = /^\/api\/ai\/threads\/([^/]+)\/messages(?:\/stream)?$/.exec(path);
    if (history && method === 'GET') {
      const all = messages.get(history[1]!)!,
        before = url.searchParams.get('beforeId');
      const end = before ? all.findIndex((message) => message.id === before) : all.length;
      const start = Math.max(0, end - 50),
        items = all.slice(start, end),
        first = items[0];
      return reply({
        items,
        nextCursor: start > 0 && first ? { at: first.createdAt, id: first.id } : null,
      });
    }
    if (history && method === 'POST') {
      normalPosts.push(path);
      return reply(
        { error: { code: 'unexpected_send', message: 'Unexpected normal send in this fixture' } },
        400,
      );
    }
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return {
    threads,
    messages,
    searches,
    regenerations,
    archives,
    resultReads,
    normalPosts,
    scopeCalls,
    authRefreshes,
    controls,
    addThread,
    addQuestion,
    saveVariant,
    releaseGeneration: () => {
      controls.holdGeneration = false;
      generationGate.release();
    },
    releaseArchive: () => {
      controls.holdArchive = false;
      archiveGate.release();
    },
  };
}

async function openHistory(page: Page) {
  await expect(page.locator('.asa-ai-chat')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'История диалогов' });
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: 'Открыть историю диалогов' }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}
async function closeMobileHistory(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 1120)
    await page.getByRole('button', { name: 'Закрыть историю', exact: true }).click();
}
async function select(page: Page, title: string) {
  const dialog = await openHistory(page);
  await dialog.getByRole('button', { name: title, exact: true }).click();
  await expect(page.locator('.asa-ai-current-title')).toHaveText(title);
  await expect(page.locator('.chat-turn')).not.toHaveCount(0);
}
async function fits(page: Page) {
  const bounds = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.asa-ai-layout')!,
      form = document.querySelector<HTMLElement>('.chat-composer')!;
    return {
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      rootLeft: root.getBoundingClientRect().left,
      rootRight: root.getBoundingClientRect().right,
      bottom: form.getBoundingClientRect().bottom,
      viewport: window.visualViewport?.height ?? window.innerHeight,
    };
  });
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.rootLeft).toBeGreaterThanOrEqual(11);
  expect(bounds.rootRight).toBeLessThanOrEqual(bounds.width - 11);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport + 1);
  await expect(page.locator('.portal-global-error')).toHaveCount(0);
}

for (const width of [320, 390, 1024, 1440]) {
  test(`AI archive and restore retain the current draft, math and history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const f = await fixture(page),
      thread = f.addThread();
    f.addQuestion(
      thread.id,
      'Как работает формула?',
      'Связь $E=mc^2$.\n\n$$\n\\frac{1}{2}mv^2\n$$',
    );
    await page.goto('/#/ai');
    await select(page, thread.title);
    const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    await draft.fill('Черновик, который должен остаться');
    const before = [...f.messages.get(thread.id)!];
    const history = await openHistory(page);
    await history.getByRole('button', { name: 'В архив: ' + thread.title, exact: true }).click();
    await expect(history.getByRole('button', { name: thread.title, exact: true })).toHaveCount(0);
    // Archival remains supported but is deliberately outside the primary chat rail.
    await history.locator('details.chat-history-overflow > summary').click();
    await history.getByRole('button', { name: 'Архивные диалоги', exact: true }).click();
    await expect(history.getByRole('button', { name: thread.title, exact: true })).toBeVisible();
    await closeMobileHistory(page);
    await expect(page.getByText('Диалог в архиве. Переписка и черновик сохранены.')).toBeVisible();
    await expect(draft).toHaveValue('Черновик, который должен остаться');
    await expect(
      page.getByRole('button', { name: 'Отправить сообщение', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Новый вариант ответа', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Восстановить диалог', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Отправить сообщение', exact: true }),
    ).toBeEnabled();
    await expect(draft).toHaveValue('Черновик, который должен остаться');
    await expect(page.locator('.katex')).toHaveCount(2);
    expect(f.messages.get(thread.id)).toEqual(before);
    expect(f.archives).toEqual([
      { id: thread.id, archived: true },
      { id: thread.id, archived: false },
    ]);
    expect(f.regenerations).toHaveLength(0);
    expect(f.normalPosts).toHaveLength(0);
    await fits(page);
    await page.screenshot({
      path: test.info().outputPath('ai-text-archive-restored-' + width + '.png'),
    });
  });
}

test('AI searches a message older than the latest 80 in a thread beyond the initial 50', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const f = await fixture(page);
  for (let index = 0; index < 56; index += 1) f.addThread('Недавний диалог ' + index);
  const older = f.addThread('Проект без поискового слова');
  f.addQuestion(older.id, 'Глубокая история: ключевой термин находится только здесь.');
  for (let index = 0; index < 110; index += 1) f.addQuestion(older.id, 'Поздний вопрос ' + index);
  await page.goto('/#/ai');
  const history = await openHistory(page),
    draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await draft.fill('Черновик перед поиском');
  await expect(history.getByRole('button', { name: older.title, exact: true })).toHaveCount(0);
  await history.getByRole('searchbox', { name: 'Найти диалог' }).fill('ключевой');
  await expect(history.getByRole('button', { name: older.title, exact: true })).toBeVisible();
  await expect(history.locator('.chat-history-preview')).toContainText('ключевой термин');
  expect(f.searches.at(-1)?.query).toBe('ключевой');
  await history.getByRole('button', { name: older.title, exact: true }).click();
  await expect(page.locator('.chat-turn')).toHaveCount(50);
  await expect(page.locator('.chat-turn').filter({ hasText: 'Глубокая история' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Загрузить предыдущие сообщения' }).click();
  await page.getByRole('button', { name: 'Загрузить предыдущие сообщения' }).click();
  await expect(page.locator('.chat-turn').first()).toContainText('Глубокая история');
  await expect(draft).toHaveValue('Черновик перед поиском');
});

for (const oldOperation of ['search', 'pagination']) {
  test(`AI ignores a late ${oldOperation} response even when transport cancellation is unavailable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.addInitScript(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) =>
        String(input).includes('/api/ai/threads?') && (!init?.method || init.method === 'GET')
          ? fetch(input, { ...init, signal: undefined })
          : fetch(input, init);
    });
    const f = await fixture(page),
      current = f.addThread('Текущий диалог');
    f.addQuestion(current.id, 'Текущая переписка', 'Прежний ответ');
    for (let index = 0; index < 54; index += 1) f.addThread('Старый ' + index);
    const correct = f.addThread('Новый результат'),
      delayed = gate();
    let intercepted = false;
    await page.route(/\/api\/ai\/threads\?/, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (oldOperation === 'search' ? params.get('q') === 'Старый' : params.has('beforeId')) {
        intercepted = true;
        await delayed.promise;
        return route.fulfill({
          json: {
            items: [{ id: randomUUID(), title: 'Устаревший результат', updatedAt: NOW }],
            nextCursor: null,
          },
        });
      }
      return route.fallback();
    });
    await page.goto('/#/ai');
    await select(page, current.title);
    const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
    await draft.fill('Не терять при смене поиска');
    const history = await openHistory(page),
      search = history.getByRole('searchbox', { name: 'Найти диалог' });
    if (oldOperation === 'search') await search.fill('Старый');
    else await history.getByRole('button', { name: 'Показать больше диалогов' }).click();
    await expect.poll(() => intercepted).toBe(true);
    await search.fill('Новый');
    await expect(history.getByRole('button', { name: correct.title, exact: true })).toBeVisible();
    const response = page.waitForResponse((item) =>
      oldOperation === 'search'
        ? new URL(item.url()).searchParams.get('q') === 'Старый'
        : new URL(item.url()).searchParams.has('beforeId'),
    );
    delayed.release();
    await response;
    await expect(
      history.getByRole('button', { name: 'Устаревший результат', exact: true }),
    ).toHaveCount(0);
    await expect(history.getByRole('button', { name: correct.title, exact: true })).toBeVisible();
    await expect(page.locator('.asa-ai-current-title')).toHaveText(current.title);
    await expect(draft).toHaveValue('Не терять при смене поиска');
  });
}

test('AI creates a fresh variant of the chosen earlier answer without changing later messages or the draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const f = await fixture(page),
    thread = f.addThread();
  const source = f.addQuestion(thread.id, 'Оригинальный вопрос', 'Оригинальный ответ');
  f.addQuestion(thread.id, 'Поздний вопрос', 'Поздний ответ');
  const original = [...f.messages.get(thread.id)!];
  f.controls.holdGeneration = true;
  await page.goto('/#/ai');
  await select(page, thread.title);
  const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await draft.fill('Мой неотправленный вопрос');
  await page.getByRole('combobox', { name: 'Модель ИИ' }).selectOption('gpt-4.1-mini');
  await page
    .locator('.chat-turn-assistant')
    .filter({ hasText: 'Оригинальный ответ' })
    .getByRole('button', { name: 'Новый вариант ответа' })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect.poll(() => f.regenerations.length).toBe(1);
  expect(f.regenerations[0]).toMatchObject({
    threadId: thread.id,
    sourceUserMessageId: source.id,
    model: 'gpt-4.1-mini',
  });
  expect(original.map((message) => message.requestId)).not.toContain(f.regenerations[0]!.requestId);
  await expect(page.locator('.chat-turn-user')).toHaveCount(2);
  await expect(page.getByTestId('ai-pending-message')).toHaveCount(0);
  f.releaseGeneration();
  const variant = page
    .locator('.chat-turn-assistant')
    .filter({ hasText: 'Вариант 1: новый ответ' });
  await expect(variant).toBeVisible();
  await variant.locator('summary').click();
  await expect(variant.locator('.chat-variant-source p')).toHaveText(source.content);
  await expect(draft).toHaveValue('Мой неотправленный вопрос');
  expect(f.messages.get(thread.id)!.slice(0, original.length)).toEqual(original);
  await variant.getByRole('button', { name: 'Новый вариант ответа' }).click();
  await expect(
    page.locator('.chat-turn-assistant').filter({ hasText: 'Вариант 2: новый ответ' }),
  ).toBeVisible();
  expect(f.regenerations[1]!.requestId).not.toBe(f.regenerations[0]!.requestId);
  expect(f.regenerations[1]!.sourceUserMessageId).toBe(source.id);
  await expect(page.locator('.chat-turn-user')).toHaveCount(2);
  expect(f.normalPosts).toHaveLength(0);
});

test('AI checks an uncertain variant by reading its original request without another paid POST', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page),
    thread = f.addThread();
  f.addQuestion(thread.id, 'Вопрос перед обрывом', 'Первый ответ');
  f.controls.uncertain = true;
  await page.goto('/#/ai');
  await select(page, thread.title);
  const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await draft.fill('Черновик переживает обрыв');
  await page.getByRole('button', { name: 'Новый вариант ответа' }).click();
  const check = page.getByRole('button', { name: 'Проверить сохранённый ответ' });
  await expect(check).toBeVisible();
  await check.click();
  await expect(
    page
      .locator('.chat-main')
      .getByRole('alert')
      .getByText(
        'Сохранённого ответа пока нет. Проверка не запускает модель и не расходует лимит.',
      ),
  ).toBeVisible();
  f.saveVariant(f.regenerations[0]!, 'Вариант, сохранённый после обрыва', 'stopped');
  await check.click();
  await expect(page.locator('.chat-turn-assistant').last()).toContainText(
    'Вариант, сохранённый после обрыва',
  );
  await expect(page.locator('.chat-turn-assistant').last()).toContainText('Ответ остановлен.');
  await expect(check).toHaveCount(0);
  expect(f.regenerations).toHaveLength(1);
  expect(f.resultReads.every((id) => id === f.regenerations[0]!.requestId)).toBe(true);
  expect(f.resultReads.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.chat-turn-user')).toHaveCount(1);
  await expect(draft).toHaveValue('Черновик переживает обрыв');
  await fits(page);
});

test('AI archive completion refreshes the current search without replacing the selected chat or draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const f = await fixture(page),
    current = f.addThread('Текущий проект'),
    other = f.addThread('Другой проект');
  f.addQuestion(current.id, 'Текущий вопрос', 'Сохранённый ответ');
  f.controls.holdArchive = true;
  await page.goto('/#/ai');
  await select(page, current.title);
  const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await draft.fill('Черновик при архивировании');
  const history = await openHistory(page);
  await history.getByRole('button', { name: 'В архив: ' + current.title }).click();
  await expect.poll(() => f.archives.length).toBe(1);
  await history.getByRole('searchbox', { name: 'Найти диалог' }).fill('Другой');
  await expect(history.getByRole('button', { name: other.title, exact: true })).toBeVisible();
  await expect(history.getByRole('button', { name: other.title, exact: true })).toBeDisabled();
  f.releaseArchive();
  await expect(history.getByRole('button', { name: other.title, exact: true })).toBeEnabled();
  expect(f.searches.at(-1)?.query).toBe('Другой');
  await expect(page.locator('.asa-ai-current-title')).toHaveText(current.title);
  await expect(page.getByText('Диалог в архиве. Переписка и черновик сохранены.')).toBeVisible();
  await expect(draft).toHaveValue('Черновик при архивировании');
  await expect(history.getByRole('button', { name: current.title, exact: true })).toHaveCount(0);
});

test('AI keeps a failed saved-answer check distinct from an empty result and retries only the read', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page),
    thread = f.addThread();
  f.addQuestion(thread.id, 'Вопрос с неясным результатом', 'Первый ответ');
  f.controls.uncertain = true;
  await page.goto('/#/ai');
  await select(page, thread.title);
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Сохранить черновик');
  await page.getByRole('button', { name: 'Новый вариант ответа' }).click();
  const check = page.getByRole('button', { name: 'Проверить сохранённый ответ' });
  await expect(check).toBeVisible();
  f.controls.readFailure = true;
  await check.click();
  const alert = page.locator('.chat-main').getByRole('alert');
  await expect(alert).toContainText('Не удалось проверить сохранённый ответ.');
  await expect(alert).not.toContainText('Сохранённого ответа пока нет.');
  f.saveVariant(f.regenerations[0]!, 'Ответ был сохранён, хотя чтение не удалось');
  f.controls.readFailure = false;
  await check.click();
  await expect(page.locator('.chat-turn-assistant').last()).toContainText(
    'Ответ был сохранён, хотя чтение не удалось',
  );
  await expect(check).toHaveCount(0);
  expect(f.regenerations).toHaveLength(1);
  expect(f.resultReads.every((id) => id === f.regenerations[0]!.requestId)).toBe(true);
  expect(f.normalPosts).toHaveLength(0);
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toHaveValue(
    'Сохранить черновик',
  );
});

test('Seat text history keeps one school owner for search, archive, regeneration and free uncertain-result checks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, true),
    thread = f.addThread('Школьный проект');
  f.addQuestion(thread.id, 'Сохранённый школьный вопрос', 'Сохранённый школьный ответ');
  f.controls.uncertain = true;
  await page.goto('/#/ai');
  await expect(page.getByText('Школьный чат', { exact: true })).toBeVisible();
  await select(page, thread.title);
  const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await draft.fill('Школьный черновик');
  await page.getByRole('button', { name: 'Новый вариант ответа', exact: true }).click();
  const check = page.getByRole('button', { name: 'Проверить сохранённый ответ' });
  await expect(check).toBeVisible();
  expect(f.regenerations).toHaveLength(1);
  f.saveVariant(f.regenerations[0]!, 'Сохранённый школьный вариант', 'stopped');
  await check.click();
  await expect(page.locator('.chat-turn-assistant').last()).toContainText(
    'Сохранённый школьный вариант',
  );
  const history = await openHistory(page);
  await history.getByRole('searchbox', { name: 'Найти диалог' }).fill('школьный вопрос');
  await expect(history.getByRole('button', { name: thread.title, exact: true })).toBeVisible();
  await expect.poll(() => f.searches.at(-1)?.query).toBe('школьный вопрос');
  await history.getByRole('button', { name: 'В архив: ' + thread.title }).click();
  // Archival remains supported but is deliberately outside the primary chat rail.
    await history.locator('details.chat-history-overflow > summary').click();
    await history.getByRole('button', { name: 'Архивные диалоги', exact: true }).click();
  await expect(history.getByRole('button', { name: thread.title, exact: true })).toBeVisible();
  await closeMobileHistory(page);
  await page.getByRole('button', { name: 'Восстановить диалог', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Отправить сообщение', exact: true }),
  ).toBeEnabled();
  await expect(draft).toHaveValue('Школьный черновик');
  expect(f.regenerations).toHaveLength(1);
  expect(f.resultReads.length).toBeGreaterThanOrEqual(2);
  expect(f.resultReads.every((id) => id === f.regenerations[0]!.requestId)).toBe(true);
  expect(f.archives).toEqual([
    { id: thread.id, archived: true },
    { id: thread.id, archived: false },
  ]);
  expect(f.scopeCalls.length).toBeGreaterThan(8);
  expect(f.scopeCalls.every((call) => call.scope === SEAT)).toBe(true);
  expect(f.authRefreshes).toEqual([]);
  expect(f.normalPosts).toEqual([]);
  await expect(page.locator('.chat-turn-user')).toHaveCount(1);
  await fits(page);
});

test('Seat regeneration denied by the teacher refreshes only AI access and preserves history and draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, true),
    thread = f.addThread();
  f.addQuestion(thread.id, 'Мой школьный вопрос', 'Мой прежний ответ');
  await page.goto('/#/ai');
  await select(page, thread.title);
  const draft = page.getByRole('textbox', { name: 'Сообщение ИИ' });
  await draft.fill('Не терять после отзыва доступа');
  f.controls.generationDenied = true;
  await page.getByRole('button', { name: 'Новый вариант ответа', exact: true }).click();
  await expect(page.getByText(/Преподаватель пока не разрешил ИИ-чат/)).toBeVisible();
  await expect(draft).toBeDisabled();
  await expect(draft).toHaveValue('Не терять после отзыва доступа');
  await expect(page.locator('.chat-turn-assistant')).toHaveText(/Мой прежний ответ/);
  await expect(
    page.getByRole('button', { name: 'Новый вариант ответа', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Проверить сохранённый ответ' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Проверить доступ' }).click();
  await expect(draft).toBeDisabled();
  expect(f.regenerations).toHaveLength(1);
  expect(f.resultReads).toEqual([]);
  expect(f.normalPosts).toEqual([]);
  expect(f.authRefreshes).toEqual([]);
  expect(f.scopeCalls.every((call) => call.scope === SEAT)).toBe(true);
  await fits(page);
});

test('AI renders inline/block math and escaped formula failures without executing markup or overflowing 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const problems: string[] = [],
    external: string[] = [];
  page.on('pageerror', (problem) => problems.push(problem.message));
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url());
  });
  const f = await fixture(page),
    thread = f.addThread('Формулы и проверка оформления');
  f.addQuestion(
    thread.id,
    'Покажи формулы и пример кода',
    String.raw`Текст с $x^2 + y^2 = z^2$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

Повреждённая формула:

$$
\frac{<script>window.__aiInjected=1</script>
$$

$\href{javascript:window.__aiInjected=2}{ссылка}$ $\includegraphics{https://example.invalid/tracker}$

<img src="https://example.invalid/html" onerror="window.__aiInjected=3">

[опасная ссылка](javascript:window.__aiInjected=4)

| Формула | Пояснение |
|---|---|
| $E=mc^2$ | Энергия |

` + '\n```js\nconst price = "$10";\n```',
  );
  await page.goto('/#/ai');
  await select(page, thread.title);
  await expect(page.locator('.katex-display .katex')).not.toHaveCount(0);
  await expect(page.locator('.katex-error')).not.toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Копировать код' })).toBeVisible();
  await expect(
    page.locator(
      '.chat-turn-assistant script, .chat-turn-assistant img, .chat-turn-assistant iframe, .chat-turn-assistant a[href^="javascript:"]',
    ),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>)['__aiInjected']),
  ).toBeUndefined();
  expect(external).toEqual([]);
  expect(problems).toEqual([]);
  await fits(page);
  await page.screenshot({ path: test.info().outputPath('ai-math-safe-320.png') });
});
