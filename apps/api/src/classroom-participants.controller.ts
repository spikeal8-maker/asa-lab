import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type pg from 'pg';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { checkBodyShape } from './validation.js';
import { canonicalClassroomAvatar } from './classroom-participant-avatar.js';
import { LearningCanonicalProjectionService } from './learning-canonical-projection.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}

/** Separate route families choose the credential, even when both cookies are
 * present. A Seat endpoint never falls back to the neighbouring Account. */
@Controller('api')
export class ClassroomParticipantsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}
  private db(): pg.Pool {
    if (!this.pool) fail('database_unavailable', 'Сервер данных недоступен.', 503);
    return this.pool;
  }
  private uuid(id: string): string {
    if (!UUID.test(id)) fail('validation_error', 'Некорректный идентификатор.', 400);
    return id;
  }
  private async account(request: FastifyRequest): Promise<string> {
    const context = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) fail('unauthorized', 'Войдите в аккаунт.', 401);
    return context.principalId;
  }
  private async seat(request: FastifyRequest) {
    const context = await this.seats.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    if (!context) fail('unauthorized', 'Войдите по коду ученика.', 401);
    return context;
  }
  private async read(fn: string, args: unknown[]): Promise<unknown> {
    // fn is selected exclusively in code, never from request input.
    const result = await this.db().query(
      `SELECT ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS data`,
      args,
    );
    const data = result.rows[0]?.data as unknown;
    if (data === null || data === undefined)
      fail('not_found', 'Участник или класс недоступен.', 404);
    return data;
  }
  @Get('classrooms/:classId/participants')
  async roster(@Req() request: FastifyRequest, @Param('classId') classId: string) {
    const actor = await this.account(request);
    await this.read('classroom_participant_prepare', [actor, [this.uuid(classId)]]);
    return this.read('classroom_participant_roster', [actor, classId]);
  }
  @Post('classrooms/participants/summary')
  async summary(@Req() request: FastifyRequest, @Body() body: unknown) {
    const shape = checkBodyShape(body, ['classroomIds']);
    const ids = shape.ok ? shape.body['classroomIds'] : null;
    if (
      !Array.isArray(ids) ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => typeof id === 'string' && UUID.test(id))
    ) {
      fail('validation_error', 'Ожидается список до 200 разных классов.', 400);
    }
    const actor = await this.account(request);
    await this.read('classroom_participant_prepare', [actor, ids]);
    return this.read('classroom_participant_summary', [actor, ids]);
  }
  @Get('classrooms/:classId/participants/:seatId/profile')
  async profile(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
  ) {
    const actor = await this.account(request);
    await this.read('classroom_participant_prepare', [actor, [this.uuid(classId)]]);
    const data = (await this.read('classroom_participant_profile', [
      actor,
      classId,
      this.uuid(seatId),
    ])) as { submittedCount: number; awaitingReview: number };
    const context = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) fail('unauthorized', 'Сессия завершена.', 401);
    const states = [
      ...(
        await new LearningCanonicalProjectionService(this.db()).forTeacher(
          context.accountId,
          classId,
        )
      ).values(),
    ].filter((p) => p.state.provenance.seatId === seatId);
    if (states.length) {
      data.submittedCount = states.filter((p) =>
        ['submitted', 'waiting_review', 'changes_requested', 'completed'].includes(
          p.surface.workflowState,
        ),
      ).length;
      data.awaitingReview = states.filter(
        (p) => p.surface.workflowState === 'waiting_review',
      ).length;
    }
    return data;
  }
  @Get('classrooms/:classId/participants/staff/:accountId')
  async staff(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('accountId') accountId: string,
  ) {
    return this.read('classroom_participant_staff', [
      await this.account(request),
      this.uuid(classId),
      this.uuid(accountId),
    ]);
  }
  @Get('classrooms/:classId/participants/managers')
  async managers(@Req() request: FastifyRequest, @Param('classId') classId: string) {
    return this.read('classroom_participant_managers', [
      await this.account(request),
      this.uuid(classId),
    ]);
  }
  @Get('classrooms/:classId/participants/:seatId/works')
  async works(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
    @Query('module') module: string | undefined,
    @Query('archive') archive: string | undefined,
    @Query('assignments') assignments: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    if (
      (module !== undefined && !['three-d', 'electronics', 'blocks'].includes(module)) ||
      (archive !== undefined && !['true', 'false'].includes(archive)) ||
      (assignments !== undefined && !['true', 'false'].includes(assignments)) ||
      (offset !== undefined && !/^\d{1,6}$/.test(offset)) ||
      Number(offset ?? 0) > 100000
    ) {
      fail('validation_error', 'Некорректный фильтр работ.', 400);
    }
    const actor = await this.account(request);
    const data = (await this.read('classroom_participant_works', [
      actor,
      this.uuid(classId),
      this.uuid(seatId),
      module ?? null,
      archive === 'true',
      assignments === 'true',
      Number(offset ?? 0),
    ])) as {
      items: Array<{ id: string; canonicalState: unknown }>;
    };
    // Existing shared resolver supplies the same canonical labels as the
    // journal. One class query, never one API request per work.
    const context = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) fail('unauthorized', 'Сессия завершена.', 401);
    const projections = await new LearningCanonicalProjectionService(this.db()).forTeacher(
      context.accountId,
      classId,
    );
    const surfaces = new Map(
      [...projections.values()]
        .filter((p) => p.state.provenance.seatId === seatId && p.projectId !== null)
        .map((p) => [p.projectId, p.surface]),
    );
    for (const work of data.items) {
      work.canonicalState = surfaces.get(work.id) ?? null;
    }
    return data;
  }
  @Post('classrooms/:classId/participants/actions/:action')
  async mutate(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    return this.write(await this.account(request), this.uuid(classId), action, body);
  }
  @Get('classrooms/:classId/participants/:seatId/grades')
  async grades(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
    @Query('offset') offset: string | undefined,
    @Query('resultOffset') resultOffset: string | undefined,
  ) {
    if (
      [offset, resultOffset].some(
        (value) => value !== undefined && (!/^\d{1,6}$/.test(value) || Number(value) > 100000),
      )
    )
      fail('validation_error', 'Некорректная страница оценок.', 400);
    const data = (await this.read('classroom_participant_grades', [
      await this.account(request),
      this.uuid(classId),
      this.uuid(seatId),
      Number(offset ?? 0),
      Number(resultOffset ?? 0),
    ])) as {
      journal: { grades: Array<{ seatId: string }>; students: unknown[] };
    };
    // The profile response contains only this learner, not classmates' grades.
    data.journal.grades = data.journal.grades.filter((grade) => grade.seatId === seatId);
    data.journal.students = [];
    return data;
  }
  @Get('classrooms/:classId/participants/:seatId/history/:columnId')
  async history(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
    @Param('columnId') columnId: string,
    @Query('beforeRevision') beforeRevision: string | undefined,
  ) {
    if (beforeRevision !== undefined && !/^[1-9]\d{0,8}$/.test(beforeRevision))
      fail('validation_error', 'Некорректная страница истории.', 400);
    const actor = await this.account(request);
    await this.read('classroom_participant_grades', [actor, this.uuid(classId), this.uuid(seatId)]);
    return this.read('classroom_journal_history', [
      actor,
      classId,
      this.uuid(columnId),
      seatId,
      beforeRevision ? Number(beforeRevision) : null,
      20,
    ]);
  }
  private async write(actor: string, classId: string, action: string, body: unknown) {
    if (
      ![
        'settings',
        'role',
        'merit',
        'merit_grant',
        'builtin_grant',
        'avatar',
        'avatar_grant',
        'avatar_choose',
      ].includes(action)
    ) {
      fail('validation_error', 'Неизвестное действие.', 400);
    }
    let input = body;
    if (action === 'avatar') {
      const shape = checkBodyShape(body, [
        'requestId',
        'title',
        'dataUrl',
        'secret',
        'meritId',
        'builtinAward',
      ]);
      if (!shape.ok) fail('validation_error', 'Некорректные свойства аватара.', 400);
      // Authorize before decoding untrusted pixels.
      await this.read('classroom_participant_roster', [actor, classId]);
      try {
        input = { ...shape.body, dataUrl: canonicalClassroomAvatar(shape.body['dataUrl']) };
      } catch (error) {
        fail(
          'invalid_avatar',
          error instanceof Error ? error.message : 'Некорректный аватар.',
          400,
        );
      }
    }
    const data = (await this.read('classroom_participant_write', [
      actor,
      classId,
      action,
      JSON.stringify(input),
    ])) as { error?: string };
    if (data.error) {
      const code = data.error;
      fail(
        code,
        code === 'revision_conflict'
          ? 'Настройки уже изменены. Обновите страницу.'
          : code === 'classroom_archived'
            ? 'Архивный класс доступен только для чтения.'
            : code === 'limit_reached'
              ? 'В классе разрешено до 24 заслуг и до 24 аватаров.'
              : 'Изменение не сохранено. Проверьте данные и права.',
        code === 'forbidden'
          ? 403
          : [
                'revision_conflict',
                'idempotency_conflict',
                'classroom_archived',
                'limit_reached',
              ].includes(code)
            ? 409
            : 400,
      );
    }
    return data;
  }
  @Get('classrooms/:classId/participants/:seatId/builtin-awards')
  async builtinAwards(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
  ) {
    return this.read('classroom_participant_builtin_awards', [
      await this.account(request),
      this.uuid(classId),
      this.uuid(seatId),
    ]);
  }
  @Get('classrooms/:classId/participants/:seatId/result-history/:assignmentId')
  async resultHistory(
    @Req() request: FastifyRequest,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
    @Param('assignmentId') assignmentId: string,
    @Query('offset') offset: string | undefined,
  ) {
    if (offset !== undefined && (!/^\d{1,6}$/.test(offset) || Number(offset) > 100000))
      fail('validation_error', 'Некорректная страница истории.', 400);
    return this.read('classroom_participant_result_history', [
      await this.account(request),
      this.uuid(classId),
      this.uuid(seatId),
      this.uuid(assignmentId),
      Number(offset ?? 0),
    ]);
  }
  @Get('class-join/participants/me')
  async seatProfile(@Req() request: FastifyRequest) {
    const seat = await this.seat(request);
    await this.read('classroom_participant_prepare', [seat.principalId, [seat.classroomId]]);
    return this.read('classroom_participant_profile', [
      seat.principalId,
      seat.classroomId,
      seat.seatId,
    ]);
  }
  private async image(
    reply: FastifyReply,
    actor: string,
    classId: string,
    seatId: string,
    avatarId: string,
  ) {
    const data = (await this.read('classroom_participant_avatar_read', [
      actor,
      classId,
      seatId,
      this.uuid(avatarId),
    ])) as string;
    reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .type('image/png');
    return reply.send(Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'));
  }
  @Get('class-join/participants/avatars/:avatarId/image')
  async seatImage(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('avatarId') avatarId: string,
  ) {
    const seat = await this.seat(request);
    return this.image(reply, seat.principalId, seat.classroomId, seat.seatId, avatarId);
  }
  @Get('classrooms/:classId/participants/:seatId/avatars/:avatarId/image')
  async teacherImage(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('classId') classId: string,
    @Param('seatId') seatId: string,
    @Param('avatarId') avatarId: string,
  ) {
    return this.image(
      reply,
      await this.account(request),
      this.uuid(classId),
      this.uuid(seatId),
      avatarId,
    );
  }
  @Post('class-join/participants/avatar')
  async seatAvatar(@Req() request: FastifyRequest, @Body() body: unknown) {
    const seat = await this.seat(request);
    const shape = checkBodyShape(body, ['requestId', 'id']);
    if (!shape.ok) fail('validation_error', 'Некорректный выбор аватара.', 400);
    return this.write(seat.principalId, seat.classroomId, 'avatar_choose', {
      ...shape.body,
      seatId: seat.seatId,
    });
  }
}
