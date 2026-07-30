import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

/** TST-E2E-PORTAL-001: real browser flow —
 * login → empty state → create classroom → card visible → reload → card
 * remains → logout. Saves desktop and mobile evidence screenshots. */

let admin: pg.Pool;
let teacher: SeededTeacher;

const organizationCodeField = 'Код организации';
const teacherEmailField = 'Email педагога';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .slice(0, 10),
  }));
  expect(metrics.document, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport);
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher logs in, creates a classroom and it survives reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();

  await page.getByLabel(organizationCodeField).fill(teacher.workspace);
  await page.getByLabel(teacherEmailField).fill(teacher.email);
  await page.getByLabel('Пароль').fill(teacher.password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await page.getByRole('button', { name: 'Классы' }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Создайте первый класс' })).toBeVisible();

  const createButton = page.getByRole('button', { name: 'Создать класс' }).first();
  await createButton.click();
  await expect(page.getByLabel('Название класса')).toBeFocused();
  await page.getByLabel('Название класса').fill('8А Робототехника');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать' }).click();

  const card = page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' });
  await expect(card).toBeVisible();
  await expect(page.getByText('Класс «8А Робототехника» создан.')).toBeVisible();
  await expect(createButton).toBeFocused();

  mkdirSync('e2e/artifacts', { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'e2e/artifacts/portal-desktop.png', fullPage: true });
  await page.screenshot({ path: 'e2e/artifacts/docker-desktop-1366.png', fullPage: true });

  await page.reload();
  await expect(
    page.getByTestId('classroom-card').filter({ hasText: '8А Робототехника' }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'e2e/artifacts/portal-mobile.png', fullPage: true });
  await page.screenshot({ path: 'e2e/artifacts/docker-mobile-390.png', fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: 'e2e/artifacts/docker-tablet-768.png', fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByLabel(organizationCodeField)).toBeVisible();
});
