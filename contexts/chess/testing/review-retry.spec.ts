import { describe, expect, it } from 'vitest';
import { START_FEN, applyLegalMove, parseFen, toFen } from '../domain/chess';
import {
  canCreateReviewRetry,
  createChessReviewRetrySession,
  createPrivateReviewTrainingItem,
  playChessReviewRetryMove,
  requestChessReviewRetryHint,
  resetChessReviewRetrySession,
} from '../domain/review-retry';
import type { AsaMoveReview } from '../domain/review';

function appliedFen(uci: string): string {
  const root = parseFen(START_FEN);
  if (!root.ok) throw new Error(root.message);
  const result = applyLegalMove(root.value, uci);
  if (!result.ok) throw new Error(result.message);
  return toFen(result.value.position);
}

function retryableMove(): AsaMoveReview {
  const fenAfter = appliedFen('e2e4');
  const bestFenAfter = appliedFen('d2d4');
  return {
    ply: 1,
    color: 'white',
    playedUci: 'e2e4',
    playedSan: 'e4',
    fenBefore: START_FEN,
    fenAfter,
    bestUci: 'd2d4',
    bestRoot: { fenBefore: START_FEN, moveUci: 'd2d4', fenAfter: bestFenAfter },
    evaluationBeforeCp: 0,
    evaluationAfterCp: -180,
    bestEvaluationAfterCp: 40,
    centipawnLoss: 220,
    classification: 'mistake',
    asaQuality: 29,
  };
}

describe('review retry training foundation', () => {
  it('creates a typed private item from one canonical reviewed error without mutation', () => {
    const move = retryableMove();
    const before = structuredClone(move);
    const created = createPrivateReviewTrainingItem('project-123', move);

    expect(created).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        kind: 'review-retry',
        visibility: 'private',
        id: 'review-retry:project-123:1',
        projectId: 'project-123',
        source: {
          ply: 1,
          fenBefore: START_FEN,
          playedUci: 'e2e4',
          bestUci: 'd2d4',
        },
      },
    });
    expect(move).toEqual(before);
  });

  it('accepts only the legal reviewed best move and never advances after a wrong move', () => {
    const created = createPrivateReviewTrainingItem('project-123', retryableMove());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const session = createChessReviewRetrySession(created.value);
    const wrong = playChessReviewRetryMove(created.value, session, 'g1f3');
    expect(wrong).toMatchObject({
      ok: false,
      outcome: 'incorrect',
      session: {
        currentFen: START_FEN,
        status: 'active',
        attempts: 1,
        mistakes: 1,
        playedUci: 'g1f3',
      },
    });
    const solved = playChessReviewRetryMove(created.value, wrong.session, 'd2d4');
    expect(solved).toMatchObject({
      ok: true,
      outcome: 'solved',
      session: {
        currentFen: created.value.source.bestFenAfter,
        status: 'solved',
        attempts: 2,
        mistakes: 1,
        playedUci: 'd2d4',
      },
    });
  });

  it('provides three progressive hint levels and resets attempt state', () => {
    const created = createPrivateReviewTrainingItem('project-123', retryableMove());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let session = createChessReviewRetrySession(created.value);
    const first = requestChessReviewRetryHint(created.value, session);
    expect(first).toMatchObject({ ok: true, value: { level: 1, from: 'd2' } });
    if (!first.ok) return;
    session = first.value.session;
    const second = requestChessReviewRetryHint(created.value, session);
    expect(second).toMatchObject({ ok: true, value: { level: 2, from: 'd2', to: 'd4' } });
    if (!second.ok) return;
    const third = requestChessReviewRetryHint(created.value, second.value.session);
    expect(third).toMatchObject({ ok: true, value: { level: 3, moveUci: 'd2d4' } });
    expect(resetChessReviewRetrySession(created.value)).toEqual(
      createChessReviewRetrySession(created.value),
    );
  });

  it('rejects non-errors, identical moves, unsafe project ids and non-canonical roots', () => {
    const move = retryableMove();
    expect(canCreateReviewRetry({ ...move, classification: 'good' })).toBe(false);
    expect(canCreateReviewRetry({ ...move, bestUci: move.playedUci })).toBe(false);
    expect(createPrivateReviewTrainingItem('', move)).toMatchObject({ ok: false });
    expect(
      createPrivateReviewTrainingItem('project-123', {
        ...move,
        bestRoot: move.bestRoot ? { ...move.bestRoot, fenAfter: move.fenAfter } : null,
      }),
    ).toEqual({ ok: false, message: 'Review retry source is not canonical.' });
  });
});
