/** Deadlines apply only to authentication and provider configuration requests. */
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export class AuthRequestError extends Error {
  constructor(readonly code: 'auth_timeout' | 'auth_cancelled') {
    super(
      code === 'auth_timeout'
        ? 'Сервер не ответил вовремя. Результат действия пока неизвестен. Проверьте состояние перед повтором.'
        : 'Запрос отменён. Результат действия пока неизвестен.',
    );
    this.name = 'AuthRequestError';
  }
}

export function isAuthRequest(path: string): boolean {
  const pathname = path.split('?')[0]!;
  return (
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/admin/v1/auth/verification-policy' ||
    /^\/api\/admin\/v1\/integrations\/(max|telegram)(\/check)?$/.test(pathname)
  );
}

/** A late promise may settle, but it cannot win after cancellation. */
export function abortable<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new AuthRequestError('auth_cancelled'));
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    try {
      // Preserve fetch's immediate start for existing non-auth AbortSignal users.
      // Deferring this call can drop an already-started operation when a second
      // event synchronously cancels the first request.
      void operation()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', aborted));
    } catch (error) {
      signal.removeEventListener('abort', aborted);
      reject(error);
    }
  });
}

/** Covers fetch, refresh and response-body reading without retrying writes. */
export async function authRequest<T>(
  path: string,
  init: RequestInit,
  operation: (request: RequestInit) => Promise<T>,
): Promise<T> {
  if (!isAuthRequest(path)) return operation(init);
  const controller = new AbortController();
  const cancelled = () => controller.abort(new AuthRequestError('auth_cancelled'));
  const timeout = setTimeout(
    () => controller.abort(new AuthRequestError('auth_timeout')),
    AUTH_REQUEST_TIMEOUT_MS,
  );
  if (init.signal?.aborted) cancelled();
  else init.signal?.addEventListener('abort', cancelled, { once: true });
  try {
    return await abortable(
      () => operation({ ...init, signal: controller.signal }),
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', cancelled);
  }
}

export function authRequestFailure(error: unknown): { code: string; message: string } | null {
  return error instanceof AuthRequestError ? { code: error.code, message: error.message } : null;
}
