import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let author: SeededTeacher;
let colleague: SeededTeacher;
let principalId: string;
let accountId: string;
let colleaguePrincipalId: string;
let colleagueAccountId: string;

async function identity(teacher: SeededTeacher) {
  const row = await admin.query(
    `SELECT principal_id,account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  return row.rows[0] as { principal_id: string; account_id: string };
}

async function newCourse(title: string, visibility = 'private') {
  await admin.query(
    `INSERT INTO teacher_assignments
      (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES($1,$2,$3,'anchor','electronics','private')`,
    [author.tenantId, principalId, title + ' anchor'],
  );
  const created = await admin.query(`SELECT course_save($1,NULL,$2,NULL,NULL,$3) AS id`, [
    principalId,
    title,
    visibility,
  ]);
  const courseId = created.rows[0].id as string;
  const outline = await admin.query(
    `SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1`,
    [courseId, principalId, accountId, author.tenantId],
  );
  return { courseId, sectionId: outline.rows[0].section_id as string };
}

beforeAll(async () => {
  admin = testAdminPool();
  author = await seedTeacher(admin, 'course-closure-author');
  colleague = await seedTeacher(admin, 'course-closure-colleague');
  const ownerIdentity = await identity(author);
  const otherIdentity = await identity(colleague);
  principalId = ownerIdentity.principal_id;
  accountId = ownerIdentity.account_id;
  colleaguePrincipalId = otherIdentity.principal_id;
  colleagueAccountId = otherIdentity.account_id;
});

afterAll(async () => {
  await admin.end();
});

describe('E1 course authoring closure', () => {
  it('archives/restores without deleting publications and hides archived public content externally', async () => {
    const { courseId, sectionId } = await newCourse('Архивный курс', 'public');
    await admin.query(
      `SELECT course_lesson_save_v3(
        $1,$2,$3,NULL,'Теория',NULL,$4::jsonb,'material',NULL,10,NULL
      )`,
      [
        principalId,
        courseId,
        sectionId,
        JSON.stringify([{ id: 'intro', type: 'paragraph', text: 'Содержание курса' }]),
      ],
    );
    const revision = Number(
      (await admin.query(`SELECT draft_revision FROM courses WHERE id=$1`, [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query(`SELECT * FROM course_publish_v3($1,$2,$3,$4)`, [
      principalId,
      courseId,
      revision,
      'archive-publish-0001',
    ]);
    expect(published.rows[0]).toMatchObject({ result_code: 'ok', version_number: 1 });

    const before = await admin.query(
      `SELECT content_is_visible('course',$1,'public',$2,$3,$4,$5,$6) AS visible`,
      [
        courseId,
        principalId,
        author.tenantId,
        colleaguePrincipalId,
        colleagueAccountId,
        colleague.tenantId,
      ],
    );
    expect(before.rows[0].visible).toBe(true);
    const currentRevision = Number(
      (await admin.query(`SELECT draft_revision FROM courses WHERE id=$1`, [courseId])).rows[0]
        .draft_revision,
    );
    const archived = await admin.query(`SELECT * FROM course_archive_set($1,$2,true,$3)`, [
      principalId,
      courseId,
      currentRevision,
    ]);
    expect(archived.rows[0].result_code).toBe('ok');
    expect(archived.rows[0].archived_at).not.toBeNull();

    const hidden = await admin.query(
      `SELECT content_is_visible('course',$1,'public',$2,$3,$4,$5,$6) AS visible`,
      [
        courseId,
        principalId,
        author.tenantId,
        colleaguePrincipalId,
        colleagueAccountId,
        colleague.tenantId,
      ],
    );
    expect(hidden.rows[0].visible).toBe(false);
    expect(
      Number(
        (await admin.query(`SELECT count(*) FROM course_versions WHERE course_id=$1`, [courseId]))
          .rows[0].count,
      ),
    ).toBe(1);

    const restored = await admin.query(`SELECT * FROM course_archive_set($1,$2,false,$3)`, [
      principalId,
      courseId,
      Number(archived.rows[0].draft_revision),
    ]);
    expect(restored.rows[0]).toMatchObject({ result_code: 'ok', archived_at: null });
  });

  it('returns exact prepublish path for empty material and legacy assignment', async () => {
    const { courseId, sectionId } = await newCourse('Валидация курса');
    const empty = await admin.query(
      `SELECT course_lesson_save_v3(
        $1,$2,$3,NULL,'Пустой материал',NULL,'[]'::jsonb,'material',NULL,10,NULL
      ) AS id`,
      [principalId, courseId, sectionId],
    );
    const emptyLessonId = empty.rows[0].id as string;
    let revision = Number(
      (await admin.query(`SELECT draft_revision FROM courses WHERE id=$1`, [courseId])).rows[0]
        .draft_revision,
    );
    const rejectedEmpty = await admin.query(`SELECT * FROM course_publish_v3($1,$2,$3,$4)`, [
      principalId,
      courseId,
      revision,
      'validate-publish-0001',
    ]);
    expect(rejectedEmpty.rows[0]).toMatchObject({
      result_code: 'prepublish_invalid',
      problem_kind: 'lesson',
      problem_id: emptyLessonId,
    });
    expect(rejectedEmpty.rows[0].problem_path).toContain('Пустой материал');
    expect(rejectedEmpty.rows[0].problem_message).toContain('Добавьте содержание');
    await admin.query(
      `SELECT course_lesson_save_v3(
        $1,$2,$3,$4,'Пустой материал',NULL,$5::jsonb,'material',NULL,10,NULL
      )`,
      [
        principalId,
        courseId,
        sectionId,
        emptyLessonId,
        JSON.stringify([{ id: 'text', type: 'paragraph', text: 'Готово' }]),
      ],
    );
    const legacy = await admin.query(
      `INSERT INTO teacher_assignments
        (tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES($1,$2,'Старое задание','legacy','electronics','private') RETURNING id`,
      [author.tenantId, principalId],
    );
    const legacyLesson = await admin.query(
      `SELECT course_lesson_save_v3(
        $1,$2,$3,NULL,'Legacy практика',NULL,'[]'::jsonb,'assignment',$4,20,NULL
      ) AS id`,
      [principalId, courseId, sectionId, legacy.rows[0].id],
    );
    revision = Number(
      (await admin.query(`SELECT draft_revision FROM courses WHERE id=$1`, [courseId])).rows[0]
        .draft_revision,
    );
    const rejectedLegacy = await admin.query(`SELECT * FROM course_publish_v3($1,$2,$3,$4)`, [
      principalId,
      courseId,
      revision,
      'validate-publish-0002',
    ]);
    expect(rejectedLegacy.rows[0]).toMatchObject({
      result_code: 'prepublish_invalid',
      problem_kind: 'lesson',
      problem_id: legacyLesson.rows[0].id,
    });
    expect(rejectedLegacy.rows[0].problem_path).toContain('Legacy практика');
    expect(rejectedLegacy.rows[0].problem_message).toContain('опубликованный материал');
  });
});
