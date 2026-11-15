import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { BlocksObjectStorageConfig } from '../blocks-asset-storage.js';
import { AI_ATTACHMENT_LIMITS, attachmentId } from './contracts.js';

export interface AiAttachmentObject {
  /** Server-generated outputs use their own namespace; never an upload receipt. */
  purpose?: 'generated';
  ownerId: string;
  uploadId: string;
  sha256: string;
  sizeBytes: number;
}
export interface AiAttachmentBlobStore {
  putImmutable(
    input: AiAttachmentObject & { sourcePath: string; md5Base64: string },
  ): Promise<void>;
  verify(input: AiAttachmentObject): Promise<boolean>;
  read(input: AiAttachmentObject): Promise<Buffer | null>;
  remove(input: AiAttachmentObject): Promise<boolean>;
  close?(): void;
}
export class AiAttachmentStorageError extends Error {
  constructor(readonly outcome: 'not_written' | 'unknown' | 'integrity') {
    super(`ai_attachment_storage_${outcome}`);
  }
}

type ObjectCommand = HeadObjectCommand | GetObjectCommand | PutObjectCommand | DeleteObjectCommand;
export interface AiS3Sender {
  send(command: ObjectCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
  destroy?(): void;
}

export function aiAttachmentObjectKey(input: AiAttachmentObject): string {
  const owner = attachmentId(input.ownerId);
  const upload = attachmentId(input.uploadId);
  if (
    !/^[0-9a-f]{64}$/.test(input.sha256) ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes < 1 ||
    input.sizeBytes > 8 * 1024 * 1024
  )
    throw new AiAttachmentStorageError('integrity');
  return `ai/private/v1/owners/${owner}/${input.purpose === 'generated' ? 'generated' : 'uploads'}/${upload}/${input.sha256}`;
}

function status(problem: unknown): number | undefined {
  if (!problem || typeof problem !== 'object') return undefined;
  return (problem as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}
function missing(problem: unknown): boolean {
  if (status(problem) === 404) return true;
  return (
    !!problem &&
    typeof problem === 'object' &&
    ['NotFound', 'NoSuchKey', 'NoSuchVersion'].includes(
      String((problem as { name?: unknown }).name),
    )
  );
}
interface StoredMetadata {
  ContentLength?: number;
  Metadata?: Record<string, string>;
  VersionId?: string;
  Body?: unknown;
}
function assertMetadata(value: StoredMetadata, input: AiAttachmentObject): void {
  if (
    value.ContentLength !== input.sizeBytes ||
    value.Metadata?.['asa-ai-owner'] !== input.ownerId.toLowerCase() ||
    value.Metadata?.['asa-ai-upload'] !== input.uploadId.toLowerCase() ||
    value.Metadata?.['asa-sha256'] !== input.sha256
  )
    throw new AiAttachmentStorageError('integrity');
}

/** One conditional write attempt per durable receipt. The SDK must not retry
 * an uncertain PUT: a late retry could recreate an already deleted object. */
export class S3AiAttachmentBlobStore implements AiAttachmentBlobStore {
  private readonly client: AiS3Sender;
  constructor(
    private readonly config: BlocksObjectStorageConfig,
    client?: AiS3Sender,
  ) {
    this.client =
      client ??
      (new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        maxAttempts: 1,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      }) as AiS3Sender);
  }
  close(): void {
    this.client.destroy?.();
  }
  private async head(
    input: AiAttachmentObject,
    signal: AbortSignal,
  ): Promise<StoredMetadata | null> {
    try {
      const value = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: aiAttachmentObjectKey(input) }),
        { abortSignal: signal },
      )) as StoredMetadata;
      assertMetadata(value, input);
      return value;
    } catch (problem) {
      if (missing(problem)) return null;
      throw problem;
    }
  }
  private async bytes(
    input: AiAttachmentObject,
    signal: AbortSignal,
    versionId?: string,
  ): Promise<Buffer | null> {
    let result: StoredMetadata;
    try {
      result = (await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: aiAttachmentObjectKey(input),
          ...(versionId === undefined ? {} : { VersionId: versionId }),
        }),
        { abortSignal: signal },
      )) as StoredMetadata;
    } catch (problem) {
      if (missing(problem)) return null;
      throw problem;
    }
    const body = result.Body;
    try {
      assertMetadata(result, input);
    } catch (problem) {
      if (body instanceof Readable) body.destroy();
      throw problem;
    }
    if (!body || typeof body !== 'object' || !(Symbol.asyncIterator in body))
      throw new AiAttachmentStorageError('integrity');
    let size = 0;
    const hash = createHash('sha256');
    // The descriptor and metadata were checked before this one bounded
    // allocation. Fragment count must not increase retained memory.
    const bytes = Buffer.allocUnsafe(input.sizeBytes);
    await pipeline(
      body instanceof Readable ? body : Readable.from(body as AsyncIterable<Uint8Array>),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          if (chunk.byteLength > bytes.byteLength - size)
            return callback(new AiAttachmentStorageError('integrity'));
          bytes.set(chunk, size);
          size += chunk.byteLength;
          hash.update(chunk);
          callback();
        },
      }),
      { signal },
    );
    if (size !== input.sizeBytes || hash.digest('hex') !== input.sha256)
      throw new AiAttachmentStorageError('integrity');
    return bytes;
  }
  async read(input: AiAttachmentObject): Promise<Buffer | null> {
    return this.bytes(input, AbortSignal.timeout(AI_ATTACHMENT_LIMITS.storageMilliseconds));
  }
  async verify(input: AiAttachmentObject): Promise<boolean> {
    const signal = AbortSignal.timeout(AI_ATTACHMENT_LIMITS.storageMilliseconds);
    const head = await this.head(input, signal);
    if (!head) return false;
    if (!(await this.bytes(input, signal, head.VersionId)))
      throw new AiAttachmentStorageError('unknown');
    return true;
  }
  async putImmutable(
    input: AiAttachmentObject & { sourcePath: string; md5Base64: string },
  ): Promise<void> {
    const key = aiAttachmentObjectKey(input);
    if (statSync(input.sourcePath).size !== input.sizeBytes)
      throw new AiAttachmentStorageError('not_written');
    const body = createReadStream(input.sourcePath);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentLength: input.sizeBytes,
          ContentMD5: input.md5Base64,
          IfNoneMatch: '*',
          ContentType: 'application/octet-stream',
          CacheControl: 'private, no-store',
          Metadata: {
            'asa-ai-owner': input.ownerId.toLowerCase(),
            'asa-ai-upload': input.uploadId.toLowerCase(),
            'asa-sha256': input.sha256,
          },
        }),
        { abortSignal: AbortSignal.timeout(AI_ATTACHMENT_LIMITS.storageMilliseconds) },
      );
    } catch (problem) {
      // These explicit rejections prove that this single PUT did not create an
      // object. A timeout, lost response, 409/412 or transport error does not.
      if ([400, 401, 403, 413, 415, 422].includes(status(problem) ?? 0))
        throw new AiAttachmentStorageError('not_written');
      try {
        if (await this.verify(input)) return;
      } catch (verification) {
        if (
          verification instanceof AiAttachmentStorageError &&
          verification.outcome === 'integrity'
        )
          throw verification;
      }
      throw new AiAttachmentStorageError('unknown');
    } finally {
      body.destroy();
    }
    try {
      if (!(await this.verify(input))) throw new AiAttachmentStorageError('unknown');
    } catch (problem) {
      if (problem instanceof AiAttachmentStorageError) throw problem;
      throw new AiAttachmentStorageError('unknown');
    }
  }
  async remove(input: AiAttachmentObject): Promise<boolean> {
    const signal = AbortSignal.timeout(AI_ATTACHMENT_LIMITS.storageMilliseconds);
    const head = await this.head(input, signal);
    if (!head) return true;
    // Deleting the observed immutable version also removes its actual bytes in
    // versioned buckets; a bare DELETE there would only add a delete marker.
    if (!(await this.bytes(input, signal, head.VersionId))) return false;
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: aiAttachmentObjectKey(input),
        ...(head.VersionId === undefined ? {} : { VersionId: head.VersionId }),
      }),
      { abortSignal: signal },
    );
    return (await this.head(input, signal)) === null;
  }
}
