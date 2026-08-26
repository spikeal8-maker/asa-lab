import { Body, Controller, Get, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string) {
  return { error: { code, message } };
}

@Controller('api/classrooms')
export class LearningDirectAssignmentController {
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
    const educator = (await this.accounts.capabilities(context.accountId)).find(
      (entry) => entry.capability === 'educator',
    );
    if (!educator || !['verified', 'provisional'].includes(educator.state)) {
      throw new HttpException(error('educator_required', 'Доступно только педагогам.'), 403);
    }
    return context;
  }

  @Get(':classroomId/learning/activities')
  async activities(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    if (!UUID_PATTERN.test(classroomId)) {
      throw new HttpException(error('validation_error', 'classroom is invalid'), 400);
    }
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT activity_id,activity_version_id,title,instructions,kind,module_key
         FROM learning_direct_assignment_activity_list($1,$2,$3)`,
      [context.principalId, context.tenantId, classroomId],
    );
    return {
      items: result.rows.map((row) => ({
        id: String(row['activity_id']),
        versionId: String(row['activity_version_id']),
        title: String(row['title']),
        instructions: row['instructions'] ? String(row['instructions']) : null,
        kind: String(row['kind']),
        moduleKey: String(row['module_key']),
      })),
    };
  }

  @Post(':classroomId/learning/activity-runs')
  async assign(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    if (!UUID_PATTERN.test(classroomId)) {
      throw new HttpException(error('validation_error', 'classroom is invalid'), 400);
    }
    const shape = checkBodyShape(rawBody, [
      'activityVersionId',
      'audienceType',
      'seatIds',
      'dueAt',
      'requestId',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const activityVersionId = shape.body['activityVersionId'];
    const audienceType = shape.body['audienceType'];
    const seatIds = shape.body['seatIds'];
    const dueAt = shape.body['dueAt'] ?? null;
    const requestId = shape.body['requestId'];
    if (
      typeof activityVersionId !== 'string' ||
      !UUID_PATTERN.test(activityVersionId) ||
      !['whole_class', 'named_learners'].includes(String(audienceType)) ||
      !Array.isArray(seatIds) ||
      seatIds.some((seatId) => typeof seatId !== 'string' || !UUID_PATTERN.test(seatId)) ||
      (audienceType === 'whole_class' && seatIds.length !== 0) ||
      (audienceType === 'named_learners' && seatIds.length === 0) ||
      (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,80}$/.test(requestId)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте параметры назначения.'), 400);
    }
    const context = await this.requireEducator(request);
    try {
      const result = await this.requirePool().query(
        `SELECT result_code,classroom_assignment_id,activity_run_id,audience_id,
                assigned_count,reused
           FROM learning_direct_assignment_create($1,$2,$3,$4,$5,$6,$7::uuid[],$8)`,
        [
          context.principalId,
          context.tenantId,
          classroomId,
          activityVersionId,
          dueAt,
          audienceType,
          seatIds,
          requestId,
        ],
      );
      const row = result.rows[0];
      if (!row || row['result_code'] !== 'ok') {
        const code = String(row?.['result_code'] ?? 'assignment_failed');
        const status = code === 'forbidden' ? 403 : 409;
        throw new HttpException(
          error(
            code,
            code === 'named_learner_ineligible'
              ? 'Ученик больше не доступен в классе.'
              : 'Не удалось назначить задание.',
          ),
          status,
        );
      }
      return {
        assignmentId: String(row['classroom_assignment_id']),
        activityRunId: String(row['activity_run_id']),
        audienceId: String(row['audience_id']),
        assignedCount: Number(row['assigned_count']),
        reused: row['reused'] === true,
      };
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      const message = cause instanceof Error ? cause.message : '';
      if (message.includes('membership withdrawn')) {
        throw new HttpException(
          error('learner_withdrawn', 'Один из учеников больше не может получить это задание.'),
          409,
        );
      }
      throw cause;
    }
  }
}
