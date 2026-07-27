import type pg from 'pg';
import { withTenantContext } from '@asa-lab/database';
import type { Project, ProjectDraft, ProjectScope, ProjectVersion } from '../domain/project.js';
import type { CreateProjectInput, CreateProjectResult, ProjectListFilter, ProjectRepositoryPort, SaveDraftInput } from '../application/ports.js';

interface ProjectRow {
  id: string;
  project_scope: ProjectScope;
  classroom_id: string | null;
  module_key: string;
  title: string;
  status: string;
  created_at: string;
  request_fingerprint?: string | null;
}
function toProject(row: ProjectRow): Project {
  return { id: row.id, scope: row.project_scope, classroomId: row.classroom_id, moduleKey: row.module_key, title: row.title, status: row.status, createdAt: String(row.created_at) };
}
const ACCESS_SQL = `((p.project_scope = 'personal' AND p.created_by = $3) OR (p.project_scope = 'classroom' AND EXISTS (SELECT 1 FROM classroom_memberships m WHERE m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id AND m.user_id = $3 AND m.member_role = 'owner')))`;

export class PgProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult> {
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      if (input.scope === 'classroom') {
        const owned = await client.query(`SELECT 1 FROM classrooms c JOIN classroom_memberships m ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id WHERE c.tenant_id = $1 AND c.id = $2 AND m.user_id = $3 AND m.member_role = 'owner'`, [input.tenantId, input.classroomId, input.teacherId]);
        if (owned.rows.length === 0) return { kind: 'classroom_not_found' };
      }
      const inserted = await client.query(
        `INSERT INTO projects (tenant_id, project_scope, classroom_id, module_key, title, created_by, idempotency_key, request_fingerprint) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id, project_scope, classroom_id, module_key, title, status, created_at`,
        [input.tenantId, input.scope, input.classroomId, input.moduleKey, input.title, input.teacherId, input.idempotencyKey, input.requestFingerprint],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(`SELECT id, project_scope, classroom_id, module_key, title, status, created_at, request_fingerprint FROM projects WHERE tenant_id = $1 AND created_by = $2 AND idempotency_key = $3`, [input.tenantId, input.teacherId, input.idempotencyKey]);
        const row = existing.rows[0] as ProjectRow | undefined;
        if (!row || row.request_fingerprint !== input.requestFingerprint) return { kind: 'conflict' };
        return { kind: 'existing', project: toProject(row) };
      }
      const project = toProject(inserted.rows[0] as ProjectRow);
      await client.query(`INSERT INTO project_drafts (project_id, tenant_id, document_json, updated_by) VALUES ($1,$2,$3,$4)`, [project.id, input.tenantId, JSON.stringify(input.initialDocument), input.teacherId]);
      await client.query(`INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json) VALUES ($1,$2,'project',$3,'project.created',$4)`, [input.tenantId, input.teacherId, project.id, JSON.stringify({ title: project.title, moduleKey: project.moduleKey, scope: project.scope, classroomId: project.classroomId })]);
      return { kind: 'created', project };
    });
  }

  async listForTeacher(tenantId: string, teacherId: string, filter: ProjectListFilter): Promise<Project[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      if (filter.scope === 'personal') {
        const result = await client.query(`SELECT id, project_scope, classroom_id, module_key, title, status, created_at FROM projects WHERE tenant_id = $1 AND project_scope = 'personal' AND created_by = $2 AND status = 'active' ORDER BY created_at DESC`, [tenantId, teacherId]);
        return (result.rows as ProjectRow[]).map(toProject);
      }
      if (filter.scope === 'classroom' && filter.classroomId) {
        const result = await client.query(`SELECT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at FROM projects p JOIN classroom_memberships m ON m.tenant_id=p.tenant_id AND m.classroom_id=p.classroom_id WHERE p.tenant_id=$1 AND p.project_scope='classroom' AND p.classroom_id=$2 AND m.user_id=$3 AND m.member_role='owner' AND p.status='active' ORDER BY p.created_at DESC`, [tenantId, filter.classroomId, teacherId]);
        return (result.rows as ProjectRow[]).map(toProject);
      }
      const result = await client.query(`SELECT DISTINCT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at FROM projects p LEFT JOIN classroom_memberships m ON m.tenant_id=p.tenant_id AND m.classroom_id=p.classroom_id AND m.user_id=$2 AND m.member_role='owner' WHERE p.tenant_id=$1 AND p.status='active' AND ((p.project_scope='personal' AND p.created_by=$2) OR (p.project_scope='classroom' AND m.user_id IS NOT NULL)) ORDER BY p.created_at DESC`, [tenantId, teacherId]);
      return (result.rows as ProjectRow[]).map(toProject);
    });
  }

  async load(tenantId: string, projectId: string, teacherId: string): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const found = await client.query(`SELECT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,d.document_json,d.revision,d.updated_at FROM projects p JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id WHERE p.tenant_id=$1 AND p.id=$2 AND ${ACCESS_SQL}`, [tenantId, projectId, teacherId]);
      const row = found.rows[0];
      if (!row) return null;
      const versions = await client.query(`SELECT id, project_id, version_no, label, created_at FROM project_versions WHERE tenant_id=$1 AND project_id=$2 ORDER BY version_no DESC`, [tenantId, projectId]);
      return { project: toProject(row as ProjectRow), draft: { projectId, document: row.document_json, revision: row.revision, updatedAt: String(row.updated_at) }, versions: versions.rows.map((version: { id: string; project_id: string; version_no: number; label: string | null; created_at: string }) => ({ id: version.id, projectId: version.project_id, versionNo: version.version_no, label: version.label ?? null, createdAt: String(version.created_at) })) };
    });
  }

  async rename(tenantId: string, projectId: string, teacherId: string, title: string): Promise<Project | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const updated = await client.query(`UPDATE projects p SET title=$4 WHERE p.tenant_id=$1 AND p.id=$2 AND ${ACCESS_SQL} RETURNING id,project_scope,classroom_id,module_key,title,status,created_at`, [tenantId, projectId, teacherId, title]);
      const row = updated.rows[0] as ProjectRow | undefined;
      if (!row) return null;
      await client.query(`INSERT INTO audit_events (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json) VALUES ($1,$2,'project',$3,'project.renamed',$4)`, [tenantId, teacherId, projectId, JSON.stringify({ title })]);
      return toProject(row);
    });
  }

  async saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null> {
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      const updated = await client.query(`UPDATE project_drafts d SET document_json=$4,revision=revision+1,updated_at=now(),updated_by=$3 FROM projects p WHERE d.tenant_id=$1 AND d.project_id=$2 AND p.tenant_id=d.tenant_id AND p.id=d.project_id AND ${ACCESS_SQL} RETURNING d.project_id,d.document_json,d.revision,d.updated_at`, [input.tenantId, input.projectId, input.teacherId, JSON.stringify(input.document)]);
      const row = updated.rows[0];
      return row ? { projectId: row.project_id, document: row.document_json, revision: row.revision, updatedAt: String(row.updated_at) } : null;
    });
  }

  async createCheckpoint(tenantId: string, projectId: string, teacherId: string, label: string | null): Promise<ProjectVersion | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const draft = await client.query(`SELECT d.document_json FROM project_drafts d JOIN projects p ON p.tenant_id=d.tenant_id AND p.id=d.project_id WHERE d.tenant_id=$1 AND d.project_id=$2 AND ${ACCESS_SQL} FOR UPDATE OF d`, [tenantId, projectId, teacherId]);
      if (draft.rows.length === 0) return null;
      const inserted = await client.query(`INSERT INTO project_versions (tenant_id,project_id,version_no,document_json,label,created_by) SELECT $1,$2,COALESCE(MAX(version_no),0)+1,$3::jsonb,$4,$5 FROM project_versions WHERE tenant_id=$1 AND project_id=$2 RETURNING id,project_id,version_no,label,created_at`, [tenantId, projectId, JSON.stringify(draft.rows[0].document_json), label, teacherId]);
      const row = inserted.rows[0];
      await client.query(`INSERT INTO audit_events (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json) VALUES ($1,$2,'project',$3,'project.checkpoint_created',$4)`, [tenantId, teacherId, projectId, JSON.stringify({ versionNo: row.version_no })]);
      return { id: row.id, projectId: row.project_id, versionNo: row.version_no, label: row.label ?? null, createdAt: String(row.created_at) };
    });
  }
}
