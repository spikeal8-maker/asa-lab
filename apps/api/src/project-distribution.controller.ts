import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';
import { noteAuthoritativeMutationSession } from './mutation-session-proof.js';
import { checkBodyShape } from './validation.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reject(status: number, code: string): never {
  throw new HttpException({ error: { code, message: code } }, status);
}
@Controller('api/project-distribution/classrooms/:classroomId')
export class ProjectDistributionController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly account: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}
  private async policy(
    request: FastifyRequest,
    id: string,
    seat: string | null,
    body?: unknown,
  ): Promise<unknown> {
    if (!UUID.test(id) || (seat !== null && !UUID.test(seat))) reject(400, 'invalid_id');
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE))
      reject(403, 'teacher_context_required');
    const actor = await this.account.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) reject(401, 'unauthorized');
    noteAuthoritativeMutationSession(request, 'account', request.cookies[SESSION_COOKIE]);
    if (!this.pool) reject(503, 'database_unavailable');
    const shape =
      body === undefined
        ? null
        : checkBodyShape(
            body,
            seat
              ? ['publishOverride', 'downloadOverride', 'expectedVersion']
              : ['publish', 'download', 'expectedVersion'],
          );
    if (shape && !shape.ok) reject(400, 'invalid_policy');
    // An invited co-teacher may keep a different personal workspace active.
    // Derive the resource tenant through the existing exact-class ACL; the
    // audited policy writer rechecks that ACL after acquiring its class lock.
    const result = await this.pool.query<{ data: Record<string, unknown> | null }>(
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
}
