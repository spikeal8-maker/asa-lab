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
  operationsStatus: () => call<AdminOperationsStatus>('/api/admin/v1/operations/status'),
  accounts: (input: AdminListInput) => list<AdminAccount>('/api/admin/v1/accounts', input),
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
