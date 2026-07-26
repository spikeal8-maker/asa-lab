/** Thin same-origin API client. The session lives in an HttpOnly cookie; the
 * client never sends or stores tenant identifiers. */

export interface PublicUser {
  id: string;
  role: string;
  displayName: string;
  email: string;
}

export interface Classroom {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  // A JSON content-type is only declared when a body is actually sent: an
  // empty body with that header is rejected by the server's strict parser.
  const headers: Record<string, string> = {
    ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers,
    });
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: 'сервер недоступен' } };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) {
    return { ok: true, status: response.status, data: body as T };
  }
  const error =
    (body as { error?: ApiError } | null)?.error ??
    ({ code: 'server_error', message: 'ошибка сервера' } satisfies ApiError);
  return { ok: false, status: response.status, error };
}

export const api = {
  me: () => call<{ user: PublicUser }>('/api/auth/me'),
  login: (workspace: string, email: string, password: string) =>
    call<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ workspace, email, password }),
    }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  listClassrooms: () => call<{ items: Classroom[]; meta: { total: number } }>('/api/classrooms'),
  createClassroom: (title: string, idempotencyKey: string) =>
    call<{ classroom: Classroom; created: boolean }>('/api/classrooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ title }),
    }),
};
