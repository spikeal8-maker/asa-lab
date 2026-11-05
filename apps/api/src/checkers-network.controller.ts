import {
  Body,
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
  Res,
  UseFilters,
} from '@nestjs/common';
import { hashSessionToken, type ActiveContextUseCase } from '@asa-lab/identity';
import {
  ChessNetworkError,
  CheckersNetworkService,
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

import { ChessNetworkErrorFilter } from './chess-network.controller.js';

@Controller('api/games/checkers')
@UseFilters(ChessNetworkErrorFilter)
export class CheckersNetworkController {
  private readonly service: CheckersNetworkService | null;
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
    @Inject(TOKENS.pool) pool: pg.Pool | null,
  ) {
    this.service = pool ? new CheckersNetworkService(pool) : null;
  }

  private async source(request: FastifyRequest): Promise<ChessNetworkSource> {
    if (!this.service) reject(503, 'UNAVAILABLE', 'Сервер сетевых шашек недоступен.');
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
  @Get('notifications')
  @Header('Cache-Control', 'private, no-store')
  async notifications(@Req() request: FastifyRequest) {
    // This authenticated read refreshes only ephemeral last-seen metadata. A custom
    // header prevents cross-origin tags/navigation from publishing presence.
    const site = request.headers['sec-fetch-site'];
    if (
      request.headers['x-game-presence'] !== '1' ||
      (site && site !== 'same-origin' && site !== 'none')
    )
      reject(403, 'FORBIDDEN', 'Откройте уведомления на странице ASA Lab.');
    body(request.query ?? {}, []);
    const source = await this.source(request);
    return this.run(() => this.service!.notifications(source));
  }
  @Post('lobby')
  @Header('Cache-Control', 'private, no-store')
  async lobby(@Req() request: FastifyRequest, @Body() raw: unknown) {
    const source = await this.source(request);
    const input = body(raw, ['scope']);
    if (typeof input['scope'] !== 'string' || !scopes.includes(input['scope']))
      reject(400, 'INVALID_COMMAND', 'Некорректный круг соперников.');
    return this.run(() => this.service!.lobby(source, input['scope'] as ChessNetworkScope));
  }
  @Get('players/:playerId/avatar')
  async avatar(
    @Req() request: FastifyRequest,
    @Param('playerId') id: string,
    @Query('scope') scope: string,
    @Res() reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
    const source = await this.source(request);
    if (!scopes.includes(scope)) reject(400, 'INVALID_COMMAND', 'Некорректный круг соперников.');
    const value = await this.run(() =>
      this.service!.avatar(source, id, scope as ChessNetworkScope),
    );
    const image = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value.dataUrl ?? '',
    );
    if (image && value.dataUrl!.length <= 300000) {
      const bytes = Buffer.from(image[2]!, 'base64');
      const raster =
        image[1] === 'png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : image[1] === 'jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : bytes.subarray(0, 4).toString() === 'RIFF' &&
              bytes.subarray(8, 12).toString() === 'WEBP';
      if (raster) return reply.type(`image/${image[1]}`).send(bytes);
    }
    return reply.header('Location', value.defaultPath).status(302).send();
  }
  @Post('players/:playerId/challenge')
  async challenge(
    @Req() request: FastifyRequest,
    @Param('playerId') target: string,
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
      reject(400, 'INVALID_COMMAND', 'Некорректный вызов.');
    return this.run(() =>
      this.service!.challenge(source, key(command), target, input as unknown as NetworkInviteInput),
    );
  }
  @Post('challenges/:inviteId/decline')
  async decline(
    @Req() request: FastifyRequest,
    @Param('inviteId') id: string,
    @Headers('idempotency-key') command: unknown,
    @Body() raw: unknown,
  ) {
    const source = await this.source(request);
    const input = body(raw, ['expectedVersion']);
    return this.run(() =>
      this.service!.decline(source, key(command), id, version(input['expectedVersion'])),
    );
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
    const input = body(raw, ['expectedVersion', 'action', 'path']);
    if (
      typeof input['action'] !== 'string' ||
      !actions.includes(input['action']) ||
      (input['action'] === 'move' ? !Array.isArray(input['path']) : input['path'] !== undefined)
    )
      reject(400, 'INVALID_COMMAND', 'Некорректная команда.');
    return this.run(() =>
      this.service!.action(
        source,
        key(command),
        id,
        version(input['expectedVersion']),
        input['action'] as ChessNetworkAction,
        input['path'] as string[] | undefined,
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
