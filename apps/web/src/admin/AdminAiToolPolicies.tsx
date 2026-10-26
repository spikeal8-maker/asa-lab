import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import './ai-tool-policies.css';

const TOOL_LABELS = {
  weather: 'Погода',
  web_search: 'Интернет-поиск',
  image_search: 'Поиск изображений',
  generate_image: 'Генерация изображений',
} as const;
type ToolId = keyof typeof TOOL_LABELS;
const TOOL_IDS = Object.keys(TOOL_LABELS) as ToolId[];
const ENDPOINT = '/api/admin/ai/tool-policy';

interface ToolPolicy {
  readonly id: ToolId;
  readonly label: string;
  readonly enabled: boolean;
  readonly instructions: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly usageDescription?: string;
  readonly parameters: readonly string[];
  readonly resultDescription: string;
  readonly hardLimits: readonly string[];
}

interface ToolPolicyConfiguration {
  readonly schemaVersion: 1;
  readonly configurationVersion: number;
  readonly tools: readonly ToolPolicy[];
}

interface ToolEdit {
  id: ToolId;
  enabled: boolean;
  instructions: string;
}

function isConfiguration(value: unknown): value is ToolPolicyConfiguration {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<ToolPolicyConfiguration>;
  if (
    data.schemaVersion !== 1 ||
    !Number.isSafeInteger(data.configurationVersion) ||
    (data.configurationVersion ?? -1) < 0 ||
    !Array.isArray(data.tools) ||
    data.tools.length !== TOOL_IDS.length
  )
    return false;
  const ids = new Set<string>();
  for (const tool of data.tools) {
    if (!tool || !TOOL_IDS.includes(tool.id) || ids.has(tool.id)) return false;
    ids.add(tool.id);
    if (
      typeof tool.label !== 'string' ||
      typeof tool.enabled !== 'boolean' ||
      typeof tool.instructions !== 'string' ||
      typeof tool.available !== 'boolean' ||
      (tool.reason !== null && typeof tool.reason !== 'string') ||
      (tool.usageDescription !== undefined && typeof tool.usageDescription !== 'string') ||
      !Array.isArray(tool.parameters) ||
      !tool.parameters.every((item: unknown) => typeof item === 'string') ||
      typeof tool.resultDescription !== 'string' ||
      !Array.isArray(tool.hardLimits) ||
      !tool.hardLimits.every((item: unknown) => typeof item === 'string')
    )
      return false;
  }
  return true;
}

function editable(configuration: ToolPolicyConfiguration): ToolEdit[] {
  return TOOL_IDS.map((id) => {
    const tool = configuration.tools.find((item) => item.id === id)!;
    return { id, enabled: tool.enabled, instructions: tool.instructions };
  });
}

function sameEdits(left: readonly ToolEdit[], right: readonly ToolEdit[]): boolean {
  return TOOL_IDS.every((id) => {
    const a = left.find((tool) => tool.id === id);
    const b = right.find((tool) => tool.id === id);
    return a?.enabled === b?.enabled && a?.instructions === b?.instructions;
  });
}

export function AdminAiToolPolicies({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [configuration, setConfiguration] = useState<ToolPolicyConfiguration | null>(null);
  const [edits, setEdits] = useState<ToolEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const draftBeforeReload = useRef<{
    configuration: ToolPolicyConfiguration;
    edits: ToolEdit[];
  } | null>(null);

  function reloadCurrent() {
    if (configuration) draftBeforeReload.current = { configuration, edits };
    setConfiguration(null);
    setNotice('');
    setReload((value) => value + 1);
  }

  useEffect(() => {
    let live = true;
    setLoading(true);
    void call<unknown>(ENDPOINT)
      .then((reply) => {
        if (!live) return;
        if (!reply.ok) {
          setConfiguration(null);
          if (reply.status === 401 || reply.status === 403) onAccessDenied();
          setError(
            reply.status === 404
              ? 'API настроек инструментов ещё недоступен. Текущее состояние неизвестно.'
              : 'Не удалось загрузить состояние инструментов.',
          );
        } else if (isConfiguration(reply.data)) {
          const previous = draftBeforeReload.current;
          const hasDraft = previous && !sameEdits(previous.edits, editable(previous.configuration));
          setConfiguration(reply.data);
          setEdits(hasDraft ? previous.edits : editable(reply.data));
          const changedOnServer = Boolean(
            hasDraft &&
            previous.configuration.configurationVersion !== reply.data.configurationVersion,
          );
          setConflict(changedOnServer);
          setError(
            changedOnServer
              ? 'Настройки изменились на сервере. Ваш черновик сохранён в форме; сбросьте его после проверки актуальных значений.'
              : '',
          );
          setNotice('');
          if (!hasDraft) attempt.current = null;
          draftBeforeReload.current = null;
        } else {
          setConfiguration(null);
          setError('Сервер вернул несовместимые настройки инструментов.');
        }
      })
      .catch(() => {
        if (live) {
          setConfiguration(null);
          setError('Не удалось загрузить состояние инструментов.');
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [onAccessDenied, reload]);

  const invalid = edits.some((tool) => tool.instructions.length > 3000);
  const changed = configuration !== null && !sameEdits(edits, editable(configuration));

  function update(id: ToolId, field: 'enabled' | 'instructions', value: boolean | string) {
    setEdits((previous) =>
      previous.map((tool) => (tool.id === id ? { ...tool, [field]: value } : tool)),
    );
    setNotice('');
  }

  async function reconcile(expectedVersion: number, submitted: readonly ToolEdit[]) {
    try {
      const reply = await call<unknown>(ENDPOINT);
      if (reply.status === 401 || reply.status === 403) onAccessDenied();
      if (reply.ok && isConfiguration(reply.data)) {
        if (
          reply.data.configurationVersion > expectedVersion &&
          sameEdits(editable(reply.data), submitted)
        ) {
          setConfiguration(reply.data);
          setNotice(
            'Сервер показывает выбранные настройки. Подтверждение исходного запроса не получено.',
          );
          setError('');
          return;
        }
        if (reply.data.configurationVersion !== expectedVersion) {
          setConfiguration(reply.data);
          setConflict(true);
          setError(
            'Настройки изменились на сервере. Загрузите актуальную версию перед сохранением. Ваши правки пока остаются в форме.',
          );
          return;
        }
      }
    } catch {
      /* The original request can still be retried with the same requestId. */
    }
    if (configuration) draftBeforeReload.current = { configuration, edits };
    setConfiguration(null);
    setError(
      'Нет подтверждения сохранения или актуального состояния. Загрузите настройки; ваш черновик сохранён в форме.',
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!configuration || inFlight.current || invalid || !changed || conflict) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const submitted = edits.map((tool) => ({ ...tool }));
    const fields = {
      schemaVersion: 1 as const,
      expectedConfigurationVersion: configuration.configurationVersion,
      tools: submitted,
    };
    const signature = JSON.stringify(fields);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    try {
      const reply = await call<unknown>(ENDPOINT, {
        method: 'PUT',
        body: JSON.stringify({ ...fields, requestId: attempt.current.id }),
      });
      if (!reply.ok) {
        if (reply.status === 401 || reply.status === 403) onAccessDenied();
        if (reply.status === 409) {
          setConflict(true);
          setError(
            'Настройки изменились на сервере. Загрузите актуальную версию перед сохранением. Ваши правки пока остаются в форме.',
          );
        } else if (reply.status === 401 || reply.status === 403) {
          setError('Доступ к настройкам инструментов запрещён.');
        } else {
          await reconcile(configuration.configurationVersion, submitted);
        }
      } else if (
        isConfiguration(reply.data) &&
        reply.data.configurationVersion > configuration.configurationVersion &&
        sameEdits(editable(reply.data), submitted)
      ) {
        setConfiguration(reply.data);
        setEdits(editable(reply.data));
        attempt.current = null;
        setNotice('Настройки инструментов сохранены.');
      } else {
        await reconcile(configuration.configurationVersion, submitted);
      }
    } catch {
      await reconcile(configuration.configurationVersion, submitted);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="asa-ai-tools" aria-labelledby="ai-tool-policies-title">
      <div className="asa-ai-tools-heading">
        <h2 id="ai-tool-policies-title">Инструменты помощника</h2>
        <p>
          Настройки управляют native-вызовами локальной модели и ручной генерацией изображений.
          Явные режимы поиска и погоды подготавливают данные до ответа модели; технические
          ограничения и правила безопасности действуют всегда.
        </p>
        {configuration ? (
          <button
            type="button"
            className="asa-ai-tools-refresh"
            disabled={loading || busy}
            onClick={reloadCurrent}
          >
            Обновить состояние инструментов
          </button>
        ) : null}
      </div>
      {loading ? <p role="status">Загружаем инструменты…</p> : null}
      {error ? (
        <div className="asa-cloud-error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={loading || busy} onClick={reloadCurrent}>
            Загрузить актуальные настройки
          </button>
          {conflict && configuration ? (
            <button
              type="button"
              onClick={() => {
                setEdits(editable(configuration));
                setConflict(false);
                setError('');
                attempt.current = null;
              }}
            >
              Сбросить черновик и показать текущие значения
            </button>
          ) : null}
        </div>
      ) : null}
      {!configuration && !loading ? (
        <p role="status">Состояние инструментов неизвестно. Сохранение недоступно.</p>
      ) : null}
      {configuration ? (
        <form onSubmit={(event) => void save(event)}>
          <div className="asa-ai-tools-grid">
            {TOOL_IDS.map((id) => {
              const tool = configuration.tools.find((item) => item.id === id)!;
              const edit = edits.find((item) => item.id === id)!;
              return (
                <article className="asa-ai-tool-card" key={id} aria-label={TOOL_LABELS[id]}>
                  <div className="asa-ai-tool-card-title">
                    <h3>{TOOL_LABELS[id]}</h3>
                    <span
                      className={tool.available ? 'asa-ai-tool-status ready' : 'asa-ai-tool-status'}
                    >
                      {tool.available ? (tool.enabled ? 'Доступен' : 'Выключен') : 'Недоступен'}
                    </span>
                  </div>
                  <p className="asa-ai-tool-reason">
                    {tool.available
                      ? 'Подключение готово.'
                      : tool.reason || 'Причина недоступности не указана сервером.'}
                  </p>
                  <label className="asa-ai-tool-toggle">
                    <input
                      type="checkbox"
                      checked={edit.enabled}
                      disabled={busy || (!tool.available && !edit.enabled)}
                      onChange={(event) => update(id, 'enabled', event.target.checked)}
                    />{' '}
                    Включить инструмент
                  </label>
                  <dl>
                    <dt>Когда используется</dt>
                    <dd>{tool.usageDescription || 'Сервер не указал условия использования.'}</dd>
                    <dt>Параметры запроса</dt>
                    <dd>
                      {tool.parameters.length
                        ? tool.parameters.join(' · ')
                        : 'Параметры не указаны сервером.'}
                    </dd>
                    <dt>Результат</dt>
                    <dd>{tool.resultDescription || 'Описание результата не указано сервером.'}</dd>
                    <dt>Неизменяемые ограничения</dt>
                    <dd>
                      {tool.hardLimits.length ? (
                        <ul>
                          {tool.hardLimits.map((limit) => (
                            <li key={limit}>{limit}</li>
                          ))}
                        </ul>
                      ) : (
                        'Ограничения не указаны сервером.'
                      )}
                    </dd>
                  </dl>
                  <label className="asa-ai-tool-instructions">
                    Дополнительные инструкции
                    <textarea
                      value={edit.instructions}
                      maxLength={3000}
                      disabled={busy}
                      onChange={(event) => update(id, 'instructions', event.target.value)}
                      aria-label={'Дополнительные инструкции: ' + TOOL_LABELS[id]}
                    />
                    <small>
                      {edit.instructions.length} / 3000 символов. Инструкции не могут отменить
                      ограничения и фильтры.
                    </small>
                  </label>
                </article>
              );
            })}
            <article className="asa-ai-tool-card asa-ai-tool-future" aria-label="Видео — скоро">
              <div className="asa-ai-tool-card-title">
                <h3>Видео — скоро</h3>
                <span className="asa-ai-tool-status">Недоступен</span>
              </div>
              <p>Инструмент пока не подключён. Настроек включения нет.</p>
            </article>
          </div>
          <div className="asa-ai-tools-actions">
            <button
              type="submit"
              className="asa-cloud-apply"
              disabled={busy || loading || invalid || conflict || !changed}
            >
              {busy ? 'Сохраняем…' : 'Сохранить инструменты'}
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
