import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';
import { checkBodyShape, checkIdempotencyKey } from './validation.js';
import { publicationError } from './public-projects.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set([
  'spam',
  'abuse',
  'dangerous_content',
  'personal_data',
  'copyright',
  'other',
]);

export interface PublicationReportReceipt {
  readonly reportId: string;
  readonly status: 'received';
  readonly duplicate: boolean;
}

/** A report is an incoming private signal, never an automatic hide decision. */
@Controller('api/public-projects')
export class PublicProjectReportsController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
  ) {}

  @Post(':publicationId/reports')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async report(
    @Req() request: FastifyRequest,
    @Param('publicationId') publicationId: string,
    @Headers('idempotency-key') rawKey: unknown,
    @Body() rawBody: unknown,
  ): Promise<PublicationReportReceipt> {
    // An explicitly selected StudentSeat cannot fall back to any Account cookie.
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE)) {
      throw publicationError(
        'report_forbidden',
        'Пожаловаться можно только из личного аккаунта.',
        403,
      );
    }

    const actor = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) {
      throw publicationError('unauthorized', 'Войдите в аккаунт.', 401);
    }
    if (!UUID.test(publicationId)) {
      throw publicationError('validation_error', 'Некорректная публикация.', 400);
    }

    const key = checkIdempotencyKey(rawKey);
    if (!key.ok || key.key.startsWith('learning:')) {
      throw publicationError('invalid_idempotency_key', 'Укажите допустимый Idempotency-Key.', 400);
    }

    const checked = checkBodyShape(rawBody, ['revisionId', 'reason', 'comment']);
    if (!checked.ok) {
      throw publicationError('validation_error', 'Некорректная жалоба.', 400);
    }

    const revisionId = checked.body['revisionId'];
    const reason = checked.body['reason'];
    const comment = checked.body['comment'];
    // Match PostgreSQL char_length: count Unicode code points, not UTF-16 units.
    const commentLength =
      typeof comment === 'string' ? Array.from(comment.trim()).length : 0;
    if (
      typeof revisionId !== 'string' ||
      !UUID.test(revisionId) ||
      typeof reason !== 'string' ||
      !REASONS.has(reason) ||
      (comment !== undefined && typeof comment !== 'string') ||
      (typeof comment === 'string' && (comment.includes('\0') || commentLength > 500))
    ) {
      throw publicationError('validation_error', 'Проверьте категорию и комментарий.', 400);
    }

    if (!this.pool) {
      throw publicationError('database_unavailable', 'База данных недоступна.', 503);
    }

    try {
      const result = await this.pool.query<{ result: PublicationReportReceipt }>(
        'SELECT public.project_publication_report_create($1,$2,$3,$4,$5,$6) AS result',
        [actor.principalId, publicationId, revisionId, reason, comment ?? '', key.key],
      );
      const receipt = result.rows[0]?.result;
      if (!receipt || receipt.status !== 'received' || typeof receipt.reportId !== 'string') {
        throw publicationError('report_unavailable', 'Не удалось сохранить жалобу.', 503);
      }
      return {
        reportId: receipt.reportId,
        status: 'received',
        duplicate: receipt.duplicate === true,
      };
    } catch (cause) {
      const code =
        typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null;
      switch (code) {
        case '42501':
          throw publicationError('report_forbidden', 'Жалоба недоступна.', 403);
        case '22023':
        case '22P02':
        case '22021':
          throw publicationError('validation_error', 'Проверьте данные жалобы.', 400);
        case 'P5P04':
          throw publicationError('not_available', 'Публикация недоступна.', 404);
        case 'P5R09':
          throw publicationError(
            'report_conflict',
            'Публикация изменилась или жалоба уже зарегистрирована.',
            409,
          );
        case 'P5R29':
          throw publicationError('report_rate_limited', 'Слишком много жалоб.', 429);
        case '08000':
        case '08001':
        case '08003':
        case '08004':
        case '08006':
        case '08007':
        case '08P01':
        case '57P01':
        case '57P02':
        case '57P03':
        case '53300':
        case '53400':
        case 'ECONNREFUSED':
        case 'ECONNRESET':
        case 'ETIMEDOUT':
          throw publicationError('database_unavailable', 'База данных недоступна.', 503);
        default:
          throw cause;
      }
    }
  }
}
