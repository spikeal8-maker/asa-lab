import { expect, type Page } from '@playwright/test';

/** Seed an isolated saved game, then enter it through the user-facing Games page. */
export async function openChessGame(page: Page, title: string): Promise<void> {
  const response = await page.context().request.post('/api/projects', {
    headers: {
      origin: new URL(page.url()).origin,
      'idempotency-key': `chess-fixture-${crypto.randomUUID()}`,
    },
    data: { scope: 'personal', module: 'chess', title },
  });
  expect(response.status()).toBe(201);
  await page.goto('/#/games');
  await expect(page.getByRole('heading', { name: 'Игры', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
}
