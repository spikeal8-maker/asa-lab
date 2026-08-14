import type { CheckersConceptId } from './learning.js';
import {
  validateCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
} from './document.js';
import { applyCheckersMove, generateLegalCheckersMoves, type CheckersMoveInput } from './rules.js';

export interface CheckersPuzzle {
  readonly id: string;
  readonly title: string;
  readonly instruction: string;
  readonly initialDocument: CheckersDocument;
  readonly conceptIds: readonly CheckersConceptId[];
  readonly expectedLines: readonly (readonly CheckersMoveInput[])[];
  readonly hints: readonly [string, string, string, string, string];
}

export interface CheckersPuzzleAttempt {
  readonly id: string;
  readonly puzzleId: string;
  readonly studentId: string;
  readonly document: CheckersDocument;
  readonly currentStep: number;
  readonly candidateLineIndexes: readonly number[];
  readonly incorrectAttempts: number;
  readonly hintLevel: 0 | 1 | 2 | 3 | 4 | 5;
  readonly status: 'active' | 'solved';
}

export interface CheckersPuzzleMoveOutcome {
  readonly attempt: CheckersPuzzleAttempt;
  readonly feedback: 'illegal' | 'incorrect' | 'correct' | 'solved';
  readonly conceptIds: readonly CheckersConceptId[];
}

export interface CheckersPuzzleHintOutcome {
  readonly attempt: CheckersPuzzleAttempt;
  readonly hint: string;
}

function sameMove(left: CheckersMoveInput, right: CheckersMoveInput): boolean {
  return (
    left.pieceId === right.pieceId &&
    left.path.length === right.path.length &&
    left.path.every((square, index) => square === right.path[index])
  );
}

function lineKey(line: readonly CheckersMoveInput[]): string {
  return line.map((move) => `${move.pieceId}:${move.path.join(':')}`).join('|');
}

function isPrefix(
  shorter: readonly CheckersMoveInput[],
  longer: readonly CheckersMoveInput[],
): boolean {
  return (
    shorter.length < longer.length && shorter.every((move, index) => sameMove(move, longer[index]!))
  );
}

export function validateCheckersPuzzle(
  puzzle: CheckersPuzzle,
): CheckersDocumentResult<CheckersPuzzle> {
  if (!puzzle.id || !puzzle.title.trim() || !puzzle.instruction.trim()) {
    return { ok: false, message: 'puzzle id, title and instruction must be non-empty' };
  }
  const initial = validateCheckersDocument(puzzle.initialDocument);
  if (!initial.ok) return initial;
  if (puzzle.initialDocument.result !== '*') {
    return { ok: false, message: 'puzzle initial position must be ongoing' };
  }
  if (
    puzzle.conceptIds.length === 0 ||
    new Set(puzzle.conceptIds).size !== puzzle.conceptIds.length
  ) {
    return { ok: false, message: 'puzzle must reference unique learning concepts' };
  }
  if (puzzle.expectedLines.length === 0 || puzzle.expectedLines.some((line) => line.length === 0)) {
    return { ok: false, message: 'puzzle must contain non-empty expected lines' };
  }
  const keys = puzzle.expectedLines.map(lineKey);
  if (new Set(keys).size !== keys.length) {
    return { ok: false, message: 'puzzle expected lines must be unique' };
  }
  for (const [lineIndex, line] of puzzle.expectedLines.entries()) {
    if (
      puzzle.expectedLines.some(
        (candidate, candidateIndex) => candidateIndex !== lineIndex && isPrefix(line, candidate),
      )
    ) {
      return { ok: false, message: 'one puzzle expected line cannot be a prefix of another' };
    }
    let document = puzzle.initialDocument;
    for (const [moveIndex, move] of line.entries()) {
      const applied = applyCheckersMove(document, move);
      if (!applied.ok) {
        return {
          ok: false,
          message: `puzzle expectedLines[${lineIndex}][${moveIndex}] is illegal: ${applied.message}`,
        };
      }
      document = applied.value;
    }
  }
  if (puzzle.hints.some((hint) => !hint.trim() || hint.length > 240)) {
    return { ok: false, message: 'all five puzzle hints must contain 1 to 240 characters' };
  }
  return { ok: true, value: puzzle };
}

export function createCheckersPuzzleAttempt(
  puzzle: CheckersPuzzle,
  id: string,
  studentId: string,
): CheckersDocumentResult<CheckersPuzzleAttempt> {
  const validated = validateCheckersPuzzle(puzzle);
  if (!validated.ok) return validated;
  if (!id || !studentId) return { ok: false, message: 'attempt and student ids must be non-empty' };
  return {
    ok: true,
    value: {
      id,
      puzzleId: puzzle.id,
      studentId,
      document: structuredClone(puzzle.initialDocument),
      currentStep: 0,
      candidateLineIndexes: puzzle.expectedLines.map((_, index) => index),
      incorrectAttempts: 0,
      hintLevel: 0,
      status: 'active',
    },
  };
}

export function submitCheckersPuzzleMove(
  puzzle: CheckersPuzzle,
  attempt: CheckersPuzzleAttempt,
  move: CheckersMoveInput,
): CheckersDocumentResult<CheckersPuzzleMoveOutcome> {
  if (attempt.puzzleId !== puzzle.id) {
    return { ok: false, message: 'puzzle attempt belongs to another puzzle' };
  }
  if (attempt.status !== 'active') {
    return { ok: false, message: 'puzzle attempt is already solved' };
  }

  const legal = generateLegalCheckersMoves(attempt.document).some((candidate) =>
    sameMove(candidate, move),
  );
  if (!legal) {
    return {
      ok: true,
      value: { attempt, feedback: 'illegal', conceptIds: puzzle.conceptIds },
    };
  }

  const candidates = attempt.candidateLineIndexes.filter((lineIndex) => {
    const expected = puzzle.expectedLines[lineIndex]?.[attempt.currentStep];
    return expected ? sameMove(expected, move) : false;
  });
  if (candidates.length === 0) {
    return {
      ok: true,
      value: {
        attempt: { ...attempt, incorrectAttempts: attempt.incorrectAttempts + 1 },
        feedback: 'incorrect',
        conceptIds: puzzle.conceptIds,
      },
    };
  }

  const applied = applyCheckersMove(attempt.document, move);
  if (!applied.ok) return applied;
  const nextStep = attempt.currentStep + 1;
  const solved = candidates.some(
    (lineIndex) => puzzle.expectedLines[lineIndex]?.length === nextStep,
  );
  const nextAttempt: CheckersPuzzleAttempt = {
    ...attempt,
    document: applied.value,
    currentStep: nextStep,
    candidateLineIndexes: candidates,
    status: solved ? 'solved' : 'active',
  };
  return {
    ok: true,
    value: {
      attempt: nextAttempt,
      feedback: solved ? 'solved' : 'correct',
      conceptIds: puzzle.conceptIds,
    },
  };
}

export function requestCheckersPuzzleHint(
  puzzle: CheckersPuzzle,
  attempt: CheckersPuzzleAttempt,
): CheckersDocumentResult<CheckersPuzzleHintOutcome> {
  if (attempt.puzzleId !== puzzle.id) {
    return { ok: false, message: 'puzzle attempt belongs to another puzzle' };
  }
  if (attempt.status !== 'active') {
    return { ok: false, message: 'a solved puzzle has no next hint' };
  }
  const nextLevel = Math.min(5, attempt.hintLevel + 1) as 1 | 2 | 3 | 4 | 5;
  return {
    ok: true,
    value: {
      attempt: { ...attempt, hintLevel: nextLevel },
      hint: puzzle.hints[nextLevel - 1],
    },
  };
}
