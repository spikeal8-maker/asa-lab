import { useEffect, useRef, useState } from 'react';
import { call } from './admin-api';
import type { DiscussionState } from '../projects-public/PublicationComments';
interface Comment {
  id: string;
  parentId: string | null;
  body: string;
  author: string;
  createdAt: string;
  version: number;
  authorDeleted: boolean;
  ownerHidden: boolean;
  moderatorHidden: boolean;
  reports: { reason: string; createdAt: string }[];
  openReportCount: number;
}
interface Page {
  state: DiscussionState;
  items: Comment[];
  nextCursor: string | null;
}
export function PublicationCommentModeration({
  publicationId,
  onAccessDenied,
}: {
  readonly publicationId: string;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<Page | null>(null),
    [items, setItems] = useState<Comment[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [reason, setReason] = useState('');
  const active = useRef(true),
    sequence = useRef(0),
    locked = useRef(false),
    requests = useRef(new Set<AbortController>());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      sequence.current++;
      requests.current.forEach((c) => c.abort());
    };
  }, []);
  const endpoint = `/api/admin/v1/publications/${encodeURIComponent(publicationId)}/comments`;
  async function request<T>(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      return await call<T>(path, { ...init, signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
      requests.current.delete(controller);
    }
  }
  async function load(cursor: string | null = null) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const seq = ++sequence.current;
    const result = await request<Page>(
      endpoint + (cursor ? `?before=${encodeURIComponent(cursor)}` : ''),
      { cache: 'no-store' },
    );
    locked.current = false;
    if (!active.current || seq !== sequence.current) return;
    setBusy(false);
    if (result.ok && result.data && Array.isArray(result.data.items)) {
      setPage(result.data);
      setItems((old) =>
        cursor
          ? [...old, ...result.data.items.filter((c) => !old.some((i) => i.id === c.id))]
          : result.data.items,
      );
    } else {
      setError('Не удалось загрузить комментарии.');
      if (result.status === 401 || result.status === 403) {
        setPage(null);
        setItems([]);
        onAccessDenied();
      }
    }
  }
  async function change(action: string, item?: Comment) {
    if (!page || locked.current || !reason.trim()) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const seq = ++sequence.current;
    const result = await request(endpoint + '/commands', {
      method: 'POST',
      body: JSON.stringify({
        action,
        reason: reason.trim(),
        expectedVersion: item?.version ?? page.state.version,
        ...(item ? { commentId: item.id } : { enabled: !page.state.adminEnabled }),
      }),
    });
    locked.current = false;
    if (!active.current || seq !== sequence.current) return;
    setBusy(false);
    if (result.ok) {
      setReason('');
      await load();
    } else {
      setError(
        result.status === 409
          ? 'Комментарий или настройка уже изменились. Обновите список.'
          : 'Изменение не подтверждено. Обновите список.',
      );
      if (result.status === 401 || result.status === 403) {
        setItems([]);
        setPage(null);
        onAccessDenied();
      }
    }
  }
  return (
    <section className="publication-comment-moderation" data-testid="admin-publication-comments">
      <button
        className="btn-secondary"
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && !page) void load();
        }}
      >
        Комментарии
      </button>
      {open ? (
        <div className="publication-comment-moderation-panel">
          <header>
            <h3>Комментарии публикации</h3>
            <button type="button" disabled={busy} onClick={() => void load()}>
              Обновить
            </button>
          </header>
          {error ? <p role="alert">{error}</p> : null}
          {busy ? <p role="status">Выполняем запрос…</p> : null}
          {page ? (
            <>
              <label>
                Причина действия
                <input
                  value={reason}
                  maxLength={500}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => void change('settings')}
              >
                {page.state.adminEnabled
                  ? 'Закрыть обсуждение администратором'
                  : 'Снять запрет администратора'}
              </button>
              <p>
                Автор {page.state.enabled ? 'разрешил' : 'закрыл'} обсуждение. Запрет администратора
                автор отменить не может.
              </p>
              {!items.length && !busy ? <p>Пока нет комментариев.</p> : null}
              {items.map((item) => (
                <article key={item.id} className="admin-publication-comment">
                  <header>
                    <strong>{item.author}</strong>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString('ru-RU')}
                    </time>
                  </header>
                  <p className="publication-comment-body">{item.body}</p>
                  <small>
                    {item.authorDeleted
                      ? 'Удалён автором'
                      : item.moderatorHidden
                        ? 'Скрыт модератором'
                        : item.ownerHidden
                          ? 'Скрыт владельцем проекта'
                          : 'Опубликован'}
                    {item.parentId ? ' · Ответ на комментарий' : ''}
                  </small>
                  {item.reports.length ? (
                    <div className="admin-publication-comment-reports">
                      <strong>
                        Неразобранные жалобы: {item.openReportCount ?? item.reports.length}
                      </strong>
                      {item.openReportCount > item.reports.length ? (
                        <small>
                          Показаны последние 20. Действие применяется ко всем жалобам на этот
                          комментарий.
                        </small>
                      ) : null}
                      {item.reports.map((r, i) => (
                        <p key={i}>{r.reason}</p>
                      ))}
                    </div>
                  ) : null}
                  <div className="publication-comment-actions">
                    <button
                      type="button"
                      disabled={busy || !reason.trim() || item.authorDeleted}
                      onClick={() => void change(item.moderatorHidden ? 'restore' : 'hide', item)}
                    >
                      {item.moderatorHidden ? 'Снять скрытие модератора' : 'Скрыть модератором'}
                    </button>
                    {item.reports.length ? (
                      <button
                        type="button"
                        disabled={busy || !reason.trim()}
                        onClick={() => void change('resolve', item)}
                      >
                        Жалобы рассмотрены
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {page.nextCursor ? (
                <button type="button" disabled={busy} onClick={() => void load(page.nextCursor)}>
                  Ещё комментарии
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
