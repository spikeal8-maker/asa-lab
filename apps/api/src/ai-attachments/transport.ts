import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AI_ATTACHMENT_IMAGE_MAX_BYTES } from './validation.js';

export const AI_ATTACHMENT_CONTENT_TYPE = 'application/vnd.asa.ai-attachment';
const BYTES_ROUTE = '/api/ai/attachments/:uploadId/bytes';
const ROUTES = new Set([
  'POST /api/ai/attachments',
  'GET /api/ai/attachments/:uploadId',
  `PUT ${BYTES_ROUTE}`,
  `GET ${BYTES_ROUTE}`,
  'DELETE /api/ai/attachments/:uploadId',
  'POST /api/ai/attachments/:uploadId/reconcile',
]);
export function isAiAttachmentRoute(request: FastifyRequest): boolean {
  return ROUTES.has(
    `${request.method === 'HEAD' ? 'GET' : request.method} ${request.routeOptions?.url}`,
  );
}

/** A separate vendor type keeps Fastify's global Blocks image parsers intact.
 * The handler authenticates before consuming the bounded payload stream. */
export function registerAiAttachmentTransport(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(AI_ATTACHMENT_CONTENT_TYPE, (request, payload, done) => {
    if (
      request.method !== 'PUT' ||
      request.routeOptions.url !== BYTES_ROUTE ||
      request.headers['content-type'] !== AI_ATTACHMENT_CONTENT_TYPE ||
      (request.headers['content-encoding'] !== undefined &&
        request.headers['content-encoding'] !== 'identity')
    ) {
      done(Object.assign(new Error('ai_attachment_media_type_invalid'), { statusCode: 415 }));
      return;
    }
    const length = request.headers['content-length'];
    if (
      length !== undefined &&
      (typeof length !== 'string' ||
        !/^[1-9][0-9]*$/.test(length) ||
        !Number.isSafeInteger(Number(length)) ||
        Number(length) > AI_ATTACHMENT_IMAGE_MAX_BYTES)
    ) {
      done(Object.assign(new Error('ai_attachment_too_large'), { statusCode: 413 }));
      return;
    }
    done(null, payload);
  });
  fastify.addHook('onRequest', async (request, reply) => {
    if (!isAiAttachmentRoute(request)) return;
    void reply
      .header('Cache-Control', 'private, no-store')
      .header('Vary', 'Cookie, X-Asa-Ai-Seat')
      .header('X-Content-Type-Options', 'nosniff');
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.routeOptions.url === BYTES_ROUTE
    )
      void reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
  });
}
