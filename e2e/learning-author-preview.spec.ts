import {
  addCourseBlock,
  openCourseActions,
  openCourseHistory,
  openCourseBlockActions,
} from './learning-authoring-navigation';
import { expect, test, type Dialog, type Locator, type Page, type Route } from '@playwright/test';
import { openCourseNativeZoom } from './course-editor-native-zoom';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  addAssignmentBlock,
  closeAssignmentPreview,
  closeAssignmentSettings,
  openExistingAssignmentEditor,
  openNewAssignmentEditor,
  openAssignmentSettings,
  previewAssignmentAs,
  openCourseStructure,
  openCourseLessonSettings,
  closeCourseLessonSettings,
} from './learning-authoring-navigation';

test('exact saved and published learner preview ignores late responses and creates no commands', async ({
  page,
}) => {
  test.setTimeout(90000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@preview.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('p' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор предпросмотра');
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
  await page.getByLabel('Название задания', { exact: true }).fill('Published V1');
  await page.getByLabel('Содержание', { exact: true }).fill('Published instructions V1');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  await page.getByLabel('Название задания', { exact: true }).fill('Saved draft r2');
  await page.getByLabel('Содержание', { exact: true }).fill('Saved instructions r2');
  const previewButton = page.getByRole('button', { name: 'Предпросмотр', exact: true });
  await expect(previewButton).toBeDisabled();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(previewButton).toBeEnabled();
  const mutations: string[] = [];
  const qualityTelemetryUrl = new URL('/api/analytics/v2/quality', page.url()).href;
  page.on('request', (request) => {
    // This fixed endpoint persists background delivery counters.
    if (request.method() === 'POST' && request.url() === qualityTelemetryUrl) return;
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
      mutations.push(request.method() + ' ' + request.url());
  });
  await previewButton.click();
  const previewDrawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  await expect(previewDrawer).toBeVisible();
  const draftButton = previewDrawer.getByRole('button', { name: 'Черновик', exact: true });
  const publishedButton = previewDrawer.getByRole('button', {
    name: 'Опубликованная версия',
    exact: true,
  });
  const preview = previewDrawer.getByTestId('learner-preview');
  await draftButton.click();
  await expect(preview.getByRole('heading', { name: 'Saved draft r2' })).toBeVisible();
  await expect(preview.getByTestId('assignment-view')).toContainText('Saved instructions r2');
  await publishedButton.click();
  await expect(preview.getByRole('heading', { name: 'Published V1' })).toBeVisible();
  await expect(preview.getByTestId('assignment-view')).toContainText('Published instructions V1');
  mkdirSync('e2e/artifacts/learning/author-preview', { recursive: true });
  await preview.screenshot({ path: 'e2e/artifacts/learning/author-preview/published-v1.png' });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  let delivered!: () => void;
  const completed = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  // Delay a real server response, retaining its actual content and status.
  await page.route('**/preview?source=published*', async (route) => {
    const response = await route.fetch();
    intercepted();
    await delayed;
    await route.fulfill({ response });
    delivered();
  });
  await publishedButton.click();
  await started;
  await draftButton.click();
  await expect(preview.getByRole('heading', { name: 'Saved draft r2' })).toBeVisible();
  const lateResponse = page.waitForResponse((response) =>
    response.url().includes('/preview?source=published'),
  );
  release();
  await completed;
  await (await lateResponse).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(preview.getByRole('heading', { name: 'Saved draft r2' })).toBeVisible();
  expect(mutations).toEqual([]);
  await preview.screenshot({ path: 'e2e/artifacts/learning/author-preview/saved-draft-r2.png' });
  await closeAssignmentPreview(page);

  mkdirSync('e2e/artifacts/learning/teacher-authoring', { recursive: true });
  for (const [width, height, file] of [
    [1440, 900, 'editor-desktop.png'],
    [1024, 768, 'editor-1024.png'],
    [390, 844, 'editor-390.png'],
    [320, 720, 'editor-320.png'],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `e2e/artifacts/learning/teacher-authoring/${file}`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await openAssignmentSettings(page);
  const settings = page.getByRole('dialog', { name: 'Настройки' });
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(settings.getByLabel('Среда проекта')).toBeVisible();
    await expect(settings.getByLabel('Результат')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `e2e/artifacts/learning/teacher-authoring/settings-${width}.png`,
      fullPage: true,
    });
  }
  await closeAssignmentSettings(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: '← Задания', exact: true }).click();
  await expect(page.locator('.authored-assignment-list')).toBeVisible();
  await expect(page.locator('.authored-assignment-row')).toHaveCount(1);
  await expect(page.getByText('Опубликовано', { exact: true })).toBeVisible();

  mkdirSync('e2e/artifacts/learning/v-ux2a', { recursive: true });
  for (const [width, height, file] of [
    [1440, 900, 'desktop-1440.png'],
    [1024, 768, 'tablet-1024.png'],
    [390, 844, 'mobile-390.png'],
    [320, 720, 'mobile-320.png'],
  ] as const) {
    await page.setViewportSize({ width, height });
    const workspace = page.locator('.authored-assignment-workspace');
    const search = workspace.getByRole('searchbox');
    const filters = workspace.getByRole('group', { name: 'Фильтр по статусу' }).getByRole('button');
    const create = workspace.getByRole('button', { name: '+ Новое задание', exact: true });
    await expect(filters).toHaveCount(3);
    const workspaceBounds = await workspace.boundingBox();
    expect(workspaceBounds).not.toBeNull();
    for (const control of [search, ...(await filters.all()), create]) {
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x, `Toolbar control left at ${width}px`).toBeGreaterThanOrEqual(
        workspaceBounds!.x,
      );
      expect(bounds!.x + bounds!.width, `Toolbar control right at ${width}px`).toBeLessThanOrEqual(
        workspaceBounds!.x + workspaceBounds!.width,
      );
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `e2e/artifacts/learning/v-ux2a/${file}`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await openExistingAssignmentEditor(page, 'Saved draft r2');
  await page.getByLabel('Название задания', { exact: true }).fill('Unsaved navigation guard');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await expect(page.getByLabel('Название задания', { exact: true })).toHaveValue(
    'Unsaved navigation guard',
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .getByRole('navigation', { name: 'Разделы ASA Lab' })
    .getByRole('link', { name: 'Знания', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/challenges$/);
  await expect(page.getByLabel('Название задания', { exact: true })).toHaveValue(
    'Unsaved navigation guard',
  );
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Разделы курсов и заданий' })
      .getByRole('button', { name: 'Курсы', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

test('ordered safe task blocks remain pinned in v1 preview at four widths after a future draft edit', async ({
  page,
}) => {
  test.setTimeout(90000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@blocks.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('b' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор блоков');
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
  await page.getByLabel('Название задания', { exact: true }).fill('Task blocks v1');
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Read the legacy task instructions first.');
  await addAssignmentBlock(page, 'Заголовок');
  await page.getByLabel('Текст блока 1').fill('Read the circuit');
  await addAssignmentBlock(page, 'Текст');
  await page.getByLabel('Текст блока 2').fill('Connect the lamp first.');
  await addAssignmentBlock(page, 'Список');
  await page.getByLabel('Пункты блока 3').fill('Connect the lamp\nCheck polarity');
  await addAssignmentBlock(page, 'Примечание');
  await page.getByLabel('Текст блока 4').fill('Disconnect power before changing wires.');
  await addAssignmentBlock(page, 'Ссылка на сайт или видео');
  await page.getByLabel('Текст блока 5').fill('Read reference');
  await page.getByLabel('Адрес блока 5').fill('https://example.org/reference');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  await previewAssignmentAs(page, 'published');
  const preview = page
    .getByRole('dialog', { name: 'Как увидит ученик' })
    .getByTestId('learner-preview');
  const blocks = preview.getByTestId('task-blocks');
  await expect(blocks).toContainText('Read the legacy task instructions first.');
  await expect(blocks).toContainText('Connect the lamp first.');
  const visibleText = await blocks.innerText();
  expect(visibleText.indexOf('Read the legacy task instructions first.')).toBeLessThan(
    visibleText.indexOf('Read the circuit'),
  );
  await expect(blocks.getByRole('link', { name: 'Read reference' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  mkdirSync('e2e/artifacts/learning/task-blocks-a2c', { recursive: true });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(blocks).toBeVisible();
    await preview.screenshot({
      path: `e2e/artifacts/learning/task-blocks-a2c/author-preview-${width}.png`,
    });
  }
  await closeAssignmentPreview(page);
  await page.getByLabel('Текст блока 2').fill('Future draft paragraph.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await previewAssignmentAs(page, 'published');
  await expect(blocks).toContainText('Connect the lamp first.');
  await expect(blocks).toContainText('Read the legacy task instructions first.');
  await expect(blocks).not.toContainText('Future draft paragraph.');
});

test('draft from historical Course and Activity versions uses the author UI, protects an active draft and publishes root-next versions', async ({
  page,
}) => {
  test.setTimeout(150000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@preview.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('p' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор предпросмотра');
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

  for (const n of [1, 2, 3]) {
    await page.getByLabel('Название задания', { exact: true }).fill('Material V' + n);
    await page.getByLabel('Содержание', { exact: true }).fill('Material content V' + n);
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(
      page.getByText('Опубликована версия ' + n + '. Материал остаётся закрытым.'),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'История версий', exact: true }).click();
  let history = page.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await expect(history.getByRole('heading', { name: 'Material V1', exact: true })).toBeVisible();
  let releaseRestore!: () => void;
  const delayedRestore = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  let startedRestore!: () => void;
  const restoreStarted = new Promise<void>((resolve) => {
    startedRestore = resolve;
  });
  await page.route('**/learning/activities/*/versions/*/draft', async (route) => {
    const response = await route.fetch();
    startedRestore();
    await delayedRestore;
    await route.fulfill({ response });
  });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await restoreStarted;
  await expect(page.getByLabel('Название задания', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Содержание', { exact: true })).toBeDisabled();
  releaseRestore();

  await expect(page.getByLabel('Название задания', { exact: true })).toHaveValue('Material V1');
  await expect(page.getByLabel('Содержание', { exact: true })).toHaveValue('Material content V1');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Опубликована версия 4. Материал остаётся закрытым.')).toBeVisible();
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill('Historical course');
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const editor = page.getByTestId('course-editor');
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Lesson V1');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Exact historical lesson V1');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  await openCourseHistory(page);
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(page.getByText('Черновик создан на основе версии 1', { exact: true })).toBeVisible();
  await openCourseHistory(page);
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(history.getByRole('alert')).toContainText('Уже существует черновик');
  await history.getByRole('button', { name: 'Открыть существующий черновик' }).click();
  await openCourseBlockActions(page, 0);
  await editor.getByRole('button', { name: 'Удалить блок 1', exact: true }).click();
  await openCourseHistory(page);
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await expect(
    history.getByRole('button', { name: 'Создать черновик из этой версии' }),
  ).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Опубликовать v2', exact: true })).toBeDisabled();
  await addCourseBlock(page, 'Текст');
  for (const n of [2, 3]) {
    await editor.getByLabel('Название урока').fill('Lesson V' + n);
    await editor.getByLabel('Текст блока', { exact: true }).fill('Lesson content V' + n);
    await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
    await expect(page.getByText('Урок сохранён.', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Опубликовать v' + n, exact: true }).click();
    await expect(
      page.getByText('Курс опубликован: версия ' + n + '.', { exact: true }),
    ).toBeVisible();
  }
  await openCourseHistory(page);
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await expect(history.getByRole('heading', { name: 'Lesson V1', exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(editor.getByLabel('Название урока')).toHaveValue('Lesson V1');
  await expect(editor.getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Exact historical lesson V1',
  );
  mkdirSync('e2e/artifacts/learning/version-draft', { recursive: true });
  await editor.screenshot({ path: 'e2e/artifacts/learning/version-draft/from-v1.png' });
  await editor.getByRole('button', { name: 'Опубликовать v4', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 4.', { exact: true })).toBeVisible();
  await openCourseHistory(page);
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 4' });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(page.getByText('Черновик создан на основе версии 4', { exact: true })).toBeVisible();
  let releaseOutline!: () => void;
  const delayedOutline = new Promise<void>((resolve) => {
    releaseOutline = resolve;
  });
  let startedOutline!: () => void;
  const outlineStarted = new Promise<void>((resolve) => {
    startedOutline = resolve;
  });
  let publicationFinished = false;
  page.on('response', (response) => {
    if (response.url().endsWith('/publish')) publicationFinished = true;
  });
  await page.route('**/courses/*/outline', async (route) => {
    if (!publicationFinished) return route.continue();
    const response = await route.fetch();
    startedOutline();
    await delayedOutline;
    await route.fulfill({ response });
  });
  await editor.getByRole('button', { name: 'Опубликовать v5', exact: true }).click();
  await outlineStarted;
  await editor.getByLabel('Название урока').fill('Unsaved input during outline refresh');
  releaseOutline();

  await expect(page.getByText('Публикация подтверждена: версия 4.', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: /^Опубликовать/ })).toHaveCount(0);
  await expect(editor.getByLabel('Название урока')).toHaveValue(
    'Unsaved input during outline refresh',
  );
  await openCourseHistory(page);
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 4' });
  await expect(
    history.getByRole('button', { name: 'Создать черновик из этой версии' }),
  ).toBeDisabled();
  await editor.screenshot({ path: 'e2e/artifacts/learning/version-draft/published-v4.png' });
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

test('content-first image and PDF keep the new draft selectable as a project practice', async ({
  page,
}) => {
  test.setTimeout(120000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Content first ' + unique;
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@content-first.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('c' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор практики');
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль', { exact: true }).fill('Strong-' + unique + '-Password');
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
  const session = await page.request.get('/api/auth/me');
  expect(session.ok()).toBeTruthy();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Материалы и классы', exact: true })
    .click();
  await page.getByRole('button', { name: 'Подключить авторство', exact: true }).click();
  await page.goto('/#/challenges');
  await page.getByRole('button', { name: /Новое задание/ }).click();
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  const activityCreates: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/learning/activities'
    )
      activityCreates.push(request.url());
  });
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('Файл блока изображения').setInputFiles({
    name: 'content-first.png',
    mimeType: 'image/png',
    buffer: solidPng(30, 120, 180),
  });
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('PDF файл задания').setInputFiles({
    name: 'content-first.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nContent first practice\n%%EOF'),
  });
  await expect(page.getByText('content-first.png · ожидает сохранения')).toBeVisible();
  await expect(page.getByText('content-first.pdf · ожидает сохранения')).toBeVisible();
  expect(activityCreates).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled();
  await openAssignmentSettings(page);
  await page
    .getByRole('dialog', { name: 'Настройки' })
    .getByLabel('Среда проекта')
    .selectOption('electronics');
  await closeAssignmentSettings(page);
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  expect(activityCreates).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeEnabled();
  await page.reload();
  await openExistingAssignmentEditor(page, title);
  await previewAssignmentAs(page, 'draft');
  const preview = page.getByRole('dialog', { name: 'Как увидит ученик' });
  await expect(preview.getByText('content-first.pdf')).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Изображение задания' })).toBeVisible();
});

test('first-class image block survives draft reload and pins exact published bytes', async ({
  page,
}) => {
  test.setTimeout(150000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Image block ' + unique;
  const imageA = solidPng(210, 40, 40, 240, 120);
  const imageB = solidPng(40, 70, 210, 240, 120);
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@task-image.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('i' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор изображения');
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
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Сначала прочитайте инструкцию.');
  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page.getByLabel('Файл блока изображения').setInputFiles({
    name: 'task-a.png',
    mimeType: 'image/png',
    buffer: imageA,
  });
  await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
  await page.getByLabel('Описание блока 1').fill('Первая схема');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.reload();
  await openExistingAssignmentEditor(page, title);
  await expect(page.getByLabel('Описание блока 1')).toHaveValue('Первая схема');
  await previewAssignmentAs(page, 'draft');
  const preview = page
    .getByRole('dialog', { name: 'Как увидит ученик' })
    .getByTestId('learner-preview');
  const draftImage = preview.getByRole('img', { name: 'Первая схема' });
  await expect(draftImage).toBeVisible();
  const draftSource = await draftImage.getAttribute('src');
  expect(draftSource).toContain('/draft-task-image?v=');
  const draftBytes = await page.request.get(new URL(draftSource!, page.url()).toString());
  expect(draftBytes.ok()).toBe(true);
  expect(Buffer.compare(await draftBytes.body(), imageA)).toBe(0);
  await closeAssignmentPreview(page);
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  await previewAssignmentAs(page, 'published');
  const versionImage = preview.getByRole('img', { name: 'Первая схема' });
  await expect(versionImage).toBeVisible();
  const v1Source = await versionImage.getAttribute('src');
  expect(v1Source).toContain('/versions/');
  const a6Evidence = 'e2e/artifacts/learning/task-image-a6';
  mkdirSync(a6Evidence, { recursive: true });
  await preview.getByRole('button', { name: 'Открыть крупно: Первая схема' }).click();
  const desktopZoom = page.getByRole('dialog', { name: 'Изображение задания: Первая схема' });
  await expect(desktopZoom.getByRole('img', { name: 'Первая схема' })).toHaveAttribute(
    'src',
    v1Source!,
  );
  await page.screenshot({ path: `${a6Evidence}/published-v1-zoom-desktop.png` });
  await page.keyboard.press('Escape');
  await expect(desktopZoom).toHaveCount(0);
  await preview.getByRole('button', { name: 'Закрепить изображение: Первая схема' }).click();
  const desktopReference = page.getByTestId('task-image-reference-window');
  await expect(desktopReference.getByRole('img', { name: 'Первая схема' })).toHaveAttribute(
    'src',
    v1Source!,
  );
  await page.screenshot({ path: `${a6Evidence}/published-v1-pinned-desktop.png` });
  await desktopReference.getByRole('button', { name: 'Закрыть окно: Материал' }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await versionImage.scrollIntoViewIfNeeded();
  await expect(versionImage).toHaveJSProperty('naturalWidth', 240);
  await expect(versionImage).toHaveJSProperty('naturalHeight', 120);
  const imageBounds = await versionImage.boundingBox();
  expect(imageBounds).not.toBeNull();
  expect(imageBounds!.width).toBeGreaterThanOrEqual(200);
  expect(imageBounds!.height).toBeGreaterThanOrEqual(100);
  expect(imageBounds!.x).toBeGreaterThanOrEqual(0);
  expect(imageBounds!.x + imageBounds!.width).toBeLessThanOrEqual(320);
  mkdirSync('e2e/artifacts/learning/task-image-a2d', { recursive: true });
  await preview.screenshot({ path: 'e2e/artifacts/learning/task-image-a2d/published-v1-320.png' });
  await preview.getByRole('button', { name: 'Открыть крупно: Первая схема' }).click();
  const mobileZoom = page.getByRole('dialog', { name: 'Изображение задания: Первая схема' });
  await expect(mobileZoom.getByRole('img', { name: 'Первая схема' })).toHaveAttribute(
    'src',
    v1Source!,
  );
  await page.screenshot({ path: `${a6Evidence}/published-v1-zoom-320.png` });
  await mobileZoom.getByRole('button', { name: 'Закрыть' }).click();
  await preview.getByRole('button', { name: 'Закрепить изображение: Первая схема' }).click();
  const mobileReference = page.getByTestId('task-image-reference-window');
  await expect(mobileReference.getByRole('img', { name: 'Первая схема' })).toHaveAttribute(
    'src',
    v1Source!,
  );
  const referenceBounds = await mobileReference.boundingBox();
  expect(referenceBounds).not.toBeNull();
  expect(referenceBounds!.x).toBeGreaterThanOrEqual(0);
  expect(referenceBounds!.x + referenceBounds!.width).toBeLessThanOrEqual(320);
  const mobileTitle = mobileReference.locator('#task-image-reference-title');
  await expect(mobileTitle).toHaveText('Материал');
  expect(await mobileTitle.evaluate((title) => title.scrollWidth <= title.clientWidth)).toBe(true);
  await page.screenshot({ path: `${a6Evidence}/published-v1-pinned-320.png` });
  await mobileReference.getByRole('button', { name: 'Закрыть окно: Материал' }).click();
  await closeAssignmentPreview(page);

  await page.getByLabel('Заменить файл блока 1').setInputFiles({
    name: 'task-b.png',
    mimeType: 'image/png',
    buffer: imageB,
  });
  await expect(page.getByText('Изображение добавлено в содержание задания.')).toBeVisible();
  const staleDraftBytes = await page.request.get(new URL(draftSource!, page.url()).toString());
  expect(staleDraftBytes.status()).toBe(404);
  await previewAssignmentAs(page, 'published');
  const pinnedBytes = await page.request.get(new URL(v1Source!, page.url()).toString());
  expect(Buffer.compare(await pinnedBytes.body(), imageA)).toBe(0);
  await closeAssignmentPreview(page);
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 2/)).toBeVisible();
  await previewAssignmentAs(page, 'published');
  const v2Source = await preview.getByRole('img', { name: 'Первая схема' }).getAttribute('src');
  expect(v2Source).not.toBe(v1Source);
  const v2Bytes = await page.request.get(new URL(v2Source!, page.url()).toString());
  expect(Buffer.compare(await v2Bytes.body(), imageB)).toBe(0);
  await page.route(new URL(v2Source!, page.url()).toString(), (route) =>
    route.fulfill({ status: 404, body: 'unavailable' }),
  );
  await page.reload();
  await openExistingAssignmentEditor(page, title);
  await previewAssignmentAs(page, 'published');
  const unavailableAlert = preview.getByRole('alert');
  await expect(unavailableAlert).toContainText('Изображение задания недоступно');
  await unavailableAlert.scrollIntoViewIfNeeded();
  const unavailableBounds = await unavailableAlert.boundingBox();
  expect(unavailableBounds).not.toBeNull();
  expect(unavailableBounds!.y).toBeGreaterThanOrEqual(0);
  expect(unavailableBounds!.y + unavailableBounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: `${a6Evidence}/published-v2-unavailable-320.png` });
});

test('teacher draft image persists, replaces and deletes', async ({ page }) => {
  test.setTimeout(120000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Draft image ' + unique;
  const imageA = solidPng(220, 40, 40);
  const imageB = solidPng(40, 80, 220);
  const legacyMutations: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/api/assignments') && !['GET', 'HEAD'].includes(request.method())) {
      legacyMutations.push(request.method() + ' ' + request.url());
    }
  });

  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@draft-image.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('d' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор картинки');
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
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Соберите схему по изображению.');
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  const fileInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await fileInput.setInputFiles({ name: 'image-a.png', mimeType: 'image/png', buffer: imageA });
  await expect(page.getByRole('img', { name: 'Схема / изображение задания' })).toBeVisible();

  await page.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();

  await page.reload();
  await openExistingAssignmentEditor(page, title);
  const savedImageA = page.getByRole('img', { name: 'Схема / изображение задания' });
  await expect(savedImageA).toBeVisible();
  const sourceA = await savedImageA.getAttribute('src');
  expect(sourceA).toBeTruthy();
  const responseA = await page.request.get(new URL(sourceA!, page.url()).toString());
  expect(responseA.ok()).toBe(true);
  expect(Buffer.compare(await responseA.body(), imageA)).toBe(0);

  await previewAssignmentAs(page, 'draft');
  const preview = page
    .getByRole('dialog', { name: 'Как увидит ученик' })
    .getByTestId('learner-preview');
  await expect(preview.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(preview.getByRole('img', { name: `Образец: ${title}` })).toBeVisible();
  await closeAssignmentPreview(page);

  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await page
    .getByLabel('Файл схемы или изображения', { exact: true })
    .setInputFiles({ name: 'image-b.png', mimeType: 'image/png', buffer: imageB });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();

  await page.reload();
  await openExistingAssignmentEditor(page, title);
  const savedImageB = page.getByRole('img', { name: 'Схема / изображение задания' });
  await expect(savedImageB).toBeVisible();
  const sourceB = await savedImageB.getAttribute('src');
  expect(sourceB).toBeTruthy();
  expect(sourceB).not.toBe(sourceA);
  const responseB = await page.request.get(new URL(sourceB!, page.url()).toString());
  expect(responseB.ok()).toBe(true);
  expect(Buffer.compare(await responseB.body(), imageB)).toBe(0);

  await page.getByRole('button', { name: 'Удалить образец', exact: true }).click();
  await expect(page.getByText('Изображение удалено.', { exact: true })).toBeVisible();

  await page.reload();
  await openExistingAssignmentEditor(page, title);
  await expect(page.getByRole('img', { name: 'Схема / изображение задания' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '+ Добавить содержимое', exact: true }),
  ).toBeVisible();
  expect(legacyMutations).toEqual([]);
});

test('published task image stays immutable across versions', async ({ page }) => {
  test.setTimeout(150000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Published image ' + unique;
  const imageA = solidPng(210, 45, 45);
  const imageB = solidPng(35, 75, 215);

  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@published-image.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('v' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор версии');
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
  await page.getByLabel('Название задания', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Опубликованная схема A/B.');
  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  const fileInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await fileInput.setInputFiles({
    name: 'published-a.png',
    mimeType: 'image/png',
    buffer: imageA,
  });

  const v1ResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const v1Response = await v1ResponsePromise;
  expect(v1Response.ok()).toBe(true);
  const v1Receipt = (await v1Response.json()) as { id: string; versionNumber: number };
  expect(v1Receipt.versionNumber).toBe(1);
  const activityMatch = /\/api\/learning\/activities\/([^/]+)\/publish$/.exec(
    new URL(v1Response.url()).pathname,
  );
  expect(activityMatch).toBeTruthy();
  const activityId = decodeURIComponent(activityMatch![1]!);

  await previewAssignmentAs(page, 'published');
  const previewDrawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  const preview = previewDrawer.getByTestId('learner-preview');
  const publishedV1Image = preview.getByRole('img', { name: `Образец: ${title}` });
  await expect(publishedV1Image).toBeVisible();
  const publishedV1Source = await publishedV1Image.getAttribute('src');
  expect(publishedV1Source).toBeTruthy();
  const publishedV1Bytes = await page.request.get(
    new URL(publishedV1Source!, page.url()).toString(),
  );
  expect(publishedV1Bytes.ok()).toBe(true);
  expect(Buffer.compare(await publishedV1Bytes.body(), imageA)).toBe(0);
  await closeAssignmentPreview(page);

  await page.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await fileInput.setInputFiles({
    name: 'published-b.png',
    mimeType: 'image/png',
    buffer: imageB,
  });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();

  await previewAssignmentAs(page, 'draft');
  const reopenedPreviewDrawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  const reopenedDraftButton = reopenedPreviewDrawer.getByRole('button', {
    name: 'Черновик',
    exact: true,
  });
  const reopenedPublishedButton = reopenedPreviewDrawer.getByRole('button', {
    name: 'Опубликованная версия',
    exact: true,
  });
  await reopenedDraftButton.click();
  const draftBImage = preview.getByRole('img', { name: `Образец: ${title}` });
  await expect(draftBImage).toBeVisible();
  const draftBSource = await draftBImage.getAttribute('src');
  expect(draftBSource).toBeTruthy();
  const draftBBytes = await page.request.get(new URL(draftBSource!, page.url()).toString());
  expect(draftBBytes.ok()).toBe(true);
  expect(Buffer.compare(await draftBBytes.body(), imageB)).toBe(0);

  await reopenedPublishedButton.click();
  const v1StillAImage = preview.getByRole('img', { name: `Образец: ${title}` });
  const v1StillASource = await v1StillAImage.getAttribute('src');
  expect(v1StillASource).toBeTruthy();
  const v1StillABytes = await page.request.get(new URL(v1StillASource!, page.url()).toString());
  expect(v1StillABytes.ok()).toBe(true);
  expect(Buffer.compare(await v1StillABytes.body(), imageA)).toBe(0);
  await closeAssignmentPreview(page);

  const v2ResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/learning\/activities\/[^/]+\/publish$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const v2Response = await v2ResponsePromise;
  expect(v2Response.ok()).toBe(true);
  const v2Receipt = (await v2Response.json()) as { id: string; versionNumber: number };
  expect(v2Receipt.versionNumber).toBe(2);
  expect(v2Receipt.id).not.toBe(v1Receipt.id);

  await previewAssignmentAs(page, 'published');
  const publishedV2Image = preview.getByRole('img', { name: `Образец: ${title}` });
  await expect(publishedV2Image).toBeVisible();
  const publishedV2Source = await publishedV2Image.getAttribute('src');
  expect(publishedV2Source).toBeTruthy();
  const publishedV2Bytes = await page.request.get(
    new URL(publishedV2Source!, page.url()).toString(),
  );
  expect(publishedV2Bytes.ok()).toBe(true);
  expect(Buffer.compare(await publishedV2Bytes.body(), imageB)).toBe(0);

  const exactV1Preview = await page.request.get(
    new URL(
      `/api/learning/activities/${encodeURIComponent(activityId)}/preview?source=published&versionId=${encodeURIComponent(v1Receipt.id)}`,
      page.url(),
    ).toString(),
  );
  expect(exactV1Preview.ok()).toBe(true);
  const exactV1 = (await exactV1Preview.json()) as { assignment: { sampleImage: string | null } };
  expect(exactV1.assignment.sampleImage).toBeTruthy();
  const exactV1Bytes = await page.request.get(
    new URL(exactV1.assignment.sampleImage!, page.url()).toString(),
  );
  expect(exactV1Bytes.ok()).toBe(true);
  expect(Buffer.compare(await exactV1Bytes.body(), imageA)).toBe(0);

  const exactV2Preview = await page.request.get(
    new URL(
      `/api/learning/activities/${encodeURIComponent(activityId)}/preview?source=published&versionId=${encodeURIComponent(v2Receipt.id)}`,
      page.url(),
    ).toString(),
  );
  expect(exactV2Preview.ok()).toBe(true);
  const exactV2 = (await exactV2Preview.json()) as { assignment: { sampleImage: string | null } };
  expect(exactV2.assignment.sampleImage).toBeTruthy();
  const exactV2Bytes = await page.request.get(
    new URL(exactV2.assignment.sampleImage!, page.url()).toString(),
  );
  expect(exactV2Bytes.ok()).toBe(true);
  expect(Buffer.compare(await exactV2Bytes.body(), imageB)).toBe(0);
});

test('course and section forms preserve later edits after real save receipts without duplicates or rebasing competing changes', async ({
  page,
}) => {
  test.setTimeout(150000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@course-save.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('m' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор курса');
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
  await page.goto('/#/challenges');
  const courseTab = page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name: 'Курсы', exact: true });
  await courseTab.click();

  type Receipt = { id: string; draftRevision: number };
  type Metadata = { id: string; title: string; summary: string | null };
  const form = page.locator('form.course-form-dialog');
  const editor = page.getByTestId('course-editor');
  const evidence = 'e2e/artifacts/learning/course-metadata-save';
  mkdirSync(evidence, { recursive: true });
  let courseId = '';

  async function readCourses(): Promise<Metadata[]> {
    const response = await page.request.get('/api/courses');
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { items: Metadata[] }).items;
  }

  async function readSections(): Promise<Metadata[]> {
    const response = await page.request.get(`/api/courses/${courseId}/outline`);
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { sections: Metadata[] }).sections;
  }

  async function checkLayout(kind: 'course' | 'section'): Promise<void> {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
      [320, 720],
    ] as const) {
      await page.setViewportSize({ width, height });
      const dialogBounds = await form.boundingBox();
      expect(dialogBounds).not.toBeNull();
      expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(width);
      for (const label of ['Сохранить', 'Отмена']) {
        const control = form.getByRole('button', { name: label, exact: true });
        await expect(control).toBeVisible();
        await expect(control).toBeEnabled();
        const bounds = await control.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
          dialogBounds!.x + dialogBounds!.width,
        );
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: `${evidence}/${kind}-${width}.png`, fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  async function saveWhileTyping(
    kind: 'course' | 'section',
    path: string,
    method: 'POST' | 'PATCH',
    label: string,
    competing = false,
  ): Promise<Receipt> {
    const sent = { title: `${label} A`, summary: `${label} description A` };
    const later = { title: `${label} B`, summary: `${label} description B` };
    const remote = { title: `${label} in another window`, summary: 'Another author edit' };
    const title = form.getByLabel('Название', { exact: true });
    // React also updates the nested textarea's text node, so exact label text
    // includes the current value. Its textbox accessible name stays unchanged.
    const summary = form.getByRole('textbox', {
      name: kind === 'course' ? 'Короткое описание' : 'Описание, если нужно',
      exact: true,
    });
    await title.fill(sent.title);
    await summary.fill(sent.summary);
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted!: (receipt: Receipt) => void;
    const serverSaved = new Promise<Receipt>((resolve) => {
      accepted = resolve;
    });
    const matches = (url: URL) => url.pathname === path;
    const delayResponse = async (route: Route) => {
      if (route.request().method() !== method) return route.continue();
      // The real mutation commits before input B. Only delivery of that exact
      // server response is delayed; no accepted write or receipt is mocked.
      const response = await route.fetch();
      expect(response.status()).toBe(method === 'POST' ? 201 : 200);
      const receipt = (await response.json()) as Receipt;
      expect(receipt.id).toBeTruthy();
      expect(Number.isSafeInteger(receipt.draftRevision)).toBe(true);
      expect(receipt.draftRevision).toBeGreaterThan(0);
      accepted(receipt);
      await delayed;
      await route.fulfill({ response });
    };
    await page.route(matches, delayResponse);
    await form.locator('button[type="submit"]').click();
    const receipt = await serverSaved;
    if (kind === 'course') courseId = receipt.id;
    const targetPath =
      kind === 'course'
        ? `/api/courses/${receipt.id}`
        : `/api/courses/${courseId}/sections/${receipt.id}`;
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await title.fill(later.title);
    await summary.fill(later.summary);
    const persistedA = kind === 'course' ? await readCourses() : await readSections();
    expect(persistedA.find((entry) => entry.id === receipt.id)).toMatchObject(sent);
    if (competing) {
      const changed = await page.request.patch(targetPath, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          ...remote,
          expectedRevision: receipt.draftRevision,
          ...(kind === 'course' ? { requestId: crypto.randomUUID() } : {}),
        },
      });
      expect(changed.ok()).toBe(true);
      expect(((await changed.json()) as Receipt).draftRevision).toBeGreaterThan(
        receipt.draftRevision,
      );
    }
    release();
    await expect(form.getByRole('status')).toContainText('Последние изменения ещё не сохранены');
    await expect(title).toHaveValue(later.title);
    await expect(summary).toHaveValue(later.summary);
    await page.unroute(matches, delayResponse);

    const dismissNavigation = (dialog: Dialog) => {
      void dialog.dismiss();
    };
    page.on('dialog', dismissNavigation);
    await page.goBack();
    await expect(page).toHaveURL(/#\/challenges$/);
    await expect(title).toHaveValue(later.title);
    await expect(summary).toHaveValue(later.summary);
    page.off('dialog', dismissNavigation);
    if (method === 'POST') await checkLayout(kind);

    const patchRequest = page.waitForRequest(
      (request) => request.method() === 'PATCH' && new URL(request.url()).pathname === targetPath,
    );
    const patchResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && new URL(response.url()).pathname === targetPath,
    );
    await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await patchRequest).postDataJSON()).toMatchObject({
      ...later,
      expectedRevision: receipt.draftRevision,
    });
    const response = await patchResponse;
    expect(response.status()).toBe(competing ? 409 : 200);
    if (competing) {
      const failure = (await response.json()) as { error: { code: string; message: string } };
      expect(failure.error.code).toBe('draft_conflict');
      await expect(form.getByRole('alert')).toContainText(failure.error.message);
      await expect(title).toHaveValue(later.title);
      await expect(summary).toHaveValue(later.summary);
      const persisted = kind === 'course' ? await readCourses() : await readSections();
      expect(persisted.find((entry) => entry.id === receipt.id)).toMatchObject(remote);
      page.once('dialog', (dialog) => {
        void dialog.accept();
      });
      await form.getByRole('button', { name: 'Отмена', exact: true }).click();
    } else {
      const secondReceipt = (await response.json()) as Receipt;
      expect(secondReceipt.id).toBe(receipt.id);
      expect(secondReceipt.draftRevision).toBeGreaterThan(receipt.draftRevision);
      await expect(form).toHaveCount(0);
      const persisted = kind === 'course' ? await readCourses() : await readSections();
      expect(persisted.find((entry) => entry.id === receipt.id)).toMatchObject(later);
    }
    await expect(form).toHaveCount(0);
    return receipt;
  }

  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  await saveWhileTyping('course', '/api/courses', 'POST', 'New course');
  expect(await readCourses()).toHaveLength(1);
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Настройки', exact: true }).click();
  await saveWhileTyping('course', `/api/courses/${courseId}`, 'PATCH', 'Existing course');
  expect(await readCourses()).toHaveLength(1);
  const initialSections = await readSections();
  await editor.getByRole('button', { name: 'Добавить раздел', exact: true }).click();
  const sectionReceipt = await saveWhileTyping(
    'section',
    `/api/courses/${courseId}/sections`,
    'POST',
    'New section',
  );
  expect(await readSections()).toHaveLength(initialSections.length + 1);
  await editor.locator('.course-section-name').filter({ hasText: 'New section B' }).click();
  const sectionPath = `/api/courses/${courseId}/sections/${sectionReceipt.id}`;
  await saveWhileTyping('section', sectionPath, 'PATCH', 'Existing section');
  expect(await readSections()).toHaveLength(initialSections.length + 1);

  await page.reload();
  await courseTab.click();
  await page.locator('.course-row-main').filter({ hasText: 'Existing course B' }).click();
  await expect(
    editor.locator('.course-section-name').filter({ hasText: 'Existing section B' }),
  ).toBeVisible();
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(form.getByLabel('Название', { exact: true })).toHaveValue('Existing course B');
  await expect(form.getByRole('textbox', { name: 'Короткое описание', exact: true })).toHaveValue(
    'Existing course description B',
  );
  await saveWhileTyping('course', `/api/courses/${courseId}`, 'PATCH', 'Conflict course', true);
  await editor.locator('.course-section-name').filter({ hasText: 'Existing section B' }).click();
  await saveWhileTyping('section', sectionPath, 'PATCH', 'Conflict section', true);
  expect(await readCourses()).toHaveLength(1);
  expect(await readSections()).toHaveLength(initialSections.length + 1);
  expect(browserErrors).toEqual([]);
});

test('Course publication lost response replays the exact V1 after V2 and reload without duplicate versions', async ({
  page,
}) => {
  test.setTimeout(90000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Повтор публикации ' + unique;
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(unique + '@publish-replay.test');
  await page.getByLabel('Имя пользователя', { exact: true }).fill('r' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор публикации');
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
  await page.goto('/#/challenges');
  const courseTab = page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name: 'Курсы', exact: true });
  await courseTab.click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(title);
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/courses',
  );
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const created = await creation;
  expect(created.status()).toBe(201);
  const courseId = ((await created.json()) as { id: string }).id;
  const editor = page.getByTestId('course-editor');
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Первая версия урока');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Сохранённое содержание V1');
  const saving = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/courses/' + courseId + '/lessons',
  );
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  const lesson = (await saved.json()) as { id: string; draftRevision: number };
  await expect(editor.getByText('Урок добавлен.', { exact: true })).toBeVisible();

  type PublishRequest = { expectedRevision: number; requestId: string };
  type Publication = {
    versionId: string;
    versionNumber: number;
    publishedAt: string;
    reused: boolean;
  };
  type Version = { id: string; versionNumber: number; publishedAt: string; outline: unknown };
  const publishPath = '/api/courses/' + courseId + '/publish';
  const versionsPath = '/api/courses/' + courseId + '/versions';
  async function versions(): Promise<Version[]> {
    const response = await page.request.get(versionsPath);
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { items: Version[] }).items;
  }
  expect(await versions()).toEqual([]);
  const requests: PublishRequest[] = [];
  const receipts: Publication[] = [];
  const publicationRoute = async (route: Route) => {
    requests.push(route.request().postDataJSON() as PublishRequest);
    // Execute the real mutation first. Only delivery of its first successful
    // response is lost; no receipt, status or version is manufactured here.
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    receipts.push((await response.json()) as Publication);
    if (requests.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({ response });
  };
  await page.route('**' + publishPath, publicationRoute);
  const lost = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === publishPath,
  );
  const publishButton = editor.getByRole('button', { name: 'Опубликовать', exact: true });
  await publishButton.click();
  await lost;
  expect(receipts).toHaveLength(1);
  const first = receipts[0]!;
  expect(first).toMatchObject({ versionNumber: 1, reused: false });
  expect(requests).toEqual([
    {
      expectedRevision: lesson.draftRevision,
      requestId: 'course-publish:' + courseId + ':' + lesson.draftRevision,
    },
  ]);
  await expect(editor.getByRole('alert')).toContainText('сервер недоступен');
  await expect(publishButton).toBeEnabled();
  const frozenV1 = await versions();
  expect(frozenV1).toHaveLength(1);
  expect(frozenV1[0]).toMatchObject({
    id: first.versionId,
    versionNumber: first.versionNumber,
    publishedAt: first.publishedAt,
  });

  // Another writer uses the actual authenticated API while the first editor
  // still holds its unconfirmed V1 request. This must never turn its retry into V3.
  const outlineResponse = await page.request.get('/api/courses/' + courseId + '/outline');
  expect(outlineResponse.ok()).toBe(true);
  const current = (await outlineResponse.json()) as {
    draftRevision: number;
    sections: Array<{ id: string }>;
  };
  expect(current.draftRevision).toBeGreaterThan(lesson.draftRevision);
  const origin = new URL(page.url()).origin;
  const updated = await page.request.patch('/api/courses/' + courseId + '/lessons/' + lesson.id, {
    headers: { origin },
    data: {
      sectionId: current.sections[0]!.id,
      title: 'Вторая версия урока',
      kind: 'material',
      blocks: [{ id: 'publish-replay-text', type: 'paragraph', text: 'Новое содержание V2' }],
      expectedRevision: current.draftRevision,
    },
  });
  expect(updated.status()).toBe(200);
  const laterRevision = ((await updated.json()) as { draftRevision: number }).draftRevision;
  const secondResponse = await page.request.post(publishPath, {
    headers: { origin },
    data: { expectedRevision: laterRevision, requestId: 'fix05:other-window:' + unique },
  });
  expect(secondResponse.status()).toBe(201);
  const second = (await secondResponse.json()) as Publication;
  expect(second).toMatchObject({ versionNumber: 2, reused: false });
  expect(second.versionId).not.toBe(first.versionId);
  const beforeRetry = await versions();
  expect(beforeRetry).toHaveLength(2);
  expect(beforeRetry.find((version) => version.id === first.versionId)).toEqual(frozenV1[0]);
  expect(requests).toHaveLength(1);

  const retrying = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === publishPath,
  );
  await publishButton.click();
  const retried = await retrying;
  expect(retried.status()).toBe(201);
  expect(await retried.json()).toEqual({ ...first, reused: true });
  expect(requests).toEqual([requests[0], requests[0]]);
  expect(receipts).toEqual([first, { ...first, reused: true }]);
  await expect(
    editor.getByText('Публикация подтверждена: версия 1.', { exact: true }),
  ).toBeVisible();
  await page.unroute('**' + publishPath, publicationRoute);
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Опубликованная версия', exact: true }).click();
  const preview = editor.getByTestId('course-preview-page');
  await expect(preview).toContainText('Опубликованная версия 1 · только чтение');
  await expect(preview).toContainText('Первая версия урока');
  await expect(preview).toContainText('Сохранённое содержание V1');
  await expect(preview).not.toContainText('Новое содержание V2');
  expect(await versions()).toEqual(beforeRetry);

  const evidence = 'e2e/artifacts/learning/course-publication-replay';
  mkdirSync(evidence, { recursive: true });
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(preview).toContainText('Сохранённое содержание V1');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    if (width === 1440 || width === 390)
      await page.screenshot({ path: evidence + '/confirmed-v1-' + width + '.png', fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await courseTab.click();
  const list = page.getByTestId('courses-list');
  await expect(list.locator('li')).toHaveCount(1);
  await list.locator('.course-row-main').filter({ hasText: title }).click();
  await expect(editor.getByRole('button', { name: /^Опубликовать/ })).toHaveCount(0);
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Опубликованная версия', exact: true }).click();
  await expect(preview).toContainText('Опубликованная версия 2 · только чтение');
  await expect(preview).toContainText('Новое содержание V2');
  await expect(preview).not.toContainText('Сохранённое содержание V1');
  expect(await versions()).toEqual(beforeRetry);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: evidence + '/reloaded-v2.png', fullPage: true });
});

test('Course history compares exact V1–V4 policies and structural before/after changes without current defaults', async ({
  page,
}) => {
  test.setTimeout(90000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Сравнение курса ' + unique;
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(unique + '@course-history.test');
  await page.getByLabel('Имя пользователя', { exact: true }).fill('h' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Автор истории курса');
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
  const activating = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/capabilities/content-author/self-attest',
  );
  await page.getByRole('button', { name: 'Подключить авторство', exact: true }).click();
  expect((await activating).ok()).toBe(true);
  const headers = { origin: new URL(page.url()).origin };
  const policies = {
    attemptPolicy: { maxAttempts: 1 },
    resultSelectionPolicy: { mode: 'latest_accepted' },
    completionPolicy: { mode: 'accepted' },
    latePolicy: { mode: 'allow_until_close' },
    assessmentPolicy: { mode: 'manual' },
    feedbackReleasePolicy: { mode: 'immediate' },
  };
  const activityDraft = {
    title: 'Соберите схему',
    instructions: 'Проверьте работу лампы',
    goal: null,
    blocks: [{ type: 'paragraph', text: 'Соедините батарею и лампу' }],
    resultMode: 'completion',
    maxPoints: null,
    moduleKey: 'electronics',
    quizVersionId: null,
    starterProjectVersionId: null,
    policies,
  };
  // All fixtures use the same authenticated author commands as the application.
  // No route interception or manufactured version/diff response is used here.
  const activityResponse = await page.request.post('/api/learning/activities', {
    headers,
    data: {
      ...activityDraft,
      kind: 'project',
      scope: 'personal',
      visibility: 'private',
      requestId: 'history:activity:' + unique,
    },
  });
  expect(activityResponse.status()).toBe(201);
  const activity = (await activityResponse.json()) as { id: string; draftRevision: number };
  async function publishActivity(revision: number, expectedNumber: number) {
    const response = await page.request.post(
      '/api/learning/activities/' + activity.id + '/publish',
      {
        headers,
        data: {
          expectedRevision: revision,
          requestId: 'history:activity-publish:' + unique + ':' + expectedNumber,
        },
      },
    );
    expect(response.status()).toBe(201);
    const published = (await response.json()) as { id: string; versionNumber: number };
    expect(published.versionNumber).toBe(expectedNumber);
    return published.id;
  }
  const activityV1 = await publishActivity(activity.draftRevision, 1);
  const courseResponse = await page.request.post('/api/courses', {
    headers,
    data: {
      title,
      summary: 'Сохранённые учебные версии',
      visibility: 'private',
      requestId: 'history:course:' + unique,
    },
  });
  expect(courseResponse.status()).toBe(201);
  const courseId = ((await courseResponse.json()) as { id: string }).id;
  const coursePath = '/api/courses/' + courseId;
  async function outline() {
    const response = await page.request.get(coursePath + '/outline');
    expect(response.ok()).toBe(true);
    return (await response.json()) as { draftRevision: number; sections: Array<{ id: string }> };
  }
  const initial = await outline();
  const sectionId = initial.sections[0]!.id;
  const sectionSaved = await page.request.patch(coursePath + '/sections/' + sectionId, {
    headers,
    data: { title: 'Основы', summary: null, expectedRevision: initial.draftRevision },
  });
  expect(sectionSaved.ok()).toBe(true);
  let lessonId: string | undefined;
  async function saveLesson(blocks: Array<Record<string, unknown>>, section = sectionId) {
    const current = await outline();
    const response = await page.request.fetch(
      coursePath + '/lessons' + (lessonId ? '/' + lessonId : ''),
      {
        method: lessonId ? 'PATCH' : 'POST',
        headers,
        data: {
          title: 'Первые шаги',
          sectionId: section,
          kind: 'material',
          blocks,
          expectedRevision: current.draftRevision,
        },
      },
    );
    expect(response.status()).toBe(lessonId ? 200 : 201);
    lessonId = ((await response.json()) as { id: string }).id;
  }
  async function publishCourse(expectedNumber: number) {
    const current = await outline();
    const response = await page.request.post(coursePath + '/publish', {
      headers,
      data: {
        expectedRevision: current.draftRevision,
        requestId: 'history:course-publish:' + unique + ':' + expectedNumber,
      },
    });
    expect(response.status()).toBe(201);
    expect((await response.json()) as { versionNumber: number }).toMatchObject({
      versionNumber: expectedNumber,
    });
  }
  const a = { id: 'explanation', type: 'paragraph', text: 'Исходное объяснение' };
  const b = { id: 'second-step', type: 'paragraph', text: 'Второй шаг' };
  const c = { id: 'check', type: 'heading', text: 'Проверка схемы', level: 2 };
  const practice = { id: 'practice', type: 'activity', learningActivityVersionId: activityV1 };
  await saveLesson([a, b, c, practice]);
  await publishCourse(1);
  const policyOnly = await page.request.put('/api/learning/activities/' + activity.id + '/draft', {
    headers,
    data: {
      ...activityDraft,
      expectedRevision: activity.draftRevision,
      policies: { ...policies, attemptPolicy: { maxAttempts: 2 } },
    },
  });
  expect(policyOnly.ok()).toBe(true);
  const activityRevision2 = ((await policyOnly.json()) as { draftRevision: number }).draftRevision;
  const activityV2 = await publishActivity(activityRevision2, 2);
  const practiceV2 = { ...practice, learningActivityVersionId: activityV2 };
  await saveLesson([a, b, c, practiceV2]);
  await publishCourse(2);
  const clarified = { ...a, text: 'Уточнённое объяснение' };
  const inserted = { id: 'tip', type: 'callout', tone: 'tip', text: 'Новая подсказка' };
  await saveLesson([clarified, inserted, b, c, practiceV2]);
  await publishCourse(3);
  const addingSection = await page.request.post(coursePath + '/sections', {
    headers,
    data: {
      title: 'Продолжение',
      summary: 'Собираем самостоятельно',
      expectedRevision: (await outline()).draftRevision,
    },
  });
  expect(addingSection.status()).toBe(201);
  const nextSection = ((await addingSection.json()) as { id: string }).id;
  await saveLesson([c, clarified, inserted, practiceV2], nextSection);
  await publishCourse(4);

  type Version = {
    id: string;
    versionNumber: number;
    outline: unknown;
    pinnedActivities: Array<{ versionId: string | null; policySnapshot: unknown }>;
  };
  async function versions(): Promise<Version[]> {
    const response = await page.request.get(coursePath + '/versions');
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { items: Version[] }).items;
  }
  const frozen = await versions();
  expect(frozen.map((version) => version.versionNumber)).toEqual([4, 3, 2, 1]);
  expect(frozen.find((version) => version.versionNumber === 1)!.pinnedActivities[0]).toMatchObject({
    versionId: activityV1,
    policySnapshot: { attemptPolicy: { maxAttempts: 1 } },
  });
  expect(frozen.find((version) => version.versionNumber === 2)!.pinnedActivities[0]).toMatchObject({
    versionId: activityV2,
    policySnapshot: { attemptPolicy: { maxAttempts: 2 } },
  });
  // An incompatible current draft makes any accidental fallback observable.
  const future = await page.request.put('/api/learning/activities/' + activity.id + '/draft', {
    headers,
    data: {
      ...activityDraft,
      expectedRevision: activityRevision2,
      instructions: 'Текущий черновик не является историей',
      policies: { ...policies, attemptPolicy: { maxAttempts: 99 } },
    },
  });
  expect(future.ok()).toBe(true);
  expect(await versions()).toEqual(frozen);
  await page.goto('/#/challenges');
  const courseTab = page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name: 'Курсы', exact: true });
  await courseTab.click();
  await page
    .getByTestId('courses-list')
    .locator('.course-row-main')
    .filter({ hasText: title })
    .click();
  await openCourseHistory(page);
  const history = page.getByTestId('course-editor').getByTestId('author-version-history');
  const mutations: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
      /^\/api\/(courses|learning|projects|classrooms)(\/|$)/.test(path)
    )
      mutations.push(request.method() + ' ' + path);
  });
  const selected = history.getByLabel('Опубликованная версия', { exact: true });
  const previous = history.getByLabel('Сравнить с версией', { exact: true });
  await selected.selectOption({ label: 'Версия 2' });
  await previous.selectOption({ label: 'Версия 1' });
  const comparison = history.getByRole('region', { name: 'Изменения между версиями', exact: true });
  await expect(
    comparison.getByRole('heading', { name: 'Версия 1 → версия 2', exact: true }),
  ).toBeVisible();
  const attempts = comparison
    .getByTestId('version-change')
    .filter({ hasText: 'Попытки и время выполнения · Число попыток' });
  await expect(attempts).toHaveCount(1);
  await expect(attempts.locator('dd').nth(0)).toHaveText('1');
  await expect(attempts.locator('dd').nth(1)).toHaveText('2');
  await expect(comparison.getByTestId('version-change')).toHaveCount(2);
  await expect(comparison).toContainText(
    'Курс «' + title + '» → Раздел «Основы» → Урок «Первые шаги» → Практическое задание 4',
  );
  await expect(comparison).not.toContainText('99');
  await expect(comparison).not.toContainText('Текущий черновик');
  await expect(comparison).not.toContainText(activityV1);
  await expect(comparison).not.toContainText(activityV2);
  const evidence = 'e2e/artifacts/learning/course-version-diff';
  mkdirSync(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await comparison.screenshot({ path: evidence + '/policy-only-1440.png' });

  await selected.selectOption({ label: 'Версия 3' });
  await previous.selectOption({ label: 'Версия 2' });
  await expect(
    comparison.locator('[data-change-category="Блоки"][data-change-kind="added"]'),
  ).toHaveCount(1);
  await expect(comparison.locator('[data-change-kind="moved"]')).toHaveCount(0);
  const textChange = comparison
    .getByTestId('version-change')
    .filter({ has: page.getByRole('heading', { name: 'Изменено · Текст', exact: true }) });
  await expect(textChange.locator('dd').nth(0)).toHaveText('Исходное объяснение');
  await expect(textChange.locator('dd').nth(1)).toHaveText('Уточнённое объяснение');
  await expect(comparison).toContainText('Новая подсказка');
  await selected.selectOption({ label: 'Версия 4' });
  await previous.selectOption({ label: 'Версия 3' });
  const addedSection = comparison.locator(
    '[data-change-category="Разделы"][data-change-kind="added"]',
  );
  await expect(addedSection).toHaveCount(1);
  await expect(addedSection).toContainText('Продолжение');
  const movedLesson = comparison.locator(
    '[data-change-category="Уроки"][data-change-kind="moved"]',
  );
  await expect(movedLesson).toHaveCount(1);
  await expect(movedLesson.locator('dd').nth(0)).toContainText('Основы');
  await expect(movedLesson.locator('dd').nth(1)).toContainText('Продолжение');
  const movedBlock = comparison.locator('[data-change-category="Блоки"][data-change-kind="moved"]');
  await expect(movedBlock).toHaveCount(1);
  await expect(movedBlock).toContainText('Проверка схемы');
  await expect(movedBlock.locator('dd').nth(0)).toContainText('позиция 4');
  await expect(movedBlock.locator('dd').nth(1)).toContainText('позиция 1');
  const removedBlock = comparison.locator(
    '[data-change-category="Блоки"][data-change-kind="removed"]',
  );
  await expect(removedBlock).toHaveCount(1);
  await expect(removedBlock).toContainText('Второй шаг');
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(comparison).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    expect(
      await comparison.locator('dl').evaluateAll((values) =>
        values.every((value) => {
          const boxes = [...value.children].map((child) => child.getBoundingClientRect());
          return (
            boxes.length === 2 &&
            (boxes[0]!.right <= boxes[1]!.left || boxes[0]!.bottom <= boxes[1]!.top)
          );
        }),
      ),
    ).toBe(true);
    if (width === 1440 || width === 390)
      await comparison.screenshot({ path: evidence + '/structural-' + width + '.png' });
  }
  expect(await versions()).toEqual(frozen);
  expect(mutations).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('document Course Builder preserves the lesson, real save acknowledgements and exact preview at four widths', async ({
  page,
}) => {
  test.setTimeout(150000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(`${unique}@course-document.test`);
  await page.getByLabel('Имя пользователя', { exact: true }).fill('d' + unique);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Преподаватель курса');
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль', { exact: true }).fill('Strong-' + unique + '-Password');
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', {
      name: 'Материалы и классы',
      exact: true,
    })
    .click();
  const activation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/capabilities/content-author/self-attest',
  );
  await page.getByRole('button', { name: 'Подключить авторство', exact: true }).click();
  expect((await activation).ok()).toBe(true);
  await page.goto('/#/challenges');
  await page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', {
      name: 'Курсы',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const courseForm = page.getByRole('dialog', { name: 'Новый курс', exact: true });
  await courseForm.getByLabel('Название', { exact: true }).fill('Автоматический ночник');
  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/courses',
  );
  await courseForm.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const created = await creation;
  expect(created.status()).toBe(201);
  const courseId = ((await created.json()) as { id: string }).id;
  const coursePath = '/api/courses/' + courseId;
  const editor = page.getByTestId('course-editor');
  const title = editor.getByLabel('Название урока', { exact: true });
  const summary = editor.getByLabel('Что будет в уроке', { exact: true });
  const body = editor.getByLabel('Текст блока', { exact: true });
  const state = editor.getByTestId('course-save-state');
  const evidence = 'e2e/artifacts/learning/course-document-editor';
  mkdirSync(evidence, { recursive: true });
  type Receipt = { id: string; draftRevision: number };
  type Outline = {
    draftRevision: number;
    sections: Array<{
      id: string;
      lessons: Array<{
        id: string;
        title: string;
        summary: string | null;
        blocks: Array<{ id: string; type: string; text?: string }>;
      }>;
    }>;
  };
  async function readOutline(): Promise<Outline> {
    const response = await page.request.get(coursePath + '/outline');
    expect(response.ok()).toBe(true);
    return response.json() as Promise<Outline>;
  }
  const initialOutline = await readOutline();
  await openCourseStructure(page);
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await title.fill('Свет и сопротивление');
  await summary.fill('Узнаем, как датчик замечает темноту.');
  await body.fill('Измерьте свет.');
  const shortHeight = await body.evaluate((element) => element.getBoundingClientRect().height);
  expect(shortHeight).toBeGreaterThanOrEqual(44);
  expect(shortHeight).toBeLessThan(76);
  const firstSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === coursePath + '/lessons',
  );
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  const firstResponse = await firstSave;
  expect(firstResponse.status()).toBe(201);
  const firstLesson = (await firstResponse.json()) as Receipt;
  expect(firstLesson.draftRevision).toBeGreaterThan(initialOutline.draftRevision);
  await expect(state).toContainText('Изменения сохранены');
  await expect(state).toContainText('редакция ' + firstLesson.draftRevision);

  await openCourseStructure(page);
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await title.fill('Наблюдения');
  await body.fill('Запишите напряжение на свету и в темноте.');
  const secondSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === coursePath + '/lessons',
  );
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  const secondResponse = await secondSave;
  expect(secondResponse.status()).toBe(201);
  const secondLesson = (await secondResponse.json()) as Receipt;
  expect(secondLesson.id).not.toBe(firstLesson.id);
  await expect(state).toContainText('Изменения сохранены');
  await editor.locator('.course-lesson-link').filter({ hasText: 'Свет и сопротивление' }).click();
  await expect(title).toHaveValue('Свет и сопротивление');
  const liveTitle = await title.elementHandle();
  const longTitle =
    'Свет и сопротивление: как фоторезистор замечает темноту и помогает управлять светодиодом в автоматическом ночнике';
  const longText = Array.from(
    { length: 6 },
    () =>
      'Фоторезистор меняет сопротивление: на ярком свету оно уменьшается, а в темноте увеличивается. Измерьте напряжение относительно общего провода, затем запишите наблюдения и сравните результаты.',
  ).join('\n\n');
  await title.fill(longTitle);
  await summary.fill('Соберите делитель напряжения и объясните, как освещение меняет показания.');
  await body.fill(longText);
  await expect(state).toContainText('Есть несохранённые изменения');
  const measurements: Array<Record<string, unknown>> = [];
  const viewportEvidence: Array<Record<string, unknown>> = [];
  async function hitTarget(
    target: Locator,
    stage: string,
    whole = true,
  ): Promise<{ x: number; y: number }> {
    await expect(target).toBeVisible();
    // No auto-scroll in this measurement: it describes the actual captured viewport.
    const sample = await target.evaluate((element, whole) => {
      const box = element.getBoundingClientRect();
      const left = Math.max(0, box.left);
      const right = Math.min(innerWidth, box.right);
      const top = Math.max(0, box.top);
      const bottom = Math.min(innerHeight, box.bottom);
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const points = whole
        ? [
            [x, y],
            [left + 6, top + 6],
            [right - 6, top + 6],
            [left + 6, bottom - 6],
            [right - 6, bottom - 6],
          ]
        : [[x, y]];
      return {
        x,
        y,
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        viewport: { width: innerWidth, height: innerHeight, scrollY },
        hasVisibleArea: right > left && bottom > top,
        whollyVisible:
          box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        hits: points.map(([x, y]) => {
          const hit = document.elementFromPoint(x!, y!);
          return hit === element || (hit !== null && element.contains(hit));
        }),
      };
    }, whole);
    expect(sample.hasVisibleArea, stage).toBe(true);
    if (whole) expect(sample.whollyVisible, stage).toBe(true);
    expect(sample.hits.every(Boolean), stage + ' receives pointer events').toBe(true);
    viewportEvidence.push({ stage, ...sample });
    return { x: sample.x, y: sample.y };
  }
  async function viewportProof(
    targetPage: Page,
    targetEditor: Locator,
    name: string,
  ): Promise<void> {
    const save = targetEditor.getByRole('button', { name: 'Сохранить урок', exact: true });
    const previewButton = targetEditor.getByRole('button', { name: 'Предпросмотр', exact: true });
    const actions = targetEditor.getByRole('button', { name: 'Действия курса', exact: true });
    // Scroll to the start of the course document, keeping the real sticky shell visible.
    await targetEditor.locator('.course-compact-header').evaluate((header) => {
      header.scrollIntoView({ block: 'start' });
      const shell = document.querySelector('.portal-header')?.getBoundingClientRect();
      window.scrollBy(0, -(shell?.height ?? 0) - 8);
    });
    await hitTarget(save, name + ':top:save');
    await hitTarget(previewButton, name + ':top:preview');
    const previewLines = await previewButton.evaluate((button) => {
      const text = document.createRange();
      text.selectNodeContents(button);
      return [...text.getClientRects()].map((box) => ({
        left: box.left,
        right: box.right,
        top: box.top,
      }));
    });
    expect(previewLines, name + ': Preview is one readable word').toHaveLength(1);
    await save.click({ trial: true });
    await save.focus();
    await save.press('Tab');
    await expect(previewButton).toBeFocused();
    expect(await previewButton.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
    await hitTarget(previewButton, name + ':top:keyboard-preview');
    await hitTarget(actions, name + ':top:course-menu');
    await actions.focus();
    await actions.press('Enter');
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
    const courseSettings = targetEditor
      .locator('.course-actions-menu')
      .getByRole('button', { name: 'Настройки', exact: true });
    await hitTarget(courseSettings, name + ':top:course-menu-settings');
    await targetPage.keyboard.press('Escape');
    await expect(actions).toHaveAttribute('aria-expanded', 'false');
    await expect(actions).toBeFocused();
    await targetPage.screenshot({ path: `${evidence}/${name}-viewport-top.png`, fullPage: false });

    const text = targetEditor.getByLabel('Текст блока', { exact: true });
    await text.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const point = await hitTarget(text, name + ':body:text', false);
    await targetPage.mouse.click(point.x, point.y);
    await expect(text).toBeFocused();
    const stickyShell = await targetPage.locator('.portal-header').evaluate((header) => ({
      position: getComputedStyle(header).position,
      top: header.getBoundingClientRect().top,
      bottom: header.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
    }));
    expect(stickyShell.position).toBe('sticky');
    expect(stickyShell.top).toBeGreaterThanOrEqual(0);
    expect(stickyShell.bottom).toBeLessThanOrEqual(stickyShell.viewportHeight);
    viewportEvidence.push({ stage: name + ':body:sticky-shell', ...stickyShell });
    if (await targetEditor.locator('.course-outline-dialog[data-inline="true"]').count()) {
      const selectedLesson = targetEditor.locator('.course-outline [aria-current="page"]');
      await hitTarget(selectedLesson, name + ':body:sticky-selected-lesson');
      await hitTarget(
        targetEditor
          .locator('.course-outline')
          .getByRole('button', { name: 'Добавить раздел', exact: true }),
        name + ':body:sticky-add-section',
      );
    }
    await targetPage.screenshot({ path: `${evidence}/${name}-viewport-body.png`, fullPage: false });

    await targetPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const add = targetEditor.getByRole('button', { name: '+ Добавить содержимое', exact: true });
    await hitTarget(add, name + ':end:add-content');
    await add.focus();
    await add.press('Enter');
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    await add.press('Tab');
    const firstChoice = targetEditor
      .getByRole('menu', { name: 'Добавить содержимое урока' })
      .getByRole('menuitem')
      .first();
    await expect(firstChoice).toBeFocused();
    await hitTarget(firstChoice, name + ':end:add-menu-choice');
    await targetPage.keyboard.press('Escape');
    await expect(add).toHaveAttribute('aria-expanded', 'false');
    await expect(add).toBeFocused();
    await hitTarget(add, name + ':end:keyboard-add-content');
    await targetPage.screenshot({ path: `${evidence}/${name}-viewport-end.png`, fullPage: false });
  }
  async function settleLayout(): Promise<void> {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
    [320, 568],
  ] as const) {
    await page.setViewportSize({ width, height });
    await settleLayout();
    await expect(title).toHaveValue(longTitle);
    await expect(body).toHaveValue(longText);
    const fields = await editor.locator('.course-growing-textarea').evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.getAttribute('aria-label'),
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        height: element.getBoundingClientRect().height,
        hiddenLines: element.scrollHeight - element.clientHeight,
      })),
    );
    expect(fields.every((field) => field.hiddenLines <= 1)).toBe(true);
    expect(fields.every((field) => field.left >= 0 && field.right <= width)).toBe(true);
    expect(fields.find((field) => field.label === 'Текст блока')!.height).toBeGreaterThan(
      shortHeight * 2,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    if (width <= 390) {
      await expect(editor.locator('.course-outline')).not.toBeVisible();
      await openCourseStructure(page);
      const structure = editor.getByRole('dialog', { name: 'Структура курса', exact: true });
      await expect(structure).toBeVisible();
      await expect(structure.locator('[aria-current="page"]')).toContainText(
        'Свет и сопротивление',
      );
      await structure
        .getByRole('button', { name: 'Закрыть структуру', exact: true })
        .press('Escape');
      await expect(structure).not.toBeVisible();
      await expect(
        editor.getByRole('button', { name: 'Структура курса', exact: true }),
      ).toBeFocused();
    } else {
      const outline = await editor.locator('.course-outline').boundingBox();
      const canvas = await editor.locator('.course-workspace').boundingBox();
      expect(outline!.x + outline!.width).toBeLessThanOrEqual(canvas!.x);
    }
    expect(await liveTitle!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(title).toHaveValue(longTitle);
    const blockActions = editor.getByRole('button', { name: 'Действия блока 1', exact: true });
    await blockActions.scrollIntoViewIfNeeded();
    const target = await blockActions.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
    await blockActions.focus();
    await hitTarget(blockActions, `${width}:block-menu`);
    await blockActions.press('Enter');
    await expect(blockActions).toHaveAttribute('aria-expanded', 'true');
    // A block dropdown must remain anchored to its local trigger instead of
    // stretching to an inherited left edge in responsive layouts.
    const blockMenuGeometry = await editor
      .locator('.lesson-block-card .lesson-block-menu .dropdown-menu')
      .first()
      .evaluate((menu) => {
        const popup = menu.getBoundingClientRect();
        const trigger = menu.parentElement?.querySelector('summary')?.getBoundingClientRect();
        return {
          left: popup.left,
          right: popup.right,
          top: popup.top,
          bottom: popup.bottom,
          width: popup.width,
          placement: menu.parentElement?.getAttribute('data-dropdown-placement'),
          triggerRight: trigger?.right ?? Number.NaN,
        };
      });
    expect(blockMenuGeometry.left, `${width}: block popup left`).toBeGreaterThanOrEqual(0);
    expect(blockMenuGeometry.right, `${width}: block popup right`).toBeLessThanOrEqual(width);
    expect(blockMenuGeometry.top, `${width}: block popup top`).toBeGreaterThanOrEqual(0);
    expect(blockMenuGeometry.bottom, `${width}: block popup bottom`).toBeLessThanOrEqual(
      height,
    );
    expect(['above', 'below'], `${width}: placement state`).toContain(
      blockMenuGeometry.placement,
    );
    expect(blockMenuGeometry.width, `${width}: block popup compact width`).toBeLessThanOrEqual(
      width - 48,
    );
    expect(
      Math.abs(blockMenuGeometry.right - blockMenuGeometry.triggerRight),
      `${width}: block popup remains right-anchored to trigger`,
    ).toBeLessThanOrEqual(2);
    await blockActions.press('Tab');
    await expect(
      editor
        .locator('.lesson-block-card')
        .getByRole('button', { name: 'Дублировать', exact: true }),
    ).toBeFocused();
    await hitTarget(
      editor
        .locator('.lesson-block-card')
        .getByRole('button', { name: 'Дублировать', exact: true }),
      `${width}:block-menu-duplicate`,
    );
    await page.keyboard.press('Escape');
    await expect(blockActions).toHaveAttribute('aria-expanded', 'false');
    await expect(blockActions).toBeFocused();
    await blockActions.click();
    await expect(
      editor.locator('.lesson-block-card').getByRole('button', { name: 'Скрыть', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await openCourseLessonSettings(page);
    const settings = editor.getByRole('dialog', { name: 'Параметры урока', exact: true });
    await expect(settings.getByLabel('Тип урока')).toHaveValue('material');
    const bounds = await settings.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await closeCourseLessonSettings(page);
    await expect(
      editor.getByRole('button', { name: 'Параметры урока', exact: true }),
    ).toBeFocused();
    await hitTarget(
      editor.getByRole('button', { name: 'Параметры урока', exact: true }),
      `${width}:lesson-settings-return-focus`,
    );
    await body.fill('Измерьте свет.');
    await settleLayout();
    const shortField = await body.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      hiddenLines: element.scrollHeight - element.clientHeight,
    }));
    expect(shortField.height).toBeGreaterThanOrEqual(44);
    expect(shortField.height).toBeLessThan(76);
    expect(shortField.hiddenLines).toBeLessThanOrEqual(1);
    await editor.screenshot({ path: `${evidence}/document-short-${width}.png` });
    await viewportProof(page, editor, `document-short-${width}`);
    await body.fill(longText);
    await settleLayout();
    measurements.push({ width, height, fields, shortField });
    await editor.screenshot({ path: `${evidence}/document-${width}.png` });
    await viewportProof(page, editor, `document-${width}`);
  }

  // Hidden settings must never turn an invalid duration into a silent failed save.
  const invalidDurationWrites: string[] = [];
  const trackDurationWrite = (request: import('@playwright/test').Request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === coursePath + '/lessons/' + firstLesson.id
    )
      invalidDurationWrites.push(request.postData() ?? '');
  };
  page.on('request', trackDurationWrite);
  await openCourseLessonSettings(page);
  const durationSettings = editor.getByRole('dialog', { name: 'Параметры урока', exact: true });
  const duration = durationSettings.getByLabel('Примерное время, минут', { exact: true });
  for (const invalid of ['0', '601', '1.5']) {
    await duration.fill(invalid);
    await expect(duration).toHaveAttribute('aria-invalid', 'true');
    expect(await duration.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
    await closeCourseLessonSettings(page);
    await expect(durationSettings).not.toBeVisible();
    await expect(editor.getByRole('alert')).toHaveText(
      'Укажите целое число минут от 1 до 600 или оставьте поле пустым.',
    );
    if (invalid === '0') {
      const correction = editor.getByRole('button', { name: 'Исправить время урока', exact: true });
      await correction.focus();
      await correction.press('Enter');
    } else {
      await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
    }
    await expect(durationSettings).toBeVisible();
    await expect(duration).toBeFocused();
    await expect(duration).toHaveValue(invalid);
    await expect(durationSettings.getByRole('alert')).toHaveText(
      'Укажите целое число минут от 1 до 600 или оставьте поле пустым.',
    );
    expect(invalidDurationWrites).toEqual([]);
  }
  await duration.fill('15');
  expect(await duration.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  await expect(duration).not.toHaveAttribute('aria-invalid', 'true');
  await closeCourseLessonSettings(page);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  page.off('request', trackDurationWrite);
  await expect(title).toHaveValue(longTitle);
  await expect(body).toHaveValue(longText);
  await expect(state).toContainText('Есть несохранённые изменения');

  await page.setViewportSize({ width: 1440, height: 900 });
  await title.focus();
  await title.press('Tab');
  await expect(summary).toBeFocused();
  // A 200% CSS layout/reflow check. Native browser/device zoom remains a separate acceptance gate.
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await settleLayout();
  const zoomOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(zoomOverflow).toBeLessThanOrEqual(0);
  const zoomFields = await editor.locator('.course-growing-textarea').evaluateAll((elements) =>
    elements.map((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      hiddenLines: element.scrollHeight - element.clientHeight,
    })),
  );
  expect(
    zoomFields.every((field) => field.hiddenLines <= 1 && field.left >= 0 && field.right <= 1440),
  ).toBe(true);
  await title.focus();
  await title.press('Tab');
  await expect(summary).toBeFocused();
  await expect(title).toHaveValue(longTitle);
  await expect(body).toHaveValue(longText);
  await editor.screenshot({ path: `${evidence}/document-css-zoom-200.png` });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await settleLayout();
  await editor.locator('.course-lesson-link').filter({ hasText: 'Наблюдения' }).click();
  await expect(editor.getByRole('alert')).toContainText('Переход не выполнен, данные не потеряны');
  await expect(title).toHaveValue(longTitle);
  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(
    editor.getByRole('dialog', { name: 'Как увидит ученик', exact: true }),
  ).not.toBeVisible();
  await expect(body).toHaveValue(longText);

  const lessonPath = coursePath + '/lessons/' + firstLesson.id;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let accepted!: (receipt: Receipt) => void;
  const persisted = new Promise<Receipt>((resolve) => {
    accepted = resolve;
  });
  const saveRoute = async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    accepted((await response.json()) as Receipt);
    await delayed;
    await route.fulfill({ response });
  };
  await page.route('**' + lessonPath, saveRoute);
  const receiptResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname === lessonPath,
  );
  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  const acknowledged = await persisted;
  expect(acknowledged.id).toBe(firstLesson.id);
  const laterSummary = 'Добавьте объяснение: почему напряжение изменилось в темноте?';
  await summary.fill(laterSummary);
  await expect(state).not.toContainText('Изменения сохранены');
  release();
  expect((await receiptResponse).ok()).toBe(true);
  await expect(
    editor.getByText('Урок сохранён. Последние изменения ещё не сохранены.', { exact: true }),
  ).toBeVisible();
  await expect(state).toContainText('Есть несохранённые изменения');
  await expect(state).toContainText('редакция ' + acknowledged.draftRevision);
  await expect(summary).toHaveValue(laterSummary);
  await page.unroute('**' + lessonPath, saveRoute);
  const finalSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname === lessonPath,
  );
  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  const finalResponse = await finalSave;
  expect(finalResponse.status()).toBe(200);
  expect(finalResponse.request().postDataJSON()).toMatchObject({
    expectedRevision: acknowledged.draftRevision,
    estimatedMinutes: 15,
  });
  const finalReceipt = (await finalResponse.json()) as Receipt;
  await expect(state).toContainText('Изменения сохранены');
  const savedOutline = await readOutline();
  const savedLessons = savedOutline.sections.flatMap((section) => section.lessons);
  expect(savedLessons.map((lesson) => lesson.id)).toEqual([firstLesson.id, secondLesson.id]);
  expect(savedLessons[0]).toMatchObject({
    title: longTitle,
    summary: laterSummary,
    estimatedMinutes: 15,
    blocks: [{ id: 'intro', type: 'paragraph', text: longText }],
  });

  const publicationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === coursePath + '/publish',
  );
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  const published = await publicationResponse;
  expect(published.status()).toBe(201);
  const publication = (await published.json()) as { versionId: string; versionNumber: number };
  expect(publication.versionNumber).toBe(1);
  await expect(editor.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  const publishedOutline = await readOutline();
  expect(publishedOutline.sections).toEqual(savedOutline.sections);
  expect(publishedOutline.draftRevision).toBeGreaterThanOrEqual(finalReceipt.draftRevision);
  await expect(state).toContainText('редакция ' + publishedOutline.draftRevision);
  const versionsBefore = await page.request.get(coursePath + '/versions');
  expect(versionsBefore.ok()).toBe(true);
  const frozenVersions = await versionsBefore.json();
  expect(frozenVersions.items).toHaveLength(1);
  expect(frozenVersions.items[0].id).toBe(publication.versionId);
  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const previewDialog = editor.getByRole('dialog', { name: 'Как увидит ученик', exact: true });
  const preview = previewDialog.getByTestId('course-preview-page');
  await expect(preview).toHaveAttribute(
    'data-draft-revision',
    String(publishedOutline.draftRevision),
  );
  await expect(preview).toContainText(longText);
  await previewDialog.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Предпросмотр', exact: true })).toBeFocused();
  expect(await liveTitle!.evaluate((element) => element.isConnected)).toBe(true);

  const futureText = 'Содержание будущего черновика: проверьте датчик ещё раз.';
  // Native browser zoom is additional evidence, independent of the CSS zoom above.
  // It uses the existing CI server and this same author's exact saved course/version.
  const nativeBrowserZoom = await (async () => {
    const native = await openCourseNativeZoom(page, evidence);
    const nativePage = native.page;
    const nativeWrites: string[] = [];
    nativePage.on('pageerror', (error) => browserErrors.push(error.message));
    nativePage.on('request', (request) => {
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
        new URL(request.url()).pathname.startsWith(coursePath)
      )
        nativeWrites.push(request.method() + ' ' + new URL(request.url()).pathname);
    });
    async function witness() {
      return nativePage.evaluate(() => ({
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        dpr: devicePixelRatio,
        visualScale: visualViewport?.scale,
        cssZoom: getComputedStyle(document.documentElement).zoom,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));
    }
    let nativeFailure: { error: unknown } | undefined;
    try {
      await nativePage.goto('/#/challenges');
      await nativePage
        .getByRole('navigation', { name: 'Разделы курсов и заданий' })
        .getByRole('button', { name: 'Курсы', exact: true })
        .click();
      await nativePage
        .getByTestId('courses-list')
        .locator('li')
        .filter({ hasText: 'Автоматический ночник' })
        .getByRole('button', { name: 'Открыть', exact: true })
        .click();
      const nativeEditor = nativePage.getByTestId('course-editor');
      await openCourseStructure(nativePage);
      await nativeEditor.locator('.course-lesson-link').filter({ hasText: longTitle }).click();
      const nativeTitle = nativeEditor.getByLabel('Название урока', { exact: true });
      const nativeSummary = nativeEditor.getByLabel('Что будет в уроке', { exact: true });
      const nativeBody = nativeEditor.getByLabel('Текст блока', { exact: true });
      await expect(nativeTitle).toHaveValue(longTitle);
      await expect(nativeSummary).toHaveValue(laterSummary);
      await expect(nativeBody).toHaveValue(longText);
      const nativeOutlineResponse = await nativePage.request.get(coursePath + '/outline');
      expect(nativeOutlineResponse.ok()).toBe(true);
      const nativeOutline = (await nativeOutlineResponse.json()) as Outline;
      expect(nativeOutline).toEqual(await readOutline());
      const baselineZoom = await native.setZoom(1);
      expect(baselineZoom.factor).toBe(1);
      expect(nativePage.viewportSize()).toBeNull();
      const before = await witness();
      expect(before.innerWidth).toBeGreaterThanOrEqual(1000);
      expect(before.cssZoom).toBe('1');
      expect(before.visualScale).toBe(1);
      const applied = await native.setZoom(2);
      expect(applied.factor).toBeCloseTo(2, 6);
      expect(applied.settings).toMatchObject({ mode: 'automatic', scope: 'per-tab' });
      await expect.poll(async () => (await witness()).dpr / before.dpr).toBeCloseTo(2, 6);
      await nativePage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const after = await witness();
      expect(Math.abs(after.innerWidth * 2 - before.innerWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.innerHeight * 2 - before.innerHeight)).toBeLessThanOrEqual(1);
      expect(after.outerWidth).toBe(before.outerWidth);
      expect(after.outerHeight).toBe(before.outerHeight);
      expect(after.visualScale).toBe(1);
      expect(after.cssZoom).toBe('1');
      expect(after.overflow).toBeLessThanOrEqual(0);
      await nativeTitle.focus();
      await nativeTitle.press('Tab');
      await expect(nativeSummary).toBeFocused();
      await hitTarget(nativeSummary, 'native-zoom-200:keyboard-summary');
      await expect(nativeEditor.getByTestId('course-save-state')).toContainText(
        'Изменения сохранены',
      );
      const fields = await nativeEditor
        .locator('.course-growing-textarea')
        .evaluateAll((elements) =>
          elements.map((element) => ({
            left: element.getBoundingClientRect().left,
            right: element.getBoundingClientRect().right,
            hiddenLines: element.scrollHeight - element.clientHeight,
          })),
        );
      expect(
        fields.every(
          (field) => field.left >= 0 && field.right <= after.innerWidth && field.hiddenLines <= 1,
        ),
      ).toBe(true);
      await viewportProof(nativePage, nativeEditor, 'document-native-zoom-200');
      await openCourseLessonSettings(nativePage);
      const nativeSettings = nativeEditor.getByRole('dialog', {
        name: 'Параметры урока',
        exact: true,
      });
      await hitTarget(nativeSettings.getByLabel('Тип урока'), 'native-zoom-200:lesson-settings');
      await closeCourseLessonSettings(nativePage);
      await expect(
        nativeEditor.getByRole('button', { name: 'Параметры урока', exact: true }),
      ).toBeFocused();
      const nativePreviewButton = nativeEditor.getByRole('button', {
        name: 'Предпросмотр',
        exact: true,
      });
      await nativePreviewButton.click();
      const nativeDialog = nativeEditor.getByRole('dialog', {
        name: 'Как увидит ученик',
        exact: true,
      });
      const nativePreview = nativeDialog.getByTestId('course-preview-page');
      await expect(nativePreview).toHaveAttribute(
        'data-draft-revision',
        String(nativeOutline.draftRevision),
      );
      await expect(nativePreview).toContainText(longText);
      await nativeDialog
        .getByRole('button', { name: 'Опубликованная версия', exact: true })
        .click();
      await expect(nativePreview).toHaveAttribute('data-course-version-id', publication.versionId);
      await expect(nativePreview).toContainText(longText);
      await expect(nativePreview).not.toContainText(futureText);
      await nativePage.screenshot({
        path: `${evidence}/published-v1-native-zoom-200.png`,
        fullPage: false,
      });
      await nativeDialog.getByRole('button', { name: 'Редактировать', exact: true }).click();
      await expect(nativePreviewButton).toBeFocused();
      await hitTarget(nativePreviewButton, 'native-zoom-200:preview-return-focus');
      await expect(nativeBody).toHaveValue(longText);
      const nativeVersions = await nativePage.request.get(coursePath + '/versions');
      expect(nativeVersions.ok()).toBe(true);
      expect(await nativeVersions.json()).toEqual(frozenVersions);
      const unchangedOutline = await nativePage.request.get(coursePath + '/outline');
      expect(unchangedOutline.ok()).toBe(true);
      expect(await unchangedOutline.json()).toEqual(nativeOutline);
      expect(nativeWrites).toEqual([]);
      const reset = await native.setZoom(1);
      expect(reset.factor).toBe(1);
      await expect.poll(async () => (await witness()).dpr).toBe(before.dpr);
      expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
      return {
        mechanism: 'Chromium tabs.setZoom automatic / per-tab',
        baselineZoom,
        applied,
        before,
        after,
        fields,
        reset,
      };
    } catch (error) {
      nativeFailure = { error };
      throw error;
    } finally {
      await native.close(nativeFailure);
    }
  })();
  expect(browserErrors).toEqual([]);
  await body.fill(futureText);
  const futureSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && new URL(response.url()).pathname === lessonPath,
  );
  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  expect((await futureSave).ok()).toBe(true);
  await expect(state).toContainText('Изменения сохранены');
  const previewMutations: string[] = [];
  page.on('request', (request) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith(coursePath)
    )
      previewMutations.push(request.method() + ' ' + new URL(request.url()).pathname);
  });
  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(preview).toContainText(futureText);
  await previewDialog.getByRole('button', { name: 'Опубликованная версия', exact: true }).click();
  await expect(preview).toHaveAttribute('data-course-version-id', publication.versionId);
  await expect(preview).toContainText(longText);
  await expect(preview).not.toContainText(futureText);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${evidence}/published-v1-390.png` });
  await previewDialog.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(body).toHaveValue(futureText);
  const versionsAfter = await page.request.get(coursePath + '/versions');
  expect(versionsAfter.ok()).toBe(true);
  expect(await versionsAfter.json()).toEqual(frozenVersions);
  expect(previewMutations).toEqual([]);
  expect(browserErrors).toEqual([]);
  writeFileSync(
    `${evidence}/measurements.json`,
    JSON.stringify(
      {
        courseId,
        firstLesson,
        secondLesson,
        finalReceipt,
        publication,
        measurements,
        viewportEvidence,
        cssZoom: { factor: 2, overflow: zoomOverflow, fields: zoomFields },
        nativeBrowserZoom,
      },
      null,
      2,
    ),
  );
});
