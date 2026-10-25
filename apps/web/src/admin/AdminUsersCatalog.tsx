import { useState, useRef, useCallback, useEffect, type ReactNode, type FormEvent } from 'react';
import { CatalogScopeFilters } from './CatalogScopeFilters';
import { CatalogAnalytics } from './CatalogAnalytics';
import { OrganizationClassBindings } from './OrganizationClassBindings';
import './crm-directory.css';
import { AdminUserHistoryPanel } from './AdminUserHistory';
import { CrmUserCardLauncher } from './CrmUserCard';
import {
  adminApi,
  type AdminScope,
  type AdminCatalogInput,
  type AdminCatalogPage,
  type AdminCatalogUser,
  type CatalogFilters,
} from './admin-api';

type State =
  | { kind: 'loading'; key: string }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'ready'; key: string; page: AdminCatalogPage; more: boolean; moreError: string | null };
function date(value: string | null) {
  return value ? new Date(value).toLocaleString('ru-RU') : 'Не зафиксирована';
}
const statusLabel: Record<string, string> = {
  active: 'Активно',
  issued: 'Выдано',
  suspended: 'Приостановлено',
  removed: 'Удалено',
  closed: 'Закрыто',
  archived: 'В архиве',
  deleted: 'Удалено',
};
const deviceCategoryLabel: Record<string, string> = {
  desktop: 'Компьютер',
  mobile: 'Телефон',
  tablet: 'Планшет',
};
function deviceDescription(user: AdminCatalogUser) {
  const structured = [
    user.browser,
    user.operatingSystem,
    user.deviceCategory ? (deviceCategoryLabel[user.deviceCategory] ?? user.deviceCategory) : null,
  ].filter(Boolean);
  return structured.join(' · ') || user.lastDevice || 'Устройство не зафиксировано';
}
export function AdminUsersCatalog({
  scope,
  actorId,
  version,
  onAccessDenied,
  renderAccount,
}: {
  scope: AdminScope;
  actorId?: string;
  version: number;
  onAccessDenied: () => void;
  renderAccount: (user: AdminCatalogUser) => ReactNode;
}): JSX.Element {
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState('');
  const [kind, setKind] = useState<AdminCatalogInput['kind']>('all'),
    [status, setStatus] = useState<AdminCatalogInput['status']>('all'),
    [sort, setSort] = useState<AdminCatalogInput['sort']>('last_activity'),
    [direction, setDirection] = useState<AdminCatalogInput['direction']>('desc');
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState<string | null>(null);
  const exportLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const scopeKind = scope.kind,
    scopeId = scope.id;
  const key = JSON.stringify([
    actorId,
    scopeKind,
    scopeId,
    search,
    kind,
    status,
    sort,
    direction,
    filters,
  ]);
  const [stored, setState] = useState<State>({ kind: 'loading', key });
  const state: State = stored.key === key ? stored : { kind: 'loading', key };
  const sequence = useRef(0),
    currentKey = useRef(key),
    denied = useRef(onAccessDenied);
  currentKey.current = key;
  denied.current = onAccessDenied;
  const load = useCallback(
    async (cursor: string | null, append = false) => {
      const request = ++sequence.current;
      setState((current) =>
        current.kind === 'ready' && current.key === key
          ? { ...current, more: true, moreError: null }
          : { kind: 'loading', key },
      );
      const result = await adminApi.users({
        scope: { kind: scopeKind, id: scopeId },
        search,
        kind,
        status,
        sort,
        direction,
        limit: 50,
        cursor,
        filters,
      });
      if (request !== sequence.current || currentKey.current !== key) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          setState({ kind: 'loading', key });
          denied.current();
          return;
        }
        const message =
          result.status === 0
            ? 'Сервер недоступен. Повторите загрузку.'
            : result.status === 400
              ? 'Параметры страницы устарели или недопустимы. Обновите список.'
              : 'Не удалось загрузить каталог.';
        setState((current) =>
          append && current.kind === 'ready' && current.key === key
            ? { ...current, more: false, moreError: message }
            : { kind: 'error', key, message },
        );
        return;
      }
      setState((current) => ({
        kind: 'ready',
        key,
        page: {
          ...result.data,
          items:
            append && current.kind === 'ready' && current.key === key
              ? [...current.page.items, ...result.data.items]
              : result.data.items,
        },
        more: false,
        moreError: null,
      }));
    },
    [key, scopeKind, scopeId, search, kind, status, sort, direction, filters],
  );
  useEffect(() => {
    void load(null);
    return () => {
      sequence.current++;
    };
  }, [load, version]);
  const setFilter = (name: keyof CatalogFilters, value: string) =>
    setFilters((current) =>
      name === 'age' && value === 'unknown'
        ? { ...current, age: value, ageMin: '', ageMax: '' }
        : { ...current, [name]: value },
    );
  const download = async () => {
    if (exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    setExportError(null);
    const startedKey = key;
    try {
      const result = await adminApi.exportUsers({
        scope: { kind: scopeKind, id: scopeId },
        search,
        kind,
        status,
        sort,
        direction,
        limit: 50,
        cursor: null,
        filters,
      });
      if (!alive.current || currentKey.current !== startedKey) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          setState({ kind: 'loading', key });
          denied.current();
          return;
        }
        setExportError(
          result.status === 413
            ? 'Слишком большая выгрузка. Уточните фильтры (до 10 000 записей и 16 МБ).'
            : result.status === 429
              ? 'Выгрузка уже выполняется. Повторите позже.'
              : 'Не удалось подготовить выгрузку. Повторите или уточните фильтры.',
        );
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.data.csv], { type: 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'пользователи.csv';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (search === query.trim()) void load(null);
    else setSearch(query.trim());
  };
  return (
    <section className="admin-users-crm admin-users-catalog" aria-labelledby="admin-users-title">
      <h2 id="admin-users-title" className="sr-only">
        Пользователи
      </h2>
      <form className="admin-catalog-filters" onSubmit={submit}>
        <label className="admin-catalog-search">
          <span>Поиск пользователей</span>
          <input
            type="search"
            maxLength={100}
            value={query}
            placeholder="Имя, почта, логин или класс"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" className="btn-secondary">
          Найти
        </button>
        <label>
          <span>Тип записи</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="all">Все типы</option>
            <option value="accounts">Аккаунты</option>
            <option value="students">Ученические места</option>
          </select>
        </label>
        <label>
          <span>Состояние записи</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">Все состояния</option>
            <option value="active">Действующие записи</option>
            <option value="inactive">Неактивные записи</option>
          </select>
        </label>
        <label>
          <span>Сортировка</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="last_activity">Последняя активность</option>
            <option value="name">По имени</option>
            <option value="activity">События за 30 дней</option>
            <option value="created">Дата создания</option>
          </select>
        </label>
        <label>
          <span>Направление</span>
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as typeof direction)}
          >
            <option value="desc">По убыванию</option>
            <option value="asc">По возрастанию</option>
          </select>
        </label>
        <details className="crm-directory-advanced">
          <summary>Дополнительные фильтры</summary>
          <div className="crm-directory-fields">
            <label>
              <span>Возможность или роль</span>
              <select
                value={filters.role ?? 'all'}
                onChange={(e) => setFilter('role', e.target.value)}
              >
                {[
                  ['all', 'Все'],
                  ['learner', 'Ученическое место'],
                  ['creator', 'Автор'],
                  ['educator', 'Преподаватель'],
                  ['registered_student', 'Учащийся (аккаунт)'],
                  ['guardian', 'Представитель'],
                  ['platform_admin', 'Администратор платформы'],
                  ['owner', 'Владелец организации'],
                  ['school_admin', 'Администратор организации'],
                  ['member', 'Участник организации'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Возраст</span>
              <select
                value={filters.age ?? 'all'}
                onChange={(e) => setFilter('age', e.target.value)}
              >
                <option value="all">Любой / неизвестный</option>
                <option value="known">Известен</option>
                <option value="unknown">Неизвестен</option>
              </select>
            </label>
            <label>
              <span>Возраст от</span>
              <input
                type="number"
                min="0"
                max="120"
                disabled={filters.age === 'unknown'}
                value={filters.ageMin ?? ''}
                onChange={(e) => setFilter('ageMin', e.target.value)}
              />
            </label>
            <label>
              <span>Возраст до</span>
              <input
                type="number"
                min="0"
                max="120"
                disabled={filters.age === 'unknown'}
                value={filters.ageMax ?? ''}
                onChange={(e) => setFilter('ageMax', e.target.value)}
              />
            </label>
            <label>
              <span>Почта</span>
              <select
                value={filters.email ?? 'all'}
                onChange={(e) => setFilter('email', e.target.value)}
              >
                {[
                  ['all', 'Любое состояние'],
                  ['present', 'Указана'],
                  ['absent', 'Не указана'],
                  ['verified', 'Подтверждена'],
                  ['unverified', 'Не подтверждена'],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Наблюдавшаяся активность</span>
              <select
                value={filters.activity ?? 'all'}
                onChange={(e) => setFilter('activity', e.target.value)}
              >
                <option value="all">Любая</option>
                <option value="observed">Есть наблюдения</option>
                <option value="unknown">Не зафиксирована</option>
              </select>
            </label>
            <label>
              <span>Источник первого известного визита</span>
              <select
                value={filters.source ?? 'all'}
                onChange={(e) => setFilter('source', e.target.value)}
              >
                <option value="all">Любой</option>
                <option value="observed">Зафиксирован</option>
                <option value="unknown">Неизвестен</option>
              </select>
            </label>
            <label>
              <span>Создано с</span>
              <input
                type="date"
                value={filters.registeredAfter ?? ''}
                onChange={(e) => setFilter('registeredAfter', e.target.value)}
              />
            </label>
            <label>
              <span>Создано по</span>
              <input
                type="date"
                value={filters.registeredBefore ?? ''}
                onChange={(e) => setFilter('registeredBefore', e.target.value)}
              />
            </label>
            <CatalogScopeFilters
              key={JSON.stringify([actorId, scopeKind, scopeId])}
              scope={scope}
              filters={filters}
              onChange={setFilter}
              onAccessDenied={onAccessDenied}
            />
            <label>
              <span>Период ИИ</span>
              <select
                value={filters.days ?? '30'}
                onChange={(e) => setFilter('days', e.target.value)}
              >
                <option value="7">7 дней</option>
                <option value="30">30 дней</option>
                <option value="90">90 дней</option>
              </select>
            </label>
          </div>
        </details>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setQuery('');
            setSearch('');
            setKind('all');
            setStatus('all');
            setSort('last_activity');
            setDirection('desc');
            setFilters({});
            setExportError(null);
          }}
        >
          Сбросить фильтры
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={exporting || state.kind !== 'ready'}
          onClick={() => void download()}
        >
          {exporting ? 'Готовим таблицу…' : 'Скачать все результаты (CSV)'}
        </button>
      </form>
      {exportError ? (
        <p role="alert">
          {exportError}{' '}
          <button type="button" disabled={exporting} onClick={() => void download()}>
            Повторить выгрузку
          </button>
        </p>
      ) : null}
      {scope.kind === 'platform' ? (
        <OrganizationClassBindings
          key={actorId ?? scopeKind}
          onAccessDenied={onAccessDenied}
          onChanged={() => void load(null)}
        />
      ) : null}
      <p className="admin-catalog-note">
        Состояние записи не означает, что пользователь сейчас онлайн. Аккаунты и ученические места
        учитываются отдельно.
      </p>
      {state.kind === 'loading' ? (
        <div className="admin-crm-loading" aria-busy="true">
          Загружаем пользователей…
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="admin-inline-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={() => void load(null)}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          <p aria-live="polite">
            Найдено записей: {state.page.matchedCount ?? 'подсчёт недоступен'}. Загружено:{' '}
            {state.page.items.length}.
          </p>
          {state.page.analytics ? <CatalogAnalytics value={state.page.analytics} /> : null}
          {state.page.studentCoverage.state === 'unavailable' ? (
            <p className="admin-catalog-note" role="status">
              Ученические места для этой области недоступны: связь классов с организацией не
              подтверждена. Здесь показаны только разрешённые аккаунты.
            </p>
          ) : null}
          {!state.page.items.length ? (
            <div className="admin-audit-state">
              <strong>
                {kind === 'students' && state.page.studentCoverage.state === 'unavailable'
                  ? 'Каталог ученических мест в этой области недоступен'
                  : 'Пользователи не найдены'}
              </strong>
            </div>
          ) : null}
          <div className="admin-user-list" role="list">
            {state.page.items.map((user) =>
              user.kind === 'account' && user.account ? (
                <div key={user.actorKey} className="admin-catalog-account">
                  {renderAccount(user)}
                </div>
              ) : (
                <article
                  key={user.actorKey}
                  className="admin-user-item"
                  role="listitem"
                  data-actor-key={user.actorKey}
                >
                  <div className="admin-user-row admin-user-row-readonly">
                    <span className="admin-user-identity">
                      <strong>{user.displayName}</strong>
                      <small>
                        {user.kind === 'student'
                          ? 'Ученическое место'
                          : `Аккаунт · ${user.login ?? 'Имя входа недоступно'}`}
                      </small>
                      <small>
                        {user.classTitle ? `Класс: ${user.classTitle}` : 'Класс не применяется'}
                      </small>
                    </span>
                    <span>
                      <strong>{user.lastIpAddress ?? 'IP не зафиксирован'}</strong>
                      <small>{deviceDescription(user)}</small>
                    </span>
                    <span>
                      <strong>{date(user.lastActivityAt)}</strong>
                      <small>Последняя связь: {date(user.lastSeenAt)}</small>
                      <small>Событий за 30 дней: {user.recentActivityCount}</small>
                    </span>
                    <span>
                      <strong>{statusLabel[user.status] ?? user.status}</strong>
                      <small>
                        {user.classStatus
                          ? `Класс: ${statusLabel[user.classStatus] ?? user.classStatus}`
                          : 'Только просмотр'}
                      </small>
                      {!user.principalId ? <small>Идентификатор входа ещё не создан</small> : null}
                    </span>
                  </div>
                  {scope.kind === 'platform' || user.classId ? (
                    <CrmUserCardLauncher
                      history={
                        scope.kind === 'platform' ? (
                          <AdminUserHistoryPanel
                            kind={user.kind}
                            targetId={user.id}
                            scope={scope}
                            onAccessDenied={onAccessDenied}
                          />
                        ) : undefined
                      }
                      kind={user.kind}
                      targetId={user.id}
                      classroomId={
                        scope.kind === 'organization' ? (user.classId ?? undefined) : undefined
                      }
                      onAccessDenied={onAccessDenied}
                      onChanged={() => void load(null)}
                    />
                  ) : null}
                </article>
              ),
            )}
          </div>
          <p className="admin-catalog-note">
            Показано записей: {state.page.items.length}. События за 30 дней до{' '}
            {date(state.page.asOf)}. Порядок активности основан на событиях и начале сессии;
            последняя связь показывается отдельно.
          </p>
          {state.moreError ? (
            <p role="alert" className="admin-inline-error">
              {state.moreError}
            </p>
          ) : null}
          {state.page.next ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={state.more}
              onClick={() => void load(state.page.next, true)}
            >
              {state.more ? 'Загружаем…' : 'Показать ещё'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
