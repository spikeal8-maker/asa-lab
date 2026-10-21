import { randomUUID } from 'node:crypto';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type pg from 'pg';
import { readBlocksObjectStorageConfig } from '../blocks-asset-storage.js';
import {
  AI_ATTACHMENT_LIMITS,
  AiAttachmentError,
  attachmentId,
  attachmentReceipt,
  validateAttachmentDescriptor,
  type AiAttachmentRecord,
  type AiAttachmentReceipt,
} from './contracts.js';
import {
  AiAttachmentStorageError,
  S3AiAttachmentBlobStore,
  type AiAttachmentBlobStore,
} from './blob-store.js';
import {
  captureAiAttachment,
  type AiAttachmentCaptureDeadline,
  type CapturedAiAttachment,
} from './capture.js';
import {
  PgAiAttachmentStore,
  type AiAttachmentStore,
  type AttachmentClaimOutcome,
} from './store.js';
import { AiAttachmentValidationError, describeAiAttachmentFile } from './validation.js';

export interface AiAttachmentServiceOptions {
  store?: AiAttachmentStore;
  blobs?: AiAttachmentBlobStore;
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  maintenance?: boolean;
}

export interface AiAttachmentUploadLifecycle extends AiAttachmentCaptureDeadline {
  /** A native early error response still owns its admitted transfer slot. */
  rejected(problem: unknown): Promise<void>;
}

/** Private storage foundation. No provider is called here; readiness is not a
 * claim that the visible chat can send files or that a model supports Vision. */
export class AiAttachmentService implements OnModuleInit, OnModuleDestroy {
  private readonly store: AiAttachmentStore;
  private readonly env: NodeJS.ProcessEnv;
  private blobsValue: AiAttachmentBlobStore | undefined;
  private readonly transfers = new Map<string, number>();
  private totalTransfers = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private maintenancePromise: Promise<void> | undefined;
  private closing = false;
  constructor(
    private readonly pool: pg.Pool | null,
    private readonly options: AiAttachmentServiceOptions = {},
  ) {
    this.store = options.store ?? new PgAiAttachmentStore(pool);
    this.env = options.env ?? process.env;
    this.blobsValue = options.blobs;
  }
  private blobs(): AiAttachmentBlobStore {
    if (this.blobsValue) return this.blobsValue;
    try {
      return (this.blobsValue = new S3AiAttachmentBlobStore(
        readBlocksObjectStorageConfig(this.env),
      ));
    } catch {
      throw new AiAttachmentError(
        'ai_attachment_unavailable',
        503,
        'Хранилище вложений сейчас недоступно.',
      );
    }
  }
  onModuleInit(): void {
    if (this.options.maintenance === false || !this.pool || !this.env.ASA_OBJECT_STORAGE_ENDPOINT)
      return;
    // One bounded API-process loop, using durable SKIP LOCKED leases. No new
    // daemon/service, global object listing, startup upload or identity repair.
    this.timer = setInterval(() => {
      void this.sweep().catch(() => undefined);
    }, AI_ATTACHMENT_LIMITS.maintenanceMilliseconds);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    // Closing the SDK interrupts owned sockets. Unfinished receipts stay held
    // and are reconciled after the next process starts.
    this.blobsValue?.close?.();
    await this.maintenancePromise?.catch(() => undefined);
  }
  private async transfer<T>(owner: string, work: () => Promise<T>): Promise<T> {
    const active = this.transfers.get(owner) ?? 0;
    if (
      this.closing ||
      active >= AI_ATTACHMENT_LIMITS.concurrentPerOwner ||
      this.totalTransfers >= AI_ATTACHMENT_LIMITS.concurrentTransfers
    )
      throw new AiAttachmentError(
        'ai_attachment_busy',
        429,
        'Загружается слишком много файлов. Подождите завершения текущей загрузки.',
      );
    this.transfers.set(owner, active + 1);
    this.totalTransfers += 1;
    try {
      return await work();
    } finally {
      this.totalTransfers -= 1;
      const left = (this.transfers.get(owner) ?? 1) - 1;
      if (left) this.transfers.set(owner, left);
      else this.transfers.delete(owner);
    }
  }
  async reserve(owner: string, raw: unknown): Promise<AiAttachmentReceipt> {
    const descriptor = validateAttachmentDescriptor(raw),
      file = describeAiAttachmentFile(descriptor.fileName);
    if (descriptor.sizeBytes > file.maxBytes)
      throw new AiAttachmentError('ai_attachment_too_large', 413, 'Файл превышает лимит вложения.');
    this.blobs(); // Fail closed before creating a reservation on an unconfigured installation.
    return attachmentReceipt(await this.store.reserve(owner, descriptor, file));
  }
  async get(owner: string, upload: string): Promise<AiAttachmentReceipt> {
    return attachmentReceipt(await this.store.get(owner, attachmentId(upload)));
  }
  async upload(
    owner: string,
    upload: string,
    source: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
    lifecycle?: AiAttachmentUploadLifecycle,
  ): Promise<AiAttachmentReceipt> {
    const id = attachmentId(upload);
    return this.transfer(owner, async () => {
      const prior = await this.store.get(owner, id);
      if (['deleted', 'failed', 'deleting'].includes(prior.state) || prior.deleteRequested)
        throw new AiAttachmentError(
          'ai_attachment_not_ready',
          409,
          'Эта загрузка уже завершена или удаляется.',
        );
      let captured: CapturedAiAttachment | undefined;
      try {
        try {
          captured = await captureAiAttachment(source, prior, {
            tempRoot: this.options.tempRoot,
            signal,
            deadline: lifecycle,
          });
        } catch (problem) {
          if (
            problem instanceof AiAttachmentValidationError ||
            problem instanceof AiAttachmentError
          )
            await this.store.reject(owner, id).catch(() => undefined);
          throw problem;
        }
        // Repeated PUT bodies are still bounded and checked against the exact
        // immutable descriptor. They never launch another storage write; GET
        // receipt/reconcile is the intended recovery after an uncertain PUT.
        if (prior.state !== 'reserved') return attachmentReceipt(await this.store.get(owner, id));
        const attempt = randomUUID(),
          record = await this.store.begin(owner, id, attempt, captured.validated);
        if (record.state !== 'uploading' || record.attemptId !== attempt)
          return attachmentReceipt(record);
        let outcome: 'persisted' | 'not_written' | 'unknown' | 'integrity' = 'persisted';
        try {
          await this.blobs().putImmutable({
            ...record,
            sourcePath: captured.path,
            md5Base64: captured.md5Base64,
          });
        } catch (problem) {
          outcome = problem instanceof AiAttachmentStorageError ? problem.outcome : 'unknown';
        }
        // A DB failure after S3 must propagate. The durable uploading receipt
        // and quota remain; the later reconciler can discover persisted bytes.
        return attachmentReceipt(await this.store.finish(owner, id, attempt, outcome));
      } catch (problem) {
        await lifecycle?.rejected(problem);
        throw problem;
      } finally {
        await captured?.dispose();
      }
    });
  }
  async read(
    owner: string,
    upload: string,
  ): Promise<{ receipt: AiAttachmentReceipt; bytes: Buffer }> {
    return this.withRead(owner, upload, async (file) => file);
  }
  /** Keep the byte buffer inside the transfer budget until its consumer has
   * finished. An HTTP response awaiting socket backpressure still owns it. */
  async withRead<T>(
    owner: string,
    upload: string,
    consume: (file: { receipt: AiAttachmentReceipt; bytes: Buffer }) => Promise<T>,
  ): Promise<T> {
    return this.transfer(owner, async () => {
      const record = await this.store.get(owner, attachmentId(upload));
      if (!['ready', 'bound'].includes(record.state) || record.deleteRequested)
        throw new AiAttachmentError(
          'ai_attachment_not_ready',
          409,
          'Вложение пока недоступно для чтения.',
        );
      if (record.state === 'ready' && new Date(record.expiresAt).getTime() <= Date.now())
        throw new AiAttachmentError(
          'ai_attachment_expired',
          410,
          'Срок хранения неотправленного вложения истёк.',
        );
      let bytes: Buffer | null;
      try {
        bytes = await this.blobs().read(record);
      } catch {
        throw new AiAttachmentError(
          'ai_attachment_unavailable',
          503,
          'Не удалось проверить содержимое файла.',
        );
      }
      if (!bytes)
        throw new AiAttachmentError(
          'ai_attachment_unavailable',
          503,
          'Сохранённый файл сейчас недоступен.',
        );
      // Deletion may have committed while the object body was being read. Do
      // not disclose the captured bytes after that ownership/state decision.
      const latest = await this.store.get(owner, record.uploadId);
      if (!['ready', 'bound'].includes(latest.state) || latest.deleteRequested)
        throw new AiAttachmentError('ai_attachment_not_ready', 409, 'Вложение удаляется.');
      if (latest.state === 'ready' && new Date(latest.expiresAt).getTime() <= Date.now())
        throw new AiAttachmentError(
          'ai_attachment_expired',
          410,
          'Срок хранения неотправленного вложения истёк.',
        );
      return consume({ receipt: attachmentReceipt(latest), bytes });
    });
  }
  async remove(owner: string, upload: string): Promise<AiAttachmentReceipt> {
    const id = attachmentId(upload);
    await this.store.remove(owner, id);
    return this.reconcile(owner, id);
  }
  private async processClaim(record: AiAttachmentRecord): Promise<void> {
    if (!record.leaseId) return;
    let outcome: AttachmentClaimOutcome = 'unknown';
    try {
      if (record.state === 'deleting')
        outcome = (await this.blobs().remove(record)) ? 'deleted' : 'unknown';
      else if (record.state === 'unknown' && (await this.blobs().verify(record)))
        outcome = 'persisted';
      // HEAD 404 after an uncertain PUT cannot prove that a late PUT will not
      // commit. Keep the unknown receipt and byte reservation, never re-PUT.
    } catch (problem) {
      if (problem instanceof AiAttachmentStorageError && problem.outcome === 'integrity')
        outcome = 'integrity';
    }
    await this.store.finishClaim(record.ownerId, record.uploadId, record.leaseId, outcome);
  }
  async reconcile(owner: string, upload: string): Promise<AiAttachmentReceipt> {
    const id = attachmentId(upload);
    return this.transfer(owner, async () => {
      const claim = await this.store.claim(owner, id);
      if (claim) await this.processClaim(claim);
      return attachmentReceipt(await this.store.get(owner, id));
    });
  }
  sweep(): Promise<void> {
    if (this.maintenancePromise) return this.maintenancePromise;
    if (this.closing) return Promise.resolve();
    const work = (async () => {
      const claims = await this.store.claimBatch(AI_ATTACHMENT_LIMITS.maintenanceBatch);
      // Two operations at a time; SQL claims are durable and bounded to eight.
      for (let index = 0; !this.closing && index < claims.length; index += 2)
        await Promise.allSettled(
          claims
            .slice(index, index + 2)
            .map((claim) => this.transfer(claim.ownerId, () => this.processClaim(claim))),
        );
    })();
    this.maintenancePromise = work.finally(() => {
      this.maintenancePromise = undefined;
    });
    return this.maintenancePromise;
  }
}
