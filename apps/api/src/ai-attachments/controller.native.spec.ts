import 'reflect-metadata';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, readdir, readFile, rmdir, stat } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { promisify } from 'node:util';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountVerificationService } from '../account-verification.service';
import { AiAccessService } from '../ai-access.service';
import { createApiApp } from '../app.factory';
import { TOKENS } from '../tokens';
import type { AiAttachmentBlobStore } from './blob-store';
import { AI_ATTACHMENT_LIMITS, AiAttachmentError, type AiAttachmentRecord } from './contracts';
import { AiAttachmentService } from './service';
import type { AiAttachmentStore } from './store';
import { AI_ATTACHMENT_CONTENT_TYPE } from './transport';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOST = '127.0.0.1:4612';
const bytes = Buffer.from('Private review upload: complete bytes.');
const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];
const directories: string[] = [];
const peers: NativePeer[] = [];
const run = promisify(execFile);

/** In-process native transport: callbacks, not attempted writes, are the
 * acknowledged peer bytes. No ports, HTTP listeners or external services. */
class NativePeer extends Duplex {
  readonly remoteAddress = '127.0.0.1';
  readonly acknowledged: Buffer[] = [];
  private pending: Array<{ chunk: Buffer; callback: (error?: Error | null) => void }> = [];
  hold = false;
  override _read() {}
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    const item = { chunk: Buffer.from(chunk), callback };
    if (this.hold) this.pending.push(item);
    else {
      this.acknowledged.push(item.chunk);
      callback();
    }
  }
  override _destroy(error: Error | null, callback: (error: Error | null) => void) {
    for (const item of this.pending.splice(0)) item.callback(error ?? new Error('peer closed'));
    callback(error);
  }
  release() {
    this.hold = false;
    for (const item of this.pending.splice(0)) {
      if (!this.destroyed) this.acknowledged.push(item.chunk);
      item.callback(this.destroyed ? new Error('peer closed') : undefined);
    }
  }
  setTimeout() {
    return this;
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  get output() {
    return Buffer.concat(this.acknowledged);
  }
}

afterEach(async () => {
  for (const peer of peers.splice(0)) peer.destroy();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  // Intentionally never rm(recursive): teardown must not hide a leaked or
  // asynchronously recreated capture. These directories must be empty first.
  for (const directory of directories.splice(0)) {
    await rmdir(join(directory, 'asa-ai-private-uploads')).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(directory);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function record(): AiAttachmentRecord {
  return {
    uploadId: randomUUID(),
    ownerId: OWNER,
    fileName: 'private.txt',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    extension: 'txt',
    mediaType: 'text/plain',
    kind: 'text',
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

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'asa-ai-native-'));
  directories.push(directory);
  const row = record(),
    rows = new Map([[row.uploadId, row]]);
  const lookup = (owner: string, id: string) => {
    const value = rows.get(id);
    if (!value || owner !== value.ownerId)
      throw new AiAttachmentError('ai_attachment_not_found', 404, 'Not found');
    return value;
  };
  const get = vi.fn(async (owner: string, id: string) => ({ ...lookup(owner, id) }));
  const begin = vi.fn<AiAttachmentStore['begin']>(async (owner, id, attempt, validated) => {
    const value = lookup(owner, id);
    Object.assign(value, validated, { state: 'uploading', attemptId: attempt });
    return { ...value };
  });
  const reject = vi.fn<AiAttachmentStore['reject']>(async (owner, id) => {
    const value = lookup(owner, id);
    Object.assign(value, { state: 'failed', held: false, fileName: null });
    return { ...value };
  });
  const finish = vi.fn<AiAttachmentStore['finish']>(async (owner, id) => {
    const value = lookup(owner, id);
    value.state = 'ready';
    return { ...value };
  });
  const blobs = {
    putImmutable: vi.fn<AiAttachmentBlobStore['putImmutable']>(async () => undefined),
    read: vi.fn<AiAttachmentBlobStore['read']>(async () => bytes),
    verify: vi.fn(async () => true),
    remove: vi.fn(async () => true),
  };
  const service = new AiAttachmentService(null, {
    store: { get, begin, reject, finish } as unknown as AiAttachmentStore,
    blobs,
    tempRoot: directory,
    maintenance: false,
  });
  const app = await createApiApp({
    pool: null,
    analyticsPool: null,
    webDist: null,
    allowedWebOrigin: `http://${HOST}`,
  });
  apps.push(app);
  vi.spyOn(app.get<ActiveContextUseCase>(TOKENS.activeContextUseCase), 'resolve').mockResolvedValue(
    { principalId: ACCOUNT, accountId: ACCOUNT } as never,
  );
  vi.spyOn(
    app.get<AccountVerificationService>(TOKENS.accountVerification),
    'isEnabled',
  ).mockResolvedValue(false);
  vi.spyOn(app.get<AiAccessService>(TOKENS.aiAccessService), 'owner').mockResolvedValue(OWNER);
  const installed = app.get<AiAttachmentService>(TOKENS.aiAttachmentService);
  const upload = vi.spyOn(installed, 'upload').mockImplementation((...args) => {
    expect(args[2]).toBeInstanceOf(IncomingMessage);
    return service.upload(...args);
  });
  const withRead = vi
    .spyOn(installed, 'withRead')
    .mockImplementation((...args) => service.withRead(...args));
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.ready();
  function request(method = 'PUT', target = row, hold = false) {
    const peer = new NativePeer();
    peers.push(peer);
    peer.on('error', () => undefined);
    peer.hold = hold;
    const input = new IncomingMessage(peer as unknown as Socket);
    input.method = method;
    input.url = `/api/ai/attachments/${target.uploadId}/bytes`;
    input.httpVersion = '1.1';
    input.httpVersionMajor = 1;
    input.httpVersionMinor = 1;
    input.headers = {
      host: HOST,
      origin: `http://${HOST}`,
      cookie: 'asa_session=account',
      ...(method === 'PUT'
        ? { 'content-type': AI_ATTACHMENT_CONTENT_TYPE, 'transfer-encoding': 'chunked' }
        : {}),
    };
    const output = new ServerResponse(input);
    output.assignSocket(peer as unknown as Socket);
    fastify.routing(input, output);
    if (method !== 'PUT') {
      input.complete = true;
      input.push(null);
    }
    return { input, output, peer };
  }
  function nextRow(state: AiAttachmentRecord['state'] = 'reserved') {
    const value = record();
    value.state = state;
    rows.set(value.uploadId, value);
    return value;
  }
  return {
    directory,
    row,
    rows,
    get,
    begin,
    reject,
    blobs,
    service,
    upload,
    withRead,
    request,
    nextRow,
  };
}

async function partialFile(directory: string) {
  let path = '';
  await vi.waitFor(
    async () => {
      const names = await readdir(join(directory, 'asa-ai-private-uploads'));
      expect(names).toHaveLength(1);
      path = join(directory, 'asa-ai-private-uploads', names[0]!);
      expect((await stat(path)).size).toBe(9);
    },
    { timeout: 1000, interval: 5 },
  );
  const info = await stat(path);
  return {
    path,
    inode: info.ino,
    size: info.size,
    mode: info.mode & 0o777,
    sha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  };
}

function response(peer: NativePeer) {
  const raw = peer.output.toString('utf8');
  const split = raw.indexOf('\r\n\r\n');
  expect(split).toBeGreaterThan(0);
  const headers = raw.slice(0, split);
  const body = raw.slice(split + 4);
  const length = /\r\ncontent-length: (\d+)/i.exec(headers);
  expect(Buffer.byteLength(body)).toBe(Number(length?.[1]));
  return { headers, body, json: () => JSON.parse(body) };
}

async function absentInOtherProcess(path: string) {
  await run(process.execPath, [
    '-e',
    "require('node:fs').stat(process.argv[1],e=>process.exit(e?.code==='ENOENT'?0:1))",
    path,
  ]);
}

async function nativeCondition(condition: () => boolean) {
  const limit = performance.now() + 1200;
  while (!condition() && performance.now() < limit)
    await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

describe('native private attachment upload and response lifetime', () => {
  it('returns an acknowledged typed 413 without EOF and removes the exact partial file before any storage', async () => {
    const f = await fixture(),
      req = f.request();
    req.input.push(bytes.subarray(0, 9));
    const partial = await partialFile(f.directory);
    expect(partial.mode).toBe(0o600);
    const start = performance.now();
    req.input.push(Buffer.concat([bytes.subarray(9), Buffer.from('!')]));
    await vi.waitFor(() => expect(req.output.writableFinished).toBe(true), {
      timeout: 1200,
      interval: 5,
    });
    expect(performance.now() - start).toBeLessThan(1200);
    const result = response(req.peer);
    expect(result.headers).toMatch(/^HTTP\/1\.1 413 /);
    expect(result.headers).toMatch(/cache-control: private, no-store/i);
    expect(result.headers).toMatch(/vary: Cookie, X-Asa-Ai-Seat/i);
    expect(result.headers).toMatch(/x-content-type-options: nosniff/i);
    expect(result.headers).toMatch(/connection: close/i);
    expect(result.json()).toMatchObject({ error: { code: 'ai_attachment_too_large' } });
    expect(req.input.readableEnded).toBe(false);
    expect(req.input.isPaused()).toBe(true);
    expect(f.begin).not.toHaveBeenCalled();
    expect(f.blobs.putImmutable).not.toHaveBeenCalled();
    await absentInOtherProcess(partial.path);
    // Optional diagnostic keeps the exact path for the caller to recheck
    // after this test process exits. Teardown only removes empty directories.
    if (process.env.AI_ATTACHMENT_NATIVE_EVIDENCE)
      await appendFile(process.env.AI_ATTACHMENT_NATIVE_EVIDENCE, `${JSON.stringify(partial)}\n`);
  });

  it('keeps two early errors alive under native output backpressure and releases permits only after terminal output', async () => {
    const f = await fixture();
    const first = f.request('PUT', f.row, true),
      second = f.request('PUT', f.nextRow(), true);
    first.input.push(Buffer.concat([bytes, Buffer.from('!')]));
    second.input.push(Buffer.concat([bytes, Buffer.from('!')]));
    await vi.waitFor(() => {
      expect(first.output.writableEnded).toBe(true);
      expect(second.output.writableEnded).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(first.output.writableFinished).toBe(false);
    expect(first.peer.destroyed).toBe(false);
    expect(first.peer.output.length).toBe(0);
    await expect(f.service.read(OWNER, f.row.uploadId)).rejects.toMatchObject({
      code: 'ai_attachment_busy',
    });
    first.peer.release();
    await vi.waitFor(() => expect(first.output.writableFinished).toBe(true));
    expect(response(first.peer).json()).toMatchObject({
      error: { code: 'ai_attachment_too_large' },
    });
    await expect(f.upload.mock.results[0]!.value).rejects.toMatchObject({
      code: 'ai_attachment_too_large',
    });
    const next = f.request('PUT', f.nextRow());
    next.input.complete = true;
    next.input.push(bytes);
    next.input.push(null);
    await vi.waitFor(() => expect(next.output.writableFinished).toBe(true));
    expect(response(next.peer).headers).toMatch(/^HTTP\/1\.1 200 /);
    const before = second.peer.output.length;
    second.peer.destroy();
    second.peer.release();
    await vi.waitFor(() => expect(second.output.destroyed).toBe(true));
    expect(second.peer.output.length).toBe(before);
    await vi.waitFor(() => expect(second.input.listenerCount('aborted')).toBe(0));
  });

  it.each([false, true])(
    'aborts the actual native input with partial=%s and restores both owner permits',
    async (partial) => {
      const f = await fixture();
      const first = f.request(),
        second = f.request('PUT', f.nextRow());
      if (partial) first.input.push(bytes.subarray(0, 9));
      await vi.waitFor(() => expect(f.upload).toHaveBeenCalledTimes(2));
      if (partial)
        await vi.waitFor(async () => {
          const names = await readdir(join(f.directory, 'asa-ai-private-uploads'));
          expect(names).toHaveLength(2);
          const sizes = await Promise.all(
            names.map(
              async (name) => (await stat(join(f.directory, 'asa-ai-private-uploads', name))).size,
            ),
          );
          expect(sizes.sort((a, b) => a - b)).toEqual([0, 9]);
        });
      await expect(f.service.read(OWNER, f.row.uploadId)).rejects.toMatchObject({
        code: 'ai_attachment_busy',
      });
      first.peer.destroy();
      second.peer.destroy();
      await vi.waitFor(async () => {
        expect(first.input.destroyed).toBe(true);
        expect(second.input.destroyed).toBe(true);
        expect(await readdir(join(f.directory, 'asa-ai-private-uploads'))).toEqual([]);
        expect(first.input.listenerCount('aborted')).toBe(0);
      });
      const next = f.request('PUT', f.nextRow());
      next.input.complete = true;
      next.input.push(bytes);
      next.input.push(null);
      await vi.waitFor(() => expect(next.output.writableFinished).toBe(true));
      expect(response(next.peer).headers).toMatch(/^HTTP\/1\.1 200 /);
      expect(f.blobs.putImmutable).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps native download permits through backpressure, suppresses late reads, and does not read for an already closed output', async () => {
    const f = await fixture();
    f.row.state = 'ready';
    const first = f.request('GET', f.row, true),
      second = f.request('GET', f.row, true);
    await vi.waitFor(() => {
      expect(first.output.writableEnded).toBe(true);
      expect(second.output.writableEnded).toBe(true);
    });
    expect(first.output.writableFinished).toBe(false);
    const third = f.request('GET');
    await vi.waitFor(() => expect(third.output.writableFinished).toBe(true));
    expect(response(third.peer).headers).toMatch(/^HTTP\/1\.1 429 /);
    expect(f.blobs.read).toHaveBeenCalledTimes(2);
    first.peer.release();
    await vi.waitFor(() => expect(first.output.writableFinished).toBe(true));
    expect(response(first.peer).body).toBe(bytes.toString());
    second.output.emit('error', new Error('native response write failed'));
    await vi.waitFor(() => expect(second.peer.destroyed).toBe(true));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.blobs.read.mockImplementation(async () => {
      await gate;
      return bytes;
    });
    const late = f.request('GET');
    await vi.waitFor(() => expect(f.blobs.read).toHaveBeenCalledTimes(3));
    late.peer.destroy();
    release();
    await vi.waitFor(() => expect(late.output.destroyed).toBe(true));
    expect(late.peer.output.length).toBe(0);
    const closed = f.request('GET');
    closed.peer.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.blobs.read).toHaveBeenCalledTimes(3);
  });

  it.each(
    (['before', 'after'] as const).flatMap((phase) =>
      (['close', 'response-error', 'socket-error', 'deadline'] as const).map((event) => ({
        phase,
        event,
      })),
    ),
  )(
    'keeps download ownership through $event $phase native send and prevents late bytes',
    async ({ phase, event }) => {
      const f = await fixture();
      f.row.state = 'ready';
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let releaseRead!: () => void;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      if (phase === 'before')
        f.blobs.read.mockImplementation(async () => {
          await readGate;
          return bytes;
        });
      const first = f.request('GET', f.row, true),
        second = f.request('GET', f.row, true);
      await nativeCondition(() => f.blobs.read.mock.calls.length === 2);
      if (phase === 'after')
        await nativeCondition(() => first.output.writableEnded && second.output.writableEnded);
      await expect(f.service.read(OWNER, f.row.uploadId)).rejects.toMatchObject({
        code: 'ai_attachment_busy',
      });
      if (event === 'deadline') await vi.advanceTimersByTimeAsync(30_000);
      else if (event === 'response-error')
        first.output.emit('error', new Error('native response failed'));
      else
        first.peer.destroy(
          event === 'socket-error' ? new Error('native socket failed') : undefined,
        );
      await nativeCondition(() => first.peer.destroyed);
      if (phase === 'before') {
        // The underlying S3 read still owns its allocation even when no output
        // is possible. Closing HTTP must not release its transfer slot early.
        await expect(f.service.read(OWNER, f.row.uploadId)).rejects.toMatchObject({
          code: 'ai_attachment_busy',
        });
        releaseRead();
      }
      await f.withRead.mock.results[0]!.value;
      first.peer.release();
      expect(first.peer.output.length).toBe(0);
      second.peer.destroy();
      releaseRead();
      await f.withRead.mock.results[1]!.value;
      f.blobs.read.mockResolvedValue(bytes);
      expect((await f.service.read(OWNER, f.row.uploadId)).bytes).toEqual(bytes);
    },
  );

  it('uses one original input/error deadline and clears it before a valid storage handoff', async () => {
    const f = await fixture();
    // Only the clock is controlled here. Input, response and socket events
    // remain native; a separate real-clock probe checks the 30-second wall.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const waitTurn = () => new Promise((resolve) => setImmediate(resolve));
    const poll = async (condition: () => boolean) => {
      const limit = performance.now() + 1200;
      while (!condition() && performance.now() < limit) await waitTurn();
      expect(condition()).toBe(true);
    };
    const slow = f.request();
    slow.input.push(bytes.subarray(0, 9));
    await poll(() => f.upload.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(15_000);
    slow.input.push(bytes.subarray(9, 10));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(slow.input.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await poll(() => slow.input.destroyed && f.reject.mock.calls.length === 1);
    await expect(f.upload.mock.results[0]!.value).rejects.toMatchObject({
      code: 'ai_attachment_upload_interrupted',
    });

    const overflow = f.request('PUT', f.nextRow(), true);
    await poll(() => f.upload.mock.calls.length === 2);
    await vi.advanceTimersByTimeAsync(27_000);
    overflow.input.push(Buffer.concat([bytes, Buffer.from('!')]));
    await poll(() => overflow.output.writableEnded);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(overflow.peer.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await poll(() => overflow.peer.destroyed);
    expect(overflow.peer.output.length).toBe(0);
    await expect(f.upload.mock.results[1]!.value).rejects.toMatchObject({
      code: 'ai_attachment_too_large',
    });

    let finishStorage!: () => void;
    f.blobs.putImmutable.mockImplementation(
      async () =>
        new Promise((resolve) => {
          finishStorage = resolve;
        }),
    );
    const valid = f.request('PUT', f.nextRow());
    await poll(() => f.upload.mock.calls.length === 3);
    await vi.advanceTimersByTimeAsync(27_000);
    valid.input.complete = true;
    valid.input.push(bytes);
    valid.input.push(null);
    await poll(() => f.blobs.putImmutable.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(valid.peer.destroyed).toBe(false);
    finishStorage();
    await poll(() => valid.output.writableFinished);
    expect(response(valid.peer).headers).toMatch(/^HTTP\/1\.1 200 /);
    expect(AI_ATTACHMENT_LIMITS.transferMilliseconds).toBe(30_000);
  });

  it('enforces the original 30-second wall clock while allowing a valid 27-to-31-second storage handoff', async () => {
    const slowFixture = await fixture(),
      overflowFixture = await fixture(),
      validFixture = await fixture();
    let finishStorage!: () => void;
    validFixture.blobs.putImmutable.mockImplementation(
      async () =>
        new Promise((resolve) => {
          finishStorage = resolve;
        }),
    );
    const start = performance.now();
    const slow = slowFixture.request(),
      overflow = overflowFixture.request('PUT', overflowFixture.row, true),
      valid = validFixture.request();
    let slowClosed = 0,
      overflowClosed = 0;
    slow.input.once('close', () => {
      slowClosed = performance.now() - start;
    });
    overflow.peer.once('close', () => {
      overflowClosed = performance.now() - start;
    });
    for (const req of [slow, overflow, valid]) req.input.push(bytes.subarray(0, 9));
    const waitUntil = (elapsed: number) =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, start + elapsed - performance.now())),
      );
    await waitUntil(15_000);
    slow.input.push(bytes.subarray(9, 10));
    await waitUntil(27_000);
    overflow.input.push(Buffer.concat([bytes.subarray(9), Buffer.from('!')]));
    valid.input.complete = true;
    valid.input.push(bytes.subarray(9));
    valid.input.push(null);
    await vi.waitFor(() => {
      expect(overflow.output.writableEnded).toBe(true);
      expect(validFixture.blobs.putImmutable).toHaveBeenCalledTimes(1);
    });
    expect(overflow.peer.destroyed).toBe(false);
    expect(overflow.peer.output.length).toBe(0);
    await waitUntil(31_000);
    expect(slowClosed).toBeGreaterThanOrEqual(29_500);
    expect(slowClosed).toBeLessThanOrEqual(31_500);
    expect(overflowClosed).toBeGreaterThanOrEqual(29_500);
    expect(overflowClosed).toBeLessThanOrEqual(31_500);
    expect(valid.peer.destroyed).toBe(false);
    finishStorage();
    await vi.waitFor(() => expect(valid.output.writableFinished).toBe(true));
    expect(response(valid.peer).headers).toMatch(/^HTTP\/1\.1 200 /);
    await expect(slowFixture.upload.mock.results[0]!.value).rejects.toMatchObject({
      code: 'ai_attachment_upload_interrupted',
    });
    await expect(overflowFixture.upload.mock.results[0]!.value).rejects.toMatchObject({
      code: 'ai_attachment_too_large',
    });
    expect(slowFixture.blobs.putImmutable).not.toHaveBeenCalled();
    expect(overflowFixture.blobs.putImmutable).not.toHaveBeenCalled();
  }, 40_000);
});
