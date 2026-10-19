import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { classId, fixture as classroomFixture } from './fixtures/classroom-owner';

const SEAT = '40000000-0000-4000-8000-000000000001';
const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const WORKSPACE = '30000000-0000-4000-8000-000000000001';
const name = 'Александра Константиновна Михайлова-Смирнова';
const classroomTitle = 'Исследование робототехники и программирования — подготовительная группа';

async function chatFixture(page: Page, personal = false) {
  let allowed = false;
  const calls: Array<{ path: string; scope: string; method: string }> = [];
  const histories = new Map<
    string,
    Array<{ id: string; role: string; content: string; createdAt: string; requestId: string }>
  >();
  const threads = new Map<string, Array<{ id: string; title: string; updatedAt: string }>>([
    ['personal', []],
    [SEAT, []],
  ]);
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === '/api/auth/me')
      return reply(
        personal
          ? {
              authenticated: true,
              user: { id: ACCOUNT, displayName: name },
              account: { id: ACCOUNT, displayName: name },
              capabilities: [],
              workspaces: [
                { workspaceId: WORKSPACE, kind: 'personal', title: 'Личное', role: 'owner' },
              ],
              activeWorkspace: { workspaceId: WORKSPACE, kind: 'personal' },
              navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
            }
          : { authenticated: false },
      );
    if (path === '/api/class-join/me')
      return reply(
        personal
          ? { authenticated: false }
          : {
              authenticated: true,
              student: { seatId: SEAT, displayName: name, safeMode: true, avatarKey: null },
              classroom: {
                id: classId,
                title: classroomTitle,
                teacherDisplayName: 'Преподаватель',
              },
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            },
      );
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: 'collapsed', revision: 0 });
    if (path === '/api/auth/max/status')
      return reply({ available: false, linked: false, promptDue: false });
    if (path === '/api/ai/scopes')
      return reply({
        personal,
        items: [{ seatId: SEAT, classroomId: classId, classroomTitle, displayName: name }],
      });
    const scope = request.headers()['x-asa-ai-seat'] ?? 'personal';
    if (path.startsWith('/api/ai/')) calls.push({ path, scope, method });
    if (path === '/api/ai/status')
      return reply({
        enabled: scope === 'personal' || allowed,
        providerEnabled: true,
        canGenerate: scope === 'personal' || allowed,
        reason: allowed || scope === 'personal' ? null : 'ai_teacher_permission_required',
        provider: 'openai',
        model: 'gpt-5-mini',
        availableModels: ['gpt-5-mini'],
      });
    if (path === '/api/ai/threads') {
      if (method === 'GET') return reply({ items: threads.get(scope), nextCursor: null });
      if (scope === SEAT && !allowed)
        return reply(
          { error: { code: 'ai_student_denied', message: 'Нужно разрешение преподавателя.' } },
          403,
        );
      const id = randomUUID();
      threads.get(scope)!.push({
        id,
        title: scope === SEAT ? 'Школьная история' : 'Личная история',
        updatedAt: new Date().toISOString(),
      });
      histories.set(id, []);
      return reply({ id }, 201);
    }
    const chat = /^\/api\/ai\/threads\/([^/]+)\/messages(?:\/stream)?$/.exec(path);
    if (chat) {
      const history = histories.get(chat[1]!) ?? [];
      if (method === 'GET') return reply({ items: history, nextCursor: null });
      const body = request.postDataJSON() as { message: string; requestId: string };
      const current = [
        {
          id: randomUUID(),
          role: 'user',
          content: body.message,
          createdAt: new Date().toISOString(),
          requestId: body.requestId,
        },
        {
          id: randomUUID(),
          role: 'assistant',
          content: scope === SEAT ? 'Школьный ответ' : 'Личный ответ',
          createdAt: new Date().toISOString(),
          requestId: body.requestId,
        },
      ];
      history.push(...current);
      histories.set(chat[1]!, history);
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'event: done\ndata: ' +
          JSON.stringify({ messages: current, replayed: false, stopped: false }) +
          '\n\n',
      });
    }
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return {
    calls,
    allow: () => {
      allowed = true;
    },
  };
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test('Unavailable school owner remains denied on retry without automatic auth refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await chatFixture(page);
  const refreshes: string[] = [];
  let reads = 0;
  await page.route('**/api/auth/refresh', async (route) => {
    refreshes.push(route.request().url());
    return route.fulfill({ status: 409, json: { error: { code: 'refresh_not_applicable' } } });
  });
  await page.route('**/api/ai/scopes', async (route) => {
    reads += 1;
    return route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'ai_scope_denied',
          message: 'Школьный чат сейчас недоступен. Обратитесь к преподавателю.',
        },
      },
    });
  });
  await page.goto('/#/ai');
  const denial = page.getByRole('alert').filter({ hasText: 'Школьный чат сейчас недоступен.' });
  await expect(denial).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const beforeRetry = reads;
    await denial.getByRole('button', { name: 'Повторить загрузку' }).click();
    await expect.poll(() => reads).toBe(beforeRetry + 1);
    await expect(denial).toBeVisible();
  }
  expect(refreshes).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Контекст чата' })).toHaveCount(0);
  await noOverflow(page);
});

for (const width of [1440, 1024, 390, 320]) {
  test(`Student AI admission, live check and school-only transport at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const fake = await chatFixture(page);
    await page.goto('/#/ai');
    await expect(page.getByText(/Преподаватель пока не разрешил ИИ-чат/)).toBeVisible();
    await expect(page.getByText('Доступ закрыт', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeDisabled();
    await expect(page.getByText('Школьный чат', { exact: true })).toBeVisible();
    await expect(page.getByText(/Для чата нужен вход в личный аккаунт/)).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`student-denied-${width}.png`) });
    fake.allow();
    await page.getByRole('button', { name: 'Проверить доступ' }).click();
    await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeEnabled();
    await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Объясни электрическую цепь');
    await page.getByRole('button', { name: 'Отправить сообщение' }).click();
    await expect(page.getByText('Школьный ответ', { exact: true })).toBeVisible();
    expect(fake.calls.every((call) => call.scope === SEAT)).toBe(true);
    expect(fake.calls.some((call) => call.path.endsWith('/messages/stream'))).toBe(true);
    await noOverflow(page);
    const composer = await page.locator('.chat-composer').boundingBox();
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: info.outputPath(`student-chat-${width}.png`) });
  });
}

test('Account and school scope switch resets draft, request state and private history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fake = await chatFixture(page, true);
  fake.allow();
  await page.goto('/#/ai');
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Личный вопрос');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByText('Личный ответ', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Личный неотправленный черновик');
  await page.getByRole('combobox', { name: 'Контекст чата' }).selectOption(SEAT);
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toHaveValue('');
  await expect(page.getByText('Личный ответ', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Сообщение ИИ' }).fill('Школьный вопрос');
  await page.getByRole('button', { name: 'Отправить сообщение' }).click();
  await expect(page.getByText('Школьный ответ', { exact: true })).toBeVisible();
  const posts = fake.calls.filter((call) => call.path.endsWith('/messages/stream'));
  expect(posts.map((call) => call.scope)).toEqual(['personal', SEAT]);
  await page.getByRole('combobox', { name: 'Контекст чата' }).selectOption('personal');
  await expect(page.getByText('Школьный ответ', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toHaveValue('');
});

for (const width of [1440, 1024, 390, 320]) {
  test(`Teacher class policy, Seat override and exact lost-response retry at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await classroomFixture(page, 1, { classroomTitle, sidebar: 'collapsed' });
    await page.unroute('**/*'); // Use the focused Vite server, keeping fixture API routes.
    let revision = 0,
      mode = 'deny',
      minimum = 50,
      override = 'inherit';
    let failOnce = true;
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/ai/classrooms/*/access', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: {
            classroomId: classId,
            mode,
            minimumRating: minimum,
            revision,
            readOnly: false,
            students: [
              {
                seatId: SEAT,
                displayName: name,
                status: 'active',
                override,
                rating: 73.5,
                canGenerate: override === 'allow' || mode === 'allow',
              },
            ],
          },
        });
      const input = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(input);
      if (input.kind === 'classroom') {
        mode = String(input.mode);
        minimum = Number(input.minimumRating);
      } else override = String(input.override);
      if (failOnce) {
        failOnce = false;
        revision += 1;
        return route.abort('failed');
      }
      if (writes.length !== 2) revision += 1;
      return route.fulfill({ json: { saved: true, revision } });
    });
    await page.goto('/#/classrooms/' + classId);
    await expect(page.getByRole('heading', { name: classroomTitle, exact: true })).toBeVisible();
    const section = page.getByRole('combobox', { name: 'Раздел класса' });
    if (await section.isVisible()) await section.selectOption('settings');
    else
      await page
        .getByRole('navigation', { name: 'Разделы класса' })
        .getByRole('button', { name: 'Настройки', exact: true })
        .click();
    const access = page.locator('.classroom-ai-access');
    await expect(access.getByLabel('Правило класса')).toBeVisible();
    await access.getByLabel('Правило класса').selectOption('rating');
    await access.getByLabel('Минимальный рейтинг').fill('70');
    await access.getByRole('button', { name: 'Сохранить правило класса' }).click();
    await expect(access.getByRole('button', { name: 'Повторить сохранение' })).toBeVisible();
    await access.getByRole('button', { name: 'Повторить сохранение' }).click();
    await expect(access.getByText(/Доступ к ИИ сохранён/)).toBeVisible();
    expect(writes[1]).toEqual(writes[0]);
    await access.locator('summary').click();
    await access.getByLabel('Доступ для ' + name).selectOption('allow');
    await access.getByRole('button', { name: 'Сохранить доступ: ' + name }).click();
    await expect(access.getByText('Доступ разрешён · Рейтинг: 73.5')).toBeVisible();
    expect(writes[2]).toMatchObject({
      kind: 'seat',
      seatId: SEAT,
      override: 'allow',
      expectedRevision: 1,
    });
    await access.scrollIntoViewIfNeeded();
    await noOverflow(page);
    expect(await access.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`teacher-access-${width}.png`), fullPage: true });
  });
}
