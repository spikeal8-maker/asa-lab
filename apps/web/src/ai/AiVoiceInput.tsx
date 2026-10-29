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
type RecordingMode = 'idle' | 'confirm' | 'acquiring' | 'recording' | 'transcribing';

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
  const acquisitionSerial = useRef(0);
  const acquiring = useRef(false);
  const mounted = useRef(true);
  const microphoneButton = useRef<HTMLButtonElement>(null);
  const consentButton = useRef<HTMLButtonElement>(null);
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
      acquisitionSerial.current += 1;
      acquiring.current = false;
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = null;
      pending.current?.abort();
      const currentRecorder = recorder.current;
      const currentStream = stream.current;
      recorder.current = null;
      stream.current = null;
      if (currentRecorder?.state === 'recording') currentRecorder.stop();
      currentStream?.getTracks().forEach((track) => track.stop());
    };
  }, [call]);

  // If another operation disables the composer, never finish or dispatch stale audio.
  useEffect(() => {
    if (!disabled) return;
    cancelled.current = true;
    acquisitionSerial.current += 1;
    acquiring.current = false;
    pending.current?.abort();
    pending.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    const currentRecorder = recorder.current;
    const currentStream = stream.current;
    recorder.current = null;
    stream.current = null;
    if (currentRecorder?.state === 'recording') currentRecorder.stop();
    currentStream?.getTracks().forEach((track) => track.stop());
    setMode('idle');
    setMessage('');
  }, [disabled]);

  useEffect(() => {
    if (mode === 'confirm') consentButton.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'recording') return;
    const clock = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(clock);
  }, [mode]);

  function releaseOwned(media: MediaRecorder, ownedStream: MediaStream, serial: number) {
    ownedStream.getTracks().forEach((track) => track.stop());
    if (recorder.current === media) recorder.current = null;
    if (stream.current === ownedStream) stream.current = null;
    if (serial === acquisitionSerial.current) {
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = null;
    }
  }

  function cancel() {
    cancelled.current = true;
    acquisitionSerial.current += 1;
    acquiring.current = false;
    pending.current?.abort();
    pending.current = null;
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    const currentRecorder = recorder.current;
    const currentStream = stream.current;
    recorder.current = null;
    stream.current = null;
    if (currentRecorder?.state === 'recording') currentRecorder.stop();
    currentStream?.getTracks().forEach((track) => track.stop());
    setMode('idle');
    setSeconds(0);
    setMessage(mode === 'confirm' ? '' : 'Запись отменена');
    if (mode === 'confirm') microphoneButton.current?.focus();
  }

  async function transcribe(blob: Blob, durationSeconds: number, mimeType: string, serial: number) {
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
    if (cancelled.current || !mounted.current || serial !== acquisitionSerial.current) return;
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
    if (!mounted.current || cancelled.current || serial !== acquisitionSerial.current) return;
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
    if (
      acquiring.current ||
      mode !== 'confirm' ||
      disabled ||
      !status?.enabled ||
      !navigator.mediaDevices?.getUserMedia
    ) return;

    // The guard must change synchronously, before getUserMedia can resolve.
    // A state update alone would still allow a second click in the same tick.
    acquiring.current = true;
    const serial = ++acquisitionSerial.current;
    cancelled.current = false;
    setMode('acquiring');
    setMessage('');
    let opened: MediaStream;
    try {
      opened = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
    } catch {
      if (serial === acquisitionSerial.current) {
        acquiring.current = false;
        if (mounted.current) {
          setMode('idle');
          setMessage('Нет доступа к микрофону. Проверьте разрешения браузера.');
        }
      }
      return;
    }
    const stale = () =>
      !mounted.current || cancelled.current || serial !== acquisitionSerial.current || disabled;
    if (stale()) {
      opened.getTracks().forEach((track) => track.stop());
      return;
    }
    const mime = selectMime();
    if (!mime) {
      opened.getTracks().forEach((track) => track.stop());
      acquiring.current = false;
      setMode('idle');
      setMessage('Браузер не поддерживает запись для распознавания.');
      return;
    }
    let media: MediaRecorder;
    try {
      media = new MediaRecorder(opened, { mimeType: mime, audioBitsPerSecond: 64_000 });
    } catch {
      opened.getTracks().forEach((track) => track.stop());
      acquiring.current = false;
      setMode('idle');
      setMessage('Не удалось начать запись.');
      return;
    }
    const chunks: Blob[] = [];
    const startAt = Date.now();
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = () => {
      const valid = serial === acquisitionSerial.current && !cancelled.current && mounted.current;
      const elapsed = Math.min(
        status.maxAudioSeconds,
        Math.max(0.1, (Date.now() - startAt) / 1000),
      );
      const blob = new Blob(chunks, { type: mime });
      // Stop ONLY this recorder's own stream, never a newer recording's stream.
      releaseOwned(media, opened, serial);
      if (valid) void transcribe(blob, elapsed, mime.split(';')[0]!, serial);
    };
    media.onerror = () => {
      const current = serial === acquisitionSerial.current && mounted.current;
      if (current) cancelled.current = true;
      if (media.state === 'recording') {
        try {
          media.stop();
        } catch {
          // Track shutdown below is authoritative, even if MediaRecorder failed.
        }
      }
      releaseOwned(media, opened, serial);
      if (current) {
        acquiring.current = false;
        setMode('idle');
        setMessage('Ошибка записи микрофона.');
      }
    };
    stream.current = opened;
    recorder.current = media;
    try {
      media.start(250);
    } catch {
      releaseOwned(media, opened, serial);
      acquiring.current = false;
      setMode('idle');
      setMessage('Не удалось начать запись.');
      return;
    }
    acquiring.current = false;
    setSeconds(0);
    setMode('recording');
    timeout.current = setTimeout(() => {
      if (serial === acquisitionSerial.current && media.state === 'recording') media.stop();
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
        : mode === 'acquiring'
          ? 'Запрашиваем доступ к микрофону'
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
        ref={microphoneButton}
        className={'chat-microphone' + (mode === 'recording' ? ' ai-voice-recording' : '')}
        type="button"
        aria-label={label}
        aria-pressed={mode === 'recording'}
        title={label}
        disabled={mode === 'transcribing' || mode === 'acquiring' || (mode === 'idle' && (!available || disabled))}
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
                : mode === 'acquiring'
                  ? 'Ожидаем разрешения браузера на микрофон…'
                  : mode === 'transcribing'
                  ? 'Распознаём речь…'
                  : message}
          </span>
          {mode === 'confirm' ? (
            <>
              <button
                ref={consentButton}
                type="button"
                onClick={() => void start()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                  }
                }}
                aria-label="Разрешить голосовой ввод"
              >
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
