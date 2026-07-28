import type pg from 'pg';
import type { ActiveContext, SessionV2StorePort } from '../application/account.ports.js';

/**
 * Principal-bound sessions.
 *
 * The active workspace lives in the session row, so every request derives its
 * tenant from the server side of the connection and never from the browser.
 */
export class PgSessionV2Store implements SessionV2StorePort {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    principalId: string,
    workspaceId: string,
    tokenHash: string,
    ttlHours: number,
  ): Promise<void> {
    await this.pool.query(`SELECT session_v2_create($1, $2, $3, $4)`, [
      principalId,
      workspaceId,
      tokenHash,
      ttlHours,
    ]);
  }

  async resolve(tokenHash: string): Promise<ActiveContext | null> {
    const result = await this.pool.query(
      `SELECT principal_id, account_id, workspace_id, tenant_id, workspace_kind,
              user_id, email, display_name, school_id
         FROM session_v2_context($1)`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          principalId: row.principal_id,
          accountId: row.account_id,
          workspaceId: row.workspace_id,
          workspaceKind: row.workspace_kind,
          tenantId: row.tenant_id,
          userId: row.user_id ?? null,
          email: row.email,
          displayName: row.display_name,
          schoolId: row.school_id ?? null,
        }
      : null;
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.pool.query(`SELECT session_v2_revoke($1)`, [tokenHash]);
  }
}
