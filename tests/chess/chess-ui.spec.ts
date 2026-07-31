import { describe, expect, it } from 'vitest';
import {
  PIECE_SYMBOL,
  evaluationLabel,
  formatChessClock,
  resultLabel,
  squareAccessibleLabel,
} from '../../apps/web/src/chess/chess-ui';

describe('ASA Chess UI helpers', () => {
  it('provides a complete two-color Unicode piece map', () => {
    expect(Object.keys(PIECE_SYMBOL.white).sort()).toEqual([
      'bishop',
      'king',
      'knight',
      'pawn',
      'queen',
      'rook',
    ]);
    expect(PIECE_SYMBOL.white.king).toBe('♔');
    expect(PIECE_SYMBOL.black.knight).toBe('♞');
  });

  it('builds Russian accessible square labels', () => {
    expect(squareAccessibleLabel('e4', null)).toBe('e4, пустое поле');
    expect(squareAccessibleLabel('g8', { color: 'black', type: 'knight' })).toBe('g8, чёрные конь');
    expect(squareAccessibleLabel('e1', { color: 'white', type: 'king' })).toBe('e1, белые король');
  });

  it.each([
    [0, '0:00'],
    [999, '0:01'],
    [60_000, '1:00'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
  ] as const)('formats clock %s as %s', (value, label) => {
    expect(formatChessClock(value)).toBe(label);
  });

  it('formats results and termination reasons', () => {
    expect(resultLabel('*', 'ongoing')).toBe('Партия продолжается');
    expect(resultLabel('1-0', 'checkmate')).toBe('Белые победили · мат');
    expect(resultLabel('0-1', 'timeout')).toBe('Чёрные победили · время истекло');
    expect(resultLabel('1/2-1/2', 'threefold')).toBe('Ничья · троекратное повторение');
  });

  it('formats centipawn and mate evaluation without proprietary accuracy claims', () => {
    expect(evaluationLabel(0)).toBe('+0.0');
    expect(evaluationLabel(135)).toBe('+1.4');
    expect(evaluationLabel(-87)).toBe('-0.9');
    expect(evaluationLabel(100_000)).toBe('Мат за белых');
    expect(evaluationLabel(-100_000)).toBe('Мат за чёрных');
  });
});
