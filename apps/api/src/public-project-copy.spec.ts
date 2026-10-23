import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { PgProjectRepository, type Project } from '@asa-lab/projects';
import { createApiModuleRegistry } from './module-registry.js';
import { PublicProjectsController } from './public-projects.controller.js';
import {
  copyPublicProject,
  publicProjectCopySupported,
  validatePublicCopyDocument,
} from './public-project-copy.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';

const PUBLICATION = '123e4567-e89b-42d3-a456-426614174001';
const REVISION = '123e4567-e89b-42d3-a456-426614174002';
const registry = createApiModuleRegistry();
const electronics = registry.get('electronics')!.provider!.createEmptyProject();
const source = {
  destination_tenant_id: 'personal-tenant',
  destination_user_id: null,
  source_project_id: 'private-source-project',
  publication_id: PUBLICATION,
  revision_id: REVISION,
  version_id: 'exact-version',
  module_key: 'electronics',
  title: 'Published V1',
  author_label: 'Author',
  license: 'public-domain',
  document_json: electronics,
};
function transaction() {
  const query = vi.fn(async (_sql: string, _args?: unknown[]) => {
    void _sql;
    void _args;
    return { rows: [source] };
  });
  const release = vi.fn();
  const client = { query, release };
  const connect = vi.fn(async () => client);
  return { query, release, pool: { connect } as unknown as pg.Pool };
}
function command(pool: pg.Pool) {
  return {
    pool,
    registry,
    principalId: 'actor',
    publicationId: PUBLICATION,
    revisionId: REVISION,
    idempotencyKey: 'copy-one',
  };
}
function api() {
  const resolve = vi.fn(async () => ({ principalId: 'actor' }));
  const pool = { connect: vi.fn(), query: vi.fn() };
  return {
    resolve,
    pool,
    controller: new PublicProjectsController(
      pool as unknown as pg.Pool,
      { resolve } as unknown as ActiveContextUseCase,
      registry,
    ),
  };
}
function request(cookies: Record<string, string> = {}) {
  return { cookies } as unknown as FastifyRequest;
}
afterEach(() => vi.restoreAllMocks());

describe('exact public copy transaction', () => {
  it.each(['created', 'existing'] as const)(
    'returns an allowlisted %s receipt and retains exact source',
    async (kind) => {
      const { query, release, pool } = transaction();
      const writer = vi.spyOn(PgProjectRepository.prototype, 'createWithDraft').mockResolvedValue({
        kind,
        project: { id: 'new-private-id', moduleKey: 'electronics' } as Project,
      });
      const result = await copyPublicProject(command(pool));
      expect(result).toEqual({
        projectId: 'new-private-id',
        moduleKey: 'electronics',
        created: kind === 'created',
      });
      expect(writer).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'personal-tenant',
          scope: 'personal',
          classroomId: null,
          actor: { principalId: 'actor', userId: null },
          initialDocument: electronics,
          publicationCopyOrigin: {
            projectId: 'private-source-project',
            publicationId: PUBLICATION,
            revisionId: REVISION,
            versionId: 'exact-version',
            title: 'Published V1',
            author: 'Author',
            license: 'public-domain',
          },
        }),
      );
      expect(query.mock.calls.map(([sql]) => sql)).toEqual([
        'BEGIN',
        'SELECT * FROM public_project_copy_source($1,$2,$3)',
        'COMMIT',
      ]);
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it('rolls back the whole transaction on conflicting key', async () => {
    const { pool, query, release } = transaction();
    vi.spyOn(PgProjectRepository.prototype, 'createWithDraft').mockResolvedValue({
      kind: 'conflict',
    });
    await expect(copyPublicProject(command(pool))).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('binds the fingerprint to actor, publication, revision and effective title', async () => {
    const { pool } = transaction();
    const writer = vi.spyOn(PgProjectRepository.prototype, 'createWithDraft').mockResolvedValue({
      kind: 'created',
      project: { id: 'new', moduleKey: 'electronics' } as Project,
    });
    await copyPublicProject(command(pool));
    await copyPublicProject({ ...command(pool), title: 'Published V1' });
    await copyPublicProject({ ...command(pool), principalId: 'other-actor' });
    await copyPublicProject({ ...command(pool), title: 'Different' });
    const fingerprints = writer.mock.calls.map(([input]) => input.requestFingerprint);
    expect(fingerprints[0]).toBe(fingerprints[1]);
    expect(new Set(fingerprints).size).toBe(3);
  });

  it('never calls the Project writer after revoked/stale source fails', async () => {
    const { pool, query } = transaction();
    const error = { code: 'P5C02' };
    query.mockImplementation(async (sql) => {
      if (sql.includes('public_project_copy_source')) throw error;
      return { rows: [source] };
    });
    const writer = vi.spyOn(PgProjectRepository.prototype, 'createWithDraft');
    await expect(copyPublicProject(command(pool))).rejects.toBe(error);
    expect(writer).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});

describe('portable document admission', () => {
  it('advertises only public-domain portable modules', () => {
    for (const module of ['electronics', 'three-d']) {
      expect(publicProjectCopySupported(module, 'public-domain')).toBe(true);
      for (const license of ['reserved', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'unknown']) {
        expect(publicProjectCopySupported(module, license)).toBe(false);
      }
    }
    for (const module of ['blocks', 'scratch', 'chess', 'checkers', 'unknown']) {
      expect(publicProjectCopySupported(module, 'public-domain')).toBe(false);
    }
  });
  it.each(['electronics', 'three-d'])(
    'accepts canonical inline %s documents exactly',
    (moduleKey) => {
      const document = registry.get(moduleKey)!.provider!.createEmptyProject();
      expect(validatePublicCopyDocument(registry, moduleKey, document).document).toBe(document);
    },
  );
  it('fails closed for unsupported modules and unknown asset extensions', () => {
    expect(() => validatePublicCopyDocument(registry, 'blocks', {})).toThrow();
    expect(() =>
      validatePublicCopyDocument(registry, 'electronics', {
        ...(electronics as object),
        assetId: 'private',
      }),
    ).toThrow();
    const threeD = registry.get('three-d')!.provider!.createEmptyProject();
    expect(() =>
      validatePublicCopyDocument(registry, 'three-d', {
        ...(threeD as object),
        assetId: 'private',
      }),
    ).toThrow();
  });
});

describe('copy HTTP boundary', () => {
  it.each([
    ['P5C02', 409, 'publication_changed'],
    ['P5P04', 404, 'not_available'],
    ['P5C01', 403, 'copy_forbidden'],
  ] as const)(
    'maps source denial %s without exposing SQL details',
    async (code, status, errorCode) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('public_project_copy_source')) throw { code, detail: 'private-source' };
        return { rows: [] };
      });
      const release = vi.fn();
      const pool = { connect: async () => ({ query, release }) } as unknown as pg.Pool;
      const controller = new PublicProjectsController(
        pool,
        {
          resolve: async () => ({ principalId: 'actor' }),
        } as unknown as ActiveContextUseCase,
        registry,
      );
      await expect(
        controller.copy(request(), PUBLICATION, 'key', { revisionId: REVISION }),
      ).rejects.toMatchObject({ status, response: { error: { code: errorCode } } });
      expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
      expect(release).toHaveBeenCalledOnce();
    },
  );
  it.each(['valid-seat', ''])(
    'rejects mixed cookies including an empty Seat selector',
    async (seat) => {
      const { controller, resolve, pool } = api();
      await expect(
        controller.copy(
          request({ asa_session: 'account', [STUDENT_SESSION_COOKIE]: seat }),
          PUBLICATION,
          'copy-key',
          { revisionId: REVISION },
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(resolve).not.toHaveBeenCalled();
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );
  it('requires an Account session', async () => {
    const { controller, resolve } = api();
    resolve.mockResolvedValue(null as never);
    await expect(
      controller.copy(request(), PUBLICATION, 'key', { revisionId: REVISION }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it.each([
    [undefined, { revisionId: REVISION }],
    ['learning:reserved', { revisionId: REVISION }],
    ['key', {}],
    ['key', { revisionId: 'invalid' }],
    ['key', { revisionId: REVISION, title: '' }],
    ['key', { revisionId: REVISION, ownerId: 'client-owner' }],
  ])('rejects invalid key/body before a transaction', async (key, body) => {
    const { controller, pool } = api();
    await expect(controller.copy(request(), PUBLICATION, key, body)).rejects.toMatchObject({
      status: 400,
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
