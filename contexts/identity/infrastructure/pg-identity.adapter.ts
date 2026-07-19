import type pg from 'pg';
import type {
  SessionContext,
  SessionStorePort,
  SessionUser,
  TenantLocatorPort,
  UserDirectoryPort,
} from '../application/ports.js';

/** PostgreSQL adapters for the identity ports. The runtime role has no direct
 * grants on tenants/users/sessions: every identity operation goes through the
 * narrow SECURITY DEFINER auth_* functions installed by the migration. */
export class PgTenantLocator implements TenantLocatorPort {
  constructor(private readonly pool: pg.Pool) {}

  async findTenantIdBySlug(slug: string): Promise<string | null> {
    const result = await this.pool.query(`SELECT auth_lookup_tenant_id($1) AS id`, [slug]);
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
         FROM auth_find_active_teacher($1, $2)`,
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
    await this.pool.query(`SELECT auth_create_session($1, $2, $3, $4)`, [
      tenantId,
      userId,
      tokenHash,
      ttlHours,
    ]);
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.pool.query(`SELECT auth_revoke_session($1)`, [tokenHash]);
  }

  async resolve(tokenHash: string): Promise<SessionContext | null> {
    const result = await this.pool.query(
      `SELECT tenant_id, user_id, email, display_name, school_id
         FROM auth_resolve_session($1)`,
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
