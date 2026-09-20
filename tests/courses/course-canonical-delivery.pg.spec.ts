import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';
let admin: pg.Pool, app: pg.Pool, teacher: SeededTeacher, principal: string, account: string;
let seq = 0;
const policies = {
  attemptPolicy: { maxAttempts: 2 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};
async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const value = await fn(c);
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'course01-canonical');
  const who = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  principal = who.rows[0].principal_id;
  account = who.rows[0].account_id;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});
async function material(module = 'electronics') {
  const created = await tx((c) =>
    c.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'Практическая работа','completion',NULL,$4::jsonb,$5,NULL,NULL,NULL,$6)",
      [
        principal,
        teacher.tenantId,
        'Материал ' + ++seq,
        JSON.stringify(policies),
        module,
        'course01:create:' + seq,
      ],
    ),
  );
  expect(created.rows[0].result_code).toBe('ok');
  const published = await tx((c) =>
    c.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      principal,
      teacher.tenantId,
      created.rows[0].activity_id,
      'course01:publish:' + seq,
    ]),
  );
  expect(published.rows[0].result_code).toBe('ok');
  return {
    id: created.rows[0].activity_id as string,
    version: published.rows[0].activity_version_id as string,
  };
}
async function classroom() {
  const cls = await admin.query(
    "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Курс в классе',$4) RETURNING id",
    [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  const id = cls.rows[0].id as string;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [teacher.tenantId, id, teacher.teacherId, account],
  );
  return id;
}
async function seat(classId: string) {
  const result = await admin.query(
    "INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,'Ученик',$3,$3,true,'active',$4) RETURNING id",
    [teacher.tenantId, classId, 'course01-seat-' + ++seq, teacher.teacherId],
  );
  return result.rows[0].id as string;
}
async function course(version: string) {
  const saved = await tx((c) =>
    c.query(
      "SELECT * FROM course_save_v2($1,$2,NULL,'Курс с практикой',NULL,NULL,'private',NULL,$3)",
      [principal, teacher.tenantId, 'course01:course:' + ++seq],
    ),
  );
  const id = saved.rows[0].id as string;
  expect(id).toBeTruthy();
  const outline = await tx((c) =>
    c.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
      id,
      principal,
      account,
      teacher.tenantId,
    ]),
  );
  const section = outline.rows[0].section_id;
  for (let i = 0; i < 2; i++) {
    const lesson = await tx((c) =>
      c.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,$4,NULL,'[]'::jsonb,'assignment',NULL,15,$5) AS id",
        [principal, id, section, 'Практика ' + i, version],
      ),
    );
    expect(lesson.rows[0].id).toBeTruthy();
  }
  const published = await tx((c) =>
    c.query('SELECT * FROM course_publish($1,$2)', [principal, id]),
  );
  expect(published.rows[0].version_number).toBe(1);
  return { id, versionId: published.rows[0].version_id as string };
}
async function assign(
  courseId: string,
  classId: string,
  seats: string[],
  request: string,
  versionNumber = 1,
) {
  return tx(
    async (c) =>
      (
        await c.query(
          'SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,$4,$5,$6::uuid[],$7)',
          [
            principal,
            classId,
            courseId,
            versionNumber,
            seats.length ? 'named_learners' : 'whole_class',
            seats,
            request,
          ],
        )
      ).rows[0],
  );
}
describe('Э1 existing course → exact versions → runs → inherited participation', () => {
  it('excused changes the required denominator without generating academic results', async () => {
    const authored = await material(),
      published = await course(authored.version),
      cls = await classroom(),
      student = await seat(cls);
    const delivery = await assign(published.id, cls, [student], 'course01:denominator:' + ++seq);
    const parts = (
      await admin.query(
        'SELECT part.id,part.source_course_enrollment_id AS enrollment FROM activity_participations part JOIN activity_runs run ON run.id=part.activity_run_id WHERE run.source_course_run_id=$1',
        [delivery.run_id],
      )
    ).rows;
    const completion = async () =>
      (
        await admin.query('SELECT learning_course_completion_internal($1) AS value', [
          parts[0].enrollment,
        ])
      ).rows[0].value;
    expect(await completion()).toMatchObject({
      total: 2,
      completedCount: 0,
      completed: false,
      excusedCount: 0,
      resultPolicy: 'no_course_grade',
    });
    for (let i = 0; i < parts.length; i++) {
      const result = (
        await tx((c) =>
          c.query(
            "SELECT * FROM activity_participation_excuse($1,$2,'Индивидуальное освобождение')",
            [principal, parts[i].id],
          ),
        )
      ).rows[0];
      expect(result.result_code).toBe('ok');
      expect(await completion()).toMatchObject({
        total: 1 - i,
        excusedCount: i + 1,
        completed: false,
      });
    }
    expect(await completion()).toMatchObject({ reason: 'no_required_lessons', basisIds: [] });
    expect(
      (
        await admin.query(
          'SELECT id FROM learning_attempts WHERE activity_participation_id=ANY($1::uuid[])',
          [parts.map((p) => p.id)],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('pins canonical material without a legacy root, materializes repeated blocks, retries and explicit repeat delivery', async () => {
    const authored = await material('three-d');
    const published = await course(authored.version);
    const cls = await classroom();
    const first = await seat(cls);
    const excluded = await seat(cls);
    const delivery = await assign(published.id, cls, [first], 'course01:delivery:' + ++seq);
    expect(delivery).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
    const rows = await admin.query(
      'SELECT run.id,run.learning_activity_version_id,part.source_course_enrollment_id FROM activity_runs run JOIN activity_participations part ON part.activity_run_id=run.id WHERE run.source_course_run_id=$1',
      [delivery.run_id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.id)).size).toBe(2);
    expect(
      rows.rows.every(
        (row) =>
          row.learning_activity_version_id === authored.version && row.source_course_enrollment_id,
      ),
    ).toBe(true);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [first])))
        .rows,
    ).toHaveLength(2);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [excluded])))
        .rows,
    ).toHaveLength(0);
    const retried = await assign(published.id, cls, [first], 'course01:delivery:' + seq);
    expect(retried).toMatchObject({ run_id: delivery.run_id, reused: true });
    const repeated = await assign(published.id, cls, [first], 'course01:new-delivery:' + seq);
    expect(repeated.result_code).toBe('ok');
    expect(repeated.run_id).not.toBe(delivery.run_id);
    const source = await admin.query(
      'SELECT source_teacher_assignment_id FROM learning_activities WHERE id=$1',
      [authored.id],
    );
    expect(source.rows[0].source_teacher_assignment_id).toBeNull();
    const frozen = await admin.query(
      "SELECT outline #>> '{sections,0,lessons,0,learningActivityVersionId}' AS pin FROM course_versions WHERE id=$1",
      [published.versionId],
    );
    expect(frozen.rows[0].pin).toBe(authored.version);
    const audience = (
      await app.query('SELECT learning_audience_for_teacher($1,$2,NULL,$3) AS value', [
        account,
        cls,
        delivery.run_id,
      ])
    ).rows[0].value;
    expect(audience.type).toBe('named_learners');
    const change = async (student: string, include: boolean, expected: boolean, key: string) =>
      (
        await app.query(
          "SELECT learning_audience_member_change($1,$2,$3,$4,$5,$6,$7,'Изменение списка курса',$8) AS code",
          [account, principal, cls, audience.id, student, include, expected, key],
        )
      ).rows[0].code;
    const addKey = 'course01:named-add:' + ++seq;
    expect(await change(excluded, true, false, addKey)).toBe('ok');
    expect(await change(excluded, true, false, addKey)).toBe('ok');
    const addedActor = (
      await admin.query('SELECT principal_id FROM student_seat_principal($1)', [excluded])
    ).rows[0].principal_id;
    const notifications = async () =>
      (await app.query('SELECT item FROM learning_notifications_list($1)', [addedActor])).rows.map(
        (row) => row.item,
      );
    const delivered = (await notifications()).filter(
      (item) => item.courseRunId === delivery.run_id,
    );
    expect(delivered).toHaveLength(2);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [excluded])))
        .rows,
    ).toHaveLength(2);
    const children = await admin.query(
      'SELECT part.id FROM activity_participations part JOIN activity_runs run ON run.id=part.activity_run_id WHERE run.source_course_run_id=$1',
      [delivery.run_id],
    );
    expect(children.rows).toHaveLength(4);
    expect(await change(excluded, false, false, 'course01:named-stale:' + ++seq)).toBe(
      'membership_conflict',
    );
    expect(await change(excluded, false, true, 'course01:named-remove:' + ++seq)).toBe('ok');
    expect(
      (await notifications()).filter((item) => item.courseRunId === delivery.run_id),
    ).toHaveLength(0);
    expect(
      (
        await app.query('SELECT learning_notifications_mark_read($1,$2::uuid[],now()) AS n', [
          addedActor,
          delivered.map((item) => item.id),
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await admin.query('SELECT id FROM learning_notifications WHERE id=ANY($1::uuid[])', [
          delivered.map((item) => item.id),
        ])
      ).rows,
    ).toHaveLength(2);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [excluded])))
        .rows,
    ).toHaveLength(0);
    expect(await change(excluded, true, false, 'course01:named-rejoin:' + ++seq)).toBe(
      'rejoin_requires_explicit_policy',
    );
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS n FROM activity_participations WHERE id=ANY($1::uuid[])',
          [children.rows.map((row) => row.id)],
        )
      ).rows[0].n,
    ).toBe(4);
  });
  it('keeps hidden media and legacy items aligned with effective published occurrences', async () => {
    const sample = Buffer.alloc(128, 7);
    const task = (
      await admin.query(
        `INSERT INTO teacher_assignments(
           tenant_id,owner_principal_id,title,brief,module_key,
           sample_bytes,sample_content_type,visibility
         ) VALUES($1,$2,$3,'Versioned sample','electronics',$4,'image/png','private')
         RETURNING id`,
        [teacher.tenantId, principal, 'Legacy media task ' + ++seq, sample],
      )
    ).rows[0].id as string;

    const viewer = await seedTeacher(admin, 'course-hidden-media-viewer-' + ++seq);
    const viewerIdentity = (
      await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [viewer.tenantId, viewer.teacherId],
      )
    ).rows[0] as { principal_id: string; account_id: string };
    const sampleForViewer = async () =>
      (
        await admin.query(
          'SELECT sample_bytes,sample_content_type FROM assignment_sample_for_viewer($1,$2,$3,$4,NULL)',
          [task, viewerIdentity.principal_id, viewerIdentity.account_id, viewer.tenantId],
        )
      ).rows;

    const saved = await tx((client) =>
      client.query(
        "SELECT * FROM course_save_v2($1,$2,NULL,'Hidden media course',NULL,NULL,'private',NULL,$3)",
        [principal, teacher.tenantId, 'course01:hidden-media-course:' + ++seq],
      ),
    );
    expect(saved.rows[0].result_code).toBe('ok');
    const courseId = saved.rows[0].id as string;
    const madePublic = await tx((client) =>
      client.query(
        "SELECT * FROM course_save_v2($1,$2,$3,'Hidden media course',NULL,NULL,'public',$4,$5)",
        [
          principal,
          teacher.tenantId,
          courseId,
          Number(saved.rows[0].draft_revision),
          'course01:hidden-media-public:' + ++seq,
        ],
      ),
    );
    expect(madePublic.rows[0].result_code).toBe('ok');
    const sectionId = (
      await admin.query(
        'SELECT id FROM course_sections WHERE course_id=$1 ORDER BY position,id LIMIT 1',
        [courseId],
      )
    ).rows[0].id as string;
    const blocks = [{ id: 'legacy-media', type: 'paragraph', text: 'Legacy media lesson' }];
    const lessonA = (
      await tx((client) =>
        client.query(
          "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Legacy media A',NULL,$4::jsonb,'assignment',$5,15,NULL) AS id",
          [principal, courseId, sectionId, JSON.stringify(blocks), task],
        ),
      )
    ).rows[0].id as string;

    const v1 = (
      await tx((client) =>
        client.query('SELECT * FROM course_publish($1,$2)', [principal, courseId]),
      )
    ).rows[0];
    expect(v1).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
    expect(
      (
        await admin.query(
          "SELECT outline #>> '{sections,0,lessons,0,sourceLessonId}' AS lesson FROM course_versions WHERE id=$1",
          [v1.version_id],
        )
      ).rows[0].lesson,
    ).toBe(lessonA);
    expect(
      (
        await admin.query('SELECT source_lesson_id FROM course_version_media WHERE version_id=$1', [
          v1.version_id,
        ])
      ).rows,
    ).toEqual([{ source_lesson_id: lessonA }]);

    const classV1 = await classroom();
    const runV1 = (
      await tx((client) =>
        client.query('SELECT * FROM classroom_course_run_assign($1,$2,$3,NULL)', [
          principal,
          classV1,
          courseId,
        ]),
      )
    ).rows[0];
    expect(runV1).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
    expect(
      (
        await tx((client) =>
          client.query('SELECT * FROM classroom_course_run_media($1,$2,NULL,$3)', [
            runV1.run_id,
            lessonA,
            account,
          ]),
        )
      ).rows,
    ).toHaveLength(1);

    const visibleItems = async () =>
      (
        await tx((client) =>
          client.query('SELECT * FROM course_contents($1,$2,$3,$4)', [
            courseId,
            principal,
            account,
            teacher.tenantId,
          ]),
        )
      ).rows;
    expect((await visibleItems()).map((row) => row.id)).toEqual([task]);
    expect(await sampleForViewer()).toHaveLength(1);

    let revision = Number(
      (await admin.query('SELECT course_draft_revision($1,$2) AS revision', [principal, courseId]))
        .rows[0].revision,
    );
    const duplicated = (
      await admin.query('SELECT * FROM course_lesson_duplicate_v1($1,$2,$3,$4,$5)', [
        principal,
        courseId,
        lessonA,
        revision,
        'course01:hidden-media-duplicate:' + ++seq,
      ])
    ).rows[0];
    expect(duplicated).toMatchObject({ result_code: 'ok', reused: false });
    const lessonB = duplicated.duplicate_id as string;
    expect(lessonB).not.toBe(lessonA);
    revision = Number(duplicated.draft_revision);
    expect((await visibleItems()).map((row) => row.id)).toEqual([task]);

    const hiddenA = (
      await admin.query('SELECT * FROM course_lesson_hidden_set_v1($1,$2,$3,true,$4)', [
        principal,
        courseId,
        lessonA,
        revision,
      ])
    ).rows[0];
    expect(hiddenA).toMatchObject({ result_code: 'ok', hidden: true });
    revision = Number(hiddenA.draft_revision);
    expect((await visibleItems()).map((row) => row.id)).toEqual([task]);
    expect(await sampleForViewer()).toHaveLength(1);

    const v2 = (
      await tx((client) =>
        client.query('SELECT * FROM course_publish($1,$2)', [principal, courseId]),
      )
    ).rows[0];
    expect(v2).toMatchObject({ result_code: 'ok', version_number: 2, reused: false });
    const v2Outline = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [v2.version_id])
    ).rows[0].outline as {
      sections: Array<{ lessons: Array<{ sourceLessonId: string }> }>;
    };
    expect(
      v2Outline.sections.flatMap((section) =>
        section.lessons.map((lesson) => lesson.sourceLessonId),
      ),
    ).toEqual([lessonB]);
    expect(
      (
        await admin.query(
          'SELECT source_lesson_id FROM course_version_media WHERE version_id=$1 ORDER BY source_lesson_id',
          [v2.version_id],
        )
      ).rows.map((row) => row.source_lesson_id),
    ).toEqual([lessonB]);
    expect(
      (
        await admin.query('SELECT source_lesson_id FROM course_version_media WHERE version_id=$1', [
          v1.version_id,
        ])
      ).rows,
    ).toEqual([{ source_lesson_id: lessonA }]);

    const classV2 = await classroom();
    const runV2 = (
      await tx((client) =>
        client.query('SELECT * FROM classroom_course_run_assign($1,$2,$3,NULL)', [
          principal,
          classV2,
          courseId,
        ]),
      )
    ).rows[0];
    expect(runV2).toMatchObject({ result_code: 'ok', version_number: 2, reused: false });
    expect(
      (
        await tx((client) =>
          client.query('SELECT * FROM classroom_course_run_media($1,$2,NULL,$3)', [
            runV2.run_id,
            lessonB,
            account,
          ]),
        )
      ).rows,
    ).toHaveLength(1);

    await admin.query(
      `INSERT INTO course_version_media(
         version_id,source_lesson_id,sample_bytes,content_type,content_hash
       )
       SELECT $1,$2,sample_bytes,content_type,content_hash
         FROM course_version_media
        WHERE version_id=$3 AND source_lesson_id=$2`,
      [v2.version_id, lessonA, v1.version_id],
    );
    expect(
      (
        await tx((client) =>
          client.query('SELECT * FROM classroom_course_run_media($1,$2,NULL,$3)', [
            runV2.run_id,
            lessonA,
            account,
          ]),
        )
      ).rows,
    ).toHaveLength(0);

    revision = Number(
      (await admin.query('SELECT course_draft_revision($1,$2) AS revision', [principal, courseId]))
        .rows[0].revision,
    );
    const hiddenB = (
      await admin.query('SELECT * FROM course_lesson_hidden_set_v1($1,$2,$3,true,$4)', [
        principal,
        courseId,
        lessonB,
        revision,
      ])
    ).rows[0];
    expect(hiddenB).toMatchObject({ result_code: 'ok', hidden: true });
    revision = Number(hiddenB.draft_revision);
    expect(await visibleItems()).toHaveLength(0);
    expect(await sampleForViewer()).toHaveLength(0);

    const shownA = (
      await admin.query('SELECT * FROM course_lesson_hidden_set_v1($1,$2,$3,false,$4)', [
        principal,
        courseId,
        lessonA,
        revision,
      ])
    ).rows[0];
    expect(shownA).toMatchObject({ result_code: 'ok', hidden: false });
    revision = Number(shownA.draft_revision);
    expect((await visibleItems()).map((row) => row.id)).toEqual([task]);
    expect(await sampleForViewer()).toHaveLength(1);
    expect(
      (await admin.query('SELECT id FROM course_lessons WHERE id=$1 AND hidden=false', [lessonA]))
        .rows,
    ).toEqual([{ id: lessonA }]);

    const v3 = (
      await tx((client) =>
        client.query('SELECT * FROM course_publish($1,$2)', [principal, courseId]),
      )
    ).rows[0];
    expect(v3).toMatchObject({ result_code: 'ok', version_number: 3, reused: false });
    expect(
      (
        await admin.query('SELECT source_lesson_id FROM course_version_media WHERE version_id=$1', [
          v3.version_id,
        ])
      ).rows,
    ).toEqual([{ source_lesson_id: lessonA }]);

    revision = Number(
      (await admin.query('SELECT course_draft_revision($1,$2) AS revision', [principal, courseId]))
        .rows[0].revision,
    );
    const hiddenSection = (
      await admin.query('SELECT * FROM course_section_hidden_set_v1($1,$2,$3,true,$4)', [
        principal,
        courseId,
        sectionId,
        revision,
      ])
    ).rows[0];
    expect(hiddenSection).toMatchObject({ result_code: 'ok', hidden: true });
    revision = Number(hiddenSection.draft_revision);
    expect(await visibleItems()).toHaveLength(0);
    expect(await sampleForViewer()).toHaveLength(0);

    const v4 = (
      await tx((client) =>
        client.query('SELECT * FROM course_publish($1,$2)', [principal, courseId]),
      )
    ).rows[0];
    expect(v4).toMatchObject({ result_code: 'ok', version_number: 4, reused: false });
    expect(
      (await admin.query('SELECT outline FROM course_versions WHERE id=$1', [v4.version_id]))
        .rows[0].outline.sections,
    ).toEqual([]);
    expect(
      (
        await admin.query('SELECT source_lesson_id FROM course_version_media WHERE version_id=$1', [
          v4.version_id,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await admin.query('SELECT source_lesson_id FROM course_version_media WHERE version_id=$1', [
          v3.version_id,
        ])
      ).rows,
    ).toEqual([{ source_lesson_id: lessonA }]);
    expect(
      (
        await tx((client) =>
          client.query('SELECT * FROM classroom_course_run_media($1,$2,NULL,$3)', [
            runV1.run_id,
            lessonA,
            account,
          ]),
        )
      ).rows,
    ).toHaveLength(1);

    revision = Number(
      (await admin.query('SELECT course_draft_revision($1,$2) AS revision', [principal, courseId]))
        .rows[0].revision,
    );
    const shownSection = (
      await admin.query('SELECT * FROM course_section_hidden_set_v1($1,$2,$3,false,$4)', [
        principal,
        courseId,
        sectionId,
        revision,
      ])
    ).rows[0];
    expect(shownSection).toMatchObject({ result_code: 'ok', hidden: false });
    expect((await visibleItems()).map((row) => row.id)).toEqual([task]);
    expect(await sampleForViewer()).toHaveLength(1);
    expect(
      (
        await admin.query('SELECT id FROM course_sections WHERE id=$1 AND hidden=false', [
          sectionId,
        ])
      ).rows,
    ).toEqual([{ id: sectionId }]);
  });

  it('freezes only visible informational blocks while preserving draft and historical runs', async () => {
    const allKinds = [
      { id: 'p', type: 'paragraph', text: 'Paragraph', hidden: true },
      { id: 'h', type: 'heading', text: 'Heading', level: 2, hidden: false },
      { id: 'c', type: 'callout', text: 'Callout', tone: 'note', hidden: true },
      {
        id: 'i',
        type: 'image',
        url: '/assets/lesson.png',
        alt: 'Image',
        caption: 'Caption',
        hidden: false,
      },
      { id: 'v', type: 'video', url: '/assets/lesson.mp4', title: 'Video', hidden: true },
      { id: 'a', type: 'audio', url: '/assets/lesson.mp3', title: 'Audio', hidden: false },
      {
        id: 'f',
        type: 'file',
        url: 'https://example.test/file.pdf',
        label: 'File',
        hidden: true,
      },
      {
        id: 't',
        type: 'table',
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
        hidden: false,
      },
      { id: 'm', type: 'formula', text: 'U = I × R', hidden: true },
      { id: 'k', type: 'code', text: 'const x = 1;', language: 'javascript', hidden: false },
      { id: 'd', type: 'divider', hidden: true },
    ];
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_valid($1::jsonb) AS valid', [
          JSON.stringify(allKinds),
        ])
      ).rows[0].valid,
    ).toBe(true);

    const saved = (
      await tx((client) =>
        client.query(
          "SELECT * FROM course_save_v2($1,$2,NULL,'Block controls course',NULL,NULL,'private',NULL,$3)",
          [principal, teacher.tenantId, 'course01:block-controls:' + ++seq],
        ),
      )
    ).rows[0];
    expect(saved.result_code).toBe('ok');
    const courseId = saved.id as string;
    const sectionId = (
      await admin.query(
        'SELECT id FROM course_sections WHERE course_id=$1 ORDER BY position,id LIMIT 1',
        [courseId],
      )
    ).rows[0].id as string;

    const blocksV1 = [
      { id: 'block-a', type: 'paragraph', text: 'Block A' },
      {
        id: 'block-b',
        type: 'image',
        url: '/assets/block-b.png',
        alt: 'Block B image',
        caption: 'Block B caption',
      },
      { id: 'block-c', type: 'code', text: 'const c = 3;', language: 'javascript' },
    ];
    const lessonId = (
      await tx((client) =>
        client.query(
          "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Block lesson',NULL,$4::jsonb,'material',NULL,15,NULL) AS id",
          [principal, courseId, sectionId, JSON.stringify(blocksV1)],
        ),
      )
    ).rows[0].id as string;

    const revision = async () =>
      Number(
        (
          await admin.query('SELECT course_draft_revision($1,$2) AS revision', [
            principal,
            courseId,
          ])
        ).rows[0].revision,
      );
    const publish = async (requestId: string) => {
      const currentRevision = await revision();
      const row = (
        await tx((client) =>
          client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
            principal,
            courseId,
            currentRevision,
            requestId,
          ]),
        )
      ).rows[0];
      expect(row.result_code).toBe('ok');
      return row;
    };
    const frozenBlocks = async (versionId: string) =>
      (
        await admin.query(
          "SELECT outline #> '{sections,0,lessons,0,blocks}' AS blocks FROM course_versions WHERE id=$1",
          [versionId],
        )
      ).rows[0].blocks as Array<Record<string, unknown>>;
    const runBlocks = async (runId: string) =>
      (
        await admin.query(
          'SELECT blocks FROM classroom_course_run_lessons WHERE run_id=$1 ORDER BY lesson_position,source_lesson_id',
          [runId],
        )
      ).rows[0].blocks as Array<Record<string, unknown>>;
    const ids = (blocks: Array<Record<string, unknown>>) => blocks.map((block) => block.id);

    const v1 = await publish('course01:block-controls-v1:' + ++seq);
    expect(v1.version_number).toBe(1);
    expect(ids(await frozenBlocks(v1.version_id))).toEqual(['block-a', 'block-b', 'block-c']);

    const classV1 = await classroom();
    const studentV1 = await seat(classV1);
    const runV1 = await assign(
      courseId,
      classV1,
      [studentV1],
      'course01:block-controls-run-v1:' + ++seq,
      1,
    );
    expect(runV1.result_code).toBe('ok');
    expect(ids(await runBlocks(runV1.run_id))).toEqual(['block-a', 'block-b', 'block-c']);

    const hiddenDraft = [blocksV1[0], { ...blocksV1[1], hidden: true }, blocksV1[2]];
    expect(
      (
        await tx((client) =>
          client.query(
            "SELECT course_lesson_save_v3($1,$2,$3,$4,'Block lesson',NULL,$5::jsonb,'material',NULL,15,NULL) AS id",
            [principal, courseId, sectionId, lessonId, JSON.stringify(hiddenDraft)],
          ),
        )
      ).rows[0].id,
    ).toBe(lessonId);

    const draftHidden = (
      await admin.query('SELECT blocks,content FROM course_lessons WHERE id=$1', [lessonId])
    ).rows[0] as { blocks: Array<Record<string, unknown>>; content: string | null };
    expect(ids(draftHidden.blocks)).toEqual(['block-a', 'block-b', 'block-c']);
    expect(draftHidden.blocks[1]).toMatchObject({ id: 'block-b', hidden: true });
    expect(draftHidden.content).toContain('Block A');
    expect(draftHidden.content).toContain('const c = 3;');
    expect(draftHidden.content).not.toContain('Block B caption');

    const v2 = await publish('course01:block-controls-v2:' + ++seq);
    expect(v2.version_number).toBe(2);
    const frozenV2 = await frozenBlocks(v2.version_id);
    expect(ids(frozenV2)).toEqual(['block-a', 'block-c']);
    expect(frozenV2.every((block) => !Object.hasOwn(block, 'hidden'))).toBe(true);

    const classV2 = await classroom();
    const studentV2 = await seat(classV2);
    const runV2 = await assign(
      courseId,
      classV2,
      [studentV2],
      'course01:block-controls-run-v2:' + ++seq,
      2,
    );
    expect(ids(await runBlocks(runV2.run_id))).toEqual(['block-a', 'block-c']);
    expect(ids(await frozenBlocks(v1.version_id))).toEqual(['block-a', 'block-b', 'block-c']);
    expect(ids(await runBlocks(runV1.run_id))).toEqual(['block-a', 'block-b', 'block-c']);

    const shownDraft = [
      blocksV1[0],
      { ...blocksV1[1], hidden: false, caption: 'Block B shown' },
      blocksV1[2],
    ];
    expect(
      (
        await tx((client) =>
          client.query(
            "SELECT course_lesson_save_v3($1,$2,$3,$4,'Block lesson',NULL,$5::jsonb,'material',NULL,15,NULL) AS id",
            [principal, courseId, sectionId, lessonId, JSON.stringify(shownDraft)],
          ),
        )
      ).rows[0].id,
    ).toBe(lessonId);
    const v3 = await publish('course01:block-controls-v3:' + ++seq);
    const frozenV3 = await frozenBlocks(v3.version_id);
    expect(ids(frozenV3)).toEqual(['block-a', 'block-b', 'block-c']);
    expect(frozenV3[1]).toMatchObject({ id: 'block-b', caption: 'Block B shown' });
    expect(frozenV3[1]).not.toHaveProperty('hidden');

    const reorderedAfterDelete = [blocksV1[2], blocksV1[0]];
    expect(
      (
        await tx((client) =>
          client.query(
            "SELECT course_lesson_save_v3($1,$2,$3,$4,'Block lesson',NULL,$5::jsonb,'material',NULL,15,NULL) AS id",
            [principal, courseId, sectionId, lessonId, JSON.stringify(reorderedAfterDelete)],
          ),
        )
      ).rows[0].id,
    ).toBe(lessonId);
    const v4 = await publish('course01:block-controls-v4:' + ++seq);
    expect(ids(await frozenBlocks(v4.version_id))).toEqual(['block-c', 'block-a']);

    const classV4 = await classroom();
    const studentV4 = await seat(classV4);
    const runV4 = await assign(
      courseId,
      classV4,
      [studentV4],
      'course01:block-controls-run-v4:' + ++seq,
      4,
    );
    expect(ids(await runBlocks(runV4.run_id))).toEqual(['block-c', 'block-a']);

    expect(ids(await frozenBlocks(v1.version_id))).toEqual(['block-a', 'block-b', 'block-c']);
    expect(ids(await frozenBlocks(v2.version_id))).toEqual(['block-a', 'block-c']);
    expect(ids(await runBlocks(runV1.run_id))).toEqual(['block-a', 'block-b', 'block-c']);
  });

  it('duplicates and hides draft structure without copying learner runtime evidence', async () => {
    const authored = await material('electronics');
    const publishedV1 = await course(authored.version);
    const classV1 = await classroom();
    const studentV1 = await seat(classV1);
    const runV1 = await assign(
      publishedV1.id,
      classV1,
      [studentV1],
      'course01:structure-v1:' + ++seq,
      1,
    );
    expect(runV1).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });

    const original = await admin.query(
      `SELECT section_id,section_position,lesson_id,lesson_position,lesson_title,
              lesson_blocks,learning_activity_version_id
         FROM course_outline_v4($1,$2,$3,$4)
        WHERE lesson_id IS NOT NULL
        ORDER BY section_position,lesson_position,lesson_id`,
      [publishedV1.id, principal, account, teacher.tenantId],
    );
    expect(original.rows).toHaveLength(2);
    const sourceSectionId = original.rows[0].section_id as string;
    const sourceLessonIds = original.rows.map((row) => row.lesson_id as string);

    const evidenceCounts = async () => {
      const runtime = await admin.query(
        `SELECT
           (SELECT count(*)::int FROM classroom_course_run_lessons WHERE run_id=$1) AS run_lessons,
           (SELECT count(*)::int FROM activity_runs WHERE source_course_run_id=$1) AS activity_runs,
           (SELECT count(*)::int
              FROM activity_participations part
              JOIN activity_runs run ON run.id=part.activity_run_id
             WHERE run.source_course_run_id=$1) AS participations,
           (SELECT count(*)::int
              FROM learning_attempts attempt
              JOIN activity_participations part ON part.id=attempt.activity_participation_id
              JOIN activity_runs run ON run.id=part.activity_run_id
             WHERE run.source_course_run_id=$1) AS attempts,
           (SELECT count(*)::int
              FROM learning_submissions submission
              JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
              JOIN activity_participations part ON part.id=attempt.activity_participation_id
              JOIN activity_runs run ON run.id=part.activity_run_id
             WHERE run.source_course_run_id=$1) AS submissions,
           (SELECT count(*)::int
              FROM assessment_results result
              JOIN learning_attempts attempt ON attempt.id=result.attempt_id
              JOIN activity_participations part ON part.id=attempt.activity_participation_id
              JOIN activity_runs run ON run.id=part.activity_run_id
             WHERE run.source_course_run_id=$1) AS results`,
        [runV1.run_id],
      );
      return runtime.rows[0];
    };
    const evidenceBefore = await evidenceCounts();
    expect(evidenceBefore).toMatchObject({
      run_lessons: 2,
      activity_runs: 2,
      participations: 2,
      attempts: 0,
      submissions: 0,
      results: 0,
    });
    const courseRunsBefore = Number(
      (
        await admin.query(
          'SELECT count(*)::int AS count FROM classroom_course_runs WHERE course_id=$1',
          [publishedV1.id],
        )
      ).rows[0].count,
    );
    expect(courseRunsBefore).toBe(1);

    let revision = Number(
      (
        await admin.query('SELECT course_draft_revision($1,$2) AS revision', [
          principal,
          publishedV1.id,
        ])
      ).rows[0].revision,
    );
    const sectionRequest = 'course01:section-duplicate:' + ++seq;
    const duplicatedSection = (
      await admin.query('SELECT * FROM course_section_duplicate_v1($1,$2,$3,$4,$5)', [
        principal,
        publishedV1.id,
        sourceSectionId,
        revision,
        sectionRequest,
      ])
    ).rows[0];
    expect(duplicatedSection).toMatchObject({ result_code: 'ok', reused: false });
    expect(duplicatedSection.duplicate_id).not.toBe(sourceSectionId);

    const retriedSection = (
      await admin.query('SELECT * FROM course_section_duplicate_v1($1,$2,$3,$4,$5)', [
        principal,
        publishedV1.id,
        sourceSectionId,
        revision,
        sectionRequest,
      ])
    ).rows[0];
    expect(retriedSection).toMatchObject({
      result_code: 'ok',
      duplicate_id: duplicatedSection.duplicate_id,
      reused: true,
    });
    revision = Number(retriedSection.draft_revision);

    const afterSectionDuplicate = await admin.query(
      `SELECT section_id,section_position,section_hidden,lesson_id,lesson_position,lesson_title,
              lesson_blocks,learning_activity_version_id,lesson_hidden
         FROM course_outline_v4($1,$2,$3,$4)
        WHERE lesson_id IS NOT NULL
        ORDER BY section_position,lesson_position,lesson_id`,
      [publishedV1.id, principal, account, teacher.tenantId],
    );
    const copiedRows = afterSectionDuplicate.rows.filter(
      (row) => row.section_id === duplicatedSection.duplicate_id,
    );
    expect(copiedRows).toHaveLength(2);
    expect(new Set(copiedRows.map((row) => row.lesson_id)).size).toBe(2);
    expect(copiedRows.map((row) => row.lesson_id).some((id) => sourceLessonIds.includes(id))).toBe(
      false,
    );
    expect(copiedRows.map((row) => row.lesson_title)).toEqual(
      original.rows.map((row) => row.lesson_title),
    );
    expect(copiedRows.map((row) => row.lesson_blocks)).toEqual(
      original.rows.map((row) => row.lesson_blocks),
    );
    expect(copiedRows.every((row) => row.learning_activity_version_id === authored.version)).toBe(
      true,
    );
    expect(copiedRows[0].section_position).toBe(Number(original.rows[0].section_position) + 1);

    const lessonRequest = 'course01:lesson-duplicate:' + ++seq;
    const duplicatedLesson = (
      await admin.query('SELECT * FROM course_lesson_duplicate_v1($1,$2,$3,$4,$5)', [
        principal,
        publishedV1.id,
        sourceLessonIds[0],
        revision,
        lessonRequest,
      ])
    ).rows[0];
    expect(duplicatedLesson).toMatchObject({ result_code: 'ok', reused: false });
    expect(duplicatedLesson.duplicate_id).not.toBe(sourceLessonIds[0]);

    const retriedLesson = (
      await admin.query('SELECT * FROM course_lesson_duplicate_v1($1,$2,$3,$4,$5)', [
        principal,
        publishedV1.id,
        sourceLessonIds[0],
        revision,
        lessonRequest,
      ])
    ).rows[0];
    expect(retriedLesson).toMatchObject({
      result_code: 'ok',
      duplicate_id: duplicatedLesson.duplicate_id,
      reused: true,
    });
    revision = Number(retriedLesson.draft_revision);

    const conflict = (
      await admin.query('SELECT * FROM course_lesson_duplicate_v1($1,$2,$3,$4,$5)', [
        principal,
        publishedV1.id,
        sourceLessonIds[1],
        revision,
        sectionRequest,
      ])
    ).rows[0];
    expect(conflict.result_code).toBe('idempotency_conflict');

    const duplicatedLessonRow = (
      await admin.query(
        `SELECT id,section_id,title,summary,content,blocks,kind,assignment_id,
                learning_activity_version_id,estimated_minutes,position,hidden
           FROM course_lessons WHERE id=$1`,
        [duplicatedLesson.duplicate_id],
      )
    ).rows[0];
    const sourceLessonRow = (
      await admin.query(
        `SELECT id,section_id,title,summary,content,blocks,kind,assignment_id,
                learning_activity_version_id,estimated_minutes,position,hidden
           FROM course_lessons WHERE id=$1`,
        [sourceLessonIds[0]],
      )
    ).rows[0];
    expect({
      ...duplicatedLessonRow,
      id: sourceLessonRow.id,
      position: sourceLessonRow.position,
    }).toEqual(sourceLessonRow);
    expect(duplicatedLessonRow.position).toBe(sourceLessonRow.position + 1);
    expect(await evidenceCounts()).toEqual(evidenceBefore);
    expect(
      Number(
        (
          await admin.query(
            'SELECT count(*)::int AS count FROM classroom_course_runs WHERE course_id=$1',
            [publishedV1.id],
          )
        ).rows[0].count,
      ),
    ).toBe(courseRunsBefore);

    const hiddenLesson = (
      await admin.query('SELECT * FROM course_lesson_hidden_set_v1($1,$2,$3,true,$4)', [
        principal,
        publishedV1.id,
        duplicatedLesson.duplicate_id,
        revision,
      ])
    ).rows[0];
    expect(hiddenLesson).toMatchObject({ result_code: 'ok', hidden: true });
    revision = Number(hiddenLesson.draft_revision);

    const publishV2 = (
      await admin.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        principal,
        publishedV1.id,
        revision,
        'course01:structure-publish-v2:' + ++seq,
      ])
    ).rows[0];
    expect(publishV2).toMatchObject({ result_code: 'ok', version_number: 2, reused: false });
    revision = Number(
      (
        await admin.query('SELECT course_draft_revision($1,$2) AS revision', [
          principal,
          publishedV1.id,
        ])
      ).rows[0].revision,
    );
    const outlines = await admin.query(
      `SELECT version_number,outline FROM course_versions
        WHERE course_id=$1 ORDER BY version_number`,
      [publishedV1.id],
    );
    type FrozenOutline = {
      sections: Array<{
        sourceSectionId: string;
        lessons: Array<{ sourceLessonId: string }>;
      }>;
    };
    const idsIn = (outline: FrozenOutline) =>
      outline.sections.flatMap((section) => section.lessons.map((lesson) => lesson.sourceLessonId));
    const sectionIdsIn = (outline: FrozenOutline) =>
      outline.sections.map((section) => section.sourceSectionId);
    expect(idsIn(outlines.rows[0].outline as FrozenOutline)).toEqual(sourceLessonIds);
    expect(idsIn(outlines.rows[1].outline as FrozenOutline)).not.toContain(
      duplicatedLesson.duplicate_id,
    );

    const classV2 = await classroom();
    const studentV2 = await seat(classV2);
    const runV2 = await assign(
      publishedV1.id,
      classV2,
      [studentV2],
      'course01:structure-v2:' + ++seq,
      2,
    );
    expect(runV2.version_number).toBe(2);
    const runV2Lessons = await admin.query(
      'SELECT source_lesson_id FROM classroom_course_run_lessons WHERE run_id=$1 ORDER BY lesson_position,source_lesson_id',
      [runV2.run_id],
    );
    expect(runV2Lessons.rows.map((row) => row.source_lesson_id)).not.toContain(
      duplicatedLesson.duplicate_id,
    );
    expect((await evidenceCounts()).run_lessons).toBe(2);

    const shownLesson = (
      await admin.query('SELECT * FROM course_lesson_hidden_set_v1($1,$2,$3,false,$4)', [
        principal,
        publishedV1.id,
        duplicatedLesson.duplicate_id,
        revision,
      ])
    ).rows[0];
    expect(shownLesson).toMatchObject({ result_code: 'ok', hidden: false });
    revision = Number(shownLesson.draft_revision);
    expect(
      (
        await admin.query('SELECT id FROM course_lessons WHERE id=$1 AND hidden=false', [
          duplicatedLesson.duplicate_id,
        ])
      ).rows,
    ).toHaveLength(1);

    const publishV3 = (
      await admin.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        principal,
        publishedV1.id,
        revision,
        'course01:structure-publish-v3:' + ++seq,
      ])
    ).rows[0];
    expect(publishV3).toMatchObject({ result_code: 'ok', version_number: 3, reused: false });
    revision = Number(
      (
        await admin.query('SELECT course_draft_revision($1,$2) AS revision', [
          principal,
          publishedV1.id,
        ])
      ).rows[0].revision,
    );
    const v3 = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [publishV3.version_id])
    ).rows[0].outline;
    expect(idsIn(v3 as FrozenOutline)).toContain(duplicatedLesson.duplicate_id);

    const hiddenSection = (
      await admin.query('SELECT * FROM course_section_hidden_set_v1($1,$2,$3,true,$4)', [
        principal,
        publishedV1.id,
        duplicatedSection.duplicate_id,
        revision,
      ])
    ).rows[0];
    expect(hiddenSection).toMatchObject({ result_code: 'ok', hidden: true });
    revision = Number(hiddenSection.draft_revision);

    const publishV4 = (
      await admin.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        principal,
        publishedV1.id,
        revision,
        'course01:structure-publish-v4:' + ++seq,
      ])
    ).rows[0];
    expect(publishV4).toMatchObject({ result_code: 'ok', version_number: 4, reused: false });
    revision = Number(
      (
        await admin.query('SELECT course_draft_revision($1,$2) AS revision', [
          principal,
          publishedV1.id,
        ])
      ).rows[0].revision,
    );
    const v4 = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [publishV4.version_id])
    ).rows[0].outline;
    expect(sectionIdsIn(v4 as FrozenOutline)).not.toContain(duplicatedSection.duplicate_id);

    const classV4 = await classroom();
    const studentV4 = await seat(classV4);
    const runV4 = await assign(
      publishedV1.id,
      classV4,
      [studentV4],
      'course01:structure-v4:' + ++seq,
      4,
    );
    const runV4Sections = await admin.query(
      'SELECT DISTINCT source_section_id FROM classroom_course_run_lessons WHERE run_id=$1',
      [runV4.run_id],
    );
    expect(runV4Sections.rows.map((row) => row.source_section_id)).not.toContain(
      duplicatedSection.duplicate_id,
    );

    const shownSection = (
      await admin.query('SELECT * FROM course_section_hidden_set_v1($1,$2,$3,false,$4)', [
        principal,
        publishedV1.id,
        duplicatedSection.duplicate_id,
        revision,
      ])
    ).rows[0];
    expect(shownSection).toMatchObject({ result_code: 'ok', hidden: false });
    revision = Number(shownSection.draft_revision);
    expect(
      (
        await admin.query('SELECT id FROM course_sections WHERE id=$1 AND hidden=false', [
          duplicatedSection.duplicate_id,
        ])
      ).rows,
    ).toHaveLength(1);

    const publishV5 = (
      await admin.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        principal,
        publishedV1.id,
        revision,
        'course01:structure-publish-v5:' + ++seq,
      ])
    ).rows[0];
    expect(publishV5).toMatchObject({ result_code: 'ok', version_number: 5, reused: false });
    const v5 = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [publishV5.version_id])
    ).rows[0].outline;
    expect(sectionIdsIn(v5 as FrozenOutline)).toContain(duplicatedSection.duplicate_id);

    const oldV1 = (
      await admin.query('SELECT outline FROM course_versions WHERE id=$1', [publishedV1.versionId])
    ).rows[0].outline;
    expect(idsIn(oldV1 as FrozenOutline)).toEqual(sourceLessonIds);
    expect(
      (
        await admin.query(
          'SELECT source_lesson_id FROM classroom_course_run_lessons WHERE run_id=$1 ORDER BY lesson_position,source_lesson_id',
          [runV1.run_id],
        )
      ).rows.map((row) => row.source_lesson_id),
    ).toEqual(expect.arrayContaining(sourceLessonIds));
    expect(await evidenceCounts()).toEqual(evidenceBefore);
  });

  it('dynamic late enrollment inherits children; a foreign named seat cannot create a partial run', async () => {
    const authored = await material();
    const published = await course(authored.version);
    const cls = await classroom();
    const delivery = await assign(published.id, cls, [], 'course01:dynamic:' + ++seq);
    expect(delivery.result_code).toBe('ok');
    const late = await seat(cls);
    const enrollment = await admin.query(
      'SELECT enrollment.id FROM course_enrollments enrollment JOIN learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id WHERE enrollment.course_run_id=$1 AND link.seat_id=$2',
      [delivery.run_id, late],
    );
    expect(enrollment.rows).toHaveLength(1);
    expect(
      (
        await admin.query(
          'SELECT id FROM activity_participations WHERE source_course_enrollment_id=$1',
          [enrollment.rows[0].id],
        )
      ).rows,
    ).toHaveLength(2);
    const other = await classroom();
    const foreign = await seat(other);
    const rejected = await assign(published.id, cls, [foreign], 'course01:rejected:' + ++seq);
    expect(rejected.result_code).toBe('audience_forbidden');
    const all = await admin.query('SELECT id FROM classroom_course_runs WHERE classroom_id=$1', [
      cls,
    ]);
    expect(all.rows).toHaveLength(1);
    await admin.query("UPDATE classroom_student_seats SET status='removed' WHERE id=$1", [late]);
    expect(
      (
        await admin.query('SELECT status FROM course_enrollments WHERE id=$1', [
          enrollment.rows[0].id,
        ])
      ).rows[0].status,
    ).toBe('withdrawn');
    expect(
      (
        await admin.query(
          'SELECT status FROM activity_participations WHERE source_course_enrollment_id=$1',
          [enrollment.rows[0].id],
        )
      ).rows.map((row) => row.status),
    ).toEqual(['withdrawn', 'withdrawn']);
    expect(
      (await tx((c) => c.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [late])))
        .rows,
    ).toHaveLength(0);
  });
  it('class archive/restore preserves history and never reopens a closed run', async () => {
    const authored = await material();
    const published = await course(authored.version);
    const cls = await classroom();
    const student = await seat(cls);
    const delivery = await assign(published.id, cls, [student], 'course01:archive:' + ++seq);
    expect(delivery.result_code).toBe('ok');
    const enrollment = (
      await admin.query(
        'SELECT enrollment.id FROM course_enrollments enrollment JOIN learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id WHERE enrollment.course_run_id=$1 AND link.seat_id=$2',
        [delivery.run_id, student],
      )
    ).rows[0].id as string;
    const withdrawn = (
      await tx((c) =>
        c.query('SELECT * FROM course_enrollment_withdraw($1,$2)', [principal, enrollment]),
      )
    ).rows[0];
    expect(withdrawn).toMatchObject({ result_code: 'ok', enrollment_status: 'withdrawn' });
    expect(
      (
        await tx((c) =>
          c.query('SELECT classroom_course_run_set_status($1,$2,$3,$4) AS ok', [
            principal,
            cls,
            delivery.run_id,
            'closed',
          ]),
        )
      ).rows[0].ok,
    ).toBe(true);
    const evidence = async () =>
      (
        await admin.query(
          `SELECT
             (SELECT status FROM classrooms WHERE id=$1) AS classroom_status,
             (SELECT status FROM classroom_course_runs WHERE id=$2) AS run_status,
             (SELECT status FROM course_enrollments WHERE id=$3) AS enrollment_status,
             (SELECT count(*)::integer FROM activity_runs WHERE source_course_run_id=$2) AS activity_runs,
             (SELECT count(*)::integer FROM activity_participations WHERE source_course_enrollment_id=$3) AS participations,
             (SELECT count(*)::integer FROM learning_attempts attempt JOIN activity_participations participation ON participation.id=attempt.activity_participation_id WHERE participation.source_course_enrollment_id=$3) AS attempts,
             (SELECT count(*)::integer FROM classroom_seat_credentials WHERE seat_id=$4) AS credentials`,
          [cls, delivery.run_id, enrollment, student],
        )
      ).rows[0];
    const before = await evidence();
    expect(before).toMatchObject({
      classroom_status: 'active',
      run_status: 'closed',
      enrollment_status: 'withdrawn',
      activity_runs: 2,
      participations: 2,
      attempts: 0,
      credentials: 0,
    });
    expect(
      (
        await app.query('SELECT classroom_management_set_status($1,$2,$3) AS ok', [
          account,
          cls,
          'archived',
        ])
      ).rows[0].ok,
    ).toBe(true);
    expect(await evidence()).toMatchObject({ ...before, classroom_status: 'archived' });
    expect(
      (
        await app.query('SELECT classroom_management_set_status($1,$2,$3) AS ok', [
          account,
          cls,
          'active',
        ])
      ).rows[0].ok,
    ).toBe(true);
    expect(await evidence()).toEqual(before);
  });
});
