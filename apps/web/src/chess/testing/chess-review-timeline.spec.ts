import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AsaMoveReview } from '@asa-lab/chess';
import { ChessReviewTimeline, reviewEvaluationPercent } from '../ChessReviewTimeline';

function move(ply: number, evaluationAfterCp: number): AsaMoveReview {
  return {
    ply,
    color: ply % 2 === 1 ? 'white' : 'black',
    playedUci: ply === 1 ? 'e2e4' : 'e7e5',
    playedSan: ply === 1 ? 'e4' : 'e5',
    fenBefore: 'fixture-before',
    fenAfter: 'fixture-after',
    bestUci: null,
    bestRoot: null,
    evaluationBeforeCp: 0,
    evaluationAfterCp,
    bestEvaluationAfterCp: evaluationAfterCp,
    centipawnLoss: 0,
    classification: 'best',
    asaQuality: 100,
  };
}

describe('Chess review evaluation timeline', () => {
  it('renders exactly one accessible selectable point per reviewed ply', () => {
    const html = renderToStaticMarkup(
      createElement(ChessReviewTimeline, {
        moves: [move(1, 35), move(2, -80)],
        selectedPly: 2,
        onSelect: vi.fn(),
      }),
    );

    expect(html.match(/data-review-timeline-point=/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Полуход 1: e4, оценка +0.3"');
    expect(html).toMatch(/data-review-timeline-point="2"[^>]*aria-pressed="true"/);
    expect(html).toContain('<polyline points=');
  });

  it('keeps extreme and invalid evaluations inside the visible band', () => {
    expect(reviewEvaluationPercent(0)).toBe(50);
    expect(reviewEvaluationPercent(100_000)).toBe(96);
    expect(reviewEvaluationPercent(-100_000)).toBe(4);
    expect(reviewEvaluationPercent(Number.NaN)).toBe(50);
  });
});
