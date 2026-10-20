import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { openPortalSection } from './portal-navigation';
import {
  closeAssignmentPreview,
  openExistingAssignmentEditor,
  openNewAssignmentEditor,
  previewAssignmentAs,
} from './learning-authoring-navigation';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/learning/vs-001';
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
  teacher = await seedTeacher(admin, 'learning-vs-001-browser');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

function solidPng(red: number, green: number, blue: number, width = 3, height = 3): Buffer {
  const image = new PNG({ width, height });
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function createPublishedProjectActivity(
  title: string,
  blocks?: ReadonlyArray<Record<string, unknown>>,
  activityPolicies = policies,
): Promise<{ principalId: string; versionId: string }> {
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const principalId = identity.rows[0].principal_id as string;
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите рабочую электрическую цепь.','electronics','private')
     RETURNING id`,
    [teacher.tenantId, principalId, title],
  );
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [teacher.tenantId]);
    const created = await client.query(
      `SELECT * FROM learning_activity_create(
        $1,$2,'school','private','project',$3,'ignored','completion',NULL,
        $4::jsonb,'electronics',NULL,NULL,$5,$6,NULL::jsonb,$7::jsonb)`,
      [
        principalId,
        teacher.tenantId,
        title,
        JSON.stringify(activityPolicies),
        authored.rows[0].id,
        `vs:e2e:create:${++sequence}`,
        blocks ? JSON.stringify(blocks) : null,
      ],
    );
    const published = await client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      principalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      `vs:e2e:publish:${++sequence}`,
    ]);
    await client.query('COMMIT');
    return { principalId, versionId: published.rows[0].activity_version_id as string };
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
  alreadyAuthenticated = false,
): Promise<string> {
  if (!alreadyAuthenticated) await loginWithOrganization(page, teacher);
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
  await page.locator('.classroom-code-chip').click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  for (const student of students) {
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Имя в списке класса').fill(student.label);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog).toBeHidden();
    const rosterRow = page.getByRole('row').filter({ hasText: student.label });
    await rosterRow.locator('.classroom-login-handle').click();
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
): Promise<void> {
  await page.getByRole('button', { name: 'Назначить задание', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Назначить задание' });
  await dialog.getByLabel('Задание').selectOption({ label: input.title });
  if (input.students) {
    await dialog.getByLabel('Выбранные ученики').check();
    for (const student of input.students) await dialog.getByLabel(student).check();
  }
  await dialog.getByLabel('Срок', { exact: true }).fill(input.due + 'T18:00');
  await dialog.screenshot({
    path: `${evidenceDir}/${input.students ? 'dialog-two-learners' : 'dialog-whole-class'}.png`,
  });
  await dialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(dialog).toBeHidden();
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
  await page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  return { context, page };
}

test('teacher assigns a canonical activity to the whole class and a learner sees it', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Светодиод и резистор ${++sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, '7А — Электроника', [
    { label: 'Анна', handle: 'anna-vs-whole' },
    { label: 'Борис', handle: 'boris-vs-whole' },
    { label: 'Вера', handle: 'vera-vs-whole' },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-09-30' });

  const teacherRow = page.getByTestId('assignment-list').locator('li').filter({ hasText: title });
  await expect(teacherRow).toContainText('Весь класс');
  await expect(teacherRow).toContainText('Срок');
  await teacherRow.screenshot({ path: `${evidenceDir}/teacher-whole-class.png` });

  const learner = await learnerAssignments(browser, joinCode, 'anna-vs-whole');
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  const learnerRow = learner.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  await expect(learnerRow).toContainText('Не начато');
  await expect(learnerRow).toContainText('Сдать до');
  await expect(learnerRow.getByRole('button', { name: 'Открыть', exact: true })).toBeVisible();
  await learnerRow.screenshot({ path: `${evidenceDir}/learner-whole-class.png` });

  failures.assertEmpty();
  learnerFailures.assertEmpty();
  await learner.context.close();
});

test('learner sees ordered safe task blocks in direct assignment and project shell', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const token = `a2c-${++sequence}`;
  const title = `Safe task blocks ${token}`;
  const heading = `Соберите цепь ${token}`;
  const paragraph = 'Убедитесь, что <script>alert(1)</script> остаётся текстом.';
  await createPublishedProjectActivity(title, [
    { type: 'heading', text: heading },
    { type: 'paragraph', text: paragraph },
    { type: 'list', items: ['Подключите источник', 'Проверьте резистор'] },
    { type: 'callout', text: 'Отключите питание перед изменением схемы.' },
    { type: 'link', text: 'Справка', href: 'https://example.org/lesson' },
  ]);
  const joinCode = await createClassWithStudents(page, `A2c ${token}`, [
    { label: 'Ученик', handle: token },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-09-30' });

  const learner = await learnerAssignments(browser, joinCode, token);
  const failures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  const row = learner.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
  await row.getByRole('button', { name: title, exact: true }).click();
  const detail = row.getByTestId('task-blocks');
  await expect(detail.getByRole('heading', { name: heading })).toBeVisible();
  await expect(detail.getByText(paragraph, { exact: true })).toBeVisible();
  await expect(detail.getByRole('link', { name: 'Справка' })).toHaveAttribute(
    'href',
    'https://example.org/lesson',
  );
  await expect(detail.locator('script')).toHaveCount(0);
  const order = await detail.locator(':scope > *').allTextContents();
  expect(order).toEqual([
    'Соберите рабочую электрическую цепь.',
    heading,
    paragraph,
    'Подключите источникПроверьте резистор',
    'Отключите питание перед изменением схемы.',
    'Справка',
  ]);
  for (const width of [1440, 1024, 390, 320]) {
    await learner.page.setViewportSize({ width, height: 900 });
    await expect(detail).toBeVisible();
    await row.screenshot({ path: `${evidenceDir}/a2c-learner-${width}.png` });
  }

  await row.getByRole('button', { name: 'Открыть', exact: true }).click();
  const anchor = learner.page.getByTestId('assignment-brief-anchor');
  await expect(anchor).toBeVisible({ timeout: 60_000 });
  await anchor.click();
  const shell = learner.page.getByTestId('assignment-brief').getByTestId('task-blocks');
  await expect(
    shell.getByText('Соберите рабочую электрическую цепь.', { exact: true }),
  ).toBeVisible();
  await expect(shell.getByRole('heading', { name: heading })).toBeVisible();
  await expect(shell.getByText(paragraph, { exact: true })).toBeVisible();
  failures.assertEmpty();
  await learner.context.close();
});

test('teacher selects two learners and the third learner cannot see the assignment', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Точная цепь ${++sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, '8Б — Практика', [
    { label: 'Галя', handle: 'galya-vs-named' },
    { label: 'Дима', handle: 'dima-vs-named' },
    { label: 'Егор', handle: 'egor-vs-named' },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-10-07', students: ['Галя', 'Дима'] });

  const teacherRow = page.getByTestId('assignment-list').locator('li').filter({ hasText: title });
  await expect(teacherRow).toContainText('Выбрано: 2');
  await teacherRow.screenshot({ path: `${evidenceDir}/teacher-two-learners.png` });

  for (const handle of ['galya-vs-named', 'dima-vs-named']) {
    const learner = await learnerAssignments(browser, joinCode, handle);
    await expect(
      learner.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title }),
    ).toBeVisible();
    await learner.context.close();
  }
  const excluded = await learnerAssignments(browser, joinCode, 'egor-vs-named');
  await expect(excluded.page.getByText(title, { exact: true })).toHaveCount(0);
  await expect(excluded.page.locator('.portal-nav-count')).toHaveCount(0);
  await excluded.page.screenshot({
    path: `${evidenceDir}/learner-third-excluded.png`,
    fullPage: true,
  });
  await excluded.context.close();

  failures.assertEmpty();
});

test('learner exact published task image stays pinned across v1 and v2', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const token = ++sequence;
  const title = `Exact learner image ${token}`;
  const imageA = solidPng(205, 45, 45);
  const imageB = solidPng(40, 75, 210);
  const taskImage = solidPng(60, 130, 180, 240, 120);

  await loginWithOrganization(page, teacher);
  await openNewAssignmentEditor(page);
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Соберите схему по точному образцу.');
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  const fileInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await fileInput.setInputFiles({
    name: 'learner-exact-a.png',
    mimeType: 'image/png',
    buffer: imageA,
  });
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('Файл блока изображения').setInputFiles({
    name: 'ordered-task.png',
    mimeType: 'image/png',
    buffer: taskImage,
  });
  await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
  await page.getByLabel('Описание блока 1').fill('Опубликованная схема');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const publishV1 = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const v1Response = await publishV1;
  expect(v1Response.ok()).toBe(true);
  const v1 = (await v1Response.json()) as { id: string; versionNumber: number };
  expect(v1.versionNumber).toBe(1);

  const joinCodeV1 = await createClassWithStudents(
    page,
    `UX1A3 V1 ${token}`,
    [{ label: `Learner A ${token}`, handle: `ux1a3-a-${token}` }],
    true,
  );
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-09-30' });

  const learnerA = await learnerAssignments(browser, joinCodeV1, `ux1a3-a-${token}`);
  const learnerAFailures = collectBrowserFailures(learnerA.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  let rowA = learnerA.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
  const cardImageA = rowA.getByRole('img', { name: `Образец: ${title}` });
  await expect(cardImageA).toBeVisible();
  const cardSourceA = await cardImageA.getAttribute('src');
  expect(cardSourceA).toContain(`/api/assignments/activity-versions/${v1.id}/sample`);
  const cardBytesA = await learnerA.page.request.get(
    new URL(cardSourceA!, learnerA.page.url()).toString(),
  );
  expect(cardBytesA.ok()).toBe(true);
  expect(Buffer.compare(await cardBytesA.body(), imageA)).toBe(0);

  await rowA.getByRole('button', { name: title, exact: true }).click();
  const assignmentViewA = rowA.getByTestId('assignment-view');
  const detailImageA = assignmentViewA.getByRole('img', { name: `Образец: ${title}` });
  await expect(detailImageA).toBeVisible();
  await assignmentViewA.getByRole('button', { name: `Открыть образец: ${title}` }).click();
  const homeLightbox = learnerA.page.getByRole('dialog', { name: `Образец: ${title}` });
  await expect(homeLightbox).toBeVisible();
  await homeLightbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(homeLightbox).toHaveCount(0);

  await rowA.getByRole('button', { name: 'Открыть', exact: true }).click();
  const briefAnchor = learnerA.page.getByTestId('assignment-brief-anchor');
  await expect(briefAnchor).toBeVisible({ timeout: 60_000 });
  await briefAnchor.click();
  const brief = learnerA.page.getByTestId('assignment-brief');
  await expect(brief).toBeVisible();
  const briefImageA = brief.getByRole('img', { name: `Образец: ${title}` });
  await expect(briefImageA).toBeVisible();
  await brief.getByRole('button', { name: `Открыть образец: ${title}` }).click();
  const briefLightbox = learnerA.page.getByRole('dialog', { name: `Образец: ${title}` });
  await expect(briefLightbox).toBeVisible();
  await briefLightbox.getByRole('button', { name: 'Закрыть', exact: true }).click();

  const orderedImage = brief.getByRole('img', { name: 'Опубликованная схема' });
  await expect(orderedImage).toBeVisible();
  const orderedSource = await orderedImage.getAttribute('src');
  expect(orderedSource).toContain('/api/assignments/task-images/');
  const orderedBytes = await learnerA.page.request.get(
    new URL(orderedSource!, learnerA.page.url()).toString(),
  );
  expect(Buffer.compare(await orderedBytes.body(), taskImage)).toBe(0);
  await brief.getByRole('button', { name: 'Открыть крупно: Опубликованная схема' }).click();
  const orderedZoom = learnerA.page.getByRole('dialog', {
    name: 'Изображение задания: Опубликованная схема',
  });
  await expect(orderedZoom.getByRole('img', { name: 'Опубликованная схема' })).toHaveAttribute(
    'src',
    orderedSource!,
  );
  await learnerA.page.screenshot({ path: `${evidenceDir}/a6-lab-zoom-desktop.png` });
  await orderedZoom.getByRole('button', { name: 'Закрыть' }).click();
  await brief.getByRole('button', { name: 'Закрепить изображение: Опубликованная схема' }).click();
  const orderedReference = learnerA.page.getByTestId('task-image-reference-window');
  await expect(orderedReference.getByRole('img', { name: 'Опубликованная схема' })).toHaveAttribute(
    'src',
    orderedSource!,
  );
  await briefAnchor.click();
  await expect(brief).toHaveCount(0);
  await expect(orderedReference).toBeVisible();
  await learnerA.page.screenshot({ path: `${evidenceDir}/a6-lab-pinned-desktop.png` });
  for (const width of [390, 320]) {
    await learnerA.page.setViewportSize({ width, height: 844 });
    await expect(orderedReference).toBeVisible();
    const bounds = await orderedReference.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const mobileTitle = orderedReference.locator('#task-image-reference-title');
    await expect(mobileTitle).toHaveText('Материал');
    expect(await mobileTitle.evaluate((title) => title.scrollWidth <= title.clientWidth)).toBe(
      true,
    );
    await learnerA.page.screenshot({ path: `${evidenceDir}/a6-lab-pinned-${width}.png` });
  }
  await orderedReference.getByRole('button', { name: 'Закрыть окно: Материал' }).click();

  await openExistingAssignmentEditor(page, title);
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  const replaceInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await replaceInput.setInputFiles({
    name: 'learner-exact-b.png',
    mimeType: 'image/png',
    buffer: imageB,
  });
  const saveImageB = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-sample$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const savedImageB = await saveImageB;
  expect(savedImageB.ok()).toBe(true);
  const publishV2 = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const v2Response = await publishV2;
  expect(v2Response.ok()).toBe(true);
  const v2 = (await v2Response.json()) as { id: string; versionNumber: number };
  expect(v2.versionNumber).toBe(2);
  expect(v2.id).not.toBe(v1.id);

  await learnerA.page.goto('/#/');
  await openPortalSection(learnerA.page, 'Моё обучение');
  await learnerA.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  rowA = learnerA.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
  const v1StillA = rowA.getByRole('img', { name: `Образец: ${title}` });
  await expect(v1StillA).toBeVisible();
  const v1StillASource = await v1StillA.getAttribute('src');
  expect(v1StillASource).toContain(`/api/assignments/activity-versions/${v1.id}/sample`);
  const v1StillABytes = await learnerA.page.request.get(
    new URL(v1StillASource!, learnerA.page.url()).toString(),
  );
  expect(v1StillABytes.ok()).toBe(true);
  expect(Buffer.compare(await v1StillABytes.body(), imageA)).toBe(0);

  const joinCodeV2 = await createClassWithStudents(
    page,
    `UX1A3 V2 ${token}`,
    [{ label: `Learner B ${token}`, handle: `ux1a3-b-${token}` }],
    true,
  );
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-10-07' });
  const learnerB = await learnerAssignments(browser, joinCodeV2, `ux1a3-b-${token}`);
  const learnerBFailures = collectBrowserFailures(learnerB.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  const rowB = learnerB.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  const cardImageB = rowB.getByRole('img', { name: `Образец: ${title}` });
  await expect(cardImageB).toBeVisible();
  const cardSourceB = await cardImageB.getAttribute('src');
  expect(cardSourceB).toContain(`/api/assignments/activity-versions/${v2.id}/sample`);
  const cardBytesB = await learnerB.page.request.get(
    new URL(cardSourceB!, learnerB.page.url()).toString(),
  );
  expect(cardBytesB.ok()).toBe(true);
  expect(Buffer.compare(await cardBytesB.body(), imageB)).toBe(0);

  failures.assertEmpty();
  learnerAFailures.assertEmpty();
  learnerBFailures.assertEmpty();
  await learnerA.context.close();
  await learnerB.context.close();
});

test('A6 PDF material stays readable through exact direct assignment versions', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const token = ++sequence;
  const title = `Exact PDF material ${token}`;
  const pdfA = Buffer.from('%PDF-1.4\nA6 learner file A\n%%EOF');
  const pdfB = Buffer.from('%PDF-1.4\nA6 learner file B\n%%EOF');

  await loginWithOrganization(page, teacher);
  await openNewAssignmentEditor(page);
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Скачайте точный PDF задания.');
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  const fileUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-task-file$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('PDF файл задания').setInputFiles({
    name: 'guide-a.pdf',
    mimeType: 'application/pdf',
    buffer: pdfA,
  });
  const uploadedA = await fileUpload;
  expect(uploadedA.ok()).toBe(true);
  const hashA = ((await uploadedA.json()) as { contentHash: string }).contentHash;
  await expect(page.getByText('PDF добавлен в содержание задания.')).toBeVisible();
  await previewAssignmentAs(page, 'draft');
  const draftPreview = page
    .getByRole('dialog', { name: 'Как увидит ученик' })
    .getByTestId('learner-preview');
  await expect(draftPreview.getByText('guide-a.pdf')).toBeVisible();
  const draftDownload = page.waitForEvent('download');
  await draftPreview.getByRole('button', { name: 'Скачать PDF: guide-a.pdf' }).click();
  expect((await draftDownload).suggestedFilename()).toBe('guide-a.pdf');
  await closeAssignmentPreview(page);

  const publishV1 = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const publishedA = await publishV1;
  expect(publishedA.ok()).toBe(true);
  const v1 = (await publishedA.json()) as { id: string; versionNumber: number };
  expect(v1.versionNumber).toBe(1);
  await previewAssignmentAs(page, 'published');
  await expect(draftPreview.getByText('guide-a.pdf')).toBeVisible();
  await expect(draftPreview.getByText('Опубликованная версия 1', { exact: false })).toBeVisible();
  await draftPreview
    .getByRole('button', { name: 'Скачать PDF: guide-a.pdf' })
    .scrollIntoViewIfNeeded();
  await draftPreview.screenshot({ path: `${evidenceDir}/a6-file-author-published-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    draftPreview.getByRole('button', { name: 'Скачать PDF: guide-a.pdf' }),
  ).toBeVisible();
  await draftPreview
    .getByRole('button', { name: 'Скачать PDF: guide-a.pdf' })
    .scrollIntoViewIfNeeded();
  await draftPreview.screenshot({ path: `${evidenceDir}/a6-file-author-published-390.png` });
  await page.setViewportSize({ width: 1280, height: 720 });
  await closeAssignmentPreview(page);

  const joinCodeV1 = await createClassWithStudents(
    page,
    `A6 file V1 ${token}`,
    [{ label: `PDF Learner A ${token}`, handle: `a6-file-a-${token}` }],
    true,
  );
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-09-30' });
  const learnerA = await learnerAssignments(browser, joinCodeV1, `a6-file-a-${token}`);
  const learnerAFailures = collectBrowserFailures(learnerA.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  const rowA = learnerA.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  await rowA.getByRole('button', { name: title, exact: true }).click();
  const downloadButton = rowA.getByRole('button', { name: 'Скачать PDF: guide-a.pdf' });
  await expect(downloadButton).toBeVisible();
  const learnerBytesA = await learnerA.page.request.get(
    new URL(`/api/assignments/task-files/${hashA}`, learnerA.page.url()).toString(),
  );
  expect(learnerBytesA.ok()).toBe(true);
  expect(learnerBytesA.headers()['content-disposition']).toContain('attachment');
  expect(Buffer.compare(await learnerBytesA.body(), pdfA)).toBe(0);
  const learnerDownload = learnerA.page.waitForEvent('download');
  await downloadButton.click();
  expect((await learnerDownload).suggestedFilename()).toBe('guide-a.pdf');
  await learnerA.page.screenshot({ path: `${evidenceDir}/a6-file-learner-desktop.png` });
  for (const width of [390, 320]) {
    await learnerA.page.setViewportSize({ width, height: 844 });
    await expect(downloadButton).toBeVisible();
    const bounds = await downloadButton.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await learnerA.page.screenshot({ path: `${evidenceDir}/a6-file-learner-${width}.png` });
  }

  await openExistingAssignmentEditor(page, title);
  const replacement = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-task-file$/.test(new URL(response.url()).pathname),
  );
  await page.getByLabel('Заменить PDF блока 1').setInputFiles({
    name: 'guide-b.pdf',
    mimeType: 'application/pdf',
    buffer: pdfB,
  });
  const uploadedB = await replacement;
  expect(uploadedB.ok()).toBe(true);
  const hashB = ((await uploadedB.json()) as { contentHash: string }).contentHash;
  const publishV2 = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const publishedB = await publishV2;
  expect(publishedB.ok()).toBe(true);
  const v2 = (await publishedB.json()) as { id: string; versionNumber: number };
  expect(v2.versionNumber).toBe(2);
  expect(v2.id).not.toBe(v1.id);

  const stillA = await learnerA.page.request.get(
    new URL(`/api/assignments/task-files/${hashA}`, learnerA.page.url()).toString(),
  );
  expect(stillA.ok()).toBe(true);
  expect(Buffer.compare(await stillA.body(), pdfA)).toBe(0);
  const deniedB = await learnerA.page.request.get(
    new URL(`/api/assignments/task-files/${hashB}`, learnerA.page.url()).toString(),
  );
  expect(deniedB.status()).toBe(404);
  learnerAFailures.assertEmpty();
  const expectedUnavailableConsole: { text: string; url: string }[] = [];
  learnerA.page.on('console', (message) => {
    if (message.type() === 'error') {
      expectedUnavailableConsole.push({ text: message.text(), url: message.location().url });
    }
  });
  await learnerA.page.route('**/api/assignments/task-files/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await downloadButton.click();
  const unavailableAlert = rowA.getByRole('alert');
  await expect(unavailableAlert).toContainText('Файл задания недоступен');
  await unavailableAlert.scrollIntoViewIfNeeded();
  await expect(unavailableAlert).toBeInViewport();
  await rowA.screenshot({ path: `${evidenceDir}/a6-file-unavailable-320.png` });
  await learnerA.page.unroute('**/api/assignments/task-files/**');
  expect(expectedUnavailableConsole).toEqual([
    {
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      url: new URL(`/api/assignments/task-files/${hashA}`, learnerA.page.url()).href,
    },
  ]);
  expect(learnerAFailures.counts).toMatchObject({
    consoleErrors: 1,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });

  const joinCodeV2 = await createClassWithStudents(
    page,
    `A6 file V2 ${token}`,
    [{ label: `PDF Learner B ${token}`, handle: `a6-file-b-${token}` }],
    true,
  );
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-10-07' });
  const learnerB = await learnerAssignments(browser, joinCodeV2, `a6-file-b-${token}`);
  const rowB = learnerB.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  await rowB.getByRole('button', { name: title, exact: true }).click();
  await expect(rowB.getByRole('button', { name: 'Скачать PDF: guide-b.pdf' })).toBeVisible();
  const learnerBytesB = await learnerB.page.request.get(
    new URL(`/api/assignments/task-files/${hashB}`, learnerB.page.url()).toString(),
  );
  expect(Buffer.compare(await learnerBytesB.body(), pdfB)).toBe(0);
  const deniedA = await learnerB.page.request.get(
    new URL(`/api/assignments/task-files/${hashA}`, learnerB.page.url()).toString(),
  );
  expect(deniedA.status()).toBe(404);
  failures.assertEmpty();
  expect(expectedUnavailableConsole).toHaveLength(1);
  expect(learnerAFailures.counts).toMatchObject({
    consoleErrors: 1,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  await learnerA.context.close();
  await learnerB.context.close();
});

test('A8.1 teacher reviews each exact mixed-lesson practice with history, navigation and revoked late responses', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const activity = await createPublishedProjectActivity(
    `A8.1 одинаковая практика ${++sequence} — ${'ДлинноеНазваниеДляПроверкиПереноса'.repeat(4)}`,
    undefined,
    { ...policies, attemptPolicy: { maxAttempts: 2 } },
  );
  const identity = (
    await admin.query('SELECT account_id FROM principals WHERE id=$1', [activity.principalId])
  ).rows[0];
  const courseTitle = `A8.1 смешанный курс ${sequence}`;
  const courseId = (
    await admin.query("SELECT course_save($1,NULL,$2,NULL,NULL,'private') AS id", [
      activity.principalId,
      courseTitle,
    ])
  ).rows[0].id as string;
  const sectionId = (
    await admin.query('SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1', [
      courseId,
      activity.principalId,
      identity.account_id,
      teacher.tenantId,
    ])
  ).rows[0].section_id as string;
  await admin.query(
    "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Теория и две практики',NULL,$4::jsonb,'material',NULL,20,NULL)",
    [
      activity.principalId,
      courseId,
      sectionId,
      JSON.stringify([
        {
          id: 'theory',
          type: 'paragraph',
          text: 'Обе практики используют одну версию задания, но имеют отдельные работы.',
        },
        { id: 'practice-a', type: 'activity', learningActivityVersionId: activity.versionId },
        { id: 'practice-b', type: 'activity', learningActivityVersionId: activity.versionId },
      ]),
    ],
  );
  const revision = (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId]))
    .rows[0].draft_revision;
  expect(
    (
      await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        activity.principalId,
        courseId,
        revision,
        `a81:e2e:publish:${sequence}`,
      ])
    ).rows[0].result_code,
  ).toBe('ok');
  const code = await createClassWithStudents(page, `A8.1 класс ${sequence}`, [
    { label: 'Анна A8', handle: 'a81-anna' },
    { label: 'Борис A8', handle: 'a81-boris' },
    { label: 'Вера A8', handle: 'a81-vera' },
  ]);
  const classroomId = page.url().split('/classrooms/')[1]!.split('?')[0]!;
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс', { exact: true }).selectOption(courseId);
  await page.getByLabel('Выбранные ученики', { exact: true }).check();
  await page.getByLabel('Анна A8', { exact: true }).check();
  await page.getByLabel('Борис A8', { exact: true }).check();
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  const course = page.getByTestId('classroom-course-run');
  const cardA = course.locator('[data-practice-block="practice-a"]');
  const cardB = course.locator('[data-practice-block="practice-b"]');
  await expect(course.getByTestId('course-practice')).toHaveCount(2);
  await expect(cardA).toContainText('Назначено: 2 · Не назначено: 1');
  await expect(cardB).toContainText('Назначено: 2 · Не назначено: 1');
  const runtimeA = (await cardA.getAttribute('data-activity-run'))!;
  const runtimeB = (await cardB.getAttribute('data-activity-run'))!;
  expect(runtimeA).not.toBe(runtimeB);
  const runId = (
    await admin.query('SELECT source_course_run_id FROM activity_runs WHERE id=$1', [runtimeA])
  ).rows[0].source_course_run_id as string;
  const anna = await learnerAssignments(browser, code, 'a81-anna');
  const boris = await learnerAssignments(browser, code, 'a81-boris');
  const learnerFailures = [anna, boris].map((learner) =>
    collectBrowserFailures(learner.page, {
      allowAnonymousSessionProbe: true,
      allowAdminAccessProbe: true,
    }),
  );
  // This teacher-focused scenario uses real authorized learner start/submit APIs to
  // prepare exact immutable evidence; the full laboratory editing journey is tested separately.
  async function submit(learner: Page, runtime: string) {
    const headers = { origin: new URL(learner.url()).origin };
    const started = await learner.request.post(`/api/learning/work/runs/${runtime}/start`, {
      headers,
      data: { requestId: `a81:e2e:start:${++sequence}` },
    });
    expect(started.ok()).toBe(true);
    const work = (await started.json()) as {
      projectId: string;
      attemptId: string;
      attemptNumber: number;
    };
    const saved = await admin.query(
      'UPDATE project_drafts SET revision=revision+1 WHERE project_id=$1 RETURNING revision',
      [work.projectId],
    );
    expect(saved.rows).toHaveLength(1);
    const response = await learner.request.post(`/api/learning/projects/${work.projectId}/submit`, {
      headers,
      data: {
        clientRequestId: `a81:e2e:submit:${++sequence}`,
        expectedRevision: saved.rows[0].revision,
      },
    });
    expect(response.ok()).toBe(true);
    const evidence = (await response.json()) as {
      projectVersionId: string;
      attemptId: string;
      submissionId: string;
    };
    return { ...work, ...evidence };
  }
  const first = await submit(anna.page, runtimeA);
  const peer = await submit(boris.page, runtimeA);
  const sibling = await submit(anna.page, runtimeB);
  expect(new Set([first.projectId, peer.projectId, sibling.projectId]).size).toBe(3);
  await cardA.getByRole('button', { name: 'Проверить работы', exact: true }).click();
  const queue = page.getByTestId('course-practice-queue');
  const detail = page.getByRole('region', { name: 'Проверка сдачи', exact: true });
  await expect(queue).toHaveAttribute('data-activity-run', runtimeA);
  await expect(queue.getByRole('button', { name: /Вера A8/ })).toBeDisabled();
  await queue.getByLabel('Состояние работы', { exact: true }).selectOption('submitted');
  await queue.getByRole('button', { name: /Анна A8/ }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(first.projectVersionId);
  await queue.getByRole('button', { name: 'Следующий ученик', exact: true }).click();
  await expect(detail).toContainText('Борис A8');
  await expect(detail.getByTestId('submission-version-id')).toHaveText(peer.projectVersionId);
  await queue.getByRole('button', { name: 'Предыдущий ученик', exact: true }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(first.projectVersionId);
  await detail.getByLabel('Отзыв', { exact: true }).fill('Уточните схему первой практики.');
  await detail.getByLabel('Причина возврата или исправления').fill('Проверьте соединение.');
  await detail.getByRole('button', { name: 'Вернуть на доработку', exact: true }).click();
  await expect(detail).toContainText('Ревизия 1 · На доработке');
  const corrected = await submit(anna.page, runtimeA);
  expect(corrected.attemptNumber).toBe(2);
  expect(corrected.projectId).toBe(first.projectId);
  expect(corrected.projectVersionId).not.toBe(first.projectVersionId);
  await queue.getByRole('button', { name: 'Обновить очередь', exact: true }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(corrected.projectVersionId);
  await detail.getByLabel('Попытка', { exact: true }).selectOption(first.attemptId);
  await expect(detail.getByTestId('submission-version-id')).toHaveText(first.projectVersionId);
  await expect(detail).toContainText('Уточните схему первой практики.');
  await detail.getByLabel('Попытка', { exact: true }).selectOption(corrected.attemptId);
  await detail.getByLabel('Отзыв', { exact: true }).fill('Первая практика принята.');
  await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
  await expect(detail).toContainText('Ревизия 1 · Принято');
  await expect(queue.getByRole('button', { name: 'Следующий ученик', exact: true })).toBeEnabled();
  await queue.getByLabel('Состояние работы', { exact: true }).selectOption('completed');
  await expect(queue.locator('.course-practice-student')).toHaveCount(1);
  await queue.getByLabel('Поиск ученика', { exact: true }).fill('Анна');
  await queue.getByRole('button', { name: /Анна A8/ }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(corrected.projectVersionId);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(detail.getByTestId('submission-version-id')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `${evidenceDir}/a81-exact-practice-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await queue.getByRole('link', { name: 'Открыть результат в журнале', exact: true }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(corrected.projectVersionId);
  await expect(detail).toContainText('Первая практика принята.');
  await page.goto(`/#/classrooms/${classroomId}?courseRun=${runId}`);
  await cardB.getByRole('button', { name: 'Проверить работы', exact: true }).click();
  await queue.getByRole('button', { name: /Анна A8/ }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(sibling.projectVersionId);
  await expect(detail).not.toContainText('Первая практика принята.');
  await queue.getByRole('button', { name: '← К урокам курса', exact: true }).click();
  const legacyOrigin = (
    await admin.query(
      'SELECT source_classroom_assignment_id,source_course_lesson_id FROM activity_runs WHERE id=$1',
      [runtimeB],
    )
  ).rows[0];
  const legacySibling = await admin.query(
    `SELECT * FROM activity_run_create($1,$2,$3,'course',$4,$5,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$6,'legacy-unknown-block')`,
    [
      activity.principalId,
      legacyOrigin.source_classroom_assignment_id,
      activity.versionId,
      runId,
      legacyOrigin.source_course_lesson_id,
      `a81:e2e:legacy:${++sequence}`,
    ],
  );
  expect(legacySibling.rows[0].result_code).toBe('ok');
  await page.reload();
  await expect(cardB).toContainText('Историческое назначение связано с несколькими практиками.');
  await expect(cardB.getByRole('button', { name: 'Проверить работы', exact: true })).toBeDisabled();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: `${evidenceDir}/a81-legacy-unavailable-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // A separate empty class checks a genuine zero-person queue and an explicit
  // read failure without changing the positive journey's browser error policy.
  const statePage = await page.context().newPage();
  const unexpectedStateErrors: string[] = [];
  let allowedFailurePath = '';
  statePage.on('pageerror', (error) => unexpectedStateErrors.push(error.message));
  statePage.on('console', (message) => {
    if (message.type() !== 'error') return;
    const path = message.location().url ? new URL(message.location().url).pathname : '';
    if (path === allowedFailurePath && message.text().includes('503')) return;
    if (path === '/api/admin/v1/me' && message.text().includes('403')) return;
    unexpectedStateErrors.push(message.text());
  });
  await statePage.goto('/#/');
  await createClassWithStudents(statePage, `A8.1 пустой класс ${sequence}`, [], true);
  const emptyClassId = statePage.url().split('/classrooms/')[1]!.split('?')[0]!;
  await statePage
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await statePage.getByLabel('Опубликованный курс', { exact: true }).selectOption(courseId);
  await statePage.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  await statePage
    .getByTestId('classroom-course-run')
    .locator('[data-practice-block="practice-a"]')
    .getByRole('button', { name: 'Проверить работы', exact: true })
    .click();
  const emptyQueue = statePage.getByTestId('course-practice-queue');
  await expect(emptyQueue.getByText('В классе пока нет учеников.', { exact: true })).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await statePage.setViewportSize(viewport);
    expect(
      await statePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await statePage.screenshot({
      path: `${evidenceDir}/a81-empty-queue-${viewport.width}.png`,
      fullPage: true,
    });
  }
  allowedFailurePath = `/api/classrooms/${emptyClassId}/gradebook`;
  await statePage.route(`**${allowedFailurePath}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'queue_unavailable', message: 'Очередь временно недоступна.' },
      }),
    }),
  );
  await emptyQueue.getByRole('button', { name: 'Обновить очередь', exact: true }).click();
  await expect(emptyQueue.getByRole('alert')).toHaveText('Очередь временно недоступна.');
  await expect(emptyQueue.getByText('В классе пока нет учеников.', { exact: true })).toHaveCount(0);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await statePage.setViewportSize(viewport);
    expect(
      await statePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await statePage.screenshot({
      path: `${evidenceDir}/a81-unavailable-queue-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await statePage.unroute(`**${allowedFailurePath}`);
  await emptyQueue.getByRole('button', { name: 'Обновить очередь', exact: true }).click();
  await expect(emptyQueue.getByText('В классе пока нет учеников.', { exact: true })).toBeVisible();
  expect(unexpectedStateErrors).toEqual([]);
  await statePage.close();
  await course.getByRole('button', { name: 'Закрыть курс', exact: true }).click();
  await expect(course.getByRole('button', { name: 'Открыть курс', exact: true })).toBeVisible();
  await cardA.getByRole('button', { name: 'Проверить работы', exact: true }).click();
  await queue.getByRole('button', { name: /Анна A8/ }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(corrected.projectVersionId);
  await expect(
    detail.getByRole('button', { name: 'Исправить результат', exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByRole('button', { name: 'Вернуть на доработку', exact: true }),
  ).toHaveCount(0);
  // A delayed real immutable response for Anna cannot replace Boris or revive a
  // previously authorized queue after the teacher's class membership is revoked.
  await queue.getByRole('button', { name: /Борис A8/ }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(peer.projectVersionId);
  const delayedPath = `**/api/classrooms/${classroomId}/attempts/${corrected.attemptId}/submission`;
  async function delaySubmission() {
    let release!: () => void;
    let received!: () => void;
    let delivered!: () => void;
    const pending = new Promise<void>((resolve) => {
      received = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const complete = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    await page.route(delayedPath, async (route) => {
      const response = await route.fetch();
      received();
      await hold;
      await route.fulfill({ response });
      delivered();
    });
    return { pending, release, complete };
  }
  const delayed = await delaySubmission();
  await queue.getByRole('button', { name: /Анна A8/ }).click();
  await delayed.pending;
  await queue.getByRole('button', { name: /Борис A8/ }).click();
  await expect(detail.getByTestId('submission-version-id')).toHaveText(peer.projectVersionId);
  delayed.release();
  await delayed.complete;
  await page.unroute(delayedPath);
  await expect(detail.getByTestId('submission-version-id')).toHaveText(peer.projectVersionId);
  const revoked = await delaySubmission();
  await queue.getByRole('button', { name: /Анна A8/ }).click();
  await revoked.pending;
  await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
    classroomId,
    identity.account_id,
  ]);
  await queue.getByRole('button', { name: 'Обновить очередь', exact: true }).click();
  await expect(page.getByTestId('submission-version-id')).toHaveCount(0);
  await expect(queue).toHaveCount(0);
  revoked.release();
  await revoked.complete;
  await page.unroute(delayedPath);
  await expect(page.getByTestId('submission-version-id')).toHaveCount(0);
  failures.assertEmpty();
  learnerFailures.forEach((collector) => collector.assertEmpty());
  await Promise.all([anna.context.close(), boris.context.close()]);
});
