import {
  START_FEN,
  applyLegalMove,
  getChessStatus,
  parseFen,
  positionKey,
  toFen,
  type ChessStatus,
  type Color,
} from '@asa-lab/chess';
import {
  opponentId,
  participantColor,
  type LiveChessCommandKind,
  type LiveChessEventType,
  type LiveChessGame,
  type LiveChessParticipantView,
  type LiveChessResult,
  type LiveTimeControl,
  type ProcessedLiveCommand,
} from './model.js';
import { isSafeLiveId, validateLiveTimeControl } from './challenge.js';

export interface CreateLiveGameInput {
  readonly id: string;
  readonly tenantId: string;
  readonly challengeId: string | null;
  readonly whitePlayerId: string;
  readonly blackPlayerId: string;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly nowMs: number;
}

export interface LiveEventDraft {
  readonly type: LiveChessEventType;
  readonly actorId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ApplyLiveCommandResult {
  readonly game: LiveChessGame;
  readonly events: readonly LiveEventDraft[];
}

export interface LiveCommandContext {
  readonly actorId: string;
  readonly commandId: string;
  readonly nowMs: number;
  readonly kind: LiveChessCommandKind;
}

const MAX_PROCESSED_COMMANDS = 512;

function safeNow(game: LiveChessGame, nowMs: number): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('server nowMs must be a non-negative safe integer');
  }
  return Math.max(nowMs, game.clock.lastServerNowMs);
}

function terminationFromStatus(status: ChessStatus): LiveChessGame['termination'] {
  if (status.state === 'checkmate') return 'checkmate';
  if (status.state === 'stalemate') return 'stalemate';
  if (status.state === 'draw_fifty_move') return 'fifty_move';
  if (status.state === 'draw_threefold') return 'threefold';
  if (status.state === 'draw_insufficient_material') return 'insufficient_material';
  return 'ongoing';
}

function finishGame(
  game: LiveChessGame,
  result: LiveChessGame['result'],
  termination: LiveChessGame['termination'],
  winnerId: string | null,
  nowMs: number,
): LiveChessGame {
  return {
    ...game,
    status: 'finished',
    result,
    termination,
    winnerId,
    drawOffer: null,
    finishedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function projectedRemaining(game: LiveChessGame, nowMs: number): {
  readonly whiteRemainingMs: number;
  readonly blackRemainingMs: number;
  readonly elapsedMs: number;
} {
  const effectiveNow = safeNow(game, nowMs);
  if (game.status === 'finished') {
    return {
      whiteRemainingMs: game.clock.whiteRemainingMs,
      blackRemainingMs: game.clock.blackRemainingMs,
      elapsedMs: 0,
    };
  }
  const elapsedMs = Math.max(0, effectiveNow - game.clock.turnStartedAtMs);
  return {
    whiteRemainingMs:
      game.clock.activeColor === 'white'
        ? Math.max(0, game.clock.whiteRemainingMs - elapsedMs)
        : game.clock.whiteRemainingMs,
    blackRemainingMs:
      game.clock.activeColor === 'black'
        ? Math.max(0, game.clock.blackRemainingMs - elapsedMs)
        : game.clock.blackRemainingMs,
    elapsedMs,
  };
}

function settleClock(game: LiveChessGame, nowMs: number): LiveChessGame {
  const effectiveNow = safeNow(game, nowMs);
  const projected = projectedRemaining(game, effectiveNow);
  return {
    ...game,
    clock: {
      ...game.clock,
      whiteRemainingMs: projected.whiteRemainingMs,
      blackRemainingMs: projected.blackRemainingMs,
      turnStartedAtMs: effectiveNow,
      lastServerNowMs: effectiveNow,
    },
    updatedAtMs: effectiveNow,
  };
}

function expiredColor(game: LiveChessGame): Color | null {
  if (game.clock.activeColor === 'white' && game.clock.whiteRemainingMs === 0) return 'white';
  if (game.clock.activeColor === 'black' && game.clock.blackRemainingMs === 0) return 'black';
  return null;
}

function winnerIdForColor(game: LiveChessGame, color: Color): string {
  return color === 'white' ? game.whitePlayerId : game.blackPlayerId;
}

function timeoutResult(game: LiveChessGame, loser: Color, nowMs: number): LiveChessGame {
  const winner = loser === 'white' ? 'black' : 'white';
  return finishGame(
    game,
    winner === 'white' ? '1-0' : '0-1',
    'timeout',
    winnerIdForColor(game, winner),
    nowMs,
  );
}

function commandRecord(
  context: LiveCommandContext,
  version: number,
  sequence: number,
): ProcessedLiveCommand {
  return {
    commandId: context.commandId,
    kind: context.kind,
    actorId: context.actorId,
    appliedVersion: version,
    appliedSequence: sequence,
  };
}

function completeCommand(
  game: LiveChessGame,
  context: LiveCommandContext,
  events: readonly LiveEventDraft[],
): ApplyLiveCommandResult {
  const version = game.version + 1;
  const sequence = game.sequence + events.length;
  const processedCommands = [
    ...game.processedCommands,
    commandRecord(context, version, sequence),
  ].slice(-MAX_PROCESSED_COMMANDS);
  return {
    game: {
      ...game,
      version,
      sequence,
      processedCommands,
    },
    events,
  };
}

function requireActiveParticipant(
  game: LiveChessGame,
  actorId: string,
): LiveChessResult<Color> {
  const color = participantColor(game, actorId);
  if (!color) return { ok: false, code: 'forbidden', message: 'user is not a game participant' };
  if (game.status !== 'active') {
    return { ok: false, code: 'game_finished', message: 'game is already finished' };
  }
  return { ok: true, value: color };
}

export function createLiveChessGame(input: CreateLiveGameInput): LiveChessResult<LiveChessGame> {
  for (const [field, value] of [
    ['id', input.id],
    ['tenantId', input.tenantId],
    ['whitePlayerId', input.whitePlayerId],
    ['blackPlayerId', input.blackPlayerId],
  ] as const) {
    if (!isSafeLiveId(value)) {
      return { ok: false, code: 'validation_error', message: `${field} must be a safe ID` };
    }
  }
  if (input.challengeId !== null && !isSafeLiveId(input.challengeId)) {
    return { ok: false, code: 'validation_error', message: 'challengeId must be null or a safe ID' };
  }
  if (input.whitePlayerId === input.blackPlayerId) {
    return { ok: false, code: 'validation_error', message: 'a live game requires two players' };
  }
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return { ok: false, code: 'validation_error', message: 'nowMs must be a non-negative integer' };
  }
  const timeControl = validateLiveTimeControl(input.timeControl);
  if (!timeControl.ok) return timeControl;
  const parsed = parseFen(START_FEN);
  if (!parsed.ok) return { ok: false, code: 'validation_error', message: parsed.message };
  return {
    ok: true,
    value: {
      id: input.id,
      tenantId: input.tenantId,
      challengeId: input.challengeId,
      whitePlayerId: input.whitePlayerId,
      blackPlayerId: input.blackPlayerId,
      timeControl: timeControl.value,
      rated: input.rated,
      status: 'active',
      currentFen: START_FEN,
      positionKeys: [positionKey(parsed.value)],
      moves: [],
      clock: {
        whiteRemainingMs: timeControl.value.initialMs,
        blackRemainingMs: timeControl.value.initialMs,
        activeColor: 'white',
        turnStartedAtMs: input.nowMs,
        lastServerNowMs: input.nowMs,
      },
      drawOffer: null,
      result: '*',
      termination: 'ongoing',
      winnerId: null,
      createdAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
      finishedAtMs: null,
      version: 1,
      sequence: 1,
      processedCommands: [],
    },
  };
}

export function findProcessedLiveCommand(
  game: LiveChessGame,
  commandId: string,
): ProcessedLiveCommand | null {
  return game.processedCommands.find((command) => command.commandId === commandId) ?? null;
}

export function submitLiveChessMove(
  originalGame: LiveChessGame,
  context: LiveCommandContext,
  uci: string,
): LiveChessResult<ApplyLiveCommandResult> {
  const participant = requireActiveParticipant(originalGame, context.actorId);
  if (!participant.ok) return participant;
  if (participant.value !== originalGame.clock.activeColor) {
    return { ok: false, code: 'not_your_turn', message: 'it is not this player’s turn' };
  }
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    return { ok: false, code: 'validation_error', message: 'move must use UCI notation' };
  }

  const nowMs = safeNow(originalGame, context.nowMs);
  let game = settleClock(originalGame, nowMs);
  const expired = expiredColor(game);
  if (expired) {
    game = timeoutResult(game, expired, nowMs);
    return {
      ok: true,
      value: completeCommand(game, context, [
        {
          type: 'game_finished',
          actorId: context.actorId,
          payload: {
            result: game.result,
            termination: game.termination,
            winnerId: game.winnerId,
            whiteRemainingMs: game.clock.whiteRemainingMs,
            blackRemainingMs: game.clock.blackRemainingMs,
          },
        },
      ]),
    };
  }

  const parsed = parseFen(game.currentFen);
  if (!parsed.ok) {
    return { ok: false, code: 'conflict', message: `stored game FEN is invalid: ${parsed.message}` };
  }
  const applied = applyLegalMove(parsed.value, uci);
  if (!applied.ok) return { ok: false, code: 'illegal_move', message: applied.message };

  const movingColor = participant.value;
  const whiteRemainingMs =
    movingColor === 'white'
      ? game.clock.whiteRemainingMs + game.timeControl.incrementMs
      : game.clock.whiteRemainingMs;
  const blackRemainingMs =
    movingColor === 'black'
      ? game.clock.blackRemainingMs + game.timeControl.incrementMs
      : game.clock.blackRemainingMs;
  const fenAfter = toFen(applied.value.position);
  const nextColor = applied.value.position.turn;
  game = {
    ...game,
    currentFen: fenAfter,
    positionKeys: [...game.positionKeys, positionKey(applied.value.position)],
    moves: [
      ...game.moves,
      {
        ply: game.moves.length + 1,
        playerId: context.actorId,
        color: movingColor,
        uci,
        san: applied.value.san,
        fenBefore: originalGame.currentFen,
        fenAfter,
        serverReceivedAtMs: nowMs,
        elapsedMs: Math.max(0, nowMs - originalGame.clock.turnStartedAtMs),
        whiteRemainingMs,
        blackRemainingMs,
      },
    ],
    clock: {
      whiteRemainingMs,
      blackRemainingMs,
      activeColor: nextColor,
      turnStartedAtMs: nowMs,
      lastServerNowMs: nowMs,
    },
    drawOffer: null,
    updatedAtMs: nowMs,
  };

  const status = getChessStatus(applied.value.position, game.positionKeys);
  const events: LiveEventDraft[] = [
    {
      type: 'move_played',
      actorId: context.actorId,
      payload: {
        ply: game.moves.length,
        uci,
        san: applied.value.san,
        fenAfter,
        whiteRemainingMs,
        blackRemainingMs,
        activeColor: nextColor,
      },
    },
  ];
  if (status.result !== '*') {
    const winnerId = status.winner ? winnerIdForColor(game, status.winner) : null;
    game = finishGame(
      game,
      status.result,
      terminationFromStatus(status),
      winnerId,
      nowMs,
    );
    events.push({
      type: 'game_finished',
      actorId: null,
      payload: {
        result: game.result,
        termination: game.termination,
        winnerId: game.winnerId,
        finalFen: game.currentFen,
      },
    });
  }
  return { ok: true, value: completeCommand(game, context, events) };
}

export function offerLiveChessDraw(
  game: LiveChessGame,
  context: LiveCommandContext,
): LiveChessResult<ApplyLiveCommandResult> {
  const participant = requireActiveParticipant(game, context.actorId);
  if (!participant.ok) return participant;
  if (game.drawOffer) {
    return { ok: false, code: 'conflict', message: 'a draw offer is already pending' };
  }
  const nowMs = safeNow(game, context.nowMs);
  return {
    ok: true,
    value: completeCommand(
      {
        ...game,
        drawOffer: { offeredBy: context.actorId, offeredAtMs: nowMs },
        updatedAtMs: nowMs,
      },
      context,
      [
        {
          type: 'draw_offered',
          actorId: context.actorId,
          payload: { offeredBy: context.actorId },
        },
      ],
    ),
  };
}

export function acceptLiveChessDraw(
  game: LiveChessGame,
  context: LiveCommandContext,
): LiveChessResult<ApplyLiveCommandResult> {
  const participant = requireActiveParticipant(game, context.actorId);
  if (!participant.ok) return participant;
  if (!game.drawOffer) return { ok: false, code: 'conflict', message: 'no draw offer is pending' };
  if (game.drawOffer.offeredBy === context.actorId) {
    return { ok: false, code: 'forbidden', message: 'the offering player cannot accept own draw offer' };
  }
  const nowMs = safeNow(game, context.nowMs);
  const finished = finishGame(game, '1/2-1/2', 'draw_agreement', null, nowMs);
  return {
    ok: true,
    value: completeCommand(finished, context, [
      {
        type: 'game_finished',
        actorId: context.actorId,
        payload: { result: '1/2-1/2', termination: 'draw_agreement', winnerId: null },
      },
    ]),
  };
}

export function declineLiveChessDraw(
  game: LiveChessGame,
  context: LiveCommandContext,
): LiveChessResult<ApplyLiveCommandResult> {
  const participant = requireActiveParticipant(game, context.actorId);
  if (!participant.ok) return participant;
  if (!game.drawOffer) return { ok: false, code: 'conflict', message: 'no draw offer is pending' };
  if (game.drawOffer.offeredBy === context.actorId) {
    return { ok: false, code: 'forbidden', message: 'the offering player cannot decline own draw offer' };
  }
  const nowMs = safeNow(game, context.nowMs);
  return {
    ok: true,
    value: completeCommand(
      { ...game, drawOffer: null, updatedAtMs: nowMs },
      context,
      [
        {
          type: 'draw_declined',
          actorId: context.actorId,
          payload: { declinedBy: context.actorId },
        },
      ],
    ),
  };
}

export function resignLiveChessGame(
  game: LiveChessGame,
  context: LiveCommandContext,
): LiveChessResult<ApplyLiveCommandResult> {
  const participant = requireActiveParticipant(game, context.actorId);
  if (!participant.ok) return participant;
  const nowMs = safeNow(game, context.nowMs);
  const winnerId = opponentId(game, context.actorId);
  if (!winnerId) return { ok: false, code: 'forbidden', message: 'opponent not found' };
  const result = participant.value === 'white' ? '0-1' : '1-0';
  const finished = finishGame(game, result, 'resignation', winnerId, nowMs);
  return {
    ok: true,
    value: completeCommand(finished, context, [
      {
        type: 'game_finished',
        actorId: context.actorId,
        payload: { result, termination: 'resignation', winnerId, resignedBy: context.actorId },
      },
    ]),
  };
}

export function claimLiveChessTimeout(
  originalGame: LiveChessGame,
  context: LiveCommandContext,
): LiveChessResult<ApplyLiveCommandResult> {
  const participant = requireActiveParticipant(originalGame, context.actorId);
  if (!participant.ok) return participant;
  const nowMs = safeNow(originalGame, context.nowMs);
  let game = settleClock(originalGame, nowMs);
  const expired = expiredColor(game);
  if (!expired) {
    return { ok: false, code: 'conflict', message: 'the active player still has time remaining' };
  }
  game = timeoutResult(game, expired, nowMs);
  return {
    ok: true,
    value: completeCommand(game, context, [
      {
        type: 'game_finished',
        actorId: context.actorId,
        payload: {
          result: game.result,
          termination: 'timeout',
          winnerId: game.winnerId,
          expiredColor: expired,
        },
      },
    ]),
  };
}

export function liveChessParticipantView(
  game: LiveChessGame,
  viewerId: string,
  nowMs: number,
  spectatorDelayMs = 0,
): LiveChessParticipantView {
  const projected = projectedRemaining(game, nowMs);
  return {
    gameId: game.id,
    tenantId: game.tenantId,
    whitePlayerId: game.whitePlayerId,
    blackPlayerId: game.blackPlayerId,
    viewerColor: participantColor(game, viewerId),
    rated: game.rated,
    status: game.status,
    currentFen: game.currentFen,
    moves: game.moves,
    drawOffer: game.drawOffer,
    result: game.result,
    termination: game.termination,
    winnerId: game.winnerId,
    version: game.version,
    sequence: game.sequence,
    serverNowMs: Math.max(nowMs, game.clock.lastServerNowMs),
    whiteRemainingMs: projected.whiteRemainingMs,
    blackRemainingMs: projected.blackRemainingMs,
    activeColor: game.clock.activeColor,
    spectatorDelayMs,
  };
}
