import { fetchWithSessionRefresh } from '../session-fetch';

export type AdminPermission =
  | 'administration.open'
  | 'administration.scopes.read'
  | 'administration.audit.read'
  | 'administration.accounts.read'
  | 'administration.accounts.manage'
  | 'administration.organizations.read'
  | 'administration.security.read'
  | 'administration.security.manage'
  | 'administration.moderation.read'
  | 'administration.billing.read'
  | 'administration.operations.read';

export type AdminScopeKind = 'platform' | 'organization';

export interface AdminScope {
  readonly kind: AdminScopeKind;
  readonly id: string | null;
  readonly title: string;
  readonly role: 'platform_admin' | 'owner' | 'school_admin' | 'moderator' | 'billing_admin';
  readonly permissions: readonly AdminPermission[];
}

export interface AdminProfile {
  readonly administrator: true;
  readonly principalId: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly activeWorkspaceId: string;
  readonly scopes: readonly AdminScope[];
}

export interface AdminAuditCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface AdminAuditEvent {
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

export interface AdminAuditPage {
  readonly items: readonly AdminAuditEvent[];
  readonly next: AdminAuditCursor | null;
}

export interface AdminListCursor {
  readonly before: string;
  readonly id: string;
}

export interface AdminAccount {
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
  readonly lastIpAddress: string | null;
  readonly lastDevice: string | null;
  readonly recentActivityCount: number;
}

export type AdminIpLabelKind = 'school' | 'home' | 'mobile' | 'organization' | 'other';

export interface AdminAccountCrm {
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
  readonly username: string;
  readonly status: string;
  readonly emailVerificationState: string;
  readonly createdAt: string;
  readonly firstAuthenticatedAt: string | null;
  readonly organizations: readonly {
    readonly workspaceId: string;
    readonly title: string;
    readonly role: string;
    readonly state: string;
  }[];
  readonly sessions: readonly {
    readonly sessionId: string;
    readonly workspaceId: string;
    readonly workspaceTitle: string;
    readonly createdAt: string;
    readonly lastSeenAt: string;
    readonly expiresAt: string;
    readonly revokedAt: string | null;
    readonly status: 'active' | 'expired' | 'revoked';
    readonly device: string | null;
  }[];
  readonly activity: readonly {
    readonly id: number;
    readonly occurredAt: string;
    readonly eventType: string;
    readonly outcome: string;
    readonly authMethod: string | null;
    readonly moduleKey: string | null;
    readonly ipAddress: string | null;
    readonly device: string | null;
  }[];
  readonly ipAddresses: readonly {
    readonly address: string;
    readonly firstSeenAt: string;
    readonly lastSeenAt: string;
    readonly eventCount: number;
    readonly device: string | null;
    readonly labelKind: AdminIpLabelKind | null;
    readonly label: string | null;
  }[];
  readonly notes: readonly {
    readonly id: string;
    readonly note: string;
    readonly createdAt: string;
    readonly authorDisplayName: string;
  }[];
  readonly max: { readonly linked: boolean; readonly verifiedAt: string | null };
}

export interface AdminMaxIdentity {
  readonly linked: boolean;
  readonly verifiedAt: string | null;
  readonly lastRevokedAt: string | null;
}

export interface AdminMaxConfiguration {
  readonly enabled: boolean;
  readonly featureEnabled: boolean;
  readonly tokenConfigured: boolean;
  readonly botUsername: string | null;
  readonly launchUrl: string | null;
  readonly miniAppUrl: string | null;
  readonly encryptionReady: boolean;
  readonly tokenFingerprint: string | null;
  readonly verifiedBotId: string | null;
  readonly verifiedBotName: string | null;
  readonly tokenVerifiedAt: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
}

export interface AdminOrganization {
  readonly workspaceId: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly memberCount: number;
  readonly administratorCount: number;
  readonly activeSessionCount: number;
}

export interface AdminSecuritySession {
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

export interface AdminOperationsStatus {
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
  readonly runtime: {
    readonly uptimeSeconds: number;
    readonly eventLoopDelayMs: { readonly p50: number; readonly p99: number; readonly max: number };
    readonly memory: { readonly rssMb: number; readonly heapUsedMb: number };
    readonly host: {
      readonly cpuUsedByApiPercent: number;
      readonly logicalCpuCount: number;
      readonly memoryTotalMb: number;
      readonly memoryUsedPercent: number;
    };
    readonly requests: {
      readonly total: number;
      readonly inFlight: number;
      readonly byStatusClass: Readonly<Record<string, number>>;
      readonly durationMs: { readonly p50: number; readonly p95: number; readonly p99: number };
    };
    readonly database: {
      readonly total: number;
      readonly idle: number;
      readonly waiting: number;
    } | null;
  } | null;
}

export type AdminDashboardRange = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '1y';

export interface AdminDashboardPoint {
  readonly at: string;
  readonly newAccounts: number;
  readonly activeAccounts: number;
  readonly successfulLogins: number;
  readonly failedLogins: number;
  readonly newStudents: number;
  readonly activeStudents: number;
}

export interface AdminModulePoint {
  readonly at: string;
  readonly moduleKey: 'electronics' | 'three-d' | 'chess' | 'checkers';
  readonly activePeople: number;
  readonly launches: number;
}

export interface AdminLoginMethodPoint {
  readonly at: string;
  readonly method: 'password' | 'organization' | 'max' | 'class_code';
  readonly successfulLogins: number;
}

export interface AdminActionPoint {
  readonly at: string;
  readonly classesCreated: number;
  readonly projectsCreated: number;
  readonly maxLinked: number;
  readonly passwordRecoveryAvailable: boolean;
}

export interface AdminProductDashboard {
  readonly generatedAt: string;
  readonly analyticsStartedAt: string | null;
  readonly from: string;
  readonly to: string;
  readonly bucketSeconds: number;
  readonly range: AdminDashboardRange;
  readonly summary: {
    readonly newAccounts: number;
    readonly activeAccounts: number;
    readonly successfulLogins: number;
    readonly failedLogins: number;
    readonly newStudents: number;
    readonly activeStudents: number;
    readonly distinctIpAddresses: number;
    readonly accountsWithMultipleIps: number;
  };
  readonly timeline: readonly AdminDashboardPoint[];
  readonly modules: readonly AdminModulePoint[];
  readonly loginMethods: readonly AdminLoginMethodPoint[];
  readonly actions: readonly AdminActionPoint[];
  readonly max: {
    readonly configured: boolean;
    readonly featureEnabled: boolean;
    readonly tokenConfigured: boolean;
    readonly botUsername: string | null;
    readonly launchUrl: string | null;
    readonly miniAppUrl: string | null;
    readonly encryptionReady: boolean;
    readonly tokenFingerprint: string | null;
    readonly verifiedBotId: string | null;
    readonly verifiedBotName: string | null;
    readonly tokenVerifiedAt: string | null;
    readonly configurationVersion: number;
    readonly updatedAt: string | null;
    readonly linkedAccounts: number;
    readonly promptDueAccounts: number;
  };
}

export interface AdminIpActivity {
  readonly accountId: string;
  readonly email: string;
  readonly displayName: string;
  readonly distinctIpCount: number;
  readonly lastSeenAt: string;
  readonly addresses: readonly string[];
}

export interface AdminApiError {
  readonly code: string;
  readonly message: string;
}

export type AdminApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly error: AdminApiError };

async function call<T>(path: string, init: RequestInit = {}): Promise<AdminApiResult<T>> {
  let response: Response;
  try {
    response = await fetchWithSessionRefresh(path, {
      ...init,
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Сервер администрирования недоступен.' },
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A malformed response is handled below as a stable server error.
  }
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const error = (body as { error?: AdminApiError } | null)?.error ?? {
    code: 'server_error',
    message: 'Не удалось выполнить административный запрос.',
  };
  return { ok: false, status: response.status, error };
}

interface AdminListInput {
  readonly scope: Pick<AdminScope, 'kind' | 'id'>;
  readonly search?: string;
  readonly limit?: number;
  readonly cursor?: AdminListCursor | null;
}

function list<T>(path: string, input: AdminListInput): Promise<AdminApiResult<AdminListPage<T>>> {
  const query = new URLSearchParams({
    scopeKind: input.scope.kind,
    limit: String(input.limit ?? 50),
  });
  if (input.scope.id !== null) query.set('scopeId', input.scope.id);
  const search = input.search?.trim();
  if (search) query.set('search', search);
  if (input.cursor) {
    query.set('before', input.cursor.before);
    query.set('beforeId', input.cursor.id);
  }
  return call<AdminListPage<T>>(`${path}?${query.toString()}`);
}

export const adminApi = {
  me: () => call<AdminProfile>('/api/admin/v1/me'),
  dashboard: (input: {
    readonly scope: Pick<AdminScope, 'kind' | 'id'>;
    readonly range: AdminDashboardRange;
  }) => {
    const query = new URLSearchParams({ scopeKind: input.scope.kind, range: input.range });
    if (input.scope.id !== null) query.set('scopeId', input.scope.id);
    return call<AdminProductDashboard>(`/api/admin/v1/dashboard?${query.toString()}`);
  },
  ipActivity: (input: {
    readonly scope: Pick<AdminScope, 'kind' | 'id'>;
    readonly range: AdminDashboardRange;
    readonly minimumDistinct?: number;
  }) => {
    const query = new URLSearchParams({
      scopeKind: input.scope.kind,
      range: input.range,
      minimumDistinct: String(input.minimumDistinct ?? 2),
      limit: '100',
    });
    if (input.scope.id !== null) query.set('scopeId', input.scope.id);
    return call<{ readonly items: readonly AdminIpActivity[] }>(
      `/api/admin/v1/security/ip-activity?${query.toString()}`,
    );
  },
  operationsStatus: () => call<AdminOperationsStatus>('/api/admin/v1/operations/status'),
  maxConfiguration: () => call<AdminMaxConfiguration>('/api/admin/v1/integrations/max'),
  updateMaxConfiguration: (input: {
    readonly enabled: boolean;
    readonly botUsername: string;
    readonly miniAppUrl: string;
    readonly botToken?: string;
    readonly clearToken?: boolean;
    readonly reason: string;
  }) =>
    call<AdminMaxConfiguration>('/api/admin/v1/integrations/max', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  accounts: (input: AdminListInput) => list<AdminAccount>('/api/admin/v1/accounts', input),
  accountCrm: (
    accountId: string,
    scope: Pick<AdminScope, 'kind' | 'id'>,
  ): Promise<AdminApiResult<AdminAccountCrm>> => {
    const query = new URLSearchParams({ scopeKind: scope.kind });
    if (scope.id !== null) query.set('scopeId', scope.id);
    return call<AdminAccountCrm>(
      `/api/admin/v1/accounts/${encodeURIComponent(accountId)}/crm?${query.toString()}`,
    );
  },
  addAccountNote: (accountId: string, note: string) =>
    call<{ readonly id: string }>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  setAccountIpLabel: (
    accountId: string,
    input: {
      readonly ipAddress: string;
      readonly labelKind: AdminIpLabelKind;
      readonly label: string | null;
    },
  ) =>
    call<{ readonly id: string }>(
      `/api/admin/v1/accounts/${encodeURIComponent(accountId)}/ip-labels`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  setAccountStatus: (
    accountId: string,
    input: { readonly status: 'active' | 'suspended'; readonly reason: string },
  ) =>
    call<{ accountId: string; status: 'active' | 'suspended' }>(
      `/api/admin/v1/accounts/${encodeURIComponent(accountId)}/status`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  setPlatformAdmin: (
    accountId: string,
    input: { readonly enabled: boolean; readonly reason: string },
  ) =>
    call<{ accountId: string; platformAdmin: boolean }>(
      `/api/admin/v1/accounts/${encodeURIComponent(accountId)}/platform-admin`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  maxIdentity: (accountId: string) =>
    call<AdminMaxIdentity>(`/api/admin/v1/accounts/${encodeURIComponent(accountId)}/max`),
  revokeMaxIdentity: (accountId: string, input: { readonly reason: string }) =>
    call<{ accountId: string; revoked: boolean }>(
      `/api/admin/v1/accounts/${encodeURIComponent(accountId)}/max/revoke`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  organizations: (input: AdminListInput) =>
    list<AdminOrganization>('/api/admin/v1/organizations', input),
  securitySessions: (input: AdminListInput) =>
    list<AdminSecuritySession>('/api/admin/v1/security/sessions', input),
  revokeSession: (sessionId: string, input: { readonly reason: string }) =>
    call<{ sessionId: string; revoked: true }>(
      `/api/admin/v1/security/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  auditEvents: (input: {
    readonly scope: Pick<AdminScope, 'kind' | 'id'>;
    readonly limit?: number;
    readonly cursor?: AdminAuditCursor | null;
  }) => {
    const query = new URLSearchParams({
      scopeKind: input.scope.kind,
      limit: String(input.limit ?? 50),
    });
    if (input.scope.id !== null) query.set('scopeId', input.scope.id);
    if (input.cursor) {
      query.set('before', input.cursor.occurredAt);
      query.set('beforeId', input.cursor.id);
    }
    return call<AdminAuditPage>(`/api/admin/v1/audit-events?${query.toString()}`);
  },
};
