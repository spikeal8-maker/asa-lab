import { useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../api-call';
import { newClientId } from '../client-id';
import './ai-voice-input.css';

interface VoiceStatus {
  readonly enabled: boolean;
  readonly model: string;
  readonly maxAudioSeconds: number;
}
interface Transcript {
  readonly text: string;
  readonly model: string;
}
type ScopedCall = <T>(path: string, init?: RequestInit) => Promise<ApiResult<T>>;
type RecordingMode = 'idle' | 'confirm' | 'recording' | 'transcribing';

function selectMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function AiVoiceInput({
  call,
  disabled,
  onTranscript,
}: {
  readonly call: ScopedCall;
  readonly disabled: boolean;
  readonly onTranscript: (text: string) => void;
}) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [mode, setMode] = useState<RecordingMode>('idle');
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void call<VoiceStatus>('/api/ai/stt/status')
      .then((result) => {
        if (active) setStatus(result.ok ? result.data : null);
      })
      .catch(() => {
        // A legacy API, blocked network or strict test fixture must not crash text chat.
        if (active) setStatus(null);
      });
    return () => {
      active = false;
      mounted.current = false;
      cancelled.current = true;
      if (timeout.current) clearTimeout(timeout.current);
      pending.current?.abort();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, [call]);

  // If another operation disables the composer, never finish or dispatch stale audio.
  useEffect(() => {
    if (!disabled) return;
    cancelled.current = true;
    pending.current?.abort();
    pending.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setMode('idle');
    setMessage('');
  }, [disabled]);

  useEffect(() => {
    if (mode !== 'recording') return;
    const clock = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(clock);
  }, [mode]);

  function cleanup() {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }

  function cancel() {
    cancelled.current = true;
    pending.current?.abort();
    pending.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    cleanup();
    setMode('idle');
    setSeconds(0);
    setMessage(mode === 'confirm' ? '' : 'Запись отменена');
  }

  async function transcribe(blob: Blob, durationSeconds: number, mimeType: string) {
    setMode('transcribing');
    if (!blob.size || blob.size > 512_000) {
      setMessage('Слишком большой аудиофайл. Запишите более короткий вопрос.');
      setMode('idle');
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
    } catch {
      if (mounted.current) {
        setMessage('Не удалось прочитать запись.');
        setMode('idle');
      }
      return;
    }
    if (cancelled.current || !mounted.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const result = await call<Transcript>('/api/ai/stt/transcribe', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        requestId: newClientId(),
        audioBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
        mimeType,
        durationSeconds,
      }),
    });
    if (!mounted.current || cancelled.current) return;
    pending.current = null;
    setMode('idle');
    if (result.ok && result.data.text) {
      callback.current(result.data.text);
      setMessage('Текст добавлен в сообщение. Проверьте его перед отправкой.');
      return;
    }
    setMessage(result.ok ? 'Речь не распознана.' : result.error.message);
  }

  async function start() {
    if (disabled || !status?.enabled || !navigator.mediaDevices?.getUserMedia) return;
    cancelled.current = false;
    setMessage('');
    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch {
      if (mounted.current) setMessage('Нет доступа к микрофону. Проверьте разрешения браузера.');
      return;
    }
    if (!mounted.current || cancelled.current) {
      opened.getTracks().forEach((track) => track.stop());
      return;
    }
    const mime = selectMime();
    if (!mime) {
      opened.getTracks().forEach((track) => track.stop());
      setMessage('Браузер не поддерживает запись для распознавания.');
      return;
    }
    let media: MediaRecorder;
    try {
      media = new MediaRecorder(opened, { mimeType: mime, audioBitsPerSecond: 64_000 });
    } catch {
      opened.getTracks().forEach((track) => track.stop());
      setMessage('Не удалось начать запись.');
      return;
    }
    const chunks: Blob[] = [];
    const startAt = Date.now();
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = () => {
      const elapsed = Math.min(
        status.maxAudioSeconds,
        Math.max(0.1, (Date.now() - startAt) / 1000),
      );
      const blob = new Blob(chunks, { type: mime });
      cleanup();
      if (!cancelled.current && mounted.current)
        void transcribe(blob, elapsed, mime.split(';')[0]!);
    };
    media.onerror = () => {
      cancelled.current = true;
      cleanup();
      if (mounted.current) {
        setMode('idle');
        setMessage('Ошибка записи микрофона.');
      }
    };
    stream.current = opened;
    recorder.current = media;
    media.start(250);
    setSeconds(0);
    setMode('recording');
    timeout.current = setTimeout(() => {
      if (media.state === 'recording') media.stop();
    }, status.maxAudioSeconds * 1000);
  }

  function stop() {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  const supported =
    typeof window !== 'undefined' &&
    window.isSecureContext !== false &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!selectMime();
  const available = !!status?.enabled && supported;
  const label =
    mode === 'recording'
      ? 'Остановить запись и распознать'
      : mode === 'confirm'
        ? 'Подтверждение записи'
        : mode === 'transcribing'
          ? 'Распознаём речь'
          : available
            ? 'Продиктовать сообщение'
            : status?.enabled && typeof window !== 'undefined' && !window.isSecureContext
            ? 'Для голосового ввода нужен HTTPS'
            : status?.enabled
              ? 'Браузер не поддерживает голосовой ввод'
              : 'Голосовой ввод не подключён';

  return (
    <div className="ai-voice-control">
      <button
        className={'chat-microphone' + (mode === 'recording' ? ' ai-voice-recording' : '')}
        type="button"
        aria-label={label}
        aria-pressed={mode === 'recording'}
        title={label}
        disabled={mode === 'transcribing' || (mode === 'idle' && (!available || disabled))}
        onClick={() => {
          if (mode === 'recording') stop();
          else if (mode === 'confirm') cancel();
          else setMode('confirm');
        }}
      >
        {mode === 'transcribing' ? (
          <span className="ai-voice-spinner" aria-hidden="true" />
        ) : (
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="9" y="2" width="6" height="13" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
          </svg>
        )}
      </button>
      {mode !== 'idle' || message ? (
        <div
          className="ai-voice-toast"
          role={mode === 'confirm' ? 'dialog' : 'status'}
          aria-label={mode === 'confirm' ? 'Подтверждение голосового ввода' : undefined}
          aria-live="polite"
        >
          <span>
            {mode === 'confirm'
              ? 'Запись будет отправлена в Polza AI для распознавания. ASA Lab не сохраняет аудио.'
              : mode === 'recording'
                ? 'Запись ' + seconds + ' / ' + status?.maxAudioSeconds + ' сек'
                : mode === 'transcribing'
                  ? 'Распознаём речь…'
                  : message}
          </span>
          {mode === 'confirm' ? (
            <>
              <button type="button" onClick={() => void start()} aria-label="Разрешить голосовой ввод">
                Продолжить
              </button>
              <button type="button" onClick={cancel} aria-label="Отменить голосовой ввод">
                Отмена
              </button>
            </>
          ) : mode !== 'idle' ? (
            <button type="button" onClick={cancel} aria-label="Отменить голосовой ввод">
              Отмена
            </button>
          ) : (
            <button type="button" onClick={() => setMessage('')} aria-label="Закрыть сообщение">
              ×
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
