import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type pg from 'pg';
import { cacheControlFor, createApiApp } from './app.factory.js';

const HASHED_SCRIPT = 'index-DuJpyya8.js';
const OWNER_ASSET = 'arduino-uno.svg';

describe('cache policy', () => {
  it('lets a browser hold a content-hashed file', () => {
    expect(cacheControlFor(HASHED_SCRIPT)).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('CheckersModuleExperience-vBn2tsLy.js')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(cacheControlFor('index-BBoRd2kD.css')).toBe('public, max-age=31536000, immutable');
  });

  it('never holds the entry document', () => {
    expect(cacheControlFor('index.html')).toBe('no-cache');
  });

  it('never holds owner-supplied assets that carry no hash', () => {
    // These sit in the same /assets/ directory as the build output, which is
    // why the rule matches the filename shape and not the directory. Getting
    // this wrong is not recoverable: the file stays in browsers for a year.
    expect(cacheControlFor(OWNER_ASSET)).toBe('no-cache');
    expect(cacheControlFor('manifest.json')).toBe('no-cache');
    expect(cacheControlFor('breadboard-small.svg')).toBe('no-cache');
    expect(cacheControlFor('pin-map.json')).toBe('no-cache');
    expect(cacheControlFor('noto-sans-symbols-2-v25-symbols.woff2')).toBe('no-cache');
  });

  it('does not mistake a short suffix for a content hash', () => {
    expect(cacheControlFor('logo-2x.png')).toBe('no-cache');
    expect(cacheControlFor('board-v2.svg')).toBe('no-cache');
  });
});

describe('asset delivery over HTTP', () => {
  let webDist: string;
  const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];

  beforeAll(() => {
    webDist = mkdtempSync(join(tmpdir(), 'asa-web-dist-'));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>ASA Lab</title>');
    // Above the compression threshold so the encoding is exercised.
    writeFileSync(join(webDist, HASHED_SCRIPT), `console.log("${'x'.repeat(4000)}");`);
    writeFileSync(join(webDist, OWNER_ASSET), `<svg>${'y'.repeat(4000)}</svg>`);
  });

  afterAll(() => {
    rmSync(webDist, { recursive: true, force: true });
  });

  afterEach(async () => {
    while (apps.length > 0) {
      await apps.pop()?.close();
    }
  });

  async function server() {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => undefined),
    } as unknown as pg.Pool;
    const app = await createApiApp({ pool, webDist, logRequests: false });
    apps.push(app);
    return app.getHttpAdapter().getInstance();
  }

  it('marks the hashed bundle immutable and the SPA document revalidated', async () => {
    const fastify = await server();

    const script = await fastify.inject({ method: 'GET', url: `/${HASHED_SCRIPT}` });
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const document = await fastify.inject({ method: 'GET', url: '/some/spa/route' });
    expect(document.statusCode).toBe(200);
    expect(document.headers['cache-control']).toBe('no-cache');

    const ownerAsset = await fastify.inject({ method: 'GET', url: `/${OWNER_ASSET}` });
    expect(ownerAsset.headers['cache-control']).toBe('no-cache');
  });

  it('compresses what it sends when the client accepts it', async () => {
    const fastify = await server();

    const compressed = await fastify.inject({
      method: 'GET',
      url: `/${HASHED_SCRIPT}`,
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(compressed.headers['content-encoding']).toBe('gzip');

    const plain = await fastify.inject({
      method: 'GET',
      url: `/${HASHED_SCRIPT}`,
      headers: { 'accept-encoding': 'identity' },
    });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.rawPayload.length).toBeGreaterThan(compressed.rawPayload.length);
  });
});
