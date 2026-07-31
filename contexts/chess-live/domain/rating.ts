import type { ChessResult } from '@asa-lab/chess';
import type { LiveChessGame } from './model.js';

export type ChessRatingPool = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';

export interface ChessRatingState {
  readonly tenantId: string;
  readonly playerId: string;
  readonly pool: ChessRatingPool;
  readonly rating: number;
  readonly games: number;
  readonly provisional: boolean;
  readonly updatedAtMs: number;
  readonly algorithm: 'asa-elo-v1';
}

export interface ChessRatingLedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly gameId: string;
  readonly pool: ChessRatingPool;
  readonly playerId: string;
  readonly opponentId: string;
  readonly result: ChessResult;
  readonly score: 0 | 0.5 | 1;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly opponentRatingBefore: number;
  readonly expectedScore: number;
  readonly kFactor: number;
  readonly delta: number;
  readonly gamesAfter: number;
  readonly provisionalAfter: boolean;
  readonly createdAtMs: number;
  readonly algorithm: 'asa-elo-v1';
}

export interface ChessRatingUpdate {
  readonly white: ChessRatingState;
  readonly black: ChessRatingState;
  readonly ledger: readonly [ChessRatingLedgerEntry, ChessRatingLedgerEntry];
}

export const ASA_INITIAL_CHESS_RATING = 1200;
export const ASA_PROVISIONAL_GAMES = 10;

export function ratingPoolForTimeControl(initialMs: number, incrementMs: number): ChessRatingPool {
  const estimatedGameSeconds = initialMs / 1000 + (incrementMs / 1000) * 40;
  if (estimatedGameSeconds < 180) return 'bullet';
  if (estimatedGameSeconds < 600) return 'blitz';
  if (estimatedGameSeconds < 1800) return 'rapid';
  if (estimatedGameSeconds < 24 * 60 * 60) return 'classical';
  return 'daily';
}

export function createInitialChessRating(
  tenantId: string,
  playerId: string,
  pool: ChessRatingPool,
  nowMs: number,
): ChessRatingState {
  return {
    tenantId,
    playerId,
    pool,
    rating: ASA_INITIAL_CHESS_RATING,
    games: 0,
    provisional: true,
    updatedAtMs: nowMs,
    algorithm: 'asa-elo-v1',
  };
}

export function chessExpectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function chessRatingKFactor(state: ChessRatingState): number {
  if (state.games < ASA_PROVISIONAL_GAMES) return 48;
  if (state.rating < 2100) return 32;
  if (state.rating < 2400) return 24;
  return 16;
}

function whiteScore(result: ChessResult): 0 | 0.5 | 1 {
  if (result === '1-0') return 1;
  if (result === '0-1') return 0;
  if (result === '1/2-1/2') return 0.5;
  throw new Error('unfinished game cannot update ratings');
}

function boundedRating(value: number): number {
  return Math.max(100, Math.min(4000, Math.round(value)));
}

export function calculateChessRatingUpdate(
  game: LiveChessGame,
  whiteBefore: ChessRatingState,
  blackBefore: ChessRatingState,
  ledgerIds: readonly [string, string],
  nowMs: number,
): ChessRatingUpdate {
  if (!game.rated) throw new Error('unrated game cannot update ratings');
  if (game.status !== 'finished' || game.result === '*') {
    throw new Error('only a finished game can update ratings');
  }
  const pool = ratingPoolForTimeControl(game.timeControl.initialMs, game.timeControl.incrementMs);
  for (const state of [whiteBefore, blackBefore]) {
    if (
      state.tenantId !== game.tenantId ||
      state.pool !== pool ||
      state.algorithm !== 'asa-elo-v1'
    ) {
      throw new Error('rating state does not match game tenant, pool or algorithm');
    }
  }
  if (whiteBefore.playerId !== game.whitePlayerId || blackBefore.playerId !== game.blackPlayerId) {
    throw new Error('rating players do not match game colors');
  }

  const whiteActual = whiteScore(game.result);
  const blackActual = (1 - whiteActual) as 0 | 0.5 | 1;
  const whiteExpected = chessExpectedScore(whiteBefore.rating, blackBefore.rating);
  const blackExpected = 1 - whiteExpected;
  const whiteK = chessRatingKFactor(whiteBefore);
  const blackK = chessRatingKFactor(blackBefore);
  const whiteDelta = Math.round(whiteK * (whiteActual - whiteExpected));
  const blackDelta = Math.round(blackK * (blackActual - blackExpected));
  const whiteGames = whiteBefore.games + 1;
  const blackGames = blackBefore.games + 1;
  const white: ChessRatingState = {
    ...whiteBefore,
    rating: boundedRating(whiteBefore.rating + whiteDelta),
    games: whiteGames,
    provisional: whiteGames < ASA_PROVISIONAL_GAMES,
    updatedAtMs: nowMs,
  };
  const black: ChessRatingState = {
    ...blackBefore,
    rating: boundedRating(blackBefore.rating + blackDelta),
    games: blackGames,
    provisional: blackGames < ASA_PROVISIONAL_GAMES,
    updatedAtMs: nowMs,
  };

  return {
    white,
    black,
    ledger: [
      {
        id: ledgerIds[0],
        tenantId: game.tenantId,
        gameId: game.id,
        pool,
        playerId: whiteBefore.playerId,
        opponentId: blackBefore.playerId,
        result: game.result,
        score: whiteActual,
        ratingBefore: whiteBefore.rating,
        ratingAfter: white.rating,
        opponentRatingBefore: blackBefore.rating,
        expectedScore: whiteExpected,
        kFactor: whiteK,
        delta: white.rating - whiteBefore.rating,
        gamesAfter: whiteGames,
        provisionalAfter: white.provisional,
        createdAtMs: nowMs,
        algorithm: 'asa-elo-v1',
      },
      {
        id: ledgerIds[1],
        tenantId: game.tenantId,
        gameId: game.id,
        pool,
        playerId: blackBefore.playerId,
        opponentId: whiteBefore.playerId,
        result: game.result,
        score: blackActual,
        ratingBefore: blackBefore.rating,
        ratingAfter: black.rating,
        opponentRatingBefore: whiteBefore.rating,
        expectedScore: blackExpected,
        kFactor: blackK,
        delta: black.rating - blackBefore.rating,
        gamesAfter: blackGames,
        provisionalAfter: black.provisional,
        createdAtMs: nowMs,
        algorithm: 'asa-elo-v1',
      },
    ],
  };
}
