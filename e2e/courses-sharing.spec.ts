import {
  addCourseBlock,
  selectCoursePractice,
  openNewAssignmentEditor,
  openExistingAssignmentEditor,
  openAssignmentSettings,
  closeAssignmentSettings,
} from './learning-authoring-navigation';
import { expect, test, type Page } from '@playwright/test';
import type { LearningNotification } from '../apps/web/src/api';
import { mkdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/**
 * Курсы и то, кому они видны.
 *
 * Задание — единица работы, курс — единица преподавания. Проверяется весь путь
 * до конца: автор собирает курс, открывает его названному коллеге, коллега
 * находит его в общем каталоге и забирает себе — копией, а не ссылкой. Копия и
 * есть смысл: автор правит своё, взявший своё, и опечатка, исправленная в одной
 * школе, не меняет урок в другой посреди четверти.
 */
let admin: pg.Pool;
let author: SeededTeacher;
let colleague: SeededTeacher;
const evidenceDir = 'e2e/artifacts/courses';

test.beforeAll(async () => {
  admin = e2eAdminPool();
  mkdirSync(evidenceDir, { recursive: true });
  // Две разные школы: курс, открытый коллеге, обязан перешагивать эту границу,
  // иначе «открыть всем» ничего не значит.
  author = await seedTeacher(admin, 'course-author');
  colleague = await seedTeacher(admin, 'course-mate');
});

test.afterAll(async () => {
  await admin.end();
});

/** Раздел портала слева и вкладка внутри банка называются одинаково. */
function sidebar(page: import('@playwright/test').Page, name: string) {
  return page
    .locator('.portal-sidebar')
    .getByRole('link', { name: name === 'Обучение' ? 'Моё обучение' : name, exact: true })
    .first();
}

function bankTab(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('navigation', { name: 'Разделы курсов и заданий' }).getByRole('button', {
    name: name === 'Мои курсы' ? 'Курсы' : name === 'Каталог' ? 'Библиотека' : name,
    exact: true,
  });
}

test('a teacher adds one complete published demo course', async ({ page }) => {
  const failures = collectBrowserFailures(page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await loginWithOrganization(page, author);
  await sidebar(page, 'Курсы и задания').click();
  await bankTab(page, 'Мои курсы').click();

  await page.getByRole('button', { name: 'Добавить демо-курс' }).click();
  const editor = page.getByTestId('course-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Основы 3D-моделирования: от формы к проекту');
  await expect(editor).toContainText('4 разделов · 12 уроков');
  await expect(editor).toContainText('Опубликован · v1');
  await expect(editor.getByRole('button', { name: 'Опубликовать' })).toHaveCount(0);
  await editor.screenshot({ path: `${evidenceDir}/demo-course-published-desktop.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      editor.locator('.course-builder').evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns.split(' ').length;
      }),
    )
    .toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await editor.screenshot({ path: `${evidenceDir}/demo-course-published-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 720 });

  await editor.getByRole('button', { name: 'Курсы' }).click();
  await page.getByRole('button', { name: 'Добавить демо-курс' }).click();
  await expect(editor).toBeVisible();

  const identity = await admin.query(
    `SELECT principal_id FROM legacy_user_account_links
      WHERE tenant_id = $1 AND user_id = $2`,
    [author.tenantId, author.teacherId],
  );
  const count = await admin.query(
    `SELECT count(*)::integer AS count FROM courses
      WHERE owner_principal_id = $1 AND template_key = 'three-d-foundations-v1'`,
    [identity.rows[0].principal_id],
  );
  expect(count.rows[0].count).toBe(1);
  failures.assertEmpty();
});

async function authored(page: Page, title: string, module: 'electronics' | 'three-d' | null) {
  await openNewAssignmentEditor(page);
  await openAssignmentSettings(page);
  await page
    .getByRole('dialog', { name: 'Настройки' })
    .getByLabel('Среда проекта')
    .selectOption(module ?? '');
  if (module)
    await page
      .getByRole('dialog', { name: 'Настройки' })
      .getByLabel('Результат', { exact: true })
      .selectOption('completion');
  await closeAssignmentSettings(page);
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Exact v1 instructions');
  if (!module) page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
}
async function uploadMaterial(
  page: Page,
  image: Buffer,
  pdf: Buffer,
  text: string,
  action: 'add' | 'replace' = 'add',
) {
  await expect(page.getByLabel('Содержание', { exact: true })).toBeVisible();
  const blocks = page.getByRole('group', { name: 'Блоки задания', exact: true });
  if (action === 'add')
    await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  const imageInput =
    action === 'replace'
      ? blocks.getByLabel(/^Заменить файл блока \d+$/)
      : blocks.getByLabel('Файл блока изображения', { exact: true });
  await expect(imageInput).toHaveCount(1);
  const imageUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-task-image$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await imageInput.setInputFiles({ name: 'library.png', mimeType: 'image/png', buffer: image });
  const imageReceipt = await imageUpload;
  expect(imageReceipt.ok()).toBe(true);
  const imageHash = ((await imageReceipt.json()) as { contentHash: string }).contentHash;
  await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
  if (action === 'add')
    await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  const fileInput =
    action === 'replace'
      ? blocks.getByLabel(/^Заменить PDF блока \d+$/)
      : blocks.getByLabel('PDF файл задания', { exact: true });
  await expect(fileInput).toHaveCount(1);
  const fileUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-task-file$/.test(new URL(response.url()).pathname),
  );
  await fileInput.setInputFiles({ name: 'library.pdf', mimeType: 'application/pdf', buffer: pdf });
  const fileReceipt = await fileUpload;
  expect(fileReceipt.ok()).toBe(true);
  const fileHash = ((await fileReceipt.json()) as { contentHash: string }).contentHash;
  await expect(page.getByText('PDF добавлен в содержание задания.')).toBeVisible();
  await page.getByLabel('Содержание', { exact: true }).fill(text);
  const ack = page.waitForResponse(
    (r) =>
      r.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft$/.test(new URL(r.url()).pathname),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await ack).ok()).toBe(true);
  await expect(
    page.getByText('Черновик сохранён. Публикация — отдельное действие.', { exact: true }),
  ).toBeVisible();
  return { imageHash, fileHash };
}
async function publishActivity(page: Page) {
  const ack = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(r.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const result = await ack;
  expect(result.ok()).toBe(true);
  await expect(page.getByText(/Опубликована версия \d/)).toBeVisible();
  return (await result.json()) as { id: string; activityId: string; versionNumber: number };
}
async function saveProject(page: Page, module: 'electronics' | 'three-d') {
  const anchor = page.getByTestId('assignment-brief-anchor');
  await expect(anchor).toBeVisible({ timeout: 60_000 });
  if ((await anchor.getAttribute('aria-expanded')) !== 'true') await anchor.click();
  let count: number;
  if (module === 'three-d') {
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true', {
      timeout: 60_000,
    });
    count = Number.parseInt(await page.locator('.asa3d-object-count').innerText(), 10) + 1;
    await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    await expect(page.locator('.asa3d-object-count')).toContainText(new RegExp(`^${count} `));
    await expect(page.locator('.asa3d-save-state')).toHaveClass(/save-saved/);
  } else {
    const resistor = page.getByRole('button', { name: 'Резистор', exact: true });
    await expect(resistor).toBeVisible({ timeout: 60_000 });
    count = (await page.getByTestId('schematic-component').count()) + 1;
    const ack = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        /\/api\/projects\/[^/]+\/draft$/.test(new URL(r.url()).pathname) &&
        (r.request().postDataJSON() as { document: { components: unknown[] } }).document.components
          .length === count,
    );
    const card = (await resistor.boundingBox())!,
      canvas = (await page.locator('.workbench-canvas').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(page.getByTestId('schematic-component')).toHaveCount(count);
    await page
      .locator('.workbench-toolbar')
      .getByRole('button', { name: 'Сохранить проект', exact: true })
      .click();
    expect((await ack).ok()).toBe(true);
    await expect(page.locator('.workbench-main')).toHaveAttribute(
      'data-project-save-status',
      'saved',
    );
  }
  const context = await page.request.get(
    '/api/learning/projects/' + projectId(page, module) + '/context',
  );
  expect(context.ok()).toBe(true);
  expect((await context.json()).origin.immutable).toBe(true);
  await page.reload();
  if (module === 'three-d')
    await expect(page.locator('.asa3d-object-count')).toContainText(new RegExp(`^${count} `));
  else await expect(page.getByTestId('schematic-component')).toHaveCount(count);
  return count;
}
function projectId(page: Page, module: 'electronics' | 'three-d') {
  const url = new URL(page.url());
  return module === 'electronics'
    ? url.pathname.split('/projects/')[1]!.split('/')[0]!
    : url.hash.split('/3d/')[1]!.split('?')[0]!;
}

test('named Library exact mixed v1 copy survives source v2 and lost response then delivers owned media and real work', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36),
    title = 'Library ' + suffix;
  const electronicsTitle = 'Electronics ' + suffix,
    threeTitle = '3D ' + suffix,
    manualTitle = 'Material ' + suffix;
  const image = readFileSync('apps/web/public/landing/electronics-simulation.png');
  const imageV2 = readFileSync('apps/web/public/landing/assignment-progress.png');
  const pdf = Buffer.from('%PDF-1.4\nLibrary v1\n%%EOF'),
    pdfV2 = Buffer.from('%PDF-1.4\nLibrary changed v2\n%%EOF');
  // AuthoredMaterialsPage checkDraftImage/checkTaskPdf and API decoders share
  // the 400000-byte limit. Reject incompatible fixtures before opening the UI.
  for (const bytes of [image, imageV2]) {
    expect(bytes.byteLength).toBeGreaterThanOrEqual(8);
    expect(bytes.byteLength).toBeLessThanOrEqual(400_000);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  for (const bytes of [pdf, pdfV2]) {
    expect(bytes.byteLength).toBeGreaterThanOrEqual(5);
    expect(bytes.byteLength).toBeLessThanOrEqual(400_000);
    expect(bytes.toString('ascii', 0, 5)).toBe('%PDF-');
  }
  expect(imageV2.equals(image)).toBe(false);
  expect(pdfV2.equals(pdf)).toBe(false);
  const authorContext = await browser.newContext(),
    authorPage = await authorContext.newPage();
  const mateContext = await browser.newContext(),
    matePage = await mateContext.newPage();
  const pageErrors: string[] = [];
  matePage.on('pageerror', (problem) => pageErrors.push(problem.message));
  const authorFailures = collectBrowserFailures(authorPage, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await loginWithOrganization(authorPage, author);
  await loginWithOrganization(matePage, colleague);
  await authored(authorPage, electronicsTitle, 'electronics');
  const electronics = await publishActivity(authorPage);
  await authored(authorPage, threeTitle, 'three-d');
  const three = await publishActivity(authorPage);
  await authored(authorPage, manualTitle, null);
  const mediaV1 = await uploadMaterial(authorPage, image, pdf, 'Library material v1');
  await authorPage.reload();
  await openExistingAssignmentEditor(authorPage, manualTitle);
  await expect(authorPage.getByLabel('Содержание', { exact: true })).toHaveValue(
    'Library material v1',
  );
  const manual = await publishActivity(authorPage);
  await bankTab(authorPage, 'Мои курсы').click();
  await authorPage.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = authorPage.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(title);
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const editor = authorPage.getByTestId('course-editor');
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Mixed v1');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Before v1');
  await addCourseBlock(authorPage, 'Материал из библиотеки');
  await editor.getByRole('button', { name: 'Выбрать материал', exact: true }).click();
  await editor
    .getByRole('button', { name: `Добавить материал «${manualTitle}»`, exact: true })
    .click();
  await addCourseBlock(authorPage, 'Практика');
  await selectCoursePractice(authorPage, electronicsTitle);
  await addCourseBlock(authorPage, 'Практика');
  await selectCoursePractice(authorPage, threeTitle, 1);
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(authorPage.getByText('Урок добавлен.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(authorPage.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  const source = (
    await admin.query('SELECT id FROM courses WHERE title=$1 AND tenant_id=$2', [
      title,
      author.tenantId,
    ])
  ).rows[0].id as string;
  await sidebar(matePage, 'Курсы и задания').click();
  await bankTab(matePage, 'Каталог').click();
  await expect(matePage.getByText(title, { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Доступ', exact: true }).click();
  const share = authorPage.getByRole('dialog', { name: 'Кому видно' });
  await share.getByRole('radio', { name: /Названным преподавателям/ }).click();
  await share.getByLabel('Почта преподавателя').fill(colleague.email);
  await share.getByRole('button', { name: 'Открыть доступ' }).click();
  await expect(share.getByTestId('share-list')).toContainText(colleague.email);
  await share.getByRole('button', { name: 'Готово' }).click();
  await matePage.reload();
  await bankTab(matePage, 'Каталог').click();
  await matePage.getByRole('searchbox').fill(title);
  const card = matePage.getByTestId('catalogue-list').locator('li').filter({ hasText: title });
  for (const width of [1440, 1024, 390, 320]) {
    await matePage.setViewportSize({ width, height: 900 });
    await expect(card.getByRole('button', { name: 'Посмотреть', exact: true })).toBeVisible();
    expect(
      await matePage.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await matePage.screenshot({
      path: `${evidenceDir}/library-list-${width}.png`,
      fullPage: true,
    });
  }
  await matePage.setViewportSize({ width: 1440, height: 900 });
  await card.getByRole('button', { name: 'Посмотреть', exact: true }).click();
  let preview = matePage.getByRole('dialog', { name: title });
  await expect(preview.getByText('Опубликованная версия 1', { exact: true })).toBeVisible();
  await preview.getByText('Mixed v1', { exact: true }).click();
  await expect(preview).toContainText('Library material v1');
  await expect(preview).toContainText(electronicsTitle);
  await expect(preview).toContainText(threeTitle);
  const frozenResponse = await matePage.request.get(`/api/catalogue/courses/${source}`);
  expect(frozenResponse.ok()).toBe(true);
  const frozen = (await frozenResponse.json()) as {
    versionId: string;
    versionNumber: number;
    contentHash: string;
    pinnedItems: Record<string, { blocks: Array<{ type: string; src?: string }> }>;
  };
  expect(JSON.stringify(frozen)).not.toMatch(
    /policy_snapshot|starterProject|draft_payload|projectDocument/,
  );
  const sourceMedia = frozen.pinnedItems[manual.id]!.blocks;
  for (const [type, bytes] of [
    ['image', image],
    ['file', pdf],
  ] as const) {
    const src = sourceMedia.find((b) => b.type === type)!.src!;
    const response = await matePage.request.get(src);
    expect(response.ok()).toBe(true);
    expect(await response.body()).toEqual(bytes);
  }
  for (const width of [1440, 1024, 390, 320]) {
    await matePage.setViewportSize({ width, height: 900 });
    expect(
      await matePage.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await matePage.screenshot({
      path: `${evidenceDir}/library-preview-${width}.png`,
      fullPage: true,
    });
  }
  await matePage.setViewportSize({ width: 1440, height: 900 });
  // Author publishes different media, then course v2 while colleague's v1 dialog stays open.
  await openExistingAssignmentEditor(authorPage, manualTitle);
  const mediaV2 = await uploadMaterial(
    authorPage,
    imageV2,
    pdfV2,
    'Library material v2',
    'replace',
  );
  expect(mediaV2.imageHash).not.toBe(mediaV1.imageHash);
  expect(mediaV2.fileHash).not.toBe(mediaV1.fileHash);
  expect((await publishActivity(authorPage)).versionNumber).toBe(2);
  await bankTab(authorPage, 'Мои курсы').click();
  await authorPage
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: title })
    .click();
  await editor.getByLabel('Название урока').fill('Source v2');
  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  await expect(authorPage.getByText('Урок сохранён.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Опубликовать v2', exact: true }).click();
  await expect(authorPage.getByText('Курс опубликован: версия 2.', { exact: true })).toBeVisible();
  expect(
    (await (await matePage.request.get(`/api/catalogue/courses/${source}`)).json()).versionNumber,
  ).toBe(2);
  const copyRequests: unknown[] = [];
  let lost = false;
  await matePage.route(`**/api/catalogue/course/${source}/take`, async (route) => {
    copyRequests.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (!lost) {
      lost = true;
      await route.abort('failed');
    } else {
      expect((await response.json()).reused).toBe(true);
      await route.fulfill({ response });
    }
  });
  await preview.getByRole('button', { name: 'Забрать себе', exact: true }).click();
  await expect(matePage.getByRole('alert')).toBeVisible();
  await preview.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await bankTab(matePage, 'Мои курсы').click();
  await expect(matePage.getByTestId('catalogue-list')).toBeVisible();
  await expect(matePage.getByTestId('course-editor')).toHaveCount(0);
  await matePage.getByRole('button', { name: 'Подтвердить копирование', exact: true }).click();
  preview = matePage.getByRole('dialog', { name: title });
  await expect(preview).toContainText('Опубликованная версия 1');
  await preview.getByRole('button', { name: 'Забрать себе', exact: true }).click();
  const ownEditor = matePage.getByTestId('course-editor');
  await expect(ownEditor).toBeVisible();
  expect(copyRequests).toHaveLength(2);
  expect(copyRequests[1]).toEqual(copyRequests[0]);
  expect(copyRequests[0]).toMatchObject({
    versionId: frozen.versionId,
    contentHash: frozen.contentHash,
    requestId: expect.any(String),
  });
  await expect(ownEditor.getByLabel('Название урока')).toHaveValue('Mixed v1');
  await expect(ownEditor.getByTestId('course-pinned-material')).toContainText(
    'Library material v1',
  );
  for (const width of [1440, 1024, 390, 320]) {
    await matePage.setViewportSize({ width, height: 900 });
    await expect(ownEditor.getByLabel('Название урока')).toBeVisible();
    await expect(ownEditor.getByTestId('course-pinned-material')).toBeVisible();
    expect(
      await matePage.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await matePage.screenshot({
      path: `${evidenceDir}/library-owned-course-editor-${width}.png`,
      fullPage: true,
    });
  }
  await matePage.setViewportSize({ width: 1440, height: 900 });
  const identity = (
    await admin.query(
      'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [colleague.tenantId, colleague.teacherId],
    )
  ).rows[0];
  const copies = (
    await admin.query(
      'SELECT id FROM courses WHERE copied_from_course_id=$1 AND owner_principal_id=$2',
      [source, identity.principal_id],
    )
  ).rows;
  expect(copies).toHaveLength(1);
  const ownCourse = copies[0].id as string;
  const ownBlocks = (
    await admin.query('SELECT blocks FROM course_lessons WHERE course_id=$1', [ownCourse])
  ).rows[0].blocks as Array<{ id: string; type: string; learningActivityVersionId?: string }>;
  expect(ownBlocks.map((b) => b.type)).toEqual([
    'paragraph',
    'manual-material',
    'activity',
    'activity',
  ]);
  const ownPins = ownBlocks.slice(1).map((b) => b.learningActivityVersionId!);
  expect(ownPins).not.toEqual([manual.id, electronics.id, three.id]);
  const ownerRows = (
    await admin.query(
      'SELECT a.owner_principal_id,v.tenant_id FROM learning_activity_versions v JOIN learning_activities a ON a.id=v.activity_id WHERE v.id=ANY($1::uuid[])',
      [ownPins],
    )
  ).rows;
  expect(ownerRows).toHaveLength(3);
  expect(
    ownerRows.every(
      (r) => r.owner_principal_id === identity.principal_id && r.tenant_id === colleague.tenantId,
    ),
  ).toBe(true);
  const ownMaterial = (
    await admin.query('SELECT activity_id FROM learning_activity_versions WHERE id=$1', [
      ownPins[0],
    ])
  ).rows[0].activity_id;
  const ownPreview = await matePage.request.get(
    `/api/learning/activities/${ownMaterial}/preview?source=published&versionId=${ownPins[0]}`,
  );
  expect(ownPreview.ok()).toBe(true);
  const ownMedia = (await ownPreview.json()).assignment.blocks as Array<{
    type: string;
    src?: string;
  }>;
  for (const [type, bytes] of [
    ['image', image],
    ['file', pdf],
  ] as const) {
    const response = await matePage.request.get(ownMedia.find((b) => b.type === type)!.src!);
    expect(response.ok()).toBe(true);
    expect(await response.body()).toEqual(bytes);
  }
  expect(
    (
      await matePage.request.get(
        `/api/learning/activities/${manual.activityId}/preview?source=published&versionId=${manual.id}`,
      )
    ).status(),
  ).toBe(404);
  const authorIdentity = (
    await admin.query(
      'SELECT account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [author.tenantId, author.teacherId],
    )
  ).rows[0];
  const authorPersonal = (
    await admin.query(
      "INSERT INTO tenants(workspace_slug,title) VALUES($1,'Private Library author') RETURNING id",
      ['lib-author-personal-' + suffix],
    )
  ).rows[0].id;
  await admin.query("INSERT INTO tenant_placements(tenant_id,mode) VALUES($1,'SHARED_CLUSTER')", [
    authorPersonal,
  ]);
  const authorWorkspace = (
    await admin.query(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'personal','Private Library author') RETURNING id",
      [authorPersonal],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'owner')",
    [authorIdentity.account_id, authorWorkspace],
  );
  expect(
    (
      await authorPage.request.post('/api/session/context', {
        headers: { origin: new URL(authorPage.url()).origin },
        data: { workspaceId: authorWorkspace },
      })
    ).ok(),
  ).toBe(true);
  const authorProjects = await authorPage.request.post('/api/projects', {
    headers: {
      origin: new URL(authorPage.url()).origin,
      'idempotency-key': 'private-library-' + suffix,
    },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'Private source ' + suffix,
    },
  });
  expect(authorProjects.ok()).toBe(true);
  const privateProject = (await authorProjects.json()).project.id as string;
  expect((await authorPage.request.get(`/api/projects/${privateProject}`)).ok()).toBe(true);
  expect((await matePage.request.get(`/api/projects/${privateProject}`)).status()).toBe(404);
  await ownEditor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(matePage.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  // Recipient's own class and both login paths receive this copied version.
  await sidebar(matePage, 'Классы').click();
  await matePage
    .getByRole('button', { name: /^Создать(?: новый)? класс$/ })
    .first()
    .click();
  const create = matePage.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill('Library class ' + suffix);
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await matePage
    .getByTestId('classroom-card')
    .filter({ hasText: 'Library class ' + suffix })
    .locator('.classroom-row-title')
    .click();
  const classUrl = matePage.url(),
    joinCode = (await matePage.locator('.classroom-code-chip').innerText()).trim();
  await matePage.getByRole('button', { name: 'Добавить ученика', exact: true }).click();
  const seatForm = matePage.getByRole('dialog');
  await seatForm.getByLabel('Имя в списке класса').fill('Library Seat');
  await seatForm.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(seatForm).toBeHidden();
  const seatCode = (
    await matePage
      .getByRole('row')
      .filter({ hasText: 'Library Seat' })
      .locator('.classroom-login-handle')
      .innerText()
  ).trim();
  await sidebar(matePage, 'Курсы и задания').click();
  await bankTab(matePage, 'Мои курсы').click();
  const copiedCourseCard = matePage
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: title });
  for (const width of [1440, 1024, 390, 320]) {
    await matePage.setViewportSize({ width, height: 900 });
    await expect(copiedCourseCard).toBeVisible();
    expect(
      await matePage.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await matePage.screenshot({
      path: `${evidenceDir}/library-owned-course-list-${width}.png`,
      fullPage: true,
    });
  }
  await matePage.setViewportSize({ width: 1440, height: 900 });
  await copiedCourseCard.click();
  await ownEditor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  const assign = matePage.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await assign.getByLabel('Класс для курса').selectOption({ label: 'Library class ' + suffix });
  await assign.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(assign.getByRole('status')).toContainText('Курс назначен');
  await assign.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();
  const seatContext = await browser.newContext(),
    seatPage = await seatContext.newPage();
  await seatPage.goto(`/#/join-class?code=${joinCode}`);
  await seatPage.getByLabel('Код ученика', { exact: true }).fill(seatCode);
  await seatPage.getByRole('button', { name: 'Войти', exact: true }).click();
  const account = await seedTeacher(admin, 'library-approved-' + suffix);
  const accountIdentity = (
    await admin.query(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [account.tenantId, account.teacherId],
    )
  ).rows[0];
  const personal = (
    await admin.query(
      "INSERT INTO tenants(workspace_slug,title) VALUES($1,'Library personal') RETURNING id",
      ['lib-personal-' + suffix],
    )
  ).rows[0].id;
  await admin.query("INSERT INTO tenant_placements(tenant_id,mode) VALUES($1,'SHARED_CLUSTER')", [
    personal,
  ]);
  const personalWorkspace = (
    await admin.query(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'personal','Library personal') RETURNING id",
      [personal],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'owner')",
    [accountIdentity.account_id, personalWorkspace],
  );
  const accountContext = await browser.newContext(),
    accountPage = await accountContext.newPage();
  await loginWithOrganization(accountPage, account);
  await accountPage.goto('/#/attending');
  await accountPage.getByLabel('Код класса', { exact: true }).fill(joinCode);
  await accountPage.getByRole('button', { name: 'Войти в класс', exact: true }).click();
  await expect(accountPage.getByText(/Заявка в класс.*отправлена/)).toBeVisible();
  await matePage.goto(classUrl);
  await matePage
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Учащиеся', exact: true })
    .click();
  await matePage.getByRole('button', { name: 'Обновить заявки', exact: true }).click();
  await matePage.getByRole('button', { name: 'Принять заявку', exact: true }).click();
  await expect(matePage.locator('.learning-join-requests')).toContainText('Принята');
  const learnerFailures = [
    collectBrowserFailures(seatPage, {
      allowAnonymousSessionProbe: true,
      allowAdminAccessProbe: true,
    }),
    collectBrowserFailures(accountPage, {
      allowAnonymousSessionProbe: true,
      allowAdminAccessProbe: true,
    }),
  ];
  const { id: copiedRun, classroom_id: copiedClassroom } = (
    await admin.query('SELECT id,classroom_id FROM classroom_course_runs WHERE course_id=$1', [
      ownCourse,
    ])
  ).rows[0] as { id: string; classroom_id: string };
  const copiedLesson = (
    await admin.query(
      'SELECT l.id FROM classroom_course_run_lessons l WHERE l.run_id=$1 ORDER BY l.lesson_position',
      [copiedRun],
    )
  ).rows[0].id as string;
  for (const [learner, module, practice] of [
    [seatPage, 'electronics', electronicsTitle],
    [accountPage, 'three-d', threeTitle],
  ] as const) {
    const openCourse = async () => {
      await learner.goto('/#/learning');
      // The same hash keeps the mounted player; refresh its lifecycle and server state.
      await learner.reload();
      const list = learner.getByTestId('seat-courses');
      await expect(list).toBeVisible();
      const copiedCourse = list.getByRole('button').filter({ hasText: title });
      await expect(copiedCourse).toHaveCount(1);
      await copiedCourse.click();
      const player = learner.getByTestId('seat-course-player');
      await expect(player).toBeVisible();
      return player;
    };
    let player = await openCourse();
    await expect(player.getByTestId('seat-course-manual-material')).toContainText(
      'Library material v1',
    );
    const materialResponse = await learner.request.get(
      `/api/class-join/course-runs/${copiedRun}/lessons/${copiedLesson}/materials/${ownBlocks[1]!.id}`,
    );
    expect(materialResponse.ok()).toBe(true);
    const material = (await materialResponse.json()).blocks as Array<{
      type: string;
      src?: string;
    }>;
    for (const [type, bytes] of [
      ['image', image],
      ['file', pdf],
    ] as const) {
      const response = await learner.request.get(material.find((b) => b.type === type)!.src!);
      expect(response.ok()).toBe(true);
      expect(await response.body()).toEqual(bytes);
    }
    let activity = player.locator('.lesson-activity-block').filter({ hasText: practice });
    for (const width of [1440, 1024, 390, 320]) {
      await learner.setViewportSize({ width, height: 900 });
      await expect(player.getByTestId('seat-course-manual-material')).toBeVisible();
      await expect(activity.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
      expect(
        await learner.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      await learner.screenshot({
        path: `${evidenceDir}/library-${module}-course-material-${width}.png`,
        fullPage: true,
      });
    }
    await learner.setViewportSize({ width: 1440, height: 900 });
    await activity.getByRole('button', { name: 'Начать', exact: true }).click();
    const expectedObjectCount = await saveProject(learner, module);
    const started = projectId(learner, module);
    player = await openCourse();
    activity = player.locator('.lesson-activity-block').filter({ hasText: practice });
    await activity.getByRole('button', { name: 'Открыть работу', exact: true }).click();
    expect(projectId(learner, module)).toBe(started);
    await expect(learner.getByTestId('assignment-brief-anchor')).toBeVisible({ timeout: 60_000 });
    if (module === 'three-d') {
      const viewport = learner.getByTestId('asa3d-viewport');
      const objectCount = learner.locator('.asa3d-object-count');
      await expect(viewport).toHaveAttribute('data-runtime-ready', 'true', { timeout: 60_000 });
      await expect(objectCount).toContainText(new RegExp(`^${expectedObjectCount} `));
      for (const width of [1440, 1024, 390, 320]) {
        await learner.setViewportSize({ width, height: 900 });
        await expect(viewport).toBeVisible();
        await expect(objectCount).toBeVisible();
        await expect(learner.getByTestId('assignment-brief-anchor')).toBeVisible();
        expect(
          await learner.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(0);
        await learner.screenshot({
          path: `${evidenceDir}/library-three-d-continued-editor-${width}.png`,
          fullPage: true,
        });
      }
      await learner.setViewportSize({ width: 1440, height: 900 });
    }
    player = await openCourse();
    activity = player.locator('.lesson-activity-block').filter({ hasText: practice });
    const submit = learner.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === `/api/learning/projects/${started}/submit`,
    );
    learner.once('dialog', (d) => void d.accept());
    await activity.getByRole('button', { name: 'Сдать', exact: true }).click();
    const submitResponse = await submit;
    expect(submitResponse.ok()).toBe(true);
    const submitted = (await submitResponse.json()) as {
      projectId: string;
      attemptId: string;
      submissionId: string;
      projectVersionId: string;
    };
    expect(submitted.projectId).toBe(started);
    for (const id of [submitted.attemptId, submitted.submissionId, submitted.projectVersionId]) {
      expect(typeof id).toBe('string');
      expect(id).not.toBe('');
    }
    await expect(activity).toContainText('Сдано');
    await matePage.goto(classUrl);
    await matePage.getByRole('button', { name: /^Оповещения/ }).click();
    const inbox = matePage.getByRole('dialog', { name: 'Учебные оповещения' });
    const notificationsResponse = await matePage.request.get('/api/learning/notifications');
    expect(notificationsResponse.ok()).toBe(true);
    const notifications = (await notificationsResponse.json()) as { items: LearningNotification[] };
    const submittedEvents = notifications.items.filter(
      (item) =>
        item.kind === 'NF02' &&
        item.recipientKind === 'teacher' &&
        item.attemptId === submitted.attemptId &&
        item.classroomId === copiedClassroom,
    );
    expect(submittedEvents).toHaveLength(1);
    const notification = submittedEvents[0]!;
    // Match LearningInbox's exact destination, never the optional display title.
    const eventQuery = new URLSearchParams();
    if (notification.assignmentId) eventQuery.set('assignment', notification.assignmentId);
    if (notification.seatId) eventQuery.set('learner', notification.seatId);
    eventQuery.set('attempt', submitted.attemptId);
    if (notification.courseRunId) eventQuery.set('courseRun', notification.courseRunId);
    const eventHref = `#/classrooms/${copiedClassroom}?${eventQuery.toString()}`;
    const event = inbox.locator(`li:has(a[href="${eventHref}"])`);
    await expect(event).toBeVisible({ timeout: 30_000 });
    await expect(event).toHaveCount(1);
    await expect(event).toContainText('Работа сдана');
    const eventLink = event.getByRole('link', { name: 'Открыть', exact: true });
    await expect(eventLink).toHaveCount(1);
    await expect(eventLink).toHaveAttribute('href', eventHref);
    await eventLink.click();
    const detail = matePage.getByRole('region', { name: 'Проверка сдачи' });
    await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
    const openedHash = new URL(matePage.url()).hash;
    expect(openedHash.split('?')[0]).toBe(`#/classrooms/${copiedClassroom}`);
    expect(new URLSearchParams(openedHash.split('?')[1]).get('attempt')).toBe(submitted.attemptId);
    await expect(detail.getByTestId('submission-version-id')).toHaveText(
      submitted.projectVersionId,
    );
    await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
    await expect(detail.getByText('Ревизия 1 · Принято', { exact: true })).toBeVisible();
    for (const width of [1440, 1024, 390, 320]) {
      await matePage.setViewportSize({ width, height: 900 });
      await expect(detail.getByTestId('submission-version-id')).toHaveText(
        submitted.projectVersionId,
      );
      await expect(detail.getByText('Ревизия 1 · Принято', { exact: true })).toBeVisible();
      expect(
        await matePage.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      await matePage.screenshot({
        path: `${evidenceDir}/library-${module}-accepted-page-${width}.png`,
        fullPage: true,
      });
    }
    await matePage.setViewportSize({ width: 1440, height: 900 });
    player = await openCourse();
    await expect(
      player.locator('.lesson-activity-block').filter({ hasText: practice }),
    ).toContainText('Выполнено');
    await learner.screenshot({ path: `${evidenceDir}/library-${module}-submitted.png` });
    await detail.screenshot({ path: `${evidenceDir}/library-${module}-accepted.png` });
  }
  expect(pageErrors).toEqual([]);
  authorFailures.assertEmpty();
  for (const failures of learnerFailures) failures.assertEmpty();
  await Promise.all([
    authorContext.close(),
    mateContext.close(),
    seatContext.close(),
    accountContext.close(),
  ]);
});
