import { describe, expect, it } from 'vitest';
import { BLOCKS_MODULE } from './blocks-module';

function provider() {
  const result = BLOCKS_MODULE.provider;
  if (!result) throw new Error('BLOCKS_MODULE provider is required');
  return result;
}

describe('BLOCKS_MODULE', () => {
  it('keeps the Scratch-backed environment gated until persistence is connected', () => {
    expect(BLOCKS_MODULE.manifest).toMatchObject({
      moduleKey: 'blocks',
      projectType: 'scratch-3',
      availability: 'coming_soon',
      previewKind: 'stage',
    });
  });

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

  it('accepts Scratch 3 JSON plus object-store asset references', () => {
    const moduleProvider = provider();
    const result = moduleProvider.validate({
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
          objectKey: 'scratch-assets/sha256/aa/asset.svg',
          sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          sizeBytes: 1234,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected valid blocks document');
    expect(moduleProvider.createPreview(result.payload)).toMatchObject({
      kind: 'stage',
      summary: 'Scratch 3 · спрайтов: 1 · ресурсов: 1',
    });
  });

  it('rejects inline asset bytes so autosaves cannot duplicate .sb3 binaries in JSONB', () => {
    const result = provider().validate({
      schemaVersion: 1,
      format: 'scratch-3',
      projectJson: {
        targets: [],
        monitors: [],
        extensions: [],
      },
      assets: [
        {
          assetId: '0123456789abcdef0123456789abcdef',
          dataFormat: 'png',
          objectKey: 'scratch-assets/sha256/bb/asset.png',
          sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          sizeBytes: 100,
          base64: 'iVBORw0KGgo=',
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'blocks.asset.inline_binary', severity: 'error' }],
    });
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
