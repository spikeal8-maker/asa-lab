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
} from './admin-api';
import { adminActionLabel, adminResultLabel, adminRoleLabel, adminScopeLabel } from './admin-model';
import './admin.css';

export type AdminAccessState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'granted'; readonly profile: AdminProfile };

type AdminTab = 'overview' | 'accounts' | 'organizations' | 'security' | 'operations' | 'audit';

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

function tabDescription(tab: AdminTab): string {
  const descriptions: Readonly<Record<AdminTab, string>> = {
    overview: 'Краткая навигация по управлению сервисом.',
    accounts: 'Блокировка входа, активность и назначение администраторов.',
    organizations: 'Школы, участники и ответственные администраторы.',
    security: 'Активные входы и завершение подозрительных сессий.',
    operations: 'API, база данных, CPU, память и ошибки.',
    audit: 'Важные изменения и полный технический журнал.',
  };
  return descriptions[tab];
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

const loadAccounts: DirectoryLoader<AdminAccount> = (input) => adminApi.accounts(input);
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

function UserManagementDialog({
  account,
  currentAccountId,
  onClose,
  onChanged,
  onAccessDenied,
}: {
  readonly account: AdminAccount;
  readonly currentAccountId: string;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'access' | 'role' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const isSelf = account.accountId === currentAccountId;
  const reasonReady = reason.trim().length >= 3;

  const finish = (result: AdminApiResult<unknown>): void => {
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        onAccessDenied();
        return;
      }
      setFailure(mutationMessage(result));
      setBusy(null);
      return;
    }
    onChanged();
    onClose();
  };

  const changeAccess = async (): Promise<void> => {
    setBusy('access');
    setFailure(null);
    const status = account.status === 'active' ? 'suspended' : 'active';
    finish(await adminApi.setAccountStatus(account.accountId, { status, reason: reason.trim() }));
  };

  const changeRole = async (): Promise<void> => {
    setBusy('role');
    setFailure(null);
    finish(
      await adminApi.setPlatformAdmin(account.accountId, {
        enabled: !account.isPlatformAdmin,
        reason: reason.trim(),
      }),
    );
  };

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-dialog-heading">
          <div>
            <span>Управление пользователем</span>
            <h2 id="admin-user-dialog-title">{account.displayName}</h2>
            <p>{account.email}</p>
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

        <dl className="admin-user-summary">
          <div>
            <dt>Доступ</dt>
            <dd>{accountAccessLabel(account.status)}</dd>
          </div>
          <div>
            <dt>Активность</dt>
            <dd>{accountActivityLabel(account)}</dd>
          </div>
          <div>
            <dt>Роль</dt>
            <dd>{account.isPlatformAdmin ? 'Администратор' : 'Пользователь'}</dd>
          </div>
        </dl>

        <label className="admin-reason-field">
          <span>Причина изменения</span>
          <textarea
            value={reason}
            maxLength={500}
            rows={3}
            placeholder="Например: обращение пользователя или смена ответственного"
            onChange={(event) => setReason(event.target.value)}
          />
          <small>Минимум 3 символа. Причина попадёт в историю действий.</small>
        </label>

        {isSelf ? (
          <p className="admin-dialog-note">
            Собственный доступ и роль нельзя отозвать из этой формы.
          </p>
        ) : null}
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
            className="btn-secondary"
            disabled={!reasonReady || busy !== null || (isSelf && account.isPlatformAdmin)}
            onClick={() => void changeRole()}
          >
            {busy === 'role'
              ? 'Сохраняем…'
              : account.isPlatformAdmin
                ? 'Снять роль администратора'
                : 'Назначить администратором'}
          </button>
          <button
            type="button"
            className={account.status === 'active' ? 'admin-danger-button' : 'btn-primary'}
            disabled={!reasonReady || busy !== null || (isSelf && account.status === 'active')}
            onClick={() => void changeAccess()}
          >
            {busy === 'access'
              ? 'Сохраняем…'
              : account.status === 'active'
                ? 'Заблокировать вход'
                : 'Разрешить вход'}
          </button>
        </div>
      </section>
    </div>
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
  onRetry,
  onBack,
  onAccessDenied,
}: {
  readonly access: AdminAccessState;
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
  return <AdminWorkspace profile={access.profile} onAccessDenied={onAccessDenied} />;
}

function AdminWorkspace({
  profile,
  onAccessDenied,
}: {
  readonly profile: AdminProfile;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(() =>
    profile.scopes[0] ? scopeKey(profile.scopes[0]) : '',
  );
  const [audit, setAudit] = useState<AuditState>({ kind: 'idle' });
  const [auditMode, setAuditMode] = useState<'important' | 'all'>('important');
  const [filter, setFilter] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<AdminAccount | null>(null);
  const [selectedSession, setSelectedSession] = useState<AdminSecuritySession | null>(null);
  const [accountsVersion, setAccountsVersion] = useState(0);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const requestVersion = useRef(0);

  const selectedScope =
    profile.scopes.find((scope) => scopeKey(scope) === selectedKey) ?? profile.scopes[0] ?? null;
  const selectedScopeKey = selectedScope ? scopeKey(selectedScope) : '';
  const tabs = useMemo<readonly { readonly id: AdminTab; readonly label: string }[]>(() => {
    if (!selectedScope) return [];
    const available: { id: AdminTab; label: string }[] = [{ id: 'overview', label: 'Обзор' }];
    if (selectedScope.permissions.includes('administration.accounts.read')) {
      available.push({ id: 'accounts', label: 'Пользователи' });
    }
    if (selectedScope.permissions.includes('administration.organizations.read')) {
      available.push({ id: 'organizations', label: 'Организации' });
    }
    if (selectedScope.permissions.includes('administration.security.read')) {
      available.push({ id: 'security', label: 'Безопасность' });
    }
    if (
      selectedScope.kind === 'platform' &&
      selectedScope.permissions.includes('administration.operations.read')
    ) {
      available.push({ id: 'operations', label: 'Система' });
    }
    if (selectedScope.permissions.includes('administration.audit.read')) {
      available.push({ id: 'audit', label: 'История' });
    }
    return available;
  }, [selectedScope]);

  useEffect(() => {
    if (selectedScope) return;
    setSelectedKey(profile.scopes[0] ? scopeKey(profile.scopes[0]) : '');
  }, [profile.scopes, selectedScope]);

  useEffect(() => {
    if (tabs.some((entry) => entry.id === tab)) return;
    setTab('overview');
  }, [tab, tabs]);

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
    if (tab !== 'audit' || !selectedScope) return;
    setFilter('');
    void loadAudit(null, false);
    return () => {
      requestVersion.current += 1;
    };
  }, [loadAudit, selectedScope, selectedScopeKey, tab]);

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
          <h1>Админ</h1>
          <button
            type="button"
            className="admin-info-button"
            aria-label="Что можно делать в админке"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((value) => !value)}
          >
            i
          </button>
        </div>
        {profile.scopes.length > 1 ? (
          <label className="admin-scope-select">
            <span className="sr-only">Область управления</span>
            <select
              value={selectedScopeKey}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {profile.scopes.map((scope) => (
                <option key={scopeKey(scope)} value={scopeKey(scope)}>
                  {adminScopeLabel(scope)} · {adminRoleLabel(scope.role)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {helpOpen ? (
          <aside className="admin-help-popover" role="note">
            <strong>
              {selectedScope.kind === 'platform'
                ? 'У вас полный доступ ко всему ASA Lab'
                : `Вы управляете организацией «${adminScopeLabel(selectedScope)}»`}
            </strong>
            <p>
              Здесь можно управлять пользователями, сессиями и ролями, следить за системой и видеть
              историю изменений. Опасные действия требуют причины и записываются в историю.
            </p>
          </aside>
        ) : null}
      </header>

      <nav className="admin-tabs" aria-label="Разделы администрирования">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'active' : ''}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => {
              setHelpOpen(false);
              setTab(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <section className="admin-overview" aria-labelledby="admin-overview-title">
          <div className="admin-section-heading">
            <div>
              <h2 id="admin-overview-title">Управление ASA Lab</h2>
              <p>Выберите, чем хотите управлять.</p>
            </div>
          </div>
          <div className="admin-command-grid">
            {tabs
              .filter((entry) => entry.id !== 'overview')
              .map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setHelpOpen(false);
                    setTab(entry.id);
                  }}
                >
                  <strong>{entry.label}</strong>
                  <span>{tabDescription(entry.id)}</span>
                  <small>Открыть →</small>
                </button>
              ))}
          </div>
        </section>
      ) : tab === 'operations' ? (
        <OperationsSection onAccessDenied={onAccessDenied} />
      ) : tab === 'audit' ? (
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
      ) : tab === 'accounts' ? (
        <DirectorySection
          key={`accounts:${selectedScopeKey}:${accountsVersion}`}
          scope={selectedScope}
          title="Пользователи"
          description="Управление доступом и ролями. «Вход разрешён» не означает, что человек сейчас онлайн."
          searchPlaceholder="Имя, логин или почта"
          emptyMessage="Пользователей в этой области пока нет"
          privacyNote="Тестовые и демонстрационные аккаунты тоже являются записями базы. Активность показывается отдельно по реальным сессиям входа."
          loader={loadAccounts}
          rowKey={(item) => item.accountId}
          onAccessDenied={onAccessDenied}
          header={
            <tr>
              <th scope="col">Пользователь</th>
              <th scope="col">Доступ</th>
              <th scope="col">Активность</th>
              <th scope="col">Роль</th>
              {canManageAccounts ? (
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
                <span className="admin-table-secondary">@{item.username}</span>
                <span className="admin-table-secondary">{item.email}</span>
                {item.accountId === profile.accountId ? (
                  <span className="admin-you-chip">Вы</span>
                ) : null}
              </td>
              <td>
                <span className={`admin-state-chip admin-state-chip-${item.status}`}>
                  {accountAccessLabel(item.status)}
                </span>
                <span className="admin-table-secondary">
                  Почта: {statusLabel(item.emailVerificationState)}
                </span>
              </td>
              <td>{accountActivityLabel(item)}</td>
              <td>
                {item.isPlatformAdmin
                  ? 'Администратор'
                  : item.organizationRole
                    ? adminRoleLabel(item.organizationRole)
                    : 'Пользователь'}
                {item.membershipState ? (
                  <span className="admin-table-secondary">
                    Участие: {statusLabel(item.membershipState)}
                  </span>
                ) : null}
              </td>
              {canManageAccounts ? (
                <td>
                  <button
                    type="button"
                    className="admin-row-action"
                    onClick={() => setSelectedAccount(item)}
                  >
                    Управлять
                  </button>
                </td>
              ) : null}
            </tr>
          )}
        />
      ) : tab === 'organizations' ? (
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
      ) : tab === 'security' ? (
        <DirectorySection
          key={`security:${selectedScopeKey}:${sessionsVersion}`}
          scope={selectedScope}
          title="Безопасность"
          description="Здесь управляют отдельными входами и устройствами. Блокировка самого аккаунта находится во вкладке «Пользователи»."
          searchPlaceholder="Имя, почта или устройство"
          emptyMessage="Сессий в этой области пока нет"
          privacyNote="IP-адрес пока не сохраняется. Пароли и токены в админку не передаются."
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
                <span className="admin-table-secondary">Истекает: {dateTime(item.expiresAt)}</span>
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
      ) : null}

      {selectedAccount ? (
        <UserManagementDialog
          account={selectedAccount}
          currentAccountId={profile.accountId}
          onClose={() => setSelectedAccount(null)}
          onChanged={() => setAccountsVersion((value) => value + 1)}
          onAccessDenied={onAccessDenied}
        />
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
