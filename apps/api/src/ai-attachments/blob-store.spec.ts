import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlocksObjectStorageConfig } from '../blocks-asset-storage';
import {
  aiAttachmentObjectKey,
  S3AiAttachmentBlobStore,
  type AiAttachmentObject,
  type AiS3Sender,
} from './blob-store';
import { aiAttachmentImageFixture } from './validation.fixture';

const config: BlocksObjectStorageConfig = {
  endpoint: 'http://127.0.0.1:19000',
  region: 'us-east-1',
  forcePathStyle: true,
  bucket: 'ai-attachments-unit-test',
  accessKeyId: 'synthetic-unit-access',
  secretAccessKey: 'synthetic-unit-secret',
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

export function memoryS3() {
  const objects = new Map<
    string,
    { bytes: Buffer; metadata: Record<string, string>; version: string }
  >();
  const send = vi.fn<AiS3Sender['send']>(async (command) => {
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      if (objects.has(key))
        throw Object.assign(new Error('already stored'), { $metadata: { httpStatusCode: 412 } });
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as AsyncIterable<Uint8Array>)
        chunks.push(Buffer.from(chunk));
      objects.set(key, {
        bytes: Buffer.concat(chunks),
        metadata: command.input.Metadata!,
        version: randomUUID(),
      });
      return {};
    }
    const object = objects.get(key);
    if (!object)
      throw Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } });
    if (command instanceof DeleteObjectCommand) {
      objects.delete(key);
      return {};
    }
    const metadata = {
      ContentLength: object.bytes.length,
      Metadata: object.metadata,
      VersionId: object.version,
    };
    return command instanceof GetObjectCommand
      ? { ...metadata, Body: Readable.from([object.bytes]) }
      : metadata;
  });
  return { objects, send, client: { send } as AiS3Sender };
}

async function fixture() {
  await mkdir('reports', { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), 'reports/ai-attachment-storage-unit-'));
  directories.push(directory);
  const bytes = aiAttachmentImageFixture('png'),
    sourcePath = join(directory, 'private.upload');
  await writeFile(sourcePath, bytes, { mode: 0o600 });
  const object: AiAttachmentObject = {
    ownerId: randomUUID(),
    uploadId: randomUUID(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
  const input = {
    ...object,
    sourcePath,
    md5Base64: createHash('md5').update(bytes).digest('base64'),
  };
  const fake = memoryS3(),
    store = new S3AiAttachmentBlobStore(config, fake.client);
  return { ...fake, store, object, input, bytes, key: aiAttachmentObjectKey(object) };
}

describe('immutable private AI S3 adapter', () => {
  it('constructs only the canonical private owner/upload/hash key and rejects caller paths or invalid identity', async () => {
    const f = await fixture();
    expect(f.key).toBe(
      `ai/private/v1/owners/${f.object.ownerId}/uploads/${f.object.uploadId}/${f.object.sha256}`,
    );
    expect(
      aiAttachmentObjectKey({
        ...f.object,
        ownerId: f.object.ownerId.toUpperCase(),
        uploadId: f.object.uploadId.toUpperCase(),
      }),
    ).toBe(f.key);
    for (const input of [
      { ...f.object, uploadId: '../other' },
      { ...f.object, ownerId: 'public' },
      { ...f.object, sha256: '../' },
      { ...f.object, sizeBytes: 8 * 1024 * 1024 + 1 },
    ])
      expect(() => aiAttachmentObjectKey(input)).toThrow();
  });

  it('writes with a known byte length, MD5, If-None-Match and exact private metadata, then verifies the complete hash before readiness or reads', async () => {
    const f = await fixture();
    await f.store.putImmutable(f.input);
    const command = f.send.mock.calls.find(
      ([value]) => value instanceof PutObjectCommand,
    )![0] as PutObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: config.bucket,
      Key: f.key,
      ContentLength: f.bytes.length,
      ContentMD5: f.input.md5Base64,
      IfNoneMatch: '*',
      ContentType: 'application/octet-stream',
      CacheControl: 'private, no-store',
      Metadata: {
        'asa-ai-owner': f.object.ownerId,
        'asa-ai-upload': f.object.uploadId,
        'asa-sha256': f.object.sha256,
      },
    });
    expect(command.input).not.toHaveProperty('ACL', 'public-read');
    expect(await f.store.read(f.object)).toEqual(f.bytes);
    expect(
      f.send.mock.calls.every(([, options]) => options?.abortSignal instanceof AbortSignal),
    ).toBe(true);
    expect(f.send.mock.calls.filter(([value]) => value instanceof PutObjectCommand)).toHaveLength(
      1,
    );
  });

  it('reconciles a committed PUT whose response was lost without a second write', async () => {
    const f = await fixture(),
      realSend = f.send.getMockImplementation()!;
    f.send.mockImplementation(async (command, options) => {
      const value = await realSend(command, options);
      if (command instanceof PutObjectCommand)
        throw new Error('synthetic lost response AFTER persistence');
      return value;
    });
    await expect(f.store.putImmutable(f.input)).resolves.toBeUndefined();
    expect(f.objects.get(f.key)?.bytes).toEqual(f.bytes);
    expect(f.send.mock.calls.filter(([value]) => value instanceof PutObjectCommand)).toHaveLength(
      1,
    );
    expect(f.send.mock.calls.some(([value]) => value instanceof GetObjectCommand)).toBe(true);
  });

  it('treats timeout plus HEAD 404 as unknown, never proof that a late PUT cannot commit', async () => {
    const f = await fixture(),
      realSend = f.send.getMockImplementation()!;
    f.send.mockImplementation((command, options) => {
      if (command instanceof PutObjectCommand)
        throw new Error('synthetic uncertain network outcome');
      return realSend(command, options);
    });
    await expect(f.store.putImmutable(f.input)).rejects.toMatchObject({ outcome: 'unknown' });
    expect(f.send.mock.calls.filter(([value]) => value instanceof PutObjectCommand)).toHaveLength(
      1,
    );
    expect(f.objects.size).toBe(0);
  });

  it.each([400, 401, 403, 413, 415, 422])(
    'records an explicit rejected PUT (%i) as not written, without a hidden retry',
    async (status) => {
      const f = await fixture();
      f.send.mockRejectedValue({ $metadata: { httpStatusCode: status } });
      await expect(f.store.putImmutable(f.input)).rejects.toMatchObject({ outcome: 'not_written' });
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );

  it('handles two conditional writers as one immutable object while refusing mismatched preexisting bytes', async () => {
    const f = await fixture();
    // The in-memory sender serializes PUT admission just as the real conditional
    // S3 probe does; this unit case challenges our 412 reconciliation branch.
    await f.store.putImmutable(f.input);
    await f.store.putImmutable(f.input);
    expect(f.objects.size).toBe(1);
    expect(await f.store.read(f.object)).toEqual(f.bytes);
    f.objects.get(f.key)!.bytes = Buffer.alloc(f.bytes.length, 1);
    await expect(f.store.putImmutable(f.input)).rejects.toMatchObject({ outcome: 'integrity' });
  });

  it('does not fetch or delete a foreign metadata object even when a caller knows its key', async () => {
    const f = await fixture();
    await f.store.putImmutable(f.input);
    f.objects.get(f.key)!.metadata['asa-ai-owner'] = randomUUID();
    f.send.mockClear();
    await expect(f.store.verify(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
    await expect(f.store.remove(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
    expect(f.send.mock.calls.every(([value]) => value instanceof HeadObjectCommand)).toBe(true);
    expect(f.objects.size).toBe(1);
  });

  it.each(['truncated', 'oversized', 'different'] as const)(
    'checks the actual GET body against metadata and SHA-256 (%s)',
    async (kind) => {
      const f = await fixture();
      await f.store.putImmutable(f.input);
      const realSend = f.send.getMockImplementation()!;
      f.send.mockImplementation(async (command, options) => {
        const value = await realSend(command, options);
        if (!(command instanceof GetObjectCommand)) return value;
        const bytes =
          kind === 'truncated'
            ? f.bytes.subarray(0, -1)
            : kind === 'oversized'
              ? Buffer.concat([f.bytes, Buffer.from([0])])
              : Buffer.alloc(f.bytes.length, 1);
        return { ...(value as object), Body: Readable.from([bytes]) };
      });
      await expect(f.store.read(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
    },
  );

  it('destroys a rejected GET stream without consuming private bytes', async () => {
    const f = await fixture(),
      body = Readable.from([f.bytes]);
    f.send.mockResolvedValue({ ContentLength: f.bytes.length, Metadata: {}, Body: body });
    await expect(f.store.read(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
    expect(body.destroyed).toBe(true);
  });

  it('verifies a highly fragmented GET without retaining fragments or changing the bytes', async () => {
    const f = await fixture();
    const bytes = Buffer.alloc(256 * 1024, 97);
    const object = {
      ...f.object,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const body = Readable.from(
      (async function* () {
        for (let index = 0; index < bytes.length; index += 1)
          yield bytes.subarray(index, index + 1);
      })(),
    );
    f.send.mockResolvedValue({
      ContentLength: object.sizeBytes,
      Metadata: {
        'asa-ai-owner': object.ownerId,
        'asa-ai-upload': object.uploadId,
        'asa-sha256': object.sha256,
      },
      Body: body,
    });
    expect(await f.store.read(object)).toEqual(bytes);
  });

  it('destroys the original native GET body promptly on excess bytes without waiting for EOF', async () => {
    const f = await fixture();
    const body = new Readable({ read() {} });
    f.send.mockResolvedValue({
      ContentLength: f.object.sizeBytes,
      Metadata: {
        'asa-ai-owner': f.object.ownerId,
        'asa-ai-upload': f.object.uploadId,
        'asa-sha256': f.object.sha256,
      },
      Body: body,
    });
    const pending = f.store.read(f.object);
    body.push(Buffer.concat([f.bytes, Buffer.from('!')]));
    await expect(pending).rejects.toMatchObject({ outcome: 'integrity' });
    expect(body.destroyed).toBe(true);
    expect(body.readableEnded).toBe(false);
  });

  it('deletes the observed immutable version and confirms absence before allowing the reservation to be released', async () => {
    const f = await fixture();
    await f.store.putImmutable(f.input);
    const version = f.objects.get(f.key)!.version;
    expect(await f.store.remove(f.object)).toBe(true);
    expect(f.objects.size).toBe(0);
    const deletion = f.send.mock.calls.find(
      ([value]) => value instanceof DeleteObjectCommand,
    )![0] as DeleteObjectCommand;
    expect(deletion.input).toMatchObject({ Key: f.key, VersionId: version });
    expect(await f.store.remove(f.object)).toBe(true);
    expect(
      f.send.mock.calls.filter(([value]) => value instanceof DeleteObjectCommand),
    ).toHaveLength(1);
  });

  it('recovers a lost DELETE response through a later absence check without recreating or rewriting the object', async () => {
    const f = await fixture();
    await f.store.putImmutable(f.input);
    const realSend = f.send.getMockImplementation()!;
    f.send.mockImplementation(async (command, options) => {
      const value = await realSend(command, options);
      if (command instanceof DeleteObjectCommand) throw new Error('synthetic DELETE reply lost');
      return value;
    });
    await expect(f.store.remove(f.object)).rejects.toThrow('synthetic DELETE reply lost');
    expect(await f.store.remove(f.object)).toBe(true);
    expect(f.send.mock.calls.filter(([value]) => value instanceof PutObjectCommand)).toHaveLength(
      1,
    );
  });
});
