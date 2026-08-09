import { describe, expect, it } from 'vitest';
import { importChessPgn, stripPgnLineComments } from '../domain/pgn';

describe('safe public PGN import', () => {
  it('removes semicolon comments without consuming later movetext lines', () => {
    const imported = importChessPgn(`
[Event "Training"]
[Result "*"]

1. e4 e5 ; Black mirrors the centre
2. Nf3 Nc6 ; Both knights develop
3. Bb5 a6 *
`);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.moves.map((move) => move.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bb5',
      'a6',
    ]);
  });

  it('does not strip semicolons inside quoted PGN tags', () => {
    const source = `[Event "Lesson; chapter 1"]\n\n1. e4 *`;
    const normalized = stripPgnLineComments(source);
    expect(normalized).toContain('[Event "Lesson; chapter 1"]');
    const imported = importChessPgn(source);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.headers.Event).toBe('Lesson; chapter 1');
  });
});
