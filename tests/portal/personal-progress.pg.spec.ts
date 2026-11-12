import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PNG } from 'pngjs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiModuleRegistry } from '../../apps/api/src/module-registry';
import { copyPublicProject } from '../../apps/api/src/public-project-copy';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { createEmptyThreeDDocument } from '../../contexts/three-d/domain/document';
import type { PersonalProgressSummaryV1 } from '../../packages/contracts/src/personal-progress';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';

let admin: pg.Pool;
let runtime: pg.Pool;
let repo: PgProjectRepository;
const sources: string[] = [];
type SqlSummary = Omit<PersonalProgressSummaryV1, 'groups'> & {
  groups: Omit<PersonalProgressSummaryV1['groups'], 'nextCursor'> & { nextGroupId: string | null };
};
beforeAll(() => {
  // These helpers fail closed without the same dedicated admin/app *_test DB.
  admin = testAdminPool();
  runtime = testAppPool();
  repo = new PgProjectRepository(runtime);
});
afterAll(async () => {
  try {
    if (sources.length)
      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=ANY($1::uuid[])",
        [sources],
      );
  } finally {
    await runtime?.end();
    await admin?.end();
  }
});

async function identity(teacher?: SeededTeacher) {
  const person = teacher ?? (await seedTeacher(admin, `progress-${randomUUID().slice(0, 8)}`));
  const linked = (
    await admin.query('SELECT * FROM auth_account_for_user($1,$2)', [
      person.tenantId,
      person.teacherId,
    ])
  ).rows[0]!;
  const account = linked.account_id as string,
    principal = linked.principal_id as string;
  await admin.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    account,
  ]);
  const token = randomUUID(),
    hash = hashSessionToken(token),
    legacyToken = randomUUID(),
    legacyHash = hashSessionToken(legacyToken);
  await admin.query(
    "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [principal, linked.workspace_id, hash],
  );
  await admin.query(
    "INSERT INTO sessions(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [person.tenantId, person.teacherId, legacyHash],
  );
  return {
    teacher: person,
    account,
    principal,
    token,
    hash,
    legacyHash,
    workspace: linked.workspace_id as string,
  };
}
type Identity = Awaited<ReturnType<typeof identity>>;

async function read(
  owner: Identity,
  after: string | null = null,
  hash = owner.hash,
): Promise<SqlSummary> {
  return (
    await runtime.query('SELECT public.personal_progress_summary($1,$2,$3,$4,$5) result', [
      'account',
      owner.account,
      owner.principal,
      hash,
      after,
    ])
  ).rows[0]!.result as SqlSummary;
}

async function source(owner: Identity, moduleKey: 'electronics' | 'three-d' = 'electronics') {
  const input = {
    tenantId: owner.teacher.tenantId,
    scope: 'personal' as const,
    classroomId: null,
    actor: { principalId: owner.principal, userId: owner.teacher.teacherId },
    moduleKey,
    title: 'Own confirmed progress source',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument:
      moduleKey === 'three-d'
        ? createEmptyThreeDDocument()
        : { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  };
  const created = await repo.createWithDraft(input);
  if (created.kind !== 'created') throw new Error('Progress source was not created');
  const projectId = created.project.id;
  sources.push(projectId);
  const png = new PNG({ width: 32, height: 32 });
  png.data.fill(255);
  expect(
    await repo.saveSnapshot({
      tenantId: input.tenantId,
      actor: input.actor,
      projectId,
      sourceRevision: 1,
      image: { bytes: PNG.sync.write(png), contentType: 'image/png', width: 32, height: 32 },
    }),
  ).not.toBeNull();
  const publish = async (title = 'Confirmed progress publication') => {
    const result = (
      await runtime.query('SELECT project_publication_publish($1,$2,$3::jsonb) result', [
        owner.principal,
        projectId,
        JSON.stringify({ title, license: 'public-domain' }),
      ])
    ).rows[0]!.result;
    if (!result.publication) throw new Error('Publication fixture was not admitted');
    return result.publication as { publicationId: string; revisionId: string; revisionNo: number };
  };
  const publication = await publish();
  const version = (
    await admin.query('SELECT project_version_id FROM project_publication_revisions WHERE id=$1', [
      publication.revisionId,
    ])
  ).rows[0]!.project_version_id as string;
  return { owner, input, projectId, publication, version, publish };
}
type Source = Awaited<ReturnType<typeof source>>;

async function like(source: Source, actor: Identity, on = true) {
  return runtime.query('SELECT publication_like_write($1,$2,$3,$4,$5)', [
    actor.principal,
    source.publication.publicationId,
    source.publication.revisionId,
    on,
    actor.hash,
  ]);
}

function copyInput(source: Source, recipient: Identity, key = randomUUID()) {
  return {
    ...source.input,
    tenantId: recipient.teacher.tenantId,
    actor: { userId: recipient.teacher.teacherId, principalId: recipient.principal },
    title: 'Real durable copy fixture',
    idempotencyKey: key,
    publicationCopyOrigin: {
      projectId: source.projectId,
      publicationId: source.publication.publicationId,
      revisionId: source.publication.revisionId,
      versionId: source.version,
      title: source.input.title,
      author: 'Isolated fixture author',
      license: 'public-domain' as const,
    },
  };
}

async function attach(owner: Identity, seat: string, organization = owner.teacher) {
  // The Account link guard requires persisted Seat evidence in this school.
  // Let the canonical helper create/reuse links; their lineage is immutable.
  const persisted = await admin.query(
    `UPDATE classroom_student_seats seat SET account_id=$2
     FROM classrooms classroom
     WHERE seat.id=$1 AND classroom.id=seat.classroom_id
      AND classroom.tenant_id=seat.tenant_id AND seat.tenant_id=$3 AND classroom.school_id=$4
     RETURNING seat.id`,
    [seat, owner.account, organization.tenantId, organization.schoolId],
  );
  expect(persisted.rows).toEqual([{ id: seat }]);
  const learner = (
    await admin.query('SELECT learning_audience_ensure_seat_identity($1) AS id', [seat])
  ).rows[0]!.id as string;
  expect(typeof learner).toBe('string');
  expect(
    (
      await admin.query(
        `SELECT count(*)::int n FROM learner_identity_links
         WHERE tenant_id=$1 AND school_id=$2 AND learner_identity_id=$3
          AND status='active' AND disabled_at IS NULL
          AND ((link_kind='student_seat' AND seat_id=$4) OR (link_kind='account' AND account_id=$5))`,
        [organization.tenantId, organization.schoolId, learner, seat, owner.account],
      )
    ).rows[0]!.n,
  ).toBe(2);
}

async function group(
  owner: Identity,
  organization = owner.teacher,
  classroomId = randomUUID(),
  existing = false,
) {
  const educator = (
    await admin.query('SELECT * FROM auth_account_for_user($1,$2)', [
      organization.tenantId,
      organization.teacherId,
    ])
  ).rows[0]!;
  if (!existing) {
    await admin.query(
      "INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,'Own progress group',$5)",
      [
        classroomId,
        organization.tenantId,
        organization.schoolId,
        organization.periodId,
        organization.teacherId,
      ],
    );
    await admin.query(
      "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
      [organization.tenantId, classroomId, organization.teacherId, educator.account_id],
    );
  }
  // A dynamic audience could initialize a fresh Seat during INSERT. This
  // fixture has no audience, so its first canonical identity is intentional.
  expect(
    (
      await admin.query(
        `SELECT EXISTS(SELECT 1 FROM learning_audience_definitions
         WHERE classroom_id=$1 AND status='active' AND audience_type='whole_class' AND mode='dynamic') present`,
        [classroomId],
      )
    ).rows[0]!.present,
  ).toBe(false);
  // existing=true also creates another pupil. Only a Seat of this same
  // Account in this classroom calls for the ambiguous canonical-link fixture.
  const sameClassLearner = (
    await admin.query<{ learner_identity_id: string }>(
      `SELECT seat_link.learner_identity_id FROM classroom_student_seats seat
       JOIN learner_identity_links seat_link ON seat_link.seat_id=seat.id
        AND seat_link.link_kind='student_seat' AND seat_link.status='active' AND seat_link.disabled_at IS NULL
       JOIN learner_identity_links account_link ON account_link.learner_identity_id=seat_link.learner_identity_id
        AND account_link.tenant_id=seat_link.tenant_id AND account_link.school_id=seat_link.school_id
        AND account_link.link_kind='account' AND account_link.account_id=$2
        AND account_link.status='active' AND account_link.disabled_at IS NULL
       JOIN learner_identities learner ON learner.id=seat_link.learner_identity_id
        AND learner.tenant_id=seat_link.tenant_id AND learner.school_id=seat_link.school_id AND learner.state='active'
       WHERE seat.classroom_id=$1 AND seat.account_id=$2 AND seat.status='active'`,
      [classroomId, owner.account],
    )
  ).rows[0]?.learner_identity_id;
  const handle = randomUUID().slice(0, 8);
  const seat = (
    await admin.query(
      `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by,account_id)
       VALUES($1,$2,'Isolated learner',$3,$3,true,'active',$4,$5) RETURNING id`,
      [
        organization.tenantId,
        classroomId,
        handle,
        organization.teacherId,
        sameClassLearner ? null : owner.account,
      ],
    )
  ).rows[0]!.id as string;
  if (sameClassLearner) {
    // Keep UNIQUE(classroom_id, account_id) and the first Seat's immutable
    // proof. This second, genuinely new Seat gets a new link, never a rewrite.
    await admin.query(
      `INSERT INTO learner_identity_links
       (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
       VALUES(gen_random_uuid(),$1,$2,$3,'student_seat',$4)`,
      [organization.tenantId, organization.schoolId, sameClassLearner, seat],
    );
    expect(
      (await admin.query('SELECT learning_audience_ensure_seat_identity($1) AS id', [seat]))
        .rows[0]!.id,
    ).toBe(sameClassLearner);
  } else {
    await attach(owner, seat, organization);
  }
  expect(
    (await admin.query('SELECT principal_id FROM student_seat_principal($1)', [seat])).rows,
  ).toHaveLength(1);
  return { classroomId, seat };
}

interface MeasuredPlanNode {
  index: number;
  parent: number;
  type: string;
  relation?: string | undefined;
  alias?: string | undefined;
  functionName?: string | undefined;
  subplan?: string | undefined;
  estimatedRows: number;
  actualRows: number;
  actualLoops: number;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
}

function measuredPlanNodes(plan: unknown): MeasuredPlanNode[] {
  const nodes: MeasuredPlanNode[] = [];
  const visit = (value: unknown, parent: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || nodes.length >= 256)
      throw new Error('Invalid or unbounded nested summary plan');
    const node = value as Record<string, unknown>;
    const name = (key: string) =>
      typeof node[key] === 'string' && /^[A-Za-z_][A-Za-z_ 0-9]*$/.test(node[key])
        ? node[key]
        : undefined;
    const number = (key: string, optional = false) => {
      const result = node[key];
      if (optional && result === undefined) return 0;
      if (typeof result !== 'number' || !Number.isFinite(result) || result < 0)
        throw new Error('Missing actual nested plan measurement');
      return result;
    };
    const type = name('Node Type');
    if (!type) throw new Error('Missing nested plan node type');
    const index = nodes.length;
    // Deliberately omit Query Text, Output, conditions, parameters and identifiers
    // embedded in expressions. CI evidence contains shape and measurements only.
    nodes.push({
      index,
      parent,
      type,
      relation: name('Relation Name'),
      alias: name('Alias'),
      functionName: name('Function Name'),
      subplan: name('Subplan Name'),
      estimatedRows: number('Plan Rows'),
      actualRows: number('Actual Rows'),
      actualLoops: number('Actual Loops'),
      sharedHitBlocks: number('Shared Hit Blocks', true),
      sharedReadBlocks: number('Shared Read Blocks', true),
    });
    if (node.Plans !== undefined) {
      if (!Array.isArray(node.Plans)) throw new Error('Invalid nested child plans');
      for (const child of node.Plans) visit(child, index);
    }
  };
  visit(plan, -1);
  return nodes;
}

async function instrumentedSummaryPlan(diagnostic: pg.PoolClient, owner: Identity) {
  // PostgreSQL's supplied module is loaded only in this disposable diagnostic
  // backend, after all latency samples. Missing module/notices are a failure.
  await diagnostic.query("LOAD 'auto_explain'");
  const settings = [
    'client_min_messages',
    'log_min_messages',
    'auto_explain.log_min_duration',
    'auto_explain.log_analyze',
    'auto_explain.log_buffers',
    'auto_explain.log_timing',
    'auto_explain.log_verbose',
    'auto_explain.log_format',
    'auto_explain.log_level',
    'auto_explain.log_nested_statements',
    'auto_explain.log_parameter_max_length',
    'auto_explain.sample_rate',
  ];
  const configuration = async () =>
    (
      await diagnostic.query(
        'SELECT name,setting FROM pg_settings WHERE name=ANY($1::text[]) ORDER BY name',
        [settings],
      )
    ).rows;
  const before = await configuration();
  expect(before).toHaveLength(settings.length);
  const plans: MeasuredPlanNode[][] = [];
  let malformed = 0;
  const notice = (message: { message?: string | undefined }) => {
    const json = message.message?.match(/plan:\s*([\s\S]+)$/)?.[1];
    if (!json) return;
    try {
      const parsed: unknown = JSON.parse(json);
      for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!value || typeof value !== 'object') continue;
        const statement = value as Record<string, unknown>;
        if (
          typeof statement['Query Text'] === 'string' &&
          statement['Query Text'].includes('WITH account_seats AS MATERIALIZED')
        )
          plans.push(measuredPlanNodes(statement.Plan));
      }
    } catch {
      // Never throw from a pg event listener or print a raw notice containing
      // bind values. Fail the diagnostic after the query has safely completed.
      malformed += 1;
    }
  };
  let transaction = false;
  diagnostic.on('notice', notice);
  try {
    await diagnostic.query('BEGIN READ ONLY');
    transaction = true;
    await diagnostic.query(`
      SET LOCAL client_min_messages='notice';
      SET LOCAL log_min_messages='warning';
      SET LOCAL auto_explain.log_analyze=true;
      SET LOCAL auto_explain.log_buffers=true;
      SET LOCAL auto_explain.log_timing=false;
      SET LOCAL auto_explain.log_verbose=true;
      SET LOCAL auto_explain.log_format='json';
      SET LOCAL auto_explain.log_level='notice';
      SET LOCAL auto_explain.log_nested_statements=true;
      SET LOCAL auto_explain.log_parameter_max_length=0;
      SET LOCAL auto_explain.sample_rate=1;
      SET LOCAL auto_explain.log_min_duration=0;
    `);
    const summary = (
      await diagnostic.query(
        "SELECT public.personal_progress_summary('account',$1,$2,$3,NULL) result",
        [owner.account, owner.principal, owner.hash],
      )
    ).rows[0]!.result as SqlSummary;
    expect(summary.groups.items).toHaveLength(3);
    expect(summary.metrics).toMatchObject({
      everPublishedWorks: { value: 1 },
      currentLikes: { value: 2 },
      createdCopies: { value: 3 },
      activePublicWorks: { value: 1 },
    });
  } finally {
    try {
      if (transaction) await diagnostic.query('ROLLBACK');
    } finally {
      diagnostic.removeListener('notice', notice);
    }
  }
  expect(await configuration()).toEqual(before);
  expect(malformed).toBe(0);
  expect(plans).toHaveLength(1);
  const nodes = plans[0]!;
  const relations = new Set(nodes.map((node) => node.relation));
  for (const relation of [
    'project_publication_state',
    'project_publication_revisions',
    'project_reactions',
    'publication_copy_events',
    'project_versions',
  ])
    expect(relations.has(relation), `nested summary reads ${relation}`).toBe(true);
  expect(
    nodes.filter((node) => node.type === 'Aggregate' && node.actualLoops > 0).length,
  ).toBeGreaterThanOrEqual(3);
  const metrics = nodes.filter(
    (node) =>
      node.functionName === 'classroom_participant_metrics' ||
      node.alias === 'classroom_participant_metrics',
  );
  expect(metrics).toHaveLength(1);
  expect(metrics[0]!.actualLoops).toBe(3);
  const page = nodes.filter((node) => node.subplan === 'CTE page');
  expect(page).toHaveLength(1);
  expect(page[0]!.actualRows).toBe(3);
  console.info(
    JSON.stringify({
      evidence: 'personal-progress-nested-summary-plan',
      boundary:
        'instrumented diagnostic of the actual nested aggregate statement; excluded from latency samples',
      fixture: { groups: 3, publications: 1, likes: 2, copies: 3 },
      nestedSummaryStatements: plans.length,
      nodes,
    }),
  );
}

describe('authorized own progress on real application-role PostgreSQL', () => {
  it('resolves modern and verified legacy Account with true zero and unknown historical coverage', async () => {
    const owner = await identity();
    const modern = await read(owner),
      legacy = await read(owner, null, owner.legacyHash);
    expect(modern.scope).toEqual({ kind: 'account', accountId: owner.account });
    expect(legacy.metrics).toEqual(modern.metrics);
    expect(modern.availability).toBe('available');
    expect(Object.values(modern.metrics).map((metric) => metric.value)).toEqual([0, 0, 0, 0]);
    expect(modern.groups).toMatchObject({
      availability: 'available',
      items: [],
      hasMore: false,
      nextGroupId: null,
    });
    expect(modern.personalRating).toEqual({ availability: 'not_enabled', value: null });
    expect(modern.coverage.everPublishedWorks).toMatchObject({
      completeness: 'unknown',
      knownSince: null,
    });
    expect(modern.coverage.createdCopies.limitations).toContain(
      'copies_not_supported_by_all_modules',
    );
    expect(Number.isFinite(Date.parse(modern.asOf!))).toBe(true);
    expect(JSON.stringify(modern)).not.toContain(owner.principal);
    expect(JSON.stringify(modern)).not.toContain(owner.hash);
  });

  it('revalidates foreign, revoked and inactive actors and preserves modern-first hash precedence', async () => {
    const owner = await identity(),
      foreign = await identity();
    await expect(read(owner, null, foreign.hash)).rejects.toMatchObject({ code: 'P6S01' });
    await admin.query(
      "INSERT INTO sessions(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [foreign.teacher.tenantId, foreign.teacher.teacherId, owner.hash],
    );
    await expect(read(foreign, null, owner.hash)).rejects.toMatchObject({ code: 'P6S01' });
    await admin.query('UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1', [
      foreign.hash,
    ]);
    await expect(read(foreign)).rejects.toMatchObject({ code: 'P6S01' });
    await admin.query(
      "UPDATE legacy_user_account_links SET migration_state='retired' WHERE account_id=$1",
      [foreign.account],
    );
    await expect(read(foreign, null, foreign.legacyHash)).rejects.toMatchObject({ code: 'P6S01' });
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [owner.account]);
    await expect(read(owner)).rejects.toMatchObject({ code: 'P6S01' });
  });

  it('counts unique confirmed works across modules and revisions and keeps hidden/withdrawn/trashed history', async () => {
    const owner = await identity(),
      reader = await identity();
    const first = await source(owner),
      second = await source(owner, 'three-d');
    await like(first, reader);
    const next = await first.publish('Same work, new immutable publication revision');
    expect(next.publicationId).toBe(first.publication.publicationId);
    expect(next.revisionNo).toBeGreaterThan(first.publication.revisionNo);
    first.publication = next;
    const initial = await read(owner);
    expect(initial.metrics.everPublishedWorks.value).toBe(2);
    expect(initial.metrics.currentLikes.value).toBe(1);
    expect(initial.metrics.activePublicWorks.value).toBe(2);
    await admin.query("UPDATE projects SET status='trashed' WHERE id=$1", [first.projectId]);
    expect((await read(owner)).metrics).toMatchObject({
      everPublishedWorks: { value: 2 },
      currentLikes: { value: 1 },
      activePublicWorks: { value: 1 },
    });
    await admin.query("UPDATE projects SET status='active' WHERE id=$1", [first.projectId]);
    await admin.query(
      "INSERT INTO project_publication_moderation(publication_id,hidden,reason,actor_principal_id) VALUES($1,true,'Isolated moderation proof',$2)",
      [first.publication.publicationId, owner.principal],
    );
    expect((await read(owner)).metrics).toMatchObject({
      everPublishedWorks: { value: 2 },
      currentLikes: { value: 1 },
      activePublicWorks: { value: 1 },
    });
    await admin.query('DELETE FROM project_publication_moderation WHERE publication_id=$1', [
      first.publication.publicationId,
    ]);
    await runtime.query('SELECT project_publication_revoke($1,$2)', [
      owner.principal,
      first.projectId,
    ]);
    expect((await read(owner)).metrics.everPublishedWorks.value).toBe(2);
    first.publication = await first.publish();
    await like(first, reader, false);
    expect((await read(owner)).metrics).toMatchObject({
      everPublishedWorks: { value: 2 },
      currentLikes: { value: 0 },
      activePublicWorks: { value: 2 },
    });
    expect(second.publication.publicationId).not.toBe(first.publication.publicationId);
  });

  describe('canonical public acquisition', () => {
    let policyFixtureLock: pg.PoolClient | undefined;
    let previousEnabled: boolean | undefined;
    let lockHeld = false;

    async function restorePolicy() {
      const client = policyFixtureLock;
      policyFixtureLock = undefined;
      if (!client) return;
      try {
        if (previousEnabled !== undefined)
          await client.query(
            'UPDATE publication_acquisition_settings SET enabled=$1 WHERE singleton_key',
            [previousEnabled],
          );
      } finally {
        try {
          if (lockHeld)
            await client.query(
              "SELECT pg_advisory_unlock(hashtextextended('test-public-acquisition-policy',0))",
            );
        } finally {
          lockHeld = false;
          client.release(true);
        }
      }
    }

    beforeAll(async () => {
      const client = await admin.connect();
      policyFixtureLock = client;
      try {
        await client.query(
          "SELECT pg_advisory_lock(hashtextextended('test-public-acquisition-policy',0))",
        );
        lockHeld = true;
        const settings = await client.query<{ enabled: boolean }>(
          'SELECT enabled FROM publication_acquisition_settings WHERE singleton_key',
        );
        expect(settings.rows).toHaveLength(1);
        previousEnabled = settings.rows[0]!.enabled;
        await client.query(
          'UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key',
        );
      } catch (error) {
        await restorePolicy();
        throw error;
      }
      // Only shared fixture-lock waiting uses the existing acquisition-suite budget.
      // The concurrent copy case keeps the default 5s deadline.
    }, 90_000);
    afterAll(restorePolicy);

    it('separates like/copy aggregates and retains transactional, idempotent receipts after destination deletion', async () => {
      const owner = await identity(),
        reader = await identity(),
        other = await identity();
      const personalTenants = await Promise.all(
        [owner, reader, other].map(async (person) => {
          // seedTeacher creates only an organization workspace. Use the existing
          // personal-workspace fixture pattern, without a legacy user in this tenant.
          const tenantId = randomUUID(),
            workspaceId = randomUUID();
          await admin.query('INSERT INTO tenants(id,title,workspace_slug) VALUES($1,$2,$3)', [
            tenantId,
            'Progress copy personal workspace',
            `progress-personal-${tenantId}`,
          ]);
          await admin.query(
            "INSERT INTO tenant_placements(tenant_id,mode) VALUES($1,'SHARED_CLUSTER')",
            [tenantId],
          );
          await admin.query(
            "INSERT INTO workspaces(id,tenant_id,kind,title,status) VALUES($1,$2,'personal',$3,'active')",
            [workspaceId, tenantId, 'Progress copy personal workspace'],
          );
          await admin.query(
            "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$2,'owner','active')",
            [person.account, workspaceId],
          );
          return tenantId;
        }),
      );
      const publication = await source(owner, 'three-d');
      await runtime.query('SELECT project_publication_acquisition_write($1,$2,true,0,$3,NULL)', [
        owner.principal,
        publication.projectId,
        publication.publication.revisionId,
      ]);
      await Promise.all([like(publication, reader), like(publication, other)]);
      const registry = createApiModuleRegistry();
      const input = {
        pool: runtime,
        registry,
        principalId: reader.principal,
        publicationId: publication.publication.publicationId,
        revisionId: publication.publication.revisionId,
        idempotencyKey: randomUUID(),
      };
      const copies = await Promise.all([copyPublicProject(input), copyPublicProject(input)]);
      expect(copies.map((result) => result.created).sort()).toEqual([false, true]);
      expect(copies[0]!.projectId).toBe(copies[1]!.projectId);
      const created = copies.find((result) => result.created);
      if (!created) throw new Error('Copy fixture not created');
      const destination = await admin.query(
        'SELECT tenant_id,created_by,owner_principal_id FROM projects WHERE id=$1',
        [created.projectId],
      );
      expect(destination.rows).toEqual([
        { tenant_id: personalTenants[1], created_by: null, owner_principal_id: reader.principal },
      ]);
      expect(
        (
          await copyPublicProject({
            ...input,
            principalId: other.principal,
            idempotencyKey: randomUUID(),
          })
        ).created,
      ).toBe(true);
      expect(
        (
          await copyPublicProject({
            ...input,
            principalId: owner.principal,
            idempotencyKey: randomUUID(),
          })
        ).created,
      ).toBe(true);
      expect((await read(owner)).metrics).toMatchObject({
        everPublishedWorks: { value: 1 },
        currentLikes: { value: 2 },
        createdCopies: { value: 3 },
      });
      const transaction = await admin.connect();
      try {
        await transaction.query('BEGIN');
        await transaction.query(
          `INSERT INTO projects(id,tenant_id,project_scope,module_key,title,created_by,owner_principal_id,
        copied_from_project_id,copied_from_author,copied_from_title,copied_at,copied_from_publication_id,copied_from_revision_id,copied_from_version_id,copied_from_license,license)
        SELECT $2,tenant_id,project_scope,module_key,title,created_by,owner_principal_id,
        copied_from_project_id,copied_from_author,copied_from_title,copied_at,copied_from_publication_id,copied_from_revision_id,copied_from_version_id,copied_from_license,license
        FROM projects WHERE id=$1`,
          [created.projectId, randomUUID()],
        );
        const inside = (
          await transaction.query(
            "SELECT personal_progress_summary('account',$1,$2,$3,NULL) result",
            [owner.account, owner.principal, owner.hash],
          )
        ).rows[0]!.result;
        expect(inside.metrics.createdCopies.value).toBe(4);
        expect((await read(owner)).metrics.createdCopies.value).toBe(3);
        await transaction.query('ROLLBACK');
      } finally {
        await transaction.query('ROLLBACK');
        transaction.release();
      }
      await admin.query('DELETE FROM project_drafts WHERE project_id=$1', [created.projectId]);
      await admin.query('DELETE FROM projects WHERE id=$1', [created.projectId]);
      expect((await read(owner)).metrics.createdCopies.value).toBe(3);
      await like(publication, reader, false);
      expect((await read(owner)).metrics.currentLikes.value).toBe(1);
    });
  });

  it('keeps authorized archived/suspended history separate from groups and never gives linked Account history to Seat', async () => {
    const seat = await studentProjectPolicyFixture(admin, runtime);
    const owner = await identity(seat.teacher);
    await source(owner);
    await seat.write({ publish: true, download: false, expectedVersion: 0 });
    const published = await seat.publish();
    expect(published.publication).toBeDefined();
    sources.push(seat.projectId);
    await attach(owner, seat.seatId);
    await group(owner);
    const before = await read(owner);
    expect(before.metrics.everPublishedWorks.value).toBe(2);
    expect(before.groups.items).toHaveLength(2);
    const ownSeat = (
      await runtime.query("SELECT personal_progress_summary('seat',$1,$2,$3,NULL) result", [
        seat.seatId,
        seat.principal,
        seat.hash,
      ])
    ).rows[0]!.result as SqlSummary;
    expect(ownSeat.metrics.everPublishedWorks.value).toBe(1);
    expect(ownSeat.groups.items?.map((item) => item.groupId)).toEqual([seat.classroomId]);
    expect(JSON.stringify(ownSeat)).not.toContain(owner.account);
    await admin.query("UPDATE classrooms SET status='archived' WHERE id=$1", [seat.classroomId]);
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      seat.seatId,
    ]);
    expect((await read(owner)).metrics.everPublishedWorks.value).toBe(2);
    expect((await read(owner)).groups.items).toHaveLength(1);
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1 AND school_id=$2",
      [owner.account, owner.teacher.schoolId],
    );
    const revoked = await read(owner);
    expect(revoked.metrics.everPublishedWorks.value).toBe(1);
    expect(revoked.groups.items).toEqual([]);
  });

  it('keeps existing fractional, zero, null and tied canonical ranks without combining multiple own Seats', async () => {
    const owner = await identity();
    const one = await group(owner);
    await source(owner);
    const peer = await identity();
    const peerSeat = await group(peer, owner.teacher, one.classroomId, true);
    await source(peer);
    await admin.query(
      `INSERT INTO classroom_participant_settings(classroom_id,period_days,factors)
      VALUES($1,30,'{"projects":true,"logins":false,"days":false,"time":false,"grades":false}')`,
      [one.classroomId],
    );
    const canonical = (
      await admin.query(
        "SELECT item FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2",
        [one.classroomId, one.seat],
      )
    ).rows[0]!.item;
    const result = (await read(owner)).groups.items?.[0];
    expect(result?.periodDays).toBe(30);
    expect(result?.own).toEqual({
      availability: 'available',
      score: canonical.score,
      rank: canonical.rank,
    });
    expect(canonical.score).toBe(4);
    const peerCanonical = (
      await admin.query(
        "SELECT item FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2",
        [one.classroomId, peerSeat.seat],
      )
    ).rows[0]!.item;
    expect({ score: peerCanonical.score, rank: peerCanonical.rank }).toEqual({
      score: 4,
      rank: canonical.rank,
    });
    await admin.query(
      'UPDATE classroom_participant_settings SET period_days=90 WHERE classroom_id=$1',
      [one.classroomId],
    );
    const fractional = (await read(owner)).groups.items?.[0];
    expect(fractional?.own.score).toBe(1.54);
    await admin.query(
      `UPDATE classroom_participant_settings SET period_days=7,factors='{"projects":false,"logins":false,"days":false,"time":false,"grades":true}' WHERE classroom_id=$1`,
      [one.classroomId],
    );
    expect((await read(owner)).groups.items?.[0]?.own).toEqual({
      availability: 'available',
      score: 0,
      rank: 1,
    });
    await admin.query(
      `UPDATE classroom_participant_settings SET factors='{"projects":false,"logins":false,"days":false,"time":false,"grades":false}' WHERE classroom_id=$1`,
      [one.classroomId],
    );
    const noFactors = await read(owner);
    expect(noFactors.groups.items?.[0]?.own).toEqual({
      availability: 'available',
      score: null,
      rank: null,
    });
    expect(noFactors.availability).toBe('available');
    await group(owner, owner.teacher, one.classroomId, true);
    const ambiguous = await read(owner);
    expect(ambiguous.groups.items).toHaveLength(1);
    expect(ambiguous.groups.items?.[0]?.own).toEqual({
      availability: 'unavailable',
      score: null,
      rank: null,
      reason: 'ambiguous_self_participant',
    });
    expect(ambiguous.availability).toBe('partial');
  });

  it('bounds distinct groups with 20+1 and includes proven other-workspace memberships without changing statistics by page', async () => {
    const owner = await identity();
    await source(owner);
    const ids: string[] = [];
    for (let index = 0; index < 20; index++) ids.push((await group(owner)).classroomId);
    const otherOrganization = await seedTeacher(
      admin,
      `progress-other-${randomUUID().slice(0, 8)}`,
    );
    ids.push((await group(owner, otherOrganization)).classroomId);
    const first = await read(owner);
    expect(first.metrics.everPublishedWorks.value).toBe(1);
    expect(first.groups.items).toHaveLength(20);
    expect(first.groups.hasMore).toBe(true);
    expect(first.groups.nextGroupId).toBe(first.groups.items?.at(-1)?.groupId);
    const next = await read(owner, first.groups.nextGroupId);
    expect(next.groups.items).toHaveLength(1);
    expect(next.groups.hasMore).toBe(false);
    expect(next.metrics).toEqual(first.metrics);
    expect([...first.groups.items!, ...next.groups.items!].map((item) => item.groupId)).toEqual(
      ids.sort(),
    );
    expect(first.groups).not.toHaveProperty('total');
    expect(first.groups.items?.every((item) => !('peers' in item) && !('members' in item))).toBe(
      true,
    );
  });

  it('keeps caller settings/read-only and raw table boundaries intact', async () => {
    const owner = await identity();
    await group(owner);
    const client = await runtime.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const before = (
        await client.query(
          "SELECT current_setting('search_path') path,current_setting('TimeZone') zone,current_setting('jit') jit,current_setting('transaction_read_only') ro",
        )
      ).rows;
      await client.query("SELECT public.personal_progress_summary('account',$1,$2,$3,NULL)", [
        owner.account,
        owner.principal,
        owner.hash,
      ]);
      expect(
        (
          await client.query(
            "SELECT current_setting('search_path') path,current_setting('TimeZone') zone,current_setting('jit') jit,current_setting('transaction_read_only') ro",
          )
        ).rows,
      ).toEqual(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    for (const table of [
      'project_publication_state',
      'project_publication_revisions',
      'publication_copy_events',
    ]) {
      expect(
        (
          await admin.query("SELECT has_table_privilege('asalab_app',$1,'SELECT') allowed", [
            `public.${table}`,
          ])
        ).rows[0]!.allowed,
      ).toBe(false);
    }
    const metadata = (
      await admin.query(`SELECT provolatile,prosecdef,proconfig,
      has_function_privilege('asalab_app',oid,'EXECUTE') app,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) acl WHERE grantee=0 AND privilege_type='EXECUTE') public
      FROM pg_proc WHERE oid='public.personal_progress_summary(text,uuid,uuid,text,uuid)'::regprocedure`)
    ).rows[0]!;
    expect(metadata).toMatchObject({ provolatile: 's', prosecdef: true, app: true, public: false });
    expect(metadata.proconfig).toContain('search_path=pg_catalog, pg_temp');
  });

  it('records bounded SQL baseline and summary p50/p95 on the same real fixtures without inventing an HTTP speedup', async () => {
    const owner = await identity();
    const groups = [await group(owner), await group(owner), await group(owner)];
    const publication = await source(owner);
    const firstRecipient = await identity(),
      secondRecipient = await identity();
    await like(publication, firstRecipient);
    await like(publication, secondRecipient);
    for (const recipient of [firstRecipient, secondRecipient, firstRecipient])
      expect((await repo.createWithDraft(copyInput(publication, recipient))).kind).toBe('created');
    const baseline: number[] = [],
      summary: number[] = [];
    // The old metrics helper is deliberately not executable by asalab_app.
    // Compare both SQL paths on the same physical diagnostic connection/role;
    // all functional summary cases above still use the restricted runtime role.
    const diagnostic = await admin.connect();
    try {
      expect(
        [null, '-1'].includes(
          (
            await diagnostic.query(
              "SELECT current_setting('auto_explain.log_min_duration',true) duration",
            )
          ).rows[0]!.duration,
        ),
      ).toBe(true);
      for (let round = 0; round < 6; round++) {
        let start = performance.now();
        const previous = [];
        for (const entry of groups)
          previous.push(
            (
              await diagnostic.query(
                "SELECT item FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2",
                [entry.classroomId, entry.seat],
              )
            ).rows[0]!.item,
          );
        const oldMs = performance.now() - start;
        start = performance.now();
        const actual = (
          await diagnostic.query(
            "SELECT public.personal_progress_summary('account',$1,$2,$3,NULL) result",
            [owner.account, owner.principal, owner.hash],
          )
        ).rows[0]!.result as SqlSummary;
        const newMs = performance.now() - start;
        expect(actual.groups.items).toHaveLength(3);
        for (let index = 0; index < groups.length; index++) {
          const own = actual.groups.items!.find(
            (item) => item.groupId === groups[index]!.classroomId,
          )!.own;
          expect({ score: own.score, rank: own.rank }).toEqual({
            score: previous[index].score,
            rank: previous[index].rank,
          });
        }
        if (round > 0) {
          baseline.push(oldMs);
          summary.push(newMs);
        }
      }
      await instrumentedSummaryPlan(diagnostic, owner);
    } finally {
      // Unload the session-only module by closing this physical backend rather
      // than returning a diagnostic connection to the fixture pool.
      diagnostic.release(true);
    }
    const quantiles = (values: number[]) => {
      const ordered = values.slice().sort((a, b) => a - b);
      return {
        samples: ordered.length,
        p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
        p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
      };
    };
    console.info(
      JSON.stringify({
        evidence: 'personal-progress-sql-baseline',
        groups: 3,
        baselineQueries: 3,
        summaryQueries: 1,
        baseline: quantiles(baseline),
        summary: quantiles(summary),
        boundary:
          'Non-equivalent workloads on one physical admin connection: baseline is three canonical group-metrics calls; candidate is full authorized publication/group summary. Uninstrumented latency samples; HTTP application-role guard/resolver round trips measured separately. No old HTTP endpoint, speedup or SLA claim.',
      }),
    );
  });
});
