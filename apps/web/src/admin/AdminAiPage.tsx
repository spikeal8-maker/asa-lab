import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import {
  isAiAdminConfig,
  type AiAdminConfig,
  type AiProvider as Provider,
} from './ai-model-config';
import './ai-admin.css';

const CONFIG_UNAVAILABLE =
  'Настройки ИИ не загрузились. Проверьте версию API и миграции базы в «Админ → Система», затем повторите загрузку.';
const CONFIG_INCOMPATIBLE =
  'Версия настроек ИИ несовместима с этой формой. Требуется согласованное обновление Web, API и миграций базы (включая лимит платных операций). Проверьте «Админ → Система».';
const CONFIG_REJECTED =
  'Сохранение не подтверждено: сервер отклонил настройки ИИ. Проверьте модель и целочисленный лимит, затем повторите сохранение.';
const TEST_RESULT_UNCERTAIN =
  'Результат проверки не получен. Запрос мог быть оплачен; проверьте соединение перед повтором.';

function failureMessage(status: number, code: string, message: string): string {
  if (status === 401) return 'Сессия истекла. Войдите снова в аккаунт администратора платформы.';
  if (code === 'ai_origin_denied' || code === 'ai_origin_required') {
    return 'Сервер отклонил источник запроса. Откройте ASA по основному адресу установки; администратору сервера нужно проверить настройку origin.';
  }
  if (status === 403) {
    return 'Для настройки ИИ нужна роль администратора платформы (platform_admin). Права администратора организации не дают этот доступ.';
  }
  if (code === 'ai_encryption_unavailable') {
    return 'Сохранение ключа недоступно: администратору сервера нужно настроить ASA_SETTINGS_ENCRYPTION_KEY в окружении API, затем повторить загрузку.';
  }
  if (code === 'ai_config_invalid') return CONFIG_REJECTED;
  if (
    code === 'ai_config_unsupported' ||
    code === 'ai_schema_unsupported' ||
    code === 'ai_config_schema_unsupported'
  ) {
    return CONFIG_INCOMPATIBLE;
  }
  if (code.startsWith('ai_provider_') || code.startsWith('ai_response_')) return message;
  if (status === 404) return CONFIG_INCOMPATIBLE;
  if (status >= 500 || code === 'ai_config_unavailable') return CONFIG_UNAVAILABLE;
  return message;
}

export function AiAdminPage({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [config, setConfig] = useState<AiAdminConfig | null>(null);
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [paidOperationsPerHour, setPaidOperationsPerHour] = useState('0');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const requestBusy = useRef(false);
  const [acknowledgeTest, setAcknowledgeTest] = useState(false);
  const [connectionTest, setConnectionTest] = useState<{
    provider: Provider;
    model: string;
    elapsedMs: number;
    testedAt: string;
    configurationVersion: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setConfig(null);
    setApiKey('');
    setMessage(null);
    setConnectionTest(null);
    setAcknowledgeTest(false);
    setError(null);
    void call<unknown>('/api/admin/v1/ai')
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(failureMessage(result.status, result.error.code, result.error.message));
          if (result.status === 401) onAccessDenied();
          return;
        }
        if (!isAiAdminConfig(result.data)) {
          setError(CONFIG_INCOMPATIBLE);
          return;
        }
        setConfig(result.data);
        setProvider(result.data.provider);
        setModel(result.data.model);
        setEnabled(result.data.enabled);
        setPaidOperationsPerHour(String(result.data.paidOperationsPerHour ?? 0));
      })
      .catch(() => {
        if (active) setError(CONFIG_UNAVAILABLE);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onAccessDenied, loadAttempt]);

  function handleFailure(result: {
    readonly status: number;
    readonly error: { readonly code: string; readonly message: string };
  }): void {
    setError(failureMessage(result.status, result.error.code, result.error.message));
    if (
      result.status === 401 ||
      (result.status === 403 &&
        result.error.code !== 'ai_origin_denied' &&
        result.error.code !== 'ai_origin_required')
    ) {
      setApiKey('');
      setConfig(null);
      if (result.status === 401) onAccessDenied();
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!config || requestBusy.current || !validQuota || !selectedModel?.selectable || needsNewKey)
      return;
    requestBusy.current = true;
    setSaving(true);
    setConnectionTest(null);
    setAcknowledgeTest(false);
    setMessage(null);
    setError(null);
    try {
      const result = await call<unknown>('/api/admin/v1/ai', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          paidOperationsPerHour: Number(paidOperationsPerHour),
          provider,
          model,
          configurationVersion: config.configurationVersion,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(clearKey ? { clearApiKey: true } : {}),
        }),
      });
      if (!result.ok) {
        handleFailure(result);
        return;
      }
      if (!isAiAdminConfig(result.data)) {
        setApiKey('');
        setConfig(null);
        setError(CONFIG_INCOMPATIBLE);
        return;
      }
      setConfig(result.data);
      setProvider(result.data.provider);
      setModel(result.data.model);
      setEnabled(result.data.enabled);
      setPaidOperationsPerHour(String(result.data.paidOperationsPerHour));
      setApiKey('');
      setClearKey(false);
      setMessage('Настройки сохранены. Новый API-ключ не возвращается в браузер.');
    } catch {
      setError('Сохранение не подтверждено. Проверьте соединение и повторите загрузку настроек.');
    } finally {
      requestBusy.current = false;
      setSaving(false);
    }
  }

  const switched = config !== null && provider !== config.provider;
  const selectedProvider = config?.providerConfigurations.find(
    (item) => item.provider === provider,
  );
  const selectedModel = config?.modelCatalog.models.find(
    (item) => item.id === model && item.provider === provider,
  );
  const savedModel = config?.modelCatalog.models.find(
    (item) => item.id === config.model && item.provider === config.provider,
  );
  const needsNewKey = switched && !selectedProvider?.apiKeyConfigured && !apiKey.trim();
  const validQuota =
    paidOperationsPerHour.trim() !== '' &&
    Number.isInteger(Number(paidOperationsPerHour)) &&
    Number(paidOperationsPerHour) >= 0 &&
    Number(paidOperationsPerHour) <= 2147483647;
  const unsaved =
    !config ||
    !validQuota ||
    provider !== config.provider ||
    model !== config.model ||
    enabled !== config.enabled ||
    Number(paidOperationsPerHour) !== config.paidOperationsPerHour ||
    Boolean(apiKey.trim()) ||
    clearKey;
  const canTest =
    config !== null &&
    !unsaved &&
    config.paidOperationsPerHour > 0 &&
    config.apiKeyConfigured &&
    config.encryptionReady &&
    selectedModel?.selectable === true;

  async function testConnection(): Promise<void> {
    if (!config || !canTest || !acknowledgeTest || requestBusy.current) return;
    requestBusy.current = true;
    setTesting(true);
    setConnectionTest(null);
    setError(null);
    setMessage(null);
    try {
      const result = await call<NonNullable<typeof connectionTest>>('/api/admin/v1/ai/test', {
        method: 'POST',
        body: JSON.stringify({
          acknowledgePaidRequest: true,
          configurationVersion: config.configurationVersion,
        }),
      });
      if (result.ok) {
        const data = result.data;
        if (
          data &&
          data.provider === config.provider &&
          data.model === config.model &&
          data.configurationVersion === config.configurationVersion &&
          Number.isFinite(data.elapsedMs) &&
          data.elapsedMs >= 0 &&
          typeof data.testedAt === 'string' &&
          Number.isFinite(Date.parse(data.testedAt))
        )
          setConnectionTest(data);
        else setError(TEST_RESULT_UNCERTAIN);
      } else if (result.status === 0) setError(TEST_RESULT_UNCERTAIN);
      else handleFailure(result);
    } catch {
      setError(TEST_RESULT_UNCERTAIN);
    } finally {
      requestBusy.current = false;
      setTesting(false);
      setAcknowledgeTest(false);
    }
  }

  useEffect(() => {
    setConnectionTest(null);
    setAcknowledgeTest(false);
  }, [provider, model, enabled, paidOperationsPerHour, apiKey, clearKey]);
  return (
    <section
      className="asa-ai-admin"
      aria-labelledby="asa-ai-admin-title"
      aria-busy={loading || saving || testing}
    >
      <div className="admin-section-heading">
        <div>
          <h2 id="asa-ai-admin-title">ИИ и модели</h2>
          <p>
            Подключите официальный API DeepSeek или OpenAI. Настройки доступны только администратору
            платформы; API-ключ хранится на сервере в зашифрованном виде и не возвращается в
            браузер.
          </p>
        </div>
      </div>
      {loading ? <p role="status">Загружаем настройки…</p> : null}
      {error ? (
        <div className="admin-inline-error" role="alert">
          <p>{error}</p>
          <a href="/#/admin/system">Открыть «Система»</a>
          {!loading ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={saving || testing}
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Повторить загрузку
            </button>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p className="asa-ai-admin-success" role="status">
          {message}
        </p>
      ) : null}
      {config ? (
        <form onSubmit={(event) => void save(event)} className="asa-ai-admin-form">
          <p className="asa-ai-admin-guide">
            Введите API-ключ выбранного провайдера, задайте лимит больше 0 и сохраните настройки.
            Затем подтвердите платную проверку подключения. Чтобы открыть ИИ пользователям, включите
            разрешение ИИ-запросов и сохраните ещё раз.
          </p>
          <div className="asa-ai-admin-status">
            <div>
              <span>Доступ по настройкам</span>
              <strong>{config.enabled ? 'Включён' : 'Выключен'}</strong>
            </div>
            <div>
              <span>API-ключ</span>
              <strong>{config.apiKeyConfigured ? 'Настроен' : 'Не задан'}</strong>
            </div>
            <div>
              <span>Шифрование</span>
              <strong>{config.encryptionReady ? 'Готово' : 'Требует настройки сервера'}</strong>
            </div>
          </div>
          {config.migratedFromModel ? (
            <p className="asa-ai-admin-warning" role="alert">
              Модель {config.migratedFromModel} снята с обслуживания.{' '}
              {config.apiKeyConfigured ? 'Сохранённый ключ перенесён на' : 'Выбрана новая модель'}{' '}
              {config.model}; ИИ-запросы отключены. Выберите модель и сохраните настройки. Доступ к
              новой модели подтверждается отдельной платной проверкой.
            </p>
          ) : null}
          {savedModel && !savedModel.selectable ? (
            <p className="asa-ai-admin-warning" role="alert">
              Модель {savedModel.label} больше недоступна. Запросы к ней заблокированы. Выберите
              доступную модель и сохраните настройки; ключ провайдера сохранится.
            </p>
          ) : null}
          <section className="asa-ai-provider-slots" aria-label="Сохранённые ключи провайдеров">
            {config.providerConfigurations.map((slot) => (
              <p key={slot.provider}>
                <strong>
                  {config.modelCatalog.providers.find((item) => item.id === slot.provider)?.label}
                </strong>
                <span>{slot.apiKeyConfigured ? 'Ключ сохранён' : 'Ключ не задан'}</span>
                {slot.keyFingerprint ? <code>{slot.keyFingerprint}</code> : null}
              </p>
            ))}
            <small>
              Ключи хранятся отдельно. Переключение провайдера сохраняет остальные ключи.
            </small>
          </section>
          <label>
            <span>Провайдер</span>
            <select
              aria-label="Провайдер"
              value={provider}
              disabled={saving || testing}
              onChange={(event) => {
                const next = event.target.value as Provider;
                const catalogProvider = config.modelCatalog.providers.find(
                  (item) => item.id === next,
                );
                if (!catalogProvider) return;
                const saved = config.providerConfigurations.find((item) => item.provider === next);
                setProvider(next);
                setModel(
                  config.modelCatalog.models.some(
                    (item) => item.id === saved?.model && item.provider === next && item.selectable,
                  )
                    ? saved!.model
                    : catalogProvider.defaultModel,
                );
                setEnabled(false);
                setClearKey(false);
                setApiKey('');
              }}
            >
              {config.modelCatalog.providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Модель</span>
            <select
              aria-label="Модель"
              value={model}
              disabled={saving || testing}
              onChange={(event) => setModel(event.target.value)}
            >
              {config.modelCatalog.models
                .filter((item) => item.provider === provider)
                .map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.selectable}>
                    {item.label}
                    {item.shutdownDate ? ` · до ${item.shutdownDate}` : ''}
                  </option>
                ))}
            </select>
          </label>
          {selectedModel ? (
            <div className="asa-ai-model-capabilities" aria-label="Возможности выбранной модели">
              <p>
                Модель принимает{' '}
                {selectedModel.inputModalities.includes('image')
                  ? 'текст и изображения'
                  : 'только текст'}
                .
              </p>
              <dl>
                {(
                  [
                    ['textChat', 'Текстовый чат'],
                    ['streaming', 'Потоковые ответы'],
                    ['imageInput', 'Загрузка изображений'],
                    ['fileAttachments', 'Загрузка файлов'],
                    ['imageGeneration', 'Генерация изображений'],
                  ] as const
                ).map(([feature, label]) => (
                  <div key={feature}>
                    <dt>{label} в ASA Lab</dt>
                    <dd>
                      {config.modelCatalog.productFeatures[feature]
                        ? 'Подключено'
                        : 'Ещё не подключено'}
                    </dd>
                  </div>
                ))}
              </dl>
              <small>
                Каталог описывает возможности модели. Доступ вашего ключа проверяется отдельно.
              </small>
            </div>
          ) : null}
          {provider === 'deepseek' ? (
            <p id="ai-provider-help">
              Официальный DeepSeek API: https://api.deepseek.com/chat/completions. Используйте ключ
              из <a href="https://platform.deepseek.com/api_keys">кабинета DeepSeek</a>.
            </p>
          ) : (
            <p id="ai-provider-help">Используйте API-ключ из кабинета OpenAI.</p>
          )}
          <label>
            <span>
              Новый API-ключ{' '}
              {switched && !selectedProvider?.apiKeyConfigured
                ? '(для выбранного провайдера)'
                : '(по необходимости)'}
            </span>
            <input
              type="password"
              disabled={saving || testing || !config.encryptionReady}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (event.target.value) setClearKey(false);
              }}
              autoComplete="new-password"
              aria-describedby="ai-provider-help"
              required={(switched || enabled) && !selectedProvider?.apiKeyConfigured}
              placeholder={
                selectedProvider?.apiKeyConfigured
                  ? 'Оставьте пустым, чтобы сохранить прежний ключ'
                  : 'Введите ключ API'
              }
              maxLength={2048}
              spellCheck={false}
            />
          </label>
          {selectedProvider?.keyFingerprint ? (
            <p className="asa-ai-admin-fingerprint">
              Отпечаток сохранённого ключа: {selectedProvider.keyFingerprint}
            </p>
          ) : null}
          <label>
            <span>Общий лимит платных ИИ-операций за час</span>
            <input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              required
              value={paidOperationsPerHour}
              disabled={saving || testing}
              onChange={(event) => setPaidOperationsPerHour(event.target.value)}
              aria-describedby="ai-paid-operation-limit-help"
            />
          </label>
          <p id="ai-paid-operation-limit-help">
            По умолчанию 0: платные вызовы запрещены. Положительное целое число разрешает указанное
            количество операций за последние 60 минут для всей платформы, включая проверку
            подключения. Это количество операций, а не денежный бюджет. Ошибки и остановленные
            запросы расходуют лимит; повтор принятого сообщения — нет.
          </p>
          <label className="asa-ai-admin-check">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(event) => {
                setClearKey(event.target.checked);
                if (event.target.checked) {
                  setApiKey('');
                  setEnabled(false);
                }
              }}
              disabled={saving || testing || !selectedProvider?.apiKeyConfigured}
            />
            <span>Удалить сохранённый API-ключ</span>
          </label>
          <label className="asa-ai-admin-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={saving || testing || clearKey || !config.encryptionReady}
            />
            <span>Разрешить ИИ-запросы для вошедших в аккаунт пользователей</span>
          </label>
          {!config.encryptionReady ? (
            <p className="asa-ai-admin-warning" role="alert">
              В окружении API необходимо настроить ASA_SETTINGS_ENCRYPTION_KEY. API-ключ модели
              нельзя безопасно сохранять без серверного ключа шифрования.
            </p>
          ) : null}
          <div className="asa-ai-admin-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={
                saving ||
                testing ||
                loading ||
                !validQuota ||
                !selectedModel?.selectable ||
                needsNewKey
              }
            >
              {saving ? 'Сохраняем…' : 'Сохранить настройки'}
            </button>
            <small>
              Настройки вступают в силу для следующих запросов. Использование API платное и
              ограничено квотой.
            </small>
          </div>
          <section aria-label="Проверка соединения с моделью">
            <p>
              Сохранение ключа не проверяет доступ к модели. Проверка ниже отправляет один платный
              запрос и не включает ИИ для пользователей.
            </p>
            <label className="asa-ai-admin-check">
              <input
                type="checkbox"
                checked={acknowledgeTest}
                disabled={saving || testing || !canTest}
                onChange={(event) => setAcknowledgeTest(event.target.checked)}
              />
              <span>Подтверждаю один платный проверочный запрос</span>
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={saving || testing || !canTest || !acknowledgeTest}
              onClick={() => void testConnection()}
            >
              {testing ? 'Проверяем модель…' : 'Проверить подключение'}
            </button>
            {connectionTest ? (
              <p role="status" className="asa-ai-admin-success">
                Модель {connectionTest.model} ответила. Проверка заняла{' '}
                {(connectionTest.elapsedMs / 1000).toFixed(1)} с.
              </p>
            ) : null}
            {unsaved ? <p>Сначала сохраните настройки для проверки.</p> : null}
            {config.paidOperationsPerHour === 0 ? (
              <p className="asa-ai-admin-warning">
                Сохранённый лимит — 0: проверка и ИИ-запросы заблокированы. Установите лимит больше
                0 и сохраните настройки, чтобы проверить подключение.
              </p>
            ) : validQuota && Number(paidOperationsPerHour) === 0 ? (
              <p className="asa-ai-admin-warning">
                Лимит 0 пока не сохранён. После сохранения он заблокирует проверку и ИИ-запросы.
                Сейчас действует сохранённый лимит: {config.paidOperationsPerHour} операций за час.
              </p>
            ) : null}
            {!config.apiKeyConfigured ? <p>Для проверки сохраните API-ключ.</p> : null}
          </section>
        </form>
      ) : null}
    </section>
  );
}
