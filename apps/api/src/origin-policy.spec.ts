import { describe, expect, it } from 'vitest';
import { isAllowedMutationOrigin, resolveCanonicalWebOrigin } from './origin-policy.js';

const base = {
  requestHost: '127.0.0.1:4611',
  requestProtocol: 'http',
  allowedWebOrigin: 'http://127.0.0.1:4610',
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
});

describe('mutation origin policy', () => {
  it('accepts the canonical Vite origin and API same-origin SPA', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4610' })).toBe(true);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4611' })).toBe(true);
  });

  it('rejects the owner project on 5173 and every other loopback port', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:5173' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://127.0.0.1:4999' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://localhost:4610' })).toBe(false);
  });

  it('rejects malformed, credential-bearing and cross-site origins', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: 'not a url' })).toBe(false);
    expect(isAllowedMutationOrigin({ ...base, origin: 'http://user:pass@127.0.0.1:4610' })).toBe(
      false,
    );
    expect(isAllowedMutationOrigin({ ...base, origin: 'https://example.com' })).toBe(false);
    expect(
      isAllowedMutationOrigin({
        ...base,
        origin: undefined,
        secFetchSite: 'cross-site',
      }),
    ).toBe(false);
  });

  it('allows origin-less non-browser clients without a cross-site fetch signal', () => {
    expect(isAllowedMutationOrigin({ ...base, origin: undefined })).toBe(true);
    expect(
      isAllowedMutationOrigin({ ...base, origin: undefined, secFetchSite: 'same-origin' }),
    ).toBe(true);
  });
});
