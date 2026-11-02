import { AI_IMAGE_UNAVAILABLE, aiPublicErrorMessage } from '@asa-lab/contracts';
import { aiImageSizeLabel, isAiImageSize } from '@asa-lab/contracts';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type {
  AiImageGenerationJob,
  AiImageGenerationStatus,
  AiImageSize,
} from '@asa-lab/contracts';
import { createAiScopeCall } from './ai-scope-api';
import './ai-image-generation.css';
import type { ImageGenerationMode } from './image-generation-intent';

export interface ImageComposerController {
  follow: (job: AiImageGenerationJob) => void;
  submit: (prompt: string, size: AiImageSize) => Promise<void>;
  cancel: () => Promise<void>;
}
export interface ImageComposerState {
  busy: boolean;
  canCancel: boolean;
  canSubmit: boolean;
  notice: string;
  sizes: readonly AiImageSize[];
}

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
    status.sizes.every(isAiImageSize) &&
    Number.isSafeInteger(status.dailyLimit) &&
    Number.isSafeInteger(status.remainingToday)
  );
}
const labels: Record<AiImageGenerationJob['state'], string> = {
  admitted: 'Задание принято…',
  submitting: 'Передаём задание модели…',
  unknown: 'Проверяю изображение…',
  running: 'Создаём изображение…',
  storing: 'Сохраняем изображение…',
  complete: 'Изображение создано.',
  failed: AI_IMAGE_UNAVAILABLE,
  cancelled: 'Задание отменено.',
};
export function AiImageGeneration({
  threadId,
  seatId,
  disabled,
  createThread,
  onComplete,
  onClose,
  initialPrompt = '',
  autoSubmit = false,
  modeChoice = 'flux2-klein-4b-v1',
  onModeChange,
  onPromptChange,
  onNotAdmitted,
  headless = false,
  controllerRef,
  onStateChange,
  onJobChange,
  onDefiniteThreadDenial,
  providedStatus,
}: {
  threadId: string | null;
  seatId?: string | undefined;
  disabled: boolean;
  createThread: () => Promise<string | null>;
  onComplete: (threadId: string) => void;
  onClose: () => void;
  initialPrompt?: string;
  autoSubmit?: boolean;
  modeChoice?: ImageGenerationMode;
  onModeChange?: (mode: ImageGenerationMode) => void;
  onPromptChange?: (prompt: string) => void;
  onNotAdmitted?: (prompt: string) => void;
  headless?: boolean;
  controllerRef?: Ref<ImageComposerController>;
  onStateChange?: (state: ImageComposerState) => void;
  /** Optional observer for the admin preview; never submits or retries a job. */
  onJobChange?: (job: AiImageGenerationJob | null) => void;
  /** Called only after a 403 preadmission receipt clears the fresh request ID. */
  onDefiniteThreadDenial?: (threadId: string) => void;
  providedStatus?: AiImageGenerationStatus | null;
}) {
  const call = useRef(createAiScopeCall(seatId)).current;
  const [status, setStatus] = useState<AiImageGenerationStatus | null>(null);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [size, setSize] = useState<AiImageSize>(1024);
  const [job, setJob] = useState<AiImageGenerationJob | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => onJobChange?.(job), [job, onJobChange]);
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
    if (headless) {
      setStatus(providedStatus ?? null);
      return () => {
        mounted.current = false;
      };
    }
    void call<AiImageGenerationStatus>('/api/ai/image-generation/status').then((result) => {
      if (!mounted.current) return;
      if (result.ok && imageGenerationStatusShape(result.data)) {
        setStatus(result.data);
        setSize((previous) =>
          result.data.sizes.includes(previous) ? previous : result.data.sizes[0]!,
        );
      } else setNotice(AI_IMAGE_UNAVAILABLE);
    });
    return () => {
      mounted.current = false;
    };
  }, [call, headless, providedStatus]);
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
    if (!requestId) {
      if (!headless) return;
      void call<readonly AiImageGenerationJob[]>(
        '/api/ai/threads/' + encodeURIComponent(threadId) + '/tool-image-generations',
        { signal: controller.signal },
      )
        .then((reply) => {
          if (
            !live ||
            version !== recoveryVersion.current ||
            !reply.ok ||
            !Array.isArray(reply.data)
          )
            return;
          const pending = reply.data.find((item) => item.threadId === threadId && !terminal(item));
          if (pending) follow(pending);
        })
        .catch(() => undefined);
      return () => {
        live = false;
        controller.abort();
      };
    }
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
      } else setNotice('Проверяю изображение…');
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
  function follow(value: AiImageGenerationJob) {
    if (!mounted.current || scope.current !== value.threadId) return;
    try {
      sessionStorage.setItem(key(value.threadId), value.requestId);
    } catch {
      /* Server pending receipt also recovers after reload. */
    }
    setJob(value);
    setUnresolved(!terminal(value));
    setCheck((n) => n + 1);
  }
  async function send(submittedPrompt = prompt, submittedSize = size) {
    if (
      inFlight.current ||
      disabled ||
      !submittedPrompt.trim() ||
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
          body: JSON.stringify({ requestId, prompt: submittedPrompt.trim(), size: submittedSize }),
        },
      );
      // Only this ASA admission-boundary receipt proves the fresh POST never
      // committed. A generic 4xx (or a later GET 404) cannot prove that.
      if (
        !result.ok &&
        result.error.code === 'ai_image_not_admitted' &&
        [400, 403, 429, 503].includes(result.status)
      ) {
        let receiptCleared = false;
        try {
          if (sessionStorage.getItem(key(id)) === requestId) sessionStorage.removeItem(key(id));
          receiptCleared = sessionStorage.getItem(key(id)) === null;
        } catch {
          // Keep the saved UUID when storage cannot confirm its removal.
        }
        if (!mounted.current || scope.current !== id) return;
        // Fence an early GET synchronously, before React runs effect cleanup.
        recoveryVersion.current += 1;
        setJob(null);
        setUnresolved(false);
        setNotice(aiPublicErrorMessage(result.error.code, AI_IMAGE_UNAVAILABLE));
        if (receiptCleared) onNotAdmitted?.(submittedPrompt);
        if (initial && result.status === 403 && receiptCleared) onDefiniteThreadDenial?.(id);
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
        onPromptChange?.('');
      } else
        setNotice(
          result.status
            ? aiPublicErrorMessage(result.error.code, AI_IMAGE_UNAVAILABLE)
            : 'Проверяю изображение…',
        );
      setCheck((n) => n + 1);
    } catch {
      if (mounted.current) setNotice(AI_IMAGE_UNAVAILABLE);
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
  const automaticStarted = useRef(false);
  const submitLatest = useRef(() => void send());
  submitLatest.current = () => void send();
  useEffect(() => {
    if (
      autoSubmit &&
      !automaticStarted.current &&
      !disabled &&
      status?.enabled &&
      status.ready &&
      status.remainingToday > 0 &&
      !unresolved
    ) {
      automaticStarted.current = true;
      submitLatest.current();
    }
  }, [autoSubmit, disabled, status, unresolved]);
  useImperativeHandle(controllerRef, () => ({ submit: send, cancel, follow }));
  useEffect(() => {
    onStateChange?.({
      busy: sending || !!pending || unresolved,
      canCancel: !!pending && !job.cancelRequested,
      canSubmit:
        !disabled &&
        !sending &&
        !pending &&
        !unresolved &&
        !!status?.enabled &&
        status.ready &&
        status.remainingToday > 0,
      sizes: status?.sizes || [1024],
      notice:
        notice ||
        (job
          ? job.cancelRequested && !terminal(job)
            ? 'Отмена запрошена. Проверяем состояние задания…'
            : labels[job.state]
          : status && (!status.enabled || !status.ready)
            ? AI_IMAGE_UNAVAILABLE
            : status && status.remainingToday < 1
              ? AI_IMAGE_UNAVAILABLE
              : ''),
    });
  }, [disabled, sending, pending, job, unresolved, status, notice, onStateChange]);
  if (headless) return null;
  return (
    <section className="ai-image-mode" aria-label="Создать изображение">
      <form
        className="chat-composer compact ai-image-composer"
        data-composer-state={sending || pending ? 'busy' : !prompt ? 'idle' : 'ready'}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          autoFocus
          aria-label="Описание изображения"
          placeholder="Опишите изображение"
          maxLength={3000}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            onPromptChange?.(event.target.value);
          }}
          disabled={sending || !!pending || disabled}
          rows={1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="chat-composer-controls">
          <details className="chat-tools-menu">
            <summary
              className="chat-attach-button"
              aria-label="Настройки изображения"
              title="Настройки изображения"
            >
              <span aria-hidden="true">+</span>
            </summary>
            <div className="chat-tools-popup ai-image-options">
              <label>
                <span>Создать изображение</span>
                <select
                  aria-label="Режим создания изображений"
                  value={modeChoice}
                  disabled={sending || !!pending || unresolved}
                  onChange={(event) => {
                    const choice = event.target.value as ImageGenerationMode;
                    if (onModeChange) onModeChange(choice);
                    else if (choice !== 'flux2-klein-4b-v1') onClose();
                  }}
                >
                  <option value="off">Выключено</option>
                  <option value="auto">Авто</option>
                  <option value="flux2-klein-4b-v1">FLUX.2 Klein 4B</option>
                </select>
              </label>
              <label>
                <span>Размер PNG</span>
                <select
                  aria-label="Размер изображения"
                  value={size}
                  onChange={(event) => setSize(Number(event.target.value) as AiImageSize)}
                  disabled={sending || !!pending}
                >
                  {(status?.sizes || [1024]).map((value) => (
                    <option key={value} value={value}>
                      {aiImageSizeLabel(value as AiImageSize)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <div className="chat-composer-end">
            <span className="chat-tools-model-caption">FLUX.2 Klein 4B</span>
            <button
              className="ai-image-exit"
              type="button"
              aria-label="К текстовому чату"
              title="Выключить создание изображений"
              disabled={sending || !!pending || unresolved}
              onClick={onClose}
            >
              <span aria-hidden="true">×</span>
            </button>
            <button
              className="chat-send-button"
              type={pending ? 'button' : 'submit'}
              aria-label={pending ? 'Отменить задание' : 'Создать изображение'}
              disabled={
                pending
                  ? !!job?.cancelRequested
                  : disabled ||
                    sending ||
                    unresolved ||
                    !status?.enabled ||
                    !status.ready ||
                    status.remainingToday < 1 ||
                    !prompt.trim()
              }
              onClick={pending ? () => void cancel() : undefined}
            >
              {pending ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5m-6 6 6-6 6 6" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </form>
      {unresolved && !job ? (
        <button type="button" onClick={() => setCheck((n) => n + 1)}>
          Проверить статус задания
        </button>
      ) : null}
      <p role="status" className={notice || job || !status?.ready ? 'ai-image-status' : 'sr-only'}>
        {notice ||
          (job
            ? job.cancelRequested && !terminal(job)
              ? 'Отмена запрошена. Проверяем состояние задания…'
              : labels[job.state]
            : status
              ? !status.enabled
                ? AI_IMAGE_UNAVAILABLE
                : !status.ready
                  ? AI_IMAGE_UNAVAILABLE
                  : 'Доступно до 00:00 UTC: ' + status.remainingToday
              : 'Проверяем доступность…')}
      </p>
    </section>
  );
}
