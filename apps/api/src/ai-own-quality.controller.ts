import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import {
  AiOwnQualityService,
  AiOwnQualityError,
  AI_OWN_QUALITY_SERVICE,
  OWN_QUALITY_PERMISSION,
} from './ai-own-quality.js';
import { TOKENS, SESSION_COOKIE } from './tokens.js';
function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}
@Controller('api/admin/v1/ai/own-quality')
export class AiOwnQualityController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly active: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane) private readonly admin: AdminControlPlaneService,
    @Inject(AI_OWN_QUALITY_SERVICE) private readonly quality: AiOwnQualityService,
  ) {}
  private async actor(request: FastifyRequest, content = false) {
    if (Object.keys((request.query as object) ?? {}).length)
      reject(
        'ai_quality_scope_invalid',
        'Выбор чужого владельца или школьного scope здесь недоступен.',
        400,
      );
    const context = await this.active.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) reject('unauthorized', 'Нужен вход.', 401);
    const access = await this.admin.resolveAccess(context);
    if (!access.scopes.some((s) => s.kind === 'platform' && s.role === 'platform_admin'))
      reject('ai_quality_denied', 'Нужны полномочия администратора платформы.', 403);
    if (
      content &&
      !this.admin.authorize(access, OWN_QUALITY_PERMISSION, { kind: 'platform', id: null })
    )
      reject(
        'ai_quality_denied',
        'Нужно отдельное разрешение на анализ собственных личных диалогов.',
        403,
      );
    return context.principalId;
  }
  private async safe<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiOwnQualityError) reject(e.code, e.message, e.status);
      throw e;
    }
  }
  @Get('grant')
  @Header('Cache-Control', 'private, no-store')
  async grant(@Req() request: FastifyRequest) {
    return this.safe(async () => this.quality.grant(await this.actor(request)));
  }
  @Put('grant')
  @Header('Cache-Control', 'private, no-store')
  async save(@Req() request: FastifyRequest, @Body() input: unknown) {
    try {
      if (
        typeof request.headers.origin !== 'string' ||
        new URL(request.headers.origin).host !== request.headers.host
      )
        reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
    } catch {
      reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
    }
    if (!request.headers['content-type']?.startsWith('application/json'))
      reject('ai_json_required', 'Нужен JSON.', 415);
    return this.safe(async () => this.quality.save(await this.actor(request), input));
  }
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Req() request: FastifyRequest) {
    return this.safe(async () => this.quality.list(await this.actor(request, true)));
  }
  @Get(':requestId')
  @Header('Cache-Control', 'private, no-store')
  async detail(@Req() request: FastifyRequest, @Param('requestId') id: string) {
    return this.safe(async () => this.quality.detail(await this.actor(request, true), id));
  }
}
