import { useEffect, useState } from 'react';
import type { AiUsageOverview } from '@asa-lab/contracts';
import { call } from './admin-api';
import {
  formatUsageTokens,
  isAiUsageOverview,
  usageDate,
  usageInteger,
  usageTime,
} from './ai-usage-overview-model';
import './ai-usage-overview.css';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly data: AiUsageOverview };

const compactCount = new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const chartDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const periodDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
const refreshedTime = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

function TokenCard({
  label,
  tokens,
  testId,
}: {
  readonly label: string;
  readonly tokens: AiUsageOverview['inputTokens'];
  readonly testId: string;
}) {
  return (
    <article className="asa-ai-usage-card" aria-label={label} data-testid={testId}>
      <h3>{label}</h3>
      <p className={'asa-ai-usage-value' + (tokens.known === null ? ' is-unknown' : '')}>
        <bdi>{formatUsageTokens(tokens.known)}</bdi>
      </p>
      {tokens.unknownOperations > 0 ? (
        <p className="asa-ai-usage-card-note">
          {tokens.known !== null ? (
            <span>Учтено операций: {usageInteger.format(tokens.knownOperations)} · </span>
          ) : null}
          <span>Без данных: {usageInteger.format(tokens.unknownOperations)}</span>
        </p>
      ) : null}
    </article>
  );
}

function DailyRequests({ data }: { readonly data: AiUsageOverview }) {
  const maximum = Math.max(1, ...data.daily.map((day) => day.requests));
  return (
    <section className="asa-ai-usage-chart-card" aria-labelledby="ai-usage-chart-title">
      <header className="asa-ai-usage-chart-heading">
        <h3 id="ai-usage-chart-title">Запросы по дням</h3>
      </header>
      <div
        className="asa-ai-usage-chart"
        role="img"
        aria-label="Количество запросов по дням за семь дней"
        aria-describedby="ai-usage-chart-description"
      >
        {data.daily.map((day) => {
          const at = new Date(`${day.date}T00:00:00Z`);
          return (
            <div className="asa-ai-usage-day" key={day.date} aria-hidden="true">
              <div className="asa-ai-usage-track">
                <div
                  className="asa-ai-usage-bar"
                  data-empty={day.requests === 0}
                  style={{ height: `${(day.requests / maximum) * 100}%` }}
                >
                  <span
                    className="asa-ai-usage-bar-value"
                    title={usageInteger.format(day.requests)}
                  >
                    {compactCount.format(day.requests)}
                  </span>
                </div>
              </div>
              <time dateTime={day.date}>
                <span>{chartDate.format(at)}</span>
                <span>{weekday.format(at)}</span>
              </time>
            </div>
          );
        })}
      </div>
      <p id="ai-usage-chart-description" className="sr-only">
        {data.state === 'empty'
          ? 'За каждый из семи дней — 0 запросов.'
          : `Всего: ${usageInteger.format(data.requests)}. Точные значения доступны в таблице ниже.`}{' '}
        Сегодняшний день ещё идёт.
      </p>
      <div className="asa-ai-usage-details">
        <details className="asa-ai-usage-table-details">
          <summary>Данные по дням</summary>
          <table aria-label="Запросы по дням">
            <thead>
              <tr>
                <th scope="col">Дата · UTC</th>
                <th scope="col">Запросы</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    <time dateTime={day.date}>
                      {usageDate.format(new Date(`${day.date}T00:00:00Z`))}
                    </time>
                  </th>
                  <td>{usageInteger.format(day.requests)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Всего</th>
                <td>{usageInteger.format(data.requests)}</td>
              </tr>
            </tfoot>
          </table>
        </details>
        <details className="asa-ai-usage-method">
          <summary>Как считаем</summary>
          <p>
            Один запрос — одна новая допущенная операция, включая новый вариант ответа. Повторное
            чтение сохранённого результата не увеличивает показатели.
          </p>
          <p>
            Учитываем шесть предыдущих дней и текущий день в UTC: с{' '}
            {usageDate.format(new Date(data.period.from))}, 00:00 до{' '}
            {usageDate.format(new Date(data.period.to))},{' '}
            {usageTime.format(new Date(data.period.to))}. Сегодняшний день ещё идёт. Время операции
            фиксируется при её допуске, конец периода не включён.
          </p>
          <p>
            Токены — сумма известных значений из журнала. Неизвестный расход не включён в сумму и не
            считается нулём. Дни без операций показаны нулевыми точками.
          </p>
        </details>
      </div>
    </section>
  );
}

export function AdminAiUsageOverview({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const timeout = window.setTimeout(() => {
      if (active) setState({ kind: 'error' });
      controller.abort();
    }, 15_000);
    void call<unknown>('/api/admin/v1/ai/usage-overview', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!active || controller.signal.aborted) return;
        window.clearTimeout(timeout);
        if (!response.ok) {
          setState({ kind: 'error' });
          if (response.status === 401 || response.status === 403) onAccessDenied();
        } else {
          setState(
            isAiUsageOverview(response.data)
              ? { kind: 'ready', data: response.data }
              : { kind: 'error' },
          );
        }
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        window.clearTimeout(timeout);
        setState({ kind: 'error' });
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [onAccessDenied, revision]);

  const data = state.kind === 'ready' ? state.data : null;
  return (
    <section
      className="asa-ai-usage-overview"
      aria-labelledby="ai-usage-title"
      aria-busy={state.kind === 'loading'}
    >
      <header className="asa-ai-usage-heading">
        <h2 id="ai-usage-title">Обзор</h2>
        {data ? (
          <p className="asa-ai-usage-period">
            <span>
              {periodDate.formatRange(new Date(data.period.from), new Date(data.period.to))}
            </span>{' '}
            · <span aria-label="Часовой пояс: UTC">UTC</span> ·{' '}
            <time
              dateTime={data.generatedAt}
              title={`Обновлено ${usageTime.format(new Date(data.generatedAt))} UTC`}
            >
              Обновлено {refreshedTime.format(new Date(data.generatedAt))}
            </time>
          </p>
        ) : null}
        {state.kind !== 'error' ? (
          <button
            className="asa-ai-usage-refresh asa-ai-usage-refresh-icon"
            type="button"
            aria-label="Обновить данные"
            title="Обновить данные"
            disabled={state.kind === 'loading'}
            onClick={() => setRevision((current) => current + 1)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 7v5h-5M4 17v-5h5" />
              <path d="M5.6 7a7.5 7.5 0 0 1 12.4-1L20 8M4 16l2 2a7.5 7.5 0 0 0 12.4-1" />
            </svg>
          </button>
        ) : null}
      </header>
      {state.kind === 'loading' ? (
        <div className="asa-ai-usage-message" role="status">
          <p>Загружаем данные…</p>
        </div>
      ) : state.kind === 'error' ? (
        <div className="asa-ai-usage-message" role="alert">
          <h3>Не удалось загрузить данные</h3>
          <p>Журнал использования сейчас недоступен. Повторите чтение.</p>
          <button
            className="asa-ai-usage-refresh"
            type="button"
            onClick={() => setRevision((current) => current + 1)}
          >
            Повторить загрузку
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          <div className="asa-ai-usage-cards">
            <article
              className="asa-ai-usage-card"
              aria-label="Запросы"
              data-testid="ai-usage-requests"
            >
              <h3>Запросы</h3>
              <p className="asa-ai-usage-value">
                <bdi>{formatUsageTokens(String(data.requests))}</bdi>
              </p>
            </article>
            <TokenCard label="Входные токены" tokens={data.inputTokens} testId="ai-usage-input" />
            <TokenCard
              label="Выходные токены"
              tokens={data.outputTokens}
              testId="ai-usage-output"
            />
          </div>
          {data.state === 'partial' ? (
            <div className="asa-ai-usage-notice" role="status">
              <strong>Расход известен не полностью</strong>
              <p>Показаны только известные токены.</p>
            </div>
          ) : data.state === 'empty' ? (
            <div className="asa-ai-usage-notice" role="status">
              <strong>Данных за период нет</strong>
            </div>
          ) : null}
          <DailyRequests data={data} />
        </>
      ) : null}
    </section>
  );
}
