import { AiAttachmentError } from './contracts.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { AiAttachmentValidationError, type ValidatedAiAttachment } from './validation.js';

export const DOCUMENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
let active = 0;
export async function readDocument(
  bytes: Buffer,
  extension: string,
  signal: AbortSignal,
): Promise<ValidatedAiAttachment> {
  if (!Object.hasOwn(DOCUMENT_TYPES, extension) || bytes.length > 8 * 1024 * 1024 || !bytes.length)
    throw new AiAttachmentValidationError('ai_attachment_format_unsupported', 415);
  if (
    extension === 'pdf'
      ? bytes.subarray(0, 5).toString() !== '%PDF-'
      : bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50
  )
    throw new AiAttachmentValidationError('ai_attachment_format_unsupported', 415);
  if (active >= 2) throw new Error('Обработка документов занята. Повторите отправку позже.');
  signal.throwIfAborted();
  active += 1;
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.platform === 'win32' ? 'python' : '/opt/asa-document-python/bin/python',
        ['-I', join(__dirname, 'document-reader.py'), extension],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
      );
      const chunks: Buffer[] = [];
      let size = 0;
      const stop = () => {
        child.kill('SIGKILL');
        reject(new Error('Чтение документа прервано или превысило 15 секунд.'));
      };
      const timer = setTimeout(stop, 15000);
      signal.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) stop();
        else chunks.push(chunk);
      });
      child.stdin.on('error', () => undefined);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { text?: string };
          if (
            code !== 0 ||
            !result.text ||
            Buffer.byteLength(result.text) > 524288 ||
            [...result.text].length > 200000
          )
            throw new Error(
              'Документ не прочитан полностью: повреждён, защищён, превышает лимит или требует OCR.',
            );
          resolve(result.text);
        } catch {
          reject(
            new Error(
              'Документ не прочитан полностью: повреждён, защищён, превышает лимит или требует OCR.',
            ),
          );
        }
      });
      child.stdin.end(bytes);
    });
    return {
      kind: 'text',
      mediaType: DOCUMENT_TYPES[extension]!,
      extension,
      width: null,
      height: null,
      text,
    };
  } catch (error) {
    if (error instanceof AiAttachmentError) throw error;
    throw new AiAttachmentError(
      'ai_document_unreadable',
      422,
      'Документ не прочитан полностью: повреждён, защищён, превышает лимит или требует OCR.',
    );
  } finally {
    active -= 1;
  }
}
