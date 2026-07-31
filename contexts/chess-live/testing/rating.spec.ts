import { describe, expect, it } from 'vitest';
import { createLiveChessGame } from '../domain/game';
import {
  ASA_INITIAL_CHESS_RATING,
  calculateChessRatingUpdate,
  chessExpectedScore,
  chessRatingKFactor,
  createInitialChessRating,
  ratingPoolForTimeControl,
} from '../domain/rating';

function finishedRatedGame(result: '1-0' | '0-1' | '1/2-1/2') {
  const created = createLiveChessGame({
    id: 'game:1',
    tenantId: 'tenant:1',
    challengeId: null,
    whitePlayerId: 'user:white',
    blackPlayerId: 'user:black',
    timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    rated: true,
    nowMs: 1_000,
  });
  if (!created.ok) throw new Error(created.message);
  return {
    ...created.value,
    status: 'finished' as const,
    result,
    termination: result === '1/2-1/2' ? ('draw_agreement' as const) : ('resignation' as const),
    winnerId: result === '1-0' ? 'user:white' : result === '0-1' ? 'user:black' : null,
    finishedAtMs: 5_000,
  };
}

describe('ASA Elo v1', () => {
  it('maps controls to independent pools', () => {
    expect(ratingPoolForTimeControl(60_000, 0)).toBe('bullet');
    expect(ratingPoolForTimeControl(180_000, 2_000)).toBe('blitz');
    expect(ratingPoolForTimeControl(600_000, 5_000)).toBe('rapid');
    expect(ratingPoolForTimeControl(1_800_000, 0)).toBe('classical');
    expect(ratingPoolForTimeControl(86_400_000, 0)).toBe('daily');
  });

  it('starts every pool at a transparent provisional 1200', () => {
    expect(createInitialChessRating('tenant:1', 'user:1', 'rapid', 1_000)).toEqual({
      tenantId: 'tenant:1',
      playerId: 'user:1',
      pool: 'rapid',
      rating: ASA_INITIAL_CHESS_RATING,
      games: 0,
      provisional: true,
      updatedAtMs: 1_000,
      algorithm: 'asa-elo-v1',
    });
  });

  it('uses a bounded K factor that falls after provisional games and at high ratings', () => {
    const base = createInitialChessRating('tenant:1', 'user:1', 'rapid', 1_000);
    expect(chessRatingKFactor(base)).toBe(48);
    expect(chessRatingKFactor({ ...base, games: 10, provisional: false })).toBe(32);
    expect(chessRatingKFactor({ ...base, games: 10, provisional: false, rating: 2200 })).toBe(24);
    expect(chessRatingKFactor({ ...base, games: 10, provisional: false, rating: 2500 })).toBe(16);
  });

  it('gives equal players a 50 percent expected score', () => {
    expect(chessExpectedScore(1200, 1200)).toBeCloseTo(0.5, 12);
    expect(chessExpectedScore(1600, 1200)).toBeGreaterThan(0.9);
    expect(chessExpectedScore(1200, 1600)).toBeLessThan(0.1);
  });

  it('updates both ratings and writes immutable ledger entries', () => {
    const white = createInitialChessRating('tenant:1', 'user:white', 'rapid', 1_000);
    const black = createInitialChessRating('tenant:1', 'user:black', 'rapid', 1_000);
    const update = calculateChessRatingUpdate(
      finishedRatedGame('1-0'),
      white,
      black,
      ['rating:1', 'rating:2'],
      5_000,
    );
    expect(update.white).toMatchObject({ rating: 1224, games: 1, provisional: true });
    expect(update.black).toMatchObject({ rating: 1176, games: 1, provisional: true });
    expect(update.ledger).toEqual([
      expect.objectContaining({
        id: 'rating:1',
        playerId: 'user:white',
        opponentId: 'user:black',
        score: 1,
        ratingBefore: 1200,
        ratingAfter: 1224,
        expectedScore: 0.5,
        kFactor: 48,
        delta: 24,
        algorithm: 'asa-elo-v1',
      }),
      expect.objectContaining({
        id: 'rating:2',
        playerId: 'user:black',
        score: 0,
        ratingBefore: 1200,
        ratingAfter: 1176,
        delta: -24,
      }),
    ]);
  });

  it('handles a draw and an upset deterministically', () => {
    const white = {
      ...createInitialChessRating('tenant:1', 'user:white', 'rapid', 1_000),
      rating: 1600,
      games: 20,
      provisional: false,
    };
    const black = {
      ...createInitialChessRating('tenant:1', 'user:black', 'rapid', 1_000),
      rating: 1200,
      games: 20,
      provisional: false,
    };
    const draw = calculateChessRatingUpdate(
      finishedRatedGame('1/2-1/2'),
      white,
      black,
      ['rating:1', 'rating:2'],
      5_000,
    );
    expect(draw.white.rating).toBeLessThan(white.rating);
    expect(draw.black.rating).toBeGreaterThan(black.rating);

    const upset = calculateChessRatingUpdate(
      finishedRatedGame('0-1'),
      white,
      black,
      ['rating:3', 'rating:4'],
      6_000,
    );
    expect(upset.white.rating - white.rating).toBeLessThan(-10);
    expect(upset.black.rating - black.rating).toBeGreaterThan(20);
  });

  it('refuses unrated, unfinished or mismatched rating updates', () => {
    const white = createInitialChessRating('tenant:1', 'user:white', 'rapid', 1_000);
    const black = createInitialChessRating('tenant:1', 'user:black', 'rapid', 1_000);
    expect(() =>
      calculateChessRatingUpdate(
        { ...finishedRatedGame('1-0'), rated: false },
        white,
        black,
        ['rating:1', 'rating:2'],
        5_000,
      ),
    ).toThrow(/unrated/);
    expect(() =>
      calculateChessRatingUpdate(
        { ...finishedRatedGame('1-0'), status: 'active', result: '*' },
        white,
        black,
        ['rating:1', 'rating:2'],
        5_000,
      ),
    ).toThrow(/finished/);
    expect(() =>
      calculateChessRatingUpdate(
        finishedRatedGame('1-0'),
        { ...white, pool: 'blitz' },
        black,
        ['rating:1', 'rating:2'],
        5_000,
      ),
    ).toThrow(/tenant, pool or algorithm/);
  });
});
