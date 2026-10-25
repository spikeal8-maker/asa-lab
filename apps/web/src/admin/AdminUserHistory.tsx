import { useEffect, useRef, useState } from 'react';
import {
  adminApi,
  type AdminHistoryCategory,
  type AdminHistoryPage,
  type AdminScope,
} from './admin-api';

const categories = {
  projects: 'Проекты и версии',
  publications: 'Публикации',
  ai: 'Использование ИИ',
};
const types = {
  project: 'Проект создан',
  version: 'Сохранённая версия',
  publication: 'Версия публикации',
  legacy_publication: 'Старая галерея — сохранённая запись',
  ai: 'Запрос к ИИ',
};
const statuses: Record<string, string> = {
  admitted: 'Принят',
  running: 'Выполняется',
  succeeded: 'Успешно',
  failed: 'Ошибка',
  stopped: 'Остановлен',
  cancelled: 'Отменён',
  active: 'Активен',
  archived: 'В архиве',
  deleted: 'Удалён',
  public: 'Опубликовано',
  unlisted: 'По ссылке',
  revoked: 'Публикация отозвана',
  draft: 'Черновик',
};

export function AdminUserHistory(props: {
  kind: 'account' | 'student';
  targetId: string;
  scope: Pick<AdminScope, 'kind' | 'id'>;
  onAccessDenied: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-user-history">
      <button
        type="button"
        className="btn-secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Скрыть историю' : 'История проектов, публикаций и ИИ'}
      </button>
      {open ? (
        <AdminUserHistoryPanel
          key={`${props.kind}:${props.targetId}:${props.scope.kind}:${props.scope.id}`}
          {...props}
        />
      ) : null}
    </div>
  );
}
export function AdminUserHistoryPanel({
  kind,
  targetId,
  scope,
  onAccessDenied,
}: Parameters<typeof AdminUserHistory>[0]) {
  const [category, setCategory] = useState<AdminHistoryCategory>('projects');
  const [page, setPage] = useState<AdminHistoryPage | null>(null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<string | null>(null);
  const sequence = useRef(0);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  useEffect(() => {
    setPage(null);
    setFailure(null);
    void load(null);
    return () => {
      sequence.current++;
    };
  }, [category, kind, targetId, scope.kind, scope.id]);
  async function load(cursor: string | null) {
    const request = ++sequence.current;
    setBusy(true);
    setFailure(null);
    const result = await adminApi.userHistory({ kind, targetId, scope, category, cursor });
    if (request !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        setPage(null);
        denied.current();
        return;
      }
      setFailure(
        result.status === 400
          ? 'Срок страницы истёк. Обновите историю.'
          : 'Не удалось загрузить историю. Повторите попытку.',
      );
      return;
    }
    setPage((previous) => ({
      ...result.data,
      items:
        cursor && previous
          ? [
              ...previous.items,
              ...result.data.items.filter(
                (item) => !previous.items.some((old) => old.key === item.key),
              ),
            ]
          : result.data.items,
    }));
  }
  return (
    <section aria-label="История пользователя">
      <label>
        Раздел истории{' '}
        <select
          value={category}
          onChange={(event) => {
            sequence.current++;
            setPage(null);
            setCategory(event.target.value as AdminHistoryCategory);
          }}
        >
          {Object.entries(categories).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="admin-catalog-note">
        Все сохранившиеся записи, от новых к старым. Это не журнал каждого автосохранения или
        изменения владельца. Для публикаций показаны сохранённые версии и текущее состояние, а не
        все прошлые переключения статуса. Старую удалённую историю восстановить нельзя. Для ИИ
        показаны метаданные с начала ведения журнала; тексты переписки не раскрываются. «Неизвестно»
        не означает ноль.
      </p>
      {busy ? <p role="status">Загружаем историю…</p> : null}
      {failure ? (
        <div role="alert">
          <p>{failure}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void load(page?.next ?? null)}
          >
            Повторить
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setPage(null);
              void load(null);
            }}
          >
            Обновить историю
          </button>
        </div>
      ) : null}
      {page?.coverage === 'unavailable_scope' ? (
        <p role="status">
          Личная история недоступна в области организации: нет подтверждённой связи этих записей с
          её рабочим пространством.
        </p>
      ) : null}
      {page?.coverage === 'retained' && !page.items.length && !busy ? (
        <p>Сохранившихся записей в этом разделе нет.</p>
      ) : null}
      <ol className="admin-user-history-list">
        {page?.items.map((item) => (
          <li key={item.key}>
            <strong>
              {types[item.type]}
              {item.title ? `: ${item.title}` : ''}
            </strong>
            <time dateTime={item.occurredAt}>
              {new Date(item.occurredAt).toLocaleString('ru-RU')}
            </time>
            {item.type === 'ai' ? (
              <>
                <span>
                  Провайдер: {item.provider ?? 'Неизвестно'} · Модель: {item.model ?? 'Неизвестно'}{' '}
                  · Запрошено: {item.requestedModel ?? 'Неизвестно'}
                </span>
                <span>
                  Входные токены: {item.inputTokens ?? 'Неизвестно'} · Выходные токены:{' '}
                  {item.outputTokens ?? 'Неизвестно'} · Длительность:{' '}
                  {item.durationMs === null || item.durationMs === undefined
                    ? 'Неизвестно'
                    : `${item.durationMs} мс`}
                </span>
                {item.errorCode ? <span>Код ошибки: {item.errorCode}</span> : null}
                <small>Запрос: {item.id}</small>
              </>
            ) : (
              <>
                <span>
                  {item.module ? `Инструмент: ${item.module}` : ''}
                  {item.revision ? ` · Версия: ${item.revision}` : ''}
                </span>
                <small>Проект: {item.projectId}</small>
              </>
            )}
            {item.status ? (
              <span>
                {item.type === 'publication' ? 'Текущее состояние публикации: ' : 'Состояние: '}
                {statuses[item.status] ?? item.status}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {page ? <p>Загружено записей: {page.items.length}.</p> : null}
      {page?.next && !failure ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void load(page.next)}
        >
          Показать ещё записи
        </button>
      ) : null}
    </section>
  );
}
