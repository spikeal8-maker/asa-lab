import { Body, Controller, Get, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, status = 400): never {
  throw new HttpException(
    {
      error: {
        code,
        message: code === 'preferences_conflict' ? 'Настройки изменились. Обновите форму.' : code,
      },
    },
    status,
  );
}

@Controller('api/learning/notifications')
export class LearningNotificationsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}
  private db(): pg.Pool {
    if (!this.pool) fail('database_unavailable', 503);
    return this.pool;
  }
  private async actor(request: FastifyRequest): Promise<string> {
    // The same precedence as Project Core; two cookies never combine identities.
    const account = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (account) return account.principalId;
    const seat = await this.seats.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    if (seat) return seat.principalId;
    return fail('unauthorized', 401);
  }
  @Get()
  async list(@Req() request: FastifyRequest) {
    const actor = await this.actor(request);
    const result = await this.db().query(
      `SELECT now() AS snapshot, learning_notifications_unread($1) AS unread,
      COALESCE((SELECT jsonb_agg(item) FROM learning_notifications_list($1)), '[]') AS items`,
      [actor],
    );
    return result.rows[0];
  }
  @Post('/read')
  async read(@Req() request: FastifyRequest, @Body() body: unknown) {
    const actor = await this.actor(request),
      shape = checkBodyShape(body, ['ids', 'asOf']);
    if (!shape.ok) fail('invalid_body');
    const ids = shape.body['ids'],
      asOf = shape.body['asOf'];
    if (
      !(
        ids === null ||
        (Array.isArray(ids) &&
          ids.length <= 100 &&
          ids.every((id) => typeof id === 'string' && uuid.test(id)))
      ) ||
      typeof asOf !== 'string' ||
      !Number.isFinite(Date.parse(asOf))
    )
      fail('invalid_read');
    const result = await this.db().query(
      'SELECT learning_notifications_mark_read($1,$2::uuid[],$3::timestamptz) AS count',
      [actor, ids, asOf],
    );
    return result.rows[0];
  }
  @Get('/preferences')
  async preferences(@Req() request: FastifyRequest) {
    const result = await this.db().query(
      'SELECT learning_notification_preferences_get($1) AS value',
      [await this.actor(request)],
    );
    return result.rows[0].value;
  }
  @Post('/preferences')
  async save(@Req() request: FastifyRequest, @Body() body: unknown) {
    const actor = await this.actor(request),
      shape = checkBodyShape(body, [
        'revision',
        'masterEnabled',
        'categories',
        'classOverrides',
        'requestId',
      ]);
    if (!shape.ok) fail('invalid_body');
    const b = shape.body;
    if (
      !Number.isInteger(b['revision']) ||
      typeof b['masterEnabled'] !== 'boolean' ||
      typeof b['requestId'] !== 'string' ||
      !b['categories'] ||
      !b['classOverrides']
    )
      fail('invalid_preferences');
    const result = await this.db().query(
      'SELECT learning_notification_preferences_save($1,$2,$3,$4::jsonb,$5::jsonb,$6) AS code',
      [
        actor,
        b['revision'],
        b['masterEnabled'],
        JSON.stringify(b['categories']),
        JSON.stringify(b['classOverrides']),
        b['requestId'],
      ],
    );
    const code = result.rows[0].code as string;
    if (code !== 'ok')
      fail(code, code.endsWith('conflict') ? 409 : code === 'forbidden' ? 403 : 400);
    return this.preferences(request);
  }
  @Get('/classes/:classroomId/reminders')
  async reminders(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    if (!uuid.test(classroomId)) fail('invalid_classroom');
    const result = await this.db().query('SELECT learning_class_reminders($1,$2) AS value', [
      await this.actor(request),
      classroomId,
    ]);
    if (!result.rows[0].value) fail('not_found', 404);
    return result.rows[0].value;
  }
  @Post('/classes/:classroomId/reminders')
  async saveReminders(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() body: unknown,
  ) {
    if (!uuid.test(classroomId)) fail('invalid_classroom');
    const shape = checkBodyShape(body, ['revision', 'due', 'overdue']);
    if (!shape.ok) fail('invalid_body');
    const b = shape.body;
    if (
      !Number.isInteger(b['revision']) ||
      typeof b['due'] !== 'boolean' ||
      typeof b['overdue'] !== 'boolean'
    )
      fail('invalid_policy');
    const result = await this.db().query(
      'SELECT learning_class_reminders($1,$2,$3,$4,$5) AS value',
      [await this.actor(request), classroomId, b['revision'], b['due'], b['overdue']],
    );
    if (!result.rows[0].value) fail('not_found', 404);
    if (result.rows[0].value.error) fail('revision_conflict', 409);
    return result.rows[0].value;
  }
}
