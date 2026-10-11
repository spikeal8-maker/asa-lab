export const LOG_SUBSYSTEMS = [
  'api',
  'web',
  'projects',
  'classrooms',
  'learning',
  'courses',
  'access',
  'analytics',
  'administration',
  'diagnostics',
  'storage',
  'database',
  'scratch',
  'electronics',
  'chess',
  'checkers',
  'three-d',
  'audit',
  'updates',
  'backup',
  'network',
  'host',
  'metrics',
] as const;

export function safeLogPath(url = '/'): string {
  return url
    .split('?')[0]!
    .replace(/^(\/api\/classroom-teacher-invitations\/)[^/]+.*$/, '$1[redacted]');
}

/** Server-owned route grouping is independent of the client's editor context. */
export function logSubsystem(
  source: string,
  path = '',
  origin = '',
  kind = '',
  module = '',
): string {
  if (source === 'api' && kind === 'client_diagnostic') {
    if (module === 'auth') return 'access';
    if (module === 'portal') return 'web';
    if (module === 'scratch' || module === 'electronics') return module;
  }
  if (source === 'web' && path.startsWith('/internal/blocks/')) return 'scratch';
  if (source === 'api') {
    const route = path.split('?')[0]!.split('/')[2] ?? '';
    if (/^(auth|class-join|account|accounts|identity|max|student)/.test(route)) return 'access';
    if (/^classroom/.test(route)) return 'classrooms';
    if (/^(blocks|scratch)/.test(route)) return 'scratch';
    if (/^(files|uploads|storage)/.test(route)) return 'storage';
    if (/^admin/.test(route)) return 'administration';
    if (route === 'assignments') return 'learning';
    if (['session', 'workspaces', 'capabilities', 'schools'].includes(route)) return 'access';
    if (
      [
        'projects',
        'learning',
        'courses',
        'analytics',
        'diagnostics',
        'electronics',
        'chess',
        'checkers',
        'three-d',
      ].includes(route)
    )
      return route;
    return 'api';
  }
  if (source.startsWith('windows:') || source === 'docker-desktop') return 'host';
  if (source === 'postgres' || source === 'migration') return 'database';
  if (source.startsWith('minio')) return 'storage';
  if (source === 'tunnel') return 'network';
  if (origin === 'product_analytics_events') return 'analytics';
  if (origin === 'classroom_activity_events') return 'classrooms';
  if (origin === 'grade_change_events') return 'learning';
  if (source === 'auth') return 'access';
  return LOG_SUBSYSTEMS.includes(source as (typeof LOG_SUBSYSTEMS)[number]) ? source : 'audit';
}
