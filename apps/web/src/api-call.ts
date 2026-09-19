import { fetchWithSessionRefresh } from './session-fetch';

export interface ApiError {
  code: string;
  message: string;
  routes?: string[];
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  const headers: Record<string, string> = {
    ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  try {
    response = await fetchWithSessionRefresh(path, {
      ...init,
      headers,
    });
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: 'сервер недоступен' } };
  }

  let body: unknown;
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
