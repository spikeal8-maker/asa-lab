import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type pg from 'pg';
import { buildTestApp, inject, type NestApp } from './app';
import { testAdminPool, testAppPool, seedTeacher } from './helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let baseUrl: string;
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
  await admin?.end();
});
function document(value = 330) {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'r',
        kind: 'resistor',
        position: { x: 100, y: 100 },
        value,
        stateProperties: { code: 'PRIVATE ARDUINO SOURCE', token: 'PRIVATE SECRET' },
      },
      { id: 'l', kind: 'led', position: { x: 200, y: 100 }, value: 2 },
    ],
    connections: [
      {
        id: 'w',
        from: { componentId: 'r', terminal: 'b' },
        to: { componentId: 'l', terminal: 'a' },
        vertices: [{ x: 150, y: 100 }],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}
async function fixture(initialDocument: unknown = document()) {
  const teacher = await seedTeacher(admin, 'artifact-' + randomUUID().slice(0, 8));
  const principal = (
    await admin.query(
      'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0].principal_id as string;
  const repo = new PgProjectRepository(admin);
  const actor = { userId: teacher.teacherId, principalId: principal };
  const created = await repo.createWithDraft({
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: 'Public circuit',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument,
    initialPreview: null,
  });
  if (created.kind !== 'created') throw Error('fixture not created');
  const projectId = created.project.id;
  async function snapshot(revision: number) {
    expect(
      await repo.saveSnapshot({
        tenantId: teacher.tenantId,
        actor,
        projectId,
        sourceRevision: revision,
        image: {
          bytes: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQCu34TwlmGDVg1IBRA4aLAQDLpv4Q+i0QiwAAAABJRU5ErkJggg==',
            'base64',
          ),
          contentType: 'image/png',
          width: 16,
          height: 16,
        },
      }),
    ).not.toBeNull();
  }
  async function publish() {
    return (
      await admin.query('SELECT project_publication_publish($1,$2,$3::jsonb) AS result', [
        principal,
        projectId,
        JSON.stringify({ title: 'Circuit', license: 'reserved' }),
      ])
    ).rows[0].result.publication as { publicationId: string; revisionId: string };
  }
  await snapshot(1);
  const publication = await publish();
  return { teacher, principal, repo, actor, projectId, snapshot, publish, publication };
}
async function read(
  p: { publicationId: string; revisionId: string },
  cookies: Record<string, string> = {},
) {
  const response = await fetch(
    baseUrl + `/api/public-projects/${p.publicationId}/artifact?revisionId=${p.revisionId}`,
    {
      headers: {
        'if-none-match': '*',
        'if-modified-since': 'Wed, 21 Oct 2099 07:28:00 GMT',
        cookie: Object.entries(cookies)
          .map(([k, v]) => k + '=' + v)
          .join(';'),
      },
    },
  );
  const body = await response.text();
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body,
    json: () => JSON.parse(body),
  };
}
describe('public Electronics artifact real HTTP and restricted PostgreSQL', () => {
  it('publishes native switch/mirror/RGB geometry configuration while excluding Arduino and private properties', async () => {
    const doc = document();
    const native = {
      ...doc,
      components: [
        ...doc.components,
        {
          id: 's',
          kind: 'switch',
          position: { x: 350, y: 100 },
          value: 0,
          state: true,
          stateProperties: {
            mirrorX: true,
            mirrorY: true,
            code: 'PRIVATE SWITCH SOURCE',
            url: 'https://private.invalid',
          },
        },
        {
          id: 'rgb',
          kind: 'rgb-led',
          position: { x: 450, y: 100 },
          value: 2,
          pinIds: ['red', 'common', 'blue', 'green'],
          stateProperties: {
            pinLayout: 'BRCG',
            mirrorX: true,
            code: 'PRIVATE RGB SOURCE',
            token: 'secret',
          },
        },
      ],
      connections: [
        ...doc.connections,
        {
          id: 'sw',
          from: { componentId: 's', terminal: 'b' },
          to: { componentId: 'rgb', terminal: 'red' },
        },
      ],
    };
    const f = await fixture(native);
    const result = await read(f.publication);
    expect(result.statusCode).toBe(200);
    const artifact = result.json().artifact;
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.components.find((c: { id: string }) => c.id === 's')).toMatchObject({
      state: true,
      visualProperties: { mirrorX: true, mirrorY: true },
    });
    expect(artifact.components.find((c: { id: string }) => c.id === 'rgb')).toMatchObject({
      visualProperties: { pinLayout: 'BRCG', mirrorX: true },
    });
    expect(result.body).not.toMatch(/PRIVATE|https:|token|stateProperties|tenant|principal/);
  });

  it('serves exact immutable V1 to guests and Seats, hides raw source, leaves project unchanged, rejects stale/revoked', async () => {
    const f = await fixture();
    const before = await admin.query(
      'SELECT to_jsonb(d) data FROM project_drafts d WHERE project_id=$1',
      [f.projectId],
    );
    const guest = await read(f.publication);
    expect(guest.statusCode).toBe(200);
    expect(guest.headers['cache-control']).toBe('no-store');
    expect(guest.json().artifact).toMatchObject({
      schemaVersion: 2,
      components: [{ id: 'r', value: 330 }, { id: 'l' }],
      connections: [{ id: 'w' }],
    });
    expect(guest.body).not.toMatch(
      /PRIVATE|code|token|stateProperties|tenant|principal|viewport|simulation/,
    );
    // A real Seat login is independent of the owner Account.
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: f.teacher.workspace,
        email: f.teacher.email,
        password: f.teacher.password,
      },
    });
    expect(login.statusCode).toBe(200);
    const token = login.cookies.find((c) => c.name === 'asa_session')?.value;
    if (!token) throw Error('no Account cookie');
    const cookies = { asa_session: token };
    const classroom = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      cookies,
      headers: { 'idempotency-key': randomUUID() },
      payload: { title: 'Viewer Seat' },
    });
    expect(classroom.statusCode).toBe(201);
    const classId = classroom.json().classroom.id;
    const info = await inject(app, { method: 'GET', url: `/api/classrooms/${classId}`, cookies });
    const seat = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats`,
      cookies,
      payload: { displayLabel: 'Viewer', safeMode: false },
    });
    expect(seat.statusCode).toBe(201);
    const code = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classId}/seats/${seat.json().student.id}/code`,
      cookies,
      payload: { requestId: randomUUID() },
    });
    expect(code.statusCode).toBe(201);
    const signed = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: info.json().classroom.joinCode, studentCode: code.json().studentCode },
    });
    expect(signed.statusCode).toBe(200);
    const seatToken = signed.cookies.find((c) => c.name === 'asa_student_session')?.value;
    if (!seatToken) throw Error('no Seat cookie');
    expect((await read(f.publication, { asa_student_session: seatToken })).json()).toEqual(
      guest.json(),
    );
    expect(
      (
        await admin.query('SELECT to_jsonb(d) data FROM project_drafts d WHERE project_id=$1', [
          f.projectId,
        ])
      ).rows,
    ).toEqual(before.rows);
    await admin.query('UPDATE project_drafts SET document_json=$2::jsonb WHERE project_id=$1', [
      f.projectId,
      JSON.stringify(document(999)),
    ]);
    expect((await read(f.publication)).json()).toEqual(guest.json());
    // Republish a freshly saved draft (canonical save increments revision).
    const opened = { revision: 1 };
    await f.repo.saveDraft({
      tenantId: f.teacher.tenantId,
      projectId: f.projectId,
      actor: f.actor,
      document: document(777),
      baseRevision: opened!.revision,
      mutationId: randomUUID(),
      preview: null,
    });
    await f.snapshot(opened!.revision + 1);
    const next = await f.publish();
    expect(next.revisionId).not.toBe(f.publication.revisionId);
    expect((await read(f.publication)).statusCode).toBe(404);
    expect((await read(next)).json().artifact.components[0].value).toBe(777);
    await admin.query('SELECT project_publication_revoke($1,$2)', [f.principal, f.projectId]);
    expect((await read(next)).statusCode).toBe(404);
  });
  it('has narrow definer privileges and no runtime publication DML', async () => {
    const grants = await admin.query(
      "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.public_project_artifact_document(uuid,uuid)'::regprocedure",
    );
    expect(grants.rows[0]).toMatchObject({
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, pg_temp'],
    });
    expect(
      (
        await runtime.query(
          "SELECT has_function_privilege(current_user,'public.public_project_artifact_document(uuid,uuid)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
    await expect(
      runtime.query('UPDATE project_publication_state SET state=state WHERE false'),
    ).rejects.toMatchObject({ code: '42501' });
    for (const table of ['project_publication_state', 'project_publication_revisions']) {
      expect(
        (
          await runtime.query(
            "SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE') allowed",
            [table],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
  });
  it.each(['private', 'unlisted', 'learning'])(
    'does not serve %s publication despite cache',
    async (state) => {
      const f = await fixture();
      expect((await read(f.publication)).statusCode).toBe(200);
      if (state === 'unlisted')
        await admin.query("UPDATE project_publication_state SET state='unlisted' WHERE id=$1", [
          f.publication.publicationId,
        ]);
      else if (state === 'learning')
        await admin.query(
          'INSERT INTO learning_legacy_project_origins(project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at) SELECT id,tenant_id,tenant_id,$2,now() FROM projects WHERE id=$1',
          [f.projectId, randomUUID()],
        );
      else await admin.query("UPDATE projects SET status='archived' WHERE id=$1", [f.projectId]);
      expect((await read(f.publication)).statusCode).toBe(404);
    },
  );
});
