import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const presets = ['five', 'hundred', 'three_five', 'smileys', 'symbols'];
const messages: Record<string, string> = {
  forbidden: 'Нет доступа к журналу этого класса.',
  unauthorized: 'Войдите заново для просмотра журнала.',
  classroom_archived: 'Архивный класс доступен только для просмотра.',
  revision_conflict: 'Оценка или шкала уже изменились. Обновите данные перед повтором.',
  idempotency_conflict: 'Этот запрос уже использован для другого изменения.',
  reason_required: 'Укажите причину исправления или очистки оценки.',
  invalid_body: 'Проверьте введённые данные.',
  invalid_grade: 'Оценка не входит в шкалу этого столбца.',
  not_found: 'Столбец или ученик недоступен.',
};
function fail(code: string, status = 400): never {
  throw new HttpException(
    { error: { code, message: messages[code] ?? 'Не удалось выполнить запрос журнала.' } },
    status,
  );
}
export function validJournalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= '2000-01-01' &&
    value <= '2100-12-31'
  );
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
  );
}

@Controller('api')
export class ClassroomJournalController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}
  private db(): pg.Pool {
    if (!this.pool) fail('database_unavailable', 503);
    return this.pool;
  }
  private id(value: string): string {
    if (!uuid.test(value)) fail('invalid_body');
    return value;
  }
  private async accountActor(request: FastifyRequest): Promise<string> {
    const cookie = request.cookies[SESSION_COOKIE];
    if (!cookie) fail('unauthorized', 401);
    const account = await this.accounts.resolve(cookie);
    return account?.principalId ?? fail('unauthorized', 401);
  }
  private async seatActor(request: FastifyRequest): Promise<string> {
    const cookie = request.cookies[STUDENT_SESSION_COOKIE];
    if (!cookie) fail('unauthorized', 401);
    const seat = await this.seats.resolve(cookie);
    return seat?.principalId ?? fail('unauthorized', 401);
  }
  private range(query: Record<string, unknown>) {
    const { from, to } = query;
    if (from === undefined && to === undefined) return [null, null];
    if (
      !validJournalDate(from) ||
      !validJournalDate(to) ||
      to < from ||
      Date.parse(to) - Date.parse(from) > 92 * 86400000
    )
      fail('invalid_body');
    return [from, to];
  }
  private integer(value: unknown, fallback: number, min: number, max: number): number {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^\d{1,10}$/.test(value) ||
      Number(value) < min ||
      Number(value) > max
    )
      fail('invalid_body');
    return Number(value);
  }
  @Get('classrooms/:classroomId/journal')
  async read(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    this.id(classroomId);
    const range = this.range(query);
    const result = await this.db().query(
      'SELECT classroom_journal_read($1,$2,$3,$4,$5,$6) AS value',
      [
        await this.accountActor(request),
        classroomId,
        ...range,
        this.integer(query['offset'], 0, 0, 1000000),
        this.integer(query['limit'], 50, 1, 50),
      ],
    );
    if (!result.rows[0]?.value) fail('forbidden', 403);
    return result.rows[0].value;
  }
  @Get('classrooms/:classroomId/journal/settings')
  async settings(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    this.id(classroomId);
    const result = await this.db().query('SELECT classroom_journal_settings($1,$2) AS value', [
      await this.accountActor(request),
      classroomId,
    ]);
    if (!result.rows[0]?.value) fail('forbidden', 403);
    return result.rows[0].value;
  }
  @Get('classrooms/:classroomId/journal/:columnId/:seatId/history')
  async history(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('columnId') columnId: string,
    @Param('seatId') seatId: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    this.id(classroomId);
    this.id(columnId);
    this.id(seatId);
    const actor = await this.accountActor(request);
    const result = await this.db().query(
      'SELECT classroom_journal_history($1,$2,$3,$4,$5,$6) AS value',
      [
        actor,
        classroomId,
        columnId,
        seatId,
        query['beforeRevision'] === undefined
          ? null
          : this.integer(query['beforeRevision'], 1, 1, 999999999),
        this.integer(query['limit'], 20, 1, 50),
      ],
    );
    if (!result.rows[0]?.value) fail('forbidden', 403);
    return result.rows[0].value;
  }
  @Post('classrooms/:classroomId/journal/:action')
  @HttpCode(200)
  async write(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    this.id(classroomId);
    const allowed =
      action === 'scale'
        ? ['requestId', 'expectedRevision', 'preset']
        : action === 'column'
          ? ['requestId', 'expectedRevision', 'date', 'category']
          : action === 'grade'
            ? ['requestId', 'expectedRevision', 'columnId', 'seatId', 'value', 'reason']
            : null;
    if (!allowed) fail('invalid_body');
    const shape = checkBodyShape(raw, allowed);
    if (!shape.ok) fail('invalid_body');
    const b = shape.body;
    if (
      typeof b['requestId'] !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(b['requestId']) ||
      !Number.isInteger(b['expectedRevision']) ||
      Number(b['expectedRevision']) < 0 ||
      Number(b['expectedRevision']) > 999999999
    )
      fail('invalid_body');
    if (action === 'scale' && !presets.includes(String(b['preset']))) fail('invalid_body');
    if (action === 'column' && (!validJournalDate(b['date']) || !text(b['category'], 80)))
      fail('invalid_body');
    if (action === 'grade') {
      if (
        typeof b['columnId'] !== 'string' ||
        !uuid.test(b['columnId']) ||
        typeof b['seatId'] !== 'string' ||
        !uuid.test(b['seatId']) ||
        !(
          b['value'] === null ||
          (typeof b['value'] === 'number' &&
            Number.isInteger(b['value']) &&
            b['value'] >= 0 &&
            b['value'] <= 100)
        ) ||
        !(b['reason'] == null || text(b['reason'], 500))
      )
        fail('invalid_body');
    }
    const result = await this.db().query(
      'SELECT classroom_journal_write($1,$2,$3,$4::jsonb) AS value',
      [await this.accountActor(request), classroomId, action, JSON.stringify(b)],
    );
    const value = result.rows[0]?.value;
    if (!value) fail('database_unavailable', 503);
    if (value.error)
      fail(
        value.error,
        value.error === 'forbidden'
          ? 403
          : value.error === 'not_found'
            ? 404
            : ['revision_conflict', 'idempotency_conflict', 'classroom_archived'].includes(
                  value.error,
                )
              ? 409
              : 400,
      );
    return value;
  }
  @Get('learning/journal/results')
  async results(@Req() request: FastifyRequest, @Query() query: Record<string, unknown> = {}) {
    return this.learnerResults(await this.accountActor(request), query);
  }
  @Get('class-join/journal/results')
  async seatResults(@Req() request: FastifyRequest, @Query() query: Record<string, unknown> = {}) {
    return this.learnerResults(await this.seatActor(request), query);
  }
  private async learnerResults(actor: string, query: Record<string, unknown>) {
    const range = this.range(query);
    const column = query['columnId'];
    if (column !== undefined && (typeof column !== 'string' || !uuid.test(column)))
      fail('invalid_body');
    const result = await this.db().query(
      'SELECT classroom_journal_results($1,$2,$3,$4,$5,$6) AS value',
      [
        actor,
        ...range,
        this.integer(query['offset'], 0, 0, 1000000),
        this.integer(query['limit'], 20, 1, 50),
        column ?? null,
      ],
    );
    return result.rows[0].value;
  }
}
