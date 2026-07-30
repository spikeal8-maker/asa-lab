import type { Color } from '@asa-lab/chess';
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
  const sorted = Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify(sorted);
}

function commandValidation(commandId: string): LiveChessResult<string> {
  if (!isSafeLiveId(commandId)) {
    return { ok: false, code: 'validation_error', message: 'commandId must be a safe ID' };
  }
  return { ok: true, value: commandId };
}

function expectedVersionValidation(expectedVersion: number): LiveChessResult<number> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, code: 'validation_error', message: 'expectedVersion must be a positive integer' };
  }
  return { ok: true, value: expectedVersion };
}

function publicChallengeView(challenge: LiveChessChallenge, nowMs: number): LiveChessChallenge {
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

  private event(
    input: Omit<LiveChessEvent, 'id'>,
  ): LiveChessEvent {
    return { ...input, id: this.ids.nextId('event') };
  }

  private commandReceipt(
    principal: LivePrincipal,
    commandId: string,
    kind: string,
    fingerprint: string,
    resourceType: LiveCommandReceipt['event'] extends never ? never : LiveCommandReceipt['game'] extends never ? never : LiveCommandReceipt['game'] extends LiveChessParticipantView ? 'game' : never,
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

  private receipt(
    principal: LivePrincipal,
    commandId: string,
    kind: string,
    fingerprint: string,
    resourceType: LiveCommandReceipt['game'] extends LiveChessParticipantView ? 'game' : never,
    resourceId: string,
    nowMs: number,
  ): LiveCommandReceipt {
    return this.commandReceipt(
      principal,
      commandId,
      kind,
      fingerprint,
      resourceType,
      resourceId,
      nowMs,
    );
  }

  private repositoryReceipt(
    principal: LivePrincipal,
    commandId: string,
    kind: string,
    fingerprint: string,
    resourceType: 'challenge' | 'game' | 'ticket',
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

  private async existingReceipt(
    principal: LivePrincipal,
    commandId: string,
    kind: string,
    fingerprint: string,
  ): Promise<LiveChessResult<LiveCommandReceipt | null>> {
    const existing = await this.repository.findCommandReceipt(principal.tenantId, commandId);
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

  private materializeGameEvents(
    gameBefore: LiveChessGame,
    gameAfter: LiveChessGame,
    drafts: readonly LiveEventDraft[],
    nowMs: number,
  ): readonly LiveChessEvent[] {
    return drafts.map((draft, index) =>
      this.event({
        tenantId: gameAfter.tenantId,
        gameId: gameAfter.id,
        challengeId: gameAfter.challengeId,
        sequence: gameBefore.sequence + index + 1,
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
    const commandId = commandValidation(command.commandId);
    if (!commandId.ok) return commandId;
    const fingerprint = stableFingerprint({
      kind: 'create_challenge',
      colorPreference: command.colorPreference,
      initialMs: command.timeControl.initialMs,
      incrementMs: command.timeControl.incrementMs,
      rated: command.rated,
      expiresInMs: command.expiresInMs,
    });
    const existing = await this.existingReceipt(
      principal,
      command.commandId,
      'create_challenge',
      fingerprint,
    );
    if (!existing.ok) return existing;
    if (existing.value) {
      const challenge = await this.repository.getChallengeById(
        principal.tenantId,
        existing.value.resourceId,
      );
      if (!challenge) return { ok: false, code: 'not_found', message: 'replayed challenge no longer exists' };
      return { ok: true, value: { challenge: publicChallengeView(challenge, this.clock.nowMs()), replayed: true } };
    }

    const nowMs = this.clock.nowMs();
    const challenge = createLiveChessChallenge({
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
    if (!challenge.ok) return challenge;
    const receipt = this.repositoryReceipt(
      principal,
      command.commandId,
      'create_challenge',
      fingerprint,
      'challenge',
      challenge.value.id,
      nowMs,
    );
    const event = this.event({
      tenantId: principal.tenantId,
      gameId: null,
      challengeId: challenge.value.id,
      sequence: 1,
      type: 'challenge_created',
      actorId: principal.userId,
      createdAtMs: nowMs,
      payload: {
        publicCode: challenge.value.publicCode,
        colorPreference: challenge.value.colorPreference,
        timeControl: challenge.value.timeControl,
        rated: challenge.value.rated,
        expiresAtMs: challenge.value.expiresAtMs,
      },
    });
    const stored = await this.repository.createChallenge(challenge.value, event, receipt);
    if (!stored.ok) return { ok: false, code: 'conflict', message: 'challenge or command already exists' };
    return { ok: true, value: { challenge: challenge.value, replayed: false } };
  }

  async getChallenge(
    principal: LivePrincipal,
    publicCode: string,
  ): Promise<LiveChessResult<LiveChessChallenge>> {
    const challenge = await this.repository.getChallengeByCode(principal.tenantId, publicCode);
    if (!challenge) return { ok: false, code: 'not_found', message: 'challenge not found' };
    return { ok: true, value: publicChallengeView(challenge, this.clock.nowMs()) };
  }

  async acceptChallenge(
    principal: LivePrincipal,
    publicCode: string,
    commandId: string,
  ): Promise<LiveChessResult<AcceptedChallengeReceipt>> {
    const commandCheck = commandValidation(commandId);
    if (!commandCheck.ok) return commandCheck;
    const fingerprint = stableFingerprint({ kind: 'accept_challenge', publicCode });
    const existing = await this.existingReceipt(
      principal,
      commandId,
      'accept_challenge',
      fingerprint,
    );
    if (!existing.ok) return existing;
    if (existing.value) {
      const game = await this.repository.getGame(principal.tenantId, existing.value.resourceId);
      if (!game) return { ok: false, code: 'not_found', message: 'replayed game no longer exists' };
      const challenge = game.challengeId
        ? await this.repository.getChallengeById(principal.tenantId, game.challengeId)
        : null;
      if (!challenge) return { ok: false, code: 'not_found', message: 'accepted challenge no longer exists' };
      return {
        ok: true,
        value: {
          challenge,
          game: liveChessParticipantView(game, principal.userId, this.clock.nowMs()),
          replayed: true,
        },
      };
    }

    const challenge = await this.repository.getChallengeByCode(principal.tenantId, publicCode);
    if (!challenge) return { ok: false, code: 'not_found', message: 'challenge not found' };
    const nowMs = this.clock.nowMs();
    const gameId = this.ids.nextId('game');
    const accepted = acceptLiveChessChallenge(challenge, principal.userId, gameId, nowMs);
    if (!accepted.ok) return accepted;
    const creatorWhite =
      challenge.colorPreference === 'white' ||
      (challenge.colorPreference === 'random' && this.ids.randomBit() === 0);
    const whitePlayerId = creatorWhite ? challenge.creatorId : principal.userId;
    const blackPlayerId = creatorWhite ? principal.userId : challenge.creatorId;
    const game = createLiveChessGame({
      id: gameId,
      tenantId: principal.tenantId,
      challengeId: challenge.id,
      whitePlayerId,
      blackPlayerId,
      timeControl: challenge.timeControl,
      rated: challenge.rated,
      nowMs,
    });
    if (!game.ok) return game;
    const events: readonly LiveChessEvent[] = [
      this.event({
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
          initialFen: game.value.currentFen,
          timeControl: game.value.timeControl,
          rated: game.value.rated,
        },
      }),
      this.event({
        tenantId: principal.tenantId,
        gameId,
        challengeId: challenge.id,
        sequence: 2,
        type: 'challenge_accepted',
        actorId: principal.userId,
        createdAtMs: nowMs,
        payload: { challengeId: challenge.id, acceptedById: principal.userId, gameId },
      }),
    ];
    const storedGame: LiveChessGame = { ...game.value, sequence: 2 };
    const receipt = this.repositoryReceipt(
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
    if (!stored.ok) return { ok: false, code: 'conflict', message: 'challenge was accepted concurrently' };
    return {
      ok: true,
      value: {
        challenge: accepted.value,
        game: liveChessParticipantView(storedGame, principal.userId, nowMs),
        replayed: false,
      },
    };
  }

  async cancelChallenge(
    principal: LivePrincipal,
    challengeId: string,
    commandId: string,
  ): Promise<LiveChessResult<ChallengeCommandReceipt>> {
    const commandCheck = commandValidation(commandId);
    if (!commandCheck.ok) return commandCheck;
    const fingerprint = stableFingerprint({ kind: 'cancel_challenge', challengeId });
    const existing = await this.existingReceipt(
      principal,
      commandId,
      'cancel_challenge',
      fingerprint,
    );
    if (!existing.ok) return existing;
    if (existing.value) {
      const replayed = await this.repository.getChallengeById(principal.tenantId, challengeId);
      if (!replayed) return { ok: false, code: 'not_found', message: 'challenge not found' };
      return { ok: true, value: { challenge: replayed, replayed: true } };
    }
    const challenge = await this.repository.getChallengeById(principal.tenantId, challengeId);
    if (!challenge) return { ok: false, code: 'not_found', message: 'challenge not found' };
    const nowMs = this.clock.nowMs();
    const cancelled = cancelLiveChessChallenge(challenge, principal.userId, nowMs);
    if (!cancelled.ok) return cancelled;
    const event = this.event({
      tenantId: principal.tenantId,
      gameId: null,
      challengeId,
      sequence: cancelled.value.version,
      type: 'challenge_cancelled',
      actorId: principal.userId,
      createdAtMs: nowMs,
      payload: { challengeId },
    });
    const receipt = this.repositoryReceipt(
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
      [event],
      receipt,
    );
    if (!stored.ok) return { ok: false, code: 'conflict', message: 'challenge changed concurrently' };
    return { ok: true, value: { challenge: cancelled.value, replayed: false } };
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
    const commandId = commandValidation(command.commandId);
    if (!commandId.ok) return commandId;
    const expected = expectedVersionValidation(command.expectedVersion);
    if (!expected.ok) return expected;
    const fingerprint = stableFingerprint({
      kind,
      gameId: command.gameId,
      expectedVersion: command.expectedVersion,
      ...extraFingerprint,
    });
    const existing = await this.existingReceipt(principal, command.commandId, kind, fingerprint);
    if (!existing.ok) return existing;
    if (existing.value) {
      const game = await this.repository.getGame(principal.tenantId, command.gameId);
      if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
      const events = await this.repository.listGameEvents(
        principal.tenantId,
        game.id,
        Math.max(0, findProcessedLiveCommand(game, command.commandId)?.appliedSequence ?? game.sequence) - 1,
      );
      return {
        ok: true,
        value: {
          game: liveChessParticipantView(game, principal.userId, this.clock.nowMs()),
          replayed: true,
          event: events.at(-1) ?? null,
        },
      };
    }

    const game = await this.repository.getGame(principal.tenantId, command.gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (!participantColor(game, principal.userId)) {
      return { ok: false, code: 'forbidden', message: 'user is not a game participant' };
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
    const events = this.materializeGameEvents(game, applied.value.game, applied.value.events, nowMs);
    const receipt = this.repositoryReceipt(
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
    if (!stored.ok) return { ok: false, code: 'conflict', message: 'game changed concurrently' };
    if (game.status === 'active' && applied.value.game.status === 'finished' && applied.value.game.rated) {
      await this.applyRatingUpdate(applied.value.game, nowMs);
    }
    return {
      ok: true,
      value: {
        game: liveChessParticipantView(applied.value.game, principal.userId, nowMs),
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

  offerDraw(principal: LivePrincipal, command: GameCommandInput) {
    return this.applyGameCommand(principal, command, 'offer_draw', {}, offerLiveChessDraw);
  }

  acceptDraw(principal: LivePrincipal, command: GameCommandInput) {
    return this.applyGameCommand(principal, command, 'accept_draw', {}, acceptLiveChessDraw);
  }

  declineDraw(principal: LivePrincipal, command: GameCommandInput) {
    return this.applyGameCommand(principal, command, 'decline_draw', {}, declineLiveChessDraw);
  }

  resign(principal: LivePrincipal, command: GameCommandInput) {
    return this.applyGameCommand(principal, command, 'resign', {}, resignLiveChessGame);
  }

  claimTimeout(principal: LivePrincipal, command: GameCommandInput) {
    return this.applyGameCommand(principal, command, 'claim_timeout', {}, claimLiveChessTimeout);
  }

  async getGame(
    principal: LivePrincipal,
    gameId: string,
  ): Promise<LiveChessResult<LiveChessParticipantView>> {
    const game = await this.repository.getGame(principal.tenantId, gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (!participantColor(game, principal.userId)) {
      return { ok: false, code: 'forbidden', message: 'spectator snapshot requires delayed spectator endpoint' };
    }
    return {
      ok: true,
      value: liveChessParticipantView(game, principal.userId, this.clock.nowMs()),
    };
  }

  async reconnect(
    principal: LivePrincipal,
    gameId: string,
    afterSequence: number,
  ): Promise<LiveChessResult<LiveChessReconnectEnvelope>> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return { ok: false, code: 'validation_error', message: 'afterSequence must be a non-negative integer' };
    }
    const game = await this.repository.getGame(principal.tenantId, gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (!participantColor(game, principal.userId)) {
      return { ok: false, code: 'forbidden', message: 'user is not a game participant' };
    }
    const events = await this.repository.listGameEvents(
      principal.tenantId,
      gameId,
      afterSequence,
    );
    return {
      ok: true,
      value: {
        snapshot: liveChessParticipantView(game, principal.userId, this.clock.nowMs()),
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
      return { ok: false, code: 'validation_error', message: 'afterSequence must be a non-negative integer' };
    }
    const game = await this.repository.getGame(principal.tenantId, gameId);
    if (!game) return { ok: false, code: 'not_found', message: 'game not found' };
    if (participantColor(game, principal.userId)) {
      return this.repository
        .listGameEvents(principal.tenantId, gameId, afterSequence)
        .then((events) => ({ ok: true, value: events }));
    }
    const visibleBefore = game.status === 'finished'
      ? this.clock.nowMs()
      : this.clock.nowMs() - SPECTATOR_DELAY_MS;
    const events = await this.repository.listGameEvents(
      principal.tenantId,
      gameId,
      afterSequence,
      visibleBefore,
    );
    return { ok: true, value: events };
  }

  async joinMatchmaking(
    principal: LivePrincipal,
    command: JoinMatchmakingCommand,
  ): Promise<LiveChessResult<MatchmakingJoinReceipt>> {
    const commandId = commandValidation(command.commandId);
    if (!commandId.ok) return commandId;
    const fingerprint = stableFingerprint({
      kind: 'join_matchmaking',
      initialMs: command.timeControl.initialMs,
      incrementMs: command.timeControl.incrementMs,
      rated: command.rated,
      colorPreference: command.colorPreference,
      expiresInMs: command.expiresInMs,
    });
    const existing = await this.existingReceipt(
      principal,
      command.commandId,
      'join_matchmaking',
      fingerprint,
    );
    if (!existing.ok) return existing;
    if (existing.value) {
      const ticket = await this.repository.getTicket(principal.tenantId, existing.value.resourceId);
      if (!ticket) return { ok: false, code: 'not_found', message: 'matchmaking ticket not found' };
      const game = ticket.pairedGameId
        ? await this.repository.getGame(principal.tenantId, ticket.pairedGameId)
        : null;
      return {
        ok: true,
        value: {
          ticket,
          game: game ? liveChessParticipantView(game, principal.userId, this.clock.nowMs()) : null,
          replayed: true,
        },
      };
    }
    const nowMs = this.clock.nowMs();
    const pool = ratingPoolForTimeControl(command.timeControl.initialMs, command.timeControl.incrementMs);
    const rating =
      (await this.repository.getRating(principal.tenantId, principal.userId, pool)) ??
      createInitialChessRating(principal.tenantId, principal.userId, pool, nowMs);
    const ticket = createMatchmakingTicket({
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
    if (!ticket.ok) return ticket;
    const receipt = this.repositoryReceipt(
      principal,
      command.commandId,
      'join_matchmaking',
      fingerprint,
      'ticket',
      ticket.value.id,
      nowMs,
    );
    const stored = await this.repository.createTicket(ticket.value, receipt);
    if (!stored.ok) return { ok: false, code: 'conflict', message: 'ticket or command already exists' };
    const paired = await this.tryPairMatchmaking(principal.tenantId, nowMs);
    const refreshed = await this.repository.getTicket(principal.tenantId, ticket.value.id);
    const game = refreshed?.pairedGameId
      ? await this.repository.getGame(principal.tenantId, refreshed.pairedGameId)
      : paired?.id === refreshed?.pairedGameId
        ? paired
        : null;
    return {
      ok: true,
      value: {
        ticket: refreshed ?? ticket.value,
        game: game ? liveChessParticipantView(game, principal.userId, nowMs) : null,
        replayed: false,
      },
    };
  }

  private async tryPairMatchmaking(
    tenantId: string,
    nowMs: number,
  ): Promise<LiveChessGame | null> {
    const tickets = await this.repository.listQueuedTickets(tenantId);
    const pair = findMatchmakingPair(tickets, nowMs);
    if (!pair) return null;
    return this.createGameFromMatchmakingPair(pair, nowMs);
  }

  private async createGameFromMatchmakingPair(
    pair: MatchmakingPair,
    nowMs: number,
  ): Promise<LiveChessGame | null> {
    const game = createLiveChessGame({
      id: this.ids.nextId('game'),
      tenantId: pair.white.tenantId,
      challengeId: null,
      whitePlayerId: pair.white.playerId,
      blackPlayerId: pair.black.playerId,
      timeControl: pair.timeControl,
      rated: pair.rated,
      nowMs,
    });
    if (!game.ok) return null;
    const event = this.event({
      tenantId: game.value.tenantId,
      gameId: game.value.id,
      challengeId: null,
      sequence: 1,
      type: 'game_started',
      actorId: null,
      createdAtMs: nowMs,
      payload: {
        source: 'matchmaking',
        whitePlayerId: game.value.whitePlayerId,
        blackPlayerId: game.value.blackPlayerId,
        timeControl: game.value.timeControl,
        rated: game.value.rated,
        ratingDifference: pair.ratingDifference,
      },
    });
    const whiteTicket = markMatchmakingTicketPaired(pair.white, game.value.id);
    const blackTicket = markMatchmakingTicketPaired(pair.black, game.value.id);
    const stored = await this.repository.pairTicketsAndCreateGame(
      whiteTicket,
      pair.white.version,
      blackTicket,
      pair.black.version,
      game.value,
      [event],
    );
    return stored.ok ? game.value : null;
  }

  async cancelMatchmaking(
    principal: LivePrincipal,
    command: CancelMatchmakingCommand,
  ): Promise<LiveChessResult<{ readonly ticket: MatchmakingTicket; readonly replayed: boolean }>> {
    const commandId = commandValidation(command.commandId);
    if (!commandId.ok) return commandId;
    const expected = expectedVersionValidation(command.expectedVersion);
    if (!expected.ok) return expected;
    const fingerprint = stableFingerprint({
      kind: 'cancel_matchmaking',
      ticketId: command.ticketId,
      expectedVersion: command.expectedVersion,
    });
    const existing = await this.existingReceipt(
      principal,
      command.commandId,
      'cancel_matchmaking',
      fingerprint,
    );
    if (!existing.ok) return existing;
    if (existing.value) {
      const ticket = await this.repository.getTicket(principal.tenantId, command.ticketId);
      if (!ticket) return { ok: false, code: 'not_found', message: 'ticket not found' };
      return { ok: true, value: { ticket, replayed: true } };
    }
    const ticket = await this.repository.getTicket(principal.tenantId, command.ticketId);
    if (!ticket) return { ok: false, code: 'not_found', message: 'ticket not found' };
    if (ticket.version !== command.expectedVersion) {
      return { ok: false, code: 'conflict', message: 'ticket changed concurrently' };
    }
    const cancelled = cancelMatchmakingTicket(ticket, principal.userId, this.clock.nowMs());
    if (!cancelled.ok) return cancelled;
    const receipt = this.repositoryReceipt(
      principal,
      command.commandId,
      'cancel_matchmaking',
      fingerprint,
      'ticket',
      ticket.id,
      this.clock.nowMs(),
    );
    const stored = await this.repository.saveTicket(cancelled.value, ticket.version, receipt);
    if (!stored.ok) return { ok: false, code: 'conflict', message: 'ticket changed concurrently' };
    return { ok: true, value: { ticket: cancelled.value, replayed: false } };
  }

  async getRating(
    principal: LivePrincipal,
    pool: ChessRatingPool,
  ): Promise<LiveChessResult<{
    readonly rating: ChessRatingState;
    readonly ledger: readonly ChessRatingLedgerEntry[];
  }>> {
    const nowMs = this.clock.nowMs();
    const rating =
      (await this.repository.getRating(principal.tenantId, principal.userId, pool)) ??
      createInitialChessRating(principal.tenantId, principal.userId, pool, nowMs);
    const ledger = await this.repository.listRatingLedger(
      principal.tenantId,
      principal.userId,
      pool,
    );
    return { ok: true, value: { rating, ledger } };
  }

  private async applyRatingUpdate(game: LiveChessGame, nowMs: number): Promise<void> {
    const pool = ratingPoolForTimeControl(game.timeControl.initialMs, game.timeControl.incrementMs);
    const white =
      (await this.repository.getRating(game.tenantId, game.whitePlayerId, pool)) ??
      createInitialChessRating(game.tenantId, game.whitePlayerId, pool, nowMs);
    const black =
      (await this.repository.getRating(game.tenantId, game.blackPlayerId, pool)) ??
      createInitialChessRating(game.tenantId, game.blackPlayerId, pool, nowMs);
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
