import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { openPortalSection } from './portal-navigation';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/learning/vs-002';
const workShellV1EvidenceDir = 'e2e/artifacts/learning/work-shell-v1';
const desktopV1Viewport = { width: 1440, height: 900 } as const;
const mobileV1Viewports = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;
const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let teacher: SeededTeacher;
let sequence = 0;
const keys = new Map<string, string>();
test.use({ actionTimeout: 12000 });

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'learning-vs-002-browser');
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(workShellV1EvidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

async function createPublishedProjectActivity(
  title: string,
  moduleKey = 'electronics',
  brief = 'Соберите рабочую электрическую цепь.',
): Promise<void> {
  const identity = await admin.query(
    `SELECT principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const principalId = identity.rows[0].principal_id as string;
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,$4,$5,'private')
     RETURNING id`,
    [teacher.tenantId, principalId, title, brief, moduleKey],
  );
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [teacher.tenantId]);
    const created = await client.query(
      `SELECT * FROM learning_activity_create(
        $1,$2,'school','private','project',$3,'ignored','completion',NULL,
        $4::jsonb,$5,NULL,NULL,$6,$7)`,
      [
        principalId,
        teacher.tenantId,
        title,
        JSON.stringify(policies),
        moduleKey,
        authored.rows[0].id,
        `vs002:e2e:create:${++sequence}`,
      ],
    );
    await client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      principalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      `vs002:e2e:publish:${++sequence}`,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createClassWithStudents(
  page: Page,
  className: string,
  students: ReadonlyArray<{ label: string; handle: string }>,
): Promise<string> {
  await loginWithOrganization(page, teacher);
  await openPortalSection(page, 'Классы');
  await page
    .getByRole('button', { name: /^Создать(?: новый)? класс$/ })
    .first()
    .click();
  const create = page.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill(className);
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: className })
    .locator('.classroom-row-title')
    .click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  for (const student of students) {
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Имя в списке класса').fill(student.label);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog).toBeHidden();
    const rosterRow = page.getByRole('row').filter({ hasText: student.label });
    const studentCode = (await rosterRow.locator('.classroom-login-handle').innerText()).trim();
    expect(studentCode).toMatch(/^[2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy]{6}$/);
    keys.set(student.handle, studentCode);
  }
  return joinCode;
}

async function openAssignments(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Отдельные задания', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Задания класса' })).toBeVisible();
}

async function assignFromUi(
  page: Page,
  input: { title: string; due: string; students?: string[] },
): Promise<string> {
  await page.getByRole('button', { name: 'Назначить задание', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Назначить задание' });
  await dialog.getByLabel('Задание').selectOption({ label: input.title });
  if (input.students) {
    await dialog.getByLabel('Выбранные ученики').check();
    for (const student of input.students) await dialog.getByLabel(student).check();
  }
  await dialog.getByLabel('Срок', { exact: true }).fill(input.due + 'T18:00');
  const assigned = page.waitForResponse(
    (response) =>
      response.url().endsWith('/learning/activity-runs') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const response = await assigned;
  expect(response.ok()).toBeTruthy();
  return (await response.json()).assignmentId as string;
}

async function learnerAssignments(
  browser: Browser,
  joinCode: string,
  handle: string,
  viewport?: { readonly width: number; readonly height: number },
  bypassCSP = false,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const context = await browser.newContext({
    ...(viewport ? { viewport: { width: viewport.width, height: viewport.height } } : {}),
    ...(bypassCSP ? { bypassCSP: true } : {}),
  });
  const page = await context.newPage();
  await page.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await expect(page.getByLabel('Код ученика', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
  await page.getByLabel('Код ученика', { exact: true }).fill(keys.get(handle)!);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await openPortalSection(page, 'Моё обучение');
  return { context, page };
}

function assignmentRow(page: Page, title: string) {
  return page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
}

async function openAssignedProject(
  browser: Browser,
  teacherPage: Page,
  moduleKey: 'electronics' | 'three-d' | 'blocks',
  options: {
    brief?: string;
    viewport?: { readonly width: number; readonly height: number };
    bypassCSP?: boolean;
    title?: string;
  } = {},
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page; title: string }> {
  const token = ++sequence;
  const title = options.title ?? `A0 ${moduleKey} ${token}`;
  const handle = `a0-${moduleKey}-${token}`;
  await createPublishedProjectActivity(title, moduleKey, options.brief);
  const joinCode = await createClassWithStudents(teacherPage, `A0 ${moduleKey} ${token}`, [
    { label: `Ученик ${moduleKey} ${token}`, handle },
  ]);
  await openAssignments(teacherPage);
  await assignFromUi(teacherPage, { title, due: '2027-05-30' });

  const learner = await learnerAssignments(
    browser,
    joinCode,
    handle,
    options.viewport,
    options.bypassCSP,
  );
  const row = assignmentRow(learner.page, title);
  await expect(row).toContainText('Не начато');
  await row.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(learner.page.getByTestId('assignment-brief-anchor')).toBeVisible({
    timeout: 60_000,
  });
  await expect(learner.page.getByTestId('assignment-brief')).toHaveCount(0);
  return { ...learner, title };
}

async function assignmentBriefRect(page: Page): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  return page.getByTestId('assignment-brief').evaluate((element) => {
    const style = (element as HTMLElement).style;
    return {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
  });
}

test('learner starts the real project editor and submits one immutable attempt', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const teacherFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Светодиод и резистор VS002 ${++sequence}`;
  const className = `7А — VS002 ${sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, className, [
    { label: 'Анна', handle: `anna-vs002-${sequence}` },
    { label: 'Борис', handle: `boris-vs002-${sequence}` },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-05-30' });

  const learner = await learnerAssignments(browser, joinCode, `anna-vs002-${sequence}`);
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  let row = assignmentRow(learner.page, title);
  await expect(row).toContainText('Не начато');
  await row.screenshot({ path: `${evidenceDir}/learner-not-started.png` });

  await row.getByRole('button', { name: 'Открыть', exact: true }).click();
  const assignmentAnchor = learner.page.getByTestId('assignment-brief-anchor');
  const assignmentPanel = learner.page.getByTestId('assignment-brief');
  await expect(assignmentAnchor).toBeVisible();
  await expect(assignmentAnchor).toHaveAttribute('aria-expanded', 'false');
  await expect(assignmentPanel).toHaveCount(0);
  await expect(learner.page.locator('.workbench-shell')).toBeVisible({ timeout: 60_000 });
  await assignmentAnchor.click();
  await expect(assignmentPanel).toBeVisible();
  await expect(assignmentPanel.getByText(/редакц(?:ия|ии|ию|ией|ий) №/i)).toHaveCount(0);
  await assignmentAnchor.click();
  await expect(assignmentPanel).toHaveCount(0);
  await learner.page.screenshot({ path: `${evidenceDir}/real-project-editor.png` });
  const resistor = learner.page.getByRole('button', { name: 'Резистор', exact: true });
  const card = (await resistor.boundingBox())!;
  const canvas = (await learner.page.locator('.workbench-canvas').boundingBox())!;
  await learner.page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await learner.page.mouse.down();
  await learner.page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
    steps: 20,
  });
  await learner.page.mouse.up();
  await expect(learner.page.getByTestId('schematic-component')).toHaveCount(1);
  await expect(learner.page.getByTestId('assignment-brief-anchor')).toBeVisible();
  await learner.page.goto('/#/learning');
  await openPortalSection(learner.page, 'Моё обучение');

  row = assignmentRow(learner.page, title);
  await expect(row).toContainText('В работе');
  await expect(row.getByRole('button', { name: 'Открыть работу' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Сдать', exact: true })).toBeVisible();
  await row.screenshot({ path: `${evidenceDir}/learner-in-progress.png` });

  learner.page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Сдать сохранённую редакцию №');
    await dialog.accept();
  });
  await row.getByRole('button', { name: 'Сдать', exact: true }).click();
  await expect(row).toContainText('Сдано');
  await expect(row.getByRole('button', { name: 'Работа сдана' })).toBeDisabled();
  await row.screenshot({ path: `${evidenceDir}/learner-submitted.png` });

  await learner.page.reload();
  await openPortalSection(learner.page, 'Моё обучение');
  await expect(assignmentRow(learner.page, title)).toContainText('Сдано');

  await page.reload();
  await openPortalSection(page, 'Классы');
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: className })
    .locator('.classroom-row-title')
    .click();
  await openAssignments(page);
  const teacherRow = page.getByTestId('assignment-list').locator('li').filter({ hasText: title });
  await expect(teacherRow).toContainText('Назначено: 2 · Работают: 1 · Сдали: 1');
  await teacherRow.screenshot({ path: `${evidenceDir}/teacher-submitted.png` });

  teacherFailures.assertEmpty();
  learnerFailures.assertEmpty();
  await learner.context.close();
});

test('named audience excludes the third learner from read, start and submit', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const title = `Точная цепь VS002 ${++sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, `8Б — VS002 ${sequence}`, [
    { label: 'Галя', handle: `galya-vs002-${sequence}` },
    { label: 'Дима', handle: `dima-vs002-${sequence}` },
    { label: 'Егор', handle: `egor-vs002-${sequence}` },
  ]);
  await openAssignments(page);
  const assignmentId = await assignFromUi(page, {
    title,
    due: '2027-05-30',
    students: ['Галя', 'Дима'],
  });

  const excluded = await learnerAssignments(browser, joinCode, `egor-vs002-${sequence}`);
  await expect(excluded.page.getByText(title, { exact: true })).toHaveCount(0);
  const foreignProject = '123e4567-e89b-42d3-a456-426614174099';
  const statuses = await excluded.page.evaluate(
    async ({ assignmentId, foreignProject, sequence }) => {
      const post = (suffix: string, body: unknown) =>
        fetch(`/api/class-join/me/assignments/${assignmentId}/${suffix}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const start = await post('work', { projectId: foreignProject });
      const submit = await post('submit', {
        submitted: true,
        clientRequestId: `vs002:excluded:${sequence}`,
      });
      return { start: start.status, submit: submit.status };
    },
    { assignmentId, foreignProject, sequence },
  );
  expect(statuses).toEqual({ start: 404, submit: 404 });
  await excluded.page.screenshot({ path: `${evidenceDir}/learner-excluded.png`, fullPage: true });
  await excluded.context.close();
});

test('A0 desktop Electronics uses a permanent anchor and compact movable task panel', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(desktopV1Viewport);
  const learner = await openAssignedProject(browser, page, 'electronics', {
    viewport: desktopV1Viewport,
    title: 'Исследование последовательной электрической цепи и закона Ома',
  });
  const anchor = learner.page.getByTestId('assignment-brief-anchor');
  const brief = learner.page.getByTestId('assignment-brief');

  await expect(learner.page.locator('.workbench-shell')).toBeVisible({ timeout: 60_000 });
  await expect(anchor).toBeVisible();
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toHaveCount(0);
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-electronics-anchor-1440.png`,
    fullPage: false,
  });

  const anchorBefore = (await anchor.boundingBox())!;
  await anchor.click();
  await expect(anchor).toHaveAttribute('aria-expanded', 'true');
  await expect(brief).toBeVisible();
  const header = brief.locator('.assignment-brief-header');
  const footer = brief.locator('.assignment-brief-footer');
  const compact = await assignmentBriefRect(learner.page);
  expect(compact.width).toBeGreaterThanOrEqual(360);
  expect(compact.width).toBeLessThanOrEqual(400);
  expect(compact.height).toBeGreaterThanOrEqual(260);
  expect(compact.height).toBeLessThanOrEqual(320);
  await expect(brief.locator('.assignment-brief-title')).toHaveText(learner.title);
  await expect(brief.locator('.assignment-brief-title')).toBeVisible();
  await expect(header.getByRole('button', { name: 'Сдать работу' })).toHaveCount(0);
  await expect(header.getByText('Сбросить', { exact: true })).toHaveCount(0);
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('button', { name: 'Сдать работу' })).toBeVisible();
  await expect(brief.getByText(/редакц(?:ия|ии|ию|ией|ий) №/i)).toHaveCount(0);
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-electronics-panel-1440.png`,
    fullPage: false,
  });

  await brief.getByRole('button', { name: 'Расширить задание' }).click();
  const expanded = await assignmentBriefRect(learner.page);
  expect(expanded.width).toBeGreaterThan(compact.width + 100);
  expect(expanded.height).toBeGreaterThan(compact.height + 100);
  expect(expanded.width).toBeLessThanOrEqual(Math.floor(desktopV1Viewport.width * 0.7));
  expect(expanded.height).toBeLessThanOrEqual(Math.floor((900 - 58 - 24) * 0.8));
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-electronics-expanded-1440.png`,
    fullPage: false,
  });

  await brief.getByRole('button', { name: 'Вернуть компактный размер' }).click();
  expect(await assignmentBriefRect(learner.page)).toEqual(compact);

  const drag = brief.getByRole('button', { name: 'Переместить карточку задания' });
  const dragBox = (await drag.boundingBox())!;
  const workbench = (await learner.page.locator('.workbench-canvas').boundingBox())!;
  await learner.page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await learner.page.mouse.down();
  await learner.page.mouse.move(
    workbench.x + workbench.width * 0.58,
    workbench.y + workbench.height * 0.32,
    { steps: 20 },
  );
  await learner.page.mouse.up();
  const moved = await assignmentBriefRect(learner.page);
  expect(Math.abs(moved.x - compact.x) + Math.abs(moved.y - compact.y)).toBeGreaterThan(20);
  const anchorAfter = (await anchor.boundingBox())!;
  expect(Math.abs(anchorAfter.x - anchorBefore.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(anchorAfter.y - anchorBefore.y)).toBeLessThanOrEqual(1);
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-electronics-moved-1440.png`,
    fullPage: false,
  });

  const resize = brief.locator('.assignment-brief-resize-bottom-right');
  const resizeBox = (await resize.boundingBox())!;
  await learner.page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await learner.page.mouse.down();
  await learner.page.mouse.move(resizeBox.x + 120, resizeBox.y + 90, { steps: 12 });
  await learner.page.mouse.up();
  const resized = await assignmentBriefRect(learner.page);
  expect(resized.width).toBeGreaterThan(moved.width);
  expect(resized.height).toBeGreaterThan(moved.height);

  await anchor.click();
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toHaveCount(0);
  await expect(anchor).toBeVisible();
  await anchor.click();
  await expect(brief).toBeVisible();
  expect(await assignmentBriefRect(learner.page)).toEqual(resized);

  await brief.locator('.assignment-brief-menu > summary').click();
  await brief.getByRole('button', { name: 'Сбросить положение и размер' }).click();
  expect(await assignmentBriefRect(learner.page)).toEqual({
    x: 12,
    y: 524,
    width: 380,
    height: 300,
  });

  await anchor.focus();
  await learner.page.keyboard.press('Enter');
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
  await learner.page.keyboard.press('Enter');
  await expect(anchor).toHaveAttribute('aria-expanded', 'true');
  await expect(learner.page.locator('.workbench-shell')).toBeVisible();
  await learner.context.close();
});

test('A0 3D shell keeps anchor and panel above the editor while tools remain interactive', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(desktopV1Viewport);
  const learner = await openAssignedProject(browser, page, 'three-d', {
    viewport: desktopV1Viewport,
  });
  const anchor = learner.page.getByTestId('assignment-brief-anchor');
  const brief = learner.page.getByTestId('assignment-brief');
  const viewport = learner.page.getByTestId('asa3d-viewport');

  await expect(viewport).toBeVisible({ timeout: 60_000 });
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true', { timeout: 60_000 });
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toHaveCount(0);
  await anchor.click();
  await expect(brief).toBeVisible();
  await expect(anchor).toBeVisible();

  const tool = learner.page.getByRole('button', { name: 'Параллелепипед', exact: true });
  await expect(tool).toBeVisible();
  const briefBox = (await brief.boundingBox())!;
  const toolBox = (await tool.boundingBox())!;
  const toolPoint = {
    x: toolBox.x + toolBox.width / 2,
    y: toolBox.y + toolBox.height / 2,
  };
  expect(
    toolPoint.x >= briefBox.x &&
      toolPoint.x <= briefBox.x + briefBox.width &&
      toolPoint.y >= briefBox.y &&
      toolPoint.y <= briefBox.y + briefBox.height,
  ).toBe(false);

  await tool.click();
  await expect(viewport).toHaveAttribute('data-selected-node-id', /.+/);
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-three-d-panel-1440.png`,
    fullPage: false,
  });
  await learner.context.close();
});

test('A0 Blocks keeps anchor and panel topmost over fullscreen Scratch', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize(desktopV1Viewport);
  const learner = await openAssignedProject(browser, page, 'blocks', {
    viewport: desktopV1Viewport,
    // The E2E API serves the SPA with a stricter CSP than production Caddy.
    // Bypass only that harness-only CSP so the pinned separate Scratch origin can load.
    bypassCSP: true,
  });
  const anchor = learner.page.getByTestId('assignment-brief-anchor');
  const brief = learner.page.getByTestId('assignment-brief');
  const fullscreen = learner.page.locator('[data-asa-blocks-fullscreen]');

  await expect(fullscreen).toBeVisible({ timeout: 60_000 });
  const loadingOverlay = learner.page.locator('[data-asa-blocks-loading-overlay]');
  const runtimeFrame = learner.page.locator('iframe[title="Scratch runtime"]');
  await expect(loadingOverlay).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(runtimeFrame).toBeVisible({ timeout: 60_000 });
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toHaveCount(0);

  const anchorBox = (await anchor.boundingBox())!;
  const anchorTopmost = await learner.page.evaluate(
    ({ x, y }) =>
      Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="assignment-brief-anchor"]')),
    { x: anchorBox.x + anchorBox.width / 2, y: anchorBox.y + anchorBox.height / 2 },
  );
  expect(anchorTopmost).toBe(true);

  await anchor.click();
  await expect(brief).toBeVisible();
  await expect(anchor).toBeVisible();
  const box = (await brief.boundingBox())!;
  const panelTopmost = await learner.page.evaluate(
    ({ x, y }) =>
      Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="assignment-brief"]')),
    { x: box.x + Math.min(120, box.width / 2), y: box.y + 24 },
  );
  expect(panelTopmost).toBe(true);

  const stacking = await learner.page.evaluate(() => ({
    blocks: getComputedStyle(document.querySelector('[data-asa-blocks-fullscreen]')!).zIndex,
    brief: getComputedStyle(document.querySelector('[data-testid="assignment-brief"]')!).zIndex,
    anchor: getComputedStyle(
      document.querySelector('[data-testid="assignment-brief-anchor"]')!,
    ).zIndex,
  }));
  expect(stacking).toEqual({ blocks: '1000', brief: '1100', anchor: '1110' });
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-blocks-overlay-1440.png`,
    fullPage: false,
  });
  await learner.context.close();
});

test('A0 mobile shell uses a permanent bottom anchor and bounded sheet at 390 and 320', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const longBrief = Array.from(
    { length: 36 },
    (_, index) =>
      `Шаг ${index + 1}: соберите и проверьте учебную цепь, затем зафиксируйте результат.`,
  ).join('\n');
  const learner = await openAssignedProject(browser, page, 'electronics', {
    brief: longBrief,
    viewport: mobileV1Viewports[0],
  });
  const anchor = learner.page.getByTestId('assignment-brief-anchor');
  const brief = learner.page.getByTestId('assignment-brief');

  await expect(anchor).toBeVisible();
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toHaveCount(0);
  await learner.page.screenshot({
    path: `${workShellV1EvidenceDir}/V1-mobile-anchor-390.png`,
    fullPage: false,
  });

  for (const viewport of mobileV1Viewports) {
    await learner.page.setViewportSize(viewport);
    await expect(anchor).toBeVisible();
    if ((await anchor.getAttribute('aria-expanded')) === 'true') await anchor.click();
    await expect(anchor).toHaveAttribute('aria-expanded', 'false');
    await expect(brief).toHaveCount(0);

    await anchor.click();
    await expect(anchor).toHaveAttribute('aria-expanded', 'true');
    await expect(brief).toBeVisible();
    await expect(brief).toHaveClass(/is-mobile/);
    await expect(
      brief.getByRole('button', { name: 'Переместить карточку задания' }),
    ).toHaveCount(0);
    await expect(brief.locator('.assignment-brief-resize')).toHaveCount(0);
    await expect(brief.locator('.assignment-brief-body')).toHaveCSS('overflow-y', 'auto');

    const panelBox = (await brief.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(7);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width - 7);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
      await learner.page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.body.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await learner.page.screenshot({
      path: `${workShellV1EvidenceDir}/V1-mobile-panel-${viewport.width}.png`,
      fullPage: false,
    });

    await anchor.click();
    await expect(anchor).toHaveAttribute('aria-expanded', 'false');
    await expect(brief).toHaveCount(0);
    await expect(anchor).toBeVisible();
  }

  await learner.context.close();
});
