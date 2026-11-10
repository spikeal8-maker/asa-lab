import { fetchWithSessionRefresh, type SessionRequestInit } from './session-fetch';
import { notifyAccountVerificationRequired } from './auth-verification';
import { authRequest, authRequestFailure } from './auth-request';
import {
  beginPortalMutation,
  portalMutationCompleted,
  portalRead,
  retryAfterMilliseconds,
  schedulePortalJson,
} from './portal-requests';

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
  retryAfterMs?: number;
  routes?: string[];
  diagnostic?: CoursePrepublicationDiagnostic;
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export async function call<T>(path: string, init: SessionRequestInit = {}): Promise<ApiResult<T>> {
  try {
    return await authRequest(path, init, async (request): Promise<ApiResult<T>> => {
      const headers = new Headers(request.headers);
      if (request.body !== undefined && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
      const prepared = {
        ...request,
        headers: Object.fromEntries(headers.entries()),
      };
      const finishMutation = beginPortalMutation(path, prepared);
      try {
        const result = await portalRead(path, prepared, (shared) =>
          schedulePortalJson(path, shared, async (): Promise<ApiResult<T>> => {
            const response = await fetchWithSessionRefresh(path, {
              ...shared,
              ...(init.retryAfterRefresh ? { retryAfterRefresh: init.retryAfterRefresh } : {}),
            });
            let body: unknown = null;
            try {
              body = await response.json();
            } catch {
              // Malformed JSON retains the existing stable error handling.
            }
            shared.signal?.throwIfAborted();
            if (response.ok) return { ok: true, status: response.status, data: body as T };
            const error =
              (body as { error?: ApiError } | null)?.error ??
              ({ code: 'server_error', message: 'ошибка сервера' } satisfies ApiError);
            if (response.status === 403 && error.code === 'account_verification_required') {
              notifyAccountVerificationRequired();
            }
            const retryAfterMs = retryAfterMilliseconds(response);
            return {
              ok: false,
              status: response.status,
              error: { ...error, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
            };
          }),
        );
        if (result.ok) portalMutationCompleted(path, prepared);
        return result;
      } finally {
        finishMutation();
      }
    });
  } catch (error) {
    const intentionallyCancelled =
      init.signal?.aborted ||
      (error !== null &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'AbortError');
    return {
      ok: false,
      status: 0,
      error:
        authRequestFailure(error) ??
        (intentionallyCancelled
          ? { code: 'request_cancelled', message: 'Запрос отменён.' }
          : { code: 'network', message: 'сервер недоступен' }),
    };
  }
}
