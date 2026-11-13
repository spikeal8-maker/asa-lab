import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { registerAccountSetup } from './registration-setup';
import { portalSidebar, portalTopBar } from './portal-navigation';
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
async function expectProjectPermissionSaved(page: Page, section: import('@playwright/test').Locator) {
  const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
  await expect(ribbon).toHaveCount(1);
  await expect(ribbon).toContainText('Разрешения проектов сохранены.');
  const announcement = page.locator('.system-feedback-announcement[role="status"]');
  await expect(announcement).toHaveCount(1);
  await expect(announcement).toContainText('Разрешения проектов сохранены.');
  await expect(
    section.getByText('Разрешения проектов сохранены.', { exact: true }),
  ).toHaveCount(0);
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
    data: { title: 'Учебные игры', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
  });
  expect(classroom.status(), await classroom.text()).toBe(201);
  const classroomId = (await classroom.json()).classroom.id as string;
  const details = await page.request.get(`/api/classrooms/${classroomId}`);
  expect(details.status(), await details.text()).toBe(200);
  const classCode = (await details.json()).classroom.joinCode as string;
  const issued = await page.request.post(`/api/classrooms/${classroomId}/seats`, {
    headers: { origin },
    data: { displayLabel: 'Ученик допуска', safeMode: true },
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

function observeShellReads(page: Page, origin: string) {
  const pending = new Set<Request>();
  const entries = new Map<Request, ShellRead>();
  let lastChange = Date.now();
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
      path: url.pathname,
      module: url.searchParams.get('module'),
      status: null,
      failed: false,
    });
    lastChange = Date.now();
  };
  const responded = (response: import('@playwright/test').Response) => {
    const entry = entries.get(response.request());
    if (entry) entry.status = response.status();
  };
  const finished = (request: Request) => {
    if (pending.delete(request)) lastChange = Date.now();
  };
  const failed = (request: Request) => {
    const entry = entries.get(request);
    if (entry) entry.failed = true;
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
    },
    settled: () => pending.size === 0 && Date.now() - lastChange >= 250,
    snapshot: () => [...entries.values()].map((entry) => ({ ...entry })),
    dispose: () => {
      page.off('request', requested);
      page.off('response', responded);
      page.off('requestfinished', finished);
      page.off('requestfailed', failed);
    },
  };
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
            await expect(page.locator('.learning-overview-metrics strong')).toHaveText([
              '0',
              '0',
              '0',
            ]);
          }
          await expect.poll(reads.settled).toBe(true);
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
              reads: reads.snapshot(),
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
