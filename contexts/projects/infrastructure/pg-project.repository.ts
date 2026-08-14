import type pg from 'pg';
import { withTenantContext } from '@asa-lab/database';
import type {
  Project,
  ProjectDraft,
  ProjectScope,
  ProjectStatus,
  ProjectVersion,
} from '../domain/project.js';
import type {
  CreateProjectInput,
  CreateProjectResult,
  ProjectActor,
  ProjectListFilter,
  ProjectRepositoryPort,
  SaveDraftInput,
} from '../application/ports.js';

interface ProjectRow {
  id: string;
  project_scope: ProjectScope;
  classroom_id: string | null;
  module_key: string;
  title: string;
  status: ProjectStatus;
  created_at: string;
  updated_at?: string;
  request_fingerprint?: string | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    scope: row.project_scope,
    classroomId: row.classroom_id,
    moduleKey: row.module_key,
    title: row.title,
    status: row.status,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

const ACCESS_SQL = `(
  (p.project_scope = 'personal'
     AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $3)
          OR ($4::uuid IS NOT NULL AND p.created_by = $4)))
  OR (p.project_scope = 'classroom' AND $4::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM classroom_memberships m
         WHERE m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
           AND m.user_id = $4 AND m.member_role = 'owner'))
)`;

export class PgProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  private async projectTenant(
    activeTenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<string | null> {
    if (actor.userId !== null) return activeTenantId;
    const result = await this.pool.query(
      `SELECT project_tenant_for_principal($1, $2) AS tenant_id`,
      [actor.principalId, projectId],
    );
    return (result.rows[0]?.tenant_id as string | null | undefined) ?? null;
  }

  async createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult> {
    const { principalId, userId } = input.actor;
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      if (input.scope === 'classroom') {
        if (userId === null) return { kind: 'classroom_not_found' };
        const owned = await client.query(
          `SELECT 1
             FROM classrooms c
             JOIN classroom_memberships m
               ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
            WHERE c.tenant_id = $1 AND c.id = $2
              AND m.user_id = $3 AND m.member_role = 'owner'`,
          [input.tenantId, input.classroomId, userId],
        );
        if (owned.rows.length === 0) return { kind: 'classroom_not_found' };
      }
      const conflictTarget =
        userId === null
          ? `(tenant_id, owner_principal_id, idempotency_key)
             WHERE idempotency_key IS NOT NULL AND owner_principal_id IS NOT NULL`
          : `(tenant_id, created_by, idempotency_key)
             WHERE idempotency_key IS NOT NULL`;
      const inserted = await client.query(
        `INSERT INTO projects
           (tenant_id, project_scope, classroom_id, module_key, title,
            created_by, owner_principal_id, idempotency_key, request_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ${conflictTarget} DO NOTHING
         RETURNING id, project_scope, classroom_id, module_key, title, status, created_at`,
        [
          input.tenantId,
          input.scope,
          input.classroomId,
          input.moduleKey,
          input.title,
          userId,
          principalId,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT id, project_scope, classroom_id, module_key, title,
                  status, created_at, request_fingerprint
             FROM projects
            WHERE tenant_id = $1 AND idempotency_key = $2
              AND ((owner_principal_id IS NOT NULL AND owner_principal_id = $3)
                   OR ($4::uuid IS NOT NULL AND created_by = $4))`,
          [input.tenantId, input.idempotencyKey, principalId, userId],
        );
        const row = existing.rows[0] as ProjectRow | undefined;
        if (!row || row.request_fingerprint !== input.requestFingerprint) {
          return { kind: 'conflict' };
        }
        return { kind: 'existing', project: toProject(row) };
      }
      const project = toProject(inserted.rows[0] as ProjectRow);
      await client.query(
        `INSERT INTO project_drafts
           (project_id, tenant_id, document_json, updated_by, updated_by_principal_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [project.id, input.tenantId, JSON.stringify(input.initialDocument), userId, principalId],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1,$2,'project',$3,'project.created',$4)`,
        [
          input.tenantId,
          userId,
          project.id,
          JSON.stringify({
            title: project.title,
            moduleKey: project.moduleKey,
            scope: project.scope,
            classroomId: project.classroomId,
            actorPrincipalId: principalId,
          }),
        ],
      );
      return { kind: 'created', project };
    });
  }

  async listForActor(
    tenantId: string,
    actor: ProjectActor,
    filter: ProjectListFilter,
  ): Promise<Project[]> {
    const status = filter.status ?? 'active';
    if (actor.userId === null) {
      if (filter.scope === 'classroom' || filter.classroomId) return [];
      return withTenantContext(this.pool, tenantId, async (client) => {
        const result = await client.query(
          `SELECT p.id, p.project_scope, p.classroom_id, p.module_key, p.title,
                  p.status, p.created_at, d.updated_at
             FROM projects p
             JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
            WHERE p.tenant_id=$1 AND p.owner_principal_id=$2
              AND p.project_scope='personal' AND p.status=$3
            ORDER BY d.updated_at DESC`,
          [tenantId, actor.principalId, status],
        );
        return (result.rows as ProjectRow[]).map(toProject);
      });
    }
    return withTenantContext(this.pool, tenantId, async (client) => {
      if (filter.scope === 'personal') {
        const result = await client.query(
          `SELECT p.id, p.project_scope, p.classroom_id, p.module_key, p.title,
                  p.status, p.created_at, d.updated_at
             FROM projects p
             JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
            WHERE p.tenant_id = $1 AND p.project_scope = 'personal' AND p.status = $4
              AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $2)
                   OR p.created_by = $3)
            ORDER BY d.updated_at DESC`,
          [tenantId, actor.principalId, actor.userId, status],
        );
        return (result.rows as ProjectRow[]).map(toProject);
      }
      if (filter.scope === 'classroom' && filter.classroomId) {
        const result = await client.query(
          `SELECT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,
                  d.updated_at
             FROM projects p
             JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
             JOIN classroom_memberships m
               ON m.tenant_id=p.tenant_id AND m.classroom_id=p.classroom_id
            WHERE p.tenant_id=$1 AND p.project_scope='classroom'
              AND p.classroom_id=$2 AND m.user_id=$3
              AND m.member_role='owner' AND p.status=$4
            ORDER BY d.updated_at DESC`,
          [tenantId, filter.classroomId, actor.userId, status],
        );
        return (result.rows as ProjectRow[]).map(toProject);
      }
      const result = await client.query(
        `SELECT DISTINCT
                p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,
                d.updated_at
           FROM projects p
           JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
           LEFT JOIN classroom_memberships m
             ON m.tenant_id=p.tenant_id AND m.classroom_id=p.classroom_id
            AND m.user_id=$3 AND m.member_role='owner'
          WHERE p.tenant_id=$1 AND p.status=$4
            AND ((p.project_scope='personal'
                  AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id=$2)
                       OR p.created_by=$3))
                 OR (p.project_scope='classroom' AND m.user_id IS NOT NULL))
          ORDER BY d.updated_at DESC`,
        [tenantId, actor.principalId, actor.userId, status],
      );
      return (result.rows as ProjectRow[]).map(toProject);
    });
  }

  async load(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null> {
    const actualTenantId = await this.projectTenant(tenantId, projectId, actor);
    if (actualTenantId === null) return null;
    return withTenantContext(this.pool, actualTenantId, async (client) => {
      const found = await client.query(
        `SELECT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,
                d.document_json,d.revision,d.updated_at
           FROM projects p
           JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
          WHERE p.tenant_id=$1 AND p.id=$2 AND ${ACCESS_SQL}`,
        [actualTenantId, projectId, actor.principalId, actor.userId],
      );
      const row = found.rows[0];
      if (!row) return null;
      const versions = await client.query(
        `SELECT id, project_id, version_no, label, created_at
           FROM project_versions
          WHERE tenant_id=$1 AND project_id=$2
          ORDER BY version_no DESC`,
        [actualTenantId, projectId],
      );
      return {
        project: toProject(row as ProjectRow),
        draft: {
          projectId,
          document: row.document_json,
          revision: row.revision,
          updatedAt: String(row.updated_at),
        },
        versions: versions.rows.map(
          (version: {
            id: string;
            project_id: string;
            version_no: number;
            label: string | null;
            created_at: string;
          }) => ({
            id: version.id,
            projectId: version.project_id,
            versionNo: version.version_no,
            label: version.label ?? null,
            createdAt: String(version.created_at),
          }),
        ),
      };
    });
  }

  async rename(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    title: string,
  ): Promise<Project | null> {
    const actualTenantId = await this.projectTenant(tenantId, projectId, actor);
    if (actualTenantId === null) return null;
    return withTenantContext(this.pool, actualTenantId, async (client) => {
      const updated = await client.query(
        `UPDATE projects p SET title=$5
          WHERE p.tenant_id=$1 AND p.id=$2 AND p.status <> 'trashed' AND ${ACCESS_SQL}
          RETURNING id,project_scope,classroom_id,module_key,title,status,created_at`,
        [actualTenantId, projectId, actor.principalId, actor.userId, title],
      );
      const row = updated.rows[0] as ProjectRow | undefined;
      if (!row) return null;
      const activity = await client.query(
        `UPDATE project_drafts
            SET updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2
          RETURNING updated_at`,
        [actualTenantId, projectId],
      );
      const updatedAt = activity.rows[0]?.updated_at;
      if (updatedAt !== undefined) row.updated_at = String(updatedAt);
      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.renamed',$4)`,
        [
          actualTenantId,
          actor.userId,
          projectId,
          JSON.stringify({ title, actorPrincipalId: actor.principalId }),
        ],
      );
      return toProject(row);
    });
  }

  async saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null> {
    const actualTenantId = await this.projectTenant(input.tenantId, input.projectId, input.actor);
    if (actualTenantId === null) return null;
    return withTenantContext(this.pool, actualTenantId, async (client) => {
      const updated = await client.query(
        `UPDATE project_drafts d
            SET document_json=$5, revision=revision+1, updated_at=now(),
                updated_by=$4, updated_by_principal_id=$3
           FROM projects p
          WHERE d.tenant_id=$1 AND d.project_id=$2
            AND p.tenant_id=d.tenant_id AND p.id=d.project_id
            AND p.status <> 'trashed'
            AND ${ACCESS_SQL}
          RETURNING d.project_id,d.document_json,d.revision,d.updated_at`,
        [
          actualTenantId,
          input.projectId,
          input.actor.principalId,
          input.actor.userId,
          JSON.stringify(input.document),
        ],
      );
      const row = updated.rows[0];
      return row
        ? {
            projectId: row.project_id,
            document: row.document_json,
            revision: row.revision,
            updatedAt: String(row.updated_at),
          }
        : null;
    });
  }

  async updateStatus(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    status: ProjectStatus,
  ): Promise<Project | null> {
    const actualTenantId = await this.projectTenant(tenantId, projectId, actor);
    if (actualTenantId === null) return null;
    return withTenantContext(this.pool, actualTenantId, async (client) => {
      const updated = await client.query(
        `UPDATE projects p SET status=$5
          WHERE p.tenant_id=$1 AND p.id=$2 AND ${ACCESS_SQL}
            AND (($5 = 'archived' AND p.status = 'active')
              OR ($5 = 'trashed' AND p.status IN ('active', 'archived'))
              OR ($5 = 'active' AND p.status IN ('archived', 'trashed')))
          RETURNING id,project_scope,classroom_id,module_key,title,status,created_at`,
        [actualTenantId, projectId, actor.principalId, actor.userId, status],
      );
      const row = updated.rows[0] as ProjectRow | undefined;
      if (!row) return null;
      const activity = await client.query(
        `UPDATE project_drafts SET updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2 RETURNING updated_at`,
        [actualTenantId, projectId],
      );
      if (activity.rows[0]?.updated_at !== undefined) {
        row.updated_at = String(activity.rows[0].updated_at);
      }
      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.status_changed',$4)`,
        [
          actualTenantId,
          actor.userId,
          projectId,
          JSON.stringify({ status, actorPrincipalId: actor.principalId }),
        ],
      );
      return toProject(row);
    });
  }

  async createCheckpoint(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    label: string | null,
  ): Promise<ProjectVersion | null> {
    const actualTenantId = await this.projectTenant(tenantId, projectId, actor);
    if (actualTenantId === null) return null;
    return withTenantContext(this.pool, actualTenantId, async (client) => {
      const draft = await client.query(
        `SELECT d.document_json
           FROM project_drafts d
           JOIN projects p ON p.tenant_id=d.tenant_id AND p.id=d.project_id
          WHERE d.tenant_id=$1 AND d.project_id=$2 AND p.status <> 'trashed' AND ${ACCESS_SQL}
          FOR UPDATE OF d`,
        [actualTenantId, projectId, actor.principalId, actor.userId],
      );
      if (draft.rows.length === 0) return null;
      const inserted = await client.query(
        `INSERT INTO project_versions
           (tenant_id,project_id,version_no,document_json,label,
            created_by,created_by_principal_id)
         SELECT $1,$2,COALESCE(MAX(version_no),0)+1,$3::jsonb,$4,$5,$6
           FROM project_versions
          WHERE tenant_id=$1 AND project_id=$2
         RETURNING id,project_id,version_no,label,created_at`,
        [
          actualTenantId,
          projectId,
          JSON.stringify(draft.rows[0].document_json),
          label,
          actor.userId,
          actor.principalId,
        ],
      );
      const row = inserted.rows[0];
      await client.query(
        `UPDATE project_drafts
            SET updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2`,
        [actualTenantId, projectId],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.checkpoint_created',$4)`,
        [
          actualTenantId,
          actor.userId,
          projectId,
          JSON.stringify({
            versionNo: row.version_no,
            actorPrincipalId: actor.principalId,
          }),
        ],
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
