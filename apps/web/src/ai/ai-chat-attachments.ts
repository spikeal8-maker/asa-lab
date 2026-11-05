import { createAiScopeCall, aiScopeHeaders } from './ai-scope-api';
import { fetchWithSessionRefresh } from '../session-fetch';

export const AI_CHAT_FILE_ACCEPT =
  '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.js,.jsx,.ts,.tsx,.py,.c,.cpp,.h,.hpp,.ino,.json,.css,.html,.xml,.yaml,.yml,.sql,.sh,.java,.rs,.go';

export interface AiChatFileDraft {
  readonly uploadId: string;
  readonly file: File;
  readonly preview: string | null;
  readonly originalBytes?: number;
  readonly dimensions?: string | undefined;
}

interface Receipt {
  readonly uploadId: string;
  readonly state:
    'reserved' | 'uploading' | 'unknown' | 'ready' | 'bound' | 'deleting' | 'deleted' | 'failed';
  readonly sha256: string;
}

export function checkAiChatFiles(files: readonly File[]): string | null {
  if (files.length > 4) return 'Можно прикрепить не более четырёх файлов.';
  let total = 0;
  const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);
  const otherExtensions = new Set(AI_CHAT_FILE_ACCEPT.split(',').map((part) => part.slice(1)));
  for (const file of files) {
    if (file.size < 1) return 'Нельзя прикрепить пустой файл.';
    if (
      !file.name ||
      file.name.length > 180 ||
      file.name.startsWith('.') ||
      file.name.includes('..') ||
      /[\\/<>:"|?*\u202a-\u202e]/u.test(file.name)
    )
      return 'Имя файла не подходит для безопасной загрузки.';
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
    if (!otherExtensions.has(extension))
      return 'Этот формат пока не поддерживается. Выберите PDF, DOCX, XLSX, изображение, текст или код.';
    if (
      file.size >
      (imageExtensions.has(extension) || ['pdf', 'docx', 'xlsx'].includes(extension)
        ? 8 * 1024 * 1024
        : 512 * 1024)
    )
      return 'Файл превышает допустимый размер (8 МБ для изображения или документа, 512 КБ для текста).';
    total += file.size;
  }
  if (total > 20 * 1024 * 1024) return 'Общий размер вложений превышает 20 МБ.';
  return null;
}

/** This runs only after the user explicitly presses Send; file selection stays local. */
export async function uploadAiChatFile(
  draft: AiChatFileDraft,
  seatId: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const error = checkAiChatFiles([draft.file]);
  if (error) throw new Error(error);
  const bytes = await draft.file.arrayBuffer();
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  signal.throwIfAborted();
  const call = createAiScopeCall(seatId);
  const reserved = await call<Receipt>('/api/ai/attachments', {
    method: 'POST',
    body: JSON.stringify({
      uploadId: draft.uploadId,
      fileName: draft.file.name,
      sizeBytes: bytes.byteLength,
      sha256: hash,
    }),
    signal,
  });
  if (!reserved.ok) throw new Error(reserved.error.message);
  if (reserved.data.sha256 !== hash)
    throw new Error('Контрольная сумма файла изменилась. Выберите файл заново.');
  // A lost SSE may arrive after atomic SQL binding. Return the same ID to
  // its original requestId; the immutable DB manifest enforces same owner,
  // prompt, order and files without another paid or local provider call.
  if (reserved.data.state === 'ready' || reserved.data.state === 'bound')
    return reserved.data.uploadId;
  if (reserved.data.state !== 'reserved')
    throw new Error(
      'Состояние прежней загрузки не подтверждено. Проверьте вложение перед отправкой.',
    );
  // A single bounded PUT. Never repeat it automatically after an uncertain result.
  const response = await fetchWithSessionRefresh(
    '/api/ai/attachments/' + encodeURIComponent(draft.uploadId) + '/bytes',
    {
      method: 'PUT',
      headers: {
        ...aiScopeHeaders(seatId),
        'content-type': 'application/vnd.asa.ai-attachment',
      },
      body: bytes,
      signal,
    },
  );
  if (!response.ok) {
    let body: { error?: { message?: string } } | null = null;
    try {
      body = (await response.json()) as { error?: { message?: string } };
    } catch {
      /* rejected binary transfer */
    }
    throw new Error(
      body?.error?.message ?? 'Загрузка файла не завершилась. Проверьте состояние вложения.',
    );
  }
  let receipt: Receipt;
  try {
    receipt = (await response.json()) as Receipt;
  } catch {
    throw new Error('Состояние загрузки неизвестно. Автоматическая повторная загрузка запрещена.');
  }
  if (receipt.uploadId !== draft.uploadId || receipt.sha256 !== hash || receipt.state !== 'ready')
    throw new Error('Сервер не подтвердил безопасное сохранение файла.');
  return draft.uploadId;
}
