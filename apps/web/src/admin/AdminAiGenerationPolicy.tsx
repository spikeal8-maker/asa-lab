import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AiPromptGuide } from './AiPromptGuide';
import { AdminAiToolPolicies } from './AdminAiToolPolicies';
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
    data.models.length <= 2400 &&
    data.models.every(
      (model) =>
        model &&
        typeof model.id === 'string' &&
        typeof model.label === 'string' &&
        PROVIDERS.some((provider) => provider.id === model.provider) &&
        typeof model.ready === 'boolean' &&
        typeof model.selectable === 'boolean' &&
        typeof model.allowed === 'boolean' &&
        (model.connectionSelected === undefined || typeof model.connectionSelected === 'boolean'),
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
  provider,
  onDirtyChange,
  onEligibleModels,
}: {
  readonly section: 'prompt' | 'settings' | 'connections';
  readonly provider?: string;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onEligibleModels?: (ids: readonly string[]) => void;
  readonly onAccessDenied: () => void;
}) {
  const [config, setConfig] = useState<AiGenerationPolicy | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedModels, setAllowedModels] = useState<readonly string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelPreferences, setModelPreferences] = useState<
    NonNullable<AiGenerationPolicy['modelPreferences']>
  >([]);
  const [providerOrder, setProviderOrder] = useState<
    NonNullable<AiGenerationPolicy['providerOrder']>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const catalogAttempts = useRef(new Set<string>());
  const attempt = useRef<{ signature: string; id: string } | null>(null);

  const apply = (data: AiGenerationPolicy) => {
    setConfig(data);
    setSystemPrompt(data.systemPrompt);
    setAllowedModels(data.allowedModels);
    setDefaultModel(data.defaultModel);
    setModelPreferences(data.modelPreferences ?? []);
    setProviderOrder(data.providerOrder ?? {});
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

  useEffect(() => {
    if (section !== 'settings' || !config || busy) return;
    const provider = (['openai', 'deepseek'] as const).find((id) => {
      const observation = config.observations?.find((o) => o.provider === id);
      return (
        !catalogAttempts.current.has(id) &&
        config.models.some((m) => m.provider === id && m.ready) &&
        (!observation?.checkedAt || Date.now() - Date.parse(observation.checkedAt) > 300000)
      );
    });
    if (provider) {
      catalogAttempts.current.add(provider);
      void refreshCatalog(provider);
    }
  }, [config, section, busy]);

  const dirty =
    !!config &&
    (systemPrompt !== config.systemPrompt ||
      defaultModel !== config.defaultModel ||
      JSON.stringify(allowedModels) !== JSON.stringify(config.allowedModels) ||
      JSON.stringify(modelPreferences) !== JSON.stringify(config.modelPreferences ?? []) ||
      JSON.stringify(providerOrder) !== JSON.stringify(config.providerOrder ?? {}));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
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
      config?.models.some(
        (model) =>
          model.id === defaultModel &&
          model.connectionSelected !== false &&
          model.ready &&
          model.selectable &&
          (modelPreferences.find((p) => p.id === model.id)?.eligible ?? model.eligible ?? true),
      ));
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
      modelPreferences,
      providerOrder,
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

  const preference = (id: string) =>
    modelPreferences.find((p) => p.id === id) ?? {
      id,
      eligible:
        config?.models.find((m) => m.id === id)?.eligible ??
        config?.models.find((m) => m.id === id)?.adapterCompatible !== false,
      order: 0,
    };
  useEffect(() => {
    if (config)
      onEligibleModels?.(
        config.models
          .filter(
            (m) =>
              m.connectionSelected !== false &&
              (section !== 'settings' || (m.ready && m.adapterCompatible !== false)) &&
              (modelPreferences.find((p) => p.id === m.id)?.eligible ??
                m.eligible ??
                m.adapterCompatible !== false),
          )
          .map((m) => m.id),
      );
    else onEligibleModels?.([]);
  }, [config, modelPreferences, onEligibleModels, section]);
  const changePreference = (id: string, patch: Partial<{ eligible: boolean; order: number }>) => {
    setModelPreferences((previous) => [
      ...previous.filter((p) => p.id !== id),
      { ...preference(id), ...patch },
    ]);
    setNotice('');
  };
  const modelRows = (id: string) =>
    (config?.models ?? [])
      .filter(
        (model) =>
          model.provider === id &&
          model.connectionSelected !== false &&
          (section === 'connections' ||
            (model.ready && model.adapterCompatible !== false && preference(model.id).eligible)),
      )
      .sort(
        (a, b) =>
          preference(a.id).order - preference(b.id).order ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  const providerRows = [...PROVIDERS]
    .filter((item) =>
      section === 'connections' ? item.id === provider : modelRows(item.id).length > 0,
    )
    .sort(
      (a, b) =>
        (providerOrder[a.id] ?? 0) - (providerOrder[b.id] ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  function move(ids: readonly string[], id: string, direction: number, kind: 'provider' | 'model') {
    const ordered = [...ids],
      from = ordered.indexOf(id),
      to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to]!, ordered[from]!];
    const ranks = Object.fromEntries(ordered.map((value, index) => [value, index]));
    if (kind === 'provider') setProviderOrder((old) => ({ ...old, ...ranks }));
    else
      setModelPreferences((old) => [
        ...old.map((row) =>
          Object.hasOwn(ranks, row.id) ? { ...row, order: ranks[row.id]! } : row,
        ),
        ...ordered
          .filter((value) => !old.some((row) => row.id === value))
          .map((value) => ({ ...preference(value), order: ranks[value]! })),
      ]);
    setNotice('');
  }
  const orderControls = (
    kind: 'provider' | 'model',
    id: string,
    label: string,
    ids: readonly string[],
  ) => {
    const index = ids.indexOf(id),
      noun = kind === 'provider' ? 'провайдера' : 'модель';
    return (
      <div className="asa-ai-reorder">
        <span className="asa-ai-rank" aria-label={'Место ' + (index + 1)}>
          {index + 1}
        </span>
        <button
          type="button"
          aria-label={'Поднять ' + noun + ' ' + label}
          disabled={busy || index <= 0}
          onClick={() => move(ids, id, -1, kind)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={'Опустить ' + noun + ' ' + label}
          disabled={busy || index === ids.length - 1}
          onClick={() => move(ids, id, 1, kind)}
        >
          ↓
        </button>
      </div>
    );
  };
  async function refreshCatalog(provider: 'openai' | 'deepseek') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const reply = await call<unknown>('/api/admin/v1/ai/generation-policy/catalog', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      });
      if (reply.ok && policyShape(reply.data)) {
        const data = reply.data;
        if (config && data.configurationVersion !== config.configurationVersion) {
          setConflict(true);
          setError(
            'Настройки изменились во время обновления каталога. Загрузите актуальную версию; ваш выбор остаётся в форме.',
          );
        }
        setConfig((previous) =>
          previous
            ? { ...previous, models: data.models, observations: data.observations ?? [] }
            : data,
        );
        if (data.observations?.find((o) => o.provider === provider)?.failed) {
          setError(
            'Не удалось обновить каталог провайдера. Последнее наблюдение и ваш выбор сохранены.',
          );
          setNotice('');
        } else
          setNotice(
            'Наблюдение каталога загружено. Несохранённый выбор моделей сохранён в форме; новые модели не публикуются автоматически.',
          );
      } else setError('Не удалось обновить каталог. Предыдущие наблюдения и выбор сохранены.');
    } catch {
      setError('Нет подтверждения обновления каталога. Предыдущие наблюдения сохранены.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className={
        'asa-ai-policy asa-cloud-connection' +
        (section === 'settings' ? ' asa-settings-compact' : '')
      }
      aria-label={
        section === 'prompt'
          ? 'Системный промпт'
          : section === 'connections'
            ? 'Модели подключения'
            : 'Настройки моделей'
      }
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
                <p>
                  Переменные «Инструменты» и «Доступные материалы» заполняются сервером для каждого
                  запроса. Они показывают фактический способ выполнения и переданные данные. Запись
                  названия инструмента в промпте не подключает его вызов к модели.
                </p>
                <p>
                  <button
                    type="button"
                    className="asa-ai-policy-guide-jump"
                    onClick={() => {
                      const heading = document.getElementById('ai-prompt-guide-title');
                      heading?.scrollIntoView({ block: 'start' });
                      heading?.focus({ preventScroll: true });
                    }}
                  >
                    Как работают промпт, переменные и инструменты ↓
                  </button>
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
                      <span className="asa-ai-variable-help">
                        <button
                          type="button"
                          className="asa-ai-variable-info"
                          aria-label={'Описание: ' + variable.label}
                          aria-describedby={'ai-variable-help-' + variable.name}
                        >
                          <span aria-hidden="true">i</span>
                        </button>
                        <span
                          className="asa-ai-variable-tooltip"
                          role="tooltip"
                          id={'ai-variable-help-' + variable.name}
                        >
                          <strong>{variable.label}</strong>
                          <span>{variable.source}.</span>
                          <span>Если данных нет: {variable.missingValue}.</span>
                          <span>
                            Значение вычисляется сервером при отправке сообщения. Часы компьютера
                            администратора не используются.
                          </span>
                          {variable.name === 'capabilities' ? (
                            <span>
                              Возможности именно этого запроса: текст, подключённые инструменты и
                              разрешённые вложения. Это не список прав пользователя и не доступ ко
                              всему его профилю.
                            </span>
                          ) : null}
                          {variable.name === 'gender' || variable.name === 'location' ? (
                            <span>
                              Сейчас реальных данных для этой переменной нет. Пол не угадывается по
                              имени, геопозиция не определяется по IP.
                            </span>
                          ) : null}
                        </span>
                      </span>
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
                <h2>
                  {section === 'connections' ? 'Модели подключения' : 'Модели для пользователей'}
                </h2>
                <p>
                  {section === 'settings'
                    ? 'Отметьте модели для пользователей. Список подключений задаётся отдельно.'
                    : 'Выберите модели подключения. Показ пользователям задаётся в Настройках.'}
                </p>
              </div>
              {section !== 'connections' ? (
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
                    {defaultModel &&
                    !config.models.some(
                      (m) =>
                        m.id === defaultModel &&
                        m.connectionSelected !== false &&
                        m.ready &&
                        preference(m.id).eligible,
                    ) ? (
                      <option value={defaultModel} disabled>
                        Сохранённая модель недоступна: {defaultModel}
                      </option>
                    ) : null}
                    {config.models
                      .filter(
                        (model) =>
                          model.ready &&
                          allowedModels.includes(model.id) &&
                          preference(model.id).eligible &&
                          model.connectionSelected !== false,
                      )
                      .map((model) => (
                        <option
                          key={model.id}
                          value={model.id}
                          disabled={
                            !model.ready || !model.selectable || !preference(model.id).eligible
                          }
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
              ) : null}
              <div className="asa-ai-policy-models">
                {providerRows.map((provider) => {
                  const models = modelRows(provider.id);
                  const observation = config.observations?.find((o) => o.provider === provider.id);
                  if (!models.length) return null;
                  return (
                    <fieldset key={provider.id}>
                      <legend>
                        <span>{provider.label}</span>
                        {section === 'settings'
                          ? orderControls(
                              'provider',
                              provider.id,
                              provider.label,
                              providerRows.map((row) => row.id),
                            )
                          : null}
                      </legend>
                      {provider.id === 'openai' || provider.id === 'deepseek' ? (
                        <details
                          className="asa-ai-catalog-observation"
                          open={section === 'connections'}
                        >
                          <summary>Каталог и обновление</summary>
                          <p>
                            {observation?.checkedAt
                              ? 'Наблюдение: ' + new Date(observation.checkedAt).toLocaleString()
                              : 'Встроенный каталог ASA; доступ в аккаунте не проверен.'}
                            {observation?.credentialChanged
                              ? ' · Ключ изменился; доступ требует нового наблюдения.'
                              : observation?.failed
                                ? ' · Обновление не удалось; последнее наблюдение может быть устаревшим.'
                                : observation?.checkedAt &&
                                    Date.now() - Date.parse(observation.checkedAt) > 86400000
                                  ? ' · Наблюдение устарело.'
                                  : ''}
                          </p>
                          <small>
                            {observation?.source ??
                              (provider.id === 'openai'
                                ? 'https://api.openai.com/v1/models'
                                : 'https://api.deepseek.com/models')}{' '}
                            · метаданные не подтверждают адаптер ASA
                          </small>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void refreshCatalog(provider.id as 'openai' | 'deepseek')
                            }
                          >
                            Обновить каталог {provider.label}
                          </button>
                        </details>
                      ) : null}
                      {section === 'connections' && provider.id === 'ollama' ? (
                        <p>Локально используется модель, выбранная в подключении Ollama.</p>
                      ) : null}
                      {models.map((model) => (
                        <div className="asa-ai-policy-model-row" key={model.id}>
                          {section === 'connections' ? (
                            <label>
                              <input
                                type="checkbox"
                                aria-label={'Разрешить у провайдера ' + model.label}
                                checked={preference(model.id).eligible}
                                disabled={
                                  busy ||
                                  model.adapterCompatible === false ||
                                  model.id === defaultModel
                                }
                                onChange={(e) =>
                                  changePreference(model.id, { eligible: e.target.checked })
                                }
                              />
                              Использовать в настройках ASA
                              {model.id === defaultModel ? (
                                <small>
                                  Сначала выберите другую модель по умолчанию в Настройках.
                                </small>
                              ) : null}
                            </label>
                          ) : null}
                          {section !== 'connections' ? (
                            <>
                              {orderControls(
                                'model',
                                model.id,
                                model.label,
                                models.map((row) => row.id),
                              )}
                              <label className="asa-ai-policy-model">
                                <input
                                  type="checkbox"
                                  aria-label={'Показывать пользователям: ' + model.label}
                                  checked={allowedModels.includes(model.id)}
                                  disabled={
                                    busy ||
                                    ((!model.selectable || !preference(model.id).eligible) &&
                                      !allowedModels.includes(model.id))
                                  }
                                  onChange={(event) => {
                                    const checked = event.target.checked;
                                    setAllowedModels((previous) =>
                                      checked
                                        ? [...previous, model.id]
                                        : previous.filter((id) => id !== model.id),
                                    );
                                    if (!checked && defaultModel === model.id)
                                      setDefaultModel(null);
                                    setNotice('');
                                  }}
                                />
                                <span>
                                  <strong>{model.label}</strong>
                                  {model.id !== model.label ? (
                                    <small title={model.id}>{model.id}</small>
                                  ) : null}
                                  <small>
                                    {(!preference(model.id).eligible
                                      ? 'Запрещена у провайдера'
                                      : model.unavailableReason) ??
                                      (!model.selectable
                                        ? 'Модель недоступна'
                                        : model.ready
                                          ? 'Подключение готово'
                                          : 'Сначала настройте подключение')}
                                  </small>
                                </span>
                              </label>
                            </>
                          ) : null}
                        </div>
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
          <p className="asa-ai-policy-save-note">
            {dirty ? 'Есть несохранённые изменения. ' : ''}Подключения определяют список моделей;
            Настройки — их показ пользователям.
          </p>
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
                  : section === 'connections'
                    ? 'Сохранить модели подключения'
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
      {section === 'prompt' ? <AdminAiToolPolicies onAccessDenied={onAccessDenied} /> : null}
      {config && section === 'prompt' ? <AiPromptGuide variables={config.variables} /> : null}
    </section>
  );
}
