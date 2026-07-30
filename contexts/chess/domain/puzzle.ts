import { applyLegalMove, moveToUci, parseFen, toFen, type Color, type Square } from './chess.js';

export type PuzzleTheme =
  | 'mate'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered_attack'
  | 'deflection'
  | 'decoy'
  | 'clearance'
  | 'sacrifice'
  | 'endgame'
  | 'defence'
  | 'calculation';

export interface ChessPuzzle {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly initialFen: string;
  readonly solutionUci: readonly string[];
  readonly themes: readonly PuzzleTheme[];
  readonly rating: number | null;
  readonly explanation: string;
}

export type PuzzleStatus = 'active' | 'solved';

export interface ChessPuzzleSession {
  readonly puzzleId: string;
  readonly userColor: Color;
  readonly currentFen: string;
  readonly cursor: number;
  readonly status: PuzzleStatus;
  readonly attempts: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly playedUci: readonly string[];
}

export type PuzzleValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export type PuzzleMoveResult =
  | {
      readonly ok: true;
      readonly outcome: 'correct' | 'solved';
      readonly session: ChessPuzzleSession;
      readonly automaticReplies: readonly string[];
    }
  | {
      readonly ok: false;
      readonly outcome: 'incorrect' | 'finished' | 'invalid';
      readonly session: ChessPuzzleSession;
      readonly message: string;
    };

export interface ChessPuzzleHint {
  readonly level: 1 | 2 | 3;
  readonly from?: Square;
  readonly to?: Square;
  readonly moveUci?: string;
  readonly message: string;
  readonly session: ChessPuzzleSession;
}

const PUZZLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const THEMES = new Set<PuzzleTheme>([
  'mate',
  'fork',
  'pin',
  'skewer',
  'discovered_attack',
  'deflection',
  'decoy',
  'clearance',
  'sacrifice',
  'endgame',
  'defence',
  'calculation',
]);

export function validateChessPuzzle(value: unknown): PuzzleValidationResult<ChessPuzzle> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'Puzzle must be an object.' };
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion',
    'id',
    'title',
    'initialFen',
    'solutionUci',
    'themes',
    'rating',
    'explanation',
  ]);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, message: `Puzzle contains unsupported field: ${unknown}.` };
  if (raw['schemaVersion'] !== 1)
    return { ok: false, message: 'Unsupported puzzle schemaVersion.' };
  if (typeof raw['id'] !== 'string' || !PUZZLE_ID_PATTERN.test(raw['id'])) {
    return { ok: false, message: 'Puzzle id must be safe and non-empty.' };
  }
  if (
    typeof raw['title'] !== 'string' ||
    raw['title'].trim().length === 0 ||
    raw['title'].length > 200
  ) {
    return { ok: false, message: 'Puzzle title must be a bounded non-empty string.' };
  }
  if (typeof raw['initialFen'] !== 'string') {
    return { ok: false, message: 'Puzzle initialFen must be a string.' };
  }
  const initial = parseFen(raw['initialFen']);
  if (!initial.ok) return { ok: false, message: `Puzzle initialFen: ${initial.message}` };
  if (
    !Array.isArray(raw['solutionUci']) ||
    raw['solutionUci'].length === 0 ||
    raw['solutionUci'].length > 64 ||
    !raw['solutionUci'].every((move) => typeof move === 'string' && UCI_PATTERN.test(move))
  ) {
    return { ok: false, message: 'Puzzle solutionUci must be a bounded non-empty UCI move list.' };
  }
  if (
    !Array.isArray(raw['themes']) ||
    raw['themes'].length === 0 ||
    raw['themes'].length > 12 ||
    !raw['themes'].every(
      (theme) => typeof theme === 'string' && THEMES.has(theme as PuzzleTheme),
    ) ||
    new Set(raw['themes']).size !== raw['themes'].length
  ) {
    return { ok: false, message: 'Puzzle themes are invalid or duplicated.' };
  }
  if (
    raw['rating'] !== null &&
    (!Number.isInteger(raw['rating']) ||
      Number(raw['rating']) < 100 ||
      Number(raw['rating']) > 4000)
  ) {
    return { ok: false, message: 'Puzzle rating must be null or an integer from 100 to 4000.' };
  }
  if (
    typeof raw['explanation'] !== 'string' ||
    raw['explanation'].trim().length === 0 ||
    raw['explanation'].length > 8000
  ) {
    return { ok: false, message: 'Puzzle explanation must be a bounded non-empty string.' };
  }

  let position = initial.value;
  for (let index = 0; index < raw['solutionUci'].length; index += 1) {
    const notation = raw['solutionUci'][index] as string;
    const applied = applyLegalMove(position, notation);
    if (!applied.ok) {
      return { ok: false, message: `Puzzle solution move ${index + 1} (${notation}) is illegal.` };
    }
    position = applied.value.position;
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      id: raw['id'],
      title: raw['title'].trim(),
      initialFen: raw['initialFen'].trim(),
      solutionUci: raw['solutionUci'] as string[],
      themes: raw['themes'] as PuzzleTheme[],
      rating: raw['rating'] as number | null,
      explanation: raw['explanation'].trim(),
    },
  };
}

export function createChessPuzzleSession(puzzle: ChessPuzzle): ChessPuzzleSession {
  const parsed = parseFen(puzzle.initialFen);
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    puzzleId: puzzle.id,
    userColor: parsed.value.turn,
    currentFen: puzzle.initialFen,
    cursor: 0,
    status: 'active',
    attempts: 0,
    mistakes: 0,
    hintsUsed: 0,
    playedUci: [],
  };
}

function replayAutomaticReplies(
  puzzle: ChessPuzzle,
  session: ChessPuzzleSession,
): PuzzleValidationResult<{
  readonly currentFen: string;
  readonly cursor: number;
  readonly automaticReplies: readonly string[];
  readonly playedUci: readonly string[];
}> {
  let currentFen = session.currentFen;
  let cursor = session.cursor;
  const automaticReplies: string[] = [];
  const playedUci = [...session.playedUci];
  while (cursor < puzzle.solutionUci.length) {
    const parsed = parseFen(currentFen);
    if (!parsed.ok) return parsed;
    if (parsed.value.turn === session.userColor) break;
    const notation = puzzle.solutionUci[cursor]!;
    const applied = applyLegalMove(parsed.value, notation);
    if (!applied.ok) {
      return { ok: false, message: `Puzzle automatic reply ${notation} is invalid.` };
    }
    currentFen = toFen(applied.value.position);
    cursor += 1;
    automaticReplies.push(notation);
    playedUci.push(notation);
  }
  return { ok: true, value: { currentFen, cursor, automaticReplies, playedUci } };
}

export function playChessPuzzleMove(
  puzzle: ChessPuzzle,
  session: ChessPuzzleSession,
  moveUci: string,
): PuzzleMoveResult {
  if (session.puzzleId !== puzzle.id) {
    return {
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Puzzle session belongs to another puzzle.',
    };
  }
  if (session.status === 'solved') {
    return { ok: false, outcome: 'finished', session, message: 'Puzzle is already solved.' };
  }
  if (!UCI_PATTERN.test(moveUci)) {
    return { ok: false, outcome: 'invalid', session, message: 'Move must use UCI notation.' };
  }
  const expected = puzzle.solutionUci[session.cursor];
  if (!expected) {
    return { ok: false, outcome: 'finished', session, message: 'Puzzle solution is complete.' };
  }
  if (moveUci !== expected) {
    return {
      ok: false,
      outcome: 'incorrect',
      session: {
        ...session,
        attempts: session.attempts + 1,
        mistakes: session.mistakes + 1,
      },
      message: 'Этот ход не решает задачу. Попробуйте найти более сильное продолжение.',
    };
  }

  const parsed = parseFen(session.currentFen);
  if (!parsed.ok) return { ok: false, outcome: 'invalid', session, message: parsed.message };
  const applied = applyLegalMove(parsed.value, moveUci);
  if (!applied.ok) return { ok: false, outcome: 'invalid', session, message: applied.message };
  const afterUser: ChessPuzzleSession = {
    ...session,
    currentFen: toFen(applied.value.position),
    cursor: session.cursor + 1,
    attempts: session.attempts + 1,
    playedUci: [...session.playedUci, moveToUci(applied.value.move)],
  };
  const automatic = replayAutomaticReplies(puzzle, afterUser);
  if (!automatic.ok) {
    return { ok: false, outcome: 'invalid', session: afterUser, message: automatic.message };
  }
  const solved = automatic.value.cursor >= puzzle.solutionUci.length;
  const next: ChessPuzzleSession = {
    ...afterUser,
    currentFen: automatic.value.currentFen,
    cursor: automatic.value.cursor,
    status: solved ? 'solved' : 'active',
    playedUci: automatic.value.playedUci,
  };
  return {
    ok: true,
    outcome: solved ? 'solved' : 'correct',
    session: next,
    automaticReplies: automatic.value.automaticReplies,
  };
}

export function requestChessPuzzleHint(
  puzzle: ChessPuzzle,
  session: ChessPuzzleSession,
): PuzzleValidationResult<ChessPuzzleHint> {
  if (session.status === 'solved') return { ok: false, message: 'Puzzle is already solved.' };
  const expected = puzzle.solutionUci[session.cursor];
  if (!expected) return { ok: false, message: 'Puzzle solution is complete.' };
  const level = Math.min(3, session.hintsUsed + 1) as 1 | 2 | 3;
  const from = expected.slice(0, 2) as Square;
  const to = expected.slice(2, 4) as Square;
  const nextSession = { ...session, hintsUsed: session.hintsUsed + 1 };
  if (level === 1) {
    return {
      ok: true,
      value: {
        level,
        from,
        message: `Обратите внимание на фигуру на поле ${from}.`,
        session: nextSession,
      },
    };
  }
  if (level === 2) {
    return {
      ok: true,
      value: {
        level,
        from,
        to,
        message: `Рассмотрите ход с ${from} на ${to}.`,
        session: nextSession,
      },
    };
  }
  return {
    ok: true,
    value: {
      level,
      from,
      to,
      moveUci: expected,
      message: `Подсказка раскрывает ход ${expected}.`,
      session: nextSession,
    },
  };
}

export function resetChessPuzzleSession(puzzle: ChessPuzzle): ChessPuzzleSession {
  return createChessPuzzleSession(puzzle);
}
