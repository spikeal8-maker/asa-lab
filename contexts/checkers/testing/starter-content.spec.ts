import { describe, expect, it } from 'vitest';
import { validateCheckersPuzzle } from '../domain/puzzle';
import { CHECKERS_STARTER_PUZZLES } from '../domain/starter-content';

describe('original ASA Checkers starter content', () => {
  it('contains distinct, engine-valid lessons with five safe hints each', () => {
    expect(CHECKERS_STARTER_PUZZLES).toHaveLength(4);
    expect(new Set(CHECKERS_STARTER_PUZZLES.map((puzzle) => puzzle.id)).size).toBe(4);
    for (const puzzle of CHECKERS_STARTER_PUZZLES) {
      expect(validateCheckersPuzzle(puzzle)).toEqual({ ok: true, value: puzzle });
      expect(puzzle.hints).toHaveLength(5);
    }
  });
});
