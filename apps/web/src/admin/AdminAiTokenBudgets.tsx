import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiTokenBudgetAdmin, AiTokenBudgetLimit } from '@asa-lab/contracts';
import { call } from './admin-api';
import './ai-token-budgets.css';

export function budgetLimit(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^(0|[1-9][0-9]{0,15})$/.test(trimmed) || BigInt(trimmed) > 9007199254740991n)
    throw new Error('Лимит должен быть целым неотрицательным числом до 9007199254740991.');
  return trimmed;
}
export function budgetAdminShape(raw: unknown): raw is AiTokenBudgetAdmin {
  const value = raw as AiTokenBudgetAdmin | null;
  const count = (v: unknown) => typeof v === 'string' && /^\d{1,64}$/.test(v);
  return (
    !!value &&
    Number.isSafeInteger(value.configurationVersion) &&
    value.configurationVersion >= 0 &&
    typeof value.resetAt === 'string' &&
    Number.isFinite(new Date(value.resetAt).getTime()) &&
    Array.isArray(value.models) &&
    value.models.length <= 4801 &&
    value.models.every(
      (m) =>
        m &&
        typeof m.model === 'string' &&
        m.model.length <= 200 &&
        (m.globalLimit === null || count(m.globalLimit)) &&
        (m.userLimit === null || count(m.userLimit)) &&
        count(m.used) &&
        count(m.held) &&
        typeof m.unresolved === 'boolean' &&
        typeof m.pendingUnknown === 'boolean',
    )
  );
}
export function AdminAiTokenBudgets({
  onAccessDenied,
  eligibleModels,
  onDirtyChange,
}: {
  readonly onAccessDenied: () => void;
  readonly eligibleModels?: readonly string[];
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState<AiTokenBudgetAdmin | null>(null);
  const [draft, setDraft] = useState<readonly AiTokenBudgetLimit[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const dirty =
    !!config &&
    draft.some((row) => {
      const saved = config.models.find((model) => model.model === row.model);
      return row.globalLimit !== saved?.globalLimit || row.userLimit !== saved?.userLimit;
    });
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const denied = useRef(onAccessDenied);
  useEffect(() => {
    denied.current = onAccessDenied;
  }, [onAccessDenied]);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  function accept(value: AiTokenBudgetAdmin) {
    setConfig(value);
    setDraft(
      value.models.map(({ model, globalLimit, userLimit }) => ({ model, globalLimit, userLimit })),
    );
    pending.current = null;
  }
  useEffect(() => {
    let active = true;
    void call<AiTokenBudgetAdmin>('/api/admin/v1/ai/token-budgets')
      .then((reply) => {
        if (!active) return;
        if (reply.ok && budgetAdminShape(reply.data)) accept(reply.data);
        else if (reply.ok) setNotice('Данные бюджетов несовместимы с этой версией.');
        else if (reply.status === 403) denied.current();
        else setNotice('Не удалось загрузить лимиты токенов. Обновите страницу.');
      })
      .catch(() => {
        if (active) setNotice('Нет соединения с сервером.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config || busy) return;
    try {
      const models = draft.map((m) => ({
        ...m,
        globalLimit: budgetLimit(m.globalLimit ?? ''),
        userLimit: budgetLimit(m.userLimit ?? ''),
      }));
      const payload = { configurationVersion: config.configurationVersion, models };
      const signature = JSON.stringify(payload);
      if (pending.current?.signature !== signature)
        pending.current = { signature, requestId: crypto.randomUUID() };
      setBusy(true);
      setNotice('');
      const reply = await call<AiTokenBudgetAdmin>('/api/admin/v1/ai/token-budgets', {
        method: 'PUT',
        body: JSON.stringify({ ...payload, requestId: pending.current.requestId }),
      });
      if (reply.ok && budgetAdminShape(reply.data)) {
        accept(reply.data);
        setNotice('Лимиты токенов сохранены. Начатые ответы продолжаются полностью.');
      } else if (reply.ok) setNotice('Сохранение не подтверждено: несовместимый ответ API.');
      else if (reply.status === 403) onAccessDenied();
      else setNotice(reply.error.message || 'Лимиты не сохранены. Ваш черновик остаётся в форме.');
    } catch (problem) {
      setNotice(
        problem instanceof Error
          ? problem.message
          : 'Сохранение не подтверждено. Повтор сохранения использует тот же запрос.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="asa-ai-budgets" aria-label="Месячные лимиты токенов">
      <h2>Лимиты токенов в месяц</h2>
      <p>Пусто — без лимита. 0 — новые запросы запрещены.</p>
      {config ? (
        <form onSubmit={(event) => void save(event)}>
          <div
            className="asa-ai-budget-scroll"
            role="region"
            aria-label="Лимиты по моделям"
            tabIndex={0}
          >
            <table className="asa-ai-budget-table">
              <caption>
                Следующий период:{' '}
                {new Date(config.resetAt).toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC
              </caption>
              <thead>
                <tr>
                  <th scope="col">Модель</th>
                  <th scope="col">Общий лимит</th>
                  <th scope="col">На пользователя</th>
                  <th scope="col">Использовано</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((m) => {
                  if (eligibleModels && m.model !== '*' && !eligibleModels.includes(m.model))
                    return null;
                  const usage = config.models.find((row) => row.model === m.model)!;
                  const remaining =
                    usage.globalLimit === null
                      ? null
                      : String(
                          BigInt(usage.globalLimit) > BigInt(usage.used) + BigInt(usage.held)
                            ? BigInt(usage.globalLimit) - BigInt(usage.used) - BigInt(usage.held)
                            : 0,
                        );
                  return (
                    <tr key={m.model}>
                      <th scope="row" title={m.model}>
                        {m.model === 'ollama-local'
                          ? 'Локальная Ollama'
                          : m.model.replace(/^ollama-cloud\//, '')}
                      </th>
                      <td>
                        <input
                          aria-label={'Общий лимит ' + m.model}
                          inputMode="numeric"
                          disabled={busy}
                          value={m.globalLimit ?? ''}
                          placeholder="Без лимита"
                          onChange={(event) =>
                            setDraft((old) =>
                              old.map((row) =>
                                row.model === m.model
                                  ? { ...row, globalLimit: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={'Лимит на пользователя ' + m.model}
                          inputMode="numeric"
                          disabled={busy}
                          value={m.userLimit ?? ''}
                          placeholder="Без лимита"
                          onChange={(event) =>
                            setDraft((old) =>
                              old.map((row) =>
                                row.model === m.model
                                  ? { ...row, userLimit: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <span aria-label={'Подтверждено токенов всего: ' + usage.used}>
                          {usage.used}
                        </span>
                        <details className="asa-ai-budget-info">
                          <summary aria-label={'Подробнее о расходе ' + m.model}>
                            {usage.pendingUnknown || usage.unresolved ? 'На проверке' : 'Подробнее'}
                          </summary>
                          <div>
                            <p>
                              Резерв: {usage.held} ·{' '}
                              {remaining === null ? 'Без общего лимита' : 'Остаток: ' + remaining}
                            </p>
                            {usage.unresolved ? (
                              <p role="status">
                                Есть неподтверждённый исторический расход: новые запросы с лимитом
                                приостановлены.
                              </p>
                            ) : null}
                            {usage.pendingUnknown ? (
                              <p role="status">
                                Не весь расход подтверждён: резерв сохранён без срока истечения.
                              </p>
                            ) : null}
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить лимиты токенов'}
          </button>
        </form>
      ) : (
        <p>Загружаем бюджеты…</p>
      )}
      <details className="asa-ai-budget-help">
        <summary>Как работают лимиты</summary>
        <p>
          Уже начатый ответ завершается полностью. Резерв защищает от одновременных новых запросов;
          неизвестный расход остаётся на проверке.
        </p>
        <p>
          ollama-local — единый слот активной локальной модели: смена модели не обнуляет расход.
        </p>
        <p>
          Эта кнопка сохраняет только бюджеты. Выбор моделей сохраняется отдельно. Проверки
          подключения используют отдельный почасовой лимит операций.
        </p>
      </details>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
