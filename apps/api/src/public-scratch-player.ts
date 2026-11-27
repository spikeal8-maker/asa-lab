import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type pg from 'pg';
import type {
  PublicScratchPlayerBootstrap,
  StudentScratchReviewBootstrap,
} from '@asa-lab/contracts';
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
import type { PublicationReviewer } from './student-publication-review.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPE = 'asa-public-scratch-player+jwt';
const AUD = 'asa-public-scratch-player';
const REVIEW_TYPE = 'asa-student-scratch-review+jwt';
const REVIEW_AUD = 'asa-student-scratch-review';
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

// Match the pinned VM's native SB3 serialization, without forwarding authoring
// provenance or foreign costume objects that can bypass manifest lookup.
const TARGET_FIELDS = [
  'isStage',
  'name',
  'variables',
  'lists',
  'broadcasts',
  'currentCostume',
  'volume',
  'layerOrder',
] as const;
const STAGE_FIELDS = ['tempo', 'videoTransparency', 'videoState'] as const;
const SPRITE_FIELDS = [
  'visible',
  'x',
  'y',
  'size',
  'direction',
  'draggable',
  'rotationStyle',
] as const;
const COSTUME_FIELDS = [
  'assetId',
  'dataFormat',
  'md5ext',
  'name',
  'bitmapResolution',
  'rotationCenterX',
  'rotationCenterY',
] as const;
const SOUND_FIELDS = ['assetId', 'dataFormat', 'md5ext', 'name', 'rate', 'sampleCount'] as const;
const BLOCK_FIELDS = [
  'opcode',
  'comment',
  'next',
  'topLevel',
  'parent',
  'shadow',
  'x',
  'y',
] as const;
const COMMENT_FIELDS = ['blockId', 'text', 'minimized', 'x', 'y', 'width', 'height'] as const;
const MONITOR_FIELDS = [
  'id',
  'mode',
  'opcode',
  'spriteName',
  'width',
  'height',
  'x',
  'y',
  'visible',
  'sliderMin',
  'sliderMax',
  'isDiscrete',
] as const;
const PROCEDURE_ARGUMENT_FIELDS = ['argumentids', 'argumentnames', 'argumentdefaults'] as const;

function unsupportedScratchShape() {
  return publicationError(
    'player_unsupported',
    'Сохранённая программа недоступна для просмотра.',
    422,
  );
}

function nativeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unsupportedScratchShape();
  return value as Record<string, unknown>;
}

function nativeFields(value: unknown, fields: readonly string[]) {
  const input = nativeRecord(value);
  return Object.fromEntries(
    fields.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]),
  );
}

function scratchScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  );
}

function nativeScratchField(value: unknown) {
  if (!Array.isArray(value) || !scratchScalar(value[0])) throw unsupportedScratchShape();
  const [field, id] = value;
  return typeof id === 'string' || id === null ? [field, id] : [field];
}

function nativeScratchInput(value: unknown) {
  if (!Array.isArray(value)) throw unsupportedScratchShape();
  const [mode, block, shadow] = value;
  // Parser validation bounds primitive types. The VM only reads inline reporter coordinates at top level.
  const inline = (ref: unknown) => (Array.isArray(ref) ? ref.slice(0, 3) : (ref ?? null));
  return mode === 3 ? [mode, inline(block), inline(shadow)] : [mode, inline(block)];
}

function nativeScratchMutation(value: unknown, opcode: unknown) {
  const mutation = nativeRecord(value);
  const clean = nativeFields(mutation, ['tagName', 'hasnext']);
  // The native VM reads procedure attributes as JSON arrays, not as arbitrary JSON.
  if (opcode === 'procedures_prototype' || opcode === 'procedures_call') {
    Object.assign(clean, nativeFields(mutation, ['proccode', 'warp']));
    for (const key of PROCEDURE_ARGUMENT_FIELDS) {
      if (!Object.hasOwn(mutation, key)) continue;
      let args: unknown;
      try {
        const serialized = mutation[key];
        if (typeof serialized !== 'string') throw unsupportedScratchShape();
        args = JSON.parse(serialized);
      } catch {
        throw unsupportedScratchShape();
      }
      const validItem =
        key === 'argumentdefaults' ? scratchScalar : (item: unknown) => typeof item === 'string';
      if (!Array.isArray(args) || !args.every(validItem)) throw unsupportedScratchShape();
      clean[key] = JSON.stringify(args);
    }
  }
  // The native mutations above have no child nodes used by playback.
  if (Object.hasOwn(mutation, 'children')) clean['children'] = [];
  return clean;
}

function nativeScratchBlock(value: unknown) {
  if (Array.isArray(value)) return value;
  const block = nativeRecord(value);
  const clean = nativeFields(block, BLOCK_FIELDS);
  if (Object.hasOwn(block, 'inputs'))
    clean['inputs'] = Object.fromEntries(
      Object.entries(nativeRecord(block['inputs'])).map(([name, input]) => [
        name,
        nativeScratchInput(input),
      ]),
    );
  if (Object.hasOwn(block, 'fields'))
    clean['fields'] = Object.fromEntries(
      Object.entries(nativeRecord(block['fields'])).map(([name, field]) => [
        name,
        nativeScratchField(field),
      ]),
    );
  if (Object.hasOwn(block, 'mutation'))
    clean['mutation'] = nativeScratchMutation(block['mutation'], block['opcode']);
  return clean;
}

function nativeScratchMonitor(value: unknown) {
  const monitor = nativeRecord(value);
  const clean = Object.fromEntries(
    Object.entries(nativeFields(monitor, MONITOR_FIELDS)).filter(
      ([, field]) => field === null || scratchScalar(field),
    ),
  );
  const params = monitor['params'];
  if (params && typeof params === 'object' && !Array.isArray(params))
    clean['params'] = Object.fromEntries(
      Object.entries(params).filter(([, param]) => scratchScalar(param)),
    );
  else if (Object.hasOwn(monitor, 'params')) clean['params'] = {};
  const current = monitor['value'];
  if (scratchScalar(current) || current === null) clean['value'] = current;
  else if (Array.isArray(current)) clean['value'] = current.filter(scratchScalar);
  return clean;
}

export async function studentScratchDocument(value: unknown): Promise<BlocksProjectDocumentV1> {
  const document = await publicScratchDocument(value);
  const project = document.projectJson!;
  const targets = (project['targets'] as Record<string, unknown>[]).map((target) => ({
    ...nativeFields(target, TARGET_FIELDS),
    ...nativeFields(target, target['isStage'] === true ? STAGE_FIELDS : SPRITE_FIELDS),
    ...(target['isStage'] === true &&
    (target['textToSpeechLanguage'] === null || typeof target['textToSpeechLanguage'] === 'string')
      ? { textToSpeechLanguage: target['textToSpeechLanguage'] }
      : {}),
    blocks: Object.fromEntries(
      Object.entries(nativeRecord(target['blocks'])).map(([id, block]) => [
        id,
        nativeScratchBlock(block),
      ]),
    ),
    ...(target['comments'] === undefined
      ? {}
      : {
          comments: Object.fromEntries(
            Object.entries(nativeRecord(target['comments'])).map(([id, comment]) => [
              id,
              nativeFields(comment, COMMENT_FIELDS),
            ]),
          ),
        }),
    costumes: (target['costumes'] as unknown[]).map((costume) =>
      nativeFields(costume, COSTUME_FIELDS),
    ),
    sounds: (target['sounds'] as unknown[]).map((value) => {
      const sound = nativeRecord(value);
      return {
        ...nativeFields(sound, SOUND_FIELDS),
        ...(typeof sound['format'] === 'string' ? { format: sound['format'] } : {}),
      };
    }),
  }));
  return publicScratchDocument({
    ...document,
    projectJson: {
      targets,
      monitors: (project['monitors'] as unknown[]).map(nativeScratchMonitor),
      extensions: project['extensions'],
      meta: { semver: '3.0.0' },
    },
  });
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

  async issueStudentReview(
    reviewer: PublicationReviewer,
    requestId: string,
  ): Promise<StudentScratchReviewBootstrap> {
    if (!UUID.test(requestId)) throw error();
    const release = await this.enter();
    try {
      const result = await this.pool!.query<{ source_revision: number; document_json: unknown }>(
        'SELECT * FROM public.classroom_publication_student_scratch_source($1,$2,$3,$4)',
        [reviewer.actor, reviewer.role, reviewer.classroomId, requestId],
      );
      const source = result.rows[0];
      if (!source || !Number.isSafeInteger(source.source_revision) || source.source_revision < 1)
        throw error();
      let config;
      try {
        config = readBlocksRuntimeServerConfig(this.env);
      } catch {
        throw publicationError('player_unavailable', 'Просмотр временно недоступен.', 503);
      }
      const document = await studentScratchDocument(source.document_json);
      const { SignJWT } = await import('jose');
      const issuedAt = this.now();
      const binding = requestId.toLowerCase();
      const runtimeToken = await new SignJWT({
        requestId: binding,
        sourceRevision: source.source_revision,
        reviewer: reviewer.actor,
        role: reviewer.role,
        classroomId: reviewer.classroomId,
        runtimeOrigin: config.runtimeOrigin,
        mode: 'student-review-player',
      })
        .setProtectedHeader({ alg: 'HS256', typ: REVIEW_TYPE })
        .setIssuer('asa-lab')
        .setAudience(REVIEW_AUD)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setNotBefore(issuedAt)
        .setExpirationTime(issuedAt + TTL)
        .sign(config.signingKey);
      return {
        schemaVersion: 1,
        viewerFamily: 'scratch',
        publicationId: binding,
        revisionId: binding,
        reviewRequestId: binding,
        sourceRevision: source.source_revision,
        runtimeOrigin: config.runtimeOrigin,
        runtimeToken,
        expiresAt: issuedAt + TTL,
        serverTime: issuedAt,
        projectJson: document.projectJson!,
        assets: document.assets,
      };
    } finally {
      release();
    }
  }

  private async verifyStudentReview(
    binding: PublicScratchBinding,
    token: string,
    origin: string | undefined,
  ) {
    const config = readBlocksRuntimeServerConfig(this.env);
    if (
      !validPublicScratchBinding(binding) ||
      binding.publicationId !== binding.revisionId ||
      origin !== config.runtimeOrigin ||
      token.length > 4096
    )
      throw error();
    const { jwtVerify } = await import('jose');
    const claims = [
      'iss',
      'aud',
      'iat',
      'nbf',
      'exp',
      'jti',
      'requestId',
      'sourceRevision',
      'reviewer',
      'role',
      'classroomId',
      'runtimeOrigin',
      'mode',
    ];
    try {
      const { payload } = await jwtVerify(token, config.signingKey, {
        issuer: 'asa-lab',
        audience: REVIEW_AUD,
        typ: REVIEW_TYPE,
        algorithms: ['HS256'],
        currentDate: new Date(this.now() * 1000),
        clockTolerance: 0,
        requiredClaims: claims,
      });
      const role = payload['role'];
      const classroomId = payload['classroomId'];
      const revision = payload['sourceRevision'];
      const reviewer = payload['reviewer'];
      if (
        Object.keys(payload).length !== claims.length ||
        payload['requestId'] !== binding.publicationId ||
        payload['mode'] !== 'student-review-player' ||
        payload['runtimeOrigin'] !== config.runtimeOrigin ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        revision > 2147483647 ||
        typeof reviewer !== 'string' ||
        !UUID.test(reviewer) ||
        !UUID.test(String(payload.jti)) ||
        !Number.isSafeInteger(payload.iat) ||
        payload.nbf !== payload.iat ||
        payload.exp !== payload.iat! + TTL ||
        !(
          (role === 'teacher' && typeof classroomId === 'string' && UUID.test(classroomId)) ||
          (role === 'platform' && classroomId === null)
        )
      )
        throw error();
      if (!this.budget.consume(payload.jti!).allowed)
        throw publicationError('too_many_requests', 'Слишком много запросов просмотра.', 429);
      return { reviewer, role, classroomId, revision, exp: payload.exp! };
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
    // The compact JWS flows unchanged through the official host. The untrusted
    // header only selects which verifier may run, never which asset is readable.
    const kind = await import('jose').then(({ decodeProtectedHeader }) => {
      if (token.length > 4096) throw error();
      try {
        return decodeProtectedHeader(token).typ;
      } catch {
        throw error();
      }
    });
    const review =
      kind === REVIEW_TYPE ? await this.verifyStudentReview(binding, token, origin) : null;
    const grant = review ?? (await this.verify(binding, token, origin));
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
      }>(
        review
          ? 'SELECT * FROM public.classroom_publication_student_scratch_asset($1,$2,$3,$4,$5,$6,$7)'
          : 'SELECT * FROM public.public_scratch_player_asset($1,$2,$3,$4)',
        review
          ? [
              review.reviewer,
              review.role,
              review.classroomId,
              binding.publicationId,
              review.revision,
              assetId,
              dataFormat,
            ]
          : [binding.publicationId, binding.revisionId, assetId, dataFormat],
      );
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
