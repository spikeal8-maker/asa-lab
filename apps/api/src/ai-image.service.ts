import {
  AI_IMAGE_PRESETS,
  AI_IMAGE_RECIPES,
  type AiImageRecipe,
  aiImageDimensions,
  isAiImageSize,
  type AiImageStoredSize,
} from '@asa-lab/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type pg from 'pg';
import { AiToolPolicyService } from './ai-tool-policy.js';
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
import { comfyUiRuntimeOrigin } from './ai-comfyui-settings.js';
import {
  AiImageWorkerDiagnostics,
  type AiImageWorkerLog,
  type AiImageWorkerStage,
} from './ai-image-worker-diagnostics.js';
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
  recipe: AiImageRecipe;
  graph_digest: string;
  owner_principal_id: string;
  request_id: string;
  thread_id: string;
  provider_id: string;
  marker: string;
  seed: number;
  prompt: string | null;
  size: AiImageStoredSize;
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
  queue_paused?: boolean;
  /** Transient SQL result flag, never a persisted/public receipt property. */
  fresh_admission?: boolean;
}
interface ImageConfig extends Omit<AiImageGenerationAdminConfig, 'ready' | 'reason'> {
  remainingToday?: number;
}
export interface AiImageServiceOptions {
  transport?: Pick<ComfyImageTransport, 'readiness' | 'dispatch' | 'recover' | 'cancelPending'>;
  blobs?: AiAttachmentBlobStore;
  env?: NodeJS.ProcessEnv;
  maintenance?: boolean;
  workerLog?: AiImageWorkerLog;
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
    !isAiImageSize(p.size) ||
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
    (p.recipe !== undefined && !AI_IMAGE_RECIPES.includes(p.recipe)) ||
    typeof p.enabled !== 'boolean' ||
    !Number.isSafeInteger(p.dailyLimit) ||
    p.dailyLimit < 1 ||
    p.dailyLimit > 100 ||
    !Number.isSafeInteger(p.globalConcurrency) ||
    p.globalConcurrency < 1 ||
    p.globalConcurrency > 1 ||
    !Array.isArray(p.sizes) ||
    p.sizes.length < 1 ||
    p.sizes.length > AI_IMAGE_PRESETS.length ||
    new Set(p.sizes).size !== p.sizes.length ||
    p.sizes.some((v) => !isAiImageSize(v))
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
    ...(p.recipe === undefined ? {} : { recipe: p.recipe }),
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
    ...aiImageDimensions(j.size),
    mimeType: 'image/png',
    sizeBytes: j.size_bytes!,
    downloadUrl: `/api/ai/threads/${j.thread_id}/image-generations/${j.request_id}/image`,
  };
}
export function imageJob(j: ImageJobRow): AiImageGenerationJob {
  return {
    recipe: j.recipe,
    size: j.size,
    requestId: j.request_id,
    threadId: j.thread_id,
    state: j.state,
    prompt: j.prompt ?? '',
    createdAt: new Date(j.created_at).toISOString(),
    cancelRequested: j.cancel_requested,
    errorCode: j.error_code,
    queuePaused: j.queue_paused === true,
    image: j.state === 'complete' && !j.cancel_requested && !j.deleted_at ? image(j) : null,
  };
}
/** One dispatch CAS, one provider POST, one immutable object PUT. Recovery only reads. */
export class AiImageService implements OnModuleInit, OnModuleDestroy {
  private readonly toolPolicy: AiToolPolicyService;
  private readonly transport: AiImageServiceOptions['transport'];
  private blobsValue: AiAttachmentBlobStore | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sweeping: Promise<void> | undefined;
  private closing = false;
  private readonly diagnostics: AiImageWorkerDiagnostics;
  constructor(
    private readonly pool: pg.Pool,
    private readonly options: AiImageServiceOptions = {},
  ) {
    this.toolPolicy = new AiToolPolicyService(pool);
    this.transport = options.transport;
    this.blobsValue = options.blobs;
    this.env = options.env ?? process.env;
    this.diagnostics = new AiImageWorkerDiagnostics(options.workerLog);
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
      if (/AI_IMAGE_OWNER_QUEUE_FULL/.test(m))
        throw new AiImageError(
          'ai_image_owner_queue_full',
          429,
          'У вас уже два незавершённых задания. Дождитесь результата или отмените задание в очереди.',
        );
      if (/AI_IMAGE_QUEUE_FULL/.test(m))
        throw new AiImageError(
          'ai_image_queue_full',
          429,
          'Очередь изображений заполнена. Подождите освобождения места.',
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
          'Сервис генерации или приватное хранилище недоступны.',
        );
      if (/AI_IMAGE_DISABLED/.test(m))
        throw new AiImageError('ai_image_disabled', 403, 'Генерация изображений выключена.');
      throw e;
    }
  }
  private async readiness(recipe: AiImageRecipe = 'flux2-klein-4b-v1') {
    try {
      this.blobs();
      return await (await this.provider()).readiness(recipe);
    } catch {
      return { ready: false, reason: 'Приватное хранилище изображений недоступно.' };
    }
  }
  private async provider() {
    return (
      this.transport ??
      new ComfyImageTransport({ baseUrl: await comfyUiRuntimeOrigin(this.pool, this.env) })
    );
  }
  async status(owner: string): Promise<AiImageGenerationStatus> {
    const c = await this.value<ImageConfig>('SELECT ai_image_status($1) AS value', [owner]);
    const r = await this.readiness(c.recipe);
    return {
      recipe: c.recipe,
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
    return { ...c, ...(await this.readiness(c.recipe)) };
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
      if (!(await this.toolPolicy.manualImageAllowed(owner, t, input.requestId)))
        throw new AiImageError(
          'ai_image_disabled',
          409,
          'Создание изображений выключено администратором.',
        );
      const c = await this.value<ImageConfig>('SELECT ai_image_config() AS value');
      const availability = await this.readiness(c.recipe);
      const provider = randomUUID();
      const seed = randomBytes(4).readUInt32BE();
      const graphDigest = imageWorkflowDigest(
        input.prompt,
        input.size,
        seed,
        'ASA_' + provider.replaceAll('-', ''),
        c.recipe,
      );
      // Replay must succeed even after provider/storage configuration changed.
      return await this.value<ImageJobRow>(
        'SELECT ai_image_begin($1,$2,$3,$4,$5::integer,$6,$7::bigint,$8::boolean,$9::varchar,$10::varchar) AS value',
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
          c.recipe,
        ],
      );
    } catch (problem) {
      if (
        problem instanceof AiImageError &&
        ([400, 403, 429].includes(problem.status) ||
          (problem.status === 409 && problem.code === 'ai_image_disabled') ||
          (problem.status === 503 && problem.code === 'ai_image_unavailable'))
      )
        throw new AiImageError('ai_image_not_admitted', problem.status, problem.message);
      throw problem;
    }
  }
  async create(owner: string, thread: string, raw: unknown): Promise<AiImageGenerationJob> {
    if (raw && typeof raw === 'object' && (raw as { size?: unknown }).size === 512) {
      // 512 is receipt-only. Prove the existing owner-bound job before parsing its old intent;
      // SQL compares the original immutable payload digest, including size and thread.
      const input = imageInput({ ...raw, size: 768 });
      const t = imageId(thread);
      const existing = await this.value<ImageJobRow>('SELECT ai_image_get($1,$2,$3) AS value', [
        owner,
        t,
        input.requestId,
      ]);
      await this.value(
        'SELECT ai_image_begin($1,$2,$3,$4,$5::integer,$6,$7::bigint,false,$8::varchar) AS value',
        [
          owner,
          t,
          input.requestId,
          input.prompt,
          512,
          existing.provider_id,
          Number(existing.seed),
          existing.graph_digest,
        ],
      );
      // Even an admitted legacy job resumes through the worker, never a replay POST.
      return this.get(owner, t, input.requestId);
    }
    const j = await this.admit(owner, thread, raw);
    if (j.fresh_admission === true) await this.dispatchAdmitted(j);
    return this.get(owner, j.thread_id, j.request_id);
  }
  private async dispatchAdmitted(j: ImageJobRow, attemptId = randomUUID()): Promise<void> {
    if (j.state === 'admitted') {
      const claimed = await this.value<boolean>('SELECT ai_image_dispatch($1,$2) AS value', [
        j.owner_principal_id,
        j.request_id,
      ]);
      if (claimed) {
        // An uncertain CAS response never reaches this branch; this POST is never retried.
        let stage: AiImageWorkerStage = 'provider_configuration';
        try {
          const provider = await this.provider();
          stage = 'dispatch';
          await provider.dispatch(
            j.provider_id,
            j.prompt!,
            j.size,
            Number(j.seed),
            j.marker,
            j.recipe,
          );
        } catch (problem) {
          this.diagnostics.report(stage, j.request_id, attemptId, problem);
          /* durable submitting is reconciled by known UUID only */
        }
      }
    }
  }
  async createFromTool(
    owner: string,
    thread: string,
    parent: string,
    prompt: string,
    size: AiImageSize,
    signal: AbortSignal,
    requestedRecipe?: AiImageRecipe,
  ): Promise<AiImageGenerationJob> {
    const input = imageInput({ requestId: randomUUID(), prompt, size });
    if (signal.aborted) throw new AiImageError('ai_image_cancelled', 409, 'Запрос остановлен.');
    const c = await this.value<ImageConfig>('SELECT ai_image_config() AS value');
    const recipe = requestedRecipe ?? c.recipe;
    const availability = await this.readiness(recipe);
    const provider = randomUUID(),
      seed = randomBytes(4).readUInt32BE();
    const digest = imageWorkflowDigest(
      input.prompt,
      input.size,
      seed,
      'ASA_' + provider.replaceAll('-', ''),
      recipe,
    );
    const j = await this.value<ImageJobRow>(
      'SELECT ai_tool_image_begin($1,$2,$3,$4,$5::varchar,$6::integer,$7,$8::bigint,$9::boolean,$10::varchar,$11::varchar) AS value',
      [
        owner,
        imageId(thread),
        imageId(parent),
        input.requestId,
        input.prompt,
        input.size,
        provider,
        seed,
        availability.ready,
        digest,
        recipe,
      ],
    );
    const cancel = () => {
      void this.cancel(owner, thread, j.request_id).catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (signal.aborted) await this.cancel(owner, thread, j.request_id);
      // The native SQL receipt may be a replay. Only the durable worker dispatches;
      // repeating a tool call never becomes a provider POST.
      return await this.get(owner, thread, j.request_id);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  async nativeSchemaReady(): Promise<boolean> {
    const result = await this.pool.query<{ ready: boolean }>(
      "SELECT to_regprocedure('public.ai_tool_image_begin(uuid,uuid,uuid,uuid,character varying,integer,uuid,bigint,boolean,character varying)') IS NOT NULL AND to_regprocedure('public.ai_tool_request_options(uuid,uuid,uuid,jsonb,boolean)') IS NOT NULL AS ready",
    );
    return result.rows[0]?.ready === true;
  }
  async replayTool(
    owner: string,
    thread: string,
    parent: string,
  ): Promise<AiImageGenerationJob | null> {
    const j = await this.value<ImageJobRow | null>(
      'SELECT ai_tool_image_receipt($1,$2,$3) AS value',
      [owner, imageId(thread), imageId(parent)],
    );
    if (!j) return null;
    // GET-only reconciliation belongs to the worker; a replay never retries GPU submission.
    return this.get(owner, thread, j.request_id);
  }
  async pendingTools(owner: string, thread: string): Promise<readonly AiImageGenerationJob[]> {
    const rows = await this.value<readonly ImageJobRow[]>(
      'SELECT ai_tool_image_pending($1,$2) AS value',
      [owner, imageId(thread)],
    );
    return rows.map(imageJob);
  }
  toolContext(owner: string, thread: string): Promise<unknown> {
    return this.value('SELECT ai_tool_image_context($1,$2) AS value', [owner, imageId(thread)]);
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
    this.diagnostics.health(true);
    this.blobsValue?.close?.();
  }
  sweep(): Promise<void> {
    if (this.sweeping) return this.sweeping;
    if (this.closing) return Promise.resolve();
    const p = this.one().finally(() => {
      this.diagnostics.health();
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
    const attemptId = randomUUID();
    let j: ImageJobRow | null;
    try {
      j = await this.value<ImageJobRow | null>('SELECT ai_image_claim($1) AS value', [lease]);
    } catch (problem) {
      this.diagnostics.report('claim', null, attemptId, problem);
      throw problem;
    }
    if (!j) return;
    let stage: AiImageWorkerStage = 'cleanup_remove';
    try {
      if (j.cleanup_required) {
        if (await this.blobs().remove(descriptor(j))) {
          stage = 'cleanup_ack';
          await this.value('SELECT ai_image_cleanup_done($1,$2,$3) AS value', [
            j.owner_principal_id,
            j.request_id,
            lease,
          ]);
        }
        return;
      }
      if (j.state === 'admitted') {
        stage = 'dispatch_claim';
        await this.dispatchAdmitted(j, attemptId);
        return;
      }
      if (j.state === 'storing') {
        stage = 'storage_verify';
        const verified = await this.blobs().verify(descriptor(j));
        stage = 'transition';
        if (verified) await this.transition(j, lease, 'complete');
        else await this.transition(j, lease, 'storing');
        return;
      }
      stage = 'provider_configuration';
      const provider = await this.provider();
      stage = 'recover';
      const result = await provider.recover(
        j.provider_id,
        j.marker,
        j.size,
        j.graph_digest,
        j.recipe,
      );
      stage = 'transition';
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
      stage = 'output_validate';
      if (!result.png) throw new Error('AI_IMAGE_BYTES_MISSING');
      stage = 'transition';
      if (j.cancel_requested || j.deleted_at) {
        await this.transition(j, lease, 'cancelled');
        return;
      }
      const png = result.png;
      stage = 'output_validate';
      const sha = createHash('sha256').update(png).digest('hex');
      stage = 'transition';
      if (!(await this.transition(j, lease, 'storing', sha, png.length))) {
        await this.transition(j, lease, 'cancelled');
        return;
      }
      const object = { ...j, sha256: sha, size_bytes: png.length };
      let directory: string | undefined;
      try {
        stage = 'storage_prepare';
        directory = await mkdtemp(join(tmpdir(), 'asa-generated-'));
        const path = join(directory, 'image.png');
        await writeFile(path, png, { flag: 'wx', mode: 0o600 });
        stage = 'storage_put';
        await this.blobs().putImmutable({
          ...descriptor(object),
          sourcePath: path,
          md5Base64: createHash('md5').update(png).digest('base64'),
        });
        stage = 'transition';
        await this.transition(object, lease, 'complete');
      } catch (e) {
        this.diagnostics.report(stage, j.request_id, attemptId, e);
        if (e instanceof AiAttachmentStorageError && e.outcome === 'not_written') {
          stage = 'transition';
          await this.transition(object, lease, 'failed', null, null, 'ai_image_storage_rejected');
        } /* unknown PUT stays storing; recovery only verifies */
      } finally {
        if (directory) {
          await rm(directory, { recursive: true, force: true }).catch((problem: unknown) => {
            stage = 'storage_cleanup';
            throw problem;
          });
        }
      }
    } catch (problem) {
      this.diagnostics.report(stage, j.request_id, attemptId, problem);
      /* Durable lease expires. Reconciliation never posts or repeats a PUT. */
    }
  }
}
