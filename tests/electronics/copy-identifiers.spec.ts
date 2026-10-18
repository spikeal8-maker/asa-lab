import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ELECTRONICS_MODULE, EMPTY_DOCUMENT } from '@asa-lab/electronics';
import { SaveDraftUseCase, type ProjectRepositoryPort } from '../../contexts/projects/index';
import { ProjectsController } from '../../apps/api/src/projects.controller';
import { SESSION_COOKIE } from '../../apps/api/src/tokens';
import { validationMessage } from '../../apps/api/src/validation';
import { duplicateComponentInDocument } from '../../apps/web/src/electronics/workbench-document';
import type { SchematicDocument } from '../../apps/web/src/api';

describe('Electronics connected copies through canonical validation and Project Core', () => {
  it('saves and reopens eight copy generations without changing original identities or wire links', async () => {
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
    const repository = {
      load: async () => loaded(),
      saveDraft: async (input: { document: unknown }) => {
        draft = {
          ...draft,
          document: structuredClone(input.document),
          revision: draft.revision + 1,
        };
        return draft;
      },
    } as unknown as ProjectRepositoryPort;
    const controller = Object.create(ProjectsController.prototype) as ProjectsController;
    Object.assign(controller, {
      activeContext: { resolve: async () => ({ tenantId: 't1', principalId: 'u1', userId: 'u1' }) },
      saveUseCase: new SaveDraftUseCase(repository, {
        get: () => ({
          moduleKey: 'electronics',
          defaultProjectTitlePrefix: 'Схема',
          validateDocument: (value) => validationMessage(ELECTRONICS_MODULE, value),
          describePreview: () => null,
        }),
        getCreatable: () => null,
      }),
      openUseCase: { execute: async () => ({ ok: true, value: loaded() }) },
      analyse: () => null,
    });
    const request = {
      id: randomUUID(),
      cookies: { [SESSION_COOKIE]: 'synthetic' },
      headers: {},
    } as unknown as FastifyRequest;
    const firstId = 'a'.repeat(64),
      secondId = 'b'.repeat(64);
    const initial = {
      ...EMPTY_DOCUMENT,
      components: [
        { id: firstId, kind: 'resistor', value: 1000, position: { x: 0, y: 0 } },
        { id: secondId, kind: 'led', value: 2, position: { x: 100, y: 0 } },
      ],
      connections: [
        {
          id: 'w'.repeat(64),
          from: { componentId: firstId, terminal: 'a' },
          to: { componentId: secondId, terminal: 'a' },
        },
      ],
    };
    const normalized = validationMessage(ELECTRONICS_MODULE, initial);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error('Invalid connected-copy fixture');
    let document = normalized.document as SchematicDocument;
    let ids = [firstId, secondId];
    for (let generation = 0; generation < 8; generation += 1) {
      const copied = duplicateComponentInDocument(document, {
        kind: 'component',
        id: ids[0]!,
        ids,
      })!;
      ids = copied.components.map((item) => item.id);
      document = copied.document;
      const response = await controller.saveDraft(request, 'p1', {
        document: JSON.parse(JSON.stringify(document)),
        baseRevision: draft.revision,
        mutationId: randomUUID(),
      });
      expect(response.draft.revision).toBe(generation + 2);
      const reopened = await controller.open(request, 'p1');
      expect(reopened.draft.document).toEqual(document);
      expect(validationMessage(ELECTRONICS_MODULE, reopened.draft.document).ok).toBe(true);
    }
    expect(draft.revision).toBe(9);
    expect(document.components.slice(0, 2).map((item) => item.id)).toEqual([firstId, secondId]);
    const invalid = {
      ...document,
      components: document.components.map((item, index) =>
        index ? item : { ...item, id: 'x'.repeat(65) },
      ),
    };
    await expect(
      controller.saveDraft(request, 'p1', {
        document: invalid,
        baseRevision: draft.revision,
        mutationId: randomUUID(),
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { reasonCode: 'electronics_component_id' } },
    });
    expect(draft.revision).toBe(9);
    expect(draft.document).toEqual(document);
  });
});
