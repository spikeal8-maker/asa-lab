import type pg from 'pg';
import type {
  ClassroomPreview,
  IssuedJoinCode,
  JoinCodeDirectoryPort,
} from '../application/join-code.ports.js';

/**
 * Codes live behind narrow SECURITY DEFINER functions: the table itself is
 * unreachable for the runtime role, and a visitor resolving a code has no
 * tenant context for row-level security to work with.
 */
export class PgJoinCodeDirectory implements JoinCodeDirectoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async issue(
    tenantId: string,
    classroomId: string,
    lookupDigest: string,
  ): Promise<IssuedJoinCode> {
    const result = await this.pool.query(
      `SELECT join_code_id, version FROM classroom_issue_join_code($1, $2, $3)`,
      [tenantId, classroomId, lookupDigest],
    );
    const row = result.rows[0];
    return { joinCodeId: row.join_code_id, version: row.version };
  }

  async revoke(tenantId: string, classroomId: string): Promise<number> {
    const result = await this.pool.query(`SELECT classroom_revoke_join_code($1, $2) AS revoked`, [
      tenantId,
      classroomId,
    ]);
    return result.rows[0]?.revoked ?? 0;
  }

  async resolve(lookupDigest: string): Promise<ClassroomPreview | null> {
    const result = await this.pool.query(
      `SELECT classroom_id, title, educator_display_name FROM classroom_resolve_join_digest($1)`,
      [lookupDigest],
    );
    const row = result.rows[0];
    return row
      ? {
          classroomId: row.classroom_id,
          title: row.title,
          educatorDisplayName: row.educator_display_name,
        }
      : null;
  }
}
