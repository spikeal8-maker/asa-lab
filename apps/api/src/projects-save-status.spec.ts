// Include the same cookie request augmentation as the production API.
import type {} from '@fastify/cookie';
import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ProjectsController } from './projects.controller.js';
import { SESSION_COOKIE } from './tokens.js';

describe('existing project controller preserves draft failure status', () => {
  it.each([
    ['validation_error', 400],
    ['dependency_unavailable', 503],
    ['project_revision_conflict', 409],
    ['idempotency_conflict', 409],
    ['classroom_not_found', 404],
    ['project_not_found', 404],
  ] as const)('maps %s without reporting save success', async (code, status) => {
    // Only the already-existing controller method is exercised; no HTTP or DB is started.
    const controller = Object.create(ProjectsController.prototype) as ProjectsController;
    const open = vi.fn();
    Object.assign(controller, {
      activeContext: {
        resolve: async () => ({
          tenantId: randomUUID(),
          principalId: randomUUID(),
          userId: randomUUID(),
        }),
      },
      saveUseCase: { execute: async () => ({ ok: false, code, message: 'safe failure' }) },
      openUseCase: { execute: open },
    });
    const request = {
      cookies: { [SESSION_COOKIE]: 'synthetic-unit-session' },
    } as unknown as FastifyRequest;
    const rejected = controller.saveDraft(request, randomUUID(), {
      document: {},
      baseRevision: 1,
      mutationId: randomUUID(),
    });
    await expect(rejected).rejects.toBeInstanceOf(HttpException);
    await expect(rejected).rejects.toMatchObject({
      status,
      response: { error: { code, message: 'safe failure' } },
    });
    expect(open).not.toHaveBeenCalled();
  });
});
