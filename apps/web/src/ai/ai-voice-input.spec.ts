// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AiVoiceInput } from './AiVoiceInput';
import { mergeVoiceTranscript } from './voice-transcript-draft';

const ebml = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04,
]);
let root: Root;
let host: HTMLDivElement;
let stopTrack: ReturnType<typeof vi.fn>;
let acquire: ReturnType<typeof vi.fn>;
const transcript = vi.fn<(text: string) => 'inserted' | 'overflow'>(() => 'inserted');
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
    root.render(createElement(AiVoiceInput, { call, disabled: false, onTranscript: transcript }));
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
  transcript.mockImplementation(() => 'inserted');
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

it('starts recording with one click and shows only compact voice activity', async () => {
  await render();
  expect(acquire).not.toHaveBeenCalled();
  await act(async () => button('Продиктовать сообщение').click());
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).not.toMatch(/Polza|Продолжить|ASA Lab/);
  expect(host.querySelectorAll('.ai-voice-wave i')).toHaveLength(5);
  expect(host.querySelector('time')?.textContent).toBe('0:00');
  expect(button('Остановить запись и распознать').getAttribute('aria-pressed')).toBe('true');
  expect(requests.map((r) => r.path)).toEqual(['/api/ai/stt/status']);
});

it('Escape cancels recording without transmitting audio', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => {
    button('Остановить запись и распознать').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  expect(host.querySelector('.ai-voice-toast')).toBeNull();
  expect(stopTrack).toHaveBeenCalled();
  expect(requests.filter((r) => r.path === '/api/ai/stt/transcribe')).toHaveLength(0);
  expect(document.activeElement).toBe(button('Продиктовать сообщение'));
});

it('serializes double microphone clicks and stops a late microphone stream after cancel', async () => {
  let resolvePermission!: (value: MediaStream) => void;
  const permission = new Promise<MediaStream>((resolve) => {
    resolvePermission = resolve;
  });
  acquire.mockImplementationOnce(() => permission);
  await render();
  const microphone = button('Продиктовать сообщение');
  await act(async () => {
    microphone.click();
    microphone.click();
  });
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Подключаю микрофон');
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
  await act(async () => button('Отменить голосовой ввод').click());
  await act(async () => button('Продиктовать сообщение').click());
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

it('reports a full transcript separately when the existing draft cannot fit it', async () => {
  let draft = 'Unsent question';
  let overflow: string | null = null;
  speechResponse = 'Р'.repeat(6000);
  transcript.mockImplementation((text) => {
    const result = mergeVoiceTranscript(draft, text);
    draft = result.draft;
    overflow = result.overflow;
    return overflow === null ? 'inserted' : 'overflow';
  });
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Остановить запись и распознать').click());
  await vi.waitFor(() => expect(host.textContent).toContain('Расшифровка не поместилась'));
  expect(draft).toBe('Unsent question');
  expect(overflow).toBe(speechResponse);
  expect(host.textContent).not.toContain('Текст добавлен в сообщение');
});

it('cancels a recording without transmitting audio or adding text', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Отменить голосовой ввод').click());
  expect(transcript).not.toHaveBeenCalled();
  expect(requests.filter((r) => r.path === '/api/ai/stt/transcribe')).toHaveLength(0);
  expect(stopTrack).toHaveBeenCalled();
});

it('returns to idle with a simple notice when recognition rejects', async () => {
  const failingCall = <T>(path: string, init?: RequestInit) =>
    path === '/api/ai/stt/transcribe'
      ? Promise.reject(new Error('private upstream diagnostics'))
      : call<T>(path, init);
  await act(async () =>
    root.render(
      createElement(AiVoiceInput, { call: failingCall, disabled: false, onTranscript: transcript }),
    ),
  );
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => button('Остановить запись и распознать').click());
  await vi.waitFor(() => expect(host.textContent).toContain('Голосовой ввод сейчас недоступен.'));
  expect(host.textContent).not.toContain('private upstream');
  expect(button('Продиктовать сообщение').disabled).toBe(false);
  expect(transcript).not.toHaveBeenCalled();
});

it('does not transmit audio when the component is removed during recording', async () => {
  await render();
  await act(async () => button('Продиктовать сообщение').click());
  await act(async () => root.render(null));
  expect(stopTrack).toHaveBeenCalled();
  expect(requests.filter((r) => r.path === '/api/ai/stt/transcribe')).toHaveLength(0);
  expect(transcript).not.toHaveBeenCalled();
});
