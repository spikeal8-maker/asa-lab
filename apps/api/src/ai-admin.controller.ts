import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { AiChatService, AiServiceError, type AiProvider, type AiModel } from './ai-chat.service.js';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

@Controller('api/admin/v1/ai')
export class AiAdminController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane)
    private readonly controlPlane: AdminControlPlaneService,
    @Inject(TOKENS.aiChatService) private readonly ai: AiChatService,
  ) {}

  private async requirePlatformAdmin(request: FastifyRequest): Promise<string> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) return reject('unauthorized', 'Нужен вход в аккаунт.', 401);
    const access = await this.controlPlane.resolveAccess(context);
    if (!access.scopes.some((scope) => scope.kind === 'platform' && scope.role === 'platform_admin')) {
      return reject('ai_admin_denied', 'Настройки ИИ доступны администратору платформы.', 403);
    }
    return context.principalId;
  }

  private requireSameOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    if (!origin || typeof origin !== 'string') {
      return reject('ai_origin_required', 'Источник запроса не подтверждён.', 403);
    }
    try {
      if (new URL(origin).host !== request.headers.host) {
        return reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
      }
    } catch {
      return reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
    }
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      return reject('ai_json_required', 'Нужен JSON-запрос.', 415);
    }
  }

  private async safe<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (problem) {
      if (problem instanceof AiServiceError) {
        return reject(problem.code, problem.message, problem.status);
      }
      if ((problem as { code?: string }).code === '42501') {
        return reject('ai_admin_denied', 'Нет прав для управления ИИ.', 403);
      }
      throw problem;
    }
  }

  @Get()
  async get(@Req() request: FastifyRequest) {
    const principalId = await this.requirePlatformAdmin(request);
    return this.safe(() => this.ai.adminConfig(principalId));
  }

  @Put()
  @HttpCode(200)
  async update(@Req() request: FastifyRequest, @Body() raw: unknown) {
    this.requireSameOrigin(request);
    const principalId = await this.requirePlatformAdmin(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_config_invalid', 'Неверные настройки ИИ.', 400);
    }
    const value = raw as Record<string, unknown>;
    const provider = value['provider'];
    const model = value['model'];
    const enabled = value['enabled'];
    const clearApiKey = value['clearApiKey'];
    const apiKey = value['apiKey'];
    if (
      (provider !== 'openai' && provider !== 'deepseek')
      || (model !== 'gpt-5-mini' && model !== 'gpt-4.1-mini' && model !== 'deepseek-chat')
      || typeof enabled !== 'boolean'
      || (clearApiKey !== undefined && typeof clearApiKey !== 'boolean')
      || (apiKey !== undefined && typeof apiKey !== 'string')
    ) {
      return reject('ai_config_invalid', 'Неверные настройки ИИ.', 400);
    }
    return this.safe(() =>
      this.ai.saveAdminConfig(
        principalId,
        {
          provider: provider as AiProvider,
          model: model as AiModel,
          enabled,
          ...(typeof apiKey === 'string' ? { apiKey } : {}),
          ...(typeof clearApiKey === 'boolean' ? { clearApiKey } : {}),
        },
        request.id,
      ),
    );
  }
}
