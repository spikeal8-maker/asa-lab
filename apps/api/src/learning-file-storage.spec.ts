import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningFileStorage } from './learning-file-storage.js';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...original,
    S3Client: class {
      send = send;
      destroy = vi.fn();
    },
  };
});

const tenant = '0c0e8430-70bd-44af-899c-c967ca460e8a';
const attempt = 'aa819815-b53a-434b-9b81-9c10e88b0c46';
const bytes = Buffer.from('Immutable classroom evidence');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function storage() {
  vi.stubEnv('ASA_OBJECT_STORAGE_ENDPOINT', 'http://127.0.0.1:9000');
  vi.stubEnv('ASA_OBJECT_STORAGE_REGION', 'test');
  vi.stubEnv('ASA_OBJECT_STORAGE_BUCKET', 'private-test');
  vi.stubEnv('ASA_OBJECT_STORAGE_ACCESS_KEY', 'fixture');
  vi.stubEnv('ASA_OBJECT_STORAGE_SECRET_KEY', 'fixture');
  vi.stubEnv('ASA_OBJECT_STORAGE_FORCE_PATH_STYLE', 'true');
  return new LearningFileStorage();
}

afterEach(() => {
  send.mockReset();
  vi.unstubAllEnvs();
});

describe('immutable learner object storage', () => {
  it('writes exact bytes to a tenant/attempt-scoped key with a conditional checksum write', async () => {
    send.mockResolvedValueOnce({});
    await storage().put(tenant, attempt, sha256, bytes);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: 'private-test',
          Key: ['learning', 'answers', 'v1', 'tenants', tenant, 'attempts', attempt, sha256].join(
            '/',
          ),
          Body: bytes,
          ContentType: 'application/octet-stream',
          ContentLength: bytes.length,
          ContentMD5: createHash('md5').update(bytes).digest('base64'),
          IfNoneMatch: '*',
        },
      }),
      { abortSignal: expect.any(AbortSignal) },
    );
  });

  it('recognizes an exact ambiguous write retry and refuses corruption or a mismatched length', async () => {
    const store = storage();
    send.mockRejectedValueOnce(new Error('ambiguous')).mockResolvedValueOnce({
      Body: Readable.from([bytes]),
      ContentLength: bytes.length,
    });
    await expect(store.put(tenant, attempt, sha256, bytes)).resolves.toBeUndefined();
    send.mockRejectedValueOnce(new Error('already exists')).mockResolvedValueOnce({
      Body: Readable.from([Buffer.alloc(bytes.length)]),
      ContentLength: bytes.length,
    });
    await expect(store.put(tenant, attempt, sha256, bytes)).rejects.toThrow('checksum');
    send.mockResolvedValueOnce({ Body: Readable.from([bytes]), ContentLength: bytes.length + 1 });
    await expect(store.read(tenant, attempt, { sha256, sizeBytes: bytes.length })).rejects.toThrow(
      'size',
    );
  });
});
