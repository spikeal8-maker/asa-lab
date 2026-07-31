import type {
  ChessRatingLedgerEntry,
  ChessRatingPool,
  ChessRatingState,
} from '../domain/rating.js';
import type { MatchmakingTicket } from '../domain/matchmaking.js';
import type {
  LiveChessChallenge,
  LiveChessEvent,
  LiveChessGame,
  LiveChessResult,
} from '../domain/model.js';

export interface LiveClockPort {
  nowMs(): number;
}

export interface LiveIdPort {
  nextId(prefix: 'challenge' | 'game' | 'event' | 'ticket' | 'rating'): string;
  nextPublicCode(): string;
  randomBit(): 0 | 1;
}

export interface LiveCommandReceipt {
  readonly tenantId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly resourceType: 'challenge' | 'game' | 'ticket';
  readonly resourceId: string;
  readonly createdAtMs: number;
}

export type RepositoryWriteResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'conflict' | 'duplicate' };

export interface ChessLiveRepositoryPort {
  findCommandReceipt(tenantId: string, commandId: string): Promise<LiveCommandReceipt | null>;
  saveCommandReceipt(receipt: LiveCommandReceipt): Promise<RepositoryWriteResult>;

  createChallenge(
    challenge: LiveChessChallenge,
    event: LiveChessEvent,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult>;
  getChallengeById(tenantId: string, challengeId: string): Promise<LiveChessChallenge | null>;
  getChallengeByCode(tenantId: string, publicCode: string): Promise<LiveChessChallenge | null>;
  saveChallenge(
    challenge: LiveChessChallenge,
    expectedVersion: number,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult>;
  acceptChallengeAndCreateGame(
    challenge: LiveChessChallenge,
    expectedChallengeVersion: number,
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult>;

  createGame(
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
  ): Promise<RepositoryWriteResult>;
  getGame(tenantId: string, gameId: string): Promise<LiveChessGame | null>;
  saveGame(
    game: LiveChessGame,
    expectedVersion: number,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult>;
  listGameEvents(
    tenantId: string,
    gameId: string,
    afterSequence: number,
    visibleBeforeOrAtMs?: number,
  ): Promise<readonly LiveChessEvent[]>;

  createTicket(
    ticket: MatchmakingTicket,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult>;
  getTicket(tenantId: string, ticketId: string): Promise<MatchmakingTicket | null>;
  listQueuedTickets(tenantId: string): Promise<readonly MatchmakingTicket[]>;
  saveTicket(
    ticket: MatchmakingTicket,
    expectedVersion: number,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult>;
  pairTicketsAndCreateGame(
    whiteTicket: MatchmakingTicket,
    expectedWhiteVersion: number,
    blackTicket: MatchmakingTicket,
    expectedBlackVersion: number,
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
  ): Promise<RepositoryWriteResult>;

  getRating(
    tenantId: string,
    playerId: string,
    pool: ChessRatingPool,
  ): Promise<ChessRatingState | null>;
  saveRatingUpdate(
    gameId: string,
    white: ChessRatingState,
    black: ChessRatingState,
    ledger: readonly [ChessRatingLedgerEntry, ChessRatingLedgerEntry],
  ): Promise<RepositoryWriteResult>;
  listRatingLedger(
    tenantId: string,
    playerId: string,
    pool: ChessRatingPool,
  ): Promise<readonly ChessRatingLedgerEntry[]>;
}

export function repositoryConflict(message: string): LiveChessResult<never> {
  return { ok: false, code: 'conflict', message };
}
