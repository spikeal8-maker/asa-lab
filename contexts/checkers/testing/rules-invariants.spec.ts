import { describe, expect, it } from 'vitest';
import { createInitialCheckersDocument, validateCheckersDocument } from '../domain/document';
import { applyCheckersMove, generateLegalCheckersMoves } from '../domain/rules';

describe('Russian draughts deterministic game invariants', () => {
  it('keeps every generated move applicable across varied complete games', () => {
    for (let gameIndex = 0; gameIndex < 24; gameIndex += 1) {
      let document = createInitialCheckersDocument();
      for (let ply = 0; ply < 100 && document.result === '*'; ply += 1) {
        const legalMoves = generateLegalCheckersMoves(document);
        expect(legalMoves.length).toBeGreaterThan(0);
        if (legalMoves.some((move) => move.isCapture)) {
          expect(legalMoves.every((move) => move.isCapture)).toBe(true);
        }
        for (const move of legalMoves) {
          expect(move.side).toBe(document.sideToMove);
          expect(new Set(move.capturedIds).size).toBe(move.capturedIds.length);
          expect(move.path.length).toBeGreaterThanOrEqual(2);
        }

        const choice = legalMoves[(gameIndex * 37 + ply * 19) % legalMoves.length]!;
        const applied = applyCheckersMove(document, {
          pieceId: choice.pieceId,
          path: choice.path,
        });
        expect(applied.ok).toBe(true);
        if (!applied.ok) break;
        document = applied.value;

        expect(validateCheckersDocument(document).ok).toBe(true);
        expect(new Set(document.pieces.map((piece) => piece.id)).size).toBe(document.pieces.length);
        expect(new Set(document.pieces.map((piece) => piece.square)).size).toBe(
          document.pieces.length,
        );
      }
    }
  });
});
