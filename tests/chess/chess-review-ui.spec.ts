import { describe, expect, it } from 'vitest';
import { chessReviewDisplayFen } from '../../apps/web/src/chess/chess-review-ui';

describe('Chess review board position selection', () => {
  it('shows the selected ply position instead of the final game position', () => {
    expect(chessReviewDisplayFen('final-fen', 'selected-fen-after', null)).toBe(
      'selected-fen-after',
    );
  });

  it('gives an active retry exact pre-error position priority', () => {
    expect(chessReviewDisplayFen('final-fen', 'selected-fen-after', 'retry-fen-before')).toBe(
      'retry-fen-before',
    );
  });

  it('falls back to the final position when no move is selected', () => {
    expect(chessReviewDisplayFen('final-fen', null, null)).toBe('final-fen');
  });
});
