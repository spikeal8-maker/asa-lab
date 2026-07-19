import type pg from 'pg';
import type { TeachingContextPort } from '../application/ports.js';
import type { TeachingContext } from '../domain/types.js';

export class PgTeachingContext implements TeachingContextPort {
  constructor(private readonly pool: pg.Pool) {}

  async getActiveTeachingContext(
    tenantId: string,
    schoolId: string | null,
  ): Promise<TeachingContext | null> {
    const result = await this.pool.query(
      `SELECT p.school_id, p.id AS period_id
         FROM academic_periods p
        WHERE p.tenant_id = $1 AND p.is_active
          AND ($2::uuid IS NULL OR p.school_id = $2::uuid)
        ORDER BY p.starts_on DESC
        LIMIT 1`,
      [tenantId, schoolId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return { schoolId: row.school_id, academicPeriodId: row.period_id };
  }
}
