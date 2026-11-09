import { useEffect, useRef, useState } from 'react';
import type {
  AiOllamaCloudInspection,
  AiOllamaCloudKey,
  AiOllamaCloudPool,
  AiOllamaCloudModel,
} from '@asa-lab/contracts';
import { call } from './admin-api';

type Draft = AiOllamaCloudKey & { apiKey: string; clearApiKey: boolean };
type ModelDetails = { contextTokens: number | null; modifiedAt: string | null };
const number = new Intl.NumberFormat('ru-RU');
const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' });
const keysPath = '/api/admin/v1/ai/ollama-cloud/keys';
const money = (value: number | null | undefined) =>
  value == null
    ? 'неизвестно'
    : new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(value);
function poolShape(value: unknown): value is AiOllamaCloudPool {
  const p = value as AiOllamaCloudPool | null;
  return (
    !!p &&
    Number.isSafeInteger(p.configurationVersion) &&
    typeof p.managed === 'boolean' &&
    Array.isArray(p.models) &&
    p.models.every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.model === 'string' &&
        typeof m.active === 'boolean' &&
        Array.isArray(m.capabilities),
    ) &&
    Array.isArray(p.keys) &&
    p.keys.length === 5 &&
    new Set(p.keys.map((k) => k?.slot)).size === 5 &&
    p.keys.every(
      (k) =>
        k &&
        Number.isInteger(k.slot) &&
        k.slot >= 1 &&
        k.slot <= 5 &&
        typeof k.label === 'string' &&
        typeof k.enabled === 'boolean' &&
        typeof k.configured === 'boolean' &&
        Array.isArray(k.models) &&
        k.models.every((m: unknown) => typeof m === 'string') &&
        Array.isArray(k.unavailableModels),
    )
  );
}
function status(k: AiOllamaCloudKey): string {
  if (!k.configured) return 'Не добавлен';
  if (k.account?.status === 'invalid_key') return 'Ключ не принят';
  if (k.account?.status === 'forbidden') return 'Доступ ограничен';
  if (
    k.account?.status === 'credits_required' ||
    (k.account?.balance?.includedUsd === 0 && k.account.balance.purchasedUsd === 0)
  )
    return 'Кредиты закончились';
  if (k.account?.status === 'rate_limited') return 'Временный лимит';
  if (k.blockedUntil && Date.parse(k.blockedUntil) > Date.now()) return 'Лимит исчерпан · ожидание';
  if (k.account?.status === 'unavailable') return 'Проверка недоступна';
  if (!k.enabled) return k.account?.status === 'ok' ? 'Проверен · выключен' : 'Выключен';
  return k.account?.status === 'ok' ? 'Активен' : 'Не проверен';
}
export function OllamaCloudKeys({
  version,
  encryptionReady,
  onSaved,
  onDirtyChange,
  onModels,
  onAccessDenied,
}: {
  version: number;
  encryptionReady: boolean;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onModels: (models: readonly AiOllamaCloudModel[]) => void;
  onAccessDenied: () => void;
}) {
  const [sharedModels, setSharedModels] = useState<readonly string[] | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ModelDetails | 'loading' | 'failed'>>({});
  const [showCatalog, setShowCatalog] = useState(false);
  const [pool, setPool] = useState<AiOllamaCloudPool | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const flight = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    let active = true;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    void call<unknown>(keysPath)
      .then((reply) => {
        if (!active || request !== generation.current) return;
        if (!reply.ok) {
          if ([401, 403].includes(reply.status)) onAccessDenied();
          setError('Не удалось загрузить ключи Ollama Cloud.');
          return;
        }
        if (!poolShape(reply.data)) {
          setError('Несовместимые данные ключей. Обновите страницу.');
          return;
        }
        setPool(reply.data);
        setRows(reply.data.keys.map((k) => ({ ...k, apiKey: '', clearApiKey: false })));
        setSharedModels(null);
        setDirty(false);
        onModels(reply.data.models);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [version, onModels, onAccessDenied]);
  function change(slot: number, patch: Partial<Draft>) {
    setRows((old) => old.map((k) => (k.slot === slot ? { ...k, ...patch } : k)));
    setDirty(true);
    setNotice('');
  }
  function move(slot: number, direction: number) {
    setRows((old) => {
      const next = [...old].sort((a, b) => a.priority - b.priority);
      const i = next.findIndex((k) => k.slot === slot),
        j = i + direction;
      if (j < 0 || j >= next.length) return old;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next.map((k, index) => ({ ...k, priority: index + 1 }));
    });
    setDirty(true);
    setNotice('');
  }
  const configured = rows.filter((key) => key.configured);
  const models = sharedModels ?? [
    ...new Set((configured.length ? configured : rows).flatMap((key) => key.models)),
  ];
  const different = configured.some(
    (key) => key.models.length !== models.length || models.some((id) => !key.models.includes(id)),
  );
  const catalog = (pool?.models ?? []).filter((model) => model.active || models.includes(model.id));
  const visibleModels = showCatalog
    ? catalog
    : catalog.filter((model) => models.includes(model.id));

  async function modelDetails(id: string) {
    setModelId((old) => (old === id ? null : id));
    if (details[id] && details[id] !== 'failed') return;
    setDetails((old) => ({ ...old, [id]: 'loading' }));
    const reply = await call<ModelDetails>('/api/admin/v1/ai/ollama-cloud/model-details', {
      method: 'POST',
      body: JSON.stringify({ model: id }),
    });
    setDetails((old) => ({ ...old, [id]: reply.ok ? reply.data : 'failed' }));
    if (!reply.ok && [401, 403].includes(reply.status)) onAccessDenied();
  }

  async function execute(action: 'save' | 'catalog' | 'check', slot?: number) {
    if (!pool || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const request = generation.current;
    let saved = false;
    let version = pool.configurationVersion;

    async function update(path: string, method: string, payload: object) {
      const reply = await call<unknown>(path, {
        method,
        body: JSON.stringify({ configurationVersion: version, ...payload }),
      });
      if (request !== generation.current) return null;
      if (!reply.ok) {
        if ([401, 403].includes(reply.status)) onAccessDenied();
        setError(
          (saved ? 'Ключ сохранён. ' : '') +
            (reply.status === 409
              ? saved
                ? 'Настройки изменились. Повторите проверку.'
                : 'Настройки изменились. Обновите вкладку; ваши правки не сохранены.'
              : reply.error.message || 'Не удалось выполнить операцию.'),
        );
        return null;
      }
      if (!poolShape(reply.data)) {
        setError('Сервер вернул несовместимые настройки.');
        return null;
      }
      setPool(reply.data);
      onModels(reply.data.models);
      return reply.data;
    }

    try {
      const key = rows.find((row) => row.slot === slot);
      const candidate = action === 'check' ? key?.apiKey.trim() : undefined;
      for (const draft of action === 'save' ? editedKey : candidate && key ? [key] : []) {
        const checked = await call<AiOllamaCloudInspection>(
          '/api/admin/v1/ai/ollama-cloud/inspect',
          {
            method: 'POST',
            body: JSON.stringify({ configurationVersion: version, apiKey: draft.apiKey.trim() }),
          },
        );
        if (request !== generation.current) return;
        if (!checked.ok) {
          if ([401, 403].includes(checked.status)) onAccessDenied();
          setError(checked.error.message || 'Не удалось проверить новый ключ.');
          return;
        }
        if (!['ok', 'credits_required'].includes(checked.data.account?.status)) {
          setError(
            'Ключ ' +
              draft.slot +
              ' · ' +
              status({
                ...draft,
                configured: true,
                enabled: true,
                account: checked.data.account,
                blockedUntil: null,
              }) +
              '. Изменения не сохранены.',
          );
          return;
        }
      }
      if (action === 'save' || candidate) {
        const next = await update(keysPath, 'PUT', {
          keys: rows.map((row) => ({
            slot: row.slot,
            label: row.label,
            priority: row.priority,
            enabled: row.enabled || (!row.configured && Boolean(row.apiKey.trim())),
            models:
              (action === 'save' ? sharedModels : null) ??
              (!row.configured && row.apiKey.trim() ? models : row.models),
            ...(row.apiKey.trim() ? { apiKey: row.apiKey.trim() } : {}),
            ...(row.clearApiKey ? { clearApiKey: true } : {}),
          })),
        });
        if (!next) return;
        version = next.configurationVersion;
        saved = true;
        setRows(next.keys.map((row) => ({ ...row, apiKey: '', clearApiKey: false })));
        setSharedModels(null);
        setDirty(false);
        setNotice(action === 'save' ? 'Ключи и модели сохранены' : 'Ключ сохранён');
      }
      if (action === 'save') return;
      const next = await update(keysPath + '/inspect', 'POST', slot === undefined ? {} : { slot });
      if (!next) return;
      setRows(next.keys.map((row) => ({ ...row, apiKey: '', clearApiKey: false })));
      if (action === 'catalog') {
        setShowCatalog(true);
        setNotice('Каталог обновлён');
      } else {
        const checked = next.keys.find((row) => row.slot === slot);
        setNotice(checked ? 'Ключ ' + slot + ' · ' + status(checked) : 'Проверка завершена');
      }
    } finally {
      if (saved) onSaved();
      flight.current = false;
      setBusy(false);
    }
  }

  const editedKey = rows.filter((row) => row.apiKey.trim());
  const hasOtherEdits =
    dirty &&
    (sharedModels !== null ||
      rows.some((row) => {
        const old = pool?.keys.find((key) => key.slot === row.slot);
        return row.clearApiKey || row.priority !== old?.priority || row.enabled !== old?.enabled;
      }));

  function chooseModels(next: readonly string[]) {
    setSharedModels(next);
    setDirty(true);
    setNotice('');
  }

  return (
    <div className="asa-cloud-key-pool">
      <div className="asa-cloud-pool-heading">
        <strong>API-ключи</strong>
        <small title="При подтверждённом отказе из-за лимита или баланса запрос перейдёт к следующему доступному ключу.">
          По порядку приоритета
        </small>
        <a href="https://ollama.com/settings/keys" target="_blank" rel="noopener noreferrer">
          Получить ключ
        </a>
      </div>
      {!encryptionReady ? <p role="alert">На сервере не настроено шифрование ключей.</p> : null}
      {[...rows]
        .sort((a, b) => a.priority - b.priority)
        .map((key, index) => {
          const balance = key.account?.balance;
          const balances = [
            balance?.includedUsd != null ? 'В тарифе: ' + money(balance.includedUsd) : '',
            balance?.purchasedUsd != null ? 'Куплено: ' + money(balance.purchasedUsd) : '',
            balance?.sessionRemainingPercent != null
              ? 'Сессия: ' + balance.sessionRemainingPercent + '%'
              : '',
            balance?.weeklyRemainingPercent != null
              ? 'Неделя: ' + balance.weeklyRemainingPercent + '%'
              : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <div className="asa-cloud-key-row" key={key.slot}>
              <strong>Ключ {key.slot}</strong>
              <span
                className="asa-cloud-key-status"
                title={balances || undefined}
                data-active={status(key) === 'Активен'}
              >
                {key.clearApiKey ? 'Будет удалён' : status(key)}
                {balances && !key.clearApiKey ? <small>{balances}</small> : null}
              </span>
              <input
                type="password"
                aria-label={'API-ключ ' + key.slot}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={2048}
                value={key.apiKey}
                placeholder={key.configured ? 'Введите для замены' : 'Вставьте ключ'}
                disabled={busy || !encryptionReady || key.clearApiKey}
                onChange={(event) => change(key.slot, { apiKey: event.target.value })}
              />
              <button
                type="button"
                aria-label={'Проверить ключ ' + key.slot}
                disabled={
                  busy ||
                  !encryptionReady ||
                  key.clearApiKey ||
                  (!key.configured && !key.apiKey.trim()) ||
                  hasOtherEdits ||
                  editedKey.some((row) => row.slot !== key.slot)
                }
                title={
                  key.apiKey.trim() ? 'Проверить и сохранить этот ключ' : 'Проверить ключ и баланс'
                }
                onClick={() => void execute('check', key.slot)}
              >
                {key.apiKey.trim() ? 'Проверить и сохранить' : 'Проверить'}
              </button>
              <label className="asa-cloud-key-toggle" title="Использовать этот ключ">
                <input
                  type="checkbox"
                  aria-label={'Использовать ключ ' + key.slot}
                  checked={key.enabled}
                  disabled={busy || !key.configured || key.clearApiKey}
                  onChange={(event) => change(key.slot, { enabled: event.target.checked })}
                />
              </label>
              <div className="asa-cloud-key-order">
                <button
                  type="button"
                  aria-label={'Поднять ключ ' + key.slot}
                  disabled={busy || index === 0}
                  onClick={() => move(key.slot, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={'Опустить ключ ' + key.slot}
                  disabled={busy || index === 4}
                  onClick={() => move(key.slot, 1)}
                >
                  ↓
                </button>
                {key.configured ? (
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={key.clearApiKey}
                    aria-label={
                      key.clearApiKey
                        ? 'Отменить удаление ключа ' + key.slot
                        : 'Удалить ключ ' + key.slot
                    }
                    title={key.clearApiKey ? 'Отменить удаление' : 'Удалить при сохранении'}
                    onClick={() => change(key.slot, { clearApiKey: !key.clearApiKey, apiKey: '' })}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      {pool ? (
        <div className="asa-cloud-catalog">
          <div className="asa-cloud-pool-heading">
            <strong>
              Общие модели <small>· {models.length} выбрано</small>
            </strong>
            <button type="button" disabled={busy || dirty} onClick={() => void execute('catalog')}>
              Обновить каталог
            </button>
            <button
              type="button"
              aria-expanded={showCatalog}
              onClick={() => setShowCatalog(!showCatalog)}
            >
              {showCatalog ? 'Только выбранные' : 'Выбрать модели'}
            </button>
          </div>
          {sharedModels === null && different ? (
            <div className="asa-cloud-pool-heading">
              <small>У сохранённых ключей разные списки.</small>
              <button type="button" disabled={busy} onClick={() => chooseModels(models)}>
                Применить общий список
              </button>
            </div>
          ) : null}
          {!visibleModels.length ? (
            <small>{showCatalog ? 'Каталог пуст' : 'Модели ещё не выбраны'}</small>
          ) : null}
          <ul className="asa-cloud-catalog-list">
            {visibleModels.map((model) => {
              const metadata = details[model.id];
              return (
                <li className="asa-cloud-model-row" key={model.id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy || (!model.active && !models.includes(model.id))}
                      checked={models.includes(model.id)}
                      onChange={(event) =>
                        chooseModels(
                          event.target.checked
                            ? [...models, model.id]
                            : models.filter((id) => id !== model.id),
                        )
                      }
                    />
                    <span>{model.model}</span>
                  </label>
                  <small>
                    {!model.active
                      ? 'Снята с каталога'
                      : model.capabilities.includes('vision')
                        ? 'Читает изображения'
                        : 'Только текст'}
                  </small>
                  <button
                    type="button"
                    aria-expanded={modelId === model.id}
                    disabled={!model.active}
                    aria-label={'Сведения о модели ' + model.model}
                    onClick={() => void modelDetails(model.id)}
                  >
                    ⓘ
                  </button>
                  {modelId === model.id ? (
                    <small role="status" className="asa-cloud-model-details">
                      {metadata === 'loading'
                        ? 'Загрузка…'
                        : metadata === 'failed' || !metadata
                          ? 'Сведения недоступны. Откройте ещё раз для повтора.'
                          : 'Контекст: ' +
                            (metadata.contextTokens
                              ? number.format(metadata.contextTokens) + ' токенов'
                              : 'нет данных') +
                            ' · Обновление в Ollama: ' +
                            (metadata.modifiedAt
                              ? date.format(new Date(metadata.modifiedAt))
                              : 'нет данных')}
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="asa-cloud-pool-heading">
        <button
          className="asa-cloud-apply"
          type="button"
          disabled={busy || !dirty || !encryptionReady}
          onClick={() => void execute('save')}
        >
          Сохранить ключи и модели
        </button>
        <span role="status">{busy ? 'Подождите…' : notice}</span>
      </div>
      {error ? (
        <p role="alert" className="asa-cloud-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
