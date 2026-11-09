import { useEffect, useImperativeHandle, useRef, useState, type MutableRefObject } from 'react';
import type {
  AiOllamaCloudInspection,
  AiOllamaCloudKey,
  AiOllamaCloudPool,
  AiOllamaCloudModel,
} from '@asa-lab/contracts';
import { call } from './admin-api';

type Draft = AiOllamaCloudKey & { apiKey: string; clearApiKey: boolean };
export type CloudPoolSave = (version: number) => Promise<AiOllamaCloudPool | null>;
type KeyCheck = { tone: 'pending' | 'success' | 'error'; text: string };
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
  saveRef,
  locked = false,
  onBusyChange,
  onKeyReadyChange,
  onDirtyChange,
  onModels,
  onAccessDenied,
}: {
  version: number;
  encryptionReady: boolean;
  saveRef: MutableRefObject<CloudPoolSave | null>;
  locked?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onKeyReadyChange?: (ready: boolean) => void;
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
  const [checks, setChecks] = useState<Record<number, KeyCheck | undefined>>({});
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const keyReady = rows.some(
    (row) =>
      !row.clearApiKey &&
      ((row.configured && row.enabled) || (!row.configured && Boolean(row.apiKey.trim()))),
  );
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => onKeyReadyChange?.(keyReady), [keyReady, onKeyReadyChange]);
  const disabled = busy || locked;
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
    if (patch.apiKey !== undefined || patch.clearApiKey !== undefined)
      setChecks((old) => ({ ...old, [slot]: undefined }));
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

  async function execute(
    action: 'save' | 'catalog' | 'check',
    slot?: number,
    expectedVersion?: number,
  ) {
    if (!pool || flight.current) return null;
    if (expectedVersion !== undefined && expectedVersion !== pool.configurationVersion) {
      setError('Настройки изменились. Обновите вкладку перед сохранением.');
      return null;
    }
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const request = generation.current;
    const version = pool.configurationVersion;

    function result(keySlot: number, value: KeyCheck) {
      setChecks((old) => ({ ...old, [keySlot]: value }));
    }

    function updateObservations(keys: readonly AiOllamaCloudKey[]) {
      const observed = new Map(keys.map((key) => [key.slot, key]));
      setRows((old) =>
        old.map((row) => {
          const key = observed.get(row.slot);
          return key
            ? {
                ...row,
                account: key.account,
                blockedUntil: key.blockedUntil,
                unavailableModels: key.unavailableModels,
              }
            : row;
        }),
      );
    }

    async function update(path: string, method: string, payload: object) {
      const reply = await call<unknown>(path, {
        method,
        body: JSON.stringify({ configurationVersion: version, ...payload }),
      });
      if (request !== generation.current) return null;
      if (!reply.ok || !poolShape(reply.data)) {
        if (!reply.ok && [401, 403].includes(reply.status)) onAccessDenied();
        const message = reply.ok
          ? 'Сервер вернул несовместимые настройки.'
          : reply.status === 409
            ? 'Настройки изменились. Обновите вкладку.'
            : reply.error.message || 'Не удалось выполнить операцию.';
        if (slot === undefined) setError(message);
        else result(slot, { tone: 'error', text: message });
        return null;
      }
      setPool(reply.data);
      onModels(reply.data.models);
      return reply.data;
    }

    async function checkDraft(draft: Draft) {
      result(draft.slot, { tone: 'pending', text: 'Проверяем…' });
      const reply = await call<AiOllamaCloudInspection>('/api/admin/v1/ai/ollama-cloud/inspect', {
        method: 'POST',
        body: JSON.stringify({ configurationVersion: version, apiKey: draft.apiKey.trim() }),
      });
      if (request !== generation.current) return false;
      if (!reply.ok) {
        if ([401, 403].includes(reply.status)) onAccessDenied();
        result(draft.slot, { tone: 'error', text: reply.error.message || 'Проверка недоступна' });
        return false;
      }
      const account = reply.data.account;
      const state = status({
        ...draft,
        configured: true,
        enabled: true,
        account,
        blockedUntil: null,
      });
      const text = state === 'Активен' ? 'Ключ работает' : state;
      result(draft.slot, { tone: text === 'Ключ работает' ? 'success' : 'error', text });
      return account?.status === 'ok' || account?.status === 'credits_required';
    }

    try {
      if (action === 'check' && slot !== undefined) {
        const key = rows.find((row) => row.slot === slot);
        if (!key) return null;
        if (key.apiKey.trim()) {
          await checkDraft(key);
          return null;
        }
        result(slot, { tone: 'pending', text: 'Проверяем…' });
        const next = await update(keysPath + '/inspect', 'POST', { slot });
        if (!next) return null;
        const checked = next.keys.find((row) => row.slot === slot);
        if (checked) {
          const text = status(checked);
          result(slot, {
            tone: text === 'Активен' || text === 'Проверен · выключен' ? 'success' : 'error',
            text: text === 'Активен' ? 'Ключ работает' : text,
          });
          updateObservations([checked]);
        }
        return null;
      }
      if (action === 'save') {
        for (const draft of rows.filter((row) => row.apiKey.trim())) {
          if (!(await checkDraft(draft))) {
            if (request === generation.current)
              setError('Проверьте ключ ' + draft.slot + '. Изменения не сохранены.');
            return null;
          }
        }
        const next = await update(keysPath, 'PUT', {
          keys: rows.map((row) => ({
            slot: row.slot,
            label: row.label,
            priority: row.priority,
            enabled: row.enabled || (!row.configured && Boolean(row.apiKey.trim())),
            models: sharedModels ?? (!row.configured && row.apiKey.trim() ? models : row.models),
            ...(row.apiKey.trim() ? { apiKey: row.apiKey.trim() } : {}),
            ...(row.clearApiKey ? { clearApiKey: true } : {}),
          })),
        });
        if (!next) return null;
        setRows(next.keys.map((row) => ({ ...row, apiKey: '', clearApiKey: false })));
        setSharedModels(null);
        setDirty(false);
        return next;
      }
      const next = await update(keysPath + '/inspect', 'POST', {});
      if (next) {
        updateObservations(next.keys);
        setShowCatalog(true);
        setNotice('Каталог обновлён');
      }
      return null;
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  useImperativeHandle(
    saveRef,
    () => (expectedVersion) => execute('save', undefined, expectedVersion),
  );

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
                disabled={disabled || !encryptionReady || key.clearApiKey}
                onChange={(event) => change(key.slot, { apiKey: event.target.value })}
              />
              <div className="asa-cloud-key-verification">
                <button
                  type="button"
                  aria-label={'Проверить ключ ' + key.slot}
                  disabled={
                    disabled ||
                    !encryptionReady ||
                    key.clearApiKey ||
                    (!key.configured && !key.apiKey.trim())
                  }
                  onClick={() => void execute('check', key.slot)}
                >
                  {checks[key.slot]?.tone === 'pending' ? 'Проверяем…' : 'Проверить'}
                </button>
                {checks[key.slot] && checks[key.slot]?.tone !== 'pending' ? (
                  <small role="status" data-tone={checks[key.slot]?.tone}>
                    {checks[key.slot]?.text}
                  </small>
                ) : null}
              </div>
              <label className="asa-cloud-key-toggle" title="Использовать этот ключ">
                <input
                  type="checkbox"
                  aria-label={'Использовать ключ ' + key.slot}
                  checked={key.enabled}
                  disabled={disabled || !key.configured || key.clearApiKey}
                  onChange={(event) => change(key.slot, { enabled: event.target.checked })}
                />
              </label>
              <div className="asa-cloud-key-order">
                <button
                  type="button"
                  aria-label={'Поднять ключ ' + key.slot}
                  disabled={disabled || index === 0}
                  onClick={() => move(key.slot, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={'Опустить ключ ' + key.slot}
                  disabled={disabled || index === 4}
                  onClick={() => move(key.slot, 1)}
                >
                  ↓
                </button>
                {key.configured ? (
                  <button
                    type="button"
                    disabled={disabled}
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
            <button type="button" disabled={disabled} onClick={() => void execute('catalog')}>
              Обновить каталог
            </button>
            {notice ? <small role="status">{notice}</small> : null}
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
              <button type="button" disabled={disabled} onClick={() => chooseModels(models)}>
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
                      disabled={disabled || (!model.active && !models.includes(model.id))}
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
      {error ? (
        <p role="alert" className="asa-cloud-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
