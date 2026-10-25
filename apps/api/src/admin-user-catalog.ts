import type { AdminAccountView } from './admin-control-plane.service.js';

export const CATALOG_KINDS = ['all', 'accounts', 'students'] as const;
export const CATALOG_STATUSES = ['all', 'active', 'inactive'] as const;
export const CATALOG_SORTS = ['name', 'last_activity', 'activity', 'created'] as const;
export interface AdminCatalogQuery {
  kind: (typeof CATALOG_KINDS)[number];
  status: (typeof CATALOG_STATUSES)[number];
  sort: (typeof CATALOG_SORTS)[number];
  direction: 'asc' | 'desc';
  limit: number;
  cursor: Record<string, unknown> | null;
}
export interface AdminCatalogUser {
  kind: 'account' | 'student';
  id: string;
  actorKey: string;
  principalId: string | null;
  displayName: string;
  login: string | null;
  email: string | null;
  status: string;
  normalizedStatus: 'active' | 'inactive';
  createdAt: string;
  lastSeenAt: string | null;
  lastActivityAt: string | null;
  recentActivityCount: number;
  lastIpAddress: string | null;
  lastNetworkKind: string | null;
  lastDevice: string | null;
  browser: string | null;
  operatingSystem: string | null;
  deviceCategory: string | null;
  classId: string | null;
  classTitle: string | null;
  classStatus: string | null;
  account: AdminAccountView | null;
}
export interface AdminCatalogPage {
  items: AdminCatalogUser[];
  asOf: string;
  studentCoverage: {
    state: 'complete' | 'unavailable';
    reason?: 'organization_class_mapping_unavailable';
  };
  next: string | null;
}
function invalid(): never {
  throw Object.assign(new Error('ADMIN_CATALOG_QUERY_INVALID'), { code: '22023' });
}
function choice<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  return allowed.includes(value as T) ? (value as T) : invalid();
}
export function parseCatalogQuery(
  raw: Partial<
    Record<
      | 'kind'
      | 'status'
      | 'sort'
      | 'direction'
      | 'limit'
      | 'cursor'
      | 'search'
      | 'scopeKind'
      | 'scopeId',
      string | undefined
    >
  >,
): AdminCatalogQuery {
  for (const value of Object.values(raw))
    if (value !== undefined && typeof value !== 'string') invalid();
  const limit =
    raw.limit === undefined ? 50 : /^[0-9]{1,3}$/.test(raw.limit) ? Number(raw.limit) : invalid();
  if (limit < 1 || limit > 100) invalid();
  let cursor: Record<string, unknown> | null = null;
  if (raw.cursor !== undefined) {
    if (raw.cursor.length > 4096 || !raw.cursor.length || !/^[A-Za-z0-9_-]+$/.test(raw.cursor))
      invalid();
    try {
      const decoded = Buffer.from(raw.cursor, 'base64url');
      if (decoded.toString('base64url') !== raw.cursor) invalid();
      const value: unknown = JSON.parse(decoded.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
      cursor = value as Record<string, unknown>;
    } catch {
      invalid();
    }
  }
  return {
    kind: choice(raw.kind, CATALOG_KINDS, 'all'),
    status: choice(raw.status, CATALOG_STATUSES, 'all'),
    sort: choice(raw.sort, CATALOG_SORTS, 'last_activity'),
    direction: choice(raw.direction, ['asc', 'desc'], 'desc'),
    limit,
    cursor,
  };
}
