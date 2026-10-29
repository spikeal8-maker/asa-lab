import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { SeatContextUseCase } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import {
  AiAccessService,
  aiRequestActor,
  aiSeatSelector,
  requireAiSameOrigin,
} from './ai-access.service.js';
import { AiPolzaError, AiPolzaService } from './ai-polza.service.js';

export const AI_POLZA_SERVICE = 'AI_POLZA_SERVICE';

async function safe<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AiPolzaError)
      throw new HttpException({ error: { code: error.code, message: error.message } }, error.status);
    throw error;
  }
}

@Controller('api/admin/v1/ai/polza')
export class AdminPolzaController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly active: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane) private readonly control: AdminControlPlaneService,
    @Inject(AI_POLZA_SERVICE) private readonly polza: AiPolzaService,
  ) {}

  private async actor(request: FastifyRequest): Promise<string> {
    const context = await this.active.resolve(request.cookies[SESSION_COOKIE]);
    if (!context)
      throw new AiPolzaError('ai_session_required', 401, 'Войдите в аккаунт.');
    const access = await this.control.resolveAccess(context);
    if (!access.scopes.some((scope) => scope.kind === 'platform' && scope.role === 'platform_admin'))
      throw new AiPolzaError('ai_polza_denied', 403, 'Настройки доступны администратору платформы.');
    return context.principalId;
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@Req() request: FastifyRequest) {
    return safe(async () => this.polza.admin(await this.actor(request)));
  }

  @Put()
  @Header('Cache-Control', 'private, no-store')
  save(@Req() request: FastifyRequest, @Body() body: unknown) {
    return safe(async () => {
      requireAiSameOrigin(request);
      return this.polza.save(await this.actor(request), body);
    });
  }

  @Post('check')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  check(@Req() request: FastifyRequest) {
    return safe(async () => {
      requireAiSameOrigin(request);
      return this.polza.check(await this.actor(request));
    });
  }
}

@Controller('api/ai/stt')
export class AiSttController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly active: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.aiAccessService) private readonly access: AiAccessService,
    @Inject(AI_POLZA_SERVICE) private readonly polza: AiPolzaService,
  ) {}

  private async owner(request: FastifyRequest): Promise<{ owner: string; allowed: boolean }> {
    const actor = await aiRequestActor(request, this.active, this.seats);
    const owner = await this.access.owner(actor, aiSeatSelector(request));
    const admission = await this.access.admission(owner);
    return { owner, allowed: admission.canGenerate };
  }

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  status(@Req() request: FastifyRequest) {
    return safe(async () => {
      const access = await this.owner(request);
      const config = await this.polza.status();
      return { ...config, enabled: config.enabled && access.allowed };
    });
  }

  @Post('transcribe')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  transcribe(@Req() request: FastifyRequest, @Body() body: unknown) {
    return safe(async () => {
      requireAiSameOrigin(request);
      const access = await this.owner(request);
      if (!access.allowed)
        throw new AiPolzaError('ai_stt_denied', 403, 'Голосовой ввод недоступен в этом чате.');
      return this.polza.transcribe(access.owner, body);
    });
  }
}
