// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AiVoiceInput } from './AiVoiceInput';

const ebml = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
]);
let root: Root;
let host: HTMLDivElement;
let stopTrack: ReturnType<typeof vi.fn>;
let acquire: ReturnType<typeof vi.fn>;
const transcript = vi.fn<(text: string) => void>();
const requests: Array<{ path: string; init: RequestInit | undefined }> = [];
let speechResponse = 'Объясни мне алгоритм сортировки.';

class RecorderForTest {
  static isTypeSupported(mime: string): boolean {
    return mime === 'audio/webm;codecs=opus';
  }
  state: RecordingState = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([ebml], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

function call<T>(
  path: string,
  init?: RequestInit,
): Promise<{
  ok: true;
  status: number;
  data: T;
}> {
  requests.push({ path, init });
  if (path === '/api/ai/stt/status')
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        enabled: true,
        model: 'ai-sage/gigaam-v3',
        maxAudioSeconds: 20,
      } as T,
    });
  if (path === '/api/ai/stt/transcribe')
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        text: speechResponse,
        model: 'ai-sage/gigaam-v3',
      } as T,
    });
  throw new Error('Unexpected API path: ' + path);
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<AiVoiceInput call={call} disabled={false} onTranscript={transcript} />);
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === name,
  );
  if (!found) throw new Error('Button missing: ' + name);
  return found;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('MediaRecorder', RecorderForTest);
  stopTrack = vi.fn();
  acquire = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: acquire },
  });
  transcript.mockReset();
  requests.splice(0);
  speechResponse = 'Объясни мне алгоритм сортировки.';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('requires an explicit confirmation before microphone capture', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  expect(acquire).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Polza AI');
  expect(document.activeElement).toBe(button('Разрешить голосовой ввод'));
  await act(async () => button('Отменить голосовой ввод').click());
  expect(acquire).not.toHaveBeenCalled();
  expect(requests.map((r) => r.path)).toEqual(['/api/ai/stt/status']);
});

it('Escape dismisses the external audio transfer consent without microphone access', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => {
    button('Разрешить голосовой ввод').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(acquire).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button('Продиктовать сообщение'));
});

it('serializes double consent clicks and stops a late microphone stream after cancel', async () => {
  let resolvePermission!: (value: MediaStream) => void;
  const permission = new Promise<MediaStream>((resolve) => {
    resolvePermission = resolve;
  });
  acquire.mockImplementationOnce(() => permission);
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  const consent = button('Разрешить голосовой ввод');
  await act(async () => {
    consent.click();
    consent.click();
  });
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Ожидаем разрешения');
  await act(async () => button('Отменить голосовой ввод').click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  const released = vi.fn();
  await act(async () => {
    resolvePermission({ getTracks: () => [{ stop: released }] } as unknown as MediaStream);
    await permission;
  });
  await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1));
  expect(requests.filter((r) => r.path === '/api/ai/stt/transcribe')).toHaveLength(0);
  expect(transcript).not.toHaveBeenCalled();
});

it('ignores a stale first permission after a second recording is active', async () => {
  let resolveFirst!: (value: MediaStream) => void;
  const first = new Promise<MediaStream>((resolve) => {
    resolveFirst = resolve;
  });
  acquire.mockImplementationOnce(() => first);
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Разрешить голосовой ввод').click());
  await act(async () => button('Отменить голосовой ввод').click());
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Разрешить голосовой ввод').click());
  expect(acquire).toHaveBeenCalledTimes(2);
  const stopStale = vi.fn();
  await act(async () => {
    resolveFirst({ getTracks: () => [{ stop: stopStale }] } as unknown as MediaStream);
    await first;
  });
  await vi.waitFor(() => expect(stopStale).toHaveBeenCalledTimes(1));
  expect(stopTrack).not.toHaveBeenCalled();
  await act(async () => button('Остановить запись и распознать').click());
  await vi.waitFor(() => expect(transcript).toHaveBeenCalledTimes(1));
  expect(stopTrack).toHaveBeenCalled();
});

it('stops and transcribes into a draft only, without sending a chat message', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Разрешить голосовой ввод').click());
  expect(acquire).toHaveBeenCalledOnce();
  expect(button('Остановить запись и распознать')).toBeDefined();
  await act(async () => button('Остановить запись и распознать').click());
  await vi.waitFor(() => expect(transcript).toHaveBeenCalledWith(speechResponse));
  const dispatch = requests.find((r) => r.path === '/api/ai/stt/transcribe');
  expect(dispatch).toBeDefined();
  const body = JSON.parse(String(dispatch!.init?.body)) as {
    audioBase64: string;
    requestId: string;
    mimeType: string;
    durationSeconds: number;
  };
  expect(body.mimeType).toBe('audio/webm');
  expect(body.audioBase64).toBe(btoa(String.fromCharCode(...ebml)));
  expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(body.durationSeconds).toBeGreaterThan(0);
  expect(requests.filter((r) => r.path.includes('/messages'))).toEqual([]);
  expect(stopTrack).toHaveBeenCalled();
});

it('cancels a recording without transmitting audio or adding text', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Разрешить голосовой ввод').click());
  await act(async () => button('Отменить голосовой ввод').click());
  expect(transcript).not.toHaveBeenCalled();
  expect(requests.filter((r) => r.path === '/api/ai/stt/transcribe')).toHaveLength(0);
  expect(stopTrack).toHaveBeenCalled();
});
