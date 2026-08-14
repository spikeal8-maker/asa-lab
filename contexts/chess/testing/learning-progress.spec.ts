import { describe, expect, it } from 'vitest';
import { ASA_CHESS_LESSONS, ASA_CHESS_PUZZLES } from '../domain/learning-catalog';
import {
  chessLearningAttempt,
  createEmptyChessLearningProgress,
  recommendChessLesson,
  recordChessPuzzleHint,
  recordChessPuzzleMove,
  selectChessLearningPuzzle,
  solvedChessPuzzleCount,
  validateChessLearningProgress,
} from '../domain/learning-progress';

const mate = ASA_CHESS_PUZZLES[0]!;

describe('project-local Chess learning evidence', () => {
  it('records an idempotent hint, legal mistake and solve as a replayable event prefix', () => {
    let progress = createEmptyChessLearningProgress();
    const hint = recordChessPuzzleHint(progress, mate, 'hint-1');
    expect(hint).toMatchObject({ ok: true, value: { level: 1, replayed: false } });
    if (!hint.ok) return;
    progress = hint.value.progress;

    const duplicate = recordChessPuzzleHint(progress, mate, 'hint-1');
    expect(duplicate).toMatchObject({ ok: true, value: { replayed: true } });
    if (!duplicate.ok) return;
    expect(duplicate.value.progress).toEqual(progress);

    const wrong = recordChessPuzzleMove(progress, mate, 'move-1', 'f7f1');
    expect(wrong).toMatchObject({ ok: true, value: { outcome: 'incorrect' } });
    if (!wrong.ok) return;
    progress = wrong.value.progress;
    const solved = recordChessPuzzleMove(progress, mate, 'move-2', 'f7g7');
    expect(solved).toMatchObject({ ok: true, value: { outcome: 'solved' } });
    if (!solved.ok) return;
    progress = solved.value.progress;

    expect(chessLearningAttempt(progress, mate)).toMatchObject({
      status: 'solved',
      attempts: 2,
      mistakes: 1,
      hintsUsed: 1,
    });
    expect(progress.rating).toEqual({
      formulaVersion: 'asa-puzzle-rating-v1',
      current: 416,
      evidence: [
        expect.objectContaining({
          puzzleId: mate.id,
          attempts: 2,
          mistakes: 1,
          hintsUsed: 1,
          delta: 16,
        }),
      ],
    });
    expect(
      validateChessLearningProgress(JSON.parse(JSON.stringify(progress)), ASA_CHESS_PUZZLES),
    ).toEqual({
      ok: true,
      value: progress,
    });
    expect(solvedChessPuzzleCount(progress)).toBe(1);
  });

  it('rejects operation collisions, forged counters, unknown puzzles and illegal moves', () => {
    const first = recordChessPuzzleHint(createEmptyChessLearningProgress(), mate, 'same-operation');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(recordChessPuzzleMove(first.value.progress, mate, 'same-operation', 'f7g7')).toEqual({
      ok: false,
      message: 'Learning operationId was reused with another payload.',
    });
    expect(recordChessPuzzleMove(first.value.progress, mate, 'illegal', 'a1a2')).toEqual({
      ok: false,
      message: 'Illegal puzzle move.',
    });
    const forged = {
      ...first.value.progress,
      attempts: {
        ...first.value.progress.attempts,
        [mate.id]: { ...first.value.progress.attempts[mate.id]!, hintsUsed: 99 },
      },
    };
    expect(validateChessLearningProgress(forged, ASA_CHESS_PUZZLES)).toEqual({
      ok: false,
      message: `Learning attempt ${mate.id} does not match its event replay.`,
    });
    expect(
      validateChessLearningProgress(
        {
          ...first.value.progress,
          rating: { ...first.value.progress.rating, current: 9999 },
        },
        ASA_CHESS_PUZZLES,
      ),
    ).toEqual({ ok: false, message: 'Learning rating does not match verified puzzle evidence.' });
    expect(
      validateChessLearningProgress(
        {
          schemaVersion: 1,
          activePuzzleId: null,
          attempts: { unknown: { puzzleId: 'unknown' } },
          rating: createEmptyChessLearningProgress().rating,
        },
        ASA_CHESS_PUZZLES,
      ),
    ).toEqual({ ok: false, message: 'Unknown learning puzzle: unknown.' });
  });

  it('pins the selected project-local puzzle to a trusted catalogue id', () => {
    const selected = selectChessLearningPuzzle(
      createEmptyChessLearningProgress(),
      mate.id,
      ASA_CHESS_PUZZLES,
    );
    expect(selected).toMatchObject({ ok: true, value: { activePuzzleId: mate.id } });
    expect(
      selectChessLearningPuzzle(createEmptyChessLearningProgress(), 'unknown', ASA_CHESS_PUZZLES),
    ).toEqual({ ok: false, message: 'Unknown learning puzzle: unknown.' });
  });

  it('recommends an original lesson deterministically only after verified solution evidence', () => {
    expect(
      recommendChessLesson(
        createEmptyChessLearningProgress(),
        ASA_CHESS_PUZZLES,
        ASA_CHESS_LESSONS,
      ),
    ).toBeNull();
    const solved = recordChessPuzzleMove(createEmptyChessLearningProgress(), mate, 'solve', 'f7g7');
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(
      recommendChessLesson(solved.value.progress, ASA_CHESS_PUZZLES, ASA_CHESS_LESSONS),
    ).toMatchObject({
      id: 'asa-lesson-mating-net',
      provenance: { kind: 'asa_original', license: 'ASA-Lab-Original' },
    });
  });
});
