import { describe, expect, it } from 'vitest';
import {
  createInitialCheckersDocument,
  isDarkSquare,
  validateCheckersDocument,
  type CheckersSquare,
} from '../domain/document';

describe('Checkers document v1', () => {
  it('creates the canonical Russian draughts starting position', () => {
    const document = createInitialCheckersDocument();

    expect(document).toMatchObject({
      schemaVersion: 1,
      ruleset: 'russian-64',
      mode: 'game',
      sideToMove: 'light',
      moveHistory: [],
      result: '*',
    });
    expect(document.pieces).toHaveLength(24);
    expect(document.pieces.filter((piece) => piece.side === 'light')).toHaveLength(12);
    expect(document.pieces.filter((piece) => piece.side === 'dark')).toHaveLength(12);
    expect(document.pieces.every((piece) => isDarkSquare(piece.square))).toBe(true);
    expect(validateCheckersDocument(document)).toEqual({ ok: true, value: document });
  });

  it('rejects duplicate ids, occupied squares and light squares', () => {
    const document = createInitialCheckersDocument('position');
    const first = document.pieces[0]!;
    const second = document.pieces[1]!;

    expect(
      validateCheckersDocument({
        ...document,
        pieces: [first, { ...second, id: first.id }],
      }),
    ).toEqual({ ok: false, message: 'piece ids must be unique' });

    expect(
      validateCheckersDocument({
        ...document,
        pieces: [first, { ...second, square: first.square }],
      }),
    ).toEqual({ ok: false, message: 'piece squares must be unique' });

    expect(
      validateCheckersDocument({
        ...document,
        pieces: [{ ...first, square: 'a2' as CheckersSquare }],
      }),
    ).toEqual({ ok: false, message: 'pieces[0].square must be a playable dark square' });
  });

  it('rejects unknown fields and malformed move evidence', () => {
    const document = createInitialCheckersDocument();

    expect(validateCheckersDocument({ ...document, tenantId: 'foreign' })).toEqual({
      ok: false,
      message: 'checkers document has an invalid shape',
    });
    expect(
      validateCheckersDocument({
        ...document,
        moveHistory: [
          {
            ply: 2,
            side: 'light',
            pieceId: 'light-01',
            path: ['a3', 'b4'],
            capturedIds: [],
            promoted: false,
          },
        ],
      }),
    ).toEqual({ ok: false, message: 'moveHistory[0].ply must equal 1' });
  });
});
