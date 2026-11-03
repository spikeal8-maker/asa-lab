import {
  applyCheckersGameMove,
  createInitialCheckersDocument,
  getCheckersGameStatus,
  validateCheckersDocument,
  type CheckersDocument,
  type CheckersSquare,
} from '@asa-lab/checkers';
import type {
  CheckersNetworkMatch,
  ChessNetworkAction,
  ChessNetworkScope,
} from '@asa-lab/contracts';
import { ChessNetworkError } from './chess-network.js';

export interface NetworkCheckersState {
  document: CheckersDocument;
  clock: { whiteMs: number; blackMs: number; incrementMs: number };
  turnStartedAt: number;
  lastServerNow: number;
  drawOfferedBy: string | null;
  termination: string;
}
export interface NetworkCheckersRecord {
  id: string;
  status: 'active' | 'finished' | 'aborted';
  version: number;
  sequence: number;
  scope: ChessNetworkScope;
  white: { playerId: string; displayAlias: string };
  black: { playerId: string; displayAlias: string };
  state: NetworkCheckersState;
  updatedAt: number;
  termination: string;
}
export function createNetworkCheckers(
  initialMs: number,
  incrementMs: number,
  now: number,
): NetworkCheckersState {
  if (
    !Number.isSafeInteger(initialMs) ||
    initialMs < 60000 ||
    initialMs > 3600000 ||
    !Number.isSafeInteger(incrementMs) ||
    incrementMs < 0 ||
    incrementMs > 60000
  )
    throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный контроль времени.', 400);
  if (!Number.isSafeInteger(now) || now < 0)
    throw new ChessNetworkError('UNAVAILABLE', 'Серверные часы недоступны.', 503);
  return {
    document: createInitialCheckersDocument('game'),
    clock: { whiteMs: initialMs, blackMs: initialMs, incrementMs },
    turnStartedAt: now,
    lastServerNow: now,
    drawOfferedBy: null,
    termination: '',
  };
}
function timing(state: NetworkCheckersState, now: number) {
  if (
    !validateCheckersDocument(state.document).ok ||
    !state.clock ||
    !Number.isSafeInteger(now) ||
    ![
      state.clock.whiteMs,
      state.clock.blackMs,
      state.clock.incrementMs,
      state.turnStartedAt,
      state.lastServerNow,
    ].every(Number.isSafeInteger)
  )
    throw new ChessNetworkError('INVALID_STATE', 'Позиция партии повреждена.');
  const at = Math.max(now, state.lastServerNow);
  return {
    at,
    color: state.document.sideToMove === 'light' ? ('white' as const) : ('black' as const),
    elapsed: Math.max(0, at - state.turnStartedAt),
  };
}
export function expireNetworkCheckers(
  state: NetworkCheckersState,
  now: number,
): NetworkCheckersState {
  if (state.document.result !== '*') return state;
  const t = timing(state, now);
  if (t.elapsed < (t.color === 'white' ? state.clock.whiteMs : state.clock.blackMs)) return state;
  return {
    ...state,
    document: { ...state.document, result: t.color === 'white' ? '0-1' : '1-0' },
    clock: { ...state.clock, [t.color === 'white' ? 'whiteMs' : 'blackMs']: 0 },
    lastServerNow: t.at,
    termination: 'timeout',
    drawOfferedBy: null,
  };
}
export function applyNetworkCheckers(
  record: NetworkCheckersRecord,
  actor: string,
  action: ChessNetworkAction,
  path: readonly string[] | undefined,
  now: number,
): NetworkCheckersState {
  if (record.status !== 'active') throw new ChessNetworkError('INVALID_STATE', 'Партия завершена.');
  const color =
    record.white.playerId === actor ? 'white' : record.black.playerId === actor ? 'black' : null;
  if (!color) throw new ChessNetworkError('FORBIDDEN', 'Нет доступа к партии.', 403);
  const state = expireNetworkCheckers(record.state, now);
  if (state.document.result !== '*') return state;
  const t = timing(state, now);
  if (action === 'move') {
    if (color !== t.color) throw new ChessNetworkError('NOT_YOUR_TURN', 'Сейчас ход соперника.');
    if (
      !Array.isArray(path) ||
      path.length < 2 ||
      path.length > 13 ||
      path.some((square) => typeof square !== 'string' || !/^[a-h][1-8]$/.test(square))
    )
      throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный путь хода.', 400);
    const piece = state.document.pieces.find(
      (p) => p.square === path[0] && p.side === state.document.sideToMove,
    );
    if (!piece) throw new ChessNetworkError('ILLEGAL_MOVE', 'Выберите свою шашку.');
    const moved = applyCheckersGameMove(state.document, {
      pieceId: piece.id,
      path: path as CheckersSquare[],
    });
    if (!moved.ok)
      throw new ChessNetworkError('ILLEGAL_MOVE', 'Этот ход невозможен. Взятие обязательно.');
    const status = getCheckersGameStatus(moved.value);
    const clockKey = color === 'white' ? 'whiteMs' : 'blackMs';
    return {
      ...state,
      document: moved.value,
      clock: {
        ...state.clock,
        [clockKey]: state.clock[clockKey] - t.elapsed + state.clock.incrementMs,
      },
      turnStartedAt: t.at,
      lastServerNow: t.at,
      drawOfferedBy: null,
      termination:
        moved.value.result === '*'
          ? ''
          : status.state === 'draw'
            ? 'automatic-draw'
            : status.reason,
    };
  }
  let document = state.document,
    drawOfferedBy = state.drawOfferedBy,
    termination = state.termination;
  if (action === 'resign') {
    document = { ...document, result: color === 'white' ? '0-1' : '1-0' };
    termination = 'resignation';
    drawOfferedBy = null;
  } else if (action === 'draw-offer') {
    if (drawOfferedBy)
      throw new ChessNetworkError('INVALID_STATE', 'Предложение ничьей уже отправлено.');
    drawOfferedBy = actor;
  } else if (action === 'draw-accept' || action === 'draw-decline') {
    if (!drawOfferedBy || drawOfferedBy === actor)
      throw new ChessNetworkError('INVALID_STATE', 'Нет предложения соперника.');
    if (action === 'draw-accept') {
      document = { ...document, result: '1/2-1/2' };
      termination = 'agreement';
    }
    drawOfferedBy = null;
  } else throw new ChessNetworkError('INVALID_COMMAND', 'Неизвестное действие.', 400);
  const clock =
    document.result === '*'
      ? state.clock
      : {
          ...state.clock,
          [t.color === 'white' ? 'whiteMs' : 'blackMs']: Math.max(
            0,
            (t.color === 'white' ? state.clock.whiteMs : state.clock.blackMs) - t.elapsed,
          ),
        };
  return { ...state, document, clock, drawOfferedBy, termination, lastServerNow: t.at };
}
export function checkersNetworkMatchView(
  record: NetworkCheckersRecord,
  actor: string,
  now: number,
): CheckersNetworkMatch {
  const t = timing(record.state, now),
    state = record.state;
  const elapsed = record.status === 'active' ? t.elapsed : 0;
  return {
    id: record.id,
    status: record.status,
    version: record.version,
    sequence: record.sequence,
    scope: record.scope,
    white: record.white,
    black: record.black,
    viewerColor: record.white.playerId === actor ? 'white' : 'black',
    position: state.document,
    moves: state.document.moveHistory.map((m) => ({
      path: m.path,
      notation: m.path.join(m.capturedIds.length ? '×' : '–'),
    })),
    whiteRemainingMs: Math.max(0, state.clock.whiteMs - (t.color === 'white' ? elapsed : 0)),
    blackRemainingMs: Math.max(0, state.clock.blackMs - (t.color === 'black' ? elapsed : 0)),
    activeColor: t.color,
    serverNowMs: t.at,
    result: record.status === 'aborted' ? '*' : state.document.result,
    termination: record.termination || state.termination,
    drawOfferedBy: state.drawOfferedBy,
    updatedAt: record.updatedAt,
  };
}
