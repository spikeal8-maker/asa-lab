import { describe, expect, it } from 'vitest';
import { canonicalTextSha256 } from '../../tools/generate-electronics-component-coverage.mjs';

describe('electronics component coverage source identity', () => {
  it('is independent of checkout line endings', () => {
    expect(canonicalTextSha256('first\nsecond\n')).toBe(canonicalTextSha256('first\r\nsecond\r\n'));
    expect(canonicalTextSha256('first\nsecond\n')).toBe(canonicalTextSha256('first\rsecond\r'));
  });

  it('still changes when source text changes', () => {
    expect(canonicalTextSha256('first\nsecond\n')).not.toBe(
      canonicalTextSha256('first\nchanged\n'),
    );
  });
});
