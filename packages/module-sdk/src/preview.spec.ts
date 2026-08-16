import { describe, expect, it } from 'vitest';
import {
  boardPreviewFigure,
  previewDigest,
  MODULE_PREVIEW_SHAPE_LIMIT,
  type ModulePreviewDescriptor,
} from './index';

describe('boardPreviewFigure', () => {
  it('draws every square of the board before any piece', () => {
    const figure = boardPreviewFigure({ size: 8, light: '#fff', dark: '#000', pieces: [] });
    expect(figure.shapes).toHaveLength(64);
    expect(figure.shapes.every((shape) => shape.shape === 'rect')).toBe(true);
    expect(figure.viewBox).toEqual({ width: 96, height: 96 });
  });

  it('alternates the square colours starting light in the top-left corner', () => {
    const figure = boardPreviewFigure({ size: 8, light: '#eee', dark: '#333', pieces: [] });
    const [first, second] = figure.shapes;
    expect(first).toMatchObject({ x: 0, y: 0, fill: '#eee' });
    expect(second).toMatchObject({ x: 12, y: 0, fill: '#333' });
  });

  it('centres a piece in its square', () => {
    const figure = boardPreviewFigure({
      size: 8,
      light: '#eee',
      dark: '#333',
      pieces: [{ file: 0, rank: 0, fill: '#f00' }],
    });
    const piece = figure.shapes[64];
    expect(piece).toMatchObject({ shape: 'circle', cx: 6, cy: 6, fill: '#f00' });
  });

  it('adds a second inner disc for a crowned piece', () => {
    const plain = boardPreviewFigure({
      size: 8,
      light: '#eee',
      dark: '#333',
      pieces: [{ file: 3, rank: 4, fill: '#f00' }],
    });
    const crowned = boardPreviewFigure({
      size: 8,
      light: '#eee',
      dark: '#333',
      pieces: [{ file: 3, rank: 4, fill: '#f00', crowned: true }],
    });
    expect(crowned.shapes).toHaveLength(plain.shapes.length + 1);
  });

  /**
   * A payload can name a square that does not exist — a corrupted document, a
   * future ruleset, a bug elsewhere. Dropping it keeps the drawing inside the
   * viewBox instead of letting a stray disc float outside the card.
   */
  it('drops pieces that fall outside the board', () => {
    const figure = boardPreviewFigure({
      size: 8,
      light: '#eee',
      dark: '#333',
      pieces: [
        { file: -1, rank: 0, fill: '#f00' },
        { file: 8, rank: 0, fill: '#f00' },
        { file: 0, rank: 8, fill: '#f00' },
      ],
    });
    expect(figure.shapes).toHaveLength(64);
  });
});

describe('previewDigest', () => {
  const descriptor: ModulePreviewDescriptor = {
    kind: 'board',
    summary: '24 шашек',
    figure: boardPreviewFigure({
      size: 8,
      light: '#eee',
      dark: '#333',
      pieces: [{ file: 1, rank: 2, fill: '#f00' }],
    }),
  };

  it('returns the same digest for the same preview', () => {
    expect(previewDigest(descriptor)).toBe(previewDigest(descriptor));
  });

  it('returns a fixed-width hexadecimal digest', () => {
    expect(previewDigest(descriptor)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('changes when the drawing changes', () => {
    const moved: ModulePreviewDescriptor = {
      ...descriptor,
      figure: boardPreviewFigure({
        size: 8,
        light: '#eee',
        dark: '#333',
        pieces: [{ file: 2, rank: 2, fill: '#f00' }],
      }),
    };
    expect(previewDigest(moved)).not.toBe(previewDigest(descriptor));
  });

  it('changes when only the summary changes', () => {
    expect(previewDigest({ ...descriptor, summary: '23 шашек' })).not.toBe(
      previewDigest(descriptor),
    );
  });

  /**
   * inlineData is module-private and can carry a timestamp or a cursor. The
   * digest answers "does this card need redrawing", so it must ignore anything
   * the card does not display.
   */
  it('ignores data that is not drawn', () => {
    expect(previewDigest({ ...descriptor, inlineData: 'anything' })).toBe(
      previewDigest(descriptor),
    );
  });

  it('digests a preview that has no figure', () => {
    expect(previewDigest({ kind: 'summary', summary: 'пусто' })).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('MODULE_PREVIEW_SHAPE_LIMIT', () => {
  it('leaves room for a full board and its pieces', () => {
    const full = boardPreviewFigure({
      size: 8,
      light: '#eee',
      dark: '#333',
      pieces: Array.from({ length: 24 }, (_, index) => ({
        file: index % 8,
        rank: Math.floor(index / 8),
        fill: '#f00',
        crowned: true,
      })),
    });
    expect(full.shapes.length).toBeLessThanOrEqual(MODULE_PREVIEW_SHAPE_LIMIT);
  });
});
