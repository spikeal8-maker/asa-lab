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
    <section className="asa-cloud-connection asa-ai-budgets" aria-label="Месячные бюджеты токенов">
      <h2>Месячные бюджеты токенов</h2>
      <p>
        Для каждой модели: общий бюджет и одинаковый бюджет каждого пользователя. Личный кабинет и
        школьное место учитываются отдельно. Пустое поле — без лимита, 0 — запрет новых ответов.
      </p>
      <p>
        «ollama-local» — единый слот активной локальной модели. Смена её конфигурации не обнуляет
        расход этого слота за месяц.
      </p>
      <p>
        Уже начатый ответ завершается полностью, поэтому расход может превысить лимит. Резерв
        защищает от одновременных новых запросов и не ограничивает длину ответа. Неизвестный расход
        остаётся на проверке.
      </p>
      <p>
        Проверки подключения провайдера не входят в эти бюджеты; для них действует отдельный
        почасовой лимит платных операций. Денежная стоимость и число операций считаются отдельно.
      </p>
      {config ? (
        <form onSubmit={(event) => void save(event)}>
          <p>
            Новый период: {new Date(config.resetAt).toLocaleString('ru-RU', { timeZone: 'UTC' })}{' '}
            UTC.
          </p>
          <div className="asa-ai-budget-rows">
            {draft.map((m, index) => {
              if (eligibleModels && m.model !== '*' && !eligibleModels.includes(m.model))
                return null;
              const usage = config.models.find((row) => row.model === m.model)!;
              return (
                <fieldset key={m.model} disabled={busy}>
                  <legend>{m.model}</legend>
                  <label>
                    Общий лимит в месяц
                    <input
                      inputMode="numeric"
                      value={m.globalLimit ?? ''}
                      placeholder="Без лимита"
                      onChange={(event) =>
                        setDraft((old) =>
                          old.map((row, i) =>
                            i === index ? { ...row, globalLimit: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Лимит каждого пользователя в месяц
                    <input
                      inputMode="numeric"
                      value={m.userLimit ?? ''}
                      placeholder="Без лимита"
                      onChange={(event) =>
                        setDraft((old) =>
                          old.map((row, i) =>
                            i === index ? { ...row, userLimit: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <p>
                    Подтверждено токенов всего: {usage.used} · Резерв: {usage.held}
                    {usage.globalLimit !== null
                      ? ' · Остаток: ' +
                        String(
                          BigInt(usage.globalLimit) > BigInt(usage.used) + BigInt(usage.held)
                            ? BigInt(usage.globalLimit) - BigInt(usage.used) - BigInt(usage.held)
                            : 0,
                        )
                      : ' · Без общего лимита'}
                    {usage.unresolved
                      ? ' · Есть неподтверждённый исторический расход: новые запросы с лимитом приостановлены'
                      : ''}
                    {usage.pendingUnknown
                      ? ' · Не весь расход подтверждён: резерв сохранён без срока истечения'
                      : ''}
                  </p>
                </fieldset>
              );
            })}
          </div>
          <button type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить лимиты токенов'}
          </button>
          <p>
            Эта кнопка сохраняет только бюджеты. Выбор моделей и промпт сохраняются своей кнопкой.
            Для загрузки изменённых другим администратором лимитов обновите страницу; сначала
            сохраните черновик отдельно.
          </p>
        </form>
      ) : (
        <p>Загружаем бюджеты…</p>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
