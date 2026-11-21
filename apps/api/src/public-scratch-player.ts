import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type pg from 'pg';
import type { PublicScratchPlayerBootstrap } from '@asa-lab/contracts';
import type { BlocksAssetFormat, BlocksProjectDocumentV1 } from '@asa-lab/blocks';
import { assetByteLimit, inspectBlocksDocument, snapshotJson } from './blocks-durable-document.js';
import { readBlocksRuntimeServerConfig } from './blocks-runtime-config.js';
import {
  S3BlocksBlobStore,
  disposeBlocksBlobBody,
  readBlocksObjectStorageConfig,
  type BlocksBlobStorePort,
} from './blocks-asset-storage.js';
import { publicationError } from './public-projects.errors.js';
import { FixedWindowRateLimiter } from './rate-limit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPE = 'asa-public-scratch-player+jwt';
const AUD = 'asa-public-scratch-player';
const TTL = 600;
const JSON_LIMIT = 4 * 1024 * 1024;
const ASSET_LIMIT = 64 * 1024 * 1024;
// Native built-ins keep their upstream behavior; custom extension URLs are not executable input.
const EXTENSIONS = new Set([
  'pen',
  'music',
  'videoSensing',
  'text2speech',
  'translate',
  'microbit',
  'wedo2',
  'ev3',
  'boost',
  'gdxfor',
  'makeymakey',
]);
const BLOCK_FAMILIES = new Set([
  'motion',
  'looks',
  'sound',
  'event',
  'control',
  'sensing',
  'operator',
  'data',
  'procedures',
  'argument',
  ...EXTENSIONS,
]);
const error = () => publicationError('not_available', 'Проект недоступен для просмотра.', 404);

/** A separate public namespace. Never passed to editor/principal authorization. */
export interface PublicScratchBinding {
  readonly publicationId: string;
  readonly revisionId: string;
}
export function validPublicScratchBinding(input: PublicScratchBinding): boolean {
  return UUID.test(input.publicationId) && UUID.test(input.revisionId);
}

export async function publicScratchDocument(value: unknown): Promise<BlocksProjectDocumentV1> {
  snapshotJson(value, JSON_LIMIT);
  const document = await inspectBlocksDocument(value, JSON_LIMIT, ASSET_LIMIT);
  const project = document.projectJson;
  const unsupported = () =>
    publicationError('player_unsupported', 'Этот проект пока доступен как обложка.', 422);
  if (!project || document.assets.length > 256) throw unsupported();
  const targets = project['targets'] as Record<string, unknown>[];
  const extensions = project['extensions'] as unknown[];
  if (
    targets.length > 128 ||
    extensions.some((id) => typeof id !== 'string' || !EXTENSIONS.has(id))
  )
    throw unsupported();
  let blocks = 0;
  for (const target of targets) {
    if (!target || !target['blocks'] || typeof target['blocks'] !== 'object') throw unsupported();
    blocks += Object.keys(target['blocks']).length;
    if (blocks > 20000) throw unsupported();
    for (const block of Object.values(target['blocks'])) {
      // Compressed variable/list reporters are native Scratch arrays.
      if (Array.isArray(block)) continue;
      if (
        !block ||
        typeof block !== 'object' ||
        !('opcode' in block) ||
        typeof block.opcode !== 'string' ||
        !BLOCK_FAMILIES.has(block.opcode.split('_', 1)[0]!)
      )
        throw unsupported();
    }
  }
  // Refuse URL-bearing extension/cloud metadata before handing data to the official VM.
  const visit = (node: unknown, depth: number): void => {
    if (depth > 128) throw unsupported();
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (/^(?:extensionURLs?|cloudHost|projectHost|assetHost|websocketHost)$/i.test(key))
        throw unsupported();
      visit(child, depth + 1);
    }
  };
  visit(project, 0);
  return document;
}

export class PublicScratchPlayerService {
  private readonly budget = new FixedWindowRateLimiter({
    limit: 2048,
    windowMs: 600000,
    maxKeys: 5000,
  });
  private readonly cache = new Map<string, { document: BlocksProjectDocumentV1; bytes: number }>();
  private cacheBytes = 0;
  private active = 0;
  private readonly waiting: {
    grant: () => void;
    reject: (cause: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    abort: () => void;
  }[] = [];
  private blobs?: BlocksBlobStorePort;
  constructor(
    private readonly pool: pg.Pool | null,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly options: { blobs?: BlocksBlobStorePort; now?: () => number } = {},
  ) {}
  private now() {
    return Math.floor((this.options.now?.() ?? Date.now()) / 1000);
  }
  private async enter(signal?: AbortSignal): Promise<() => void> {
    const unavailable = () =>
      publicationError('database_unavailable', 'Просмотр временно недоступен.', 503);
    if (!this.pool || signal?.aborted) throw unavailable();
    // Four bounded verified buffers (max25MiB each), FIFO for a whole classroom burst.
    if (this.active < 4) this.active++;
    else {
      if (this.waiting.length >= 128) throw unavailable();
      await new Promise<void>((grant, reject) => {
        const remove = () => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          clearTimeout(entry.timer);
          signal?.removeEventListener('abort', entry.abort);
        };
        const entry = {
          grant: () => {
            remove();
            grant();
          },
          reject,
          timer: setTimeout(() => {
            remove();
            reject(unavailable());
          }, 5000),
          ...(signal ? { signal } : {}),
          abort: () => {
            remove();
            reject(unavailable());
          },
        };
        this.waiting.push(entry);
        signal?.addEventListener('abort', entry.abort, { once: true });
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting[0];
      if (next) next.grant();
      else this.active--;
    };
  }
  async source(
    binding: PublicScratchBinding,
    signal?: AbortSignal,
  ): Promise<BlocksProjectDocumentV1> {
    if (!validPublicScratchBinding(binding)) throw error();
    const release = await this.enter(signal);
    try {
      const result = await this.pool!.query<{ document_json: unknown }>(
        'SELECT * FROM public.public_scratch_player_source($1,$2)',
        [binding.publicationId, binding.revisionId],
      );
      if (!result.rows[0]) throw error();
      // Fresh SQL readability check precedes every cache hit.
      const key = binding.publicationId + ':' + binding.revisionId;
      const hit = this.cache.get(key);
      if (hit) return hit.document;
      let document: BlocksProjectDocumentV1;
      try {
        document = await publicScratchDocument(result.rows[0].document_json);
      } catch {
        throw publicationError('player_unsupported', 'Этот проект пока доступен как обложка.', 422);
      }
      const bytes = Buffer.byteLength(JSON.stringify(document));
      while (this.cache.size >= 16 || this.cacheBytes + bytes > 8 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cacheBytes -= this.cache.get(oldest)!.bytes;
        this.cache.delete(oldest);
      }
      this.cache.set(key, { document, bytes });
      this.cacheBytes += bytes;
      return document;
    } finally {
      release();
    }
  }
  async issue(
    binding: PublicScratchBinding,
    signal?: AbortSignal,
  ): Promise<PublicScratchPlayerBootstrap> {
    const config = readBlocksRuntimeServerConfig(this.env);
    const document = await this.source(binding, signal);
    const issuedAt = this.now();
    const { SignJWT } = await import('jose');
    const runtimeToken = await new SignJWT({
      publicationId: binding.publicationId,
      revisionId: binding.revisionId,
      runtimeOrigin: config.runtimeOrigin,
      mode: 'public-player',
    })
      .setProtectedHeader({ alg: 'HS256', typ: TYPE })
      .setIssuer('asa-lab')
      .setAudience(AUD)
      .setJti(randomUUID())
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(issuedAt + TTL)
      .sign(config.signingKey);
    return {
      schemaVersion: 1 as const,
      viewerFamily: 'scratch' as const,
      publicationId: binding.publicationId,
      revisionId: binding.revisionId,
      runtimeOrigin: config.runtimeOrigin,
      runtimeToken,
      expiresAt: issuedAt + TTL,
      serverTime: issuedAt,
      projectJson: document.projectJson!,
      assets: document.assets,
    };
  }
  async verify(binding: PublicScratchBinding, token: string, origin: string | undefined) {
    const config = readBlocksRuntimeServerConfig(this.env);
    if (
      !validPublicScratchBinding(binding) ||
      origin !== config.runtimeOrigin ||
      token.length > 4096
    )
      throw error();
    const { jwtVerify } = await import('jose');
    try {
      const { payload } = await jwtVerify(token, config.signingKey, {
        issuer: 'asa-lab',
        audience: AUD,
        typ: TYPE,
        algorithms: ['HS256'],
        currentDate: new Date(this.now() * 1000),
        clockTolerance: 0,
        requiredClaims: [
          'iat',
          'nbf',
          'exp',
          'jti',
          'publicationId',
          'revisionId',
          'mode',
          'runtimeOrigin',
        ],
      });
      const keys = [
        'iss',
        'aud',
        'iat',
        'nbf',
        'exp',
        'jti',
        'publicationId',
        'revisionId',
        'mode',
        'runtimeOrigin',
      ];
      if (
        Object.keys(payload).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(payload, key)) ||
        payload['publicationId'] !== binding.publicationId ||
        payload['revisionId'] !== binding.revisionId ||
        payload['mode'] !== 'public-player' ||
        payload['runtimeOrigin'] !== config.runtimeOrigin ||
        !UUID.test(String(payload.jti)) ||
        !Number.isSafeInteger(payload.iat) ||
        payload.nbf !== payload.iat ||
        payload.exp !== payload.iat! + TTL
      )
        throw error();
      if (!this.budget.consume(payload.jti!).allowed)
        throw publicationError('too_many_requests', 'Слишком много запросов просмотра.', 429);
      return payload;
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'getStatus' in cause) throw cause;
      throw error();
    }
  }
  async asset(
    binding: PublicScratchBinding,
    token: string,
    origin: string | undefined,
    assetId: string,
    dataFormat: BlocksAssetFormat,
    signal?: AbortSignal,
  ) {
    const grant = await this.verify(binding, token, origin);
    if (
      !/^[a-f0-9]{32}$/.test(assetId) ||
      !['svg', 'png', 'jpg', 'wav', 'mp3'].includes(dataFormat)
    )
      throw error();
    const release = await this.enter(signal);
    let handedOff = false;
    try {
      const result = await this.pool!.query<{
        tenant_id: string;
        asset_id: string;
        data_format: BlocksAssetFormat;
        sha256: string;
        size_bytes: string;
      }>('SELECT * FROM public.public_scratch_player_asset($1,$2,$3,$4)', [
        binding.publicationId,
        binding.revisionId,
        assetId,
        dataFormat,
      ]);
      const ref = result.rows[0];
      if (
        !ref ||
        ref.asset_id !== assetId ||
        ref.data_format !== dataFormat ||
        this.now() >= grant.exp! ||
        signal?.aborted
      )
        throw error();
      const sizeBytes = Number(ref.size_bytes);
      if (
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1 ||
        sizeBytes > assetByteLimit(dataFormat)
      )
        throw error();
      const blobs =
        this.options.blobs ??
        (this.blobs ??= new S3BlocksBlobStore(readBlocksObjectStorageConfig(this.env)));
      const readAbort = new AbortController();
      let input: Readable | null = null;
      const cancel = () => readAbort.abort();
      const cancelled = () =>
        publicationError('asset_unavailable', 'Чтение ресурса прервано.', 503);
      const destroyInput = () => input?.destroy(new Error('public_player_request_cancelled'));
      // The same deadline covers SDK headers/open AND verified body consumption.
      const inputTimer = setTimeout(cancel, 30000);
      inputTimer.unref();
      signal?.addEventListener('abort', cancel, { once: true });
      readAbort.signal.addEventListener('abort', destroyInput, { once: true });
      let bytes: Buffer;
      try {
        if (signal?.aborted) cancel();
        if (readAbort.signal.aborted) throw cancelled();
        const opened = blobs.open(
          { tenantId: ref.tenant_id, sha256: ref.sha256, dataFormat },
          { signal: readAbort.signal },
        );
        // Real S3 receives the signal. The guard also releases admission if a
        // noncompliant adapter ignores it; any late body is closed, never leaked.
        const body = await new Promise<Awaited<typeof opened>>((resolve, reject) => {
          const aborted = () => reject(cancelled());
          readAbort.signal.addEventListener('abort', aborted, { once: true });
          void opened.then(
            (value) => {
              readAbort.signal.removeEventListener('abort', aborted);
              if (readAbort.signal.aborted) {
                if (value) disposeBlocksBlobBody(value);
                return;
              }
              resolve(value);
            },
            (cause) => {
              readAbort.signal.removeEventListener('abort', aborted);
              reject(cause);
            },
          );
          if (readAbort.signal.aborted) aborted();
        });
        if (!body) throw error();
        input = Readable.from(body);
        bytes = Buffer.alloc(sizeBytes);
        let offset = 0;
        const hash = createHash('sha256');
        if (readAbort.signal.aborted) destroyInput();
        for await (const chunk of input) {
          if (
            !(chunk instanceof Uint8Array) ||
            offset + chunk.byteLength > sizeBytes ||
            this.now() >= grant.exp!
          )
            throw error();
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
          hash.update(chunk);
        }
        if (
          offset !== sizeBytes ||
          hash.digest('hex') !== ref.sha256 ||
          readAbort.signal.aborted ||
          this.now() >= grant.exp!
        )
          throw publicationError('asset_integrity_error', 'Ресурс не прошёл проверку.', 503);
      } catch (cause) {
        if (readAbort.signal.aborted) throw cancelled();
        throw cause;
      } finally {
        clearTimeout(inputTimer);
        signal?.removeEventListener('abort', cancel);
        readAbort.signal.removeEventListener('abort', destroyInput);
        input?.destroy();
      }
      // No bytes are returned before whole-object size/SHA validation succeeds.
      const stream = Readable.from([bytes]);
      const outputTimer = setTimeout(() => {
        stream.destroy();
        finish();
      }, 30000);
      outputTimer.unref();
      const finish = () => {
        clearTimeout(outputTimer);
        signal?.removeEventListener('abort', close);
        release();
      };
      const close = () => {
        stream.destroy();
        finish();
      };
      stream.once('error', finish);
      signal?.addEventListener('abort', close, { once: true });
      handedOff = true;
      if (signal?.aborted) stream.destroy();
      // Keep the lease until HTTP finish/close, including a slow socket buffer.
      return { body: stream, sizeBytes, dataFormat, release: finish };
    } finally {
      if (!handedOff) release();
    }
  }
}
