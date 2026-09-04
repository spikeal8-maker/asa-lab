import { afterEach, describe, expect, it, vi } from 'vitest';
import { newClientId } from './client-id';

describe('newClientId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    let nextByte = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => {
          bytes[index] = nextByte++;
        });
        return bytes;
      },
    });

    expect(newClientId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });
});
