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
      `SELECT classroom_id, tenant_id, title, educator_display_name, code_version
         FROM classroom_resolve_join_digest($1)`,
      [lookupDigest],
    );
    return this.toPreview(result.rows[0]);
  }

  async isVersionActive(classroomId: string, version: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT classroom_join_code_version_active($1, $2) AS active`,
      [classroomId, version],
    );
    return result.rows[0]?.active === true;
  }

  async previewById(classroomId: string): Promise<ClassroomPreview | null> {
    const result = await this.pool.query(
      `SELECT classroom_id, tenant_id, title, educator_display_name, code_version
         FROM classroom_preview_by_id($1)`,
      [classroomId],
    );
    return this.toPreview(result.rows[0]);
  }

  async activeCodeCount(): Promise<number> {
    const result = await this.pool.query(`SELECT classroom_active_join_code_count() AS n`);
    return result.rows[0]?.n ?? 0;
  }

  private toPreview(row: Record<string, unknown> | undefined): ClassroomPreview | null {
    return row
      ? {
          classroomId: row['classroom_id'] as string,
          tenantId: row['tenant_id'] as string,
          title: row['title'] as string,
          educatorDisplayName: row['educator_display_name'] as string,
          codeVersion: row['code_version'] as number,
        }
      : null;
  }
}
