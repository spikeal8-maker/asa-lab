import { describe, expect, it } from 'vitest';
import {
  ASA_CHESS_LESSONS,
  ASA_CHESS_PUZZLES,
  createEmptyChessLearningProgress,
  recommendChessLesson,
  recordChessPuzzleHint,
  recordChessPuzzleMove,
  solvedChessPuzzleCount,
} from '../../contexts/chess/index';

describe('Chess learning UI view model', () => {
  it('moves from 0/3 to 1/3 and exposes the trusted mate lesson', () => {
    const puzzle = ASA_CHESS_PUZZLES[0]!;
    expect(solvedChessPuzzleCount(createEmptyChessLearningProgress())).toBe(0);
    const hint = recordChessPuzzleHint(createEmptyChessLearningProgress(), puzzle, 'hint-ui');
    expect(hint.ok).toBe(true);
    if (!hint.ok) return;
    const wrong = recordChessPuzzleMove(hint.value.progress, puzzle, 'wrong-ui', 'f7f1');
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) return;
    const solved = recordChessPuzzleMove(wrong.value.progress, puzzle, 'solve-ui', 'f7g7');
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solvedChessPuzzleCount(solved.value.progress)).toBe(1);
    expect(solved.value.attempt).toMatchObject({ attempts: 2, mistakes: 1, hintsUsed: 1 });
    expect(solved.value.progress.rating).toMatchObject({
      formulaVersion: 'asa-puzzle-rating-v1',
      current: 416,
    });
    expect(
      recommendChessLesson(solved.value.progress, ASA_CHESS_PUZZLES, ASA_CHESS_LESSONS)?.title,
    ).toBe('Как построить матовую сеть');
  });
});
