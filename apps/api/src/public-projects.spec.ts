import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import {
  ProjectPublicationController,
  PublicProjectsController,
} from './public-projects.controller.js';
import { SESSION_COOKIE } from './tokens.js';
import { createApiModuleRegistry } from './module-registry.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';
import { GalleryController } from './gallery.controller.js';

const PUBLICATION = '123e4567-e89b-42d3-a456-426614174001';
const REVISION = '123e4567-e89b-42d3-a456-426614174002';
const PROJECT = '123e4567-e89b-42d3-a456-426614174003';
const PRINCIPAL = '123e4567-e89b-42d3-a456-426614174004';
const row = {
  publication_id: PUBLICATION,
  revision_id: REVISION,
  revision_no: 3,
  version_no: 2,
  title: 'Светофор',
  summary: 'Версия для показа',
  description: 'Версия для показа',
  tags: ['электроника'],
  license: 'reserved',
  module_key: 'electronics',
  author_label: 'Автор проекта',
  published_at: new Date('2026-10-18T12:00:00Z'),
  preview_content_type: 'image/png',
  preview_width: 640,
  preview_height: 360,
};
const ownerStatus = {
  publication: {
    publicationId: PUBLICATION,
    revisionId: REVISION,
    revisionNo: 3,
    versionNo: 2,
    state: 'public',
    publishedAt: '2026-10-18T12:00:00Z',
    publicPath: '#/public-projects/' + PUBLICATION,
  },
  canPublish: true,
  reasonCode: null,
};

function request(cookies: Record<string, string> = {}): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

function setup(rows: unknown[] = [], signedIn = true, copyDocuments: unknown[] = []) {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('public_project_copy_documents') ? copyDocuments : rows,
  }));
  const resolve = vi.fn(async () =>
    signedIn ? { principalId: PRINCIPAL, accountId: 'private-account' } : null,
  );
  const pool = { query } as unknown as pg.Pool;
  return {
    query,
    resolve,
    publicApi: new PublicProjectsController(
      pool,
      { resolve } as unknown as ActiveContextUseCase,
      createApiModuleRegistry(),
    ),
    owner: new ProjectPublicationController({ resolve } as unknown as ActiveContextUseCase, pool),
  };
}

function reply() {
  const headers = new Map<string, unknown>();
  const value = {
    header: vi.fn((name: string, content: unknown) => {
      headers.set(name.toLowerCase(), content);
      return value;
    }),
    send: vi.fn((body: unknown) => body),
  };
  return { headers, value: value as unknown as FastifyReply };
}

describe('Public Projects anonymous projection', () => {
  it.each(['electronics', 'three-d'])(
    'advertises copy for public-domain %s only',
    async (moduleKey) => {
      const document = createApiModuleRegistry().get(moduleKey)!.provider!.createEmptyProject();
      const publication = { ...row, module_key: moduleKey, license: 'public-domain' };
      const { publicApi } = setup([publication], true, [
        { ...publication, document_json: document },
      ]);
      const result = await publicApi.detail(PUBLICATION);
      expect(result.publication.capabilities).toEqual({
        viewer: 'static',
        canCopy: true,
        downloadFormats: [],
      });
    },
  );
  it.each(['detail', 'list'] as const)(
    'refuses extension-bearing 3D copy admission in %s',
    async (surface) => {
      const document = createApiModuleRegistry().get('three-d')!.provider!.createEmptyProject();
      const publication = { ...row, module_key: 'three-d', license: 'public-domain' };
      const { publicApi } = setup([publication], true, [
        {
          ...publication,
          document_json: { ...(document as object), assetId: 'private-asset' },
        },
      ]);
      const result =
        surface === 'detail'
          ? (await publicApi.detail(PUBLICATION)).publication
          : (await publicApi.list()).items[0];
      expect(result?.capabilities.canCopy).toBe(false);
      expect(JSON.stringify(result)).not.toContain('private-asset');
    },
  );

  it('refuses legacy documents requiring parser normalization', async () => {
    const publication = { ...row, license: 'public-domain' };
    const { publicApi } = setup([publication], true, [
      {
        ...publication,
        document_json: { schemaVersion: 1, components: [], connections: [] },
      },
    ]);
    expect((await publicApi.detail(PUBLICATION)).publication.capabilities.canCopy).toBe(false);
  });

  it('fails closed when the exact document is missing, revoked or superseded between reads', async () => {
    const publication = { ...row, license: 'public-domain' };
    const { publicApi, query } = setup([publication], true, []);
    expect((await publicApi.detail(PUBLICATION)).publication.capabilities.canCopy).toBe(false);
    expect(query).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM public_project_copy_documents($1::uuid[],$2::uuid[])',
      [[PUBLICATION], [REVISION]],
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('public_project_copy_source('),
      expect.anything(),
    );
  });

  it('never substitutes a successor revision returned by a reader', async () => {
    const publication = { ...row, license: 'public-domain' };
    const document = createApiModuleRegistry().get('electronics')!.provider!.createEmptyProject();
    const { publicApi } = setup([publication], true, [
      {
        ...publication,
        revision_id: PROJECT,
        document_json: document,
      },
    ]);
    expect((await publicApi.detail(PUBLICATION)).publication.capabilities.canCopy).toBe(false);
  });

  it('keeps raw documents and private IDs out of a successful copy capability DTO', async () => {
    const publication = { ...row, license: 'public-domain' };
    const document = createApiModuleRegistry().get('electronics')!.provider!.createEmptyProject();
    const { publicApi } = setup([publication], true, [
      {
        ...publication,
        document_json: document,
        source_project_id: 'source-private-id',
        tenant_id: 'source-private-tenant',
      },
    ]);
    const result = await publicApi.detail(PUBLICATION);
    expect(result.publication.capabilities.canCopy).toBe(true);
    for (const secret of [
      'document_json',
      'schemaVersion',
      'source-private-id',
      'source-private-tenant',
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it('batches only the visible page and retains pagination with a supported sentinel', async () => {
    const publications = Array.from({ length: 49 }, (_, index) => ({
      ...row,
      license: 'public-domain',
      publication_id: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
    }));
    const document = createApiModuleRegistry().get('electronics')!.provider!.createEmptyProject();
    const { publicApi, query } = setup(
      publications,
      true,
      publications.slice(0, 48).map((publication) => ({ ...publication, document_json: document })),
    );
    const result = await publicApi.list(undefined, undefined, '0', '48');
    expect(result.items).toHaveLength(48);
    expect(result.nextOffset).toBe(48);
    expect(result.items.every((item) => item.capabilities.canCopy)).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM public_project_copy_documents($1::uuid[],$2::uuid[])',
      [
        publications.slice(0, 48).map((publication) => publication.publication_id),
        Array.from({ length: 48 }, () => REVISION),
      ],
    );
  });

  it('keeps the retired Gallery detail closed even if old storage could return a document', async () => {
    const query = vi.fn(async () => ({ rows: [{ document_json: { privateDraft: 'secret' } }] }));
    const legacy = new GalleryController(
      {
        resolve: async () => ({ principalId: PRINCIPAL, accountId: 'account' }),
      } as unknown as ActiveContextUseCase,
      {} as AccountDirectoryPort,
      { query } as unknown as pg.Pool,
    );
    await expect(legacy.work(request(), PROJECT)).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'not_available' } },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('allows anonymous discovery and drops private fields even if a query row gains them', async () => {
    const { publicApi, resolve, query } = setup([
      {
        ...row,
        project_id: PROJECT,
        tenant_id: 'private-tenant',
        owner_principal_id: PRINCIPAL,
        email: 'private@example.test',
        document_json: { token: 'draft-secret' },
      },
    ]);
    const result = await publicApi.list(' светофор ', 'electronics', '0', '24');
    expect(resolve).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      null,
      'светофор',
      'electronics',
      25,
      0,
    ]);
    expect(result.items[0]).toMatchObject({
      publicationId: PUBLICATION,
      revisionId: REVISION,
      versionNo: 2,
      capabilities: { canCopy: false, viewer: 'static', downloadFormats: [] },
      preview: {
        url: '/api/public-projects/' + PUBLICATION + '/image?revision=' + REVISION,
      },
    });
    const payload = JSON.stringify(result);
    for (const secret of [
      PROJECT,
      PRINCIPAL,
      'private-tenant',
      'private@example.test',
      'draft-secret',
    ]) {
      expect(payload).not.toContain(secret);
    }
  });

  it('uses a bounded extra row for real pagination', async () => {
    const { publicApi } = setup(Array.from({ length: 3 }, () => row));
    expect(await publicApi.list(undefined, undefined, '2', '2')).toMatchObject({
      items: [expect.any(Object), expect.any(Object)],
      nextOffset: 4,
    });
  });

  it.each([
    ['x'.repeat(121), undefined, undefined, undefined],
    [undefined, 'electronics;drop', undefined, undefined],
    [undefined, undefined, '-1', undefined],
    [undefined, undefined, '0;SELECT', undefined],
    [undefined, undefined, undefined, '9999'],
  ])('rejects invalid filters before querying', async (q, module, offset, limit) => {
    const { publicApi, query } = setup();
    await expect(publicApi.list(q, module, offset, limit)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns the same unavailable response for any inaccessible direct publication', async () => {
    const { publicApi, query } = setup();
    await expect(publicApi.detail(PUBLICATION)).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'not_available' } },
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [PUBLICATION, null, null, 1, 0]);
    await expect(publicApi.detail('../projects/private')).rejects.toMatchObject({ status: 400 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('serves only freshly authorized immutable raster bytes and disables caching', async () => {
    const bytes = Buffer.from('frozen-preview');
    const { publicApi, query } = setup([{ image: bytes, content_type: 'image/png' }]);
    const response = reply();
    expect(await publicApi.image(PUBLICATION, REVISION, response.value)).toBe(bytes);
    expect(query).toHaveBeenCalledWith(expect.any(String), [PUBLICATION, REVISION]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('keeps the no-store response when a revoked or superseded image is refused', async () => {
    const { publicApi, query } = setup();
    const response = reply();
    await expect(publicApi.image(PUBLICATION, REVISION, response.value)).rejects.toMatchObject({
      status: 404,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('Public Projects owner commands', () => {
  it('refuses an anonymous mutation without querying the database', async () => {
    const { owner, query } = setup([], false);
    await expect(owner.publish(request(), PROJECT, {})).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses StudentSeat status, publish and revoke regardless of body', async () => {
    const { owner, query } = setup([], false);
    const seat = request({ [STUDENT_SESSION_COOKIE]: 'seat-session' });
    await expect(owner.status(seat, PROJECT)).rejects.toMatchObject({ status: 403 });
    await expect(owner.publish(seat, PROJECT, {})).rejects.toMatchObject({ status: 403 });
    await expect(owner.revoke(seat, PROJECT)).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });

  it('takes the actor only from the existing session and validates metadata', async () => {
    const { owner, query, resolve } = setup([{ result: ownerStatus }]);
    const req = request({ [SESSION_COOKIE]: 'account-session' });
    await expect(owner.publish(req, PROJECT, { tenantId: 'forged-tenant' })).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
    expect(
      await owner.publish(req, PROJECT, {
        title: ' Публикация ',
        description: null,
        tags: ['Робот', 'робот'],
        license: 'cc-by',
      }),
    ).toEqual(ownerStatus);
    expect(resolve).toHaveBeenCalledWith('account-session');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      PRINCIPAL,
      PROJECT,
      JSON.stringify({ title: 'Публикация', description: null, tags: ['робот'], license: 'cc-by' }),
    ]);
  });

  it.each([
    { title: '' },
    { title: 'x'.repeat(256) },
    { description: 'x'.repeat(2001) },
    { tags: [''] },
    { tags: ['x'.repeat(33)] },
    { tags: Array(11).fill('tag') },
    { license: 'invented' },
    { ownerPrincipalId: PRINCIPAL },
  ])('rejects unsupported publication input', async (body) => {
    const { owner, query } = setup();
    await expect(owner.publish(request(), PROJECT, body)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports an inaccessible project as unavailable without leaking owner status', async () => {
    const { owner } = setup([{ result: null }]);
    await expect(owner.status(request(), PROJECT)).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['P5L01', 403, 'learning_work_protected'],
    ['P5P01', 403, 'publication_forbidden'],
    ['P5P02', 409, 'preview_required'],
    ['P5P03', 400, 'validation_error'],
    ['P5P04', 404, 'not_available'],
  ])('maps SQL policy refusals into the agreed API errors', async (code, status, errorCode) => {
    const { owner, query } = setup();
    query.mockRejectedValueOnce({ code });
    await expect(owner.publish(request(), PROJECT, {})).rejects.toMatchObject({
      status,
      response: { error: { code: errorCode } },
    });
  });

  it('acknowledges revoke only after the authorized database operation succeeds', async () => {
    const { owner, query } = setup();
    const revoked = {
      ...ownerStatus,
      publication: { ...ownerStatus.publication, state: 'revoked', publicPath: null },
    };
    query.mockResolvedValueOnce({ rows: [{ ok: true }] });
    query.mockResolvedValueOnce({ rows: [{ result: revoked }] });
    expect(await owner.revoke(request(), PROJECT)).toEqual(revoked);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('project_publication_revoke'),
      [PRINCIPAL, PROJECT],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('project_publication_status'),
      [PRINCIPAL, PROJECT],
    );
  });
});
