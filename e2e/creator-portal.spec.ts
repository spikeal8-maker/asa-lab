import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const EVIDENCE_DIR =
  process.env['ASA_OWNER_EVIDENCE_DIR'] ?? 'e2e/artifacts/owner-preview/r2-creator-portal';
let admin: pg.Pool;
let teacher: SeededTeacher;

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

async function createProjectThroughApi(
  page: Page,
  input: { module: 'electronics' | 'chess'; title: string; key: string },
): Promise<string> {
  const response = await page.context().request.post('/api/projects', {
    headers: {
      origin: new URL(page.url()).origin,
      'idempotency-key': input.key,
    },
    data: {
      scope: 'personal',
      classroomId: null,
      module: input.module,
      title: input.title,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { project: { id: string } };
  return body.project.id;
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'r2-creator-portal');
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('creator uses Home, honest resources, routing and the integrated account shell', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const username = `creator_${unique}`.slice(0, 36);
  const email = `${username}@r2-e2e.test`;
  const password = `Safe-${unique}-Password`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByTestId('entry-sign-up').click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Отображаемое имя (необязательно)').fill('Алекс Автор');
  await page.getByLabel('Дата рождения').fill('1994-06-12');
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page).toHaveURL(/#\/home$/);
  await expect(
    page.getByRole('heading', { name: 'Проектируйте и обучайте в ASA Lab' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Электроника' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Классы', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Новый проект Электроника/ })).toBeVisible();

  const electronicsProjectId = await createProjectThroughApi(page, {
    module: 'electronics',
    title: 'Личная схема',
    key: `r2-electronics-${unique}`,
  });
  const chessProjectId = await createProjectThroughApi(page, {
    module: 'chess',
    title: 'Шахматный разбор',
    key: `r2-chess-${unique}`,
  });
  await page.reload();
  await expect(page.getByTestId('creator-recent-projects')).toContainText('Личная схема');
  await expect(page.getByTestId('creator-recent-projects')).toContainText('Шахматный разбор');
  await expect(page.getByRole('heading', { name: 'ASA Chess' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-creator-home-desktop.png`, fullPage: true });

  const electronicsProjectLink = page
    .getByTestId('creator-recent-projects')
    .getByRole('link', { name: /Личная схема/ });
  const electronicsHref = `/projects/${electronicsProjectId}/electronics/edit?returnTo=%23%2Fhome`;
  await expect(electronicsProjectLink).toHaveAttribute('href', electronicsHref);

  const electronicsTabPromise = page.context().waitForEvent('page');
  await electronicsProjectLink.click({ button: 'middle' });
  const electronicsTab = await electronicsTabPromise;
  await electronicsTab.waitForLoadState('domcontentloaded');
  await expect(electronicsTab).toHaveURL(new RegExp(`${electronicsHref}$`));
  await expect(electronicsTab.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await electronicsTab.close();
  await expect(page).toHaveURL(/#\/home$/);

  await electronicsProjectLink.click();
  await expect(page).toHaveURL(new RegExp(`${electronicsHref}$`));
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${electronicsHref}$`));
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Проектируйте и обучайте в ASA Lab' }),
  ).toBeVisible();

  await page
    .getByTestId('creator-recent-projects')
    .getByRole('link', { name: /Шахматный разбор/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`#\\/home\\/${chessProjectId}$`));
  await expect(page.getByTestId('asa-chess-board')).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Проектируйте и обучайте в ASA Lab' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Проекты', exact: true }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  await expect(page.getByText('Личная схема')).toBeVisible();
  await expect(page.getByText('Шахматный разбор')).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-projects-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: 'Обучение', exact: true }).click();
  await expect(page).toHaveURL(/#\/learning$/);
  await expect(page.getByRole('heading', { name: 'Обучение', exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-learning-desktop.png`, fullPage: true });

  await page.getByRole('button', { name: 'Коллекции', exact: true }).click();
  await expect(page.getByText('Сохранённых коллекций пока нет')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Обучение', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Коллекции', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  await expect(page.getByText('Назначенных испытаний сейчас нет')).toBeVisible();
  await page.getByRole('button', { name: 'Справочный центр', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Помощь', exact: true })).toBeVisible();

  await page.locator('.portal-account > summary').click();
  await expect(page.locator('.portal-account-menu')).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-account-menu-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Профиль и активные сессии' }).click();
  await expect(page.getByRole('heading', { name: 'Аккаунт и рабочие пространства' })).toBeVisible();
  await expect(page.getByText('Создание проектов')).toBeVisible();
  await expect(page.getByText('Account C1')).toHaveCount(0);
  await expect(page.getByText('creator', { exact: true })).toHaveCount(0);
  await expect(page.getByText('verified', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Проверить статус' }).click();
  await expect(
    page.getByText('Статус обновлён. Автоматическая отправка писем пока не подключена.'),
  ).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-account-shell-desktop.png`, fullPage: true });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/#/challenges');
  await expect(page.getByRole('heading', { name: 'Испытания', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/06-challenges-tablet.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/home');
  await expect(
    page.getByRole('heading', { name: 'Проектируйте и обучайте в ASA Lab' }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/07-creator-home-mobile.png`, fullPage: true });

  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});

test('educator navigation follows server capability and active workspace scope', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const username = `educator_${unique}`.slice(0, 36);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByTestId('entry-sign-up').click();
  await page.getByLabel('Email').fill(`${username}@r2-e2e.test`);
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Отображаемое имя (необязательно)').fill('Педагог R2');
  await page.getByLabel('Дата рождения').fill('1990-02-15');
  await page.getByLabel('Пароль').fill(`Safe-${unique}-Password`);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('button', { name: 'Классы', exact: true })).toHaveCount(0);

  const sessionResponse = await page.context().request.get('/api/auth/me');
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as {
    user: { id: string };
    capabilities: Array<{ capability: string; state: string }>;
    activeWorkspace: { workspaceId: string };
  };
  expect(session.capabilities.some((entry) => entry.capability === 'educator')).toBe(false);
  await createProjectThroughApi(page, {
    module: 'electronics',
    title: 'Только личное пространство',
    key: `r2-personal-isolation-${unique}`,
  });
  await page.reload();
  await expect(page.getByTestId('creator-recent-projects')).toContainText(
    'Только личное пространство',
  );

  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Профиль и активные сессии' }).click();
  await page.getByRole('button', { name: 'Подтвердить статус педагога' }).click();
  await expect(page.getByText('Режим педагога включён.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Классы', exact: true })).toHaveCount(0);

  const tenant = await admin.query(
    `INSERT INTO tenants (title, workspace_slug)
     VALUES ('R2 Creator School Tenant', $1)
     RETURNING id`,
    [`r2-school-${unique}`.slice(0, 60)],
  );
  const workspace = await admin.query(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, 'organization', 'R2 Creator School')
     RETURNING id`,
    [tenant.rows[0].id],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'educator')`,
    [session.user.id, workspace.rows[0].id],
  );

  await page.reload();
  const organizationRow = page
    .locator('.account-workspace-list li')
    .filter({ hasText: 'R2 Creator School' });
  await organizationRow.getByRole('button', { name: 'Переключить' }).click();
  await expect(page.getByRole('button', { name: 'Классы', exact: true })).toBeVisible();

  const refreshedSession = await page.context().request.get('/api/auth/me');
  expect(refreshedSession.status()).toBe(200);
  const refreshedPayload = (await refreshedSession.json()) as {
    capabilities: Array<{ capability: string }>;
    navigation: { classes: boolean; classroomManagement: boolean };
  };
  expect(refreshedPayload.capabilities.some((entry) => entry.capability === 'educator')).toBe(true);
  expect(refreshedPayload.navigation).toEqual({
    classes: true,
    classroomManagement: false,
  });

  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByText('Только личное пространство')).toHaveCount(0);
  await createProjectThroughApi(page, {
    module: 'chess',
    title: 'Только пространство школы',
    key: `r2-organization-isolation-${unique}`,
  });
  await page.reload();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByTestId('creator-recent-projects')).toContainText(
    'Только пространство школы',
  );
  await expect(page.getByText('Только личное пространство')).toHaveCount(0);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/08-workspace-isolation-desktop.png`,
    fullPage: true,
  });

  await page.locator('.portal-account > summary').click();
  await page.locator('.portal-account-workspaces button').filter({ hasText: 'Личное' }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByTestId('creator-recent-projects')).toContainText(
    'Только личное пространство',
  );
  await expect(page.getByText('Только пространство школы')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('creator-recent-projects')).toContainText(
    'Только личное пространство',
  );
  await expect(page.getByText('Только пространство школы')).toHaveCount(0);

  await page.locator('.portal-account > summary').click();
  await page
    .locator('.portal-account-workspaces button')
    .filter({ hasText: 'R2 Creator School' })
    .click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('button', { name: 'Классы', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Классы подключены' })).toBeVisible();

  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await loginWithOrganization(page, teacher);
  await expect(page.getByRole('button', { name: 'Классы', exact: true })).toBeVisible();
  const authorizedSession = await page.context().request.get('/api/auth/me');
  expect(authorizedSession.status()).toBe(200);
  expect(
    ((await authorizedSession.json()) as { navigation: { classes: boolean } }).navigation.classes,
  ).toBe(true);

  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/09-educator-classes-desktop.png`,
    fullPage: true,
  });

  failures.assertEmpty();
});
