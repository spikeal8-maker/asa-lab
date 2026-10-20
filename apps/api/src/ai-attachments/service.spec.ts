import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiAttachmentStorageError, type AiAttachmentBlobStore } from './blob-store';
import { AiAttachmentError, attachmentReceipt, type AiAttachmentRecord } from './contracts';
import { AiAttachmentService } from './service';
import { PgAiAttachmentStore, type AiAttachmentStore } from './store';
import { describeAiAttachmentFile } from './validation';
import { aiAttachmentImageFixture } from './validation.fixture';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
function record(
  bytes: Buffer,
  fileName = 'private.txt',
  ownerId: string = randomUUID(),
): AiAttachmentRecord {
  const file = describeAiAttachmentFile(fileName);
  return {
    uploadId: randomUUID(),
    ownerId,
    fileName,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    extension: file.extension,
    mediaType: file.mediaType,
    kind: file.kind,
    state: 'reserved',
    held: true,
    width: null,
    height: null,
    text: null,
    attemptId: null,
    leaseId: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    deleteRequested: false,
    errorCode: null,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(bytes: Buffer = Buffer.from('Личный текст'), fileName = 'private.txt') {
  const directory = await mkdtemp(join(tmpdir(), 'ai-attachment-service-unit-'));
  directories.push(directory);
  const initial = record(bytes, fileName),
    rows = new Map([[initial.uploadId, initial]]);
  const lookup = (owner: string, id: string) => {
    const row = rows.get(id);
    if (!row || row.ownerId !== owner)
      throw new AiAttachmentError('ai_attachment_not_found', 404, 'Вложение не найдено.');
    return row;
  };
  const store = {
    reserve: vi.fn<AiAttachmentStore['reserve']>(async (owner, descriptor, file) => {
      const row = rows.get(descriptor.uploadId) ?? {
        ...record(bytes, descriptor.fileName, owner),
        ...descriptor,
        ...file,
      };
      rows.set(row.uploadId, row);
      return { ...row };
    }),
    get: vi.fn<AiAttachmentStore['get']>(async (owner, id) => ({ ...lookup(owner, id) })),
    begin: vi.fn<AiAttachmentStore['begin']>(async (owner, id, attempt, validated) => {
      const row = lookup(owner, id);
      if (row.state === 'reserved')
        Object.assign(row, validated, { state: 'uploading', attemptId: attempt });
      return { ...row };
    }),
    finish: vi.fn<AiAttachmentStore['finish']>(async (owner, id, _attempt, outcome) => {
      const row = lookup(owner, id);
      Object.assign(row, {
        state: outcome === 'persisted' ? 'ready' : outcome === 'not_written' ? 'failed' : 'unknown',
        held: outcome !== 'not_written',
      });
      return { ...row };
    }),
    reject: vi.fn<AiAttachmentStore['reject']>(async (owner, id) => {
      const row = lookup(owner, id);
      if (row.state === 'reserved')
        Object.assign(row, { state: 'failed', held: false, fileName: null });
      return { ...row };
    }),
    remove: vi.fn<AiAttachmentStore['remove']>(async (owner, id) => {
      const row = lookup(owner, id);
      Object.assign(row, {
        deleteRequested: true,
        state: row.state === 'ready' ? 'deleting' : row.state,
      });
      return { ...row };
    }),
    claim: vi.fn<AiAttachmentStore['claim']>(async (owner, id) => {
      const row = lookup(owner, id);
      if (!['unknown', 'deleting'].includes(row.state)) return null;
      row.leaseId = randomUUID();
      return { ...row };
    }),
    claimBatch: vi.fn<AiAttachmentStore['claimBatch']>(async () => []),
    finishClaim: vi.fn<AiAttachmentStore['finishClaim']>(async (owner, id, _lease, outcome) => {
      const row = lookup(owner, id);
      if (outcome === 'deleted')
        Object.assign(row, { state: 'deleted', held: false, text: null, fileName: null });
      else if (outcome === 'persisted') row.state = row.deleteRequested ? 'deleting' : 'ready';
      row.leaseId = null;
      return { ...row };
    }),
  };
  const blobs = {
    putImmutable: vi.fn<AiAttachmentBlobStore['putImmutable']>(async () => undefined),
    verify: vi.fn<AiAttachmentBlobStore['verify']>(async () => false),
    read: vi.fn<AiAttachmentBlobStore['read']>(async () => bytes),
    remove: vi.fn<AiAttachmentBlobStore['remove']>(async () => true),
    close: vi.fn(),
  };
  const service = new AiAttachmentService(null, {
    store,
    blobs,
    tempRoot: directory,
    maintenance: false,
  });
  const source = async function* () {
    yield bytes.subarray(0, 2);
    yield bytes.subarray(2);
  };
  return {
    bytes,
    row: initial,
    rows,
    store,
    blobs,
    service,
    directory,
    source,
    upload: () => service.upload(initial.ownerId, initial.uploadId, source()),
  };
}

describe('bounded AI upload capture and durable storage service', () => {
  it('captures privately, validates actual bytes before PUT, and removes temporary bytes after successful readiness', async () => {
    const f = await fixture(aiAttachmentImageFixture('png'), 'Картинка.png');
    f.blobs.putImmutable.mockImplementation(async (input) => {
      expect(await readFile(input.sourcePath)).toEqual(f.bytes);
      expect((await stat(input.sourcePath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(f.directory, 'asa-ai-private-uploads'))).mode & 0o777).toBe(0o700);
      expect(input.sourcePath).not.toContain('Картинка');
      expect(input.md5Base64).toBe(createHash('md5').update(f.bytes).digest('base64'));
      expect(f.row).toMatchObject({ state: 'uploading', width: 3, height: 2, held: true });
    });
    expect(await f.upload()).toMatchObject({
      state: 'ready',
      width: 3,
      height: 2,
      sha256: f.row.sha256,
    });
    expect(await readdir(join(f.directory, 'asa-ai-private-uploads'))).toEqual([]);
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
  });

  it.each(['truncated', 'oversized', 'different', 'invalid_format'] as const)(
    'rejects the actual %s payload before storage and cleans the owned capture file',
    async (kind) => {
      const f = await fixture(aiAttachmentImageFixture('png'), 'image.png');
      const bytes =
        kind === 'truncated'
          ? f.bytes.subarray(0, -1)
          : kind === 'oversized'
            ? Buffer.concat([f.bytes, Buffer.from([0])])
            : Buffer.alloc(f.bytes.length, 1);
      if (kind === 'invalid_format')
        f.row.sha256 = createHash('sha256').update(bytes).digest('hex');
      await expect(
        f.service.upload(
          f.row.ownerId,
          f.row.uploadId,
          (async function* () {
            yield bytes;
          })(),
        ),
      ).rejects.toMatchObject({ status: kind === 'oversized' ? 413 : 400 });
      expect(f.blobs.putImmutable).not.toHaveBeenCalled();
      expect(f.store.begin).not.toHaveBeenCalled();
      expect(f.row.held).toBe(false);
      expect(await readdir(join(f.directory, 'asa-ai-private-uploads'))).toEqual([]);
    },
  );

  it('strictly decodes bounded source text while keeping public receipts free of text, owner, storage paths, attempts or lease tokens', async () => {
    const f = await fixture(
      Buffer.from('\ufeff# Мой вопрос\r\n<script>alert(1)</script>'),
      'source.md',
    );
    const receipt = await f.upload();
    expect(f.row.text).toBe(f.bytes.toString('utf8'));
    for (const field of [
      'ownerId',
      'text',
      'extension',
      'attemptId',
      'leaseId',
      'held',
      'sourcePath',
      'key',
    ])
      expect(receipt).not.toHaveProperty(field);
    expect(JSON.stringify(receipt)).not.toContain('<script>');
    expect(await f.service.get(f.row.ownerId, f.row.uploadId)).toEqual(attachmentReceipt(f.row));
    expect(f.blobs.verify).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'integrity'] as const)(
    'persists the %s write receipt and keeps quota; a matching PUT replay never performs a second S3 write',
    async (outcome) => {
      const f = await fixture();
      f.blobs.putImmutable.mockRejectedValue(new AiAttachmentStorageError(outcome));
      expect(await f.upload()).toMatchObject({ state: 'unknown' });
      expect(f.row.held).toBe(true);
      expect(await f.upload()).toMatchObject({ state: 'unknown' });
      expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
      expect(f.store.begin).toHaveBeenCalledTimes(1);
      expect(await f.service.reconcile(f.row.ownerId, f.row.uploadId)).toMatchObject({
        state: 'unknown',
      });
      expect(f.row.held).toBe(true);
      expect(f.store.finishClaim).toHaveBeenLastCalledWith(
        f.row.ownerId,
        f.row.uploadId,
        expect.any(String),
        'unknown',
      );
    },
  );

  it('does not accept changed replay bytes or re-write an already ready object', async () => {
    const f = await fixture();
    await f.upload();
    await expect(
      f.service.upload(
        f.row.ownerId,
        f.row.uploadId,
        (async function* () {
          yield Buffer.alloc(f.bytes.length, 1);
        })(),
      ),
    ).rejects.toMatchObject({ code: 'ai_attachment_identity_mismatch' });
    expect(f.row.state).toBe('ready');
    expect(f.row.held).toBe(true);
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
    expect(await f.upload()).toMatchObject({ state: 'ready' });
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
  });

  it('retains an uploading receipt if S3 succeeds but final SQL acknowledgement fails', async () => {
    const f = await fixture();
    f.store.finish.mockRejectedValue(
      new AiAttachmentError('ai_attachment_unavailable', 503, 'Unavailable'),
    );
    await expect(f.upload()).rejects.toMatchObject({ code: 'ai_attachment_unavailable' });
    expect(f.row).toMatchObject({ state: 'uploading', held: true });
    expect(await f.upload()).toMatchObject({ state: 'uploading' });
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
    expect(await readdir(join(f.directory, 'asa-ai-private-uploads'))).toEqual([]);
  });

  it('leaves a concurrent deletion intact when the capture loses atomic begin admission', async () => {
    const f = await fixture();
    f.store.begin.mockImplementation(async () => {
      Object.assign(f.row, { state: 'deleted', held: false, fileName: null });
      return { ...f.row };
    });
    expect(await f.upload()).toMatchObject({ state: 'deleted' });
    expect(f.blobs.putImmutable).not.toHaveBeenCalled();
    expect(await readdir(join(f.directory, 'asa-ai-private-uploads'))).toEqual([]);
  });

  it('bounds concurrent streams per owner and globally while releasing capacity after completion', async () => {
    const f = await fixture(),
      gate = deferred();
    const blockedSource = async function* () {
      await gate.promise;
      yield f.bytes;
    };
    const sameOwner = record(f.bytes, 'second.txt', f.row.ownerId);
    f.rows.set(sameOwner.uploadId, sameOwner);
    const pending = [
      f.service.upload(f.row.ownerId, f.row.uploadId, blockedSource()),
      f.service.upload(sameOwner.ownerId, sameOwner.uploadId, blockedSource()),
    ];
    await expect(
      f.service.upload(f.row.ownerId, f.row.uploadId, blockedSource()),
    ).rejects.toMatchObject({ code: 'ai_attachment_busy', status: 429 });
    for (let index = 0; index < 6; index += 1) {
      const row = record(f.bytes);
      f.rows.set(row.uploadId, row);
      pending.push(f.service.upload(row.ownerId, row.uploadId, blockedSource()));
    }
    const ninth = record(f.bytes);
    f.rows.set(ninth.uploadId, ninth);
    await expect(
      f.service.upload(ninth.ownerId, ninth.uploadId, blockedSource()),
    ).rejects.toMatchObject({ code: 'ai_attachment_busy' });
    gate.resolve();
    await Promise.all(pending);
    expect(await f.service.upload(ninth.ownerId, ninth.uploadId, f.source())).toMatchObject({
      state: 'ready',
    });
  });

  it('honors cancellation and clears the partial capture without an S3 write', async () => {
    const f = await fixture(),
      controller = new AbortController();
    controller.abort();
    await expect(
      f.service.upload(f.row.ownerId, f.row.uploadId, f.source(), controller.signal),
    ).rejects.toMatchObject({ code: 'ai_attachment_upload_interrupted', status: 408 });
    expect(f.blobs.putImmutable).not.toHaveBeenCalled();
    expect(await readdir(join(f.directory, 'asa-ai-private-uploads'))).toEqual([]);
  });

  it('retains the transfer budget until a download consumer completes or disconnects', async () => {
    const f = await fixture();
    await f.upload();
    const slowClient = deferred();
    const consume = vi.fn(async (file: { bytes: Buffer }) => {
      expect(file.bytes).toEqual(f.bytes);
      await slowClient.promise;
    });
    const first = f.service.withRead(f.row.ownerId, f.row.uploadId, consume);
    const second = f.service.withRead(f.row.ownerId, f.row.uploadId, consume);
    await expect(f.service.read(f.row.ownerId, f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_busy',
      status: 429,
    });
    slowClient.resolve();
    await Promise.all([first, second]);
    expect(consume).toHaveBeenCalledTimes(2);
    await expect(
      f.service.withRead(f.row.ownerId, f.row.uploadId, async () => {
        throw new Error('client disconnected');
      }),
    ).rejects.toThrow('client disconnected');
    expect((await f.service.read(f.row.ownerId, f.row.uploadId)).bytes).toEqual(f.bytes);
  });

  it('does not disclose bytes after a concurrent deletion or after an unbound file expires during its read', async () => {
    const f = await fixture();
    await f.upload();
    f.blobs.read.mockImplementation(async () => {
      f.row.state = 'deleting';
      f.row.deleteRequested = true;
      return f.bytes;
    });
    await expect(f.service.read(f.row.ownerId, f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_not_ready',
    });
    Object.assign(f.row, { state: 'ready', deleteRequested: false });
    f.blobs.read.mockImplementation(async () => {
      f.row.expiresAt = new Date(0).toISOString();
      return f.bytes;
    });
    await expect(f.service.read(f.row.ownerId, f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_expired',
    });
  });

  it('authenticates the exact owner before accessing S3 and withholds bytes on any storage integrity error', async () => {
    const f = await fixture();
    await f.upload();
    await expect(f.service.read(randomUUID(), f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_not_found',
    });
    expect(f.blobs.read).not.toHaveBeenCalled();
    f.blobs.read.mockRejectedValue(new AiAttachmentStorageError('integrity'));
    await expect(f.service.read(f.row.ownerId, f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_unavailable',
      status: 503,
    });
  });

  it('keeps deletion recoverable until S3 confirms removal and never retries PUT during reconciliation', async () => {
    const f = await fixture();
    await f.upload();
    f.blobs.remove.mockRejectedValueOnce(new Error('synthetic unavailable S3'));
    expect(await f.service.remove(f.row.ownerId, f.row.uploadId)).toMatchObject({
      state: 'deleting',
      deleteRequested: true,
    });
    expect(f.row.held).toBe(true);
    expect(await f.service.reconcile(f.row.ownerId, f.row.uploadId)).toMatchObject({
      state: 'deleted',
      fileName: null,
    });
    expect(f.row.held).toBe(false);
    expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
  });

  it('runs one bounded leased maintenance batch, at most two operations concurrently, and stops starting work on shutdown', async () => {
    const f = await fixture(),
      gate = deferred();
    const claims: AiAttachmentRecord[] = [];
    for (let index = 0; index < 8; index += 1) {
      const row = record(f.bytes);
      Object.assign(row, { state: 'unknown', leaseId: randomUUID() });
      f.rows.set(row.uploadId, row);
      claims.push({ ...row });
    }
    f.store.claimBatch.mockResolvedValue(claims);
    f.blobs.verify.mockImplementation(async () => {
      await gate.promise;
      return false;
    });
    f.blobs.close.mockImplementation(() => gate.resolve());
    const sweep = f.service.sweep();
    expect(f.service.sweep()).toBe(sweep);
    await vi.waitFor(() => expect(f.blobs.verify).toHaveBeenCalledTimes(2));
    await f.service.onModuleDestroy();
    await sweep;
    expect(f.store.claimBatch).toHaveBeenCalledExactlyOnceWith(8);
    expect(f.blobs.verify).toHaveBeenCalledTimes(2);
    expect(claims.every((claim) => f.rows.get(claim.uploadId)!.held)).toBe(true);
    await expect(f.service.read(f.row.ownerId, f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_busy',
    });
  });

  it('redacts unknown PostgreSQL details that could include the private failing row', async () => {
    const pool = {
      query: vi
        .fn()
        .mockRejectedValue(
          new Error('constraint failed row: private-secret.ts and PRIVATE SOURCE TEXT'),
        ),
    } as unknown as pg.Pool;
    const store = new PgAiAttachmentStore(pool);
    const problem = await store.get(randomUUID(), randomUUID()).catch((error) => error);
    expect(problem).toMatchObject({ code: 'ai_attachment_unavailable', status: 503 });
    expect(String(problem)).not.toContain('PRIVATE');
    expect(String(problem)).not.toContain('private-secret');
    expect(problem).not.toHaveProperty('cause');
  });
});
