import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let teacher: SeededTeacher;
let other: SeededTeacher;
let principal: string;
let account: string;
let sequence = 0;
const policies = {
  attemptPolicy: null,
  resultSelectionPolicy: null,
  completionPolicy: null,
  latePolicy: null,
  assessmentPolicy: null,
  feedbackReleasePolicy: null,
};
const imageBytes = Buffer.from('course image v1');
const pdfBytes = Buffer.from('%PDF-1.4\ncourse material v1');
const imageBytesV2 = Buffer.from('course image v2 with different bytes');
const pdfBytesV2 = Buffer.from('%PDF-1.4\ncourse material v2 with different bytes');

async function tx<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (problem) {
    await client.query('ROLLBACK');
    throw problem;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'course-manual-owner');
  other = await seedTeacher(admin, 'course-manual-other');
  const identity = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  principal = identity.rows[0].principal_id;
  account = identity.rows[0].account_id;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function publishedManual(): Promise<{
  id: string;
  version: string;
  imageHash: string;
  fileHash: string;
}> {
  const suffix = ++sequence;
  const created = await tx((client) =>
    client.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','manual',$3,NULL,'ungraded',NULL,$4::jsonb,NULL,NULL,NULL,NULL,$5)",
      [
        principal,
        teacher.tenantId,
        `Ручной материал ${suffix}`,
        JSON.stringify(policies),
        `manual:create:${suffix}`,
      ],
    ),
  );
  expect(created.rows[0].result_code).toBe('ok');
  const id = created.rows[0].activity_id as string;
  await admin.query(
    `UPDATE learning_activities SET draft_payload=draft_payload ||
      jsonb_build_object('blocks',jsonb_build_array(jsonb_build_object(
        'type','paragraph','text','Текст первой версии')))
      WHERE id=$1`,
    [id],
  );
  const image = await tx((client) =>
    client.query('SELECT * FROM learning_activity_draft_task_image_set($1,$2,$3,1,$4,$5)', [
      principal,
      teacher.tenantId,
      id,
      imageBytes,
      'image/png',
    ]),
  );
  expect(image.rows[0].result_code).toBe('ok');
  const file = await tx((client) =>
    client.query('SELECT * FROM learning_activity_draft_task_file_set($1,$2,$3,2,$4,$5)', [
      principal,
      teacher.tenantId,
      id,
      pdfBytes,
      'lesson.pdf',
    ]),
  );
  expect(file.rows[0].result_code).toBe('ok');
  const published = await tx((client) =>
    client.query('SELECT * FROM learning_activity_publish($1,$2,$3,3,$4)', [
      principal,
      teacher.tenantId,
      id,
      `manual:publish:${suffix}`,
    ]),
  );
  expect(published.rows[0].result_code).toBe('ok');
  return {
    id,
    version: published.rows[0].activity_version_id as string,
    imageHash: image.rows[0].content_hash as string,
    fileHash: file.rows[0].content_hash as string,
  };
}

describe('Course manual material exact pin and learner proof', () => {
  it('rejects draft, project, foreign and missing versions before course save', async () => {
    const manual = await publishedManual();
    const good = [
      { id: 'manual', type: 'manual-material', learningActivityVersionId: manual.version },
    ];
    expect(
      (
        await tx((client) =>
          client.query('SELECT course_manual_material_blocks_authorized($1,$2,$3::jsonb) AS ok', [
            principal,
            teacher.tenantId,
            JSON.stringify(good),
          ]),
        )
      ).rows[0].ok,
    ).toBe(true);
    const badIds = [manual.id, '11111111-1111-4111-8111-111111111111'];
    for (const id of badIds) {
      expect(
        (
          await tx((client) =>
            client.query('SELECT course_manual_material_blocks_authorized($1,$2,$3::jsonb) AS ok', [
              principal,
              teacher.tenantId,
              JSON.stringify([{ ...good[0], learningActivityVersionId: id }]),
            ]),
          )
        ).rows[0].ok,
      ).toBe(false);
    }
    expect(
      (
        await tx((client) =>
          client.query('SELECT course_manual_material_blocks_authorized($1,$2,$3::jsonb) AS ok', [
            principal,
            other.tenantId,
            JSON.stringify(good),
          ]),
        )
      ).rows[0].ok,
    ).toBe(false);
    const project = await tx((client) =>
      client.query(
        "SELECT * FROM learning_activity_create($1,$2,'school','private','project','Project',NULL,'completion',NULL,$3::jsonb,'electronics',NULL,NULL,NULL,$4)",
        [principal, teacher.tenantId, JSON.stringify(policies), `manual:project:${++sequence}`],
      ),
    );
    expect(project.rows[0].result_code).toBe('ok');
    const projectVersion = await tx((client) =>
      client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        principal,
        teacher.tenantId,
        project.rows[0].activity_id,
        `manual:project-publish:${sequence}`,
      ]),
    );
    expect(projectVersion.rows[0].result_code).toBe('ok');
    expect(
      (
        await tx((client) =>
          client.query('SELECT course_manual_material_blocks_authorized($1,$2,$3::jsonb) AS ok', [
            principal,
            teacher.tenantId,
            JSON.stringify([
              { ...good[0], learningActivityVersionId: projectVersion.rows[0].activity_version_id },
            ]),
          ]),
        )
      ).rows[0].ok,
    ).toBe(false);
  });

  it('freezes ordered text/image/PDF in v1 and denies other audience, future open and wrong hash', async () => {
    const manual = await publishedManual();
    const saved = await tx((client) =>
      client.query("SELECT * FROM course_save_v2($1,$2,NULL,$3,NULL,NULL,'private',NULL,$4)", [
        principal,
        teacher.tenantId,
        `Manual course ${++sequence}`,
        `manual:course:${sequence}`,
      ]),
    );
    const courseId = saved.rows[0].id as string;
    const outline = await tx((client) =>
      client.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
        courseId,
        principal,
        account,
        teacher.tenantId,
      ]),
    );
    const blocks = [
      { id: 'before', type: 'paragraph', text: 'Вступление' },
      { id: 'manual', type: 'manual-material', learningActivityVersionId: manual.version },
      { id: 'after', type: 'paragraph', text: 'После материала' },
      {
        id: 'hidden',
        type: 'manual-material',
        learningActivityVersionId: manual.version,
        hidden: true,
      },
    ];
    const lesson = await tx((client) =>
      client.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Урок',NULL,$4::jsonb,'material',NULL,10,NULL) AS id",
        [principal, courseId, outline.rows[0].section_id, JSON.stringify(blocks)],
      ),
    );
    expect(lesson.rows[0].id).toBeTruthy();
    const revision = await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [
      courseId,
    ]);
    const published = await tx((client) =>
      client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principal,
        courseId,
        revision.rows[0].draft_revision,
        `manual:course:publish:${sequence}`,
      ]),
    );
    expect(published.rows[0].result_code).toBe('ok');
    expect(published.rows[0].version_number).toBe(1);
    const classroom = await admin.query(
      "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Manual class',$4) RETURNING id",
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const classId = classroom.rows[0].id as string;
    await admin.query(
      "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
      [teacher.tenantId, classId, teacher.teacherId, account],
    );
    const seats = await admin.query(
      "INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,'Allowed',$3,$3,true,'active',$4),($1,$2,'Excluded',$5,$5,true,'active',$4) RETURNING id",
      [
        teacher.tenantId,
        classId,
        `manual-allowed-${sequence}`,
        teacher.teacherId,
        `manual-excluded-${sequence}`,
      ],
    );
    const allowed = seats.rows[0].id as string;
    const excluded = seats.rows[1].id as string;
    const delivery = await tx((client) =>
      client.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'named_learners',$4::uuid[],$5)",
        [principal, classId, courseId, [allowed], `manual:assign:${sequence}`],
      ),
    );
    expect(delivery.rows[0].result_code).toBe('ok');
    const runId = delivery.rows[0].run_id as string;
    const runLesson = await admin.query(
      'SELECT id,blocks FROM classroom_course_run_lessons WHERE run_id=$1',
      [runId],
    );
    expect(runLesson.rows[0].blocks.map((block: { id: string }) => block.id)).toEqual([
      'before',
      'manual',
      'after',
    ]);
    const lessonId = runLesson.rows[0].id as string;
    const view = (seatId: string, blockId = 'manual') =>
      admin.query('SELECT * FROM learning_course_manual_material_for_viewer($1,$2,$3,NULL,$4)', [
        runId,
        lessonId,
        blockId,
        seatId,
      ]);
    expect((await view(allowed)).rows[0]).toMatchObject({
      version_id: manual.version,
      version_number: 1,
    });
    expect((await view(excluded)).rows).toHaveLength(0);
    expect((await view(allowed, 'hidden')).rows).toHaveLength(0);
    expect(
      (
        await admin.query(
          'SELECT * FROM learning_course_manual_material_for_viewer($1,$2,$3,$4,NULL)',
          [runId, lessonId, 'manual', account],
        )
      ).rows,
    ).toHaveLength(0);
    const learnerAccount = (
      await admin.query(
        `INSERT INTO accounts (email,password_hash,birth_date,country)
         VALUES ('course-manual-' || gen_random_uuid()::text || '@test.local',
                 'isolated-test-only',DATE '2000-01-01','RU') RETURNING id`,
      )
    ).rows[0].id as string;
    const learnerIdentity = (
      await admin.query(
        `SELECT learner_identity_id FROM learner_identity_links
          WHERE tenant_id=$1 AND school_id=$2 AND seat_id=$3
            AND link_kind='student_seat' AND status='active'`,
        [teacher.tenantId, teacher.schoolId, allowed],
      )
    ).rows[0].learner_identity_id as string;
    const linkedSeat = await admin.query(
      `UPDATE classroom_student_seats SET account_id=$1
        WHERE id=$2 AND tenant_id=$3 AND classroom_id=$4 RETURNING account_id`,
      [learnerAccount, allowed, teacher.tenantId, classId],
    );
    expect(linkedSeat.rows).toEqual([{ account_id: learnerAccount }]);
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'account',$4)`,
      [teacher.tenantId, teacher.schoolId, learnerIdentity, learnerAccount],
    );
    const viewAccount = () =>
      admin.query('SELECT * FROM learning_course_manual_material_for_viewer($1,$2,$3,$4,NULL)', [
        runId,
        lessonId,
        'manual',
        learnerAccount,
      ]);
    expect((await viewAccount()).rows[0]).toMatchObject({
      version_id: manual.version,
      version_number: 1,
    });
    const media = (role: string, hash: string) =>
      admin.query('SELECT * FROM learning_course_manual_media_for_viewer($1,$2,$3,NULL,$4,$5,$6)', [
        runId,
        lessonId,
        'manual',
        allowed,
        role,
        hash,
      ]);
    const accountMedia = (role: string, hash: string) =>
      admin.query('SELECT * FROM learning_course_manual_media_for_viewer($1,$2,$3,$4,NULL,$5,$6)', [
        runId,
        lessonId,
        'manual',
        learnerAccount,
        role,
        hash,
      ]);
    expect((await media('task-image', manual.imageHash)).rows[0].media_bytes).toEqual(imageBytes);
    expect((await media('task-file', manual.fileHash)).rows[0].media_bytes).toEqual(pdfBytes);
    expect((await accountMedia('task-image', manual.imageHash)).rows[0].media_bytes).toEqual(
      imageBytes,
    );
    expect((await accountMedia('task-file', manual.fileHash)).rows[0].media_bytes).toEqual(
      pdfBytes,
    );
    expect((await media('task-file', manual.imageHash)).rows).toHaveLength(0);
    expect((await media('task-file', '0'.repeat(64))).rows).toHaveLength(0);
    await admin.query(
      "UPDATE classroom_course_runs SET opens_at=now()+interval '1 day' WHERE id=$1",
      [runId],
    );
    expect((await view(allowed)).rows).toHaveLength(0);
    expect((await viewAccount()).rows).toHaveLength(0);
    expect((await media('task-file', manual.fileHash)).rows).toHaveLength(0);
    await admin.query('UPDATE classroom_course_runs SET opens_at=NULL WHERE id=$1', [runId]);
    await admin.query(
      "UPDATE learning_activities SET draft_payload=jsonb_set(draft_payload,'{blocks,0,text}','\"Текст второй версии\"'::jsonb),draft_revision=draft_revision+1 WHERE id=$1",
      [manual.id],
    );
    const imageV2 = await tx((client) =>
      client.query('SELECT * FROM learning_activity_draft_task_image_set($1,$2,$3,4,$4,$5)', [
        principal,
        teacher.tenantId,
        manual.id,
        imageBytesV2,
        'image/png',
      ]),
    );
    expect(imageV2.rows[0].result_code).toBe('ok');
    const fileV2 = await tx((client) =>
      client.query('SELECT * FROM learning_activity_draft_task_file_set($1,$2,$3,5,$4,$5)', [
        principal,
        teacher.tenantId,
        manual.id,
        pdfBytesV2,
        'lesson-v2.pdf',
      ]),
    );
    expect(fileV2.rows[0].result_code).toBe('ok');
    const imageHashV2 = imageV2.rows[0].content_hash as string;
    const fileHashV2 = fileV2.rows[0].content_hash as string;
    expect(imageHashV2).not.toBe(manual.imageHash);
    expect(fileHashV2).not.toBe(manual.fileHash);
    const v2 = await tx((client) =>
      client.query('SELECT * FROM learning_activity_publish($1,$2,$3,6,$4)', [
        principal,
        teacher.tenantId,
        manual.id,
        `manual:republish:${sequence}`,
      ]),
    );
    expect(v2.rows[0].result_code).toBe('ok');
    expect(v2.rows[0].activity_version_id).not.toBe(manual.version);
    const publishedV2 = await admin.query(
      `SELECT version.blocks,media.role,media.bytes,media.content_hash
         FROM learning_activity_versions version
         JOIN learning_activity_version_media media ON media.activity_version_id=version.id
        WHERE version.id=$1 ORDER BY media.role`,
      [v2.rows[0].activity_version_id],
    );
    expect(publishedV2.rows).toHaveLength(2);
    expect(publishedV2.rows[0].blocks[1].contentHash).toBe(imageHashV2);
    expect(publishedV2.rows[0].blocks[2].contentHash).toBe(fileHashV2);
    expect(
      publishedV2.rows.map((row: { role: string; bytes: Buffer; content_hash: string }) => [
        row.role,
        row.bytes,
        row.content_hash,
      ]),
    ).toEqual([
      ['task-file', pdfBytesV2, fileHashV2],
      ['task-image', imageBytesV2, imageHashV2],
    ]);
    const pinnedSeat = (await view(allowed)).rows[0];
    const pinnedAccount = (await viewAccount()).rows[0];
    expect(pinnedSeat).toMatchObject({
      version_id: manual.version,
      version_number: 1,
    });
    expect(pinnedAccount).toMatchObject(pinnedSeat);
    expect(pinnedSeat.blocks.map((block: { type: string }) => block.type)).toEqual([
      'paragraph',
      'image',
      'file',
    ]);
    expect(pinnedSeat.blocks[0].text).toBe('Текст первой версии');
    expect(pinnedSeat.blocks[1].contentHash).toBe(manual.imageHash);
    expect(pinnedSeat.blocks[2].contentHash).toBe(manual.fileHash);
    expect((await media('task-image', manual.imageHash)).rows[0].media_bytes).toEqual(imageBytes);
    expect((await media('task-file', manual.fileHash)).rows[0].media_bytes).toEqual(pdfBytes);
    expect((await accountMedia('task-image', manual.imageHash)).rows[0].media_bytes).toEqual(
      imageBytes,
    );
    expect((await accountMedia('task-file', manual.fileHash)).rows[0].media_bytes).toEqual(
      pdfBytes,
    );
    for (const roleAndHash of [
      ['task-image', imageHashV2],
      ['task-file', fileHashV2],
    ] as const) {
      expect((await media(...roleAndHash)).rows).toHaveLength(0);
      expect((await accountMedia(...roleAndHash)).rows).toHaveLength(0);
    }
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS count FROM activity_runs WHERE source_course_run_id=$1',
          [runId],
        )
      ).rows[0].count,
    ).toBe(0);
  });
});
