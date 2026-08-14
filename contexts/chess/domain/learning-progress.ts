import { parseFen, type Square } from './chess.js';
import {
  createChessPuzzleSession,
  playChessPuzzleMove,
  requestChessPuzzleHint,
  retryChessPuzzleSession,
  type ChessPuzzle,
  type ChessPuzzleSession,
  type PuzzleTheme,
} from './puzzle.js';

export type ChessLearningEvent =
  | {
      readonly operationId: string;
      readonly kind: 'move';
      readonly moveUci: string;
      readonly outcome: 'correct' | 'incorrect' | 'solved';
    }
  | {
      readonly operationId: string;
      readonly kind: 'hint';
      readonly level: 1 | 2 | 3;
    }
  | {
      readonly operationId: string;
      readonly kind: 'retry';
    };

export interface ChessPuzzleRatingEvidence {
  readonly formulaVersion: 'asa-puzzle-rating-v1';
  readonly puzzleId: string;
  readonly puzzleContentVersion: string;
  readonly puzzleRating: number | null;
  readonly attempts: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly delta: number;
}

export interface ChessPuzzleAttemptRecord {
  readonly puzzleId: string;
  readonly puzzleContentVersion: string;
  readonly initialFen: string;
  readonly currentFen: string;
  readonly cursor: number;
  readonly status: 'active' | 'solved' | 'exhausted';
  readonly attempts: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly playedUci: readonly string[];
  readonly events: readonly ChessLearningEvent[];
}

export interface ChessLearningProgress {
  readonly schemaVersion: 1;
  readonly activePuzzleId: string | null;
  readonly attempts: Readonly<Record<string, ChessPuzzleAttemptRecord>>;
  readonly rating: {
    readonly formulaVersion: 'asa-puzzle-rating-v1';
    readonly current: number;
    readonly evidence: readonly ChessPuzzleRatingEvidence[];
  };
}

export type ChessLearningResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export interface ChessLesson {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly contentVersion: string;
  readonly title: string;
  readonly summary: string;
  readonly themes: readonly PuzzleTheme[];
  readonly steps: readonly {
    readonly id: string;
    readonly title: string;
    readonly text: string;
    readonly focusSquares: readonly Square[];
  }[];
  readonly provenance: {
    readonly kind: 'asa_original';
    readonly sourceId: string;
    readonly createdAt: string;
    readonly license: 'ASA-Lab-Original';
  };
}

const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const ATTEMPT_KEYS = new Set([
  'puzzleId',
  'puzzleContentVersion',
  'initialFen',
  'currentFen',
  'cursor',
  'status',
  'attempts',
  'mistakes',
  'hintsUsed',
  'playedUci',
  'events',
]);
const MOVE_EVENT_KEYS = new Set(['operationId', 'kind', 'moveUci', 'outcome']);
const HINT_EVENT_KEYS = new Set(['operationId', 'kind', 'level']);
const RETRY_EVENT_KEYS = new Set(['operationId', 'kind']);
const PROGRESS_KEYS = new Set(['schemaVersion', 'activePuzzleId', 'attempts', 'rating']);
const RATING_KEYS = new Set(['formulaVersion', 'current', 'evidence']);
const RATING_EVIDENCE_KEYS = new Set([
  'formulaVersion',
  'puzzleId',
  'puzzleContentVersion',
  'puzzleRating',
  'attempts',
  'mistakes',
  'hintsUsed',
  'delta',
]);
const MAX_PUZZLES = 256;
const MAX_EVENTS = 1024;
const INITIAL_PUZZLE_RATING = 400;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extraKey(value: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

export function createEmptyChessLearningProgress(): ChessLearningProgress {
  return {
    schemaVersion: 1,
    activePuzzleId: null,
    attempts: {},
    rating: {
      formulaVersion: 'asa-puzzle-rating-v1',
      current: INITIAL_PUZZLE_RATING,
      evidence: [],
    },
  };
}

export function chessPuzzleSessionFromAttempt(
  record: ChessPuzzleAttemptRecord,
): ChessPuzzleSession {
  const parsed = parseFen(record.initialFen);
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    puzzleId: record.puzzleId,
    puzzleContentVersion: record.puzzleContentVersion,
    userColor: parsed.value.turn,
    currentFen: record.currentFen,
    cursor: record.cursor,
    status: record.status,
    attempts: record.attempts,
    mistakes: record.mistakes,
    hintsUsed: record.hintsUsed,
    playedUci: record.playedUci,
  };
}

function recordFromSession(
  puzzle: ChessPuzzle,
  session: ChessPuzzleSession,
  events: readonly ChessLearningEvent[],
): ChessPuzzleAttemptRecord {
  return {
    puzzleId: puzzle.id,
    puzzleContentVersion: puzzle.contentVersion,
    initialFen: puzzle.initialFen,
    currentFen: session.currentFen,
    cursor: session.cursor,
    status: session.status,
    attempts: session.attempts,
    mistakes: session.mistakes,
    hintsUsed: session.hintsUsed,
    playedUci: [...session.playedUci],
    events: [...events],
  };
}

export function chessLearningAttempt(
  progress: ChessLearningProgress,
  puzzle: ChessPuzzle,
): ChessPuzzleAttemptRecord {
  return (
    progress.attempts[puzzle.id] ?? recordFromSession(puzzle, createChessPuzzleSession(puzzle), [])
  );
}

function replaceAttempt(
  progress: ChessLearningProgress,
  puzzle: ChessPuzzle,
  attempt: ChessPuzzleAttemptRecord,
): ChessLearningProgress {
  const withoutCurrent = progress.rating.evidence.filter((entry) => entry.puzzleId !== puzzle.id);
  const evidence = [
    ...withoutCurrent,
    ...(attempt.status === 'solved' ? [ratingEvidence(puzzle, attempt)] : []),
  ].sort((left, right) => left.puzzleId.localeCompare(right.puzzleId));
  return {
    schemaVersion: 1,
    activePuzzleId: progress.activePuzzleId,
    attempts: { ...progress.attempts, [attempt.puzzleId]: attempt },
    rating: {
      formulaVersion: 'asa-puzzle-rating-v1',
      current: INITIAL_PUZZLE_RATING + evidence.reduce((sum, entry) => sum + entry.delta, 0),
      evidence,
    },
  };
}

export function selectChessLearningPuzzle(
  progress: ChessLearningProgress,
  puzzleId: string,
  puzzles: readonly ChessPuzzle[],
): ChessLearningResult<ChessLearningProgress> {
  if (!puzzles.some((puzzle) => puzzle.id === puzzleId)) {
    return { ok: false, message: `Unknown learning puzzle: ${puzzleId}.` };
  }
  return { ok: true, value: { ...progress, activePuzzleId: puzzleId } };
}

function ratingEvidence(
  puzzle: ChessPuzzle,
  attempt: ChessPuzzleAttemptRecord,
): ChessPuzzleRatingEvidence {
  const difficulty = puzzle.rating === null ? 0 : Math.round((puzzle.rating - 500) / 50);
  const delta = Math.max(
    1,
    Math.min(40, 24 + difficulty - attempt.mistakes * 5 - attempt.hintsUsed * 3),
  );
  return {
    formulaVersion: 'asa-puzzle-rating-v1',
    puzzleId: puzzle.id,
    puzzleContentVersion: puzzle.contentVersion,
    puzzleRating: puzzle.rating,
    attempts: attempt.attempts,
    mistakes: attempt.mistakes,
    hintsUsed: attempt.hintsUsed,
    delta,
  };
}

function ratingEvidenceMatches(value: unknown, expected: ChessPuzzleRatingEvidence): boolean {
  return (
    isPlainObject(value) &&
    !extraKey(value, RATING_EVIDENCE_KEYS) &&
    value['formulaVersion'] === expected.formulaVersion &&
    value['puzzleId'] === expected.puzzleId &&
    value['puzzleContentVersion'] === expected.puzzleContentVersion &&
    value['puzzleRating'] === expected.puzzleRating &&
    value['attempts'] === expected.attempts &&
    value['mistakes'] === expected.mistakes &&
    value['hintsUsed'] === expected.hintsUsed &&
    value['delta'] === expected.delta
  );
}

function existingEvent(
  attempt: ChessPuzzleAttemptRecord,
  operationId: string,
): ChessLearningEvent | undefined {
  return attempt.events.find((event) => event.operationId === operationId);
}

export function recordChessPuzzleMove(
  progress: ChessLearningProgress,
  puzzle: ChessPuzzle,
  operationId: string,
  moveUci: string,
): ChessLearningResult<{
  readonly progress: ChessLearningProgress;
  readonly attempt: ChessPuzzleAttemptRecord;
  readonly outcome: 'correct' | 'incorrect' | 'solved';
  readonly automaticReplies: readonly string[];
  readonly replayed: boolean;
}> {
  if (!OPERATION_ID.test(operationId)) {
    return { ok: false, message: 'Learning operationId must be safe and non-empty.' };
  }
  const attempt = chessLearningAttempt(progress, puzzle);
  const previous = existingEvent(attempt, operationId);
  if (previous) {
    if (previous.kind !== 'move' || previous.moveUci !== moveUci) {
      return { ok: false, message: 'Learning operationId was reused with another payload.' };
    }
    return {
      ok: true,
      value: {
        progress,
        attempt,
        outcome: previous.outcome,
        automaticReplies: [],
        replayed: true,
      },
    };
  }
  if (attempt.events.length >= MAX_EVENTS) {
    return { ok: false, message: 'Puzzle attempt event limit is reached.' };
  }
  const result = playChessPuzzleMove(puzzle, chessPuzzleSessionFromAttempt(attempt), moveUci);
  if (!result.ok && result.outcome === 'invalid') return { ok: false, message: result.message };
  if (!result.ok && result.outcome === 'finished') return { ok: false, message: result.message };
  const outcome = result.ok ? result.outcome : 'incorrect';
  const event: ChessLearningEvent = { operationId, kind: 'move', moveUci, outcome };
  const nextAttempt = recordFromSession(puzzle, result.session, [...attempt.events, event]);
  return {
    ok: true,
    value: {
      progress: replaceAttempt(progress, puzzle, nextAttempt),
      attempt: nextAttempt,
      outcome,
      automaticReplies: result.ok ? result.automaticReplies : [],
      replayed: false,
    },
  };
}

export function recordChessPuzzleHint(
  progress: ChessLearningProgress,
  puzzle: ChessPuzzle,
  operationId: string,
): ChessLearningResult<{
  readonly progress: ChessLearningProgress;
  readonly attempt: ChessPuzzleAttemptRecord;
  readonly level: 1 | 2 | 3;
  readonly message: string;
  readonly replayed: boolean;
}> {
  if (!OPERATION_ID.test(operationId)) {
    return { ok: false, message: 'Learning operationId must be safe and non-empty.' };
  }
  const attempt = chessLearningAttempt(progress, puzzle);
  const previous = existingEvent(attempt, operationId);
  if (previous) {
    if (previous.kind !== 'hint') {
      return { ok: false, message: 'Learning operationId was reused with another payload.' };
    }
    return {
      ok: true,
      value: {
        progress,
        attempt,
        level: previous.level,
        message: hintMessage(previous.level, attempt, puzzle),
        replayed: true,
      },
    };
  }
  if (attempt.events.length >= MAX_EVENTS) {
    return { ok: false, message: 'Puzzle attempt event limit is reached.' };
  }
  const result = requestChessPuzzleHint(puzzle, chessPuzzleSessionFromAttempt(attempt));
  if (!result.ok) return result;
  const event: ChessLearningEvent = {
    operationId,
    kind: 'hint',
    level: result.value.level,
  };
  const nextAttempt = recordFromSession(puzzle, result.value.session, [...attempt.events, event]);
  return {
    ok: true,
    value: {
      progress: replaceAttempt(progress, puzzle, nextAttempt),
      attempt: nextAttempt,
      level: result.value.level,
      message: result.value.message,
      replayed: false,
    },
  };
}

export function recordChessPuzzleRetry(
  progress: ChessLearningProgress,
  puzzle: ChessPuzzle,
  operationId: string,
): ChessLearningResult<{
  readonly progress: ChessLearningProgress;
  readonly attempt: ChessPuzzleAttemptRecord;
  readonly replayed: boolean;
}> {
  if (!OPERATION_ID.test(operationId)) {
    return { ok: false, message: 'Learning operationId must be safe and non-empty.' };
  }
  const attempt = chessLearningAttempt(progress, puzzle);
  const previous = existingEvent(attempt, operationId);
  if (previous) {
    if (previous.kind !== 'retry') {
      return { ok: false, message: 'Learning operationId was reused with another payload.' };
    }
    return { ok: true, value: { progress, attempt, replayed: true } };
  }
  if (attempt.events.length >= MAX_EVENTS) {
    return { ok: false, message: 'Puzzle attempt event limit is reached.' };
  }
  const retried = retryChessPuzzleSession(puzzle, chessPuzzleSessionFromAttempt(attempt));
  if (!retried.ok) return retried;
  const event: ChessLearningEvent = { operationId, kind: 'retry' };
  const nextAttempt = recordFromSession(puzzle, retried.value, [...attempt.events, event]);
  return {
    ok: true,
    value: {
      progress: replaceAttempt(progress, puzzle, nextAttempt),
      attempt: nextAttempt,
      replayed: false,
    },
  };
}

function hintMessage(
  level: 1 | 2 | 3,
  attempt: ChessPuzzleAttemptRecord,
  puzzle: ChessPuzzle,
): string {
  const session = chessPuzzleSessionFromAttempt({ ...attempt, hintsUsed: level - 1 });
  const result = requestChessPuzzleHint(puzzle, session);
  return result.ok ? result.value.message : 'Подсказка больше не доступна.';
}

function parseLearningEvent(value: unknown): ChessLearningResult<ChessLearningEvent> {
  if (!isPlainObject(value)) return { ok: false, message: 'Learning event must be an object.' };
  if (value['kind'] === 'move') {
    if (
      extraKey(value, MOVE_EVENT_KEYS) ||
      typeof value['operationId'] !== 'string' ||
      !OPERATION_ID.test(value['operationId']) ||
      typeof value['moveUci'] !== 'string' ||
      !UCI.test(value['moveUci']) ||
      (value['outcome'] !== 'correct' &&
        value['outcome'] !== 'incorrect' &&
        value['outcome'] !== 'solved')
    ) {
      return { ok: false, message: 'Learning move event is invalid.' };
    }
    return {
      ok: true,
      value: {
        operationId: value['operationId'],
        kind: 'move',
        moveUci: value['moveUci'],
        outcome: value['outcome'],
      },
    };
  }
  if (value['kind'] === 'retry') {
    if (
      extraKey(value, RETRY_EVENT_KEYS) ||
      typeof value['operationId'] !== 'string' ||
      !OPERATION_ID.test(value['operationId'])
    ) {
      return { ok: false, message: 'Learning retry event is invalid.' };
    }
    return { ok: true, value: { operationId: value['operationId'], kind: 'retry' } };
  }
  if (
    value['kind'] !== 'hint' ||
    extraKey(value, HINT_EVENT_KEYS) ||
    typeof value['operationId'] !== 'string' ||
    !OPERATION_ID.test(value['operationId']) ||
    (value['level'] !== 1 && value['level'] !== 2 && value['level'] !== 3)
  ) {
    return { ok: false, message: 'Learning hint event is invalid.' };
  }
  return {
    ok: true,
    value: { operationId: value['operationId'], kind: 'hint', level: value['level'] },
  };
}

function replayAttempt(
  puzzle: ChessPuzzle,
  events: readonly ChessLearningEvent[],
): ChessLearningResult<ChessPuzzleAttemptRecord> {
  let progress = createEmptyChessLearningProgress();
  for (const event of events) {
    if (event.kind === 'move') {
      const result = recordChessPuzzleMove(progress, puzzle, event.operationId, event.moveUci);
      if (!result.ok) return result;
      progress = result.value.progress;
      if (result.value.outcome !== event.outcome) {
        return { ok: false, message: 'Learning event outcome is inconsistent with replay.' };
      }
      continue;
    }
    if (event.kind === 'retry') {
      const result = recordChessPuzzleRetry(progress, puzzle, event.operationId);
      if (!result.ok) return result;
      progress = result.value.progress;
      continue;
    }
    const result = recordChessPuzzleHint(progress, puzzle, event.operationId);
    if (!result.ok) return result;
    progress = result.value.progress;
    if (result.value.level !== event.level) {
      return { ok: false, message: 'Learning hint level is inconsistent with replay.' };
    }
  }
  return { ok: true, value: chessLearningAttempt(progress, puzzle) };
}

export function validateChessLearningProgress(
  value: unknown,
  puzzles: readonly ChessPuzzle[],
): ChessLearningResult<ChessLearningProgress> {
  if (!isPlainObject(value) || extraKey(value, PROGRESS_KEYS) || value['schemaVersion'] !== 1) {
    return { ok: false, message: 'Learning progress root is invalid.' };
  }
  if (!isPlainObject(value['rating']) || extraKey(value['rating'], RATING_KEYS)) {
    return { ok: false, message: 'Learning rating root is invalid.' };
  }
  if (!isPlainObject(value['attempts']) || Object.keys(value['attempts']).length > MAX_PUZZLES) {
    return { ok: false, message: 'Learning attempts must be a bounded object.' };
  }
  const catalog = new Map(puzzles.map((puzzle) => [puzzle.id, puzzle]));
  if (
    value['activePuzzleId'] !== null &&
    (typeof value['activePuzzleId'] !== 'string' || !catalog.has(value['activePuzzleId']))
  ) {
    return { ok: false, message: 'Learning activePuzzleId is invalid.' };
  }
  const attempts: Record<string, ChessPuzzleAttemptRecord> = {};
  for (const [puzzleId, rawAttempt] of Object.entries(value['attempts'])) {
    const puzzle = catalog.get(puzzleId);
    if (!puzzle) return { ok: false, message: `Unknown learning puzzle: ${puzzleId}.` };
    if (!isPlainObject(rawAttempt) || extraKey(rawAttempt, ATTEMPT_KEYS)) {
      return { ok: false, message: `Learning attempt ${puzzleId} is invalid.` };
    }
    if (
      rawAttempt['puzzleId'] !== puzzleId ||
      rawAttempt['puzzleContentVersion'] !== puzzle.contentVersion ||
      rawAttempt['initialFen'] !== puzzle.initialFen ||
      !Array.isArray(rawAttempt['events']) ||
      rawAttempt['events'].length > MAX_EVENTS
    ) {
      return { ok: false, message: `Learning attempt ${puzzleId} provenance is invalid.` };
    }
    const events: ChessLearningEvent[] = [];
    const operationIds = new Set<string>();
    for (const rawEvent of rawAttempt['events']) {
      const event = parseLearningEvent(rawEvent);
      if (!event.ok) return event;
      if (operationIds.has(event.value.operationId)) {
        return { ok: false, message: 'Learning operationId must be unique within an attempt.' };
      }
      operationIds.add(event.value.operationId);
      events.push(event.value);
    }
    const replayed = replayAttempt(puzzle, events);
    if (!replayed.ok) return replayed;
    const expected = replayed.value;
    if (
      rawAttempt['currentFen'] !== expected.currentFen ||
      rawAttempt['cursor'] !== expected.cursor ||
      rawAttempt['status'] !== expected.status ||
      rawAttempt['attempts'] !== expected.attempts ||
      rawAttempt['mistakes'] !== expected.mistakes ||
      rawAttempt['hintsUsed'] !== expected.hintsUsed ||
      JSON.stringify(rawAttempt['playedUci']) !== JSON.stringify(expected.playedUci)
    ) {
      return {
        ok: false,
        message: `Learning attempt ${puzzleId} does not match its event replay.`,
      };
    }
    attempts[puzzleId] = { ...expected, events };
  }
  const evidence = Object.entries(attempts)
    .filter(([, attempt]) => attempt.status === 'solved')
    .map(([puzzleId, attempt]) => ratingEvidence(catalog.get(puzzleId)!, attempt))
    .sort((left, right) => left.puzzleId.localeCompare(right.puzzleId));
  const expectedRating = {
    formulaVersion: 'asa-puzzle-rating-v1' as const,
    current: INITIAL_PUZZLE_RATING + evidence.reduce((sum, entry) => sum + entry.delta, 0),
    evidence,
  };
  if (
    value['rating']['formulaVersion'] !== 'asa-puzzle-rating-v1' ||
    !Number.isInteger(value['rating']['current']) ||
    !Array.isArray(value['rating']['evidence']) ||
    value['rating']['evidence'].some(
      (entry) => !isPlainObject(entry) || extraKey(entry, RATING_EVIDENCE_KEYS),
    ) ||
    value['rating']['current'] !== expectedRating.current ||
    value['rating']['evidence'].length !== expectedRating.evidence.length ||
    value['rating']['evidence'].some(
      (entry, index) => !ratingEvidenceMatches(entry, expectedRating.evidence[index]!),
    )
  ) {
    return { ok: false, message: 'Learning rating does not match verified puzzle evidence.' };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      activePuzzleId: value['activePuzzleId'],
      attempts,
      rating: expectedRating,
    },
  };
}

export function recommendChessLesson(
  progress: ChessLearningProgress,
  puzzles: readonly ChessPuzzle[],
  lessons: readonly ChessLesson[],
): ChessLesson | null {
  const solved = Object.values(progress.attempts)
    .filter((attempt) => attempt.status === 'solved')
    .sort((left, right) => left.puzzleId.localeCompare(right.puzzleId));
  const latest = solved.at(-1);
  if (!latest) return null;
  const puzzle = puzzles.find(
    (candidate) =>
      candidate.id === latest.puzzleId && candidate.contentVersion === latest.puzzleContentVersion,
  );
  if (!puzzle) return null;
  return (
    lessons
      .filter((lesson) => lesson.themes.some((theme) => puzzle.themes.includes(theme)))
      .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null
  );
}

export function solvedChessPuzzleCount(progress: ChessLearningProgress): number {
  return Object.values(progress.attempts).filter((attempt) => attempt.status === 'solved').length;
}
