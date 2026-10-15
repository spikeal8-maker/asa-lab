import type {} from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ProjectsController } from './projects.controller.js';
import { SESSION_COOKIE } from './tokens.js';
import {
  ELECTRONICS_MODULE,
  EMPTY_DOCUMENT,
  ELECTRONICS_DOCUMENT_VALIDATION_REASONS,
} from '@asa-lab/electronics';
import { SaveDraftUseCase, type ProjectRepositoryPort } from '@asa-lab/projects';
import { validationMessage } from './validation.js';
import {
  recordServerFailure,
  requestValidationReasons,
  safeValidationReason,
} from './server-diagnostics.js';

describe('Electronics parser, provider, Project Core and API validation reasons', () => {
  it('API exposure policy admits every canonical Electronics reason', () => {
    for (const reason of ELECTRONICS_DOCUMENT_VALIDATION_REASONS)
      expect(safeValidationReason(reason)).toBe(reason);
  });
  const dangling = {
    ...EMPTY_DOCUMENT,
    components: [
      {
        id: 'resistor',
        kind: 'resistor',
        position: { x: 0, y: 0 },
        value: 1000,
        holeBindings: { a: { breadboardComponentId: 'deleted-board', holeId: 'H1' } },
      },
    ],
  };
  function fixture() {
    let draft = {
      projectId: 'p1',
      document: EMPTY_DOCUMENT as unknown,
      revision: 1,
      updatedAt: 'now',
    };
    const loaded = () => ({
      project: { id: 'p1', moduleKey: 'electronics' },
      draft,
      versions: [],
      result: null,
    });
    const write = vi.fn(async (input) => {
      draft = { ...draft, document: input.document, revision: draft.revision + 1 };
      return draft;
    });
    const repository = {
      load: async () => loaded(),
      saveDraft: write,
    } as unknown as ProjectRepositoryPort;
    const save = new SaveDraftUseCase(repository, {
      get: () => ({
        moduleKey: 'electronics',
        defaultProjectTitlePrefix: 'Схема',
        validateDocument: (value) => validationMessage(ELECTRONICS_MODULE, value),
        describePreview: () => null,
      }),
      getCreatable: () => null,
    });
    const controller = Object.create(ProjectsController.prototype) as ProjectsController;
    Object.assign(controller, {
      activeContext: { resolve: async () => ({ tenantId: 't1', principalId: 'u1', userId: 'u1' }) },
      saveUseCase: save,
      openUseCase: { execute: async () => ({ ok: true, value: loaded() }) },
      analyse: () => null,
    });
    const request = {
      id: randomUUID(),
      cookies: { [SESSION_COOKIE]: 'synthetic' },
      method: 'PUT',
      raw: { url: '/api/projects/p1/draft' },
      headers: {},
    } as unknown as FastifyRequest;
    return { controller, request, write, draft: () => draft };
  }
  it.each([
    [{ ...EMPTY_DOCUMENT, schemaVersion: 99 }, 'electronics_schema_version'],
    [dangling, 'electronics_hole_binding_reference'],
    [{ ...EMPTY_DOCUMENT, components: 'private-student-data' }, 'electronics_document_arrays'],
  ])(
    'rejects malformed document with reason %s and leaves the existing draft intact',
    async (document, reasonCode) => {
      const f = fixture();
      const before = structuredClone(document);
      try {
        await f.controller.saveDraft(f.request, 'p1', {
          document,
          baseRevision: 1,
          mutationId: randomUUID(),
        });
        expect.fail('invalid document was accepted');
      } catch (error) {
        expect(error).toMatchObject({
          status: 400,
          response: { error: { code: 'validation_error', reasonCode } },
        });
        recordServerFailure(error, f.request, 400, null, null);
        expect(requestValidationReasons.get(f.request)).toBe(reasonCode);
      }
      expect(f.write).not.toHaveBeenCalled();
      expect(f.draft().revision).toBe(1);
      expect(document).toEqual(before);
    },
  );
  it('saves and reopens a valid circuit after deleted-board bindings are cleared', async () => {
    const f = fixture();
    const document = {
      ...dangling,
      components: dangling.components.map((item) => ({ ...item, holeBindings: {} })),
    };
    const response = await f.controller.saveDraft(f.request, 'p1', {
      document,
      baseRevision: 1,
      mutationId: randomUUID(),
    });
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(response.draft).toMatchObject({
      revision: 2,
      document: { components: [{ id: 'resistor', holeBindings: {} }] },
    });
    expect(validationMessage(ELECTRONICS_MODULE, f.draft().document).ok).toBe(true);
  });
  it.each([
    [null, 'draft_body_invalid'],
    [
      { document: EMPTY_DOCUMENT, baseRevision: -1, mutationId: randomUUID() },
      'draft_base_revision_invalid',
    ],
    [
      { document: EMPTY_DOCUMENT, baseRevision: 1, mutationId: 'invalid' },
      'draft_mutation_id_invalid',
    ],
  ])('identifies invalid request envelope: %s', async (body, reasonCode) => {
    const f = fixture();
    await expect(f.controller.saveDraft(f.request, 'p1', body)).rejects.toMatchObject({
      status: 400,
      response: { error: { reasonCode } },
    });
    expect(f.write).not.toHaveBeenCalled();
  });
});
