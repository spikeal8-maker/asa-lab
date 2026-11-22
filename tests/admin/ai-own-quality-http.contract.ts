import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { buildTestApp, inject } from '../portal/app';
import { aiIdentity } from './ai-student-access.contract';
export function aiOwnQualityHttpContract(database: () => { admin: pg.Pool; runtime: pg.Pool }) {
  it('uses real Account sessions, explicit own-only HTTP grant, no-store and metadata audit without inference', async () => {
    const { admin, runtime } = database();
    const owner = await aiIdentity(admin),
      ordinary = await aiIdentity(admin);
    await admin.query(
      "UPDATE accounts SET email_verification_state='verified' WHERE id=ANY($1::uuid[])",
      [[owner.account_id, ordinary.account_id]],
    );
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
      [owner.account_id],
    );
    const session = async (who: typeof owner) => {
      const token = randomUUID();
      await admin.query(
        "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
        [who.principal_id, who.workspace_id, hashSessionToken(token)],
      );
      return { asa_session: token };
    };
    const cookies = await session(owner),
      ordinaryCookies = await session(ordinary);
    // The suite owns this database pool across cases; the app owns only its delegated lease.
    const appPool = {
      query: runtime.query.bind(runtime),
      ...(typeof runtime.connect === 'function' ? { connect: runtime.connect.bind(runtime) } : {}),
      end: async () => undefined,
    } as unknown as pg.Pool;
    const app = await buildTestApp(appPool);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('No upstream allowed during review read');
    });
    const headers = { host: '127.0.0.1:4610' };
    const url = '/api/admin/v1/ai/own-quality';
    try {
      expect(
        (await inject(app, { method: 'GET', url, headers, cookies: ordinaryCookies })).statusCode,
      ).toBe(403);
      expect((await inject(app, { method: 'GET', url, headers, cookies })).statusCode).toBe(403);
      const status = await inject(app, { method: 'GET', url: url + '/grant', headers, cookies });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ enabled: false, scope: 'own_personal' });
      expect(status.headers['cache-control']).toContain('no-store');
      const write = { enabled: true, expectedRevision: 0, requestId: randomUUID() };
      const enabled = await inject(app, {
        method: 'PUT',
        url: url + '/grant',
        headers,
        cookies,
        payload: write,
      });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json()).toMatchObject({ enabled: true, revision: 1 });
      expect(
        (
          await inject(app, {
            method: 'GET',
            url: url + '?owner=' + ordinary.principal_id,
            headers,
            cookies,
          })
        ).statusCode,
      ).toBe(400);
      const page = await inject(app, { method: 'GET', url, headers, cookies });
      expect(page.statusCode).toBe(200);
      expect(page.json()).toMatchObject({ items: [], scope: 'own_personal' });
      expect(page.headers['cache-control']).toContain('no-store');
      expect(
        (
          await inject(app, {
            method: 'PUT',
            url: url + '/grant',
            headers: { ...headers, origin: 'https://evil.test' },
            cookies,
            payload: { enabled: false, expectedRevision: 1, requestId: randomUUID() },
          })
        ).statusCode,
      ).toBe(403);
      const revoked = await inject(app, {
        method: 'PUT',
        url: url + '/grant',
        headers,
        cookies,
        payload: { enabled: false, expectedRevision: 1, requestId: randomUUID() },
      });
      expect(revoked.statusCode).toBe(200);
      expect((await inject(app, { method: 'GET', url, headers, cookies })).statusCode).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      await app.close();
    }
  }, 30000);
}
