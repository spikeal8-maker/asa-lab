import { Body, Controller, Get, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISIONS = ['accepted', 'changes_requested', 'incomplete', 'excused'] as const;

function error(code: string, message: string) {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Controller('api/classrooms')
export class LearningAssessmentsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Проверка доступна педагогам.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  /** One canonical matrix for work state, result and published grade. */
  @Get(':classroomId/gradebook')
  async gradebook(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const result = await this.requirePool().query(
      `SELECT seat_id, display_label, assignment_id, assignment_title,
              attempt_id, attempt_number, attempt_state, submitted_at,
              raw_points, max_points, percentage_basis_points, outcome,
              feedback, published_at
         FROM classroom_gradebook_list($1, $2)`,
      [context.accountId, classroomId],
    );
    return {
      items: result.rows.map((row) => ({
        seatId: String(row['seat_id']),
        displayLabel: String(row['display_label']),
        assignmentId: String(row['assignment_id']),
        assignmentTitle: String(row['assignment_title']),
        attemptId: row['attempt_id'] ? String(row['attempt_id']) : null,
        attemptNumber: row['attempt_number'] === null ? null : Number(row['attempt_number']),
        state: row['attempt_state'] ? String(row['attempt_state']) : 'not_started',
        submittedAt: row['submitted_at'] ? iso(row['submitted_at'] as Date | string) : null,
        points: row['raw_points'] === null ? null : Number(row['raw_points']),
        maxPoints: row['max_points'] === null ? null : Number(row['max_points']),
        percentage:
          row['percentage_basis_points'] === null
            ? null
            : Number(row['percentage_basis_points']) / 100,
        outcome: row['outcome'] ? String(row['outcome']) : null,
        feedback: row['feedback'] ? String(row['feedback']) : null,
        publishedAt: row['published_at'] ? iso(row['published_at'] as Date | string) : null,
      })),
    };
  }

  /** Review exactly one immutable attempt and publish its canonical result. */
  @Post(':classroomId/attempts/:attemptId/review')
  async review(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('attemptId') attemptId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(attemptId, 'attempt');
    const shape = checkBodyShape(rawBody, ['decision', 'points', 'feedback', 'reason']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const decision = shape.body['decision'];
    const points = shape.body['points'] ?? null;
    const feedback = shape.body['feedback'] ?? null;
    const reason = shape.body['reason'] ?? null;
    if (
      typeof decision !== 'string' ||
      !DECISIONS.includes(decision as (typeof DECISIONS)[number])
    ) {
      throw new HttpException(error('validation_error', 'Неизвестное решение проверки.'), 400);
    }
    if (
      points !== null &&
      (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 1_000_000)
    ) {
      throw new HttpException(error('validation_error', 'Баллы должны быть целым числом.'), 400);
    }
    if (feedback !== null && (typeof feedback !== 'string' || feedback.length > 8000)) {
      throw new HttpException(error('validation_error', 'Отзыв слишком длинный.'), 400);
    }
    if (reason !== null && (typeof reason !== 'string' || reason.length > 1000)) {
      throw new HttpException(error('validation_error', 'Причина слишком длинная.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, assessment_result_id, gradebook_entry_id,
              attempt_state, percentage_basis_points
         FROM learning_attempt_review($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        context.accountId,
        context.principalId,
        classroomId,
        attemptId,
        decision,
        points,
        feedback,
        reason,
      ],
    );
    const row = result.rows[0] as
      | {
          result_code: string;
          assessment_result_id: string | null;
          gradebook_entry_id: string | null;
          attempt_state: string | null;
          percentage_basis_points: number | string | null;
        }
      | undefined;
    if (!row || row.result_code === 'attempt_not_found') {
      throw new HttpException(error('attempt_not_found', 'Попытка не найдена.'), 404);
    }
    if (row.result_code === 'classroom_not_found') {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    if (row.result_code !== 'ok') {
      const messages: Record<string, string> = {
        invalid_decision: 'Неизвестное решение проверки.',
        invalid_transition: 'Эту попытку уже проверили или вернули.',
        invalid_points: 'Баллы выходят за пределы задания.',
        invalid_feedback: 'Отзыв слишком длинный.',
        reason_required: 'Для этого решения нужна причина.',
      };
      throw new HttpException(
        error(row.result_code, messages[row.result_code] ?? 'Не удалось сохранить результат.'),
        409,
      );
    }
    return {
      attemptId,
      state: row.attempt_state,
      assessmentResultId: row.assessment_result_id,
      gradebookEntryId: row.gradebook_entry_id,
      percentage:
        row.percentage_basis_points === null ? null : Number(row.percentage_basis_points) / 100,
    };
  }
}
