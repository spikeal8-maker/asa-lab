import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';

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
  await page.goto('/#/challenges');
  await page.getByLabel('Название материала', { exact: true }).fill('Published V1');
  await page.getByLabel('Содержание', { exact: true }).fill('Published instructions V1');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  await page.getByLabel('Название материала', { exact: true }).fill('Saved draft r2');
  await page.getByLabel('Содержание', { exact: true }).fill('Saved instructions r2');
  const draftButton = page.getByRole('button', { name: 'Как ученик: сохранённый черновик' });
  const publishedButton = page.getByRole('button', { name: 'Как ученик: опубликованная версия' });
  await expect(draftButton).toBeDisabled();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(draftButton).toBeEnabled();
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
      mutations.push(request.method() + ' ' + request.url());
  });
  const preview = page.getByTestId('learner-preview');
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
  await page.goto('/#/challenges');

  for (const n of [1, 2, 3]) {
    await page.getByLabel('Название материала', { exact: true }).fill('Material V' + n);
    await page.getByLabel('Содержание', { exact: true }).fill('Material content V' + n);
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(
      page.getByText('Опубликована версия ' + n + '. Материал остаётся закрытым.'),
    ).toBeVisible();
  }
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
  await expect(page.getByLabel('Название материала', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Содержание', { exact: true })).toBeDisabled();
  releaseRestore();

  await expect(page.getByLabel('Название материала', { exact: true })).toHaveValue('Material V1');
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
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 1' });
  await history.getByRole('button', { name: 'Создать черновик из этой версии' }).click();
  await expect(history.getByRole('alert')).toContainText('Уже существует черновик');
  await history.getByRole('button', { name: 'Открыть существующий черновик' }).click();
  await editor.getByRole('button', { name: 'Удалить блок 1', exact: true }).click();
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
  await history
    .getByLabel('Опубликованная версия', { exact: true })
    .selectOption({ label: 'Версия 4' });
  await expect(
    history.getByRole('button', { name: 'Создать черновик из этой версии' }),
  ).toBeDisabled();
  await editor.screenshot({ path: 'e2e/artifacts/learning/version-draft/published-v4.png' });
});


function solidPng(red: number, green: number, blue: number): Buffer {
  const image = new PNG({ width: 3, height: 3 });
  for (let pixel = 0; pixel < 9; pixel += 1) {
    const offset = pixel * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

test('teacher draft sample survives reload, replacement and deletion without legacy assignment writes', async ({
  page,
}) => {
  test.setTimeout(120000);
  const unique = crypto.randomUUID().replaceAll('-', '').slice(0, 18);
  const title = 'Draft image ' + unique;
  const imageA = solidPng(220, 40, 40);
  const imageB = solidPng(40, 80, 220);
  const legacyMutations: string[] = [];

  page.on('request', (request) => {
    if (
      request.url().includes('/api/assignments') &&
      !['GET', 'HEAD'].includes(request.method())
    ) {
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

  await page.goto('/#/challenges');
  await page.getByLabel('Название материала', { exact: true }).fill(title);
  await page.getByLabel('Содержание', { exact: true }).fill('Соберите схему по изображению.');
  const fileInput = page.getByLabel('Файл схемы или изображения', { exact: true });
  await fileInput.setInputFiles({ name: 'image-a.png', mimeType: 'image/png', buffer: imageA });
  await expect(page.getByRole('img', { name: 'Схема / изображение задания' })).toBeVisible();

  await page.getByRole('button', { name: 'Создать материал', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: title, exact: true }).click();
  const savedImageA = page.getByRole('img', { name: 'Схема / изображение задания' });
  await expect(savedImageA).toBeVisible();
  const sourceA = await savedImageA.getAttribute('src');
  expect(sourceA).toBeTruthy();
  const responseA = await page.request.get(new URL(sourceA!, page.url()).toString());
  expect(responseA.ok()).toBe(true);
  expect(Buffer.compare(await responseA.body(), imageA)).toBe(0);

  await page.getByRole('button', { name: 'Как ученик: сохранённый черновик' }).click();
  const preview = page.getByTestId('learner-preview');
  await expect(preview.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(preview.getByRole('img', { name: `Образец: ${title}` })).toBeVisible();

  await page
    .getByLabel('Файл схемы или изображения', { exact: true })
    .setInputFiles({ name: 'image-b.png', mimeType: 'image/png', buffer: imageB });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: title, exact: true }).click();
  const savedImageB = page.getByRole('img', { name: 'Схема / изображение задания' });
  await expect(savedImageB).toBeVisible();
  const sourceB = await savedImageB.getAttribute('src');
  expect(sourceB).toBeTruthy();
  expect(sourceB).not.toBe(sourceA);
  const responseB = await page.request.get(new URL(sourceB!, page.url()).toString());
  expect(responseB.ok()).toBe(true);
  expect(Buffer.compare(await responseB.body(), imageB)).toBe(0);

  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Изображение удалено.', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('img', { name: 'Схема / изображение задания' })).toHaveCount(0);
  await expect(page.getByText('Выбрать файл', { exact: true })).toBeVisible();
  expect(legacyMutations).toEqual([]);
});
