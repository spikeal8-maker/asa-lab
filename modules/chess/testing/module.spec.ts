import { describe, expect, it } from 'vitest';
import { CHESS_MODULE } from '../module';
import { createEmptyChessDocument, playChessDocumentMove } from '../domain/document';

describe('ASA Chess module provider', () => {
  it('declares an active Safe Mode compatible board module', () => {
    expect(CHESS_MODULE.manifest).toMatchObject({
      moduleKey: 'chess',
      availability: 'active',
      previewKind: 'board',
      safeModeSupported: true,
      projectType: 'chess-game',
      schemaVersion: 1,
    });
    expect(CHESS_MODULE.provider).toBeDefined();
  });

  it('creates and validates an empty chess project', () => {
    const document = CHESS_MODULE.provider!.createEmptyProject();
    expect(CHESS_MODULE.provider!.validate(document)).toEqual({
      ok: true,
      payload: document,
      diagnostics: [],
    });
  });

  it('rejects malformed chess payloads with module diagnostics', () => {
    expect(CHESS_MODULE.provider!.validate({ schemaVersion: 1, tenantId: 'foreign' })).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'chess_document_invalid',
          severity: 'error',
          message: 'Chess document contains unsupported field: tenantId.',
        },
      ],
    });
  });

  it('creates a deterministic board preview and analysis summary', () => {
    const first = playChessDocumentMove(createEmptyChessDocument('analysis'), 'e2e4');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(CHESS_MODULE.provider!.createPreview(first.value)).toMatchObject({
      kind: 'board',
      summary: '1 полуходов · партия не завершена',
      inlineData: first.value.currentFen,
    });
    const analysis = CHESS_MODULE.provider!.analyse!(first.value);
    expect(analysis.status.result).toBe('*');
    expect(analysis.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    expect(analysis.searchedNodes).toBeGreaterThan(0);
  });
});
