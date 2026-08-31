import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adminApi,
  type AdminDashboardRange,
  type AdminIpActivity,
  type AdminProductDashboard,
  type AdminScope,
} from './admin-api';

const RANGE_OPTIONS: readonly { readonly value: AdminDashboardRange; readonly label: string }[] = [
  { value: '1h', label: '1 час' },
  { value: '6h', label: '6 часов' },
  { value: '12h', label: '12 часов' },
  { value: '24h', label: '24 часа' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: '1y', label: '1 год' },
];

const MODULE_LABELS = {
  electronics: 'Электроника',
  'three-d': '3D',
  chess: 'Шахматы',
  checkers: 'Шашки',
} as const;

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});

type DashboardState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly dashboard: AdminProductDashboard };

interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly number[];
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function MultiLineChart({
  title,
  description,
  labels,
  series,
  emptyMessage = 'Новые события за выбранный период пока не зафиксированы.',
}: {
  readonly title: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly emptyMessage?: string;
}): JSX.Element {
  const [visible, setVisible] = useState<ReadonlySet<string>>(
    () => new Set(series.map((item) => item.id)),
  );
  useEffect(() => {
    setVisible((current) => {
      const allowed = new Set(series.map((item) => item.id));
      const next = new Set([...current].filter((id) => allowed.has(id)));
      if (next.size === 0) series.forEach((item) => next.add(item.id));
      return next;
    });
  }, [series]);

  const active = series.filter((item) => visible.has(item.id));
  const maximum = Math.max(1, ...active.flatMap((item) => item.values));
  const width = 760;
  const height = 248;
  const left = 42;
  const right = 16;
  const top = 18;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const path = (values: readonly number[]): string =>
    values
      .map((value, index) => {
        const x = left + (index / Math.max(1, values.length - 1)) * plotWidth;
        const y = top + plotHeight - (value / maximum) * plotHeight;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const empty = active.every((item) => item.values.every((value) => value === 0));
  const labelIndexes = [
    ...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1]),
  ].filter((index) => index >= 0);

  return (
    <article className="admin-chart-card">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="admin-chart-legend" aria-label={`Линии графика «${title}»`}>
          {series.map((item) => {
            const selected = visible.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className={selected ? 'active' : ''}
                aria-pressed={selected}
                onClick={() =>
                  setVisible((current) => {
                    const next = new Set(current);
                    if (next.has(item.id) && next.size > 1) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              >
                <span style={{ background: item.color }} aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </div>
      </header>
      <div className="admin-chart-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${description}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = top + plotHeight - ratio * plotHeight;
            return (
              <g key={ratio}>
                <line x1={left} x2={width - right} y1={y} y2={y} className="admin-chart-grid" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="admin-chart-axis">
                  {Math.round(maximum * ratio)}
                </text>
              </g>
            );
          })}
          {active.map((item) => (
            <path
              key={item.id}
              d={path(item.values)}
              fill="none"
              stroke={item.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {labelIndexes.map((index) => {
            const x = left + (index / Math.max(1, labels.length - 1)) * plotWidth;
            return (
              <text
                key={`${index}:${labels[index]}`}
                x={x}
                y={height - 8}
                textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'}
                className="admin-chart-axis"
              >
                {labels[index]}
              </text>
            );
          })}
        </svg>
        {empty ? <p className="admin-chart-empty">{emptyMessage}</p> : null}
      </div>
    </article>
  );
}

function timeLabels(
  points: readonly { readonly at: string }[],
  range: AdminDashboardRange,
): string[] {
  const formatter = new Intl.DateTimeFormat(
    'ru-RU',
    range === '1h' || range === '6h' || range === '12h' || range === '24h'
      ? { hour: '2-digit', minute: '2-digit' }
      : range === '1y'
        ? { month: 'short' }
        : { day: '2-digit', month: 'short' },
  );
  return points.map((point) => formatter.format(new Date(point.at)));
}

export function AdminDashboard({
  scope,
  onAccessDenied,
}: {
  readonly scope: AdminScope;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [range, setRange] = useState<AdminDashboardRange>('24h');
  const [state, setState] = useState<DashboardState>({ kind: 'loading' });
  const requestVersion = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setState({ kind: 'loading' });
    const result = await adminApi.dashboard({ scope, range });
    if (version !== requestVersion.current) return;
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        onAccessDenied();
        return;
      }
      setState({
        kind: 'error',
        message:
          result.status === 0
            ? 'Сервер аналитики недоступен. Проверьте соединение.'
            : 'Не удалось собрать показатели за выбранный период.',
      });
      return;
    }
    setState({ kind: 'ready', dashboard: result.data });
  }, [onAccessDenied, range, scope]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <div className="admin-dashboard-heading">
        <div>
          <h2 id="admin-dashboard-title">Пульс ASA Lab</h2>
          <p>Использование продуктов, аудитория, входы, ученики и ключевые действия.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Обновить
        </button>
      </div>
      <div className="admin-range-picker" aria-label="Период дашборда">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={range === option.value ? 'active' : ''}
            aria-pressed={range === option.value}
            onClick={() => setRange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {state.kind === 'loading' ? (
        <div className="admin-dashboard-skeleton" aria-busy="true">
          <span className="admin-loading-mark" aria-hidden="true" />
          <strong>Собираем реальные показатели</strong>
          <p>Графики строятся сервером в пределах выбранной административной области.</p>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="admin-dashboard-skeleton" role="alert">
          <strong>Дашборд не загрузился</strong>
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? <DashboardContent dashboard={state.dashboard} /> : null}
    </section>
  );
}

function DashboardContent({
  dashboard,
}: {
  readonly dashboard: AdminProductDashboard;
}): JSX.Element {
  const labels = timeLabels(dashboard.timeline, dashboard.range);
  const moduleKeys = Object.keys(MODULE_LABELS) as Array<keyof typeof MODULE_LABELS>;
  const modules = useMemo<ChartSeries[]>(
    () =>
      moduleKeys.map((moduleKey, index) => ({
        id: moduleKey,
        label: MODULE_LABELS[moduleKey],
        color: ['#0877b3', '#8257c7', '#d4841c', '#16835f'][index] as string,
        values: dashboard.timeline.map((point) => {
          const source = dashboard.modules.find(
            (entry) => entry.at === point.at && entry.moduleKey === moduleKey,
          );
          return number(source?.activePeople);
        }),
      })),
    [dashboard.modules, dashboard.timeline],
  );
  const methods = (
    [
      ['password', 'Почта и пароль', '#0877b3'],
      ['organization', 'Организация', '#8257c7'],
      ['max', 'MAX', '#d4841c'],
      ['class_code', 'Код класса', '#16835f'],
    ] as const
  ).map(([method, label, color]) => ({
    id: method,
    label,
    color,
    values: dashboard.timeline.map((point) =>
      number(
        dashboard.loginMethods.find((entry) => entry.at === point.at && entry.method === method)
          ?.successfulLogins,
      ),
    ),
  }));

  return (
    <>
      <div className="admin-dashboard-kpis">
        {[
          ['Новые аккаунты', dashboard.summary.newAccounts],
          ['Активные пользователи', dashboard.summary.activeAccounts],
          ['Успешные входы', dashboard.summary.successfulLogins],
          ['Не вошли', dashboard.summary.failedLogins],
          ['Активные ученики', dashboard.summary.activeStudents],
          ['Новые ученики', dashboard.summary.newStudents],
          ['Разные IP', dashboard.summary.distinctIpAddresses],
          ['Аккаунты с несколькими IP', dashboard.summary.accountsWithMultipleIps],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <MultiLineChart
        title="Использование систем"
        description="Уникальные участники, действительно открывшие рабочую среду. Линии можно скрывать."
        labels={labels}
        series={modules}
      />
      <div className="admin-dashboard-grid">
        <MultiLineChart
          title="Пользователи и входы"
          description="Люди и завершённые сценарии входа на одной временной шкале."
          labels={labels}
          series={[
            {
              id: 'activeAccounts',
              label: 'Активные',
              color: '#0877b3',
              values: dashboard.timeline.map((point) => point.activeAccounts),
            },
            {
              id: 'newAccounts',
              label: 'Новые',
              color: '#16835f',
              values: dashboard.timeline.map((point) => point.newAccounts),
            },
            {
              id: 'successfulLogins',
              label: 'Вошли',
              color: '#8257c7',
              values: dashboard.timeline.map((point) => point.successfulLogins),
            },
            {
              id: 'failedLogins',
              label: 'Не вошли',
              color: '#c54b43',
              values: dashboard.timeline.map((point) => point.failedLogins),
            },
          ]}
        />
        <MultiLineChart
          title="Способы входа"
          description="Только успешно завершённые входы; продление сессии не учитывается."
          labels={labels}
          series={methods}
        />
        <MultiLineChart
          title="Ученики"
          description="Ученики по коду класса учитываются отдельно от полноценных аккаунтов."
          labels={labels}
          series={[
            {
              id: 'activeStudents',
              label: 'Активные',
              color: '#0877b3',
              values: dashboard.timeline.map((point) => point.activeStudents),
            },
            {
              id: 'newStudents',
              label: 'Новые места',
              color: '#d4841c',
              values: dashboard.timeline.map((point) => point.newStudents),
            },
          ]}
        />
        <MultiLineChart
          title="Ключевые действия"
          description="Создание классов, проектов и привязки MAX. Восстановление пароля появится после подключения потока."
          labels={timeLabels(dashboard.actions, dashboard.range)}
          series={[
            {
              id: 'classesCreated',
              label: 'Классы',
              color: '#0877b3',
              values: dashboard.actions.map((point) => point.classesCreated),
            },
            {
              id: 'projectsCreated',
              label: 'Проекты',
              color: '#8257c7',
              values: dashboard.actions.map((point) => point.projectsCreated),
            },
            {
              id: 'maxLinked',
              label: 'Привязки MAX',
              color: '#d4841c',
              values: dashboard.actions.map((point) => point.maxLinked),
            },
          ]}
        />
      </div>
      <aside className={`admin-max-status ${dashboard.max.configured ? 'ready' : 'not-ready'}`}>
        <div>
          <span>Интеграция MAX</span>
          <strong>{dashboard.max.configured ? 'Подключена' : 'Не настроена'}</strong>
          <p>
            Связано аккаунтов: {dashboard.max.linkedAccounts} · ожидают предложения:{' '}
            {dashboard.max.promptDueAccounts}
          </p>
        </div>
        <small>Секрет и подписанные данные MAX никогда не выводятся в админку.</small>
      </aside>
      <p className="admin-dashboard-updated">
        Обновлено {DATE_TIME.format(new Date(dashboard.generatedAt))}. События использования и входа
        собираются
        {dashboard.analyticsStartedAt
          ? ` с ${DATE_TIME.format(new Date(dashboard.analyticsStartedAt))}`
          : ' с момента установки этого обновления'}
        ; более ранняя история для этих линий недоступна.
      </p>
    </>
  );
}

export function MaxIntegrationSection({
  scope,
  onAccessDenied,
}: {
  readonly scope: AdminScope;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [state, setState] = useState<DashboardState>({ kind: 'loading' });
  useEffect(() => {
    let active = true;
    void adminApi.dashboard({ scope, range: '30d' }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onAccessDenied();
        else setState({ kind: 'error', message: 'Не удалось проверить MAX.' });
        return;
      }
      setState({ kind: 'ready', dashboard: result.data });
    });
    return () => {
      active = false;
    };
  }, [onAccessDenied, scope]);
  return (
    <section className="admin-integrations" aria-labelledby="admin-integrations-title">
      <div className="admin-section-heading">
        <div>
          <h2 id="admin-integrations-title">Интеграции</h2>
          <p>Рабочее состояние внешних способов входа без доступа к их секретам.</p>
        </div>
      </div>
      {state.kind === 'loading' ? <p>Проверяем MAX…</p> : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
      {state.kind === 'ready' ? (
        <div className="admin-integration-card">
          <div>
            <span>MAX</span>
            <strong>{state.dashboard.max.configured ? 'Подключён' : 'Не настроен'}</strong>
            <p>
              Связано аккаунтов: {state.dashboard.max.linkedAccounts}. Предложение подтверждения
              ожидают: {state.dashboard.max.promptDueAccounts}.
            </p>
          </div>
          <dl>
            <div>
              <dt>Вход</dt>
              <dd>{state.dashboard.max.configured ? 'Доступен' : 'Отключён'}</dd>
            </div>
            <div>
              <dt>Секрет</dt>
              <dd>Скрыт сервером</dd>
            </div>
            <div>
              <dt>Ссылка запуска</dt>
              <dd>{state.dashboard.max.launchUrl ? 'Сформирована' : 'Недоступна'}</dd>
            </div>
          </dl>
          {!state.dashboard.max.configured ? (
            <p className="admin-inline-warning">
              Для включения нужен новый серверный секрет и feature flag. Ранее раскрытый токен
              использовать нельзя.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function IpActivitySection({
  scope,
  onAccessDenied,
}: {
  readonly scope: AdminScope;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [range, setRange] = useState<AdminDashboardRange>('24h');
  const [items, setItems] = useState<readonly AdminIpActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    void adminApi.ipActivity({ scope, range, minimumDistinct: 2 }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onAccessDenied();
        else setError('Не удалось получить IP-активность.');
        return;
      }
      setItems(result.data.items);
    });
    return () => {
      active = false;
    };
  }, [onAccessDenied, range, scope]);

  return (
    <section className="admin-ip-activity" aria-labelledby="admin-ip-title">
      <div className="admin-section-heading">
        <div>
          <h2 id="admin-ip-title">Входы с разных IP</h2>
          <p>
            Аккаунты, которые успешно входили минимум с двух сетевых адресов. Телефон и компьютер
            могут иметь один IP, а один телефон — несколько, поэтому это сигнал, а не доказательство
            передачи аккаунта.
          </p>
        </div>
        <select
          value={range}
          onChange={(event) => setRange(event.target.value as AdminDashboardRange)}
        >
          {RANGE_OPTIONS.filter((option) => !['1h', '6h', '12h'].includes(option.value)).map(
            (option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
        </select>
      </div>
      {items === null && !error ? <p>Проверяем успешные входы…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {items?.length === 0 ? (
        <p className="admin-privacy-note">Аккаунтов с несколькими IP за этот период не найдено.</p>
      ) : null}
      {items && items.length > 0 ? (
        <div className="admin-ip-grid">
          {items.map((item) => (
            <article key={item.accountId}>
              <div>
                <strong>{item.displayName}</strong>
                <span>{item.email}</span>
              </div>
              <b>{item.distinctIpCount} IP</b>
              <code>{item.addresses.join(' · ')}</code>
              <small>Последний вход: {DATE_TIME.format(new Date(item.lastSeenAt))}</small>
            </article>
          ))}
        </div>
      ) : null}
      <p className="admin-privacy-note">
        IP фиксируется только сервером из проверенной цепочки прокси. Доступ к адресам ограничен
        правом просмотра безопасности; токены и пароли здесь не хранятся.
      </p>
    </section>
  );
}
