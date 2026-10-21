import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { AI_ATTACHMENT_LIMITS, AiAttachmentError, type AiAttachmentRecord } from './contracts.js';
import {
  describeAiAttachmentFile,
  validateAiAttachment,
  type ValidatedAiAttachment,
} from './validation.js';

export interface CapturedAiAttachment {
  path: string;
  md5Base64: string;
  validated: ValidatedAiAttachment;
  dispose(): Promise<void>;
}

/** HTTP owns one capture/error-response deadline. A validated EOF hands off
 * to the independent storage timeout, without extending the input budget. */
export interface AiAttachmentCaptureDeadline {
  signal: AbortSignal;
  captured(): void;
}

async function removeCapture(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (problem) {
    if ((problem as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new AiAttachmentError(
        'ai_attachment_unavailable',
        503,
        'Не удалось завершить очистку загрузки.',
      );
  }
}

export async function captureAiAttachment(
  source: AsyncIterable<Uint8Array>,
  record: AiAttachmentRecord,
  options: {
    tempRoot?: string | undefined;
    signal?: AbortSignal | undefined;
    deadline?: AiAttachmentCaptureDeadline | undefined;
  } = {},
): Promise<CapturedAiAttachment> {
  if (!record.fileName)
    throw new AiAttachmentError(
      'ai_attachment_not_ready',
      409,
      'Эта загрузка уже завершена или удалена.',
    );
  const file = describeAiAttachmentFile(record.fileName);
  const directory = join(options.tempRoot ?? tmpdir(), 'asa-ai-private-uploads');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${randomUUID()}.upload`);
  const timeout = new AbortController();
  const timer = options.deadline
    ? undefined
    : setTimeout(() => timeout.abort(), AI_ATTACHMENT_LIMITS.transferMilliseconds);
  timer?.unref();
  const signal = AbortSignal.any([
    options.deadline?.signal ?? timeout.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  const sha = createHash('sha256'),
    md5 = createHash('md5');
  let size = 0;
  let handle: FileHandle | undefined;
  // Destroy the actual native input on cancellation. Destroying only a
  // Readable.from(IncomingMessage) wrapper can leave its pending next alive.
  const onAbort = () => {
    if (source instanceof Readable) source.destroy();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    signal.throwIfAborted();
    // Await creation and every write; close before unlink on every failure.
    // An asynchronously opening WriteStream can otherwise recreate a file
    // after cleanup has already tried to remove it.
    handle = await open(path, 'wx', 0o600);
    signal.throwIfAborted();
    // Leaving a native HTTP iterator must neither wait for EOF nor destroy
    // its socket: the caller still has to flush a typed early error response.
    const input = source instanceof Readable ? source.iterator({ destroyOnReturn: false }) : source;
    for await (const chunk of input) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      if (!Number.isSafeInteger(size) || size > file.maxBytes || size > record.sizeBytes)
        throw new AiAttachmentError(
          'ai_attachment_too_large',
          413,
          'Файл превышает заявленный размер или лимит вложения.',
        );
      sha.update(chunk);
      md5.update(chunk);
      await handle.writeFile(chunk);
    }
    signal.throwIfAborted();
    await handle.close();
    handle = undefined;
    if (size !== record.sizeBytes || sha.digest('hex') !== record.sha256)
      throw new AiAttachmentError(
        'ai_attachment_identity_mismatch',
        400,
        'Размер или SHA-256 файла не совпадает с описанием загрузки.',
      );
    const validated = validateAiAttachment(await readFile(path, { signal }), record.fileName);
    if (
      validated.kind !== record.kind ||
      validated.mediaType !== record.mediaType ||
      validated.extension !== record.extension
    )
      throw new AiAttachmentError(
        'ai_attachment_identity_mismatch',
        400,
        'Тип файла не совпадает с описанием загрузки.',
      );
    signal.throwIfAborted();
    options.deadline?.captured();
    return {
      path,
      md5Base64: md5.digest('base64'),
      validated,
      dispose: async () => {
        await removeCapture(path);
      },
    };
  } catch (problem) {
    await handle?.close();
    await removeCapture(path);
    if (signal.aborted && !(problem instanceof AiAttachmentError && problem.status === 413))
      throw new AiAttachmentError(
        'ai_attachment_upload_interrupted',
        408,
        'Загрузка прервана. Проверьте её состояние.',
      );
    throw problem;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
