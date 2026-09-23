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
  const assignmentAnchor = page.getByTestId('assignment-brief-anchor');
  const assignmentPanel = page.getByTestId('assignment-brief');
  await expect(assignmentAnchor).toBeVisible();
  if ((await assignmentAnchor.getAttribute('aria-expanded')) !== 'true') {
    await assignmentAnchor.click();
  }
  await expect(assignmentPanel).toBeVisible();

  const continueAction = assignmentPanel.getByRole('button', {
    name: 'Продолжить',
    exact: true,
  });
  if ((await continueAction.count()) > 0) {
    await expect(continueAction).toBeEnabled();
    await continueAction.click();
    await expect(continueAction).toHaveCount(0);
  }

  let expectedObjectCount = 0;
  if (module === 'three-d') {
    const viewport = page.getByTestId('asa3d-viewport');
    const objectCount = page.locator('.asa3d-object-count');
    await expect(viewport).toBeVisible({ timeout: 60000 });
    await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
    expectedObjectCount = Number.parseInt(await objectCount.innerText(), 10) + 1;
    const saveState = page.locator('.asa3d-save-state');
    await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    await expect(objectCount).toContainText(new RegExp(`^${expectedObjectCount} `));
    await expect(saveState).toHaveClass(/save-(dirty|saving)/);
    await expect(saveState).toHaveClass(/save-saved/);
    await expect(saveState).toContainText('Все изменения сохранены');
  } else {
    const resistor = page.getByRole('button', { name: 'Резистор', exact: true });
    await expect(resistor).toBeVisible({ timeout: 60000 });
    expectedObjectCount = (await page.getByTestId('schematic-component').count()) + 1;
    const card = (await resistor.boundingBox())!,
      canvas = (await page.locator('.workbench-canvas').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedObjectCount);
  }

  await page.reload();
  await expect(assignmentPanel).toBeVisible();
  if (module === 'electronics') {
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedObjectCount);
  } else {
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true');
    await expect(page.locator('.asa3d-object-count')).toContainText(
      new RegExp(`^${expectedObjectCount} `),
    );
  }
}
type CourseActivityProjectEvidence = {
  projectId: string;
  expectedObjectCount: number;
  addedComponentId?: string;
};

function courseActivityProjectId(page: Page, module: string): string {
  const location = new URL(page.url());
  const encoded =
    module === 'electronics'
      ? /^\/projects\/([^/]+)\/electronics\/edit\/?$/.exec(location.pathname)?.[1]
      : /^#\/3d\/([^?]+)/.exec(location.hash)?.[1];
  const projectId = encoded ? decodeURIComponent(encoded) : '';
  expect(projectId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return projectId;
}

async function editCourseActivityProject(
  page: Page,
  module: string,
): Promise<CourseActivityProjectEvidence> {
  const projectId = courseActivityProjectId(page, module);
  let expectedObjectCount = 0;
  let addedComponentId: string | undefined;

  if (module === 'three-d') {
    const viewport = page.getByTestId('asa3d-viewport');
    const objectCount = page.locator('.asa3d-object-count');
    await expect(viewport).toBeVisible({ timeout: 60000 });
    await expect(viewport).toHaveAttribute('data-runtime-ready', 'true');
    expectedObjectCount = Number.parseInt(await objectCount.innerText(), 10) + 1;
    const saveState = page.locator('.asa3d-save-state');
    await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
    await expect(objectCount).toContainText(new RegExp(`^${expectedObjectCount} `));
    await expect(saveState).toHaveClass(/save-(dirty|saving)/);
    await expect(saveState).toHaveClass(/save-saved/);
    await expect(saveState).toContainText('Все изменения сохранены');
  } else {
    const resistor = page.getByRole('button', { name: 'Резистор', exact: true });
    await expect(resistor).toBeVisible({ timeout: 60000 });
    const components = page.getByTestId('schematic-component');
    const existingIds = new Set(
      (
        await components.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-component-id')),
        )
      ).filter((id): id is string => id !== null),
    );
    expectedObjectCount = (await components.count()) + 1;

    const draftPath = `/api/projects/${encodeURIComponent(projectId)}/draft`;
    const saveResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'PUT' &&
        url.pathname === draftPath &&
        response.ok()
      );
    });

    const card = (await resistor.boundingBox())!,
      canvas = (await page.locator('.workbench-canvas').boundingBox())!;
    await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.65, {
      steps: 20,
    });
    await page.mouse.up();
    await expect(components).toHaveCount(expectedObjectCount);

    const saveResponse = await saveResponsePromise;
    const requestBody = saveResponse.request().postDataJSON() as {
      document?: { components?: Array<{ id?: string; kind?: string }> };
    };
    const requestComponents = requestBody.document?.components ?? [];
    expect(requestComponents).toHaveLength(expectedObjectCount);
    const newResistors = requestComponents.filter(
      (component) =>
        component.kind === 'resistor' &&
        typeof component.id === 'string' &&
        !existingIds.has(component.id),
    );
    expect(newResistors).toHaveLength(1);
    addedComponentId = newResistors[0]!.id!;

    const responseBody = (await saveResponse.json()) as {
      draft?: { document?: { components?: Array<{ id?: string; kind?: string }> } };
    };
    const savedComponents = responseBody.draft?.document?.components ?? [];
    expect(savedComponents).toHaveLength(expectedObjectCount);
    expect(
      savedComponents.some(
        (component) => component.id === addedComponentId && component.kind === 'resistor',
      ),
    ).toBe(true);
  }

  await page.reload();
  expect(courseActivityProjectId(page, module)).toBe(projectId);
  if (module === 'electronics') {
    expect(addedComponentId).toBeTruthy();
    await expect(page.getByTestId('schematic-component')).toHaveCount(expectedObjectCount);
    await expect(
      page.locator(
        `[data-testid="schematic-component"][data-component-id="${addedComponentId}"][data-kind="resistor"]`,
      ),
    ).toBeVisible();
  } else {
    await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true');
    await expect(page.locator('.asa3d-object-count')).toContainText(
      new RegExp(`^${expectedObjectCount} `),
    );
  }

  return {
    projectId,
    expectedObjectCount,
    ...(addedComponentId ? { addedComponentId } : {}),
  };
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
  await expect(learner.page.getByText('Сдано на проверку', { exact: true })).toBeVisible();
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
  const roster = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: 'Добавить список учеников', exact: true }),
  });
  await roster
    .getByLabel('Ученики', { exact: true })
    .fill(
      Array.from({ length: 30 }, (_, i) => `Ученик ${String(i + 1).padStart(2, '0')}`).join('\n'),
    );
  await roster.getByRole('button', { name: 'Проверить список', exact: true }).click();
  await expect(roster.getByText('Список проверен сервером')).toBeVisible();
  await roster.getByRole('button', { name: 'Добавить учеников (30)', exact: true }).click();
  await expect(roster.getByRole('heading', { name: 'Ученики добавлены: 30' })).toBeVisible();
  await roster.getByRole('button', { name: 'Карточки новых учеников', exact: true }).click();
  await expect(roster).toBeHidden();
  const accessCards = page.getByRole('dialog', { name: 'Карточки доступа' });
  await expect(accessCards.locator('.student-access-card')).toHaveCount(30);
  await accessCards.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(accessCards).toBeHidden();
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

async function createPublishedProjectActivityAfterLogin(
  page: Page,
  title: string,
  module = 'electronics',
  resultMode = 'completion',
): Promise<void> {
  await page.goto('/#/challenges');
  const newMaterial = page.getByRole('button', { name: 'Новый материал', exact: true });
  if (await newMaterial.isVisible()) await newMaterial.click();
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

async function createPublishedProjectActivity(
  page: Page,
  title: string,
  module = 'electronics',
  resultMode = 'completion',
  actor = teacher,
): Promise<void> {
  await loginWithOrganization(page, actor);
  await createPublishedProjectActivityAfterLogin(page, title, module, resultMode);
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
    await expect(learner.page.getByText('Сдано на проверку', { exact: true })).toBeVisible();
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
  const mobileOverflow = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          node: `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${
            typeof node.className === 'string' && node.className
              ? `.${node.className.trim().replace(/\s+/g, '.')}`
              : ''
          }`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > viewport + 1 || item.left < -1)
      .slice(0, 12);
    return { viewport, documentWidth, offenders };
  });
  expect(
    mobileOverflow.documentWidth,
    `mobile overflow: ${JSON.stringify(mobileOverflow)}`,
  ).toBeLessThanOrEqual(mobileOverflow.viewport);
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
  await expect(learner.page.getByText('Сдано на проверку', { exact: true })).toBeVisible();
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
    expect(studentCode).toMatch(/^[2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy]{6}$/);
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
  await expect(page.getByLabel('Код ученика', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
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
    await expect(brief.getByText('Сдано на проверку', { exact: true })).toBeVisible();
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
    await expect(brief.getByText('Сдано на проверку', { exact: true })).toBeVisible();
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

test('Course Builder duplicates a section and excludes hidden lesson only from future versions', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const material = 'Структурный Electronics материал ' + ++sequence;
  const courseTitle = 'Структурный курс ' + sequence;
  await createPublishedProjectActivity(page, material, 'electronics');

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
  await editor.getByLabel('Название урока').fill('Структурная теория');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Материал исходной версии.');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();

  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Тип урока').selectOption('assignment');
  await editor
    .getByLabel('Задание из банка', { exact: true })
    .selectOption({ label: material + ' · опубликованная версия' });
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(editor.locator('.course-outline-section').first().locator('li')).toHaveCount(2);

  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();

  const v1Code = await createClassWithStudents(page, 'Структура курса V1 ' + sequence, [
    { label: 'Ученик V1', handle: 'course-structure-v1-' + sequence },
  ]);
  const oldLearner = await learnerAssignments(browser, v1Code, 'course-structure-v1-' + sequence);
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

  await oldLearner.page.reload();
  const oldCourses = oldLearner.page.getByTestId('seat-courses');
  await oldCourses.getByRole('button').filter({ hasText: courseTitle }).click();
  await expect(oldLearner.page.getByText('Структурная теория', { exact: true })).toBeVisible();
  await expect(
    oldLearner.page.getByText('Материал исходной версии.', { exact: true }),
  ).toBeVisible();
  const oldPlayer = oldLearner.page.getByTestId('seat-course-player');
  await expect(oldPlayer.getByRole('navigation', { name: 'Переход между уроками' })).toContainText(
    '1 из 2',
  );
  await expect(
    oldPlayer.getByRole('complementary', { name: 'Содержание курса' }).locator('li'),
  ).toHaveCount(2);

  await page.goto('/#/challenges');
  await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();

  const sourceSection = editor.locator('.course-outline-section').first();
  await sourceSection.getByRole('button', { name: /Действия раздела/ }).click();
  await sourceSection.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(editor.locator('.course-outline-section')).toHaveCount(2);
  const duplicateSection = editor.locator('.course-outline-section').nth(1);
  await expect(duplicateSection.locator('li')).toHaveCount(2);

  await duplicateSection
    .getByRole('button', { name: /Действия урока/ })
    .first()
    .click();
  await duplicateSection.getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(duplicateSection.locator('.course-lesson-link small').first()).toContainText(
    'Скрыт',
  );

  await page.reload();
  await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();
  const reloadedSections = editor.locator('.course-outline-section');
  await expect(reloadedSections).toHaveCount(2);
  await expect(reloadedSections.nth(1).locator('.course-lesson-link small').first()).toContainText(
    'Скрыт',
  );

  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  await expect(preview.getByText('Структурная теория', { exact: true })).toHaveCount(1);
  await expect(preview.getByText('Материал исходной версии.', { exact: true })).toHaveCount(1);
  await expect(preview.locator(':scope > section')).toHaveCount(2);
  await expect(preview.locator(':scope > section > ol > li')).toHaveCount(3);
  await expect(preview.locator('.course-preview-assignment')).toHaveCount(2);
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();

  await editor.getByRole('button', { name: /Опубликовать v2/ }).click();
  await expect(page.getByText('Курс опубликован: версия 2.', { exact: true })).toBeVisible();

  const v2Code = await createClassWithStudents(page, 'Структура курса V2 ' + sequence, [
    { label: 'Ученик V2', handle: 'course-structure-v2-' + sequence },
  ]);
  const newLearner = await learnerAssignments(browser, v2Code, 'course-structure-v2-' + sequence);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v2' });
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();

  await newLearner.page.reload();
  const newCourses = newLearner.page.getByTestId('seat-courses');
  await newCourses.getByRole('button').filter({ hasText: courseTitle }).click();
  await expect(newLearner.page.getByText('Структурная теория', { exact: true })).toHaveCount(1);
  await expect(newLearner.page.getByText('Материал исходной версии.', { exact: true })).toHaveCount(
    1,
  );
  const newPlayer = newLearner.page.getByTestId('seat-course-player');
  await expect(newPlayer.getByRole('navigation', { name: 'Переход между уроками' })).toContainText(
    '1 из 3',
  );
  await expect(
    newPlayer.getByRole('complementary', { name: 'Содержание курса' }).locator('li'),
  ).toHaveCount(3);

  await oldLearner.page.reload();
  const oldCoursesAfterV2 = oldLearner.page.getByTestId('seat-courses');
  await oldCoursesAfterV2.getByRole('button').filter({ hasText: courseTitle }).click();
  await expect(oldLearner.page.getByText('Структурная теория', { exact: true })).toBeVisible();
  await expect(
    oldLearner.page.getByText('Материал исходной версии.', { exact: true }),
  ).toBeVisible();
  const oldPlayerAfterV2 = oldLearner.page.getByTestId('seat-course-player');
  await expect(
    oldPlayerAfterV2.getByRole('navigation', { name: 'Переход между уроками' }),
  ).toContainText('1 из 2');
  await expect(
    oldPlayerAfterV2.getByRole('complementary', { name: 'Содержание курса' }).locator('li'),
  ).toHaveCount(2);

  await oldLearner.context.close();
  await newLearner.context.close();
});

test('Course Builder persists informational block structural controls into future versions only', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const courseTitle = 'Блочная структура курса ' + ++sequence;
  await loginWithOrganization(page, teacher);
  await page.goto('/#/challenges');

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
  await editor.getByLabel('Название урока').fill('Блочная теория');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Исходный A');
  await editor.getByRole('button', { name: '+ Текст', exact: true }).click();
  await editor.getByLabel('Текст блока', { exact: true }).nth(1).fill('Исходный B');
  await editor.getByRole('button', { name: '+ Текст', exact: true }).click();
  await editor.getByLabel('Текст блока', { exact: true }).nth(2).fill('Исходный C');
  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();

  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();

  const v1Code = await createClassWithStudents(page, 'Блоки V1 ' + sequence, [
    { label: 'Ученик блоков V1', handle: 'course-block-v1-' + sequence },
  ]);
  const oldLearner = await learnerAssignments(browser, v1Code, 'course-block-v1-' + sequence);
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

  await oldLearner.page.reload();
  await oldLearner.page
    .getByTestId('seat-courses')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  const oldPlayer = oldLearner.page.getByTestId('seat-course-player');
  await expect(oldPlayer.locator('.lesson-blocks').first().locator(':scope > *')).toHaveText([
    'Исходный A',
    'Исходный B',
    'Исходный C',
  ]);

  await page.goto('/#/challenges');
  await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();
  await editor.locator('.course-lesson-link').first().click();

  const cards = editor.locator('.lesson-block-card');
  await expect(cards).toHaveCount(3);

  await cards.nth(0).getByRole('button', { name: 'Дублировать', exact: true }).click();
  await expect(cards).toHaveCount(4);
  await cards.nth(1).getByLabel('Текст блока', { exact: true }).fill('Дубликат A');

  await cards.nth(1).getByRole('button', { name: 'Вставить ниже', exact: true }).click();
  await cards
    .nth(1)
    .locator('.lesson-block-insert-picker')
    .getByRole('button', { name: '+ Заголовок', exact: true })
    .click();
  await expect(cards).toHaveCount(5);
  await cards.nth(2).getByLabel('Текст заголовка', { exact: true }).fill('Вставленный заголовок');

  await cards.nth(3).getByRole('button', { name: 'Скрыть', exact: true }).click();
  await expect(cards.nth(3)).toContainText('Скрыт');

  await cards.nth(4).getByRole('button', { name: 'Поднять блок 5', exact: true }).click();
  await expect(cards.nth(3).getByLabel('Текст блока', { exact: true })).toHaveValue('Исходный C');
  await expect(cards.nth(4)).toContainText('Скрыт');

  await editor.getByRole('button', { name: 'Сохранить урок', exact: true }).click();
  await expect(page.getByText('Урок сохранён.', { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
  await page
    .getByTestId('courses-list')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(editor).toBeVisible();
  await editor.locator('.course-lesson-link').first().click();
  const reloadedCards = editor.locator('.lesson-block-card');
  await expect(reloadedCards).toHaveCount(5);
  await expect(reloadedCards.nth(0).getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Исходный A',
  );
  await expect(reloadedCards.nth(1).getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Дубликат A',
  );
  await expect(reloadedCards.nth(2).getByLabel('Текст заголовка', { exact: true })).toHaveValue(
    'Вставленный заголовок',
  );
  await expect(reloadedCards.nth(3).getByLabel('Текст блока', { exact: true })).toHaveValue(
    'Исходный C',
  );
  await expect(reloadedCards.nth(4)).toContainText('Скрыт');

  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  await expect(preview.locator('.lesson-blocks').first().locator(':scope > *')).toHaveText([
    'Исходный A',
    'Дубликат A',
    'Вставленный заголовок',
    'Исходный C',
  ]);
  await expect(preview.getByText('Исходный B', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();

  await editor.getByRole('button', { name: /Опубликовать v2/ }).click();
  await expect(page.getByText('Курс опубликован: версия 2.', { exact: true })).toBeVisible();

  const v2Code = await createClassWithStudents(page, 'Блоки V2 ' + sequence, [
    { label: 'Ученик блоков V2', handle: 'course-block-v2-' + sequence },
  ]);
  const newLearner = await learnerAssignments(browser, v2Code, 'course-block-v2-' + sequence);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Курсы', exact: true })
    .click();
  await page.getByLabel('Опубликованный курс').selectOption({ label: courseTitle + ' · v2' });
  await page.getByRole('button', { name: 'Назначить курс', exact: true }).click();

  await newLearner.page.reload();
  await newLearner.page
    .getByTestId('seat-courses')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  const newPlayer = newLearner.page.getByTestId('seat-course-player');
  await expect(newPlayer.locator('.lesson-blocks').first().locator(':scope > *')).toHaveText([
    'Исходный A',
    'Дубликат A',
    'Вставленный заголовок',
    'Исходный C',
  ]);
  await expect(newPlayer.getByText('Исходный B', { exact: true })).toHaveCount(0);

  await oldLearner.page.reload();
  await oldLearner.page
    .getByTestId('seat-courses')
    .getByRole('button')
    .filter({ hasText: courseTitle })
    .click();
  await expect(
    oldLearner.page
      .getByTestId('seat-course-player')
      .locator('.lesson-blocks')
      .first()
      .locator(':scope > *'),
  ).toHaveText(['Исходный A', 'Исходный B', 'Исходный C']);

  await oldLearner.context.close();
  await newLearner.context.close();
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
    await editor.getByRole('button', { name: '+ Код', exact: true }).click();
    await editor.getByLabel('Язык кода', { exact: true }).fill('javascript');
    await editor
      .getByLabel('Код', { exact: true })
      .fill(
        '<script>window.__courseInformationalBlockExecuted = true</script>\n  const current = voltage / resistance;',
      );
    await editor.getByRole('button', { name: '+ Формула', exact: true }).click();
    await editor.getByLabel('Формула', { exact: true }).fill('I = U / R');
    await editor.getByRole('button', { name: '+ Таблица', exact: true }).click();
    await editor.getByLabel('Ячейка 1:1', { exact: true }).fill('Элемент');
    await editor.getByRole('button', { name: '+ Столбец', exact: true }).click();
    await editor.getByLabel('Ячейка 1:2', { exact: true }).fill('Значение');
    await editor.getByRole('button', { name: '+ Строка', exact: true }).click();
    await editor.getByLabel('Ячейка 2:1', { exact: true }).fill('R1');
    await editor.getByLabel('Ячейка 2:2', { exact: true }).fill('220 Ω');
    await editor.getByRole('button', { name: '+ Разделитель', exact: true }).click();
    await editor.getByRole('button', { name: 'Курсы', exact: true }).click();
    await expect(
      editor.getByText(
        'Сначала сохраните изменения урока. Переход не выполнен, данные не потеряны.',
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(editor.getByLabel('Название урока')).toHaveValue('Знакомство с резистором');
    await editor.getByRole('button', { name: 'Добавить раздел', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /раздел/i })).toHaveCount(0);
    await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
    await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
    await page
      .getByTestId('courses-list')
      .getByRole('button')
      .filter({ hasText: courseTitle })
      .click();
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('Язык кода', { exact: true })).toHaveValue('javascript');
    await expect(editor.getByLabel('Код', { exact: true })).toHaveValue(
      '<script>window.__courseInformationalBlockExecuted = true</script>\n  const current = voltage / resistance;',
    );
    await expect(editor.getByLabel('Формула', { exact: true })).toHaveValue('I = U / R');
    await expect(editor.getByLabel('Ячейка 1:1', { exact: true })).toHaveValue('Элемент');
    await expect(editor.getByLabel('Ячейка 1:2', { exact: true })).toHaveValue('Значение');
    await expect(editor.getByLabel('Ячейка 2:1', { exact: true })).toHaveValue('R1');
    await expect(editor.getByLabel('Ячейка 2:2', { exact: true })).toHaveValue('220 Ω');
    await expect(editor.getByText('Разделитель', { exact: true })).toBeVisible();

    await page.evaluate(() => Reflect.deleteProperty(window, '__courseInformationalBlockExecuted'));
    await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
    const preview = page.getByTestId('course-preview-page');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.lesson-code-block')).toContainText(
      '<script>window.__courseInformationalBlockExecuted = true</script>',
    );
    await expect(preview.getByText('I = U / R', { exact: true })).toBeVisible();
    await expect(preview.getByText('220 Ω', { exact: true })).toBeVisible();
    await expect(preview.locator('hr.lesson-divider-block')).toHaveCount(1);
    expect(
      await page.evaluate(() => Reflect.has(window, '__courseInformationalBlockExecuted')),
    ).toBe(false);
    await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();
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
    await learner.evaluate(() =>
      Reflect.deleteProperty(window, '__courseInformationalBlockExecuted'),
    );
    await learner
      .getByTestId('seat-courses')
      .getByRole('button')
      .filter({ hasText: courseTitle })
      .click();
    await expect(
      learner.getByText('Резистор ограничивает ток. Затем соберите свою схему.', { exact: true }),
    ).toBeVisible();
    await expect(learner.locator('.lesson-code-block')).toContainText(
      '<script>window.__courseInformationalBlockExecuted = true</script>',
    );
    await expect(learner.getByText('I = U / R', { exact: true })).toBeVisible();
    await expect(learner.getByText('220 Ω', { exact: true })).toBeVisible();
    await expect(learner.locator('hr.lesson-divider-block')).toHaveCount(1);
    expect(
      await learner.evaluate(() => Reflect.has(window, '__courseInformationalBlockExecuted')),
    ).toBe(false);
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
    await expect(brief.getByText('Сдано на проверку', { exact: true })).toBeVisible();
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

test('Course Activity blocks preserve mixed order and open exact Electronics and 3D runtimes', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const suffix = ++sequence;
  const electronicsTitle = `D5 Electronics Activity ${suffix}`;
  const threeDTitle = `D5 3D Activity ${suffix}`;
  const courseTitle = `D5 Activity blocks ${suffix}`;

  const d5Teacher = await seedTeacher(admin, 'learning-course01-d5');
  await loginWithOrganization(page, d5Teacher);
  await createPublishedProjectActivityAfterLogin(page, electronicsTitle, 'electronics');
  await createPublishedProjectActivityAfterLogin(page, threeDTitle, 'three-d');

  await page.getByRole('button', { name: 'Мои курсы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать курс', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый курс' });
  await form.getByLabel('Название', { exact: true }).fill(courseTitle);
  await form.getByRole('button', { name: 'Создать курс', exact: true }).click();

  const editor = page.getByTestId('course-editor');
  await editor
    .locator('.course-outline')
    .getByRole('button', { name: '+ Урок', exact: true })
    .click();
  await editor.getByLabel('Название урока').fill('Смешанная практика');
  await editor.getByLabel('Текст блока', { exact: true }).fill('Перед Electronics');

  await editor.getByRole('button', { name: '+ Практика', exact: true }).click();
  await editor
    .getByLabel('Опубликованная активность')
    .nth(0)
    .selectOption({ label: electronicsTitle });

  await editor.getByRole('button', { name: '+ Врезка', exact: true }).click();
  await editor.getByLabel('Текст врезки', { exact: true }).fill('Между двумя практиками');

  await editor.getByRole('button', { name: '+ Практика', exact: true }).click();
  await editor.getByLabel('Опубликованная активность').nth(1).selectOption({ label: threeDTitle });

  await editor.getByRole('button', { name: 'Добавить урок', exact: true }).click();
  await expect(page.getByText('Урок добавлен.', { exact: true })).toBeVisible();

  await editor.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  const preview = page.getByTestId('course-preview-page');
  const previewBlocks = preview.locator('.lesson-blocks').first().locator(':scope > *');
  await expect(previewBlocks).toHaveCount(4);
  await expect(previewBlocks.nth(0)).toContainText('Перед Electronics');
  await expect(previewBlocks.nth(1)).toContainText('Практика');
  await expect(previewBlocks.nth(2)).toContainText('Между двумя практиками');
  await expect(previewBlocks.nth(3)).toContainText('Практика');
  await editor.getByRole('button', { name: 'Редактировать', exact: true }).click();

  await editor.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await expect(page.getByText('Курс опубликован: версия 1.', { exact: true })).toBeVisible();

  const joinCode = await createClassWithStudents(page, 'D5 Activity class ' + suffix, [
    { label: 'D5 learner', handle: 'd5-activity-' + suffix },
  ]);
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

  const learner = await learnerAssignments(browser, joinCode, 'd5-activity-' + suffix);
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });

  type D5CourseRunRead = {
    id: string;
    title: string;
    sections: Array<{
      lessons: Array<{
        activityOccurrences: Array<{
          title: string;
          projectId: string | null;
          canonicalState: { workflowState: string } | null;
        }>;
      }>;
    }>;
  };

  function occurrenceFromCourseRun(run: D5CourseRunRead, title: string) {
    const occurrences = run.sections
      .flatMap((section) => section.lessons)
      .flatMap((lesson) => lesson.activityOccurrences)
      .filter((occurrence) => occurrence.title === title);
    expect(occurrences).toHaveLength(1);
    return occurrences[0]!;
  }

  let courseRunId: string | null = null;
  async function openCourse(): Promise<D5CourseRunRead> {
    const response = await learner.page.request.get('/api/class-join/me/course-runs');
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as { items: D5CourseRunRead[] };
    const matchingRuns = payload.items.filter((run) => run.title === courseTitle);
    expect(matchingRuns).toHaveLength(1);
    const run = matchingRuns[0]!;
    if (courseRunId === null) courseRunId = run.id;
    expect(run.id).toBe(courseRunId);
    await learner.page.goto('/#/learning?courseRun=' + encodeURIComponent(courseRunId));
    await expect(learner.page.getByTestId('seat-course-player')).toBeVisible();
    return run;
  }

  await openCourse();
  const player = learner.page.getByTestId('seat-course-player');
  const learnerBlocks = player.locator('.lesson-blocks').first().locator(':scope > *');
  await expect(learnerBlocks).toHaveCount(4);
  await expect(learnerBlocks.nth(0)).toContainText('Перед Electronics');
  await expect(learnerBlocks.nth(1)).toContainText(electronicsTitle);
  await expect(learnerBlocks.nth(2)).toContainText('Между двумя практиками');
  await expect(learnerBlocks.nth(3)).toContainText(threeDTitle);

  let electronicsCard = player
    .locator('.lesson-activity-block')
    .filter({ hasText: electronicsTitle });
  let threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText('Electronics');
  await expect(electronicsCard).toContainText('Не начато');
  await expect(threeDCard).toContainText('3D');
  await expect(threeDCard).toContainText('Не начато');

  await electronicsCard.getByRole('button', { name: 'Начать', exact: true }).click();
  const electronicsEvidence = await editCourseActivityProject(learner.page, 'electronics');
  expect(electronicsEvidence.projectId).not.toBe('');
  expect(electronicsEvidence.addedComponentId).toBeTruthy();

  await openCourse();
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(
    electronicsCard.getByRole('button', { name: 'Открыть работу', exact: true }),
  ).toBeVisible();
  await expect(threeDCard).toContainText('Не начато');
  await expect(threeDCard.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();

  await electronicsCard.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(electronicsEvidence.projectId);
  await expect(
    learner.page.locator(
      `[data-testid="schematic-component"][data-component-id="${electronicsEvidence.addedComponentId}"][data-kind="resistor"]`,
    ),
  ).toBeVisible();

  await openCourse();
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  learner.page.once('dialog', (dialog) => void dialog.accept());
  await electronicsCard.getByRole('button', { name: 'Сдать', exact: true }).click();
  await expect(
    electronicsCard.getByRole('button', { name: 'Работа сдана', exact: true }),
  ).toBeDisabled();

  const afterElectronicsSubmit = await openCourse();
  const submittedElectronics = occurrenceFromCourseRun(afterElectronicsSubmit, electronicsTitle);
  const untouchedThreeD = occurrenceFromCourseRun(afterElectronicsSubmit, threeDTitle);
  expect(submittedElectronics.projectId).toBe(electronicsEvidence.projectId);
  expect(submittedElectronics.canonicalState?.workflowState).toBe('submitted');
  expect(untouchedThreeD.projectId).toBeNull();
  expect(untouchedThreeD.canonicalState?.workflowState).toBe('not_started');
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText('Сдано');
  await expect(threeDCard).toContainText('Не начато');
  await expect(threeDCard.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();

  await threeDCard.getByRole('button', { name: 'Начать', exact: true }).click();
  const threeDEvidence = await editCourseActivityProject(learner.page, 'three-d');
  expect(threeDEvidence.projectId).not.toBe('');
  expect(threeDEvidence.projectId).not.toBe(electronicsEvidence.projectId);

  const afterThreeDStart = await openCourse();
  const electronicsAfterThreeD = occurrenceFromCourseRun(afterThreeDStart, electronicsTitle);
  const startedThreeD = occurrenceFromCourseRun(afterThreeDStart, threeDTitle);
  expect(electronicsAfterThreeD.projectId).toBe(electronicsEvidence.projectId);
  expect(electronicsAfterThreeD.canonicalState?.workflowState).toBe('submitted');
  expect(startedThreeD.projectId).toBe(threeDEvidence.projectId);
  expect(startedThreeD.projectId).not.toBe(electronicsAfterThreeD.projectId);
  electronicsCard = player.locator('.lesson-activity-block').filter({ hasText: electronicsTitle });
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await expect(electronicsCard).toContainText('Сдано');
  await expect(
    electronicsCard.getByRole('button', { name: 'Работа сдана', exact: true }),
  ).toBeDisabled();
  await expect(
    threeDCard.getByRole('button', { name: 'Открыть работу', exact: true }),
  ).toBeVisible();

  await electronicsCard.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await expect(learner.page.getByRole('button', { name: 'Резистор', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(courseActivityProjectId(learner.page, 'electronics')).toBe(electronicsEvidence.projectId);
  await expect(
    learner.page.locator(
      `[data-testid="schematic-component"][data-component-id="${electronicsEvidence.addedComponentId}"][data-kind="resistor"]`,
    ),
  ).toBeVisible();

  await openCourse();
  threeDCard = player.locator('.lesson-activity-block').filter({ hasText: threeDTitle });
  await threeDCard.getByRole('button', { name: 'Открыть работу', exact: true }).click();
  await expect(learner.page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 60_000 });
  await expect(learner.page.getByTestId('asa3d-viewport')).toHaveAttribute(
    'data-runtime-ready',
    'true',
  );
  expect(courseActivityProjectId(learner.page, 'three-d')).toBe(threeDEvidence.projectId);
  await expect(learner.page.locator('.asa3d-object-count')).toContainText(
    new RegExp(`^${threeDEvidence.expectedObjectCount} `),
  );

  learnerFailures.assertEmpty();
  await learner.context.close();
});
