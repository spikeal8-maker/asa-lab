import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { LearningWorkReadOnlyError } from '../../contexts/projects/domain/project';
import type { CreateProjectInput } from '../../contexts/projects/application/ports';
import type { OwnerPublicationStatus } from '../../apps/api/src/public-projects.controller';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { acquireLearningSubmissionSuiteLock } from '../courses/learning-submission-suite-lock';

let admin: pg.Pool;
let runtime: pg.Pool;
let repo: PgProjectRepository;
let releaseSubmissionSuiteLock: (() => Promise<void>) | undefined;
const fixtureProjectIds: string[] = [];

beforeAll(async () => {
  // These helpers require the same isolated *_test database and different
  // admin/runtime credentials. This suite must never fall back to an emulator.
  // Real legacy submission tests must not overlap another Learning suite's
  // temporary failure trigger on learning_submissions.
  releaseSubmissionSuiteLock = await acquireLearningSubmissionSuiteLock();
  admin = testAdminPool();
  runtime = testAppPool();
  repo = new PgProjectRepository(runtime);
}, 90_000);

afterAll(async () => {
  try {
    // The subsequent browser gate shares this disposable database. Retain the
    // immutable test evidence but remove only this suite's generated Projects
    // from public discovery; its byte-comparison rasters are not real PNGs.
    if (admin && fixtureProjectIds.length > 0) {
      await admin.query(
        `UPDATE project_publication_state
            SET state='revoked',revoked_at=COALESCE(revoked_at,now())
          WHERE project_id=ANY($1::uuid[]) AND state IN ('public','unlisted')`,
        [fixtureProjectIds],
      );
    }
  } finally {
    try {
      await Promise.all([runtime?.end(), admin?.end()]);
    } finally {
      await releaseSubmissionSuiteLock?.();
    }
  }
});

async function fixture(label: string, withSnapshot = true) {
  const teacher = await seedTeacher(admin, `public-${label}`);
  const identity = await admin.query(
    `SELECT principal_id, account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  const principalId = identity.rows[0].principal_id as string;
  const accountId = identity.rows[0].account_id as string;
  const input: CreateProjectInput = {
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor: { userId: teacher.teacherId, principalId },
    moduleKey: 'electronics',
    title: `Private ${label}`,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: crypto.randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: { schemaVersion: 1, components: [], connections: [], privateMarker: label },
    initialPreview: null,
  };
  const created = await repo.createWithDraft(input);
  if (created.kind !== 'created') throw new Error(`fixture ${label} was not created`);
  fixtureProjectIds.push(created.project.id);
  const result = { teacher, principalId, accountId, input, projectId: created.project.id };
  if (withSnapshot) await snapshot(result, 1, 17);
  return result;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function snapshot(
  source: { input: CreateProjectInput; projectId: string },
  revision: number,
  byte: number,
) {
  const result = await repo.saveSnapshot({
    tenantId: source.input.tenantId,
    actor: source.input.actor,
    projectId: source.projectId,
    image: {
      bytes: new Uint8Array(64).fill(byte),
      contentType: 'image/png',
      width: 16,
      height: 16,
    },
    sourceRevision: revision,
  });
  expect(result).not.toBeNull();
}

async function publish(source: Fixture, metadata: Record<string, unknown> = {}) {
  const result = await runtime.query<{ result: OwnerPublicationStatus }>(
    'SELECT project_publication_publish($1,$2,$3::jsonb) AS result',
    [source.principalId, source.projectId, JSON.stringify(metadata)],
  );
  const status = result.rows[0].result;
  if (!status.publication) throw new Error('successful publication did not return its identity');
  expect(status.publication.state).toBe('public');
  expect(status.publication.publicPath).toBe(
    `#/public-projects/${status.publication.publicationId}`,
  );
  return status.publication;
}

async function ownerStatus(source: Fixture) {
  const result = await runtime.query<{ result: OwnerPublicationStatus }>(
    'SELECT project_publication_status($1,$2) AS result',
    [source.principalId, source.projectId],
  );
  return result.rows[0].result;
}

async function publicRead(publicationId: string) {
  return runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [publicationId]);
}

async function publicImage(publicationId: string, revisionId: string | null = null) {
  return runtime.query<{ image: Buffer; content_type: string }>(
    'SELECT * FROM public_project_image($1,$2)',
    [publicationId, revisionId],
  );
}

async function counts(source: Fixture) {
  const result = await admin.query(
    `SELECT
       (SELECT count(*)::integer FROM project_versions WHERE project_id=$1) AS versions,
       (SELECT count(*)::integer FROM project_publication_revisions WHERE project_id=$1) AS revisions,
       (SELECT count(*)::integer FROM project_publication_state WHERE project_id=$1) AS states`,
    [source.projectId],
  );
  return result.rows[0];
}

async function collection(owner: Fixture, source: Fixture) {
  const created = await runtime.query('SELECT collection_create($1,$2) AS id', [
    owner.principalId,
    `Collection ${crypto.randomUUID()}`,
  ]);
  const id = created.rows[0].id as string;
  const added = await runtime.query('SELECT collection_set_item($1,$2,$3,true) AS ok', [
    owner.principalId,
    id,
    source.projectId,
  ]);
  expect(added.rows[0].ok).toBe(true);
  return id;
}

async function assertUnavailable(source: Fixture, publicationId: string) {
  const results = await Promise.all([
    publicRead(publicationId),
    publicImage(publicationId),
    runtime.query('SELECT * FROM gallery_work(NULL,$1)', [source.projectId]),
    runtime.query('SELECT * FROM gallery_snapshot($1)', [source.projectId]),
    runtime.query("SELECT * FROM gallery_list(NULL,'recent',NULL,60,0)"),
    runtime.query('SELECT * FROM public_projects_read(NULL,NULL,NULL,49,0)'),
    runtime.query('SELECT gallery_copy_to_projects($1,$2,NULL) AS id', [
      source.principalId,
      source.projectId,
    ]),
  ]);
  for (const result of results.slice(0, 4)) expect(result.rows).toHaveLength(0);
  expect(results[4].rows.some((row) => row.project_id === source.projectId)).toBe(false);
  expect(results[5].rows.some((row) => row.publication_id === publicationId)).toBe(false);
  expect(results[6].rows[0].id).toBeNull();
}

async function protectedClass(source: Fixture) {
  const result = await admin.query(
    `INSERT INTO classrooms
       (tenant_id,school_id,academic_period_id,title,age_band,topic_keys,
        safe_mode_default,created_by,idempotency_key,request_fingerprint)
     VALUES ($1,$2,$3,'Protected class','mixed',ARRAY['electronics'],true,$4,$5,$6)
     RETURNING id`,
    [
      source.teacher.tenantId,
      source.teacher.schoolId,
      source.teacher.periodId,
      source.teacher.teacherId,
      crypto.randomUUID(),
      'a'.repeat(64),
    ],
  );
  const classroomId = result.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [source.teacher.tenantId, classroomId, source.teacher.teacherId, source.accountId],
  );
  return classroomId;
}

async function protectedSeat(source: Fixture, classroomId: string, accountId: string | null) {
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by,account_id)
     VALUES ($1,$2,'Private learner','learner','learner',true,'active',$3,$4) RETURNING id`,
    [source.teacher.tenantId, classroomId, source.teacher.teacherId, accountId],
  );
  const principal = await admin.query(
    `INSERT INTO principals(kind,seat_id) VALUES ('student_seat',$1) RETURNING id`,
    [seat.rows[0].id],
  );
  return principal.rows[0].id as string;
}

async function inTenant<T>(tenantId: string, operation: (client: pg.PoolClient) => Promise<T>) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function legacyHandout(source: Fixture, classroomId: string) {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,'Submission lock fixture','Build','electronics','private') RETURNING id`,
    [source.teacher.tenantId, source.principalId],
  );
  const handout = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id,classroom_id,assignment_id,status,created_by)
     VALUES ($1,$2,$3,'open',$4) RETURNING id`,
    [source.teacher.tenantId, classroomId, authored.rows[0].id, source.teacher.teacherId],
  );
  return handout.rows[0].id as string;
}

type SubmissionWriter = 'legacy' | 'direct';

async function legacyOriginal(label: string, writer: SubmissionWriter) {
  const source = await fixture(label, false);
  const classroomId = await protectedClass(source);
  const seatPrincipal = await protectedSeat(source, classroomId, null);
  const seatId = (await admin.query('SELECT seat_id FROM principals WHERE id=$1', [seatPrincipal]))
    .rows[0].seat_id as string;
  const assignmentId = await legacyHandout(source, classroomId);
  await admin.query('UPDATE projects SET owner_principal_id=$2 WHERE id=$1', [
    source.projectId,
    seatPrincipal,
  ]);
  const original: Fixture = {
    ...source,
    principalId: seatPrincipal,
    input: { ...source.input, actor: { principalId: seatPrincipal, userId: null } },
  };
  if (writer === 'legacy') {
    // Seed the same compatibility mapping that this command would create on
    // first submission. The race then starts with all unrelated metadata ready.
    const activity = await admin.query(
      `INSERT INTO learning_activities
         (tenant_id,owner_principal_id,scope_kind,activity_type,title)
       VALUES ($1,$2,'school','project','Legacy lock fixture') RETURNING id`,
      [source.teacher.tenantId, source.principalId],
    );
    const version = await admin.query(
      `INSERT INTO learning_activity_versions
         (tenant_id,activity_id,version_number,title,instructions,activity_type,
          module_key,max_points,scoring_policy,content_digest)
       VALUES ($1,$2,1,'Legacy lock fixture','Build','project','electronics',100,
         '{"kind":"manual","scale":"integer","passThreshold":60}'::jsonb,$3) RETURNING id`,
      [source.teacher.tenantId, activity.rows[0].id, 'a'.repeat(64)],
    );
    await admin.query(
      `INSERT INTO classroom_activity_versions
         (tenant_id,classroom_assignment_id,learning_activity_version_id) VALUES ($1,$2,$3)`,
      [source.teacher.tenantId, assignmentId, version.rows[0].id],
    );
    const started = await runtime.query('SELECT * FROM classroom_assignment_work_start($1,$2,$3)', [
      seatId,
      assignmentId,
      source.projectId,
    ]);
    expect(started.rows[0]).toMatchObject({ project_id: source.projectId, submitted_at: null });
  } else {
    const learnerId = (
      await admin.query(
        `INSERT INTO learner_identities(id,tenant_id,school_id)
         VALUES (gen_random_uuid(),$1,$2) RETURNING id`,
        [source.teacher.tenantId, source.teacher.schoolId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO learner_identity_links
         (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
      [source.teacher.tenantId, source.teacher.schoolId, learnerId, seatId],
    );
    await inTenant(source.teacher.tenantId, async (client) => {
      const activity = await client.query(
        `SELECT * FROM learning_activity_create(
           $1,$2,'school','private','project','Direct lock fixture','Build','graded',20,
           $3::jsonb,'electronics',NULL,NULL,NULL,$4)`,
        [
          source.principalId,
          source.teacher.tenantId,
          JSON.stringify({
            attemptPolicy: { maxAttempts: 2 },
            resultSelectionPolicy: { mode: 'latest' },
            completionPolicy: { mode: 'submission' },
            latePolicy: { mode: 'allow_mark_late' },
            assessmentPolicy: { mode: 'manual' },
            feedbackReleasePolicy: { mode: 'after_review' },
          }),
          crypto.randomUUID(),
        ],
      );
      expect(activity.rows[0].result_code).toBe('ok');
      const version = await client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        source.principalId,
        source.teacher.tenantId,
        activity.rows[0].activity_id,
        crypto.randomUUID(),
      ]);
      expect(version.rows[0].result_code).toBe('ok');
      const run = await client.query(
        `SELECT * FROM activity_run_create(
           $1,$2,$3,'direct',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$4)`,
        [
          source.principalId,
          assignmentId,
          version.rows[0].activity_version_id,
          crypto.randomUUID(),
        ],
      );
      expect(run.rows[0].result_code).toBe('ok');
      const participation = await client.query(
        'SELECT * FROM activity_participation_assign($1,$2,$3,NULL)',
        [source.principalId, run.rows[0].activity_run_id, learnerId],
      );
      expect(participation.rows[0].result_code).toBe('ok');
      const started = await client.query(
        'SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)',
        [seatPrincipal, seatId, assignmentId, source.projectId],
      );
      expect(started.rows[0]).toMatchObject({
        result_code: 'ok',
        project_id: source.projectId,
        attempt_state: 'in_progress',
      });
    });
  }
  return { ...original, writer, seatId, assignmentId };
}

type LegacyOriginal = Awaited<ReturnType<typeof legacyOriginal>>;

function submitOriginal(client: pg.PoolClient, source: LegacyOriginal) {
  return source.writer === 'legacy'
    ? client.query('SELECT * FROM learning_project_submission_create($1,$2,$3)', [
        source.seatId,
        source.assignmentId,
        crypto.randomUUID(),
      ])
    : client.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
        source.principalId,
        source.seatId,
        source.assignmentId,
        crypto.randomUUID(),
      ]);
}

/** Pause the real version INSERT before 0194's Project-locking trigger, only
 * for this Project. A table-wide lock would block the publication suites that
 * the gate runs in parallel. Setup DDL commits before either writer starts. */
async function versionInsertBarrier(projectId: string) {
  const name = `aa_publication_barrier_${projectId.replaceAll('-', '')}`;
  const client = await admin.connect();
  const drop = async () => {
    await admin.query(`DROP TRIGGER IF EXISTS ${name} ON public.project_versions`);
    await admin.query(`DROP FUNCTION IF EXISTS public.${name}()`);
  };
  try {
    await admin.query(
      `CREATE FUNCTION public.${name}() RETURNS trigger
       LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
       BEGIN
         PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text,218));
         RETURN NEW;
       END; $$`,
    );
    await admin.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON public.project_versions
       FOR EACH ROW WHEN (NEW.project_id='${projectId}'::uuid)
       EXECUTE FUNCTION public.${name}()`,
    );
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,218))', [projectId]);
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    return {
      pid,
      release: () => client.query('ROLLBACK'),
      close: async () => {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release(true);
          await drop();
        }
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release(true);
      await drop();
    }
    throw error;
  }
}

function signal() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface Observed<T> {
  outcome: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;
  finished: () => boolean;
}

type CheckpointResult = Awaited<ReturnType<PgProjectRepository['createCheckpoint']>>;

function observe<T>(operation: Promise<T>): Observed<T> {
  let finished = false;
  const outcome = operation.then(
    (value) => {
      finished = true;
      return { ok: true as const, value };
    },
    (error: unknown) => {
      finished = true;
      return { ok: false as const, error };
    },
  );
  return { outcome, finished: () => finished };
}

/** All SQL and results go through this real runtime connection. The optional
 * boundary only lets a test hold a completed repository query before its next
 * statement; it does not replace queries, simulate row locks or retry writes. */
function repositoryOn(
  client: pg.PoolClient,
  afterQuery?: (sql: string, result: pg.QueryResult) => Promise<void>,
) {
  const query = async (sql: string, values?: unknown[]) => {
    const result = await client.query(sql, values);
    await afterQuery?.(sql, result);
    return result;
  };
  const leasedClient = { query, release: () => undefined } as unknown as pg.PoolClient;
  return new PgProjectRepository({
    query,
    connect: async () => leasedClient,
  } as unknown as pg.Pool);
}

async function waitForBlock(waiter: number, blocker: number, finished: () => boolean) {
  const deadline = Date.now() + 5_000;
  let last: { blocking_pids: number[]; wait_event_type: string | null } | undefined;
  while (Date.now() < deadline) {
    const state = await admin.query<{
      blocking_pids: number[];
      wait_event_type: string | null;
    }>(
      `SELECT pg_blocking_pids(pid) AS blocking_pids,wait_event_type
         FROM pg_stat_activity WHERE pid=$1`,
      [waiter],
    );
    last = state.rows[0];
    if (last?.wait_event_type === 'Lock' && last.blocking_pids.includes(blocker)) return;
    if (finished()) break;
  }
  // Observed PostgreSQL lock ownership is the barrier. Elapsed time, an
  // unfinished Promise, and an arbitrary sleep are never proof of contention.
  expect(last?.wait_event_type).toBe('Lock');
  expect(last?.blocking_pids).toContain(blocker);
}

async function assertSubmittedVersion(
  source: LegacyOriginal,
  submitted: pg.QueryResult,
  versionNo: number,
) {
  const row = submitted.rows[0];
  expect(row).toMatchObject({
    result_code: 'ok',
    project_id: source.projectId,
    attempt_state: source.writer === 'legacy' ? 'evaluating' : 'submitted',
    reused: false,
  });
  const versions = await admin.query(
    `SELECT version.id,version.version_no,version.document_json
       FROM learning_submissions submission
       JOIN project_versions version ON version.id=submission.project_version_id
      WHERE submission.project_id=$1`,
    [source.projectId],
  );
  expect(versions.rows).toEqual([
    {
      id: row.project_version_id,
      version_no: versionNo,
      document_json: source.input.initialDocument,
    },
  ]);
  expect(await counts(source)).toEqual({ versions: versionNo, revisions: 0, states: 0 });
}

describe('explicit Public Projects on real PostgreSQL', () => {
  it('freezes an exact version, metadata and raster until explicit republish, then deduplicates retries', async () => {
    const source = await fixture('frozen');
    const metadata = {
      title: `Public frozen ${crypto.randomUUID()}`,
      description: 'A public explanation',
      tags: [' Circuit ', 'circuit', 'Robot'],
      license: 'cc-by',
    };
    const first = await publish(source, metadata);
    expect(first).toMatchObject({ revisionNo: 1, versionNo: 1 });
    const initial = await publicRead(first.publicationId);
    expect(initial.rows[0]).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      tags: ['circuit', 'robot'],
      license: 'cc-by',
      author_label: 'Педагог public-frozen',
      revision_id: first.revisionId,
      revision_no: 1,
      version_no: 1,
      preview_content_type: 'image/png',
      preview_width: 16,
      preview_height: 16,
    });
    expect(Object.keys(initial.rows[0]).sort()).toEqual(
      [
        'author_label',
        'description',
        'license',
        'module_key',
        'preview_content_type',
        'preview_height',
        'preview_width',
        'publication_id',
        'published_at',
        'revision_id',
        'revision_no',
        'summary',
        'tags',
        'title',
        'version_no',
      ].sort(),
    );
    expect((await publicImage(first.publicationId, first.revisionId)).rows[0].image).toEqual(
      Buffer.alloc(64, 17),
    );
    const changed = {
      schemaVersion: 1,
      components: [],
      connections: [],
      privateMarker: 'unpublished V2 secret',
    };
    const saved = await repo.saveDraft({
      tenantId: source.input.tenantId,
      projectId: source.projectId,
      actor: source.input.actor,
      document: changed,
      preview: null,
      baseRevision: 1,
      mutationId: crypto.randomUUID(),
    });
    expect(saved?.revision).toBe(2);
    expect(await ownerStatus(source)).toMatchObject({
      canPublish: false,
      reasonCode: 'preview_required',
    });
    await expect(publish(source, metadata)).rejects.toMatchObject({ code: 'P5P02' });
    await snapshot(source, 2, 34);
    await runtime.query('SELECT project_properties_save($1,$2,$3,$4,$5,$6)', [
      source.principalId,
      source.projectId,
      'Private changed title',
      'Private changed description',
      ['private'],
      'reserved',
    ]);
    // The legacy properties dialog may still send its unchanged visibility.
    expect(
      (
        await runtime.query("SELECT project_visibility_set($1,$2,'public') AS ok", [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    expect((await publicRead(first.publicationId)).rows[0]).toMatchObject(initial.rows[0]);
    expect((await publicImage(first.publicationId, first.revisionId)).rows[0].image).toEqual(
      Buffer.alloc(64, 17),
    );
    const legacy = await runtime.query('SELECT * FROM gallery_work(NULL,$1)', [source.projectId]);
    expect(legacy.rows).toHaveLength(0);
    expect(
      (await runtime.query('SELECT * FROM gallery_snapshot($1)', [source.projectId])).rows[0].image,
    ).toEqual(Buffer.alloc(64, 17));
    expect(await counts(source)).toMatchObject({ versions: 1, revisions: 1, states: 1 });

    const second = await publish(source);
    expect(second).toMatchObject({
      publicationId: first.publicationId,
      revisionNo: 2,
      versionNo: 2,
    });
    expect(second.revisionId).not.toBe(first.revisionId);
    expect((await publicRead(second.publicationId)).rows[0]).toMatchObject({
      title: 'Private changed title',
      description: 'Private changed description',
      revision_id: second.revisionId,
    });
    expect((await publicImage(second.publicationId, second.revisionId)).rows[0].image).toEqual(
      Buffer.alloc(64, 34),
    );
    expect((await publicImage(second.publicationId, first.revisionId)).rows).toHaveLength(0);
    const version = await admin.query(
      `SELECT version.document_json FROM project_publication_revisions revision
        JOIN project_versions version ON version.id=revision.project_version_id WHERE revision.id=$1`,
      [second.revisionId],
    );
    expect(version.rows[0].document_json).toEqual(changed);
    expect(await publish(source)).toEqual(second);
    expect(await counts(source)).toMatchObject({ versions: 2, revisions: 2, states: 1 });
  });

  it('serializes concurrent publication retries without duplicate versions or revisions', async () => {
    const source = await fixture('parallel');
    const [first, retry] = await Promise.all([publish(source), publish(source)]);
    expect(retry).toEqual(first);
    expect(await counts(source)).toMatchObject({ versions: 1, revisions: 1, states: 1 });
  });

  it('serializes a pending real checkpoint before publication without the Draft-to-Project trigger deadlock', async () => {
    const source = await fixture('checkpoint-first');
    const checkpointClient = await runtime.connect();
    const publicationClient = await runtime.connect();
    const draftLocked = signal();
    const continueCheckpoint = signal();
    let checkpoint: Observed<CheckpointResult> | undefined;
    let publication: Observed<pg.QueryResult<{ result: OwnerPublicationStatus }>> | undefined;
    try {
      await checkpointClient.query("SET statement_timeout='10s'");
      await publicationClient.query('BEGIN');
      await publicationClient.query("SET LOCAL statement_timeout='10s'");
      const checkpointPid = (await checkpointClient.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      const publicationPid = (await publicationClient.query('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid as number;
      const checkpointRepo = repositoryOn(checkpointClient, async (sql) => {
        if (sql.includes('FOR UPDATE OF d')) {
          draftLocked.release();
          await continueCheckpoint.promise;
        }
      });
      checkpoint = observe(
        checkpointRepo.createCheckpoint(
          source.input.tenantId,
          source.projectId,
          source.input.actor,
          'Concurrent checkpoint',
        ),
      );
      await Promise.race([
        draftLocked.promise,
        checkpoint.outcome.then((outcome) => {
          if (!outcome.ok) throw outcome.error;
          throw new Error('checkpoint completed without reaching its real Draft lock');
        }),
      ]);
      publication = observe(
        publicationClient.query<{ result: OwnerPublicationStatus }>(
          'SELECT project_publication_publish($1,$2) AS result',
          [source.principalId, source.projectId],
        ),
      );
      await waitForBlock(publicationPid, checkpointPid, publication.finished);
      // Before the fix this releases a checkpoint holding Draft into a version
      // INSERT whose Learning trigger waits for the publisher's Project lock:
      // the two real transactions deadlock with 40P01. No retry masks it here.
      continueCheckpoint.release();
      const checkpointResult = await checkpoint.outcome;
      if (!checkpointResult.ok) throw checkpointResult.error;
      expect(checkpointResult.value).not.toBeNull();
      const publicationResult = await publication.outcome;
      if (!publicationResult.ok) throw publicationResult.error;
      await publicationClient.query('COMMIT');
      const published = publicationResult.value.rows[0].result.publication;
      if (!published) throw new Error('publication did not return its immutable revision');
      expect(published.versionNo).toBe(checkpointResult.value?.versionNo);
      expect(published.revisionNo).toBe(1);
      expect(await counts(source)).toEqual({ versions: 1, revisions: 1, states: 1 });
      expect(
        (await publicImage(published.publicationId, published.revisionId)).rows[0].image,
      ).toEqual(Buffer.alloc(64, 17));
    } finally {
      continueCheckpoint.release();
      // The deadline is a watchdog for a broken test, never a successful
      // concurrency outcome. Roll back only these two owned test sessions.
      await publicationClient.query('ROLLBACK');
      if (publication) await publication.outcome;
      if (checkpoint) await checkpoint.outcome;
      await checkpointClient.query('ROLLBACK');
      checkpointClient.release(true);
      publicationClient.release(true);
    }
  }, 20_000);

  it('serializes a real checkpoint behind an uncommitted publication and preserves the published version', async () => {
    const source = await fixture('publication-first');
    const publicationClient = await runtime.connect();
    const checkpointClient = await runtime.connect();
    let checkpoint: Observed<CheckpointResult> | undefined;
    try {
      await publicationClient.query('BEGIN');
      await publicationClient.query("SET LOCAL statement_timeout='10s'");
      await checkpointClient.query("SET statement_timeout='10s'");
      const publicationPid = (await publicationClient.query('SELECT pg_backend_pid() AS pid'))
        .rows[0].pid as number;
      const checkpointPid = (await checkpointClient.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      const result = await publicationClient.query<{ result: OwnerPublicationStatus }>(
        'SELECT project_publication_publish($1,$2) AS result',
        [source.principalId, source.projectId],
      );
      const published = result.rows[0].result.publication;
      if (!published) throw new Error('publication did not return its immutable revision');
      checkpoint = observe(
        repositoryOn(checkpointClient).createCheckpoint(
          source.input.tenantId,
          source.projectId,
          source.input.actor,
          'After public version',
        ),
      );
      await waitForBlock(checkpointPid, publicationPid, checkpoint.finished);
      await publicationClient.query('COMMIT');
      const checkpointResult = await checkpoint.outcome;
      if (!checkpointResult.ok) throw checkpointResult.error;
      expect(checkpointResult.value?.versionNo).toBe(2);
      expect(await counts(source)).toEqual({ versions: 2, revisions: 1, states: 1 });
      expect((await publicRead(published.publicationId)).rows[0]).toMatchObject({
        revision_id: published.revisionId,
        version_no: 1,
        revision_no: 1,
      });
      expect(
        (await publicImage(published.publicationId, published.revisionId)).rows[0].image,
      ).toEqual(Buffer.alloc(64, 17));
    } finally {
      await publicationClient.query('ROLLBACK');
      if (checkpoint) await checkpoint.outcome;
      await checkpointClient.query('ROLLBACK');
      publicationClient.release(true);
      checkpointClient.release(true);
    }
  }, 20_000);

  it.each(['legacy', 'direct'] as const)(
    'lets a pending %s submission finish before a real checkpoint of its immutable original',
    async (writer) => {
      const source = await legacyOriginal(`${writer}-submission-first`, writer);
      const submissionClient = await runtime.connect();
      const checkpointClient = await runtime.connect();
      let barrier: Awaited<ReturnType<typeof versionInsertBarrier>> | undefined;
      let submission: Observed<pg.QueryResult> | undefined;
      let checkpoint: Observed<CheckpointResult> | undefined;
      try {
        barrier = await versionInsertBarrier(source.projectId);
        await submissionClient.query('BEGIN');
        await submissionClient.query("SET LOCAL statement_timeout='10s'");
        await submissionClient.query("SELECT set_config('app.tenant_id',$1,true)", [
          source.input.tenantId,
        ]);
        await checkpointClient.query("SET statement_timeout='10s'");
        const submissionPid = (await submissionClient.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid as number;
        const checkpointPid = (await checkpointClient.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid as number;
        submission = observe(submitOriginal(submissionClient, source));
        // The real SQL command has locked Work and Draft and reached its
        // version INSERT, before the unchanged 0194 Project-locking trigger.
        await waitForBlock(submissionPid, barrier.pid, submission.finished);
        checkpoint = observe(
          repositoryOn(checkpointClient).createCheckpoint(
            source.input.tenantId,
            source.projectId,
            source.input.actor,
            'After Learning submission',
          ),
        );
        await waitForBlock(checkpointPid, submissionPid, checkpoint.finished);
        // An unconditional early Project lock makes this release form a real
        // Draft -> Project -> Draft cycle. No retry or deadlock is accepted.
        await barrier.release();
        const submitted = await submission.outcome;
        if (!submitted.ok) throw submitted.error;
        await submissionClient.query('COMMIT');
        const checkpointResult = await checkpoint.outcome;
        expect(checkpointResult.ok).toBe(false);
        if (checkpointResult.ok) throw new Error('submitted original remained editable');
        expect(checkpointResult.error).toBeInstanceOf(LearningWorkReadOnlyError);
        await assertSubmittedVersion(source, submitted.value, 1);
      } finally {
        // Release the scoped barrier even if lock observation fails. Settle
        // both real writers before removing the trigger from the shared table.
        try {
          await barrier?.release();
          await submissionClient.query('ROLLBACK');
          if (submission) await submission.outcome;
          if (checkpoint) await checkpoint.outcome;
          await checkpointClient.query('ROLLBACK');
        } finally {
          submissionClient.release(true);
          checkpointClient.release(true);
          await barrier?.close();
        }
      }
    },
    20_000,
  );

  it.each(['legacy', 'direct'] as const)(
    'preserves a real checkpoint before a %s submission of its immutable original',
    async (writer) => {
      const source = await legacyOriginal(`${writer}-checkpoint-first`, writer);
      const checkpointClient = await runtime.connect();
      const submissionClient = await runtime.connect();
      const draftLocked = signal();
      const continueCheckpoint = signal();
      let checkpoint: Observed<CheckpointResult> | undefined;
      let submission: Observed<pg.QueryResult> | undefined;
      try {
        await checkpointClient.query("SET statement_timeout='10s'");
        await submissionClient.query('BEGIN');
        await submissionClient.query("SET LOCAL statement_timeout='10s'");
        await submissionClient.query("SELECT set_config('app.tenant_id',$1,true)", [
          source.input.tenantId,
        ]);
        const checkpointPid = (await checkpointClient.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid as number;
        const submissionPid = (await submissionClient.query('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid as number;
        checkpoint = observe(
          repositoryOn(checkpointClient, async (sql) => {
            if (sql.includes('FOR UPDATE OF d')) {
              draftLocked.release();
              await continueCheckpoint.promise;
            }
          }).createCheckpoint(
            source.input.tenantId,
            source.projectId,
            source.input.actor,
            'Before Learning submission',
          ),
        );
        await Promise.race([
          draftLocked.promise,
          checkpoint.outcome.then((outcome) => {
            if (!outcome.ok) throw outcome.error;
            throw new Error('checkpoint did not reach its actual Draft lock');
          }),
        ]);
        submission = observe(submitOriginal(submissionClient, source));
        await waitForBlock(submissionPid, checkpointPid, submission.finished);
        continueCheckpoint.release();
        const checkpointResult = await checkpoint.outcome;
        if (!checkpointResult.ok) throw checkpointResult.error;
        expect(checkpointResult.value?.versionNo).toBe(1);
        const submitted = await submission.outcome;
        if (!submitted.ok) throw submitted.error;
        await submissionClient.query('COMMIT');
        await assertSubmittedVersion(source, submitted.value, 2);
      } finally {
        continueCheckpoint.release();
        await submissionClient.query('ROLLBACK');
        if (submission) await submission.outcome;
        if (checkpoint) await checkpoint.outcome;
        await checkpointClient.query('ROLLBACK');
        checkpointClient.release(true);
        submissionClient.release(true);
      }
    },
    20_000,
  );

  it('rechecks a newly attached immutable origin after the Project wait and releases only its early lock', async () => {
    const source = await fixture('origin-attach-during-checkpoint', false);
    const classroomId = await protectedClass(source);
    const seatPrincipal = await protectedSeat(source, classroomId, source.accountId);
    const seatId = (
      await admin.query('SELECT seat_id FROM principals WHERE id=$1', [seatPrincipal])
    ).rows[0].seat_id as string;
    const assignmentId = await legacyHandout(source, classroomId);
    const originClient = await runtime.connect();
    const checkpointClient = await runtime.connect();
    const probeClient = await runtime.connect();
    const earlyLockReleased = signal();
    const continueCheckpoint = signal();
    const checks: Array<{
      hasOrigin: boolean;
      pid: number;
      xid: string;
      tenant: string;
      isolation: string;
    }> = [];
    let priorAuditId: string | undefined;
    let checkpoint: Observed<CheckpointResult> | undefined;
    try {
      await originClient.query('BEGIN');
      await originClient.query("SET LOCAL statement_timeout='10s'");
      await originClient.query("SELECT set_config('app.tenant_id',$1,true)", [
        source.input.tenantId,
      ]);
      await checkpointClient.query("SET statement_timeout='10s'");
      const originPid = (await originClient.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      const checkpointPid = (await checkpointClient.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      const started = await originClient.query(
        'SELECT * FROM classroom_assignment_work_start($1,$2,$3)',
        [seatId, assignmentId, source.projectId],
      );
      expect(started.rows[0]).toMatchObject({ project_id: source.projectId, submitted_at: null });
      checkpoint = observe(
        repositoryOn(checkpointClient, async (sql, result) => {
          if (sql.startsWith('SELECT project_editor_has_immutable_learning_origin')) {
            const context = (
              await checkpointClient.query(
                `SELECT pg_backend_pid() AS pid,pg_current_xact_id()::text AS xid,
                        current_setting('app.tenant_id') AS tenant,
                        current_setting('transaction_isolation') AS isolation`,
              )
            ).rows[0];
            checks.push({ hasOrigin: result.rows[0].has_origin as boolean, ...context });
            if (checks.length === 1) {
              // A real write before the savepoint is a witness: reclassification
              // must not roll back the outer transaction or its tenant context.
              priorAuditId = (
                await checkpointClient.query(
                  `INSERT INTO audit_events(tenant_id,entity_type,entity_id,action)
                   VALUES ($1,'project',$2,'publication.test.before_savepoint') RETURNING id::text`,
                  [source.input.tenantId, source.projectId],
                )
              ).rows[0].id as string;
            }
          }
          if (sql === 'ROLLBACK TO SAVEPOINT project_publication_order') {
            earlyLockReleased.release();
            await continueCheckpoint.promise;
          }
        }).createCheckpoint(
          source.input.tenantId,
          source.projectId,
          source.input.actor,
          'Checkpoint after origin attachment',
        ),
      );
      await waitForBlock(checkpointPid, originPid, checkpoint.finished);
      expect(checks.map((check) => check.hasOrigin)).toEqual([false]);
      await originClient.query('COMMIT');
      await Promise.race([
        earlyLockReleased.promise,
        checkpoint.outcome.then((outcome) => {
          if (!outcome.ok) throw outcome.error;
          throw new Error('the newly visible origin did not release the early Project lock');
        }),
      ]);
      expect(checks.map((check) => check.hasOrigin)).toEqual([false, true]);
      expect(checks[0]).toMatchObject({
        pid: checkpointPid,
        tenant: source.input.tenantId,
        isolation: 'read committed',
      });
      expect(checks[1]).toEqual({ ...checks[0], hasOrigin: true });
      await probeClient.query('BEGIN');
      await probeClient.query("SELECT set_config('app.tenant_id',$1,true)", [
        source.input.tenantId,
      ]);
      const probePid = (await probeClient.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      // NOWAIT succeeds only if ROLLBACK TO released the early Project lock.
      expect(
        (
          await probeClient.query(
            'SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE NOWAIT',
            [source.input.tenantId, source.projectId],
          )
        ).rows,
      ).toHaveLength(1);
      continueCheckpoint.release();
      await waitForBlock(checkpointPid, probePid, checkpoint.finished);
      await probeClient.query('COMMIT');
      const checkpointResult = await checkpoint.outcome;
      if (!checkpointResult.ok) throw checkpointResult.error;
      expect(checkpointResult.value?.versionNo).toBe(1);
      expect(
        (await admin.query('SELECT entity_id FROM audit_events WHERE id=$1', [priorAuditId])).rows,
      ).toEqual([{ entity_id: source.projectId }]);
      expect(await counts(source)).toEqual({ versions: 1, revisions: 0, states: 0 });

      // Legacy Work may disappear, but the lock classifier must stay true.
      await admin.query('DELETE FROM classroom_assignment_work WHERE project_id=$1', [
        source.projectId,
      ]);
      for (const [tenant, expected] of [
        [source.input.tenantId, true],
        [crypto.randomUUID(), false],
        ['', false],
      ] as const) {
        await probeClient.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
        expect(
          (
            await probeClient.query(
              'SELECT project_editor_has_immutable_learning_origin($1) AS has_origin',
              [source.projectId],
            )
          ).rows,
        ).toEqual([{ has_origin: expected }]);
      }
      await expect(
        admin.query('DELETE FROM learning_legacy_project_origins WHERE project_id=$1', [
          source.projectId,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        probeClient.query('SELECT project_publication_publish($1,$2)', [
          source.principalId,
          source.projectId,
        ]),
      ).rejects.toMatchObject({ code: 'P5L01' });
      await expect(
        repositoryOn(checkpointClient).createCheckpoint(
          source.input.tenantId,
          source.projectId,
          source.input.actor,
          'Source no longer exists',
        ),
      ).rejects.toBeInstanceOf(LearningWorkReadOnlyError);
    } finally {
      continueCheckpoint.release();
      await originClient.query('ROLLBACK');
      await probeClient.query('ROLLBACK');
      if (checkpoint) await checkpoint.outcome;
      await checkpointClient.query('ROLLBACK');
      originClient.release(true);
      probeClient.release(true);
      checkpointClient.release(true);
    }
  }, 20_000);

  it('paginates and searches frozen public metadata with the module filter', async () => {
    const first = await fixture('discovery-first');
    const second = await fixture('discovery-second');
    const tag = `discovery-${crypto.randomUUID().slice(0, 12)}`;
    const one = await publish(first, { title: 'First public entry', tags: [tag] });
    const two = await publish(second, { title: 'Second public entry', tags: [tag] });
    const page = async (offset: number, moduleKey = 'electronics') =>
      runtime.query('SELECT * FROM public_projects_read(NULL,$1,$2,1,$3)', [
        tag,
        moduleKey,
        offset,
      ]);
    expect((await page(0)).rows.map((row) => row.publication_id)).toEqual([two.publicationId]);
    expect((await page(1)).rows.map((row) => row.publication_id)).toEqual([one.publicationId]);
    expect((await page(2)).rows).toHaveLength(0);
    expect((await page(0, 'three-d')).rows).toHaveLength(0);
    await runtime.query("SELECT project_properties_save($1,$2,$3,NULL,$4,'reserved')", [
      first.principalId,
      first.projectId,
      `Private ${tag}`,
      ['private'],
    ]);
    expect((await page(1)).rows[0].title).toBe('First public entry');
    expect(
      (
        await runtime.query('SELECT * FROM public_projects_read(NULL,$1,NULL,24,0)', [
          `Private ${tag}`,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('fails missing previews and invalid metadata atomically before creating publication storage', async () => {
    const source = await fixture('no-preview', false);
    expect(await ownerStatus(source)).toEqual({
      publication: null,
      canPublish: false,
      reasonCode: 'preview_required',
    });
    await expect(publish(source)).rejects.toMatchObject({ code: 'P5P02' });
    await snapshot(source, 1, 17);
    for (const metadata of [
      { title: '' },
      { tags: ['x'.repeat(33)] },
      { tags: ['x', null] },
      { license: 'unknown' },
      { tenantId: source.input.tenantId },
    ]) {
      await expect(publish(source, metadata)).rejects.toMatchObject({ code: 'P5P03' });
    }
    expect(await counts(source)).toEqual({ versions: 0, revisions: 0, states: 0 });
  });

  it('isolates old schema-1 rows until an explicit new publication without removing original data', async () => {
    const source = await fixture('historical');
    // Only the admin fixture can invoke the historical writer. It represents
    // a publication created before this migration; runtime cannot execute it.
    expect(
      (
        await admin.query('SELECT gallery_publish_unprotected($1,$2) AS ok', [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    const historical = await admin.query(
      `SELECT state.id,revision.id AS revision_id,revision.schema_version
         FROM project_publication_state state JOIN project_publication_revisions revision
           ON revision.id=state.current_revision_id WHERE state.project_id=$1`,
      [source.projectId],
    );
    expect(historical.rows[0].schema_version).toBe(1);
    const publicationId = historical.rows[0].id as string;
    expect(await ownerStatus(source)).toEqual({
      publication: null,
      canPublish: true,
      reasonCode: null,
    });
    await assertUnavailable(source, publicationId);
    await runtime.query("SELECT project_properties_save($1,$2,$3,NULL,$4,'reserved')", [
      source.principalId,
      source.projectId,
      'Historical private rename',
      [],
    ]);
    expect(
      (
        await runtime.query("SELECT project_visibility_set($1,$2,'public') AS ok", [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    expect(await ownerStatus(source)).toMatchObject({ publication: null });
    expect(await counts(source)).toEqual({ versions: 1, revisions: 1, states: 1 });
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS n FROM project_publications WHERE project_id=$1',
          [source.projectId],
        )
      ).rows[0].n,
    ).toBe(1);
    const renewed = await publish(source);
    expect(renewed).toMatchObject({ publicationId, revisionNo: 2, versionNo: 1 });
    expect((await publicRead(publicationId)).rows).toHaveLength(1);
    expect(
      (
        await admin.query('SELECT schema_version FROM project_publication_revisions WHERE id=$1', [
          historical.rows[0].revision_id,
        ])
      ).rows[0].schema_version,
    ).toBe(1);
    expect(await counts(source)).toEqual({ versions: 1, revisions: 2, states: 1 });
  });

  it('uses immutable metadata for foreign collections and hides it on legacy unpublish while preserving own private items', async () => {
    const source = await fixture('collections-source');
    const viewer = await fixture('collections-viewer');
    const published = await publish(source, { title: 'Public collection title' });
    const ownCollection = await collection(source, source);
    const foreignCollection = await collection(viewer, source);
    await runtime.query('SELECT project_properties_save($1,$2,$3,$4,$5,$6)', [
      source.principalId,
      source.projectId,
      'Private renamed title',
      'Private metadata',
      [],
      'reserved',
    ]);
    const own = await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
      source.principalId,
      ownCollection,
    ]);
    const foreign = await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
      viewer.principalId,
      foreignCollection,
    ]);
    expect(own.rows[0]).toMatchObject({ title: 'Private renamed title' });
    expect(foreign.rows[0]).toMatchObject({
      title: 'Public collection title',
      snapshot_revision: 1,
    });
    expect(
      (
        await runtime.query('SELECT gallery_copy_to_projects($1,$2,NULL) AS id', [
          viewer.principalId,
          source.projectId,
        ])
      ).rows[0].id,
    ).toBeNull();

    expect(
      (
        await runtime.query('SELECT gallery_unpublish($1,$2) AS ok', [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    await assertUnavailable(source, published.publicationId);
    expect(await ownerStatus(source)).toMatchObject({
      publication: { state: 'revoked', publicPath: null },
    });
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          viewer.principalId,
          foreignCollection,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          source.principalId,
          ownCollection,
        ])
      ).rows[0],
    ).toMatchObject({ title: 'Private renamed title', published: false });
    expect(
      (await runtime.query('SELECT * FROM collection_list($1)', [viewer.principalId])).rows.find(
        (row) => row.id === foreignCollection,
      ).item_count,
    ).toBe(0);
    expect(
      (
        await runtime.query('SELECT collection_set_item($1,$2,$3,true) AS ok', [
          viewer.principalId,
          foreignCollection,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS n FROM collection_items WHERE project_id=$1',
          [source.projectId],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS n FROM project_publications WHERE project_id=$1',
          [source.projectId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await counts(source)).toEqual({ versions: 1, revisions: 1, states: 1 });
    expect(
      await repo.load(source.input.tenantId, source.projectId, source.input.actor),
    ).not.toBeNull();
    expect(
      (
        await runtime.query('SELECT project_publication_revoke($1,$2) AS ok', [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
  });

  it('makes legacy link visibility canonical unlisted and grants no tokenless access', async () => {
    const source = await fixture('unlisted');
    const publication = await publish(source);
    expect(
      (
        await runtime.query("SELECT project_visibility_set($1,$2,'link') AS ok", [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    await assertUnavailable(source, publication.publicationId);
    expect(await ownerStatus(source)).toMatchObject({
      publication: { state: 'unlisted', publicPath: null },
    });
    expect(
      (
        await admin.query('SELECT visibility FROM project_publications WHERE project_id=$1', [
          source.projectId,
        ])
      ).rows[0].visibility,
    ).toBe('link');
    expect(await publish(source)).toMatchObject({
      publicationId: publication.publicationId,
      revisionId: publication.revisionId,
    });
    expect(
      (
        await runtime.query("SELECT project_visibility_set($1,$2,'private') AS ok", [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
    await assertUnavailable(source, publication.publicationId);
    expect(await ownerStatus(source)).toMatchObject({ publication: { state: 'revoked' } });
  });

  it('allows an independent personal Account Project despite a linked protected Seat and educator membership', async () => {
    const source = await fixture('independent-account');
    const classroomId = await protectedClass(source);
    const seatPrincipal = await protectedSeat(source, classroomId, source.accountId);
    expect(seatPrincipal).not.toBe(source.principalId);
    const publication = await publish(source);
    expect(await ownerStatus(source)).toMatchObject({ canPublish: true, reasonCode: null });
    expect((await publicRead(publication.publicationId)).rows).toHaveLength(1);
    expect((await publicImage(publication.publicationId)).rows).toHaveLength(1);
    expect(
      (await runtime.query('SELECT * FROM gallery_snapshot($1)', [source.projectId])).rows,
    ).toHaveLength(1);
  });

  it('denies Seat public/link writes in SQL and gives a teacher no ownership or classroom bypass', async () => {
    const source = await fixture('seat-denial');
    const classroomId = await protectedClass(source);
    const seatPrincipal = await protectedSeat(source, classroomId, null);
    await admin.query('UPDATE projects SET owner_principal_id=$2 WHERE id=$1', [
      source.projectId,
      seatPrincipal,
    ]);
    await expect(
      runtime.query('SELECT project_publication_publish($1,$2)', [seatPrincipal, source.projectId]),
    ).rejects.toMatchObject({ code: 'P5P01' });
    await expect(
      runtime.query('SELECT gallery_publish($1,$2)', [seatPrincipal, source.projectId]),
    ).rejects.toMatchObject({ code: 'P5P01' });
    for (const visibility of ['public', 'link']) {
      await expect(
        runtime.query('SELECT project_visibility_set($1,$2,$3)', [
          seatPrincipal,
          source.projectId,
          visibility,
        ]),
      ).rejects.toMatchObject({ code: 'P5P01' });
    }
    await expect(
      runtime.query('SELECT project_publication_publish($1,$2)', [
        source.principalId,
        source.projectId,
      ]),
    ).rejects.toMatchObject({ code: 'P5P04' });
    expect(
      (
        await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(false);
    await admin.query(
      "UPDATE projects SET owner_principal_id=$2,project_scope='classroom',classroom_id=$3 WHERE id=$1",
      [source.projectId, source.principalId, classroomId],
    );
    expect(await ownerStatus(source)).toMatchObject({
      canPublish: false,
      reasonCode: 'publication_forbidden',
    });
    await expect(publish(source)).rejects.toMatchObject({ code: 'P5P01' });
    expect(await counts(source)).toEqual({ versions: 0, revisions: 0, states: 0 });
  });

  it('rechecks current Project scope and active owner on every public and foreign collection read', async () => {
    const source = await fixture('current-policy');
    const viewer = await fixture('current-policy-viewer');
    const publication = await publish(source);
    const foreignCollection = await collection(viewer, source);
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [source.accountId]);
    await assertUnavailable(source, publication.publicationId);
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          viewer.principalId,
          foreignCollection,
        ])
      ).rows,
    ).toHaveLength(0);
    await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [source.accountId]);
    expect((await publicRead(publication.publicationId)).rows).toHaveLength(1);
    await admin.query("UPDATE projects SET status='archived' WHERE id=$1", [source.projectId]);
    await assertUnavailable(source, publication.publicationId);
    await admin.query("UPDATE projects SET status='active' WHERE id=$1", [source.projectId]);
    const classroomId = await protectedClass(source);
    await admin.query("UPDATE projects SET project_scope='classroom',classroom_id=$2 WHERE id=$1", [
      source.projectId,
      classroomId,
    ]);
    await assertUnavailable(source, publication.publicationId);
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          viewer.principalId,
          foreignCollection,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await ownerStatus(source)).toMatchObject({
      canPublish: false,
      reasonCode: 'publication_forbidden',
      publication: { publicPath: null },
    });
  });

  it('preserves Learning guards and closes a formerly public project when an origin becomes known', async () => {
    const source = await fixture('learning-origin');
    const viewer = await fixture('learning-origin-viewer');
    const publication = await publish(source);
    const foreignCollection = await collection(viewer, source);
    // The immutable legacy evidence table accepts trusted repair evidence. A
    // new source association must close existing reads without rewriting it.
    await admin.query(
      `INSERT INTO learning_legacy_project_origins
         (project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at)
       VALUES ($1,$2,$2,$3,now())`,
      [source.projectId, source.input.tenantId, crypto.randomUUID()],
    );
    await assertUnavailable(source, publication.publicationId);
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          viewer.principalId,
          foreignCollection,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(await ownerStatus(source)).toMatchObject({
      canPublish: false,
      reasonCode: 'learning_work_protected',
      publication: { publicPath: null },
    });
    await expect(publish(source)).rejects.toMatchObject({ code: 'P5L01' });
    await expect(
      runtime.query('SELECT gallery_publish($1,$2)', [source.principalId, source.projectId]),
    ).rejects.toMatchObject({ code: 'P5L01' });
    await expect(
      runtime.query("SELECT project_visibility_set($1,$2,'link')", [
        source.principalId,
        source.projectId,
      ]),
    ).rejects.toMatchObject({ code: 'P5L01' });
    await expect(
      admin.query("UPDATE projects SET status='archived' WHERE id=$1", [source.projectId]),
    ).rejects.toMatchObject({ code: 'P5L01' });
    await expect(
      admin.query("UPDATE project_publication_state SET state='public' WHERE id=$1", [
        publication.publicationId,
      ]),
    ).rejects.toMatchObject({ code: 'P5L01' });
    expect(
      (
        await runtime.query('SELECT project_publication_revoke($1,$2) AS ok', [
          source.principalId,
          source.projectId,
        ])
      ).rows[0].ok,
    ).toBe(true);
  });

  it('retains the scoped teacher Learning denial for both legacy publication commands after the source work is gone', async () => {
    const teacher = await fixture('legacy-learning-denial', false);
    const outsider = await fixture('legacy-learning-outsider', false);
    const classroomId = await protectedClass(teacher);
    const learnerPrincipal = await protectedSeat(teacher, classroomId, null);
    await admin.query('UPDATE projects SET owner_principal_id=$2 WHERE id=$1', [
      teacher.projectId,
      learnerPrincipal,
    ]);
    // Persisted evidence intentionally has no live classroom_assignment_work
    // row, as after a withdrawn/deleted handout. Preview is absent as well.
    await admin.query(
      `INSERT INTO learning_legacy_project_origins
         (project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at)
       VALUES ($1,$2,$2,$3,now())`,
      [teacher.projectId, teacher.input.tenantId, crypto.randomUUID()],
    );
    await expect(
      runtime.query('SELECT gallery_publish($1,$2)', [teacher.principalId, teacher.projectId]),
    ).rejects.toMatchObject({ code: 'P5L01' });
    for (const visibility of ['public', 'link']) {
      await expect(
        runtime.query('SELECT project_visibility_set($1,$2,$3)', [
          teacher.principalId,
          teacher.projectId,
          visibility,
        ]),
      ).rejects.toMatchObject({ code: 'P5L01' });
      expect(
        (
          await runtime.query('SELECT project_visibility_set($1,$2,$3) AS ok', [
            outsider.principalId,
            teacher.projectId,
            visibility,
          ])
        ).rows[0].ok,
      ).toBe(false);
    }
    expect(
      (
        await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
          outsider.principalId,
          teacher.projectId,
        ])
      ).rows[0].ok,
    ).toBe(false);
    // The new owner API does not inherit teacher diagnostics or publication
    // privileges: foreign Projects still map P5P04 to the same unavailable404.
    await expect(
      runtime.query('SELECT project_publication_publish($1,$2)', [
        teacher.principalId,
        teacher.projectId,
      ]),
    ).rejects.toMatchObject({ code: 'P5P04' });
    await expect(
      runtime.query('SELECT project_publication_publish($1,$2)', [
        learnerPrincipal,
        teacher.projectId,
      ]),
    ).rejects.toMatchObject({ code: 'P5P01' });
    expect(await counts(teacher)).toEqual({ versions: 0, revisions: 0, states: 0 });
  });

  it('uses the existing public display name independently of whole-profile visibility without rewriting attribution history', async () => {
    const source = await fixture('safe-label');
    await admin.query(
      "UPDATE profiles SET display_name=$2,visibility='private' WHERE account_id=$1",
      [source.accountId, 'Мастер Север'],
    );
    const first = await publish(source);
    expect((await publicRead(first.publicationId)).rows[0].author_label).toBe('Мастер Север');
    const frozen = await admin.query(
      'SELECT to_jsonb(revision) AS value FROM project_publication_revisions revision WHERE id=$1',
      [first.revisionId],
    );
    await admin.query(
      "UPDATE profiles SET display_name='Public maker',visibility='restricted' WHERE account_id=$1",
      [source.accountId],
    );
    const current = (await publicRead(first.publicationId)).rows[0];
    expect(current.author_label).toBe('Public maker');
    expect(JSON.stringify(current)).not.toContain(source.teacher.email);
    expect(
      await admin.query(
        'SELECT to_jsonb(revision) AS value FROM project_publication_revisions revision WHERE id=$1',
        [first.revisionId],
      ),
    ).toMatchObject({ rows: frozen.rows });
    await expect(
      runtime.query('SELECT project_publication_author_label($1,$2)', [
        source.principalId,
        'other',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (await runtime.query('SELECT * FROM gallery_work(NULL,$1)', [source.projectId])).rows[0]
        .author_label,
    ).toBe('Public maker');
    const reader = await fixture('different-author');
    const saved = await collection(reader, source);
    expect(
      (
        await runtime.query('SELECT * FROM collection_items_list($1,$2)', [
          reader.principalId,
          saved,
        ])
      ).rows[0].author_label,
    ).toBe('Public maker');
    const second = await publish(source);
    expect(second).toMatchObject({
      publicationId: first.publicationId,
      revisionNo: 2,
      versionNo: 1,
    });
    expect((await publicRead(second.publicationId)).rows[0].author_label).toBe('Public maker');
  });

  it('keeps direct publication storage and unsafe helpers inaccessible and frozen raster columns immutable', async () => {
    const source = await fixture('privileges');
    const publication = await publish(source);
    const privileges = await admin.query(
      `SELECT
         has_table_privilege('asalab_app','public.project_publication_state','SELECT') AS state_read,
         has_table_privilege('asalab_app','public.project_publication_revisions','SELECT') AS revision_read,
         has_table_privilege('asalab_app','public.learning_project_origins','INSERT') AS origin_insert,
         has_table_privilege('asalab_app','public.learning_legacy_project_origins','INSERT') AS legacy_origin_insert,
         has_function_privilege('asalab_app','public.project_editor_has_immutable_learning_origin(uuid)','EXECUTE') AS classify_execute,
         EXISTS (
           SELECT 1 FROM pg_proc routine
           CROSS JOIN LATERAL aclexplode(COALESCE(routine.proacl,acldefault('f',routine.proowner))) permission
           WHERE routine.oid='public.project_editor_has_immutable_learning_origin(uuid)'::regprocedure
             AND permission.grantee=0 AND permission.privilege_type='EXECUTE'
         ) AS classify_public_execute,
         has_function_privilege('asalab_app','public.project_publication_policy_reason(uuid)','EXECUTE') AS policy_execute,
         has_function_privilege('asalab_app','public.project_publication_readable(uuid)','EXECUTE') AS readable_execute,
         has_function_privilege('asalab_app','public.project_publication_legacy_learning_guard(uuid,uuid)','EXECUTE') AS legacy_guard_execute,
         has_function_privilege('asalab_app','public.gallery_publish_unprotected(uuid,uuid)','EXECUTE') AS unprotected_execute`,
    );
    expect(privileges.rows[0]).toEqual({
      state_read: false,
      revision_read: false,
      origin_insert: false,
      legacy_origin_insert: false,
      classify_execute: true,
      classify_public_execute: false,
      policy_execute: false,
      readable_execute: false,
      legacy_guard_execute: false,
      unprotected_execute: false,
    });
    await expect(
      runtime.query('SELECT * FROM project_publication_revisions'),
    ).rejects.toMatchObject({ code: '42501' });
    // Use a genuinely fresh physical backend for the unset custom GUC, then
    // keep that exact backend through SET LOCAL/COMMIT and both tenant values.
    // A pooled SET LOCAL context becomes an empty string after COMMIT; that
    // must still produce the ACL refusal, never a UUID cast error or a row.
    const directPool = testAppPool();
    const directClient = await directPool.connect();
    try {
      const backendPid = (await directClient.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid as number;
      const assertStorageDenied = async (context: string | null) => {
        expect(
          (
            await directClient.query(
              "SELECT pg_backend_pid() AS pid,current_setting('app.tenant_id',true) AS context",
            )
          ).rows[0],
        ).toEqual({ pid: backendPid, context });
        expect(
          (
            await directClient.query(
              `SELECT project_editor_has_immutable_learning_origin($1) AS has_origin,
                      project_editor_has_immutable_learning_origin(NULL) AS missing`,
              [source.projectId],
            )
          ).rows,
        ).toEqual([{ has_origin: false, missing: false }]);
        for (const relation of [
          'project_publication_state',
          'project_publication_revisions',
          'learning_project_origins',
          'learning_legacy_project_origins',
        ]) {
          await expect(directClient.query(`SELECT * FROM ${relation}`)).rejects.toMatchObject({
            code: '42501',
          });
        }
      };
      await assertStorageDenied(null);
      await directClient.query('BEGIN');
      await directClient.query("SELECT set_config('app.tenant_id',$1,true)", [
        source.input.tenantId,
      ]);
      await directClient.query('COMMIT');
      await assertStorageDenied('');
      await directClient.query("SELECT set_config('app.tenant_id',$1,false)", [
        source.input.tenantId,
      ]);
      await assertStorageDenied(source.input.tenantId);
      const foreignTenant = crypto.randomUUID();
      await directClient.query("SELECT set_config('app.tenant_id',$1,false)", [foreignTenant]);
      await assertStorageDenied(foreignTenant);
      await directClient.query('RESET app.tenant_id');
      await assertStorageDenied('');
    } finally {
      await directClient.query('ROLLBACK');
      directClient.release(true);
      await directPool.end();
    }
    await expect(
      runtime.query('SELECT gallery_publish_unprotected($1,$2)', [
        source.principalId,
        source.projectId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      admin.query('UPDATE project_publication_revisions SET preview_image=$2 WHERE id=$1', [
        publication.revisionId,
        Buffer.alloc(64, 99),
      ]),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      admin.query('DELETE FROM project_publication_revisions WHERE id=$1', [
        publication.revisionId,
      ]),
    ).rejects.toMatchObject({ code: 'P0001' });
    expect((await publicImage(publication.publicationId)).rows[0].image).toEqual(
      Buffer.alloc(64, 17),
    );
  });
});
