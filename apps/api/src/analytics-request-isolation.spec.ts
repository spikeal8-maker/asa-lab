import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { ProductAnalyticsService } from './product-analytics.service.js';
import { ProductAnalyticsController } from './product-analytics.controller.js';
import { ProductAnalyticsV2Controller } from './product-analytics-v2.controller.js';
import { AnalyticsDeliveryQueue } from './analytics-delivery-queue.js';

const id = '10000000-0000-4000-8000-000000000001';
const row = {
  principal_id: id,
  account_id: id,
  workspace_id: id,
  workspace_kind: 'personal',
  tenant_id: id,
};
const request = {
  cookies: { asa_session: 'synthetic' },
  headers: {},
  raw: { socket: { remoteAddress: '127.0.0.1' } },
} as unknown as FastifyRequest;
const envelope = {
  schemaVersion: 2,
  eventId: id,
  eventType: 'visit.observed',
  actorExpectation: { kind: 'account', accountId: id, workspaceId: id },
  visitId: id,
  clientOccurredAt: '2026-10-11T10:00:00Z',
  entryRoute: 'home',
  referrerOrigin: null,
};
const tick = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
function fixture(query: (sql: string, values?: unknown[]) => Promise<{ rows: object[] }>) {
  const queue = new AnalyticsDeliveryQueue(true, Date.now, () => undefined);
  const service = new ProductAnalyticsService({ query } as unknown as pg.Pool, queue);
  return {
    queue,
    service,
    v1: new ProductAnalyticsController(service),
    v2: new ProductAnalyticsV2Controller(service),
  };
}

describe('telemetry admission includes authoritative cookie lookup', () => {
  it.each([
    'module session actor denied',
    'module session context denied',
    'module session identifier collision',
  ])(
    'keeps the legacy non-acceptance contract for %s without claiming persistence',
    async (message) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('session_v2_context')) return { rows: [row] };
        throw Object.assign(new Error(message), { code: '42501' });
      });
      const f = fixture(query);
      try {
        await expect(
          f.v1.startModuleSession(request, { sessionId: id, projectId: id, moduleKey: 'blocks' }),
        ).resolves.toEqual({ accepted: false, sessionId: id });
        expect(query).toHaveBeenCalledTimes(2);
        expect(f.queue.counters.persisted).toBe(0);
        expect(f.queue.counters.rejected).toBe(1);
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it.each([
    ['42501', 'permission denied for function analytics_start_module_session'],
    ['57014', 'canceling statement due to statement timeout'],
    ['08006', 'connection failure'],
    ['XX000', 'module session context denied'],
  ])('retains unavailable for actual start delivery failure %s / %s', async (code, message) => {
    const f = fixture(async (sql) => {
      if (sql.includes('session_v2_context')) return { rows: [row] };
      throw Object.assign(new Error(message), { code });
    });
    try {
      await expect(
        f.v1.startModuleSession(request, { sessionId: id, projectId: id, moduleKey: 'blocks' }),
      ).rejects.toMatchObject({
        status: 503,
        response: { error: { code: 'telemetry_unavailable' } },
      });
      expect(f.queue.counters.persisted).toBe(0);
      expect(f.queue.counters.rejected).toBe(1);
    } finally {
      await f.service.shutdown();
    }
  });

  it('does not reinterpret another operation or V2 as legacy start non-acceptance', async () => {
    const f = fixture(async (sql) => {
      if (sql.includes('session_v2_context')) return { rows: [row] };
      throw Object.assign(new Error('module session context denied'), { code: '42501' });
    });
    try {
      await expect(f.v1.moduleOpened(request, { moduleKey: 'blocks' })).rejects.toMatchObject({
        status: 503,
        response: { error: { code: 'telemetry_unavailable' } },
      });
      await expect(f.v2.events(request, envelope)).rejects.toMatchObject({
        status: 403,
        response: { error: { code: 'context_denied' } },
      });
      expect(f.queue.counters.persisted).toBe(0);
      expect(f.queue.counters.rejected).toBe(2);
    } finally {
      await f.service.shutdown();
    }
  });

  it('bounds auth work before SQL and returns capacity for both API versions without logging users out', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const query = vi.fn(async () => {
      await gate;
      return { rows: [] };
    });
    const f = fixture(query);
    const requests = Array.from({ length: 256 }, () =>
      f.v2.events(request, envelope).catch((error) => error),
    );
    await tick();
    expect(query).toHaveBeenCalledTimes(1);
    expect(f.queue.pending).toBe(255);
    expect(f.queue.inFlight).toBe(1);
    for (const call of [
      () => f.v2.events(request, envelope),
      () => f.v1.moduleOpened(request, { moduleKey: 'blocks' }),
    ]) {
      await expect(call()).rejects.toMatchObject({
        status: 429,
        response: { error: { code: 'telemetry_capacity' } },
      });
    }
    expect(query).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(requests);
    expect(f.queue.counters.persisted).toBe(0);
    await f.service.shutdown();
  });

  it('serializes auth and persistence as one delivery and confirms exactly one durable write', async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('session_v2_context')) return { rows: [row] };
      if (sql.includes('analytics_ingest_v2'))
        return {
          rows: [
            {
              receipt: {
                accepted: true,
                state: 'persisted',
                schemaVersion: 2,
                eventId: id,
                receiptId: id,
                operation: 'visit.observed',
                receivedAt: values![10],
                persistedAt: new Date().toISOString(),
              },
            },
          ],
        };
      throw new Error('unexpected SQL');
    });
    const f = fixture(query);
    await expect(f.v2.events(request, envelope)).resolves.toMatchObject({ state: 'persisted' });
    expect(query).toHaveBeenCalledTimes(2);
    expect(f.queue.counters.enqueued).toBe(1);
    expect(f.queue.counters.persisted).toBe(1);
    await f.service.shutdown();
  });

  it('maps auth database failure to unavailable, never unauthorized, in both versions', async () => {
    const f = fixture(async () => {
      throw Object.assign(new Error('private'), { code: '57014' });
    });
    await expect(f.v2.events(request, envelope)).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'telemetry_unavailable' } },
    });
    await expect(f.v1.moduleOpened(request, { moduleKey: 'blocks' })).rejects.toMatchObject({
      status: 503,
    });
    expect(f.queue.counters.persisted).toBe(0);
    await f.service.shutdown();
  });

  it('does not retain admission in detached work, share it across services, or accept auth-only success', async () => {
    const query = vi.fn(async () => ({ rows: [{ analytics_record_event: 1 }] }));
    const f = fixture(query);
    const other = fixture(query);
    let later!: () => Promise<boolean>;
    const event = {
      actor: { kind: 'anonymous' as const },
      eventType: 'auth.login' as const,
      outcome: 'failed' as const,
    };
    await f.service.authenticatedRequest(undefined, undefined, async () => {
      await expect(
        f.service.authenticatedRequest(undefined, undefined, async () => true),
      ).rejects.toMatchObject({ code: 'telemetry_unavailable' });
      await other.service.record(event);
      const { AsyncResource } = await import('node:async_hooks');
      later = AsyncResource.bind(() => f.service.record(event));
      return f.service.record(event);
    });
    expect(f.queue.counters.persisted).toBe(1);
    expect(other.queue.counters.persisted).toBe(1);
    await later();
    expect(f.queue.counters.enqueued).toBe(2);
    expect(f.queue.counters.persisted).toBe(2);
    await expect(
      f.service.authenticatedRequest(undefined, undefined, async () => true),
    ).rejects.toMatchObject({ code: 'telemetry_unavailable' });
    expect(f.queue.counters.persisted).toBe(2);
    await f.service.shutdown();
    await other.service.shutdown();
  });
});
