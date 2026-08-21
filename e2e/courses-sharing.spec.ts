import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
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
const evidenceDir = 'e2e/artifacts/courses';

test.beforeAll(async () => {
  admin = e2eAdminPool();
  mkdirSync(evidenceDir, { recursive: true });
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
  return page
    .getByRole('navigation', { name: 'Разделы курсов и заданий' })
    .getByRole('button', { name });
}

test('a teacher builds a course, shares it by name, and a colleague takes a copy', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const authorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();
  const authorFailures = collectBrowserFailures(authorPage, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await loginWithOrganization(authorPage, author);

  const mateContext = await browser.newContext();
  const matePage = await mateContext.newPage();
  const mateFailures = collectBrowserFailures(matePage, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await loginWithOrganization(matePage, colleague);
  const runSuffix = Date.now().toString(36).slice(-7);
  const courseTitle = `Электроника · ${runSuffix}`;
  const classTitle = `7А · ${runSuffix}`;

  // Автор пишет два задания.
  await sidebar(authorPage, 'Курсы и задания').click();
  await bankTab(authorPage, 'Банк заданий').click();
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

  // И собирает из них курс: курс — это разделы, материалы и практика в порядке.
  await bankTab(authorPage, 'Мои курсы').click();
  await authorPage.getByRole('button', { name: 'Создать курс' }).first().click();
  const courseDialog = authorPage.getByRole('dialog', { name: 'Новый курс' });
  await courseDialog.getByLabel('Название').fill(courseTitle);
  await courseDialog.getByLabel('Короткое описание').fill('Первый маршрут от детали к схеме');
  await courseDialog.getByRole('button', { name: 'Создать курс' }).click();
  await expect(authorPage.getByTestId('course-editor')).toBeVisible();

  for (const title of ['Светодиод и резистор', 'Кнопка']) {
    await authorPage
      .locator('.course-outline')
      .getByRole('button', { name: '+ Урок', exact: true })
      .click();
    await authorPage.getByLabel('Тип урока').selectOption('assignment');
    await authorPage.getByLabel('Задание из банка', { exact: true }).selectOption({ label: title });
    await authorPage.getByRole('button', { name: 'Добавить урок' }).click();
    await expect(authorPage.getByText('Урок добавлен.')).toBeVisible();
  }
  const steps = authorPage.locator('.course-outline .course-lesson-link');
  await expect(steps).toHaveCount(2);
  await expect(steps.first()).toContainText('Светодиод и резистор');
  const evidenceStyle = await authorPage.addStyleTag({
    content: '.portal-header, .portal-sidebar, .skip-link { visibility: hidden !important; }',
  });
  await authorPage
    .getByTestId('course-editor')
    .screenshot({ path: `${evidenceDir}/course-editor-desktop.png` });

  // The same authoring surface is two-column on a computer and becomes one
  // column on a phone without creating horizontal page scroll.
  await expect
    .poll(() =>
      authorPage.locator('.course-builder').evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns.split(' ').length;
      }),
    )
    .toBe(2);
  await authorPage.setViewportSize({ width: 390, height: 844 });
  await expect(authorPage.getByRole('button', { name: 'Предпросмотр' })).toBeVisible();
  await expect
    .poll(() =>
      authorPage.locator('.course-builder').evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns.split(' ').length;
      }),
    )
    .toBe(1);
  expect(
    await authorPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await authorPage
    .getByTestId('course-editor')
    .screenshot({ path: `${evidenceDir}/course-editor-mobile.png` });
  await evidenceStyle.evaluate((element) => element.remove());
  await authorPage.setViewportSize({ width: 1280, height: 720 });

  // Порядок меняется здесь же: курс без порядка — просто список.
  await steps.first().click();
  await authorPage.getByRole('button', { name: 'Ниже: Светодиод и резистор' }).click();
  await expect(authorPage.getByText('Урок перемещён.')).toBeVisible();
  await expect(steps.first()).toContainText('Кнопка');

  // A real course also contains readable material, not only a row of tasks.
  await authorPage
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await authorPage.getByLabel('Название урока').fill('Почему нужен резистор');
  await authorPage
    .getByLabel('Что будет в уроке')
    .fill('Короткое объяснение перед первой практикой');
  await authorPage
    .getByLabel('Материал урока')
    .fill('Резистор ограничивает ток и защищает светодиод от перегрузки.');
  await authorPage.getByLabel('Примерное время, минут').fill('5');
  await authorPage.getByRole('button', { name: 'Добавить урок' }).click();
  await expect(authorPage.getByText('Урок добавлен.')).toBeVisible();
  await expect(steps).toHaveCount(3);

  // A learner-facing course is an immutable release, not the editable draft.
  await authorPage.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(authorPage.getByText('Курс опубликован: версия 1.')).toBeVisible();
  await expect(authorPage.getByText('Опубликован · v1', { exact: true })).toBeVisible();
  const publishedEvidenceStyle = await authorPage.addStyleTag({
    content: '.portal-header, .portal-sidebar, .skip-link { visibility: hidden !important; }',
  });
  await authorPage
    .getByTestId('course-editor')
    .screenshot({ path: `${evidenceDir}/course-published-desktop.png` });
  await publishedEvidenceStyle.evaluate((element) => element.remove());

  await authorPage.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const studentPreview = authorPage.getByTestId('course-preview-page');
  await expect(studentPreview).toContainText(courseTitle);
  await expect(studentPreview.locator('li')).toHaveCount(3);
  const previewEvidenceStyle = await authorPage.addStyleTag({
    content: '.portal-header, .portal-sidebar, .skip-link { visibility: hidden !important; }',
  });
  await authorPage.screenshot({ path: `${evidenceDir}/course-preview-desktop.png` });
  await previewEvidenceStyle.evaluate((element) => element.remove());
  await authorPage.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await expect(authorPage.getByTestId('course-editor')).toBeVisible();

  // The published version is assigned from inside a class. Course delivery and
  // the separate assignment bank share the existing work/review pipeline.
  await sidebar(authorPage, 'Классы').click();
  await authorPage.getByRole('button', { name: 'Создать класс' }).first().click();
  const classDialog = authorPage.getByRole('dialog', { name: 'Создать класс' });
  await classDialog.getByLabel('Название класса').fill(classTitle);
  await classDialog.getByLabel('Возраст учеников').selectOption('11-12');
  await classDialog.getByLabel('Электроника').check();
  await classDialog.getByRole('button', { name: 'Создать', exact: true }).click();
  const classCard = authorPage.getByTestId('classroom-card').filter({ hasText: classTitle });
  await classCard.locator('.classroom-row-title').click();
  const joinCode = (await authorPage.locator('.classroom-code-chip').innerText()).trim();

  await authorPage.getByRole('button', { name: 'Добавить ученика' }).click();
  const studentDialog = authorPage.getByRole('dialog');
  await studentDialog.getByLabel('Имя в списке класса').fill('Алина');
  await studentDialog.getByLabel('Имя для входа').fill('alina-course');
  await studentDialog.getByRole('button', { name: 'Добавить', exact: true }).click();

  await authorPage
    .locator('.classroom-workspace-tabs')
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await expect(authorPage.getByTestId('classroom-courses')).toBeVisible();
  await authorPage.getByLabel('Опубликованный курс').selectOption({ label: `${courseTitle} · v1` });
  await authorPage.getByRole('button', { name: 'Назначить курс' }).click();
  await expect(authorPage.getByText(`Курс «${courseTitle}» · v1 назначен классу.`)).toBeVisible();
  const teacherRun = authorPage.getByTestId('classroom-course-run');
  await expect(teacherRun).toContainText(courseTitle);
  await expect(teacherRun).toContainText('Проверить работы');
  await teacherRun.screenshot({ path: `${evidenceDir}/classroom-course-desktop.png` });

  // A learner enters with the ordinary class code and receives the same fixed
  // version as a course player, not as two unrelated cards.
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  const studentFailures = collectBrowserFailures(studentPage, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await studentPage.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await studentPage.getByRole('button', { name: 'Продолжить' }).click();
  await studentPage.getByLabel('Имя для входа').fill('alina-course');
  await studentPage.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await expect(studentPage.getByRole('button', { name: 'Войти в класс' })).toBeEnabled();
  await studentPage.getByRole('button', { name: 'Войти в класс' }).click();
  await studentPage.getByRole('button', { name: /^Классы/ }).click();
  const studentCourses = studentPage.getByTestId('seat-courses');
  await expect(studentCourses).toContainText(courseTitle);
  await studentCourses.getByRole('button', { name: new RegExp(courseTitle) }).click();
  const player = studentPage.getByTestId('seat-course-player');
  await expect(player).toContainText('Курс · v1');
  await expect(player).toContainText('Светодиод и резистор');
  await player.screenshot({ path: `${evidenceDir}/student-course-desktop.png` });
  await player.getByRole('button', { name: /Почему нужен резистор/ }).click();
  await expect(player).toContainText('Резистор ограничивает ток');
  await player.getByRole('button', { name: 'Отметить пройденным' }).click();
  await expect(player).toContainText('Пройдено 1 из 3');
  await studentPage.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => studentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await player.screenshot({ path: `${evidenceDir}/student-course-mobile.png` });
  studentFailures.assertEmpty();
  await studentContext.close();

  // Return to the author's draft for the sharing scenario below.
  await sidebar(authorPage, 'Курсы и задания').click();
  await bankTab(authorPage, 'Мои курсы').click();
  await authorPage
    .getByTestId('courses-list')
    .locator('li')
    .filter({ hasText: courseTitle })
    .locator('.course-row-main')
    .click();
  await expect(authorPage.getByTestId('course-editor')).toBeVisible();

  /**
   * Кому видно. Пока «только мне» — курса нет ни у кого, даже у коллеги из
   * соседней школы, которому его собираются открыть.
   */
  await sidebar(matePage, 'Курсы и задания').click();
  await bankTab(matePage, 'Каталог').click();
  await expect(matePage.getByText(courseTitle, { exact: true })).toHaveCount(0);

  await authorPage.getByRole('button', { name: 'Доступ', exact: true }).click();
  const share = authorPage.getByRole('dialog', { name: 'Кому видно' });
  await share.getByRole('radio', { name: /Названным преподавателям/ }).click();
  await share.getByLabel('Почта преподавателя').fill(colleague.email);
  await share.getByRole('button', { name: 'Открыть доступ' }).click();
  await expect(share.getByTestId('share-list')).toContainText(colleague.email);
  await share.getByRole('button', { name: 'Готово' }).click();

  // Теперь курс виден названному коллеге — и виден целиком, до того как он его
  // возьмёт: брать вслепую никто не должен.
  await matePage.reload();
  await sidebar(matePage, 'Курсы и задания').click();
  await bankTab(matePage, 'Каталог').click();
  const card = matePage
    .getByTestId('catalogue-list')
    .locator('li')
    .filter({ hasText: courseTitle });
  await expect(card).toHaveCount(1);
  // Кто автор — написано: преподаватель решает, брать ли работу незнакомца.
  await expect(card.locator('.catalogue-author')).toContainText('Педагог course-author');
  await card.getByRole('button', { name: 'Посмотреть' }).click();
  const preview = matePage.getByRole('dialog', { name: courseTitle });
  await expect(preview.locator('.course-items li')).toHaveCount(2);

  await preview.getByRole('button', { name: 'Забрать себе' }).click();
  await expect(matePage.getByText(`Курс «${courseTitle}» у вас.`, { exact: false })).toBeVisible();

  /**
   * Забранное — копия. Она своя: лежит в своей папке, закрыта от всех и не
   * меняется, когда автор правит оригинал.
   */
  await bankTab(matePage, 'Мои курсы').click();
  const mine = matePage.getByTestId('courses-list').locator('li').first();
  await expect(mine).toContainText('из каталога');
  await expect(mine).toContainText('Только мне');

  await authorPage.getByRole('button', { name: 'Курсы', exact: true }).click();
  await bankTab(authorPage, 'Банк заданий').click();
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
  await sidebar(matePage, 'Курсы и задания').click();
  await bankTab(matePage, 'Банк заданий').click();
  await expect(matePage.getByTestId('assignment-library')).toContainText('Кнопка');
  await expect(matePage.getByTestId('assignment-library')).not.toContainText('исправлено автором');

  // The published version remains intact, while the author gets an explicit
  // signal that the draft now differs and can deliberately publish v2.
  await bankTab(authorPage, 'Мои курсы').click();
  const changedCourse = authorPage
    .getByTestId('courses-list')
    .locator('li')
    .filter({ hasText: courseTitle });
  await expect(changedCourse).toContainText('Есть изменения · v1');

  authorFailures.assertEmpty();
  mateFailures.assertEmpty();
  await authorContext.close();
  await mateContext.close();
});
