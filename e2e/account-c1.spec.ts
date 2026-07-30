import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { e2eAdminPool } from './seed';

const EVIDENCE_DIR = 'e2e/artifacts/owner-preview/account-c1';
let admin: pg.Pool;

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

test.beforeAll(() => {
  admin = e2eAdminPool();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('owner completes Account C1 and existing project modules remain available', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const username = `owner_${unique}`.slice(0, 36);
  const email = `${username}@account-e2e.test`;
  const password = `Safe-${unique}-Password`;

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'ASA Lab' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/01-public-entry-desktop.png`,
    fullPage: true,
  });

  await page.getByTestId('entry-sign-up').click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Отображаемое имя (необязательно)').fill('Owner Preview');
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();

  const context = page.context();
  for (const [module, title] of [
    ['electronics', 'Account C1 Electronics'],
    ['chess', 'Account C1 Chess'],
  ] as const) {
    const response = await context.request.post('/api/projects', {
      headers: {
        origin: new URL(page.url()).origin,
        'idempotency-key': `account-c1-${module}-${unique}`,
      },
      data: {
        scope: 'personal',
        classroomId: null,
        module,
        title,
      },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 Chess')).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/02-project-hub-electronics-chess.png`,
    fullPage: true,
  });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const secondFailures = collectBrowserFailures(secondPage, {
    allowAnonymousSessionProbe: true,
  });
  await secondPage.goto(page.url());
  await secondPage.getByTestId('entry-sign-in').click();
  await secondPage.getByLabel('Email или имя пользователя').fill(username);
  await secondPage.getByLabel('Пароль').fill(password);
  await secondPage.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(secondPage.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  secondFailures.assertEmpty();

  const meResponse = await context.request.get('/api/auth/me');
  expect(meResponse.status()).toBe(200);
  const accountId = (await meResponse.json()).user.id as string;
  const tenantResult = await admin.query(
    `INSERT INTO tenants (title, workspace_slug)
     VALUES ('Owner Preview Organization', $1) RETURNING id`,
    [`owner-preview-${unique}`.slice(0, 60)],
  );
  const organizationResult = await admin.query(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, 'organization', 'Owner Preview School') RETURNING id`,
    [tenantResult.rows[0].id],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'educator')`,
    [accountId, organizationResult.rows[0].id],
  );

  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Профиль и активные сессии' }).click();
  await expect(page.getByRole('heading', { name: 'Аккаунт и рабочие пространства' })).toBeVisible();
  await expect(page.getByText('Owner Preview School')).toBeVisible();
  await expect(page.getByText('Chrome · Linux')).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/03-account-profile-desktop.png`,
    fullPage: true,
  });

  await page.getByLabel('Отображаемое имя').fill('Owner C1 Ready');
  await page.getByRole('button', { name: 'Сохранить профиль' }).click();
  await expect(page.getByText('Профиль сохранён.')).toBeVisible();

  await page.getByRole('button', { name: 'Подтвердить статус педагога' }).click();
  await expect(page.getByText(/Режим педагога включён/)).toBeVisible();

  const workspaceCard = page
    .getByRole('heading', { name: 'Рабочие пространства' })
    .locator('..')
    .locator('..')
    .locator('..');
  await workspaceCard.getByRole('button', { name: 'Переключить' }).click();
  await expect(page.getByText('Активно: Owner Preview School.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Классы' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/04-workspace-switched-desktop.png`,
    fullPage: true,
  });

  await workspaceCard.getByRole('button', { name: 'Переключить' }).click();
  await expect(page.getByText('Активно: Owner Preview.')).toBeVisible();

  const sessionCard = page
    .getByRole('heading', { name: 'Активные сессии' })
    .locator('..')
    .locator('..')
    .locator('..');
  await sessionCard.getByRole('button', { name: 'Завершить', exact: true }).click();
  await expect(page.getByText('Выбранная сессия завершена.')).toBeVisible();
  await expect(page.getByText('Chrome · Linux')).toHaveCount(0);
  const revokedSession = await secondContext.request.get('/api/auth/me');
  expect(revokedSession.status()).toBe(401);
  await secondContext.close();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/05-session-management-desktop.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('heading', { name: 'Аккаунт и рабочие пространства' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/06-account-profile-mobile.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/projects');
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 Chess')).toBeVisible();
  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
  await page.getByTestId('entry-sign-in').click();
  await page.getByLabel('Email или имя пользователя').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 Chess')).toBeVisible();
  failures.assertEmpty();
});
