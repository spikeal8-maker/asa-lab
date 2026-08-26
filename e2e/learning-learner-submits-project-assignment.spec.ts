import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/learning/vs-002';
const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let teacher: SeededTeacher;
let sequence = 0;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'learning-vs-002-browser');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

async function createPublishedProjectActivity(title: string): Promise<void> {
  const identity = await admin.query(
    `SELECT principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const principalId = identity.rows[0].principal_id as string;
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите рабочую электрическую цепь.','electronics','private')
     RETURNING id`,
    [teacher.tenantId, principalId, title],
  );
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [teacher.tenantId]);
    const created = await client.query(
      `SELECT * FROM learning_activity_create(
        $1,$2,'school','private','project',$3,'ignored','completion',NULL,
        $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        principalId,
        teacher.tenantId,
        title,
        JSON.stringify(policies),
        authored.rows[0].id,
        `vs002:e2e:create:${++sequence}`,
      ],
    );
    await client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      principalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      `vs002:e2e:publish:${++sequence}`,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createClassWithStudents(
  page: Page,
  className: string,
  students: ReadonlyArray<{ label: string; handle: string }>,
): Promise<string> {
  await loginWithOrganization(page, teacher);
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await page
    .getByRole('button', { name: /^Создать(?: новый)? класс$/ })
    .first()
    .click();
  const create = page.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill(className);
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: className })
    .locator('.classroom-row-title')
    .click();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  for (const student of students) {
    await page.getByRole('button', { name: 'Добавить ученика' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Имя в списке класса').fill(student.label);
    await dialog.getByLabel('Имя для входа').fill(student.handle);
    await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  return joinCode;
}

async function openAssignments(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Материалы класса' })
    .getByRole('button', { name: 'Отдельные задания', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Задания класса' })).toBeVisible();
}

async function assignFromUi(
  page: Page,
  input: { title: string; due: string; students?: string[] },
): Promise<string> {
  await page.getByRole('button', { name: 'Назначить задание', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Назначить задание' });
  await dialog.getByLabel('Задание').selectOption({ label: input.title });
  if (input.students) {
    await dialog.getByLabel('Выбранные ученики').check();
    for (const student of input.students) await dialog.getByLabel(student).check();
  }
  await dialog.getByLabel('Срок').fill(input.due);
  await dialog.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const assignment = await admin.query(
    `SELECT assignment.id
       FROM classroom_assignments assignment
       JOIN teacher_assignments authored ON authored.id=assignment.assignment_id
      WHERE assignment.tenant_id=$1 AND authored.title=$2
      ORDER BY assignment.created_at DESC LIMIT 1`,
    [teacher.tenantId, input.title],
  );
  return assignment.rows[0].id as string;
}

async function learnerAssignments(
  browser: Browser,
  joinCode: string,
  handle: string,
): Promise<{ context: import('@playwright/test').BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByLabel('Имя для входа').fill(handle);
  await page.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await page.getByRole('button', { name: 'Войти в класс' }).click();
  await page
    .getByLabel('Основная навигация')
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  return { context, page };
}

function assignmentRow(page: Page, title: string) {
  return page.getByTestId('seat-assignments').locator('li').filter({ hasText: title });
}

test('learner starts the real project editor and submits one immutable attempt', async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const teacherFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  const title = `Светодиод и резистор VS002 ${++sequence}`;
  const className = `7А — VS002 ${sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, className, [
    { label: 'Анна', handle: `anna-vs002-${sequence}` },
    { label: 'Борис', handle: `boris-vs002-${sequence}` },
  ]);
  await openAssignments(page);
  await assignFromUi(page, { title, due: '2027-05-30' });

  const learner = await learnerAssignments(browser, joinCode, `anna-vs002-${sequence}`);
  const learnerFailures = collectBrowserFailures(learner.page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  let row = assignmentRow(learner.page, title);
  await expect(row).toContainText('Не начато');
  await row.screenshot({ path: `${evidenceDir}/learner-not-started.png` });

  await row.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(learner.page.getByTestId('assignment-brief')).toBeVisible();
  await expect(learner.page.locator('.workbench-shell')).toBeVisible({ timeout: 60_000 });
  await learner.page.screenshot({ path: `${evidenceDir}/real-project-editor.png` });
  await expect(learner.page.getByTestId('assignment-brief')).toBeVisible();
  await learner.page.getByRole('button', { name: 'ASA Lab' }).click();

  row = assignmentRow(learner.page, title);
  await expect(row).toContainText('В работе');
  await expect(row.getByRole('button', { name: 'Открыть работу' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Сдать', exact: true })).toBeVisible();
  await row.screenshot({ path: `${evidenceDir}/learner-in-progress.png` });

  await row.getByRole('button', { name: 'Сдать', exact: true }).click();
  await expect(row).toContainText('Сдано');
  await expect(row.getByRole('button', { name: 'Работа сдана' })).toBeDisabled();
  await row.screenshot({ path: `${evidenceDir}/learner-submitted.png` });

  await learner.page.reload();
  await learner.page
    .getByLabel('Основная навигация')
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
  await expect(assignmentRow(learner.page, title)).toContainText('Сдано');

  await page.reload();
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: className })
    .locator('.classroom-row-title')
    .click();
  await openAssignments(page);
  const teacherRow = page.getByTestId('assignment-list').locator('li').filter({ hasText: title });
  await expect(teacherRow).toContainText('Назначено: 2 · Работают: 1 · Сдали: 1');
  await teacherRow.screenshot({ path: `${evidenceDir}/teacher-submitted.png` });

  teacherFailures.assertEmpty();
  learnerFailures.assertEmpty();
  await learner.context.close();
});

test('named audience excludes the third learner from read, start and submit', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const title = `Точная цепь VS002 ${++sequence}`;
  await createPublishedProjectActivity(title);
  const joinCode = await createClassWithStudents(page, `8Б — VS002 ${sequence}`, [
    { label: 'Галя', handle: `galya-vs002-${sequence}` },
    { label: 'Дима', handle: `dima-vs002-${sequence}` },
    { label: 'Егор', handle: `egor-vs002-${sequence}` },
  ]);
  await openAssignments(page);
  const assignmentId = await assignFromUi(page, {
    title,
    due: '2027-05-30',
    students: ['Галя', 'Дима'],
  });

  const excluded = await learnerAssignments(browser, joinCode, `egor-vs002-${sequence}`);
  await expect(excluded.page.getByText(title, { exact: true })).toHaveCount(0);
  const foreignProject = '123e4567-e89b-42d3-a456-426614174099';
  const statuses = await excluded.page.evaluate(
    async ({ assignmentId, foreignProject, sequence }) => {
      const post = (suffix: string, body: unknown) =>
        fetch(`/api/class-join/me/assignments/${assignmentId}/${suffix}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const start = await post('work', { projectId: foreignProject });
      const submit = await post('submit', {
        submitted: true,
        clientRequestId: `vs002:excluded:${sequence}`,
      });
      return { start: start.status, submit: submit.status };
    },
    { assignmentId, foreignProject, sequence },
  );
  expect(statuses).toEqual({ start: 404, submit: 404 });
  await excluded.page.screenshot({ path: `${evidenceDir}/learner-excluded.png`, fullPage: true });
  await excluded.context.close();
});
