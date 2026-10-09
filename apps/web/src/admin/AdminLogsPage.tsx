import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './admin-api';
import './admin-logs.css';

interface LogEvent {
  readonly id: string;
  readonly time: string;
  readonly source: string;
  readonly module: string;
  readonly level: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly revision: string | null;
  readonly origin: string;
  readonly truncated: boolean;
  readonly timeBasis?: string;
  readonly windowsEventId?: number;
  readonly windowsRecordId?: string;
}
interface LogSource {
  readonly source: string;
  readonly state: string;
  readonly detail: string;
  readonly lastCollectedAt: string | null;
  readonly collectedThrough: string | null;
  readonly checkedAt?: string;
  readonly retainedFrom?: string | null;
  readonly retainedTo?: string | null;
  readonly trimmed?: boolean;
}
interface LogStatus {
  readonly state: 'ok' | 'stale' | 'unavailable' | 'error';
  readonly collectorHealth?: {
    readonly state: string;
    readonly lastSuccessAt: string | null;
    readonly detail: string;
  } | null;
  readonly collectedAt: string | null;
  readonly retentionDays: number | null;
  readonly bytes: number;
  readonly sources: readonly LogSource[];
  readonly eventSources?: readonly string[];
  readonly first: string | null;
  readonly last: string | null;
  readonly trimmed: boolean;
}
interface LogPage {
  readonly items: readonly LogEvent[];
  readonly next: { readonly time: string; readonly id: string } | null;
  readonly partial: boolean;
  readonly scanCursor?: string | null;
  readonly scanned?: number;
}
interface ExportJob {
  readonly id: string;
  readonly state: 'running' | 'ready' | 'failed';
  readonly count: number | null;
  readonly bytes: number | null;
  readonly error: string | null;
}
const TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'short',
  timeStyle: 'medium',
});
const DAY = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const SOURCE: Record<string, string> = {
  api: 'API',
  web: 'Сайт',
  scratch: 'Scratch',
  postgres: 'База данных',
  minio: 'Хранилище файлов',
  'minio-init': 'Инициализация хранилища',
  migration: 'Миграции',
  updates: 'Обновления',
  backup: 'Резервное копирование',
  tunnel: 'Сетевой туннель',
  'docker-desktop': 'Docker Desktop',
  audit: 'Действия пользователей',
  auth: 'Вход и активность',
  metrics: 'Нагрузка сервера',
};
const MODULE: Record<string, string> = {
  portal: 'Сайт',
  scratch: 'Scratch',
  electronics: 'Электроника',
  auth: 'Вход',
  system: 'Система',
};
const LEVEL: Record<string, string> = {
  error: 'Ошибка',
  warn: 'Предупреждение',
  info: 'Информация',
};
const dateLabel = (value: string | null): string =>
  value && Number.isFinite(Date.parse(value)) ? TIME.format(new Date(value)) : 'Нет записей';
const sourceLabel = (source: string): string =>
  source.endsWith(':recent')
    ? `${SOURCE[source.slice(0, -7)] ?? source.slice(0, -7)} · свежие записи`
    : (SOURCE[source] ?? source.replace(/^windows:/, 'Windows · '));
const DETAIL: Record<string, string> = {
  'Fresh events': 'Свежие события',
  'Fresh database events': 'Свежие события базы данных',
  'Historical reconciliation complete': 'История базы данных сверена за срок хранения.',
  'Runtime resource sample': 'Показатели памяти, процессора, диска и подключений базы данных.',
  'History starts at container creation; removed containers cannot be recovered':
    'История начинается с создания контейнера. Журналы удалённых контейнеров недоступны.',
  'History collection is queued': 'История дозагружается.',
  'Periodic reconciliation of the retained interval': 'Проверяется история за срок хранения.',
  'Per-channel coverage and access limitations are listed separately':
    'Полнота и ограничения доступа показаны отдельно для каждого журнала.',
  'Channel was cleared; older history is unavailable':
    'Журнал Windows был очищен. Более старая история недоступна.',
  'Access denied': 'Нет доступа к этому журналу.',
};

export function AdminLogsPage({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [from, setFrom] = useState(() => DAY.format(new Date(Date.now() - 6 * 86400_000)));
  const [to, setTo] = useState(() => DAY.format(new Date()));
  const [source, setSource] = useState('');
  const [module, setModule] = useState('');
  const [level, setLevel] = useState('error');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('application');
  const [scanned, setScanned] = useState(0);
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [page, setPage] = useState<LogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const generation = useRef(0);
  const appliedFilter = useRef('');
  const filters = useRef({ from, to, source, module, level, search, scope });
  filters.current = { from, to, source, module, level, search, scope };

  const load = useCallback(
    async (append = false): Promise<void> => {
      const g = ++generation.current;
      setLoading(true);
      setError(null);
      setScanned(0);
      const current = filters.current;
      const fingerprint = JSON.stringify(current);
      if (append && appliedFilter.current !== fingerprint) append = false;
      const params = new URLSearchParams({
        ...current,
        from: `${current.from}T00:00:00+03:00`,
        to: `${current.to}T23:59:59.999+03:00`,
      });
      if (append && page?.next) {
        params.set('beforeTime', page.next.time);
        params.set('beforeId', page.next.id);
      }
      const [info, firstResult] = await Promise.all([
        call<LogStatus>('/api/admin/v1/logs/status'),
        call<LogPage>(`/api/admin/v1/logs?${params}`),
      ]);
      let result = firstResult;
      if (info.ok && g === generation.current) setStatus(info.data);
      const started = Date.now();
      while (
        result.ok &&
        result.data.partial &&
        result.data.scanCursor &&
        g === generation.current &&
        Date.now() - started < 240_000
      ) {
        setScanned(result.data.scanned ?? 0);
        params.set('scanCursor', result.data.scanCursor);
        result = await call<LogPage>(`/api/admin/v1/logs?${params}`);
      }
      if (g !== generation.current) return;
      setLoading(false);
      for (const value of [info, result]) {
        if (!value.ok && [401, 403].includes(value.status)) {
          onAccessDenied();
          return;
        }
      }
      if (info.ok) setStatus(info.data);
      if (!result.ok || !info.ok) {
        setError('Не удалось загрузить журналы. Проверьте даты и соединение, затем повторите.');
        return;
      }
      setPage((prior) => ({
        ...result.data,
        items: append && prior ? [...prior.items, ...result.data.items] : result.data.items,
      }));
      appliedFilter.current = fingerprint;
    },
    [onAccessDenied, page?.next],
  );
  const initialLoad = useRef(load);
  useEffect(() => {
    void initialLoad.current();
    return () => {
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    if (job?.state !== 'running') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void call<ExportJob>(`/api/admin/v1/logs/exports/${job.id}`).then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          if ([401, 403].includes(result.status)) {
            onAccessDenied();
            return;
          }
          setExportError('Не удалось проверить готовность архива. Повторите сбор.');
          setJob(null);
        } else setJob(result.data);
      });
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [job, onAccessDenied]);

  const exportArchive = async (errorsOnly: boolean): Promise<void> => {
    setExporting(true);
    setExportError(null);
    setJob(null);
    const current = filters.current;
    const result = await call<ExportJob>('/api/admin/v1/logs/exports', {
      method: 'POST',
      body: JSON.stringify({
        from: `${current.from}T00:00:00+03:00`,
        to: `${current.to}T23:59:59.999+03:00`,
        level: errorsOnly ? 'error' : '',
      }),
    });
    setExporting(false);
    if (!result.ok) {
      if ([401, 403].includes(result.status)) {
        onAccessDenied();
        return;
      }
      setExportError(
        result.status === 429
          ? 'Сборщик занят. Дождитесь текущего архива и повторите.'
          : 'Не удалось запустить сбор. Проверьте даты и повторите.',
      );
    } else setJob(result.data);
  };
  const unavailable = status?.state === 'unavailable';
  const disabled = exporting || job?.state === 'running' || unavailable || !status;

  return (
    <section className="admin-logs" aria-label="Журналы системы">
      <div className="admin-logs-intro">
        <p>Ошибки и события сайта, редакторов и сервера. Время — московское.</p>
        <div className="admin-logs-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={disabled}
            onClick={() => void exportArchive(false)}
          >
            Скачать все журналы
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={() => void exportArchive(true)}
          >
            Скачать ошибки
          </button>
        </div>
      </div>
      <form
        className="admin-logs-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          С даты
          <input
            type="date"
            required
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          По дату
          <input
            type="date"
            required
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          Источник
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setScope('all');
            }}
          >
            <option value="">Все источники</option>
            {(status?.eventSources ?? []).map((value) => (
              <option key={value} value={value}>
                {sourceLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Показывать
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setSource('');
            }}
          >
            <option value="application">Приложение</option>
            <option value="host">Windows, Docker и нагрузку</option>
            <option value="all">Все журналы</option>
          </select>
        </label>
        <label>
          Модуль
          <select value={module} onChange={(event) => setModule(event.target.value)}>
            <option value="">Все модули</option>
            {Object.entries(MODULE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Уровень
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">Все события</option>
            {Object.entries(LEVEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-logs-search">
          Поиск
          <input
            type="search"
            value={search}
            maxLength={120}
            placeholder="Сообщение или номер запроса"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="admin-logs-filter-actions">
          <button type="submit" className="btn-secondary" disabled={loading}>
            Показать
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const start = DAY.format(new Date(Date.now() - 6 * 86400_000));
              const end = DAY.format(new Date());
              setFrom(start);
              setTo(end);
              filters.current = { ...filters.current, from: start, to: end };
              void load();
            }}
          >
            Последние 7 дней
          </button>
        </div>
      </form>
      {status ? (
        <div className="admin-logs-coverage">
          {status.collectorHealth?.state === 'error' ? (
            <p role="alert">
              Сборщик сообщил об ошибке. Последний успешный сбор:{' '}
              {dateLabel(status.collectorHealth.lastSuccessAt)}. {status.collectorHealth.detail}
            </p>
          ) : null}
          {unavailable ? (
            <p role="status">
              Сбор журналов ещё не подключён. После подключения здесь появятся записи.
            </p>
          ) : (
            <>
              <p>
                Последний сбор: <strong>{dateLabel(status.collectedAt)}</strong>
                {status.state === 'stale' ? ' · Сборщик давно не обновлялся' : ''}
                {status.state === 'error' ? ' · Ошибка сборщика' : ''}
              </p>

              <p>
                Сохранившиеся записи: {dateLabel(status.first)} — {dateLabel(status.last)}. Хранение
                до {status.retentionDays} дней
                {status.trimmed ? '; часть старых записей удалена по лимиту объёма' : ''}.
              </p>
              <details>
                <summary>
                  Источники и полнота: {status.sources.filter((s) => s.state === 'pending').length}{' '}
                  дозагружаются;{' '}
                  {status.sources.filter((s) => !['ok', 'pending'].includes(s.state)).length}{' '}
                  недоступны
                </summary>
                <ul>
                  {status.sources.map((s) => (
                    <li key={s.source}>
                      <strong>{sourceLabel(s.source)}</strong> —{' '}
                      {s.state === 'ok'
                        ? 'сбор работает'
                        : s.state === 'pending'
                          ? 'история дозагружается'
                          : 'недоступен'}
                      ; проверено {dateLabel(s.checkedAt ?? s.lastCollectedAt)}
                      {s.collectedThrough ? `; обработано по ${dateLabel(s.collectedThrough)}` : ''}
                      {s.retainedFrom ? (
                        <small>
                          Сохранились записи: {dateLabel(s.retainedFrom)} —{' '}
                          {dateLabel(s.retainedTo ?? null)}
                          {s.trimmed
                            ? '; старые записи этого источника сокращены по лимиту объёма'
                            : ''}
                          .
                        </small>
                      ) : null}
                      {s.detail ? <small>{DETAIL[s.detail] ?? s.detail}</small> : null}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <small>
            Архив включает все источники за выбранные даты. Старые удалённые журналы и
            неотправленные ошибки браузеров восстановить нельзя.
          </small>
        </div>
      ) : null}
      {exporting || job?.state === 'running' ? (
        <p role="status">Архив собирается. Можно продолжать работу.</p>
      ) : null}
      {job?.state === 'ready' ? (
        <p role="status">
          Архив готов: {job.count} записей.{' '}
          <a
            className="btn-secondary"
            href={`/api/admin/v1/logs/exports/${job.id}/download`}
            download
          >
            Скачать ZIP
          </a>
        </p>
      ) : null}
      {exportError || job?.state === 'failed' ? (
        <p role="alert">{exportError ?? job?.error}</p>
      ) : null}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      {loading ? (
        <p role="status">
          {scanned
            ? `Продолжаем поиск. Проверено записей: ${scanned.toLocaleString('ru-RU')}…`
            : 'Загружаем журналы…'}
        </p>
      ) : null}
      {!loading && !error && !page?.partial && page?.items.length === 0 && !unavailable ? (
        <p role="status">За выбранный период и фильтры записей нет.</p>
      ) : null}
      {page?.partial ? (
        <p role="status">
          Поиск ещё не завершён. Выберите меньший период или источник и повторите поиск.
        </p>
      ) : null}
      <ol className="admin-logs-list">
        {page?.items.map((entry) => (
          <li key={entry.id} className={`admin-log-entry admin-log-entry-${entry.level}`}>
            <div className="admin-log-meta">
              <time dateTime={entry.time}>{dateLabel(entry.time)}</time>
              <strong>{LEVEL[entry.level] ?? entry.level}</strong>
              <span>
                {sourceLabel(entry.source)} · {MODULE[entry.module] ?? entry.module}
              </span>
            </div>
            <pre>{entry.message}</pre>
            {entry.requestId ||
            entry.revision ||
            entry.origin ||
            entry.truncated ||
            entry.timeBasis === 'file_mtime' ||
            entry.timeBasis === 'transcript' ||
            entry.windowsRecordId ? (
              <details>
                <summary>Подробности</summary>
                <dl>
                  {entry.requestId ? (
                    <>
                      <dt>Запрос</dt>
                      <dd>{entry.requestId}</dd>
                    </>
                  ) : null}
                  {entry.revision ? (
                    <>
                      <dt>Версия</dt>
                      <dd>{entry.revision}</dd>
                    </>
                  ) : null}
                  {entry.origin ? (
                    <>
                      <dt>Журнал</dt>
                      <dd>{entry.origin}</dd>
                    </>
                  ) : null}
                  {entry.timeBasis === 'file_mtime' || entry.timeBasis === 'transcript' ? (
                    <>
                      <dt>Время</dt>
                      <dd>
                        {entry.timeBasis === 'transcript'
                          ? 'Время границы сеанса из заголовка журнала; точное время строки неизвестно.'
                          : 'Собственное время события не распознано. Указано время изменения файла.'}
                      </dd>
                    </>
                  ) : null}
                  {entry.windowsEventId !== undefined ? (
                    <>
                      <dt>Событие Windows</dt>
                      <dd>{entry.windowsEventId}</dd>
                    </>
                  ) : null}
                  {entry.windowsRecordId ? (
                    <>
                      <dt>Запись Windows</dt>
                      <dd>{entry.windowsRecordId}</dd>
                    </>
                  ) : null}
                  {entry.truncated ? (
                    <>
                      <dt>Длина</dt>
                      <dd>Исходное сообщение сокращено при сборе.</dd>
                    </>
                  ) : null}
                </dl>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
      {page?.next ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => void load(true)}
        >
          Показать ещё
        </button>
      ) : null}
    </section>
  );
}
