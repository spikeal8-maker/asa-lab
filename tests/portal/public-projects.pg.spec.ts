import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import type { CreateProjectInput } from '../../contexts/projects/application/ports';
import type { OwnerPublicationStatus } from '../../apps/api/src/public-projects.controller';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let repo: PgProjectRepository;

beforeAll(() => {
  // These helpers require the same isolated *_test database and different
  // admin/runtime credentials. This suite must never fall back to an emulator.
  admin = testAdminPool();
  runtime = testAppPool();
  repo = new PgProjectRepository(runtime);
});

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
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
      author_label: 'Автор проекта',
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

  it('freezes only a public profile label and never uses a private display name or login fallback', async () => {
    const source = await fixture('safe-label');
    await admin.query(
      "UPDATE profiles SET display_name=$2,visibility='private' WHERE account_id=$1",
      [source.accountId, source.teacher.email],
    );
    const first = await publish(source);
    expect((await publicRead(first.publicationId)).rows[0].author_label).toBe('Автор проекта');
    await admin.query(
      "UPDATE profiles SET display_name='Public maker',visibility='public' WHERE account_id=$1",
      [source.accountId],
    );
    expect((await publicRead(first.publicationId)).rows[0].author_label).toBe('Автор проекта');
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
         has_function_privilege('asalab_app','public.project_publication_policy_reason(uuid)','EXECUTE') AS policy_execute,
         has_function_privilege('asalab_app','public.project_publication_readable(uuid)','EXECUTE') AS readable_execute,
         has_function_privilege('asalab_app','public.gallery_publish_unprotected(uuid,uuid)','EXECUTE') AS unprotected_execute`,
    );
    expect(privileges.rows[0]).toEqual({
      state_read: false,
      revision_read: false,
      policy_execute: false,
      readable_execute: false,
      unprotected_execute: false,
    });
    await expect(
      runtime.query('SELECT * FROM project_publication_revisions'),
    ).rejects.toMatchObject({ code: '42501' });
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
