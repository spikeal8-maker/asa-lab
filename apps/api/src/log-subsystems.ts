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

export const LOG_EDITOR_MODULES = [
  'scratch',
  'electronics',
  'three-d',
  'chess',
  'checkers',
] as const;
export const LOG_MODULES = ['portal', 'auth', 'system', ...LOG_EDITOR_MODULES] as const;

export function logEditorModule(value: string): string | undefined {
  if (value === 'blocks') return 'scratch';
  return (LOG_EDITOR_MODULES as readonly string[]).includes(value) ? value : undefined;
}

/** Classification does not confer trust on reported browser context. */
export function logModule(source: string, subsystem: string, reported = '', previous = ''): string {
  if (isHostLogSource(source)) return 'system';
  const own = logEditorModule(source);
  if (own) return own;
  if (source === 'api' || source === 'web') {
    return (
      logEditorModule(subsystem) ??
      logEditorModule(reported) ??
      logEditorModule(previous) ??
      (['auth', 'portal', 'system'].includes(reported)
        ? reported
        : previous || (source === 'api' ? 'portal' : 'system'))
    );
  }
  return previous || 'system';
}

export function safeLogPath(url = '/'): string {
  return url
    .split('?')[0]!
    .replace(/^(\/api\/classroom-teacher-invitations\/)[^/]+.*$/, '$1[redacted]');
}

export function isHostLogSource(source: string): boolean {
  return (
    source.startsWith('windows:') ||
    source.startsWith('linux:') ||
    source === 'docker-desktop' ||
    source === 'docker-lifecycle' ||
    source === 'metrics'
  );
}

/** Server-owned route grouping is independent of the client's editor context. */
export function logSubsystem(
  source: string,
  path = '',
  origin = '',
  kind = '',
  module = '',
): string {
  if (isHostLogSource(source)) return source === 'metrics' ? 'metrics' : 'host';
  const editor = logEditorModule(source);
  if (editor) return editor;
  if (
    source === 'api' &&
    kind === 'client_diagnostic' &&
    (!path || path.startsWith('/api/diagnostics/'))
  ) {
    if (module === 'auth') return 'access';
    if (module === 'portal') return 'web';
    const context = logEditorModule(module);
    if (context) return context;
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
  if (source === 'postgres' || source === 'migration') return 'database';
  if (source.startsWith('minio')) return 'storage';
  if (source === 'tunnel') return 'network';
  if (origin === 'ai_image_jobs' || origin === 'ai_usage_journal') return 'diagnostics';
  if (origin === 'product_analytics_events') return 'analytics';
  if (origin === 'classroom_activity_events') return 'classrooms';
  if (origin === 'grade_change_events') return 'learning';
  if (source === 'auth') return 'access';
  return LOG_SUBSYSTEMS.includes(source as (typeof LOG_SUBSYSTEMS)[number]) ? source : 'audit';
}
