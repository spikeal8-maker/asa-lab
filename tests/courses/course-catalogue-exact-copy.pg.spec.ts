import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool, app: pg.Pool, author: SeededTeacher, mate: SeededTeacher;
let authorId: string, mateId: string, mateAccount: string;
const policies = {
  attemptPolicy: null,
  resultSelectionPolicy: null,
  completionPolicy: null,
  latePolicy: null,
  assessmentPolicy: null,
  feedbackReleasePolicy: null,
};
const image = Buffer.from('Library exact image'),
  pdf = Buffer.from('%PDF-1.4\nLibrary exact PDF');
async function tx<T>(tenant: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
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
  author = await seedTeacher(admin, 'catalogue-exact-author');
  mate = await seedTeacher(admin, 'catalogue-exact-mate');
  const who = async (person: SeededTeacher) =>
    (
      await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [person.tenantId, person.teacherId],
      )
    ).rows[0];
  authorId = (await who(author)).principal_id;
  const other = await who(mate);
  mateId = other.principal_id;
  mateAccount = other.account_id;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});
async function activity(
  kind: 'manual' | 'project',
  module: string | null,
  title: string,
  withMedia = false,
) {
  const created = (
    await tx(author.tenantId, (c) =>
      c.query(
        "SELECT * FROM learning_activity_create($1,$2,'school','private',$3,$4,'Exact instructions',$5,NULL,$6::jsonb,$7,NULL,NULL,NULL,$8,'null'::jsonb,'[]'::jsonb)",
        [
          authorId,
          author.tenantId,
          kind,
          title,
          kind === 'manual' ? 'ungraded' : 'completion',
          JSON.stringify(policies),
          module,
          randomUUID(),
        ],
      ),
    )
  ).rows[0];
  expect(created.result_code).toBe('ok');
  const id = created.activity_id as string;
  const blocks: Array<Record<string, unknown>> = [{ type: 'paragraph', text: 'Exact content' }];
  const media: Array<{ role: string; bytes: Buffer; type: string }> = withMedia
    ? [
        { role: 'task-image', bytes: image, type: 'image/png' },
        { role: 'task-file', bytes: pdf, type: 'application/pdf' },
      ]
    : kind === 'project'
      ? [{ role: 'sample', bytes: image, type: 'image/png' }]
      : [];
  for (const item of media) {
    const row = (
      await admin.query(
        "INSERT INTO learning_activity_draft_media(tenant_id,activity_id,role,bytes,content_type,content_hash) VALUES($1,$2,$3,$4,$5,encode(digest($4,'sha256'),'hex')) RETURNING content_hash",
        [author.tenantId, id, item.role, item.bytes, item.type],
      )
    ).rows[0];
    if (item.role === 'task-image')
      blocks.push({ type: 'image', alt: 'Exact image', contentHash: row.content_hash });
    if (item.role === 'task-file')
      blocks.push({ type: 'file', name: 'exact.pdf', contentHash: row.content_hash });
  }
  const saved = (
    await tx(author.tenantId, (c) =>
      c.query(
        "SELECT * FROM learning_activity_draft_put($1,$2,$3,1,$4,'Exact instructions',$5,NULL,$6::jsonb,$7,NULL,NULL,'null'::jsonb,$8::jsonb)",
        [
          authorId,
          author.tenantId,
          id,
          title,
          kind === 'manual' ? 'ungraded' : 'completion',
          JSON.stringify(policies),
          module,
          JSON.stringify(blocks),
        ],
      ),
    )
  ).rows[0];
  expect(saved.result_code).toBe('ok');
  const publish = async (revision: number) =>
    (
      await tx(author.tenantId, (c) =>
        c.query('SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)', [
          authorId,
          author.tenantId,
          id,
          revision,
          randomUUID(),
        ]),
      )
    ).rows[0];
  const v1 = await publish(saved.draft_revision);
  expect(v1.result_code).toBe('ok');
  return {
    id,
    version: v1.activity_version_id as string,
    revision: saved.draft_revision as number,
    blocks,
    publish,
  };
}
async function fixture() {
  const project = await activity('project', 'electronics', 'Electronics v1');
  const changed = (
    await tx(author.tenantId, (c) =>
      c.query(
        "SELECT * FROM learning_activity_draft_put($1,$2,$3,$4,'Electronics v2','New text','completion',NULL,$5::jsonb,'electronics',NULL,NULL,'null'::jsonb,$6::jsonb)",
        [
          authorId,
          author.tenantId,
          project.id,
          project.revision,
          JSON.stringify(policies),
          JSON.stringify(project.blocks),
        ],
      ),
    )
  ).rows[0];
  expect(changed.result_code).toBe('ok');
  const newer = await project.publish(changed.draft_revision);
  expect(newer.result_code).toBe('ok');
  const three = await activity('project', 'three-d', '3D v1'),
    manual = await activity('manual', null, 'Manual v1', true);
  const course = (
    await admin.query(
      "INSERT INTO courses(tenant_id,owner_principal_id,title,visibility) VALUES($1,$2,'Exact Library course','public') RETURNING id,draft_revision",
      [author.tenantId, authorId],
    )
  ).rows[0];
  const section = (
    await admin.query(
      "INSERT INTO course_sections(tenant_id,course_id,title,position) VALUES($1,$2,'Mixed',1) RETURNING id",
      [author.tenantId, course.id],
    )
  ).rows[0];
  const lesson = (
    await admin.query(
      "INSERT INTO course_lessons(tenant_id,course_id,section_id,title,blocks,kind,position) VALUES($1,$2,$3,'Mixed', $4::jsonb,'material',1) RETURNING id",
      [
        author.tenantId,
        course.id,
        section.id,
        JSON.stringify([
          { id: 'text', type: 'paragraph', text: 'Before' },
          { id: 'e1', type: 'activity', learningActivityVersionId: project.version },
          { id: 'm', type: 'manual-material', learningActivityVersionId: manual.version },
          { id: 'e2', type: 'activity', learningActivityVersionId: newer.activity_version_id },
          { id: '3d', type: 'activity', learningActivityVersionId: three.version },
        ]),
      ],
    )
  ).rows[0];
  await admin.query(
    "INSERT INTO course_lessons(tenant_id,course_id,section_id,title,blocks,kind,learning_activity_version_id,position) VALUES($1,$2,$3,'Lesson project','[]','assignment',$4,2)",
    [author.tenantId, course.id, section.id, three.version],
  );
  const revision = (
    await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [course.id])
  ).rows[0].draft_revision;
  const release = (
    await tx(author.tenantId, (c) =>
      c.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        authorId,
        course.id,
        revision,
        randomUUID(),
      ]),
    )
  ).rows[0];
  expect(release.result_code).toBe('ok');
  const hash = (
    await admin.query('SELECT content_hash FROM course_versions WHERE id=$1', [release.version_id])
  ).rows[0].content_hash as string;
  return {
    course: course.id as string,
    version: release.version_id as string,
    hash,
    lesson: lesson.id as string,
    manual,
    project,
    three,
  };
}
function take(
  source: { course: string; version: string; hash: string },
  request = randomUUID(),
  destination = mate.tenantId,
) {
  return tx(mate.tenantId, (c) =>
    c.query('SELECT * FROM course_catalogue_take_v2($1,$2,$3,$4,$5,$6,$7,$8)', [
      mateId,
      mateAccount,
      mate.tenantId,
      source.course,
      source.version,
      source.hash,
      request,
      destination,
    ]),
  );
}
it('copies exact viewed v1 with distinct versions of one root, independent media and receipt replay after revoke', async () => {
  const source = await fixture();
  await admin.query("UPDATE course_lessons SET title='Author v2' WHERE id=$1", [source.lesson]);
  const revision = (
    await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [source.course])
  ).rows[0].draft_revision;
  expect(
    (
      await tx(author.tenantId, (c) =>
        c.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
          authorId,
          source.course,
          revision,
          randomUUID(),
        ]),
      )
    ).rows[0].version_number,
  ).toBe(2);
  const request = randomUUID(),
    copy = (await take(source, request)).rows[0];
  expect(copy).toMatchObject({
    result_code: 'ok',
    source_version_id: source.version,
    source_version_number: 1,
    reused: false,
  });
  const lessons = (
    await admin.query(
      'SELECT title,blocks,learning_activity_version_id FROM course_lessons WHERE course_id=$1 ORDER BY position',
      [copy.id],
    )
  ).rows;
  expect(lessons[0].title).toBe('Mixed');
  expect(lessons[0].blocks.map((b: { id: string }) => b.id)).toEqual([
    'text',
    'e1',
    'm',
    'e2',
    '3d',
  ]);
  const pins = lessons[0].blocks
    .slice(1)
    .map((b: { learningActivityVersionId: string }) => b.learningActivityVersionId);
  expect(new Set(pins).size).toBe(4);
  expect(lessons[1].learning_activity_version_id).toBe(pins[3]);
  const own = (
    await admin.query(
      'SELECT v.id,v.title,a.owner_principal_id,a.tenant_id FROM learning_activity_versions v JOIN learning_activities a ON a.id=v.activity_id WHERE v.id=ANY($1::uuid[])',
      [pins],
    )
  ).rows;
  expect(own).toHaveLength(4);
  expect(
    own.every((row) => row.owner_principal_id === mateId && row.tenant_id === mate.tenantId),
  ).toBe(true);
  expect(own.map((row) => row.title)).toEqual(
    expect.arrayContaining(['Electronics v1', 'Electronics v2', 'Manual v1', '3D v1']),
  );
  const exactContent = (
    await admin.query(
      'SELECT original.instructions original_instructions,original.blocks original_blocks,copy.instructions,copy.blocks FROM learning_activity_versions original CROSS JOIN learning_activity_versions copy WHERE original.id=$1 AND copy.id=$2',
      [source.manual.version, pins[1]],
    )
  ).rows[0];
  expect(exactContent.instructions).toBe(exactContent.original_instructions);
  expect(exactContent.blocks).toEqual(exactContent.original_blocks);
  const media = (
    await admin.query(
      'SELECT role,bytes,content_hash FROM learning_activity_version_media WHERE activity_version_id=$1 ORDER BY role',
      [pins[1]],
    )
  ).rows;
  expect(media.map((row) => row.bytes)).toEqual([pdf, image]);
  await admin.query("UPDATE courses SET visibility='private' WHERE id=$1", [source.course]);
  expect((await take(source, request)).rows[0]).toMatchObject({ id: copy.id, reused: true });
  expect((await take(source)).rows[0].result_code).toBe('not_available');
  expect((await take({ ...source, hash: 'b'.repeat(32) }, request)).rows[0].result_code).toBe(
    'idempotency_conflict',
  );
  expect(
    (
      await admin.query(
        'SELECT count(*)::int count FROM courses WHERE copied_from_course_id=$1 AND owner_principal_id=$2',
        [source.course, mateId],
      )
    ).rows[0].count,
  ).toBe(1);
  const targetRevision = (
    await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [copy.id])
  ).rows[0].draft_revision;
  expect(
    (
      await tx(mate.tenantId, (c) =>
        c.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
          mateId,
          copy.id,
          targetRevision,
          randomUUID(),
        ]),
      )
    ).rows[0].result_code,
  ).toBe('ok');
});
it('rolls back prior roots/media on an incomplete later pin and does not write a receipt', async () => {
  const source = await fixture();
  // Immutable history stays untouched; an archived source cannot create new reusable roots.
  await admin.query('UPDATE learning_activities SET archived_at=now() WHERE id=$1', [
    source.manual.id,
  ]);
  const before = (
    await admin.query(
      'SELECT count(*)::int count FROM learning_activities WHERE owner_principal_id=$1',
      [mateId],
    )
  ).rows[0].count;
  const request = randomUUID();
  expect((await take(source, request)).rows[0].result_code).toBe('copy_unavailable');
  expect(
    (
      await admin.query(
        'SELECT count(*)::int count FROM learning_activities WHERE owner_principal_id=$1',
        [mateId],
      )
    ).rows[0].count,
  ).toBe(before);
  expect(
    (
      await admin.query(
        'SELECT count(*)::int count FROM course_catalogue_copy_receipts WHERE actor_principal_id=$1 AND request_id=$2',
        [mateId, request],
      )
    ).rows[0].count,
  ).toBe(0);
  await expect(
    tx(mate.tenantId, (c) =>
      c.query('SELECT course_catalogue_clone_pin($1,$2,$3,$4)', [
        source.project.version,
        mateId,
        mate.tenantId,
        randomUUID(),
      ]),
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
it('authorizes media only through the exact visible release containing the pin and role/hash', async () => {
  const source = await fixture(),
    otherSource = await fixture();
  const hash = (
    await admin.query(
      "SELECT content_hash FROM learning_activity_version_media WHERE activity_version_id=$1 AND role='task-file'",
      [source.manual.version],
    )
  ).rows[0].content_hash;
  const media = (
    version = source.version,
    pin = source.manual.version,
    role = 'task-file',
    locator = hash,
  ) =>
    tx(mate.tenantId, (c) =>
      c.query('SELECT * FROM course_catalogue_media_v2($1,$2,$3,$4,$5,$6,$7,$8)', [
        source.course,
        version,
        pin,
        role,
        locator,
        mateId,
        mateAccount,
        mate.tenantId,
      ]),
    );
  expect((await media()).rows[0].media_bytes).toEqual(pdf);
  expect((await media(otherSource.version)).rows).toHaveLength(0);
  expect((await media(source.version, otherSource.manual.version)).rows).toHaveLength(0);
  expect((await media(source.version, source.manual.version, 'task-image')).rows).toHaveLength(0);
  expect(
    (await media(source.version, source.manual.version, 'task-file', '0'.repeat(64))).rows,
  ).toHaveLength(0);
  await admin.query("UPDATE courses SET visibility='private' WHERE id=$1", [source.course]);
  expect((await media()).rows).toHaveLength(0);
});
it('does not substitute missing immutable media or unsupported starter snapshots with empty content', async () => {
  const source = await fixture(),
    damaged = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
  const brokenBlocks = [{ type: 'file', name: 'missing.pdf', contentHash: 'f'.repeat(64) }];
  // Insert a deliberately incomplete historical publication; never mutate an immutable row.
  await admin.query(
    `INSERT INTO learning_activity_versions SELECT (jsonb_populate_record(
    NULL::learning_activity_versions,to_jsonb(version)||jsonb_build_object('id',$2::uuid,
      'version_number',999,'source_draft_revision',999,'publication_request_id',$3::text,
      'blocks',$4::jsonb))).* FROM learning_activity_versions version WHERE id=$1`,
    [source.manual.version, damaged, randomUUID(), JSON.stringify(brokenBlocks)],
  );
  await admin.query(
    `UPDATE course_lessons SET blocks=jsonb_set(blocks,'{2,learningActivityVersionId}',to_jsonb($2::text)) WHERE id=$1`,
    [source.lesson, damaged],
  );
  const revision = (
    await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [source.course])
  ).rows[0].draft_revision;
  const next = (
    await tx(author.tenantId, (c) =>
      c.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        authorId,
        source.course,
        revision,
        randomUUID(),
      ]),
    )
  ).rows[0];
  expect(next.result_code).toBe('ok');
  const hash = (
    await admin.query('SELECT content_hash FROM course_versions WHERE id=$1', [next.version_id])
  ).rows[0].content_hash;
  const count = async () =>
    (
      await admin.query(
        'SELECT count(*)::int count FROM learning_activities WHERE owner_principal_id=$1',
        [mateId],
      )
    ).rows[0].count;
  const before = await count();
  const request = randomUUID();
  expect(
    (await take({ ...source, version: next.version_id, hash }, request)).rows[0].result_code,
  ).toBe('copy_unavailable');
  expect(await count()).toBe(before);
  expect(
    (
      await admin.query(
        'SELECT count(*)::int count FROM course_catalogue_copy_receipts WHERE request_id=$1',
        [request],
      )
    ).rows[0].count,
  ).toBe(0);
  expect(
    (
      await tx(author.tenantId, (c) =>
        c.query(
          "SELECT * FROM learning_activity_create($1,$2,'school','private','project','Unsupported starter',NULL,'completion',NULL,$3::jsonb,'electronics',NULL,$4,NULL,$5)",
          [authorId, author.tenantId, JSON.stringify(policies), randomUUID(), randomUUID()],
        ),
      )
    ).rows[0].result_code,
  ).toBe('starter_project_unprovenanced');
});
