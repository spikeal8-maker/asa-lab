import type pg from 'pg';
import { withTenantContext } from '@asa-lab/database';
import type { Classroom } from '../domain/classroom.js';
import type {
  ClassroomRepositoryPort,
  CreateClassroomInput,
  CreateWithOwnerResult,
} from '../application/ports.js';

interface ClassroomRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
  request_fingerprint?: string | null;
}

function toClassroom(row: ClassroomRow): Classroom {
  return { id: row.id, title: row.title, status: row.status, createdAt: String(row.created_at) };
}

/** PostgreSQL classroom repository. All statements run inside a tenant-scoped
 * transaction (SET LOCAL app.tenant_id), which both satisfies FORCE RLS and
 * guarantees the context clears before the connection returns to the pool.
 * Concurrency: the partial unique index on (tenant_id, created_by,
 * idempotency_key) makes the insert race-safe; the loser of the race reads the
 * committed row and compares fingerprints. */
export class PgClassroomRepository implements ClassroomRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async createWithOwner(input: CreateClassroomInput): Promise<CreateWithOwnerResult> {
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO classrooms
           (tenant_id, school_id, academic_period_id, title, created_by, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING id, title, status, created_at`,
        [
          input.tenantId,
          input.schoolId,
          input.academicPeriodId,
          input.title,
          input.teacherId,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT id, title, status, created_at, request_fingerprint FROM classrooms
            WHERE tenant_id = $1 AND created_by = $2 AND idempotency_key = $3`,
          [input.tenantId, input.teacherId, input.idempotencyKey],
        );
        const row = existing.rows[0] as ClassroomRow;
        if (row.request_fingerprint !== input.requestFingerprint) {
          return { kind: 'conflict' };
        }
        return { kind: 'existing', classroom: toClassroom(row) };
      }
      const classroom = toClassroom(inserted.rows[0] as ClassroomRow);
      await client.query(
        `INSERT INTO classroom_memberships (tenant_id, classroom_id, user_id, member_role)
         VALUES ($1, $2, $3, 'owner')`,
        [input.tenantId, classroom.id, input.teacherId],
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'classroom', $3, 'classroom.created', $4)`,
        [input.tenantId, input.teacherId, classroom.id, JSON.stringify({ title: classroom.title })],
      );
      return { kind: 'created', classroom };
    });
  }

  async listForTeacher(tenantId: string, teacherId: string): Promise<Classroom[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT c.id, c.title, c.status, c.created_at
           FROM classrooms c
           JOIN classroom_memberships m
             ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
          WHERE c.tenant_id = $1 AND m.user_id = $2 AND m.member_role = 'owner'
            AND c.status = 'active'
          ORDER BY c.created_at DESC`,
        [tenantId, teacherId],
      );
      return (result.rows as ClassroomRow[]).map(toClassroom);
    });
  }
}
