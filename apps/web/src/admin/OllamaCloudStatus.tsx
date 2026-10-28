import { useEffect, useState } from 'react';
import type { AiOllamaCloudInspection, AiOllamaCloudModel } from '@asa-lab/contracts';
import { call } from './admin-api';
const dollars = (v: number | null | undefined) =>
  v == null
    ? 'неизвестно'
    : new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2,
      }).format(v);
function inspection(value: unknown): value is AiOllamaCloudInspection {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AiOllamaCloudInspection>;
  return (
    Array.isArray(row.models) &&
    row.models.length <= 600 &&
    row.models.every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.model === 'string' &&
        typeof m.active === 'boolean',
    ) &&
    !!row.account &&
    [
      'ok',
      'key_required',
      'invalid_key',
      'forbidden',
      'credits_required',
      'rate_limited',
      'unavailable',
    ].includes(row.account.status) &&
    Number.isFinite(Date.parse(row.account.checkedAt)) &&
    (row.account.balance === null ||
      (typeof row.account.balance === 'object' &&
        [
          'includedUsd',
          'purchasedUsd',
          'allowanceUsd',
          'sessionRemainingPercent',
          'weeklyRemainingPercent',
        ].every((k) => {
          const v = (row.account!.balance as unknown as Record<string, unknown>)[k];
          return v === null || (typeof v === 'number' && Number.isFinite(v));
        })))
  );
}

export function OllamaCloudStatus({
  version,
  draftKey,
  disabled,
  onModels,
  onAccessDenied,
}: {
  version: number;
  draftKey: string;
  disabled: boolean;
  onModels: (models: readonly AiOllamaCloudModel[]) => void;
  onAccessDenied: () => void;
}) {
  const [info, setInfo] = useState<AiOllamaCloudInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setInfo(null);
    setError('');
    const key = draftKey.trim();
    if (disabled || (key && key.length < 12)) {
      setLoading(false);
      return;
    }
    let live = true;
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        void call<AiOllamaCloudInspection>('/api/admin/v1/ai/ollama-cloud/inspect', {
          method: 'POST',
          signal: abort.signal,
          body: JSON.stringify({ configurationVersion: version, ...(key ? { apiKey: key } : {}) }),
        })
          .then((reply) => {
            if (!live) return;
            if (!reply.ok) {
              if ([401, 403].includes(reply.status)) onAccessDenied();
              setError(
                reply.status === 409
                  ? 'Настройки изменились. Обновите вкладку.'
                  : 'Не удалось обновить данные Ollama Cloud.',
              );
              return;
            }
            if (!inspection(reply.data)) {
              setError('Сервер вернул несовместимые данные Ollama Cloud.');
              return;
            }
            setInfo(reply.data);
            onModels(reply.data.models);
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      key ? 700 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [version, draftKey, disabled, refresh, onModels, onAccessDenied]);
  const account = info?.account;
  const balance = account?.balance;
  const status = loading
    ? 'Проверяем ключ и каталог…'
    : error ||
      (account?.status === 'ok'
        ? 'Ключ подтверждён'
        : account?.status === 'invalid_key'
          ? 'Ключ не принят Ollama'
          : account?.status === 'credits_required'
            ? 'Требуется пополнение'
            : account?.status === 'forbidden'
              ? 'Доступ аккаунта ограничен'
              : account?.status === 'rate_limited'
                ? 'Слишком частая проверка · повторите позже'
                : account?.status === 'unavailable'
                  ? 'Баланс временно недоступен'
                  : 'Добавьте ключ для проверки баланса');
  return (
    <div className="asa-cloud-metadata">
      <div className="asa-cloud-metadata-line" role="status" aria-live="polite">
        <span>
          {status}
          {account?.status === 'ok' && draftKey.trim() ? ' · ещё не сохранён' : ''}
        </span>
        {balance && (balance.includedUsd !== null || balance.purchasedUsd !== null) ? (
          <strong>
            Осталось:{' '}
            {balance.includedUsd === null || balance.purchasedUsd === null
              ? 'неизвестно'
              : dollars(balance.includedUsd! + balance.purchasedUsd!)}
          </strong>
        ) : null}
        {balance ? (
          <>
            <span>
              Включено в тариф: {dollars(balance.includedUsd)}
              {balance.allowanceUsd !== null ? ' из ' + dollars(balance.allowanceUsd) : ''}
            </span>
            <span>Купленные кредиты: {dollars(balance.purchasedUsd)}</span>
          </>
        ) : null}
        {balance?.sessionRemainingPercent != null ? (
          <span>Остаток лимита сессии: {balance.sessionRemainingPercent}%</span>
        ) : null}
        {balance?.weeklyRemainingPercent != null ? (
          <span>Остаток лимита недели: {balance.weeklyRemainingPercent}%</span>
        ) : null}
        <button
          type="button"
          disabled={loading || disabled}
          onClick={() => setRefresh((v) => v + 1)}
        >
          Обновить
        </button>
      </div>
      {info ? (
        <details className="asa-cloud-metadata-details">
          <summary>
            Каталог: {info.models.filter((m) => m.active).length} моделей · баланс и сведения
          </summary>
          <div>
            {balance ? (
              <>
                {balance.resetsAt ? (
                  <span>
                    Обновление лимита: {new Date(balance.resetsAt).toLocaleString('ru-RU')}
                  </span>
                ) : null}
              </>
            ) : null}
            <span>
              Включённые кредиты могут входить в платную подписку: это не признак бесплатной модели.
              API не сообщает индивидуальную категорию «бесплатная / платная».
            </span>
            <span>
              Проверено: {new Date(info.account.checkedAt).toLocaleString('ru-RU')}. Данные
              кэшируются на минуту.
            </span>
            <span>
              {info.catalogError
                ? 'Каталог не обновился: показаны последние сохранённые модели.'
                : 'Общий каталог Ollama. Наличие модели не подтверждает доступ аккаунта; он проверяется при запросе.'}
            </span>
            <span>
              Обновление каталога и баланса не запускает генерацию. Проверка ответа модели —
              отдельный платный запрос.
            </span>
          </div>
        </details>
      ) : null}
    </div>
  );
}
