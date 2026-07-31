import type {
  ChessRatingLedgerEntry,
  ChessRatingPool,
  ChessRatingState,
} from '../domain/rating.js';
import type { MatchmakingTicket } from '../domain/matchmaking.js';
import type { LiveChessChallenge, LiveChessEvent, LiveChessGame } from '../domain/model.js';
import type {
  ChessLiveRepositoryPort,
  LiveCommandReceipt,
  RepositoryWriteResult,
} from '../application/ports.js';

function key(...parts: readonly string[]): string {
  return parts.join('|');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryChessLiveRepository implements ChessLiveRepositoryPort {
  private readonly receipts = new Map<string, LiveCommandReceipt>();
  private readonly challenges = new Map<string, LiveChessChallenge>();
  private readonly challengeByCode = new Map<string, string>();
  private readonly games = new Map<string, LiveChessGame>();
  private readonly events = new Map<string, LiveChessEvent[]>();
  private readonly challengeEvents = new Map<string, LiveChessEvent[]>();
  private readonly tickets = new Map<string, MatchmakingTicket>();
  private readonly ratings = new Map<string, ChessRatingState>();
  private readonly ratingLedger: ChessRatingLedgerEntry[] = [];
  private readonly ratedGames = new Set<string>();

  async findCommandReceipt(
    tenantId: string,
    commandId: string,
  ): Promise<LiveCommandReceipt | null> {
    const value = this.receipts.get(key(tenantId, commandId));
    return value ? clone(value) : null;
  }

  async saveCommandReceipt(receipt: LiveCommandReceipt): Promise<RepositoryWriteResult> {
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (this.receipts.has(receiptKey)) return { ok: false, reason: 'duplicate' };
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async createChallenge(
    challenge: LiveChessChallenge,
    event: LiveChessEvent,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    const challengeKey = key(challenge.tenantId, challenge.id);
    const codeKey = key(challenge.tenantId, challenge.publicCode);
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (
      this.challenges.has(challengeKey) ||
      this.challengeByCode.has(codeKey) ||
      this.receipts.has(receiptKey)
    ) {
      return { ok: false, reason: 'duplicate' };
    }
    this.challenges.set(challengeKey, clone(challenge));
    this.challengeByCode.set(codeKey, challenge.id);
    this.challengeEvents.set(challengeKey, [clone(event)]);
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async getChallengeById(
    tenantId: string,
    challengeId: string,
  ): Promise<LiveChessChallenge | null> {
    const value = this.challenges.get(key(tenantId, challengeId));
    return value ? clone(value) : null;
  }

  async getChallengeByCode(
    tenantId: string,
    publicCode: string,
  ): Promise<LiveChessChallenge | null> {
    const id = this.challengeByCode.get(key(tenantId, publicCode));
    return id ? this.getChallengeById(tenantId, id) : null;
  }

  async saveChallenge(
    challenge: LiveChessChallenge,
    expectedVersion: number,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    const challengeKey = key(challenge.tenantId, challenge.id);
    const current = this.challenges.get(challengeKey);
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (!current || current.version !== expectedVersion) return { ok: false, reason: 'conflict' };
    if (this.receipts.has(receiptKey)) return { ok: false, reason: 'duplicate' };
    this.challenges.set(challengeKey, clone(challenge));
    const currentEvents = this.challengeEvents.get(challengeKey) ?? [];
    this.challengeEvents.set(challengeKey, [...currentEvents, ...events.map(clone)]);
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async acceptChallengeAndCreateGame(
    challenge: LiveChessChallenge,
    expectedChallengeVersion: number,
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    const challengeKey = key(challenge.tenantId, challenge.id);
    const gameKey = key(game.tenantId, game.id);
    const current = this.challenges.get(challengeKey);
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (!current || current.version !== expectedChallengeVersion) {
      return { ok: false, reason: 'conflict' };
    }
    if (this.games.has(gameKey) || this.receipts.has(receiptKey)) {
      return { ok: false, reason: 'duplicate' };
    }
    this.challenges.set(challengeKey, clone(challenge));
    this.games.set(gameKey, clone(game));
    this.events.set(gameKey, events.map(clone));
    const challengeEvent = events.find((event) => event.type === 'challenge_accepted');
    if (challengeEvent) {
      const currentEvents = this.challengeEvents.get(challengeKey) ?? [];
      this.challengeEvents.set(challengeKey, [...currentEvents, clone(challengeEvent)]);
    }
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async createGame(
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
  ): Promise<RepositoryWriteResult> {
    const gameKey = key(game.tenantId, game.id);
    if (this.games.has(gameKey)) return { ok: false, reason: 'duplicate' };
    this.games.set(gameKey, clone(game));
    this.events.set(gameKey, events.map(clone));
    return { ok: true };
  }

  async getGame(tenantId: string, gameId: string): Promise<LiveChessGame | null> {
    const value = this.games.get(key(tenantId, gameId));
    return value ? clone(value) : null;
  }

  async saveGame(
    game: LiveChessGame,
    expectedVersion: number,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    const gameKey = key(game.tenantId, game.id);
    const current = this.games.get(gameKey);
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (!current || current.version !== expectedVersion) return { ok: false, reason: 'conflict' };
    if (this.receipts.has(receiptKey)) return { ok: false, reason: 'duplicate' };
    this.games.set(gameKey, clone(game));
    const currentEvents = this.events.get(gameKey) ?? [];
    this.events.set(gameKey, [...currentEvents, ...events.map(clone)]);
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async listGameEvents(
    tenantId: string,
    gameId: string,
    afterSequence: number,
    visibleBeforeOrAtMs?: number,
  ): Promise<readonly LiveChessEvent[]> {
    return (this.events.get(key(tenantId, gameId)) ?? [])
      .filter(
        (event) =>
          event.sequence > afterSequence &&
          (visibleBeforeOrAtMs === undefined || event.createdAtMs <= visibleBeforeOrAtMs),
      )
      .map(clone);
  }

  async createTicket(
    ticket: MatchmakingTicket,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    const ticketKey = key(ticket.tenantId, ticket.id);
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (this.tickets.has(ticketKey) || this.receipts.has(receiptKey)) {
      return { ok: false, reason: 'duplicate' };
    }
    const duplicateQueued = [...this.tickets.values()].some(
      (existing) =>
        existing.tenantId === ticket.tenantId &&
        existing.playerId === ticket.playerId &&
        existing.status === 'queued',
    );
    if (duplicateQueued) return { ok: false, reason: 'conflict' };
    this.tickets.set(ticketKey, clone(ticket));
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async getTicket(tenantId: string, ticketId: string): Promise<MatchmakingTicket | null> {
    const value = this.tickets.get(key(tenantId, ticketId));
    return value ? clone(value) : null;
  }

  async listQueuedTickets(tenantId: string): Promise<readonly MatchmakingTicket[]> {
    return [...this.tickets.values()]
      .filter((ticket) => ticket.tenantId === tenantId && ticket.status === 'queued')
      .map(clone);
  }

  async saveTicket(
    ticket: MatchmakingTicket,
    expectedVersion: number,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    const ticketKey = key(ticket.tenantId, ticket.id);
    const current = this.tickets.get(ticketKey);
    const receiptKey = key(receipt.tenantId, receipt.commandId);
    if (!current || current.version !== expectedVersion) return { ok: false, reason: 'conflict' };
    if (this.receipts.has(receiptKey)) return { ok: false, reason: 'duplicate' };
    this.tickets.set(ticketKey, clone(ticket));
    this.receipts.set(receiptKey, clone(receipt));
    return { ok: true };
  }

  async pairTicketsAndCreateGame(
    whiteTicket: MatchmakingTicket,
    expectedWhiteVersion: number,
    blackTicket: MatchmakingTicket,
    expectedBlackVersion: number,
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
  ): Promise<RepositoryWriteResult> {
    const whiteKey = key(whiteTicket.tenantId, whiteTicket.id);
    const blackKey = key(blackTicket.tenantId, blackTicket.id);
    const gameKey = key(game.tenantId, game.id);
    const whiteCurrent = this.tickets.get(whiteKey);
    const blackCurrent = this.tickets.get(blackKey);
    if (
      !whiteCurrent ||
      !blackCurrent ||
      whiteCurrent.version !== expectedWhiteVersion ||
      blackCurrent.version !== expectedBlackVersion
    ) {
      return { ok: false, reason: 'conflict' };
    }
    if (this.games.has(gameKey)) return { ok: false, reason: 'duplicate' };
    this.tickets.set(whiteKey, clone(whiteTicket));
    this.tickets.set(blackKey, clone(blackTicket));
    this.games.set(gameKey, clone(game));
    this.events.set(gameKey, events.map(clone));
    return { ok: true };
  }

  async getRating(
    tenantId: string,
    playerId: string,
    pool: ChessRatingPool,
  ): Promise<ChessRatingState | null> {
    const value = this.ratings.get(key(tenantId, playerId, pool));
    return value ? clone(value) : null;
  }

  async saveRatingUpdate(
    gameId: string,
    white: ChessRatingState,
    black: ChessRatingState,
    ledger: readonly [ChessRatingLedgerEntry, ChessRatingLedgerEntry],
  ): Promise<RepositoryWriteResult> {
    const gameKey = key(white.tenantId, gameId);
    if (this.ratedGames.has(gameKey)) return { ok: false, reason: 'duplicate' };
    this.ratedGames.add(gameKey);
    this.ratings.set(key(white.tenantId, white.playerId, white.pool), clone(white));
    this.ratings.set(key(black.tenantId, black.playerId, black.pool), clone(black));
    this.ratingLedger.push(...ledger.map(clone));
    return { ok: true };
  }

  async listRatingLedger(
    tenantId: string,
    playerId: string,
    pool: ChessRatingPool,
  ): Promise<readonly ChessRatingLedgerEntry[]> {
    return this.ratingLedger
      .filter(
        (entry) =>
          entry.tenantId === tenantId && entry.playerId === playerId && entry.pool === pool,
      )
      .sort(
        (left, right) => right.createdAtMs - left.createdAtMs || right.id.localeCompare(left.id),
      )
      .map(clone);
  }

  /** Test/owner evidence helper; never expose this as a production API. */
  dump(): {
    readonly challenges: readonly LiveChessChallenge[];
    readonly games: readonly LiveChessGame[];
    readonly tickets: readonly MatchmakingTicket[];
    readonly events: readonly LiveChessEvent[];
    readonly ratings: readonly ChessRatingState[];
  } {
    return {
      challenges: [...this.challenges.values()].map(clone),
      games: [...this.games.values()].map(clone),
      tickets: [...this.tickets.values()].map(clone),
      events: [...this.events.values()].flat().map(clone),
      ratings: [...this.ratings.values()].map(clone),
    };
  }
}
