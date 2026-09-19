import { Readable } from 'node:stream';
import { Body, Controller, Get, HttpException, Inject, Param, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BlocksAssetFormat } from '@asa-lab/blocks';
import type { ProjectErrorCode } from '@asa-lab/projects';
import { TOKENS } from './tokens.js';
import {
  BlocksAssetStorageIntegrityError,
  BlocksAssetWriteMayHavePersistedError,
} from './blocks-asset-storage.js';
import {
  BlocksAssetUploadBudgetError,
  BlocksAssetUploadValidationError,
  isBlocksAssetIdentityConflict,
} from './blocks-asset-upload.js';
import type {
  BlocksRuntimeAuthorized,
  BlocksRuntimePersistenceService,
} from './blocks-runtime-persistence.service.js';
import { checkBodyShape } from './validation.js';
const ASSET_FILE = /^([a-f0-9]{32})\.(svg|png|jpg|wav|mp3)$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_TYPE: Readonly<Record<BlocksAssetFormat, string>> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};

function payload(code: string, message: string) {
  return { error: { code, message } };
}

function runtimeStatus(code: string): number {
  if (code === 'invalid_request') return 400;
  if (code === 'forbidden_origin' || code === 'permission_denied' || code === 'authority_denied')
    return 403;
  if (
    code === 'unauthorized' ||
    code === 'invalid_token' ||
    code === 'expired_token' ||
    code === 'binding_mismatch'
  )
    return 401;
  if (code === 'project_unavailable') return 404;
  return 503;
}
function projectStatus(code: ProjectErrorCode): number {
  if (code === 'validation_error') return 400;
  if (code === 'idempotency_conflict' || code === 'project_revision_conflict') return 409;
  if (code === 'project_not_found' || code === 'classroom_not_found') return 404;
  return 503;
}

function byteStream(value: unknown): AsyncIterable<Uint8Array> {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function'
  ) {
    throw new HttpException(payload('validation_error', 'binary request body is required'), 400);
  }
  return value as AsyncIterable<Uint8Array>;
}

function assetIdentity(assetFile: string): { assetId: string; dataFormat: BlocksAssetFormat } {
  const match = ASSET_FILE.exec(assetFile);
  if (!match) {
    throw new HttpException(payload('validation_error', 'invalid Scratch asset identity'), 400);
  }
  return { assetId: match[1]!, dataFormat: match[2] as BlocksAssetFormat };
}

@Controller('api/blocks/runtime/projects')
export class BlocksRuntimeController {
  constructor(
    @Inject(TOKENS.blocksRuntimePersistence)
    private readonly runtime: BlocksRuntimePersistenceService,
  ) {}

  private async authorize(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
    permission: 'asset:read' | 'asset:write' | 'draft:write',
  ): Promise<BlocksRuntimeAuthorized> {
    const result = await this.runtime.authorize({
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      projectId,
      permission,
    });
    if (!result.ok) {
      throw new HttpException(
        payload(result.code, 'Blocks runtime request is not authorised.'),
        runtimeStatus(result.code),
      );
    }
    const requestBudget = this.runtime.consumeRequest(result.value.grant);
    if (!requestBudget.allowed) {
      void reply.header('Retry-After', requestBudget.retryAfterSeconds);
      throw new HttpException(
        payload('too_many_requests', 'Blocks runtime request budget exceeded.'),
        429,
      );
    }
    return result.value;
  }

  @Put(':projectId/assets/:assetFile')
  async putAsset(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Param('assetFile') assetFile: string,
  ) {
    const identity = assetIdentity(assetFile);
    const authorized = await this.authorize(request, reply, projectId, 'asset:write');
    try {
      const asset = await this.runtime.uploadAsset({
        authorized,
        ...identity,
        source: byteStream(request.body),
      });
      void reply.header('Cache-Control', 'no-store');
      return { status: 'ok' as const, asset };
    } catch (problem) {
      if (problem instanceof BlocksAssetUploadValidationError) {
        throw new HttpException(payload('validation_error', problem.reason), 400);
      }
      if (isBlocksAssetIdentityConflict(problem)) {
        throw new HttpException(payload('blocks_asset_identity_conflict', problem.message), 409);
      }
      if (problem instanceof BlocksAssetUploadBudgetError) {
        void reply.header('Retry-After', '1');
        throw new HttpException(payload(problem.code, 'Blocks asset upload budget exceeded.'), 429);
      }
      if (
        problem instanceof BlocksAssetStorageIntegrityError ||
        problem instanceof BlocksAssetWriteMayHavePersistedError
      ) {
        throw new HttpException(
          payload('dependency_unavailable', 'Blocks storage unavailable.'),
          503,
        );
      }
      throw new HttpException(
        payload('dependency_unavailable', 'Blocks storage unavailable.'),
        503,
      );
    }
  }
  @Get(':projectId/assets/:assetFile')
  async getAsset(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Param('assetFile') assetFile: string,
  ): Promise<void> {
    const identity = assetIdentity(assetFile);
    const authorized = await this.authorize(request, reply, projectId, 'asset:read');
    if (authorized.grant.mode !== 'editor') {
      throw new HttpException(
        payload('permission_denied', 'Version-scoped player asset read is not active.'),
        403,
      );
    }
    const result = await this.runtime.readAsset({ authorized, ...identity });
    if (!result.ok) {
      const status =
        result.code === 'invalid_request'
          ? 400
          : result.code === 'project_not_found' || result.code === 'asset_not_found'
            ? 404
            : 503;
      throw new HttpException(payload(result.code, 'Blocks asset is unavailable.'), status);
    }
    await reply
      .header('Content-Type', CONTENT_TYPE[identity.dataFormat])
      .header('Content-Length', String(result.value.reference.sizeBytes))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Cache-Control', 'private, no-store')
      .send(Readable.from(result.value.body));
  }

  @Put(':projectId/draft')
  async putDraft(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['document', 'baseRevision', 'mutationId']);
    if (!shape.ok) throw new HttpException(payload('validation_error', shape.message), 400);
    if (
      !Number.isSafeInteger(shape.body['baseRevision']) ||
      Number(shape.body['baseRevision']) < 0 ||
      typeof shape.body['mutationId'] !== 'string' ||
      !UUID_V4.test(shape.body['mutationId'])
    ) {
      throw new HttpException(
        payload('validation_error', 'valid baseRevision and UUIDv4 mutationId are required'),
        400,
      );
    }
    const authorized = await this.authorize(request, reply, projectId, 'draft:write');
    const result = await this.runtime.save({
      authorized,
      projectId,
      document: shape.body['document'],
      baseRevision: Number(shape.body['baseRevision']),
      mutationId: shape.body['mutationId'],
    });
    if (!result.ok) {
      throw new HttpException(payload(result.code, result.message), projectStatus(result.code));
    }
    void reply.header('Cache-Control', 'no-store');
    return { status: 'ok' as const, revision: result.value.revision };
  }
}
