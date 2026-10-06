import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  addAssignmentBlock,
  closeAssignmentPreview,
  closeAssignmentSettings,
  openExistingAssignmentEditor,
  openNewAssignmentEditor,
  openAssignmentSettings,
  previewAssignmentAs,
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  page.on('request', (request) => {
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

  await page.getByRole('button', { name: '← Задания', exact: true }).click();
  await expect(page.locator('.authored-assignment-list')).toBeVisible();
  await expect(page.locator('.authored-assignment-row')).toHaveCount(1);
  await expect(page.getByText('Опубликовано', { exact: true })).toBeVisible();

  mkdirSync('e2e/artifacts/learning/v-ux2a', { recursive: true });
  for (const [width, height, file] of [
    [1440, 900, 'desktop-1440.png'],
    [390, 844, 'mobile-390.png'],
    [320, 720, 'mobile-320.png'],
  ] as const) {
    await page.setViewportSize({ width, height });
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(page.getByText('Черновик создан на основе версии 1', { exact: true })).toBeVisible();
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(history.getByRole('alert')).toContainText('Уже существует черновик');
  await history.getByRole('button', { name: 'Открыть существующий черновик' }).click();
  await editor.getByRole('button', { name: 'Удалить блок 1', exact: true }).click();
  history = editor.getByTestId('author-version-history');
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await expect(
    history.getByRole('button', { name: 'Создать черновик из этой версии' }),
  ).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Опубликовать v2', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: '+ Текст', exact: true }).click();
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

  await expect(page.getByText('Версия 4 уже актуальна.', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: /^Опубликовать/ })).toHaveCount(0);
  await expect(editor.getByLabel('Название урока')).toHaveValue(
    'Unsaved input during outline refresh',
  );
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  const session = await page.request.get('/api/auth/me');
  expect(session.ok()).toBeTruthy();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();

  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();

  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
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
  const publishedButton = previewDrawer.getByRole('button', {
    name: 'Опубликованная версия',
    exact: true,
  });
  const draftButton = previewDrawer.getByRole('button', { name: 'Черновик', exact: true });
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
