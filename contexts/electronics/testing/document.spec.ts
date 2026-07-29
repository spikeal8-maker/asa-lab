import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT, parseElectronicsDocument } from '../domain/document';

function base(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    components: [],
    connections: [],
    ...overrides,
  };
}

describe('Electronics geometry profile compatibility', () => {
  it('creates new documents with the physical breadboard profile', () => {
    expect(EMPTY_DOCUMENT.geometryProfile).toBe('breadboard-2.54mm-v1');
  });

  it('interprets first-foundation documents without a profile as legacy geometry', () => {
    const parsed = parseElectronicsDocument(base());
    expect(parsed).toEqual({
      ok: true,
      document: {
        schemaVersion: 1,
        geometryProfile: 'legacy-pixel-v1',
        components: [],
        connections: [],
      },
    });
  });

  it('preserves the physical profile when it is explicitly stored', () => {
    const parsed = parseElectronicsDocument(
      base({ geometryProfile: 'breadboard-2.54mm-v1' }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document.geometryProfile).toBe('breadboard-2.54mm-v1');
  });

  it.each(['pixels', 'breadboard', 1, null, true, {}])(
    'rejects unsupported geometry profile %j',
    (geometryProfile) => {
      const parsed = parseElectronicsDocument(base({ geometryProfile }));
      expect(parsed).toEqual({ ok: false, message: 'unsupported document geometryProfile' });
    },
  );
});
