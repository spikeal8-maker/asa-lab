import { AI_IMAGE_PRESETS, AI_IMAGE_RECIPES, type AiImageRecipe } from '@asa-lab/contracts';
import { useEffect, useRef, useState } from 'react';
import type { AiImageGenerationAdminConfig, AiImageSize } from '@asa-lab/contracts';
import { call } from './admin-api';
import { newClientId } from '../client-id';

export function AdminAiImages({
  onAccessDenied,
  onConfigChange,
  refreshToken = 0,
}: {
  onAccessDenied: () => void;
  onConfigChange?: (config: AiImageGenerationAdminConfig | null) => void;
  refreshToken?: number;
}) {
  const [config, setConfig] = useState<AiImageGenerationAdminConfig | null>(null);
  const [recipe, setRecipe] = useState<AiImageRecipe>('flux2-klein-4b-v1');
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
    setRecipe(data.recipe);
    setLimit(data.dailyLimit);
    setSizes(data.sizes);
    onConfigChange?.(data);
  }

  useEffect(() => {
    let live = true;
    setConfig(null);
    onConfigChange?.(null);
    void call<AiImageGenerationAdminConfig>('/api/admin/v1/ai/images').then((result) => {
      if (!live) return;
      if (
        result.ok &&
        AI_IMAGE_RECIPES.includes(result.data.recipe) &&
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
    // Config-change callback is notification only, not a trigger to refetch.
  }, [onAccessDenied, reload, refreshToken]);

  const dirty =
    !!config &&
    (config.recipe !== recipe ||
      config.enabled !== enabled ||
      config.dailyLimit !== limit ||
      sizes.length !== config.sizes.length ||
      sizes.some((size) => !config.sizes.includes(size)));
  const mismatch = config?.reason?.includes('qwen_3_4b_fp4_flux2.safetensors');
  const valid = !!sizes.length && Number.isInteger(limit) && limit >= 1 && limit <= 100;

  async function save() {
    if (!config || lock.current || !valid) return;
    lock.current = true;
    setBusy(true);
    setNotice('');
    const update = {
      configurationVersion: config.configurationVersion,
      enabled,
      recipe,
      dailyLimit: limit,
      globalConcurrency: config.globalConcurrency,
      sizes,
    };
    const signature = JSON.stringify(update);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: newClientId() };
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
    <section className="asa-image-settings-panel" aria-label="Настройки изображений">
      <header className="asa-image-panel-heading">
        <h3>Настройки генерации</h3>
      </header>

      {config ? (
        <form
          className="asa-image-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="asa-image-settings-fields">
            <label className="asa-image-profile-field">
              <span>Профиль генерации</span>
              <select
                value={recipe}
                disabled={busy}
                onChange={(event) => setRecipe(event.target.value as AiImageRecipe)}
              >
                <option value="flux2-klein-4b-v1">FLUX.2 Klein 4B · исходный FP4</option>
                <option value="flux2-klein-4b-fp8-izo-v1">FLUX.2 Klein 4B · профиль ИЗО FP8</option>
              </select>
            </label>
            <label className="asa-image-enabled-field">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Разрешить создание изображений
            </label>
          </div>

          {dirty || !config.ready || !config.enabled ? (
            <p className="asa-image-profile-status" role="status">
              {dirty
                ? 'Сохраните изменения для проверки.'
                : config.reason === 'disabled' || (!config.enabled && config.ready)
                  ? 'Генерация выключена.'
                  : 'Генерация не готова: ' +
                    (config.reason || 'проверьте подключение и файлы модели')}
            </p>
          ) : null}
          {mismatch && recipe === 'flux2-klein-4b-v1' ? (
            <p className="asa-image-suggestion">
              Требуемый FP4-энкодер не найден. Если на GPU установлен qwen_3_4b.safetensors,
              выберите профиль ИЗО FP8 и сохраните — подмена имени файла не нужна.
            </p>
          ) : null}

          <div className="asa-image-settings-details">
            <strong className="asa-image-details-heading">Размеры и лимиты</strong>
            <div className="asa-image-detail-fields">
              <label>
                Изображений в день на пользователя
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  disabled={busy}
                  onChange={(event) => setLimit(Number(event.target.value))}
                />
              </label>
              <span className="asa-image-muted">
                Одновременных заданий: {config.globalConcurrency}
              </span>
            </div>
            <fieldset disabled={busy} className="asa-image-presets">
              <legend>Разрешённые размеры</legend>
              <div className="asa-image-preset-grid">
                {AI_IMAGE_PRESETS.map(({ id: value, label, width, height }) => (
                  <label key={value} title={label}>
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={sizes.includes(value)}
                      onChange={(event) =>
                        setSizes((previous) =>
                          event.target.checked
                            ? AI_IMAGE_PRESETS.filter(
                                (preset) => preset.id === value || previous.includes(preset.id),
                              ).map((preset) => preset.id)
                            : previous.filter((size) => size !== value),
                        )
                      }
                    />
                    <span>
                      {width} × {height}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <footer className="asa-image-form-actions">
            <button type="submit" disabled={busy || !valid}>
              {busy ? 'Сохраняем…' : 'Сохранить настройки'}
            </button>
            <button type="button" disabled={busy} onClick={() => setReload((n) => n + 1)}>
              Обновить настройки
            </button>
            {dirty ? <span className="asa-image-unsaved">Есть несохранённые изменения</span> : null}
          </footer>
        </form>
      ) : (
        <p role="status">Загружаем настройки генерации…</p>
      )}
      {notice ? (
        <p role="status" className="asa-image-action-message">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
