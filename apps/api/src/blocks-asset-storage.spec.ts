import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  BlocksAssetStorageIntegrityError,
  BlocksAssetWriteMayHavePersistedError,
  S3BlocksBlobStore,
  blocksObjectKey,
  readBlocksObjectStorageConfig,
  type BlocksObjectStorageConfig,
} from './blocks-asset-storage.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const sha256 = 'a'.repeat(64);
const config: BlocksObjectStorageConfig = {
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  bucket: 'asa-blocks',
  accessKeyId: 'fixture-key',
  secretAccessKey: 'fixture-secret',
  forcePathStyle: true,
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe('Blocks object-storage configuration and keys', () => {
  it('requires the exact private storage configuration and normalises only the origin', () => {
    expect(
      readBlocksObjectStorageConfig({
        ASA_OBJECT_STORAGE_ENDPOINT: 'http://minio:9000/',
        ASA_OBJECT_STORAGE_REGION: 'us-east-1',
        ASA_OBJECT_STORAGE_BUCKET: 'asa-blocks',
        ASA_OBJECT_STORAGE_ACCESS_KEY: 'key',
        ASA_OBJECT_STORAGE_SECRET_KEY: 'secret',
        ASA_OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    ).toEqual({
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      bucket: 'asa-blocks',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });
    expect(() => readBlocksObjectStorageConfig({})).toThrow(/ASA_OBJECT_STORAGE_ENDPOINT/);
    expect(() =>
      readBlocksObjectStorageConfig({
        ASA_OBJECT_STORAGE_ENDPOINT: 'http://u:p@minio:9000',
        ASA_OBJECT_STORAGE_REGION: 'r',
        ASA_OBJECT_STORAGE_BUCKET: 'b',
        ASA_OBJECT_STORAGE_ACCESS_KEY: 'k',
        ASA_OBJECT_STORAGE_SECRET_KEY: 's',
        ASA_OBJECT_STORAGE_FORCE_PATH_STYLE: 'false',
      }),
    ).toThrow(/without credentials/);
  });
  it('derives the physical key exclusively from tenant, SHA-256 and format', () => {
    expect(blocksObjectKey({ tenantId, sha256, dataFormat: 'png' })).toBe(
      `tenants/${tenantId}/blocks/assets/aa/${sha256}.png`,
    );
    expect(() => blocksObjectKey({ tenantId: '../x', sha256, dataFormat: 'png' })).toThrow();
    expect(() =>
      blocksObjectKey({ tenantId, sha256: 'A'.repeat(64), dataFormat: 'png' }),
    ).toThrow();
  });
});

function tempFile(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'asa-blocks-store-'));
  dirs.push(dir);
  const file = join(dir, 'asset.bin');
  writeFileSync(file, bytes);
  return file;
}

function headObject(marker: string | null = sha256, sizeBytes = 3) {
  return {
    ContentLength: sizeBytes,
    Metadata: marker === null ? {} : { 'asa-sha256': marker },
  };
}

describe('S3BlocksBlobStore immutable persistence', () => {
  it('puts a missing object, verifies the exact byte count and never accepts a client key', async () => {
    const calls: Array<HeadObjectCommand | PutObjectCommand | GetObjectCommand> = [];
    let heads = 0;
    const client = {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        calls.push(command);
        if (command instanceof HeadObjectCommand) {
          heads += 1;
          if (heads === 1)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          return headObject();
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body;
          if (
            !body ||
            typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function'
          )
            throw new Error('expected streaming upload body');
          let bytes = 0;
          for await (const chunk of body as AsyncIterable<Uint8Array>) bytes += chunk.byteLength;
          expect(bytes).toBe(3);
        }
        return {};
      },
    };
    const store = new S3BlocksBlobStore(config, client);
    const result = await store.putImmutable({
      tenantId,
      sha256,
      dataFormat: 'png',
      sizeBytes: 3,
      sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
    });
    expect(result).toEqual({
      objectKey: `tenants/${tenantId}/blocks/assets/aa/${sha256}.png`,
      created: true,
    });
    expect(calls.filter((item) => item instanceof HeadObjectCommand)).toHaveLength(2);
    const put = calls.find((item): item is PutObjectCommand => item instanceof PutObjectCommand);
    expect(put?.input).toMatchObject({
      Bucket: 'asa-blocks',
      Key: result.objectKey,
      ContentLength: 3,
      IfNoneMatch: '*',
      Metadata: { 'asa-sha256': sha256 },
    });
  });

  it('reuses an existing immutable object without sending another PUT', async () => {
    const calls: Array<HeadObjectCommand | PutObjectCommand | GetObjectCommand> = [];
    const client = {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        calls.push(command);
        return headObject();
      },
    };
    const store = new S3BlocksBlobStore(config, client);
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).resolves.toMatchObject({ created: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('rejects a same-size existing object with the wrong SHA marker', async () => {
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) return headObject('b'.repeat(64));
        throw new Error('PUT must not run for an existing corrupt key');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
  });

  it('rejects a same-size existing object with no SHA marker', async () => {
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) return headObject(null);
        throw new Error('PUT must not run for an existing unverifiable key');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
  });

  it('exists fails closed for wrong or missing SHA marker', async () => {
    for (const marker of ['b'.repeat(64), null] as const) {
      const store = new S3BlocksBlobStore(config, {
        async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
          if (command instanceof HeadObjectCommand) return headObject(marker);
          throw new Error('unexpected command');
        },
      });
      await expect(store.exists({ tenantId, sha256, dataFormat: 'png' })).rejects.toBeInstanceOf(
        BlocksAssetStorageIntegrityError,
      );
    }
  });

  it('treats a conditional PUT race as an idempotent replay after size and SHA verification', async () => {
    let heads = 0;
    const client = {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) {
          heads += 1;
          if (heads === 1)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          return headObject();
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body as AsyncIterable<Uint8Array>;
          for await (const _chunk of body) void _chunk;
          throw Object.assign(new Error('race'), {
            name: 'PreconditionFailed',
            $metadata: { httpStatusCode: 412 },
          });
        }
        throw new Error('unexpected command');
      },
    };
    const store = new S3BlocksBlobStore(config, client);
    const result = await store.putImmutable({
      tenantId,
      sha256,
      dataFormat: 'png',
      sizeBytes: 3,
      sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
    });
    expect(result).toEqual({
      objectKey: `tenants/${tenantId}/blocks/assets/aa/${sha256}.png`,
      created: false,
    });
    expect(heads).toBe(2);
  });

  it('rejects a conditional PUT race when the raced object has the wrong SHA marker', async () => {
    let heads = 0;
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) {
          heads += 1;
          if (heads === 1)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          return headObject('b'.repeat(64));
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body as AsyncIterable<Uint8Array>;
          for await (const _chunk of body) void _chunk;
          throw Object.assign(new Error('race'), {
            name: 'PreconditionFailed',
            $metadata: { httpStatusCode: 412 },
          });
        }
        throw new Error('unexpected command');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
  });

  it('reconciles a lost PUT response when the exact object is durably present', async () => {
    let heads = 0;
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) {
          heads += 1;
          if (heads === 1)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          return headObject();
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body as AsyncIterable<Uint8Array>;
          for await (const _chunk of body) void _chunk;
          throw new Error('response lost after put');
        }
        throw new Error('unexpected command');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).resolves.toMatchObject({ created: true });
  });

  it('does not reconcile an ambiguous PUT error to a same-size object with the wrong SHA marker', async () => {
    let heads = 0;
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) {
          heads += 1;
          if (heads === 1)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          return headObject('b'.repeat(64));
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body as AsyncIterable<Uint8Array>;
          for await (const _chunk of body) void _chunk;
          throw new Error('response lost after put');
        }
        throw new Error('unexpected command');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
  });

  it('marks post-write verification failure as possibly persisted', async () => {
    let heads = 0;
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) {
          heads += 1;
          if (heads === 1)
            throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
          throw new Error('verification unavailable');
        }
        if (command instanceof PutObjectCommand) {
          const body = command.input.Body as AsyncIterable<Uint8Array>;
          for await (const _chunk of body) void _chunk;
          return {};
        }
        throw new Error('unexpected command');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetWriteMayHavePersistedError);
  });

  it('rejects an existing object whose byte count contradicts the canonical reference', async () => {
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof HeadObjectCommand) return headObject(sha256, 2);
        throw new Error('PUT must not run for an existing key');
      },
    });
    await expect(
      store.putImmutable({
        tenantId,
        sha256,
        dataFormat: 'png',
        sizeBytes: 3,
        sourcePath: tempFile(Uint8Array.of(1, 2, 3)),
      }),
    ).rejects.toBeInstanceOf(BlocksAssetStorageIntegrityError);
  });

  it('propagates non-404 object-store failures instead of pretending the object is absent', async () => {
    const store = new S3BlocksBlobStore(config, {
      async send() {
        throw new Error('storage offline');
      },
    });
    await expect(store.exists({ tenantId, sha256, dataFormat: 'png' })).rejects.toThrow(
      'storage offline',
    );
  });

  it('returns the private object body as an async byte stream and treats only 404 as absent', async () => {
    const stream = Readable.from([Buffer.from([1, 2, 3])]);
    const store = new S3BlocksBlobStore(config, {
      async send(command: HeadObjectCommand | PutObjectCommand | GetObjectCommand) {
        if (command instanceof GetObjectCommand) return { Body: stream };
        throw new Error('unexpected command');
      },
    });
    expect(await store.open({ tenantId, sha256, dataFormat: 'png' })).toBe(stream);

    const missing = new S3BlocksBlobStore(config, {
      async send() {
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      },
    });
    expect(await missing.open({ tenantId, sha256, dataFormat: 'png' })).toBeNull();
  });
});
