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
    ) &&
    (p.devices === undefined ||
      (Array.isArray(p.devices) &&
        p.devices.every(
          (device) =>
            device &&
            typeof device.name === 'string' &&
            (device.vramTotalBytes === null ||
              (typeof device.vramTotalBytes === 'number' &&
                Number.isFinite(device.vramTotalBytes) &&
                device.vramTotalBytes >= 0)),
        )))
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
  const [connectionVerified, setConnectionVerified] = useState(false);
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
  const statusGeneration = useRef(0);
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
        // The status is checked separately with the saved image configuration.
        // This avoids racing two responses with different recipe revisions.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [onAccessDenied]);

  // Never leave a stale green indicator or an active preview after a failed probe.
  // Revalidate when the saved profile, endpoint, or explicit refresh changes.
  useEffect(() => {
    if (!imageConfig || !config) return;
    const request = ++statusGeneration.current;
    let active = true;
    setDetails(null);
    setConnectionVerified(false);
    setError('');
    void call<ComfyUiStatus>('/api/admin/v1/ai/comfyui/status')
      .then((result) => {
        if (!active || request !== statusGeneration.current) return;
        if (result.ok && validStatus(result.data) && result.data.baseUrl === config.baseUrl) {
          setDetails(result.data);
          setConnectionVerified(true);
          setError('');
        } else {
          setDetails(null);
          setConnectionVerified(false);
          if (!result.ok && [401, 403].includes(result.status)) onAccessDenied();
          setError(
            !result.ok
              ? result.error.message || 'ComfyUI недоступен.'
              : 'Ответ ComfyUI устарел или несовместим. Проверьте подключение.',
          );
        }
      })
      .catch(() => {
        if (!active || request !== statusGeneration.current) return;
        setDetails(null);
        setConnectionVerified(false);
        setError('Не удалось проверить состояние ComfyUI.');
      });
    return () => {
      active = false;
    };
  }, [imageConfig?.configurationVersion, config?.baseUrl, statusReload]);

  async function connect(save: boolean) {
    if (!config || flight.current) return;
    flight.current = true;
    statusGeneration.current++;
    setBusy(true);
    setError('');
    setNotice('');
    // A failed manual check must never leave the previous GPU marked as ready.
    setDetails(null);
    setConnectionVerified(false);
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
              ? {
                  configurationVersion: config.configurationVersion,
                  requestId: attempt.current!.id,
                }
              : {}),
          }),
        },
      );
      if (request !== generation.current) return;
      if (!reply.ok) {
        if ([401, 403].includes(reply.status)) onAccessDenied();
        setDetails(null);
        setConnectionVerified(false);
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
      setConnectionVerified(status.baseUrl === config.baseUrl || 'config' in next);
      if ('config' in next) {
        attempt.current = null;
        setConfig(next.config);
        setUrl(next.config.baseUrl);
        setImageConfig(null);
        setStatusReload((n) => n + 1);
        setNotice('Адрес сохранён. Готовность профиля проверяется отдельно.');
      } else
        setNotice(
          status.baseUrl === config.baseUrl
            ? 'Связь проверена · генерация не запускалась'
            : 'Адрес проверен · ещё не сохранён',
        );
    } catch {
      if (request === generation.current) {
        setDetails(null);
        setConnectionVerified(false);
        setError(
          save
            ? 'Результат сохранения адреса не подтверждён. Обновите настройки и повторно проверьте подключение.'
            : 'Нет связи с ComfyUI. Проверьте адрес и доступность сервера.',
        );
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  const model = details?.diffusionModels.find((name) => /flux-2-klein-4b/i.test(name));
  const encoder = details?.textEncoders.find((name) => /qwen_3_4b/i.test(name));
  const vae = details?.vaeModels.find((name) => /flux2[-_]vae/i.test(name));
  // A connected ComfyUI is not proof that its workflow matches the selected
  // persisted image recipe. Stale image-config readiness must fail closed.
  const savedReady =
    connectionVerified &&
    imageConfig?.enabled === true &&
    imageConfig.ready === true &&
    details?.recipeReady === true &&
    details.recipe === imageConfig.recipe;
  const gpuSummary = details?.devices?.length
    ? details.devices
        .map(
          (device) =>
            device.name.replace(/^cuda:\d+\s*/, '') +
            (device.vramTotalBytes
              ? ' · ' + (device.vramTotalBytes / 1024 ** 3).toFixed(1) + ' ГБ VRAM'
              : ''),
        )
        .join('; ')
    : 'GPU не определён';

  return (
    <section className="asa-image-workbench" aria-label="Управление генерацией изображений">
      <header className="asa-image-workbench-heading">
        <h2>Изображения</h2>
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
          ComfyUI
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
          <section className="asa-image-connection" aria-label="Подключение ComfyUI">
            <div className="asa-image-connection-fields">
              <label>
                Адрес ComfyUI
                <input
                  aria-label="Адрес ComfyUI"
                  type="url"
                  value={url}
                  placeholder="http://192.168.1.20:8188"
                  maxLength={256}
                  disabled={loading || busy || !config}
                  onChange={(event) => {
                    generation.current++;
                    statusGeneration.current++;
                    setUrl(event.target.value);
                    setDetails(null);
                    setConnectionVerified(false);
                    setError('');
                    setNotice('');
                  }}
                />
              </label>
              <div className="asa-image-connection-actions">
                <button
                  type="button"
                  disabled={loading || busy || !url || !config}
                  onClick={() => void connect(false)}
                >
                  Проверить адрес
                </button>
                <button
                  type="button"
                  disabled={loading || busy || !url || !config || url === config.baseUrl}
                  onClick={() => void connect(true)}
                >
                  Сохранить адрес
                </button>
                <button
                  type="button"
                  className="asa-image-refresh"
                  aria-label="Проверить состояние"
                  title="Проверить состояние"
                  disabled={loading || busy}
                  onClick={() => {
                    generation.current++;
                    statusGeneration.current++;
                    setDetails(null);
                    setConnectionVerified(false);
                    setStatusReload((n) => n + 1);
                  }}
                >
                  ↻
                </button>
              </div>
              <p className="asa-image-connection-status" aria-label="Состояние локальной генерации">
                {details && connectionVerified
                  ? 'ComfyUI подключён · v' +
                    details.version +
                    ' · ' +
                    gpuSummary +
                    (imageConfig && !savedReady ? ' · Профиль не готов' : '')
                  : details
                    ? 'Адрес проверен, ещё не сохранён · ' + gpuSummary
                    : error
                      ? 'Нет связи с ComfyUI'
                      : 'Проверяем ComfyUI…'}
              </p>
              {error ? (
                <p role="alert" className="asa-image-error">
                  {error}
                </p>
              ) : null}
              {notice ? <p role="status">{notice}</p> : null}
            </div>
          </section>
          <div className="asa-image-workbench-grid">
            <AdminAiImages
              onAccessDenied={onAccessDenied}
              onConfigChange={onImageConfigChange}
              refreshToken={statusReload}
            />
            {principalId ? (
              <AdminComfyImageTest
                principalId={principalId}
                config={savedReady ? imageConfig : null}
                refreshToken={statusReload}
              />
            ) : null}
          </div>
          <details className="asa-image-connection-detail asa-image-diagnostics">
            <summary>Технические сведения</summary>
            <div className="asa-image-diagnostic-body">
              <p>
                {details?.recipeReason ||
                  (details ? 'Проверка файлов выполнена.' : 'Нет данных проверки.')}
              </p>
              <div className="asa-image-file-grid">
                <div>
                  <span>Диффузия</span>
                  <strong>{model || 'Не найдена'}</strong>
                </div>
                <div>
                  <span>Энкодер</span>
                  <strong>{encoder || 'Не найден'}</strong>
                </div>
                <div>
                  <span>VAE</span>
                  <strong>{vae || 'Не найден'}</strong>
                </div>
              </div>
              <p>
                FP4: flux-2-klein-4b-fp8.safetensors, qwen_3_4b_fp4_flux2.safetensors,
                flux2-vae.safetensors. FP8 ИЗО: тот же FLUX, qwen_3_4b.safetensors и VAE.
              </p>
              <a
                href="https://github.com/spikeal8-maker/asa-lab/blob/main/docs/deployment/COMFYUI_LOCAL_IMAGES.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                Инструкция: модели, запуск, видеокарта, сеть и перенос
              </a>
              <small>SHA-256 весов и реальная GPU-генерация не подтверждены.</small>
            </div>
          </details>
        </div>
      ) : (
        <section
          id="asa-image-tab-api"
          role="tabpanel"
          aria-labelledby="asa-image-tab-api-button"
          className="asa-image-api-panel"
        >
          <div className="asa-image-panel-heading">
            <div>
              <h3>Polza AI</h3>
              <p>API-провайдер генерации изображений</p>
            </div>
            <span className="asa-image-state is-warning">Не подключён</span>
          </div>
          <p>
            API-генерация пока не подключена к ASA Lab. Ключи, список моделей, доступ пользователям
            и платные пробные запросы будут настраиваться здесь после отдельной серверной
            интеграции.
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
            Ключи не вводятся на этой странице до реализации зашифрованного хранения и контроля
            расходов. ComfyUI продолжает работать независимо.
          </p>
        </section>
      )}
    </section>
  );
}
