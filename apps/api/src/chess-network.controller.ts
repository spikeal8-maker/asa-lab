import {
  Body,
  Catch,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { hashSessionToken, type ActiveContextUseCase } from '@asa-lab/identity';
import {
  ChessNetworkError,
  ChessNetworkService,
  type ChessNetworkSource,
  type NetworkInviteInput,
} from '@asa-lab/games';
import type { ChessNetworkAction, ChessNetworkScope } from '@asa-lab/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape, checkIdempotencyKey } from './validation.js';
import { noteAuthoritativeMutationSession } from './mutation-session-proof.js';

function reject(status: number, code: string, message: string): never {
  throw new HttpException({ error: { code, message } }, status);
}
function body(value: unknown, keys: string[]): Record<string, unknown> {
  const checked = checkBodyShape(value, keys);
  if (!checked.ok) reject(400, 'INVALID_COMMAND', 'Некорректный запрос.');
  return checked.body;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    reject(400, 'INVALID_COMMAND', 'Некорректная версия.');
  return value;
}
function key(value: unknown): string {
  const checked = checkIdempotencyKey(value);
  if (!checked.ok) reject(400, 'INVALID_COMMAND', 'Отсутствует идентификатор команды.');
  return checked.key;
}
const scopes: readonly string[] = ['classroom', 'school', 'platform'];
const actions: readonly string[] = ['move', 'resign', 'draw-offer', 'draw-accept', 'draw-decline'];

/** Public Games projection only; the legacy Chess Live protocol stays unchanged. */
@Catch(HttpException)
export class ChessNetworkErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const raw = exception.getResponse() as { error?: { code?: string; message?: string } };
    const internal = raw.error?.code;
    const aliases: Record<string, [string, number]> = {
      INVALID_COMMAND: ['VALIDATION_FAILED', 400],
      ILLEGAL_MOVE: ['GAME_COMMAND_REJECTED', 422],
      NOT_YOUR_TURN: ['GAME_COMMAND_REJECTED', 422],
      INVALID_STATE: ['STATE_CONFLICT', 409],
      session_conflict: ['STATE_CONFLICT', 409],
      POLICY_DENIED: ['FORBIDDEN', 403],
      INVITE_EXPIRED: ['INVITE_EXPIRED', 410],
    };
    const publicCodes = new Set([
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'IDEMPOTENCY_CONFLICT',
      'VERSION_CONFLICT',
      'STATE_CONFLICT',
      'MATCH_FINISHED',
      'INVITE_EXPIRED',
      'GAME_COMMAND_REJECTED',
      'ADMISSION_DISABLED',
      'RATE_LIMITED',
      'UNAVAILABLE',
    ]);
    const httpStatus = exception.getStatus();
    const fallback =
      httpStatus === 401
        ? 'UNAUTHORIZED'
        : httpStatus === 403
          ? 'FORBIDDEN'
          : httpStatus === 404
            ? 'NOT_FOUND'
            : httpStatus === 429
              ? 'RATE_LIMITED'
              : httpStatus >= 500
                ? 'UNAVAILABLE'
                : httpStatus === 409
                  ? 'STATE_CONFLICT'
                  : 'VALIDATION_FAILED';
    const [code, status] = aliases[internal ?? ''] ?? [
      internal && publicCodes.has(internal) ? internal : fallback,
      httpStatus,
    ];
    // All Games rate windows are one minute; this is a conservative known bound.
    if (code === 'RATE_LIMITED') reply.header('Retry-After', '60');
    reply.status(status).send({
      error: { code, message: raw.error?.message ?? 'Запрос отклонён.', requestId: request.id },
    });
  }
}

@Controller('api/games/chess')
@UseFilters(ChessNetworkErrorFilter)
export class ChessNetworkController {
  private readonly service: ChessNetworkService | null;
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) pool: pg.Pool | null,
  ) {
    this.service = pool ? new ChessNetworkService(pool) : null;
  }

  private async source(request: FastifyRequest): Promise<ChessNetworkSource> {
    if (!this.service) reject(503, 'UNAVAILABLE', 'Сервер сетевых шахмат недоступен.');
    const hasSeat = Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE);
    if (hasSeat && request.cookies[SESSION_COOKIE])
      reject(409, 'session_conflict', 'Обнаружены два входа. Войдите заново.');
    if (hasSeat) {
      const token = request.cookies[STUDENT_SESSION_COOKIE];
      if (!token || !(await this.seats.resolve(token)))
        reject(401, 'UNAUTHORIZED', 'Войдите в класс заново.');
      noteAuthoritativeMutationSession(request, 'seat-legacy', token);
      return { kind: 'student_seat', sessionHash: hashSessionToken(token) };
    }
    const token = request.cookies[SESSION_COOKIE];
    if (!token || !(await this.accounts.resolve(token)))
      reject(401, 'UNAUTHORIZED', 'Войдите в ASA.');
    noteAuthoritativeMutationSession(request, 'account', token);
    return { kind: 'account', sessionHash: hashSessionToken(token) };
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ChessNetworkError) reject(error.status, error.code, error.message);
      throw error;
    }
  }
  @Get('access')
  @Header('Cache-Control', 'private, no-store')
  async access(@Req() request: FastifyRequest) {
    const source = await this.source(request);
    return this.run(() => this.service!.access(source));
  }
  @Get('policy/:classroomId')
  @Header('Cache-Control', 'private, no-store')
  async policy(@Req() request: FastifyRequest, @Param('classroomId') id: string) {
    const source = await this.source(request);
    return this.run(() => this.service!.policy(source, id));
  }
  @Put('policy/:classroomId')
  async writePolicy(
    @Req() request: FastifyRequest,
    @Param('classroomId') id: string,
    @Body() raw: unknown,
    @Headers('idempotency-key') command: unknown,
  ) {
    const source = await this.source(request);
    const input = body(raw, ['enabled', 'scope', 'expectedVersion']);
    if (
      typeof input['enabled'] !== 'boolean' ||
      typeof input['scope'] !== 'string' ||
      !scopes.includes(input['scope']) ||
      typeof input['expectedVersion'] !== 'number' ||
      !Number.isSafeInteger(input['expectedVersion']) ||
      input['expectedVersion'] < 0
    )
      reject(400, 'INVALID_COMMAND', 'Некорректные настройки сети.');
    return this.run(() =>
      this.service!.policy(
        source,
        id,
        {
          enabled: input['enabled'] as boolean,
          scope: input['scope'] as ChessNetworkScope,
          expectedVersion: input['expectedVersion'] as number,
        },
        key(command),
      ),
    );
  }
  @Post('invites')
  async create(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') command: unknown,
    @Body() raw: unknown,
  ) {
    const source = await this.source(request);
    const input = body(raw, ['scope', 'initialMs', 'incrementMs', 'colorPreference']);
    if (
      typeof input['scope'] !== 'string' ||
      !scopes.includes(input['scope']) ||
      typeof input['colorPreference'] !== 'string' ||
      !['white', 'black', 'random'].includes(input['colorPreference']) ||
      typeof input['initialMs'] !== 'number' ||
      typeof input['incrementMs'] !== 'number'
    )
      reject(400, 'INVALID_COMMAND', 'Некорректное приглашение.');
    return this.run(() =>
      this.service!.create(source, key(command), input as unknown as NetworkInviteInput),
    );
  }
  @Get('invites/:code')
  @Header('Cache-Control', 'private, no-store')
  async invite(@Req() request: FastifyRequest, @Param('code') code: string) {
    const source = await this.source(request);
    return this.run(() => this.service!.getInvite(source, code));
  }
  @Post('invites/:code/accept')
  async accept(
    @Req() request: FastifyRequest,
    @Param('code') code: string,
    @Headers('idempotency-key') command: unknown,
    @Body() raw: unknown,
  ) {
    const source = await this.source(request);
    body(raw, []);
    return this.run(() => this.service!.accept(source, key(command), code));
  }
  @Post('invites/:id/cancel')
  async cancel(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') command: unknown,
    @Body() raw: unknown,
  ) {
    const source = await this.source(request);
    const input = body(raw, ['expectedVersion']);
    return this.run(() =>
      this.service!.cancel(source, key(command), id, version(input['expectedVersion'])),
    );
  }
  @Get('matches/:id')
  @Header('Cache-Control', 'private, no-store')
  async match(@Req() request: FastifyRequest, @Param('id') id: string) {
    const source = await this.source(request);
    return this.run(() => this.service!.getMatch(source, id));
  }
  @Post('matches/:id/commands')
  async action(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') command: unknown,
    @Body() raw: unknown,
  ) {
    const source = await this.source(request);
    const input = body(raw, ['expectedVersion', 'action', 'uci']);
    if (
      typeof input['action'] !== 'string' ||
      !actions.includes(input['action']) ||
      (input['action'] === 'move' ? typeof input['uci'] !== 'string' : input['uci'] !== undefined)
    )
      reject(400, 'INVALID_COMMAND', 'Некорректная команда.');
    return this.run(() =>
      this.service!.action(
        source,
        key(command),
        id,
        version(input['expectedVersion']),
        input['action'] as ChessNetworkAction,
        input['uci'] as string | undefined,
      ),
    );
  }
  @Get('history')
  @Header('Cache-Control', 'private, no-store')
  async history(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>) {
    const source = await this.source(request);
    if (
      Object.keys(query).some((name) => !['cursor', 'limit'].includes(name)) ||
      (query['cursor'] !== undefined && typeof query['cursor'] !== 'string') ||
      (query['limit'] !== undefined &&
        (typeof query['limit'] !== 'string' || !/^\d{1,3}$/.test(query['limit'])))
    )
      reject(400, 'INVALID_COMMAND', 'Некорректная страница.');
    return this.run(() =>
      this.service!.history(
        source,
        query['cursor'] as string | undefined,
        query['limit'] === undefined ? 25 : Number(query['limit']),
      ),
    );
  }
}
