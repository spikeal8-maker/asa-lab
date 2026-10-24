import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAiChatFiles, uploadAiChatFile } from './ai-chat-attachments';

const requests = vi.hoisted(() => ({
  scope: vi.fn(),
  bytes: vi.fn(),
}));

vi.mock('./ai-scope-api', () => ({
  createAiScopeCall: () => requests.scope,
  aiScopeHeaders: (seatId?: string) =>
    seatId ? { 'x-asa-ai-seat': seatId } : {},
}));
vi.mock('../session-fetch', () => ({
  fetchWithSessionRefresh: requests.bytes,
}));

const UPLOAD = '44444444-4444-4444-8444-444444444444';
const CONTENT = 'void setup(){pinMode(13,OUTPUT);}\n';
const SHA = createHash('sha256').update(CONTENT).digest('hex');

function draft() {
  return {
    uploadId: UPLOAD,
    file: new File([CONTENT], 'sketch.ino', { type: 'text/plain' }),
    preview: null,
  };
}

afterEach(() => vi.resetAllMocks());

describe('ASA chat uploads and exact request recovery', () => {
  it('keeps an already-bound file for verified same-request replay without uploading bytes again', async () => {
    requests.scope.mockResolvedValue({
      ok: true,
      status: 200,
      data: { uploadId: UPLOAD, sha256: SHA, state: 'bound' },
    });
    await expect(
      uploadAiChatFile(draft(), '55555555-5555-4555-8555-555555555555', new AbortController().signal),
    ).resolves.toBe(UPLOAD);
    expect(requests.scope).toHaveBeenCalledExactlyOnceWith(
      '/api/ai/attachments',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(requests.scope.mock.calls[0]![1].body)).toEqual({
      uploadId: UPLOAD,
      fileName: 'sketch.ino',
      sizeBytes: CONTENT.length,
      sha256: SHA,
    });
    expect(requests.bytes).not.toHaveBeenCalled();
  });

  it('does not retry an uncertain in-flight upload automatically', async () => {
    requests.scope.mockResolvedValue({
      ok: true,
      status: 202,
      data: { uploadId: UPLOAD, sha256: SHA, state: 'unknown' },
    });
    await expect(
      uploadAiChatFile(draft(), undefined, new AbortController().signal),
    ).rejects.toThrow('Состояние прежней загрузки не подтверждено');
    expect(requests.bytes).not.toHaveBeenCalled();
  });

  it('rejects unsupported formats, empty and oversized attachments before network calls', () => {
    expect(checkAiChatFiles([new File(['x'], 'lesson.pdf')])).toMatch(/не поддерживается/);
    expect(checkAiChatFiles([new File([], 'empty.ino')])).toMatch(/пустой/);
    expect(checkAiChatFiles(Array.from({ length: 5 }, () => draft().file))).toMatch(/четырёх/);
    expect(requests.scope).not.toHaveBeenCalled();
  });
});
