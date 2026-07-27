import type pg from 'pg';
import type { ClassroomPreview, JoinCodeDirectoryPort } from '../application/join-code.ports.js';

/**
 * Resolution goes through a narrow SECURITY DEFINER function: the visitor has
 * no tenant context yet, and the function returns only the two fields the
 * confirmation screen shows.
 */
export class PgJoinCodeDirectory implements JoinCodeDirectoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async resolve(normalizedCode: string): Promise<ClassroomPreview | null> {
    const result = await this.pool.query(
      `SELECT classroom_id, title, educator_display_name FROM classroom_resolve_join_code($1)`,
      [normalizedCode],
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
