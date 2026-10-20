import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildTestApp, inject, type NestApp } from './app';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import {
  createEmptyThreeDDocument,
  createThreeDNode,
} from '../../contexts/three-d/domain/document';
import { THREE_D_MODULE } from '../../contexts/three-d/module';

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
const sources: string[] = [];
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
});
afterAll(async () => {
  try {
    if (sources.length)
      await admin.query(
        `UPDATE project_publication_state SET state='revoked', revoked_at=now()
       WHERE project_id=ANY($1::uuid[]) AND state IN ('public','unlisted')`,
        [sources],
      );
  } finally {
    await app?.close();
    await admin?.end();
  }
});

async function account() {
  const id = randomUUID().replaceAll('-', '');
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `copy-${id}@isolated.test`,
      username: `copy_${id.slice(0, 24)}`,
      displayName: `Автор ${id}`,
      password: `Copy-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.statusCode).toBe(201);
  const token = response.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  if (!token) throw new Error('Account registration returned no session');
  const personal = await admin.query(
    `SELECT w.id FROM accounts a
       JOIN workspace_memberships m ON m.account_id=a.id AND m.state='active' AND m.role='owner'
       JOIN workspaces w ON w.id=m.workspace_id AND w.kind='personal' AND w.status='active'
       JOIN principals actor ON actor.account_id=a.id AND actor.kind='account'
       JOIN sessions_v2 session ON session.principal_id=actor.id AND session.active_workspace_id=w.id
      WHERE a.email=$1 AND a.status='active'`,
    [`copy-${id}@isolated.test`],
  );
  expect(personal.rows).toHaveLength(1);
  return { asa_session: token };
}
type Cookies = Awaited<ReturnType<typeof account>>;
function scene(width: number) {
  const node = createThreeDNode('box', 'published-box');
  const document = {
    ...createEmptyThreeDDocument(),
    nodes: [{ ...node, dimensions: { ...node.dimensions, width } }],
  };
  expect(THREE_D_MODULE.provider?.validate(document).ok).toBe(true);
  return document;
}
async function open(cookies: Cookies, id: string) {
  const response = await inject(app, { method: 'GET', url: `/api/projects/${id}`, cookies });
  expect(response.statusCode).toBe(200);
  return response.json();
}
async function save(cookies: Cookies, id: string, document: unknown, baseRevision: number) {
  const response = await inject(app, {
    method: 'PUT',
    url: `/api/projects/${id}/draft`,
    cookies,
    payload: { document, baseRevision, mutationId: randomUUID() },
  });
  expect(response.statusCode).toBe(200);
  return response.json().draft;
}
async function fixture(license = 'public-domain', module = 'three-d') {
  const owner = await account();
  const reader = await account();
  const created = await inject(app, {
    method: 'POST',
    url: '/api/projects',
    cookies: owner,
    headers: { 'idempotency-key': randomUUID() },
    payload: { scope: 'personal', module, title: 'Published V1' },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().project.id as string;
  sources.push(id);
  const initial = await open(owner, id);
  const v1 = await save(
    owner,
    id,
    module === 'three-d' ? scene(37) : initial.draft.document,
    initial.draft.revision,
  );
  const snapshot = await inject(app, {
    method: 'PUT',
    url: `/api/projects/${id}/snapshot`,
    cookies: owner,
    payload: {
      sourceRevision: v1.revision,
      imageDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    },
  });
  expect(snapshot.statusCode).toBe(200);
  const published = await inject(app, {
    method: 'POST',
    url: `/api/projects/${id}/publication`,
    cookies: owner,
    payload: { title: 'Published V1', license },
  });
  expect(published.statusCode).toBe(200);
  const publication = published.json().publication;
  if (module === 'three-d') await save(owner, id, scene(83), v1.revision);
  return { owner, reader, id, publication, v1: v1.document };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function copy(
  source: Fixture,
  key = randomUUID(),
  payload: Record<string, unknown> = {},
  cookies: Record<string, string> = source.reader,
) {
  return inject(app, {
    method: 'POST',
    url: `/api/public-projects/${source.publication.publicationId}/copy`,
    cookies,
    headers: { 'idempotency-key': key },
    payload: { revisionId: source.publication.revisionId, ...payload },
  });
}
async function frozen(id: string) {
  return (
    await admin.query(
      `SELECT to_jsonb(v) AS version FROM project_versions v WHERE project_id=$1 ORDER BY version_no`,
      [id],
    )
  ).rows;
}

describe('published copy / real HTTP and restricted PostgreSQL', () => {
  it('copies exact V1, atomically deduplicates concurrent requests and preserves independent editable ownership and lineage', async () => {
    const source = await fixture();
    const before = await open(source.owner, source.id);
    const versions = await frozen(source.id);
    const detail = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${source.publication.publicationId}`,
    });
    expect(detail.json().publication.capabilities).toMatchObject({
      canCopy: true,
      downloadFormats: [],
    });
    const count = async () =>
      Number(
        (
          await admin.query('SELECT count(*) n FROM projects WHERE copied_from_project_id=$1', [
            source.id,
          ])
        ).rows[0].n,
      );
    const initial = await count();
    const key = randomUUID();
    // Both requests start before awaiting either result; no retry or timing sleep.
    const responses = await Promise.all([copy(source, key), copy(source, key)]);
    for (const response of responses) expect([200, 201]).toContain(response.statusCode);
    const bodies = responses.map((response) => response.json());
    expect(bodies[0].projectId).toBe(bodies[1].projectId);
    expect(bodies.filter((body) => body.created === true)).toHaveLength(1);
    expect(bodies.filter((body) => body.created === false)).toHaveLength(1);
    expect(await count()).toBe(initial + 1);
    const id = bodies[0].projectId as string;
    expect(id).not.toBe(source.id);
    expect(bodies[0].moduleKey).toBe('three-d');
    const target = await open(source.reader, id);
    expect(target.draft.document).toEqual(source.v1);
    expect(target.project).toMatchObject({
      scope: 'personal',
      classroomId: null,
      license: 'public-domain',
      copiedFrom: {
        projectId: source.id,
        title: detail.json().publication.title,
        author: detail.json().publication.authorLabel,
      },
    });
    const lineage = await admin.query(
      `SELECT p.copied_from_publication_id,p.copied_from_revision_id,p.copied_from_version_id,
              p.copied_from_license,r.publication_id,r.project_id,r.project_version_id,
              v.document_json,v.version_no
         FROM projects p
         JOIN project_publication_revisions r ON r.id=p.copied_from_revision_id
         JOIN project_versions v ON v.id=r.project_version_id
        WHERE p.id=$1`,
      [id],
    );
    expect(lineage.rows).toHaveLength(1);
    expect(lineage.rows[0]).toMatchObject({
      copied_from_publication_id: source.publication.publicationId,
      copied_from_revision_id: source.publication.revisionId,
      copied_from_version_id: versions[0].version.id,
      copied_from_license: 'public-domain',
      publication_id: source.publication.publicationId,
      project_id: source.id,
      project_version_id: versions[0].version.id,
      version_no: source.publication.versionNo,
      document_json: source.v1,
    });
    const ownership = await admin.query(
      `SELECT id,tenant_id,owner_principal_id,visibility FROM projects WHERE id=ANY($1::uuid[])`,
      [[source.id, id]],
    );
    const original = ownership.rows.find((row) => row.id === source.id);
    const copied = ownership.rows.find((row) => row.id === id);
    expect(copied.visibility).toBe('private');
    expect(copied.tenant_id).not.toBe(original.tenant_id);
    expect(copied.owner_principal_id).not.toBe(original.owner_principal_id);
    expect(
      (await inject(app, { method: 'GET', url: `/api/projects/${id}`, cookies: source.owner }))
        .statusCode,
    ).toBe(404);
    const changed = scene(61);
    await save(source.reader, id, changed, target.draft.revision);
    expect((await open(source.reader, id)).draft.document).toEqual(changed);
    expect((await open(source.owner, source.id)).draft).toEqual(before.draft);
    expect(await frozen(source.id)).toEqual(versions);
    expect((await copy(source, key, { title: 'Different fingerprint' })).statusCode).toBe(409);
    expect(await count()).toBe(initial + 1);
  });

  it('requires login, idempotency key and a strict request body without creating Projects', async () => {
    const source = await fixture();
    const count = (
      await admin.query('SELECT count(*) n FROM projects WHERE copied_from_project_id=$1', [
        source.id,
      ])
    ).rows[0].n;
    expect((await copy(source, randomUUID(), {}, {})).statusCode).toBe(401);
    const missingKey = await inject(app, {
      method: 'POST',
      url: `/api/public-projects/${source.publication.publicationId}/copy`,
      cookies: source.reader,
      payload: { revisionId: source.publication.revisionId },
    });
    expect(missingKey.statusCode).toBe(400);
    for (const payload of [
      { tenantId: randomUUID() },
      { ownerPrincipalId: randomUUID() },
      { document: scene(11) },
      { moduleKey: 'electronics' },
      { title: 'x'.repeat(1000) },
    ]) {
      expect((await copy(source, randomUUID(), payload)).statusCode).toBe(400);
    }
    expect(
      (
        await admin.query('SELECT count(*) n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(count);
  });

  it.each(['reserved', 'cc-by', 'cc-by-sa'])('fails closed for license %s', async (license) => {
    const source = await fixture(license);
    const detail = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${source.publication.publicationId}`,
    });
    expect(detail.json().publication.capabilities.canCopy).toBe(false);
    expect((await copy(source)).statusCode).toBe(403);
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it.each(['revoked', 'unlisted', 'learning'])(
    'rechecks current %s policy after metadata was read',
    async (policy) => {
      const source = await fixture();
      if (policy === 'learning') {
        await admin.query(
          `INSERT INTO learning_legacy_project_origins(project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at)
        SELECT id,tenant_id,tenant_id,$2,now() FROM projects WHERE id=$1`,
          [source.id, randomUUID()],
        );
      } else {
        await admin.query('UPDATE project_publication_state SET state=$2 WHERE project_id=$1', [
          source.id,
          policy,
        ]);
      }
      expect((await copy(source)).statusCode).toBe(404);
    },
  );

  it('rejects StudentSeat and mixed Account/Seat cookies without Account fallback', async () => {
    const source = await fixture();
    const teacher = await seedTeacher(admin, `copy-seat-${randomUUID().slice(0, 8)}`);
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    expect(login.statusCode).toBe(200);
    const token = login.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
    if (!token) throw new Error('Teacher login has no cookie');
    const cookies = { asa_session: token };
    const classroom = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies,
      headers: { 'idempotency-key': randomUUID() },
      payload: { title: 'Copy context boundary' },
    });
    expect(classroom.statusCode).toBe(201);
    const id = classroom.json().classroom.id;
    const info = await inject(app, { method: 'GET', url: `/api/classrooms/${id}`, cookies });
    const seat = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${id}/seats`,
      cookies,
      payload: { displayLabel: 'Copy pupil', safeMode: false },
    });
    expect(seat.statusCode).toBe(201);
    const issued = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${id}/seats/${seat.json().student.id}/code`,
      cookies,
      payload: { requestId: randomUUID() },
    });
    expect(issued.statusCode).toBe(201);
    const signed = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: info.json().classroom.joinCode, studentCode: issued.json().studentCode },
    });
    expect(signed.statusCode).toBe(200);
    const studentToken = signed.cookies.find(
      (cookie) => cookie.name === 'asa_student_session',
    )?.value;
    if (!studentToken) throw new Error('Seat login has no cookie');
    for (const selected of [
      { asa_student_session: studentToken },
      { ...source.reader, asa_student_session: studentToken },
    ]) {
      expect((await copy(source, randomUUID(), {}, selected)).statusCode).toBe(403);
    }
  });

  it('observes a committed revocation ordered before copy by the source Project lock', async () => {
    const source = await fixture();
    const writer = await admin.connect();
    let pending: ReturnType<typeof copy> | undefined;
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [source.id]);
      await writer.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE project_id=$1",
        [source.id],
      );
      pending = copy(source);
      await writer.query('COMMIT');
      expect((await pending).statusCode).toBe(404);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1',
            [source.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await writer.query('ROLLBACK');
      writer.release();
      await pending;
    }
  });

  it.each(['blocks'])('does not enable unproven module %s', async (moduleKey) => {
    const source = await fixture('public-domain', moduleKey);
    expect((await copy(source)).statusCode).toBe(403);
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(0);
  });

  it('rejects stale revision instead of silently substituting the newest publication', async () => {
    const source = await fixture();
    const current = await open(source.owner, source.id);
    expect(
      (
        await inject(app, {
          method: 'PUT',
          url: `/api/projects/${source.id}/snapshot`,
          cookies: source.owner,
          payload: {
            sourceRevision: current.draft.revision,
            imageDataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject(app, {
          method: 'POST',
          url: `/api/projects/${source.id}/publication`,
          cookies: source.owner,
          payload: { license: 'public-domain' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await copy(source)).statusCode).toBe(409);
  });
});
