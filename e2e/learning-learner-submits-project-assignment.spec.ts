import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { openPortalSection } from './portal-navigation';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/learning/vs-002';
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
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const context = await browser.newContext();
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
  brief?: string,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page; title: string }> {
  const token = ++sequence;
  const title = `A0 ${moduleKey} ${token}`;
  const handle = `a0-${moduleKey}-${token}`;
  await createPublishedProjectActivity(title, moduleKey, brief);
  const joinCode = await createClassWithStudents(teacherPage, `A0 ${moduleKey} ${token}`, [
    { label: `Ученик ${moduleKey} ${token}`, handle },
  ]);
  await openAssignments(teacherPage);
  await assignFromUi(teacherPage, { title, due: '2027-05-30' });

  const learner = await learnerAssignments(browser, joinCode, handle);
  const row = assignmentRow(learner.page, title);
  await expect(row).toContainText('Не начато');
  await row.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(learner.page.getByTestId('assignment-brief')).toBeVisible({ timeout: 60_000 });
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
  await expect(learner.page.getByTestId('assignment-brief')).toBeVisible();
  await expect(learner.page.locator('.workbench-shell')).toBeVisible({ timeout: 60_000 });
  await learner.page.screenshot({ path: `${evidenceDir}/real-project-editor.png` });
  await expect(learner.page.getByTestId('assignment-brief')).toBeVisible();
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
  await expect(
    learner.page.getByText(
      /К проверке будет закреплена сохранённая редакция №|Черновик сохранён: редакция №/,
    ),
  ).toBeVisible();
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


test('A0 desktop Electronics shell is movable, bounded, resettable and keyboard accessible', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const learner = await openAssignedProject(browser, page, 'electronics');
  const brief = learner.page.getByTestId('assignment-brief');
  const toggle = brief.getByRole('button', { name: /^Задание:/ });
  const drag = brief.getByRole('button', { name: 'Переместить карточку задания' });
  const reset = brief.getByRole('button', { name: 'Сбросить', exact: true });

  await expect(learner.page.locator('.workbench-shell')).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(drag).toBeVisible();
  await expect(reset).toBeVisible();
  expect(await assignmentBriefRect(learner.page)).toEqual({
    x: 12,
    y: 428,
    width: 460,
    height: 460,
  });

  const initial = (await brief.boundingBox())!;
  const dragBox = (await drag.boundingBox())!;
  const workbench = (await learner.page.locator('.workbench-canvas').boundingBox())!;
  await learner.page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await learner.page.mouse.down();
  await learner.page.mouse.move(workbench.x + workbench.width * 0.65, workbench.y + workbench.height * 0.35, {
    steps: 20,
  });
  await learner.page.mouse.move(workbench.x + workbench.width * 0.72, workbench.y + workbench.height * 0.45, {
    steps: 12,
  });
  await learner.page.mouse.up();
  const moved = (await brief.boundingBox())!;
  expect(Math.abs(moved.x - initial.x) + Math.abs(moved.y - initial.y)).toBeGreaterThan(20);

  const resize = brief.locator('.assignment-brief-resize-bottom-right');
  const resizeBox = (await resize.boundingBox())!;
  await learner.page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await learner.page.mouse.down();
  await learner.page.mouse.move(4000, 3000, { steps: 20 });
  await learner.page.mouse.up();
  const oversized = await assignmentBriefRect(learner.page);
  expect(oversized.width).toBeLessThanOrEqual(Math.floor(1440 * 0.7));
  expect(oversized.height).toBeLessThanOrEqual(Math.floor((900 - 58 - 24) * 0.8));

  const dragAgain = brief.getByRole('button', { name: 'Переместить карточку задания' });
  const dragAgainBox = (await dragAgain.boundingBox())!;
  await learner.page.mouse.move(
    dragAgainBox.x + dragAgainBox.width / 2,
    dragAgainBox.y + dragAgainBox.height / 2,
  );
  await learner.page.mouse.down();
  await learner.page.mouse.move(-2000, -2000, { steps: 12 });
  await learner.page.mouse.up();
  const clamped = await assignmentBriefRect(learner.page);
  expect(clamped.x).toBeGreaterThanOrEqual(12);
  expect(clamped.y).toBeGreaterThanOrEqual(70);
  expect(clamped.x + clamped.width).toBeLessThanOrEqual(1428);
  expect(clamped.y + clamped.height).toBeLessThanOrEqual(888);

  await reset.focus();
  await learner.page.keyboard.press('Enter');
  expect(await assignmentBriefRect(learner.page)).toEqual({
    x: 12,
    y: 428,
    width: 460,
    height: 460,
  });

  await toggle.focus();
  await learner.page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toBeVisible();
  await learner.page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(learner.page.locator('.workbench-shell')).toBeVisible();
  await learner.context.close();
});

test('A0 3D shell stays above the editor while editor controls remain interactive outside it', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const learner = await openAssignedProject(browser, page, 'three-d');
  const brief = learner.page.getByTestId('assignment-brief');
  const viewport = learner.page.getByTestId('asa3d-viewport');
  const toggle = brief.getByRole('button', { name: /^Задание:/ });

  await expect(viewport).toBeVisible({ timeout: 60_000 });
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true', { timeout: 60_000 });
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
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
  await learner.context.close();
});

test('A0 real Blocks assignment keeps AssignmentBrief topmost over fullscreen Scratch', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const learner = await openAssignedProject(browser, page, 'blocks');
  const brief = learner.page.getByTestId('assignment-brief');
  const fullscreen = learner.page.locator('[data-asa-blocks-fullscreen]');

  await expect(fullscreen).toBeVisible({ timeout: 60_000 });
  const frame = learner.page.frameLocator('iframe[title="Scratch runtime"]');
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 60_000 },
  );
  await expect(frame.locator('.blocklySvg').first()).toBeVisible({ timeout: 60_000 });

  const box = (await brief.boundingBox())!;
  const topmost = await learner.page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest('[data-testid="assignment-brief"]'));
    },
    { x: box.x + Math.min(120, box.width / 2), y: box.y + 24 },
  );
  expect(topmost).toBe(true);

  const stacking = await learner.page.evaluate(() => ({
    blocks: getComputedStyle(document.querySelector('[data-asa-blocks-fullscreen]')!).zIndex,
    brief: getComputedStyle(document.querySelector('[data-testid="assignment-brief"]')!).zIndex,
  }));
  expect(stacking).toEqual({ blocks: '1000', brief: '1100' });
  await learner.context.close();
});

test('A0 mobile shell is a bounded bottom panel at 390 and 320 without desktop handles', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const longBrief = Array.from(
    { length: 36 },
    (_, index) =>
      `Шаг ${index + 1}: соберите и проверьте учебную цепь, затем зафиксируйте результат.`,
  ).join('\n');
  const learner = await openAssignedProject(browser, page, 'electronics', longBrief);
  const brief = learner.page.getByTestId('assignment-brief');
  const toggle = brief.getByRole('button', { name: /^Задание:/ });
  const body = brief.locator('.assignment-brief-body');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await learner.page.setViewportSize(viewport);
    await expect(brief).toHaveClass(/is-mobile/);

    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(brief).toBeVisible();
    await expect(brief.getByRole('button', { name: 'Переместить карточку задания' })).toHaveCount(0);
    await expect(brief.locator('.assignment-brief-resize')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toHaveCSS('overflow-y', 'auto');
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

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

    const workbenchBox = (await learner.page.locator('.workbench-shell').boundingBox())!;
    const panelPoint = {
      x: panelBox.x + panelBox.width / 2,
      y: panelBox.y + panelBox.height / 2,
    };
    expect(
      panelPoint.x >= workbenchBox.x &&
        panelPoint.x <= workbenchBox.x + workbenchBox.width &&
        panelPoint.y >= workbenchBox.y &&
        panelPoint.y <= workbenchBox.y + workbenchBox.height,
    ).toBe(true);
    expect(
      await learner.page.evaluate(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="assignment-brief"]')),
        panelPoint,
      ),
    ).toBe(true);
  }

  await learner.context.close();
});
