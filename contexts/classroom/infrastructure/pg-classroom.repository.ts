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
  awaiting_review?: number | string | null;
  join_code_version?: number | string | null;
  join_code_status?: 'active' | 'revoked' | null;
  teacher_role?: 'owner' | 'co_teacher' | null;
  workspace_kind?: 'personal' | 'organization' | null;
  workspace_title?: string | null;
  created_at: string;
  archived_at?: string | Date | null;
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
    // Сдано и ещё не отвечено: счётчик проверки в списке классов.
    awaitingReview: Number(row.awaiting_review ?? 0),
    joinCodeVersion:
      row.join_code_version === null || row.join_code_version === undefined
        ? null
        : Number(row.join_code_version),
    joinCodeStatus: row.join_code_status ?? null,
    teacherRole: row.teacher_role ?? 'owner',
    workspaceKind: row.workspace_kind ?? 'organization',
    workspaceTitle: row.workspace_title ?? 'Школа',
    createdAt: String(row.created_at),
    archivedAt:
      row.archived_at === null || row.archived_at === undefined
        ? null
        : row.archived_at instanceof Date
          ? row.archived_at.toISOString()
          : String(row.archived_at),
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
        `INSERT INTO classroom_memberships
           (tenant_id, classroom_id, user_id, account_id, member_role)
         VALUES ($1, $2, $3, $4, 'owner')`,
        [input.tenantId, classroom.id, input.teacherId, input.accountId],
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'classroom', $3, 'classroom.created', $4)`,
        [input.tenantId, input.teacherId, classroom.id, JSON.stringify({ title: classroom.title })],
      );
      return { kind: 'created', classroom };
    });
  }

  async listForAccount(accountId: string): Promise<Classroom[]> {
    const result = await this.pool.query(
      `SELECT id, title, status, age_band, topic_keys, safe_mode_default,
              created_at, archived_at, join_code_version, join_code_status, student_count,
              awaiting_review, teacher_role, workspace_kind, workspace_title
         FROM classroom_list_for_account($1)`,
      [accountId],
    );
    return (result.rows as ClassroomRow[]).map(toClassroom);
  }
}
