import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import { SaxesParser } from 'saxes';
import type { BlocksAssetFormat, BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import { assetByteLimit } from './blocks-durable-document.js';
import type {
  BlocksAssetMetadataPort,
  BlocksStoredAssetMetadata,
} from './blocks-persistence.guard.js';
import {
  BlocksAssetIdentityConflictError,
  BlocksAssetStorageIntegrityError,
  type BlocksBlobStorePort,
} from './blocks-asset-storage.js';

const ASSET_ID = /^[a-f0-9]{32}$/;
const FORMATS = new Set<BlocksAssetFormat>(['svg', 'png', 'jpg', 'wav', 'mp3']);
const BINARY_EXT: Readonly<Record<Exclude<BlocksAssetFormat, 'svg'>, string>> = {
  png: 'png',
  jpg: 'jpg',
  wav: 'wav',
  mp3: 'mp3',
};
export type BlocksAssetUploadReason =
  | 'blocks_asset_empty'
  | 'blocks_asset_too_large'
  | 'blocks_asset_format_invalid'
  | 'blocks_asset_identity_mismatch';

export class BlocksAssetUploadValidationError extends Error {
  constructor(readonly reason: BlocksAssetUploadReason) {
    super(reason);
  }
}

export interface BlocksAssetMetadataCommitPort extends BlocksAssetMetadataPort {
  commit(input: {
    readonly tenantId: string;
    readonly reference: BlocksAssetReferenceV1;
    readonly objectKey: string;
  }): Promise<BlocksStoredAssetMetadata>;
}

export interface CapturedBlocksAsset {
  readonly path: string;
  readonly assetId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly dataFormat: BlocksAssetFormat;
}

function reject(reason: BlocksAssetUploadReason): never {
  throw new BlocksAssetUploadValidationError(reason);
}
function validateLocalReference(value: string): void {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('#') || /^data:/i.test(trimmed)) return;
  reject('blocks_asset_format_invalid');
}

function validateCss(css: string): void {
  const normalized = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\\/.test(normalized) || /@import\b/i.test(normalized)) {
    reject('blocks_asset_format_invalid');
  }
  const starts = normalized.match(/url\s*\(/gi)?.length ?? 0;
  let matched = 0;
  for (const match of normalized.matchAll(/url\s*\(([^)]*)\)/gi)) {
    matched += 1;
    let value = match[1]?.trim() ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    } else if (value.includes('"') || value.includes("'")) {
      reject('blocks_asset_format_invalid');
    }
    validateLocalReference(value);
  }
  if (matched !== starts) reject('blocks_asset_format_invalid');
}

function attributeLocalName(attribute: unknown): string {
  if (typeof attribute !== 'object' || attribute === null) return '';
  const local = (attribute as { local?: unknown }).local;
  const name = (attribute as { name?: unknown }).name;
  return String(typeof local === 'string' ? local : typeof name === 'string' ? name : '');
}
async function validateSvg(path: string): Promise<void> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch {
    reject('blocks_asset_format_invalid');
  }
  let rootSeen = false;
  let styleDepth = 0;
  let styleText = '';
  try {
    const parser = new SaxesParser({ xmlns: true });
    parser.on('doctype', () => reject('blocks_asset_format_invalid'));
    parser.on('processinginstruction', () => reject('blocks_asset_format_invalid'));
    parser.on('opentag', (tag) => {
      const local = String(tag.local ?? tag.name).toLowerCase();
      if (!rootSeen) {
        if (local !== 'svg') reject('blocks_asset_format_invalid');
        rootSeen = true;
      }
      if (local === 'script' || local === 'foreignobject') reject('blocks_asset_format_invalid');
      if (local === 'style') {
        styleDepth += 1;
        styleText = '';
      }
      for (const attribute of Object.values(tag.attributes)) {
        const name = attributeLocalName(attribute).toLowerCase();
        const value = typeof attribute === 'string' ? attribute : String(attribute.value);
        if (name.startsWith('on')) reject('blocks_asset_format_invalid');
        if (name === 'href') validateLocalReference(value);
        if (name === 'style' || /url\s*\(/i.test(value)) validateCss(value);
      }
    });
    parser.on('text', (value) => {
      if (styleDepth > 0) styleText += value;
    });
    parser.on('cdata', (value) => {
      if (styleDepth > 0) styleText += value;
    });
    parser.on('closetag', (tag) => {
      const local = String(tag.local ?? tag.name).toLowerCase();
      if (local === 'style' && styleDepth > 0) {
        validateCss(styleText);
        styleText = '';
        styleDepth -= 1;
      }
    });
    parser.write(text).close();
    if (!rootSeen || styleDepth !== 0) reject('blocks_asset_format_invalid');
  } catch (problem) {
    if (problem instanceof BlocksAssetUploadValidationError) throw problem;
    reject('blocks_asset_format_invalid');
  }
}

async function validateContainer(path: string, format: BlocksAssetFormat): Promise<void> {
  if (format === 'svg') {
    await validateSvg(path);
    return;
  }
  const detected = await fileTypeFromFile(path);
  if (!detected || detected.ext !== BINARY_EXT[format]) {
    reject('blocks_asset_format_invalid');
  }
}
export async function captureBlocksAssetUpload(
  source: AsyncIterable<Uint8Array>,
  dataFormat: BlocksAssetFormat,
  tempRoot = tmpdir(),
): Promise<CapturedBlocksAsset> {
  if (!FORMATS.has(dataFormat)) reject('blocks_asset_format_invalid');
  const directory = join(tempRoot, 'asa-blocks-uploads');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${randomUUID()}.upload`);
  const md5 = createHash('md5');
  const sha = createHash('sha256');
  const limit = assetByteLimit(dataFormat);
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      sizeBytes += bytes.byteLength;
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes > limit) {
        callback(new BlocksAssetUploadValidationError('blocks_asset_too_large'));
        return;
      }
      md5.update(bytes);
      sha.update(bytes);
      callback(null, bytes);
    },
  });
  try {
    await pipeline(
      Readable.from(source),
      meter,
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    );
    if (sizeBytes === 0) reject('blocks_asset_empty');
    await validateContainer(path, dataFormat);
    return {
      path,
      assetId: md5.digest('hex'),
      sha256: sha.digest('hex'),
      sizeBytes,
      dataFormat,
    };
  } catch (problem) {
    await unlink(path).catch(() => undefined);
    throw problem;
  }
}
export class BlocksAssetUploadPipeline {
  constructor(
    private readonly blobs: BlocksBlobStorePort,
    private readonly metadata: BlocksAssetMetadataCommitPort,
    private readonly tempRoot = tmpdir(),
  ) {}

  async upload(input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly dataFormat: BlocksAssetFormat;
    readonly source: AsyncIterable<Uint8Array>;
  }): Promise<BlocksAssetReferenceV1> {
    if (!ASSET_ID.test(input.assetId) || !FORMATS.has(input.dataFormat)) {
      reject('blocks_asset_identity_mismatch');
    }
    let captured: CapturedBlocksAsset | null = null;
    try {
      captured = await captureBlocksAssetUpload(input.source, input.dataFormat, this.tempRoot);
      if (captured.assetId !== input.assetId) reject('blocks_asset_identity_mismatch');
      const reference: BlocksAssetReferenceV1 = {
        assetId: captured.assetId,
        dataFormat: captured.dataFormat,
        sha256: captured.sha256,
        sizeBytes: captured.sizeBytes,
      };
      const stored = await this.blobs.putImmutable({
        tenantId: input.tenantId,
        sha256: reference.sha256,
        dataFormat: reference.dataFormat,
        sizeBytes: reference.sizeBytes,
        sourcePath: captured.path,
      });
      const committed = await this.metadata.commit({
        tenantId: input.tenantId,
        reference,
        objectKey: stored.objectKey,
      });
      if (
        committed.tenantId !== input.tenantId ||
        committed.assetId !== reference.assetId ||
        committed.dataFormat !== reference.dataFormat ||
        committed.sha256 !== reference.sha256 ||
        committed.sizeBytes !== reference.sizeBytes ||
        committed.blobCommitted !== true
      ) {
        throw new BlocksAssetStorageIntegrityError();
      }
      return reference;
    } finally {
      if (captured) await unlink(captured.path).catch(() => undefined);
    }
  }
}

export function isBlocksAssetIdentityConflict(
  problem: unknown,
): problem is BlocksAssetIdentityConflictError {
  return problem instanceof BlocksAssetIdentityConflictError;
}
