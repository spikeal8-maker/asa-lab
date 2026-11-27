import { validateStudentPublicationReviewArtifact } from '@asa-lab/contracts';
import { call } from '../api-call';
import type { PublicationMetadata } from './api';

export type ReviewState =
  'waiting_teacher' | 'waiting_platform' | 'approved' | 'rejected' | 'stale' | 'published';

export interface ReviewRequest {
  readonly requestId: string;
  readonly state: ReviewState;
  readonly sourceRevision: number;
  readonly moduleKey: string;
  readonly metadata: PublicationMetadata;
}

type ReviewReceipt = ReviewRequest | { readonly requestId: string; readonly state: 'stale' };

const approval = (projectId: string) =>
  '/api/projects/' + encodeURIComponent(projectId) + '/publication/approval';

export const studentPublicationAuthorApi = {
  current: (projectId: string, signal: AbortSignal) =>
    call<{ request: ReviewReceipt | null }>(approval(projectId), { cache: 'no-store', signal }),
  submit: (
    projectId: string,
    sourceRevision: number,
    metadata: PublicationMetadata,
    requestKey: string,
    signal: AbortSignal,
  ) =>
    call<ReviewReceipt>(approval(projectId), {
      method: 'POST',
      body: JSON.stringify({ sourceRevision, metadata }),
      headers: { 'Idempotency-Key': requestKey },
      signal,
    }),
  publish: (projectId: string, requestId: string, signal: AbortSignal) =>
    call<ReviewReceipt>(approval(projectId) + '/' + encodeURIComponent(requestId) + '/publish', {
      method: 'POST',
      body: '{}',
      signal,
    }),
};

export type PublicationReviewScope = { readonly classroomId: string } | null;
export const publicationQueuePath = (scope: PublicationReviewScope) =>
  scope
    ? '/api/project-distribution/classrooms/' +
      encodeURIComponent(scope.classroomId) +
      '/publication-requests'
    : '/api/admin/v1/publications/student-requests';

const requestPath = (base: string, requestId: string) => base + '/' + encodeURIComponent(requestId);
const moduleBySchema = {
  3: 'electronics',
  4: 'three-d',
  7: 'robotics',
  8: 'blocks',
} as const;

export const studentPublicationReviewerApi = {
  list: (base: string, offset: number, signal: AbortSignal) =>
    call<{ items: ReviewRequest[] }>(base + '?offset=' + offset, {
      cache: 'no-store',
      signal,
    }),
  cover: (base: string, requestId: string) => requestPath(base, requestId) + '/cover',
  artifact: async (base: string, request: ReviewRequest, signal: AbortSignal) => {
    const result = await call<{ requestId: string; sourceRevision: number; artifact: unknown }>(
      requestPath(base, request.requestId) + '/artifact',
      { cache: 'no-store', signal },
    );
    if (
      !result.ok ||
      result.data?.requestId !== request.requestId ||
      result.data.sourceRevision !== request.sourceRevision
    )
      return null;
    const artifact = validateStudentPublicationReviewArtifact(result.data.artifact);
    if (
      !artifact ||
      moduleBySchema[artifact.schemaVersion] !== request.moduleKey ||
      artifact.provenance.publicationId !== request.requestId ||
      artifact.provenance.revisionNumber !== request.sourceRevision
    )
      return null;
    return artifact;
  },
  decide: (base: string, requestId: string, approve: boolean, signal: AbortSignal) =>
    call<ReviewReceipt>(requestPath(base, requestId) + '/decision', {
      method: 'POST',
      body: JSON.stringify({ approve }),
      signal,
    }),
};
