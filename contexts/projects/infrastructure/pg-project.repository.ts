import type pg from 'pg';
import { withTenantContext } from '@asa-lab/database';
import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import type {
  Project,
  ProjectDraft,
  ProjectPreview,
  ProjectScope,
  ProjectStatus,
  ProjectVersion,
} from '../domain/project.js';
import type { ProjectSnapshot, ProjectSnapshotBytes, SnapshotFormat } from '../domain/snapshot.js';
import type {
  CreateProjectInput,
  CreateProjectResult,
  ProjectActor,
  ProjectListFilter,
  ProjectRepositoryPort,
  SaveDraftInput,
  SaveSnapshotInput,
} from '../application/ports.js';

interface SnapshotRow {
  project_id: string;
  content_type: SnapshotFormat;
  width: number;
  height: number;
  source_revision: number | string;
  captured_at: string;
}

function toSnapshot(row: SnapshotRow): ProjectSnapshot {
  return {
    projectId: row.project_id,
    contentType: row.content_type,
    width: Number(row.width),
    height: Number(row.height),
    sourceRevision: Number(row.source_revision),
    capturedAt: String(row.captured_at),
  };
}

interface PreviewRow {
  preview_json?: ModulePreviewDescriptor | null;
  preview_digest?: string | null;
  snapshot_revision?: number | string | null;
}

interface ProjectRow extends PreviewRow {
  id: string;
  project_scope: ProjectScope;
  classroom_id: string | null;
  module_key: string;
  title: string;
  status: ProjectStatus;
  created_at: string;
  updated_at?: string;
  request_fingerprint?: string | null;
  copied_from_project_id?: string | null;
  copied_from_author?: string | null;
  copied_from_title?: string | null;
  copied_at?: string | Date | null;
  description?: string | null;
  tags?: string[] | null;
  license?: string | null;
}

/**
 * Both columns are filled together or not at all, but a row written by an older
 * build, a restored backup or a partial migration can carry one without the
 * other. A half-preview is treated as no preview rather than as a card with a
 * picture nobody can invalidate.
 */
function toPreview(row: PreviewRow): ProjectPreview | null {
  const descriptor = row.preview_json ?? null;
  const digest = row.preview_digest ?? null;
  if (descriptor === null || digest === null) return null;
  return { digest, descriptor };
}

function toProject(row: ProjectRow, preview: ProjectPreview | null = toPreview(row)): Project {
  const revision = row.snapshot_revision;
  return {
    id: row.id,
    scope: row.project_scope,
    classroomId: row.classroom_id,
    moduleKey: row.module_key,
    title: row.title,
    status: row.status,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    preview,
    snapshotRevision: revision === null || revision === undefined ? null : Number(revision),
    description: row.description ?? null,
    tags: row.tags ?? [],
    license: row.license ?? 'reserved',
    copiedFrom:
      row.copied_from_project_id && row.copied_from_author && row.copied_from_title
        ? {
            projectId: row.copied_from_project_id,
            author: row.copied_from_author,
            title: row.copied_from_title,
            at:
              row.copied_at instanceof Date
                ? row.copied_at.toISOString()
                : String(row.copied_at ?? ''),
          }
        : null,
  };
}

const ACCESS_SQL = `(
  (p.project_scope = 'personal'
     AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $3)
          OR ($4::uuid IS NOT NULL AND p.created_by = $4)))
  OR (p.project_scope = 'classroom' AND EXISTS (
        SELECT 1 FROM classroom_memberships m
         WHERE m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
           AND $4::uuid IS NOT NULL AND m.user_id = $4))
  OR (p.project_scope = 'personal' AND p.owner_principal_id IN (
        SELECT scope.seat_principal_id FROM teacher_seat_scope($3) scope))
)`;

const EDIT_ACCESS_SQL = `(
  (p.project_scope = 'personal'
     AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $3)
          OR ($4::uuid IS NOT NULL AND p.created_by = $4)))
  OR (p.project_scope = 'classroom' AND EXISTS (
        SELECT 1 FROM classroom_memberships m
         WHERE m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
           AND $4::uuid IS NOT NULL AND m.user_id = $4
           AND m.member_role IN ('owner', 'co_teacher')))
  OR (p.project_scope = 'personal' AND p.owner_principal_id IN (
        SELECT scope.seat_principal_id FROM teacher_seat_scope($3) scope))
)`;

interface ResolvedProjectContext {
  readonly tenantId: string;
  readonly userId: string | null;
}

/**
 * Notes project work in the record of the class it belongs to.
 *
 * Which class that is follows from the project, so the caller passes only who
 * acted and what they did. A personal project owned by a learner belongs to
 * their class whoever is working on it, which is what puts a teacher's
 * correction on the learner's own record. A teacher's own project belongs to no
 * class and is not recorded.
 *
 * A failure here is swallowed: the record exists to tell a teacher how someone
 * is getting on, and that is never worth failing the work itself.
 */
async function recordClassroomActivity(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  principalId: string,
  projectId: string,
  action: string,
): Promise<void> {
  try {
    await client.query(`SELECT classroom_activity_record_project($1,$2,$3)`, [
      principalId,
      projectId,
      action,
    ]);
  } catch {
    // Deliberately silent: see above.
  }
}

export class PgProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  private async projectContext(
    _activeTenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<ResolvedProjectContext | null> {
    void _activeTenantId;
    const result = await this.pool.query(
      `SELECT tenant_id, user_id FROM project_context_for_principal($1, $2)`,
      [actor.principalId, projectId],
    );
    const row = result.rows[0] as { tenant_id: string; user_id: string | null } | undefined;
    return row ? { tenantId: row.tenant_id, userId: row.user_id } : null;
  }

  async createWithDraft(input: CreateProjectInput): Promise<CreateProjectResult> {
    const { principalId, userId } = input.actor;
    let projectTenantId = input.tenantId;
    let projectUserId = userId;
    if (input.scope === 'classroom') {
      const access = await this.pool.query(
        `SELECT tenant_id, user_id
           FROM classroom_project_context_for_principal($1, $2)`,
        [principalId, input.classroomId],
      );
      const row = access.rows[0] as { tenant_id: string; user_id: string } | undefined;
      if (!row) return { kind: 'classroom_not_found' };
      projectTenantId = row.tenant_id;
      projectUserId = row.user_id;
    }
    return withTenantContext(this.pool, projectTenantId, async (client) => {
      let projectTitle = input.title;
      if (input.automaticTitlePrefix) {
        const sequenceLockKey = JSON.stringify([
          projectTenantId,
          principalId,
          input.scope,
          input.classroomId,
          input.moduleKey,
        ]);
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          sequenceLockKey,
        ]);
        const counted = await client.query(
          `SELECT COUNT(*)::integer AS project_count
             FROM projects p
            WHERE p.tenant_id = $1
              AND p.project_scope = $2
              AND p.module_key = $3
              AND ($4::uuid IS NULL OR p.classroom_id = $4)
              AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $5)
                   OR ($6::uuid IS NOT NULL AND p.created_by = $6))`,
          [
            projectTenantId,
            input.scope,
            input.moduleKey,
            input.classroomId,
            principalId,
            projectUserId,
          ],
        );
        const row = counted.rows[0] as { project_count: number | string } | undefined;
        projectTitle = `${input.automaticTitlePrefix} ${Number(row?.project_count ?? 0) + 1}`;
      }
      const conflictTarget =
        projectUserId === null
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
          projectTenantId,
          input.scope,
          input.classroomId,
          input.moduleKey,
          projectTitle,
          projectUserId,
          principalId,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT p.id, p.project_scope, p.classroom_id, p.module_key, p.title,
           p.copied_from_project_id, p.copied_from_author, p.copied_from_title, p.copied_at,
           p.description, p.tags, p.license,
                  p.status, p.created_at, p.request_fingerprint,
                  d.preview_json, d.preview_digest
             FROM projects p
             LEFT JOIN project_drafts d ON d.tenant_id = p.tenant_id AND d.project_id = p.id
            WHERE p.tenant_id = $1 AND p.idempotency_key = $2
              AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $3)
                   OR ($4::uuid IS NOT NULL AND p.created_by = $4))`,
          [projectTenantId, input.idempotencyKey, principalId, projectUserId],
        );
        const row = existing.rows[0] as ProjectRow | undefined;
        if (!row || row.request_fingerprint !== input.requestFingerprint) {
          return { kind: 'conflict' };
        }
        return { kind: 'existing', project: toProject(row) };
      }
      const project = toProject(inserted.rows[0] as ProjectRow, input.initialPreview);
      await client.query(
        `INSERT INTO project_drafts
           (project_id, tenant_id, document_json, updated_by, updated_by_principal_id,
            preview_json, preview_digest)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          project.id,
          projectTenantId,
          JSON.stringify(input.initialDocument),
          projectUserId,
          principalId,
          input.initialPreview ? JSON.stringify(input.initialPreview.descriptor) : null,
          input.initialPreview?.digest ?? null,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1,$2,'project',$3,'project.created',$4)`,
        [
          projectTenantId,
          projectUserId,
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
      await recordClassroomActivity(client, principalId, project.id, 'project.created');
      return { kind: 'created', project };
    });
  }

  async nextTitleSequence(input: {
    readonly tenantId: string;
    readonly scope: ProjectScope;
    readonly classroomId: string | null;
    readonly actor: ProjectActor;
    readonly moduleKey: string;
  }): Promise<number | null> {
    let projectTenantId = input.tenantId;
    let projectUserId = input.actor.userId;
    if (input.scope === 'classroom') {
      const access = await this.pool.query(
        `SELECT tenant_id, user_id
           FROM classroom_project_context_for_principal($1, $2)`,
        [input.actor.principalId, input.classroomId],
      );
      const row = access.rows[0] as { tenant_id: string; user_id: string } | undefined;
      if (!row) return null;
      projectTenantId = row.tenant_id;
      projectUserId = row.user_id;
    }

    return withTenantContext(this.pool, projectTenantId, async (client) => {
      const counted = await client.query(
        `SELECT COUNT(*)::integer AS project_count
           FROM projects p
          WHERE p.tenant_id = $1
            AND p.project_scope = $2
            AND p.module_key = $3
            AND ($4::uuid IS NULL OR p.classroom_id = $4)
            AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $5)
                 OR ($6::uuid IS NOT NULL AND p.created_by = $6))`,
        [
          projectTenantId,
          input.scope,
          input.moduleKey,
          input.classroomId,
          input.actor.principalId,
          projectUserId,
        ],
      );
      const row = counted.rows[0] as { project_count: number | string } | undefined;
      return Number(row?.project_count ?? 0) + 1;
    });
  }

  async listForActor(
    tenantId: string,
    actor: ProjectActor,
    filter: ProjectListFilter,
  ): Promise<Project[]> {
    const status = filter.status ?? 'active';
    if (filter.scope === 'classroom' && filter.classroomId) {
      const access = await this.pool.query(
        `SELECT tenant_id, user_id
           FROM classroom_project_context_for_principal($1, $2)`,
        [actor.principalId, filter.classroomId],
      );
      const row = access.rows[0] as { tenant_id: string; user_id: string } | undefined;
      if (!row) return [];
      return withTenantContext(this.pool, row.tenant_id, async (client) => {
        const result = await client.query(
          `SELECT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,
                  d.updated_at,d.preview_json,d.preview_digest,s.source_revision AS snapshot_revision
             FROM projects p
             JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
             LEFT JOIN project_snapshots s ON s.tenant_id=p.tenant_id AND s.project_id=p.id
            WHERE p.tenant_id=$1 AND p.project_scope='classroom'
              AND p.classroom_id=$2 AND p.status=$3
            ORDER BY d.updated_at DESC`,
          [row.tenant_id, filter.classroomId, status],
        );
        return (result.rows as ProjectRow[]).map((row) => toProject(row));
      });
    }
    if (actor.userId === null) {
      if (filter.scope === 'classroom') return [];
      return withTenantContext(this.pool, tenantId, async (client) => {
        const result = await client.query(
          `SELECT p.id, p.project_scope, p.classroom_id, p.module_key, p.title,
           p.copied_from_project_id, p.copied_from_author, p.copied_from_title, p.copied_at,
           p.description, p.tags, p.license,
                  p.status, p.created_at, d.updated_at, d.preview_json, d.preview_digest,
                  s.source_revision AS snapshot_revision
             FROM projects p
             JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
             LEFT JOIN project_snapshots s ON s.tenant_id=p.tenant_id AND s.project_id=p.id
            WHERE p.tenant_id=$1 AND p.owner_principal_id=$2
              AND p.project_scope='personal' AND p.status=$3
            ORDER BY d.updated_at DESC`,
          [tenantId, actor.principalId, status],
        );
        return (result.rows as ProjectRow[]).map((row) => toProject(row));
      });
    }
    return withTenantContext(this.pool, tenantId, async (client) => {
      if (filter.scope === 'personal') {
        const result = await client.query(
          `SELECT p.id, p.project_scope, p.classroom_id, p.module_key, p.title,
           p.copied_from_project_id, p.copied_from_author, p.copied_from_title, p.copied_at,
           p.description, p.tags, p.license,
                  p.status, p.created_at, d.updated_at, d.preview_json, d.preview_digest,
                  s.source_revision AS snapshot_revision
             FROM projects p
             JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
             LEFT JOIN project_snapshots s ON s.tenant_id=p.tenant_id AND s.project_id=p.id
            WHERE p.tenant_id = $1 AND p.project_scope = 'personal' AND p.status = $4
              AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id = $2)
                   OR p.created_by = $3)
            ORDER BY d.updated_at DESC`,
          [tenantId, actor.principalId, actor.userId, status],
        );
        return (result.rows as ProjectRow[]).map((row) => toProject(row));
      }
      const result = await client.query(
        `SELECT DISTINCT
                p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,
                d.updated_at,d.preview_json,d.preview_digest,s.source_revision AS snapshot_revision
           FROM projects p
           JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
           LEFT JOIN project_snapshots s ON s.tenant_id=p.tenant_id AND s.project_id=p.id
           LEFT JOIN classroom_memberships m
             ON m.tenant_id=p.tenant_id AND m.classroom_id=p.classroom_id
            AND m.user_id=$3
          WHERE p.tenant_id=$1 AND p.status=$4
            AND ((p.project_scope='personal'
                  AND ((p.owner_principal_id IS NOT NULL AND p.owner_principal_id=$2)
                       OR p.created_by=$3))
                 OR (p.project_scope='classroom' AND m.user_id IS NOT NULL))
          ORDER BY d.updated_at DESC`,
        [tenantId, actor.principalId, actor.userId, status],
      );
      return (result.rows as ProjectRow[]).map((row) => toProject(row));
    });
  }

  async load(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<{ project: Project; draft: ProjectDraft; versions: ProjectVersion[] } | null> {
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const found = await client.query(
        `SELECT p.id,p.project_scope,p.classroom_id,p.module_key,p.title,p.status,p.created_at,
                d.document_json,d.revision,d.updated_at,d.preview_json,d.preview_digest
           FROM projects p
           JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
          WHERE p.tenant_id=$1 AND p.id=$2 AND ${ACCESS_SQL}`,
        [access.tenantId, projectId, actor.principalId, access.userId],
      );
      const row = found.rows[0];
      if (!row) return null;
      const versions = await client.query(
        `SELECT id, project_id, version_no, label, created_at
           FROM project_versions
          WHERE tenant_id=$1 AND project_id=$2
          ORDER BY version_no DESC`,
        [access.tenantId, projectId],
      );
      return {
        project: toProject(row as ProjectRow),
        draft: {
          projectId,
          document: row.document_json,
          revision: row.revision,
          updatedAt: String(row.updated_at),
          preview: toPreview(row as PreviewRow),
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
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const updated = await client.query(
        `UPDATE projects p SET title=$5
          WHERE p.tenant_id=$1 AND p.id=$2 AND p.status <> 'trashed' AND ${EDIT_ACCESS_SQL}
          RETURNING id,project_scope,classroom_id,module_key,title,status,created_at`,
        [access.tenantId, projectId, actor.principalId, access.userId, title],
      );
      const row = updated.rows[0] as ProjectRow | undefined;
      if (!row) return null;
      const activity = await client.query(
        `UPDATE project_drafts
            SET updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2
          RETURNING updated_at, preview_json, preview_digest`,
        [access.tenantId, projectId],
      );
      const activityRow = activity.rows[0] as (PreviewRow & { updated_at?: string }) | undefined;
      if (activityRow?.updated_at !== undefined) row.updated_at = String(activityRow.updated_at);
      row.preview_json = activityRow?.preview_json ?? null;
      row.preview_digest = activityRow?.preview_digest ?? null;
      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.renamed',$4)`,
        [
          access.tenantId,
          access.userId,
          projectId,
          JSON.stringify({ title, actorPrincipalId: actor.principalId }),
        ],
      );
      await recordClassroomActivity(client, actor.principalId, projectId, 'project.renamed');
      return toProject(row);
    });
  }

  async saveDraft(input: SaveDraftInput): Promise<ProjectDraft | null> {
    const access = await this.projectContext(input.tenantId, input.projectId, input.actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const updated = await client.query(
        `UPDATE project_drafts d
            SET document_json=$5, revision=revision+1, updated_at=now(),
                updated_by=$4, updated_by_principal_id=$3,
                preview_json=$6::jsonb, preview_digest=$7
           FROM projects p
          WHERE d.tenant_id=$1 AND d.project_id=$2
            AND p.tenant_id=d.tenant_id AND p.id=d.project_id
            AND p.status <> 'trashed'
            AND ${EDIT_ACCESS_SQL}
          RETURNING d.project_id,d.document_json,d.revision,d.updated_at,
                    d.preview_json,d.preview_digest`,
        [
          access.tenantId,
          input.projectId,
          input.actor.principalId,
          access.userId,
          JSON.stringify(input.document),
          input.preview ? JSON.stringify(input.preview.descriptor) : null,
          input.preview?.digest ?? null,
        ],
      );
      const row = updated.rows[0];
      if (!row) return null;
      await recordClassroomActivity(
        client,
        input.actor.principalId,
        input.projectId,
        'project.saved',
      );
      return {
        projectId: row.project_id,
        document: row.document_json,
        revision: row.revision,
        updatedAt: String(row.updated_at),
        preview: toPreview(row as PreviewRow),
      };
    });
  }

  async updateStatus(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    status: ProjectStatus,
  ): Promise<Project | null> {
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const updated = await client.query(
        `UPDATE projects p SET status=$5
          WHERE p.tenant_id=$1 AND p.id=$2 AND ${EDIT_ACCESS_SQL}
            AND (($5 = 'archived' AND p.status = 'active')
              OR ($5 = 'trashed' AND p.status IN ('active', 'archived'))
              OR ($5 = 'active' AND p.status IN ('archived', 'trashed')))
          RETURNING id,project_scope,classroom_id,module_key,title,status,created_at`,
        [access.tenantId, projectId, actor.principalId, access.userId, status],
      );
      const row = updated.rows[0] as ProjectRow | undefined;
      if (!row) return null;
      const activity = await client.query(
        `UPDATE project_drafts SET updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2
          RETURNING updated_at, preview_json, preview_digest`,
        [access.tenantId, projectId],
      );
      const activityRow = activity.rows[0] as (PreviewRow & { updated_at?: string }) | undefined;
      if (activityRow?.updated_at !== undefined) {
        row.updated_at = String(activityRow.updated_at);
      }
      row.preview_json = activityRow?.preview_json ?? null;
      row.preview_digest = activityRow?.preview_digest ?? null;
      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.status_changed',$4)`,
        [
          access.tenantId,
          access.userId,
          projectId,
          JSON.stringify({ status, actorPrincipalId: actor.principalId }),
        ],
      );
      await recordClassroomActivity(client, actor.principalId, projectId, `project.${status}`);
      return toProject(row);
    });
  }

  async createCheckpoint(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    label: string | null,
  ): Promise<ProjectVersion | null> {
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const draft = await client.query(
        `SELECT d.document_json
           FROM project_drafts d
           JOIN projects p ON p.tenant_id=d.tenant_id AND p.id=d.project_id
          WHERE d.tenant_id=$1 AND d.project_id=$2 AND p.status <> 'trashed' AND ${EDIT_ACCESS_SQL}
          FOR UPDATE OF d`,
        [access.tenantId, projectId, actor.principalId, access.userId],
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
          access.tenantId,
          projectId,
          JSON.stringify(draft.rows[0].document_json),
          label,
          access.userId,
          actor.principalId,
        ],
      );
      const row = inserted.rows[0];
      await client.query(
        `UPDATE project_drafts
            SET updated_at=now()
          WHERE tenant_id=$1 AND project_id=$2`,
        [access.tenantId, projectId],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.checkpoint_created',$4)`,
        [
          access.tenantId,
          access.userId,
          projectId,
          JSON.stringify({
            versionNo: row.version_no,
            actorPrincipalId: actor.principalId,
          }),
        ],
      );
      await recordClassroomActivity(client, actor.principalId, projectId, 'project.checkpoint');
      return {
        id: row.id,
        projectId: row.project_id,
        versionNo: row.version_no,
        label: row.label ?? null,
        createdAt: String(row.created_at),
      };
    });
  }

  async listVersions(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<readonly ProjectVersion[] | null> {
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const rows = await client.query(
        `SELECT v.id, v.project_id, v.version_no, v.label, v.created_at
           FROM project_versions v
           JOIN projects p ON p.tenant_id = v.tenant_id AND p.id = v.project_id
          WHERE v.tenant_id = $1 AND v.project_id = $2
            AND p.status <> 'trashed' AND ${ACCESS_SQL}
          ORDER BY v.version_no DESC`,
        [access.tenantId, projectId, actor.principalId, access.userId],
      );
      return rows.rows.map((row) => ({
        id: row.id as string,
        projectId: row.project_id as string,
        versionNo: Number(row.version_no),
        label: (row.label as string | null) ?? null,
        createdAt: String(row.created_at),
      }));
    });
  }

  async restoreVersion(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
    versionId: string,
  ): Promise<{ draft: ProjectDraft; versions: readonly ProjectVersion[] } | null> {
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      // The version being returned to.
      const target = await client.query(
        `SELECT v.document_json, v.version_no
           FROM project_versions v
          WHERE v.tenant_id = $1 AND v.project_id = $2 AND v.id = $3`,
        [access.tenantId, projectId, versionId],
      );
      if (target.rows.length === 0) return null;

      // What is on screen now, locked so nothing lands between reading it and
      // replacing it.
      const current = await client.query(
        `SELECT d.document_json
           FROM project_drafts d
           JOIN projects p ON p.tenant_id = d.tenant_id AND p.id = d.project_id
          WHERE d.tenant_id = $1 AND d.project_id = $2
            AND p.status <> 'trashed' AND ${EDIT_ACCESS_SQL}
          FOR UPDATE OF d`,
        [access.tenantId, projectId, actor.principalId, access.userId],
      );
      if (current.rows.length === 0) return null;

      // Keep it first. Going back has to be something you can come back from —
      // a history where one wrong press loses the afternoon is worse than none.
      await client.query(
        `INSERT INTO project_versions
           (tenant_id, project_id, version_no, document_json, label,
            created_by, created_by_principal_id)
         SELECT $1, $2, COALESCE(MAX(version_no), 0) + 1, $3::jsonb, $4, $5, $6
           FROM project_versions
          WHERE tenant_id = $1 AND project_id = $2`,
        [
          access.tenantId,
          projectId,
          JSON.stringify(current.rows[0].document_json),
          'Перед возвратом',
          access.userId,
          actor.principalId,
        ],
      );

      const restored = await client.query(
        `UPDATE project_drafts d
            SET document_json = $5, revision = revision + 1, updated_at = now(),
                updated_by = $4, updated_by_principal_id = $3,
                preview_json = NULL, preview_digest = NULL
           FROM projects p
          WHERE d.tenant_id = $1 AND d.project_id = $2
            AND p.tenant_id = d.tenant_id AND p.id = d.project_id
            AND p.status <> 'trashed'
            AND ${EDIT_ACCESS_SQL}
          RETURNING d.project_id, d.document_json, d.revision, d.updated_at,
                    d.preview_json, d.preview_digest`,
        [
          access.tenantId,
          projectId,
          actor.principalId,
          access.userId,
          JSON.stringify(target.rows[0].document_json),
        ],
      );
      const row = restored.rows[0];
      if (!row) return null;

      await client.query(
        `INSERT INTO audit_events
           (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
         VALUES ($1,$2,'project',$3,'project.version_restored',$4)`,
        [
          access.tenantId,
          access.userId,
          projectId,
          JSON.stringify({
            versionNo: Number(target.rows[0].version_no),
            actorPrincipalId: actor.principalId,
          }),
        ],
      );
      await recordClassroomActivity(client, actor.principalId, projectId, 'project.saved');

      const versions = await client.query(
        `SELECT id, project_id, version_no, label, created_at
           FROM project_versions
          WHERE tenant_id = $1 AND project_id = $2
          ORDER BY version_no DESC`,
        [access.tenantId, projectId],
      );

      return {
        draft: {
          projectId: row.project_id,
          document: row.document_json,
          revision: row.revision,
          updatedAt: String(row.updated_at),
          preview: toPreview(row as PreviewRow),
        },
        versions: versions.rows.map((entry) => ({
          id: entry.id as string,
          projectId: entry.project_id as string,
          versionNo: Number(entry.version_no),
          label: (entry.label as string | null) ?? null,
          createdAt: String(entry.created_at),
        })),
      };
    });
  }

  async saveSnapshot(input: SaveSnapshotInput): Promise<ProjectSnapshot | null> {
    const access = await this.projectContext(input.tenantId, input.projectId, input.actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      // The revision is read from the draft inside the same statement rather
      // than accepted from the client: it is what tells a cached card whether
      // it is still current, so naming it must not be the uploader's choice.
      const saved = await client.query(
        `INSERT INTO project_snapshots
           (project_id, tenant_id, image, content_type, width, height,
            source_revision, captured_by, captured_by_principal_id)
         SELECT p.id, p.tenant_id, $5::bytea, $6::varchar, $7::integer, $8::integer,
                d.revision, $4::uuid, $3::uuid
           FROM projects p
           JOIN project_drafts d ON d.tenant_id=p.tenant_id AND d.project_id=p.id
          WHERE p.tenant_id=$1 AND p.id=$2 AND p.status <> 'trashed' AND ${EDIT_ACCESS_SQL}
         ON CONFLICT (project_id) DO UPDATE
            SET image=EXCLUDED.image, content_type=EXCLUDED.content_type,
                width=EXCLUDED.width, height=EXCLUDED.height,
                source_revision=EXCLUDED.source_revision, captured_at=now(),
                captured_by=EXCLUDED.captured_by,
                captured_by_principal_id=EXCLUDED.captured_by_principal_id
         RETURNING project_id, content_type, width, height, source_revision, captured_at`,
        [
          access.tenantId,
          input.projectId,
          input.actor.principalId,
          access.userId,
          Buffer.from(input.image.bytes),
          input.image.contentType,
          input.image.width,
          input.image.height,
        ],
      );
      const row = saved.rows[0] as SnapshotRow | undefined;
      return row ? toSnapshot(row) : null;
    });
  }

  async loadSnapshot(
    tenantId: string,
    projectId: string,
    actor: ProjectActor,
  ): Promise<ProjectSnapshotBytes | null> {
    const access = await this.projectContext(tenantId, projectId, actor);
    if (access === null) return null;
    return withTenantContext(this.pool, access.tenantId, async (client) => {
      const found = await client.query(
        `SELECT s.project_id, s.image, s.content_type, s.width, s.height,
                s.source_revision, s.captured_at
           FROM project_snapshots s
           JOIN projects p ON p.tenant_id=s.tenant_id AND p.id=s.project_id
          WHERE s.tenant_id=$1 AND s.project_id=$2 AND ${ACCESS_SQL}`,
        [access.tenantId, projectId, actor.principalId, access.userId],
      );
      const row = found.rows[0] as (SnapshotRow & { image: Buffer }) | undefined;
      return row ? { ...toSnapshot(row), bytes: new Uint8Array(row.image) } : null;
    });
  }
}
