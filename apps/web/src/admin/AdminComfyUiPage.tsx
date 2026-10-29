import { useEffect, useRef, useState } from 'react';
import { AdminAiImages } from './AdminAiImages';
import '../ai/ai-image-generation.css';
import { call } from './admin-api';
import { newClientId } from '../client-id';
import './ai-ollama.css';

interface ComfyUiStatus {
  connected: true;
  baseUrl: string;
  version: string;
  diffusionModels: readonly string[];
  textEncoders: readonly string[];
  vaeModels: readonly string[];
  fluxKlein4bFound: boolean;
  checkedAt: string;
  recipeReady?: boolean;
  devices?: readonly { name: string; vramTotalBytes: number | null }[];
}

function validStatus(v: unknown): v is ComfyUiStatus {
  const p = v as ComfyUiStatus | null;
  return (
    !!p &&
    p.connected === true &&
    typeof p.baseUrl === 'string' &&
    typeof p.version === 'string' &&
    [p.diffusionModels, p.textEncoders, p.vaeModels].every(
      (a) => Array.isArray(a) && a.every((n) => typeof n === 'string'),
    )
  );
}

export function AdminComfyUiPage({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [details, setDetails] = useState<ComfyUiStatus | null>(null);
  const [config, setConfig] = useState<{
    configurationVersion: number;
    baseUrl: string;
    source: string;
  } | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const flight = useRef(false),
    generation = useRef(0);
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
        setNotice('Адрес сохранён. Обновите настройки изображений выше.');
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

  return (
    <>
      <AdminAiImages onAccessDenied={onAccessDenied} />
      <section className="asa-ai-comfy asa-comfy-connection" aria-label="Подключение ComfyUI">
        <div className="asa-ai-provider-identity">
          <h3>Подключение ComfyUI</h3>
          <span className="asa-ai-provider-subtitle">
            Этот компьютер или другой узел в локальной сети
          </span>
        </div>
        <label className="asa-comfy-url">
          Адрес сервера
          <input
            aria-label="Адрес ComfyUI"
            type="url"
            value={url}
            placeholder="http://192.168.1.20:8188"
            maxLength={256}
            disabled={loading || busy || !config}
            onChange={(e) => {
              generation.current++;
              setUrl(e.target.value);
              setDetails(null);
              setError('');
              setNotice('');
            }}
          />
        </label>
        <div className="asa-comfy-actions">
          <button
            type="button"
            disabled={loading || busy || !url || !config}
            onClick={() => void connect(false)}
          >
            Проверить
          </button>
          <button
            type="button"
            disabled={loading || busy || !url || !config || url === config.baseUrl}
            onClick={() => void connect(true)}
          >
            Сохранить адрес
          </button>
          <span role="status">
            {loading ? 'Получаем настройки…' : busy ? 'Проверяем…' : notice}
          </span>
        </div>
        <small>
          Адрес проверяет сервер ASA, а не браузер. Смена узла недоступна, пока есть незавершённые
          задания.
        </small>
        {error ? (
          <div role="alert" className="asa-ai-ollama-error">
            {error}
          </div>
        ) : null}

        <section className="asa-comfy-help">
          <h3>Модели и профиль видеокарты 12 ГБ</h3>
          <p>
            Проверенный профиль ИЗО: RTX 3060 12 ГБ, FLUX.2 Klein 4B FP8, Qwen3 4B FP8, Flux2 VAE,
            одно изображение за раз. Начинать с 1024×1024 или 1536×864 / 864×1536. Для другой 12-ГБ
            карты нужна повторная проверка.
          </p>
          <p>
            Исходный профиль ASA FP4 использует комплект:{' '}
            <code>flux-2-klein-4b-fp8.safetensors</code>,{' '}
            <code>qwen_3_4b_fp4_flux2.safetensors</code>, <code>flux2-vae.safetensors</code>. Нельзя
            заменять FP4 переименованным FP8. Связь и наличие файлов ещё не доказывают готовность
            генерации.
          </p>
          <p>
            Профиль ИЗО FP8 выбирается отдельно в настройках изображений и использует{' '}
            <code>qwen_3_4b.safetensors</code>. Имя файла не подтверждает FP8: нужны размер и
            SHA-256 из инструкции.
          </p>
          <p>
            Локальный сервер — компьютер API ASA, а не компьютер браузера. В Docker:{' '}
            <code>http://host.docker.internal:8188</code>; на том же host без Docker:{' '}
            <code>http://127.0.0.1:8188</code>; другой компьютер: его частный IP и порт ComfyUI.
            Порт 11434 обычно принадлежит Ollama.
          </p>
          <a
            href="https://github.com/spikeal8-maker/asa-lab/blob/main/docs/deployment/COMFYUI_LOCAL_IMAGES.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Инструкция: модели, запуск, видеокарта, сеть и перенос
          </a>
        </section>
        <details>
          <summary>Техническое состояние ComfyUI</summary>
          <div className="asa-ai-provider-top">
            <div className="asa-ai-provider-identity">
              <h3>Сервер изображений</h3>
              <span className="asa-ai-provider-subtitle">Изображения · собственный GPU</span>
            </div>
            <div className="asa-ai-comfy-state" role="status">
              <span
                className={
                  'asa-ai-status-dot ' + (details ? 'online' : error ? 'offline' : 'loading')
                }
                aria-hidden="true"
              />
              {loading
                ? 'Поиск сервера…'
                : details
                  ? 'Подключено · v' + details.version
                  : 'Нет связи'}
            </div>
          </div>

          {details ? (
            <>
              <div className="asa-ai-comfy-model">
                <span className="asa-ai-comfy-eyebrow">Обнаруженная модель</span>
                <strong>
                  {details.fluxKlein4bFound
                    ? 'FLUX.2 Klein 4B'
                    : (model ?? 'Совместимая FLUX.2 Klein 4B не найдена')}
                </strong>
                <span className="asa-ai-comfy-description">
                  {details.fluxKlein4bFound
                    ? 'Модель, энкодер и VAE обнаружены'
                    : 'Для работы необходимы модель, текстовый энкодер и VAE'}
                </span>
              </div>
              <div className="asa-ai-comfy-files">
                <div>
                  <span>Диффузия</span>
                  <strong>{model ?? 'Не найдена'}</strong>
                </div>
                <div>
                  <span>Энкодер</span>
                  <strong>{encoder ?? 'Не найден'}</strong>
                </div>
                <div>
                  <span>VAE</span>
                  <strong>{vae ?? 'Не найден'}</strong>
                </div>
              </div>
              <div className="asa-ai-comfy-footer">
                <span>{details.baseUrl}</span>
                <span>
                  {details.recipeReady === true
                    ? 'Workflow ASA совместим'
                    : details.recipeReady === false
                      ? 'Связь есть · workflow ASA пока не совместим'
                      : 'Workflow ASA ещё не проверен'}
                </span>
              </div>
            </>
          ) : null}
        </details>
        {details?.devices?.length ? (
          <div className="asa-comfy-devices">
            {details.devices.map((d, i) => (
              <small key={i}>
                {d.name}
                {d.vramTotalBytes
                  ? ' · ' + (d.vramTotalBytes / 1024 ** 3).toFixed(1) + ' ГБ VRAM'
                  : ''}
              </small>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
