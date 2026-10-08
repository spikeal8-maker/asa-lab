import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

// Production-built UI, synthetic API only: no listening server or real student data.
const origin = 'http://127.0.0.1:4612';
const classId = '10000000-0000-4000-8000-000000000001';
const classCode = 'ABC DEF 234';
const evidence = 'reports/playwright/classroom-owner-evidence';
const seat = (index: number, label = `Ученик ${String(index + 1).padStart(2, '0')}`) => ({
  id: `seat-${index}`,
  displayLabel: label,
  studentCode: `Aa${String(index).padStart(4, '0')}`,
  loginHandle: `Aa${String(index).padStart(4, '0')}`,
  safeMode: true,
  status: 'active',
  avatarKey: null,
  lastActiveAt: null,
  createdAt: '2026-10-08T09:00:00Z',
  assignedCount: 3,
  submittedCount: index % 3,
  awaitingReview: 0,
});

async function fixture(
  page: Page,
  count = 0,
  options: { account?: boolean; lostResponse?: boolean } = {},
) {
  const dist = resolve('apps/web/dist');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    const path = resolve(
      dist,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (!path.startsWith(`${dist}${sep}`) || !existsSync(path)) return route.abort();
    return route.fulfill({ path });
  });
  let students = Array.from({ length: count }, (_, i) => seat(i));
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  const receipts = new Map<string, unknown>();
  let loseResponse = options.lostResponse ?? false;
  const classroom = () => ({
    id: classId,
    title: '7А Робототехника',
    status: 'active',
    ageBand: 'mixed',
    topicKeys: [],
    safeModeDefault: true,
    studentCount: students.length,
    joinCodeVersion: 1,
    joinCodeStatus: 'active',
    joinCode: classCode,
    teacherRole: 'owner',
    workspaceKind: 'personal',
    workspaceTitle: 'Личное пространство',
    createdAt: '2026-10-08T09:00:00Z',
    archivedAt: null,
    assignedCount: 3,
    submittedCount: students.reduce((sum, row) => sum + row.submittedCount, 0),
    awaitingReview: 0,
    behindCount: students.filter((row) => row.submittedCount === 0).length,
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (!['GET', 'HEAD'].includes(method))
      mutations.push({ path, body: request.postDataJSON() ?? {} });
    if (path === '/api/auth/me')
      return reply({
        authenticated: true,
        user: {
          id: 'account-1',
          email: 'synthetic@example.test',
          displayName: 'Тестовый преподаватель',
        },
        account: {
          id: 'account-1',
          email: 'synthetic@example.test',
          displayName: 'Тестовый преподаватель',
        },
        capabilities: [
          { capability: 'creator', state: 'verified' },
          ...(options.account ? [] : [{ capability: 'educator', state: 'verified' }]),
        ],
        workspaces: [
          {
            workspaceId: 'workspace-1',
            kind: 'personal',
            title: 'Личное пространство',
            role: 'owner',
          },
        ],
        activeWorkspace: { workspaceId: 'workspace-1', kind: 'personal' },
        navigation: {
          classes: !options.account,
          classroomManagement: !options.account,
          contentAuthoring: !options.account,
        },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: 'expanded', revision: 0 });
    if (path === '/api/account/avatar') return reply({ avatarDataUrl: null });
    if (path === '/api/auth/max/status')
      return reply({ available: false, linked: false, promptDue: false });
    if (path === '/api/classrooms') return reply({ items: [classroom()], meta: { total: 1 } });
    if (path === `/api/classrooms/${classId}`) return reply({ classroom: classroom() });
    if (path === `/api/classrooms/${classId}/roster`) return reply({ items: students });
    if (path.endsWith('/awards')) return reply({ items: {} });
    if (path.endsWith('/progress'))
      return reply({
        seatCount: students.length,
        assignedCount: 3,
        submittedCount: 0,
        awaitingReview: 0,
        behindCount: students.length,
      });
    if (path === '/api/classrooms/awaiting-review') return reply({ total: 0 });
    if (path === `/api/classrooms/${classId}/seats/batch`) {
      const input = request.postDataJSON() as {
        requestId: string;
        students: Array<{ displayLabel: string }>;
      };
      if (!receipts.has(input.requestId)) {
        const created = input.students.map((row, index) =>
          seat(students.length + index, row.displayLabel),
        );
        students = [...students, ...created];
        receipts.set(input.requestId, {
          requestId: input.requestId,
          reused: false,
          created: created.length,
          credentialsAvailable: false,
          results: created.map((row, index) => ({
            index,
            status: 'created',
            reasonCode: 'created',
            displayLabel: row.displayLabel,
            studentCode: row.studentCode,
            loginHandle: row.studentCode,
            safeMode: true,
            seatId: row.id,
            credentialVersion: 1,
            credential: null,
          })),
        });
      }
      if (loseResponse) {
        loseResponse = false;
        return route.abort();
      }
      return reply(receipts.get(input.requestId));
    }
    if (path === '/api/class-join/resolve') {
      if (request.postDataJSON().code !== classCode)
        return reply(
          { error: { code: 'class_not_found', message: 'Класс не найден. Проверьте ссылку.' } },
          404,
        );
      return reply({
        classroom: {
          id: classId,
          title: '7А Робототехника',
          teacherDisplayName: 'Преподаватель',
          safeMode: true,
        },
      });
    }
    if (path === '/api/class-join/account')
      return reply({
        classroom: { id: classId, title: '7А Робототехника' },
        seatId: null,
        requestId: 'request-1',
        alreadyMember: false,
        status: 'pending',
      });
    if (path === '/api/learning/notifications/preferences')
      return reply({
        revision: 0,
        masterEnabled: true,
        categories: {
          NC01: true,
          NC02: true,
          NC03: true,
          NC04: true,
          NC05: true,
          NC06: true,
          NC08: true,
        },
        classOverrides: {},
        classes: [{ id: classId, title: '7А Робототехника' }],
      });
    if (path.endsWith('/reminders')) return reply({ revision: 0, due: true, overdue: true });
    if (path === '/api/learning/notifications')
      return reply({ items: [], unread: 0, snapshot: '2026-10-08T00:00:00Z' });
    if (method === 'GET')
      return reply({
        items: [],
        invitations: [],
        meta: { total: 0 },
        title: null,
        version: null,
        bands: [],
      });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return { mutations, errors, students: () => students };
}

test.beforeAll(() => mkdirSync(evidence, { recursive: true }));
test.describe('Classroom owner fixes', () => {
  test('one Add opens only the new access cards, with twenty per sheet', async ({ page }) => {
    const state = await fixture(page, 1);
    await page.goto(`/#/classrooms/${classId}`);
    await page.getByRole('button', { name: 'Добавить списком', exact: true }).click();
    const input = page.getByRole('dialog', { name: 'Добавить список учеников' });
    await input
      .getByLabel('Ученики', { exact: true })
      .fill(Array.from({ length: 30 }, (_, i) => `Новый ученик ${i + 1}`).join('\n'));
    await expect(input.getByRole('button', { name: 'Проверить список' })).toHaveCount(0);
    await input.getByRole('button', { name: 'Добавить', exact: true }).click();
    const cards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
    await expect(cards).toBeVisible();
    await expect(cards.locator('.student-access-card')).toHaveCount(30);
    await expect(cards.locator('.student-access-print-page')).toHaveCount(2);
    await expect(cards.locator('.student-access-print-page').first()).toHaveAttribute(
      'data-card-count',
      '20',
    );
    await expect(cards.locator('.student-access-print-page').last()).toHaveAttribute(
      'data-card-count',
      '10',
    );
    expect(state.students()).toHaveLength(31);
    expect(state.mutations.filter((m) => m.path.endsWith('/seats/batch'))).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
  test('lost committed response retries the same request without duplicating learners', async ({
    page,
  }) => {
    const state = await fixture(page, 0, { lostResponse: true });
    await page.goto(`/#/classrooms/${classId}`);
    await page.getByRole('button', { name: 'Добавить списком', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Добавить список учеников' });
    await dialog.getByLabel('Ученики', { exact: true }).fill('Анна\nБорис');
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel('Ученики', { exact: true })).toHaveValue('Анна\nБорис');
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Карточки доступа', exact: true })).toBeVisible();
    const writes = state.mutations.filter((m) => m.path.endsWith('/seats/batch'));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.body.requestId).toBe(writes[1]!.body.requestId);
    expect(state.students()).toHaveLength(2);
    expect(state.errors).toEqual([]);
  });
  for (const count of [20, 30, 40])
    test(`${count} cards produce ${Math.ceil(count / 20)} A4 pages and decodable QR`, async ({
      page,
    }) => {
      const state = await fixture(page, count);
      await page.goto(`/#/classrooms/${classId}`);
      await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
      const cards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
      await expect(cards.getByTestId('class-join-qr')).toHaveCount(count);
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.body.classList.add('student-access-printing'));
      const first = page.locator('.student-access-print-page').first();
      const geometry = await first.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        cards: [...element.querySelectorAll<HTMLElement>('.student-access-card')].map((card) => ({
          x: card.offsetLeft,
          y: card.offsetTop,
          overflow: card.scrollHeight - card.clientHeight,
        })),
      }));
      expect(geometry.cards).toHaveLength(20);
      expect(geometry.width).toBeLessThanOrEqual((196 * 96) / 25.4 + 1);
      expect(geometry.height).toBeLessThanOrEqual((283 * 96) / 25.4);
      expect(new Set(geometry.cards.map((card) => card.x)).size).toBe(2);
      expect(new Set(geometry.cards.map((card) => card.y)).size).toBe(10);
      expect(geometry.cards.every((card) => card.overflow <= 1)).toBe(true);
      const qrBytes = await page.getByTestId('class-join-qr').first().screenshot();
      const png = PNG.sync.read(qrBytes);
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      expect(decoded?.data).toBe(`${origin}/#/join-class?code=ABC%20DEF%20234`);
      await first.screenshot({ path: `${evidence}/cards-${count}-first-page.png` });
      const pdf = await page.pdf({
        path: `${evidence}/cards-${count}.pdf`,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      });
      // Chromium writes one uncompressed Page dictionary per output page.
      expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(
        Math.ceil(count / 20),
      );

      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await expect(page.locator('body')).not.toHaveClass(/student-access-printing/);
      expect(state.mutations.filter((m) => !m.path.endsWith('/resolve'))).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  for (const width of [1440, 1024, 390, 320])
    test(`compact classroom and settings at ${width}px`, async ({ page }) => {
      const state = await fixture(page, 3);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#/classrooms');
      await expect(
        page.locator('.classroom-title-row').getByRole('heading', { name: 'Мои классы' }),
      ).toBeVisible();
      await expect(page.getByLabel('Итоги по классам')).toHaveCount(1);
      if (width === 1440) {
        const row = page.getByTestId('classroom-card');
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(38);
        expect(
          await row.locator('.classroom-row-title').evaluate((e) => getComputedStyle(e).fontSize),
        ).toBe('16px');
      }
      await page.goto(`/#/classrooms/${classId}`);
      await expect(page.getByRole('heading', { name: /7А Робототехника/, level: 1 })).toBeVisible();
      await expect(page.locator('.classroom-roster-index')).toHaveText(['1', '2', '3']);
      await expect(page.getByText('Место ученика', { exact: true })).toHaveCount(0);
      if (width === 1440)
        expect(
          (await page.locator('.classroom-roster-row').first().boundingBox())!.height,
        ).toBeLessThanOrEqual(38);
      await expect(page.getByText('Безопасный режим для всех', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: `${evidence}/classroom-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(page.getByText('Безопасный режим для всех', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Шкала новых оцениваемых заданий', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Заявки', exact: true }).click();
      await expect(page.getByText('Код позволяет подать заявку.', { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(state.errors).toEqual([]);
    });
  test('authenticated Account follows class QR without StudentSeat login or session replacement', async ({
    page,
  }) => {
    const state = await fixture(page, 0, { account: true });
    await page.goto(`/#/join-class?code=${encodeURIComponent(classCode)}`);
    await expect(
      page.getByRole('heading', { name: 'Присоединиться к классу', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Код ученика', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Заявка отправлена', exact: true }),
    ).toBeVisible();
    expect(state.mutations.map((m) => m.path)).toEqual([
      '/api/class-join/resolve',
      '/api/class-join/account',
    ]);
    expect(state.mutations[1]!.body).toEqual({ code: classCode });
    expect(state.errors).toEqual([]);
  });
});
