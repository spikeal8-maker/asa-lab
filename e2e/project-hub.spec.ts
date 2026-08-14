import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { collectBrowserFailures } from './browser-failures';

const EVIDENCE_DIR =
  process.env['ASA_OWNER_EVIDENCE_DIR'] ?? 'e2e/artifacts/project-hub/r3b-project-lifecycle';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}

test('project hub supports duplicate, archive, trash and restore journeys', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByTestId('entry-sign-up').click();
  await page.getByLabel('Email').fill(`project_${unique}@r3b-e2e.test`);
  await page.getByLabel('Имя пользователя').fill(`project_${unique}`.slice(0, 36));
  await page.getByLabel('Отображаемое имя (необязательно)').fill('Анна Проектова');
  await page.getByLabel('Дата рождения').fill('1993-04-18');
  await page.getByLabel('Пароль').fill(`Safe-${unique}-Password`);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/#\/home$/);

  const response = await page.context().request.post('/api/projects', {
    headers: { origin: new URL(page.url()).origin, 'idempotency-key': `hub-${unique}` },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'Умный светильник',
    },
  });
  expect(response.status()).toBe(201);

  await page.getByRole('button', { name: 'Мои проекты', exact: true }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  const original = page.locator('.project-hub-card').filter({
    has: page.getByRole('heading', { name: 'Умный светильник', exact: true }),
  });
  await expect(original).toBeVisible();
  await original.locator('summary').click();
  await original.getByRole('button', { name: 'Дублировать' }).click();
  await expect(page.getByText('Умный светильник — копия', { exact: true })).toBeVisible();

  await original.getByRole('button', { name: 'Архивировать' }).click();
  await expect(original).toHaveCount(0);
  await page.getByRole('tab', { name: 'Архив' }).click();
  const archived = page.locator('.project-hub-card').filter({
    has: page.getByRole('heading', { name: 'Умный светильник', exact: true }),
  });
  await expect(archived).toBeVisible();
  await archived.getByRole('button', { name: 'Восстановить' }).click();
  await expect(archived).toHaveCount(0);

  await page.getByRole('tab', { name: 'Проекты' }).click();
  const copy = page.locator('.project-hub-card').filter({
    has: page.getByRole('heading', { name: 'Умный светильник — копия', exact: true }),
  });
  await copy.locator('summary').click();
  await copy.getByRole('button', { name: 'В корзину' }).click();
  await expect(copy).toHaveCount(0);
  await page.getByRole('tab', { name: 'Корзина' }).click();
  await expect(page.getByText('Умный светильник — копия', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: 'Проекты' }).click();
  await expect(page.getByText('Умный светильник', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-project-hub-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-project-hub-mobile.png`, fullPage: true });

  failures.assertEmpty();
});
