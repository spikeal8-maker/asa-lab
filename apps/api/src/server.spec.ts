import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app';

describe('api server smoke (real HTTP on a free port)', () => {
  it('actually starts and serves both health endpoints', async () => {
    // Isolated from the ambient DATABASE_URL so the readiness outcome is
    // deterministic (no pool → not_ready 503).
    const saved = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    let app;
    try {
      app = buildApp();
    } finally {
      if (saved !== undefined) {
        process.env['DATABASE_URL'] = saved;
      }
    }

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const live = await fetch(`${base}/health/live`);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ status: 'live' });

      const ready = await fetch(`${base}/health/ready`);
      expect(ready.status).toBe(503);
      expect((await ready.json()).status).toBe('not_ready');
    } finally {
      await app.close();
    }
  });
});
