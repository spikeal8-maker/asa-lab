import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlocksAssetFormat } from '@asa-lab/blocks';
import {
  BlocksAssetUploadBudgetError,
  BlocksAssetUploadPipeline,
  captureBlocksAssetUpload,
} from './blocks-asset-upload.js';
import {
  BlocksAssetIdentityConflictError,
  BlocksAssetStorageIntegrityError,
  BlocksAssetWriteMayHavePersistedError,
  type BlocksBlobStorePort,
} from './blocks-asset-storage.js';
import type { BlocksAssetMetadataCommitPort } from './blocks-asset-upload.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
  'base64',
);
const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);
const MP3 = Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0,
]);
const WAV = Buffer.alloc(46);
WAV.write('RIFF');
WAV.writeUInt32LE(38, 4);
WAV.write('WAVEfmt ', 8);
WAV.writeUInt32LE(16, 16);
WAV.writeUInt16LE(1, 20);
WAV.writeUInt16LE(1, 22);
WAV.writeUInt32LE(8000, 24);
WAV.writeUInt32LE(16000, 28);
WAV.writeUInt16LE(2, 32);
WAV.writeUInt16LE(16, 34);
WAV.write('data', 36);
WAV.writeUInt32LE(2, 40);

const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const dirs: string[] = [];
function tempRoot(): string {
  const path = mkdtempSync(join(tmpdir(), 'asa-blocks-upload-spec-'));
  dirs.push(path);
  return path;
}
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
async function* chunks(bytes: Uint8Array, width = 7): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += width) {
    yield bytes.subarray(offset, Math.min(offset + width, bytes.byteLength));
  }
}
function uploadDirectory(root: string): string {
  return join(root, 'asa-blocks-uploads');
}
function expectUploadDirectoryEmpty(root: string): void {
  const directory = uploadDirectory(root);
  expect(existsSync(directory)).toBe(true);
  expect(readdirSync(directory)).toEqual([]);
}

const binaries: readonly [BlocksAssetFormat, Uint8Array][] = [
  ['png', PNG],
  ['jpg', JPG],
  ['wav', WAV],
  ['mp3', MP3],
];

describe('Blocks upload content capture', () => {
  it.each(binaries)(
    'accepts actual %s bytes and computes both identities',
    async (format, bytes) => {
      const root = tempRoot();
      const captured = await captureBlocksAssetUpload(chunks(bytes), format, root);
      expect(captured).toMatchObject({
        dataFormat: format,
        assetId: md5(bytes),
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
      });
      rmSync(captured.path);
    },
  );
  it.each(['png', 'jpg', 'wav', 'mp3'] as const)(
    'rejects arbitrary bytes declared as %s and removes the temp file',
    async (format) => {
      const root = tempRoot();
      await expect(
        captureBlocksAssetUpload(chunks(Buffer.from('not-a-media-container')), format, root),
      ).rejects.toMatchObject({ reason: 'blocks_asset_format_invalid' });
      expectUploadDirectoryEmpty(root);
    },
  );

  it('accepts a bounded SVG with only local/data references', async () => {
    const root = tempRoot();
    const svg = Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><style>.x{fill:url(#g)}</style><rect class="x" fill="url(#g)"/><image href="data:image/png;base64,AA=="/></svg>',
    );
    const captured = await captureBlocksAssetUpload(chunks(svg), 'svg', root);
    expect(captured.assetId).toBe(md5(svg));
    rmSync(captured.path);
  });

  it.each([
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject><p>bad</p></foreignObject></svg>',
    '<svg><rect onclick="alert(1)"/></svg>',
    '<svg><image href="https://example.test/a.png"/></svg>',
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="//evil.test/a"/></svg>',
    '<svg><style>@import "https://evil.test/x.css";</style></svg>',
    '<svg><rect style="fill:url(https://evil.test/x.svg)"/></svg>',
  ])('rejects active or external SVG content %#', async (markup) => {
    const root = tempRoot();
    await expect(
      captureBlocksAssetUpload(chunks(Buffer.from(markup)), 'svg', root),
    ).rejects.toMatchObject({ reason: 'blocks_asset_format_invalid' });
    expectUploadDirectoryEmpty(root);
  });

  it('stops an oversized image while streaming and cleans partial bytes', async () => {
    const root = tempRoot();
    async function* tooLarge() {
      const megabyte = new Uint8Array(1024 * 1024);
      for (let index = 0; index < 11; index += 1) yield megabyte;
    }
    await expect(captureBlocksAssetUpload(tooLarge(), 'png', root)).rejects.toMatchObject({
      reason: 'blocks_asset_too_large',
    });
    expectUploadDirectoryEmpty(root);
  });

  it('rejects an empty asset and cleans the created temp file', async () => {
    const root = tempRoot();
    await expect(
      captureBlocksAssetUpload(chunks(new Uint8Array()), 'png', root),
    ).rejects.toMatchObject({
      reason: 'blocks_asset_empty',
    });
    expectUploadDirectoryEmpty(root);
  });
});

function fakes(root: string, bytes: Uint8Array) {
  const order: string[] = [];
  const blobs: BlocksBlobStorePort = {
    exists: vi.fn(async () => false),
    open: vi.fn(async () => null),
    putImmutable: vi.fn(async (input) => {
      order.push('blob');
      expect(readFileSync(input.sourcePath)).toEqual(Buffer.from(bytes));
      return { objectKey: `server/${input.sha256}.${input.dataFormat}`, created: true };
    }),
  };
  const metadata: BlocksAssetMetadataCommitPort = {
    resolve: vi.fn(async () => null),
    commit: vi.fn(async (input) => {
      order.push('metadata');
      return {
        ...input.reference,
        tenantId: input.tenantId,
        blobCommitted: true,
      };
    }),
  };
  return {
    order,
    blobs,
    metadata,
    pipeline: new BlocksAssetUploadPipeline(blobs, metadata, root),
  };
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('Blocks asset-before-metadata upload pipeline', () => {
  it('rejects malformed path identity before consuming or storing bytes', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const source = chunks(PNG);
    await expect(
      h.pipeline.upload({ tenantId: TENANT_ID, assetId: 'NOT-MD5', dataFormat: 'png', source }),
    ).rejects.toMatchObject({ reason: 'blocks_asset_identity_mismatch' });
    expect(h.order).toEqual([]);
    expect(existsSync(uploadDirectory(root))).toBe(false);
  });

  it('commits blob first, returns only canonical reference and removes temp bytes', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const result = await h.pipeline.upload({
      tenantId: TENANT_ID,
      assetId: md5(PNG),
      dataFormat: 'png',
      source: chunks(PNG),
    });
    expect(result).toEqual({
      assetId: md5(PNG),
      dataFormat: 'png',
      sha256: sha256(PNG),
      sizeBytes: PNG.byteLength,
    });
    expect(h.order).toEqual(['blob', 'metadata']);
    expect(JSON.stringify(result)).not.toContain('objectKey');
    expectUploadDirectoryEmpty(root);
  });

  it('rejects a path MD5 mismatch before durable storage', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: '0'.repeat(32),
        dataFormat: 'png',
        source: chunks(PNG),
      }),
    ).rejects.toMatchObject({ reason: 'blocks_asset_identity_mismatch' });
    expect(h.order).toEqual([]);
    expectUploadDirectoryEmpty(root);
  });

  it('does not commit metadata when object persistence fails', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    vi.mocked(h.blobs.putImmutable).mockRejectedValueOnce(new Error('s3 unavailable'));
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
      }),
    ).rejects.toThrow('s3 unavailable');
    expect(h.metadata.commit).not.toHaveBeenCalled();
    expectUploadDirectoryEmpty(root);
  });

  it('allows an orphan blob when metadata commit fails, but never reports success', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    vi.mocked(h.metadata.commit).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
      }),
    ).rejects.toThrow('database unavailable');
    expect(h.order).toEqual(['blob']);
    expectUploadDirectoryEmpty(root);
  });

  it('preserves immutable alias conflicts as a distinct failure', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    vi.mocked(h.metadata.commit).mockRejectedValueOnce(new BlocksAssetIdentityConflictError());
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetIdentityConflictError);
    expectUploadDirectoryEmpty(root);
  });

  it('rejects metadata that does not confirm the exact durable reference', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    vi.mocked(h.metadata.commit).mockResolvedValueOnce({
      tenantId: TENANT_ID,
      assetId: md5(PNG),
      dataFormat: 'png',
      sha256: 'f'.repeat(64),
      sizeBytes: PNG.byteLength,
      blobCommitted: true,
    });
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
    expectUploadDirectoryEmpty(root);
  });
});

function uniqueBudget() {
  const commit = vi.fn();
  const release = vi.fn();
  const reserve = vi.fn(() => ({ ok: true as const, value: { commit, release } }));
  return { port: { reserve }, reserve, commit, release };
}

describe('Blocks unique-byte budget handoff', () => {
  it('commits a new-byte reservation immediately after durable blob persistence', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const budget = uniqueBudget();
    await h.pipeline.upload({
      tenantId: TENANT_ID,
      assetId: md5(PNG),
      dataFormat: 'png',
      source: chunks(PNG),
      uniqueByteBudget: budget.port,
    });
    expect(budget.reserve).toHaveBeenCalledWith(PNG.byteLength);
    expect(budget.commit).toHaveBeenCalledOnce();
    expect(budget.release).not.toHaveBeenCalled();
  });
  it('does not charge an exact replay when the immutable blob already exists', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    vi.mocked(h.blobs.exists).mockResolvedValueOnce(true);
    const budget = uniqueBudget();
    await h.pipeline.upload({
      tenantId: TENANT_ID,
      assetId: md5(PNG),
      dataFormat: 'png',
      source: chunks(PNG),
      uniqueByteBudget: budget.port,
    });
    expect(budget.reserve).not.toHaveBeenCalled();
  });

  it('releases reserved bytes when S3 persistence fails before acceptance', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const budget = uniqueBudget();
    vi.mocked(h.blobs.putImmutable).mockRejectedValueOnce(new Error('s3 unavailable'));
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
        uniqueByteBudget: budget.port,
      }),
    ).rejects.toThrow('s3 unavailable');
    expect(budget.commit).not.toHaveBeenCalled();
    expect(budget.release).toHaveBeenCalledOnce();
  });
  it('keeps bytes charged when object persistence becomes uncertain after write attempt', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const budget = uniqueBudget();
    vi.mocked(h.blobs.putImmutable).mockRejectedValueOnce(
      new BlocksAssetWriteMayHavePersistedError(),
    );
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
        uniqueByteBudget: budget.port,
      }),
    ).rejects.toBeInstanceOf(BlocksAssetWriteMayHavePersistedError);
    expect(budget.commit).toHaveBeenCalledOnce();
    expect(budget.release).not.toHaveBeenCalled();
    expect(h.metadata.commit).not.toHaveBeenCalled();
  });

  it('keeps bytes charged when metadata fails after the object was persisted', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const budget = uniqueBudget();
    vi.mocked(h.metadata.commit).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
        uniqueByteBudget: budget.port,
      }),
    ).rejects.toThrow('database unavailable');
    expect(budget.commit).toHaveBeenCalledOnce();
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('releases a reservation when a concurrent exact upload wins conditional object creation', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    vi.mocked(h.blobs.putImmutable).mockResolvedValueOnce({
      objectKey: `server/${sha256(PNG)}.png`,
      created: false,
    });
    const budget = uniqueBudget();
    await h.pipeline.upload({
      tenantId: TENANT_ID,
      assetId: md5(PNG),
      dataFormat: 'png',
      source: chunks(PNG),
      uniqueByteBudget: budget.port,
    });
    expect(budget.reserve).toHaveBeenCalledWith(PNG.byteLength);
    expect(budget.release).toHaveBeenCalledOnce();
    expect(budget.commit).not.toHaveBeenCalled();
  });

  it('stops before object storage when the unique-byte budget refuses the upload', async () => {
    const root = tempRoot();
    const h = fakes(root, PNG);
    const reserve = vi.fn(() => ({ ok: false as const, code: 'capability_byte_budget' }));
    await expect(
      h.pipeline.upload({
        tenantId: TENANT_ID,
        assetId: md5(PNG),
        dataFormat: 'png',
        source: chunks(PNG),
        uniqueByteBudget: { reserve },
      }),
    ).rejects.toBeInstanceOf(BlocksAssetUploadBudgetError);
    expect(h.blobs.putImmutable).not.toHaveBeenCalled();
    expect(h.metadata.commit).not.toHaveBeenCalled();
  });
});
