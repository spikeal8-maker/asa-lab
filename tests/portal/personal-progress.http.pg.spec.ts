import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import type pg from 'pg';
import type { PersonalProgressSummaryV1 } from '@asa-lab/contracts';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { buildTestApp, WEB_ORIGIN, type NestApp } from './app';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';

// app.ts imports the built API. General must build this SHA's API before this
// suite; neither absent PostgreSQL nor a stale dist is a passing HTTP check.
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp | undefined;
let baseUrl: string;
const publishedProjects: string[] = [];
const ACCOUNT_ROUTE = '/api/progress/summary';
const SEAT_ROUTE = '/api/class-join/progress/summary';
const preview = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQCu34TwlmGDVg1IBRA4aLAQDLpv4Q+i0QiwAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  const role = await runtime.query(
    'SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
  );
  expect(role.rows).toEqual([{ name: 'asalab_app', rolsuper: false, rolbypassrls: false }]);
  app = await buildTestApp(runtime);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  try {
    if (admin && publishedProjects.length) {
      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=COALESCE(revoked_at,now()) WHERE project_id=ANY($1::uuid[])",
        [publishedProjects],
      );
    }
  } finally {
    try {
      if (app) await app.close();
      else if (runtime) await runtime.end();
    } finally {
      await admin?.end();
    }
  }
});

async function request(path: string, cookies: Record<string, string> = {}) {
  const response = await fetch(baseUrl + path, {
    headers: {
      origin: WEB_ORIGIN,
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
      'if-none-match': '*',
    },
  });
  const text = await response.text();
  const body: unknown = JSON.parse(text);
  return { status: response.status, headers: response.headers, body, text };
}

async function post(path: string, body: unknown, cookies: Record<string, string> = {}) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      origin: WEB_ORIGIN,
      'content-type': 'application/json',
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: JSON.parse(text) as unknown,
    text,
  };
}

function successful(result: Awaited<ReturnType<typeof request>>): PersonalProgressSummaryV1 {
  expect(result.status, result.text).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(result.body).toBeTypeOf('object');
  const value = result.body as PersonalProgressSummaryV1;
  expect(Object.keys(value).sort()).toEqual(
    ['scope', 'asOf', 'availability', 'metrics', 'coverage', 'personalRating', 'groups'].sort(),
  );
  expect(Number.isFinite(Date.parse(value.asOf ?? ''))).toBe(true);
  expect(value.personalRating).toEqual({ availability: 'not_enabled', value: null });
  const metricNames = [
    'everPublishedWorks',
    'currentLikes',
    'createdCopies',
    'activePublicWorks',
  ] as const;
  expect(Object.keys(value.metrics).sort()).toEqual([...metricNames].sort());
  expect(Object.keys(value.coverage).sort()).toEqual([...metricNames].sort());
  for (const metric of metricNames) {
    expect(Object.keys(value.metrics[metric]).sort()).toEqual(['availability', 'value']);
    expect(value.metrics[metric].availability).toBe('available');
    expect(Number.isSafeInteger(value.metrics[metric].value)).toBe(true);
    expect(value.metrics[metric].value).toBeGreaterThanOrEqual(0);
    expect(Object.keys(value.coverage[metric]).sort()).toEqual(
      ['basis', 'completeness', 'knownSince', 'limitations'].sort(),
    );
    expect(value.coverage[metric].knownSince).toBeNull();
  }
  expect(Object.keys(value.groups).sort()).toEqual(
    ['availability', 'items', 'hasMore', 'nextCursor'].sort(),
  );
  expect(value.groups.items).not.toBeNull();
  for (const group of value.groups.items ?? []) {
    expect(Object.keys(group).sort()).toEqual(['groupId', 'title', 'periodDays', 'own'].sort());
    expect([7, 30, 90]).toContain(group.periodDays);
    expect(Object.keys(group.own).sort()).toEqual(
      (group.own.availability === 'available'
        ? ['availability', 'score', 'rank']
        : ['availability', 'score', 'rank', 'reason']
      ).sort(),
    );
  }
  expect(result.text).not.toMatch(
    /"(?:principalId|tenantId|email|displayName|studentCode|loginHandle|lastActiveAt|grades|factors|sources|avatarUrl|totalMembers|nextGroupId)"\s*:/,
  );
  return value;
}

function values(summary: PersonalProgressSummaryV1) {
  return Object.fromEntries(
    Object.entries(summary.metrics).map(([name, metric]) => [name, metric.value]),
  );
}

async function identity(verified = true) {
  const teacher = await seedTeacher(admin, `progress-http-${randomUUID().slice(0, 8)}`);
  const identityRow = (
    await admin.query<{ account_id: string; principal_id: string; workspace_id: string }>(
      `SELECT link.account_id,link.principal_id,membership.workspace_id
       FROM legacy_user_account_links link
       JOIN workspace_memberships membership ON membership.account_id=link.account_id
       WHERE link.tenant_id=$1 AND link.user_id=$2`,
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0]!;
  const accountId = identityRow.account_id;
  const principalId = identityRow.principal_id;
  await admin.query('UPDATE accounts SET email_verification_state=$2 WHERE id=$1', [
    accountId,
    verified ? 'verified' : 'unverified',
  ]);
  const modernToken = randomUUID();
  const legacyToken = randomUUID();
  const modernHash = hashSessionToken(modernToken);
  const legacyHash = hashSessionToken(legacyToken);
  await admin.query(
    "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [principalId, identityRow.workspace_id, modernHash],
  );
  await admin.query(
    "INSERT INTO sessions(tenant_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [teacher.tenantId, teacher.teacherId, legacyHash],
  );
  return {
    teacher,
    accountId,
    principalId,
    modernHash,
    legacyHash,
    modern: { asa_session: modernToken },
    legacy: { asa_session: legacyToken },
  };
}

type Identity = Awaited<ReturnType<typeof identity>>;

async function publishAccount(owner: Identity) {
  const repo = new PgProjectRepository(runtime);
  const actor = { principalId: owner.principalId, userId: owner.teacher.teacherId };
  const created = await repo.createWithDraft({
    tenantId: owner.teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: `PRIVATE_PROGRESS_WORK_${randomUUID()}`,
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  });
  if (created.kind !== 'created') throw new Error('Progress fixture project was not created');
  const projectId = created.project.id;
  publishedProjects.push(projectId);
  expect(
    await repo.saveSnapshot({
      tenantId: owner.teacher.tenantId,
      actor,
      projectId,
      sourceRevision: 1,
      image: { bytes: preview, contentType: 'image/png', width: 16, height: 16 },
    }),
  ).not.toBeNull();
  await runtime.query('SELECT project_publication_publish($1,$2,$3::jsonb)', [
    owner.principalId,
    projectId,
    JSON.stringify({ title: 'Progress HTTP publication', license: 'reserved' }),
  ]);
  return projectId;
}

async function seatIdentity(materialized = true) {
  const owner = await identity();
  const classroomId = randomUUID();
  await admin.query(
    "INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,'Progress HTTP class',$5)",
    [
      classroomId,
      owner.teacher.tenantId,
      owner.teacher.schoolId,
      owner.teacher.periodId,
      owner.teacher.teacherId,
    ],
  );
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [owner.teacher.tenantId, classroomId, owner.teacher.teacherId, owner.accountId],
  );
  let seatId: string;
  if (materialized) {
    seatId = (
      await admin.query<{ id: string }>(
        "SELECT id FROM classroom_management_add_seat($1,$2,'PRIVATE_PROGRESS_SEAT',$3,true)",
        [owner.accountId, classroomId, randomUUID().slice(0, 8)],
      )
    ).rows[0]!.id;
    await admin.query("UPDATE classroom_student_seats SET status='active' WHERE id=$1", [seatId]);
  } else {
    // Historical missing-owner state is created directly. No existing
    // principal/link is deleted, and no constructor is called to repair it.
    seatId = randomUUID();
    await admin.query(
      `INSERT INTO classroom_student_seats
       (id,tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,status,created_by)
       VALUES($1,$2,$3,'PRIVATE_MISSING_OWNER','missing-owner','missing-owner','active',$4)`,
      [seatId, owner.teacher.tenantId, classroomId, owner.teacher.teacherId],
    );
  }
  const token = randomUUID();
  const hash = hashSessionToken(token);
  await admin.query(
    `INSERT INTO classroom_seat_credentials(seat_id,credential_hash,version,last_request_id,issued_by_account_id)
     VALUES($1,$2,1,$3,$4)`,
    [seatId, hash, randomUUID(), owner.accountId],
  );
  await admin.query(
    "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)",
    [seatId, hash],
  );
  return { owner, classroomId, seatId, hash, cookies: { asa_student_session: token } };
}

async function measuredRead(path: string, cookies: Record<string, string>, label: string) {
  // pg-pool emits acquire before handing the client to either pool.query or
  // explicit connect callers. Observe this API pool's client SQL during one
  // real HTTP read, including guards/resolvers, without counting a query twice.
  // Call-through spies retain both callback and Promise overloads unchanged.
  const spies = new Map<pg.PoolClient, MockInstance<pg.PoolClient['query']>>();
  const observeClient = (client: pg.PoolClient) => {
    if (!spies.has(client)) spies.set(client, vi.spyOn(client, 'query'));
  };
  runtime.on('acquire', observeClient);
  try {
    const result = await request(path, cookies);
    const statements = [...spies.values()].flatMap((spy) =>
      spy.mock.calls.map(([query]) => {
        const argument: unknown = query;
        return typeof argument === 'string'
          ? argument
          : typeof argument === 'object' && argument !== null && 'text' in argument
            ? String(argument.text)
            : '';
      }),
    );
    const summaryReads = statements.filter((sql) =>
      sql.includes('personal_progress_summary'),
    ).length;
    const accountResolutions = statements.filter((sql) =>
      sql.includes('session_v2_context'),
    ).length;
    const seatResolutions = statements.filter((sql) =>
      sql.includes('classroom_student_session_context'),
    ).length;
    console.info('personal-progress HTTP query observation', {
      label,
      httpRequests: 1,
      sqlRoundtrips: statements.length,
      summaryReads,
      accountResolutions,
      seatResolutions,
    });
    return { result, summaryReads, accountResolutions, seatResolutions };
  } finally {
    runtime.removeListener('acquire', observeClient);
    for (const spy of spies.values()) spy.mockRestore();
  }
}

async function addOwnGroups(owner: Identity, count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    classroom: randomUUID(),
    seat: randomUUID(),
    title: `Progress group ${index + 1}`,
  }));
  await admin.query(
    `INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by)
     SELECT row.classroom,$1,$2,$3,row.title,$4
     FROM jsonb_to_recordset($5::jsonb) AS row(classroom uuid,title text)`,
    [
      owner.teacher.tenantId,
      owner.teacher.schoolId,
      owner.teacher.periodId,
      owner.teacher.teacherId,
      JSON.stringify(items),
    ],
  );
  await admin.query(
    `INSERT INTO classroom_student_seats
     (id,tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,status,created_by,account_id)
     SELECT row.seat,$1,row.classroom,'PRIVATE_GROUP_LEARNER','owner','owner','active',$2,$3
     FROM jsonb_to_recordset($4::jsonb) AS row(classroom uuid,seat uuid)`,
    [owner.teacher.tenantId, owner.teacher.teacherId, owner.accountId, JSON.stringify(items)],
  );
  const learner = randomUUID();
  await admin.query('INSERT INTO learner_identities(id,tenant_id,school_id) VALUES($1,$2,$3)', [
    learner,
    owner.teacher.tenantId,
    owner.teacher.schoolId,
  ]);
  await admin.query(
    `INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,seat_id)
     SELECT gen_random_uuid(),$1,$2,$3,'student_seat',row.seat
     FROM jsonb_to_recordset($4::jsonb) AS row(seat uuid)`,
    [owner.teacher.tenantId, owner.teacher.schoolId, learner, JSON.stringify(items)],
  );
  await admin.query(
    `INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
     VALUES($1,$2,$3,$4,'account',$5)`,
    [randomUUID(), owner.teacher.tenantId, owner.teacher.schoolId, learner, owner.accountId],
  );
  return items.map((item) => item.classroom).sort();
}

describe('personal progress genuine HTTP with restricted PostgreSQL', () => {
  it('shows an ordinary Account group only after authorized approval in a class without an audience', async () => {
    const owner = await identity();
    const foreignTeacher = await identity();
    const unique = randomUUID().replaceAll('-', '');
    const registered = await post('/api/auth/register', {
      email: `progress-join-${unique}@isolated.test`,
      username: `progress_${unique.slice(0, 20)}`,
      displayName: 'Обычный участник',
      password: `Progress-${unique}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    });
    expect(registered.status, registered.text).toBe(201);
    const sessionCookie = registered.headers
      .getSetCookie()
      .find((value) => value.startsWith('asa_session='));
    const sessionToken = sessionCookie?.match(/^asa_session=([^;]+)/)?.[1];
    if (!sessionToken) throw new Error('Ordinary registration returned no Account session');
    const cookies = { asa_session: decodeURIComponent(sessionToken) };
    const account = (
      await admin.query<{ account_id: string; principal_id: string; workspace_kind: string }>(
        `SELECT principal.account_id,principal.id principal_id,workspace.kind workspace_kind
         FROM sessions_v2 session JOIN principals principal ON principal.id=session.principal_id
         JOIN workspaces workspace ON workspace.id=session.active_workspace_id
         WHERE session.token_hash=$1`,
        [hashSessionToken(cookies.asa_session)],
      )
    ).rows[0]!;
    expect(account.workspace_kind).toBe('personal');
    const classrooms: { id: string; code: string }[] = [];
    for (const title of ['Approved empty group', 'Rejected empty group']) {
      const id = randomUUID();
      await admin.query(
        `INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          owner.teacher.tenantId,
          owner.teacher.schoolId,
          owner.teacher.periodId,
          title,
          owner.teacher.teacherId,
        ],
      );
      await admin.query(
        `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
         VALUES($1,$2,$3,$4,'owner')`,
        [owner.teacher.tenantId, id, owner.teacher.teacherId, owner.accountId],
      );
      const rotated = await post(`/api/classrooms/${id}/join-code/rotate`, {}, owner.modern);
      expect(rotated.status, rotated.text).toBe(201);
      const code = (rotated.body as { classroom: { joinCode: string } }).classroom.joinCode;
      expect(code).toBeTypeOf('string');
      expect(code.length).toBeGreaterThan(0);
      classrooms.push({ id, code });
    }
    expect(
      (
        await admin.query(
          'SELECT id FROM learning_audience_definitions WHERE classroom_id=ANY($1::uuid[])',
          [classrooms.map((row) => row.id)],
        )
      ).rows,
    ).toEqual([]);
    expect(successful(await request(ACCOUNT_ROUTE, cookies)).groups.items).toEqual([]);

    const acceptedGroup = classrooms[0]!;
    const pending = await post('/api/class-join/account', { code: acceptedGroup.code }, cookies);
    expect(pending.status, pending.text).toBe(200);
    const pendingBody = pending.body as {
      status: string;
      requestId: string;
      seatId: string | null;
    };
    expect(pendingBody).toMatchObject({ status: 'pending', seatId: null });
    const decisionRoute = `/api/class-join/requests/${acceptedGroup.id}/${pendingBody.requestId}/decision`;
    for (const unauthorized of [cookies, foreignTeacher.modern]) {
      expect((await post(decisionRoute, { decision: 'approved' }, unauthorized)).status).toBe(409);
    }
    expect(successful(await request(ACCOUNT_ROUTE, cookies)).groups.items).toEqual([]);
    expect(
      (
        await admin.query(
          'SELECT status,seat_id FROM classroom_account_join_requests WHERE id=$1',
          [pendingBody.requestId],
        )
      ).rows,
    ).toEqual([{ status: 'pending', seat_id: null }]);
    expect(
      (
        await admin.query('SELECT id FROM classroom_student_seats WHERE account_id=$1', [
          account.account_id,
        ])
      ).rows,
    ).toEqual([]);

    const approved = await post(decisionRoute, { decision: 'approved' }, owner.modern);
    expect(approved.status, approved.text).toBe(201);
    const summary = successful(await request(ACCOUNT_ROUTE, cookies));
    expect(summary.groups.items?.map((row) => row.groupId)).toEqual([acceptedGroup.id]);
    const seat = (
      await admin.query<{ id: string }>(
        "SELECT id FROM classroom_student_seats WHERE classroom_id=$1 AND account_id=$2 AND status='active'",
        [acceptedGroup.id, account.account_id],
      )
    ).rows[0]!;
    expect(
      (await admin.query('SELECT id FROM classroom_participant_principals($1)', [seat.id])).rows,
    ).toContainEqual({ id: account.principal_id });
    expect(
      (
        await admin.query(
          'SELECT id FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2',
          [acceptedGroup.id, account.account_id],
        )
      ).rows,
    ).toEqual([]);
    expect((await post(decisionRoute, { decision: 'approved' }, owner.modern)).status).toBe(201);
    expect(
      (
        await admin.query(
          "SELECT id FROM audit_events WHERE entity_id=$1 AND action='classroom.join.decided'",
          [pendingBody.requestId],
        )
      ).rows,
    ).toHaveLength(1);

    const rejectedGroup = classrooms[1]!;
    const otherPending = await post(
      '/api/class-join/account',
      { code: rejectedGroup.code },
      cookies,
    );
    expect(otherPending.status, otherPending.text).toBe(200);
    const otherRequest = (otherPending.body as { requestId: string }).requestId;
    const rejectRoute = `/api/class-join/requests/${rejectedGroup.id}/${otherRequest}/decision`;
    expect((await post(rejectRoute, { decision: 'rejected' }, owner.modern)).status).toBe(201);
    expect((await post(rejectRoute, { decision: 'approved' }, owner.modern)).status).toBe(409);
    expect(
      successful(await request(ACCOUNT_ROUTE, cookies)).groups.items?.map((row) => row.groupId),
    ).toEqual([acceptedGroup.id]);
    expect(
      (
        await admin.query(
          'SELECT id FROM classroom_student_seats WHERE classroom_id=$1 AND account_id=$2',
          [rejectedGroup.id, account.account_id],
        )
      ).rows,
    ).toEqual([]);
  }, 30_000);

  it('accepts persisted modern and verified legacy Account sessions, with honest zero/coverage and real query observations', async () => {
    const owner = await identity();
    const measured = await measuredRead(ACCOUNT_ROUTE, owner.modern, 'modern empty Account');
    const modern = successful(measured.result);
    const legacy = successful(await request(ACCOUNT_ROUTE, owner.legacy));
    expect(measured.summaryReads).toBe(1);
    expect(measured.accountResolutions).toBeGreaterThanOrEqual(1);
    expect(measured.seatResolutions).toBe(0);
    expect(modern.scope).toEqual({ kind: 'account', accountId: owner.accountId });
    expect(legacy.scope).toEqual(modern.scope);
    expect(legacy.metrics).toEqual(modern.metrics);
    expect(values(modern)).toEqual({
      everPublishedWorks: 0,
      currentLikes: 0,
      createdCopies: 0,
      activePublicWorks: 0,
    });
    expect(modern.availability).toBe('available');
    expect(modern.groups).toEqual({
      availability: 'available',
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(modern.coverage.everPublishedWorks.completeness).toBe('unknown');
    expect(modern.coverage.createdCopies.limitations).toContain(
      'copies_not_supported_by_all_modules',
    );
  });

  it('returns real own publication totals to both session generations without leaking private records or a foreign author', async () => {
    const owner = await identity();
    const foreign = await identity();
    const projectId = await publishAccount(owner);
    const response = await request(ACCOUNT_ROUTE, owner.modern);
    const summary = successful(response);
    expect(values(summary)).toEqual({
      everPublishedWorks: 1,
      currentLikes: 0,
      createdCopies: 0,
      activePublicWorks: 1,
    });
    expect(successful(await request(ACCOUNT_ROUTE, owner.legacy)).metrics).toEqual(summary.metrics);
    expect(values(successful(await request(ACCOUNT_ROUTE, foreign.modern)))).toEqual({
      everPublishedWorks: 0,
      currentLikes: 0,
      createdCopies: 0,
      activePublicWorks: 0,
    });
    for (const secret of [
      owner.teacher.email,
      owner.principalId,
      projectId,
      'PRIVATE_PROGRESS_WORK_',
    ]) {
      expect(response.text).not.toContain(secret);
    }
  });

  it('keeps a standalone Seat own scope after Account linking and freshly removes revoked Account history proof', async () => {
    const seat = await studentProjectPolicyFixture(admin, runtime);
    publishedProjects.push(seat.projectId);
    await seat.write({ publish: true, download: false, expectedVersion: 0 });
    await seat.publish();
    const cookies = { asa_student_session: seat.token };
    const measured = await measuredRead(SEAT_ROUTE, cookies, 'standalone Seat');
    const standalone = successful(measured.result);
    expect(measured.summaryReads).toBe(1);
    expect(measured.seatResolutions).toBe(1);
    expect(measured.accountResolutions).toBe(0);
    expect(standalone.scope).toEqual({
      kind: 'seat',
      seatId: seat.seatId,
      classroomId: seat.classroomId,
    });
    expect(standalone.groups.items?.map((group) => group.groupId)).toEqual([seat.classroomId]);
    expect(values(standalone)).toEqual({
      everPublishedWorks: 1,
      currentLikes: 0,
      createdCopies: 0,
      activePublicWorks: 1,
    });

    const account = await identity();
    const privateAccountProject = await publishAccount(account);
    const learner = (
      await admin.query<{ learner_identity_id: string; tenant_id: string; school_id: string }>(
        "SELECT learner_identity_id,tenant_id,school_id FROM learner_identity_links WHERE seat_id=$1 AND status='active'",
        [seat.seatId],
      )
    ).rows[0]!;
    await admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      seat.seatId,
      account.accountId,
    ]);
    const linkId = randomUUID();
    await admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) VALUES($1,$2,$3,$4,'account',$5)",
      [
        linkId,
        learner.tenant_id,
        learner.school_id,
        learner.learner_identity_id,
        account.accountId,
      ],
    );
    const linkedAccount = successful(await request(ACCOUNT_ROUTE, account.modern));
    expect(linkedAccount.metrics.everPublishedWorks.value).toBe(2);
    expect(linkedAccount.groups.items?.map((group) => group.groupId)).toEqual([seat.classroomId]);
    const seatResponse = await request(SEAT_ROUTE, cookies);
    expect(successful(seatResponse).metrics).toEqual(standalone.metrics);
    expect(seatResponse.text).not.toContain(account.accountId);
    expect(seatResponse.text).not.toContain(privateAccountProject);
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE id=$1",
      [linkId],
    );
    const revoked = successful(await request(ACCOUNT_ROUTE, account.modern));
    expect(revoked.metrics.everPublishedWorks.value).toBe(1);
    expect(revoked.groups.items).toEqual([]);
    expect(successful(await request(SEAT_ROUTE, cookies)).metrics).toEqual(standalone.metrics);
  });

  it('uses the existing early mixed-cookie 409 even with an unverified Account and never falls back between actor routes', async () => {
    const account = await identity(false);
    const seat = await seatIdentity();
    for (const path of [ACCOUNT_ROUTE, SEAT_ROUTE]) {
      const conflict = await request(path, { ...account.modern, ...seat.cookies });
      expect(conflict.status, conflict.text).toBe(409);
      expect(conflict.body).toMatchObject({ error: { code: 'session_conflict' } });
      expect((await request(path)).status).toBe(401);
    }
    expect((await request(SEAT_ROUTE, account.modern)).status).toBe(401);
    expect((await request(ACCOUNT_ROUTE, seat.cookies)).status).toBe(401);
    expect((await request(SEAT_ROUTE, { asa_student_session: randomUUID() })).status).toBe(401);
    expect((await request(ACCOUNT_ROUTE, { asa_session: randomUUID() })).status).toBe(401);
    expect(
      (await request(SEAT_ROUTE, { ...account.modern, asa_student_session: 'fabricated' })).status,
    ).toBe(409);
  });

  it('returns 403 for a valid historical Seat with no owner and never materializes or refreshes an Account', async () => {
    const seat = await seatIdentity(false);
    const counts = async () =>
      (
        await admin.query<{ principals: number; links: number }>(
          `SELECT (SELECT count(*)::int FROM principals WHERE seat_id=$1) principals,
         (SELECT count(*)::int FROM learner_identity_links WHERE seat_id=$1) links`,
          [seat.seatId],
        )
      ).rows[0]!;
    expect(await counts()).toEqual({ principals: 0, links: 0 });
    const measured = await measuredRead(SEAT_ROUTE, seat.cookies, 'valid Seat without owner');
    expect(measured.result.status, measured.result.text).toBe(403);
    expect(measured.result.body).toMatchObject({ error: { code: 'progress_owner_unavailable' } });
    expect(measured.accountResolutions).toBe(0);
    expect(measured.seatResolutions).toBe(1);
    expect(measured.summaryReads).toBe(0);
    expect(
      measured.result.headers
        .getSetCookie()
        .some((cookie) => /^(asa_session|asa_refresh)=/.test(cookie)),
    ).toBe(false);
    expect(await counts()).toEqual({ principals: 0, links: 0 });
  });

  it.each(['expired', 'revoked', 'credential_version', 'idle'] as const)(
    'rejects a %s Seat session over real HTTP',
    async (kind) => {
      const seat = await seatIdentity();
      expect((await request(SEAT_ROUTE, seat.cookies)).status).toBe(200);
      if (kind === 'credential_version') {
        await admin.query(
          'UPDATE classroom_seat_credentials SET version=version+1 WHERE seat_id=$1',
          [seat.seatId],
        );
      } else if (kind === 'expired') {
        await admin.query(
          "UPDATE classroom_student_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
          [seat.hash],
        );
      } else if (kind === 'revoked') {
        await admin.query(
          'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
          [seat.hash],
        );
      } else {
        await admin.query(
          "UPDATE classroom_student_sessions SET last_seen_at=now()-interval '61 minutes' WHERE token_hash=$1",
          [seat.hash],
        );
      }
      const response = await request(SEAT_ROUTE, seat.cookies);
      expect(response.status, response.text).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'unauthorized' } });
    },
  );

  it.each(['modern_revoked', 'modern_expired', 'legacy_revoked', 'legacy_link_retired'] as const)(
    'freshly rejects %s Account authority',
    async (kind) => {
      const owner = await identity();
      const cookies = kind.startsWith('modern') ? owner.modern : owner.legacy;
      expect((await request(ACCOUNT_ROUTE, cookies)).status).toBe(200);
      if (kind === 'modern_revoked') {
        await admin.query('UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1', [
          owner.modernHash,
        ]);
      } else if (kind === 'modern_expired') {
        await admin.query(
          "UPDATE sessions_v2 SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
          [owner.modernHash],
        );
      } else if (kind === 'legacy_revoked') {
        await admin.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [
          owner.legacyHash,
        ]);
      } else {
        await admin.query(
          "UPDATE legacy_user_account_links SET migration_state='retired' WHERE tenant_id=$1 AND user_id=$2",
          [owner.teacher.tenantId, owner.teacher.teacherId],
        );
      }
      const response = await request(ACCOUNT_ROUTE, cookies);
      expect(response.status, response.text).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'unauthorized' } });
    },
  );

  it('paginates a real bounded own group set without changing totals and rejects cross-actor cursors or forged ownership queries', async () => {
    const owner = await identity();
    const foreign = await identity();
    await publishAccount(owner);
    const groupIds = await addOwnGroups(owner, 21);
    const first = successful(await request(ACCOUNT_ROUTE, owner.modern));
    expect(first.groups.items?.map((group) => group.groupId)).toEqual(groupIds.slice(0, 20));
    expect(first.groups.hasMore).toBe(true);
    expect(first.groups.nextCursor).toBeTypeOf('string');
    if (!first.groups.nextCursor) throw new Error('Expected a genuine server-issued continuation');
    const path = `${ACCOUNT_ROUTE}?cursor=${encodeURIComponent(first.groups.nextCursor)}`;
    const second = successful(await request(path, owner.modern));
    expect(second.groups.items?.map((group) => group.groupId)).toEqual(groupIds.slice(20));
    expect(second.groups.hasMore).toBe(false);
    expect(second.groups.nextCursor).toBeNull();
    expect(second.metrics).toEqual(first.metrics);
    expect(first.metrics.everPublishedWorks.value).toBe(1);
    const crossActor = await request(path, foreign.modern);
    expect(crossActor.status, crossActor.text).toBe(400);
    expect(crossActor.body).toMatchObject({ error: { code: 'validation_error' } });
    for (const query of [
      `accountId=${foreign.accountId}`,
      `principalId=${foreign.principalId}`,
      `classroomId=${groupIds[0]}`,
      'periodDays=90',
    ]) {
      const forged = await request(`${ACCOUNT_ROUTE}?${query}`, owner.modern);
      expect(forged.status, forged.text).toBe(400);
      expect(forged.body).toMatchObject({ error: { code: 'validation_error' } });
    }
  });
});
