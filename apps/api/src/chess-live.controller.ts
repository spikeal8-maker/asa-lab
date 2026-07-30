import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import {
  type ChessLiveService,
  type ChessRatingPool,
  type ColorPreference,
  type LiveChessErrorCode,
  type LiveChessResult,
} from '@asa-lab/chess-live';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape, checkIdempotencyKey } from './validation.js';

const STATUS_BY_CODE: Readonly<Record<LiveChessErrorCode, number>> = {
  validation_error: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  expired: 410,
  illegal_move: 422,
  game_finished: 409,
  not_your_turn: 409,
  clock_expired: 409,
  idempotency_conflict: 409,
};

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function reject<T>(result: Extract<LiveChessResult<T>, { ok: false }>): never {
  throw new HttpException(error(result.code, result.message), STATUS_BY_CODE[result.code]);
}

function requireString(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new HttpException(error('validation_error', `${key} must be a string`), 400);
  }
  return value;
}

function requireBoolean(body: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = body[key];
  if (typeof value !== 'boolean') {
    throw new HttpException(error('validation_error', `${key} must be a boolean`), 400);
  }
  return value;
}

function requireInteger(body: Readonly<Record<string, unknown>>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value)) {
    throw new HttpException(error('validation_error', `${key} must be an integer`), 400);
  }
  return Number(value);
}

function colorPreference(value: string): ColorPreference {
  if (value === 'white' || value === 'black' || value === 'random') return value;
  throw new HttpException(
    error('validation_error', 'colorPreference must be white, black or random'),
    400,
  );
}

function ratingPool(value: string): ChessRatingPool {
  if (
    value === 'bullet' ||
    value === 'blitz' ||
    value === 'rapid' ||
    value === 'classical' ||
    value === 'daily'
  ) {
    return value;
  }
  throw new HttpException(error('validation_error', 'unsupported rating pool'), 400);
}

@Controller('api/chess/live')
export class ChessLiveController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.chessLiveService) private readonly service: ChessLiveService,
  ) {}

  private async principal(request: FastifyRequest): Promise<{ tenantId: string; userId: string }> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    if (context.userId !== null) {
      return { tenantId: context.tenantId, userId: context.userId };
    }
    const legacyActor = await this.accounts.legacyActor(context.accountId);
    if (legacyActor === null) {
      throw new HttpException(
        error('educator_required', 'online chess requires an organization identity'),
        403,
      );
    }
    return legacyActor;
  }

  private idempotency(value: string | undefined): string {
    const checked = checkIdempotencyKey(value);
    if (!checked.ok) {
      throw new HttpException(error('invalid_idempotency_key', checked.message), 400);
    }
    return checked.key;
  }

  @Post('challenges')
  async createChallenge(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody, [
      'colorPreference',
      'initialMs',
      'incrementMs',
      'rated',
      'expiresInMs',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.service.createChallenge(
      { tenantId: principal.tenantId, userId: principal.userId },
      {
        commandId: this.idempotency(idempotencyHeader),
        colorPreference: colorPreference(requireString(shape.body, 'colorPreference')),
        timeControl: {
          initialMs: requireInteger(shape.body, 'initialMs'),
          incrementMs: requireInteger(shape.body, 'incrementMs'),
        },
        rated: requireBoolean(shape.body, 'rated'),
        expiresInMs: requireInteger(shape.body, 'expiresInMs'),
      },
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  @Get('challenges/:publicCode')
  async getChallenge(
    @Req() request: FastifyRequest,
    @Param('publicCode') publicCode: string,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const result = await this.service.getChallenge(
      { tenantId: principal.tenantId, userId: principal.userId },
      publicCode,
    );
    if (!result.ok) reject(result);
    return { challenge: result.value };
  }

  @Post('challenges/:publicCode/accept')
  async acceptChallenge(
    @Req() request: FastifyRequest,
    @Param('publicCode') publicCode: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody ?? {}, []);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.service.acceptChallenge(
      { tenantId: principal.tenantId, userId: principal.userId },
      publicCode,
      this.idempotency(idempotencyHeader),
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  @Post('challenges/:challengeId/cancel')
  async cancelChallenge(
    @Req() request: FastifyRequest,
    @Param('challengeId') challengeId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody ?? {}, []);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.service.cancelChallenge(
      { tenantId: principal.tenantId, userId: principal.userId },
      challengeId,
      this.idempotency(idempotencyHeader),
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  @Get('games/:gameId')
  async getGame(@Req() request: FastifyRequest, @Param('gameId') gameId: string): Promise<unknown> {
    const principal = await this.principal(request);
    const result = await this.service.getGame(
      { tenantId: principal.tenantId, userId: principal.userId },
      gameId,
    );
    if (!result.ok) reject(result);
    return { game: result.value };
  }

  @Get('games/:gameId/reconnect')
  async reconnect(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Query('after') after: string | undefined,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const afterSequence = after === undefined ? 0 : Number(after);
    const result = await this.service.reconnect(
      { tenantId: principal.tenantId, userId: principal.userId },
      gameId,
      afterSequence,
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  @Get('games/:gameId/events')
  async events(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Query('after') after: string | undefined,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const afterSequence = after === undefined ? 0 : Number(after);
    const result = await this.service.spectatorEvents(
      { tenantId: principal.tenantId, userId: principal.userId },
      gameId,
      afterSequence,
    );
    if (!result.ok) reject(result);
    return { items: result.value };
  }

  @Post('games/:gameId/moves')
  async submitMove(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody, ['expectedVersion', 'uci']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.service.submitMove(
      { tenantId: principal.tenantId, userId: principal.userId },
      {
        gameId,
        commandId: this.idempotency(idempotencyHeader),
        expectedVersion: requireInteger(shape.body, 'expectedVersion'),
        uci: requireString(shape.body, 'uci'),
      },
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  private async gameControl(
    request: FastifyRequest,
    gameId: string,
    idempotencyHeader: string | undefined,
    rawBody: unknown,
    action: 'offer' | 'accept' | 'decline' | 'resign' | 'timeout',
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody, ['expectedVersion']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const command = {
      gameId,
      commandId: this.idempotency(idempotencyHeader),
      expectedVersion: requireInteger(shape.body, 'expectedVersion'),
    };
    const livePrincipal = { tenantId: principal.tenantId, userId: principal.userId };
    const result =
      action === 'offer'
        ? await this.service.offerDraw(livePrincipal, command)
        : action === 'accept'
          ? await this.service.acceptDraw(livePrincipal, command)
          : action === 'decline'
            ? await this.service.declineDraw(livePrincipal, command)
            : action === 'resign'
              ? await this.service.resign(livePrincipal, command)
              : await this.service.claimTimeout(livePrincipal, command);
    if (!result.ok) reject(result);
    return result.value;
  }

  @Post('games/:gameId/draw-offer')
  offerDraw(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    return this.gameControl(request, gameId, idempotencyHeader, rawBody, 'offer');
  }

  @Post('games/:gameId/draw-accept')
  acceptDraw(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    return this.gameControl(request, gameId, idempotencyHeader, rawBody, 'accept');
  }

  @Post('games/:gameId/draw-decline')
  declineDraw(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    return this.gameControl(request, gameId, idempotencyHeader, rawBody, 'decline');
  }

  @Post('games/:gameId/resign')
  resign(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    return this.gameControl(request, gameId, idempotencyHeader, rawBody, 'resign');
  }

  @Post('games/:gameId/claim-timeout')
  claimTimeout(
    @Req() request: FastifyRequest,
    @Param('gameId') gameId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    return this.gameControl(request, gameId, idempotencyHeader, rawBody, 'timeout');
  }

  @Post('matchmaking')
  async joinMatchmaking(
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody, [
      'initialMs',
      'incrementMs',
      'rated',
      'colorPreference',
      'expiresInMs',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.service.joinMatchmaking(
      { tenantId: principal.tenantId, userId: principal.userId },
      {
        commandId: this.idempotency(idempotencyHeader),
        timeControl: {
          initialMs: requireInteger(shape.body, 'initialMs'),
          incrementMs: requireInteger(shape.body, 'incrementMs'),
        },
        rated: requireBoolean(shape.body, 'rated'),
        colorPreference: colorPreference(requireString(shape.body, 'colorPreference')),
        expiresInMs: requireInteger(shape.body, 'expiresInMs'),
      },
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  @Post('matchmaking/:ticketId/cancel')
  async cancelMatchmaking(
    @Req() request: FastifyRequest,
    @Param('ticketId') ticketId: string,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<unknown> {
    const principal = await this.principal(request);
    const shape = checkBodyShape(rawBody, ['expectedVersion']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.service.cancelMatchmaking(
      { tenantId: principal.tenantId, userId: principal.userId },
      {
        commandId: this.idempotency(idempotencyHeader),
        ticketId,
        expectedVersion: requireInteger(shape.body, 'expectedVersion'),
      },
    );
    if (!result.ok) reject(result);
    return result.value;
  }

  @Get('ratings/:pool')
  async getRating(@Req() request: FastifyRequest, @Param('pool') pool: string): Promise<unknown> {
    const principal = await this.principal(request);
    const result = await this.service.getRating(
      { tenantId: principal.tenantId, userId: principal.userId },
      ratingPool(pool),
    );
    if (!result.ok) reject(result);
    return result.value;
  }
}
