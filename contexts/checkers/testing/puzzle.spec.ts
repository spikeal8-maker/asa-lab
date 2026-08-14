import { describe, expect, it } from 'vitest';
import type { CheckersDocument, CheckersPiece } from '../domain/document';
import {
  createCheckersPuzzleAttempt,
  requestCheckersPuzzleHint,
  submitCheckersPuzzleMove,
  validateCheckersPuzzle,
  type CheckersPuzzle,
} from '../domain/puzzle';

const pieces: readonly CheckersPiece[] = [
  { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
  { id: 'light-h2', side: 'light', kind: 'man', square: 'h2' },
  { id: 'dark-d4', side: 'dark', kind: 'man', square: 'd4' },
  { id: 'dark-g3', side: 'dark', kind: 'man', square: 'g3' },
  { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
];

const initialDocument: CheckersDocument = {
  schemaVersion: 1,
  ruleset: 'russian-64',
  mode: 'lesson',
  sideToMove: 'light',
  pieces,
  moveHistory: [],
  result: '*',
};

const puzzle: CheckersPuzzle = {
  id: 'puzzle-capture-choice',
  title: 'Выбери полезное взятие',
  instruction: 'Найди взятие, после которого шашка окажется ближе к превращению.',
  initialDocument,
  conceptIds: ['mandatory-capture', 'promotion-races'],
  expectedLines: [[{ pieceId: 'light-c3', path: ['c3', 'e5'] }]],
  hints: [
    'Взятие обязательно.',
    'Посмотри на шашки c3 и h2.',
    'Сравни, на какой горизонтали закончится ход.',
    'Начни шашкой с поля c3.',
    'Сыграй c3:e5 — эта шашка ближе к последней горизонтали.',
  ],
};

describe('interactive Checkers puzzles', () => {
  it('validates every authored expected move against the official engine', () => {
    expect(validateCheckersPuzzle(puzzle)).toEqual({ ok: true, value: puzzle });
    expect(
      validateCheckersPuzzle({
        ...puzzle,
        expectedLines: [[{ pieceId: 'light-c3', path: ['c3', 'd4'] }]],
      }),
    ).toEqual({
      ok: false,
      message:
        'puzzle expectedLines[0][0] is illegal: the requested move is not legal in this position',
    });
  });

  it('keeps a legal but pedagogically wrong move retryable', () => {
    const created = createCheckersPuzzleAttempt(puzzle, 'attempt-1', 'student-1');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = submitCheckersPuzzleMove(puzzle, created.value, {
      pieceId: 'light-h2',
      path: ['h2', 'f4'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      feedback: 'incorrect',
      attempt: { incorrectAttempts: 1, currentStep: 0, status: 'active' },
    });
    expect(result.value.attempt.document).toEqual(initialDocument);
  });

  it('distinguishes illegal input and records a solved expected line', () => {
    const created = createCheckersPuzzleAttempt(puzzle, 'attempt-1', 'student-1');
    if (!created.ok) return;
    const illegal = submitCheckersPuzzleMove(puzzle, created.value, {
      pieceId: 'light-c3',
      path: ['c3', 'd4'],
    });
    expect(illegal.ok && illegal.value.feedback).toBe('illegal');

    const solved = submitCheckersPuzzleMove(puzzle, created.value, {
      pieceId: 'light-c3',
      path: ['c3', 'e5'],
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.value).toMatchObject({
      feedback: 'solved',
      conceptIds: ['mandatory-capture', 'promotion-races'],
      attempt: { currentStep: 1, status: 'solved' },
    });
  });

  it('reveals the five-step hint ladder without exceeding its evidence level', () => {
    const created = createCheckersPuzzleAttempt(puzzle, 'attempt-1', 'student-1');
    if (!created.ok) return;
    let attempt = created.value;
    const hints: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const result = requestCheckersPuzzleHint(puzzle, attempt);
      if (!result.ok) return;
      attempt = result.value.attempt;
      hints.push(result.value.hint);
    }
    expect(attempt.hintLevel).toBe(5);
    expect(hints.slice(0, 5)).toEqual(puzzle.hints);
    expect(hints.at(-1)).toBe(puzzle.hints[4]);
  });
});
