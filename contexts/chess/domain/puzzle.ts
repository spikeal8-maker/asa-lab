import {
  applyLegalMove,
  generateLegalMoves,
  getChessStatus,
  moveToUci,
  parseFen,
  toFen,
  type Color,
  type Square,
} from './chess.js';

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

export interface ChessPuzzleProvenance {
  readonly kind: 'asa_original';
  readonly sourceId: string;
  readonly createdAt: string;
  readonly license: 'ASA-Lab-Original';
}

/**
 * A puzzle can contain several accepted lines. Shared prefixes form an
 * implicit solution tree while keeping the serialized format small and easy
 * to audit. The browser never decides that a different line is correct.
 */
export interface ChessPuzzle {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly contentVersion: string;
  readonly title: string;
  readonly initialFen: string;
  readonly solutionLinesUci: readonly (readonly string[])[];
  readonly themes: readonly PuzzleTheme[];
  readonly rating: number | null;
  readonly maxMistakes: number;
  readonly explanation: string;
  readonly provenance: ChessPuzzleProvenance;
}

export type PuzzleStatus = 'active' | 'solved' | 'exhausted';

export interface ChessPuzzleSession {
  readonly puzzleId: string;
  readonly puzzleContentVersion: string;
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
const CONTENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
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
const PUZZLE_KEYS = new Set([
  'schemaVersion',
  'id',
  'contentVersion',
  'title',
  'initialFen',
  'solutionLinesUci',
  'themes',
  'rating',
  'maxMistakes',
  'explanation',
  'provenance',
]);
const PROVENANCE_KEYS = new Set(['kind', 'sourceId', 'createdAt', 'license']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extraKey(value: Record<string, unknown>, keys: ReadonlySet<string>): string | null {
  return Object.keys(value).find((key) => !keys.has(key)) ?? null;
}

function canonicalLine(line: readonly string[]): string {
  return line.join(' ');
}

export function validateChessPuzzle(value: unknown): PuzzleValidationResult<ChessPuzzle> {
  if (!isPlainObject(value)) return { ok: false, message: 'Puzzle must be an object.' };
  const unknown = extraKey(value, PUZZLE_KEYS);
  if (unknown) return { ok: false, message: `Puzzle contains unsupported field: ${unknown}.` };
  if (value['schemaVersion'] !== 2) {
    return { ok: false, message: 'Unsupported puzzle schemaVersion.' };
  }
  if (typeof value['id'] !== 'string' || !PUZZLE_ID_PATTERN.test(value['id'])) {
    return { ok: false, message: 'Puzzle id must be safe and non-empty.' };
  }
  if (
    typeof value['contentVersion'] !== 'string' ||
    !CONTENT_VERSION_PATTERN.test(value['contentVersion'])
  ) {
    return { ok: false, message: 'Puzzle contentVersion must be stable and safe.' };
  }
  if (
    typeof value['title'] !== 'string' ||
    value['title'].trim().length === 0 ||
    value['title'].length > 200
  ) {
    return { ok: false, message: 'Puzzle title must be a bounded non-empty string.' };
  }
  if (typeof value['initialFen'] !== 'string') {
    return { ok: false, message: 'Puzzle initialFen must be a string.' };
  }
  const initial = parseFen(value['initialFen']);
  if (!initial.ok) return { ok: false, message: `Puzzle initialFen: ${initial.message}` };
  const canonicalFen = toFen(initial.value);
  if (canonicalFen !== value['initialFen']) {
    return { ok: false, message: 'Puzzle initialFen must use canonical FEN.' };
  }
  if (
    !Array.isArray(value['solutionLinesUci']) ||
    value['solutionLinesUci'].length === 0 ||
    value['solutionLinesUci'].length > 16
  ) {
    return { ok: false, message: 'Puzzle must contain 1 to 16 accepted solution lines.' };
  }
  const lines: string[][] = [];
  for (const rawLine of value['solutionLinesUci']) {
    if (
      !Array.isArray(rawLine) ||
      rawLine.length === 0 ||
      rawLine.length > 64 ||
      !rawLine.every((move) => typeof move === 'string' && UCI_PATTERN.test(move))
    ) {
      return { ok: false, message: 'Every puzzle line must be a bounded non-empty UCI list.' };
    }
    const line = rawLine as string[];
    let position = initial.value;
    for (let index = 0; index < line.length; index += 1) {
      const notation = line[index]!;
      const applied = applyLegalMove(position, notation);
      if (!applied.ok) {
        return {
          ok: false,
          message: `Puzzle solution move ${index + 1} (${notation}) is illegal.`,
        };
      }
      position = applied.value.position;
    }
    if (position.turn === initial.value.turn) {
      return { ok: false, message: 'Every accepted line must end after a learner move.' };
    }
    if (
      Array.isArray(value['themes']) &&
      value['themes'].includes('mate') &&
      getChessStatus(position).state !== 'checkmate'
    ) {
      return { ok: false, message: 'Every mate puzzle line must finish in checkmate.' };
    }
    lines.push([...line]);
  }
  if (new Set(lines.map(canonicalLine)).size !== lines.length) {
    return { ok: false, message: 'Puzzle accepted solution lines must be unique.' };
  }
  if (
    !Array.isArray(value['themes']) ||
    value['themes'].length === 0 ||
    value['themes'].length > 12 ||
    !value['themes'].every(
      (theme) => typeof theme === 'string' && THEMES.has(theme as PuzzleTheme),
    ) ||
    new Set(value['themes']).size !== value['themes'].length
  ) {
    return { ok: false, message: 'Puzzle themes are invalid or duplicated.' };
  }
  if (
    value['rating'] !== null &&
    (!Number.isInteger(value['rating']) ||
      Number(value['rating']) < 100 ||
      Number(value['rating']) > 4000)
  ) {
    return { ok: false, message: 'Puzzle rating must be null or an integer from 100 to 4000.' };
  }
  if (
    !Number.isInteger(value['maxMistakes']) ||
    Number(value['maxMistakes']) < 1 ||
    Number(value['maxMistakes']) > 20
  ) {
    return { ok: false, message: 'Puzzle maxMistakes must be an integer from 1 to 20.' };
  }
  if (
    typeof value['explanation'] !== 'string' ||
    value['explanation'].trim().length === 0 ||
    value['explanation'].length > 8000
  ) {
    return { ok: false, message: 'Puzzle explanation must be a bounded non-empty string.' };
  }
  if (!isPlainObject(value['provenance'])) {
    return { ok: false, message: 'Puzzle provenance must be an object.' };
  }
  const provenanceUnknown = extraKey(value['provenance'], PROVENANCE_KEYS);
  if (
    provenanceUnknown ||
    value['provenance']['kind'] !== 'asa_original' ||
    typeof value['provenance']['sourceId'] !== 'string' ||
    !PUZZLE_ID_PATTERN.test(value['provenance']['sourceId']) ||
    typeof value['provenance']['createdAt'] !== 'string' ||
    !ISO_TIMESTAMP.test(value['provenance']['createdAt']) ||
    value['provenance']['license'] !== 'ASA-Lab-Original'
  ) {
    return { ok: false, message: 'Puzzle provenance is invalid.' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 2,
      id: value['id'],
      contentVersion: value['contentVersion'],
      title: value['title'].trim(),
      initialFen: canonicalFen,
      solutionLinesUci: lines,
      themes: value['themes'] as PuzzleTheme[],
      rating: value['rating'] as number | null,
      maxMistakes: value['maxMistakes'] as number,
      explanation: value['explanation'].trim(),
      provenance: {
        kind: 'asa_original',
        sourceId: value['provenance']['sourceId'],
        createdAt: value['provenance']['createdAt'],
        license: 'ASA-Lab-Original',
      },
    },
  };
}

export function createChessPuzzleSession(puzzle: ChessPuzzle): ChessPuzzleSession {
  const parsed = parseFen(puzzle.initialFen);
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    puzzleId: puzzle.id,
    puzzleContentVersion: puzzle.contentVersion,
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

function candidateLines(
  puzzle: ChessPuzzle,
  played: readonly string[],
): readonly (readonly string[])[] {
  return puzzle.solutionLinesUci.filter((line) =>
    played.every((move, index) => line[index] === move),
  );
}

function acceptedMoves(puzzle: ChessPuzzle, session: ChessPuzzleSession): readonly string[] {
  return [...new Set(candidateLines(puzzle, session.playedUci).map((line) => line[session.cursor]))]
    .filter((move): move is string => typeof move === 'string')
    .sort();
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
  while (true) {
    const parsed = parseFen(currentFen);
    if (!parsed.ok) return parsed;
    if (parsed.value.turn === session.userColor) break;
    const candidates = candidateLines(puzzle, playedUci);
    if (candidates.some((line) => line.length === cursor)) break;
    const notation = [...new Set(candidates.map((line) => line[cursor]))]
      .filter((move): move is string => typeof move === 'string')
      .sort()[0];
    if (!notation) return { ok: false, message: 'Puzzle automatic reply is missing.' };
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
  if (session.puzzleId !== puzzle.id || session.puzzleContentVersion !== puzzle.contentVersion) {
    return {
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Puzzle session belongs to another content version.',
    };
  }
  if (session.status !== 'active') {
    return { ok: false, outcome: 'finished', session, message: 'Puzzle is already solved.' };
  }
  if (!UCI_PATTERN.test(moveUci)) {
    return { ok: false, outcome: 'invalid', session, message: 'Move must use UCI notation.' };
  }
  const parsed = parseFen(session.currentFen);
  if (!parsed.ok) return { ok: false, outcome: 'invalid', session, message: parsed.message };
  const legal = generateLegalMoves(parsed.value).find((move) => moveToUci(move) === moveUci);
  if (!legal) {
    return { ok: false, outcome: 'invalid', session, message: 'Illegal puzzle move.' };
  }
  if (!acceptedMoves(puzzle, session).includes(moveUci)) {
    const mistakes = session.mistakes + 1;
    return {
      ok: false,
      outcome: 'incorrect',
      session: {
        ...session,
        status: mistakes >= puzzle.maxMistakes ? 'exhausted' : 'active',
        attempts: session.attempts + 1,
        mistakes,
      },
      message:
        mistakes >= puzzle.maxMistakes
          ? 'Лимит ошибок исчерпан. Разберите подсказки и начните новую попытку.'
          : 'Этот ход легален, но не решает задачу. Попробуйте найти более сильное продолжение.',
    };
  }

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
  const candidates = candidateLines(puzzle, automatic.value.playedUci);
  const solved = candidates.some((line) => line.length === automatic.value.cursor);
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
  if (session.status !== 'active') return { ok: false, message: 'Puzzle attempt is finished.' };
  const expected = acceptedMoves(puzzle, session)[0];
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

export function retryChessPuzzleSession(
  puzzle: ChessPuzzle,
  session: ChessPuzzleSession,
): PuzzleValidationResult<ChessPuzzleSession> {
  if (session.puzzleId !== puzzle.id || session.puzzleContentVersion !== puzzle.contentVersion) {
    return { ok: false, message: 'Puzzle session belongs to another content version.' };
  }
  if (session.status !== 'exhausted') {
    return { ok: false, message: 'Only an exhausted puzzle attempt can be retried.' };
  }
  const fresh = createChessPuzzleSession(puzzle);
  return {
    ok: true,
    value: {
      ...fresh,
      attempts: session.attempts,
      mistakes: session.mistakes,
      hintsUsed: session.hintsUsed,
    },
  };
}

export function resetChessPuzzleSession(puzzle: ChessPuzzle): ChessPuzzleSession {
  return createChessPuzzleSession(puzzle);
}
