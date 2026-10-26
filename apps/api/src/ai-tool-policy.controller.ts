import { Body, Controller, Get, HttpException, Inject, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import { AiChatService } from './ai-chat.service.js';
import { AiToolPolicyError } from './ai-tool-policy.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

@Controller('api/admin/ai')
export class AiToolPolicyController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly active: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane) private readonly control: AdminControlPlaneService,
    @Inject(TOKENS.aiChatService) private readonly ai: AiChatService,
  ) {}
  private async actor(request: FastifyRequest): Promise<string> {
    const context = await this.active.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) return reject('unauthorized', 'Нужен вход в аккаунт.', 401);
    const access = await this.control.resolveAccess(context);
    if (
      !access.scopes.some((scope) => scope.kind === 'platform' && scope.role === 'platform_admin')
    )
      return reject('ai_admin_denied', 'Настройки доступны администратору платформы.', 403);
    return context.principalId;
  }
  private sameOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !origin || !request.headers.host)
      return reject('ai_origin_required', 'Источник запроса не подтверждён.', 403);
    try {
      if (new URL(origin).host !== request.headers.host)
        return reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
    } catch {
      return reject('ai_origin_denied', 'Источник запроса запрещён.', 403);
    }
    if (!(request.headers['content-type'] ?? '').startsWith('application/json'))
      return reject('ai_json_required', 'Нужен JSON-запрос.', 415);
  }
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AiToolPolicyError)
        return reject(error.code, error.message, error.status);
      if ((error as { code?: string }).code === '42501')
        return reject('ai_admin_denied', 'Нет прав для управления инструментами.', 403);
      throw error;
    }
  }
  @Get('tool-policy')
  async get(@Req() request: FastifyRequest) {
    const actor = await this.actor(request);
    return this.safe(() => this.ai.toolPolicyAdmin(actor));
  }
  @Put('tool-policy')
  async put(@Req() request: FastifyRequest, @Body() body: unknown) {
    this.sameOrigin(request);
    const actor = await this.actor(request);
    return this.safe(() => this.ai.saveToolPolicy(actor, body));
  }
}
