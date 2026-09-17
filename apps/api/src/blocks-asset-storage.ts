import { createReadStream, statSync } from 'node:fs';
import type pg from 'pg';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { BlocksAssetFormat, BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import { withTenantContext } from '@asa-lab/database';
import type {
  BlocksAssetMetadataPort,
  BlocksStoredAssetMetadata,
} from './blocks-persistence.guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const FORMATS = new Set<BlocksAssetFormat>(['svg', 'png', 'jpg', 'wav', 'mp3']);

export interface BlocksObjectStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
}
export type BlocksBlobReadable = AsyncIterable<Uint8Array>;

export interface BlocksBlobStorePort {
  putImmutable(input: {
    readonly tenantId: string;
    readonly sha256: string;
    readonly dataFormat: BlocksAssetFormat;
    readonly sizeBytes: number;
    readonly sourcePath: string;
  }): Promise<{ readonly objectKey: string }>;
  open(input: {
    readonly tenantId: string;
    readonly sha256: string;
    readonly dataFormat: BlocksAssetFormat;
  }): Promise<BlocksBlobReadable | null>;
  exists(input: {
    readonly tenantId: string;
    readonly sha256: string;
    readonly dataFormat: BlocksAssetFormat;
  }): Promise<boolean>;
}

interface S3Sender {
  send(command: HeadObjectCommand | GetObjectCommand | PutObjectCommand): Promise<unknown>;
}
function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Blocks object storage.`);
  return value;
}

export function readBlocksObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): BlocksObjectStorageConfig {
  const endpoint = requireEnv(env, 'ASA_OBJECT_STORAGE_ENDPOINT');
  const region = requireEnv(env, 'ASA_OBJECT_STORAGE_REGION');
  const bucket = requireEnv(env, 'ASA_OBJECT_STORAGE_BUCKET');
  const accessKeyId = requireEnv(env, 'ASA_OBJECT_STORAGE_ACCESS_KEY');
  const secretAccessKey = requireEnv(env, 'ASA_OBJECT_STORAGE_SECRET_KEY');
  const rawForce = requireEnv(env, 'ASA_OBJECT_STORAGE_FORCE_PATH_STYLE');
  if (rawForce !== 'true' && rawForce !== 'false') {
    throw new Error('ASA_OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false.');
  }
  const parsed = new URL(endpoint);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('ASA_OBJECT_STORAGE_ENDPOINT must be an http(s) URL without credentials.');
  }
  return {
    endpoint: parsed.origin,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: rawForce === 'true',
  };
}
export function blocksObjectKey(input: {
  tenantId: string;
  sha256: string;
  dataFormat: BlocksAssetFormat;
}): string {
  if (!UUID.test(input.tenantId)) throw new Error('Invalid Blocks tenant id.');
  if (!SHA256.test(input.sha256)) throw new Error('Invalid Blocks SHA-256.');
  if (!FORMATS.has(input.dataFormat)) throw new Error('Invalid Blocks asset format.');
  return `tenants/${input.tenantId}/blocks/assets/${input.sha256.slice(0, 2)}/${input.sha256}.${input.dataFormat}`;
}

function isNotFound(problem: unknown): boolean {
  if (typeof problem !== 'object' || problem === null) return false;
  const value = problem as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    value.name === 'NotFound' ||
    value.name === 'NoSuchKey' ||
    value.$metadata?.httpStatusCode === 404
  );
}

function isAsyncBytes(value: unknown): value is BlocksBlobReadable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}
export class S3BlocksBlobStore implements BlocksBlobStorePort {
  private readonly client: S3Sender;

  constructor(
    private readonly config: BlocksObjectStorageConfig,
    client?: S3Sender,
  ) {
    this.client =
      client ??
      (new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }) as unknown as S3Sender);
  }

  private async headSize(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<number | null> {
    const Key = blocksObjectKey(input);
    try {
      const result = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key }),
      )) as { ContentLength?: unknown };
      if (!Number.isSafeInteger(result.ContentLength) || Number(result.ContentLength) < 1)
        throw new BlocksAssetStorageIntegrityError();
      return Number(result.ContentLength);
    } catch (problem) {
      if (isNotFound(problem)) return null;
      throw problem;
    }
  }

  async exists(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<boolean> {
    return (await this.headSize(input)) !== null;
  }
  async putImmutable(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
    sizeBytes: number;
    sourcePath: string;
  }): Promise<{ objectKey: string }> {
    const objectKey = blocksObjectKey(input);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
      throw new Error('Invalid Blocks object size.');
    }
    const actualSize = statSync(input.sourcePath).size;
    if (actualSize !== input.sizeBytes)
      throw new Error('Blocks object size changed before upload.');
    const existingSize = await this.headSize(input);
    if (existingSize !== null) {
      if (existingSize !== input.sizeBytes) throw new BlocksAssetStorageIntegrityError();
      return { objectKey };
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey,
        Body: createReadStream(input.sourcePath),
        ContentLength: input.sizeBytes,
      }),
    );
    const verified = (await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
    )) as { ContentLength?: unknown };
    if (verified.ContentLength !== input.sizeBytes) {
      throw new Error('Blocks object store did not persist the expected byte count.');
    }
    return { objectKey };
  }
  async open(input: {
    tenantId: string;
    sha256: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<BlocksBlobReadable | null> {
    const Key = blocksObjectKey(input);
    try {
      const result = (await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key }),
      )) as { Body?: unknown };
      if (!isAsyncBytes(result.Body)) {
        throw new Error('Blocks object store returned an unreadable body.');
      }
      return result.Body;
    } catch (problem) {
      if (isNotFound(problem)) return null;
      throw problem;
    }
  }
}

export class BlocksAssetIdentityConflictError extends Error {
  constructor() {
    super('blocks_asset_identity_conflict');
  }
}

export class BlocksAssetStorageIntegrityError extends Error {
  constructor() {
    super('blocks_asset_storage_integrity');
  }
}
interface BlocksAssetRow {
  readonly asset_id: string;
  readonly data_format: BlocksAssetFormat;
  readonly sha256: string;
  readonly size_bytes: string | number;
  readonly object_key: string;
}

function metadataFromRow(tenantId: string, row: BlocksAssetRow): BlocksStoredAssetMetadata {
  const sizeBytes = Number(row.size_bytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new BlocksAssetStorageIntegrityError();
  }
  return {
    tenantId,
    assetId: row.asset_id,
    dataFormat: row.data_format,
    sha256: row.sha256,
    sizeBytes,
    blobCommitted: true,
  };
}

export class PgBlocksAssetMetadataStore implements BlocksAssetMetadataPort {
  constructor(private readonly pool: pg.Pool) {}

  async resolve(input: {
    tenantId: string;
    assetId: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<BlocksStoredAssetMetadata | null> {
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      const result = await client.query<BlocksAssetRow>(
        `SELECT alias.asset_id, alias.data_format, alias.sha256,
                blob.size_bytes, blob.object_key
           FROM public.blocks_asset_aliases alias
           JOIN public.blocks_blobs blob
             ON blob.tenant_id=alias.tenant_id
            AND blob.sha256=alias.sha256
            AND blob.data_format=alias.data_format
          WHERE alias.tenant_id=$1
            AND alias.asset_id=$2
            AND alias.data_format=$3`,
        [input.tenantId, input.assetId, input.dataFormat],
      );
      const row = result.rows[0];
      return row ? metadataFromRow(input.tenantId, row) : null;
    });
  }

  async commit(input: {
    tenantId: string;
    reference: BlocksAssetReferenceV1;
    objectKey: string;
  }): Promise<BlocksStoredAssetMetadata> {
    const expectedKey = blocksObjectKey({
      tenantId: input.tenantId,
      sha256: input.reference.sha256,
      dataFormat: input.reference.dataFormat,
    });
    if (input.objectKey !== expectedKey) throw new BlocksAssetStorageIntegrityError();
    return withTenantContext(this.pool, input.tenantId, async (client) => {
      const existing = await client.query<BlocksAssetRow>(
        `SELECT alias.asset_id, alias.data_format, alias.sha256,
                blob.size_bytes, blob.object_key
           FROM public.blocks_asset_aliases alias
           JOIN public.blocks_blobs blob
             ON blob.tenant_id=alias.tenant_id
            AND blob.sha256=alias.sha256
            AND blob.data_format=alias.data_format
          WHERE alias.tenant_id=$1 AND alias.asset_id=$2 AND alias.data_format=$3`,
        [input.tenantId, input.reference.assetId, input.reference.dataFormat],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.sha256 !== input.reference.sha256) {
          throw new BlocksAssetIdentityConflictError();
        }
        if (
          Number(row.size_bytes) !== input.reference.sizeBytes ||
          row.object_key !== expectedKey
        ) {
          throw new BlocksAssetStorageIntegrityError();
        }
        return metadataFromRow(input.tenantId, row);
      }

      await client.query(
        `INSERT INTO public.blocks_blobs
           (tenant_id, sha256, data_format, size_bytes, object_key)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, sha256, data_format) DO NOTHING`,
        [
          input.tenantId,
          input.reference.sha256,
          input.reference.dataFormat,
          input.reference.sizeBytes,
          expectedKey,
        ],
      );
      const blob = await client.query<BlocksAssetRow>(
        `SELECT ''::text AS asset_id, data_format, sha256, size_bytes, object_key
           FROM public.blocks_blobs
          WHERE tenant_id=$1 AND sha256=$2 AND data_format=$3`,
        [input.tenantId, input.reference.sha256, input.reference.dataFormat],
      );
      const blobRow = blob.rows[0];
      if (
        !blobRow ||
        Number(blobRow.size_bytes) !== input.reference.sizeBytes ||
        blobRow.object_key !== expectedKey
      ) {
        throw new BlocksAssetStorageIntegrityError();
      }

      await client.query(
        `INSERT INTO public.blocks_asset_aliases
           (tenant_id, asset_id, data_format, sha256)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, asset_id, data_format) DO NOTHING`,
        [
          input.tenantId,
          input.reference.assetId,
          input.reference.dataFormat,
          input.reference.sha256,
        ],
      );
      const alias = await client.query<BlocksAssetRow>(
        `SELECT alias.asset_id, alias.data_format, alias.sha256,
                blob.size_bytes, blob.object_key
           FROM public.blocks_asset_aliases alias
           JOIN public.blocks_blobs blob
             ON blob.tenant_id=alias.tenant_id
            AND blob.sha256=alias.sha256
            AND blob.data_format=alias.data_format
          WHERE alias.tenant_id=$1 AND alias.asset_id=$2 AND alias.data_format=$3`,
        [input.tenantId, input.reference.assetId, input.reference.dataFormat],
      );
      const row = alias.rows[0];
      if (!row) throw new BlocksAssetStorageIntegrityError();
      if (row.sha256 !== input.reference.sha256) {
        throw new BlocksAssetIdentityConflictError();
      }
      if (Number(row.size_bytes) !== input.reference.sizeBytes || row.object_key !== expectedKey) {
        throw new BlocksAssetStorageIntegrityError();
      }
      return metadataFromRow(input.tenantId, row);
    });
  }
}
