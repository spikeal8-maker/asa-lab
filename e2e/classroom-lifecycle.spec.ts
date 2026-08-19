import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/**
 * A class outlives a lesson, and a teacher outlives a school year.
 *
 * Everything here is what happens to a register between Septembers: the class
 * that was named wrong gets renamed, last year's classes go into the archive in
 * one go, one comes back, and one should never have existed. None of it was
 * possible before — the menus were drawn and did nothing.
 */

const evidenceDir = 'e2e/artifacts/classroom-lifecycle';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function openClassrooms(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

async function createClass(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать новый класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  await dialog.getByLabel('Название класса').fill(title);
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByTestId('classroom-card').filter({ hasText: title })).toBeVisible();
}

/** Row order as the register renders it, which is what sorting has to change. */
async function titles(page: Page): Promise<string[]> {
  return page.locator('.classroom-row-title').allInnerTexts();
}

// Both tests work the same teacher's register, so the second must not start
// before the first has built one.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'classroom-lifecycle');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('a teacher renames, sorts, archives, restores and removes classes', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  await openClassrooms(page);

  await createClass(page, 'Ботаника 5В');
  await createClass(page, 'Авиамодели 7А');
  await createClass(page, 'Электроника 9Б');

  /**
   * Order. The control used to be a label with a chevron typed into it; it is
   * now a menu, and picking from it changes the register.
   */
  await page.getByRole('button', { name: 'Порядок классов' }).click();
  await page.getByRole('button', { name: 'По названию: А–Я' }).click();
  expect(await titles(page)).toEqual(['Авиамодели 7А', 'Ботаника 5В', 'Электроника 9Б']);
  await page.getByRole('button', { name: 'Порядок классов' }).click();
  await page.getByRole('button', { name: 'По названию: Я–А' }).click();
  expect(await titles(page)).toEqual(['Электроника 9Б', 'Ботаника 5В', 'Авиамодели 7А']);
  await page.screenshot({ path: `${evidenceDir}/sorted.png`, fullPage: true });

  /**
   * Properties, from the row. A name typed in a hurry is the most common thing
   * wrong with a class, and fixing it should not mean opening the class.
   */
  const wrongName = page.getByTestId('classroom-card').filter({ hasText: 'Ботаника 5В' });
  await wrongName.getByRole('button', { name: 'Действия с классом Ботаника 5В' }).click();
  await page.getByRole('button', { name: 'Свойства' }).click();
  const properties = page.getByRole('dialog', { name: 'Свойства класса' });
  await properties.getByLabel('Название класса').fill('Ботаника 5Г');
  await properties.getByLabel('Возраст учеников').selectOption('11-12');
  await properties.getByLabel('Электроника').check();
  await properties.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Класс «Ботаника 5Г» обновлён.')).toBeVisible();
  await expect(page.getByTestId('classroom-card').filter({ hasText: 'Ботаника 5Г' })).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/renamed.png`, fullPage: true });

  // The rename must survive a reload — the dialog wrote to the database, not
  // to the row it was opened from.
  await page.reload();
  await openClassrooms(page);
  await expect(page.getByTestId('classroom-card').filter({ hasText: 'Ботаника 5Г' })).toBeVisible();

  /**
   * Two classes at once. This is the end-of-year action the register existed
   * for and the button that used to be permanently disabled.
   */
  await page.getByLabel('Выбрать класс Ботаника 5Г').check();
  await page.getByLabel('Выбрать класс Авиамодели 7А').check();
  await page.getByRole('button', { name: 'Действия с выбранными классами' }).click();
  await page.screenshot({ path: `${evidenceDir}/bulk-menu.png` });
  await page.getByRole('button', { name: 'Архивировать', exact: true }).click();
  await expect(page.getByText('В архиве: 2.')).toBeVisible();
  expect(await titles(page)).toEqual(['Электроника 9Б']);

  /**
   * The archive tab names the state on the row itself, so the titles carry a
   * mark alongside the name. Whitespace is normalised: the mark sits beside the
   * name and wraps under it when the column is narrow, and that is a layout
   * decision rather than a change of what the row says.
   */
  await page.getByRole('button', { name: 'В архиве' }).click();
  const archived = (await titles(page)).map((title) => title.replace(/\s+/g, ' ').trim()).sort();
  expect(archived).toEqual(['Авиамодели 7А в архиве', 'Ботаника 5Г в архиве']);
  await page.screenshot({ path: `${evidenceDir}/archive.png`, fullPage: true });

  /**
   * An archived class opens for reading. Last year's register and last year's
   * work are exactly what a teacher comes back for; what they cannot do is add
   * a learner to a class that is not running.
   */
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: 'Авиамодели 7А' })
    .locator('.classroom-row-title')
    .click();
  await expect(page.getByRole('heading', { name: 'Авиамодели 7А', level: 1 })).toBeVisible();
  await expect(page.getByText(/Класс в архиве с/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить ученика' })).toBeDisabled();
  await page.screenshot({ path: `${evidenceDir}/archived-class.png`, fullPage: true });

  // And it comes back into service from its own page.
  await page.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(page.getByText(/Класс вернулся из архива/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить ученика' })).toBeEnabled();

  await page.getByRole('button', { name: '← Мои классы' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: 'Авиамодели 7А' }),
  ).toBeVisible();

  /**
   * Removal. It disappears from every list and the join door closes; the rows
   * behind it — a learner's work, the record of who did what — are kept, which
   * is the difference between tidying a register and destroying evidence.
   */
  page.once('dialog', (dialog) => void dialog.accept());
  const doomed = page.getByTestId('classroom-card').filter({ hasText: 'Электроника 9Б' });
  await doomed.getByRole('button', { name: 'Действия с классом Электроника 9Б' }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Удалено: 1.')).toBeVisible();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: 'Электроника 9Б' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'В архиве' }).click();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: 'Электроника 9Б' }),
  ).toHaveCount(0);

  const kept = await admin.query(
    `SELECT status FROM classrooms WHERE title = 'Электроника 9Б' AND tenant_id = $1`,
    [teacher.tenantId],
  );
  expect(kept.rows.map((row) => (row as { status: string }).status)).toEqual(['deleted']);

  failures.assertEmpty();
});

/**
 * The clock the register runs on belongs to the teacher, not to the device.
 * Proving it needs a zone the machine running the test is not in, so the test
 * sets one deliberately and reads a date back.
 */
test('classroom dates are read in the teacher’s own time zone', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);

  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const zoneField = page.getByLabel('Часовой пояс');
  await expect(zoneField).toBeVisible();
  await zoneField.selectOption('Pacific/Auckland');
  await page.getByRole('button', { name: 'Сохранить часовой пояс' }).click();
  await expect(page.getByText(/Часовой пояс: Pacific\/Auckland/)).toBeVisible();

  const stored = await admin.query(
    `SELECT p.time_zone
       FROM profiles p JOIN accounts a ON a.id = p.account_id
      WHERE lower(a.email) = lower($1)`,
    [teacher.email],
  );
  expect((stored.rows[0] as { time_zone: string }).time_zone).toBe('Pacific/Auckland');

  // The setting survives a reload and is what the register formats with.
  await page.reload();
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  const shown = await page.locator('.classroom-row-date').first().innerText();
  const expected = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Pacific/Auckland',
  }).format(new Date());
  expect(shown).toContain(expected);
  await page.screenshot({ path: `${evidenceDir}/time-zone.png`, fullPage: true });

  failures.assertEmpty();
});
