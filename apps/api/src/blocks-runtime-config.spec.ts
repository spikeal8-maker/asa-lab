import { describe, expect, it } from 'vitest';
import { readBlocksRuntimeServerConfig } from './blocks-runtime-config.js';

const KEY = 'ab'.repeat(32);

describe('Blocks runtime server configuration', () => {
  it('accepts one exact runtime origin and one 32-byte server-only key', () => {
    const config = readBlocksRuntimeServerConfig({
      ASA_BLOCKS_RUNTIME_ORIGIN: 'http://localhost:4613',
      ASA_BLOCKS_RUNTIME_SIGNING_KEY: KEY,
    });
    expect(config.runtimeOrigin).toBe('http://localhost:4613');
    expect(config.signingKey).toEqual(Uint8Array.from(Buffer.from(KEY, 'hex')));
  });

  it.each([
    '',
    'not-a-url',
    'ftp://localhost:4613',
    'http://user:pass@localhost:4613',
    'http://localhost:4613/path',
    'http://localhost:4613/',
  ])('rejects a non-exact runtime origin %#', (runtimeOrigin) => {
    expect(() =>
      readBlocksRuntimeServerConfig({
        ASA_BLOCKS_RUNTIME_ORIGIN: runtimeOrigin,
        ASA_BLOCKS_RUNTIME_SIGNING_KEY: KEY,
      }),
    ).toThrow();
  });
  it.each(['', 'aa', 'aa'.repeat(31), 'aa'.repeat(33), 'zz'.repeat(32), `${'aa'.repeat(32)} `])(
    'rejects invalid signing material %#',
    (key) => {
      expect(() =>
        readBlocksRuntimeServerConfig({
          ASA_BLOCKS_RUNTIME_ORIGIN: 'https://scratch.example.test',
          ASA_BLOCKS_RUNTIME_SIGNING_KEY: key,
        }),
      ).toThrow();
    },
  );

  it('returns independent signing arrays on separate configuration reads', () => {
    const env = {
      ASA_BLOCKS_RUNTIME_ORIGIN: 'https://scratch.example.test',
      ASA_BLOCKS_RUNTIME_SIGNING_KEY: KEY,
    };
    const first = readBlocksRuntimeServerConfig(env);
    const second = readBlocksRuntimeServerConfig(env);
    first.signingKey.fill(0);
    expect(second.signingKey).toEqual(Uint8Array.from(Buffer.from(KEY, 'hex')));
  });
});
