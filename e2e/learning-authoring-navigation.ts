import { expect, type Page } from '@playwright/test';

async function openAssignmentList(page: Page): Promise<void> {
  await page.goto('/#/challenges');

  const tabs = page.getByRole('navigation', { name: 'Разделы курсов и заданий' });
  const assignmentsTab = tabs.getByRole('button', { name: 'Задания', exact: true });
  if (
    (await assignmentsTab.count()) > 0 &&
    (await assignmentsTab.getAttribute('aria-current')) !== 'page'
  ) {
    await assignmentsTab.click();
  }

  const back = page.getByRole('button', { name: '← Задания', exact: true });
  if (await back.isVisible().catch(() => false)) {
    await back.click();
  }

  await expect(page.locator('.authored-assignment-list')).toBeVisible();
}

export async function openNewAssignmentEditor(page: Page): Promise<void> {
  await openAssignmentList(page);
  const button = page.getByRole('button', { name: /Новое задание/ });
  await expect(button).toBeVisible();
  await button.click();
  // Existing browser journeys create a project practice. The product itself
  // starts without a medium; these tests choose one explicitly.
  await openAssignmentSettings(page);
  await page
    .getByRole('dialog', { name: 'Настройки' })
    .getByLabel('Среда проекта')
    .selectOption('electronics');
  await closeAssignmentSettings(page);
}

export async function openExistingAssignmentEditor(page: Page, title: string): Promise<void> {
  await openAssignmentList(page);
  const button = page.getByRole('button', {
    name: `Открыть задание «${title}»`,
    exact: true,
  });
  await expect(button).toBeVisible();
  await button.click();
}

export async function addAssignmentBlock(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: '+ Добавить содержимое', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Добавить содержимое' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

export async function previewAssignmentAs(
  page: Page,
  source: 'draft' | 'published',
): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
    await expect(drawer).toBeVisible();
  }
  await drawer
    .getByRole('button', {
      name: source === 'draft' ? 'Черновик' : 'Опубликованная версия',
      exact: true,
    })
    .click();
}

export async function closeAssignmentPreview(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Как увидит ученик' });
  if (await drawer.isVisible().catch(() => false)) {
    await drawer.getByRole('button', { name: 'Закрыть предпросмотр', exact: true }).click();
  }
}

export async function openAssignmentSettings(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Настройки' });
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Настройки', exact: true }).first().click();
    await expect(drawer).toBeVisible();
  }
}

export async function closeAssignmentSettings(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: 'Настройки' });
  if (await drawer.isVisible().catch(() => false)) {
    await drawer.getByRole('button', { name: 'Закрыть настройки', exact: true }).click();
  }
}

export async function addCourseBlock(page: Page, label: string): Promise<void> {
  const editor = page.getByTestId('course-editor');
  await editor.getByRole('button', { name: '+ Добавить содержимое', exact: true }).click();
  await editor
    .getByRole('menu', { name: 'Добавить содержимое урока' })
    .getByRole('menuitem', { name: '+ ' + label, exact: true })
    .click();
}

export async function selectCoursePractice(page: Page, title: string, index = 0): Promise<void> {
  const picker = page.getByTestId('course-editor').locator('.course-practice-picker').nth(index);
  await picker.getByRole('button', { name: /Выбрать практику|Заменить практику/ }).click();
  await picker.getByLabel('Найти практику', { exact: true }).fill(title);
  await picker.getByRole('button', { name: `Добавить практику «${title}»`, exact: true }).click();
  await expect(picker.locator('.course-pinned-practice')).toContainText(title);
}

export async function openCourseActions(page: Page): Promise<void> {
  const editor = page.getByTestId('course-editor');
  const preview = editor.getByRole('dialog', { name: 'Как увидит ученик', exact: true });
  if (await preview.isVisible())
    await preview.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const trigger = editor.getByRole('button', { name: 'Действия курса', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}

export async function openCourseHistory(page: Page): Promise<void> {
  const history = page.getByTestId('course-editor').getByTestId('author-version-history');
  if (await history.isVisible()) return;
  await openCourseActions(page);
  await page
    .getByTestId('course-editor')
    .getByRole('button', { name: 'История версий', exact: true })
    .click();
  await expect(history).toBeVisible();
}

export async function openCourseLessonSettings(page: Page): Promise<void> {
  await page
    .getByTestId('course-editor')
    .getByRole('button', { name: 'Параметры урока', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Параметры урока', exact: true })).toBeVisible();
}

export async function closeCourseLessonSettings(page: Page): Promise<void> {
  const settings = page.getByRole('dialog', { name: 'Параметры урока', exact: true });
  await settings.getByRole('button', { name: 'Вернуться к уроку', exact: true }).click();
  await expect(settings).not.toBeVisible();
}

export async function openCourseStructure(page: Page): Promise<void> {
  const editor = page.getByTestId('course-editor');
  if (await editor.locator('.course-outline').isVisible()) return;
  const trigger = editor.getByRole('button', { name: 'Структура курса', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await expect(editor.locator('.course-outline')).toBeVisible();
}

export async function openCourseBlockActions(page: Page, index: number): Promise<void> {
  const block = page.getByTestId('course-editor').locator('.lesson-block-card').nth(index);
  const trigger = block.getByRole('button', { name: `Действия блока ${index + 1}`, exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
}
