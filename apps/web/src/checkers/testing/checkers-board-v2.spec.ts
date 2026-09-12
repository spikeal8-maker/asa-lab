import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckersBoard, type CheckersBoardPiece } from '../CheckersBoard';
import { CheckersBoardV2, type CheckersBoardTheme } from '../CheckersBoardV2';

const pieces: readonly CheckersBoardPiece[] = [
  { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
  { id: 'dark-d4', side: 'dark', kind: 'king', square: 'd4' },
];

function cellState(markup: string): readonly string[] {
  const result: string[] = [];
  const pattern = /<button\b[^>]*data-square="([a-h][1-8])"[^>]*>/g;
  for (const match of markup.matchAll(pattern)) {
    const tag = match[0] ?? '';
    const square = match[1] ?? '';
    const classes = /class="([^"]*)"/.exec(tag)?.[1] ?? '';
    result.push(
      `${square}:${classes.includes('selected') ? 'S' : '-'}${
        classes.includes('destination') ? 'D' : '-'
      }${classes.includes('movable') ? 'M' : '-'}`,
    );
  }
  return result.sort();
}
describe('CK-104 Board V2', () => {
  it('keeps interaction parity with Board V1 for the same position and legal moves', () => {
    const props = {
      pieces,
      selectedPieceId: 'light-c3',
      legalDestinations: ['e5'] as const,
      movablePieceIds: ['light-c3'] as const,
    };
    const legacy = renderToStaticMarkup(createElement(CheckersBoard, props));
    const next = renderToStaticMarkup(createElement(CheckersBoardV2, props));

    expect(legacy.match(/data-square=/g)).toHaveLength(64);
    expect(next.match(/data-square=/g)).toHaveLength(64);
    expect(cellState(next)).toEqual(cellState(legacy));
    expect(next).toContain('c3: светлая шашка, доступна для хода');
    expect(next).toContain('d4: тёмная дамка');
    expect(next).toContain('e5: допустимое поле хода');
  });

  it.each(['classic', 'light', 'dark'] as const)('renders the %s board theme', (theme) => {
    const markup = renderToStaticMarkup(
      createElement(CheckersBoardV2, { pieces, theme: theme as CheckersBoardTheme }),
    );
    expect(markup).toContain(`data-theme="${theme}"`);
    expect(markup).toContain('data-renderer="v2"');
    expect(markup).toContain('data-animation="transform"');
  });
  it('shows layered hints, forced capture, last move and a vector king marker', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersBoardV2, {
        pieces,
        selectedPieceId: 'light-c3',
        legalDestinations: ['e5'],
        captureDestinations: ['e5'],
        movablePieceIds: ['light-c3'],
        forcedCapturePieceIds: ['light-c3'],
        lastMovePath: ['d4', 'c3'],
      }),
    );

    expect(markup).toContain('checkers-board-v2-grid');
    expect(markup).toContain('checkers-board-v2-hints');
    expect(markup).toContain('checkers-board-v2-pieces');
    expect(markup).toContain('checkers-board-v2-interactions');
    expect(markup).toContain('forced-capture');
    expect(markup).toContain('destination capture');
    expect(markup).toContain('data-last-move="true"');
    expect(markup).toContain('обязательное взятие');
    expect(markup).toContain('checkers-v2-crown');
    expect(markup).toContain('<svg');
  });

  it('shows the complete numbered route for a multi-capture choice', () => {
    const markup = renderToStaticMarkup(
      createElement(CheckersBoardV2, {
        pieces,
        selectedPieceId: 'light-c3',
        legalDestinations: ['g7'],
        captureDestinations: ['g7'],
        capturePaths: [['c3', 'e5', 'g7']],
        movablePieceIds: ['light-c3'],
        forcedCapturePieceIds: ['light-c3'],
      }),
    );

    expect(markup).toContain('checkers-v2-capture-routes');
    expect(markup.match(/checkers-v2-capture-step/g)).toHaveLength(2);
    expect(markup).toContain('marker-end="url(#checkers-capture-arrow)"');
    expect(markup).toContain('>1</span>');
    expect(markup).toContain('>2</span>');
  });
});
