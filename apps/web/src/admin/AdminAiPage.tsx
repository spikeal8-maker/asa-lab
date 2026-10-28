import { OllamaCloudKeys } from './OllamaCloudKeys';
import type { AiOllamaCloudModel } from '@asa-lab/contracts';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import { aiDiagnosticMessage } from './ai-error-message';
import { isAiAdminConfig, type AiAdminConfig, type AiProvider } from './ai-model-config';
import './ai-admin.css';

interface TestReceipt {
  readonly provider: AiProvider;
  readonly model: string;
  readonly elapsedMs: number;
  readonly testedAt: string;
  readonly configurationVersion: number;
  readonly providerConfigurationVersion: number;
}

function errorMessage(status: number, code: string): string {
  const specific = aiDiagnosticMessage(code);
  if (specific) return specific;
  if (status === 401) return 'Сессия истекла. Войдите снова.';
  if (status === 403) return 'Доступ к настройкам разрешён только администратору платформы.';
  if (code === 'ai_config_schema_unsupported' || code === 'ai_config_unsupported' || status === 404)
    return 'Версии API и настроек несовместимы. Проверьте обновление ASA Lab.';
  if (code === 'ai_encryption_unavailable') return 'На сервере не настроено шифрование API-ключей.';
  if (status === 0) return 'Нет соединения с сервером. Проверьте подключение.';
  return 'Не удалось сохранить или проверить подключение. Обновите настройки и повторите.';
}

function providerName(provider: AiProvider): string {
  return provider === 'ollama-cloud'
    ? 'Ollama Cloud'
    : provider === 'deepseek'
      ? 'DeepSeek'
      : 'OpenAI';
}

export function AiAdminPage({
  onAccessDenied,
  providerChoice = 'openai',
  onUpdated,
}: {
  readonly onAccessDenied: () => void;
  readonly providerChoice?: AiProvider;
  readonly onUpdated?: () => void;
}) {
  const [config, setConfig] = useState<AiAdminConfig | null>(null);
  const [model, setModel] = useState('');
  const [cloudModels, setCloudModels] = useState<readonly AiOllamaCloudModel[] | null>(null);
  const acceptCloudModels = useCallback((rows: readonly AiOllamaCloudModel[]) => {
    const active = rows.filter((row) => row.active);
    setCloudModels(active);
    setModel((previous) =>
      active.some((row) => row.id === previous) ? previous : (active[0]?.id ?? previous),
    );
  }, []);
  const [keyInput, setKeyInput] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [cloudKeysDirty, setCloudKeysDirty] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [quota, setQuota] = useState('0');
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const cloudKeysSaved = useCallback(() => {
    setReload((value) => value + 1);
    onUpdated?.();
  }, [onUpdated]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void call<unknown>('/api/admin/v1/ai')
      .then((reply) => {
        if (!live) return;
        if (!reply.ok || !isAiAdminConfig(reply.data)) {
          if (!reply.ok && (reply.status === 401 || reply.status === 403)) onAccessDenied();
          setConfig(null);
          setError(
            reply.ok
              ? 'Конфигурация ИИ несовместима с этой версией.'
              : errorMessage(reply.status, reply.error.code),
          );
          return;
        }
        setConfig(reply.data);
        setError('');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reload, onAccessDenied]);

  // Changing providers must not expose or copy another provider's key.
  useEffect(() => {
    if (!config) return;
    const slot = config.providerConfigurations.find((row) => row.provider === providerChoice);
    const catalog = config.modelCatalog.providers.find((row) => row.id === providerChoice);
    const storedModel = slot?.model;
    const selectable = config.modelCatalog.models.some(
      (row) => row.provider === providerChoice && row.id === storedModel && row.selectable,
    );
    setModel(selectable ? storedModel! : (catalog?.defaultModel ?? ''));
    setKeyInput('');
    setClearKey(false);
    setEnabled(slot?.enabled ?? false);
    setQuota(String(config.paidOperationsPerHour));
    setConfirmPaid(false);
  }, [providerChoice, config]);

  useEffect(() => {
    setNotice('');
    setError('');
  }, [providerChoice]);

  const slot = config?.providerConfigurations.find((row) => row.provider === providerChoice);
  const options =
    providerChoice === 'ollama-cloud' && cloudModels !== null
      ? cloudModels.map((row) => ({ id: row.id, label: row.model }))
      : (config?.modelCatalog.models.filter(
          (row) => row.provider === providerChoice && row.selectable,
        ) ?? []);
  const keyReady = Boolean(keyInput.trim()) || Boolean(slot?.apiKeyConfigured && !clearKey);
  const validQuota =
    /^\d+$/.test(quota) &&
    Number.isSafeInteger(Number(quota)) &&
    Number(quota) >= 0 &&
    Number(quota) <= 2147483647;
  const dirty =
    Boolean(config) &&
    (slot?.model !== model ||
      slot?.enabled !== enabled ||
      Number(config!.paidOperationsPerHour) !== Number(quota) ||
      Boolean(keyInput.trim()) ||
      clearKey);
  const mustClear = Boolean(clearKey && slot?.apiKeyConfigured);
  const canSubmit = Boolean(
    config &&
    model &&
    (dirty || enabled) &&
    (keyReady || !enabled) &&
    validQuota &&
    (!enabled || (Number(quota) > 0 && confirmPaid)) &&
    (config.encryptionReady || (!enabled && mustClear && !keyInput.trim())) &&
    !loading &&
    !(providerChoice === 'ollama-cloud' && cloudKeysDirty) &&
    !busy,
  );
  const keyLink =
    providerChoice === 'ollama-cloud'
      ? 'https://ollama.com/settings/keys'
      : providerChoice === 'deepseek'
        ? 'https://platform.deepseek.com/api_keys'
        : 'https://platform.openai.com/api-keys';

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !canSubmit || inFlight.current) return;
    inFlight.current = true;
    setBusy('save');
    setError('');
    setNotice('');
    let next = config;
    let saved = false;
    try {
      if (dirty) {
        const response = await call<unknown>('/api/admin/v1/ai', {
          method: 'PUT',
          body: JSON.stringify({
            enabled,
            paidOperationsPerHour: Number(quota),
            provider: providerChoice,
            model,
            configurationVersion: config.configurationVersion,
            providerConfigurationVersion: slot?.revision,
            ...(keyInput.trim() ? { apiKey: keyInput.trim() } : {}),
            ...(mustClear ? { clearApiKey: true } : {}),
          }),
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) onAccessDenied();
          setError(errorMessage(response.status, response.error.code));
          return;
        }
        if (!isAiAdminConfig(response.data)) {
          setError('Сервер вернул несовместимые настройки. Обновите страницу.');
          return;
        }
        next = response.data;
        saved = true;
        // A key must disappear from input as soon as the server accepts it.
        setKeyInput('');
        setClearKey(false);
        setConfig(next);
        onUpdated?.();
      }

      if (!enabled) {
        setNotice('Сохранено · облачные запросы выключены');
        return;
      }
      // Explicit consent is required because a successful test may cost money
      // and consumes the platform's real hourly paid-operation quota.
      setBusy('check');
      // Consent covers only this one potentially billable request, including errors.
      setConfirmPaid(false);
      const tested = await call<TestReceipt>('/api/admin/v1/ai/test', {
        method: 'POST',
        body: JSON.stringify({
          acknowledgePaidRequest: true,
          configurationVersion: next.configurationVersion,
          provider: providerChoice,
          providerConfigurationVersion: next.providerConfigurations.find(
            (row) => row.provider === providerChoice,
          )?.revision,
        }),
      });
      if (!tested.ok) {
        if (tested.status === 401 || tested.status === 403) onAccessDenied();
        setError(
          (saved ? 'Настройки сохранены, но подключение не подтверждено. ' : '') +
            errorMessage(tested.status, tested.error.code) +
            (tested.status === 0 ? ' Проверочный запрос мог быть платным.' : ''),
        );
        return;
      }
      if (
        tested.data.provider !== providerChoice ||
        tested.data.model !== model ||
        tested.data.configurationVersion !== next.configurationVersion ||
        tested.data.providerConfigurationVersion !==
          next.providerConfigurations.find((row) => row.provider === providerChoice)?.revision
      ) {
        setError('Ответ проверки не соответствует текущим настройкам.');
        return;
      }
      setNotice(
        'Подключено · ' +
          providerName(providerChoice) +
          ' · ' +
          (tested.data.elapsedMs / 1000).toFixed(1) +
          ' с',
      );
      setConfirmPaid(false);
    } catch {
      setError('Результат не подтверждён. Проверьте соединение перед повторным платным запросом.');
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <section
      className={
        'asa-cloud-connection' + (providerChoice === 'ollama-cloud' ? ' is-ollama-cloud' : '')
      }
      aria-label={'Настройки ' + providerName(providerChoice)}
    >
      {loading ? (
        <div role="status" className="asa-cloud-busy">
          Загружаем настройки…
        </div>
      ) : null}
      {error ? (
        <div className="asa-cloud-error" role="alert">
          {error}
          {!config ? (
            <button type="button" onClick={() => setReload((v) => v + 1)}>
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}
      {config && options.length === 0 ? (
        <p role="alert">Для этого подключения требуется обновление API и схемы ASA Lab.</p>
      ) : null}
      {config && options.length > 0 ? (
        <form onSubmit={(event) => void apply(event)} className="asa-cloud-form">
          <div className="asa-cloud-top">
            <div>
              <h2>{providerName(providerChoice)}</h2>
              <span>
                {providerChoice === 'ollama-cloud'
                  ? 'Ключи и доступ к моделям — ниже'
                  : slot?.apiKeyConfigured
                    ? 'Ключ сохранён на сервере'
                    : 'Требуется API-ключ'}
              </span>
            </div>
            <label className="asa-cloud-enabled">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setNotice('');
                  setConfirmPaid(false);
                }}
                disabled={!!busy || !config.encryptionReady}
              />
              {enabled ? 'Включено' : 'Выключено'}
            </label>
          </div>

          <div className="asa-cloud-fields">
            <label className="asa-cloud-field">
              <span>Модель</span>
              <select
                aria-label="Модель"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setNotice('');
                  setConfirmPaid(false);
                }}
                disabled={!!busy}
              >
                {options.map((row) => (
                  <option value={row.id} key={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
            {providerChoice !== 'ollama-cloud' ? (
              <label className="asa-cloud-field">
                <span>API-ключ {slot?.apiKeyConfigured ? '· замена' : ''}</span>
                <input
                  aria-label="Новый API-ключ"
                  type="password"
                  value={keyInput}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={slot?.apiKeyConfigured ? 'Ключ уже сохранён' : 'Вставьте API-ключ'}
                  onChange={(event) => {
                    setKeyInput(event.target.value);
                    setClearKey(false);
                    setNotice('');
                  }}
                  disabled={!!busy || !config.encryptionReady || clearKey}
                  maxLength={2048}
                />
              </label>
            ) : null}
          </div>
          <div className="asa-cloud-underfields">
            <label className="asa-cloud-limit">
              Лимит платных запросов/ч
              <input
                aria-label="Общий лимит платных ИИ-операций за час"
                type="number"
                min="0"
                max="2147483647"
                step="1"
                value={quota}
                onChange={(event) => {
                  setQuota(event.target.value);
                  setConfirmPaid(false);
                  setNotice('');
                }}
                disabled={!!busy}
              />
            </label>
            <span className="asa-cloud-key-help">
              {slot?.apiKeyConfigured
                ? 'Ключ сохранён и скрыт'
                : 'Ключ можно получить в кабинете провайдера'}{' '}
              ·{' '}
              <a href={keyLink} target="_blank" rel="noopener noreferrer">
                {providerChoice === 'ollama-cloud'
                  ? 'Войти в Ollama и получить ключ'
                  : providerName(providerChoice)}
              </a>
            </span>
          </div>

          {enabled ? (
            <label className="asa-cloud-consent">
              <input
                type="checkbox"
                checked={confirmPaid}
                onChange={(event) => setConfirmPaid(event.target.checked)}
                disabled={!!busy || !keyReady || !validQuota || Number(quota) === 0}
              />
              Разрешаю один платный запрос для проверки
            </label>
          ) : null}
          {providerChoice === 'ollama-cloud' && cloudKeysDirty ? (
            <p className="asa-cloud-note">Сначала сохраните ключи и порядок ниже.</p>
          ) : null}
          {enabled && Number(quota) === 0 ? (
            <p className="asa-cloud-note">
              Чтобы включить облачную модель, задайте лимит больше нуля.
            </p>
          ) : null}
          {!config.encryptionReady ? (
            <p className="asa-cloud-error" role="alert">
              Шифрование ключей на сервере не настроено.
            </p>
          ) : null}

          <div className="asa-cloud-bottom">
            <button className="asa-cloud-apply" type="submit" disabled={!canSubmit}>
              {busy === 'check'
                ? 'Проверяем ответ…'
                : busy === 'save'
                  ? 'Сохраняем…'
                  : enabled
                    ? 'Сохранить и проверить'
                    : 'Сохранить выключенным'}
            </button>
            {notice ? (
              <span className="asa-cloud-confirmed" role="status">
                {notice}
              </span>
            ) : null}
          </div>
          <details className="asa-cloud-more">
            <summary>Дополнительно</summary>
            {slot?.apiKeyConfigured && providerChoice !== 'ollama-cloud' ? (
              <label className="asa-cloud-consent">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => {
                    setClearKey(event.target.checked);
                    setKeyInput('');
                    if (event.target.checked) setEnabled(false);
                  }}
                  disabled={!!busy}
                />
                Удалить сохранённый ключ этого провайдера
              </label>
            ) : null}
            <p>
              Лимит относится только к платным облачным запросам. Ноль запрещает расходы. Локальная
              Ollama работает независимо.
            </p>
          </details>
        </form>
      ) : null}
      {config && providerChoice === 'ollama-cloud' ? (
        <OllamaCloudKeys
          version={config.configurationVersion}
          encryptionReady={config.encryptionReady}
          onModels={acceptCloudModels}
          onAccessDenied={onAccessDenied}
          onSaved={cloudKeysSaved}
          onDirtyChange={setCloudKeysDirty}
        />
      ) : null}
    </section>
  );
}
