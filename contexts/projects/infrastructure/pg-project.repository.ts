import type pg from 'pg';
import { withTenantContext } from '@asa-lab/database';
import type { Project, ProjectDraft, ProjectVersion } from '../domain/project.js';
import type {
  CreateProjectInput,
  CreateProjectResult,
  ProjectRepositoryPort,
  SaveDraftInput,
} from '../application/ports.js';

interface ProjectRow {
  id: string;
  classroom_id: string;
  module_key: string;
  title: string;
  status: string;
  created_at: string;
  request_fingerprint?: string | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    moduleKey: row.module_key,
    title: row.title,
    status: row.status,
    createdAt: String(row.created_at),
  };
}

/** PostgreSQL project shell repository. Everything runs inside a tenant-scoped
 * transaction so forced RLS applies and the context clears on release. */
export class PgProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult> {
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      const owned = await client.query(
        `SELECT 1 FROM classrooms c
           JOIN classroom_memberships m
             ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
          WHERE c.tenant_id = $1 AND c.id = $2 AND m.user_id = $3 AND m.member_role = 'owner'`,
        [input.tenantId, input.classroomId, input.teacherId],
      );
      if (owned.rows.length === 0) {
        return { kind: 'classroom_not_found' };
      }
      const inserted = await client.query(
        `INSERT INTO projects
           (tenant_id, classroom_id, module_key, title, created_by, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING id, classroom_id, module_key, title, status, created_at`,
        [
          input.tenantId,
          input.classroomId,
          input.moduleKey,
          input.title,
          input.teacherId,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT id, classroom_id, module_key, title, status, created_at, request_fingerprint
             FROM projects
            WHERE tenant_id = $1 AND created_by = $2 AND idempotency_key = $3`,
          [input.tenantId, input.teacherId, input.idempotencyKey],
        );
        const row = existing.rows[0] as ProjectRow;
        if (row.request_fingerprint !== input.requestFingerprint) {
          return { kind: 'conflict' };
        }
        return { kind: 'existing', project: toProject(row) };
      }
      const project = toProject(inserted.rows[0] as ProjectRow);
      await client.query(
        `INSERT INTO project_drafts (project_id, tenant_id, document_json, updated_by)
         VALUES ($1, $2, $3, $4)`,
        [project.id, input.tenantId, JSON.stringify(input.initialDocument), input.teacherId],
      );
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'project', $3, 'project.created', $4)`,
        [
          input.tenantId,
          input.teacherId,
          project.id,
          JSON.stringify({ title: project.title, moduleKey: project.moduleKey }),
        ],
      );
      return { kind: 'created', project };
    });
  }

  async listForClassroom(
    tenantId: string,
    classroomId: string,
    teacherId: string,
  ): Promise<Project[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT p.id, p.classroom_id, p.module_key, p.title, p.status, p.created_at
           FROM projects p
           JOIN classroom_memberships m
             ON m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
          WHERE p.tenant_id = $1 AND p.classroom_id = $2 AND m.user_id = $3
            AND m.member_role = 'owner' AND p.status = 'active'
          ORDER BY p.created_at DESC`,
        [tenantId, classroomId, teacherId],
      );
      return (result.rows as ProjectRow[]).map(toProject);
    });
  }

  async load(
    tenantId: string,
    projectId: string,
    teacherId: string,
  ): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const found = await client.query(
        `SELECT p.id, p.classroom_id, p.module_key, p.title, p.status, p.created_at,
                d.document_json, d.revision, d.updated_at
           FROM projects p
           JOIN project_drafts d ON d.tenant_id = p.tenant_id AND d.project_id = p.id
           JOIN classroom_memberships m
             ON m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
          WHERE p.tenant_id = $1 AND p.id = $2 AND m.user_id = $3 AND m.member_role = 'owner'`,
        [tenantId, projectId, teacherId],
      );
      const row = found.rows[0];
      if (!row) {
        return null;
      }
      const versions = await client.query(
        `SELECT id, project_id, version_no, label, created_at
           FROM project_versions
          WHERE tenant_id = $1 AND project_id = $2
          ORDER BY version_no DESC`,
        [tenantId, projectId],
      );
      return {
        project: toProject(row as ProjectRow),
        draft: {
          projectId,
          document: row.document_json,
          revision: row.revision,
          updatedAt: String(row.updated_at),
        },
        versions: versions.rows.map((version) => ({
          id: version.id,
          projectId: version.project_id,
          versionNo: version.version_no,
          label: version.label ?? null,
          createdAt: String(version.created_at),
        })),
      };
    });
  }

  async saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null> {
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      const owned = await client.query(
        `SELECT 1 FROM projects p
           JOIN classroom_memberships m
             ON m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
          WHERE p.tenant_id = $1 AND p.id = $2 AND m.user_id = $3 AND m.member_role = 'owner'`,
        [input.tenantId, input.projectId, input.teacherId],
      );
      if (owned.rows.length === 0) {
        return null;
      }
      const updated = await client.query(
        `UPDATE project_drafts
            SET document_json = $3, revision = revision + 1, updated_at = now(), updated_by = $4
          WHERE tenant_id = $1 AND project_id = $2
        RETURNING project_id, document_json, revision, updated_at`,
        [input.tenantId, input.projectId, JSON.stringify(input.document), input.teacherId],
      );
      const row = updated.rows[0];
      if (!row) {
        return null;
      }
      return {
        projectId: row.project_id,
        document: row.document_json,
        revision: row.revision,
        updatedAt: String(row.updated_at),
      };
    });
  }

  async createCheckpoint(
    tenantId: string,
    projectId: string,
    teacherId: string,
    label: string | null,
  ): Promise<ProjectVersion | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const draft = await client.query(
        `SELECT d.document_json
           FROM project_drafts d
           JOIN projects p ON p.tenant_id = d.tenant_id AND p.id = d.project_id
           JOIN classroom_memberships m
             ON m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
          WHERE d.tenant_id = $1 AND d.project_id = $2 AND m.user_id = $3
            AND m.member_role = 'owner'
          FOR UPDATE OF d`,
        [tenantId, projectId, teacherId],
      );
      if (draft.rows.length === 0) {
        return null;
      }
      const inserted = await client.query(
        `INSERT INTO project_versions (tenant_id, project_id, version_no, document_json, label, created_by)
         SELECT $1, $2,
                COALESCE(MAX(version_no), 0) + 1,
                $3::jsonb, $4, $5
           FROM project_versions
          WHERE tenant_id = $1 AND project_id = $2
        RETURNING id, project_id, version_no, label, created_at`,
        [tenantId, projectId, JSON.stringify(draft.rows[0].document_json), label, teacherId],
      );
      const row = inserted.rows[0];
      await client.query(
        `INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'project', $3, 'project.checkpoint_created', $4)`,
        [tenantId, teacherId, projectId, JSON.stringify({ versionNo: row.version_no })],
      );
      return {
        id: row.id,
        projectId: row.project_id,
        versionNo: row.version_no,
        label: row.label ?? null,
        createdAt: String(row.created_at),
      };
    });
  }
}
