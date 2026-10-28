import { AI_IMAGE_PRESETS } from '@asa-lab/contracts';
import { useEffect, useRef, useState } from 'react';
import type { AiImageGenerationAdminConfig, AiImageSize } from '@asa-lab/contracts';
import { call } from './admin-api';
import './ai-generation-policy.css';

export function AdminAiImages({ onAccessDenied }: { onAccessDenied: () => void }) {
  const [config, setConfig] = useState<AiImageGenerationAdminConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState(10);
  const [sizes, setSizes] = useState<readonly AiImageSize[]>([1024]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const lock = useRef(false);
  function apply(data: AiImageGenerationAdminConfig) {
    setConfig(data);
    setEnabled(data.enabled);
    setLimit(data.dailyLimit);
    setSizes(data.sizes);
  }
  useEffect(() => {
    let live = true;
    setConfig(null);
    void call<AiImageGenerationAdminConfig>('/api/admin/v1/ai/images').then((result) => {
      if (!live) return;
      if (
        result.ok &&
        result.data.recipe === 'flux2-klein-4b-v1' &&
        Array.isArray(result.data.sizes)
      ) {
        apply(result.data);
        setNotice('');
        attempt.current = null;
      } else {
        if (!result.ok && [401, 403].includes(result.status)) onAccessDenied();
        setNotice('Настройки изображений недоступны. Проверьте обновление API.');
      }
    });
    return () => {
      live = false;
    };
  }, [onAccessDenied, reload]);
  async function save() {
    if (
      !config ||
      lock.current ||
      !sizes.length ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    const update = {
      configurationVersion: config.configurationVersion,
      enabled,
      dailyLimit: limit,
      globalConcurrency: config.globalConcurrency,
      sizes,
    };
    const signature = JSON.stringify(update);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await call<AiImageGenerationAdminConfig>('/api/admin/v1/ai/images', {
        method: 'PUT',
        body: JSON.stringify({ ...update, requestId: attempt.current.id }),
      });
      if (result.ok) {
        apply(result.data);
        attempt.current = null;
        setNotice('Настройки сохранены. Генерация не запускалась.');
      } else {
        if ([401, 403].includes(result.status)) onAccessDenied();
        setNotice(
          result.status === 409
            ? 'Настройки изменились. Загрузите актуальную версию перед сохранением.'
            : result.error.message,
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="asa-ai-comfy" aria-label="Настройки изображений">
      <div className="asa-ai-provider-top">
        <div className="asa-ai-provider-identity">
          <h2>Изображения</h2>
          <span className="asa-ai-provider-subtitle">
            ComfyUI · локальный GPU · FLUX.2 Klein 4B
          </span>
        </div>
      </div>
      <p>
        Создание изображений в чате использует локальный GPU. Ключи и лимиты текстовых моделей не
        расходуются.
      </p>
      {config ? (
        <form
          className="ai-image-mode"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p role="status">
            {config.ready
              ? 'Рецепт генерации готов'
              : 'Генерация не готова: ' + (config.reason || 'проверьте локальный сервер и модели')}
          </p>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => setEnabled(e.target.checked)}
            />{' '}
            Разрешить создание изображений
          </label>
          <label>
            Изображений в день на пользователя{' '}
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              disabled={busy}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>Разрешённые размеры</legend>
            {AI_IMAGE_PRESETS.map(({ id: value, label }) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={sizes.includes(value)}
                  onChange={(e) =>
                    setSizes((previous) =>
                      e.target.checked
                        ? AI_IMAGE_PRESETS.filter(
                            (p) => p.id === value || previous.includes(p.id),
                          ).map((p) => p.id)
                        : previous.filter((size) => size !== value),
                    )
                  }
                />{' '}
                {label}{' '}
              </label>
            ))}
          </fieldset>
          <p>
            Лимит обновляется в 00:00 UTC. Одновременно заданий: {config.globalConcurrency}.
            Сохранение настроек не создаёт изображение.
          </p>
          <div className="ai-image-mode-controls">
            <button
              type="submit"
              disabled={
                busy || !sizes.length || !Number.isInteger(limit) || limit < 1 || limit > 100
              }
            >
              {busy ? 'Сохраняем…' : 'Сохранить настройки'}
            </button>
            <button type="button" disabled={busy} onClick={() => setReload((n) => n + 1)}>
              Обновить настройки
            </button>
          </div>
        </form>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
