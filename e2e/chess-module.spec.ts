import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function login(page: Page): Promise<void> {
  await loginWithOrganization(page, teacher);
}

async function createChessProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Что вы хотите создать?' })).toBeVisible();
  await page.getByLabel('Название проекта').fill(title);
  const chessTile = page.locator('.module-tile').filter({ hasText: 'ASA Chess' });
  await expect(chessTile).toContainText('Поддерживает безопасный режим');
  await chessTile.click();
  await expect(chessTile.getByRole('radio')).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  await expect(page.getByLabel('Название проекта')).toHaveValue(title);
}

async function clickMove(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-chess');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher creates, plays, reloads and versions an ASA Chess project', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await createChessProject(page, 'Испанская партия — анализ');

  await clickMove(page, 'e2', 'e4');
  await clickMove(page, 'e7', 'e5');
  await clickMove(page, 'g1', 'f3');
  await clickMove(page, 'b8', 'c6');
  await expect(page.getByLabel('Ходы партии')).toContainText('Nf3');
  await expect(page.getByLabel('Ходы партии')).toContainText('Nc6');

  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  await expect(page.getByLabel('Ходы партии')).toContainText('Nf3');
  await expect(page.locator('[data-square="e4"]')).toHaveAttribute('data-piece', 'white-pawn');
  await expect(page.locator('[data-square="c6"]')).toHaveAttribute('data-piece', 'black-knight');

  await page.getByRole('button', { name: 'Версия', exact: true }).click();
  await expect(page.getByText(/Создана неизменяемая версия №1/)).toBeVisible();
  await page.getByRole('tab', { name: 'Версии' }).click();
  await expect(page.getByText('Версия №1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'PGN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PGN партии' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'PGN' })).toHaveValue(/1\. e4 e5 2\. Nf3 Nc6 \*/);
  await page.getByRole('button', { name: 'Закрыть' }).click();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/chess-analysis-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  await page.screenshot({ path: 'e2e/artifacts/chess-analysis-mobile.png', fullPage: true });
  failures.assertEmpty();
});

test('ASA Bot makes a legal persisted reply', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await createChessProject(page, 'Партия против ASA Bot');
  await page.getByRole('button', { name: 'Новая', exact: true }).click();
  await page.getByText('Против ASA Bot', { exact: true }).click();
  await page.getByRole('button', { name: 'Начать партию' }).click();
  await clickMove(page, 'e2', 'e4');
  await expect(page.getByText(/ASA Bot:/)).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => page.locator('.asa-chess-moves li').count()).toBeGreaterThan(0);
  await expect(page.locator('.asa-chess-moves li').first()).not.toHaveText(/^1\.\s*e4\s*$/);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.asa-chess-moves li').first()).toContainText('e4');
  failures.assertEmpty();
});

test('review selects exact plies and accepts only the verified retry move', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await createChessProject(page, 'Разбор ошибки и повторение');

  await clickMove(page, 'e2', 'e4');
  await clickMove(page, 'c7', 'c6');
  await clickMove(page, 'f1', 'b5');
  await clickMove(page, 'e7', 'e5');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Открыть разбор шахматной партии' }).click();
  await expect(page.getByRole('heading', { name: 'Разбор ошибки и повторение' })).toBeVisible();
  await expect(page.getByLabel('График оценки по полуходам')).toBeVisible();
  await expect(page.getByLabel('Проверенные факты разбора')).toContainText(
    'немедленно забирал слона',
  );
  await expect(page.locator('[data-review-timeline-point]')).toHaveCount(4);
  await page.locator('[data-review-timeline-point="3"]').click();
  await expect(page.locator('[data-square="b5"]')).toHaveAttribute('data-piece', 'white-bishop');

  await page.getByRole('button', { name: 'Повторить момент' }).click();
  await expect(page.getByLabel('Повторение момента')).toBeVisible();
  await clickMove(page, 'e7', 'e5');
  await expect(
    page.getByText('Ход легален, но это не лучший ответ из разбора. Попробуйте ещё раз.'),
  ).toBeVisible();
  await expect(page.getByLabel('Повторение момента').locator('dl dd')).toHaveText(['1', '1', '0']);

  await page.getByRole('button', { name: 'Подсказка 1/3' }).click();
  await expect(page.getByText('Найдите возможность для фигуры на поле c6.')).toBeVisible();
  await clickMove(page, 'c6', 'b5');
  await expect(page.getByText('Момент пройден', { exact: true })).toBeVisible();
  await expect(page.getByText('Верно. Вы нашли лучший ход из разбора.')).toBeVisible();
  failures.assertEmpty();
});

test('learner opens the original ASA puzzle trainer and solves a mate in one', async ({ page }) => {
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await login(page);
  await createChessProject(page, 'Тренировка по тактике');
  await page.getByRole('button', { name: 'Открыть шахматные задачи' }).click();
  await expect(page.getByRole('heading', { name: 'Мат в один ход' })).toBeVisible();
  await clickMove(page, 'f7', 'g7');
  await expect(page.getByText('Решено', { exact: true })).toBeVisible();
  await expect(page.getByText(/Ферзь встаёт на g7/)).toBeVisible();
  await page.getByRole('button', { name: 'Следующая задача' }).click();
  await expect(page.getByRole('heading', { name: 'Мат по последней горизонтали' })).toBeVisible();
  mkdirSync('e2e/artifacts', { recursive: true });
  await page.screenshot({ path: 'e2e/artifacts/chess-puzzle-desktop.png', fullPage: true });
  failures.assertEmpty();
});
