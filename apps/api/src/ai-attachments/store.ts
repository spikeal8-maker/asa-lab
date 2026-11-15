import type pg from 'pg';
import {
  AiAttachmentError,
  type AiAttachmentDescriptor,
  type AiAttachmentRecord,
} from './contracts.js';
import type { AiAttachmentFileDescription, ValidatedAiAttachment } from './validation.js';

export type AttachmentWriteOutcome = 'persisted' | 'not_written' | 'unknown' | 'integrity';
export type AttachmentClaimOutcome = 'persisted' | 'deleted' | 'unknown' | 'integrity';

export interface AiAttachmentStore {
  reserve(
    owner: string,
    descriptor: AiAttachmentDescriptor,
    file: AiAttachmentFileDescription,
  ): Promise<AiAttachmentRecord>;
  get(owner: string, upload: string): Promise<AiAttachmentRecord>;
  begin(
    owner: string,
    upload: string,
    attempt: string,
    validated: ValidatedAiAttachment,
  ): Promise<AiAttachmentRecord>;
  finish(
    owner: string,
    upload: string,
    attempt: string,
    outcome: AttachmentWriteOutcome,
  ): Promise<AiAttachmentRecord>;
  reject(owner: string, upload: string): Promise<AiAttachmentRecord>;
  remove(owner: string, upload: string): Promise<AiAttachmentRecord>;
  claim(owner: string, upload: string): Promise<AiAttachmentRecord | null>;
  claimBatch(limit: number): Promise<AiAttachmentRecord[]>;
  finishClaim(
    owner: string,
    upload: string,
    lease: string,
    outcome: AttachmentClaimOutcome,
  ): Promise<AiAttachmentRecord>;
}

function storageSqlError(problem: unknown): never {
  const message = problem instanceof Error ? problem.message : '';
  const mapping: Array<[string, string, number, string]> = [
    ['AI_ATTACHMENT_NOT_FOUND', 'ai_attachment_not_found', 404, 'Вложение не найдено.'],
    [
      'AI_ATTACHMENT_ID_REUSED',
      'ai_attachment_id_reused',
      409,
      'Этот идентификатор уже относится к другому файлу.',
    ],
    [
      'AI_ATTACHMENT_QUOTA',
      'ai_attachment_quota',
      409,
      'Достигнут лимит вложений. Удалите ненужные файлы.',
    ],
    ['AI_ATTACHMENT_BOUND', 'ai_attachment_bound', 409, 'Вложение уже сохранено в сообщении.'],
    [
      'AI_ATTACHMENT_NOT_READY',
      'ai_attachment_not_ready',
      409,
      'Вложение ещё не готово к отправке.',
    ],
    [
      'AI_ATTACHMENT_EXPIRED',
      'ai_attachment_expired',
      410,
      'Срок хранения неотправленного вложения истёк.',
    ],
    ['AI_ATTACHMENT_INVALID', 'ai_attachment_invalid', 400, 'Проверьте описание вложения.'],
    [
      'AI_STUDENT_DENIED',
      'ai_student_denied',
      403,
      'Преподаватель пока не разрешил этот школьный чат.',
    ],
    ['AI_SCOPE_DENIED', 'ai_scope_denied', 403, 'Этот контекст чата недоступен.'],
    ['AI_SOURCE_DENIED', 'ai_source_denied', 404, 'Исходный вопрос недоступен.'],
    [
      'AI_REQUEST_ID_REUSED',
      'ai_request_id_reused',
      409,
      'Этот запрос уже использован с другими данными.',
    ],
  ];
  for (const [marker, code, status, copy] of mapping) {
    if (message.includes(marker)) throw new AiAttachmentError(code, status, copy);
  }
  // PostgreSQL constraint details can contain the failing private row. Never
  // pass an unknown database error (or its cause) into the global HTTP logger.
  throw new AiAttachmentError(
    'ai_attachment_unavailable',
    503,
    'Не удалось проверить состояние вложения.',
  );
}

export class PgAiAttachmentStore implements AiAttachmentStore {
  constructor(private readonly pool: pg.Pool | null) {}
  private async values<T>(sql: string, params: unknown[]): Promise<T[]> {
    if (!this.pool)
      throw new AiAttachmentError(
        'ai_attachment_unavailable',
        503,
        'Хранилище вложений сейчас недоступно.',
      );
    try {
      return (await this.pool.query<{ value: T }>(sql, params)).rows.map((row) => row.value);
    } catch (problem) {
      return storageSqlError(problem);
    }
  }
  private async value<T>(sql: string, params: unknown[]): Promise<T> {
    const values = await this.values<T>(sql, params);
    if (values.length !== 1 || values[0] === undefined)
      throw new AiAttachmentError(
        'ai_attachment_unavailable',
        503,
        'Не удалось проверить состояние вложения.',
      );
    return values[0];
  }
  reserve(
    owner: string,
    descriptor: AiAttachmentDescriptor,
    file: AiAttachmentFileDescription,
  ): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_reserve($1,$2,$3,$4,$5,$6,$7,$8) AS value', [
      owner,
      descriptor.uploadId,
      descriptor.fileName,
      descriptor.sizeBytes,
      descriptor.sha256,
      file.extension,
      file.mediaType,
      file.kind,
    ]);
  }
  get(owner: string, upload: string): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_get($1,$2) AS value', [owner, upload]);
  }
  begin(
    owner: string,
    upload: string,
    attempt: string,
    validated: ValidatedAiAttachment,
  ): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_begin_upload($1,$2,$3,$4,$5,$6) AS value', [
      owner,
      upload,
      attempt,
      validated.width,
      validated.height,
      validated.text,
    ]);
  }
  finish(
    owner: string,
    upload: string,
    attempt: string,
    outcome: AttachmentWriteOutcome,
  ): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_finish_upload($1,$2,$3,$4) AS value', [
      owner,
      upload,
      attempt,
      outcome,
    ]);
  }
  reject(owner: string, upload: string): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_reject($1,$2) AS value', [owner, upload]);
  }
  remove(owner: string, upload: string): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_remove($1,$2) AS value', [owner, upload]);
  }
  claim(owner: string, upload: string): Promise<AiAttachmentRecord | null> {
    return this.value('SELECT ai_attachment_claim($1,$2) AS value', [owner, upload]);
  }
  claimBatch(limit: number): Promise<AiAttachmentRecord[]> {
    return this.values('SELECT ai_attachment_claim_batch($1) AS value', [limit]);
  }
  finishClaim(
    owner: string,
    upload: string,
    lease: string,
    outcome: AttachmentClaimOutcome,
  ): Promise<AiAttachmentRecord> {
    return this.value('SELECT ai_attachment_finish_claim($1,$2,$3,$4) AS value', [
      owner,
      upload,
      lease,
      outcome,
    ]);
  }

  /** Future visible Send integration must call this SQL admission atomically;
   * never attach files after invoking the existing text-only send path. */
  beginMessage(
    owner: string,
    thread: string,
    request: string,
    text: string,
    expectedVersion: number,
    uploads: string[],
  ): Promise<boolean> {
    return this.value('SELECT ai_attachment_begin_message($1,$2,$3,$4,$5,$6::uuid[]) AS value', [
      owner,
      thread,
      request,
      text,
      expectedVersion,
      uploads,
    ]);
  }
  requestSource(
    owner: string,
    thread: string,
    request: string,
  ): Promise<{ sourceUserMessageId: string; items: AiAttachmentRecord[] }> {
    return this.value('SELECT ai_attachment_request_source($1,$2,$3) AS value', [
      owner,
      thread,
      request,
    ]);
  }
}
