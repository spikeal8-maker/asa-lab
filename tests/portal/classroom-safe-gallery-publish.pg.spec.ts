import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { PublicProjectsController } from '../../apps/api/src/public-projects.controller.js';
import { GalleryController } from '../../apps/api/src/gallery.controller.js';
import { TOKENS, SESSION_COOKIE } from '../../apps/api/src/tokens.js';
import { createApiModuleRegistry } from '../../apps/api/src/module-registry.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { studentProjectPolicyFixture } from './student-project-policy-fixture';
import { buildTestApp, inject } from './app';
import { STUDENT_SESSION_COOKIE } from '../../apps/api/src/seat-context.js';

// All writes are confined to disposable *_test PostgreSQL databases by helpers.
// This is the real database publication path, not a mocked gallery controller.
let admin: pg.Pool;
let runtime: pg.Pool;

beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});

afterAll(async () => {
  await Promise.all([admin?.end(), runtime?.end()]);
});

async function prepare() {
  const teacher = await seedTeacher(admin, `classroom-gallery-safe-${randomUUID().slice(0, 8)}`);
  const link = await admin.query(
    'SELECT account_id, principal_id FROM legacy_user_account_links WHERE user_id=$1',
    [teacher.teacherId],
  );
  const teacherAccount = link.rows[0].account_id as string;
  const teacherPrincipal = link.rows[0].principal_id as string;
  const classroomId = randomUUID();

  await admin.query(
    `INSERT INTO classrooms
       (id,tenant_id,school_id,academic_period_id,title,created_by)
     VALUES($1,$2,$3,$4,'Безопасная публикация',$5)`,
    [classroomId, teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES($1,$2,$3,$4,'owner')`,
    [teacher.tenantId, classroomId, teacher.teacherId, teacherAccount],
  );
  const seat = await admin.query(`SELECT id FROM classroom_management_add_seat($1,$2,$3,$4,true)`, [
    teacherAccount,
    classroomId,
    'Ученик защищённого класса',
    randomUUID().slice(0, 8),
  ]);
  const seatId = seat.rows[0].id as string;
  await admin.query("UPDATE classroom_student_seats SET status='active' WHERE id=$1", [seatId]);
  const prepared = await runtime.query(
    'SELECT classroom_participant_prepare($1,$2::uuid[]) AS ready',
    [teacherPrincipal, [classroomId]],
  );
  expect(prepared.rows[0].ready).toBe(true);
  await admin.query(
    'INSERT INTO classroom_project_policies(classroom_id,tenant_id,publish,download) VALUES($1,$2,true,false) ON CONFLICT(classroom_id) DO UPDATE SET publish=true',
    [classroomId, teacher.tenantId],
  );

  const principal = await admin.query('SELECT id FROM principals WHERE seat_id=$1', [seatId]);
  const seatPrincipal = principal.rows[0].id as string;

  async function project(ownerPrincipal: string, projectClassId: string | null) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO projects
         (id,tenant_id,classroom_id,project_scope,module_key,title,status,owner_principal_id)
       VALUES($1,$2,$3,$4,'three-d','Проект с проверкой защиты','active',$5)`,
      [
        id,
        teacher.tenantId,
        projectClassId,
        projectClassId === null ? 'personal' : 'classroom',
        ownerPrincipal,
      ],
    );
    await admin.query(
      `INSERT INTO project_drafts
         (project_id,tenant_id,document_json,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[],"connections":[]}'::jsonb,$3)`,
      [id, teacher.tenantId, ownerPrincipal],
    );
    await admin.query(
      `INSERT INTO project_snapshots
         (project_id,tenant_id,image,content_type,width,height,source_revision,captured_by_principal_id)
       VALUES($1,$2,$3,'image/png',16,16,1,$4)`,
      [id, teacher.tenantId, Buffer.alloc(64), ownerPrincipal],
    );
    return id;
  }

  return { teacher, teacherAccount, teacherPrincipal, classroomId, seatId, seatPrincipal, project };
}

describe('Safe Mode refuses new external classroom publications on real PostgreSQL', () => {
  it('blocks publication until both class and Seat protections are off', async () => {
    const f = await prepare();
    const projectId = await f.project(f.seatPrincipal, null);

    // Distribution is authorized, yet the Safe Mode persistence guard denies
    // the canonical writer while either protection layer is enabled.
    await expect(
      admin.query(
        "SELECT public.project_publication_publish_admitted($1,$2,'{}'::jsonb) AS publication",
        [f.seatPrincipal, projectId],
      ),
    ).rejects.toMatchObject({ code: 'P5S01' });
    const firstCounts = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM project_publication_state WHERE project_id=$1) AS state_count,
         (SELECT count(*)::int FROM project_publications WHERE project_id=$1) AS gallery_count,
         (SELECT count(*)::int FROM project_versions WHERE project_id=$1) AS versions`,
      [projectId],
    );
    expect(firstCounts.rows[0]).toMatchObject({
      state_count: 0,
      gallery_count: 0,
      versions: 0,
    });

    // Individual protection cannot be overridden by disabling only the class default.
    await admin.query('UPDATE classrooms SET safe_mode_default=false WHERE id=$1', [f.classroomId]);
    await expect(
      admin.query(
        "SELECT public.project_publication_publish_admitted($1,$2,'{}'::jsonb) AS publication",
        [f.seatPrincipal, projectId],
      ),
    ).rejects.toMatchObject({ code: 'P5S01' });

    await admin.query('UPDATE classroom_student_seats SET safe_mode=false WHERE id=$1', [f.seatId]);
    const published = await admin.query(
      "SELECT public.project_publication_publish_admitted($1,$2,'{}'::jsonb) AS result",
      [f.seatPrincipal, projectId],
    );
    expect(published.rows[0].result?.publication?.publicationId).toBeTruthy();

    const state = await admin.query(
      `SELECT
         (SELECT count(*)::int FROM project_publication_state WHERE project_id=$1) AS state_count,
         (SELECT count(*)::int FROM project_publications WHERE project_id=$1) AS gallery_count,
         (SELECT count(*)::int FROM project_publication_revisions WHERE project_id=$1) AS revisions`,
      [projectId],
    );
    expect(state.rows[0]).toMatchObject({ state_count: 1, gallery_count: 1, revisions: 1 });

    // Taking an already published item down must remain possible after protection
    // is switched on. Old published links must already be shielded at the read boundary.
    await admin.query('UPDATE classrooms SET safe_mode_default=true WHERE id=$1', [f.classroomId]);
    const removed = await runtime.query('SELECT gallery_unpublish($1,$2) AS ok', [
      f.seatPrincipal,
      projectId,
    ]);
    expect(removed.rows[0].ok).toBe(true);
    const afterRemove = await admin.query(
      'SELECT count(*)::int AS count FROM project_publications WHERE project_id=$1',
      [projectId],
    );
    expect(afterRemove.rows[0].count).toBe(0);
    await expect(
      admin.query(
        "SELECT public.project_publication_publish_admitted($1,$2,'{}'::jsonb) AS publication",
        [f.seatPrincipal, projectId],
      ),
    ).rejects.toMatchObject({ code: 'P5S01' });

    // The legacy projection is guarded too; a direct insert cannot bypass
    // gallery_publish() and expose protected content to the public shelf.
    await expect(
      admin.query(
        `INSERT INTO project_publications
           (project_id,tenant_id,owner_principal_id,published_by_principal_id,
            title,module_key,author_label,snapshot_revision)
         VALUES($1,$2,$3,$4,'Обход','three-d','Ученик',1)`,
        [projectId, f.teacher.tenantId, f.seatPrincipal, f.teacherPrincipal],
      ),
    ).rejects.toMatchObject({ code: 'P5S01' });
  });

  it('keeps unrelated personal Account work publishable while a class is protected', async () => {
    const f = await prepare();
    const teacherPersonal = await f.project(f.teacherPrincipal, null);
    const published = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      f.teacherPrincipal,
      teacherPersonal,
    ]);
    expect(published.rows[0].ok).toBe(true);
    expect(
      (
        await runtime.query('SELECT 1 FROM project_publications WHERE project_id=$1', [
          teacherPersonal,
        ])
      ).rowCount,
    ).toBe(1);

    const scoped = await f.project(f.teacherPrincipal, f.classroomId);
    await expect(
      runtime.query('SELECT gallery_publish($1,$2) AS ok', [f.teacherPrincipal, scoped]),
    ).rejects.toMatchObject({ code: 'P5P01' });
    await expect(
      admin.query(
        "INSERT INTO project_publication_state(id,project_id,tenant_id,owner_principal_id,state) VALUES(gen_random_uuid(),$1,$2,$3,'public')",
        [scoped, f.teacher.tenantId, f.teacherPrincipal],
      ),
    ).rejects.toMatchObject({ code: 'P5S01' });
  });
});

describe('Safe Mode retroactively blocks public reads and retains withdrawal authority', () => {
  it('hides an already public Seat work across SQL and real HTTP, including after OFF', async () => {
    const f = await prepare();
    await admin.query('UPDATE classrooms SET safe_mode_default=false WHERE id=$1', [f.classroomId]);
    await admin.query('UPDATE classroom_student_seats SET safe_mode=false WHERE id=$1', [f.seatId]);
    const projectId = await f.project(f.seatPrincipal, null);
    expect(
      (
        await admin.query(
          "SELECT public.project_publication_publish_admitted($1,$2,'{}'::jsonb) AS result",
          [f.seatPrincipal, projectId],
        )
      ).rows[0].result?.publication?.publicationId !== undefined,
    ).toBe(true);

    const publication = (
      await admin.query(
        'SELECT id, current_revision_id FROM project_publication_state WHERE project_id=$1',
        [projectId],
      )
    ).rows[0] as { id: string; current_revision_id: string };
    const revisionId = publication.current_revision_id;
    const publicId = publication.id;

    const visible = () =>
      admin.query('SELECT project_publication_readable($1) AS allowed', [publicId]);
    const publicList = () =>
      runtime.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [publicId]);
    const publicImage = () =>
      runtime.query('SELECT * FROM public_project_image($1,$2)', [publicId, revisionId]);
    const publicArtifact = () =>
      runtime.query('SELECT * FROM public_project_artifact_document($1,$2)', [
        publicId,
        revisionId,
      ]);
    const legacyImage = () => runtime.query('SELECT * FROM gallery_snapshot($1)', [projectId]);
    const legacyRows = () =>
      runtime.query('SELECT count(*)::int AS count FROM project_publications WHERE project_id=$1', [
        projectId,
      ]);

    expect((await visible()).rows[0].allowed).toBe(true);
    expect((await publicList()).rowCount).toBe(1);
    expect((await publicImage()).rowCount).toBe(1);
    expect((await publicArtifact()).rowCount).toBe(1);
    expect((await legacyImage()).rowCount).toBe(1);
    expect((await legacyRows()).rows[0].count).toBe(1);

    @Module({})
    class PublicHttpTestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(
      {
        module: PublicHttpTestModule,
        controllers: [PublicProjectsController, GalleryController],
        providers: [
          { provide: TOKENS.pool, useValue: runtime },
          { provide: TOKENS.moduleRegistry, useValue: createApiModuleRegistry() },
          { provide: TOKENS.accountDirectory, useValue: {} },
          {
            provide: TOKENS.activeContextUseCase,
            useValue: {
              resolve: async (token: string | undefined) =>
                token === 'safe-http-session'
                  ? { principalId: f.teacherPrincipal, accountId: f.teacherAccount }
                  : null,
            },
          },
          { provide: TOKENS.seatContextUseCase, useValue: { resolveExisting: async () => null } },
        ],
      },
      new FastifyAdapter(),
      { logger: false },
    );
    try {
      await app.register(cookie);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      const route = '/api/public-projects/' + publicId;
      expect((await app.inject({ method: 'GET', url: route })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: 'GET', url: route + '/image?revision=' + revisionId }))
          .statusCode,
      ).toBe(200);

      await admin.query('UPDATE classrooms SET safe_mode_default=true WHERE id=$1', [
        f.classroomId,
      ]);
      expect((await visible()).rows[0].allowed).toBe(false);
      expect((await publicList()).rowCount).toBe(0);
      expect((await publicImage()).rowCount).toBe(0);
      expect((await publicArtifact()).rowCount).toBe(0);
      expect((await legacyImage()).rowCount).toBe(0);
      expect((await legacyRows()).rows[0].count).toBe(0);
      expect((await app.inject({ method: 'GET', url: route })).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: route + '/image?revision=' + revisionId }))
          .statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: route + '/artifact?revisionId=' + revisionId }))
          .statusCode,
      ).toBe(404);
      const catalog = (await app.inject({ method: 'GET', url: '/api/public-projects' })).json();
      expect(
        catalog.items.some((entry: { publicationId: string }) => entry.publicationId === publicId),
      ).toBe(false);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/gallery/' + projectId + '/image',
            headers: { cookie: SESSION_COOKIE + '=safe-http-session' },
          })
        ).statusCode,
      ).toBe(404);

      const revocation = await admin.query(
        'SELECT count(*)::integer AS count FROM classroom_gallery_safe_mode_revocations WHERE publication_id=$1',
        [publicId],
      );
      expect(revocation.rows[0].count).toBe(1);
      expect(
        (
          await admin.query(
            'SELECT state, current_revision_id FROM project_publication_state WHERE id=$1',
            [publicId],
          )
        ).rows[0],
      ).toEqual({ state: 'public', current_revision_id: revisionId });

      await admin.query('UPDATE classrooms SET safe_mode_default=false WHERE id=$1', [
        f.classroomId,
      ]);
      expect((await visible()).rows[0].allowed).toBe(false);
      expect((await legacyRows()).rows[0].count).toBe(0);
      expect((await app.inject({ method: 'GET', url: route })).statusCode).toBe(404);
      await expect(
        admin.query("UPDATE project_publication_state SET state='public' WHERE id=$1", [publicId]),
      ).rejects.toMatchObject({ code: 'P5S01' });
      await expect(
        admin.query("UPDATE project_publications SET visibility='public' WHERE project_id=$1", [
          projectId,
        ]),
      ).rejects.toMatchObject({ code: 'P5S01' });
      expect(
        (
          await runtime.query(
            'SELECT * FROM public_project_copy_documents(ARRAY[$1]::uuid[],ARRAY[$2]::uuid[])',
            [publicId, revisionId],
          )
        ).rowCount,
      ).toBe(0);

      expect(
        (await runtime.query('SELECT gallery_unpublish($1,$2) AS ok', [f.seatPrincipal, projectId]))
          .rows[0].ok,
      ).toBe(true);
      expect((await publicList()).rowCount).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('Safe Mode native Seat HTTP publication boundary', () => {
  it('returns 403 classroom_safe_mode and creates no partial publication after policy allows publishing', async () => {
    const f = await studentProjectPolicyFixture(admin, runtime);
    expect(await f.write({ publish: true, download: false, expectedVersion: 0 })).toMatchObject({
      version: 1,
    });
    await admin.query('UPDATE classroom_student_seats SET safe_mode=true WHERE id=$1', [f.seatId]);

    // This app owns its pool and closes it on app.close; shared fixture pool stays open.
    const app = await buildTestApp(testAppPool());
    try {
      const response = await inject(app, {
        method: 'POST',
        url: '/api/projects/' + f.projectId + '/publication',
        payload: {},
        cookies: { [STUDENT_SESSION_COOKIE]: f.token },
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: 'classroom_safe_mode' },
      });
      const counts = await admin.query(
        'SELECT (SELECT count(*)::integer FROM project_publication_state WHERE project_id=$1) AS states, (SELECT count(*)::integer FROM project_publications WHERE project_id=$1) AS legacy, (SELECT count(*)::integer FROM project_publication_revisions WHERE project_id=$1) AS revisions',
        [f.projectId],
      );
      expect(counts.rows[0]).toEqual({
        states: 0,
        legacy: 0,
        revisions: 0,
      });
    } finally {
      await app.close();
    }
  });
});
