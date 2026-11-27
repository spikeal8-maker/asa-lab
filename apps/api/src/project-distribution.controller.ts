import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';
import { noteAuthoritativeMutationSession } from './mutation-session-proof.js';
import { checkBodyShape } from './validation.js';
import { PublicScratchPlayerService } from './public-scratch-player.js';
import {
  decideStudentPublicationReview,
  readStudentPublicationReviewArtifact,
  readStudentPublicationReviewQueue,
  readStudentPublicationReviewRaster,
  sendStudentPublicationReviewRaster,
} from './student-publication-review.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reject(status: number, code: string): never {
  throw new HttpException({ error: { code, message: code } }, status);
}
@Controller('api/project-distribution/classrooms/:classroomId')
export class ProjectDistributionController {
  private readonly scratchReview: PublicScratchPlayerService;

  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly account: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {
    this.scratchReview = new PublicScratchPlayerService(pool);
  }
  private async reviewer(request: FastifyRequest, id: string) {
    if (!UUID.test(id)) reject(400, 'invalid_id');
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE))
      reject(403, 'teacher_context_required');
    const actor = await this.account.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) reject(401, 'unauthorized');
    noteAuthoritativeMutationSession(request, 'account', request.cookies[SESSION_COOKIE]);
    if (!this.pool) reject(503, 'database_unavailable');
    return {
      account: actor,
      pool: this.pool,
      review: { role: 'teacher' as const, actor: actor.principalId, classroomId: id },
    };
  }

  private async policy(
    request: FastifyRequest,
    id: string,
    seat: string | null,
    body?: unknown,
  ): Promise<unknown> {
    if (seat !== null && !UUID.test(seat)) reject(400, 'invalid_id');
    const { account: actor, pool } = await this.reviewer(request, id);
    const shape =
      body === undefined
        ? null
        : checkBodyShape(
            body,
            seat
              ? ['publishOverride', 'downloadOverride', 'commentsOverride', 'expectedVersion']
              : ['publish', 'download', 'comments', 'expectedVersion'],
          );
    if (shape && !shape.ok) reject(400, 'invalid_policy');
    // An invited co-teacher may keep a different personal workspace active.
    // Derive the resource tenant through the existing exact-class ACL; the
    // audited policy writer rechecks that ACL after acquiring its class lock.
    const result = await pool.query<{ data: Record<string, unknown> | null }>(
      body === undefined
        ? `WITH resource AS MATERIALIZED (
             SELECT tenant_id FROM public.classroom_teacher_access($1,$2)
           ) SELECT public.classroom_project_policy_read($3,resource.tenant_id,$2,$4) AS data FROM resource`
        : `WITH resource AS MATERIALIZED (
             SELECT tenant_id FROM public.classroom_teacher_access($1,$2)
           ) SELECT public.classroom_project_policy_write($3,resource.tenant_id,$2,$4,$5::jsonb,$6) AS data FROM resource`,
      body === undefined
        ? [actor.accountId, id, actor.principalId, seat]
        : [actor.accountId, id, actor.principalId, seat, JSON.stringify(body), request.id],
    );
    const data = result.rows[0]?.data;
    if (!data || data['error'] === 'forbidden') reject(403, 'forbidden');
    if (data['error'] === 'version_conflict') reject(409, 'version_conflict');
    if (data['error']) reject(400, 'invalid_policy');
    return data;
  }
  @Get('policy') @Header('Cache-Control', 'private, no-store') read(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
  ) {
    return this.policy(req, id, null);
  }
  @Get('seats/:seatId') @Header('Cache-Control', 'private, no-store') readSeat(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('seatId') seat: string,
  ) {
    return this.policy(req, id, seat);
  }
  @Put('policy') @Header('Cache-Control', 'private, no-store') write(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
    @Body() body: unknown,
  ) {
    return this.policy(req, id, null, body);
  }
  @Put('seats/:seatId') @Header('Cache-Control', 'private, no-store') writeSeat(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('seatId') seat: string,
    @Body() body: unknown,
  ) {
    return this.policy(req, id, seat, body);
  }

  @Get('publication-requests')
  @Header('Cache-Control', 'private, no-store')
  async publicationRequests(
    @Req() request: FastifyRequest,
    @Param('classroomId') id: string,
    @Query('offset') offset?: string,
  ) {
    const { pool, review } = await this.reviewer(request, id);
    if (
      offset !== undefined &&
      (typeof offset !== 'string' || !/^\d{1,5}$/.test(offset) || Number(offset) > 10000)
    )
      reject(400, 'invalid_offset');
    return readStudentPublicationReviewQueue(pool, review, 50, Number(offset ?? 0));
  }

  @Get('publication-requests/:requestId/artifact')
  @Header('Cache-Control', 'private, no-store')
  async publicationArtifact(
    @Req() request: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('requestId') requestId: string,
  ) {
    const { pool, review } = await this.reviewer(request, id);
    return readStudentPublicationReviewArtifact(pool, review, requestId);
  }

  @Get('publication-requests/:requestId/cover')
  async publicationCover(
    @Req() request: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('requestId') requestId: string,
    @Res() reply: FastifyReply,
  ) {
    const { pool, review } = await this.reviewer(request, id);
    const raster = await readStudentPublicationReviewRaster(pool, review, requestId);
    return sendStudentPublicationReviewRaster(reply, raster);
  }

  @Get('publication-requests/:requestId/scratch-player')
  @Header('Cache-Control', 'private, no-store')
  async publicationScratchPlayer(
    @Req() request: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('requestId') requestId: string,
  ) {
    const { review } = await this.reviewer(request, id);
    return this.scratchReview.issueStudentReview(review, requestId);
  }

  @Post('publication-requests/:requestId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async publicationDecision(
    @Req() request: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('requestId') requestId: string,
    @Body() raw: unknown,
  ) {
    const { pool, review } = await this.reviewer(request, id);
    return decideStudentPublicationReview(pool, review, requestId, raw);
  }
}
