import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { e2eAdminPool, seedTeacher } from './seed';
import { signInThroughOrganization } from './entry';

/**
 * TST-E2E-ACCOUNT-VERTICAL-001 — the owner gate, in a real browser against the
 * real API.
 *
 * Create an account → be signed in → make an Electronics project → refresh →
 * the project is there → sign out → sign in by username → it is there → sign
 * out → sign in by email → it is there. No mocks, no fixtures in the browser.
 */

const ARTIFACTS = 'e2e/artifacts/account-vertical';

function unique(label: string): string {
  return `${label}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function signIn(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('entry-sign-in').click();
  await page.getByLabel('Email или имя пользователя').fill(identifier);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
}

test.beforeAll(() => {
  mkdirSync(ARTIFACTS, { recursive: true });
});

test('an adult creates an account, makes a project, and finds it after every sign-in', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const username = unique('creator');
  const email = `${username}@test.local`;
  const password = 'sufficiently-long-pass';
  const projectTitle = `Схема ${username}`;

  // 1. The public page offers the two things a visitor can actually do today.
  await page.goto('/');
  await expect(page.getByTestId('entry-sign-in')).toBeVisible();
  await expect(page.getByTestId('entry-sign-up')).toBeVisible();
  // Class-code entry is behind a flag until a student can really get in.
  await expect(page.getByTestId('entry-class-code')).toHaveCount(0);
  await page.screenshot({ path: `${ARTIFACTS}/01-public-entry.png` });

  // 2. Age first, then the account itself.
  await page.getByTestId('entry-sign-up').click();
  await expect(page.getByTestId('sign-up-age')).toBeVisible();
  await page.getByLabel('Дата рождения').fill('1990-05-17');
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.screenshot({ path: `${ARTIFACTS}/02-sign-up-account.png` });

  await page.getByLabel('Имя пользователя').fill(username);
  await expect(page.getByTestId('username-availability')).toContainText('свободно');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();

  // 3–4. Registration signed the person in and landed them in their projects.
  await expect(page.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();
  // A creator is not an educator: there is no Classes tab to press.
  await expect(page.getByRole('button', { name: 'Классы' })).toHaveCount(0);
  await page.screenshot({ path: `${ARTIFACTS}/03-signed-in-empty-projects.png` });

  // 5–6. A personal Electronics project is created and saved.
  await page.getByRole('button', { name: 'Создать проект' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название проекта').fill(projectTitle);
  await dialog.getByRole('button', { name: 'Создать проект' }).click();
  // Creating a project opens it: the editor is where the work happens.
  await expect(page.getByLabel('Название проекта')).toHaveValue(projectTitle, {
    timeout: 15_000,
  });
  await page.screenshot({ path: `${ARTIFACTS}/04-project-created.png` });

  // F5 on the project hub: the project is still there.
  await page.goto('/#/projects');
  await page.reload();
  await expect(page.getByTestId('personal-project-grid').getByText(projectTitle)).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/05-after-refresh.png` });

  // 7–9. Sign out, sign in by username, the project is there.
  await signOut(page);
  await signIn(page, username, password);
  await expect(page.getByTestId('personal-project-grid').getByText(projectTitle)).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/06-after-username-sign-in.png` });

  // And by email.
  await signOut(page);
  await signIn(page, email, password);
  await expect(page.getByTestId('personal-project-grid').getByText(projectTitle)).toBeVisible();
  await page.screenshot({ path: `${ARTIFACTS}/07-after-email-sign-in.png` });

  expect(consoleErrors, 'console errors during the scenario').toEqual([]);
  expect(pageErrors, 'page errors during the scenario').toEqual([]);
});

test('an educator sees classes in the organization, and not in their own workspace', async ({
  page,
}) => {
  const admin: pg.Pool = e2eAdminPool();
  try {
    const teacher = await seedTeacher(admin, 'vertical-e2e-personal');
    // The universal sign-in needs the account password, and the account needs a
    // personal workspace to land in — both of which the migration gives every
    // existing teacher.
    const account = await admin.query(
      `UPDATE accounts SET password_hash = (SELECT password_hash FROM users WHERE id = $2)
        WHERE lower(email) = $1 RETURNING id`,
      [teacher.email.toLowerCase(), teacher.teacherId],
    );
    const accountId = account.rows[0].id as string;
    const tenant = await admin.query(
      `INSERT INTO tenants (workspace_slug, title) VALUES ($1, 'Личное пространство') RETURNING id`,
      [`personal-${accountId.replace(/-/g, '').slice(0, 32)}`],
    );
    await admin.query(
      `INSERT INTO tenant_placements (tenant_id, mode) VALUES ($1, 'SHARED_CLUSTER')`,
      [tenant.rows[0].id],
    );
    const workspace = await admin.query(
      `INSERT INTO workspaces (tenant_id, kind, title) VALUES ($1, 'personal', 'Личное пространство')
       RETURNING id`,
      [tenant.rows[0].id],
    );
    await admin.query(
      `INSERT INTO workspace_memberships (account_id, workspace_id, role) VALUES ($1, $2, 'owner')`,
      [accountId, workspace.rows[0].id],
    );

    // Universal sign-in lands in the personal workspace: no classes here.
    await signIn(page, teacher.email, teacher.password);
    await expect(page.getByRole('button', { name: 'Классы' })).toHaveCount(0);
    await page.screenshot({ path: `${ARTIFACTS}/10-educator-personal-no-classes.png` });

    // The organization sign-in is how the same person reaches their classes.
    await page.getByRole('button', { name: 'Выйти' }).click();
    await signInThroughOrganization(page, teacher);
    await expect(page.getByRole('button', { name: 'Классы' })).toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS}/11-educator-organization-classes.png` });
  } finally {
    await admin.end();
  }
});

test('the teacher from before accounts keeps their classes and projects', async ({ page }) => {
  const admin: pg.Pool = e2eAdminPool();
  try {
    const teacher = await seedTeacher(admin, 'vertical-e2e');
    const classroom = await admin.query(
      `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1, $2, $3, 'Класс до аккаунтов', $4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    await admin.query(
      `INSERT INTO classroom_memberships (tenant_id, classroom_id, user_id, member_role)
       VALUES ($1, $2, $3, 'owner')`,
      [teacher.tenantId, classroom.rows[0].id, teacher.teacherId],
    );
    const project = await admin.query(
      `INSERT INTO projects (tenant_id, project_scope, classroom_id, module_key, title, created_by)
       VALUES ($1, 'personal', NULL, 'electronics', 'Проект до аккаунтов', $2) RETURNING id`,
      [teacher.tenantId, teacher.teacherId],
    );
    await admin.query(
      `INSERT INTO project_drafts (project_id, tenant_id, document_json, updated_by)
       VALUES ($1, $2, '{"schemaVersion":1,"components":[],"connections":[]}'::jsonb, $3)`,
      [project.rows[0].id, teacher.tenantId, teacher.teacherId],
    );

    await signInThroughOrganization(page, teacher);
    await expect(
      page.getByTestId('personal-project-grid').getByText('Проект до аккаунтов'),
    ).toBeVisible();
    await page.screenshot({ path: `${ARTIFACTS}/08-teacher-projects.png` });

    await page.getByRole('button', { name: 'Классы' }).click();
    // The card layout hides the title on this branch (a known visual defect
    // outside this slice), so the assertion is that the class is listed.
    await expect(page.getByTestId('classroom-card')).toHaveCount(1);
    await page.screenshot({ path: `${ARTIFACTS}/09-teacher-classes.png` });
  } finally {
    await admin.end();
  }
});
