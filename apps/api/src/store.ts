import pg from 'pg';
import { hashSessionToken } from './security.js';

/** Data access for the first classroom slice. Every tenant-owned query carries
 * an explicit tenant predicate; tenant context always comes from the session
 * row on the server, never from client-controlled input. */

export interface AuthenticatedContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  readonly displayName: string;
  readonly email: string;
  readonly schoolId: string | null;
  readonly sessionId: string;
}

export interface ClassroomRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly created_at: string;
}

export function createPool(databaseUrl = process.env['DATABASE_URL']): pg.Pool {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return new pg.Pool({ connectionString: databaseUrl, max: 5 });
}

export async function findUserForLogin(
  pool: pg.Pool,
  workspace: string,
  email: string,
): Promise<{ id: string; tenant_id: string; password_hash: string; status: string } | null> {
  // The workspace slug is only a LOCATOR during authentication: it selects the
  // tenant whose user list is searched. It is never an authorization context —
  // after login the tenant always comes from the server-side session row.
  // E-mail comparison is case-insensitive (unique per tenant via lower(email)).
  const result = await pool.query(
    `SELECT u.id, u.tenant_id, u.password_hash, u.status
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
      WHERE t.slug = $1 AND lower(u.email) = lower($2)
      LIMIT 1`,
    [workspace, email],
  );
  return result.rows[0] ?? null;
}

export async function createSession(
  pool: pg.Pool,
  input: { tenantId: string; userId: string; token: string; ttlHours?: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [input.tenantId, input.userId, hashSessionToken(input.token), String(input.ttlHours ?? 12)],
  );
}

export async function revokeSession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSessionToken(token)],
  );
}

/** Resolve the server-side tenant context from a session token. */
export async function resolveContext(
  pool: pg.Pool,
  token: string,
): Promise<AuthenticatedContext | null> {
  const result = await pool.query(
    `SELECT s.id AS session_id, s.tenant_id, s.user_id,
            u.role, u.display_name, u.email, u.school_id
       FROM sessions s
       JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'
      LIMIT 1`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
    schoolId: row.school_id ?? null,
    sessionId: row.session_id,
  };
}

export async function createClassroom(
  pool: pg.Pool,
  context: AuthenticatedContext,
  title: string,
): Promise<ClassroomRow> {
  if (context.schoolId === null) {
    throw new Error('teacher has no school');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO classrooms (tenant_id, school_id, teacher_id, title)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, status, created_at`,
      [context.tenantId, context.schoolId, context.userId, title.trim()],
    );
    const classroom = inserted.rows[0] as ClassroomRow;
    await client.query(
      `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
       VALUES ($1, $2, 'classroom', $3, 'classroom.created', $4)`,
      [context.tenantId, context.userId, classroom.id, JSON.stringify({ title: classroom.title })],
    );
    await client.query('COMMIT');
    return classroom;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listClassrooms(
  pool: pg.Pool,
  context: AuthenticatedContext,
): Promise<ClassroomRow[]> {
  const result = await pool.query(
    `SELECT id, title, status, created_at
       FROM classrooms
      WHERE tenant_id = $1 AND teacher_id = $2 AND status = 'active'
      ORDER BY created_at DESC`,
    [context.tenantId, context.userId],
  );
  return result.rows as ClassroomRow[];
}
