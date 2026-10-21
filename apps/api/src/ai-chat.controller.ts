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
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { isAiModel } from './ai-model-catalog.js';
import { AiChatService, AiServiceError, type AiCursor, type AiModel } from './ai-chat.service.js';
import { AiAccessService, aiRequestActor, aiSeatSelector } from './ai-access.service.js';
import type { SeatContextUseCase } from './seat-context.js';
import { TOKENS } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

@Controller('api/ai')
export class AiChatController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.aiChatService) private readonly ai: AiChatService,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.aiAccessService) private readonly access: AiAccessService,
  ) {}

  private async requireOwner(request: FastifyRequest): Promise<{ principalId: string }> {
    return this.safe(async () => ({
      principalId: await this.access.owner(
        await aiRequestActor(request, this.activeContext, this.seats),
        aiSeatSelector(request),
      ),
    }));
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
    return value.toLowerCase();
  }

  private cursor(beforeAt: string | undefined, beforeId: string | undefined): AiCursor | null {
    if (beforeAt === undefined && beforeId === undefined) return null;
    const parsed = new Date(beforeAt ?? '');
    if (
      typeof beforeAt !== 'string' ||
      typeof beforeId !== 'string' ||
      !UUID.test(beforeId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.(?:\d{3}|\d{6})Z$/.test(beforeAt) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString() !== beforeAt.replace(/(\.\d{3})\d{3}Z$/, '$1Z')
    ) {
      return reject('ai_cursor_invalid', 'Неверная позиция истории.', 400);
    }
    return { at: beforeAt, id: beforeId.toLowerCase() };
  }

  @Get('status')
  async status(@Req() request: FastifyRequest) {
    const owner = await this.requireOwner(request);
    return this.safe(async () => {
      const [runtime, admission] = await Promise.all([
        this.ai.status(),
        this.access.admission(owner.principalId),
      ]);
      return {
        ...runtime,
        ...admission,
        providerEnabled: runtime.enabled,
        enabled: runtime.enabled && admission.canGenerate,
        reason: runtime.enabled ? admission.reason : 'ai_disabled',
      };
    });
  }

  @Get('threads')
  async threads(
    @Req() request: FastifyRequest,
    @Query('beforeAt') beforeAt?: string,
    @Query('beforeId') beforeId?: string,
    @Query('q') query?: string,
    @Query('archived') archived?: string,
  ) {
    const account = await this.requireOwner(request);
    const cursor = this.cursor(beforeAt, beforeId);
    if (query !== undefined && (typeof query !== 'string' || query.length > 200)) {
      return reject(
        'ai_search_invalid',
        'Поисковый запрос должен быть не длиннее 200 символов.',
        400,
      );
    }
    if (archived !== undefined && archived !== 'true' && archived !== 'false') {
      return reject('ai_search_invalid', 'Неверный раздел истории.', 400);
    }
    return this.safe(() =>
      this.ai.threadPage(account.principalId, cursor, query?.trim() ?? '', archived === 'true'),
    );
  }

  @Patch('threads/:threadId/archive')
  async archive(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ) {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      typeof (raw as Record<string, unknown>)['archived'] !== 'boolean'
    ) {
      return reject('ai_archive_invalid', 'Нужно выбрать архивирование или восстановление.', 400);
    }
    return this.safe(() =>
      this.ai.archiveThread(account.principalId, threadId, (raw as { archived: boolean }).archived),
    );
  }

  @Patch('threads/:threadId')
  async rename(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ) {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
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
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    return this.safe(() => this.ai.deleteThread(account.principalId, threadId));
  }

  @Post('threads')
  @HttpCode(201)
  async create(@Req() request: FastifyRequest) {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
    return this.safe(() => this.ai.createThread(account.principalId));
  }

  @Get('threads/:threadId/messages')
  async messages(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Query('beforeAt') beforeAt?: string,
    @Query('beforeId') beforeId?: string,
  ) {
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    const cursor = this.cursor(beforeAt, beforeId);
    return this.safe(() => this.ai.messagePage(account.principalId, threadId, cursor));
  }

  @Post('threads/:threadId/requests/:requestId/stop')
  @HttpCode(200)
  async stop(
    @Req() request: FastifyRequest,
    @Param('threadId') rawThreadId: string,
    @Param('requestId') rawRequestId: string,
  ) {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawThreadId);
    if (!UUID.test(rawRequestId)) {
      return reject('ai_request_id_invalid', 'Неверный идентификатор запроса.', 400);
    }
    return this.ai.stopStream(account.principalId, threadId, rawRequestId.toLowerCase());
  }

  @Get('threads/:threadId/requests/:requestId')
  async requestMessages(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Param('requestId') rawRequestId: string,
  ) {
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    if (!UUID.test(rawRequestId)) {
      return reject('ai_request_id_invalid', 'Неверный идентификатор запроса.', 400);
    }
    return this.safe(async () => ({
      items: await this.ai.requestMessages(
        account.principalId,
        threadId,
        rawRequestId.toLowerCase(),
      ),
    }));
  }

  @Post('threads/:threadId/regenerations/stream')
  @HttpCode(200)
  async regenerate(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ): Promise<void> {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_input_invalid', 'Нужно выбрать исходный вопрос.', 400);
    }
    const body = raw as Record<string, unknown>;
    if (
      typeof body['sourceUserMessageId'] !== 'string' ||
      !UUID.test(body['sourceUserMessageId']) ||
      typeof body['requestId'] !== 'string' ||
      !UUID.test(body['requestId'])
    ) {
      return reject(
        'ai_input_invalid',
        'Нужны исходный вопрос и уникальный идентификатор запроса.',
        400,
      );
    }
    const model = body['model'];
    if (model !== undefined && !isAiModel(model)) {
      return reject('ai_model_invalid', 'Выберите поддерживаемую модель.', 400);
    }
    return this.streamResponse(
      account.principalId,
      threadId,
      '',
      body['requestId'].toLowerCase(),
      reply,
      model as AiModel | undefined,
      body['sourceUserMessageId'].toLowerCase(),
    );
  }

  @Post('threads/:threadId/messages/stream')
  @HttpCode(200)
  async sendStream(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ): Promise<void> {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reject('ai_input_invalid', 'Нужен текст сообщения.', 400);
    }
    const body = raw as Record<string, unknown>;
    if (
      typeof body['message'] !== 'string' ||
      typeof body['requestId'] !== 'string' ||
      !UUID.test(body['requestId'])
    ) {
      return reject('ai_input_invalid', 'Нужен текст сообщения и уникальный идентификатор.', 400);
    }
    const message = body['message'] as string;
    const requestId = (body['requestId'] as string).toLowerCase();
    const model = body['model'];
    if (model !== undefined && !isAiModel(model)) {
      return reject('ai_model_invalid', 'Выберите поддерживаемую модель.', 400);
    }

    return this.streamResponse(
      account.principalId,
      threadId,
      message,
      requestId,
      reply,
      model as AiModel | undefined,
    );
  }

  private async streamResponse(
    owner: string,
    threadId: string,
    message: string,
    requestId: string,
    reply: FastifyReply,
    model?: AiModel,
    sourceId?: string,
  ): Promise<void> {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    const canceled = new AbortController();
    reply.raw.once('close', () => canceled.abort());
    const event = (type: string, data: unknown): void => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.write('event: ' + type + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
      }
    };
    try {
      const result = await this.ai.sendStream(
        owner,
        threadId,
        message,
        requestId,
        (delta) => event('delta', { text: delta }),
        canceled.signal,
        model,
        sourceId,
      );
      // Completion acknowledges this operation, not a replacement history page.
      event('done', {
        ...result,
        messages: result.messages.filter(
          (message) => message.requestId.toLowerCase() === requestId.toLowerCase(),
        ),
      });
    } catch (problem) {
      const code = problem instanceof AiServiceError ? problem.code : 'ai_provider_unavailable';
      const message =
        problem instanceof AiServiceError
          ? problem.message
          : 'Не удалось получить ответ модели. Сообщение сохранено.';
      event('error', { code, message });
    } finally {
      reply.raw.end();
    }
  }

  @Post('threads/:threadId/messages')
  @HttpCode(200)
  async send(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Body() raw: unknown,
  ) {
    this.requireSameOrigin(request);
    const account = await this.requireOwner(request);
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
        (body['requestId'] as string).toLowerCase(),
      ),
    );
  }
}
