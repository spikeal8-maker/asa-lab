import {
  addCourseBlock,
  selectCoursePractice,
  openCourseActions,
  openCourseBlockActions,
  openCourseLessonSettings,
  closeCourseLessonSettings,
  openCourseStructure,
} from './learning-authoring-navigation';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { openAccountSettings, openPortalSection } from './portal-navigation';
import type { CourseSection, TeacherHomeAttention } from '../apps/web/src/api';
import {
  closeAssignmentPreview,
  closeAssignmentSettings,
  openAssignmentSettings,
  openExistingAssignmentEditor,
  openNewAssignmentEditor,
  previewAssignmentAs,
} from './learning-authoring-navigation';

const evidenceDir = 'e2e/artifacts/learning/course-01';
const ux0EvidenceDir = 'e2e/artifacts/learning/work-shell-v1';

let admin: pg.Pool;
let teacher: SeededTeacher;
let sequence = 0;
const keys = new Map<string, string>();

async function republishManualWithDifferentMedia(
  page: Page,
  title: string,
  updatedText: string,
  imageBytes: Buffer,
  pdfBytes: Buffer,
): Promise<{ imageHash: string; fileHash: string }> {
  await openExistingAssignmentEditor(page, title);
  const imageUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-task-image$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByLabel('Заменить файл блока 1').setInputFiles({
    name: 'manual-v2.png',
    mimeType: 'image/png',
    buffer: imageBytes,
  });
  const imageReceipt = await imageUpload;
  expect(imageReceipt.ok()).toBe(true);
  const imageHash = ((await imageReceipt.json()) as { contentHash: string }).contentHash;
  await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
  const fileUpload = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft-task-file$/.test(new URL(response.url()).pathname),
  );
  await page.getByLabel('Заменить PDF блока 2').setInputFiles({
    name: 'manual-v2.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBytes,
  });
  const fileReceipt = await fileUpload;
  expect(fileReceipt.ok()).toBe(true);
  const fileHash = ((await fileReceipt.json()) as { contentHash: string }).contentHash;
  await expect(page.getByText('PDF добавлен в содержание задания.')).toBeVisible();
  await page.getByLabel('Содержание', { exact: true }).fill(updatedText);
  const draftSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await draftSave).ok()).toBe(true);
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page.reload();
  await openExistingAssignmentEditor(page, title);
  await expect(page.getByLabel('Содержание', { exact: true })).toHaveValue(updatedText);
  await expect(page.getByText('manual-v2.pdf')).toBeVisible();
  const publish = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const published = await publish;
  expect(published.ok()).toBe(true);
  const version = (await published.json()) as { id: string; versionNumber: number };
  expect(version.versionNumber).toBe(2);
  const activityId = /\/api\/learning\/activities\/([^/]+)\/publish$/.exec(
    new URL(published.url()).pathname,
  )?.[1];
  expect(activityId).toBeTruthy();
  const previewResponse = await page.request.get(
    `/api/learning/activities/${activityId}/preview?source=published&versionId=${version.id}`,
  );
  expect(previewResponse.ok()).toBe(true);
  const preview = (await previewResponse.json()) as {
    source: { kind: string; versionNumber: number };
    assignment: { blocks: Array<{ type: string; contentHash?: string; src?: string }> };
  };
  expect(preview.source).toMatchObject({ kind: 'published', versionNumber: 2 });
  const imageBlock = preview.assignment.blocks.find((block) => block.type === 'image');
  const fileBlock = preview.assignment.blocks.find((block) => block.type === 'file');
  expect(imageBlock?.contentHash).toBe(imageHash);
  expect(fileBlock?.contentHash).toBe(fileHash);
  for (const [block, bytes] of [
    [imageBlock, imageBytes],
    [fileBlock, pdfBytes],
  ] as const) {
    expect(block?.src).toBeTruthy();
    const source = await page.request.get(block!.src!);
    expect(source.ok()).toBe(true);
    expect(Buffer.compare(await source.body(), bytes)).toBe(0);
  }
  return { imageHash, fileHash };
}

async function switchAccountWorkspace(page: Page, workspaceId: string): Promise<void> {
  const switched = await page.request.post('/api/session/context', {
    headers: { origin: new URL(page.url()).origin },
    data: { workspaceId },
  });
  expect(switched.status()).toBe(201);
  const session = await page.request.get('/api/auth/me');
  expect(session.status()).toBe(200);
  expect((await session.json()).activeWorkspace.workspaceId).toBe(workspaceId);
  await page.goto('/#/home');
  await page.reload();
}

async function editRealProject(page: Page, module: string) {
  const assignmentAnchor = page.getByTestId('assignment-brief-anchor');
  const assignmentPanel = page.getByTestId('assignment-brief');
  await expect(assignmentAnchor).toBeVisible({ timeout: 60_000 });
  if ((await assignmentAnchor.getAttribute('aria-expanded')) !== 'true') {
    await assignmentAnchor.click();
  }
  await expect(assignmentPanel).toBeVisible();

  const continueAction = assignmentPanel.getByRole('button', {
    name: 'Продолжить',
    exact: true,
  });
  if ((await continueAction.count()) > 0) {
    await expect(continueAction).toBeEnabled();
    await continueAction.click();
    await expect(continueAction).toHaveCount(0);
  }

  let expectedObjectCount = 0;
  if (module === 'three-d') {
    const viewport = page.getByTestId('asa3d-viewport');
    const objectCount = page.locator('.asa3d-object-count');
    await expect(viewport).toBeVisible({ timeout: 60000 });
    await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
    expectedObjectCount = Number.parseInt(await objectCount.innerText(), 10) + 1;
    const saveState = page.locator('.asa3d-save-state');
    await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    await expect(objectCount).toContainText(new RegExp(`^${expectedObjectCount} `));
    await expect(saveState).toHaveClass(/save-(dirty|saving)/);
    await expect(saveState).toHaveClass(/save-saved/);
    await expect(saveState).toContainText('Все изменения сохранены');
  } else {
    const resistor = page.getByRole('button', { name: 'Резистор', exact: true });
    await expect(resistor).toBeVisible({ timeout: 60000 });
    const projectId = courseActivityProjectId(page, 'electronics');
    expectedObjectCount = (await page.getByTestId('schematic-component').count()) + 1;
    const savedCurrentChange = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.ok() &&
        new URL(response.url()).pathname === `/api/projects/${projectId}/draft` &&
        (
          response.request().postDataJSON() as {
            document: { components: unknown[] };
          }
        ).document.components.length === expectedObjectCount,
      { timeout: 30_000 },
    );
    const card = (await resistor.boundingBox())!,
      canvas = (await page.locator('.workbench-canvas').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedObjectCount);
    await page
      .locator('.workbench-toolbar')
      .getByRole('button', { name: 'Сохранить проект', exact: true })
      .click();
    const saveResponse = await savedCurrentChange;
    const savedBody = (await saveResponse.json()) as {
      draft: { document: { components: unknown[] } };
    };
    expect(savedBody.draft.document.components).toHaveLength(expectedObjectCount);
    await expect(page.locator('.workbench-main')).toHaveAttribute(
      'data-project-save-status',
      'saved',
    );
    await expect(assignmentPanel.getByText('Сохранено', { exact: true })).toBeVisible();
  }

  await page.reload();
  await expect(assignmentPanel).toBeVisible();
  if (module === 'electronics') {
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedObjectCount);
  } else {
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true');
    await expect(page.locator('.asa3d-object-count')).toContainText(
      new RegExp(`^${expectedObjectCount} `),
    );
  }
}

type CourseActivityProjectEvidence = {
  projectId: string;
  expectedObjectCount: number;
  addedComponentId?: string;
};

function courseActivityProjectId(page: Page, module: string): string {
  const location = new URL(page.url());
  const encoded =
    module === 'electronics'
      ? /^\/projects\/([^/]+)\/electronics\/edit\/?$/.exec(location.pathname)?.[1]
      : /^#\/3d\/([^?]+)/.exec(location.hash)?.[1];
  const projectId = encoded ? decodeURIComponent(encoded) : '';
  expect(projectId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return projectId;
}

async function editCourseActivityProject(
  page: Page,
  module: string,
): Promise<CourseActivityProjectEvidence> {
  let expectedObjectCount = 0;
  let projectId = '';
  let addedComponentId: string | undefined;
  if (module === 'three-d') {
    const viewport = page.getByTestId('asa3d-viewport');
    const objectCount = page.locator('.asa3d-object-count');
    await expect(viewport).toBeVisible({ timeout: 60000 });
    await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
    projectId = courseActivityProjectId(page, module);
    expectedObjectCount = Number.parseInt(await objectCount.innerText(), 10) + 1;
    const saveState = page.locator('.asa3d-save-state');
    await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    await expect(objectCount).toContainText(new RegExp(`^${expectedObjectCount} `));
    await expect(saveState).toHaveClass(/save-(dirty|saving)/);
    await expect(saveState).toHaveClass(/save-saved/);
    await expect(saveState).toContainText('Все изменения сохранены');
  } else {
    const resistor = page.getByRole('button', { name: 'Резистор', exact: true });
    await expect(resistor).toBeVisible({ timeout: 60000 });
    projectId = courseActivityProjectId(page, module);
    const components = page.getByTestId('schematic-component');
    const existingComponentIds = new Set(
      await components.evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-component-id'))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    expectedObjectCount = (await components.count()) + 1;
    const savedCurrentChange = page.waitForResponse(
      (response) => {
        if (response.request().method() !== 'PUT' || !response.ok()) return false;
        if (new URL(response.url()).pathname !== `/api/projects/${projectId}/draft`) return false;
        let requestBody: {
          document?: { components?: Array<{ id?: string; kind?: string }> };
        };
        try {
          requestBody = response.request().postDataJSON();
        } catch {
          return false;
        }
        const requestComponents = requestBody.document?.components ?? [];
        return (
          requestComponents.length === expectedObjectCount &&
          requestComponents.some(
            (component) =>
              component.kind === 'resistor' &&
              typeof component.id === 'string' &&
              !existingComponentIds.has(component.id),
          )
        );
      },
      { timeout: 30000 },
    );
    const card = (await resistor.boundingBox())!,
      canvas = (await page.locator('.workbench-canvas').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(components).toHaveCount(expectedObjectCount);

    const saveButton = page
      .locator('.workbench-toolbar')
      .getByRole('button', { name: 'Сохранить проект', exact: true });
    await expect(saveButton).toBeEnabled();
    await page.screenshot({ path: `${evidenceDir}/electronics-manual-save-desktop.png` });
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(saveButton).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/electronics-manual-save-mobile.png` });
    await saveButton.click();
    if (desktopViewport) await page.setViewportSize(desktopViewport);

    const saveResponse = await savedCurrentChange;
    const requestBody = saveResponse.request().postDataJSON() as {
      document: { components: Array<{ id: string; kind: string }> };
    };
    const addedResistors = requestBody.document.components.filter(
      (component) => component.kind === 'resistor' && !existingComponentIds.has(component.id),
    );
    expect(addedResistors).toHaveLength(1);
    addedComponentId = addedResistors[0]!.id;
    const savedBody = (await saveResponse.json()) as {
      draft: { document: { components: Array<{ id: string; kind: string }> } };
    };
    expect(savedBody.draft.document.components).toHaveLength(expectedObjectCount);
    expect(savedBody.draft.document.components).toContainEqual(
      expect.objectContaining({ id: addedComponentId, kind: 'resistor' }),
    );
    await expect(page.locator('.workbench-main')).toHaveAttribute(
      'data-project-save-status',
      'saved',
    );
  }

  await page.reload();
  if (module === 'electronics') {
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedObjectCount);
    expect(courseActivityProjectId(page, module)).toBe(projectId);
    await expect(
      page.locator(
        `[data-testid="schematic-component"][data-component-id="${addedComponentId}"][data-kind="resistor"]`,
      ),
    ).toBeVisible();
  } else {
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true');
    expect(courseActivityProjectId(page, module)).toBe(projectId);
    await expect(page.locator('.asa3d-object-count')).toContainText(
      new RegExp(`^${expectedObjectCount} `),
    );
  }
  return { projectId, expectedObjectCount, ...(addedComponentId ? { addedComponentId } : {}) };
}

test.use({ actionTimeout: 12000 });

test('author-only content keeps exact ID and versions after teaching activation; graded scale and mute are usable', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@course01.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('c' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор и преподаватель');
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль', { exact: true }).fill('Strong-' + unique + '-Password');
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Материалы и классы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Подключить авторство', exact: true }).click();
  await openNewAssignmentEditor(page);
  await page.getByLabel('Название задания', { exact: true }).fill('Оцениваемая практика автора');
  await page.getByLabel('Содержание', { exact: true }).fill('Первая редакция.');
  await openAssignmentSettings(page);
  await page.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('graded');
  await page.getByLabel('Максимум баллов', { exact: true }).fill('10');
  await closeAssignmentSettings(page);
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  const before = await (await page.request.get('/api/learning/activities')).json();
  const id = before.items[0].id;
  expect((await page.request.get(`/api/classrooms/${crypto.randomUUID()}/roster`)).status()).toBe(
    403,
  );
  await page.reload();
  await openExistingAssignmentEditor(page, 'Оцениваемая практика автора');
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Соберите проект и объясните соединение.');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  const published = await (await page.request.get(`/api/learning/activities/${id}`)).json();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Материалы и классы', exact: true })
    .click();
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Классы', exact: true }) })
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  await page.goto('/#/challenges');
  expect(await (await page.request.get(`/api/learning/activities/${id}`)).json()).toEqual(
    published,
  );
  await page.screenshot({ path: evidenceDir + '/author-teaching-same-material.png' });
  const code = await createClassWithStudents(page, 'Класс автора', [
    { label: 'Маша', handle: 'author-masha' },
  ]);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Настройки', exact: true })
    .click();
  await page.getByText('Шкала новых оцениваемых заданий', { exact: true }).click();
  await page.getByLabel('Название шкалы', { exact: true }).fill('Два уровня');
  await page.getByLabel('Обозначение оценки 1', { exact: true }).fill('Нужна практика');
  await page.getByLabel('Порог 2, %', { exact: true }).fill('70');
  await page.getByLabel('Обозначение оценки 2', { exact: true }).fill('Освоено');
  await page
    .getByRole('button', { name: 'Сохранить шкалу для новых заданий', exact: true })
    .click();
  await expect(
    page.getByText('Выбрана шкала «Два уровня», версия 1.', { exact: true }),
  ).toBeVisible();
  await openAssignments(page);
  await assignFromUi(page, { title: 'Оцениваемая практика автора', due: '2026-12-30' });
  // Notifications now live in Settings (owner shell ETZ §4), not a global dialog.
  const notificationPage = await page.context().newPage();
  await notificationPage.goto('/#/account/notifications');
  const inbox = notificationPage.getByRole('region', {
    name: 'Учебные оповещения — только для меня',
    exact: true,
  });
  const events = notificationPage.getByRole('region', { name: 'События уведомлений', exact: true });
  await inbox.getByLabel('Работы на проверку', { exact: true }).uncheck();
  await inbox.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
  await expect(inbox.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  await notificationPage.goto('about:blank');
  const learner = await learnerAssignments(browser, code, 'author-masha');
  await learner.page
    .getByTestId('seat-assignments')
    .getByRole('button', { name: 'Открыть', exact: true })
    .click();
  await editRealProject(learner.page, 'electronics');
  await learner.page.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
  await expect(
    learner.page
      .getByTestId('assignment-brief')
      .locator('.assignment-brief-footer')
      .getByText('На проверке', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await expect(page.getByText('Ждут проверки: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Маша · Оцениваемая/ }).click();
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  await detail.getByLabel('Баллы из 10', { exact: true }).fill('8');
  await detail.getByLabel('Отзыв', { exact: true }).fill('Соединение объяснено.');
  await detail.getByRole('button', { name: 'Принять и оценить', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Маша · Оцениваемая/ })).toContainText('Освоено');
  await notificationPage.goto('/#/account/notifications');
  await expect(events.getByRole('status')).toHaveText(/Непрочитанных: \d+/);
  await expect(events.getByRole('alert')).toHaveCount(0);
  await expect(events.getByText('Работа сдана', { exact: true })).toHaveCount(0);
  await events.screenshot({ path: evidenceDir + '/muted-inbox-queue-independent.png' });
  await learner.page.goto('/#/learning');
  // The profile repeats a grade in its summary and history; assert the actual result region.
  await learner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Результаты', exact: true })
    .click();
  await expect(
    learner.page
      .getByRole('region', { name: 'Мои результаты', exact: true })
      .getByText('Освоено', { exact: true }),
  ).toBeVisible();
  const gradedProjectionResponse = await learner.page.request.get('/api/class-join/me/assignments');
  expect(gradedProjectionResponse.ok()).toBe(true);
  const gradedProjection = (await gradedProjectionResponse.json()) as {
    items: Array<{
      title: string;
      canonicalState: {
        workflowState: string;
        selectedResult: {
          displayGrade: string | null;
          rawPoints: number | null;
          maxPoints: number | null;
        } | null;
      } | null;
    }>;
  };
  const gradedAssignment = gradedProjection.items.find(
    (item) => item.title === 'Оцениваемая практика автора',
  );
  expect(gradedAssignment?.canonicalState?.workflowState).toBe('completed');
  expect(gradedAssignment?.canonicalState?.selectedResult?.displayGrade).toBe('Освоено');
  expect(gradedAssignment?.canonicalState?.selectedResult?.rawPoints).toBe(8);
  expect(gradedAssignment?.canonicalState?.selectedResult?.maxPoints).toBe(10);

  await learner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  const gradedRow = learner.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: 'Оцениваемая практика автора' });
  await gradedRow.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  const gradedAnchor = learner.page.getByTestId('assignment-brief-anchor');
  const gradedBrief = learner.page.getByTestId('assignment-brief');
  await expect(gradedAnchor).toBeVisible({ timeout: 60_000 });
  if ((await gradedAnchor.getAttribute('aria-expanded')) !== 'true') await gradedAnchor.click();
  await expect(gradedAnchor.locator('.assignment-brief-anchor-result')).toHaveText('· Освоено');
  await expect(
    gradedBrief.locator('.assignment-brief-footer').getByText('Выполнено', { exact: true }),
  ).toBeVisible();
  await expect(gradedBrief.locator('.assignment-brief-result')).toHaveText('Освоено');
  await learner.page.screenshot({
    path: ux0EvidenceDir + '/UX0-completed-grade.png',
    fullPage: false,
  });
  await notificationPage.close();
  const stale = await page.context().newPage();
  await stale.goto(page.url());
  await stale
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
  await stale.getByRole('button', { name: 'Задания', exact: true }).click();
  await stale.getByRole('button', { name: /^Маша · Оцениваемая/ }).click();
  const staleDetail = stale.getByRole('region', { name: 'Проверка сдачи' });
  await expect(staleDetail.getByLabel('Баллы из 10', { exact: true })).toHaveValue('8');
  await detail.getByLabel('Баллы из 10', { exact: true }).fill('6');
  await detail.getByLabel('Причина возврата или исправления').fill('Уточнение по критериям');
  await detail.getByRole('button', { name: 'Исправить результат', exact: true }).click();
  await expect(detail.getByText('Ревизия 2 · Принято', { exact: true })).toBeVisible();
  await staleDetail.getByLabel('Баллы из 10', { exact: true }).fill('9');
  await staleDetail
    .getByLabel('Причина возврата или исправления')
    .fill('Конкурирующая устаревшая редакция');
  await staleDetail.getByRole('button', { name: 'Исправить результат', exact: true }).click();
  await expect(staleDetail.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Маша · Оцениваемая/ })).toContainText(
    'Нужна практика',
  );
  await learner.page.reload();
  // After reloading the editor, its persistent brief anchor must show the corrected grade.
  await expect(
    learner.page.getByTestId('assignment-brief-anchor').locator('.assignment-brief-anchor-result'),
  ).toHaveText('· Нужна практика');
  await detail.screenshot({ path: evidenceDir + '/graded-correction-history.png' });
  await staleDetail.screenshot({ path: evidenceDir + '/graded-stale-correction-denied.png' });
  await stale.close();
  await learner.context.close();
});

test('matrix 30 × 10, named exclusions, course filter, individual allowance and mobile viewport', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const titles = Array.from({ length: 10 }, (_, i) => `Практика ${String(i + 1).padStart(2, '0')}`);
  await createPublishedProjectActivity(page, titles[0]!);
  for (const title of titles.slice(1)) {
    await openNewAssignmentEditor(page);
    await page.getByLabel('Название задания', { exact: true }).fill(title);
    await page
      .getByLabel('Содержание', { exact: true })
      .fill('Соберите и сохраните собственный проект.');
    await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
    await expect(
      page.getByText('Черновик сохранён. Публикация — отдельное действие.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  }
  await createClassWithStudents(page, 'Большой класс', []);
  await page.getByRole('button', { name: 'Добавить списком', exact: true }).click();
  const roster = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Добавить список учеников', exact: true }),
  });
  await roster
    .getByLabel('Ученики', { exact: true })
    .fill(
      Array.from({ length: 30 }, (_, i) => `Ученик ${String(i + 1).padStart(2, '0')}`).join('\n'),
    );
  // Classroom owner flow is one confirmed server request, then automatic cards.
  // Retain the 30-pupil / 300-cell assertions below, not obsolete confirmations.
  await expect(roster.getByRole('button', { name: 'Проверить список', exact: true })).toHaveCount(
    0,
  );
  const added = page.waitForResponse(
    (response) => response.url().endsWith('/seats/batch') && response.request().method() === 'POST',
  );
  await roster.getByRole('button', { name: 'Добавить', exact: true }).click();
  const batch = await added;
  expect(batch.ok(), await batch.text()).toBe(true);
  await expect(roster).toBeHidden();
  const accessCards = page.getByRole('dialog', { name: 'Карточки доступа' });
  await expect(accessCards.locator('.student-access-card')).toHaveCount(30);
  await accessCards.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(accessCards).toBeHidden();
  await openAssignments(page);
  for (const [index, title] of titles.entries())
    await assignFromUi(page, {
      title,
      due: '2026-12-30',
      ...(index === 9 ? { students: ['Ученик 01', 'Ученик 02'] } : {}),
    });
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  const matrix = page.getByRole('table', { name: 'Журнал работ класса' });
  await expect(matrix.locator('tbody tr')).toHaveCount(30);
  await expect(matrix.locator('thead th')).toHaveCount(11);
  await expect(matrix.locator('tbody td')).toHaveCount(300);
  await expect(
    matrix.getByRole('button', { name: 'Ученик 03 · Практика 10 · Не назначено', exact: true }),
  ).toBeDisabled();
  await expect(
    matrix.getByRole('button', { name: 'Ученик 01 · Практика 10 · Не начато', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Курс в журнале').selectOption('direct');
  await expect(matrix.locator('thead th')).toHaveCount(11);
  await page.getByLabel('Найти ученика').fill('Ученик 30');
  await expect(matrix.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Найти ученика').fill('');
  await matrix
    .getByRole('button', { name: 'Ученик 01 · Практика 01 · Не начато', exact: true })
    .click();
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  const individual = detail
    .locator('.learning-conditions')
    .filter({ has: page.getByText('Индивидуальные условия', { exact: true }) });
  await individual.getByText('Индивидуальные условия', { exact: true }).click();
  await individual.getByText('Дополнительные попытки и освобождение', { exact: true }).click();
  await individual.getByLabel('Всего дополнительных попыток').fill('2');
  await individual
    .getByLabel('Причина изменения условий')
    .fill('Дополнительная практика по договорённости.');
  await individual
    .getByRole('button', { name: 'Сохранить индивидуальное разрешение', exact: true })
    .click();
  await expect(individual.getByRole('status')).toContainText('Индивидуальное разрешение сохранено');
  await detail.getByRole('button', { name: 'Закрыть проверку', exact: true }).click();
  await page.screenshot({ path: evidenceDir + '/matrix-30x10-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = page.getByRole('region', { name: 'Прокрутка журнала' });
  await scroll.scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidenceDir + '/matrix-30x10-mobile.png' });
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')]
      .filter(
        (el) =>
          el.getBoundingClientRect().right > innerWidth + 1 &&
          !el.closest('.gradebook-matrix-scroll'),
      )
      .slice(0, 20)
      .map((el) => ({
        tag: el.tagName,
        cls: el.className,
        text: el.textContent?.slice(0, 100),
        parent: el.parentElement?.outerHTML.slice(0, 250),
        width: el.getBoundingClientRect().width,
      })),
  }));
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width + 1);
  await scroll.focus();
  await page.keyboard.press('End');
  await page.screenshot({ path: evidenceDir + '/matrix-30x10-mobile.png' });
});

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'learning-course01-browser');
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(ux0EvidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

async function createPublishedProjectActivityAfterLogin(
  page: Page,
  title: string,
  module = 'electronics',
  resultMode = 'completion',
  sampleImage?: Buffer,
  goal?: string,
): Promise<void> {
  await openNewAssignmentEditor(page);
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  if (goal) await page.getByLabel('Цель задания', { exact: true }).fill(goal);
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Соберите цепь, сохраните проект и сдайте точную редакцию.');
  await openAssignmentSettings(page);
  await page.getByLabel('Среда проекта').selectOption(module);
  await page.getByRole('combobox', { name: 'Результат', exact: true }).selectOption(resultMode);
  await closeAssignmentSettings(page);
  if (sampleImage) {
    await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
    await page.getByLabel('Файл схемы или изображения', { exact: true }).setInputFiles({
      name: 'course-activity-sample.png',
      mimeType: 'image/png',
      buffer: sampleImage,
    });
  }
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  if (goal) {
    await previewAssignmentAs(page, 'draft');
    await expect(
      page.getByRole('dialog', { name: 'Как увидит ученик' }).getByTestId('learner-preview'),
    ).toContainText(goal);
    await closeAssignmentPreview(page);
  }
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  if (goal) {
    await previewAssignmentAs(page, 'published');
    await expect(
      page.getByRole('dialog', { name: 'Как увидит ученик' }).getByTestId('learner-preview'),
    ).toContainText(goal);
    await closeAssignmentPreview(page);
  }
  await page.screenshot({ path: evidenceDir + '/authored-material-published.png', fullPage: true });
}

async function createPublishedProjectActivity(
  page: Page,
  title: string,
  module = 'electronics',
  resultMode = 'completion',
  actor = teacher,
): Promise<void> {
  await loginWithOrganization(page, actor);
  await createPublishedProjectActivityAfterLogin(page, title, module, resultMode);
}

test('Teacher queue: exact review, settings read/OFF, return/resubmit, accept and exact join approval', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const homeTeacher = await seedTeacher(admin, 'teacher-home');
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = 'Практика с Главной';
  await createPublishedProjectActivity(page, title, 'three-d', 'completion', homeTeacher);
  await page.goto('/#/home');
  await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
  // The newer owner shell ETZ deliberately removes Home attention and the
  // global inbox. Keep their academic contract via the existing scoped API;
  // exercise decisions in the real classroom and notifications in Settings.
  await expect(page.getByRole('region', { name: 'Требует внимания', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Оповещения/ })).toHaveCount(0);
  const attention = async (): Promise<TeacherHomeAttention> => {
    const response = await page.request.get('/api/classrooms/teacher-home-attention');
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const waitReviews = async (count: number) => {
    await expect.poll(async () => (await attention()).reviews.length).toBe(count);
  };
  const destination = (review: TeacherHomeAttention['reviews'][number]) => {
    expect(review.attemptId).toBeTruthy();
    const query = new URLSearchParams({ assignment: review.assignmentId, learner: review.seatId });
    if (review.attemptId) query.set('attempt', review.attemptId);
    return '/#/classrooms/' + review.classroomId + '?' + query;
  };
  expect(await attention()).toMatchObject({
    reviews: [],
    joinRequests: [],
    classrooms: [],
    joinRequestsMayBeLimited: false,
  });
  const code = await createClassWithStudents(page, 'Класс Главной', [
    { label: 'Лена Главная', handle: 'home-lena' },
  ]);
  const classId = page.url().split('/classrooms/')[1]!.split('?')[0]!;
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-12-31' });
  const learner = await learnerAssignments(browser, code, 'home-lena');
  const work = learner.page
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: title });
  await work.getByRole('button', { name: 'Открыть', exact: true }).click();
  await editRealProject(learner.page, 'three-d');
  const submit = async (label: 'Отправить на проверку' | 'Отправить повторно') => {
    await learner.page.getByRole('button', { name: label, exact: true }).click();
    await expect(
      learner.page
        .getByTestId('assignment-brief')
        .locator('.assignment-brief-footer')
        .getByText('На проверке', { exact: true }),
    ).toBeVisible();
  };
  await submit('Отправить на проверку');
  await waitReviews(1);
  const first = (await attention()).reviews[0]!;
  expect(first).toMatchObject({
    classroomId: classId,
    assignmentTitle: title,
    learnerName: 'Лена Главная',
  });
  const firstHref = destination(first);
  expect(firstHref).toContain('/classrooms/' + classId + '?assignment=');
  expect(firstHref).toMatch(/&learner=.+&attempt=/);
  expect((await attention()).classrooms).toEqual([{ id: classId, title: 'Класс Главной' }]);

  await page.goto('/#/account/notifications');
  const events = page.getByRole('region', { name: 'События уведомлений', exact: true });
  await expect(
    events.getByRole('button', { name: 'Отметить прочитанными', exact: true }),
  ).toBeEnabled();
  await events.getByRole('button', { name: 'Отметить прочитанными', exact: true }).click();
  await expect(events.getByRole('status')).toHaveText('Непрочитанных: 0');
  const preferences = page.getByRole('region', {
    name: 'Учебные оповещения — только для меня',
    exact: true,
  });
  await preferences.getByLabel('Работы на проверку', { exact: true }).uncheck();
  await preferences.getByLabel('Получать учебные оповещения', { exact: true }).uncheck();
  await preferences.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
  await expect(preferences.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  expect((await attention()).reviews).toEqual([first]);

  await page.goto(firstHref);
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  await expect(detail.getByRole('heading', { name: 'Лена Главная · ' + title })).toBeVisible();
  await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
  await detail.screenshot({ path: evidenceDir + '/teacher-queue-exact-review.png' });
  await detail.getByLabel('Причина возврата или исправления').fill('Проверьте форму.');
  await detail.getByRole('button', { name: 'Вернуть на доработку', exact: true }).click();
  await expect(detail.getByText('Ревизия 1 · На доработке')).toBeVisible();
  await waitReviews(0);
  await learner.page.goto('/#/learning');
  await learner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  await work.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await editRealProject(learner.page, 'three-d');
  await submit('Отправить повторно');
  await waitReviews(1);
  const second = (await attention()).reviews[0]!;
  expect(second).toMatchObject({
    classroomId: classId,
    assignmentTitle: title,
    learnerName: 'Лена Главная',
  });
  expect(destination(second)).not.toBe(firstHref);
  await page.goto(destination(second));
  await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
  await expect(detail.getByText('Ревизия 1 · Принято')).toBeVisible();
  await waitReviews(0);

  const applicant = await browser.newContext();
  const applicantPage = await applicant.newPage();
  await loginWithOrganization(applicantPage, await seedTeacher(admin, 'home-applicant'));
  await applicantPage.goto('/#/attending');
  await applicantPage.getByLabel('Код класса', { exact: true }).fill(code);
  const joining = applicantPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/class-join/account') && response.request().method() === 'POST',
  );
  await applicantPage.getByRole('button', { name: 'Войти в класс', exact: true }).click();
  const joined = await joining;
  expect(joined.ok(), await joined.text()).toBe(true);
  const requestId = (await joined.json()).requestId;
  await expect
    .poll(async () => (await attention()).joinRequests.map((request) => request.id))
    .toEqual([requestId]);
  expect((await attention()).joinRequests[0]).toMatchObject({
    id: requestId,
    classroomId: classId,
  });
  await page.goto('/#/classrooms/' + classId + '?joinRequest=' + requestId);
  const target = page.locator('#join-request-' + requestId);
  await expect(target).toBeFocused();
  await target.getByRole('button', { name: 'Принять заявку', exact: true }).click();
  await expect(target).toContainText('Принята');
  await expect.poll(async () => (await attention()).joinRequests.length).toBe(0);
  expect(await attention()).toMatchObject({
    reviews: [],
    joinRequests: [],
    joinRequestsMayBeLimited: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: evidenceDir + '/teacher-queue-approved-mobile.png',
    fullPage: true,
  });
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
  failures.assertEmpty();
  await learner.context.close();
  await applicant.close();
});

test('ungraded real submission has an official acceptance but no manufactured points or grade', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const title = 'Без оценки ' + ++sequence;
  await createPublishedProjectActivity(page, title, 'three-d', 'ungraded');
  const code = await createClassWithStudents(page, 'Без числовой оценки', [
    { label: 'Лена', handle: 'ungraded-lena' },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-12-31' });
  const learner = await learnerAssignments(browser, code, 'ungraded-lena');
  await learner.page
    .getByTestId('seat-assignments')
    .getByRole('button', { name: 'Открыть', exact: true })
    .click();
  await editRealProject(learner.page, 'three-d');
  await learner.page.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
  await expect(
    learner.page
      .getByTestId('assignment-brief')
      .locator('.assignment-brief-footer')
      .getByText('На проверке', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  const cell = page.getByRole('button', { name: new RegExp('Лена · ' + title) });
  await cell.click();
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
  await expect(detail.getByLabel(/Баллы из/)).toHaveCount(0);
  await detail.getByLabel('Отзыв', { exact: true }).fill('Отлично — это отзыв, не балл.');
  await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
  await expect(cell).toContainText('Выполнено');
  await detail.screenshot({ path: evidenceDir + '/ungraded-official-review.png' });
  await learner.page.goto('/#/learning');
  const response = await learner.page.request.get('/api/class-join/me/assignments');
  expect(response.ok()).toBe(true);
  const items = (await response.json()).items;
  expect(
    items.find((item: { title: string }) => item.title === title).canonicalState.selectedResult,
  ).toMatchObject({ rawPoints: null, maxPoints: null, completionValue: true });
  await learner.context.close();
});

async function createClassWithStudents(
  page: Page,
  className: string,
  students: ReadonlyArray<{ label: string; handle: string }>,
): Promise<string> {
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

test('V3 Direct Seat double Start, lost response, second tab and reload keep one work', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const title = `Повтор начала работы ${++sequence}`;
  const v3Teacher = await seedTeacher(admin, 'v3-start-repeat');
  await createPublishedProjectActivity(page, title, 'electronics', 'completion', v3Teacher);
  const code = await createClassWithStudents(page, 'Класс повтора Start', [
    { label: 'Ирина', handle: 'v3-start-irina' },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2026-12-30' });

  const learner = await learnerAssignments(browser, code, 'v3-start-irina');
  const secondTab = await learner.context.newPage();
  await secondTab.goto('/#/learning');
  await openPortalSection(secondTab, 'Моё обучение');
  await secondTab
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  const assignmentRow = (tab: Page) =>
    tab.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
  const firstStart = assignmentRow(learner.page).getByRole('button', {
    name: 'Открыть',
    exact: true,
  });
  const secondStart = assignmentRow(secondTab).getByRole('button', {
    name: 'Открыть',
    exact: true,
  });
  await expect(firstStart).toBeVisible();
  await expect(secondStart).toBeVisible();

  type StartReceipt = {
    projectId: string;
    participationId: string;
    activityRunId: string;
    attemptId: string;
    attemptNumber: number;
    state: string;
    reused: boolean;
  };
  const startPath = '**/api/learning/work/runs/*/start';
  const isStart = (url: string) =>
    /^\/api\/learning\/work\/runs\/[^/]+\/start$/.test(new URL(url).pathname);
  const firstRequestIds: string[] = [];
  const secondRequestIds: string[] = [];
  learner.page.on('request', (request) => {
    if (request.method() === 'POST' && isStart(request.url())) {
      firstRequestIds.push((request.postDataJSON() as { requestId: string }).requestId);
    }
  });
  secondTab.on('request', (request) => {
    if (request.method() === 'POST' && isStart(request.url())) {
      secondRequestIds.push((request.postDataJSON() as { requestId: string }).requestId);
    }
  });

  let upstreamStatus: number | null = null;
  let committedReceipt: StartReceipt | null = null;
  // Lose only the browser response. route.fetch must first prove the server committed Start.
  await learner.page.route(startPath, async (route) => {
    const upstream = await route.fetch();
    upstreamStatus = upstream.status();
    if (upstream.ok()) committedReceipt = (await upstream.json()) as StartReceipt;
    await route.abort('failed');
  });
  await firstStart.dblclick();
  await expect.poll(() => committedReceipt).not.toBeNull();
  expect(upstreamStatus).toBe(200);
  await expect(learner.page.locator('.seat-assignments [role="alert"]')).toBeVisible();
  await expect(firstStart).toBeEnabled();
  expect(firstRequestIds).toHaveLength(1);
  await learner.page.unroute(startPath);
  const committed = committedReceipt as StartReceipt;
  expect(committed).toMatchObject({ attemptNumber: 1, state: 'in_progress', reused: false });

  // The other tab was opened before Start and sends its own request identity.
  const secondResponsePromise = secondTab.waitForResponse(
    (response) => response.request().method() === 'POST' && isStart(response.url()),
  );
  await secondStart.click();
  const secondResponse = await secondResponsePromise;
  expect(secondResponse.status()).toBe(200);
  const secondReceipt = (await secondResponse.json()) as StartReceipt;
  await expect(secondTab.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(secondTab, 'electronics')).toBe(committed.projectId);

  // The first tab retries through the UI with the original key after the lost response.
  const retryResponsePromise = learner.page.waitForResponse(
    (response) => response.request().method() === 'POST' && isStart(response.url()),
  );
  await expect(firstStart).toBeEnabled();
  await firstStart.click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(200);
  const retryReceipt = (await retryResponse.json()) as StartReceipt;
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(committed.projectId);
  const lostRequestId = firstRequestIds[0]!;
  expect(firstRequestIds).toEqual([lostRequestId, lostRequestId]);
  expect(secondRequestIds).toHaveLength(1);
  expect(secondRequestIds[0]).not.toBe(firstRequestIds[0]);
  for (const receipt of [secondReceipt, retryReceipt]) {
    expect(receipt).toMatchObject({
      projectId: committed.projectId,
      participationId: committed.participationId,
      activityRunId: committed.activityRunId,
      attemptId: committed.attemptId,
      attemptNumber: 1,
      state: 'in_progress',
      reused: true,
    });
  }

  await learner.page.reload();
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(committed.projectId);
  await learner.page.goto('/#/learning');
  await openPortalSection(learner.page, 'Моё обучение');
  await learner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  const continueWork = assignmentRow(learner.page).getByRole('button', {
    name: 'Открыть работу',
    exact: true,
  });
  await expect(continueWork).toBeVisible();
  await learner.page.screenshot({
    path: `${evidenceDir}/V3-start-repeat-desktop.png`,
    fullPage: true,
  });
  await learner.page.setViewportSize({ width: 390, height: 844 });
  await expect(continueWork).toBeVisible();
  await learner.page.screenshot({ path: `${evidenceDir}/V3-start-repeat-390.png`, fullPage: true });
  await continueWork.click();
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(committed.projectId);

  const stored = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM projects WHERE idempotency_key=$1) AS projects,
       (SELECT count(*)::int FROM project_drafts WHERE project_id=$2) AS drafts,
       (SELECT count(*)::int FROM learning_project_origins WHERE participation_id=$3) AS origins,
       (SELECT count(*)::int FROM learning_attempts WHERE activity_participation_id=$3) AS attempts,
       (SELECT count(*)::int FROM learning_work_start_requests WHERE participation_id=$3) AS requests`,
    [`learning:${committed.participationId}`, committed.projectId, committed.participationId],
  );
  expect(stored.rows[0]).toMatchObject({
    projects: 1,
    drafts: 1,
    origins: 1,
    attempts: 1,
    requests: 2,
  });
  const identity = await admin.query(
    `SELECT origin.project_id, origin.activity_run_id, attempt.id AS attempt_id,
            attempt.attempt_number, attempt.state
       FROM learning_project_origins origin
       JOIN learning_attempts attempt
         ON attempt.activity_participation_id=origin.participation_id
      WHERE origin.participation_id=$1`,
    [committed.participationId],
  );
  expect(identity.rows).toEqual([
    {
      project_id: committed.projectId,
      activity_run_id: committed.activityRunId,
      attempt_id: committed.attemptId,
      attempt_number: 1,
      state: 'in_progress',
    },
  ]);
  const requestRows = await admin.query(
    `SELECT request_id, project_id, attempt_id
       FROM learning_work_start_requests
      WHERE participation_id=$1 ORDER BY request_id`,
    [committed.participationId],
  );
  expect(requestRows.rows).toEqual(
    [lostRequestId, secondRequestIds[0]!].sort().map((requestId) => ({
      request_id: requestId,
      project_id: committed.projectId,
      attempt_id: committed.attemptId,
    })),
  );
  await learner.context.close();
});

test('teacher authors and assigns a canonical activity to the whole class and a learner sees it', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Светодиод и резистор ${++sequence}`;
  await createPublishedProjectActivity(page, title);
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

test('teacher authors and selects two learners and the third learner cannot see the assignment', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Точная цепь ${++sequence}`;
  await createPublishedProjectActivity(page, title);
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
  await teacherRow.getByRole('button', { name: title, exact: true }).click();
  await page.getByText('Аудитория назначения', { exact: true }).click();
  const audience = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Аудитория назначения' }) });
  await audience.getByLabel('Причина изменения аудитории').fill('Добавляем ученика к этой работе');
  await audience.getByRole('button', { name: 'Добавить Егор', exact: true }).click();
  await expect(audience.getByRole('button', { name: 'Исключить Егор', exact: true })).toBeVisible();
  await excluded.page.reload();
  await expect(
    excluded.page.getByTestId('seat-assignments').locator('li').filter({ hasText: title }),
  ).toBeVisible();
  await audience
    .getByLabel('Причина изменения аудитории')
    .fill('Отзываем назначение, историю сохраняем');
  await audience.getByRole('button', { name: 'Исключить Егор', exact: true }).click();
  await expect(audience.getByRole('button', { name: 'Добавить Егор', exact: true })).toBeDisabled();
  await excluded.page.reload();
  await expect(excluded.page.getByText(title, { exact: true })).toHaveCount(0);
  await audience.screenshot({ path: evidenceDir + '/named-audience-withdrawn.png' });
  await excluded.context.close();

  failures.assertEmpty();
});

for (const module of ['three-d', 'electronics'])
  test(`real ${module} Seat save → exact submission → teacher returns → new attempt → accepted matrix result`, async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    const title = module + ' практика ' + ++sequence;
    await createPublishedProjectActivity(page, title, module);
    const code = await createClassWithStudents(page, 'Класс проверки ' + module, [
      { label: 'Ирина', handle: 'irina-e1-review' },
    ]);
    await openAssignments(page);
    await assignFromUi(page, { title, due: '2026-12-30' });
    const teacherUrl = page.url();
    const learner = await learnerAssignments(browser, code, 'irina-e1-review');
    const row = learner.page
      .getByTestId('seat-assignments')
      .locator('li')
      .filter({ hasText: title });
    await row.getByRole('button', { name: 'Открыть', exact: true }).click();
    await editRealProject(learner.page, module);
    const brief = learner.page.getByTestId('assignment-brief');
    await expect(brief.getByText('В работе', { exact: true })).toBeVisible();
    await expect(brief.getByText('Сохранено', { exact: true })).toBeVisible();
    await expect(
      brief.getByRole('button', { name: 'Отправить на проверку', exact: true }),
    ).toBeEnabled();
    await brief.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
    await expect(
      brief.locator('.assignment-brief-footer').getByText('На проверке', { exact: true }),
    ).toBeVisible();
    await expect(brief.getByRole('button', { name: /Отправить|Продолжить/ })).toHaveCount(0);
    if (module === 'electronics') {
      await learner.page.screenshot({
        path: ux0EvidenceDir + '/UX0-waiting-review.png',
        fullPage: false,
      });
    }
    await learner.page.screenshot({
      path: evidenceDir + '/' + module + '-exact-submission.png',
      fullPage: true,
    });
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Журнал', exact: true })
      .click();
    await page.getByRole('button', { name: 'Задания', exact: true }).click();
    const cell = page.getByRole('button', { name: new RegExp('Ирина · ' + title) });
    await cell.click();
    const detail = page.getByRole('region', { name: 'Проверка сдачи' });
    await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
    const firstVersion = await detail.getByTestId('submission-version-id').innerText();
    await detail.getByText('Содержимое и контрольная сумма сдачи', { exact: true }).click();
    const submittedDocument = await detail.locator('pre').innerText();
    const submittedProjectId = courseActivityProjectId(learner.page, module);
    const readableOriginal = await learner.page.request.get(`/api/projects/${submittedProjectId}`);
    expect(readableOriginal.status()).toBe(200);
    const submittedDraft = (await readableOriginal.json()) as {
      draft: { document: unknown; revision: number };
    };
    const deniedEdit = await learner.page.request.put(`/api/projects/${submittedProjectId}/draft`, {
      headers: { origin: new URL(learner.page.url()).origin },
      data: {
        document: submittedDraft.draft.document,
        baseRevision: submittedDraft.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(deniedEdit.status()).toBe(403);
    expect((await deniedEdit.json()).error.code).toBe('learning_work_read_only');
    await learner.page.reload();
    await page.getByRole('button', { name: 'Закрыть проверку', exact: true }).click();
    await cell.click();
    await detail.getByText('Содержимое и контрольная сумма сдачи', { exact: true }).click();
    await expect(detail.getByTestId('submission-version-id')).toHaveText(firstVersion);
    await expect(detail.locator('pre')).toHaveText(submittedDocument);
    await detail.getByLabel('Причина возврата или исправления').fill('Добавьте вторую фигуру.');
    await detail.getByRole('button', { name: 'Вернуть на доработку', exact: true }).click();
    await expect(detail.getByText('Ревизия 1 · На доработке')).toBeVisible();
    await learner.page.goto('/#/learning');
    await openPortalSection(learner.page, 'Моё обучение');
    await learner.page
      .getByRole('navigation', { name: 'Разделы моего обучения' })
      .getByRole('link', { name: 'Задания', exact: true })
      .click();
    await expect(row).toContainText('Нужна доработка');
    await expect(row.getByRole('button', { name: 'Начать доработку', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Открыть работу', exact: true }).click();
    const learnerAnchor = learner.page.getByTestId('assignment-brief-anchor');
    if ((await learnerAnchor.getAttribute('aria-expanded')) !== 'true') await learnerAnchor.click();
    await expect(brief).toBeVisible();
    await expect(
      brief.locator('.assignment-brief-footer').getByText('Нужна доработка', { exact: true }),
    ).toBeVisible();
    const continueButton = brief.getByRole('button', { name: 'Продолжить', exact: true });
    await expect(continueButton).toBeEnabled();

    const beforeContinueProjectionResponse = await learner.page.request.get(
      '/api/class-join/me/assignments',
    );
    expect(beforeContinueProjectionResponse.ok()).toBe(true);
    const beforeContinueProjection = (await beforeContinueProjectionResponse.json()) as {
      items: Array<{
        title: string;
        canonicalState: { workflowState: string; flags: string[] } | null;
      }>;
    };
    const beforeContinueAssignment = beforeContinueProjection.items.find(
      (item) => item.title === title,
    );
    expect(beforeContinueAssignment?.canonicalState?.workflowState).toBe('changes_requested');
    expect(beforeContinueAssignment?.canonicalState?.flags ?? []).not.toContain(
      'revision_in_progress',
    );

    if (module === 'electronics') {
      await learner.page.screenshot({
        path: ux0EvidenceDir + '/UX0-changes-requested.png',
        fullPage: false,
      });
    }
    await continueButton.click();
    await expect(
      brief.getByRole('button', { name: 'Отправить повторно', exact: true }),
    ).toBeEnabled({ timeout: 15_000 });

    const resumedProjectionResponse = await learner.page.request.get(
      '/api/class-join/me/assignments',
    );
    expect(resumedProjectionResponse.ok()).toBe(true);
    const resumedProjection = (await resumedProjectionResponse.json()) as {
      items: Array<{
        title: string;
        canonicalState: { workflowState: string; flags: string[] } | null;
      }>;
    };
    const resumedAssignment = resumedProjection.items.find((item) => item.title === title);
    expect(resumedAssignment?.canonicalState?.workflowState).toBe('in_progress');
    expect(resumedAssignment?.canonicalState?.flags).toContain('revision_in_progress');

    await editRealProject(learner.page, module);
    await expect(
      brief.getByRole('button', { name: 'Отправить повторно', exact: true }),
    ).toBeEnabled();
    await brief.getByRole('button', { name: 'Отправить повторно', exact: true }).click();
    await expect(
      brief.locator('.assignment-brief-footer').getByText('На проверке', { exact: true }),
    ).toBeVisible();
    const resubmittedProjectionResponse = await learner.page.request.get(
      '/api/class-join/me/assignments',
    );
    expect(resubmittedProjectionResponse.ok()).toBe(true);
    const resubmittedProjection = (await resubmittedProjectionResponse.json()) as {
      items: Array<{
        title: string;
        canonicalState: { workflowState: string; flags: string[] } | null;
      }>;
    };
    const resubmittedAssignment = resubmittedProjection.items.find((item) => item.title === title);
    expect(['submitted', 'waiting_review']).toContain(
      resubmittedAssignment?.canonicalState?.workflowState,
    );
    expect(resubmittedAssignment?.canonicalState?.flags ?? []).not.toContain(
      'revision_in_progress',
    );
    await page.goto(teacherUrl);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Журнал', exact: true })
      .click();
    await page.getByRole('button', { name: 'Задания', exact: true }).click();
    await cell.click();
    await expect(detail.getByTestId('submission-version-id')).not.toHaveText(firstVersion);
    await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
    await expect(cell).toContainText('Выполнено');
    await page.screenshot({
      path: evidenceDir + '/gradebook-accepted-' + module + '.png',
      fullPage: true,
    });

    await learner.page.goto('/#/learning');
    await openPortalSection(learner.page, 'Моё обучение');
    await learner.page
      .getByRole('navigation', { name: 'Разделы моего обучения' })
      .getByRole('link', { name: 'Задания', exact: true })
      .click();
    const completedRow = learner.page
      .getByTestId('seat-assignments')
      .locator('li')
      .filter({ hasText: title });
    await expect(completedRow).toContainText('Выполнено');
    await completedRow.getByRole('button', { name: 'Открыть работу', exact: true }).click();
    const completedAnchor = learner.page.getByTestId('assignment-brief-anchor');
    if ((await completedAnchor.getAttribute('aria-expanded')) !== 'true') {
      await completedAnchor.click();
    }
    await expect(brief).toBeVisible();
    await expect(
      brief.locator('.assignment-brief-footer').getByText('Выполнено', { exact: true }),
    ).toBeVisible();
    await expect(brief.locator('.assignment-brief-result')).toHaveText('✓ Принято');
    await expect(completedAnchor.locator('.assignment-brief-anchor-result')).toHaveText('· ✓');
    if (module === 'electronics') {
      await learner.page.screenshot({
        path: ux0EvidenceDir + '/UX0-completed-check.png',
        fullPage: false,
      });
    }
    await learner.context.close();
  });

test('Course Builder preserves typed lesson edits across real hide and show responses', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const visibilityEvidenceDir = `${evidenceDir}/visibility-save`;
  mkdirSync(visibilityEvidenceDir, { recursive: true });
  const courseTitle =
    'Сохранение уроков при изменении видимости разделов и материалов ' + ++sequence;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await loginWithOrganization(page, teacher);
  await page.goto('/#/challenges');
  const tabs = page.getByRole('navigation', { name: 'Разделы курсов и заданий' });
  await tabs.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/courses',
  );
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const created = await creation;
  expect(created.status()).toBe(201);
  const courseId = ((await created.json()) as { id: string }).id;
  const editor = page.getByTestId('course-editor');
  const lessonForm = editor.locator('.course-lesson-editor');
  const title = editor.getByLabel('Название урока');
  const summary = editor.getByLabel('Что будет в уроке');
  const save = editor.getByRole('button', { name: 'Сохранить урок', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '+ Урок', exact: true }).click();
  await title.fill('Исходная теория');
  await summary.fill('Исходное описание');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Содержание исходного урока.');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок добавлен.',
  );
  const readOutline = async () => {
    const response = await page.request.get(`/api/courses/${courseId}/outline`);
    expect(response.ok()).toBe(true);
    return (await response.json()) as { draftRevision: number; sections: CourseSection[] };
  };
  const initial = await readOutline();
  const sectionId = initial.sections[0].id;
  const lessonId = initial.sections[0].lessons[0].id;
  const lessonPath = `/api/courses/${courseId}/lessons/${lessonId}`;
  const lessonWrites: Array<{ expectedRevision: number; title: string; summary: string }> = [];
  const courseMutations: string[] = [];
  page.on('request', (request) => {
    if (
      ['POST', 'PATCH', 'DELETE'].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith(`/api/courses/${courseId}/`)
    )
      courseMutations.push(request.method() + ' ' + new URL(request.url()).pathname);
    if (request.method() === 'PATCH' && new URL(request.url()).pathname === lessonPath) {
      lessonWrites.push(request.postDataJSON());
    }
  });

  async function checkLayout(
    phase: 'pending' | 'confirmed' | 'unconfirmed' | 'unavailable',
  ): Promise<void> {
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(title).toBeVisible();
      await expect(summary).toBeVisible();
      await expect(save).toBeVisible();
      const text =
        phase === 'unconfirmed' || phase === 'unavailable'
          ? editor.getByRole('alert')
          : phase === 'confirmed'
            ? editor.getByRole('status', { name: 'Уведомление курса', exact: true })
            : editor.getByRole('status', { name: 'Состояние сохранения курса', exact: true });
      await expect(text).toBeVisible();
      const geometry = await text.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        return {
          left: box.left,
          right: box.right,
          width: box.width,
          lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
          textWithin: rects.every(
            (rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1,
          ),
        };
      });
      expect(geometry.left, `${phase} left at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(geometry.right, `${phase} right at ${width}px`).toBeLessThanOrEqual(width);
      expect(geometry.width, `${phase} readable width at ${width}px`).toBeGreaterThanOrEqual(160);
      expect(geometry.lines).toBeGreaterThan(0);
      expect(geometry.lines).toBeLessThanOrEqual(12);
      expect(geometry.textWithin).toBe(true);
      for (const control of [title, summary, save]) {
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      await title.focus();
      await expect(title).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      if (width === 1440 || width === 390) {
        // Preserve the focused viewport before a full-page capture changes its height.
        await page.screenshot({
          path: `${visibilityEvidenceDir}/${phase}-${width}-viewport.png`,
          fullPage: false,
        });
        // Fixed headers must be captured from the document origin, not the focus scroll.
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({
          x: 0,
          y: 0,
        });
        await page.screenshot({
          path: `${visibilityEvidenceDir}/${phase}-${width}.png`,
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  async function discardAndReopen(expectedTitle: string | null): Promise<void> {
    const retainedTitle = await title.inputValue();
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('несохранённые изменения');
      void dialog.dismiss();
    });
    await tabs.getByRole('button', { name: 'Задания', exact: true }).click();
    await expect(title).toHaveValue(retainedTitle);
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('несохранённые изменения');
      void dialog.accept();
    });
    await tabs.getByRole('button', { name: 'Задания', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await tabs.getByRole('button', { name: 'Курсы', exact: true }).click();
    if (expectedTitle === null) {
      await expect(page.locator('.course-row-main').filter({ hasText: courseTitle })).toHaveCount(
        0,
      );
      return;
    }
    await page
      .getByTestId('courses-list')
      .locator('.course-row-main')
      .filter({ hasText: courseTitle })
      .click();
    await expect(title).toHaveValue(expectedTitle);
    await expect(save).toBeEnabled();
  }

  async function changeVisibility(
    kind: 'lesson' | 'section',
    hidden: boolean,
    outcome: 'saved' | 'conflict' | 'lost' | 'archived' = 'saved',
  ): Promise<void> {
    const before = await readOutline();
    const oldLesson = before.sections[0].lessons[0];
    const targetId = kind === 'lesson' ? lessonId : sectionId;
    const path = `/api/courses/${courseId}/${kind}s/${targetId}/hidden`;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted!: (value: { hidden: boolean; draftRevision: number }) => void;
    const serverSaved = new Promise<{ hidden: boolean; draftRevision: number }>((resolve) => {
      accepted = resolve;
    });
    const delayResponse = async (route: Route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({
        hidden,
        expectedRevision: before.draftRevision,
      });
      // Commit the real server mutation first. Delay or lose only its response;
      // no successful mutation or receipt is supplied by a browser mock.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const receipt = (await response.json()) as { hidden: boolean; draftRevision: number };
      expect(receipt).toEqual({ hidden, draftRevision: before.draftRevision + 1 });
      accepted(receipt);
      await held;
      if (outcome === 'lost') await route.abort('failed');
      else await route.fulfill({ response });
    };
    await page.route(`**${path}`, delayResponse);
    const row = editor
      .locator(kind === 'lesson' ? '.course-outline-section li' : '.course-outline-section-head')
      .first();
    await row
      .getByRole('button', { name: kind === 'lesson' ? /Действия урока/ : /Действия раздела/ })
      .click();
    await row.getByRole('button', { name: hidden ? 'Скрыть' : 'Показать', exact: true }).click();
    const receipt = await serverSaved;
    const laterTitle = `Правки урока во время ${kind} ${hidden ? 'hide' : 'show'} ${outcome}`;
    const laterSummary = 'Последнее описание, введённое после записи видимости на сервере.';
    await title.fill(laterTitle);
    await summary.fill(laterSummary);
    await expect(save).toBeDisabled();
    await expect(lessonForm).toContainText('Дождитесь подтверждения');
    const writesBefore = lessonWrites.length;
    await lessonForm.evaluate((element) => (element as HTMLFormElement).requestSubmit());
    if (kind === 'lesson' && hidden && outcome === 'saved') await checkLayout('pending');
    expect(lessonWrites).toHaveLength(writesBefore);
    const persistedVisibility = await readOutline();
    expect(persistedVisibility.draftRevision).toBe(receipt.draftRevision);
    expect(
      kind === 'lesson'
        ? persistedVisibility.sections[0].lessons[0].hidden
        : persistedVisibility.sections[0].hidden,
    ).toBe(hidden);
    expect(persistedVisibility.sections[0].lessons[0].title).toBe(oldLesson.title);

    let competingOutline: Awaited<ReturnType<typeof readOutline>> | undefined;
    if (outcome === 'conflict') {
      const remote = await page.request.patch(lessonPath, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          sectionId,
          title: 'Чужие сохранённые правки C',
          summary: 'Описание другого редактора C',
          content: null,
          blocks: oldLesson.blocks,
          kind: 'material',
          assignmentId: null,
          learningActivityVersionId: null,
          estimatedMinutes: null,
          expectedRevision: receipt.draftRevision,
        },
      });
      expect(remote.status()).toBe(200);
      const remoteReceipt = (await remote.json()) as { id: string; draftRevision: number };
      expect(remoteReceipt.id).toBe(lessonId);
      expect(Number.isSafeInteger(remoteReceipt.draftRevision)).toBe(true);
      // A lesson save can touch the course root more than once. Correlate its exact
      // committed revision without rebasing the editor's held visibility receipt.
      expect(remoteReceipt.draftRevision).toBeGreaterThan(receipt.draftRevision);
      competingOutline = await readOutline();
      expect(competingOutline.draftRevision).toBe(remoteReceipt.draftRevision);
      expect(competingOutline.sections).toHaveLength(1);
      expect(competingOutline.sections[0].id).toBe(sectionId);
      expect(competingOutline.sections[0].hidden).toBe(persistedVisibility.sections[0].hidden);
      expect(competingOutline.sections[0].lessons).toHaveLength(1);
      expect(competingOutline.sections[0].lessons[0]).toMatchObject({
        id: lessonId,
        title: 'Чужие сохранённые правки C',
        summary: 'Описание другого редактора C',
        blocks: oldLesson.blocks,
        hidden: persistedVisibility.sections[0].lessons[0].hidden,
      });
    }
    if (outcome === 'archived') {
      const archived = await page.request.post(`/api/courses/${courseId}/archive`, {
        headers: { origin: new URL(page.url()).origin },
        data: { archived: true, expectedRevision: receipt.draftRevision },
      });
      expect(archived.ok()).toBe(true);
      expect((await archived.json()) as { archived: boolean; draftRevision: number }).toMatchObject(
        {
          archived: true,
          draftRevision: receipt.draftRevision + 1,
        },
      );
    }
    release();
    if (outcome === 'archived') {
      await expect(editor.getByRole('alert')).toContainText(
        'Курс больше недоступен для редактирования',
      );
      await expect(title).toHaveValue(laterTitle);
      await expect(summary).toHaveValue(laterSummary);
      await expect(save).toBeDisabled();
      await page.unroute(`**${path}`, delayResponse);
      const blockedMutationCount = courseMutations.length;
      await lessonForm.evaluate((element) => (element as HTMLFormElement).requestSubmit());
      await row
        .getByRole('button', { name: kind === 'lesson' ? /Действия урока/ : /Действия раздела/ })
        .click();
      await row.getByRole('button', { name: 'Дублировать', exact: true }).click();
      await checkLayout('unavailable');
      expect(lessonWrites).toHaveLength(writesBefore);
      expect(courseMutations).toHaveLength(blockedMutationCount);
      await discardAndReopen(null);
      await page.getByRole('button', { name: 'Архив', exact: true }).click();
      await expect(page.getByText(courseTitle, { exact: true })).toBeVisible();
      const listed = await page.request.get('/api/courses');
      expect(listed.ok()).toBe(true);
      const items = (
        (await listed.json()) as { items: Array<{ id: string; archivedAt: string | null }> }
      ).items;
      expect(items.find((course) => course.id === courseId)?.archivedAt).toBeTruthy();
      return;
    }
    if (outcome === 'lost') {
      await expect(editor.getByRole('alert')).toContainText(
        'Не удалось подтвердить изменение видимости',
      );
      await expect(title).toHaveValue(laterTitle);
      await expect(summary).toHaveValue(laterSummary);
      await expect(save).toBeDisabled();
      await lessonForm.evaluate((element) => (element as HTMLFormElement).requestSubmit());
      expect(lessonWrites).toHaveLength(writesBefore);
      await checkLayout('unconfirmed');
      await page.unroute(`**${path}`, delayResponse);
      await discardAndReopen(oldLesson.title);
      return;
    }
    await expect(
      editor.getByRole('status', { name: 'Уведомление курса', exact: true }),
    ).toContainText('Последние изменения урока ещё не сохранены');
    await expect(title).toHaveValue(laterTitle);
    await expect(summary).toHaveValue(laterSummary);
    await expect(save).toBeEnabled();
    await page.unroute(`**${path}`, delayResponse);
    if (kind === 'section' && hidden) await checkLayout('confirmed');
    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && new URL(response.url()).pathname === lessonPath,
    );
    await save.click();
    const saved = await saving;
    expect(saved.status()).toBe(outcome === 'conflict' ? 409 : 200);
    expect(lessonWrites).toHaveLength(writesBefore + 1);
    expect(lessonWrites.at(-1)).toMatchObject({
      title: laterTitle,
      summary: laterSummary,
      expectedRevision: receipt.draftRevision,
    });
    if (outcome === 'conflict') {
      const failure = (await saved.json()) as { error: { code: string; message: string } };
      expect(failure.error.code).toBe('draft_conflict');
      await expect(editor.getByRole('alert')).toContainText(failure.error.message);
      await expect(title).toHaveValue(laterTitle);
      await expect(summary).toHaveValue(laterSummary);
      expect(competingOutline).toBeDefined();
      const afterConflict = await readOutline();
      expect(afterConflict.draftRevision).toBe(competingOutline!.draftRevision);
      expect(afterConflict.sections).toEqual(competingOutline!.sections);
      await discardAndReopen('Чужие сохранённые правки C');
      return;
    }
    await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
      'Урок сохранён.',
    );
    const persisted = await readOutline();
    expect(persisted.sections).toHaveLength(1);
    expect(persisted.sections[0].lessons).toHaveLength(1);
    expect(persisted.sections[0].lessons[0]).toMatchObject({
      id: lessonId,
      title: laterTitle,
      summary: laterSummary,
    });
    expect(
      kind === 'lesson' ? persisted.sections[0].lessons[0].hidden : persisted.sections[0].hidden,
    ).toBe(hidden);
  }

  await changeVisibility('lesson', true);
  await changeVisibility('lesson', false);
  await changeVisibility('section', true);
  await changeVisibility('section', false);
  await changeVisibility('lesson', true, 'conflict');
  await changeVisibility('section', true, 'lost');
  const recovered = await readOutline();
  await title.fill('Урок после явного повторного открытия');
  const recoverySave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname === lessonPath,
  );
  await save.click();
  expect((await recoverySave).status()).toBe(200);
  expect(lessonWrites.at(-1)?.expectedRevision).toBe(recovered.draftRevision);
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок сохранён.',
  );
  await page.reload();
  await tabs.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .locator('.course-row-main')
    .filter({ hasText: courseTitle })
    .click();
  await expect(title).toHaveValue('Урок после явного повторного открытия');
  const final = await readOutline();
  expect(final.sections[0].hidden).toBe(true);
  expect(final.sections[0].lessons[0]).toMatchObject({
    id: lessonId,
    hidden: true,
    title: 'Урок после явного повторного открытия',
  });
  await changeVisibility('lesson', false, 'archived');
  expect(pageErrors).toEqual([]);
});

test('Course Builder duplicates a section and excludes hidden lesson only from future versions', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const material = 'Структурный Electronics материал ' + ++sequence;
  const courseTitle = 'Структурный курс ' + sequence;
  await createPublishedProjectActivity(page, material, 'electronics');

  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const editor = page.getByTestId('course-editor');
  await expect(editor).toBeVisible();

  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Структурная теория');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Материал исходной версии.');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок добавлен.',
  );
  await expect(editor.locator('.course-outline-section').first().locator('li')).toHaveCount(1);

  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await expect(editor.getByLabel('Название урока')).toHaveValue('');
  await openCourseLessonSettings(page);
  await editor.getByLabel('Тип урока').selectOption('assignment');
  await closeCourseLessonSettings(page);
  await selectCoursePractice(page, material);
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(editor.locator('.course-outline-section').first().locator('li')).toHaveCount(2);

  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();

  const v1Code = await createClassWithStudents(page, 'Структура курса V1 ' + sequence, [
    { label: 'Ученик V1', handle: 'course-structure-v1-' + sequence },
  ]);
  const oldLearner = await learnerAssignments(browser, v1Code, 'course-structure-v1-' + sequence);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v1' });
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();

  await oldLearner.page.reload();
  await oldLearner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Курсы', exact: true })
    .click();
  const oldCourses = oldLearner.page.getByTestId('seat-courses');
  await oldCourses.getByRole('button').filter({ hasText: courseTitle }).click();
  await expect(
    oldLearner.page
      .getByTestId('seat-course-player')
      .getByRole('heading', { name: 'Структурная теория', exact: true }),
  ).toBeVisible();
  await expect(
    oldLearner.page.getByText('Материал исходной версии.', { exact: true }),
  ).toBeVisible();
  const oldPlayer = oldLearner.page.getByTestId('seat-course-player');
  await expect(oldPlayer.getByRole('navigation', { name: 'Переход между уроками' })).toContainText(
    '1 из 2',
  );
  await expect(
    oldPlayer.getByRole('complementary', { name: 'Содержание курса' }).locator('li'),
  ).toHaveCount(2);

  await page.goto('/#/challenges');
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();

  const sourceSection = editor.locator('.course-outline-section').first();
  await sourceSection.getByRole('button', { name: /Действия раздела/ }).click();
  await sourceSection.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(editor.locator('.course-outline-section')).toHaveCount(2);
  const duplicateSection = editor.locator('.course-outline-section').nth(1);
  await expect(duplicateSection.locator('li')).toHaveCount(2);

  await duplicateSection
    .getByRole('button', { name: /Действия урока/ })
    .first()
    .click();
  await duplicateSection.getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(duplicateSection.locator('.course-lesson-link small').first()).toContainText(
    'Скрыт',
  );

  await page.reload();
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();
  const reloadedSections = editor.locator('.course-outline-section');
  await expect(reloadedSections).toHaveCount(2);
  await expect(reloadedSections.nth(1).locator('.course-lesson-link small').first()).toContainText(
    'Скрыт',
  );

  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  await expect(preview.getByText('Структурная теория', { exact: true })).toHaveCount(1);
  await expect(preview.getByText('Материал исходной версии.', { exact: true })).toHaveCount(1);
  await expect(preview.locator(':scope > section')).toHaveCount(2);
  await expect(preview.locator(':scope > section > ol > li')).toHaveCount(3);
  const pinnedPractices = preview.locator('.course-pinned-practice');
  await expect(pinnedPractices).toHaveCount(2);
  const visibleLessons = preview.locator(':scope > section > ol > li');
  await expect(visibleLessons.nth(0).locator('.course-pinned-practice')).toHaveCount(0);
  await expect(visibleLessons.nth(1).locator('.course-pinned-practice')).toHaveCount(1);
  await expect(visibleLessons.nth(2).locator('.course-pinned-practice')).toHaveCount(1);
  for (const practice of [pinnedPractices.nth(0), pinnedPractices.nth(1)]) {
    await expect(practice).toContainText(material);
    await expect(practice).toContainText('опубликованная версия 1');
    await expect(practice).toContainText('Электроника');
  }
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();

  await editor.getByRole('button', { name: /Опубликовать v2/ }).click();
  await expect(page.getByText('Курс опубликован: версия 2.', { exact: true })).toBeVisible();

  const v2Code = await createClassWithStudents(page, 'Структура курса V2 ' + sequence, [
    { label: 'Ученик V2', handle: 'course-structure-v2-' + sequence },
  ]);
  const newLearner = await learnerAssignments(browser, v2Code, 'course-structure-v2-' + sequence);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v2' });
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();

  await newLearner.page.reload();
  await newLearner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Курсы', exact: true })
    .click();
  const newCourses = newLearner.page.getByTestId('seat-courses');
  await newCourses.getByRole('button').filter({ hasText: courseTitle }).click();
  await expect(
    newLearner.page
      .getByTestId('seat-course-player')
      .getByRole('heading', { name: 'Структурная теория', exact: true }),
  ).toHaveCount(1);
  await expect(newLearner.page.getByText('Материал исходной версии.', { exact: true })).toHaveCount(
    1,
  );
  const newPlayer = newLearner.page.getByTestId('seat-course-player');
  await expect(newPlayer.getByRole('navigation', { name: 'Переход между уроками' })).toContainText(
    '1 из 3',
  );
  await expect(
    newPlayer.getByRole('complementary', { name: 'Содержание курса' }).locator('li'),
  ).toHaveCount(3);

  await oldLearner.page.reload();
  await oldLearner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Курсы', exact: true })
    .click();
  const oldCoursesAfterV2 = oldLearner.page.getByTestId('seat-courses');
  await oldCoursesAfterV2.getByRole('button').filter({ hasText: courseTitle }).click();
  await expect(
    oldLearner.page
      .getByTestId('seat-course-player')
      .getByRole('heading', { name: 'Структурная теория', exact: true }),
  ).toBeVisible();
  await expect(
    oldLearner.page.getByText('Материал исходной версии.', { exact: true }),
  ).toBeVisible();
  const oldPlayerAfterV2 = oldLearner.page.getByTestId('seat-course-player');
  await expect(
    oldPlayerAfterV2.getByRole('navigation', { name: 'Переход между уроками' }),
  ).toContainText('1 из 2');
  await expect(
    oldPlayerAfterV2.getByRole('complementary', { name: 'Содержание курса' }).locator('li'),
  ).toHaveCount(2);

  await oldLearner.context.close();
  await newLearner.context.close();
});

test('Course Builder persists informational block structural controls into future versions only', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const courseTitle = 'Блочная структура курса ' + ++sequence;
  await loginWithOrganization(page, teacher);
  await page.goto('/#/challenges');

  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();

  const editor = page.getByTestId('course-editor');
  await expect(editor).toBeVisible();
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Блочная теория');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Исходный A');
  await addCourseBlock(page, 'Текст');
  await editor.getByLabel('Текст блока', { exact: true }).nth(1).fill('Исходный B');
  await addCourseBlock(page, 'Текст');
  await editor.getByLabel('Текст блока', { exact: true }).nth(2).fill('Исходный C');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();

  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();

  const v1Code = await createClassWithStudents(page, 'Блоки V1 ' + sequence, [
    { label: 'Ученик блоков V1', handle: 'course-block-v1-' + sequence },
  ]);
  const oldLearner = await learnerAssignments(browser, v1Code, 'course-block-v1-' + sequence);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v1' });
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();

  await oldLearner.page.reload();
  await oldLearner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Курсы', exact: true })
    .click();
  await oldLearner.page
    .getByTestId('seat-courses')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  const oldPlayer = oldLearner.page.getByTestId('seat-course-player');
  await expect(oldPlayer.locator('.lesson-blocks').first().locator(':scope > *')).toHaveText([
    'Исходный A',
    'Исходный B',
    'Исходный C',
  ]);

  await page.goto('/#/challenges');
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();
  await openCourseStructure(page);
  await editor.locator('.course-lesson-link').first().click();

  const cards = editor.locator('.lesson-block-card');
  await expect(cards).toHaveCount(3);

  await openCourseBlockActions(page, 0);
  await cards.nth(0).getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(cards).toHaveCount(4);
  await cards.nth(1).getByLabel('Текст блока', { exact: true }).fill('Дубликат A');

  await openCourseBlockActions(page, 1);
  await cards.nth(1).getByRole('button', { name: 'Вставить ниже', exact: true }).click();
  await cards
    .nth(1)
    .locator('.lesson-block-insert-picker')
    .getByRole('button', { name: '+ Заголовок', exact: true })
    .click();
  await expect(cards).toHaveCount(5);
  await cards.nth(2).getByLabel('Текст заголовка', { exact: true }).fill('Вставленный заголовок');

  await openCourseBlockActions(page, 3);
  await cards.nth(3).getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(cards.nth(3)).toContainText('Скрыт');

  await openCourseBlockActions(page, 4);
  await cards.nth(4).getByRole('button', { name: 'Поднять блок 5', exact: true }).click();
  await expect(cards.nth(3).getByLabel('Текст блока', { exact: true })).toHaveValue('Исходный C');
  await expect(cards.nth(4)).toContainText('Скрыт');

  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  await expect(page.getByText('Урок сохранён.', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();
  await openCourseStructure(page);
  await editor.locator('.course-lesson-link').first().click();
  const reloadedCards = editor.locator('.lesson-block-card');
  await expect(reloadedCards).toHaveCount(5);
  await expect(reloadedCards.nth(0).getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Исходный A',
  );
  await expect(reloadedCards.nth(1).getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Дубликат A',
  );
  await expect(reloadedCards.nth(2).getByLabel('Текст заголовка', { exact: true })).toHaveValue(
    'Вставленный заголовок',
  );
  await expect(reloadedCards.nth(3).getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Исходный C',
  );
  await expect(reloadedCards.nth(4)).toContainText('Скрыт');

  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  await expect(preview.locator('.lesson-blocks').first().locator(':scope > *')).toHaveText([
    'Исходный A',
    'Дубликат A',
    'Вставленный заголовок',
    'Исходный C',
  ]);
  await expect(preview.getByText('Исходный B', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();

  await editor.getByRole('button', { name: /Опубликовать v2/ }).click();
  await expect(page.getByText('Курс опубликован: версия 2.', { exact: true })).toBeVisible();

  const v2Code = await createClassWithStudents(page, 'Блоки V2 ' + sequence, [
    { label: 'Ученик блоков V2', handle: 'course-block-v2-' + sequence },
  ]);
  const newLearner = await learnerAssignments(browser, v2Code, 'course-block-v2-' + sequence);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v2' });
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();

  await newLearner.page.reload();
  await newLearner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Курсы', exact: true })
    .click();
  await newLearner.page
    .getByTestId('seat-courses')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  const newPlayer = newLearner.page.getByTestId('seat-course-player');
  await expect(newPlayer.locator('.lesson-blocks').first().locator(':scope > *')).toHaveText([
    'Исходный A',
    'Дубликат A',
    'Вставленный заголовок',
    'Исходный C',
  ]);
  await expect(newPlayer.getByText('Исходный B', { exact: true })).toHaveCount(0);

  await oldLearner.page.reload();
  await oldLearner.page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Курсы', exact: true })
    .click();
  await oldLearner.page
    .getByTestId('seat-courses')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(
    oldLearner.page
      .getByTestId('seat-course-player')
      .locator('.lesson-blocks')
      .first()
      .locator(':scope > *'),
  ).toHaveText(['Исходный A', 'Исходный B', 'Исходный C']);

  await oldLearner.context.close();
  await newLearner.context.close();
});

for (const module of ['electronics', 'three-d'])
  test(`private authored course → approved Account → theory and real ${module} submission → exact review`, async ({
    browser,
    page,
  }) => {
    // The accepted Course journey continues through archive, teacher
    // correction, learner return, and the linked revision Start.
    test.setTimeout(240_000);
    const material = 'Электроника курса ' + ++sequence,
      courseTitle = 'Первый курс ' + sequence;
    await createPublishedProjectActivity(page, material, module);
    const manualTitle = `Account manual ${sequence}`;
    const manualImage = readFileSync('apps/web/public/landing/electronics-simulation.png');
    const manualPdf = Buffer.from('%PDF-1.4\nAccount exact material\n%%EOF');
    if (module === 'electronics') {
      await openNewAssignmentEditor(page);
      await openAssignmentSettings(page);
      await page
        .getByRole('dialog', { name: 'Настройки' })
        .getByLabel('Среда проекта')
        .selectOption('');
      await closeAssignmentSettings(page);
      await page.getByLabel('Название задания', { exact: true }).fill(manualTitle);
      await page.getByLabel('Содержание', { exact: true }).fill('Черновик материала для Account.');
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
      await expect(
        page.getByText('Черновик сохранён. Публикация — отдельное действие.'),
      ).toBeVisible();
      await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
      await page.getByLabel('Файл блока изображения').setInputFiles({
        name: 'account-manual.png',
        mimeType: 'image/png',
        buffer: manualImage,
      });
      await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
      await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
      await page.getByLabel('PDF файл задания').setInputFiles({
        name: 'account-manual.pdf',
        mimeType: 'application/pdf',
        buffer: manualPdf,
      });
      await expect(page.getByText('PDF добавлен в содержание задания.')).toBeVisible();
      await page.getByLabel('Содержание', { exact: true }).fill('Account читает точную версию.');
      const manualSave = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          /\/api\/learning\/activities\/[^/]+\/draft$/.test(new URL(response.url()).pathname),
      );
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      expect((await manualSave).ok()).toBe(true);
      await expect(
        page.getByText('Черновик сохранён. Публикация — отдельное действие.'),
      ).toBeVisible();
      await page.reload();
      await openExistingAssignmentEditor(page, manualTitle);
      await expect(page.getByLabel('Содержание', { exact: true })).toHaveValue(
        'Account читает точную версию.',
      );
      await expect(page.getByText('account-manual.pdf')).toBeVisible();
      await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
      await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
      const authored = await page.request.get('/api/learning/activities');
      expect(authored.ok()).toBe(true);
      expect(
        (await authored.json()).items.find((item: { title: string }) => item.title === manualTitle),
      ).toMatchObject({ kind: 'manual', currentPublishedVersionId: expect.any(String) });
    }
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Новый курс' });
    await form.getByLabel('Название', { exact: true }).fill(courseTitle);
    await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
    const editor = page.getByTestId('course-editor');
    await expect(editor).toBeVisible();
    await editor
      .locator('.course-outline')
      .getByRole('button', { name: '+ Урок', exact: true })
      .click();
    await editor.getByLabel('Название урока').fill('Знакомство с резистором');
    await editor
      .getByLabel('Текст блока', { exact: true })
      .fill('Резистор ограничивает ток. Затем соберите свою схему.');
    if (module === 'electronics') {
      await addCourseBlock(page, 'Материал из библиотеки');
      await editor.getByRole('button', { name: 'Выбрать материал', exact: true }).click();
      await editor.getByRole('button', { name: `Добавить материал «${manualTitle}»` }).click();
      await expect(editor.getByTestId('course-pinned-material')).toContainText(
        'Account читает точную версию.',
      );
    }
    await addCourseBlock(page, 'Код');
    await editor.getByLabel('Язык кода', { exact: true }).fill('javascript');
    await editor
      .getByLabel('Код', { exact: true })
      .fill(
        '<script>window.__courseInformationalBlockExecuted = true</script>\n  const current = voltage / resistance;',
      );
    await addCourseBlock(page, 'Формула');
    await editor.getByLabel('Формула', { exact: true }).fill('I = U / R');
    await addCourseBlock(page, 'Таблица');
    await editor.getByLabel('Ячейка 1:1', { exact: true }).fill('Элемент');
    await editor.getByRole('button', { name: '+ Столбец', exact: true }).click();
    await editor.getByLabel('Ячейка 1:2', { exact: true }).fill('Значение');
    await editor.getByRole('button', { name: '+ Строка', exact: true }).click();
    await editor.getByLabel('Ячейка 2:1', { exact: true }).fill('R1');
    await editor.getByLabel('Ячейка 2:2', { exact: true }).fill('220 Ω');
    await addCourseBlock(page, 'Разделитель');
    await editor.getByRole('button', { name: 'Курсы', exact: true }).click();
    await expect(
      editor.getByText(
        'Сначала сохраните изменения урока. Переход не выполнен, данные не потеряны.',
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(editor.getByLabel('Название урока')).toHaveValue('Знакомство с резистором');
    await editor.getByRole('button', { name: 'Добавить раздел', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /раздел/i })).toHaveCount(0);
    await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
    await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page
      .getByTestId('courses-list')
      .getByRole('button')
      .filter({ hasText: courseTitle })
      .click();
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Язык кода', { exact: true })).toHaveValue('javascript');
    await expect(editor.getByLabel('Код', { exact: true })).toHaveValue(
      '<script>window.__courseInformationalBlockExecuted = true</script>\n  const current = voltage / resistance;',
    );
    await expect(editor.getByLabel('Формула', { exact: true })).toHaveValue('I = U / R');
    await expect(editor.getByLabel('Ячейка 1:1', { exact: true })).toHaveValue('Элемент');
    await expect(editor.getByLabel('Ячейка 1:2', { exact: true })).toHaveValue('Значение');
    await expect(editor.getByLabel('Ячейка 2:1', { exact: true })).toHaveValue('R1');
    await expect(editor.getByLabel('Ячейка 2:2', { exact: true })).toHaveValue('220 Ω');
    await expect(editor.getByText('Разделитель', { exact: true })).toBeVisible();

    await page.evaluate(() => Reflect.deleteProperty(window, '__courseInformationalBlockExecuted'));
    await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
    const preview = page.getByTestId('course-preview-page');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.lesson-code-block')).toContainText(
      '<script>window.__courseInformationalBlockExecuted = true</script>',
    );
    await expect(preview.getByText('I = U / R', { exact: true })).toBeVisible();
    await expect(preview.getByText('220 Ω', { exact: true })).toBeVisible();
    await expect(preview.locator('hr.lesson-divider-block')).toHaveCount(1);
    expect(
      await page.evaluate(() => Reflect.has(window, '__courseInformationalBlockExecuted')),
    ).toBe(false);
    await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await editor
      .locator('.course-outline')
      .getByRole('button', { name: '+ Урок', exact: true })
      .click();
    await openCourseLessonSettings(page);
    await editor.getByLabel('Тип урока').selectOption('assignment');
    await closeCourseLessonSettings(page);
    await selectCoursePractice(page, material);
    await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
    await expect(editor.locator('.course-outline li')).toHaveCount(2);
    await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
    await editor.screenshot({ path: evidenceDir + '/course-authored-published.png' });
    const code = await createClassWithStudents(page, 'Account на курсе ' + module, []);
    const classUrl = page.url();
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Обучение', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Материалы класса' })
      .getByRole('button', { name: 'Курсы', exact: true })
      .click();
    await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v1' });
    await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();
    await expect(page.getByTestId('classroom-course-run')).toContainText(courseTitle);
    const learnerIdentity = await seedTeacher(admin, 'course01-account-browser');
    // Account-owned Learning Projects live in a personal workspace. The
    // organization-only seed has none; the Direct E1 journey tests that Start
    // is forbidden until this separate Account workspace exists.
    const learnerAccount = await admin.query(
      `SELECT account_id,principal_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
      [learnerIdentity.tenantId, learnerIdentity.teacherId],
    );
    const learnerAccountId = learnerAccount.rows[0].account_id as string;
    const learnerPrincipalId = learnerAccount.rows[0].principal_id as string;
    const personalTenant = await admin.query(
      `INSERT INTO tenants (workspace_slug,title)
       VALUES ($1,'Course learner personal') RETURNING id`,
      [`course-personal-${learnerAccountId.replaceAll('-', '')}`],
    );
    const personalTenantId = personalTenant.rows[0].id as string;
    await admin.query(
      `INSERT INTO tenant_placements (tenant_id,mode)
      VALUES ($1,'SHARED_CLUSTER')`,
      [personalTenantId],
    );
    const personalWorkspace = await admin.query(
      `INSERT INTO workspaces (tenant_id,kind,title)
       VALUES ($1,'personal','Course learner personal') RETURNING id`,
      [personalTenantId],
    );
    await admin.query(
      `INSERT INTO workspace_memberships (account_id,workspace_id,role)
       VALUES ($1,$2,'owner')`,
      [learnerAccountId, personalWorkspace.rows[0].id],
    );
    expect(
      (await admin.query('SELECT * FROM auth_personal_workspace($1)', [learnerAccountId])).rows,
    ).toEqual([
      {
        workspace_id: personalWorkspace.rows[0].id,
        tenant_id: personalTenantId,
        principal_id: learnerPrincipalId,
      },
    ]);
    const context = await browser.newContext(),
      learner = await context.newPage();
    await loginWithOrganization(learner, learnerIdentity);
    const organizationSession = await learner.request.get('/api/auth/me');
    expect(organizationSession.status()).toBe(200);
    const organizationWorkspaceId = (await organizationSession.json()).activeWorkspace
      .workspaceId as string;
    if (module === 'electronics') {
      await switchAccountWorkspace(learner, personalWorkspace.rows[0].id as string);
      const ordinary = await learner.request.post('/api/projects', {
        headers: {
          origin: new URL(learner.url()).origin,
          'idempotency-key': `v3-ordinary-${crypto.randomUUID()}`,
        },
        data: {
          scope: 'personal',
          classroomId: null,
          module: 'electronics',
          title: 'Обычный личный проект',
        },
      });
      expect(ordinary.status()).toBe(201);
      await learner.goto('/#/projects');
      const ordinaryCard = learner.getByTestId('project-card').filter({
        hasText: 'Обычный личный проект',
      });
      await expect(ordinaryCard).toBeVisible();
      await expect(ordinaryCard.getByText('Учебная работа')).toHaveCount(0);
      await learner.screenshot({
        path: `${evidenceDir}/v3-my-projects-before-start-desktop.png`,
        fullPage: true,
      });
      await switchAccountWorkspace(learner, organizationWorkspaceId);
    }
    await learner.goto('/#/attending');
    await learner.getByLabel('Код класса', { exact: true }).fill(code);
    await learner.getByRole('button', { name: 'Войти в класс', exact: true }).click();
    await expect(learner.getByText(/Заявка в класс.*отправлена/)).toBeVisible();
    await learner.goto('/#/learning');
    await learner
      .getByRole('navigation', { name: 'Разделы моего обучения' })
      .getByRole('link', { name: 'Курсы', exact: true })
      .click();
    await expect(learner.getByTestId('seat-courses')).toHaveCount(0);
    await page.goto(classUrl);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Заявки', exact: true })
      .click();
    await page.getByRole('button', { name: 'Обновить заявки', exact: true }).click();
    await page.getByRole('button', { name: 'Принять заявку', exact: true }).click();
    await expect(page.locator('.learning-join-requests')).toContainText('Принята');
    await learner.reload();
    await learner.evaluate(() =>
      Reflect.deleteProperty(window, '__courseInformationalBlockExecuted'),
    );
    await learner
      .getByTestId('seat-courses')
      .getByRole('button')
      .filter({ hasText: courseTitle })
      .click();
    if (module === 'electronics') {
      const manualCard = learner.getByTestId('seat-course-manual-material');
      await expect(manualCard).toContainText('Account читает точную версию.');
      await expect(manualCard.getByRole('button', { name: /Начать|Отправить/ })).toHaveCount(0);
      const imageSrc = await manualCard
        .getByRole('img', { name: 'Изображение задания' })
        .getAttribute('src');
      expect(imageSrc).toContain('/api/class-join/course-runs/');
      const image = await learner.request.get(imageSrc!);
      expect(image.ok()).toBe(true);
      expect(Buffer.compare(await image.body(), manualImage)).toBe(0);
      const base = imageSrc!.replace(/\/image\/[0-9a-f]{64}$/, '');
      const projection = await learner.request.get(base);
      expect(projection.ok()).toBe(true);
      const payload = await projection.json();
      expect(payload.source).toMatchObject({ kind: 'published', versionNumber: 1 });
      const fileSrc = payload.blocks.find((block: { type: string }) => block.type === 'file')
        .src as string;
      const pdf = await learner.request.get(fileSrc);
      expect(pdf.ok()).toBe(true);
      expect(Buffer.compare(await pdf.body(), manualPdf)).toBe(0);
      const manualImageV2 = readFileSync('apps/web/public/landing/assignment-progress.png');
      const manualPdfV2 = Buffer.from('%PDF-1.4\nAccount newer material media\n%%EOF');
      expect(Buffer.compare(manualImageV2, manualImage)).not.toBe(0);
      expect(Buffer.compare(manualPdfV2, manualPdf)).not.toBe(0);
      const newer = await republishManualWithDifferentMedia(
        page,
        manualTitle,
        'Account читает вторую версию.',
        manualImageV2,
        manualPdfV2,
      );
      expect(imageSrc).not.toContain(newer.imageHash);
      expect(fileSrc).not.toContain(newer.fileHash);
      await learner.reload();
      await learner
        .getByTestId('seat-courses')
        .getByRole('button')
        .filter({ hasText: courseTitle })
        .click();
      await expect(manualCard).toContainText('Account читает точную версию.');
      const pinned = await learner.request.get(base);
      expect(pinned.ok()).toBe(true);
      expect(await pinned.json()).toMatchObject(payload);
      const oldImage = await learner.request.get(imageSrc!);
      const oldPdf = await learner.request.get(fileSrc);
      expect(Buffer.compare(await oldImage.body(), manualImage)).toBe(0);
      expect(Buffer.compare(await oldPdf.body(), manualPdf)).toBe(0);
      expect((await learner.request.get(`${base}/image/${newer.imageHash}`)).status()).toBe(404);
      expect((await learner.request.get(`${base}/file/${newer.fileHash}`)).status()).toBe(404);
    }
    await expect(
      learner.getByText('Резистор ограничивает ток. Затем соберите свою схему.', { exact: true }),
    ).toBeVisible();
    await expect(learner.locator('.lesson-code-block')).toContainText(
      '<script>window.__courseInformationalBlockExecuted = true</script>',
    );
    await expect(learner.getByText('I = U / R', { exact: true })).toBeVisible();
    await expect(learner.getByText('220 Ω', { exact: true })).toBeVisible();
    await expect(learner.locator('hr.lesson-divider-block')).toHaveCount(1);
    expect(
      await learner.evaluate(() => Reflect.has(window, '__courseInformationalBlockExecuted')),
    ).toBe(false);
    await learner.getByRole('button', { name: 'Отметить пройденным', exact: true }).click();
    await expect(
      learner.getByRole('button', { name: 'Отметить непройденным', exact: true }),
    ).toBeVisible();
    await learner.getByRole('button', { name: 'Далее →', exact: true }).click();
    const startLesson = learner.getByRole('button', { name: 'Начать задание', exact: true });
    await expect(learner.getByTestId('seat-course-player')).toContainText(courseTitle);
    await expect(startLesson).toBeEnabled();
    for (const viewport of [
      { width: 1440, height: 900, label: 'desktop' },
      { width: 1024, height: 768, label: '1024' },
      { width: 390, height: 844, label: 'mobile' },
      { width: 320, height: 720, label: '320' },
    ]) {
      await learner.setViewportSize(viewport);
      await expect(startLesson).toBeVisible();
      expect(
        await learner.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await learner.screenshot({
        path: `${evidenceDir}/account-course-${module}-start-${viewport.label}.png`,
        fullPage: true,
      });
    }
    await learner.setViewportSize({ width: 1440, height: 900 });
    await startLesson.click();
    await expect(learner).toHaveURL(
      module === 'three-d'
        ? /#\/3d\/[^?]+/
        : /\/projects\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/electronics\/edit\/?(?:\?returnTo=%23%2Flearning)?$/i,
      { timeout: 60_000 },
    );
    const startedProjectId = courseActivityProjectId(learner, module);
    const assignmentAnchor = learner.getByTestId('assignment-brief-anchor');
    await expect(assignmentAnchor).toBeVisible({ timeout: 60_000 });
    if ((await assignmentAnchor.getAttribute('aria-expanded')) !== 'true') {
      await assignmentAnchor.click();
    }
    await expect(learner.getByTestId('assignment-brief')).toContainText(material);
    if (module === 'three-d') {
      await expect(learner.getByTestId('asa3d-viewport')).toHaveAttribute(
        'data-runtime-ready',
        'true',
      );
    } else {
      await expect(learner.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible();
    }
    expect(startedProjectId).not.toBe('');
    await learner.screenshot({
      path: `${evidenceDir}/account-course-${module}-started-project.png`,
      fullPage: true,
    });
    if (module === 'electronics') {
      const editorUrl = learner.url();
      await switchAccountWorkspace(learner, personalWorkspace.rows[0].id as string);
      await learner.goto('/#/projects');
      const learningCard = learner.getByTestId('project-card').filter({
        has: learner.locator(`a[href*="${startedProjectId}"]`),
      });
      const ordinaryCard = learner.getByTestId('project-card').filter({
        hasText: 'Обычный личный проект',
      });
      await expect(learningCard).toBeVisible();
      await expect(learningCard.getByText('Учебная работа', { exact: true })).toBeVisible();
      await expect(learningCard.getByText('В работе', { exact: true })).toBeVisible();
      await expect(learningCard.getByRole('link', { name: 'Продолжить' })).toBeVisible();
      await learningCard.hover();
      await learningCard.locator('details > summary').click();
      for (const action of ['Архивировать', 'В корзину', 'Дублировать', 'Свойства']) {
        await expect(learningCard.getByRole('button', { name: action, exact: true })).toHaveCount(
          0,
        );
      }
      await expect(learningCard).toContainText('Приватный');
      await expect(ordinaryCard).toBeVisible();
      await expect(ordinaryCard.getByText('Учебная работа')).toHaveCount(0);
      await learner.getByRole('button', { name: 'Учебные', exact: true }).click();
      await expect(learningCard).toBeVisible();
      await expect(ordinaryCard).toHaveCount(0);
      await learner.getByRole('button', { name: 'Личные', exact: true }).click();
      await expect(ordinaryCard).toBeVisible();
      await expect(learningCard).toHaveCount(0);
      await learner.getByRole('button', { name: 'Все', exact: true }).first().click();
      await expect(learningCard).toBeVisible();
      await expect(ordinaryCard).toBeVisible();
      for (const viewport of [
        { width: 1440, height: 900, label: 'desktop' },
        { width: 390, height: 844, label: 'mobile' },
      ]) {
        await learner.setViewportSize(viewport);
        await expect(learningCard).toBeVisible();
        await expect(ordinaryCard).toBeVisible();
        await expect(learningCard.getByRole('link', { name: 'Продолжить' })).toBeVisible();
        await learner.screenshot({
          path: `${evidenceDir}/v3-my-projects-after-start-${viewport.label}.png`,
          fullPage: true,
        });
        await learner.screenshot({
          path: `${evidenceDir}/a5b-${module}-active-${viewport.label}.png`,
          fullPage: true,
        });
      }
      await learner.setViewportSize({ width: 1440, height: 900 });
      await switchAccountWorkspace(learner, organizationWorkspaceId);
      await learner.goto(editorUrl);
      await expect(learner.getByTestId('assignment-brief-anchor')).toBeVisible();
    }
    await editRealProject(learner, module);
    const brief = learner.getByTestId('assignment-brief');
    await expect(
      brief.getByRole('button', { name: 'Отправить на проверку', exact: true }),
    ).toBeEnabled();
    await brief.getByRole('button', { name: 'Отправить на проверку', exact: true }).click();
    await expect(
      brief.locator('.assignment-brief-footer').getByText('На проверке', { exact: true }),
    ).toBeVisible();
    await learner.screenshot({
      path: evidenceDir + '/account-course-' + module + '-submitted.png',
    });
    await switchAccountWorkspace(learner, personalWorkspace.rows[0].id as string);
    await learner.goto('/#/projects?kind=learning');
    const submittedCard = learner.getByTestId('project-card').filter({
      has: learner.locator(`a[href*="${startedProjectId}"]`),
    });
    await expect(submittedCard.getByText('Сдано, ждёт проверки', { exact: true })).toBeVisible();
    await expect(submittedCard.getByRole('link', { name: 'Посмотреть' })).toBeVisible();
    await expect(submittedCard.getByRole('button', { name: 'Убрать из активных' })).toHaveCount(0);
    for (const viewport of [
      { width: 1440, height: 900, label: 'desktop' },
      { width: 390, height: 844, label: 'mobile' },
    ]) {
      await learner.setViewportSize(viewport);
      await learner.screenshot({
        path: `${evidenceDir}/a5b-${module}-submitted-${viewport.label}.png`,
        fullPage: true,
      });
    }
    await learner.setViewportSize({ width: 1440, height: 900 });
    await switchAccountWorkspace(learner, organizationWorkspaceId);
    // Notifications live in Account settings; keep the exact submitted-work link proof.
    await page.goto('/#/account');
    await page
      .getByLabel('Разделы настроек')
      .getByRole('button', { name: 'Уведомления', exact: true })
      .click();
    const inbox = page.getByRole('region', { name: 'События уведомлений', exact: true });
    const event = inbox
      .locator('li')
      .filter({ hasText: 'Работа сдана' })
      .filter({ hasText: material });
    await expect(event).toBeVisible({ timeout: 30000 });
    await event.getByRole('link', { name: 'Открыть' }).click();
    const detail = page.getByRole('region', { name: 'Проверка сдачи' });
    await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
    await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
    await expect(detail.getByText('Ревизия 1 · Принято', { exact: true })).toBeVisible();
    await learner.goto('/#/learning');
    await learner
      .getByRole('navigation', { name: 'Разделы моего обучения' })
      .getByRole('link', { name: 'Курсы', exact: true })
      .click();
    await expect(
      learner.getByTestId('seat-courses').locator('li').filter({ hasText: courseTitle }),
    ).toContainText('Пройдено 2 из 2');
    await learner.screenshot({
      path: evidenceDir + '/account-course-' + module + '-completed.png',
    });
    await switchAccountWorkspace(learner, personalWorkspace.rows[0].id as string);
    await learner.goto('/#/projects?kind=learning');
    await learner.getByRole('button', { name: 'Выполненные', exact: true }).click();
    const completedCard = learner.getByTestId('project-card').filter({
      has: learner.locator(`a[href*="${startedProjectId}"]`),
    });
    await expect(completedCard.getByText('Выполнено', { exact: true })).toBeVisible();
    await expect(completedCard.getByRole('link', { name: 'Посмотреть' })).toBeVisible();
    await expect(completedCard.getByRole('button', { name: 'Убрать из активных' })).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 900, label: 'desktop' },
      { width: 390, height: 844, label: 'mobile' },
    ]) {
      await learner.setViewportSize(viewport);
      await learner.screenshot({
        path: `${evidenceDir}/a5b-${module}-completed-${viewport.label}.png`,
        fullPage: true,
      });
    }
    await learner.setViewportSize({ width: 1440, height: 900 });
    await completedCard.getByRole('button', { name: 'Убрать из активных' }).click();
    await expect(completedCard).toHaveCount(0);
    await learner.getByRole('button', { name: 'Архив', exact: true }).click();
    const archivedCard = learner.getByTestId('project-card').filter({
      has: learner.locator(`a[href*="${startedProjectId}"]`),
    });
    await expect(archivedCard.getByText('В учебном архиве', { exact: true })).toBeVisible();
    await expect(archivedCard.getByRole('button', { name: 'Вернуть в активные' })).toBeVisible();
    for (const viewport of [
      { width: 1440, height: 900, label: 'desktop' },
      { width: 390, height: 844, label: 'mobile' },
    ]) {
      await learner.setViewportSize(viewport);
      await expect(archivedCard).toBeVisible();
      await learner.screenshot({
        path: `${evidenceDir}/a5c-${module}-archive-${viewport.label}.png`,
        fullPage: true,
      });
    }
    await learner.setViewportSize({ width: 1440, height: 900 });
    if (module === 'electronics') {
      const originalSubmission = (
        await admin.query(
          `SELECT submission.id,submission.project_version_id,result.id AS result_id
             FROM learning_project_origins origin
             JOIN learning_attempts attempt ON attempt.activity_participation_id=origin.participation_id
             JOIN learning_submissions submission ON submission.attempt_id=attempt.id
             JOIN assessment_results result ON result.attempt_id=attempt.id
            WHERE origin.project_id=$1 AND result.revision_number=1`,
          [startedProjectId],
        )
      ).rows[0];
      const correctionAction = detail.getByRole('button', { name: 'Вернуть на доработку' });
      await expect(correctionAction).toBeVisible();
      await detail.getByLabel('Причина возврата или исправления').fill('Уточнить измерение');
      await page.setViewportSize({ width: 390, height: 844 });
      await correctionAction.scrollIntoViewIfNeeded();
      await expect(correctionAction).toBeInViewport();
      await page.screenshot({
        path: `${evidenceDir}/a5-v4-teacher-correction-mobile.png`,
        fullPage: false,
      });
      await correctionAction.click();
      const returnedRevision = detail.getByText('Ревизия 2 · На доработке', {
        exact: true,
      });
      await expect(returnedRevision).toBeVisible();
      await returnedRevision.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${evidenceDir}/a5-v4-teacher-returned-mobile.png`,
        fullPage: false,
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await returnedRevision.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${evidenceDir}/a5-v4-teacher-returned.png`,
        fullPage: false,
      });

      await learner.reload();
      await expect(archivedCard).toHaveCount(0);
      await learner.getByRole('button', { name: 'Активные', exact: true }).click();
      const returnedCard = learner.getByTestId('project-card').filter({
        has: learner.locator(`a[href*="${startedProjectId}"]`),
      });
      await expect(returnedCard.getByText('Требуется доработка', { exact: true })).toBeVisible();
      await expect(returnedCard.getByRole('link', { name: 'Продолжить' })).toBeVisible();
      for (const viewport of [
        { width: 1440, height: 900, label: 'desktop' },
        { width: 390, height: 844, label: 'mobile' },
      ]) {
        await learner.setViewportSize(viewport);
        await expect(returnedCard).toBeVisible();
        await learner.screenshot({
          path: `${evidenceDir}/a5-v4-returned-${viewport.label}.png`,
          fullPage: true,
        });
      }
      await learner.setViewportSize({ width: 1440, height: 900 });
      await switchAccountWorkspace(learner, organizationWorkspaceId);
      await learner.goto('/#/learning');
      await learner
        .getByRole('navigation', { name: 'Разделы моего обучения' })
        .getByRole('link', { name: 'Курсы', exact: true })
        .click();
      await learner
        .getByTestId('seat-courses')
        .getByRole('button')
        .filter({ hasText: courseTitle })
        .click();
      await expect(learner.getByRole('button', { name: 'Начать доработку' })).toBeVisible();
      await learner.screenshot({
        path: `${evidenceDir}/a5-v4-learning-hub-returned.png`,
        fullPage: true,
      });
      await learner.getByRole('button', { name: 'Начать доработку' }).click();
      await expect(learner).toHaveURL(new RegExp(startedProjectId, 'i'));
      const returnedBrief = learner.getByTestId('assignment-brief');
      const returnedAnchor = learner.getByTestId('assignment-brief-anchor');
      await expect(returnedAnchor).toBeVisible();
      if ((await returnedAnchor.getAttribute('aria-expanded')) !== 'true') {
        await returnedAnchor.click();
      }
      await expect(
        returnedBrief.getByRole('button', { name: 'Продолжить', exact: true }),
      ).toBeVisible();
      await learner.screenshot({
        path: `${evidenceDir}/a5-v4-editor-returned.png`,
        fullPage: true,
      });
      const resumedStart = learner.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/learning\/work\/runs\/[^/]+\/start$/.test(response.url()),
      );
      await returnedBrief.getByRole('button', { name: 'Продолжить', exact: true }).click();
      const resumedResponse = await resumedStart;
      expect(resumedResponse.status()).toBe(200);
      expect(await resumedResponse.json()).toMatchObject({
        projectId: startedProjectId,
        attemptNumber: 2,
        state: 'in_progress',
        reused: false,
      });
      await expect(
        returnedBrief.getByRole('button', { name: 'Продолжить', exact: true }),
      ).toHaveCount(0);
      const history = await admin.query(
        `SELECT (SELECT count(*)::int FROM learning_project_origins WHERE project_id=$1) AS origins,
                (SELECT count(*)::int FROM learning_attempts attempt
                   JOIN learning_project_origins origin
                     ON origin.participation_id=attempt.activity_participation_id
                  WHERE origin.project_id=$1) AS attempts,
                (SELECT project_version_id FROM learning_submissions WHERE id=$2) AS frozen_version,
                (SELECT review_decision FROM assessment_results WHERE id=$3) AS prior_decision`,
        [startedProjectId, originalSubmission.id, originalSubmission.result_id],
      );
      expect(history.rows[0]).toMatchObject({
        origins: 1,
        attempts: 2,
        frozen_version: originalSubmission.project_version_id,
        prior_decision: 'accepted',
      });
    } else {
      await archivedCard.getByRole('button', { name: 'Вернуть в активные' }).click();
      await expect(archivedCard).toHaveCount(0);
      await learner.getByRole('button', { name: 'Выполненные', exact: true }).click();
      await expect(completedCard).toBeVisible();
    }
    await context.close();
  });

test('Course Activity blocks preserve mixed order and open exact Electronics and 3D runtimes', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const suffix = ++sequence;
  const electronicsTitle = `D5 Electronics Activity ${suffix}`;
  const threeDTitle = `D5 3D Activity ${suffix}`;
  const courseTitle = `D5 Activity blocks ${suffix}`;
  const manualTitle = `D5 Manual material ${suffix}`;
  const manualImage = readFileSync('apps/web/public/landing/electronics-simulation.png');
  const manualPdf = Buffer.from('%PDF-1.4\nD5 exact manual PDF\n%%EOF');
  const electronicsSample = readFileSync('apps/web/public/landing/electronics-simulation.png');
  const threeDSample = readFileSync('apps/web/public/landing/assignment-progress.png');
  const electronicsGoal = 'Собрать и проверить цепь';
  const threeDGoal = 'Построить объёмную модель';

  const d5Teacher = await seedTeacher(admin, 'learning-course01-d5');
  await loginWithOrganization(page, d5Teacher);
  const classTitle = 'D5 Activity class ' + suffix;
  const joinCode = await createClassWithStudents(page, classTitle, [
    { label: 'D5 learner', handle: 'd5-activity-' + suffix },
  ]);
  const classroomId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;
  const secondClassTitle = classTitle + ' · второй';
  await createClassWithStudents(page, secondClassTitle, [
    { label: 'D5 second class learner', handle: 'd5-second-class-' + suffix },
  ]);
  const secondClassroomId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;

  await createPublishedProjectActivityAfterLogin(
    page,
    electronicsTitle,
    'electronics',
    'completion',
    electronicsSample,
    electronicsGoal,
  );
  await createPublishedProjectActivityAfterLogin(
    page,
    threeDTitle,
    'three-d',
    'completion',
    threeDSample,
    threeDGoal,
  );

  await openNewAssignmentEditor(page);
  await openAssignmentSettings(page);
  await page
    .getByRole('dialog', { name: 'Настройки' })
    .getByLabel('Среда проекта')
    .selectOption('');
  await closeAssignmentSettings(page);
  await page.getByLabel('Название задания', { exact: true }).fill(manualTitle);
  await page.getByLabel('Содержание', { exact: true }).fill('Черновик материала перед 3D.');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('Файл блока изображения').setInputFiles({
    name: 'manual.png',
    mimeType: 'image/png',
    buffer: manualImage,
  });
  await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('PDF файл задания').setInputFiles({
    name: 'manual.pdf',
    mimeType: 'application/pdf',
    buffer: manualPdf,
  });
  await expect(page.getByText('PDF добавлен в содержание задания.')).toBeVisible();
  await page.getByLabel('Содержание', { exact: true }).fill('Прочитайте материал перед 3D.');
  const manualSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/api\/learning\/activities\/[^/]+\/draft$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await manualSave).ok()).toBe(true);
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page.reload();
  await openExistingAssignmentEditor(page, manualTitle);
  await expect(page.getByLabel('Содержание', { exact: true })).toHaveValue(
    'Прочитайте материал перед 3D.',
  );
  await expect(page.getByText('manual.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  const authoredManual = await page.request.get('/api/learning/activities');
  expect(authoredManual.ok()).toBe(true);
  expect(
    (await authoredManual.json()).items.find(
      (item: { title: string }) => item.title === manualTitle,
    ),
  ).toMatchObject({ kind: 'manual', currentPublishedVersionId: expect.any(String) });

  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();

  const editor = page.getByTestId('course-editor');
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Смешанная практика');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Перед Electronics');

  await addCourseBlock(page, 'Практика');
  await selectCoursePractice(page, electronicsTitle);

  await addCourseBlock(page, 'Врезка');
  await editor.getByLabel('Текст врезки', { exact: true }).fill('Между двумя практиками');

  await addCourseBlock(page, 'Материал из библиотеки');
  await editor.getByRole('button', { name: 'Выбрать материал', exact: true }).click();
  await editor.getByRole('button', { name: `Добавить материал «${manualTitle}»` }).click();
  await expect(editor.getByTestId('course-pinned-material')).toContainText(
    'Прочитайте материал перед 3D.',
  );

  await addCourseBlock(page, 'Практика');
  await selectCoursePractice(page, threeDTitle, 1);

  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();

  await editor.getByRole('button', { name: 'Курсы', exact: true }).click();
  const courseRow = page
    .getByTestId('courses-list')
    .locator('.course-row-main')
    .filter({ hasText: courseTitle });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(courseRow).toBeVisible();
    for (const name of ['Активные', 'Архив', 'Добавить демо-курс', 'Создать курс']) {
      const action = page
        .locator('.courses-toolbar-actions')
        .getByRole('button', { name, exact: true });
      await expect(action).toBeVisible();
      const bounds = await action.boundingBox();
      expect(bounds, `${name} at ${width}px`).not.toBeNull();
      expect(bounds!.x, `${name} left at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, `${name} right at ${width}px`).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${evidenceDir}/course-authoring-list-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Create a real forward Settings entry before the dirty course guard probes.
  await openAccountSettings(page);
  await expect(page.locator('.account-settings-page')).toBeVisible();
  await page.evaluate(() => window.history.back());
  await page
    .getByRole('navigation', { name: 'Разделы курсов и заданий', exact: true })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await expect(page.getByTestId('courses-list')).toBeVisible();
  await courseRow.click();
  await expect(editor.getByLabel('Название урока')).toHaveValue('Смешанная практика');
  await expect(editor.locator('.course-pinned-practice').nth(0)).toContainText(electronicsTitle);
  await expect(editor.locator('.course-pinned-practice').nth(1)).toContainText(threeDTitle);
  await editor.getByLabel('Название урока').fill('Несохранённый курс');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('navigation', { name: 'Разделы ASA Lab' })
    .getByRole('link', { name: 'Знания', exact: true })
    .click();
  await expect(editor.getByLabel('Название урока')).toHaveValue('Несохранённый курс');
  await openCourseActions(page);
  await expect(editor.getByRole('button', { name: 'Назначить курс', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Действия курса', exact: true }).press('Escape');
  const portalHistory = () =>
    page.evaluate(() => {
      type Entry = { key: string; index: number; url: string };
      const browser = window as Window & {
        navigation?: { currentEntry?: Entry; entries: () => Entry[] };
      };
      const current = browser.navigation?.currentEntry;
      const index: number | null = current?.index ?? history.state?.asaRouteIndex ?? null;
      const adjacent = (direction: -1 | 1) => {
        const target = browser.navigation
          ?.entries()
          .find((item) => item.index === index! + direction);
        return {
          key: target?.key ?? null,
          index: target?.index ?? (index === null ? null : index + direction),
          href: target?.url ?? null,
        };
      };
      return {
        href: location.href,
        state: history.state,
        length: history.length,
        entry: { key: current?.key ?? null, index },
        previous: adjacent(-1),
        next: adjacent(1),
      };
    });
  const denyPortalExit = async (action: () => Promise<unknown>, direction?: -1 | 1) => {
    const entry = await portalHistory();
    if (direction !== undefined) {
      expect(
        entry.entry.index,
        'The accepted entry has an authoritative history index',
      ).not.toBeNull();
      const target = direction === -1 ? entry.previous : entry.next;
      expect(target.index).toBe(entry.entry.index! + direction);
      if (entry.entry.key !== null) {
        expect(target.key).not.toBeNull();
        expect(target.key).not.toBe(entry.entry.key);
        expect(target.href).not.toBeNull();
      }
    }
    let prompts = 0;
    const dismiss = async (dialog: import('@playwright/test').Dialog) => {
      prompts++;
      expect(page.url()).toBe(entry.href);
      await dialog.dismiss();
    };
    page.on('dialog', dismiss);
    try {
      await action();
      await expect.poll(() => prompts).toBe(1);
      await expect(page).toHaveURL(entry.href);
      expect(await portalHistory()).toEqual(entry);
      await expect(editor).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    } finally {
      page.off('dialog', dismiss);
    }
  };
  const sameRouteEntry = await portalHistory();
  let sameRoutePrompts = 0;
  const dismissUnexpected = async (dialog: import('@playwright/test').Dialog) => {
    sameRoutePrompts++;
    await dialog.dismiss();
  };
  page.on('dialog', dismissUnexpected);
  try {
    await openPortalSection(page, 'Курсы и задания');
    expect(sameRoutePrompts).toBe(0);
    expect(await portalHistory()).toEqual(sameRouteEntry);
    await expect(editor.getByLabel('Название урока')).toHaveValue('Несохранённый курс');
  } finally {
    page.off('dialog', dismissUnexpected);
  }
  await denyPortalExit(() => openAccountSettings(page));
  await denyPortalExit(() => page.evaluate(() => window.history.back()), -1);
  await denyPortalExit(() => page.evaluate(() => window.history.forward()), 1);
  await expect(editor.getByLabel('Название урока')).toHaveValue('Несохранённый курс');
  const acceptedCourseEntry = await portalHistory();
  page.once('dialog', (dialog) => dialog.accept());
  await openAccountSettings(page);
  await expect(page.locator('.account-settings-page')).toBeVisible();
  expect((await portalHistory()).entry.index).toBe(acceptedCourseEntry.entry.index! + 1);
  await page.evaluate(() => window.history.back());
  await page
    .getByRole('navigation', { name: 'Разделы курсов и заданий', exact: true })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await expect(page.getByTestId('courses-list')).toBeVisible();
  await courseRow.click();
  await expect(editor.getByLabel('Название урока')).toHaveValue('Смешанная практика');
  await editor.getByLabel('Название урока').fill('Смешанная практика');
  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  await expect(page.getByText('Урок сохранён.', { exact: true })).toBeVisible();
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const courseHeading = editor
      .locator('.course-compact-title')
      .getByRole('heading', { name: courseTitle, exact: true });
    await expect(courseHeading).toBeVisible();
    const titleGeometry = await courseHeading.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        text: Array.from(range.getClientRects(), (rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
        })),
      };
    });
    expect(titleGeometry.left, `Course title left at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(titleGeometry.right, `Course title right at ${width}px`).toBeLessThanOrEqual(width);
    expect(titleGeometry.text.length, `Rendered course title at ${width}px`).toBeGreaterThan(0);
    for (const rect of titleGeometry.text) {
      expect(rect.width, `Visible course title text at ${width}px`).toBeGreaterThan(0);
      expect(rect.left).toBeGreaterThanOrEqual(titleGeometry.left - 1);
      expect(rect.right).toBeLessThanOrEqual(titleGeometry.right + 1);
      expect(rect.top).toBeGreaterThanOrEqual(titleGeometry.top - 1);
      expect(rect.bottom).toBeLessThanOrEqual(titleGeometry.bottom + 1);
    }
    for (const [index, title, expectedGoal] of [
      [0, electronicsTitle, electronicsGoal],
      [1, threeDTitle, threeDGoal],
    ] as const) {
      const picker = editor.locator('.course-practice-picker').nth(index);
      const practice = picker.locator('.course-pinned-practice');
      const goal = practice.locator('.assignment-goal > span:last-child');
      const instructions = practice.getByText(
        'Соберите цепь, сохраните проект и сдайте точную редакцию.',
        { exact: true },
      );
      const sample = practice.getByRole('img', { name: `Образец: ${title}`, exact: true });
      const replace = picker.getByRole('button', { name: 'Заменить практику', exact: true });
      await expect(goal).toHaveText(expectedGoal);
      await expect(practice.locator('small')).toContainText('опубликованная версия 1');
      for (const [text, maxLines] of [
        [goal, 3],
        [instructions, 5],
      ] as const) {
        await expect(text).toBeVisible();
        const lines = await text.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
        });
        expect(lines, `Readable ${title} at ${width}px`).toBeGreaterThan(0);
        expect(lines, `Readable ${title} at ${width}px`).toBeLessThanOrEqual(maxLines);
      }
      const pickerBounds = await picker.boundingBox();
      expect(pickerBounds).not.toBeNull();
      for (const content of [goal, instructions, sample, replace]) {
        await expect(content).toBeVisible();
        const bounds = await content.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(pickerBounds!.x);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
          pickerBounds!.x + pickerBounds!.width,
        );
      }
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${evidenceDir}/course-authoring-editor-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const liveCourseTitle = await editor.getByLabel('Название урока').elementHandle();
  const savedCourseTitle = await editor.getByLabel('Название урока').inputValue();
  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  const previewBlocks = preview.locator('.lesson-blocks').first().locator(':scope > *');
  await expect(previewBlocks).toHaveCount(5);
  await expect(previewBlocks.nth(0)).toContainText('Перед Electronics');
  await expect(previewBlocks.nth(1)).toContainText(electronicsTitle);
  await expect(previewBlocks.nth(2)).toContainText('Между двумя практиками');
  await expect(previewBlocks.nth(3)).toContainText(manualTitle);
  await expect(previewBlocks.nth(4)).toContainText(threeDTitle);
  // Both canonical image renderers portal outside the preview surface. Their
  // close controls must remain reachable, and Escape must not close the course.
  const sample = preview.getByRole('img', { name: `Образец: ${electronicsTitle}`, exact: true });
  const sampleSrc = await sample.getAttribute('src');
  await preview
    .getByRole('button', { name: `Открыть образец: ${electronicsTitle}`, exact: true })
    .click();
  const sampleDialog = page.getByRole('dialog', {
    name: `Образец: ${electronicsTitle}`,
    exact: true,
  });
  await expect(sampleDialog.getByRole('img')).toHaveAttribute('src', sampleSrc!);
  await sampleDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(sampleDialog).not.toBeVisible();
  const manualPreview = preview.getByTestId('course-pinned-material');
  const manualImageSrc = await manualPreview.getByRole('img').getAttribute('src');
  const openManualImage = manualPreview.getByRole('button', { name: /^Открыть крупно:/ });
  await openManualImage.click();
  const imageDialog = page.locator('.task-block-image-lightbox');
  await expect(imageDialog.getByRole('img')).toHaveAttribute('src', manualImageSrc!);
  await expect(imageDialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  await page.screenshot({ path: `${evidenceDir}/course-preview-pinned-image.png` });
  await imageDialog.getByRole('button', { name: 'Закрыть', exact: true }).press('Escape');
  await expect(imageDialog).not.toBeVisible();
  await expect(preview).toBeVisible();
  await expect(openManualImage).toBeFocused();
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(editor.getByLabel('Название урока')).toHaveValue(savedCourseTitle);
  expect(await liveCourseTitle!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(editor.getByRole('button', { name: 'Предпросмотр', exact: true })).toBeFocused();

  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();

  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Опубликованная версия', exact: true }).click();
  await expect(preview).toContainText('Опубликованная версия 1');
  await expect(preview.locator('.course-pinned-practice').nth(0)).toContainText(electronicsGoal);
  await expect(preview.locator('.course-pinned-practice').nth(1)).toContainText(threeDGoal);
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  let assignDialog = page.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await assignDialog.getByLabel('Класс для курса').selectOption({ label: classTitle });
  await assignDialog.getByLabel('Срок, если нужен').fill('2027-09-30');
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${evidenceDir}/course-authoring-assign-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const assignRequests: unknown[] = [];
  let lostResponse = false;
  const assignPath = `**/api/classrooms/${classroomId}/course-runs`;
  await page.route(assignPath, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    assignRequests.push(route.request().postDataJSON());
    if (!lostResponse) {
      lostResponse = true;
      const result = await route.fetch();
      expect(result.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await assignDialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(assignDialog.getByRole('alert')).toBeVisible();
  await expect(
    assignDialog.getByRole('button', { name: 'Новое назначение', exact: true }),
  ).toHaveCount(0);
  await assignDialog.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await editor.getByRole('button', { name: 'Курсы', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('courses-list')).toHaveCount(0);
  await denyPortalExit(() => openAccountSettings(page));
  await denyPortalExit(() => page.evaluate(() => window.history.back()), -1);
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  assignDialog = page.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await expect(assignDialog.getByLabel('Класс для курса')).toBeDisabled();
  const receipt = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/classrooms/${classroomId}/course-runs`,
  );
  await assignDialog.getByRole('button', { name: 'Повторить назначение', exact: true }).click();
  expect((await (await receipt).json()).reused).toBe(true);
  await expect(assignDialog.getByRole('status')).toContainText('Сервер подтвердил версию 1');
  expect(assignRequests).toHaveLength(2);
  expect(assignRequests[1]).toEqual(assignRequests[0]);
  await page.unroute(assignPath);
  await assignDialog.getByRole('button', { name: 'Новое назначение', exact: true }).click();
  await expect(assignDialog.getByLabel('Класс для курса')).toBeEnabled();
  await expect(assignDialog.getByLabel('Класс для курса')).toHaveValue('');
  await assignDialog.getByLabel('Класс для курса').selectOption({ label: secondClassTitle });
  await assignDialog.getByLabel('Срок, если нужен').fill('2027-10-15');
  const secondReceipt = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/classrooms/${secondClassroomId}/course-runs`,
  );
  await assignDialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  const secondResponse = await secondReceipt;
  expect(secondResponse.ok()).toBe(true);
  const secondPayload = secondResponse.request().postDataJSON();
  expect(secondPayload.versionNumber).toBe(1);
  expect(secondPayload.requestId).not.toBe((assignRequests[0] as { requestId: string }).requestId);
  expect(await secondResponse.json()).toMatchObject({ versionNumber: 1, reused: false });
  await expect(assignDialog.getByRole('status')).toContainText('Сервер подтвердил версию 1');
  await assignDialog.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();

  const learner = await learnerAssignments(browser, joinCode, 'd5-activity-' + suffix);
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });

  type D5CourseRunRead = {
    id: string;
    title: string;
    sections: Array<{
      lessons: Array<{
        id: string;
        activityOccurrences: Array<{
          blockId: string;
          activityRunId: string;
          classroomAssignmentId: string;
          learningActivityVersionId: string;
          title: string;
          goal: string | null;
          sampleImage: string | null;
          projectId: string | null;
          canonicalState: { workflowState: string } | null;
        }>;
      }>;
    }>;
  };
  function occurrenceFromCourseRun(run: D5CourseRunRead, title: string) {
    const occurrences = run.sections
      .flatMap((section) => section.lessons)
      .flatMap((lesson) => lesson.activityOccurrences)
      .filter((occurrence) => occurrence.title === title);
    expect(occurrences).toHaveLength(1);
    return occurrences[0]!;
  }

  let courseRunId: string | null = null;
  async function openCourse(
    options: { reloadAfterExternalChange?: boolean } = {},
  ): Promise<D5CourseRunRead> {
    const response = await learner.page.request.get('/api/class-join/me/course-runs');
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as { items: D5CourseRunRead[] };
    const matchingRuns = payload.items.filter((run) => run.title === courseTitle);
    expect(matchingRuns).toHaveLength(1);
    const run = matchingRuns[0]!;
    if (courseRunId === null) courseRunId = run.id;
    expect(run.id).toBe(courseRunId);
    if (options.reloadAfterExternalChange) {
      // An admin SQL update does not notify the mounted player. Reload the
      // document so SeatCourses fetches the current occurrence projection.
      const refreshed = learner.page.waitForResponse(
        (response) =>
          response.url().includes('/api/class-join/me/course-runs') &&
          response.request().method() === 'GET' &&
          response.ok(),
      );
      await learner.page.reload();
      await refreshed;
    } else {
      await learner.page.goto('/#/learning?courseRun=' + encodeURIComponent(courseRunId));
    }
    await expect(learner.page.getByTestId('seat-course-player')).toBeVisible();
    return run;
  }

  const initialRun = await openCourse();
  const player = learner.page.getByTestId('seat-course-player');
  const learnerBlocks = player.locator('.lesson-blocks').first().locator(':scope > *');
  await expect(learnerBlocks).toHaveCount(5);
  await expect(learnerBlocks.nth(0)).toContainText('Перед Electronics');
  await expect(learnerBlocks.nth(1)).toContainText(electronicsTitle);
  await expect(learnerBlocks.nth(2)).toContainText('Между двумя практиками');
  await expect(learnerBlocks.nth(3)).toContainText(manualTitle);
  await expect(learnerBlocks.nth(4)).toContainText(threeDTitle);
  const manual = learnerBlocks.nth(3).getByTestId('seat-course-manual-material');
  await expect(manual).toContainText('Прочитайте материал перед 3D.');
  await expect(manual.getByRole('img', { name: 'Изображение задания' })).toBeVisible();
  const imageSrc = await manual
    .getByRole('img', { name: 'Изображение задания' })
    .getAttribute('src');
  expect(imageSrc).toContain('/api/class-join/course-runs/');
  const imageResponse = await learner.page.request.get(imageSrc!);
  expect(imageResponse.ok()).toBe(true);
  expect(Buffer.compare(await imageResponse.body(), manualImage)).toBe(0);
  const materialBlockId = await learnerBlocks.nth(3).getAttribute('data-block-id');
  const materialResponse = await learner.page.request.get(
    `/api/class-join/course-runs/${initialRun.id}/lessons/${initialRun.sections[0]!.lessons[0]!.id}/materials/${materialBlockId}`,
  );
  expect(materialResponse.ok()).toBe(true);
  const materialPayload = await materialResponse.json();
  expect(materialPayload.source).toMatchObject({ kind: 'published', versionNumber: 1 });
  const fileSrc = materialPayload.blocks.find((block: { type: string }) => block.type === 'file')
    .src as string;
  const pdfResponse = await learner.page.request.get(fileSrc);
  expect(pdfResponse.ok()).toBe(true);
  expect(Buffer.compare(await pdfResponse.body(), manualPdf)).toBe(0);
  await expect(manual.getByRole('button', { name: /Начать|Отправить/ })).toHaveCount(0);
  const manualImageV2 = readFileSync('apps/web/public/landing/assignment-progress.png');
  const manualPdfV2 = Buffer.from('%PDF-1.4\nD5 newer manual PDF\n%%EOF');
  expect(Buffer.compare(manualImageV2, manualImage)).not.toBe(0);
  expect(Buffer.compare(manualPdfV2, manualPdf)).not.toBe(0);
  const newerManual = await republishManualWithDifferentMedia(
    page,
    manualTitle,
    'Вторая версия материала после назначения.',
    manualImageV2,
    manualPdfV2,
  );
  const materialBase = imageSrc!.replace(/\/image\/[0-9a-f]{64}$/, '');
  expect(imageSrc).not.toContain(newerManual.imageHash);
  expect(fileSrc).not.toContain(newerManual.fileHash);
  await openCourse({ reloadAfterExternalChange: true });
  await expect(manual).toContainText('Прочитайте материал перед 3D.');
  const pinnedManual = await learner.page.request.get(materialBase);
  expect(pinnedManual.ok()).toBe(true);
  expect(await pinnedManual.json()).toMatchObject(materialPayload);
  const pinnedImage = await learner.page.request.get(imageSrc!);
  const pinnedPdf = await learner.page.request.get(fileSrc);
  expect(Buffer.compare(await pinnedImage.body(), manualImage)).toBe(0);
  expect(Buffer.compare(await pinnedPdf.body(), manualPdf)).toBe(0);
  expect(
    (await learner.page.request.get(`${materialBase}/image/${newerManual.imageHash}`)).status(),
  ).toBe(404);
  expect(
    (await learner.page.request.get(`${materialBase}/file/${newerManual.fileHash}`)).status(),
  ).toBe(404);
  await expect(manual.getByRole('button', { name: /Начать|Отправить/ })).toHaveCount(0);

  let electronicsCard = player
    .locator('.lesson-activity-block')
    .filter({ hasText: electronicsTitle });
  let threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText('Electronics');
  await expect(electronicsCard).toContainText('Не начато');
  await expect(electronicsCard).toContainText(electronicsGoal);
  await expect(threeDCard).toContainText('3D');
  await expect(threeDCard).toContainText('Не начато');
  await expect(threeDCard).toContainText(threeDGoal);
  const beforeStart = await openCourse();
  const electronicsOccurrence = occurrenceFromCourseRun(beforeStart, electronicsTitle);
  const threeDOccurrence = occurrenceFromCourseRun(beforeStart, threeDTitle);
  expect(electronicsOccurrence.goal).toBe(electronicsGoal);
  expect(threeDOccurrence.goal).toBe(threeDGoal);
  expect(electronicsOccurrence.sampleImage).toBe(
    `/api/class-join/course-activities/${electronicsOccurrence.activityRunId}/sample`,
  );
  expect(threeDOccurrence.sampleImage).toBe(
    `/api/class-join/course-activities/${threeDOccurrence.activityRunId}/sample`,
  );
  expect(electronicsOccurrence.sampleImage).not.toBe(threeDOccurrence.sampleImage);
  for (const [occurrence, bytes] of [
    [electronicsOccurrence, electronicsSample],
    [threeDOccurrence, threeDSample],
  ] as const) {
    const response = await learner.page.request.get(occurrence.sampleImage!);
    expect(response.ok()).toBe(true);
    expect(Buffer.compare(await response.body(), bytes)).toBe(0);
  }
  await admin.query(
    `UPDATE activity_runs
        SET operational_overrides=jsonb_build_object('opensAt',to_jsonb(now()+interval '1 day'))
      WHERE id=$1`,
    [electronicsOccurrence.activityRunId],
  );
  const earlySample = await learner.page.request.get(electronicsOccurrence.sampleImage!);
  expect(earlySample.status()).toBe(404);
  const earlyRun = await openCourse({ reloadAfterExternalChange: true });
  expect(occurrenceFromCourseRun(earlyRun, electronicsTitle).goal).toBeNull();
  await expect(
    player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle }),
  ).not.toContainText(electronicsGoal);
  await admin.query("UPDATE activity_runs SET operational_overrides='{}'::jsonb WHERE id=$1", [
    electronicsOccurrence.activityRunId,
  ]);
  await openCourse({ reloadAfterExternalChange: true });
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText(electronicsGoal);
  await expect(
    electronicsCard.getByRole('img', { name: `Образец: ${electronicsTitle}` }),
  ).toBeVisible();
  await expect(threeDCard.getByRole('img', { name: `Образец: ${threeDTitle}` })).toBeVisible();

  const a2aEvidenceDir = 'e2e/artifacts/learning/course-media-a2a';
  mkdirSync(a2aEvidenceDir, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await learner.page.setViewportSize(viewport);
    const sample = electronicsCard.getByRole('img', { name: `Образец: ${electronicsTitle}` });
    const start = electronicsCard.getByRole('button', { name: 'Начать', exact: true });
    await expect(sample).toBeVisible();
    await expect(electronicsCard).toContainText(electronicsGoal);
    await start.scrollIntoViewIfNeeded();
    await expect(start).toBeInViewport();
    await expect(start).toBeEnabled();
    const layout = await learner.page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.bodyWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
    await learner.page.screenshot({
      path: `${a2aEvidenceDir}/before-start-${viewport.width}.png`,
      fullPage: false,
    });
  }
  await learner.page.setViewportSize({ width: 1440, height: 900 });

  // Exercise the browser contract for a legacy handout shared by two exact
  // ActivityRuns. The PG regression verifies the SQL projection; here the
  // intercepted read checks the 320px learner surface and action boundary.
  const sharedWorkHandler = async (route: Route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as { items: D5CourseRunRead[] };
    const run = payload.items.find((item) => item.id === courseRunId);
    for (const occurrence of run?.sections
      .flatMap((section) => section.lessons)
      .flatMap((lesson) => lesson.activityOccurrences) ?? []) {
      Object.assign(occurrence, {
        classroomAssignmentId: electronicsOccurrence.classroomAssignmentId,
        projectId: '57000000-0000-4000-8000-000000000001',
        canonicalState: { workflowState: 'in_progress' },
        workOriginAmbiguous: true,
      });
    }
    await route.fulfill({ response, json: payload });
  };
  await learner.page.route('**/api/class-join/me/course-runs', sharedWorkHandler);
  await learner.page.setViewportSize({ width: 320, height: 568 });
  await openCourse({ reloadAfterExternalChange: true });
  for (const title of [electronicsTitle, threeDTitle]) {
    const activity = player.locator('.lesson-activity-block').filter({ hasText: title });
    await expect(activity).toContainText('Работа пока недоступна');
    await expect(activity.getByRole('status')).toContainText('не привязана к этой практике');
    await expect(activity.getByRole('button', { name: /Начать|Открыть работу|Сдать/ })).toHaveCount(
      0,
    );
  }
  const sharedLayout = await learner.page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(sharedLayout.documentWidth, JSON.stringify(sharedLayout)).toBeLessThanOrEqual(
    sharedLayout.viewport + 1,
  );
  expect(sharedLayout.bodyWidth, JSON.stringify(sharedLayout)).toBeLessThanOrEqual(
    sharedLayout.viewport + 1,
  );
  // Keep the narrow layout assertion at 320×568, then frame the whole
  // unavailable activity in one 320px-wide evidence viewport.
  await learner.page.setViewportSize({ width: 320, height: 844 });
  const sharedActivity = player
    .locator('.lesson-activity-block')
    .filter({ hasText: electronicsTitle });
  await sharedActivity.scrollIntoViewIfNeeded();
  const sharedHeading = sharedActivity.locator('.seat-course-activity-main');
  const sharedExplanation = sharedActivity.getByRole('status');
  await expect(sharedHeading).toBeInViewport({ ratio: 1 });
  await expect(sharedExplanation).toBeInViewport({ ratio: 1 });
  expect((await sharedHeading.boundingBox())?.y).toBeGreaterThanOrEqual(56);
  await learner.page.screenshot({
    path: `${a2aEvidenceDir}/shared-work-unavailable-320.png`,
    fullPage: false,
  });
  // This is the learner page's only route handler at this point. A second
  // course read can still be in flight after the player is visible; drain it
  // before removing interception so its real response is fulfilled only once.
  await learner.page.unrouteAll({ behavior: 'wait' });
  await learner.page.setViewportSize({ width: 1440, height: 900 });
  await openCourse({ reloadAfterExternalChange: true });

  const atomicStarts: string[] = [];
  const legacyStarts: string[] = [];
  const observeStart = (request: import('@playwright/test').Request) => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    const match = /^\/api\/learning\/work\/runs\/([^/]+)\/start$/.exec(path);
    if (match) atomicStarts.push(match[1]!);
    if (
      path === '/api/projects' ||
      /\/api\/class-join\/me\/assignments\/[^/]+\/(?:work|submit)$/.test(path)
    )
      legacyStarts.push(path);
  };
  learner.page.on('request', observeStart);
  await electronicsCard.getByRole('button', { name: 'Начать', exact: true }).click();
  const electronicsEvidence = await editCourseActivityProject(learner.page, 'electronics');
  expect(electronicsEvidence.projectId).not.toBe('');
  expect(electronicsEvidence.addedComponentId).toBeTruthy();

  const firstOccurrence = occurrenceFromCourseRun(
    await (async () => {
      const response = await learner.page.request.get('/api/class-join/me/course-runs');
      expect(response.ok()).toBe(true);
      const payload = (await response.json()) as { items: D5CourseRunRead[] };
      return payload.items.find((run) => run.id === courseRunId)!;
    })(),
    electronicsTitle,
  );
  const firstContextResponse = await learner.page.request.get(
    `/api/learning/projects/${electronicsEvidence.projectId}/context`,
  );
  expect(firstContextResponse.ok()).toBe(true);
  const firstContext = await firstContextResponse.json();
  expect(firstContext).toMatchObject({
    state: 'ready',
    origin: {
      immutable: true,
      courseBlockId: firstOccurrence.blockId,
      activityRunId: firstOccurrence.activityRunId,
      classroomAssignmentId: firstOccurrence.classroomAssignmentId,
      learningActivityVersionId: firstOccurrence.learningActivityVersionId,
    },
    task: { title: electronicsTitle, goal: electronicsGoal },
  });
  expect(firstContext.task.sampleImage).toBe(electronicsOccurrence.sampleImage);
  const a1EvidenceDir = 'e2e/artifacts/learning/work-context-a1';
  mkdirSync(a1EvidenceDir, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await learner.page.setViewportSize(viewport);
    const anchor = learner.page.getByTestId('assignment-brief-anchor');
    await expect(anchor).toBeVisible();
    if ((await anchor.getAttribute('aria-expanded')) === 'false') await anchor.click();
    await expect(learner.page.getByTestId('assignment-brief')).toContainText(electronicsTitle);
    await expect(
      learner.page.getByTestId('assignment-brief').getByRole('img', {
        name: `Образец: ${electronicsTitle}`,
      }),
    ).toBeVisible();
    await learner.page
      .getByTestId('assignment-brief')
      .getByRole('img', { name: `Образец: ${electronicsTitle}` })
      .scrollIntoViewIfNeeded();
    await learner.page.screenshot({
      path: `${a1EvidenceDir}/course-block-${viewport.width}.png`,
      fullPage: false,
    });
    await learner.page.screenshot({
      path: `${a2aEvidenceDir}/after-start-${viewport.width}.png`,
      fullPage: false,
    });
  }
  await learner.page.setViewportSize({ width: 1440, height: 900 });

  await openCourse();
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(
    electronicsCard.getByRole('button', { name: 'Открыть работу', exact: true }),
  ).toBeVisible();
  await expect(threeDCard).toContainText('Не начато');
  await expect(threeDCard.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();

  await electronicsCard.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(electronicsEvidence.projectId);
  await expect(
    learner.page.locator(
      `[data-testid="schematic-component"][data-component-id="${electronicsEvidence.addedComponentId}"][data-kind="resistor"]`,
    ),
  ).toBeVisible();

  await openCourse();
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  const exactCourseSubmit = learner.page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname ===
        `/api/learning/projects/${electronicsEvidence.projectId}/submit`,
  );
  learner.page.once('dialog', (dialog) => void dialog.accept());
  await electronicsCard.getByRole('button', { name: 'Сдать', exact: true }).click();
  expect((await exactCourseSubmit).postDataJSON()).toMatchObject({
    clientRequestId: expect.any(String),
    expectedRevision: expect.any(Number),
  });
  expect(
    (
      await admin.query(
        'SELECT COUNT(*)::int AS count FROM classroom_assignment_work WHERE project_id=$1',
        [electronicsEvidence.projectId],
      )
    ).rows[0]?.count,
  ).toBe(0);
  await expect(
    electronicsCard.getByRole('button', { name: 'Работа сдана', exact: true }),
  ).toBeDisabled();

  const afterElectronicsSubmit = await openCourse();
  const submittedElectronics = occurrenceFromCourseRun(afterElectronicsSubmit, electronicsTitle);
  const untouchedThreeD = occurrenceFromCourseRun(afterElectronicsSubmit, threeDTitle);
  expect(submittedElectronics.projectId).toBe(electronicsEvidence.projectId);
  expect(submittedElectronics.canonicalState?.workflowState).toBe('submitted');
  expect(untouchedThreeD.projectId).toBeNull();
  expect(untouchedThreeD.canonicalState?.workflowState).toBe('not_started');
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText('Сдано');
  await expect(threeDCard).toContainText('Не начато');
  await expect(threeDCard.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
  await threeDCard.getByRole('button', { name: 'Начать', exact: true }).click();
  learner.page.off('request', observeStart);
  expect(atomicStarts).toEqual([
    electronicsOccurrence.activityRunId,
    threeDOccurrence.activityRunId,
  ]);
  expect(legacyStarts).toEqual([]);
  const threeDEvidence = await editCourseActivityProject(learner.page, 'three-d');
  expect(threeDEvidence.projectId).not.toBe('');
  expect(threeDEvidence.projectId).not.toBe(electronicsEvidence.projectId);

  const secondContextResponse = await learner.page.request.get(
    `/api/learning/projects/${threeDEvidence.projectId}/context`,
  );
  expect(secondContextResponse.ok()).toBe(true);
  const secondContext = await secondContextResponse.json();
  expect(secondContext).toMatchObject({
    state: 'ready',
    task: { title: threeDTitle },
    origin: { immutable: true, sourceKind: 'course' },
  });
  expect(
    (
      await admin.query(
        'SELECT COUNT(*)::int AS count FROM classroom_assignment_work WHERE project_id = ANY($1::uuid[])',
        [[electronicsEvidence.projectId, threeDEvidence.projectId]],
      )
    ).rows[0]?.count,
  ).toBe(0);
  expect(secondContext.origin.courseBlockId).not.toBe(firstContext.origin.courseBlockId);
  expect(secondContext.origin.learningActivityVersionId).not.toBe(
    firstContext.origin.learningActivityVersionId,
  );

  const afterThreeDStart = await openCourse();
  const electronicsAfterThreeD = occurrenceFromCourseRun(afterThreeDStart, electronicsTitle);
  const startedThreeD = occurrenceFromCourseRun(afterThreeDStart, threeDTitle);
  expect(electronicsAfterThreeD.projectId).toBe(electronicsEvidence.projectId);
  expect(electronicsAfterThreeD.canonicalState?.workflowState).toBe('submitted');
  expect(startedThreeD.projectId).toBe(threeDEvidence.projectId);
  expect(startedThreeD.projectId).not.toBe(electronicsAfterThreeD.projectId);
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText('Сдано');
  await expect(
    electronicsCard.getByRole('button', { name: 'Работа сдана', exact: true }),
  ).toBeDisabled();
  await expect(
    threeDCard.getByRole('button', { name: 'Открыть работу', exact: true }),
  ).toBeVisible();

  await electronicsCard.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(electronicsEvidence.projectId);
  await expect(
    learner.page.locator(
      `[data-testid="schematic-component"][data-component-id="${electronicsEvidence.addedComponentId}"][data-kind="resistor"]`,
    ),
  ).toBeVisible();

  await openCourse();
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await threeDCard.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await expect(learner.page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 60_000 });
  await expect(learner.page.getByTestId('asa3d-viewport')).toHaveAttribute(
    'data-runtime-ready',
    'true',
  );
  expect(courseActivityProjectId(learner.page, 'three-d')).toBe(threeDEvidence.projectId);
  await expect(learner.page.locator('.asa3d-object-count')).toContainText(
    new RegExp(`^${threeDEvidence.expectedObjectCount} `),
  );

  await learner.page.route(
    `**/api/learning/projects/${threeDEvidence.projectId}/context`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'unavailable', projectId: threeDEvidence.projectId }),
      }),
  );
  await learner.page.setViewportSize({ width: 390, height: 844 });
  await learner.page.reload();
  await expect(learner.page.getByTestId('learning-work-context-state')).toContainText(
    'Не удалось загрузить учебное задание.',
  );
  await learner.page.screenshot({
    path: `${a1EvidenceDir}/unavailable-390.png`,
    fullPage: false,
  });

  learnerFailures.assertEmpty();
  await learner.context.close();
});

test('Course Builder corrects the exact second prepublish block and preserves later edits and published history', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const directory = `${evidenceDir}/prepublication`;
  mkdirSync(directory, { recursive: true });
  const suffix = crypto.randomUUID().slice(0, 8);
  const oldPractice = `Практика до проверки ${suffix}`;
  const newPractice = `Практика для исправления ${suffix}`;
  const courseTitle = `Точная проверка публикации ${suffix}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createPublishedProjectActivity(page, oldPractice);
  await createPublishedProjectActivityAfterLogin(page, newPractice);
  const authoredResponse = await page.request.get('/api/learning/activities');
  expect(authoredResponse.ok()).toBe(true);
  const authored = (await authoredResponse.json()) as {
    items: Array<{ id: string; title: string; currentPublishedVersionId: string }>;
  };
  const oldPin = authored.items.find((entry) => entry.title === oldPractice)!;
  const newPin = authored.items.find((entry) => entry.title === newPractice)!;
  expect(oldPin.currentPublishedVersionId).toBeTruthy();
  expect(newPin.currentPublishedVersionId).toBeTruthy();

  await page.goto('/#/challenges');
  await page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/courses',
  );
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const created = await creation;
  expect(created.status()).toBe(201);
  const courseId = ((await created.json()) as { id: string }).id;
  const editor = page.getByTestId('course-editor');
  const courseNotice = editor.getByRole('status').and(editor.locator('.course-inline-notice'));
  const courseErrorNotice = editor.getByRole('alert').and(editor.locator('.course-inline-notice'));
  const title = editor.getByLabel('Название урока', { exact: true });
  const save = editor.getByRole('button', { name: 'Сохранить урок', exact: true });
  await editor.getByRole('button', { name: '+ Урок', exact: true }).click();
  await title.fill('Первая теория');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Первый урок не теряет содержание.');
  const firstAdded = await confirmLessonWrite(null, () =>
    editor.getByRole('button', { name: 'Добавить урок', exact: true }).click(),
  );
  await expect(courseNotice).toHaveText('Урок добавлен.');
  await editor.getByRole('button', { name: '+ Урок', exact: true }).click();
  await title.fill('Второй урок с практикой');
  await editor
    .getByLabel('Текст блока', { exact: true })
    .fill('Текст перед практикой сохраняется.');
  await addCourseBlock(page, 'Практика');
  await selectCoursePractice(page, oldPractice);
  const secondAdded = await confirmLessonWrite(null, () =>
    editor.getByRole('button', { name: 'Добавить урок', exact: true }).click(),
  );
  await expect(courseNotice).toHaveText('Урок добавлен.');

  async function outline() {
    const response = await page.request.get(`/api/courses/${courseId}/outline`);
    expect(response.status()).toBe(200);
    return (await response.json()) as { draftRevision: number; sections: CourseSection[] };
  }
  async function versions() {
    const response = await page.request.get(`/api/courses/${courseId}/versions`);
    expect(response.status()).toBe(200);
    return (await response.json()) as {
      items: Array<{ id: string; versionNumber: number; outline: unknown }>;
    };
  }
  async function confirmLessonWrite(lessonId: string | null, submit: () => Promise<void>) {
    const method = lessonId ? 'PATCH' : 'POST';
    const pathname = `/api/courses/${courseId}/lessons${lessonId ? '/' + lessonId : ''}`;
    const saved = page
      .waitForResponse(
        (response) =>
          response.request().method() === method && new URL(response.url()).pathname === pathname,
      )
      .then(async (response) => {
        expect(response.status()).toBe(lessonId ? 200 : 201);
        expect(await response.finished()).toBeNull();
        const receipt = (await response.json()) as { id: string; draftRevision: number };
        const submitted = response.request().postDataJSON() as {
          sectionId: string;
          title: string;
          blocks: unknown[];
          expectedRevision: number;
        };
        expect(receipt.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        if (lessonId) expect(receipt.id).toBe(lessonId);
        expect(Number.isSafeInteger(receipt.draftRevision)).toBe(true);
        expect(receipt.draftRevision).toBeGreaterThan(submitted.expectedRevision);
        return { receipt, submitted };
      });
    // The notice text can survive the previous save. Match this write's exact
    // receipt and the editor's corresponding committed outline refresh instead.
    const refreshed = page.waitForResponse(async (response) => {
      if (
        response.request().method() !== 'GET' ||
        new URL(response.url()).pathname !== `/api/courses/${courseId}/outline` ||
        response.status() !== 200
      )
        return false;
      const body = (await response.json()) as { draftRevision: number };
      return body.draftRevision === (await saved).receipt.draftRevision;
    });
    await submit();
    const result = await saved;
    await refreshed;
    const committed = await outline();
    expect(committed.draftRevision).toBe(result.receipt.draftRevision);
    const matches = committed.sections.flatMap((section) =>
      section.lessons
        .filter((lesson) => lesson.id === result.receipt.id)
        .map((lesson) => ({ sectionId: section.id, lesson })),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sectionId).toBe(result.submitted.sectionId);
    expect(matches[0]!.lesson.title).toBe(result.submitted.title);
    expect(matches[0]!.lesson.blocks).toEqual(result.submitted.blocks);
    return { receipt: result.receipt, outline: committed };
  }
  const original = secondAdded.outline;
  expect(secondAdded.receipt.id).not.toBe(firstAdded.receipt.id);
  expect(original.sections).toHaveLength(1);
  const section = original.sections[0]!;
  expect(section.lessons.map((lesson) => lesson.id)).toEqual([
    firstAdded.receipt.id,
    secondAdded.receipt.id,
  ]);
  expect(section.lessons.map((lesson) => lesson.title)).toEqual([
    'Первая теория',
    'Второй урок с практикой',
  ]);
  const second = section.lessons[1]!;
  const secondBlock = second.blocks[1]!;
  expect(secondBlock).toMatchObject({
    type: 'activity',
    learningActivityVersionId: oldPin.currentPublishedVersionId,
  });
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(courseNotice).toHaveText('Курс опубликован: версия 1.');
  const immutableV1 = (await versions()).items;
  expect(immutableV1).toHaveLength(1);

  // An external authoring event makes only this synthetic pin unavailable.
  // e2eAdminPool refuses non-test databases; the response below is never forged.
  const archived = await admin.query(
    'UPDATE learning_activities SET archived_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id',
    [oldPin.id, teacher.tenantId],
  );
  expect(archived.rowCount).toBe(1);
  await openCourseStructure(page);
  await editor.locator('.course-lesson-link').filter({ hasText: 'Первая теория' }).click();
  await title.fill('Первая теория — новая редакция');
  await confirmLessonWrite(firstAdded.receipt.id, () => save.click());
  await expect(courseNotice).toHaveText('Урок сохранён.');
  const beforeFailure = await outline();
  const path = `/api/courses/${courseId}/publish`;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed!: () => void;
  const started = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let delivered!: () => void;
  const completed = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(409);
    observed();
    await delayed;
    await route.fulfill({ response });
    delivered();
  });
  const failed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === path,
  );
  await editor.getByRole('button', { name: 'Опубликовать v2', exact: true }).click();
  await started;
  await title.fill('Правки B во время проверки остаются');
  release();
  await completed;
  const failedResponse = await failed;
  await failedResponse.finished();
  const problem = (await failedResponse.json()) as { error: { code: string; diagnostic: unknown } };
  expect(problem).toMatchObject({
    error: {
      code: 'prepublish_invalid',
      diagnostic: {
        courseId,
        draftRevision: beforeFailure.draftRevision,
        sectionId: section.id,
        lessonId: second.id,
        blockId: secondBlock.id,
        field: 'learningActivityVersionId',
        reason: 'pin_unavailable',
      },
    },
  });
  await page.unrouteAll({ behavior: 'wait' });
  const correct = editor.getByRole('button', { name: 'Перейти к исправлению', exact: true });
  await correct.click();
  await expect(title).toHaveValue('Правки B во время проверки остаются');
  await expect(courseErrorNotice).toContainText(
    'Сначала сохраните изменения урока. Переход не выполнен',
  );
  expect((await versions()).items).toEqual(immutableV1);
  await confirmLessonWrite(firstAdded.receipt.id, () => save.click());
  await expect(courseNotice).toHaveText('Урок сохранён.');
  await editor.getByRole('button', { name: 'Опубликовать v2', exact: true }).click();
  await expect(correct).toBeVisible();

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await correct.click();
    await expect(title).toHaveValue('Второй урок с практикой');
    const card = editor.locator(`[data-course-block-id="${secondBlock.id}"]`);
    const change = card.getByRole('button', { name: 'Заменить практику', exact: true });
    await expect(change).toBeFocused();
    await expect(change).toBeVisible();
    await expect(editor.getByLabel('Текст блока', { exact: true })).toHaveValue(
      'Текст перед практикой сохраняется.',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    const bounds = await change.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${directory}/second-block-${width}-viewport.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: `${directory}/second-block-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await selectCoursePractice(page, newPractice);
  await confirmLessonWrite(secondAdded.receipt.id, () => save.click());
  await expect(courseNotice).toHaveText('Урок сохранён.');
  const repaired = await outline();
  expect(repaired.sections[0]!.lessons[0]!.title).toBe('Правки B во время проверки остаются');
  expect(repaired.sections[0]!.lessons[1]!.blocks[1]).toMatchObject({
    id: secondBlock.id,
    learningActivityVersionId: newPin.currentPublishedVersionId,
  });
  expect((await versions()).items).toEqual(immutableV1);
  await editor.getByRole('button', { name: 'Опубликовать v2', exact: true }).click();
  await expect(courseNotice).toHaveText('Курс опубликован: версия 2.');
  const history = (await versions()).items;
  expect(history).toHaveLength(2);
  expect(history.find((entry) => entry.versionNumber === 1)).toEqual(immutableV1[0]);
  await page.screenshot({ path: `${directory}/corrected-published-v2.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('Course archive rejects a stale assignment dialog, keeps exact replay and old learning, then restores assignment', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await loginWithOrganization(page, teacher);
  const suffix = ++sequence;
  const classTitle = 'Архив и выдача ' + suffix;
  const courseTitle = 'Курс с сохранённой версией ' + suffix;
  const lessonTitle = 'Теория до архивации';
  const lessonText = 'Этот материал остаётся доступен в уже назначенном курсе.';
  const joinCode = await createClassWithStudents(page, classTitle, [
    { label: 'Ученик сохранённого курса', handle: 'fix08-learner-' + suffix },
  ]);
  const classroomId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;
  const assignmentPath = `/api/classrooms/${classroomId}/course-runs`;
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push(response.status() + ' ' + response.url());
  });

  await page.goto('/#/challenges');
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/courses',
  );
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const creation = await created;
  expect(creation.status()).toBe(201);
  const courseId = ((await creation.json()) as { id: string }).id;
  const editor = page.getByTestId('course-editor');
  await expect(editor).toBeVisible();
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill(lessonTitle);
  await editor.getByLabel('Текст блока', { exact: true }).fill(lessonText);
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок добавлен.',
  );
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  const assignDialog = page.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await assignDialog.getByLabel('Класс для курса').selectOption({ label: classTitle });
  const firstResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === assignmentPath,
  );
  await assignDialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  const assigned = await firstResponse;
  expect(assigned.status()).toBe(201);
  const originalRequest = assigned.request().postDataJSON();
  const originalReceipt = (await assigned.json()) as {
    runId: string;
    versionNumber: number;
    reused: boolean;
  };
  expect(originalReceipt).toMatchObject({ versionNumber: 1, reused: false });
  await expect(assignDialog.getByRole('status')).toContainText('Сервер подтвердил версию 1');
  await assignDialog.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();

  const learner = await learnerAssignments(browser, joinCode, 'fix08-learner-' + suffix);
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAdminAccessProbe: true,
  });
  async function readOldLearning(): Promise<void> {
    await learner.page.goto('/#/learning?courseRun=' + originalReceipt.runId);
    await learner.page.reload();
    const player = learner.page.getByTestId('seat-course-player');
    await expect(player).toBeVisible();
    await expect(player.getByRole('heading', { name: lessonTitle, exact: true })).toBeVisible();
    await expect(player.getByText(lessonText, { exact: true })).toBeVisible();
    const response = await learner.page.request.get('/api/class-join/me/course-runs');
    expect(response.ok()).toBe(true);
    const data = (await response.json()) as {
      items: Array<{ id: string; courseId: string; versionNumber: number }>;
    };
    expect(data.items.filter((run) => run.id === originalReceipt.runId)).toEqual([
      expect.objectContaining({ courseId, versionNumber: 1 }),
    ]);
  }
  await readOldLearning();
  async function protectedDelivery() {
    return (
      await admin.query(
        `SELECT jsonb_build_object(
           'version',(SELECT to_jsonb(v) FROM course_versions v
             JOIN classroom_course_runs r ON r.course_version_id=v.id WHERE r.id=$1),
           'run',(SELECT to_jsonb(r) FROM classroom_course_runs r WHERE r.id=$1),
           'lessons',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM classroom_course_run_lessons l WHERE l.run_id=$1),
           'enrollments',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM course_enrollments e WHERE e.course_run_id=$1)
         ) AS value`,
        [originalReceipt.runId],
      )
    ).rows[0].value;
  }
  const originalDelivery = await protectedDelivery();

  // Leave a real new-assignment dialog open while another tab archives the
  // course. No response is mocked; the later command must consult the lock.
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  await assignDialog.getByRole('button', { name: 'Новое назначение', exact: true }).click();
  await assignDialog.getByLabel('Класс для курса').selectOption({ label: classTitle });
  await assignDialog.getByLabel('Срок, если нужен').fill('2027-10-15');
  const archiveTab = await page.context().newPage();
  const archiveFailures = collectBrowserFailures(archiveTab, { allowAdminAccessProbe: true });
  await archiveTab.goto('/#/challenges');
  await archiveTab.getByRole('button', { name: 'Курсы', exact: true }).click();
  const courseRow = archiveTab
    .getByTestId('courses-list')
    .locator('li')
    .filter({ hasText: courseTitle });
  await courseRow.getByRole('button', { name: 'Ещё: ' + courseTitle, exact: true }).click();
  const archivedResponse = archiveTab.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/courses/${courseId}/archive`,
  );
  archiveTab.once('dialog', (dialog) => void dialog.accept());
  await courseRow.getByRole('button', { name: 'Архивировать', exact: true }).click();
  const archived = await archivedResponse;
  expect(archived.ok()).toBe(true);
  expect(await archived.json()).toMatchObject({ archived: true });
  await expect(courseRow).toHaveCount(0);

  const refusedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === assignmentPath,
  );
  await assignDialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  const refused = await refusedResponse;
  expect(refused.status()).toBe(409);
  const retryRequest = refused.request().postDataJSON();
  expect(retryRequest.requestId).not.toBe(originalRequest.requestId);
  expect(await refused.json()).toMatchObject({ error: { code: 'course_archived' } });
  await expect(assignDialog.getByRole('alert')).toHaveText(
    'Восстановите курс из архива перед назначением.',
  );
  await expect(assignDialog.getByLabel('Класс для курса')).toHaveValue(classroomId);
  await expect(assignDialog.getByLabel('Срок, если нужен')).toHaveValue('2027-10-15');
  await expect(
    assignDialog.getByRole('button', { name: 'Повторить назначение', exact: true }),
  ).toBeEnabled();
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${evidenceDir}/fix08-archive-rejection-${width}.png`,
      fullPage: true,
    });
  }
  const replay = await page.request.post(assignmentPath, {
    headers: { origin: new URL(page.url()).origin },
    data: originalRequest,
  });
  expect(replay.status()).toBe(201);
  expect(await replay.json()).toEqual({ ...originalReceipt, reused: true });
  expect(await protectedDelivery()).toEqual(originalDelivery);
  const whileArchived = await page.request.get(assignmentPath);
  expect(whileArchived.ok()).toBe(true);
  expect(((await whileArchived.json()) as { items: unknown[] }).items).toHaveLength(1);
  await readOldLearning();
  await learner.page.setViewportSize({ width: 390, height: 844 });
  await learner.page.screenshot({
    path: `${evidenceDir}/fix08-old-course-390.png`,
    fullPage: true,
  });

  // Restore through the existing library UI, then retry the same rejected
  // request. The server creates one new delivery and preserves the old one.
  await archiveTab.getByRole('button', { name: 'Архив', exact: true }).click();
  await expect(courseRow).toBeVisible();
  const restoredResponse = archiveTab.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/courses/${courseId}/archive`,
  );
  await courseRow.getByRole('button', { name: 'Восстановить', exact: true }).click();
  const restored = await restoredResponse;
  expect(restored.ok()).toBe(true);
  expect(await restored.json()).toMatchObject({ archived: false });
  await expect(courseRow).toHaveCount(0);
  const retryResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === assignmentPath,
  );
  await assignDialog.getByRole('button', { name: 'Повторить назначение', exact: true }).click();
  const retried = await retryResponse;
  expect(retried.status()).toBe(201);
  expect(retried.request().postDataJSON()).toEqual(retryRequest);
  expect(await retried.json()).toMatchObject({ versionNumber: 1, reused: false });
  await expect(assignDialog.getByRole('status')).toContainText('Сервер подтвердил версию 1');
  await expect(assignDialog.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: `${evidenceDir}/fix08-restored-assignment-1440.png`,
    fullPage: true,
  });
  const deliveries = await page.request.get(assignmentPath);
  expect(deliveries.ok()).toBe(true);
  expect(((await deliveries.json()) as { items: unknown[] }).items).toHaveLength(2);
  expect(await protectedDelivery()).toEqual(originalDelivery);
  await readOldLearning();
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
  learnerFailures.assertEmpty();
  archiveFailures.assertEmpty();
  await learner.context.close();
  await archiveTab.close();
});

test('Course media errors survive saved author preview and learner delivery with explicit retry', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const directory = evidenceDir + '/media-errors';
  mkdirSync(directory, { recursive: true });
  const courseTitle = 'Медиа курса ' + suffix;
  const classTitle = 'Класс медиа ' + suffix;
  const lessonTitle = 'Материалы с повторной загрузкой';
  const imageUrl = '/assets/course-media-' + suffix + '.png';
  const videoUrl = '/assets/course-media-' + suffix + '.webm';
  const audioUrl = '/assets/course-media-' + suffix + '.wav';
  const fileUrl = 'https://example.test/course-guide-' + suffix + '.pdf';
  const imageAlt = 'Схема с подписью после сохранения';
  const imageCaption = 'Иллюстрация к сохранённому уроку';
  const videoTitle = 'Сохранённое видео платформы';
  const audioTitle = 'Сохранённое аудио платформы';
  const fileLabel = 'Памятка к сохранённому уроку';
  const media = [
    {
      url: imageUrl,
      selector: '.lesson-media-block:has(img)',
      message: 'Не удалось загрузить изображение',
    },
    {
      url: videoUrl,
      selector: '.lesson-media-block:has(video)',
      message: 'Не удалось загрузить видео',
    },
    {
      url: audioUrl,
      selector: '.lesson-audio-block:has(audio)',
      message: 'Не удалось загрузить аудио',
    },
  ] as const;
  const imageBytes = readFileSync('apps/web/public/landing/electronics-simulation.png');

  // Only these exact synthetic resource responses are controlled. Course,
  // publication, assignment and learner responses always come from the API.
  async function observeMedia(target: Page) {
    const origin = new URL(target.url()).origin;
    const expectedUrls = new Set(media.map((item) => new URL(item.url, origin).href));
    const requestCounts = new Map<string, number>();
    const responses = new Map<string, number[]>();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const unexpectedHttpErrors: string[] = [];
    let fileRequests = 0;
    let imageAvailable = false;
    let mediaGate: Promise<void> | null = null;
    target.on('pageerror', (error) => pageErrors.push(error.message));
    target.on('request', (request) => {
      if (request.url() === fileUrl) fileRequests += 1;
    });
    target.on('console', (message) => {
      if (message.type() !== 'error') return;
      const source = message.location().url;
      if (
        expectedUrls.has(source) &&
        message
          .text()
          .startsWith('Failed to load resource: the server responded with a status of 404')
      )
        return;
      // Same exact signed-in non-admin probe allowed by collectBrowserFailures.
      if (
        source === origin + '/api/admin/v1/me' &&
        message.text() ===
          'Failed to load resource: the server responded with a status of 403 (Forbidden)'
      )
        return;
      consoleErrors.push(message.text() + ' ' + source);
    });
    target.on('requestfailed', (request) => {
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      failedRequests.push(
        request.method() + ' ' + request.url() + ' ' + request.failure()?.errorText,
      );
    });
    target.on('response', (response) => {
      if (expectedUrls.has(response.url())) {
        const pathname = new URL(response.url()).pathname;
        responses.set(pathname, [...(responses.get(pathname) ?? []), response.status()]);
        if (response.status() === 404 || (pathname === imageUrl && response.status() === 200))
          return;
      }
      if (response.status() < 400) return;
      if (response.status() === 403 && response.url() === origin + '/api/admin/v1/me') return;
      unexpectedHttpErrors.push(response.status() + ' ' + response.url());
    });
    await target.route(
      (url) => expectedUrls.has(url.href),
      async (route) => {
        expect(route.request().method()).toBe('GET');
        const pathname = new URL(route.request().url()).pathname;
        requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1);
        if (mediaGate) await mediaGate;
        if (pathname === imageUrl && imageAvailable) {
          await route.fulfill({
            status: 200,
            contentType: 'image/png',
            headers: { 'cache-control': 'no-store' },
            body: imageBytes,
          });
        } else {
          await route.fulfill({
            status: 404,
            contentType: 'text/plain',
            headers: { 'cache-control': 'no-store' },
            body: 'Synthetic resource unavailable',
          });
        }
      },
    );
    return {
      requestCounts,
      recoverImage() {
        imageAvailable = true;
      },
      holdMediaResponses() {
        let release!: () => void;
        mediaGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => {
          mediaGate = null;
          release();
        };
      },
      assertObservedFailuresAndNoUnexpectedErrors() {
        for (const item of media) {
          expect(
            requestCounts.get(item.url),
            'initial load and explicit retry: ' + item.url,
          ).toBeGreaterThanOrEqual(2);
          expect(
            (responses.get(item.url) ?? []).filter((status) => status === 404).length,
          ).toBeGreaterThanOrEqual(2);
        }
        expect(responses.get(imageUrl)).toContain(200);
        expect(fileRequests, 'a file link must not trigger speculative loading').toBe(0);
        expect(consoleErrors, 'unexpected browser console errors').toEqual([]);
        expect(pageErrors, 'uncaught browser page errors').toEqual([]);
        expect(failedRequests, 'unexpected failed browser requests').toEqual([]);
        expect(unexpectedHttpErrors, 'unexpected HTTP errors').toEqual([]);
      },
    };
  }

  async function exerciseMedia(
    target: Page,
    scope: import('@playwright/test').Locator,
    observer: Awaited<ReturnType<typeof observeMedia>>,
    phase: 'preview' | 'learner',
  ) {
    const file = scope.getByRole('link', { name: new RegExp(fileLabel) });
    await expect(file).toHaveAttribute('href', fileUrl);
    await expect(file).toHaveAttribute('target', '_blank');
    await expect(file).toHaveAttribute('rel', 'noreferrer');
    await expect(scope.getByText(imageCaption, { exact: true })).toBeVisible();
    await expect(scope.getByText(videoTitle, { exact: true })).toBeVisible();
    await expect(scope.getByText(audioTitle, { exact: true })).toBeVisible();
    await expect(scope.locator('img')).toHaveAttribute('alt', imageAlt);
    await expect(scope.locator('img')).toHaveAttribute('loading', 'lazy');
    for (const kind of ['video', 'audio']) {
      await expect(scope.locator(kind)).toHaveAttribute('controls', '');
      await expect(scope.locator(kind)).toHaveAttribute('preload', 'metadata');
      await expect(scope.locator(kind)).not.toHaveAttribute('autoplay', '');
    }
    for (const item of media) {
      const wrapper = scope.locator(item.selector);
      await wrapper.scrollIntoViewIfNeeded();
      await expect(wrapper.getByRole('alert')).toHaveText(item.message);
      const open = wrapper.getByRole('link', { name: 'Открыть отдельно', exact: true });
      await expect(open).toHaveAttribute('href', item.url);
      await expect(open).toHaveAttribute('target', '_blank');
      await expect(open).toHaveAttribute('rel', 'noreferrer');
    }

    for (const width of [1440, 390, 320]) {
      await target.setViewportSize({ width, height: 900 });
      for (const item of media) {
        const fallback = scope.locator(item.selector).locator('.lesson-media-error');
        await fallback.scrollIntoViewIfNeeded();
        await expect(fallback.getByRole('alert')).toBeVisible();
        for (const control of [
          fallback.getByRole('alert'),
          fallback.getByRole('button', { name: 'Повторить загрузку', exact: true }),
          fallback.getByRole('link', { name: 'Открыть отдельно', exact: true }),
        ]) {
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x, phase + ' left at ' + width).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width, phase + ' right at ' + width).toBeLessThanOrEqual(width);
        }
        const readable = await fallback.getByRole('alert').evaluate((element) => {
          const box = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          const rects = Array.from(range.getClientRects());
          return (
            box.width >= 100 &&
            rects.length > 0 &&
            rects.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1)
          );
        });
        expect(readable, phase + ' readable media error at ' + width).toBe(true);
      }
      expect(
        await target.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await target.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => target.evaluate(() => window.scrollY)).toBe(0);
      await target.screenshot({
        path: directory + '/' + phase + '-error-' + width + '.png',
        fullPage: true,
      });
    }
    await target.setViewportSize({ width: 1440, height: 900 });

    // Retry must issue another real request for the unchanged URL, including
    // when the server still reports failure. No URL cache-busting or auto-play.
    for (const item of media) {
      const wrapper = scope.locator(item.selector);
      const before = observer.requestCounts.get(item.url) ?? 0;
      const retried = target.waitForResponse(
        (response) =>
          response.url() === new URL(item.url, target.url()).href &&
          response.request().method() === 'GET',
      );
      await wrapper.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
      expect((await retried).status()).toBe(404);
      await expect(wrapper.getByRole('alert')).toHaveText(item.message);
      expect(observer.requestCounts.get(item.url)).toBeGreaterThan(before);
      await expect(wrapper).toBeFocused();
    }

    observer.recoverImage();
    const imageWrapper = scope.locator(media[0].selector);
    const recovered = target.waitForResponse(
      (response) =>
        response.url() === new URL(imageUrl, target.url()).href &&
        response.request().method() === 'GET',
    );
    await imageWrapper.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    expect((await recovered).status()).toBe(200);
    await expect
      .poll(() =>
        imageWrapper.locator('img').evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        }),
      )
      .toBe(true);
    await expect(imageWrapper.getByRole('alert')).toHaveCount(0);
    await expect(imageWrapper.getByRole('button', { name: 'Повторить загрузку' })).toHaveCount(0);
    await expect(scope.locator('.lesson-media-error')).toHaveCount(2);
    await expect(imageWrapper).toBeFocused();
    for (const width of [1440, 390, 320]) {
      await target.setViewportSize({ width, height: 900 });
      await imageWrapper.scrollIntoViewIfNeeded();
      await expect(imageWrapper.locator('img')).toBeVisible();
      expect(
        await target.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await target.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => target.evaluate(() => window.scrollY)).toBe(0);
      await target.screenshot({
        path: directory + '/' + phase + '-recovered-' + width + '.png',
        fullPage: true,
      });
    }
    await target.setViewportSize({ width: 1440, height: 900 });
  }

  await loginWithOrganization(page, teacher);
  const authorObserver = await observeMedia(page);
  const handle = 'course-media-' + suffix;
  const joinCode = await createClassWithStudents(page, classTitle, [
    { label: 'Ученик медиа', handle },
  ]);
  const classroomId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;
  await page.goto('/#/challenges');
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/courses',
  );
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const created = await creation;
  expect(created.status()).toBe(201);
  const courseId = ((await created.json()) as { id: string }).id;
  const editor = page.getByTestId('course-editor');
  await editor.getByRole('button', { name: '+ Урок', exact: true }).click();
  await editor.getByLabel('Название урока').fill(lessonTitle);
  await editor
    .getByLabel('Текст блока', { exact: true })
    .fill('Материалы сохраняют свои подписи и адреса.');
  await addCourseBlock(page, 'Картинка');
  await editor.getByLabel('Ссылка на изображение').fill('/assets/initial-' + suffix + '.png');
  await editor.getByLabel('Описание изображения').fill('Исходное изображение');
  await editor.getByLabel('Подпись изображения').fill('Исходная подпись');
  await addCourseBlock(page, 'Файл');
  await editor.getByLabel('Ссылка на файл').fill('https://example.test/initial-' + suffix + '.pdf');
  await editor.getByLabel('Название файла').fill('Исходная памятка');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок добавлен.',
  );
  async function outline() {
    const response = await page.request.get('/api/courses/' + courseId + '/outline');
    expect(response.status()).toBe(200);
    return (await response.json()) as { draftRevision: number; sections: CourseSection[] };
  }
  const initial = await outline();
  const section = initial.sections[0]!;
  const lesson = section.lessons[0]!;
  const lessonPath = '/api/courses/' + courseId + '/lessons/' + lesson.id;
  // The current author menu creates images and file/external-video links.
  // Seed supported persisted platform video/audio through the ordinary
  // authorized revision-checked draft API, then edit them using the real UI.
  // This is not evidence of video/audio UI creation or an upload pipeline.
  const seeded = await page.request.patch(lessonPath, {
    headers: { origin: new URL(page.url()).origin },
    data: {
      sectionId: section.id,
      title: lesson.title,
      summary: lesson.summary,
      content: null,
      blocks: [
        ...lesson.blocks,
        {
          id: crypto.randomUUID(),
          type: 'video',
          url: '/assets/initial-' + suffix + '.webm',
          title: 'Исходное видео',
        },
        {
          id: crypto.randomUUID(),
          type: 'audio',
          url: '/assets/initial-' + suffix + '.wav',
          title: 'Исходное аудио',
        },
      ],
      kind: 'material',
      assignmentId: null,
      learningActivityVersionId: null,
      estimatedMinutes: null,
      expectedRevision: initial.draftRevision,
    },
  });
  expect(seeded.status()).toBe(200);
  expect((await seeded.json()).id).toBe(lesson.id);
  async function reopen() {
    await page.reload();
    await page.getByRole('button', { name: 'Курсы', exact: true }).click();
    await page
      .getByTestId('courses-list')
      .getByRole('button')
      .filter({ hasText: courseTitle })
      .click();
    await expect(editor.getByLabel('Название урока')).toHaveValue(lessonTitle);
  }
  await reopen();
  await editor.getByLabel('Ссылка на изображение').fill(imageUrl);
  await editor.getByLabel('Описание изображения').fill(imageAlt);
  await editor.getByLabel('Подпись изображения').fill(imageCaption);
  await editor.getByLabel('Ссылка на файл').fill(fileUrl);
  await editor.getByLabel('Название файла').fill(fileLabel);
  await editor.getByLabel('Ссылка на видео').fill(videoUrl);
  await editor.getByLabel('Ссылка на аудио').fill(audioUrl);
  await editor
    .locator('.lesson-block-card')
    .filter({ has: page.getByLabel('Ссылка на видео') })
    .getByLabel('Название медиа')
    .fill(videoTitle);
  await editor
    .locator('.lesson-block-card')
    .filter({ has: page.getByLabel('Ссылка на аудио') })
    .getByLabel('Название медиа')
    .fill(audioTitle);
  const save = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname === lessonPath,
  );
  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  expect((await save).status()).toBe(200);
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок сохранён.',
  );
  await reopen();
  for (const [label, value] of [
    ['Ссылка на изображение', imageUrl],
    ['Описание изображения', imageAlt],
    ['Подпись изображения', imageCaption],
    ['Ссылка на файл', fileUrl],
    ['Название файла', fileLabel],
    ['Ссылка на видео', videoUrl],
    ['Ссылка на аудио', audioUrl],
  ])
    await expect(editor.getByLabel(label)).toHaveValue(value);
  const saved = await outline();
  expect(saved.sections[0]!.lessons[0]!.blocks.map((block) => block.type)).toEqual([
    'paragraph',
    'image',
    'file',
    'video',
    'audio',
  ]);
  expect(saved.sections[0]!.lessons[0]!.blocks).toEqual([
    lesson.blocks[0],
    { ...lesson.blocks[1], url: imageUrl, alt: imageAlt, caption: imageCaption },
    { ...lesson.blocks[2], url: fileUrl, label: fileLabel },
    expect.objectContaining({ type: 'video', url: videoUrl, title: videoTitle }),
    expect.objectContaining({ type: 'audio', url: audioUrl, title: audioTitle }),
  ]);
  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  await expect(preview).toBeVisible();
  await exerciseMedia(page, preview.locator('.lesson-blocks').first(), authorObserver, 'preview');
  expect(await outline(), 'error, open affordance and retry do not write the draft').toEqual(saved);
  authorObserver.assertObservedFailuresAndNoUnexpectedErrors();
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await openCourseStructure(page);
  const lessonActions = editor.locator('details.course-outline-menu').filter({
    has: page.getByRole('button', { name: 'Действия урока «' + lessonTitle + '»', exact: true }),
  });
  await lessonActions
    .getByRole('button', { name: 'Действия урока «' + lessonTitle + '»', exact: true })
    .click();
  await lessonActions.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(editor.getByRole('status', { name: 'Уведомление курса', exact: true })).toHaveText(
    'Урок продублирован.',
  );
  const duplicated = await outline();
  expect(duplicated.sections[0]!.lessons).toHaveLength(2);
  expect(duplicated.sections[0]!.lessons[1]!.id).not.toBe(lesson.id);
  expect(duplicated.sections[0]!.lessons[1]!.blocks).toEqual(saved.sections[0]!.lessons[0]!.blocks);
  const publish = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/courses/' + courseId + '/publish',
  );
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const published = await publish;
  expect(published.status()).toBe(201);
  const version = (await published.json()) as { versionId: string; versionNumber: number };
  expect(version.versionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  expect(version.versionNumber).toBe(1);
  const historyResponse = await page.request.get('/api/courses/' + courseId + '/versions');
  expect(historyResponse.status()).toBe(200);
  const history = await historyResponse.json();
  expect(history.items).toHaveLength(1);
  expect(history.items[0]).toMatchObject({ id: version.versionId, versionNumber: 1 });
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  const assignDialog = page.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await assignDialog.getByLabel('Класс для курса').selectOption({ label: classTitle });
  const assignment = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/classrooms/' + classroomId + '/course-runs',
  );
  await assignDialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  const assigned = await assignment;
  expect(assigned.status()).toBe(201);
  const receipt = (await assigned.json()) as {
    runId: string;
    versionNumber: number;
    reused: boolean;
  };
  expect(receipt).toMatchObject({ versionNumber: 1, reused: false });
  await expect(assignDialog.getByRole('status')).toContainText('Сервер подтвердил версию 1');
  await assignDialog.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();
  const learner = await learnerAssignments(browser, joinCode, handle);
  try {
    const learnerObserver = await observeMedia(learner.page);
    await learner.page.goto('/#/learning?courseRun=' + receipt.runId);
    await learner.page.reload();
    const player = learner.page.getByTestId('seat-course-player');
    await expect(player.getByRole('heading', { name: lessonTitle, exact: true })).toBeVisible();
    await exerciseMedia(
      learner.page,
      player.locator('.lesson-blocks').first(),
      learnerObserver,
      'learner',
    );
    const delivered = await learner.page.request.get('/api/class-join/me/course-runs');
    expect(delivered.status()).toBe(200);
    const run = (await delivered.json()).items.find(
      (item: { id: string }) => item.id === receipt.runId,
    );
    expect(run).toMatchObject({ courseVersionId: version.versionId, versionNumber: 1 });
    expect(run.sections[0].lessons).toHaveLength(2);
    const publishedBlocks = saved.sections[0]!.lessons[0]!.blocks.map(({ hidden, ...block }) => {
      expect(hidden === undefined || hidden === false, 'media fixture blocks remain visible').toBe(
        true,
      );
      return block;
    });
    expect(run.sections[0].lessons[0].blocks).toEqual(publishedBlocks);
    expect(run.sections[0].lessons[1].blocks).toEqual(publishedBlocks);
    // Duplicated lessons deliberately preserve block IDs and resource URLs.
    // Hold the real new loads to observe that the previous lesson's error is
    // cleared before the new lesson receives its own resource outcome.
    const beforeSwitch = new Map(learnerObserver.requestCounts);
    const releaseMedia = learnerObserver.holdMediaResponses();
    try {
      const navigation = player.getByRole('navigation', { name: 'Переход между уроками' });
      await expect(navigation).toContainText('1 из 2');
      await player
        .getByRole('complementary', { name: 'Содержание курса' })
        .getByRole('button')
        .nth(1)
        .click();
      await expect(navigation).toContainText('2 из 2');
      for (const item of media) {
        await player.locator(item.selector).scrollIntoViewIfNeeded();
        await expect
          .poll(() => learnerObserver.requestCounts.get(item.url) ?? 0)
          .toBeGreaterThan(beforeSwitch.get(item.url) ?? 0);
      }
      await expect(player.locator('.lesson-media-error')).toHaveCount(0);
    } finally {
      releaseMedia();
    }
    await expect(player.locator(media[1].selector).getByRole('alert')).toHaveText(media[1].message);
    await expect(player.locator(media[2].selector).getByRole('alert')).toHaveText(media[2].message);
    await expect
      .poll(() =>
        player
          .locator(media[0].selector)
          .locator('img')
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    learnerObserver.assertObservedFailuresAndNoUnexpectedErrors();
  } finally {
    await learner.context.close();
  }
  const finalHistory = await page.request.get('/api/courses/' + courseId + '/versions');
  expect(finalHistory.status()).toBe(200);
  expect(await finalHistory.json(), 'media failures and retry preserve published history').toEqual(
    history,
  );
  authorObserver.assertObservedFailuresAndNoUnexpectedErrors();
});
