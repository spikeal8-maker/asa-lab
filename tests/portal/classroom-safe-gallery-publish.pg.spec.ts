import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';

// All writes are confined to disposable *_test PostgreSQL databases by helpers.
// This is the real database publication path, not a mocked gallery controller.
let admin: pg.Pool;
let runtime: pg.Pool;

beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});

afterAll(async () => {
  await Promise.all([admin?.end(), runtime?.end()]);
});

async function prepare() {
  const teacher = await seedTeacher(admin, `classroom-gallery-safe-${randomUUID().slice(0, 8)}`);
  const link = await admin.query(
    'SELECT account_id, principal_id FROM legacy_user_account_links WHERE user_id=$1',
    [teacher.teacherId],
  );
  const teacherAccount = link.rows[0].account_id as string;
  const teacherPrincipal = link.rows[0].principal_id as string;
  const classroomId = randomUUID();

  await admin.query(
    `INSERT INTO classrooms
       (id,tenant_id,school_id,academic_period_id,title,created_by)
     VALUES($1,$2,$3,$4,'Безопасная публикация',$5)`,
    [classroomId, teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES($1,$2,$3,$4,'owner')`,
    [teacher.tenantId, classroomId, teacher.teacherId, teacherAccount],
  );
  const seat = await admin.query(
    `SELECT id FROM classroom_management_add_seat($1,$2,$3,$4,true)`,
    [teacherAccount, classroomId, 'Ученик защищённого класса', randomUUID().slice(0, 8)],
  );
  const seatId = seat.rows[0].id as string;
  await admin.query('UPDATE classroom_student_seats SET status=\'active\' WHERE id=$1', [seatId]);
  const prepared = await runtime.query(
    'SELECT classroom_participant_prepare($1,$2::uuid[]) AS ready',
    [teacherPrincipal, [classroomId]],
  );
  expect(prepared.rows[0].ready).toBe(true);
  const principal = await admin.query('SELECT id FROM principals WHERE seat_id=$1', [seatId]);
  const seatPrincipal = principal.rows[0].id as string;

  async function project(ownerPrincipal: string, projectClassId: string | null) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO projects
         (id,tenant_id,classroom_id,project_scope,module_key,title,status,owner_principal_id)
       VALUES($1,$2,$3,$4,'three-d','Проект с проверкой защиты','active',$5)`,
      [
        id,
        teacher.tenantId,
        projectClassId,
        projectClassId === null ? 'personal' : 'classroom',
        ownerPrincipal,
      ],
    );
    await admin.query(
      `INSERT INTO project_drafts
         (project_id,tenant_id,document_json,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[],"connections":[]}'::jsonb,$3)`,
      [id, teacher.tenantId, ownerPrincipal],
    );
    await admin.query(
      `INSERT INTO project_snapshots
         (project_id,tenant_id,image,content_type,width,height,source_revision,captured_by_principal_id)
       VALUES($1,$2,$3,'image/png',16,16,1,$4)`,
      [id, teacher.tenantId, Buffer.alloc(64), ownerPrincipal],
    );
    return id;
  }

  return { teacher, teacherAccount, teacherPrincipal, classroomId, seatId, seatPrincipal, project };
}

describe('Safe Mode refuses new external classroom publications on real PostgreSQL', () => {
  it('blocks Seat publication until both class and individual protections are disabled', async () => {
    const f = await prepare();
    const projectId = await f.project(f.seatPrincipal, null);

    // Default class policy and Seat policy are both safe. Teacher authorship
    // is authorized but cannot bypass either layer, even through direct SQL.
    await expect(
      runtime.query('SELECT gallery_publish($1,$2) AS ok', [f.teacherPrincipal, projectId]),
    ).rejects.toMatchObject({ code: 'P5S01' });
    const firstCounts = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM project_publication_state WHERE project_id=$1) AS state_count,
         (SELECT count(*)::int FROM project_publications WHERE project_id=$1) AS gallery_count,
         (SELECT count(*)::int FROM project_versions WHERE project_id=$1) AS versions`,
      [projectId],
    );
    expect(firstCounts.rows[0]).toMatchObject({
      state_count: 0,
      gallery_count: 0,
      versions: 0,
    });

    // Individual protection cannot be overridden by disabling only the class default.
    await admin.query('UPDATE classrooms SET safe_mode_default=false WHERE id=$1', [f.classroomId]);
    await expect(
      runtime.query('SELECT gallery_publish($1,$2) AS ok', [f.teacherPrincipal, projectId]),
    ).rejects.toMatchObject({ code: 'P5S01' });

    await admin.query('UPDATE classroom_student_seats SET safe_mode=false WHERE id=$1', [f.seatId]);
    const published = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      f.teacherPrincipal,
      projectId,
    ]);
    expect(published.rows[0].ok).toBe(true);

    const state = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM project_publication_state WHERE project_id=$1) AS state_count,
         (SELECT count(*)::int FROM project_publications WHERE project_id=$1) AS gallery_count,
         (SELECT count(*)::int FROM project_publication_revisions WHERE project_id=$1) AS revisions`,
      [projectId],
    );
    expect(state.rows[0]).toMatchObject({ state_count: 1, gallery_count: 1, revisions: 1 });

    // Taking an already published item down must remain possible after protection
    // is switched on. This slice does NOT automatically revoke old publications.
    await admin.query('UPDATE classrooms SET safe_mode_default=true WHERE id=$1', [f.classroomId]);
    const removed = await runtime.query('SELECT gallery_unpublish($1,$2) AS ok', [
      f.teacherPrincipal,
      projectId,
    ]);
    expect(removed.rows[0].ok).toBe(true);
    const afterRemove = await admin.query(
      'SELECT count(*)::int AS count FROM project_publications WHERE project_id=$1',
      [projectId],
    );
    expect(afterRemove.rows[0].count).toBe(0);
    await expect(
      runtime.query('SELECT gallery_publish($1,$2) AS ok', [f.teacherPrincipal, projectId]),
    ).rejects.toMatchObject({ code: 'P5S01' });

    // The legacy projection is guarded too; a direct insert cannot bypass
    // gallery_publish() and expose protected content to the public shelf.
    await expect(
      admin.query(
        `INSERT INTO project_publications
           (project_id,tenant_id,owner_principal_id,published_by_principal_id,
            title,module_key,author_label,snapshot_revision)
         VALUES($1,$2,$3,$4,'Обход','three-d','Ученик',1)`,
        [projectId, f.teacher.tenantId, f.seatPrincipal, f.teacherPrincipal],
      ),
    ).rejects.toMatchObject({ code: 'P5S01' });
  });

  it('keeps unrelated personal Account work publishable while a class is protected', async () => {
    const f = await prepare();
    const teacherPersonal = await f.project(f.teacherPrincipal, null);
    const published = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      f.teacherPrincipal,
      teacherPersonal,
    ]);
    expect(published.rows[0].ok).toBe(true);

    const scoped = await f.project(f.teacherPrincipal, f.classroomId);
    await expect(
      runtime.query('SELECT gallery_publish($1,$2) AS ok', [f.teacherPrincipal, scoped]),
    ).rejects.toMatchObject({ code: 'P5S01' });
  });
});
