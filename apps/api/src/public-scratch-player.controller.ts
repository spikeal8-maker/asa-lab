import { Readable } from 'node:stream';
import {
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { BlocksAssetFormat } from '@asa-lab/blocks';
import { TOKENS } from './tokens.js';
import { PublicScratchPlayerService } from './public-scratch-player.js';
import { blocksRuntimeRequestOrigin } from './blocks-runtime-transport.js';
import { BLOCKS_ASSET_CANONICAL_CONTENT_TYPES } from './blocks-runtime-transport.js';

@Controller('api')
export class PublicScratchPlayerController {
  private readonly service: PublicScratchPlayerService;
  constructor(@Inject(TOKENS.pool) pool: pg.Pool | null) {
    this.service = new PublicScratchPlayerService(pool);
  }
  @Get('public-projects/:publicationId/scratch-player')
  @Header('Cache-Control', 'no-store')
  async bootstrap(
    @Param('publicationId') publicationId: string,
    @Query('revisionId') revisionId: string,
  ) {
    try {
      return await this.service.issue({ publicationId, revisionId });
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      throw new HttpException(
        { error: { code: 'player_unavailable', message: 'Просмотр временно недоступен.' } },
        503,
      );
    }
  }
  @Get('blocks/runtime/publications/:publicationId/revisions/:revisionId/assets/:assetFile')
  async asset(
    @Param('publicationId') publicationId: string,
    @Param('revisionId') revisionId: string,
    @Param('assetFile') assetFile: string,
    @Headers('authorization') authorization: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const match = /^([a-f0-9]{32})\.(svg|png|jpg|wav|mp3)$/.exec(assetFile);
    if (!match || !authorization?.startsWith('Bearer '))
      throw new HttpException(
        { error: { code: 'not_available', message: 'Ресурс недоступен.' } },
        404,
      );
    const controller = new AbortController();
    const close = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', close);
    const result = await this.service.asset(
      { publicationId, revisionId },
      authorization.slice(7),
      blocksRuntimeRequestOrigin(request),
      match[1]!,
      match[2] as BlocksAssetFormat,
      controller.signal,
    );
    reply.raw.once('finish', result.release);
    reply.raw.once('close', result.release);
    await reply
      .header('Cache-Control', 'private, no-store')
      .header('Content-Type', BLOCKS_ASSET_CANONICAL_CONTENT_TYPES[result.dataFormat])
      .header('Content-Length', String(result.sizeBytes))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .send(Readable.from(result.body));
  }
}
