import parseScratch from 'scratch-parser';
import {
  BLOCKS_MODULE,
  type BlocksAssetFormat,
  type BlocksAssetReferenceV1,
  type BlocksProjectDocumentV1,
} from '@asa-lab/blocks';

export const BLOCKS_JSON_LIMIT = 16 * 1024 * 1024;
export const BLOCKS_ASSET_TOTAL_LIMIT = 250 * 1024 * 1024;
export type BlocksAssetIdentity = Pick<BlocksAssetReferenceV1, 'assetId' | 'dataFormat'>;
export type BlocksPersistenceReason =
  | 'blocks_project_invalid'
  | 'blocks_project_too_large'
  | 'blocks_asset_identity_invalid'
  | 'blocks_asset_reference_missing'
  | 'blocks_asset_reference_extra'
  | 'blocks_asset_reference_duplicate'
  | 'blocks_asset_reference_mismatch';
export class BlocksPersistenceValidationError extends Error {
  constructor(readonly reason: BlocksPersistenceReason) {
    super(reason);
  }
}
export function rejectDocument(reason: BlocksPersistenceReason): never {
  throw new BlocksPersistenceValidationError(reason);
}
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
export function assetKey(asset: BlocksAssetIdentity): string {
  return `${asset.assetId}.${asset.dataFormat}`;
}
export function assetByteLimit(format: BlocksAssetFormat): number {
  return (format === 'mp3' || format === 'wav' ? 25 : 10) * 1024 * 1024;
}
/** JSON-only snapshot, without silently dropping values or invoking accessors/toJSON. */
export function snapshotJson(value: unknown, maxBytes = BLOCKS_JSON_LIMIT): unknown {
  const ancestors = new Set<object>();
  let measured = 0;
  function visit(node: unknown, depth: number): void {
    if (depth > 256) rejectDocument('blocks_project_invalid');
    if (node === null || typeof node === 'boolean') {
      measured += 4;
      return;
    }
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) rejectDocument('blocks_project_invalid');
      measured += 1;
      return;
    }
    if (typeof node === 'string') {
      measured += Buffer.byteLength(node, 'utf8') + 2;
    } else {
      if (!Array.isArray(node) && !isPlainRecord(node)) rejectDocument('blocks_project_invalid');
      if (ancestors.has(node)) rejectDocument('blocks_project_invalid');
      ancestors.add(node);
      const keys = Reflect.ownKeys(node);
      for (const key of keys) {
        if (Array.isArray(node) && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor))
          rejectDocument('blocks_project_invalid');
        if (Array.isArray(node)) {
          if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= node.length)
            rejectDocument('blocks_project_invalid');
        } else measured += Buffer.byteLength(key, 'utf8') + 3;
        visit(descriptor.value, depth + 1);
        if (measured > maxBytes) rejectDocument('blocks_project_too_large');
      }
      if (Array.isArray(node) && keys.length !== node.length + 1)
        rejectDocument('blocks_project_invalid');
      ancestors.delete(node);
    }
    if (measured > maxBytes) rejectDocument('blocks_project_too_large');
  }
  visit(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) rejectDocument('blocks_project_too_large');
  return JSON.parse(text) as unknown;
}

export async function inspectScratchProject(
  value: unknown,
  maxBytes = BLOCKS_JSON_LIMIT,
): Promise<{
  projectJson: Record<string, unknown>;
  expectedAssets: readonly BlocksAssetIdentity[];
}> {
  const captured = snapshotJson(value, maxBytes);
  if (!isPlainRecord(captured)) rejectDocument('blocks_project_invalid');
  const parsed: unknown = await new Promise((resolve, reject) => {
    parseScratch(JSON.stringify(captured), false, (error, result) => {
      if (error) reject(new BlocksPersistenceValidationError('blocks_project_invalid'));
      else resolve(result);
    });
  });
  if (!Array.isArray(parsed) || !isPlainRecord(parsed[0]) || parsed[0].projectVersion !== 3)
    rejectDocument('blocks_project_invalid');
  const projectJson = { ...parsed[0] };
  delete projectJson.projectVersion;
  // Never validate parser-repaired content and then persist the different input.
  if (JSON.stringify(projectJson) !== JSON.stringify(captured))
    rejectDocument('blocks_project_invalid');
  if (
    !Array.isArray(projectJson.targets) ||
    !Array.isArray(projectJson.monitors) ||
    !Array.isArray(projectJson.extensions)
  )
    rejectDocument('blocks_project_invalid');
  const assets = new Map<string, BlocksAssetIdentity>();
  for (const target of projectJson.targets) {
    if (!isPlainRecord(target) || !Array.isArray(target.costumes) || !Array.isArray(target.sounds))
      rejectDocument('blocks_project_invalid');
    for (const [items, formats] of [
      [target.costumes, ['svg', 'png', 'jpg']],
      [target.sounds, ['wav', 'mp3']],
    ] as const) {
      for (const item of items) {
        if (
          !isPlainRecord(item) ||
          typeof item.assetId !== 'string' ||
          !/^[a-f0-9]{32}$/.test(item.assetId) ||
          typeof item.dataFormat !== 'string' ||
          !(formats as readonly string[]).includes(item.dataFormat) ||
          item.md5ext !== `${item.assetId}.${item.dataFormat}`
        )
          rejectDocument('blocks_asset_identity_invalid');
        const ref = { assetId: item.assetId, dataFormat: item.dataFormat as BlocksAssetFormat };
        assets.set(assetKey(ref), ref);
      }
    }
  }
  return {
    projectJson,
    expectedAssets: [...assets]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, ref]) => ref),
  };
}

export async function inspectBlocksDocument(
  value: unknown,
  jsonLimit = BLOCKS_JSON_LIMIT,
  assetLimit = BLOCKS_ASSET_TOTAL_LIMIT,
): Promise<BlocksProjectDocumentV1> {
  const captured = snapshotJson(value, jsonLimit + 32 * 1024 * 1024);
  if (
    !isPlainRecord(captured) ||
    Object.keys(captured).length !== 4 ||
    !['schemaVersion', 'format', 'projectJson', 'assets'].every((key) =>
      Object.hasOwn(captured, key),
    )
  )
    rejectDocument('blocks_project_invalid');
  const structural = BLOCKS_MODULE.provider!.validate(captured);
  if (!structural.ok) rejectDocument('blocks_project_invalid');
  const document = structural.payload;
  if (document.projectJson === null) {
    if (document.assets.length) rejectDocument('blocks_asset_reference_extra');
    return { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] };
  }
  const inspected = await inspectScratchProject(document.projectJson, jsonLimit);
  const expected = new Set(inspected.expectedAssets.map(assetKey));
  const references = new Map<string, BlocksAssetReferenceV1>();
  let total = 0;
  for (const ref of document.assets) {
    const key = assetKey(ref);
    if (references.has(key)) rejectDocument('blocks_asset_reference_duplicate');
    if (!expected.has(key)) rejectDocument('blocks_asset_reference_extra');
    if (ref.sizeBytes > assetByteLimit(ref.dataFormat)) rejectDocument('blocks_project_too_large');
    references.set(key, { ...ref });
    total += ref.sizeBytes;
    if (!Number.isSafeInteger(total) || total > assetLimit)
      rejectDocument('blocks_project_too_large');
  }
  if (references.size !== expected.size) rejectDocument('blocks_asset_reference_missing');
  return {
    schemaVersion: 1,
    format: 'scratch-3',
    projectJson: inspected.projectJson,
    assets: inspected.expectedAssets.map((ref) => references.get(assetKey(ref))!),
  };
}
