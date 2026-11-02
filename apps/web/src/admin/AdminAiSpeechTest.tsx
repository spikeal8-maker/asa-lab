import { useEffect, useRef, useState } from 'react';
import { call } from './admin-api';
import { AiVoiceInput } from '../ai/AiVoiceInput';
import { newClientId } from '../client-id';
export function AdminAiSpeechTest({
  enabled,
  maxSeconds,
}: {
  enabled: boolean;
  maxSeconds: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState(Math.min(8, maxSeconds));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const attempt = useRef<{ file: File; seconds: number; id: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function test() {
    if (inFlight.current || busy || !enabled || !file) return;
    if (
      file.size > 512000 ||
      file.size < 8 ||
      !Number.isFinite(seconds) ||
      seconds < 0.1 ||
      seconds > maxSeconds
    ) {
      setError('Выберите запись до 512 КБ и укажите её длительность в пределах лимита.');
      return;
    }
    let mime =
      file.type.split(';')[0] ||
      (/\.ogg$/i.test(file.name)
        ? 'audio/ogg'
        : /\.m4a$/i.test(file.name)
          ? 'audio/mp4'
          : /\.webm$/i.test(file.name)
            ? 'audio/webm'
            : '');
    if (['audio/x-m4a', 'video/mp4'].includes(mime)) mime = 'audio/mp4';
    if (mime === 'application/ogg') mime = 'audio/ogg';
    if (!['audio/webm', 'audio/ogg', 'audio/mp4', 'video/webm'].includes(mime)) {
      setError('Поддерживаются WebM, Ogg и M4A.');
      return;
    }
    inFlight.current = true;
    if (!attempt.current || attempt.current.file !== file || attempt.current.seconds !== seconds)
      attempt.current = { file, seconds, id: newClientId() };
    const requestId = attempt.current.id;
    setBusy(true);
    setError('');
    setText('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(Error('read'));
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(file);
      });
      if (controller.signal.aborted) return;
      const result = await call<{ text: string; model: string }>('/api/ai/stt/transcribe', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          requestId,
          audioBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
          mimeType: mime === 'video/webm' ? 'audio/webm' : mime,
          durationSeconds: seconds,
        }),
      });
      if (controller.signal.aborted) return;
      if (result.ok) setText(result.data.text || 'Речь не распознана.');
      else setError(result.error.message);
    } catch {
      if (!controller.signal.aborted) setError('Не удалось отправить запись на распознавание.');
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="asa-speech-test" aria-label="Проверка распознавания речи">
      <header>
        <h3>Проверить распознавание</h3>
        <AiVoiceInput
          call={call}
          disabled={busy || !enabled}
          onTranscript={(value) => {
            setText(value);
            return 'inserted';
          }}
        />
      </header>
      <p>
        Продиктуйте текст через микрофон или выберите короткую запись. Результат появится здесь.
        Файл отправляется в Polza после нажатия «Распознать файл».
      </p>
      <div className="asa-polza-catalog-filters">
        <label>
          Аудиозапись
          <input
            type="file"
            aria-label="Аудиофайл для проверки"
            accept=".webm,.ogg,.m4a,audio/webm,audio/ogg,audio/mp4"
            disabled={busy || !enabled}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError('');
            }}
          />
        </label>
        <label>
          Длительность, секунд
          <input
            type="number"
            aria-label="Длительность тестовой записи"
            min="0.1"
            max={maxSeconds}
            step="0.1"
            value={seconds}
            disabled={busy}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="asa-polza-primary"
          disabled={busy || !enabled || !file}
          onClick={() => void test()}
        >
          {busy ? 'Распознаём…' : 'Распознать файл'}
        </button>
      </div>
      <small>
        WebM, Ogg или M4A · до {maxSeconds} секунд · до 512 КБ. Длительность дополнительно проверяет
        сервер.
      </small>
      {error ? <p role="alert">{error}</p> : null}
      {text ? (
        <>
          <label htmlFor="stt-test-output">Распознанный текст</label>
          <textarea
            id="stt-test-output"
            aria-label="Распознанный текст"
            rows={3}
            readOnly
            value={text}
          />
        </>
      ) : null}
    </section>
  );
}
