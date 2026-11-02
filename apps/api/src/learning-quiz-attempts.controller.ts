import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { checkBodyShape } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reject(code: string, status: number): never {
  throw new HttpException({ error: { code, message: 'Попытка теста недоступна.' } }, status);
}

function boundedAnswerShape(input: object): boolean {
  // The supported response union is shallow. Reject arbitrary nesting before
  // JSON.stringify can overflow, and non-finite numbers before they become null.
  // Exact frozen question types/options remain the SQL boundary's authority.
  for (const answer of Object.values(input) as unknown[]) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false;
    const keys = Object.keys(answer);
    if (keys.length !== 1) return false;
    if (keys[0] === 'value') {
      const value = (answer as { value: unknown }).value;
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'boolean' &&
        !(typeof value === 'number' && Number.isFinite(value))
      )
        return false;
    } else if (keys[0] === 'values') {
      const values = (answer as { values: unknown }).values;
      if (
        values !== null &&
        (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
      )
        return false;
    } else return false;
  }
  return true;
}

/** Persistence only. Final submission and grading use the canonical pipeline in a later slice. */
@Controller('api/learning')
export class LearningQuizAttemptsController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
  ) {}

  private async actor(request: FastifyRequest) {
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    const account = seat ? null : await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!seat && !account) reject('unauthorized', 401);
    if (!this.pool) reject('database_unavailable', 503);
    return (seat ?? account)!.principalId;
  }

  @Post('activity-participations/:participationId/attempts')
  @Header('Cache-Control', 'private, no-store')
  @HttpCode(200)
  async start(
    @Req() request: FastifyRequest,
    @Param('participationId') participationId: string,
    @Body() raw: unknown,
  ) {
    const shape = checkBodyShape(raw, ['requestId']);
    const requestId = shape.ok ? shape.body['requestId'] : null;
    if (
      !UUID.test(participationId) ||
      !shape.ok ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)
    )
      reject('validation_error', 400);
    const actor = await this.actor(request);
    const result = await this.pool!.query('SELECT * FROM learning_quiz_attempt_start($1,$2,$3)', [
      actor,
      participationId,
      requestId,
    ]);
    const row = result.rows[0];
    if (!row || row['result_code'] === 'forbidden') reject('quiz_attempt_unavailable', 404);
    if (row['result_code'] !== 'ok' || !row['attempt'])
      reject(String(row['result_code'] ?? 'start_failed'), 409);
    return { attempt: row['attempt'] as Record<string, unknown>, reused: row['reused'] === true };
  }

  @Get('attempts/:attemptId')
  @Header('Cache-Control', 'private, no-store')
  async read(@Req() request: FastifyRequest, @Param('attemptId') attemptId: string) {
    if (!UUID.test(attemptId)) reject('validation_error', 400);
    const actor = await this.actor(request);
    const result = await this.pool!.query('SELECT learning_quiz_attempt_read($1,$2) AS attempt', [
      actor,
      attemptId,
    ]);
    const attempt = result.rows[0]?.['attempt'] as Record<string, unknown> | null;
    if (!attempt) reject('quiz_attempt_unavailable', 404);
    return { attempt };
  }

  @Patch('attempts/:attemptId/quiz-answers')
  @Header('Cache-Control', 'private, no-store')
  async save(
    @Req() request: FastifyRequest,
    @Param('attemptId') attemptId: string,
    @Body() raw: unknown,
  ) {
    const shape = checkBodyShape(raw, ['expectedVersion', 'answers']);
    const expected = shape.ok ? shape.body['expectedVersion'] : null;
    const answers = shape.ok ? shape.body['answers'] : null;
    if (
      !UUID.test(attemptId) ||
      !shape.ok ||
      typeof expected !== 'number' ||
      !Number.isSafeInteger(expected) ||
      expected < 1 ||
      expected >= 2_147_483_647 ||
      !answers ||
      typeof answers !== 'object' ||
      Array.isArray(answers) ||
      !boundedAnswerShape(answers)
    )
      reject('validation_error', 400);
    const serialized = JSON.stringify(answers);
    if (Buffer.byteLength(serialized) > 262144) reject('validation_error', 400);
    const actor = await this.actor(request);
    const result = await this.pool!.query(
      'SELECT * FROM learning_quiz_attempt_save($1,$2,$3,$4::jsonb)',
      [actor, attemptId, expected, serialized],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] === 'forbidden') reject('quiz_attempt_unavailable', 404);
    if (row['result_code'] !== 'ok' || !row['attempt'])
      reject(
        String(row['result_code'] ?? 'save_failed'),
        row['result_code'] === 'invalid_answers' ? 400 : 409,
      );
    const attempt = row['attempt'] as Record<string, unknown>;
    const version = attempt['version'];
    const savedAt = attempt['lastSavedAt'];
    const expiresAt = attempt['expiresAt'];
    if (
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version !== expected + 1 ||
      typeof savedAt !== 'string' ||
      !Number.isFinite(Date.parse(savedAt)) ||
      (expiresAt !== null &&
        (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))))
    )
      reject('save_failed', 409);
    return { version, savedAt, expiresAt };
  }
}
