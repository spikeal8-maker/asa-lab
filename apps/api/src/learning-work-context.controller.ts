import {
  Body,
  Controller,
  Get,
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
import type { OpenProjectUseCase } from '@asa-lab/projects';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { checkBodyShape } from './validation.js';
import { LearningCanonicalProjectionService } from './learning-canonical-projection.service.js';
import {
  learningWorkContextForProject,
  type LearningWorkContext,
} from './learning-work-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

interface OriginSubmissionRow {
  result_code: string;
  participation_id: string | null;
  activity_run_id: string | null;
  attempt_id: string | null;
  submission_id: string | null;
  attempt_number: number | string | null;
  attempt_state: string | null;
  project_id: string | null;
  project_version_id: string | null;
  submitted_at: Date | string | null;
  late_state: string | null;
  reused: boolean | null;
}

@Controller('api/learning/projects')
export class LearningWorkContextController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.openProjectUseCase) private readonly openProject: OpenProjectUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  @Get(':projectId/context')
  async context(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<LearningWorkContext> {
    if (!UUID_PATTERN.test(projectId)) {
      throw new HttpException(
        { error: { code: 'validation_error', message: 'invalid project' } },
        400,
      );
    }
    const account = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    const seat = account
      ? null
      : await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    if (!account && !seat) {
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'no active session' } },
        401,
      );
    }
    const actor = account ?? seat!;
    const opened = await this.openProject.execute(actor.tenantId, projectId, {
      principalId: actor.principalId,
      userId: actor.userId,
    });
    // Both an absent project and one inaccessible to this actor are identical.
    if (!opened.ok) return { state: 'denied', projectId };
    if (!this.pool) return { state: 'unavailable', projectId };

    const projections = await (account
      ? new LearningCanonicalProjectionService(this.pool).forAccount(account.accountId)
      : new LearningCanonicalProjectionService(this.pool).forSeat(seat!.seatId));
    return learningWorkContextForProject(
      this.pool,
      actor.principalId,
      projectId,
      opened.value.project.moduleKey,
      projections,
    );
  }

  /** Submit the exact current Attempt of this immutable-origin Project. */
  @Post(':projectId/submit')
  @HttpCode(200)
  async submit(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['clientRequestId', 'expectedRevision']);
    const requestId = shape.ok ? shape.body['clientRequestId'] : null;
    const expectedRevision = shape.ok ? shape.body['expectedRevision'] : null;
    if (
      !UUID_PATTERN.test(projectId) ||
      !shape.ok ||
      typeof requestId !== 'string' ||
      !REQUEST_PATTERN.test(requestId) ||
      typeof expectedRevision !== 'number' ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision > 2_147_483_647
    ) {
      throw new HttpException(
        { error: { code: 'validation_error', message: 'invalid submission request' } },
        400,
      );
    }
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    const account = seat ? null : await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!account && !seat) {
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'no active session' } },
        401,
      );
    }
    if (!this.pool) {
      throw new HttpException(
        { error: { code: 'database_unavailable', message: 'unavailable' } },
        503,
      );
    }
    const actor = account ?? seat!;
    const result = await this.pool.query<OriginSubmissionRow>(
      'SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)',
      [actor.principalId, projectId, requestId, expectedRevision],
    );
    const row = result.rows[0];
    if (!row || row.result_code === 'forbidden' || row.result_code === 'not_started') {
      throw new HttpException(
        { error: { code: 'learning_work_unavailable', message: 'Учебная работа недоступна.' } },
        404,
      );
    }
    if (row.result_code !== 'ok') {
      const code =
        row.result_code === 'request_conflict' ? 'idempotency_conflict' : row.result_code;
      throw new HttpException({ error: { code, message: 'Сдача не зафиксирована.' } }, 409);
    }
    if (
      !row.participation_id ||
      !row.activity_run_id ||
      !row.attempt_id ||
      !row.submission_id ||
      !row.project_version_id ||
      !row.submitted_at ||
      !row.attempt_number ||
      !row.attempt_state ||
      !row.late_state ||
      typeof row.reused !== 'boolean' ||
      row.project_id !== projectId
    ) {
      throw new HttpException(
        { error: { code: 'submission_failed', message: 'Сдача не зафиксирована.' } },
        409,
      );
    }
    return {
      projectId,
      participationId: row.participation_id,
      activityRunId: row.activity_run_id,
      attemptId: row.attempt_id,
      submissionId: row.submission_id,
      attemptNumber: Number(row.attempt_number),
      state: row.attempt_state,
      projectVersionId: row.project_version_id,
      submittedAt:
        row.submitted_at instanceof Date ? row.submitted_at.toISOString() : row.submitted_at,
      lateState: row.late_state,
      reused: row.reused,
    };
  }
}
