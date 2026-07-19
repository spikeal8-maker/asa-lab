import type pg from 'pg';
import type {
  SessionContext,
  SessionStorePort,
  SessionUser,
  TenantLocatorPort,
  UserDirectoryPort,
} from '../application/ports.js';

/** PostgreSQL adapters for the identity ports. Every tenant-owned query
 * carries an explicit tenant predicate. */
export class PgTenantLocator implements TenantLocatorPort {
  constructor(private readonly pool: pg.Pool) {}

  async findTenantIdBySlug(slug: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT id FROM tenants WHERE workspace_slug = $1 AND status = 'active'`,
      [slug],
    );
    return result.rows[0]?.id ?? null;
  }
}

export class PgUserDirectory implements UserDirectoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async findActiveTeacherByEmail(
    tenantId: string,
    emailLower: string,
  ): Promise<SessionUser | null> {
    const result = await this.pool.query(
      `SELECT id, email, display_name, school_id, password_hash
         FROM users
        WHERE tenant_id = $1 AND lower(email) = $2 AND role = 'teacher' AND status = 'active'
        LIMIT 1`,
      [tenantId, emailLower],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      schoolId: row.school_id ?? null,
      passwordHash: row.password_hash,
    };
  }
}

export class PgSessionStore implements SessionStorePort {
  constructor(private readonly pool: pg.Pool) {}

  async create(
    tenantId: string,
    userId: string,
    tokenHash: string,
    ttlHours: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
      [tenantId, userId, tokenHash, String(ttlHours)],
    );
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  async resolve(tokenHash: string): Promise<SessionContext | null> {
    const result = await this.pool.query(
      `SELECT s.tenant_id, s.user_id, u.email, u.display_name, u.school_id
         FROM sessions s
         JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.status = 'active'
        LIMIT 1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      schoolId: row.school_id ?? null,
    };
  }
}
