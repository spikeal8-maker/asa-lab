import type pg from 'pg';
import { withTenantContext } from '@asa-lab/database';
import type { TeachingContextPort } from '../application/ports.js';
import type { TeachingContext } from '../domain/types.js';

/** Runs under the verified tenant context (schools/academic_periods are under
 * forced RLS); the school must belong to the session tenant and the active
 * period is selected strictly for that school. */
export class PgTeachingContext implements TeachingContextPort {
  constructor(private readonly pool: pg.Pool) {}

  async getActiveTeachingContext(
    tenantId: string,
    schoolId: string,
  ): Promise<TeachingContext | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT p.school_id, p.id AS period_id
           FROM academic_periods p
          WHERE p.tenant_id = $1 AND p.school_id = $2 AND p.is_active
          ORDER BY p.starts_on DESC
          LIMIT 1`,
        [tenantId, schoolId],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return { schoolId: row.school_id, academicPeriodId: row.period_id };
    });
  }
}
