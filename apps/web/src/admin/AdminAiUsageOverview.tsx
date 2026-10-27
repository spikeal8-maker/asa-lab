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
      <p className="asa-ai-usage-card-note">
        {tokens.unknownOperations > 0
          ? tokens.known === null
            ? 'Провайдеры не передали расход'
            : `Учтено операций: ${usageInteger.format(tokens.knownOperations)}`
          : 'За выбранные семь дней'}
      </p>
      {tokens.unknownOperations > 0 ? (
        <p className="asa-ai-usage-unknown-count">
          Без данных: {usageInteger.format(tokens.unknownOperations)}
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
        <p>Последние семь дней · UTC</p>
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
      <p id="ai-usage-chart-description" className="asa-ai-usage-chart-note">
        {data.state === 'empty'
          ? 'За каждый из семи дней — 0 запросов.'
          : `Всего: ${usageInteger.format(data.requests)}. Точные значения доступны в таблице ниже.`}{' '}
        Сегодняшний день ещё идёт.
      </p>
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
        <div>
          <h2 id="ai-usage-title">Обзор использования ИИ</h2>
          <p>Запросы и токены за последние семь дней</p>
        </div>
        {state.kind !== 'error' ? (
          <button
            className="asa-ai-usage-refresh"
            type="button"
            disabled={state.kind === 'loading'}
            onClick={() => setRevision((current) => current + 1)}
          >
            Обновить данные
          </button>
        ) : null}
      </header>
      {state.kind === 'loading' ? (
        <div className="asa-ai-usage-message" role="status">
          <p>Загружаем данные…</p>
          <p>Читаем журнал использования. Часовой пояс: UTC.</p>
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
          <div className="asa-ai-usage-period">
            <p>
              {usageDate.format(new Date(data.period.from))} —{' '}
              {usageDate.format(new Date(data.period.to))}
            </p>
            <p>Часовой пояс: UTC · Обновлено {usageTime.format(new Date(data.generatedAt))} UTC</p>
          </div>
          <div className="asa-ai-usage-cards">
            <article
              className="asa-ai-usage-card"
              aria-label="Запросы"
              data-testid="ai-usage-requests"
            >
              <h3>Запросы</h3>
              <p className="asa-ai-usage-value">
                <bdi>{usageInteger.format(data.requests)}</bdi>
              </p>
              <p className="asa-ai-usage-card-note">Новые допущенные операции</p>
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
              <p>
                Показаны только переданные провайдерами токены. Неизвестный расход не включён в
                сумму.
              </p>
            </div>
          ) : data.state === 'empty' ? (
            <div className="asa-ai-usage-notice" role="status">
              <strong>Данных за период нет</strong>
              <p>
                Журнал прочитан успешно. Новые операции за этот период пока не зарегистрированы.
              </p>
            </div>
          ) : null}
          <DailyRequests data={data} />
          <p className="asa-ai-usage-definition">
            Один запрос — одна новая допущенная операция, включая новый вариант ответа. Повторное
            чтение сохранённого результата не увеличивает показатели. Время операции учитывается при
            её допуске; сегодняшний день — до момента обновления.
          </p>
        </>
      ) : null}
    </section>
  );
}
