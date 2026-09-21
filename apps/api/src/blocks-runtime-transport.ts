import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BLOCKS_JSON_LIMIT } from './blocks-durable-document.js';
import { clientAddress } from './client-address.js';
import { FixedWindowRateLimiter, type RateLimitDecision } from './rate-limit.js';

export const BLOCKS_DRAFT_CONTENT_TYPE = 'application/vnd.asa.blocks-draft+json';
export const BLOCKS_ASSET_CANONICAL_CONTENT_TYPES = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
} as const;
export type BlocksRuntimeAssetFormat = keyof typeof BLOCKS_ASSET_CANONICAL_CONTENT_TYPES;
export const BLOCKS_DRAFT_BODY_LIMIT = BLOCKS_JSON_LIMIT + 2 * 1024 * 1024;
export const BLOCKS_RUNTIME_ADDRESS_LIMIT = 60_000;
export const BLOCKS_RUNTIME_ADDRESS_WINDOW_MS = 5 * 60 * 1000;

export class BlocksRuntimeAddressBudget {
  private readonly limiter: FixedWindowRateLimiter;

  constructor(
    options: {
      readonly limit?: number;
      readonly windowMs?: number;
      readonly maxKeys?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.limiter = new FixedWindowRateLimiter({
      limit: options.limit ?? BLOCKS_RUNTIME_ADDRESS_LIMIT,
      windowMs: options.windowMs ?? BLOCKS_RUNTIME_ADDRESS_WINDOW_MS,
      maxKeys: options.maxKeys ?? 5000,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  consume(request: FastifyRequest): RateLimitDecision {
    return this.limiter.consume(clientAddress(request));
  }
}

export function optionalBlocksRuntimeOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['ASA_BLOCKS_RUNTIME_ORIGIN']?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('ASA_BLOCKS_RUNTIME_ORIGIN must be an exact http(s) origin.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.origin !== raw ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('ASA_BLOCKS_RUNTIME_ORIGIN must be an exact http(s) origin.');
  }
  return parsed.origin;
}
export function isBlocksRuntimePath(path: string): boolean {
  return path.startsWith('/api/blocks/runtime/');
}

/** Same-origin asset GETs omit Origin. Accept only browser metadata for the
 * embedded ASA document; bearer/project authority is still checked separately. */
export function blocksRuntimeRequestOrigin(
  request: Pick<FastifyRequest, 'method' | 'headers'>,
): string | undefined {
  if (request.headers.origin !== undefined) return request.headers.origin;
  if (request.method !== 'GET' || request.headers['sec-fetch-site'] !== 'same-origin')
    return undefined;
  try {
    const referer = new URL(request.headers.referer ?? '');
    if (
      !['http:', 'https:'].includes(referer.protocol) ||
      referer.username ||
      referer.password ||
      !referer.pathname.startsWith('/internal/blocks/')
    )
      return undefined;
    return referer.origin;
  } catch {
    return undefined;
  }
}

const BLOCKS_RUNTIME_ASSET_UPLOAD =
  /^\/api\/blocks\/runtime\/projects\/[^/?]+\/assets\/[a-f0-9]{32}\.(svg|png|jpg|wav|mp3)$/;

function runtimeAssetUploadFormat(request: FastifyRequest): BlocksRuntimeAssetFormat | null {
  if (request.method !== 'PUT') return null;
  const path = (request.raw.url ?? request.url).split('?', 1)[0] ?? '';
  const match = BLOCKS_RUNTIME_ASSET_UPLOAD.exec(path);
  return (match?.[1] as BlocksRuntimeAssetFormat | undefined) ?? null;
}

function unsupportedMediaType(): Error {
  return Object.assign(new Error('unsupported_blocks_asset_media_type'), { statusCode: 415 });
}

export function applyBlocksRuntimeCors(
  request: FastifyRequest,
  reply: FastifyReply,
  runtimeOrigin: string | null,
): boolean {
  if (!runtimeOrigin || blocksRuntimeRequestOrigin(request) !== runtimeOrigin) return false;
  void reply
    .header('Access-Control-Allow-Origin', runtimeOrigin)
    .header('Vary', 'Origin')
    .header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    .header('Access-Control-Max-Age', '600')
    .header('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After');
  return true;
}

function parseDraftBody(
  _request: FastifyRequest,
  body: string,
  done: (error: Error | null, value?: unknown) => void,
): void {
  try {
    done(null, JSON.parse(body) as unknown);
  } catch {
    done(Object.assign(new Error('invalid_blocks_draft_json'), { statusCode: 400 }));
  }
}
export function registerBlocksRuntimeTransport(
  fastify: FastifyInstance,
  runtimeOrigin: string | null,
): void {
  const assetParser = (
    request: FastifyRequest,
    payload: NodeJS.ReadableStream,
    done: (error: Error | null, value?: unknown) => void,
  ) => {
    const format = runtimeAssetUploadFormat(request);
    if (
      !format ||
      request.headers['content-type'] !== BLOCKS_ASSET_CANONICAL_CONTENT_TYPES[format]
    ) {
      done(unsupportedMediaType());
      return;
    }
    done(null, payload);
  };
  for (const contentType of Object.values(BLOCKS_ASSET_CANONICAL_CONTENT_TYPES)) {
    fastify.addContentTypeParser(contentType, assetParser);
  }
  fastify.addContentTypeParser(
    BLOCKS_DRAFT_CONTENT_TYPE,
    { parseAs: 'string', bodyLimit: BLOCKS_DRAFT_BODY_LIMIT },
    parseDraftBody,
  );
  fastify.options('/api/blocks/runtime/*', async (request, reply) => {
    if (!applyBlocksRuntimeCors(request, reply, runtimeOrigin)) {
      await reply
        .code(403)
        .send({ error: { code: 'forbidden_origin', message: 'runtime origin is not allowed' } });
      return;
    }
    await reply.code(204).send();
  });
}
