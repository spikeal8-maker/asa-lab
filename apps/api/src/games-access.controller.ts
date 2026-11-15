import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { hashSessionToken } from '@asa-lab/identity';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  currentSeatGamesAccess,
  evaluateGamesAccess,
  isOfflineGame,
  type GamesAdmission,
  type GamesPolicySnapshot,
} from './games-access.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function reject(status: number, code: string): never {
  throw new HttpException({ error: { code, message: code } }, status);
}

/** Current admission and exact-class teacher policy. Project operations also
 * re-evaluate admission in their own transaction; this is never a capability.
 */
@Controller('api/games')
export class GamesAccessController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly account: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  @Get('access')
  async access(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GamesAdmission> {
    reply.header('cache-control', 'private, no-store');
    if (Object.keys(query).some((key) => key !== 'game') || !isOfflineGame(query['game'])) {
      reject(400, 'invalid_game');
    }
    // Presence is deliberate: an invalid/empty/revoked Seat cookie must never
    // silently turn into a personal Account entitlement when both cookies exist.
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE)) {
      const token = request.cookies[STUDENT_SESSION_COOKIE];
      const seat = await this.seats.resolve(token);
      if (!seat || !token) reject(401, 'unauthorized');
      return currentSeatGamesAccess(this.pool, seat, hashSessionToken(token), query['game']);
    }
    const actor = await this.account.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) reject(401, 'unauthorized');
    // Account-only offline play retains its own ACL and module availability.
    // No class/Seat can be selected through a query parameter or request body.
    return { granted: true, reason: 'allowed', threshold: null };
  }

  private async teacher(
    request: FastifyRequest,
  ): Promise<{ principalId: string; tenantId: string }> {
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE)) {
      reject(403, 'teacher_context_required');
    }
    const actor = await this.account.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) reject(401, 'unauthorized');
    if (!this.pool) reject(503, 'database_unavailable');
    // Roles are not inferred here. SQL verifies active Account, educator grant,
    // exact class membership, tenant and active class on every read/write.
    return { principalId: actor.principalId, tenantId: actor.tenantId };
  }

  private async policy(
    request: FastifyRequest,
    classroomId: string,
    seatId: string | null,
    action: 'read' | 'class' | 'seat' | 'revoke',
    input: unknown,
  ): Promise<unknown> {
    if (!UUID.test(classroomId) || (seatId !== null && !UUID.test(seatId)))
      reject(400, 'invalid_id');
    const actor = await this.teacher(request);
    const client = await this.pool!.connect();
    try {
      await client.query(
        action === 'read' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
      );
      const result = await client.query<{ data: Record<string, unknown> | null }>(
        action === 'read'
          ? 'SELECT public.classroom_games_policy_read($1,$2,$3,$4) AS data'
          : 'SELECT public.classroom_games_policy_write($1,$2,$3,$4,$5,$6::jsonb) AS data',
        action === 'read'
          ? [actor.principalId, actor.tenantId, classroomId, seatId]
          : [actor.principalId, actor.tenantId, classroomId, seatId, action, JSON.stringify(input)],
      );
      const data = result.rows[0]?.data;
      if (!data || data['error'] === 'forbidden') reject(403, 'forbidden');
      if (data['error'] === 'version_conflict') reject(409, 'version_conflict');
      if (data['error']) reject(400, 'invalid_policy');
      if (seatId !== null) {
        const snapshot = await client.query<{ data: GamesPolicySnapshot | null }>(
          'SELECT public.classroom_games_teacher_seat_snapshot($1,$2,$3,$4) AS data',
          [actor.principalId, actor.tenantId, classroomId, seatId],
        );
        await client.query('COMMIT');
        return { ...data, admission: evaluateGamesAccess('chess', snapshot.rows[0]?.data ?? null) };
      }
      await client.query('COMMIT');
      return data;
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally {
      client.release();
    }
  }

  @Get('classrooms/:classroomId/policy')
  @Header('Cache-Control', 'private, no-store')
  readClass(@Req() req: FastifyRequest, @Param('classroomId') id: string) {
    return this.policy(req, id, null, 'read', null);
  }

  @Get('classrooms/:classroomId/seats/:seatId')
  @Header('Cache-Control', 'private, no-store')
  readSeat(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('seatId') seat: string,
  ) {
    return this.policy(req, id, seat, 'read', null);
  }

  @Put('classrooms/:classroomId/policy')
  putClass(@Req() req: FastifyRequest, @Param('classroomId') id: string, @Body() body: unknown) {
    const shape = checkBodyShape(body, ['mode', 'threshold', 'expectedVersion']);
    if (!shape.ok) reject(400, 'invalid_policy');
    return this.policy(req, id, null, 'class', shape.body);
  }

  /** Soft revoke. PUT explicitly reactivates; history and overrides survive. */
  @Delete('classrooms/:classroomId/policy')
  revokeClass(@Req() req: FastifyRequest, @Param('classroomId') id: string, @Body() body: unknown) {
    const shape = checkBodyShape(body, ['expectedVersion']);
    if (!shape.ok) reject(400, 'invalid_policy');
    return this.policy(req, id, null, 'revoke', shape.body);
  }

  @Put('classrooms/:classroomId/seats/:seatId')
  putSeat(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('seatId') seat: string,
    @Body() body: unknown,
  ) {
    const shape = checkBodyShape(body, ['override', 'expectedVersion']);
    if (!shape.ok) reject(400, 'invalid_policy');
    return this.policy(req, id, seat, 'seat', shape.body);
  }

  @Delete('classrooms/:classroomId/seats/:seatId')
  resetSeat(
    @Req() req: FastifyRequest,
    @Param('classroomId') id: string,
    @Param('seatId') seat: string,
    @Body() body: unknown,
  ) {
    const shape = checkBodyShape(body, ['expectedVersion']);
    if (!shape.ok) reject(400, 'invalid_policy');
    return this.policy(req, id, seat, 'seat', { ...shape.body, override: 'inherit' });
  }
}
