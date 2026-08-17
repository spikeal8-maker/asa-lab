import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import {
  openAccountMenu,
  openAccountSettings,
  PERSONAL_WORKSPACE,
  portalSection,
  switchWorkspace,
} from './portal-navigation';
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
  // A new account lands on the creator home, not on the projects list.
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

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
  await expect(secondPage.getByRole('heading', { name: 'Главная' })).toBeVisible();
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

  // The school above was linked straight in the database, so the page still
  // holds the profile it loaded before that.
  await page.reload();
  // The account shell is reached through "Настройки" now, and its heading is
  // written for a person rather than for the architecture.
  await openAccountSettings(page);
  await expect(page.getByRole('heading', { name: 'Ваш аккаунт' })).toBeVisible();
  // The shell is tabbed now: schools and sessions live on their own panels
  // rather than all on one page. The panel names repeat as headings inside the
  // panels, so the clicks go through the settings navigation.
  const settingsPanel = (name: string) =>
    page.getByLabel('Разделы настроек').getByRole('button', { name, exact: true });

  // Scoped to the panel: the school name also sits in the header's account
  // menu, which is a closed disclosure, and an unscoped match finds that copy
  // first and reports it as hidden.
  const settingsContent = page.locator('.account-settings-content');

  // Name and educator role are one form now, saved together; a membership row
  // alone does not make an account an educator, and the school panel lists
  // nothing until the role is on.
  await page.getByLabel('Отображаемое имя').fill('Owner C1 Ready');
  await page.getByLabel(/Кто вы в ASA Lab/).selectOption('educator');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(
    settingsContent.getByText(/Изменения сохранены|Роль педагога включена/),
  ).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/03-account-profile-desktop.png`,
    fullPage: true,
  });

  await settingsPanel('Школа и классы').click();
  await expect(settingsContent.getByText('Owner Preview School')).toBeVisible();
  await settingsPanel('Учётная запись').click();
  // The session summary carries the platform of whatever machine runs the
  // browser, so pinning it to Linux made the spec pass only on CI.
  await expect(settingsContent.getByText(/Chrome · \S+/)).toBeVisible();
  await settingsPanel('Профиль').click();

  // Switching workspace is done from the account menu now, not from a card on
  // the account page.
  await switchWorkspace(page, 'Owner Preview School');
  await expect(portalSection(page, 'Классы')).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/04-workspace-switched-desktop.png`,
    fullPage: true,
  });

  await switchWorkspace(page, PERSONAL_WORKSPACE);
  await expect(page).toHaveURL(/#\/home$/);

  // Closed before the session behind it is ended: once revoked, that page's own
  // polling answers 401 by design, and leaving it open reports the expected
  // consequence as an unexpected browser failure.
  await secondPage.close();

  await openAccountSettings(page);
  await settingsPanel('Учётная запись').click();
  await settingsContent.getByRole('button', { name: 'Завершить', exact: true }).first().click();
  await expect(settingsContent.getByText('Выбранный вход завершён.')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Ваш аккаунт' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/06-account-profile-mobile.png`,
    fullPage: true,
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/projects');
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 Chess')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выход' }).click();
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
  await page.getByTestId('entry-sign-in').click();
  await page.getByLabel('Email или имя пользователя').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 Chess')).toBeVisible();
  failures.assertEmpty();
});
