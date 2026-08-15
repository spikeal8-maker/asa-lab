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
  age_band: '6-8' | '9-10' | '11-12' | '13-15' | '16-18' | 'mixed';
  topic_keys: string[];
  safe_mode_default: boolean;
  student_count?: number | string | null;
  join_code_version?: number | string | null;
  join_code_status?: 'active' | 'revoked' | null;
  created_at: string;
  request_fingerprint?: string | null;
}

function toClassroom(row: ClassroomRow): Classroom {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    ageBand: row.age_band,
    topicKeys: row.topic_keys ?? [],
    safeModeDefault: row.safe_mode_default,
    studentCount: Number(row.student_count ?? 0),
    joinCodeVersion:
      row.join_code_version === null || row.join_code_version === undefined
        ? null
        : Number(row.join_code_version),
    joinCodeStatus: row.join_code_status ?? null,
    createdAt: String(row.created_at),
  };
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
           (id, tenant_id, school_id, academic_period_id, title, age_band, topic_keys,
            safe_mode_default, created_by, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING id, title, status, age_band, topic_keys, safe_mode_default, created_at`,
        [
          input.classroomId,
          input.tenantId,
          input.schoolId,
          input.academicPeriodId,
          input.title,
          input.ageBand,
          input.topicKeys,
          input.safeModeDefault,
          input.teacherId,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT c.id, c.title, c.status, c.age_band, c.topic_keys, c.safe_mode_default,
                  c.created_at, c.request_fingerprint,
                  jc.version AS join_code_version, jc.status AS join_code_status,
                  (SELECT count(*) FROM classroom_student_seats s
                    WHERE s.tenant_id = c.tenant_id AND s.classroom_id = c.id
                      AND s.status <> 'removed') AS student_count
             FROM classrooms c
             LEFT JOIN LATERAL (
               SELECT code.version, code.status
                 FROM classroom_join_codes code
                WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
                ORDER BY code.version DESC
                LIMIT 1
             ) jc ON true
            WHERE c.tenant_id = $1 AND c.created_by = $2 AND c.idempotency_key = $3`,
          [input.tenantId, input.teacherId, input.idempotencyKey],
        );
        const row = existing.rows[0] as ClassroomRow;
        if (row.request_fingerprint !== input.requestFingerprint) {
          return { kind: 'conflict' };
        }
        return { kind: 'existing', classroom: toClassroom(row) };
      }
      const classroom: Classroom = {
        ...toClassroom(inserted.rows[0] as ClassroomRow),
        joinCodeVersion: 1,
        joinCodeStatus: 'active',
      };
      await client.query(
        `INSERT INTO classroom_join_codes
           (tenant_id, classroom_id, token_hash, version, status)
         VALUES ($1, $2, $3, 1, 'active')`,
        [input.tenantId, classroom.id, input.joinCodeHash],
      );
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
        `SELECT c.id, c.title, c.status, c.age_band, c.topic_keys, c.safe_mode_default,
                c.created_at, jc.version AS join_code_version,
                jc.status AS join_code_status,
                count(s.id) FILTER (WHERE s.status <> 'removed') AS student_count
           FROM classrooms c
           JOIN classroom_memberships m
             ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
           LEFT JOIN LATERAL (
             SELECT code.version, code.status
               FROM classroom_join_codes code
              WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
              ORDER BY code.version DESC
              LIMIT 1
           ) jc ON true
           LEFT JOIN classroom_student_seats s
             ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
          WHERE c.tenant_id = $1 AND m.user_id = $2 AND m.member_role = 'owner'
            AND c.status = 'active'
          GROUP BY c.id, jc.version, jc.status
          ORDER BY c.created_at DESC`,
        [tenantId, teacherId],
      );
      return (result.rows as ClassroomRow[]).map(toClassroom);
    });
  }
}
