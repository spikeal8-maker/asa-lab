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
type RecordingMode = 'idle' | 'acquiring' | 'recording' | 'transcribing';

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
  readonly onTranscript: (text: string) => 'inserted' | 'overflow';
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
    setMessage('');
    microphoneButton.current?.focus();
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
    try {
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
      if (result.ok && result.data.text) {
        const placement = callback.current(result.data.text);
        setMessage(
          placement === 'overflow'
            ? 'Расшифровка не поместилась в сообщение. Полный текст доступен ниже.'
            : '',
        );
      } else {
        setMessage(
          result.ok
            ? 'Речь не распознана. Попробуйте ещё раз.'
            : 'Голосовой ввод сейчас недоступен.',
        );
      }
    } catch {
      if (mounted.current && !cancelled.current && serial === acquisitionSerial.current)
        setMessage('Голосовой ввод сейчас недоступен.');
    } finally {
      if (mounted.current && !cancelled.current && serial === acquisitionSerial.current) {
        pending.current = null;
        setMode('idle');
      }
    }
  }

  async function start() {
    if (
      acquiring.current ||
      mode !== 'idle' ||
      disabled ||
      !status?.enabled ||
      !navigator.mediaDevices?.getUserMedia
    )
      return;

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
      : mode === 'acquiring'
        ? 'Подключаем микрофон'
        : mode === 'transcribing'
          ? 'Распознаём речь'
          : available
            ? 'Продиктовать сообщение'
            : 'Голосовой ввод недоступен';
  const elapsed = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

  return (
    <div
      className="ai-voice-control"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && mode !== 'idle') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <button
        ref={microphoneButton}
        className={'chat-microphone' + (mode === 'recording' ? ' ai-voice-recording' : '')}
        type="button"
        aria-label={label}
        aria-pressed={mode === 'recording'}
        data-ai-tooltip={label}
        disabled={
          mode === 'transcribing' ||
          mode === 'acquiring' ||
          (mode === 'idle' && (!available || disabled))
        }
        onClick={() => {
          if (mode === 'recording') stop();
          else if (mode === 'idle') void start();
        }}
      >
        {mode === 'transcribing' || mode === 'acquiring' ? (
          <span className="ai-voice-spinner" aria-hidden="true" />
        ) : mode === 'recording' ? (
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="3" />
          </svg>
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
        <div className="ai-voice-toast" role="status" aria-live="polite">
          {mode === 'recording' ? (
            <span className="ai-voice-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          ) : null}
          <span className="ai-voice-caption">
            {mode === 'recording'
              ? 'Слушаю…'
              : mode === 'acquiring'
                ? 'Подключаю микрофон…'
                : mode === 'transcribing'
                  ? 'Распознаю…'
                  : message}
          </span>
          {mode === 'recording' ? (
            <time className="ai-voice-time" aria-hidden="true">
              {elapsed}
            </time>
          ) : null}
          <button
            type="button"
            onClick={mode !== 'idle' ? cancel : () => setMessage('')}
            aria-label={mode !== 'idle' ? 'Отменить голосовой ввод' : 'Закрыть сообщение'}
            data-ai-tooltip={mode !== 'idle' ? 'Отменить запись' : 'Закрыть'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
