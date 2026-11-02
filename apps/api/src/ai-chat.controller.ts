import { isAiImageSize } from '@asa-lab/contracts';
import type { AiWebSearchMode } from '@asa-lab/contracts';
import { AiPolicyError } from './ai-generation-policy.js';
import { AiToolPolicyError } from './ai-tool-policy.js';
import { AiWebSearchError, isWebSearchMode } from './ai-web-search.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { OLLAMA_SELECTION } from './ai-ollama.js';
import {
  AiChatService,
  AiServiceError,
  type AiCursor,
  type AiChatModel,
  type AiNativeImageOptions,
} from './ai-chat.service.js';
import { AiAccessService, aiRequestActor, aiSeatSelector } from './ai-access.service.js';
import type { SeatContextUseCase } from './seat-context.js';
import { TOKENS } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reject(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

@Controller('api/ai')
export class AiChatController {
  private nativeImage(raw: unknown): AiNativeImageOptions | undefined {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return reject('ai_input_invalid', 'Неверные настройки изображения.', 400);
    const value = raw as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !== 'mode,size' ||
      !['off', 'auto'].includes(value['mode'] as string) ||
      !(value['size'] === 512 || isAiImageSize(value['size']))
    )
      return reject('ai_input_invalid', 'Неверные настройки изображения.', 400);
    return value as unknown as AiNativeImageOptions;
  }
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
      if (
        problem instanceof AiServiceError ||
        problem instanceof AiWebSearchError ||
        problem instanceof AiPolicyError ||
        problem instanceof AiToolPolicyError
      ) {
        return reject(problem.code, problem.message, problem.status);
      }
      throw problem;
    }
  }

  private attachmentIds(value: unknown): readonly string[] {
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.length < 1 ||
      value.length > 4 ||
      value.some((id: unknown) => typeof id !== 'string' || !UUID.test(id)) ||
      new Set(value.map((id: string) => id.toLowerCase())).size !== value.length
    )
      return reject('ai_attachment_invalid', 'Выберите не более четырёх разных файлов.', 400);
    return (value as string[]).map((id) => id.toLowerCase());
  }

  private internetMode(body: Record<string, unknown>): AiWebSearchMode | undefined {
    if (body['webSearchMode'] === undefined) return undefined;
    if (!isWebSearchMode(body['webSearchMode']))
      return reject('ai_web_mode_invalid', 'Выберите режим интернет-поиска.', 400);
    return body['webSearchMode'];
  }
  private weatherCity(body: Record<string, unknown>): string | undefined {
    const value = body['weatherCity'];
    if (value === undefined) return undefined;
    if (
      typeof value !== 'string' ||
      value.trim().length < 1 ||
      value.length > 100 ||
      /\p{Cc}/u.test(value)
    )
      return reject('ai_web_city_invalid', 'Укажите город до 100 символов.', 400);
    return value.trim();
  }

  @Get('web-search/status')
  async webSearchStatus(@Req() request: FastifyRequest) {
    await this.requireOwner(request);
    return this.safe(() => this.ai.webSearchStatus());
  }

  @Get('threads/:threadId/web-search/:requestId/images/:imageId')
  async webSearchImage(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('threadId') thread: string,
    @Param('requestId') requestId: string,
    @Param('imageId') imageId: string,
    @Query('original') original?: string,
  ) {
    const owner = await this.requireOwner(request);
    if (
      !UUID.test(requestId) ||
      !/^(?:[1-9]|1[0-2])$/.test(imageId) ||
      (original !== undefined && original !== '1')
    )
      return reject('ai_web_image_missing', 'Изображение недоступно.', 404);
    const image = await this.safe(() =>
      this.ai.webSearchImage(
        owner.principalId,
        this.threadId(thread),
        requestId.toLowerCase(),
        Number(imageId),
        original === '1',
      ),
    );
    reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type(image.mediaType)
      .send(image.bytes);
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

  @Get('token-budgets')
  @Header('Cache-Control', 'private, no-store')
  async tokenBudgets(@Req() request: FastifyRequest) {
    const owner = await this.requireOwner(request);
    return this.safe(() => this.ai.tokenBudgetsOwn(owner.principalId));
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

  @Get('threads/:threadId/attachments')
  async attachments(
    @Req() request: FastifyRequest,
    @Param('threadId') rawId: string,
    @Query('requestIds') rawIds: string,
  ) {
    const account = await this.requireOwner(request);
    const threadId = this.threadId(rawId);
    const ids = typeof rawIds === 'string' ? rawIds.split(',') : [];
    if (
      !ids.length ||
      ids.length > 50 ||
      ids.some((id) => !UUID.test(id)) ||
      new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
    )
      return reject('ai_attachment_invalid', 'Неверный список сообщений.', 400);
    return this.safe(() =>
      this.ai.attachmentHistory(
        account.principalId,
        threadId,
        ids.map((id) => id.toLowerCase()),
      ),
    );
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
    if (body['webSearchMode'] !== undefined || body['weatherCity'] !== undefined)
      return reject('ai_request_id_reused', 'Вариант использует источники исходного вопроса.', 409);
    const model = body['model'];
    if (
      model !== undefined &&
      model !== OLLAMA_SELECTION &&
      !isAiModel(model) &&
      !(
        typeof model === 'string' &&
        model.startsWith('ollama-cloud/') &&
        (await this.ai.isDiscoveredCloudModel(model))
      )
    ) {
      return reject('ai_model_invalid', 'Выберите поддерживаемую модель.', 400);
    }
    return this.streamResponse(
      account.principalId,
      threadId,
      '',
      body['requestId'].toLowerCase(),
      reply,
      model as AiChatModel | undefined,
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
    if (
      model !== undefined &&
      model !== OLLAMA_SELECTION &&
      !isAiModel(model) &&
      !(
        typeof model === 'string' &&
        model.startsWith('ollama-cloud/') &&
        (await this.ai.isDiscoveredCloudModel(model))
      )
    ) {
      return reject('ai_model_invalid', 'Выберите поддерживаемую модель.', 400);
    }

    return this.streamResponse(
      account.principalId,
      threadId,
      message,
      requestId,
      reply,
      model as AiChatModel | undefined,
      undefined,
      this.attachmentIds(body['attachmentIds']),
      this.internetMode(body),
      this.weatherCity(body),
      this.nativeImage(body['nativeImage']),
    );
  }

  private async streamResponse(
    owner: string,
    threadId: string,
    message: string,
    requestId: string,
    reply: FastifyReply,
    model?: AiChatModel,
    sourceId?: string,
    attachmentIds: readonly string[] = [],
    webSearchMode?: AiWebSearchMode,
    weatherCity?: string,
    nativeImage?: AiNativeImageOptions,
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
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let disconnected = false;
    const cleanup = (): void => {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      reply.raw.off('close', disconnect);
      reply.raw.off('error', disconnect);
    };
    const disconnect = (): void => {
      disconnected = true;
      cleanup();
      canceled.abort();
    };
    const write = (frame: string): void => {
      if (reply.raw.writableEnded || reply.raw.destroyed) disconnect();
      if (!disconnected) {
        try {
          reply.raw.write(frame);
        } catch {
          disconnect();
        }
      }
    };
    reply.raw.once('close', disconnect);
    reply.raw.once('error', disconnect);
    const event = (type: string, data: unknown): void => {
      write('event: ' + type + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
    };
    try {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        disconnect();
        return;
      }
      // Queued models can take longer than a proxy's response-header/idle timeout.
      // Comments carry no chat data and are ignored by the SSE event parser.
      reply.raw.flushHeaders();
      write(': connected\n\n');
      if (disconnected) return;
      heartbeat = setInterval(() => write(': heartbeat\n\n'), 15_000);
      heartbeat.unref();
      const result = await this.ai.sendStream(
        owner,
        threadId,
        message,
        requestId,
        (delta) => event('delta', { text: delta }),
        canceled.signal,
        model,
        sourceId,
        ...((nativeImage !== undefined || webSearchMode !== undefined || weatherCity !== undefined
          ? ([attachmentIds, webSearchMode, weatherCity] as const)
          : attachmentIds.length
            ? ([attachmentIds] as const)
            : []) as [
          attachmentIds?: readonly string[],
          webSearchMode?: AiWebSearchMode,
          weatherCity?: string,
        ]),
        ...(nativeImage === undefined ? [] : [nativeImage]),
      );
      // Completion acknowledges this operation, not a replacement history page.
      event('done', {
        ...result,
        messages: result.messages.filter(
          (message) => message.requestId.toLowerCase() === requestId.toLowerCase(),
        ),
      });
    } catch (problem) {
      const code =
        problem instanceof AiServiceError || problem instanceof AiWebSearchError
          ? problem.code
          : 'ai_provider_unavailable';
      const message =
        problem instanceof AiServiceError || problem instanceof AiWebSearchError
          ? problem.message
          : 'Не удалось получить ответ модели. Сообщение сохранено.';
      event('error', { code, message });
    } finally {
      cleanup();
      if (!disconnected && !reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end();
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
    const webSearchMode = this.internetMode(body);
    const weatherCity = this.weatherCity(body);
    return this.safe(() =>
      this.ai.send(
        account.principalId,
        threadId,
        body['message'] as string,
        (body['requestId'] as string).toLowerCase(),
        ...((webSearchMode !== undefined || weatherCity !== undefined
          ? ([webSearchMode, weatherCity] as const)
          : []) as [AiWebSearchMode?, string?]),
      ),
    );
  }
}
