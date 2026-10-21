import { fetchWithSessionRefresh } from './session-fetch';
import { notifyAccountVerificationRequired } from './auth-verification';
import { authRequest, authRequestFailure } from './auth-request';

export interface CoursePrepublicationDiagnostic {
  courseId: string;
  draftRevision: number;
  sectionId: string | null;
  lessonId: string | null;
  blockId: string | null;
  field: string;
  reason: string;
  path: string;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  routes?: string[];
  diagnostic?: CoursePrepublicationDiagnostic;
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    return await authRequest(path, init, async (request): Promise<ApiResult<T>> => {
      const response = await fetchWithSessionRefresh(path, {
        ...request,
        headers: {
          ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...((request.headers as Record<string, string> | undefined) ?? {}),
        },
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Malformed JSON retains the existing stable error handling.
      }
      request.signal?.throwIfAborted();
      if (response.ok) return { ok: true, status: response.status, data: body as T };
      const error =
        (body as { error?: ApiError } | null)?.error ??
        ({ code: 'server_error', message: 'ошибка сервера' } satisfies ApiError);
      if (response.status === 403 && error.code === 'account_verification_required') {
        notifyAccountVerificationRequired();
      }
      return { ok: false, status: response.status, error };
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: authRequestFailure(error) ?? { code: 'network', message: 'сервер недоступен' },
    };
  }
}
