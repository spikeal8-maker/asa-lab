import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  BLOCKS_ASSET_CONTENT_TYPE,
  BLOCKS_DRAFT_CONTENT_TYPE,
  BlocksRuntimeAddressBudget,
  optionalBlocksRuntimeOrigin,
  registerBlocksRuntimeTransport,
} from './blocks-runtime-transport.js';

const ORIGIN = 'http://127.0.0.1:4613';
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('Blocks runtime transport', () => {
  it('accepts only an exact configured runtime origin', () => {
    expect(optionalBlocksRuntimeOrigin({ ASA_BLOCKS_RUNTIME_ORIGIN: ORIGIN })).toBe(ORIGIN);
    expect(optionalBlocksRuntimeOrigin({})).toBeNull();
    expect(() => optionalBlocksRuntimeOrigin({ ASA_BLOCKS_RUNTIME_ORIGIN: ORIGIN + '/' })).toThrow(
      /exact http\(s\) origin/,
    );
    expect(() =>
      optionalBlocksRuntimeOrigin({ ASA_BLOCKS_RUNTIME_ORIGIN: 'javascript:alert(1)' }),
    ).toThrow(/exact http\(s\) origin/);
  });
  it('answers preflight only for the exact runtime origin', async () => {
    app = Fastify();
    registerBlocksRuntimeTransport(app, ORIGIN);

    const good = await app.inject({
      method: 'OPTIONS',
      url: '/api/blocks/runtime/projects/11111111-1111-4111-8111-111111111111/draft',
      headers: { origin: ORIGIN },
    });
    expect(good.statusCode).toBe(204);
    expect(good.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(good.headers['access-control-allow-methods']).toContain('PUT');
    expect(good.headers['access-control-allow-headers']).toContain('Authorization');

    const bad = await app.inject({
      method: 'OPTIONS',
      url: '/api/blocks/runtime/projects/11111111-1111-4111-8111-111111111111/draft',
      headers: { origin: 'http://127.0.0.1:9999' },
    });
    expect(bad.statusCode).toBe(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('keeps binary asset bodies as streams for bounded capture', async () => {
    app = Fastify();
    registerBlocksRuntimeTransport(app, ORIGIN);
    app.put('/api/blocks/runtime/test-asset', async (request) => {
      let bytes = 0;
      for await (const chunk of request.body as AsyncIterable<Uint8Array>) {
        bytes += chunk.byteLength;
      }
      return { bytes };
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/blocks/runtime/test-asset',
      headers: {
        origin: ORIGIN,
        'content-type': BLOCKS_ASSET_CONTENT_TYPE,
      },
      payload: Buffer.alloc(4096, 7),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bytes: 4096 });
  });
  it('allows bounded large draft JSON without raising the global JSON limit', async () => {
    app = Fastify({ bodyLimit: 1024 * 1024 });
    registerBlocksRuntimeTransport(app, ORIGIN);
    app.put('/api/blocks/runtime/test-draft', async (request) => request.body);

    const payload = JSON.stringify({ document: { value: 'x'.repeat(1024 * 1024 + 128) } });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/blocks/runtime/test-draft',
      headers: {
        origin: ORIGIN,
        'content-type': BLOCKS_DRAFT_CONTENT_TYPE,
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { document: { value: string } }).document.value.length).toBe(
      1024 * 1024 + 128,
    );
  });

  it('rejects malformed draft JSON as a client error', async () => {
    app = Fastify();
    registerBlocksRuntimeTransport(app, ORIGIN);
    app.put('/api/blocks/runtime/test-draft', async (request) => request.body);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/blocks/runtime/test-draft',
      headers: { origin: ORIGIN, 'content-type': BLOCKS_DRAFT_CONTENT_TYPE },
      payload: '{',
    });
    expect(response.statusCode).toBe(400);
  });

  it('keeps a broad bounded pre-JWT address ceiling without the generic school-NAT limit', async () => {
    app = Fastify();
    const budget = new BlocksRuntimeAddressBudget({ limit: 2, windowMs: 60_000 });
    app.get('/budget', async (request) => budget.consume(request));

    const first = await app.inject({ method: 'GET', url: '/budget' });
    const second = await app.inject({ method: 'GET', url: '/budget' });
    const third = await app.inject({ method: 'GET', url: '/budget' });

    expect(first.json()).toMatchObject({ allowed: true });
    expect(second.json()).toMatchObject({ allowed: true });
    expect(third.json()).toMatchObject({ allowed: false });
  });
});
