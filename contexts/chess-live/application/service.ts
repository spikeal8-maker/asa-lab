import {
  acceptLiveChessChallenge,
  cancelLiveChessChallenge,
  createLiveChessChallenge,
  effectiveChallengeStatus,
  expireLiveChessChallenge,
  isSafeLiveId,
} from '../domain/challenge.js';
import {
  acceptLiveChessDraw,
  claimLiveChessTimeout,
  createLiveChessGame,
  declineLiveChessDraw,
  findProcessedLiveCommand,
  liveChessParticipantView,
  offerLiveChessDraw,
  resignLiveChessGame,
  submitLiveChessMove,
  type ApplyLiveCommandResult,
  type LiveCommandContext,
  type LiveEventDraft,
} from '../domain/game.js';
import {
  cancelMatchmakingTicket,
  createMatchmakingTicket,
  findMatchmakingPair,
  markMatchmakingTicketPaired,
  type MatchmakingPair,
  type MatchmakingTicket,
} from '../domain/matchmaking.js';
import {
  calculateChessRatingUpdate,
  createInitialChessRating,
  ratingPoolForTimeControl,
  type ChessRatingLedgerEntry,
  type ChessRatingPool,
  type ChessRatingState,
} from '../domain/rating.js';
import {
  participantColor,
  type ColorPreference,
  type LiveChessChallenge,
  type LiveChessCommandKind,
  type LiveChessCommandReceipt,
  type LiveChessEvent,
  type LiveChessGame,
  type LiveChessParticipantView,
  type LiveChessReconnectEnvelope,
  type LiveChessResult,
  type LiveTimeControl,
} from '../domain/model.js';
import type {
  ChessLiveRepositoryPort,
  LiveClockPort,
  LiveCommandReceipt,
  LiveIdPort,
} from './ports.js';

export interface LivePrincipal {
  readonly tenantId: string;
  readonly userId: string;
}

export interface CreateChallengeCommand {
  readonly commandId: string;
  readonly colorPreference: ColorPreference;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly expiresInMs: number;
}

export interface ChallengeCommandReceipt {
  readonly challenge: LiveChessChallenge;
  readonly replayed: boolean;
}

export interface AcceptedChallengeReceipt {
  readonly challenge: LiveChessChallenge;
  readonly game: LiveChessParticipantView;
  readonly replayed: boolean;
}

export interface GameCommandInput {
  readonly gameId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
}

export interface SubmitMoveCommand extends GameCommandInput {
  readonly uci: string;
}

export interface JoinMatchmakingCommand {
  readonly commandId: string;
  readonly timeControl: LiveTimeControl;
  readonly rated: boolean;
  readonly colorPreference: ColorPreference;
  readonly expiresInMs: number;
}

export interface MatchmakingJoinReceipt {
  readonly ticket: MatchmakingTicket;
  readonly game: LiveChessParticipantView | null;
  readonly replayed: boolean;
}

export interface CancelMatchmakingCommand {
  readonly commandId: string;
  readonly ticketId: string;
  readonly expectedVersion: number;
}

const SPECTATOR_DELAY_MS = 15_000;

function stableFingerprint(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function validateCommandId(commandId: string): LiveChessResult<string> {
  return isSafeLiveId(commandId)
    ? { ok: true, value: commandId }
    : { ok: false, code: 'validation_error', message: 'commandId must be a safe ID' };
}

function validateExpectedVersion(expectedVersion: number): LiveChessResult<number> {
  return Number.isSafeInteger(expectedVersion) && expectedVersion >= 1
    ? { ok: true, value: expectedVersion }
    : {
        ok: false,
        code: 'validation_error',
        message: 'expectedVersion must be a positive integer',
      };
}

function effectiveChallenge(
  challenge: LiveChessChallenge,
  nowMs: number,
): LiveChessChallenge {
  return effectiveChallengeStatus(challenge, nowMs) === 'expired'
    ? expireLiveChessChallenge(challenge, nowMs)
    : challenge;
}

export class ChessLiveService {
  constructor(
    private readonly repository: ChessLiveRepositoryPort,
    private readonly clock: LiveClockPort,
    private readonly ids: LiveIdPort,
  ) {}

  private newEvent(input: Omit<LiveChessEvent, 'id'>): LiveChessEvent {
    return { ...input, id: this.ids.nextId('event') };
  }

  private newReceipt(
    principal: LivePrincipal,
    commandId: string,
    kind: string,
    fingerprint: string,
    resourceType: LiveCommandReceipt['resourceType'],
    resourceId: string,
    nowMs: number,
  ): LiveCommandReceipt {
    return {
      tenantId: principal.tenantId,
      actorId: principal.userId,
      commandId,
      kind,
      fingerprint,
      resourceType,
      resourceId,
      createdAtMs: nowMs,
    };
  }

  private async checkReplay(
    principal: LivePrincipal,
    commandId: string,
    kind: string,
    fingerprint: string,
  ): Promise<LiveChessResult<LiveCommandReceipt | null>> {
    const existing = await this.repository.findCommandReceipt(
      principal.tenantId,
      commandId,
    );
    if (!existing) return { ok: true, value: null };
    if (
      existing.actorId !== principal.userId ||
      existing.kind !== kind ||
      existing.fingerprint !== fingerprint
    ) {
      return {
        ok: false,
        code: 'idempotency_conflict',
        message: 'commandId was already used for another command',
      };
    }
    return { ok: true, value: existing };
  }

  private gameEvents(
    before: LiveChessGame,
    after: LiveChessGame,
    drafts: readonly LiveEventDraft[],
    nowMs: number,
  ): readonly LiveChessEvent[] {
    return drafts.map((draft, index) =>
      this.newEvent({
        tenantId: after.tenantId,
        gameId: after.id,
        challengeId: after.challengeId,
        sequence: before.sequence + index + 1,
        type: draft.type,
        actorId: draft.actorId,
        createdAtMs: nowMs,
        payload: draft.payload,
      }),
    );
  }

  async createChallenge(
    principal: LivePrincipal,
    command: CreateChallengeCommand,
  ): Promise<LiveChessResult<ChallengeCommandReceipt>> {
    const commandId = validateCommandId(command.commandId);
    if (!commandId.ok) return commandId;
    const fingerprint = stableFingerprint({
      kind: 'create_challenge',
      colorPreference: command.colorPreference,
      initialMs: command.timeControl.initialMs,
      incrementMs: command.timeControl.incrementMs,
      rated: command.rated,
      expiresInMs: command.expiresInMs,
    });
    const replay = await this.checkReplay(
      principal,
      command.commandId,
      'create_challenge',
      fingerprint,
    );
    if (!replay.ok) return replay;
    if (replay.value) {
      const existing = await this.repository.getChallengeById(
        principal.tenantId,
        replay.value.resourceId,
      );
      return existing
        ? {
            ok: true,
            value: {
              challenge: effectiveChallenge(existing, this.clock.nowMs()),
              replayed: true,
            },
          }
        : {
            ok: false,
            code: 'not_found',
            message: 'replayed challenge no longer exists',
          };
    }

    const nowMs = this.clock.nowMs();
    const created = createLiveChessChallenge({
      id: this.ids.nextId('challenge'),
      publicCode: this.ids.nextPublicCode(),
      tenantId: principal.tenantId,
      creatorId: principal.userId,
      colorPreference: command.colorPreference,
      timeControl: command.timeControl,
      rated: command.rated,
      nowMs,
      expiresAtMs: nowMs + command.expiresInMs,
      commandId: command.commandId,
    });
    if (!created.ok) return created;
    const receipt = this.newReceipt(
      principal,
      command.commandId,
      'create_challenge',
      fingerprint,
      'challenge',
      created.value.id,
      nowMs,
    );
    const event = this.newEvent({
      tenantId: principal.tenantId,
      gameId: null,
      challengeId: created.value.id,
      sequence: 1,
      type: 'challenge_created',
      actorId: principal.userId,
      createdAtMs: nowMs,
      payload: {
        publicCode: created.value.publicCode,
        colorPreference: created.value.colorPreference,
        timeControl: created.value.timeControl,
        rated: created.value.rated,
        expiresAtMs: created.value.expiresAtMs,
      },
    });
    const stored = await this.repository.createChallenge(
      created.value,
      event,
      receipt,
    );
    return stored.ok
      ? { ok: true, value: { challenge: created.value, replayed: false } }
      : {
          ok: false,
          code: 'conflict',
          message: 'challenge or command already exists',
        };
  }

  async getChallenge(
    principal: LivePrincipal,
    publicCode: string,
  ): Promise<LiveChessResult<LiveChessChallenge>> {
    const challenge = await this.repository.getChallengeByCode(
      principal.tenantId,
      publicCode,
    );
    return challenge
      ? { ok: true, value: effectiveChallenge(challenge, this.clock.nowMs()) }
      : { ok: false, code: 'not_found', message: 'challenge not found' };
  }

  async acceptChallenge(
    principal: LivePrincipal,
    publicCode: string,
    commandId: string,
  ): Promise<LiveChessResult<AcceptedChallengeReceipt>> {
    const commandCheck = validateCommandId(commandId);
    if (!commandCheck.ok) return commandCheck;
    const fingerprint = stableFingerprint({ kind: 'accept_challenge', publicCode });
    const replay = await this.checkReplay(
      principal,
      commandId,
      'accept_challenge',
      fingerprint,
    );
    if (!replay.ok) return replay;
    if (replay.value) {
      const game = await this.repository.getGame(
        principal.tenantId,
        replay.value.resourceId,
      );
      if (!game) {
        return { ok: false, code: 'not_found', message: 'replayed game no longer exists' };
      }
      const challenge = game.challengeId
        ? await this.repository.getChallengeById(
            principal.tenantId,
            game.challengeId,
          )
        : null;
      return challenge
        ? {
            ok: true,
            value: {
              challenge,
              game: liveChessParticipantView(
                game,
                principal.userId,
                this.clock.nowMs(),
              ),
              replayed: true,
            },
          }
        : {
            ok: false,
            code: 'not_found',
            message: 'accepted challenge no longer exists',
          };
    }

    const challenge = await this.repository.getChallengeByCode(
      principal.tenantId,
      publicCode,
    );
    if (!challenge) {
      return { ok: false, code: 'not_found', message: 'challenge not found' };
    }
    const nowMs = this.clock.nowMs();
    const gameId = this.ids.nextId('game');
    const accepted = acceptLiveChessChallenge(
      challenge,
      principal.userId,
      gameId,
      nowMs,
    );
    if (!accepted.ok) return accepted;

    const creatorWhite =
      challenge.colorPreference === 'white' ||
      (challenge.colorPreference === 'random' && this.ids.randomBit() === 0);
    const whitePlayerId = creatorWhite
      ? challenge.creatorId
      : principal.userId;
    const blackPlayerId = creatorWhite
      ? principal.userId
      : challenge.creatorId;
    const createdGame = createLiveChessGame({
      id: gameId,
      tenantId: principal.tenantId,
      challengeId: challenge.id,
      whitePlayerId,
      blackPlayerId,
      timeControl: challenge.timeControl,
      rated: challenge.rated,
      nowMs,
    });
    if (!createdGame.ok) return createdGame;
    const storedGame: LiveChessGame = { ...createdGame.value, sequence: 2 };
    const events: readonly LiveChessEvent[] = [
      this.newEvent({
        tenantId: principal.tenantId,
        gameId,
        challengeId: challenge.id,
        sequence: 1,
        type: 'game_started',
        actorId: principal.userId,
        createdAtMs: nowMs,
        payload: {
          whitePlayerId,
          blackPlayerId,
          initialFen: storedGame.currentFen,
          timeControl: storedGame.timeControl,
          rated: storedGame.rated,
        },
      }),
      this.newEvent({
        tenantId: principal.tenantId,
        gameId,
        challengeId: challenge.id,
        sequence: 2,
        type: 'challenge_accepted',
        actorId: principal.userId,
        createdAtMs: nowMs,
        payload: {
          challengeId: challenge.id,
          acceptedById: principal.userId,
          gameId,
        },
      }),
    ];
    const receipt = this.newReceipt(
      principal,
      commandId,
      'accept_challenge',
      fingerprint,
      'game',
      gameId,
      nowMs,
    );
    const stored = await this.repository.acceptChallengeAndCreateGame(
      accepted.value,
      challenge.version,
      storedGame,
      events,
      receipt,
    );
    return stored.ok
      ? {
          ok: true,
          value: {
            challenge: accepted.value,
            game: liveChessParticipantView(
              storedGame,
              principal.userId,
              nowMs,
            ),
            replayed: false,
          },
        }
      : {
          ok: false,
          code: 'conflict',
          message: 'challenge was accepted concurrently',
        };
  }

  async cancelChallenge(
    principal: LivePrincipal,
    challengeId: string,
    commandId: string,
  ): Promise<LiveChessResult<ChallengeCommandReceipt>> {
    const commandCheck = validateCommandId(commandId);
    if (!commandCheck.ok) return commandCheck;
    const fingerprint = stableFingerprint({ kind: 'cancel_challenge', challengeId });
    const replay = await this.checkReplay(
      principal,
      commandId,
      'cancel_challenge',
      fingerprint,
    );
    if (!replay.ok) return replay;
    if (replay.value) {
      const challenge = await this.repository.getChallengeById(
        principal.tenantId,
        challengeId,
      );
      return challenge
        ? { ok: true, value: { challenge, replayed: true } }
        : { ok: false, code: 'not_found', message: 'challenge not found' };
    }
    const challenge = await this.repository.getChallengeById(
      principal.tenantId,
      challengeId,
    );
    if (!challenge) {
      return { ok: false, code: 'not_found', message: 'challenge not found' };
    }
    const nowMs = this.clock.nowMs();
    const cancelled = cancelLiveChessChallenge(
      challenge,
      principal.userId,
      nowMs,
    );
    if (!cancelled.ok) return cancelled;
    const receipt = this.newReceipt(
      principal,
      commandId,
      'cancel_challenge',
      fingerprint,
      'challenge',
      challengeId,
      nowMs,
    );
    const stored = await this.repository.saveChallenge(
      cancelled.value,
      challenge.version,
      [
        this.newEvent({
          tenantId: principal.tenantId,
          gameId: null,
          challengeId,
          sequence: cancelled.value.version,
          type: 'challenge_cancelled',
          actorId: principal.userId,
          createdAtMs: nowMs,
          payload: { challengeId },
        }),
      ],
      receipt,
    );
    return stored.ok
      ? { ok: true, value: { challenge: cancelled.value, replayed: false } }
      : {
          ok: false,
          code: 'conflict',
          message: 'challenge changed concurrently',
        };
  }

  private async applyGameCommand(
    principal: LivePrincipal,
    command: GameCommandInput,
    kind: LiveChessCommandKind,
    extraFingerprint: Readonly<Record<string, unknown>>,
    apply: (
      game: LiveChessGame,
      context: LiveCommandContext,
    ) => LiveChessResult<ApplyLiveCommandResult>,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    const commandCheck = validateCommandId(command.commandId);
    if (!commandCheck.ok) return commandCheck;
    const versionCheck = validateExpectedVersion(command.expectedVersion);
    if (!versionCheck.ok) return versionCheck;
    const fingerprint = stableFingerprint({
      kind,
      gameId: command.gameId,
      expectedVersion: command.expectedVersion,
      ...extraFingerprint,
    });
    const replay = await this.checkReplay(
      principal,
      command.commandId,
      kind,
      fingerprint,
    );
    if (!replay.ok) return replay;
    if (replay.value) {
      const game = await this.repository.getGame(
        principal.tenantId,
        command.gameId,
      );
      if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
      const processed = findProcessedLiveCommand(game, command.commandId);
      const afterSequence = Math.max(
        0,
        (processed?.appliedSequence ?? game.sequence) - 1,
      );
      const events = await this.repository.listGameEvents(
        principal.tenantId,
        game.id,
        afterSequence,
      );
      return {
        ok: true,
        value: {
          game: liveChessParticipantView(
            game,
            principal.userId,
            this.clock.nowMs(),
          ),
          replayed: true,
          event: events.at(-1) ?? null,
        },
      };
    }

    const game = await this.repository.getGame(
      principal.tenantId,
      command.gameId,
    );
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (!participantColor(game, principal.userId)) {
      return {
        ok: false,
        code: 'forbidden',
        message: 'user is not a game participant',
      };
    }
    if (game.version !== command.expectedVersion) {
      return {
        ok: false,
        code: 'conflict',
        message: `expectedVersion ${command.expectedVersion} does not match current ${game.version}`,
      };
    }

    const nowMs = this.clock.nowMs();
    const applied = apply(game, {
      actorId: principal.userId,
      commandId: command.commandId,
      nowMs,
      kind,
    });
    if (!applied.ok) return applied;
    const events = this.gameEvents(
      game,
      applied.value.game,
      applied.value.events,
      nowMs,
    );
    const receipt = this.newReceipt(
      principal,
      command.commandId,
      kind,
      fingerprint,
      'game',
      game.id,
      nowMs,
    );
    const stored = await this.repository.saveGame(
      applied.value.game,
      game.version,
      events,
      receipt,
    );
    if (!stored.ok) {
      return {
        ok: false,
        code: 'conflict',
        message: 'game changed concurrently',
      };
    }
    if (
      game.status === 'active' &&
      applied.value.game.status === 'finished' &&
      applied.value.game.rated
    ) {
      await this.applyRatingUpdate(applied.value.game, nowMs);
    }
    return {
      ok: true,
      value: {
        game: liveChessParticipantView(
          applied.value.game,
          principal.userId,
          nowMs,
        ),
        replayed: false,
        event: events.at(-1) ?? null,
      },
    };
  }

  submitMove(
    principal: LivePrincipal,
    command: SubmitMoveCommand,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    return this.applyGameCommand(
      principal,
      command,
      'submit_move',
      { uci: command.uci },
      (game, context) => submitLiveChessMove(game, context, command.uci),
    );
  }

  offerDraw(
    principal: LivePrincipal,
    command: GameCommandInput,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    return this.applyGameCommand(
      principal,
      command,
      'offer_draw',
      {},
      offerLiveChessDraw,
    );
  }

  acceptDraw(
    principal: LivePrincipal,
    command: GameCommandInput,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    return this.applyGameCommand(
      principal,
      command,
      'accept_draw',
      {},
      acceptLiveChessDraw,
    );
  }

  declineDraw(
    principal: LivePrincipal,
    command: GameCommandInput,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    return this.applyGameCommand(
      principal,
      command,
      'decline_draw',
      {},
      declineLiveChessDraw,
    );
  }

  resign(
    principal: LivePrincipal,
    command: GameCommandInput,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    return this.applyGameCommand(
      principal,
      command,
      'resign',
      {},
      resignLiveChessGame,
    );
  }

  claimTimeout(
    principal: LivePrincipal,
    command: GameCommandInput,
  ): Promise<LiveChessResult<LiveChessCommandReceipt>> {
    return this.applyGameCommand(
      principal,
      command,
      'claim_timeout',
      {},
      claimLiveChessTimeout,
    );
  }

  async getGame(
    principal: LivePrincipal,
    gameId: string,
  ): Promise<LiveChessResult<LiveChessParticipantView>> {
    const game = await this.repository.getGame(principal.tenantId, gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (!participantColor(game, principal.userId)) {
      return {
        ok: false,
        code: 'forbidden',
        message: 'spectator snapshot requires delayed spectator endpoint',
      };
    }
    return {
      ok: true,
      value: liveChessParticipantView(
        game,
        principal.userId,
        this.clock.nowMs(),
      ),
    };
  }

  async reconnect(
    principal: LivePrincipal,
    gameId: string,
    afterSequence: number,
  ): Promise<LiveChessResult<LiveChessReconnectEnvelope>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return {
        ok: false,
        code: 'validation_error',
        message: 'afterSequence must be a non-negative integer',
      };
    }
    const game = await this.repository.getGame(principal.tenantId, gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (!participantColor(game, principal.userId)) {
      return {
        ok: false,
        code: 'forbidden',
        message: 'user is not a game participant',
      };
    }
    const events = await this.repository.listGameEvents(
      principal.tenantId,
      gameId,
      afterSequence,
    );
    return {
      ok: true,
      value: {
        snapshot: liveChessParticipantView(
          game,
          principal.userId,
          this.clock.nowMs(),
        ),
        events,
        nextSequence: game.sequence,
      },
    };
  }

  async spectatorEvents(
    principal: LivePrincipal,
    gameId: string,
    afterSequence: number,
  ): Promise<LiveChessResult<readonly LiveChessEvent[]>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return {
        ok: false,
        code: 'validation_error',
        message: 'afterSequence must be a non-negative integer',
      };
    }
    const game = await this.repository.getGame(principal.tenantId, gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    const participant = participantColor(game, principal.userId);
    const visibleBeforeOrAtMs = participant
      ? undefined
      : game.status === 'finished'
        ? this.clock.nowMs()
        : this.clock.nowMs() - SPECTATOR_DELAY_MS;
    const events = await this.repository.listGameEvents(
      principal.tenantId,
      gameId,
      afterSequence,
      visibleBeforeOrAtMs,
    );
    return { ok: true, value: events };
  }

  async joinMatchmaking(
    principal: LivePrincipal,
    command: JoinMatchmakingCommand,
  ): Promise<LiveChessResult<MatchmakingJoinReceipt>> {
    const commandCheck = validateCommandId(command.commandId);
    if (!commandCheck.ok) return commandCheck;
    const fingerprint = stableFingerprint({
      kind: 'join_matchmaking',
      initialMs: command.timeControl.initialMs,
      incrementMs: command.timeControl.incrementMs,
      rated: command.rated,
      colorPreference: command.colorPreference,
      expiresInMs: command.expiresInMs,
    });
    const replay = await this.checkReplay(
      principal,
      command.commandId,
      'join_matchmaking',
      fingerprint,
    );
    if (!replay.ok) return replay;
    if (replay.value) {
      const ticket = await this.repository.getTicket(
        principal.tenantId,
        replay.value.resourceId,
      );
      if (!ticket) {
        return { ok: false, code: 'not_found', message: 'matchmaking ticket not found' };
      }
      const game = ticket.pairedGameId
        ? await this.repository.getGame(
            principal.tenantId,
            ticket.pairedGameId,
          )
        : null;
      return {
        ok: true,
        value: {
          ticket,
          game: game
            ? liveChessParticipantView(
                game,
                principal.userId,
                this.clock.nowMs(),
              )
            : null,
          replayed: true,
        },
      };
    }

    const nowMs = this.clock.nowMs();
    const pool = ratingPoolForTimeControl(
      command.timeControl.initialMs,
      command.timeControl.incrementMs,
    );
    const rating =
      (await this.repository.getRating(
        principal.tenantId,
        principal.userId,
        pool,
      )) ??
      createInitialChessRating(
        principal.tenantId,
        principal.userId,
        pool,
        nowMs,
      );
    const created = createMatchmakingTicket({
      id: this.ids.nextId('ticket'),
      tenantId: principal.tenantId,
      playerId: principal.userId,
      timeControl: command.timeControl,
      rated: command.rated,
      colorPreference: command.colorPreference,
      rating: rating.rating,
      nowMs,
      expiresAtMs: nowMs + command.expiresInMs,
      commandId: command.commandId,
    });
    if (!created.ok) return created;
    const receipt = this.newReceipt(
      principal,
      command.commandId,
      'join_matchmaking',
      fingerprint,
      'ticket',
      created.value.id,
      nowMs,
    );
    const stored = await this.repository.createTicket(created.value, receipt);
    if (!stored.ok) {
      return {
        ok: false,
        code: 'conflict',
        message: 'ticket or queued player already exists',
      };
    }
    await this.tryPairMatchmaking(principal.tenantId, nowMs);
    const ticket =
      (await this.repository.getTicket(
        principal.tenantId,
        created.value.id,
      )) ?? created.value;
    const game = ticket.pairedGameId
      ? await this.repository.getGame(principal.tenantId, ticket.pairedGameId)
      : null;
    return {
      ok: true,
      value: {
        ticket,
        game: game
          ? liveChessParticipantView(game, principal.userId, nowMs)
          : null,
        replayed: false,
      },
    };
  }

  private async tryPairMatchmaking(
    tenantId: string,
    nowMs: number,
  ): Promise<LiveChessGame | null> {
    const pair = findMatchmakingPair(
      await this.repository.listQueuedTickets(tenantId),
      nowMs,
    );
    return pair ? this.createGameFromPair(pair, nowMs) : null;
  }

  private async createGameFromPair(
    pair: MatchmakingPair,
    nowMs: number,
  ): Promise<LiveChessGame | null> {
    const created = createLiveChessGame({
      id: this.ids.nextId('game'),
      tenantId: pair.white.tenantId,
      challengeId: null,
      whitePlayerId: pair.white.playerId,
      blackPlayerId: pair.black.playerId,
      timeControl: pair.timeControl,
      rated: pair.rated,
      nowMs,
    });
    if (!created.ok) return null;
    const white = markMatchmakingTicketPaired(
      pair.white,
      created.value.id,
    );
    const black = markMatchmakingTicketPaired(
      pair.black,
      created.value.id,
    );
    const event = this.newEvent({
      tenantId: created.value.tenantId,
      gameId: created.value.id,
      challengeId: null,
      sequence: 1,
      type: 'game_started',
      actorId: null,
      createdAtMs: nowMs,
      payload: {
        source: 'matchmaking',
        whitePlayerId: created.value.whitePlayerId,
        blackPlayerId: created.value.blackPlayerId,
        timeControl: created.value.timeControl,
        rated: created.value.rated,
        ratingDifference: pair.ratingDifference,
      },
    });
    const stored = await this.repository.pairTicketsAndCreateGame(
      white,
      pair.white.version,
      black,
      pair.black.version,
      created.value,
      [event],
    );
    return stored.ok ? created.value : null;
  }

  async cancelMatchmaking(
    principal: LivePrincipal,
    command: CancelMatchmakingCommand,
  ): Promise<
    LiveChessResult<{
      readonly ticket: MatchmakingTicket;
      readonly replayed: boolean;
    }>
  > {
    const commandCheck = validateCommandId(command.commandId);
    if (!commandCheck.ok) return commandCheck;
    const versionCheck = validateExpectedVersion(command.expectedVersion);
    if (!versionCheck.ok) return versionCheck;
    const fingerprint = stableFingerprint({
      kind: 'cancel_matchmaking',
      ticketId: command.ticketId,
      expectedVersion: command.expectedVersion,
    });
    const replay = await this.checkReplay(
      principal,
      command.commandId,
      'cancel_matchmaking',
      fingerprint,
    );
    if (!replay.ok) return replay;
    if (replay.value) {
      const ticket = await this.repository.getTicket(
        principal.tenantId,
        command.ticketId,
      );
      return ticket
        ? { ok: true, value: { ticket, replayed: true } }
        : { ok: false, code: 'not_found', message: 'ticket not found' };
    }
    const ticket = await this.repository.getTicket(
      principal.tenantId,
      command.ticketId,
    );
    if (!ticket) return { ok: false, code: 'not_found', message: 'ticket not found' };
    if (ticket.version !== command.expectedVersion) {
      return {
        ok: false,
        code: 'conflict',
        message: 'ticket changed concurrently',
      };
    }
    const nowMs = this.clock.nowMs();
    const cancelled = cancelMatchmakingTicket(
      ticket,
      principal.userId,
      nowMs,
    );
    if (!cancelled.ok) return cancelled;
    const stored = await this.repository.saveTicket(
      cancelled.value,
      ticket.version,
      this.newReceipt(
        principal,
        command.commandId,
        'cancel_matchmaking',
        fingerprint,
        'ticket',
        ticket.id,
        nowMs,
      ),
    );
    return stored.ok
      ? { ok: true, value: { ticket: cancelled.value, replayed: false } }
      : {
          ok: false,
          code: 'conflict',
          message: 'ticket changed concurrently',
        };
  }

  async getRating(
    principal: LivePrincipal,
    pool: ChessRatingPool,
  ): Promise<
    LiveChessResult<{
      readonly rating: ChessRatingState;
      readonly ledger: readonly ChessRatingLedgerEntry[];
    }>
  > {
    const nowMs = this.clock.nowMs();
    const rating =
      (await this.repository.getRating(
        principal.tenantId,
        principal.userId,
        pool,
      )) ??
      createInitialChessRating(
        principal.tenantId,
        principal.userId,
        pool,
        nowMs,
      );
    const ledger = await this.repository.listRatingLedger(
      principal.tenantId,
      principal.userId,
      pool,
    );
    return { ok: true, value: { rating, ledger } };
  }

  private async applyRatingUpdate(
    game: LiveChessGame,
    nowMs: number,
  ): Promise<void> {
    const pool = ratingPoolForTimeControl(
      game.timeControl.initialMs,
      game.timeControl.incrementMs,
    );
    const white =
      (await this.repository.getRating(
        game.tenantId,
        game.whitePlayerId,
        pool,
      )) ??
      createInitialChessRating(
        game.tenantId,
        game.whitePlayerId,
        pool,
        nowMs,
      );
    const black =
      (await this.repository.getRating(
        game.tenantId,
        game.blackPlayerId,
        pool,
      )) ??
      createInitialChessRating(
        game.tenantId,
        game.blackPlayerId,
        pool,
        nowMs,
      );
    const update = calculateChessRatingUpdate(
      game,
      white,
      black,
      [this.ids.nextId('rating'), this.ids.nextId('rating')],
      nowMs,
    );
    await this.repository.saveRatingUpdate(
      game.id,
      update.white,
      update.black,
      update.ledger,
    );
  }
}
