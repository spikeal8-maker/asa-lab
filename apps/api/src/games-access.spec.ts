import { describe, expect, it } from 'vitest';
import { evaluateGamesAccess, type GamesPolicySnapshot } from './games-access.js';

const base: GamesPolicySnapshot = {
  eligible: true,
  state: 'active',
  mode: 'allow',
  threshold: null,
  override: 'inherit',
  rating: null,
};
describe('offline game admission evaluator', () => {
  it.each(['chess', 'checkers'])('defaults to allow for %s independently of SafeMode', (game) => {
    for (const safeMode of [false, true]) {
      expect(evaluateGamesAccess(game, { ...base, ...{ safeMode } })).toEqual({
        granted: true,
        reason: 'allowed',
        threshold: null,
      });
    }
  });
  it.each(['allow', 'deny', 'rating_threshold'] as const)(
    'defines all overrides for class %s',
    (mode) => {
      const policy = {
        ...base,
        mode,
        threshold: mode === 'rating_threshold' ? 50 : null,
        rating: 49,
      };
      expect(evaluateGamesAccess('chess', { ...policy, override: 'allow' }).granted).toBe(true);
      expect(evaluateGamesAccess('chess', { ...policy, override: 'deny' }).reason).toBe(
        'seat_disabled',
      );
      expect(evaluateGamesAccess('chess', policy).granted).toBe(mode === 'allow');
    },
  );
  it.each([
    [49.999, false, 'rating_below_threshold'],
    [50, true, 'allowed'],
    [50.001, true, 'allowed'],
    [null, false, 'rating_unavailable'],
    [NaN, false, 'rating_unavailable'],
    [Infinity, false, 'rating_unavailable'],
    [-1, false, 'rating_unavailable'],
  ] as const)('compares current unrounded score %s to threshold', (rating, granted, reason) => {
    expect(
      evaluateGamesAccess('checkers', { ...base, mode: 'rating_threshold', threshold: 50, rating }),
    ).toEqual({ granted, reason, threshold: 50 });
  });
  it.each([0, 100])('admits equality at score boundary %s', (threshold) => {
    expect(
      evaluateGamesAccess('chess', {
        ...base,
        mode: 'rating_threshold',
        threshold,
        rating: threshold,
      }).granted,
    ).toBe(true);
  });
  it.each([null, NaN, Infinity, -1, 101])('denies invalid threshold %s', (threshold) => {
    expect(
      evaluateGamesAccess('chess', { ...base, mode: 'rating_threshold', threshold }).granted,
    ).toBe(false);
  });
  it('never overrides missing authority, inactive identity or revoked policy', () => {
    expect(evaluateGamesAccess('chess', null).granted).toBe(false);
    expect(
      evaluateGamesAccess('chess', { ...base, eligible: false, override: 'allow' }).granted,
    ).toBe(false);
    expect(
      evaluateGamesAccess('chess', { ...base, state: 'revoked', override: 'allow' }).reason,
    ).toBe('policy_revoked');
  });
  it.each(['chess-live', 'chat', 'multiplayer', undefined])('never grants %s', (game) => {
    expect(evaluateGamesAccess(game, { ...base, override: 'allow' }).granted).toBe(false);
  });
});
