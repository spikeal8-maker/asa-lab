import { expect } from '@playwright/test';
import {
  test,
  picker,
  COLLECTIONS,
  PROJECT_ID,
  capturePickerGeometry,
  expectPickerLayout,
} from './fixtures/project-collections';

// Permanent current-behavior baseline. Later UI trials add separate specs and
// import this fixture; they do not rewrite these tests to manufacture acceptance.
for (const width of [1440, 1024, 390, 320]) {
  for (const populated of [false, true]) {
    test(`collection picker baseline ${populated ? 'long populated' : 'empty'} at ${width}px`, async ({
      page,
      collectionApp,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await collectionApp.openProjects({
        longContent: true,
        collections: populated
          ? [
              {
                ...COLLECTIONS[0],
                title: 'Схемы для занятий и самостоятельного исследования электрических цепей',
              },
              { ...COLLECTIONS[1], title: 'Идеи для следующего проекта и полезные наблюдения' },
            ]
          : [],
        holding: populated ? [COLLECTIONS[0].id] : [],
      });
      const dialog = await collectionApp.openPicker();
      if (populated) {
        await expect(dialog.getByRole('checkbox')).toHaveCount(2);
        await expect(dialog.getByRole('checkbox').first()).toBeChecked();
        await expect(dialog.getByRole('checkbox').last()).not.toBeChecked();
      } else {
        await expect(dialog.getByText('Подборок пока нет — создайте первую.')).toBeVisible();
        await expect(dialog.getByRole('checkbox')).toHaveCount(0);
      }
      await expect(
        dialog.getByRole('button', { name: 'Создать и добавить', exact: true }),
      ).toBeDisabled();
      await dialog.getByPlaceholder('Новая подборка').fill('   ');
      await expect(
        dialog.getByRole('button', { name: 'Создать и добавить', exact: true }),
      ).toBeDisabled();
      const geometry = await capturePickerGeometry(
        page,
        info,
        `baseline-${populated ? 'populated' : 'empty'}-${width}`,
      );
      expectPickerLayout(geometry);
      // Actual values (including the current 34px input minimum and absent
      // aria-busy) live in geometry artifacts, without a touch44/aria claim.
      await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await collectionApp.openPicker();
      await page.keyboard.press('Escape');
      await expect(picker(page)).toHaveCount(0);
      expect(
        collectionApp.requests.filter((entry) => ['create', 'toggle'].includes(entry.operation)),
      ).toEqual([]);
    });
  }
}

test('collection picker loads controlled collections and holding after opening the actual project menu', async ({
  page,
  collectionApp,
}, info) => {
  const list = collectionApp.pauseNext('list');
  const holding = collectionApp.pauseNext('holding');
  await collectionApp.openProjects({ holding: [COLLECTIONS[0].id] });
  const dialog = await collectionApp.openPicker();
  await Promise.all([list.requested, holding.requested]);
  // Production currently renders the empty hint while loading, with no
  // dedicated loading state. Assert the eventual data rather than inventing one.
  await expect(dialog.getByText('Подборок пока нет — создайте первую.')).toBeVisible();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await capturePickerGeometry(page, info, 'collections-pending');
  list.release();
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await expect(dialog.getByRole('checkbox').first()).not.toBeChecked();
  holding.release();
  await expect(dialog.getByRole('checkbox').first()).toBeChecked();
  await expect(dialog.getByText('работ: 2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('пусто', { exact: true })).toBeVisible();
  expectPickerLayout(await capturePickerGeometry(page, info, 'collections-loaded'));
});

test('collection picker disables editing during add and remove and refreshes successful counts', async ({
  page,
  collectionApp,
}, info) => {
  await collectionApp.openProjects();
  const dialog = await collectionApp.openPicker();
  const checkbox = dialog.getByRole('checkbox', { name: COLLECTIONS[1].title, exact: true });
  const row = dialog.locator('li').filter({
    has: page.getByRole('checkbox', { name: COLLECTIONS[1].title, exact: true }),
  });
  await expect(checkbox).not.toBeChecked();
  await dialog.getByPlaceholder('Новая подборка').fill('Будущая подборка');
  for (const inside of [true, false]) {
    const pending = collectionApp.pauseNext('toggle');
    await checkbox.click();
    expect(await pending.requested).toEqual({
      operation: 'toggle',
      method: 'PUT',
      path: `/api/collections/${COLLECTIONS[1].id}/items/${PROJECT_ID}`,
      body: { inside },
    });
    await expect(checkbox).toBeDisabled();
    for (const other of await dialog.getByRole('checkbox').all())
      await expect(other).toBeDisabled();
    await expect(dialog.getByPlaceholder('Новая подборка')).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Создать и добавить', exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Готово', exact: true })).toBeEnabled();
    await expect(checkbox).toBeChecked({ checked: !inside });
    expectPickerLayout(await capturePickerGeometry(page, info, `toggle-pending-${inside}`));
    pending.release();
    await expect(checkbox).toBeEnabled();
    await expect(checkbox).toBeChecked({ checked: inside });
    await expect(row.locator('small')).toHaveText(inside ? 'работ: 1' : 'пусто');
  }
  expect(collectionApp.requests.filter((entry) => entry.operation === 'toggle')).toHaveLength(2);
});

test('collection picker toggle rejection preserves selection and permits a successful retry', async ({
  page,
  collectionApp,
}, info) => {
  await collectionApp.openProjects({ holding: [COLLECTIONS[0].id] });
  const dialog = await collectionApp.openPicker();
  const checkbox = dialog.getByRole('checkbox', { name: COLLECTIONS[0].title, exact: true });
  const row = dialog.locator('li').filter({
    has: page.getByRole('checkbox', { name: COLLECTIONS[0].title, exact: true }),
  });
  await expect(checkbox).toBeChecked();
  const pending = collectionApp.pauseNext('toggle', 503);
  await checkbox.click();
  await pending.requested;
  await expect(checkbox).toBeDisabled();
  pending.release();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();
  await expect(row.locator('small')).toHaveText('работ: 2');
  expectPickerLayout(await capturePickerGeometry(page, info, 'toggle-rejected'));
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(row.locator('small')).toHaveText('работ: 1');
});

test('collection picker creates a trimmed title and adds the project while pending controls stay disabled', async ({
  page,
  collectionApp,
}, info) => {
  await collectionApp.openProjects({ collections: [] });
  const dialog = await collectionApp.openPicker();
  const input = dialog.getByPlaceholder('Новая подборка');
  const create = dialog.getByRole('button', { name: 'Создать и добавить', exact: true });
  await input.fill('  Полезные схемы  ');
  const creation = collectionApp.pauseNext('create');
  const addition = collectionApp.pauseNext('toggle');
  await create.click();
  expect((await creation.requested).body).toEqual({ title: 'Полезные схемы' });
  await expect(input).toBeDisabled();
  await expect(create).toBeDisabled();
  await capturePickerGeometry(page, info, 'create-pending');
  creation.release();
  expect(await addition.requested).toEqual({
    operation: 'toggle',
    method: 'PUT',
    path: `/api/collections/created-1/items/${PROJECT_ID}`,
    body: { inside: true },
  });
  await expect(input).toBeDisabled();
  await expect(create).toBeDisabled();
  addition.release();
  const checkbox = dialog.getByRole('checkbox', { name: 'Полезные схемы', exact: true });
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  await expect(input).toHaveValue('');
  await expect(input).toBeEnabled();
  await expect(create).toBeDisabled();
  await expect(dialog.getByText('работ: 1', { exact: true })).toBeVisible();
  expectPickerLayout(await capturePickerGeometry(page, info, 'created-and-added'));
  await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await collectionApp.openPicker();
  await expect(
    picker(page).getByRole('checkbox', { name: 'Полезные схемы', exact: true }),
  ).toBeChecked();
});

test('collection picker create request rejection unlocks controls without adding a collection', async ({
  page,
  collectionApp,
}, info) => {
  await collectionApp.openProjects({ collections: [] });
  const dialog = await collectionApp.openPicker();
  const input = dialog.getByPlaceholder('Новая подборка');
  const create = dialog.getByRole('button', { name: 'Создать и добавить', exact: true });
  await input.fill('Отказ создания');
  const rejected = collectionApp.pauseNext('create', 503);
  await create.click();
  await rejected.requested;
  await expect(input).toBeDisabled();
  rejected.release();
  await expect(input).toBeEnabled();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByText('Подборок пока нет — создайте первую.')).toBeVisible();
  expect(collectionApp.requests.filter((entry) => entry.operation === 'toggle')).toEqual([]);
  await input.fill('Повтор создания');
  await expect(create).toBeEnabled();
  await create.click();
  await expect(
    dialog.getByRole('checkbox', { name: 'Повтор создания', exact: true }),
  ).toBeChecked();
  expectPickerLayout(await capturePickerGeometry(page, info, 'create-retry-success'));
});

for (const close of ['button', 'Escape']) {
  test(`collection picker ${close} closes during a pending mutation and can reopen`, async ({
    page,
    collectionApp,
  }) => {
    await collectionApp.openProjects();
    const dialog = await collectionApp.openPicker();
    const pending = collectionApp.pauseNext('toggle');
    await dialog.getByRole('checkbox', { name: COLLECTIONS[1].title, exact: true }).click();
    await pending.requested;
    if (close === 'button')
      await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    pending.release();
    await expect
      .poll(() => collectionApp.completed.filter((entry) => entry.operation === 'toggle').length)
      .toBe(1);
    await collectionApp.openPicker();
    await expect(
      picker(page).getByRole('checkbox', { name: COLLECTIONS[1].title, exact: true }),
    ).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByTestId('project-card')).toHaveCount(1);
  });
}

test('My Projects empty state does not expose a collection action without a project', async ({
  page,
  collectionApp,
}) => {
  await collectionApp.openProjects({ emptyProjects: true });
  await expect(
    page.getByRole('heading', { name: 'Создайте первый проект', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('project-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить в коллекцию', exact: true })).toHaveCount(
    0,
  );
  expect(collectionApp.requests).toEqual([]);
});
