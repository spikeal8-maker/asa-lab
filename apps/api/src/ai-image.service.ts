import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type pg from 'pg';
import type {
  AiGeneratedImage,
  AiImageGenerationAdminConfig,
  AiImageGenerationAdminUpdate,
  AiImageGenerationJob,
  AiImageGenerationRequest,
  AiImageGenerationStatus,
  AiImageJobState,
  AiImageSize,
} from '@asa-lab/contracts';
import { ComfyImageTransport, imageWorkflowDigest } from './ai-image-comfyui.js';
import { readBlocksObjectStorageConfig } from './blocks-asset-storage.js';
import {
  AiAttachmentStorageError,
  S3AiAttachmentBlobStore,
  type AiAttachmentBlobStore,
  type AiAttachmentObject,
} from './ai-attachments/blob-store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class AiImageError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ImageJobRow {
  graph_digest: string;
  owner_principal_id: string;
  request_id: string;
  thread_id: string;
  provider_id: string;
  marker: string;
  seed: number;
  prompt: string | null;
  size: AiImageSize;
  state: AiImageJobState;
  created_at: string;
  cancel_requested: boolean;
  error_code: string | null;
  deleted_at: string | null;
  sha256: string | null;
  size_bytes: number | null;
  put_started: boolean;
  put_uncertain: boolean;
  cleanup_required: boolean;
}
interface ImageConfig extends Omit<AiImageGenerationAdminConfig, 'ready' | 'reason'> {
  remainingToday?: number;
}
export interface AiImageServiceOptions {
  transport?: Pick<ComfyImageTransport, 'readiness' | 'dispatch' | 'recover' | 'cancelPending'>;
  blobs?: AiAttachmentBlobStore;
  env?: NodeJS.ProcessEnv;
  maintenance?: boolean;
}
export function imageId(value: string): string {
  if (!UUID.test(value))
    throw new AiImageError('ai_image_input_invalid', 400, 'Неверный идентификатор запроса.');
  return value.toLowerCase();
}
export function imageInput(raw: unknown): AiImageGenerationRequest {
  const p = raw as Partial<AiImageGenerationRequest> | null;
  if (
    !p ||
    typeof p !== 'object' ||
    typeof p.requestId !== 'string' ||
    !UUID.test(p.requestId) ||
    typeof p.prompt !== 'string' ||
    p.prompt.trim().length < 1 ||
    p.prompt.length > 3000 ||
    /[\p{Cc}]/u.test(p.prompt) ||
    ![512, 768, 1024].includes(Number(p.size)) ||
    typeof p.size !== 'number'
  )
    throw new AiImageError(
      'ai_image_input_invalid',
      400,
      'Введите описание до 3000 символов и выберите размер.',
    );
  return { requestId: imageId(p.requestId), prompt: p.prompt.trim(), size: p.size as AiImageSize };
}
export function imageAdminInput(raw: unknown): AiImageGenerationAdminUpdate {
  const p = raw as AiImageGenerationAdminUpdate | null;
  if (
    !p ||
    typeof p !== 'object' ||
    typeof p.requestId !== 'string' ||
    !UUID.test(p.requestId) ||
    !Number.isSafeInteger(p.configurationVersion) ||
    p.configurationVersion < 1 ||
    typeof p.enabled !== 'boolean' ||
    !Number.isSafeInteger(p.dailyLimit) ||
    p.dailyLimit < 1 ||
    p.dailyLimit > 100 ||
    !Number.isSafeInteger(p.globalConcurrency) ||
    p.globalConcurrency < 1 ||
    p.globalConcurrency > 2 ||
    !Array.isArray(p.sizes) ||
    p.sizes.length < 1 ||
    p.sizes.length > 3 ||
    new Set(p.sizes).size !== p.sizes.length ||
    p.sizes.some((v) => ![512, 768, 1024].includes(v))
  )
    throw new AiImageError(
      'ai_image_config_invalid',
      400,
      'Проверьте настройки генерации изображений.',
    );
  return {
    requestId: imageId(p.requestId),
    configurationVersion: p.configurationVersion,
    enabled: p.enabled,
    dailyLimit: p.dailyLimit,
    globalConcurrency: p.globalConcurrency,
    sizes: p.sizes,
  };
}
function descriptor(j: ImageJobRow): AiAttachmentObject {
  if (!j.sha256 || !j.size_bytes)
    throw new AiImageError('ai_image_unavailable', 503, 'Изображение пока недоступно.');
  return {
    ownerId: j.owner_principal_id,
    uploadId: j.request_id,
    sha256: j.sha256,
    sizeBytes: j.size_bytes,
    purpose: 'generated',
  };
}
function image(j: ImageJobRow): AiGeneratedImage {
  return {
    requestId: j.request_id,
    width: j.size,
    height: j.size,
    mimeType: 'image/png',
    sizeBytes: j.size_bytes!,
    downloadUrl: `/api/ai/threads/${j.thread_id}/image-generations/${j.request_id}/image`,
  };
}
export function imageJob(j: ImageJobRow): AiImageGenerationJob {
  return {
    requestId: j.request_id,
    threadId: j.thread_id,
    state: j.state,
    prompt: j.prompt ?? '',
    createdAt: new Date(j.created_at).toISOString(),
    cancelRequested: j.cancel_requested,
    errorCode: j.error_code,
    image: j.state === 'complete' && !j.cancel_requested && !j.deleted_at ? image(j) : null,
  };
}
/** One dispatch CAS, one provider POST, one immutable object PUT. Recovery only reads. */
export class AiImageService implements OnModuleInit, OnModuleDestroy {
  private readonly transport: AiImageServiceOptions['transport'] & {};
  private blobsValue: AiAttachmentBlobStore | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sweeping: Promise<void> | undefined;
  private closing = false;
  constructor(
    private readonly pool: pg.Pool,
    private readonly options: AiImageServiceOptions = {},
  ) {
    this.transport = options.transport ?? new ComfyImageTransport();
    this.blobsValue = options.blobs;
    this.env = options.env ?? process.env;
  }
  private blobs(): AiAttachmentBlobStore {
    if (this.blobsValue) return this.blobsValue;
    try {
      return (this.blobsValue = new S3AiAttachmentBlobStore(
        readBlocksObjectStorageConfig(this.env),
      ));
    } catch {
      throw new AiImageError(
        'ai_image_storage_unavailable',
        503,
        'Приватное хранилище изображений не настроено.',
      );
    }
  }
  private async value<T>(sql: string, args: unknown[] = []): Promise<T> {
    try {
      const result = await this.pool.query<{ value: T }>(sql, args);
      return result.rows[0]!.value;
    } catch (e) {
      if (e instanceof AiImageError) throw e;
      const m = e instanceof Error ? e.message : '';
      if (/AI_(?:SCOPE|STUDENT|ADMIN|THREAD)_DENIED/.test(m))
        throw new AiImageError('ai_image_denied', 403, 'Нет доступа к генерации в этом диалоге.');
      if (/AI_(?:IMAGE_BUSY|IMAGE_QUOTA_EXHAUSTED)/.test(m))
        throw new AiImageError(
          'ai_image_busy',
          429,
          'Лимит генерации исчерпан или видеокарта занята.',
        );
      if (/AI_(?:REQUEST_ID_REUSED|CONFIG_CHANGED)/.test(m))
        throw new AiImageError('ai_image_conflict', 409, 'Запрос или настройки уже изменились.');
      if (/AI_IMAGE_NOT_FOUND/.test(m))
        throw new AiImageError('ai_image_not_found', 404, 'Изображение не найдено.');
      if (/AI_IMAGE_INPUT_INVALID/.test(m))
        throw new AiImageError(
          'ai_image_input_invalid',
          400,
          'Выберите доступный размер изображения.',
        );
      if (/AI_IMAGE_UNAVAILABLE/.test(m))
        throw new AiImageError(
          'ai_image_unavailable',
          503,
          'ComfyUI или приватное хранилище недоступны.',
        );
      if (/AI_IMAGE_DISABLED/.test(m))
        throw new AiImageError('ai_image_disabled', 403, 'Генерация изображений выключена.');
      throw e;
    }
  }
  private async readiness() {
    try {
      this.blobs();
      return await this.transport.readiness();
    } catch {
      return { ready: false, reason: 'Приватное хранилище изображений недоступно.' };
    }
  }
  async status(owner: string): Promise<AiImageGenerationStatus> {
    const c = await this.value<ImageConfig>('SELECT ai_image_status($1) AS value', [owner]);
    const r = await this.readiness();
    return {
      enabled: c.enabled,
      ready: r.ready && c.enabled,
      reason: !c.enabled ? 'Генерация изображений выключена.' : r.reason,
      sizes: c.sizes,
      dailyLimit: c.dailyLimit,
      remainingToday: c.remainingToday ?? 0,
    };
  }
  async admin(actor: string): Promise<AiImageGenerationAdminConfig> {
    const c = await this.value<ImageConfig>('SELECT ai_image_config($1) AS value', [actor]);
    return { ...c, ...(await this.readiness()) };
  }
  async saveAdmin(actor: string, raw: unknown): Promise<AiImageGenerationAdminConfig> {
    await this.value('SELECT ai_image_config_set($1,$2::jsonb) AS value', [
      actor,
      JSON.stringify(imageAdminInput(raw)),
    ]);
    return this.admin(actor);
  }
  private async admit(owner: string, thread: string, raw: unknown): Promise<ImageJobRow> {
    try {
      const input = imageInput(raw);
      const t = imageId(thread);
      const availability = await this.readiness();
      const provider = randomUUID();
      const seed = randomBytes(4).readUInt32BE();
      const graphDigest = imageWorkflowDigest(
        input.prompt,
        input.size,
        seed,
        'ASA_' + provider.replaceAll('-', ''),
      );
      // Replay must succeed even after provider/storage configuration changed.
      return await this.value<ImageJobRow>(
        'SELECT ai_image_begin($1,$2,$3,$4,$5::integer,$6,$7::bigint,$8::boolean,$9::varchar) AS value',
        [
          owner,
          t,
          input.requestId,
          input.prompt,
          input.size,
          provider,
          seed,
          availability.ready,
          graphDigest,
        ],
      );
    } catch (problem) {
      if (
        problem instanceof AiImageError &&
        ([400, 403, 429].includes(problem.status) ||
          (problem.status === 503 && problem.code === 'ai_image_unavailable'))
      )
        throw new AiImageError('ai_image_not_admitted', problem.status, problem.message);
      throw problem;
    }
  }
  async create(owner: string, thread: string, raw: unknown): Promise<AiImageGenerationJob> {
    const j = await this.admit(owner, thread, raw);
    if (j.state === 'admitted') {
      const claimed = await this.value<boolean>('SELECT ai_image_dispatch($1,$2) AS value', [
        owner,
        j.request_id,
      ]);
      if (claimed) {
        // An uncertain CAS response never reaches this branch; this POST is never retried.
        try {
          await this.transport.dispatch(j.provider_id, j.prompt!, j.size, Number(j.seed), j.marker);
        } catch {
          /* durable submitting is reconciled by known UUID only */
        }
      }
    }
    return this.get(owner, j.thread_id, j.request_id);
  }
  async get(owner: string, thread: string, request: string): Promise<AiImageGenerationJob> {
    return imageJob(
      await this.value<ImageJobRow>('SELECT ai_image_get($1,$2,$3) AS value', [
        owner,
        imageId(thread),
        imageId(request),
      ]),
    );
  }
  async cancel(owner: string, thread: string, request: string): Promise<AiImageGenerationJob> {
    return imageJob(
      await this.value<ImageJobRow>('SELECT ai_image_cancel($1,$2,$3) AS value', [
        owner,
        imageId(thread),
        imageId(request),
      ]),
    );
  }
  async bytes(owner: string, thread: string, request: string): Promise<Buffer> {
    const j = await this.value<ImageJobRow>('SELECT ai_image_get($1,$2,$3) AS value', [
      owner,
      imageId(thread),
      imageId(request),
    ]);
    if (j.state !== 'complete' || j.cancel_requested || j.deleted_at)
      throw new AiImageError('ai_image_unavailable', 409, 'Изображение пока недоступно.');
    const bytes = await this.blobs().read(descriptor(j));
    if (!bytes) throw new AiImageError('ai_image_unavailable', 503, 'Изображение недоступно.');
    return bytes;
  }
  async acquireTransfer(owner: string): Promise<string> {
    const permit = randomUUID();
    if (
      !(await this.value<boolean>('SELECT ai_image_transfer($1,$2,true) AS value', [owner, permit]))
    )
      throw new AiImageError('ai_image_busy', 429, 'Дождитесь завершения скачивания.');
    return permit;
  }
  async releaseTransfer(owner: string, permit: string): Promise<void> {
    await this.value('SELECT ai_image_transfer($1,$2,false) AS value', [owner, permit]);
  }
  onModuleInit(): void {
    if (this.options.maintenance === false) return;
    this.timer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, 2500);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.sweeping?.catch(() => undefined);
    this.blobsValue?.close?.();
  }
  sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping;
    if (this.closing) return Promise.resolve();
    const p = this.one().finally(() => {
      this.sweeping = undefined;
    });
    this.sweeping = p;
    return p;
  }
  private async transition(
    j: ImageJobRow,
    lease: string,
    state: AiImageJobState,
    sha: string | null = null,
    bytes: number | null = null,
    error: string | null = null,
  ) {
    return this.value<boolean>(
      'SELECT ai_image_transition($1,$2,$3,$4::varchar,$5::varchar,$6::integer,$7::varchar) AS value',
      [j.owner_principal_id, j.request_id, lease, state, sha, bytes, error],
    );
  }
  private async one(): Promise<void> {
    const lease = randomUUID();
    const j = await this.value<ImageJobRow | null>('SELECT ai_image_claim($1) AS value', [lease]);
    if (!j) return;
    try {
      if (j.cleanup_required) {
        if (await this.blobs().remove(descriptor(j)))
          await this.value('SELECT ai_image_cleanup_done($1,$2,$3) AS value', [
            j.owner_principal_id,
            j.request_id,
            lease,
          ]);
        return;
      }
      if (j.state === 'storing') {
        if (await this.blobs().verify(descriptor(j))) await this.transition(j, lease, 'complete');
        else await this.transition(j, lease, 'storing');
        return;
      }
      const result = await this.transport.recover(j.provider_id, j.marker, j.size, j.graph_digest);
      if (result.state === 'missing') {
        await this.transition(j, lease, 'unknown');
        return;
      }
      if (result.state === 'failed') {
        await this.transition(
          j,
          lease,
          j.cancel_requested ? 'cancelled' : 'failed',
          null,
          null,
          'ai_image_provider_failed',
        );
        return;
      }
      if (result.state === 'pending' || result.state === 'running') {
        // Cancelling never interrupts shared GPU execution. Drain the exact job and suppress publication.
        await this.transition(j, lease, 'running');
        return;
      }
      if (!result.png) throw new Error('AI_IMAGE_BYTES_MISSING');
      if (j.cancel_requested || j.deleted_at) {
        await this.transition(j, lease, 'cancelled');
        return;
      }
      const png = result.png;
      const sha = createHash('sha256').update(png).digest('hex');
      if (!(await this.transition(j, lease, 'storing', sha, png.length))) {
        await this.transition(j, lease, 'cancelled');
        return;
      }
      const object = { ...j, sha256: sha, size_bytes: png.length };
      let directory: string | undefined;
      try {
        directory = await mkdtemp(join(tmpdir(), 'asa-generated-'));
        const path = join(directory, 'image.png');
        await writeFile(path, png, { flag: 'wx', mode: 0o600 });
        await this.blobs().putImmutable({
          ...descriptor(object),
          sourcePath: path,
          md5Base64: createHash('md5').update(png).digest('base64'),
        });
        await this.transition(object, lease, 'complete');
      } catch (e) {
        if (e instanceof AiAttachmentStorageError && e.outcome === 'not_written')
          await this.transition(
            object,
            lease,
            'failed',
            null,
            null,
            'ai_image_storage_rejected',
          ); /* unknown PUT stays storing; recovery only verifies */
      } finally {
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    } catch {
      /* Durable lease expires. Reconciliation never posts or repeats a PUT. */
    }
  }
}
