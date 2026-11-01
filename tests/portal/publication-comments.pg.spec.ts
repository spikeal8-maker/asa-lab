import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { testAdminPool, testAppPool, seedTeacher } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';
import { buildTestApp, inject, type NestApp } from './app';
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let repo: PgProjectRepository;
const projects: string[] = [];
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  repo = new PgProjectRepository(runtime);
  app = await buildTestApp(runtime);
}, 90_000);
afterAll(async () => {
  try {
    if (projects.length)
      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=ANY($1::uuid[])",
        [projects],
      );
  } finally {
    await app?.close();
    await admin?.end();
    await runtime?.end();
  }
});
async function identity(platform = false) {
  const teacher = await seedTeacher(admin, `comments-${randomUUID().slice(0, 8)}`);
  const row = (
    await admin.query(
      'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0]!;
  const principal = row.principal_id as string;
  const account = row.account_id as string;
  await admin.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    account,
  ]);
  if (platform)
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','comments-test','admin')",
      [account],
    );
  const workspace = (
    await admin.query(
      'SELECT workspace_id FROM workspace_memberships WHERE account_id=$1 LIMIT 1',
      [account],
    )
  ).rows[0]!.workspace_id;
  const token = randomUUID();
  const hash = hashSessionToken(token);
  await admin.query(
    "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [principal, workspace, hash],
  );
  return { teacher, principal, account, hash, token, cookies: { asa_session: token } };
}
async function source() {
  const owner = await identity();
  const actor = { userId: owner.teacher.teacherId, principalId: owner.principal };
  const created = await repo.createWithDraft({
    tenantId: owner.teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: 'Comments immutable source',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  });
  if (created.kind !== 'created') throw new Error('fixture source not created');
  const projectId = created.project.id;
  projects.push(projectId);
  const png = new PNG({ width: 32, height: 32 });
  png.data.fill(255);
  await repo.saveSnapshot({
    tenantId: owner.teacher.tenantId,
    actor,
    projectId,
    sourceRevision: 1,
    image: { bytes: PNG.sync.write(png), contentType: 'image/png', width: 32, height: 32 },
  });
  const publish = async (title = 'Published comments source') =>
    (
      await runtime.query('SELECT project_publication_publish($1,$2,$3::jsonb) result', [
        owner.principal,
        projectId,
        JSON.stringify({ title, license: 'reserved' }),
      ])
    ).rows[0]!.result;
  const result = await publish();
  return {
    owner,
    projectId,
    publish,
    publicationId: result.publication.publicationId as string,
    revisionId: result.publication.revisionId as string,
  };
}
type Source = Awaited<ReturnType<typeof source>>;
type Actor = Awaited<ReturnType<typeof identity>>;
const endpoint = (s: Source) => `/api/public-projects/${s.publicationId}/comments`;
const create = (s: Source, a: Actor, body = 'Комментарий', extra: Record<string, unknown> = {}) =>
  inject(app, {
    method: 'POST',
    url: endpoint(s) + '/commands',
    cookies: a.cookies,
    payload: {
      action: 'create',
      body,
      revisionId: s.revisionId,
      mutationId: randomUUID(),
      ...extra,
    },
  });
const command = (s: Source, a: Actor, action: string, input: Record<string, unknown>) =>
  inject(app, {
    method: 'POST',
    url: endpoint(s) + '/commands',
    cookies: a.cookies,
    payload: { action, ...input },
  });
const read = (s: Source, a?: Actor, query = '') =>
  inject(app, { method: 'GET', url: endpoint(s) + query, ...(a ? { cookies: a.cookies } : {}) });
const moderate = (s: Source, a: Actor, action: string, input: Record<string, unknown>) =>
  inject(app, {
    method: 'POST',
    url: `/api/admin/v1/publications/${s.publicationId}/comments/commands`,
    cookies: a.cookies,
    payload: { action, reason: 'Проверено модератором', ...input },
  });

describe('real publication discussion identity, policy and moderation boundary', () => {
  it('stores real comments, safely returns text, replays lost responses and never exposes private identity', async () => {
    const s = await source(),
      a = await identity();
    const guest = await read(s);
    expect(guest.statusCode).toBe(200);
    expect(guest.json().state).toMatchObject({
      authenticated: false,
      canComment: false,
      canManage: false,
    });
    expect(
      (
        await inject(app, {
          method: 'POST',
          url: endpoint(s) + '/commands',
          payload: {
            action: 'create',
            body: 'anonymous',
            revisionId: s.revisionId,
            mutationId: randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(401);
    const key = randomUUID(),
      body = '<img src=x onerror=alert(1)> Текст';
    const first = await create(s, a, body, { mutationId: key });
    expect(first.statusCode).toBe(200);
    expect(first.json().comment.body).toBe(body);
    const again = await create(s, a, body, { mutationId: key });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    expect(again.json().replayed).toBe(true);
    expect((await create(s, a, 'Другой текст', { mutationId: key })).statusCode).toBe(409);
    const listed = (await read(s)).json();
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(a.principal);
    expect(JSON.stringify(listed)).not.toContain(a.account);
    expect(listed.items[0].body).toBe(body);
  });
  it('paginates with stable cursors and bounds replies to one level in the same publication', async () => {
    const s = await source(),
      a = s.owner;
    const ids = [];
    for (const body of ['Первый', 'Второй', 'Третий'])
      ids.push((await create(s, a, body)).json().id);
    const first = (await read(s, a, '?limit=1')).json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = (await read(s, a, `?limit=1&before=${first.nextCursor}`)).json();
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const third = (await read(s, a, `?limit=1&before=${second.nextCursor}`)).json();
    expect(third.nextCursor).toBeNull();
    expect(new Set([first.items[0].id, second.items[0].id, third.items[0].id]).size).toBe(3);
    const reply = await create(s, a, 'Ответ', { parentId: ids[0] });
    expect(reply.statusCode).toBe(200);
    expect((await create(s, a, 'Слишком глубоко', { parentId: reply.json().id })).statusCode).toBe(
      400,
    );
    const other = await source();
    expect((await create(other, other.owner, 'Чужая ветка', { parentId: ids[0] })).statusCode).toBe(
      400,
    );
    const replies = (await read(s, a, `?parentId=${ids[0]}`)).json();
    expect(replies.items.map((x: { body: string }) => x.body)).toEqual(['Ответ']);
    expect((await read(other, other.owner, `?before=${ids[0]}`)).statusCode).toBe(400);
    expect((await read(s, a, '?limit=31')).statusCode).toBe(400);
  });
  it('inherits independent classroom comment permission and enforces individual deny/allow without publication permission', async () => {
    const s = await source(),
      f = await studentProjectPolicyFixture(admin, runtime);
    const cookies = { asa_student_session: f.token };
    const seatCreate = () =>
      inject(app, {
        method: 'POST',
        url: endpoint(s) + '/commands',
        cookies,
        payload: {
          action: 'create',
          body: 'От ученика',
          mutationId: randomUUID(),
          revisionId: s.revisionId,
        },
      });
    expect((await f.read()).comments).toBe(false);
    expect((await seatCreate()).statusCode).toBe(403);
    const setClass = async (comments: boolean) =>
      f.write({
        publish: false,
        download: false,
        comments,
        expectedVersion: (await f.read()).version,
      });
    const setSeat = async (commentsOverride: string) =>
      f.write(
        {
          publishOverride: 'inherit',
          downloadOverride: 'inherit',
          commentsOverride,
          expectedVersion: (await f.read()).version,
        },
        f.seatId,
      );
    expect((await setClass(true)).comments).toBe(true);
    expect((await seatCreate()).statusCode).toBe(200);
    expect((await f.read()).publish).toBe(false);
    await setSeat('deny');
    expect((await seatCreate()).statusCode).toBe(403);
    await setClass(false);
    await setSeat('allow');
    expect((await seatCreate()).statusCode).toBe(200);
    await setSeat('inherit');
    expect((await seatCreate()).statusCode).toBe(403);
    const old = await f.read();
    expect(
      (await f.write({ publish: true, download: true, expectedVersion: old.version })).comments,
    ).toBe(false);
    expect(
      (
        await f.write({
          publish: true,
          download: true,
          comments: true,
          expectedVersion: old.version,
        })
      ).error,
    ).toBe('version_conflict');
    const unrelated = await identity();
    const denied = await runtime.query(
      'SELECT classroom_project_policy_write($1,$2,$3,$4,$5::jsonb,$6) result',
      [
        unrelated.principal,
        f.teacher.tenantId,
        f.classroomId,
        null,
        JSON.stringify({
          publish: false,
          download: false,
          comments: true,
          expectedVersion: (await f.read()).version,
        }),
        randomUUID(),
      ],
    );
    expect(denied.rows[0].result.error).toBe('forbidden');
    await setClass(true);
    expect(
      (
        await f.write({
          publish: false,
          download: false,
          expectedVersion: (await f.read()).version,
        })
      ).comments,
    ).toBe(true);
    await setSeat('deny');
    expect(
      (
        await f.write(
          {
            publishOverride: 'inherit',
            downloadOverride: 'inherit',
            expectedVersion: (await f.read()).version,
          },
          f.seatId,
        )
      ).commentsOverride,
    ).toBe('deny');
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [f.hash],
    );
    const mixed = await inject(app, {
      method: 'POST',
      url: endpoint(s) + '/commands',
      cookies: { ...s.owner.cookies, ...cookies },
      payload: {
        action: 'create',
        body: 'No fallback',
        mutationId: randomUUID(),
        revisionId: s.revisionId,
      },
    });
    // The global mutation guard rejects mixed Account/Seat cookies before
    // the controller can resolve either identity. There is no fallback.
    expect(mixed.statusCode).toBe(409);
    expect(mixed.json().error.code).toBe('session_conflict');
  });
  it('allows owner close without losing records and preserves own-delete after close', async () => {
    const s = await source(),
      a = await identity();
    const c = (await create(s, a)).json();
    expect(
      (await command(s, a, 'settings', { enabled: false, expectedVersion: 0 })).statusCode,
    ).toBe(403);
    expect(
      (await command(s, s.owner, 'settings', { enabled: false, expectedVersion: 0 })).statusCode,
    ).toBe(200);
    expect((await create(s, a)).statusCode).toBe(403);
    expect((await read(s)).json().items[0].body).toBe('Комментарий');
    expect(
      (await command(s, s.owner, 'settings', { enabled: true, expectedVersion: 0 })).statusCode,
    ).toBe(409);
    expect(
      (await command(s, a, 'delete', { commentId: c.id, expectedVersion: 0 })).statusCode,
    ).toBe(200);
    const deleted = (await read(s)).json().items[0];
    expect(deleted.status).toBe('deleted');
    expect(deleted.body).toBeNull();
    expect(deleted.author).toBeNull();
    expect(
      (await command(s, s.owner, 'settings', { enabled: true, expectedVersion: 1 })).statusCode,
    ).toBe(200);
  });
  it('routes reports to guarded admin moderation and keeps owner/admin hiding independent with an audit reason', async () => {
    const s = await source(),
      a = await identity(),
      mod = await identity(true);
    const c = (await create(s, a, 'Проверяемый комментарий')).json();
    expect(
      (
        await inject(app, {
          method: 'GET',
          url: `/api/admin/v1/publications/${s.publicationId}/comments`,
          cookies: a.cookies,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await command(s, a, 'report', { commentId: c.id, reason: 'Оскорбление' })).statusCode,
    ).toBe(200);
    expect(
      (await command(s, a, 'report', { commentId: c.id, reason: 'Повтор жалобы' })).statusCode,
    ).toBe(200);
    const queue = await inject(app, {
      method: 'GET',
      url: `/api/admin/v1/publications/${s.publicationId}/comments`,
      cookies: mod.cookies,
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items[0].reports).toHaveLength(1);
    expect(
      (await moderate(s, mod, 'hide', { commentId: c.id, expectedVersion: 0 })).statusCode,
    ).toBe(200);
    const hidden = (await read(s)).json().items[0];
    expect(hidden.status).toBe('moderator_hidden');
    expect(hidden.body).toBeNull();
    expect(
      (await command(s, s.owner, 'restore', { commentId: c.id, expectedVersion: 1 })).statusCode,
    ).toBe(200);
    expect((await read(s)).json().items[0].status).toBe('moderator_hidden');
    expect(
      (await moderate(s, mod, 'restore', { commentId: c.id, expectedVersion: 2 })).statusCode,
    ).toBe(200);
    expect(
      (await command(s, s.owner, 'hide', { commentId: c.id, expectedVersion: 3 })).statusCode,
    ).toBe(200);
    expect(
      (await moderate(s, mod, 'restore', { commentId: c.id, expectedVersion: 4 })).statusCode,
    ).toBe(200);
    expect((await read(s)).json().items[0].status).toBe('owner_hidden');
    expect(
      (await moderate(s, mod, 'settings', { enabled: false, expectedVersion: 0 })).statusCode,
    ).toBe(200);
    expect(
      (await command(s, s.owner, 'settings', { enabled: true, expectedVersion: 1 })).statusCode,
    ).toBe(200);
    expect((await create(s, a)).statusCode).toBe(403);
    const audit = await admin.query(
      "SELECT reason_text FROM administrative_audit_events WHERE actor_principal_id=$1 AND action='publication.comment.hide'",
      [mod.principal],
    );
    expect(audit.rows.some((r) => r.reason_text === 'Проверено модератором')).toBe(true);
    await admin.query(
      "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='platform_admin'",
      [mod.account],
    );
    expect(
      (await moderate(s, mod, 'settings', { enabled: true, expectedVersion: 1 })).statusCode,
    ).toBe(403);
  });
  it('enforces Unicode body, reply and per-actor rate limits while allowing an idempotent retry', async () => {
    const s = await source(),
      a = s.owner;
    expect((await create(s, a, '🚀'.repeat(2001))).statusCode).toBe(400);
    expect((await create(s, a, '  ')).statusCode).toBe(400);
    const key = randomUUID();
    expect((await create(s, a, '🚀'.repeat(2000), { mutationId: key })).statusCode).toBe(200);
    for (let i = 0; i < 9; i++) expect((await create(s, a, `Запись ${i}`)).statusCode).toBe(200);
    expect((await create(s, a, 'Ограничение')).statusCode).toBe(429);
    expect((await create(s, a, '🚀'.repeat(2000), { mutationId: key })).statusCode).toBe(200);
    await admin.query(
      "UPDATE publication_comments SET created_at=clock_timestamp()-interval '2 minutes' WHERE author_principal_id=$1",
      [a.principal],
    );
    await admin.query(
      "INSERT INTO publication_comments(publication_id,revision_id,author_principal_id,body,mutation_id,created_at) SELECT $1,$2,$3,'Часовой лимит',gen_random_uuid(),clock_timestamp()-interval '2 minutes' FROM generate_series(1,90)",
      [s.publicationId, s.revisionId, a.principal],
    );
    expect((await create(s, a, 'Часовой предел')).statusCode).toBe(429);
  });
  it('rejects stale sessions, revoked publications, direct table reads and forged identity', async () => {
    const s = await source(),
      a = await identity();
    await expect(runtime.query('SELECT * FROM publication_comments')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query('SELECT * FROM publication_comment_reports')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime.query('SELECT publication_comment_allowed($1)', [a.principal]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query("SELECT publication_comment_write($1,'fake',$2,'create',$3::jsonb,$4)", [
        a.principal,
        s.publicationId,
        JSON.stringify({ body: 'fake', revisionId: s.revisionId, mutationId: randomUUID() }),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: 'P5R01' });
    await admin.query('UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1', [a.hash]);
    expect((await create(s, a)).statusCode).toBe(401);
    await admin.query(
      "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE id=$1",
      [s.publicationId],
    );
    expect((await read(s)).statusCode).toBe(404);
    expect((await create(s, s.owner)).statusCode).toBe(404);
  });
  it('serializes simultaneous same-key submissions without duplicate comments', async () => {
    const s = await source(),
      key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => create(s, s.owner, 'Один комментарий', { mutationId: key })),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
    expect((await read(s)).json().items).toHaveLength(1);
  });
  it('persists idempotent comment likes independently of classroom write permission, with live identity and removal after hide', async () => {
    const s = await source(),
      reader = await identity();
    const c = (await create(s, s.owner, 'Полезный комментарий')).json();
    const like = (actor: typeof reader, on = true) =>
      command(s, actor, 'like', { commentId: c.id, on });
    expect((await like(s.owner)).statusCode).toBe(403);
    const parallel = await Promise.all(Array.from({ length: 5 }, () => like(reader)));
    expect(parallel.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect((await read(s, reader)).json().items[0]).toMatchObject({
      likeCount: 1,
      liked: true,
      canLike: true,
    });
    const f = await studentProjectPolicyFixture(admin, runtime);
    expect((await f.read()).comments).toBe(false);
    const seatLike = await inject(app, {
      method: 'POST',
      url: endpoint(s) + '/commands',
      cookies: { asa_student_session: f.token },
      payload: { action: 'like', commentId: c.id, on: true },
    });
    expect(seatLike.statusCode, seatLike.body).toBe(200);
    expect((await read(s)).json().items[0].likeCount).toBe(2);
    expect(
      (
        await inject(app, {
          method: 'POST',
          url: endpoint(s) + '/commands',
          payload: { action: 'like', commentId: c.id, on: true },
        })
      ).statusCode,
    ).toBe(401);
    await command(s, s.owner, 'hide', { commentId: c.id, expectedVersion: 0 });
    expect((await like(reader)).statusCode).toBe(404);
    expect((await like(reader, false)).statusCode).toBe(200);
    expect((await read(s, reader)).json().items[0]).toMatchObject({
      body: null,
      likeCount: 0,
      liked: false,
    });
    await expect(runtime.query('SELECT * FROM publication_comment_likes')).rejects.toMatchObject({
      code: '42501',
    });
    await admin.query('UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1', [reader.hash]);
    expect((await like(reader, false)).statusCode).toBe(401);
  });
  it('pins one visible root for an owner or live platform admin and keeps hidden pins out of public projection', async () => {
    const s = await source(),
      other = await identity(),
      mod = await identity(true);
    const a = (await create(s, s.owner, 'Первый')).json(),
      b = (await create(s, s.owner, 'Второй')).json();
    const pin = (actor: typeof other, id: string, on: boolean, version: number) =>
      command(s, actor, 'pin', { commentId: id, on, expectedVersion: version });
    expect((await pin(other, a.id, true, 0)).statusCode).toBe(403);
    expect((await pin(s.owner, a.id, true, 0)).statusCode).toBe(200);
    const pinned = (await read(s, s.owner)).json();
    expect(pinned.pinnedComment).toMatchObject({ id: a.id, pinned: true });
    expect(pinned.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    const legacy = (
      await runtime.query('SELECT publication_comments_read($1,$2,$3,NULL,NULL,20) result', [
        s.owner.principal,
        s.owner.hash,
        s.publicationId,
      ])
    ).rows[0].result;
    expect(legacy.items.map((i: { id: string }) => i.id)).toContain(a.id);
    expect((await pin(mod, b.id, true, 1)).statusCode).toBe(200);
    expect((await pin(s.owner, a.id, false, 1)).statusCode).toBe(409);
    expect((await read(s)).json().pinnedComment.id).toBe(b.id);
    const reply = (await create(s, s.owner, 'Ответ', { parentId: a.id })).json();
    expect((await pin(s.owner, reply.id, true, 2)).statusCode).toBe(404);
    await command(s, s.owner, 'hide', { commentId: b.id, expectedVersion: 0 });
    expect((await read(s)).json().pinnedComment).toBeNull();
    expect(
      (
        await admin.query(
          "SELECT count(*)::int n FROM administrative_audit_events WHERE actor_principal_id=$1 AND action='publication.comment.pin'",
          [mod.principal],
        )
      ).rows[0].n,
    ).toBe(1);
    await admin.query(
      "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='platform_admin'",
      [mod.account],
    );
    expect((await pin(mod, a.id, true, 2)).statusCode).toBe(403);
  });
  it('sorts and keyset-pages new, old and popular comments on the server', async () => {
    const s = await source(),
      r1 = await identity(),
      r2 = await identity();
    const a = (await create(s, s.owner, 'Старый популярный')).json(),
      b = (await create(s, s.owner, 'Средний')).json(),
      c = (await create(s, s.owner, 'Новый')).json();
    for (const actor of [r1, r2])
      expect((await command(s, actor, 'like', { commentId: a.id, on: true })).statusCode).toBe(200);
    await command(s, r1, 'like', { commentId: b.id, on: true });
    expect(
      (await read(s, r1, '?sort=newest')).json().items.map((i: { id: string }) => i.id),
    ).toEqual([c.id, b.id, a.id]);
    for (const sort of ['oldest', 'popular']) {
      const ids: string[] = [];
      let cursor = '';
      for (let n = 0; n < 3; n++) {
        const p = (
          await read(s, r1, `?sort=${sort}&limit=1${cursor ? '&before=' + cursor : ''}`)
        ).json();
        ids.push(p.items[0].id);
        cursor = p.nextCursor;
      }
      expect(ids).toEqual([a.id, b.id, c.id]);
      expect(cursor).toBeNull();
    }
    expect((await read(s, r1, '?sort=unknown')).statusCode).toBe(400);
  });
});
