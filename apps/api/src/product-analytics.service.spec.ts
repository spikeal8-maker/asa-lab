import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ActiveContext } from '@asa-lab/identity';
import { ProductAnalyticsService } from './product-analytics.service.js';
import { AnalyticsDeliveryQueue } from './analytics-delivery-queue.js';

type AnalyticsQuery = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

const CONTEXT: ActiveContext = {
  principalId: '10000000-0000-4000-8000-000000000001',
  accountId: '20000000-0000-4000-8000-000000000001',
  workspaceId: '30000000-0000-4000-8000-000000000001',
  workspaceKind: 'personal',
  tenantId: '40000000-0000-4000-8000-000000000001',
  userId: null,
  email: 'owner@example.test',
  displayName: 'Владелец',
  schoolId: null,
};

describe('product analytics writer', () => {
  it('confirms a legacy start UUID independently of its accepted letter case', async () => {
    const lower = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const query = vi.fn<AnalyticsQuery>(async () => ({
      rows: [{ analytics_start_module_session: lower }],
    }));
    const service = new ProductAnalyticsService(
      { query } as unknown as pg.Pool,
      new AnalyticsDeliveryQueue(true, Date.now, () => undefined),
    );
    await expect(
      service.startModuleSession({
        sessionId: lower.toUpperCase(),
        projectId: lower,
        actor: { kind: 'account', context: CONTEXT },
        moduleKey: 'blocks',
      }),
    ).resolves.toBe(true);
    await service.shutdown();
  });
  it('persists a real v2 actor envelope and rejects a queued or misbound database acknowledgement', async () => {
    const eventId = '50000000-0000-4000-8000-000000000001';
    const receivedAt = '2026-10-11T10:00:00.000Z';
    const receipt = {
      accepted: true,
      state: 'persisted',
      schemaVersion: 2,
      eventId,
      receiptId: eventId,
      operation: 'visit.observed',
      receivedAt,
      persistedAt: receivedAt,
    };
    const query = vi.fn<AnalyticsQuery>(async () => ({ rows: [{ receipt }] }));
    const service = new ProductAnalyticsService(
      { query } as unknown as pg.Pool,
      new AnalyticsDeliveryQueue(true, Date.now, () => undefined),
    );
    const run = () =>
      service.persistOperation(
        eventId,
        { kind: 'account', context: CONTEXT },
        'visit.observed',
        { outcome: 'succeeded' },
        {},
        receivedAt,
      );
    await expect(run()).resolves.toEqual(receipt);
    expect(query.mock.calls[0]![1]!.slice(0, 8)).toEqual([
      eventId,
      'account',
      CONTEXT.accountId,
      CONTEXT.principalId,
      null,
      CONTEXT.workspaceId,
      null,
      'visit.observed',
    ]);
    query.mockResolvedValueOnce({ rows: [{ receipt: { ...receipt, state: 'queued' } }] });
    await expect(run()).rejects.toMatchObject({ code: 'telemetry_unavailable' });
    query.mockResolvedValueOnce({ rows: [{ receipt: { ...receipt, eventId: 'foreign' } }] });
    await expect(run()).rejects.toMatchObject({ code: 'telemetry_unavailable' });
    await service.shutdown();
  });
  it('returns background queue admission without waiting for SQL, and freezes normalized receipt facts', async () => {
    let release!: (value: { rows: Record<string, unknown>[] }) => void;
    const pending = new Promise<{ rows: Record<string, unknown>[] }>((resolve) => {
      release = resolve;
    });
    const query = vi.fn<AnalyticsQuery>(() => pending);
    const queue = new AnalyticsDeliveryQueue(true, Date.now, () => undefined);
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool, queue);
    const receivedAt = '2026-10-11T10:00:00Z';
    const actor = { kind: 'account' as const, context: { ...CONTEXT } };
    expect(
      service.enqueueEvent({
        actor,
        eventType: 'auth.login',
        outcome: 'succeeded',
        receivedAt,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 raw-private-tail',
        address: '203.0.113.10',
        networkKind: 'public',
      }),
    ).toEqual({ state: 'queued' });
    actor.context.accountId = 'mutated after admission';
    await Promise.resolve();
    expect(queue.counters.persisted).toBe(0);
    const args = query.mock.calls[0]![1]!;
    expect(args[2]).toBe(CONTEXT.accountId);
    expect(args[10]).toBe(receivedAt);
    expect(JSON.stringify(args)).not.toContain('raw-private-tail');
    expect(JSON.stringify(args)).not.toContain(CONTEXT.email);
    const eventId = args[0] as string;
    release({
      rows: [
        {
          receipt: {
            accepted: true,
            state: 'persisted',
            schemaVersion: 2,
            eventId,
            receiptId: eventId,
            operation: 'auth.login',
            receivedAt,
            persistedAt: receivedAt,
          },
        },
      ],
    });
    await queue.shutdown();
    expect(queue.counters.persisted).toBe(1);
  });
  it('does not turn an unconfirmed legacy database result into accepted persistence', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => ({ rows: [{ analytics_record_event: null }] }));
    const service = new ProductAnalyticsService(
      { query } as unknown as pg.Pool,
      new AnalyticsDeliveryQueue(true, Date.now, () => undefined),
    );
    await expect(
      service.record({ actor: { kind: 'anonymous' }, eventType: 'auth.login', outcome: 'failed' }),
    ).resolves.toBe(false);
  });
  it('fails closed for null touches, anonymous actors and database failure', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => ({
      rows: [{ analytics_touch_module_session: null }],
    }));
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);
    const input = {
      sessionId: 's1',
      actor: { kind: 'account' as const, context: CONTEXT },
      closed: false,
    };
    await expect(service.touchModuleSession(input)).resolves.toBe(false);
    query.mockRejectedValueOnce(new Error('telemetry unavailable'));
    await expect(service.touchModuleSession(input)).resolves.toBe(false);
    await expect(
      service.startModuleSession({
        sessionId: 's1',
        projectId: 'p1',
        actor: { kind: 'anonymous' },
        moduleKey: 'blocks',
      }),
    ).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each([null, undefined, 'foreign'])(
    'does not accept a null/mismatched PG start result: %s',
    async (value) => {
      const query = vi.fn<AnalyticsQuery>(async () => ({
        rows: [{ analytics_start_module_session: value }],
      }));
      const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);
      await expect(
        service.startModuleSession({
          sessionId: 's1',
          projectId: 'p1',
          actor: { kind: 'account', context: CONTEXT },
          moduleKey: 'blocks',
        }),
      ).resolves.toBe(false);
    },
  );
  it('records a successful account event with the trusted address and scope', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => ({
      rows: [{ analytics_record_event: 1 }],
    }));
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);

    await expect(
      service.record({
        actor: { kind: 'account', context: CONTEXT },
        eventType: 'auth.login',
        outcome: 'succeeded',
        authMethod: 'password',
        flowId: '50000000-0000-4000-8000-000000000001',
        address: '203.0.113.15',
        networkKind: 'public',
        userAgentSummary: 'Chrome · Windows',
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('analytics_record_event'),
      expect.arrayContaining([
        'account',
        CONTEXT.accountId,
        CONTEXT.principalId,
        null,
        CONTEXT.workspaceId,
        'auth.login',
        'succeeded',
        'password',
      ]),
    );
    expect(query.mock.calls[0]?.[1]?.[10]).toBe('203.0.113.15');
    expect(query.mock.calls[0]?.[1]?.[12]).toBe('public');
  });

  it('drops an invalid address and never breaks the product when telemetry is unavailable', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => {
      throw new Error('database unavailable');
    });
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);

    await expect(
      service.record({
        actor: { kind: 'anonymous' },
        eventType: 'auth.login',
        outcome: 'failed',
        authMethod: 'password',
        address: 'not-an-ip',
      }),
    ).resolves.toBe(false);
    expect(query.mock.calls[0]?.[1]?.[10]).toBeNull();
    expect(query.mock.calls[0]?.[1]?.[12]).toBe('unknown');
  });

  it('stores an unresolved proxy visitor as NULL instead of a Docker gateway', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => ({ rows: [] }));
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);
    await service.record({
      actor: { kind: 'anonymous' },
      eventType: 'auth.login',
      outcome: 'failed',
      address: 'unknown',
      networkKind: 'proxy',
    });
    expect(query.mock.calls[0]?.[1]?.[10]).toBeNull();
    expect(query.mock.calls[0]?.[1]?.[12]).toBe('proxy');
  });

  it('starts a project-bound module session with network provenance', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => ({
      rows: [{ analytics_start_module_session: '50000000-0000-4000-8000-000000000001' }],
    }));
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);

    await expect(
      service.startModuleSession({
        sessionId: '50000000-0000-4000-8000-000000000001',
        projectId: '60000000-0000-4000-8000-000000000001',
        actor: { kind: 'account', context: CONTEXT },
        moduleKey: 'electronics',
        address: '192.168.1.42',
        networkKind: 'local_network',
        userAgentSummary: 'School browser',
      }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0]?.[1]).toEqual([
      '50000000-0000-4000-8000-000000000001',
      'account',
      CONTEXT.accountId,
      CONTEXT.principalId,
      null,
      CONTEXT.workspaceId,
      'electronics',
      '60000000-0000-4000-8000-000000000001',
      '192.168.1.42',
      'local_network',
      'School browser',
    ]);
  });

  it('touches only the authenticated actor session', async () => {
    const query = vi.fn<AnalyticsQuery>(async () => ({
      rows: [{ analytics_touch_module_session: 30 }],
    }));
    const service = new ProductAnalyticsService({ query } as unknown as pg.Pool);

    await expect(
      service.touchModuleSession({
        sessionId: '50000000-0000-4000-8000-000000000001',
        actor: { kind: 'account', context: CONTEXT },
        closed: true,
      }),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('analytics_touch_module_session'), [
      '50000000-0000-4000-8000-000000000001',
      'account',
      CONTEXT.accountId,
      CONTEXT.principalId,
      true,
    ]);
  });
});
