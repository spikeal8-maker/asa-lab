import {
  Body,
  Controller,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { checkBodyShape } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_TEXT = 40_000;

function reject(code: string, status: number): never {
  throw new HttpException(
    { error: { code, message: 'Не удалось подтвердить письменную работу. Повторите действие.' } },
    status,
  );
}

@Controller('api/learning/essay/runs')
export class LearningEssayAttemptsController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
  ) {}

  private async command(
    request: FastifyRequest,
    runId: string,
    operation: 'read' | 'start' | 'save' | 'submit',
    rawBody?: unknown,
  ) {
    if (!UUID.test(runId)) reject('validation_error', 400);
    const keys =
      operation === 'start'
        ? ['requestId']
        : ['requestId', 'attemptId', 'expectedRevision', ...(operation === 'save' ? ['text'] : [])];
    const shape = operation === 'read' ? null : checkBodyShape(rawBody, keys);
    if (shape && !shape.ok) reject('validation_error', 400);
    const body = shape?.ok ? shape.body : {};
    const requestId = body['requestId'];
    const attemptId = body['attemptId'];
    const expectedRevision = body['expectedRevision'];
    const text = body['text'];
    if (
      (operation !== 'read' && (typeof requestId !== 'string' || !REQUEST.test(requestId))) ||
      ((operation === 'save' || operation === 'submit') &&
        (typeof attemptId !== 'string' ||
          !UUID.test(attemptId) ||
          typeof expectedRevision !== 'number' ||
          !Number.isSafeInteger(expectedRevision) ||
          expectedRevision < 0 ||
          expectedRevision >= 2_147_483_647)) ||
      (operation === 'save' &&
        (typeof text !== 'string' ||
          text.length > MAX_TEXT ||
          Buffer.byteLength(text, 'utf8') > MAX_TEXT * 4 ||
          text.includes('\0')))
    ) {
      reject('validation_error', 400);
    }
    // A valid Seat session owns its authority independently of a linked Account.
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    const account = seat ? null : await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!seat && !account) reject('unauthorized', 401);
    if (!this.pool) reject('database_unavailable', 503);
    const actor = seat ?? account!;
    const functions = {
      read: 'SELECT learning_essay_attempt_read($1,$2) AS response',
      start: 'SELECT learning_essay_attempt_start($1,$2,$3) AS response',
      save: 'SELECT learning_essay_draft_save($1,$2,$3,$4,$5,$6) AS response',
      submit: 'SELECT learning_essay_submission_create($1,$2,$3,$4,$5) AS response',
    } as const;
    const parameters =
      operation === 'read'
        ? [actor.principalId, runId]
        : operation === 'start'
          ? [actor.principalId, runId, requestId]
          : operation === 'save'
            ? [actor.principalId, runId, attemptId, expectedRevision, text, requestId]
            : [actor.principalId, runId, attemptId, expectedRevision, requestId];
    const result = await this.pool.query<{ response: Record<string, unknown> | null }>(
      functions[operation],
      parameters,
    );
    const response = result.rows[0]?.response;
    if (!response || response['resultCode'] === 'forbidden')
      reject('learning_work_unavailable', 404);
    if (response['resultCode'] !== 'ok') {
      const code = String(response['resultCode'] ?? 'response_unavailable');
      reject(code === 'request_conflict' ? 'idempotency_conflict' : code, 409);
    }
    const receipt = { ...response };
    delete receipt['resultCode'];
    return receipt;
  }

  @Get(':activityRunId')
  read(@Req() request: FastifyRequest, @Param('activityRunId') runId: string) {
    return this.command(request, runId, 'read');
  }

  @Get(':activityRunId/media/:role/:contentHash')
  async media(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Param('role') role: string,
    @Param('contentHash') contentHash: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    if (
      !UUID.test(runId) ||
      !['image', 'file'].includes(role) ||
      !/^[a-f0-9]{64}$/.test(contentHash)
    )
      reject('validation_error', 400);
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    const account = seat ? null : await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!seat && !account) reject('unauthorized', 401);
    if (!this.pool) reject('database_unavailable', 503);
    const result = await this.pool.query<{ media_bytes: Buffer; content_type: string }>(
      'SELECT * FROM learning_essay_media_read($1,$2,$3,$4)',
      [(seat ?? account!).principalId, runId, role, contentHash],
    );
    const row = result.rows[0];
    if (
      !row ||
      !Buffer.isBuffer(row.media_bytes) ||
      (role === 'file'
        ? row.content_type !== 'application/pdf'
        : !['image/png', 'image/jpeg', 'image/webp'].includes(row.content_type))
    )
      reject('learning_media_unavailable', 404);
    reply
      .header('content-type', row.content_type)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff');
    if (role === 'file') reply.header('content-disposition', 'attachment; filename="material.pdf"');
    return reply.send(row.media_bytes);
  }

  @Post(':activityRunId/start')
  @HttpCode(200)
  start(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, runId, 'start', body);
  }

  @Put(':activityRunId/draft')
  save(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, runId, 'save', body);
  }

  @Post(':activityRunId/submit')
  @HttpCode(200)
  submit(
    @Req() request: FastifyRequest,
    @Param('activityRunId') runId: string,
    @Body() body: unknown,
  ) {
    return this.command(request, runId, 'submit', body);
  }
}
