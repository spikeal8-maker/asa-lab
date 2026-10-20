import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { inject, type NestApp } from '../portal/app';
import type { storageContract } from './storage-contract';

/** Independent regression: all authorization and list SQL is real. The only
 * instrumentation delays delivery of an already executed admission SELECT until
 * the real teacher policy change has committed on another runtime operation.
 */
export function listRevocationContract(
  clients: () => { admin: pg.Pool; runtime: pg.Pool; app: NestApp },
  fixture: ReturnType<typeof storageContract>,
): void {
  for (const query of ['?scope=personal&module=chess', '?scope=personal'] as const) {
    it(`independent: committed revoke between admission and project list remains enforced ${query}`, async () => {
      const f = await fixture();
      const { runtime, app } = clients();
      const headers = { cookie: `asa_student_session=${f.token}` };
      const projects: Record<string, string> = {};
      for (const module of ['chess', 'checkers', 'electronics']) {
        const created = await inject(app, {
          method: 'POST',
          url: '/api/projects',
          headers: { ...headers, 'idempotency-key': randomUUID() },
          payload: { scope: 'personal', module, title: `Independent revoke ${module}` },
        });
        expect(created.statusCode, created.body).toBe(201);
        projects[module] = created.json<{ project: { id: string } }>().project.id;
      }

      const originalQuery = runtime.query.bind(runtime);
      let revokedAfterSnapshot = false;
      // The request path uses promise-based query(sql, values), with no callback.
      // Keep the pool's complete overload type at this one instrumentation seam.
      const interceptedQuery = (async (sql: string | pg.QueryConfig, values?: unknown[]) => {
        const result = await originalQuery(sql, values);
        const text = typeof sql === 'string' ? sql : sql.text;
        if (!revokedAfterSnapshot && text.includes('classroom_games_admission_snapshot')) {
          revokedAfterSnapshot = true;
          expect(result.rows[0]?.['data']).toMatchObject({
            eligible: true,
            state: 'active',
            mode: 'allow',
          });
          const changed = await f.write('class', {
            mode: 'deny',
            threshold: null,
            expectedVersion: 0,
          });
          expect(changed).toMatchObject({ mode: 'deny', version: 1 });
        }
        return result;
      }) as typeof runtime.query;
      const spy = vi.spyOn(runtime, 'query').mockImplementation(interceptedQuery);
      try {
        const response = await inject(app, {
          method: 'GET',
          url: `/api/projects${query}`,
          headers,
        });
        expect(revokedAfterSnapshot).toBe(true);
        if (query.includes('module=chess')) {
          expect(response.statusCode, response.body).toBe(403);
          expect(response.json()).toMatchObject({
            error: { code: 'games_access_denied', reason: 'class_disabled' },
          });
        } else {
          expect(response.statusCode, response.body).toBe(200);
          const ids = response.json<{ items: { id: string }[] }>().items.map((item) => item.id);
          expect(ids).toContain(projects['electronics']);
          expect(ids).not.toContain(projects['chess']);
          expect(ids).not.toContain(projects['checkers']);
        }
        expect(await f.read()).toMatchObject({ mode: 'deny', version: 1 });
      } finally {
        spy.mockRestore();
      }
    });
  }
}
