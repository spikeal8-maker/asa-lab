import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseFen, START_FEN } from '../../contexts/chess/index';
import { ChessBoard } from '../../apps/web/src/chess/ChessBoard';

describe('ASA Chess board renderer', () => {
  it('uses one deterministic renderer and one calibrated glyph layer for every piece', () => {
    const parsed = parseFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const html = renderToStaticMarkup(
      createElement(ChessBoard, {
        position: parsed.value,
        orientation: 'white',
        selectedSquare: null,
        legalMoves: [],
        disabled: true,
        onSquare: vi.fn(),
        onMove: vi.fn(),
      }),
    );

    expect(html).toContain('data-board-renderer="asa-grid-v2"');
    expect(html.match(/class="asa-chess-piece /g)).toHaveLength(32);
    expect(html.match(/class="asa-chess-piece-glyph"/g)).toHaveLength(32);
    expect(html).toContain('data-piece="white-king"');
    expect(html).toContain('data-piece-type="king"');
    expect(html).toContain('data-piece="black-knight"');
  });
});
