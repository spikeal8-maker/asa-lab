import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import { openPortalSection } from './portal-navigation';
import {
  addCourseBlock,
  openCourseActions,
  openExistingAssignmentEditor,
  openNewAssignmentEditor,
  selectCoursePractice,
} from './learning-authoring-navigation';

const evidenceDir = 'e2e/artifacts/learning/file-course';
const widths = [1440, 1024, 390, 320];
const admin = e2eAdminPool();
test.afterAll(async () => {
  await admin.end();
});

async function capture(page: Page, target: Locator, name: string) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await target.scrollIntoViewIfNeeded();
    const geometry = await target.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        fitsPage: document.documentElement.scrollWidth <= innerWidth,
        fitsViewport: bounds.left >= -1 && bounds.right <= innerWidth + 1,
      };
    });
    expect(geometry, name + ' at ' + width).toEqual({ fitsPage: true, fitsViewport: true });
    await page.screenshot({ path: evidenceDir + '/' + name + '-' + width + '.png' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function downloadExact(page: Page, link: Locator, name: string, bytes: Buffer) {
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toBe(name);
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!)).toEqual(bytes);
}

async function createFileDraft(editor: Locator, title: string, saveLabel = 'Создать задание') {
  await editor.getByLabel('Тип задания', { exact: true }).selectOption('file');
  await expect(editor.getByLabel('Среда задания', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Название задания', { exact: true }).fill(title);
  await editor.getByLabel('Содержание', { exact: true }).fill('Приложите файл с результатом.');
  await editor.getByRole('button', { name: saveLabel, exact: true }).click();
  await expect(
    editor.getByText('Черновик сохранён. Публикация — отдельное действие.', { exact: true }),
  ).toBeVisible();
}

test('File answers: shared authoring, mixed Course, exact Seat uploads and frozen teacher downloads at four widths', async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  mkdirSync(evidenceDir, { recursive: true });
  const suffix = crypto.randomUUID().slice(0, 8);
  const classTitle = 'Класс файлов ' + suffix;
  const studentName = 'Ученик с файлом';
  const directTitle = 'Файл из класса ' + suffix;
  const courseTitle = 'Курс с файлами ' + suffix;
  const fileTitle = 'Отчёт по уроку ' + suffix;
  const practiceTitle = 'Практика с цепью ' + suffix;
  const essayTitle = 'Письменное объяснение ' + suffix;
  const quizTitle = 'Вопрос по уроку ' + suffix;
  const fileName = 'otchet-s-nablyudeniyami-i-rezultatami-proverki.txt';
  const original = Buffer.from('Первый отчёт.\nДве контрольные строки.\n');
  const revision = Buffer.from('Исправленный отчёт.\nНовые результаты проверки.\n');

  await loginWithOrganization(page, await seedTeacher(admin, 'file-course-' + suffix));
  await openPortalSection(page, 'Классы');
  await page
    .getByRole('button', { name: /^Создать(?: новый)? класс$/ })
    .first()
    .click();
  const create = page.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill(classTitle);
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: classTitle })
    .locator('.classroom-row-title')
    .click();
  const classroomId = /classrooms\/([a-f0-9-]+)/.exec(page.url())![1]!;
  await page.locator('.classroom-code-chip').click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  await page.getByRole('button', { name: 'Добавить ученика' }).click();
  const studentDialog = page.getByRole('dialog');
  await studentDialog.getByLabel('Имя в списке класса').fill(studentName);
  await studentDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(studentDialog).toBeHidden();
  const handle = page
    .getByRole('row')
    .filter({ hasText: studentName })
    .locator('.classroom-login-handle');
  await handle.click();
  const studentCode = (await handle.innerText()).trim();
  expect(studentCode).toMatch(/^[2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy]{6}$/);

  const classNav = page.getByRole('navigation', { name: 'Разделы класса' });
  await classNav.getByRole('button', { name: 'Обучение', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Отдельные задания', exact: true })
    .click();
  await page.getByRole('button', { name: 'Выдать задание', exact: true }).click();
  const directPicker = page.getByRole('dialog', { name: 'Назначить задание', exact: true });
  await directPicker.getByRole('button', { name: 'Создать новое задание', exact: true }).click();
  const classAuthor = page.getByRole('dialog', { name: 'Новое задание класса', exact: true });
  await createFileDraft(classAuthor, directTitle, 'Сохранить черновик');
  await capture(page, classAuthor.getByLabel('Название задания', { exact: true }), 'class-author');
  await classAuthor.getByRole('button', { name: 'Вернуться к классу', exact: true }).click();
  await expect(classAuthor).toBeHidden();
  await page.getByRole('button', { name: 'Выдать задание', exact: true }).click();
  await directPicker.getByText('Продолжить черновик', { exact: true }).click();
  await directPicker.getByLabel('Черновик', { exact: true }).selectOption({ label: directTitle });
  await directPicker.getByRole('button', { name: 'Открыть черновик', exact: true }).click();
  const resumed = page.getByRole('dialog', { name: 'Редактор задания класса', exact: true });
  await expect(resumed.getByLabel('Тип задания', { exact: true })).toHaveValue('file');
  await expect(resumed.getByLabel('Название задания', { exact: true })).toHaveValue(directTitle);
  await resumed.getByRole('button', { name: 'К выдаче', exact: true }).click();
  await expect(resumed).toBeHidden();
  await expect(directPicker.getByText(directTitle, { exact: true })).toBeVisible();
  await expect(directPicker.getByLabel('Весь класс', { exact: true })).toBeChecked();
  const directActivities = await page.request.get('/api/learning/activities');
  expect(directActivities.ok()).toBe(true);
  const directPublished = (await directActivities.json()).items.find(
    (item: { title: string }) => item.title === directTitle,
  );
  expect(directPublished).toMatchObject({
    kind: 'file',
    currentPublishedVersionId: expect.any(String),
  });
  const issueDirect = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/learning/activity-runs'),
  );
  await directPicker.getByRole('button', { name: 'Назначить', exact: true }).click();
  expect((await issueDirect).postDataJSON()).toMatchObject({
    activityVersionId: directPublished.currentPublishedVersionId,
    audienceType: 'whole_class',
  });
  await expect(directPicker).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'выдано всему классу' })).toBeVisible();

  const sharedEditor = page.locator('[aria-label="Редактор задания"]');

  for (const [kind, title] of [
    ['project', practiceTitle],
    ['essay', essayTitle],
    ['quiz', quizTitle],
  ] as const) {
    await openNewAssignmentEditor(page);
    await sharedEditor.getByLabel('Тип задания', { exact: true }).selectOption(kind);
    await sharedEditor.getByLabel('Название задания', { exact: true }).fill(title);
    await sharedEditor.getByLabel('Содержание', { exact: true }).fill('Проверьте результат.');
    if (kind === 'quiz') {
      await sharedEditor.getByRole('button', { name: 'Добавить вопрос', exact: true }).click();
      await sharedEditor.getByLabel('Тип вопроса 1', { exact: true }).selectOption('numeric');
      await sharedEditor
        .getByLabel('Текст вопроса 1', { exact: true })
        .fill('Сколько будет 2 + 2?');
      await sharedEditor.getByLabel('Баллы за вопрос 1', { exact: true }).fill('1');
      await sharedEditor.getByLabel('Ответ', { exact: true }).fill('4');
    }
    await sharedEditor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(sharedEditor.getByText(/Опубликована версия 1/)).toBeVisible();
  }

  await openPortalSection(page, 'Курсы и задания');
  await page.getByRole('button', { name: 'Курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const courseDialog = page.getByRole('dialog', { name: 'Новый курс', exact: true });
  await courseDialog.getByLabel('Название', { exact: true }).fill(courseTitle);
  await courseDialog.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const courseEditor = page.getByTestId('course-editor');
  await courseEditor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await courseEditor.getByLabel('Название урока').fill('Теория и четыре вида заданий');
  await courseEditor.getByLabel('Текст блока', { exact: true }).fill('Прочитайте условия урока.');
  await addCourseBlock(page, 'Практика');
  await courseEditor
    .getByRole('button', { name: 'Создать задание для урока', exact: true })
    .click();
  const inline = page.getByRole('dialog', { name: 'Новое задание для урока', exact: true });
  await createFileDraft(inline, fileTitle);
  await inline.getByRole('button', { name: 'Настройки', exact: true }).click();
  const settings = inline.getByRole('dialog', { name: 'Настройки', exact: true });
  await expect(settings.getByLabel('Среда проекта', { exact: true })).toHaveCount(0);
  await settings.getByLabel('Результат', { exact: true }).selectOption('graded');
  await settings.getByLabel('Максимум баллов', { exact: true }).fill('10');
  await settings.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  await inline.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    inline.getByText('Черновик сохранён. Публикация — отдельное действие.', { exact: true }),
  ).toBeVisible();

  const reopened = await page.context().newPage();
  await openExistingAssignmentEditor(reopened, fileTitle);
  await expect(reopened.getByLabel('Тип задания', { exact: true })).toHaveValue('file');
  await expect(reopened.getByLabel('Содержание', { exact: true })).toHaveValue(
    'Приложите файл с результатом.',
  );
  await reopened.close();
  await capture(
    page,
    inline.getByRole('button', { name: 'Добавить в урок', exact: true }),
    'course-author',
  );
  await inline.getByRole('button', { name: 'Добавить в урок', exact: true }).click();
  await expect(inline).toBeHidden();

  for (const [index, title] of [practiceTitle, essayTitle, quizTitle].entries()) {
    await addCourseBlock(page, 'Практика');
    await selectCoursePractice(page, title, index + 1);
  }
  const pins = courseEditor.locator('.course-pinned-practice');
  await expect(pins).toHaveCount(4);
  for (const [index, title] of [fileTitle, practiceTitle, essayTitle, quizTitle].entries()) {
    await expect(pins.nth(index)).toContainText(title);
  }
  const roots = await page.request.get('/api/learning/activities');
  expect(roots.ok()).toBe(true);
  const authored = (await roots.json()).items as Array<{
    title: string;
    kind: string;
    currentPublishedVersionId: string;
  }>;
  const orderedPins = [
    [fileTitle, 'file'],
    [practiceTitle, 'project'],
    [essayTitle, 'essay'],
    [quizTitle, 'quiz'],
  ] as const;
  const publishedVersionIds = orderedPins.map(([title, kind]) => {
    const activity = authored.find((item) => item.title === title);
    expect(activity).toMatchObject({ kind, currentPublishedVersionId: expect.any(String) });
    return activity!.currentPublishedVersionId;
  });
  expect(new Set(publishedVersionIds).size).toBe(4);
  await courseEditor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();
  await courseEditor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();
  await openCourseActions(page);
  await courseEditor.getByRole('button', { name: 'Назначить курс', exact: true }).click();
  const assign = page.getByRole('dialog', { name: 'Назначить курс', exact: true });
  await assign.getByLabel('Класс для курса').selectOption({ label: classTitle });
  await assign.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(assign.getByRole('status')).toContainText('Сервер подтвердил версию 1');
  await assign.getByRole('button', { name: 'Закрыть назначение', exact: true }).click();

  const learnerContext = await browser.newContext();
  const learner = await learnerContext.newPage();
  await learner.goto('/#/join-class?code=' + encodeURIComponent(joinCode));
  await learner.getByLabel('Код ученика', { exact: true }).fill(studentCode);
  await learner.getByRole('button', { name: 'Войти', exact: true }).click();
  await openPortalSection(learner, 'Моё обучение');
  const assignments = await learner.request.get('/api/class-join/me/assignments');
  expect(assignments.ok()).toBe(true);
  expect((await assignments.json()).items).toContainEqual(
    expect.objectContaining({
      title: directTitle,
      activityKind: 'file',
      activityRunId: expect.any(String),
      projectId: null,
    }),
  );
  const runs = await learner.request.get('/api/class-join/me/course-runs');
  expect(runs.ok()).toBe(true);
  const run = (await runs.json()).items.find(
    (item: { title: string }) => item.title === courseTitle,
  );
  const occurrences = run.sections[0].lessons[0].activityOccurrences;
  expect(occurrences).toHaveLength(orderedPins.length);
  for (const [index, [title, kind]] of orderedPins.entries()) {
    const occurrence = occurrences[index];
    expect(occurrence).toMatchObject({
      title,
      learningActivityVersionId: publishedVersionIds[index],
      moduleKey: kind === 'project' ? 'electronics' : null,
    });
    // Project practices keep the existing module-based Course DTO.
    expect(occurrence.activityKind).toBe(kind === 'project' ? undefined : kind);
  }
  await learner.goto('/#/learning?courseRun=' + encodeURIComponent(run.id));
  const learnerTasks = learner.getByTestId('course-activity-runtime');
  await expect(learnerTasks).toHaveCount(4);
  for (const [index, title] of [fileTitle, practiceTitle, essayTitle, quizTitle].entries()) {
    await expect(learnerTasks.nth(index)).toContainText(title);
  }
  const outline = learner.getByRole('list', {
    name: 'Практики урока «Теория и четыре вида заданий»',
  });
  for (const [index, label] of [
    'Файловый ответ',
    'Electronics',
    'Письменный ответ',
    'Тест',
  ].entries()) {
    const link = outline.getByRole('listitem').nth(index).getByRole('button');
    await expect(link).toContainText(orderedPins[index]![0]);
    await expect(link).toContainText(label + ' ·');
  }
  const answer = learner.getByRole('region', { name: 'Файловый ответ', exact: true });
  const status = answer.getByRole('status');
  const learnerDownload = answer.getByRole('link', { name: 'Скачать ' + fileName, exact: true });
  async function upload(bytes: Buffer) {
    await expect(answer.getByText('Выбрать файл', { exact: true })).toBeVisible();
    await answer.getByLabel('Файл ответа', { exact: true }).setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: bytes,
    });
    await expect(answer.getByText(fileName, { exact: true })).toBeVisible();
    await answer.getByRole('button', { name: 'Загрузить файл', exact: true }).click();
    await expect(status).toContainText('Файл сохранён');
  }
  await answer.getByRole('button', { name: 'Прикрепить файл', exact: true }).click();
  await upload(original);
  await learner.reload();
  await expect(status).toContainText('Файл сохранён');
  await downloadExact(learner, learnerDownload, fileName, original);
  await capture(
    learner,
    answer.getByRole('button', { name: 'Сдать файл', exact: true }),
    'learner-saved',
  );
  await answer.getByRole('button', { name: 'Сдать файл', exact: true }).click();
  await expect(status).toContainText('Файл сдан');
  await learner.reload();
  await expect(status).toContainText('Файл сдан');
  await expect(answer.getByLabel('Файл ответа', { exact: true })).toHaveCount(0);

  await page.goto('/#/classrooms/' + classroomId);
  await classNav.getByRole('button', { name: 'Журнал', exact: true }).click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  for (const title of [fileTitle, practiceTitle, essayTitle, quizTitle]) {
    await expect(
      page.getByRole('button', { name: new RegExp('^' + studentName + ' · ' + title) }),
    ).toBeVisible();
  }
  const cell = page.getByRole('button', {
    name: new RegExp('^' + studentName + ' · ' + fileTitle),
  });
  await cell.click();
  const review = page.getByRole('region', { name: 'Проверка сдачи', exact: true });
  const teacherDownload = review.getByRole('link', { name: 'Скачать ' + fileName, exact: true });
  await expect(teacherDownload).toBeVisible();
  const firstDownloadPath = (await teacherDownload.getAttribute('href'))!;
  expect(firstDownloadPath).toMatch(/^\/api\/learning\/file\/classes\//);
  const delivered = await page.request.get(firstDownloadPath);
  expect(delivered.ok()).toBe(true);
  expect(delivered.headers()['content-disposition']).toMatch(/^attachment/);
  expect(delivered.headers()['cache-control']).toContain('no-store');
  expect(delivered.headers()['x-content-type-options']).toBe('nosniff');
  expect([401, 403, 404]).toContain((await learner.request.get(firstDownloadPath)).status());
  await downloadExact(page, teacherDownload, fileName, original);
  await capture(page, teacherDownload, 'teacher-frozen');

  await review.getByLabel('Причина возврата или исправления').fill('Уточните результат.');
  await review.getByRole('button', { name: 'Вернуть на доработку', exact: true }).click();
  await expect(cell).toContainText('На доработке');
  await learner.reload();
  await answer.getByRole('button', { name: 'Начать доработку', exact: true }).click();
  await expect(status).toContainText('Файл ещё не прикреплён');
  await expect(learnerDownload).toHaveCount(0);
  await upload(revision);
  await answer.getByRole('button', { name: 'Сдать файл', exact: true }).click();
  await expect(status).toContainText('Файл сдан');
  await review.getByRole('button', { name: 'Закрыть проверку', exact: true }).click();
  await page.reload();
  await classNav.getByRole('button', { name: 'Журнал', exact: true }).click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  await cell.click();
  await expect(teacherDownload).toBeVisible();
  expect(await teacherDownload.getAttribute('href')).not.toBe(firstDownloadPath);
  await downloadExact(page, teacherDownload, fileName, revision);
  expect(await (await page.request.get(firstDownloadPath)).body()).toEqual(original);
  await review.getByLabel('Баллы из 10', { exact: true }).fill('8');
  await review.getByRole('button', { name: 'Принять и оценить', exact: true }).click();
  await expect(cell).toContainText('8/10');
  await review.getByRole('button', { name: 'Закрыть проверку', exact: true }).click();
  await capture(page, cell, 'journal');
  await learnerContext.close();
});
