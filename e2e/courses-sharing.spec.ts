import { expect, test } from '@playwright/test';
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

test.beforeAll(async () => {
  admin = e2eAdminPool();
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
  return page.getByRole('button', { name, exact: true }).first();
}

function bankTab(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('navigation', { name: 'Разделы банка' }).getByRole('button', { name });
}

test('a teacher builds a course, shares it by name, and a colleague takes a copy', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const authorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();
  const authorFailures = collectBrowserFailures(authorPage, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(authorPage, author);

  const mateContext = await browser.newContext();
  const matePage = await mateContext.newPage();
  const mateFailures = collectBrowserFailures(matePage, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(matePage, colleague);

  // Автор пишет два задания.
  await sidebar(authorPage, 'Задания').click();
  for (const [title, goal] of [
    ['Светодиод и резистор', 'Понять, зачем резистор'],
    ['Кнопка', 'Понять замыкание'],
  ]) {
    await authorPage.getByRole('button', { name: 'Новое задание' }).click();
    const dialog = authorPage.getByRole('dialog', { name: 'Новое задание' });
    await dialog.getByLabel('Название').fill(title as string);
    await dialog.getByLabel('Цель — одной строкой').fill(goal as string);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(authorPage.getByText(`Задание «${title}» сохранено.`)).toBeVisible();
  }

  // И собирает из них курс: курс — это порядок, а не ещё одна папка.
  await bankTab(authorPage, 'Курсы').click();
  authorPage.once('dialog', (dialog) => void dialog.accept('Электроника, первый год'));
  await authorPage.getByRole('button', { name: 'Новый курс' }).click();
  await expect(authorPage.getByText('Курс «Электроника, первый год» создан.')).toBeVisible();
  await authorPage.getByRole('button', { name: 'Открыть', exact: true }).click();

  for (const title of ['Светодиод и резистор', 'Кнопка']) {
    await authorPage.getByLabel('Добавить задание из банка').selectOption({ label: title });
    await authorPage.getByRole('button', { name: 'Добавить' }).click();
    await expect(authorPage.getByText('Задание добавлено в курс.')).toBeVisible();
  }
  const steps = authorPage.getByTestId('course-items').locator('li');
  await expect(steps).toHaveCount(2);
  await expect(steps.first()).toContainText('Светодиод и резистор');

  // Порядок меняется здесь же: курс без порядка — просто список.
  await authorPage.getByRole('button', { name: 'Ниже: Светодиод и резистор' }).click();
  await expect(authorPage.getByText('Порядок изменён.')).toBeVisible();
  await expect(steps.first()).toContainText('Кнопка');

  /**
   * Кому видно. Пока «только мне» — курса нет ни у кого, даже у коллеги из
   * соседней школы, которому его собираются открыть.
   */
  await sidebar(matePage, 'Задания').click();
  await bankTab(matePage, 'Общий каталог').click();
  await expect(matePage.getByRole('heading', { name: 'Каталог пока пуст' })).toBeVisible();

  await authorPage.getByRole('button', { name: 'Кому видно' }).click();
  const share = authorPage.getByRole('dialog', { name: 'Кому видно' });
  await share.getByRole('radio', { name: /Названным преподавателям/ }).click();
  await share.getByLabel('Почта преподавателя').fill(colleague.email);
  await share.getByRole('button', { name: 'Открыть доступ' }).click();
  await expect(share.getByTestId('share-list')).toContainText(colleague.email);
  await share.getByRole('button', { name: 'Готово' }).click();

  // Теперь курс виден названному коллеге — и виден целиком, до того как он его
  // возьмёт: брать вслепую никто не должен.
  await matePage.reload();
  await sidebar(matePage, 'Задания').click();
  await bankTab(matePage, 'Общий каталог').click();
  const card = matePage.getByTestId('catalogue-list').locator('li').first();
  await expect(card).toContainText('Электроника, первый год');
  // Кто автор — написано: преподаватель решает, брать ли работу незнакомца.
  await expect(card.locator('.catalogue-author')).toContainText('Педагог course-author');
  await card.getByRole('button', { name: 'Посмотреть' }).click();
  const preview = matePage.getByRole('dialog', { name: 'Электроника, первый год' });
  await expect(preview.locator('.course-items li')).toHaveCount(2);

  await preview.getByRole('button', { name: 'Забрать себе' }).click();
  await expect(matePage.getByText(/Курс «Электроника, первый год» у вас/)).toBeVisible();

  /**
   * Забранное — копия. Она своя: лежит в своей папке, закрыта от всех и не
   * меняется, когда автор правит оригинал.
   */
  await bankTab(matePage, 'Курсы').click();
  const mine = matePage.getByTestId('courses-list').locator('li').first();
  await expect(mine).toContainText('взят из каталога');
  await expect(mine).toContainText('Только мне');

  await authorPage.getByRole('button', { name: '← Все курсы' }).click();
  await bankTab(authorPage, 'Задания').click();
  const authorRow = authorPage
    .getByTestId('assignment-library')
    .locator('li')
    .filter({ hasText: 'Кнопка' });
  await authorRow.getByRole('button', { name: 'Изменить' }).click();
  const editing = authorPage.getByRole('dialog', { name: 'Задание' });
  await editing.getByLabel('Название').fill('Кнопка (исправлено автором)');
  await editing.getByRole('button', { name: 'Сохранить' }).click();
  await expect(authorPage.getByText(/сохранено/)).toBeVisible();

  await matePage.reload();
  await sidebar(matePage, 'Задания').click();
  await expect(matePage.getByTestId('assignment-library')).toContainText('Кнопка');
  await expect(matePage.getByTestId('assignment-library')).not.toContainText('исправлено автором');

  authorFailures.assertEmpty();
  mateFailures.assertEmpty();
  await authorContext.close();
  await mateContext.close();
});
