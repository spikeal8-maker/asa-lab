import {
  applyLegalMove,
  applyMoveUnchecked,
  findLegalMoveByUci,
  moveToUci,
  parseFen,
  toFen,
  type Color,
  type Square,
} from './chess.js';
import type { AsaMoveReview } from './review.js';

export interface PrivateChessReviewTrainingItem {
  readonly schemaVersion: 1;
  readonly kind: 'review-retry';
  readonly visibility: 'private';
  readonly id: string;
  readonly projectId: string;
  readonly source: {
    readonly reviewAlgorithm: 'asa-review-v1';
    readonly ply: number;
    readonly color: Color;
    readonly fenBefore: string;
    readonly fenAfter: string;
    readonly playedUci: string;
    readonly bestUci: string;
    readonly bestFenAfter: string;
  };
}

export type ChessReviewRetryStatus = 'active' | 'solved';

export interface ChessReviewRetrySession {
  readonly trainingItemId: string;
  readonly currentFen: string;
  readonly status: ChessReviewRetryStatus;
  readonly attempts: number;
  readonly mistakes: number;
  readonly hintsUsed: number;
  readonly playedUci: string | null;
}

export type ChessReviewRetryResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export type ChessReviewRetryMoveResult =
  | {
      readonly ok: true;
      readonly outcome: 'solved';
      readonly session: ChessReviewRetrySession;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly outcome: 'incorrect' | 'finished' | 'invalid';
      readonly session: ChessReviewRetrySession;
      readonly message: string;
    };

export interface ChessReviewRetryHint {
  readonly level: 1 | 2 | 3;
  readonly from: Square;
  readonly to?: Square;
  readonly moveUci?: string;
  readonly message: string;
  readonly session: ChessReviewRetrySession;
}

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UCI_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function canCreateReviewRetry(move: AsaMoveReview): boolean {
  return (
    (move.classification === 'mistake' || move.classification === 'blunder') &&
    move.bestUci !== null &&
    move.bestUci !== move.playedUci
  );
}

export function createPrivateReviewTrainingItem(
  projectId: string,
  move: AsaMoveReview,
): ChessReviewRetryResult<PrivateChessReviewTrainingItem> {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return { ok: false, message: 'Project id must be safe and non-empty.' };
  }
  if (!canCreateReviewRetry(move) || !move.bestUci || !move.bestRoot) {
    return {
      ok: false,
      message: 'Only a mistake or blunder with a different legal best move can be retried.',
    };
  }
  const root = parseFen(move.fenBefore);
  if (!root.ok) return { ok: false, message: `Review root: ${root.message}` };
  const played = findLegalMoveByUci(root.value, move.playedUci);
  const best = findLegalMoveByUci(root.value, move.bestUci);
  if (!played || !best) {
    return { ok: false, message: 'Reviewed played and best moves must both be legal at the root.' };
  }
  const playedFenAfter = toFen(applyMoveUnchecked(root.value, played));
  const bestFenAfter = toFen(applyMoveUnchecked(root.value, best));
  if (
    move.fenBefore !== move.bestRoot.fenBefore ||
    move.bestUci !== move.bestRoot.moveUci ||
    move.fenAfter !== playedFenAfter ||
    move.bestRoot.fenAfter !== bestFenAfter
  ) {
    return { ok: false, message: 'Review retry source is not canonical.' };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      kind: 'review-retry',
      visibility: 'private',
      id: `review-retry:${projectId}:${move.ply}`,
      projectId,
      source: {
        reviewAlgorithm: 'asa-review-v1',
        ply: move.ply,
        color: root.value.turn,
        fenBefore: move.fenBefore,
        fenAfter: move.fenAfter,
        playedUci: move.playedUci,
        bestUci: move.bestUci,
        bestFenAfter,
      },
    },
  };
}

export function createChessReviewRetrySession(
  item: PrivateChessReviewTrainingItem,
): ChessReviewRetrySession {
  return {
    trainingItemId: item.id,
    currentFen: item.source.fenBefore,
    status: 'active',
    attempts: 0,
    mistakes: 0,
    hintsUsed: 0,
    playedUci: null,
  };
}

export function playChessReviewRetryMove(
  item: PrivateChessReviewTrainingItem,
  session: ChessReviewRetrySession,
  moveUci: string,
): ChessReviewRetryMoveResult {
  if (session.trainingItemId !== item.id) {
    return {
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Retry session belongs to another training item.',
    };
  }
  if (session.status === 'solved') {
    return {
      ok: false,
      outcome: 'finished',
      session,
      message: 'Этот момент уже успешно повторён.',
    };
  }
  if (!UCI_PATTERN.test(moveUci)) {
    return {
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Move must use UCI notation.',
    };
  }
  const parsed = parseFen(session.currentFen);
  if (!parsed.ok) {
    return { ok: false, outcome: 'invalid', session, message: parsed.message };
  }
  const move = findLegalMoveByUci(parsed.value, moveUci);
  if (!move) {
    return {
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Этот ход нелегален в исходной позиции.',
    };
  }
  if (moveUci !== item.source.bestUci) {
    return {
      ok: false,
      outcome: 'incorrect',
      session: {
        ...session,
        attempts: session.attempts + 1,
        mistakes: session.mistakes + 1,
        playedUci: moveToUci(move),
      },
      message: 'Ход легален, но это не лучший ответ из разбора. Попробуйте ещё раз.',
    };
  }
  const applied = applyLegalMove(parsed.value, moveUci);
  if (!applied.ok) {
    return { ok: false, outcome: 'invalid', session, message: applied.message };
  }
  const currentFen = toFen(applied.value.position);
  if (currentFen !== item.source.bestFenAfter) {
    return {
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Retry result does not match the reviewed best root.',
    };
  }
  return {
    ok: true,
    outcome: 'solved',
    session: {
      ...session,
      currentFen,
      status: 'solved',
      attempts: session.attempts + 1,
      playedUci: moveToUci(applied.value.move),
    },
    message: 'Верно. Вы нашли лучший ход из разбора.',
  };
}

export function requestChessReviewRetryHint(
  item: PrivateChessReviewTrainingItem,
  session: ChessReviewRetrySession,
): ChessReviewRetryResult<ChessReviewRetryHint> {
  if (session.status === 'solved') {
    return { ok: false, message: 'Этот момент уже успешно повторён.' };
  }
  const level = Math.min(3, session.hintsUsed + 1) as 1 | 2 | 3;
  const from = item.source.bestUci.slice(0, 2) as Square;
  const to = item.source.bestUci.slice(2, 4) as Square;
  const nextSession = { ...session, hintsUsed: session.hintsUsed + 1 };
  if (level === 1) {
    return {
      ok: true,
      value: {
        level,
        from,
        message: `Найдите возможность для фигуры на поле ${from}.`,
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
        message: `Проверьте ход с ${from} на ${to}.`,
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
      moveUci: item.source.bestUci,
      message: `Лучший ход разбора: ${item.source.bestUci}.`,
      session: nextSession,
    },
  };
}

export function resetChessReviewRetrySession(
  item: PrivateChessReviewTrainingItem,
): ChessReviewRetrySession {
  return createChessReviewRetrySession(item);
}
