import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { registerAccountSetup } from './registration-setup';
import { portalSidebar, portalTopBar } from './portal-navigation';
import { openAiUsageNativeZoom } from './ai-usage-native-zoom';
const evidenceDir = 'e2e/artifacts/student-project-policy';
async function capture(page: Page, name: string) {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${evidenceDir}/${name}-${width}.png`, fullPage: true });
  }
}
function randomKey() {
  return `publication-policy-${crypto.randomUUID()}`;
}
async function expectProjectPermissionSaved(
  page: Page,
  section: import('@playwright/test').Locator,
) {
  const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
  await expect(ribbon).toHaveCount(1);
  await expect(ribbon).toContainText('Разрешения проектов сохранены.');
  const announcement = page.locator('.system-feedback-announcement[role="status"]');
  await expect(announcement).toHaveCount(1);
  await expect(announcement).toContainText('Разрешения проектов сохранены.');
  const inlineSuccess = section.getByText('Разрешения проектов сохранены.', { exact: true });
  await expect(inlineSuccess).toHaveCount(0);
}

test('teacher policy explicitly permits own Seat publication and preserves public read after disabling', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const target = new URL(baseURL!);
  if (
    ['4610', '4620'].includes(target.port) ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']!).pathname.endsWith('_test')
  )
    throw new Error('Isolated test runtime required');
  const origin = target.origin;
  // This external SDK is unrelated to Account/Seat admission. API calls remain real.
  await page.route('https://st.max.ru/js/max-web-app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  mkdirSync(evidenceDir, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = crypto.randomUUID().replaceAll('-', '');
  const register = await registerAccountSetup(
    page.request,
    {
      headers: { origin },
      data: {
        email: `games-${id}@admission.test`,
        username: `games_${id.slice(0, 20)}`,
        displayName: 'Учитель допуска игр',
        password: `Safe-${id}-Password`,
        birthDate: '1990-04-12',
        country: 'RU',
      },
    },
    test.info(),
  );
  expect(register.status(), await register.text()).toBe(201);
  const educator = await page.request.post('/api/capabilities/educator/self-attest', {
    headers: { origin },
    data: {},
  });
  expect(educator.status(), await educator.text()).toBe(201);
  const classroom = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': randomKey() },
    // This scenario isolates distribution permissions. Safe Mode is covered by a separate
    // default-ON security suite; it must be OFF here for an authorized publish.
    data: { title: 'Учебные игры', ageBand: 'mixed', topicKeys: [], safeModeDefault: false },
  });
  expect(classroom.status(), await classroom.text()).toBe(201);
  const classroomId = (await classroom.json()).classroom.id as string;
  const details = await page.request.get(`/api/classrooms/${classroomId}`);
  expect(details.status(), await details.text()).toBe(200);
  const classCode = (await details.json()).classroom.joinCode as string;
  const issued = await page.request.post(`/api/classrooms/${classroomId}/seats`, {
    headers: { origin },
    data: { displayLabel: 'Ученик допуска', safeMode: false },
  });
  expect(issued.status(), await issued.text()).toBe(201);
  const student = (await issued.json()).student as { id: string; studentCode: string };

  const studentContext = await browser.newContext({ baseURL: origin });
  await studentContext.route('https://st.max.ru/js/max-web-app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  const learner = await studentContext.newPage();
  learner.on('pageerror', (error) => errors.push(error.message));
  try {
    await learner.goto(`${origin}/#/join-class?code=${encodeURIComponent(classCode)}`);
    await learner.getByLabel('Код ученика', { exact: true }).fill(student.studentCode);
    const joined = learner.waitForResponse(
      (response) =>
        response.url().includes('/api/class-join/studentseat') &&
        response.request().method() === 'POST',
    );
    await learner.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await joined).status()).toBe(200);

    await learner.goto(`${origin}/#/projects`);
    const created = await learner.request.post('/api/projects', {
      headers: { origin, 'idempotency-key': randomKey() },
      data: { scope: 'personal', module: 'electronics', title: 'Публикация ученика' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = (await created.json()).project.id as string;
    const image = await learner.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#e6f3ff';
      ctx.fillRect(0, 0, 400, 240);
      ctx.fillStyle = '#2464bd';
      ctx.fillRect(100, 60, 200, 120);
      return canvas.toDataURL('image/png');
    });
    const snapshot = await learner.request.put(`/api/projects/${projectId}/snapshot`, {
      headers: { origin },
      data: { imageDataUrl: image, sourceRevision: 1 },
    });
    expect(snapshot.status(), await snapshot.text()).toBe(200);
    const endpoint = `/api/projects/${projectId}/publication`;
    expect((await learner.request.post(endpoint, { headers: { origin }, data: {} })).status()).toBe(
      403,
    );
    await page.goto(`${origin}/#/classrooms/${classroomId}`);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    const controls = page.getByRole('group', { name: 'Проекты класса', exact: true });
    await expect(controls.getByLabel('Публикация проектов', { exact: true })).not.toBeChecked();
    await expect(controls.getByLabel('Скачивание проектов', { exact: true })).not.toBeChecked();
    await controls.getByLabel('Публикация проектов', { exact: true }).check();
    await controls.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expectProjectPermissionSaved(page, controls);
    await capture(page, 'teacher-class');
    await learner.reload();
    const card = learner.getByTestId('project-card').filter({ hasText: 'Публикация ученика' });
    await expect(card).toBeVisible();
    await card.hover();
    const actions = card.locator('details > summary');
    await expect(actions).toBeVisible();
    await actions.click();
    await card.getByRole('button', { name: 'Публикация', exact: true }).click();
    const dialog = learner.getByRole('dialog', { name: 'Публикация проекта' });
    await expect(dialog.getByRole('button', { name: 'Опубликовать', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Обновить публикацию', exact: true }),
    ).toBeEnabled();
    await capture(learner, 'seat-published');
    const state = await learner.request.get(endpoint);
    const publicationId = (await state.json()).publication.publicationId as string;
    await controls.getByLabel('Публикация проектов', { exact: true }).uncheck();
    await controls.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expectProjectPermissionSaved(page, controls);
    expect((await learner.request.post(endpoint, { headers: { origin }, data: {} })).status()).toBe(
      403,
    );
    expect((await learner.request.get(`/api/public-projects/${publicationId}`)).status()).toBe(200);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Ученики', exact: true })
      .click();
    await page.locator('.classroom-student-name').filter({ hasText: 'Ученик допуска' }).click();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('button', { name: /Публикация и скачивание/ }).click();
    const individual = page.getByRole('group', { name: 'Проекты ученика', exact: true });
    await individual.getByLabel('Публикация проектов', { exact: true }).selectOption('allow');
    await individual.getByLabel('Скачивание проектов', { exact: true }).selectOption('deny');
    await individual.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expectProjectPermissionSaved(page, individual);
    await capture(page, 'teacher-seat');
    expect((await learner.request.post(endpoint, { headers: { origin }, data: {} })).status()).toBe(
      200,
    );
    expect((await learner.request.delete(endpoint, { headers: { origin } })).status()).toBe(200);
    expect((await learner.request.get(`/api/public-projects/${publicationId}`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await studentContext.close();
  }
});

const shellCaptureDir = `${evidenceDir}/portal-shell`;
const shellCaptureWidths = [1440, 1024, 390, 320] as const;
type ShellActor = 'account' | 'seat';
type ShellSurface = 'home' | 'learning';
type ShellRead = { path: string; module: string | null; status: number | null; failed: boolean };
type ShellAttempt = ShellRead & {
  attempt: number;
  requestedAtMs: number;
  finishedAtMs: number | null;
  completed: boolean;
  failureText: string | null;
};

function observeShellReads(page: Page, origin: string) {
  const pending = new Set<Request>();
  const entries = new Map<Request, ShellAttempt>();
  let lastChange = Date.now();
  let started = performance.now();
  let attempt = 0;
  const requested = (request: Request) => {
    const url = new URL(request.url());
    if (
      url.origin !== origin ||
      !url.pathname.startsWith('/api/') ||
      request.method() !== 'GET' ||
      !['fetch', 'xhr'].includes(request.resourceType())
    )
      return;
    pending.add(request);
    entries.set(request, {
      attempt: ++attempt,
      path: url.pathname,
      module: url.searchParams.get('module'),
      status: null,
      failed: false,
      requestedAtMs: performance.now() - started,
      finishedAtMs: null,
      completed: false,
      failureText: null,
    });
    lastChange = Date.now();
  };
  const responded = (response: import('@playwright/test').Response) => {
    const entry = entries.get(response.request());
    if (entry) entry.status = response.status();
  };
  const finished = (request: Request) => {
    const entry = entries.get(request);
    if (entry) {
      entry.completed = true;
      entry.finishedAtMs = performance.now() - started;
    }
    if (pending.delete(request)) lastChange = Date.now();
  };
  const failed = (request: Request) => {
    const entry = entries.get(request);
    if (entry) {
      entry.failed = true;
      entry.failureText = request.failure()?.errorText ?? 'unknown request failure';
    }
    finished(request);
  };
  page.on('request', requested);
  page.on('response', responded);
  page.on('requestfinished', finished);
  page.on('requestfailed', failed);
  return {
    begin: () => {
      pending.clear();
      entries.clear();
      lastChange = Date.now();
      started = performance.now();
      attempt = 0;
    },
    settled: () => pending.size === 0 && Date.now() - lastChange >= 250,
    snapshot: () =>
      [...entries.values()].map(({ path, module, status, failed }) => ({
        path,
        module,
        status,
        failed,
      })),
    attempts: () =>
      [...entries.values()].map((entry) => ({
        ...entry,
        outcome:
          entry.failed && /ABORT|CANCEL/i.test(entry.failureText ?? '')
            ? 'cancelled'
            : entry.failed || (entry.status !== null && entry.status >= 400)
              ? 'error'
              : !entry.completed
                ? 'pending'
                : entry.status !== null && entry.status >= 200 && entry.status < 300
                  ? 'successful'
                  : 'other',
      })),
    dispose: () => {
      page.off('request', requested);
      page.off('response', responded);
      page.off('requestfinished', finished);
      page.off('requestfailed', failed);
    },
  };
}

function personalReadCounts(reads: ReturnType<ReturnType<typeof observeShellReads>['attempts']>) {
  const count = (path: string) => {
    const attempts = reads.filter((entry) => entry.path === path);
    return {
      attempted: attempts.length,
      successful: attempts.filter((entry) => entry.outcome === 'successful').length,
      cancelled: attempts.filter((entry) => entry.outcome === 'cancelled').length,
      error: attempts.filter((entry) => entry.outcome === 'error').length,
      pending: attempts.filter((entry) => entry.outcome === 'pending').length,
      other: attempts.filter((entry) => entry.outcome === 'other').length,
    };
  };
  return {
    accountSummary: count('/api/progress/summary'),
    seatSummary: count('/api/class-join/progress/summary'),
    accountAvatar: count('/api/account/avatar'),
  };
}

function assertInitialPersonalReads(
  reads: ReturnType<ReturnType<typeof observeShellReads>['attempts']>,
  actor: ShellActor,
) {
  const actual = personalReadCounts(reads);
  const one = { attempted: 1, successful: 1, cancelled: 0, error: 0, pending: 0, other: 0 };
  const none = { attempted: 0, successful: 0, cancelled: 0, error: 0, pending: 0, other: 0 };
  expect(actual, JSON.stringify(reads, null, 2)).toEqual({
    accountSummary: actor === 'account' ? one : none,
    seatSummary: actor === 'seat' ? one : none,
    accountAvatar: actor === 'account' ? one : none,
  });
  for (const entry of reads.filter((read) =>
    ['/api/progress/summary', '/api/class-join/progress/summary', '/api/account/avatar'].includes(
      read.path,
    ),
  ))
    expect(entry).toMatchObject({ status: 200, failed: false, completed: true });
}

async function shellFrame(page: Page, focusSelector: string) {
  return page.evaluate((selector) => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const header = document.querySelector<HTMLElement>('.portal-header')!;
    const sidebar = document.querySelector<HTMLElement>('#portal-sidebar')!;
    const main = document.querySelector<HTMLElement>('.portal-shell > main')!;
    const menu = header.querySelector<HTMLElement>('.portal-menu-toggle')!;
    const expectedFocus = document.querySelector<HTMLElement>(selector)!;
    const focusRect = expectedFocus.getBoundingClientRect();
    const focusStyle = getComputedStyle(expectedFocus);
    const hit = document.elementFromPoint(
      focusRect.x + focusRect.width / 2,
      focusRect.y + focusRect.height / 2,
    );
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      );
    };
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        visualScale: visualViewport?.scale ?? null,
      },
      scroll: { x: scrollX, y: scrollY, main: main.scrollTop, sidebar: sidebar.scrollTop },
      pageWidth: document.documentElement.scrollWidth,
      boxes: {
        header: box(header),
        sidebar: box(sidebar),
        brand: box(header.querySelector('.portal-brand')),
        publicNavigation: box(header.querySelector('.portal-global-nav')),
        create: box(header.querySelector('.portal-quick-create')),
        account: box(header.querySelector('.portal-account > summary')),
        menu: box(menu),
        search: box(header.querySelector('input[type="search"]')),
        focus: box(expectedFocus),
      },
      controls: [...header.querySelectorAll<HTMLElement>('.portal-global-nav a')].map((link) => ({
        name: link.getAttribute('aria-label'),
        visible: visible(link),
        rect: box(link),
      })),
      menu: {
        triggerVisible: visible(menu),
        expanded: menu.getAttribute('aria-expanded'),
        sidebarVisible: visible(sidebar),
        collapsed: sidebar.classList.contains('collapsed'),
        mobileOpen: sidebar.classList.contains('mobile-open'),
        role: sidebar.getAttribute('role'),
        modal: sidebar.getAttribute('aria-modal'),
        accountOpen: header.querySelector('details.portal-account')?.hasAttribute('open') ?? false,
        createOpen:
          header.querySelector('details.portal-quick-create')?.hasAttribute('open') ?? false,
        headerInert: header.inert,
        mainInert: main.inert,
        bodyInlineOverflow: document.body.style.overflow,
      },
      focus: {
        selector,
        active: document.activeElement === expectedFocus,
        visible: visible(expectedFocus),
        focusVisible: expectedFocus.matches(':focus-visible'),
        nonOccluded: hit !== null && (hit === expectedFocus || expectedFocus.contains(hit)),
        outlineStyle: focusStyle.outlineStyle,
        outlineWidth: Number.parseFloat(focusStyle.outlineWidth),
        outlineOffset: Number.parseFloat(focusStyle.outlineOffset),
        boxShadow: focusStyle.boxShadow,
      },
      shellImages: [
        ...document.querySelectorAll<HTMLImageElement>('.portal-header img, #portal-sidebar img'),
      ].map((img) => ({
        complete: img.complete,
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
      viewportImages: [...document.images]
        .filter((img) => {
          const rect = img.getBoundingClientRect();
          return (
            visible(img) &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < innerWidth &&
            rect.top < innerHeight
          );
        })
        .map((img) => ({
          complete: img.complete,
          width: img.naturalWidth,
          height: img.naturalHeight,
        })),
    };
  }, focusSelector);
}

function assertShellFrame(
  frame: Awaited<ReturnType<typeof shellFrame>>,
  width: number,
  open: boolean,
) {
  expect(frame.viewport).toMatchObject({ width, height: 900, dpr: 1 });
  expect(frame.scroll.x).toBe(0);
  expect(frame.scroll.y).toBe(0);
  expect(frame.pageWidth).toBeLessThanOrEqual(width + 1);
  expect(frame.menu).toMatchObject({
    expanded: String(open),
    mobileOpen: open,
    sidebarVisible: open || width >= 1024,
    triggerVisible: width < 1024,
    accountOpen: false,
    createOpen: false,
    headerInert: open,
    mainInert: open,
  });
  if (open)
    expect(frame.menu).toMatchObject({
      role: 'dialog',
      modal: 'true',
      bodyInlineOverflow: 'hidden',
    });
  expect(frame.focus).toMatchObject({
    active: true,
    visible: true,
    focusVisible: true,
    nonOccluded: true,
  });
  expect(
    (frame.focus.outlineStyle !== 'none' && frame.focus.outlineWidth > 0) ||
      frame.focus.boxShadow !== 'none',
  ).toBe(true);
  const focus = frame.boxes.focus!;
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.height).toBeGreaterThan(0);
  const decoration =
    frame.focus.outlineStyle === 'none'
      ? 0
      : frame.focus.outlineWidth + Math.max(0, frame.focus.outlineOffset);
  expect(focus.x - decoration).toBeGreaterThanOrEqual(0);
  expect(focus.y - decoration).toBeGreaterThanOrEqual(0);
  expect(focus.right + decoration).toBeLessThanOrEqual(width);
  expect(focus.bottom + decoration).toBeLessThanOrEqual(900);
  expect(frame.shellImages.every((img) => img.complete && img.width > 0 && img.height > 0)).toBe(
    true,
  );
  expect(frame.viewportImages.every((img) => img.complete && img.width > 0 && img.height > 0)).toBe(
    true,
  );
}

async function prepareShellFrame(page: Page, focusSelector: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLImageElement>('.portal-header img, #portal-sidebar img'),
        ].every((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0),
      ),
    )
    .toBe(true);
  const target = page.locator(focusSelector);
  await target.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(target).toBeFocused();
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect
    .poll(() => page.evaluate(() => ({ x: scrollX, y: scrollY })))
    .toEqual({ x: 0, y: 0 });
  await expect
    .poll(async () =>
      (await shellFrame(page, focusSelector)).viewportImages.every(
        (img) => img.complete && img.width > 0 && img.height > 0,
      ),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const before = await shellFrame(page, focusSelector);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const after = await shellFrame(page, focusSelector);
      return JSON.stringify(before.boxes) === JSON.stringify(after.boxes);
    })
    .toBe(true);
}

test('real Account and StudentSeat capture Home and Learning shell at controlled scroll and focus states', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const target = new URL(baseURL!);
  if (
    ['4610', '4620'].includes(target.port) ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']!).pathname.endsWith('_test')
  )
    throw new Error('Isolated test runtime required');
  const origin = target.origin;
  const contexts: BrowserContext[] = [];
  const observers: Array<ReturnType<typeof observeShellReads>> = [];
  const pageErrors: string[] = [];
  const captures: Array<Record<string, unknown>> = [];
  const networkChecks: Array<Record<string, unknown>> = [];
  const restoredMenus: Array<Record<string, unknown>> = [];
  mkdirSync(shellCaptureDir, { recursive: true });
  const metadataBytes = readFileSync('apps/web/dist/build-metadata.json');
  const metadata = JSON.parse(metadataBytes.toString('utf8')) as {
    revision: string;
    builtAt?: string;
  };
  const revision = process.env['ASA_BUILD_REVISION'];
  expect(revision).toMatch(/^[0-9a-f]{40}$/);
  expect(metadata.revision).toBe(revision);
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const receipt = {
    schemaVersion: 1,
    caseName: test.info().title,
    caseFileSha256: sha256(readFileSync('e2e/student-project-policy.spec.ts')),
    build: {
      revision: metadata.revision,
      metadataSha256: sha256(metadataBytes),
      servedMetadataSha256: '',
    },
    browser: browser.version(),
    context: { locale: 'ru-RU', timezoneId: 'Europe/Moscow', deviceScaleFactor: 1, height: 900 },
    fixture: { ordinaryAccount: false, approvedMembership: false, seatCodeLogin: false },
    captureComplete: false,
    captures,
    networkChecks,
    restoredMenus,
  };
  const persist = () =>
    writeFileSync(
      `${shellCaptureDir}/portal-shell-capture.json`,
      JSON.stringify(receipt, null, 2) + '\n',
    );
  persist();
  const createPage = async () => {
    const context = await browser.newContext({
      baseURL: origin,
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      deviceScaleFactor: 1,
      colorScheme: 'light',
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(context);
    // The unrelated external SDK is blocked; all application requests and DTOs stay real.
    await context.route('https://st.max.ru/js/max-web-app.js', (route) =>
      route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.name));
    return page;
  };
  const register = async (page: Page, displayName: string) => {
    const id = randomUUID().replaceAll('-', '');
    const response = await registerAccountSetup(
      page.request,
      {
        headers: { origin },
        data: {
          email: `shell-${id}@admission.test`,
          username: `shell_${id.slice(0, 20)}`,
          displayName,
          password: `Shell-${id}-Password`,
          birthDate: '1990-04-12',
          country: 'RU',
        },
      },
      test.info(),
    );
    expect(response.status()).toBe(201);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const session = await me.json();
    expect(session.authenticated).toBe(true);
    expect(session.user.id).toMatch(/^[0-9a-f-]{36}$/);
    return session as { user: { id: string }; capabilities: Array<{ capability: string }> };
  };
  try {
    const teacher = await createPage();
    await register(teacher, 'Преподаватель сравнения');
    const educator = await teacher.request.post('/api/capabilities/educator/self-attest', {
      headers: { origin },
      data: {},
    });
    expect(educator.status()).toBe(201);
    const classroom = await teacher.request.post('/api/classrooms', {
      headers: { origin, 'idempotency-key': `shell-${randomUUID()}` },
      data: {
        title: 'Группа сравнения интерфейса',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: false,
      },
    });
    expect(classroom.status()).toBe(201);
    const classroomId = (await classroom.json()).classroom.id as string;
    const details = await teacher.request.get(`/api/classrooms/${classroomId}`);
    expect(details.status()).toBe(200);
    const joinCode = (await details.json()).classroom.joinCode as string;
    const account = await createPage();
    const accountSession = await register(account, 'Участник сравнения');
    expect(accountSession.capabilities.map((item) => item.capability)).not.toContain('educator');
    receipt.fixture.ordinaryAccount = true;
    const join = await account.request.post('/api/class-join/account', {
      headers: { origin },
      data: { code: joinCode },
    });
    expect(join.status()).toBe(200);
    const pending = await join.json();
    expect(pending).toMatchObject({ status: 'pending', classroom: { id: classroomId } });
    const approved = await teacher.request.post(
      `/api/class-join/requests/${classroomId}/${pending.requestId}/decision`,
      {
        headers: { origin },
        data: { decision: 'approved' },
      },
    );
    expect(approved.status()).toBe(201);
    const admitted = await account.request.post('/api/class-join/account', {
      headers: { origin },
      data: { code: joinCode },
    });
    expect(admitted.status()).toBe(200);
    const membership = await admitted.json();
    expect(membership).toMatchObject({ status: 'active', classroom: { id: classroomId } });
    const seatId = membership.seatId as string;
    expect(seatId).toMatch(/^[0-9a-f-]{36}$/);
    receipt.fixture.approvedMembership = true;
    const code = await teacher.request.post(`/api/classrooms/${classroomId}/seats/${seatId}/code`, {
      headers: { origin },
      data: { requestId: randomUUID() },
    });
    expect(code.status()).toBe(201);
    const studentCode = (await code.json()).studentCode as string;
    const seat = await createPage();
    await seat.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
    await seat.getByLabel('Код ученика', { exact: true }).fill(studentCode);
    const login = seat.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/class-join/studentseat',
    );
    await seat.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await login).status()).toBe(200);
    const seatSession = await seat.request.get('/api/class-join/me');
    expect(seatSession.status()).toBe(200);
    expect(await seatSession.json()).toMatchObject({
      authenticated: true,
      student: { seatId },
      classroom: { id: classroomId },
    });
    receipt.fixture.seatCodeLogin = true;
    const servedMetadata = await account.request.get('/build-metadata.json');
    expect(servedMetadata.status()).toBe(200);
    const servedBytes = await servedMetadata.body();
    expect(JSON.parse(servedBytes.toString('utf8')).revision).toBe(revision);
    receipt.build.servedMetadataSha256 = sha256(servedBytes);
    expect(receipt.build.servedMetadataSha256).toBe(receipt.build.metadataSha256);
    persist();

    for (const [actor, page] of [
      ['account', account],
      ['seat', seat],
    ] as const) {
      const reads = observeShellReads(page, origin);
      observers.push(reads);
      for (const width of shellCaptureWidths) {
        await page.setViewportSize({ width, height: 900 });
        for (const surface of ['home', 'learning'] as const) {
          // A fresh document gives both sources the same initial shell state.
          // Session cookies remain real; no storage state or DTO is injected.
          await page.goto('about:blank');
          reads.begin();
          await page.goto(`/#/${surface}`, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('.portal-header .portal-brand')).toBeVisible();
          await expect(portalTopBar(page)).toBeVisible();
          await expect(portalSidebar(page)).toBeAttached();
          if (surface === 'home') {
            // The pre-UI feed may have zero height when no module is creatable.
            await expect(page.locator('.creator-module-feed')).toBeAttached();
            await expect(page.locator('.creator-dashboard-loading')).toHaveCount(0);
          } else {
            await expect(
              page.getByRole('heading', { name: 'Моё обучение', exact: true }),
            ).toBeVisible();
            await expect(page.getByText('Загружаем обзор обучения…', { exact: true })).toHaveCount(
              0,
            );
          }
          await expect.poll(reads.settled).toBe(true);
          const attempts = reads.attempts();
          networkChecks.push({
            actor,
            surface,
            width,
            phase: 'initial_ready',
            attempts,
            counts: personalReadCounts(attempts),
          });
          // Preserve every attempt before checking the captured initial state.
          persist();
          assertInitialPersonalReads(attempts, actor);
          if (surface === 'learning') {
            await expect(page.locator('.learning-overview-metrics')).toHaveCount(0);
            await expect(page.locator('.learning-overview-panel')).toHaveCount(0);
            await expect(
              page.locator('.learning-overview-empty, .learning-overview-note'),
            ).toHaveCount(1);
          }
          const actualReads = reads.snapshot();
          if (surface === 'home') {
            for (const module of ['three-d', 'electronics', 'blocks', 'robotics'])
              expect(actualReads).toContainEqual({
                path: '/api/projects',
                module,
                status: 200,
                failed: false,
              });
          } else {
            const scope = actor === 'account' ? 'account' : 'me';
            for (const path of ['assignments', 'course-runs', 'results'])
              expect(actualReads).toContainEqual({
                path: `/api/class-join/${scope}/${path}`,
                module: null,
                status: 200,
                failed: false,
              });
          }
          const captureState = async (open: boolean) => {
            const focusSelector = open
              ? '#portal-sidebar .portal-menu-close'
              : '.portal-header .portal-brand';
            await prepareShellFrame(page, focusSelector);
            const before = await shellFrame(page, focusSelector);
            assertShellFrame(before, width, open);
            const filename = `portal-shell-${actor}-${surface}-${width}${open ? '-menu-open' : ''}.png`;
            const png = await page.screenshot({
              path: `${shellCaptureDir}/${filename}`,
              fullPage: false,
            });
            const after = await shellFrame(page, focusSelector);
            assertShellFrame(after, width, open);
            expect(after.boxes).toEqual(before.boxes);
            expect(after.menu).toEqual(before.menu);
            expect(png.readUInt32BE(16)).toBe(width);
            expect(png.readUInt32BE(20)).toBe(900);
            captures.push({
              actor: actor satisfies ShellActor,
              surface: surface satisfies ShellSurface,
              width,
              menuState: open ? 'open' : 'closed',
              before,
              after,
              reads: reads.attempts(),
              personalReadCounts: personalReadCounts(reads.attempts()),
              png: { filename, bytes: png.length, sha256: sha256(png), width, height: 900 },
            });
            persist();
            return after;
          };
          const closed = await captureState(false);
          if (width < 1024) {
            const menu = page.getByRole('button', { name: 'Открыть меню', exact: true });
            await menu.click();
            await expect(menu).toHaveAttribute('aria-expanded', 'true');
            await expect(portalSidebar(page)).toBeVisible();
            await captureState(true);
            await page.keyboard.press('Escape');
            await expect(menu).toHaveAttribute('aria-expanded', 'false');
            await expect(portalSidebar(page)).toBeHidden();
            await expect(menu).toBeFocused();
            const restored = await shellFrame(page, '.portal-header .portal-menu-toggle');
            expect(restored.menu).toMatchObject({
              mobileOpen: false,
              headerInert: false,
              mainInert: false,
              bodyInlineOverflow: closed.menu.bodyInlineOverflow,
            });
            expect(restored.scroll).toMatchObject({ x: 0, y: 0 });
            restoredMenus.push({ actor, surface, width, frame: restored });
            persist();
          }
          await expect.poll(reads.settled).toBe(true);
          const finalAttempts = reads.attempts();
          networkChecks.push({
            actor,
            surface,
            width,
            phase: 'after_captures',
            attempts: finalAttempts,
            counts: personalReadCounts(finalAttempts),
          });
          persist();
          assertInitialPersonalReads(finalAttempts, actor);
        }
      }
    }
    expect(captures).toHaveLength(24);
    expect(restoredMenus).toHaveLength(8);
    expect(pageErrors).toEqual([]);
    receipt.captureComplete = true;
    persist();
  } finally {
    for (const observer of observers) observer.dispose();
    for (const context of contexts.reverse()) await context.close();
  }
});

/** Diagnostic evidence only. The same test runs against unchanged and repaired
 * production builds; strict regression assertions live in the shell test. */
test('owner UX cold Home resource evidence: three fresh contexts with the real API', async ({
  browser,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const target = new URL(baseURL!);
  if (
    ['4610', '4620'].includes(target.port) ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']!).pathname.endsWith('_test')
  )
    throw new Error('Isolated test runtime required');
  const origin = target.origin;
  const revision = process.env['ASA_BUILD_REVISION'];
  expect(revision).toMatch(/^[0-9a-f]{40}$/);
  const metadataBytes = readFileSync('apps/web/dist/build-metadata.json');
  const metadata = JSON.parse(metadataBytes.toString('utf8')) as { revision: string };
  expect(metadata.revision).toBe(revision);
  const served = await request.get('/build-metadata.json');
  expect(served.status()).toBe(200);
  const servedBytes = await served.body();
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  expect(hash(servedBytes)).toBe(hash(metadataBytes));
  const fixtureId = randomUUID().replaceAll('-', '');
  const registered = await registerAccountSetup(
    request,
    {
      headers: { origin },
      data: {
        email: `cold-${fixtureId}@admission.test`,
        username: `cold_${fixtureId.slice(0, 20)}`,
        displayName: 'Проверка начальной загрузки',
        password: `Cold-${fixtureId}-Password`,
        birthDate: '1990-04-12',
        country: 'RU',
      },
    },
    test.info(),
  );
  expect(registered.status(), await registered.text()).toBe(201);
  // Make all three runs read-only; the first document must not be the one that
  // sets an otherwise missing timezone and changes the next two runs' fixture.
  const timezone = await request.put('/api/account/time-zone', {
    headers: { origin },
    data: { timeZone: 'Europe/Moscow', onlyIfUnset: true },
  });
  expect(timezone.status()).toBe(200);
  const initial = await request.get('/api/progress/summary');
  expect(initial.status()).toBe(200);
  const initialSummary = await initial.json();
  expect(initialSummary).toMatchObject({
    availability: 'available',
    groups: { items: [] },
    metrics: {
      everPublishedWorks: { availability: 'available', value: 0 },
      currentLikes: { availability: 'available', value: 0 },
      createdCopies: { availability: 'available', value: 0 },
    },
  });
  for (const path of [
    '/api/class-join/account/classes',
    '/api/class-join/account/assignments',
    '/api/class-join/account/quizzes',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect((await response.json()).items, path).toEqual([]);
  }
  for (const module of ['three-d', 'electronics', 'blocks', 'robotics']) {
    const response = await request.get(`/api/projects?scope=personal&module=${module}&limit=10`);
    expect(response.status()).toBe(200);
    expect((await response.json()).items).toEqual([]);
  }
  const catalog = await request.get('/api/modules');
  expect(catalog.status()).toBe(200);
  const moduleItems = (await catalog.json()).items as Array<{
    moduleKey: string;
    availability: string;
    creatable: boolean;
  }>;
  for (const moduleKey of ['three-d', 'electronics', 'blocks', 'robotics'])
    expect(moduleItems.find((entry) => entry.moduleKey === moduleKey)).toMatchObject({
      moduleKey,
      availability: 'active',
      creatable: true,
    });
  // Cookies stay in memory and are never written to the evidence artifact.
  const storage = await request.storageState();
  const runs: Array<Record<string, unknown>> = [];
  const report = {
    schemaVersion: 2,
    kind: 'diagnostic_cold_load_not_a_regression_gate',
    build: {
      revision,
      metadataSha256: hash(metadataBytes),
      servedMetadataSha256: hash(servedBytes),
      caseFileSha256: hash(readFileSync('e2e/student-project-policy.spec.ts')),
    },
    environment: {
      browser: browser.version(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      viewport: { width: 1440, height: 900 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      deviceScaleFactor: 1,
      cache: 'fresh context for every run; Network.setCacheDisabled=true',
      serviceWorkers: 'blocked',
      networkThrottling: 'none',
      externalSdk: 'https://st.max.ru/js/max-web-app.js blocked in every run',
      reactRenderer: 'read-only renderer metadata hook; production bundleType 0 required',
    },
    fixture: {
      actor: 'ordinary_account',
      projects: 0,
      groups: 0,
      assignments: 0,
      quizzes: 0,
      confirmedMetrics: [0, 0, 0],
      timeZone: 'Europe/Moscow',
      sameAccountForAllRuns: true,
      confirmedCreatableModules: ['three-d', 'electronics', 'blocks', 'robotics'],
    },
    readiness: {
      home: 'four module sections with enabled creation actions and confirmed empty project lists; no project or module errors',
      metrics: 'all three sidebar metric values have settled to the fixture-confirmed zero',
      initialResources:
        'all JS/CSS requests whose CDP requestWillBeSent wallTime is at or before max(homeReady, metricsReady), including dynamic imports',
      resourceAccounting:
        'independent CDP requestId and unique ResourceTiming ledgers; exact URL multiplicity coverage, with no cross-phase timestamp pairing; browser byte sums use each ResourceTiming entry once',
      timing:
        'browser performance.now at the first animation frame satisfying each DOM predicate; no sleep or networkidle readiness',
    },
    complete: false,
    runs,
  };
  mkdirSync(shellCaptureDir, { recursive: true });
  const persist = () =>
    writeFileSync(
      `${shellCaptureDir}/owner-ux-cold-home.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
  persist();
  for (let run = 1; run <= 3; run += 1) {
    const context = await browser.newContext({
      baseURL: origin,
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      serviceWorkers: 'block',
    });
    await context.addCookies(storage.cookies);
    await context.route('https://st.max.ru/js/max-web-app.js', (route) =>
      route.abort('blockedbyclient'),
    );
    const page = await context.newPage();
    const reads = observeShellReads(page, origin);
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    try {
      const cdp = await context.newCDPSession(page);
      const resources = new Map<
        string,
        {
          requestId: string;
          url: string;
          kind: 'css' | 'javascript';
          resourceType: string | null;
          startTimestamp: number;
          startWallTime: number;
          networkStartTimestamp: number | null;
          finishedTimestamp: number | null;
          status: number | null;
          failure: string | null;
          cancelled: boolean | null;
          blockedReason: string | null;
          fromDiskCache: boolean | null;
          fromServiceWorker: boolean | null;
          wireTransferBytes: number | null;
          redirects: Array<{ url: string; status: number; encodedDataLength: number }>;
          dataChunks: Array<{ dataLength: number; encodedDataLength: number }>;
          done: Promise<void>;
          finish: () => void;
        }
      >();
      cdp.on('Network.requestWillBeSent', (event) => {
        const current = resources.get(event.requestId);
        if (current && event.redirectResponse) {
          current.redirects.push({
            url: event.redirectResponse.url,
            status: event.redirectResponse.status,
            encodedDataLength: event.redirectResponse.encodedDataLength,
          });
          return;
        }
        const path = new URL(event.request.url).pathname;
        if (!['Script', 'Stylesheet'].includes(event.type ?? '') && !/\.(?:m?js|css)$/.test(path))
          return;
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        resources.set(event.requestId, {
          requestId: event.requestId,
          url: event.request.url,
          kind: event.type === 'Stylesheet' || path.endsWith('.css') ? 'css' : 'javascript',
          resourceType: event.type ?? null,
          startTimestamp: event.timestamp,
          startWallTime: event.wallTime,
          networkStartTimestamp: null,
          finishedTimestamp: null,
          status: null,
          failure: null,
          cancelled: null,
          blockedReason: null,
          fromDiskCache: null,
          fromServiceWorker: null,
          wireTransferBytes: null,
          redirects: [],
          dataChunks: [],
          done,
          finish,
        });
      });
      cdp.on('Network.responseReceived', (event) => {
        const entry = resources.get(event.requestId);
        if (!entry) return;
        entry.status = event.response.status;
        entry.networkStartTimestamp = event.response.timing?.requestTime ?? null;
        entry.fromDiskCache = event.response.fromDiskCache ?? false;
        entry.fromServiceWorker = event.response.fromServiceWorker ?? false;
      });
      cdp.on('Network.dataReceived', (event) => {
        resources.get(event.requestId)?.dataChunks.push({
          dataLength: event.dataLength,
          encodedDataLength: event.encodedDataLength,
        });
      });
      cdp.on('Network.loadingFinished', (event) => {
        const entry = resources.get(event.requestId);
        if (!entry) return;
        entry.finishedTimestamp = event.timestamp;
        entry.wireTransferBytes = event.encodedDataLength;
        entry.cancelled = false;
        entry.finish();
      });
      cdp.on('Network.loadingFailed', (event) => {
        const entry = resources.get(event.requestId);
        if (!entry) return;
        entry.finishedTimestamp = event.timestamp;
        entry.failure = event.errorText;
        entry.cancelled = event.canceled ?? false;
        entry.blockedReason = event.blockedReason ?? null;
        entry.finish();
      });
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.addInitScript(() => {
        const state = {
          timeOrigin: performance.timeOrigin,
          homeReady: null as number | null,
          metricsReady: null as number | null,
          ready: null as number | null,
          renderers: [] as Array<{
            bundleType: number;
            version: string;
            rendererPackageName: string;
          }>,
        };
        // Capture only renderer metadata. No Fiber data, updates, profiling or
        // scheduling callbacks are retained or installed by this observer.
        Object.assign(window, {
          __asaOwnerUxReadiness: state,
          __REACT_DEVTOOLS_GLOBAL_HOOK__: {
            supportsFiber: true,
            inject(renderer: { bundleType: number; version: string; rendererPackageName: string }) {
              state.renderers.push({
                bundleType: renderer.bundleType,
                version: renderer.version,
                rendererPackageName: renderer.rendererPackageName,
              });
              return state.renderers.length;
            },
          },
        });
        const check = () => {
          const main = document.querySelector<HTMLElement>('main.creator-home');
          const sections = main?.querySelectorAll('.creator-module-section');
          if (
            state.homeReady === null &&
            main &&
            main.getBoundingClientRect().width > 0 &&
            sections?.length === 4 &&
            main.querySelectorAll('.home-create-button:not(:disabled)').length === 4 &&
            main.querySelectorAll('.home-module-empty:not([role])').length === 4 &&
            !main.querySelector('.home-module-error, .home-module-availability') &&
            [...main.querySelectorAll('.home-module-empty')].every((entry) =>
              /^Пока нет (?:моделей|схем|программ)$/.test(entry.textContent ?? ''),
            )
          )
            state.homeReady = performance.now();
          const values = document.querySelectorAll(
            '[data-testid="profile-metric-strip"] .portal-sidebar-metric-details p[data-testid] > span',
          );
          if (
            state.metricsReady === null &&
            values.length === 3 &&
            [...values].every((entry) => entry.textContent === '0')
          )
            state.metricsReady = performance.now();
          if (state.homeReady !== null && state.metricsReady !== null)
            state.ready = Math.max(state.homeReady, state.metricsReady);
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () =>
          (window as unknown as { __asaOwnerUxReadiness: { ready: number | null } })
            .__asaOwnerUxReadiness.ready !== null,
      );
      const ready = await page.evaluate(
        () =>
          (
            window as unknown as {
              __asaOwnerUxReadiness: {
                timeOrigin: number;
                homeReady: number;
                metricsReady: number;
                ready: number;
                renderers: Array<{
                  bundleType: number;
                  version: string;
                  rendererPackageName: string;
                }>;
              };
            }
          ).__asaOwnerUxReadiness,
      );
      const initialResources = [...resources.values()].filter(
        (entry) => entry.startWallTime * 1000 <= ready.timeOrigin + ready.ready,
      );
      await Promise.all(initialResources.map((entry) => entry.done));
      // Close the API attempt ledger after recording readiness. This wait neither
      // defines the readiness timestamp nor changes the resource window.
      await expect.poll(reads.settled).toBe(true);
      const network = reads.attempts();
      const resourceTimings = await page.evaluate(
        ({ cutoff, resourceUrls }) =>
          (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .filter(
              (entry) =>
                (/\.(?:m?js|css)$/.test(new URL(entry.name).pathname) ||
                  resourceUrls.includes(entry.name)) &&
                entry.startTime <= cutoff,
            )
            .map((entry, index) => ({
              id: index + 1,
              name: entry.name,
              initiatorType: entry.initiatorType,
              startTime: entry.startTime,
              responseEnd: entry.responseEnd,
              transferSize: entry.transferSize,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize,
            })),
        { cutoff: ready.ready, resourceUrls: initialResources.map((entry) => entry.url) },
      );
      const resourceRows = initialResources.map((entry) => ({
        requestId: entry.requestId,
        url: entry.url,
        kind: entry.kind,
        resourceType: entry.resourceType,
        startTimestamp: entry.startTimestamp,
        startWallTime: entry.startWallTime,
        networkStartTimestamp: entry.networkStartTimestamp,
        finishedTimestamp: entry.finishedTimestamp,
        status: entry.status,
        failure: entry.failure,
        cancelled: entry.cancelled,
        blockedReason: entry.blockedReason,
        fromDiskCache: entry.fromDiskCache,
        fromServiceWorker: entry.fromServiceWorker,
        wireTransferBytes: entry.wireTransferBytes,
        redirects: entry.redirects,
        dataChunks: entry.dataChunks,
        startedAtMs: entry.startWallTime * 1000 - ready.timeOrigin,
        networkStartedAtMs:
          entry.networkStartTimestamp === null
            ? null
            : (entry.networkStartTimestamp - entry.startTimestamp + entry.startWallTime) * 1000 -
              ready.timeOrigin,
      }));
      // requestTime is the later network phase (and can be absent on failure),
      // not ResourceTiming.startTime. Do not pair these clocks or guess which
      // duplicate URL occurrence supplied a byte value. Each ledger keeps its
      // own unique identity; exact per-URL multiplicity proves complete coverage.
      const resourceCoverage = [
        ...new Set([
          ...resourceRows.map((entry) => entry.url),
          ...resourceTimings.map((entry) => entry.name),
        ]),
      ].map((url) => {
        const requestIds = resourceRows
          .filter((entry) => entry.url === url)
          .map((entry) => entry.requestId);
        const resourceTimingIds = resourceTimings
          .filter((entry) => entry.name === url)
          .map((entry) => entry.id);
        return {
          url,
          requestIds,
          resourceTimingIds,
          complete: requestIds.length === resourceTimingIds.length,
        };
      });
      const totals = (applicationOnly: boolean) => {
        const selected = resourceRows.filter(
          (entry) => !applicationOnly || new URL(entry.url).origin === origin,
        );
        const timings = resourceTimings.filter(
          (entry) => !applicationOnly || new URL(entry.name).origin === origin,
        );
        const coverage = resourceCoverage.filter(
          (entry) => !applicationOnly || new URL(entry.url).origin === origin,
        );
        const complete = coverage.every((entry) => entry.complete);
        const sum = (key: 'transferSize' | 'encodedBodySize' | 'decodedBodySize') =>
          timings.reduce((value, entry) => value + entry[key], 0);
        return {
          resourceCount: selected.length,
          javascriptCount: selected.filter((entry) => entry.kind === 'javascript').length,
          cssCount: selected.filter((entry) => entry.kind === 'css').length,
          resourceTimingCount: timings.length,
          failedResourceCount: selected.filter((entry) => entry.failure !== null).length,
          coverageComplete: complete,
          incompleteResourceUrls: coverage
            .filter((entry) => !entry.complete)
            .map((entry) => entry.url),
          transferBytes: complete ? sum('transferSize') : null,
          encodedBodyBytes: complete ? sum('encodedBodySize') : null,
          decodedBodyBytes: complete ? sum('decodedBodySize') : null,
          knownTransferBytes: sum('transferSize'),
          knownEncodedBodyBytes: sum('encodedBodySize'),
          knownDecodedBodyBytes: sum('decodedBodySize'),
        };
      };
      runs.push({
        run,
        timeOrigin: ready.timeOrigin,
        timesMs: {
          homeReady: ready.homeReady,
          metricsReady: ready.metricsReady,
          ready: ready.ready,
        },
        renderers: ready.renderers,
        resources: resourceRows,
        resourceTimings,
        resourceCoverage,
        totals: totals(false),
        applicationTotals: totals(true),
        network,
        personalReadCounts: personalReadCounts(network),
        presentation: {
          topKnowledgeFallbackCount: await page.locator('.access-personal-start').count(),
          horizontalOverflow: await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          ),
        },
        pageErrors: failures,
      });
      persist();
      await page.screenshot({
        path: `${shellCaptureDir}/owner-ux-cold-home-${run}.png`,
        fullPage: true,
      });
      expect(failures).toEqual([]);
      expect(ready.renderers.some((renderer) => renderer.rendererPackageName === 'react-dom')).toBe(
        true,
      );
      expect(ready.renderers.every((renderer) => renderer.bundleType === 0)).toBe(true);
      for (const module of ['three-d', 'electronics', 'blocks', 'robotics'])
        expect(
          network.some(
            (entry) =>
              entry.path === '/api/projects' &&
              entry.module === module &&
              entry.status === 200 &&
              entry.outcome === 'successful',
          ),
          `Confirmed initial project list: ${module}`,
        ).toBe(true);
      expect(resourceCoverage.filter((entry) => !entry.complete)).toEqual([]);
      expect(
        resourceRows.filter((entry) => entry.failure === null && entry.wireTransferBytes === null),
      ).toEqual([]);
    } finally {
      reads.dispose();
      await context.close();
    }
  }
  report.complete = true;
  persist();
});

test('owner UX real empty Account keeps project entry and shares controlled progress recovery', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  if (
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']!).pathname.endsWith('_test')
  )
    throw new Error('Isolated test runtime required');
  await page.route('https://st.max.ru/js/max-web-app.js', (route) =>
    route.abort('blockedbyclient'),
  );
  const id = randomUUID().replaceAll('-', '');
  const registered = await registerAccountSetup(
    page.request,
    {
      headers: { origin },
      data: {
        email: `owner-ux-${id}@admission.test`,
        username: `ownerux_${id.slice(0, 20)}`,
        displayName: 'Обычный пользователь без учебных назначений',
        password: `OwnerUX-${id}-Password`,
        birthDate: '1990-04-12',
        country: 'RU',
      },
    },
    test.info(),
  );
  expect(registered.status()).toBe(201);
  expect(
    (
      await page.request.put('/api/account/time-zone', {
        headers: { origin },
        data: { timeZone: 'Europe/Moscow', onlyIfUnset: true },
      })
    ).status(),
  ).toBe(200);
  const response = await page.request.get('/api/progress/summary');
  expect(response.status()).toBe(200);
  const realSummary = await response.json();
  expect(realSummary).toMatchObject({ availability: 'available', groups: { items: [] } });
  for (const path of [
    '/api/class-join/account/classes',
    '/api/class-join/account/assignments',
    '/api/class-join/account/quizzes',
  ]) {
    const empty = await page.request.get(path);
    expect(empty.status()).toBe(200);
    expect((await empty.json()).items).toEqual([]);
  }
  mkdirSync(shellCaptureDir, { recursive: true });
  const reads = observeShellReads(page, origin);
  const runs: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let complete = false;
  page.on('pageerror', (error) => errors.push(error.message));
  const persist = () =>
    writeFileSync(
      `${shellCaptureDir}/owner-ux-empty-and-retry.json`,
      JSON.stringify(
        {
          revision: process.env['ASA_BUILD_REVISION'],
          fixture: 'real ordinary Account; no projects, memberships, assignments or quizzes',
          faultInjection: 'only the summary endpoint; successful retry continues to the real API',
          complete,
          runs,
          errors,
        },
        null,
        2,
      ) + '\n',
    );
  const noOverflow = async (target: Page) =>
    expect(
      await target.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  try {
    for (const width of shellCaptureWidths) {
      await page.goto('about:blank');
      await page.setViewportSize({ width, height: 900 });
      reads.begin();
      await page.goto('/#/home');
      await expect(page.locator('.creator-module-section')).toHaveCount(4);
      await expect(page.locator('.home-module-empty:not([role])')).toHaveCount(4);
      await expect(page.getByTestId('profile-full-everPublishedWorks').locator('span')).toHaveText(
        '0',
      );
      await expect.poll(reads.settled).toBe(true);
      runs.push({
        scenario: 'empty_account',
        width,
        attempts: reads.attempts(),
        counts: personalReadCounts(reads.attempts()),
      });
      persist();
      assertInitialPersonalReads(reads.attempts(), 'account');
      await expect(page.locator('.access-personal-start')).toHaveCount(0);
      await expect(page.locator('.personal-progress-next')).toHaveCount(0);
      await expect(page.locator('.personal-progress-hero')).toHaveCount(0);
      expect(
        await page
          .locator('main.creator-home')
          .evaluate((main) => main.firstElementChild?.className),
      ).toBe('creator-module-feed');
      await noOverflow(page);
      await page.screenshot({
        path: `${shellCaptureDir}/owner-ux-empty-home-${width}.png`,
        fullPage: true,
      });
    }
    // The ordinary knowledge route remains a usable navigation destination.
    await portalTopBar(page).getByRole('link', { name: 'Знания', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Знания', exact: true })).toBeVisible();

    type Fault = 'unavailable' | 'partial' | 'http503' | 'http403' | 'available';
    let fault: Fault = 'unavailable';
    let held: Promise<void> | null = null;
    let release: (() => void) | null = null;
    const pendingReleases = new Set<() => void>();
    await page.route('**/api/progress/summary', async (route) => {
      if (fault === 'available') {
        if (held) await held;
        return route.continue();
      }
      if (fault === 'http503' || fault === 'http403')
        return route.fulfill({
          status: fault === 'http503' ? 503 : 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'controlled_progress_failure', message: 'Проверочная недоступность' },
          }),
        });
      const metrics = Object.fromEntries(
        Object.keys(realSummary.metrics).map((name) => [
          name,
          fault === 'partial' && name === 'everPublishedWorks'
            ? { availability: 'available', value: 0 }
            : { availability: 'unavailable', value: null, reason: 'source_unavailable' },
        ]),
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...realSummary,
          asOf: fault === 'unavailable' ? null : realSummary.asOf,
          availability: fault,
          metrics,
          groups: { availability: 'unavailable', items: null, hasMore: null, nextCursor: null },
        }),
      });
    });
    try {
      for (const scenario of ['unavailable', 'partial', 'http503', 'http403'] as const) {
        fault = scenario;
        await page.goto('about:blank');
        await page.setViewportSize({ width: 1440, height: 900 });
        reads.begin();
        await page.goto('/#/learning');
        const strip = page.getByTestId('profile-metric-strip');
        await expect(strip).toBeVisible();
        await strip.locator('summary').click();
        const sidebarRetry = strip.getByRole('button', {
          name: 'Повторить загрузку прогресса',
          exact: true,
        });
        await expect(sidebarRetry).toBeVisible();
        const summary = page.getByTestId('personal-progress');
        await expect(summary).toBeVisible();
        await expect(summary.getByRole('button')).toHaveCount(1);
        await expect(strip.getByTestId('profile-full-currentLikes').locator('span')).toHaveText(
          '—',
        );
        await expect(
          strip.getByTestId('profile-full-everPublishedWorks').locator('span'),
        ).toHaveText(scenario === 'partial' ? '0' : '—');
        await expect.poll(reads.settled).toBe(true);
        const initialAttempts = reads.attempts();
        runs.push({ scenario, phase: 'unavailable', attempts: initialAttempts });
        persist();
        expect(
          initialAttempts.filter((entry) => entry.path === '/api/progress/summary'),
        ).toHaveLength(1);
        for (const width of shellCaptureWidths) {
          await page.setViewportSize({ width, height: 900 });
          if (width < 1024) {
            const menu = page.getByRole('button', { name: 'Открыть меню', exact: true });
            if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
          }
          await expect(sidebarRetry).toBeVisible();
          await noOverflow(page);
          await page.screenshot({
            path: `${shellCaptureDir}/owner-ux-${scenario}-${width}.png`,
            fullPage: true,
          });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        fault = 'available';
        held = new Promise<void>((resolve) => {
          release = resolve;
          pendingReleases.add(resolve);
        });
        // Two independently mounted consumers retry in the same event turn.
        // The transport is deliberately held so a concurrent duplicate is visible.
        await page.evaluate(() => {
          const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
            (button) =>
              ['Повторить загрузку прогресса', 'Обновить прогресс'].includes(
                button.textContent?.trim() ?? '',
              ),
          );
          if (buttons.length !== 2) throw new Error('Expected sidebar and page retry consumers');
          buttons[0]!.click();
          buttons[1]!.click();
          buttons[0]!.click();
        });
        await expect(
          strip.getByTestId('profile-full-everPublishedWorks').locator('span'),
        ).toHaveText('…');
        await expect
          .poll(
            () => reads.attempts().filter((entry) => entry.path === '/api/progress/summary').length,
          )
          .toBe(2);
        runs.push({ scenario, phase: 'retry_loading', attempts: reads.attempts() });
        persist();
        release!();
        pendingReleases.delete(release!);
        held = null;
        release = null;
        await expect(
          strip.getByTestId('profile-full-everPublishedWorks').locator('span'),
        ).toHaveText('0');
        await expect(strip.getByTestId('profile-full-currentLikes').locator('span')).toHaveText(
          '0',
        );
        await expect(page.locator('.learning-overview-empty')).toBeVisible();
        await expect(sidebarRetry).toHaveCount(0);
        await expect(page.getByTestId('personal-progress')).toHaveCount(0);
        await expect.poll(reads.settled).toBe(true);
        const finalAttempts = reads.attempts();
        runs.push({ scenario, phase: 'available', attempts: finalAttempts });
        persist();
        expect(
          finalAttempts.filter((entry) => entry.path === '/api/progress/summary'),
        ).toHaveLength(2);
        expect(finalAttempts.filter((entry) => entry.path === '/api/account/avatar')).toHaveLength(
          1,
        );
        const tabs = page.getByRole('navigation', { name: 'Разделы моего обучения' });
        await expect(tabs.getByRole('link', { name: 'Курсы', exact: true })).toBeVisible();
        await expect(tabs.getByRole('link', { name: 'Классы', exact: true })).toBeVisible();
      }
    } finally {
      for (const finish of pendingReleases) finish();
      held = null;
    }

    await page.goto('/#/home');
    const zoom = await openAiUsageNativeZoom(page);
    let zoomFailure: { error: unknown } | undefined;
    try {
      await zoom.page.route('https://st.max.ru/js/max-web-app.js', (route) =>
        route.abort('blockedbyclient'),
      );
      await zoom.page.goto('/#/home');
      await expect(zoom.page.locator('.home-module-empty:not([role])')).toHaveCount(4);
      const geometry = () =>
        zoom.page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          outerWidth,
          ratio: devicePixelRatio,
          visualScale: visualViewport?.scale,
          cssZoom: getComputedStyle(document.documentElement).zoom,
          scrollWidth: document.documentElement.scrollWidth,
        }));
      const before = await geometry();
      expect(before.width).toBe(1440);
      const applied = await zoom.setZoom(2);
      expect(applied).toMatchObject({
        factor: 2,
        settings: { mode: 'automatic', scope: 'per-tab' },
      });
      await expect.poll(() => zoom.page.evaluate(() => innerWidth)).toBeLessThan(before.width);
      const after = await geometry();
      expect(before.width / after.width).toBeCloseTo(2, 1);
      expect(after.ratio / before.ratio).toBe(2);
      expect(after.outerWidth).toBe(before.outerWidth);
      expect(after.cssZoom).toBe('1');
      expect(after.visualScale).toBe(1);
      await expect(zoom.page.locator('.access-personal-start')).toHaveCount(0);
      await noOverflow(zoom.page);
      const buttons = zoom.page.locator('.home-create-button');
      await expect(buttons).toHaveCount(4);
      const controls = [];
      for (let index = 0; index < 4; index++) {
        const button = buttons.nth(index);
        await expect(button).toBeEnabled();
        await button.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        // Trial performs the real visibility, hit-target and enabled checks without creating a project.
        await button.click({ trial: true });
        const bounds = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            module: element.closest('[data-module]')?.getAttribute('data-module'),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            headerBottom:
              document.querySelector('.portal-header')?.getBoundingClientRect().bottom ?? 0,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
          };
        });
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(bounds.viewportWidth + 1);
        expect(bounds.y).toBeGreaterThanOrEqual(Math.max(0, bounds.headerBottom));
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(bounds.viewportHeight + 1);
        controls.push(bounds);
      }
      await zoom.page.evaluate(async () => {
        await document.fonts.ready;
      });
      const captureScrollAttempts: Array<{ x: number; y: number; main: number }> = [];
      // Native zoom and the preceding trial scrolls can settle after a reset.
      // Establish the exact capture origin after layout instead of accepting an offset.
      await expect
        .poll(async () => {
          const position = await zoom.page.evaluate(async () => {
            const main = document.querySelector<HTMLElement>('.portal-shell > main');
            if (!main) throw new Error('Expected the Home scroll container');
            main.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            return { x: scrollX, y: scrollY, main: main.scrollTop };
          });
          captureScrollAttempts.push(position);
          return position;
        })
        .toEqual({ x: 0, y: 0, main: 0 });
      const captureScroll = await zoom.page.evaluate(() => ({
        x: scrollX,
        y: scrollY,
        main: document.querySelector<HTMLElement>('.portal-shell > main')!.scrollTop,
      }));
      expect(captureScroll).toEqual({ x: 0, y: 0, main: 0 });
      const captureFirstControl = await buttons.first().evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          module: element.closest('[data-module]')?.getAttribute('data-module'),
          y: rect.y,
          height: rect.height,
          headerBottom:
            document.querySelector('.portal-header')?.getBoundingClientRect().bottom ?? 0,
          viewportHeight: innerHeight,
        };
      });
      expect(captureFirstControl.module).toBe('three-d');
      expect(captureFirstControl.y).toBeGreaterThanOrEqual(
        Math.max(0, captureFirstControl.headerBottom),
      );
      expect(captureFirstControl.y + captureFirstControl.height).toBeLessThanOrEqual(
        captureFirstControl.viewportHeight + 1,
      );
      const cdp = await zoom.page.context().newCDPSession(zoom.page);
      let png: Buffer;
      try {
        // CSS-sized full-page captures crop a natively zoomed window; capture its actual viewport.
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        });
        png = Buffer.from(shot.data, 'base64');
      } finally {
        await cdp.detach();
      }
      writeFileSync(`${shellCaptureDir}/owner-ux-empty-home-native-200.png`, png);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      expect(pixels.width).toBe(1440);
      expect(pixels.width).toBe(Math.round(after.width * after.ratio));
      expect(Math.abs(pixels.height - after.height * after.ratio)).toBeLessThan(after.ratio);
      runs.push({
        scenario: 'native_browser_zoom',
        factor: applied.factor,
        before,
        after,
        pixels,
        controls,
        captureScroll,
        captureScrollAttempts,
        captureFirstControl,
      });
      persist();
    } catch (error) {
      zoomFailure = { error };
    } finally {
      await zoom.close(zoomFailure);
    }

    // A real successful mutation must refresh both mounted Home consumers.
    // The setup writes below occur before navigation and are not UI evidence.
    const title = `Проверка обновления показателей ${randomUUID().slice(0, 8)}`;
    const created = await page.request.post('/api/projects', {
      headers: { origin, 'idempotency-key': `owner-ux-publication-${randomUUID()}` },
      data: { scope: 'personal', module: 'electronics', title },
    });
    expect(created.status()).toBe(201);
    const projectId = (await created.json()).project.id as string;
    const imageDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Synthetic publication fixture canvas is unavailable');
      context.fillStyle = '#e6f3ff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#2464bd';
      context.fillRect(100, 60, 200, 120);
      return canvas.toDataURL('image/png');
    });
    expect(
      (
        await page.request.put(`/api/projects/${projectId}/snapshot`, {
          headers: { origin },
          data: { imageDataUrl, sourceRevision: 1 },
        })
      ).status(),
    ).toBe(200);
    await page.goto('about:blank');
    reads.begin();
    await page.goto('/#/home');
    const count = page.getByTestId('profile-full-everPublishedWorks').locator('span');
    await expect(count).toHaveText('0');
    const card = page.getByTestId('project-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('details > summary').click();
    await card.getByRole('button', { name: 'Публикация', exact: true }).click();
    const publication = page.getByRole('dialog', { name: 'Публикация проекта' });
    await expect(publication.getByTestId('publication-publish')).toHaveText('Опубликовать');
    await expect.poll(reads.settled).toBe(true);
    const beforeMutation = reads
      .attempts()
      .filter((entry) => entry.path === '/api/progress/summary');
    expect(beforeMutation).toHaveLength(1);
    const published = page.waitForResponse(
      (entry) =>
        entry.request().method() === 'POST' &&
        new URL(entry.url()).pathname === `/api/projects/${projectId}/publication`,
    );
    await publication.getByTestId('publication-publish').click();
    expect((await published).status()).toBe(200);
    await expect(count).toHaveText('1');
    await expect(publication.getByTestId('publication-publish')).toHaveText('Обновить публикацию');
    await expect(page).toHaveURL(/#\/home$/);
    await expect.poll(reads.settled).toBe(true);
    const publicationAttempts = reads.attempts();
    runs.push({ scenario: 'real_home_publication', attempts: publicationAttempts });
    persist();
    expect(
      publicationAttempts.filter((entry) => entry.path === '/api/progress/summary'),
    ).toHaveLength(beforeMutation.length + 1);
    expect(
      publicationAttempts.filter((entry) => entry.path === '/api/account/avatar'),
    ).toHaveLength(1);
    await publication.locator('.project-properties-close').click();
    await page.screenshot({
      path: `${shellCaptureDir}/owner-ux-publication-metrics-refresh.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
    complete = true;
  } finally {
    persist();
    reads.dispose();
  }
});
