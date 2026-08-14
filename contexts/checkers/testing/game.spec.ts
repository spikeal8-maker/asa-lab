import { describe, expect, it } from 'vitest';
import { createInitialCheckersDocument } from '../domain/document';
import { applyCheckersGameMove } from '../domain/game';
import { generateLegalCheckersMoves } from '../domain/rules';

describe('persisted Checkers game move', () => {
  it('rebuilds official draw evidence from the immutable standard-game history', () => {
    const initial = createInitialCheckersDocument();
    const first = generateLegalCheckersMoves(initial)[0]!;
    const applied = applyCheckersGameMove(initial, first);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.moveHistory).toHaveLength(1);
    expect(applied.value.result).toBe('*');
  });

  it('fails closed when a standard game position does not match its history', () => {
    const initial = createInitialCheckersDocument();
    const tampered = { ...initial, pieces: initial.pieces.slice(1) };
    expect(applyCheckersGameMove(tampered, generateLegalCheckersMoves(tampered)[0]!)).toEqual({
      ok: false,
      message: 'game position does not match its move history',
    });
  });
});
