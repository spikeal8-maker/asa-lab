import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiApp } from './app.factory.js';
import { BLOCKS_DRAFT_CONTENT_TYPE } from './blocks-runtime-transport.js';

const WEB_ORIGIN = 'http://127.0.0.1:4610';
const RUNTIME_ORIGIN = 'http://127.0.0.1:4613';
const PROJECT = '11111111-1111-4111-8111-111111111111';

async function makeApp() {
  vi.stubEnv('ASA_BLOCKS_RUNTIME_ORIGIN', RUNTIME_ORIGIN);
  const app = await createApiApp({
    pool: null,
    webDist: null,
    allowedWebOrigin: WEB_ORIGIN,
    additionalAllowedOrigins: [],
    logRequests: false,
  });
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  return { app, fastify };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Blocks runtime CORS boundary', () => {
  it('allows exact runtime preflight but not another origin', async () => {
    const { app, fastify } = await makeApp();
    try {
      const good = await fastify.inject({
        method: 'OPTIONS',
        url: `/api/blocks/runtime/projects/${PROJECT}/draft`,
        headers: { origin: RUNTIME_ORIGIN },
      });
      expect(good.statusCode).toBe(204);
      expect(good.headers['access-control-allow-origin']).toBe(RUNTIME_ORIGIN);

      const bad = await fastify.inject({
        method: 'OPTIONS',
        url: `/api/blocks/runtime/projects/${PROJECT}/draft`,
        headers: { origin: WEB_ORIGIN },
      });
      expect(bad.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('does not make runtime origin trusted for normal cookie API mutations', async () => {
    const { app, fastify } = await makeApp();
    try {
      const response = await fastify.inject({
        method: 'PUT',
        url: `/api/projects/${PROJECT}/draft`,
        headers: { origin: RUNTIME_ORIGIN, 'content-type': 'application/json' },
        payload: { document: {}, baseRevision: 0, mutationId: crypto.randomUUID() },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'origin_forbidden' } });
    } finally {
      await app.close();
    }
  });
  it('passes exact runtime mutation origin to bearer boundary, not generic web-origin rejection', async () => {
    const { app, fastify } = await makeApp();
    try {
      const response = await fastify.inject({
        method: 'PUT',
        url: `/api/blocks/runtime/projects/${PROJECT}/draft`,
        headers: {
          origin: RUNTIME_ORIGIN,
          'content-type': BLOCKS_DRAFT_CONTENT_TYPE,
        },
        payload: {
          document: { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] },
          baseRevision: 0,
          mutationId: crypto.randomUUID(),
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.headers['access-control-allow-origin']).toBe(RUNTIME_ORIGIN);
      expect(response.json()).toMatchObject({ error: { code: 'dependency_unavailable' } });
    } finally {
      await app.close();
    }
  });
});
