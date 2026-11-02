import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AiAccessService,
  aiRequestActor,
  aiSeatSelector,
  requireAiSameOrigin,
} from '../ai-access.service.js';
import { AiServiceError } from '../ai-chat.service.js';
import type { SeatContextUseCase } from '../seat-context.js';
import { TOKENS } from '../tokens.js';
import { AI_ATTACHMENT_LIMITS, AiAttachmentError, type AiAttachmentReceipt } from './contracts.js';
import { AiAttachmentService } from './service.js';
import { AI_ATTACHMENT_CONTENT_TYPE } from './transport.js';
import { AiAttachmentValidationError } from './validation.js';

function downloadableName(name: string | null): string {
  const encoded = encodeURIComponent(name ?? 'attachment').replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="attachment"; filename*=UTF-8''${encoded}`;
}

/** Fastify's thenable can resolve at send(), before the native socket has
 * accepted its final bytes. Install these listeners before storage/send. */
function responseCompletion(reply: FastifyReply) {
  const raw = reply.raw;
  const alreadyEnded = () =>
    raw.destroyed || raw.writableFinished || raw.closed || raw.socket?.destroyed === true;
  let ended = alreadyEnded();
  let resolve!: () => void;
  const done = new Promise<void>((finish) => {
    resolve = finish;
  });
  const terminal = () => {
    ended = true;
    resolve();
  };
  const error = () => {
    raw.destroy();
    terminal();
  };
  raw.once('finish', terminal);
  raw.once('close', terminal);
  raw.once('error', error);
  if (ended) resolve();
  return {
    done,
    ended: () => ended || alreadyEnded(),
    dispose: () => {
      raw.off('finish', terminal);
      raw.off('close', terminal);
      raw.off('error', error);
    },
  };
}
@Controller('api/ai/attachments')
export class AiAttachmentController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.aiAccessService) private readonly access: AiAccessService,
    @Inject(TOKENS.aiAttachmentService) private readonly files: AiAttachmentService,
  ) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (problem) {
      throw this.httpError(problem);
    }
  }
  private httpError(problem: unknown): unknown {
    if (problem instanceof AiAttachmentError || problem instanceof AiServiceError)
      return new HttpException(
        { error: { code: problem.code, message: problem.message } },
        problem.status,
      );
    if (problem instanceof AiAttachmentValidationError)
      return new HttpException(
        {
          error: {
            code: problem.code,
            message: 'Файл не прошёл проверку типа, размера или содержимого.',
          },
        },
        problem.status,
      );
    return problem;
  }
  private owner(request: FastifyRequest): Promise<string> {
    return this.safe(async () =>
      this.access.owner(
        await aiRequestActor(request, this.accounts, this.seats),
        aiSeatSelector(request),
      ),
    );
  }
  private result(reply: FastifyReply, receipt: AiAttachmentReceipt): AiAttachmentReceipt {
    if (['uploading', 'unknown', 'deleting'].includes(receipt.state)) void reply.code(202);
    return receipt;
  }
  @Post()
  async reserve(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.safe(async () => {
      requireAiSameOrigin(request);
      return this.files.reserve(await this.owner(request), body);
    });
  }
  @Get(':uploadId')
  async receipt(@Req() request: FastifyRequest, @Param('uploadId') upload: string) {
    return this.safe(async () => this.files.get(await this.owner(request), upload));
  }
  @Put(':uploadId/bytes')
  async upload(
    @Req() request: FastifyRequest,
    @Param('uploadId') upload: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.safe(async () => {
      let origin = false;
      try {
        origin =
          typeof request.headers.origin === 'string' &&
          new URL(request.headers.origin).host === request.headers.host;
      } catch {
        /* fail closed */
      }
      if (!origin)
        throw new AiAttachmentError('ai_origin_denied', 403, 'Источник запроса запрещён.');
      if (
        request.headers['content-type'] !== AI_ATTACHMENT_CONTENT_TYPE ||
        !body ||
        typeof body !== 'object' ||
        !(Symbol.asyncIterator in body)
      )
        throw new AiAttachmentError(
          'ai_attachment_media_type_invalid',
          415,
          'Нужен поток байтов вложения.',
        );
      const owner = await this.owner(request);
      const abort = new AbortController();
      const response = responseCompletion(reply);
      let captured = false;
      let errorSent = false;
      const onAbort = () => abort.abort();
      const onClosed = () => {
        if (!reply.raw.writableFinished) {
          abort.abort();
          request.raw.destroy();
        }
      };
      // One clock covers native input and an early error awaiting output.
      // Validation clears it before the separate storage operation begins.
      const deadline = setTimeout(() => {
        abort.abort();
        request.raw.destroy();
        reply.raw.destroy();
      }, AI_ATTACHMENT_LIMITS.transferMilliseconds);
      deadline.unref();
      request.raw.once('aborted', onAbort);
      reply.raw.once('close', onClosed);
      reply.raw.once('error', onClosed);
      try {
        if (request.raw.aborted || response.ended()) abort.abort();
        return this.result(
          reply,
          await this.files.upload(owner, upload, body as AsyncIterable<Uint8Array>, abort.signal, {
            signal: abort.signal,
            captured: () => {
              captured = true;
              clearTimeout(deadline);
            },
            rejected: async (problem) => {
              if (captured || response.ended()) return;
              const error = this.httpError(problem);
              if (!(error instanceof HttpException)) return;
              // Do not consume an unbounded remainder or destroy the native
              // input before the error can flush. Stop reads, send once, and
              // let Connection: close terminate the rejected HTTP request.
              if (!request.raw.readableEnded) {
                request.raw.pause();
                request.raw.socket?.pause?.();
                reply.raw.shouldKeepAlive = false;
                void reply.header('Connection', 'close');
              }
              errorSent = true;
              void reply.code(error.getStatus()).send(error.getResponse());
              await response.done;
            },
          }),
        );
      } catch (problem) {
        if (errorSent || response.ended()) return;
        throw problem;
      } finally {
        clearTimeout(deadline);
        request.raw.off('aborted', onAbort);
        reply.raw.off('close', onClosed);
        reply.raw.off('error', onClosed);
        response.dispose();
      }
    });
  }
  @Get(':uploadId/bytes')
  async bytes(
    @Req() request: FastifyRequest,
    @Param('uploadId') upload: string,
    @Res() reply: FastifyReply,
  ) {
    return this.safe(async () => {
      const owner = await this.owner(request);
      const response = responseCompletion(reply);
      const deadline = setTimeout(
        () => reply.raw.destroy(),
        AI_ATTACHMENT_LIMITS.transferMilliseconds,
      );
      deadline.unref();
      try {
        if (response.ended()) return;
        await this.files.withRead(owner, upload, async (result) => {
          if (response.ended()) return;
          void reply
            .header(
              'Content-Type',
              result.receipt.kind === 'text' && !result.receipt.mediaType.startsWith('application/')
                ? 'text/plain; charset=utf-8'
                : result.receipt.mediaType,
            )
            .header('Content-Disposition', downloadableName(result.receipt.fileName))
            .header('Content-Length', result.bytes.byteLength)
            .send(result.bytes);
          await response.done;
        });
      } finally {
        clearTimeout(deadline);
        response.dispose();
      }
    });
  }
  @Delete(':uploadId')
  @HttpCode(200)
  async remove(
    @Req() request: FastifyRequest,
    @Param('uploadId') upload: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.safe(async () => {
      requireAiSameOrigin(request);
      return this.result(reply, await this.files.remove(await this.owner(request), upload));
    });
  }
  @Post(':uploadId/reconcile')
  @HttpCode(200)
  async reconcile(
    @Req() request: FastifyRequest,
    @Param('uploadId') upload: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.safe(async () => {
      requireAiSameOrigin(request);
      return this.result(reply, await this.files.reconcile(await this.owner(request), upload));
    });
  }
}
