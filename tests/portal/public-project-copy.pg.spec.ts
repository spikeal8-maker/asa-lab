import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildTestApp, inject, type NestApp } from './app';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import {
  createEmptyThreeDDocument,
  createThreeDNode,
} from '../../contexts/three-d/domain/document';
import { THREE_D_MODULE } from '../../contexts/three-d/module';

// A real encoded/decoded raster fixture for publication setup, not editor evidence.
function snapshotFixture(): string {
  const image = new PNG({ width: 32, height: 32 });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 36;
    image.data[offset + 1] = 100;
    image.data[offset + 2] = 189;
    image.data[offset + 3] = 255;
  }
  const bytes = PNG.sync.write(image);
  const decoded = PNG.sync.read(bytes);
  expect(decoded.width).toBe(32);
  expect(decoded.height).toBe(32);
  expect(decoded.data).toEqual(image.data);
  expect(bytes.length).toBeGreaterThanOrEqual(64);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
let admin: pg.Pool;
let runtime: pg.Pool;
let policyFixtureLock: pg.PoolClient;
let app: NestApp;
const sources: string[] = [];
beforeAll(async () => {
  admin = testAdminPool();
  policyFixtureLock = await admin.connect();
  await policyFixtureLock.query(
    "SELECT pg_advisory_lock(hashtextextended('test-public-acquisition-policy',0))",
  );
  runtime = testAppPool();
  app = await buildTestApp(runtime);
}, 90_000);
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
    await policyFixtureLock?.query(
      "SELECT pg_advisory_unlock(hashtextextended('test-public-acquisition-policy',0))",
    );
    policyFixtureLock?.release();
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
async function fixture(license = 'public-domain', module = 'three-d', consent = true) {
  await admin.query('UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key');
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
  const ordinary = await admin.query(
    `SELECT license,copied_from_publication_id,copied_from_revision_id,
            copied_from_version_id,copied_from_license FROM projects WHERE id=$1`,
    [id],
  );
  expect(ordinary.rows).toEqual([
    {
      license: 'reserved',
      copied_from_publication_id: null,
      copied_from_revision_id: null,
      copied_from_version_id: null,
      copied_from_license: null,
    },
  ]);
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
    payload: { sourceRevision: v1.revision, imageDataUrl: snapshotFixture() },
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
  expect(published.json().acquisition).toEqual({ allowed: false, version: 0 });
  if (consent) {
    const enabled = await inject(app, {
      method: 'POST',
      url: `/api/projects/${id}/publication/acquisition`,
      cookies: owner,
      payload: { allowed: true, expectedVersion: 0, expectedRevisionId: publication.revisionId },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().acquisition).toEqual({ allowed: true, version: 1 });
    expect(enabled.json().publication).toEqual(publication);
  }
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
    const author = await admin.query(
      `SELECT profile.display_name,profile.visibility FROM projects project
       JOIN principals actor ON actor.id=project.owner_principal_id
       JOIN profiles profile ON profile.account_id=actor.account_id WHERE project.id=$1`,
      [source.id],
    );
    expect(author.rows[0].visibility).toBe('private');
    expect(detail.json().publication.authorLabel).toBe(author.rows[0].display_name);
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
    const publicCount = async () => {
      const result = await inject(app, {
        method: 'GET',
        url: `/api/public-projects/${source.publication.publicationId}`,
      });
      expect(result.statusCode).toBe(200);
      return result.json().publication.copyCount;
    };
    expect(await publicCount()).toBe(0);
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
    expect(await publicCount()).toBe(1);
    const id = bodies[0].projectId as string;
    expect(id).not.toBe(source.id);
    expect(bodies[0].moduleKey).toBe('three-d');
    const target = await open(source.reader, id);
    expect(target.draft.document).toEqual(source.v1);
    expect(target.project).toMatchObject({ scope: 'personal', classroomId: null });
    const lineage = await admin.query(
      `SELECT p.copied_from_publication_id,p.copied_from_revision_id,p.copied_from_version_id,
              p.copied_from_license,p.license,p.copied_from_project_id,p.copied_from_author,p.copied_from_title,r.publication_id,r.project_id,r.project_version_id,
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
      license: 'public-domain',
      copied_from_project_id: source.id,
      copied_from_author: detail.json().publication.authorLabel,
      copied_from_title: detail.json().publication.title,
      publication_id: source.publication.publicationId,
      project_id: source.id,
      project_version_id: versions[0].version.id,
      version_no: source.publication.versionNo,
      document_json: source.v1,
    });
    const ownership = await admin.query(
      `SELECT id,tenant_id,owner_principal_id,project_scope AS scope,classroom_id FROM projects WHERE id=ANY($1::uuid[])`,
      [[source.id, id]],
    );
    const original = ownership.rows.find((row) => row.id === source.id);
    const copied = ownership.rows.find((row) => row.id === id);
    expect(copied).toMatchObject({ scope: 'personal', classroom_id: null });
    const publicationRows = await admin.query(
      `SELECT (SELECT count(*)::int FROM project_publications WHERE project_id=$1) AS legacy,
              (SELECT count(*)::int FROM project_publication_state
                WHERE project_id=$1 AND state IN ('public','unlisted')) AS live`,
      [id],
    );
    expect(publicationRows.rows[0]).toEqual({ legacy: 0, live: 0 });
    expect((await inject(app, { method: 'GET', url: `/api/projects/${id}` })).statusCode).toBe(401);
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
    expect(await publicCount()).toBe(1);
  });

  it('retains durable aggregate after trash/deletion, rolls back failed inserts and hides private receipts', async () => {
    const source = await fixture();
    const response = await copy(source);
    expect(response.statusCode).toBe(200);
    const destination = response.json().projectId as string;
    const total = async () =>
      Number(
        (
          await runtime.query('SELECT public.publication_copy_count($1) n', [
            source.publication.publicationId,
          ])
        ).rows[0].n,
      );
    expect(await total()).toBe(1);
    for (const sql of [
      'SELECT * FROM public.publication_copy_events',
      `INSERT INTO public.publication_copy_events VALUES('${randomUUID()}','${randomUUID()}',now())`,
      'DELETE FROM public.publication_copy_events',
      'UPDATE public.publication_copy_events SET created_at=now()',
      'SELECT public.record_publication_copy_created()',
    ]) {
      await expect(runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
    }
    const transaction = await admin.connect();
    try {
      await transaction.query('BEGIN');
      await transaction.query(
        `INSERT INTO projects(id,tenant_id,project_scope,module_key,title,
        created_by,owner_principal_id,copied_from_project_id,copied_from_author,copied_from_title,
        copied_at,copied_from_publication_id,copied_from_revision_id,copied_from_version_id,copied_from_license,license)
        SELECT $2,tenant_id,project_scope,module_key,title,created_by,owner_principal_id,
        copied_from_project_id,copied_from_author,copied_from_title,copied_at,
        copied_from_publication_id,copied_from_revision_id,copied_from_version_id,copied_from_license,license
        FROM projects WHERE id=$1`,
        [destination, randomUUID()],
      );
      expect(
        Number(
          (
            await transaction.query('SELECT public.publication_copy_count($1) n', [
              source.publication.publicationId,
            ])
          ).rows[0].n,
        ),
      ).toBe(2);
      expect(await total()).toBe(1);
      await transaction.query('ROLLBACK');
    } finally {
      await transaction.query('ROLLBACK');
      transaction.release();
    }
    expect(await total()).toBe(1);
    const trashed = await inject(app, {
      method: 'POST',
      url: `/api/projects/${destination}/status`,
      cookies: source.reader,
      payload: { status: 'trashed' },
    });
    expect(trashed.statusCode).toBe(201);
    expect(await total()).toBe(1);
    await admin.query('DELETE FROM projects WHERE id=$1', [destination]);
    expect(await total()).toBe(1);
    await admin.query(
      "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE id=$1",
      [source.publication.publicationId],
    );
    expect(await total()).toBe(0);
    expect(
      (
        await inject(app, {
          method: 'GET',
          url: `/api/public-projects/${source.publication.publicationId}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int n FROM publication_copy_events WHERE publication_id=$1',
          [source.publication.publicationId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      Number(
        (await runtime.query('SELECT public.publication_copy_count($1) n', [randomUUID()])).rows[0]
          .n,
      ),
    ).toBe(0);
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

  it('denies default-OFF StudentSeat and mixed Account/Seat cookies without Account fallback', async () => {
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
    const seatOnly = await copy(source, randomUUID(), {}, { asa_student_session: studentToken });
    expect(seatOnly.statusCode).toBe(403);
    expect(seatOnly.json().error.code).toBe('copy_forbidden');
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(0);

    const mixed = await copy(
      source,
      randomUUID(),
      {},
      {
        ...source.reader,
        asa_student_session: studentToken,
      },
    );
    expect(mixed.statusCode).toBe(409);
    expect(mixed.json().error.code).toBe('session_conflict');
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(0);
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
          payload: { sourceRevision: current.draft.revision, imageDataUrl: snapshotFixture() },
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

/** Publish via the real snapshot/publication APIs. The legacy branch seeds only
 * a mutable isolated-test draft, representing historical pre-normalizer storage;
 * it never rewrites an immutable ProjectVersion or disables a database trigger. */
async function publishAdmissionCandidate(
  source: Fixture,
  document: Record<string, unknown>,
  legacyDraft = false,
) {
  const current = await open(source.owner, source.id);
  let revision: number;
  if (legacyDraft) {
    const seeded = await admin.query<{ revision: number }>(
      `UPDATE project_drafts SET document_json=$2::jsonb,revision=revision+1,updated_at=now()
        WHERE project_id=$1 RETURNING revision`,
      [source.id, JSON.stringify(document)],
    );
    expect(seeded.rows).toHaveLength(1);
    revision = seeded.rows[0].revision;
  } else {
    const saved = await save(source.owner, source.id, document, current.draft.revision);
    expect(saved.document).toEqual(document);
    revision = saved.revision;
  }
  const snapshot = await inject(app, {
    method: 'PUT',
    url: `/api/projects/${source.id}/snapshot`,
    cookies: source.owner,
    payload: {
      sourceRevision: revision,
      imageDataUrl: snapshotFixture(),
    },
  });
  expect(snapshot.statusCode).toBe(200);
  const published = await inject(app, {
    method: 'POST',
    url: `/api/projects/${source.id}/publication`,
    cookies: source.owner,
    payload: { license: 'public-domain' },
  });
  expect(published.statusCode).toBe(200);
  const publication = published.json().publication;
  expect(publication.revisionId).not.toBe(source.publication.revisionId);
  const stored = await admin.query(
    `SELECT v.document_json FROM project_publication_revisions r
       JOIN project_versions v ON v.id=r.project_version_id WHERE r.id=$1`,
    [publication.revisionId],
  );
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0].document_json).toEqual(document);
  return { ...source, publication, v1: document };
}

async function readableAdmissionDetail(source: Fixture, canCopy: boolean) {
  const response = await inject(app, {
    method: 'GET',
    url: `/api/public-projects/${source.publication.publicationId}`,
  });
  expect(response.statusCode).toBe(200);
  const publication = response.json().publication;
  expect(publication).toMatchObject({
    publicationId: source.publication.publicationId,
    revisionId: source.publication.revisionId,
    moduleKey: 'three-d',
    license: 'public-domain',
    capabilities: { canCopy, downloadFormats: [] },
  });
  const privateIdentity = await admin.query(
    `SELECT p.tenant_id,p.owner_principal_id,r.project_version_id
       FROM projects p JOIN project_publication_revisions r ON r.project_id=p.id
      WHERE p.id=$1 AND r.id=$2`,
    [source.id, source.publication.revisionId],
  );
  for (const secret of [
    source.id,
    privateIdentity.rows[0].tenant_id,
    privateIdentity.rows[0].owner_principal_id,
    privateIdentity.rows[0].project_version_id,
    'published-box',
    'private-asset-copy-regression',
  ]) {
    expect(response.body).not.toContain(secret);
  }
  const assertNoDocument = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(assertNoDocument);
    if (value === null || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      expect([
        'document',
        'document_json',
        'draft',
        'assetId',
        'sourceProjectId',
        'tenantId',
        'principalId',
      ]).not.toContain(key);
      assertNoDocument(nested);
    }
  };
  assertNoDocument(response.json());
  const image = await inject(app, { method: 'GET', url: publication.preview.url });
  expect(image.statusCode).toBe(200);
  expect(image.headers['content-type']).toMatch(/^image\/png/);
  return publication;
}

describe('copy capability uses exact immutable document admission', () => {
  it('advertises and copies canonical public-domain 3D without exposing its source document', async () => {
    const source = await fixture();
    await readableAdmissionDetail(source, true);
    const copied = await copy(source);
    expect([200, 201]).toContain(copied.statusCode);
    expect(copied.json()).toEqual({
      projectId: expect.any(String),
      moduleKey: 'three-d',
      created: true,
    });
    expect((await open(source.reader, copied.json().projectId)).draft.document).toEqual(source.v1);
  });

  it('keeps extension-bearing published 3D readable but disables capability and rejects copy', async () => {
    const source = await publishAdmissionCandidate(await fixture(), {
      ...scene(37),
      assetId: 'private-asset-copy-regression',
    });
    await readableAdmissionDetail(source, false);
    const versions = await frozen(source.id);
    const rejected = await copy(source);
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('copy_unsupported');
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await frozen(source.id)).toEqual(versions);
  });

  it('does not advertise or partially copy a historical 3D document requiring parser normalization', async () => {
    // Old 3D documents may omit ruler; the current parser supplies DEFAULT_RULER.
    // Normal saves normalize it, so seed the historical mutable draft directly
    // before freezing it through the unchanged publication API.
    const legacy: Record<string, unknown> = { ...scene(37) };
    delete legacy.ruler;
    const parsed = THREE_D_MODULE.provider?.validate(legacy);
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) throw new Error('Historical 3D fixture must remain parser-valid');
    expect(parsed.payload).not.toEqual(legacy);
    const source = await publishAdmissionCandidate(await fixture(), legacy, true);
    await readableAdmissionDetail(source, false);
    const versions = await frozen(source.id);
    const rejected = await copy(source);
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('copy_unsupported');
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(await frozen(source.id)).toEqual(versions);
  });
});

async function platformAdmin() {
  const cookies = await account();
  const identity = (
    await admin.query(
      `SELECT actor.id principal_id,actor.account_id FROM sessions_v2 session
    JOIN principals actor ON actor.id=session.principal_id WHERE session.token_hash=$1`,
      [hashSessionToken(cookies.asa_session)],
    )
  ).rows[0];
  await admin.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    identity.account_id,
  ]);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','acquisition-test','admin')",
    [identity.account_id],
  );
  return { cookies, principal: identity.principal_id as string };
}
function consent(
  source: Fixture,
  allowed: boolean,
  version: number,
  cookies = source.owner,
  revision = source.publication.revisionId,
) {
  return inject(app, {
    method: 'POST',
    url: `/api/projects/${source.id}/publication/acquisition`,
    cookies,
    payload: { allowed, expectedVersion: version, expectedRevisionId: revision },
  });
}
describe('global and author acquisition controls', () => {
  it('defaults source consent OFF; CAS and exact ownership change consent without publishing private V2', async () => {
    const source = await fixture('public-domain', 'three-d', false);
    const before = await open(source.owner, source.id);
    const immutable = await frozen(source.id);
    expect((await copy(source)).statusCode).toBe(403);
    expect((await consent(source, true, 0, source.reader)).statusCode).toBe(404);
    expect((await consent(source, true, 0, source.owner, randomUUID())).statusCode).toBe(409);
    expect((await consent(source, true, 0)).statusCode).toBe(200);
    expect((await consent(source, false, 0)).statusCode).toBe(409);
    const first = await copy(source);
    expect(first.statusCode).toBe(200);
    expect((await open(source.reader, first.json().projectId)).draft.document).toEqual(source.v1);
    expect((await consent(source, false, 1)).statusCode).toBe(200);
    expect((await copy(source)).statusCode).toBe(403);
    expect((await open(source.owner, source.id)).draft).toEqual(before.draft);
    expect(await frozen(source.id)).toEqual(immutable);
    expect((await open(source.reader, first.json().projectId)).draft.document).toEqual(source.v1);
  });

  it('verified platform admin uses versioned existing audit; global OFF overrides Account and does not hide publication', async () => {
    const source = await fixture();
    const actor = await platformAdmin();
    const url = '/api/admin/v1/publications/acquisition';
    const read = await inject(app, { method: 'GET', url, cookies: actor.cookies });
    expect(read.statusCode).toBe(200);
    const version = read.json().version;
    expect(
      (
        await inject(app, {
          method: 'POST',
          url,
          cookies: source.reader,
          payload: { enabled: false, expectedVersion: version, reason: 'No grant' },
        })
      ).statusCode,
    ).toBe(403);
    const off = await inject(app, {
      method: 'POST',
      url,
      cookies: actor.cookies,
      payload: { enabled: false, expectedVersion: version, reason: 'Owner global prohibition' },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ enabled: false, version: version + 1 });
    expect((await copy(source)).statusCode).toBe(403);
    const detail = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${source.publication.publicationId}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().publication.capabilities.canCopy).toBe(false);
    expect(
      (
        await inject(app, {
          method: 'POST',
          url,
          cookies: actor.cookies,
          payload: { enabled: true, expectedVersion: version, reason: 'Stale' },
        })
      ).statusCode,
    ).toBe(409);
    const audit = (
      await admin.query(
        "SELECT metadata_json,reason_text,request_id,before_version,after_version FROM administrative_audit_events WHERE actor_principal_id=$1 AND action='publication.acquisition' ORDER BY occurred_at DESC LIMIT 1",
        [actor.principal],
      )
    ).rows[0];
    expect(audit.metadata_json).toEqual({
      before: { enabled: true, version },
      after: { enabled: false, version: version + 1 },
    });
    expect(audit.reason_text).toBe('Owner global prohibition');
    expect(audit.request_id).toBeTruthy();
    // Author can preconfigure consent while the platform is OFF.
    expect((await consent(source, false, 1)).statusCode).toBe(200);
    expect((await consent(source, true, 2)).statusCode).toBe(200);
    expect((await copy(source)).statusCode).toBe(403);
    expect(
      (
        await inject(app, {
          method: 'POST',
          url,
          cookies: actor.cookies,
          payload: { enabled: true, expectedVersion: version + 1, reason: 'Explicit enable' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await copy(source)).statusCode).toBe(200);
  });

  it('suspended Account cannot acquire through direct API or the underlying resolver', async () => {
    const source = await fixture();
    const actor = (
      await admin.query(
        'SELECT actor.id,actor.account_id FROM sessions_v2 session JOIN principals actor ON actor.id=session.principal_id WHERE session.token_hash=$1',
        [hashSessionToken(source.reader.asa_session)],
      )
    ).rows[0];
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [actor.account_id]);
    expect([401, 403]).toContain((await copy(source)).statusCode);
    await expect(
      runtime.query('SELECT * FROM public_project_copy_source($1,$2,$3)', [
        actor.id,
        source.publication.publicationId,
        source.publication.revisionId,
      ]),
    ).rejects.toMatchObject({ code: 'P5C01' });
  });

  it('fresh actor-only Seat admission copies a FOREIGN public V1 through canonical writer; class/individual/global OFF and session revocation fail closed', async () => {
    const source = await fixture('public-domain', 'three-d');
    const seat = await studentProjectPolicyFixture(admin, runtime);
    sources.push(seat.projectId);
    const cookies = { asa_student_session: seat.token };
    expect((await copy(source, randomUUID(), {}, cookies)).statusCode).toBe(403);
    expect(await seat.write({ publish: false, download: true, expectedVersion: 0 })).toMatchObject({
      version: 1,
    });
    const key = randomUUID();
    const copied = await copy(source, key, {}, cookies);
    expect(copied.statusCode).toBe(200);
    expect((await copy(source, key, {}, cookies)).json().projectId).toBe(copied.json().projectId);
    const id = copied.json().projectId;
    const opened = await inject(app, { method: 'GET', url: `/api/projects/${id}`, cookies });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().draft.document).toEqual(source.v1);
    const changed = scene(92);
    const saved = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${id}/draft`,
      cookies,
      payload: {
        document: changed,
        baseRevision: opened.json().draft.revision,
        mutationId: randomUUID(),
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(
      (await inject(app, { method: 'GET', url: `/api/projects/${id}`, cookies })).json().draft
        .document,
    ).toEqual(changed);
    const other = await studentProjectPolicyFixture(admin, runtime);
    sources.push(other.projectId);
    expect(
      (
        await inject(app, {
          method: 'GET',
          url: `/api/projects/${id}`,
          cookies: { asa_student_session: other.token },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      await seat.write(
        { publishOverride: 'inherit', downloadOverride: 'deny', expectedVersion: 1 },
        seat.seatId,
      ),
    ).toMatchObject({ version: 2 });
    expect((await copy(source, randomUUID(), {}, cookies)).statusCode).toBe(403);
    expect(await seat.write({ publish: false, download: false, expectedVersion: 2 })).toMatchObject(
      { version: 3 },
    );
    expect(
      await seat.write(
        { publishOverride: 'inherit', downloadOverride: 'allow', expectedVersion: 3 },
        seat.seatId,
      ),
    ).toMatchObject({ version: 4 });
    expect((await copy(source, randomUUID(), {}, cookies)).statusCode).toBe(200);
    for (const table of ['classrooms', 'classroom_student_seats'] as const) {
      const rowId = table === 'classrooms' ? seat.classroomId : seat.seatId;
      await admin.query(`UPDATE ${table} SET status=$2 WHERE id=$1`, [
        rowId,
        table === 'classrooms' ? 'archived' : 'suspended',
      ]);
      expect([401, 403]).toContain((await copy(source, randomUUID(), {}, cookies)).statusCode);
      await admin.query(`UPDATE ${table} SET status='active' WHERE id=$1`, [rowId]);
    }
    await admin.query(
      'UPDATE publication_acquisition_settings SET enabled=false WHERE singleton_key',
    );
    expect((await copy(source, randomUUID(), {}, cookies)).statusCode).toBe(403);
    await admin.query(
      'UPDATE publication_acquisition_settings SET enabled=true WHERE singleton_key',
    );
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [seat.hash],
    );
    expect((await copy(source, randomUUID(), {}, cookies)).statusCode).toBe(401);
    const copiesBeforeEmptySeat = (
      await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
        source.id,
      ])
    ).rows[0].n;
    const emptySeat = await copy(
      source,
      randomUUID(),
      {},
      { ...source.reader, asa_student_session: '' },
    );
    expect(emptySeat.statusCode).toBe(401);
    expect(emptySeat.json().error.code).toBe('unauthorized');
    expect(
      (
        await admin.query('SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1', [
          source.id,
        ])
      ).rows[0].n,
    ).toBe(copiesBeforeEmptySeat);
  });

  it.each(['global', 'author'] as const)(
    'serializes committed %s OFF before a waiting copy',
    async (kind) => {
      const source = await fixture();
      const writer = await admin.connect();
      let pending: ReturnType<typeof copy> | undefined;
      const finishCopy = async () => {
        if (!pending) throw new Error('Copy request was not started');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(new Error('OFF/copy request did not finish within the bounded deadline')),
                3_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      };
      try {
        await writer.query('BEGIN');
        if (kind === 'global')
          await writer.query(
            'UPDATE publication_acquisition_settings SET enabled=false WHERE singleton_key',
          );
        else {
          await writer.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [source.id]);
          await writer.query(
            'UPDATE project_publication_state SET acquisition_allowed=false,acquisition_version=acquisition_version+1 WHERE project_id=$1',
            [source.id],
          );
        }
        const lockerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0].pid;
        pending = copy(source);
        // Observe the actual HTTP command's runtime backend waiting on this
        // exact OFF transaction. Starting a Promise alone is not contention proof.
        const deadline = Date.now() + 3_000;
        let blockedCopyPid: number | undefined;
        while (Date.now() < deadline) {
          const blocked = await admin.query<{ pid: number }>(
            `SELECT activity.pid FROM pg_stat_activity activity
             WHERE activity.datname=current_database() AND activity.usename='asalab_app'
               AND activity.state='active' AND activity.wait_event_type='Lock'
               AND activity.query='SELECT * FROM public_project_copy_source($1,$2,$3)'
               AND $1::integer=ANY(pg_blocking_pids(activity.pid))`,
            [lockerPid],
          );
          if (blocked.rows.length === 1) {
            blockedCopyPid = blocked.rows[0].pid;
            break;
          }
        }
        expect(
          blockedCopyPid,
          `${kind} OFF must block the actual copy source query before commit`,
        ).toBeTypeOf('number');
        // No Project writer may have run while admission is blocked.
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1',
              [source.id],
            )
          ).rows[0].n,
        ).toBe(0);
        await writer.query('COMMIT');
        expect((await finishCopy()).statusCode).toBe(403);
        expect(
          (
            await admin.query(
              'SELECT count(*)::int n FROM projects WHERE copied_from_project_id=$1',
              [source.id],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        // Release the known blocker even if barrier/assertions fail. Drain the
        // HTTP request with a finite deadline rather than leaving a pending lock.
        try {
          await writer.query('ROLLBACK');
        } finally {
          writer.release();
        }
        if (pending) await finishCopy();
      }
    },
  );
});
