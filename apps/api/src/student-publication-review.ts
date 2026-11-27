import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import type { FastifyReply } from 'fastify';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import {
  validateStudentPublicationReviewArtifact,
  type StudentPublicationReviewArtifact,
} from '@asa-lab/contracts';
import { createPublicArtifactAdapters } from './public-project-artifact.js';
import { validatePortableProjectCopyDocument } from './private-project-copy-document.js';
import { createRoboticsPublicationReviewArtifact } from './student-robotics-review.js';
import { studentScratchDocument } from './public-scratch-player.js';
import { publicationError, throwPublicationError } from './public-projects.errors.js';
import { checkBodyShape, validationMessage } from './validation.js';

export const PUBLICATION_REVIEW_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicationReviewer =
  | { role: 'teacher'; actor: string; classroomId: string }
  | { role: 'platform'; actor: string; classroomId: null };

export function createStudentPublicationReviewArtifact(
  registry: ModuleRegistry,
  moduleKey: string,
  document: unknown,
  projectId: string,
  revision: number,
): StudentPublicationReviewArtifact | null {
  const provenance = { publicationId: projectId.toLowerCase(), revisionNumber: revision };
  try {
    if (moduleKey === 'robotics')
      return createRoboticsPublicationReviewArtifact(registry, document, provenance);
    if (moduleKey !== 'three-d' && moduleKey !== 'electronics') return null;
    const entry = registry.get(moduleKey);
    if (!entry?.provider) return null;
    const parsed = validationMessage(entry, document);
    if (!parsed.ok || !isDeepStrictEqual(parsed.document, document)) return null;
    if (
      moduleKey === 'three-d' &&
      !validatePortableProjectCopyDocument(registry, moduleKey, document)
    )
      return null;
    const artifact = createPublicArtifactAdapters(registry).get(moduleKey)?.(document, provenance);
    // The public endpoint may fall back to a thumbnail or inert Circuit. A
    // moderation approval must inspect the actual saved model or simulation.
    return validateStudentPublicationReviewArtifact(artifact);
  } catch {
    return null;
  }
}

interface AuthorSource extends pg.QueryResultRow {
  module_key: string;
  document_json: unknown;
  source_seal: Buffer;
}

export async function createStudentPublicationReview(
  pool: pg.Pool,
  registry: ModuleRegistry,
  actor: string,
  projectId: string,
  sessionHash: string,
  revision: number,
  metadata: unknown,
  requestKey: string,
) {
  const source = (
    await pool.query<AuthorSource>(
      'SELECT * FROM public.classroom_publication_author_source($1,$2,$3,$4)',
      [actor, projectId, sessionHash, revision],
    )
  ).rows[0];
  if (!source || !Buffer.isBuffer(source.source_seal) || source.source_seal.length !== 32)
    throw publicationError('not_available', 'Проект недоступен.', 404);
  const artifact =
    source.module_key === 'blocks'
      ? await createStudentScratchArtifact(source.document_json, projectId, revision)
      : createStudentPublicationReviewArtifact(
          registry,
          source.module_key,
          source.document_json,
          projectId,
          revision,
        );
  if (!artifact)
    throw publicationError(
      'publication_review_unavailable',
      'Для сохранённой работы пока нет точного просмотра для проверки.',
      409,
    );
  const result = await pool.query<{ data: unknown }>(
    'SELECT public.classroom_publication_request_create($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb) AS data',
    [
      actor,
      projectId,
      sessionHash,
      revision,
      JSON.stringify(metadata),
      requestKey,
      source.source_seal,
      JSON.stringify(artifact),
    ],
  );
  return result.rows[0].data;
}

async function createStudentScratchArtifact(
  document: unknown,
  projectId: string,
  revision: number,
) {
  try {
    const runtime = await studentScratchDocument(document);
    return {
      schemaVersion: 8,
      status: 'player',
      viewerFamily: 'scratch',
      capabilities: { readOnly: true, interactive: true, download: false },
      provenance: { publicationId: projectId.toLowerCase(), revisionNumber: revision },
      runtime,
    };
  } catch {
    return null;
  }
}

function target(reviewer: PublicationReviewer, requestId: string) {
  if (!PUBLICATION_REVIEW_UUID.test(requestId))
    throw publicationError('validation_error', 'Некорректный идентификатор заявки.', 400);
  return [reviewer.actor, reviewer.role, reviewer.classroomId, requestId];
}

export async function readStudentPublicationReviewQueue(
  pool: pg.Pool,
  reviewer: PublicationReviewer,
  limit: number,
  offset: number,
) {
  const { rows } = await pool.query<{ data: unknown }>(
    'SELECT public.classroom_publication_request_queue($1,$2,$3,$4,$5) AS data',
    [reviewer.actor, reviewer.role, reviewer.classroomId, limit, offset],
  );
  return { items: rows.map(({ data }) => data) };
}

export async function readStudentPublicationReviewArtifact(
  pool: pg.Pool,
  reviewer: PublicationReviewer,
  requestId: string,
) {
  const response = (
    await pool.query<{
      data: { requestId: string; sourceRevision: number; artifact: unknown } | null;
    }>(
      'SELECT public.classroom_publication_request_artifact($1,$2,$3,$4) AS data',
      target(reviewer, requestId),
    )
  ).rows[0]?.data;
  if (!response || response.requestId !== requestId.toLowerCase())
    throw publicationError('not_available', 'Заявка недоступна.', 404);
  const artifact = validateStudentPublicationReviewArtifact(response.artifact);
  if (
    !artifact ||
    artifact.provenance.publicationId !== response.requestId ||
    artifact.provenance.revisionNumber !== response.sourceRevision
  ) {
    throw publicationError('not_available', 'Точный просмотр работы недоступен.', 404);
  }
  return {
    requestId: response.requestId,
    sourceRevision: response.sourceRevision,
    artifact,
  };
}

export async function readStudentPublicationReviewRaster(
  pool: pg.Pool,
  reviewer: PublicationReviewer,
  requestId: string,
) {
  const result = await pool.query<{ image: Buffer; content_type: string }>(
    'SELECT * FROM public.classroom_publication_request_raster($1,$2,$3,$4)',
    target(reviewer, requestId),
  );
  const raster = result.rows[0];
  if (
    !raster ||
    !['image/png', 'image/webp'].includes(raster.content_type) ||
    !Buffer.isBuffer(raster.image)
  ) {
    throw publicationError('not_available', 'Обложка заявки недоступна.', 404);
  }
  return raster;
}

export function sendStudentPublicationReviewRaster(
  reply: FastifyReply,
  raster: { image: Buffer; content_type: string },
) {
  return reply
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Cross-Origin-Resource-Policy', 'same-origin')
    .type(raster.content_type)
    .send(raster.image);
}

export async function decideStudentPublicationReview(
  pool: pg.Pool,
  reviewer: PublicationReviewer,
  requestId: string,
  raw: unknown,
) {
  const shape = checkBodyShape(raw, ['approve']);
  if (!shape.ok || typeof shape.body['approve'] !== 'boolean')
    throw publicationError('validation_error', 'Выберите решение по заявке.', 400);
  try {
    const result = await pool.query<{ data: unknown }>(
      'SELECT public.classroom_publication_request_review($1,$2,$3,$4,$5) AS data',
      [...target(reviewer, requestId), shape.body['approve']],
    );
    return result.rows[0].data;
  } catch (cause) {
    throwPublicationError(cause);
  }
}
