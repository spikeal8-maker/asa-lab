import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { AiChatService, AiServiceError } from './ai-chat.service.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

@Controller('api/ai')
export class AiChatController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.aiChatService) private readonly ai: AiChatService,
  ) {}

  private async requireAccount(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context || !context.accountId) {
      return reject('ai_account_required', 'Для чата нужен вход в личный аккаунт.', 401);
    }
    return context;
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
      throw problem;
    }
  }

  private threadId(value: string): string {
    if (!UUID.test(value))
      return reject('ai_thread_id_invalid', 'Неверный идентификатор чата.', 400);
    return value;
  }

  @Get('status')
  async status(@Req() request: FastifyRequest) {
    await this.requireAccount(request);
    return this.safe(() => this.ai.status());
  }

  @Get('threads')
  async threads(@Req() request: FastifyRequest) {
    const account = await this.requireAccount(request);
    return this.safe(async () => ({ items: await this.ai.threads(account.principalId) }));
  }

  @Post('threads')
  @HttpCode(201)
  async create(@Req() request: FastifyRequest) {
    this.requireSameOrigin(request);
    const account = await this.requireAccount(request);
    return this.safe(() => this.ai.createThread(account.principalId));
  }

  @Get('threads/:threadId/messages')
  async messages(@Req() request: FastifyRequest, @Param('threadId') rawId: string) {
    const account = await this.requireAccount(request);
    const threadId = this.threadId(rawId);
    return this.safe(async () => ({
      items: await this.ai.messages(account.principalId, threadId),
    }));
  }

  @Post('threads/:threadId/messages')
  @HttpCode(200)
  async send(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ) {
    this.requireSameOrigin(request);
    const account = await this.requireAccount(request);
    const threadId = this.threadId(rawId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_input_invalid', 'Нужен текст сообщения.', 400);
    }
    const body = raw as Record<string, unknown>;
    if (typeof body['message'] !== 'string') {
      return reject('ai_input_invalid', 'Нужен текст сообщения.', 400);
    }
    if (typeof body['requestId'] !== 'string' || !UUID.test(body['requestId'])) {
      return reject('ai_request_id_invalid', 'Нужен уникальный идентификатор отправки.', 400);
    }
    return this.safe(() =>
      this.ai.send(
        account.principalId,
        threadId,
        body['message'] as string,
        body['requestId'] as string,
      ),
    );
  }
}
