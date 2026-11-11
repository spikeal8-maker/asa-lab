import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readBlocksObjectStorageConfig } from './blocks-asset-storage.js';
import { LEARNING_FILE_MAX_BYTES, readExactLearningFile } from './learning-file-transport.js';

export interface LearningFileDescriptor {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  sha256: string;
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class LearningFileStorage {
  private client?: S3Client;
  private bucket?: string;

  close(): void {
    this.client?.destroy();
  }

  private target(tenantId: string, attemptId: string, sha256: string) {
    const id = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
    if (!id.test(tenantId) || !id.test(attemptId) || !/^[a-f0-9]{64}$/u.test(sha256))
      throw new Error('invalid learning object scope');
    if (!this.client || !this.bucket) {
      const { endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle } =
        readBlocksObjectStorageConfig();
      this.client = new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle,
        maxAttempts: 1,
      });
      this.bucket = bucket;
    }
    const key = [
      'learning',
      'answers',
      'v1',
      'tenants',
      tenantId,
      'attempts',
      attemptId,
      sha256,
    ].join('/');
    return { client: this.client, input: { Bucket: this.bucket, Key: key } };
  }

  async read(
    tenantId: string,
    attemptId: string,
    file: Pick<LearningFileDescriptor, 'sizeBytes' | 'sha256'>,
  ): Promise<Buffer> {
    const { sizeBytes, sha256 } = file;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > LEARNING_FILE_MAX_BYTES)
      throw new Error('invalid learning object size');
    const { client, input } = this.target(tenantId, attemptId, sha256);
    const signal = AbortSignal.timeout(15_000);
    const object = await client.send(new GetObjectCommand(input), { abortSignal: signal });
    if (!(object.Body instanceof Readable)) throw new Error('invalid learning object body');
    if (object.ContentLength !== sizeBytes) {
      object.Body.destroy();
      throw new Error('invalid learning object size');
    }
    const bytes = await readExactLearningFile(object.Body, sizeBytes, signal);
    if (digest(bytes) !== sha256) throw new Error('invalid learning object checksum');
    return bytes;
  }

  async put(tenantId: string, attemptId: string, sha256: string, bytes: Buffer): Promise<void> {
    const { client, input } = this.target(tenantId, attemptId, sha256);
    try {
      await client.send(
        new PutObjectCommand({
          ...input,
          Body: bytes,
          ContentType: 'application/octet-stream',
          ContentLength: bytes.length,
          ContentMD5: createHash('md5').update(bytes).digest('base64'),
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(15_000) },
      );
    } catch {
      // A conditional collision or an ambiguous response can be an exact retry.
      // Only the expected verified bytes may satisfy the immutable reference.
      await this.read(tenantId, attemptId, { sha256, sizeBytes: bytes.length });
    }
  }
}
