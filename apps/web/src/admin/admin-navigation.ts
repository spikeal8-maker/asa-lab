import type { AdminProfile, AdminScope } from './admin-api';

export type AdminSection =
  'overview' | 'accounts' | 'organizations' | 'security' | 'confirmations' | 'operations' | 'audit';

export interface AdminNavigationItem {
  readonly id: AdminSection;
  readonly label: string;
  readonly href: string;
}

const ADMIN_SECTIONS: readonly {
  readonly id: AdminSection;
  readonly label: string;
  readonly path: string;
}[] = [
  { id: 'overview', label: 'Обзор', path: '/admin' },
  { id: 'accounts', label: 'Пользователи', path: '/admin/users' },
  { id: 'organizations', label: 'Организации', path: '/admin/organizations' },
  { id: 'security', label: 'Безопасность', path: '/admin/security' },
  { id: 'confirmations', label: 'Подтверждения', path: '/admin/confirmations' },
  { id: 'operations', label: 'Система', path: '/admin/system' },
  { id: 'audit', label: 'История', path: '/admin/history' },
];

export const ADMIN_HREF = '/#/admin';

function normalizedPath(location: { readonly hash: string }): string {
  const path = location.hash.replace(/^#/, '').split('?')[0]?.replace(/\/+$/, '') ?? '';
  return path || '/';
}

export function adminHref(section: AdminSection): string {
  const path = ADMIN_SECTIONS.find((entry) => entry.id === section)?.path ?? '/admin';
  return `/#${path}`;
}

export function adminSectionFromLocation(location: { readonly hash: string }): AdminSection | null {
  const path = normalizedPath(location);
  if (path === '/admin/integrations') return 'confirmations';
  return ADMIN_SECTIONS.find((entry) => entry.path === path)?.id ?? null;
}

export function isAdminLocation(location: { readonly hash: string }): boolean {
  return adminSectionFromLocation(location) !== null;
}

export function scopeSupportsAdminSection(scope: AdminScope, section: AdminSection): boolean {
  if (section === 'overview') return true;
  if (section === 'accounts') return scope.permissions.includes('administration.accounts.read');
  if (section === 'organizations') {
    return scope.permissions.includes('administration.organizations.read');
  }
  if (section === 'security') return scope.permissions.includes('administration.security.read');
  if (section === 'audit') return scope.permissions.includes('administration.audit.read');
  return scope.kind === 'platform' && scope.permissions.includes('administration.operations.read');
}

export function adminNavigationItems(profile: AdminProfile): readonly AdminNavigationItem[] {
  return ADMIN_SECTIONS.filter((entry) =>
    profile.scopes.some((scope) => scopeSupportsAdminSection(scope, entry.id)),
  ).map((entry) => ({
    id: entry.id,
    label: entry.label,
    href: `/#${entry.path}`,
  }));
}
