import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { hashSessionToken } from '@asa-lab/identity';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';
import { ProductAnalyticsService } from '../../apps/api/src/product-analytics.service';
import { ProductAnalyticsV2Controller } from '../../apps/api/src/product-analytics-v2.controller';
import { AnalyticsDeliveryQueue } from '../../apps/api/src/analytics-delivery-queue';
import { analyticsPoolSettings } from '../../apps/api/src/app.factory';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

let admin: pg.Pool;
let main: pg.Pool;
let isolated: pg.Pool;
let service: ProductAnalyticsService;
beforeAll(() => {
  admin = testAdminPool();
  // Existing helpers validate matching *_test URLs before any pool is used.
  main = testAppPool();
  isolated = new pg.Pool({
    connectionString: process.env['APP_TEST_DATABASE_URL'],
    ...analyticsPoolSettings(),
  });
  service = new ProductAnalyticsService(
    isolated,
    new AnalyticsDeliveryQueue(true, Date.now, () => undefined),
  );
});
afterAll(async () => {
  await service?.shutdown();
  await Promise.all([isolated?.end(), main?.end(), admin?.end()]);
});

describe('real PostgreSQL telemetry pool isolation', () => {
  it('keeps login resolution and a confirmed project save available while telemetry authentication is saturated', async () => {
    const teacher = await seedTeacher(admin, 'analytics-isolation');
    const identity = (
      await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const workspace = (
      await admin.query(
        "SELECT workspace_id FROM workspace_memberships WHERE account_id=$1 AND state='active' LIMIT 1",
        [identity.account_id],
      )
    ).rows[0].workspace_id;
    const token = crypto.randomUUID();
    const hash = hashSessionToken(token);
    await main.query('SELECT session_v2_create($1,$2,$3,12,NULL)', [
      identity.principal_id,
      workspace,
      hash,
    ]);
    const repo = new PgProjectRepository(main);
    const actor = { userId: teacher.teacherId, principalId: identity.principal_id };
    const document = { schemaVersion: 1, components: [], connections: [] };
    const created = await repo.createWithDraft({
      tenantId: teacher.tenantId,
      scope: 'personal',
      classroomId: null,
      actor,
      moduleKey: 'electronics',
      title: 'Synthetic isolation',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: 'isolation-fixture',
      initialDocument: document,
      initialPreview: null,
    });
    if (created.kind !== 'created') throw new Error('fixture project missing');
    const opened = await repo.load(teacher.tenantId, created.project.id, actor);
    if (!opened) throw new Error('fixture draft missing');
    const request = {
      cookies: { asa_session: token },
      headers: {},
      raw: { socket: { remoteAddress: '127.0.0.1' } },
    } as unknown as FastifyRequest;
    const controller = new ProductAnalyticsV2Controller(service);
    const body = {
      schemaVersion: 2,
      eventId: crypto.randomUUID(),
      eventType: 'visit.observed',
      actorExpectation: { kind: 'account', accountId: identity.account_id, workspaceId: workspace },
      visitId: crypto.randomUUID(),
      clientOccurredAt: new Date().toISOString(),
      entryRoute: 'home',
      referrerOrigin: null,
    };
    const held = await isolated.connect();
    const requests = Array.from({ length: 16 }, () =>
      controller.events(request, { ...body, eventId: crypto.randomUUID() }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
    );
    try {
      for (let n = 0; n < 50 && isolated.waitingCount !== 1; n++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(isolated.waitingCount).toBe(1);
      expect(service.queue.inFlight).toBe(1);
      expect(service.queue.pending).toBe(15);
      // Actual critical login/session SQL and actual draft mutation, not SELECT 1.
      const loginHash = hashSessionToken(crypto.randomUUID());
      await main.query('SELECT session_v2_create($1,$2,$3,12,NULL)', [
        identity.principal_id,
        workspace,
        loginHash,
      ]);
      expect(
        (await main.query('SELECT account_id FROM session_v2_context($1)', [loginHash])).rows[0]
          .account_id,
      ).toBe(identity.account_id);
      const changed = { ...document, isolationCheck: true };
      const saved = await repo.saveDraft({
        tenantId: teacher.tenantId,
        actor,
        projectId: created.project.id,
        document: changed,
        preview: null,
        baseRevision: opened.draft.revision,
        mutationId: crypto.randomUUID(),
      });
      expect(saved?.revision).toBe(opened.draft.revision + 1);
      expect(
        (await repo.load(teacher.tenantId, created.project.id, actor))?.draft.document,
      ).toEqual(changed);
      expect(main.waitingCount).toBe(0);
    } finally {
      held.release();
    }
    const results = await Promise.all(requests);
    for (const result of results) {
      if ('error' in result) expect(result.error.status).toBe(503);
      else expect(result.value).toMatchObject({ accepted: true, state: 'persisted' });
    }
    expect(results.some((result) => 'value' in result)).toBe(true);
    // No auth cache: committed revocation must deny the very next telemetry event.
    await main.query('SELECT session_v2_revoke($1)', [hash]);
    await expect(
      controller.events(request, { ...body, eventId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 401 });
  }, 30000);
});
