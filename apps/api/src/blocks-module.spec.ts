import { describe, expect, it } from 'vitest';
import { BLOCKS_MODULE } from './blocks-module';

function provider() {
  const result = BLOCKS_MODULE.provider;
  if (!result) throw new Error('BLOCKS_MODULE provider is required');
  return result;
}

function validDocument(assetOverrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    format: 'scratch-3',
    projectJson: {
      targets: [{ isStage: true }, { isStage: false }],
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0' },
    },
    assets: [
      {
        assetId: '0123456789abcdef0123456789abcdef',
        dataFormat: 'svg',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sizeBytes: 1234,
        ...assetOverrides,
      },
    ],
  };
}

function expectAssetDiagnostic(document: unknown, code: string) {
  expect(provider().validate(document)).toMatchObject({
    ok: false,
    diagnostics: [{ code, severity: 'error' }],
  });
}

describe('BLOCKS_MODULE', () => {
  it(
    'keeps the Scratch-backed environment gated with the corrected pre-release provider version',
    () => {
      expect(BLOCKS_MODULE.manifest).toMatchObject({
        moduleKey: 'blocks',
        moduleVersion: '0.1.1',
        projectType: 'scratch-3',
        availability: 'coming_soon',
        previewKind: 'stage',
      });
    },
  );

  it('creates an empty ASA envelope without inventing a fake Scratch project.json', () => {
    const moduleProvider = provider();
    const document = moduleProvider.createEmptyProject();
    expect(document).toEqual({
      schemaVersion: 1,
      format: 'scratch-3',
      projectJson: null,
      assets: [],
    });
    expect(moduleProvider.validate(document)).toMatchObject({ ok: true, diagnostics: [] });
  });

  it(
    'accepts canonical Scratch 3 JSON plus logical asset references and preserves preview counts',
    () => {
      const moduleProvider = provider();
      const result = moduleProvider.validate(validDocument());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected valid blocks document');
      expect(moduleProvider.createPreview(result.payload)).toMatchObject({
        kind: 'stage',
        summary: 'Scratch 3 · спрайтов: 1 · ресурсов: 1',
      });
    },
  );

  it('rejects the former physical objectKey field as an unknown asset field', () => {
    expectAssetDiagnostic(
      validDocument({ objectKey: 'scratch-assets/sha256/aa/asset.svg' }),
      'blocks.asset.unknown_field',
    );
  });

  it.each([
    ['uppercase', '0123456789ABCDEF0123456789ABCDEF'],
    ['too short', '0123456789abcdef'],
    ['non-hex', 'zz23456789abcdef0123456789abcdef'],
  ])('rejects %s Scratch assetId values', (_label, assetId) => {
    expectAssetDiagnostic(validDocument({ assetId }), 'blocks.asset.asset_id');
  });

  it.each(['gif', 'json', 'sb3'])('rejects unsupported %s asset format', (dataFormat) => {
    expectAssetDiagnostic(validDocument({ dataFormat }), 'blocks.asset.data_format');
  });

  it.each([
    ['uppercase', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['too short', 'aaaaaaaa'],
    ['non-hex', 'z'.repeat(64)],
  ])('rejects %s SHA-256 values', (_label, sha256) => {
    expectAssetDiagnostic(validDocument({ sha256 }), 'blocks.asset.sha256');
  });

  it.each([0, -1, 1.5])('rejects invalid sizeBytes value %s', (sizeBytes) => {
    expectAssetDiagnostic(validDocument({ sizeBytes }), 'blocks.asset.size');
  });

  it('rejects inline asset bytes with the dedicated architectural diagnostic', () => {
    expectAssetDiagnostic(validDocument({ base64: 'PHN2Zy8+' }), 'blocks.asset.inline_binary');
  });

  it('rejects an .sb3 archive embedded at the document root', () => {
    expect(
      provider().validate({
        schemaVersion: 1,
        format: 'scratch-3',
        projectJson: null,
        assets: [],
        sb3Base64: 'UEsDBAoAAAAA',
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'blocks.document.inline_sb3', severity: 'error' }],
    });
  });
});
