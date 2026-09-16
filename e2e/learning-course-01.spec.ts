import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { openPortalSection } from './portal-navigation';

const evidenceDir = 'e2e/artifacts/learning/course-01';

let admin: pg.Pool;
let teacher: SeededTeacher;
let sequence = 0;
const keys = new Map<string, string>();
async function editRealProject(page: Page, module: string) {
  if (module === 'three-d') {
    await expect(page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
  } else {
    const resistor = page.getByRole('button', { name: 'Резистор', exact: true });
    await expect(resistor).toBeVisible({ timeout: 60000 });
    const count = await page.getByTestId('schematic-component').count();
    const card = (await resistor.boundingBox())!,
      canvas = (await page.locator('.workbench-canvas').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(page.getByTestId('schematic-component')).toHaveCount(count + 1);
  }
  await expect(
    page.getByText(
      /К проверке будет закреплена сохранённая редакция №|Черновик сохранён: редакция №/,
    ),
  ).toBeVisible();
  await page.reload();
  if (module === 'electronics')
    await expect(page.getByTestId('schematic-component').first()).toBeVisible();
  else await expect(page.getByTestId('asa3d-viewport')).toBeVisible();
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
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
    .click();
  await page.getByRole('button', { name: 'Подключить авторство', exact: true }).click();
  await page.goto('/#/challenges');
  await page.getByLabel('Название материала', { exact: true }).fill('Оцениваемая практика автора');
  await page.getByLabel('Содержание', { exact: true }).fill('Первая редакция.');
  await page.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('graded');
  await page.getByLabel('Максимум баллов', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Создать материал', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  const before = await (await page.request.get('/api/learning/activities')).json();
  const id = before.items[0].id;
  expect((await page.request.get(`/api/classrooms/${crypto.randomUUID()}/roster`)).status()).toBe(
    403,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Оцениваемая практика автора', exact: true }).click();
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Соберите проект и объясните соединение.');
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  const published = await (await page.request.get(`/api/learning/activities/${id}`)).json();
  await page.goto('/#/account');
  await page
    .getByLabel('Разделы настроек')
    .getByRole('button', { name: 'Возможности', exact: true })
    .click();
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Преподавание', exact: true }) })
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
    .getByRole('button', { name: 'Журнал', exact: true })
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
  await page.getByRole('button', { name: /^Оповещения/ }).click();
  const inbox = page.getByRole('dialog', { name: 'Учебные оповещения' });
  await inbox.getByRole('button', { name: 'Настроить', exact: true }).click();
  await inbox.getByLabel('Работы на проверку', { exact: true }).uncheck();
  await inbox.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
  await expect(inbox.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const learner = await learnerAssignments(browser, code, 'author-masha');
  await learner.page
    .getByTestId('seat-assignments')
    .getByRole('button', { name: 'Открыть', exact: true })
    .click();
  await editRealProject(learner.page, 'electronics');
  await learner.page.getByRole('button', { name: 'Сдать работу', exact: true }).click();
  await expect(
    learner.page.getByRole('button', { name: 'Работа сдана', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
  await expect(page.getByText('Ждут проверки: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Маша · Оцениваемая/ }).click();
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  await detail.getByLabel('Баллы из 10', { exact: true }).fill('8');
  await detail.getByLabel('Отзыв', { exact: true }).fill('Соединение объяснено.');
  await detail.getByRole('button', { name: 'Принять и оценить', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Маша · Оцениваемая/ })).toContainText('Освоено');
  await page.getByRole('button', { name: /^Оповещения/ }).click();
  await expect(inbox.getByText('Работа сдана', { exact: true })).toHaveCount(0);
  await inbox.screenshot({ path: evidenceDir + '/muted-inbox-queue-independent.png' });
  await learner.page.goto('/#/learning');
  await expect(learner.page.getByText('Освоено', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const stale = await page.context().newPage();
  await stale.goto(page.url());
  await stale
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
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
  await expect(learner.page.getByText('Нужна практика', { exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Новый материал', exact: true }).click();
    await page.getByLabel('Название материала', { exact: true }).fill(title);
    await page
      .getByLabel('Содержание', { exact: true })
      .fill('Соберите и сохраните собственный проект.');
    await page.getByRole('button', { name: 'Создать материал', exact: true }).click();
    await expect(
      page.getByText('Черновик сохранён. Публикация — отдельное действие.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  }
  await createClassWithStudents(page, 'Большой класс', []);
  await page.getByRole('button', { name: 'Добавить списком', exact: true }).click();
  const roster = page.getByRole('dialog');
  await roster
    .getByLabel('Ученики', { exact: true })
    .fill(
      Array.from(
        { length: 30 },
        (_, i) => `Ученик ${String(i + 1).padStart(2, '0')}, matrix-e1-${i + 1}`,
      ).join('\n'),
    );
  await roster.getByRole('button', { name: 'Проверить список', exact: true }).click();
  await expect(roster.getByText('Список проверен сервером')).toBeVisible();
  await roster.getByRole('button', { name: 'Добавить учеников (30)', exact: true }).click();
  await expect(roster.getByRole('heading', { name: 'Ученики добавлены: 30' })).toBeVisible();
  await expect(roster.locator('.classroom-batch-card')).toHaveCount(30);
  await roster.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(roster).toBeHidden();
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
});

test.afterAll(async () => {
  await admin.end();
});

async function createPublishedProjectActivity(
  page: Page,
  title: string,
  module = 'electronics',
  resultMode = 'completion',
  actor = teacher,
): Promise<void> {
  await loginWithOrganization(page, actor);
  await page.goto('/#/challenges');
  await page.getByLabel('Название материала', { exact: true }).fill(title);
  await page
    .getByLabel('Содержание', { exact: true })
    .fill('Соберите цепь, сохраните проект и сдайте точную редакцию.');
  await page.getByLabel('Среда проекта').selectOption(module);
  await page.getByRole('combobox', { name: 'Результат', exact: true }).selectOption(resultMode);
  await page.getByRole('button', { name: 'Создать материал', exact: true }).click();
  await expect(page.getByText('Черновик сохранён. Публикация — отдельное действие.')).toBeVisible();
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText(/Опубликована версия 1/)).toBeVisible();
  await page.screenshot({ path: evidenceDir + '/authored-material-published.png', fullPage: true });
}

test('Teacher Home: empty, exact review, read/OFF, return/resubmit, accept and exact join approval', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const homeTeacher = await seedTeacher(admin, 'teacher-home');
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = 'Практика с Главной';
  await createPublishedProjectActivity(page, title, 'three-d', 'completion', homeTeacher);
  await page.goto('/#/');
  const home = page.getByRole('region', { name: 'Требует внимания', exact: true });
  await expect(
    home.getByText('Сейчас нет работ и заявок, ожидающих вашего решения.'),
  ).toBeVisible();
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
  const submit = async () => {
    await learner.page.getByRole('button', { name: 'Сдать работу', exact: true }).click();
    await expect(
      learner.page.getByRole('button', { name: 'Работа сдана', exact: true }),
    ).toBeDisabled();
  };
  await submit();
  await page.goto('/#/');
  const link = home.getByRole('link', { name: 'Лена Главная · ' + title, exact: true });
  await expect(link).toBeVisible();
  const firstHref = (await link.getAttribute('href'))!;
  expect(firstHref).toContain('/classrooms/' + classId + '?assignment=');
  expect(firstHref).toMatch(/&learner=.+&attempt=/);
  await home.getByText('Активные классы (1)', { exact: true }).click();
  await expect(home.getByRole('link', { name: 'Класс Главной', exact: true })).toHaveAttribute(
    'href',
    '#/classrooms/' + classId,
  );
  await page.getByRole('button', { name: /^Оповещения/ }).click();
  const inbox = page.getByRole('dialog', { name: 'Учебные оповещения' });
  await inbox.getByRole('button', { name: 'Отметить прочитанными', exact: true }).click();
  await inbox.getByRole('button', { name: 'Настроить', exact: true }).click();
  await inbox.getByLabel('Работы на проверку', { exact: true }).uncheck();
  await inbox.getByLabel('Получать учебные оповещения', { exact: true }).uncheck();
  await inbox.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
  await expect(inbox.getByText('Настройки сохранены.', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await home.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(link).toBeVisible();
  await home.screenshot({ path: evidenceDir + '/teacher-home-attention.png' });
  await link.click();
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  await expect(detail.getByRole('heading', { name: 'Лена Главная · ' + title })).toBeVisible();
  await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
  await detail.getByLabel('Причина возврата или исправления').fill('Проверьте форму.');
  await detail.getByRole('button', { name: 'Вернуть на доработку', exact: true }).click();
  await expect(detail.getByText('Ревизия 1 · На доработке')).toBeVisible();
  await page.goto('/#/');
  await expect(home).toContainText('Работы на проверке: 0');
  await expect(link).toHaveCount(0);
  await learner.page.goto('/#/learning');
  await work.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await editRealProject(learner.page, 'three-d');
  await submit();
  await home.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute('href', firstHref);
  await link.click();
  await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
  await expect(detail.getByText('Ревизия 1 · Принято')).toBeVisible();
  await page.goto('/#/');
  await expect(home).toContainText('Работы на проверке: 0');
  await expect(link).toHaveCount(0);
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
  await home.getByRole('button', { name: 'Обновить', exact: true }).click();
  const requestLink = home.locator('a[href*="joinRequest="]');
  await expect(requestLink).toHaveAttribute(
    'href',
    '#/classrooms/' + classId + '?joinRequest=' + requestId,
  );
  await requestLink.click();
  const target = page.locator('#join-request-' + requestId);
  await expect(target).toBeFocused();
  await target.getByRole('button', { name: 'Принять заявку', exact: true }).click();
  await expect(target).toContainText('Принята');
  await page.goto('/#/');
  await expect(home).toContainText('Заявки: 0');
  await expect(
    home.getByText('Сейчас нет работ и заявок, ожидающих вашего решения.'),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await home.screenshot({ path: evidenceDir + '/teacher-home-empty-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
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
  await learner.page.getByRole('button', { name: 'Сдать работу', exact: true }).click();
  await expect(
    learner.page.getByRole('button', { name: 'Работа сдана', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
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
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  for (const student of students) {
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Имя в списке класса').fill(student.label);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog).toBeHidden();
    const rosterRow = page.getByRole('row').filter({ hasText: student.label });
    const studentCode = (await rosterRow.locator('.classroom-login-handle').innerText()).trim();
    expect(studentCode).toMatch(/^[2346789ACDEFGHJKMNPQRTUVWXY]{6}$/);
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
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Код ученика', { exact: true }).fill(keys.get(handle)!);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await openPortalSection(page, 'Моё обучение');
  return { context, page };
}

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
    await expect(brief.getByRole('button', { name: 'Сдать работу', exact: true })).toBeEnabled();
    await brief.getByRole('button', { name: 'Сдать работу', exact: true }).click();
    await expect(brief.getByRole('button', { name: 'Работа сдана', exact: true })).toBeDisabled();
    await learner.page.screenshot({
      path: evidenceDir + '/' + module + '-exact-submission.png',
      fullPage: true,
    });
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Журнал', exact: true })
      .click();
    const cell = page.getByRole('button', { name: new RegExp('Ирина · ' + title) });
    await cell.click();
    const detail = page.getByRole('region', { name: 'Проверка сдачи' });
    await expect(detail.getByText('Сданная версия', { exact: true })).toBeVisible();
    const firstVersion = await detail.getByTestId('submission-version-id').innerText();
    await detail.getByText('Содержимое и контрольная сумма сдачи', { exact: true }).click();
    const submittedDocument = await detail.locator('pre').innerText();
    // A later draft edit must not mutate the already submitted evidence A.
    await editRealProject(learner.page, module);
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
    await row.getByRole('button', { name: 'Открыть работу', exact: true }).click();
    await editRealProject(learner.page, module);
    await expect(brief.getByRole('button', { name: 'Сдать работу', exact: true })).toBeEnabled();
    await brief.getByRole('button', { name: 'Сдать работу', exact: true }).click();
    await expect(brief.getByRole('button', { name: 'Работа сдана', exact: true })).toBeDisabled();
    await page.goto(teacherUrl);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Журнал', exact: true })
      .click();
    await cell.click();
    await expect(detail.getByTestId('submission-version-id')).not.toHaveText(firstVersion);
    await detail.getByRole('button', { name: 'Принять выполнение', exact: true }).click();
    await expect(cell).toContainText('Выполнено');
    await page.screenshot({
      path: evidenceDir + '/gradebook-accepted-' + module + '.png',
      fullPage: true,
    });
    await learner.context.close();
  });

for (const module of ['electronics', 'three-d'])
  test(`private authored course → approved Account → theory and real ${module} submission → exact review`, async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    const material = 'Электроника курса ' + ++sequence,
      courseTitle = 'Первый курс ' + sequence;
    await createPublishedProjectActivity(page, material, module);
    await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
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
    await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
    await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();
    await editor
      .locator('.course-outline')
      .getByRole('button', { name: '+ Урок', exact: true })
      .click();
    await editor.getByLabel('Тип урока').selectOption('assignment');
    await editor
      .getByLabel('Задание из банка', { exact: true })
      .selectOption({ label: material + ' · опубликованная версия' });
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
    const context = await browser.newContext(),
      learner = await context.newPage();
    await loginWithOrganization(learner, learnerIdentity);
    await learner.goto('/#/attending');
    await learner.getByLabel('Код класса', { exact: true }).fill(code);
    await learner.getByRole('button', { name: 'Войти в класс', exact: true }).click();
    await expect(learner.getByText(/Заявка в класс.*отправлена/)).toBeVisible();
    await learner.goto('/#/learning');
    await expect(learner.getByTestId('seat-courses')).toHaveCount(0);
    await page.goto(classUrl);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Учащиеся', exact: true })
      .click();
    await page.getByRole('button', { name: 'Обновить заявки', exact: true }).click();
    await page.getByRole('button', { name: 'Принять заявку', exact: true }).click();
    await expect(page.locator('.learning-join-requests')).toContainText('Принята');
    await learner.reload();
    await learner
      .getByTestId('seat-courses')
      .getByRole('button')
      .filter({ hasText: courseTitle })
      .click();
    await expect(
      learner.getByText('Резистор ограничивает ток. Затем соберите свою схему.', { exact: true }),
    ).toBeVisible();
    await learner.getByRole('button', { name: 'Отметить пройденным', exact: true }).click();
    await expect(
      learner.getByRole('button', { name: 'Отметить непройденным', exact: true }),
    ).toBeVisible();
    await learner.getByRole('button', { name: 'Далее →', exact: true }).click();
    await learner.getByRole('button', { name: 'Начать задание', exact: true }).click();
    await editRealProject(learner, module);
    const brief = learner.getByTestId('assignment-brief');
    await expect(brief.getByRole('button', { name: 'Сдать работу', exact: true })).toBeEnabled();
    await brief.getByRole('button', { name: 'Сдать работу', exact: true }).click();
    await expect(brief.getByRole('button', { name: 'Работа сдана', exact: true })).toBeDisabled();
    await learner.screenshot({
      path: evidenceDir + '/account-course-' + module + '-submitted.png',
    });
    await page.getByRole('button', { name: /^Оповещения/ }).click();
    const inbox = page.getByRole('dialog', { name: 'Учебные оповещения' });
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
    await expect(
      learner.getByTestId('seat-courses').locator('li').filter({ hasText: courseTitle }),
    ).toContainText('Пройдено 2 из 2');
    await learner.screenshot({
      path: evidenceDir + '/account-course-' + module + '-completed.png',
    });
    await context.close();
  });
