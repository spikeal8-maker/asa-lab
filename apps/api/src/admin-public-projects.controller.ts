import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { AdminControlPlaneService } from './admin-control-plane.service.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';
import { checkBodyShape } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException();
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d{1,7}$/.test(value)) throw new BadRequestException();
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new BadRequestException();
  return parsed;
}

@Controller('api/admin/v1/publications')
export class AdminPublicProjectsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane) private readonly adminControlPlane: AdminControlPlaneService,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private async actor(request: FastifyRequest) {
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE)) {
      throw new ForbiddenException();
    }
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new UnauthorizedException();
    const access = await this.adminControlPlane.resolveAccess(context);
    if (
      !access.subject.capabilities.some(
        (entry) => entry.capability === 'platform_admin' && entry.state === 'verified',
      )
    )
      throw new ForbiddenException();
    return context.principalId;
  }

  private async query<T extends pg.QueryResultRow>(sql: string, values: unknown[]) {
    if (!this.pool) throw new ServiceUnavailableException();
    try {
      return await this.pool.query<T>(sql, values);
    } catch (failure) {
      // Closed, typed mappings; never return SQL messages or private identifiers.
      const code = (failure as { code?: string }).code;
      if (code === '42501') throw new ForbiddenException();
      if (code === '22023' || code === '22P02') throw new BadRequestException();
      if (code === 'P5P04') throw new NotFoundException();
      if (code === 'P5M09') throw new ConflictException();
      throw failure;
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Req() request: FastifyRequest,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const actor = await this.actor(request);
    const result = await this.query<{ result: unknown }>(
      'SELECT public.admin_publications_list($1,$2,$3) AS result',
      [actor, integer(offset, 0, 0, 1000000), integer(limit, 25, 1, 50)],
    );
    return result.rows[0].result;
  }

  @Get(':publicationId/image')
  @Header('Cache-Control', 'no-store')
  async image(
    @Req() request: FastifyRequest,
    @Param('publicationId') publicationId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const actor = await this.actor(request);
    uuid(publicationId);
    const result = await this.query<{ image: Buffer; content_type: string }>(
      'SELECT * FROM public.admin_publication_image($1,$2)',
      [actor, publicationId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException();
    return reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(row.content_type)
      .send(row.image);
  }

  private async transition(
    request: FastifyRequest,
    publicationId: string,
    body: unknown,
    hidden: boolean,
  ) {
    const actor = await this.actor(request);
    uuid(publicationId);
    const shape = checkBodyShape(body, ['reason', 'expectedVersion', 'expectedRevisionId']);
    if (!shape.ok) throw new BadRequestException();
    const reason = shape.body['reason'];
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      throw new BadRequestException();
    }
    const expectedVersion = shape.body['expectedVersion'];
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion > 2147483646
    ) {
      throw new BadRequestException();
    }
    const expectedRevisionId = shape.body['expectedRevisionId'];
    if (typeof expectedRevisionId !== 'string') throw new BadRequestException();
    uuid(expectedRevisionId);
    if (typeof request.id !== 'string' || !request.id.trim() || request.id.length > 128) {
      throw new BadRequestException();
    }
    const result = await this.query<{ result: unknown }>(
      'SELECT public.admin_publication_transition($1,$2,$3,$4,$5,$6,$7) AS result',
      [
        actor,
        publicationId,
        hidden,
        reason.trim(),
        request.id,
        expectedVersion,
        expectedRevisionId,
      ],
    );
    return result.rows[0].result;
  }

  @Post(':publicationId/featured')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async featured(
    @Req() request: FastifyRequest,
    @Param('publicationId') publicationId: string,
    @Body() body: unknown,
  ) {
    const actor = await this.actor(request);
    uuid(publicationId);
    const shape = checkBodyShape(body, [
      'featured', 'expectedVersion', 'expectedRevisionId', 'expectedModerationVersion',
    ]);
    if (!shape.ok || typeof shape.body['featured'] !== 'boolean') {
      throw new BadRequestException();
    }
    const expectedVersion = shape.body['expectedVersion'];
    const expectedModerationVersion = shape.body['expectedModerationVersion'];
    if (
      typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 || expectedVersion > 2147483646 ||
      typeof expectedModerationVersion !== 'number' || !Number.isInteger(expectedModerationVersion) ||
      expectedModerationVersion < 0 || expectedModerationVersion > 2147483646
    ) {
      throw new BadRequestException();
    }
    const expectedRevisionId = shape.body['expectedRevisionId'];
    if (typeof expectedRevisionId !== 'string') throw new BadRequestException();
    uuid(expectedRevisionId);
    if (typeof request.id !== 'string' || !request.id.trim() || request.id.length > 128) {
      throw new BadRequestException();
    }
    const result = await this.query<{ result: unknown }>(
      'SELECT public.admin_publication_feature_set($1,$2,$3,$4,$5,$6,$7) AS result',
      [
        actor, publicationId, shape.body['featured'], request.id, expectedVersion,
        expectedRevisionId, expectedModerationVersion,
      ],
    );
    return result.rows[0].result;
  }

  @Post(':publicationId/hide')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async hide(
    @Req() request: FastifyRequest,
    @Param('publicationId') id: string,
    @Body() body: unknown,
  ) {
    return this.transition(request, id, body, true);
  }

  @Post(':publicationId/restore')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async restore(
    @Req() request: FastifyRequest,
    @Param('publicationId') id: string,
    @Body() body: unknown,
  ) {
    return this.transition(request, id, body, false);
  }
}
