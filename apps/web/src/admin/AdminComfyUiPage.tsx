import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiImageGenerationAdminConfig, AiImageRecipe } from '@asa-lab/contracts';
import { AdminAiImages } from './AdminAiImages';
import { AdminComfyImageTest } from './AdminComfyImageTest';
import { call } from './admin-api';
import { newClientId } from '../client-id';
import './ai-image-workbench.css';

interface ComfyUiStatus {
  connected: true;
  baseUrl: string;
  version: string;
  diffusionModels: readonly string[];
  textEncoders: readonly string[];
  vaeModels: readonly string[];
  fluxKlein4bFound: boolean;
  checkedAt: string;
  recipe?: AiImageRecipe;
  recipeReady?: boolean;
  recipeReason?: string | null;
  devices?: readonly { name: string; vramTotalBytes: number | null }[];
}

function validStatus(value: unknown): value is ComfyUiStatus {
  const p = value as ComfyUiStatus | null;
  return (
    !!p &&
    p.connected === true &&
    typeof p.baseUrl === 'string' &&
    typeof p.version === 'string' &&
    [p.diffusionModels, p.textEncoders, p.vaeModels].every(
      (models) => Array.isArray(models) && models.every((name) => typeof name === 'string'),
    )
  );
}

export function AdminComfyUiPage({
  onAccessDenied,
  principalId,
}: {
  onAccessDenied: () => void;
  principalId?: string;
}) {
  const [tab, setTab] = useState<'local' | 'api'>('local');
  const [imageConfig, setImageConfig] = useState<AiImageGenerationAdminConfig | null>(null);
  const [details, setDetails] = useState<ComfyUiStatus | null>(null);
  const [config, setConfig] = useState<{
    configurationVersion: number;
    baseUrl: string;
    source: string;
  } | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const flight = useRef(false);
  const generation = useRef(0);
  const [statusReload, setStatusReload] = useState(0);
  const onImageConfigChange = useCallback(
    (next: AiImageGenerationAdminConfig | null) => setImageConfig(next),
    [],
  );

  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    setLoading(true);
    void call<{ configurationVersion: number; baseUrl: string; source: string }>(
      '/api/admin/v1/ai/comfyui/settings',
    )
      .then(async (reply) => {
        if (!active || request !== generation.current) return;
        if (!reply.ok) {
          if ([401, 403].includes(reply.status)) onAccessDenied();
          setError(reply.error.message);
          return;
        }
        setConfig(reply.data);
        setUrl(reply.data.baseUrl);
        const response = await call<ComfyUiStatus>('/api/admin/v1/ai/comfyui/status');
        if (!active || request !== generation.current) return;
        if (
          response.ok &&
          validStatus(response.data) &&
          response.data.baseUrl === reply.data.baseUrl
        ) {
          setDetails(response.data);
          setError('');
        } else if (!response.ok) {
          if ([401, 403].includes(response.status)) onAccessDenied();
          setError(response.error.message || 'ComfyUI недоступен.');
        } else setError('Настройки изменились или ответ сервера несовместим. Повторите проверку.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [onAccessDenied]);

  // Re-evaluate the selected saved recipe after a profile save, not just at first mount.
  useEffect(() => {
    if (!imageConfig) return;
    let active = true;
    void call<ComfyUiStatus>('/api/admin/v1/ai/comfyui/status').then((result) => {
      if (active && result.ok && validStatus(result.data)) setDetails(result.data);
    });
    return () => {
      active = false;
    };
  }, [imageConfig?.configurationVersion, statusReload]);

  async function connect(save: boolean) {
    if (!config || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const request = ++generation.current;
    try {
      const signature = JSON.stringify({ url, version: config.configurationVersion });
      if (save && attempt.current?.signature !== signature)
        attempt.current = { signature, id: newClientId() };
      const reply = await call<ComfyUiStatus | { config: typeof config; status: ComfyUiStatus }>(
        '/api/admin/v1/ai/comfyui/' + (save ? 'settings' : 'probe'),
        {
          method: save ? 'PUT' : 'POST',
          body: JSON.stringify({
            baseUrl: url,
            ...(save
              ? { configurationVersion: config.configurationVersion, requestId: attempt.current!.id }
              : {}),
          }),
        },
      );
      if (request !== generation.current) return;
      if (!reply.ok) {
        if ([401, 403].includes(reply.status)) onAccessDenied();
        setError(reply.error.message);
        return;
      }
      const next = reply.data;
      const status = 'status' in next ? next.status : next;
      if (!validStatus(status)) {
        setError('Несовместимый ответ ComfyUI.');
        return;
      }
      setDetails(status);
      if ('config' in next) {
        attempt.current = null;
        setConfig(next.config);
        setUrl(next.config.baseUrl);
        setNotice('Адрес сохранён. Готовность профиля проверяется отдельно.');
      } else
        setNotice(
          status.baseUrl === config.baseUrl
            ? 'Связь проверена · генерация не запускалась'
            : 'Адрес проверен · ещё не сохранён',
        );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  const model = details?.diffusionModels.find((name) => /flux-2-klein-4b/i.test(name));
  const encoder = details?.textEncoders.find((name) => /qwen_3_4b/i.test(name));
  const vae = details?.vaeModels.find((name) => /flux2[-_]vae/i.test(name));
  const savedReady = imageConfig?.ready && imageConfig.enabled;
  const gpu = details?.devices?.[0];

  return (
    <section className="asa-image-workbench" aria-label="Управление генерацией изображений">
      <header className="asa-image-workbench-heading">
        <div>
          <h2>Изображения</h2>
          <p>Источники генерации, настройки и тестовый результат</p>
        </div>
        <button type="button" className="asa-image-refresh" onClick={() => setStatusReload((n) => n + 1)}>
          Проверить состояние
        </button>
      </header>
      <div className="asa-image-subtabs" role="tablist" aria-label="Источник генерации">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'local'}
          aria-controls="asa-image-tab-local"
          id="asa-image-tab-local-button"
          onClick={() => setTab('local')}
        >
          Локальный ComfyUI
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'api'}
          aria-controls="asa-image-tab-api"
          id="asa-image-tab-api-button"
          onClick={() => setTab('api')}
        >
          API-провайдеры
        </button>
      </div>
      {tab === 'local' ? (
        <div id="asa-image-tab-local" role="tabpanel" aria-labelledby="asa-image-tab-local-button">
          <div className="asa-image-overview" aria-label="Состояние локальной генерации">
            <div>
              <span>Сервер</span>
              <strong>{details ? 'ComfyUI подключён' : loading ? 'Проверяем…' : 'Нет связи'}</strong>
              <small>{details ? 'v' + details.version : 'Сохранённое подключение'}</small>
            </div>
            <div>
              <span>Видеокарта</span>
              <strong>{gpu?.name?.replace(/^cuda:\d+\s*/, '') || 'Не определена'}</strong>
              <small>{gpu?.vramTotalBytes ? (gpu.vramTotalBytes / 1024 ** 3).toFixed(1) + ' ГБ VRAM' : 'Данные GPU'}</small>
            </div>
            <div>
              <span>Профиль генерации</span>
              <strong className={savedReady ? 'asa-image-ok' : 'asa-image-attention'}>
                {savedReady ? 'Готов' : imageConfig ? 'Требует настройки' : 'Проверяем…'}
              </strong>
              <small>{imageConfig?.recipe === 'flux2-klein-4b-fp8-izo-v1' ? 'FLUX.2 · ИЗО FP8' : 'FLUX.2 · исходный FP4'}</small>
            </div>
          </div>
          {error ? <p role="alert" className="asa-image-error">{error}</p> : null}
          <div className="asa-image-workbench-grid">
            <AdminAiImages onAccessDenied={onAccessDenied} onConfigChange={onImageConfigChange} />
            {principalId ? (
              <AdminComfyImageTest principalId={principalId} config={imageConfig} />
            ) : null}
          </div>
          <details className="asa-image-connection-detail">
            <summary>
              Подключение ComfyUI
              <span>{config?.baseUrl || 'Адрес не загружен'}</span>
            </summary>
            <div className="asa-image-connection-fields">
              <label>
                Адрес сервера
                <input
                  aria-label="Адрес ComfyUI"
                  type="url"
                  value={url}
                  placeholder="http://192.168.1.20:8188"
                  maxLength={256}
                  disabled={loading || busy || !config}
                  onChange={(event) => {
                    generation.current++;
                    setUrl(event.target.value);
                    setDetails(null);
                    setError('');
                    setNotice('');
                  }}
                />
              </label>
              <div className="asa-image-connection-actions">
                <button type="button" disabled={loading || busy || !url || !config} onClick={() => void connect(false)}>
                  Проверить
                </button>
                <button
                  type="button"
                  disabled={loading || busy || !url || !config || url === config.baseUrl}
                  onClick={() => void connect(true)}
                >
                  Сохранить адрес
                </button>
              </div>
              {notice ? <p role="status">{notice}</p> : null}
              <small>Проверка не выполняет генерацию. Адрес проверяется из API ASA Lab, не из браузера.</small>
            </div>
          </details>
          <details className="asa-image-connection-detail asa-image-diagnostics">
            <summary>
              Диагностика ComfyUI
              <span>{details?.recipeReady === true ? 'Workflow совместим' : details ? 'Проверить профиль' : 'Нет данных'}</span>
            </summary>
            <div className="asa-image-diagnostic-body">
              <p role="status">
                {details?.recipeReady === true
                  ? 'Сохранённый профиль и workflow ASA совместимы.'
                  : details?.recipeReady === false
                    ? 'Связь есть · workflow ASA пока не совместим. ' + (details.recipeReason || '')
                    : 'Сначала проверьте подключение.'}
              </p>
              <div className="asa-image-file-grid">
                <div><span>Диффузия</span><strong>{model || 'Не найдена'}</strong></div>
                <div><span>Энкодер</span><strong>{encoder || 'Не найден'}</strong></div>
                <div><span>VAE</span><strong>{vae || 'Не найден'}</strong></div>
              </div>
              <small>
                Проверка наличия файлов и узлов не заменяет реальный GPU-тест. SHA-256 и размер
                весов подтверждаются отдельно.
              </small>
              <a
                href="https://github.com/spikeal8-maker/asa-lab/blob/main/docs/deployment/COMFYUI_LOCAL_IMAGES.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Инструкция: модели, запуск, видеокарта, сеть и перенос
              </a>
              <details className="asa-image-more">
                <summary>Какие файлы нужны для FP4 и FP8</summary>
                <p>
                  FP4: flux-2-klein-4b-fp8.safetensors, qwen_3_4b_fp4_flux2.safetensors,
                  flux2-vae.safetensors. FP8 ИЗО: тот же FLUX, qwen_3_4b.safetensors
                  и flux2-vae.safetensors. Не переименовывайте файлы для обхода проверки.
                </p>
              </details>
              <small>{details?.baseUrl || ''}</small>
              <small>Сервер изображений {details ? 'Подключено · v' + details.version : 'Нет связи'}</small>
              <small>{details?.devices?.map((d) => d.name).join('; ') || 'GPU неизвестен'}</small>
            </div>
          </details>
        </div>
      ) : (
        <section id="asa-image-tab-api" role="tabpanel" aria-labelledby="asa-image-tab-api-button" className="asa-image-api-panel">
          <div className="asa-image-panel-heading">
            <div>
              <h3>Polza AI</h3>
              <p>API-провайдер генерации изображений</p>
            </div>
            <span className="asa-image-state is-warning">Не подключён</span>
          </div>
          <p>
            API-генерация пока не подключена к ASA Lab. Ключи, список моделей,
            доступ пользователям и платные пробные запросы будут настраиваться
            здесь после отдельной серверной интеграции.
          </p>
          <div className="asa-image-api-steps" aria-label="Будущие настройки API">
            <span>1. Защищённый API-ключ</span>
            <span>2. Каталог моделей</span>
            <span>3. Доступ и лимиты</span>
            <span>4. Пробная генерация</span>
          </div>
          <a href="https://polza.ai/collections/image" target="_blank" rel="noopener noreferrer">
            Посмотреть модели изображений Polza AI
          </a>
          <p className="asa-image-muted">
            Ключи не вводятся на этой странице до реализации зашифрованного хранения и
            контроля расходов. Локальный ComfyUI продолжает работать независимо.
          </p>
        </section>
      )}
    </section>
  );
}
