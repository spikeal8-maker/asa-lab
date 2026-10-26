import { AuthRequestError } from './auth-request';

// Fixed labels only: never export a URL, route parameter, body or error message.
export const REQUEST_OPERATIONS = [
  'auth_me',
  'auth_refresh',
  'auth_other',
  'project_read',
  'project_save',
  'electronics_draft_read',
  'electronics_draft_write',
  'blocks_runtime_session',
  'other_api',
] as const;
export const REQUEST_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'OTHER',
] as const;
export const REQUEST_FAILURE_KINDS = [
  'http',
  'timeout',
  'cancelled',
  'network',
  'unknown',
] as const;

export function requestMethod(method: string): string {
  const normalized = method.toUpperCase();
  return REQUEST_METHODS.includes(normalized as (typeof REQUEST_METHODS)[number])
    ? normalized
    : 'OTHER';
}

export function requestOperation(path: string, method: string, module: string): string {
  if (path === '/api/auth/me') return 'auth_me';
  if (path === '/api/auth/refresh') return 'auth_refresh';
  if (path.startsWith('/api/auth/')) return 'auth_other';
  if (/^\/api\/projects\/[^/]+\/blocks\/runtime-session$/.test(path))
    return 'blocks_runtime_session';
  const read = method === 'GET' || method === 'HEAD';
  if (/^\/api\/projects\/[^/]+$/.test(path) && read)
    return module === 'electronics' ? 'electronics_draft_read' : 'project_read';
  if (/^\/api\/projects\/[^/]+\/draft$/.test(path) && (read || method === 'PUT'))
    return module === 'electronics'
      ? read
        ? 'electronics_draft_read'
        : 'electronics_draft_write'
      : read
        ? 'project_read'
        : 'project_save';
  return 'other_api';
}

export function requestFailureKind(failure: unknown, signal?: AbortSignal | null): string {
  const dom = failure instanceof DOMException;
  if (signal?.aborted && (signal.reason === failure || (dom && failure.name === 'AbortError'))) {
    const reason = signal.reason;
    if (
      (reason instanceof AuthRequestError && reason.code === 'auth_timeout') ||
      (reason instanceof DOMException && reason.name === 'TimeoutError')
    )
      return 'timeout';
    return 'cancelled';
  }
  return !signal?.aborted && failure instanceof TypeError ? 'network' : 'unknown';
}

export function validRequestDetails(v: Record<string, unknown>): boolean {
  return (
    (v.operation === undefined ||
      REQUEST_OPERATIONS.includes(v.operation as (typeof REQUEST_OPERATIONS)[number])) &&
    (v.method === undefined ||
      REQUEST_METHODS.includes(v.method as (typeof REQUEST_METHODS)[number])) &&
    (v.failureKind === undefined ||
      REQUEST_FAILURE_KINDS.includes(v.failureKind as (typeof REQUEST_FAILURE_KINDS)[number])) &&
    (v.code !== 'request_cancelled' ||
      (v.failureKind === 'cancelled' &&
        ['GET', 'HEAD'].includes(v.method as string) &&
        v.phase === 'request'))
  );
}
