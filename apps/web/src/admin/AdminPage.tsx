import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  adminApi,
  type AdminAccount,
  type AdminAccountCrm,
  type AdminApiResult,
  type AdminAuditCursor,
  type AdminAuditEvent,
  type AdminListCursor,
  type AdminListPage,
  type AdminOrganization,
  type AdminOperationsStatus,
  type AdminProfile,
  type AdminScope,
  type AdminSecuritySession,
  type AdminIpLabelKind,
  type AdminNetworkKind,
} from './admin-api';
import { adminActionLabel, adminResultLabel, adminRoleLabel, adminScopeLabel } from './admin-model';
import { AdminDashboard, IpActivitySection, VerificationMethodsSection } from './AdminDashboard';
import {
  adminSectionLabel,
  scopeSupportsAdminSection,
  type AdminSection,
} from './admin-navigation';
import './admin.css';

export type AdminAccessState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'granted'; readonly profile: AdminProfile };

type AuditState =
  | { readonly kind: 'idle' | 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly items: readonly AdminAuditEvent[];
      readonly next: AdminAuditCursor | null;
      readonly loadingMore: boolean;
      readonly moreError: string | null;
    };

type DirectoryState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly items: readonly T[];
      readonly next: AdminListCursor | null;
      readonly loadingMore: boolean;
      readonly moreError: string | null;
    };

type OperationsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly status: AdminOperationsStatus };

interface DirectoryInput {
  readonly scope: Pick<AdminScope, 'kind' | 'id'>;
  readonly search?: string;
  readonly limit?: number;
  readonly cursor?: AdminListCursor | null;
}

type DirectoryLoader<T> = (input: DirectoryInput) => Promise<AdminApiResult<AdminListPage<T>>>;

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

function scopeKey(scope: AdminScope): string {
  return `${scope.kind}:${scope.id ?? '*'}`;
}

function dateTime(value: string | null): string {
  return value ? DATE_TIME.format(new Date(value)) : 'Нет данных';
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days > 0 ? `${days} д` : '', hours > 0 ? `${hours} ч` : '', `${minutes} мин`]
    .filter(Boolean)
    .join(' ');
}

function statusLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    active: 'Активен',
    suspended: 'Приостановлен',
    closed: 'Закрыт',
    archived: 'В архиве',
    invited: 'Приглашён',
    revoked: 'Отозвана',
    expired: 'Истекла',
    pending: 'Ожидает',
    verified: 'Подтверждена',
    unverified: 'Не подтверждена',
  };
  return labels[value] ?? value;
}

function accountAccessLabel(status: string): string {
  if (status === 'active') return 'Вход разрешён';
  if (status === 'suspended') return 'Вход заблокирован';
  return statusLabel(status);
}

function accountActivityLabel(account: AdminAccount): string {
  if (account.activeSessionCount > 0) return `Действующих входов: ${account.activeSessionCount}`;
  if (!account.hasEverSignedIn) return 'Ни разу не входил';
  return `Последний вход: ${dateTime(account.lastSeenAt)}`;
}

function isRoutineAudit(event: AdminAuditEvent): boolean {
  return (
    event.action.endsWith('.read') && (event.result === 'succeeded' || event.result === 'allowed')
  );
}

function StatePage({
  title,
  description,
  busy = false,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly busy?: boolean;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}): JSX.Element {
  return (
    <main id="main-content" className="portal-content admin-state-page" tabIndex={-1}>
      <section className="admin-state-card" aria-busy={busy || undefined}>
        {busy ? <span className="admin-loading-mark" aria-hidden="true" /> : null}
        <p className="portal-eyebrow">Администрирование</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {action ? (
          <button type="button" className="btn-secondary" onClick={action.onClick}>
            {action.label}
          </button>
        ) : null}
      </section>
    </main>
  );
}

function DirectorySection<T>({
  scope,
  title,
  description,
  searchPlaceholder,
  emptyMessage,
  privacyNote,
  loader,
  header,
  row,
  rowKey,
  onAccessDenied,
}: {
  readonly scope: AdminScope;
  readonly title: string;
  readonly description: string;
  readonly searchPlaceholder: string;
  readonly emptyMessage: string;
  readonly privacyNote?: string;
  readonly loader: DirectoryLoader<T>;
  readonly header: JSX.Element;
  readonly row: (item: T) => JSX.Element;
  readonly rowKey: (item: T) => string;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [state, setState] = useState<DirectoryState<T>>({ kind: 'loading' });
  const requestVersion = useRef(0);

  const loadPage = useCallback(
    async (cursor: AdminListCursor | null, append: boolean): Promise<void> => {
      const version = ++requestVersion.current;
      if (append) {
        setState((current) =>
          current.kind === 'ready'
            ? { ...current, loadingMore: true, moreError: null }
            : { kind: 'loading' },
        );
      } else {
        setState({ kind: 'loading' });
      }
      const result = await loader({
        scope,
        search: appliedSearch,
        limit: 50,
        cursor,
      });
      if (version !== requestVersion.current) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          onAccessDenied();
          return;
        }
        const message =
          result.status === 0
            ? 'Сервер недоступен. Проверьте соединение и повторите.'
            : 'Данные временно недоступны.';
        if (append) {
          setState((current) =>
            current.kind === 'ready'
              ? { ...current, loadingMore: false, moreError: message }
              : { kind: 'error', message },
          );
        } else {
          setState({ kind: 'error', message });
        }
        return;
      }
      setState((current) => ({
        kind: 'ready',
        items:
          append && current.kind === 'ready'
            ? [...current.items, ...result.data.items]
            : result.data.items,
        next: result.data.next,
        loadingMore: false,
        moreError: null,
      }));
    },
    [appliedSearch, loader, onAccessDenied, scope],
  );

  useEffect(() => {
    void loadPage(null, false);
    return () => {
      requestVersion.current += 1;
    };
  }, [loadPage]);

  const applySearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized === appliedSearch) void loadPage(null, false);
    else setAppliedSearch(normalized);
  };

  return (
    <section className="admin-directory" aria-labelledby={`admin-${title}-title`}>
      <div className="admin-section-heading admin-directory-heading">
        <div>
          <h2 id={`admin-${title}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        <form className="admin-directory-search" onSubmit={applySearch}>
          <label>
            <span className="sr-only">Поиск</span>
            <input
              type="search"
              value={query}
              maxLength={100}
              placeholder={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-secondary">
            Найти
          </button>
        </form>
      </div>

      {privacyNote ? <p className="admin-privacy-note">{privacyNote}</p> : null}

      {state.kind === 'loading' ? (
        <div className="admin-audit-state" aria-busy="true">
          <span className="admin-loading-mark" aria-hidden="true" />
          <strong>Загружаем реальные данные</strong>
          <p>Область и роль повторно проверяются на сервере.</p>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="admin-audit-state" role="alert">
          <strong>Данные не загрузились</strong>
          <p>{state.message}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadPage(null, false)}
          >
            Повторить
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' && state.items.length === 0 ? (
        <div className="admin-audit-state">
          <strong>{appliedSearch ? 'Ничего не найдено' : emptyMessage}</strong>
          <p>
            {appliedSearch
              ? 'Измените запрос или очистите поле поиска.'
              : 'Здесь не показываются примерные или сгенерированные записи.'}
          </p>
        </div>
      ) : null}
      {state.kind === 'ready' && state.items.length > 0 ? (
        <>
          <div className="admin-audit-table-wrap">
            <table className="admin-audit-table admin-directory-table">
              <thead>{header}</thead>
              <tbody>
                {state.items.map((item) => cloneElement(row(item), { key: rowKey(item) }))}
              </tbody>
            </table>
          </div>
          {state.moreError ? (
            <p className="admin-inline-error" role="alert">
              {state.moreError}
            </p>
          ) : null}
          {state.next ? (
            <button
              type="button"
              className="btn-secondary admin-load-more"
              disabled={state.loadingMore}
              onClick={() => void loadPage(state.next, true)}
            >
              {state.loadingMore ? 'Загружаем…' : 'Показать ещё'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const loadOrganizations: DirectoryLoader<AdminOrganization> = (input) =>
  adminApi.organizations(input);
const loadSecuritySessions: DirectoryLoader<AdminSecuritySession> = (input) =>
  adminApi.securitySessions(input);

function OperationsSection({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [state, setState] = useState<OperationsState>({ kind: 'loading' });
  const requestVersion = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setState({ kind: 'loading' });
    const result = await adminApi.operationsStatus();
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
            ? 'Сервер недоступен. Проверьте соединение и повторите.'
            : 'Не удалось получить состояние системы.',
      });
      return;
    }
    setState({ kind: 'ready', status: result.data });
  }, [onAccessDenied]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  return (
    <section className="admin-operations" aria-labelledby="admin-operations-title">
      <div className="admin-section-heading">
        <div>
          <h2 id="admin-operations-title">Система</h2>
          <p>Фактическое состояние API, PostgreSQL и эксплуатационные счётчики.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => void load()}>
          Обновить
        </button>
      </div>

      {state.kind === 'loading' ? (
        <div className="admin-audit-state" aria-busy="true">
          <span className="admin-loading-mark" aria-hidden="true" />
          <strong>Проверяем систему</strong>
          <p>PostgreSQL повторно подтверждает права администратора платформы.</p>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="admin-audit-state" role="alert">
          <strong>Состояние не загрузилось</strong>
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? <OperationsStatus status={state.status} /> : null}
    </section>
  );
}

function OperationsStatus({ status }: { readonly status: AdminOperationsStatus }): JSX.Element {
  const runtime = status.runtime;
  return (
    <>
      <div className="admin-operation-grid admin-operation-services">
        <article>
          <span>Версия приложения</span>
          <strong title={status.build.revision}>{status.build.revision.slice(0, 12)}</strong>
          <small>
            {status.build.builtAt
              ? `Собрана ${dateTime(status.build.builtAt)}`
              : 'Время сборки не задано'}
          </small>
        </article>
        <article>
          <span>API</span>
          <strong className="admin-operation-up">Отвечает</strong>
          <small>Запрос выполнен сервером</small>
        </article>
        <article>
          <span>PostgreSQL</span>
          <strong className="admin-operation-up">Отвечает</strong>
          <small>Защищённый запрос выполнен</small>
        </article>
        <article>
          <span>Последняя миграция</span>
          <strong>{status.migration.version}</strong>
          <small title={status.migration.name}>
            {status.build.synchronized === true
              ? 'Соответствует приложению'
              : status.build.synchronized === false
                ? `Ожидается схема ${status.build.expectedSchemaVersion}`
                : status.migration.name}
          </small>
        </article>
        <article>
          <span>Проверено</span>
          <strong className="admin-operation-time">{dateTime(status.checkedAt)}</strong>
          <small>Время PostgreSQL</small>
        </article>
      </div>

      <div className="admin-section-heading admin-areas-heading">
        <div>
          <h2>Реальные данные платформы</h2>
          <p>Сводные значения без паролей, токенов, IP-адресов и пользовательского содержимого.</p>
        </div>
      </div>
      <div className="admin-operation-grid admin-operation-counts">
        <article>
          <span>Все аккаунты</span>
          <strong>{status.counts.accounts}</strong>
        </article>
        <article>
          <span>Активные аккаунты</span>
          <strong>{status.counts.activeAccounts}</strong>
        </article>
        <article>
          <span>Приостановлены</span>
          <strong>{status.counts.suspendedAccounts}</strong>
        </article>
        <article>
          <span>Организации</span>
          <strong>{status.counts.organizations}</strong>
        </article>
        <article>
          <span>Активные сессии</span>
          <strong>{status.counts.activeSessions}</strong>
        </article>
        <article>
          <span>События админки за 24 ч</span>
          <strong>{status.counts.auditEvents24h}</strong>
        </article>
      </div>

      <div className="admin-section-heading admin-areas-heading">
        <div>
          <h2>Технические показатели API</h2>
          <p>Накоплены текущим процессом API и обнуляются после его перезапуска.</p>
        </div>
      </div>
      {runtime ? (
        <div className="admin-operation-grid admin-operation-runtime">
          <article>
            <span>Работает без перезапуска</span>
            <strong>{duration(runtime.uptimeSeconds)}</strong>
          </article>
          <article>
            <span>Запросов обработано</span>
            <strong>{runtime.requests.total}</strong>
            <small>Сейчас выполняется: {runtime.requests.inFlight}</small>
          </article>
          <article>
            <span>Задержка запросов p99</span>
            <strong>{runtime.requests.durationMs.p99} мс</strong>
            <small>p95: {runtime.requests.durationMs.p95} мс</small>
          </article>
          <article>
            <span>Задержка event loop p99</span>
            <strong>{runtime.eventLoopDelayMs.p99} мс</strong>
            <small>Максимум: {runtime.eventLoopDelayMs.max} мс</small>
          </article>
          <article>
            <span>Память процесса</span>
            <strong>{runtime.memory.rssMb} МБ</strong>
            <small>Heap: {runtime.memory.heapUsedMb} МБ</small>
          </article>
          <article>
            <span>CPU занят процессом API</span>
            <strong>{runtime.host.cpuUsedByApiPercent}%</strong>
            <small>Из общей мощности {runtime.host.logicalCpuCount} логических ядер</small>
          </article>
          <article>
            <span>Память компьютера</span>
            <strong>{runtime.host.memoryUsedPercent}%</strong>
            <small>Всего: {Math.round(runtime.host.memoryTotalMb / 1024)} ГБ</small>
          </article>
          <article>
            <span>Ответы 5xx</span>
            <strong>{runtime.requests.byStatusClass['5xx'] ?? 0}</strong>
            <small>За время работы процесса</small>
          </article>
          {runtime.database ? (
            <article>
              <span>Пул PostgreSQL</span>
              <strong>{runtime.database.total}</strong>
              <small>
                Свободно: {runtime.database.idle} · ждут: {runtime.database.waiting}
              </small>
            </article>
          ) : null}
        </div>
      ) : (
        <p className="admin-privacy-note">Технические метрики отключены в этом процессе API.</p>
      )}
    </>
  );
}

function mutationMessage(result: Extract<AdminApiResult<unknown>, { ok: false }>): string {
  if (result.error.code === 'admin_self_protection') {
    return 'Нельзя заблокировать себя или снять собственные права администратора.';
  }
  if (result.status === 0) return 'Сервер недоступен. Попробуйте ещё раз.';
  return result.error.message || 'Изменение не выполнено.';
}

type AccountSort = 'last_login' | 'name' | 'activity' | 'registered';
type AccountCrmTab = 'overview' | 'activity' | 'security' | 'management' | 'notes';

type AccountCrmState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly detail: AdminAccountCrm };

const IP_LABELS: readonly { readonly value: AdminIpLabelKind; readonly label: string }[] = [
  { value: 'school', label: 'Школа' },
  { value: 'home', label: 'Дом' },
  { value: 'mobile', label: 'Мобильная сеть' },
  { value: 'organization', label: 'Организация' },
  { value: 'other', label: 'Другое' },
];

function networkKindLabel(kind: AdminNetworkKind | null): string {
  if (kind === 'public') return 'Публичный интернет';
  if (kind === 'local_network') return 'Локальная сеть';
  if (kind === 'local_device') return 'Этот сервер';
  if (kind === 'proxy') return 'Технический прокси';
  return 'Источник не определён';
}

function moduleLabel(moduleKey: string): string {
  return (
    { electronics: 'Электроника', 'three-d': '3D', chess: 'Шахматы', checkers: 'Шашки' }[
      moduleKey
    ] ?? moduleKey
  );
}

function activeDuration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? `${seconds} сек` : '0 мин';
  return `${Math.round(seconds / 60)} мин`;
}

function activityEventLabel(event: AdminAccountCrm['activity'][number]): string {
  if (event.eventType === 'auth.login') return 'Вход в аккаунт';
  if (event.eventType === 'auth.register') return 'Регистрация';
  if (event.eventType === 'auth.max') return 'Подтверждение через MAX';
  if (event.eventType === 'auth.class_join') return 'Вход по коду класса';
  if (event.eventType === 'session.observed') return 'Активная сессия';
  if (event.eventType === 'module.opened') {
    const modules: Readonly<Record<string, string>> = {
      electronics: 'Электроника',
      'three-d': '3D',
      chess: 'Шахматы',
      checkers: 'Шашки',
    };
    return `Открыт модуль «${modules[event.moduleKey ?? ''] ?? event.moduleKey ?? 'Неизвестный'}»`;
  }
  return event.eventType;
}

function IpLabelEditor({
  accountId,
  item,
  onSaved,
  onAccessDenied,
}: {
  readonly accountId: string;
  readonly item: AdminAccountCrm['ipAddresses'][number];
  readonly onSaved: () => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [kind, setKind] = useState<AdminIpLabelKind | ''>(item.labelKind ?? '');
  const [label, setLabel] = useState(item.label ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (!kind && !item.labelKind) return;
    setBusy(true);
    setFailure(null);
    const result = kind
      ? await adminApi.setAccountIpLabel(accountId, {
          ipAddress: item.address,
          labelKind: kind,
          label: label.trim() || null,
        })
      : await adminApi.clearAccountIpLabel(accountId, item.address);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) return onAccessDenied();
      setFailure(mutationMessage(result));
      setBusy(false);
      return;
    }
    onSaved();
  };

  return (
    <div className="admin-crm-ip-editor">
      <select
        aria-label={`Тип IP ${item.address}`}
        value={kind}
        onChange={(event) => setKind(event.target.value as AdminIpLabelKind | '')}
      >
        <option value="">Не определён</option>
        {IP_LABELS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        aria-label={`Название IP ${item.address}`}
        value={label}
        disabled={!kind}
        maxLength={120}
        placeholder="Например: школа № 12"
        onChange={(event) => setLabel(event.target.value)}
      />
      <button
        type="button"
        className="btn-secondary"
        disabled={busy || (!kind && !item.labelKind)}
        onClick={() => void save()}
      >
        {busy ? 'Сохраняем…' : kind ? 'Сохранить' : 'Снять метку'}
      </button>
      {failure ? (
        <span className="admin-crm-field-error" role="alert">
          {failure}
        </span>
      ) : null}
    </div>
  );
}

function UserCrmPanel({
  account,
  scope,
  currentAccountId,
  canManage,
  onChanged,
  onAccessDenied,
}: {
  readonly account: AdminAccount;
  readonly scope: AdminScope;
  readonly currentAccountId: string;
  readonly canManage: boolean;
  readonly onChanged: () => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [state, setState] = useState<AccountCrmState>({ kind: 'loading' });
  const [version, setVersion] = useState(0);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [activeTab, setActiveTab] = useState<AccountCrmTab>('overview');
  const [busy, setBusy] = useState<'access' | 'role' | 'max' | 'note' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const isSelf = account.accountId === currentAccountId;
  const reasonReady = reason.trim().length >= 3;

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void adminApi.accountCrm(account.accountId, scope).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) return onAccessDenied();
        setState({ kind: 'error', message: mutationMessage(result) });
        return;
      }
      setState({ kind: 'ready', detail: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [account.accountId, onAccessDenied, scope, version]);

  const finish = (result: AdminApiResult<unknown>): void => {
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) return onAccessDenied();
      setFailure(mutationMessage(result));
      setBusy(null);
      return;
    }
    setReason('');
    setBusy(null);
    setVersion((value) => value + 1);
    onChanged();
  };

  const addNote = async (): Promise<void> => {
    if (!note.trim()) return;
    setBusy('note');
    setFailure(null);
    const result = await adminApi.addAccountNote(account.accountId, note.trim());
    if (!result.ok) return finish(result);
    setNote('');
    finish(result);
  };

  if (state.kind === 'loading') {
    return (
      <div className="admin-crm-loading" aria-busy="true">
        <span className="admin-loading-mark" />
        <span>Загружаем карточку…</span>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="admin-inline-error" role="alert">
        {state.message}
      </div>
    );
  }

  const detail = state.detail;
  return (
    <div className="admin-crm-panel">
      <dl className="admin-crm-facts">
        <div>
          <dt>Регистрация</dt>
          <dd>{dateTime(detail.createdAt)}</dd>
        </div>
        <div>
          <dt>Первый вход</dt>
          <dd>{dateTime(detail.firstAuthenticatedAt)}</dd>
        </div>
        <div>
          <dt>Почта</dt>
          <dd>
            {detail.email} · {statusLabel(detail.emailVerificationState)}
          </dd>
        </div>
        <div>
          <dt>MAX</dt>
          <dd>
            {detail.max.linked ? `Подключён · ${dateTime(detail.max.verifiedAt)}` : 'Не подключён'}
          </dd>
        </div>
      </dl>

      <div className="admin-user-tabs" role="tablist" aria-label="Карточка пользователя">
        <button
          type="button"
          role="tab"
          id={`admin-user-${account.accountId}-tab-overview`}
          aria-controls={`admin-user-${account.accountId}-panel-overview`}
          aria-selected={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
        >
          Обзор
        </button>
        <button
          type="button"
          role="tab"
          id={`admin-user-${account.accountId}-tab-activity`}
          aria-controls={`admin-user-${account.accountId}-panel-activity`}
          aria-selected={activeTab === 'activity'}
          onClick={() => setActiveTab('activity')}
        >
          Активность
        </button>
        <button
          type="button"
          role="tab"
          id={`admin-user-${account.accountId}-tab-security`}
          aria-controls={`admin-user-${account.accountId}-panel-security`}
          aria-selected={activeTab === 'security'}
          onClick={() => setActiveTab('security')}
        >
          Безопасность
        </button>
        {canManage ? (
          <button
            type="button"
            role="tab"
            id={`admin-user-${account.accountId}-tab-management`}
            aria-controls={`admin-user-${account.accountId}-panel-management`}
            aria-selected={activeTab === 'management'}
            onClick={() => setActiveTab('management')}
          >
            Управление
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          id={`admin-user-${account.accountId}-tab-notes`}
          aria-controls={`admin-user-${account.accountId}-panel-notes`}
          aria-selected={activeTab === 'notes'}
          onClick={() => setActiveTab('notes')}
        >
          Заметки
        </button>
      </div>

      {activeTab === 'overview' ? (
        <div
          className="admin-crm-tab-panel admin-crm-grid"
          role="tabpanel"
          id={`admin-user-${account.accountId}-panel-overview`}
          aria-labelledby={`admin-user-${account.accountId}-tab-overview`}
        >
          <section className="admin-crm-card">
            <h3>Организации</h3>
            {detail.organizations.length ? (
              <ul>
                {detail.organizations.map((organization) => (
                  <li key={organization.workspaceId}>
                    <strong>{organization.title}</strong>
                    <span>
                      {adminRoleLabel(organization.role)} · {statusLabel(organization.state)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Не состоит в организации.</p>
            )}
          </section>

          <section className="admin-crm-card">
            <h3>Сессии и устройства</h3>
            {detail.sessions.length ? (
              <ul>
                {detail.sessions.slice(0, 8).map((session) => (
                  <li key={session.sessionId}>
                    <strong>{session.device ?? 'Устройство не определено'}</strong>
                    <span>
                      {session.workspaceTitle} · {dateTime(session.lastSeenAt)} ·{' '}
                      {statusLabel(session.status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Входов ещё не было.</p>
            )}
          </section>

          <section className="admin-crm-card admin-crm-wide">
            <h3>Работа в системах</h3>
            {detail.moduleUsage.length ? (
              <ul>
                {detail.moduleUsage.map((usage) => (
                  <li key={usage.moduleKey}>
                    <strong>{moduleLabel(usage.moduleKey)}</strong>
                    <span>
                      проектов: {usage.projectCount} · открытий: {usage.launches} · активного
                      времени: {activeDuration(usage.activeSeconds)} · последний запуск{' '}
                      {dateTime(usage.lastOpenedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Использование рабочих сред пока не зафиксировано.</p>
            )}
          </section>
        </div>
      ) : null}

      {activeTab === 'activity' ? (
        <section
          className="admin-crm-card admin-crm-tab-panel"
          role="tabpanel"
          id={`admin-user-${account.accountId}-panel-activity`}
          aria-labelledby={`admin-user-${account.accountId}-tab-activity`}
        >
          <h3>Последние действия</h3>
          {detail.activity.length ? (
            <ol className="admin-crm-timeline">
              {detail.activity.slice(0, 20).map((event) => (
                <li key={event.id}>
                  <strong>{activityEventLabel(event)}</strong>
                  <span>
                    {dateTime(event.occurredAt)}
                    {event.ipAddress ? ` · ${event.ipAddress}` : ''}
                    {event.ipAddress ? ` · ${networkKindLabel(event.networkKind)}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>Событий пока нет.</p>
          )}
        </section>
      ) : null}

      {activeTab === 'security' ? (
        <section
          className="admin-crm-card admin-crm-wide admin-crm-tab-panel"
          role="tabpanel"
          id={`admin-user-${account.accountId}-panel-security`}
          aria-labelledby={`admin-user-${account.accountId}-tab-security`}
        >
          <h3>IP-адреса</h3>
          {detail.ipAddresses.length ? (
            <div className="admin-crm-ip-list">
              {detail.ipAddresses.map((item) => (
                <article key={item.address}>
                  <div>
                    <strong>{item.address}</strong>
                    <span>
                      {networkKindLabel(item.networkKind)} ·{' '}
                      {item.device ?? 'Устройство не определено'} · последний раз{' '}
                      {dateTime(item.lastSeenAt)} · событий: {item.eventCount}
                    </span>
                  </div>
                  {canManage ? (
                    <IpLabelEditor
                      key={`${item.address}:${item.labelKind ?? ''}:${item.label ?? ''}`}
                      accountId={account.accountId}
                      item={item}
                      onSaved={() => setVersion((value) => value + 1)}
                      onAccessDenied={onAccessDenied}
                    />
                  ) : item.labelKind ? (
                    <span className="admin-state-chip">
                      {IP_LABELS.find((entry) => entry.value === item.labelKind)?.label}
                      {item.label ? ` · ${item.label}` : ''}
                    </span>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p>IP ещё не зафиксированы.</p>
          )}
        </section>
      ) : null}

      {canManage && activeTab === 'management' ? (
        <section
          className="admin-crm-card admin-crm-access admin-crm-tab-panel"
          role="tabpanel"
          id={`admin-user-${account.accountId}-panel-management`}
          aria-labelledby={`admin-user-${account.accountId}-tab-management`}
        >
          <h3>Доступ</h3>
          <label className="admin-reason-field">
            <span>Причина изменения</span>
            <textarea
              value={reason}
              maxLength={500}
              rows={2}
              placeholder="Причина попадёт в журнал действий"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {isSelf ? (
            <p className="admin-dialog-note">Собственный доступ и роль нельзя отозвать.</p>
          ) : null}
          {failure ? (
            <p className="admin-inline-error" role="alert">
              {failure}
            </p>
          ) : null}
          <div className="admin-dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={!reasonReady || busy !== null || (isSelf && account.isPlatformAdmin)}
              onClick={() => {
                setBusy('role');
                setFailure(null);
                void adminApi
                  .setPlatformAdmin(account.accountId, {
                    enabled: !account.isPlatformAdmin,
                    reason: reason.trim(),
                  })
                  .then(finish);
              }}
            >
              {busy === 'role'
                ? 'Сохраняем…'
                : account.isPlatformAdmin
                  ? 'Снять роль администратора'
                  : 'Назначить администратором'}
            </button>
            <button
              type="button"
              className="admin-danger-button"
              disabled={!reasonReady || busy !== null || !detail.max.linked}
              onClick={() => {
                setBusy('max');
                setFailure(null);
                void adminApi
                  .revokeMaxIdentity(account.accountId, { reason: reason.trim() })
                  .then(finish);
              }}
            >
              {busy === 'max' ? 'Отключаем…' : 'Отозвать MAX'}
            </button>
            <button
              type="button"
              className={account.status === 'active' ? 'admin-danger-button' : 'btn-primary'}
              disabled={!reasonReady || busy !== null || (isSelf && account.status === 'active')}
              onClick={() => {
                setBusy('access');
                setFailure(null);
                void adminApi
                  .setAccountStatus(account.accountId, {
                    status: account.status === 'active' ? 'suspended' : 'active',
                    reason: reason.trim(),
                  })
                  .then(finish);
              }}
            >
              {busy === 'access'
                ? 'Сохраняем…'
                : account.status === 'active'
                  ? 'Заблокировать вход'
                  : 'Разрешить вход'}
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === 'notes' ? (
        <section
          className="admin-crm-card admin-crm-tab-panel"
          role="tabpanel"
          id={`admin-user-${account.accountId}-panel-notes`}
          aria-labelledby={`admin-user-${account.accountId}-tab-notes`}
        >
          <h3>Комментарии</h3>
          {canManage ? (
            <div className="admin-crm-note-form">
              <textarea
                value={note}
                maxLength={2000}
                rows={3}
                placeholder="Добавить внутренний комментарий"
                onChange={(event) => setNote(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!note.trim() || busy !== null}
                onClick={() => void addNote()}
              >
                {busy === 'note' ? 'Добавляем…' : 'Добавить'}
              </button>
            </div>
          ) : null}
          {detail.notes.length ? (
            <ol className="admin-crm-notes">
              {detail.notes.map((item) => (
                <li key={item.id}>
                  <p>{item.note}</p>
                  <span>
                    {item.authorDisplayName} · {dateTime(item.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p>Комментариев пока нет.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function AccountsCrmSection({
  scope,
  currentAccountId,
  canManage,
  version,
  onChanged,
  onAccessDenied,
}: {
  readonly scope: AdminScope;
  readonly currentAccountId: string;
  readonly canManage: boolean;
  readonly version: number;
  readonly onChanged: () => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AccountSort>('last_login');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [state, setState] = useState<DirectoryState<AdminAccount>>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void adminApi.accounts({ scope, search, limit: 200 }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) return onAccessDenied();
        setState({ kind: 'error', message: mutationMessage(result) });
        return;
      }
      setState({
        kind: 'ready',
        items: result.data.items,
        next: result.data.next,
        loadingMore: false,
        moreError: null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onAccessDenied, scope, search, version]);

  const items = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const next = [...state.items];
    const time = (value: string | null): number => (value ? Date.parse(value) : 0);
    next.sort((left, right) => {
      if (sort === 'name') return left.displayName.localeCompare(right.displayName, 'ru');
      if (sort === 'activity')
        return (
          right.recentActivityCount - left.recentActivityCount ||
          time(right.lastSeenAt) - time(left.lastSeenAt)
        );
      if (sort === 'registered') return time(right.createdAt) - time(left.createdAt);
      return time(right.lastSeenAt) - time(left.lastSeenAt);
    });
    return next;
  }, [sort, state]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSearch(query.trim());
    setExpandedId(null);
  };

  return (
    <section className="admin-users-crm" aria-labelledby="admin-users-title">
      <div className="admin-users-toolbar">
        <h2 id="admin-users-title" className="sr-only">
          Пользователи
        </h2>
        <form onSubmit={submit}>
          <input
            type="search"
            value={query}
            maxLength={100}
            placeholder="Имя, логин или почта"
            aria-label="Поиск пользователей"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn-secondary">
            Найти
          </button>
        </form>
        <label>
          <span className="sr-only">Сортировка</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as AccountSort)}>
            <option value="last_login">Последний вход</option>
            <option value="name">По имени</option>
            <option value="activity">По активности</option>
            <option value="registered">По регистрации</option>
          </select>
        </label>
      </div>
      {state.kind === 'loading' ? (
        <div className="admin-crm-loading" aria-busy="true">
          <span className="admin-loading-mark" />
          <span>Загружаем пользователей…</span>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="admin-inline-error" role="alert">
          {state.message}
        </div>
      ) : null}
      {state.kind === 'ready' && items.length === 0 ? (
        <div className="admin-audit-state">
          <strong>Пользователи не найдены</strong>
        </div>
      ) : null}
      {items.length ? (
        <div className="admin-user-list" role="list">
          <div className="admin-user-list-header" aria-hidden="true">
            <span>Пользователь</span>
            <span>Откуда</span>
            <span>Активность</span>
            <span>Доступ</span>
            <span />
          </div>
          {items.map((account) => {
            const expanded = expandedId === account.accountId;
            return (
              <article
                key={account.accountId}
                className={`admin-user-item${expanded ? ' expanded' : ''}`}
                role="listitem"
              >
                <button
                  type="button"
                  className="admin-user-row"
                  aria-expanded={expanded}
                  aria-controls={`admin-user-${account.accountId}`}
                  onClick={() => setExpandedId(expanded ? null : account.accountId)}
                >
                  <span className="admin-user-identity">
                    <strong>{account.displayName}</strong>
                    <small>
                      @{account.username} · {account.email}
                    </small>
                  </span>
                  <span>
                    <strong>{account.lastIpAddress ?? 'IP не зафиксирован'}</strong>
                    <small>
                      {account.lastIpAddress
                        ? networkKindLabel(account.lastNetworkKind)
                        : scope.title}
                      {account.lastDevice ? ` · ${account.lastDevice}` : ''}
                    </small>
                  </span>
                  <span>
                    <strong>{accountActivityLabel(account)}</strong>
                    <small>Событий за 30 дней: {account.recentActivityCount}</small>
                  </span>
                  <span>
                    <strong>{accountAccessLabel(account.status)}</strong>
                    <small>
                      {account.isPlatformAdmin
                        ? 'Администратор'
                        : account.organizationRole
                          ? adminRoleLabel(account.organizationRole)
                          : 'Пользователь'}
                      {account.accountId === currentAccountId ? ' · Вы' : ''}
                    </small>
                  </span>
                  <span className="admin-user-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                {expanded ? (
                  <div id={`admin-user-${account.accountId}`}>
                    <UserCrmPanel
                      account={account}
                      scope={scope}
                      currentAccountId={currentAccountId}
                      canManage={canManage}
                      onChanged={onChanged}
                      onAccessDenied={onAccessDenied}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {state.kind === 'ready' && state.next ? (
        <p className="admin-crm-limit-note">
          Показаны первые 200 записей. Уточните поиск, чтобы найти более раннюю регистрацию.
        </p>
      ) : null}
    </section>
  );
}

function SessionRevokeDialog({
  session,
  onClose,
  onChanged,
  onAccessDenied,
}: {
  readonly session: AdminSecuritySession;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const revoke = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const result = await adminApi.revokeSession(session.sessionId, { reason: reason.trim() });
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        onAccessDenied();
        return;
      }
      setFailure(mutationMessage(result));
      setBusy(false);
      return;
    }
    onChanged();
    onClose();
  };

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="admin-dialog admin-dialog-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-session-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-dialog-heading">
          <div>
            <span>Безопасность</span>
            <h2 id="admin-session-dialog-title">Завершить эту сессию?</h2>
            <p>
              {session.displayName} · {session.userAgentSummary ?? 'Неизвестное устройство'}
            </p>
          </div>
          <button
            type="button"
            className="admin-icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <label className="admin-reason-field">
          <span>Причина</span>
          <textarea
            value={reason}
            maxLength={500}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {failure ? (
          <p className="admin-inline-error" role="alert">
            {failure}
          </p>
        ) : null}
        <div className="admin-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="admin-danger-button"
            disabled={reason.trim().length < 3 || busy}
            onClick={() => void revoke()}
          >
            {busy ? 'Завершаем…' : 'Завершить сессию'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AdminPage({
  access,
  section,
  onNavigate,
  onRetry,
  onBack,
  onAccessDenied,
}: {
  readonly access: AdminAccessState;
  readonly section: AdminSection;
  readonly onNavigate: (section: AdminSection) => void;
  readonly onRetry: () => void;
  readonly onBack: () => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  if (access.kind === 'idle' || access.kind === 'checking') {
    return (
      <StatePage
        title="Проверяем права доступа"
        description="Административные разделы откроются только после подтверждения сервером."
        busy
      />
    );
  }
  if (access.kind === 'denied') {
    return (
      <StatePage
        title="Нет административного доступа"
        description="Эта страница доступна только в пределах роли, назначенной сервером."
        action={{ label: 'Вернуться в ASA Lab', onClick: onBack }}
      />
    );
  }
  if (access.kind === 'error') {
    return (
      <StatePage
        title="Не удалось проверить доступ"
        description={access.message}
        action={{ label: 'Повторить проверку', onClick: onRetry }}
      />
    );
  }
  return (
    <AdminWorkspace
      profile={access.profile}
      section={section}
      onNavigate={onNavigate}
      onAccessDenied={onAccessDenied}
    />
  );
}

function AdminWorkspace({
  profile,
  section,
  onNavigate,
  onAccessDenied,
}: {
  readonly profile: AdminProfile;
  readonly section: AdminSection;
  readonly onNavigate: (section: AdminSection) => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [selectedKey, setSelectedKey] = useState(() =>
    profile.scopes[0] ? scopeKey(profile.scopes[0]) : '',
  );
  const [audit, setAudit] = useState<AuditState>({ kind: 'idle' });
  const [auditMode, setAuditMode] = useState<'important' | 'all'>('important');
  const [filter, setFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<AdminSecuritySession | null>(null);
  const [accountsVersion, setAccountsVersion] = useState(0);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const requestVersion = useRef(0);

  const selectedScope =
    profile.scopes.find((scope) => scopeKey(scope) === selectedKey) ?? profile.scopes[0] ?? null;
  const selectedScopeKey = selectedScope ? scopeKey(selectedScope) : '';
  const visibleSection =
    selectedScope && scopeSupportsAdminSection(selectedScope, section) ? section : 'overview';
  useEffect(() => {
    if (selectedScope) return;
    setSelectedKey(profile.scopes[0] ? scopeKey(profile.scopes[0]) : '');
  }, [profile.scopes, selectedScope]);

  useEffect(() => {
    if (selectedScope && scopeSupportsAdminSection(selectedScope, section)) return;
    const compatibleScope = profile.scopes.find((scope) =>
      scopeSupportsAdminSection(scope, section),
    );
    if (compatibleScope) {
      setSelectedKey(scopeKey(compatibleScope));
      return;
    }
    onNavigate('overview');
  }, [onNavigate, profile.scopes, section, selectedScope]);

  const loadAudit = useCallback(
    async (cursor: AdminAuditCursor | null, append: boolean): Promise<void> => {
      if (!selectedScope) return;
      const version = ++requestVersion.current;
      if (append) {
        setAudit((current) =>
          current.kind === 'ready'
            ? { ...current, loadingMore: true, moreError: null }
            : { kind: 'loading' },
        );
      } else {
        setAudit({ kind: 'loading' });
      }

      const result = await adminApi.auditEvents({
        scope: selectedScope,
        limit: 50,
        cursor,
      });
      if (version !== requestVersion.current) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          onAccessDenied();
          return;
        }
        const message =
          result.status === 0
            ? 'Сервер недоступен. Проверьте соединение и повторите.'
            : 'Журнал временно недоступен.';
        if (append) {
          setAudit((current) =>
            current.kind === 'ready'
              ? { ...current, loadingMore: false, moreError: message }
              : { kind: 'error', message },
          );
        } else {
          setAudit({ kind: 'error', message });
        }
        return;
      }

      setAudit((current) => ({
        kind: 'ready',
        items:
          append && current.kind === 'ready'
            ? [...current.items, ...result.data.items]
            : result.data.items,
        next: result.data.next,
        loadingMore: false,
        moreError: null,
      }));
    },
    [onAccessDenied, selectedScope],
  );

  useEffect(() => {
    if (visibleSection !== 'audit' || !selectedScope) return;
    setFilter('');
    void loadAudit(null, false);
    return () => {
      requestVersion.current += 1;
    };
  }, [loadAudit, selectedScope, selectedScopeKey, visibleSection]);

  const visibleAudit = useMemo(() => {
    if (audit.kind !== 'ready') return [];
    const query = filter.trim().toLocaleLowerCase('ru-RU');
    return audit.items.filter((event) => {
      if (auditMode === 'important' && isRoutineAudit(event)) return false;
      if (!query) return true;
      return [
        adminActionLabel(event),
        event.action,
        event.actorRole,
        event.actorPrincipalId,
        event.targetType,
        event.targetId,
        event.requestId,
      ]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLocaleLowerCase('ru-RU').includes(query));
    });
  }, [audit, auditMode, filter]);

  if (!selectedScope) {
    return (
      <StatePage
        title="Область доступа не найдена"
        description="Сервер подтвердил учётную запись, но не вернул ни одной административной области."
      />
    );
  }

  const canManageAccounts =
    selectedScope.kind === 'platform' &&
    selectedScope.permissions.includes('administration.accounts.manage');
  const canManageSessions =
    selectedScope.kind === 'platform' &&
    selectedScope.permissions.includes('administration.security.manage');

  return (
    <main id="main-content" className="portal-content admin-page" tabIndex={-1}>
      <header className="admin-heading admin-heading-compact">
        <div className="admin-title-line">
          <h1>
            <span>Админ</span>
            <b aria-hidden="true">/</b>
            <span>{adminSectionLabel(visibleSection)}</span>
          </h1>
        </div>
        {profile.scopes.length > 1 ? (
          <label className="admin-scope-select">
            <span className="sr-only">Область управления</span>
            <select
              value={selectedScopeKey}
              onChange={(event) => {
                const nextKey = event.target.value;
                setSelectedKey(nextKey);
                const nextScope = profile.scopes.find((scope) => scopeKey(scope) === nextKey);
                if (nextScope && !scopeSupportsAdminSection(nextScope, section)) {
                  onNavigate('overview');
                }
              }}
            >
              {profile.scopes.map((scope) => (
                <option key={scopeKey(scope)} value={scopeKey(scope)}>
                  {adminScopeLabel(scope)} · {adminRoleLabel(scope.role)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {visibleSection === 'overview' ? (
        <AdminDashboard scope={selectedScope} onAccessDenied={onAccessDenied} />
      ) : visibleSection === 'confirmations' ? (
        <VerificationMethodsSection scope={selectedScope} onAccessDenied={onAccessDenied} />
      ) : visibleSection === 'operations' ? (
        <OperationsSection onAccessDenied={onAccessDenied} />
      ) : visibleSection === 'audit' ? (
        <section className="admin-audit" aria-labelledby="admin-audit-title">
          <div className="admin-section-heading admin-audit-heading">
            <div>
              <h2 id="admin-audit-title">История</h2>
              <p>
                По умолчанию показаны изменения и ошибки. Технические просмотры доступны отдельно.
              </p>
            </div>
            {audit.kind === 'ready' && audit.items.length > 0 ? (
              <div className="admin-audit-tools">
                <div className="admin-segmented" aria-label="Вид истории">
                  <button
                    type="button"
                    className={auditMode === 'important' ? 'active' : ''}
                    onClick={() => setAuditMode('important')}
                  >
                    Важные
                  </button>
                  <button
                    type="button"
                    className={auditMode === 'all' ? 'active' : ''}
                    onClick={() => setAuditMode('all')}
                  >
                    Все события
                  </button>
                </div>
                <label className="admin-audit-search">
                  <span className="sr-only">Поиск в истории</span>
                  <input
                    type="search"
                    value={filter}
                    placeholder="Найти событие"
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>

          {audit.kind === 'idle' || audit.kind === 'loading' ? (
            <div className="admin-audit-state" aria-busy="true">
              <span className="admin-loading-mark" aria-hidden="true" />
              <strong>Загружаем историю</strong>
            </div>
          ) : null}
          {audit.kind === 'error' ? (
            <div className="admin-audit-state" role="alert">
              <strong>История не загрузилась</strong>
              <p>{audit.message}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void loadAudit(null, false)}
              >
                Повторить
              </button>
            </div>
          ) : null}
          {audit.kind === 'ready' && audit.items.length === 0 ? (
            <div className="admin-audit-state">
              <strong>Событий пока нет</strong>
              <p>Первое административное действие появится здесь автоматически.</p>
            </div>
          ) : null}
          {audit.kind === 'ready' && audit.items.length > 0 ? (
            <>
              <div className="admin-audit-table-wrap">
                <table className="admin-audit-table">
                  <thead>
                    <tr>
                      <th scope="col">Время</th>
                      <th scope="col">Что произошло</th>
                      <th scope="col">Результат</th>
                      <th scope="col">
                        <span className="sr-only">Подробности</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAudit.map((event) => (
                      <AuditRow key={event.id} event={event} />
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleAudit.length === 0 ? (
                <p className="admin-filter-empty">
                  {auditMode === 'important' && !filter
                    ? 'Важных изменений пока нет. Технические просмотры доступны во вкладке «Все события».'
                    : 'В загруженных событиях ничего не найдено.'}
                </p>
              ) : null}
              {audit.moreError ? (
                <p className="admin-inline-error" role="alert">
                  {audit.moreError}
                </p>
              ) : null}
              {audit.next ? (
                <button
                  type="button"
                  className="btn-secondary admin-load-more"
                  disabled={audit.loadingMore}
                  onClick={() => void loadAudit(audit.next, true)}
                >
                  {audit.loadingMore ? 'Загружаем…' : 'Показать более ранние события'}
                </button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : visibleSection === 'accounts' ? (
        <AccountsCrmSection
          key={`accounts:${selectedScopeKey}`}
          scope={selectedScope}
          currentAccountId={profile.accountId}
          canManage={canManageAccounts}
          version={accountsVersion}
          onChanged={() => setAccountsVersion((value) => value + 1)}
          onAccessDenied={onAccessDenied}
        />
      ) : visibleSection === 'organizations' ? (
        <DirectorySection
          key={`organizations:${selectedScopeKey}`}
          scope={selectedScope}
          title="Организации"
          description="Школы и другие рабочие пространства, их участники и администраторы."
          searchPlaceholder="Название организации"
          emptyMessage="Организаций в этой области пока нет"
          privacyNote="На этом этапе раздел только показывает состав. Назначение участников и ролей организации — следующий блок разработки."
          loader={loadOrganizations}
          rowKey={(item) => item.workspaceId}
          onAccessDenied={onAccessDenied}
          header={
            <tr>
              <th scope="col">Организация</th>
              <th scope="col">Состояние</th>
              <th scope="col">Участники</th>
              <th scope="col">Администраторы</th>
              <th scope="col">Активные сессии</th>
            </tr>
          }
          row={(item) => (
            <tr>
              <td>
                <strong>{item.title}</strong>
                <span className="admin-table-secondary">Создана: {dateTime(item.createdAt)}</span>
              </td>
              <td>
                <span className={`admin-state-chip admin-state-chip-${item.status}`}>
                  {statusLabel(item.status)}
                </span>
              </td>
              <td>{item.memberCount}</td>
              <td>{item.administratorCount}</td>
              <td>{item.activeSessionCount}</td>
            </tr>
          )}
        />
      ) : visibleSection === 'security' ? (
        <>
          <IpActivitySection scope={selectedScope} onAccessDenied={onAccessDenied} />
          <DirectorySection
            key={`security:${selectedScopeKey}:${sessionsVersion}`}
            scope={selectedScope}
            title="Сессии и устройства"
            description="Здесь управляют отдельными входами. Блокировка самого аккаунта находится во вкладке «Пользователи»."
            searchPlaceholder="Имя, почта или устройство"
            emptyMessage="Сессий в этой области пока нет"
            privacyNote="Пароли и токены в админку не передаются. IP показываются отдельно только для успешных входов и проверки безопасности."
            loader={loadSecuritySessions}
            rowKey={(item) => item.sessionId}
            onAccessDenied={onAccessDenied}
            header={
              <tr>
                <th scope="col">Пользователь</th>
                <th scope="col">Область</th>
                <th scope="col">Состояние</th>
                <th scope="col">Последняя активность</th>
                <th scope="col">Устройство</th>
                {canManageSessions ? (
                  <th scope="col">
                    <span className="sr-only">Действия</span>
                  </th>
                ) : null}
              </tr>
            }
            row={(item) => (
              <tr>
                <td>
                  <strong>{item.displayName}</strong>
                  <span className="admin-table-secondary">{item.email}</span>
                </td>
                <td>{item.workspaceTitle}</td>
                <td>
                  <span className={`admin-state-chip admin-state-chip-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                  <span className="admin-table-secondary">
                    Истекает: {dateTime(item.expiresAt)}
                  </span>
                </td>
                <td>{dateTime(item.lastSeenAt)}</td>
                <td>{item.userAgentSummary ?? 'Не определено'}</td>
                {canManageSessions ? (
                  <td>
                    {item.status === 'active' && item.accountId !== profile.accountId ? (
                      <button
                        type="button"
                        className="admin-row-action"
                        onClick={() => setSelectedSession(item)}
                      >
                        Завершить
                      </button>
                    ) : (
                      <span className="admin-table-secondary">
                        {item.accountId === profile.accountId ? 'Ваша сессия' : 'Завершена'}
                      </span>
                    )}
                  </td>
                ) : null}
              </tr>
            )}
          />
        </>
      ) : null}

      {selectedSession ? (
        <SessionRevokeDialog
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onChanged={() => setSessionsVersion((value) => value + 1)}
          onAccessDenied={onAccessDenied}
        />
      ) : null}
    </main>
  );
}

function AuditRow({ event }: { readonly event: AdminAuditEvent }): JSX.Element {
  const target = [event.targetType, event.targetId].filter(Boolean).join(' · ');
  return (
    <tr>
      <td>
        <time dateTime={event.occurredAt}>{DATE_TIME.format(new Date(event.occurredAt))}</time>
      </td>
      <td>
        <strong>{adminActionLabel(event)}</strong>
        {event.reasonText ? (
          <span className="admin-table-secondary">{event.reasonText}</span>
        ) : null}
      </td>
      <td>
        <span className={`admin-result admin-result-${event.result}`}>
          {adminResultLabel(event.result)}
        </span>
      </td>
      <td>
        <details className="admin-audit-details">
          <summary>Открыть</summary>
          <dl>
            <div>
              <dt>Техническое действие</dt>
              <dd>{event.action}</dd>
            </div>
            <div>
              <dt>Исполнитель</dt>
              <dd>
                {adminRoleLabel(event.actorRole)} · {event.actorPrincipalId}
              </dd>
            </div>
            <div>
              <dt>Цель</dt>
              <dd>{target || 'Не указана'}</dd>
            </div>
            <div>
              <dt>Запрос</dt>
              <dd>{event.requestId}</dd>
            </div>
            {event.reasonCode ? (
              <div>
                <dt>Источник</dt>
                <dd>{event.reasonCode}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      </td>
    </tr>
  );
}
