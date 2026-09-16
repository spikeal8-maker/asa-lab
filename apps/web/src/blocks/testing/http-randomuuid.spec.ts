import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlocksSessionNonce } from '../runtime-protocol';

describe('BlocksRuntimeBridge HTTP UUID fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a session nonce when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (target: Uint8Array) => {
        target.fill(0xab);
        return target;
      },
    });

    expect(createBlocksSessionNonce()).toBe('abababab-abab-4bab-abab-abababababab');
  });
});
