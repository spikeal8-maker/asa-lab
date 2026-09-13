import type pg from 'pg';
import type {
  AccountSessionRef,
  ActiveContext,
  SessionV2StorePort,
} from '../application/account.ports.js';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class PgSessionV2Store implements SessionV2StorePort {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    principalId: string,
    workspaceId: string,
    tokenHash: string,
    ttlHours: number,
    userAgentSummary?: string,
  ): Promise<void> {
    await this.pool.query(`SELECT session_v2_create($1, $2, $3, $4, $5)`, [
      principalId,
      workspaceId,
      tokenHash,
      ttlHours,
      userAgentSummary ?? null,
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

  async switchContext(
    tokenHash: string,
    workspaceId: string,
  ): Promise<'switched' | 'unauthorized' | 'forbidden'> {
    const result = await this.pool.query(`SELECT session_v2_switch_context($1, $2) AS result`, [
      tokenHash,
      workspaceId,
    ]);
    return result.rows[0]?.result ?? 'unauthorized';
  }

  async list(tokenHash: string): Promise<AccountSessionRef[]> {
    const result = await this.pool.query(
      `SELECT id, created_at, last_seen_at, expires_at, current, user_agent_summary
         FROM session_v2_list($1)`,
      [tokenHash],
    );
    return result.rows.map((row) => ({
      id: row.id,
      createdAt: iso(row.created_at),
      lastSeenAt: iso(row.last_seen_at),
      expiresAt: iso(row.expires_at),
      current: row.current === true,
      userAgentSummary: typeof row.user_agent_summary === 'string' ? row.user_agent_summary : null,
    }));
  }

  async revokeById(
    tokenHash: string,
    sessionId: string,
  ): Promise<'revoked' | 'unauthorized' | 'current_session' | 'not_found'> {
    const result = await this.pool.query(`SELECT session_v2_revoke_by_id($1, $2) AS result`, [
      tokenHash,
      sessionId,
    ]);
    return result.rows[0]?.result ?? 'unauthorized';
  }

  async revokeOthers(tokenHash: string): Promise<number> {
    const result = await this.pool.query(`SELECT session_v2_revoke_others($1) AS count`, [
      tokenHash,
    ]);
    return Number(result.rows[0]?.count ?? -1);
  }
}
