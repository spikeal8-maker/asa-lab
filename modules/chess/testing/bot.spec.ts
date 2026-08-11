import { describe, expect, it } from 'vitest';
import { chooseChessBotMove, evaluateChessPosition } from '../domain/bot';
import { applyLegalMove, createStartPosition, parseFen } from '../domain/chess';

function position(fen: string) {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

describe('deterministic ASA chess bot', () => {
  it('returns the same legal move for the same position and level', () => {
    const start = createStartPosition();
    const first = chooseChessBotMove(start, 2);
    const second = chooseChessBotMove(start, 2);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(applyLegalMove(start, first!.uci).ok).toBe(true);
    expect(first!.nodes).toBeGreaterThan(0);
  });

  it('takes a forced mate in one', () => {
    const mate = position('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    const choice = chooseChessBotMove(mate, 2);
    expect(choice).not.toBeNull();
    const applied = applyLegalMove(mate, choice!.uci);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(choice!.scoreCp).toBeGreaterThan(90000);
  });

  it('returns no move from a finished position', () => {
    const checkmate = position('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(chooseChessBotMove(checkmate, 3)).toBeNull();
  });

  it('evaluates material from White perspective', () => {
    expect(evaluateChessPosition(position('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1'))).toBeGreaterThan(800);
    expect(evaluateChessPosition(position('4k3/4q3/8/8/8/8/8/4K3 w - - 0 1'))).toBeLessThan(-800);
  });
});
