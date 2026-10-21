import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { testAdminPool, testAppPool } from '../portal/helpers';

interface Author {
  accountId: string;
  principalId: string;
  workspaceId: string;
  tenantId: string;
  cookie: string;
}

interface PublishRequest {
  expectedRevision: number;
  requestId: string;
}

interface Publication {
  versionId: string;
  versionNumber: number;
  publishedAt: string;
  reused: boolean;
}

interface Outline {
  draftRevision: number;
  sections: Array<{ id: string; lessons: Array<{ id: string }> }>;
}

let admin: pg.Pool;
let runtime: pg.Pool;
let api: NestApp;

beforeAll(async () => {
  // The shared helpers reject both missing URLs and non-isolated databases.
  admin = testAdminPool();
  runtime = testAppPool();
  api = await buildTestApp(runtime);
});

afterAll(async () => {
  if (api) await api.close();
  else await runtime?.end();
  await admin?.end();
});

async function author(): Promise<Author> {
  const unique = randomUUID().replaceAll('-', '');
  const registration = await inject(api, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: unique + '@course-replay.test',
      username: 'r' + unique.slice(0, 24),
      displayName: 'Автор повторной публикации',
      password: 'Safe-' + unique + '-Password',
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(registration.statusCode, registration.body).toBe(201);
  const token = registration.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  expect(token).toBeTruthy();
  const cookie = 'asa_session=' + token;
  const grant = await inject(api, {
    method: 'POST',
    url: '/api/capabilities/content-author/self-attest',
    headers: { cookie },
    payload: {},
  });
  expect(grant.statusCode, grant.body).toBe(201);
  const context = (
    await runtime.query('SELECT * FROM session_v2_context($1)', [hashSessionToken(token!)])
  ).rows[0];
  expect(context?.workspace_kind).toBe('personal');
  const activeAuthorGrants = await admin.query(
    "SELECT capability FROM capability_grants WHERE account_id=$1 AND capability IN ('content_author','educator') AND state IN ('verified','provisional') ORDER BY capability",
    [context.account_id],
  );
  // Revocation below must remove the LAST author permission, not an unrelated
  // teaching grant while a valid content_author grant still permits publication.
  expect(activeAuthorGrants.rows).toEqual([{ capability: 'content_author' }]);
  return {
    accountId: context.account_id,
    principalId: context.principal_id,
    workspaceId: context.workspace_id,
    tenantId: context.tenant_id,
    cookie,
  };
}

async function outline(actor: Author, courseId: string): Promise<Outline> {
  const response = await inject(api, {
    method: 'GET',
    url: '/api/courses/' + courseId + '/outline',
    headers: { cookie: actor.cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Outline>();
}

async function course(actor: Author) {
  const created = await inject(api, {
    method: 'POST',
    url: '/api/courses',
    headers: { cookie: actor.cookie },
    payload: {
      title: 'Повтор публикации ' + randomUUID(),
      summary: null,
      visibility: 'private',
      requestId: 'fix05:create:' + randomUUID(),
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ id: string }>().id;
  const draft = await outline(actor, id);
  const sectionId = draft.sections[0]!.id;
  const saved = await inject(api, {
    method: 'POST',
    url: '/api/courses/' + id + '/lessons',
    headers: { cookie: actor.cookie },
    payload: {
      sectionId,
      title: 'Урок V1',
      kind: 'material',
      blocks: [{ id: 'intro', type: 'paragraph', text: 'Точное содержание V1' }],
      expectedRevision: draft.draftRevision,
    },
  });
  expect(saved.statusCode, saved.body).toBe(201);
  const receipt = saved.json<{ id: string; draftRevision: number }>();
  return {
    id,
    sectionId,
    lessonId: receipt.id,
    request: {
      expectedRevision: receipt.draftRevision,
      requestId: 'fix05:publish:' + randomUUID(),
    },
  };
}

function requestPublication(actor: Author, courseId: string, payload: PublishRequest) {
  return inject(api, {
    method: 'POST',
    url: '/api/courses/' + courseId + '/publish',
    headers: { cookie: actor.cookie },
    payload,
  });
}

async function publish(actor: Author, courseId: string, payload: PublishRequest) {
  const response = await requestPublication(actor, courseId, payload);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Publication>();
}

async function history(courseId: string) {
  const result = await admin.query(
    'SELECT row_to_json(version)::text AS bytes FROM course_versions version WHERE course_id=$1 ORDER BY version_number',
    [courseId],
  );
  return result.rows;
}

async function confirmations(courseId: string) {
  const result = await admin.query(
    "SELECT row_to_json(event)::text AS bytes FROM audit_events event WHERE entity_id=$1 AND action='course.publication.confirmed' ORDER BY id",
    [courseId],
  );
  return result.rows;
}

async function academicRecords(tenantId: string) {
  const records: Record<string, unknown> = {};
  for (const table of [
    'classroom_course_runs',
    'classroom_course_run_lessons',
    'course_enrollments',
    'activity_runs',
    'activity_participations',
    'learning_attempts',
    'learning_submissions',
    'assessment_results',
    'gradebook_entries',
  ]) {
    records[table] = (
      await admin.query(
        'SELECT row_to_json(record)::text AS bytes FROM ' +
          table +
          ' record WHERE tenant_id=$1 ORDER BY row_to_json(record)::text',
        [tenantId],
      )
    ).rows;
  }
  return records;
}

async function persisted(courseId: string) {
  return {
    course: (
      await admin.query(
        'SELECT row_to_json(course)::text AS bytes FROM courses course WHERE id=$1',
        [courseId],
      )
    ).rows,
    versions: await history(courseId),
    confirmations: await confirmations(courseId),
  };
}

describe('E1-FIX-05: Course publication receipts through the real API and restricted runtime', () => {
  it('replays V1 after its revision advance and a later V2; conflicting payloads and outsiders cannot change history or a pinned Run', async () => {
    const actor = await author();
    const draft = await course(actor);
    const first = await publish(actor, draft.id, draft.request);
    expect(first).toMatchObject({ versionNumber: 1, reused: false });
    expect((await outline(actor, draft.id)).draftRevision).toBeGreaterThan(
      draft.request.expectedRevision,
    );
    expect(await publish(actor, draft.id, draft.request)).toEqual({ ...first, reused: true });
    const v1History = await history(draft.id);
    expect(v1History).toHaveLength(1);
    expect(await confirmations(draft.id)).toHaveLength(1);

    const teaching = await inject(api, {
      method: 'POST',
      url: '/api/capabilities/educator/self-attest',
      headers: { cookie: actor.cookie },
      payload: {},
    });
    expect(teaching.statusCode, teaching.body).toBe(201);
    const classroom = await inject(api, {
      method: 'POST',
      url: '/api/classrooms',
      headers: { cookie: actor.cookie, 'idempotency-key': 'fix05:class:' + randomUUID() },
      payload: {
        title: 'Класс с версией V1',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: true,
      },
    });
    expect(classroom.statusCode, classroom.body).toBe(201);
    const assigned = await inject(api, {
      method: 'POST',
      url: '/api/classrooms/' + classroom.json().classroom.id + '/course-runs',
      headers: { cookie: actor.cookie },
      payload: {
        courseId: draft.id,
        versionNumber: 1,
        audienceType: 'whole_class',
        seatIds: [],
        requestId: 'fix05:assign:' + randomUUID(),
      },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    const runId = assigned.json<{ runId: string }>().runId;
    const runBefore = await admin.query(
      'SELECT tenant_id, course_version_id FROM classroom_course_runs WHERE id=$1',
      [runId],
    );
    expect(runBefore.rows).toHaveLength(1);
    expect(runBefore.rows[0]).toMatchObject({ course_version_id: first.versionId });
    const runTenantId = runBefore.rows[0].tenant_id as string;
    const academicBefore = await academicRecords(runTenantId);
    expect(academicBefore['classroom_course_runs']).toHaveLength(1);
    expect(academicBefore['classroom_course_run_lessons']).toHaveLength(1);
    const current = await outline(actor, draft.id);
    const updated = await inject(api, {
      method: 'PATCH',
      url: '/api/courses/' + draft.id + '/lessons/' + draft.lessonId,
      headers: { cookie: actor.cookie },
      payload: {
        sectionId: draft.sectionId,
        title: 'Урок V2',
        kind: 'material',
        blocks: [{ id: 'intro', type: 'paragraph', text: 'Новое содержание V2' }],
        expectedRevision: current.draftRevision,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const laterRequest = {
      expectedRevision: updated.json<{ draftRevision: number }>().draftRevision,
      requestId: 'fix05:publish:v2:' + randomUUID(),
    };
    const second = await publish(actor, draft.id, laterRequest);
    expect(second).toMatchObject({ versionNumber: 2, reused: false });
    expect(second.versionId).not.toBe(first.versionId);
    expect((await history(draft.id)).slice(0, 1)).toEqual(v1History);
    expect(await academicRecords(runTenantId)).toEqual(academicBefore);
    const beforeReplay = await persisted(draft.id);

    expect(await publish(actor, draft.id, draft.request)).toEqual({ ...first, reused: true });
    const conflict = await requestPublication(actor, draft.id, {
      ...draft.request,
      expectedRevision: laterRequest.expectedRevision,
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'idempotency_conflict' } });
    const outsider = await author();
    const denied = await requestPublication(outsider, draft.id, draft.request);
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.json()).toMatchObject({ error: { code: 'course_not_found' } });
    expect(denied.body).not.toContain(first.versionId);
    expect(await persisted(draft.id)).toEqual(beforeReplay);
    expect(await academicRecords(runTenantId)).toEqual(academicBefore);
  }, 10000);

  it('serializes overlapping same-key requests to one exact version and one confirmation', async () => {
    const actor = await author();
    const draft = await course(actor);
    const left = await runtime.connect();
    const right = await runtime.connect();
    let transactionOpen = false;
    let pendingReplay: Promise<pg.QueryResult> | undefined;
    try {
      const rightPid = Number((await right.query('SELECT pg_backend_pid() AS id')).rows[0].id);
      await left.query('BEGIN');
      transactionOpen = true;
      const sql = 'SELECT * FROM course_publish_v3($1,$2,$3,$4)';
      const values = [
        actor.principalId,
        draft.id,
        draft.request.expectedRevision,
        draft.request.requestId,
      ];
      const first = (await left.query(sql, values)).rows[0];
      expect(first).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
      pendingReplay = right.query(sql, values);
      // Observe an actual PostgreSQL lock wait while the first publication is
      // still uncommitted. Promise.all alone would not prove overlapping calls.
      void pendingReplay.catch(() => undefined);
      await expect
        .poll(
          async () =>
            (
              await admin.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1 AND state='active'",
                [rightPid],
              )
            ).rows[0]?.wait_event_type,
          { timeout: 5000, interval: 20 },
        )
        .toBe('Lock');
      await left.query('COMMIT');
      transactionOpen = false;
      expect((await pendingReplay).rows).toEqual([{ ...first, reused: true }]);
    } finally {
      if (transactionOpen) await left.query('ROLLBACK');
      await pendingReplay?.catch(() => undefined);
      left.release();
      right.release();
    }
    expect(await history(draft.id)).toHaveLength(1);
    expect(await confirmations(draft.id)).toHaveLength(1);
    const beforeReplay = await persisted(draft.id);
    expect(await publish(actor, draft.id, draft.request)).toMatchObject({
      versionNumber: 1,
      reused: true,
    });
    expect(await persisted(draft.id)).toEqual(beforeReplay);
  }, 10000);

  it.each(['capability', 'session', 'membership'] as const)(
    'denies a completed publication replay after revoking the current %s without leaking or rewriting its receipt',
    async (kind) => {
      const actor = await author();
      const draft = await course(actor);
      const first = await publish(actor, draft.id, draft.request);
      expect(first).toMatchObject({ versionNumber: 1, reused: false });
      const before = await persisted(draft.id);
      if (kind === 'capability') {
        const revoked = await admin.query(
          "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='content_author' RETURNING account_id",
          [actor.accountId],
        );
        expect(revoked.rowCount).toBe(1);
      } else if (kind === 'membership') {
        const revoked = await admin.query(
          "UPDATE workspace_memberships SET state='revoked' WHERE account_id=$1 AND workspace_id=$2 RETURNING account_id",
          [actor.accountId, actor.workspaceId],
        );
        expect(revoked.rowCount).toBe(1);
      } else {
        const logout = await inject(api, {
          method: 'POST',
          url: '/api/auth/logout',
          headers: { cookie: actor.cookie },
        });
        expect(logout.statusCode, logout.body).toBe(200);
      }
      const denied = await requestPublication(actor, draft.id, draft.request);
      expect(denied.statusCode, denied.body).toBe(kind === 'capability' ? 403 : 401);
      expect(denied.json()).toMatchObject({
        error: { code: kind === 'capability' ? 'author_required' : 'unauthorized' },
      });
      expect(denied.body).not.toContain(first.versionId);
      expect(denied.json()).not.toHaveProperty('publishedAt');
      expect(await persisted(draft.id)).toEqual(before);
    },
  );
});
