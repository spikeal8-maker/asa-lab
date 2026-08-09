import { describe, expect, it } from 'vitest';
import { createEmptyChessDocument, playChessDocumentMove } from '../domain/document';
import { ASA_OPENING_BOOK, exploreChessOpening } from '../domain/opening-book';

describe('ASA curated opening explorer', () => {
  it('contains unique independently authored lines', () => {
    expect(ASA_OPENING_BOOK.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ASA_OPENING_BOOK.map((opening) => opening.id)).size).toBe(
      ASA_OPENING_BOOK.length,
    );
    for (const opening of ASA_OPENING_BOOK) {
      expect(opening.eco).toMatch(/^[A-E][0-9]{2}$/);
      expect(opening.sanMoves.length).toBeGreaterThan(0);
      expect(opening.ideas.length).toBeGreaterThan(0);
      expect(opening.warnings.length).toBeGreaterThan(0);
    }
  });

  it('suggests original educational continuations from the start', () => {
    const result = exploreChessOpening([]);
    expect(result.matched).toBeNull();
    expect(result.suggestions.map((suggestion) => suggestion.san)).toEqual(
      expect.arrayContaining(['c4', 'd4', 'e4']),
    );
    expect(result.source).toBe('asa-curated-v1');
    expect(result.note).toContain('No external game-database statistics');
  });

  it('recognizes the Spanish opening from a ChessDocument', () => {
    let document = createEmptyChessDocument('analysis');
    for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) {
      const next = playChessDocumentMove(document, move);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      document = next.value;
    }
    expect(exploreChessOpening(document)).toMatchObject({
      matched: {
        id: 'ruy-lopez',
        eco: 'C60',
        name: 'Испанская партия',
      },
      matchedPly: 5,
      exact: true,
    });
  });

  it('keeps a shorter family match after the book line is left', () => {
    const result = exploreChessOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(result.matched).toMatchObject({ id: 'ruy-lopez' });
    expect(result.exact).toBe(false);
    expect(result.suggestions).toEqual([]);
  });

  it('does not invent statistics or a false match', () => {
    const result = exploreChessOpening(['a3', 'a6']);
    expect(result).toMatchObject({
      matched: null,
      matchedPly: 0,
      exact: false,
      suggestions: [],
      source: 'asa-curated-v1',
    });
  });
});
