import { call, type ApiResult } from '../api-call';
import {
  validatePublicProjectDisplayArtifact,
  type PublicProjectDisplayArtifact,
} from '@asa-lab/contracts';

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
  readonly authorAvatarUrl?: string | null;
  readonly featured: boolean;
  readonly pinned: boolean;
  readonly likeCount?: number;
  /** Successfully created personal copies; not physical file downloads. */
  readonly copyCount?: number;
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
  readonly acquisition?: { readonly allowed: boolean; readonly version: number } | null;
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
  /** Owner-only administrative reason; never part of the public project DTO. */
  readonly moderationReason?: string | null;
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

export interface PublicationLikeState {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly liked: boolean;
  readonly canLike: boolean;
  readonly canUnlike: boolean;
  readonly reactionsEnabled: boolean;
  readonly likeCount: number;
  readonly reason: 'own_work' | 'reactions_disabled' | null;
}

/** Public reads use only the immutable publication namespace. */
export const publicProjectsApi = {
  likeState: (publicationId: string, signal: AbortSignal) =>
    call<PublicationLikeState>(`/api/public-projects/${encodeURIComponent(publicationId)}/like`, {
      cache: 'no-store',
      signal,
    }),
  like: (publicationId: string, revisionId: string, on: boolean, signal: AbortSignal) =>
    call<{ liked: boolean }>(`/api/public-projects/${encodeURIComponent(publicationId)}/like`, {
      method: 'PUT',
      cache: 'no-store',
      body: JSON.stringify({ revisionId, on }),
      signal,
    }),
  artifact: async (
    publicationId: string,
    revisionId: string,
    signal: AbortSignal,
  ): Promise<ApiResult<{ artifact: PublicProjectDisplayArtifact }>> => {
    const result = await call<{ artifact: unknown }>(
      `/api/public-projects/${encodeURIComponent(publicationId)}/artifact?revisionId=${encodeURIComponent(revisionId)}`,
      { cache: 'no-store', signal },
    );
    if (!result.ok) return result;
    const validated = validatePublicProjectDisplayArtifact(result.data?.artifact);
    if (!validated.ok)
      return {
        ok: false,
        status: 502,
        error: { code: 'invalid_public_artifact', message: 'Некорректный формат просмотра' },
      };
    return { ok: true, status: result.status, data: { artifact: validated.artifact } };
  },
  list: (
    input: {
      search?: string;
      module?: string;
      offset?: number;
      sort?: 'newest' | 'oldest' | 'likes' | 'copies';
    } = {},
  ) => {
    const query = new URLSearchParams({
      offset: String(input.offset ?? 0),
      limit: '24',
      catalog: 'projects',
    });
    if (input.search) query.set('q', input.search);
    if (input.module) query.set('module', input.module);
    if (input.sort) query.set('sort', input.sort);
    return call<PublicProjectList>(`/api/public-projects?${query}`, { cache: 'no-store' });
  },
  get: (publicationId: string, signal?: AbortSignal) =>
    call<{ publication: PublicProject }>(
      `/api/public-projects/${encodeURIComponent(publicationId)}`,
      { cache: 'no-store', ...(signal ? { signal } : {}) },
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
  setAcquisition: (
    projectId: string,
    allowed: boolean,
    expectedVersion: number,
    expectedRevisionId: string,
  ) =>
    call<ProjectPublicationStatus>(
      `/api/projects/${encodeURIComponent(projectId)}/publication/acquisition`,
      {
        method: 'POST',
        body: JSON.stringify({ allowed, expectedVersion, expectedRevisionId }),
      },
    ),
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
