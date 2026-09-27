import { describe, expect, it } from 'vitest';
import {
  isAllowedMutationOrigin,
  resolveAdditionalWebOrigins,
  resolveCanonicalWebOrigin,
  resolveLocalApiOrigin,
} from './origin-policy.js';

const base = {
  allowedWebOrigin: 'http://127.0.0.1:4610',
  allowedLocalApiOrigin: 'http://127.0.0.1:4611',
};

describe('canonical Web origin configuration', () => {
  it('resolves the default and a matching explicit origin', () => {
    expect(resolveCanonicalWebOrigin(undefined)).toBe('http://127.0.0.1:4610');
    expect(resolveCanonicalWebOrigin('4620', 'http://127.0.0.1:4620')).toBe(
      'http://127.0.0.1:4620',
    );
  });

  it('rejects forbidden ports and a mismatched/foreign origin override', () => {
    expect(() => resolveCanonicalWebOrigin('5173')).toThrow(/invalid or forbidden/);
    expect(() => resolveCanonicalWebOrigin('4610', 'http://127.0.0.1:5173')).toThrow(
      /must exactly match/,
    );
    expect(() => resolveCanonicalWebOrigin('4610', 'http://localhost:4610')).toThrow(
      /must exactly match/,
    );
  });

  it('accepts only explicit public HTTPS origins', () => {
    expect(
      resolveAdditionalWebOrigins(
        'https://asa-lab.ru, https://www.asa-lab.ru, https://192.168.1.115:8443',
      ),
    ).toEqual(['https://asa-lab.ru', 'https://www.asa-lab.ru', 'https://192.168.1.115:8443']);
    expect(() => resolveAdditionalWebOrigins('http://asa-lab.ru')).toThrow(/requires HTTPS/);
    expect(() => resolveAdditionalWebOrigins('https://asa-lab.ru/path')).toThrow(
      /requires HTTPS origins without paths/,
    );
    expect(() => resolveAdditionalWebOrigins('https://localhost')).toThrow(/loopback/);
    expect(() => resolveAdditionalWebOrigins('*')).toThrow(/requires HTTPS/);
  });

  it('derives the direct local API entry only from a validated API port', () => {
    expect(resolveLocalApiOrigin(undefined)).toBe('http://127.0.0.1:4611');
    expect(resolveLocalApiOrigin('4621')).toBe('http://127.0.0.1:4621');
    expect(() => resolveLocalApiOrigin('5173')).toThrow(/API_PORT is invalid or forbidden/);
    expect(() => resolveLocalApiOrigin('4611evil')).toThrow(/API_PORT is invalid or forbidden/);
  });
});

describe('mutation origin policy', () => {
  it('accepts the canonical Web origin and configured local API SPA', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4610' })).toBe(true);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4611' })).toBe(true);
  });

  it('accepts configured production origins without trusting arbitrary hosts', () => {
    expect(
      isAllowedMutationOrigin({
        ...base,
        origin: 'https://asa-lab.ru',
        additionalAllowedOrigins: [
          'https://asa-lab.ru',
          'https://www.asa-lab.ru',
          'https://192.168.1.115:8443',
        ],
      }),
    ).toBe(true);
    expect(
      isAllowedMutationOrigin({
        ...base,
        origin: 'https://192.168.1.115:8443',
        additionalAllowedOrigins: ['https://192.168.1.115:8443'],
      }),
    ).toBe(true);
    expect(
      isAllowedMutationOrigin({
        ...base,
        origin: 'https://evil.example',
        additionalAllowedOrigins: ['https://asa-lab.ru'],
      }),
    ).toBe(false);
  });

  it('rejects the owner project on 5173 and every other loopback port', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:5173' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4999' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://localhost:4610' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://localhost:4611' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:8080' })).toBe(false);
  });

  it('rejects malformed, credential-bearing and cross-site origins', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: 'not a url' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4610/path' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://user:pass@127.0.0.1:4610' })).toBe(
      false,
    );
    expect(isAllowedMutationOrigin({ ...base, origin: 'https://example.com' })).toBe(false);
    expect(
      isAllowedMutationOrigin({
        ...base,
        origin: 'http://127.0.0.1:4610',
        secFetchSite: 'cross-site',
      }),
    ).toBe(false);
    expect(
      isAllowedMutationOrigin({
        ...base,
        origin: undefined,
        secFetchSite: 'cross-site',
      }),
    ).toBe(false);
  });

  it('is fail-closed for origin-less state-changing requests', () => {
    // Browser endpoints require an explicitly allowed Origin; automated and
    // internal callers must send it too.
    expect(isAllowedMutationOrigin({ ...base, origin: undefined })).toBe(false);
    expect(
      isAllowedMutationOrigin({ ...base, origin: undefined, secFetchSite: 'same-origin' }),
    ).toBe(false);
  });
});
