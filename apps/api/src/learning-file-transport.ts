import type { FastifyInstance } from 'fastify';
import { HttpException } from '@nestjs/common';
import { addAbortSignal, Readable } from 'node:stream';
import { validateLearningArchive, validateLearningStl } from './learning-file-containers.js';
import { validateAttachmentImageStructure } from './ai-attachments/validation.js';

export const LEARNING_FILE_CONTENT_TYPE = 'application/vnd.asa.learning-file';
export const LEARNING_FILE_MAX_BYTES = 50_000_000;
const UPLOAD_ROUTE =
  '/api/learning/file/runs/:activityRunId/draft/:attemptId/:expectedRevision/:requestId';
const FORMATS = {
  pdf: ['application/pdf', 25_000_000],
  txt: ['text/plain', LEARNING_FILE_MAX_BYTES],
  csv: ['text/csv', LEARNING_FILE_MAX_BYTES],
  zip: ['application/zip', LEARNING_FILE_MAX_BYTES],
  sb3: ['application/x.scratch.sb3', LEARNING_FILE_MAX_BYTES],
  stl: ['model/stl', LEARNING_FILE_MAX_BYTES],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    LEARNING_FILE_MAX_BYTES,
  ],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    LEARNING_FILE_MAX_BYTES,
  ],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    LEARNING_FILE_MAX_BYTES,
  ],
  ino: ['text/plain', LEARNING_FILE_MAX_BYTES],
  png: ['image/png', 20_000_000],
  jpg: ['image/jpeg', 20_000_000],
  jpeg: ['image/jpeg', 20_000_000],
  webp: ['image/webp', 20_000_000],
} as const;

export function rejectLearningFile(code: string, status: number): never {
  throw new HttpException(
    { error: { code, message: 'Не удалось выполнить действие с файловой работой.' } },
    status,
  );
}

export function registerLearningFileTransport(fastify: FastifyInstance): void {
  fastify.addContentTypeParser(LEARNING_FILE_CONTENT_TYPE, (request, payload, done) => {
    const encoding = request.headers['content-encoding'];
    if (
      request.method !== 'PUT' ||
      request.routeOptions.url !== UPLOAD_ROUTE ||
      request.headers['content-type'] !== LEARNING_FILE_CONTENT_TYPE ||
      (encoding !== undefined && encoding !== 'identity')
    ) {
      done(Object.assign(new Error('learning_file_media_type_invalid'), { statusCode: 415 }));
      return;
    }
    done(null, payload);
  });
}

export function describeLearningFile(raw: unknown) {
  let name: string;
  try {
    if (typeof raw !== 'string' || raw.length > 3060) rejectLearningFile('file_name_invalid', 400);
    name = decodeURIComponent(raw).normalize('NFC').trim();
  } catch {
    rejectLearningFile('file_name_invalid', 400);
  }
  if ([...name].length > 255 || name.startsWith('.') || /[/\\:\p{Cc}\p{Cf}]/u.test(name))
    rejectLearningFile('file_name_invalid', 400);

  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase() as keyof typeof FORMATS;
  if (!name.includes('.') || !Object.hasOwn(FORMATS, extension))
    rejectLearningFile('file_format_unsupported', 415);
  const [contentType, maxBytes] = FORMATS[extension];
  return { name, extension, contentType, maxBytes };
}

/** Bound both stored and uploaded streams by the verified declared length. */
export async function readExactLearningFile(
  body: Readable,
  length: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  for await (const chunk of addAbortSignal(signal, body)) {
    if (!Buffer.isBuffer(chunk) || offset + chunk.length > length)
      throw new Error('learning_file_length_mismatch');
    chunk.copy(bytes, offset);
    offset += chunk.length;
  }
  if (offset !== length) throw new Error('learning_file_length_mismatch');
  return bytes;
}

function validateText(bytes: Buffer): void {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      const text = decoder.decode(bytes.subarray(offset, offset + 64 * 1024), { stream: true });
      if (/\p{Cc}/u.test(text.replaceAll(/[\t\n\r]/gu, ''))) throw new Error('invalid text');
    }
    decoder.decode();
  } catch {
    rejectLearningFile('file_content_invalid', 415);
  }
  if (
    /^\s*(?:<!doctype\s+html|<\?xml|<(?:html|svg|script)\b)/iu.test(
      bytes.subarray(0, 4096).toString('utf8'),
    )
  )
    rejectLearningFile('file_content_invalid', 415);
}

function validatePdf(bytes: Buffer): void {
  const tail = bytes.subarray(-2048).toString('latin1');
  const xref = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(tail);
  const offset = Number(xref?.[1]);
  const xrefHead = bytes.subarray(offset, offset + 4_096).toString('latin1');
  if (
    !/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/u.test(bytes.subarray(0, 10).toString('latin1')) ||
    !Number.isSafeInteger(offset) ||
    offset < 8 ||
    offset >= bytes.length ||
    !/^(?:xref\s+\d+\s+[1-9]\d*\s+\d{10}\s+\d{5}\s+[fn]\b|\d+\s+\d+\s+obj\s*<<[\s\S]*?\/Type\s*\/XRef\b)/u.test(
      xrefHead,
    )
  )
    rejectLearningFile('file_content_invalid', 415);
}

export async function validateLearningFile(
  bytes: Buffer,
  file: ReturnType<typeof describeLearningFile>,
): Promise<void> {
  if (bytes.length === 0) rejectLearningFile('file_content_invalid', 415);
  if (bytes.length > file.maxBytes) rejectLearningFile('file_too_large', 413);
  const { extension } = file;
  if (extension === 'pdf') {
    validatePdf(bytes);
    return;
  }
  if (extension === 'txt' || extension === 'csv' || extension === 'ino') {
    validateText(bytes);
    return;
  }
  try {
    if (
      extension === 'png' ||
      extension === 'jpg' ||
      extension === 'jpeg' ||
      extension === 'webp'
    ) {
      validateAttachmentImageStructure(bytes, extension === 'jpeg' ? 'jpg' : extension);
    } else if (extension === 'stl') {
      validateLearningStl(bytes);
    } else {
      await validateLearningArchive(bytes, extension);
    }
  } catch {
    rejectLearningFile('file_content_invalid', 415);
  }
}
