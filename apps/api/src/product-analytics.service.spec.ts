import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ActiveContext } from '@asa-lab/identity';
import { ProductAnalyticsService } from './product-analytics.service.js';

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
  it('records a successful account event with the trusted address and scope', async () => {
    const query = vi.fn(async () => ({ rows: [{ analytics_record_event: 1 }] }));
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
    const query = vi.fn(async () => {
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

  it('starts a project-bound module session with network provenance', async () => {
    const query = vi.fn(async () => ({ rows: [{ analytics_start_module_session: 'session' }] }));
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
    const query = vi.fn(async () => ({ rows: [{ analytics_touch_module_session: 30 }] }));
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
