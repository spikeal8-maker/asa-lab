import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiGenerationPolicy, AiGenerationPolicyUpdate } from '@asa-lab/contracts';
import { call } from './admin-api';
import './ai-generation-policy.css';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'ollama-cloud', label: 'Ollama Cloud' },
  { id: 'ollama', label: 'Ollama · локально' },
] as const;

function policyShape(value: unknown): value is AiGenerationPolicy {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AiGenerationPolicy>;
  return (
    data.schemaVersion === 1 &&
    Number.isSafeInteger(data.configurationVersion) &&
    typeof data.systemPrompt === 'string' &&
    (data.defaultModel === null || typeof data.defaultModel === 'string') &&
    Array.isArray(data.allowedModels) &&
    data.allowedModels.every((model) => typeof model === 'string') &&
    Array.isArray(data.models) &&
    data.models.length <= 100 &&
    data.models.every(
      (model) =>
        model &&
        typeof model.id === 'string' &&
        typeof model.label === 'string' &&
        PROVIDERS.some((provider) => provider.id === model.provider) &&
        typeof model.ready === 'boolean' &&
        typeof model.selectable === 'boolean' &&
        typeof model.allowed === 'boolean',
    ) &&
    Array.isArray(data.variables) &&
    data.variables.length <= 20 &&
    data.variables.every(
      (variable) =>
        variable &&
        typeof variable.name === 'string' &&
        typeof variable.label === 'string' &&
        typeof variable.source === 'string' &&
        typeof variable.missingValue === 'string',
    )
  );
}

export function AdminAiGenerationPolicy({
  section,
  onAccessDenied,
}: {
  readonly section: 'prompt' | 'settings';
  readonly onAccessDenied: () => void;
}) {
  const [config, setConfig] = useState<AiGenerationPolicy | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedModels, setAllowedModels] = useState<readonly string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);

  const apply = (data: AiGenerationPolicy) => {
    setConfig(data);
    setSystemPrompt(data.systemPrompt);
    setAllowedModels(data.allowedModels);
    setDefaultModel(data.defaultModel);
    setConflict(false);
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    void call<unknown>('/api/admin/v1/ai/generation-policy')
      .then((reply) => {
        if (!live) return;
        if (!reply.ok) {
          if (reply.status === 401 || reply.status === 403) onAccessDenied();
          setError(
            reply.status === 404
              ? 'Для системного промпта и выбора моделей требуется обновление API и схемы ASA.'
              : 'Не удалось загрузить настройки ответов.',
          );
        } else if (policyShape(reply.data)) {
          apply(reply.data);
          setError('');
          setNotice('');
          attempt.current = null;
        } else setError('Настройки ответов несовместимы с этой версией.');
      })
      .catch(() => {
        if (live) setError('Не удалось загрузить настройки ответов.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [onAccessDenied, reload]);

  const unknownVariables = [
    ...new Set(
      [...systemPrompt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
        .map((match) => match[1]!.trim())
        .filter((name) => !config?.variables.some((variable) => variable.name === name)),
    ),
  ];
  const defaultAvailable =
    (defaultModel === null && allowedModels.length === 0) ||
    (defaultModel !== null &&
      allowedModels.includes(defaultModel) &&
      config?.models.some((model) => model.id === defaultModel && model.ready && model.selectable));
  const valid =
    systemPrompt.trim().length > 0 &&
    systemPrompt.length <= 12000 &&
    unknownVariables.length === 0 &&
    defaultAvailable;

  function insertVariable(name: string) {
    const field = editor.current;
    const start = field?.selectionStart ?? systemPrompt.length;
    const end = field?.selectionEnd ?? start;
    const token = '{{' + name + '}}';
    setSystemPrompt(systemPrompt.slice(0, start) + token + systemPrompt.slice(end));
    setNotice('');
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config || inFlight.current || !valid || conflict) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const fields = {
      configurationVersion: config.configurationVersion,
      systemPrompt,
      defaultModel,
      allowedModels,
    };
    const signature = JSON.stringify(fields);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    const payload: AiGenerationPolicyUpdate = { ...fields, requestId: attempt.current.id };
    try {
      const reply = await call<unknown>('/api/admin/v1/ai/generation-policy', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!reply.ok) {
        if (reply.status === 401 || reply.status === 403) onAccessDenied();
        if (reply.status === 409) {
          setConflict(true);
          setError(
            'Настройки изменились. Загрузите актуальную версию перед сохранением. Ваш текст остаётся в редакторе.',
          );
        } else
          setError(
            'Не удалось подтвердить сохранение. Повторное сохранение того же текста использует прежний запрос.',
          );
      } else if (policyShape(reply.data)) {
        apply(reply.data);
        attempt.current = null;
        setNotice('Настройки сохранены. Запрос к модели не выполнялся.');
      } else setError('Сервер вернул несовместимые настройки. Загрузите актуальную версию.');
    } catch {
      setError(
        'Нет подтверждения сохранения. Повторите сохранение без изменения полей, чтобы проверить тот же запрос.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="asa-ai-policy asa-cloud-connection"
      aria-label={section === 'prompt' ? 'Системный промпт' : 'Настройки моделей'}
    >
      {loading ? <p role="status">Загружаем настройки ответов…</p> : null}
      {error ? (
        <div role="alert" className="asa-cloud-error">
          <p>{error}</p>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            {config ? 'Загрузить актуальные настройки' : 'Повторить'}
          </button>
        </div>
      ) : null}
      {config ? (
        <form className="asa-cloud-form" onSubmit={(event) => void save(event)}>
          {section === 'prompt' ? (
            <>
              <div className="asa-ai-policy-heading">
                <h2>Системный промпт</h2>
                <p>
                  Определяет стиль и содержание ответов. Правила доступа и безопасной работы с
                  файлами действуют дополнительно.
                </p>
              </div>
              <div className="asa-ai-policy-prompt-grid">
                <label className="asa-ai-policy-editor">
                  <span>Инструкции помощнику</span>
                  <textarea
                    ref={editor}
                    aria-label="Инструкции помощнику"
                    value={systemPrompt}
                    maxLength={12000}
                    disabled={busy}
                    onChange={(event) => {
                      setSystemPrompt(event.target.value);
                      setNotice('');
                    }}
                    spellCheck={false}
                  />
                  <small>{systemPrompt.length} / 12000 символов</small>
                </label>
                <aside
                  className="asa-ai-policy-variables"
                  aria-label="Переменные системного промпта"
                >
                  <h3>Переменные</h3>
                  <p>
                    Нажмите, чтобы вставить в позицию курсора. Значения подставляются при запросе.
                  </p>
                  {config.variables.map((variable) => (
                    <div className="asa-ai-policy-variable" key={variable.name}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => insertVariable(variable.name)}
                        aria-label={'Вставить ' + variable.label}
                      >
                        <span>{variable.label}</span>
                        <code>{'{{' + variable.name + '}}'}</code>
                      </button>
                      <small>{variable.source}</small>
                      <small>Если данных нет: {variable.missingValue}</small>
                    </div>
                  ))}
                </aside>
              </div>
              {unknownVariables.length ? (
                <p role="alert">
                  Неизвестные переменные: {unknownVariables.join(', ')}. Используйте переменные из
                  списка.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="asa-ai-policy-heading">
                <h2>Модели для пользователей</h2>
                <p>
                  Отметьте доступные модели и выберите модель по умолчанию. Ключи и подключения
                  настраиваются во вкладке «Подключения».
                </p>
              </div>
              <label className="asa-cloud-field asa-ai-policy-default">
                <span>Модель по умолчанию</span>
                <select
                  aria-label="Модель по умолчанию"
                  value={defaultModel ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    setDefaultModel(event.target.value || null);
                    setNotice('');
                  }}
                >
                  <option value="">Не выбрана</option>
                  {config.models
                    .filter((model) => allowedModels.includes(model.id))
                    .map((model) => (
                      <option
                        key={model.id}
                        value={model.id}
                        disabled={!model.ready || !model.selectable}
                      >
                        {model.label}
                        {!model.ready
                          ? ' · подключение не готово'
                          : !model.selectable
                            ? ' · недоступна'
                            : ''}
                      </option>
                    ))}
                </select>
              </label>
              <div className="asa-ai-policy-models">
                {PROVIDERS.map((provider) => {
                  const models = config.models.filter((model) => model.provider === provider.id);
                  if (!models.length) return null;
                  return (
                    <fieldset key={provider.id}>
                      <legend>{provider.label}</legend>
                      {provider.id === 'ollama' ? (
                        <p>Локально используется модель, выбранная в подключении Ollama.</p>
                      ) : null}
                      {models.map((model) => (
                        <label className="asa-ai-policy-model" key={model.id}>
                          <input
                            type="checkbox"
                            checked={allowedModels.includes(model.id)}
                            disabled={
                              busy || (!model.selectable && !allowedModels.includes(model.id))
                            }
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setAllowedModels((previous) =>
                                checked
                                  ? [...previous, model.id]
                                  : previous.filter((id) => id !== model.id),
                              );
                              if (!checked && defaultModel === model.id) setDefaultModel(null);
                              setNotice('');
                            }}
                          />
                          <span>
                            <strong>{model.label}</strong>
                            <small>
                              {!model.selectable
                                ? 'Модель недоступна'
                                : model.ready
                                  ? 'Подключение готово'
                                  : 'Сначала настройте подключение'}
                            </small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </div>
              {!allowedModels.length ? (
                <p>Новые запросы к моделям запрещены. Существующая история сохраняется.</p>
              ) : null}
            </>
          )}
          {!defaultAvailable ? (
            <p role="alert">
              Выберите разрешённую подключённую модель по умолчанию во вкладке «Настройки».
            </p>
          ) : null}
          <p className="asa-ai-policy-save-note">Промпт и выбор моделей сохраняются вместе.</p>
          <div className="asa-cloud-bottom">
            <button
              type="submit"
              className="asa-cloud-apply"
              disabled={busy || loading || !valid || conflict}
            >
              {busy
                ? 'Сохраняем…'
                : section === 'prompt'
                  ? 'Сохранить промпт'
                  : 'Сохранить настройки'}
            </button>
            {notice ? (
              <span role="status" className="asa-cloud-confirmed">
                {notice}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
