import { useState, useRef, useCallback, useEffect, type ReactNode, type FormEvent } from 'react';
import {
  adminApi,
  type AdminScope,
  type AdminCatalogInput,
  type AdminCatalogPage,
  type AdminCatalogUser,
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
  version,
  onAccessDenied,
  renderAccount,
}: {
  scope: AdminScope;
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
  const scopeKind = scope.kind,
    scopeId = scope.id;
  const key = JSON.stringify([scopeKind, scopeId, search, kind, status, sort, direction, version]);
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
        append && current.kind === 'ready' && current.key === key
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
    [key, scopeKind, scopeId, search, kind, status, sort, direction],
  );
  useEffect(() => {
    void load(null);
    return () => {
      sequence.current++;
    };
  }, [load]);
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
      </form>
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
