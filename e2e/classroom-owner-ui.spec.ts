import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  loginMethod: 'student_code' as const,
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
  options: {
    account?: boolean;
    lostResponse?: boolean;
    origin?: string;
    classroomTitle?: string;
    status?: 'active' | 'archived';
  } = {},
) {
  const origin = options.origin ?? 'http://127.0.0.1:4612';
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
    title: options.classroomTitle ?? '7А Робототехника',
    status: options.status ?? 'active',
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
    if (path === '/api/classrooms/participants/summary')
      return reply(
        { classCount: 1, studentCount: students.length, totalWorks: 0, archivedWorks: 0 },
        201,
      );
    if (path === `/api/classrooms/${classId}/participants`)
      return reply({
        settings: {
          periodDays: 30,
          revision: 0,
          factors: { projects: true, logins: true, days: true, time: true, grades: true },
        },
        items: students.map((student) => ({
          seatId: student.id,
          totalWorks: 0,
          archivedWorks: 0,
          score: 0,
          rank: 1,
          role: 'student',
          avatarUrl: null,
          factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
          sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
        })),
      });
    if (path === `/api/classrooms/${classId}/participants/managers`) return reply([]);
    if (path === `/api/classrooms/${classId}/journal/settings`)
      return reply({ status: classroom().status, scale: { preset: 'five', version: 0 } });
    if (path === `/api/classrooms/${classId}/journal`)
      return reply({
        status: classroom().status,
        timeZone: 'Europe/Moscow',
        scale: { preset: 'five', version: 0 },
        students: students.map((student) => ({
          id: student.id,
          name: student.displayLabel,
          status: student.status,
        })),
        columns: [],
        grades: [],
        offset: 0,
        nextOffset: null,
        range: {
          from: '2026-10-01',
          to: '2026-10-31',
          today: '2026-10-09',
          timeZone: 'Europe/Moscow',
        },
      });
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
    if (method === 'PATCH' && path.startsWith('/api/classrooms/' + classId + '/seats/')) {
      const id = path.split('/').pop();
      const index = students.findIndex((row) => row.id === id);
      if (index < 0)
        return reply({ error: { code: 'not_found', message: 'Ученик не найден' } }, 404);
      students[index] = { ...students[index]!, ...request.postDataJSON() };
      return reply({ student: students[index] });
    }
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
            loginMethod: 'student_code' as const,
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
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
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
      if (width <= 1100)
        await page.getByLabel('Раздел класса', { exact: true }).selectOption('settings');
      else await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(page.getByText('Безопасный режим для всех', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Шкала новых оцениваемых заданий', { exact: true }),
      ).toBeVisible();
      if (width <= 1100)
        await page.getByLabel('Раздел класса', { exact: true }).selectOption('requests');
      else await page.getByRole('button', { name: 'Заявки', exact: true }).click();
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

test.describe('Printed access-card composition', () => {
  const output = 'reports/playwright/settings-ui/card-composition';
  const demoOrigin = 'https://demo.asa.test';
  test('brand and class occupy opposite corners; name is centered above aligned codes', async ({
    browser,
  }) => {
    mkdirSync(output, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 3,
    });
    try {
      const page = await context.newPage();
      const state = await fixture(page, 20, { origin: demoOrigin });
      await page.goto(`${demoOrigin}/#/classrooms/${classId}`);
      await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
      await expect(page.getByTestId('class-join-qr')).toHaveCount(20);
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => document.body.classList.add('student-access-printing'));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const card = page.locator('.student-access-card').first();
      const result = await card.evaluate((element) => {
        const box = (selector: string) =>
          element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const main = box('.student-access-card-copy');
        const name = box('h3');
        const identity = box('.student-access-identity');
        const brand = box('.student-access-brand');
        const group = box('.student-access-class');
        const codes = box('.student-access-codes');
        const labels = [...element.querySelectorAll('.student-access-codes span')].map(
          (el) => el.getBoundingClientRect().top,
        );
        return {
          nameCenterError: Math.abs((name.left + name.right - main.left - main.right) / 2),
          identityCenterError: Math.abs(
            (identity.left + identity.right - main.left - main.right) / 2,
          ),
          nameBelowHeader: name.top >= Math.max(brand.bottom, group.bottom),
          nameAboveCodes: name.bottom <= codes.top,
          brandLeftOfClass: brand.right < group.left,
          labelsAligned: Math.abs(labels[0]! - labels[1]!) <= 1,
          nameFont: parseFloat(getComputedStyle(element.querySelector('h3')!).fontSize),
          studentCodeFont: parseFloat(
            getComputedStyle(element.querySelector('.student-access-student-code code')!).fontSize,
          ),
          classCodeFont: parseFloat(
            getComputedStyle(element.querySelector('.student-access-codes code')!).fontSize,
          ),
          labelFont: parseFloat(
            getComputedStyle(element.querySelector('.student-access-codes span')!).fontSize,
          ),
        };
      });
      expect(result.nameCenterError).toBeLessThanOrEqual(1);
      expect(result.identityCenterError).toBeLessThanOrEqual(1);
      expect(result.nameBelowHeader).toBe(true);
      expect(result.nameAboveCodes).toBe(true);
      expect(result.brandLeftOfClass).toBe(true);
      expect(result.labelsAligned).toBe(true);
      expect(result.nameFont).toBeGreaterThanOrEqual(18.6);
      expect(result.studentCodeFont).toBeGreaterThanOrEqual(25.3);
      expect(result.classCodeFont).toBeGreaterThanOrEqual(16);
      expect(result.labelFont).toBeGreaterThanOrEqual(10.6);
      const png = PNG.sync.read(await card.getByTestId('class-join-qr').screenshot());
      expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(
        `${demoOrigin}/#/join-class?code=ABC%20DEF%20234`,
      );
      await card.screenshot({ path: `${output}/card-detail.png` });
      await page
        .locator('.student-access-print-page')
        .first()
        .screenshot({ path: `${output}/sheet-20.png` });
      const pdf = await page.pdf({
        path: `${output}/cards-20.pdf`,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      });
      expect(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
      writeFileSync(`${output}/geometry.json`, JSON.stringify(result, null, 2));
      expect(state.errors).toEqual([]);
      expect(state.mutations.filter((mutation) => !mutation.path.endsWith('/resolve'))).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const longSite of [false, true]) {
    test(`long names and class remain complete, ${longSite ? 'long' : 'regular'} site`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 3,
      });
      const page = await context.newPage();
      try {
        mkdirSync(output, { recursive: true });
        const portal = longSite
          ? 'https://classroom-really-long-installation-name.example.org'
          : demoOrigin;
        const state = await fixture(page, 20, {
          origin: portal,
          classroomTitle: '7А — Очень длинное название синтетического класса для проверки печати',
        });
        state.students()[0]!.displayLabel =
          'Александра Очень-Длинная-Фамилия-Составная Для Проверки Карточки';
        state.students()[1]!.displayLabel = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';
        state.students()[2]!.studentCode = 'Ab123456';
        await page.goto(`${portal}/#/classrooms/${classId}`);
        await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
        await expect(page.getByTestId('class-join-qr')).toHaveCount(20);
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(() => document.body.classList.add('student-access-printing'));
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        });
        const problems = await page.locator('.student-access-card').evaluateAll((cards) => {
          return cards.flatMap((card, index) => {
            const bounds = card.getBoundingClientRect();
            const codes = card.querySelector('.student-access-codes')!.getBoundingClientRect();
            const header = card.querySelector('.student-access-topline')!.getBoundingClientRect();
            const name = card.querySelector('h3')!.getBoundingClientRect();
            const defects: string[] = [];
            if (name.top < header.bottom - 1 || name.bottom > codes.top + 1)
              defects.push(
                `${index}: identity overlaps: top=${name.top}/${header.bottom} bottom=${name.bottom}/${codes.top}`,
              );
            for (const selector of [
              '.student-access-brand',
              '.student-access-class',
              'h3',
              '.student-access-codes',
              '.student-access-site',
              '.class-qr',
              '.student-access-student-code code',
            ]) {
              const el = card.querySelector<HTMLElement>(selector)!;
              const rect = el.getBoundingClientRect();
              if (
                rect.left < bounds.left - 1 ||
                rect.right > bounds.right + 1 ||
                rect.top < bounds.top - 1 ||
                rect.bottom > bounds.bottom + 1
              )
                defects.push(`${index}: ${selector} outside ticket`);
              if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
                defects.push(
                  `${index}: ${selector} clipped: width=${el.scrollWidth}/${el.clientWidth}; height=${el.scrollHeight}/${el.clientHeight}`,
                );
            }
            return defects;
          });
        });
        await page
          .locator('.student-access-card')
          .first()
          .screenshot({ path: `${output}/long-${longSite ? 'site' : 'name'}.png` });
        expect(problems).toEqual([]);
        const png = PNG.sync.read(await page.getByTestId('class-join-qr').first().screenshot());
        expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(
          `${portal}/#/join-class?code=ABC%20DEF%20234`,
        );
        expect(state.errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  for (const width of [320, 390, 768]) {
    test(`access-card dialog has no clipped codes at ${width}px`, async ({ page }) => {
      const state = await fixture(page, 2);
      state.students()[0]!.studentCode = 'Ab123456';
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/#/classrooms/${classId}`);
      await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
      await expect(dialog).toBeVisible();
      const overflows = await dialog
        .locator('.student-access-card')
        .evaluateAll((cards) =>
          cards.flatMap((card) =>
            [...card.querySelectorAll<HTMLElement>('code,h3,.student-access-class')]
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => el.textContent),
          ),
        );
      expect(overflows).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(state.errors).toEqual([]);
    });
  }
});

test.describe('Owner mobile classroom: usable register', () => {
  const output = 'reports/playwright/classroom-mobile-20261009';
  test.beforeAll(() => mkdirSync(output, { recursive: true }));
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    test(`30 learners: compact rows, complete controls and search at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const state = await fixture(page, 30);
      await page.goto(`/#/classrooms/${classId}`);
      await expect(page.locator('.classroom-roster-row')).toHaveCount(30);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.classroom-roster-row')];
        const bounds = rows.map((row) => row.getBoundingClientRect().toJSON());
        const controls = [
          ...document.querySelectorAll<HTMLElement>('.classroom-roster-actions > button'),
        ].map((node) => node.getBoundingClientRect().toJSON());
        const main = document.querySelector<HTMLElement>('.classroom-owner-workspace')!;
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          mainWidth: main.clientWidth,
          mainScrollWidth: main.scrollWidth,
          firstRow: bounds[0],
          maxRowHeight: Math.max(...bounds.map((row) => row.height)),
          visibleRows: bounds.filter((row) => row.bottom <= innerHeight && row.top >= 0).length,
          controls,
          cells: [...rows[0]!.querySelectorAll<HTMLElement>('*')].map((cell) => {
            const style = getComputedStyle(cell);
            const rect = cell.getBoundingClientRect();
            return {
              class: cell.className,
              text: cell.textContent?.slice(0, 70),
              width: rect.width,
              height: rect.height,
              x: rect.x,
              y: rect.y,
              display: style.display,
              columns: style.gridTemplateColumns,
              row: style.gridRow,
              column: style.gridColumn,
              minWidth: style.minWidth,
            };
          }),
          nameSize: getComputedStyle(rows[0]!.querySelector('.classroom-student-name')!).fontSize,
          statisticsHeight: document.querySelector('.classroom-progress')!.getBoundingClientRect()
            .height,
        };
      });
      writeFileSync(`${output}/geometry-${width}.json`, JSON.stringify(geometry, null, 2));
      await page.screenshot({ path: `${output}/classroom-${width}.png` });
      expect(geometry.documentWidth).toBeLessThanOrEqual(width);
      expect(geometry.mainScrollWidth).toBeLessThanOrEqual(geometry.mainWidth + 1);
      expect(geometry.nameSize).toBe('16px');
      if (width <= 1100) {
        expect(geometry.maxRowHeight).toBeLessThanOrEqual(110);
        expect(geometry.firstRow.top).toBeLessThanOrEqual(430);
        expect(geometry.statisticsHeight).toBeLessThanOrEqual(65);
        expect(geometry.visibleRows).toBeGreaterThanOrEqual(4);
        expect(
          Math.max(...geometry.controls.map((c) => c.y)) -
            Math.min(...geometry.controls.map((c) => c.y)),
        ).toBeLessThan(1);
        for (const control of geometry.controls) {
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.width).toBeGreaterThanOrEqual(44);
        }
        await expect(page.getByLabel('Раздел класса', { exact: true })).toBeVisible();
        await expect(
          page.getByLabel('Раздел класса', { exact: true }).locator('option'),
        ).toHaveCount(8);
        await expect(
          page.getByLabel('Сортировка учащихся', { exact: true }).locator('option'),
        ).toHaveCount(16);
        expect(
          await page
            .getByLabel('Сортировка учащихся', { exact: true })
            .locator('option')
            .evaluateAll((options) =>
              options.map((node) => (node as HTMLOptionElement).value).sort(),
            ),
        ).toEqual([
          'active:asc',
          'active:desc',
          'awaiting:asc',
          'awaiting:desc',
          'code:asc',
          'code:desc',
          'name:asc',
          'name:desc',
          'rating:asc',
          'rating:desc',
          'safe:asc',
          'safe:desc',
          'submitted:asc',
          'submitted:desc',
          'works:asc',
          'works:desc',
        ]);
      } else {
        expect(geometry.maxRowHeight).toBeLessThanOrEqual(40);
        await expect(page.getByRole('navigation', { name: 'Разделы класса' })).toBeVisible();
      }
      await page.getByRole('searchbox', { name: 'Поиск учащихся' }).fill('Ученик 03');
      await expect(page.locator('.classroom-roster-row')).toHaveCount(1);
      await expect(page.locator('.classroom-roster-index')).toHaveText(['1']);
      await page.getByRole('searchbox', { name: 'Поиск учащихся' }).fill('Несуществующий учащийся');
      await expect(
        page.getByRole('status').filter({ hasText: 'Учащиеся не найдены' }),
      ).toBeVisible();
      await page.getByRole('searchbox', { name: 'Поиск учащихся' }).clear();
      await expect(page.locator('.classroom-roster-row')).toHaveCount(30);
      expect(state.errors).toEqual([]);
      expect(state.mutations).toEqual([]);
    });
  }
  test('phone sorting, numbering and selected section survive viewport changes', async ({
    page,
  }) => {
    const state = await fixture(page, 6);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    const sort = page.getByLabel('Сортировка учащихся', { exact: true });
    await sort.selectOption('name:desc');
    await expect(page.locator('.classroom-student-name strong')).toHaveText([
      'Ученик 06',
      'Ученик 05',
      'Ученик 04',
      'Ученик 03',
      'Ученик 02',
      'Ученик 01',
    ]);
    await expect(page.locator('.classroom-roster-index')).toHaveText([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    await sort.selectOption('submitted:desc');
    await expect(page.locator('.classroom-roster-done')).toHaveText([
      '2 из 3',
      '2 из 3',
      '1 из 3',
      '1 из 3',
      '0 из 3',
      '0 из 3',
    ]);
    await page.getByLabel('Раздел класса', { exact: true }).selectOption('settings');
    await expect(
      page.getByRole('heading', { name: 'Настройки класса', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toHaveClass(
      'active',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Раздел класса', { exact: true })).toHaveValue('settings');
    await page.getByLabel('Раздел класса', { exact: true }).selectOption('requests');
    await expect(page.getByRole('button', { name: 'Обновить заявки', exact: true })).toBeVisible();
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
  test('phone safe-mode control calls the existing API and reflects the returned student', async ({
    page,
  }) => {
    const state = await fixture(page, 2);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    const control = page.getByRole('checkbox', {
      name: 'Безопасный режим: Ученик 01',
      exact: true,
    });
    await expect(control).toBeChecked();
    await control.click();
    await expect(control).not.toBeChecked();
    await control.click();
    await expect(control).toBeChecked();
    expect(state.mutations).toHaveLength(2);
    expect(state.mutations.every((mutation) => mutation.path.endsWith('/seats/seat-0'))).toBe(true);
    expect(state.errors).toEqual([]);
  });
  test('long learner names remain readable and row actions remain on screen', async ({ page }) => {
    const state = await fixture(page, 3, {
      classroomTitle: '7А — Робототехника и исследовательские проекты',
    });
    state.students()[0]!.displayLabel = 'Александра Иванова-Петрова';
    state.students()[1]!.displayLabel = 'Константин Александрович Очень-Длинная-Фамилия';
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    await expect(page.locator('.classroom-roster-row')).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    const problems = await page.locator('.classroom-roster-row').evaluateAll((rows) =>
      rows.flatMap((row) => {
        const bounds = row.getBoundingClientRect();
        return [
          ...row.querySelectorAll<HTMLElement>(
            '.classroom-student-name strong,.classroom-row-menu > summary,.classroom-login-handle',
          ),
        ].flatMap((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < bounds.left - 1 ||
            rect.right > bounds.right + 1 ||
            element.scrollWidth > element.clientWidth + 1
            ? [element.className || element.tagName]
            : [];
        });
      }),
    );
    expect(problems).toEqual([]);
    await page.screenshot({ path: `${output}/classroom-long-names-320.png` });
    expect(state.errors).toEqual([]);
  });
  test('denied clipboard has a visible explanation rather than an unhandled failure', async ({
    page,
  }) => {
    const state = await fixture(page, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('denied');
          },
        },
      }),
    );
    await page.locator('.classroom-login-handle').click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Не удалось скопировать код' }),
    ).toBeVisible();
    expect(state.errors).toEqual([]);
  });
});

test.describe('Mobile classroom navigation and restrictions', () => {
  test('single header keeps all global actions and a working drawer', async ({ page }) => {
    const state = await fixture(page, 3);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    await expect(page.locator('.classroom-roster-row')).toHaveCount(3);
    const header = page.locator('.portal-header');
    expect((await header.boundingBox())!.height).toBe(56);
    const controls = header.locator(
      '.portal-menu-toggle,.portal-global-nav a,.portal-quick-create > summary,.portal-account > summary',
    );
    await expect(controls).toHaveCount(5);
    for (const control of await controls.all()) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await expect(page.locator('.portal-sidebar.mobile-open')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.portal-sidebar.mobile-open')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toBeFocused();
    expect(state.errors).toEqual([]);
  });
  test('archived class retains disabled mutation controls on a small phone', async ({ page }) => {
    const state = await fixture(page, 2, { status: 'archived' });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    await expect(
      page.getByRole('button', { name: 'Добавить ученика', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Добавить списком', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('checkbox', { name: 'Безопасный режим: Ученик 01', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Вернуть из архива', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    expect(state.mutations).toEqual([]);
  });
  test('pending reviews remain visible without colliding with code or safety control', async ({
    page,
  }) => {
    const state = await fixture(page, 2);
    state.students()[0]!.awaitingReview = 15;
    state.students()[0]!.assignedCount = 30;
    state.students()[0]!.submittedCount = 15;
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/#/classrooms/${classId}`);
    const row = page.locator('.classroom-roster-row').first();
    await expect(row.locator('.classroom-roster-progress')).toContainText('ждёт проверки: 15');
    const boxes = await row
      .locator('.classroom-row-details')
      .evaluate((element) =>
        ['.classroom-login-handle', '.classroom-roster-progress', '.classroom-seat-safe'].map(
          (selector) => element.querySelector(selector)!.getBoundingClientRect().toJSON(),
        ),
      );
    expect(boxes[0]!.right).toBeLessThanOrEqual(boxes[1]!.left);
    expect(boxes[1]!.right).toBeLessThanOrEqual(boxes[2]!.left);
    expect(boxes[2]!.right).toBeLessThanOrEqual(320);
    expect(state.errors).toEqual([]);
  });
});

test('Account-only access card keeps full name, class and instruction inside its physical ticket', async ({
  page,
}) => {
  await fixture(page, 1, { classroomTitle: 'Класс для проверки списка и заявок' });
  const name = 'Александра Константиновна Иванова-Петрова — участник через аккаунт';
  await page.route('**/api/classrooms/' + classId + '/roster', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...seat(0, name),
            loginMethod: 'account',
            studentCode: null,
            loginHandle: null,
          },
        ],
      },
    }),
  );
  await page.goto('/#/classrooms/' + classId);
  await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
  await expect(page.getByTestId('class-join-qr')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('student-access-printing'));
  const card = page.locator('.student-access-print-sheet .is-account-entry');
  await expect(card).toContainText(name);
  await expect(card).toContainText('Войдите в ASA Lab → Моё обучение.');
  const geometry = await card.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const selectors = [
      '.student-access-topline',
      '.student-access-identity',
      '.student-access-codes',
    ];
    const zones = selectors.map((selector) => {
      const element = node.querySelector(selector)!;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().toJSON();
    });
    return {
      height: bounds.height,
      overflowX: node.scrollWidth - node.clientWidth,
      overflowY: node.scrollHeight - node.clientHeight,
      zones: zones.map((r) => ({ top: r.top - bounds.top, bottom: r.bottom - bounds.top })),
      text: node.textContent,
    };
  });
  writeFileSync(
    test.info().outputPath('account-print-geometry.json'),
    JSON.stringify(geometry, null, 2),
  );
  expect(geometry.overflowX).toBeLessThanOrEqual(1);
  expect(geometry.overflowY).toBeLessThanOrEqual(1);
  for (let i = 0; i < geometry.zones.length; i++) {
    expect(geometry.zones[i]!.bottom).toBeLessThanOrEqual(geometry.height + 1);
    if (i > 0)
      expect(geometry.zones[i]!.top).toBeGreaterThanOrEqual(geometry.zones[i - 1]!.bottom - 1);
  }
  await page.pdf({
    path: test.info().outputPath('account-card-a4.pdf'),
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
  });
});

test('dated journal keeps the first pupil visible on a phone without shrinking text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, 3);
  await page.route('**/api/classrooms/' + classId + '/journal?*', (route) =>
    route.fulfill({
      json: {
        status: 'active',
        timeZone: 'Europe/Moscow',
        scale: { preset: 'five', version: 1 },
        offset: 0,
        nextOffset: null,
        range: {
          from: '2026-10-01',
          to: '2026-10-31',
          today: '2026-10-09',
          timeZone: 'Europe/Moscow',
        },
        students: state
          .students()
          .map((s) => ({ id: s.id, name: s.displayLabel, status: s.status })),
        columns: Array.from({ length: 6 }, (_, i) => ({
          id: 'column-' + i,
          date: '2026-10-' + String(i + 1).padStart(2, '0'),
          category: 'Работа на уроке',
          preset: 'five',
          scaleVersion: 1,
        })),
        grades: [],
      },
    }),
  );
  await page.goto('/#/classrooms/' + classId);
  await page.getByLabel('Раздел класса', { exact: true }).selectOption('gradebook');
  const table = page.getByRole('region', { name: 'Таблица оценок по датам', exact: true });
  await expect(table.getByRole('rowheader').first()).toBeVisible();
  const geometry = await table.evaluate((element) => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    tableTop: element.getBoundingClientRect().top,
    firstRowBottom: element.querySelector('tbody tr')!.getBoundingClientRect().bottom,
    font: getComputedStyle(element.querySelector('tbody th')!).fontSize,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.width);
  expect(geometry.firstRowBottom).toBeLessThanOrEqual(844);
  expect(geometry.font).toBe('16px');
  await expect(page.getByRole('button', { name: 'Предыдущий месяц', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Следующий месяц', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обновить журнал', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('journal-phone.png'), fullPage: true });
  writeFileSync(
    test.info().outputPath('journal-phone-geometry.json'),
    JSON.stringify(geometry, null, 2),
  );
});
