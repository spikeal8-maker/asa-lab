import { describe, expect, it } from 'vitest';
import {
  readBlocksRuntimeServerConfig,
  readBlocksRuntimeEntryConfig,
} from './blocks-runtime-config.js';

const KEY = 'ab'.repeat(32);

describe('Blocks runtime server configuration', () => {
  it('selects each approved exact entry, future subdomain and canonical loopback in opt-in mode', () => {
    const env = {
      ASA_BLOCKS_SAME_ORIGIN: 'true',
      ASA_BLOCKS_RUNTIME_SIGNING_KEY: KEY,
      ASA_BLOCKS_RUNTIME_ORIGIN: 'https://old.example.test',
      ASA_PUBLIC_WEB_ORIGINS: 'https://192.168.1.115:4610,https://asa-lab.ru',
      ASA_PUBLIC_WEB_ORIGIN_PATTERNS: 'https://*.asa-lab.ru',
    };
    for (const origin of [
      'https://asa-lab.ru',
      'https://192.168.1.115:4610',
      'https://future.pretest.asa-lab.ru',
      'http://127.0.0.1:4610',
    ]) {
      expect(readBlocksRuntimeEntryConfig(env, origin).runtimeOrigin).toBe(origin);
    }
    for (const origin of [
      undefined,
      'null',
      'https://evil.test',
      'https://old.example.test',
      'https://future.asa-lab.ru.evil.test',
      'http://172.23.104.170:4610',
    ]) {
      expect(() => readBlocksRuntimeEntryConfig(env, origin)).toThrow(
        /entry origin is not allowed/,
      );
    }
    expect(() =>
      readBlocksRuntimeEntryConfig(
        { ...env, ASA_BLOCKS_RUNTIME_SIGNING_KEY: 'bad' },
        'https://asa-lab.ru',
      ),
    ).toThrow(/32 bytes/);
  });

  it('preserves legacy fixed-origin behavior unless explicitly enabled', () => {
    const env = {
      ASA_BLOCKS_RUNTIME_SIGNING_KEY: KEY,
      ASA_BLOCKS_RUNTIME_ORIGIN: 'https://old.example.test',
    };
    expect(readBlocksRuntimeEntryConfig(env, 'https://other.example.test').runtimeOrigin).toBe(
      env.ASA_BLOCKS_RUNTIME_ORIGIN,
    );
    expect(() =>
      readBlocksRuntimeEntryConfig({ ...env, ASA_BLOCKS_SAME_ORIGIN: 'yes' }, undefined),
    ).toThrow(/true or false/);
  });
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
