import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';

function migrationClient(db: PGlite): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
} {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        return db.query(sql, params) as Promise<{ rows: Record<string, unknown>[] }>;
      }
      const results = await db.exec(sql);
      const last = results[results.length - 1];
      return { rows: (last?.rows ?? []) as Record<string, unknown>[] };
    },
  };
}

async function seedPersonalEducator(
  db: PGlite,
  input: { accountId: string; email: string; username: string; displayName: string },
): Promise<string> {
  const principalId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  await db.query(
    `INSERT INTO accounts (id, email, password_hash, birth_date, country)
     VALUES ($1, $2, 'test-hash', '1990-01-01', 'RU')`,
    [input.accountId, input.email],
  );
  await db.query(
    `INSERT INTO profiles (account_id, username, display_name)
     VALUES ($1, $2, $3)`,
    [input.accountId, input.username, input.displayName],
  );
  await db.query(`INSERT INTO principals (id, kind, account_id) VALUES ($1, 'account', $2)`, [
    principalId,
    input.accountId,
  ]);
  await db.query(
    `INSERT INTO capability_grants
       (account_id, capability, state, policy_version, granted_by)
     VALUES ($1, 'creator', 'verified', 'test', 'server'),
            ($1, 'educator', 'provisional', 'test', 'self_attestation')`,
    [input.accountId],
  );
  await db.query(`INSERT INTO tenants (id, workspace_slug, title) VALUES ($1, $2, $3)`, [
    tenantId,
    `personal-${input.username}`,
    input.displayName,
  ]);
  await db.query(`INSERT INTO tenant_placements (tenant_id, mode) VALUES ($1, 'SHARED_CLUSTER')`, [
    tenantId,
  ]);
  await db.query(
    `INSERT INTO workspaces (id, tenant_id, kind, title)
     VALUES ($1, $2, 'personal', $3)`,
    [workspaceId, tenantId, input.displayName],
  );
  await db.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'owner')`,
    [input.accountId, workspaceId],
  );
  return principalId;
}

describe('personal classroom and co-teacher PostgreSQL journey', () => {
  it('creates a class without a school choice and lets an invited educator co-teach it', async () => {
    const db = new PGlite();
    try {
      await applyPlan(migrationClient(db), planMigrations('migrations'));

      const ownerAccountId = randomUUID();
      const colleagueAccountId = randomUUID();
      const ownerPrincipalId = await seedPersonalEducator(db, {
        accountId: ownerAccountId,
        email: 'owner@example.test',
        username: 'owner-teacher',
        displayName: 'Основной педагог',
      });
      const colleaguePrincipalId = await seedPersonalEducator(db, {
        accountId: colleagueAccountId,
        email: 'colleague@example.test',
        username: 'colleague-teacher',
        displayName: 'Коллега',
      });

      const owner = await db.query<{
        tenant_id: string;
        school_id: string;
        academic_period_id: string;
        user_id: string;
      }>(`SELECT * FROM classroom_ensure_personal_teacher($1)`, [ownerAccountId]);
      expect(owner.rows).toHaveLength(1);

      const classroomId = randomUUID();
      const context = owner.rows[0];
      await db.query(
        `INSERT INTO classrooms
           (id, tenant_id, school_id, academic_period_id, title, age_band,
            topic_keys, safe_mode_default, created_by, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3, $4, '7А Робототехника', '11-12', ARRAY['electronics'],
                 true, $5, 'personal-class-test', $6)`,
        [
          classroomId,
          context.tenant_id,
          context.school_id,
          context.academic_period_id,
          context.user_id,
          'a'.repeat(64),
        ],
      );
      await db.query(
        `INSERT INTO classroom_memberships
           (tenant_id, classroom_id, user_id, account_id, member_role)
         VALUES ($1, $2, $3, $4, 'owner')`,
        [context.tenant_id, classroomId, context.user_id, ownerAccountId],
      );

      const invitation = await db.query<{ id: string }>(
        `SELECT * FROM classroom_teacher_invitation_create(
           $1, $2, 'test-invitation-hash', now() + interval '7 days')`,
        [ownerAccountId, classroomId],
      );
      expect(invitation.rows).toHaveLength(1);

      const accepted = await db.query<{ classroom_id: string; teacher_role: string }>(
        `SELECT * FROM classroom_teacher_invitation_accept($1, 'test-invitation-hash')`,
        [colleagueAccountId],
      );
      expect(accepted.rows[0]).toMatchObject({
        classroom_id: classroomId,
        teacher_role: 'co_teacher',
      });

      const colleagueClasses = await db.query<{
        id: string;
        teacher_role: string;
        workspace_kind: string;
      }>(`SELECT id, teacher_role, workspace_kind FROM classroom_list_for_account($1)`, [
        colleagueAccountId,
      ]);
      expect(colleagueClasses.rows).toEqual([
        expect.objectContaining({
          id: classroomId,
          teacher_role: 'co_teacher',
          workspace_kind: 'personal',
        }),
      ]);

      const team = await db.query<{ display_name: string; teacher_role: string }>(
        `SELECT display_name, teacher_role FROM classroom_teacher_team($1, $2)`,
        [colleagueAccountId, classroomId],
      );
      expect(team.rows.map((teacher) => teacher.teacher_role)).toEqual(['owner', 'co_teacher']);

      const student = await db.query<{ display_label: string }>(
        `SELECT display_label FROM classroom_management_add_seat(
           $1, $2, 'Маша', 'masha', true)`,
        [colleagueAccountId, classroomId],
      );
      expect(student.rows[0]?.display_label).toBe('Маша');

      const colleagueProjectContext = await db.query<{
        tenant_id: string;
        user_id: string;
        teacher_role: string;
      }>(`SELECT * FROM classroom_project_context_for_principal($1, $2)`, [
        colleaguePrincipalId,
        classroomId,
      ]);
      expect(colleagueProjectContext.rows[0]).toMatchObject({
        tenant_id: context.tenant_id,
        teacher_role: 'co_teacher',
      });

      const projectId = randomUUID();
      await db.query(
        `INSERT INTO projects
           (id, tenant_id, project_scope, classroom_id, module_key, title,
            created_by, owner_principal_id, idempotency_key, request_fingerprint)
         VALUES ($1, $2, 'classroom', $3, 'electronics', 'Схема класса',
                 $4, $5, 'class-project-test', $6)`,
        [
          projectId,
          context.tenant_id,
          classroomId,
          context.user_id,
          ownerPrincipalId,
          'b'.repeat(64),
        ],
      );
      const colleagueProject = await db.query<{ tenant_id: string; user_id: string }>(
        `SELECT * FROM project_context_for_principal($1, $2)`,
        [colleaguePrincipalId, projectId],
      );
      expect(colleagueProject.rows[0]).toMatchObject({
        tenant_id: context.tenant_id,
        user_id: colleagueProjectContext.rows[0]?.user_id,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
