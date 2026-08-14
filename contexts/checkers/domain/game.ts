import {
  createInitialCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
} from './document.js';
import {
  advanceCheckersDrawTracker,
  checkersPositionKey,
  createCheckersDrawTracker,
  getCheckersAutomaticDrawReason,
  type CheckersDrawTracker,
} from './draw.js';
import { applyCheckersMove, type CheckersMoveInput } from './rules.js';

function rebuildStandardGameTracker(
  source: CheckersDocument,
): CheckersDocumentResult<CheckersDrawTracker> {
  let replay = createInitialCheckersDocument('game');
  let tracker = createCheckersDrawTracker(replay);
  for (const expected of source.moveHistory) {
    const before = replay;
    const applied = applyCheckersMove(replay, {
      pieceId: expected.pieceId,
      path: expected.path,
    });
    if (!applied.ok) {
      return { ok: false, message: `game history cannot replay move ${expected.ply}` };
    }
    const actual = applied.value.moveHistory.at(-1)!;
    if (
      actual.capturedIds.join(',') !== expected.capturedIds.join(',') ||
      actual.promoted !== expected.promoted
    ) {
      return { ok: false, message: `game history differs at move ${expected.ply}` };
    }
    replay = applied.value;
    tracker = advanceCheckersDrawTracker(tracker, before, replay);
  }
  if (
    replay.sideToMove !== source.sideToMove ||
    checkersPositionKey(replay) !== checkersPositionKey(source)
  ) {
    return { ok: false, message: 'game position does not match its move history' };
  }
  return { ok: true, value: tracker };
}

/**
 * Applies a move to a standard persisted game and enforces repetition and the
 * official endgame move counters without adding hidden mutable state to the
 * versioned document. The deterministic tracker is rebuilt from move history.
 */
export function applyCheckersGameMove(
  source: CheckersDocument,
  move: CheckersMoveInput,
): CheckersDocumentResult<CheckersDocument> {
  if (source.mode !== 'game') return applyCheckersMove(source, move);
  const tracker = rebuildStandardGameTracker(source);
  if (!tracker.ok) return tracker;
  const applied = applyCheckersMove(source, move);
  if (!applied.ok || applied.value.result !== '*') return applied;
  const advanced = advanceCheckersDrawTracker(tracker.value, source, applied.value);
  return getCheckersAutomaticDrawReason(advanced, applied.value)
    ? { ok: true, value: { ...applied.value, result: '1/2-1/2' } }
    : applied;
}
