import { Controller, Get, HttpException, Inject, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { OpenProjectUseCase } from '@asa-lab/projects';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { LearningCanonicalProjectionService } from './learning-canonical-projection.service.js';
import {
  learningWorkContextForProject,
  type LearningWorkContext,
} from './learning-work-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
}
