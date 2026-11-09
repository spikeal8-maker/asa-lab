import { expect, test, type Browser, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import { openPortalSection } from './portal-navigation';
import {
  addCourseBlock,
  selectCoursePractice,
  openCourseActions,
  openExistingAssignmentEditor,
} from './learning-authoring-navigation';
const keys = new Map<string, string>();
const evidenceDir = 'e2e/artifacts/learning/quiz-course';
const admin = e2eAdminPool();
test.afterAll(async () => {
  await admin.end();
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
  await page.locator('.classroom-code-chip').click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  for (const student of students) {
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Имя в списке класса').fill(student.label);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog).toBeHidden();
    const rosterRow = page.getByRole('row').filter({ hasText: student.label });
    await rosterRow.locator('.classroom-login-handle').click();
    const studentCode = (await rosterRow.locator('.classroom-login-handle').innerText()).trim();
    expect(studentCode).toMatch(/^[2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy]{6}$/);
    keys.set(student.handle, studentCode);
  }
  return joinCode;
}

async function learnerAssignments(
  browser: Browser,
  joinCode: string,
  handle: string,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await expect(page.getByLabel('Код ученика', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
  await page.getByLabel('Код ученика', { exact: true }).fill(keys.get(handle)!);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await openPortalSection(page, 'Моё обучение');
  await page
    .getByRole('navigation', { name: 'Разделы моего обучения' })
    .getByRole('link', { name: 'Задания', exact: true })
    .click();
  return { context, page };
}

test('Complete Quiz Course: inline eight-type author, exact versions, Seat and Account saved answers, automatic and manual journal at four widths', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(evidenceDir, { recursive: true });
  const suffix = crypto.randomUUID().slice(0, 8);
  const identity = await seedTeacher(admin, 'quiz-course-' + suffix);
  await loginWithOrganization(page, identity);
  const classTitle = 'Класс тестов ' + suffix,
    quizTitle = 'Тест с объяснением ' + suffix,
    autoTitle = 'Автотест ' + suffix,
    courseTitle = 'Курс с тестами ' + suffix;
  const code = await createClassWithStudents(page, classTitle, [
    { label: 'Ученик теста', handle: 'quiz-' + suffix },
  ]);
  const classroomId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;
  await openPortalSection(page, 'Курсы и задания');
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const editor = page.getByTestId('course-editor');
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Проверка знаний');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Выполните два теста.');
  await addCourseBlock(page, 'Практика');
  await editor.getByRole('button', { name: 'Создать задание для урока', exact: true }).click();
  const author = page.getByRole('dialog', { name: 'Новое задание для урока', exact: true });
  await author.getByLabel('Тип задания', { exact: true }).selectOption('quiz');
  await expect(author.getByLabel('Среда задания', { exact: true })).toHaveCount(0);
  await author.getByLabel('Название задания', { exact: true }).fill(quizTitle);
  await author
    .getByLabel('Содержание', { exact: true })
    .fill('Выберите ответы и объясните решение.');
  await author.getByRole('button', { name: 'Настройки', exact: true }).click();
  const settings = author.getByRole('dialog', { name: 'Настройки', exact: true });
  await settings.getByLabel('Результат', { exact: true }).selectOption('graded');
  await expect(settings.getByLabel('Максимум баллов', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  const types = [
    'single_choice',
    'multiple_choice',
    'boolean',
    'numeric',
    'short_text',
    'matching',
    'ordering',
    'long_text_manual',
  ];
  for (let index = 1; index <= 8; index++) {
    const type = types[index - 1]!;
    await author.getByRole('button', { name: 'Добавить вопрос', exact: true }).click();
    await author.getByLabel('Тип вопроса ' + index, { exact: true }).selectOption(type);
    await author
      .getByLabel('Текст вопроса ' + index, { exact: true })
      .fill('Вопрос ' + index + ' ' + type);
    await author.getByLabel('Баллы за вопрос ' + index, { exact: true }).fill('1');
    const row = author
      .locator('.quiz-editor details')
      .filter({ has: page.getByLabel('Тип вопроса ' + index, { exact: true }) });
    if (['single_choice', 'multiple_choice', 'ordering'].includes(type)) {
      await row.getByLabel('options ' + index + '.1', { exact: true }).fill('Вариант A');
      await row.getByLabel('options ' + index + '.2', { exact: true }).fill('Вариант B');
    }
    if (type === 'single_choice')
      await row.getByRole('radio', { name: 'Вариант A', exact: true }).check();
    if (type === 'multiple_choice')
      await row.getByRole('checkbox', { name: 'Вариант A', exact: true }).check();
    if (type === 'boolean') await row.getByRole('radio', { name: 'Верно', exact: true }).check();
    if (type === 'numeric') await row.getByLabel('Ответ', { exact: true }).fill('42');
    if (type === 'short_text')
      await row.getByLabel('Допустимые ответы ' + index, { exact: true }).fill('ответ');
    if (type === 'matching') {
      await row.getByLabel('left ' + index + '.1', { exact: true }).fill('Левая A');
      await row.getByLabel('left ' + index + '.2', { exact: true }).fill('Левая B');
      await row.getByLabel('right ' + index + '.1', { exact: true }).fill('Правая A');
      await row.getByLabel('right ' + index + '.2', { exact: true }).fill('Правая B');
      await row.getByLabel('Соответствие: Левая A', { exact: true }).selectOption('r1');
      await row.getByLabel('Соответствие: Левая B', { exact: true }).selectOption('r2');
    }
    if (type === 'ordering') await row.getByLabel('Место 1', { exact: true }).selectOption('o2');
  }
  await author.getByRole('button', { name: 'Создать задание', exact: true }).click();
  await expect(
    author.getByText('Черновик сохранён. Публикация — отдельное действие.'),
  ).toBeVisible();
  // Reopen the real saved assignment in another author tab without losing the unsaved Course composition.
  const reopened = await page.context().newPage();
  await reopened.goto('/#/home');
  await openExistingAssignmentEditor(reopened, quizTitle);
  await expect(reopened.locator('.quiz-editor').getByText(/^Вопрос \d ·/)).toHaveCount(8);
  for (const width of [1440, 1024, 390, 320]) {
    await reopened.setViewportSize({ width, height: 900 });
    await reopened.getByLabel('Название задания', { exact: true }).focus();
    expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reopened.screenshot({
      path: `${evidenceDir}/author-reopened-${width}.png`,
      fullPage: false,
    });
  }
  await reopened.close();
  await author.getByRole('button', { name: 'Добавить в урок', exact: true }).click();
  await expect(author).toBeHidden();
  // A second published version removes manual work. Existing first Course pin must stay exactly V1.
  const versions = await page.context().newPage();
  await versions.goto('/#/home');
  await openExistingAssignmentEditor(versions, quizTitle);
  await versions.getByLabel('Название задания', { exact: true }).fill(autoTitle);
  await versions.locator('.quiz-editor summary').filter({ hasText: 'Вопрос 8 ·' }).click();
  await versions.getByRole('button', { name: 'Удалить вопрос', exact: true }).click();
  await versions.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    versions.getByText('Черновик сохранён. Публикация — отдельное действие.'),
  ).toBeVisible();
  await versions.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(versions.getByText(/Опубликована версия 2/)).toBeVisible();
  await versions.close();
  await addCourseBlock(page, 'Практика');
  await selectCoursePractice(page, autoTitle);
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  await openCourseActions(page);
  await editor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  const assign = page.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await assign.getByLabel('Класс для курса').selectOption({ label: classTitle });
  await assign.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(assign.getByRole('status')).toContainText('Классу назначена версия 1');
  await assign.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();
  const learner = await learnerAssignments(browser, code, 'quiz-' + suffix);
  const runs = await learner.page.request.get('/api/class-join/me/course-runs');
  const run = (await runs.json()).items.find(
    (item: { title: string }) => item.title === courseTitle,
  );
  const occurrences = run.sections
    .flatMap((section: { lessons: Array<{ activityOccurrences: unknown[] }> }) => section.lessons)
    .flatMap(
      (lesson: {
        activityOccurrences: Array<{
          title: string;
          activityRunId: string;
          activityKind: string;
          learningActivityVersionId: string;
        }>;
      }) => lesson.activityOccurrences,
    );
  const mixed = occurrences.find((item: { title: string }) => item.title === quizTitle),
    automatic = occurrences.find((item: { title: string }) => item.title === autoTitle);
  expect(mixed.activityKind).toBe('quiz');
  expect(automatic.activityKind).toBe('quiz');
  expect(mixed.learningActivityVersionId).not.toBe(automatic.learningActivityVersionId);
  const courseUrl = '/#/learning?courseRun=' + encodeURIComponent(run.id);
  await learner.page.goto(courseUrl);
  async function answer(player: Locator, manual: boolean) {
    await player.getByRole('button', { name: 'Начать тест', exact: true }).click();
    await expect(player.locator('fieldset')).toHaveCount(manual ? 8 : 7);
    for (let index = 1; index <= (manual ? 8 : 7); index++) {
      const field = player.locator('fieldset').nth(index - 1);
      if (index === 1) await field.getByRole('radio', { name: 'Вариант A', exact: true }).check();
      if (index === 2)
        await field.getByRole('checkbox', { name: 'Вариант A', exact: true }).check();
      if (index === 3) await field.getByRole('radio', { name: 'Верно', exact: true }).check();
      if (index === 4) await field.getByLabel('Ответ', { exact: true }).fill('42');
      if (index === 5) await field.getByLabel('Ответ', { exact: true }).fill('ответ');
      if (index === 6) {
        await field.getByLabel('Соответствие: Левая A', { exact: true }).selectOption('r1');
        await field.getByLabel('Соответствие: Левая B', { exact: true }).selectOption('r2');
      }
      if (index === 7) await field.getByLabel('Место 1', { exact: true }).selectOption('o2');
      if (index === 8)
        await field
          .getByLabel('Развёрнутый ответ', { exact: true })
          .fill('Моё объяснение решения.');
    }
    await player.getByRole('button', { name: 'Сохранить ответы', exact: true }).click();
    await expect(player.getByRole('status')).toContainText('Ответы сохранены');
  }
  const players = learner.page.getByRole('region', { name: 'Прохождение теста' });
  // section has an accessible name and is therefore a region.
  await answer(players.nth(0), true);
  await learner.page.reload();
  await expect(players.nth(0).getByLabel('Развёрнутый ответ', { exact: true })).toHaveValue(
    'Моё объяснение решения.',
  );
  for (const width of [1440, 1024, 390, 320]) {
    await learner.page.setViewportSize({ width, height: 900 });
    await players
      .nth(0)
      .getByRole('button', { name: 'Сдать тест', exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await learner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await learner.page.screenshot({
      path: `${evidenceDir}/learner-saved-${width}.png`,
      fullPage: false,
    });
  }
  await learner.page.setViewportSize({ width: 1440, height: 900 });
  await players.nth(0).getByRole('button', { name: 'Сдать тест', exact: true }).click();
  await expect(players.nth(0)).toContainText('Предварительный результат');
  await expect(players.nth(0)).toContainText('7 из 8');
  await answer(players.nth(1), false);
  await players.nth(1).getByRole('button', { name: 'Сдать тест', exact: true }).click();
  await expect(players.nth(1)).toContainText('7 из 7');
  async function journal() {
    await page.goto('/#/classrooms/' + classroomId);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Журнал', exact: true })
      .click();
    await page.getByRole('button', { name: 'Задания', exact: true }).click();
  }
  await journal();
  const mixedCell = page.getByRole('button', { name: new RegExp('^Ученик теста · ' + quizTitle) }),
    autoCell = page.getByRole('button', { name: new RegExp('^Ученик теста · ' + autoTitle) });
  await expect(autoCell).toContainText('7/7');
  await expect(mixedCell).not.toContainText('7/8');
  await mixedCell.click();
  const review = page.getByRole('region', { name: 'Проверка сдачи', exact: true });
  await expect(review.getByLabel('Развёрнутый ответ', { exact: true })).toHaveValue(
    'Моё объяснение решения.',
  );
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await review.getByLabel('Баллы из 8', { exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${evidenceDir}/teacher-frozen-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await review.getByLabel('Баллы из 8', { exact: true }).fill('8');
  await review.getByRole('button', { name: 'Принять и оценить', exact: true }).click();
  await expect(mixedCell).toContainText('8/8');
  await review.getByRole('button', { name: 'Закрыть проверку', exact: true }).click();
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await mixedCell.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${evidenceDir}/journal-final-${width}.png`, fullPage: false });
  }
  // A linked Account reaches the same pinned Course through ordinary join approval.
  await page.setViewportSize({ width: 1440, height: 900 });
  const accountContext = await browser.newContext();
  const account = await accountContext.newPage();
  await loginWithOrganization(account, await seedTeacher(admin, 'quiz-account-' + suffix));
  await account.goto('/#/attending');
  await account.getByLabel('Код класса', { exact: true }).fill(code);
  await account.getByRole('button', { name: 'Войти в класс', exact: true }).click();
  await expect(account.getByText(/Заявка в класс.*отправлена/)).toBeVisible();
  await page.goto('/#/classrooms/' + classroomId);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Заявки', exact: true })
    .click();
  await page.getByRole('button', { name: 'Обновить заявки', exact: true }).click();
  await page.getByRole('button', { name: 'Принять заявку', exact: true }).click();
  await expect(page.locator('.learning-join-requests')).toContainText('Принята');
  await account.goto(courseUrl);
  const accountPlayers = account.getByRole('region', { name: 'Прохождение теста' });
  await answer(accountPlayers.nth(0), true);
  await account.reload();
  await expect(accountPlayers.nth(0).getByLabel('Развёрнутый ответ', { exact: true })).toHaveValue(
    'Моё объяснение решения.',
  );
  await accountPlayers.nth(0).getByRole('button', { name: 'Сдать тест', exact: true }).click();
  await expect(accountPlayers.nth(0)).toContainText('Предварительный результат');
  await answer(accountPlayers.nth(1), false);
  await accountPlayers.nth(1).getByRole('button', { name: 'Сдать тест', exact: true }).click();
  await expect(accountPlayers.nth(1)).toContainText('7 из 7');
  await journal();
  const gradebook = await page.request.get(`/api/classrooms/${classroomId}/gradebook`);
  const accountRow = (await gradebook.json()).items.find(
    (item: { assignmentTitle: string; displayLabel: string }) =>
      item.assignmentTitle === quizTitle && item.displayLabel !== 'Ученик теста',
  );
  expect(accountRow).toBeTruthy();
  const accountCell = page.getByRole('button', {
    name: new RegExp(
      '^' + accountRow.displayLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · ' + quizTitle,
    ),
  });
  await accountCell.click();
  await expect(review.getByLabel('Развёрнутый ответ', { exact: true })).toHaveValue(
    'Моё объяснение решения.',
  );
  await review.getByLabel('Баллы из 8', { exact: true }).fill('8');
  await review.getByRole('button', { name: 'Принять и оценить', exact: true }).click();
  await expect(accountCell).toContainText('8/8');
  await account.reload();
  await expect(accountPlayers.nth(0)).toContainText('8 из 8');
  for (const width of [1440, 1024, 390, 320]) {
    await account.setViewportSize({ width, height: 900 });
    await accountPlayers.nth(0).scrollIntoViewIfNeeded();
    expect(await account.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await account.screenshot({
      path: `${evidenceDir}/account-final-${width}.png`,
      fullPage: false,
    });
  }
  await accountContext.close();
  await learner.context.close();
});
