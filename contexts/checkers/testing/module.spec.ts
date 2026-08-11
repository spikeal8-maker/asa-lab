import { describe, expect, it } from 'vitest';
import { CHECKERS_MODULE } from '../module';

describe('ASA Checkers module provider', () => {
  it('declares an independent active Safe Mode module', () => {
    expect(CHECKERS_MODULE.manifest).toMatchObject({
      moduleKey: 'checkers',
      projectType: 'checkers-game',
      availability: 'active',
      safeModeSupported: true,
      previewKind: 'board',
    });
    expect(CHECKERS_MODULE.provider).toBeDefined();
  });

  it('creates, validates, previews and analyses an initial project', () => {
    const provider = CHECKERS_MODULE.provider!;
    const document = provider.createEmptyProject();
    const validation = provider.validate(document);

    expect(validation).toEqual({ ok: true, payload: document, diagnostics: [] });
    expect(provider.createPreview(document)).toMatchObject({
      kind: 'board',
      summary: '24 шашек · 0 ходов',
    });
    expect(provider.analyse!(document)).toEqual({
      lightMen: 12,
      lightKings: 0,
      darkMen: 12,
      darkKings: 0,
      moveCount: 0,
      result: '*',
    });
  });

  it('returns module diagnostics for malformed payloads', () => {
    expect(CHECKERS_MODULE.provider!.validate({ schemaVersion: 1 })).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'checkers_document_invalid',
          severity: 'error',
          message: 'checkers document has an invalid shape',
        },
      ],
    });
  });
});
