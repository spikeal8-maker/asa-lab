import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiDeepSeekCatalogModel, AiGenerationPolicy } from '@asa-lab/contracts';
import { policyShape } from './AdminAiGenerationPolicy';
import { call } from './admin-api';
import { isAiAdminConfig, type AiAdminConfig } from './ai-model-config';
import './ai-admin.css';

const adminPath = '/api/admin/v1/ai';
const policyPath = adminPath + '/generation-policy';
const format = new Intl.NumberFormat('ru-RU');

export function AdminDeepSeekConnection({
  onAccessDenied,
  onDirtyChange,
  onUpdated,
}: {
  onAccessDenied: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onUpdated: () => void;
}) {
  const [config, setConfig] = useState<AiAdminConfig | null>(null);
  const [policy, setPolicy] = useState<AiGenerationPolicy | null>(null);
  const [catalog, setCatalog] = useState<readonly AiDeepSeekCatalogModel[] | null>(null);
  const [eligibility, setEligibility] = useState<Record<string, boolean>>({});
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [quota, setQuota] = useState('');
  const [busy, setBusy] = useState<'load' | 'check' | 'save' | null>('load');
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const flight = useRef(false);
  const checkedDraft = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const slot = config?.providerConfigurations.find((row) => row.provider === 'deepseek');
  const keyDraft = key.trim();
  const connectionDirty =
    !!slot &&
    (Boolean(keyDraft) ||
      clearKey ||
      enabled !== slot.enabled ||
      Number(quota) !== config?.paidOperationsPerHour);
  const modelsDirty = Object.keys(eligibility).length > 0;
  const dirty = connectionDirty || modelsDirty;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const fetchCatalog = useCallback(
    async (apiKey?: string) => {
      const reply = await call<{ models: readonly AiDeepSeekCatalogModel[] }>(
        adminPath + '/deepseek/catalog',
        {
          method: 'POST',
          body: JSON.stringify(apiKey ? { apiKey } : {}),
        },
      );
      if (!reply.ok && [401, 403].includes(reply.status)) onAccessDenied();
      return reply;
    },
    [onAccessDenied],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [settings, access] = await Promise.all([
          call<unknown>(adminPath),
          call<unknown>(policyPath),
        ]);
        if (!live) return;
        if (
          (!settings.ok && [401, 403].includes(settings.status)) ||
          (!access.ok && [401, 403].includes(access.status))
        )
          onAccessDenied();
        if (
          !settings.ok ||
          !isAiAdminConfig(settings.data) ||
          !access.ok ||
          !policyShape(access.data)
        ) {
          setMessage({ ok: false, text: 'Не удалось загрузить настройки DeepSeek.' });
          return;
        }
        setConfig(settings.data);
        setPolicy(access.data);
        const saved = settings.data.providerConfigurations.find(
          (row) => row.provider === 'deepseek',
        );
        setEnabled(saved?.enabled ?? false);
        setQuota(String(settings.data.paidOperationsPerHour));
        if (saved?.apiKeyConfigured) {
          const reply = await fetchCatalog();
          if (live) showCatalog(reply);
        }
      } finally {
        if (live) setBusy(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [fetchCatalog, onAccessDenied]);

  function showCatalog(reply: Awaited<ReturnType<typeof fetchCatalog>>) {
    if (!reply.ok || !Array.isArray(reply.data.models)) {
      setResult({
        ok: false,
        text: reply.ok
          ? 'Не удалось прочитать каталог.'
          : reply.error.message || 'Проверка недоступна.',
      });
      return false;
    }
    setCatalog(reply.data.models);
    setResult({ ok: true, text: 'Ключ принят · моделей: ' + reply.data.models.length });
    return true;
  }

  async function verify() {
    if (flight.current) return;
    flight.current = true;
    setBusy('check');
    setResult(null);
    try {
      checkedDraft.current =
        showCatalog(await fetchCatalog(keyDraft || undefined)) && Boolean(keyDraft);
    } finally {
      flight.current = false;
      setBusy(null);
    }
  }

  function updateEligibility(id: string, eligible: boolean) {
    setEligibility((old) => {
      const next = { ...old };
      if (eligible === (policy?.models.find((model) => model.id === id)?.eligible ?? true))
        delete next[id];
      else next[id] = eligible;
      return next;
    });
    setMessage(null);
  }

  const validQuota =
    /^\d+$/.test(quota) && Number(quota) <= 2147483647 && (!enabled || Number(quota) > 0);
  const canSave =
    !!config?.encryptionReady &&
    !!policy &&
    !!slot &&
    !busy &&
    dirty &&
    validQuota &&
    (!enabled || (!clearKey && (Boolean(keyDraft) || slot.apiKeyConfigured)));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config || !policy || !slot || !canSave || flight.current) return;
    flight.current = true;
    setBusy('save');
    setMessage(null);
    let connectionSaved = false;
    try {
      if (connectionDirty) {
        if (keyDraft && !checkedDraft.current && !showCatalog(await fetchCatalog(keyDraft))) return;
        const reply = await call<unknown>(adminPath, {
          method: 'PUT',
          body: JSON.stringify({
            provider: 'deepseek',
            model: slot.model,
            enabled,
            paidOperationsPerHour: Number(quota),
            configurationVersion: config.configurationVersion,
            providerConfigurationVersion: slot.revision,
            ...(keyDraft ? { apiKey: keyDraft } : {}),
            ...(clearKey ? { clearApiKey: true } : {}),
          }),
        });
        if (!reply.ok || !isAiAdminConfig(reply.data)) {
          if (!reply.ok && [401, 403].includes(reply.status)) onAccessDenied();
          setMessage({
            ok: false,
            text: reply.ok
              ? 'Не удалось подтвердить сохранение.'
              : reply.error.message || 'Не удалось сохранить подключение.',
          });
          return;
        }
        connectionSaved = true;
        setConfig(reply.data);
        setKey('');
        setClearKey(false);
        checkedDraft.current = false;
        onUpdated();
        if (clearKey) {
          setCatalog(null);
          setResult(null);
        } else if (keyDraft) {
          const observed = showCatalog(await fetchCatalog());
          if (!observed && modelsDirty) {
            setMessage({
              ok: false,
              text: 'Ключ сохранён. Обновите каталог перед сохранением моделей.',
            });
            return;
          }
        }
      }
      if (modelsDirty) {
        const preferences = policy.modelPreferences ?? [];
        const fields = {
          configurationVersion: policy.configurationVersion,
          systemPrompt: policy.systemPrompt,
          defaultModel: policy.defaultModel,
          allowedModels: policy.allowedModels,
          providerOrder: policy.providerOrder ?? {},
          modelPreferences: [
            ...preferences.filter((entry) => eligibility[entry.id] === undefined),
            ...Object.entries(eligibility).map(([id, eligible]) => ({
              id,
              eligible,
              order: preferences.find((entry) => entry.id === id)?.order ?? 0,
            })),
          ],
        };
        const signature = JSON.stringify(fields);
        if (attempt.current?.signature !== signature)
          attempt.current = { signature, id: crypto.randomUUID() };
        const reply = await call<unknown>(policyPath, {
          method: 'PUT',
          body: JSON.stringify({ ...fields, requestId: attempt.current.id }),
        });
        if (!reply.ok || !policyShape(reply.data)) {
          if (!reply.ok && [401, 403].includes(reply.status)) onAccessDenied();
          setMessage({
            ok: false,
            text:
              (connectionSaved ? 'Подключение сохранено. ' : '') +
              (reply.status === 409
                ? 'Настройки моделей изменились. Обновите страницу.'
                : 'Не удалось сохранить выбор моделей.'),
          });
          return;
        }
        setPolicy(reply.data);
        setEligibility({});
        attempt.current = null;
      }
      setMessage({ ok: true, text: 'Сохранено' });
    } finally {
      flight.current = false;
      setBusy(null);
    }
  }

  const supported =
    policy?.models.filter(
      (model) => model.provider === 'deepseek' && model.adapterCompatible !== false,
    ) ?? [];
  const observation = policy?.observations?.find((item) => item.provider === 'deepseek');
  const models =
    catalog ??
    (slot?.apiKeyConfigured
      ? (observation?.models
          .filter((model) => model.active)
          .map(({ id }) => ({
            id,
            name: id,
            inputModalities: null,
            outputModalities: null,
            contextTokens: null,
          })) ?? [])
      : []);

  return (
    <section
      className="asa-cloud-connection asa-deepseek-connection"
      aria-label="Настройки DeepSeek"
    >
      {busy === 'load' && !config ? <small role="status">Загружаем настройки…</small> : null}
      {config && slot ? (
        <form onSubmit={(event) => void save(event)}>
          <div className="asa-cloud-compact-top">
            <h2>DeepSeek</h2>
            <label className="asa-cloud-enabled">
              <input
                type="checkbox"
                checked={enabled}
                disabled={!!busy || clearKey}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setMessage(null);
                }}
              />
              Включён
            </label>
            <label
              className="asa-cloud-hourly"
              title="Общий лимит платных операций облачных провайдеров"
            >
              Запросов/ч
              <input
                type="number"
                min="0"
                max="2147483647"
                value={quota}
                aria-label="Общий лимит платных ИИ-операций за час"
                disabled={!!busy}
                onChange={(event) => {
                  setQuota(event.target.value);
                  setMessage(null);
                }}
              />
            </label>
            <button className="asa-cloud-apply" disabled={!canSave} type="submit">
              {busy === 'save' ? 'Сохраняем…' : 'Сохранить'}
            </button>
            {message?.ok ? (
              <small role="status">{message.text}</small>
            ) : dirty ? (
              <small>Есть несохранённые изменения</small>
            ) : null}
          </div>
          <div className="asa-deepseek-key-row">
            <label>
              API-ключ
              <input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={2048}
                aria-label="API-ключ DeepSeek"
                value={key}
                placeholder={
                  slot.apiKeyConfigured ? 'Ключ сохранён · введите для замены' : 'Вставьте ключ'
                }
                disabled={!!busy || clearKey || !config.encryptionReady}
                onChange={(event) => {
                  setKey(event.target.value);
                  checkedDraft.current = false;
                  setResult(null);
                  setMessage(null);
                }}
              />
            </label>
            <div className="asa-cloud-key-verification">
              <button
                type="button"
                onClick={() => void verify()}
                disabled={!!busy || clearKey || (!keyDraft && !slot.apiKeyConfigured)}
              >
                {busy === 'check' || busy === 'load' ? 'Проверяем…' : 'Проверить ключ'}
              </button>
              {result ? (
                <small role="status" data-tone={result.ok ? 'success' : 'error'}>
                  {result.text}
                </small>
              ) : null}
            </div>
            <a
              href="https://platform.deepseek.com/api_keys"
              target="_blank"
              rel="noopener noreferrer"
            >
              Получить ключ
            </a>
            {slot.apiKeyConfigured ? (
              <button
                type="button"
                disabled={!!busy}
                aria-pressed={clearKey}
                onClick={() => {
                  setClearKey(!clearKey);
                  setKey('');
                  setEnabled(clearKey ? slot.enabled : false);
                  setResult(null);
                  setMessage(null);
                  checkedDraft.current = false;
                }}
              >
                {clearKey ? 'Отменить удаление' : 'Удалить ключ'}
              </button>
            ) : null}
          </div>
          {!config.encryptionReady ? (
            <p role="alert">Шифрование ключей на сервере недоступно.</p>
          ) : null}
          <div className="asa-deepseek-catalog-heading">
            <strong>Модели DeepSeek</strong>
            <small>Выберите модели, которые будут доступны в Настройках ИИ.</small>
          </div>
          {!models.length ? (
            <small>
              {catalog
                ? 'DeepSeek не вернул доступных моделей.'
                : 'Добавьте и проверьте ключ, чтобы загрузить список.'}
            </small>
          ) : null}
          <ul className="asa-cloud-catalog-list">
            {models.map((model) => {
              const adapter = supported.find((item) => item.id === model.id);
              const input = model.inputModalities ?? adapter?.inputModalities;
              const isDefault = policy?.defaultModel === model.id;
              return (
                <li key={model.id} className="asa-deepseek-model-row">
                  <label title={model.id}>
                    <input
                      type="checkbox"
                      checked={!!adapter && (eligibility[model.id] ?? adapter.eligible ?? true)}
                      disabled={!!busy || !adapter || isDefault || !input?.includes('text')}
                      onChange={(event) => updateEligibility(model.id, event.target.checked)}
                    />
                    <span>{model.name}</span>
                  </label>
                  <small>
                    {input?.includes('image')
                      ? 'Читает изображения'
                      : input?.includes('text')
                        ? 'Вход: текст'
                        : 'Вход: нет данных'}
                  </small>
                  <small>
                    {model.outputModalities?.includes('image')
                      ? 'Генерирует изображения'
                      : model.outputModalities?.includes('text')
                        ? 'Ответ: текст'
                        : null}
                  </small>
                  <small>
                    {model.contextTokens ? format.format(model.contextTokens) + ' токенов' : null}
                  </small>
                  <small>
                    {!adapter ? 'ASA пока не поддерживает' : isDefault ? 'По умолчанию' : null}
                  </small>
                </li>
              );
            })}
          </ul>
        </form>
      ) : null}
      {message && !message.ok ? (
        <p role="alert" className="asa-cloud-error">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
