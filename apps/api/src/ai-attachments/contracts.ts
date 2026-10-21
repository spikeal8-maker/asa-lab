export const AI_ATTACHMENT_LIMITS = Object.freeze({
  ownerBytes: 100 * 1024 * 1024,
  ownerObjects: 100,
  pendingObjects: 20,
  messageObjects: 4,
  messageBytes: 20 * 1024 * 1024,
  transferMilliseconds: 30_000,
  storageMilliseconds: 15_000,
  concurrentPerOwner: 2,
  concurrentTransfers: 8,
  maintenanceBatch: 8,
  maintenanceMilliseconds: 60_000,
});

export type AiAttachmentState =
  'reserved' | 'uploading' | 'unknown' | 'ready' | 'bound' | 'deleting' | 'deleted' | 'failed';

export interface AiAttachmentDescriptor {
  uploadId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface AiAttachmentReceipt {
  uploadId: string;
  fileName: string | null;
  sizeBytes: number;
  sha256: string;
  mediaType: string;
  kind: 'image' | 'text';
  state: AiAttachmentState;
  width: number | null;
  height: number | null;
  createdAt: string;
  expiresAt: string;
  deleteRequested: boolean;
  errorCode: string | null;
}

/** Internal persistence result. Never serialize this object to an HTTP reply. */
export interface AiAttachmentRecord extends AiAttachmentReceipt {
  ownerId: string;
  extension: string;
  text: string | null;
  attemptId: string | null;
  leaseId: string | null;
  held: boolean;
}

export function attachmentReceipt(record: AiAttachmentRecord): AiAttachmentReceipt {
  return {
    uploadId: record.uploadId,
    fileName: record.fileName,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    mediaType: record.mediaType,
    kind: record.kind,
    state: record.state,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    deleteRequested: record.deleteRequested,
    errorCode: record.errorCode,
  };
}

export class AiAttachmentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function attachmentId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AiAttachmentError('ai_attachment_invalid', 400, 'Неверный идентификатор вложения.');
  return value.toLowerCase();
}

export function validateAttachmentDescriptor(value: unknown): AiAttachmentDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AiAttachmentError('ai_attachment_invalid', 400, 'Проверьте описание файла.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !['uploadId', 'fileName', 'sizeBytes', 'sha256'].includes(key),
    ) ||
    typeof input.fileName !== 'string' ||
    !Number.isSafeInteger(input.sizeBytes) ||
    Number(input.sizeBytes) < 1 ||
    typeof input.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.sha256)
  )
    throw new AiAttachmentError(
      'ai_attachment_invalid',
      400,
      'Проверьте имя, размер и SHA-256 файла.',
    );
  return {
    uploadId: attachmentId(input.uploadId),
    fileName: input.fileName,
    sizeBytes: Number(input.sizeBytes),
    sha256: input.sha256,
  };
}
