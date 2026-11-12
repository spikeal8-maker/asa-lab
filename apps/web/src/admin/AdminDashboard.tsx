import { AdminEmailSettings } from './AdminEmailSettings';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  adminApi,
  type AdminDashboardRange,
  type AdminErrorTrend,
  type AdminIpActivity,
  type AdminProductDashboard,
  type AdminScope,
} from './admin-api';

import { AdminAuthProviderCard } from './AdminAuthProviderCard';
import { VerificationPolicyControl } from './VerificationPolicyControl';

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
  robotics: 'Робототехника',
  'three-d': '3D',
  chess: 'Шахматы',
  checkers: 'Шашки',
  blocks: 'Scratch',
} as const;
const MODULE_COLORS = {
  electronics: '#0877b3',
  robotics: '#16776f',
  'three-d': '#8257c7',
  blocks: '#c54b83',
  chess: '#d4841c',
  checkers: '#16835f',
} as const;
const LEARNING_MODULES = ['electronics', 'robotics', 'three-d', 'blocks'] as const;
const GAME_MODULES = ['chess', 'checkers'] as const;

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});
const MOSCOW_TIME = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
const MOSCOW_DAY = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
});
const MOSCOW_DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
});
const VALUE = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function moscowInterval(from: string, to: string): string {
  return `${MOSCOW_DATE_TIME.format(new Date(from))} — ${MOSCOW_DATE_TIME.format(new Date(to))} МСК`;
}

type DashboardState =
  | { readonly kind: 'loading'; readonly key: string }
  | { readonly kind: 'error'; readonly key: string; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly key: string;
      readonly dashboard: AdminProductDashboard;
      readonly refreshing: boolean;
      readonly refreshError: string | null;
    };

export function chartLabelIndexes(length: number, limit = 12): number[] {
  const count = Math.min(Math.max(0, length), limit);
  return Array.from({ length: count }, (_, index) =>
    Math.round((index * (length - 1)) / Math.max(1, count - 1)),
  );
}

export function chartCountAxis(value: number): { maximum: number; ticks: number[] } {
  const rawStep = Math.max(1, value / 4);
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 5, 10].find((candidate) => candidate * power >= rawStep) ?? 10) * power;
  const maximum = Math.max(step, Math.ceil(value / step) * step);
  return { maximum, ticks: Array.from({ length: maximum / step + 1 }, (_, index) => index * step) };
}

interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  readonly secondary?: boolean;
  readonly bars?: boolean;
  readonly group?: { readonly id: string; readonly label: string };
}

function MultiLineChart({
  title,
  description,
  labels,
  series,
  pointLabels = labels,
  controls,
  className = '',
  primaryUnit,
  secondaryUnit,
  emptyMessage = 'Новые события за выбранный период пока не зафиксированы.',
}: {
  readonly title: string;
  readonly description: string;
  readonly labels: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly pointLabels?: readonly string[];
  readonly controls?: ReactNode;
  readonly className?: string;
  readonly primaryUnit?: string;
  readonly secondaryUnit?: string;
  readonly emptyMessage?: string | undefined;
}): JSX.Element {
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const [visible, setVisible] = useState<ReadonlySet<string>>(
    () => new Set(series.map((item) => item.group?.id ?? item.id)),
  );
  useEffect(() => {
    setVisible((current) => {
      const allowed = new Set(series.map((item) => item.group?.id ?? item.id));
      const next = new Set([...current].filter((id) => allowed.has(id)));
      if (next.size === 0) allowed.forEach((id) => next.add(id));
      return next;
    });
  }, [series]);
  useEffect(() => {
    if (!canvas.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(120, Math.floor(entry.contentRect.width)));
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);

  const active = series.filter((item) => visible.has(item.group?.id ?? item.id));
  const legend = new Map(series.map((item) => [item.group?.id ?? item.id, item]));
  const maxFor = (secondary: boolean) =>
    Math.max(
      0,
      ...active
        .filter((item) => Boolean(item.secondary) === secondary)
        .flatMap((item) => item.values.map((value) => value ?? 0)),
    );
  const axis = chartCountAxis(maxFor(false));
  const rightAxis = active.some((item) => item.secondary) ? chartCountAxis(maxFor(true)) : null;
  const height = 191;
  const left = 48;
  const right = rightAxis ? 48 : 32;
  const top = primaryUnit || secondaryUnit ? 25 : 12;
  const bottom = 27;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const barWidth = Math.max(2, Math.min(20, (plotWidth / labels.length) * 0.65));
  const xAt = (index: number) => left + (index / Math.max(1, labels.length - 1)) * plotWidth;
  const yAt = (value: number, maximum: number) => top + plotHeight - (value / maximum) * plotHeight;
  const path = (item: ChartSeries): string =>
    item.values
      .map((value, index) =>
        value === null
          ? ''
          : `${index === 0 || item.values[index - 1] === null ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(value, item.secondary && rightAxis ? rightAxis.maximum : axis.maximum).toFixed(1)}`,
      )
      .join(' ');
  const empty = active.every((item) => item.values.every((value) => value === null || value === 0));
  const labelIndexes = chartLabelIndexes(
    labels.length,
    Math.min(12, Math.floor(plotWidth / 56) + 1),
  );
  const cursor = selectedPoint !== null && selectedPoint < labels.length ? selectedPoint : null;

  return (
    <article className={`admin-chart-card ${className}`.trim()}>
      <header>
        <div className="admin-chart-heading">
          <h3>{title}</h3>
          <div className="admin-chart-help" data-open={helpOpen}>
            <button
              type="button"
              aria-label={`Как считается «${title}»`}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen(!helpOpen)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setHelpOpen(false);
              }}
            >
              ?
            </button>
            <p id={helpId}>{description}</p>
          </div>
        </div>
        {controls ? <div className="admin-chart-controls">{controls}</div> : null}
        {legend.size > 1 ? (
          <div className="admin-chart-legend" aria-label={`Ряды графика «${title}»`}>
            {[...legend].map(([id, item]) => {
              const selected = visible.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={selected ? 'active' : ''}
                  aria-pressed={selected}
                  onClick={() =>
                    setVisible((current) => {
                      const next = new Set(current);
                      if (next.has(id) && next.size > 1) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                >
                  <span
                    className={!item.group && item.secondary ? 'dashed' : ''}
                    style={{ color: item.color }}
                    aria-hidden="true"
                  />
                  {item.group?.label ?? item.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </header>
      <div
        className="admin-chart-canvas"
        ref={canvas}
        tabIndex={0}
        aria-label={`Значения графика «${title}». Стрелки переключают интервалы.`}
        onPointerMove={(event) => {
          const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
          setSelectedPoint(
            Math.max(
              0,
              Math.min(
                labels.length - 1,
                Math.round(((x - left) / plotWidth) * (labels.length - 1)),
              ),
            ),
          );
        }}
        onPointerLeave={() => setSelectedPoint(null)}
        onBlur={() => setSelectedPoint(null)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next =
            (cursor ?? (event.key === 'ArrowLeft' ? labels.length : -1)) +
            (event.key === 'ArrowLeft' ? -1 : 1);
          setSelectedPoint(Math.max(0, Math.min(labels.length - 1, next)));
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${description}`}>
          {primaryUnit ? (
            <text x={left} y={12} className="admin-chart-axis">
              {primaryUnit}
            </text>
          ) : null}
          {rightAxis && secondaryUnit ? (
            <text x={width - right} y={12} textAnchor="end" className="admin-chart-axis">
              {secondaryUnit}
            </text>
          ) : null}
          {axis.ticks.map((value) => {
            const y = yAt(value, axis.maximum);
            return (
              <g key={value}>
                <line x1={left} x2={width - right} y1={y} y2={y} className="admin-chart-grid" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="admin-chart-axis">
                  {value}
                </text>
              </g>
            );
          })}
          {rightAxis?.ticks.map((value) => (
            <text
              key={value}
              x={width - right + 7}
              y={yAt(value, rightAxis.maximum) + 4}
              className="admin-chart-axis"
            >
              {value}
            </text>
          ))}
          {labelIndexes.map((index) => (
            <line
              key={`time-grid-${index}`}
              x1={xAt(index)}
              x2={xAt(index)}
              y1={top}
              y2={top + plotHeight}
              className="admin-chart-grid"
            />
          ))}
          {active
            .filter((item) => item.bars)
            .flatMap((item) =>
              item.values.map((value, index) => {
                if (value === null || value <= 0) return null;
                const y = yAt(value, axis.maximum);
                return (
                  <rect
                    key={`${item.id}:${index}`}
                    x={xAt(index) - barWidth / 2}
                    y={y}
                    width={barWidth}
                    height={top + plotHeight - y}
                    rx="2"
                    fill={item.color}
                  />
                );
              }),
            )}
          {active
            .filter((item) => !item.bars)
            .map((item) => (
              <path
                key={item.id}
                d={path(item)}
                fill="none"
                stroke={item.color}
                strokeWidth={item.secondary ? '2' : '2.5'}
                strokeDasharray={item.secondary ? '5 4' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          {active
            .filter((item) => !item.bars)
            .flatMap((item) =>
              item.values.map((value, index) =>
                value !== null &&
                (index === 0 || item.values[index - 1] === null) &&
                (index === item.values.length - 1 || item.values[index + 1] === null) ? (
                  <circle
                    key={`${item.id}:${index}`}
                    cx={xAt(index)}
                    cy={yAt(value, item.secondary && rightAxis ? rightAxis.maximum : axis.maximum)}
                    r="3"
                    fill={item.color}
                  />
                ) : null,
              ),
            )}
          {cursor !== null ? (
            <line
              x1={xAt(cursor)}
              x2={xAt(cursor)}
              y1={top}
              y2={top + plotHeight}
              className="admin-chart-cursor"
            />
          ) : null}
          {labelIndexes.map((index) => {
            const x = xAt(index);
            return (
              <text
                key={`${index}:${labels[index]}`}
                x={x}
                y={height - 8}
                textAnchor="middle"
                className="admin-chart-axis admin-chart-time-label"
              >
                {labels[index]}
              </text>
            );
          })}
        </svg>
        {cursor !== null ? (
          <div className="admin-chart-readout" aria-live="polite">
            <strong>{pointLabels[cursor]}</strong>
            {active.map((item) => {
              const value = item.values[cursor];
              return (
                <span key={item.id}>
                  {item.label} {value == null ? '—' : VALUE.format(value)}
                </span>
              );
            })}
          </div>
        ) : empty ? (
          <p className="admin-chart-empty">{emptyMessage}</p>
        ) : null}
      </div>
    </article>
  );
}

function timeLabels(
  points: readonly { readonly at: string }[],
  range: AdminDashboardRange,
): string[] {
  const formatter =
    range === '1h' || range === '6h' || range === '12h' || range === '24h'
      ? MOSCOW_TIME
      : new Intl.DateTimeFormat('ru-RU', {
          day: '2-digit',
          month: 'short',
          timeZone: 'Europe/Moscow',
        });
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
  const scopeKind = scope.kind;
  const scopeId = scope.id;
  const key = `${scopeKind}:${scopeId ?? ''}:${range}`;
  const [storedState, setState] = useState<DashboardState>({ kind: 'loading', key });
  const state: DashboardState = storedState.key === key ? storedState : { kind: 'loading', key };
  const requestVersion = useRef(0);
  const contextKey = useRef(key);
  contextKey.current = key;
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;

  const load = useCallback(
    async (refresh = false): Promise<void> => {
      const version = ++requestVersion.current;
      setState((current) =>
        refresh && current.kind === 'ready' && current.key === key
          ? { ...current, refreshing: true, refreshError: null }
          : { kind: 'loading', key },
      );
      const result = await adminApi.dashboard({ scope: { kind: scopeKind, id: scopeId }, range });
      if (version !== requestVersion.current || contextKey.current !== key) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          setState({ kind: 'loading', key });
          denied.current();
          return;
        }
        const message =
          result.status === 0
            ? 'Сервер аналитики недоступен. Проверьте соединение.'
            : 'Не удалось собрать показатели за выбранный период.';
        setState((current) =>
          refresh && current.kind === 'ready' && current.key === key
            ? { ...current, refreshing: false, refreshError: message }
            : { kind: 'error', key, message },
        );
        return;
      }
      if (result.data.range !== range) {
        setState({ kind: 'error', key, message: 'Сервер вернул другой период. Повторите запрос.' });
        return;
      }
      setState({
        kind: 'ready',
        key,
        dashboard: result.data,
        refreshing: false,
        refreshError: null,
      });
    },
    [range, scopeKind, scopeId, key],
  );

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return (
    <section className="admin-dashboard" aria-labelledby="admin-dashboard-title">
      <h2 id="admin-dashboard-title" className="sr-only">
        Обзор
      </h2>
      <div className="admin-dashboard-toolbar">
        <label className="admin-range-picker">
          <span>Период</span>
          <select
            aria-label="Период дашборда"
            value={range}
            onChange={(event) => setRange(event.target.value as AdminDashboardRange)}
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {state.kind === 'ready' ? (
          <p className="admin-range-interval">
            {moscowInterval(state.dashboard.from, state.dashboard.to)}
          </p>
        ) : null}
        <button
          type="button"
          className="admin-dashboard-refresh"
          disabled={state.kind === 'ready' && state.refreshing}
          onClick={() => void load(true)}
        >
          {state.kind === 'ready' && state.refreshing ? 'Обновляем…' : 'Обновить'}
        </button>
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
      {state.kind === 'ready' ? (
        <>
          {state.refreshing ? (
            <p role="status">
              Обновляем показатели. Пока показаны предыдущие данные за выбранный период.
            </p>
          ) : null}
          {state.refreshError ? (
            <p role="alert">{state.refreshError} Показаны предыдущие данные за выбранный период.</p>
          ) : null}
          <div aria-busy={state.refreshing} className="admin-dashboard-content">
            <TodayAttendance dashboard={state.dashboard} />
            <DashboardContent
              dashboard={state.dashboard}
              canReadErrors={
                scopeKind === 'platform' &&
                scope.permissions.includes('administration.operations.read')
              }
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

function TodayAttendance({
  dashboard,
}: {
  readonly dashboard: AdminProductDashboard;
}): JSX.Element {
  const today = dashboard.todayMsk;
  return (
    <section className="admin-dashboard-today" aria-labelledby="admin-dashboard-today-title">
      <div className="admin-today-heading">
        <h3 id="admin-dashboard-today-title">Посещаемость сегодня</h3>
        {today ? (
          <p>
            <time dateTime={today.from}>{MOSCOW_DAY.format(new Date(today.from))}</time>
            {' · '}00:00 — {MOSCOW_TIME.format(new Date(today.to))} МСК
          </p>
        ) : null}
      </div>
      {today ? (
        <div className="admin-dashboard-kpis">
          {[
            ['Активные аккаунты', today.activeAccounts],
            ['Активные ученики', today.activeStudents],
            ['Входы по коду класса', today.studentLogins],
            ['Созданные ученические места', today.newStudents],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      ) : (
        <p>Сводка за сегодня недоступна.</p>
      )}
    </section>
  );
}

function DashboardContent({
  dashboard,
  canReadErrors,
}: {
  readonly dashboard: AdminProductDashboard;
  readonly canReadErrors: boolean;
}): JSX.Element {
  const [audienceMetric, setAudienceMetric] = useState<'active' | 'logins' | 'time'>('active');
  const overview = dashboard.overview;
  const points =
    overview?.points ??
    dashboard.timeline.map((point) => ({
      ...point,
      from: point.at,
      to: new Date(
        Math.min(Date.parse(dashboard.to), Date.parse(point.at) + dashboard.bucketSeconds * 1000),
      ).toISOString(),
      accountLogins: point.successfulLogins,
      studentLogins: point.studentLogins ?? null,
      accountSeconds: null,
      studentSeconds: null,
    }));
  const labels = timeLabels(points, dashboard.range);
  const pointLabels = points.map((point) => moscowInterval(point.from, point.to));
  const axes = { labels, pointLabels };
  const durations = audienceMetric === 'time';
  const counts = audienceMetric === 'active';
  const minutes = (seconds: number | null) => (seconds === null ? null : seconds / 60);
  const people: ChartSeries[] = [
    {
      id: 'accounts',
      label: 'Аккаунты',
      color: '#0877b3',
      values: points.map((point) =>
        counts
          ? point.activeAccounts
          : durations
            ? minutes(point.accountSeconds)
            : point.accountLogins,
      ),
    },
    {
      id: 'students',
      label: 'Ученики',
      color: '#16835f',
      values: points.map((point) =>
        counts
          ? point.activeStudents
          : durations
            ? minutes(point.studentSeconds)
            : point.studentLogins,
      ),
    },
  ];
  const methodCounts = new Map(
    (overview?.loginMethods ?? dashboard.loginMethods).map((point) => [
      `${point.at}:${point.method}`,
      point.successfulLogins,
    ]),
  );
  const methods: ChartSeries[] = (
    [
      ['password', 'Почта и пароль', '#0877b3'],
      ['organization', 'Организация', '#8257c7'],
      ['max', 'MAX', '#b96910'],
      ['telegram', 'Telegram', '#126e9a'],
      ['class_code', 'Код класса', '#16835f'],
    ] as const
  ).map(([method, label, color]) => ({
    id: method,
    label,
    color,
    values: points.map((point) => methodCounts.get(`${point.at}:${method}`) ?? 0),
  }));
  const moduleData = new Map(
    (overview?.modules ?? dashboard.modules).map((point) => [
      `${point.at}:${point.moduleKey}`,
      point,
    ]),
  );
  const network = overview?.network;
  const actions = new Map(
    (overview?.actions ?? dashboard.actions).map((point) => [point.at, point]),
  );

  return (
    <div className="admin-dashboard-grid">
      <MultiLineChart
        className="admin-chart-wide"
        title="Активные пользователи"
        description="В каждом интервале аккаунт или ученическое место учитывается один раз по успешному событию или подтверждённой работе в модуле. Входы можно посмотреть отдельно. Время — среднее среди пользователей с замерами в редакторах и играх, без простоя и двойного учёта параллельных вкладок."
        {...axes}
        primaryUnit={counts ? 'Пользователи' : durations ? 'Мин / пользователь' : 'Входы'}
        series={people}
        emptyMessage={durations ? 'В этом периоде нет замеров активного времени.' : undefined}
        controls={
          <>
            {overview ? (
              <span
                className="admin-chart-recent"
                title="Уникальные аккаунты и ученики с активностью за последние пять минут к моменту обновления."
              >
                За 5 мин: <strong>{overview.recentAccounts + overview.recentStudents}</strong>
              </span>
            ) : null}
            <select
              aria-label="Показатель пользователей"
              value={audienceMetric}
              onChange={(event) => setAudienceMetric(event.target.value as typeof audienceMetric)}
            >
              <option value="active">Активность</option>
              <option value="logins">Успешные входы</option>
              <option value="time" disabled={!overview}>
                Активное время
              </option>
            </select>
          </>
        }
      />
      {canReadErrors ? <ErrorsChart dashboard={dashboard} points={points} {...axes} /> : null}
      <ModuleChart
        title="Учебные инструменты"
        keys={LEARNING_MODULES}
        points={points}
        moduleData={moduleData}
        {...axes}
      />
      <ModuleChart
        title="Игры"
        keys={GAME_MODULES}
        points={points}
        moduleData={moduleData}
        {...axes}
      />
      <MultiLineChart
        title="Способы входа"
        description="Успешные входы по способам. Вход по коду относится к ученикам. Регистрация и продление сессии не входят в этот график."
        {...axes}
        primaryUnit="Входы"
        series={methods}
      />
      <MultiLineChart
        title="Созданные ученические места"
        description="Места, добавленные в классы и оставшиеся в их списках. Создание места может произойти до того, как ученик зайдёт."
        {...axes}
        primaryUnit="Места"
        controls={
          <span className="admin-chart-recent">
            За период: <strong>{dashboard.summary.newStudents}</strong>
          </span>
        }
        series={[
          {
            id: 'newStudents',
            label: 'Созданные места',
            color: '#b96910',
            bars: true,
            values: points.map((point) => point.newStudents),
          },
        ]}
      />
      <section
        className="admin-dashboard-network admin-chart-wide"
        aria-labelledby="admin-dashboard-network-title"
      >
        <h3 id="admin-dashboard-network-title">IP-адреса пользователей</h3>
        <div className="admin-dashboard-kpis">
          {(
            [
              [
                'Разные IP',
                network
                  ? network.resolvedEvents > 0
                    ? network.addresses
                    : null
                  : dashboard.summary.distinctIpAddresses,
              ],
              [
                'С нескольких IP',
                network
                  ? network.resolvedEvents > 0
                    ? network.peopleWithMultipleAddresses
                    : null
                  : dashboard.summary.accountsWithMultipleIps,
              ],
              [
                'События без IP',
                network?.unresolvedEvents ?? dashboard.summary.unclassifiedNetworkEvents,
              ],
            ] as const
          ).map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value ?? '—'}</strong>
            </article>
          ))}
        </div>
        {network?.unresolvedEvents ? (
          <p>
            {network.resolvedEvents === 0
              ? 'За выбранный период исходные адреса пользователей не получены.'
              : 'Для части событий исходный адрес отсутствует. Счётчики учитывают адреса, подтверждённые сервером.'}
          </p>
        ) : null}
      </section>
      <details className="admin-dashboard-details admin-chart-wide">
        <summary>Сводка и действия за период</summary>
        <div className="admin-dashboard-kpis">
          {(
            [
              ['Новые аккаунты', dashboard.summary.newAccounts],
              ['Начатые сессии', dashboard.summary.authenticatedSessions],
              ['Входы в аккаунты', points.reduce((sum, point) => sum + point.accountLogins, 0)],
              ['Отклонённые попытки', dashboard.summary.rejectedAuthAttempts],
              ['Незавершённые входы', dashboard.summary.failedLogins],
              ['Локальная сеть', dashboard.summary.localNetworkAccounts],
            ] as const
          ).map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        <MultiLineChart
          title="Ключевые действия"
          description="Создание классов и проектов, а также привязка внешних способов входа."
          {...axes}
          primaryUnit="Действия"
          series={[
            {
              id: 'classes',
              label: 'Классы',
              color: '#0877b3',
              values: points.map((point) => actions.get(point.at)?.classesCreated ?? 0),
            },
            {
              id: 'projects',
              label: 'Проекты',
              color: '#8257c7',
              values: points.map((point) => actions.get(point.at)?.projectsCreated ?? 0),
            },
            {
              id: 'linked',
              label: 'Привязки входа',
              color: '#b96910',
              values: points.map((point) => actions.get(point.at)?.maxLinked ?? 0),
            },
          ]}
        />
      </details>
    </div>
  );
}

function ModuleChart({
  title,
  keys,
  points,
  moduleData,
  labels,
  pointLabels,
}: {
  readonly title: string;
  readonly keys: readonly (keyof typeof MODULE_LABELS)[];
  readonly points: readonly { readonly at: string }[];
  readonly moduleData: ReadonlyMap<
    string,
    { readonly launches: number; readonly activeSeconds: number }
  >;
  readonly labels: readonly string[];
  readonly pointLabels: readonly string[];
}): JSX.Element {
  const [metric, setMetric] = useState<'launches' | 'time' | 'both'>('launches');
  const series = keys.flatMap((key): ChartSeries[] => {
    const values = points.map((point) => moduleData.get(`${point.at}:${key}`));
    const base = {
      label: MODULE_LABELS[key],
      color: MODULE_COLORS[key],
      group: { id: key, label: MODULE_LABELS[key] },
    };
    const launches: ChartSeries = {
      ...base,
      id: `${key}-launches`,
      label: metric === 'both' ? `${base.label} · запуски` : base.label,
      values: values.map((point) => point?.launches ?? 0),
    };
    const time: ChartSeries = {
      ...base,
      id: `${key}-time`,
      label: metric === 'both' ? `${base.label} · мин` : base.label,
      secondary: metric === 'both',
      values: values.map((point) => (point?.activeSeconds ?? 0) / 60),
    };
    return metric === 'both' ? [launches, time] : metric === 'time' ? [time] : [launches];
  });
  return (
    <MultiLineChart
      title={title}
      description="Запуск — открытие рабочей среды. Время — суммарные минуты подтверждённой работы пользователей; простой и скрытые вкладки исключаются. В совместном режиме пунктир и правая шкала показывают минуты."
      labels={labels}
      pointLabels={pointLabels}
      primaryUnit={metric === 'time' ? 'Активные минуты' : 'Запуски'}
      secondaryUnit="Активные минуты"
      series={series}
      controls={
        <select
          aria-label={`Показатель «${title}»`}
          value={metric}
          onChange={(event) => setMetric(event.target.value as typeof metric)}
        >
          <option value="launches">Запуски</option>
          <option value="time">Активное время</option>
          <option value="both">Вместе</option>
        </select>
      }
    />
  );
}

const ERROR_SYSTEMS: Readonly<Record<string, string>> = {
  api: 'API',
  web: 'Сайт',
  projects: 'Проекты',
  classrooms: 'Классы',
  learning: 'Обучение',
  courses: 'Курсы',
  access: 'Доступ и вход',
  analytics: 'Аналитика',
  administration: 'Админка',
  diagnostics: 'Диагностика',
  storage: 'Хранилище',
  database: 'База данных',
  scratch: 'Scratch',
  electronics: 'Электроника',
  robotics: 'Робототехника',
  chess: 'Шахматы',
  checkers: 'Шашки',
  'three-d': '3D',
  ai: 'ИИ',
  audit: 'Аудит',
  updates: 'Обновления',
  backup: 'Копии',
  network: 'Сеть',
  host: 'Сервер',
  metrics: 'Метрики',
};

function ErrorsChart({
  dashboard,
  points,
  labels,
  pointLabels,
}: {
  readonly dashboard: AdminProductDashboard;
  readonly points: readonly {
    readonly at: string;
    readonly from: string;
    readonly to: string;
    readonly activeAccounts: number;
    readonly activeStudents: number;
  }[];
  readonly labels: readonly string[];
  readonly pointLabels: readonly string[];
}): JSX.Element {
  const { from, to, bucketSeconds } = dashboard;
  const key = `${from}/${to}/${bucketSeconds}`;
  const [system, setSystem] = useState('all');
  const [result, setResult] = useState<{ key: string; trend: AdminErrorTrend | null } | null>(null);
  const resolved = result?.key === key;
  const trend = resolved ? result.trend : null;
  const failed = resolved && !trend;
  useEffect(() => {
    const request = new AbortController();
    void adminApi.errorTrend({ from, to, bucketSeconds }, request.signal).then((result) => {
      if (request.signal.aborted) return;
      setResult({ key, trend: result.ok ? result.data : null });
    });
    return () => request.abort();
  }, [from, to, bucketSeconds, key, dashboard.generatedAt]);

  if (failed || trend?.coverage === 'unavailable' || !trend) {
    return (
      <section className="admin-dashboard-network admin-chart-wide" aria-busy={!failed && !trend}>
        <h3>Ошибки по системам</h3>
        <p>
          {failed
            ? 'Журнал ошибок недоступен.'
            : trend
              ? 'За этот период журнал ошибок недоступен.'
              : 'Загружаем журнал ошибок…'}
        </p>
      </section>
    );
  }
  const byTime = new Map(trend.points.map((point) => [Date.parse(point.at), point.counts]));
  const systems = [...new Set(trend.points.flatMap((point) => Object.keys(point.counts)))].sort(
    (a, b) => (ERROR_SYSTEMS[a] ?? a).localeCompare(ERROR_SYSTEMS[b] ?? b, 'ru'),
  );
  const selected = systems.includes(system) ? system : 'all';
  const coverageStart = Date.parse(trend.from!);
  const coverageEnd = Date.parse(trend.to!);
  const errorCounts = points.map((point) => {
    if (Date.parse(point.from) < coverageStart || Date.parse(point.to) > coverageEnd) return null;
    const counts = byTime.get(Date.parse(point.at)) ?? {};
    return selected === 'all'
      ? Object.values(counts).reduce((sum, value) => sum + value, 0)
      : (counts[selected] ?? 0);
  });
  return (
    <div className="admin-chart-wide admin-error-panel">
      <MultiLineChart
        title="Ошибки по системам"
        description="Количество записей уровня error в собранном журнале. Пунктир — уникальные активные аккаунты и ученики в тех же интервалах, по правой шкале."
        labels={labels}
        pointLabels={pointLabels}
        primaryUnit="Ошибки"
        secondaryUnit="Пользователи"
        series={[
          { id: 'errors', label: 'Ошибки', color: '#ae3b36', values: errorCounts, bars: true },
          {
            id: 'people',
            label: 'Активные пользователи',
            color: '#0877b3',
            secondary: true,
            values: points.map((point) => point.activeAccounts + point.activeStudents),
          },
        ]}
        controls={
          <select
            aria-label="Система в журнале ошибок"
            value={selected}
            onChange={(event) => setSystem(event.target.value)}
          >
            <option value="all">Все системы</option>
            {systems.map((key) => (
              <option key={key} value={key}>
                {ERROR_SYSTEMS[key] ?? key}
              </option>
            ))}
          </select>
        }
      />
      {trend.coverage === 'partial' && trend.from && trend.to ? (
        <p className="admin-chart-coverage">
          Доступная часть журнала: {moscowInterval(trend.from, trend.to)}. Возможны пробелы.
        </p>
      ) : null}
    </div>
  );
}

export function VerificationMethodsSection({
  scope,
  onAccessDenied,
}: {
  readonly scope: AdminScope;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [method, setMethod] = useState<'max' | 'telegram' | 'email'>('max');
  return (
    <section
      className="admin-integrations auth-confirmation-settings"
      aria-labelledby="admin-confirmations-title"
    >
      <div className="admin-section-heading">
        <div>
          <h2 id="admin-confirmations-title">Подтверждения</h2>
          <p>Правило входа и доступные способы подтверждения аккаунта.</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          Обновить состояние
        </button>
      </div>
      {scope.kind === 'platform' ? (
        <>
          <VerificationPolicyControl refreshKey={refreshKey} onAccessDenied={onAccessDenied} />
          <div className="confirmation-tabs" role="tablist" aria-label="Способ подтверждения">
            {(['max', 'telegram', 'email'] as const).map((id, index) => (
              <button
                key={id}
                id={`confirmation-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={method === id}
                aria-controls={`confirmation-panel-${id}`}
                tabIndex={method === id ? 0 : -1}
                onClick={() => setMethod(id)}
                onKeyDown={(e) => {
                  const ids = ['max', 'telegram', 'email'] as const;
                  let next: number;
                  if (e.key === 'ArrowRight') next = (index + 1) % 3;
                  else if (e.key === 'ArrowLeft') next = (index + 2) % 3;
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = 2;
                  else return;
                  e.preventDefault();
                  setMethod(ids[next]!);
                  document.getElementById(`confirmation-tab-${ids[next]}`)?.focus();
                }}
              >
                {id === 'email' ? 'Почта' : id === 'max' ? 'MAX' : 'Telegram'}
              </button>
            ))}
          </div>
          {(['max', 'telegram', 'email'] as const).map((id) => (
            <div
              key={id}
              id={`confirmation-panel-${id}`}
              className="confirmation-panel"
              role="tabpanel"
              aria-labelledby={`confirmation-tab-${id}`}
              hidden={method !== id}
              tabIndex={0}
            >
              {id === 'email' ? (
                <AdminEmailSettings refreshKey={refreshKey} onAccessDenied={onAccessDenied} />
              ) : (
                <AdminAuthProviderCard
                  provider={id}
                  refreshKey={refreshKey}
                  onAccessDenied={onAccessDenied}
                />
              )}
            </div>
          ))}
        </>
      ) : (
        <p role="status">Подключение способов входа доступно администратору платформы.</p>
      )}
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
