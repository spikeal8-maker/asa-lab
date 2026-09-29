import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { PgProjectRepository, type CreateProjectUseCase } from '@asa-lab/projects';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { checkBodyShape } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

interface Admission {
  result_code: string;
  participation_id: string | null;
  module_key: string | null;
  project_tenant_id: string | null;
  existing_project_id: string | null;
  existing_attempt_id: string | null;
}

interface Started {
  result_code: string;
  participation_id: string;
  attempt_id: string;
  attempt_number: number | string;
  attempt_state: string;
  project_id: string;
  reused: boolean;
}

function reject(code: string, status: number): never {
  throw new HttpException({ error: { code, message: 'Учебная работа недоступна.' } }, status);
}

@Controller('api/learning/work')
export class LearningStartController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.createProjectUseCase) private readonly createProject: CreateProjectUseCase,
  ) {}

  /** Start the exact ActivityRun, independent of its compatibility handout. */
  @Post('runs/:activityRunId/start')
  @HttpCode(200)
  async start(
    @Req() request: FastifyRequest,
    @Param('activityRunId') activityRunId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['requestId']);
    const requestId = shape.ok ? shape.body['requestId'] : null;
    if (
      !UUID_PATTERN.test(activityRunId) ||
      !shape.ok ||
      typeof requestId !== 'string' ||
      !REQUEST_PATTERN.test(requestId)
    ) {
      reject('validation_error', 400);
    }
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    const account = seat ? null : await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!account && !seat) reject('unauthorized', 401);
    if (!this.pool) reject('database_unavailable', 503);
    const actor = account ?? seat!;
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const admission = await client.query(`SELECT * FROM learning_work_start_admit($1,$2,$3)`, [
        actor.principalId,
        activityRunId,
        requestId,
      ]);
      const admitted = admission.rows[0] as Admission | undefined;
      if (!admitted) reject('start_unavailable', 409);
      if (admitted.result_code !== 'ok' && admitted.result_code !== 'replay') {
        reject(admitted.result_code, admitted.result_code === 'forbidden' ? 404 : 409);
      }
      let projectId = admitted.existing_project_id;
      if (!projectId) {
        if (!admitted.project_tenant_id || !admitted.module_key || !admitted.participation_id)
          reject('start_unavailable', 409);
        const repository = new PgProjectRepository(this.pool).inTransaction(client);
        const created = await this.createProject.withRepository(repository).execute({
          tenantId: admitted.project_tenant_id,
          scope: 'personal',
          classroomId: null,
          // The personal workspace may be a different tenant from the school.
          // No school-scoped legacy user ID is written into a personal Project.
          actor: { principalId: actor.principalId, userId: null },
          moduleKey: admitted.module_key,
          title: undefined,
          automaticTitle: true,
          idempotencyKey: `learning:${admitted.participation_id}`,
        });
        if (!created.ok) {
          reject(created.code, created.code === 'validation_error' ? 400 : 409);
        }
        // Admission found no origin, so this transaction must create the Project.
        // An older generic Project with the deterministic key is not Learning work.
        if (!created.value.created) reject('project_idempotency_conflict', 409);
        projectId = created.value.project.id;
      }
      const completed = await client.query(
        `SELECT * FROM learning_work_start_complete($1,$2,$3,$4)`,
        [actor.principalId, activityRunId, requestId, projectId],
      );
      const row = completed.rows[0] as Started | undefined;
      if (!row || row.result_code !== 'ok' || !row.project_id || !row.attempt_id) {
        reject('start_unavailable', 409);
      }
      const committed = await client.query('COMMIT');
      if (committed.command !== 'COMMIT') throw new Error('learning start was not committed');
      return {
        projectId: row.project_id,
        participationId: row.participation_id,
        activityRunId,
        attemptId: row.attempt_id,
        attemptNumber: Number(row.attempt_number),
        state: row.attempt_state,
        reused: row.reused,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        discard = true;
      });
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'PZ001'
      ) {
        reject('start_conflict', 409);
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
}
