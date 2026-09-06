import { describe, expect, it } from 'vitest';
import { classAttention } from './attention';
describe('truthful navigation attention', () => {
  it('has no fabricated notifications when no work is reported', () => {
    expect(classAttention(0, 0)).toBeNull();
    expect(classAttention(NaN, Infinity)).toBeNull();
    expect(classAttention(-1, -2)).toBeNull();
  });
  it('names the underlying work, not unread events or new grades', () => {
    expect(classAttention(3, 0)).toBe('Задания: 3');
    expect(classAttention(0, 2)).toBe('На проверку: 2');
    expect(classAttention(3, 2)).toBe('Задания: 3 · На проверку: 2');
  });
});
