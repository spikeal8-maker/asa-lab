import { useEffect, useRef, useState } from 'react';
import type {
  AiOwnQualityGrant,
  AiOwnQualityGrantUpdate,
  AiOwnQualityOperation,
  AiOwnQualityPage,
} from '@asa-lab/contracts';
import { call } from './admin-api';
import { AiMessageContent } from '../ai/AiMessageContent';
import './ai-own-quality.css';
const ROOT = '/api/admin/v1/ai/own-quality';
const STATES = {
  admitted: 'Ожидает',
  running: 'Выполняется',
  succeeded: 'Завершён',
  stopped: 'Остановлен',
  cancelled: 'Отменён',
  failed: 'Ошибка',
} as const;
const ANSWERS = {
  complete: 'Полный ответ',
  partial: 'Частичный ответ',
  stopped: 'Ответ остановлен',
  error: 'Ответ не получен',
  pending: 'Ответ ожидается',
  unavailable: 'Содержимое недоступно',
} as const;
export function ownQualityGrant(value: unknown): value is AiOwnQualityGrant {
  if (!value || typeof value !== 'object') return false;
  const x = value as AiOwnQualityGrant;
  return (
    x.schemaVersion === 1 &&
    x.scope === 'own_personal' &&
    typeof x.enabled === 'boolean' &&
    Number.isSafeInteger(x.revision) &&
    x.revision >= 0 &&
    x.maskingPolicy === 'quality-mask-v1'
  );
}
export function ownQualityOperation(value: unknown): value is AiOwnQualityOperation {
  if (!value || typeof value !== 'object') return false;
  const x = value as AiOwnQualityOperation;
  const nullableText = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 200);
  const token = (v: unknown) => v === null || (typeof v === 'string' && /^\d{1,30}$/.test(v));
  return (
    typeof x.requestId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(x.requestId) &&
    typeof x.admittedAt === 'string' &&
    Number.isFinite(Date.parse(x.admittedAt)) &&
    x.timeZone === 'UTC' &&
    Object.hasOwn(STATES, x.status) &&
    Object.hasOwn(ANSWERS, x.answerState) &&
    (x.question === null || (typeof x.question === 'string' && x.question.length <= 256 * 1024)) &&
    (x.answer === null || (typeof x.answer === 'string' && x.answer.length <= 256 * 1024)) &&
    typeof x.masked === 'boolean' &&
    typeof x.truncated === 'boolean' &&
    [
      x.operation,
      x.provider,
      x.requestedModel,
      x.actualModel,
      x.policyVersion,
      x.promptVersion,
    ].every(nullableText) &&
    token(x.inputTokens) &&
    token(x.outputTokens) &&
    [x.searchUsed, x.toolUsed].every((v) => v === null || typeof v === 'boolean')
  );
}
function pageShape(value: unknown): value is AiOwnQualityPage {
  if (!value || typeof value !== 'object') return false;
  const x = value as AiOwnQualityPage;
  return (
    x.schemaVersion === 1 &&
    x.scope === 'own_personal' &&
    x.limit === 10 &&
    x.maskingPolicy === 'quality-mask-v1' &&
    Array.isArray(x.items) &&
    x.items.length <= 10 &&
    x.items.every(ownQualityOperation) &&
    new Set(x.items.map((i) => i.requestId)).size === x.items.length
  );
}
const date = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});
function fact(value: boolean | null) {
  return value === true ? 'Да' : value === false ? 'Нет' : 'Не зафиксирован';
}

export function AdminAiOwnQuality() {
  const [grant, setGrant] = useState<AiOwnQualityGrant | null>(null),
    [page, setPage] = useState<AiOwnQualityPage | null>(null),
    [detail, setDetail] = useState<AiOwnQualityOperation | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const generation = useRef(0),
    detailAbort = useRef<AbortController | null>(null),
    pending = useRef<AiOwnQualityGrantUpdate | null>(null);
  const clear = () => {
    generation.current++;
    detailAbort.current?.abort();
    setPage(null);
    setDetail(null);
    setExpanded(null);
  };
  useEffect(() => {
    let live = true;
    const abort = new AbortController();
    const version = ++generation.current;
    detailAbort.current?.abort();
    setPage(null);
    setDetail(null);
    setExpanded(null);
    setLoading(true);
    setError('');
    const timeout = window.setTimeout(() => {
      abort.abort();
      if (live) {
        setLoading(false);
        setError('Журнал не ответил. Повторите чтение.');
      }
    }, 15000);
    void (async () => {
      const status = await call<unknown>(ROOT + '/grant', {
        cache: 'no-store',
        signal: abort.signal,
      });
      if (!live || version !== generation.current || abort.signal.aborted) return;
      if (!status.ok || !ownQualityGrant(status.data)) {
        setGrant(null);
        setError(
          !status.ok && status.status === 404
            ? 'Для журнала требуется обновление API.'
            : 'Не удалось проверить отдельное разрешение.',
        );
        return;
      }
      setGrant(status.data);
      if (!status.data.enabled) return;
      const response = await call<unknown>(ROOT, { cache: 'no-store', signal: abort.signal });
      if (!live || version !== generation.current || abort.signal.aborted) return;
      if (response.ok && pageShape(response.data)) setPage(response.data);
      else {
        setPage(null);
        setError(
          !response.ok && response.status === 403
            ? 'Разрешение отозвано. Обновите состояние.'
            : 'Не удалось прочитать журнал.',
        );
        if (!response.ok && response.status === 403) setGrant({ ...status.data, enabled: false });
      }
    })()
      .catch(() => {
        if (live && !abort.signal.aborted && version === generation.current)
          setError('Не удалось прочитать журнал.');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (live && version === generation.current) setLoading(false);
      });
    return () => {
      live = false;
      generation.current++;
      abort.abort();
      detailAbort.current?.abort();
      window.clearTimeout(timeout);
    };
  }, [revision]);
  async function save(enabled: boolean) {
    if (!grant || busy) return;
    clear();
    setBusy(true);
    setError('');
    const command =
      pending.current?.enabled === enabled
        ? pending.current
        : { enabled, expectedRevision: grant.revision, requestId: crypto.randomUUID() };
    pending.current = command;
    const version = generation.current;
    try {
      const response = await call<unknown>(ROOT + '/grant', {
        method: 'PUT',
        body: JSON.stringify(command),
      });
      if (version !== generation.current) return;
      if (response.ok && ownQualityGrant(response.data)) {
        pending.current = null;
        setGrant(response.data);
        setRevision((r) => r + 1);
      } else
        setError(
          !response.ok && response.status === 409
            ? 'Разрешение изменилось. Обновите состояние перед новым сохранением.'
            : 'Сохранение не подтверждено. Повторите то же действие или обновите состояние.',
        );
    } catch {
      if (version === generation.current)
        setError('Сохранение не подтверждено. Повторите то же действие или обновите состояние.');
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  async function open(row: AiOwnQualityOperation) {
    detailAbort.current?.abort();
    setDetail(null);
    setError('');
    if (expanded === row.requestId) {
      setExpanded(null);
      return;
    }
    setExpanded(row.requestId);
    const version = generation.current,
      abort = new AbortController();
    detailAbort.current = abort;
    const timeout = window.setTimeout(() => {
      abort.abort();
      if (version === generation.current) {
        setExpanded(null);
        setError('Операция не ответила. Повторите раскрытие.');
      }
    }, 15000);
    try {
      const response = await call<unknown>(ROOT + '/' + row.requestId, {
        cache: 'no-store',
        signal: abort.signal,
      });
      if (version !== generation.current || abort.signal.aborted) return;
      if (
        response.ok &&
        ownQualityOperation(response.data) &&
        response.data.requestId === row.requestId
      )
        setDetail(response.data);
      else if (!response.ok && response.status === 403) {
        clear();
        setGrant((g) => (g ? { ...g, enabled: false } : null));
        setError('Разрешение отозвано.');
      } else {
        setExpanded(null);
        setError(
          'Не удалось раскрыть операцию. Возможно, её содержимое удалено или список изменился.',
        );
      }
    } catch {
      if (version === generation.current && !abort.signal.aborted) {
        setExpanded(null);
        setError('Не удалось раскрыть операцию.');
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return (
    <section
      className="asa-ai-own-quality"
      aria-label="Последние 10 запросов"
      data-testid="ai-own-quality"
    >
      <header>
        <div>
          <h3>Последние 10 запросов</h3>
          <p>Только мои личные диалоги · независимо от периода графика</p>
        </div>
        <button
          type="button"
          aria-label="Обновить журнал качества"
          disabled={busy || loading}
          onClick={() => {
            pending.current = null;
            clear();
            setRevision((r) => r + 1);
          }}
        >
          ↻
        </button>
        {grant?.enabled ? (
          <button type="button" disabled={busy} onClick={() => void save(false)}>
            Отозвать разрешение
          </button>
        ) : null}
      </header>
      {loading ? <p role="status">Проверяем разрешение…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && grant && !grant.enabled ? (
        <div className="asa-ai-own-opt-in">
          <p>
            Отдельное разрешение открывает только ваши личные вопросы и ответы. Чужие и школьные
            диалоги недоступны.
          </p>
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            Разрешить просмотр моих диалогов
          </button>
        </div>
      ) : null}
      {!loading && grant?.enabled && page?.items.length === 0 ? (
        <p>Доступных операций нет.</p>
      ) : null}
      {page ? (
        <>
          <ol className="asa-ai-own-rows">
            {page.items.map((row) => (
              <li key={row.requestId}>
                <button
                  type="button"
                  className="asa-ai-own-row"
                  aria-expanded={expanded === row.requestId}
                  onClick={() => void open(row)}
                >
                  <span className="asa-ai-own-meta">
                    <time dateTime={row.admittedAt}>
                      {date.format(new Date(row.admittedAt))} UTC
                    </time>
                    <span>
                      {row.provider ?? 'Провайдер не зафиксирован'} ·{' '}
                      {row.actualModel ?? 'Фактическая модель неизвестна'}
                    </span>
                    <span>
                      {STATES[row.status]} · {ANSWERS[row.answerState]}
                    </span>
                  </span>
                  <span className="asa-ai-own-preview">
                    <span>
                      <b>Запрос: </b>
                      {row.question ?? 'Содержимое недоступно'}
                    </span>
                    <span>
                      <b>Ответ: </b>
                      {row.answer ?? ANSWERS[row.answerState]}
                    </span>
                  </span>
                </button>
                {expanded === row.requestId ? (
                  <div className="asa-ai-own-detail">
                    {detail?.requestId === row.requestId ? (
                      <>
                        <dl>
                          <div>
                            <dt>Запрошена</dt>
                            <dd>{detail.requestedModel ?? 'Не зафиксирована'}</dd>
                          </div>
                          <div>
                            <dt>Фактическая модель</dt>
                            <dd>{detail.actualModel ?? 'Неизвестна'}</dd>
                          </div>
                          <div>
                            <dt>Вход / выход</dt>
                            <dd>
                              {detail.inputTokens ?? 'Неизвестно'} /{' '}
                              {detail.outputTokens ?? 'Неизвестно'} токенов
                            </dd>
                          </div>
                          <div>
                            <dt>Политика</dt>
                            <dd>{detail.policyVersion ?? 'Не зафиксирована'}</dd>
                          </div>
                          <div>
                            <dt>Версия промпта</dt>
                            <dd>{detail.promptVersion ?? 'Не зафиксирована'}</dd>
                          </div>
                          <div>
                            <dt>Поиск / инструмент</dt>
                            <dd>
                              {fact(detail.searchUsed)} / {fact(detail.toolUsed)}
                            </dd>
                          </div>
                        </dl>
                        {detail.masked ? <p>Распознаваемые ключи и контакты скрыты.</p> : null}
                        {detail.truncated ? (
                          <p role="status">Показана ограниченная часть содержимого.</p>
                        ) : null}
                        <h4>Исходный вопрос</h4>
                        <pre>{detail.question ?? 'Содержимое недоступно'}</pre>
                        <h4>Сохранённый ответ</h4>
                        {detail.answer === null ? (
                          <p>{ANSWERS[detail.answerState]}</p>
                        ) : (
                          <AiMessageContent content={detail.answer} />
                        )}
                      </>
                    ) : (
                      <p role="status">Читаем сохранённую пару…</p>
                    )}
                    {detail?.requestId === row.requestId && detail.answer !== null ? (
                      <details>
                        <summary>Исходный текст ответа</summary>
                        <pre>{detail.answer}</pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <details className="asa-ai-own-policy">
            <summary>Границы просмотра и маскирования</summary>
            <p>
              Показаны {page.items.length} из последних разрешённых операций собственного Account.
              Replay не создаёт строку. Школьные и чужие диалоги исключены. Политика quality-mask-v1
              скрывает распознаваемые API-ключи, Bearer/пароли, email и телефоноподобные номера; она
              не гарантирует распознавание любого секрета. Просмотр аудитируется без текстов.
              Удалённый оригинал не восстанавливается.
            </p>
          </details>
        </>
      ) : null}
    </section>
  );
}
