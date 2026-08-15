import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseFen, START_FEN } from '../../contexts/chess/index';
import { ChessBoard } from '../../apps/web/src/chess/ChessBoard';

describe('ASA Chess board renderer', () => {
  it('self-hosts the licensed piece font instead of relying on an operating-system font', () => {
    const css = readFileSync('apps/web/src/chess/chess.css', 'utf8');
    const source = readFileSync('apps/web/public/assets/chess/fonts/SOURCE.md', 'utf8');
    const license = readFileSync('apps/web/public/assets/chess/fonts/OFL.txt', 'utf8');

    expect(css).toContain("font-family: 'ASA Chess Symbols'");
    expect(css).toContain('/assets/chess/fonts/noto-sans-symbols-2-v25-symbols.woff2');
    expect(css).not.toContain("font-family: 'Segoe UI Symbol'");
    expect(source).toContain('9c07d511848c274b5430c75bf98d1f2582680ef5f967947bfbdd06b75ca177c2');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

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
    expect(html).toContain('data-piece-set="noto-symbols-2-v25"');
    expect(html).toContain('data-keyboard-model="roving-grid"');
    expect(html.match(/class="asa-chess-piece /g)).toHaveLength(32);
    expect(html.match(/class="asa-chess-piece-glyph"/g)).toHaveLength(32);
    expect(html).toContain('data-piece="white-king"');
    expect(html).toContain('data-piece-type="king"');
    expect(html).toContain('data-piece="black-knight"');
    expect(html.match(/tabindex="-1"/g)).toHaveLength(64);
  });

  it('uses one roving tab stop instead of adding all 64 squares to the tab order', () => {
    const parsed = parseFen(START_FEN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const html = renderToStaticMarkup(
      createElement(ChessBoard, {
        position: parsed.value,
        orientation: 'white',
        selectedSquare: null,
        legalMoves: [],
        onSquare: vi.fn(),
        onMove: vi.fn(),
      }),
    );

    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(63);
    expect(html).toMatch(/data-square="a1"[^>]*tabindex="0"/);
  });
});
