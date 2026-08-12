import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  createEmptyChessDocument,
  playChessDocumentMove,
  reviewChessDocument,
  type ChessDocument,
} from '@asa-lab/chess';
import { ChessReviewExplanation } from '../ChessReviewExplanation';

function play(document: ChessDocument, uci: string): ChessDocument {
  const result = playChessDocumentMove(document, uci);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('Chess review factual explanation', () => {
  it('renders only facts verified from the selected canonical review root', () => {
    let document = createEmptyChessDocument();
    for (const uci of ['e2e4', 'c7c6', 'f1b5', 'e7e5']) document = play(document, uci);
    const review = reviewChessDocument(document, 1);
    const move = review.moves.at(-1);
    if (!move) throw new Error('expected a reviewed move');

    const html = renderToStaticMarkup(
      createElement(ChessReviewExplanation, { review, ply: move.ply }),
    );

    expect(html).toContain('aria-label="Проверенные факты разбора"');
    expect(html).toContain('data-review-fact="evaluation_loss"');
    expect(html).toContain('data-review-fact="best_capture"');
    expect(html).toContain('немедленно забирал слона');
    expect(html).not.toMatch(/вилка|связк|стратегический план/i);
  });

  it('does not add an explanation when the played move is already the verified best', () => {
    const document = play(createEmptyChessDocument(), 'e2e4');
    const review = reviewChessDocument(document, 1);
    const move = review.moves[0];
    if (!move) throw new Error('expected a reviewed move');

    expect(
      renderToStaticMarkup(createElement(ChessReviewExplanation, { review, ply: move.ply })),
    ).toBe('');
  });
});
