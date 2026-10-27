import { useEffect, useState } from 'react';
import { AdminAiImages } from './AdminAiImages';
import '../ai/ai-image-generation.css';
import { call } from './admin-api';
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
}

export function AdminComfyUiPage({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [details, setDetails] = useState<ComfyUiStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void call<ComfyUiStatus>('/api/admin/v1/ai/comfyui/status')
      .then((response) => {
        if (!active) return;
        if (response.ok) {
          setDetails(response.data);
          setError('');
        } else {
          if (response.status === 401 || response.status === 403) onAccessDenied();
          setError(response.error.message || 'ComfyUI недоступен.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onAccessDenied]);

  const model = details?.diffusionModels.find((name) => /flux-2-klein-4b/i.test(name));
  const encoder = details?.textEncoders.find((name) => /qwen_3_4b/i.test(name));
  const vae = details?.vaeModels.find((name) => /flux2[-_]vae/i.test(name));

  return (
    <>
      <AdminAiImages onAccessDenied={onAccessDenied} />
      <details className="asa-ai-comfy">
        <summary>Техническое состояние ComfyUI</summary>
        <div className="asa-ai-provider-top">
          <div className="asa-ai-provider-identity">
            <h3>Локальный сервер</h3>
            <span className="asa-ai-provider-subtitle">Изображения · локальный GPU</span>
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

        {error ? (
          <div role="alert" className="asa-ai-ollama-error">
            {error}
          </div>
        ) : null}

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
              <span>Граф генерации ещё не проверен</span>
            </div>
          </>
        ) : null}
      </details>
    </>
  );
}
