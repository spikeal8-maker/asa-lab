import { request } from 'node:http';
import { describe, it, expect, vi } from 'vitest';
import { createApiApp } from '../../apps/api/src/app.factory';

describe('actual API disconnected delivery', () => {
  it('emits one terminal cancellation with safe correlation even if handler later completes', async () => {
    const app = await createApiApp({
      pool: null,
      analyticsPool: null,
      webDist: null,
      logRequests: true,
    });
    const fastify = app.getHttpAdapter().getInstance();
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fastify.get('/api/coverage-held', async () => {
      reached();
      await held;
      return { done: true };
    });
    const events: Record<string, unknown>[] = [];
    const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      try {
        events.push(JSON.parse(String(chunk)));
      } catch {
        /* Other producers may write non-JSON diagnostics. */
      }
      return true;
    });
    try {
      await app.listen(4612, '127.0.0.1');
      const client = request('http://127.0.0.1:4612/api/coverage-held?private=SECRET', (response) =>
        response.resume(),
      );
      client.on('error', () => undefined);
      client.end();
      await entered;
      client.destroy();
      await vi.waitFor(() =>
        expect(events.some((event) => event.kind === 'http_request_ended')).toBe(true),
      );
      release();
      await app.close();
      const start = events.find(
        (event) => event.kind === 'http_request_started' && event.path === '/api/coverage-held',
      );
      const terminal = events.filter(
        (event) =>
          event.requestId === start?.requestId &&
          ['http_request_ended', 'http_response'].includes(String(event.kind)),
      );
      expect(terminal).toHaveLength(1);
      // Either raw stream may report this real socket abort first. Both are
      // terminal cancellations; their event order is not an API guarantee.
      expect(['connection_closed', 'request_aborted']).toContain(terminal[0].outcome);
      expect(terminal[0]).toMatchObject({
        delivery: 'disconnected',
        mutationOutcome: 'unknown',
      });
      expect(terminal[0]).not.toHaveProperty('status');
      expect(JSON.stringify(events)).not.toContain('SECRET');
    } finally {
      release();
      output.mockRestore();
      await app.close();
    }
  });
});
