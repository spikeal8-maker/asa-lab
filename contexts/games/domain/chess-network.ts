import {
  agreeDrawChessDocument,
  createChessGameDocument,
  flagChessTimeout,
  parseFen,
  playChessDocumentMove,
  resignChessDocument,
  type ChessDocument,
} from '@asa-lab/chess';
import type { ChessNetworkAction, ChessNetworkMatch, ChessNetworkScope } from '@asa-lab/contracts';

export interface NetworkChessState {
  document: ChessDocument;
  turnStartedAt: number;
  lastServerNow: number;
  drawOfferedBy: string | null;
}
export interface NetworkMatchRecord {
  id: string;
  status: 'active' | 'finished' | 'aborted';
  version: number;
  sequence: number;
  scope: ChessNetworkScope;
  white: { playerId: string; displayAlias: string };
  black: { playerId: string; displayAlias: string };
  state: NetworkChessState;
  updatedAt: number;
  termination: string;
}
export class ChessNetworkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}
export function createNetworkChess(
  initialMs: number,
  incrementMs: number,
  now: number,
): NetworkChessState {
  if (
    !Number.isSafeInteger(initialMs) ||
    initialMs < 60_000 ||
    initialMs > 3_600_000 ||
    !Number.isSafeInteger(incrementMs) ||
    incrementMs < 0 ||
    incrementMs > 60_000
  ) {
    throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный контроль времени.', 400);
  }
  if (!Number.isSafeInteger(now) || now < 0)
    throw new ChessNetworkError('UNAVAILABLE', 'Серверные часы недоступны.', 503);
  return {
    document: createChessGameDocument({ mode: 'local', initialMs, incrementMs }),
    turnStartedAt: now,
    lastServerNow: now,
    drawOfferedBy: null,
  };
}
function timing(state: NetworkChessState, now: number) {
  const parsed = parseFen(state.document.currentFen);
  if (!parsed.ok || !state.document.clock || !Number.isSafeInteger(now)) {
    throw new ChessNetworkError('INVALID_STATE', 'Позиция партии повреждена.');
  }
  const at = Math.max(now, state.lastServerNow);
  return { color: parsed.value.turn, at, elapsed: Math.max(0, at - state.turnStartedAt) };
}
export function expireNetworkChess(state: NetworkChessState, now: number): NetworkChessState {
  if (state.document.result !== '*') return state;
  const clock = timing(state, now);
  const remaining =
    clock.color === 'white' ? state.document.clock!.whiteMs : state.document.clock!.blackMs;
  return clock.elapsed >= remaining
    ? {
        ...state,
        document: flagChessTimeout(state.document, clock.color),
        lastServerNow: clock.at,
        drawOfferedBy: null,
      }
    : state;
}
export function applyNetworkChess(
  record: NetworkMatchRecord,
  actor: string,
  action: ChessNetworkAction,
  uci: string | undefined,
  now: number,
): NetworkChessState {
  if (record.status !== 'active') throw new ChessNetworkError('INVALID_STATE', 'Партия завершена.');
  const color =
    record.white.playerId === actor ? 'white' : record.black.playerId === actor ? 'black' : null;
  if (!color) throw new ChessNetworkError('FORBIDDEN', 'Нет доступа к партии.', 403);
  const state = expireNetworkChess(record.state, now);
  if (state.document.result !== '*') return state;
  const clock = timing(state, now);
  let document = state.document;
  let drawOfferedBy = state.drawOfferedBy;
  if (action === 'move') {
    if (color !== clock.color)
      throw new ChessNetworkError('NOT_YOUR_TURN', 'Сейчас ход соперника.');
    if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
      throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный ход.', 400);
    }
    const moved = playChessDocumentMove(document, uci, clock.elapsed);
    if (!moved.ok) throw new ChessNetworkError('ILLEGAL_MOVE', 'Этот ход невозможен.');
    document = moved.value;
    drawOfferedBy = null;
    return { document, drawOfferedBy, turnStartedAt: clock.at, lastServerNow: clock.at };
  }
  if (action === 'resign') {
    const resigned = resignChessDocument(document, color);
    if (!resigned.ok) throw new ChessNetworkError('INVALID_STATE', resigned.message);
    document = resigned.value;
  } else if (action === 'draw-offer') {
    if (drawOfferedBy)
      throw new ChessNetworkError('INVALID_STATE', 'Предложение ничьей уже отправлено.');
    drawOfferedBy = actor;
  } else {
    if (!drawOfferedBy || drawOfferedBy === actor)
      throw new ChessNetworkError('INVALID_STATE', 'Нет предложения соперника.');
    if (action === 'draw-accept') {
      const agreed = agreeDrawChessDocument(document);
      if (!agreed.ok) throw new ChessNetworkError('INVALID_STATE', agreed.message);
      document = agreed.value;
    }
    drawOfferedBy = null;
  }
  if (document.result !== '*' && document.clock)
    document = {
      ...document,
      clock: {
        ...document.clock,
        whiteMs: Math.max(
          0,
          document.clock.whiteMs - (clock.color === 'white' ? clock.elapsed : 0),
        ),
        blackMs: Math.max(
          0,
          document.clock.blackMs - (clock.color === 'black' ? clock.elapsed : 0),
        ),
      },
    };
  return { ...state, document, drawOfferedBy, lastServerNow: clock.at };
}
export function networkMatchView(
  record: NetworkMatchRecord,
  actor: string,
  now: number,
): ChessNetworkMatch {
  const { document } = record.state;
  const clock = timing(record.state, now);
  const elapsed = record.status === 'active' ? clock.elapsed : 0;
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    sequence: record.sequence,
    scope: record.scope,
    white: record.white,
    black: record.black,
    viewerColor: record.white.playerId === actor ? 'white' : 'black',
    currentFen: document.currentFen,
    moves: document.moves.map(({ uci, san }) => ({ uci, san })),
    whiteRemainingMs: Math.max(
      0,
      document.clock!.whiteMs - (clock.color === 'white' ? elapsed : 0),
    ),
    blackRemainingMs: Math.max(
      0,
      document.clock!.blackMs - (clock.color === 'black' ? elapsed : 0),
    ),
    activeColor: clock.color,
    serverNowMs: clock.at,
    result: record.status === 'aborted' ? '*' : document.result,
    termination: record.termination || document.termination,
    drawOfferedBy: record.state.drawOfferedBy,
    updatedAt: record.updatedAt,
  };
}
