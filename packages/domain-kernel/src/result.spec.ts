import { describe, it, expect } from 'vitest';
import { ok, err, isNonEmptyString } from './index';

describe('domain-kernel Result', () => {
  it('wraps a success value', () => {
    const result = ok(3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(3);
    }
  });

  it('wraps an error value', () => {
    const result = err('bad');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('bad');
    }
  });

  it('validates non-empty strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
  });
});
