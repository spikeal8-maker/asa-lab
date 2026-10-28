import { useEffect, useRef, useState } from 'react';
import type { AiOllamaCloudKey, AiOllamaCloudPool, AiOllamaCloudModel } from '@asa-lab/contracts';
import { call } from './admin-api';

type Draft = AiOllamaCloudKey & { apiKey: string; clearApiKey: boolean };
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
        typeof m.active === 'boolean',
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
  if (!k.enabled) return 'Выключен';
  if (k.account?.status === 'invalid_key') return 'Ключ не принят';
  if (k.account?.status === 'forbidden') return 'Доступ ограничен';
  if (
    k.account?.status === 'credits_required' ||
    (k.account?.balance?.includedUsd === 0 && k.account.balance.purchasedUsd === 0)
  )
    return 'Кредиты закончились';
  if (k.account?.status === 'rate_limited') return 'Временный лимит';
  if (k.blockedUntil && Date.parse(k.blockedUntil) > Date.now()) return 'Лимит исчерпан · ожидание';
  if (k.account?.status === 'unavailable') return 'Баланс недоступен';
  return k.account?.status === 'ok' ? 'Ключ подтверждён' : 'Не проверен';
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
    void call<unknown>('/api/admin/v1/ai/ollama-cloud/keys')
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
  async function execute(refresh: boolean) {
    if (!pool || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const request = generation.current;
    try {
      const payload = refresh
        ? { configurationVersion: pool.configurationVersion }
        : {
            configurationVersion: pool.configurationVersion,
            keys: rows.map((k) => ({
              slot: k.slot,
              label: k.label,
              priority: k.priority,
              enabled: k.enabled,
              models: k.models,
              ...(k.apiKey.trim() ? { apiKey: k.apiKey.trim() } : {}),
              ...(k.clearApiKey ? { clearApiKey: true } : {}),
            })),
          };
      const reply = await call<unknown>(
        '/api/admin/v1/ai/ollama-cloud/keys' + (refresh ? '/inspect' : ''),
        {
          method: refresh ? 'POST' : 'PUT',
          body: JSON.stringify(payload),
        },
      );
      if (request !== generation.current) return;
      if (!reply.ok) {
        if ([401, 403].includes(reply.status)) onAccessDenied();
        setError(
          reply.status === 409
            ? 'Настройки изменились. Обновите вкладку; ваши правки не сохранены.'
            : reply.error.message || 'Не удалось обновить ключи.',
        );
        return;
      }
      if (!poolShape(reply.data)) {
        setError('Несовместимые данные ключей. Обновите страницу.');
        return;
      }
      setPool(reply.data);
      setRows(reply.data.keys.map((k) => ({ ...k, apiKey: '', clearApiKey: false })));
      setDirty(false);
      onModels(reply.data.models);
      setNotice(
        refresh ? 'Остатки обновлены · генерация не запускалась' : 'Ключи и порядок сохранены',
      );
      if (!refresh) onSaved();
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="asa-cloud-key-pool" aria-label="Пять ключей Ollama Cloud">
      <div className="asa-cloud-pool-heading">
        <strong>Ключи и порядок</strong>
        <button type="button" disabled={busy || dirty || !pool} onClick={() => void execute(true)}>
          Обновить остатки
        </button>
      </div>
      <p className="asa-cloud-pool-note">
        Первым используется доступный ключ с наивысшим приоритетом для выбранной модели.
        Пользователь видит общий список без дублей.
      </p>
      {[...rows]
        .sort((a, b) => a.priority - b.priority)
        .map((k, index) => (
          <div className="asa-cloud-key-row" key={k.slot}>
            <span className="asa-cloud-key-rank" aria-label={'Приоритет ' + k.priority}>
              {k.priority}
            </span>
            <details className="asa-cloud-key-card">
              <summary>
                <span>
                  <strong>{k.label}</strong>
                  <small>
                    {status(k)} · моделей: {k.models.length}
                  </small>
                </span>
                <span className="asa-cloud-key-balance">
                  {k.account?.balance ? (
                    <>
                      <span>В тарифе: {money(k.account.balance.includedUsd)}</span>
                      <span>Куплено: {money(k.account.balance.purchasedUsd)}</span>
                      {k.account.balance.sessionRemainingPercent != null ? (
                        <span>Сессия: {k.account.balance.sessionRemainingPercent}%</span>
                      ) : null}
                      {k.account.balance.weeklyRemainingPercent != null ? (
                        <span>Неделя: {k.account.balance.weeklyRemainingPercent}%</span>
                      ) : null}
                    </>
                  ) : (
                    <span>
                      Остаток: {k.account ? 'недоступен' : k.configured ? 'не проверен' : '—'}
                    </span>
                  )}
                </span>
              </summary>
              <div className="asa-cloud-key-editor">
                <label>
                  Название
                  <input
                    aria-label={'Название ключа ' + k.slot}
                    value={k.label}
                    maxLength={64}
                    onChange={(e) => change(k.slot, { label: e.target.value })}
                    disabled={busy}
                  />
                </label>
                <label>
                  API-ключ
                  <input
                    type="password"
                    aria-label={'API-ключ ' + k.slot}
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={2048}
                    value={k.apiKey}
                    placeholder={k.configured ? 'Сохранён · введите для замены' : 'Вставьте ключ'}
                    disabled={busy || !encryptionReady || k.clearApiKey}
                    onChange={(e) => change(k.slot, { apiKey: e.target.value })}
                  />
                </label>
                <label className="asa-cloud-key-check">
                  <input
                    type="checkbox"
                    checked={k.enabled}
                    disabled={busy || k.clearApiKey}
                    onChange={(e) => change(k.slot, { enabled: e.target.checked })}
                  />
                  Использовать ключ
                </label>
                {k.configured ? (
                  <label className="asa-cloud-key-check">
                    <input
                      type="checkbox"
                      checked={k.clearApiKey}
                      disabled={busy}
                      onChange={(e) =>
                        change(k.slot, {
                          clearApiKey: e.target.checked,
                          apiKey: '',
                          ...(e.target.checked ? { enabled: false } : {}),
                        })
                      }
                    />
                    Удалить ключ при сохранении
                  </label>
                ) : null}
                <fieldset>
                  <legend>Модели для пользователей</legend>
                  <div className="asa-cloud-key-models">
                    {pool?.models
                      .filter((m) => m.active)
                      .map((m) => (
                        <label key={m.id}>
                          <input
                            type="checkbox"
                            checked={k.models.includes(m.id)}
                            disabled={busy}
                            onChange={(e) =>
                              change(k.slot, {
                                models: e.target.checked
                                  ? [...k.models, m.id]
                                  : k.models.filter((v) => v !== m.id),
                              })
                            }
                          />
                          <span>
                            {m.model}
                            {k.unavailableModels.includes(m.id) ? ' · временно недоступна' : ''}
                          </span>
                        </label>
                      ))}
                  </div>
                </fieldset>
                {k.account ? (
                  <small>
                    Проверено: {new Date(k.account.checkedAt).toLocaleString('ru-RU')}
                    {k.account.balance?.resetsAt
                      ? ' · обновление лимита: ' +
                        new Date(k.account.balance.resetsAt).toLocaleString('ru-RU')
                      : ''}
                  </small>
                ) : null}
              </div>
            </details>
            <div className="asa-cloud-key-order">
              <button
                type="button"
                aria-label={'Поднять ключ ' + k.slot}
                disabled={busy || index === 0}
                onClick={() => move(k.slot, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={'Опустить ключ ' + k.slot}
                disabled={busy || index === 4}
                onClick={() => move(k.slot, 1)}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      <div className="asa-cloud-pool-actions">
        <button
          type="button"
          disabled={busy || !dirty || !encryptionReady}
          onClick={() => void execute(false)}
        >
          {busy ? 'Подождите…' : 'Сохранить ключи и порядок'}
        </button>
        <span role="status">{notice}</span>
      </div>
      {error ? (
        <p role="alert" className="asa-cloud-error">
          {error}
        </p>
      ) : null}
      <details className="asa-cloud-pool-help">
        <summary>Как работает доступ</summary>
        <p>
          Список моделей Ollama общий: API не подтверждает тарифный доступ каждой модели. После
          явного отказа доступ для ключа временно исключается. Если ни один ключ не подходит, модель
          исчезает из пользовательского выбора. Обновление остатков не запускает генерацию;
          результаты могут кэшироваться минуту.
        </p>
        <p>
          Включённые в подписку кредиты не означают бесплатную модель. Разные ключи одного аккаунта
          могут расходовать один баланс. После начала ответа, сетевого сбоя или ошибки сервера
          запрос автоматически не повторяется.
        </p>
      </details>
    </div>
  );
}
