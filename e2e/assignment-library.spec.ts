import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/**
 * The teacher's own bank of tasks.
 *
 * Three things were reported wrong here and each has an assertion below:
 *
 *  - the bank could not be found — the sidebar said «Задачи» and the page it
 *    opened is headed «Задания», so a teacher looking for their tasks went past
 *    the one destination that had them;
 *  - a new task did not save — teacher_assignment_save looked the teacher's
 *    tenant up in a table that only holds accounts carried over from before the
 *    account rework, so for everyone who registered after it returned nothing
 *    and the dialog answered "Задание не найдено." over a filled-in form;
 *  - the description had no formatting and no way to attach a picture, and the
 *    goal was not marked out from the rest of the words.
 */

const evidenceDir = 'e2e/artifacts/assignment-library';

let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'assignment-library');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('a teacher writes a task with a goal and a picture, and hands it to a class', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);

  // A class first: it is what seeds the ten shipped tasks into the bank, and
  // what the new task will be handed to at the end.
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const classDialog = page.getByRole('dialog', { name: 'Создать класс' });
  await classDialog.getByLabel('Название класса').fill('6В группа');
  await classDialog.getByLabel('Возраст учеников').selectOption('11-12');
  await classDialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByTestId('classroom-card').filter({ hasText: '6В группа' })).toBeVisible();

  // The bank, reached the way a teacher reaches it: the sidebar now names it
  // after the page it opens.
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Задания', level: 1 })).toBeVisible();
  const library = page.getByTestId('assignment-library');
  // The ten a class is given belong to the teacher, so they are here as well —
  // one entry each, however many classes have them.
  await expect(library.locator('li')).toHaveCount(10);
  await expect(library).toContainText('Собрать модель из простых фигур');

  // Writing one. This is the form that used to lose everything typed into it.
  await page.getByRole('button', { name: 'Новое задание' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое задание' });
  await dialog.getByLabel('Название').fill('Подставка для карандашей');
  await dialog.getByLabel('Цель — одной строкой').fill('Научиться делать полость вычитанием');
  await dialog
    .getByLabel('Что нужно сделать')
    .fill(
      '## Порядок работы\n1. Поставьте цилиндр\n2. Вычтите второй цилиндр\n\n**Проверьте:** дно осталось.',
    );

  // A picture, attached the way a teacher attaches one.
  await dialog.locator('.assignment-editor-sample input[type="file"]').setInputFiles({
    name: 'obrazec.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(dialog.locator('.assignment-editor-sample img')).toBeVisible();

  // Что увидит ученик — видно сразу, рядом с текстом: разметку набирают редко,
  // а результат важен каждый раз.
  const preview = dialog.getByTestId('brief-preview');
  await expect(preview.locator('.assignment-goal')).toContainText(
    'Научиться делать полость вычитанием',
  );
  await expect(preview.locator('h4')).toHaveText('Порядок работы');
  await expect(preview.locator('ol li')).toHaveCount(2);
  await expect(preview.locator('strong')).toContainText('Проверьте:');
  await page.screenshot({ path: `${evidenceDir}/brief-preview.png`, fullPage: true });

  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Задание «Подставка для карандашей» сохранено.')).toBeVisible();

  // Saved means saved: it survives a reload, with its goal and its picture.
  await page.reload();
  const saved = page
    .getByTestId('assignment-library')
    .locator('li')
    .filter({ hasText: 'Подставка для карандашей' });
  await expect(saved).toContainText('Цель: Научиться делать полость вычитанием');
  await expect(saved.locator('img')).toHaveAttribute('src', /\/api\/assignments\/.+\/sample$/);

  // And it goes to a class from here, without walking into the class.
  await saved.getByRole('button', { name: 'Выдать классам' }).click();
  const handOut = page.getByRole('dialog', { name: 'Кому выдать' });
  // Ticking reloads the list, so the tick and the confirmation are separate
  // locators: check() would be verifying a node the re-render has replaced.
  await handOut.getByRole('checkbox', { name: '6В группа' }).click();
  await expect(handOut.getByRole('checkbox', { name: '6В группа' })).toBeChecked();
  await handOut.getByRole('button', { name: 'Готово' }).click();
  await expect(saved).toContainText('Выдано классам: 1');
  await page.screenshot({ path: `${evidenceDir}/library.png`, fullPage: true });

  /**
   * Картинка внутри текста задания.
   *
   * «Соедини две детали» показывают, а не описывают: шаг с картинкой понимают с
   * первого раза. Картинка хранится у задания и подставляется в текст ссылкой —
   * значит, после сохранения в тексте стоит адрес, а не строка в тысячу знаков.
   */
  await saved.getByRole('button', { name: 'Изменить' }).click();
  const editing = page.getByRole('dialog', { name: 'Задание' });
  await editing.locator('.brief-toolbar-file input[type="file"]').setInputFiles({
    name: 'shag.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  // До сохранения картинка живёт в самой странице, и превью уже её показывает.
  await expect(editing.getByTestId('brief-preview').locator('.brief-figure img')).toBeVisible();
  await editing.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Задание «Подставка для карандашей» сохранено.')).toBeVisible();

  await page.reload();
  await page
    .getByTestId('assignment-library')
    .locator('li')
    .filter({ hasText: 'Подставка для карандашей' })
    .getByRole('button', { name: 'Изменить' })
    .click();
  const reopened = page.getByRole('dialog', { name: 'Задание' });
  await expect(reopened.getByLabel('Что нужно сделать')).toHaveValue(
    /!\[shag\]\(\/api\/assignments\/[0-9a-f-]+\/images\/[0-9a-f-]+\)/,
  );
  await expect(reopened.getByTestId('brief-preview').locator('.brief-figure img')).toHaveAttribute(
    'src',
    /\/api\/assignments\/.+\/images\/.+$/,
  );
  await reopened.getByRole('button', { name: 'Отмена' }).click();

  failures.assertEmpty();
});
