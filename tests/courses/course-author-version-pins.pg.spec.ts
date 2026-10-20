import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CoursesController } from '../../apps/api/dist/courses.controller.js';
import type { PublishedAuthorVersion } from '../../apps/web/src/api';
import { courseVersionChanges } from '../../apps/web/src/components/course-version-diff';
import {
  ActiveContextUseCase,
  createSessionToken,
  hashSessionToken,
  PgAccountDirectory,
  PgSessionStore,
  PgSessionV2Store,
} from '../../contexts/identity/dist/index.js';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool, app: pg.Pool, author: SeededTeacher, other: SeededTeacher;
let principal: string, account: string, otherPrincipal: string, otherAccount: string;
let courseId: string, versionId: string, otherCourseId: string, runId: string;
let project: Activity, manual: Activity, foreign: Activity, crossTenant: Activity;
let originalOutline: Record<string, unknown>;
const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};
type Activity = { id: string; version: string; revision: number };
type Pin = {
  pointer: string;
  pin_kind: 'manual' | 'project';
  available: boolean;
  activity_id: string | null;
  version_id: string | null;
  version_number: number | null;
  title: string | null;
  instructions: string | null;
  goal: string | null;
  goal_snapshot_present: boolean | null;
  blocks: unknown;
  blocks_snapshot_present: boolean | null;
  module_key: string | null;
  result_mode: string | null;
  max_points: number | null;
  policy_snapshot: unknown;
  content_digest: string | null;
};
async function tx<T>(tenant: string, execute: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    const result = await execute(client);
    await client.query('COMMIT');
    return result;
  } catch (problem) {
    await client.query('ROLLBACK');
    throw problem;
  } finally {
    client.release();
  }
}
async function publishActivity(
  kind: 'manual' | 'project',
  owner = principal,
  tenant = author.tenantId,
): Promise<Activity> {
  const created = (
    await tx(tenant, (c) =>
      c.query(
        "SELECT * FROM learning_activity_create($1,$2,'school','private',$3,$4,'Точные условия версии 1',$5,NULL,$6::jsonb,$7,NULL,NULL,NULL,$8,'null'::jsonb,$9::jsonb)",
        [
          owner,
          tenant,
          kind,
          kind === 'project' ? 'Схема' : 'Памятка',
          kind === 'project' ? 'completion' : 'ungraded',
          JSON.stringify(policies),
          kind === 'project' ? 'electronics' : null,
          randomUUID(),
          JSON.stringify([{ type: 'paragraph', text: 'Исторический материал' }]),
        ],
      ),
    )
  ).rows[0];
  expect(created.result_code).toBe('ok');
  const published = (
    await tx(tenant, (c) =>
      c.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        owner,
        tenant,
        created.activity_id,
        randomUUID(),
      ]),
    )
  ).rows[0];
  expect(published.result_code).toBe('ok');
  return { id: created.activity_id, version: published.activity_version_id, revision: 1 };
}
async function pins(
  course = courseId,
  version = versionId,
  owner = principal,
  tenant = author.tenantId,
): Promise<Pin[]> {
  return (
    await tx(tenant, (c) =>
      c.query<Pin>('SELECT * FROM course_author_version_pins($1,$2,$3)', [owner, course, version]),
    )
  ).rows;
}
// Create separate historical fixtures. Never UPDATE an immutable release to
// fabricate a damaged/legacy outline or change the version used by a real Run.
async function historical(outline: unknown): Promise<string> {
  const row = (
    await admin.query(
      `INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
     SELECT $1,$2,coalesce(max(version_number),0)+1,'Исторический курс',$3::jsonb,md5($3::jsonb::text),$4
     FROM course_versions WHERE course_id=$2 RETURNING id`,
      [author.tenantId, courseId, JSON.stringify(outline), principal],
    )
  ).rows[0];
  return row.id;
}
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  author = await seedTeacher(admin, 'history-owner');
  other = await seedTeacher(admin, 'history-other');
  const identity = async (person: SeededTeacher) =>
    (
      await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [person.tenantId, person.teacherId],
      )
    ).rows[0];
  const own = await identity(author),
    mate = await identity(other);
  principal = own.principal_id;
  account = own.account_id;
  otherPrincipal = mate.principal_id;
  otherAccount = mate.account_id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role) SELECT $1,id,'educator' FROM workspaces WHERE tenant_id=$2 AND kind='organization'",
    [otherAccount, author.tenantId],
  );
  project = await publishActivity('project');
  manual = await publishActivity('manual');
  foreign = await publishActivity('project', otherPrincipal);
  crossTenant = await publishActivity('project', otherPrincipal, other.tenantId);
  courseId = (
    await admin.query(
      "INSERT INTO courses(tenant_id,owner_principal_id,title) VALUES($1,$2,'Исторический курс') RETURNING id",
      [author.tenantId, principal],
    )
  ).rows[0].id;
  otherCourseId = (
    await admin.query(
      "INSERT INTO courses(tenant_id,owner_principal_id,title) VALUES($1,$2,'Чужой курс') RETURNING id",
      [author.tenantId, otherPrincipal],
    )
  ).rows[0].id;
  const section = (
    await admin.query(
      "INSERT INTO course_sections(tenant_id,course_id,title,position) VALUES($1,$2,'Раздел',1) RETURNING id",
      [author.tenantId, courseId],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO course_lessons(tenant_id,course_id,section_id,title,kind,blocks,position) VALUES($1,$2,$3,'Теория и практика','material',$4::jsonb,1)",
    [
      author.tenantId,
      courseId,
      section,
      JSON.stringify([
        { id: 'intro', type: 'paragraph', text: 'Начало' },
        { id: 'practice', type: 'activity', learningActivityVersionId: project.version },
        { id: 'manual', type: 'manual-material', learningActivityVersionId: manual.version },
      ]),
    ],
  );
  await admin.query(
    "INSERT INTO course_lessons(tenant_id,course_id,section_id,title,kind,blocks,learning_activity_version_id,position) VALUES($1,$2,$3,'Урок с практикой','assignment','[]',$4,2)",
    [author.tenantId, courseId, section, project.version],
  );
  const revision = (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId]))
    .rows[0].draft_revision;
  const released = (
    await tx(author.tenantId, (c) =>
      c.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principal,
        courseId,
        revision,
        randomUUID(),
      ]),
    )
  ).rows[0];
  expect(released.result_code).toBe('ok');
  versionId = released.version_id;
  originalOutline = (
    await admin.query('SELECT outline FROM course_versions WHERE id=$1', [versionId])
  ).rows[0].outline;
  const classroom = (
    await admin.query(
      "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Историческая выдача',$4) RETURNING id",
      [author.tenantId, author.schoolId, author.periodId, author.teacherId],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [author.tenantId, classroom, author.teacherId, account],
  );
  const assigned = (
    await tx(author.tenantId, (c) =>
      c.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'whole_class',ARRAY[]::uuid[],$4)",
        [principal, classroom, courseId, randomUUID()],
      ),
    )
  ).rows[0];
  expect(assigned.result_code).toBe('ok');
  runId = assigned.run_id;
});
afterAll(async () => {
  await Promise.all([admin?.end(), app?.end()]);
});

it('reads exact published lesson, project-block and manual-block pins after a policy-only future publication', async () => {
  const before = await pins();
  expect(before.map((row) => [row.pointer, row.pin_kind, row.available])).toEqual([
    ['/sections/0/lessons/0/blocks/1', 'project', true],
    ['/sections/0/lessons/0/blocks/2', 'manual', true],
    ['/sections/0/lessons/1/assignment', 'project', true],
  ]);
  expect(before[0]).toMatchObject({
    activity_id: project.id,
    version_id: project.version,
    version_number: 1,
    title: 'Схема',
    instructions: 'Точные условия версии 1',
    module_key: 'electronics',
    policy_snapshot: policies,
  });
  expect(before[1]).toMatchObject({
    activity_id: manual.id,
    version_id: manual.version,
    result_mode: 'ungraded',
    module_key: null,
  });
  const saved = (
    await tx(author.tenantId, (c) =>
      c.query(
        "SELECT * FROM learning_activity_draft_put($1,$2,$3,$4,'Схема','Точные условия версии 1','completion',NULL,$5::jsonb,'electronics',NULL,NULL,'null'::jsonb,$6::jsonb)",
        [
          principal,
          author.tenantId,
          project.id,
          project.revision,
          JSON.stringify({ ...policies, attemptPolicy: { maxAttempts: 2 } }),
          JSON.stringify([{ type: 'paragraph', text: 'Исторический материал' }]),
        ],
      ),
    )
  ).rows[0];
  expect(saved.result_code).toBe('ok');
  const later = (
    await tx(author.tenantId, (c) =>
      c.query('SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)', [
        principal,
        author.tenantId,
        project.id,
        saved.draft_revision,
        randomUUID(),
      ]),
    )
  ).rows[0];
  expect(later).toMatchObject({ result_code: 'ok', version_number: 2 });
  expect(later.activity_version_id).not.toBe(project.version);
  expect(await pins()).toEqual(before);
});

it.each([false, true])(
  'preserves pre-blocks history with goal snapshot present=%s through the actual restricted API and OpenAPI contract',
  async (goalPresent) => {
    const created = (
      await tx(author.tenantId, (client) =>
        client.query(
          "SELECT * FROM learning_activity_create($1,$2,'school','private','project','Историческая практика','Сохранённая инструкция','completion',NULL,$3::jsonb,'electronics',NULL,NULL,NULL,$4,'null'::jsonb,'[]'::jsonb)",
          [principal, author.tenantId, JSON.stringify(policies), randomUUID()],
        ),
      )
    ).rows[0];
    expect(created.result_code).toBe('ok');
    // INSERT a separate valid canonical row with the exact snapshot fields of
    // the 0163 (goal absent) or 0168 (goal present) publisher. The 0169 blocks
    // columns retain their migration defaults. Never UPDATE a frozen version.
    const old = (
      await admin.query(
        `WITH historical_snapshot AS (
          SELECT activity.*, jsonb_build_object(
            'activityId',activity.id,'versionNumber',1,
            'kind',draft_payload->>'kind','title',draft_payload->>'title',
            'instructions',draft_payload->'instructions',
            'resultMode',draft_payload->>'resultMode','maxPoints',draft_payload->'maxPoints',
            'policies',draft_payload->'policies','moduleKey',draft_payload->'moduleKey',
            'quizVersionId',draft_payload->'quizVersionId',
            'starterProjectVersionId',draft_payload->'starterProjectVersionId','sample',NULL,
            'provenance',jsonb_build_object(
              'authoringOrigin',authoring_origin,'sourceVersionId',draft_base_version_id,
              'sourceTeacherAssignmentId',source_teacher_assignment_id,
              'sourceDraftRevision',draft_revision)
          ) || CASE WHEN $4 THEN jsonb_build_object('goal',NULL) ELSE '{}'::jsonb END AS snapshot
          FROM learning_activities activity WHERE id=$1 AND tenant_id=$2
        )
        INSERT INTO learning_activity_versions (
          tenant_id,activity_id,version_number,title,instructions,activity_type,module_key,
          max_points,scoring_policy,content_digest,canonical_kind,result_mode,policy_snapshot,
          quiz_version_id,starter_project_version_id,provenance,source_draft_revision,
          publication_request_id,published_by_principal_id,canonical_contract_version,
          goal,goal_snapshot_present
        ) SELECT tenant_id,id,1,draft_payload->>'title',draft_payload->>'instructions',
          'project','electronics',NULL,jsonb_build_object('kind','canonical','resultMode','completion'),
          learning_activity_snapshot_digest(snapshot),'project','completion',draft_payload->'policies',
          NULL,NULL,snapshot->'provenance',draft_revision,$3,owner_principal_id,1,NULL,$4
          FROM historical_snapshot RETURNING *`,
        [created.activity_id, author.tenantId, randomUUID(), goalPresent],
      )
    ).rows[0];
    expect(old).toMatchObject({
      canonical_contract_version: 1,
      goal: null,
      goal_snapshot_present: goalPresent,
      blocks: null,
      blocks_snapshot_present: false,
      instructions: 'Сохранённая инструкция',
      policy_snapshot: policies,
    });
    const saved = (
      await tx(author.tenantId, (client) =>
        client.query(
          "SELECT * FROM learning_activity_draft_put($1,$2,$3,1,'Историческая практика',NULL,'completion',NULL,$4::jsonb,'electronics',NULL,NULL,'null'::jsonb,'[]'::jsonb)",
          [
            principal,
            author.tenantId,
            created.activity_id,
            JSON.stringify({ ...policies, attemptPolicy: { maxAttempts: 2 } }),
          ],
        ),
      )
    ).rows[0];
    expect(saved.result_code).toBe('ok');
    const latest = (
      await tx(author.tenantId, (client) =>
        client.query('SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)', [
          principal,
          author.tenantId,
          created.activity_id,
          saved.draft_revision,
          randomUUID(),
        ]),
      )
    ).rows[0];
    expect(latest).toMatchObject({ result_code: 'ok', version_number: 2 });
    const sectionId = randomUUID(),
      lessonId = randomUUID();
    const outline = (activityVersion: string) => ({
      course: { title: 'История снимков', summary: null },
      sections: [
        {
          sourceSectionId: sectionId,
          title: 'Раздел',
          summary: null,
          lessons: [
            {
              sourceLessonId: lessonId,
              title: 'Практика',
              kind: 'assignment',
              learningActivityVersionId: activityVersion,
              blocks: [],
            },
          ],
        },
      ],
    });
    const beforeId = await historical(outline(old.id));
    const afterId = await historical(outline(latest.activity_version_id));
    const oldPins = await pins(courseId, beforeId);
    expect(oldPins).toEqual([
      expect.objectContaining({
        available: true,
        activity_id: created.activity_id,
        version_id: old.id,
        goal: null,
        goal_snapshot_present: goalPresent,
        blocks: null,
        blocks_snapshot_present: false,
        instructions: 'Сохранённая инструкция',
        policy_snapshot: policies,
        content_digest: old.content_digest,
      }),
    ]);
    expect(await pins(courseId, afterId)).toEqual([
      expect.objectContaining({
        available: true,
        version_id: latest.activity_version_id,
        goal: null,
        goal_snapshot_present: true,
        blocks: [],
        blocks_snapshot_present: true,
      }),
    ]);

    // Real session/account adapters, real controller query, restricted PG role:
    // neither authentication results nor history descriptors are mocked.
    const accounts = new PgAccountDirectory(app);
    const actor = await accounts.accountForUser(author.tenantId, author.teacherId);
    expect(actor?.principalId).toBe(principal);
    const token = createSessionToken();
    const sessions = new PgSessionV2Store(app);
    await sessions.create(principal, actor!.workspaceId, hashSessionToken(token), 1);
    try {
      const controller = new CoursesController(
        new ActiveContextUseCase(sessions, new PgSessionStore(app), accounts),
        accounts,
        app,
      );
      const response = await controller.versions(
        { cookies: { asa_session: token } } as unknown as FastifyRequest,
        courseId,
      );
      const document = parse(readFileSync('schemas/openapi.yaml', 'utf8')) as {
        components: { schemas: Record<string, unknown> };
        paths: Record<
          string,
          {
            get: {
              responses: Record<
                string,
                {
                  content: { 'application/json': { schema: Record<string, unknown> } };
                }
              >;
            };
          }
        >;
      };
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile({
        ...document.paths['/api/courses/{courseId}/versions']!.get.responses['200']!.content[
          'application/json'
        ].schema,
        components: document.components,
      });
      expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
      const before = response.items.find((version) => version.id === beforeId)!;
      const after = response.items.find((version) => version.id === afterId)!;
      expect(before.pinnedActivities).toEqual([
        expect.objectContaining({
          available: true,
          versionId: old.id,
          goal: null,
          goalSnapshotPresent: goalPresent,
          blocks: null,
          blocksSnapshotPresent: false,
          instructions: 'Сохранённая инструкция',
          policySnapshot: policies,
          contentDigest: old.content_digest,
        }),
      ]);
      expect(after.pinnedActivities).toEqual([
        expect.objectContaining({
          available: true,
          versionId: latest.activity_version_id,
          goal: null,
          goalSnapshotPresent: true,
          blocks: [],
          blocksSnapshotPresent: true,
        }),
      ]);
      expect(before.outline).toEqual(outline(old.id));
      const changes = courseVersionChanges(
        before as PublishedAuthorVersion,
        after as PublishedAuthorVersion,
      );
      expect(
        changes.filter((change) => change.kind === 'unavailable').map((change) => change.field),
      ).toEqual(goalPresent ? ['Материалы задания'] : ['Цель задания', 'Материалы задания']);
      expect(changes).toContainEqual(
        expect.objectContaining({
          field: 'Попытки и время выполнения · Число попыток',
          before: { state: 'value', value: 1 },
          after: { state: 'value', value: 2 },
        }),
      );
      expect(changes).toContainEqual(
        expect.objectContaining({
          field: 'Инструкция задания',
          before: { state: 'value', value: 'Сохранённая инструкция' },
          after: { state: 'null' },
        }),
      );
      expect(
        (await admin.query('SELECT * FROM learning_activity_versions WHERE id=$1', [old.id]))
          .rows[0],
      ).toEqual(old);
    } finally {
      await sessions.revoke(hashSessionToken(token));
    }
  },
);

it('does not disclose foreign course/version pairs, another owner or a random exact version', async () => {
  expect(await pins(otherCourseId)).toEqual([]);
  expect(await pins(courseId, randomUUID())).toEqual([]);
  expect(await pins(courseId, versionId, otherPrincipal)).toEqual([]);
  expect(await pins(courseId, versionId, otherPrincipal, other.tenantId)).toEqual([]);
  expect(
    (
      await tx(author.tenantId, (c) =>
        c.query('SELECT * FROM course_author_versions($1,$2)', [otherPrincipal, courseId]),
      )
    ).rows,
  ).toEqual([]);
});

it('marks foreign, wrong-kind, missing and malformed historical pins unavailable without metadata or exceptions', async () => {
  const references: unknown[] = [
    foreign.version,
    crossTenant.version,
    manual.version,
    randomUUID(),
    'not-a-uuid',
    42,
    { id: project.version },
    null,
  ];
  const id = await historical({
    sections: [
      {
        lessons: [
          ...references.map((reference) => ({
            kind: 'assignment',
            learningActivityVersionId: reference,
          })),
          { kind: 'assignment', assignment: { sourceAssignmentId: randomUUID(), title: 'Legacy' } },
          {
            kind: 'material',
            blocks: [
              { type: 'activity', learningActivityVersionId: foreign.version },
              { type: 'manual-material', learningActivityVersionId: project.version },
            ],
          },
        ],
      },
    ],
  });
  const rows = await pins(courseId, id);
  expect(rows).toHaveLength(11);
  for (const row of rows) {
    expect(row.available).toBe(false);
    expect(row.pointer).toMatch(/^\/sections\/0\/lessons\/\d+\/(assignment|blocks\/\d+)$/);
    const metadata = Object.entries(row).filter(
      ([key]) => !['pointer', 'pin_kind', 'available'].includes(key),
    );
    expect(metadata.map(([, value]) => value)).toEqual(Array(14).fill(null));
  }
  for (const sections of [
    null,
    {},
    'bad',
    [null, { lessons: {} }, { lessons: [null, { blocks: 'bad' }] }],
  ]) {
    expect(await pins(courseId, await historical({ sections }))).toEqual([]);
  }
  const legacyPointer = await historical({
    sections: [
      {
        lessons: [
          { kind: 'assignment', assignment: { learningActivityVersionId: project.version } },
        ],
      },
    ],
  });
  expect(await pins(courseId, legacyPointer)).toEqual([
    expect.objectContaining({
      pointer: '/sections/0/lessons/0/assignment',
      available: true,
      version_id: project.version,
    }),
  ]);
});

it('denies both historical outline and pins when current author authority or membership is revoked', async () => {
  await admin.query(
    "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='educator'",
    [account],
  );
  try {
    expect(await pins()).toEqual([]);
    expect(
      (
        await tx(author.tenantId, (c) =>
          c.query('SELECT * FROM course_author_versions($1,$2)', [principal, courseId]),
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await admin.query(
      "UPDATE capability_grants SET state='verified' WHERE account_id=$1 AND capability='educator'",
      [account],
    );
  }
  const memberships = (
    await admin.query(
      'DELETE FROM workspace_memberships WHERE account_id=$1 RETURNING workspace_id,role',
      [account],
    )
  ).rows;
  try {
    expect(await pins()).toEqual([]);
  } finally {
    for (const membership of memberships)
      await admin.query(
        'INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,$3)',
        [account, membership.workspace_id, membership.role],
      );
  }
  expect(await pins()).toHaveLength(3);
});

it('keeps owned archived history readable and leaves immutable snapshots, runs and learner/runtime rows unchanged', async () => {
  await admin.query('UPDATE learning_activities SET archived_at=now() WHERE id=ANY($1::uuid[])', [
    [project.id, manual.id],
  ]);
  await admin.query('UPDATE courses SET archived_at=now() WHERE id=$1', [courseId]);
  const snapshot = async () =>
    (
      await admin.query(
        `SELECT jsonb_build_object(
       'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM course_versions v WHERE tenant_id=$1),
       'activities',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM learning_activity_versions v WHERE tenant_id=$1),
       'runs',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM classroom_course_runs v WHERE tenant_id=$1),
       'lessons',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM classroom_course_run_lessons v WHERE tenant_id=$1),
       'activityRuns',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM activity_runs v WHERE tenant_id=$1),
       'attempts',(SELECT count(*) FROM learning_attempts WHERE tenant_id=$1),
       'submissions',(SELECT count(*) FROM learning_submissions WHERE tenant_id=$1),
       'evaluations',(SELECT count(*) FROM learning_evaluations WHERE tenant_id=$1),
       'results',(SELECT count(*) FROM assessment_results WHERE tenant_id=$1),
       'projects',(SELECT count(*) FROM projects WHERE tenant_id=$1)
     ) AS snapshot`,
        [author.tenantId],
      )
    ).rows[0].snapshot;
  const before = await snapshot();
  expect(before.runs).toContainEqual(
    expect.objectContaining({ id: runId, course_version_id: versionId }),
  );
  expect(before.activityRuns.length).toBeGreaterThan(0);
  expect((await pins()).every((row) => row.available)).toBe(true);
  const history = (
    await tx(author.tenantId, (c) =>
      c.query('SELECT * FROM course_author_versions($1,$2)', [principal, courseId]),
    )
  ).rows;
  expect(history.find((version) => version.id === versionId).outline).toEqual(originalOutline);
  expect(await snapshot()).toEqual(before);
});

it('exposes only STABLE guarded readers to the restricted role while keeping FORCE RLS and immutable table grants', async () => {
  const result = await admin.query(`SELECT p.proname,p.provolatile,p.prosecdef,p.proconfig,
    has_function_privilege('asalab_app',p.oid,'EXECUTE') AS app_execute,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('course_author_versions','course_author_version_pins') ORDER BY p.proname`);
  expect(result.rows).toHaveLength(2);
  for (const row of result.rows)
    expect(row).toMatchObject({
      provolatile: 's',
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, pg_temp'],
      app_execute: true,
      public_execute: false,
    });
  const protectedTables = await admin.query(`SELECT relname,relrowsecurity,relforcerowsecurity,
    has_table_privilege('asalab_app',oid,'UPDATE') AS app_update,
    has_table_privilege('asalab_app',oid,'DELETE') AS app_delete
    FROM pg_class WHERE oid IN ('public.course_versions'::regclass,'public.learning_activity_versions'::regclass) ORDER BY relname`);
  expect(protectedTables.rows).toHaveLength(2);
  for (const row of protectedTables.rows)
    expect(row).toMatchObject({
      relrowsecurity: true,
      relforcerowsecurity: true,
      app_update: false,
      app_delete: false,
    });
});
