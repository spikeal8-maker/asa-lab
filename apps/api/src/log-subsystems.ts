export const LOG_SUBSYSTEMS = [
  'api',
  'web',
  'projects',
  'classrooms',
  'learning',
  'courses',
  'ai',
  'access',
  'analytics',
  'administration',
  'diagnostics',
  'storage',
  'database',
  'scratch',
  'electronics',
  'robotics',
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
  'robotics',
  'three-d',
  'chess',
  'checkers',
] as const;
export const LOG_MODULES = ['portal', 'auth', 'system', 'ai', ...LOG_EDITOR_MODULES] as const;
export const CLIENT_DIAGNOSTIC_MODULES = ['portal', 'auth', ...LOG_EDITOR_MODULES] as const;

const DATABASE_SUBSYSTEMS: Readonly<Record<string, string>> = {
  ai_image_jobs: 'ai',
  ai_usage_journal: 'ai',
  chess_live_events: 'chess',
  checkers_reaction_events: 'checkers',
  product_analytics_events: 'analytics',
  classroom_activity_events: 'classrooms',
  grade_change_events: 'learning',
};

export function logEditorModule(value: string): string | undefined {
  if (value === 'blocks') return 'scratch';
  return (LOG_EDITOR_MODULES as readonly string[]).includes(value) ? value : undefined;
}

/** Classification does not confer trust on reported browser context. */
export function logModule(source: string, subsystem: string, reported = '', previous = ''): string {
  if (isHostLogSource(source)) return 'system';
  const own = logEditorModule(source);
  if (own) return own;
  if (subsystem === 'ai' || (source === 'audit' && ['chess', 'checkers'].includes(subsystem)))
    return subsystem;
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
  const [, prefix, route = '', child, section] = path.split('?')[0]!.split('/');
  if ((source === 'api' || source === 'web') && prefix === 'api') {
    if (route === 'games' && (child === 'chess' || child === 'checkers')) return child;
    if (route === 'ai' || (route === 'admin' && child === 'v1' && section === 'ai')) return 'ai';
    const editorRoute = logEditorModule(route);
    if (editorRoute) return editorRoute;
  }
  if (source === 'api') {
    if (/^(auth|class-join|account|accounts|identity|max|student)/.test(route)) return 'access';
    if (/^classroom/.test(route)) return 'classrooms';
    if (/^(blocks|scratch)/.test(route)) return 'scratch';
    if (/^(files|uploads|storage)/.test(route)) return 'storage';
    if (/^admin/.test(route)) return 'administration';
    if (route === 'assignments') return 'learning';
    if (['session', 'workspaces', 'capabilities', 'schools'].includes(route)) return 'access';
    if (['projects', 'learning', 'courses', 'analytics', 'diagnostics'].includes(route))
      return route;
    return 'api';
  }
  if (source === 'postgres' || source === 'migration') return 'database';
  if (source.startsWith('minio')) return 'storage';
  if (source === 'tunnel') return 'network';
  if (Object.hasOwn(DATABASE_SUBSYSTEMS, origin)) return DATABASE_SUBSYSTEMS[origin]!;
  if (source === 'auth') return 'access';
  return LOG_SUBSYSTEMS.includes(source as (typeof LOG_SUBSYSTEMS)[number]) ? source : 'audit';
}
