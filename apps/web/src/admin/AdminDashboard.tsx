import { AdminEmailSettings } from './AdminEmailSettings';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adminApi,
  type AdminDashboardRange,
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
  'three-d': '3D',
  chess: 'Шахматы',
  checkers: 'Шашки',
  blocks: 'Scratch',
} as const;
const MODULE_COLORS = {
  electronics: '#0877b3',
  'three-d': '#8257c7',
  blocks: '#c54b83',
  chess: '#d4841c',
  checkers: '#16835f',
} as const;
const LEARNING_MODULES = ['electronics', 'three-d', 'blocks'] as const;
const GAME_MODULES = ['chess', 'checkers'] as const;

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});

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

export function chartLabelIndexes(length: number): number[] {
  const count = Math.min(Math.max(0, length), 12);
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
  const axis = chartCountAxis(Math.max(0, ...active.flatMap((item) => item.values)));
  const maximum = axis.maximum;
  const width = 600;
  const height = 220;
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
  const labelIndexes = chartLabelIndexes(labels.length);

  return (
    <article className="admin-chart-card">
      <header>
        <h3>{title}</h3>
        <p className="sr-only">{description}</p>
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
      <div
        className="admin-chart-canvas"
        tabIndex={0}
        role="region"
        aria-label={`Прокручиваемый график «${title}»`}
      >
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${description}`}>
          {axis.ticks.map((value) => {
            const y = top + plotHeight - (value / maximum) * plotHeight;
            return (
              <g key={value}>
                <line x1={left} x2={width - right} y1={y} y2={y} className="admin-chart-grid" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="admin-chart-axis">
                  {value}
                </text>
              </g>
            );
          })}
          {labelIndexes.map((index) => (
            <line
              key={`time-grid-${index}`}
              x1={left + (index / Math.max(1, labels.length - 1)) * plotWidth}
              x2={left + (index / Math.max(1, labels.length - 1)) * plotWidth}
              y1={top}
              y2={top + plotHeight}
              className="admin-chart-grid"
            />
          ))}
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
                className="admin-chart-axis admin-chart-time-label"
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
          <div aria-busy={state.refreshing}>
            <DashboardContent dashboard={state.dashboard} />
          </div>
        </>
      ) : null}
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
      moduleKeys.map((moduleKey) => ({
        id: moduleKey,
        label: MODULE_LABELS[moduleKey],
        color: MODULE_COLORS[moduleKey],
        values: dashboard.timeline.map((point) => {
          const source = dashboard.modules.find(
            (entry) => entry.at === point.at && entry.moduleKey === moduleKey,
          );
          return number(source?.launches);
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
      ['registration', 'Регистрация', '#c54b43'],
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
  const activeTime = (keys: readonly (keyof typeof MODULE_LABELS)[]): ChartSeries[] =>
    keys.map((moduleKey) => ({
      id: `time-${moduleKey}`,
      label: MODULE_LABELS[moduleKey],
      color: MODULE_COLORS[moduleKey],
      values: dashboard.timeline.map((point) =>
        Math.round(
          number(
            dashboard.modules.find(
              (entry) => entry.at === point.at && entry.moduleKey === moduleKey,
            )?.activeSeconds,
          ) / 60,
        ),
      ),
    }));

  return (
    <>
      <div className="admin-dashboard-kpis">
        {[
          ['Новые аккаунты', dashboard.summary.newAccounts],
          ['Активные аккаунты', dashboard.summary.activeAccounts],
          ['Начатые сессии', dashboard.summary.authenticatedSessions],
          ['Повторные входы', dashboard.summary.successfulLogins],
          ['Отклонено попыток', dashboard.summary.rejectedAuthAttempts],
          ['Незавершённые входы', dashboard.summary.failedLogins],
          ['Активные ученические места', dashboard.summary.activeStudents],
          ['Новые ученические места', dashboard.summary.newStudents],
          ['Разные IP', dashboard.summary.distinctIpAddresses],
          ['Несколько IP', dashboard.summary.accountsWithMultipleIps],
          ['Локальная сеть', dashboard.summary.localNetworkAccounts],
          ['Источник неизвестен', dashboard.summary.unclassifiedNetworkEvents],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="admin-dashboard-grid">
        <MultiLineChart
          title="Учебные инструменты — запуски"
          description="Фактические открытия рабочих сред. Повторная загрузка считается новым запуском."
          labels={labels}
          series={modules.filter((item) => LEARNING_MODULES.some((key) => key === item.id))}
        />
        <MultiLineChart
          title="Игры — запуски"
          description="Фактические открытия шахмат и шашек за выбранный период."
          labels={labels}
          series={modules.filter((item) => GAME_MODULES.some((key) => key === item.id))}
        />
        <MultiLineChart
          title="Пользователи и входы"
          description="Люди и завершённые сценарии входа на одной временной шкале."
          labels={labels}
          series={[
            {
              id: 'activeAccounts',
              label: 'Активные аккаунты',
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
              id: 'authenticatedSessions',
              label: 'Начали сессию',
              color: '#8257c7',
              values: dashboard.timeline.map((point) => point.authenticatedSessions),
            },
            {
              id: 'failedLogins',
              label: 'Не смогли войти',
              color: '#c54b43',
              values: dashboard.timeline.map((point) => point.failedLogins),
            },
          ]}
        />
        <MultiLineChart
          title="Учебные инструменты — активное время"
          description="Минуты подтверждённой активности. Долгий простой и скрытая вкладка не засчитываются."
          labels={labels}
          series={activeTime(LEARNING_MODULES)}
        />
        <MultiLineChart
          title="Игры — активное время"
          description="Минуты подтверждённой активности в шахматах и шашках; простой не засчитывается."
          labels={labels}
          series={activeTime(GAME_MODULES)}
        />
        <MultiLineChart
          title="Способы входа"
          description="Только успешно завершённые входы; продление сессии не учитывается."
          labels={labels}
          series={methods}
        />
        <MultiLineChart
          title="Ученические места"
          description="Активные StudentSeat по коду класса учитываются отдельно от аккаунтов. Эти показатели нельзя складывать как число уникальных людей."
          labels={labels}
          series={[
            {
              id: 'activeStudents',
              label: 'Активные места',
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
