import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
  await page.screenshot({
    path: 'e2e/artifacts/learning/author-preview/published-v1.png',
    fullPage: true,
  });
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
  await page.screenshot({
    path: 'e2e/artifacts/learning/author-preview/saved-draft-r2.png',
    fullPage: true,
  });
});
