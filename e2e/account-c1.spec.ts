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
import { e2eAdminPool, seedTeacher } from './seed';

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
  const newPassword = `Changed-${unique}-Password`;

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Идея есть? Сделай её.' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/01-public-entry-desktop.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('Owner Preview');
  await page.getByLabel('Дата рождения').fill('1990-04-12');
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  // A new account lands on the creator home, not on the projects list.
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

  const context = page.context();
  for (const [module, title] of [
    ['electronics', 'Account C1 Electronics'],
    ['three-d', 'Account C1 3D'],
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
  await expect(page.getByText('Account C1 3D')).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/02-project-hub-electronics-chess.png`,
    fullPage: true,
  });

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const secondFailures = collectBrowserFailures(secondPage, {
    allowAnonymousSessionProbe: true,
  });
  await secondPage.goto('/#/sign-in');
  await secondPage.getByLabel('Email или имя пользователя').fill(username);
  await secondPage.getByLabel('Пароль').fill(password);
  await secondPage.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
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

  // Profile save must not issue a capability. Teaching is a separate command.
  await page.getByLabel(/^Отображаемое имя/).fill('Owner C1 Ready');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(
    settingsContent.getByText(/Изменения сохранены|Роль педагога включена/),
  ).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/03-account-profile-desktop.png`,
    fullPage: true,
  });
  expect(
    (await (await context.request.get('/api/auth/me')).json()).capabilities.some(
      (grant: { capability: string }) => grant.capability === 'educator',
    ),
  ).toBe(false);
  await settingsPanel('Возможности').click();
  await page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Преподавание', exact: true }) })
    .getByRole('button', { name: 'Подключить', exact: true })
    .click();
  await settingsPanel('Мои доступы').click();
  await expect(settingsContent.getByText('Owner Preview School', { exact: true })).toBeVisible();
  await settingsPanel('Вход и безопасность').click();
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
  await settingsPanel('Вход и безопасность').click();
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
  await expect(page.getByText('Account C1 3D')).toBeVisible();

  await openAccountSettings(page);
  await settingsPanel('Вход и безопасность').click();
  const currentPasswordInput = settingsContent.getByLabel('Текущий пароль', { exact: true });
  const newPasswordInput = settingsContent.getByLabel('Новый пароль', { exact: true });
  const confirmPasswordInput = settingsContent.getByLabel('Повторите новый пароль', {
    exact: true,
  });
  await currentPasswordInput.fill(password);
  await newPasswordInput.fill(newPassword);
  await confirmPasswordInput.fill(newPassword);
  const passwordChangeResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/account/password';
  });
  await settingsContent.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
  expect((await passwordChangeResponsePromise).status()).toBe(200);
  await expect(
    settingsContent.getByText('Пароль изменён. Остальные входы завершены.'),
  ).toBeVisible();
  await expect(currentPasswordInput).toHaveValue('');
  await expect(newPasswordInput).toHaveValue('');
  await expect(confirmPasswordInput).toHaveValue('');
  const currentSessionAfterPasswordChange = await context.request.get('/api/auth/me');
  expect(currentSessionAfterPasswordChange.status()).toBe(200);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/07-password-changed-desktop.png`,
    fullPage: true,
  });

  await page.goto('/#/projects');
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 3D')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выход' }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true }).first()).toBeVisible();
  const anonymousAfterLogout = await context.request.get('/api/auth/me');
  expect(anonymousAfterLogout.status()).toBe(200);
  expect(await anonymousAfterLogout.json()).toEqual({ authenticated: false });

  // Keep the expected negative login response isolated from the main page's
  // unexpected-browser-failure collector; no error allowlist is added.
  const oldPasswordPage = await context.newPage();
  await oldPasswordPage.goto('/#/sign-in');
  await oldPasswordPage.getByLabel('Email или имя пользователя').fill(username);
  await oldPasswordPage.getByLabel('Пароль').fill(password);
  await oldPasswordPage.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const oldPasswordLoginResponsePromise = oldPasswordPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });
  await oldPasswordPage.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await oldPasswordLoginResponsePromise).status()).toBe(401);
  await expect(oldPasswordPage).toHaveURL(/#\/sign-in$/);
  await expect(oldPasswordPage.getByRole('heading', { name: 'Главная' })).not.toBeVisible();
  await oldPasswordPage.close();

  await page.goto('/#/sign-in');
  await page.getByLabel('Email или имя пользователя').fill(username);
  await page.getByLabel('Пароль').fill(newPassword);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const newPasswordLoginResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await newPasswordLoginResponsePromise).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
  const newPasswordSession = await context.request.get('/api/auth/me');
  expect(newPasswordSession.status()).toBe(200);
  await expect(page.getByText('Account C1 Electronics')).toBeVisible();
  await expect(page.getByText('Account C1 3D')).toBeVisible();
  failures.assertEmpty();
});

test('migrated teacher changes password through organization browser login', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const teacher = await seedTeacher(admin, 'as-03b-password');
  const passwordA = teacher.password;
  const passwordB = `Changed-${Date.now()}-${Math.floor(Math.random() * 1e6)}-Password`;

  const link = await admin.query(
    `SELECT account_id
       FROM legacy_user_account_links
      WHERE tenant_id = $1 AND user_id = $2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const accountId = link.rows[0]?.account_id as string;
  expect(accountId).toBeTruthy();

  const personalSlug = `personal-${accountId.replaceAll('-', '').slice(0, 32)}`;
  const personalTenant = await admin.query(
    `INSERT INTO tenants (workspace_slug, title)
     VALUES ($1, $2)
     RETURNING id`,
    [personalSlug, 'AS-03B Personal Workspace'],
  );
  const personalTenantId = personalTenant.rows[0].id as string;
  await admin.query(
    `INSERT INTO tenant_placements (tenant_id, mode)
     VALUES ($1, 'SHARED_CLUSTER')`,
    [personalTenantId],
  );
  const personalWorkspace = await admin.query(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, 'personal', $2)
     RETURNING id`,
    [personalTenantId, 'AS-03B Personal Workspace'],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'owner')`,
    [accountId, personalWorkspace.rows[0].id],
  );

  const personalContext = await admin.query(`SELECT * FROM auth_personal_workspace($1)`, [
    accountId,
  ]);
  expect(personalContext.rowCount).toBe(1);
  const membershipCounts = await admin.query(
    `SELECT
       count(*) FILTER (WHERE w.kind = 'personal')::int AS personal_count,
       count(*) FILTER (WHERE w.kind = 'organization')::int AS organization_count
     FROM workspace_memberships m
     JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = $1`,
    [accountId],
  );
  expect(membershipCounts.rows[0]).toEqual({
    personal_count: 1,
    organization_count: 1,
  });

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/#/organization-sign-in');
  await page.getByLabel('Код организации').fill(teacher.workspace);
  await page.getByLabel('Email', { exact: true }).fill(teacher.email);
  await page.getByLabel('Пароль', { exact: true }).fill(passwordA);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const initialOrganizationLogin = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });
  await page.getByRole('button', { name: 'Войти через организацию', exact: true }).click();
  expect((await initialOrganizationLogin).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();

  const context = page.context();
  const organizationSessionBeforeChange = await context.request.get('/api/auth/me');
  expect(organizationSessionBeforeChange.status()).toBe(200);
  expect(await organizationSessionBeforeChange.json()).toMatchObject({
    authenticated: true,
    activeWorkspace: { kind: 'organization' },
  });

  await openAccountSettings(page);
  const settingsPanel = (name: string) =>
    page.getByLabel('Разделы настроек').getByRole('button', { name, exact: true });
  await settingsPanel('Вход и безопасность').click();
  const settingsContent = page.locator('.account-settings-content');
  const currentPasswordInput = settingsContent.getByLabel('Текущий пароль', { exact: true });
  const newPasswordInput = settingsContent.getByLabel('Новый пароль', { exact: true });
  const confirmPasswordInput = settingsContent.getByLabel('Повторите новый пароль', {
    exact: true,
  });
  const savePasswordButton = settingsContent.getByRole('button', {
    name: 'Сохранить пароль',
    exact: true,
  });
  await expect(currentPasswordInput).toBeVisible();
  await expect(newPasswordInput).toBeVisible();
  await expect(confirmPasswordInput).toBeVisible();
  await expect(savePasswordButton).toBeVisible();
  await currentPasswordInput.fill(passwordA);
  await newPasswordInput.fill(passwordB);
  await confirmPasswordInput.fill(passwordB);
  const passwordChangeResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/account/password';
  });
  await savePasswordButton.click();
  expect((await passwordChangeResponse).status()).toBe(200);
  await expect(
    settingsContent.getByText('Пароль изменён. Остальные входы завершены.'),
  ).toBeVisible();

  const organizationSessionAfterChange = await context.request.get('/api/auth/me');
  expect(organizationSessionAfterChange.status()).toBe(200);
  expect(await organizationSessionAfterChange.json()).toMatchObject({
    authenticated: true,
    activeWorkspace: { kind: 'organization' },
  });

  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выход' }).click();
  const anonymousAfterOrganizationLogout = await context.request.get('/api/auth/me');
  expect(anonymousAfterOrganizationLogout.status()).toBe(200);
  expect(await anonymousAfterOrganizationLogout.json()).toEqual({ authenticated: false });

  const oldPasswordPage = await context.newPage();
  await oldPasswordPage.goto('/#/organization-sign-in');
  await oldPasswordPage.getByLabel('Код организации').fill(teacher.workspace);
  await oldPasswordPage.getByLabel('Email', { exact: true }).fill(teacher.email);
  await oldPasswordPage.getByLabel('Пароль', { exact: true }).fill(passwordA);
  await oldPasswordPage.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const oldOrganizationLogin = oldPasswordPage.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });
  await oldPasswordPage
    .getByRole('button', { name: 'Войти через организацию', exact: true })
    .click();
  expect((await oldOrganizationLogin).status()).toBe(401);
  await expect(oldPasswordPage.getByRole('heading', { name: 'Главная' })).not.toBeVisible();
  await oldPasswordPage.close();

  await page.goto('/#/organization-sign-in');
  await page.getByLabel('Код организации').fill(teacher.workspace);
  await page.getByLabel('Email', { exact: true }).fill(teacher.email);
  await page.getByLabel('Пароль', { exact: true }).fill(passwordB);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const newOrganizationLogin = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });
  await page.getByRole('button', { name: 'Войти через организацию', exact: true }).click();
  expect((await newOrganizationLogin).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
  const newOrganizationSession = await context.request.get('/api/auth/me');
  expect(newOrganizationSession.status()).toBe(200);
  expect(await newOrganizationSession.json()).toMatchObject({
    authenticated: true,
    activeWorkspace: { kind: 'organization' },
  });

  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выход' }).click();
  const anonymousBeforeNormalLogin = await context.request.get('/api/auth/me');
  expect(anonymousBeforeNormalLogin.status()).toBe(200);
  expect(await anonymousBeforeNormalLogin.json()).toEqual({ authenticated: false });

  await page.goto('/#/sign-in');
  await page.getByLabel('Email или имя пользователя').fill(teacher.email);
  await page.getByLabel('Пароль').fill(passwordB);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  const normalLogin = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname === '/api/auth/login';
  });
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await normalLogin).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Главная' })).toBeVisible();
  const normalSession = await context.request.get('/api/auth/me');
  expect(normalSession.status()).toBe(200);
  expect(await normalSession.json()).toMatchObject({
    authenticated: true,
    activeWorkspace: { kind: 'personal' },
  });

  failures.assertEmpty();
});
