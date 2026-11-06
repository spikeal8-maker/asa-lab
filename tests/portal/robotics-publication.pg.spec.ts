import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createInitialRoboticsProject, type RoboticsProject } from '@asa-lab/robotics/document';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import type { OwnerPublicationStatus } from '../../apps/api/src/public-projects.controller';
import { buildTestApp, inject, type NestApp } from './app';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';

let admin: pg.Pool;
let runtime: pg.Pool;
let repo: PgProjectRepository;
let app: NestApp;
let baseUrl: string;
const projectIds: string[] = [];
// Valid synthetic raster for publication setup; browser screenshots are separate evidence.
const preview = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQCu34TwlmGDVg1IBRA4aLAQDLpv4Q+i0QiwAAAABJRU5ErkJggg==',
  'base64',
);
type Publication = NonNullable<OwnerPublicationStatus['publication']>;

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  const role = await runtime.query(
    'SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
  );
  expect(role.rows).toEqual([{ name: 'asalab_app', rolsuper: false, rolbypassrls: false }]);
  repo = new PgProjectRepository(runtime);
  app = await buildTestApp(runtime);
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});
afterAll(async () => {
  try {
    if (admin && projectIds.length)
      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=COALESCE(revoked_at,now()) WHERE project_id=ANY($1::uuid[])",
        [projectIds],
      );
  } finally {
    await app?.close();
    await admin?.end();
  }
});

function source(): RoboticsProject {
  const initial = createInitialRoboticsProject();
  return {
    ...initial,
    circuit: {
      ...initial.circuit,
      components: initial.circuit.components.map((component) =>
        component.id === initial.world.bindings.boardId
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                arduinoSource: '// PRIVATE_PROGRAM\nvoid setup(){}void loop(){}',
                arduinoWorkspace: JSON.stringify({ privateEditorLabel: 'PRIVATE_BLOCKS' }),
              },
            }
          : component,
      ),
    },
  };
}
async function account() {
  const teacher = await seedTeacher(admin, `robotics-public-${randomUUID().slice(0, 8)}`);
  const identity = await admin.query(
    'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  const principalId = identity.rows[0].principal_id as string;
  const login = await inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
  });
  expect(login.statusCode, login.body).toBe(200);
  const token = login.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  if (!token) throw Error('Account session missing');
  return {
    teacher,
    actor: { principalId, userId: teacher.teacherId },
    cookies: { asa_session: token },
  };
}
async function createProject(
  tenantId: string,
  actor: { principalId: string; userId: string | null },
) {
  const title = `robot-${randomUUID()}`;
  const document = source();
  const created = await repo.createWithDraft({
    tenantId,
    actor,
    moduleKey: 'robotics',
    scope: 'personal',
    classroomId: null,
    title,
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
    initialDocument: document,
    initialPreview: null,
  });
  if (created.kind !== 'created') throw Error('Robotics project fixture was not created');
  const projectId = created.project.id;
  projectIds.push(projectId);
  async function snapshot(sourceRevision: number) {
    expect(
      await repo.saveSnapshot({
        tenantId,
        actor,
        projectId,
        sourceRevision,
        image: { bytes: preview, contentType: 'image/png', width: 16, height: 16 },
      }),
    ).not.toBeNull();
  }
  await snapshot(1);
  return { projectId, title, document, snapshot };
}
async function fixture() {
  const owner = await account();
  return { owner, ...(await createProject(owner.teacher.tenantId, owner.actor)) };
}
async function publish(projectId: string, cookies: Record<string, string>, title: string) {
  const response = await inject(app, {
    method: 'POST',
    url: `/api/projects/${projectId}/publication`,
    cookies,
    payload: { title, license: 'public-domain', tags: ['robotics'] },
  });
  expect(response.statusCode, response.body).toBe(200);
  const publication = response.json<OwnerPublicationStatus>().publication;
  if (!publication) throw Error('Publication receipt missing');
  return publication;
}
async function read(publication: Publication, cookies: Record<string, string> = {}) {
  const response = await fetch(
    `${baseUrl}/api/public-projects/${publication.publicationId}/artifact?revisionId=${publication.revisionId}`,
    {
      headers: {
        'if-none-match': '*',
        cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join(';'),
      },
    },
  );
  const body = await response.text();
  return { status: response.status, headers: response.headers, body, json: () => JSON.parse(body) };
}
async function catalog(title: string) {
  const response = await fetch(
    `${baseUrl}/api/public-projects?catalog=projects&module=robotics&q=${encodeURIComponent(title)}&sort=newest`,
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<{ items: Array<{ publicationId: string; moduleKey: string }> }>;
}

describe('Robotics immutable publication on real HTTP and restricted PostgreSQL', () => {
  it('lists the exact revision, serves its frozen preview to another account, hides private source and denies copy', async () => {
    const f = await fixture();
    const reader = await account();
    const publication = await publish(f.projectId, f.owner.cookies, f.title);
    expect((await catalog(f.title)).items).toEqual([
      expect.objectContaining({ publicationId: publication.publicationId, moduleKey: 'robotics' }),
    ]);
    const detail = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${publication.publicationId}`,
      cookies: reader.cookies,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().publication).toMatchObject({
      title: f.title,
      moduleKey: 'robotics',
      capabilities: { canCopy: false, downloadFormats: [] },
      preview: { contentType: 'image/png', width: 16, height: 16 },
    });
    const image = await fetch(baseUrl + detail.json().publication.preview.url);
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(preview);
    const before = await admin.query(
      'SELECT to_jsonb(d) value FROM project_drafts d WHERE project_id=$1',
      [f.projectId],
    );
    const guest = await read(publication);
    const other = await read(publication, reader.cookies);
    expect(other.status, other.body).toBe(200);
    expect(other.headers.get('cache-control')).toBe('no-store');
    expect(other.json()).toEqual(guest.json());
    expect(other.json().artifact).toMatchObject({
      schemaVersion: 5,
      viewerFamily: 'robotics',
      provenance: {
        publicationId: publication.publicationId,
        revisionNumber: publication.revisionNo,
      },
      capabilities: { readOnly: true, interactive: true, download: false },
      world: { field: { widthMeters: f.document.world.field.widthMeters } },
    });
    expect(other.body).not.toMatch(
      /PRIVATE|arduino|circuit|bindings|physicsProfile|massKg|friction|restitution|runtime|tenant|principal|ownerId/,
    );
    expect(other.body).not.toContain(f.projectId);
    expect(
      (
        await admin.query('SELECT to_jsonb(d) value FROM project_drafts d WHERE project_id=$1', [
          f.projectId,
        ])
      ).rows,
    ).toEqual(before.rows);
    const privateProject = await inject(app, {
      method: 'GET',
      url: `/api/projects/${f.projectId}`,
      cookies: reader.cookies,
    });
    expect([403, 404]).toContain(privateProject.statusCode);
    const privateEditor = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${publication.publicationId}/editor`,
      cookies: reader.cookies,
    });
    expect(privateEditor.json()).toEqual({ editor: null });
    const copied = await inject(app, {
      method: 'POST',
      url: `/api/public-projects/${publication.publicationId}/copy`,
      cookies: reader.cookies,
      headers: { 'idempotency-key': randomUUID() },
      payload: { revisionId: publication.revisionId },
    });
    expect(copied.statusCode, copied.body).toBe(403);

    const saved = await inject(app, {
      method: 'PUT',
      url: `/api/projects/${f.projectId}/draft`,
      cookies: f.owner.cookies,
      payload: {
        baseRevision: 1,
        mutationId: randomUUID(),
        document: {
          ...f.document,
          world: { ...f.document.world, field: { ...f.document.world.field, gridMeters: 0.2 } },
        },
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await read(publication, reader.cookies)).json()).toEqual(other.json());
    await f.snapshot(saved.json().draft.revision);
    const next = await publish(f.projectId, f.owner.cookies, f.title);
    expect(next.revisionId).not.toBe(publication.revisionId);
    expect((await read(publication)).status).toBe(404);
    expect((await read(next)).json().artifact.world.field.gridMeters).toBe(0.2);
    const revoked = await inject(app, {
      method: 'DELETE',
      url: `/api/projects/${f.projectId}/publication`,
      cookies: f.owner.cookies,
    });
    expect(revoked.statusCode).toBe(200);
    expect((await read(next)).status).toBe(404);
    expect((await catalog(f.title)).items).toEqual([]);
  });

  it.each(['hidden', 'learning'] as const)(
    'reauthorizes cached Robotics artifacts when %s',
    async (restriction) => {
      const f = await fixture();
      const publication = await publish(f.projectId, f.owner.cookies, f.title);
      expect((await read(publication)).status).toBe(200);
      if (restriction === 'hidden') {
        await admin.query(
          'INSERT INTO project_publication_moderation(publication_id,hidden,reason,actor_principal_id) VALUES($1,true,$2,$3)',
          [publication.publicationId, 'Synthetic test moderation', f.owner.actor.principalId],
        );
      } else {
        await admin.query(
          'INSERT INTO learning_legacy_project_origins(project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at) SELECT id,tenant_id,tenant_id,$2,now() FROM projects WHERE id=$1',
          [f.projectId, randomUUID()],
        );
        const forbidden = await inject(app, {
          method: 'POST',
          url: `/api/projects/${f.projectId}/publication`,
          cookies: f.owner.cookies,
          payload: {},
        });
        expect(forbidden.statusCode).toBe(403);
        expect(forbidden.json().error.code).toBe('learning_work_protected');
      }
      expect((await read(publication)).status).toBe(404);
      expect((await catalog(f.title)).items).toEqual([]);
    },
  );

  it('preserves default-off StudentSeat publication, independent download policy and published-read continuity', async () => {
    const seat = await studentProjectPolicyFixture(admin, runtime);
    const f = await createProject(seat.teacher.tenantId, {
      principalId: seat.principal,
      userId: null,
    });
    const cookies = { asa_student_session: seat.token };
    expect(await seat.read()).toMatchObject({ publish: false, download: false, version: 0 });
    const denied = await inject(app, {
      method: 'POST',
      url: `/api/projects/${f.projectId}/publication`,
      cookies,
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('publication_forbidden');
    expect(await seat.write({ publish: true, download: false, expectedVersion: 0 })).toMatchObject({
      version: 1,
    });
    const publication = await publish(f.projectId, cookies, f.title);
    const frozen = await read(publication);
    expect(frozen.status, frozen.body).toBe(200);
    expect(frozen.json().artifact.schemaVersion).toBe(5);
    const detail = await inject(app, {
      method: 'GET',
      url: `/api/public-projects/${publication.publicationId}`,
    });
    expect(detail.json().publication.authorLabel).toBe('Автор проекта');
    expect(detail.json().publication.capabilities).toMatchObject({
      canCopy: false,
      downloadFormats: [],
    });
    await seat.write({ publish: false, download: false, expectedVersion: 1 });
    expect(await seat.read()).toMatchObject({ publish: false, download: false, version: 2 });
    const republish = await inject(app, {
      method: 'POST',
      url: `/api/projects/${f.projectId}/publication`,
      cookies,
      payload: {},
    });
    expect(republish.statusCode).toBe(403);
    expect((await read(publication)).json()).toEqual(frozen.json());
    const revoke = await inject(app, {
      method: 'DELETE',
      url: `/api/projects/${f.projectId}/publication`,
      cookies,
    });
    expect(revoke.statusCode).toBe(200);
    expect((await read(publication)).status).toBe(404);
  });
});
