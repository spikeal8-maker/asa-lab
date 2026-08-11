import {
  START_FEN,
  applyLegalMove,
  getChessStatus,
  moveToUci,
  parseFen,
  positionKey,
  toFen,
  type ChessPosition,
  type ChessStatus,
  type Color,
  type Square,
} from './chess.js';
import { ASA_BOT_PROFILES } from './bot-profiles.js';

export type ChessMode = 'analysis' | 'local' | 'computer';
export type BoardOrientation = 'white' | 'black';
export type BotLevel = 1 | 2 | 3;
export type ChessResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type ChessTermination =
  | 'ongoing'
  | 'checkmate'
  | 'stalemate'
  | 'fifty_move'
  | 'threefold'
  | 'insufficient_material'
  | 'resignation'
  | 'timeout'
  | 'draw_agreement';

export interface ChessClockState {
  readonly initialMs: number;
  readonly incrementMs: number;
  readonly whiteMs: number;
  readonly blackMs: number;
}

export interface ChessMoveRecord {
  readonly ply: number;
  readonly uci: string;
  readonly san: string;
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly clockAfter?: {
    readonly whiteMs: number;
    readonly blackMs: number;
  };
}

export interface ChessBotConfiguration {
  readonly color: Color;
  readonly level: BotLevel;
  /** Optional only for documents created before the ASA profile catalog. */
  readonly profileId?: string;
}

export interface ChessArrowAnnotation {
  readonly id: string;
  readonly kind: 'arrow';
  readonly ply: number;
  readonly from: Square;
  readonly to: Square;
  readonly color: 'green' | 'red' | 'blue' | 'yellow';
}

export interface ChessSquareAnnotation {
  readonly id: string;
  readonly kind: 'square';
  readonly ply: number;
  readonly square: Square;
  readonly color: 'green' | 'red' | 'blue' | 'yellow';
}

export interface ChessCommentAnnotation {
  readonly id: string;
  readonly kind: 'comment';
  readonly ply: number;
  readonly text: string;
}

export type ChessAnnotation = ChessArrowAnnotation | ChessSquareAnnotation | ChessCommentAnnotation;

export interface ChessDocument {
  readonly schemaVersion: 1;
  readonly variant: 'standard';
  readonly mode: ChessMode;
  readonly initialFen: string;
  readonly currentFen: string;
  readonly orientation: BoardOrientation;
  readonly moves: readonly ChessMoveRecord[];
  readonly clock: ChessClockState | null;
  readonly bot: ChessBotConfiguration | null;
  readonly annotations: readonly ChessAnnotation[];
  readonly result: ChessResult;
  readonly termination: ChessTermination;
  readonly headers: Readonly<Record<string, string>>;
}

export type ChessDocumentResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'variant',
  'mode',
  'initialFen',
  'currentFen',
  'orientation',
  'moves',
  'clock',
  'bot',
  'annotations',
  'result',
  'termination',
  'headers',
]);
const MOVE_KEYS = new Set(['ply', 'uci', 'san', 'fenBefore', 'fenAfter', 'clockAfter']);
const CLOCK_KEYS = new Set(['initialMs', 'incrementMs', 'whiteMs', 'blackMs']);
const BOT_KEYS = new Set(['color', 'level', 'profileId']);
const ANNOTATION_COLORS = new Set(['green', 'red', 'blue', 'yellow']);
const HEADER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const MAX_MOVES = 1000;
const MAX_ANNOTATIONS = 2000;
const MAX_COMMENT_LENGTH = 4000;
const MAX_CLOCK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BOT_PROFILE =
  ASA_BOT_PROFILES.find((profile) => profile.id === 'asa-bot-compass') ?? ASA_BOT_PROFILES[0]!;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): string | null {
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isSquare(value: unknown): value is Square {
  return typeof value === 'string' && SQUARE_PATTERN.test(value);
}

function isResult(value: unknown): value is ChessResult {
  return value === '1-0' || value === '0-1' || value === '1/2-1/2' || value === '*';
}

function terminationFromStatus(status: ChessStatus): ChessTermination {
  if (status.state === 'checkmate') return 'checkmate';
  if (status.state === 'stalemate') return 'stalemate';
  if (status.state === 'draw_fifty_move') return 'fifty_move';
  if (status.state === 'draw_threefold') return 'threefold';
  if (status.state === 'draw_insufficient_material') return 'insufficient_material';
  return 'ongoing';
}

function defaultClock(mode: ChessMode): ChessClockState | null {
  if (mode === 'analysis') return null;
  return {
    initialMs: 10 * 60 * 1000,
    incrementMs: 5 * 1000,
    whiteMs: 10 * 60 * 1000,
    blackMs: 10 * 60 * 1000,
  };
}

export function createEmptyChessDocument(mode: ChessMode = 'analysis'): ChessDocument {
  return {
    schemaVersion: 1,
    variant: 'standard',
    mode,
    initialFen: START_FEN,
    currentFen: START_FEN,
    orientation: 'white',
    moves: [],
    clock: defaultClock(mode),
    bot:
      mode === 'computer'
        ? {
            color: 'black',
            level: DEFAULT_BOT_PROFILE.engine.level,
            profileId: DEFAULT_BOT_PROFILE.id,
          }
        : null,
    annotations: [],
    result: '*',
    termination: 'ongoing',
    headers: {
      Event: 'ASA Chess project',
      Site: 'ASA Lab',
      White: 'White',
      Black: mode === 'computer' ? 'ASA Bot' : 'Black',
    },
  };
}

export function chessDocumentPositionKeys(document: ChessDocument): readonly string[] {
  const keys: string[] = [];
  const initial = parseFen(document.initialFen);
  if (!initial.ok) return keys;
  keys.push(positionKey(initial.value));
  for (const move of document.moves) {
    const parsed = parseFen(move.fenAfter);
    if (parsed.ok) keys.push(positionKey(parsed.value));
  }
  return keys;
}

function currentPosition(document: ChessDocument): ChessDocumentResult<ChessPosition> {
  const parsed = parseFen(document.currentFen);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, message: parsed.message };
}

function applyElapsedClock(
  clock: ChessClockState | null,
  movingColor: Color,
  elapsedMs: number,
): ChessDocumentResult<ChessClockState | null> {
  if (clock === null) return { ok: true, value: null };
  if (!isSafeInteger(elapsedMs, 0, MAX_CLOCK_MS)) {
    return { ok: false, message: 'Elapsed move time must be a bounded non-negative integer.' };
  }
  const remaining = movingColor === 'white' ? clock.whiteMs - elapsedMs : clock.blackMs - elapsedMs;
  const next = {
    ...clock,
    whiteMs:
      movingColor === 'white'
        ? Math.max(0, remaining) + (remaining > 0 ? clock.incrementMs : 0)
        : clock.whiteMs,
    blackMs:
      movingColor === 'black'
        ? Math.max(0, remaining) + (remaining > 0 ? clock.incrementMs : 0)
        : clock.blackMs,
  };
  return { ok: true, value: next };
}

export function playChessDocumentMove(
  document: ChessDocument,
  notation: string,
  elapsedMs = 0,
): ChessDocumentResult<ChessDocument> {
  if (document.result !== '*' || document.termination !== 'ongoing') {
    return { ok: false, message: 'The game is already finished.' };
  }
  const parsedPosition = currentPosition(document);
  if (!parsedPosition.ok) return parsedPosition;
  const movingColor = parsedPosition.value.turn;
  const clock = applyElapsedClock(document.clock, movingColor, elapsedMs);
  if (!clock.ok) return clock;
  if (
    clock.value &&
    ((movingColor === 'white' && clock.value.whiteMs === 0) ||
      (movingColor === 'black' && clock.value.blackMs === 0))
  ) {
    return {
      ok: true,
      value: {
        ...document,
        clock: clock.value,
        result: movingColor === 'white' ? '0-1' : '1-0',
        termination: 'timeout',
      },
    };
  }

  const applied = applyLegalMove(parsedPosition.value, notation);
  if (!applied.ok) return applied;
  const fenAfter = toFen(applied.value.position);
  const record: ChessMoveRecord = {
    ply: document.moves.length + 1,
    uci: moveToUci(applied.value.move),
    san: applied.value.san,
    fenBefore: document.currentFen,
    fenAfter,
    ...(clock.value === null
      ? {}
      : { clockAfter: { whiteMs: clock.value.whiteMs, blackMs: clock.value.blackMs } }),
  };
  const provisional: ChessDocument = {
    ...document,
    currentFen: fenAfter,
    moves: [...document.moves, record],
    clock: clock.value,
  };
  const status = getChessStatus(applied.value.position, chessDocumentPositionKeys(provisional));
  return {
    ok: true,
    value: {
      ...provisional,
      result: status.result,
      termination: terminationFromStatus(status),
    },
  };
}

export function undoChessDocumentMove(document: ChessDocument): ChessDocument {
  if (document.moves.length === 0) return document;
  const moves = document.moves.slice(0, -1);
  const currentFen = moves.at(-1)?.fenAfter ?? document.initialFen;
  const clock =
    document.clock === null
      ? null
      : moves.at(-1)?.clockAfter
        ? {
            ...document.clock,
            whiteMs: moves.at(-1)!.clockAfter!.whiteMs,
            blackMs: moves.at(-1)!.clockAfter!.blackMs,
          }
        : {
            ...document.clock,
            whiteMs: document.clock.initialMs,
            blackMs: document.clock.initialMs,
          };
  return {
    ...document,
    currentFen,
    moves,
    clock,
    result: '*',
    termination: 'ongoing',
    annotations: document.annotations.filter((annotation) => annotation.ply <= moves.length),
  };
}

export function resetChessDocument(document: ChessDocument): ChessDocument {
  return {
    ...document,
    currentFen: document.initialFen,
    moves: [],
    clock:
      document.clock === null
        ? null
        : {
            ...document.clock,
            whiteMs: document.clock.initialMs,
            blackMs: document.clock.initialMs,
          },
    annotations: [],
    result: '*',
    termination: 'ongoing',
  };
}

export function resignChessDocument(
  document: ChessDocument,
  color: Color,
): ChessDocumentResult<ChessDocument> {
  if (document.result !== '*' || document.termination !== 'ongoing') {
    return { ok: false, message: 'The game is already finished.' };
  }
  return {
    ok: true,
    value: {
      ...document,
      result: color === 'white' ? '0-1' : '1-0',
      termination: 'resignation',
    },
  };
}

export function agreeDrawChessDocument(
  document: ChessDocument,
): ChessDocumentResult<ChessDocument> {
  if (document.result !== '*' || document.termination !== 'ongoing') {
    return { ok: false, message: 'The game is already finished.' };
  }
  return {
    ok: true,
    value: { ...document, result: '1/2-1/2', termination: 'draw_agreement' },
  };
}

function escapePgnHeader(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, ' ');
}

export function exportChessPgn(document: ChessDocument): string {
  const headers = {
    ...document.headers,
    Result: document.result,
    ...(document.initialFen === START_FEN ? {} : { SetUp: '1', FEN: document.initialFen }),
  };
  const headerText = Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `[${key} "${escapePgnHeader(value)}"]`)
    .join('\n');
  const moveTokens: string[] = [];
  for (let index = 0; index < document.moves.length; index += 2) {
    const white = document.moves[index];
    const black = document.moves[index + 1];
    moveTokens.push(
      `${Math.floor(index / 2) + 1}. ${white?.san ?? ''}${black ? ` ${black.san}` : ''}`,
    );
  }
  return `${headerText}\n\n${moveTokens.join(' ')}${moveTokens.length > 0 ? ' ' : ''}${document.result}`.trim();
}

function stripPgnVariations(text: string): string {
  let depth = 0;
  let result = '';
  for (const character of text) {
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) result += character;
  }
  return result;
}

function parsePgnHeaders(pgn: string): ChessDocumentResult<{
  readonly headers: Record<string, string>;
  readonly moveText: string;
}> {
  const headers: Record<string, string> = {};
  const lines = pgn.replace(/\r\n/g, '\n').split('\n');
  const moveLines: string[] = [];
  let readingHeaders = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (readingHeaders && trimmed.startsWith('[')) {
      const match = /^\[([A-Za-z][A-Za-z0-9_]{0,31})\s+"((?:\\.|[^"\\])*)"\]$/.exec(trimmed);
      if (!match) return { ok: false, message: `Invalid PGN tag: ${trimmed}` };
      headers[match[1]!] = match[2]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      continue;
    }
    if (trimmed !== '') readingHeaders = false;
    if (!readingHeaders) moveLines.push(line);
  }
  return { ok: true, value: { headers, moveText: moveLines.join(' ') } };
}

function pgnMoveTokens(moveText: string): readonly string[] {
  const withoutComments = stripPgnVariations(moveText)
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(?:\.\.)?/g, ' ');
  return withoutComments
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 0 &&
        token !== '1-0' &&
        token !== '0-1' &&
        token !== '1/2-1/2' &&
        token !== '*',
    );
}

export function importChessPgn(pgn: string): ChessDocumentResult<ChessDocument> {
  if (typeof pgn !== 'string' || pgn.length === 0 || pgn.length > 1_000_000) {
    return { ok: false, message: 'PGN must be a non-empty bounded string.' };
  }
  const parsed = parsePgnHeaders(pgn);
  if (!parsed.ok) return parsed;
  const initialFen =
    parsed.value.headers.SetUp === '1' && parsed.value.headers.FEN
      ? parsed.value.headers.FEN
      : START_FEN;
  const initialPosition = parseFen(initialFen);
  if (!initialPosition.ok) return initialPosition;
  let document: ChessDocument = {
    ...createEmptyChessDocument('analysis'),
    initialFen,
    currentFen: initialFen,
    headers: parsed.value.headers,
  };
  for (const token of pgnMoveTokens(parsed.value.moveText)) {
    const next = playChessDocumentMove(document, token, 0);
    if (!next.ok) return { ok: false, message: `PGN move ${token}: ${next.message}` };
    document = next.value;
  }
  const resultToken = /(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)\s*$/.exec(pgn.trim())?.[1] as
    ChessResult | undefined;
  if (resultToken && resultToken !== '*' && document.result === '*') {
    document = {
      ...document,
      result: resultToken,
      termination: resultToken === '1/2-1/2' ? 'draw_agreement' : 'resignation',
    };
  }
  return { ok: true, value: document };
}

function parseClock(value: unknown): ChessDocumentResult<ChessClockState | null> {
  if (value === null) return { ok: true, value: null };
  if (!isPlainObject(value)) return { ok: false, message: 'clock must be an object or null.' };
  const unknown = exactKeys(value, CLOCK_KEYS);
  if (unknown) return { ok: false, message: `clock contains unsupported field: ${unknown}.` };
  for (const key of CLOCK_KEYS) {
    if (!isSafeInteger(value[key], 0, MAX_CLOCK_MS)) {
      return { ok: false, message: `clock.${key} must be a bounded non-negative integer.` };
    }
  }
  if (value['initialMs'] === 0) return { ok: false, message: 'clock.initialMs must be positive.' };
  return {
    ok: true,
    value: {
      initialMs: value['initialMs'] as number,
      incrementMs: value['incrementMs'] as number,
      whiteMs: value['whiteMs'] as number,
      blackMs: value['blackMs'] as number,
    },
  };
}

function parseAnnotations(
  value: unknown,
  maximumPly: number,
): ChessDocumentResult<readonly ChessAnnotation[]> {
  if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS) {
    return { ok: false, message: 'annotations must be a bounded array.' };
  }
  const result: ChessAnnotation[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw) || typeof raw['kind'] !== 'string') {
      return { ok: false, message: 'annotation must be an object with a kind.' };
    }
    if (typeof raw['id'] !== 'string' || !SAFE_ID_PATTERN.test(raw['id']) || ids.has(raw['id'])) {
      return { ok: false, message: 'annotation id must be unique and safe.' };
    }
    if (!isSafeInteger(raw['ply'], 0, maximumPly)) {
      return { ok: false, message: 'annotation ply is outside the game history.' };
    }
    ids.add(raw['id']);
    if (raw['kind'] === 'arrow') {
      const allowed = new Set(['id', 'kind', 'ply', 'from', 'to', 'color']);
      const unknown = exactKeys(raw, allowed);
      if (
        unknown ||
        !isSquare(raw['from']) ||
        !isSquare(raw['to']) ||
        !ANNOTATION_COLORS.has(String(raw['color']))
      ) {
        return { ok: false, message: 'invalid arrow annotation.' };
      }
      result.push({
        id: raw['id'],
        kind: 'arrow',
        ply: raw['ply'] as number,
        from: raw['from'],
        to: raw['to'],
        color: raw['color'] as ChessArrowAnnotation['color'],
      });
      continue;
    }
    if (raw['kind'] === 'square') {
      const allowed = new Set(['id', 'kind', 'ply', 'square', 'color']);
      const unknown = exactKeys(raw, allowed);
      if (unknown || !isSquare(raw['square']) || !ANNOTATION_COLORS.has(String(raw['color']))) {
        return { ok: false, message: 'invalid square annotation.' };
      }
      result.push({
        id: raw['id'],
        kind: 'square',
        ply: raw['ply'] as number,
        square: raw['square'],
        color: raw['color'] as ChessSquareAnnotation['color'],
      });
      continue;
    }
    if (raw['kind'] === 'comment') {
      const allowed = new Set(['id', 'kind', 'ply', 'text']);
      const unknown = exactKeys(raw, allowed);
      if (
        unknown ||
        typeof raw['text'] !== 'string' ||
        raw['text'].trim().length === 0 ||
        raw['text'].length > MAX_COMMENT_LENGTH
      ) {
        return { ok: false, message: 'invalid comment annotation.' };
      }
      result.push({
        id: raw['id'],
        kind: 'comment',
        ply: raw['ply'] as number,
        text: raw['text'].trim(),
      });
      continue;
    }
    return { ok: false, message: `unsupported annotation kind: ${raw['kind']}.` };
  }
  return { ok: true, value: result };
}

function parseHeaders(value: unknown): ChessDocumentResult<Readonly<Record<string, string>>> {
  if (!isPlainObject(value) || Object.keys(value).length > 50) {
    return { ok: false, message: 'headers must be a bounded object.' };
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (
      !HEADER_KEY_PATTERN.test(key) ||
      typeof headerValue !== 'string' ||
      headerValue.length > 500
    ) {
      return { ok: false, message: `invalid PGN header: ${key}.` };
    }
    headers[key] = headerValue.replace(/[\r\n]/g, ' ');
  }
  return { ok: true, value: headers };
}

export function validateChessDocument(value: unknown): ChessDocumentResult<ChessDocument> {
  if (!isPlainObject(value)) return { ok: false, message: 'Chess document must be an object.' };
  const unknownTopLevel = exactKeys(value, TOP_LEVEL_KEYS);
  if (unknownTopLevel) {
    return { ok: false, message: `Chess document contains unsupported field: ${unknownTopLevel}.` };
  }
  if (value['schemaVersion'] !== 1 || value['variant'] !== 'standard') {
    return { ok: false, message: 'Unsupported chess document version or variant.' };
  }
  if (value['mode'] !== 'analysis' && value['mode'] !== 'local' && value['mode'] !== 'computer') {
    return { ok: false, message: 'Unsupported chess mode.' };
  }
  if (value['orientation'] !== 'white' && value['orientation'] !== 'black') {
    return { ok: false, message: 'Board orientation must be white or black.' };
  }
  if (typeof value['initialFen'] !== 'string' || typeof value['currentFen'] !== 'string') {
    return { ok: false, message: 'Chess document FEN fields must be strings.' };
  }
  const initial = parseFen(value['initialFen']);
  if (!initial.ok) return { ok: false, message: `initialFen: ${initial.message}` };
  const current = parseFen(value['currentFen']);
  if (!current.ok) return { ok: false, message: `currentFen: ${current.message}` };
  const clock = parseClock(value['clock']);
  if (!clock.ok) return clock;
  if (value['mode'] === 'analysis' && clock.value !== null) {
    return { ok: false, message: 'Analysis mode must not persist a running game clock.' };
  }
  if (value['mode'] !== 'analysis' && clock.value === null) {
    return { ok: false, message: 'Playable chess modes require a clock configuration.' };
  }

  let bot: ChessDocument['bot'] = null;
  if (value['bot'] !== null) {
    if (!isPlainObject(value['bot']))
      return { ok: false, message: 'bot must be an object or null.' };
    const unknown = exactKeys(value['bot'], BOT_KEYS);
    if (unknown) return { ok: false, message: `bot contains unsupported field: ${unknown}.` };
    if (
      (value['bot']['color'] !== 'white' && value['bot']['color'] !== 'black') ||
      !isSafeInteger(value['bot']['level'], 1, 3)
    ) {
      return { ok: false, message: 'Invalid bot color or level.' };
    }
    const profileId = value['bot']['profileId'];
    if (profileId !== undefined) {
      if (typeof profileId !== 'string') {
        return { ok: false, message: 'bot.profileId must be a stable ASA profile id.' };
      }
      const profile = ASA_BOT_PROFILES.find((candidate) => candidate.id === profileId);
      if (!profile) {
        return { ok: false, message: 'bot.profileId does not name an ASA bot profile.' };
      }
      if (profile.engine.level !== value['bot']['level']) {
        return { ok: false, message: 'bot level must match the selected ASA bot profile.' };
      }
    }
    bot = {
      color: value['bot']['color'],
      level: value['bot']['level'] as BotLevel,
      ...(profileId === undefined ? {} : { profileId }),
    };
  }
  if ((value['mode'] === 'computer') !== (bot !== null)) {
    return { ok: false, message: 'Computer mode requires exactly one bot configuration.' };
  }

  if (!Array.isArray(value['moves']) || value['moves'].length > MAX_MOVES) {
    return { ok: false, message: 'moves must be a bounded array.' };
  }
  const moves: ChessMoveRecord[] = [];
  let position = initial.value;
  let expectedFen = value['initialFen'];
  let previousClock = clock.value;
  for (let index = 0; index < value['moves'].length; index += 1) {
    const raw = value['moves'][index];
    if (!isPlainObject(raw)) return { ok: false, message: `Move ${index + 1} must be an object.` };
    const unknown = exactKeys(raw, MOVE_KEYS);
    if (unknown)
      return { ok: false, message: `Move ${index + 1} contains unsupported field: ${unknown}.` };
    if (
      raw['ply'] !== index + 1 ||
      typeof raw['uci'] !== 'string' ||
      typeof raw['san'] !== 'string'
    ) {
      return { ok: false, message: `Move ${index + 1} has invalid ply or notation.` };
    }
    if (raw['fenBefore'] !== expectedFen || typeof raw['fenAfter'] !== 'string') {
      return { ok: false, message: `Move ${index + 1} FEN chain is inconsistent.` };
    }
    const applied = applyLegalMove(position, raw['uci']);
    if (!applied.ok) return { ok: false, message: `Move ${index + 1}: ${applied.message}` };
    const fenAfter = toFen(applied.value.position);
    if (raw['san'] !== applied.value.san || raw['fenAfter'] !== fenAfter) {
      return { ok: false, message: `Move ${index + 1} notation or resulting FEN is inconsistent.` };
    }
    let clockAfter: ChessMoveRecord['clockAfter'];
    if (raw['clockAfter'] !== undefined) {
      if (!isPlainObject(raw['clockAfter'])) {
        return { ok: false, message: `Move ${index + 1} clockAfter must be an object.` };
      }
      const allowed = new Set(['whiteMs', 'blackMs']);
      const unknownClock = exactKeys(raw['clockAfter'], allowed);
      if (
        unknownClock ||
        !isSafeInteger(raw['clockAfter']['whiteMs'], 0, MAX_CLOCK_MS) ||
        !isSafeInteger(raw['clockAfter']['blackMs'], 0, MAX_CLOCK_MS)
      ) {
        return { ok: false, message: `Move ${index + 1} has invalid clockAfter.` };
      }
      clockAfter = {
        whiteMs: raw['clockAfter']['whiteMs'],
        blackMs: raw['clockAfter']['blackMs'],
      };
      previousClock = previousClock
        ? { ...previousClock, whiteMs: clockAfter.whiteMs, blackMs: clockAfter.blackMs }
        : null;
    } else if (clock.value !== null) {
      return { ok: false, message: `Move ${index + 1} must preserve clockAfter.` };
    }
    moves.push({
      ply: index + 1,
      uci: raw['uci'],
      san: raw['san'],
      fenBefore: expectedFen,
      fenAfter,
      ...(clockAfter === undefined ? {} : { clockAfter }),
    });
    position = applied.value.position;
    expectedFen = fenAfter;
  }
  if (value['currentFen'] !== expectedFen) {
    return { ok: false, message: 'currentFen does not match the replayed move history.' };
  }
  if (clock.value && previousClock) {
    if (
      clock.value.whiteMs !== previousClock.whiteMs ||
      clock.value.blackMs !== previousClock.blackMs
    ) {
      return { ok: false, message: 'Current clock does not match the final move clock.' };
    }
  }

  const annotations = parseAnnotations(value['annotations'], moves.length);
  if (!annotations.ok) return annotations;
  const headers = parseHeaders(value['headers']);
  if (!headers.ok) return headers;
  if (!isResult(value['result'])) return { ok: false, message: 'Invalid chess result.' };
  const terminations: readonly ChessTermination[] = [
    'ongoing',
    'checkmate',
    'stalemate',
    'fifty_move',
    'threefold',
    'insufficient_material',
    'resignation',
    'timeout',
    'draw_agreement',
  ];
  if (!terminations.includes(value['termination'] as ChessTermination)) {
    return { ok: false, message: 'Invalid chess termination.' };
  }
  const termination = value['termination'] as ChessTermination;
  if ((value['result'] === '*') !== (termination === 'ongoing')) {
    return { ok: false, message: 'Chess result and termination are inconsistent.' };
  }
  const automatic = getChessStatus(position, [
    positionKey(initial.value),
    ...moves.map((move) =>
      positionKey(
        parseFen(move.fenAfter).ok
          ? (parseFen(move.fenAfter) as { ok: true; value: ChessPosition }).value
          : position,
      ),
    ),
  ]);
  const automaticTermination = terminationFromStatus(automatic);
  if (
    automaticTermination !== 'ongoing' &&
    (termination !== automaticTermination || value['result'] !== automatic.result)
  ) {
    return { ok: false, message: 'Automatic game result does not match the final position.' };
  }
  if (
    automaticTermination === 'ongoing' &&
    termination !== 'ongoing' &&
    termination !== 'resignation' &&
    termination !== 'timeout' &&
    termination !== 'draw_agreement'
  ) {
    return { ok: false, message: 'Manual game termination is invalid for the final position.' };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      variant: 'standard',
      mode: value['mode'],
      initialFen: value['initialFen'],
      currentFen: value['currentFen'],
      orientation: value['orientation'],
      moves,
      clock: clock.value,
      bot,
      annotations: annotations.value,
      result: value['result'],
      termination,
      headers: headers.value,
    },
  };
}
