import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { AiChatService, AiServiceError, type AiCursor } from './ai-chat.service.js';
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

  private cursor(beforeAt: string | undefined, beforeId: string | undefined): AiCursor | null {
    if (beforeAt === undefined && beforeId === undefined) return null;
    const parsed = new Date(beforeAt ?? '');
    if (
      !beforeAt ||
      !beforeId ||
      !UUID.test(beforeId) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString() !== beforeAt
    ) {
      return reject('ai_cursor_invalid', 'Неверная позиция истории.', 400);
    }
    return { at: beforeAt, id: beforeId };
  }

  @Get('status')
  async status(@Req() request: FastifyRequest) {
    await this.requireAccount(request);
    return this.safe(() => this.ai.status());
  }

  @Get('threads')
  async threads(
    @Req() request: FastifyRequest,
    @Query('beforeAt') beforeAt?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const account = await this.requireAccount(request);
    const cursor = this.cursor(beforeAt, beforeId);
    return this.safe(() => this.ai.threadPage(account.principalId, cursor));
  }

  @Patch('threads/:threadId')
  async rename(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ) {
    this.requireSameOrigin(request);
    const account = await this.requireAccount(request);
    const threadId = this.threadId(rawId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_title_invalid', 'Нужно название диалога.', 400);
    }
    const title = (raw as Record<string, unknown>)['title'];
    if (typeof title !== 'string') {
      return reject('ai_title_invalid', 'Нужно название диалога.', 400);
    }
    return this.safe(() => this.ai.renameThread(account.principalId, threadId, title));
  }

  @Delete('threads/:threadId')
  @HttpCode(200)
  async delete(@Req() request: FastifyRequest, @Param('threadId') rawId: string) {
    this.requireSameOrigin(request);
    const account = await this.requireAccount(request);
    const threadId = this.threadId(rawId);
    return this.safe(() => this.ai.deleteThread(account.principalId, threadId));
  }

  @Post('threads')
  @HttpCode(201)
  async create(@Req() request: FastifyRequest) {
    this.requireSameOrigin(request);
    const account = await this.requireAccount(request);
    return this.safe(() => this.ai.createThread(account.principalId));
  }

  @Get('threads/:threadId/messages')
  async messages(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Query('beforeAt') beforeAt?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const account = await this.requireAccount(request);
    const threadId = this.threadId(rawId);
    const cursor = this.cursor(beforeAt, beforeId);
    return this.safe(() => this.ai.messagePage(account.principalId, threadId, cursor));
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
