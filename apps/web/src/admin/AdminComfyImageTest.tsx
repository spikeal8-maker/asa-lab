import { AI_IMAGE_PRESETS, type AiImageGenerationAdminConfig, type AiImageGenerationJob, type AiImageGenerationStatus, type AiImageSize } from '@asa-lab/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api-call';
import {
  AiImageGeneration,
  imageGenerationStatusShape,
  type ImageComposerController,
  type ImageComposerState,
} from '../ai/AiImageGeneration';
import { AiGeneratedImage } from '../ai/AiGeneratedImage';

const initialState: ImageComposerState = {
  busy: false,
  canCancel: false,
  canSubmit: false,
  notice: '',
  sizes: [1024],
};

export function AdminComfyImageTest({
  principalId,
  config,
}: {
  principalId: string;
  config: AiImageGenerationAdminConfig | null;
}) {
  const storageKey = 'asa-ai-image-admin-preview:' + principalId;
  const [threadId, setThreadId] = useState<string | null>(() => {
    try {
      const value = sessionStorage.getItem(storageKey);
      return value && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value) ? value : null;
    } catch {
      return null;
    }
  });
  const [status, setStatus] = useState<AiImageGenerationStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<AiImageSize>(1024);
  const [state, setState] = useState<ImageComposerState>(initialState);
  const [job, setJob] = useState<AiImageGenerationJob | null>(null);
  const controller = useRef<ImageComposerController>(null);
  const creating = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setStatus(null);
    setLoadError('');
    void call<AiImageGenerationStatus>('/api/ai/image-generation/status').then((response) => {
      if (!live) return;
      if (response.ok && imageGenerationStatusShape(response.data)) {
        setStatus(response.data);
        setSize((previous) =>
          response.data.sizes.includes(previous) ? previous : response.data.sizes[0]!,
        );
      } else {
        setLoadError(
          response.ok
            ? 'API вернул несовместимый статус генерации.'
            : response.error.message,
        );
      }
    });
    return () => {
      live = false;
    };
  }, [config?.configurationVersion]);

  const createThread = useCallback(async (): Promise<string | null> => {
    if (creating.current) return null;
    creating.current = true;
    try {
      const reply = await call<{ id: string }>('/api/ai/threads', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!reply.ok) {
        if (mounted.current) setLoadError(reply.error.message);
        return null;
      }
      if (!mounted.current) return null;
      setThreadId(reply.data.id);
      try {
        sessionStorage.setItem(storageKey, reply.data.id);
      } catch {
        // This only retains the personal thread pointer; submission persistence
        // inside AiImageGeneration still fails closed when sessionStorage is off.
      }
      return reply.data.id;
    } finally {
      creating.current = false;
    }
  }, [storageKey]);
  const onStateChange = useCallback((next: ImageComposerState) => setState(next), []);
  const onJobChange = useCallback((next: AiImageGenerationJob | null) => setJob(next), []);

  const ready = !!config?.enabled && !!config?.ready && !!status?.enabled && !!status?.ready;
  const configuredSizes = (status?.sizes || config?.sizes || [1024]).filter(
    (value) => AI_IMAGE_PRESETS.some((preset) => preset.id === value),
  );
  const currentSize = configuredSizes.includes(size) ? size : configuredSizes[0] || 1024;
  const canCreate =
    ready && state.canSubmit && !!prompt.trim() && prompt.length <= 3000 && !state.busy;

  return (
    <section className="asa-image-preview-panel" aria-label="Пробная генерация">
      <header className="asa-image-panel-heading">
        <div>
          <h3>Пробная генерация</h3>
          <p>Результат через тот же защищённый путь, что и в чате</p>
        </div>
        <span className={'asa-image-state ' + (ready ? 'is-ready' : 'is-warning')}>
          {ready ? 'GPU доступен' : 'Проверка недоступна'}
        </span>
      </header>
      <div className="asa-image-preview-body">
        <label>
          Описание изображения
          <textarea
            aria-label="Описание тестового изображения"
            placeholder="Например: небольшой учебный робот на светлом фоне"
            rows={3}
            value={prompt}
            maxLength={3000}
            disabled={state.busy}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="asa-image-preview-controls">
          <label>
            Размер
            <select
              aria-label="Размер тестового изображения"
              value={currentSize}
              disabled={state.busy}
              onChange={(event) => setSize(Number(event.target.value) as AiImageSize)}
            >
              {configuredSizes.map((value) => {
                const preset = AI_IMAGE_PRESETS.find((item) => item.id === value);
                return (
                  <option key={value} value={value}>
                    {preset ? preset.width + '×' + preset.height : value}
                  </option>
                );
              })}
            </select>
          </label>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => {
              setJob(null);
              void controller.current?.submit(prompt.trim(), currentSize);
            }}
          >
            Создать тестовое изображение
          </button>
          {state.canCancel ? (
            <button type="button" onClick={() => void controller.current?.cancel()}>
              Отменить
            </button>
          ) : null}
        </div>
        {loadError ? <p role="alert">{loadError}</p> : null}
        {state.notice ? <p role="status">{state.notice}</p> : null}
        {!ready && !loadError ? (
          <p className="asa-image-muted" role="status">
            Сначала сохраните совместимый профиль генерации. Кнопка не запускает
            задание, пока сервер не подтвердит готовность.
          </p>
        ) : null}
        {job?.state === 'complete' && job.image ? (
          <div className="asa-image-preview-result" aria-label="Результат теста">
            <AiGeneratedImage image={job.image} threadId={job.threadId} />
            <span>PNG сохранён в вашем личном ИИ-диалоге.</span>
          </div>
        ) : job?.state === 'failed' ? (
          <p role="alert">Генерация завершилась ошибкой: {job.errorCode || 'проверьте состояние сервера'}.</p>
        ) : null}
      </div>
      <details className="asa-image-more">
        <summary>Как работает проверка</summary>
        <p>
          Генерация использует персональный диалог, проверяет доступ и дневные лимиты,
          сохраняет исходное задание и PNG в защищённом хранилище. Неизвестный
          результат проверяется по ID без повторной отправки на GPU.
        </p>
      </details>
      <AiImageGeneration
        headless
        threadId={threadId}
        disabled={!ready}
        createThread={createThread}
        onComplete={() => undefined}
        onClose={() => undefined}
        onStateChange={onStateChange}
        onJobChange={onJobChange}
        providedStatus={status}
        controllerRef={controller}
      />
    </section>
  );
}
