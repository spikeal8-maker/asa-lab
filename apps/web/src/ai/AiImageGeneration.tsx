import { useEffect, useRef, useState } from 'react';
import type {
  AiImageGenerationJob,
  AiImageGenerationStatus,
  AiImageSize,
} from '@asa-lab/contracts';
import { createAiScopeCall } from './ai-scope-api';
import './ai-image-generation.css';

const terminal = (job: AiImageGenerationJob) =>
  ['complete', 'failed', 'cancelled'].includes(job.state);
export function imageGenerationStatusShape(value: unknown): value is AiImageGenerationStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<AiImageGenerationStatus>;
  return (
    typeof status.enabled === 'boolean' &&
    typeof status.ready === 'boolean' &&
    Array.isArray(status.sizes) &&
    status.sizes.length > 0 &&
    status.sizes.every((size) => [512, 768, 1024].includes(size)) &&
    Number.isSafeInteger(status.dailyLimit) &&
    Number.isSafeInteger(status.remainingToday)
  );
}
const labels: Record<AiImageGenerationJob['state'], string> = {
  admitted: 'Задание принято. Ожидаем GPU…',
  submitting: 'Передаём задание локальному GPU…',
  unknown: 'Результат пока неизвестен. Проверяем сохранённое задание без повторной отправки.',
  running: 'Создаём изображение…',
  storing: 'Сохраняем изображение…',
  complete: 'Изображение создано.',
  failed: 'Не удалось создать изображение.',
  cancelled: 'Задание отменено.',
};
export function AiImageGeneration({
  threadId,
  seatId,
  disabled,
  createThread,
  onComplete,
  onClose,
}: {
  threadId: string | null;
  seatId?: string | undefined;
  disabled: boolean;
  createThread: () => Promise<string | null>;
  onComplete: (threadId: string) => void;
  onClose: () => void;
}) {
  const call = useRef(createAiScopeCall(seatId)).current;
  const [status, setStatus] = useState<AiImageGenerationStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<AiImageSize>(512);
  const [job, setJob] = useState<AiImageGenerationJob | null>(null);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [check, setCheck] = useState(0);
  const scope = useRef(threadId);
  scope.current = threadId;
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const notified = useRef('');
  const recoveryVersion = useRef(0);
  const completion = useRef(onComplete);
  completion.current = onComplete;
  const key = (id: string) => 'asa-ai-image:' + (seatId || 'personal') + ':' + id;
  useEffect(() => {
    mounted.current = true;
    void call<AiImageGenerationStatus>('/api/ai/image-generation/status').then((result) => {
      if (!mounted.current) return;
      if (result.ok && imageGenerationStatusShape(result.data)) {
        setStatus(result.data);
        setSize((previous) =>
          result.data.sizes.includes(previous) ? previous : result.data.sizes[0]!,
        );
      } else setNotice('Генерация изображений недоступна. Возможно, требуется обновление API.');
    });
    return () => {
      mounted.current = false;
    };
  }, [call]);
  useEffect(() => {
    const version = ++recoveryVersion.current;
    let live = true;
    let timer: number | undefined;
    let attempt = 0;
    const controller = new AbortController();
    setJob(null);
    setUnresolved(false);
    if (!threadId) return;
    let requestId: string | null = null;
    try {
      requestId = sessionStorage.getItem(key(threadId));
    } catch {
      /* storage may be disabled */
    }
    if (!requestId) return;
    setUnresolved(true);
    const path =
      '/api/ai/threads/' +
      encodeURIComponent(threadId) +
      '/image-generations/' +
      encodeURIComponent(requestId);
    const poll = async () => {
      if (!live || version !== recoveryVersion.current) return;
      const result = await call<AiImageGenerationJob>(path, { signal: controller.signal });
      if (!live || version !== recoveryVersion.current) return;
      if (result.ok && result.data.threadId === threadId && result.data.requestId === requestId) {
        setJob(result.data);
        setNotice('');
        if (terminal(result.data)) {
          setUnresolved(false);
          void call<AiImageGenerationStatus>('/api/ai/image-generation/status').then((reply) => {
            if (live && reply.ok && imageGenerationStatusShape(reply.data)) setStatus(reply.data);
          });
          try {
            sessionStorage.removeItem(key(threadId));
          } catch {
            /* no retry mutation */
          }
          if (result.data.state === 'complete' && notified.current !== requestId) {
            notified.current = requestId!;
            completion.current(threadId);
          }
          return;
        }
      } else setNotice('Статус задания пока неизвестен. Повторная отправка не выполняется.');
      timer = window.setTimeout(
        () => void poll(),
        Math.min(15000, 1500 * 2 ** Math.min(attempt++, 4)),
      );
    };
    void poll();
    return () => {
      live = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [threadId, check, call]);
  async function send() {
    if (
      inFlight.current ||
      disabled ||
      !prompt.trim() ||
      !status?.enabled ||
      !status.ready ||
      status.remainingToday < 1
    )
      return;
    inFlight.current = true;
    setSending(true);
    setNotice('');
    try {
      const initial = threadId;
      const id = initial || (await createThread());
      if (!id || !mounted.current || (initial && scope.current !== initial)) return;
      let existing: string | null = null;
      try {
        existing = sessionStorage.getItem(key(id));
      } catch {
        /* guarded below */
      }
      if (existing) {
        setNotice('Сначала дождитесь результата сохранённого задания.');
        setCheck((n) => n + 1);
        return;
      }
      const requestId = crypto.randomUUID();
      // Persist before POST; unavailable persistence must fail before mutation.
      sessionStorage.setItem(key(id), requestId);
      setUnresolved(true);
      const result = await call<AiImageGenerationJob>(
        '/api/ai/threads/' + encodeURIComponent(id) + '/image-generations',
        {
          method: 'POST',
          body: JSON.stringify({ requestId, prompt: prompt.trim(), size }),
        },
      );
      // Only this ASA admission-boundary receipt proves the fresh POST never
      // committed. A generic 4xx (or a later GET 404) cannot prove that.
      if (
        !result.ok &&
        result.error.code === 'ai_image_not_admitted' &&
        [400, 403, 429, 503].includes(result.status)
      ) {
        try {
          if (sessionStorage.getItem(key(id)) === requestId) sessionStorage.removeItem(key(id));
        } catch {
          // Keep the saved UUID when storage cannot confirm its removal.
        }
        if (!mounted.current || scope.current !== id) return;
        // Fence an early GET synchronously, before React runs effect cleanup.
        recoveryVersion.current += 1;
        setJob(null);
        setUnresolved(false);
        setNotice(result.error.message);
        // Also cancel an early GET started when this POST created a thread.
        setCheck((n) => n + 1);
        const latest = await call<AiImageGenerationStatus>('/api/ai/image-generation/status');
        if (
          mounted.current &&
          scope.current === id &&
          latest.ok &&
          imageGenerationStatusShape(latest.data)
        ) {
          setStatus(latest.data);
          setSize((previous) =>
            latest.data.sizes.includes(previous) ? previous : latest.data.sizes[0]!,
          );
        }
        return;
      }
      if (!mounted.current || scope.current !== id) return;
      if (result.ok) {
        setJob(result.data);
        setPrompt('');
      } else
        setNotice(
          result.status
            ? result.error.message
            : 'Ответ сервера неизвестен. Проверяем задание без повторной отправки.',
        );
      setCheck((n) => n + 1);
    } catch {
      if (mounted.current)
        setNotice(
          'Не удалось сохранить или проверить задание. Новая генерация не запущена автоматически.',
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  }
  async function cancel() {
    if (!job || terminal(job)) return;
    const id = threadId;
    const result = await call<AiImageGenerationJob>(
      '/api/ai/threads/' +
        encodeURIComponent(job.threadId) +
        '/image-generations/' +
        encodeURIComponent(job.requestId) +
        '/cancel',
      { method: 'POST', body: '{}' },
    );
    if (!mounted.current || scope.current !== id) return;
    if (result.ok) setJob(result.data);
    else setNotice('Отмена пока не подтверждена. Проверяем состояние.');
    setCheck((n) => n + 1);
  }
  const pending = job && !terminal(job);
  return (
    <section className="ai-image-mode" aria-label="Создать изображение">
      <strong>Создать изображение</strong>
      <p>
        Локальный GPU · без списания лимита текстовой модели. Вложения и интернет-поиск здесь не
        используются.
      </p>
      <textarea
        autoFocus
        aria-label="Описание изображения"
        placeholder="Опишите изображение"
        maxLength={3000}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={sending || !!pending || disabled}
      />
      <div className="ai-image-mode-controls">
        <select
          aria-label="Размер изображения"
          value={size}
          onChange={(e) => setSize(Number(e.target.value) as AiImageSize)}
          disabled={sending || !!pending}
        >
          {(status?.sizes || [512]).map((value) => (
            <option key={value} value={value}>
              {value} × {value}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={
            disabled ||
            sending ||
            unresolved ||
            !!pending ||
            !status?.enabled ||
            !status.ready ||
            status.remainingToday < 1 ||
            !prompt.trim()
          }
          onClick={() => void send()}
        >
          Создать изображение
        </button>
        {pending ? (
          <button type="button" disabled={job.cancelRequested} onClick={() => void cancel()}>
            {job.cancelRequested ? 'Отмена запрошена' : 'Отменить задание'}
          </button>
        ) : null}
        <button type="button" disabled={sending} onClick={onClose}>
          К текстовому чату
        </button>
      </div>
      {unresolved && !job ? (
        <button type="button" onClick={() => setCheck((n) => n + 1)}>
          Проверить статус задания
        </button>
      ) : null}
      <p role="status">
        {notice ||
          (job
            ? labels[job.state]
            : status
              ? !status.enabled
                ? 'Генерация выключена администратором.'
                : !status.ready
                  ? 'Локальная генерация пока не готова.'
                  : 'Доступно до 00:00 UTC: ' + status.remainingToday
              : 'Проверяем доступность…')}
      </p>
    </section>
  );
}
