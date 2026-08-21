/** Server-owned authorization primitives shared by administrative transports. */
export const PACKAGE_NAME = '@asa-lab/authz';

export const ADMIN_PERMISSIONS = [
  'administration.open',
  'administration.scopes.read',
  'administration.audit.read',
  'administration.accounts.read',
  'administration.accounts.manage',
  'administration.organizations.read',
  'administration.security.read',
  'administration.security.manage',
  'administration.moderation.read',
  'administration.billing.read',
  'administration.operations.read',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminScopeKind = 'platform' | 'organization';

export interface AdminCapability {
  readonly capability: string;
  readonly state: string;
}

export interface AdminWorkspaceMembership {
  readonly workspaceId: string;
  readonly kind: string;
  readonly title: string;
  readonly role: string;
}

export interface AdminSubject {
  readonly principalId: string;
  readonly accountId: string;
  readonly capabilities: readonly AdminCapability[];
  readonly workspaces: readonly AdminWorkspaceMembership[];
}

export interface AdminScopeGrant {
  readonly kind: AdminScopeKind;
  /** Platform is the only scope without an object id. */
  readonly id: string | null;
  readonly title: string;
  readonly role: string;
  readonly permissions: readonly AdminPermission[];
}

export interface AdminAuthorizationRequest {
  readonly permission: AdminPermission;
  readonly scope: { readonly kind: AdminScopeKind; readonly id: string | null };
}

export type AdminAuthorizationDecision =
  | { readonly allowed: true; readonly grant: AdminScopeGrant }
  | {
      readonly allowed: false;
      readonly reason: 'no_admin_grant' | 'scope_not_granted' | 'permission_not_granted';
    };

const PLATFORM_PERMISSIONS: readonly AdminPermission[] = ADMIN_PERMISSIONS;

const ORGANIZATION_ROLE_PERMISSIONS: Readonly<Partial<Record<string, readonly AdminPermission[]>>> =
  {
    owner: [
      'administration.open',
      'administration.scopes.read',
      'administration.audit.read',
      'administration.accounts.read',
      'administration.organizations.read',
      'administration.security.read',
      'administration.moderation.read',
      'administration.billing.read',
    ],
    school_admin: [
      'administration.open',
      'administration.scopes.read',
      'administration.audit.read',
      'administration.accounts.read',
      'administration.organizations.read',
      'administration.security.read',
      'administration.moderation.read',
    ],
    moderator: [
      'administration.open',
      'administration.scopes.read',
      'administration.audit.read',
      'administration.moderation.read',
    ],
    billing_admin: [
      'administration.open',
      'administration.scopes.read',
      'administration.audit.read',
      'administration.billing.read',
    ],
  };

/**
 * Resolve the administrative surface strictly from server-owned grants.
 * Personal workspace ownership and educator self-attestation never create an
 * administrative grant. Platform authority additionally requires a verified
 * capability; provisional or suspended capability rows are deliberately inert.
 */
export function resolveAdminScopeGrants(subject: AdminSubject): readonly AdminScopeGrant[] {
  const grants: AdminScopeGrant[] = [];
  const platformAdmin = subject.capabilities.some(
    (entry) => entry.capability === 'platform_admin' && entry.state === 'verified',
  );
  if (platformAdmin) {
    grants.push({
      kind: 'platform',
      id: null,
      title: 'ASA Lab',
      role: 'platform_admin',
      permissions: PLATFORM_PERMISSIONS,
    });
  }

  for (const workspace of subject.workspaces) {
    if (workspace.kind !== 'organization') continue;
    const permissions = ORGANIZATION_ROLE_PERMISSIONS[workspace.role];
    if (!permissions) continue;
    grants.push({
      kind: 'organization',
      id: workspace.workspaceId,
      title: workspace.title,
      role: workspace.role,
      permissions,
    });
  }

  return grants.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'platform' ? -1 : 1;
    return (left.id ?? '').localeCompare(right.id ?? '');
  });
}

export function authorizeAdmin(
  subject: AdminSubject,
  request: AdminAuthorizationRequest,
): AdminAuthorizationDecision {
  const grants = resolveAdminScopeGrants(subject);
  if (grants.length === 0) return { allowed: false, reason: 'no_admin_grant' };

  // A verified platform administrator may operate within a narrower scope,
  // but a workspace administrator can never widen themselves to platform.
  const matching = grants.find(
    (grant) =>
      grant.kind === 'platform' ||
      (request.scope.kind === grant.kind && request.scope.id === grant.id),
  );
  if (!matching) return { allowed: false, reason: 'scope_not_granted' };
  if (!matching.permissions.includes(request.permission)) {
    return { allowed: false, reason: 'permission_not_granted' };
  }
  return { allowed: true, grant: matching };
}
