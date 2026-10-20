import { call, type ApiResult } from '../api-call';

export interface PublicProject {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly versionNo: number;
  readonly title: string;
  readonly summary: string | null;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly license: string;
  readonly moduleKey: string;
  readonly authorLabel: string;
  readonly publishedAt: string;
  readonly preview: {
    readonly url: string;
    readonly contentType: string;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly capabilities: {
    readonly viewer: 'static';
    readonly canCopy: boolean;
    readonly downloadFormats: readonly string[];
  };
}

export interface ProjectPublicationStatus {
  readonly publication: {
    readonly publicationId: string;
    readonly revisionId: string;
    readonly revisionNo: number;
    readonly versionNo: number;
    readonly state: 'public' | 'revoked' | 'unlisted' | 'draft';
    readonly publishedAt: string;
    readonly publicPath: string | null;
  } | null;
  readonly canPublish: boolean;
  readonly reasonCode: string | null;
}

export interface PublicationMetadata {
  readonly title: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly license: string;
}

export interface PublicProjectList {
  readonly items: readonly PublicProject[];
  readonly nextOffset: number | null;
}

export interface PublicProjectCopy {
  readonly projectId: string;
  readonly moduleKey: string;
  readonly created: boolean;
}

/** Public reads use only the immutable publication namespace. */
export const publicProjectsApi = {
  list: (input: { search?: string; module?: string; offset?: number } = {}) => {
    const query = new URLSearchParams({ offset: String(input.offset ?? 0), limit: '24' });
    if (input.search) query.set('q', input.search);
    if (input.module) query.set('module', input.module);
    return call<PublicProjectList>(`/api/public-projects?${query}`, { cache: 'no-store' });
  },
  get: (publicationId: string) =>
    call<{ publication: PublicProject }>(
      `/api/public-projects/${encodeURIComponent(publicationId)}`,
      { cache: 'no-store' },
    ),
  copy: (publicationId: string, revisionId: string, idempotencyKey: string, signal: AbortSignal) =>
    call<PublicProjectCopy>(`/api/public-projects/${encodeURIComponent(publicationId)}/copy`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ revisionId }),
      signal,
    }),
  status: (projectId: string) =>
    call<ProjectPublicationStatus>(`/api/projects/${encodeURIComponent(projectId)}/publication`, {
      cache: 'no-store',
    }),
  publish: (projectId: string, metadata: PublicationMetadata) =>
    call<ProjectPublicationStatus>(`/api/projects/${encodeURIComponent(projectId)}/publication`, {
      method: 'POST',
      body: JSON.stringify(metadata),
    }),
  revoke: (projectId: string) =>
    call<ProjectPublicationStatus>(`/api/projects/${encodeURIComponent(projectId)}/publication`, {
      method: 'DELETE',
    }),
};

export function publicationError(
  result: Extract<ApiResult<unknown>, { ok: false }>,
  fallback: string,
): string {
  if (result.status === 0) return 'Сервер недоступен. Проверьте соединение и повторите.';
  if (result.status === 401) return 'Войдите в свой аккаунт, чтобы управлять публикацией.';
  if (result.error.code === 'preview_required')
    return 'Откройте проект в редакторе и дождитесь сохранения: для публикации нужно актуальное изображение.';
  if (result.error.code === 'learning_work_protected')
    return 'Оригинальную учебную работу нельзя публиковать.';
  if (result.error.code === 'publication_forbidden' || result.status === 403)
    return 'Публикация этой работы ограничена настройками доступа.';
  if (result.status === 404) return 'Проект недоступен для управления публикацией.';
  return fallback;
}
