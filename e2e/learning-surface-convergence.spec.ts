import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import type pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/learning/m0-007';
let admin: pg.Pool;
let teacher: SeededTeacher;

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'learning-m0-007-browser');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

async function openLearnerLearning(page: import('@playwright/test').Page): Promise<void> {
  await page
    .getByLabel('Основная навигация')
    .getByRole('button', { name: 'Обучение', exact: true })
    .click();
}

test('legacy, revision and selected-result semantics stay equal across learner and teacher surfaces', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const teacherFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const create = page.getByRole('dialog', { name: 'Создать класс' });
  await create.getByLabel('Название класса').fill('Canonical M0-007');
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: 'Canonical M0-007' })
    .locator('.classroom-row-title')
    .click();
  const classroomHash = new URL(page.url()).hash;
  const classroomId = classroomHash.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
  expect(classroomId).toBeTruthy();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  await page.getByRole('button', { name: 'Добавить ученика' }).click();
  const seatDialog = page.getByRole('dialog');
  await seatDialog.getByLabel('Имя в списке класса').fill('Алина Canonical');
  await seatDialog.getByLabel('Имя для входа').fill('alina-canonical');
  await seatDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText('Алина Canonical добавлен.')).toBeVisible();

  const scope = await admin.query(
    `SELECT classroom.id AS classroom_id,classroom.tenant_id AS classroom_tenant_id,
            classroom.school_id AS classroom_school_id,
            classroom.created_by AS classroom_created_by,
            seat.id AS seat_id
       FROM classrooms classroom
       JOIN classroom_student_seats seat ON seat.classroom_id=classroom.id
      WHERE classroom.id=$1
        AND seat.display_label='Алина Canonical'
      LIMIT 1`,
    [classroomId],
  );
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const row = scope.rows[0] as {
    classroom_id: string;
    classroom_tenant_id: string;
    classroom_school_id: string;
    classroom_created_by: string;
    seat_id: string;
    account_id: string;
    principal_id: string;
    assignment_id: string;
  };
  row.account_id = identity.rows[0].account_id as string;
  row.principal_id = identity.rows[0].principal_id as string;
  const task = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,'Canonical project','Build a project','electronics','private') RETURNING id`,
    [teacher.tenantId, row.principal_id],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,'open',$4) RETURNING id`,
    [row.classroom_tenant_id, row.classroom_id, task.rows[0].id, row.classroom_created_by],
  );
  row.assignment_id = handout.rows[0].id as string;

  const learnerPrincipal = await admin.query(
    `SELECT principal_id FROM student_seat_principal($1)`,
    [row.seat_id],
  );
  const project = await admin.query(
    `INSERT INTO projects
       (tenant_id,project_scope,classroom_id,module_key,title,owner_principal_id)
     VALUES ($1,'classroom',$2,'electronics','Canonical learner work',$3)
     RETURNING id`,
    [row.classroom_tenant_id, row.classroom_id, learnerPrincipal.rows[0].principal_id],
  );
  await admin.query(
    `INSERT INTO project_drafts
       (tenant_id,project_id,document_json,revision,updated_by_principal_id)
     VALUES ($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
    [row.classroom_tenant_id, project.rows[0].id, learnerPrincipal.rows[0].principal_id],
  );
  await admin.query(
    `INSERT INTO classroom_assignment_work
       (tenant_id,assignment_id,seat_id,project_id)
     VALUES ($1,$2,$3,$4)`,
    [row.classroom_tenant_id, row.assignment_id, row.seat_id, project.rows[0].id],
  );

  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  const studentFailures = collectBrowserFailures(student, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await student.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await student.getByRole('button', { name: 'Продолжить' }).click();
  await student.getByLabel('Имя для входа').fill('alina-canonical');
  await student.getByRole('checkbox', { name: 'Я не робот' }).press('Space');
  await student.getByRole('button', { name: 'Войти в класс' }).click();
  await openLearnerLearning(student);
  const assignment = student
    .getByTestId('seat-assignments')
    .locator('li')
    .filter({ hasText: 'Canonical project' });
  await expect(assignment).toContainText('В работе');

  // Regression A: historical timestamp only. It is submitted, never a normal review queue item.
  await admin.query(
    `UPDATE classroom_assignment_work SET submitted_at='2026-08-25T10:00:00Z'
      WHERE assignment_id=$1 AND seat_id=$2`,
    [row.assignment_id, row.seat_id],
  );
  await student.reload();
  await openLearnerLearning(student);
  await expect(assignment).toContainText('Сдано · результат ещё не опубликован');
  await expect(assignment).not.toContainText(/legacy|migration|unresolved|миграц/i);
  await assignment.screenshot({ path: `${evidenceDir}/regression-a-learner-submitted.png` });
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  const gradeRow = page
    .getByRole('table', { name: 'Журнал работ класса' })
    .getByRole('row')
    .filter({ hasText: 'Алина Canonical' })
    .filter({ hasText: 'Canonical project' });
  await expect(gradeRow).toContainText('Сдано');
  await expect(gradeRow).not.toContainText('Не начинал');
  await expect(gradeRow).toContainText(
    'Историческая сдача: точное immutable evidence не восстановлено',
  );
  await gradeRow.screenshot({ path: `${evidenceDir}/regression-a-teacher-gradebook.png` });

  // Regression B: immutable Attempt wins after legacy submitted_at is cleared.
  const submitted = await admin.query(
    `SELECT * FROM learning_project_submission_create($1,$2,$3)`,
    [row.seat_id, row.assignment_id, `m007-browser-${Date.now()}`],
  );
  await admin.query(`SELECT * FROM learning_attempt_review($1,$2,$3,$4,$5,$6,$7,$8)`, [
    row.account_id,
    row.principal_id,
    row.classroom_id,
    submitted.rows[0].attempt_id,
    'changes_requested',
    null,
    'Нужно поправить соединение.',
    'Browser regression B',
  ]);
  await student.reload();
  await openLearnerLearning(student);
  await expect(assignment).toContainText('Нужна доработка');
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await expect(gradeRow).toContainText('На доработке');
  await gradeRow.screenshot({ path: `${evidenceDir}/regression-b-changes-requested.png` });

  // Regression C: the persisted old selection remains while Attempt #2 is in progress.
  await admin.query(
    `UPDATE learning_attempts SET state='accepted',evaluated_at=now() WHERE id=$1`,
    [submitted.rows[0].attempt_id],
  );
  const selected = await admin.query(
    `INSERT INTO assessment_results
       (tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,outcome,
        manual_points,evaluator_principal_id,feedback)
     SELECT tenant_id,id,80,100,8000,'passed',80,$2,'Опубликованный результат'
       FROM learning_attempts WHERE id=$1 RETURNING id`,
    [submitted.rows[0].attempt_id, row.principal_id],
  );
  await admin.query(
    `INSERT INTO gradebook_entries
       (tenant_id,school_id,academic_period_id,classroom_id,classroom_assignment_id,
        seat_id,accepted_attempt_id,assessment_result_id,published_by_principal_id)
     SELECT classroom.tenant_id,classroom.school_id,classroom.academic_period_id,classroom.id,
            attempt.classroom_assignment_id,attempt.seat_id,attempt.id,$2,$3
       FROM learning_attempts attempt
       JOIN classrooms classroom ON classroom.id=attempt.classroom_id
      WHERE attempt.id=$1`,
    [submitted.rows[0].attempt_id, selected.rows[0].id, row.principal_id],
  );
  await admin.query(
    `INSERT INTO learning_attempts
       (tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,
        seat_id,learner_identity_id,attempt_number,state,started_at)
     SELECT tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,
            seat_id,learner_identity_id,2,'in_progress',now()
       FROM learning_attempts WHERE id=$1`,
    [submitted.rows[0].attempt_id],
  );
  await student.reload();
  await openLearnerLearning(student);
  await expect(assignment).toContainText('В работе');
  const learnerResult = student
    .locator('.seat-results li')
    .filter({ hasText: 'Canonical project' });
  await expect(learnerResult).toContainText('Зачёт');
  await expect(learnerResult).toContainText('80/100');
  await expect(learnerResult).toContainText('В работе');
  await learnerResult.screenshot({ path: `${evidenceDir}/regression-c-learner-result.png` });
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await expect(gradeRow).toContainText('В работе');
  await expect(gradeRow).toContainText('Зачёт');
  await expect(gradeRow).toContainText('80/100');
  await gradeRow.screenshot({ path: `${evidenceDir}/regression-c-teacher-result.png` });

  // Regression D: compatibility max_points=1 is structural only and never appears as a grade.
  const compatibilityTask = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,'Compatibility ungraded','Migration-only snapshot','electronics','private')
     RETURNING id`,
    [teacher.tenantId, row.principal_id],
  );
  await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,'open',$4)`,
    [
      row.classroom_tenant_id,
      row.classroom_id,
      compatibilityTask.rows[0].id,
      row.classroom_created_by,
    ],
  );
  const client = await admin.connect();
  try {
    await client.query(
      `SELECT set_config('app.learning_m0_006_environment','isolated_test',false)`,
    );
    await client.query(`SELECT learning_m0_convergence_apply($1,$2,$3,$4)`, [
      `m007-browser-compat-${Date.now()}`,
      row.classroom_school_id,
      '9'.repeat(64),
      '2026-08-25T12:00:00Z',
    ]);
  } finally {
    client.release();
  }
  const compatibility = await admin.query(
    `SELECT count(*)::integer AS count
       FROM learning_migration_compatibility_activity_versions compatibility
       JOIN classroom_assignments assignment
         ON assignment.id=compatibility.classroom_assignment_id
      WHERE assignment.classroom_id=$1
        AND compatibility.grading_semantics='unknown'
        AND compatibility.reusable_authored_content=false`,
    [row.classroom_id],
  );
  expect(compatibility.rows[0].count).toBeGreaterThan(0);
  await page.reload();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  const gradebook = page.getByRole('table', { name: 'Журнал работ класса' });
  await expect(gradebook).not.toContainText(/1\s*\/\s*1|60%|100%/);
  await gradebook.screenshot({ path: `${evidenceDir}/regression-d-unknown-grading.png` });

  teacherFailures.assertEmpty();
  studentFailures.assertEmpty();
  await studentContext.close();
});
