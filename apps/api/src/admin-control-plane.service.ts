import type pg from 'pg';
import type { RuntimeMetrics, RuntimeMetricsSnapshot } from '@asa-lab/observability';
import { runtimeBuildMetadata } from './build-metadata.js';
import {
  authorizeAdmin,
  resolveAdminScopeGrants,
  type AdminPermission,
  type AdminScopeGrant,
  type AdminScopeKind,
  type AdminSubject,
} from '@asa-lab/authz';
import type { AccountDirectoryPort, ActiveContext } from '@asa-lab/identity';

export interface ResolvedAdminAccess {
  readonly subject: AdminSubject;
  readonly scopes: readonly AdminScopeGrant[];
}

export interface AdminAuditEventView {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorPrincipalId: string;
  readonly actorRole: string;
  readonly scopeKind: AdminScopeKind;
  readonly scopeId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  readonly ticketId: string | null;
  readonly requestId: string;
  readonly result: 'allowed' | 'denied' | 'succeeded' | 'failed';
  readonly beforeVersion: number | null;
  readonly afterVersion: number | null;
}

export interface AdminAuditCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface AdminListCursor {
  readonly before: string;
  readonly id: string;
}

export interface AdminAccountView {
  readonly accountId: string;
  readonly principalId: string;
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  readonly status: string;
  readonly emailVerificationState: string;
  readonly createdAt: string;
  readonly organizationRole: string | null;
  readonly membershipState: string | null;
  readonly activeSessionCount: number;
  readonly lastSeenAt: string | null;
  readonly hasEverSignedIn: boolean;
  readonly isPlatformAdmin: boolean;
}

export interface AdminMaxIdentityView {
  readonly linked: boolean;
  readonly verifiedAt: string | null;
  readonly lastRevokedAt: string | null;
}

export interface AdminOrganizationView {
  readonly workspaceId: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly memberCount: number;
  readonly administratorCount: number;
  readonly activeSessionCount: number;
}

export interface AdminSecuritySessionView {
  readonly sessionId: string;
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  readonly workspaceId: string;
  readonly workspaceTitle: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly userAgentSummary: string | null;
}

export interface AdminListPage<T> {
  readonly items: readonly T[];
  readonly next: AdminListCursor | null;
}

export interface AdminOperationsStatusView {
  readonly checkedAt: string;
  readonly services: {
    readonly api: 'responding';
    readonly database: 'responding';
  };
  readonly migration: {
    readonly version: string;
    readonly name: string;
    readonly appliedAt: string;
  };
  readonly build: {
    readonly revision: string;
    readonly builtAt: string | null;
    readonly expectedSchemaVersion: number | null;
    readonly synchronized: boolean | null;
  };
  readonly counts: {
    readonly accounts: number;
    readonly activeAccounts: number;
    readonly suspendedAccounts: number;
    readonly organizations: number;
    readonly activeSessions: number;
    readonly auditEvents24h: number;
  };
  readonly runtime: RuntimeMetricsSnapshot | null;
}

interface AuditRow {
  readonly id: string;
  readonly occurred_at: Date | string;
  readonly actor_principal_id: string;
  readonly actor_role: string;
  readonly scope_kind: AdminScopeKind;
  readonly scope_id: string | null;
  readonly action: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly reason_code: string | null;
  readonly reason_text: string | null;
  readonly ticket_id: string | null;
  readonly request_id: string;
  readonly result: 'allowed' | 'denied' | 'succeeded' | 'failed';
  readonly before_version: string | number | null;
  readonly after_version: string | number | null;
}

interface AccountRow {
  readonly account_id: string;
  readonly principal_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly username: string;
  readonly account_status: string;
  readonly email_verification_state: string;
  readonly created_at: Date | string;
  readonly organization_role: string | null;
  readonly membership_state: string | null;
  readonly active_session_count: string | number;
  readonly last_seen_at: Date | string | null;
  readonly has_ever_signed_in: boolean;
  readonly is_platform_admin: boolean;
}

interface OrganizationRow {
  readonly workspace_id: string;
  readonly title: string;
  readonly workspace_status: string;
  readonly created_at: Date | string;
  readonly member_count: string | number;
  readonly administrator_count: string | number;
  readonly active_session_count: string | number;
}

interface SecuritySessionRow {
  readonly session_id: string;
  readonly account_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly username: string;
  readonly workspace_id: string;
  readonly workspace_title: string;
  readonly created_at: Date | string;
  readonly last_seen_at: Date | string;
  readonly expires_at: Date | string;
  readonly revoked_at: Date | string | null;
  readonly session_status: 'active' | 'expired' | 'revoked';
  readonly user_agent_summary: string | null;
}

interface OperationsStatusRow {
  readonly database_time: Date | string;
  readonly migration_version: string;
  readonly migration_name: string;
  readonly migration_applied_at: Date | string;
  readonly total_account_count: string | number;
  readonly active_account_count: string | number;
  readonly suspended_account_count: string | number;
  readonly organization_count: string | number;
  readonly active_session_count: string | number;
  readonly audit_event_count_24h: string | number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableVersion(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function count(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export class AdminControlPlaneService {
  constructor(
    private readonly accounts: AccountDirectoryPort,
    private readonly pool: pg.Pool,
    private readonly runtimeMetrics: RuntimeMetrics | null = null,
  ) {}

  async resolveAccess(context: ActiveContext): Promise<ResolvedAdminAccess> {
    const [capabilities, workspaces] = await Promise.all([
      this.accounts.capabilities(context.accountId),
      this.accounts.workspaces(context.accountId),
    ]);
    const subject: AdminSubject = {
      principalId: context.principalId,
      accountId: context.accountId,
      capabilities,
      workspaces,
    };
    return { subject, scopes: resolveAdminScopeGrants(subject) };
  }

  authorize(
    access: ResolvedAdminAccess,
    permission: AdminPermission,
    scope: { readonly kind: AdminScopeKind; readonly id: string | null },
  ): boolean {
    return authorizeAdmin(access.subject, { permission, scope }).allowed;
  }

  async listAuditEvents(
    access: ResolvedAdminAccess,
    input: {
      readonly scope: { readonly kind: AdminScopeKind; readonly id: string | null };
      readonly limit: number;
      readonly cursor: AdminAuditCursor | null;
      readonly requestId: string;
    },
  ): Promise<{
    readonly items: readonly AdminAuditEventView[];
    readonly next: AdminAuditCursor | null;
  }> {
    if (!this.authorize(access, 'administration.audit.read', input.scope)) {
      throw new Error('ADMIN_SCOPE_DENIED');
    }

    // Reading an administrative audit trail is itself a privileged read. It is
    // recorded before the query so the returned page honestly includes it.
    await this.pool.query(
      `SELECT admin_append_audit_event(
         $1, $2, $3, 'administration.audit.read',
         'administrative_audit_events', NULL,
         'admin_console', NULL, NULL, $4, $4, 'succeeded', NULL, NULL
       )`,
      [access.subject.principalId, input.scope.kind, input.scope.id, input.requestId],
    );

    const result = await this.pool.query<AuditRow>(
      `SELECT id, occurred_at, actor_principal_id, actor_role,
              scope_kind, scope_id, action, target_type, target_id,
              reason_code, reason_text, ticket_id, request_id, result,
              before_version, after_version
         FROM admin_list_audit_events($1, $2, $3, $4, $5, $6)`,
      [
        access.subject.principalId,
        input.scope.kind,
        input.scope.id,
        input.limit,
        input.cursor?.occurredAt ?? null,
        input.cursor?.id ?? null,
      ],
    );
    const items = result.rows.map((row) => this.auditView(row));
    const last = items.at(-1);
    return {
      items,
      next:
        items.length === input.limit && last ? { occurredAt: last.occurredAt, id: last.id } : null,
    };
  }

  async listAccounts(
    access: ResolvedAdminAccess,
    input: {
      readonly scope: { readonly kind: AdminScopeKind; readonly id: string | null };
      readonly search: string | null;
      readonly limit: number;
      readonly cursor: AdminListCursor | null;
      readonly requestId: string;
    },
  ): Promise<AdminListPage<AdminAccountView>> {
    this.requirePermission(access, 'administration.accounts.read', input.scope);
    await this.auditRead(access, input, 'administration.accounts.read', 'accounts');
    const result = await this.pool.query<AccountRow>(
      `SELECT account_id, principal_id, email, display_name, username,
              account_status, email_verification_state, created_at,
              organization_role, membership_state, active_session_count, last_seen_at,
              has_ever_signed_in, is_platform_admin
         FROM admin_list_accounts($1, $2, $3, $4, $5, $6, $7)`,
      [
        access.subject.principalId,
        input.scope.kind,
        input.scope.id,
        input.search,
        input.limit,
        input.cursor?.before ?? null,
        input.cursor?.id ?? null,
      ],
    );
    const items = result.rows.map<AdminAccountView>((row) => ({
      accountId: row.account_id,
      principalId: row.principal_id,
      email: row.email,
      displayName: row.display_name,
      username: row.username,
      status: row.account_status,
      emailVerificationState: row.email_verification_state,
      createdAt: iso(row.created_at),
      organizationRole: row.organization_role,
      membershipState: row.membership_state,
      activeSessionCount: count(row.active_session_count),
      lastSeenAt: row.last_seen_at === null ? null : iso(row.last_seen_at),
      hasEverSignedIn: row.has_ever_signed_in,
      isPlatformAdmin: row.is_platform_admin,
    }));
    return this.page(items, input.limit, (item) => ({
      before: item.createdAt,
      id: item.accountId,
    }));
  }

  async listOrganizations(
    access: ResolvedAdminAccess,
    input: {
      readonly scope: { readonly kind: AdminScopeKind; readonly id: string | null };
      readonly search: string | null;
      readonly limit: number;
      readonly cursor: AdminListCursor | null;
      readonly requestId: string;
    },
  ): Promise<AdminListPage<AdminOrganizationView>> {
    this.requirePermission(access, 'administration.organizations.read', input.scope);
    await this.auditRead(access, input, 'administration.organizations.read', 'workspaces');
    const result = await this.pool.query<OrganizationRow>(
      `SELECT workspace_id, title, workspace_status, created_at,
              member_count, administrator_count, active_session_count
         FROM admin_list_organizations($1, $2, $3, $4, $5, $6, $7)`,
      [
        access.subject.principalId,
        input.scope.kind,
        input.scope.id,
        input.search,
        input.limit,
        input.cursor?.before ?? null,
        input.cursor?.id ?? null,
      ],
    );
    const items = result.rows.map<AdminOrganizationView>((row) => ({
      workspaceId: row.workspace_id,
      title: row.title,
      status: row.workspace_status,
      createdAt: iso(row.created_at),
      memberCount: count(row.member_count),
      administratorCount: count(row.administrator_count),
      activeSessionCount: count(row.active_session_count),
    }));
    return this.page(items, input.limit, (item) => ({
      before: item.createdAt,
      id: item.workspaceId,
    }));
  }

  async listSecuritySessions(
    access: ResolvedAdminAccess,
    input: {
      readonly scope: { readonly kind: AdminScopeKind; readonly id: string | null };
      readonly search: string | null;
      readonly limit: number;
      readonly cursor: AdminListCursor | null;
      readonly requestId: string;
    },
  ): Promise<AdminListPage<AdminSecuritySessionView>> {
    this.requirePermission(access, 'administration.security.read', input.scope);
    await this.auditRead(access, input, 'administration.security.read', 'sessions_v2');
    const result = await this.pool.query<SecuritySessionRow>(
      `SELECT session_id, account_id, email, display_name, username,
              workspace_id, workspace_title, created_at, last_seen_at,
              expires_at, revoked_at, session_status, user_agent_summary
         FROM admin_list_security_sessions($1, $2, $3, $4, $5, $6, $7)`,
      [
        access.subject.principalId,
        input.scope.kind,
        input.scope.id,
        input.search,
        input.limit,
        input.cursor?.before ?? null,
        input.cursor?.id ?? null,
      ],
    );
    const items = result.rows.map<AdminSecuritySessionView>((row) => ({
      sessionId: row.session_id,
      accountId: row.account_id,
      email: row.email,
      displayName: row.display_name,
      username: row.username,
      workspaceId: row.workspace_id,
      workspaceTitle: row.workspace_title,
      createdAt: iso(row.created_at),
      lastSeenAt: iso(row.last_seen_at),
      expiresAt: iso(row.expires_at),
      revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
      status: row.session_status,
      userAgentSummary: row.user_agent_summary,
    }));
    return this.page(items, input.limit, (item) => ({
      before: item.lastSeenAt,
      id: item.sessionId,
    }));
  }

  async operationsStatus(
    access: ResolvedAdminAccess,
    input: { readonly requestId: string },
  ): Promise<AdminOperationsStatusView> {
    const scope = { kind: 'platform' as const, id: null };
    this.requirePermission(access, 'administration.operations.read', scope);
    await this.auditRead(
      access,
      { scope, requestId: input.requestId },
      'administration.operations.read',
      'system_status',
    );
    const result = await this.pool.query<OperationsStatusRow>(
      `SELECT database_time, migration_version, migration_name, migration_applied_at,
              total_account_count, active_account_count, suspended_account_count,
              organization_count, active_session_count, audit_event_count_24h
         FROM admin_get_operations_status($1)`,
      [access.subject.principalId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('ADMIN_OPERATIONS_STATUS_MISSING');
    const build = runtimeBuildMetadata();
    const schemaVersion = Number.parseInt(row.migration_version, 10);

    return {
      checkedAt: iso(row.database_time),
      services: { api: 'responding', database: 'responding' },
      migration: {
        version: row.migration_version,
        name: row.migration_name,
        appliedAt: iso(row.migration_applied_at),
      },
      build: {
        revision: build.revision,
        builtAt: build.builtAt,
        expectedSchemaVersion: build.expectedSchemaVersion,
        synchronized:
          build.expectedSchemaVersion === null || !Number.isSafeInteger(schemaVersion)
            ? null
            : build.expectedSchemaVersion === schemaVersion,
      },
      counts: {
        accounts: count(row.total_account_count),
        activeAccounts: count(row.active_account_count),
        suspendedAccounts: count(row.suspended_account_count),
        organizations: count(row.organization_count),
        activeSessions: count(row.active_session_count),
        auditEvents24h: count(row.audit_event_count_24h),
      },
      runtime: this.runtimeMetrics?.snapshot(this.poolStats()) ?? null,
    };
  }

  async setAccountStatus(
    access: ResolvedAdminAccess,
    input: {
      readonly targetAccountId: string;
      readonly status: 'active' | 'suspended';
      readonly reason: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly accountId: string; readonly status: 'active' | 'suspended' }> {
    const scope = { kind: 'platform' as const, id: null };
    this.requirePermission(access, 'administration.accounts.manage', scope);
    if (access.subject.accountId === input.targetAccountId && input.status === 'suspended') {
      throw new Error('ADMIN_SELF_PROTECTION');
    }
    const result = await this.pool.query<{ status: 'active' | 'suspended' }>(
      `SELECT admin_set_account_status($1, $2, $3, $4, $5) AS status`,
      [
        access.subject.principalId,
        input.targetAccountId,
        input.status,
        input.reason,
        input.requestId,
      ],
    );
    const status = result.rows[0]?.status;
    if (!status) throw new Error('ADMIN_ACCOUNT_STATUS_MISSING');
    return { accountId: input.targetAccountId, status };
  }

  async setPlatformAdmin(
    access: ResolvedAdminAccess,
    input: {
      readonly targetAccountId: string;
      readonly enabled: boolean;
      readonly reason: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly accountId: string; readonly platformAdmin: boolean }> {
    const scope = { kind: 'platform' as const, id: null };
    this.requirePermission(access, 'administration.accounts.manage', scope);
    if (access.subject.accountId === input.targetAccountId && !input.enabled) {
      throw new Error('ADMIN_SELF_PROTECTION');
    }
    const result = await this.pool.query<{ enabled: boolean }>(
      `SELECT admin_set_platform_admin($1, $2, $3, $4, $5) AS enabled`,
      [
        access.subject.principalId,
        input.targetAccountId,
        input.enabled,
        input.reason,
        input.requestId,
      ],
    );
    const enabled = result.rows[0]?.enabled;
    if (typeof enabled !== 'boolean') throw new Error('ADMIN_ROLE_STATUS_MISSING');
    return { accountId: input.targetAccountId, platformAdmin: enabled };
  }

  async revokeSession(
    access: ResolvedAdminAccess,
    input: {
      readonly sessionId: string;
      readonly reason: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly sessionId: string; readonly revoked: true }> {
    const scope = { kind: 'platform' as const, id: null };
    this.requirePermission(access, 'administration.security.manage', scope);
    const result = await this.pool.query<{ revoked: boolean }>(
      `SELECT admin_revoke_session($1, $2, $3, $4) AS revoked`,
      [access.subject.principalId, input.sessionId, input.reason, input.requestId],
    );
    if (result.rows[0]?.revoked !== true) throw new Error('ADMIN_SESSION_REVOKE_MISSING');
    return { sessionId: input.sessionId, revoked: true };
  }

  async maxIdentityStatus(
    access: ResolvedAdminAccess,
    targetAccountId: string,
  ): Promise<AdminMaxIdentityView> {
    const scope = { kind: 'platform' as const, id: null };
    this.requirePermission(access, 'administration.accounts.read', scope);
    const result = await this.pool.query<{
      linked: boolean;
      verified_at: Date | string | null;
      last_revoked_at: Date | string | null;
    }>(`SELECT linked, verified_at, last_revoked_at FROM admin_max_identity_status($1, $2)`, [
      access.subject.principalId,
      targetAccountId,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error('ADMIN_ACCOUNT_MISSING');
    return {
      linked: row.linked === true,
      verifiedAt: row.verified_at === null ? null : iso(row.verified_at),
      lastRevokedAt: row.last_revoked_at === null ? null : iso(row.last_revoked_at),
    };
  }

  async revokeMaxIdentity(
    access: ResolvedAdminAccess,
    input: {
      readonly targetAccountId: string;
      readonly reason: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly accountId: string; readonly revoked: boolean }> {
    const scope = { kind: 'platform' as const, id: null };
    this.requirePermission(access, 'administration.security.manage', scope);
    const result = await this.pool.query<{ revoked: boolean }>(
      `SELECT admin_revoke_max_identity($1, $2, $3, $4) AS revoked`,
      [access.subject.principalId, input.targetAccountId, input.reason, input.requestId],
    );
    return { accountId: input.targetAccountId, revoked: result.rows[0]?.revoked === true };
  }

  private requirePermission(
    access: ResolvedAdminAccess,
    permission: AdminPermission,
    scope: { readonly kind: AdminScopeKind; readonly id: string | null },
  ): void {
    if (!this.authorize(access, permission, scope)) throw new Error('ADMIN_SCOPE_DENIED');
  }

  private poolStats(): { total: number; idle: number; waiting: number } | null {
    const candidate = this.pool as unknown as {
      totalCount?: number;
      idleCount?: number;
      waitingCount?: number;
    };
    if (typeof candidate.totalCount !== 'number') return null;
    return {
      total: candidate.totalCount,
      idle: candidate.idleCount ?? 0,
      waiting: candidate.waitingCount ?? 0,
    };
  }

  private async auditRead(
    access: ResolvedAdminAccess,
    input: {
      readonly scope: { readonly kind: AdminScopeKind; readonly id: string | null };
      readonly requestId: string;
    },
    action: AdminPermission,
    targetType: string,
  ): Promise<void> {
    await this.pool.query(
      `SELECT admin_append_audit_event(
         $1, $2, $3, $4,
         $5, NULL, 'admin_console', NULL, NULL, $6, $6, 'succeeded', NULL, NULL
       )`,
      [
        access.subject.principalId,
        input.scope.kind,
        input.scope.id,
        action,
        targetType,
        input.requestId,
      ],
    );
  }

  private page<T>(
    items: readonly T[],
    limit: number,
    cursor: (item: T) => AdminListCursor,
  ): AdminListPage<T> {
    const last = items.at(-1);
    return { items, next: items.length === limit && last ? cursor(last) : null };
  }

  private auditView(row: AuditRow): AdminAuditEventView {
    return {
      id: row.id,
      occurredAt: iso(row.occurred_at),
      actorPrincipalId: row.actor_principal_id,
      actorRole: row.actor_role,
      scopeKind: row.scope_kind,
      scopeId: row.scope_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      reasonCode: row.reason_code,
      reasonText: row.reason_text,
      ticketId: row.ticket_id,
      requestId: row.request_id,
      result: row.result,
      beforeVersion: nullableVersion(row.before_version),
      afterVersion: nullableVersion(row.after_version),
    };
  }
}
